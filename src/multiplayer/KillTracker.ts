import type { BaseEnemy } from '../entities/enemies/BaseEnemy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerKillStats {
  kills: number;
  assists: number;
  /** Combined kills + assists (used for aura tier progression) */
  totalKillAssists: number;
}

export interface KillResult {
  /** Player who got the killing blow */
  killerId: number;
  /** Players who dealt >= ASSIST_THRESHOLD of max HP but didn't get the kill */
  assistIds: number[];
  /** Score awarded per assisting player */
  assistScore: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum fraction of enemy max HP dealt to qualify as an assist */
const ASSIST_DAMAGE_THRESHOLD = 0.20;

/** Fraction of enemy base score given as assist reward */
const ASSIST_SCORE_FRACTION = 0.40;

// ---------------------------------------------------------------------------
// KillTracker
// ---------------------------------------------------------------------------

export class KillTracker {
  private stats: Map<number, PlayerKillStats> = new Map();

  /**
   * Get or initialize stats for a player.
   */
  getPlayerStats(playerId: number): PlayerKillStats {
    let s = this.stats.get(playerId);
    if (!s) {
      s = { kills: 0, assists: 0, totalKillAssists: 0 };
      this.stats.set(playerId, s);
    }
    return s;
  }

  /**
   * Process an enemy death. Determines kill credit and assists.
   *
   * @param enemy - The enemy that died (must have damageBy map populated)
   * @param killerPlayerId - The player who dealt the killing blow (-1 if unknown)
   * @returns Kill result with killer, assisters, and assist score
   */
  processKill(enemy: BaseEnemy, killerPlayerId: number): KillResult {
    const assistIds: number[] = [];
    const assistThreshold = enemy.maxHealth * ASSIST_DAMAGE_THRESHOLD;
    const assistScore = Math.floor(enemy.scoreValue * ASSIST_SCORE_FRACTION);

    // Credit the killer
    if (killerPlayerId >= 0) {
      const killerStats = this.getPlayerStats(killerPlayerId);
      killerStats.kills++;
      killerStats.totalKillAssists++;
    }

    // Find assisters (dealt enough damage but aren't the killer)
    for (const [playerId, damage] of enemy.damageBy) {
      if (playerId === killerPlayerId) continue;
      if (damage >= assistThreshold) {
        assistIds.push(playerId);
        const assistStats = this.getPlayerStats(playerId);
        assistStats.assists++;
        assistStats.totalKillAssists++;
      }
    }

    return {
      killerId: killerPlayerId,
      assistIds,
      assistScore,
    };
  }

  /**
   * Reset all stats (e.g. on game restart).
   */
  reset(): void {
    this.stats.clear();
  }
}
