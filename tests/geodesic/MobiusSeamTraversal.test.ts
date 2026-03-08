/**
 * MobiusSeamTraversal — Regression test for s44r3-08.
 *
 * The Mobius strip is a non-orientable surface. At the UV seam, adjacent faces
 * share edges that go in the SAME direction (instead of opposite, as on orientable
 * manifolds). This caused HalfEdgeMesh to treat them as boundary edges, creating
 * an invisible wall that blocked player movement.
 *
 * This test verifies:
 * 1. HalfEdgeMesh links non-orientable seam edges (no false boundaries at seam)
 * 2. FaceWalker can walk across the seam without getting reflected
 * 3. A full loop around the strip covers the full circumference
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HalfEdgeMesh } from '../../src/surfaces/geodesic/HalfEdgeMesh';
import { FaceWalker } from '../../src/surfaces/geodesic/FaceWalker';

const R = 8; // majorRadius
const W = 3; // stripWidth
const GRID_U = 32;
const GRID_V = 8;
const SEG_U = GRID_U * 2; // 64
const SEG_V = GRID_V * 2; // 16

/** Build a Mobius strip mesh identical to MobiusSurface.createMesh() */
function buildMobiusMesh(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < SEG_U; i++) {
    const t = (i / SEG_U) * Math.PI * 2;
    const halfT = t / 2;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const cosHalfT = Math.cos(halfT);
    const sinHalfT = Math.sin(halfT);

    for (let j = 0; j <= SEG_V; j++) {
      const s = (j / SEG_V - 0.5) * 2 * W;
      vertices.push(
        (R + s * cosHalfT) * cosT,
        (R + s * cosHalfT) * sinT,
        s * sinHalfT,
      );

      const dtX = -s * 0.5 * sinHalfT * cosT - (R + s * cosHalfT) * sinT;
      const dtY = -s * 0.5 * sinHalfT * sinT + (R + s * cosHalfT) * cosT;
      const dtZ = s * 0.5 * cosHalfT;
      const dsX = cosHalfT * cosT;
      const dsY = cosHalfT * sinT;
      const dsZ = sinHalfT;

      const tangentU = new THREE.Vector3(dtX, dtY, dtZ);
      const tangentV = new THREE.Vector3(dsX, dsY, dsZ);
      const normal = new THREE.Vector3().crossVectors(tangentU, tangentV).normalize();
      normals.push(normal.x, normal.y, normal.z);
    }
  }

  // Main body triangles
  for (let i = 0; i < SEG_U - 1; i++) {
    for (let j = 0; j < SEG_V; j++) {
      const a = i * (SEG_V + 1) + j;
      const b = a + SEG_V + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // Mobius twist seam
  const lastBodyRow = (SEG_U - 1) * (SEG_V + 1);
  for (let j = 0; j < SEG_V; j++) {
    const a = lastBodyRow + j;
    const b = 0 + (SEG_V - j);
    const c = lastBodyRow + j + 1;
    const d = 0 + (SEG_V - j - 1);
    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Get the angle t ∈ [0, 2π) of a world position around the strip center.
 * This tells us "where along the loop" a point is.
 */
function getStripAngle(pos: THREE.Vector3): number {
  let t = Math.atan2(pos.y, pos.x);
  if (t < 0) t += Math.PI * 2;
  return t;
}

describe('Mobius strip seam traversal', () => {
  const geometry = buildMobiusMesh();
  const halfEdge = new HalfEdgeMesh(geometry);
  const faceWalker = new FaceWalker(halfEdge);

  it('should have non-orientable twin edges at the seam (no false boundaries)', () => {
    let boundaryCount = 0;
    let nonOrientableCount = 0;

    for (const he of halfEdge.halfEdges) {
      if (he.twin < 0) boundaryCount++;
      if (he.nonOrientable) nonOrientableCount++;
    }

    // The Mobius strip seam has edges where adjacent faces share same-direction
    // edges due to the non-orientable twist. These MUST be linked as twins with
    // nonOrientable=true. There are exactly SEG_V such edge pairs.
    expect(nonOrientableCount).toBeGreaterThan(0);

    // Only real physical boundary edges should remain (strip edges at v=0 and v=1).
    // No false boundaries at the UV seam.
    const expectedMaxBoundaries = 2 * SEG_U + 4; // physical strip edges + small tolerance
    expect(boundaryCount).toBeLessThanOrEqual(expectedMaxBoundaries);
  });

  it('should walk across the seam without bouncing back', () => {
    // Start at a face about 75% around the strip (near the seam at t≈2π).
    // Walk forward. If the seam is solid, the walker bounces back and the
    // final angle stays near 75%. If the seam is passable, the walker crosses
    // it and the final angle wraps past 0%.

    // Face index for ~75% around the strip, mid-width
    const rowIdx = Math.floor(SEG_U * 0.75);
    const colIdx = Math.floor(SEG_V / 2);
    const startFaceIdx = rowIdx * SEG_V * 2 + colIdx * 2;

    const startBary = { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
    const [pA, pB, pC] = halfEdge.getFaceVertices(startFaceIdx);
    const startPos = new THREE.Vector3()
      .addScaledVector(pA, startBary.u)
      .addScaledVector(pB, startBary.v)
      .addScaledVector(pC, startBary.w);
    const startAngle = getStripAngle(startPos);

    // Walk direction: tangent to the strip circle at this point
    const faceNormal = halfEdge.faces[startFaceIdx].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    // Project onto face tangent plane
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal));
    tangent.normalize();

    // Walk 40% of circumference — should cross the seam at t≈2π=0
    const circumference = 2 * Math.PI * R;
    const walkDist = circumference * 0.4;

    const result = faceWalker.walk(startFaceIdx, startBary, tangent, walkDist);
    const endAngle = getStripAngle(result.position);

    // Expected: started at ~75% (angle ~4.7 rad), walked 40% forward,
    // should end up at ~15% (angle ~0.9 rad) — having crossed the seam at 0/2π.
    //
    // If the seam is a wall: walk bounces back, ending near 55-95% — angle > π.
    // If the seam is passable: walk crosses, ending at ~15% — angle < π.
    //
    // Test that we ended up past the seam (angle wrapped around past 0)
    const wrappedForward = endAngle < Math.PI;
    expect(wrappedForward).toBe(true);
  });

  it('should complete a full loop covering most of the circumference', () => {
    // Walk one full circumference starting from a known position.
    // Track the maximum angular distance from start achieved during the walk.
    const circumference = 2 * Math.PI * R;

    const startFace = 0;
    const startBary = { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
    const [pA, pB, pC] = halfEdge.getFaceVertices(startFace);
    const startPos = new THREE.Vector3()
      .addScaledVector(pA, startBary.u)
      .addScaledVector(pB, startBary.v)
      .addScaledVector(pC, startBary.w);

    // Walk direction: tangent to circle
    const faceNormal = halfEdge.faces[startFace].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal));
    tangent.normalize();

    // Walk full circumference in small steps to track angular coverage
    const steps = 20;
    const stepDist = circumference / steps;
    let currentFace = startFace;
    let currentBary = { ...startBary };
    let currentDir = tangent.clone();
    let anglesVisited = new Set<number>();
    const startAngle = getStripAngle(startPos);

    for (let step = 0; step < steps; step++) {
      const result = faceWalker.walk(currentFace, currentBary, currentDir, stepDist);
      currentFace = result.faceIndex;
      currentBary = result.bary;
      currentDir = result.direction;

      const angle = getStripAngle(result.position);
      // Quantize angle into 8 octants
      anglesVisited.add(Math.floor(angle / (Math.PI / 4)));
    }

    // A full loop should visit most angular octants (0-7).
    // Without the seam fix, the walker bounces at the seam and only visits ~3-4 octants.
    // With the fix, it visits all 8 (or close to it, accounting for walk inaccuracies).
    expect(anglesVisited.size).toBeGreaterThanOrEqual(6);
  });
});
