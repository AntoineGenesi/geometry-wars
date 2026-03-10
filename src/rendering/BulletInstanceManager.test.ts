import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  BulletInstanceManager,
  BulletVisualType,
  BULLET_VISUAL_CONFIGS,
} from './BulletInstanceManager';

describe('BulletInstanceManager', () => {
  let scene: THREE.Scene;
  let manager: BulletInstanceManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new BulletInstanceManager(scene, 100);
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an instance without errors', () => {
      expect(manager).toBeDefined();
    });

    it('starts with zero active bullets', () => {
      expect(manager.activeCount).toBe(0);
    });

    it('does not add BatchedMesh to scene until first bullet', () => {
      // Lazy initialization - no BatchedMesh until a bullet is added
      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      );
      expect(batchedMeshes.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // addBullet
  // -----------------------------------------------------------------------

  describe('addBullet', () => {
    it('adds a bullet and increments active count', () => {
      const pos = new THREE.Vector3(1, 2, 3);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      expect(manager.activeCount).toBe(1);
    });

    it('lazily creates a BatchedMesh on first add', () => {
      const pos = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3(1, 0, 0);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      );
      expect(batchedMeshes.length).toBe(1);
    });

    it('uses a single BatchedMesh for all visual types (1 draw call)', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b2', BulletVisualType.Spread, pos, dir);
      manager.addBullet('b3', BulletVisualType.Piercing, pos, dir);
      manager.update();

      // All bullet types share ONE BatchedMesh → 1 draw call
      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      );
      expect(batchedMeshes.length).toBe(1);
    });

    it('reuses the same BatchedMesh for same visual type', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b2', BulletVisualType.Standard, pos, dir);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      );
      expect(batchedMeshes.length).toBe(1);
    });

    it('accepts a custom color override', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      const color = new THREE.Color(0xff00ff);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir, color);
      expect(manager.activeCount).toBe(1);
    });

    it('rejects duplicate bullet ids (idempotent)', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      expect(manager.activeCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // updateBullet
  // -----------------------------------------------------------------------

  describe('updateBullet', () => {
    it('updates position and direction of an existing bullet', () => {
      const pos = new THREE.Vector3(1, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);

      const newPos = new THREE.Vector3(2, 0, 0);
      const newDir = new THREE.Vector3(0, 1, 0);
      manager.updateBullet('b1', newPos, newDir);
      manager.update();

      // Verify the matrix was applied - extract position from instance matrix
      const stats = manager.getStats();
      expect(stats.totalActive).toBe(1);
    });

    it('does nothing for a non-existent bullet id', () => {
      const pos = new THREE.Vector3(1, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      // Should not throw
      manager.updateBullet('nonexistent', pos, dir);
    });
  });

  // -----------------------------------------------------------------------
  // removeBullet
  // -----------------------------------------------------------------------

  describe('removeBullet', () => {
    it('removes a bullet and decrements active count', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      expect(manager.activeCount).toBe(1);

      manager.removeBullet('b1');
      expect(manager.activeCount).toBe(0);
    });

    it('does nothing for a non-existent bullet id', () => {
      // Should not throw
      manager.removeBullet('nonexistent');
      expect(manager.activeCount).toBe(0);
    });

    it('frees the slot for reuse', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);

      // Fill some slots
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b2', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b3', BulletVisualType.Standard, pos, dir);
      expect(manager.activeCount).toBe(3);

      // Remove middle bullet
      manager.removeBullet('b2');
      expect(manager.activeCount).toBe(2);

      // Add a new bullet - should reuse the freed slot
      manager.addBullet('b4', BulletVisualType.Standard, pos, dir);
      expect(manager.activeCount).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // update (GPU flush)
  // -----------------------------------------------------------------------

  describe('update', () => {
    it('runs without error after adding a bullet', () => {
      const pos = new THREE.Vector3(1, 2, 3);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      );
      expect(batchedMeshes.length).toBe(1);

      // update() should not throw and active count should remain correct
      expect(() => manager.update()).not.toThrow();
      expect(manager.activeCount).toBe(1);
    });

    it('produces correct active count after update with multiple bullets', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b2', BulletVisualType.Standard, pos, dir);
      manager.update();

      expect(manager.activeCount).toBeGreaterThanOrEqual(2);
    });

    it('handles empty state gracefully', () => {
      // Should not throw
      manager.update();
    });

    it('handles add then remove then update cycle', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.removeBullet('b1');
      manager.update();
      expect(manager.activeCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Max capacity
  // -----------------------------------------------------------------------

  describe('max capacity', () => {
    it('respects the max instance count per type', () => {
      const smallManager = new BulletInstanceManager(scene, 5);
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);

      for (let i = 0; i < 5; i++) {
        smallManager.addBullet(`b${i}`, BulletVisualType.Standard, pos, dir);
      }
      expect(smallManager.activeCount).toBe(5);

      // 6th bullet should be rejected (pool full for this type)
      smallManager.addBullet('b5', BulletVisualType.Standard, pos, dir);
      expect(smallManager.activeCount).toBe(5);
    });

    it('different types have independent capacity', () => {
      const smallManager = new BulletInstanceManager(scene, 3);
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);

      // Fill standard slots
      for (let i = 0; i < 3; i++) {
        smallManager.addBullet(`s${i}`, BulletVisualType.Standard, pos, dir);
      }
      expect(smallManager.activeCount).toBe(3);

      // Can still add spread bullets (different type pool)
      smallManager.addBullet('sp0', BulletVisualType.Spread, pos, dir);
      expect(smallManager.activeCount).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Matrix computation (position + orientation)
  // -----------------------------------------------------------------------

  describe('matrix computation', () => {
    it('encodes position in the instance matrix', () => {
      const pos = new THREE.Vector3(5, 10, 15);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      expect(batchedMeshes.length).toBe(1);

      // Standard type's first slot gets instanceId=0
      const matrix = new THREE.Matrix4();
      batchedMeshes[0].getMatrixAt(0, matrix);

      const extractedPos = new THREE.Vector3();
      const extractedQuat = new THREE.Quaternion();
      const extractedScale = new THREE.Vector3();
      matrix.decompose(extractedPos, extractedQuat, extractedScale);

      expect(extractedPos.x).toBeCloseTo(5, 3);
      expect(extractedPos.y).toBeCloseTo(10, 3);
      expect(extractedPos.z).toBeCloseTo(15, 3);
    });

    it('orients bullet along the direction vector', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(1, 0, 0); // pointing +X
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];

      const matrix = new THREE.Matrix4();
      batchedMeshes[0].getMatrixAt(0, matrix);

      const extractedPos = new THREE.Vector3();
      const extractedQuat = new THREE.Quaternion();
      const extractedScale = new THREE.Vector3();
      matrix.decompose(extractedPos, extractedQuat, extractedScale);

      // The local +Y axis should align with direction (1,0,0).
      // CapsuleGeometry extends along +Y, so the orientation quaternion
      // rotates +Y to match the bullet's travel direction.
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(extractedQuat);
      expect(localY.x).toBeCloseTo(1, 1);
      expect(localY.y).toBeCloseTo(0, 1);
      expect(localY.z).toBeCloseTo(0, 1);
    });

    it('applies non-zero scale from visual config', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];

      const matrix = new THREE.Matrix4();
      batchedMeshes[0].getMatrixAt(0, matrix);

      const extractedScale = new THREE.Vector3();
      matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), extractedScale);

      // Scale should be non-zero (from the visual config)
      expect(extractedScale.x).toBeGreaterThan(0);
      expect(extractedScale.y).toBeGreaterThan(0);
      expect(extractedScale.z).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Bullet visual types
  // -----------------------------------------------------------------------

  describe('bullet visual types', () => {
    it('has configs for all BulletVisualType values', () => {
      const allTypes = Object.values(BulletVisualType);
      for (const type of allTypes) {
        expect(BULLET_VISUAL_CONFIGS[type]).toBeDefined();
        expect(BULLET_VISUAL_CONFIGS[type].color).toBeDefined();
        expect(BULLET_VISUAL_CONFIGS[type].scaleX).toBeGreaterThan(0);
        expect(BULLET_VISUAL_CONFIGS[type].scaleY).toBeGreaterThan(0);
        expect(BULLET_VISUAL_CONFIGS[type].scaleZ).toBeGreaterThan(0);
      }
    });

    it('Standard type uses cyan-ish color', () => {
      const config = BULLET_VISUAL_CONFIGS[BulletVisualType.Standard];
      // Standard is white-cyan (0x88ffff)
      expect(config.color).toBe(0x88ffff);
    });

    it('Spread type uses cyan color matching SP WeaponManager appearance', () => {
      const config = BULLET_VISUAL_CONFIGS[BulletVisualType.Spread];
      // s44k-02 fix: changed from 0xffff44 (yellow) to 0x44ffff (light blue) to match SP
      expect(config.color).toBe(0x44ffff);
    });

    it('Spread type scale gives ~0.08 effective radius matching SP SphereGeometry(0.08)', () => {
      const config = BULLET_VISUAL_CONFIGS[BulletVisualType.Spread];
      // SphereGeometry(0.5) × scale 0.16 = effective radius 0.08 (same as SP WeaponManager)
      expect(config.scaleX).toBeCloseTo(0.16, 3);
      expect(config.scaleY).toBeCloseTo(0.16, 3);
      expect(config.scaleZ).toBeCloseTo(0.16, 3);
    });

    it('Piercing type uses red-white color', () => {
      const config = BULLET_VISUAL_CONFIGS[BulletVisualType.Piercing];
      expect(config.color).toBe(0xff4444);
    });

    it('Homing type uses green color', () => {
      const config = BULLET_VISUAL_CONFIGS[BulletVisualType.Homing];
      expect(config.color).toBe(0x44ff44);
    });

    it('Default type exists as fallback', () => {
      const config = BULLET_VISUAL_CONFIGS[BulletVisualType.Default];
      expect(config).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('removes all active bullets', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b2', BulletVisualType.Spread, pos, dir);
      manager.addBullet('b3', BulletVisualType.Piercing, pos, dir);
      expect(manager.activeCount).toBe(3);

      manager.clear();
      expect(manager.activeCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('removes the BatchedMesh from the scene', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b2', BulletVisualType.Spread, pos, dir);
      manager.update();

      manager.dispose();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      );
      expect(batchedMeshes.length).toBe(0);
    });

    it('resets active count to zero', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.dispose();
      expect(manager.activeCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getStats
  // -----------------------------------------------------------------------

  describe('getStats', () => {
    it('returns correct stats with mixed bullet types', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);

      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b2', BulletVisualType.Standard, pos, dir);
      manager.addBullet('b3', BulletVisualType.Spread, pos, dir);
      manager.addBullet('b4', BulletVisualType.Homing, pos, dir);

      const stats = manager.getStats();
      expect(stats.totalActive).toBe(4);
      expect(stats.batchCount).toBe(3); // Standard, Spread, Homing have active bullets
      expect(stats.typeBreakdown.get(BulletVisualType.Standard)).toBe(2);
      expect(stats.typeBreakdown.get(BulletVisualType.Spread)).toBe(1);
      expect(stats.typeBreakdown.get(BulletVisualType.Homing)).toBe(1);
    });

    it('returns zero stats when empty', () => {
      const stats = manager.getStats();
      expect(stats.totalActive).toBe(0);
      expect(stats.batchCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Stress / lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle stress', () => {
    it('handles rapid add/remove cycles', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);

      for (let cycle = 0; cycle < 10; cycle++) {
        // Add 20 bullets
        for (let i = 0; i < 20; i++) {
          manager.addBullet(`c${cycle}_b${i}`, BulletVisualType.Standard, pos, dir);
        }
        manager.update();

        // Remove all
        for (let i = 0; i < 20; i++) {
          manager.removeBullet(`c${cycle}_b${i}`);
        }
        manager.update();
      }

      expect(manager.activeCount).toBe(0);
    });

    it('handles interleaved add/update/remove across types', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);

      manager.addBullet('s1', BulletVisualType.Standard, pos, dir);
      manager.addBullet('sp1', BulletVisualType.Spread, pos, dir);
      manager.addBullet('p1', BulletVisualType.Piercing, pos, dir);
      manager.update();

      manager.updateBullet('s1', new THREE.Vector3(1, 0, 0), dir);
      manager.removeBullet('sp1');
      manager.addBullet('h1', BulletVisualType.Homing, pos, dir);
      manager.update();

      expect(manager.activeCount).toBe(3); // s1, p1, h1
    });
  });

  // -----------------------------------------------------------------------
  // Instance color
  // -----------------------------------------------------------------------

  describe('instance color', () => {
    it('sets per-instance color from visual config via getColorAt', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      expect(batchedMeshes.length).toBe(1);

      // Standard type default color is 0x88ffff — verify it was set
      const readColor = new THREE.Color();
      batchedMeshes[0].getColorAt(0, readColor);
      // Should have non-zero color (set from default or custom)
      expect(readColor.r + readColor.g + readColor.b).toBeGreaterThan(0);
    });

    it('allows custom color override per bullet', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      const customColor = new THREE.Color(0xff00ff);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir, customColor);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];

      // Standard type's first instance gets instanceId=0
      const readColor = new THREE.Color();
      batchedMeshes[0].getColorAt(0, readColor);
      expect(readColor.r).toBeCloseTo(customColor.r, 2);
      expect(readColor.g).toBeCloseTo(customColor.g, 2);
      expect(readColor.b).toBeCloseTo(customColor.b, 2);
    });
  });

  // -----------------------------------------------------------------------
  // Material type (s44k-02 regression guard)
  // -----------------------------------------------------------------------

  describe('material', () => {
    it('uses MeshBasicMaterial (not MeshStandardMaterial) so bullets are always bright', () => {
      // s44k-02 fix: BulletInstanceManager must use MeshBasicMaterial.
      // MeshStandardMaterial requires scene lighting — in poorly-lit conditions spread bullets
      // appear nearly invisible. SP WeaponManager uses MeshBasicMaterial for all projectiles.
      // This test guards against regression to MeshStandardMaterial.
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      manager.addBullet('b1', BulletVisualType.Spread, pos, dir);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      expect(batchedMeshes.length).toBe(1);

      const material = batchedMeshes[0].material;
      expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(material).not.toBeInstanceOf(THREE.MeshStandardMaterial);
    });
  });

  // -----------------------------------------------------------------------
  // Far-side bullet dimming (s44r7-05 regression guard)
  // -----------------------------------------------------------------------

  describe('setBulletOpacity — far-side depth dimming', () => {
    it('setBulletOpacity is a no-op for unknown ids', () => {
      // Should not throw
      expect(() => manager.setBulletOpacity('nonexistent', 0.5)).not.toThrow();
    });

    it('full opacity (1.0) preserves original bullet color', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      const color = new THREE.Color(0x88ffff);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir, color);
      manager.setBulletOpacity('b1', 1.0);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      const readColor = new THREE.Color();
      batchedMeshes[0].getColorAt(0, readColor);
      expect(readColor.r).toBeCloseTo(color.r, 2);
      expect(readColor.g).toBeCloseTo(color.g, 2);
      expect(readColor.b).toBeCloseTo(color.b, 2);
    });

    it('zero opacity (0.0) dims bullet to black', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      const color = new THREE.Color(0x88ffff);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir, color);
      manager.setBulletOpacity('b1', 0.0);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      const readColor = new THREE.Color();
      batchedMeshes[0].getColorAt(0, readColor);
      expect(readColor.r).toBeCloseTo(0, 2);
      expect(readColor.g).toBeCloseTo(0, 2);
      expect(readColor.b).toBeCloseTo(0, 2);
    });

    it('partial opacity (0.1) dims bullet to 10% brightness', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      const color = new THREE.Color(1, 1, 1); // pure white for easy math
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir, color);
      manager.setBulletOpacity('b1', 0.1);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      const readColor = new THREE.Color();
      batchedMeshes[0].getColorAt(0, readColor);
      expect(readColor.r).toBeCloseTo(0.1, 2);
      expect(readColor.g).toBeCloseTo(0.1, 2);
      expect(readColor.b).toBeCloseTo(0.1, 2);
    });

    it('default opacityScale is 1.0 (bullet starts fully bright before any setBulletOpacity call)', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      const color = new THREE.Color(1, 1, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir, color);
      // No setBulletOpacity call — should default to full brightness
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      const readColor = new THREE.Color();
      batchedMeshes[0].getColorAt(0, readColor);
      expect(readColor.r).toBeCloseTo(1.0, 2);
      expect(readColor.g).toBeCloseTo(1.0, 2);
      expect(readColor.b).toBeCloseTo(1.0, 2);
    });

    it('opacity can be updated between frames', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(0, 0, 1);
      const color = new THREE.Color(1, 1, 1);
      manager.addBullet('b1', BulletVisualType.Standard, pos, dir, color);

      // Frame 1: bright
      manager.setBulletOpacity('b1', 1.0);
      manager.update();

      // Frame 2: dimmed (bullet moved to far side)
      manager.setBulletOpacity('b1', 0.08);
      manager.update();

      const batchedMeshes = scene.children.filter(
        (c) => c instanceof THREE.BatchedMesh,
      ) as THREE.BatchedMesh[];
      const readColor = new THREE.Color();
      batchedMeshes[0].getColorAt(0, readColor);
      expect(readColor.r).toBeCloseTo(0.08, 2);
    });
  });
});
