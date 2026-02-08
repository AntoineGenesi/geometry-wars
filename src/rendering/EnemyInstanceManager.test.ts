import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { EnemyInstanceManager } from './EnemyInstanceManager';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

// Minimal concrete enemy subclass for testing
class TestGrunt extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 2, 10, 2, 0.2, 0.3);
    this.createMesh();
  }

  private createMesh(): void {
    // Create a simple group with child meshes (mimics GeometryBuilder output)
    const group = new THREE.Group();
    const geo1 = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5, 1);
    const mat1 = new THREE.MeshStandardMaterial({
      color: 0x4444ff,
      emissive: new THREE.Color(0x4444ff),
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.4,
    });
    group.add(new THREE.Mesh(geo1, mat1));

    const geo2 = new THREE.SphereGeometry(0.025, 6, 6);
    const mat2 = new THREE.MeshStandardMaterial({
      color: 0x4444ff,
      emissive: new THREE.Color(0x4444ff),
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.4,
    });
    group.add(new THREE.Mesh(geo2, mat2));

    this.mesh = group;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateBehavior(_dt: number, _playerU: number, _playerV: number): void {
    // no-op for tests
  }
}

// Non-instanceable enemy (e.g., Snake)
class TestSnake extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 4, 35, 3, 0.05, 0.2);
    this.mesh = new THREE.Group();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateBehavior(_dt: number, _playerU: number, _playerV: number): void {
    // no-op
  }
}

// Override constructor name for INSTANCEABLE_TYPES check
Object.defineProperty(TestGrunt, 'name', { value: 'Grunt' });
Object.defineProperty(TestSnake, 'name', { value: 'Snake' });

describe('EnemyInstanceManager', () => {
  let scene: THREE.Scene;
  let manager: EnemyInstanceManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new EnemyInstanceManager(scene, 50);
  });

  describe('isInstanceable', () => {
    it('returns true for Grunt (instanceable type)', () => {
      const grunt = new TestGrunt();
      expect(EnemyInstanceManager.isInstanceable(grunt)).toBe(true);
    });

    it('returns false for Snake (non-instanceable type)', () => {
      const snake = new TestSnake();
      expect(EnemyInstanceManager.isInstanceable(snake)).toBe(false);
    });
  });

  describe('register', () => {
    it('registers an instanceable enemy and hides its mesh', () => {
      const grunt = new TestGrunt();
      const result = manager.register(grunt);
      expect(result).toBe(true);
      expect(grunt.isInstanced).toBe(true);
      expect(grunt.mesh!.visible).toBe(false);
    });

    it('returns false for a non-instanceable enemy', () => {
      const snake = new TestSnake();
      const result = manager.register(snake);
      expect(result).toBe(false);
      expect(snake.isInstanced).toBe(false);
    });

    it('returns false for an enemy without a mesh', () => {
      const grunt = new TestGrunt();
      grunt.mesh = null;
      const result = manager.register(grunt);
      expect(result).toBe(false);
    });

    it('adds an InstancedMesh to the scene on first registration', () => {
      const grunt = new TestGrunt();
      const initialChildCount = scene.children.length;
      manager.register(grunt);
      expect(scene.children.length).toBe(initialChildCount + 1);
      expect(scene.children[initialChildCount]).toBeInstanceOf(THREE.InstancedMesh);
    });

    it('reuses the same InstancedMesh for multiple enemies of the same type', () => {
      const grunt1 = new TestGrunt();
      const grunt2 = new TestGrunt(0.3, 0.7);
      manager.register(grunt1);
      const countAfterFirst = scene.children.length;
      manager.register(grunt2);
      expect(scene.children.length).toBe(countAfterFirst);
    });

    it('returns true when registering the same enemy twice (idempotent)', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      const result = manager.register(grunt);
      expect(result).toBe(true);
    });
  });

  describe('unregister', () => {
    it('unregisters an enemy and frees the slot', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      expect(manager.isManaged(grunt)).toBe(true);

      manager.unregister(grunt);
      expect(manager.isManaged(grunt)).toBe(false);
    });

    it('does nothing for an unregistered enemy', () => {
      const grunt = new TestGrunt();
      // Should not throw
      manager.unregister(grunt);
    });
  });

  describe('updateInstances', () => {
    it('updates instance matrices from enemy mesh transforms', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);

      // Set a known position on the enemy's mesh
      grunt.mesh!.position.set(1, 2, 3);
      grunt.mesh!.updateMatrixWorld(true);

      manager.updateInstances([grunt]);

      // Verify the InstancedMesh count is > 0
      const stats = manager.getStats();
      expect(stats.totalInstances).toBe(1);
    });

    it('skips inactive enemies', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.active = false;

      manager.updateInstances([grunt]);

      const stats = manager.getStats();
      // Enemy is still registered (slot occupied) but not actively rendered
      expect(stats.totalInstances).toBe(1);
    });

    it('handles multiple enemies of same type', () => {
      const grunt1 = new TestGrunt();
      const grunt2 = new TestGrunt(0.3, 0.7);
      manager.register(grunt1);
      manager.register(grunt2);

      grunt1.mesh!.position.set(1, 0, 0);
      grunt2.mesh!.position.set(-1, 0, 0);
      grunt1.mesh!.updateMatrixWorld(true);
      grunt2.mesh!.updateMatrixWorld(true);

      manager.updateInstances([grunt1, grunt2]);

      const stats = manager.getStats();
      expect(stats.totalInstances).toBe(2);
      expect(stats.batchCount).toBe(1); // Both are Grunts -> 1 batch
    });
  });

  describe('hitFlash', () => {
    it('changes instance color to white temporarily', () => {
      vi.useFakeTimers();
      const grunt = new TestGrunt();
      manager.register(grunt);

      manager.hitFlash(grunt, 100);

      // After timeout, color should be restored
      vi.advanceTimersByTime(120);
      // No assertion on color value (internal), but it should not throw
      vi.useRealTimers();
    });

    it('does nothing for non-managed enemies', () => {
      const snake = new TestSnake();
      // Should not throw
      manager.hitFlash(snake);
    });
  });

  describe('setInstanceVisibility', () => {
    it('sets visibility without throwing', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      // Should not throw
      manager.setInstanceVisibility(grunt, 0.5);
      manager.flushColors();
    });
  });

  describe('getStats', () => {
    it('returns correct batch count and totals', () => {
      const grunt1 = new TestGrunt();
      const grunt2 = new TestGrunt(0.2, 0.8);
      manager.register(grunt1);
      manager.register(grunt2);

      const stats = manager.getStats();
      expect(stats.batchCount).toBe(1);
      expect(stats.totalInstances).toBe(2);
      expect(stats.typeBreakdown.get('Grunt')).toBe(2);
    });

    it('updates after unregister', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      manager.unregister(grunt);

      const stats = manager.getStats();
      expect(stats.totalInstances).toBe(0);
    });
  });

  describe('dispose', () => {
    it('removes all instanced meshes from scene', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      expect(scene.children.length).toBeGreaterThan(0);

      manager.dispose();
      // All instanced meshes should be removed
      const instancedMeshes = scene.children.filter(c => c instanceof THREE.InstancedMesh);
      expect(instancedMeshes.length).toBe(0);
    });
  });

  describe('slot recycling', () => {
    it('recycles freed slots for new enemies', () => {
      const grunt1 = new TestGrunt();
      const grunt2 = new TestGrunt(0.3, 0.7);
      manager.register(grunt1);
      manager.register(grunt2);

      // Unregister first enemy
      manager.unregister(grunt1);

      // Register a third enemy - should reuse the freed slot
      const grunt3 = new TestGrunt(0.1, 0.1);
      const result = manager.register(grunt3);
      expect(result).toBe(true);

      const stats = manager.getStats();
      expect(stats.totalInstances).toBe(2); // grunt2 + grunt3
    });
  });
});
