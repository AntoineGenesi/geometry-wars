/**
 * Regression tests for UV movement correction on non-toroidal surfaces.
 *
 * Verifies that:
 * 1. Enemies get per-position UV correction via moveOnSurface()
 * 2. Separation forces use proper UV wrapping (not hard clamping)
 * 3. Enemy distribution remains even across surfaces with UV distortion
 * 4. Movement speed is consistent regardless of UV position
 * 5. wrapsU/wrapsV topology flags are correct for all surfaces
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { EnemySpawner } from '../entities/enemies/EnemySpawner';

// --- Test helpers ---

/** Create a simple test enemy that moves in a fixed direction. */
class TestEnemy extends BaseEnemy {
  dirU: number;
  dirV: number;

  constructor(u: number, v: number, dirU: number = 0, dirV: number = 0, speed: number = 0.05) {
    super(u, v, 10, 0, 0, speed, 0.3);
    this.dirU = dirU;
    this.dirV = dirV;
    // Create a minimal mesh so applySurfaceTransform doesn't crash
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial(),
    );
  }

  updateBehavior(dt: number, _playerU: number, _playerV: number): void {
    this.surfacePosition.u += this.dirU * this.speed * dt;
    this.surfacePosition.v += this.dirV * this.speed * dt;
  }
}

function createGetTransform(surface: Surface) {
  return (u: number, v: number) => {
    const pt = surface.getPoint(u, v);
    return {
      position: pt.position,
      normal: pt.normal,
      tangent: pt.tangentU,
      bitangent: pt.tangentV,
    };
  };
}

// --- Surface topology tests ---

describe('Surface UV Topology', () => {
  const ALL_SURFACES: SurfaceType[] = [
    'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut',
    'capsule', 'icosahedron', 'mobius', 'sphere-tunnel',
    'cube-ring', 'cube-tunnel', 'mobius-bevel',
  ];

  const WRAPS_V_SURFACES: SurfaceType[] = [
    'torus', 'pipe', 'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'mobius-bevel',
  ];

  const CLAMPS_V_SURFACES: SurfaceType[] = [
    'sphere', 'cube', 'pill', 'peanut', 'capsule', 'icosahedron', 'mobius',
  ];

  it('all surfaces have wrapsU = true (U always wraps)', () => {
    for (const type of ALL_SURFACES) {
      const surface = SurfaceFactory.create(type);
      expect(surface.wrapsU, `${type} should wrap U`).toBe(true);
      surface.dispose();
    }
  });

  it('toroidal surfaces have wrapsV = true', () => {
    for (const type of WRAPS_V_SURFACES) {
      const surface = SurfaceFactory.create(type);
      expect(surface.wrapsV, `${type} should wrap V`).toBe(true);
      surface.dispose();
    }
  });

  it('non-toroidal surfaces have wrapsV = false', () => {
    for (const type of CLAMPS_V_SURFACES) {
      const surface = SurfaceFactory.create(type);
      expect(surface.wrapsV, `${type} should NOT wrap V`).toBe(false);
      surface.dispose();
    }
  });

  it('wrapUV wraps U and clamps V on sphere', () => {
    const sphere = SurfaceFactory.create('sphere');
    const result = sphere.wrapUV(1.3, -0.1);
    expect(result.u).toBeCloseTo(0.3, 2);
    expect(result.v).toBeGreaterThanOrEqual(0);
    expect(result.v).toBeLessThanOrEqual(1);
    sphere.dispose();
  });

  it('wrapUV wraps both U and V on torus', () => {
    const torus = SurfaceFactory.create('torus');
    const result = torus.wrapUV(1.3, 1.7);
    expect(result.u).toBeCloseTo(0.3, 2);
    expect(result.v).toBeCloseTo(0.7, 2);
    torus.dispose();
  });
});

// --- getUVScaleAt tests ---

describe('Surface.getUVScaleAt', () => {
  it('sphere equator has larger U scale than near-pole', () => {
    const sphere = SurfaceFactory.create('sphere');

    const equator = sphere.getUVScaleAt(0.5, 0.5);
    const nearPole = sphere.getUVScaleAt(0.5, 0.05);

    // At equator, a du=1 covers the full circumference (2*PI*R = ~62.8 for R=10)
    // Near pole (v=0.05), the circumference is much smaller
    expect(equator.scaleU).toBeGreaterThan(nearPole.scaleU * 3);

    // V scale should be relatively constant (meridian has constant length)
    expect(Math.abs(equator.scaleV - nearPole.scaleV) / equator.scaleV).toBeLessThan(0.5);

    sphere.dispose();
  });

  it('torus has relatively uniform UV scale', () => {
    const torus = SurfaceFactory.create('torus');

    const p1 = torus.getUVScaleAt(0.0, 0.0);
    const p2 = torus.getUVScaleAt(0.5, 0.5);

    // Torus has some variation (inner vs outer) but less extreme than sphere poles
    expect(p1.scaleU).toBeGreaterThan(0);
    expect(p2.scaleU).toBeGreaterThan(0);
    expect(p1.scaleV).toBeGreaterThan(0);
    expect(p2.scaleV).toBeGreaterThan(0);

    torus.dispose();
  });

  it('cube flat face has uniform scale', () => {
    const cube = SurfaceFactory.create('cube');

    // Middle belt (side faces)
    const p1 = cube.getUVScaleAt(0.125, 0.5);
    const p2 = cube.getUVScaleAt(0.125, 0.45);

    // On a flat face, scale should be relatively consistent
    expect(p1.scaleU).toBeGreaterThan(0);
    expect(p1.scaleV).toBeGreaterThan(0);
    expect(Math.abs(p1.scaleV - p2.scaleV) / p1.scaleV).toBeLessThan(0.3);

    cube.dispose();
  });
});

// --- Enemy movement with surface correction ---

describe('Enemy UV Movement Correction', () => {
  it('enemy routes movement through moveOnSurface when surface is set', () => {
    const sphere = SurfaceFactory.create('sphere');

    const enemy = new TestEnemy(0.5, 0.5, 1.0, 0.0, 0.1);
    enemy.surfaceRef = sphere;

    const prevU = enemy.surfacePosition.u;
    enemy.update(1 / 60);

    // Should have moved
    expect(enemy.surfacePosition.u).not.toBe(prevU);

    // moveOnSurface on sphere wraps U to [0,1)
    expect(enemy.surfacePosition.u).toBeGreaterThanOrEqual(0);
    expect(enemy.surfacePosition.u).toBeLessThan(1);

    sphere.dispose();
  });

  it('sphere: enemy near pole gets corrected du (moves less in U)', () => {
    const sphere = SurfaceFactory.create('sphere');
    const dt = 1 / 60;

    // Enemy at equator (v=0.5)
    const equatorEnemy = new TestEnemy(0.5, 0.5, 1.0, 0.0, 0.1);
    equatorEnemy.surfaceRef = sphere;
    const equatorPrevU = equatorEnemy.surfacePosition.u;
    equatorEnemy.update(dt);
    const equatorDeltaU = Math.abs(equatorEnemy.surfacePosition.u - equatorPrevU);

    // Enemy near pole (v=0.1)
    const poleEnemy = new TestEnemy(0.5, 0.1, 1.0, 0.0, 0.1);
    poleEnemy.surfaceRef = sphere;
    const polePrevU = poleEnemy.surfacePosition.u;
    poleEnemy.update(dt);
    const poleDeltaU = Math.abs(poleEnemy.surfacePosition.u - polePrevU);

    // Near pole, moveOnSurface divides du by sin(phi) which is small,
    // so the enemy moves MORE in UV space to cover the same world distance.
    // The pole enemy should have a LARGER UV delta than equator enemy.
    expect(poleDeltaU).toBeGreaterThan(equatorDeltaU * 1.5);

    sphere.dispose();
  });

  it('enemy without surface ref uses legacy fallback', () => {
    const enemy = new TestEnemy(0.5, 0.5, 1.0, 0.0, 0.1);
    // No surfaceRef set

    const prevU = enemy.surfacePosition.u;
    enemy.update(1 / 60);

    // Should still move (fallback behavior)
    expect(enemy.surfacePosition.u).not.toBe(prevU);
  });

  it('surfaceSpeedScale still applies with surface correction', () => {
    const sphere = SurfaceFactory.create('sphere');
    const dt = 1 / 60;

    // Enemy with speed scale
    const scaledEnemy = new TestEnemy(0.5, 0.5, 1.0, 0.0, 0.1);
    scaledEnemy.surfaceRef = sphere;
    scaledEnemy.surfaceSpeedScale = 0.5;
    const scaledPrevU = scaledEnemy.surfacePosition.u;
    scaledEnemy.update(dt);
    const scaledDelta = Math.abs(scaledEnemy.surfacePosition.u - scaledPrevU);

    // Enemy without speed scale
    const normalEnemy = new TestEnemy(0.5, 0.5, 1.0, 0.0, 0.1);
    normalEnemy.surfaceRef = sphere;
    normalEnemy.surfaceSpeedScale = 1.0;
    const normalPrevU = normalEnemy.surfacePosition.u;
    normalEnemy.update(dt);
    const normalDelta = Math.abs(normalEnemy.surfacePosition.u - normalPrevU);

    // Scaled enemy should move about half as far
    expect(scaledDelta).toBeLessThan(normalDelta * 0.75);

    sphere.dispose();
  });
});

// --- Separation force tests ---

describe('Separation Force UV Awareness', () => {
  it('separation uses surface wrapUV instead of hard clamping', () => {
    const sphere = SurfaceFactory.create('sphere');
    const scene = new THREE.Scene();
    const getTransform = createGetTransform(sphere);

    const spawner = new EnemySpawner(scene, getTransform);
    spawner.setSurface(sphere);

    // Spawn two enemies very close together near v=0.01 (near pole boundary)
    const enemy1 = spawner.spawn('wanderer', 0.5, 0.02);
    const enemy2 = spawner.spawn('wanderer', 0.51, 0.02);

    // Run several update cycles to trigger separation
    for (let i = 0; i < 60; i++) {
      spawner.update(1 / 60, 0.5, 0.5);
    }

    // Enemies should not be clamped exactly at v=0 boundary
    // With the fix, they should be properly wrapped via wrapUV
    // which clamps to [epsilon, 1-epsilon] not [0, 1]
    for (const enemy of spawner.getEnemies()) {
      if (enemy.active) {
        expect(enemy.surfacePosition.v).toBeGreaterThan(0.001);
        expect(enemy.surfacePosition.v).toBeLessThan(0.999);
      }
    }

    spawner.clear();
    sphere.dispose();
  });

  it('separation works across U seam on sphere', () => {
    const sphere = SurfaceFactory.create('sphere');
    const scene = new THREE.Scene();
    const getTransform = createGetTransform(sphere);

    const spawner = new EnemySpawner(scene, getTransform);
    spawner.setSurface(sphere);

    // Spawn enemies near the U=0/1 seam
    const enemy1 = spawner.spawn('wanderer', 0.01, 0.5);
    const enemy2 = spawner.spawn('wanderer', 0.99, 0.5);

    // These are very close in UV space when wrapping is considered
    // (distance = 0.02 across the seam)
    // Update to trigger separation
    for (let i = 0; i < 30; i++) {
      spawner.update(1 / 60, 0.5, 0.5);
    }

    // Both enemies should still be alive and valid
    const activeEnemies = spawner.getEnemies().filter(e => e.active && !e.isMaterializing);
    for (const enemy of activeEnemies) {
      expect(enemy.surfacePosition.u).toBeGreaterThanOrEqual(0);
      expect(enemy.surfacePosition.u).toBeLessThan(1);
    }

    spawner.clear();
    sphere.dispose();
  });
});

// --- Enemy distribution tests ---

describe('Enemy Distribution Evenness', () => {
  it('enemies on sphere dont bunch at poles after many updates', () => {
    const sphere = SurfaceFactory.create('sphere');
    const scene = new THREE.Scene();
    const getTransform = createGetTransform(sphere);

    const spawner = new EnemySpawner(scene, getTransform);
    spawner.setSurface(sphere);
    spawner.setSurfaceSpeedScale(sphere.speedScale);

    // Spawn enemies distributed across the sphere
    for (let i = 0; i < 20; i++) {
      const u = Math.random();
      const v = 0.1 + Math.random() * 0.8; // avoid extreme poles
      spawner.spawn('wanderer', u, v);
    }

    // Simulate 5 seconds of gameplay
    for (let i = 0; i < 300; i++) {
      spawner.update(1 / 60, 0.5, 0.5);
    }

    // Count enemies in V regions
    let nearPoles = 0; // v < 0.1 or v > 0.9
    let nearEquator = 0; // 0.3 < v < 0.7

    for (const enemy of spawner.getEnemies()) {
      if (!enemy.active || enemy.isMaterializing) continue;
      const v = enemy.surfacePosition.v;
      if (v < 0.1 || v > 0.9) nearPoles++;
      if (v > 0.3 && v < 0.7) nearEquator++;
    }

    // BUG REGRESSION: Before the fix, enemies would pile up at V boundaries.
    // With the fix, enemies should still be distributed.
    // We don't expect PERFECT distribution (Wanderers are random), but
    // the majority should NOT be at the poles.
    const totalActive = spawner.getEnemies().filter(e => e.active && !e.isMaterializing).length;
    if (totalActive > 5) {
      // No more than 40% of enemies should be at the poles
      expect(nearPoles / totalActive).toBeLessThan(0.4);
    }

    spawner.clear();
    sphere.dispose();
  });

  it('EnemySpawner.setSurface passes surface to spawned enemies', () => {
    const torus = SurfaceFactory.create('torus');
    const scene = new THREE.Scene();
    const getTransform = createGetTransform(torus);

    const spawner = new EnemySpawner(scene, getTransform);
    spawner.setSurface(torus);

    const enemy = spawner.spawn('wanderer', 0.5, 0.5);
    expect(enemy.surfaceRef).toBe(torus);

    spawner.clear();
    torus.dispose();
  });
});

// --- Consistent world-space speed test ---

describe('World-Space Speed Consistency', () => {
  it('sphere: movement covers similar world distance at equator and mid-latitude', () => {
    const sphere = SurfaceFactory.create('sphere');
    const dt = 1 / 60;
    const numFrames = 60; // 1 second

    // Enemy moving in V direction at equator
    const equatorEnemy = new TestEnemy(0.5, 0.5, 0.0, 1.0, 0.05);
    equatorEnemy.surfaceRef = sphere;

    const equatorStart = sphere.getPoint(
      equatorEnemy.surfacePosition.u,
      equatorEnemy.surfacePosition.v
    ).position.clone();

    for (let i = 0; i < numFrames; i++) {
      equatorEnemy.update(dt);
    }

    // Save rotation, reset for measurement
    const savedRot = sphere.worldRotation.clone();
    sphere.worldRotation.identity();
    const equatorEnd = sphere.getPoint(
      equatorEnemy.surfacePosition.u,
      equatorEnemy.surfacePosition.v
    ).position.clone();
    sphere.worldRotation.copy(savedRot);

    const equatorWorldDist = equatorStart.distanceTo(equatorEnd);

    // Enemy moving in V direction near pole
    const poleEnemy = new TestEnemy(0.5, 0.2, 0.0, 1.0, 0.05);
    poleEnemy.surfaceRef = sphere;

    sphere.worldRotation.identity();
    const poleStart = sphere.getPoint(
      poleEnemy.surfacePosition.u,
      poleEnemy.surfacePosition.v
    ).position.clone();
    sphere.worldRotation.copy(savedRot);

    for (let i = 0; i < numFrames; i++) {
      poleEnemy.update(dt);
    }

    sphere.worldRotation.identity();
    const poleEnd = sphere.getPoint(
      poleEnemy.surfacePosition.u,
      poleEnemy.surfacePosition.v
    ).position.clone();
    sphere.worldRotation.copy(savedRot);

    const poleWorldDist = poleStart.distanceTo(poleEnd);

    // V-direction movement on a sphere is along meridians which have
    // constant world-space speed everywhere. So both should be similar.
    // Allow 30% tolerance for rounding.
    expect(Math.abs(equatorWorldDist - poleWorldDist) / equatorWorldDist).toBeLessThan(0.3);

    sphere.dispose();
  });
});
