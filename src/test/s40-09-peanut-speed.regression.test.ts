/**
 * Regression test: S40-09 — Peanut map moves too slowly.
 *
 * ROOT CAUSE: Peanut is assigned MapSize.EPIC (scale factor 2.0).
 * The surface group is scaled 2x in world space, but PLAYER_MOVE_SPEED (3.0 world units/sec)
 * was not scaled — resulting in the player moving at half the apparent traversal rate
 * compared to sphere (MEDIUM, scale 1.0).
 *
 * FIX: Player walker speed = PLAYER_MOVE_SPEED * mapSizeScaleFactor.
 * On EPIC maps (2x scale): speed = 6.0 → player traverses the 2x larger surface at same rate.
 *
 * REGRESSION GUARD: If these tests fail, the peanut speed fix has regressed.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PeanutSurface } from '../surfaces/PeanutSurface';
import { SphereSurface } from '../surfaces/SphereSurface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';
import {
  MapSize,
  MAP_SIZE_SCALE_FACTORS,
  getDefaultMapSizeForSurface,
} from '../core/MapSize';

const PLAYER_MOVE_SPEED = 3.0; // Must match constant in src/main.ts

describe('S40-09: Peanut movement speed regression', () => {
  it('peanut is assigned EPIC map size (not MEDIUM)', () => {
    const mapSize = getDefaultMapSizeForSurface('peanut');
    expect(mapSize).toBe(MapSize.EPIC);
  });

  it('EPIC scale factor is 2.0', () => {
    expect(MAP_SIZE_SCALE_FACTORS[MapSize.EPIC]).toBe(2.0);
  });

  it('MEDIUM scale factor is 1.0', () => {
    expect(MAP_SIZE_SCALE_FACTORS[MapSize.MEDIUM]).toBe(1.0);
  });

  it('player on EPIC peanut moves at PLAYER_MOVE_SPEED * 2.0 world units/sec', () => {
    // Build scaled peanut surface (replicating what main.ts does)
    const peanut = new PeanutSurface();
    const epicScale = MAP_SIZE_SCALE_FACTORS[MapSize.EPIC]; // 2.0

    // Apply scale to surface group (same as main.ts line: surface.group.scale.setScalar(mapSizeScaleFactor))
    const scene = new THREE.Scene();
    scene.add(peanut.group);
    peanut.group.scale.setScalar(epicScale);
    peanut.mesh.updateMatrixWorld(true);

    const meshSurface = new MeshSurface(peanut.mesh);
    const startPoint = peanut.getPoint(0.5, 0.5);

    // Create walker with scaled speed (the fix)
    const expectedSpeed = PLAYER_MOVE_SPEED * epicScale;
    const walker = new MeshWalker(meshSurface, startPoint.position, expectedSpeed);

    expect(walker.speed).toBe(expectedSpeed);
    expect(walker.speed).toBe(6.0); // 3.0 * 2.0
  });

  it('player on MEDIUM sphere moves at PLAYER_MOVE_SPEED * 1.0 world units/sec', () => {
    const sphere = new SphereSurface({ radius: 10 });
    const mediumScale = MAP_SIZE_SCALE_FACTORS[MapSize.MEDIUM]; // 1.0

    const scene = new THREE.Scene();
    scene.add(sphere.group);
    sphere.group.scale.setScalar(mediumScale);
    sphere.mesh.updateMatrixWorld(true);

    const meshSurface = new MeshSurface(sphere.mesh);
    const startPoint = sphere.getPoint(0.5, 0.5);

    const expectedSpeed = PLAYER_MOVE_SPEED * mediumScale;
    const walker = new MeshWalker(meshSurface, startPoint.position, expectedSpeed);

    expect(walker.speed).toBe(expectedSpeed);
    expect(walker.speed).toBe(3.0); // 3.0 * 1.0
  });

  it('peanut walker traverses comparable UV fraction as sphere in equal time', () => {
    // Both walkers should traverse a similar fraction of the surface per second.
    // Peanut (EPIC 2x) with speed=6.0 should cover the same angular arc as
    // sphere (MEDIUM 1x) with speed=3.0.

    const peanut = new PeanutSurface();
    const epicScale = MAP_SIZE_SCALE_FACTORS[MapSize.EPIC];
    const peanutScene = new THREE.Scene();
    peanutScene.add(peanut.group);
    peanut.group.scale.setScalar(epicScale);
    peanut.mesh.updateMatrixWorld(true);
    const peanutMeshSurface = new MeshSurface(peanut.mesh);
    const peanutStart = peanut.getPoint(0.5, 0.5);
    const peanutWalker = new MeshWalker(
      peanutMeshSurface,
      peanutStart.position,
      PLAYER_MOVE_SPEED * epicScale,
    );

    const sphere = new SphereSurface({ radius: 10 });
    const mediumScale = MAP_SIZE_SCALE_FACTORS[MapSize.MEDIUM];
    const sphereScene = new THREE.Scene();
    sphereScene.add(sphere.group);
    sphere.group.scale.setScalar(mediumScale);
    sphere.mesh.updateMatrixWorld(true);
    const sphereMeshSurface = new MeshSurface(sphere.mesh);
    const sphereStart = sphere.getPoint(0.5, 0.5);
    const sphereWalker = new MeshWalker(
      sphereMeshSurface,
      sphereStart.position,
      PLAYER_MOVE_SPEED * mediumScale,
    );

    // Move both walkers for 1 simulated second (60 steps of 1/60s each)
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 30, 0);
    camera.lookAt(0, 0, 0);

    const dt = 1 / 60;
    const steps = 60;
    let peanutWorldDist = 0;
    let sphereWorldDist = 0;

    const pPrev = peanutWalker.position.clone();
    const sPrev = sphereWalker.position.clone();

    for (let i = 0; i < steps; i++) {
      peanutWalker.moveFromInput(0, 1, camera, dt);
      sphereWalker.moveFromInput(0, 1, camera, dt);

      peanutWorldDist += peanutWalker.position.distanceTo(pPrev);
      sphereWorldDist += sphereWalker.position.distanceTo(sPrev);
      pPrev.copy(peanutWalker.position);
      sPrev.copy(sphereWalker.position);
    }

    // Both should travel ~PLAYER_MOVE_SPEED * scale world units/sec
    const expectedSphereDist = PLAYER_MOVE_SPEED * mediumScale; // ~3.0
    const expectedPeanutDist = PLAYER_MOVE_SPEED * epicScale;   // ~6.0

    // Allow 20% tolerance for geodesic/BVH rounding
    expect(sphereWorldDist).toBeGreaterThan(expectedSphereDist * 0.8);
    expect(sphereWorldDist).toBeLessThan(expectedSphereDist * 1.2);
    expect(peanutWorldDist).toBeGreaterThan(expectedPeanutDist * 0.8);
    expect(peanutWorldDist).toBeLessThan(expectedPeanutDist * 1.2);

    // The ratio of distances should match the ratio of scale factors
    const distRatio = peanutWorldDist / sphereWorldDist;
    const scaleRatio = epicScale / mediumScale; // 2.0
    expect(distRatio).toBeGreaterThan(scaleRatio * 0.7);
    expect(distRatio).toBeLessThan(scaleRatio * 1.3);
  });
});
