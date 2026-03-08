/**
 * Test: Cube aim direction on all faces.
 * Verifies that screen-space aim (aimX/aimY) correctly maps to world-space
 * bullet direction on each cube face.
 *
 * Reproduces GameLoop aim computation (lines 270-331).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from '../surfaces/CubeSurface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';

describe('Cube aim direction on all faces', () => {
  const cube = new CubeSurface({ size: 18 });
  const mesh = cube.createMesh();
  mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(mesh);

  function computeAimDirection(
    playerPos: THREE.Vector3,
    playerNormal: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    aimX: number,
    aimY: number,
  ): THREE.Vector3 | null {
    // Reproduce GameLoop aim computation
    camera.updateMatrixWorld();
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    camRight.addScaledVector(playerNormal, -camRight.dot(playerNormal));
    camUp.addScaledVector(playerNormal, -camUp.dot(playerNormal));
    const useCameraAxes = camRight.lengthSq() > 0.01 && camUp.lengthSq() > 0.01;

    let aimAxisX: THREE.Vector3;
    let aimAxisY: THREE.Vector3;
    if (useCameraAxes) {
      aimAxisX = camRight.normalize();
      aimAxisY = camUp.normalize();
    } else {
      const ref = Math.abs(playerNormal.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
      aimAxisX = new THREE.Vector3().crossVectors(ref, playerNormal).normalize();
      aimAxisY = new THREE.Vector3().crossVectors(playerNormal, aimAxisX).normalize();
    }

    const aimDirection = new THREE.Vector3()
      .addScaledVector(aimAxisX, aimX)
      .addScaledVector(aimAxisY, -aimY)
      .normalize();

    return aimDirection;
  }

  function setupCameraForFace(
    playerPos: THREE.Vector3,
    playerNormal: THREE.Vector3,
    bitangent: THREE.Vector3,
  ): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.copy(playerPos).addScaledVector(playerNormal, 15);
    camera.up.copy(bitangent);
    camera.lookAt(playerPos);
    camera.updateMatrixWorld(true);
    return camera;
  }

  const faces = [
    { name: 'front', pos: new THREE.Vector3(0, 0, 9), normal: new THREE.Vector3(0, 0, 1) },
    { name: 'right', pos: new THREE.Vector3(9, 0, 0), normal: new THREE.Vector3(1, 0, 0) },
    { name: 'back', pos: new THREE.Vector3(0, 0, -9), normal: new THREE.Vector3(0, 0, -1) },
    { name: 'left', pos: new THREE.Vector3(-9, 0, 0), normal: new THREE.Vector3(-1, 0, 0) },
    { name: 'top', pos: new THREE.Vector3(0, 9, 0), normal: new THREE.Vector3(0, 1, 0) },
    { name: 'bottom', pos: new THREE.Vector3(0, -9, 0), normal: new THREE.Vector3(0, -1, 0) },
  ];

  for (const face of faces) {
    it(`${face.name} face: aim covers 8 directions (non-degenerate, non-locked)`, () => {
      const walker = new MeshWalker(meshSurface, face.pos, 5);
      const frame = walker.getTangentFrame();
      const camera = setupCameraForFace(walker.position, walker.normal, frame.bitangent);

      // Test 8 directions (cardinal + diagonal)
      const directions = [
        { name: 'right', aimX: 1, aimY: 0 },
        { name: 'up', aimX: 0, aimY: -1 },
        { name: 'left', aimX: -1, aimY: 0 },
        { name: 'down', aimX: 0, aimY: 1 },
        { name: 'up-right', aimX: 0.707, aimY: -0.707 },
        { name: 'up-left', aimX: -0.707, aimY: -0.707 },
        { name: 'down-right', aimX: 0.707, aimY: 0.707 },
        { name: 'down-left', aimX: -0.707, aimY: 0.707 },
      ];

      const aimDirections: THREE.Vector3[] = [];

      for (const dir of directions) {
        const aimDir = computeAimDirection(
          walker.position, walker.normal, camera,
          dir.aimX, dir.aimY,
        );
        expect(aimDir).not.toBeNull();
        if (!aimDir) continue;

        // Direction should be on the surface plane
        const normalComponent = Math.abs(aimDir.dot(walker.normal));
        expect(normalComponent).toBeLessThan(0.1);

        // Direction should have significant length
        expect(aimDir.length()).toBeGreaterThan(0.9);

        aimDirections.push(aimDir);
      }

      // All 8 directions should be UNIQUE (not locked to 1-2 directions)
      // Check pairwise: opposite directions should be ~180° apart
      // Adjacent directions should be ~45° apart
      for (let i = 0; i < aimDirections.length; i++) {
        for (let j = i + 1; j < aimDirections.length; j++) {
          const dot = aimDirections[i].dot(aimDirections[j]);
          // No two directions should be exactly the same (dot ≈ 1)
          // unless they're supposed to be (none should be for 8 unique directions)
          expect(dot).toBeLessThan(0.99);
        }
      }

      // Opposite pairs should be approximately antiparallel
      const rightLeft = aimDirections[0].dot(aimDirections[2]);
      const upDown = aimDirections[1].dot(aimDirections[3]);
      expect(rightLeft).toBeLessThan(-0.9); // ~180° apart
      expect(upDown).toBeLessThan(-0.9);

      console.log(`${face.name} face aim directions OK (right-left dot=${rightLeft.toFixed(3)}, up-down dot=${upDown.toFixed(3)})`);
    });
  }

  it('aim direction consistency during face transition (front → top)', () => {
    // Walk from front face to top face and check aim consistency
    const walker = new MeshWalker(meshSurface, new THREE.Vector3(0, 0, 9), 5);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const frame = walker.getTangentFrame();
    camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
    camera.up.copy(frame.bitangent);
    camera.lookAt(walker.position);
    camera.updateMatrixWorld(true);

    const dt = 1 / 60;
    let aimDegenerateCount = 0;
    let aimFlipCount = 0;
    let lastAimRight: THREE.Vector3 | null = null;

    for (let i = 0; i < 200; i++) {
      walker.moveFromInput(0, 1, camera, dt);

      // Camera follow
      const f = walker.getTangentFrame();
      const posLerp = 1 - Math.pow(0.88, dt * 60);
      const targetPos = walker.position.clone().addScaledVector(walker.normal, 15);
      camera.position.lerp(targetPos, posLerp);
      camera.lookAt(walker.position);
      const normalY = Math.abs(walker.normal.y);
      const upLerp = normalY > 0.9 ? Math.min(posLerp * 5, 0.6) : posLerp;
      camera.up.lerp(f.bitangent.clone().normalize(), upLerp).normalize();
      camera.updateMatrixWorld(true);

      // Check aim direction for "right" input
      const aimDir = computeAimDirection(
        walker.position, walker.normal, camera, 1, 0,
      );
      if (!aimDir) {
        aimDegenerateCount++;
        continue;
      }

      if (lastAimRight) {
        const dot = aimDir.dot(lastAimRight);
        if (dot < 0) aimFlipCount++; // Direction flipped >90°
      }
      lastAimRight = aimDir.clone();
    }

    console.log(`Transition aim: degenerate=${aimDegenerateCount}, flips=${aimFlipCount}`);
    expect(aimDegenerateCount).toBeLessThan(5);
    expect(aimFlipCount).toBeLessThan(5);
  });
});
