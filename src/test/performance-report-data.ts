/**
 * Structured performance report data collection.
 *
 * Provides types and a collection function that runs all key performance
 * measurements and returns structured data for analysis and reporting.
 */

import * as THREE from 'three';
import { SpatialHash } from '../core/SpatialHash';
import { PerformanceMonitor } from '../rendering/PerformanceMonitor';
import { AdaptiveQuality, QualityLevel, QUALITY_LEVELS } from '../rendering/AdaptiveQuality';
import { LODManager, LODLevel } from '../rendering/LODManager';
import { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';
import { BulletInstanceManager, BulletVisualType } from '../rendering/BulletInstanceManager';
import { getEntityLimits } from '../rendering/EntityLimits';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  name: string;
  entityCount: number;
  metric: string;
  value: number;
  unit: string;
}

export interface PerformanceReport {
  timestamp: string;
  testEnvironment: string;
  benchmarks: BenchmarkResult[];
  renderingPipeline: {
    instancedMeshSupported: boolean;
    lodLevels: number;
    adaptiveQualityTiers: number;
    maxEnemyInstances: number;
    maxBulletInstances: number;
  };
  scalingData: {
    entityCounts: number[];
    spatialHashInsertMs: number[];
    spatialHashQueryMs: number[];
    instanceUpdateMs: number[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create N random positions spread across 3D space. */
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

/** Measure time to insert N entities into a SpatialHash. */
function measureSpatialHashInsert(count: number, iterations: number = 5): number {
  let totalMs = 0;
  for (let iter = 0; iter < iterations; iter++) {
    const hash = new SpatialHash<number>(2.5);
    const positions = randomPositions(count, 100);
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      const p = positions[i];
      hash.insert(p.x, p.y, p.z, i);
    }
    totalMs += performance.now() - start;
  }
  return totalMs / iterations;
}

/** Measure time for N getNearby queries on a hash with entityCount entries. */
function measureSpatialHashQuery(entityCount: number, queryCount: number = 1000, iterations: number = 5): number {
  let totalMs = 0;
  for (let iter = 0; iter < iterations; iter++) {
    const hash = new SpatialHash<number>(2.5);
    const positions = randomPositions(entityCount, 100);
    for (let i = 0; i < entityCount; i++) {
      const p = positions[i];
      hash.insert(p.x, p.y, p.z, i);
    }
    const queryPositions = randomPositions(queryCount, 100);
    const start = performance.now();
    for (let i = 0; i < queryCount; i++) {
      const p = queryPositions[i];
      hash.getNearby(p.x, p.y, p.z);
    }
    totalMs += performance.now() - start;
  }
  return totalMs / iterations;
}

// ---------------------------------------------------------------------------
// Main collection function
// ---------------------------------------------------------------------------

/**
 * Run all performance measurements and return a structured report.
 *
 * This function exercises the key rendering and physics subsystems,
 * collecting timing data at various entity counts.
 */
export function collectPerformanceReport(): PerformanceReport {
  const benchmarks: BenchmarkResult[] = [];
  const entityCounts = [100, 500, 1000, 5000, 10000];

  // ---- SpatialHash benchmarks ----
  const insertMs: number[] = [];
  const queryMs: number[] = [];

  for (const count of entityCounts) {
    const insertTime = measureSpatialHashInsert(count);
    insertMs.push(insertTime);
    benchmarks.push({
      name: 'SpatialHash Insert',
      entityCount: count,
      metric: 'insertTime',
      value: parseFloat(insertTime.toFixed(3)),
      unit: 'ms',
    });

    const queryTime = measureSpatialHashQuery(count, 1000);
    queryMs.push(queryTime);
    benchmarks.push({
      name: 'SpatialHash Query (1000 queries)',
      entityCount: count,
      metric: 'queryTime',
      value: parseFloat(queryTime.toFixed(3)),
      unit: 'ms',
    });
  }

  // ---- PerformanceMonitor benchmark ----
  const monitor = new PerformanceMonitor(60);
  const monitorStart = performance.now();
  for (let i = 0; i < 600; i++) {
    monitor.recordFrame(1 / 60);
    monitor.getSnapshot();
  }
  const monitorElapsed = performance.now() - monitorStart;
  benchmarks.push({
    name: 'PerformanceMonitor',
    entityCount: 600,
    metric: 'recordAndSnapshot',
    value: parseFloat(monitorElapsed.toFixed(3)),
    unit: 'ms',
  });

  // ---- AdaptiveQuality convergence benchmark ----
  const aq = new AdaptiveQuality({
    monitorWindowSize: 10,
    hysteresisFrames: 5,
    cooldownSeconds: 0,
  });
  // Warm up
  for (let i = 0; i < 10; i++) aq.update(1 / 60);
  // Measure frames to converge from ULTRA to MINIMAL at 30fps
  let convergenceFrames = 0;
  while (aq.getQualityLevel() !== QualityLevel.MINIMAL && convergenceFrames < 500) {
    aq.update(1 / 30);
    convergenceFrames++;
  }
  benchmarks.push({
    name: 'AdaptiveQuality Convergence',
    entityCount: 0,
    metric: 'framesToMinimal',
    value: convergenceFrames,
    unit: 'frames',
  });

  // ---- LODManager distribution benchmark ----
  const lodMgr = new LODManager();
  // We cannot create real BaseEnemy instances easily here, so we report config
  benchmarks.push({
    name: 'LODManager',
    entityCount: 0,
    metric: 'lodLevels',
    value: 3,
    unit: 'levels',
  });

  // ---- Instance update times (simulated) ----
  const instanceUpdateMs: number[] = [];
  for (const count of [100, 500]) {
    // Measure raw loop overhead (simulates the per-instance matrix composition)
    const tempMatrix = new THREE.Matrix4();
    const tempPos = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const tempScale = new THREE.Vector3(1, 1, 1);

    const positions = randomPositions(count, 20);
    const start = performance.now();
    for (let frame = 0; frame < 60; frame++) {
      for (let i = 0; i < count; i++) {
        const p = positions[i];
        tempPos.set(p.x, p.y, p.z);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
      }
    }
    const elapsed = performance.now() - start;
    instanceUpdateMs.push(elapsed);
    benchmarks.push({
      name: 'Instance Matrix Update (60 frames)',
      entityCount: count,
      metric: 'matrixComposeTime',
      value: parseFloat(elapsed.toFixed(3)),
      unit: 'ms',
    });
  }

  // ---- EntityLimits benchmark ----
  for (const tier of ['high', 'medium', 'low'] as const) {
    const limits = getEntityLimits(tier);
    benchmarks.push({
      name: `EntityLimits (${tier})`,
      entityCount: 0,
      metric: 'maxEnemies',
      value: limits.maxEnemies,
      unit: 'count',
    });
  }

  return {
    timestamp: new Date().toISOString(),
    testEnvironment: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js/vitest',
    benchmarks,
    renderingPipeline: {
      instancedMeshSupported: true,
      lodLevels: 3,
      adaptiveQualityTiers: QUALITY_LEVELS.length,
      maxEnemyInstances: 200,
      maxBulletInstances: 2000,
    },
    scalingData: {
      entityCounts,
      spatialHashInsertMs: insertMs.map(v => parseFloat(v.toFixed(3))),
      spatialHashQueryMs: queryMs.map(v => parseFloat(v.toFixed(3))),
      instanceUpdateMs: instanceUpdateMs.map(v => parseFloat(v.toFixed(3))),
    },
  };
}
