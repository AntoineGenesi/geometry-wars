/**
 * Adaptive quality system that automatically adjusts visual fidelity
 * to maintain a target frame rate (60fps).
 *
 * Monitors FPS via PerformanceMonitor's rolling average and transitions
 * between quality levels with hysteresis (sustained deviation required)
 * and cooldown (minimum time between changes) to prevent oscillation.
 *
 * Quality knobs are adjusted in priority order -- cheaper-to-reduce
 * settings are scaled back first before touching more impactful ones.
 */

import { PerformanceMonitor, PerformanceSnapshot } from './PerformanceMonitor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Quality levels from highest to lowest fidelity. */
export enum QualityLevel {
  ULTRA = 'ULTRA',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  MINIMAL = 'MINIMAL',
}

/** All quality levels ordered from highest to lowest. */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  QualityLevel.ULTRA,
  QualityLevel.HIGH,
  QualityLevel.MEDIUM,
  QualityLevel.LOW,
  QualityLevel.MINIMAL,
] as const;

/** Detail level for trail effects. */
export enum TrailDetail {
  FULL = 'full',
  SIMPLIFIED = 'simplified',
  DISABLED = 'disabled',
}

/** Detail level for enemy rendering. */
export enum EnemyDetail {
  FULL = 'full',
  LOD = 'lod',
  BILLBOARD = 'billboard',
}

/** The concrete settings for each quality knob. */
export interface QualitySettings {
  /** Maximum particle pool size. */
  particleCount: number;
  /** Bloom resolution scale (1.0 = full, 0 = disabled). */
  bloomResolutionScale: number;
  /** Whether bloom is enabled at all. */
  bloomEnabled: boolean;
  /** Trail effect detail level. */
  trailDetail: TrailDetail;
  /** Enemy rendering detail level. */
  enemyDetail: EnemyDetail;
  /** Maximum visible enemies (0 = no limit). */
  maxVisibleEnemies: number;
  /** Whether shadow maps are enabled. */
  shadowsEnabled: boolean;
  /** Whether post-processing (vignette, color grading) is enabled. */
  postProcessingEnabled: boolean;
}

/** Configuration for the adaptive quality system. */
export interface AdaptiveQualityConfig {
  /** FPS below which quality should decrease. Default: 55. */
  fpsLowerThreshold?: number;
  /** FPS above which quality can increase. Default: 58. */
  fpsUpperThreshold?: number;
  /** Frames of sustained deviation before triggering a change. Default: 30. */
  hysteresisFrames?: number;
  /** Minimum seconds between quality changes. Default: 2. */
  cooldownSeconds?: number;
  /** Initial quality level. Default: ULTRA. */
  initialLevel?: QualityLevel;
  /** Rolling average window size for the monitor. Default: 60. */
  monitorWindowSize?: number;
}

// ---------------------------------------------------------------------------
// Quality presets
// ---------------------------------------------------------------------------

/** Settings for each quality level. Ordered knobs reflect priority. */
const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualitySettings>> = {
  [QualityLevel.ULTRA]: {
    particleCount: 5000,
    bloomResolutionScale: 1.0,
    bloomEnabled: true,
    trailDetail: TrailDetail.FULL,
    enemyDetail: EnemyDetail.FULL,
    maxVisibleEnemies: 0, // no limit
    shadowsEnabled: true,
    postProcessingEnabled: true,
  },
  [QualityLevel.HIGH]: {
    particleCount: 2000,
    bloomResolutionScale: 0.5,
    bloomEnabled: true,
    trailDetail: TrailDetail.FULL,
    enemyDetail: EnemyDetail.FULL,
    maxVisibleEnemies: 500,
    shadowsEnabled: true,
    postProcessingEnabled: true,
  },
  [QualityLevel.MEDIUM]: {
    particleCount: 500,
    bloomResolutionScale: 0.25,
    bloomEnabled: true,
    trailDetail: TrailDetail.SIMPLIFIED,
    enemyDetail: EnemyDetail.LOD,
    maxVisibleEnemies: 200,
    shadowsEnabled: false,
    postProcessingEnabled: true,
  },
  [QualityLevel.LOW]: {
    particleCount: 100,
    bloomResolutionScale: 0,
    bloomEnabled: false,
    trailDetail: TrailDetail.DISABLED,
    enemyDetail: EnemyDetail.BILLBOARD,
    maxVisibleEnemies: 50,
    shadowsEnabled: false,
    postProcessingEnabled: false,
  },
  [QualityLevel.MINIMAL]: {
    particleCount: 100,
    bloomResolutionScale: 0,
    bloomEnabled: false,
    trailDetail: TrailDetail.DISABLED,
    enemyDetail: EnemyDetail.BILLBOARD,
    maxVisibleEnemies: 50,
    shadowsEnabled: false,
    postProcessingEnabled: false,
  },
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FPS_LOWER = 55;
const DEFAULT_FPS_UPPER = 58;
const DEFAULT_HYSTERESIS_FRAMES = 30;
const DEFAULT_COOLDOWN_SECONDS = 2;
const DEFAULT_MONITOR_WINDOW = 60;

// ---------------------------------------------------------------------------
// AdaptiveQuality
// ---------------------------------------------------------------------------

/**
 * Monitors real-time performance and adjusts quality level to maintain 60fps.
 *
 * Usage:
 *   const aq = new AdaptiveQuality();
 *   aq.onQualityChange = (oldLevel, newLevel) => applySettings(aq.getSettings());
 *
 *   // Each frame in the game loop:
 *   aq.update(dt);
 *   const settings = aq.getSettings();
 */
export class AdaptiveQuality {
  // -- Configuration (immutable after construction) --
  private readonly fpsLowerThreshold: number;
  private readonly fpsUpperThreshold: number;
  private readonly hysteresisFrames: number;
  private readonly cooldownSeconds: number;

  // -- State --
  private _enabled: boolean = true;
  private _level: QualityLevel;
  private _manualOverride: boolean = false;

  // -- Hysteresis counters --
  private framesBelow: number = 0;
  private framesAbove: number = 0;

  // -- Cooldown timer (seconds since last quality change) --
  private timeSinceLastChange: number;

  // -- Performance monitor --
  readonly monitor: PerformanceMonitor;

  // -- Callback --
  onQualityChange: ((oldLevel: QualityLevel, newLevel: QualityLevel) => void) | null = null;

  constructor(config: AdaptiveQualityConfig = {}) {
    this.fpsLowerThreshold = config.fpsLowerThreshold ?? DEFAULT_FPS_LOWER;
    this.fpsUpperThreshold = config.fpsUpperThreshold ?? DEFAULT_FPS_UPPER;
    this.hysteresisFrames = config.hysteresisFrames ?? DEFAULT_HYSTERESIS_FRAMES;
    this.cooldownSeconds = config.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
    this._level = config.initialLevel ?? QualityLevel.ULTRA;

    const windowSize = config.monitorWindowSize ?? DEFAULT_MONITOR_WINDOW;
    this.monitor = new PerformanceMonitor(windowSize);

    // Start with cooldown already elapsed so first adjustment can happen promptly
    this.timeSinceLastChange = this.cooldownSeconds;
  }

  // -- Public API --

  /** Whether the adaptive system is actively adjusting quality. */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Enable or disable automatic quality adjustment. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  /** Current quality level. */
  getQualityLevel(): QualityLevel {
    return this._level;
  }

  /** Current quality settings for the active level. Returns a copy. */
  getSettings(): QualitySettings {
    return { ...QUALITY_PRESETS[this._level] };
  }

  /** Get settings for a specific quality level (useful for previews). */
  static getSettingsForLevel(level: QualityLevel): QualitySettings {
    return { ...QUALITY_PRESETS[level] };
  }

  /**
   * Force a specific quality level, disabling automatic adjustment.
   * Call setEnabled(true) to re-enable automatic mode.
   */
  forceQuality(level: QualityLevel): void {
    const old = this._level;
    this._manualOverride = true;
    this._enabled = false;

    if (old !== level) {
      this._level = level;
      this.onQualityChange?.(old, level);
    }
  }

  /** Whether quality is currently in manual override mode. */
  get isManualOverride(): boolean {
    return this._manualOverride;
  }

  /**
   * Re-enable automatic quality adjustment after a manual override.
   * Equivalent to setEnabled(true) but also clears the override flag.
   */
  clearOverride(): void {
    this._manualOverride = false;
    this._enabled = true;
    this.framesBelow = 0;
    this.framesAbove = 0;
    this.timeSinceLastChange = this.cooldownSeconds; // allow immediate adjustment
  }

  /**
   * Main per-frame update. Records frame time and evaluates whether
   * a quality transition is needed.
   *
   * @param dt Delta time in seconds.
   */
  update(dt: number): void {
    this.monitor.recordFrame(dt);
    this.timeSinceLastChange += dt;

    if (!this._enabled || this._manualOverride) return;
    if (!this.monitor.isWarmedUp) return;

    const snapshot = this.monitor.getSnapshot();
    this.evaluateQuality(snapshot);
  }

  /** Get the latest performance snapshot without recording a frame. */
  getPerformanceSnapshot(): PerformanceSnapshot {
    return this.monitor.getSnapshot();
  }

  /** Reset the monitor and hysteresis state. Quality level is preserved. */
  reset(): void {
    this.monitor.reset();
    this.framesBelow = 0;
    this.framesAbove = 0;
    this.timeSinceLastChange = this.cooldownSeconds;
  }

  // -- Internal --

  /**
   * Evaluate whether to step quality up or down based on the snapshot FPS
   * and hysteresis/cooldown rules.
   */
  private evaluateQuality(snapshot: PerformanceSnapshot): void {
    const fps = snapshot.fps;

    if (fps < this.fpsLowerThreshold) {
      this.framesBelow++;
      this.framesAbove = 0;
    } else if (fps > this.fpsUpperThreshold) {
      this.framesAbove++;
      this.framesBelow = 0;
    } else {
      // FPS is in the acceptable band -- reset both counters
      this.framesBelow = 0;
      this.framesAbove = 0;
    }

    // Check cooldown
    if (this.timeSinceLastChange < this.cooldownSeconds) return;

    // Decrease quality if sustained low FPS
    if (this.framesBelow >= this.hysteresisFrames) {
      this.stepDown();
    }
    // Increase quality if sustained high FPS
    else if (this.framesAbove >= this.hysteresisFrames) {
      this.stepUp();
    }
  }

  /** Step quality down one level (toward MINIMAL). */
  private stepDown(): void {
    const idx = QUALITY_LEVELS.indexOf(this._level);
    if (idx < QUALITY_LEVELS.length - 1) {
      const oldLevel = this._level;
      this._level = QUALITY_LEVELS[idx + 1];
      this.afterTransition(oldLevel, this._level);
    }
  }

  /** Step quality up one level (toward ULTRA). */
  private stepUp(): void {
    const idx = QUALITY_LEVELS.indexOf(this._level);
    if (idx > 0) {
      const oldLevel = this._level;
      this._level = QUALITY_LEVELS[idx - 1];
      this.afterTransition(oldLevel, this._level);
    }
  }

  /** Post-transition bookkeeping. */
  private afterTransition(oldLevel: QualityLevel, newLevel: QualityLevel): void {
    this.framesBelow = 0;
    this.framesAbove = 0;
    this.timeSinceLastChange = 0;
    this.onQualityChange?.(oldLevel, newLevel);
  }
}
