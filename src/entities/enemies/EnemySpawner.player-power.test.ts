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

function baselineHealth(type: EnemyType, tier: number = 0): number {
  return makeSpawner().spawn(type, 0.75, 0.75, tier, true).health;
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

  it('does not turn basic/common SP fodder into hidden HP sponges under high player power', () => {
    const spawner = makeSpawner();
    const highPower = computePlayerPower({
      rawScore: 5_000_000,
      survivalSeconds: 600,
      streak: 250,
      totalKills: 800,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
      activeWeapon: { damage: 4, shotsPerSecond: 8, projectilesPerShot: 2, multiHitPotential: 2 },
      companions: { guardian: 4, hunter: 4 },
    });
    expect(highPower.hpMultiplier).toBeGreaterThan(1.5);
    spawner.setDDAPlayerPower(highPower);

    const commonFodder: EnemyType[] = [
      'grunt',
      'wanderer',
      'duck',
      'mayfly',
      'rocket',
      'neutron',
      'weaver',
      'spinner',
      'approach_glow',
    ];

    for (const type of commonFodder) {
      expect(spawnedHealth(spawner, type), `${type} should keep baseline HP`).toBe(baselineHealth(type));
    }
  });

  it('keeps visible tier variants from receiving extra hidden player-power HP', () => {
    const spawner = makeSpawner();
    spawner.setDDAPlayerPower(computePlayerPower({
      rawScore: 5_000_000,
      survivalSeconds: 600,
      streak: 250,
      totalKills: 800,
      activeWeapon: { damage: 4, shotsPerSecond: 8, projectilesPerShot: 2, multiHitPotential: 2 },
    }));

    expect(spawner.spawn('grunt', 0.75, 0.75, 2, true).health).toBe(baselineHealth('grunt', 2));
    expect(spawner.spawn('duck', 0.75, 0.75, 3, true).health).toBe(baselineHealth('duck', 3));
  });
});
