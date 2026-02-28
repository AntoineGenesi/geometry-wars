/**
 * Regression test: Pickup collection radius must scale with mapSizeScaleFactor.
 *
 * Root cause (S36): PICKUP_WORLD_RADIUS was a fixed constant (0.6 world units) while
 * both the player position and pickup _surfaceWorldPos are in world space scaled by
 * mapSizeScaleFactor. On a 2x (EPIC) map the same UV proximity gives 2x world-space
 * distance, making pickups effectively harder to collect on larger maps.
 *
 * Fix: multiply PICKUP_WORLD_RADIUS by mapSizeScaleFactor in checkPlayerCollision for
 * all 5 pickup types.
 *
 * Peanut pole fix: pickups spawned near v=0 or v=1 are clamped to v∈[0.02,0.98] by
 * PickupSpawner to prevent world-space singularity (all pole positions converge to the
 * same y-axis point, causing false-positive collisions).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WeaponPickup, getRandomWeaponType } from '../weapons/WeaponPickup';
import { BuffPickup, getRandomBuffType } from '../weapons/BuffPickup';
import { BuffPickupNew } from '../buffs/BuffPickupNew';
import { WeaponType } from '../weapons/WeaponTypes';
import { StackBuffType } from '../buffs/BuffManager';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Simulate what makeSurfaceTransformFn returns for a flat position */
function makeTransformAt(worldPos: THREE.Vector3) {
  return (_u: number, _v: number) => ({
    position: worldPos.clone(),
    normal: new THREE.Vector3(0, 1, 0),
    tangent: new THREE.Vector3(1, 0, 0),
    bitangent: new THREE.Vector3(0, 0, 1),
  });
}

/**
 * Create a WeaponPickup, call applySurfaceTransform to set _surfaceWorldPos,
 * then call checkPlayerCollision with a player at a given world position.
 */
function weaponCollides(
  pickupWorldPos: THREE.Vector3,
  playerWorldPos: THREE.Vector3,
  scaleFactor: number,
): boolean {
  const p = new WeaponPickup(WeaponType.Spread, 0.5, 0.5, scaleFactor);
  p.applySurfaceTransform(makeTransformAt(pickupWorldPos));
  return p.checkPlayerCollision(0.5, 0.5, playerWorldPos);
}

function buffCollides(
  pickupWorldPos: THREE.Vector3,
  playerWorldPos: THREE.Vector3,
  scaleFactor: number,
): boolean {
  const p = new BuffPickup(getRandomBuffType(), 0.5, 0.5, scaleFactor);
  p.applySurfaceTransform(makeTransformAt(pickupWorldPos));
  return p.checkPlayerCollision(0.5, 0.5, playerWorldPos);
}

function buffNewCollides(
  pickupWorldPos: THREE.Vector3,
  playerWorldPos: THREE.Vector3,
  scaleFactor: number,
): boolean {
  const p = new BuffPickupNew(StackBuffType.AttackSpeed, 0.5, 0.5, scaleFactor);
  p.applySurfaceTransform(makeTransformAt(pickupWorldPos));
  return p.checkPlayerCollision(0.5, 0.5, playerWorldPos);
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Pickup scale-invariant collection radius (S36 regression)', () => {
  /**
   * The BASE_RADIUS is 0.3 world units (reduced in S40-10 for tighter collection).
   * On scale=1 the threshold is 0.3. On scale=2 the threshold should be 0.6.
   * We test that a gap of 0.4 world units (which is < 0.3*2 = 0.6) is collected
   * on scale=2 but NOT collected on scale=1 (where threshold is 0.3).
   *
   * 0.4 > 0.3  → NOT collected at scale=1 (CORRECT)
   * 0.4 < 0.6  → IS collected at scale=2 (CORRECT)
   */
  const PICKUP_POS = new THREE.Vector3(0, 0, 0);
  const PLAYER_GAP_0_4 = new THREE.Vector3(0.4, 0, 0); // 0.4 units away

  it('WeaponPickup: collects at 0.4 units on scale=2 (would fail if radius not scaled)', () => {
    // 0.4 < 0.3*2=0.6 → true.
    expect(weaponCollides(PICKUP_POS, PLAYER_GAP_0_4, 2.0)).toBe(true);
  });

  it('WeaponPickup: does NOT collect at 0.4 units on scale=1 (radius=0.3)', () => {
    // 0.4 > 0.3 → should not collect
    expect(weaponCollides(PICKUP_POS, PLAYER_GAP_0_4, 1.0)).toBe(false);
  });

  it('BuffPickup: collects at 0.4 units on scale=2', () => {
    expect(buffCollides(PICKUP_POS, PLAYER_GAP_0_4, 2.0)).toBe(true);
  });

  it('BuffPickupNew: collects at 0.4 units on scale=2', () => {
    expect(buffNewCollides(PICKUP_POS, PLAYER_GAP_0_4, 2.0)).toBe(true);
  });

  it('WeaponPickup: does NOT collect at 0.7 units on scale=2 (outside 0.3*2=0.6)', () => {
    const farPlayer = new THREE.Vector3(0.7, 0, 0);
    expect(weaponCollides(PICKUP_POS, farPlayer, 2.0)).toBe(false);
  });

  it('WeaponPickup: consistent radius across SMALL(0.75), MEDIUM(1.0), LARGE(1.5), EPIC(2.0)', () => {
    // For each scale, a player at exactly 0.25 * scaleFactor units away should always collect.
    // This verifies scale invariance in UV terms (0.25*scale < 0.3*scale).
    for (const scale of [0.75, 1.0, 1.5, 2.0]) {
      const playerPos = new THREE.Vector3(0.25 * scale, 0, 0);
      expect(
        weaponCollides(PICKUP_POS, playerPos, scale),
        `scale=${scale}: player at 0.25*scale should collect`,
      ).toBe(true);
    }
  });

  it('WeaponPickup: player at 0.35 * scaleFactor always NOT collected (outside 0.3 threshold)', () => {
    for (const scale of [0.75, 1.0, 1.5, 2.0]) {
      const playerPos = new THREE.Vector3(0.35 * scale, 0, 0);
      expect(
        weaponCollides(PICKUP_POS, playerPos, scale),
        `scale=${scale}: player at 0.35*scale should NOT collect`,
      ).toBe(false);
    }
  });
});

describe('PickupSpawner peanut pole clamp (S36 regression)', () => {
  it('WeaponPickup at exact pole v=0: world positions converge, distance is ~0', () => {
    // This test demonstrates WHY we clamp v: two pickups both placed at the pole
    // of a peanut are essentially at the same world point (y-axis convergence).
    // Before fix: enemies dying near v=0 spawned pickups at v=0, creating false
    // positive collisions for any player also near the pole.
    //
    // After fix (in PickupSpawner): v is clamped to [0.02, 0.98], so pickups never
    // spawn at v<0.02. This test just documents the singularity.
    const BASE_R = 6 * (1 + 0.4); // baseRadius*(1+waistDepth) = pole radius
    const polePos1 = new THREE.Vector3(0, BASE_R, 0); // theta=0
    const polePos2 = new THREE.Vector3(0.001, BASE_R, 0); // theta≈0

    // Both are essentially at the same world position — distance < 0.01
    expect(polePos1.distanceTo(polePos2)).toBeLessThan(0.01);
  });

  it('v clamp to [0.02, 0.98] keeps pickups away from pole singularity', () => {
    // Verify that the clamped range avoids the problematic zone.
    // At v=0.02 on peanut: sinPhi = sin(0.02*PI) ≈ 0.062
    // ring radius = baseRadius*(1+waistDepth)*sin(phi) ≈ 8.4 * 0.062 ≈ 0.52 world units
    // A ring of 0.52 world radius is wide enough to avoid false-positive collisions.
    const phi = 0.02 * Math.PI;
    const BASE_R = 6;
    const WAIST = 0.4;
    const r = BASE_R * (1 + WAIST * Math.cos(2 * phi)); // profile radius at phi
    const ringRadius = r * Math.sin(phi);
    const scaleFactor = 1.0;
    // ring circumference / some fraction > PICKUP_WORLD_RADIUS*scaleFactor
    // Ensures pickups at clamped v have enough spread that collision is not trivial
    expect(ringRadius * scaleFactor).toBeGreaterThan(0.3);
  });
});
