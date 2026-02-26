/**
 * S36: MP Bullet Geodesic — Regression Tests
 *
 * Verifies that MP bullet direction vectors are updated each tick
 * (parallel transport via Christoffel symbols), so bullets follow
 * geodesic (great circle) paths instead of UV latitude lines.
 *
 * The key test: a bullet fired purely horizontally (dirX=1, dirY=0)
 * at 45° latitude on a sphere MUST develop a southward component
 * (dirY > 0) after several ticks, curving toward the equator.
 * Without parallel transport, dirY stays zero (UV straight line).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline parallel transport from GameRoom.ts — so tests don't import the
// full Colyseus server stack.
// ---------------------------------------------------------------------------

const BULLET_SPEED = 0.13;

interface Bullet {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  age: number;
}

function simulateSphereBullets(
  initialBullet: Bullet,
  ticks: number,
  dt: number
): Bullet[] {
  const path: Bullet[] = [];
  let b = { ...initialBullet };

  for (let i = 0; i < ticks; i++) {
    const phi = b.y * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const clampedSinPhi = Math.max(Math.abs(sinPhi), 0.1);

    // Parallel transport
    const cotPhi = cosPhi / Math.max(Math.abs(sinPhi), 0.01);
    const step = BULLET_SPEED * dt;
    const prevDirX = b.dirX;
    b.dirX += -2 * cotPhi * b.dirX * b.dirY * step;
    b.dirY += sinPhi * cosPhi * prevDirX * prevDirX * step;
    const len = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
    if (len > 0.001) { b.dirX /= len; b.dirY /= len; }

    b.x += (b.dirX / clampedSinPhi) * BULLET_SPEED * dt;
    b.y += b.dirY * BULLET_SPEED * dt;
    b.age += dt;

    path.push({ ...b });
  }
  return path;
}

function simulateSphereBulletsNaive(
  initialBullet: Bullet,
  ticks: number,
  dt: number
): Bullet[] {
  const path: Bullet[] = [];
  let b = { ...initialBullet };

  for (let i = 0; i < ticks; i++) {
    const phi = b.y * Math.PI;
    const sinPhi = Math.sin(phi);
    const clampedSinPhi = Math.max(sinPhi, 0.3);

    // OLD: no parallel transport — dirX/dirY never change
    const correctedDirX = b.dirX / clampedSinPhi;
    b.x += correctedDirX * BULLET_SPEED * dt;
    b.y += b.dirY * BULLET_SPEED * dt;
    b.age += dt;

    path.push({ ...b });
  }
  return path;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S36: MP bullet geodesic parallel transport', () => {

  it('direction vector must change each tick for sphere (not frozen)', () => {
    // Bullet fired horizontally at 45° latitude (y=0.25 → phi=π/4)
    const initial: Bullet = { x: 0.0, y: 0.25, dirX: 1.0, dirY: 0.0, age: 0 };
    const path = simulateSphereBullets(initial, 60, 1 / 60);

    // Direction vector should have changed — not frozen
    const finalBullet = path[path.length - 1];
    expect(finalBullet.dirX).not.toBeCloseTo(1.0, 3);
    // dirY should have become non-zero (developing southward component toward equator)
    expect(Math.abs(finalBullet.dirY)).toBeGreaterThan(0.01);
  });

  it('naive MP (no parallel transport) keeps direction frozen', () => {
    const initial: Bullet = { x: 0.0, y: 0.25, dirX: 1.0, dirY: 0.0, age: 0 };
    const path = simulateSphereBulletsNaive(initial, 60, 1 / 60);

    // Naive: dirX=1, dirY=0 throughout (never changes since we never update them)
    const finalBullet = path[path.length - 1];
    expect(finalBullet.dirX).toBeCloseTo(1.0, 5);
    expect(finalBullet.dirY).toBeCloseTo(0.0, 5);
  });

  it('geodesic bullet curves toward equator from northern latitude', () => {
    // At 45° lat (y=0.25), a horizontal bullet on a sphere should curve
    // southward (increasing y → toward equator at y=0.5).
    const initial: Bullet = { x: 0.0, y: 0.25, dirX: 1.0, dirY: 0.0, age: 0 };
    const path = simulateSphereBullets(initial, 120, 1 / 60);

    // After 2 seconds, the bullet should have moved toward the equator
    const startY = initial.y;
    const endY = path[path.length - 1].y;
    // Geodesic from northern latitude curves equator-ward (y increases)
    expect(endY).toBeGreaterThan(startY);
  });

  it('direction vector stays normalized after parallel transport', () => {
    const initial: Bullet = { x: 0.0, y: 0.3, dirX: 0.6, dirY: 0.8, age: 0 };
    const path = simulateSphereBullets(initial, 200, 1 / 60);

    for (const b of path) {
      const len = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
      expect(len).toBeCloseTo(1.0, 4);
    }
  });

  it('bullet near equator (y=0.5) changes direction due to geodesic curvature', () => {
    // At equator, cotPhi = 0, so NO curvature in u from Γ^u_uv.
    // But dDirY = sin(π/2)*cos(π/2)*dirX² = 0 too. So equator is a geodesic!
    // For a purely horizontal bullet at equator, direction stays constant.
    const initial: Bullet = { x: 0.0, y: 0.5, dirX: 1.0, dirY: 0.0, age: 0 };
    const path = simulateSphereBullets(initial, 60, 1 / 60);

    // At equator, horizontal bullets follow a great circle — direction stays (1,0)
    const finalBullet = path[path.length - 1];
    expect(Math.abs(finalBullet.dirX)).toBeGreaterThan(0.99);
    expect(Math.abs(finalBullet.dirY)).toBeLessThan(0.05);
  });

  it('torus bullet direction changes due to geodesic curvature', () => {
    // Simulate torus parallel transport inline
    const TORUS_r = 0.375;
    let b: Bullet = { x: 0.0, y: 0.25, dirX: 1.0, dirY: 0.0, age: 0 };
    const dt = 1 / 60;
    const ticks = 60;

    for (let i = 0; i < ticks; i++) {
      const v = b.y * 2 * Math.PI;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      const rho = Math.max(1 + TORUS_r * cosV, 0.1);

      const Gamma_u_uv = -TORUS_r * sinV / rho;
      const Gamma_v_uu = rho * sinV / TORUS_r;
      const step = BULLET_SPEED * dt;
      const prevDirX = b.dirX;
      b.dirX += -2 * Gamma_u_uv * b.dirX * b.dirY * step;
      b.dirY += -Gamma_v_uu * prevDirX * prevDirX * step;
      const len = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
      if (len > 0.001) { b.dirX /= len; b.dirY /= len; }

      b.x += (b.dirX / rho) * BULLET_SPEED * dt;
      b.y += (b.dirY / TORUS_r) * BULLET_SPEED * dt;
      b.age += dt;
    }

    // Direction vector should have changed from (1, 0)
    expect(Math.abs(b.dirY)).toBeGreaterThan(0.01);
    // Should stay normalized
    const finalLen = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
    expect(finalLen).toBeCloseTo(1.0, 3);
  });

  it('torus outer equator bullet (v=0) stays horizontal — outer equator is a geodesic', () => {
    // At v=0 (outer equator): sinV=0 → all Christoffel terms = 0.
    // A horizontal bullet stays horizontal (outer equator is a great circle).
    const TORUS_r = 0.375;
    let b: Bullet = { x: 0.0, y: 0.0, dirX: 1.0, dirY: 0.0, age: 0 };
    const dt = 1 / 60;

    for (let i = 0; i < 60; i++) {
      const v = b.y * 2 * Math.PI;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      const rho = Math.max(1 + TORUS_r * cosV, 0.1);

      const Gamma_u_uv = -TORUS_r * sinV / rho;
      const Gamma_v_uu = rho * sinV / TORUS_r;
      const step = BULLET_SPEED * dt;
      const prevDirX = b.dirX;
      b.dirX += -2 * Gamma_u_uv * b.dirX * b.dirY * step;
      b.dirY += -Gamma_v_uu * prevDirX * prevDirX * step;
      const len = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
      if (len > 0.001) { b.dirX /= len; b.dirY /= len; }

      b.x += (b.dirX / rho) * BULLET_SPEED * dt;
      b.y += (b.dirY / TORUS_r) * BULLET_SPEED * dt;
      b.age += dt;
    }

    // Outer equator is a geodesic: direction should stay horizontal
    expect(b.dirX).toBeCloseTo(1.0, 2);
    expect(Math.abs(b.dirY)).toBeLessThan(0.05);
  });
});
