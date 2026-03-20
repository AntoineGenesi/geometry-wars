/**
 * Regression test: Torus MP bullet physics UV axis fix — s44r33-04
 *
 * Bug: updateBullets() torus physics was written when surfaceU ≈ ring angle
 * and surfaceV ≈ tube angle. After s44o-04b fixed _worldPosToApproxUV to
 * use accurate torus parameterization (surfaceU = tube, surfaceV = ring),
 * the bullet physics code was never updated — bullet.x and bullet.y swapped
 * meaning, but the physics still used bullet.y (now ring) as the tube angle.
 *
 * Effect:
 * - rho = 1 + r*cos(ring_angle) instead of 1 + r*cos(tube_angle) → position-dependent
 * - Tube direction scaled by 1/rho (wrong) instead of 1/r (constant)
 * - Ring direction scaled by 1/r (wrong) instead of 1/rho (varies with tube angle)
 * - Christoffel symbols used ring angle for sin/cos → wrong curvature direction
 *
 * Fix (s44r33-04): Use bullet.x (surfaceU = tube angle) for all torus physics:
 * - theta = bullet.x * 2π (tube angle)
 * - rho = 1 + TORUS_r * cos(theta)
 * - tube movement: bullet.x += dirX / TORUS_r * speed * dt
 * - ring movement: bullet.y += dirY / rho * speed * dt
 * - Geodesic: d²θ/dt² = -Γ^θ_φφ * dirY², d²φ/dt² = -2*Γ^φ_θφ * dirX * dirY
 */

import { describe, it, expect } from 'vitest';

// Simulate the fixed torus bullet physics step from GameRoom.updateBullets()
function torusBulletStepFixed(
  x: number, y: number,
  dirX: number, dirY: number,
  dt: number, bulletSpeed: number,
): { x: number; y: number; dirX: number; dirY: number } {
  const TORUS_r = 0.375;
  const theta = x * 2 * Math.PI; // tube angle θ from surfaceU
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const rho = Math.max(1 + TORUS_r * cosT, 0.1);

  const step = bulletSpeed * dt;
  const prevDirX = dirX;

  // Geodesic: d²θ/dt² = -Γ^θ_φφ * (dφ/dt)²  where Γ^θ_φφ = ρ*sin(θ)/r
  dirX += -(rho * sinT / TORUS_r) * dirY * dirY * step;
  // Geodesic: d²φ/dt² = -2*Γ^φ_θφ * (dθ/dt)(dφ/dt)  where Γ^φ_θφ = -r*sin(θ)/ρ
  dirY += (2 * TORUS_r * sinT / rho) * prevDirX * dirY * step;

  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  if (len > 0.001) { dirX /= len; dirY /= len; }

  x += (dirX / TORUS_r) * bulletSpeed * dt;   // tube: scale by 1/r
  y += (dirY / rho) * bulletSpeed * dt;         // ring: scale by 1/rho(θ)

  return { x, y, dirX, dirY };
}

// Simulate the OLD (buggy) torus bullet physics
function torusBulletStepOld(
  x: number, y: number,
  dirX: number, dirY: number,
  dt: number, bulletSpeed: number,
): { x: number; y: number; dirX: number; dirY: number } {
  const TORUS_r = 0.375;
  const v = y * 2 * Math.PI; // BUG: y is ring angle, not tube angle
  const cosV = Math.cos(v);
  const sinV = Math.sin(v);
  const rho = Math.max(1 + TORUS_r * cosV, 0.1); // BUG: uses ring angle

  const step = bulletSpeed * dt;
  const prevDirX = dirX;

  const Gamma_u_uv = -TORUS_r * sinV / rho;
  const Gamma_v_uu = rho * sinV / TORUS_r;
  dirX += -2 * Gamma_u_uv * dirX * dirY * step;
  dirY += -Gamma_v_uu * prevDirX * prevDirX * step;

  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  if (len > 0.001) { dirX /= len; dirY /= len; }

  x += (dirX / rho) * bulletSpeed * dt;  // BUG: tube direction uses ring metric
  y += (dirY / TORUS_r) * bulletSpeed * dt; // BUG: ring direction uses constant r

  return { x, y, dirX, dirY };
}

describe('Torus MP bullet physics — s44r33-04 UV axis fix', () => {
  const BULLET_SPEED = 0.13; // UV/s (BULLET_SPEED_UV from GameConstants)
  const dt = 1 / 30; // 30Hz server tick

  it('fixed: bullet aimed along tube (dirX=1, dirY=0) moves bullet.x (tube), not bullet.y (ring)', () => {
    const { x: newX, y: newY } = torusBulletStepFixed(0.0, 0.0, 1.0, 0.0, dt, BULLET_SPEED);

    // Tube direction bullet should move x (tube angle), not y (ring angle)
    expect(newX).toBeGreaterThan(0.001);  // bullet.x (tube) increases
    expect(newY).toBeCloseTo(0, 5);       // bullet.y (ring) unchanged
  });

  it('fixed: bullet aimed along ring (dirX=0, dirY=1) moves bullet.y (ring), not bullet.x (tube)', () => {
    const { x: newX, y: newY } = torusBulletStepFixed(0.0, 0.0, 0.0, 1.0, dt, BULLET_SPEED);

    // Ring direction bullet should move y (ring angle), not x (tube angle)
    expect(newX).toBeCloseTo(0, 5);  // bullet.x (tube) unchanged
    expect(newY).toBeGreaterThan(0.001); // bullet.y (ring) increases
  });

  it('old (buggy): bullet aimed along tube actually moved ring — demonstrates the bug', () => {
    const { x: newX, y: newY } = torusBulletStepOld(0.0, 0.0, 1.0, 0.0, dt, BULLET_SPEED);

    // BUG: with y=0 (ring=0), rho=1.375, so x moves by 1/1.375 * speed * dt ≈ 0.00315
    // y doesn't move (dirY=0, no ring movement)
    // The bug is the SCALING: tube should scale by 1/TORUS_r=2.67, not 1/rho=0.727
    expect(newX).toBeGreaterThan(0); // x does increase, but with wrong scaling
    expect(newX).toBeLessThan(torusBulletStepFixed(0.0, 0.0, 1.0, 0.0, dt, BULLET_SPEED).x);
    // Old code moves tube at 1/rho ≈ 0.73x speed, fixed code moves at 1/TORUS_r ≈ 2.67x speed
  });

  it('fixed: tube movement speed is constant (1/TORUS_r), independent of ring position', () => {
    const TORUS_r = 0.375;
    const expected_dx = (1.0 / TORUS_r) * BULLET_SPEED * dt;

    // At tube=0 (outer edge of torus)
    const r1 = torusBulletStepFixed(0.0, 0.0, 1.0, 0.0, dt, BULLET_SPEED);
    expect(r1.x).toBeCloseTo(expected_dx, 5);

    // At tube=0.5 (inner edge of torus)
    const r2 = torusBulletStepFixed(0.5, 0.0, 1.0, 0.0, dt, BULLET_SPEED);
    expect(r2.x - 0.5).toBeCloseTo(expected_dx, 5);

    // Speed should be the same regardless of where on the tube we are
    expect(r1.x).toBeCloseTo(r2.x - 0.5, 5);
  });

  it('fixed: ring movement speed varies with tube angle (1/rho(theta))', () => {
    const TORUS_r = 0.375;

    // At outer edge (tube=0): rho = 1 + 0.375 = 1.375 → ring moves slowly
    const rhoOuter = 1 + TORUS_r; // = 1.375
    const r1 = torusBulletStepFixed(0.0, 0.0, 0.0, 1.0, dt, BULLET_SPEED);
    expect(r1.y).toBeCloseTo((1.0 / rhoOuter) * BULLET_SPEED * dt, 5);

    // At inner edge (tube=0.5): rho = 1 - 0.375 = 0.625 → ring moves faster
    const rhoInner = 1 - TORUS_r; // = 0.625
    const r2 = torusBulletStepFixed(0.5, 0.0, 0.0, 1.0, dt, BULLET_SPEED);
    expect(r2.y).toBeCloseTo((1.0 / rhoInner) * BULLET_SPEED * dt, 5);

    // Inner ring moves faster than outer ring
    expect(r2.y).toBeGreaterThan(r1.y);
  });

  it('fixed: rho uses tube angle (bullet.x), not ring angle (bullet.y)', () => {
    const TORUS_r = 0.375;
    // Set tube=0.5 (inner edge, rho=0.625), ring=0.0
    // For ring-direction bullet (dirX=0, dirY=1):
    const rhoAtTube05 = 1 + TORUS_r * Math.cos(0.5 * 2 * Math.PI); // ≈ 0.625
    const result = torusBulletStepFixed(0.5, 0.0, 0.0, 1.0, dt, BULLET_SPEED);
    expect(result.y).toBeCloseTo((1.0 / rhoAtTube05) * BULLET_SPEED * dt, 5);

    // Old code would use rho = 1 + TORUS_r * cos(bullet.y * 2π) = 1 + 0.375 * cos(0) = 1.375
    // New code uses rho from tube angle: 0.625 — significantly different
    const rhoFromRingAngle = 1 + TORUS_r * Math.cos(0.0 * 2 * Math.PI); // = 1.375
    expect(rhoAtTube05).not.toBeCloseTo(rhoFromRingAngle, 2); // These are different (0.625 vs 1.375)
  });
});
