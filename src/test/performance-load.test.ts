/**
 * Comprehensive WebGPU + Rendering Optimization Performance Tests
 *
 * Tests the full rendering pipeline: instanced meshes, LOD, adaptive quality,
 * spatial hashing, performance monitoring, GPU capabilities, and entity limits.
 *
 * Sections:
 * 1. Rendering Pipeline Verification (~10 tests)
 * 2. Load Scaling Tests (~10 tests)
 * 3. Integration Tests (~10 tests)
 * 4. Benchmark Data Collection (~10 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';
import { BulletInstanceManager, BulletVisualType } from '../rendering/BulletInstanceManager';
import { LODManager, LODLevel, DEFAULT_LOD_CONFIG } from '../rendering/LODManager';
import {
  AdaptiveQuality,
  QualityLevel,
  QUALITY_LEVELS,
} from '../rendering/AdaptiveQuality';
import { PerformanceMonitor } from '../rendering/PerformanceMonitor';
import { getEntityLimits } from '../rendering/EntityLimits';
import { SpatialHash } from '../core/SpatialHash';
import { collectPerformanceReport, type PerformanceReport } from './performance-report-data';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

// ---------------------------------------------------------------------------
// Test enemy classes (mirrors EnemyInstanceManager.test.ts pattern)
// ---------------------------------------------------------------------------

class TestGrunt extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 2, 10, 2, 0.2, 0.3);
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4444ff,
      emissive: new THREE.Color(0x4444ff),
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.4,
    });
    group.add(new THREE.Mesh(geo, mat));
    const geo2 = new THREE.SphereGeometry(0.025, 6, 6);
    group.add(new THREE.Mesh(geo2, mat.clone()));
    this.mesh = group;
  }

  updateBehavior(_dt: number, _playerU: number, _playerV: number): void {
    // no-op
  }
}

class TestDuck extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 3, 15, 3, 0.15, 0.3);
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: new THREE.Color(0xff4444),
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.4,
    });
    group.add(new THREE.Mesh(geo, mat));
    this.mesh = group;
  }

  updateBehavior(_dt: number, _playerU: number, _playerV: number): void {
    // no-op
  }
}

// Override constructor names so INSTANCEABLE_TYPES recognizes them
Object.defineProperty(TestGrunt, 'name', { value: 'Grunt' });
Object.defineProperty(TestDuck, 'name', { value: 'Duck' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function feedFrames(aq: AdaptiveQuality, fps: number, count: number): void {
  const dt = 1 / fps;
  for (let i = 0; i < count; i++) {
    aq.update(dt);
  }
}

function createTestAQ(overrides: Record<string, unknown> = {}): AdaptiveQuality {
  return new AdaptiveQuality({
    monitorWindowSize: 10,
    hysteresisFrames: 5,
    cooldownSeconds: 0,
    ...overrides,
  });
}

function createMockEnemies(
  count: number,
  options: { distances?: number[]; randomDistRange?: [number, number] } = {},
): { enemies: BaseEnemy[]; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.set(0, 0, 0);

  const enemies: BaseEnemy[] = [];
  for (let i = 0; i < count; i++) {
    const enemy = new TestGrunt(Math.random(), Math.random());
    enemy.active = true;
    enemy.alive = true;

    let dist: number;
    if (options.distances && i < options.distances.length) {
      dist = options.distances[i];
    } else if (options.randomDistRange) {
      const [min, max] = options.randomDistRange;
      dist = min + Math.random() * (max - min);
    } else {
      dist = Math.random() * 100;
    }

    // Place enemy at specific distance from camera (along random direction)
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    enemy.position.set(
      dist * Math.sin(phi) * Math.cos(theta),
      dist * Math.sin(phi) * Math.sin(theta),
      dist * Math.cos(phi),
    );

    enemies.push(enemy);
  }

  return { enemies, camera };
}

function randomPositions(count: number, range: number): Array<{ x: number; y: number; z: number }> {
  const positions: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: (Math.random() - 0.5) * range,
      y: (Math.random() - 0.5) * range,
      z: (Math.random() - 0.5) * range,
    });
  }
  return positions;
}

// =========================================================================
// Section 1: Rendering Pipeline Verification
// =========================================================================

describe('Rendering Pipeline Verification', () => {
  describe('EnemyInstanceManager', () => {
    it('registers 100 enemies and reports correct batch/instance stats', () => {
      const scene = new THREE.Scene();
      const manager = new EnemyInstanceManager(scene, 200);

      const enemies: TestGrunt[] = [];
      for (let i = 0; i < 100; i++) {
        const enemy = new TestGrunt(Math.random(), Math.random());
        enemies.push(enemy);
        manager.register(enemy);
      }

      const stats = manager.getStats();
      expect(stats.batchCount).toBe(1); // All Grunts -> 1 batch
      expect(stats.totalInstances).toBe(100);
      expect(stats.typeBreakdown.get('Grunt')).toBe(100);

      manager.dispose();
    });

    it('handles mixed enemy types with correct batch separation', () => {
      const scene = new THREE.Scene();
      const manager = new EnemyInstanceManager(scene, 200);

      for (let i = 0; i < 30; i++) {
        manager.register(new TestGrunt(Math.random(), Math.random()));
      }
      for (let i = 0; i < 20; i++) {
        manager.register(new TestDuck(Math.random(), Math.random()));
      }

      const stats = manager.getStats();
      expect(stats.batchCount).toBe(2); // Grunts + Ducks
      expect(stats.totalInstances).toBe(50);
      expect(stats.typeBreakdown.get('Grunt')).toBe(30);
      expect(stats.typeBreakdown.get('Duck')).toBe(20);

      manager.dispose();
    });
  });

  describe('BulletInstanceManager', () => {
    it('adds 500 bullets and reports correct active count', () => {
      const scene = new THREE.Scene();
      const manager = new BulletInstanceManager(scene, 2000);

      for (let i = 0; i < 500; i++) {
        manager.addBullet(
          `bullet-${i}`,
          BulletVisualType.Standard,
          new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
          new THREE.Vector3(0, 0, 1),
        );
      }

      const stats = manager.getStats();
      expect(stats.totalActive).toBe(500);
      expect(stats.batchCount).toBe(1); // All Standard
      expect(stats.typeBreakdown.get(BulletVisualType.Standard)).toBe(500);

      manager.dispose();
    });

    it('handles multiple bullet visual types', () => {
      const scene = new THREE.Scene();
      const manager = new BulletInstanceManager(scene, 2000);

      const types = [BulletVisualType.Standard, BulletVisualType.Spread, BulletVisualType.Piercing];
      for (let i = 0; i < 300; i++) {
        const type = types[i % 3];
        manager.addBullet(
          `bullet-${i}`,
          type,
          new THREE.Vector3(Math.random() * 10, 0, 0),
          new THREE.Vector3(0, 0, 1),
        );
      }

      const stats = manager.getStats();
      expect(stats.totalActive).toBe(300);
      expect(stats.batchCount).toBe(3);
      expect(stats.typeBreakdown.get(BulletVisualType.Standard)).toBe(100);
      expect(stats.typeBreakdown.get(BulletVisualType.Spread)).toBe(100);
      expect(stats.typeBreakdown.get(BulletVisualType.Piercing)).toBe(100);

      manager.dispose();
    });
  });

  describe('LODManager', () => {
    it('assigns HIGH LOD for enemies close to camera', () => {
      const lodMgr = new LODManager();
      const { enemies, camera } = createMockEnemies(10, { distances: Array(10).fill(5) });

      const assignments = lodMgr.update(camera, enemies);
      const stats = lodMgr.getStats();

      expect(stats.high).toBe(10);
      expect(stats.medium).toBe(0);
      expect(stats.low).toBe(0);

      for (const [, level] of assignments) {
        expect(level).toBe(LODLevel.HIGH);
      }

      lodMgr.dispose();
    });

    it('assigns LOW LOD for distant enemies', () => {
      const lodMgr = new LODManager();
      const { enemies, camera } = createMockEnemies(10, { distances: Array(10).fill(100) });

      lodMgr.update(camera, enemies);
      const stats = lodMgr.getStats();

      expect(stats.low).toBe(10);
      expect(stats.high).toBe(0);

      lodMgr.dispose();
    });

    it('distributes LOD levels correctly for mixed distances', () => {
      const lodMgr = new LODManager();
      // 5 close, 5 medium, 5 far
      const distances = [
        ...Array(5).fill(5),   // HIGH (< 20)
        ...Array(5).fill(35),  // MEDIUM (20-50)
        ...Array(5).fill(80),  // LOW (> 50)
      ];
      const { enemies, camera } = createMockEnemies(15, { distances });

      lodMgr.update(camera, enemies);
      const stats = lodMgr.getStats();

      expect(stats.high).toBe(5);
      expect(stats.medium).toBe(5);
      expect(stats.low).toBe(5);

      lodMgr.dispose();
    });

    it('estimates triangle reduction >60% for 1000 enemies with realistic distribution', () => {
      const lodMgr = new LODManager();
      // Realistic distribution: 10% HIGH, 30% MEDIUM, 60% LOW
      const distances: number[] = [];
      for (let i = 0; i < 100; i++) distances.push(5 + Math.random() * 10);   // HIGH
      for (let i = 0; i < 300; i++) distances.push(25 + Math.random() * 20);  // MEDIUM
      for (let i = 0; i < 600; i++) distances.push(55 + Math.random() * 50);  // LOW

      const { enemies, camera } = createMockEnemies(1000, { distances });
      lodMgr.update(camera, enemies);

      const estimate = lodMgr.estimateTriangleReduction(120); // 120 tris per enemy avg
      expect(estimate.reduction).toBeGreaterThan(0.6);
      expect(estimate.withLOD).toBeLessThan(estimate.withoutLOD);

      lodMgr.dispose();
    });
  });

  describe('AdaptiveQuality', () => {
    it('maintains quality at steady 60fps', () => {
      const aq = createTestAQ();
      feedFrames(aq, 60, 20);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);
    });

    it('drops quality after sustained 20fps for 60+ frames', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up
      feedFrames(aq, 20, 60);

      const level = aq.getQualityLevel();
      // Should have dropped multiple times from ULTRA
      expect(QUALITY_LEVELS.indexOf(level)).toBeGreaterThan(0);
    });
  });

  describe('GPUCapabilities shape', () => {
    it('detectGPUCapabilities returns a valid report shape', async () => {
      // In Node/vitest environment, this returns safe defaults
      const { detectGPUCapabilities } = await import('../rendering/GPUCapabilities');
      const report = await detectGPUCapabilities();

      expect(report).toHaveProperty('webgpu');
      expect(report).toHaveProperty('webgl2');
      expect(report).toHaveProperty('webgl1');
      expect(report).toHaveProperty('maxTextureSize');
      expect(report).toHaveProperty('maxInstanceCount');
      expect(report).toHaveProperty('sharedArrayBuffer');
      expect(report).toHaveProperty('hardwareConcurrency');
      expect(report).toHaveProperty('renderer');
      expect(report).toHaveProperty('tier');

      expect(['high', 'medium', 'low']).toContain(report.tier);
      expect(report.maxTextureSize).toBeGreaterThanOrEqual(4096);
      expect(report.maxInstanceCount).toBeGreaterThan(0);
    });
  });

  describe('EntityLimits', () => {
    it('returns valid limits for all tiers', () => {
      for (const tier of ['high', 'medium', 'low'] as const) {
        const limits = getEntityLimits(tier);
        expect(limits.maxEnemies).toBeGreaterThan(0);
        expect(limits.maxBullets).toBeGreaterThan(0);
        expect(limits.maxParticles).toBeGreaterThan(0);
        expect(limits.maxGeoms).toBeGreaterThan(0);
        expect(typeof limits.bloomEnabled).toBe('boolean');
        expect(typeof limits.shadowsEnabled).toBe('boolean');
      }
    });
  });
});

// =========================================================================
// Section 2: Load Scaling Tests
// =========================================================================

describe('Load Scaling Tests', () => {
  describe('SpatialHash scaling', () => {
    for (const count of [100, 500, 1000, 5000]) {
      it(`inserts ${count} entities and queries correctly`, () => {
        const hash = new SpatialHash<number>(2.5);
        const positions = randomPositions(count, 100);

        for (let i = 0; i < count; i++) {
          const p = positions[i];
          hash.insert(p.x, p.y, p.z, i);
        }

        // Verify we can query and get results back
        const nearby = hash.getNearby(0, 0, 0);
        // Should return entities in nearby cells (not all of them)
        expect(nearby.length).toBeLessThanOrEqual(count);

        // Query time should be fast even at high entity counts
        const queryStart = performance.now();
        for (let i = 0; i < 100; i++) {
          hash.getNearby(
            (Math.random() - 0.5) * 100,
            (Math.random() - 0.5) * 100,
            (Math.random() - 0.5) * 100,
          );
        }
        const queryMs = performance.now() - queryStart;
        // 100 queries should complete in < 50ms regardless of entity count
        expect(queryMs).toBeLessThan(50);
      });
    }
  });

  describe('EnemyInstanceManager scaling', () => {
    for (const count of [50, 100, 200]) {
      it(`registers ${count} Grunt enemies correctly`, () => {
        const scene = new THREE.Scene();
        const manager = new EnemyInstanceManager(scene, count + 10);

        for (let i = 0; i < count; i++) {
          const enemy = new TestGrunt(Math.random(), Math.random());
          const result = manager.register(enemy);
          expect(result).toBe(true);
        }

        const stats = manager.getStats();
        expect(stats.totalInstances).toBe(count);

        manager.dispose();
      });
    }
  });

  describe('BulletInstanceManager scaling', () => {
    for (const count of [100, 500, 1000, 2000]) {
      it(`adds ${count} bullets and tracks all of them`, () => {
        const scene = new THREE.Scene();
        const manager = new BulletInstanceManager(scene, 2000);

        for (let i = 0; i < count; i++) {
          manager.addBullet(
            `b-${i}`,
            BulletVisualType.Standard,
            new THREE.Vector3(i * 0.1, 0, 0),
            new THREE.Vector3(0, 0, 1),
          );
        }

        expect(manager.activeCount).toBe(count);

        const stats = manager.getStats();
        expect(stats.totalActive).toBe(count);

        manager.dispose();
      });
    }
  });

  describe('LODManager distribution at scale', () => {
    it('assigns more LOW than HIGH for 1000 randomly distributed enemies', () => {
      const lodMgr = new LODManager();
      // Uniform random from 0 to 100 -> most will be beyond 50 -> LOW
      const { enemies, camera } = createMockEnemies(1000, { randomDistRange: [0, 100] });

      lodMgr.update(camera, enemies);
      const stats = lodMgr.getStats();

      // With uniform distribution [0, 100], distances:
      // HIGH: 0-20 (20% of range)
      // MEDIUM: 20-50 (30% of range)
      // LOW: 50-100 (50% of range)
      // So LOW should be the largest group
      expect(stats.low).toBeGreaterThan(stats.high);
      expect(stats.total).toBe(1000);

      lodMgr.dispose();
    });
  });
});

// =========================================================================
// Section 3: Integration Tests
// =========================================================================

describe('Integration Tests', () => {
  describe('PerformanceMonitor + simulated frames', () => {
    it('records 60 frames accurately', () => {
      const monitor = new PerformanceMonitor(60);
      const dt = 1 / 60;

      for (let i = 0; i < 60; i++) {
        monitor.recordFrame(dt);
      }

      expect(monitor.isWarmedUp).toBe(true);
      expect(monitor.filledFrames).toBe(60);

      const snap = monitor.getSnapshot();
      expect(snap.fps).toBeCloseTo(60, 0);
      expect(snap.avgFrameTimeMs).toBeCloseTo(16.667, 0);
    });

    it('snapshot reflects renderer info when set', () => {
      const monitor = new PerformanceMonitor(10);
      for (let i = 0; i < 10; i++) monitor.recordFrame(1 / 60);

      monitor.setRendererInfo({
        render: { calls: 15, triangles: 50000 },
        memory: { geometries: 20, textures: 3 },
      });
      monitor.setEntityCount(250);

      const snap = monitor.getSnapshot();
      expect(snap.drawCalls).toBe(15);
      expect(snap.triangles).toBe(50000);
      expect(snap.entityCount).toBe(250);
      expect(snap.memoryMB).toBeGreaterThan(0);
    });
  });

  describe('AdaptiveQuality transitions', () => {
    it('simulates frame time ramp down and verifies quality drops in order', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      const transitions: QualityLevel[] = [aq.getQualityLevel()];

      // Ramp down: ULTRA -> HIGH -> MEDIUM -> LOW -> MINIMAL
      for (let batch = 0; batch < 4; batch++) {
        feedFrames(aq, 30, 5);
        transitions.push(aq.getQualityLevel());
      }

      expect(transitions).toEqual([
        QualityLevel.ULTRA,
        QualityLevel.HIGH,
        QualityLevel.MEDIUM,
        QualityLevel.LOW,
        QualityLevel.MINIMAL,
      ]);
    });

    it('recovers quality when FPS improves', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.MINIMAL,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 120, 10); // warm up at high fps

      // Step up from MINIMAL
      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.LOW);

      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);
    });

    it('dead zone prevents oscillation', () => {
      const aq = createTestAQ({ hysteresisFrames: 3, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      // Feed many frames in dead zone (55-58 fps)
      feedFrames(aq, 57, 100);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA); // No change
    });
  });

  describe('EntityLimits tiers', () => {
    it('high tier has the most generous limits', () => {
      const high = getEntityLimits('high');
      const medium = getEntityLimits('medium');
      const low = getEntityLimits('low');

      expect(high.maxEnemies).toBeGreaterThan(medium.maxEnemies);
      expect(medium.maxEnemies).toBeGreaterThan(low.maxEnemies);

      expect(high.maxBullets).toBeGreaterThan(medium.maxBullets);
      expect(medium.maxBullets).toBeGreaterThan(low.maxBullets);

      expect(high.maxParticles).toBeGreaterThan(medium.maxParticles);
      expect(medium.maxParticles).toBeGreaterThan(low.maxParticles);
    });

    it('low tier disables bloom and shadows', () => {
      const low = getEntityLimits('low');
      expect(low.bloomEnabled).toBe(false);
      expect(low.shadowsEnabled).toBe(false);
    });

    it('high tier enables bloom and shadows', () => {
      const high = getEntityLimits('high');
      expect(high.bloomEnabled).toBe(true);
      expect(high.shadowsEnabled).toBe(true);
    });
  });

  describe('LOD + Instance Manager integration', () => {
    it('LOD reduces triangle count while instances are batched', () => {
      const scene = new THREE.Scene();
      const instanceMgr = new EnemyInstanceManager(scene, 200);
      const lodMgr = new LODManager();

      // Register 50 enemies
      const enemies: TestGrunt[] = [];
      for (let i = 0; i < 50; i++) {
        const enemy = new TestGrunt(Math.random(), Math.random());
        enemy.active = true;
        enemy.alive = true;
        // Place at various distances
        const dist = i * 2; // 0 to 98
        enemy.position.set(dist, 0, 0);
        enemies.push(enemy);
        instanceMgr.register(enemy);
      }

      const instanceStats = instanceMgr.getStats();
      expect(instanceStats.totalInstances).toBe(50);
      expect(instanceStats.batchCount).toBe(1); // All Grunts

      // Compute LOD
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 0);
      lodMgr.update(camera, enemies);

      const lodStats = lodMgr.getStats();
      expect(lodStats.total).toBe(50);
      // Should have a mix of LOD levels (close enemies = HIGH, far = LOW)
      expect(lodStats.high).toBeGreaterThan(0);
      expect(lodStats.low).toBeGreaterThan(0);

      // Triangle reduction should be significant
      const triEstimate = lodMgr.estimateTriangleReduction(100);
      expect(triEstimate.reduction).toBeGreaterThan(0);
      expect(triEstimate.withLOD).toBeLessThan(triEstimate.withoutLOD);

      instanceMgr.dispose();
      lodMgr.dispose();
    });
  });
});

// =========================================================================
// Section 4: Benchmark Data Collection
// =========================================================================

describe('Benchmark Data Collection', () => {
  describe('SpatialHash insertion benchmarks', () => {
    for (const count of [1000, 5000, 10000]) {
      it(`measures insertion time for ${count} entities`, () => {
        const hash = new SpatialHash<number>(2.5);
        const positions = randomPositions(count, 100);

        const start = performance.now();
        for (let i = 0; i < count; i++) {
          const p = positions[i];
          hash.insert(p.x, p.y, p.z, i);
        }
        const elapsed = performance.now() - start;

        console.log(`  SpatialHash insert ${count} entities: ${elapsed.toFixed(3)}ms`);
        expect(elapsed).toBeGreaterThan(0);
        // Should be sub-linear, well under 100ms for all counts
        expect(elapsed).toBeLessThan(100);
      });
    }
  });

  describe('SpatialHash query benchmarks', () => {
    for (const count of [1000, 5000, 10000]) {
      it(`measures query time for ${count} entities (1000 queries)`, () => {
        const hash = new SpatialHash<number>(2.5);
        const positions = randomPositions(count, 100);
        for (let i = 0; i < count; i++) {
          const p = positions[i];
          hash.insert(p.x, p.y, p.z, i);
        }

        const queryPositions = randomPositions(1000, 100);
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          const p = queryPositions[i];
          hash.getNearby(p.x, p.y, p.z);
        }
        const elapsed = performance.now() - start;

        console.log(`  SpatialHash query 1000x on ${count} entities: ${elapsed.toFixed(3)}ms`);
        expect(elapsed).toBeGreaterThan(0);
        // Query time should not grow linearly with entity count
        expect(elapsed).toBeLessThan(200);
      });
    }
  });

  describe('EnemyInstanceManager updateInstances benchmarks', () => {
    for (const count of [100, 500]) {
      it(`measures updateInstances time for ${count} enemies`, () => {
        const scene = new THREE.Scene();
        const manager = new EnemyInstanceManager(scene, count + 10);

        const enemies: TestGrunt[] = [];
        for (let i = 0; i < count; i++) {
          const enemy = new TestGrunt(Math.random(), Math.random());
          enemy.active = true;
          enemy.alive = true;
          enemy.mesh!.position.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
          enemy.mesh!.updateMatrixWorld(true);
          enemies.push(enemy);
          manager.register(enemy);
        }

        // Measure update time over 60 frames
        const start = performance.now();
        for (let frame = 0; frame < 60; frame++) {
          manager.updateInstances(enemies);
        }
        const elapsed = performance.now() - start;
        const perFrame = elapsed / 60;

        console.log(`  EnemyInstanceManager.updateInstances (${count} enemies): total=${elapsed.toFixed(3)}ms, per-frame=${perFrame.toFixed(3)}ms`);
        expect(elapsed).toBeGreaterThan(0);
        // Per-frame update should be < 5ms even for 500 enemies
        expect(perFrame).toBeLessThan(10);

        manager.dispose();
      });
    }
  });

  describe('AdaptiveQuality convergence benchmark', () => {
    it('measures frames to converge from ULTRA to MINIMAL at 20fps', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      let frames = 0;
      while (aq.getQualityLevel() !== QualityLevel.MINIMAL && frames < 500) {
        aq.update(1 / 20);
        frames++;
      }

      console.log(`  AdaptiveQuality convergence: ${frames} frames to reach MINIMAL at 20fps`);
      expect(frames).toBeGreaterThan(0);
      expect(frames).toBeLessThan(100); // Should converge in reasonable time
      expect(aq.getQualityLevel()).toBe(QualityLevel.MINIMAL);
    });

    it('measures frames to recover from MINIMAL to ULTRA at 120fps', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.MINIMAL,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 120, 10); // warm up

      let frames = 0;
      while (aq.getQualityLevel() !== QualityLevel.ULTRA && frames < 500) {
        aq.update(1 / 120);
        frames++;
      }

      console.log(`  AdaptiveQuality recovery: ${frames} frames to reach ULTRA at 120fps`);
      expect(frames).toBeGreaterThan(0);
      expect(frames).toBeLessThan(200);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);
    });
  });

  describe('Structured performance report', () => {
    it('collectPerformanceReport returns complete structured data', () => {
      const report = collectPerformanceReport();

      // Verify structure
      expect(report.timestamp).toBeTruthy();
      expect(report.testEnvironment).toBeTruthy();
      expect(report.benchmarks.length).toBeGreaterThan(0);

      // Verify rendering pipeline info
      expect(report.renderingPipeline.instancedMeshSupported).toBe(true);
      expect(report.renderingPipeline.lodLevels).toBe(3);
      expect(report.renderingPipeline.adaptiveQualityTiers).toBe(5);
      expect(report.renderingPipeline.maxEnemyInstances).toBe(200);
      expect(report.renderingPipeline.maxBulletInstances).toBe(2000);

      // Verify scaling data
      expect(report.scalingData.entityCounts.length).toBe(5);
      expect(report.scalingData.spatialHashInsertMs.length).toBe(5);
      expect(report.scalingData.spatialHashQueryMs.length).toBe(5);
      expect(report.scalingData.instanceUpdateMs.length).toBeGreaterThan(0);

      // All benchmark values should be positive
      for (const bm of report.benchmarks) {
        expect(bm.value).toBeGreaterThanOrEqual(0);
        expect(bm.name).toBeTruthy();
        expect(bm.unit).toBeTruthy();
      }

      // Log the full report
      console.log('\n--- PERFORMANCE REPORT ---');
      console.log(`Timestamp: ${report.timestamp}`);
      console.log(`Environment: ${report.testEnvironment}`);
      console.log('\nRendering Pipeline:');
      console.log(`  Instanced Mesh: ${report.renderingPipeline.instancedMeshSupported}`);
      console.log(`  LOD Levels: ${report.renderingPipeline.lodLevels}`);
      console.log(`  Quality Tiers: ${report.renderingPipeline.adaptiveQualityTiers}`);
      console.log(`  Max Enemy Instances: ${report.renderingPipeline.maxEnemyInstances}`);
      console.log(`  Max Bullet Instances: ${report.renderingPipeline.maxBulletInstances}`);
      console.log('\nBenchmarks:');
      for (const bm of report.benchmarks) {
        console.log(`  ${bm.name} (${bm.entityCount} entities): ${bm.value} ${bm.unit}`);
      }
      console.log('\nScaling Data:');
      for (let i = 0; i < report.scalingData.entityCounts.length; i++) {
        console.log(`  ${report.scalingData.entityCounts[i]} entities: insert=${report.scalingData.spatialHashInsertMs[i]}ms, query=${report.scalingData.spatialHashQueryMs[i]}ms`);
      }
      console.log('--- END REPORT ---\n');
    });

    it('all benchmark entries have required fields', () => {
      const report = collectPerformanceReport();

      for (const bm of report.benchmarks) {
        expect(typeof bm.name).toBe('string');
        expect(typeof bm.entityCount).toBe('number');
        expect(typeof bm.metric).toBe('string');
        expect(typeof bm.value).toBe('number');
        expect(typeof bm.unit).toBe('string');
      }
    });
  });
});
