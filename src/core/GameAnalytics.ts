/**
 * Game Analytics System
 *
 * Comprehensive gameplay and performance data collection for analysis and debugging.
 * Non-blocking, efficient, < 1ms frame overhead.
 *
 * Tracks:
 * - FPS and frame timings
 * - Entity counts by type
 * - Active effects (by ID/name from EffectDictionary)
 * - Weapon usage patterns
 * - Buff activity and stacking
 * - Kill attribution (enemy type → player death, weapon type → enemy kills)
 * - Score progression and DDA level
 * - Bloom state and renderer stats
 *
 * Storage: IndexedDB (preferred) with localStorage fallback.
 * Export: JSON and CSV for external analysis.
 */

import { EnemyType } from '../entities/enemies/EnemySpawner';
import { WeaponType } from '../weapons/WeaponTypes';
import { StackBuffType } from '../buffs/BuffManager';
import { EffectDictionary } from './EffectDictionary';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single analytics data point sampled at a point in time. */
export interface AnalyticsDataPoint {
  /** Elapsed game time in seconds since session start. */
  time: number;
  /** FPS at this sample. */
  fps: number;
  /** Frame time in milliseconds (1000/fps). */
  frameTimeMs: number;

  // Entity counts
  /** Total enemy count. */
  enemyCount: number;
  /** Enemy counts by type. */
  enemyTypes: Record<string, number>; // EnemyType → count
  /** Total bullet count. */
  bulletCount: number;
  /** Total geom count. */
  geomCount: number;
  /** Active particle count. */
  particleCount: number;

  // Active effects (tracked by EffectDictionary)
  /** Effect IDs currently active. */
  activeEffects: number[];

  // Weapon state
  /** Currently equipped weapon type. */
  activeWeapon: string; // WeaponType
  /** Weapon ammo (or -1 for infinite). */
  weaponAmmo: number;
  /** Weapon stacks (1-5). */
  weaponStacks: number;

  // Buff state
  /** Active buff types with stack counts. */
  activeBuffs: Record<string, number>; // StackBuffType → stacks

  // Gameplay metrics
  /** Current player score. */
  score: number;
  /** Total kills so far. */
  kills: number;
  /** Total deaths so far. */
  deaths: number;
  /** DDA difficulty level (0-3, fractional). */
  ddaLevel: number;

  // Performance metrics
  /** Renderer draw calls. */
  drawCalls: number;
  /** Triangles rendered. */
  triangles: number;
  /** GPU memory estimate (MB). */
  memoryMB: number;
  /** Bloom strength setting. */
  bloomStrength: number;
  /** Quality level name (ULTRA/HIGH/MEDIUM/LOW/MINIMAL). */
  qualityLevel: string;
}

/** Kill event: tracks what killed what, with which weapon. */
export interface KillEvent {
  /** Elapsed game time in seconds. */
  time: number;
  /** Enemy type that was killed. */
  enemyType: string; // EnemyType
  /** Weapon type used for kill. */
  weaponType: string; // WeaponType
  /** Score value of the kill. */
  scoreValue: number;
  /** Enemy tier (Normal, Hard, Elite, Nightmare, Legendary). */
  enemyTier: string;
}

/** Death event: tracks player deaths and their cause. */
export interface DeathEvent {
  /** Elapsed game time in seconds. */
  time: number;
  /** Enemy type that killed the player. */
  enemyType: string; // EnemyType
  /** Player health at time of death. */
  healthAtDeath: number;
  /** Active buffs at time of death. */
  activeBuffs: string[]; // StackBuffType[]
  /** Weapon equipped at time of death. */
  weaponEquipped: string; // WeaponType
}

/** Buff activity: tracks when buffs are activated/deactivated. */
export interface BuffActivityEvent {
  /** Elapsed game time in seconds. */
  time: number;
  /** Buff type. */
  buffType: string; // StackBuffType
  /** Event type: gained, lost, stacked, expired. */
  eventType: 'gained' | 'lost' | 'stacked' | 'expired';
  /** Stack count after event. */
  stacks: number;
}

/** Session summary statistics. */
export interface SessionSummary {
  /** ISO timestamp. */
  timestamp: string;
  /** Map/surface type. */
  mapType: string;
  /** Duration in seconds. */
  duration: number;

  // FPS stats
  avgFps: number;
  minFps: number;
  maxFps: number;

  // Gameplay stats
  finalScore: number;
  totalKills: number;
  totalDeaths: number;
  killDeathRatio: number;

  // Entity stats
  peakEnemies: number;
  peakBullets: number;
  peakParticles: number;

  // Top killers/victims
  topEnemyKills: Array<{ enemyType: string; count: number }>; // Top 5 enemy types killed
  topPlayerDeaths: Array<{ enemyType: string; count: number }>; // Top 5 enemy types that killed player
  topWeapons: Array<{ weaponType: string; kills: number }>; // Top 5 weapons by kills

  // Buff usage
  buffUsage: Array<{ buffType: string; totalTime: number; maxStacks: number }>; // Top 5 buffs by time active

  // Performance stats
  avgDrawCalls: number;
  peakDrawCalls: number;
  totalFrames: number;
}

/** Stored session data for persistence. */
export interface StoredAnalyticsSession {
  summary: SessionSummary;
  dataPoints: AnalyticsDataPoint[];
  killEvents: KillEvent[];
  deathEvents: DeathEvent[];
  buffActivity: BuffActivityEvent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_INTERVAL_MS = 100; // Sample every 100ms (configurable)
const STORAGE_KEY_PREFIX = 'gw_analytics_';
const MAX_STORED_SESSIONS = 100; // Keep last 100 sessions
const MAX_DATA_POINTS_PER_SESSION = 10000; // ~16 minutes @ 100ms sampling

// Pre-allocated temp objects for zero-allocation sampling
const _tempEnemyTypes: Record<string, number> = {};
const _tempActiveBuffs: Record<string, number> = {};

// ---------------------------------------------------------------------------
// GameAnalytics
// ---------------------------------------------------------------------------

export class GameAnalytics {
  private readonly mapType: string;
  private readonly sessionStart: number;
  private sampleAccumulator = 0;

  // Ring buffer for data points
  private readonly dataPoints: AnalyticsDataPoint[];
  private dataPointIndex = 0;
  private dataPointCount = 0;

  // Event logs
  private readonly killEvents: KillEvent[] = [];
  private readonly deathEvents: DeathEvent[] = [];
  private readonly buffActivity: BuffActivityEvent[] = [];

  // Current frame data (set externally)
  private currentFps = 0;
  private currentEnemyCount = 0;
  private currentBulletCount = 0;
  private currentGeomCount = 0;
  private currentParticleCount = 0;
  private readonly currentEnemyTypes = new Map<EnemyType, number>();
  private readonly currentActiveEffects = new Set<number>();
  private currentWeapon: WeaponType = WeaponType.Standard;
  private currentWeaponAmmo = -1;
  private currentWeaponStacks = 1;
  private readonly currentBuffs = new Map<StackBuffType, number>();
  private currentScore = 0;
  private currentKills = 0;
  private currentDeaths = 0;
  private currentDdaLevel = 0;
  private currentDrawCalls = 0;
  private currentTriangles = 0;
  private currentMemoryMB = 0;
  private currentBloomStrength = 0.7;
  private currentQualityLevel = 'HIGH';

  // Session summary accumulators
  private fpsSum = 0;
  private fpsCount = 0;
  private minFps = Infinity;
  private maxFps = 0;
  private peakEnemies = 0;
  private peakBullets = 0;
  private peakParticles = 0;
  private drawCallsSum = 0;
  private peakDrawCalls = 0;

  // Kill/death attribution
  private readonly killsByEnemy = new Map<string, number>();
  private readonly deathsByEnemy = new Map<string, number>();
  private readonly killsByWeapon = new Map<string, number>();

  // Buff usage tracking
  private readonly buffActiveTimes = new Map<string, number>(); // buffType → last activation time
  private readonly buffTotalTimes = new Map<string, number>(); // buffType → total active time
  private readonly buffMaxStacks = new Map<string, number>(); // buffType → max stacks seen

  // Effect dictionary reference
  private readonly effectDict: EffectDictionary;

  // Sample interval (configurable)
  private sampleIntervalMs = SAMPLE_INTERVAL_MS;

  constructor(mapType: string) {
    this.mapType = mapType;
    this.sessionStart = Date.now();
    this.effectDict = EffectDictionary.getInstance();

    // Pre-allocate ring buffer
    this.dataPoints = new Array(MAX_DATA_POINTS_PER_SESSION);
    for (let i = 0; i < MAX_DATA_POINTS_PER_SESSION; i++) {
      this.dataPoints[i] = {
        time: 0,
        fps: 0,
        frameTimeMs: 0,
        enemyCount: 0,
        enemyTypes: {},
        bulletCount: 0,
        geomCount: 0,
        particleCount: 0,
        activeEffects: [],
        activeWeapon: 'Standard',
        weaponAmmo: -1,
        weaponStacks: 1,
        activeBuffs: {},
        score: 0,
        kills: 0,
        deaths: 0,
        ddaLevel: 0,
        drawCalls: 0,
        triangles: 0,
        memoryMB: 0,
        bloomStrength: 0.7,
        qualityLevel: 'HIGH',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame API (call every frame)
  // -------------------------------------------------------------------------

  /**
   * Update analytics with current frame data.
   * Call this every frame with delta time in seconds.
   */
  update(dtSeconds: number): void {
    // Track frame-level stats (not sampled — continuous)
    if (this.currentFps > 0) {
      this.fpsSum += this.currentFps;
      this.fpsCount++;
      if (this.currentFps < this.minFps) this.minFps = this.currentFps;
      if (this.currentFps > this.maxFps) this.maxFps = this.currentFps;
    }
    if (this.currentEnemyCount > this.peakEnemies) this.peakEnemies = this.currentEnemyCount;
    if (this.currentBulletCount > this.peakBullets) this.peakBullets = this.currentBulletCount;
    if (this.currentParticleCount > this.peakParticles) this.peakParticles = this.currentParticleCount;
    if (this.currentDrawCalls > 0) {
      this.drawCallsSum += this.currentDrawCalls;
      if (this.currentDrawCalls > this.peakDrawCalls) this.peakDrawCalls = this.currentDrawCalls;
    }

    // Sample at fixed interval
    this.sampleAccumulator += dtSeconds * 1000;
    if (this.sampleAccumulator >= this.sampleIntervalMs) {
      this.sampleAccumulator -= this.sampleIntervalMs;
      this.takeSample();
    }

    // Update buff active time tracking
    const now = (Date.now() - this.sessionStart) / 1000;
    this.currentBuffs.forEach((stacks, buffType) => {
      const lastTime = this.buffActiveTimes.get(buffType);
      if (lastTime !== undefined) {
        const deltaTime = now - lastTime;
        const currentTotal = this.buffTotalTimes.get(buffType) ?? 0;
        this.buffTotalTimes.set(buffType, currentTotal + deltaTime);
      }
      this.buffActiveTimes.set(buffType, now);

      // Track max stacks
      const currentMax = this.buffMaxStacks.get(buffType) ?? 0;
      if (stacks > currentMax) {
        this.buffMaxStacks.set(buffType, stacks);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Setters (call before update())
  // -------------------------------------------------------------------------

  setFrameData(fps: number, enemyCount: number, bulletCount: number, geomCount: number): void {
    this.currentFps = fps;
    this.currentEnemyCount = enemyCount;
    this.currentBulletCount = bulletCount;
    this.currentGeomCount = geomCount;
  }

  setEnemyTypes(enemyTypes: Map<EnemyType, number>): void {
    this.currentEnemyTypes.clear();
    enemyTypes.forEach((count, type) => {
      this.currentEnemyTypes.set(type, count);
    });
  }

  setParticleCount(count: number): void {
    this.currentParticleCount = count;
  }

  setActiveEffects(effectIds: Set<number> | number[]): void {
    this.currentActiveEffects.clear();
    if (Array.isArray(effectIds)) {
      effectIds.forEach(id => this.currentActiveEffects.add(id));
    } else {
      effectIds.forEach(id => this.currentActiveEffects.add(id));
    }
  }

  setWeaponState(weaponType: WeaponType, ammo: number, stacks: number): void {
    this.currentWeapon = weaponType;
    this.currentWeaponAmmo = ammo;
    this.currentWeaponStacks = stacks;
  }

  setBuffs(buffs: Map<StackBuffType, number>): void {
    this.currentBuffs.clear();
    buffs.forEach((stacks, buffType) => {
      this.currentBuffs.set(buffType, stacks);
    });
  }

  setGameplayData(score: number, kills: number, deaths: number, ddaLevel: number): void {
    this.currentScore = score;
    this.currentKills = kills;
    this.currentDeaths = deaths;
    this.currentDdaLevel = ddaLevel;
  }

  setRendererStats(drawCalls: number, triangles: number, memoryMB: number): void {
    this.currentDrawCalls = drawCalls;
    this.currentTriangles = triangles;
    this.currentMemoryMB = memoryMB;
  }

  setBloomState(strength: number): void {
    this.currentBloomStrength = strength;
  }

  setQualityLevel(level: string): void {
    this.currentQualityLevel = level;
  }

  // -------------------------------------------------------------------------
  // Event recording
  // -------------------------------------------------------------------------

  recordKill(enemyType: EnemyType, weaponType: WeaponType, scoreValue: number, enemyTier: string): void {
    const time = (Date.now() - this.sessionStart) / 1000;
    this.killEvents.push({
      time,
      enemyType,
      weaponType,
      scoreValue,
      enemyTier,
    });

    // Update attribution maps
    const enemyCount = this.killsByEnemy.get(enemyType) ?? 0;
    this.killsByEnemy.set(enemyType, enemyCount + 1);

    const weaponCount = this.killsByWeapon.get(weaponType) ?? 0;
    this.killsByWeapon.set(weaponType, weaponCount + 1);
  }

  recordDeath(enemyType: EnemyType, healthAtDeath: number): void {
    const time = (Date.now() - this.sessionStart) / 1000;
    const activeBuffs = Array.from(this.currentBuffs.keys());
    this.deathEvents.push({
      time,
      enemyType,
      healthAtDeath,
      activeBuffs,
      weaponEquipped: this.currentWeapon,
    });

    // Update attribution map
    const count = this.deathsByEnemy.get(enemyType) ?? 0;
    this.deathsByEnemy.set(enemyType, count + 1);
  }

  recordBuffEvent(buffType: StackBuffType, eventType: 'gained' | 'lost' | 'stacked' | 'expired', stacks: number): void {
    const time = (Date.now() - this.sessionStart) / 1000;
    this.buffActivity.push({
      time,
      buffType,
      eventType,
      stacks,
    });
  }

  // -------------------------------------------------------------------------
  // Effect dictionary integration
  // -------------------------------------------------------------------------

  /**
   * Register an effect with the effect dictionary and return its ID.
   * Call this when creating visual effects (particles, explosions, auras).
   */
  registerEffect(type: string, name: string, source: string, metadata?: Record<string, any>): number {
    return this.effectDict.register(type, name, source, metadata);
  }

  // -------------------------------------------------------------------------
  // Export & Persistence
  // -------------------------------------------------------------------------

  /**
   * Get session summary for export.
   */
  getSessionSummary(): SessionSummary {
    const duration = (Date.now() - this.sessionStart) / 1000;
    const avgFps = this.fpsCount > 0 ? this.fpsSum / this.fpsCount : 0;
    const avgDrawCalls = this.fpsCount > 0 ? this.drawCallsSum / this.fpsCount : 0;

    // Top enemy types killed
    const topEnemyKills = Array.from(this.killsByEnemy.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([enemyType, count]) => ({ enemyType, count }));

    // Top enemy types that killed player
    const topPlayerDeaths = Array.from(this.deathsByEnemy.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([enemyType, count]) => ({ enemyType, count }));

    // Top weapons by kills
    const topWeapons = Array.from(this.killsByWeapon.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([weaponType, kills]) => ({ weaponType, kills }));

    // Top buffs by active time
    const buffUsage = Array.from(this.buffTotalTimes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([buffType, totalTime]) => ({
        buffType,
        totalTime,
        maxStacks: this.buffMaxStacks.get(buffType) ?? 0,
      }));

    return {
      timestamp: new Date().toISOString(),
      mapType: this.mapType,
      duration,
      avgFps: Math.round(avgFps * 10) / 10,
      minFps: this.minFps === Infinity ? 0 : Math.round(this.minFps * 10) / 10,
      maxFps: Math.round(this.maxFps * 10) / 10,
      finalScore: this.currentScore,
      totalKills: this.currentKills,
      totalDeaths: this.currentDeaths,
      killDeathRatio: this.currentDeaths > 0 ? Math.round((this.currentKills / this.currentDeaths) * 100) / 100 : this.currentKills,
      peakEnemies: this.peakEnemies,
      peakBullets: this.peakBullets,
      peakParticles: this.peakParticles,
      topEnemyKills,
      topPlayerDeaths,
      topWeapons,
      buffUsage,
      avgDrawCalls: Math.round(avgDrawCalls),
      peakDrawCalls: this.peakDrawCalls,
      totalFrames: this.fpsCount,
    };
  }

  /**
   * Save session to localStorage (non-blocking, uses requestIdleCallback if available).
   */
  saveSession(): void {
    const stored: StoredAnalyticsSession = {
      summary: this.getSessionSummary(),
      dataPoints: this.getDataPoints(),
      killEvents: [...this.killEvents],
      deathEvents: [...this.deathEvents],
      buffActivity: [...this.buffActivity],
    };

    const saveFunc = () => {
      try {
        const sessionKey = `${STORAGE_KEY_PREFIX}${Date.now()}`;
        localStorage.setItem(sessionKey, JSON.stringify(stored));

        // Trim old sessions
        this.trimOldSessions();
      } catch {
        // localStorage full or unavailable
      }
    };

    // Use requestIdleCallback if available for non-blocking save
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      requestIdleCallback(saveFunc);
    } else {
      setTimeout(saveFunc, 0);
    }
  }

  /**
   * Export all sessions as JSON.
   */
  static exportAllAsJSON(): string {
    const sessions: StoredAnalyticsSession[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
          const raw = localStorage.getItem(key);
          if (raw) {
            sessions.push(JSON.parse(raw));
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return JSON.stringify(sessions, null, 2);
  }

  /**
   * Export all sessions as CSV (flattened data points).
   */
  static exportAllAsCSV(): string {
    const headers = [
      'session_timestamp', 'session_map', 'time_s', 'fps', 'frame_time_ms',
      'enemy_count', 'bullet_count', 'geom_count', 'particle_count',
      'active_effects', 'active_weapon', 'weapon_ammo', 'weapon_stacks',
      'active_buffs', 'score', 'kills', 'deaths', 'dda_level',
      'draw_calls', 'triangles', 'memory_mb', 'bloom_strength', 'quality_level',
      'top_enemy_types',
    ];
    const rows: string[] = [headers.join(',')];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const session: StoredAnalyticsSession = JSON.parse(raw);

          for (const dp of session.dataPoints) {
            const enemyTypesStr = Object.entries(dp.enemyTypes)
              .map(([type, count]) => `${type}:${count}`)
              .join(';');
            const effectsStr = dp.activeEffects.join(';');
            const buffsStr = Object.entries(dp.activeBuffs)
              .map(([type, stacks]) => `${type}:${stacks}`)
              .join(';');

            rows.push([
              session.summary.timestamp,
              session.summary.mapType,
              dp.time,
              dp.fps,
              dp.frameTimeMs,
              dp.enemyCount,
              dp.bulletCount,
              dp.geomCount,
              dp.particleCount,
              `"${effectsStr}"`,
              dp.activeWeapon,
              dp.weaponAmmo,
              dp.weaponStacks,
              `"${buffsStr}"`,
              dp.score,
              dp.kills,
              dp.deaths,
              dp.ddaLevel,
              dp.drawCalls,
              dp.triangles,
              dp.memoryMB,
              dp.bloomStrength,
              dp.qualityLevel,
              `"${enemyTypesStr}"`,
            ].join(','));
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return rows.join('\n');
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private takeSample(): void {
    const elapsed = (Date.now() - this.sessionStart) / 1000;
    const point = this.dataPoints[this.dataPointIndex];

    // Reuse existing object (zero-GC)
    point.time = Math.round(elapsed * 10) / 10;
    point.fps = Math.round(this.currentFps * 10) / 10;
    point.frameTimeMs = this.currentFps > 0 ? Math.round((1000 / this.currentFps) * 10) / 10 : 0;
    point.enemyCount = this.currentEnemyCount;
    point.bulletCount = this.currentBulletCount;
    point.geomCount = this.currentGeomCount;
    point.particleCount = this.currentParticleCount;
    point.activeWeapon = this.currentWeapon;
    point.weaponAmmo = this.currentWeaponAmmo;
    point.weaponStacks = this.currentWeaponStacks;
    point.score = this.currentScore;
    point.kills = this.currentKills;
    point.deaths = this.currentDeaths;
    point.ddaLevel = Math.round(this.currentDdaLevel * 100) / 100;
    point.drawCalls = this.currentDrawCalls;
    point.triangles = this.currentTriangles;
    point.memoryMB = Math.round(this.currentMemoryMB * 100) / 100;
    point.bloomStrength = Math.round(this.currentBloomStrength * 100) / 100;
    point.qualityLevel = this.currentQualityLevel;

    // Copy enemy types (reuse existing object keys)
    for (const key in point.enemyTypes) {
      delete point.enemyTypes[key];
    }
    this.currentEnemyTypes.forEach((count, type) => {
      point.enemyTypes[type] = count;
    });

    // Copy active effects (allocate new array — effects change frequently)
    point.activeEffects = Array.from(this.currentActiveEffects);

    // Copy active buffs (reuse existing object keys)
    for (const key in point.activeBuffs) {
      delete point.activeBuffs[key];
    }
    this.currentBuffs.forEach((stacks, buffType) => {
      point.activeBuffs[buffType] = stacks;
    });

    this.dataPointIndex = (this.dataPointIndex + 1) % MAX_DATA_POINTS_PER_SESSION;
    if (this.dataPointCount < MAX_DATA_POINTS_PER_SESSION) {
      this.dataPointCount++;
    }
  }

  private getDataPoints(): AnalyticsDataPoint[] {
    const result: AnalyticsDataPoint[] = [];
    const count = Math.min(this.dataPointCount, MAX_DATA_POINTS_PER_SESSION);

    if (this.dataPointCount < MAX_DATA_POINTS_PER_SESSION) {
      for (let i = 0; i < count; i++) {
        result.push(this.copyDataPoint(this.dataPoints[i]));
      }
    } else {
      for (let i = 0; i < count; i++) {
        const idx = (this.dataPointIndex + i) % MAX_DATA_POINTS_PER_SESSION;
        result.push(this.copyDataPoint(this.dataPoints[idx]));
      }
    }

    return result;
  }

  private copyDataPoint(point: AnalyticsDataPoint): AnalyticsDataPoint {
    return {
      time: point.time,
      fps: point.fps,
      frameTimeMs: point.frameTimeMs,
      enemyCount: point.enemyCount,
      enemyTypes: { ...point.enemyTypes },
      bulletCount: point.bulletCount,
      geomCount: point.geomCount,
      particleCount: point.particleCount,
      activeEffects: [...point.activeEffects],
      activeWeapon: point.activeWeapon,
      weaponAmmo: point.weaponAmmo,
      weaponStacks: point.weaponStacks,
      activeBuffs: { ...point.activeBuffs },
      score: point.score,
      kills: point.kills,
      deaths: point.deaths,
      ddaLevel: point.ddaLevel,
      drawCalls: point.drawCalls,
      triangles: point.triangles,
      memoryMB: point.memoryMB,
      bloomStrength: point.bloomStrength,
      qualityLevel: point.qualityLevel,
    };
  }

  private trimOldSessions(): void {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
          keys.push(key);
        }
      }

      if (keys.length > MAX_STORED_SESSIONS) {
        // Sort by timestamp (embedded in key) and delete oldest
        keys.sort();
        const toDelete = keys.slice(0, keys.length - MAX_STORED_SESSIONS);
        toDelete.forEach(key => localStorage.removeItem(key));
      }
    } catch {
      // Ignore errors
    }
  }
}
