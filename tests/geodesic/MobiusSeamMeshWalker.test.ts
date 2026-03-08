/**
 * MobiusSeamMeshWalker — Regression test for s44r4-04.
 *
 * The s44r3-08 fix (nonOrientable twin linking) made FaceWalker cross the seam.
 * But user says seam is STILL blocked in gameplay. This test checks the FULL STACK:
 * MeshSurface + MeshWalker (with deflection guard + BVH fallback), NOT just FaceWalker.
 *
 * Specifically tests:
 * 1. Does MobiusSurface geometry create edges that reach _linkSeamEdges?
 * 2. Are seam edges linked as nonOrientable twins?
 * 3. Does MeshWalker cross the seam (or does the deflection guard block it)?
 * 4. Does crossing from MULTIPLE approach angles work (tangential + diagonal + width-only)?
 *
 * Key difference from MobiusSeamTraversal.test.ts:
 * - That test exercises FaceWalker.walk() directly (no deflection guard, no BVH fallback)
 * - This test exercises MeshWalker.move() — the actual game code path
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HalfEdgeMesh } from '../../src/surfaces/geodesic/HalfEdgeMesh';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { MeshWalker } from '../../src/movement/MeshWalker';

// ---------------------------------------------------------------------------
// Mobius mesh builder — EXACTLY replicates MobiusSurface.createMesh() including
// vertex normals and UV attributes (the unit test in MobiusSeamTraversal skipped
// normals, which means HalfEdgeMesh's REGRESSION GUARD never ran there).
// ---------------------------------------------------------------------------

const R = 8;
const W = 3;
const GRID_U = 32;
const GRID_V = 8;
const SEG_U = GRID_U * 2; // 64
const SEG_V = GRID_V * 2; // 16

function buildMobiusMeshFull(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
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

      const tu = new THREE.Vector3(dtX, dtY, dtZ);
      const tv = new THREE.Vector3(dsX, dsY, dsZ);
      const normal = new THREE.Vector3().crossVectors(tu, tv).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(i / SEG_U, j / SEG_V);
    }
  }

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

  // Mobius twist seam (same as MobiusSurface.createMesh)
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
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Get the angle t ∈ [0, 2π) of a world position around the strip center.
 */
function getStripAngle(pos: THREE.Vector3): number {
  let t = Math.atan2(pos.y, pos.x);
  if (t < 0) t += Math.PI * 2;
  return t;
}

// ---------------------------------------------------------------------------
// Shim for browser environment (Three.js BVH needs minimal DOM)
// ---------------------------------------------------------------------------
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = { addEventListener: () => {}, removeEventListener: () => {} };
}
if (typeof globalThis.document === 'undefined') {
  const _noop = () => {};
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 64, height: 64, style: {},
          getContext: () => null,
          addEventListener: _noop, removeEventListener: _noop,
        };
      }
      return { style: {}, appendChild: _noop };
    },
    body: { appendChild: _noop, style: {} },
    hidden: false,
    addEventListener: _noop,
    removeEventListener: _noop,
  };
}

describe('Mobius seam — MeshWalker full-stack test (s44r4-04)', () => {
  const geometry = buildMobiusMeshFull();
  const halfEdge = new HalfEdgeMesh(geometry);
  const mesh = new THREE.Mesh(geometry);
  mesh.updateMatrixWorld();
  const surface = new MeshSurface(mesh);

  // -------------------------------------------------------------------------
  // CHECK 1: Are seam edges linked as nonOrientable twins?
  // (Tests whether the fix from s44r3-08 actually applies to the REAL geometry
  //  with vertex normals included, not just the stripped-down unit test mesh)
  // -------------------------------------------------------------------------
  it('should have nonOrientable twin edges (with vertex normals — real geometry)', () => {
    let boundaryCount = 0;
    let nonOrientableCount = 0;

    for (const he of halfEdge.halfEdges) {
      if (he.twin < 0) boundaryCount++;
      if (he.nonOrientable) nonOrientableCount++;
    }

    // Physical edges: 2 * SEG_U edges on each physical strip edge (v=0, v=1 sides)
    const physicalEdges = 2 * SEG_U + 4;
    expect(nonOrientableCount).toBeGreaterThan(0);
    expect(boundaryCount).toBeLessThanOrEqual(physicalEdges);
  });

  // -------------------------------------------------------------------------
  // CHECK 2: MeshWalker crosses the seam walking in pure tangential direction
  // (Same as the FaceWalker unit test, but via MeshWalker.move() which has
  //  the deflection guard and BVH fallback that the unit test bypasses)
  // -------------------------------------------------------------------------
  it('MeshWalker: should cross seam walking tangentially (no deflection guard issue)', () => {
    // Start at 75% around the strip (approaching the seam at t=0/2π from above)
    const rowIdx = Math.floor(SEG_U * 0.75);
    const colIdx = Math.floor(SEG_V / 2);
    const faceIdx = rowIdx * SEG_V * 2 + colIdx * 2;

    const bary = { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
    const [pA, pB, pC] = halfEdge.getFaceVertices(faceIdx);
    const startPos = new THREE.Vector3()
      .addScaledVector(pA, bary.u)
      .addScaledVector(pB, bary.v)
      .addScaledVector(pC, bary.w);

    const walker = new MeshWalker(surface, startPos, 5.0);

    // Walk direction: tangential (circle direction), same as FaceWalker test
    const faceNormal = halfEdge.faces[faceIdx].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal)).normalize();

    // Walk 40% of circumference — should cross the seam
    const circumference = 2 * Math.PI * R;
    const walkDist = circumference * 0.4;
    const stepDist = walker.speed; // 1 second of movement at speed 5

    let currentDir = tangent.clone();
    let totalDist = 0;
    let steps = 0;
    const maxSteps = 100;

    while (totalDist < walkDist && steps < maxSteps) {
      const result = walker.move(currentDir, 1.0); // 1 second steps
      if (result) {
        currentDir = walker.tangent.clone();
        totalDist += result.distance || stepDist;
      }
      steps++;
    }

    const endAngle = getStripAngle(walker.position);

    // If seam is passable, walker crossed from 75% (angle ~4.7 rad) to ~15% (angle ~0.9 rad)
    // endAngle < π means it crossed the seam (now in the 0-π range)
    // If seam is a wall: bounces back, stays in the π-2π range
    const wrappedForward = endAngle < Math.PI;
    expect(wrappedForward).toBe(true);
  });

  // -------------------------------------------------------------------------
  // CHECK 3: MeshWalker crosses seam at a DIAGONAL angle (mix of t and v)
  // This is the key test the s44r3-08 unit test MISSED.
  // When approaching at a diagonal, the v-component may cause the apparent
  // displacement to diverge from the intended direction, potentially triggering
  // the deflection guard in MeshWalker.move().
  // -------------------------------------------------------------------------
  it('MeshWalker: should cross seam at diagonal approach angle', () => {
    // Start at 90% around the strip, slightly off-center (v=0.6)
    const rowIdx = Math.floor(SEG_U * 0.90);
    const colIdx = Math.floor(SEG_V * 0.6); // slightly off-center
    const faceIdx = rowIdx * SEG_V * 2 + colIdx * 2;

    const bary = { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
    const [pA, pB, pC] = halfEdge.getFaceVertices(faceIdx);
    const startPos = new THREE.Vector3()
      .addScaledVector(pA, bary.u)
      .addScaledVector(pB, bary.v)
      .addScaledVector(pC, bary.w);

    const walker = new MeshWalker(surface, startPos, 5.0);

    const faceNormal = halfEdge.faces[faceIdx].normal;

    // Tangential direction (along strip circle)
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal)).normalize();

    // Width direction (across strip)
    const widthDir = radial.clone().negate(); // inward toward center
    widthDir.addScaledVector(faceNormal, -widthDir.dot(faceNormal)).normalize();

    // 45° diagonal: mix of tangential and width
    const diagonalDir = new THREE.Vector3()
      .addScaledVector(tangent, 0.707)
      .addScaledVector(widthDir, 0.3)
      .normalize();

    const circumference = 2 * Math.PI * R;
    const walkDist = circumference * 0.3;

    let currentDir = diagonalDir.clone();
    let totalDist = 0;
    let steps = 0;
    const maxSteps = 80;

    while (totalDist < walkDist && steps < maxSteps) {
      const result = walker.move(currentDir, 1.0);
      if (result) {
        // Keep same world-space direction (not transported) for simplicity
        totalDist += result.distance || walker.speed;
      }
      steps++;
    }

    const startAngle = getStripAngle(startPos);
    const endAngle = getStripAngle(walker.position);

    // After walking 30% of circumference starting from 90%, should be near 20%
    // If seam blocked: stays near 90% (angle ~5.65 rad)
    // If seam crossed: angle drops below π (about 0-2 rad range)
    const crossedSeam = endAngle < Math.PI || endAngle < startAngle - Math.PI;

    expect(crossedSeam).toBe(true);
  });

  // -------------------------------------------------------------------------
  // CHECK 4: Multiple consecutive crossings (walk 2 full loops around Mobius)
  // The Mobius strip requires 2 full loops to return to starting orientation.
  // If seam blocks, the walker stalls at t≈0 after the first approach.
  // -------------------------------------------------------------------------
  it('MeshWalker: should complete multiple consecutive seam crossings', () => {
    // Start at the beginning of the strip
    const startFaceIdx = 0;
    const bary = { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
    const [pA, pB, pC] = halfEdge.getFaceVertices(startFaceIdx);
    const startPos = new THREE.Vector3()
      .addScaledVector(pA, bary.u)
      .addScaledVector(pB, bary.v)
      .addScaledVector(pC, bary.w);

    const walker = new MeshWalker(surface, startPos, 5.0);

    const faceNormal = halfEdge.faces[startFaceIdx].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal)).normalize();

    // Walk 2 full circumferences in small steps (simulate gameplay)
    const circumference = 2 * Math.PI * R;
    const totalWalk = circumference * 2.0;
    const dt = 1 / 60; // simulate 60fps

    let anglesVisited = new Set<number>();
    let totalDist = 0;

    // Use walker.tangent (updated after each step) as the movement direction.
    // A constant world-space direction (tangent.clone()) can't complete circular loops
    // because the "forward" direction changes as the walker moves around the strip.
    // Using walker.tangent tracks the geodesic parallel transport correctly.
    let currentDir = tangent.clone();
    while (totalDist < totalWalk) {
      const result = walker.move(currentDir, dt);
      if (!result) break;
      totalDist += dt * walker.speed;

      // Update direction to tracked walker tangent (parallel transport around the strip)
      currentDir = walker.tangent.clone();

      const angle = getStripAngle(walker.position);
      anglesVisited.add(Math.floor(angle / (Math.PI / 4)));
    }

    // Should visit all 8 octants across 2 full loops
    // Without fix: gets stuck near the seam, only visits ~3-4 octants
    // With fix: visits all 8 octants (seam is transparent)
    expect(anglesVisited.size).toBeGreaterThanOrEqual(7);
  });
});
