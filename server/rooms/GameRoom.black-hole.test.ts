import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_SETTINGS } from '../shared/GameSettings';
import { ServerMeshPathfinder } from '../movement/ServerMeshPathfinder';
import type { ServerMeshLocation } from '../movement/ServerMeshLocation';
import { ServerMeshWalker } from '../movement/ServerMeshWalker';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import { TorusSurface } from '../../src/surfaces/TorusSurface';
import {
  BlackHoleBoltState,
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
  spawnBlackHoleFieldFromLocation(ownerId: string, location: ServerMeshLocation): BlackHoleFieldState;
  updateBlackHoleBolts(dt: number): void;
  updateBlackHoleFields(dt: number): void;
  removeBlackHoleBoltsOwnedBy(ownerId: string): void;
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

function makeRoom(options: {
  surfaceType?: 'cube' | 'torus';
  spawnU?: number;
  spawnV?: number;
  aimAngle?: number;
} = {}): {
  room: GameRoom;
  internals: BlackHoleRoomInternals;
  player: PlayerState;
  pathfinder: ServerMeshPathfinder;
} {
  const surfaceType = options.surfaceType ?? 'cube';
  const room = new GameRoom();
  (room as any).setState(new GameState());
  (room as any).setMetadata = vi.fn();
  (room as any).broadcast = vi.fn();
  (room as any).logger = { log: vi.fn() };
  room.state.surfaceType = surfaceType;
  room.state.mapSize = 'medium';
  room.state.roomPhase = 'playing';
  room.state.gameStarted = true;
  room.state.gameTime = 1;

  const internals = room as unknown as BlackHoleRoomInternals;
  internals.surfaceManager.initSurface(surfaceType, 1);
  const meshSurface = internals.surfaceManager.getMeshSurface()!;
  const pathfinder = new ServerMeshPathfinder(meshSurface);
  internals.enemyPathfinder = pathfinder;

  const player = new PlayerState();
  player.id = 'owner';
  player.name = 'Owner';
  player.weaponType = 'black_hole';
  player.weaponAmmo = 5;
  player.aimAngle = options.aimAngle ?? 0;
  room.state.players.set(player.id, player);
  const playerWalker = internals.surfaceManager.createWalker(
    player.id,
    options.spawnU ?? 0.44,
    options.spawnV ?? 0.47,
  )!;
  internals.applyWalkerStateToPlayer(player, playerWalker.getLocation());
  (player as unknown as { lastBlasterShotTime: number }).lastBlasterShotTime = room.state.gameTime;
  (player as unknown as { lastShotTime: number }).lastShotTime = -Infinity;

  return { room, internals, player, pathfinder };
}

function vectorFromLocation(location: ServerMeshLocation): THREE.Vector3 {
  return new THREE.Vector3(location.wx, location.wy, location.wz);
}

function boltDirection(bolt: BlackHoleBoltState): THREE.Vector3 {
  return new THREE.Vector3(bolt.dirX, bolt.dirY, bolt.dirZ).normalize();
}

function serverWalkerAimVector(location: ServerMeshLocation, aimAngle: number): THREE.Vector3 {
  return new THREE.Vector3(location.tangentX, location.tangentY, location.tangentZ)
    .multiplyScalar(Math.cos(aimAngle))
    .addScaledVector(
      new THREE.Vector3(location.bitangentX, location.bitangentY, location.bitangentZ),
      Math.sin(aimAngle),
    )
    .normalize();
}

function torusClientVisualAimVector(location: ServerMeshLocation, aimAngle: number): THREE.Vector3 {
  const torus = new TorusSurface({ majorRadius: 8, minorRadius: 3 });
  const uv = torus.worldToSurface(vectorFromLocation(location));
  const sp = torus.getPoint(uv.u, uv.v);
  return sp.tangentU.clone()
    .multiplyScalar(Math.cos(aimAngle))
    .addScaledVector(sp.tangentV, Math.sin(aimAngle))
    .normalize();
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

function addEnemyNearPlayerAim(
  room: GameRoom,
  internals: BlackHoleRoomInternals,
  player: PlayerState,
  forwardDistance: number,
  sideDistance: number,
  health: number,
): EnemyState {
  const surface = internals.surfaceManager.getMeshSurface()!;
  const start = internals.surfaceManager.getWalkerLocation(player.id)!;
  const walker = new ServerMeshWalker(
    surface,
    new THREE.Vector3(start.wx, start.wy, start.wz),
    1,
  );
  walker.teleportToLocation(start);
  walker.speed = 1;
  walker.moveInWorldDirection(start.tangentX, start.tangentY, start.tangentZ, forwardDistance);
  if (sideDistance !== 0) {
    walker.moveInWorldDirection(start.bitangentX, start.bitangentY, start.bitangentZ, sideDistance);
  }

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

function spawnFieldAtAim(scenario: {
  internals: BlackHoleRoomInternals;
  player: PlayerState;
}): BlackHoleFieldState {
  const location = scenario.internals.surfaceManager.createLocationNearWalker(
    scenario.player.id,
    4,
    scenario.player.aimAngle,
  )!;
  return scenario.internals.spawnBlackHoleFieldFromLocation(scenario.player.id, location);
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
    const bolt = new BlackHoleBoltState();
    const field = new BlackHoleFieldState();
    state.blackHoleBolts.push(bolt);
    state.blackHoleFields.push(field);

    expect(state.blackHoleBolts).toHaveLength(1);
    expect(bolt).toMatchObject({
      ownerId: '',
      walkerFaceIndex: 0,
      walkerBaryU: 1,
      walkerBaryV: 0,
      walkerBaryW: 0,
      age: 0,
      maxAge: 0,
      pullRadius: 0,
    });
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

  it('routes black_hole away from normal bullets and spawns one travelling canonical bolt', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);
    const startLocation = scenario.internals.surfaceManager.getWalkerLocation(scenario.player.id)!;
    const aim = serverWalkerAimVector(startLocation, scenario.player.aimAngle);

    scenario.internals.tryShoot(scenario.player);

    expect(scenario.room.state.bullets).toHaveLength(0);
    expect(scenario.room.state.blackHoleBolts).toHaveLength(1);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);
    const bolt = scenario.room.state.blackHoleBolts[0];
    const start = [bolt.wx, bolt.wy, bolt.wz];
    expect(bolt.ownerId).toBe(scenario.player.id);
    expect(bolt.maxAge).toBe(1.2);
    expect(bolt.pullRadius).toBeGreaterThan(1);
    expect(boltDirection(bolt).dot(aim)).toBeGreaterThan(0.98);
    expect(bolt.walkerBaryU + bolt.walkerBaryV + bolt.walkerBaryW).toBeCloseTo(1, 5);

    scenario.internals.updateBlackHoleBolts(1 / 60);
    expect([bolt.wx, bolt.wy, bolt.wz]).not.toEqual(start);
    const travel = new THREE.Vector3(
      bolt.wx - startLocation.wx,
      bolt.wy - startLocation.wy,
      bolt.wz - startLocation.wz,
    );
    expect(travel.length()).toBeGreaterThan(0.02);
    expect(travel.length()).toBeLessThan(0.12);
    expect(travel.normalize().dot(aim)).toBeGreaterThan(0.9);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);
  });

  it('spawns torus travelling bolts in the same world direction as the client visual aim frame', () => {
    for (const aimAngle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const scenario = makeRoom({
        surfaceType: 'torus',
        spawnU: 0.04,
        spawnV: 0.18,
        aimAngle,
      });
      rooms.push(scenario.room);
      const start = scenario.internals.surfaceManager.getWalkerLocation(scenario.player.id)!;
      const visualAim = torusClientVisualAimVector(start, aimAngle);

      scenario.internals.tryShoot(scenario.player);

      expect(scenario.room.state.bullets).toHaveLength(0);
      expect(scenario.room.state.blackHoleBolts).toHaveLength(1);
      const bolt = scenario.room.state.blackHoleBolts[0];
      expect(boltDirection(bolt).dot(visualAim)).toBeGreaterThan(0.98);

      scenario.internals.updateBlackHoleBolts(1 / 60);
      const travel = new THREE.Vector3(bolt.wx - start.wx, bolt.wy - start.wy, bolt.wz - start.wz);
      expect(travel.normalize().dot(visualAim)).toBeGreaterThan(0.92);
    }
  });

  it('keeps torus Black Hole aim distinct from the historical normal-bullet UV dirX correction', () => {
    const scenario = makeRoom({
      surfaceType: 'torus',
      spawnU: 0.04,
      spawnV: 0.18,
      aimAngle: 0,
    });
    rooms.push(scenario.room);
    const start = scenario.internals.surfaceManager.getWalkerLocation(scenario.player.id)!;
    const serverAim = serverWalkerAimVector(start, scenario.player.aimAngle);
    const visualAim = torusClientVisualAimVector(start, scenario.player.aimAngle);

    scenario.internals.tryShoot(scenario.player);

    const bolt = scenario.room.state.blackHoleBolts[0];
    expect(Math.abs(serverAim.dot(visualAim))).toBeLessThan(0.2);
    expect(boltDirection(bolt).dot(visualAim)).toBeGreaterThan(0.98);
  });

  it('pulls near-line enemies while the travelling bolt is still in flight', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);
    const enemy = addEnemyNearPlayerAim(scenario.room, scenario.internals, scenario.player, 1.2, 0.8, 100);

    scenario.internals.fireBlackHoleMP(scenario.player);
    const startWorld = [enemy.wx, enemy.wy, enemy.wz];

    for (let i = 0; i < 4; i++) scenario.internals.updateBlackHoleBolts(1 / 60);

    expect(scenario.room.state.blackHoleFields).toHaveLength(0);
    expect(Math.hypot(enemy.wx - startWorld[0], enemy.wy - startWorld[1], enemy.wz - startWorld[2])).toBeGreaterThan(0.01);
  });

  it('blooms into exactly one synchronized field when the travelling bolt touches an enemy', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);
    addEnemyNearPlayerAim(scenario.room, scenario.internals, scenario.player, 0.45, 0, 100);

    scenario.internals.fireBlackHoleMP(scenario.player);
    for (let i = 0; i < 15 && scenario.room.state.blackHoleFields.length === 0; i++) {
      scenario.internals.updateBlackHoleBolts(1 / 60);
    }

    expect(scenario.room.state.blackHoleBolts).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(1);
    expect(scenario.room.state.blackHoleFields[0].ownerId).toBe(scenario.player.id);
  });

  it('blooms a missed travelling bolt into a synchronized field at max range', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);

    scenario.internals.fireBlackHoleMP(scenario.player);
    for (let i = 0; i < 90; i++) scenario.internals.updateBlackHoleBolts(1 / 60);

    expect(scenario.room.state.blackHoleBolts).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(1);
    expect(scenario.room.state.blackHoleFields[0].ownerId).toBe(scenario.player.id);
  });

  it('pulls a ServerMeshWalker toward the field and applies timed owner kill/score attribution', () => {
    const scenario = makeRoom();
    rooms.push(scenario.room);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const field = spawnFieldAtAim(scenario);
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
    const field = spawnFieldAtAim(scenario);
    const enemy = addEnemyNearField(scenario.room, scenario.internals, field, 2, 20);

    for (let i = 0; i < 270; i++) scenario.internals.updateBlackHoleFields(1 / 60);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);
    expect(enemy.health).toBeCloseTo(5, 4);
    scenario.internals.updateBlackHoleFields(1);
    expect(enemy.health).toBeCloseTo(5, 4);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.startGame();
    expect(scenario.room.state.blackHoleBolts).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.softRestartRound({ ...DEFAULT_GAME_SETTINGS, surface: 'cube', mode: 'waves' });
    expect(scenario.room.state.blackHoleBolts).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.transitionToVoting();
    expect(scenario.room.state.blackHoleBolts).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.room.state.roomPhase = 'playing';
    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.internals.removeBlackHoleBoltsOwnedBy(scenario.player.id);
    scenario.internals.removeBlackHoleFieldsOwnedBy(scenario.player.id);
    expect(scenario.room.state.blackHoleBolts).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);

    scenario.internals.fireBlackHoleMP(scenario.player);
    scenario.room.onDispose();
    expect(scenario.room.state.blackHoleBolts).toHaveLength(0);
    expect(scenario.room.state.blackHoleFields).toHaveLength(0);
  });
});
