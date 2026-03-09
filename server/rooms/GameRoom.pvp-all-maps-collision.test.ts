/**
 * s44r6-06: PvP Damage Cross-Map Test — Verify bullet-player collision on ALL surfaces.
 *
 * Tests that a bullet spawned at a shooter's position, aimed at a target on the
 * same surface, reaches within BULLET_HIT_WORLD distance on every map type.
 *
 * Each surface uses its own distance function (matching GameRoom.ts surfaceWorldDist).
 * Bullet movement is surface-specific (matching GameRoom.ts updateBullets).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Constants matching GameRoom.ts
// ---------------------------------------------------------------------------
const BULLET_SPEED = 0.13;
const BULLET_LIFETIME = 6.0;
const BULLET_HIT_WORLD = 0.4;
const DT = 1 / 60;
const TOTAL_TICKS = Math.ceil(BULLET_LIFETIME / DT);

// Peanut constants
const PEANUT_BASE_RADIUS = 6;
const PEANUT_WAIST_DEPTH = 0.4;

// Torus constants
const TORUS_MAJOR_R = 8;
const TORUS_MINOR_R = 3;

// Pill constants
const PILL_RADIUS = 10;
const PILL_HEIGHT = 20;
const PILL_HALF_HEIGHT = PILL_HEIGHT / 2;
const PILL_CAP_ARC = (Math.PI / 2) * PILL_RADIUS;
const PILL_TOTAL_V_LEN = PILL_HEIGHT + 2 * PILL_CAP_ARC;
const PILL_CAP_FRAC = PILL_CAP_ARC / PILL_TOTAL_V_LEN;

// Mobius constants
const MOBIUS_MAJOR_R = 8;
const MOBIUS_STRIP_W = 3;

// Cube constants
const CUBE_BASE_SIZE = 10;
const CUBE_BASE_BEVEL = 0.6;

// ---------------------------------------------------------------------------
// Distance functions (copied from GameRoom.ts)
// ---------------------------------------------------------------------------
function sphereGreatCircleDist(u1: number, v1: number, u2: number, v2: number, R: number): number {
  const phi1 = v1 * Math.PI, phi2 = v2 * Math.PI;
  const theta1 = u1 * 2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const dot = Math.sin(phi1) * Math.cos(theta1) * Math.sin(phi2) * Math.cos(theta2)
    + Math.sin(phi1) * Math.sin(theta1) * Math.sin(phi2) * Math.sin(theta2)
    + Math.cos(phi1) * Math.cos(phi2);
  return R * Math.acos(Math.max(-1, Math.min(1, dot)));
}

function peanutChordDist(u1: number, v1: number, u2: number, v2: number, sf = 1): number {
  const B = PEANUT_BASE_RADIUS * sf, W = PEANUT_WAIST_DEPTH;
  const phi1 = v1 * Math.PI, theta1 = u1 * 2 * Math.PI;
  const r1 = B * (1 + W * Math.cos(2 * phi1));
  const phi2 = v2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const r2 = B * (1 + W * Math.cos(2 * phi2));
  const dx = r1 * Math.sin(phi1) * Math.cos(theta1) - r2 * Math.sin(phi2) * Math.cos(theta2);
  const dy = r1 * Math.cos(phi1) - r2 * Math.cos(phi2);
  const dz = r1 * Math.sin(phi1) * Math.sin(theta1) - r2 * Math.sin(phi2) * Math.sin(theta2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function torusChordDist(u1: number, v1: number, u2: number, v2: number, sf = 1): number {
  const R = TORUS_MAJOR_R * sf, r = TORUS_MINOR_R * sf;
  const theta1 = u1 * 2 * Math.PI, phi1 = v1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI, phi2 = v2 * 2 * Math.PI;
  const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
  const dy = r * Math.sin(theta1) - r * Math.sin(theta2);
  const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pillPoint3D(u: number, v: number, sf = 1): [number, number, number] {
  const r = PILL_RADIUS * sf, halfH = PILL_HALF_HEIGHT * sf, heightS = PILL_HEIGHT * sf;
  const theta = u * 2 * Math.PI, cosT = Math.cos(theta), sinT = Math.sin(theta);
  const cf = PILL_CAP_FRAC;
  if (v <= cf) {
    const localT = cf > 0 ? v / cf : 1;
    const phi = Math.PI - localT * (Math.PI / 2);
    return [r * Math.sin(phi) * cosT, -halfH + r * Math.cos(phi), r * Math.sin(phi) * sinT];
  }
  if (v >= 1 - cf) {
    const localT = cf > 0 ? (v - (1 - cf)) / cf : 1;
    const phi = (Math.PI / 2) * (1 - localT);
    return [r * Math.sin(phi) * cosT, halfH + r * Math.cos(phi), r * Math.sin(phi) * sinT];
  }
  const bodyRange = 1 - 2 * cf;
  const localT = bodyRange > 0 ? (v - cf) / bodyRange : 0.5;
  return [r * cosT, -halfH + localT * heightS, r * sinT];
}

function pillChordDist(u1: number, v1: number, u2: number, v2: number, sf = 1): number {
  const [x1, y1, z1] = pillPoint3D(u1, v1, sf);
  const [x2, y2, z2] = pillPoint3D(u2, v2, sf);
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2);
}

function mobiusPoint3D(u: number, v: number, sf = 1): [number, number, number] {
  const R = MOBIUS_MAJOR_R * sf, w = MOBIUS_STRIP_W * sf;
  const t = u * 2 * Math.PI, s = (v - 0.5) * 2 * w, halfT = t / 2;
  return [
    (R + s * Math.cos(halfT)) * Math.cos(t),
    (R + s * Math.cos(halfT)) * Math.sin(t),
    s * Math.sin(halfT),
  ];
}

function mobiusChordDist(u1: number, v1: number, u2: number, v2: number, sf = 1): number {
  const [x1, y1, z1] = mobiusPoint3D(u1, v1, sf);
  const [x2, y2, z2] = mobiusPoint3D(u2, v2, sf);
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2);
}

// Cube distance (simplified — uses flat face approximation)
function cubeChordDist(u1: number, v1: number, u2: number, v2: number, sf = 1): number {
  // For cube, UV is roughly uniform on each face. Use UV Euclidean × world scale.
  // Cube has 4 side faces × 2 top/bottom = effective perimeter 4 × size.
  const size = CUBE_BASE_SIZE * sf;
  const du = u1 - u2; const dv = v1 - v2;
  // Wrap U
  let wdu = du; if (wdu > 0.5) wdu -= 1; if (wdu < -0.5) wdu += 1;
  return Math.sqrt((wdu * 4 * size) ** 2 + (dv * 2 * size) ** 2);
}

// ---------------------------------------------------------------------------
// Bullet simulation per surface type
// ---------------------------------------------------------------------------
interface SimResult { minDist: number; hitTick: number }

function simSphere(su: number, sv: number, tu: number, tv: number, R = 10): SimResult {
  // Sphere: parallel transport + sinPhi metric correction
  const aimAngle = simpleAimAngle(su, sv, tu, tv);
  let dirX = Math.cos(aimAngle), dirY = Math.sin(aimAngle);
  let bx = su, by = sv;
  let minDist = Infinity, hitTick = -1;

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const dist = sphereGreatCircleDist(bx, by, tu, tv, R);
    if (dist < minDist) { minDist = dist; hitTick = tick; }

    const phi = by * Math.PI;
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const clampedSinPhi = Math.max(Math.abs(sinPhi), 0.1);
    // Parallel transport
    const cotPhi = cosPhi / Math.max(Math.abs(sinPhi), 0.01);
    const step = BULLET_SPEED * DT;
    const prevDirX = dirX;
    dirX += -2 * cotPhi * dirX * dirY * step;
    dirY += sinPhi * cosPhi * prevDirX * prevDirX * step;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0.001) { dirX /= len; dirY /= len; }

    bx += (dirX / clampedSinPhi) * BULLET_SPEED * DT;
    by += dirY * BULLET_SPEED * DT;
    bx = ((bx % 1) + 1) % 1;
    // Pole crossing
    if (by < 0) { by = -by; bx = ((bx + 0.5) % 1 + 1) % 1; dirX = -dirX; dirY = -dirY; }
    else if (by > 1) { by = 2 - by; bx = ((bx + 0.5) % 1 + 1) % 1; dirX = -dirX; dirY = -dirY; }
  }
  return { minDist, hitTick };
}

function simPeanut(su: number, sv: number, tu: number, tv: number): SimResult {
  // Same as in pvp-peanut-collision test
  const aimAngle = peanutAimAngle(su, sv, tu, tv);
  const rawDirX = Math.cos(aimAngle);
  const rawDirY = Math.sin(aimAngle) * 2; // 2π/π asymmetry fix
  const corrLen = Math.sqrt(rawDirX * rawDirX + rawDirY * rawDirY);
  const dirX = rawDirX / corrLen, dirY = rawDirY / corrLen;
  let bx = su, by = sv;
  let minDist = Infinity, hitTick = -1;

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const dist = peanutChordDist(bx, by, tu, tv);
    if (dist < minDist) { minDist = dist; hitTick = tick; }
    const phi = by * Math.PI;
    const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
    const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
    const sinPhi = Math.sin(phi);
    const metricU = Math.max(rNorm * sinPhi, 0.3);
    const metricV = Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);
    bx += (dirX / metricU) * BULLET_SPEED * DT;
    by += (dirY / metricV) * BULLET_SPEED * DT;
    bx = ((bx % 1) + 1) % 1;
    by = Math.max(0.001, Math.min(0.999, by));
  }
  return { minDist, hitTick };
}

function simTorus(su: number, sv: number, tu: number, tv: number): SimResult {
  // Note: GameRoom.ts negates dirX for torus at spawn to match client tangent convention.
  // Here we use UV-space aim angle directly, so no negation needed — the UV direction
  // already points from shooter to target correctly.
  const aimAngle = simpleAimAngle(su, sv, tu, tv);
  let dirX = Math.cos(aimAngle);
  let dirY = Math.sin(aimAngle);
  let bx = su, by = sv;
  let minDist = Infinity, hitTick = -1;
  const TORUS_r = 0.375;

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const dist = torusChordDist(bx, by, tu, tv);
    if (dist < minDist) { minDist = dist; hitTick = tick; }
    const v = by * 2 * Math.PI;
    const cosV = Math.cos(v), sinV = Math.sin(v);
    const rho = Math.max(1 + TORUS_r * cosV, 0.1);
    const Gamma_u_uv = -TORUS_r * sinV / rho;
    const Gamma_v_uu = rho * sinV / TORUS_r;
    const step = BULLET_SPEED * DT;
    const prevDirX = dirX;
    dirX += -2 * Gamma_u_uv * dirX * dirY * step;
    dirY += -Gamma_v_uu * prevDirX * prevDirX * step;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0.001) { dirX /= len; dirY /= len; }
    bx += (dirX / rho) * BULLET_SPEED * DT;
    by += (dirY / TORUS_r) * BULLET_SPEED * DT;
    bx = ((bx % 1) + 1) % 1;
    by = ((by % 1) + 1) % 1;
  }
  return { minDist, hitTick };
}

function simFlat(su: number, sv: number, tu: number, tv: number, distFn: (u1: number, v1: number, u2: number, v2: number) => number): SimResult {
  // Flat surfaces: cube, mobius, pipe — straight line UV
  const aimAngle = simpleAimAngle(su, sv, tu, tv);
  const dirX = Math.cos(aimAngle), dirY = Math.sin(aimAngle);
  let bx = su, by = sv;
  let minDist = Infinity, hitTick = -1;

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const dist = distFn(bx, by, tu, tv);
    if (dist < minDist) { minDist = dist; hitTick = tick; }
    bx += dirX * BULLET_SPEED * DT;
    by += dirY * BULLET_SPEED * DT;
    bx = ((bx % 1) + 1) % 1;
    by = Math.max(0.001, Math.min(0.999, by));
  }
  return { minDist, hitTick };
}

function simPill(su: number, sv: number, tu: number, tv: number): SimResult {
  const aimAngle = simpleAimAngle(su, sv, tu, tv);
  const dirX = Math.cos(aimAngle), dirY = Math.sin(aimAngle);
  let bx = su, by = sv;
  let minDist = Infinity, hitTick = -1;
  const cf = PILL_CAP_FRAC;

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const dist = pillChordDist(bx, by, tu, tv);
    if (dist < minDist) { minDist = dist; hitTick = tick; }
    let sinPhi = 1.0;
    if (by <= cf) {
      const localT = cf > 0 ? by / cf : 1;
      const phi = Math.PI - localT * (Math.PI / 2);
      sinPhi = Math.max(Math.abs(Math.sin(phi)), 0.1);
    } else if (by >= 1 - cf) {
      const localT = cf > 0 ? (by - (1 - cf)) / cf : 1;
      const phi = (Math.PI / 2) * (1 - localT);
      sinPhi = Math.max(Math.abs(Math.sin(phi)), 0.1);
    }
    bx += (dirX / sinPhi) * BULLET_SPEED * DT;
    by += dirY * BULLET_SPEED * DT;
    bx = ((bx % 1) + 1) % 1;
    by = Math.max(0.001, Math.min(0.999, by));
  }
  return { minDist, hitTick };
}

// ---------------------------------------------------------------------------
// Aim angle helpers
// ---------------------------------------------------------------------------

/** Simple UV-space aim angle: atan2 of UV delta. Works for flat/torus/sphere. */
function simpleAimAngle(su: number, sv: number, tu: number, tv: number): number {
  let du = tu - su; if (du > 0.5) du -= 1; if (du < -0.5) du += 1;
  const dv = tv - sv;
  return Math.atan2(dv, du);
}

/** Peanut aim angle: compute in world-space tangent frame (normalized). */
function peanutAimAngle(su: number, sv: number, tu: number, tv: number): number {
  const W = PEANUT_WAIST_DEPTH;
  const phi = sv * Math.PI, theta = su * 2 * Math.PI;
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const cosTheta = Math.cos(theta), sinTheta = Math.sin(theta);
  const rNorm = 1 + W * Math.cos(2 * phi);
  const drNorm = -2 * W * Math.sin(2 * phi);

  // Normalized tangent vectors
  const tuX = -sinPhi * sinTheta, tuZ = sinPhi * cosTheta;
  const tuLen = Math.sqrt(tuX * tuX + tuZ * tuZ) || 1;
  const tuNX = tuX / tuLen, tuNZ = tuZ / tuLen;

  const tvX = drNorm * sinPhi * cosTheta + rNorm * cosPhi * cosTheta;
  const tvY = drNorm * cosPhi - rNorm * sinPhi;
  const tvZ = drNorm * sinPhi * sinTheta + rNorm * cosPhi * sinTheta;
  const tvLen = Math.sqrt(tvX * tvX + tvY * tvY + tvZ * tvZ) || 1;
  const tvNX = tvX / tvLen, tvNY = tvY / tvLen, tvNZ = tvZ / tvLen;

  // World positions
  const B = PEANUT_BASE_RADIUS;
  const r1 = B * (1 + W * Math.cos(2 * phi));
  const fromW = [r1 * sinPhi * cosTheta, r1 * cosPhi, r1 * sinPhi * sinTheta];
  const phi2 = tv * Math.PI, theta2 = tu * 2 * Math.PI;
  const r2 = B * (1 + W * Math.cos(2 * phi2));
  const toW = [r2 * Math.sin(phi2) * Math.cos(theta2), r2 * Math.cos(phi2), r2 * Math.sin(phi2) * Math.sin(theta2)];

  const dx = toW[0] - fromW[0], dy = toW[1] - fromW[1], dz = toW[2] - fromW[2];
  const uComp = dx * tuNX + dz * tuNZ;
  const vComp = dx * tvNX + dy * tvNY + dz * tvNZ;
  return Math.atan2(vComp, uComp);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('s44r6-06: PvP bullet collision — ALL maps', () => {
  // Standard test positions: close enough that bullets reach within lifetime
  const testPairs = [
    { desc: 'small U gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.30, v: 0.4 } },
    { desc: 'small V gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.25, v: 0.45 } },
    { desc: 'diagonal',    from: { u: 0.25, v: 0.4 }, to: { u: 0.30, v: 0.45 } },
    { desc: 'medium gap',  from: { u: 0.25, v: 0.3 }, to: { u: 0.35, v: 0.45 } },
  ];

  describe('sphere', () => {
    for (const tc of testPairs) {
      it(`hits: ${tc.desc}`, () => {
        const result = simSphere(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('peanut', () => {
    for (const tc of testPairs) {
      it(`hits: ${tc.desc}`, () => {
        const result = simPeanut(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('torus', () => {
    // Torus has large metric variation between inner/outer. Use moderate test gaps.
    const torusPairs = [
      { desc: 'small U gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.30, v: 0.4 } },
      { desc: 'small V gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.25, v: 0.45 } },
      { desc: 'diagonal',    from: { u: 0.25, v: 0.4 }, to: { u: 0.30, v: 0.45 } },
      { desc: 'medium gap',  from: { u: 0.25, v: 0.30 }, to: { u: 0.28, v: 0.33 } },
    ];
    for (const tc of torusPairs) {
      it(`hits: ${tc.desc}`, () => {
        const result = simTorus(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('pill (body)', () => {
    // Use positions on the cylindrical body (v between PILL_CAP_FRAC and 1-PILL_CAP_FRAC)
    const pillPairs = [
      { desc: 'small U gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.30, v: 0.4 } },
      { desc: 'small V gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.25, v: 0.45 } },
      { desc: 'diagonal',    from: { u: 0.25, v: 0.4 }, to: { u: 0.30, v: 0.45 } },
    ];
    for (const tc of pillPairs) {
      it(`hits: ${tc.desc}`, () => {
        const result = simPill(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('mobius', () => {
    for (const tc of testPairs) {
      it(`hits: ${tc.desc}`, () => {
        const result = simFlat(tc.from.u, tc.from.v, tc.to.u, tc.to.v, mobiusChordDist);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('cube', () => {
    // Cube uses cubeChordDist which is an approximation
    const cubePairs = [
      { desc: 'small U gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.27, v: 0.4 } },
      { desc: 'small V gap', from: { u: 0.25, v: 0.4 }, to: { u: 0.25, v: 0.42 } },
      { desc: 'diagonal',    from: { u: 0.25, v: 0.4 }, to: { u: 0.27, v: 0.42 } },
    ];
    for (const tc of cubePairs) {
      it(`hits: ${tc.desc}`, () => {
        const result = simFlat(tc.from.u, tc.from.v, tc.to.u, tc.to.v, cubeChordDist);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('capsule (same as sphere)', () => {
    for (const tc of testPairs) {
      it(`hits: ${tc.desc}`, () => {
        const result = simSphere(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });
});
