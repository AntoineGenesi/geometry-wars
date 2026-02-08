import type { Player } from '../entities/Player';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreEvent {
  basePoints: number;
  multipliedPoints: number;
  multiplier: number;
  enemyType: string;
}

// ---------------------------------------------------------------------------
// ScoreManager
// ---------------------------------------------------------------------------

/**
 * Centralized scoring system that tracks score, multiplier, and emits
 * events for the HUD to display combo/kill feedback.
 */
export class ScoreManager {
  private player: Player | null = null;

  /** Recent score events for combo display. */
  private readonly recentEvents: ScoreEvent[] = [];

  /** Combo tracking */
  private comboCount = 0;
  private comboTimer = 0;
  private readonly comboWindow = 1.5; // seconds to chain kills

  /** Current combo count (read-only) */
  get combo(): number { return this.comboCount; }

  /** Callback fired whenever score changes (for HUD updates). */
  onScoreChange: ((score: number, multiplier: number) => void) | null = null;

  /** Callback fired on each kill (for floating score text). */
  onKill: ((event: ScoreEvent) => void) | null = null;

  /** Callback fired when combo changes (for HUD display). */
  onComboChange: ((combo: number) => void) | null = null;

  setPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * Called when an enemy is killed. Awards score based on current multiplier.
   * Combo kills within the time window give bonus score.
   */
  awardKill(basePoints: number, enemyType: string): void {
    if (!this.player) return;

    // Update combo
    this.comboCount++;
    this.comboTimer = this.comboWindow;

    // Combo bonus: +10% per combo level (capped at 5x)
    const comboMultiplier = 1 + Math.min(this.comboCount - 1, 40) * 0.1;
    const comboPoints = Math.floor(basePoints * comboMultiplier);

    const multipliedPoints = comboPoints * this.player.multiplier;
    this.player.addScore(comboPoints);

    const event: ScoreEvent = {
      basePoints: comboPoints,
      multipliedPoints,
      multiplier: this.player.multiplier,
      enemyType,
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > 10) {
      this.recentEvents.shift();
    }

    this.onKill?.(event);
    this.onComboChange?.(this.comboCount);
    this.onScoreChange?.(this.player.score, this.player.multiplier);
  }

  /**
   * Update combo timer. Call each frame.
   */
  updateCombo(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboTimer = 0;
        this.onComboChange?.(0);
      }
    }
  }

  /**
   * Called when a geom is collected. Increases multiplier.
   */
  collectGeom(): void {
    if (!this.player) return;

    this.player.addMultiplier(1);
    this.onScoreChange?.(this.player.score, this.player.multiplier);
  }

  /**
   * Called when the player dies. Resets multiplier.
   */
  onPlayerDeath(): void {
    // Multiplier reset is handled in Player.die()
    if (this.player) {
      this.onScoreChange?.(this.player.score, this.player.multiplier);
    }
  }

  getRecentEvents(): ReadonlyArray<ScoreEvent> {
    return this.recentEvents;
  }

  /**
   * Get a damage multiplier based on the player's current score.
   * Higher scores = stronger standard bullets.
   *
   * Thresholds:
   *   0-10K:   1.0x
   *   10K-50K: 1.25x
   *   50K-200K: 1.5x
   *   200K-500K: 2.0x
   *   500K+:   2.5x
   */
  getScorePowerMultiplier(): number {
    if (!this.player) return 1.0;
    const s = this.player.score;
    if (s >= 500_000) return 2.5;
    if (s >= 200_000) return 2.0;
    if (s >= 50_000) return 1.5;
    if (s >= 10_000) return 1.25;
    return 1.0;
  }
}
