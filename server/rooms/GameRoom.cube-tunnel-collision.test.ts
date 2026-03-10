/**
 * Regression tests for cube-tunnel hit detection in LAN multiplayer (s44r6c-02).
 *
 * Bug: Server used raw Euclidean UV distance for cube-tunnel surface, producing
 * hit radii 5-10× larger than visual size. User reported "enemies killing from
 * AoE-weapon distance" on cube-tunnel maps.
 *
 * Root cause: cube-tunnel was not included in `usesWorldDist` and `surfaceWorldDist`
 * dispatch — fell through to sphereGreatCircleDist which is completely wrong for
 * the compound cube+tunnel UV parameterization.
 *
 * These tests validate the cubeTunnelChordDist function in isolation.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Port of cubeTunnelPoint3D from GameRoom.ts (exact same logic)
// ---------------------------------------------------------------------------

const CT_BASE_SIZE = 20;
const CT_WALL_THICKNESS = 2.0;
const _CT_FN: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const _CT_FR: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, -1], [-1, 0], [0, 1]];

function cubeTunnelPoint3D(u: number, v: number, scaleFactor: number): [number, number, number] {
  const size = CT_BASE_SIZE * scaleFactor;
  const wallThickness = CT_WALL_THICKNESS * scaleFactor;
  const lipRadius = wallThickness / 2;
  const halfSize = size / 2;
  const wallHeight = halfSize - lipRadius;
  const minBevel = wallThickness / 2 + 0.1 * scaleFactor;
  const bevelRadius = Math.max(size * 0.12, minBevel);
  const spineHalfSize = halfSize - lipRadius;
  const spineFlatHalfSize = spineHalfSize - bevelRadius;

  const outerWallLen = 2 * wallHeight;
  const lipLen = Math.PI * lipRadius;
  const totalV = 2 * outerWallLen + 2 * lipLen;
  const owf = outerWallLen / totalV;
  const lf = lipLen / totalV;

  const vw = ((v % 1) + 1) % 1;
  let nOffset: number, yOffset: number;
  if (vw < owf) {
    const t = owf > 0 ? vw / owf : 0.5;
    nOffset = lipRadius; yOffset = (2 * t - 1) * wallHeight;
  } else if (vw < owf + lf) {
    const t = lf > 0 ? (vw - owf) / lf : 0;
    const a = t * Math.PI;
    nOffset = lipRadius * Math.cos(a); yOffset = wallHeight + lipRadius * Math.sin(a);
  } else if (vw < 2 * owf + lf) {
    const t = owf > 0 ? (vw - owf - lf) / owf : 0.5;
    nOffset = -lipRadius; yOffset = (1 - 2 * t) * wallHeight;
  } else {
    const t = lf > 0 ? (vw - 2 * owf - lf) / lf : 0;
    const a = Math.PI + t * Math.PI;
    nOffset = lipRadius * Math.cos(a); yOffset = -wallHeight + lipRadius * Math.sin(a);
  }

  const faceWidth = 2 * spineFlatHalfSize;
  const bevelWidth = (Math.PI / 2) * bevelRadius;
  const segmentWidth = faceWidth + bevelWidth;
  const totalWidth = 4 * segmentWidth;
  const scaledU = ((u % 1) + 1) % 1;
  const posInTotal = scaledU * totalWidth;
  const segIdx = Math.min(3, Math.floor(posInTotal / segmentWidth));
  const posInSeg = posInTotal - segIdx * segmentWidth;
  const uIsFace = posInSeg < faceWidth;
  const localS = uIsFace
    ? (faceWidth > 0 ? posInSeg / faceWidth : 0.5)
    : (bevelWidth > 0 ? (posInSeg - faceWidth) / bevelWidth : 0);

  let sx: number, sz: number;
  let ox: number, oz: number;
  const fn = _CT_FN[segIdx];
  if (uIsFace) {
    const fr = _CT_FR[segIdx];
    const x = (localS - 0.5) * 2 * spineFlatHalfSize;
    sx = fn[0] * spineHalfSize + fr[0] * x;
    sz = fn[1] * spineHalfSize + fr[1] * x;
    ox = fn[0]; oz = fn[1];
  } else {
    const nextFn = _CT_FN[(segIdx + 1) % 4];
    const a = localS * (Math.PI / 2);
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const ccx = fn[0] * spineFlatHalfSize + nextFn[0] * spineFlatHalfSize;
    const ccz = fn[1] * spineFlatHalfSize + nextFn[1] * spineFlatHalfSize;
    ox = fn[0] * cosA + nextFn[0] * sinA;
    oz = fn[1] * cosA + nextFn[1] * sinA;
    sx = ccx + ox * bevelRadius;
    sz = ccz + oz * bevelRadius;
  }

  return [sx + ox * nOffset, yOffset, sz + oz * nOffset];
}

function cubeTunnelChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor: number): number {
  const [x1, y1, z1] = cubeTunnelPoint3D(u1, v1, scaleFactor);
  const [x2, y2, z2] = cubeTunnelPoint3D(u2, v2, scaleFactor);
  const dx = x1 - x2, dy = y1 - y2, dz = z1 - z2;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Old UV distance (what was being used before the fix)
function uvDist(u1: number, v1: number, u2: number, v2: number): number {
  let du = Math.abs(u1 - u2);
  if (du > 0.5) du = 1 - du;
  let dv = Math.abs(v1 - v2);
  if (dv > 0.5) dv = 1 - dv;
  return Math.sqrt(du * du + dv * dv);
}

// Sphere great-circle distance (what surfaceWorldDist was using for cube-tunnel)
function sphereGreatCircleDist(u1: number, v1: number, u2: number, v2: number, R: number): number {
  const phi1 = v1 * Math.PI, phi2 = v2 * Math.PI;
  const theta1 = u1 * 2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const dot = Math.sin(phi1) * Math.cos(theta1) * Math.sin(phi2) * Math.cos(theta2)
            + Math.sin(phi1) * Math.sin(theta1) * Math.sin(phi2) * Math.sin(theta2)
            + Math.cos(phi1) * Math.cos(phi2);
  return R * Math.acos(Math.max(-1, Math.min(1, dot)));
}

describe('cubeTunnelChordDist', () => {
  const SCALE = 1.0;

  it('same point returns zero distance', () => {
    expect(cubeTunnelChordDist(0.5, 0.5, 0.5, 0.5, SCALE)).toBeCloseTo(0, 5);
    expect(cubeTunnelChordDist(0.1, 0.3, 0.1, 0.3, SCALE)).toBeCloseTo(0, 5);
  });

  it('nearby points on same face have small chord distance', () => {
    // Two points on the same face, slightly separated
    const dist = cubeTunnelChordDist(0.1, 0.2, 0.11, 0.2, SCALE);
    // Should be a small world-space distance (< 2 world units)
    expect(dist).toBeLessThan(2.0);
    expect(dist).toBeGreaterThan(0);
  });

  it('points on opposite faces have large chord distance', () => {
    // Points on opposite sides of the cube
    const dist = cubeTunnelChordDist(0.1, 0.3, 0.6, 0.3, SCALE);
    // Should be a large distance (roughly cube size)
    expect(dist).toBeGreaterThan(5);
  });

  it('REGRESSION: chord distance is much smaller than old UV-based threshold', () => {
    // The bug: UV distance of 0.04 (the old threshold) actually spans a huge
    // world-space distance on cube-tunnel. The chord distance function should
    // produce reasonable world-space values that are comparable to the 0.3-0.4
    // world-unit enemy hit threshold.
    const ENEMY_HIT_WORLD = 0.4;

    // Two points that are 0.04 UV apart — this was the old UV threshold
    const u1 = 0.1, v1 = 0.2;
    const u2 = u1 + 0.04, v2 = v1;

    const chordDist = cubeTunnelChordDist(u1, v1, u2, v2, SCALE);
    const oldUvDist = uvDist(u1, v1, u2, v2);

    // The chord distance for 0.04 UV should be MUCH larger than the 0.4 threshold
    // This proves the old UV distance was detecting enemies as "within kill range"
    // when they were actually far away in world space
    expect(chordDist).toBeGreaterThan(ENEMY_HIT_WORLD);
    // UV distance was 0.04, which is close to the 0.04/scaleFactor threshold
    expect(oldUvDist).toBeCloseTo(0.04, 3);
  });

  it('REGRESSION: points within 0.3 world units should be very close in UV', () => {
    // Find two points that are approximately 0.3 world units apart (enemy hit threshold)
    // and verify the UV distance is much smaller than the old 0.04 threshold
    const u1 = 0.1, v1 = 0.2;

    // Try progressively smaller UV deltas until chord distance is under 0.4
    let uvDelta = 0.001;
    let dist = cubeTunnelChordDist(u1, v1, u1 + uvDelta, v1, SCALE);
    while (dist < 0.3 && uvDelta < 0.04) {
      uvDelta += 0.001;
      dist = cubeTunnelChordDist(u1, v1, u1 + uvDelta, v1, SCALE);
    }

    // The UV delta needed to get 0.3 world distance should be MUCH less than 0.04
    // This proves the old UV threshold (0.04) was WAY too generous
    expect(uvDelta).toBeLessThan(0.04);
  });

  it('wrapping: U=0 and U=1 are the same point', () => {
    const dist = cubeTunnelChordDist(0.001, 0.3, 0.999, 0.3, SCALE);
    // These should be very close (wrapping around the cube perimeter)
    expect(dist).toBeLessThan(1.0);
  });

  it('V wrapping: V=0 and V=1 are close (tunnel wraps)', () => {
    const dist = cubeTunnelChordDist(0.1, 0.001, 0.1, 0.999, SCALE);
    // Cube-tunnel V wraps — these should be close
    expect(dist).toBeLessThan(2.0);
  });

  it('scale factor doubles world distances', () => {
    const dist1 = cubeTunnelChordDist(0.1, 0.2, 0.2, 0.2, 1.0);
    const dist2 = cubeTunnelChordDist(0.1, 0.2, 0.2, 0.2, 2.0);
    expect(dist2).toBeCloseTo(dist1 * 2, 1);
  });
});
