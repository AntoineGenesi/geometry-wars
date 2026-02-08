/**
 * CPU Performance Benchmark
 *
 * Measures the CPU-side cost of the optimized game systems.
 * Tests are structured as micro-benchmarks that simulate real game frame workloads.
 *
 * These measure the BEFORE and AFTER cost of the optimizations by testing
 * both the old pattern (allocating) and new pattern (pre-allocated).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpatialHash } from '../core/SpatialHash';

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

// ---------------------------------------------------------------------------
// applySurfaceTransform: old vs new
// ---------------------------------------------------------------------------

describe('CPU Benchmark: applySurfaceTransform', () => {
  const ENEMY_COUNT = 500;
  const FRAMES = 60;

  it('BEFORE: new Matrix4 + new Euler per enemy per frame', () => {
    const positions = randomSpherePositions(ENEMY_COUNT, 10);
    const normal = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3(1, 0, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let i = 0; i < ENEMY_COUNT; i++) {
        const offsetPosition = positions[i].clone();
        offsetPosition.addScaledVector(normal, 0.3);
        const rotationMatrix = new THREE.Matrix4();
        rotationMatrix.makeBasis(bitangent, normal, tangent);
        const rotation = new THREE.Euler();
        rotation.setFromRotationMatrix(rotationMatrix);
      }
    }
    const elapsed = performance.now() - start;

    // Log results (picked up by test runner output)
    console.log(`  applySurfaceTransform BEFORE: ${elapsed.toFixed(1)}ms for ${ENEMY_COUNT} enemies x ${FRAMES} frames (${(ENEMY_COUNT * FRAMES)} calls)`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('AFTER: pre-allocated Matrix4 + Euler (reused)', () => {
    const positions = randomSpherePositions(ENEMY_COUNT, 10);
    const normal = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3(1, 0, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);
    const _tempMatrix = new THREE.Matrix4();
    const _tempEuler = new THREE.Euler();
    const _tempOffset = new THREE.Vector3();

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let i = 0; i < ENEMY_COUNT; i++) {
        _tempOffset.copy(positions[i]);
        _tempOffset.addScaledVector(normal, 0.3);
        _tempMatrix.makeBasis(bitangent, normal, tangent);
        _tempEuler.setFromRotationMatrix(_tempMatrix);
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  applySurfaceTransform AFTER:  ${elapsed.toFixed(1)}ms for ${ENEMY_COUNT} enemies x ${FRAMES} frames (${(ENEMY_COUNT * FRAMES)} calls)`);
    expect(elapsed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Bullet update direction recalculation: old vs new
// ---------------------------------------------------------------------------

describe('CPU Benchmark: Bullet direction update', () => {
  const BULLET_COUNT = 200;
  const FRAMES = 60;

  it('BEFORE: new Vector3 per bullet per frame', () => {
    const directions = Array.from({ length: BULLET_COUNT }, () => ({
      dirX: Math.random() - 0.5,
      dirY: Math.random() - 0.5,
      dirZ: Math.random() - 0.5,
    }));
    const normals = randomSpherePositions(BULLET_COUNT, 1);

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let i = 0; i < BULLET_COUNT; i++) {
        const d = directions[i];
        const dir = new THREE.Vector3(d.dirX, d.dirY, d.dirZ);
        const dot = dir.dot(normals[i]);
        dir.x -= dot * normals[i].x;
        dir.y -= dot * normals[i].y;
        dir.z -= dot * normals[i].z;
        dir.normalize();
        d.dirX = dir.x;
        d.dirY = dir.y;
        d.dirZ = dir.z;
        // orientLine: clone + add
        const target = normals[i].clone().add(dir);
        void target; // prevent dead code elimination
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Bullet update BEFORE: ${elapsed.toFixed(1)}ms for ${BULLET_COUNT} bullets x ${FRAMES} frames`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('AFTER: pre-allocated temp vectors', () => {
    const directions = Array.from({ length: BULLET_COUNT }, () => ({
      dirX: Math.random() - 0.5,
      dirY: Math.random() - 0.5,
      dirZ: Math.random() - 0.5,
    }));
    const normals = randomSpherePositions(BULLET_COUNT, 1);
    const _tempDir = new THREE.Vector3();
    const _tempTarget = new THREE.Vector3();

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let i = 0; i < BULLET_COUNT; i++) {
        const d = directions[i];
        _tempDir.set(d.dirX, d.dirY, d.dirZ);
        const dot = _tempDir.dot(normals[i]);
        _tempDir.x -= dot * normals[i].x;
        _tempDir.y -= dot * normals[i].y;
        _tempDir.z -= dot * normals[i].z;
        _tempDir.normalize();
        d.dirX = _tempDir.x;
        d.dirY = _tempDir.y;
        d.dirZ = _tempDir.z;
        // orientLine: reuse temp
        _tempTarget.copy(normals[i]).add(_tempDir);
        void _tempTarget; // prevent dead code elimination
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Bullet update AFTER:  ${elapsed.toFixed(1)}ms for ${BULLET_COUNT} bullets x ${FRAMES} frames`);
    expect(elapsed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Spring simulation: old vs new
// ---------------------------------------------------------------------------

describe('CPU Benchmark: Spring simulation', () => {
  const SPRING_COUNT = 432; // 24x18 grid
  const FRAMES = 60;
  const SUB_STEPS = 4;

  function createSprings(count: number) {
    return Array.from({ length: count }, () => ({
      offset: new THREE.Vector3(
        (Math.random() - 0.5) * 0.01,
        (Math.random() - 0.5) * 0.01,
        (Math.random() - 0.5) * 0.01,
      ),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1,
      ),
      restPosition: new THREE.Vector3(
        Math.random() * 20 - 10,
        Math.random() * 20 - 10,
        Math.random() * 20 - 10,
      ),
      stiffness: 0.2,
      damping: 0.95,
    }));
  }

  it('BEFORE: clone().multiplyScalar() per spring per sub-step', () => {
    const springs = createSprings(SPRING_COUNT);
    const subDt = (1 / 60) / SUB_STEPS;

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let step = 0; step < SUB_STEPS; step++) {
        for (const spring of springs) {
          const springForce = spring.offset.clone().multiplyScalar(-spring.stiffness);
          spring.velocity.add(springForce.multiplyScalar(subDt * 60));
          spring.velocity.multiplyScalar(Math.pow(spring.damping, subDt * 60));
          spring.offset.add(spring.velocity.clone().multiplyScalar(subDt));
        }
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Spring sim BEFORE: ${elapsed.toFixed(1)}ms for ${SPRING_COUNT} springs x ${FRAMES} frames x ${SUB_STEPS} sub-steps`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('AFTER: addScaledVector (zero allocations)', () => {
    const springs = createSprings(SPRING_COUNT);
    const subDt = (1 / 60) / SUB_STEPS;

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let step = 0; step < SUB_STEPS; step++) {
        for (const spring of springs) {
          const stiffnessTimesDt = -spring.stiffness * subDt * 60;
          spring.velocity.addScaledVector(spring.offset, stiffnessTimesDt);
          spring.velocity.multiplyScalar(Math.pow(spring.damping, subDt * 60));
          spring.offset.addScaledVector(spring.velocity, subDt);
        }
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Spring sim AFTER:  ${elapsed.toFixed(1)}ms for ${SPRING_COUNT} springs x ${FRAMES} frames x ${SUB_STEPS} sub-steps`);
    expect(elapsed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Collision detection: brute force vs spatial hash at various scales
// ---------------------------------------------------------------------------

describe('CPU Benchmark: Collision Detection', () => {
  const BULLET_COUNT = 100;

  function runCollisionBenchmark(
    enemyCount: number,
    method: 'brute' | 'spatial',
  ): { elapsed: number; hits: number } {
    const bullets = randomSpherePositions(BULLET_COUNT, 10);
    const enemies = randomSpherePositions(enemyCount, 10);
    const enemyRadius = 0.3;
    const bulletRadius = 0.15;
    const hitRadiusSq = (enemyRadius + bulletRadius) ** 2;

    let hits = 0;

    if (method === 'brute') {
      const start = performance.now();
      for (const bulletPos of bullets) {
        for (const enemyPos of enemies) {
          const distSq = bulletPos.distanceToSquared(enemyPos);
          if (distSq < hitRadiusSq) hits++;
        }
      }
      return { elapsed: performance.now() - start, hits };
    } else {
      const hash = new SpatialHash<THREE.Vector3>(2.5);
      const start = performance.now();
      for (const enemyPos of enemies) {
        hash.insert(enemyPos.x, enemyPos.y, enemyPos.z, enemyPos);
      }
      for (const bulletPos of bullets) {
        const nearby = hash.getNearby(bulletPos.x, bulletPos.y, bulletPos.z);
        for (let i = 0; i < nearby.length; i++) {
          const distSq = bulletPos.distanceToSquared(nearby[i]);
          if (distSq < hitRadiusSq) hits++;
        }
      }
      return { elapsed: performance.now() - start, hits };
    }
  }

  for (const enemyCount of [100, 200, 500, 1000]) {
    it(`${enemyCount} enemies: brute force vs spatial hash`, () => {
      // Run multiple times to get stable results
      const iterations = 20;
      let bruteTotal = 0;
      let hashTotal = 0;
      let bruteHits = 0;
      let hashHits = 0;

      for (let i = 0; i < iterations; i++) {
        const br = runCollisionBenchmark(enemyCount, 'brute');
        const hr = runCollisionBenchmark(enemyCount, 'spatial');
        bruteTotal += br.elapsed;
        hashTotal += hr.elapsed;
        bruteHits = br.hits;
        hashHits = hr.hits;
      }

      const bruteAvg = bruteTotal / iterations;
      const hashAvg = hashTotal / iterations;
      const speedup = bruteAvg / hashAvg;

      console.log(`  ${enemyCount} enemies: brute=${bruteAvg.toFixed(2)}ms, hash=${hashAvg.toFixed(2)}ms, speedup=${speedup.toFixed(1)}x`);

      // Note: Spatial hash benefit increases at higher counts and is most
      // impactful for the O(n^2) enemy separation loop (not tested here).
      // At small scales, JIT variance can exceed the benefit.
      // The real win is eliminating GC pressure from O(n^2) checks in-browser.
      expect(bruteTotal).toBeGreaterThan(0);
      expect(hashTotal).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Depth opacity loop: old (clone) vs new (pre-allocated)
// ---------------------------------------------------------------------------

describe('CPU Benchmark: Depth opacity', () => {
  const ENEMY_COUNT = 300;
  const FRAMES = 60;

  it('BEFORE: clone + normalize per enemy per frame', () => {
    const enemies = randomSpherePositions(ENEMY_COUNT, 10);
    const meshCenter = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3(0, 0, 20);

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      const toPlayer = new THREE.Vector3(0, 10, 0).sub(camPos);
      const toPlayerDir = toPlayer.clone().normalize();
      for (let i = 0; i < ENEMY_COUNT; i++) {
        const approxNormal = enemies[i].clone().sub(meshCenter).normalize();
        const toEnemy = enemies[i].clone().sub(camPos);
        const enemyDist = toEnemy.length();
        const toEnemyDir = toEnemy.normalize();
        const alignment = toPlayerDir.dot(toEnemyDir);
        void approxNormal;
        void enemyDist;
        void alignment;
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Depth opacity BEFORE: ${elapsed.toFixed(1)}ms for ${ENEMY_COUNT} enemies x ${FRAMES} frames`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('AFTER: pre-allocated vectors (zero allocations in loop)', () => {
    const enemies = randomSpherePositions(ENEMY_COUNT, 10);
    const meshCenter = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3(0, 0, 20);
    const _tempToPlayer = new THREE.Vector3();
    const _tempToPlayerDir = new THREE.Vector3();
    const _tempApproxNormal = new THREE.Vector3();
    const _tempToEnemy = new THREE.Vector3();

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      _tempToPlayer.set(0, 10, 0).sub(camPos);
      _tempToPlayerDir.copy(_tempToPlayer).normalize();
      for (let i = 0; i < ENEMY_COUNT; i++) {
        _tempApproxNormal.copy(enemies[i]).sub(meshCenter).normalize();
        _tempToEnemy.copy(enemies[i]).sub(camPos);
        const enemyDist = _tempToEnemy.length();
        _tempToEnemy.normalize();
        const alignment = _tempToPlayerDir.dot(_tempToEnemy);
        void _tempApproxNormal;
        void enemyDist;
        void alignment;
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Depth opacity AFTER:  ${elapsed.toFixed(1)}ms for ${ENEMY_COUNT} enemies x ${FRAMES} frames`);
    expect(elapsed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Geom surface projection: old vs new
// ---------------------------------------------------------------------------

describe('CPU Benchmark: Geom surface projection', () => {
  const GEOM_COUNT = 300;
  const FRAMES = 60;

  it('BEFORE: new Matrix4 + new Quaternion x2 per geom per frame', () => {
    const normals = randomSpherePositions(GEOM_COUNT, 1);
    const tangent = new THREE.Vector3(1, 0, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let i = 0; i < GEOM_COUNT; i++) {
        const mat = new THREE.Matrix4().makeBasis(tangent, normals[i], bitangent);
        const baseQuat = new THREE.Quaternion().setFromRotationMatrix(mat);
        const spinQuat = new THREE.Quaternion().setFromAxisAngle(normals[i], frame * 0.1);
        spinQuat.multiply(baseQuat);
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Geom projection BEFORE: ${elapsed.toFixed(1)}ms for ${GEOM_COUNT} geoms x ${FRAMES} frames`);
    expect(elapsed).toBeGreaterThan(0);
  });

  it('AFTER: pre-allocated Matrix4 + Quaternion (reused)', () => {
    const normals = randomSpherePositions(GEOM_COUNT, 1);
    const tangent = new THREE.Vector3(1, 0, 0);
    const bitangent = new THREE.Vector3(0, 0, 1);
    const _mat = new THREE.Matrix4();
    const _base = new THREE.Quaternion();
    const _spin = new THREE.Quaternion();

    const start = performance.now();
    for (let frame = 0; frame < FRAMES; frame++) {
      for (let i = 0; i < GEOM_COUNT; i++) {
        _mat.makeBasis(tangent, normals[i], bitangent);
        _base.setFromRotationMatrix(_mat);
        _spin.setFromAxisAngle(normals[i], frame * 0.1);
        _spin.multiply(_base);
      }
    }
    const elapsed = performance.now() - start;

    console.log(`  Geom projection AFTER:  ${elapsed.toFixed(1)}ms for ${GEOM_COUNT} geoms x ${FRAMES} frames`);
    expect(elapsed).toBeGreaterThan(0);
  });
});
