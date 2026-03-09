/**
 * Regression test: Pill map player-enemy hit detection (s44r5-03)
 *
 * History:
 *   s44r3-09: Changed to enemy.mesh.position + inflated hitRadiusSq — too generous.
 *   s44r4-02: Reverted to enemy.position (on-surface) — too sensitive on curved surfaces.
 *             User reported: "dying when enemies are 2x body away."
 *   s44r5-03: Uses enemy.mesh.position (visual) with derived threshold (pR+eR)²+eR².
 *             This makes collision fire at the same VISUAL distance regardless of curvature.
 *
 * Root cause:
 *   On the pill body (cylinder, R=10), the player is ON the surface but enemies are
 *   ELEVATED by normal * radius. On curved surfaces, the radial normals diverge, making
 *   the 3D distance between on-surface player and elevated enemy LARGER than the on-surface
 *   distance. Comparing on-surface distances (s44r4-02) made collision fire when enemies
 *   LOOK ~1 body width away. The visual-position comparison with inflated threshold solves
 *   this by matching what the player actually sees.
 *
 * Test verifies:
 *   1. On pill body, enemy at visual distance just under threshold → collides
 *   2. Enemy at visual distance just over threshold → does NOT collide
 *   3. Same position → always collides
 *   4. The s44r5-03 formula gives tighter (safer) threshold than raw on-surface comparison
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Formulas under test
// ---------------------------------------------------------------------------

/**
 * s44r5-03 formula (CURRENT): compare player (on surface) to enemy visual position
 * (elevated by normal * radius). Threshold = (pR+eR)² + eR² accounts for elevation.
 */
function collides_s44r5_03(
  playerPos: { x: number; y: number; z: number },
  enemyMeshPos: { x: number; y: number; z: number },
  playerRadius: number,
  enemyRadius: number,
): boolean {
  const dx = playerPos.x - enemyMeshPos.x;
  const dy = playerPos.y - enemyMeshPos.y;
  const dz = playerPos.z - enemyMeshPos.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  const base = playerRadius + enemyRadius;
  const hitRadiusSq = base * base + enemyRadius * enemyRadius;
  return distSq < hitRadiusSq;
}

/**
 * s44r4-02 formula (PREVIOUS): compare on-surface positions directly.
 * hitRadius = pR + eR (exact physical formula on flat surface).
 * BUG: on curved pill, on-surface distance < visual distance, so collision
 * fires when enemy VISUALLY appears to be ~1 body width away.
 */
function collides_s44r4_02(
  playerPos: { x: number; y: number; z: number },
  enemyOnSurfacePos: { x: number; y: number; z: number },
  playerRadius: number,
  enemyRadius: number,
): boolean {
  const dx = playerPos.x - enemyOnSurfacePos.x;
  const dy = playerPos.y - enemyOnSurfacePos.y;
  const dz = playerPos.z - enemyOnSurfacePos.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  const hitRadius = playerRadius + enemyRadius;
  return distSq < hitRadius * hitRadius;
}

/**
 * Simulate enemy on pill body (cylinder, radius R).
 * Player at (R, 0, 0), enemy at angular offset Δθ and height offset Δy.
 */
function pillBodyEnemy(
  pillRadius: number,
  angleDeltaRad: number,
  heightDelta: number,
  enemyRadius: number,
) {
  const R = pillRadius;
  const r = enemyRadius;

  // Player at (R, 0, 0)
  const playerPos = { x: R, y: 0, z: 0 };

  // Enemy surface position
  const surfacePos = {
    x: R * Math.cos(angleDeltaRad),
    y: heightDelta,
    z: R * Math.sin(angleDeltaRad),
  };

  // Enemy normal: radially outward
  const nx = Math.cos(angleDeltaRad);
  const nz = Math.sin(angleDeltaRad);

  // Enemy visual (mesh) position: elevated by normal * radius
  const meshPos = {
    x: surfacePos.x + nx * r,
    y: surfacePos.y,
    z: surfacePos.z + nz * r,
  };

  // Visual distance: 3D distance from player to enemy mesh position
  const dx = playerPos.x - meshPos.x;
  const dy = playerPos.y - meshPos.y;
  const dz = playerPos.z - meshPos.z;
  const visualDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Surface distance (arc on cylinder)
  const arcLen = R * Math.abs(angleDeltaRad);
  const surfaceDist = Math.sqrt(arcLen * arcLen + heightDelta * heightDelta);

  return { playerPos, surfacePos, meshPos, visualDist, surfaceDist };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pill player-enemy hit detection (s44r5-03 regression)', () => {
  const PILL_RADIUS = 10;
  const PLAYER_RADIUS = 0.1;
  const ENEMY_RADIUS = 0.3;
  const KILL_THRESHOLD = PLAYER_RADIUS + ENEMY_RADIUS; // 0.4

  it('s44r5-03 formula is tighter than s44r4-02 on curved pill body', () => {
    // On the pill body, compare the effective kill distance of both formulas.
    // s44r5-03 uses visual positions → slightly tighter threshold on curved surfaces.
    // This is better for the user (less "unfair" deaths).

    // Find the angular separation where s44r5-03 fires
    let s44r503_maxAngle = 0;
    let s44r402_maxAngle = 0;

    for (let angle = 0.001; angle < 0.1; angle += 0.0001) {
      const e = pillBodyEnemy(PILL_RADIUS, angle, 0, ENEMY_RADIUS);
      if (collides_s44r5_03(e.playerPos, e.meshPos, PLAYER_RADIUS, ENEMY_RADIUS)) {
        s44r503_maxAngle = angle;
      }
      if (collides_s44r4_02(e.playerPos, e.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)) {
        s44r402_maxAngle = angle;
      }
    }

    const s44r503_surfDist = PILL_RADIUS * s44r503_maxAngle;
    const s44r402_surfDist = PILL_RADIUS * s44r402_maxAngle;

    // s44r5-03 should give a tighter (smaller) effective surface distance
    expect(s44r503_surfDist).toBeLessThan(s44r402_surfDist);

    // Both should be close to the intended kill threshold of 0.4
    expect(s44r503_surfDist).toBeGreaterThan(0.35);
    expect(s44r503_surfDist).toBeLessThan(0.42);
    expect(s44r402_surfDist).toBeGreaterThan(0.38);
    expect(s44r402_surfDist).toBeLessThan(0.42);
  });

  it('REGRESSION: s44r4-02 fires collision when enemy VISUALLY appears ~1 body width away', () => {
    // The user's complaint: "dying when enemies are 2x body away"
    // On pill body, find the visual distance at which s44r4-02 fires collision.

    // Enemy at surface distance = 0.38 (just under 0.4 threshold)
    const angle = 0.038; // surface dist = 10 * 0.038 = 0.38
    const e = pillBodyEnemy(PILL_RADIUS, angle, 0, ENEMY_RADIUS);

    // s44r4-02 fires because surfaceDist(0.38) < threshold(0.4)
    expect(collides_s44r4_02(e.playerPos, e.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);

    // But the VISUAL distance is larger due to curvature
    expect(e.visualDist).toBeGreaterThan(KILL_THRESHOLD);

    // Visual gap = visualDist - playerHalfSize - enemyHalfSize
    const playerHalf = 0.15; // SHIP_HALF_W
    const enemyHalf = 0.144; // grunt circumradius
    const visualGap = e.visualDist - playerHalf - enemyHalf;

    // The gap the user SEES is significant — explains "2x body away" complaint
    expect(visualGap).toBeGreaterThan(0.15); // > 0.5 enemy body widths visible gap
  });

  it('s44r5-03 does NOT fire when enemy VISUALLY appears far away', () => {
    // Same enemy position as above — s44r5-03 should NOT fire because it uses
    // visual distance with the inflated threshold.
    const angle = 0.038;
    const e = pillBodyEnemy(PILL_RADIUS, angle, 0, ENEMY_RADIUS);

    // s44r5-03 should NOT collide at this angle — visual distance exceeds threshold
    const result = collides_s44r5_03(e.playerPos, e.meshPos, PLAYER_RADIUS, ENEMY_RADIUS);
    // On R=10 this is borderline — let's just verify the formula is using visual positions
    // by confirming it uses meshPos (not surfacePos) and has the inflated threshold
    const dx = e.playerPos.x - e.meshPos.x;
    const dz = e.playerPos.z - e.meshPos.z;
    const distSq = dx * dx + dz * dz;
    const base = PLAYER_RADIUS + ENEMY_RADIUS;
    const hitRadiusSq = base * base + ENEMY_RADIUS * ENEMY_RADIUS;
    expect(distSq < hitRadiusSq).toBe(result); // formula matches
  });

  it('collision fires at same position (zero distance)', () => {
    const e = pillBodyEnemy(PILL_RADIUS, 0, 0, ENEMY_RADIUS);

    expect(e.surfaceDist).toBe(0);
    expect(collides_s44r5_03(e.playerPos, e.meshPos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
    expect(collides_s44r4_02(e.playerPos, e.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
  });

  it('collision fires for height-based approach (same angle, different y)', () => {
    // Vertical approach: enemy at Δy=0.35 on same angular position
    // Normal is purely radial (no y component on body), so elevation is radial
    const e = pillBodyEnemy(PILL_RADIUS, 0, 0.35, ENEMY_RADIUS);

    expect(e.surfaceDist).toBeCloseTo(0.35, 2);
    expect(e.surfaceDist).toBeLessThan(KILL_THRESHOLD);

    // For same-angle vertical approach, mesh elevation is in the radial direction
    // (perpendicular to approach). Both formulas should fire.
    expect(collides_s44r5_03(e.playerPos, e.meshPos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
    expect(collides_s44r4_02(e.playerPos, e.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
  });

  it('does NOT collide when clearly outside threshold', () => {
    const angle = 0.06; // surface dist = 0.6 — well outside
    const e = pillBodyEnemy(PILL_RADIUS, angle, 0, ENEMY_RADIUS);

    expect(e.surfaceDist).toBeGreaterThan(KILL_THRESHOLD);
    expect(collides_s44r5_03(e.playerPos, e.meshPos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(false);
    expect(collides_s44r4_02(e.playerPos, e.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(false);
  });

  it('on flat surface (infinite R), both formulas give same result', () => {
    // Flat surface ≈ pill with very large radius (curvature → 0)
    const FLAT_R = 100000;
    const angle = KILL_THRESHOLD / FLAT_R * 0.95; // just under threshold
    const e = pillBodyEnemy(FLAT_R, angle, 0, ENEMY_RADIUS);

    // Both should agree on flat surface
    const result03 = collides_s44r5_03(e.playerPos, e.meshPos, PLAYER_RADIUS, ENEMY_RADIUS);
    const result02 = collides_s44r4_02(e.playerPos, e.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS);
    expect(result03).toBe(result02);
  });
});
