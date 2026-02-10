/**
 * Time-series performance data logger for interactive graphs.
 *
 * Records FPS, entity counts, bullet counts, and enemy type breakdowns
 * over time in a ring buffer. Data is sampled every 500ms and persisted
 * to localStorage after each game session.
 *
 * Supports 10-game counter with research report trigger notification.
 */

import { EnemyType } from '../entities/enemies/EnemySpawner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single time-series data point. */
export interface PerformanceDataPoint {
  /** Elapsed game time in seconds since session start. */
  time: number;
  /** FPS at this sample. */
  fps: number;
  /** Total enemy count. */
  enemyCount: number;
  /** Total bullet count. */
  bulletCount: number;
  /** Enemy type breakdown (counts per type). */
  enemyTypes: Map<EnemyType, number>;
}

/** Stored session data for localStorage persistence. */
export interface StoredSession {
  /** ISO timestamp. */
  timestamp: string;
  /** Map/surface type. */
  mapType: string;
  /** Duration in seconds. */
  duration: number;
  /** Time-series data points (serialized). */
  dataPoints: Array<{
    time: number;
    fps: number;
    enemyCount: number;
    bulletCount: number;
    enemyTypes: Array<[EnemyType, number]>;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RING_BUFFER_SIZE = 3600; // 30 minutes @ 500ms sampling = 3600 samples
const SAMPLE_INTERVAL = 0.5; // seconds
const STORAGE_KEY = 'geometry_wars_perf_timeseries';
const GAME_COUNTER_KEY = 'geometry_wars_game_counter';
const MAX_STORED_SESSIONS = 10; // Keep last 10 games for research report

// ---------------------------------------------------------------------------
// PerformanceLogger
// ---------------------------------------------------------------------------

export class PerformanceLogger {
  private readonly mapType: string;
  private readonly sessionStart: number;
  private sampleAccumulator = 0;

  // Ring buffer (pre-allocated for zero GC)
  private readonly buffer: PerformanceDataPoint[];
  private bufferIndex = 0;
  private bufferSize = 0;

  // Current frame data (set externally)
  private currentFps = 0;
  private currentEnemyCount = 0;
  private currentBulletCount = 0;
  private readonly currentEnemyTypes = new Map<EnemyType, number>();

  constructor(mapType: string) {
    this.mapType = mapType;
    this.sessionStart = Date.now();

    // Pre-allocate ring buffer
    this.buffer = new Array(RING_BUFFER_SIZE);
    for (let i = 0; i < RING_BUFFER_SIZE; i++) {
      this.buffer[i] = {
        time: 0,
        fps: 0,
        enemyCount: 0,
        bulletCount: 0,
        enemyTypes: new Map(),
      };
    }
  }

  // -- Per-frame API --------------------------------------------------------

  /**
   * Update the logger with current frame data.
   * Call this every frame BEFORE recordFrame().
   */
  setFrameData(fps: number, enemyCount: number, bulletCount: number): void {
    this.currentFps = fps;
    this.currentEnemyCount = enemyCount;
    this.currentBulletCount = bulletCount;
  }

  /**
   * Set enemy type breakdown for the current frame.
   * Call this after iterating through all enemies.
   */
  setEnemyTypes(enemyTypes: Map<EnemyType, number>): void {
    this.currentEnemyTypes.clear();
    enemyTypes.forEach((count, type) => {
      this.currentEnemyTypes.set(type, count);
    });
  }

  /**
   * Record a frame. Samples data at fixed intervals and stores in ring buffer.
   */
  recordFrame(dtSeconds: number): void {
    this.sampleAccumulator += dtSeconds;
    if (this.sampleAccumulator >= SAMPLE_INTERVAL) {
      this.sampleAccumulator -= SAMPLE_INTERVAL;
      this.takeSample();
    }
  }

  // -- Data access ----------------------------------------------------------

  /**
   * Get all recorded data points in chronological order.
   * Returns a copy to prevent external mutation.
   */
  getDataPoints(): PerformanceDataPoint[] {
    const result: PerformanceDataPoint[] = [];
    const count = Math.min(this.bufferSize, RING_BUFFER_SIZE);

    if (this.bufferSize < RING_BUFFER_SIZE) {
      // Buffer not full yet - return in order
      for (let i = 0; i < count; i++) {
        result.push(this.copyDataPoint(this.buffer[i]));
      }
    } else {
      // Buffer full - return from oldest to newest
      for (let i = 0; i < count; i++) {
        const idx = (this.bufferIndex + i) % RING_BUFFER_SIZE;
        result.push(this.copyDataPoint(this.buffer[idx]));
      }
    }

    return result;
  }

  /**
   * Get the data point with the minimum FPS and its enemy type breakdown.
   */
  getMinFPSMoment(): PerformanceDataPoint | null {
    if (this.bufferSize === 0) return null;

    let minIdx = 0;
    let minFps = Infinity;
    const count = Math.min(this.bufferSize, RING_BUFFER_SIZE);

    for (let i = 0; i < count; i++) {
      if (this.buffer[i].fps < minFps) {
        minFps = this.buffer[i].fps;
        minIdx = i;
      }
    }

    return this.copyDataPoint(this.buffer[minIdx]);
  }

  /**
   * Get the data point with the maximum FPS and its enemy type breakdown.
   */
  getMaxFPSMoment(): PerformanceDataPoint | null {
    if (this.bufferSize === 0) return null;

    let maxIdx = 0;
    let maxFps = -Infinity;
    const count = Math.min(this.bufferSize, RING_BUFFER_SIZE);

    for (let i = 0; i < count; i++) {
      if (this.buffer[i].fps > maxFps) {
        maxFps = this.buffer[i].fps;
        maxIdx = i;
      }
    }

    return this.copyDataPoint(this.buffer[maxIdx]);
  }

  // -- Persistence ----------------------------------------------------------

  /**
   * Save the current session to localStorage and increment game counter.
   * Returns true if this triggers the 10-game research report notification.
   */
  saveSession(): boolean {
    const stored: StoredSession = {
      timestamp: new Date().toISOString(),
      mapType: this.mapType,
      duration: (Date.now() - this.sessionStart) / 1000,
      dataPoints: this.serializeDataPoints(),
    };

    try {
      // Save session data
      const existing = this.loadAllSessions();
      existing.push(stored);
      const trimmed = existing.slice(-MAX_STORED_SESSIONS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));

      // Increment game counter
      const counter = this.getGameCounter() + 1;
      localStorage.setItem(GAME_COUNTER_KEY, String(counter));

      // Check if we hit 10 games
      return counter % 10 === 0;
    } catch {
      // localStorage unavailable or full
      return false;
    }
  }

  /**
   * Load all stored sessions from localStorage.
   */
  loadAllSessions(): StoredSession[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Corrupt data
    }
    return [];
  }

  /**
   * Get the current game counter value.
   */
  getGameCounter(): number {
    try {
      const raw = localStorage.getItem(GAME_COUNTER_KEY);
      if (raw) {
        return parseInt(raw, 10) || 0;
      }
    } catch {
      // Ignore
    }
    return 0;
  }

  /**
   * Reset the game counter (e.g., after viewing research report).
   */
  static resetGameCounter(): void {
    try {
      localStorage.setItem(GAME_COUNTER_KEY, '0');
    } catch {
      // Ignore
    }
  }

  /**
   * Clear all stored session data.
   */
  static clearAllSessions(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(GAME_COUNTER_KEY);
    } catch {
      // Ignore
    }
  }

  // -- Internal -------------------------------------------------------------

  private takeSample(): void {
    const elapsed = (Date.now() - this.sessionStart) / 1000;
    const point = this.buffer[this.bufferIndex];

    // Reuse existing object (zero-GC)
    point.time = elapsed;
    point.fps = this.currentFps;
    point.enemyCount = this.currentEnemyCount;
    point.bulletCount = this.currentBulletCount;

    // Copy enemy types
    point.enemyTypes.clear();
    this.currentEnemyTypes.forEach((count, type) => {
      point.enemyTypes.set(type, count);
    });

    this.bufferIndex = (this.bufferIndex + 1) % RING_BUFFER_SIZE;
    if (this.bufferSize < RING_BUFFER_SIZE) {
      this.bufferSize++;
    }
  }

  private copyDataPoint(point: PerformanceDataPoint): PerformanceDataPoint {
    return {
      time: point.time,
      fps: point.fps,
      enemyCount: point.enemyCount,
      bulletCount: point.bulletCount,
      enemyTypes: new Map(point.enemyTypes),
    };
  }

  private serializeDataPoints(): StoredSession['dataPoints'] {
    const result: StoredSession['dataPoints'] = [];
    const count = Math.min(this.bufferSize, RING_BUFFER_SIZE);

    if (this.bufferSize < RING_BUFFER_SIZE) {
      for (let i = 0; i < count; i++) {
        result.push(this.serializePoint(this.buffer[i]));
      }
    } else {
      for (let i = 0; i < count; i++) {
        const idx = (this.bufferIndex + i) % RING_BUFFER_SIZE;
        result.push(this.serializePoint(this.buffer[idx]));
      }
    }

    return result;
  }

  private serializePoint(point: PerformanceDataPoint): StoredSession['dataPoints'][number] {
    return {
      time: point.time,
      fps: point.fps,
      enemyCount: point.enemyCount,
      bulletCount: point.bulletCount,
      enemyTypes: Array.from(point.enemyTypes.entries()),
    };
  }
}
