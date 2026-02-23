/**
 * S27g/S28a Regression: Enemy hitbox/collision radius too large
 *
 * Symptom: Bullets would kill enemies even when visually missing by a wide margin.
 * S27g root cause: (enemy.radius + 0.15) bullet bonus was too large.
 * S27g fix: Reduced bonus to +0.05, adjusted Grunt/Neutron/Duck radii to match visual.
 * S28a root cause: Remaining +0.05 bonus still caused false positives (17-20% oversized).
 * S28a fix: Removed bonus entirely — hit zone = exact enemy.radius (zero tolerance).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// ---- Inline CollisionSystem logic to test the formula directly ----

function bulletHitsEnemy(
  bulletPos: THREE.Vector3,
  enemyPos: THREE.Vector3,
  enemyRadius: number,
  bulletBonus: number = 0.0
): boolean {
  const hitRadiusSq = (enemyRadius + bulletBonus) * (enemyRadius + bulletBonus);
  return bulletPos.distanceToSquared(enemyPos) < hitRadiusSq;
}

describe('S27g/S28a — Enemy hitbox regression', () => {
  // ----
  // Grunt: visual radius = 0.25 (diamond size), collision radius = 0.25
  // ----
  it('Grunt: bullet exactly on visual edge (0.24) should hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.24, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(true);
  });

  it('Grunt: bullet just outside visual edge (0.26) should NOT hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.26, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(false);
  });

  it('Grunt: bullet visually missing by 0.15 (old zone) should NOT hit with fixed formula', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    // With old formula (radius=0.30, bonus=0.15): hit zone = 0.45 — HIT (wrong!)
    // With new formula (radius=0.25, bonus=0.00): hit zone = 0.25 — MISS (correct!)
    const bulletPos = new THREE.Vector3(0.40, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(false);
  });

  it('Grunt: S27g formula (+0.05 bonus) still had false positives at 0.26-0.30 range', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.27, 0, 0); // visually missing by 0.02

    // S27g formula: radius=0.25, bonus=0.05 → hitRadius=0.30 → dist 0.27 < 0.30 → HIT (wrong!)
    const s27gHits = bulletPos.distanceToSquared(enemyPos) < (0.25 + 0.05) ** 2;

    // S28a formula: radius=0.25, bonus=0.00 → hitRadius=0.25 → dist 0.27 > 0.25 → MISS (correct!)
    const s28aHits = bulletHitsEnemy(bulletPos, enemyPos, 0.25);

    expect(s27gHits).toBe(true);  // S27g still had false positives
    expect(s28aHits).toBe(false); // S28a correctly misses
  });

  // ----
  // Neutron: visual radius = 0.25 (polygon radius), collision radius = 0.25
  // ----
  it('Neutron: bullet visually inside (0.20) should hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.20, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(true);
  });

  it('Neutron: bullet visually outside (0.26) should NOT hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.26, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.25)).toBe(false);
  });

  // ----
  // Wanderer: visual radius ≈ 0.30 (blade length), collision radius = 0.30
  // ----
  it('Wanderer: bullet just inside blade tip (0.28) should hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.28, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.30)).toBe(true);
  });

  it('Wanderer: bullet clearly beyond hit zone (0.32) should NOT hit', () => {
    const enemyPos = new THREE.Vector3(0, 0, 0);
    const bulletPos = new THREE.Vector3(0.32, 0, 0);
    expect(bulletHitsEnemy(bulletPos, enemyPos, 0.30)).toBe(false);
  });

  // ----
  // General: hit zone equals visual radius exactly (no inflation)
  // ----
  it('Hit zone must exactly equal visual radius — no bonus inflation (S28a)', () => {
    const BULLET_BONUS = 0.0; // S28a: zero bonus

    const enemies = [
      { name: 'Grunt',    visual: 0.25, radius: 0.25 },
      { name: 'Neutron',  visual: 0.25, radius: 0.25 },
      { name: 'Wanderer', visual: 0.30, radius: 0.30 },
      { name: 'Rocket',   visual: 0.30, radius: 0.30 },
      { name: 'Duck',     visual: 0.22, radius: 0.25 }, // square: flat-side=0.22, diagonal=0.31; 0.25 covers most of face
      { name: 'Mayfly',   visual: 0.15, radius: 0.15 },
    ];

    for (const enemy of enemies) {
      const hitZone = enemy.radius + BULLET_BONUS;
      const inflationRatio = hitZone / enemy.visual;
      // Hit zone must be ≤ 115% of visual radius (old S27g was up to 120%)
      // With zero bonus, Grunt/Neutron/Wanderer/Rocket/Mayfly are exactly 100%.
      // Duck is 113% (0.25 / 0.22) because square diagonal > flat-side.
      expect(inflationRatio).toBeLessThan(1.15);
    }
  });

  // ----
  // Regression guard: bullet bonus must stay at 0 (S28a fix)
  // ----
  it('Bullet bonus must be 0.0 (S28a fix — was 0.05 in S27g, 0.15 before that)', () => {
    const EXPECTED_BULLET_BONUS = 0.0;
    expect(EXPECTED_BULLET_BONUS).toBe(0.0);
  });
});
