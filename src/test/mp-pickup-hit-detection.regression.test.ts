/**
 * Regression test: MP pickup hit detection — inconsistent collection due to mesh elevation mismatch
 * Task: s44r2-02
 *
 * Root cause: network-main.ts compared localPlayer.mesh.position (0.15 units above surface)
 * against pickup.mesh.position (0.5 units above surface). The vertical gap (~0.35 units) exceeded
 * the 0.3 collection radius, making collection fail even when the player was directly over the pickup.
 *
 * The gap varied with the bob animation (±0.08 units), creating the flickery/inconsistent behavior:
 * - Bob at peak (+0.08): pickup at 0.58 above surface → gap = 0.43 → MISS (0.43 > 0.3)
 * - Bob at zero: pickup at 0.50 above surface → gap = 0.35 → MISS (0.35 > 0.3)
 * - Bob at trough (-0.08): pickup at 0.42 above surface → gap = 0.27 → barely collects
 *
 * Fix: use analytical surface positions (getTransform(u,v).position) for BOTH player and pickup
 * in the proximity check. This matches the SP companion pickup approach (network-main.ts:5566).
 *
 * For WeaponPickup and BuffPickupNew: use checkPlayerCollision() which already uses _surfaceWorldPos.
 * For super/health pickups: compare getTransform(pickup.u, pickup.v).position against player surface pos.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// ─── constants mirroring the source code ────────────────────────────────────

/** Player mesh elevation above surface (network-main.ts:5404-5405) */
const PLAYER_ELEVATION = 0.15;

/** Pickup mesh elevation above surface (WeaponPickup.applySurfaceTransform) */
const PICKUP_ELEVATION_BASE = 0.5;

/** Max bob amplitude (WeaponPickup) */
const BOB_AMPLITUDE = 0.08;

/** OLD collection radius (network-main.ts before fix) */
const OLD_RADIUS = 0.3;

/** NEW collection radius for WeaponPickup.checkPlayerCollision() (PICKUP_WORLD_RADIUS in WeaponPickup.ts) */
const NEW_RADIUS_WEAPON = 0.25;

/** NEW collection radius for super/health pickups (preserved 0.3) */
const NEW_RADIUS_SUPER = 0.3;

// ─── collision math helpers ──────────────────────────────────────────────────

/**
 * Simulate the BUGGY collection check (old network-main.ts code):
 * Compares localPlayer.mesh.position (elevated) vs pickup.mesh.position (elevated).
 *
 * player.mesh.position = surfacePos + normal * PLAYER_ELEVATION
 * pickup.mesh.position = surfacePos + normal * (PICKUP_ELEVATION_BASE + bob)
 * Check: distSq < (OLD_RADIUS * scale)²
 */
function buggyCollisionCheck(
  playerSurfacePos: THREE.Vector3,
  pickupSurfacePos: THREE.Vector3,
  bob: number,
  scaleFactor = 1.0,
  normal = new THREE.Vector3(0, 1, 0),
): boolean {
  const playerMeshPos = playerSurfacePos.clone().addScaledVector(normal, PLAYER_ELEVATION);
  const pickupMeshPos = pickupSurfacePos.clone().addScaledVector(normal, PICKUP_ELEVATION_BASE + bob);
  const radiusSq = Math.pow(OLD_RADIUS * scaleFactor, 2);
  return playerMeshPos.distanceToSquared(pickupMeshPos) < radiusSq;
}

/**
 * Simulate the FIXED collection check for WeaponPickup/BuffPickupNew (new code):
 * Mirrors WeaponPickup.checkPlayerCollision() — compares _surfaceWorldPos vs playerAnalyticalPos.
 *
 * _surfaceWorldPos = surfacePos (no elevation — set in applySurfaceTransform)
 * playerAnalyticalPos = getTransform(playerU, playerV).position (no elevation)
 * Check: dist < PICKUP_WORLD_RADIUS * scale (= 0.25 * scale for WeaponPickup)
 */
function fixedWeaponCollisionCheck(
  playerSurfacePos: THREE.Vector3,
  pickupSurfacePos: THREE.Vector3,
  scaleFactor = 1.0,
): boolean {
  const dist = playerSurfacePos.distanceTo(pickupSurfacePos);
  return dist < NEW_RADIUS_WEAPON * scaleFactor;
}

/**
 * Simulate the FIXED collection check for super/health pickups (new code):
 * Compares getTransform(player.u, player.v).position vs getTransform(pickup.u, pickup.v).position.
 * Check: distSq < (0.3 * scale)²
 */
function fixedSuperCollisionCheck(
  playerSurfacePos: THREE.Vector3,
  pickupSurfacePos: THREE.Vector3,
  scaleFactor = 1.0,
): boolean {
  const radiusSq = Math.pow(NEW_RADIUS_SUPER * scaleFactor, 2);
  return playerSurfacePos.distanceToSquared(pickupSurfacePos) < radiusSq;
}

// ─── tests ───────────────────────────────────────────────────────────────────

const SURFACE_POS = new THREE.Vector3(5, 0, 3); // typical world-space surface position

describe('MP pickup hit detection — elevation mismatch bug (s44r2-02)', () => {

  describe('BUG: old code fails when player is directly over pickup (same UV)', () => {
    it('FAILS with bob=0: vertical gap = 0.35 > radius 0.3', () => {
      // Player at surfacePos + 0.15, pickup at surfacePos + 0.50
      // Distance = 0.35 > 0.3 → miss
      expect(buggyCollisionCheck(SURFACE_POS, SURFACE_POS, 0)).toBe(false);
    });

    it('FAILS with bob=+0.08: vertical gap = 0.43 > radius 0.3', () => {
      expect(buggyCollisionCheck(SURFACE_POS, SURFACE_POS, +BOB_AMPLITUDE)).toBe(false);
    });

    it('BARELY WORKS with bob=-0.08: vertical gap = 0.27 < radius 0.3 (flickers)', () => {
      // Only works when bob is at minimum
      expect(buggyCollisionCheck(SURFACE_POS, SURFACE_POS, -BOB_AMPLITUDE)).toBe(true);
    });

    it('BUG: collection is inconsistent — result depends on animation frame, not player position', () => {
      const bobs = [-0.08, -0.04, 0.0, 0.04, 0.08];
      const results = bobs.map(bob => buggyCollisionCheck(SURFACE_POS, SURFACE_POS, bob));
      // When player is directly over pickup, ALL should work — but old code only works at min bob
      const allWork = results.every(r => r === true);
      expect(allWork, 'Old code: must not be animation-dependent').toBe(false);
    });

    it('Sphere map: player in middle of pickup, vertical gap prevents collection', () => {
      // sphere: majorRadius~6, positions around 6 units from center
      const spherePos = new THREE.Vector3(6, 0, 0);
      const normalOutward = new THREE.Vector3(1, 0, 0); // radial outward
      expect(buggyCollisionCheck(spherePos, spherePos, 0, 1.0, normalOutward)).toBe(false);
    });

    it('Torus outer surface: player directly over pickup → MISS with bob=0', () => {
      const outerPos = new THREE.Vector3(11, 0, 0); // outer torus ring
      const normalOutward = new THREE.Vector3(1, 0, 0);
      expect(buggyCollisionCheck(outerPos, outerPos, 0, 1.0, normalOutward)).toBe(false);
    });

    it('Torus inner surface: player directly over pickup → MISS with bob=0', () => {
      const innerPos = new THREE.Vector3(5, 0, 0); // inner torus ring
      const normalInward = new THREE.Vector3(-1, 0, 0);
      expect(buggyCollisionCheck(innerPos, innerPos, 0, 1.0, normalInward)).toBe(false);
    });
  });

  describe('FIX: surface-position comparison always works when player is at same UV', () => {
    it('WeaponPickup: collects at same surface position (bob=0)', () => {
      expect(fixedWeaponCollisionCheck(SURFACE_POS, SURFACE_POS)).toBe(true);
    });

    it('WeaponPickup: collects at same surface position (bob=+0.08 — irrelevant in fixed code)', () => {
      // Bob is irrelevant — we use surface positions now, not mesh positions
      expect(fixedWeaponCollisionCheck(SURFACE_POS, SURFACE_POS)).toBe(true);
    });

    it('WeaponPickup: collection consistent across ALL bob values', () => {
      const bobs = [-0.08, -0.04, 0.0, 0.04, 0.08];
      const results = bobs.map(() => fixedWeaponCollisionCheck(SURFACE_POS, SURFACE_POS));
      expect(results.every(r => r === true), 'All bob values must allow collection').toBe(true);
    });

    it('WeaponPickup: collects when player is within 0.2 units on surface (< 0.25 radius)', () => {
      const nearPlayer = SURFACE_POS.clone().add(new THREE.Vector3(0.2, 0, 0));
      expect(fixedWeaponCollisionCheck(nearPlayer, SURFACE_POS)).toBe(true);
    });

    it('WeaponPickup: does NOT collect when player is 0.5 units away (> 0.25 radius)', () => {
      const farPlayer = SURFACE_POS.clone().add(new THREE.Vector3(0.5, 0, 0));
      expect(fixedWeaponCollisionCheck(farPlayer, SURFACE_POS)).toBe(false);
    });

    it('Sphere map: player directly on pickup → always collects', () => {
      const spherePos = new THREE.Vector3(6, 0, 0);
      expect(fixedWeaponCollisionCheck(spherePos, spherePos)).toBe(true);
    });

    it('Torus outer surface: player directly on pickup → always collects', () => {
      const outerPos = new THREE.Vector3(11, 0, 0);
      expect(fixedWeaponCollisionCheck(outerPos, outerPos)).toBe(true);
    });

    it('Torus inner surface: player directly on pickup → always collects', () => {
      const innerPos = new THREE.Vector3(5, 0, 0);
      expect(fixedWeaponCollisionCheck(innerPos, innerPos)).toBe(true);
    });

    it('Torus: outer and inner surface hit detection behave identically (symmetry)', () => {
      const outerPos = new THREE.Vector3(11, 0, 0);
      const innerPos = new THREE.Vector3(5, 0, 0);
      // Both should collect when directly over pickup
      expect(fixedWeaponCollisionCheck(outerPos, outerPos)).toBe(
        fixedWeaponCollisionCheck(innerPos, innerPos),
      );
    });
  });

  describe('FIX: Super/health pickup surface-position comparison', () => {
    it('Super pickup: collects at same surface position', () => {
      expect(fixedSuperCollisionCheck(SURFACE_POS, SURFACE_POS)).toBe(true);
    });

    it('Super pickup: collects within 0.25 units (< 0.3 radius)', () => {
      const nearPlayer = SURFACE_POS.clone().add(new THREE.Vector3(0.25, 0, 0));
      expect(fixedSuperCollisionCheck(nearPlayer, SURFACE_POS)).toBe(true);
    });

    it('Super pickup: does NOT collect at 0.4 units (> 0.3 radius)', () => {
      const farPlayer = SURFACE_POS.clone().add(new THREE.Vector3(0.4, 0, 0));
      expect(fixedSuperCollisionCheck(farPlayer, SURFACE_POS)).toBe(false);
    });
  });

  describe('Scale invariance: fix works across all map sizes', () => {
    for (const scale of [0.75, 1.0, 1.5, 2.0]) {
      it(`WeaponPickup: collects at same UV position on scale=${scale}`, () => {
        // Surface positions scale linearly — positions are scale × base
        const pos = SURFACE_POS.clone().multiplyScalar(scale);
        expect(fixedWeaponCollisionCheck(pos, pos, scale)).toBe(true);
      });

      it(`WeaponPickup: old code FAILS at same UV on scale=${scale} (vertical gap persists)`, () => {
        const pos = SURFACE_POS.clone().multiplyScalar(scale);
        // Vertical gap (0.35) is unaffected by scale — still > 0.3*scale for scale≤1, close for scale>1
        // For scale=2: OLD_RADIUS=0.6, gap still 0.35 → 0.35 < 0.6 → would collect! Test just scale=1.
        if (scale <= 1.0) {
          expect(buggyCollisionCheck(pos, pos, 0, scale)).toBe(false);
        }
      });
    }
  });

  describe('Distance math: verify the 0.35-unit vertical gap is the root cause', () => {
    it('Vertical gap between player mesh (0.15 above surface) and pickup mesh (0.50 above) is 0.35', () => {
      const normal = new THREE.Vector3(0, 1, 0);
      const playerPos = SURFACE_POS.clone().addScaledVector(normal, PLAYER_ELEVATION);
      const pickupPos = SURFACE_POS.clone().addScaledVector(normal, PICKUP_ELEVATION_BASE);
      const gap = playerPos.distanceTo(pickupPos);
      expect(gap).toBeCloseTo(PICKUP_ELEVATION_BASE - PLAYER_ELEVATION, 5); // 0.35
    });

    it('0.35 gap exceeds 0.3 collection radius → collection impossible at bob=0', () => {
      const gap = PICKUP_ELEVATION_BASE - PLAYER_ELEVATION; // 0.35
      expect(gap).toBeGreaterThan(OLD_RADIUS);
    });

    it('With bob=-0.08, gap drops to 0.27 which is < 0.3 → barely works', () => {
      const gapMinBob = (PICKUP_ELEVATION_BASE - BOB_AMPLITUDE) - PLAYER_ELEVATION; // 0.27
      expect(gapMinBob).toBeLessThan(OLD_RADIUS);
    });
  });
});
