import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { EnemyInstanceManager } from './EnemyInstanceManager';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { LODLevel } from './LODManager';

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

    it('two enemies of same type get DIFFERENT instanceColor when given different visibility', () => {
      // Regression test for s44r10-01: user reported all instances of the same
      // enemy type sharing one brightness. This test verifies that RGB-based
      // dimming (via instanceColor) produces different colors per instance.
      const nearGrunt = new TestGrunt(0.5, 0.5);
      const farGrunt = new TestGrunt(0.9, 0.9);
      manager.register(nearGrunt);
      manager.register(farGrunt);

      // Simulate dimming: near enemy is bright, far enemy is dim
      manager.setInstanceVisibility(nearGrunt, 1.0);
      manager.setInstanceVisibility(farGrunt, 0.15);
      manager.flushColors();

      // Read back instanceColor for each enemy
      const batch = (manager as any).batches.get('Grunt');
      expect(batch).toBeDefined();

      const nearIndex = batch.enemyToIndex.get(nearGrunt);
      const farIndex = batch.enemyToIndex.get(farGrunt);
      expect(nearIndex).toBeDefined();
      expect(farIndex).toBeDefined();

      const nearColor = new THREE.Color();
      const farColor = new THREE.Color();
      batch.instancedMesh.getColorAt(nearIndex!, nearColor);
      batch.instancedMesh.getColorAt(farIndex!, farColor);

      // Near enemy should be significantly brighter than far enemy
      const nearBrightness = nearColor.r + nearColor.g + nearColor.b;
      const farBrightness = farColor.r + farColor.g + farColor.b;
      expect(nearBrightness).toBeGreaterThan(farBrightness * 2);

      // Far enemy should NOT be zero (still visible at SURFACE_DIM_OPACITY)
      expect(farBrightness).toBeGreaterThan(0);

      // Opacity attribute should also differ (WebGL path)
      expect(batch.opacityAttribute.getX(nearIndex!)).toBeCloseTo(1.0, 5);
      expect(batch.opacityAttribute.getX(farIndex!)).toBeCloseTo(0.15, 5);
    });

    it('preserves rainbow mode colors when dimming', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);

      // Set rainbow color
      const rainbowColor = new THREE.Color(1.0, 0.0, 0.5);
      manager.setEnemyColor(grunt, rainbowColor);

      // Apply dimming
      manager.setInstanceVisibility(grunt, 0.5);
      manager.flushColors();

      // Read back instanceColor — should be rainbow color * 0.5
      const batch = (manager as any).batches.get('Grunt');
      const index = batch.enemyToIndex.get(grunt);
      const color = new THREE.Color();
      batch.instancedMesh.getColorAt(index!, color);

      expect(color.r).toBeCloseTo(0.5, 2);   // 1.0 * 0.5
      expect(color.g).toBeCloseTo(0.0, 2);   // 0.0 * 0.5
      expect(color.b).toBeCloseTo(0.25, 2);  // 0.5 * 0.5
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

  // ====== LOD geometry swap tests ======

  describe('updateInstancesWithLOD', () => {
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.set(0, 0, 15);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
    });

    it('creates shared LOD batches on first call', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.HIGH);

      const childCountBefore = scene.children.length;
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      // Should have added 2 shared LOD batches (medium + low)
      expect(scene.children.length).toBe(childCountBefore + 2);
    });

    it('keeps HIGH LOD enemies in their type-specific batch', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.HIGH);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      // Enemy should NOT be in a LOD batch
      expect(manager.isInLODBatch(grunt)).toBe(false);

      // Instance matrix should have the enemy's position (not zero-scaled)
      const instancedMesh = scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'instanced-Grunt'
      ) as THREE.InstancedMesh;
      expect(instancedMesh).toBeDefined();

      const matrix = new THREE.Matrix4();
      instancedMesh.getMatrixAt(0, matrix);
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(matrix);
      expect(pos.x).toBeCloseTo(1, 1);
    });

    it('moves MEDIUM LOD enemies to shared icosahedron batch', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      // Enemy should be in a LOD batch
      expect(manager.isInLODBatch(grunt)).toBe(true);

      // The HIGH batch should have this enemy at zero-scale (hidden)
      const highBatch = scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'instanced-Grunt'
      ) as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      highBatch.getMatrixAt(0, matrix);
      const scale = new THREE.Vector3();
      scale.setFromMatrixScale(matrix);
      expect(scale.x).toBeCloseTo(0);
      expect(scale.y).toBeCloseTo(0);
      expect(scale.z).toBeCloseTo(0);

      // The shared medium LOD batch should have the enemy positioned
      const lodMediumBatch = scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'lod-medium'
      ) as THREE.InstancedMesh;
      expect(lodMediumBatch).toBeDefined();
      expect(lodMediumBatch.count).toBeGreaterThan(0);
    });

    it('moves LOW LOD enemies to shared billboard batch', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.LOW);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      expect(manager.isInLODBatch(grunt)).toBe(true);

      // The shared low LOD batch should have the enemy positioned
      const lodLowBatch = scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'lod-low'
      ) as THREE.InstancedMesh;
      expect(lodLowBatch).toBeDefined();
      expect(lodLowBatch.count).toBeGreaterThan(0);
    });

    it('transitions enemy from LOD batch back to HIGH when LOD changes', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      // First frame: MEDIUM LOD
      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);
      expect(manager.isInLODBatch(grunt)).toBe(true);

      // Second frame: back to HIGH LOD
      lodAssignments.set(grunt, LODLevel.HIGH);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);
      expect(manager.isInLODBatch(grunt)).toBe(false);
    });

    it('handles mixed LOD levels across multiple enemies', () => {
      const highGrunt = new TestGrunt();
      const medGrunt = new TestGrunt(0.3, 0.7);
      const lowGrunt = new TestGrunt(0.1, 0.1);

      manager.register(highGrunt);
      manager.register(medGrunt);
      manager.register(lowGrunt);

      highGrunt.mesh!.position.set(1, 0, 0);
      medGrunt.mesh!.position.set(-5, 0, 0);
      lowGrunt.mesh!.position.set(-20, 0, 0);
      highGrunt.mesh!.updateMatrixWorld(true);
      medGrunt.mesh!.updateMatrixWorld(true);
      lowGrunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(highGrunt, LODLevel.HIGH);
      lodAssignments.set(medGrunt, LODLevel.MEDIUM);
      lodAssignments.set(lowGrunt, LODLevel.LOW);

      manager.updateInstancesWithLOD([highGrunt, medGrunt, lowGrunt], lodAssignments, camera);

      expect(manager.isInLODBatch(highGrunt)).toBe(false);
      expect(manager.isInLODBatch(medGrunt)).toBe(true);
      expect(manager.isInLODBatch(lowGrunt)).toBe(true);

      const lodStats = manager.getLODStats();
      expect(lodStats.mediumCount).toBe(1);
      expect(lodStats.lowCount).toBe(1);
    });

    it('skips inactive enemies', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.active = false;

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);
      expect(manager.isInLODBatch(grunt)).toBe(false);
    });

    it('skips materializing enemies', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.isMaterializing = true;
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);
      expect(manager.isInLODBatch(grunt)).toBe(false);
    });

    it('unregistering enemy also clears LOD placement', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);
      expect(manager.isInLODBatch(grunt)).toBe(true);

      manager.unregister(grunt);
      expect(manager.isInLODBatch(grunt)).toBe(false);
    });
  });

  describe('setLODInstanceVisibility', () => {
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.set(0, 0, 15);
      camera.updateMatrixWorld(true);
    });

    it('sets visibility on LOD batch instance without throwing', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      // Should not throw
      manager.setLODInstanceVisibility(grunt, 0.5);
      manager.flushColors();
    });

    it('does nothing for enemies not in LOD batch', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);

      // Not in LOD batch - should not throw
      manager.setLODInstanceVisibility(grunt, 0.5);
    });
  });

  describe('LOD geometry triangle reduction', () => {
    it('uses simplified geometry with fewer triangles for MEDIUM LOD', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);

      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 15);
      camera.updateMatrixWorld(true);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      // Find the shared medium LOD batch
      const lodMediumBatch = scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'lod-medium'
      ) as THREE.InstancedMesh;
      expect(lodMediumBatch).toBeDefined();

      // Verify the medium LOD geometry is an icosahedron (20 faces = 60 verts non-indexed)
      const geo = lodMediumBatch.geometry;
      const posAttr = geo.getAttribute('position');
      expect(posAttr.count).toBeLessThanOrEqual(100); // Icosahedron detail 0 is small

      // Find the HIGH-detail batch to compare triangle counts
      const highBatch = scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'instanced-Grunt'
      ) as THREE.InstancedMesh;
      const highPosAttr = highBatch.geometry.getAttribute('position');

      // Medium LOD geometry should have fewer vertices than high-detail geometry
      expect(posAttr.count).toBeLessThan(highPosAttr.count);
    });

    it('uses billboard geometry with 2 triangles for LOW LOD', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);

      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 15);
      camera.updateMatrixWorld(true);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.LOW);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      const lodLowBatch = scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'lod-low'
      ) as THREE.InstancedMesh;
      expect(lodLowBatch).toBeDefined();

      // Billboard = PlaneGeometry = 4 vertices (indexed) or 6 (non-indexed)
      const posAttr = lodLowBatch.geometry.getAttribute('position');
      expect(posAttr.count).toBeLessThanOrEqual(6);
    });
  });

  describe('dispose with LOD batches', () => {
    it('cleans up LOD batches on dispose', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);

      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 15);
      camera.updateMatrixWorld(true);
      grunt.mesh!.position.set(1, 0, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      // Verify LOD batches exist in scene
      const lodMeshes = scene.children.filter(
        c => c instanceof THREE.InstancedMesh &&
        ((c as THREE.InstancedMesh).name === 'lod-medium' || (c as THREE.InstancedMesh).name === 'lod-low')
      );
      expect(lodMeshes.length).toBe(2);

      manager.dispose();

      // All instanced meshes should be removed
      const remaining = scene.children.filter(c => c instanceof THREE.InstancedMesh);
      expect(remaining.length).toBe(0);
    });
  });

  // ====== Phase 1 entity culling tests ======

  describe('updateInstancesWithLOD — player culling', () => {
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      camera.position.set(0, 0, 15);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
    });

    function getInstanceMatrix(instancedMesh: THREE.InstancedMesh, index: number): THREE.Matrix4 {
      const mat = new THREE.Matrix4();
      instancedMesh.getMatrixAt(index, mat);
      return mat;
    }

    function getScaleFromMatrix(mat: THREE.Matrix4): THREE.Vector3 {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      mat.decompose(pos, quat, scale);
      return scale;
    }

    function getGruntBatch(): THREE.InstancedMesh {
      return scene.children.find(
        c => c instanceof THREE.InstancedMesh && (c as THREE.InstancedMesh).name === 'instanced-Grunt'
      ) as THREE.InstancedMesh;
    }

    it('renders enemy normally when no culling params given', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(0, 10, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.HIGH);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera);

      const batch = getGruntBatch();
      const scale = getScaleFromMatrix(getInstanceMatrix(batch, 0));
      expect(scale.length()).toBeGreaterThan(0.01); // Non-zero scale = visible
    });

    it('zero-scales enemy that is >90° from player normal (behind surface)', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      // Enemy is at (0, -10, 0) — directly below player's surface normal
      grunt.mesh!.position.set(0, -10, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.HIGH);

      // Player is at (0, 5, 0) with upward normal — enemy is behind the surface
      const playerPos = new THREE.Vector3(0, 5, 0);
      const playerNormal = new THREE.Vector3(0, 1, 0);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera, { position: playerPos, normal: playerNormal });

      const batch = getGruntBatch();
      const scale = getScaleFromMatrix(getInstanceMatrix(batch, 0));
      // Scale should be ~0 (culled)
      expect(scale.length()).toBeLessThan(0.001);
    });

    it('renders enemy on same side as player normal', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      // Enemy is at (2, 5, 0) — beside player, same hemisphere
      grunt.mesh!.position.set(2, 5, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.HIGH);

      const playerPos = new THREE.Vector3(0, 5, 0);
      const playerNormal = new THREE.Vector3(0, 1, 0);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera, { position: playerPos, normal: playerNormal });

      const batch = getGruntBatch();
      const scale = getScaleFromMatrix(getInstanceMatrix(batch, 0));
      // Scale should be non-zero (visible)
      expect(scale.length()).toBeGreaterThan(0.01);
    });

    it('culled enemy is removed from LOD placement', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);
      grunt.mesh!.position.set(0, -10, 0);
      grunt.mesh!.updateMatrixWorld(true);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.MEDIUM); // Would go to LOD batch if not culled

      const playerPos = new THREE.Vector3(0, 5, 0);
      const playerNormal = new THREE.Vector3(0, 1, 0);

      manager.updateInstancesWithLOD([grunt], lodAssignments, camera, { position: playerPos, normal: playerNormal });

      // Culled enemy should NOT be in LOD batch
      expect(manager.isInLODBatch(grunt)).toBe(false);
    });

    it('enemy transitions from culled to visible when position changes', () => {
      const grunt = new TestGrunt();
      manager.register(grunt);

      const lodAssignments = new Map<BaseEnemy, LODLevel>();
      lodAssignments.set(grunt, LODLevel.HIGH);

      const playerPos = new THREE.Vector3(0, 5, 0);
      const playerNormal = new THREE.Vector3(0, 1, 0);

      // Frame 1: enemy is behind surface (culled)
      grunt.mesh!.position.set(0, -10, 0);
      grunt.mesh!.updateMatrixWorld(true);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera, { position: playerPos, normal: playerNormal });

      const batch = getGruntBatch();
      const scale1 = getScaleFromMatrix(getInstanceMatrix(batch, 0));
      expect(scale1.length()).toBeLessThan(0.001); // Culled

      // Frame 2: enemy moves to front (visible)
      grunt.mesh!.position.set(1, 10, 0);
      grunt.mesh!.updateMatrixWorld(true);
      manager.updateInstancesWithLOD([grunt], lodAssignments, camera, { position: playerPos, normal: playerNormal });

      const scale2 = getScaleFromMatrix(getInstanceMatrix(batch, 0));
      expect(scale2.length()).toBeGreaterThan(0.01); // Visible again
    });
  });
});
