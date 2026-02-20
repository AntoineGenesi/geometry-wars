/**
 * AI Task Dispatcher — Phase 2
 *
 * Orchestrates client-side AI computation for enemy movement.
 * Each game tick, this class:
 *   1. Decides how many enemies to delegate (based on sharedLoadPercent)
 *   2. Selects an eligible client from ComputationPool
 *   3. Sends an AiTask to that client
 *   4. Receives and validates AiResult messages
 *   5. Returns validated results for application to game state
 *
 * The server ALWAYS computes the full AI authoritatively. Client results
 * are applied only when they pass validation AND arrive before the tick
 * deadline (2 ticks = 33ms). This means the system degrades gracefully:
 * if all clients are slow or cheating, the game is unaffected — it just
 * runs at 100% server load.
 *
 * VALIDATION LAYERS:
 *   V1 — Range clamping: each du/dv is within the physically possible range
 *   V2 — Cross-validation: server re-computes 10% and checks agreement
 *   V3 — (Optional) Dual-client redundancy: same task sent to 2 clients
 *
 * INTEGRATION WITH GameRoom.ts:
 *   See GameRoom.patched.ts for the full diff showing exactly which lines
 *   change and what gets added.
 *
 * ENEMY AI ALGORITHM (must match exactly between server and client):
 *   For each enemy, find the nearest alive player (UV-space euclidean),
 *   move toward it at getEnemySpeed(type) UV/s, apply toroidal wrapping.
 *   See computeServerAI() below — this is the canonical implementation.
 */

import { ComputationPool } from './ComputationPool';
import type {
  AiTask,
  AiResult,
  EnemyMoveResult,
  EnemySnapshot,
  PlayerSnapshot,
} from '../protocol/messages';

// ---------------------------------------------------------------------------
// Types (mirroring Colyseus schema fields we need)
// ---------------------------------------------------------------------------

interface EnemyLike {
  id: string;
  type: string;
  surfaceU: number;
  surfaceV: number;
  alive: boolean;
}

interface PlayerLike {
  id: string;
  surfaceU: number;
  surfaceV: number;
  alive: boolean;
}

type SendFn = (sessionId: string, type: string, data: unknown) => void;
type SendAckFn = (sessionId: string, taskId: string, outcome: string, rejectionCount: number) => void;

// Enemy speeds in UV/s (must stay in sync with GameRoom.ts getEnemySpeed())
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
// In-flight task tracking
// ---------------------------------------------------------------------------

interface InFlightTask {
  taskId: string;
  tick: number;
  assignedTo: string;   // sessionId of the client
  sentAt: number;       // Date.now()
  enemies: EnemySnapshot[];
  players: PlayerSnapshot[];
  dt: number;
}

let taskCounter = 0;

export class AiTaskDispatcher {
  private pool: ComputationPool;
  private sendFn: SendFn;
  private sendAckFn: SendAckFn;

  // In-flight tasks: taskId → task
  private inFlight: Map<string, InFlightTask> = new Map();

  // Results that have been validated and are ready to apply
  // Maps enemyId → { du, dv } for the current tick
  private pendingResults: Map<string, EnemyMoveResult> = new Map();

  // Rejection tracking per client (for SendAck)
  private clientRejections: Map<string, number> = new Map();

  // Max ticks a result can be late before being discarded
  private readonly maxLateTicks = 2;
  private readonly tickDurationMs = 1000 / 60;
  private readonly crossValidateFraction = 0.1; // Validate 10% of results

  constructor(pool: ComputationPool, sendFn: SendFn, sendAckFn: SendAckFn) {
    this.pool = pool;
    this.sendFn = sendFn;
    this.sendAckFn = sendAckFn;
  }

  /**
   * Called at the start of each tick. Dispatches AI tasks for a fraction
   * of enemies to eligible clients.
   *
   * @param tick - Current server tick number
   * @param enemies - All alive enemies
   * @param players - All alive players
   * @param dt - Delta time in seconds (1/60)
   */
  dispatchTasks(
    tick: number,
    enemies: EnemyLike[],
    players: PlayerLike[],
    dt: number,
  ): void {
    const sharedLoad = this.pool.getSharedLoad();
    if (sharedLoad === 0 || enemies.length === 0) return;

    const clientId = this.pool.selectClient();
    if (!clientId) return;

    // Determine how many enemies to delegate
    const delegateCount = Math.floor(enemies.length * (sharedLoad / 100));
    if (delegateCount === 0) return;

    // Select enemies to delegate (first N — could be randomised for anti-patterns)
    const delegated = enemies.slice(0, delegateCount);

    const playerSnapshots: PlayerSnapshot[] = players.map(p => ({
      id: p.id,
      u: p.surfaceU,
      v: p.surfaceV,
      alive: p.alive,
    }));

    const enemySnapshots: EnemySnapshot[] = delegated.map(e => ({
      id: e.id,
      type: e.type,
      u: e.surfaceU,
      v: e.surfaceV,
    }));

    const taskId = `task_${taskCounter++}`;
    const task: AiTask = {
      type: 'ai_task',
      taskId,
      tick,
      enemies: enemySnapshots,
      players: playerSnapshots,
      dt,
      surfaceType: 'sphere', // Caller should pass this; hardcoded here for brevity
    };

    this.inFlight.set(taskId, {
      taskId,
      tick,
      assignedTo: clientId,
      sentAt: Date.now(),
      enemies: enemySnapshots,
      players: playerSnapshots,
      dt,
    });

    this.sendFn(clientId, 'ai_task', task);
    this.pool.recordTaskSent(clientId);
  }

  /**
   * Called when a client sends back an AiResult message.
   * Validates and stores results for application this tick (if not stale).
   */
  receiveResult(result: AiResult, currentTick: number): void {
    const task = this.inFlight.get(result.taskId);
    if (!task) {
      console.warn(`[AiTaskDispatcher] Unknown taskId: ${result.taskId}`);
      return;
    }

    this.inFlight.delete(result.taskId);

    // Discard stale results (arrived too late to be useful)
    const tickAge = currentTick - task.tick;
    if (tickAge > this.maxLateTicks) {
      this.sendAckFn(task.assignedTo, result.taskId, 'rejected_stale', 0);
      return;
    }

    // V1: Range validation
    const { valid, rejected } = this.validateRanges(result.results, task.enemies, task.dt);
    if (valid.length === 0) {
      const count = this.incrementRejections(task.assignedTo);
      this.pool.recordValidationResult(task.assignedTo, true);
      this.sendAckFn(task.assignedTo, result.taskId, 'rejected_validation', count);
      return;
    }

    // V2: Cross-validation — recompute a sample on the server
    const crossValid = this.crossValidate(valid, task.enemies, task.players, task.dt);
    if (!crossValid) {
      const count = this.incrementRejections(task.assignedTo);
      this.pool.recordValidationResult(task.assignedTo, true);
      this.sendAckFn(task.assignedTo, result.taskId, 'rejected_validation', count);
      return;
    }

    // Store validated results
    for (const r of valid) {
      this.pendingResults.set(r.id, r);
    }

    // Log any partially rejected entries from V1
    if (rejected.length > 0) {
      console.warn(
        `[AiTaskDispatcher] ${rejected.length}/${result.results.length} results rejected ` +
        `from client ${task.assignedTo} (range violation)`
      );
    }

    this.pool.recordValidationResult(task.assignedTo, false);
    this.sendAckFn(task.assignedTo, result.taskId, 'applied', 0);
  }

  /**
   * Called by the server's updateEnemies() to get a validated client result
   * for a specific enemy. Returns null if no validated result is available
   * (server should use its own computation as fallback).
   */
  getValidatedResult(enemyId: string): EnemyMoveResult | null {
    return this.pendingResults.get(enemyId) ?? null;
  }

  /**
   * Call at the END of each tick to clear consumed results.
   * Also cleans up in-flight tasks that have timed out.
   */
  endTick(currentTick: number): void {
    this.pendingResults.clear();

    // Clean up very stale in-flight tasks (client disconnected or very slow)
    const maxAgeMs = this.maxLateTicks * this.tickDurationMs * 3;
    for (const [id, task] of this.inFlight) {
      if (Date.now() - task.sentAt > maxAgeMs) {
        console.warn(`[AiTaskDispatcher] Discarding stale in-flight task ${id}`);
        this.inFlight.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  /**
   * V1: Range validation — rejects results outside the physically possible range.
   * Returns { valid: accepted results, rejected: rejected results }.
   */
  private validateRanges(
    results: EnemyMoveResult[],
    snapshots: EnemySnapshot[],
    dt: number,
  ): { valid: EnemyMoveResult[]; rejected: EnemyMoveResult[] } {
    const snapshotMap = new Map(snapshots.map(s => [s.id, s]));
    const valid: EnemyMoveResult[] = [];
    const rejected: EnemyMoveResult[] = [];

    for (const r of results) {
      const snapshot = snapshotMap.get(r.id);
      if (!snapshot) {
        rejected.push(r); // Unknown enemy ID — reject
        continue;
      }

      if (!isFinite(r.du) || !isFinite(r.dv)) {
        rejected.push(r); // NaN / Infinity — reject
        continue;
      }

      const maxSpeed = getEnemySpeed(snapshot.type) * dt * 1.1; // 10% tolerance
      const mag = Math.hypot(r.du, r.dv);
      if (mag > maxSpeed) {
        rejected.push(r); // Too fast — reject
        continue;
      }

      valid.push(r);
    }

    return { valid, rejected };
  }

  /**
   * V2: Cross-validation — server recomputes a random sample and checks agreement.
   * Returns true if the sample passes, false if the client result is suspicious.
   */
  private crossValidate(
    results: EnemyMoveResult[],
    snapshots: EnemySnapshot[],
    players: PlayerSnapshot[],
    dt: number,
  ): boolean {
    if (results.length === 0) return true;

    const sampleSize = Math.max(1, Math.floor(results.length * this.crossValidateFraction));
    const indices = pickRandom(results.length, sampleSize);
    const snapshotMap = new Map(snapshots.map(s => [s.id, s]));

    let flags = 0;
    for (const idx of indices) {
      const result = results[idx];
      const snapshot = snapshotMap.get(result.id);
      if (!snapshot) { flags++; continue; }

      const expected = computeServerAI(snapshot, players, dt);
      const deviation = Math.hypot(result.du - expected.du, result.dv - expected.dv);

      // Allow 1% tolerance for floating-point rounding differences
      if (deviation > 0.001) {
        flags++;
      }
    }

    // Allow 1 outlier per sample for floating-point rounding
    return flags <= 1;
  }

  private incrementRejections(sessionId: string): number {
    const count = (this.clientRejections.get(sessionId) ?? 0) + 1;
    this.clientRejections.set(sessionId, count);
    return count;
  }
}

// ---------------------------------------------------------------------------
// Server AI computation — canonical implementation
// ---------------------------------------------------------------------------

/**
 * Compute the expected movement delta for a single enemy.
 *
 * THIS FUNCTION MUST BE IDENTICAL BETWEEN SERVER AND CLIENT.
 * Any divergence (different clamping, different speed values, different
 * toroidal distance formula) will cause cross-validation failures for
 * honest clients.
 *
 * Algorithm: nearest-player homing in UV space.
 * - Find the nearest alive player using toroidal euclidean distance.
 * - Move toward them at getEnemySpeed(type) UV/s.
 * - Apply toroidal wrapping (shortest path across the UV boundary).
 */
export function computeServerAI(
  enemy: EnemySnapshot,
  players: PlayerSnapshot[],
  dt: number,
): EnemyMoveResult {
  let nearestDu = 0;
  let nearestDv = 0;
  let nearestDist = Infinity;

  for (const player of players) {
    if (!player.alive) continue;

    // Toroidal UV distance (shortest path across boundary)
    const rawDu = player.u - enemy.u;
    const rawDv = player.v - enemy.v;
    const du = toroidalDist(rawDu);
    const dv = toroidalDist(rawDv);
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

function toroidalDist(delta: number): number {
  let d = delta % 1;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

function pickRandom(length: number, count: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  // Fisher-Yates partial shuffle
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (length - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count);
}
