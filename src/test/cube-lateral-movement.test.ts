/**
 * Regression test: Cube lateral movement should not oscillate.
 *
 * ROOT CAUSE (iteration 9): The beveled cube geometry has a seam at Z=0
 * on each face where two halves are independently triangulated. Vertices
 * along the seam are at NEARLY the same position (~0.017 world units apart)
 * but not exactly, so the standard vertex canonicalization (precision 1e-5)
 * couldn't match them. This created false boundary edges where the geodesic
 * walker would REFLECT instead of crossing, causing 188/299 displacement
 * reversals during lateral movement.
 *
 * FIX: HalfEdgeMesh._linkSeamEdges() — second-pass edge matching using
 * world-space proximity (tolerance 0.05) for unmatched boundary edges.
 *
 * This test verifies:
 * 1. The walker crosses the Z=0 seam smoothly (no reflection)
 * 2. Lateral movement over 300 frames has <5 reversals (at true edges only)
 * 3. No false boundary edges on the cube top face at Z=0
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

function createCubeWalker(): { walker: MeshWalker; meshSurface: MeshSurface } {
  const surf = SurfaceFactory.create('cube', {
    size: 10,
    gridColor: 0x2a2aaa,
    surfaceColor: 0x141440,
    surfaceOpacity: 0.35,
    gridOpacity: 0.4,
  } as any);
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  return { walker: null as any, meshSurface };
}

describe('Cube lateral movement regression', () => {
  it('should have no false boundary edges at Z=0 on cube top face', () => {
    const { meshSurface } = createCubeWalker();
    const he = meshSurface.geodesic.halfEdge;

    let zZeroBoundaries = 0;
    for (let fi = 0; fi < he.faceCount; fi++) {
      const f = he.faces[fi];
      const midY = (f.pA.y + f.pB.y + f.pC.y) / 3;
      if (midY > 4.9) {
        for (let ei = 0; ei < 3; ei++) {
          const heEdge = he.getHalfEdge(fi, ei);
          if (heEdge.twin < 0) {
            const [es, ee] = he.getEdgeVertices(fi, ei);
            if (Math.abs(es.z) < 0.01 && Math.abs(ee.z) < 0.01) {
              zZeroBoundaries++;
            }
          }
        }
      }
    }

    // Before the seam fix, there were 18 false boundary edges at Z=0
    expect(zZeroBoundaries).toBe(0);
  });

  it('should cross Z=0 seam without oscillation (MeshWalker.move)', () => {
    const { meshSurface } = createCubeWalker();
    // Start near Z=0 on the top face
    const startPos = new THREE.Vector3(3.39, 5.0, -0.07);
    const walker = new MeshWalker(meshSurface, startPos, 5);

    const dir = new THREE.Vector3(-0.01776, 0, 0.99984).normalize();
    let reversals = 0;
    let prevDisp = new THREE.Vector3();

    for (let i = 0; i < 20; i++) {
      const prevPos = walker.position.clone();
      walker.move(dir, 1 / 60);
      const disp = walker.position.clone().sub(prevPos);

      const isReversal = i > 0 &&
        prevDisp.lengthSq() > 1e-6 &&
        disp.lengthSq() > 1e-6 &&
        prevDisp.dot(disp) < 0;
      if (isReversal) reversals++;
      prevDisp.copy(disp);
    }

    // Before seam fix: 19/19 reversals. After: 0.
    expect(reversals).toBe(0);
  });

  it('should have <5 reversals in 300-frame lateral movement on cube', () => {
    const surf = SurfaceFactory.create('cube', {
      size: 10,
      gridColor: 0x2a2aaa,
      surfaceColor: 0x141440,
      surfaceOpacity: 0.35,
      gridOpacity: 0.4,
    } as any);
    surf.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surf.mesh);

    const startPos = surf.getPoint(0.5, 0.5).position;
    const walker = new MeshWalker(meshSurface, startPos, 5);

    // Set up camera looking at the walker from behind
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const frame = walker.getTangentFrame();
    camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
    camera.up.copy(frame.bitangent);
    camera.lookAt(walker.position);
    camera.updateMatrixWorld(true);

    let reversals = 0;
    let prevDisp = new THREE.Vector3();
    const dt = 1 / 60;

    for (let i = 0; i < 300; i++) {
      const prevPos = walker.position.clone();
      const curFrame = walker.getTangentFrame();
      walker.moveFromInput(1, 0, camera, dt, curFrame.bitangent);

      // Update camera
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      camera.up.copy(curFrame.bitangent);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      const disp = walker.position.clone().sub(prevPos);
      const isReversal = i > 0 &&
        prevDisp.lengthSq() > 1e-6 &&
        disp.lengthSq() > 1e-6 &&
        prevDisp.dot(disp) < 0;
      if (isReversal) reversals++;
      prevDisp.copy(disp);
    }

    // Before seam fix: 188/299 reversals. After: 2 (at true cube corner edges).
    expect(reversals).toBeLessThan(5);
  });
});
