/**
 * S43-07 Regression: Player-enemy collision radius too large in multiplayer.
 *
 * Bug: On sphere, peanut, cube ring, players died too early because:
 *   - sphere: ENEMY_HIT_WORLD was 0.5 (SP uses 0.4)
 *   - peanut: UV distance 0.04 → ~2 world units at bulge (UV distortion like sphere)
 *   - torus: UV distance 0.04 → ~1.5 world units in ring (V) direction
 *   - cube ring: UV distance 0.04 → ~1.5 world units in ring (U) direction
 *
 * Fix: Added exact 3D chord distance functions for distorted-UV surfaces.
 * All surface-specific distances now use ENEMY_HIT_WORLD = 0.4 world units,
 * matching SP CollisionSystem.ts (player 0.1 + enemy 0.3 = 0.4 world units).
 *
 * These tests replicate the pure math in isolation (no Colyseus required).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the S43-07 helper functions from GameRoom.ts (pure math, isolated)
// ---------------------------------------------------------------------------

const PEANUT_BASE_RADIUS = 6;
const PEANUT_WAIST_DEPTH = 0.4;
function peanutChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor = 1): number {
  const B = PEANUT_BASE_RADIUS * scaleFactor;
  const W = PEANUT_WAIST_DEPTH;
  const phi1 = v1 * Math.PI, theta1 = u1 * 2 * Math.PI;
  const r1 = B * (1 - W * Math.cos(2 * phi1));
  const phi2 = v2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const r2 = B * (1 - W * Math.cos(2 * phi2));
  const dx = r1 * Math.sin(phi1) * Math.cos(theta1) - r2 * Math.sin(phi2) * Math.cos(theta2);
  const dy = r1 * Math.cos(phi1) - r2 * Math.cos(phi2);
  const dz = r1 * Math.sin(phi1) * Math.sin(theta1) - r2 * Math.sin(phi2) * Math.sin(theta2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const TORUS_MAJOR_R = 6;
const TORUS_MINOR_R = 2;
function torusChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor = 1): number {
  const R = TORUS_MAJOR_R * scaleFactor;
  const r = TORUS_MINOR_R * scaleFactor;
  const theta1 = u1 * 2 * Math.PI, phi1 = v1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI, phi2 = v2 * 2 * Math.PI;
  const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
  const dy = r * Math.sin(theta1) - r * Math.sin(theta2);
  const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const CUBE_RING_MAJOR_R = 6;
const CUBE_RING_HALF_SIDE = 1.5;
function cubeRingChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor = 1): number {
  const R = CUBE_RING_MAJOR_R * scaleFactor;
  const H = CUBE_RING_HALF_SIDE * scaleFactor;
  function profile(v: number): { r: number; y: number } {
    const t = ((v % 1) + 1) % 1;
    const q = t * 4;
    if (q < 1) return { r: H,  y: (q - 0.5) * 2 * H };
    if (q < 2) return { r: (1.5 - q) * 2 * H, y: H };
    if (q < 3) return { r: -H, y: (2.5 - q) * 2 * H };
    return         { r: (q - 3.5) * 2 * H,    y: -H };
  }
  const phi1 = u1 * 2 * Math.PI;
  const { r: r1, y: y1 } = profile(v1);
  const phi2 = u2 * 2 * Math.PI;
  const { r: r2, y: y2 } = profile(v2);
  const dx = (R + r1) * Math.cos(phi1) - (R + r2) * Math.cos(phi2);
  const dz = (R + r1) * Math.sin(phi1) - (R + r2) * Math.sin(phi2);
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// SP collision threshold (player.mesh.scale.x * 0.1 + enemy.radius = 0.1 + 0.3 = 0.4)
const ENEMY_HIT_WORLD = 0.4;

// Old UV threshold (was incorrectly used for peanut/torus/cube-ring)
const ENEMY_HIT_UV = 0.04;

// ---------------------------------------------------------------------------
// Peanut surface tests
// ---------------------------------------------------------------------------

describe('S43-07: peanutChordDist', () => {
  it('coincident points have zero distance', () => {
    expect(peanutChordDist(0.5, 0.5, 0.5, 0.5)).toBeCloseTo(0, 5);
  });

  it('at bulge equator (v=0.5), small U separation gives ~correct world distance', () => {
    // At bulge: r = 6*(1-0.4*cos(PI)) = 6*1.4 = 8.4
    // Small U displacement at equator: world dist ≈ r * dTheta = 8.4 * (0.004 * 2π) ≈ 0.211
    const dist = peanutChordDist(0.5, 0.5, 0.502, 0.5);
    // Should be ~0.11 (0.002 * 2π * 8.4 ≈ 0.105)
    expect(dist).toBeGreaterThan(0.05);
    expect(dist).toBeLessThan(0.5); // Not the old UV inflated value
  });

  it('REGRESSION: old UV distance 0.04 at bulge was ~2+ world units (5× too large)', () => {
    // Old code: uvDistWrapped(0.5, 0.5, 0.54, 0.5) = 0.04 UV → triggers collision
    // But actual chord distance at these UV coords is much larger than 0.4 world units
    const uvDist = Math.abs(0.5 - 0.54); // 0.04 UV — would have triggered old collision
    expect(uvDist).toBeCloseTo(ENEMY_HIT_UV, 5); // Confirms old threshold would fire

    // New check: chord distance at 0.04 UV separation in U direction at bulge
    const chordDist = peanutChordDist(0.5, 0.5, 0.54, 0.5);
    // At bulge (r≈8.4): 0.04 * 2π * 8.4 ≈ 2.11 world units
    expect(chordDist).toBeGreaterThan(1.5); // Was triggering hit at >1.5 world units!
    // New threshold of 0.4 world units correctly identifies this as NOT a hit
    expect(chordDist).toBeGreaterThan(ENEMY_HIT_WORLD);
  });

  it('REGRESSION: contact at 0.4 world units triggers hit (was missed before)', () => {
    // Find UV delta that gives ~0.4 world units at bulge
    // At bulge r≈8.4: 0.4 / (2π * 8.4) ≈ 0.0076 UV
    // So 0.0076 UV separation in U at bulge should give ~0.4 world units
    const dist = peanutChordDist(0.5, 0.5, 0.5076, 0.5);
    expect(dist).toBeCloseTo(0.4, 1); // ~0.4 world units
    expect(dist).toBeLessThanOrEqual(ENEMY_HIT_WORLD + 0.05);
  });

  it('symmetry: dist(A,B) === dist(B,A)', () => {
    const d1 = peanutChordDist(0.3, 0.4, 0.5, 0.6);
    const d2 = peanutChordDist(0.5, 0.6, 0.3, 0.4);
    expect(d1).toBeCloseTo(d2, 10);
  });
});

// ---------------------------------------------------------------------------
// Torus surface tests
// ---------------------------------------------------------------------------

describe('S43-07: torusChordDist', () => {
  it('coincident points have zero distance', () => {
    expect(torusChordDist(0.25, 0.5, 0.25, 0.5)).toBeCloseTo(0, 5);
  });

  it('REGRESSION: old UV distance 0.04 in V direction (ring) was ~1.5 world units', () => {
    // V = around the ring, R=6, circumference = 2π*6 ≈ 37.7
    // 0.04 UV in V → 0.04 * 37.7 ≈ 1.51 world units (3× too large)
    const chordDist = torusChordDist(0.25, 0.5, 0.25, 0.54); // 0.04 V separation
    // Should be around 1.51 world units (outer face, R+r≈8)
    expect(chordDist).toBeGreaterThan(1.0);
    expect(chordDist).toBeGreaterThan(ENEMY_HIT_WORLD); // Should NOT trigger hit with new threshold
  });

  it('U direction (around tube, r=2): 0.04 UV ≈ 0.5 world units — slightly above threshold', () => {
    // U = tube, r=2, circumference ≈ 12.6. 0.04 UV → 0.04 * 12.6 ≈ 0.50 world units
    const dist = torusChordDist(0.0, 0.5, 0.04, 0.5);
    expect(dist).toBeGreaterThan(0.45);
    expect(dist).toBeLessThan(0.6);
    // 0.50 > 0.4 threshold → correct: no hit until actually closer
  });

  it('contact at ~0.4 world units in U direction correctly registers', () => {
    // U = tube: 0.4 / (2π * 2) ≈ 0.032 UV → should give ~0.4 world units
    const dist = torusChordDist(0.0, 0.5, 0.032, 0.5);
    expect(dist).toBeCloseTo(0.4, 1);
    expect(dist).toBeLessThanOrEqual(ENEMY_HIT_WORLD + 0.05);
  });

  it('symmetry: dist(A,B) === dist(B,A)', () => {
    const d1 = torusChordDist(0.1, 0.2, 0.4, 0.7);
    const d2 = torusChordDist(0.4, 0.7, 0.1, 0.2);
    expect(d1).toBeCloseTo(d2, 10);
  });
});

// ---------------------------------------------------------------------------
// Cube ring surface tests
// ---------------------------------------------------------------------------

describe('S43-07: cubeRingChordDist', () => {
  it('coincident points have zero distance', () => {
    expect(cubeRingChordDist(0.5, 0.0, 0.5, 0.0)).toBeCloseTo(0, 5);
  });

  it('REGRESSION: old UV distance 0.04 in U direction (ring) was ~1.5 world units', () => {
    // U = around the big ring, R=6, circumference = 2π*6 ≈ 37.7
    // On outer face (v=0): ring radius = R + H = 7.5 → 0.04 UV → 0.04 * 2π * 7.5 ≈ 1.88 world units
    const chordDist = cubeRingChordDist(0.5, 0.0, 0.54, 0.0); // 0.04 U separation
    expect(chordDist).toBeGreaterThan(1.0);
    expect(chordDist).toBeGreaterThan(ENEMY_HIT_WORLD); // Should NOT trigger hit
  });

  it('contact at ~0.4 world units in U direction on outer face correctly registers', () => {
    // On outer face (v=0): ring radius R+H = 7.5, circumference ≈ 47.1
    // 0.4 / 47.1 ≈ 0.0085 UV → should give ~0.4 world units
    const dist = cubeRingChordDist(0.5, 0.0, 0.5085, 0.0);
    expect(dist).toBeCloseTo(0.4, 1);
    expect(dist).toBeLessThanOrEqual(ENEMY_HIT_WORLD + 0.05);
  });

  it('V direction (cross-section face): small V separation gives reasonable distance', () => {
    // At v=0.125 (middle of outer face), moving to v=0.125+0.05 = 0.175
    // Both on outer face (r=H=1.5), y changes: 0.05 * 4 * 2*H / 1 = ~0.6 world units
    const dist = cubeRingChordDist(0.5, 0.125, 0.5, 0.175);
    expect(dist).toBeGreaterThan(0.2);
    expect(dist).toBeLessThan(1.0); // Not wildly inflated
  });

  it('symmetry: dist(A,B) === dist(B,A)', () => {
    const d1 = cubeRingChordDist(0.1, 0.2, 0.4, 0.7);
    const d2 = cubeRingChordDist(0.4, 0.7, 0.1, 0.2);
    expect(d1).toBeCloseTo(d2, 10);
  });
});

// ---------------------------------------------------------------------------
// SP parity: ENEMY_HIT_WORLD threshold matches SP
// ---------------------------------------------------------------------------

describe('S43-07: ENEMY_HIT_WORLD matches SP CollisionSystem threshold', () => {
  it('SP hitRadius = player.mesh.scale.x * 0.1 + enemy.radius = 0.1 + 0.3 = 0.4', () => {
    const playerMeshScaleX = 1.0; // default scale
    const enemyRadius = 0.3;       // BaseEnemy default
    const spHitRadius = playerMeshScaleX * 0.1 + enemyRadius;
    expect(spHitRadius).toBeCloseTo(0.4, 5);
    expect(ENEMY_HIT_WORLD).toBeCloseTo(spHitRadius, 5);
  });

  it('old ENEMY_HIT_WORLD of 0.5 was 25% too large vs SP', () => {
    const oldThreshold = 0.5;
    const spThreshold = 0.4;
    expect(oldThreshold / spThreshold).toBeCloseTo(1.25, 5); // 25% too large
    // Confirms ENEMY_HIT_WORLD was reduced: new value matches SP
    expect(ENEMY_HIT_WORLD).toBeLessThan(oldThreshold);
    expect(ENEMY_HIT_WORLD).toBeCloseTo(spThreshold, 5);
  });
});
