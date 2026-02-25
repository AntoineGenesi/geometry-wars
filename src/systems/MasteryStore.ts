import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';

// ── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'gw_weapon_mastery';

interface WeaponMasteryEntry {
  xp: number;
  gamesPlayed: number;
}

interface MasteryStoreData {
  version: 1;
  weapons: { [weaponType: string]: WeaponMasteryEntry };
}

// ── XP / Level thresholds ────────────────────────────────────────────────────

/** XP required to reach each level (index = level). Level 5 = 1000+ XP. */
export const XP_THRESHOLDS = [0, 100, 300, 500, 700, 1000] as const;

/**
 * XP awarded per kill (base, before diminishing returns).
 * Calibrated so ~20 games of regular use (150+ kills/game) reaches Level 5.
 * Was 10 before; reduced 20x to prevent single-game max-outs.
 */
export const XP_PER_KILL = 0.5;

/**
 * Per-game diminishing returns factor.
 * Formula: 1 / (1 + gamesPlayed * DIMINISHING_FACTOR).
 * Reduced from 0.15 to 0.05 to keep late-game progression meaningful
 * when XP_PER_KILL is properly calibrated.
 */
export const DIMINISHING_FACTOR = 0.05;

// ── Passive bonus table ───────────────────────────────────────────────────────

interface BonusConfig {
  dmgL1: number;
  dmgL5: number;
  rateL1: number;
  rateL5: number;
  special?: string;
}

const BONUS_TABLE: Record<WeaponType, BonusConfig> = {
  [WeaponType.Standard]:       { dmgL1: 1.10, dmgL5: 1.50, rateL1: 1.05, rateL5: 1.20, special: '+1 extra bullet' },
  [WeaponType.Spread]:         { dmgL1: 1.10, dmgL5: 1.50, rateL1: 1.05, rateL5: 1.15, special: '+2 extra pellets' },
  [WeaponType.Piercing]:       { dmgL1: 1.15, dmgL5: 1.60, rateL1: 1.05, rateL5: 1.20, special: '+50% beam length' },
  [WeaponType.ChainLightning]: { dmgL1: 1.10, dmgL5: 1.50, rateL1: 1.05, rateL5: 1.15, special: '+2 chain targets' },
  [WeaponType.Homing]:         { dmgL1: 1.10, dmgL5: 1.50, rateL1: 1.05, rateL5: 1.20, special: 'Tighter tracking' },
  [WeaponType.PlasmaMortar]:   { dmgL1: 1.15, dmgL5: 1.60, rateL1: 1.00, rateL5: 1.10, special: '+50% AoE radius' },
  [WeaponType.GravityGun]:     { dmgL1: 1.10, dmgL5: 1.50, rateL1: 1.00, rateL5: 1.10, special: '+50% pull radius' },
  [WeaponType.LaserBeam]:      { dmgL1: 1.20, dmgL5: 1.70, rateL1: 1.00, rateL5: 1.15, special: 'Continuous ramp' },
  [WeaponType.BlackHole]:      { dmgL1: 1.10, dmgL5: 1.50, rateL1: 1.00, rateL5: 1.10, special: '+duration +shots' },
  [WeaponType.TeslaCoil]:      { dmgL1: 1.15, dmgL5: 1.60, rateL1: 1.00, rateL5: 1.10, special: '+radius +DPS' },
};

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface PassiveMasteryBonus {
  damageMultiplier: number;
  fireRateMultiplier: number;
  specialBonus?: string;
}

export interface MasteryXPResult {
  weaponType: WeaponType;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
}

export interface MasteryLevelProgress {
  xp: number;
  level: number;
  nextThreshold: number | null;
  progressPct: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function xpToLevel(xp: number): number {
  let level = 0;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i;
    else break;
  }
  return level;
}

function computeBonus(type: WeaponType, level: number): PassiveMasteryBonus {
  if (level === 0) {
    return { damageMultiplier: 1.0, fireRateMultiplier: 1.0 };
  }
  const cfg = BONUS_TABLE[type];
  // t=0 at level 1, t=1 at level 5
  const t = (level - 1) / 4;
  const dmg = cfg.dmgL1 + t * (cfg.dmgL5 - cfg.dmgL1);
  const rate = cfg.rateL1 + t * (cfg.rateL5 - cfg.rateL1);
  return {
    damageMultiplier: dmg,
    fireRateMultiplier: rate,
    ...(level === 5 && cfg.special ? { specialBonus: cfg.special } : {}),
  };
}

function emptyData(): MasteryStoreData {
  return { version: 1, weapons: {} };
}

function loadFromStorage(): MasteryStoreData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as MasteryStoreData;
    if (parsed.version !== 1) return emptyData(); // unknown version → reset
    return parsed;
  } catch {
    return emptyData();
  }
}

function getEntry(data: MasteryStoreData, weapon: WeaponType): WeaponMasteryEntry {
  return data.weapons[weapon] ?? { xp: 0, gamesPlayed: 0 };
}

// ── MasteryStore ──────────────────────────────────────────────────────────────

export class MasteryStore {
  private data: MasteryStoreData;

  private constructor(data: MasteryStoreData) {
    this.data = data;
  }

  static load(): MasteryStore {
    return new MasteryStore(loadFromStorage());
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  getXP(weapon: WeaponType): number {
    return getEntry(this.data, weapon).xp;
  }

  getLevel(weapon: WeaponType): number {
    return xpToLevel(this.getXP(weapon));
  }

  getProgress(weapon: WeaponType): MasteryLevelProgress {
    const xp = this.getXP(weapon);
    const level = xpToLevel(xp);
    const currentThreshold = XP_THRESHOLDS[level];
    const nextThreshold = level < 5 ? XP_THRESHOLDS[level + 1] : null;
    const progressPct = nextThreshold === null
      ? 100
      : ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100;
    return { xp, level, nextThreshold, progressPct };
  }

  getAllProgress(): Map<WeaponType, MasteryLevelProgress> {
    const result = new Map<WeaponType, MasteryLevelProgress>();
    for (const type of Object.values(WeaponType)) {
      result.set(type, this.getProgress(type));
    }
    return result;
  }

  /** Returns current mastery level (0-5) for every weapon. */
  getAllLevels(): Map<WeaponType, number> {
    const result = new Map<WeaponType, number>();
    for (const type of Object.values(WeaponType)) {
      result.set(type, this.getLevel(type));
    }
    return result;
  }

  /**
   * Returns a human-readable description of the passive bonus unlocked at the given level.
   * e.g. "Blaster: +20% damage always" or "Plasma Mortar: +50% AoE radius" at level 5.
   * Returns empty string for level 0.
   */
  getBonusDescription(weapon: WeaponType, level: number): string {
    if (level === 0) return '';
    const cfg = BONUS_TABLE[weapon];
    const name = WEAPON_CONFIGS[weapon].name;
    if (level === 5 && cfg.special) {
      return `${name}: ${cfg.special}`;
    }
    const t = (level - 1) / 4;
    const dmgPct = Math.round((cfg.dmgL1 + t * (cfg.dmgL5 - cfg.dmgL1) - 1) * 100);
    return `${name}: +${dmgPct}% damage always`;
  }

  getPassiveMultipliers(): Map<WeaponType, PassiveMasteryBonus> {
    const result = new Map<WeaponType, PassiveMasteryBonus>();
    for (const type of Object.values(WeaponType)) {
      result.set(type, computeBonus(type, this.getLevel(type)));
    }
    return result;
  }

  // ── Award ──────────────────────────────────────────────────────────────────

  /**
   * Call at game end. Awards XP per weapon based on kill count.
   * Applies diminishing returns based on games already played.
   * Saves automatically.
   */
  awardGameXP(killsByWeapon: Map<WeaponType, number>): MasteryXPResult[] {
    const results: MasteryXPResult[] = [];

    for (const [weapon, kills] of killsByWeapon) {
      if (kills < 0) continue; // sanity check

      const entry = getEntry(this.data, weapon);
      const xpBefore = entry.xp;
      const levelBefore = xpToLevel(xpBefore);

      const diminishingFactor = 1 / (1 + entry.gamesPlayed * DIMINISHING_FACTOR);
      const gameXp = kills * XP_PER_KILL * diminishingFactor;
      const xpAfter = xpBefore + gameXp;
      const levelAfter = xpToLevel(xpAfter);

      this.data.weapons[weapon] = {
        xp: xpAfter,
        gamesPlayed: kills > 0 ? entry.gamesPlayed + 1 : entry.gamesPlayed,
      };

      results.push({
        weaponType: weapon,
        xpBefore,
        xpAfter,
        levelBefore,
        levelAfter,
        leveledUp: levelAfter > levelBefore,
      });
    }

    this.save();
    return results;
  }

  // ── Persist ────────────────────────────────────────────────────────────────

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // localStorage unavailable (tests, private mode, quota exceeded) — silent fail
    }
  }

  // ── Dev / Testing ──────────────────────────────────────────────────────────

  reset(): void {
    this.data = emptyData();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // silent
    }
  }

  /**
   * Dev-only: set XP for a weapon directly (skips game logic).
   * Use window.__setMasteryLevel() from browser console to call this.
   */
  devSetXP(weapon: WeaponType, xp: number): void {
    const entry = getEntry(this.data, weapon);
    this.data.weapons[weapon] = { xp: Math.max(0, xp), gamesPlayed: entry.gamesPlayed };
    this.save();
  }
}
