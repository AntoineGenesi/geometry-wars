// ---------------------------------------------------------------------------
// DDA Passive Data Logger
//
// Periodically samples DDA state and persists it to localStorage.
// Designed for low overhead: samples every N seconds, batches writes,
// auto-reduces frequency if performance drops.
//
// Data can be exported for post-session analysis.
// ---------------------------------------------------------------------------

import type { DDAPerformanceTracker, PerformanceSnapshot } from './DDAPerformanceTracker';
import type { DDADecisionEngine } from './DDADecisionEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single timestamped sample of DDA state. */
export interface DDASample {
  /** Seconds since game start. */
  t: number;
  /** Per-player data. */
  players: DDAPlayerSample[];
}

/** Per-player DDA data at a given moment. */
export interface DDAPlayerSample {
  /** Composite performance score (0-1). */
  score: number;
  /** DDA assistance level (0-3). */
  level: number;
  /** Speed multiplier applied. */
  speed: number;
  /** Kill rate (kills/min). */
  kr: number;
  /** Death rate (deaths/min). */
  dr: number;
  /** Score rate (score/min). */
  sr: number;
  /** Total kills so far. */
  kills: number;
  /** Total deaths so far. */
  deaths: number;
  /** Active buffs with stack counts (e.g. ["HotHands:2", "ShockAura:1"]). */
  buffs?: string[];
  /** Current weapon type. */
  weapon?: string;
}

/** Optional callback to get player bonuses at sample time (decoupled from BuffManager/WeaponManager). */
export interface DDAPlayerExtrasProvider {
  /** Return active buff names with stack counts for a player index. */
  getActiveBuffs(playerIndex: number): string[];
  /** Return current weapon name for a player index. */
  getCurrentWeapon(playerIndex: number): string;
}

/** Event logged at specific moments (kills, deaths, difficulty changes). */
export interface DDAEvent {
  /** Seconds since game start. */
  t: number;
  /** Event type. */
  type: 'kill' | 'death' | 'level_change';
  /** Player index. */
  player: number;
  /** Extra data (enemy type for kill, new level for level_change). */
  data?: string | number;
}

/** Full session log that gets persisted. */
export interface DDASessionLog {
  /** Session start timestamp (ISO string). */
  startedAt: string;
  /** Surface type. */
  surface: string;
  /** Number of players. */
  playerCount: number;
  /** DDA enabled? */
  ddaEnabled: boolean;
  /** Periodic samples. */
  samples: DDASample[];
  /** Discrete events. */
  events: DDAEvent[];
  /** Final summary. */
  summary: DDASessionSummary | null;
}

/** End-of-session summary. */
export interface DDASessionSummary {
  /** Total duration in seconds. */
  duration: number;
  /** Per-player final stats. */
  players: Array<{
    totalKills: number;
    totalDeaths: number;
    avgCompositeScore: number;
    maxDDALevel: number;
    dominantWeapon?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gw3d_dda_sessions';
const MAX_STORED_SESSIONS = 10;
const DEFAULT_SAMPLE_INTERVAL = 5.0; // seconds
const MAX_SAMPLES_PER_SESSION = 720; // 1 hour at 5s intervals
const MAX_EVENTS_PER_SESSION = 2000;

// ---------------------------------------------------------------------------
// DDALogger
// ---------------------------------------------------------------------------

export class DDALogger {
  private readonly trackers: DDAPerformanceTracker[];
  private readonly engine: DDADecisionEngine;
  private readonly surface: string;
  private extrasProvider: DDAPlayerExtrasProvider | null;

  private sampleInterval: number;
  private timeSinceLastSample = 0;
  private sessionStartTime: string;
  private gameElapsed = 0;

  private readonly samples: DDASample[] = [];
  private readonly events: DDAEvent[] = [];

  // Track previous DDA levels for change detection
  private readonly prevLevels: number[] = [];

  // Running averages for summary
  private readonly scoreAccumulators: number[] = [];
  private readonly scoreSampleCounts: number[] = [];
  private readonly maxLevels: number[] = [];

  private active = true;

  constructor(
    trackers: DDAPerformanceTracker[],
    engine: DDADecisionEngine,
    surface: string,
    sampleInterval = DEFAULT_SAMPLE_INTERVAL,
    extrasProvider: DDAPlayerExtrasProvider | null = null
  ) {
    this.trackers = trackers;
    this.engine = engine;
    this.surface = surface;
    this.sampleInterval = sampleInterval;
    this.extrasProvider = extrasProvider;
    this.sessionStartTime = new Date().toISOString();

    // Initialize per-player tracking
    for (let i = 0; i < trackers.length; i++) {
      this.prevLevels.push(0);
      this.scoreAccumulators.push(0);
      this.scoreSampleCounts.push(0);
      this.maxLevels.push(0);
    }
  }

  /** Set the extras provider after construction (for late-binding to BuffManager/WeaponManager). */
  setExtrasProvider(provider: DDAPlayerExtrasProvider): void {
    this.extrasProvider = provider;
  }

  // -----------------------------------------------------------------------
  // Per-frame update (lightweight — only samples periodically)
  // -----------------------------------------------------------------------

  update(dt: number): void {
    if (!this.active) return;

    this.gameElapsed += dt;
    this.timeSinceLastSample += dt;

    if (this.timeSinceLastSample < this.sampleInterval) return;
    this.timeSinceLastSample = 0;

    // Guard against unbounded growth
    if (this.samples.length >= MAX_SAMPLES_PER_SESSION) {
      // Double the interval to keep logging but slower
      this.sampleInterval *= 2;
      return;
    }

    this.captureSample();
    this.detectLevelChanges();
  }

  // -----------------------------------------------------------------------
  // Event recording (called by game code on specific moments)
  // -----------------------------------------------------------------------

  recordKill(playerIndex: number, enemyType?: string): void {
    if (!this.active || this.events.length >= MAX_EVENTS_PER_SESSION) return;
    this.events.push({
      t: this.gameElapsed,
      type: 'kill',
      player: playerIndex,
      data: enemyType,
    });
  }

  recordDeath(playerIndex: number): void {
    if (!this.active || this.events.length >= MAX_EVENTS_PER_SESSION) return;
    this.events.push({
      t: this.gameElapsed,
      type: 'death',
      player: playerIndex,
    });
  }

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  /** Call at end of game to finalize and persist the session log. */
  finalize(): DDASessionLog {
    const summary = this.buildSummary();
    const log: DDASessionLog = {
      startedAt: this.sessionStartTime,
      surface: this.surface,
      playerCount: this.trackers.length,
      ddaEnabled: this.engine.isEnabled(),
      samples: this.samples,
      events: this.events,
      summary,
    };

    this.persistToLocalStorage(log);
    this.active = false;
    return log;
  }

  /** Export all stored sessions as JSON string. */
  static exportAll(): string {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ?? '[]';
  }

  /** Get all stored session logs. */
  static getSessions(): DDASessionLog[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** Clear all stored session data. */
  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private captureSample(): void {
    const playerSamples: DDAPlayerSample[] = [];

    for (let i = 0; i < this.trackers.length; i++) {
      const tracker = this.trackers[i];
      const snap = tracker.getSnapshot();
      const compositeScore = tracker.getCompositeScore();
      const level = this.engine.getDDALevel(i);
      const speed = this.engine.getSpeedMultiplier(i);

      const sample: DDAPlayerSample = {
        score: Math.round(compositeScore * 1000) / 1000,
        level,
        speed: Math.round(speed * 100) / 100,
        kr: Math.round(snap.killRate * 10) / 10,
        dr: Math.round(snap.deathRate * 10) / 10,
        sr: Math.round(snap.scoreRate),
        kills: tracker.totalKills,
        deaths: tracker.totalDeaths,
      };

      // Attach buff/weapon data if provider available
      if (this.extrasProvider) {
        const buffs = this.extrasProvider.getActiveBuffs(i);
        if (buffs.length > 0) sample.buffs = buffs;
        sample.weapon = this.extrasProvider.getCurrentWeapon(i);
      }

      playerSamples.push(sample);

      // Update running averages
      this.scoreAccumulators[i] += compositeScore;
      this.scoreSampleCounts[i]++;
      if (level > this.maxLevels[i]) {
        this.maxLevels[i] = level;
      }
    }

    this.samples.push({
      t: Math.round(this.gameElapsed * 10) / 10,
      players: playerSamples,
    });
  }

  private detectLevelChanges(): void {
    for (let i = 0; i < this.trackers.length; i++) {
      const level = this.engine.getDDALevel(i);
      if (level !== this.prevLevels[i]) {
        if (this.events.length < MAX_EVENTS_PER_SESSION) {
          this.events.push({
            t: this.gameElapsed,
            type: 'level_change',
            player: i,
            data: level,
          });
        }
        this.prevLevels[i] = level;
      }
    }
  }

  private buildSummary(): DDASessionSummary {
    const players = this.trackers.map((tracker, i) => ({
      totalKills: tracker.totalKills,
      totalDeaths: tracker.totalDeaths,
      avgCompositeScore: this.scoreSampleCounts[i] > 0
        ? Math.round((this.scoreAccumulators[i] / this.scoreSampleCounts[i]) * 1000) / 1000
        : 0,
      maxDDALevel: this.maxLevels[i],
    }));

    return {
      duration: Math.round(this.gameElapsed * 10) / 10,
      players,
    };
  }

  private persistToLocalStorage(log: DDASessionLog): void {
    try {
      const sessions = DDALogger.getSessions();
      sessions.push(log);

      // Keep only the most recent N sessions
      while (sessions.length > MAX_STORED_SESSIONS) {
        sessions.shift();
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // localStorage may be full or unavailable — silently fail
    }
  }
}
