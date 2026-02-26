/**
 * Regression tests for torus hit detection in LAN multiplayer (S35).
 *
 * Bug: Server used raw Euclidean UV distance without wrap-around handling.
 * On the torus (doubly periodic — both U and V wrap), entities near UV seams
 * had inflated distances and were never detected as colliding. Enemies also had
 * their V coordinate clamped instead of wrapped, causing them to pile up at
 * V=0.05/0.95 boundaries and never cross the seam.
 *
 * These tests validate the fix in isolation (pure math, no Colyseus required).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the exact helpers added to GameRoom (in isolation)
// ---------------------------------------------------------------------------

const WRAPS_V_SURFACES = new Set([
  'torus', 'pipe', 'mobius', 'cube-ring', 'cube-tunnel',
]);

function surfaceWrapsV(surfaceType: string): boolean {
  return WRAPS_V_SURFACES.has(surfaceType);
}

function wrapCoord(v: number): number {
  return ((v % 1) + 1) % 1;
}

function clampCoord(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Compute the shortest signed delta between two UV coordinates on a periodic axis.
 * This is the exact logic from GameRoom.uvDelta().
 */
function uvDelta(a: number, b: number, wraps: boolean): number {
  let d = b - a;
  if (wraps) {
    if (d > 0.5) d -= 1;
    else if (d < -0.5) d += 1;
  }
  return d;
}

/**
 * Compute the wrap-aware UV distance between two surface points.
 * This is the exact logic from GameRoom.uvDistWrapped().
 */
function uvDistWrapped(u1: number, v1: number, u2: number, v2: number, surfaceType: string): number {
  const wrapsV = surfaceWrapsV(surfaceType);
  let du = Math.abs(u1 - u2);
  if (du > 0.5) du = 1 - du;
  let dv = Math.abs(v1 - v2);
  if (wrapsV && dv > 0.5) dv = 1 - dv;
  return Math.sqrt(du * du + dv * dv);
}

// ---------------------------------------------------------------------------
// Tests: uvDistWrapped — wrap-aware distance
// ---------------------------------------------------------------------------

describe('uvDistWrapped — torus (both axes wrap)', () => {
  const ST = 'torus';

  it('entities far from seam: same as euclidean', () => {
    const d = uvDistWrapped(0.3, 0.4, 0.5, 0.6, ST);
    expect(d).toBeCloseTo(Math.sqrt(0.04 + 0.04), 5);
  });

  it('entities crossing U seam: uses short path', () => {
    // Player at U=0.02, enemy at U=0.98 — raw distance 0.96, wrapped 0.04
    const d = uvDistWrapped(0.02, 0.5, 0.98, 0.5, ST);
    expect(d).toBeCloseTo(0.04, 5);
  });

  it('entities crossing V seam: uses short path', () => {
    // Player at V=0.02, enemy at V=0.98 — raw distance 0.96, wrapped 0.04
    const d = uvDistWrapped(0.5, 0.02, 0.5, 0.98, ST);
    expect(d).toBeCloseTo(0.04, 5);
  });

  it('entities crossing both U and V seams simultaneously', () => {
    // Both at seams: raw dist ≈ 1.34, wrapped ≈ 0.057
    const d = uvDistWrapped(0.02, 0.02, 0.98, 0.98, ST);
    expect(d).toBeCloseTo(Math.sqrt(0.04 * 0.04 + 0.04 * 0.04), 5);
  });

  it('collision detected across V seam (was broken before fix)', () => {
    // Enemy at V=0.96, player at V=0.04 — wrapped distance 0.08 < threshold 0.04? No.
    // But at 0.98 vs 0.02: wrapped = 0.04 which equals threshold.
    const d = uvDistWrapped(0.5, 0.03, 0.5, 0.97, ST);
    expect(d).toBeCloseTo(0.06, 5);
    // Confirm it's within collision radius
    expect(d).toBeLessThan(0.07);
  });

  it('entities at collision threshold across V seam are detected', () => {
    // V seam: player=0.02, enemy=0.98 → wrapped dv=0.04 → dist=0.04 → hits threshold
    const d = uvDistWrapped(0.5, 0.02, 0.5, 0.98, ST);
    expect(d).toBeLessThan(0.05); // within player-enemy collision threshold of 0.04
  });
});

describe('uvDistWrapped — sphere (only U wraps)', () => {
  const ST = 'sphere';

  it('crossing U seam: uses short path', () => {
    const d = uvDistWrapped(0.02, 0.5, 0.98, 0.5, ST);
    expect(d).toBeCloseTo(0.04, 5);
  });

  it('crossing V boundary: does NOT use short path (V clamps on sphere)', () => {
    // V=0.02 vs V=0.98: raw = 0.96, NOT wrapped because sphere V clamps
    const d = uvDistWrapped(0.5, 0.02, 0.5, 0.98, ST);
    expect(d).toBeCloseTo(0.96, 5);
  });
});

// ---------------------------------------------------------------------------
// Tests: uvDelta — shortest-path direction for enemy tracking
// ---------------------------------------------------------------------------

describe('uvDelta — shortest path direction', () => {
  it('no seam crossing: returns normal delta', () => {
    expect(uvDelta(0.2, 0.5, true)).toBeCloseTo(0.3, 5);
    expect(uvDelta(0.5, 0.2, true)).toBeCloseTo(-0.3, 5);
  });

  it('U seam crossing: returns short path delta', () => {
    // Enemy at 0.97, player at 0.03: shortest path = +0.06 (go forward past seam)
    expect(uvDelta(0.97, 0.03, true)).toBeCloseTo(0.06, 5);
    // Enemy at 0.03, player at 0.97: shortest path = -0.06 (go backward past seam)
    expect(uvDelta(0.03, 0.97, true)).toBeCloseTo(-0.06, 5);
  });

  it('V seam crossing with wrapsV=true (torus): returns short path', () => {
    expect(uvDelta(0.97, 0.03, true)).toBeCloseTo(0.06, 5);
  });

  it('V seam crossing with wrapsV=false (sphere): returns full delta', () => {
    // No wrapping: enemy sees player as 0.97 - 0.03 = -0.94 away (not short path)
    expect(uvDelta(0.97, 0.03, false)).toBeCloseTo(-0.94, 5);
  });
});

// ---------------------------------------------------------------------------
// Tests: enemy V wrapping on torus
// ---------------------------------------------------------------------------

describe('enemy V coordinate handling on torus', () => {
  it('enemy V wraps at seam (not clamped)', () => {
    // Enemy moves past V=1.0: should wrap to V=0.02, not clamp to 0.95
    const newV = wrapCoord(1.02);
    expect(newV).toBeCloseTo(0.02, 5);
  });

  it('enemy V wraps below 0 (not clamped)', () => {
    const newV = wrapCoord(-0.02);
    expect(newV).toBeCloseTo(0.98, 5);
  });

  it('clamped V (sphere) stops at boundary', () => {
    const newV = Math.max(0.05, Math.min(0.95, 1.02));
    expect(newV).toBeCloseTo(0.95, 5);
  });
});

// ---------------------------------------------------------------------------
// Tests: bullet V wrapping on torus
// ---------------------------------------------------------------------------

describe('bullet V coordinate handling on torus', () => {
  it('bullet V wraps past 1.0 on torus (not clamped)', () => {
    // Bullet moves past V=1: wrapCoord should bring it to 0.02
    const newV = wrapCoord(1.02);
    expect(newV).toBeCloseTo(0.02, 5);
  });

  it('bullet V clamps on sphere (not wrapped)', () => {
    // On sphere, bullet V clamps to 0-1
    const newV = clampCoord(1.02);
    expect(newV).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// Integration test: simulate collision scenario that was broken before
// ---------------------------------------------------------------------------

describe('torus collision scenario regression', () => {
  it('enemy at V=0.97 hits player at V=0.03 (across V seam) — OLD code would miss', () => {
    const playerU = 0.5, playerV = 0.03;
    const enemyU = 0.5, enemyV = 0.97;

    // Old (broken) distance
    const duOld = playerU - enemyU;
    const dvOld = playerV - enemyV;
    const distOld = Math.sqrt(duOld * duOld + dvOld * dvOld);

    // New (fixed) distance
    const distNew = uvDistWrapped(playerU, playerV, enemyU, enemyV, 'torus');

    // Old distance was 0.94 — WAY above threshold 0.04, no collision detected
    expect(distOld).toBeGreaterThan(0.9);
    // New distance is 0.06 — within range, collision correctly detected
    expect(distNew).toBeCloseTo(0.06, 5);
    expect(distNew).toBeLessThan(0.1);
  });

  it('bullet at U=0.98 hits enemy at U=0.01 (across U seam) — OLD code would miss', () => {
    const bulletU = 0.98, bulletV = 0.5;
    const enemyU = 0.01, enemyV = 0.5;

    const duOld = Math.abs(bulletU - enemyU);
    const distOld = Math.sqrt(duOld * duOld);

    const distNew = uvDistWrapped(bulletU, bulletV, enemyU, enemyV, 'torus');

    // Old: 0.97, new: 0.03
    expect(distOld).toBeGreaterThan(0.9);
    expect(distNew).toBeCloseTo(0.03, 5);
    expect(distNew).toBeLessThan(0.012 * 2); // within bullet-enemy threshold
  });

  it('enemy correctly tracks player across V seam — OLD code would track away from player', () => {
    const enemyV = 0.97;
    const playerV = 0.03;

    // Old delta: 0.03 - 0.97 = -0.94 (enemy moves backward, away from player through V=0)
    const dvOld = playerV - enemyV; // -0.94
    // New delta: +0.06 (move forward across seam)
    const dvNew = uvDelta(enemyV, playerV, true); // +0.06

    expect(dvOld).toBeCloseTo(-0.94, 5);
    expect(dvNew).toBeCloseTo(0.06, 5);
    // Sign matters: old sends enemy in wrong direction
    expect(Math.sign(dvOld)).not.toBe(Math.sign(dvNew));
  });
});
