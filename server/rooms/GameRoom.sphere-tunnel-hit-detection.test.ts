/**
 * Regression test for s44r7-04: Sphere-tunnel player hit detection — dying far from enemies
 *
 * Root cause: surfaceWorldDist() falls back to sphereGreatCircleDist() for 'sphere-tunnel'.
 * But sphere-tunnel UV is an arc-length parameterization of a compound profile (outer sphere +
 * bevel + inner tunnel), NOT a latitude/longitude sphere mapping.
 *
 * Near v=0 or v=1 (the hole-edge seam), sphereGreatCircleDist() treats all u values as
 * coincident (both mapped to the "north pole" / "south pole" of its sphere model). Two entities
 * at v≈0 but opposite u values (u=0 vs u=0.5) are actually ~6 world units apart on the hole
 * edge, but sphereGreatCircleDist reports ~0 distance — triggering ENEMY_HIT_WORLD=0.4.
 *
 * Fix: Implement sphereTunnelChordDist() that mirrors SphereWithTunnelSurface geometry and
 * returns accurate 3D chord distance.
 *
 * Run from main project dir (vitest can't run in worktrees):
 *   cd "/home/antoine/claude code experiments/Geometry Wars"
 *   npx vitest run server/rooms/GameRoom.sphere-tunnel-hit-detection.test.ts
 */

import * as THREE from 'three';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ServerMeshWalker } from '../movement/ServerMeshWalker';
import type { ServerMeshLocation } from '../movement/ServerMeshLocation';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import { EnemyState, GameState, PlayerState } from '../schema/GameState';
import { sphereGreatCircleDist, sphereTunnelChordDist, surfaceUVToWorld3D } from './GameRoom';
import { GameRoom } from './GameRoom';

// ─── Expected geometry constants (must match MP/client standard config) ───
// radius=10, tunnelRadius=3, bevelRadius=0.6, scaleFactor=1.0
// At v≈0 (bottom hole edge): a real ring, NOT a pole.

describe('s44r7-04: sphere-tunnel hit detection — sphereGreatCircleDist gives wrong results', () => {
  /**
   * THE BUG: At v≈0 (hole edge seam), sphereGreatCircleDist() maps to latitude≈0 on its sphere.
   * All u values map to the same "north pole" position → inter-entity distance ≈ 0.
   * But actual sphere-tunnel has a real hole ring of radius ~3.1 — entities at u=0 vs u=0.5
   * are ~6.2 world units apart.
   *
   * This test verifies sphereGreatCircleDist returns a WRONG (too small) distance.
   * It PASSES on current buggy code (confirming the bug exists).
   * After fix, we use sphereTunnelChordDist instead.
   */
  it('BUG: sphereGreatCircleDist returns near-zero for entities at v≈0, u=0 vs u=0.5 (6+ world units apart)', () => {
    // v=0.002 = near hole edge seam. Actual 3D chord ≈ 6.0+ world units (opposite sides of hole ring).
    // sphereGreatCircleDist treats this as latitude ≈ 0.36° from north pole → near-zero.
    const sphereR = 10; // scaleFactor=1
    const dist = sphereGreatCircleDist(0, 0.002, 0.5, 0.002, sphereR);
    // Bug: returns < 0.4 (ENEMY_HIT_WORLD threshold) despite actual distance being ~6 world units
    expect(dist).toBeLessThan(0.4);
  });
});

describe('s44r7-04: sphereTunnelChordDist — accurate 3D chord distance', () => {
  const scaleFactor = 1.0;

  /**
   * REGRESSION TEST: After fix, sphereTunnelChordDist must return accurate distances.
   * This test FAILS on current code (function doesn't exist yet).
   * After fix, this PASSES.
   */

  it('entities at v≈0, u=0 vs u=0.5 should be ~6 world units apart (NOT near-zero)', () => {
    // v=0.002 = near bottom hole edge. Sphere-tunnel hole ring has r≈3.11 at scale 1.
    // Opposite sides of the ring: chord ≈ 2 * 3.11 * sin(π * |Δu|) = 2 * 3.11 ≈ 6.2 units.
    const dist = sphereTunnelChordDist(0, 0.002, 0.5, 0.002, scaleFactor);
    expect(dist).toBeGreaterThan(4.0); // must be much larger than ENEMY_HIT_WORLD=0.4
    expect(dist).toBeLessThan(10.0);   // but still bounded
  });

  it('close entities on outer sphere (v≈0.3, same u, Δv=0.02) are < 2 world units', () => {
    // Small V separation on outer sphere (radius≈8): arc ≈ R * Δv * (2π * totalPerimeter / totalPerimeter)
    // Expected roughly: Δv=0.02 → arc ≈ 0.7 world units
    const dist = sphereTunnelChordDist(0.5, 0.3, 0.5, 0.32, scaleFactor);
    expect(dist).toBeLessThan(2.0);
    expect(dist).toBeGreaterThan(0.0);
  });

  it('player on outer sphere (v=0.29) vs enemy across sphere (v=0.29, Δu=0.5) is ~16 world units', () => {
    // Equator of outer sphere (max radius ≈ 8), opposite sides: chord ≈ 2*8 = 16
    const dist = sphereTunnelChordDist(0.0, 0.29, 0.5, 0.29, scaleFactor);
    expect(dist).toBeGreaterThan(12.0);
    expect(dist).toBeLessThan(20.0);
  });

  it('entity on outer sphere (v=0.29) vs entity in tunnel (v=0.75, same u) is > 5 world units', () => {
    // Outer sphere equator (r≈8, y≈0) vs tunnel (r≈2, y≈0): chord ≈ 6 world units
    const dist = sphereTunnelChordDist(0.0, 0.29, 0.0, 0.75, scaleFactor);
    expect(dist).toBeGreaterThan(3.0);
    expect(dist).toBeLessThan(14.0);
  });

  it('entities close together in tunnel (same u, v=0.75 vs v=0.77) are < 3 world units', () => {
    // Inside tunnel: tiny V change → small world distance
    const dist = sphereTunnelChordDist(0.0, 0.75, 0.0, 0.77, scaleFactor);
    expect(dist).toBeLessThan(3.0);
    expect(dist).toBeGreaterThanOrEqual(0.0);
  });

  it('scaleFactor=1.5 scales distances proportionally', () => {
    const dist1 = sphereTunnelChordDist(0.0, 0.29, 0.5, 0.29, 1.0);
    const dist15 = sphereTunnelChordDist(0.0, 0.29, 0.5, 0.29, 1.5);
    // Should scale linearly with scaleFactor
    expect(dist15 / dist1).toBeCloseTo(1.5, 1);
  });

  it('distance is symmetric', () => {
    const d1 = sphereTunnelChordDist(0.1, 0.3, 0.6, 0.7, scaleFactor);
    const d2 = sphereTunnelChordDist(0.6, 0.7, 0.1, 0.3, scaleFactor);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it('same point returns zero distance', () => {
    const dist = sphereTunnelChordDist(0.3, 0.5, 0.3, 0.5, scaleFactor);
    expect(dist).toBeCloseTo(0, 6);
  });
});

interface ContactRoomInternals {
  surfaceManager: ServerSurfaceManager;
  enemyWalkers: Map<string, ServerMeshWalker>;
  enemyAI: Map<string, Record<string, unknown>>;
  playerInvincibility: Map<string, number>;
  applyWalkerStateToPlayer(player: PlayerState, location: ServerMeshLocation): void;
  applyWalkerStateToEnemy(enemy: EnemyState, location: ServerMeshLocation): void;
  checkCollisions(): void;
  drainInvincibility(dt: number): void;
  spawnSingleEnemy(type: string): boolean;
}

function makeSphereTunnelContactScenario(mode: 'king' | 'waves' | 'pvpve') {
  const room = new GameRoom();
  (room as any).setState(new GameState());
  (room as any).broadcast = vi.fn();
  (room as any).logger = { log: vi.fn() };
  room.state.surfaceType = 'sphere-tunnel';
  room.state.mapSize = 'medium';
  room.state.roomPhase = 'playing';
  room.state.gameStarted = true;
  room.state.gameTime = 3;
  room.state.gameMode = mode === 'pvpve' ? 'waves' : mode;
  room.state.pvpMode = mode === 'pvpve' ? 'pvpve' : '';
  room.state.pvpEnabled = mode === 'pvpve';

  const internals = room as unknown as ContactRoomInternals;
  internals.surfaceManager.initSurface('sphere-tunnel', 1);

  const player = new PlayerState();
  player.id = 'player-1';
  player.name = 'Player 1';
  player.alive = true;
  player.lives = 3;
  player.health = 100;
  player.maxHealth = 100;
  room.state.players.set(player.id, player);

  const playerWalker = internals.surfaceManager.createWalker(player.id, 0.18, 0.29)!;
  const playerLocation = playerWalker.getLocation();
  internals.applyWalkerStateToPlayer(player, playerLocation);

  const enemyWalker = new ServerMeshWalker(
    internals.surfaceManager.getMeshSurface()!,
    new THREE.Vector3(playerLocation.wx, playerLocation.wy, playerLocation.wz),
    1,
  );
  enemyWalker.teleportToLocation(playerLocation);
  enemyWalker.moveInWorldDirection(
    playerLocation.tangentX,
    playerLocation.tangentY,
    playerLocation.tangentZ,
    0.35,
  );

  const enemy = new EnemyState();
  enemy.id = 'enemy-1';
  enemy.type = 'grunt';
  enemy.health = 1;
  enemy.maxHealth = 1;
  internals.enemyWalkers.set(enemy.id, enemyWalker);
  internals.applyWalkerStateToEnemy(enemy, enemyWalker.getLocation());
  internals.enemyAI.set(enemy.id, {});
  room.state.enemies.push(enemy);

  return { room, internals, player, enemy };
}

describe('sphere-tunnel MP nearby-enemy contact health/life semantics', () => {
  it.each(['king', 'waves', 'pvpve'] as const)(
    'uses health damage without spending a life on a nonlethal nearby enemy touch in %s mode',
    (mode) => {
      const { internals, player } = makeSphereTunnelContactScenario(mode);

      internals.checkCollisions();

      expect(player.health).toBe(75);
      expect(player.lives).toBe(3);
      expect(player.alive).toBe(true);
      expect(internals.playerInvincibility.get(player.id)).toBeGreaterThan(0);
    },
  );

  it.each(['pvpve', 'waves'] as const)(
    'applies sustained overlap damage on the shared hurt cadence until a life is lost in %s',
    (mode) => {
      const { internals, player } = makeSphereTunnelContactScenario(mode);

      const hitSamples: Array<{ health: number; lives: number; lifeLost: boolean }> = [];
      (internals as unknown as { broadcast: (type: string, data: Record<string, unknown>) => void }).broadcast = (
        type,
        data,
      ) => {
        if (type !== 'player_hit') return;
        hitSamples.push({
          health: data.healthRemaining as number,
          lives: data.livesRemaining as number,
          lifeLost: data.lifeLost as boolean,
        });
      };

      for (let hit = 0; hit < 4; hit++) {
        internals.checkCollisions();
        internals.checkCollisions();
        internals.drainInvincibility(3.1);
      }

      expect(hitSamples).toEqual([
        { health: 75, lives: 3, lifeLost: false },
        { health: 50, lives: 3, lifeLost: false },
        { health: 25, lives: 3, lifeLost: false },
        { health: 100, lives: 2, lifeLost: true },
      ]);
      expect(player.health).toBe(100);
      expect(player.lives).toBe(2);
      expect(player.alive).toBe(true);
    },
  );
});

describe('sphere-tunnel MP spawn warning/materialization alignment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws the warning ring at the same world position where the enemy materializes', () => {
    const room = new GameRoom();
    (room as any).setState(new GameState());
    room.state.surfaceType = 'sphere-tunnel';
    room.state.mapSize = 'medium';
    room.state.mapSizeScaleFactor = 1;
    room.state.roomPhase = 'playing';
    room.state.gameStarted = true;
    room.state.gameTime = 3;

    const internals = room as unknown as ContactRoomInternals;
    internals.surfaceManager.initSurface('sphere-tunnel', 1);

    const player = new PlayerState();
    player.id = 'player-1';
    player.name = 'Player 1';
    player.alive = true;
    player.surfaceU = 0.18;
    player.surfaceV = 0.29;
    room.state.players.set(player.id, player);
    const playerWalker = internals.surfaceManager.createWalker(player.id, player.surfaceU, player.surfaceV)!;
    internals.applyWalkerStateToPlayer(player, playerWalker.getLocation());
    player.surfaceU = 0.18;
    player.surfaceV = 0.29;

    let warning: { id: string; type: string; u: number; v: number } | null = null;
    (room as any).broadcast = vi.fn((type: string, data: { id: string; type: string; u: number; v: number }) => {
      if (type === 'pre_spawn') warning = { ...data };
    });

    const originalRandom = Math.random;
    try {
      const randomValues = [
        0,    // target player index
        0.10, // spawn angle
        0.50, // spawn distance between MIN_DIST and MAX_DIST
      ];
      Math.random = () => randomValues.shift() ?? 0.5;

      expect(internals.spawnSingleEnemy('grunt')).toBe(true);
    } finally {
      Math.random = originalRandom;
    }

    expect(warning).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(room.state.enemies.length).toBe(1);
    const enemy = room.state.enemies[0]!;
    expect(enemy.id).toBe(warning!.id);

    const [wx, wy, wz] = surfaceUVToWorld3D('sphere-tunnel', warning!.u, warning!.v, 1, 10);
    const warningToEnemyWorld = Math.hypot(enemy.wx - wx, enemy.wy - wy, enemy.wz - wz);
    expect(warningToEnemyWorld).toBeLessThan(0.35);
    expect(enemy.surfaceU).toBeCloseTo(warning!.u, 3);
    expect(enemy.surfaceV).toBeCloseTo(warning!.v, 2);
  });
});
