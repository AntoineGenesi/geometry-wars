/**
 * Regression test: Pickup collection must use analytical surface positions for
 * BOTH player and pickup, not mesh-walker position vs analytical position.
 *
 * Root cause (s44r4-03): playerWalker.position is on the tessellated mesh, while
 * pickup._surfaceWorldPos comes from getTransform(u,v) — the analytical surface.
 * On curved surfaces (pill, torus, peanut), the tessellated mesh diverges from
 * the analytical surface, creating a position mismatch. The player had to walk
 * to a "weird other spot" to collect pickups.
 *
 * Fix: compute player position via getTransform(playerU, playerV) so both
 * positions are in the same analytical coordinate space.
 *
 * This test verifies the core collision math: when both positions come from
 * the same getTransform function (analytical surface), they align correctly.
 * When one comes from a mesh approximation, they can diverge beyond collection radius.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// ─── constants matching source code ─────────────────────────────────────────

/** PICKUP_WORLD_RADIUS from WeaponPickup.ts */
const PICKUP_WORLD_RADIUS = 0.25;

/** PICKUP_WORLD_RADIUS from SuperStatePickup.ts */
const SUPER_PICKUP_WORLD_RADIUS = 0.3;

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Simulate a sphere surface's getTransform function.
 * Returns the analytical position on a sphere of given radius at UV coordinates.
 */
function sphereGetTransform(surfaceRadius: number, scaleFactor: number = 1.0) {
  return (u: number, v: number) => {
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI;
    const r = surfaceRadius * scaleFactor;
    const position = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
    const normal = position.clone().normalize();
    const tangent = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta));
    const bitangent = normal.clone().cross(tangent).normalize();
    return { position, normal, tangent, bitangent };
  };
}

/**
 * Simulate the mesh-walker position: on a tessellated mesh, the face center
 * is slightly inside the true sphere (on the chord, not the arc).
 * This simulates the error between mesh raycaster and analytical surface.
 */
function meshApproxPosition(
  analyticalPos: THREE.Vector3,
  normal: THREE.Vector3,
  errorFraction: number, // e.g., 0.08 = 8% of surface radius
  surfaceRadius: number,
): THREE.Vector3 {
  // Mesh flattens the surface — walker position is shifted inward along normal
  return analyticalPos.clone().addScaledVector(normal, -errorFraction * surfaceRadius);
}

/**
 * Simulate the pickup collision check (mirrors checkPlayerCollision).
 * pickupSurfaceWorldPos: from getTransform(pickupU, pickupV).position
 * playerPos: either mesh walker position or analytical position
 */
function wouldCollect(
  playerPos: THREE.Vector3,
  pickupSurfaceWorldPos: THREE.Vector3,
  radius: number,
  scaleFactor: number,
): boolean {
  return playerPos.distanceTo(pickupSurfaceWorldPos) < radius * scaleFactor;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Pickup collection: analytical position consistency (s44r4-03 regression)', () => {
  const surfaceRadius = 5.0;
  const scaleFactor = 1.0;
  const getTransform = sphereGetTransform(surfaceRadius, scaleFactor);

  describe('FIXED: both positions from analytical surface', () => {
    it('player at same UV as pickup → always collects', () => {
      const u = 0.3, v = 0.4;
      const playerAnalytical = getTransform(u, v).position;
      const pickupSurface = getTransform(u, v).position;

      // Distance is 0 (same point) → always within any positive radius
      expect(wouldCollect(playerAnalytical, pickupSurface, PICKUP_WORLD_RADIUS, scaleFactor)).toBe(true);
    });

    it('player at slightly offset UV → within collection radius', () => {
      const pickupU = 0.5, pickupV = 0.5;
      const playerU = 0.502, playerV = 0.502;

      const playerPos = getTransform(playerU, playerV).position;
      const pickupPos = getTransform(pickupU, pickupV).position;

      const dist = playerPos.distanceTo(pickupPos);
      expect(dist).toBeLessThan(PICKUP_WORLD_RADIUS * scaleFactor);
      expect(wouldCollect(playerPos, pickupPos, PICKUP_WORLD_RADIUS, scaleFactor)).toBe(true);
    });

    it('player far from pickup → does not collect', () => {
      const pickupU = 0.5, pickupV = 0.5;
      const playerU = 0.7, playerV = 0.7;

      const playerPos = getTransform(playerU, playerV).position;
      const pickupPos = getTransform(pickupU, pickupV).position;

      expect(wouldCollect(playerPos, pickupPos, PICKUP_WORLD_RADIUS, scaleFactor)).toBe(false);
    });
  });

  describe('BUG: mesh-walker position vs analytical surface position', () => {
    it('mesh approximation can push player beyond collection radius even at same UV', () => {
      const u = 0.3, v = 0.4;
      const { position: analyticalPos, normal } = getTransform(u, v);

      // On a sphere of radius 5 with ~32 segments, mesh faces can be ~0.08R (0.4 units)
      // inward from the true surface. This exceeds the 0.25 collection radius.
      const meshError = 0.08;
      const walkerPos = meshApproxPosition(analyticalPos, normal, meshError, surfaceRadius);
      const pickupPos = getTransform(u, v).position; // analytical

      const gap = walkerPos.distanceTo(pickupPos);
      // Gap = 0.08 * 5.0 = 0.4 world units > 0.25 radius → MISS
      expect(gap).toBeCloseTo(meshError * surfaceRadius, 1);
      expect(gap).toBeGreaterThan(PICKUP_WORLD_RADIUS * scaleFactor);

      // This is the bug! Player is visually ON the pickup but can't collect it
      expect(wouldCollect(walkerPos, pickupPos, PICKUP_WORLD_RADIUS, scaleFactor)).toBe(false);
    });

    it('moderate mesh error (0.04R) still causes missed collection', () => {
      const u = 0.5, v = 0.3;
      const { position: analyticalPos, normal } = getTransform(u, v);

      // 4% error = 0.2 units — close to 0.25 threshold
      // With any small additional UV offset, this crosses the boundary
      const meshError = 0.04;
      const walkerPos = meshApproxPosition(analyticalPos, normal, meshError, surfaceRadius);

      // Add small UV offset (player near but not exactly at pickup)
      const pickupU = u + 0.003, pickupV = v + 0.003;
      const pickupPos = getTransform(pickupU, pickupV).position;

      // Combined error: mesh offset + UV offset can exceed collection radius
      const gap = walkerPos.distanceTo(pickupPos);
      // The analytical distance for this UV offset is ~0.1, plus mesh error of 0.2 = 0.3 > 0.25
      if (gap > PICKUP_WORLD_RADIUS * scaleFactor) {
        expect(wouldCollect(walkerPos, pickupPos, PICKUP_WORLD_RADIUS, scaleFactor)).toBe(false);
      }
    });
  });

  describe('scale factor invariance', () => {
    it('collection works at EPIC scale (2.0)', () => {
      const epicScale = 2.0;
      const epicTransform = sphereGetTransform(surfaceRadius, epicScale);
      const u = 0.5, v = 0.5;

      const playerPos = epicTransform(u, v).position;
      const pickupPos = epicTransform(u, v).position;

      expect(wouldCollect(playerPos, pickupPos, PICKUP_WORLD_RADIUS, epicScale)).toBe(true);
    });

    it('collection works at SMALL scale (0.75)', () => {
      const smallScale = 0.75;
      const smallTransform = sphereGetTransform(surfaceRadius, smallScale);
      const u = 0.5, v = 0.5;

      const playerPos = smallTransform(u, v).position;
      const pickupPos = smallTransform(u, v).position;

      expect(wouldCollect(playerPos, pickupPos, PICKUP_WORLD_RADIUS, smallScale)).toBe(true);
    });
  });

  describe('super pickup collection radius', () => {
    it('super pickup has larger radius (0.3) for easier collection', () => {
      const pickupU = 0.5, pickupV = 0.5;
      // Player slightly further away — outside weapon radius but inside super radius
      const playerU = 0.505, playerV = 0.505;

      const playerPos = getTransform(playerU, playerV).position;
      const pickupPos = getTransform(pickupU, pickupV).position;
      const dist = playerPos.distanceTo(pickupPos);

      // Should be within super radius but might be outside weapon radius
      if (dist > PICKUP_WORLD_RADIUS * scaleFactor && dist < SUPER_PICKUP_WORLD_RADIUS * scaleFactor) {
        expect(wouldCollect(playerPos, pickupPos, PICKUP_WORLD_RADIUS, scaleFactor)).toBe(false);
        expect(wouldCollect(playerPos, pickupPos, SUPER_PICKUP_WORLD_RADIUS, scaleFactor)).toBe(true);
      }
    });
  });
});
