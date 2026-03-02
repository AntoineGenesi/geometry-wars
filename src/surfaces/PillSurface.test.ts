/**
 * Tests for PillSurface movement via MeshWalker.moveFromInput().
 * Regression test for s44f-09: movement completely broken on pill map.
 *
 * Bug: "can only go right+up or down+left" — other directions don't work.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfaceFactory } from './SurfaceFactory';
import { MeshSurface } from './MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';

describe('PillSurface - moveFromInput all 8 directions (s44f-09 regression)', () => {
  function createPillWalker() {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);
    // Start on the body (equator)
    const startPos = surface.getPoint(0.5, 0.5).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);
    return { surface, meshSurface, walker };
  }

  function simulateInput(
    walker: MeshWalker,
    inputX: number,
    inputY: number,
    frames: number,
  ): { totalDist: number; stuckFrames: number; displacements: THREE.Vector3[] } {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    let targetUp = walker.getTangentFrame().bitangent.clone();
    const displacements: THREE.Vector3[] = [];
    let stuckFrames = 0;

    for (let i = 0; i < frames; i++) {
      const frame = walker.getTangentFrame();
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      const newCamUp = frame.bitangent.clone();
      if (targetUp.dot(newCamUp) < 0) newCamUp.negate();
      targetUp.copy(newCamUp).normalize();
      camera.up.copy(targetUp);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      const prevPos = walker.position.clone();
      walker.moveFromInput(inputX, inputY, camera, 1 / 60, targetUp.clone());
      const disp = walker.position.clone().sub(prevPos);
      displacements.push(disp);
      if (disp.length() < 0.001) stuckFrames++;
    }

    const totalDist = displacements.reduce((sum, d) => sum + d.length(), 0);
    return { totalDist, stuckFrames, displacements };
  }

  // 8-direction test: each direction should produce meaningful movement
  const directions = [
    { name: 'up (W)', x: 0, y: -1 },
    { name: 'down (S)', x: 0, y: 1 },
    { name: 'left (A)', x: -1, y: 0 },
    { name: 'right (D)', x: 1, y: 0 },
    { name: 'up-left (W+A)', x: -1, y: -1 },
    { name: 'up-right (W+D)', x: 1, y: -1 },
    { name: 'down-left (S+A)', x: -1, y: 1 },
    { name: 'down-right (S+D)', x: 1, y: 1 },
  ];

  for (const { name, x, y } of directions) {
    it(`should move in direction: ${name}`, () => {
      const { walker } = createPillWalker();
      const result = simulateInput(walker, x, y, 60);

      // Expect movement each frame (speed=3, dt=1/60, so ~0.05 per frame)
      const expectedPerFrame = 3 / 60; // 0.05
      const expectedTotal = expectedPerFrame * 60; // ~3.0

      console.log(`${name}: total=${result.totalDist.toFixed(3)}, stuck=${result.stuckFrames}/60`);

      // Must move at least 50% of expected distance
      expect(result.totalDist).toBeGreaterThan(expectedTotal * 0.5);
      // Must not be stuck for more than 10% of frames
      expect(result.stuckFrames).toBeLessThan(6);
    });
  }

  it('pill HalfEdgeMesh should have minimal boundary edges', () => {
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);
    const hem = meshSurface.geodesic.halfEdge;

    let boundaryCount = 0;
    const boundaryEdges: string[] = [];
    for (let i = 0; i < hem.halfEdges.length; i++) {
      const he = hem.halfEdges[i];
      if (he.twin < 0) {
        boundaryCount++;
        const f = hem.faces[he.faceIndex];
        const verts = [f.pA, f.pB, f.pC];
        const from = verts[he.edgeLocal];
        const to = verts[(he.edgeLocal + 1) % 3];
        boundaryEdges.push(`face ${he.faceIndex} edge ${he.edgeLocal}: (${from.toArray().map(n => n.toFixed(3))}) -> (${to.toArray().map(n => n.toFixed(3))})`);
      }
    }

    console.log(`Pill: ${hem.faceCount} faces, ${hem.halfEdges.length} half-edges, ${boundaryCount} boundary edges`);
    boundaryEdges.forEach(e => console.log(`  BOUNDARY: ${e}`));

    // 2 boundary edges at poles is acceptable — they're at degenerate triangles
    // where all vertices converge to a single pole point
    expect(boundaryCount).toBeLessThanOrEqual(2);
  });

  it('tangent frame should not degenerate over 300 frames of movement', () => {
    // Test that the tangent/bitangent frame stays orthogonal and non-degenerate
    // during extended movement on the pill surface body.
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);
    const startPos = surface.getPoint(0.5, 0.5).position;
    const walker = new MeshWalker(meshSurface, startPos, 3);

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    let targetUp = walker.getTangentFrame().bitangent.clone();

    let degenerateFrames = 0;
    let parallelFrames = 0;

    for (let i = 0; i < 300; i++) {
      const frame = walker.getTangentFrame();
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      const newCamUp = frame.bitangent.clone();
      if (targetUp.dot(newCamUp) < 0) newCamUp.negate();
      targetUp.copy(newCamUp).normalize();
      camera.up.copy(targetUp);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      // Move forward+right (diagonal)
      walker.moveFromInput(0.5, -0.5, camera, 1 / 60, targetUp.clone());

      // Check tangent frame health
      const tangentLen = frame.tangent.length();
      const bitangentLen = frame.bitangent.length();
      const dot = frame.tangent.dot(frame.bitangent);

      if (tangentLen < 0.5 || bitangentLen < 0.5) degenerateFrames++;
      if (Math.abs(dot) > 0.5) parallelFrames++;
    }

    console.log(`Degenerate frames: ${degenerateFrames}/300, Parallel frames: ${parallelFrames}/300`);
    expect(degenerateFrames).toBe(0);
    expect(parallelFrames).toBe(0);
  });

  it('should move in all directions with NO upHint (matches actual GameLoop)', () => {
    // GameLoop calls moveFromInput WITHOUT upHint, using camera.getWorldQuaternion() instead.
    // This test reproduces the EXACT calling convention of the real game:
    // - Camera starts at DEFAULT position (0,0,0) with up (0,1,0) — NOT pre-positioned
    // - Camera lerps toward correct position/up over many frames
    // - Sign-flip protection uses targetUp (previous frame) vs new bitangent
    const surface = SurfaceFactory.create('pill', {});
    surface.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surface.mesh);
    const startPos = surface.getPoint(0.5, 0.5).position;

    console.log('\n=== EXACT GameLoop reproduction (camera starts at default) ===');
    console.log(`Spawn pos: ${startPos.toArray().map(n => n.toFixed(3))}`);

    const results: Record<string, number> = {};
    for (const { name, x, y } of directions) {
      // Fresh walker for each direction
      const w = new MeshWalker(meshSurface, startPos.clone(), 3);
      const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      // Camera starts at THREE.js default: position (0,0,0), up (0,1,0)
      // This matches real game — camera is created once and lerps to position.

      // targetUp tracks CameraController.targetUp (starts at (0,1,0))
      const targetUp = new THREE.Vector3(0, 1, 0);

      let totalDist = 0;
      let stuckFrames = 0;
      for (let i = 0; i < 120; i++) {
        const prevPos = w.position.clone();

        // === GameLoop.onFixedUpdate: moveFromInput FIRST (no upHint) ===
        w.moveFromInput(x, y, cam, 1 / 60);

        // === CameraController.update() ===
        const frame = w.getTangentFrame();
        const camOffset = w.normal.clone().multiplyScalar(15);
        const targetCamPos = w.position.clone().add(camOffset);
        const posLerp = 0.12; // dt=1/60, factor=0.12, same as game
        cam.position.lerp(targetCamPos, posLerp);

        // Camera up = bitangent, with sign-flip protection
        const newCamUp = frame.bitangent.clone().normalize();
        if (targetUp.dot(newCamUp) < 0) {
          newCamUp.negate();
        }
        targetUp.copy(newCamUp);

        // lookAt FIRST, then lerp up (exact CameraController order)
        (cam as THREE.PerspectiveCamera).lookAt(w.position);
        (cam as THREE.PerspectiveCamera).up.lerp(newCamUp, posLerp).normalize();
        cam.updateMatrixWorld(true);

        const dist = w.position.distanceTo(prevPos);
        totalDist += dist;
        if (dist < 0.001) stuckFrames++;
      }
      results[name] = totalDist;
      console.log(`  ${name}: total=${totalDist.toFixed(3)}, stuck=${stuckFrames}/120`);
    }

    // ALL directions should work — even with camera starting from default position
    for (const [name, dist] of Object.entries(results)) {
      expect(dist, `Direction "${name}" should produce movement`).toBeGreaterThan(1.5);
    }
  });
});

describe('PillSurface - getPoint tangentV consistency (s44h-02 regression)', () => {
  it('bottom cap tangentV should point in increasing-v direction (toward equator)', () => {
    // REGRESSION: Bottom cap tangentV was inverted (missing chain-rule sign),
    // which caused MP bullets to have wrong direction and entities to be mis-oriented
    // on the bottom hemisphere of the pill surface.
    const surface = SurfaceFactory.create('pill', {});
    const cf = (surface as any).capFraction as number;

    // Sample several points on the bottom cap
    const uValues = [0, 0.25, 0.5, 0.75];
    const vValues = [0.01, cf * 0.25, cf * 0.5, cf * 0.75]; // bottom cap: v in [0, cf]

    for (const u of uValues) {
      for (const v of vValues) {
        const sp = surface.getPoint(u, v);
        // tangentV should point in the direction of increasing v.
        // A small step in +v should move the position in roughly the tangentV direction.
        const epsilon = 0.001;
        const spNext = surface.getPoint(u, v + epsilon);
        const delta = spNext.position.clone().sub(sp.position);

        // The dot product of tangentV with the position delta should be positive
        // (tangentV points in the increasing-v direction)
        const dot = sp.tangentV.dot(delta);
        expect(dot, `tangentV at u=${u}, v=${v} should point in +v direction`).toBeGreaterThan(0);
      }
    }
  });

  it('tangentV direction should be continuous across bottom-cap/body boundary', () => {
    // The tangentV at the body/bottom-cap boundary should be consistent from both sides.
    const surface = SurfaceFactory.create('pill', {});
    const cf = (surface as any).capFraction as number;

    const u = 0.3;
    const epsilon = 0.0001;
    const capSide = surface.getPoint(u, cf - epsilon);  // just inside bottom cap
    const bodySide = surface.getPoint(u, cf + epsilon);  // just inside body

    // tangentV from both sides should roughly agree
    const dot = capSide.tangentV.dot(bodySide.tangentV);
    expect(dot, 'tangentV should be continuous at cap/body boundary').toBeGreaterThan(0.9);
  });

  it('tangentV direction should be continuous across body/top-cap boundary', () => {
    const surface = SurfaceFactory.create('pill', {});
    const cf = (surface as any).capFraction as number;

    const u = 0.3;
    const epsilon = 0.0001;
    const bodySide = surface.getPoint(u, 1 - cf - epsilon);  // just inside body
    const capSide = surface.getPoint(u, 1 - cf + epsilon);   // just inside top cap

    const dot = bodySide.tangentV.dot(capSide.tangentV);
    expect(dot, 'tangentV should be continuous at body/top-cap boundary').toBeGreaterThan(0.9);
  });

  it('tangentU x tangentV should agree with normal direction consistently', () => {
    // tangentU cross tangentV should have consistent handedness across all regions
    const surface = SurfaceFactory.create('pill', {});
    const cf = (surface as any).capFraction as number;

    const testPoints = [
      { u: 0.25, v: cf * 0.5, label: 'bottom cap' },
      { u: 0.25, v: 0.5, label: 'body center' },
      { u: 0.25, v: 1 - cf * 0.5, label: 'top cap' },
    ];

    const signs: number[] = [];
    for (const { u, v, label } of testPoints) {
      const sp = surface.getPoint(u, v);
      const cross = new THREE.Vector3().crossVectors(sp.tangentU, sp.tangentV);
      const dot = cross.dot(sp.normal);
      signs.push(Math.sign(dot));
    }

    // All regions should have the same handedness
    expect(signs[0], 'bottom cap handedness should match body').toBe(signs[1]);
    expect(signs[2], 'top cap handedness should match body').toBe(signs[1]);
  });
});
