/**
 * Debug test: Investigate why torus lateral movement barely works
 * (1.18 units in 120 frames vs 10+ for sphere/pill/capsule)
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

function createTorusWalker() {
  const surf = SurfaceFactory.create('torus', {
    radius: 10,
    gridColor: 0x2a2aaa,
    surfaceColor: 0x141440,
    surfaceOpacity: 0.35,
    gridOpacity: 0.4,
  } as any);
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(0.5, 0.5).position;
  return { walker: new MeshWalker(meshSurface, startPos, 5), meshSurface, surface: surf };
}

describe('Torus movement debug', () => {
  it('should report zero displacement for direct move(1,0,0) when direction is parallel to surface normal', () => {
    // At torus starting position (-4,0,0), the surface normal points along (1,0,0)
    // so move(1,0,0) has zero tangential component => zero displacement. This is
    // expected behavior, not a bug.
    const { walker } = createTorusWalker();
    const dir = new THREE.Vector3(1, 0, 0).normalize();
    let totalDisp = 0;

    for (let i = 0; i < 30; i++) {
      const prev = walker.position.clone();
      walker.move(dir, 1/60);
      totalDisp += walker.position.distanceTo(prev);
    }

    console.log(`Torus direct move (1,0,0): total=${totalDisp.toFixed(3)} (expected ~0 because direction is parallel to normal at start pos)`);
    // This confirms the surface normal direction at the starting position
    expect(totalDisp).toBeLessThan(0.1);
  });

  it('should analyze camera axes during lateral moveFromInput', () => {
    const { walker } = createTorusWalker();
    const dt = 1/60;

    const camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 100);
    const frame = walker.getTangentFrame();
    camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
    camera.up.copy(frame.bitangent);
    camera.lookAt(walker.position);
    camera.updateMatrixWorld(true);

    console.log(`Initial position: ${walker.position.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Initial normal: ${walker.normal.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Initial tangent: ${walker.getTangentFrame().tangent.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Initial bitangent: ${walker.getTangentFrame().bitangent.toArray().map(v=>v.toFixed(3))}`);

    // Get camera axes
    const worldQ = camera.getWorldQuaternion(new THREE.Quaternion());
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQ);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ);
    console.log(`Camera right: ${camRight.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Camera up: ${camUp.toArray().map(v=>v.toFixed(3))}`);

    // Project camera right onto surface
    const n = walker.normal;
    const projRight = camRight.clone().addScaledVector(n, -camRight.dot(n));
    console.log(`Projected camRight onto surface: ${projRight.toArray().map(v=>v.toFixed(3))} len=${projRight.length().toFixed(4)}`);

    // Run 30 frames with moveFromInput and track
    let totalDisp = 0;
    for (let i = 0; i < 30; i++) {
      const prev = walker.position.clone();
      const curFrame = walker.getTangentFrame();

      // Using upHint
      walker.moveFromInput(1, 0, camera, dt, curFrame.bitangent);

      // Update camera
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      camera.up.copy(curFrame.bitangent);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      const disp = walker.position.clone().sub(prev);
      totalDisp += disp.length();

      if (i < 5 || i % 10 === 0) {
        console.log(`  Frame ${i}: disp=${disp.length().toFixed(4)}, pos=${walker.position.toArray().map(v=>v.toFixed(2))}, normal=${walker.normal.toArray().map(v=>v.toFixed(2))}`);
      }
    }

    console.log(`Torus moveFromInput lateral: total=${totalDisp.toFixed(3)}`);
    expect(totalDisp).toBeGreaterThan(1.0);
  });

  it('should move laterally WITHOUT upHint', () => {
    const { walker } = createTorusWalker();
    const dt = 1/60;

    const camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 100);
    const frame = walker.getTangentFrame();
    camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
    camera.up.copy(frame.bitangent);
    camera.lookAt(walker.position);
    camera.updateMatrixWorld(true);

    let totalDisp = 0;
    for (let i = 0; i < 30; i++) {
      const prev = walker.position.clone();
      const curFrame = walker.getTangentFrame();

      // WITHOUT upHint
      walker.moveFromInput(1, 0, camera, dt);

      // Update camera
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      camera.up.copy(curFrame.bitangent);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      totalDisp += walker.position.distanceTo(prev);
    }

    console.log(`Torus moveFromInput lateral (no upHint): total=${totalDisp.toFixed(3)}`);
    expect(totalDisp).toBeGreaterThan(1.0);
  });
});
