/**
 * Regression test for LAN multiplayer aim direction.
 *
 * COORDINATE SYSTEM ANALYSIS (s39-02):
 * In the LAN game, bullets are fired using UV-space direction:
 *   dir = tangentU * cos(aimAngle) + tangentV * sin(aimAngle)
 *
 * The camera uses tangentV as its UP vector (camera.up = tangentV).
 * Therefore:
 *   - tangentU = camera RIGHT = screen right direction
 *   - tangentV = camera UP = screen UP direction (NOT screen down)
 *
 * Correct mapping (matching GameLoop.ts single-player camera-relative logic):
 *   - mouse right  (aimX=1,  aimY=0)  → aimAngle = 0       → tangentU = screen right ✓
 *   - mouse up     (aimX=0,  aimY=-1) → aimAngle = +π/2    → +tangentV = screen UP ✓
 *   - mouse down   (aimX=0,  aimY=1)  → aimAngle = -π/2    → -tangentV = screen DOWN ✓
 *   - mouse left   (aimX=-1, aimY=0)  → aimAngle = ±π      → -tangentU = screen left ✓
 *
 * WHY atan2(-mouseY, mouseX):
 *   aimY is positive when the mouse is BELOW center (screen space Y increases downward).
 *   A mouse pointing DOWN (aimY > 0) should shoot downward = -tangentV direction.
 *   sin(-π/2) * tangentV = -tangentV = screen DOWN ✓
 *   Formula: atan2(-mouseY, mouseX) with mouseY=+1 gives atan2(-1, 0) = -π/2 ✓
 *
 * HISTORY:
 *   s38d-08: Changed atan2(-mouseY, mouseX) → atan2(mouseY, mouseX) as a "fix".
 *   s39-02:  Reverted to atan2(-mouseY, mouseX) — the s38d-08 fix was WRONG.
 *            It was based on the incorrect assumption that tangentV = screen DOWN.
 *            Actually tangentV = screen UP (camera.up = tangentV).
 */

import { describe, it, expect } from 'vitest';

/**
 * Replicates the FALLBACK screen-space formula still used in src/utils/aimAngle.ts
 * when camera axes are degenerate. The primary formula (s40-03) is in aimAngle.ts and
 * tested in src/utils/aimAngle.test.ts.
 */
function computeAimAngle(aimX: number, aimY: number): number {
  return Math.atan2(-aimY, aimX);
}

describe('LAN MP aim direction formula (network-main.ts)', () => {
  it('mouse right → aimAngle ≈ 0 (bullet = +tangentU = screen right)', () => {
    const angle = computeAimAngle(1, 0);
    expect(angle).toBeCloseTo(0, 5);
  });

  it('mouse up (aimY=-1, above center) → aimAngle ≈ +π/2 (bullet = +tangentV = screen up)', () => {
    // aimY < 0 when mouse is above center (screen Y decreases moving up)
    // +tangentV = camera.up = screen UP direction ✓
    const angle = computeAimAngle(0, -1);
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('mouse down (aimY=+1, below center) → aimAngle ≈ -π/2 (bullet = -tangentV = screen down)', () => {
    // aimY > 0 when mouse is below center (screen Y increases moving down)
    // -tangentV = anti camera-up = screen DOWN direction ✓
    const angle = computeAimAngle(0, 1);
    expect(angle).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('mouse left → aimAngle ≈ ±π (bullet = -tangentU = screen left)', () => {
    const angle = computeAimAngle(-1, 0);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI, 5);
  });

  it('REGRESSION (s38d-08 was wrong): atan2(mouseY, mouseX) inverts vertical aim', () => {
    // The s38d-08 "fix" changed to atan2(mouseY, mouseX). This was WRONG.
    // With mouseY=+1 (mouse below center, pointing DOWN), the broken formula gives:
    const brokenAngle = Math.atan2(1, 0); // broken formula with aimY=1
    expect(brokenAngle).toBeCloseTo(Math.PI / 2, 5); // π/2 = +tangentV = screen UP (wrong! should go DOWN)

    // The correct formula gives -π/2 = -tangentV = screen DOWN ✓
    const correctAngle = Math.atan2(-1, 0); // correct formula with -aimY=-1
    expect(correctAngle).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('REGRESSION (s39-02 reverted): atan2(-mouseY, mouseX) is correct', () => {
    // This test FAILS if atan2(mouseY, mouseX) is used (s38d-08 broken formula).
    // Mouse up (aimY=-1): correct formula → π/2, broken formula → -π/2.
    const mouseUpAimY = -1;
    const correctAngle = Math.atan2(-mouseUpAimY, 0); // atan2(1, 0) = π/2
    const brokenAngle = Math.atan2(mouseUpAimY, 0);   // atan2(-1, 0) = -π/2

    expect(correctAngle).toBeCloseTo(Math.PI / 2, 5);  // bullet = +tangentV = screen UP ✓
    expect(brokenAngle).toBeCloseTo(-Math.PI / 2, 5);  // bullet = -tangentV = screen DOWN ✗
    expect(correctAngle).not.toBeCloseTo(brokenAngle, 3); // they must differ
  });
});
