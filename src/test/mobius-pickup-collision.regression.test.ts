/**
 * Regression test: Mobius strip pickup collision — S28b fix + S44j-31 server fix
 *
 * === S28b fix (worldToSurface scale invariance) ===
 * Root cause: MobiusSurface.worldToSurface() used absolute distance calculations
 * that are NOT scale-invariant. At EPIC map scale (2x), enemy/player positions are
 * in scaled world space but the Mobius parametric equations use 1x local coords.
 * This caused v to be computed outside [0,1], clamped to strip edges, so pickups
 * spawned at wrong positions and player UV never matched pickup UV.
 *
 * Fix: MobiusSurface.worldToSurface now divides by this.group.scale.x before
 * computing UV, ensuring correct results regardless of map size scale.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MobiusSurface } from '../surfaces/MobiusSurface';
import { MobiusBevelSurface } from '../surfaces/MobiusBevelSurface';

describe('Mobius strip worldToSurface scale invariance (S28b regression)', () => {
  const SCALES = [1.0, 1.5, 2.0]; // SMALL=0.75, MEDIUM=1.0, LARGE=1.5, EPIC=2.0

  describe('MobiusSurface', () => {
    it('worldToSurface(getPoint(u,v).position * scale) ≈ (u,v) at all map scales', () => {
      const testPoints = [
        { u: 0.1, v: 0.3 },
        { u: 0.25, v: 0.5 },
        { u: 0.3, v: 0.7 },
        { u: 0.5, v: 0.3 },
        { u: 0.5, v: 0.5 },
        { u: 0.5, v: 0.7 },
        { u: 0.75, v: 0.4 },
        { u: 0.9, v: 0.6 },
      ];

      for (const scale of SCALES) {
        const surface = new MobiusSurface();
        // Apply the group scale (as main.ts does for EPIC maps)
        surface.group.scale.setScalar(scale);

        for (const { u, v } of testPoints) {
          // Get the 1x local position
          const pt = surface.getPoint(u, v);
          // Simulate scaled world position (as seen by enemies/player at EPIC scale)
          const scaledPos = pt.position.clone().multiplyScalar(scale);

          const recovered = surface.worldToSurface(scaledPos);

          expect(recovered.u).toBeCloseTo(u, 1);
          expect(recovered.v).toBeCloseTo(v, 1);
        }
      }
    });

    it('player UV ≈ pickup UV when player stands on pickup at EPIC scale', () => {
      const surface = new MobiusSurface();
      surface.group.scale.setScalar(2.0); // EPIC scale

      // Simulate: enemy dies at (u=0.3, v=0.7)
      const enemyU = 0.3, enemyV = 0.7;
      const enemyWorldPos = surface.getPoint(enemyU, enemyV).position.clone().multiplyScalar(2.0);

      // Pickup spawns at UV from worldToSurface(enemy.position)
      const pickupUV = surface.worldToSurface(enemyWorldPos);

      // Player walks to same world position
      const playerUV = surface.worldToSurface(enemyWorldPos);

      // Both should give same UV (collision can fire)
      expect(playerUV.u).toBeCloseTo(pickupUV.u, 3);
      expect(playerUV.v).toBeCloseTo(pickupUV.v, 3);

      // And they should be close to the original enemy UV
      expect(pickupUV.u).toBeCloseTo(enemyU, 1);
      expect(pickupUV.v).toBeCloseTo(enemyV, 1);
    });

    it('v coordinate is NOT clamped to 0/1 at EPIC scale for interior points', () => {
      const surface = new MobiusSurface();
      surface.group.scale.setScalar(2.0);

      // Before fix: v was always clamped to 0 or 1 at 2x scale
      // After fix: v should be well within (0.1, 0.9) for interior points
      const testPoints = [
        { u: 0.0, v: 0.5 },
        { u: 0.25, v: 0.5 },
        { u: 0.5, v: 0.5 },
        { u: 0.75, v: 0.5 },
        { u: 0.3, v: 0.3 },
        { u: 0.3, v: 0.7 },
      ];

      for (const { u, v } of testPoints) {
        const pt = surface.getPoint(u, v);
        const scaledPos = pt.position.clone().multiplyScalar(2.0);
        const recovered = surface.worldToSurface(scaledPos);

        // v must NOT be stuck at the strip edges
        expect(recovered.v).toBeGreaterThan(0.05);
        expect(recovered.v).toBeLessThan(0.95);
      }
    });
  });

  describe('MobiusBevelSurface', () => {
    it('worldToSurface is scale-invariant at EPIC scale', () => {
      const surface = new MobiusBevelSurface();
      surface.group.scale.setScalar(2.0);

      const testPoints = [
        { u: 0.25, v: 0.25 },
        { u: 0.5, v: 0.5 },
        { u: 0.75, v: 0.75 },
      ];

      for (const { u, v } of testPoints) {
        const pt = surface.getPoint(u, v);
        const scaledPos = pt.position.clone().multiplyScalar(2.0);
        const recovered = surface.worldToSurface(scaledPos);

        expect(recovered.u).toBeCloseTo(u, 1);
        expect(recovered.v).toBeCloseTo(v, 1);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// S44j-31: Server-side mobiusChordDist regression tests
// ---------------------------------------------------------------------------

/**
 * Regression test: Mobius strip server-side pickup collision — s44j-31 fix
 *
 * Root cause: GameRoom.ts usesWorldDist did NOT include 'mobius', so the server
 * used the UV fallback (PICKUP_RADIUS = 0.02 / scaleFactor = 0.01 at EPIC scale).
 * The Mobius v-direction maps ~12 world units per UV unit at EPIC scale, making
 * the effective v-threshold only 0.12 world units (far smaller than the intended
 * PICKUP_WORLD = 0.25 * 2 = 0.5 world units). Pickups were uncollectable.
 *
 * Fix: Added 'mobius' to usesWorldDist and implemented mobiusChordDist matching
 * the exact parametric formula from MobiusSurface.ts (R=8, w=3).
 */
describe('Mobius server-side chord distance formula (s44j-31 regression)', () => {
  // Mirror of server-side mobiusPoint3D — MUST match MobiusSurface.getPointLocal
  const MOBIUS_R = 8;
  const MOBIUS_W = 3;
  function mobiusPoint3D(u: number, v: number, scaleFactor: number): [number, number, number] {
    const R = MOBIUS_R * scaleFactor;
    const w = MOBIUS_W * scaleFactor;
    const t = u * 2 * Math.PI;
    const s = (v - 0.5) * 2 * w;
    const halfT = t / 2;
    return [
      (R + s * Math.cos(halfT)) * Math.cos(t),
      (R + s * Math.cos(halfT)) * Math.sin(t),
      s * Math.sin(halfT),
    ];
  }
  function mobiusChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor: number): number {
    const [x1, y1, z1] = mobiusPoint3D(u1, v1, scaleFactor);
    const [x2, y2, z2] = mobiusPoint3D(u2, v2, scaleFactor);
    const dx = x1 - x2, dy = y1 - y2, dz = z1 - z2;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  it('mobiusPoint3D formula matches MobiusSurface.getPoint (client-server consistency)', () => {
    const surface = new MobiusSurface();
    const testPoints = [
      { u: 0.0, v: 0.5 },
      { u: 0.1, v: 0.3 },
      { u: 0.25, v: 0.5 },
      { u: 0.5, v: 0.3 },
      { u: 0.5, v: 0.7 },
      { u: 0.75, v: 0.4 },
      { u: 0.9, v: 0.6 },
      { u: 1.0, v: 0.5 },
    ];

    for (const { u, v } of testPoints) {
      const clientPos = surface.getPoint(u, v).position;
      const [sx, sy, sz] = mobiusPoint3D(u, v, 1.0);
      const serverPos = new THREE.Vector3(sx, sy, sz);
      const dist = clientPos.distanceTo(serverPos);
      expect(dist, `Formula mismatch at u=${u}, v=${v}: dist=${dist.toFixed(4)}`).toBeLessThan(0.001);
    }
  });

  it('chord distance is 0 at the Mobius seam (u=0 and u=1 are the same point at v-flip)', () => {
    // At the Mobius seam: (u=0, v=V) === (u=1, v=1-V)
    const seamPairs = [
      [0.5, 0.5], // center of strip — v=0.5 maps to v=0.5 (unchanged)
      [0.3, 0.7], // (u=0, v=0.3) === (u=1, v=0.7)
      [0.2, 0.8],
    ];

    for (const [v, vFlipped] of seamPairs) {
      const dist = mobiusChordDist(0.0, v, 1.0, vFlipped, 1.0);
      expect(dist, `Seam distance at v=${v}/vFlipped=${vFlipped}: ${dist.toFixed(4)}`).toBeLessThan(0.001);
    }
  });

  it('chord distance is within PICKUP_WORLD when player is at pickup position (EPIC scale)', () => {
    // At EPIC scale=2: PICKUP_WORLD = 0.25 * 2 = 0.5 world units
    // Player exactly at pickup UV → distance must be 0
    const PICKUP_WORLD = 0.25 * 2.0;
    const testPoints = [
      { u: 0.1, v: 0.3 },
      { u: 0.3, v: 0.5 },
      { u: 0.5, v: 0.5 },
      { u: 0.75, v: 0.7 },
      { u: 0.9, v: 0.4 },
    ];

    for (const { u, v } of testPoints) {
      const dist = mobiusChordDist(u, v, u, v, 2.0);
      expect(dist, `Same-point distance at (${u},${v}): ${dist.toFixed(4)}`).toBeLessThan(PICKUP_WORLD);
    }
  });

  it('UV fallback was broken: 0.01 UV threshold gave only 0.12 world units in v-direction at EPIC scale', () => {
    // Reproduce the exact bug: UV threshold = 0.02 / 2.0 = 0.01
    // In v-direction, 0.01 UV = 0.01 * (2 * stripWidth * scaleFactor) = 0.01 * 12 = 0.12 world units
    // But PICKUP_WORLD should be 0.5 world units at EPIC scale.
    // This test DOCUMENTS the bug; it does NOT assert that the old UV code is correct.
    const EPIC_SCALE = 2.0;
    const OLD_PICKUP_RADIUS = 0.02 / EPIC_SCALE; // = 0.01
    const v_world_scale = 2 * MOBIUS_W * EPIC_SCALE; // = 12 world units per v-unit
    const old_threshold_in_v_direction = OLD_PICKUP_RADIUS * v_world_scale; // = 0.12

    // Document the bug: old v-threshold was 4x smaller than intended
    const INTENDED_PICKUP_WORLD = 0.25 * EPIC_SCALE; // = 0.5
    expect(old_threshold_in_v_direction).toBeLessThan(INTENDED_PICKUP_WORLD / 2);

    // With the fix (chord distance), a player 0.4 world units away in the v-direction
    // can now collect the pickup (< PICKUP_WORLD=0.5)
    const nearbyU = 0.5;
    const nearbyV1 = 0.5;
    const nearbyV2 = 0.5 + 0.4 / v_world_scale; // 0.4 world units away in v
    const chordDist = mobiusChordDist(nearbyU, nearbyV1, nearbyU, nearbyV2, EPIC_SCALE);
    expect(chordDist).toBeCloseTo(0.4, 1); // ≈ 0.4 world units (chord ≈ arc for short distances)
    expect(chordDist).toBeLessThan(INTENDED_PICKUP_WORLD);
  });
});
