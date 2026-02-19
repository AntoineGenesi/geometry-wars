/**
 * Time-series performance data logger for interactive graphs.
 *
 * Records FPS, entity counts, bullet counts, enemy type breakdowns,
 * draw calls, triangles, LOD distribution, DDA difficulty level,
 * and quality settings over time in a ring buffer.
 *
 * Data is sampled every 500ms and persisted to localStorage after
 * each game session. Sessions are NEVER auto-deleted — they accumulate
 * for evidence-backed performance research.
 *
 * Supports 10-game counter with research report trigger notification.
 */

import { EnemyType } from '../entities/enemies/EnemySpawner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** LOD distribution snapshot. */
export interface LODSnapshot {
  high: number;
  medium: number;
  low: number;
}

/** Renderer stats snapshot. */
export interface RendererSnapshot {
  drawCalls: number;
  triangles: number;
  memoryMB: number;
}

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
  /** Draw calls this frame. */
  drawCalls: number;
  /** Triangles rendered this frame. */
  triangles: number;
  /** GPU memory estimate in MB. */
  memoryMB: number;
  /** LOD distribution: enemies at each detail level. */
  lodHigh: number;
  lodMedium: number;
  lodLow: number;
  /** DDA difficulty level (0-3, fractional). */
  ddaLevel: number;
  /** Current difficulty tier from wave scheduler (0-4+ for super tiers, continuous). */
  difficultyTier: number;
  /** Player power level (kill-based progression level, 0-N). */
  playerPowerLevel: number;
  /** Current quality level name (ULTRA/HIGH/MEDIUM/LOW/MINIMAL). */
  qualityLevel: string;

  // -- Gameplay telemetry fields --
  /** Current player score. */
  score: number;
  /** Total kills so far. */
  kills: number;
  /** Total deaths so far. */
  deaths: number;
  /** Currently equipped weapon type name. */
  activeWeapon: string;
  /** Active buff types with stack counts (e.g. "hot_hands:3,shock_aura:1"). */
  activeBuffs: string;
  /** Kills in this sample window (for kill rate tracking). */
  killsThisSample: number;
  /** Count of active particle effects (particles + fragments). */
  activeEffects: number;
  /** Enemies visible in camera frustum. */
  visibleEnemies: number;
  /** Bullets visible in camera frustum. */
  visibleBullets: number;
  /** Active explosion/death effects currently playing. */
  activeExplosions: number;

  // -- Player surface position (for stuck detection) --
  /** Player UV coordinates on surface (0-1 range). */
  playerSurfaceU: number;
  playerSurfaceV: number;
  /** Player face index on mesh surface. */
  playerFaceIndex: number;
  /** Player world-space position. */
  playerWorldX: number;
  playerWorldY: number;
  playerWorldZ: number;
  /** True if player UV+face unchanged for >2 seconds (stuck in mesh). */
  playerStuck: boolean;
}

/** Serialized data point for localStorage. */
export interface SerializedDataPoint {
  t: number;  // time
  f: number;  // fps
  e: number;  // enemyCount
  b: number;  // bulletCount
  et: Array<[EnemyType, number]>;  // enemyTypes
  dc: number; // drawCalls
  tr: number; // triangles
  mm: number; // memoryMB
  lh: number; // lodHigh
  lm: number; // lodMedium
  ll: number; // lodLow
  dd: number; // ddaLevel
  dt?: number; // difficultyTier (optional for backward compat)
  pl?: number; // playerPowerLevel (optional for backward compat)
  ql: string; // qualityLevel
  // Gameplay telemetry (optional for backward compat with old sessions)
  s?: number;   // score
  k?: number;   // kills
  d?: number;   // deaths
  aw?: string;  // activeWeapon
  ab?: string;  // activeBuffs (compact string: "type:stacks,type:stacks")
  ks?: number;  // killsThisSample
  ae?: number;  // activeEffects
  ve?: number;  // visibleEnemies
  vb?: number;  // visibleBullets
  ax?: number;  // activeExplosions
  // Player surface position (optional for backward compat with old sessions)
  pu?: number;  // playerSurfaceU
  pv?: number;  // playerSurfaceV
  pf?: number;  // playerFaceIndex
  px?: number;  // playerWorldX
  py?: number;  // playerWorldY
  pz?: number;  // playerWorldZ
  ps?: boolean; // playerStuck
}

/** Frame spike event logged individually. */
export interface FrameSpikeEvent {
  time: number;
  fps: number;
  frameTimeMs: number;
  enemyCount: number;
  bulletCount: number;
  topEnemyTypes: Array<[EnemyType, number]>;
  drawCalls: number;
  ddaLevel: number;
}

/** Stored session data for localStorage persistence. */
export interface StoredSession {
  /** ISO timestamp. */
  timestamp: string;
  /** Map/surface type. */
  mapType: string;
  /** Duration in seconds. */
  duration: number;
  /** Time-series data points (serialized with short keys for compactness). */
  dataPoints: SerializedDataPoint[];
  /** Frame spike events (frames >33ms). */
  spikes?: FrameSpikeEvent[];
  /** Session summary stats. */
  summary?: {
    avgFps: number;
    minFps: number;
    maxFps: number;
    peakEnemies: number;
    peakBullets: number;
    peakDrawCalls: number;
    totalSpikes: number;
    // Gameplay summary (optional for backward compat)
    finalScore?: number;
    totalKills?: number;
    totalDeaths?: number;
    peakKillRate?: number;   // max kills per sample window
    peakActiveEffects?: number;
    // DDA / difficulty summary
    peakDifficultyTier?: number;  // max difficulty tier reached this session
    finalPlayerPowerLevel?: number; // player power level at session end
  };
}

/** Legacy format for backwards compatibility. */
interface LegacyDataPoint {
  time: number;
  fps: number;
  enemyCount: number;
  bulletCount: number;
  enemyTypes: Array<[EnemyType, number]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RING_BUFFER_SIZE = 3600; // 30 minutes @ 500ms sampling = 3600 samples
const SAMPLE_INTERVAL = 0.5; // seconds
const STORAGE_KEY = 'gw_perf_log'; // Changed to match user's expected key
const LEGACY_STORAGE_KEY = 'geometry_wars_perf_timeseries'; // Old key for migration
const GAME_COUNTER_KEY = 'geometry_wars_game_counter';
const SPIKE_STORAGE_KEY = 'gw_perf_spikes';
// NEVER auto-delete sessions — accumulate for evidence-backed research
const MAX_STORED_SESSIONS = 500;
const SPIKE_THRESHOLD_MS = 33; // Frames >33ms logged as spikes (below 30fps)

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

  // Extended telemetry (set externally)
  private currentDrawCalls = 0;
  private currentTriangles = 0;
  private currentMemoryMB = 0;
  private currentLodHigh = 0;
  private currentLodMedium = 0;
  private currentLodLow = 0;
  private currentDdaLevel = 0;
  private currentDifficultyTier = 0;
  private currentPlayerPowerLevel = 0;
  private currentQualityLevel = 'HIGH';

  // Gameplay telemetry (set externally)
  private currentScore = 0;
  private currentKills = 0;
  private currentDeaths = 0;
  private currentActiveWeapon = 'Standard';
  private currentActiveBuffs = '';  // Pre-formatted string to avoid per-frame alloc
  private currentActiveEffects = 0;
  private lastSampleKills = 0;  // Kills at previous sample (for delta calculation)

  // Visibility telemetry (set externally)
  private currentVisibleEnemies = 0;
  private currentVisibleBullets = 0;
  private currentActiveExplosions = 0;

  // Player surface position telemetry (set externally)
  private currentPlayerSurfaceU = 0;
  private currentPlayerSurfaceV = 0;
  private currentPlayerFaceIndex = 0;
  private currentPlayerWorldX = 0;
  private currentPlayerWorldY = 0;
  private currentPlayerWorldZ = 0;
  private currentPlayerStuck = false;
  // Stuck detection: last known change timestamp + reference position
  private _stuckLastU = 0;
  private _stuckLastV = 0;
  private _stuckLastFace = 0;
  private _stuckLastChangeMs = 0; // initialized in constructor

  // Frame spike tracking
  private readonly spikeEvents: FrameSpikeEvent[] = [];
  private static readonly MAX_SPIKES_PER_SESSION = 200;

  // Session summary accumulators (zero-alloc)
  private fpsSum = 0;
  private fpsCount = 0;
  private minFps = Infinity;
  private maxFps = 0;
  private peakEnemies = 0;
  private peakBullets = 0;
  private peakDrawCalls = 0;
  private peakKillRate = 0;
  private peakActiveEffects = 0;
  private peakDifficultyTier = 0;

  constructor(mapType: string) {
    this.mapType = mapType;
    this.sessionStart = Date.now();
    // Initialize stuck timer to now so player is not immediately marked stuck
    this._stuckLastChangeMs = Date.now();

    // Migrate legacy data if exists
    PerformanceLogger.migrateLegacyData();

    // Pre-allocate ring buffer
    this.buffer = new Array(RING_BUFFER_SIZE);
    for (let i = 0; i < RING_BUFFER_SIZE; i++) {
      this.buffer[i] = {
        time: 0,
        fps: 0,
        enemyCount: 0,
        bulletCount: 0,
        enemyTypes: new Map(),
        drawCalls: 0,
        triangles: 0,
        memoryMB: 0,
        lodHigh: 0,
        lodMedium: 0,
        lodLow: 0,
        ddaLevel: 0,
        difficultyTier: 0,
        playerPowerLevel: 0,
        qualityLevel: 'HIGH',
        score: 0,
        kills: 0,
        deaths: 0,
        activeWeapon: 'Standard',
        activeBuffs: '',
        killsThisSample: 0,
        activeEffects: 0,
        visibleEnemies: 0,
        visibleBullets: 0,
        activeExplosions: 0,
        playerSurfaceU: 0,
        playerSurfaceV: 0,
        playerFaceIndex: 0,
        playerWorldX: 0,
        playerWorldY: 0,
        playerWorldZ: 0,
        playerStuck: false,
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
   * Set renderer stats (draw calls, triangles, memory).
   * Call from the render loop after renderer.info is updated.
   */
  setRendererStats(drawCalls: number, triangles: number, memoryMB: number): void {
    this.currentDrawCalls = drawCalls;
    this.currentTriangles = triangles;
    this.currentMemoryMB = memoryMB;
  }

  /**
   * Set LOD distribution: how many enemies at each detail level.
   */
  setLODStats(high: number, medium: number, low: number): void {
    this.currentLodHigh = high;
    this.currentLodMedium = medium;
    this.currentLodLow = low;
  }

  /**
   * Set current DDA difficulty level (0-3, fractional).
   */
  setDDALevel(level: number): void {
    this.currentDdaLevel = level;
  }

  /**
   * Set current difficulty tier from wave scheduler (0-4+ for super tiers, continuous float).
   * This is the wave-difficulty tier, distinct from the DDA assistance level.
   */
  setDifficultyTier(tier: number): void {
    this.currentDifficultyTier = tier;
    if (tier > this.peakDifficultyTier) this.peakDifficultyTier = tier;
  }

  /**
   * Set player power level (kill-based progression level, integer 0-N).
   */
  setPlayerPowerLevel(level: number): void {
    this.currentPlayerPowerLevel = level;
  }

  /**
   * Set current adaptive quality level name.
   */
  setQualityLevel(level: string): void {
    this.currentQualityLevel = level;
  }

  /**
   * Set gameplay state for the current frame.
   * Call this every frame BEFORE recordFrame().
   * Uses pre-formatted buffString to avoid per-frame allocation.
   */
  setGameplayData(
    score: number,
    kills: number,
    deaths: number,
    activeWeapon: string,
    activeBuffs: string,
    activeEffects: number,
  ): void {
    this.currentScore = score;
    this.currentKills = kills;
    this.currentDeaths = deaths;
    this.currentActiveWeapon = activeWeapon;
    this.currentActiveBuffs = activeBuffs;
    this.currentActiveEffects = activeEffects;
  }

  /**
   * Set visibility telemetry for the current frame.
   * Call this every frame BEFORE recordFrame().
   * Zero per-frame allocations — caller must count entities.
   */
  setVisibilityData(
    visibleEnemies: number,
    visibleBullets: number,
    activeExplosions: number,
  ): void {
    this.currentVisibleEnemies = visibleEnemies;
    this.currentVisibleBullets = visibleBullets;
    this.currentActiveExplosions = activeExplosions;
  }

  /**
   * Set player surface position for stuck detection telemetry.
   * Call this every frame BEFORE recordFrame().
   *
   * Stuck detection: if UV coordinates and face index are unchanged for >2 seconds,
   * the player is flagged as stuck (e.g. clipped into mesh geometry).
   */
  setPlayerSurfacePosition(
    u: number,
    v: number,
    faceIndex: number,
    worldX: number,
    worldY: number,
    worldZ: number,
  ): void {
    const now = Date.now();
    const STUCK_THRESHOLD_MS = 2000;
    const UV_EPSILON = 1e-5;

    const posChanged =
      Math.abs(u - this._stuckLastU) > UV_EPSILON ||
      Math.abs(v - this._stuckLastV) > UV_EPSILON ||
      faceIndex !== this._stuckLastFace;

    if (posChanged) {
      this._stuckLastU = u;
      this._stuckLastV = v;
      this._stuckLastFace = faceIndex;
      this._stuckLastChangeMs = now;
    }

    this.currentPlayerSurfaceU = u;
    this.currentPlayerSurfaceV = v;
    this.currentPlayerFaceIndex = faceIndex;
    this.currentPlayerWorldX = worldX;
    this.currentPlayerWorldY = worldY;
    this.currentPlayerWorldZ = worldZ;
    this.currentPlayerStuck = (now - this._stuckLastChangeMs) > STUCK_THRESHOLD_MS;
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
   * Also detects and logs frame spikes.
   */
  recordFrame(dtSeconds: number): void {
    // Track session summary stats every frame
    if (this.currentFps > 0) {
      this.fpsSum += this.currentFps;
      this.fpsCount++;
      if (this.currentFps < this.minFps) this.minFps = this.currentFps;
      if (this.currentFps > this.maxFps) this.maxFps = this.currentFps;
    }
    if (this.currentEnemyCount > this.peakEnemies) this.peakEnemies = this.currentEnemyCount;
    if (this.currentBulletCount > this.peakBullets) this.peakBullets = this.currentBulletCount;
    if (this.currentDrawCalls > this.peakDrawCalls) this.peakDrawCalls = this.currentDrawCalls;

    // Detect frame spikes (>33ms = below 30fps)
    const frameTimeMs = dtSeconds * 1000;
    if (frameTimeMs > SPIKE_THRESHOLD_MS && this.spikeEvents.length < PerformanceLogger.MAX_SPIKES_PER_SESSION) {
      const elapsed = (Date.now() - this.sessionStart) / 1000;
      const topTypes = Array.from(this.currentEnemyTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      this.spikeEvents.push({
        time: elapsed,
        fps: this.currentFps,
        frameTimeMs,
        enemyCount: this.currentEnemyCount,
        bulletCount: this.currentBulletCount,
        topEnemyTypes: topTypes,
        drawCalls: this.currentDrawCalls,
        ddaLevel: this.currentDdaLevel,
      });
    }

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

  /** Get frame spike events for this session. */
  getSpikeEvents(): ReadonlyArray<FrameSpikeEvent> {
    return this.spikeEvents;
  }

  /** Get session summary (for export and display). */
  getSessionSummary(): StoredSession['summary'] {
    return {
      avgFps: this.fpsCount > 0 ? this.fpsSum / this.fpsCount : 0,
      minFps: this.minFps === Infinity ? 0 : this.minFps,
      maxFps: this.maxFps,
      peakEnemies: this.peakEnemies,
      peakBullets: this.peakBullets,
      peakDrawCalls: this.peakDrawCalls,
      totalSpikes: this.spikeEvents.length,
      finalScore: this.currentScore,
      totalKills: this.currentKills,
      totalDeaths: this.currentDeaths,
      peakKillRate: this.peakKillRate,
      peakActiveEffects: this.peakActiveEffects,
      peakDifficultyTier: Math.round(this.peakDifficultyTier * 100) / 100,
      finalPlayerPowerLevel: this.currentPlayerPowerLevel,
    };
  }

  // -- Persistence ----------------------------------------------------------

  /**
   * Save the current session to localStorage and increment game counter.
   * Returns true if this triggers the 10-game research report notification.
   * Sessions are NEVER auto-deleted.
   */
  saveSession(): boolean {
    const stored: StoredSession = {
      timestamp: new Date().toISOString(),
      mapType: this.mapType,
      duration: (Date.now() - this.sessionStart) / 1000,
      dataPoints: this.serializeDataPoints(),
      spikes: this.spikeEvents.length > 0 ? [...this.spikeEvents] : undefined,
      summary: this.getSessionSummary(),
    };

    try {
      // Save session data — NEVER delete old sessions
      const existing = this.loadAllSessions();
      existing.push(stored);

      // Only trim if localStorage quota is about to be exceeded.
      // Try to save all; if it fails, trim oldest 10% and retry.
      let saved = false;
      let sessions = existing;
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
          saved = true;
        } catch {
          // localStorage full — trim oldest 10%
          const trimCount = Math.max(1, Math.floor(sessions.length * 0.1));
          sessions = sessions.slice(trimCount);
        }
      }

      // Increment game counter
      const counter = this.getGameCounter() + 1;
      localStorage.setItem(GAME_COUNTER_KEY, String(counter));

      // Check if we hit 10 games
      return counter % 10 === 0;
    } catch {
      // localStorage unavailable
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
   * Export all sessions as a JSON string (for downloading).
   */
  static exportAllAsJSON(): string {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ?? '[]';
    } catch {
      return '[]';
    }
  }

  /**
   * Export all sessions as CSV (for spreadsheet analysis).
   * Each row is one data point from one session.
   */
  static exportAllAsCSV(): string {
    const headers = [
      'session_timestamp', 'session_map', 'time_s', 'fps',
      'enemy_count', 'bullet_count', 'draw_calls', 'triangles',
      'memory_mb', 'lod_high', 'lod_medium', 'lod_low',
      'dda_level', 'difficulty_tier', 'player_power_level', 'quality_level', 'top_enemy_types',
      'score', 'kills', 'deaths', 'active_weapon',
      'active_buffs', 'kills_this_sample', 'active_effects',
      'visible_enemies', 'visible_bullets', 'active_explosions',
      'player_surface_u', 'player_surface_v', 'player_face_index',
      'player_world_x', 'player_world_y', 'player_world_z', 'player_stuck',
    ];
    const rows: string[] = [headers.join(',')];

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return rows.join('\n');
      const sessions: StoredSession[] = JSON.parse(raw);

      for (const session of sessions) {
        for (const dp of session.dataPoints) {
          // Handle both new compact format and legacy format
          const time = 't' in dp ? (dp as SerializedDataPoint).t : (dp as unknown as LegacyDataPoint).time;
          const fps = 'f' in dp ? (dp as SerializedDataPoint).f : (dp as unknown as LegacyDataPoint).fps;
          const enemies = 'e' in dp ? (dp as SerializedDataPoint).e : (dp as unknown as LegacyDataPoint).enemyCount;
          const bullets = 'b' in dp ? (dp as SerializedDataPoint).b : (dp as unknown as LegacyDataPoint).bulletCount;
          const dc = 'dc' in dp ? (dp as SerializedDataPoint).dc : 0;
          const tr = 'tr' in dp ? (dp as SerializedDataPoint).tr : 0;
          const mm = 'mm' in dp ? (dp as SerializedDataPoint).mm : 0;
          const lh = 'lh' in dp ? (dp as SerializedDataPoint).lh : 0;
          const lm = 'lm' in dp ? (dp as SerializedDataPoint).lm : 0;
          const ll = 'll' in dp ? (dp as SerializedDataPoint).ll : 0;
          const dd = 'dd' in dp ? (dp as SerializedDataPoint).dd : 0;
          const ql = 'ql' in dp ? (dp as SerializedDataPoint).ql : '';
          const et = 'et' in dp
            ? (dp as SerializedDataPoint).et
            : (dp as unknown as LegacyDataPoint).enemyTypes;
          const topTypes = (et || []).slice(0, 5).map(([t, c]) => `${t}:${c}`).join(';');
          // Gameplay fields (default to 0/'' for old sessions)
          const sdp = dp as SerializedDataPoint;
          const score = sdp.s ?? 0;
          const kills = sdp.k ?? 0;
          const deaths = sdp.d ?? 0;
          const aw = sdp.aw ?? '';
          const ab = sdp.ab ?? '';
          const ks = sdp.ks ?? 0;
          const ae = sdp.ae ?? 0;
          const ve = sdp.ve ?? 0;
          const vb = sdp.vb ?? 0;
          const ax = sdp.ax ?? 0;
          // DDA / difficulty fields (default to 0 for old sessions)
          const diffTier = sdp.dt ?? 0;
          const powerLevel = sdp.pl ?? 0;

          const pu = sdp.pu ?? 0;
          const pv = sdp.pv ?? 0;
          const pf = sdp.pf ?? 0;
          const px = sdp.px ?? 0;
          const py = sdp.py ?? 0;
          const pz = sdp.pz ?? 0;
          const ps = sdp.ps ? 1 : 0;

          rows.push([
            session.timestamp, session.mapType, time, fps,
            enemies, bullets, dc, tr,
            mm, lh, lm, ll,
            dd, diffTier, powerLevel, ql, `"${topTypes}"`,
            score, kills, deaths, aw,
            `"${ab}"`, ks, ae,
            ve, vb, ax,
            pu, pv, pf, px, py, pz, ps,
          ].join(','));
        }
      }
    } catch {
      // Corrupt data
    }

    return rows.join('\n');
  }

  /**
   * Migrate data from legacy storage key to new key.
   */
  private static migrateLegacyData(): void {
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacy) return;
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing) {
        // Merge: append legacy to new
        const newSessions: StoredSession[] = JSON.parse(existing);
        const legacySessions: StoredSession[] = JSON.parse(legacy);
        const merged = [...legacySessions, ...newSessions];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } else {
        // Just move
        localStorage.setItem(STORAGE_KEY, legacy);
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Ignore migration errors
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
    point.drawCalls = this.currentDrawCalls;
    point.triangles = this.currentTriangles;
    point.memoryMB = this.currentMemoryMB;
    point.lodHigh = this.currentLodHigh;
    point.lodMedium = this.currentLodMedium;
    point.lodLow = this.currentLodLow;
    point.ddaLevel = this.currentDdaLevel;
    point.difficultyTier = Math.round(this.currentDifficultyTier * 100) / 100;
    point.playerPowerLevel = this.currentPlayerPowerLevel;
    point.qualityLevel = this.currentQualityLevel;

    // Gameplay telemetry
    point.score = this.currentScore;
    point.kills = this.currentKills;
    point.deaths = this.currentDeaths;
    point.activeWeapon = this.currentActiveWeapon;
    point.activeBuffs = this.currentActiveBuffs;
    point.activeEffects = this.currentActiveEffects;

    // Visibility telemetry
    point.visibleEnemies = this.currentVisibleEnemies;
    point.visibleBullets = this.currentVisibleBullets;
    point.activeExplosions = this.currentActiveExplosions;

    // Player surface position
    point.playerSurfaceU = this.currentPlayerSurfaceU;
    point.playerSurfaceV = this.currentPlayerSurfaceV;
    point.playerFaceIndex = this.currentPlayerFaceIndex;
    point.playerWorldX = this.currentPlayerWorldX;
    point.playerWorldY = this.currentPlayerWorldY;
    point.playerWorldZ = this.currentPlayerWorldZ;
    point.playerStuck = this.currentPlayerStuck;

    // Kills delta since last sample (for kill rate tracking)
    const killsDelta = this.currentKills - this.lastSampleKills;
    point.killsThisSample = killsDelta;
    this.lastSampleKills = this.currentKills;

    // Track gameplay peaks
    if (killsDelta > this.peakKillRate) this.peakKillRate = killsDelta;
    if (this.currentActiveEffects > this.peakActiveEffects) this.peakActiveEffects = this.currentActiveEffects;

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
      drawCalls: point.drawCalls,
      triangles: point.triangles,
      memoryMB: point.memoryMB,
      lodHigh: point.lodHigh,
      lodMedium: point.lodMedium,
      lodLow: point.lodLow,
      ddaLevel: point.ddaLevel,
      difficultyTier: point.difficultyTier,
      playerPowerLevel: point.playerPowerLevel,
      qualityLevel: point.qualityLevel,
      score: point.score,
      kills: point.kills,
      deaths: point.deaths,
      activeWeapon: point.activeWeapon,
      activeBuffs: point.activeBuffs,
      killsThisSample: point.killsThisSample,
      activeEffects: point.activeEffects,
      visibleEnemies: point.visibleEnemies,
      visibleBullets: point.visibleBullets,
      activeExplosions: point.activeExplosions,
      playerSurfaceU: point.playerSurfaceU,
      playerSurfaceV: point.playerSurfaceV,
      playerFaceIndex: point.playerFaceIndex,
      playerWorldX: point.playerWorldX,
      playerWorldY: point.playerWorldY,
      playerWorldZ: point.playerWorldZ,
      playerStuck: point.playerStuck,
    };
  }

  private serializeDataPoints(): SerializedDataPoint[] {
    const result: SerializedDataPoint[] = [];
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

  private serializePoint(point: PerformanceDataPoint): SerializedDataPoint {
    return {
      t: Math.round(point.time * 10) / 10,
      f: Math.round(point.fps * 10) / 10,
      e: point.enemyCount,
      b: point.bulletCount,
      et: Array.from(point.enemyTypes.entries()),
      dc: point.drawCalls,
      tr: point.triangles,
      mm: Math.round(point.memoryMB * 100) / 100,
      lh: point.lodHigh,
      lm: point.lodMedium,
      ll: point.lodLow,
      dd: Math.round(point.ddaLevel * 100) / 100,
      dt: point.difficultyTier !== 0 ? point.difficultyTier : undefined,  // omit 0 to save space
      pl: point.playerPowerLevel !== 0 ? point.playerPowerLevel : undefined,  // omit 0 to save space
      ql: point.qualityLevel,
      s: point.score,
      k: point.kills,
      d: point.deaths,
      aw: point.activeWeapon,
      ab: point.activeBuffs || undefined,  // omit empty string to save space
      ks: point.killsThisSample,
      ae: point.activeEffects,
      ve: point.visibleEnemies,
      vb: point.visibleBullets,
      ax: point.activeExplosions,
      // Player surface position (omit zero values to save space)
      pu: point.playerSurfaceU !== 0 ? Math.round(point.playerSurfaceU * 1e5) / 1e5 : undefined,
      pv: point.playerSurfaceV !== 0 ? Math.round(point.playerSurfaceV * 1e5) / 1e5 : undefined,
      pf: point.playerFaceIndex !== 0 ? point.playerFaceIndex : undefined,
      px: point.playerWorldX !== 0 ? Math.round(point.playerWorldX * 1000) / 1000 : undefined,
      py: point.playerWorldY !== 0 ? Math.round(point.playerWorldY * 1000) / 1000 : undefined,
      pz: point.playerWorldZ !== 0 ? Math.round(point.playerWorldZ * 1000) / 1000 : undefined,
      ps: point.playerStuck || undefined,  // omit false to save space
    };
  }
}
