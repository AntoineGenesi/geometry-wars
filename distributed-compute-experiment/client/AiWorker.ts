/**
 * AiWorker.ts — Browser Web Worker Script (Phase 2, Client Side)
 *
 * This file is compiled to AiWorker.js and loaded as a Web Worker.
 * It runs on a separate OS thread, so it does NOT block the render loop
 * when performing nearest-player AI computation.
 *
 * Message flow:
 *   Main thread → Worker: AiTask (from server, forwarded by AiWorkerBridge)
 *   Worker → Main thread: AiResult (computed, forwarded by AiWorkerBridge to server)
 *
 * WHY WEB WORKER?
 * Without a worker, the AI computation (O(E×P) nearest-player search)
 * would block the render loop. With a worker:
 *   - Main thread: render at 60fps, unblocked
 *   - Worker thread: compute AI in parallel, post result back
 *
 * DETERMINISM NOTE:
 * The computation must produce results within the server's tolerance (0.1%).
 * We use the same algorithm as computeServerAI() in AiTaskDispatcher.ts.
 * TypeScript's floating-point arithmetic is deterministic on the same platform,
 * but may differ between devices. The server's cross-validation accounts for
 * small floating-point rounding differences (±0.001 UV tolerance).
 *
 * COMPILATION NOTE:
 * This file needs to be bundled as a separate entry point. In vite.config.ts:
 *   build: {
 *     rollupOptions: {
 *       input: {
 *         main: 'index.html',
 *         aiWorker: 'src/distributed/AiWorker.ts',  // separate chunk
 *       }
 *     }
 *   }
 * Then load with: new Worker('/assets/aiWorker.js')
 */

import type { AiTask, AiResult, EnemySnapshot, PlayerSnapshot, EnemyMoveResult } from '../protocol/messages';

// ---------------------------------------------------------------------------
// Enemy speed table — MUST match server/AiTaskDispatcher.ts ENEMY_SPEEDS
// ---------------------------------------------------------------------------

const ENEMY_SPEEDS: Record<string, number> = {
  grunt: 0.07, arrow: 0.14, wanderer: 0.06, duck: 0.05, weaver: 0.10,
  spinner: 0.06, rocket: 0.14, neutron: 0.10, snake: 0.12, gate: 0.05,
  blackhole: 0.025, repulsor: 0.08, mayfly: 0.19, proton: 0.10,
  ufo: 0.05, mines: 0, mutator: 0.07, bubbles: 0.06, spawnlet: 0.12,
  virus: 0.09, spawner: 0.04, painter: 0.08, titan_grunt: 0.05,
  titan_spinner: 0.04, titan_weaver: 0.06,
};

function getEnemySpeed(type: string): number {
  return ENEMY_SPEEDS[type] ?? 0.07;
}

// ---------------------------------------------------------------------------
// Toroidal UV math (must match server)
// ---------------------------------------------------------------------------

function toroidalDist(delta: number): number {
  let d = delta % 1;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

// ---------------------------------------------------------------------------
// AI computation — nearest-player homing
// ---------------------------------------------------------------------------

/**
 * Compute movement delta for a single enemy toward its nearest alive player.
 * Returns { du, dv } — NOT absolute position, just the delta to add this tick.
 */
function computeAI(enemy: EnemySnapshot, players: PlayerSnapshot[], dt: number): EnemyMoveResult {
  let nearestDu = 0;
  let nearestDv = 0;
  let nearestDist = Infinity;

  for (const player of players) {
    if (!player.alive) continue;

    const du = toroidalDist(player.u - enemy.u);
    const dv = toroidalDist(player.v - enemy.v);
    const dist = Math.sqrt(du * du + dv * dv);

    if (dist < nearestDist) {
      nearestDist = dist;
      nearestDu = du;
      nearestDv = dv;
    }
  }

  if (nearestDist === Infinity || nearestDist < 0.01) {
    return { id: enemy.id, du: 0, dv: 0 };
  }

  const speed = getEnemySpeed(enemy.type);
  const scale = speed * dt / nearestDist;

  return {
    id: enemy.id,
    du: nearestDu * scale,
    dv: nearestDv * scale,
  };
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.addEventListener('message', (event: MessageEvent<AiTask>) => {
  const task = event.data;

  // Compute AI for each delegated enemy
  const results: EnemyMoveResult[] = task.enemies.map(
    enemy => computeAI(enemy, task.players, task.dt)
  );

  const result: AiResult = {
    type: 'ai_result',
    taskId: task.taskId,
    tick: task.tick,
    results,
  };

  self.postMessage(result);
});

// Let TypeScript know this is a module (required for Web Worker with modules)
export {};
