/**
 * Computation Pool — Phase 2
 *
 * Manages the set of clients eligible to receive AI computation tasks.
 * Responsibilities:
 *   - Track CPU load per client (from cpu_heartbeat messages)
 *   - Select the best client for a task (lowest load, in pool)
 *   - Track rejection/error rates and evict cheating clients
 *   - Expose the shared load percentage setting (0–100%)
 *
 * EVICTION POLICY:
 * A client is removed from the pool if its validation rejection rate
 * exceeds 5% over the last 100 tasks. This catches both cheating and
 * buggy clients. They can re-enter the pool after 30 seconds if they
 * send a clean cpu_heartbeat.
 *
 * TRUST MODEL:
 * This is designed for a LAN game where players are friends. The anti-cheat
 * here prevents accidental bugs and casual cheating, not adversarial attacks.
 * For public internet, add dual-client redundancy (see AiTaskDispatcher.ts).
 */

interface ClientRecord {
  sessionId: string;
  cpuLoad: number;          // 0–100+, from latest heartbeat
  taskCapacity: number;     // Max enemies per task (client self-reported)
  inPool: boolean;          // Is this client eligible to receive tasks?
  lastHeartbeat: number;    // Date.now() of last heartbeat
  tasksAssigned: number;    // Total tasks sent to this client
  tasksRejected: number;    // Tasks rejected by validation in last window
  recentTaskWindow: number; // Last N tasks for rejection rate calculation
  evictedUntil: number;     // Timestamp after which the client may re-enter pool
}

export interface PoolStats {
  totalClients: number;
  eligibleClients: number;
  avgCpuLoad: number;
  sharedLoadPercent: number;
}

export class ComputationPool {
  private clients: Map<string, ClientRecord> = new Map();
  private sharedLoadPercent: number = 0; // 0 = off, 100 = max delegation

  // Eviction parameters
  private readonly rejectionRateLimit = 0.05;       // >5% rejection → evict
  private readonly rejectionWindowSize = 100;        // over last 100 tasks
  private readonly evictionDurationMs = 30_000;      // 30s eviction period
  private readonly heartbeatTimeoutMs = 5_000;       // Remove from pool if no heartbeat for 5s

  /** Set the global shared load percentage (0–100). */
  setSharedLoad(percent: number): void {
    this.sharedLoadPercent = Math.max(0, Math.min(100, percent));
  }

  /** Get the current shared load percentage. */
  getSharedLoad(): number {
    return this.sharedLoadPercent;
  }

  /** Register a new client (call in onJoin). */
  addClient(sessionId: string): void {
    this.clients.set(sessionId, {
      sessionId,
      cpuLoad: 50,        // Assume moderate load until we hear otherwise
      taskCapacity: 30,   // Conservative default
      inPool: true,
      lastHeartbeat: Date.now(),
      tasksAssigned: 0,
      tasksRejected: 0,
      recentTaskWindow: 0,
      evictedUntil: 0,
    });
  }

  /** Remove a client (call in onLeave). */
  removeClient(sessionId: string): void {
    this.clients.delete(sessionId);
  }

  /**
   * Update a client's CPU load from a heartbeat message.
   * Also handles re-entry of evicted clients.
   */
  updateHeartbeat(sessionId: string, load: number, taskCapacity: number): void {
    const client = this.clients.get(sessionId);
    if (!client) return;

    client.cpuLoad = Math.max(0, load);
    client.taskCapacity = Math.max(0, taskCapacity);
    client.lastHeartbeat = Date.now();

    // Allow evicted client back into pool if eviction period has passed
    if (!client.inPool && Date.now() >= client.evictedUntil) {
      client.inPool = true;
      client.tasksRejected = 0;
      client.recentTaskWindow = 0;
      console.log(`[ComputationPool] ${sessionId} re-entered computation pool`);
    }
  }

  /**
   * Select the best client to receive a task.
   *
   * Returns null if:
   *   - sharedLoadPercent === 0 (feature disabled)
   *   - No eligible clients (all overloaded, evicted, or unresponsive)
   *
   * Selection criteria (in order):
   *   1. Must be in pool and not evicted
   *   2. Must have recent heartbeat (< heartbeatTimeoutMs)
   *   3. Must have cpuLoad < 70 (not overloaded)
   *   4. Among eligible, pick the one with lowest cpuLoad
   */
  selectClient(): string | null {
    if (this.sharedLoadPercent === 0) return null;

    const now = Date.now();
    let bestClient: ClientRecord | null = null;

    for (const client of this.clients.values()) {
      if (!client.inPool) continue;
      if (now - client.lastHeartbeat > this.heartbeatTimeoutMs) continue;
      if (client.cpuLoad >= 70) continue;
      if (client.taskCapacity === 0) continue;

      if (!bestClient || client.cpuLoad < bestClient.cpuLoad) {
        bestClient = client;
      }
    }

    return bestClient?.sessionId ?? null;
  }

  /**
   * Record that a task was sent to a client.
   * Called in AiTaskDispatcher after dispatching.
   */
  recordTaskSent(sessionId: string): void {
    const client = this.clients.get(sessionId);
    if (!client) return;
    client.tasksAssigned++;
    // Note: recentTaskWindow is incremented in recordValidationResult (when result arrives),
    // not here (when task is sent). This means the rejection rate is measured over completed
    // tasks (with results), not dispatched tasks.
  }

  /**
   * Record a validation outcome for a task result.
   * Called in AiTaskDispatcher after validating.
   */
  recordValidationResult(sessionId: string, rejected: boolean): void {
    const client = this.clients.get(sessionId);
    if (!client) return;

    // Increment window here (per completed/validated task, not per sent task)
    client.recentTaskWindow++;

    if (rejected) {
      client.tasksRejected++;
    }

    // Check rejection rate every 10 tasks (sliding window approximation)
    if (client.recentTaskWindow >= this.rejectionWindowSize) {
      const rate = client.tasksRejected / client.recentTaskWindow;
      if (rate > this.rejectionRateLimit) {
        this.evictClient(client);
      }
      // Reset window
      client.tasksRejected = 0;
      client.recentTaskWindow = 0;
    }
  }

  /** Get pool statistics for the debug overlay. */
  getStats(): PoolStats {
    let eligible = 0;
    let totalLoad = 0;
    const now = Date.now();

    for (const client of this.clients.values()) {
      if (client.inPool && now - client.lastHeartbeat <= this.heartbeatTimeoutMs) {
        eligible++;
        totalLoad += client.cpuLoad;
      }
    }

    return {
      totalClients: this.clients.size,
      eligibleClients: eligible,
      avgCpuLoad: eligible > 0 ? totalLoad / eligible : 0,
      sharedLoadPercent: this.sharedLoadPercent,
    };
  }

  private evictClient(client: ClientRecord): void {
    client.inPool = false;
    client.evictedUntil = Date.now() + this.evictionDurationMs;
    console.warn(
      `[ComputationPool] Evicted ${client.sessionId} from computation pool ` +
      `(rejection rate: ${(client.tasksRejected / client.recentTaskWindow * 100).toFixed(1)}%)`
    );
  }
}
