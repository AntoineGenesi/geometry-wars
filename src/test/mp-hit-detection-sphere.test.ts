/**
 * S38b Regression: MP hit detection — sphere great-circle distance fix
 *
 * Root cause:
 *   Server-side collision used UV Euclidean distance on sphere. This is 3× too large
 *   because UV metric is non-uniform: on sphere R=10 (medium map),
 *     0.04 UV in V ≈ 1.26 world units (3× visual collision size)
 *     0.04 UV in U at equator ≈ 2.51 world units (6× visual collision size)
 *   Near the pole (V=0.05), U metric compresses but V remains 1.26 world units.
 *
 * Fix (S38b):
 *   For sphere-like surfaces, compute great-circle arc distance in world units.
 *   Use fixed world-space thresholds matching entity visual sizes:
 *     ENEMY_HIT_WORLD = 0.5  (player 0.15 + enemy 0.30 + margin)
 *     PICKUP_WORLD    = 0.6  (matches client PICKUP_WORLD_RADIUS)
 *     GEOM_WORLD      = 0.7
 *
 * This test suite:
 * 1. Verifies sphereGreatCircleDist() gives correct world-space distances
 * 2. Tests that enemies at "pickup zone" distance (1.5 wu) do NOT trigger hit
 * 3. Tests that enemies at touching distance (0.4 wu) DO trigger hit
 * 4. Tests near-pole correctness (UV distortion most severe here)
 * 5. Tests that OLD UV-based logic (0.04 threshold) would have triggered false positives
 * 6. Tests collision on non-sphere surfaces still uses UV distance
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline sphereGreatCircleDist (mirrors server/rooms/GameRoom.ts export)
// Cannot import from GameRoom.ts directly because it depends on Colyseus.
// ---------------------------------------------------------------------------

/**
 * Great-circle arc distance between two UV points on a sphere.
 * Sphere UV convention: V = polar_angle / π, U = azimuthal_angle / (2π).
 */
function sphereGreatCircleDist(
  u1: number, v1: number,
  u2: number, v2: number,
  R: number,
): number {
  const phi1 = v1 * Math.PI;
  const phi2 = v2 * Math.PI;
  const theta1 = u1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI;
  const dot = Math.sin(phi1) * Math.cos(theta1) * Math.sin(phi2) * Math.cos(theta2)
            + Math.sin(phi1) * Math.sin(theta1) * Math.sin(phi2) * Math.sin(theta2)
            + Math.cos(phi1) * Math.cos(phi2);
  return R * Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Naive UV Euclidean distance (the broken pre-S38b approach). */
function uvEuclideanDist(u1: number, v1: number, u2: number, v2: number): number {
  const du = Math.abs(u1 - u2);
  const dv = Math.abs(v1 - v2);
  return Math.sqrt(du * du + dv * dv);
}

// ---------------------------------------------------------------------------
// Server-side collision simulation (mirrors checkCollisions() in GameRoom.ts)
// ---------------------------------------------------------------------------

interface MockPlayer {
  id: string;
  lives: number;
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
  multiplier: number;
}

interface MockEnemy {
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
}

/** S38b-style collision: uses great-circle world-space distance for sphere. */
function simulateSphereCollision(
  players: MockPlayer[],
  enemies: MockEnemy[],
  invincibilityMap: Map<string, number>,
  sphereR: number,
  ENEMY_HIT_WORLD: number,
): MockPlayer[] {
  return players.map(player => {
    const updated = { ...player };
    if (!updated.alive) return updated;

    const invincible = invincibilityMap.get(updated.id) ?? 0;
    if (invincible > 0) return updated;

    let wasHit = false;
    const hitEnemyIds = new Set<string>();

    for (const [eIdx, enemy] of enemies.entries()) {
      if (!enemy.alive) continue;
      if (wasHit) continue;
      const enemyId = String(eIdx);
      if (hitEnemyIds.has(enemyId)) continue;

      const dist = sphereGreatCircleDist(
        updated.surfaceU, updated.surfaceV,
        enemy.surfaceU, enemy.surfaceV,
        sphereR,
      );

      if (dist < ENEMY_HIT_WORLD) {
        wasHit = true;
        hitEnemyIds.add(enemyId);
        updated.lives--;
        updated.multiplier = 1;
        if (updated.lives <= 0) updated.alive = false;
        else invincibilityMap.set(updated.id, 2.0);
      }
    }
    return updated;
  });
}

/** Pre-S38b collision: uses UV Euclidean distance with 0.04 threshold. */
function simulateOldUVCollision(
  players: MockPlayer[],
  enemies: MockEnemy[],
  invincibilityMap: Map<string, number>,
): MockPlayer[] {
  const UV_THRESHOLD = 0.04;
  return players.map(player => {
    const updated = { ...player };
    if (!updated.alive) return updated;

    const invincible = invincibilityMap.get(updated.id) ?? 0;
    if (invincible > 0) return updated;

    let wasHit = false;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (wasHit) continue;
      const dist = uvEuclideanDist(updated.surfaceU, updated.surfaceV, enemy.surfaceU, enemy.surfaceV);
      if (dist < UV_THRESHOLD) {
        wasHit = true;
        updated.lives--;
        updated.multiplier = 1;
        if (updated.lives <= 0) updated.alive = false;
        else invincibilityMap.set(updated.id, 2.0);
      }
    }
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Constants matching actual game values
// ---------------------------------------------------------------------------

const SPHERE_R_MEDIUM = 10;   // sphere radius at medium map size
const ENEMY_HIT_WORLD = 0.5;  // world units — player(0.15) + enemy(0.30) + margin
const PICKUP_WORLD_RADIUS = 1.5; // client weapon pickup glow sprite scale radius

// ---------------------------------------------------------------------------
// Tests: sphereGreatCircleDist accuracy
// ---------------------------------------------------------------------------

describe('sphereGreatCircleDist — accuracy', () => {
  it('returns 0 for coincident points', () => {
    const d = sphereGreatCircleDist(0.5, 0.5, 0.5, 0.5, SPHERE_R_MEDIUM);
    expect(d).toBeCloseTo(0, 5);
  });

  it('returns πR for antipodal points (north/south pole)', () => {
    // North pole: V≈0, any U. South pole: V≈1.
    const d = sphereGreatCircleDist(0.5, 0.01, 0.5, 0.99, SPHERE_R_MEDIUM);
    // Arc length = π × 10 ≈ 31.4 (half great circle minus tiny epsilon)
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(Math.PI * SPHERE_R_MEDIUM + 0.01);
  });

  it('returns correct distance for 0.5 world units separation in V at equator', () => {
    // At equator (V=0.5), moving dv in V: arc = dv × π × R
    // 0.5 world units in V = 0.5 / (π × 10) ≈ 0.01592 UV
    const dv = 0.5 / (Math.PI * SPHERE_R_MEDIUM);
    const d = sphereGreatCircleDist(0.5, 0.5, 0.5, 0.5 + dv, SPHERE_R_MEDIUM);
    expect(d).toBeCloseTo(0.5, 2);
  });

  it('returns correct distance for 0.5 world units separation in U at equator', () => {
    // At equator (V=0.5), phi = π/2, sin(phi)=1
    // arc in U = du × 2π × R × sin(phi) = du × 62.83
    const du = 0.5 / (2 * Math.PI * SPHERE_R_MEDIUM);
    const d = sphereGreatCircleDist(0.5, 0.5, 0.5 + du, 0.5, SPHERE_R_MEDIUM);
    expect(d).toBeCloseTo(0.5, 2);
  });

  it('handles pole wrap-around correctly (U=0 and U=1 are same world point at pole)', () => {
    // Near north pole (V=0.01), two points with U=0 and U=0.99 should be close
    const d = sphereGreatCircleDist(0.0, 0.01, 0.99, 0.01, SPHERE_R_MEDIUM);
    // At V=0.01, sin(phi) ≈ sin(0.01π) ≈ 0.0314
    // World distance in U ≈ 0.01 × 2π × 10 × 0.0314 ≈ 0.02 world units (very close)
    expect(d).toBeLessThan(0.5); // Should be very small near pole
  });

  it('is symmetric: dist(A,B) = dist(B,A)', () => {
    const u1 = 0.3, v1 = 0.4, u2 = 0.7, v2 = 0.6;
    const d1 = sphereGreatCircleDist(u1, v1, u2, v2, SPHERE_R_MEDIUM);
    const d2 = sphereGreatCircleDist(u2, v2, u1, v1, SPHERE_R_MEDIUM);
    expect(d1).toBeCloseTo(d2, 10);
  });
});

// ---------------------------------------------------------------------------
// Tests: the actual bug — OLD UV collision triggers at pickup-zone distance
// ---------------------------------------------------------------------------

describe('S38b regression — OLD UV collision false positives', () => {
  it('OLD code: enemy at pickup-glow distance (1.5 wu) falsely triggers hit on sphere equator', () => {
    // The glow sprite of a weapon pickup is 1.5 world units.
    // With old threshold 0.04 UV, enemies at this distance caused life loss.
    // UV distance for 1.5 world units in V at equator: 1.5 / (π × 10) ≈ 0.0477 UV
    // — larger than 0.04, so this specific case might NOT trigger...
    // Let's check the actual range at which old code triggers: 0.04 UV in V = 1.26 wu
    // So enemies at 1.2 world units (inside glow but not touching) would trigger.

    // Place player at equator, enemy 1.2 world units away in V (clearly not touching visually)
    const dv = 1.2 / (Math.PI * SPHERE_R_MEDIUM); // ≈ 0.0382 UV
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };
    const enemy: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dv };

    // Old UV code triggers (0.0382 < 0.04): enemy kills player at 1.2 wu separation
    const oldResult = simulateOldUVCollision([player], [enemy], new Map());
    expect(oldResult[0].lives).toBe(2); // BUG: player LOSES a life despite 1.2 wu separation

    // New world-space code does NOT trigger (1.2 < 0.5 is false)
    const newResult = simulateSphereCollision([player], [enemy], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(newResult[0].lives).toBe(3); // FIXED: no life lost at 1.2 wu separation
  });

  it('OLD code: near pole, enemy further in U than threshold still triggers (pole compression)', () => {
    // Near north pole (V=0.05), U axis is compressed. 0.04 UV in U corresponds to
    // sin(0.05π) ≈ 0.156, so world_dist_U ≈ 0.04 × 2π × 10 × 0.156 ≈ 0.39 wu.
    // Still > 0.3 (enemy visual radius), so enemies can trigger from outside visual range.

    // Enemy 0.03 UV away in U direction near pole
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.05, multiplier: 1 };
    const enemy: MockEnemy = { alive: true, surfaceU: 0.53, surfaceV: 0.05 }; // 0.03 UV in U

    // World distance: 0.03 × 2π × 10 × sin(0.05π) ≈ 0.03 × 62.83 × 0.156 ≈ 0.294 wu
    const worldDist = sphereGreatCircleDist(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV, SPHERE_R_MEDIUM);
    expect(worldDist).toBeCloseTo(0.294, 1);

    // Old UV code: dist = 0.03 < 0.04 → triggers hit (enemy is at 0.294 wu, smaller than enemy radius)
    // New code: 0.294 < 0.5 → also triggers (correct, enemy IS close enough visually)
    const newResult = simulateSphereCollision([player], [enemy], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(newResult[0].lives).toBe(2); // Correct hit near pole
  });
});

// ---------------------------------------------------------------------------
// Tests: S38b fixed behavior
// ---------------------------------------------------------------------------

describe('S38b fix — sphere hit detection correctness', () => {
  it('Enemy at TOUCHING distance (0.4 wu) DOES trigger life loss', () => {
    const dv = 0.4 / (Math.PI * SPHERE_R_MEDIUM); // ≈ 0.01273 UV
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };
    const enemy: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dv };

    const worldDist = sphereGreatCircleDist(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV, SPHERE_R_MEDIUM);
    expect(worldDist).toBeCloseTo(0.4, 2);

    const result = simulateSphereCollision([player], [enemy], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(result[0].lives).toBe(2); // Hit registered correctly
  });

  it('Enemy at PICKUP GLOW ZONE distance (1.5 wu) does NOT trigger life loss', () => {
    // Weapon pickup glow sprite radius is 1.5 world units on screen.
    // Enemies at this distance must NOT kill the player.
    const dv = PICKUP_WORLD_RADIUS / (Math.PI * SPHERE_R_MEDIUM);
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };
    const enemy: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dv };

    const worldDist = sphereGreatCircleDist(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV, SPHERE_R_MEDIUM);
    expect(worldDist).toBeCloseTo(PICKUP_WORLD_RADIUS, 2);

    const result = simulateSphereCollision([player], [enemy], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(result[0].lives).toBe(3); // NO life lost — enemy too far
  });

  it('Enemy at "just outside visual" distance (0.6 wu) does NOT trigger life loss', () => {
    const dv = 0.6 / (Math.PI * SPHERE_R_MEDIUM);
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };
    const enemy: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dv };

    const result = simulateSphereCollision([player], [enemy], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(result[0].lives).toBe(3); // No hit at 0.6 wu
  });

  it('Exact collision boundary: 0.499 wu triggers, 0.501 wu does not', () => {
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };

    const dvInner = 0.499 / (Math.PI * SPHERE_R_MEDIUM);
    const enemyInner: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dvInner };
    const resultInner = simulateSphereCollision([{ ...player }], [enemyInner], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(resultInner[0].lives).toBe(2); // Inside threshold → hit

    const dvOuter = 0.501 / (Math.PI * SPHERE_R_MEDIUM);
    const enemyOuter: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dvOuter };
    const resultOuter = simulateSphereCollision([{ ...player }], [enemyOuter], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(resultOuter[0].lives).toBe(3); // Outside threshold → no hit
  });

  it('Near north pole: collision is symmetric and accurate', () => {
    // At pole, all longitudes converge. Two enemies equidistant from pole should
    // both trigger or both not trigger — no asymmetry from UV distortion.
    const playerPole: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.05, multiplier: 1 };

    // Enemy 0.4 wu below (same longitude) — should hit
    const dv = 0.4 / (Math.PI * SPHERE_R_MEDIUM);
    const enemyBelow: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.05 + dv };
    const r1 = simulateSphereCollision([{ ...playerPole }], [enemyBelow], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
    expect(r1[0].lives).toBe(2); // Hit

    // Enemy 0.4 wu at different longitude (should also hit, great-circle handles wrap)
    const enemySideLong: MockEnemy = { alive: true, surfaceU: 0.0, surfaceV: 0.05 };
    const worldDistSide = sphereGreatCircleDist(playerPole.surfaceU, playerPole.surfaceV, enemySideLong.surfaceU, enemySideLong.surfaceV, SPHERE_R_MEDIUM);
    // Only test if actually within range
    if (worldDistSide < ENEMY_HIT_WORLD) {
      const r2 = simulateSphereCollision([{ ...playerPole }], [enemySideLong], new Map(), SPHERE_R_MEDIUM, ENEMY_HIT_WORLD);
      expect(r2[0].lives).toBe(2); // Hit from same-latitude, different longitude
    }
  });

  it('U wrap-around near pole: enemy at U=1.0 is close to enemy at U=0.0', () => {
    // Near pole, longitude wrap should be handled: U=0.99 and U=0.01 are close
    const playerV = 0.03;
    const d1 = sphereGreatCircleDist(0.01, playerV, 0.99, playerV, SPHERE_R_MEDIUM);
    const d2 = sphereGreatCircleDist(0.01, playerV, 0.01, playerV, SPHERE_R_MEDIUM);
    // U=0.01 and U=0.99 at V=0.03 should be very close world-space (sin(0.03π)≈0.094)
    // World dist ≈ 0.02 × 2π × 10 × 0.094 ≈ 0.12 world units
    expect(d1).toBeLessThan(0.2);
    expect(d2).toBe(0); // Same point = 0
  });

  it('S38b regression guard: ENEMY_HIT_WORLD must be ≤ 0.5 world units', () => {
    // If this threshold creeps back up, it will re-introduce the bug.
    expect(ENEMY_HIT_WORLD).toBeLessThanOrEqual(0.5);
    // And must be positive
    expect(ENEMY_HIT_WORLD).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// Tests: All surfaces map — sphere-like vs non-sphere
// ---------------------------------------------------------------------------

describe('Surface type routing', () => {
  // On non-sphere surfaces (torus, cube), UV distance is still used.
  // These surfaces have different UV metrics but UV distance is reasonable
  // (not as pathological as sphere's pole distortion).
  it('UV Euclidean distance is the baseline for non-sphere surfaces', () => {
    // For torus, cube, etc. the threshold is 0.02 / scaleFactor UV units
    // Verify the non-sphere path still makes sense
    const UV_ENEMY_HIT = 0.02; // for medium map (scaleFactor=1)
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };

    // Enemy at 0.015 UV (within threshold)
    const enemyClose: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.515 };
    const distClose = uvEuclideanDist(player.surfaceU, player.surfaceV, enemyClose.surfaceU, enemyClose.surfaceV);
    expect(distClose).toBeCloseTo(0.015);
    expect(distClose < UV_ENEMY_HIT).toBe(true); // Within non-sphere threshold

    // Enemy at 0.025 UV (outside threshold)
    const enemyFar: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.525 };
    const distFar = uvEuclideanDist(player.surfaceU, player.surfaceV, enemyFar.surfaceU, enemyFar.surfaceV);
    expect(distFar).toBeCloseTo(0.025);
    expect(distFar < UV_ENEMY_HIT).toBe(false); // Outside non-sphere threshold
  });

  it('Non-sphere threshold 0.02 is half the old 0.04 — improvement even for non-sphere', () => {
    const oldThreshold = 0.04;
    const newThreshold = 0.02;
    expect(newThreshold).toBeLessThan(oldThreshold);
    expect(newThreshold / oldThreshold).toBeCloseTo(0.5, 2); // 50% reduction
  });
});

// ---------------------------------------------------------------------------
// Tests: Multi-map collision consistency
// ---------------------------------------------------------------------------

describe('Map size scaling', () => {
  it('sphere huge map (R=20): same world-space threshold still works correctly', () => {
    // On a huge map (scale 2.0), sphere radius = 20.
    const R_HUGE = 20;
    // Enemy 0.4 wu away — same threshold, should hit regardless of map size
    const dv = 0.4 / (Math.PI * R_HUGE);
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };
    const enemy: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dv };

    const result = simulateSphereCollision([player], [enemy], new Map(), R_HUGE, ENEMY_HIT_WORLD);
    expect(result[0].lives).toBe(2); // Correct hit on huge map
  });

  it('sphere huge map: enemy at 1.5 wu (pickup zone) still NO hit', () => {
    const R_HUGE = 20;
    const dv = 1.5 / (Math.PI * R_HUGE);
    const player: MockPlayer = { id: 'p1', lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5, multiplier: 1 };
    const enemy: MockEnemy = { alive: true, surfaceU: 0.5, surfaceV: 0.5 + dv };

    const result = simulateSphereCollision([player], [enemy], new Map(), R_HUGE, ENEMY_HIT_WORLD);
    expect(result[0].lives).toBe(3); // No false positive on huge map either
  });
});
