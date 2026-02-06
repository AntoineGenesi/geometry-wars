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

  /** Callback fired whenever score changes (for HUD updates). */
  onScoreChange: ((score: number, multiplier: number) => void) | null = null;

  /** Callback fired on each kill (for floating score text). */
  onKill: ((event: ScoreEvent) => void) | null = null;

  setPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * Called when an enemy is killed. Awards score based on current multiplier.
   */
  awardKill(basePoints: number, enemyType: string): void {
    if (!this.player) return;

    const multipliedPoints = basePoints * this.player.multiplier;
    this.player.addScore(basePoints);

    const event: ScoreEvent = {
      basePoints,
      multipliedPoints,
      multiplier: this.player.multiplier,
      enemyType,
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > 10) {
      this.recentEvents.shift();
    }

    this.onKill?.(event);
    this.onScoreChange?.(this.player.score, this.player.multiplier);
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
}
