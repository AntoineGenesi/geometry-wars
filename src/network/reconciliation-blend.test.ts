/**
 * Unit tests for server reconciliation direction-aware blend logic.
 *
 * Tests the pure math of the s44r22-16 fix: when the server correction vector
 * opposes the current movement direction, the blend is reduced to prevent
 * direction reversal on mobile (high-latency) connections.
 *
 * The logic lives inline in network-main.ts (onStateChange), but the math
 * is pure and easily unit-tested here.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure implementation of the blend-factor calculation (extracted from
// network-main.ts to make it unit-testable without the full game context).
// ---------------------------------------------------------------------------

const SERVER_CORRECTION_BLEND = 0.1;

/**
 * Compute the reconciliation blend factor for a given correction vector
 * and last-sent input direction.
 *
 * @param du  UV correction in U axis (serverU - clientU)
 * @param dv  UV correction in V axis (serverV - clientV)
 * @param lastMoveX  Last sent moveX (already negated for moveY: server-side sign)
 * @param lastMoveY  Last sent moveY
 */
function computeBlendFactor(
  du: number,
  dv: number,
  lastMoveX: number,
  lastMoveY: number,
): number {
  const isMoving = lastMoveX !== 0 || lastMoveY !== 0;
  if (!isMoving) return SERVER_CORRECTION_BLEND;

  const moveDot = du * lastMoveX + dv * lastMoveY;
  if (moveDot < 0) {
    // Server correction opposes current movement — suppress to avoid reversal.
    return SERVER_CORRECTION_BLEND * 0.1;
  }
  return SERVER_CORRECTION_BLEND;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconciliation direction-aware blend (s44r22-16)', () => {

  // -------------------------------------------------------------------------
  // Stationary player: full blend regardless of correction direction
  // -------------------------------------------------------------------------

  it('stationary player uses full blend (correction aligned)', () => {
    // Player not moving, server correction pushes right
    expect(computeBlendFactor(0.05, 0, 0, 0)).toBe(SERVER_CORRECTION_BLEND);
  });

  it('stationary player uses full blend (correction opposing)', () => {
    // Player not moving, server correction pushes left
    expect(computeBlendFactor(-0.05, 0, 0, 0)).toBe(SERVER_CORRECTION_BLEND);
  });

  // -------------------------------------------------------------------------
  // Moving player: correction aligned with movement → full blend
  // -------------------------------------------------------------------------

  it('moving right + correction points right → full blend', () => {
    // Player moving right (moveX=1), server correction also pushes right (du>0)
    const blend = computeBlendFactor(0.05, 0, 1, 0);
    expect(blend).toBe(SERVER_CORRECTION_BLEND);
  });

  it('moving up + correction points up → full blend', () => {
    // Player moving up (moveY<0 in screen space but positive here), correction agrees
    const blend = computeBlendFactor(0, 0.05, 0, 1);
    expect(blend).toBe(SERVER_CORRECTION_BLEND);
  });

  it('diagonal movement + diagonal aligned correction → full blend', () => {
    // Player moving diagonally right-up, correction also right-up
    const blend = computeBlendFactor(0.03, 0.04, 0.707, 0.707);
    expect(blend).toBe(SERVER_CORRECTION_BLEND);
  });

  // -------------------------------------------------------------------------
  // Moving player: correction opposes movement → suppressed blend
  // -------------------------------------------------------------------------

  it('moving right + correction points left → suppressed blend', () => {
    // Player moving right (moveX=1), server correction pulls left (du<0)
    // This is the direction reversal scenario on mobile
    const blend = computeBlendFactor(-0.05, 0, 1, 0);
    expect(blend).toBeCloseTo(SERVER_CORRECTION_BLEND * 0.1, 10);
  });

  it('moving left + correction points right → suppressed blend', () => {
    const blend = computeBlendFactor(0.05, 0, -1, 0);
    expect(blend).toBeCloseTo(SERVER_CORRECTION_BLEND * 0.1, 10);
  });

  it('moving up + correction points down → suppressed blend', () => {
    const blend = computeBlendFactor(0, -0.05, 0, 1);
    expect(blend).toBeCloseTo(SERVER_CORRECTION_BLEND * 0.1, 10);
  });

  it('diagonal movement + opposing correction → suppressed blend', () => {
    // Player moving right-up, server tries to pull left-down
    const blend = computeBlendFactor(-0.03, -0.04, 0.707, 0.707);
    expect(blend).toBeCloseTo(SERVER_CORRECTION_BLEND * 0.1, 10);
  });

  // -------------------------------------------------------------------------
  // Edge case: perpendicular correction (dot = 0) → full blend
  // -------------------------------------------------------------------------

  it('correction perpendicular to movement direction → full blend (dot = 0)', () => {
    // Player moving right, server corrects in V direction only
    // du=0 (no U correction), dv=0.05 (V correction): dot = 0*1 + 0.05*0 = 0
    const blend = computeBlendFactor(0, 0.05, 1, 0);
    expect(blend).toBe(SERVER_CORRECTION_BLEND); // dot == 0, not < 0
  });

  // -------------------------------------------------------------------------
  // Numeric verification of suppressed blend values
  // -------------------------------------------------------------------------

  it('suppressed blend = 1% (0.01), not 0 — still applies gentle correction', () => {
    const blend = computeBlendFactor(-0.05, 0, 1, 0);
    expect(blend).toBeCloseTo(0.01, 6); // 10% × 10% = 1%
    expect(blend).toBeGreaterThan(0);   // not fully disabled
  });

  it('full blend remains 10% (SERVER_CORRECTION_BLEND)', () => {
    const blend = computeBlendFactor(0.05, 0, 1, 0);
    expect(blend).toBeCloseTo(0.1, 6);
  });

  // -------------------------------------------------------------------------
  // Verify correction magnitude is reduced but not zero during reversal
  // -------------------------------------------------------------------------

  it('direction reversal: position correction is 10x smaller than normal', () => {
    const du = -0.05;
    const dv = 0;

    const normalBlend = computeBlendFactor(du, dv, 0, 0);    // stationary
    const reversalBlend = computeBlendFactor(du, dv, 1, 0);  // moving right, correction left

    const normalCorrection = Math.abs(du * normalBlend);
    const reversalCorrection = Math.abs(du * reversalBlend);

    expect(normalCorrection / reversalCorrection).toBeCloseTo(10, 1);
  });

});
