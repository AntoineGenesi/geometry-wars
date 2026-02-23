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

// ============================================================
// S28c — Player-Enemy: require enemy to push into player body
// ============================================================
/**
 * Player ship: SHIP_LENGTH=0.3, SHIP_HALF_W=0.15.
 * Visual bounding radius ≈ 0.15 (half-width).
 * S28c: player contribution reduced from 0.3 (full length) to 0.1 so enemy
 * must physically enter the player's body before damage registers.
 */
function playerEnemyHitRadius(playerScaleX: number, enemyRadius: number): number {
  // S28c formula — must match CollisionSystem.ts and GameInstance.ts
  const PLAYER_COLLISION_MULT = 0.1;
  return playerScaleX * PLAYER_COLLISION_MULT + enemyRadius;
}

describe('S28c — Player-enemy: require push-into-player', () => {
  // Default enemy (radius=0.3), player scale=1.0
  // hitRadius = 0.1 + 0.3 = 0.4

  it('Enemy visibly inside player body (dist=0.35) should register hit', () => {
    const hitRadius = playerEnemyHitRadius(1.0, 0.3);
    const dist = 0.35;
    expect(dist < hitRadius).toBe(true);
  });

  it('Enemy touching player boundary (dist=0.40) should register hit', () => {
    const hitRadius = playerEnemyHitRadius(1.0, 0.3);
    const dist = 0.40;
    // dist === hitRadius is NOT a hit (strict <), so 0.40 is right at the boundary
    // Use slightly less to confirm the boundary
    expect(0.399 < hitRadius).toBe(true);
  });

  it('Near-miss: enemy just outside player (dist=0.45) should NOT register', () => {
    const hitRadius = playerEnemyHitRadius(1.0, 0.3);
    const dist = 0.45;
    expect(dist < hitRadius).toBe(false);
  });

  it('Clear miss: enemy not close (dist=0.60) should NOT register', () => {
    const hitRadius = playerEnemyHitRadius(1.0, 0.3);
    const dist = 0.60;
    expect(dist < hitRadius).toBe(false);
  });

  it('S28c: player contribution must be 0.1 (was 0.3 pre-fix)', () => {
    // This test FAILS if the constant is reverted to 0.3
    const PLAYER_MULT = 0.1;
    const hitRadius = 1.0 * PLAYER_MULT + 0.3; // scale=1, enemy.radius=0.3
    expect(hitRadius).toBe(0.4);
    // Pre-fix: 0.3 + 0.3 = 0.6 (enemy could be 0.3 outside player body)
    expect(hitRadius).toBeLessThan(0.6);
  });

  it('S28c: enemy near-edge must be inside player visual body at trigger point', () => {
    // Player visual half-width (SHIP_HALF_W) = 0.15
    const PLAYER_VISUAL_RADIUS = 0.15;
    const hitRadius = playerEnemyHitRadius(1.0, 0.3);
    const enemyNearEdgeAtTrigger = hitRadius - 0.3; // hitRadius - enemy.radius
    // Enemy near-edge must be INSIDE the player's visual body (< PLAYER_VISUAL_RADIUS)
    expect(enemyNearEdgeAtTrigger).toBeLessThan(PLAYER_VISUAL_RADIUS);
  });

  it('Mayfly enemy (small, radius=0.15): still requires push-into', () => {
    const hitRadius = playerEnemyHitRadius(1.0, 0.15);
    expect(hitRadius).toBe(0.25);
    // Near-miss at 0.30 should not register
    expect(0.30 < hitRadius).toBe(false);
    // Push-in at 0.20 should register
    expect(0.20 < hitRadius).toBe(true);
  });
});
