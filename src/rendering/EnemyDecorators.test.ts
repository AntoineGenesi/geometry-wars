import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EnemyDecoratorSystem } from './EnemyDecorators';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

// Minimal concrete enemy subclass for testing
class TestWanderer extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 2, 5, 1, 0.04, 0.3);
    this.mesh = new THREE.Group();
    // Add a child mesh so updateWorldMatrix works
    const geo = new THREE.SphereGeometry(0.1, 4, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0xaa44ff });
    this.mesh.add(new THREE.Mesh(geo, mat));
  }

  // Must override to satisfy TypeScript (class name used for config lookup)
  get [Symbol.toStringTag]() { return 'Wanderer'; }

  updateBehavior(): void {
    // no-op
  }
}

// Force constructor.name to be 'Wanderer' for config lookup
Object.defineProperty(TestWanderer, 'name', { value: 'Wanderer' });

class TestGrunt extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 2, 10, 2, 0.2, 0.3);
    this.mesh = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.1, 4, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4444ff });
    this.mesh.add(new THREE.Mesh(geo, mat));
  }

  updateBehavior(): void {
    // no-op
  }
}

Object.defineProperty(TestGrunt, 'name', { value: 'Grunt' });

class TestUnknown extends BaseEnemy {
  constructor(u = 0.5, v = 0.5) {
    super(u, v, 1, 5, 1, 0.05, 0.2);
    this.mesh = new THREE.Group();
  }

  updateBehavior(): void {
    // no-op
  }
}

Object.defineProperty(TestUnknown, 'name', { value: 'SomeUnknownType' });

describe('EnemyDecoratorSystem', () => {
  let scene: THREE.Scene;
  let system: EnemyDecoratorSystem;

  beforeEach(() => {
    scene = new THREE.Scene();
    system = new EnemyDecoratorSystem(scene);
  });

  it('creates mote and core InstancedMeshes in scene', () => {
    const moteMesh = scene.getObjectByName('enemy-decorator-motes');
    const coreMesh = scene.getObjectByName('enemy-decorator-cores');
    expect(moteMesh).toBeTruthy();
    expect(coreMesh).toBeTruthy();
    expect(moteMesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(coreMesh).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('registers a Wanderer with motes and core', () => {
    const enemy = new TestWanderer();
    system.register(enemy);
    const stats = system.getStats();
    // Wanderer config: 3 motes + 1 core
    expect(stats.activeMotes).toBe(3);
    expect(stats.activeCores).toBe(1);
  });

  it('registers a Grunt with motes and core', () => {
    const enemy = new TestGrunt();
    system.register(enemy);
    const stats = system.getStats();
    // Grunt config: 2 motes + 1 core
    expect(stats.activeMotes).toBe(2);
    expect(stats.activeCores).toBe(1);
  });

  it('does not register an unknown enemy type', () => {
    const enemy = new TestUnknown();
    system.register(enemy);
    const stats = system.getStats();
    expect(stats.activeMotes).toBe(0);
    expect(stats.activeCores).toBe(0);
  });

  it('does not double-register the same enemy', () => {
    const enemy = new TestWanderer();
    system.register(enemy);
    system.register(enemy); // Should be a no-op
    const stats = system.getStats();
    expect(stats.activeMotes).toBe(3);
    expect(stats.activeCores).toBe(1);
  });

  it('unregisters an enemy and frees slots', () => {
    const enemy = new TestWanderer();
    system.register(enemy);
    system.unregister(enemy);
    const stats = system.getStats();
    expect(stats.activeMotes).toBe(0);
    expect(stats.activeCores).toBe(0);
  });

  it('update does not throw with no registered enemies', () => {
    expect(() => system.update(1.0, [])).not.toThrow();
  });

  it('update positions motes around enemy', () => {
    const enemy = new TestWanderer();
    enemy.mesh!.position.set(1, 2, 3);
    enemy.mesh!.updateMatrixWorld(true);
    system.register(enemy);

    system.update(0.5, [enemy]);

    const moteMesh = scene.getObjectByName('enemy-decorator-motes') as THREE.InstancedMesh;
    expect(moteMesh.count).toBeGreaterThan(0);
  });

  it('update auto-frees dead enemy decorators', () => {
    const enemy = new TestWanderer();
    system.register(enemy);

    // Kill the enemy
    enemy.alive = false;
    enemy.active = false;

    system.update(0.5, [enemy]);

    const stats = system.getStats();
    expect(stats.activeMotes).toBe(0);
    expect(stats.activeCores).toBe(0);
  });

  it('handles multiple enemies', () => {
    const w1 = new TestWanderer(0.2, 0.3);
    const w2 = new TestWanderer(0.7, 0.8);
    const g1 = new TestGrunt(0.5, 0.5);

    system.register(w1);
    system.register(w2);
    system.register(g1);

    const stats = system.getStats();
    // 2 wanderers * 3 motes + 1 grunt * 2 motes = 8
    expect(stats.activeMotes).toBe(8);
    // 2 wanderers + 1 grunt = 3 cores
    expect(stats.activeCores).toBe(3);
  });

  it('reports correct draw call count', () => {
    const stats = system.getStats();
    expect(stats.totalDrawCalls).toBe(2); // motes + cores
  });

  it('dispose removes meshes from scene', () => {
    system.dispose();
    const moteMesh = scene.getObjectByName('enemy-decorator-motes');
    const coreMesh = scene.getObjectByName('enemy-decorator-cores');
    expect(moteMesh).toBeUndefined();
    expect(coreMesh).toBeUndefined();
  });
});
