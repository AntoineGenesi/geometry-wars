/**
 * Collision Worker Bridge — Phase 1.2
 *
 * Main-thread interface to the CollisionWorker. Handles:
 *   - Worker lifecycle (create, restart on crash)
 *   - Structured clone vs Transferable packing/unpacking
 *   - Double-buffering: results from tick N arrive during tick N+1
 *   - Timeout/fallback: if worker result doesn't arrive in time, the
 *     main thread uses its own (synchronous) collision result
 *
 * USAGE IN GameRoom.ts:
 *
 *   // In onCreate():
 *   this.collisionBridge = new CollisionWorkerBridge();
 *   await this.collisionBridge.start();
 *
 *   // In tickGame() — send current positions, consume previous result:
 *   const prevResult = this.collisionBridge.consumeResult();
 *   if (prevResult) {
 *     this.applyCollisionResult(prevResult);
 *   } else {
 *     // Fallback: run synchronous collision this tick
 *     this.checkCollisionsSynchronous();
 *   }
 *   this.collisionBridge.sendTask(this.buildCollisionTask(this.tickNumber));
 *
 *   // In onDispose():
 *   await this.collisionBridge.stop();
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import type { CollisionTask, CollisionResult } from '../protocol/messages';

interface PendingResult {
  result: CollisionResult | null;
  receivedAt: number; // Date.now() when the result arrived
}

export class CollisionWorkerBridge {
  private worker: Worker | null = null;
  private pendingResult: PendingResult | null = null;
  private taskCounter = 0;

  /**
   * Spawn the worker thread. Call once at room creation.
   * Returns a promise that resolves when the worker is ready.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'CollisionWorker.js'); // compiled JS
      this.worker = new Worker(workerPath);

      this.worker.once('online', () => resolve());
      this.worker.once('error', reject);

      this.worker.on('message', (result: CollisionResult) => {
        this.pendingResult = { result, receivedAt: Date.now() };
      });

      this.worker.on('error', (err) => {
        console.error('[CollisionWorkerBridge] Worker error:', err);
        // Restart the worker on crash
        void this.restart();
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[CollisionWorkerBridge] Worker exited with code ${code}`);
        }
      });
    });
  }

  /** Terminate the worker. Call in onDispose(). */
  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Send a collision task to the worker.
   *
   * Uses Transferable for Float32Arrays (zero-copy). The arrays are transferred
   * (not copied), so they become invalid in the main thread after this call.
   * The caller must create fresh arrays each tick.
   */
  sendTask(task: CollisionTask): void {
    if (!this.worker) return;

    // Collect ArrayBuffers to transfer (zero-copy).
    // Note: after transfer, task.bulletX, task.bulletY, task.enemyU, task.enemyV
    // are detached (zero-length) in the main thread.
    // Collect buffers to transfer (zero-copy). Cast away ArrayBufferLike → ArrayBuffer
    // and the Transferable type mismatch between worker_threads and DOM libs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transferList: any[] = [];
    if (task.bulletX.buffer.byteLength > 0) transferList.push(task.bulletX.buffer);
    if (task.bulletY.buffer.byteLength > 0) transferList.push(task.bulletY.buffer);
    if (task.enemyU.buffer.byteLength > 0) transferList.push(task.enemyU.buffer);
    if (task.enemyV.buffer.byteLength > 0) transferList.push(task.enemyV.buffer);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.worker.postMessage(task, transferList as any);
  }

  /**
   * Consume the latest result from the worker.
   *
   * Returns null if no result is available yet (first tick, or worker slow).
   * Caller should fall back to synchronous collision if null.
   *
   * The result is consumed: subsequent calls return null until the next
   * worker result arrives.
   */
  consumeResult(): CollisionResult | null {
    if (!this.pendingResult) return null;
    const result = this.pendingResult.result;
    this.pendingResult = null;
    return result;
  }

  /**
   * Build a CollisionTask from the current game state.
   *
   * Packs entity positions into Float32Arrays for zero-copy transfer.
   * Call this at the END of each tick (after you've already consumed
   * the previous result and applied it).
   */
  buildTask(
    tick: number,
    enemies: Array<{ id: string; surfaceU: number; surfaceV: number }>,
    bullets: Array<{ id: string; x: number; y: number; ownerId: string }>,
  ): CollisionTask {
    const enemyU = new Float32Array(enemies.length);
    const enemyV = new Float32Array(enemies.length);
    const enemyIds: string[] = [];

    for (let i = 0; i < enemies.length; i++) {
      enemyIds.push(enemies[i].id);
      enemyU[i] = enemies[i].surfaceU;
      enemyV[i] = enemies[i].surfaceV;
    }

    const bulletX = new Float32Array(bullets.length);
    const bulletY = new Float32Array(bullets.length);
    const bulletIds: string[] = [];
    const bulletOwnerIds: string[] = [];

    for (let i = 0; i < bullets.length; i++) {
      bulletIds.push(bullets[i].id);
      bulletOwnerIds.push(bullets[i].ownerId);
      bulletX[i] = bullets[i].x;
      bulletY[i] = bullets[i].y;
    }

    return {
      taskId: this.taskCounter++,
      tick,
      enemyIds,
      enemyU,
      enemyV,
      bulletIds,
      bulletX,
      bulletY,
      bulletOwnerIds,
      bulletEnemyRadius: 0.05,
      playerEnemyRadius: 0.04,
      cellSize: 0.1,
    };
  }

  private async restart(): Promise<void> {
    await this.stop();
    console.log('[CollisionWorkerBridge] Restarting worker after crash...');
    try {
      await this.start();
      console.log('[CollisionWorkerBridge] Worker restarted successfully');
    } catch (err) {
      console.error('[CollisionWorkerBridge] Failed to restart worker:', err);
    }
  }
}
