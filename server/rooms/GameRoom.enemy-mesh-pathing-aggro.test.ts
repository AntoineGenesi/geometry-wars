import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BaseEnemy } from '../../src/entities/enemies/BaseEnemy';
import { ServerMeshPathfinder } from '../movement/ServerMeshPathfinder';
import type { ServerMeshLocation } from '../movement/ServerMeshLocation';
import { ServerMeshWalker } from '../movement/ServerMeshWalker';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import { BulletState, EnemyState, GameState, PlayerState } from '../schema/GameState';
import { GameRoom, surfaceUVToWorld3D } from './GameRoom';

interface EnemyAIState {
  directionU?: number;
  directionV?: number;
  directionChangeTimer?: number;
  nextDirectionChange?: number;
}

interface EnemyRoomInternals {
  surfaceManager: ServerSurfaceManager;
  enemyWalkers: Map<string, ServerMeshWalker>;
  enemyPathfinder: ServerMeshPathfinder | null;
  enemyAI: Map<string, EnemyAIState>;
  applyWalkerStateToPlayer(player: PlayerState, location: ServerMeshLocation): void;
  applyWalkerStateToEnemy(enemy: EnemyState, location: ServerMeshLocation): void;
  updateEnemies(dt: number): void;
  applyPlayerOwnedEnemyDamage(
    enemy: EnemyState,
    damage: number,
    sourcePlayerId: string,
    sourceKind: string,
  ): number;
  applyLaserDamage(player: PlayerState, dt: number): void;
  applyTeslaDamage(player: PlayerState, dt: number): void;
  fireChainLightningMP(player: PlayerState): void;
  bulletWorldDistanceToEnemy(bullet: BulletState, enemy: EnemyState): number;
  rollEnemyPickupDrops(enemy: EnemyState, includeShield?: boolean): void;
  spawnEnemyNearPosition(type: string, u: number, v: number): void;
  surfaceWrapsV(): boolean;
  applyUVBounds(enemy: EnemyState, wrapsV: boolean, surfType: string): void;
}

interface EnemyScenario {
  room: GameRoom;
  internals: EnemyRoomInternals;
  player: PlayerState;
  enemy: EnemyState;
  pathfinder: ServerMeshPathfinder;
  startLocation: ServerMeshLocation;
}

function makeScenario(surfaceType: string, enemyType = 'grunt'): EnemyScenario {
  const room = new GameRoom();
  (room as any).setState(new GameState());
  room.state.surfaceType = surfaceType;
  room.state.mapSize = 'medium';
  room.state.gameTime = 0;
  room.state.roomPhase = 'playing';

  const internals = room as unknown as EnemyRoomInternals;
  internals.surfaceManager.initSurface(surfaceType);
  const meshSurface = internals.surfaceManager.getMeshSurface()!;
  const pathfinder = new ServerMeshPathfinder(meshSurface);
  internals.enemyPathfinder = pathfinder;

  const targetLocation = internals.surfaceManager.createRandomLocation(() => 0.17)!;
  const candidates = [0.43, 0.67, 0.83]
    .map((sample) => internals.surfaceManager.createRandomLocation(() => sample)!)
    .filter((candidate) => Number.isFinite(pathfinder.getPathDistance(candidate, targetLocation)));
  const startLocation = candidates.sort((a, b) =>
    pathfinder.getPathDistance(b, targetLocation) - pathfinder.getPathDistance(a, targetLocation))[0];
  expect(startLocation).toBeDefined();

  const player = new PlayerState();
  player.id = 'player-1';
  player.alive = true;
  // Deliberately unrelated compatibility UV: canonical fields must drive pursuit.
  player.surfaceU = 0.5;
  player.surfaceV = 0.5;
  room.state.players.set(player.id, player);
  const playerWalker = internals.surfaceManager.createWalker(player.id, 0.5, 0.5)!;
  playerWalker.teleportToLocation(targetLocation);
  internals.applyWalkerStateToPlayer(player, playerWalker.getLocation());

  const enemy = new EnemyState();
  enemy.id = 'enemy-1';
  enemy.type = enemyType;
  enemy.health = 5;
  enemy.maxHealth = 5;
  enemy.surfaceU = 0.5;
  enemy.surfaceV = 0.5;
  const enemyWalker = new ServerMeshWalker(
    meshSurface,
    new THREE.Vector3(startLocation.wx, startLocation.wy, startLocation.wz),
    1,
  );
  enemyWalker.teleportToLocation(startLocation);
  internals.enemyWalkers.set(enemy.id, enemyWalker);
  internals.applyWalkerStateToEnemy(enemy, enemyWalker.getLocation());
  internals.enemyAI.set(enemy.id, {});
  room.state.enemies.push(enemy);

  return { room, internals, player, enemy, pathfinder, startLocation };
}

function makeUvScenario(
  surfaceType: string,
  playerU: number,
  playerV: number,
  enemyU: number,
  enemyV: number,
  enemyType = 'grunt',
): EnemyScenario {
  const room = new GameRoom();
  (room as any).setState(new GameState());
  room.state.surfaceType = surfaceType;
  room.state.mapSize = 'medium';
  room.state.gameTime = 0;
  room.state.roomPhase = 'playing';

  const internals = room as unknown as EnemyRoomInternals;
  internals.surfaceManager.initSurface(surfaceType);
  const meshSurface = internals.surfaceManager.getMeshSurface()!;
  const pathfinder = new ServerMeshPathfinder(meshSurface);
  internals.enemyPathfinder = pathfinder;

  const player = new PlayerState();
  player.id = 'player-1';
  player.alive = true;
  room.state.players.set(player.id, player);
  const playerWalker = internals.surfaceManager.createWalker(player.id, playerU, playerV)!;
  internals.applyWalkerStateToPlayer(player, playerWalker.getLocation());
  player.surfaceU = playerU;
  player.surfaceV = playerV;

  const enemy = new EnemyState();
  enemy.id = 'enemy-1';
  enemy.type = enemyType;
  enemy.health = 5;
  enemy.maxHealth = 5;
  enemy.surfaceU = enemyU;
  enemy.surfaceV = enemyV;
  const enemyWalker = new ServerMeshWalker(
    meshSurface,
    new THREE.Vector3(...surfaceUVToWorld3D(surfaceType, enemyU, enemyV, 1, 10)),
    1,
  );
  internals.enemyWalkers.set(enemy.id, enemyWalker);
  internals.applyWalkerStateToEnemy(enemy, enemyWalker.getLocation());
  internals.enemyAI.set(enemy.id, {});
  room.state.enemies.push(enemy);

  return { room, internals, player, enemy, pathfinder, startLocation: enemyWalker.getLocation() };
}

function advanceScenario(scenario: EnemyScenario, seconds: number): void {
  const dt = 1 / 60;
  const ticks = Math.round(seconds / dt);
  for (let i = 0; i < ticks; i++) {
    scenario.room.state.gameTime += dt;
    scenario.internals.updateEnemies(dt);
  }
}

function pathDistance(scenario: EnemyScenario): number {
  return scenario.pathfinder.getPathDistance({
    faceIndex: scenario.enemy.walkerFaceIndex,
    wx: scenario.enemy.wx,
    wy: scenario.enemy.wy,
    wz: scenario.enemy.wz,
  }, {
    faceIndex: scenario.player.walkerFaceIndex,
    wx: scenario.player.wx,
    wy: scenario.player.wy,
    wz: scenario.player.wz,
  });
}

function compatibilityWorldDistance(surfaceType: string, enemy: EnemyState): number {
  const [x, y, z] = surfaceUVToWorld3D(surfaceType, enemy.surfaceU, enemy.surfaceV, 1, 10);
  return Math.hypot(enemy.wx - x, enemy.wy - y, enemy.wz - z);
}

describe.each(['cube', 'cube-ring', 'cube-tunnel', 'sphere', 'sphere-tunnel'])(
  'GameRoom canonical enemy chase on %s',
  (surfaceType) => {
    it('reduces mesh-path distance at fixed checkpoints', () => {
      const scenario = makeScenario(surfaceType);
      const distances = [pathDistance(scenario)];
      for (const checkpoint of [1, 1, 3]) {
        advanceScenario(scenario, checkpoint);
        distances.push(pathDistance(scenario));
      }

      expect(distances.every(Number.isFinite)).toBe(true);
      expect(distances[1]).toBeLessThan(distances[0]);
      expect(distances[2]).toBeLessThan(distances[1]);
      expect(distances[3]).toBeLessThan(distances[2]);
    });
  },
);

describe('GameRoom enemy target authority and damage aggro', () => {
  it('treats sphere-tunnel enemy V bounds as torus-periodic, not sphere-pole reflection', () => {
    const scenario = makeScenario('sphere-tunnel');
    const enemy = scenario.enemy;
    const internals = scenario.internals;

    expect(internals.surfaceWrapsV()).toBe(true);

    enemy.surfaceU = 0.12;
    enemy.surfaceV = 1.02;
    internals.applyUVBounds(enemy, internals.surfaceWrapsV(), 'sphere-tunnel');

    expect(enemy.surfaceU).toBeCloseTo(0.12, 6);
    expect(enemy.surfaceV).toBeCloseTo(0.02, 6);
  });

  it('does not gather at the legacy UV target when canonical player location differs', () => {
    const scenario = makeScenario('cube-tunnel');
    const startDistance = pathDistance(scenario);

    // Old UV authority saw zero target delta here and left the enemy stationary.
    scenario.player.surfaceU = scenario.enemy.surfaceU;
    scenario.player.surfaceV = scenario.enemy.surfaceV;
    advanceScenario(scenario, 2);

    const finalDistance = pathDistance(scenario);
    const moved = Math.hypot(
      scenario.enemy.wx - scenario.startLocation.wx,
      scenario.enemy.wy - scenario.startLocation.wy,
      scenario.enemy.wz - scenario.startLocation.wz,
    );
    expect(finalDistance).toBeLessThan(startDistance);
    expect(moved).toBeGreaterThan(0.25);
  });

  it('keeps sphere-tunnel outer-surface pursuit away from the tunnel seam when a shorter outer route exists', () => {
    const scenario = makeUvScenario('sphere-tunnel', 0.24, 0.30, 0.31, 0.33);
    const startDistance = pathDistance(scenario);
    const startV = scenario.enemy.surfaceV;

    advanceScenario(scenario, 1.5);

    expect(pathDistance(scenario)).toBeLessThan(startDistance);
    expect(scenario.enemy.surfaceV).toBeGreaterThan(0.05);
    expect(scenario.enemy.surfaceV).toBeLessThan(0.55);
    expect(Math.abs(scenario.enemy.surfaceV - startV)).toBeLessThan(0.08);
  });

  it('sets timed player aggro on surviving damage and resumes the original strategy', () => {
    const scenario = makeScenario('cube', 'wanderer');
    const ai = {
      directionU: -1,
      directionV: 0,
      directionChangeTimer: 0,
      nextDirectionChange: 999,
    };
    scenario.internals.enemyAI.set(scenario.enemy.id, ai);

    const dealt = scenario.internals.applyPlayerOwnedEnemyDamage(
      scenario.enemy,
      1,
      scenario.player.id,
      'test_bullet',
    );
    expect(dealt).toBe(1);
    expect(scenario.enemy.health).toBe(4);
    expect(scenario.enemy.aggroTargetId).toBe(scenario.player.id);
    expect(scenario.enemy.aggroUntil).toBeCloseTo(4, 5);

    const beforeAggroDistance = pathDistance(scenario);
    advanceScenario(scenario, 1);
    expect(pathDistance(scenario))
      .toBeLessThan(beforeAggroDistance);
    expect(ai.directionChangeTimer).toBe(0);

    scenario.room.state.gameTime = scenario.enemy.aggroUntil + 0.1;
    scenario.internals.updateEnemies(1 / 60);
    expect(scenario.enemy.aggroTargetId).toBe('');
    expect(scenario.enemy.aggroUntil).toBe(0);
    expect(ai.directionChangeTimer).toBeGreaterThan(0);
  });

  it.each(['cube', 'cube-tunnel'])('keeps compatibility UV derived from canonical movement on %s', (surfaceType) => {
    const scenario = makeScenario(surfaceType);
    advanceScenario(scenario, 5);

    expect(compatibilityWorldDistance(surfaceType, scenario.enemy)).toBeLessThan(0.75);
  });

  it('uses canonical enemy location for MP weapon, pickup, and spawnlet consumers', () => {
    const scenario = makeScenario('cube-tunnel');
    const player = scenario.player;
    const enemy = scenario.enemy;
    const correctUV = { u: enemy.surfaceU, v: enemy.surfaceV };

    enemy.surfaceU = 0.01;
    enemy.surfaceV = 0.99;
    enemy.wx = player.wx + player.tx * 5;
    enemy.wy = player.wy + player.ty * 5;
    enemy.wz = player.wz + player.tz * 5;
    enemy.health = 5;
    player.aimAngle = 0;
    scenario.internals.applyLaserDamage(player, 1 / 60);
    expect(enemy.health).toBeLessThan(5);

    enemy.health = 5;
    enemy.wx = player.wx + player.nx;
    enemy.wy = player.wy + player.ny;
    enemy.wz = player.wz + player.nz;
    scenario.internals.applyTeslaDamage(player, 1 / 60);
    expect(enemy.health).toBeLessThan(5);

    enemy.health = 5;
    scenario.internals.fireChainLightningMP(player);
    expect(enemy.health).toBeLessThan(5);

    const [bulletX, bulletY, bulletZ] = surfaceUVToWorld3D('cube-tunnel', correctUV.u, correctUV.v, 1, 10);
    enemy.wx = bulletX;
    enemy.wy = bulletY;
    enemy.wz = bulletZ;
    const bullet = new BulletState();
    bullet.x = correctUV.u;
    bullet.y = correctUV.v;
    expect(scenario.internals.bulletWorldDistanceToEnemy(bullet, enemy)).toBeLessThan(0.01);

    const originalRandom = Math.random;
    try {
      const randomValues = [0, 0.5, 0.5, 0.1, 1, 1];
      Math.random = () => randomValues.shift() ?? 0.5;
      scenario.internals.applyWalkerStateToEnemy(
        enemy,
        scenario.internals.enemyWalkers.get(enemy.id)!.getLocation(),
      );
      scenario.internals.rollEnemyPickupDrops(enemy);
      const pickup = scenario.room.state.weaponPickups[scenario.room.state.weaponPickups.length - 1]!;
      expect(compatibilityWorldDistance('cube-tunnel', {
        ...enemy,
        surfaceU: pickup.surfaceU,
        surfaceV: pickup.surfaceV,
      } as EnemyState)).toBeLessThan(0.75);

      const beforeSpawnlets = scenario.room.state.enemies.length;
      scenario.internals.spawnEnemyNearPosition('spawnlet', enemy.surfaceU, enemy.surfaceV);
      expect(scenario.room.state.enemies.length).toBe(beforeSpawnlets + 1);
      const spawnlet = scenario.room.state.enemies[scenario.room.state.enemies.length - 1]!;
      expect(compatibilityWorldDistance('cube-tunnel', spawnlet)).toBeLessThan(0.75);
    } finally {
      Math.random = originalRandom;
    }
  });
});

class StrategyProbeEnemy extends BaseEnemy {
  behaviorCalls = 0;

  constructor() {
    super(0.1, 0.5, 5, 1, 0, 0.1);
  }

  updateBehavior(dt: number): void {
    this.behaviorCalls++;
    this.surfacePosition.u -= this.speed * dt;
  }
}

describe('single-player damage aggro parity', () => {
  it('temporarily overrides behavior toward the attacker and expires cleanly', () => {
    const enemy = new StrategyProbeEnemy();
    enemy.setPlayerPosition(0.4, 0.5);
    enemy.takeDamage(1, 7);

    const before = enemy.surfacePosition.u;
    enemy.update(1);
    expect(enemy.isDamageAggroActive()).toBe(true);
    expect(enemy.aggroTargetId).toBe(7);
    expect(enemy.surfacePosition.u).toBeGreaterThan(before);
    expect(enemy.behaviorCalls).toBe(0);

    enemy.update(BaseEnemy.DAMAGE_AGGRO_DURATION);
    expect(enemy.isDamageAggroActive()).toBe(false);
    expect(enemy.aggroTargetId).toBe(-1);
    expect(enemy.behaviorCalls).toBe(1);
  });
});
