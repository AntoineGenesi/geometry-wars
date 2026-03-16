/**
 * Collision Detection Worker Thread — Phase 1.2
 *
 * This file runs inside a Node.js Worker Thread (worker_threads module).
 * It receives CollisionTask messages from the main thread, performs
 * O(B + E) spatial-hash-accelerated collision detection, and posts back
 * CollisionResult messages.
 *
 * WHY A WORKER THREAD?
 * The main event loop handles Colyseus state patching (~2–5ms), input
 * handling, wave generation, and all other game logic. Moving the
 * O(B×E) collision loop to a worker thread means state patching and
 * input handling are never blocked by collision math.
 *
 * DOUBLE-BUFFERING PATTERN (critical):
 * The worker is one tick behind the main thread. At tick N:
 *   - Main thread applies collision results from tick N-1
 *   - Main thread sends positions for tick N to the worker
 *   - Worker computes collisions for tick N in parallel
 * This means collisions are resolved with 1-tick-old positions.
 * At 60Hz this is 16.6ms lag — imperceptible in gameplay.
 *
 * HOW TO USE (see CollisionWorkerBridge.ts for the main thread side):
 *   const worker = new Worker('./CollisionWorker.js');
 *   worker.postMessage(task);           // Send task
 *   worker.on('message', handleResult); // Receive result
 *
 * THREAD SAFETY:
 * Node.js Worker Threads do NOT share memory by default. postMessage
 * uses structured clone. For typed arrays (Float32Array), you can use
 * Transferable to avoid copying — this is how CollisionWorkerBridge
 * sends bullet/enemy position arrays at zero copy cost.
 */

import { parentPort } from 'worker_threads';
import { SpatialHash } from './SpatialHash';
import type { CollisionTask, CollisionResult } from '../protocol/messages';

if (!parentPort) {
  throw new Error('CollisionWorker must run as a Worker Thread');
}

// Re-use a single SpatialHash instance across ticks to avoid GC pressure.
const spatialHash = new SpatialHash(0.1);

parentPort.on('message', (task: CollisionTask) => {
  const startMs = Date.now();
  const hits = detectCollisions(task);
  const result: CollisionResult = {
    taskId: task.taskId,
    tick: task.tick,
    bulletEnemyHits: hits,
    processingMs: Date.now() - startMs,
  };
  parentPort!.postMessage(result);
});

function detectCollisions(task: CollisionTask): CollisionResult['bulletEnemyHits'] {
  const hits: CollisionResult['bulletEnemyHits'] = [];

  // --- Build spatial hash from enemies ---
  spatialHash.clear();
  for (let i = 0; i < task.enemyIds.length; i++) {
    spatialHash.insert(task.enemyIds[i], task.enemyU[i], task.enemyV[i]);
  }

  // --- For each bullet, query nearby enemies ---
  for (let b = 0; b < task.bulletIds.length; b++) {
    const bx = task.bulletX[b];
    const by = task.bulletY[b];
    const bulletId = task.bulletIds[b];

    const candidates = spatialHash.queryRadius(bx, by, task.bulletEnemyRadius);
    for (const candidate of candidates) {
      hits.push({ bulletId, enemyId: candidate.id });
    }
  }

  return hits;
}
