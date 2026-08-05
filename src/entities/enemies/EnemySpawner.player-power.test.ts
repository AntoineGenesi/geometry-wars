import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computePlayerPower } from '../../shared/PlayerPowerModel';
import { EnemySpawner, type EnemyType } from './EnemySpawner';

function makeSpawner(): EnemySpawner {
  return new EnemySpawner(new THREE.Scene(), (u: number, v: number) => ({
    position: new THREE.Vector3(u, v, 0),
    normal: new THREE.Vector3(0, 0, 1),
    tangent: new THREE.Vector3(1, 0, 0),
    bitangent: new THREE.Vector3(0, 1, 0),
  }));
}

function spawnedHealth(spawner: EnemySpawner, type: EnemyType): number {
  return spawner.spawn(type, 0.75, 0.75, 0, true).health;
}

describe('EnemySpawner player-power HP scaling', () => {
  it('does not ceil near-neutral dominance into integer HP increases', () => {
    const spawner = makeSpawner();
    const nearNeutralPower = {
      ...computePlayerPower(),
      difficultyBonus: 0.001,
      hpMultiplier: 1.00025,
    };

    spawner.setDDAPlayerPower(nearNeutralPower);

    expect(spawnedHealth(spawner, 'virus')).toBe(1);
    expect(spawnedHealth(spawner, 'wanderer')).toBe(2);
    expect(spawnedHealth(spawner, 'painter')).toBe(3);
  });

  it('keeps struggling live player-power samples at base enemy HP', () => {
    const spawner = makeSpawner();
    spawner.setDDAPlayerPower(computePlayerPower({
      score: 1_000,
      survivalSeconds: 5,
      streak: 0,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
    }));

    expect(spawnedHealth(spawner, 'virus')).toBe(1);
    expect(spawnedHealth(spawner, 'wanderer')).toBe(2);
    expect(spawnedHealth(spawner, 'painter')).toBe(3);
  });
});
