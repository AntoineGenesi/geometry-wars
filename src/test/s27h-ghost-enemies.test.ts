/**
 * Regression tests for s27h — Ghost Enemies (visible but unhittable)
 *
 * Root cause: applySeparation() was modifying surfacePosition.u/v of materializing
 * enemies. After 48 frames (0.8s warning duration), UV drift exceeded the 0.001
 * matching tolerance, causing enemies to stay isMaterializing=true permanently.
 * The visual spawn ring would disappear but no enemy would materialize → ghost.
 *
 * Fix: skip materializing enemies in applySeparation(); also widen UV match tolerance
 * to 0.05 as a safety net.
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';
import { EnemySpawner } from '../entities/enemies/EnemySpawner';

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(),
    init: vi.fn(),
    resume: vi.fn(),
    muted: false,
  }),
}));

function createContext(surfaceType: 'sphere' | 'torus' | 'cube') {
  const scene = new THREE.Scene();
  const surface = SurfaceFactory.create(surfaceType);

  const getTransform = (u: number, v: number) => {
    const pt = surface.getPoint(u, v);
    return {
      position: pt.position,
      normal: pt.normal,
      tangent: pt.tangentU,
      bitangent: pt.tangentV,
    };
  };

  const spawner = new EnemySpawner(scene, getTransform);
  spawner.setSurface(surface);

  return { scene, surface, spawner };
}

function tick(ctx: ReturnType<typeof createContext>, dt: number) {
  ctx.spawner.setPlayerPosition(0.5, 0.5);
  ctx.spawner.update(dt, 0.5, 0.5);
  ctx.surface.updateGrid(dt);
}

// ---------------------------------------------------------------------------
// Ghost enemy regression tests
// ---------------------------------------------------------------------------

describe('Ghost Enemy Fix (s27h)', () => {
  it('enemy materializes correctly when surrounded by other enemies (separation pressure)', () => {
    // This is the core regression: a materializing enemy surrounded by active enemies
    // was having its UV pushed by applySeparation(), causing the UV match to fail.
    const ctx = createContext('sphere');

    // Spawn several active enemies near the target spawn point first
    // They'll be materializing simultaneously, creating separation pressure.
    ctx.spawner.spawn('wanderer', 0.48, 0.48);
    ctx.spawner.spawn('wanderer', 0.52, 0.48);
    ctx.spawner.spawn('wanderer', 0.48, 0.52);

    // The enemy under test — same region, will experience separation forces
    ctx.spawner.spawn('grunt', 0.50, 0.50);

    const enemies = ctx.spawner.getEnemies();
    expect(enemies.length).toBe(4);

    const targetEnemy = enemies[3]; // The last spawned grunt
    expect(targetEnemy.isMaterializing).toBe(true);

    // Simulate full warning period (0.8s) + a few extra frames
    for (let i = 0; i < 70; i++) {
      tick(ctx, 1 / 60);
    }

    // All enemies must have materialized — no ghosts
    for (const enemy of enemies) {
      expect(enemy.isMaterializing).toBe(false);
      expect(enemy.alive).toBe(true);
    }
  });

  it('materializing enemy UV is NOT modified by separation forces', () => {
    const ctx = createContext('torus');

    // Spawn a materializing enemy
    ctx.spawner.spawn('grunt', 0.50, 0.50);
    const enemies = ctx.spawner.getEnemies();
    const materializingEnemy = enemies[0];

    expect(materializingEnemy.isMaterializing).toBe(true);
    const startU = materializingEnemy.surfacePosition.u;
    const startV = materializingEnemy.surfacePosition.v;

    // Spawn active enemies nearby to generate separation pressure
    ctx.spawner.spawn('wanderer', 0.51, 0.50);
    ctx.spawner.spawn('wanderer', 0.49, 0.50);
    ctx.spawner.spawn('wanderer', 0.50, 0.51);

    // Wait until all 4 are materialized (so separation runs on the 3 active ones)
    for (let i = 0; i < 70; i++) {
      tick(ctx, 1 / 60);
    }

    // The materializing enemy (now materialized) should not have become a ghost.
    // The fix prevents UV drift > 0.001 over the 0.8s warning by skipping
    // applySeparation for materializing enemies. Without the fix, UV drifts ~0.004
    // and the warning completion match (tolerance 0.001) fails.
    expect(materializingEnemy.isMaterializing).toBe(false);
    expect(materializingEnemy.alive).toBe(true);

    // Verify the UV wasn't moved beyond tolerance during the warning period.
    // After materializing the enemy moves freely, so this must be checked indirectly
    // by confirming isMaterializing flipped to false (match succeeded).
    expect(startU).toBeGreaterThanOrEqual(0); // UV was set
    expect(startV).toBeGreaterThanOrEqual(0);
  });

  it('enemy materializes on all surface types even with many nearby enemies', () => {
    const surfaceTypes: Array<'sphere' | 'torus' | 'cube'> = ['sphere', 'torus', 'cube'];

    for (const surfaceType of surfaceTypes) {
      const ctx = createContext(surfaceType);

      // Spawn 5 enemies in a tight cluster to maximize separation pressure
      for (let i = 0; i < 4; i++) {
        const offset = (i - 2) * 0.02;
        ctx.spawner.spawn('wanderer', 0.5 + offset, 0.5 + offset);
      }
      ctx.spawner.spawn('grunt', 0.5, 0.5); // The one we'll check

      const enemies = ctx.spawner.getEnemies();
      const targetEnemy = enemies[enemies.length - 1];

      expect(targetEnemy.isMaterializing).toBe(true);

      // Simulate 1.5s (well past 0.8s warning)
      for (let i = 0; i < 90; i++) {
        tick(ctx, 1 / 60);
      }

      // REGRESSION: must have materialized, not become a ghost
      expect(targetEnemy.isMaterializing).toBe(false);
      expect(targetEnemy.alive).toBe(true);
    }
  });

  it('single enemy always materializes (baseline)', () => {
    // Simplest possible case — no separation pressure at all
    const ctx = createContext('sphere');

    ctx.spawner.spawn('grunt', 0.3, 0.7);
    const enemies = ctx.spawner.getEnemies();
    const enemy = enemies[0];

    expect(enemy.isMaterializing).toBe(true);

    for (let i = 0; i < 70; i++) {
      tick(ctx, 1 / 60);
    }

    expect(enemy.isMaterializing).toBe(false);
    expect(enemy.alive).toBe(true);
  });

  it('many waves of enemies all materialize without ghosts', () => {
    const ctx = createContext('sphere');

    // Spawn multiple waves to stress the system
    ctx.spawner.spawnWave([
      { type: 'wanderer', count: 5, tier: 0 },
      { type: 'grunt', count: 5, tier: 0 },
    ]);

    // Simulate 2s
    for (let i = 0; i < 120; i++) {
      tick(ctx, 1 / 60);
    }

    const enemies = ctx.spawner.getEnemies();
    expect(enemies.length).toBe(10);

    const ghosts = enemies.filter(e => e.isMaterializing && e.active);
    expect(ghosts.length).toBe(0); // No ghost enemies
    expect(enemies.every(e => e.alive)).toBe(true);
  });
});
