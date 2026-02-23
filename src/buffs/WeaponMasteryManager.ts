import { WeaponType } from '../weapons/WeaponTypes';

// ---------------------------------------------------------------------------
// Mastery thresholds (kills required per tier)
// ---------------------------------------------------------------------------

export const MASTERY_THRESHOLDS: readonly [number, number, number] = [10, 30, 75];

// ---------------------------------------------------------------------------
// WeaponMasteryManager
// ---------------------------------------------------------------------------

/**
 * Tracks per-weapon kill counts and emits tier-up events when mastery
 * thresholds are crossed.
 *
 * Tier 1 = 10 kills, Tier 2 = 30 kills, Tier 3 = 75 kills (per weapon).
 * This is a pure data class — no Three.js, no rendering.
 */
export class WeaponMasteryManager {
  /** Kill counts per weapon */
  private readonly kills: Map<WeaponType, number> = new Map();

  /**
   * Fired when a weapon crosses a mastery tier boundary.
   * Receives the weapon type and the new tier (1, 2, or 3).
   */
  onMasteryTierUp: ((weaponType: WeaponType, tier: number) => void) | null = null;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Record a kill with the specified weapon. Fires onMasteryTierUp if a
   * threshold boundary is crossed.
   */
  recordKill(weaponType: WeaponType): void {
    const prev = this.kills.get(weaponType) ?? 0;
    const prevTier = tierFromKills(prev);
    const newKills = prev + 1;
    this.kills.set(weaponType, newKills);
    const newTier = tierFromKills(newKills);
    if (newTier > prevTier) {
      this.onMasteryTierUp?.(weaponType, newTier);
    }
  }

  /** Returns total kill count for the given weapon. */
  getKills(weaponType: WeaponType): number {
    return this.kills.get(weaponType) ?? 0;
  }

  /** Returns mastery tier 0-3 for the given weapon. */
  getMasteryTier(weaponType: WeaponType): number {
    return tierFromKills(this.kills.get(weaponType) ?? 0);
  }

  /**
   * Returns progress info for HUD display.
   * nextThreshold is null when tier 3 is reached (max).
   */
  getProgress(weaponType: WeaponType): {
    kills: number;
    tier: number;
    nextThreshold: number | null;
  } {
    const kills = this.kills.get(weaponType) ?? 0;
    const tier = tierFromKills(kills);
    const nextThreshold = tier < 3 ? MASTERY_THRESHOLDS[tier] : null;
    return { kills, tier, nextThreshold };
  }

  /** Clear all kill counts (call on round reset). */
  reset(): void {
    this.kills.clear();
  }
}

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

function tierFromKills(kills: number): number {
  if (kills >= MASTERY_THRESHOLDS[2]) return 3;
  if (kills >= MASTERY_THRESHOLDS[1]) return 2;
  if (kills >= MASTERY_THRESHOLDS[0]) return 1;
  return 0;
}
