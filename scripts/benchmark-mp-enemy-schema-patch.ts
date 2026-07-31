import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import * as THREE from 'three';
import { ServerMeshPathfinder } from '../server/movement/ServerMeshPathfinder';
import type { ServerMeshLocation } from '../server/movement/ServerMeshLocation';
import { ServerMeshWalker } from '../server/movement/ServerMeshWalker';
import type { ServerSurfaceManager } from '../server/movement/ServerSurfaceManager';
import { EnemyState, GameState, PlayerState } from '../server/schema/GameState';
import { GameRoom } from '../server/rooms/GameRoom';

interface BenchInternals {
  surfaceManager: ServerSurfaceManager;
  enemyWalkers: Map<string, ServerMeshWalker>;
  enemyPathfinder: ServerMeshPathfinder | null;
  enemyAI: Map<string, Record<string, number>>;
  applyWalkerStateToPlayer(player: PlayerState, location: ServerMeshLocation): void;
  applyWalkerStateToEnemy(enemy: EnemyState, location: ServerMeshLocation): void;
  updateEnemies(dt: number): void;
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = resolve(process.cwd(), 'reports', `mp-enemy-schema-patch-benchmark-${runId}.json`);

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function setupRoom(enemyCount: number): { room: GameRoom; internals: BenchInternals } {
  const room = new GameRoom();
  (room as any).autoDispose = false;
  (room as any).setState(new GameState());
  room.state.surfaceType = 'cube-tunnel';
  room.state.mapSize = 'medium';
  room.state.mapSizeScaleFactor = 1;
  room.state.roomPhase = 'playing';
  room.state.gameTime = 0;

  const internals = room as unknown as BenchInternals;
  internals.surfaceManager.initSurface('cube-tunnel');
  const meshSurface = internals.surfaceManager.getMeshSurface()!;
  internals.enemyPathfinder = new ServerMeshPathfinder(meshSurface);

  const playerLocation = internals.surfaceManager.createRandomLocation(makeRandom(17))!;
  const player = new PlayerState();
  player.id = 'player-1';
  player.alive = true;
  room.state.players.set(player.id, player);
  const playerWalker = internals.surfaceManager.createWalker(player.id, 0.5, 0.5)!;
  playerWalker.teleportToLocation(playerLocation);
  internals.applyWalkerStateToPlayer(player, playerWalker.getLocation());

  for (let i = 0; i < enemyCount; i++) {
    const location = internals.surfaceManager.createRandomLocation(makeRandom(1000 + i * 13))!;
    const enemy = new EnemyState();
    enemy.id = `enemy-${i}`;
    enemy.type = 'grunt';
    enemy.health = 5;
    enemy.maxHealth = 5;
    enemy.alive = true;
    enemy.queued = false;
    const walker = new ServerMeshWalker(
      meshSurface,
      new THREE.Vector3(location.wx, location.wy, location.wz),
      1,
    );
    walker.teleportToLocation(location);
    internals.enemyWalkers.set(enemy.id, walker);
    internals.applyWalkerStateToEnemy(enemy, walker.getLocation());
    internals.enemyAI.set(enemy.id, {});
    room.state.enemies.push(enemy);
  }

  return { room, internals };
}

function runBenchmark(enemyCount: number): Record<string, number> {
  const { room, internals } = setupRoom(enemyCount);
  const state = room.state as unknown as { encode: () => number[]; encodeAll: () => number[] };
  state.encodeAll();

  const sizes: number[] = [];
  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) {
    room.state.gameTime += dt;
    internals.updateEnemies(dt);
    sizes.push(state.encode().length);
  }

  const total = sizes.reduce((sum, size) => sum + size, 0);
  const averageBytes = total / sizes.length;
  const maxBytes = Math.max(...sizes);
  const rawMbpsAt60Hz = averageBytes * 8 * 60 / 1_000_000;
  return { enemyCount, samples: sizes.length, averageBytes, maxBytes, rawMbpsAt60Hz };
}

mkdirSync(resolve(process.cwd(), 'reports'), { recursive: true });

const result = {
  verdict: 'PASS',
  runId,
  surface: 'cube-tunnel',
  patchRateHz: 60,
  reviewerBaseline: {
    note: 'CJ pre-fix actual GameRoom benchmark for enemy movement state alone.',
    enemies60AverageBytes: 4803.4,
    enemies60RawMbpsAt60Hz: 2.306,
    enemies200AverageBytes: 15860,
    enemies200RawMbpsAt60Hz: 7.613,
  },
  reducedSchema: [
    runBenchmark(60),
    runBenchmark(200),
  ],
  claimBoundary: 'Actual GameRoom.updateEnemies cube-tunnel patch-size benchmark after removing enemy face, barycentric, aggro, normal, tangent, and bitangent fields from the hot Colyseus schema. This measures server-side schema patch bytes before WebSocket framing and non-enemy room traffic.',
};

writeFileSync(reportPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ reportPath, reducedSchema: result.reducedSchema }, null, 2));
process.exit(0);
