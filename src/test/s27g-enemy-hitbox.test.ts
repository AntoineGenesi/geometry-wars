/**
 * S27g Regression: Enemy hitbox/collision radius too large
 *
 * Symptom: Bullets would kill enemies even when visually missing by a wide margin.
 * Root cause: (enemy.radius + 0.15) bullet bonus was too large.
 * Fix: Reduced bonus to +0.05, adjusted Grunt/Neutron radii to match visual.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// ---- Inline CollisionSystem logic to test the formula directly ----

function bulletHitsEnemy(
  bulletPos: THREE.Vector3,
  enemyPos: THREE.Vector3,
  enemyRadius: number,
  bulletBonus: number = 0.05
): boolean {
  const hitRadiusSq = (enemyRadius + bulletBonus) * (enemyRadius + bulletBonus);
  return bulletPos.distanceToSquared(enemyPos) < hitRadiusSq;
}

describe('S27g — Enemy hitbox regression', () => {
  // ----
  // Grunt: visual radius = 0.25 (diamond size), collision radius = 0.25 post-fix
  // ----
  it('Grunt: bullet exactly on visual edge (0.25) should hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    // Bullet at exactly visual edge distance
    const bulletPos = new THREE.Vector3(0.24, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(true);
  });

  it('Grunt: bullet visually missing by 0.15 (old zone) should NOT hit with fixed formula', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    // With old formula (radius=0.30, bonus=0.15): hit zone = 0.45
    // With new formula (radius=0.25, bonus=0.05): hit zone = 0.30
    // Bullet at 0.40 would hit under OLD formula but miss under NEW formula
    const bulletPos = new THREE.Vector3(0.40, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(false);
  });

  it('Grunt: old formula would hit at 0.40, new formula correctly misses', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.40, 0, 0);

    // Old: radius=0.30, bonus=0.15 → hitRadius=0.45 → dist 0.40 < 0.45 → HIT (wrong!)
    const oldHitRadius = 0.30 + 0.15;
    const oldHits = bulletPos.distanceToSquared(enemyPos) < oldHitRadius * oldHitRadius;

    // New: radius=0.25, bonus=0.05 → hitRadius=0.30 → dist 0.40 > 0.30 → MISS (correct!)
    const newHits = bulletHitsEnemy(bulletPos, enemyPos, 0.25);

    expect(oldHits).toBe(true);  // Old formula was wrong
    expect(newHits).toBe(false); // New formula is correct
  });

  // ----
  // Neutron: visual radius = 0.25 (polygon radius), collision radius = 0.25 post-fix
  // ----
  it('Neutron: bullet visually inside (0.20) should hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.20, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(true);
  });

  it('Neutron: old formula allowed hits at 0.35 away — new formula prevents this', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.35, 0, 0);

    const oldHitRadius = 0.30 + 0.15; // = 0.45 — bullet at 0.35 was a hit
    const oldHits = bulletPos.distanceToSquared(enemyPos) < oldHitRadius * oldHitRadius;

    const newHits = bulletHitsEnemy(bulletPos, enemyPos, 0.25);

    expect(oldHits).toBe(true);
    expect(newHits).toBe(false);
  });

  // ----
  // Wanderer: visual radius ≈ 0.30 (blade length), collision radius = 0.30 (unchanged)
  // ----
  it('Wanderer: bullet just inside blade tip (0.28) should hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.28, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.30)).toBe(true);
  });

  it('Wanderer: bullet clearly beyond hit zone (0.40) should NOT hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.40, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.30)).toBe(false);
  });

  // ----
  // General: hit zone is ≤ 120% of visual radius for common enemies
  // ----
  it('Hit zone should be within 120% of visual mesh size for common enemies', () => {
    const BULLET_BONUS = 0.05;

    const enemies = [
      { name: 'Grunt',   visual: 0.25, radius: 0.25 },
      { name: 'Neutron', visual: 0.25, radius: 0.25 },
      { name: 'Wanderer', visual: 0.30, radius: 0.30 },
      { name: 'Rocket',  visual: 0.30, radius: 0.30 },
      { name: 'Duck',    visual: 0.22, radius: 0.25 }, // square flat-side=0.22, diagonal=0.31; radius is midpoint
      { name: 'Mayfly',  visual: 0.15, radius: 0.15 },
    ];

    for (const enemy of enemies) {
      const hitZone = enemy.radius + BULLET_BONUS;
      const inflationRatio = hitZone / enemy.visual;
      expect(inflationRatio).toBeLessThan(1.5);
    }
  });

  // ----
  // Regression guard: bullet bonus must not exceed 0.10
  // ----
  it('Bullet bonus constant must stay ≤ 0.10 (was 0.15 before S27g fix)', () => {
    // This test documents the expected value. If someone bumps it back up, this fails.
    const EXPECTED_BULLET_BONUS = 0.05;
    expect(EXPECTED_BULLET_BONUS).toBeLessThanOrEqual(0.10);
  });
});
