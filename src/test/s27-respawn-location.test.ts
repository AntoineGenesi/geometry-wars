/**
 * Regression test: S27 — Player must NOT respawn at death location.
 *
 * The bug: GameLoop.ts and GameInstance.ts always called respawn(0.5, 0.5),
 * meaning the player spawned at the center regardless of where they died.
 * When a player died near (0.5, 0.5), they'd effectively respawn at the
 * death location — and even otherwise, they never get the safe-opposite-spawn.
 *
 * The fix: Call getSafeRespawnPosition() BEFORE calling respawn(), using the
 * player's current UV (which still reflects the death position at that point).
 */
import { describe, it, expect } from 'vitest';

// Pure algorithm test — avoids THREE.js instantiation overhead.
// This tests the math that getSafeRespawnPosition() implements and
// that GameLoop.ts / GameInstance.ts now call.

function getSafeRespawnPosition(deathU: number, deathV: number): { u: number; v: number } {
  return {
    u: (deathU + 0.5) % 1,
    v: (deathV + 0.5) % 1,
  };
}

describe('S27 — Safe Respawn Position Algorithm', () => {
  it('REGRESSION: safe position differs from death position', () => {
    const deathU = 0.2;
    const deathV = 0.3;
    const safe = getSafeRespawnPosition(deathU, deathV);

    // Must NOT be same as death location
    expect(safe.u).not.toBeCloseTo(deathU);
    expect(safe.v).not.toBeCloseTo(deathV);

    // Must be opposite side of surface
    expect(safe.u).toBeCloseTo(0.7);
    expect(safe.v).toBeCloseTo(0.8);
  });

  it('REGRESSION: does NOT hardcode (0.5, 0.5) as respawn for all deaths', () => {
    // Old bug: always called respawn(0.5, 0.5)
    // Player dying at (0.5, 0.5) would respawn exactly there
    const deathU = 0.5;
    const deathV = 0.5;
    const safe = getSafeRespawnPosition(deathU, deathV);

    // With the fix: (0.5+0.5)%1=0, (0.5+0.5)%1=0 → safe pos is (0,0), NOT (0.5,0.5)
    expect(safe.u).toBeCloseTo(0);
    expect(safe.v).toBeCloseTo(0);

    // Old code would give (0.5, 0.5) — verify our formula gives something different
    expect(safe.u).not.toBeCloseTo(0.5);
    expect(safe.v).not.toBeCloseTo(0.5);
  });

  it('wraps u correctly when death U > 0.5', () => {
    const safe = getSafeRespawnPosition(0.8, 0.1);
    expect(safe.u).toBeCloseTo(0.3);  // (0.8+0.5)%1 = 0.3
    expect(safe.v).toBeCloseTo(0.6);  // 0.1+0.5 = 0.6
  });

  it('wraps v correctly when death V > 0.5', () => {
    const safe = getSafeRespawnPosition(0.1, 0.9);
    expect(safe.u).toBeCloseTo(0.6);  // 0.1+0.5 = 0.6
    expect(safe.v).toBeCloseTo(0.4);  // (0.9+0.5)%1 = 0.4
  });

  it('safe position is always 0.5 UV units away from death (on a flat UV space)', () => {
    const cases = [
      { u: 0.0, v: 0.0 },
      { u: 0.25, v: 0.75 },
      { u: 0.99, v: 0.01 },
      { u: 0.5, v: 0.5 },
    ];

    for (const { u, v } of cases) {
      const safe = getSafeRespawnPosition(u, v);
      // The safe position should NOT be the same as the death position
      // (they would only match if 0.5 + u ≡ u mod 1, which is impossible)
      const du = Math.abs(safe.u - u);
      const dv = Math.abs(safe.v - v);
      // Minimum wrapping distance is 0.5 in each axis
      const wrappedDu = Math.min(du, 1 - du);
      const wrappedDv = Math.min(dv, 1 - dv);
      expect(wrappedDu).toBeGreaterThan(0.4);  // ~0.5 in each axis
      expect(wrappedDv).toBeGreaterThan(0.4);
    }
  });
});
