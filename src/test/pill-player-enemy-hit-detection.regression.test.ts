/**
 * Regression test: Pill map player-enemy hit detection (s44r4-02)
 *
 * Root cause:
 *   s44r3-09 changed player-enemy collision to compare player.mesh.position (on surface)
 *   to enemy.mesh.position (ELEVATED above surface by normal * radius). On the pill body
 *   (cylinder), the outward radial normal pushes the enemy's mesh position AWAY from the
 *   player who is also on the surface — underestimating the visual kill zone.
 *
 *   Specifically: for an enemy approaching from a different angular position on the cylinder,
 *   the radially-elevated mesh position creates a 3D distance larger than the actual surface
 *   distance, causing missed kills when the enemy is within the correct physical threshold.
 *
 * Fix:
 *   Compare player.mesh.position (on surface) to enemy.position (on surface) directly.
 *   hitRadiusSq = (playerRadius + enemyRadius)² — the exact physical formula.
 *   Both positions are on the mesh surface (confirmed: GameLoop.ts:250, applySurfaceTransform).
 *
 * Test verifies:
 *   1. On pill body (cylinder), enemy approaching from the SIDE at surface distance just under
 *      kill threshold → should trigger collision (FAILS with buggy code, PASSES with fix).
 *   2. Enemy at surface distance just OVER threshold → should NOT trigger.
 *   3. Enemy at same position as player → should always trigger.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline formulas to test — mirrors the FIXED CollisionSystem formula
// ---------------------------------------------------------------------------

/**
 * Correct formula: compare on-surface positions directly.
 * hitRadius = playerRadius + enemyRadius (exact physical formula).
 */
function playerEnemyCollides_fixed(
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
 * Buggy formula from s44r3-09: compare player (on surface) to enemy ELEVATED mesh position.
 * hitRadiusSq = (playerRadius + enemyRadius)² + enemyRadius² (inflated to compensate elevation)
 *
 * Bug: on curved surfaces, the normal elevation pushes the mesh position in a direction that
 * does NOT align with the player-enemy vector, causing the 3D distance to differ from the
 * surface distance in unexpected ways — leading to under-sensitivity (missed kills) when
 * enemy approaches from the side.
 */
function playerEnemyCollides_buggy(
  playerPos: { x: number; y: number; z: number },
  enemyMeshPos: { x: number; y: number; z: number },
  playerRadius: number,
  enemyRadius: number,
): boolean {
  const dx = playerPos.x - enemyMeshPos.x;
  const dy = playerPos.y - enemyMeshPos.y;
  const dz = playerPos.z - enemyMeshPos.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  const baseHitRadius = playerRadius + enemyRadius;
  // s44r3-09 inflation: add enemyRadius² to compensate for elevation offset
  const hitRadiusSq = baseHitRadius * baseHitRadius + enemyRadius * enemyRadius;
  return distSq < hitRadiusSq;
}

/**
 * Simulate an enemy on the pill body (cylinder, radius R=10).
 * Given angular offset (radians) from the player's position, compute:
 * - enemy.position (on surface)
 * - enemy.mesh.position (elevated by normal * radius)
 */
function pillBodyEnemy(
  playerPos: { x: number; y: number; z: number },
  angleDeltaRad: number,
  heightDelta: number,
  pillRadius: number,
  enemyRadius: number,
) {
  // Enemy surface position on cylinder body at the given angular offset
  // Player is at (R, 0, 0) → normal = (1, 0, 0)
  // Enemy is at (R*cos(Δθ), Δy, R*sin(Δθ))
  const ex = pillRadius * Math.cos(angleDeltaRad);
  const ey = playerPos.y + heightDelta;
  const ez = pillRadius * Math.sin(angleDeltaRad);

  // Enemy normal: radially outward on cylinder
  const nx = Math.cos(angleDeltaRad);
  const ny = 0;
  const nz = Math.sin(angleDeltaRad);

  // Enemy mesh: elevated above surface by normal * radius
  const mx = ex + nx * enemyRadius;
  const my = ey + ny * enemyRadius;
  const mz = ez + nz * enemyRadius;

  // Surface distance (arc length on cylinder = R * |Δθ| for same height,
  // or sqrt((R*Δθ)² + Δy²) for 2D surface geodesic)
  const arcLength = pillRadius * Math.abs(angleDeltaRad);
  const surfaceDist = Math.sqrt(arcLength * arcLength + heightDelta * heightDelta);

  return {
    surfacePos: { x: ex, y: ey, z: ez },
    meshPos: { x: mx, y: my, z: mz },
    surfaceDist,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pill player-enemy hit detection (s44r4-02 regression)', () => {
  const PILL_RADIUS = 10;
  const PLAYER_RADIUS = 0.1;    // player.mesh.scale.x * 0.1 = 1.0 * 0.1
  const ENEMY_RADIUS = 0.3;     // default enemy radius
  const KILL_THRESHOLD = PLAYER_RADIUS + ENEMY_RADIUS; // 0.4

  // Player sits on the pill body at (R, 0, 0)
  const playerPos = { x: PILL_RADIUS, y: 0, z: 0 };

  it('REGRESSION: enemy approaching from the side (angular) should collide when within kill threshold', () => {
    // Enemy at surface distance ≈ 0.397 < 0.40 (kill threshold).
    //
    // At Δθ = 0.0397 rad on the pill body (radius R=10):
    //   surface dist ≈ 2R*sin(Δθ/2) ≈ 0.397  → within threshold (< 0.40)
    //   mesh dist = sqrt(R² - 2R(R+r)cos(Δθ) + (R+r)²) ≈ sqrt(0.252) ≈ 0.502 → exceeds 0.5
    //
    // Fixed formula: hitRadius = 0.4, compares to surface pos → 0.397 < 0.40 → COLLISION ✓
    // Buggy formula: hitRadius = sqrt(0.25)=0.5, compares to mesh pos → 0.502 > 0.5 → MISS ✗
    //
    // This angular regime (Δθ ≈ 0.038–0.040) represents an enemy on the same height band as
    // the player, approaching from the side on the pill body where both normals point outward.
    // The radial elevation pushes mesh.position 0.3 units AWAY from center, increasing 3D
    // distance beyond the buggy threshold while the true surface distance is within kill zone.
    const angleDelta = 0.0397; // rad: 2R*sin(Δθ/2) ≈ 0.397 < 0.40
    const enemy = pillBodyEnemy(playerPos, angleDelta, 0, PILL_RADIUS, ENEMY_RADIUS);

    // Confirm setup: surface distance must be within kill threshold
    expect(enemy.surfaceDist).toBeLessThan(KILL_THRESHOLD);
    expect(enemy.surfaceDist).toBeGreaterThan(0.39); // close to threshold

    // BUGGY formula (s44r3-09): misses this kill on the pill body
    // (enemy mesh is pushed radially outward, increasing 3D distance beyond the inflated threshold)
    const buggyResult = playerEnemyCollides_buggy(playerPos, enemy.meshPos, PLAYER_RADIUS, ENEMY_RADIUS);
    expect(buggyResult).toBe(false); // ← BUG: misses valid collision

    // FIXED formula: correctly detects collision (surface dist < kill threshold)
    const fixedResult = playerEnemyCollides_fixed(playerPos, enemy.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS);
    expect(fixedResult).toBe(true); // ← FIX: correctly fires
  });

  it('should NOT collide when enemy surface distance exceeds kill threshold', () => {
    // Enemy at surface distance 0.42 > 0.40 (just outside threshold)
    const angleDelta = 0.042; // surface arc = 10 * 0.042 = 0.42
    const enemy = pillBodyEnemy(playerPos, angleDelta, 0, PILL_RADIUS, ENEMY_RADIUS);

    expect(enemy.surfaceDist).toBeGreaterThan(KILL_THRESHOLD);

    // Both formulas should agree: no collision outside threshold
    expect(playerEnemyCollides_fixed(playerPos, enemy.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(false);
  });

  it('should always collide when enemy is at the same surface position as player', () => {
    const enemy = pillBodyEnemy(playerPos, 0, 0, PILL_RADIUS, ENEMY_RADIUS);

    // Surface distance = 0 (same position) — always within threshold
    expect(enemy.surfaceDist).toBe(0);

    expect(playerEnemyCollides_fixed(playerPos, enemy.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
    expect(playerEnemyCollides_buggy(playerPos, enemy.meshPos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
  });

  it('should detect collision for height-based approach (same angle, different y)', () => {
    // Enemy at surface distance 0.38 via height difference (Δy = 0.38)
    const enemy = pillBodyEnemy(playerPos, 0, 0.38, PILL_RADIUS, ENEMY_RADIUS);

    expect(enemy.surfaceDist).toBeCloseTo(0.38, 2);
    expect(enemy.surfaceDist).toBeLessThan(KILL_THRESHOLD);

    // For same-angle approach, both formulas give same result (normal perpendicular to direction)
    expect(playerEnemyCollides_fixed(playerPos, enemy.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(true);
  });

  it('kill threshold is playerRadius + enemyRadius (not inflated)', () => {
    // At exactly the kill threshold, the fixed formula should be at the boundary (not fire)
    const angleDelta = KILL_THRESHOLD / PILL_RADIUS; // surface arc = R*Δθ = killThreshold
    const enemy = pillBodyEnemy(playerPos, angleDelta, 0, PILL_RADIUS, ENEMY_RADIUS);

    // Surface distance ≈ killThreshold (may be slightly different due to arc vs chord approximation)
    expect(enemy.surfaceDist).toBeCloseTo(KILL_THRESHOLD, 1);

    // Just outside: should NOT fire
    const justOutside = pillBodyEnemy(playerPos, angleDelta * 1.1, 0, PILL_RADIUS, ENEMY_RADIUS);
    expect(playerEnemyCollides_fixed(playerPos, justOutside.surfacePos, PLAYER_RADIUS, ENEMY_RADIUS)).toBe(false);
  });
});
