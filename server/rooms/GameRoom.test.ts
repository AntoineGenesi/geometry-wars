/**
 * Tests for GameRoom bullet movement physics.
 *
 * Covers the sin(phi) correction applied to UV-space bullet movement on
 * sphere-like surfaces.  The fix ensures bullets travel in the aimed
 * world-space direction regardless of latitude, instead of appearing to
 * converge toward the poles.
 *
 * These tests validate the formula in isolation (same math used in
 * updateBullets) without requiring a live Colyseus Room instance.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the exact formula from GameRoom.updateBullets()
// ---------------------------------------------------------------------------

const SPHERE_LIKE = new Set([
  'sphere', 'sphere-tunnel', 'icosahedron', 'capsule', 'peanut',
]);

/**
 * Compute the sin(phi)-corrected U-direction for a bullet on the given
 * surface.  This mirrors the logic in GameRoom.updateBullets() exactly.
 */
function correctedDirX(dirX: number, bulletV: number, surfaceType: string): number {
  if (!SPHERE_LIKE.has(surfaceType)) return dirX;
  const phi = bulletV * Math.PI;
  const sinPhi = Math.sin(phi);
  const clampedSinPhi = Math.max(sinPhi, 0.3);
  return dirX / clampedSinPhi;
}

/** Simulate one step of bullet UV movement (same as updateBullets for one tick). */
function stepBullet(
  u: number, v: number,
  dirX: number, dirY: number,
  surfaceType: string,
  speed: number,
  dt: number,
): { u: number; v: number } {
  const cdx = correctedDirX(dirX, v, surfaceType);
  return {
    u: u + cdx * speed * dt,
    v: v + dirY * speed * dt,
  };
}

// ---------------------------------------------------------------------------
// Acceptance criteria tests
// ---------------------------------------------------------------------------

describe('GameRoom bullet sin(phi) correction', () => {
  const SPEED = 0.26;
  const DT = 1 / 60;

  // Criterion 5: bullet fired at angle=0 (right) from equator ends up
  // with larger U and same V ± epsilon.
  it('equator (V=0.5), angle=0 (right) → U increases, V unchanged', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.5, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);
    expect(newV).toBeCloseTo(0.5, 6);
  });

  // Criterion 2: bullets near equator travel correctly
  it('near equator (V=0.48), angle=0 → U increases, V unchanged', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.48, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);
    expect(newV).toBeCloseTo(0.48, 6);
  });

  // Criterion 3: bullets near north pole (V=0.1) do not converge toward V=0
  it('near north pole (V=0.1), angle=0 (right) → U increases, V stays near 0.1', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.1, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);         // U moves in aimed direction
    expect(newV).toBeCloseTo(0.1, 6);          // V does not drift toward pole
  });

  it('near south pole (V=0.9), angle=0 (right) → U increases, V stays near 0.9', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.9, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);
    expect(newV).toBeCloseTo(0.9, 6);
  });

  // Verify the correction actually compensates: near-pole U step is larger than
  // equatorial U step (sin correction magnifies it to keep world-space speed consistent).
  it('near pole U step is larger than equatorial U step (sin(phi) compensation)', () => {
    const equatorStep = stepBullet(0.5, 0.5, 1, 0, 'sphere', SPEED, DT);
    const nearPoleStep = stepBullet(0.5, 0.1, 1, 0, 'sphere', SPEED, DT);
    const equatorDU = equatorStep.u - 0.5;
    const nearPoleDU = nearPoleStep.u - 0.5;
    // Near poles sin(phi) < 1, so 1/sin(phi) > 1 — UV step is enlarged
    expect(nearPoleDU).toBeGreaterThan(equatorDU);
  });

  // Verify diagonal aim produces consistent angle across latitudes
  it('diagonal aim (angle=PI/4) produces equal U and V steps at equator', () => {
    const angle = Math.PI / 4;
    const { u: newU, v: newV } = stepBullet(0.5, 0.5, Math.cos(angle), Math.sin(angle), 'sphere', SPEED, DT);
    const dU = newU - 0.5;
    const dV = newV - 0.5;
    // At equator sin(phi)=1, so no correction — dU and dV should be equal
    expect(dU).toBeCloseTo(dV, 6);
  });

  // Criterion 4: flat surfaces (cube, torus) are unaffected — no sin(phi) correction
  it('cube surface → no sin(phi) correction applied', () => {
    const dxCube = correctedDirX(1, 0.1, 'cube');
    expect(dxCube).toBe(1); // unchanged
  });

  it('torus surface → no sin(phi) correction applied', () => {
    const dxTorus = correctedDirX(1, 0.1, 'torus');
    expect(dxTorus).toBe(1); // unchanged
  });

  it('sphere-tunnel surface uses sin(phi) correction', () => {
    const dxTunnel = correctedDirX(1, 0.1, 'sphere-tunnel');
    expect(dxTunnel).toBeGreaterThan(1); // enlarged near pole
  });

  it('capsule surface uses sin(phi) correction', () => {
    const dxCapsule = correctedDirX(1, 0.1, 'capsule');
    expect(dxCapsule).toBeGreaterThan(1);
  });

  // Clamping: sinPhi clamped to 0.3 minimum avoids divide-by-zero at exact poles
  it('exact north pole (V=0) → sinPhi clamped to 0.3, no infinity', () => {
    const dx = correctedDirX(1, 0, 'sphere');
    expect(isFinite(dx)).toBe(true);
    expect(dx).toBeCloseTo(1 / 0.3, 5); // clamped to 0.3
  });

  it('exact south pole (V=1) → sinPhi clamped to 0.3, no infinity', () => {
    const dx = correctedDirX(1, 1, 'sphere');
    expect(isFinite(dx)).toBe(true);
    expect(dx).toBeCloseTo(1 / 0.3, 5);
  });

  // Test V-only bullet (aimed straight up/down) is unaffected by correction
  it('angle=PI/2 (aim toward equator), near north pole → V increases, U unchanged', () => {
    const angle = Math.PI / 2; // sin(PI/2)=1, cos(PI/2)=0
    const { u: newU, v: newV } = stepBullet(0.5, 0.1, Math.cos(angle), Math.sin(angle), 'sphere', SPEED, DT);
    expect(newU).toBeCloseTo(0.5, 6);   // no U movement (dirX≈0)
    expect(newV).toBeGreaterThan(0.1);  // moves toward equator
  });
});
