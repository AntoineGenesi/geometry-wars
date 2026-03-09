/**
 * s44r6-06: PvP Damage Broken on Peanut — Reproduction Test
 *
 * Bug: PvP on peanut map only deals damage from one specific spot.
 * All other angles = no damage.
 *
 * This test simulates the server-side PvP collision pipeline:
 * 1. Two players at various positions on the peanut
 * 2. Player A shoots a bullet aimed at Player B
 * 3. Bullet moves through UV space using peanut Christoffel symbols
 * 4. Check if bullet ever comes within BULLET_HIT_WORLD (0.4) of Player B
 *
 * Tests various positions: same bulge, opposite bulges, waist, poles.
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
const DT = 1 / 60; // server tick rate

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

/**
 * Convert peanut UV to 3D world position (for computing aim direction).
 */
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

/**
 * Compute the UV tangent vectors at a given point on the peanut.
 * tangentU = direction of increasing theta (normalized)
 * tangentV = direction of increasing phi (normalized)
 */
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

  // tangentU: direction of increasing theta
  const tuX = -sinPhi * sinTheta;
  const tuY = 0;
  const tuZ = sinPhi * cosTheta;
  const tuLen = Math.sqrt(tuX * tuX + tuY * tuY + tuZ * tuZ) || 1;

  // tangentV: direction of increasing phi (d/dphi of position)
  // dx/dphi = drNorm*sinPhi*cosTheta + rNorm*cosPhi*cosTheta
  // dy/dphi = drNorm*cosPhi - rNorm*sinPhi
  // dz/dphi = drNorm*sinPhi*sinTheta + rNorm*cosPhi*sinTheta
  const tvX = drNorm * sinPhi * cosTheta + rNorm * cosPhi * cosTheta;
  const tvY = drNorm * cosPhi - rNorm * sinPhi;
  const tvZ = drNorm * sinPhi * sinTheta + rNorm * cosPhi * sinTheta;
  const tvLen = Math.sqrt(tvX * tvX + tvY * tvY + tvZ * tvZ) || 1;

  return {
    tangentU: [tuX / tuLen, tuY / tuLen, tuZ / tuLen],
    tangentV: [tvX / tvLen, tvY / tvLen, tvZ / tvLen],
  };
}

/**
 * Compute aim angle from player A toward player B on the peanut surface.
 * This mirrors how the client computes aimAngle:
 * - Get the 3D direction from A to B
 * - Project onto the surface tangent plane at A
 * - Decompose into tangentU and tangentV components
 * - Return atan2(vComponent, uComponent)
 */
function computeAimAngle(
  fromU: number, fromV: number,
  toU: number, toV: number,
): number {
  const fromWorld = peanutUVToWorld(fromU, fromV);
  const toWorld = peanutUVToWorld(toU, toV);
  const { tangentU, tangentV } = peanutTangentFrame(fromU, fromV);

  // Direction from A to B in 3D
  const dirX = toWorld[0] - fromWorld[0];
  const dirY = toWorld[1] - fromWorld[1];
  const dirZ = toWorld[2] - fromWorld[2];

  // Project onto tangent vectors
  const uComponent = dirX * tangentU[0] + dirY * tangentU[1] + dirZ * tangentU[2];
  const vComponent = dirX * tangentV[0] + dirY * tangentV[1] + dirZ * tangentV[2];

  return Math.atan2(vComponent, uComponent);
}

/**
 * Simulate a bullet from playerA aimed at playerB.
 * Returns the minimum chord distance the bullet achieves during its lifetime.
 * This mirrors GameRoom.ts updateBullets() and checkCollisions().
 *
 * @param useFixed - if true, use the FIXED Christoffel symbols (with Gamma_v_vv)
 */
function simulateBulletTravel(
  shooterU: number, shooterV: number,
  targetU: number, targetV: number,
  scaleFactor = 1,
  useFixed = false,
): { minDist: number; hitTick: number; totalTicks: number } {
  const aimAngle = computeAimAngle(shooterU, shooterV, targetU, targetV);

  let bulletX = shooterU;
  let bulletY = shooterV;
  let dirX = Math.cos(aimAngle);
  let dirY = Math.sin(aimAngle);

  let minDist = Infinity;
  let hitTick = -1;
  const totalTicks = Math.ceil(BULLET_LIFETIME / DT);

  for (let tick = 0; tick < totalTicks; tick++) {
    // Check distance
    const dist = peanutChordDist(bulletX, bulletY, targetU, targetV, scaleFactor);
    if (dist < minDist) {
      minDist = dist;
      hitTick = tick;
    }

    // Peanut bullet movement (mirrors GameRoom.ts updateBullets peanut branch)
    const phi = bulletY * Math.PI;
    const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
    const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const metricU = Math.max(rNorm * sinPhi, 0.3);
    const metricV = Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);

    // Parallel transport (Christoffel symbols)
    const cotPhi = cosPhi / Math.max(Math.abs(sinPhi), 0.01);
    const g_vv = rNorm * rNorm + drNorm * drNorm;
    const Gamma_u_uv = (drNorm / Math.max(rNorm, 0.01)) + cotPhi;
    const Gamma_v_uu = -rNorm * sinPhi * (rNorm * cosPhi + drNorm * sinPhi) / Math.max(g_vv, 0.01);
    const step = BULLET_SPEED * DT;
    const prevDirX = dirX;
    const prevDirY = dirY;
    dirX += -2 * Gamma_u_uv * dirX * dirY * step;
    dirY += -Gamma_v_uu * prevDirX * prevDirX * step;

    // FIX: Add missing Gamma_v_vv term for peanut geodesic
    if (useFixed) {
      const d2rNorm = -4 * PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
      const dg_vv_dphi = 2 * rNorm * drNorm + 2 * drNorm * d2rNorm;
      const Gamma_v_vv = dg_vv_dphi / (2 * Math.max(g_vv, 0.01));
      dirY += -Gamma_v_vv * prevDirY * prevDirY * step;
    }

    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0.001) { dirX /= len; dirY /= len; }

    // Move bullet
    bulletX += (dirX / metricU) * BULLET_SPEED * DT;
    bulletY += (dirY / metricV) * BULLET_SPEED * DT;

    // Wrap U, clamp V
    bulletX = ((bulletX % 1) + 1) % 1;
    bulletY = Math.max(0.001, Math.min(0.999, bulletY));
  }

  return { minDist, hitTick, totalTicks };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('s44r6-06: PvP bullet-player collision on peanut', () => {
  // Test various player positions on the peanut surface
  const positions = [
    { name: 'upper bulge front',    u: 0.25, v: 0.2 },
    { name: 'upper bulge back',     u: 0.75, v: 0.2 },
    { name: 'upper bulge side',     u: 0.0,  v: 0.15 },
    { name: 'waist front',          u: 0.25, v: 0.5 },
    { name: 'waist back',           u: 0.75, v: 0.5 },
    { name: 'lower bulge front',    u: 0.25, v: 0.8 },
    { name: 'lower bulge back',     u: 0.75, v: 0.8 },
    { name: 'mid latitude front',   u: 0.25, v: 0.35 },
    { name: 'mid latitude back',    u: 0.75, v: 0.35 },
  ];

  // Test nearby targets (within ~quarter turn on same latitude)
  describe('nearby targets on same latitude', () => {
    const testCases = [
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.30, v: 0.3 }, desc: 'small U separation at v=0.3' },
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.35, v: 0.3 }, desc: 'medium U separation at v=0.3' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.30, v: 0.5 }, desc: 'small U separation at waist' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.35, v: 0.5 }, desc: 'medium U separation at waist' },
      { from: { u: 0.25, v: 0.2 }, to: { u: 0.30, v: 0.2 }, desc: 'small U separation at bulge' },
      { from: { u: 0.25, v: 0.2 }, to: { u: 0.35, v: 0.2 }, desc: 'medium U separation at bulge' },
    ];

    for (const tc of testCases) {
      it(`bullet hits target: ${tc.desc}`, () => {
        const result = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  // Test nearby targets at different latitudes (V separation)
  describe('nearby targets at different latitudes', () => {
    const testCases = [
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.25, v: 0.35 }, desc: 'small V separation' },
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.25, v: 0.40 }, desc: 'medium V separation' },
      { from: { u: 0.25, v: 0.4 }, to: { u: 0.25, v: 0.5 },  desc: 'toward waist' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.25, v: 0.4 },  desc: 'away from waist' },
    ];

    for (const tc of testCases) {
      it(`bullet hits target: ${tc.desc}`, () => {
        const result = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  // Test diagonal targets (both U and V separation)
  describe('diagonal targets', () => {
    const testCases = [
      { from: { u: 0.25, v: 0.3 }, to: { u: 0.30, v: 0.35 }, desc: 'diagonal on upper bulge' },
      { from: { u: 0.25, v: 0.5 }, to: { u: 0.30, v: 0.55 }, desc: 'diagonal at waist' },
      { from: { u: 0.25, v: 0.7 }, to: { u: 0.30, v: 0.75 }, desc: 'diagonal on lower bulge' },
    ];

    for (const tc of testCases) {
      it(`bullet hits target: ${tc.desc}`, () => {
        const result = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v);
        expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
      });
    }
  });

  // Test all positions against all other positions
  describe('cross-position matrix (all pairs must hit)', () => {
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;
        const from = positions[i];
        const to = positions[j];
        it(`${from.name} → ${to.name}`, () => {
          const result = simulateBulletTravel(from.u, from.v, to.u, to.v);
          // For distant targets, we just need the bullet to get CLOSE to the target.
          // The key assertion is that from ALL positions, bullets can reach the target.
          expect(result.minDist).toBeLessThan(BULLET_HIT_WORLD);
        });
      }
    }
  });

  // Compare FIXED vs UNFIXED geodesic for cross-position hits
  describe('FIXED vs UNFIXED comparison', () => {
    const cases = [
      { from: { u: 0.25, v: 0.35 }, to: { u: 0.75, v: 0.35 }, desc: 'opposite sides same latitude' },
      { from: { u: 0.25, v: 0.2 },  to: { u: 0.0,  v: 0.15 }, desc: 'same bulge, different u' },
      { from: { u: 0.25, v: 0.35 }, to: { u: 0.75, v: 0.5 },  desc: 'mid to waist back' },
    ];

    for (const tc of cases) {
      it(`FIXED hits: ${tc.desc}`, () => {
        const unfixed = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v, 1, false);
        const fixed = simulateBulletTravel(tc.from.u, tc.from.v, tc.to.u, tc.to.v, 1, true);
        console.log(`  ${tc.desc}: unfixed minDist=${unfixed.minDist.toFixed(3)}, fixed minDist=${fixed.minDist.toFixed(3)}`);
        // Fixed version should hit (or at least get much closer)
        expect(fixed.minDist).toBeLessThan(unfixed.minDist);
      });
    }
  });

  // Diagnostic test: print minimum distances for various angles from a fixed position
  it('diagnostic: minimum distance from various shooting positions', () => {
    const target = { u: 0.5, v: 0.3 };
    const shooterV = 0.3;
    const results: { shooterU: number; minDist: number; hit: boolean }[] = [];

    for (let su = 0.0; su < 1.0; su += 0.05) {
      if (Math.abs(su - target.u) < 0.02) continue; // Skip self
      const result = simulateBulletTravel(su, shooterV, target.u, target.v);
      results.push({
        shooterU: su,
        minDist: result.minDist,
        hit: result.minDist < BULLET_HIT_WORLD,
      });
    }

    const hitCount = results.filter(r => r.hit).length;
    const missCount = results.filter(r => !r.hit).length;

    // All shooters at the same latitude should be able to hit the target
    // If some miss, that's the bug!
    console.log(`PvP peanut hit diagnostic: ${hitCount} hits, ${missCount} misses out of ${results.length}`);
    for (const r of results) {
      if (!r.hit) {
        console.log(`  MISS: shooter u=${r.shooterU.toFixed(2)}, minDist=${r.minDist.toFixed(3)}`);
      }
    }

    expect(hitCount).toBe(results.length); // All should hit
  });
});
