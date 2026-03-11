/**
 * Regression test for s44r10-02: Random player death on torus (and all maps).
 *
 * ROOT CAUSE: findValidSpawnPosition() fallback used `maxU if playerU < 0.5` to pick
 * a spawn position "far from player". But ALL surfaces have wrapsU=true (toroidal U axis),
 * so u=1.0 ≡ u=0.0. When playerU=0.05, fallbackU=1.0 has toroidal distance only 0.05 —
 * the enemy spawns RIGHT NEXT TO the player.
 *
 * This was masked at the old MEDIUM cap (60 enemies) because UV saturation was rare.
 * After s44r9-02 raised MEDIUM to 100, saturation became frequent, triggering the fallback
 * often → enemies spawned on top of player → instant death appeared "random".
 *
 * FIX: For wrapping axes (wrapsU/wrapsV=true), use (playerUV + 0.5) % 1.0 — the
 * position exactly opposite the player, maximizing spawn distance.
 */

import { describe, it, expect } from 'vitest';

/**
 * Pure-logic replication of the fallback spawn position logic from EnemySpawner.
 * Tests both the old (buggy) and new (fixed) implementations.
 */
function computeFallbackOld(
  playerU: number, playerV: number,
  minU: number, maxU: number, minV: number, maxV: number,
): { u: number; v: number } {
  // Old (buggy) implementation — ignores toroidal wrapping
  const fallbackU = playerU < 0.5 ? maxU : minU;
  const fallbackV = playerV < 0.5 ? maxV : minV;
  return { u: fallbackU, v: fallbackV };
}

function computeFallbackNew(
  playerU: number, playerV: number,
  minU: number, maxU: number, minV: number, maxV: number,
  wrapsU: boolean, wrapsV: boolean,
): { u: number; v: number } {
  // Fixed implementation — toroidal-safe
  const fallbackU = wrapsU
    ? (playerU + 0.5) % 1.0
    : (playerU < 0.5 ? maxU : minU);
  const fallbackV = wrapsV
    ? (playerV + 0.5) % 1.0
    : (playerV < 0.5 ? maxV : minV);
  return {
    u: Math.min(maxU, Math.max(minU, fallbackU)),
    v: Math.min(maxV, Math.max(minV, fallbackV)),
  };
}

/** Toroidal UV distance (shortest path, wrapping at 1.0). */
function uvDist(u1: number, v1: number, u2: number, v2: number, wrapsU: boolean, wrapsV: boolean): number {
  let du = Math.abs(u1 - u2);
  let dv = Math.abs(v1 - v2);
  if (wrapsU && du > 0.5) du = 1 - du;
  if (wrapsV && dv > 0.5) dv = 1 - dv;
  return Math.sqrt(du * du + dv * dv);
}

const MIN_SPAWN_DISTANCE = 0.25; // matches EnemySpawner constant

describe('EnemySpawner fallback spawn — s44r10-02 regression', () => {
  describe('OLD implementation (demonstrates the bug)', () => {
    it('spawns dangerously close to player near u=0 on all surfaces (wrapsU=true)', () => {
      // Player near u=0 (very common — outer edge of torus, sphere pole regions, etc.)
      const player = { u: 0.05, v: 0.3 };
      const fallback = computeFallbackOld(player.u, player.v, 0, 1, 0, 1);
      // Old: playerU=0.05 < 0.5 → fallbackU = maxU = 1.0
      // Toroidal distance: |1.0 - 0.05| = 0.95, wrapped = 1 - 0.95 = 0.05 → VERY CLOSE!
      const distU = Math.min(Math.abs(fallback.u - player.u), 1 - Math.abs(fallback.u - player.u));
      expect(distU).toBeLessThan(MIN_SPAWN_DISTANCE); // Bug: fallback too close in U
    });

    it('spawns dangerously close to player near u=1 on all surfaces', () => {
      const player = { u: 0.95, v: 0.5 };
      const fallback = computeFallbackOld(player.u, player.v, 0, 1, 0, 1);
      // Old: playerU=0.95 >= 0.5 → fallbackU = minU = 0.0
      // Toroidal distance: |0.0 - 0.95| = 0.95, wrapped = 0.05 → VERY CLOSE!
      const distU = Math.min(Math.abs(fallback.u - player.u), 1 - Math.abs(fallback.u - player.u));
      expect(distU).toBeLessThan(MIN_SPAWN_DISTANCE); // Bug confirmed
    });

    it('on torus (wrapsV also true), both axes can produce dangerous fallback positions', () => {
      const player = { u: 0.05, v: 0.05 };
      const fallback = computeFallbackOld(player.u, player.v, 0, 1, 0, 1);
      // Both U and V axes wrap on torus. U: 0.05 → fallbackU=1.0 → dist=0.05. Bad.
      // V: 0.05 → fallbackV=1.0 → dist=0.05. Bad.
      const dist = uvDist(player.u, player.v, fallback.u, fallback.v, true, true);
      expect(dist).toBeLessThan(MIN_SPAWN_DISTANCE); // Both axes combine to tiny distance
    });
  });

  describe('NEW implementation (fix verified)', () => {
    it('player near u=0: fallback is 0.5 away in U (opposite side)', () => {
      const player = { u: 0.05, v: 0.3 };
      const fallback = computeFallbackNew(player.u, player.v, 0, 1, 0, 1, true, false);
      // Fixed: wrapsU=true → fallbackU = (0.05 + 0.5) % 1.0 = 0.55
      expect(fallback.u).toBeCloseTo(0.55);
      const dist = uvDist(player.u, player.v, fallback.u, fallback.v, true, false);
      expect(dist).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
    });

    it('player near u=1: fallback is 0.5 away in U (toroidal opposite)', () => {
      const player = { u: 0.95, v: 0.5 };
      const fallback = computeFallbackNew(player.u, player.v, 0, 1, 0, 1, true, false);
      // Fixed: wrapsU=true → fallbackU = (0.95 + 0.5) % 1.0 = 0.45
      expect(fallback.u).toBeCloseTo(0.45);
      const dist = uvDist(player.u, player.v, fallback.u, fallback.v, true, false);
      expect(dist).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
    });

    it('torus (wrapsU and wrapsV): fallback 0.5 away in BOTH dimensions', () => {
      const player = { u: 0.05, v: 0.05 };
      const fallback = computeFallbackNew(player.u, player.v, 0, 1, 0, 1, true, true);
      // wrapsU: (0.05 + 0.5) % 1.0 = 0.55, wrapsV: (0.05 + 0.5) % 1.0 = 0.55
      expect(fallback.u).toBeCloseTo(0.55);
      expect(fallback.v).toBeCloseTo(0.55);
      const dist = uvDist(player.u, player.v, fallback.u, fallback.v, true, true);
      // Distance = sqrt(0.5² + 0.5²) ≈ 0.707 — maximum possible on torus
      expect(dist).toBeGreaterThanOrEqual(0.7);
    });

    it('any player position: fallback is always >= MIN_SPAWN_DISTANCE away', () => {
      // Test many player positions (including edge cases near 0 and 1)
      const positions = [
        { u: 0.0, v: 0.0 }, { u: 0.01, v: 0.01 }, { u: 0.05, v: 0.05 },
        { u: 0.1, v: 0.1 }, { u: 0.25, v: 0.25 }, { u: 0.5, v: 0.5 },
        { u: 0.75, v: 0.75 }, { u: 0.9, v: 0.9 }, { u: 0.95, v: 0.95 },
        { u: 0.99, v: 0.99 }, { u: 1.0, v: 1.0 },
        // Mixed positions
        { u: 0.0, v: 0.5 }, { u: 0.5, v: 0.0 }, { u: 0.99, v: 0.01 },
      ];

      for (const player of positions) {
        // All surfaces (wrapsU=true, wrapsV=false): sphere, pill, cube-ring, etc.
        const fallbackNonTorus = computeFallbackNew(player.u, player.v, 0, 1, 0, 1, true, false);
        const distNonTorus = uvDist(player.u, player.v, fallbackNonTorus.u, fallbackNonTorus.v, true, false);
        expect(distNonTorus).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);

        // Torus (wrapsU=true, wrapsV=true)
        const fallbackTorus = computeFallbackNew(player.u, player.v, 0, 1, 0, 1, true, true);
        const distTorus = uvDist(player.u, player.v, fallbackTorus.u, fallbackTorus.v, true, true);
        expect(distTorus).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
      }
    });

    it('non-wrapping V axis: fallback uses edge-of-region logic (original behavior)', () => {
      // For surfaces where V doesn't wrap (sphere, pill), preserve original fallback
      const player = { u: 0.3, v: 0.1 };
      const fallback = computeFallbackNew(player.u, player.v, 0, 1, 0, 1, true, false);
      // wrapsV=false → fallbackV = maxV = 1.0 (original edge logic)
      expect(fallback.v).toBe(1.0);
    });

    it('respects custom wave regions', () => {
      // Custom wave region: only top-right quadrant
      const player = { u: 0.6, v: 0.6 };
      const fallback = computeFallbackNew(player.u, player.v, 0.5, 1.0, 0.5, 1.0, true, true);
      // Fallback: u=(0.6+0.5)%1=0.1, v=(0.6+0.5)%1=0.1 → clamped to [0.5, 1.0]
      expect(fallback.u).toBe(0.5); // clamped to minU
      expect(fallback.v).toBe(0.5); // clamped to minV
    });
  });
});
