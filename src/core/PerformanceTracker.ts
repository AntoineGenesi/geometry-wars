/**
 * Performance data tracker for debug mode.
 *
 * Records per-frame snapshots (FPS, entity count, bullet count) and
 * maintains sorted top-10 lists for highest/lowest FPS and highest
 * entity/bullet counts.  Persists session logs to localStorage with
 * timestamps and map type for correlation with git history.
 */

import { EnemyType } from '../entities/enemies/EnemySpawner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single performance snapshot at a point in time. */
export interface PerfSnapshot {
  /** Wall-clock timestamp (ms since epoch). */
  timestamp: number;
  /** FPS at this moment. */
  fps: number;
  /** Active enemy count. */
  entityCount: number;
  /** Active bullet count. */
  bulletCount: number;
  /** Current surface/map type. */
  mapType: string;
  /** Enemy type breakdown (optional, only in detailed snapshots). */
  enemyTypes?: Map<EnemyType, number>;
}

/** A ranked performance moment (stored in top-10 lists). */
export interface PerfMoment extends PerfSnapshot {
  /** Human-readable time string (HH:MM:SS). */
  timeLabel: string;
  /** Elapsed game seconds since session start. */
  elapsedSeconds: number;
  /** Enemy type breakdown. */
  enemyTypes: Map<EnemyType, number>;
}

/** Summary of a complete session, saved to localStorage. */
export interface SessionLog {
  /** ISO date string. */
  date: string;
  /** Map/surface type. */
  mapType: string;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Average FPS across the session. */
  avgFps: number;
  /** Minimum FPS observed. */
  minFps: number;
  /** Maximum FPS observed. */
  maxFps: number;
  /** Peak entity count. */
  peakEntities: number;
  /** Peak bullet count. */
  peakBullets: number;
  /** Top-10 moments (merged). */
  topMoments: {
    highestFps: PerfMoment[];
    lowestFps: PerfMoment[];
    highestEntities: PerfMoment[];
    highestBullets: PerfMoment[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_N = 10;
const STORAGE_KEY = 'geometry_wars_perf_logs';
const MAX_STORED_SESSIONS = 50;

/** Minimum interval between recorded snapshots (seconds).
 *  We sample every 0.5s to avoid huge arrays without missing peaks. */
const SAMPLE_INTERVAL = 0.5;

// ---------------------------------------------------------------------------
// PerformanceTracker
// ---------------------------------------------------------------------------

export class PerformanceTracker {
  // -- Config ---------------------------------------------------------------
  private readonly mapType: string;

  // -- Rolling FPS calculation (frame-level, not sampled) -------------------
  private frameTimes: number[] = [];
  private readonly fpsWindowSize = 60;
  private frameIndex = 0;
  private frameCount = 0;
  private currentFps = 0;

  // -- Current counts (set externally each frame) ---------------------------
  private currentEntityCount = 0;
  private currentBulletCount = 0;
  private readonly currentEnemyTypes = new Map<EnemyType, number>();

  // -- Sampling timer -------------------------------------------------------
  private sampleAccumulator = 0;

  // -- Session bookkeeping --------------------------------------------------
  private readonly sessionStart: number;
  private totalFrames = 0;
  private fpsSum = 0;

  // -- Top-10 lists ---------------------------------------------------------
  private readonly _highestFps: PerfMoment[] = [];
  private readonly _lowestFps: PerfMoment[] = [];
  private readonly _highestEntities: PerfMoment[] = [];
  private readonly _highestBullets: PerfMoment[] = [];

  // -- Per-frame peak tracking (not sampled — catches burst peaks) ----------
  private _peakBullets = 0;
  private _peakEntities = 0;

  // -- Warm-up: skip the first second so initial frame spikes don't pollute --
  private warmedUp = false;
  private warmupAccumulator = 0;
  private static readonly WARMUP_SECONDS = 1.0;

  constructor(mapType: string) {
    this.mapType = mapType;
    this.sessionStart = Date.now();
    this.frameTimes = new Array<number>(this.fpsWindowSize).fill(0);
  }

  // -- Per-frame API (call every frame) ------------------------------------

  /** Feed the raw frame delta time (seconds). */
  recordFrame(dtSeconds: number): void {
    const ms = dtSeconds * 1000;
    this.frameTimes[this.frameIndex] = ms;
    this.frameIndex = (this.frameIndex + 1) % this.fpsWindowSize;
    if (this.frameCount < this.fpsWindowSize) {
      this.frameCount++;
    }

    // Compute rolling FPS
    if (this.frameCount > 0) {
      let sum = 0;
      for (let i = 0; i < this.frameCount; i++) {
        sum += this.frameTimes[i];
      }
      const avg = sum / this.frameCount;
      this.currentFps = avg > 0 ? 1000 / avg : 0;
    }

    // Accumulate for session average
    this.totalFrames++;
    this.fpsSum += this.currentFps;

    // Warm-up gate
    if (!this.warmedUp) {
      this.warmupAccumulator += dtSeconds;
      if (this.warmupAccumulator < PerformanceTracker.WARMUP_SECONDS) {
        return;
      }
      this.warmedUp = true;
    }

    // Sample at fixed interval
    this.sampleAccumulator += dtSeconds;
    if (this.sampleAccumulator >= SAMPLE_INTERVAL) {
      this.sampleAccumulator -= SAMPLE_INTERVAL;
      this.takeSample();
    }
  }

  /** Set the current entity count (call each frame before recordFrame). */
  setEntityCount(count: number): void {
    this.currentEntityCount = count;
    if (count > this._peakEntities) this._peakEntities = count;
  }

  /** Set the current bullet count (call each frame before recordFrame). */
  setBulletCount(count: number): void {
    this.currentBulletCount = count;
    if (count > this._peakBullets) this._peakBullets = count;
  }

  /** Set enemy type breakdown for the current frame. */
  setEnemyTypes(enemyTypes: Map<EnemyType, number>): void {
    this.currentEnemyTypes.clear();
    enemyTypes.forEach((count, type) => {
      this.currentEnemyTypes.set(type, count);
    });
  }

  // -- Getters for live HUD ------------------------------------------------

  get fps(): number {
    return this.currentFps;
  }

  get entityCount(): number {
    return this.currentEntityCount;
  }

  get bulletCount(): number {
    return this.currentBulletCount;
  }

  // -- Top-10 accessors (immutable copies) ---------------------------------

  get highestFps(): ReadonlyArray<PerfMoment> {
    return this._highestFps;
  }

  get lowestFps(): ReadonlyArray<PerfMoment> {
    return this._lowestFps;
  }

  get highestEntities(): ReadonlyArray<PerfMoment> {
    return this._highestEntities;
  }

  get highestBullets(): ReadonlyArray<PerfMoment> {
    return this._highestBullets;
  }

  // -- Session summary (for pause menu / end screen) -----------------------

  getSummary(): {
    avgFps: number;
    minFps: number;
    maxFps: number;
    peakEntities: number;
    peakBullets: number;
    durationSeconds: number;
    mapType: string;
  } {
    const durationSeconds = (Date.now() - this.sessionStart) / 1000;
    const avgFps = this.totalFrames > 0 ? this.fpsSum / this.totalFrames : 0;

    const minFps = this._lowestFps.length > 0
      ? this._lowestFps[0].fps
      : this.currentFps;
    const maxFps = this._highestFps.length > 0
      ? this._highestFps[0].fps
      : this.currentFps;
    // Use per-frame peaks (not sampled) for accurate maximums
    const peakEntities = Math.max(
      this._peakEntities,
      this._highestEntities.length > 0 ? this._highestEntities[0].entityCount : 0,
    );
    const peakBullets = Math.max(
      this._peakBullets,
      this._highestBullets.length > 0 ? this._highestBullets[0].bulletCount : 0,
    );

    return {
      avgFps,
      minFps,
      maxFps,
      peakEntities,
      peakBullets,
      durationSeconds,
      mapType: this.mapType,
    };
  }

  // -- Persistence ----------------------------------------------------------

  /** Save the current session log to localStorage. */
  saveSession(): void {
    const summary = this.getSummary();

    const log: SessionLog = {
      date: new Date().toISOString(),
      mapType: this.mapType,
      durationSeconds: summary.durationSeconds,
      avgFps: summary.avgFps,
      minFps: summary.minFps,
      maxFps: summary.maxFps,
      peakEntities: summary.peakEntities,
      peakBullets: summary.peakBullets,
      topMoments: {
        highestFps: [...this._highestFps],
        lowestFps: [...this._lowestFps],
        highestEntities: [...this._highestEntities],
        highestBullets: [...this._highestBullets],
      },
    };

    try {
      const existing = this.loadAllSessions();
      existing.push(log);
      // Keep only the most recent sessions
      const trimmed = existing.slice(-MAX_STORED_SESSIONS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // localStorage unavailable or full -- silently ignore
    }
  }

  /** Load all stored session logs from localStorage. */
  loadAllSessions(): SessionLog[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Corrupt data -- start fresh
    }
    return [];
  }

  /** Clear all stored session logs. */
  static clearLogs(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }

  // -- Internal -------------------------------------------------------------

  private takeSample(): void {
    const now = Date.now();
    const elapsed = (now - this.sessionStart) / 1000;

    const moment: PerfMoment = {
      timestamp: now,
      fps: Math.round(this.currentFps * 10) / 10,
      entityCount: this.currentEntityCount,
      bulletCount: this.currentBulletCount,
      mapType: this.mapType,
      timeLabel: this.formatTime(elapsed),
      elapsedSeconds: Math.round(elapsed * 10) / 10,
      enemyTypes: new Map(this.currentEnemyTypes),
    };

    // Insert into top-10 lists (sorted, capped)
    this.insertSorted(this._highestFps, moment, (a, b) => b.fps - a.fps);
    this.insertSorted(this._lowestFps, moment, (a, b) => a.fps - b.fps);
    this.insertSorted(this._highestEntities, moment, (a, b) => b.entityCount - a.entityCount);
    this.insertSorted(this._highestBullets, moment, (a, b) => b.bulletCount - a.bulletCount);
  }

  private insertSorted(
    list: PerfMoment[],
    moment: PerfMoment,
    compareFn: (a: PerfMoment, b: PerfMoment) => number,
  ): void {
    // Find insertion position
    let idx = 0;
    while (idx < list.length && compareFn(list[idx], moment) <= 0) {
      idx++;
    }

    // Only insert if list isn't full or this moment ranks
    if (idx < TOP_N) {
      list.splice(idx, 0, moment);
      // Trim to TOP_N
      if (list.length > TOP_N) {
        list.length = TOP_N;
      }
    }
  }

  private formatTime(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }
}
