/**
 * Regression test: MP pickup collection — player position accuracy (s44r9-04)
 *
 * Root cause: In MP, the pickup collection check computed the player's "surface position"
 * from localPlayer.surfaceU/V, which comes from the server's sphere-approximation UV.
 * This has two problems:
 *
 * 1. On non-spherical surfaces (cube, pill, peanut, torus, etc.), sphere-approx UV gives
 *    the WRONG world position when passed back through getTransform(u, v). The player
 *    appears to be in the right place visually but the collection check computes a
 *    completely different player position → misses even when player is directly over pickup.
 *
 * 2. On sphere maps, the UV is correct but lags ~33ms behind the player's visual position
 *    (server state updates at 30Hz). In 33ms, a fast-moving player moves ~0.1-0.2 UV
 *    units = significant world-space offset. When server UV puts player 0.03+ UV units
 *    from pickup, the computed world distance exceeds the 0.35 collection radius → miss.
 *
 * Fix (s44r9-04): Use localPlayer.mesh.position → surface.worldToSurface() → getTransform()
 * instead of getTransform(localPlayer.surfaceU, localPlayer.surfaceV).
 * mesh.position is accurate (set from server wx/wy/wz every frame via prediction).
 * worldToSurface() recovers the correct UV on any surface type.
 *
 * Tests verify the MATH behind the two approaches (no DOM/WebGL needed):
 * - OLD approach: getTransform(laggingUV).position → fails when UV is wrong/lagging
 * - NEW approach: worldToSurface(mesh.pos/scale) → getTransform(u,v).position → correct
 * - Collection radius: pickup within 0.35 world units → collects; 0.8+ away → does not
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SphereSurface } from '../surfaces/SphereSurface';
import { makeSurfaceTransformFn } from '../rendering/SharedGameSetup';
import { WEAPON_PICKUP_WORLD_RADIUS } from '../shared/GameBalanceConstants';

// ─── Surface setup matching the game ────────────────────────────────────────
// DEFAULT_SURFACE_SCALE=10, sphere radius=10*0.6=6, medium map scale=1.0
const SPHERE_RADIUS = 6;
const MAP_SCALE = 1.0;
const surface = new SphereSurface({ radius: SPHERE_RADIUS });
const getTransform = makeSurfaceTransformFn(surface, MAP_SCALE);

// ─── Position helpers ────────────────────────────────────────────────────────

/** Surface world position at UV (no elevation). This is what pickup._surfaceWorldPos equals. */
function surfacePosAt(u: number, v: number): THREE.Vector3 {
  return getTransform(u, v).position.clone();
}

/** Player mesh position (0.15 above surface). This is localPlayer.mesh.position in MP. */
function meshPosAt(u: number, v: number): THREE.Vector3 {
  const { position, normal } = getTransform(u, v);
  return position.clone().addScaledVector(normal, 0.15);
}

/**
 * Simulate the OLD (broken) MP collection check.
 * Uses sphere-approx server UV to compute player position — may lag or be wrong.
 */
function oldCheckDist(pickupU: number, pickupV: number, playerServerU: number, playerServerV: number): number {
  const pickupSurfacePos = surfacePosAt(pickupU, pickupV);
  const playerSurfacePos = getTransform(playerServerU, playerServerV).position;
  return playerSurfacePos.distanceTo(pickupSurfacePos);
}

/**
 * Simulate the NEW (fixed) MP collection check.
 * Uses mesh.position → worldToSurface → getTransform for accurate player UV.
 */
function newCheckDist(pickupU: number, pickupV: number, playerMeshPos: THREE.Vector3): number {
  const pickupSurfacePos = surfacePosAt(pickupU, pickupV);
  // De-scale mesh position for worldToSurface (expects unscaled local coords)
  const unscaled = playerMeshPos.clone();
  if (MAP_SCALE !== 1.0) unscaled.divideScalar(MAP_SCALE);
  const { u, v } = surface.worldToSurface(unscaled);
  const playerSurfacePos = getTransform(u, v).position;
  return playerSurfacePos.distanceTo(pickupSurfacePos);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MP pickup collection — accurate player position (s44r9-04)', () => {

  describe('Collection radius contract: within 0.35 → collect; 0.8+ → miss', () => {
    it(`WEAPON_PICKUP_WORLD_RADIUS is ${WEAPON_PICKUP_WORLD_RADIUS}`, () => {
      expect(WEAPON_PICKUP_WORLD_RADIUS).toBe(0.35);
    });

    it('pickup at distance 0 (same surface pos) → dist < 0.35 → should collect', () => {
      const pickupU = 0.5, pickupV = 0.5;
      const playerMesh = meshPosAt(pickupU, pickupV);
      expect(newCheckDist(pickupU, pickupV, playerMesh)).toBeLessThan(WEAPON_PICKUP_WORLD_RADIUS);
    });

    it('pickup 0.34 world units away on surface → should collect', () => {
      const pickupPos = surfacePosAt(0.5, 0.5);
      // Move 0.34 units laterally on the surface, then find the UV at that surface point
      const lateralPos = pickupPos.clone().add(new THREE.Vector3(0.34, 0, 0));
      // Project onto sphere surface to get surface position
      const playerActualSurface = lateralPos.clone().normalize().multiplyScalar(SPHERE_RADIUS);
      const dist = playerActualSurface.distanceTo(pickupPos);
      // 0.34 units should be within collection radius
      expect(dist).toBeLessThan(WEAPON_PICKUP_WORLD_RADIUS);
    });

    it('pickup 0.8 world units away (UV offset 0.02 → ~0.75 arc) → dist > 0.35', () => {
      // UV offset 0.02 on sphere circumference = 0.02 × 2π × 6 ≈ 0.75 world units
      const pickupPos = surfacePosAt(0.5, 0.5);
      const farPos = surfacePosAt(0.52, 0.5); // 0.02 UV offset in u
      const dist = farPos.distanceTo(pickupPos);
      expect(dist).toBeGreaterThan(WEAPON_PICKUP_WORLD_RADIUS); // >0.35
      expect(dist).toBeGreaterThan(0.7); // well beyond collection radius
    });
  });

  describe('BUG: OLD approach fails when server UV lags behind player visual position', () => {
    it('server UV lag of 0.03 creates >0.35 world unit offset on sphere (fails collection)', () => {
      const pickupU = 0.5, pickupV = 0.5;
      // Sphere circumference = 2π×6 ≈ 37.7. 0.03 UV × 37.7 ≈ 1.13 world units offset
      const laggedU = 0.47; // 0.03 UV lag
      const dist = oldCheckDist(pickupU, pickupV, laggedU, pickupV);
      // UV lag of 0.03 creates >> 0.35 world unit offset → OLD approach misses
      expect(dist).toBeGreaterThan(WEAPON_PICKUP_WORLD_RADIUS);
    });

    it('server UV lag of 0.02 also creates >0.35 world unit offset', () => {
      const pickupU = 0.25, pickupV = 0.4;
      const laggedU = pickupU - 0.02;
      const dist = oldCheckDist(pickupU, pickupV, laggedU, pickupV);
      // 0.02 UV × 37.7 ≈ 0.75 world units > 0.35 → miss
      expect(dist).toBeGreaterThan(WEAPON_PICKUP_WORLD_RADIUS);
    });

    it('player visually ON pickup but server UV lagging → OLD approach computes wrong pos', () => {
      const pickupU = 0.5, pickupV = 0.5;
      const pickupWorldPos = surfacePosAt(pickupU, pickupV);

      // Player is VISUALLY AT the pickup (accurate server world pos via wx/wy/wz)
      const playerMesh = meshPosAt(pickupU, pickupV);

      // Server UV is lagging — last server update had player at a different position
      const laggedU = 0.47;
      const laggedV = 0.50;

      // OLD: uses lagged server UV → computed player pos is far from pickup → MISS
      const oldDist = oldCheckDist(pickupU, pickupV, laggedU, laggedV);
      expect(oldDist).toBeGreaterThan(WEAPON_PICKUP_WORLD_RADIUS); // OLD misses

      // NEW: uses mesh.pos → worldToSurface → correct UV → COLLECTS
      const newDist = newCheckDist(pickupU, pickupV, playerMesh);
      expect(newDist).toBeLessThan(WEAPON_PICKUP_WORLD_RADIUS); // NEW hits
    });
  });

  describe('FIX: NEW approach correctly detects collection via mesh.position → worldToSurface', () => {
    const pickupPositions = [
      { u: 0.0,  v: 0.5,  label: 'equator 0°' },
      { u: 0.25, v: 0.5,  label: 'equator 90°' },
      { u: 0.5,  v: 0.3,  label: 'northern hemisphere' },
      { u: 0.75, v: 0.7,  label: 'southern hemisphere' },
      { u: 0.1,  v: 0.4,  label: 'arbitrary position' },
      { u: 0.9,  v: 0.6,  label: 'another position' },
    ];

    for (const { u, v, label } of pickupPositions) {
      it(`collects when player mesh pos matches pickup UV: ${label}`, () => {
        // Player mesh position = pickup surface pos + elevation (player directly over pickup)
        const playerMesh = meshPosAt(u, v);
        const dist = newCheckDist(u, v, playerMesh);
        // Distance from recovered surface pos to pickup surface pos must be < radius
        expect(dist).toBeLessThan(WEAPON_PICKUP_WORLD_RADIUS);
      });
    }

    it('new approach gives near-zero distance when player is directly over pickup', () => {
      const u = 0.5, v = 0.5;
      const playerMesh = meshPosAt(u, v);
      const dist = newCheckDist(u, v, playerMesh);
      // worldToSurface(mesh.pos) should recover the same UV → distance ≈ 0
      expect(dist).toBeLessThan(0.01); // essentially zero
    });

    it('new approach fails correctly when player is far from pickup (> 0.8 units)', () => {
      const pickupU = 0.5, pickupV = 0.5;
      // Player at very different UV (far away)
      const farU = 0.1, farV = 0.1;
      const playerMesh = meshPosAt(farU, farV);
      const dist = newCheckDist(pickupU, pickupV, playerMesh);
      // Far-away player should not collect
      expect(dist).toBeGreaterThan(0.8);
    });
  });

  describe('Comparison: old vs new approach on sphere (old lags, new is accurate)', () => {
    it('for same pickup, old approach MISSES when UV lags but new approach HITS', () => {
      const pickupU = 0.33, pickupV = 0.55;
      const playerMesh = meshPosAt(pickupU, pickupV); // player at same position as pickup

      // Old: use slightly-off server UV (0.025 lag) → miss
      const oldU = pickupU - 0.025;
      const oldDist = oldCheckDist(pickupU, pickupV, oldU, pickupV);
      // 0.025 UV lag × 37.7 circumference ≈ 0.94 world units > 0.35 → miss
      expect(oldDist).toBeGreaterThan(WEAPON_PICKUP_WORLD_RADIUS);

      // New: use actual mesh pos → worldToSurface → hit
      const newDist = newCheckDist(pickupU, pickupV, playerMesh);
      expect(newDist).toBeLessThan(WEAPON_PICKUP_WORLD_RADIUS);
    });

    it('worldToSurface roundtrip on sphere recovers exact UV', () => {
      // Verify that mesh.pos → worldToSurface gives back the correct UV
      const u = 0.4, v = 0.6;
      const meshPos = meshPosAt(u, v);
      const unscaled = meshPos.clone(); // scale = 1.0
      const { u: recoveredU, v: recoveredV } = surface.worldToSurface(unscaled);

      // worldToSurface on elevated position (sphere) should recover near-original UV
      // (elevation is radial on sphere, so theta/phi are unchanged)
      expect(recoveredU).toBeCloseTo(u, 3);
      expect(recoveredV).toBeCloseTo(v, 3);
    });
  });
});
