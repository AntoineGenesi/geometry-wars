/**
 * Comprehensive Performance Stress Test
 *
 * Progressively scales entity counts to find the real performance limits
 * of the game's CPU-side systems: SpatialHash, collision detection,
 * entity updates, surface transforms, and WorkerBridge.
 *
 * Entity levels: 100, 500, 1K, 2K, 5K, 10K, 20K, 50K
 * At each level, runs 100 simulated frames and measures:
 * - Average frame time (ms)
 * - Min/max frame time
 * - Breakdown: spatial hash insert, collision query, entity update, surface transform
 * - Memory estimate
 *
 * Results are written to src/test/stress-test-results.json for the slide deck.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpatialHash } from '../core/SpatialHash';
import { WorkerBridge } from '../workers/WorkerBridge';
import {
  runCollisionDetection,
  type CollisionInput,
  type CollisionOutput,
} from '../workers/collision.worker';
import {
  createEntityBuffer,
  createCollisionResultBuffer,
  getEntityViews,
  getCollisionResultViews,
  writeEntityData,
  MAX_COLLISION_PAIRS,
  type EntityData,
} from '../workers/shared-buffers';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create N random positions on a sphere of given radius */
function randomSpherePositions(count: number, radius: number): THREE.Vector3[] {
  const positions: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.push(new THREE.Vector3(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
    ));
  }
  return positions;
}

/** Simulate one frame of entity update (surface transform per entity) */
function simulateEntityUpdate(positions: THREE.Vector3[], count: number): number {
  const _tempMatrix = new THREE.Matrix4();
  const _tempEuler = new THREE.Euler();
  const _tempOffset = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3(1, 0, 0);
  const bitangent = new THREE.Vector3(0, 0, 1);

  const start = performance.now();
  for (let i = 0; i < count; i++) {
    // Simulate surface transform
    _tempOffset.copy(positions[i]);
    _tempOffset.addScaledVector(normal, 0.3);
    _tempMatrix.makeBasis(bitangent, normal, tangent);
    _tempEuler.setFromRotationMatrix(_tempMatrix);

    // Simulate velocity integration
    positions[i].addScaledVector(tangent, 0.016 * 2.0);
  }
  return performance.now() - start;
}

/** Simulate spatial hash insert + collision query for bullets vs enemies */
function simulateCollisionDetection(
  enemyPositions: THREE.Vector3[],
  bulletCount: number,
  bulletPositions: THREE.Vector3[],
): { insertMs: number; queryMs: number; hits: number } {
  const hash = new SpatialHash<number>(2.5);
  const hitRadiusSq = (0.3 + 0.15) ** 2;

  // Insert enemies
  const insertStart = performance.now();
  for (let i = 0; i < enemyPositions.length; i++) {
    const p = enemyPositions[i];
    hash.insert(p.x, p.y, p.z, i);
  }
  const insertMs = performance.now() - insertStart;

  // Query for each bullet
  let hits = 0;
  const queryStart = performance.now();
  for (let b = 0; b < bulletCount; b++) {
    const bp = bulletPositions[b];
    const nearby = hash.getNearby(bp.x, bp.y, bp.z);
    for (let n = 0; n < nearby.length; n++) {
      const ei = nearby[n];
      const ep = enemyPositions[ei];
      const dx = bp.x - ep.x;
      const dy = bp.y - ep.y;
      const dz = bp.z - ep.z;
      if (dx * dx + dy * dy + dz * dz < hitRadiusSq) {
        hits++;
      }
    }
  }
  const queryMs = performance.now() - queryStart;

  return { insertMs, queryMs, hits };
}

/** Simulate the WorkerBridge collision path (SharedArrayBuffer) */
function simulateWorkerCollision(
  entityCount: number,
  positions: THREE.Vector3[],
): { packMs: number; computeMs: number; pairCount: number } {
  const entityBuffer = createEntityBuffer(entityCount);
  const views = getEntityViews(entityBuffer);
  const collisionResult = createCollisionResultBuffer(Math.min(MAX_COLLISION_PAIRS, entityCount * 10));
  const collisionViews = getCollisionResultViews(collisionResult);

  // Pack data
  const packStart = performance.now();
  const entityData: EntityData[] = [];
  for (let i = 0; i < entityCount; i++) {
    entityData.push({
      x: positions[i].x,
      y: positions[i].y,
      z: positions[i].z,
      vx: 0, vy: 0, vz: 0,
      radius: 0.3,
      type: 0,
      surfaceU: 0,
      surfaceV: 0,
      speed: 2.0,
    });
  }
  writeEntityData(entityBuffer, views, entityData);
  const packMs = performance.now() - packStart;

  // Run collision detection
  const input: CollisionInput = {
    positions: views.positions,
    radii: views.radii,
    count: entityCount,
  };
  const output: CollisionOutput = {
    pairs: collisionViews.pairs,
    pairCount: collisionViews.count,
    maxPairs: collisionResult.maxPairs,
  };

  const computeStart = performance.now();
  const pairCount = runCollisionDetection(input, output);
  const computeMs = performance.now() - computeStart;

  return { packMs, computeMs, pairCount };
}

/** Simulate enemy-enemy separation (O(n^2) with spatial hash) */
function simulateEnemySeparation(
  positions: THREE.Vector3[],
  count: number,
): number {
  const hash = new SpatialHash<number>(2.5);
  const separationRadius = 1.5;
  const separationRadiusSq = separationRadius * separationRadius;

  // Insert all
  for (let i = 0; i < count; i++) {
    hash.insert(positions[i].x, positions[i].y, positions[i].z, i);
  }

  const _tempForce = new THREE.Vector3();
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const p = positions[i];
    const nearby = hash.getNearby(p.x, p.y, p.z);
    _tempForce.set(0, 0, 0);
    for (let n = 0; n < nearby.length; n++) {
      const j = nearby[n];
      if (j === i) continue;
      const other = positions[j];
      const dx = p.x - other.x;
      const dy = p.y - other.y;
      const dz = p.z - other.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < separationRadiusSq && distSq > 0.001) {
        const invDist = 1 / Math.sqrt(distSq);
        _tempForce.x += dx * invDist * 0.1;
        _tempForce.y += dy * invDist * 0.1;
        _tempForce.z += dz * invDist * 0.1;
      }
    }
    // Apply separation
    positions[i].add(_tempForce);
  }
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// Stress Test Results Structure
// ---------------------------------------------------------------------------

interface StressTestResult {
  entityCount: number;
  bulletCount: number;
  frames: number;
  avgFrameTimeMs: number;
  minFrameTimeMs: number;
  maxFrameTimeMs: number;
  breakdown: {
    entityUpdateMs: number;
    spatialHashInsertMs: number;
    collisionQueryMs: number;
    enemySeparationMs: number;
    workerCollisionPackMs: number;
    workerCollisionComputeMs: number;
  };
  totalFrameTimeMs: number;
  estimatedFPS: number;
  collisionHits: number;
  workerPairCount: number;
  memoryEstimateMB: number;
}

const ENTITY_LEVELS = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const FRAMES = 100;
const BULLET_RATIO = 0.2; // 20% of entities are bullets
const SPHERE_RADIUS = 10;

const results: StressTestResult[] = [];

// ---------------------------------------------------------------------------
// Main Stress Test
// ---------------------------------------------------------------------------

describe('Performance Stress Test', () => {
  for (const entityCount of ENTITY_LEVELS) {
    it(`${entityCount.toLocaleString()} entities: full frame simulation`, () => {
      const bulletCount = Math.max(20, Math.floor(entityCount * BULLET_RATIO));
      const enemyCount = entityCount - bulletCount;

      // Pre-generate positions
      const enemyPositions = randomSpherePositions(enemyCount, SPHERE_RADIUS);
      const bulletPositions = randomSpherePositions(bulletCount, SPHERE_RADIUS);
      const allPositions = [...enemyPositions, ...bulletPositions];

      const frameTimes: number[] = [];
      const breakdowns = {
        entityUpdate: 0,
        spatialHashInsert: 0,
        collisionQuery: 0,
        enemySeparation: 0,
        workerPack: 0,
        workerCompute: 0,
      };

      let totalHits = 0;
      let totalWorkerPairs = 0;

      for (let frame = 0; frame < FRAMES; frame++) {
        const frameStart = performance.now();

        // 1. Entity update (surface transforms + velocity integration)
        const updateMs = simulateEntityUpdate(allPositions, allPositions.length);
        breakdowns.entityUpdate += updateMs;

        // 2. Collision detection (bullets vs enemies via spatial hash)
        const collision = simulateCollisionDetection(enemyPositions, bulletCount, bulletPositions);
        breakdowns.spatialHashInsert += collision.insertMs;
        breakdowns.collisionQuery += collision.queryMs;
        totalHits += collision.hits;

        // 3. Enemy separation (enemy-enemy repulsion)
        // Only run for up to 10K to keep test time reasonable
        let separationMs = 0;
        if (enemyCount <= 10000) {
          separationMs = simulateEnemySeparation(enemyPositions, enemyCount);
        }
        breakdowns.enemySeparation += separationMs;

        // 4. Worker collision path (SharedArrayBuffer pack + compute)
        // Only run for up to 20K to keep test time reasonable
        if (entityCount <= 20000) {
          const worker = simulateWorkerCollision(
            Math.min(entityCount, 5000), // Cap worker test at 5K entities
            allPositions.slice(0, Math.min(entityCount, 5000)),
          );
          breakdowns.workerPack += worker.packMs;
          breakdowns.workerCompute += worker.computeMs;
          totalWorkerPairs += worker.pairCount;
        }

        const frameTime = performance.now() - frameStart;
        frameTimes.push(frameTime);
      }

      // Compute stats
      const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / FRAMES;
      const minFrameTime = Math.min(...frameTimes);
      const maxFrameTime = Math.max(...frameTimes);
      const estimatedFPS = avgFrameTime > 0 ? 1000 / avgFrameTime : Infinity;

      // Memory estimate: ~200 bytes per entity (position, velocity, mesh reference, collision data)
      const memoryEstimateMB = (entityCount * 200) / (1024 * 1024);

      const result: StressTestResult = {
        entityCount,
        bulletCount,
        frames: FRAMES,
        avgFrameTimeMs: Number(avgFrameTime.toFixed(3)),
        minFrameTimeMs: Number(minFrameTime.toFixed(3)),
        maxFrameTimeMs: Number(maxFrameTime.toFixed(3)),
        breakdown: {
          entityUpdateMs: Number((breakdowns.entityUpdate / FRAMES).toFixed(3)),
          spatialHashInsertMs: Number((breakdowns.spatialHashInsert / FRAMES).toFixed(3)),
          collisionQueryMs: Number((breakdowns.collisionQuery / FRAMES).toFixed(3)),
          enemySeparationMs: Number((breakdowns.enemySeparation / FRAMES).toFixed(3)),
          workerCollisionPackMs: Number((breakdowns.workerPack / FRAMES).toFixed(3)),
          workerCollisionComputeMs: Number((breakdowns.workerCompute / FRAMES).toFixed(3)),
        },
        totalFrameTimeMs: Number(avgFrameTime.toFixed(3)),
        estimatedFPS: Number(estimatedFPS.toFixed(1)),
        collisionHits: totalHits,
        workerPairCount: totalWorkerPairs,
        memoryEstimateMB: Number(memoryEstimateMB.toFixed(2)),
      };

      results.push(result);

      // Log summary
      const fps60Budget = 16.67; // ms per frame at 60fps
      const fps30Budget = 33.33; // ms per frame at 30fps
      const status = avgFrameTime < fps60Budget ? '60fps' :
                     avgFrameTime < fps30Budget ? '30fps' : 'BELOW 30fps';

      console.log([
        `\n  === ${entityCount.toLocaleString()} entities (${enemyPositions.length} enemies + ${bulletCount} bullets) ===`,
        `  Avg frame time: ${avgFrameTime.toFixed(2)}ms (${status})`,
        `  Min/Max: ${minFrameTime.toFixed(2)}ms / ${maxFrameTime.toFixed(2)}ms`,
        `  Breakdown per frame:`,
        `    Entity update:    ${(breakdowns.entityUpdate / FRAMES).toFixed(3)}ms`,
        `    Spatial hash ins: ${(breakdowns.spatialHashInsert / FRAMES).toFixed(3)}ms`,
        `    Collision query:  ${(breakdowns.collisionQuery / FRAMES).toFixed(3)}ms`,
        `    Enemy separation: ${(breakdowns.enemySeparation / FRAMES).toFixed(3)}ms`,
        `    Worker pack:      ${(breakdowns.workerPack / FRAMES).toFixed(3)}ms`,
        `    Worker compute:   ${(breakdowns.workerCompute / FRAMES).toFixed(3)}ms`,
        `  Estimated FPS: ${estimatedFPS.toFixed(0)}`,
        `  Memory estimate: ${memoryEstimateMB.toFixed(2)}MB`,
        `  Collision hits: ${totalHits}, Worker pairs: ${totalWorkerPairs}`,
      ].join('\n'));

      // The test always passes - we're measuring, not asserting limits
      expect(avgFrameTime).toBeGreaterThan(0);
    }, 120000); // Allow up to 2 minutes per entity level
  }

  // Write results to JSON after all tests complete
  it('writes results to JSON', () => {
    const resultsPath = path.resolve(__dirname, 'stress-test-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\n  Results written to: ${resultsPath}`);
    console.log(`  Total entity levels tested: ${results.length}`);

    // Summary table
    console.log('\n  === SUMMARY ===');
    console.log('  Entities | Avg Frame | Est FPS | Status');
    console.log('  ---------|-----------|---------|-------');
    for (const r of results) {
      const status = r.avgFrameTimeMs < 16.67 ? 'OK (60fps)' :
                     r.avgFrameTimeMs < 33.33 ? 'OK (30fps)' : 'SLOW';
      console.log(`  ${String(r.entityCount).padStart(8)} | ${r.avgFrameTimeMs.toFixed(2).padStart(9)}ms | ${String(r.estimatedFPS).padStart(7)} | ${status}`);
    }

    // Find limits
    const limit60 = results.filter(r => r.avgFrameTimeMs < 16.67).pop();
    const limit30 = results.filter(r => r.avgFrameTimeMs < 33.33).pop();
    console.log(`\n  60fps limit (CPU only): ${limit60?.entityCount ?? '<100'} entities`);
    console.log(`  30fps limit (CPU only): ${limit30?.entityCount ?? '<100'} entities`);
    console.log('  NOTE: These are CPU-only numbers. Actual in-browser performance will differ');
    console.log('  due to GPU rendering, garbage collection, and browser overhead.');

    expect(results.length).toBe(ENTITY_LEVELS.length);
  });
});

// ---------------------------------------------------------------------------
// Individual System Stress Tests
// ---------------------------------------------------------------------------

describe('SpatialHash Stress Test', () => {
  for (const count of [1000, 5000, 10000, 50000, 100000]) {
    it(`${count.toLocaleString()} entities: insert + 1000 queries`, () => {
      const hash = new SpatialHash<number>(2.5);
      const positions = randomSpherePositions(count, 10);

      // Measure insert
      const insertStart = performance.now();
      for (let i = 0; i < count; i++) {
        hash.insert(positions[i].x, positions[i].y, positions[i].z, i);
      }
      const insertMs = performance.now() - insertStart;

      // Measure queries
      const queries = 1000;
      const queryStart = performance.now();
      let totalNearby = 0;
      for (let q = 0; q < queries; q++) {
        const x = (Math.random() - 0.5) * 20;
        const y = (Math.random() - 0.5) * 20;
        const z = (Math.random() - 0.5) * 20;
        const nearby = hash.getNearby(x, y, z);
        totalNearby += nearby.length;
      }
      const queryMs = performance.now() - queryStart;

      console.log([
        `  ${count.toLocaleString()} entities:`,
        `    Insert: ${insertMs.toFixed(2)}ms (${(insertMs / count * 1000).toFixed(1)}us/entity)`,
        `    Query (${queries}x): ${queryMs.toFixed(2)}ms (${(queryMs / queries).toFixed(3)}ms/query)`,
        `    Avg nearby: ${(totalNearby / queries).toFixed(1)} entities`,
      ].join('\n'));

      expect(insertMs).toBeGreaterThan(0);
    }, 30000);
  }
});

describe('Collision Detection Scaling', () => {
  const bulletCount = 200;

  for (const enemyCount of [100, 500, 1000, 2000, 5000, 10000]) {
    it(`${bulletCount} bullets vs ${enemyCount.toLocaleString()} enemies`, () => {
      const enemies = randomSpherePositions(enemyCount, 10);
      const bullets = randomSpherePositions(bulletCount, 10);
      const iterations = 20;

      // Brute force
      let bruteTotal = 0;
      const hitRadiusSq = (0.3 + 0.15) ** 2;
      for (let iter = 0; iter < iterations; iter++) {
        const start = performance.now();
        let hits = 0;
        for (let b = 0; b < bulletCount; b++) {
          const bp = bullets[b];
          for (let e = 0; e < enemyCount; e++) {
            const ep = enemies[e];
            const dx = bp.x - ep.x;
            const dy = bp.y - ep.y;
            const dz = bp.z - ep.z;
            if (dx * dx + dy * dy + dz * dz < hitRadiusSq) hits++;
          }
        }
        bruteTotal += performance.now() - start;
      }

      // Spatial hash
      let hashTotal = 0;
      for (let iter = 0; iter < iterations; iter++) {
        const hash = new SpatialHash<THREE.Vector3>(2.5);
        const start = performance.now();
        for (let e = 0; e < enemyCount; e++) {
          hash.insert(enemies[e].x, enemies[e].y, enemies[e].z, enemies[e]);
        }
        for (let b = 0; b < bulletCount; b++) {
          const bp = bullets[b];
          const nearby = hash.getNearby(bp.x, bp.y, bp.z);
          for (let n = 0; n < nearby.length; n++) {
            const ep = nearby[n];
            const dx = bp.x - ep.x;
            const dy = bp.y - ep.y;
            const dz = bp.z - ep.z;
            if (dx * dx + dy * dy + dz * dz < hitRadiusSq) { /* hit */ }
          }
        }
        hashTotal += performance.now() - start;
      }

      const bruteAvg = bruteTotal / iterations;
      const hashAvg = hashTotal / iterations;
      const speedup = bruteAvg / hashAvg;

      console.log(`  ${bulletCount} vs ${enemyCount}: brute=${bruteAvg.toFixed(3)}ms, hash=${hashAvg.toFixed(3)}ms, speedup=${speedup.toFixed(1)}x`);

      expect(bruteTotal).toBeGreaterThan(0);
    }, 30000);
  }
});

describe('Enemy Separation Scaling', () => {
  for (const count of [100, 500, 1000, 2000, 5000]) {
    it(`${count.toLocaleString()} enemies: separation force computation`, () => {
      const positions = randomSpherePositions(count, 10);
      const frames = 10;
      let total = 0;
      for (let f = 0; f < frames; f++) {
        total += simulateEnemySeparation(positions, count);
      }
      const avgMs = total / frames;
      console.log(`  ${count.toLocaleString()} enemies: ${avgMs.toFixed(3)}ms/frame separation`);
      expect(avgMs).toBeGreaterThan(0);
    }, 30000);
  }
});
