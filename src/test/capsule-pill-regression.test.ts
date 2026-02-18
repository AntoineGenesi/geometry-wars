/**
 * Regression test: capsule/pill oscillation fix (s23-unified-movement-fix)
 *
 * FAILS without the fix (eps=0.1 in FaceWalker._computeEntryBary):
 *   capsule osc=0.327, pill osc=0.500 (threshold 0.25)
 *
 * PASSES with the fix (eps=0.005):
 *   capsule osc=0.000, pill osc=0.000
 *
 * Root cause: the entry nudge eps=0.1 added ~0.09*triangle_height world
 * displacement per edge crossing, causing oscillation at cap-cylinder
 * junctions where nudge direction alternates each crossing.
 *
 * Replicates Puppeteer conditions:
 * - No upHint (as GameLoop.ts uses)
 * - -inputY (as GameLoop.ts negates moveY)
 * - 9 steps per sample (like SwiftShader ~7fps with 60fps physics)
 */
import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

function runGameLikeTest(surfaceType: string, stepsPerSample: number, numSamples: number) {
  const surf = SurfaceFactory.create(surfaceType as any, {});
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  // Use the game's playerLocalPosition (same as game)
  const startPos = surf.playerLocalPosition || surf.getPoint(0.5, 0.5).position;
  const walker = new MeshWalker(meshSurface, startPos, 5);
  const dt = 1/60;

  // Camera setup like real game
  const camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 100);
  const frame = walker.getTangentFrame();
  camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
  camera.up.copy(frame.bitangent);
  camera.lookAt(walker.position);
  camera.updateMatrixWorld(true);

  const positions: THREE.Vector3[] = [walker.position.clone()];
  
  for (let sample = 0; sample < numSamples; sample++) {
    // Run multiple fixed steps per sample (like SwiftShader)
    for (let step = 0; step < stepsPerSample; step++) {
      // GameLoop.ts: NO upHint, moveY negated
      // W key => moveY=+1 from InputManager, then -moveY = -1 passed to moveFromInput
      // Actually looking at it: the Puppeteer test presses 'w' which should give forward.
      // GameLoop: moveFromInput(moveX, -moveY, camera, dt) with moveY = keyboard.W ? 1 : 0
      // So the game passes inputY=-1 when W is held.
      walker.moveFromInput(0, -1, camera, dt);
      
      // CameraController update (simplified)
      const walkerFrame = walker.getTangentFrame();
      const targetPos = walker.position.clone().addScaledVector(walker.normal, 15);
      camera.position.lerp(targetPos, 0.25);
      camera.up.lerp(walkerFrame.bitangent, 0.25).normalize();
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);
    }
    positions.push(walker.position.clone());
  }

  // Compute oscillation ratio (same as Puppeteer)
  const displacements = [];
  for (let i = 1; i < positions.length; i++) {
    const d = positions[i].clone().sub(positions[i-1]);
    if (d.length() >= 0.001) displacements.push(d);
  }
  
  let oscillating = 0;
  for (let i = 1; i < displacements.length; i++) {
    if (displacements[i-1].dot(displacements[i]) < 0) oscillating++;
  }
  const oscillationRatio = displacements.length > 1 ? oscillating / (displacements.length - 1) : 0;
  
  return { oscillationRatio, sampleCount: displacements.length };
}

describe('Game-like capsule/pill test (no upHint, negated moveY)', () => {
  const STPS = 9; // ~7fps SwiftShader with 60fps physics = ~8.57 steps/sample

  it('capsule: oscillation ratio < 0.25 (like Puppeteer audit)', () => {
    const r = runGameLikeTest('capsule', STPS, 56); // 8s * 7fps = 56 samples
    console.log(`capsule osc=${r.oscillationRatio.toFixed(3)} samples=${r.sampleCount}`);
    expect(r.oscillationRatio).toBeLessThan(0.25);
  });

  it('pill: oscillation ratio < 0.25 (like Puppeteer audit)', () => {
    const r = runGameLikeTest('pill', STPS, 56);
    console.log(`pill osc=${r.oscillationRatio.toFixed(3)} samples=${r.sampleCount}`);
    expect(r.oscillationRatio).toBeLessThan(0.25);
  });

  it('sphere: oscillation ratio < 0.25 (should still pass)', () => {
    const r = runGameLikeTest('sphere', STPS, 56);
    console.log(`sphere osc=${r.oscillationRatio.toFixed(3)} samples=${r.sampleCount}`);
    expect(r.oscillationRatio).toBeLessThan(0.25);
  });
  
  it('torus: oscillation ratio < 0.25 (should still pass)', () => {
    const r = runGameLikeTest('torus', STPS, 56);
    console.log(`torus osc=${r.oscillationRatio.toFixed(3)} samples=${r.sampleCount}`);
    expect(r.oscillationRatio).toBeLessThan(0.25);
  });
});
