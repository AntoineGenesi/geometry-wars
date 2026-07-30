import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnemySpawner } from './EnemySpawner';
import { PrismLancer } from './PrismLancer';
import { SentinelOrb } from './SentinelOrb';
import { ShatterBloom } from './ShatterBloom';
import { generateScaledEndlessWave } from '../../core/DifficultyScaling';

const transform = {
  position: new THREE.Vector3(0, 0, 0),
  normal: new THREE.Vector3(0, 1, 0),
  tangent: new THREE.Vector3(1, 0, 0),
  bitangent: new THREE.Vector3(0, 0, 1),
};

const getTransform = () => transform;

describe('new geometric enemy roster', () => {
  afterEach(() => {
    ShatterBloom.onBloomDeath = null;
  });

  it('constructs three distinct real enemy bodies with unique stats', () => {
    const enemies = [
      new PrismLancer(0.2, 0.3),
      new SentinelOrb(0.3, 0.4),
      new ShatterBloom(0.4, 0.5),
    ];

    expect(enemies.map((enemy) => enemy.baseTypeName)).toEqual([
      'prism_lancer',
      'sentinel_orb',
      'shatter_bloom',
    ]);
    expect(new Set(enemies.map((enemy) => enemy.health)).size).toBe(3);
    expect(new Set(enemies.map((enemy) => enemy.scoreValue)).size).toBe(3);
    expect(new Set(enemies.map((enemy) => enemy.speed)).size).toBe(3);
    expect(new Set(enemies.map((enemy) => enemy.radius)).size).toBe(3);
    for (const enemy of enemies) {
      expect(enemy.mesh).toBeInstanceOf(THREE.Group);
      expect(enemy.mesh!.children.length).toBeGreaterThan(1);
      enemy.destroy();
    }
  });

  it('EnemySpawner creates the new types as active non-decorative entities', () => {
    const scene = new THREE.Scene();
    const spawner = new EnemySpawner(scene, getTransform);

    const prism = spawner.spawn('prism_lancer', 0.2, 0.2, 0, true);
    const sentinel = spawner.spawn('sentinel_orb', 0.3, 0.3, 0, true);
    const bloom = spawner.spawn('shatter_bloom', 0.4, 0.4, 0, true);

    expect(spawner.getEnemies().map((enemy) => enemy.baseTypeName)).toEqual([
      'prism_lancer',
      'sentinel_orb',
      'shatter_bloom',
    ]);
    expect(prism.active).toBe(true);
    expect(sentinel.active).toBe(true);
    expect(bloom.active).toBe(true);
    spawner.clear();
  });

  it('prism lancer strafes before committing to a charge lane', () => {
    const prism = new PrismLancer(0.4, 0.5);
    const start = { ...prism.surfacePosition };

    prism.updateBehavior(0.25, 0.8, 0.5);
    const afterStrafe = { ...prism.surfacePosition };
    prism.updateBehavior(0.7, 0.8, 0.5);
    prism.updateBehavior(0.2, 0.8, 0.5);

    expect(afterStrafe.v).not.toBeCloseTo(start.v, 4);
    expect(prism.surfacePosition.u).toBeGreaterThan(afterStrafe.u);
    prism.destroy();
  });

  it('shatter bloom invokes the shared death-spawn callback exactly once', () => {
    const bloom = new ShatterBloom(0.45, 0.55);
    const callback = vi.fn();
    ShatterBloom.onBloomDeath = callback;

    bloom.takeDamage(bloom.health);
    bloom.die();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(0.45, 0.55, 3);
  });

  it('EnemySpawner releases shatter-bloom shards as real grunt enemies', () => {
    const scene = new THREE.Scene();
    const spawner = new EnemySpawner(scene, getTransform);

    const released = spawner.releaseShatterBloomShards(0.5, 0.5, 3);

    expect(released).toHaveLength(3);
    expect(released.every((enemy) => enemy.baseTypeName === 'grunt')).toBe(true);
    expect(released.every((enemy) => enemy.active && enemy.health === 1)).toBe(true);
    spawner.clear();
  });

  it('scaled SP endless waves include all three new roster types', () => {
    const seen = new Set<string>();
    for (let wave = 1; wave <= 32; wave++) {
      for (const entry of generateScaledEndlessWave(wave, 8, 0, 1)) {
        seen.add(entry.type);
      }
    }

    expect(seen.has('prism_lancer')).toBe(true);
    expect(seen.has('sentinel_orb')).toBe(true);
    expect(seen.has('shatter_bloom')).toBe(true);
  });
});

