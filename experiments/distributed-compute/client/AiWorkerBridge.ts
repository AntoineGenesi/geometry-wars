/**
 * AiWorkerBridge.ts — Client-side bridge between Colyseus room and AiWorker
 *
 * This runs on the MAIN thread (in network-main.ts).
 * It:
 *   1. Spawns the AiWorker Web Worker
 *   2. Forwards AiTask messages (from server) to the worker
 *   3. Receives AiResult messages (from worker) and sends them back to server
 *   4. Emits CPU load heartbeats every second
 *   5. Reads the "shared load %" setting from localStorage
 *
 * INTEGRATION INTO network-main.ts:
 *
 * ```typescript
 * // In the Colyseus room join callback:
 * const aiBridge = new AiWorkerBridge(room);
 * aiBridge.start();
 *
 * // Register the message handler:
 * room.onMessage('ai_task', (task) => aiBridge.handleTask(task));
 *
 * // In the game loop (to track CPU load):
 * aiBridge.recordFrameTime(frameMs);
 *
 * // On room leave:
 * aiBridge.stop();
 * ```
 */

import type { Room } from 'colyseus.js';
import type { AiTask, AiResult, CpuHeartbeat } from '../protocol/messages';

export class AiWorkerBridge {
  private worker: Worker | null = null;
  private room: Room;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Rolling average of frame times (last 60 frames)
  private frameTimes: number[] = [];
  private readonly frameTimeWindow = 60;

  // localStorage key for the shared load preference
  private readonly STORAGE_KEY = 'gw_distributed_compute_load';

  constructor(room: Room) {
    this.room = room;
  }

  /** Start the worker and heartbeat. Call after joining the room. */
  start(): void {
    // Load the compiled worker bundle
    // In production, this would be '/assets/aiWorker.js'
    // In dev with Vite, use a URL that points to the worker entry
    try {
      this.worker = new Worker(new URL('./AiWorker.ts', import.meta.url), { type: 'module' });

      this.worker.addEventListener('message', (event: MessageEvent<AiResult>) => {
        this.onWorkerResult(event.data);
      });

      this.worker.addEventListener('error', (err) => {
        console.error('[AiWorkerBridge] Worker error:', err);
        // Don't re-throw — the server will simply not get results and use fallback
      });

      console.log('[AiWorkerBridge] Worker started');
    } catch (err) {
      console.warn('[AiWorkerBridge] Failed to start worker — distributed compute disabled:', err);
      this.worker = null;
    }

    // Start CPU heartbeat
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 1000);
  }

  /** Stop the worker and heartbeat. Call when leaving the room. */
  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** Forward an AiTask from the server to the worker thread. */
  handleTask(task: AiTask): void {
    if (!this.worker) return;
    // Check if this client has opted into computation
    if (this.getTaskCapacity() === 0) return;
    this.worker.postMessage(task);
  }

  /**
   * Record a frame time for CPU load estimation.
   * Call at the end of each render frame with the frame duration in ms.
   */
  recordFrameTime(frameMs: number): void {
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > this.frameTimeWindow) {
      this.frameTimes.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  /**
   * Get the task capacity (max enemies this client will compute per task).
   * 0 = opted out of distributed compute.
   * Stored in localStorage so it persists across sessions.
   */
  getTaskCapacity(): number {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    return stored !== null ? parseInt(stored, 10) : 30; // Default: up to 30 enemies
  }

  /**
   * Set the task capacity. Call from the settings UI.
   * capacity=0 opts the client out entirely.
   */
  setTaskCapacity(capacity: number): void {
    localStorage.setItem(this.STORAGE_KEY, String(Math.max(0, capacity)));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Send a validated AiResult back to the server. */
  private onWorkerResult(result: AiResult): void {
    this.room.send('ai_result', result);
  }

  /** Estimate CPU load from recent frame times and send heartbeat to server. */
  private sendHeartbeat(): void {
    if (this.frameTimes.length === 0) return;

    const avgFrameMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const targetFrameMs = 1000 / 60; // 16.67ms at 60Hz
    const load = Math.min(200, Math.round((avgFrameMs / targetFrameMs) * 100));

    const heartbeat: CpuHeartbeat = {
      type: 'cpu_heartbeat',
      load,
      taskCapacity: this.getTaskCapacity(),
    };

    this.room.send('cpu_heartbeat', heartbeat);
  }
}

// ---------------------------------------------------------------------------
// Settings UI helper (for the in-game debug panel)
// ---------------------------------------------------------------------------

/**
 * Returns HTML for the distributed compute settings panel.
 * Insert into the existing settings/debug overlay in network-main.ts.
 *
 * Example:
 * ```typescript
 * const bridge = new AiWorkerBridge(room);
 * document.getElementById('settings-panel').innerHTML += renderComputeSettings(bridge);
 * ```
 */
export function renderComputeSettings(bridge: AiWorkerBridge): string {
  const current = bridge.getTaskCapacity();

  return `
    <div class="compute-settings">
      <h3>Distributed Compute</h3>
      <p>Help the server by computing enemy AI on your device.</p>
      <label>
        Task capacity (enemies per batch):
        <input type="range" min="0" max="90" step="5" value="${current}"
          oninput="window.__aiBridge?.setTaskCapacity(parseInt(this.value));
                   document.getElementById('compute-capacity-display').textContent = this.value;">
      </label>
      <span id="compute-capacity-display">${current}</span>
      ${current === 0 ? '<em>(Opted out)</em>' : ''}
    </div>
  `;
}
