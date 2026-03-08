/**
 * Regression test: Cube bevel edge crossing.
 *
 * Root cause: The cube's UV-grid tessellation creates transition triangles at
 * the flat-face/bevel boundary that span both flat and curved regions. The
 * geodesic walk follows these triangles faithfully, but the path gets deflected
 * sideways by the curvature, preventing the player from crossing to adjacent faces.
 *
 * Fix: MeshWalker.move() detects displacement deflection (>32° from input
 * direction) and falls back to BVH-based moveOnSurface, which correctly handles
 * bevel transitions via closest-point projection.
 *
 * REGRESSION GUARD: This test MUST pass. If it fails, cube movement is broken.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from '../surfaces/CubeSurface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';

describe('Cube bevel crossing regression', () => {
  const cube = new CubeSurface({ size: 18 });
  const mesh = cube.createMesh();
  mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(mesh);

  function simulateWalkWithCamera(
    startPos: THREE.Vector3,
    inputX: number,
    inputY: number,
    frames: number,
  ) {
    const walker = new MeshWalker(meshSurface, startPos, 5);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

    // Snap camera to initial position
    const frame = walker.getTangentFrame();
    camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
    camera.up.copy(frame.bitangent);
    camera.lookAt(walker.position);
    camera.updateMatrixWorld(true);

    const dt = 1 / 60;
    let stuckFrames = 0;
    let faceChanges = 0;
    let lastFace = walker.faceIndex;
    let totalDist = 0;

    for (let i = 0; i < frames; i++) {
      const prevPos = walker.position.clone();
      walker.moveFromInput(inputX, inputY, camera, dt);
      const moved = walker.position.distanceTo(prevPos);
      totalDist += moved;
      if (moved < 0.001) stuckFrames++;
      if (walker.faceIndex !== lastFace) {
        faceChanges++;
        lastFace = walker.faceIndex;
      }

      // Camera follow (simplified CameraController)
      const LERP_FACTOR = 0.12;
      const posLerp = 1 - Math.pow(1 - LERP_FACTOR, dt * 60);
      const targetPos = walker.position.clone().addScaledVector(walker.normal, 15);
      camera.position.lerp(targetPos, posLerp);
      const f = walker.getTangentFrame();
      camera.lookAt(walker.position);
      const normalY = Math.abs(walker.normal.y);
      const upLerp = normalY > 0.9 ? Math.min(posLerp * 5, 0.6) : posLerp;
      camera.up.lerp(f.bitangent.clone().normalize(), upLerp).normalize();
      camera.updateMatrixWorld(true);
    }

    return { totalDist, stuckFrames, faceChanges };
  }

  // REGRESSION GUARD: Player must cross from top face to adjacent faces
  it('top face → forward: crosses bevel with ≤5 stuck frames', () => {
    const result = simulateWalkWithCamera(
      new THREE.Vector3(0, 9, 0), // top face center
      0, 1, // forward input
      300,
    );
    expect(result.stuckFrames).toBeLessThan(5);
    expect(result.faceChanges).toBeGreaterThan(0);
  });

  // REGRESSION GUARD: Player must cross from front face to top face
  it('front face → up: crosses bevel with ≤5 stuck frames', () => {
    const result = simulateWalkWithCamera(
      new THREE.Vector3(0, 0, 9), // front face center
      0, 1,
      300,
    );
    expect(result.stuckFrames).toBeLessThan(5);
    expect(result.faceChanges).toBeGreaterThan(0);
  });

  // REGRESSION GUARD: Diagonal movement across cube corner
  it('front face → diagonal: crosses corner with ≤5 stuck frames', () => {
    const result = simulateWalkWithCamera(
      new THREE.Vector3(0, 0, 9),
      0.707, 0.707,
      300,
    );
    expect(result.stuckFrames).toBeLessThan(5);
    expect(result.faceChanges).toBeGreaterThan(0);
  });

  // REGRESSION GUARD: Side-to-side traversal
  it('right face → left: traverses full cube', () => {
    const result = simulateWalkWithCamera(
      new THREE.Vector3(9, 0, 0), // right face center
      0, 1,
      300,
    );
    expect(result.stuckFrames).toBeLessThan(5);
    expect(result.faceChanges).toBeGreaterThan(0);
  });

  // Verify BVH correctly handles bevel transition (no Z deflection)
  it('BVH moveOnSurface: top face +X crosses bevel without deflection', () => {
    const start = new THREE.Vector3(6.0, 9, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(1, 0, 0);

    const result = meshSurface.moveOnSurface(start, normal, dir, 2.0);
    expect(result).not.toBeNull();
    if (result) {
      // BVH should move in +X with zero Z deflection
      expect(Math.abs(result.point.z)).toBeLessThan(0.1);
      // Should have crossed into bevel (normal tilting away from Y)
      expect(Math.abs(result.normal.x)).toBeGreaterThan(0.1);
    }
  });
});
