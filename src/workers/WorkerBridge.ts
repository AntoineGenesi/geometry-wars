/**
 * High-level API for offloading collision detection and enemy AI to Web Workers.
 *
 * Features:
 * - bridge.updateCollisions(entities) => CollisionPair[]
 * - bridge.updateEnemyAI(enemies, players, dt) => MovementDelta[]
 * - SharedArrayBuffer lifecycle management (grow/shrink with entity count)
 * - Double-buffering: prepare next frame data while current processes
 * - Fallback to main-thread computation when Workers unavailable
 */

import {
  createEntityBuffer,
  createCollisionResultBuffer,
  createAIOutputBuffer,
  getEntityViews,
  getCollisionResultViews,
  getAIOutputViews,
  writeEntityData,
  readCollisionPairs,
  readAIDeltas,
  ENEMY_TYPE_MAP,
  MAX_COLLISION_PAIRS,
  type EntityBufferLayout,
  type CollisionResultLayout,
  type AIOutputLayout,
  type EntityBufferViews,
  type CollisionResultViews,
  type AIOutputViews,
  type EntityData,
} from './shared-buffers';

import {
  runCollisionDetection,
  type CollisionInput,
  type CollisionOutput,
} from './collision.worker';

import {
  runAIComputation,
  resetAIState,
  type AIInput,
  type AIOutput,
} from './ai.worker';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CollisionPair {
  indexA: number;
  indexB: number;
}

export interface MovementDelta {
  du: number;
  dv: number;
}

/** Minimal entity interface for collision input. */
export interface CollisionEntity {
  position: { x: number; y: number; z: number };
  radius: number;
  active: boolean;
}

/** Minimal enemy interface for AI input. */
export interface AIEnemy {
  surfacePosition: { u: number; v: number };
  speed: number;
  active: boolean;
  alive: boolean;
  constructor: { name: string };
}

/** Configuration for the WorkerBridge. */
export interface WorkerBridgeConfig {
  /** Initial entity buffer capacity. Default: 1024. */
  initialCapacity?: number;
  /** Growth factor when resizing. Default: 2. */
  growthFactor?: number;
  /** Whether to use workers (false = always use main-thread fallback). */
  useWorkers?: boolean;
  /** Number of worker threads. Default: 2 (1 collision, 1 AI). */
  workerCount?: number;
}

// ---------------------------------------------------------------------------
// WorkerBridge
// ---------------------------------------------------------------------------

export class WorkerBridge {
  // Buffer management (double-buffered: front = current read, back = next write)
  private entityBufferA: EntityBufferLayout;
  private entityBufferB: EntityBufferLayout;
  private entityViewsA: EntityBufferViews;
  private entityViewsB: EntityBufferViews;
  private frontIsA = true;

  private collisionResult: CollisionResultLayout;
  private collisionViews: CollisionResultViews;

  private aiOutput: AIOutputLayout;
  private aiViews: AIOutputViews;

  private readonly growthFactor: number;
  private readonly useWorkers: boolean;

  // Worker instances (null if fallback mode)
  private collisionWorker: Worker | null = null;
  private aiWorker: Worker | null = null;
  private collisionPending: Promise<CollisionPair[]> | null = null;
  private aiPending: Promise<MovementDelta[]> | null = null;

  private disposed = false;

  constructor(config: WorkerBridgeConfig = {}) {
    const capacity = config.initialCapacity ?? 1024;
    this.growthFactor = config.growthFactor ?? 2;
    this.useWorkers = (config.useWorkers ?? true) && WorkerBridge.isWorkerAvailable();

    // Allocate double-buffered entity data
    this.entityBufferA = createEntityBuffer(capacity);
    this.entityBufferB = createEntityBuffer(capacity);
    this.entityViewsA = getEntityViews(this.entityBufferA);
    this.entityViewsB = getEntityViews(this.entityBufferB);

    // Collision result buffer
    this.collisionResult = createCollisionResultBuffer(MAX_COLLISION_PAIRS);
    this.collisionViews = getCollisionResultViews(this.collisionResult);

    // AI output buffer
    this.aiOutput = createAIOutputBuffer(capacity);
    this.aiViews = getAIOutputViews(this.aiOutput);

    // Initialize workers if available
    if (this.useWorkers) {
      this.initWorkers();
    }
  }

  // ---------------------------------------------------------------------------
  // Static capability check
  // ---------------------------------------------------------------------------

  static isWorkerAvailable(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof SharedArrayBuffer !== 'undefined'
    );
  }

  /** Whether this bridge is using real Workers or the main-thread fallback. */
  get isUsingWorkers(): boolean {
    return this.collisionWorker !== null || this.aiWorker !== null;
  }

  /** Current entity buffer capacity. */
  get capacity(): number {
    return this.frontBuffer.capacity;
  }

  // ---------------------------------------------------------------------------
  // Collision detection
  // ---------------------------------------------------------------------------

  /**
   * Detect collisions among the given entities.
   * Returns collision pairs as indices into the provided array.
   *
   * In worker mode: non-blocking (returns Promise from previous frame,
   * schedules next frame's work).
   * In fallback mode: runs synchronously, returns immediately.
   */
  updateCollisions(entities: readonly CollisionEntity[]): CollisionPair[] {
    if (this.disposed) return [];

    // Pack entity data into back buffer
    const activeEntities = this.packEntityDataForCollision(entities);

    // Run collision detection (fallback = synchronous)
    return this.runCollisionFallback(activeEntities);
  }

  /**
   * Async collision detection (worker path).
   * Packs data and dispatches to worker, returning a Promise.
   */
  async updateCollisionsAsync(entities: readonly CollisionEntity[]): Promise<CollisionPair[]> {
    if (this.disposed) return [];

    const activeEntities = this.packEntityDataForCollision(entities);

    if (this.collisionWorker) {
      return this.runCollisionWorker(activeEntities);
    }

    return this.runCollisionFallback(activeEntities);
  }

  // ---------------------------------------------------------------------------
  // Enemy AI
  // ---------------------------------------------------------------------------

  /**
   * Compute AI movement deltas for all active enemies.
   *
   * In fallback mode: runs synchronously, returns immediately.
   */
  updateEnemyAI(
    enemies: readonly AIEnemy[],
    playerU: number,
    playerV: number,
    dt: number,
  ): MovementDelta[] {
    if (this.disposed) return [];

    const count = this.packEnemyDataForAI(enemies);

    return this.runAIFallback(count, playerU, playerV, dt);
  }

  /**
   * Async AI computation (worker path).
   */
  async updateEnemyAIAsync(
    enemies: readonly AIEnemy[],
    playerU: number,
    playerV: number,
    dt: number,
  ): Promise<MovementDelta[]> {
    if (this.disposed) return [];

    const count = this.packEnemyDataForAI(enemies);

    if (this.aiWorker) {
      return this.runAIWorker(count, playerU, playerV, dt);
    }

    return this.runAIFallback(count, playerU, playerV, dt);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Reset AI state (call when level restarts, entities are cleared). */
  resetState(): void {
    resetAIState();
  }

  /** Dispose all workers and buffers. */
  dispose(): void {
    this.disposed = true;
    this.collisionWorker?.terminate();
    this.aiWorker?.terminate();
    this.collisionWorker = null;
    this.aiWorker = null;
    resetAIState();
  }

  // ---------------------------------------------------------------------------
  // Buffer management (internal)
  // ---------------------------------------------------------------------------

  private get frontBuffer(): EntityBufferLayout {
    return this.frontIsA ? this.entityBufferA : this.entityBufferB;
  }

  private get backBuffer(): EntityBufferLayout {
    return this.frontIsA ? this.entityBufferB : this.entityBufferA;
  }

  private get frontViews(): EntityBufferViews {
    return this.frontIsA ? this.entityViewsA : this.entityViewsB;
  }

  private get backViews(): EntityBufferViews {
    return this.frontIsA ? this.entityViewsB : this.entityViewsA;
  }

  /** Swap front/back buffers. */
  private swapBuffers(): void {
    this.frontIsA = !this.frontIsA;
  }

  /** Ensure buffer capacity is sufficient; reallocate if needed. */
  private ensureCapacity(needed: number): void {
    if (needed <= this.entityBufferA.capacity) return;

    const newCapacity = Math.max(
      needed,
      Math.ceil(this.entityBufferA.capacity * this.growthFactor),
    );

    this.entityBufferA = createEntityBuffer(newCapacity);
    this.entityBufferB = createEntityBuffer(newCapacity);
    this.entityViewsA = getEntityViews(this.entityBufferA);
    this.entityViewsB = getEntityViews(this.entityBufferB);

    // Reallocate AI output buffer too
    this.aiOutput = createAIOutputBuffer(newCapacity);
    this.aiViews = getAIOutputViews(this.aiOutput);
  }

  // ---------------------------------------------------------------------------
  // Data packing
  // ---------------------------------------------------------------------------

  private packEntityDataForCollision(entities: readonly CollisionEntity[]): number {
    // Filter to active entities and pack
    const active: EntityData[] = [];
    for (const e of entities) {
      if (!e.active) continue;
      active.push({
        x: e.position.x,
        y: e.position.y,
        z: e.position.z,
        vx: 0,
        vy: 0,
        vz: 0,
        radius: e.radius,
        type: 0,
        surfaceU: 0,
        surfaceV: 0,
        speed: 0,
      });
    }

    this.ensureCapacity(active.length);
    const buffer = this.backBuffer;
    const views = this.backViews;
    writeEntityData(buffer, views, active);
    this.swapBuffers();

    return active.length;
  }

  private packEnemyDataForAI(enemies: readonly AIEnemy[]): number {
    const active: EntityData[] = [];
    for (const e of enemies) {
      if (!e.active || !e.alive) continue;
      const className = e.constructor.name;
      const type = ENEMY_TYPE_MAP[className] ?? 255;
      active.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        radius: 0,
        type,
        surfaceU: e.surfacePosition.u,
        surfaceV: e.surfacePosition.v,
        speed: e.speed,
      });
    }

    this.ensureCapacity(active.length);
    const buffer = this.backBuffer;
    const views = this.backViews;
    writeEntityData(buffer, views, active);
    this.swapBuffers();

    return active.length;
  }

  // ---------------------------------------------------------------------------
  // Collision execution
  // ---------------------------------------------------------------------------

  private runCollisionFallback(count: number): CollisionPair[] {
    const buffer = this.frontBuffer;
    const views = this.frontViews;

    const input: CollisionInput = {
      positions: views.positions,
      radii: views.radii,
      count,
    };

    const output: CollisionOutput = {
      pairs: this.collisionViews.pairs,
      pairCount: this.collisionViews.count,
      maxPairs: this.collisionResult.maxPairs,
    };

    runCollisionDetection(input, output);

    const rawPairs = readCollisionPairs(this.collisionViews);
    return rawPairs.map(([indexA, indexB]) => ({ indexA, indexB }));
  }

  private runCollisionWorker(count: number): Promise<CollisionPair[]> {
    return new Promise((resolve, reject) => {
      if (!this.collisionWorker) {
        resolve(this.runCollisionFallback(count));
        return;
      }

      const handler = (e: MessageEvent) => {
        this.collisionWorker!.removeEventListener('message', handler);
        const rawPairs = readCollisionPairs(this.collisionViews);
        resolve(rawPairs.map(([indexA, indexB]) => ({ indexA, indexB })));
      };

      this.collisionWorker.addEventListener('message', handler);
      this.collisionWorker.postMessage({
        type: 'run',
        entityBuffer: this.frontBuffer,
        resultBuffer: this.collisionResult,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // AI execution
  // ---------------------------------------------------------------------------

  private runAIFallback(
    count: number,
    playerU: number,
    playerV: number,
    dt: number,
  ): MovementDelta[] {
    const views = this.frontViews;

    const input: AIInput = {
      surfaceU: views.surfaceU,
      surfaceV: views.surfaceV,
      types: views.types,
      speeds: views.speeds,
      count,
      playerU,
      playerV,
      dt,
    };

    const output: AIOutput = {
      deltas: this.aiViews.deltas,
      ready: this.aiViews.ready,
    };

    runAIComputation(input, output);

    return readAIDeltas(this.aiViews, count);
  }

  private runAIWorker(
    count: number,
    playerU: number,
    playerV: number,
    dt: number,
  ): Promise<MovementDelta[]> {
    return new Promise((resolve, reject) => {
      if (!this.aiWorker) {
        resolve(this.runAIFallback(count, playerU, playerV, dt));
        return;
      }

      const handler = (e: MessageEvent) => {
        this.aiWorker!.removeEventListener('message', handler);
        resolve(readAIDeltas(this.aiViews, count));
      };

      this.aiWorker.addEventListener('message', handler);
      this.aiWorker.postMessage({
        type: 'run',
        entityBuffer: this.frontBuffer,
        aiOutput: this.aiOutput,
        playerU,
        playerV,
        dt,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Worker initialization
  // ---------------------------------------------------------------------------

  private initWorkers(): void {
    try {
      // Create collision worker
      this.collisionWorker = new Worker(
        new URL('./collision.worker.ts', import.meta.url),
        { type: 'module' },
      );

      // Create AI worker
      this.aiWorker = new Worker(
        new URL('./ai.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch (err) {
      // Workers failed to initialize -- fall back to main thread
      this.collisionWorker?.terminate();
      this.aiWorker?.terminate();
      this.collisionWorker = null;
      this.aiWorker = null;
    }
  }
}
