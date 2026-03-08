/**
 * Realistic cube simulation test — mimics the actual GameLoop camera+movement loop
 * to find the root cause of cube map movement blocking and aim issues.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from '../surfaces/CubeSurface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';

describe('Realistic cube movement simulation', () => {
  const cube = new CubeSurface({ size: 18 });
  const mesh = cube.createMesh();
  mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(mesh);

  /**
   * Simulate camera follow without CameraController (avoids document dependency).
   * Implements the same math as CameraController.update().
   */
  function updateCamera(
    camera: THREE.PerspectiveCamera,
    walkerPos: THREE.Vector3,
    walkerNormal: THREE.Vector3,
    bitangent: THREE.Vector3,
    dt: number,
  ) {
    const CAMERA_DIST = 15;
    const LERP_FACTOR = 0.12;
    const posLerp = 1 - Math.pow(1 - LERP_FACTOR, dt * 60);

    const targetPos = walkerPos.clone().addScaledVector(walkerNormal, CAMERA_DIST);
    camera.position.lerp(targetPos, posLerp);

    const camUp = bitangent.clone().normalize();
    camera.lookAt(walkerPos);

    const normalY = Math.abs(walkerNormal.y);
    const upLerp = normalY > 0.9 ? Math.min(posLerp * 5, 0.6) : posLerp;
    camera.up.lerp(camUp, upLerp).normalize();
  }

  function simulateWalk(
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
    let aimDegenerateFrames = 0;

    for (let i = 0; i < frames; i++) {
      const prevPos = walker.position.clone();

      // Step 1: Move using camera-relative input (same as GameLoop)
      walker.moveFromInput(inputX, inputY, camera, dt);

      const moved = walker.position.distanceTo(prevPos);
      totalDist += moved;
      if (moved < 0.001) stuckFrames++;
      if (walker.faceIndex !== lastFace) {
        faceChanges++;
        lastFace = walker.faceIndex;
      }

      // Step 2: Camera follow
      const f = walker.getTangentFrame();
      updateCamera(camera, walker.position, walker.normal, f.bitangent, dt);
      camera.updateMatrixWorld(true);

      // Step 3: Check aim axes
      const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const playerNormal = walker.normal;
      camRight.addScaledVector(playerNormal, -camRight.dot(playerNormal));
      camUp.addScaledVector(playerNormal, -camUp.dot(playerNormal));
      const useCameraAxes = camRight.lengthSq() > 0.01 && camUp.lengthSq() > 0.01;
      if (!useCameraAxes) aimDegenerateFrames++;

      // Debug: log every 50 frames
      if (i % 50 === 0) {
        console.log(`  frame ${i}: pos=(${walker.position.x.toFixed(2)}, ${walker.position.y.toFixed(2)}, ${walker.position.z.toFixed(2)}) normal=(${walker.normal.x.toFixed(2)}, ${walker.normal.y.toFixed(2)}, ${walker.normal.z.toFixed(2)}) moved=${moved.toFixed(4)} aimOk=${useCameraAxes}`);
      }
    }

    return {
      totalDist,
      displacement: walker.position.distanceTo(startPos),
      stuckFrames,
      faceChanges,
      aimDegenerateFrames,
      endPos: walker.position.clone(),
      endNormal: walker.normal.clone(),
    };
  }

  it('front face → up (should cross to top face)', () => {
    const result = simulateWalk(new THREE.Vector3(0, 0, 9), 0, 1, 300);

    console.log('front → up simulation:');
    console.log(`  totalDist=${result.totalDist.toFixed(2)}, displacement=${result.displacement.toFixed(2)}`);
    console.log(`  stuckFrames=${result.stuckFrames}/300, faceChanges=${result.faceChanges}`);
    console.log(`  aimDegenerateFrames=${result.aimDegenerateFrames}`);
    console.log(`  endNormal=(${result.endNormal.x.toFixed(3)}, ${result.endNormal.y.toFixed(3)}, ${result.endNormal.z.toFixed(3)})`);

    expect(result.stuckFrames).toBeLessThan(60);
  });

  it('front face → right (should cross to right face)', () => {
    const result = simulateWalk(new THREE.Vector3(0, 0, 9), 1, 0, 300);

    console.log('front → right simulation:');
    console.log(`  totalDist=${result.totalDist.toFixed(2)}, displacement=${result.displacement.toFixed(2)}`);
    console.log(`  stuckFrames=${result.stuckFrames}/300, faceChanges=${result.faceChanges}`);
    console.log(`  aimDegenerateFrames=${result.aimDegenerateFrames}`);

    expect(result.stuckFrames).toBeLessThan(60);
  });

  it('top face → forward (should cross to front face)', () => {
    const result = simulateWalk(new THREE.Vector3(0, 9, 0), 0, 1, 300);

    console.log('top → forward simulation:');
    console.log(`  totalDist=${result.totalDist.toFixed(2)}, displacement=${result.displacement.toFixed(2)}`);
    console.log(`  stuckFrames=${result.stuckFrames}/300, faceChanges=${result.faceChanges}`);
    console.log(`  aimDegenerateFrames=${result.aimDegenerateFrames}`);

    expect(result.stuckFrames).toBeLessThan(60);
  });

  it('right face → up (should cross to top face)', () => {
    const result = simulateWalk(new THREE.Vector3(9, 0, 0), 0, 1, 300);

    console.log('right → up simulation:');
    console.log(`  totalDist=${result.totalDist.toFixed(2)}, displacement=${result.displacement.toFixed(2)}`);
    console.log(`  stuckFrames=${result.stuckFrames}/300, faceChanges=${result.faceChanges}`);
    console.log(`  aimDegenerateFrames=${result.aimDegenerateFrames}`);

    expect(result.stuckFrames).toBeLessThan(60);
  });

  // Test where the player gets stuck at a vertex
  it('front face → diagonal (corner traverse)', () => {
    const result = simulateWalk(new THREE.Vector3(0, 0, 9), 0.707, 0.707, 300);

    console.log('front → diagonal simulation:');
    console.log(`  totalDist=${result.totalDist.toFixed(2)}, displacement=${result.displacement.toFixed(2)}`);
    console.log(`  stuckFrames=${result.stuckFrames}/300, faceChanges=${result.faceChanges}`);
    console.log(`  aimDegenerateFrames=${result.aimDegenerateFrames}`);

    expect(result.stuckFrames).toBeLessThan(60);
  });
});
