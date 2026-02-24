import { WeaponType } from '../weapons/WeaponTypes';
import { StackBuffType } from './BuffManager';

// ---------------------------------------------------------------------------
// Mastery thresholds (kills required per tier)
// ---------------------------------------------------------------------------

export const MASTERY_THRESHOLDS: readonly [number, number, number] = [10, 30, 75];

// ---------------------------------------------------------------------------
// WeaponType → mastery StackBuffType mapping
// Used by main.ts to know which buff to award on tier-up.
// ---------------------------------------------------------------------------

export const WEAPON_MASTERY_BUFF_MAP: Partial<Record<WeaponType, StackBuffType>> = {
  [WeaponType.Standard]: StackBuffType.MasteryBlaster,
  [WeaponType.Spread]: StackBuffType.MasterySpread,
  [WeaponType.Piercing]: StackBuffType.MasteryPiercing,
  [WeaponType.ChainLightning]: StackBuffType.MasteryChainLightning,
  [WeaponType.Homing]: StackBuffType.MasteryHoming,
  [WeaponType.PlasmaMortar]: StackBuffType.MasteryPlasmaMortar,
  [WeaponType.GravityGun]: StackBuffType.MasteryGravityGun,
  [WeaponType.LaserBeam]: StackBuffType.MasteryLaserBeam,
  [WeaponType.BlackHole]: StackBuffType.MasteryBlackHole,
  [WeaponType.TeslaCoil]: StackBuffType.MasteryTeslaCoil,
};

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

  /**
   * Returns progress info for all weapons that have at least 1 kill.
   * Suitable for passing directly to WeaponHUD.update().
   */
  getAllProgress(): Map<WeaponType, { kills: number; tier: number; nextThreshold: number | null }> {
    const result: Map<WeaponType, { kills: number; tier: number; nextThreshold: number | null }> = new Map();
    for (const [weaponType, killCount] of this.kills.entries()) {
      if (killCount > 0) {
        result.set(weaponType, this.getProgress(weaponType));
      }
    }
    return result;
  }

  /**
   * Returns a copy of the kills map for all weapons that have at least 1 kill.
   * Used by the post-game mastery progress flow to award XP.
   */
  getKillsByWeapon(): Map<WeaponType, number> {
    const result = new Map<WeaponType, number>();
    for (const [weapon, count] of this.kills.entries()) {
      if (count > 0) result.set(weapon, count);
    }
    return result;
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
