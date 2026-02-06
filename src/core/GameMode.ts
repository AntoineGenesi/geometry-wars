// ---------------------------------------------------------------------------
// Game Mode definitions for Geometry Wars 3D
// ---------------------------------------------------------------------------

export enum GameModeType {
  Deadline = 'deadline',
  Evolved = 'evolved',
  Checkpoint = 'checkpoint',
  Titan = 'titan',
  Pacifism = 'pacifism',
  King = 'king',
  Rainbow = 'rainbow',
  Sniper = 'sniper',
  Claustrophobia = 'claustrophobia',
  Boss = 'boss',
}

export interface GameModeConfig {
  type: GameModeType;
  /** Time limit in seconds (0 = no limit). */
  timeLimit: number;
  /** Number of player lives (0 = infinite). */
  lives: number;
  /** Number of bombs. */
  bombs: number;
  /** Number of super ability uses. */
  supers: number;
  /** Whether the player can shoot. */
  canShoot: boolean;
  /** Star score thresholds [1-star, 2-star, 3-star]. */
  starThresholds: [number, number, number];
}

/**
 * Mode-specific rule configurations.
 */
export const MODE_DEFAULTS: Record<GameModeType, Partial<GameModeConfig>> = {
  [GameModeType.Deadline]: {
    lives: 0, // infinite
    canShoot: true,
  },
  [GameModeType.Evolved]: {
    timeLimit: 0, // no timer
    canShoot: true,
  },
  [GameModeType.Checkpoint]: {
    lives: 0,
    canShoot: true,
  },
  [GameModeType.Titan]: {
    canShoot: true,
  },
  [GameModeType.Pacifism]: {
    lives: 1,
    bombs: 0,
    supers: 0,
    canShoot: false,
  },
  [GameModeType.King]: {
    lives: 1,
    canShoot: true, // but only in safe zones (handled by mode logic)
  },
  [GameModeType.Rainbow]: {
    lives: 1,
    canShoot: true,
  },
  [GameModeType.Sniper]: {
    lives: 1,
    canShoot: true, // limited ammo handled separately
  },
  [GameModeType.Claustrophobia]: {
    lives: 1,
    canShoot: true,
  },
  [GameModeType.Boss]: {
    lives: 1,
    timeLimit: 0,
    canShoot: true,
  },
};

// ---------------------------------------------------------------------------
// GameMode state machine
// ---------------------------------------------------------------------------

export enum ModePhase {
  Countdown = 'countdown',
  Playing = 'playing',
  Complete = 'complete',
  Failed = 'failed',
}

export class GameMode {
  readonly config: GameModeConfig;
  phase: ModePhase = ModePhase.Countdown;

  /** Remaining time in seconds (for timed modes). */
  timeRemaining: number;

  /** Current wave index (for wave-based modes). */
  waveIndex = 0;

  /** Enemies remaining in current wave (for checkpoint mode). */
  waveEnemiesRemaining = 0;

  /** Countdown timer (3-2-1-GO). */
  countdownTimer = 3;

  /** Callback when mode completes (win). */
  onComplete: ((stars: number) => void) | null = null;

  /** Callback when mode fails (lose). */
  onFailed: (() => void) | null = null;

  /** Callback when time bonus is awarded (checkpoint mode). */
  onTimeBonus: ((seconds: number) => void) | null = null;

  constructor(config: GameModeConfig) {
    this.config = config;
    this.timeRemaining = config.timeLimit;
  }

  update(dt: number, currentScore: number, livesRemaining: number): void {
    switch (this.phase) {
      case ModePhase.Countdown:
        this.countdownTimer -= dt;
        if (this.countdownTimer <= 0) {
          this.phase = ModePhase.Playing;
        }
        break;

      case ModePhase.Playing:
        this.updatePlaying(dt, currentScore, livesRemaining);
        break;

      case ModePhase.Complete:
      case ModePhase.Failed:
        // Terminal states
        break;
    }
  }

  private updatePlaying(
    dt: number,
    currentScore: number,
    livesRemaining: number,
  ): void {
    // Check time limit
    if (this.config.timeLimit > 0) {
      this.timeRemaining -= dt;
      if (this.timeRemaining <= 0) {
        this.timeRemaining = 0;
        this.completeLevel(currentScore);
        return;
      }
    }

    // Check lives (for non-infinite modes)
    if (this.config.lives > 0 && livesRemaining <= 0) {
      this.phase = ModePhase.Failed;
      this.onFailed?.();
    }
  }

  /**
   * Trigger level completion and calculate stars.
   */
  completeLevel(finalScore: number): void {
    const stars = this.calculateStars(finalScore);
    this.phase = ModePhase.Complete;
    this.onComplete?.(stars);
  }

  /**
   * Award time bonus in checkpoint mode.
   */
  awardTimeBonus(seconds: number): void {
    if (this.config.type !== GameModeType.Checkpoint) return;
    this.timeRemaining += seconds;
    this.onTimeBonus?.(seconds);
  }

  /**
   * Notify that a wave has been cleared (for checkpoint mode).
   */
  waveClear(): void {
    if (this.config.type === GameModeType.Checkpoint) {
      this.awardTimeBonus(15); // typical bonus
      this.waveIndex += 1;
    }
  }

  /**
   * Calculate star rating based on score thresholds.
   */
  calculateStars(score: number): number {
    const [one, two, three] = this.config.starThresholds;
    if (score >= three) return 3;
    if (score >= two) return 2;
    if (score >= one) return 1;
    return 0;
  }
}
