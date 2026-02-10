// ---------------------------------------------------------------------------
// DDA Performance Tracker
//
// Tracks per-player performance metrics using Exponential Moving Averages.
// Used by the DDA system to detect struggling players.
//
// Zero per-frame allocations. All state is pre-allocated.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Snapshot of a player's current smoothed performance metrics. */
export interface PerformanceSnapshot {
  /** Kills per minute (EMA-smoothed). */
  killRate: number;
  /** Deaths per minute (EMA-smoothed). */
  deathRate: number;
  /** Score gained per minute (EMA-smoothed). */
  scoreRate: number;
  /** Close calls per minute (EMA-smoothed). */
  closeCallFreq: number;
  /** Average distance to nearest enemies (EMA-smoothed, UV space). */
  avgEnemyProximity: number;
  /** Fraction of recent time at low health (EMA-smoothed, 0-1). */
  timeAtLowHealth: number;
}

/** EMA alpha values per metric. */
export interface EMAConfig {
  killRate: number;
  deathRate: number;
  scoreRate: number;
  closeCall: number;
  proximity: number;
  lowHealth: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_EMA: EMAConfig = {
  killRate: 0.05,    // ~20s half-life
  deathRate: 0.15,   // ~5s half-life (react fast to dying)
  scoreRate: 0.02,   // ~50s half-life (very smooth)
  closeCall: 0.08,   // ~12s half-life
  proximity: 0.10,   // ~10s half-life
  lowHealth: 0.08,   // ~12s half-life
};

/** Minimum session time before metrics are valid (seconds). */
const WARMUP_SECONDS = 5.0;

// ---------------------------------------------------------------------------
// Pre-allocated snapshot for getSnapshot() (zero GC)
// ---------------------------------------------------------------------------

const _snapshot: PerformanceSnapshot = {
  killRate: 0,
  deathRate: 0,
  scoreRate: 0,
  closeCallFreq: 0,
  avgEnemyProximity: 1.0,
  timeAtLowHealth: 0,
};

// ---------------------------------------------------------------------------
// DDAPerformanceTracker
// ---------------------------------------------------------------------------

export class DDAPerformanceTracker {
  readonly playerIndex: number;

  // -- EMA config --
  private readonly ema: EMAConfig;

  // -- EMA state (all smoothed values) --
  private _killRate = 0;
  private _deathRate = 0;
  private _scoreRate = 0;
  private _closeCallFreq = 0;
  private _avgEnemyProximity = 1.0; // 1.0 = far away (safe)
  private _timeAtLowHealth = 0;

  // -- Raw event accumulators (reset each second) --
  private killsThisSecond = 0;
  private deathsThisSecond = 0;
  private scoreThisSecond = 0;
  private closeCallsThisSecond = 0;

  // -- Timing --
  private elapsedTime = 0;
  private secondAccumulator = 0;
  private warmedUp = false;

  // -- Total counters (for absolute thresholds in single-player) --
  private _totalKills = 0;
  private _totalDeaths = 0;
  private _totalScore = 0;

  constructor(playerIndex: number, emaConfig?: Partial<EMAConfig>) {
    this.playerIndex = playerIndex;
    this.ema = { ...DEFAULT_EMA, ...emaConfig };
  }

  // -----------------------------------------------------------------------
  // Event recording (call on game events)
  // -----------------------------------------------------------------------

  /** Record a kill by this player. */
  recordKill(scoreValue: number): void {
    this.killsThisSecond++;
    this._totalKills++;
    this.scoreThisSecond += scoreValue;
    this._totalScore += scoreValue;
  }

  /** Record a death of this player. */
  recordDeath(): void {
    this.deathsThisSecond++;
    this._totalDeaths++;
  }

  /** Record a close call (enemy entered danger zone but player survived). */
  recordCloseCall(): void {
    this.closeCallsThisSecond++;
  }

  // -----------------------------------------------------------------------
  // Per-frame update
  // -----------------------------------------------------------------------

  /**
   * Update metrics. Call each frame.
   *
   * @param dt Frame delta time in seconds.
   * @param nearestEnemyDist Distance to nearest enemy in UV space (0-1+).
   * @param healthFraction Player HP / max HP (0-1).
   */
  update(dt: number, nearestEnemyDist: number, healthFraction: number): void {
    this.elapsedTime += dt;
    this.secondAccumulator += dt;

    // Warmup gate: skip EMA updates for the first few seconds
    if (!this.warmedUp) {
      if (this.elapsedTime < WARMUP_SECONDS) {
        return;
      }
      this.warmedUp = true;
    }

    // Update proximity EMA every frame (smoothed distance)
    this._avgEnemyProximity = this.ema.proximity * nearestEnemyDist
      + (1 - this.ema.proximity) * this._avgEnemyProximity;

    // Update low health fraction EMA every frame
    const isLowHealth = healthFraction <= 0.34 ? 1.0 : 0.0;
    this._timeAtLowHealth = this.ema.lowHealth * isLowHealth
      + (1 - this.ema.lowHealth) * this._timeAtLowHealth;

    // Convert accumulated events to per-minute rates every second
    if (this.secondAccumulator >= 1.0) {
      this.secondAccumulator -= 1.0;

      // Convert raw counts to per-minute rates
      const killsPerMin = this.killsThisSecond * 60;
      const deathsPerMin = this.deathsThisSecond * 60;
      const scorePerMin = this.scoreThisSecond * 60;
      const closeCallsPerMin = this.closeCallsThisSecond * 60;

      // Apply EMA
      this._killRate = this.ema.killRate * killsPerMin
        + (1 - this.ema.killRate) * this._killRate;
      this._deathRate = this.ema.deathRate * deathsPerMin
        + (1 - this.ema.deathRate) * this._deathRate;
      this._scoreRate = this.ema.scoreRate * scorePerMin
        + (1 - this.ema.scoreRate) * this._scoreRate;
      this._closeCallFreq = this.ema.closeCall * closeCallsPerMin
        + (1 - this.ema.closeCall) * this._closeCallFreq;

      // Reset accumulators
      this.killsThisSecond = 0;
      this.deathsThisSecond = 0;
      this.scoreThisSecond = 0;
      this.closeCallsThisSecond = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Read current state
  // -----------------------------------------------------------------------

  /**
   * Get a snapshot of current smoothed metrics.
   * Returns a shared object (do NOT store the reference long-term).
   */
  getSnapshot(): Readonly<PerformanceSnapshot> {
    _snapshot.killRate = this._killRate;
    _snapshot.deathRate = this._deathRate;
    _snapshot.scoreRate = this._scoreRate;
    _snapshot.closeCallFreq = this._closeCallFreq;
    _snapshot.avgEnemyProximity = this._avgEnemyProximity;
    _snapshot.timeAtLowHealth = this._timeAtLowHealth;
    return _snapshot;
  }

  /**
   * Compute a single composite performance score (0.0 - 1.0).
   *
   * Higher = performing better.
   * Used as the primary input to the DDA decision engine.
   *
   * In single-player mode, this uses absolute baselines.
   * In multiplayer, the DDADecisionEngine uses percentile ranking instead.
   */
  getCompositeScore(): number {
    // Normalize each metric to a 0-1 "goodness" scale using reasonable baselines
    const killGood = Math.min(1, this._killRate / 30);       // 30 kills/min = max good
    const deathBad = Math.min(1, this._deathRate / 6);        // 6 deaths/min = max bad
    const scoreGood = Math.min(1, this._scoreRate / 50000);   // 50K score/min = max good
    const closeCallBad = Math.min(1, this._closeCallFreq / 30); // 30 close calls/min = max bad
    const proximityBad = 1 - Math.min(1, this._avgEnemyProximity / 0.3); // closer = worse
    const lowHealthBad = this._timeAtLowHealth;

    // Weighted composite: higher = better performance
    return (
      killGood * 0.25 +
      (1 - deathBad) * 0.20 +
      scoreGood * 0.20 +
      (1 - closeCallBad) * 0.15 +
      (1 - proximityBad) * 0.10 +
      (1 - lowHealthBad) * 0.10
    );
  }

  /** Whether the tracker has completed its warmup period and has valid data. */
  get isWarmedUp(): boolean {
    return this.warmedUp;
  }

  /** Total kills recorded. */
  get totalKills(): number {
    return this._totalKills;
  }

  /** Total deaths recorded. */
  get totalDeaths(): number {
    return this._totalDeaths;
  }

  /** Total elapsed time in seconds. */
  get elapsed(): number {
    return this.elapsedTime;
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  /** Reset all metrics (new game, respawn, etc.). */
  reset(): void {
    this._killRate = 0;
    this._deathRate = 0;
    this._scoreRate = 0;
    this._closeCallFreq = 0;
    this._avgEnemyProximity = 1.0;
    this._timeAtLowHealth = 0;
    this.killsThisSecond = 0;
    this.deathsThisSecond = 0;
    this.scoreThisSecond = 0;
    this.closeCallsThisSecond = 0;
    this.elapsedTime = 0;
    this.secondAccumulator = 0;
    this.warmedUp = false;
    this._totalKills = 0;
    this._totalDeaths = 0;
    this._totalScore = 0;
  }
}
