import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BaseEnemy } from '../../src/entities/enemies/BaseEnemy';
import { ServerMeshPathfinder } from '../movement/ServerMeshPathfinder';
import type { ServerMeshLocation } from '../movement/ServerMeshLocation';
import { ServerMeshWalker } from '../movement/ServerMeshWalker';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import { EnemyState, GameState, PlayerState } from '../schema/GameState';
import { GameRoom } from './GameRoom';

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

describe.each(['cube', 'cube-ring', 'cube-tunnel', 'sphere'])(
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
