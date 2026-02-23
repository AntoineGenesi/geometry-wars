import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Three.js (no DOM / WebGL needed for unit tests)
// ---------------------------------------------------------------------------
vi.mock('three', () => {
  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    addScaledVector(v: Vector3, s: number) {
      this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this;
    }
    multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() {
      const l = this.length();
      if (l > 0) { this.x /= l; this.y /= l; this.z /= l; }
      return this;
    }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    distanceTo(v: Vector3) {
      const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    distanceToSquared(v: Vector3) {
      const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
      return dx * dx + dy * dy + dz * dz;
    }
    sub(v: Vector3) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  }

  class Quaternion {
    x = 0; y = 0; z = 0; w = 1;
    copy(q: Quaternion) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
    invert() { return this; }
  }

  class Matrix4 {
    makeBasis() { return this; }
    elements = new Array(16).fill(0);
  }

  class Euler {}
  class Object3D {
    position = new Vector3();
    quaternion = new Quaternion();
    scale = { multiplyScalar: vi.fn() };
    traverse = vi.fn();
  }
  class Mesh extends Object3D {
    material: any = {};
    geometry: any = {};
  }

  return { Vector3, Quaternion, Matrix4, Euler, Object3D, Mesh, MeshStandardMaterial: vi.fn() };
});

// Mock profiler
vi.mock('../../core/PerformanceProfiler', () => ({
  profiler: { begin: vi.fn(), end: vi.fn() },
}));

// Mock DifficultyScaling
vi.mock('../../core/DifficultyScaling', () => ({
  getDifficultyTier: vi.fn(() => ({
    tier: 0, healthMultiplier: 1, speedMultiplier: 1, scaleMultiplier: 1,
    scoreMultiplier: 1, geomMultiplier: 1, splitCount: 0, splitChildTier: 0,
    tintColor: 0x000000,
  })),
  getContinuousHealthMultiplier: vi.fn(() => 1),
  getContinuousSpeedMultiplier: vi.fn(() => 1),
  getContinuousScaleMultiplier: vi.fn(() => 1),
  MAX_TIER: 4,
}));

// Mock Entity
vi.mock('../../core/Entity', () => {
  class Entity {
    position: any;
    mesh: any = null;
    surfacePosition = { u: 0.5, v: 0.5 };
    radius = 0.3;
    active = true;
    collisionGroup = 0;
    constructor() {
      // Lazy import to avoid circular mock issues
      const { Vector3 } = require('three');
      this.position = new Vector3();
    }
  }
  const CollisionGroup = { Enemy: 1 };
  return { Entity, CollisionGroup };
});

import { BaseEnemy } from './BaseEnemy';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Minimal concrete subclass for testing
// ---------------------------------------------------------------------------

class TestEnemy extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 1, 10, 1, 0.06);
  }

  updateBehavior(_dt: number, _pu: number, _pv: number): void {
    // Stationary enemy — no voluntary movement
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseEnemy.applyKnockback', () => {
  let enemy: TestEnemy;

  beforeEach(() => {
    enemy = new TestEnemy(0.5, 0.5);
  });

  describe('applyKnockback', () => {
    it('adds to knockback velocity', () => {
      const startU = enemy.surfacePosition.u;
      const startV = enemy.surfacePosition.v;

      enemy.applyKnockback(1.0, 0);
      enemy.update(0.016);

      // Enemy should have moved in U direction
      expect(enemy.surfacePosition.u).toBeGreaterThan(startU);
      expect(enemy.surfacePosition.v).toBeCloseTo(startV, 5);
    });

    it('multiple knockbacks accumulate (additive)', () => {
      // Apply two knockbacks, result should be additive
      enemy.applyKnockback(1.0, 0);
      enemy.applyKnockback(1.0, 0);

      const startU = enemy.surfacePosition.u;
      enemy.update(0.016);
      const singleEnemy = new TestEnemy(0.5, 0.5);
      const singleStartU = singleEnemy.surfacePosition.u;
      singleEnemy.applyKnockback(1.0, 0);
      singleEnemy.update(0.016);

      const doubleMove = enemy.surfacePosition.u - startU;
      const singleMove = singleEnemy.surfacePosition.u - singleStartU;
      // Double knockback should move approximately twice as far
      expect(doubleMove).toBeGreaterThan(singleMove * 1.5);
    });

    it('knockback decays over time', () => {
      enemy.applyKnockback(1.0, 0);

      // Advance several frames and collect per-frame displacement
      const displacements: number[] = [];
      const dt = 0.016;
      for (let i = 0; i < 20; i++) {
        const before = enemy.surfacePosition.u;
        enemy.update(dt);
        displacements.push(enemy.surfacePosition.u - before);
      }

      // Displacement should decrease monotonically (exponential decay)
      for (let i = 1; i < displacements.length; i++) {
        expect(displacements[i]).toBeLessThanOrEqual(displacements[i - 1] + 1e-9);
      }
    });

    it('knockback decays to near-zero within ~2 seconds (10× half-life)', () => {
      enemy.applyKnockback(1.0, 0);

      // After 2 seconds (10 half-lives of 0.2s), knockback velocity is < 1/1024 of initial.
      // Per-frame displacement at dt=0.02: ~0.0000195 — well below 0.0001.
      const dt = 0.02;
      for (let i = 0; i < 100; i++) { // 100 * 0.02 = 2.0s
        enemy.update(dt);
      }

      // Net displacement from one more small step should be negligible
      const before = enemy.surfacePosition.u;
      enemy.update(dt);
      const displacement = Math.abs(enemy.surfacePosition.u - before);
      expect(displacement).toBeLessThan(0.0001);
    });

    it('ignores knockback for walker-mode enemies', () => {
      (enemy as any).walker = {}; // Simulate walker mode
      const startU = enemy.surfacePosition.u;

      enemy.applyKnockback(10.0, 0);
      // Walker-mode update does not apply knockback UV
      // (walker mode computes world-space movement, not UV)
      // Position should remain unchanged by knockback
      expect(enemy.surfacePosition.u).toBe(startU);
    });
  });

  describe('knockback does not affect walker-mode movement', () => {
    it('applyKnockback returns early if walker is set', () => {
      (enemy as any).walker = {};
      enemy.applyKnockback(100, 100); // Large impulse
      // _knockbackU/_knockbackV should remain 0 (early return)
      expect((enemy as any)._knockbackU).toBe(0);
      expect((enemy as any)._knockbackV).toBe(0);
    });
  });
});
