/**
 * Distributed Computation Protocol — Message Definitions
 *
 * All messages flowing between the game server (GameRoom.ts) and clients
 * for the distributed computation system. These are custom Colyseus messages
 * (room.send()), not schema state — so they are NOT automatically diffed and
 * patched; they are fire-and-forget with explicit handling on both sides.
 *
 * Message flow overview:
 *
 *   Server → Client:
 *     'ai_task'          — "compute AI moves for these enemies"
 *     'cpu_task_ack'     — "received your result, here's the outcome"
 *
 *   Client → Server:
 *     'ai_result'        — "here are the computed moves"
 *     'cpu_heartbeat'    — "here is my current CPU load"
 *
 *   Internal (Worker Thread → Main Thread, via postMessage):
 *     CollisionTask      — "check these bullets vs enemies"
 *     CollisionResult    — "these pairs are hitting"
 */

// ---------------------------------------------------------------------------
// Client ↔ Server messages (over Colyseus WebSocket)
// ---------------------------------------------------------------------------

/**
 * Server → Client: delegated AI computation task.
 *
 * The server sends a snapshot of positions for a subset of enemies and all
 * alive players. The client computes nearest-player homing for each enemy
 * and returns an AiResult. The snapshot is stateless — the client does NOT
 * need any prior game state to compute the result.
 *
 * Note: `enemies` is a subset, not all enemies. The server retains the rest.
 */
export interface AiTask {
  type: 'ai_task';
  taskId: string;           // Unique ID for this task (UUID v4 or incrementing counter)
  tick: number;             // Server tick number this task was generated for
  enemies: EnemySnapshot[]; // Subset of enemies the client should compute AI for
  players: PlayerSnapshot[]; // All alive players (needed for nearest-player search)
  dt: number;               // Delta time in seconds (1/60 for 60Hz)
  surfaceType: string;      // e.g. 'sphere', 'torus' — needed for UV wrapping logic
}

/**
 * Client → Server: computed AI results for a delegated task.
 *
 * The client returns one result per enemy in the task. The server validates
 * each result before applying it.
 */
export interface AiResult {
  type: 'ai_result';
  taskId: string;   // Must match the taskId from the corresponding AiTask
  tick: number;     // Tick number from the task (used to detect stale results)
  results: EnemyMoveResult[];
}

/**
 * Client → Server: periodic CPU load heartbeat.
 *
 * Sent every ~1 second. The server uses this to weight task distribution
 * toward clients with spare capacity.
 *
 * `load` is 0–100: percentage of a 16.6ms frame budget currently consumed.
 * Measured as: (frame_duration_ms / 16.6) * 100
 */
export interface CpuHeartbeat {
  type: 'cpu_heartbeat';
  load: number;             // 0 = idle, 100 = frame budget fully consumed, >100 = overloaded
  taskCapacity: number;     // Client's self-reported max enemies per task (0 = opt out)
}

/**
 * Server → Client: acknowledgement of a received AiResult.
 *
 * Tells the client whether their result was accepted, rejected, or stale.
 * Used for client-side telemetry and trust tracking (the client can show
 * a debug overlay of its acceptance rate).
 */
export interface CpuTaskAck {
  type: 'cpu_task_ack';
  taskId: string;
  outcome: 'applied' | 'rejected_stale' | 'rejected_validation' | 'fallback_used';
  rejectionCount: number; // Server's running count of how many results this client has had rejected
}

// ---------------------------------------------------------------------------
// Data shapes embedded in messages
// ---------------------------------------------------------------------------

/** Minimal enemy state needed for AI computation. */
export interface EnemySnapshot {
  id: string;       // Enemy ID — must be echoed back in EnemyMoveResult
  type: string;     // Enemy type string — needed to look up speed
  u: number;        // Current UV u-coordinate (0–1)
  v: number;        // Current UV v-coordinate (0–1)
}

/** Minimal player state needed for nearest-player search. */
export interface PlayerSnapshot {
  id: string;
  u: number;        // UV u-coordinate
  v: number;        // UV v-coordinate
  alive: boolean;   // Dead players should not attract enemies
}

/** One enemy's computed movement delta for a single tick. */
export interface EnemyMoveResult {
  id: string;       // Must match EnemySnapshot.id
  du: number;       // UV u-delta to apply (not absolute position — delta from current)
  dv: number;       // UV v-delta to apply
}

// ---------------------------------------------------------------------------
// Internal: Node.js Worker Thread messages (main ↔ collision worker)
// ---------------------------------------------------------------------------

/**
 * Main Thread → Worker: collision detection task.
 *
 * Serialised as a plain object (no class instances — worker threads
 * communicate via structured clone, not shared memory by default).
 *
 * `bullets` and `enemies` are flattened arrays for zero-copy transfer
 * via SharedArrayBuffer or Transferable. See CollisionWorkerBridge.ts for
 * the packing/unpacking logic.
 */
export interface CollisionTask {
  taskId: number;           // Monotonic counter, used to pair with CollisionResult
  tick: number;             // Server tick — used to detect double-buffering issues

  // Flattened enemy array: [id0, u0, v0, id1, u1, v1, ...]
  // Using parallel arrays instead of objects avoids GC pressure on frequent postMessage.
  enemyIds: string[];
  enemyU: Float32Array;
  enemyV: Float32Array;

  // Flattened bullet array: [id0, x0, y0, ownerId0, id1, x1, y1, ownerId1, ...]
  bulletIds: string[];
  bulletX: Float32Array;
  bulletY: Float32Array;
  bulletOwnerIds: string[];

  // Collision radius thresholds
  bulletEnemyRadius: number;  // Default 0.05
  playerEnemyRadius: number;  // Default 0.04 (players not in this task — server handles)

  // Spatial hash parameters
  cellSize: number;   // e.g. 0.1 — determines bucket granularity
}

/**
 * Worker → Main Thread: collision detection results.
 *
 * Only contains the pairs that actually collided. The main thread applies
 * effects (health damage, score, removal) based on these pairs.
 */
export interface CollisionResult {
  taskId: number;   // Matches CollisionTask.taskId
  tick: number;     // Matches CollisionTask.tick

  /** Bullet-enemy hits: [bulletId, enemyId, ...] pairs. */
  bulletEnemyHits: Array<{ bulletId: string; enemyId: string }>;

  /** Processing time in ms (for profiling). */
  processingMs: number;
}
