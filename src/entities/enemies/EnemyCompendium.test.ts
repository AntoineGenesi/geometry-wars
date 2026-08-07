import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ENEMY_COMPENDIUM,
  ENEMY_COMPENDIUM_ENTRIES,
  maskEnemyDescription,
  normalizeEnemyCompendiumType,
} from './EnemyCompendium';
import { ENEMY_TYPES, EnemySpawner } from './EnemySpawner';

describe('EnemyCompendium', () => {
  it('covers every canonical enemy type exactly once', () => {
    expect(ENEMY_COMPENDIUM_ENTRIES.map((entry) => entry.type)).toEqual(ENEMY_TYPES);
    for (const type of ENEMY_TYPES) {
      expect(ENEMY_COMPENDIUM[type].displayName).toBeTruthy();
      expect(ENEMY_COMPENDIUM[type].previewType).toBe(type);
      expect(ENEMY_COMPENDIUM[type].attackDescription.length).toBeGreaterThan(24);
    }
  });

  it('normalizes server aliases to canonical compendium keys', () => {
    expect(normalizeEnemyCompendiumType('blackhole')).toBe('gravity_well');
    expect(normalizeEnemyCompendiumType('arrow')).toBe('grunt');
    expect(normalizeEnemyCompendiumType('proton')).toBe('neutron');
    expect(normalizeEnemyCompendiumType('Prism Lancer')).toBe('prism_lancer');
    expect(normalizeEnemyCompendiumType('not-real')).toBeNull();
  });

  it('masks locked descriptions without leaking readable words', () => {
    const description = ENEMY_COMPENDIUM.prism_lancer.attackDescription;
    const masked = maskEnemyDescription(description);
    expect(masked).toHaveLength(description.length);
    expect(masked).not.toContain('piercing');
    expect(masked).not.toContain('lance');
    expect(masked.replace(/[ ?#.,;:!?'-]/g, '')).toBe('');
  });

  it('observes successful spawner creation but not inactive cap dummies', () => {
    const spawner = new EnemySpawner(new THREE.Scene(), () => ({
      position: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      tangent: new THREE.Vector3(1, 0, 0),
      bitangent: new THREE.Vector3(0, 1, 0),
    }));
    const seen: string[] = [];
    spawner.setEnemyCreatedCallback((type) => seen.push(type));

    spawner.spawn('grunt', 0.5, 0.5, 0, true);
    expect(seen).toEqual(['grunt']);

    spawner.setMaxActiveEnemies(1);
    const dummy = spawner.spawn('rocket', 0.6, 0.6, 0, true);
    expect(dummy.active).toBe(false);
    expect(seen).toEqual(['grunt']);
    spawner.clear();
  });
});
