import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createEnemyPreviewObject,
  disposePreviewObject,
  PREVIEW_ENEMY_TYPES,
} from './EnemyPreviewFactory';

describe('EnemyPreviewFactory', () => {
  it('creates a real preview mesh for every known enemy type', () => {
    const missing: string[] = [];
    const created: THREE.Object3D[] = [];

    for (const type of PREVIEW_ENEMY_TYPES) {
      const object = createEnemyPreviewObject(type);
      if (!object) {
        missing.push(type);
      } else {
        created.push(object);
      }
    }

    for (const object of created) {
      disposePreviewObject(object);
    }

    expect(missing).toEqual([]);
    expect(created).toHaveLength(PREVIEW_ENEMY_TYPES.length);
  });

  it('covers the new geometric roster types explicitly', () => {
    expect(PREVIEW_ENEMY_TYPES).toEqual(expect.arrayContaining([
      'prism_lancer',
      'sentinel_orb',
      'shatter_bloom',
    ]));
  });
});
