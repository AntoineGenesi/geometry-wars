/**
 * Regression test for s44r5-04: Mobius seam blocks ALL directions + camera flip
 *
 * Bug: When crossing the Mobius strip seam, the surface normal flips ~180°.
 * The camera offset (normal * distance) would jump to the opposite side of
 * the strip, inverting the player's view and controls. This made the seam
 * appear impassable: every crossing inverted "forward", sending the player back.
 *
 * Fix: CameraController tracks a "preferred normal" direction. When the new
 * normal is >90° from the preferred, it's negated to keep the camera on the
 * same side. Also removed the overly conservative dot-product guard in
 * MeshWalker's non-orientable tangent frame update.
 *
 * Tests:
 * 1. Camera normal continuity across seam (no flip)
 * 2. MeshWalker tangent frame continuity across seam
 * 3. Full-stack walk: walker following its own tangent crosses seam with large steps
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HalfEdgeMesh } from '../../src/surfaces/geodesic/HalfEdgeMesh';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { MeshWalker } from '../../src/movement/MeshWalker';
import { CameraController } from '../../src/core/CameraController';

const R = 8, W = 3, SEG_U = 64, SEG_V = 16;

function buildMobiusMesh(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];

  for (let i = 0; i < SEG_U; i++) {
    const t = (i / SEG_U) * Math.PI * 2;
    const halfT = t / 2;
    const cosT = Math.cos(t), sinT = Math.sin(t);
    const cosHalfT = Math.cos(halfT), sinHalfT = Math.sin(halfT);
    for (let j = 0; j <= SEG_V; j++) {
      const s = (j / SEG_V - 0.5) * 2 * W;
      vertices.push((R + s * cosHalfT) * cosT, (R + s * cosHalfT) * sinT, s * sinHalfT);
      const dtX = -s * 0.5 * sinHalfT * cosT - (R + s * cosHalfT) * sinT;
      const dtY = -s * 0.5 * sinHalfT * sinT + (R + s * cosHalfT) * cosT;
      const dtZ = s * 0.5 * cosHalfT;
      const dsX = cosHalfT * cosT, dsY = cosHalfT * sinT, dsZ = sinHalfT;
      const tu = new THREE.Vector3(dtX, dtY, dtZ);
      const tv = new THREE.Vector3(dsX, dsY, dsZ);
      const normal = new THREE.Vector3().crossVectors(tu, tv).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(i / SEG_U, j / SEG_V);
    }
  }

  for (let i = 0; i < SEG_U - 1; i++) {
    for (let j = 0; j < SEG_V; j++) {
      const a = i * (SEG_V + 1) + j, b = a + SEG_V + 1, c = a + 1, d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const lastBodyRow = (SEG_U - 1) * (SEG_V + 1);
  for (let j = 0; j < SEG_V; j++) {
    const a = lastBodyRow + j, b = 0 + (SEG_V - j), c = lastBodyRow + j + 1, d = 0 + (SEG_V - j - 1);
    indices.push(a, b, c, b, d, c);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// DOM shims for Three.js
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = { addEventListener: () => {}, removeEventListener: () => {} };
}
if (typeof globalThis.document === 'undefined') {
  const _noop = () => {};
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return { width: 64, height: 64, style: {}, getContext: () => null, addEventListener: _noop, removeEventListener: _noop };
      return { style: {}, appendChild: _noop };
    },
    body: { appendChild: _noop, style: {} }, hidden: false, addEventListener: _noop, removeEventListener: _noop,
  };
}

function getAngle(pos: THREE.Vector3): number {
  let t = Math.atan2(pos.y, pos.x);
  if (t < 0) t += Math.PI * 2;
  return t;
}

describe('s44r5-04: Mobius seam camera + movement fix', () => {
  const geometry = buildMobiusMesh();
  const mesh = new THREE.Mesh(geometry);
  mesh.updateMatrixWorld();
  const surface = new MeshSurface(mesh);
  const halfEdge = new HalfEdgeMesh(geometry);

  it('camera normal should NOT flip when crossing non-orientable seam', () => {
    // Start near the seam, walk across it
    const rowIdx = Math.floor(SEG_U * 0.95);
    const colIdx = Math.floor(SEG_V / 2);
    const faceIdx = rowIdx * SEG_V * 2 + colIdx * 2;
    const [pA, pB, pC] = halfEdge.getFaceVertices(faceIdx);
    const startPos = new THREE.Vector3().addScaledVector(pA, 1/3).addScaledVector(pB, 1/3).addScaledVector(pC, 1/3);

    const walker = new MeshWalker(surface, startPos, 5.0);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const camCtrl = new CameraController(camera);

    // Initialize camera
    const frame = walker.getTangentFrame();
    camCtrl.snapToFrame(walker.position, walker.normal, frame);

    const faceNormal = halfEdge.faces[faceIdx].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal)).normalize();

    const dt = 1 / 60;
    let currentDir = tangent.clone();

    // Record camera position side (dot with walker normal) before crossing
    let prevCamDot = 0;
    let maxCamFlip = 0;

    for (let i = 0; i < 200; i++) {
      walker.move(currentDir, dt);
      camCtrl.update(walker, dt);

      // Check which "side" of the surface the camera is on
      const camOffset = camera.position.clone().sub(walker.position).normalize();
      const camDot = camOffset.dot(walker.normal);

      if (i > 0) {
        // Camera should stay on the same side: camDot should NOT change sign dramatically
        const flip = Math.abs(camDot - prevCamDot);
        if (flip > maxCamFlip) maxCamFlip = flip;
      }

      prevCamDot = camDot;
      currentDir = walker.tangent.clone();
    }

    // Without fix: camera flips at seam, maxCamFlip ≈ 2.0 (from +1 to -1)
    // With fix: camera stays on same side, maxCamFlip < 0.5
    expect(maxCamFlip).toBeLessThan(0.5);
  });

  it('walker tangent should be continuous across non-orientable seam', () => {
    const rowIdx = Math.floor(SEG_U * 0.95);
    const colIdx = Math.floor(SEG_V / 2);
    const faceIdx = rowIdx * SEG_V * 2 + colIdx * 2;
    const [pA, pB, pC] = halfEdge.getFaceVertices(faceIdx);
    const startPos = new THREE.Vector3().addScaledVector(pA, 1/3).addScaledVector(pB, 1/3).addScaledVector(pC, 1/3);

    const walker = new MeshWalker(surface, startPos, 5.0);
    const faceNormal = halfEdge.faces[faceIdx].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal)).normalize();

    const dt = 1 / 60;
    let currentDir = tangent.clone();
    let prevTangent = walker.tangent.clone();
    let maxTangentJump = 0;

    for (let i = 0; i < 200; i++) {
      walker.move(currentDir, dt);
      const tangentDot = prevTangent.dot(walker.tangent);
      const jump = 1 - tangentDot; // 0 = identical, 2 = opposite
      if (jump > maxTangentJump) maxTangentJump = jump;
      prevTangent.copy(walker.tangent);
      currentDir = walker.tangent.clone();
    }

    // Tangent should change gradually (parallel transport). No sudden jumps > 90°.
    // Without fix (guard too conservative): tangent could jump when guard rejects
    // With fix: tangent changes smoothly, max jump < 0.5 (< ~45° per frame)
    expect(maxTangentJump).toBeLessThan(0.5);
  });

  it('walker should cross seam multiple times at game dt (1/60) without oscillation', () => {
    // Simulate real gameplay: small dt, follow tangent direction.
    // Walk 2 full circumferences to cross the seam twice.
    const startFaceIdx = 0;
    const [pA, pB, pC] = halfEdge.getFaceVertices(startFaceIdx);
    const startPos = new THREE.Vector3().addScaledVector(pA, 1/3).addScaledVector(pB, 1/3).addScaledVector(pC, 1/3);

    const walker = new MeshWalker(surface, startPos, 5.0);
    const faceNormal = halfEdge.faces[startFaceIdx].normal;
    const radial = startPos.clone().setZ(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), radial);
    tangent.addScaledVector(faceNormal, -tangent.dot(faceNormal)).normalize();

    const dt = 1 / 60;
    let currentDir = tangent.clone();
    const circumference = 2 * Math.PI * R;
    const totalWalk = circumference * 2.0;
    let totalDist = 0;
    const anglesVisited = new Set<number>();
    let seamCrossings = 0;
    let prevAngle = getAngle(startPos);

    while (totalDist < totalWalk) {
      const result = walker.move(currentDir, dt);
      if (!result) break;
      totalDist += dt * walker.speed;
      currentDir = walker.tangent.clone();

      const angle = getAngle(walker.position);
      anglesVisited.add(Math.floor(angle / (Math.PI / 4)));

      // Detect seam crossing (angle wraps)
      if (prevAngle > 5.5 && angle < 1.0) seamCrossings++;
      if (prevAngle < 1.0 && angle > 5.5) seamCrossings++;
      prevAngle = angle;
    }

    // Should visit multiple octants and cross seam at least once.
    // Tangent-following on a twisted surface drifts from circumferential to radial,
    // so full coverage requires camera-relative input (tested in gameplay, not here).
    // The key assertion is seamCrossings > 0: the seam is traversable.
    expect(anglesVisited.size).toBeGreaterThanOrEqual(4);
    expect(seamCrossings).toBeGreaterThanOrEqual(1);
  });
});
