import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Phaser } from '../entities/enemies/Phaser';
import { applyNonInstancedEnemyVisibility } from './EnemyMaterialVisibility';

describe('applyNonInstancedEnemyVisibility', () => {
  it('applies the final resolver class visibility to a regular non-instanceable Phaser', () => {
    const enemy = new Phaser(0.5, 0.5);
    enemy.cachedMaterials = [];
    enemy.mesh?.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        enemy.cachedMaterials!.push(...materials as THREE.MeshStandardMaterial[]);
      }
    });

    expect(enemy.isInstanced).toBe(false);
    expect(enemy.cachedMaterials.length).toBeGreaterThan(0);
    expect(applyNonInstancedEnemyVisibility(enemy, 0.06)).toBe(enemy.cachedMaterials.length);
    for (const material of enemy.cachedMaterials) {
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeCloseTo(0.06);
    }
  });

  it('falls back to traversing uncached mesh materials and clamps invalid input', () => {
    const material = new THREE.MeshBasicMaterial({ opacity: 0.4 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const enemy = { mesh, cachedMaterials: null };

    expect(applyNonInstancedEnemyVisibility(enemy, -2)).toBe(1);
    expect(material.opacity).toBe(0);
    expect(applyNonInstancedEnemyVisibility(enemy, Number.NaN)).toBe(1);
    expect(material.opacity).toBe(1);
  });

  it('preserves explicit zero for intentionally hidden enemies', () => {
    const material = new THREE.MeshBasicMaterial({ opacity: 1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    expect(applyNonInstancedEnemyVisibility({ mesh, cachedMaterials: [material] }, 0)).toBe(1);
    expect(material.opacity).toBe(0);
  });

  it('also applies visibility to line materials that are not in cached mesh materials', () => {
    const meshMaterial = new THREE.MeshBasicMaterial({ opacity: 1 });
    const lineMaterial = new THREE.LineBasicMaterial({ opacity: 1 });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), meshMaterial));
    group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]),
      lineMaterial,
    ));

    expect(applyNonInstancedEnemyVisibility({
      mesh: group,
      cachedMaterials: [meshMaterial],
    }, 0.25)).toBe(2);
    expect(meshMaterial.opacity).toBeCloseTo(0.25);
    expect(lineMaterial.transparent).toBe(true);
    expect(lineMaterial.opacity).toBeCloseTo(0.25);
  });
});
