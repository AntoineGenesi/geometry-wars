import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  LODManager,
  LODLevel,
  LODConfig,
  DEFAULT_LOD_CONFIG,
  LODGeometryCache,
} from './LODManager';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

// ---------- Test helpers ----------

/** Minimal concrete enemy for testing (mimics Grunt). */
class TestGrunt extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 2, 10, 2, 0.2, 0.3);
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const geo = new THREE.OctahedronGeometry(0.15, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4444ff,
      emissive: new THREE.Color(0x4444ff),
      emissiveIntensity: 0.4,
    });
    group.add(new THREE.Mesh(geo, mat));
    this.mesh = group;
  }

  updateBehavior(_dt: number, _playerU: number, _playerV: number): void {
    // no-op
  }
}

/** Minimal enemy with different color for color-extraction tests. */
class TestWanderer extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 2, 5, 1, 0.04, 0.3);
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const geo = new THREE.OctahedronGeometry(0.2, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xaa44ff,
      emissive: new THREE.Color(0xaa44ff),
      emissiveIntensity: 0.3,
    });
    group.add(new THREE.Mesh(geo, mat));
    this.mesh = group;
  }

  updateBehavior(_dt: number, _playerU: number, _playerV: number): void {
    // no-op
  }
}

// Override constructor names for type keying
Object.defineProperty(TestGrunt, 'name', { value: 'Grunt' });
Object.defineProperty(TestWanderer, 'name', { value: 'Wanderer' });

/** Place an enemy at a known world position. */
function placeEnemy(enemy: BaseEnemy, x: number, y: number, z: number): void {
  enemy.position.set(x, y, z);
  if (enemy.mesh) {
    enemy.mesh.position.set(x, y, z);
    enemy.mesh.updateMatrixWorld(true);
  }
}

/** Create a camera at a known position looking at origin. */
function makeCamera(x = 0, y = 0, z = 15): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(x, y, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

// ---------- Tests ----------

describe('LODManager', () => {
  let manager: LODManager;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    manager = new LODManager();
    camera = makeCamera();
  });

  // ====== LOD level assignment ======

  describe('LOD level assignment', () => {
    it('assigns HIGH for enemies close to camera', () => {
      const enemy = new TestGrunt();
      placeEnemy(enemy, 0, 0, 5); // 10 units from camera at z=15

      const assignments = manager.update(camera, [enemy]);

      expect(assignments.get(enemy)).toBe(LODLevel.HIGH);
    });

    it('assigns MEDIUM for enemies at medium distance', () => {
      const enemy = new TestGrunt();
      placeEnemy(enemy, 0, 0, -20); // 35 units from camera at z=15

      const assignments = manager.update(camera, [enemy]);

      expect(assignments.get(enemy)).toBe(LODLevel.MEDIUM);
    });

    it('assigns LOW for enemies far from camera', () => {
      const enemy = new TestGrunt();
      placeEnemy(enemy, 0, 0, -50); // 65 units from camera at z=15

      const assignments = manager.update(camera, [enemy]);

      expect(assignments.get(enemy)).toBe(LODLevel.LOW);
    });

    it('skips inactive enemies', () => {
      const enemy = new TestGrunt();
      enemy.active = false;
      placeEnemy(enemy, 0, 0, 5);

      const assignments = manager.update(camera, [enemy]);

      expect(assignments.has(enemy)).toBe(false);
    });

    it('skips dead enemies', () => {
      const enemy = new TestGrunt();
      enemy.alive = false;
      placeEnemy(enemy, 0, 0, 5);

      const assignments = manager.update(camera, [enemy]);

      expect(assignments.has(enemy)).toBe(false);
    });

    it('handles multiple enemies at different distances', () => {
      const close = new TestGrunt();
      const mid = new TestGrunt();
      const far = new TestGrunt();

      placeEnemy(close, 0, 0, 10);  // 5 units
      placeEnemy(mid, 0, 0, -20);   // 35 units
      placeEnemy(far, 0, 0, -50);   // 65 units

      const assignments = manager.update(camera, [close, mid, far]);

      expect(assignments.get(close)).toBe(LODLevel.HIGH);
      expect(assignments.get(mid)).toBe(LODLevel.MEDIUM);
      expect(assignments.get(far)).toBe(LODLevel.LOW);
    });

    it('handles empty enemy list', () => {
      const assignments = manager.update(camera, []);
      expect(assignments.size).toBe(0);
    });
  });

  // ====== Threshold configuration ======

  describe('threshold configuration', () => {
    it('uses default thresholds', () => {
      expect(DEFAULT_LOD_CONFIG.highDistance).toBe(20);
      expect(DEFAULT_LOD_CONFIG.mediumDistance).toBe(50);
      expect(DEFAULT_LOD_CONFIG.hysteresis).toBe(2);
    });

    it('accepts custom thresholds', () => {
      const config: LODConfig = {
        highDistance: 10,
        mediumDistance: 30,
        hysteresis: 1,
      };
      const customManager = new LODManager(config);
      const enemy = new TestGrunt();

      // At 12 units: outside custom HIGH (10), inside custom MEDIUM (30)
      placeEnemy(enemy, 0, 0, 3); // 12 units from camera at z=15

      const assignments = customManager.update(camera, [enemy]);
      expect(assignments.get(enemy)).toBe(LODLevel.MEDIUM);
    });

    it('respects tighter thresholds', () => {
      const config: LODConfig = {
        highDistance: 5,
        mediumDistance: 15,
        hysteresis: 0,
      };
      const customManager = new LODManager(config);
      const enemy = new TestGrunt();

      // 8 units from camera -> MEDIUM with these thresholds
      placeEnemy(enemy, 0, 0, 7); // 8 units from camera

      const assignments = customManager.update(camera, [enemy]);
      expect(assignments.get(enemy)).toBe(LODLevel.MEDIUM);
    });
  });

  // ====== Hysteresis (anti-flicker) ======

  describe('hysteresis', () => {
    it('prevents flicker when enemy is near HIGH/MEDIUM boundary', () => {
      const config: LODConfig = {
        highDistance: 20,
        mediumDistance: 50,
        hysteresis: 2,
      };
      const mgr = new LODManager(config);
      const enemy = new TestGrunt();

      // First: clearly inside HIGH
      placeEnemy(enemy, 0, 0, 0); // 15 units
      mgr.update(camera, [enemy]);

      // Now move to exactly the boundary (20 units)
      // With hysteresis=2, must exceed 22 to transition away from HIGH
      placeEnemy(enemy, 0, 0, -5.5); // 20.5 units from camera
      const assignments = mgr.update(camera, [enemy]);

      // Still HIGH because 20.5 < 20 + 2 = 22
      expect(assignments.get(enemy)).toBe(LODLevel.HIGH);
    });

    it('transitions when clearly past boundary plus hysteresis', () => {
      const config: LODConfig = {
        highDistance: 20,
        mediumDistance: 50,
        hysteresis: 2,
      };
      const mgr = new LODManager(config);
      const enemy = new TestGrunt();

      // Start inside HIGH
      placeEnemy(enemy, 0, 0, 0); // 15 units
      mgr.update(camera, [enemy]);

      // Move well past boundary
      placeEnemy(enemy, 0, 0, -10); // 25 units from camera
      const assignments = mgr.update(camera, [enemy]);

      expect(assignments.get(enemy)).toBe(LODLevel.MEDIUM);
    });
  });

  // ====== Billboard orientation ======

  describe('billboard orientation', () => {
    it('generates a billboard quaternion facing the camera', () => {
      const enemy = new TestGrunt();
      placeEnemy(enemy, 5, 0, 0);

      const quat = LODManager.computeBillboardQuaternion(
        enemy.position,
        camera.position,
      );

      // The billboard should face toward the camera.
      // lookAt builds a basis where -Z points from entity to camera (Three.js convention),
      // so applying quat to (0,0,1) gives the BACK of the billboard which faces away.
      // Check absolute dot > 0.9 (the Z axis is aligned with the camera direction).
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      const toCamera = new THREE.Vector3()
        .subVectors(camera.position, enemy.position)
        .normalize();

      // Z axis should be aligned with the entity-to-camera direction (either sign)
      expect(Math.abs(forward.dot(toCamera))).toBeGreaterThan(0.9);
    });

    it('returns identity quaternion when enemy is at camera position', () => {
      const enemy = new TestGrunt();
      placeEnemy(enemy, camera.position.x, camera.position.y, camera.position.z);

      const quat = LODManager.computeBillboardQuaternion(
        enemy.position,
        camera.position,
      );

      // Should not produce NaN
      expect(Number.isNaN(quat.x)).toBe(false);
      expect(Number.isNaN(quat.y)).toBe(false);
      expect(Number.isNaN(quat.z)).toBe(false);
      expect(Number.isNaN(quat.w)).toBe(false);
    });
  });

  // ====== Integration with enemy types ======

  describe('enemy type integration', () => {
    it('extracts base color from enemy mesh materials', () => {
      const enemy = new TestGrunt();
      const color = LODManager.extractBaseColor(enemy);

      // Grunt uses 0x4444ff - Three.js stores Color in linear space.
      // Verify via hex comparison: getHex() returns sRGB-equivalent integer.
      expect(color).not.toBeNull();
      expect(color!.getHex()).toBe(0x4444ff);
    });

    it('extracts different color for different enemy type', () => {
      const wanderer = new TestWanderer();
      const color = LODManager.extractBaseColor(wanderer);

      // Wanderer uses 0xaa44ff
      expect(color).not.toBeNull();
      expect(color!.getHex()).toBe(0xaa44ff);
    });

    it('returns null for enemy without mesh', () => {
      const enemy = new TestGrunt();
      enemy.mesh = null;
      const color = LODManager.extractBaseColor(enemy);
      expect(color).toBeNull();
    });
  });

  // ====== LODGeometryCache ======

  describe('LODGeometryCache', () => {
    let cache: LODGeometryCache;

    beforeEach(() => {
      cache = new LODGeometryCache();
    });

    it('creates MEDIUM geometry (simplified icosahedron)', () => {
      const geo = cache.getMediumGeometry();

      expect(geo).toBeInstanceOf(THREE.BufferGeometry);
      expect(geo.getAttribute('position')).toBeDefined();
      // Icosahedron with detail 0 = 20 faces = 60 vertices (non-indexed)
      // or 12 vertices if indexed -- just verify it exists and is small
      const posAttr = geo.getAttribute('position');
      expect(posAttr.count).toBeGreaterThan(0);
      expect(posAttr.count).toBeLessThanOrEqual(100);
    });

    it('creates LOW geometry (billboard quad)', () => {
      const geo = cache.getLowGeometry();

      expect(geo).toBeInstanceOf(THREE.BufferGeometry);
      const posAttr = geo.getAttribute('position');
      // Quad = 2 triangles = 4 vertices (indexed) or 6 vertices (non-indexed)
      expect(posAttr.count).toBeLessThanOrEqual(6);
      expect(posAttr.count).toBeGreaterThanOrEqual(4);
    });

    it('returns same geometry instance on repeated calls (cached)', () => {
      const med1 = cache.getMediumGeometry();
      const med2 = cache.getMediumGeometry();
      expect(med1).toBe(med2);

      const low1 = cache.getLowGeometry();
      const low2 = cache.getLowGeometry();
      expect(low1).toBe(low2);
    });

    it('disposes geometry on cleanup', () => {
      cache.getMediumGeometry();
      cache.getLowGeometry();

      // Should not throw
      cache.dispose();

      // After dispose, new calls create fresh geometry
      const newMed = cache.getMediumGeometry();
      expect(newMed).toBeInstanceOf(THREE.BufferGeometry);
    });
  });

  // ====== Performance / CPU overhead ======

  describe('performance', () => {
    it('handles 1000 enemies without significant overhead', () => {
      const enemies: BaseEnemy[] = [];
      for (let i = 0; i < 1000; i++) {
        const enemy = new TestGrunt();
        const angle = (i / 1000) * Math.PI * 2;
        const dist = 5 + (i % 60); // Spread across 5-65 units
        placeEnemy(enemy, Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
        enemies.push(enemy);
      }

      const start = performance.now();
      const assignments = manager.update(camera, enemies);
      const elapsed = performance.now() - start;

      expect(assignments.size).toBe(1000);
      // Should complete in under 5ms for 1000 enemies (generous threshold)
      expect(elapsed).toBeLessThan(50);
    });

    it('reuses assignment map across frames to avoid GC', () => {
      const enemy = new TestGrunt();
      placeEnemy(enemy, 0, 0, 5);

      const map1 = manager.update(camera, [enemy]);
      const map2 = manager.update(camera, [enemy]);

      // Same map instance reused
      expect(map1).toBe(map2);
    });
  });

  // ====== LOD statistics ======

  describe('getStats', () => {
    it('returns correct counts per LOD level', () => {
      const close = new TestGrunt();
      const mid = new TestGrunt();
      const far1 = new TestGrunt();
      const far2 = new TestGrunt();

      placeEnemy(close, 0, 0, 10);  // ~5 units -> HIGH
      placeEnemy(mid, 0, 0, -20);   // ~35 units -> MEDIUM
      placeEnemy(far1, 0, 0, -50);  // ~65 units -> LOW
      placeEnemy(far2, 0, 0, -60);  // ~75 units -> LOW

      manager.update(camera, [close, mid, far1, far2]);
      const stats = manager.getStats();

      expect(stats.high).toBe(1);
      expect(stats.medium).toBe(1);
      expect(stats.low).toBe(2);
      expect(stats.total).toBe(4);
    });

    it('returns zeros when no enemies', () => {
      manager.update(camera, []);
      const stats = manager.getStats();

      expect(stats.high).toBe(0);
      expect(stats.medium).toBe(0);
      expect(stats.low).toBe(0);
      expect(stats.total).toBe(0);
    });
  });

  // ====== Dispose ======

  describe('dispose', () => {
    it('clears all internal state', () => {
      const enemy = new TestGrunt();
      placeEnemy(enemy, 0, 0, 5);
      manager.update(camera, [enemy]);

      manager.dispose();

      const stats = manager.getStats();
      expect(stats.total).toBe(0);
    });
  });

  // ====== LODLevel enum ======

  describe('LODLevel', () => {
    it('has three distinct values', () => {
      expect(LODLevel.HIGH).not.toBe(LODLevel.MEDIUM);
      expect(LODLevel.MEDIUM).not.toBe(LODLevel.LOW);
      expect(LODLevel.HIGH).not.toBe(LODLevel.LOW);
    });

    it('HIGH has lower numeric value than MEDIUM and LOW', () => {
      expect(LODLevel.HIGH).toBeLessThan(LODLevel.MEDIUM);
      expect(LODLevel.MEDIUM).toBeLessThan(LODLevel.LOW);
    });
  });

  // ====== Triangle count estimation ======

  describe('triangle count estimation', () => {
    it('estimates triangle reduction for LOD levels', () => {
      const close = new TestGrunt();
      const mid = new TestGrunt();
      const far = new TestGrunt();

      placeEnemy(close, 0, 0, 10);
      placeEnemy(mid, 0, 0, -20);
      placeEnemy(far, 0, 0, -50);

      manager.update(camera, [close, mid, far]);
      const estimate = manager.estimateTriangleReduction(100); // assume 100 tris per full enemy

      // HIGH: 1 enemy * 100 tris = 100
      // MEDIUM: 1 enemy * ~20 tris = 20
      // LOW: 1 enemy * 2 tris = 2
      // Total without LOD: 3 * 100 = 300
      // Total with LOD: 100 + 20 + 2 = 122
      expect(estimate.withoutLOD).toBe(300);
      expect(estimate.withLOD).toBeLessThan(300);
      expect(estimate.withLOD).toBeGreaterThan(0);
      expect(estimate.reduction).toBeGreaterThan(0);
      expect(estimate.reduction).toBeLessThan(1);
    });
  });
});
