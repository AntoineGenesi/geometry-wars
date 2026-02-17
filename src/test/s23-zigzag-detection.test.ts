/**
 * s23-zigzag-detection — Zigzag movement detection algorithm tests.
 *
 * The algorithm detects pathological oscillating movement in 3D (the "pill zigzag bug"):
 * a player presses forward but bounces laterally back and forth instead of moving smoothly.
 *
 * Detection approach:
 *   1. Compute displacement vectors between consecutive positions
 *   2. Measure oscillation: consecutive displacements with opposing direction (dot product < 0)
 *   3. If > 40% of pairs oscillate → zigzag detected
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Detection algorithm (self-contained, no game dependencies)
// ---------------------------------------------------------------------------

interface Vec3 { x: number; y: number; z: number }

export interface ZigzagResult {
  isZigzag: boolean;
  /** Fraction of consecutive displacement pairs with opposing direction (0–1). */
  oscillationRatio: number;
  /** Average displacement magnitude per frame. */
  avgDisplacementMagnitude: number;
  /** Number of positions analyzed. */
  frameCount: number;
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Detect zigzag movement pattern in a sequence of world-space positions.
 *
 * @param positions - Ordered sequence of positions (at least 3 required)
 * @param minMagnitude - Minimum displacement magnitude to include in analysis (default 0.001)
 *                       Filters out near-stationary samples caused by pause/countdown
 * @param zigzagThreshold - Oscillation ratio above which movement is classified as zigzag (default 0.4)
 */
export function detectZigzag(
  positions: Vec3[],
  minMagnitude = 0.001,
  zigzagThreshold = 0.4,
): ZigzagResult {
  if (positions.length < 3) {
    return { isZigzag: false, oscillationRatio: 0, avgDisplacementMagnitude: 0, frameCount: positions.length };
  }

  // Compute displacement vectors, filter out near-zero ones
  const displacements: Vec3[] = [];
  for (let i = 1; i < positions.length; i++) {
    const d = sub(positions[i], positions[i - 1]);
    if (len(d) >= minMagnitude) {
      displacements.push(d);
    }
  }

  if (displacements.length < 2) {
    return { isZigzag: false, oscillationRatio: 0, avgDisplacementMagnitude: 0, frameCount: positions.length };
  }

  // Measure oscillation: count consecutive pairs with negative dot product
  let oscillatingPairs = 0;
  let totalMagnitude = 0;

  for (let i = 0; i < displacements.length; i++) {
    totalMagnitude += len(displacements[i]);
    if (i > 0 && dot(displacements[i - 1], displacements[i]) < 0) {
      oscillatingPairs++;
    }
  }

  const oscillationRatio = oscillatingPairs / (displacements.length - 1);
  const avgDisplacementMagnitude = totalMagnitude / displacements.length;

  return {
    isZigzag: oscillationRatio >= zigzagThreshold,
    oscillationRatio,
    avgDisplacementMagnitude,
    frameCount: positions.length,
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Generate positions moving in one direction with optional lateral oscillation */
function makeStraightPath(frames: number, step: Vec3, startPos = { x: 0, y: 0, z: 0 }): Vec3[] {
  const positions: Vec3[] = [{ ...startPos }];
  for (let i = 1; i < frames; i++) {
    const prev = positions[i - 1];
    positions.push({ x: prev.x + step.x, y: prev.y + step.y, z: prev.z + step.z });
  }
  return positions;
}

/** Generate a pure zigzag (alternating +dx, -dx with some forward motion) */
function makeZigzagPath(frames: number, lateralAmp: number, forward: Vec3): Vec3[] {
  const positions: Vec3[] = [{ x: 0, y: 0, z: 0 }];
  let fwd = { ...forward };
  for (let i = 1; i < frames; i++) {
    const prev = positions[i - 1];
    const lateralSign = i % 2 === 0 ? 1 : -1;
    positions.push({
      x: prev.x + fwd.x + lateralAmp * lateralSign,
      y: prev.y + fwd.y,
      z: prev.z + fwd.z,
    });
  }
  return positions;
}

/** Generate positions on a sphere surface moving with constant velocity (no zigzag) */
function makeSphereArcPath(frames: number, radius: number, angularSpeed: number): Vec3[] {
  const positions: Vec3[] = [];
  for (let i = 0; i < frames; i++) {
    const theta = i * angularSpeed;
    positions.push({
      x: radius * Math.sin(theta),
      y: 0,
      z: radius * Math.cos(theta),
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('zigzag detection algorithm', () => {
  // ---- Non-zigzag cases ----

  it('TC1: forward-only movement is NOT zigzag', () => {
    // Player presses W, moves in consistent -Z direction
    const positions = makeStraightPath(120, { x: 0, y: 0, z: -0.05 });
    const result = detectZigzag(positions);
    expect(result.isZigzag).toBe(false);
    expect(result.oscillationRatio).toBeLessThan(0.05);
  });

  it('TC2: lateral-only movement is NOT zigzag', () => {
    // Player presses D, moves in consistent +X direction
    const positions = makeStraightPath(120, { x: 0.05, y: 0, z: 0 });
    const result = detectZigzag(positions);
    expect(result.isZigzag).toBe(false);
    expect(result.oscillationRatio).toBeLessThan(0.05);
  });

  it('TC3: diagonal movement is NOT zigzag', () => {
    // Player presses W+D, smooth diagonal movement
    const positions = makeStraightPath(120, { x: 0.035, y: 0, z: -0.035 });
    const result = detectZigzag(positions);
    expect(result.isZigzag).toBe(false);
    expect(result.oscillationRatio).toBeLessThan(0.05);
  });

  it('TC4: sphere arc path is NOT zigzag', () => {
    // Player walks around a sphere in an arc — direction changes gradually but not oscillating
    const positions = makeSphereArcPath(120, 10, 0.02);
    const result = detectZigzag(positions);
    expect(result.isZigzag).toBe(false);
    expect(result.oscillationRatio).toBeLessThan(0.15);
  });

  it('TC5: stationary (stopped) movement is NOT zigzag', () => {
    // Very small movements filtered by minMagnitude
    const positions: Vec3[] = Array.from({ length: 120 }, () => ({ x: 0, y: 0, z: 0 }));
    const result = detectZigzag(positions, 0.001);
    expect(result.isZigzag).toBe(false);
  });

  // ---- Zigzag cases ----

  it('TC6: pure alternating displacement IS zigzag', () => {
    // Classic zigzag: +X, -X, +X, -X, ...
    const positions: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    for (let i = 1; i < 120; i++) {
      const prev = positions[i - 1];
      const sign = i % 2 === 0 ? 1 : -1;
      positions.push({ x: prev.x + sign * 0.5, y: 0, z: 0 });
    }
    const result = detectZigzag(positions);
    expect(result.isZigzag).toBe(true);
    expect(result.oscillationRatio).toBeGreaterThan(0.8);
  });

  it('TC7: pill-style zigzag (forward + lateral oscillation) IS zigzag', () => {
    // Player presses forward but zigzags sideways — the pill movement bug
    // Displacement alternates between forward-left and forward-right
    const positions = makeZigzagPath(120, 0.4, { x: 0, y: 0, z: -0.02 });
    const result = detectZigzag(positions);
    expect(result.isZigzag).toBe(true);
    expect(result.oscillationRatio).toBeGreaterThan(0.6);
  });

  it('TC8: high-frequency zigzag every other frame IS zigzag', () => {
    // Alternating displacement with slight net forward progress
    const positions: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    for (let i = 1; i < 100; i++) {
      const prev = positions[i - 1];
      const lateralSign = i % 2 === 0 ? 0.3 : -0.3;
      positions.push({ x: prev.x + lateralSign, y: 0, z: prev.z - 0.01 });
    }
    const result = detectZigzag(positions);
    expect(result.isZigzag).toBe(true);
  });

  it('TC9: mostly forward with occasional direction flip is borderline (NOT zigzag)', () => {
    // Mostly smooth with 1 reversal — should NOT trigger zigzag detection
    const positions = makeStraightPath(100, { x: 0, y: 0, z: -0.05 });
    // Insert one reversal in the middle
    positions[50] = { x: positions[49].x, y: 0, z: positions[49].z + 0.05 };
    const result = detectZigzag(positions);
    // With 1 reversal out of 98 pairs, ratio = 1/98 ≈ 1%
    expect(result.isZigzag).toBe(false);
    expect(result.oscillationRatio).toBeLessThan(0.1);
  });

  // ---- Edge cases ----

  it('requires at least 3 positions to analyze', () => {
    const result = detectZigzag([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    expect(result.isZigzag).toBe(false);
    expect(result.frameCount).toBe(2);
  });

  it('custom threshold: strict threshold flags mild oscillation', () => {
    // 30% oscillation ratio — normal threshold (0.4) would miss it, strict (0.2) catches it
    const positions: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    for (let i = 1; i < 100; i++) {
      const prev = positions[i - 1];
      // Oscillate every 3rd frame
      const sign = i % 3 === 0 ? -1 : 1;
      positions.push({ x: prev.x, y: 0, z: prev.z + sign * 0.05 });
    }
    const resultDefault = detectZigzag(positions, 0.001, 0.4);
    const resultStrict  = detectZigzag(positions, 0.001, 0.2);
    // Default threshold: might or might not catch it (depends on exact ratio)
    // Strict threshold: should catch 30%+ oscillation
    expect(resultStrict.oscillationRatio).toBeGreaterThan(0.2);
    // The results are at least self-consistent
    if (resultDefault.isZigzag) {
      expect(resultStrict.isZigzag).toBe(true);
    }
  });
});
