import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_SETTINGS } from '../shared/GameSettings';
import { ServerMeshPathfinder } from '../movement/ServerMeshPathfinder';
import type { ServerMeshLocation } from '../movement/ServerMeshLocation';
import { ServerMeshWalker } from '../movement/ServerMeshWalker';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import {
  BlackHoleFieldState,
  EnemyState,
  GameState,
  PlayerState,
} from '../schema/GameState';
import { GameRoom } from './GameRoom';

interface BlackHoleRoomInternals {
  surfaceManager: ServerSurfaceManager;
  enemyWalkers: Map<string, ServerMeshWalker>;
  enemyPathfinder: ServerMeshPathfinder | null;
  enemyAI: Map<string, Record<string, unknown>>;
  applyWalkerStateToPlayer(player: PlayerState, location: ServerMeshLocation): void;
  applyWalkerStateToEnemy(enemy: EnemyState, location: ServerMeshLocation): void;
  tryShoot(player: PlayerState): void;
  fireBlackHoleMP(player: PlayerState): void;
  updateBlackHoleFields(dt: number): void;
  removeBlackHoleFieldsOwnedBy(ownerId: string): void;
  startGame(): void;
  softRestartRound(settings: typeof DEFAULT_GAME_SETTINGS): void;
  transitionToVoting(): void;
}

function fieldLocation(field: BlackHoleFieldState): ServerMeshLocation {
  return {
    faceIndex: field.walkerFaceIndex,
    baryU: field.walkerBaryU,
    baryV: field.walkerBaryV,
    baryW: field.walkerBaryW,
    wx: field.wx, wy: field.wy, wz: field.wz,
    nx: field.nx, ny: field.ny, nz: field.nz,
    tangentX: field.tx, tangentY: field.ty, tangentZ: field.tz,
    bitangentX: field.bx, bitangentY: field.by, bitangentZ: field.bz,
  };
}

function makeRoom(): {
  room: GameRoom;
  internals: BlackHoleRoomInternals;
  player: PlayerState;
  pathfinder: ServerMeshPathfinder;
} {
  const room = new GameRoom();
  (room as any).setState(new GameState());
  (room as any).setMetadata = vi.fn();
  (room as any).broadcast = vi.fn();
  (room as any).logger = { log: vi.fn() };
  room.state.surfaceType = 'cube';
  room.state.mapSize = 'medium';
  room.state.roomPhase = 'playing';
  room.state.gameStarted = true;
  room.state.gameTime = 1;

  const internals = room as unknown as BlackHoleRoomInternals;
  internals.surfaceManager.initSurface('cube', 1);
  const meshSurface = internals.surfaceManager.getMeshSurface()!;
  const pathfinder = new ServerMeshPathfinder(meshSurface);
  internals.enemyPathfinder = pathfinder;

  const player = new PlayerState();
  player.id = 'owner';
  player.name = 'Owner';
  player.weaponType = 'black_hole';
  player.weaponAmmo = 5;
  player.aimAngle = 0;
  room.state.players.set(player.id, player);
  const playerWalker = internals.surfaceManager.createWalker(player.id, 0.5, 0.5)!;
  internals.applyWalkerStateToPlayer(player, playerWalker.getLocation());
  (player as unknown as { lastBlasterShotTime: number }).lastBlasterShotTime = room.state.gameTime;
  (player as unknown as { lastShotTime: number }).lastShotTime = -Infinity;

  return { room, internals, player, pathfinder };
}

function addEnemyNearField(
  room: GameRoom,
  internals: BlackHoleRoomInternals,
  field: BlackHoleFieldState,
  distance: number,
  health: number,
): EnemyState {
  const surface = internals.surfaceManager.getMeshSurface()!;
  const location = fieldLocation(field);
  const walker = new ServerMeshWalker(
    surface,
    new THREE.Vector3(location.wx, location.wy, location.wz),
    1,
  );
  walker.teleportToLocation(location);
  walker.speed = 1;
  walker.moveInWorldDirection(location.bitangentX, location.bitangentY, location.bitangentZ, distance);

  const enemy = new EnemyState();
  enemy.id = `target-${room.state.enemies.length}`;
  enemy.type = 'grunt';
  enemy.health = health;
  enemy.maxHealth = health;
  internals.enemyWalkers.set(enemy.id, walker);
  internals.applyWalkerStateToEnemy(enemy, walker.getLocation());
  internals.enemyAI.set(enemy.id, {});
  room.state.enemies.push(enemy);
  return enemy;
}

function pathDistanceToField(
  enemy: EnemyState,
  field: BlackHoleFieldState,
  pathfinder: ServerMeshPathfinder,
): number {
  return pathfinder.getPathDistance({
    faceIndex: enemy.walkerFaceIndex,
    wx: enemy.wx,
    wy: enemy.wy,
    wz: enemy.wz,
  }, {
    faceIndex: field.walkerFaceIndex,
    wx: field.wx,
    wy: field.wy,
    wz: field.wz,
  });
}

const rooms: GameRoom[] = [];

afterEach(() => {
  for (const room of rooms.splice(0)) {
    (room as unknown as BlackHoleRoomInternals).surfaceManager.dispose();
  }
  vi.restoreAllMocks();
});

describe('GameRoom authoritative Black Hole vortex', () => {
  it('defines synchronized owner, canonical frame, lifetime, radius, and phase state', () => {
    const state = new GameState();
    const field = new BlackHoleFieldState();
    state.blackHoleFields.push(field);

    expect(state.blackHoleFields).toHaveLength(1);
    expect(field).toMatchObject({
      ownerId: '',
      walkerFaceIndex: 0,
      walkerBaryU: 1,
      walkerBaryV: 0,
      walkerBaryW: 0,
      age: 0,
      duration: 0,
      radius: 0,
      phase: 'formation',
    });
  });

  it('routes black_hole away from bullets and places one stationary canonical field', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);

    scenario.internals.tryShoot(scenario.player);

    expect(scenario.room.state.bullets).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(1);
    const field = scenario.room.state.blackHoleFields[0];
    const center = [field.wx, field.wy, field.wz];
    expect(field.ownerId).toBe(scenario.player.id);
    expect(field.duration).toBe(3);
    expect(field.walkerBaryU + field.walkerBaryV + field.walkerBaryW).toBeCloseTo(1, 5);

    for (let i = 0; i < 60; i++) scenario.internals.updateBlackHoleFields(1 / 60);
    expect([field.wx, field.wy, field.wz]).toEqual(center);
    expect(field.phase).toBe('sustain');
    expect(field.radius).toBeCloseTo(5, 5);
  });

  it('pulls a ServerMeshWalker toward the field and applies timed owner kill/score attribution', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    scenario.internals.fireBlackHoleMP(scenario.player);
    const field = scenario.room.state.blackHoleFields[0];
    const durableEnemy = addEnemyNearField(scenario.room, scenario.internals, field, 1.5, 100);
    const startDistance = pathDistanceToField(durableEnemy, field, scenario.pathfinder);

    for (let i = 0; i < 60; i++) scenario.internals.updateBlackHoleFields(1 / 60);

    expect(pathDistanceToField(durableEnemy, field, scenario.pathfinder)).toBeLessThan(startDistance - 0.5);
    expect(durableEnemy.health).toBeLessThan(100);

    const fragileEnemy = addEnemyNearField(scenario.room, scenario.internals, field, 2, 0.5);
    const scoreBefore = scenario.player.score;
    for (let i = 0; i < 15; i++) scenario.internals.updateBlackHoleFields(1 / 60);

    expect(scenario.room.state.enemies.some((enemy) => enemy.id === fragileEnemy.id)).toBe(false);
    expect(scenario.player.enemyKills).toBe(1);
    expect(scenario.player.playerKills).toBe(1);
    expect(scenario.player.score).toBeGreaterThan(scoreBefore);
  });

  it('applies collapse once, expires, and clears fields on every server lifecycle path', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);
    scenario.internals.fireBlackHoleMP(scenario.player);
    const field = scenario.room.state.blackHoleFields[0];
    const enemy = addEnemyNearField(scenario.room, scenario.internals, field, 2, 20);

    for (let i = 0; i < 180; i++) scenario.internals.updateBlackHoleFields(1 / 60);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);
    expect(enemy.health).toBeCloseTo(7.5, 4);
    scenario.internals.updateBlackHoleFields(1);
    expect(enemy.health).toBeCloseTo(7.5, 4);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.startGame();
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.softRestartRound({ ...DEFAULT_GAME_SETTINGS, surface: 'cube', mode: 'waves' });
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.transitionToVoting();
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.room.state.roomPhase = 'playing';
    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.removeBlackHoleFieldsOwnedBy(scenario.player.id);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.room.onDispose();
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);
  });
});
