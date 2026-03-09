// ---------------------------------------------------------------------------
// DDA Decision Engine
//
// Takes performance data from all players, computes percentile rankings,
// and outputs per-player DDA levels with hysteresis and smooth ramps.
//
// Recalculates every 2 seconds (not every frame) to save CPU.
// Zero per-frame allocations.
// ---------------------------------------------------------------------------

import { DDAPerformanceTracker } from './DDAPerformanceTracker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** DDA severity level per player. */
export type DDALevelValue = 0 | 1 | 2 | 3;

/** Per-player DDA state (internal, pre-allocated). */
interface PlayerDDAState {
  /** Target DDA level based on thresholds. */
  targetLevel: DDALevelValue;
  /** Current smoothed DDA level (float for ramp interpolation). */
  currentLevel: number;
  /** Composite performance score (0-1, higher = better). */
  compositeScore: number;
  /** Player speed multiplier output (1.0 - 1.2). */
  speedMultiplier: number;
}

/** Configuration for the DDA engine. */
export interface DDAConfig {
  /** Performance score threshold to enter level 1 (below this = mild). */
  mildThreshold: number;
  /** Performance score threshold to enter level 2 (below this = moderate). */
  moderateThreshold: number;
  /** Performance score threshold to enter level 3 (below this = severe). */
  severeThreshold: number;
  /** Hysteresis: performance score to deactivate level 1. */
  mildDeactivate: number;
  /** Hysteresis: performance score to deactivate level 2. */
  moderateDeactivate: number;
  /** Hysteresis: performance score to deactivate level 3. */
  severeDeactivate: number;
  /** Seconds to ramp up to full adjustment. */
  rampUpTime: number;
  /** Seconds to ramp down from full adjustment. */
  rampDownTime: number;
  /** Recalculation interval in seconds. */
  updateInterval: number;
  /** Disable DDA when difficulty tier >= this value. */
  disableOnTier: number;

  // ---------------------------------------------------------------------------
  // Dominance penalty (punishes high-performing players)
  // ---------------------------------------------------------------------------

  /** Composite score above which dominance scaling begins (default 0.65). */
  dominanceThreshold: number;
  /** Composite score for max dominance HP multiplier (default 0.85). */
  dominanceMaxScore: number;
  /** Maximum HP multiplier at full dominance (default 5.0 = 5x enemy HP). */
  dominanceMaxHpMultiplier: number;
  /** Each guardian companion adds this to effective DDA dominance score (default 0.05). */
  companionDominanceBonus: number;
  /** Small-map difficulty multiplier applied on top of dominance scaling (default 1.5). */
  smallMapDominanceBoost: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DDAConfig = {
  mildThreshold: 0.35,
  moderateThreshold: 0.20,
  severeThreshold: 0.10,
  mildDeactivate: 0.50,
  moderateDeactivate: 0.35,
  severeDeactivate: 0.25,
  rampUpTime: 15,
  rampDownTime: 20,
  updateInterval: 2.0,
  disableOnTier: 4, // Nightmare

  // Dominance penalty defaults
  dominanceThreshold: 0.65,
  dominanceMaxScore: 0.85,
  dominanceMaxHpMultiplier: 5.0,
  companionDominanceBonus: 0.05,
  smallMapDominanceBoost: 1.5,
};

/** Speed multipliers per DDA level (1.0 = no boost, higher = player moves faster).
 *  User constraint: MAX 20% boost, only at level 3. */
const SPEED_MULTIPLIERS: readonly number[] = [
  1.0,   // Level 0: no boost
  1.0,   // Level 1: no speed boost (only enemy mix changes)
  1.05,  // Level 2: 5% boost
  1.20,  // Level 3: 20% boost (max per user constraint)
];

// ---------------------------------------------------------------------------
// DDADecisionEngine
// ---------------------------------------------------------------------------

export class DDADecisionEngine {
  private readonly config: DDAConfig;
  private enabled = true;
  private updateAccumulator = 0;

  /** Pre-allocated state per player (max 20 players). */
  private readonly playerStates: PlayerDDAState[] = [];

  /** Maximum number of players supported. */
  private static readonly MAX_PLAYERS = 20;

  constructor(config?: Partial<DDAConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Pre-allocate state for up to 20 players
    for (let i = 0; i < DDADecisionEngine.MAX_PLAYERS; i++) {
      this.playerStates.push({
        targetLevel: 0,
        currentLevel: 0,
        compositeScore: 0.5,
        speedMultiplier: 1.0,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Update the DDA engine. Call every frame; internally throttles to
   * config.updateInterval (default 2s).
   *
   * @param dt Frame delta time in seconds.
   * @param trackers Array of per-player performance trackers.
   * @param currentDifficultyTier Current difficulty tier (0-4). DDA disabled at >= disableOnTier.
   */
  update(dt: number, trackers: readonly DDAPerformanceTracker[], currentDifficultyTier: number = 0): void {
    if (!this.enabled) return;

    // Disable on Nightmare tier
    if (currentDifficultyTier >= this.config.disableOnTier) {
      this.resetAllStates();
      return;
    }

    // Throttled recalculation
    this.updateAccumulator += dt;
    if (this.updateAccumulator >= this.config.updateInterval) {
      this.updateAccumulator -= this.config.updateInterval;
      this.recalculate(trackers);
    }

    // Ramp current level toward target every frame (smooth transition)
    for (let i = 0; i < trackers.length && i < DDADecisionEngine.MAX_PLAYERS; i++) {
      const state = this.playerStates[i];
      const target = state.targetLevel;

      if (state.currentLevel < target) {
        // Ramp up
        state.currentLevel = Math.min(
          target,
          state.currentLevel + dt / this.config.rampUpTime * 3, // 3 levels over rampUpTime
        );
      } else if (state.currentLevel > target) {
        // Ramp down (slower)
        state.currentLevel = Math.max(
          target,
          state.currentLevel - dt / this.config.rampDownTime * 3,
        );
      }

      // Compute speed multiplier from current smoothed level
      const floorLevel = Math.floor(state.currentLevel);
      const ceilLevel = Math.min(3, floorLevel + 1);
      const frac = state.currentLevel - floorLevel;
      state.speedMultiplier = SPEED_MULTIPLIERS[floorLevel] * (1 - frac)
        + SPEED_MULTIPLIERS[ceilLevel] * frac;
    }
  }

  /**
   * Get the current DDA level for a player (0-3).
   * Returns the floor of the smoothed current level.
   */
  getDDALevel(playerIndex: number): DDALevelValue {
    if (!this.enabled || playerIndex >= DDADecisionEngine.MAX_PLAYERS) return 0;
    return Math.floor(this.playerStates[playerIndex].currentLevel) as DDALevelValue;
  }

  /**
   * Get the current smoothed DDA level (float, for gradual adjustments).
   */
  getDDALevelSmooth(playerIndex: number): number {
    if (!this.enabled || playerIndex >= DDADecisionEngine.MAX_PLAYERS) return 0;
    return this.playerStates[playerIndex].currentLevel;
  }

  /**
   * Get the player speed multiplier (1.0 - 1.2).
   * Apply to player movement speed.
   */
  getSpeedMultiplier(playerIndex: number): number {
    if (!this.enabled || playerIndex >= DDADecisionEngine.MAX_PLAYERS) return 1.0;
    return this.playerStates[playerIndex].speedMultiplier;
  }

  /**
   * Get the composite performance score for a player (0-1).
   * Useful for debug display.
   */
  getCompositeScore(playerIndex: number): number {
    if (playerIndex >= DDADecisionEngine.MAX_PLAYERS) return 0.5;
    return this.playerStates[playerIndex].compositeScore;
  }

  /**
   * Get the HP multiplier to apply to spawned enemies for a given player.
   *
   * When a player is dominating (high composite score), this returns a value
   * > 1.0 to make enemies significantly tankier, creating a "wall of difficulty"
   * as the player gets stronger.
   *
   * @param playerIndex Player index (0-based).
   * @param companionCount Number of active guardian/hunter companions this player has.
   * @param isSmallMap Whether the current map is small (tighter = easier to dominate).
   * @returns HP multiplier in range [1.0, dominanceMaxHpMultiplier].
   */
  getDominanceHpMultiplier(
    playerIndex: number,
    companionCount: number = 0,
    isSmallMap: boolean = false,
  ): number {
    if (!this.enabled || playerIndex >= DDADecisionEngine.MAX_PLAYERS) return 1.0;

    const state = this.playerStates[playerIndex];
    if (!this.playerStates[playerIndex]) return 1.0;

    // Adjust score upward for each companion (companions make player much stronger)
    const companionBonus = companionCount * this.config.companionDominanceBonus;
    const effectiveScore = Math.min(1.0, state.compositeScore + companionBonus);

    const threshold = this.config.dominanceThreshold;
    const maxScore = this.config.dominanceMaxScore;

    if (effectiveScore <= threshold) return 1.0;

    // Linear ramp from threshold to maxScore
    const t = Math.min(1.0, (effectiveScore - threshold) / (maxScore - threshold));

    // Exponential curve: t^2 makes it ramp steeply at high performance
    const tSteep = t * t;

    let multiplier = 1.0 + tSteep * (this.config.dominanceMaxHpMultiplier - 1.0);

    // Small map boost: even harder on tight maps
    if (isSmallMap) {
      multiplier = 1.0 + (multiplier - 1.0) * this.config.smallMapDominanceBoost;
    }

    return Math.min(this.config.dominanceMaxHpMultiplier * (isSmallMap ? this.config.smallMapDominanceBoost : 1.0), multiplier);
  }

  /** Enable or disable the DDA system. */
  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) {
      this.resetAllStates();
    }
  }

  /** Whether the DDA system is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Recalculate DDA levels for all tracked players.
   * Called every updateInterval seconds.
   */
  private recalculate(trackers: readonly DDAPerformanceTracker[]): void {
    const n = Math.min(trackers.length, DDADecisionEngine.MAX_PLAYERS);

    if (n === 0) return;

    // Compute composite scores
    for (let i = 0; i < n; i++) {
      const tracker = trackers[i];
      if (!tracker.isWarmedUp) {
        this.playerStates[i].compositeScore = 0.5; // neutral during warmup
        this.playerStates[i].targetLevel = 0;
        continue;
      }
      this.playerStates[i].compositeScore = tracker.getCompositeScore();
    }

    if (n === 1) {
      // Single player: use absolute composite score thresholds
      this.applyThresholds(0);
    } else {
      // Multiplayer: use percentile ranking
      this.applyPercentileRanking(n);
    }
  }

  /**
   * Apply threshold-based DDA level for a single player (single-player mode).
   * Uses hysteresis deadband to prevent oscillation.
   */
  private applyThresholds(playerIndex: number): void {
    const state = this.playerStates[playerIndex];
    const score = state.compositeScore;
    const currentTarget = state.targetLevel;

    // Activation thresholds (going down)
    if (score < this.config.severeThreshold && currentTarget < 3) {
      state.targetLevel = 3;
    } else if (score < this.config.moderateThreshold && currentTarget < 2) {
      state.targetLevel = 2;
    } else if (score < this.config.mildThreshold && currentTarget < 1) {
      state.targetLevel = 1;
    }

    // Deactivation thresholds (going up, with hysteresis)
    if (currentTarget >= 3 && score > this.config.severeDeactivate) {
      state.targetLevel = 2;
    }
    if (currentTarget >= 2 && score > this.config.moderateDeactivate) {
      state.targetLevel = 1;
    }
    if (currentTarget >= 1 && score > this.config.mildDeactivate) {
      state.targetLevel = 0;
    }
  }

  /**
   * Apply percentile-based ranking for multiplayer.
   * Players below median get DDA help; those above get none.
   */
  private applyPercentileRanking(playerCount: number): void {
    // Compute percentile for each player
    for (let i = 0; i < playerCount; i++) {
      const myScore = this.playerStates[i].compositeScore;

      // Count how many players this player is better than
      let betterThan = 0;
      for (let j = 0; j < playerCount; j++) {
        if (j === i) continue;
        if (myScore > this.playerStates[j].compositeScore) {
          betterThan++;
        }
      }

      // Percentile: 0.0 = worst, 1.0 = best
      const percentile = betterThan / (playerCount - 1);

      // Map percentile to thresholds (same structure as single-player)
      // But use percentile instead of raw composite score
      const state = this.playerStates[i];
      const currentTarget = state.targetLevel;

      // Activation
      if (percentile < this.config.severeThreshold && currentTarget < 3) {
        state.targetLevel = 3;
      } else if (percentile < this.config.moderateThreshold && currentTarget < 2) {
        state.targetLevel = 2;
      } else if (percentile < this.config.mildThreshold && currentTarget < 1) {
        state.targetLevel = 1;
      }

      // Deactivation (hysteresis)
      if (currentTarget >= 3 && percentile > this.config.severeDeactivate) {
        state.targetLevel = 2;
      }
      if (currentTarget >= 2 && percentile > this.config.moderateDeactivate) {
        state.targetLevel = 1;
      }
      if (currentTarget >= 1 && percentile > this.config.mildDeactivate) {
        state.targetLevel = 0;
      }
    }
  }

  /** Reset all player states to neutral. */
  private resetAllStates(): void {
    for (const state of this.playerStates) {
      state.targetLevel = 0;
      state.currentLevel = 0;
      state.compositeScore = 0.5;
      state.speedMultiplier = 1.0;
    }
  }
}
