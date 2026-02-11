import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EnemySurfaceGlow } from './EnemySurfaceGlow';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { Wanderer } from '../entities/enemies/Wanderer';
import { Boss } from '../entities/enemies/Boss';

describe('EnemySurfaceGlow', () => {
  let scene: THREE.Scene;
  let glow: EnemySurfaceGlow;

  beforeEach(() => {
    scene = new THREE.Scene();
    glow = new EnemySurfaceGlow(scene);
  });

  it('should create an InstancedMesh with additive blending', () => {
    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh | undefined;

    expect(instancedMesh).toBeDefined();
    expect(instancedMesh?.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    const mat = instancedMesh!.material as THREE.MeshBasicMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it('should have CircleGeometry with 16 segments', () => {
    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh | undefined;

    expect(instancedMesh?.geometry).toBeInstanceOf(THREE.CircleGeometry);
    const geo = instancedMesh!.geometry as THREE.CircleGeometry;
    expect(geo.parameters.segments).toBe(16);
  });

  it('should start with zero active instances', () => {
    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh | undefined;

    expect(instancedMesh?.count).toBe(0);
  });

  it('should update glow instances for active enemies', () => {
    const enemy1 = new Wanderer(0.3, 0.4);
    enemy1.active = true;
    enemy1.alive = true;
    enemy1.mesh = new THREE.Group();
    enemy1.mesh.position.set(1, 2, 3);
    enemy1.mesh.up.set(0, 1, 0);
    enemy1.mesh.updateWorldMatrix(false, false);

    const enemy2 = new Wanderer(0.6, 0.7);
    enemy2.active = true;
    enemy2.alive = true;
    enemy2.mesh = new THREE.Group();
    enemy2.mesh.position.set(4, 5, 6);
    enemy2.mesh.up.set(0, 0, 1);
    enemy2.mesh.updateWorldMatrix(false, false);

    glow.update([enemy1, enemy2]);

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    expect(instancedMesh.count).toBeGreaterThan(0);

    // Check that instance matrices are set (not zero-scale)
    const matrix = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix);
    const scale = new THREE.Vector3();
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.length()).toBeGreaterThan(0);
  });

  it('should skip inactive enemies', () => {
    const enemy1 = new Wanderer(0.3, 0.4);
    enemy1.active = false; // Inactive
    enemy1.alive = true;
    enemy1.mesh = new THREE.Group();

    const enemy2 = new Wanderer(0.6, 0.7);
    enemy2.active = true;
    enemy2.alive = false; // Dead
    enemy2.mesh = new THREE.Group();

    glow.update([enemy1, enemy2]);

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    expect(instancedMesh.count).toBe(0);
  });

  it('should skip materializing enemies', () => {
    const enemy = new Wanderer(0.3, 0.4);
    enemy.active = true;
    enemy.alive = true;
    enemy.isMaterializing = true; // Spawn warning in progress
    enemy.mesh = new THREE.Group();

    glow.update([enemy]);

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    expect(instancedMesh.count).toBe(0);
  });

  it('should scale glow based on enemy radius', () => {
    const smallEnemy = new Wanderer(0.3, 0.4);
    smallEnemy.active = true;
    smallEnemy.alive = true;
    smallEnemy.radius = 0.5;
    smallEnemy.mesh = new THREE.Group();
    smallEnemy.mesh.position.set(1, 0, 0);
    smallEnemy.mesh.up.set(0, 1, 0);
    smallEnemy.mesh.updateWorldMatrix(false, false);

    const bigEnemy = new Boss('sapphire', 0.6, 0.7);
    bigEnemy.active = true;
    bigEnemy.alive = true;
    bigEnemy.radius = 2.0;
    bigEnemy.mesh = new THREE.Group();
    bigEnemy.mesh.position.set(5, 0, 0);
    bigEnemy.mesh.up.set(0, 1, 0);
    bigEnemy.mesh.updateWorldMatrix(false, false);

    glow.update([smallEnemy, bigEnemy]);

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    const matrix1 = new THREE.Matrix4();
    const matrix2 = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix1);
    instancedMesh.getMatrixAt(1, matrix2);

    const scale1 = new THREE.Vector3();
    const scale2 = new THREE.Vector3();
    matrix1.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale1);
    matrix2.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale2);

    // Boss should have bigger glow
    expect(scale2.x).toBeGreaterThan(scale1.x);
  });

  it('should apply intensity setting to opacity', () => {
    glow.setIntensity(0.3);

    const enemy = new Wanderer(0.3, 0.4);
    enemy.active = true;
    enemy.alive = true;
    enemy.mesh = new THREE.Group();
    enemy.mesh.position.set(1, 0, 0);
    enemy.mesh.up.set(0, 1, 0);
    enemy.mesh.updateWorldMatrix(false, false);

    glow.update([enemy]);

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    const opacityAttr = instancedMesh.geometry.getAttribute('instanceOpacity') as THREE.InstancedBufferAttribute;
    expect(opacityAttr.getX(0)).toBeCloseTo(0.3, 2);
  });

  it('should clamp intensity to 0-1 range', () => {
    glow.setIntensity(-0.5);
    expect(glow.getIntensity()).toBe(0);

    glow.setIntensity(1.5);
    expect(glow.getIntensity()).toBe(1);

    glow.setIntensity(0.7);
    expect(glow.getIntensity()).toBe(0.7);
  });

  it('should have per-instance opacity attribute', () => {
    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    const opacityAttr = instancedMesh.geometry.getAttribute('instanceOpacity');
    expect(opacityAttr).toBeDefined();
    expect(opacityAttr).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(opacityAttr.itemSize).toBe(1);
  });

  it('should position glows slightly above the surface', () => {
    const enemy = new Wanderer(0.3, 0.4);
    enemy.active = true;
    enemy.alive = true;
    enemy.mesh = new THREE.Group();
    enemy.mesh.position.set(0, 0, 0);
    enemy.mesh.up.set(0, 1, 0); // Normal pointing up
    enemy.mesh.updateWorldMatrix(false, false);

    glow.update([enemy]);

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    const matrix = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix);
    const position = new THREE.Vector3();
    matrix.decompose(position, new THREE.Quaternion(), new THREE.Vector3());

    // Should be offset slightly in the direction of the normal (up)
    expect(position.y).toBeGreaterThan(0);
    expect(position.y).toBeCloseTo(0.02, 2);
  });

  it('should dispose resources correctly', () => {
    const initialChildren = scene.children.length;
    glow.dispose();
    expect(scene.children.length).toBe(initialChildren - 1);
  });

  it('should handle enemies without meshes gracefully', () => {
    const enemy = new Wanderer(0.3, 0.4);
    enemy.active = true;
    enemy.alive = true;
    enemy.mesh = null; // No mesh

    expect(() => glow.update([enemy])).not.toThrow();

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    expect(instancedMesh.count).toBe(0);
  });

  it('should extract enemy color from material', () => {
    const enemy = new Wanderer(0.3, 0.4);
    enemy.active = true;
    enemy.alive = true;
    enemy.mesh = new THREE.Group();

    const childMesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({
        emissive: new THREE.Color(0xff0000), // Red emissive
      })
    );
    enemy.mesh.add(childMesh);
    enemy.mesh.position.set(1, 0, 0);
    enemy.mesh.up.set(0, 1, 0);
    enemy.mesh.updateWorldMatrix(false, false);

    glow.update([enemy]);

    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    const color = new THREE.Color();
    instancedMesh.getColorAt(0, color);

    // Should be red (or close to it)
    expect(color.r).toBeGreaterThan(0.8);
  });

  it('should reuse slots across frames', () => {
    const enemy = new Wanderer(0.3, 0.4);
    enemy.active = true;
    enemy.alive = true;
    enemy.mesh = new THREE.Group();
    enemy.mesh.position.set(1, 0, 0);
    enemy.mesh.up.set(0, 1, 0);
    enemy.mesh.updateWorldMatrix(false, false);

    glow.update([enemy]);
    const instancedMesh = scene.children.find(
      (child) => child instanceof THREE.InstancedMesh && child.name === 'enemy-surface-glows'
    ) as THREE.InstancedMesh;

    const matrix1 = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix1);

    // Update again with same enemy
    enemy.mesh.position.set(2, 0, 0);
    enemy.mesh.updateWorldMatrix(false, false);
    glow.update([enemy]);

    const matrix2 = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix2);

    const pos1 = new THREE.Vector3();
    const pos2 = new THREE.Vector3();
    matrix1.decompose(pos1, new THREE.Quaternion(), new THREE.Vector3());
    matrix2.decompose(pos2, new THREE.Quaternion(), new THREE.Vector3());

    // Position should have changed (enemy moved)
    expect(pos2.x).not.toBeCloseTo(pos1.x, 2);
  });
});
