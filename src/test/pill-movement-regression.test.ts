/**
 * Regression test for s22-pill-movement-broken-v3
 *
 * Root cause: FaceWalker atVertex detection epsilon was 0.05 (too large).
 * When a player exits a triangle at a position near (but not at) a vertex
 * (e.g., v≈0.004 < 0.05 triggers as "vertex"), the wrong adjacent edge was
 * chosen, causing a direction reversal every ~5 frames — visible as a saw-tooth
 * zigzag trail on the pill map.
 *
 * Fix: Tighten atVertex epsilon from 0.05 → 0.001 in FaceWalker.ts.
 *
 * This test FAILS with eps=0.05 and PASSES with eps=0.001.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';

describe('Pill movement regression (s22-pill-movement-broken-v3)', () => {
  /**
   * Reproduces the exact scenario that triggered the zigzag bug.
   * Player moves forward (W key) from the south-pole seam of the pill mesh.
   * With the old eps=0.05, reversals occurred every ~5 frames near face 934.
   * With the fixed eps=0.001, movement is monotonically forward with 0 reversals.
   */
  it('forward movement on pill south seam produces no direction reversals', () => {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);

    // Start at the exact position that triggers the bug (south seam, u=0.5)
    const startPos = surface.getPoint(0.5, 0.0).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    let targetUp = walker.getTangentFrame().bitangent.clone();

    const displacements: THREE.Vector3[] = [];

    // Simulate 60 frames of W-key (forward) input — the exact bug scenario
    for (let i = 0; i < 60; i++) {
      const frame = walker.getTangentFrame();
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);

      const newCamUp = frame.bitangent.clone();
      if (targetUp.dot(newCamUp) < 0) newCamUp.negate();
      targetUp.copy(newCamUp).normalize();
      camera.up.copy(targetUp);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      const prevPos = walker.position.clone();
      walker.moveFromInput(0, -1, camera, 1 / 60, targetUp.clone());

      const disp = walker.position.clone().sub(prevPos);
      if (disp.length() > 0.0001) {
        displacements.push(disp);
      }
    }

    // Count direction reversals (dot product < 0.5 between consecutive displacements)
    let reversals = 0;
    for (let i = 1; i < displacements.length; i++) {
      const prevDir = displacements[i - 1].clone().normalize();
      const curDir = displacements[i].clone().normalize();
      const dot = prevDir.dot(curDir);
      if (dot < 0.5) {
        reversals++;
      }
    }

    // The bug produced 2 reversals in 60 frames. The fix produces 0.
    expect(reversals).toBe(0);
    expect(displacements.length).toBeGreaterThan(50); // Should move every frame
  });

  /**
   * Verifies that the player actually moves forward (not stuck) across
   * the critical face 934 seam — the exact face where the wrong edge was selected.
   */
  it('player traverses pill south seam without getting stuck at face 934', () => {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);

    const startPos = surface.getPoint(0.5, 0.0).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    let targetUp = walker.getTangentFrame().bitangent.clone();

    const initialPos = walker.position.clone();

    for (let i = 0; i < 60; i++) {
      const frame = walker.getTangentFrame();
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      const newCamUp = frame.bitangent.clone();
      if (targetUp.dot(newCamUp) < 0) newCamUp.negate();
      targetUp.copy(newCamUp).normalize();
      camera.up.copy(targetUp);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);
      walker.moveFromInput(0, -1, camera, 1 / 60, targetUp.clone());
    }

    // Player should have moved significantly from start position (~3 units/sec × 1 sec)
    const totalDistance = walker.position.distanceTo(initialPos);
    expect(totalDistance).toBeGreaterThan(1.5);

    // Position should not be NaN
    expect(isNaN(walker.position.x)).toBe(false);
    expect(isNaN(walker.position.y)).toBe(false);
    expect(isNaN(walker.position.z)).toBe(false);
  });
});
