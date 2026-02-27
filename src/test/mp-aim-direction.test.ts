/**
 * Regression test for LAN multiplayer aim direction (s38d-08).
 *
 * Bug: atan2(-mouseY, mouseX) inverted vertical aim — looking down shot up.
 * Fix: atan2(mouseY, mouseX) — remove the negation on mouseY.
 *
 * The formula used in network-main.ts for aimAngle must satisfy:
 *   - mouse right  (aimX=1,  aimY=0)  → aimAngle = 0       (pointing right)
 *   - mouse up     (aimX=0,  aimY=-1) → aimAngle = -π/2    (pointing up / negative Y screen)
 *   - mouse down   (aimX=0,  aimY=1)  → aimAngle = +π/2    (pointing down / positive Y screen)
 *   - mouse left   (aimX=-1, aimY=0)  → aimAngle = ±π      (pointing left)
 *
 * NOTE: these tests verify the FORMULA in isolation, not the full LAN stack.
 */

import { describe, it, expect } from 'vitest';

/** Replicates the formula from src/network-main.ts line 3121 (FIXED version). */
function computeAimAngle(aimX: number, aimY: number): number {
  return Math.atan2(aimY, aimX);
}

describe('LAN MP aim direction formula (network-main.ts)', () => {
  it('mouse right → aimAngle ≈ 0', () => {
    const angle = computeAimAngle(1, 0);
    expect(angle).toBeCloseTo(0, 5);
  });

  it('mouse down (positive Y) → aimAngle ≈ +π/2', () => {
    const angle = computeAimAngle(0, 1);
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('mouse up (negative Y) → aimAngle ≈ -π/2', () => {
    const angle = computeAimAngle(0, -1);
    expect(angle).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('mouse left → aimAngle ≈ ±π', () => {
    const angle = computeAimAngle(-1, 0);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI, 5);
  });

  it('REGRESSION: old broken formula (atan2(-y,x)) inverted vertical', () => {
    // With the OLD formula, mouse-down produced a negative angle (up direction).
    // This test documents why the fix was necessary.
    const brokenAngle = Math.atan2(-1, 0); // old formula with mouseY=1 → -mouseY=-1
    expect(brokenAngle).toBeCloseTo(-Math.PI / 2, 5); // was pointing UP, not down
  });
});
