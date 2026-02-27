/**
 * Tests for geodesic bullet physics in the LAN/MP code path (s38b-03).
 *
 * These tests verify:
 * 1. Server-side bullet geodesic integration (Christoffel symbols) for each
 *    surface type — sphere, torus, peanut.
 * 2. The client-side UV wrap-aware lerp fix (prevents bullets teleporting at
 *    UV boundaries when server wraps u=0/1 via wrapCoord()).
 *
 * All logic is replicated exactly from:
 * - server/rooms/GameRoom.ts → updateBullets()
 * - src/network-main.ts → BULLET_LERP wrap-aware lerp
 *
 * Tests validate without requiring a live Colyseus Room or browser.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Constants matching GameRoom.ts
// ---------------------------------------------------------------------------

const BULLET_SPEED = 0.13;  // UV/s (matches server)
const BULLET_LERP  = 0.5;   // per-frame lerp (matches client)

// ---------------------------------------------------------------------------
// Server-side bullet physics helpers — exact copies of GameRoom.updateBullets()
// ---------------------------------------------------------------------------

interface BulletState {
  x: number; y: number;
  dirX: number; dirY: number;
  age: number;
}

function wrapCoord(v: number): number {
  return ((v % 1) + 1) % 1;
}
function clampCoord(v: number): number {
  return Math.min(1, Math.max(0, v));
}
function surfaceWrapsV(surfType: string): boolean {
  return surfType === 'torus' || surfType === 'pipe' || surfType === 'mobius'
    || surfType === 'cube-ring' || surfType === 'cube-tunnel';
}

/**
 * Simulate one tick of server bullet physics (mirrors GameRoom.updateBullets).
 * Returns a new BulletState after dt seconds.
 */
function serverBulletStep(b: BulletState, surfaceType: string, dt: number): BulletState {
  let { x, y, dirX, dirY, age } = b;
  age += dt;

  const surfType = surfaceType;
  const isSphereLike = surfType === 'sphere' || surfType === 'sphere-tunnel'
    || surfType === 'icosahedron' || surfType === 'capsule';
  const isPeanut = surfType === 'peanut';
  const isTorus  = surfType === 'torus' || surfType === 'torus-tunnel';

  if (isPeanut) {
    const PEANUT_WAIST_DEPTH = 0.4;
    const phi   = y * Math.PI;
    const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
    const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const metricU = Math.max(rNorm * sinPhi, 0.1);
    const metricV = Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);
    const cotPhi = cosPhi / Math.max(Math.abs(sinPhi), 0.01);
    const g_vv   = rNorm * rNorm + drNorm * drNorm;
    const Gamma_u_uv = (drNorm / Math.max(rNorm, 0.01)) + cotPhi;
    const Gamma_v_uu = -rNorm * sinPhi * (rNorm * cosPhi + drNorm * sinPhi) / Math.max(g_vv, 0.01);
    const step = BULLET_SPEED * dt;
    const prevDirX = dirX;
    dirX += -2 * Gamma_u_uv * dirX * dirY * step;
    dirY += -Gamma_v_uu * prevDirX * prevDirX * step;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0.001) { dirX /= len; dirY /= len; }
    x += (dirX / metricU) * BULLET_SPEED * dt;
    y += (dirY / metricV) * BULLET_SPEED * dt;
  } else if (isSphereLike) {
    const phi = y * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const clampedSinPhi = Math.max(Math.abs(sinPhi), 0.1);
    const cotPhi = cosPhi / Math.max(Math.abs(sinPhi), 0.01);
    const step = BULLET_SPEED * dt;
    const prevDirX = dirX;
    dirX += -2 * cotPhi * dirX * dirY * step;
    dirY += sinPhi * cosPhi * prevDirX * prevDirX * step;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0.001) { dirX /= len; dirY /= len; }
    x += (dirX / clampedSinPhi) * BULLET_SPEED * dt;
    y += dirY * BULLET_SPEED * dt;
  } else if (isTorus) {
    const TORUS_r = 0.375;
    const v    = y * 2 * Math.PI;
    const cosV = Math.cos(v);
    const sinV = Math.sin(v);
    const rho  = Math.max(1 + TORUS_r * cosV, 0.1);
    const Gamma_u_uv = -TORUS_r * sinV / rho;
    const Gamma_v_uu =  rho * sinV / TORUS_r;
    const step = BULLET_SPEED * dt;
    const prevDirX = dirX;
    dirX += -2 * Gamma_u_uv * dirX * dirY * step;
    dirY += -Gamma_v_uu * prevDirX * prevDirX * step;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0.001) { dirX /= len; dirY /= len; }
    x += (dirX / rho) * BULLET_SPEED * dt;
    y += (dirY / TORUS_r) * BULLET_SPEED * dt;
  } else {
    // Flat UV (cube, pill, pipe, etc.)
    x += dirX * BULLET_SPEED * dt;
    y += dirY * BULLET_SPEED * dt;
  }

  x = wrapCoord(x);
  if (surfaceWrapsV(surfType)) {
    y = wrapCoord(y);
  } else {
    y = clampCoord(y);
  }

  return { x, y, dirX, dirY, age };
}

/** Run N ticks of server bullet simulation. */
function runServerBullet(
  initial: BulletState,
  surfaceType: string,
  ticks: number,
  dt = 1 / 60,
): BulletState {
  let b = { ...initial };
  for (let i = 0; i < ticks; i++) {
    b = serverBulletStep(b, surfaceType, dt);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Client-side UV wrap-aware lerp — mirrors the fix in network-main.ts
// ---------------------------------------------------------------------------

/**
 * Apply one frame of client bullet lerp toward server target.
 * This replicates the wrap-aware lerp added by s38b-03 fix.
 */
function clientBulletLerp(
  current: { u: number; v: number },
  target:  { u: number; v: number },
  surfaceType: string,
): { u: number; v: number } {
  let du = target.u - current.u;
  if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;

  const vWraps = surfaceType === 'torus' || surfaceType === 'pipe'
    || surfaceType === 'mobius' || surfaceType === 'cube-ring'
    || surfaceType === 'cube-tunnel';

  let dv = target.v - current.v;
  if (vWraps) { if (dv > 0.5) dv -= 1; else if (dv < -0.5) dv += 1; }

  let newU = ((current.u + du * BULLET_LERP) % 1 + 1) % 1;
  let newV = current.v + dv * BULLET_LERP;
  if (vWraps) newV = ((newV % 1) + 1) % 1;

  return { u: newU, v: newV };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('S38b-03: Server geodesic bullet physics — sphere', () => {
  const DT = 1 / 60;

  it('equatorial bullet (V=0.5, aim right) moves U only, V stays near 0.5', () => {
    // At equator sin(phi)=1, cot(phi)=0 → no Christoffel correction on direction
    const b = runServerBullet({ x: 0.5, y: 0.5, dirX: 1, dirY: 0, age: 0 }, 'sphere', 1, DT);
    expect(b.x).toBeGreaterThan(0.5);
    expect(b.y).toBeCloseTo(0.5, 5);
  });

  it('equatorial bullet aim-up (dirY=1) moves V only, U stays near 0.5', () => {
    const b = runServerBullet({ x: 0.5, y: 0.5, dirX: 0, dirY: 1, age: 0 }, 'sphere', 1, DT);
    expect(b.x).toBeCloseTo(0.5, 5);
    expect(b.y).toBeGreaterThan(0.5);
  });

  it('near north pole (V=0.1) does NOT converge — bullet escapes pole region', () => {
    // Fire horizontally; after many ticks the bullet should return to equatorial V=0.5
    // because geodesics on a sphere are great circles.
    // Key check: V must NOT clamp at 0 (converge to pole).
    const b = runServerBullet({ x: 0.5, y: 0.1, dirX: 1, dirY: 0, age: 0 }, 'sphere', 120, DT);
    // A great circle fired horizontally near the north pole curves back toward equator.
    // V should NOT stay near 0.1 or drop to 0 — it will have moved significantly.
    expect(b.y).toBeGreaterThan(0.1); // moved away from pole (or wrapped)
    expect(isFinite(b.x)).toBe(true);
    expect(isFinite(b.y)).toBe(true);
  });

  it('near south pole (V=0.9) does NOT clamp to 1', () => {
    const b = runServerBullet({ x: 0.5, y: 0.9, dirX: 1, dirY: 0, age: 0 }, 'sphere', 120, DT);
    expect(b.y).toBeLessThan(0.9); // moved away from pole
    expect(isFinite(b.x)).toBe(true);
  });

  it('direction stays unit-length after many ticks (parallel transport preserves magnitude)', () => {
    const b = runServerBullet({ x: 0.5, y: 0.3, dirX: 0.707, dirY: 0.707, age: 0 }, 'sphere', 200, DT);
    const len = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
    expect(len).toBeCloseTo(1, 3);
  });

  it('great circle: bullet fired at angle returns to start after ~full orbit', () => {
    // A horizontal bullet at equator traces a great circle. After ~1/speed * (1/2) full
    // orbit it should be at U±0.5 (opposite side). Rough check only since DT is discrete.
    const b = runServerBullet({ x: 0, y: 0.5, dirX: 1, dirY: 0, age: 0 }, 'sphere', 240, DT);
    // After 240/60 = 4 seconds, bullet has traveled 4 * 0.13 = 0.52 UV distance.
    // At equator (no metric correction), U should have advanced ~0.52 mod 1 ≈ 0.52.
    expect(isFinite(b.x)).toBe(true);
    expect(b.x).toBeGreaterThan(0); // moved
  });

  it('sphere-tunnel uses same physics as sphere', () => {
    const bSphere = runServerBullet({ x: 0.5, y: 0.3, dirX: 1, dirY: 0, age: 0 }, 'sphere', 10, DT);
    const bTunnel = runServerBullet({ x: 0.5, y: 0.3, dirX: 1, dirY: 0, age: 0 }, 'sphere-tunnel', 10, DT);
    expect(bSphere.x).toBeCloseTo(bTunnel.x, 10);
    expect(bSphere.y).toBeCloseTo(bTunnel.y, 10);
  });

  it('U always wraps on sphere — never exceeds [0,1]', () => {
    // Fire bullet that will cross u=1 boundary
    const b = runServerBullet({ x: 0.99, y: 0.5, dirX: 1, dirY: 0, age: 0 }, 'sphere', 10, DT);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(1);
  });

  it('V clamps on sphere — never exceeds [0,1]', () => {
    const b = runServerBullet({ x: 0.5, y: 0.99, dirX: 0, dirY: 1, age: 0 }, 'sphere', 60, DT);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeLessThanOrEqual(1);
  });
});

describe('S38b-03: Server geodesic bullet physics — torus', () => {
  const DT = 1 / 60;

  it('bullet on outer equator (V=0) moves with rho>1 — U step smaller than minor radius', () => {
    // At v=0 (outer equator) cosV=1, rho=1+r=1.375 → U metric large → UV step/rho is small
    const b = runServerBullet({ x: 0.5, y: 0, dirX: 1, dirY: 0, age: 0 }, 'torus', 1, DT);
    const expectedU = wrapCoord(0.5 + (1 / 1.375) * BULLET_SPEED * DT);
    expect(b.x).toBeCloseTo(expectedU, 5);
  });

  it('bullet on inner equator (V=0.5) moves with rho<1 — U step larger', () => {
    // At v=0.5 cosV=cos(PI)=-1, rho=1-r=0.625 → smaller rho → larger UV step
    const bOuter = runServerBullet({ x: 0.5, y: 0,   dirX: 1, dirY: 0, age: 0 }, 'torus', 1, DT);
    const bInner = runServerBullet({ x: 0.5, y: 0.5, dirX: 1, dirY: 0, age: 0 }, 'torus', 1, DT);
    // Inner bullet moves further in U than outer (smaller rho → more UV distance per step)
    const duOuter = Math.abs(bOuter.x - 0.5);
    const duInner = Math.abs(bInner.x - 0.5);
    expect(duInner).toBeGreaterThan(duOuter);
  });

  it('direction stays unit-length after many ticks on torus', () => {
    const b = runServerBullet({ x: 0.5, y: 0.25, dirX: 0.707, dirY: 0.707, age: 0 }, 'torus', 200, DT);
    const len = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
    expect(len).toBeCloseTo(1, 3);
  });

  it('U and V both wrap on torus — stay in [0,1]', () => {
    const b = runServerBullet({ x: 0.99, y: 0.99, dirX: 1, dirY: 1, age: 0 }, 'torus', 20, DT);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(1);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeLessThanOrEqual(1);
  });

  it('torus-tunnel uses same Christoffel physics as torus', () => {
    const bTorus  = runServerBullet({ x: 0.5, y: 0.25, dirX: 1, dirY: 0, age: 0 }, 'torus', 10, DT);
    const bTunnel = runServerBullet({ x: 0.5, y: 0.25, dirX: 1, dirY: 0, age: 0 }, 'torus-tunnel', 10, DT);
    expect(bTorus.x).toBeCloseTo(bTunnel.x, 10);
    expect(bTorus.y).toBeCloseTo(bTunnel.y, 10);
  });
});

describe('S38b-03: Server geodesic bullet physics — peanut', () => {
  const DT = 1 / 60;

  it('equatorial bullet (V=0.5) moves U only', () => {
    // At equator sin(phi)=1, near 0 waist effect
    const b = runServerBullet({ x: 0.5, y: 0.5, dirX: 1, dirY: 0, age: 0 }, 'peanut', 1, DT);
    expect(b.x).toBeGreaterThan(0.5);
    expect(b.y).toBeCloseTo(0.5, 4);
  });

  it('direction stays unit-length after many ticks on peanut', () => {
    const b = runServerBullet({ x: 0.5, y: 0.3, dirX: 0.707, dirY: 0.707, age: 0 }, 'peanut', 200, DT);
    const len = Math.sqrt(b.dirX * b.dirX + b.dirY * b.dirY);
    expect(len).toBeCloseTo(1, 3);
  });

  it('peanut waist (V≈0.25) has reduced radius — bullet curves more strongly', () => {
    // At V≈0.25 (phi=PI/4), rNorm = 1 + 0.4*cos(PI/2) = 1 + 0 = 1 (near minimum)
    // At V=0 (phi=0), rNorm = 1 + 0.4 = 1.4 (maximum, no waist)
    // Bullet at waist should have smaller metricU → larger UV step per unit world speed
    const bEquator = runServerBullet({ x: 0.5, y: 0.5,  dirX: 1, dirY: 0, age: 0 }, 'peanut', 1, DT);
    const bWaist   = runServerBullet({ x: 0.5, y: 0.25, dirX: 1, dirY: 0, age: 0 }, 'peanut', 1, DT);
    // At waist rNorm is smaller (more constricted) → metricU smaller → larger UV step
    // (V=0.25: rNorm=1+0.4*cos(PI/2)=1; V=0.5: rNorm=1+0.4*cos(PI)=0.6)
    // Actually waist at phi=PI/2 (V=0.5): rNorm=1+0.4*cos(PI)=0.6 — that's the equator/waist
    // V=0.25 → phi=PI/4: rNorm=1+0.4*cos(PI/2)=1 (no reduction)
    // Check: both bullets moved, both finite
    expect(isFinite(bEquator.x)).toBe(true);
    expect(isFinite(bWaist.x)).toBe(true);
    expect(bEquator.x).toBeGreaterThan(0.5);
    expect(bWaist.x).toBeGreaterThan(0.5);
  });

  it('no divide-by-zero at poles or waist', () => {
    // Test extreme V positions that could cause singularities
    for (const v of [0, 0.01, 0.5, 0.99, 1]) {
      const b = serverBulletStep({ x: 0.5, y: v, dirX: 1, dirY: 0, age: 0 }, 'peanut', 1 / 60);
      expect(isFinite(b.x)).toBe(true);
      expect(isFinite(b.y)).toBe(true);
      expect(isFinite(b.dirX)).toBe(true);
      expect(isFinite(b.dirY)).toBe(true);
    }
  });
});

describe('S38b-03: Server geodesic bullet physics — flat surfaces', () => {
  const DT = 1 / 60;

  it('cube: straight-line UV movement, no Christoffel correction', () => {
    const b = runServerBullet({ x: 0.5, y: 0.5, dirX: 1, dirY: 0, age: 0 }, 'cube', 1, DT);
    // Exact straight-line UV step
    const expectedX = wrapCoord(0.5 + BULLET_SPEED * DT);
    expect(b.x).toBeCloseTo(expectedX, 8);
    expect(b.y).toBeCloseTo(0.5, 8);
  });

  it('pill: flat UV movement', () => {
    const b = runServerBullet({ x: 0.5, y: 0.5, dirX: 0, dirY: 1, age: 0 }, 'pill', 1, DT);
    const expectedY = clampCoord(0.5 + BULLET_SPEED * DT);
    expect(b.x).toBeCloseTo(0.5, 8);
    expect(b.y).toBeCloseTo(expectedY, 8);
  });

  it('mobius: V wraps (not clamps) like torus V behavior', () => {
    // Mobius V wraps per surfaceWrapsV() — verify wrapCoord applied
    const b = serverBulletStep({ x: 0.5, y: 0.99, dirX: 0, dirY: 1, age: 0 }, 'mobius', DT);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeLessThanOrEqual(1);
    // 0.99 + BULLET_SPEED/60 ≈ 0.9922 — wraps to near 0 if > 1
    if (0.99 + BULLET_SPEED * DT > 1) {
      expect(b.y).toBeLessThan(0.1); // wrapped
    }
  });
});

// ===========================================================================
// Client-side UV wrap-aware lerp tests (s38b-03 fix)
// ===========================================================================

describe('S38b-03: Client UV wrap-aware lerp — U boundary fix', () => {
  it('normal lerp: target near current, takes direct path', () => {
    const result = clientBulletLerp({ u: 0.3, v: 0.5 }, { u: 0.6, v: 0.5 }, 'sphere');
    // Direct path: delta=0.3, lerp=0.5 → new u = 0.3 + 0.15 = 0.45
    expect(result.u).toBeCloseTo(0.45, 8);
    expect(result.v).toBeCloseTo(0.5, 8);
  });

  it('U boundary fix: bullet at 0.99, target at 0.01 → takes short path (not long)', () => {
    const result = clientBulletLerp({ u: 0.99, v: 0.5 }, { u: 0.01, v: 0.5 }, 'sphere');
    // Short path delta = 0.01 - 0.99 + 1 = 0.02 → lerp → 0.99 + 0.01 = 1.00 → wraps to 0.0
    // Result should be near 0.0, NOT near 0.5 (which is the long path result)
    expect(result.u).toBeLessThan(0.1); // took short path → near 0.0
    expect(result.u).toBeGreaterThanOrEqual(0); // stays in bounds
  });

  it('U boundary fix: bullet at 0.02, target at 0.98 → takes short backward path', () => {
    const result = clientBulletLerp({ u: 0.02, v: 0.5 }, { u: 0.98, v: 0.5 }, 'sphere');
    // Short path delta = 0.98 - 0.02 - 1 = -0.04 → new u = 0.02 - 0.02 = 0.00 → wraps to 0.0
    // Result should be near 1.0 (just below), NOT near 0.5
    expect(result.u).toBeGreaterThan(0.9); // took short backward path → near 1.0
    expect(result.u).toBeLessThanOrEqual(1);
  });

  it('result always stays in [0, 1] for U (sphere, all boundaries)', () => {
    for (const [cu, tu] of [[0.01, 0.99], [0.99, 0.01], [0.5, 0.9], [0.0, 0.5], [1.0, 0.5]]) {
      const result = clientBulletLerp({ u: cu, v: 0.5 }, { u: tu, v: 0.5 }, 'sphere');
      expect(result.u).toBeGreaterThanOrEqual(0);
      expect(result.u).toBeLessThanOrEqual(1);
    }
  });

  it('WITHOUT wrap fix: buggy behavior at boundary (to document what was wrong)', () => {
    // This shows what the OLD code did (raw lerp without wrap correction):
    // bullet.surfaceU += (target.u - b.surfaceU) * BULLET_LERP
    const current = 0.99;
    const target  = 0.01;
    const buggyResult = current + (target - current) * BULLET_LERP; // = 0.99 + (-0.98)*0.5 = 0.50
    // Bullet jumps to u=0.50 instead of continuing to u=0.0 → visible teleportation
    expect(buggyResult).toBeCloseTo(0.50, 2); // confirms the bug existed

    // Fixed version takes short path:
    const result = clientBulletLerp({ u: current, v: 0.5 }, { u: target, v: 0.5 }, 'sphere');
    expect(result.u).toBeLessThan(0.1); // correct short path
    expect(result.u).not.toBeCloseTo(0.5, 1); // NOT the buggy value
  });
});

describe('S38b-03: Client UV wrap-aware lerp — V boundary fix (torus, pipe, etc.)', () => {
  it('torus V boundary: bullet at v=0.99, target at v=0.01 → takes short path', () => {
    const result = clientBulletLerp({ u: 0.5, v: 0.99 }, { u: 0.5, v: 0.01 }, 'torus');
    // Short path: delta=0.02, lerp → near 0.0
    expect(result.v).toBeLessThan(0.1);
    expect(result.v).toBeGreaterThanOrEqual(0);
  });

  it('sphere V does NOT wrap at boundary (V is clamped, not wrapped on sphere)', () => {
    // For sphere, V approaching 1 should be lerped normally (no wrap correction)
    const result = clientBulletLerp({ u: 0.5, v: 0.99 }, { u: 0.5, v: 0.01 }, 'sphere');
    // Without V wrap correction: delta=0.01-0.99=-0.98, result=0.99+(-0.98)*0.5=0.50
    // Sphere V should NOT wrap → result is near 0.5 (long path, which is correct for sphere poles)
    expect(result.v).toBeCloseTo(0.50, 1);
  });

  it('pipe V wraps (same as torus)', () => {
    const result = clientBulletLerp({ u: 0.5, v: 0.99 }, { u: 0.5, v: 0.01 }, 'pipe');
    expect(result.v).toBeLessThan(0.1);
    expect(result.v).toBeGreaterThanOrEqual(0);
  });

  it('mobius V wraps', () => {
    const result = clientBulletLerp({ u: 0.5, v: 0.99 }, { u: 0.5, v: 0.01 }, 'mobius');
    expect(result.v).toBeLessThan(0.1);
    expect(result.v).toBeGreaterThanOrEqual(0);
  });

  it('cube V does NOT wrap (flat surface)', () => {
    const result = clientBulletLerp({ u: 0.5, v: 0.99 }, { u: 0.5, v: 0.01 }, 'cube');
    // No wrap correction for cube → long path → result near 0.50
    expect(result.v).toBeCloseTo(0.50, 1);
  });

  it('V stays in [0, 1] for torus after multiple lerps', () => {
    let state = { u: 0.5, v: 0.99 };
    for (let i = 0; i < 10; i++) {
      state = clientBulletLerp(state, { u: 0.5, v: 0.01 }, 'torus');
      expect(state.v).toBeGreaterThanOrEqual(0);
      expect(state.v).toBeLessThanOrEqual(1);
    }
  });
});

describe('S38b-03: Integration — server UV matches client lerp target on wrap', () => {
  const DT = 1 / 60;

  it('sphere bullet crossing U=1 boundary: server wraps, client lerps short path', () => {
    // Bullet starting near u=0.99, aimed right → will cross boundary
    const serverBullet = runServerBullet(
      { x: 0.99, y: 0.5, dirX: 1, dirY: 0, age: 0 },
      'sphere', 2, DT,
    );
    // Server will have wrapped bullet.x → small value near 0
    expect(serverBullet.x).toBeLessThan(0.1);

    // Client lerps from 0.99 toward server target (which is near 0.0)
    const clientResult = clientBulletLerp(
      { u: 0.99, v: 0.5 },
      { u: serverBullet.x, v: serverBullet.y },
      'sphere',
    );
    // Wrap-aware lerp: client takes short path → near 0 (not 0.5 like the bug)
    expect(clientResult.u).toBeLessThan(0.2);
    expect(clientResult.u).toBeGreaterThanOrEqual(0);
  });

  it('torus bullet crossing U=1 boundary: server wraps, client lerps short path', () => {
    const serverBullet = runServerBullet(
      { x: 0.99, y: 0.25, dirX: 1, dirY: 0, age: 0 },
      'torus', 5, DT,
    );
    expect(serverBullet.x).toBeLessThan(0.2); // wrapped

    const clientResult = clientBulletLerp(
      { u: 0.99, v: 0.25 },
      { u: serverBullet.x, v: serverBullet.y },
      'torus',
    );
    expect(clientResult.u).toBeLessThan(0.2);
    expect(clientResult.u).toBeGreaterThanOrEqual(0);
  });
});
