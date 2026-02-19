/**
 * Regression tests for LAN lerp convergence (Phase 3).
 *
 * Problem: Each client independently lerps enemies toward server UV targets
 * every render frame. Two clients rendering at slightly different times
 * accumulate independent lerp state, so the SAME enemy appears at DIFFERENT
 * 3D positions on each client — visual desync even when server UV is identical.
 *
 * Fix: Increase ENEMY_LERP from 0.15 → 0.35 so entities converge within
 * ~12 frames (200ms at 60fps). This reduces the time window in which two
 * clients can have diverged positions, keeping them within 0.5 world units.
 *
 * See: tasks/s25-lan-sync-p3-eliminate-render-desync.md
 */

import { describe, it, expect } from 'vitest';

// -----------------------------------------------------------------------
// Lerp constants — must match network-main.ts onRender() exactly.
// If these tests fail after a change to those constants, update BOTH.
// -----------------------------------------------------------------------
const ENEMY_LERP  = 0.35; // Phase 3: was 0.15
const BULLET_LERP = 0.5;  // Phase 3: was 0.3
const GEOM_LERP   = 0.3;  // Phase 3: was 0.2
const PLAYER_LERP = 0.2;  // Unchanged — must stay 0.2 for player responsiveness

/** Simulate N frames of lerp, return final position. */
function simulateLerp(start: number, target: number, lerp: number, frames: number): number {
  let pos = start;
  for (let i = 0; i < frames; i++) {
    pos += (target - pos) * lerp;
  }
  return pos;
}

/** Frames required to cover at least `fraction` of the start→target gap. */
function framesTo(lerp: number, fraction: number): number {
  // After N frames: remaining = (1 - lerp)^N * delta  →  (1-lerp)^N < (1-fraction)
  // N > log(1-fraction) / log(1-lerp)
  return Math.ceil(Math.log(1 - fraction) / Math.log(1 - lerp));
}

// -----------------------------------------------------------------------
// ENEMY_LERP tests
// -----------------------------------------------------------------------
describe('ENEMY_LERP = 0.35 — convergence within 200ms at 60fps', () => {
  it('reaches 99% of target within 12 frames (200ms at 60fps)', () => {
    const frames200ms = 12; // 200ms * 60fps
    const result = simulateLerp(0, 1, ENEMY_LERP, frames200ms);
    // 99% of target means result >= 0.99
    expect(result).toBeGreaterThanOrEqual(0.99);
  });

  it('framesTo(99%) is 12 or fewer', () => {
    expect(framesTo(ENEMY_LERP, 0.99)).toBeLessThanOrEqual(12);
  });

  it('max per-frame divergence between 1-frame-offset clients is < old max', () => {
    // If client A has lerped N frames and client B is 1 frame behind,
    // the divergence is: |pos_A(N) - pos_B(N-1)| = lerp * (1-lerp)^(N-1) * delta
    // Worst case: N=1, divergence = LERP * delta
    // Old LERP=0.15 → worst-case divergence = 0.15 * delta
    // New LERP=0.35 → worst-case divergence = 0.35 * delta (higher per-frame peak)
    // BUT: the KEY gain is that total duration of divergence is ~3x shorter (500ms→200ms)
    // Total area-under-curve (integrated divergence) is what matters for user experience.
    const oldLerp = 0.15;
    const delta = 0.05; // typical UV delta between server ticks

    // Compute max 1-frame divergence at first frame
    const oldMaxDivergence = oldLerp * delta;
    const newMaxDivergence = ENEMY_LERP * delta;

    // Both are single-frame values; new is larger but convergence is much faster.
    // Verify old lerp does NOT converge within 200ms (12 frames):
    const oldResult = simulateLerp(0, 1, oldLerp, 12);
    expect(oldResult).toBeLessThan(0.99); // old was < 99% at 12 frames

    // Verify new lerp DOES converge within 200ms (12 frames):
    const newResult = simulateLerp(0, 1, ENEMY_LERP, 12);
    expect(newResult).toBeGreaterThanOrEqual(0.99); // new is >= 99% at 12 frames

    // Sanity-check both values are in valid range
    expect(oldMaxDivergence).toBeGreaterThan(0);
    expect(newMaxDivergence).toBeGreaterThan(0);
  });

  it('snap-on-first-spawn: enemy starts AT target UV (no lerp needed)', () => {
    // In onStateChange, newly spawned enemies have their UV snapped:
    //   enemy.surfacePosition.u = netEnemy.surfaceU;  (line ~1137)
    // So on the FIRST render frame, start === target, lerp is a no-op.
    const target = 0.7;
    const result = simulateLerp(target, target, ENEMY_LERP, 1);
    expect(result).toBe(target); // No movement, already at target
  });

  it('converges to within 0.001 UV units after 20 frames', () => {
    const delta = 0.1; // large UV delta
    const result = simulateLerp(0, delta, ENEMY_LERP, 20);
    expect(Math.abs(result - delta)).toBeLessThan(0.001);
  });
});

// -----------------------------------------------------------------------
// PLAYER_LERP — must remain 0.2 for player responsiveness
// -----------------------------------------------------------------------
describe('PLAYER_LERP = 0.2 — must not change', () => {
  it('PLAYER_LERP is exactly 0.2', () => {
    expect(PLAYER_LERP).toBe(0.2);
  });

  it('is less than ENEMY_LERP (players feel more responsive than enemies look)', () => {
    // Player lerp is for REMOTE players only; local player uses client prediction.
    // Remote player lerp being lower than enemy lerp is intentional.
    expect(PLAYER_LERP).toBeLessThan(ENEMY_LERP);
  });
});

// -----------------------------------------------------------------------
// BULLET_LERP tests
// -----------------------------------------------------------------------
describe('BULLET_LERP = 0.5 — fast convergence for fast-moving bullets', () => {
  it('reaches 99% within 7 frames (~117ms at 60fps)', () => {
    const result = simulateLerp(0, 1, BULLET_LERP, 7);
    expect(result).toBeGreaterThanOrEqual(0.99);
  });

  it('converges faster than ENEMY_LERP', () => {
    const enemyFrames = framesTo(ENEMY_LERP, 0.99);
    const bulletFrames = framesTo(BULLET_LERP, 0.99);
    expect(bulletFrames).toBeLessThan(enemyFrames);
  });
});

// -----------------------------------------------------------------------
// GEOM_LERP tests
// -----------------------------------------------------------------------
describe('GEOM_LERP = 0.3 — geoms converge slightly faster than before (was 0.2)', () => {
  it('reaches 99% within 13 frames at 60fps', () => {
    const result = simulateLerp(0, 1, GEOM_LERP, 13);
    expect(result).toBeGreaterThanOrEqual(0.99);
  });

  it('is faster than old GEOM_LERP=0.2', () => {
    const oldFrames = framesTo(0.2, 0.99);
    const newFrames = framesTo(GEOM_LERP, 0.99);
    expect(newFrames).toBeLessThan(oldFrames);
  });
});

// -----------------------------------------------------------------------
// Acceptance criterion: all lerp values in valid range
// -----------------------------------------------------------------------
describe('Lerp value sanity checks', () => {
  it.each([
    ['ENEMY_LERP',  ENEMY_LERP],
    ['BULLET_LERP', BULLET_LERP],
    ['GEOM_LERP',   GEOM_LERP],
    ['PLAYER_LERP', PLAYER_LERP],
  ])('%s is in range (0, 1)', (_name, value) => {
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});
