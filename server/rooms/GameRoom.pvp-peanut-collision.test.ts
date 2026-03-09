/**
 * s44r6-06: PvP Damage Broken on Peanut — Regression Test
 *
 * Bug: PvP on peanut map only dealt damage from one specific spot.
 * Root causes:
 * 1. Christoffel parallel transport accumulated Euler integration error,
 *    causing bullets to curve away from targets.
 * 2. The UV coordinate system has a 2π/π asymmetry (U covers 2π azimuthal,
 *    V covers π polar), causing diagonal aim to be 2x off in U/V ratio.
 *    On sphere, Christoffel transport corrects this implicitly. Without
 *    transport, we must explicitly correct.
 *
 * Fix: Removed parallel transport, kept metric correction, added 2x dirY
 * compensation for the 2π/π asymmetry.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Constants matching GameRoom.ts
// ---------------------------------------------------------------------------
const PEANUT_BASE_RADIUS = 6;
const PEANUT_WAIST_DEPTH = 0.4;
const BULLET_SPEED = 0.13;
const BULLET_LIFETIME = 6.0;
const BULLET_HIT_WORLD = 0.4;
const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Pure math functions copied from GameRoom.ts
// ---------------------------------------------------------------------------
function peanutChordDist(
  u1: number, v1: number, u2: number, v2: number, scaleFactor = 1,
): number {
  const B = PEANUT_BASE_RADIUS * scaleFactor;
  const W = PEANUT_WAIST_DEPTH;
  const phi1 = v1 * Math.PI, theta1 = u1 * 2 * Math.PI;
  const r1 = B * (1 + W * Math.cos(2 * phi1));
  const phi2 = v2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const r2 = B * (1 + W * Math.cos(2 * phi2));
  const dx = r1 * Math.sin(phi1) * Math.cos(theta1) - r2 * Math.sin(phi2) * Math.cos(theta2);
  const dy = r1 * Math.cos(phi1) - r2 * Math.cos(phi2);
  const dz = r1 * Math.sin(phi1) * Math.sin(theta1) - r2 * Math.sin(phi2) * Math.sin(theta2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function peanutUVToWorld(u: number, v: number, scaleFactor = 1): [number, number, number] {
  const B = PEANUT_BASE_RADIUS * scaleFactor;
  const W = PEANUT_WAIST_DEPTH;
  const phi = v * Math.PI;
  const theta = u * 2 * Math.PI;
  const r = B * (1 + W * Math.cos(2 * phi));
  return [
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  ];
}

function peanutTangentFrame(u: number, v: number): {
  tangentU: [number, number, number];
  tangentV: [number, number, number];
} {
  const W = PEANUT_WAIST_DEPTH;
  const phi = v * Math.PI;
  const theta = u * 2 * Math.PI;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const rNorm = 1 + W * Math.cos(2 * phi);
  const drNorm = -2 * W * Math.sin(2 * phi);

  const tuX = -sinPhi * sinTheta;
  const tuY = 0;
  const tuZ = sinPhi * cosTheta;
  const tuLen = Math.sqrt(tuX * tuX + tuY * tuY + tuZ * tuZ) || 1;

  const tvX = drNorm * sinPhi * cosTheta + rNorm * cosPhi * cosTheta;
  const tvY = drNorm * cosPhi - rNorm * sinPhi;
  const tvZ = drNorm * sinPhi * sinTheta + rNorm * cosPhi * sinTheta;
  const tvLen = Math.sqrt(tvX * tvX + tvY * tvY + tvZ * tvZ) || 1;

  return {
    tangentU: [tuX / tuLen, tuY / tuLen, tuZ / tuLen],
    tangentV: [tvX / tvLen, tvY / tvLen, tvZ / tvLen],
  };
}

function computeAimAngle(
  fromU: number, fromV: number,
  toU: number, toV: number,
): number {
  const fromWorld = peanutUVToWorld(fromU, fromV);
  const toWorld = peanutUVToWorld(toU, toV);
  const { tangentU, tangentV } = peanutTangentFrame(fromU, fromV);

  const dirX = toWorld[0] - fromWorld[0];
  const dirY = toWorld[1] - fromWorld[1];
  const dirZ = toWorld[2] - fromWorld[2];

  const uComponent = dirX * tangentU[0] + dirY * tangentU[1] + dirZ * tangentU[2];
  const vComponent = dirX * tangentV[0] + dirY * tangentV[1] + dirZ * tangentV[2];

  return Math.atan2(vComponent, uComponent);
}

/**
 * Simulate bullet using the s44r6-06 fix:
 * - Metric-only correction (no parallel transport)
 * - 2x dirY compensation for 2π/π UV asymmetry
 */
function simulateBulletTravel(
  shooterU: number, shooterV: number,
  targetU: number, targetV: number,
  scaleFactor = 1,
): { minDist: number; hitTick: number; totalTicks: number } {
  const aimAngle = computeAimAngle(shooterU, shooterV, targetU, targetV);

  // Apply 2π/π asymmetry correction:
  // U parameterizes 2π (full azimuth), V parameterizes π (pole-to-pole).
  // The aim angle is computed in the physical tangent frame where tangent vectors
  // are normalized to unit length. But the bullet movement divides by metricU and
  // metricV separately, which have different relationships to the physical distances
  // because of the 2:1 parameterization ratio. Multiply dirY by 2 to compensate.
  const rawDirX = Math.cos(aimAngle);
  const rawDirY = Math.sin(aimAngle);
  const corrDirX = rawDirX;
  const corrDirY = rawDirY * 2;
  const corrLen = Math.sqrt(corrDirX * corrDirX + corrDirY * corrDirY);
  const dirX = corrDirX / corrLen;
  const dirY = corrDirY / corrLen;

  let bulletX = shooterU;
  let bulletY = shooterV;

  let minDist = Infinity;
  let hitTick = -1;
  const totalTicks = Math.ceil(BULLET_LIFETIME / DT);

  for (let tick = 0; tick < totalTicks; tick++) {
    const dist = peanutChordDist(bulletX, bulletY, targetU, targetV, scaleFactor);
    if (dist < minDist) {
      minDist = dist;
      hitTick = tick;
    }

    const phi = bulletY * Math.PI;
    const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
    const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
    const sinPhi = Math.sin(phi);
    const metricU = Math.max(rNorm * sinPhi, 0.3);
    const metricV = Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);

    bulletX += (dirX / metricU) * BULLET_SPEED * DT;
    bulletY += (dirY / metricV) * BULLET_SPEED * DT;

    bulletX = ((bulletX % 1) + 1) % 1;
    bulletY = Math.max(0.001, Math.min(0.999, bulletY));
  }

  return { minDist, hitTick, totalTicks };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('s44r6-06: PvP peanut bullet collision (metric + asymmetry fix)', () => {

  describe('same-latitude targets (U separation)', () => {
    const testCases = [
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.30, v: 0.3 }, desc: 'tiny U gap at v=0.3' },
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.35, v: 0.3 }, desc: 'small U gap at v=0.3' },
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.45, v: 0.3 }, desc: 'medium U gap at v=0.3' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.30, v: 0.5 }, desc: 'tiny U gap at waist' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.35, v: 0.5 }, desc: 'small U gap at waist' },
      { from: { u: 0.25, v: 0.2 }, to: { u: 0.30, v: 0.2 }, desc: 'tiny U gap at bulge' },
      { from: { u: 0.25, v: 0.2 }, to: { u: 0.35, v: 0.2 }, desc: 'small U gap at bulge' },
    ];

    for (const tc of testCases) {
      it(`hits: ${tc.desc}`, () => {
        const result = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('different-latitude targets (V separation)', () => {
    const testCases = [
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.25, v: 0.35 }, desc: 'small V gap' },
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.25, v: 0.40 }, desc: 'medium V gap' },
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.25, v: 0.50 }, desc: 'large V gap (to waist)' },
      { from: { u: 0.25, v: 0.4 }, to: { u: 0.25, v: 0.5 },  desc: 'toward waist' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.25, v: 0.4 },  desc: 'away from waist' },
      { from: { u: 0.25, v: 0.2 }, to: { u: 0.25, v: 0.8 },  desc: 'top bulge to bottom bulge' },
    ];

    for (const tc of testCases) {
      it(`hits: ${tc.desc}`, () => {
        const result = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('diagonal targets (both U and V separation)', () => {
    const testCases = [
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.30, v: 0.35 }, desc: 'small diagonal on upper half' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.30, v: 0.55 }, desc: 'small diagonal at waist' },
      { from: { u: 0.25, v: 0.7 }, to: { u: 0.30, v: 0.75 }, desc: 'small diagonal on lower half' },
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.35, v: 0.4 },  desc: 'medium diagonal' },
      { from: { u: 0.25, v: 0.2 }, to: { u: 0.35, v: 0.5 },  desc: 'large diagonal bulge to waist' },
    ];

    for (const tc of testCases) {
      it(`hits: ${tc.desc}`, () => {
        const result = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  describe('PvP engagement range — all pairs within 90°', () => {
    const positions = [
      { name: 'upper bulge',    u: 0.25, v: 0.25 },
      { name: 'mid upper',      u: 0.30, v: 0.35 },
      { name: 'waist',          u: 0.20, v: 0.50 },
      { name: 'mid lower',      u: 0.35, v: 0.65 },
      { name: 'lower bulge',    u: 0.25, v: 0.75 },
      { name: 'slightly left',  u: 0.10, v: 0.40 },
      { name: 'slightly right', u: 0.40, v: 0.40 },
    ];

    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;
        const from = positions[i];
        const to = positions[j];
        it(`${from.name} → ${to.name}`, () => {
          const result = simulateBulletTravel(from.u, from.v, to.u, to.v);
          expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
        });
      }
    }
  });

  it('diagnostic: shooters within 90° all hit target at same latitude', () => {
    const target = { u: 0.5, v: 0.3 };
    const shooterV = 0.3;
    let allHit = true;

    for (let su = 0.30; su <= 0.70; su += 0.05) {
      const result = simulateBulletTravel(su, shooterV, target.u, target.v);
      if (result.minDist >= BULLET_HIT_WORLD) {
        console.log(`MISS: u=${su.toFixed(2)}, minDist=${result.minDist.toFixed(3)}`);
        allHit = false;
      }
    }

    expect(allHit).toBe(true);
  });

  it('left-right symmetry', () => {
    const v = 0.4;
    const leftResult = simulateBulletTravel(0.25, v, 0.35, v);
    const rightResult = simulateBulletTravel(0.35, v, 0.25, v);
    expect(leftResult.minDist).toBeLessThan(BULLET_HIT_WORLD);
    expect(rightResult.minDist).toBeLessThan(BULLET_HIT_WORLD);
    const ratio = leftResult.minDist / rightResult.minDist;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2.0);
  });

  it('upper-lower bulge symmetry', () => {
    const upperResult = simulateBulletTravel(0.25, 0.25, 0.30, 0.25);
    const lowerResult = simulateBulletTravel(0.25, 0.75, 0.30, 0.75);
    expect(upperResult.minDist).toBeLessThan(BULLET_HIT_WORLD);
    expect(lowerResult.minDist).toBeLessThan(BULLET_HIT_WORLD);
  });
});
