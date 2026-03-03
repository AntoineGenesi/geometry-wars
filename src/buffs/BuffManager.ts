import * as THREE from 'three';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { getSoundEngine } from '../audio/SoundEngine';
import { WeaponType } from '../weapons/WeaponTypes';
import type { ScorePopupManager } from '../effects/ScorePopup';

// Pre-allocated temp vectors for zero-allocation shock arc creation
const _arcFrom = new THREE.Vector3();
const _arcTo = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum StackBuffType {
  HotHands = 'hot_hands',
  TriggerHappy = 'trigger_happy',
  Afterburner = 'afterburner',
  Magnetism = 'magnetism',
  ToughTimes = 'tough_times',
  ShockAura = 'shock_aura',
  IncendiaryRounds = 'incendiary_rounds',
  Volatile = 'volatile',

  // Weapon mastery buffs — awarded by WeaponMasteryManager, NOT in drop pool
  MasteryBlaster = 'mastery_blaster',
  MasterySpread = 'mastery_spread',
  MasteryPiercing = 'mastery_piercing',
  MasteryChainLightning = 'mastery_chain_lightning',
  MasteryHoming = 'mastery_homing',
  MasteryPlasmaMortar = 'mastery_plasma_mortar',
  MasteryGravityGun = 'mastery_gravity_gun',
  MasteryLaserBeam = 'mastery_laser_beam',
  MasteryBlackHole = 'mastery_black_hole',
  MasteryTeslaCoil = 'mastery_tesla_coil',
}

export type BuffRarity = 'common' | 'uncommon';

export type BuffCategory = 'offensive' | 'defensive' | 'utility' | 'elemental';

export type StackingFormula = 'linear' | 'hyperbolic' | 'linear_capped';

export interface BuffDefinition {
  type: StackBuffType;
  name: string;
  shortName: string; // 3-char abbreviation for HUD
  description: string;
  rarity: BuffRarity;
  category: BuffCategory;
  maxStack: number; // 0 = uncapped
  iconColor: number;
  borderColor: number;
  stackingFormula: StackingFormula;
  /** Format: returns string description of current value at given stacks */
  formatValue: (stacks: number) => string;
}

/** Burning DOT state applied to an enemy */
export interface BurningState {
  enemy: BaseEnemy;
  dps: number;
  remaining: number;
  /** Accumulated damage since last popup (shown every BURN_TICK_INTERVAL seconds) */
  damageAccumulator: number;
  /** Timer for damage number throttle */
  tickTimer: number;
}

/** Shock arc visual (line from player to enemy or enemy to enemy) */
export interface ShockArc {
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  maxAge: number;
}

// ---------------------------------------------------------------------------
// Buff definitions (static data)
// ---------------------------------------------------------------------------

export const BUFF_DEFINITIONS: Record<StackBuffType, BuffDefinition> = {
  [StackBuffType.HotHands]: {
    type: StackBuffType.HotHands,
    name: 'Hot Hands',
    shortName: 'HOT',
    description: '+15% bullet damage per stack',
    rarity: 'common',
    category: 'offensive',
    maxStack: 0,
    iconColor: 0xff4400,
    borderColor: 0xffffff,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 15}% damage`,
  },
  [StackBuffType.TriggerHappy]: {
    type: StackBuffType.TriggerHappy,
    name: 'Trigger Happy',
    shortName: 'TRG',
    description: '+12% fire rate per stack',
    rarity: 'common',
    category: 'offensive',
    maxStack: 0,
    iconColor: 0xff8800,
    borderColor: 0xffffff,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 12}% fire rate`,
  },
  [StackBuffType.Afterburner]: {
    type: StackBuffType.Afterburner,
    name: 'Afterburner',
    shortName: 'AFT',
    description: '+10% move speed per stack (max +80%)',
    rarity: 'common',
    category: 'utility',
    maxStack: 0,
    iconColor: 0x44ff44,
    borderColor: 0xffffff,
    stackingFormula: 'linear_capped',
    formatValue: (s) => `+${Math.min(s * 10, 80)}% speed`,
  },
  [StackBuffType.Magnetism]: {
    type: StackBuffType.Magnetism,
    name: 'Magnetism',
    shortName: 'MAG',
    description: 'Increases geom attraction + collection radius per stack',
    rarity: 'common',
    category: 'utility',
    maxStack: 0,
    iconColor: 0xffff00,
    borderColor: 0xffffff,
    stackingFormula: 'linear',
    formatValue: (s) => `+${(s * 1.5).toFixed(1)} range`,
  },
  [StackBuffType.ToughTimes]: {
    type: StackBuffType.ToughTimes,
    name: 'Tough Times',
    shortName: 'TGH',
    description: '12% damage block chance (hyperbolic)',
    rarity: 'common',
    category: 'defensive',
    maxStack: 0,
    iconColor: 0x4488ff,
    borderColor: 0xffffff,
    stackingFormula: 'hyperbolic',
    formatValue: (s) => {
      const chance = 1 - 1 / (1 + 0.15 * s);
      return `${(chance * 100).toFixed(0)}% block`;
    },
  },
  [StackBuffType.ShockAura]: {
    type: StackBuffType.ShockAura,
    name: 'Shock Aura',
    shortName: 'SHK',
    description: 'Passive shock damage to nearby enemies',
    rarity: 'uncommon',
    category: 'elemental',
    maxStack: 0,
    iconColor: 0xaa44ff,
    borderColor: 0x44ff44,
    stackingFormula: 'linear',
    formatValue: (s) => {
      const dps = 0.5 + (s - 1) * 0.3;
      const chainChance = Math.min(30 + (s - 1) * 8, 100);
      return `${dps.toFixed(1)} DPS, ${chainChance}% chain`;
    },
  },
  [StackBuffType.IncendiaryRounds]: {
    type: StackBuffType.IncendiaryRounds,
    name: 'Incendiary Rounds',
    shortName: 'INC',
    description: '15% chance to ignite enemies on hit',
    rarity: 'common',
    category: 'elemental',
    maxStack: 0,
    iconColor: 0xff6600,
    borderColor: 0xffffff,
    stackingFormula: 'linear',
    formatValue: (s) => {
      const chance = 15 + (s - 1) * 5;
      const dps = 1 + (s - 1) * 0.5;
      return `${chance}% ignite, ${dps.toFixed(1)} DPS`;
    },
  },
  [StackBuffType.Volatile]: {
    type: StackBuffType.Volatile,
    name: 'Volatile',
    shortName: 'VLT',
    description: 'Enemies explode on death',
    rarity: 'uncommon',
    category: 'elemental',
    maxStack: 10,
    iconColor: 0xff2244,
    borderColor: 0x44ff44,
    stackingFormula: 'linear',
    formatValue: (s) => {
      const dmgPct = 50 + (s - 1) * 15;
      const radius = 1.5 + (s - 1) * 0.3;
      return `${dmgPct}% HP, ${radius.toFixed(1)}u radius`;
    },
  },

  // -------------------------------------------------------------------------
  // Weapon mastery buffs — NOT in drop pool (awarded by WeaponMasteryManager)
  // -------------------------------------------------------------------------

  [StackBuffType.MasteryBlaster]: {
    type: StackBuffType.MasteryBlaster,
    name: 'Blaster Mastery',
    shortName: 'M:B',
    description: '+40% blaster damage per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0xffff44,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 40}% blaster damage — MASTERED`,
  },

  [StackBuffType.MasterySpread]: {
    type: StackBuffType.MasterySpread,
    name: 'Spread Mastery',
    shortName: 'M:S',
    description: '+2 extra pellets per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0x44ffff,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 2} pellets — ${5 + s * 2} total — MASTERED`,
  },

  [StackBuffType.MasteryPiercing]: {
    type: StackBuffType.MasteryPiercing,
    name: 'Piercing Mastery',
    shortName: 'M:P',
    description: '+50% beam length per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0xffffff,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 50}% beam length — MASTERED`,
  },

  [StackBuffType.MasteryChainLightning]: {
    type: StackBuffType.MasteryChainLightning,
    name: 'Chain Mastery',
    shortName: 'M:C',
    description: '+2 chain targets per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0xaaffff,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 2} chain targets — ${6 + s * 2} total — MASTERED`,
  },

  [StackBuffType.MasteryHoming]: {
    type: StackBuffType.MasteryHoming,
    name: 'Homing Mastery',
    shortName: 'M:H',
    description: '+40% missile damage + tighter tracking per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0xff4444,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 40}% dmg, +${(s * 30).toFixed(0)}% tracking — MASTERED`,
  },

  [StackBuffType.MasteryPlasmaMortar]: {
    type: StackBuffType.MasteryPlasmaMortar,
    name: 'Mortar Mastery',
    shortName: 'M:M',
    description: '+50% AoE blast radius per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0x44ff44,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 50}% AoE radius — MASTERED`,
  },

  [StackBuffType.MasteryGravityGun]: {
    type: StackBuffType.MasteryGravityGun,
    name: 'Gravity Mastery',
    shortName: 'M:G',
    description: '+50% pull radius + instant cluster-kill in center per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0x8844ff,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 50}% pull radius, center kill — MASTERED`,
  },

  [StackBuffType.MasteryLaserBeam]: {
    type: StackBuffType.MasteryLaserBeam,
    name: 'Laser Mastery',
    shortName: 'M:L',
    description: '+60% laser DPS per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0xff0000,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 60}% laser DPS — MASTERED`,
  },

  [StackBuffType.MasteryBlackHole]: {
    type: StackBuffType.MasteryBlackHole,
    name: 'Black Hole Mastery',
    shortName: 'M:K',
    description: '+50% black hole duration + 1 extra shot per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0x6600cc,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 50}% duration, +${s} shots — MASTERED`,
  },

  [StackBuffType.MasteryTeslaCoil]: {
    type: StackBuffType.MasteryTeslaCoil,
    name: 'Tesla Mastery',
    shortName: 'M:T',
    description: '+50% tesla radius + +50% DPS per stack',
    rarity: 'uncommon',
    category: 'offensive',
    maxStack: 3,
    iconColor: 0x88aaff,
    borderColor: 0xffaa00,
    stackingFormula: 'linear',
    formatValue: (s) => `+${s * 50}% radius & DPS — MASTERED`,
  },
};

// ---------------------------------------------------------------------------
// WeaponType → mastery buff mapping (used by getMasteryMultiplier)
// ---------------------------------------------------------------------------

const WEAPON_TYPE_TO_MASTERY_BUFF: Partial<Record<WeaponType, StackBuffType>> = {
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
// Drop rate table
// ---------------------------------------------------------------------------

const DROP_RATES: Record<BuffRarity, number> = {
  common: 0.08,    // 8% per enemy kill
  uncommon: 0.03,  // 3% per enemy kill
};

// ---------------------------------------------------------------------------
// BuffManager
// ---------------------------------------------------------------------------

export class BuffManager {
  /** Current stack counts for each buff */
  private stacks: Map<StackBuffType, number> = new Map();

  /** Burning enemies (DOT from Incendiary Rounds) */
  private burningEnemies: BurningState[] = [];

  /** Shock aura tick timer */
  private shockAuraTimer = 0;
  private readonly SHOCK_AURA_TICK_INTERVAL = 0.5; // damage every 0.5s

  /** Visual shock arcs for rendering */
  readonly shockArcs: ShockArc[] = [];

  /** Pool of recycled ShockArc objects to avoid per-tick Vector3 allocations.
   *  At 3+ shock stacks with chains, the old code allocated 8-16 Vector3s per tick (every 0.5s). */
  private readonly _shockArcPool: ShockArc[] = [];

  /** Volatile explosion callback - set by main.ts to spawn particles */
  onVolatileExplosion: ((position: THREE.Vector3, radius: number, damage: number) => void) | null = null;

  /** Guard against recursive volatile chain-explosions saturating the frame */
  private _volatileChainDepth = 0;
  private static readonly MAX_VOLATILE_CHAIN_DEPTH = 2;

  /** Per-frame cap on volatile VFX explosions. Reset each frame by update().
   *  Even at chain depth 1, a mortar killing 20 enemies with volatile can trigger
   *  20 bombExplosion() calls in one frame. Capping VFX at 6 per frame keeps
   *  the damage working but prevents particle budget from being blown in a single tick. */
  private _volatileVfxThisFrame = 0;
  private static readonly MAX_VOLATILE_VFX_PER_FRAME = 6;

  /** Callback when buff is gained (for HUD animation) */
  onBuffGained: ((type: StackBuffType, newStacks: number) => void) | null = null;

  // -----------------------------------------------------------------------
  // Stack management
  // -----------------------------------------------------------------------

  /**
   * Add one stack of a buff. Respects max stack limits.
   */
  addBuff(type: StackBuffType): void {
    const def = BUFF_DEFINITIONS[type];
    const current = this.stacks.get(type) ?? 0;

    // Check max stack (0 = uncapped)
    if (def.maxStack > 0 && current >= def.maxStack) return;

    const newStacks = current + 1;
    this.stacks.set(type, newStacks);
    this.onBuffGained?.(type, newStacks);

    // Sound feedback - pitch scales with rarity
    const pitch = def.rarity === 'uncommon' ? 1.4 : 1.2;
    getSoundEngine().play('weaponPickup', { volume: 0.4, pitch });
  }

  /**
   * Get current stacks for a buff type.
   */
  getStacks(type: StackBuffType): number {
    return this.stacks.get(type) ?? 0;
  }

  /**
   * Get all active buffs with their stack counts (for HUD).
   */
  getActiveBuffs(): Array<{ type: StackBuffType; stacks: number; def: BuffDefinition }> {
    const result: Array<{ type: StackBuffType; stacks: number; def: BuffDefinition }> = [];
    for (const [type, stacks] of this.stacks.entries()) {
      if (stacks > 0) {
        result.push({ type, stacks, def: BUFF_DEFINITIONS[type] });
      }
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Computed multipliers (queried by game systems)
  // -----------------------------------------------------------------------

  /**
   * Hot Hands: +15% damage per stack (linear, additive).
   * Returns multiplier: 1.0 + stacks * 0.15
   */
  getDamageMultiplier(): number {
    const stacks = this.getStacks(StackBuffType.HotHands);
    if (stacks === 0) return 1.0;
    return 1.0 + stacks * 0.15;
  }

  /**
   * Trigger Happy: +12% fire rate per stack (linear).
   * Returns multiplier: 1.0 + stacks * 0.12
   */
  getFireRateMultiplier(): number {
    const stacks = this.getStacks(StackBuffType.TriggerHappy);
    if (stacks === 0) return 1.0;
    return 1.0 + stacks * 0.12;
  }

  /**
   * Afterburner: +10% move speed per stack (linear, capped at +80%).
   * Returns multiplier: 1.0 + min(stacks * 0.10, 0.80)
   */
  getMoveSpeedMultiplier(): number {
    const stacks = this.getStacks(StackBuffType.Afterburner);
    if (stacks === 0) return 1.0;
    return 1.0 + Math.min(stacks * 0.10, 0.80);
  }

  /**
   * Magnetism: +1.5 unit geom collection radius per stack.
   * Returns bonus radius (added to base).
   */
  getCollectionRadiusBonus(): number {
    const stacks = this.getStacks(StackBuffType.Magnetism);
    if (stacks === 0) return 0;
    // First stack = +1.5, each additional = +1.0 (as per design doc)
    return 1.5 + (stacks - 1) * 1.0;
  }

  /**
   * Compute a normalized total buff power score for DDA difficulty scaling.
   * Returns 0 for no buffs, ~1.0 for a moderately buffed player,
   * and up to ~8+ for a heavily stacked player.
   *
   * Weights reflect each buff's offensive DPS contribution:
   *   - Offensive (hot hands, trigger happy): high weight
   *   - Elemental AoE (shock aura, volatile): highest weight
   *   - DoT (incendiary): high weight
   *   - Utility/defensive (afterburner, magnetism, tough times): low weight
   */
  getTotalBuffPower(): number {
    const masteryPower =
      this.getStacks(StackBuffType.MasteryBlaster) * 0.30 +
      this.getStacks(StackBuffType.MasterySpread) * 0.30 +
      this.getStacks(StackBuffType.MasteryPiercing) * 0.30 +
      this.getStacks(StackBuffType.MasteryChainLightning) * 0.30 +
      this.getStacks(StackBuffType.MasteryHoming) * 0.30 +
      this.getStacks(StackBuffType.MasteryPlasmaMortar) * 0.30 +
      this.getStacks(StackBuffType.MasteryGravityGun) * 0.30 +
      this.getStacks(StackBuffType.MasteryLaserBeam) * 0.30 +
      this.getStacks(StackBuffType.MasteryBlackHole) * 0.30 +
      this.getStacks(StackBuffType.MasteryTeslaCoil) * 0.30;

    return (
      this.getStacks(StackBuffType.HotHands) * 0.30 +
      this.getStacks(StackBuffType.TriggerHappy) * 0.25 +
      this.getStacks(StackBuffType.ShockAura) * 0.40 +
      this.getStacks(StackBuffType.IncendiaryRounds) * 0.30 +
      this.getStacks(StackBuffType.Volatile) * 0.50 +
      this.getStacks(StackBuffType.Afterburner) * 0.10 +
      this.getStacks(StackBuffType.Magnetism) * 0.10 +
      this.getStacks(StackBuffType.ToughTimes) * 0.15 +
      masteryPower
    );
  }

  /**
   * Tough Times: hyperbolic block chance.
   * Formula: 1 - 1/(1 + 0.15 * stacks)
   * Returns probability 0-1 (never reaches 1).
   */
  getBlockChance(): number {
    const stacks = this.getStacks(StackBuffType.ToughTimes);
    if (stacks === 0) return 0;
    return 1 - 1 / (1 + 0.15 * stacks);
  }

  /**
   * Returns the mastery damage multiplier and weapon-specific special bonuses
   * for the given weapon type, based on accumulated mastery buff stacks.
   *
   * damageMultiplier: multiply base damage by this value.
   * specialBonus: per-weapon bonus data (pellets, radius, chain targets, etc.)
   *   consumed by WeaponManager in Phase 3 integration.
   */
  getMasteryMultiplier(weaponType: WeaponType): {
    damageMultiplier: number;
    specialBonus: Record<string, number>;
  } {
    const buffType = WEAPON_TYPE_TO_MASTERY_BUFF[weaponType];
    if (!buffType) return { damageMultiplier: 1.0, specialBonus: {} };

    const s = this.getStacks(buffType);
    if (s === 0) return { damageMultiplier: 1.0, specialBonus: {} };

    switch (weaponType) {
      case WeaponType.Standard:
        return { damageMultiplier: 1 + s * 0.4, specialBonus: {} };

      case WeaponType.Spread:
        return { damageMultiplier: 1.0, specialBonus: { extraPellets: s * 2 } };

      case WeaponType.Piercing:
        return { damageMultiplier: 1.0, specialBonus: { beamLengthMultiplier: 1 + s * 0.5 } };

      case WeaponType.ChainLightning:
        return { damageMultiplier: 1.0, specialBonus: { extraChainTargets: s * 2 } };

      case WeaponType.Homing:
        return { damageMultiplier: 1 + s * 0.4, specialBonus: { trackingBonus: s * 0.3 } };

      case WeaponType.PlasmaMortar:
        return { damageMultiplier: 1.0, specialBonus: { aoeRadiusMultiplier: 1 + s * 0.5 } };

      case WeaponType.GravityGun:
        return { damageMultiplier: 1.0, specialBonus: { pullRadiusMultiplier: 1 + s * 0.5 } };

      case WeaponType.LaserBeam:
        return { damageMultiplier: 1 + s * 0.6, specialBonus: {} };

      case WeaponType.BlackHole:
        return { damageMultiplier: 1.0, specialBonus: { durationMultiplier: 1 + s * 0.5, extraShots: s } };

      case WeaponType.TeslaCoil:
        return { damageMultiplier: 1 + s * 0.5, specialBonus: { radiusMultiplier: 1 + s * 0.5 } };

      default:
        return { damageMultiplier: 1.0, specialBonus: {} };
    }
  }

  // -----------------------------------------------------------------------
  // On-hit proc: Incendiary Rounds
  // -----------------------------------------------------------------------

  /**
   * Called when a bullet hits an enemy. May ignite the enemy.
   * procCoefficient: 1.0 for player bullets, 0.3 for proc-generated damage.
   */
  onBulletHit(enemy: BaseEnemy, procCoefficient = 1.0): void {
    const stacks = this.getStacks(StackBuffType.IncendiaryRounds);
    if (stacks === 0) return;
    if (!enemy.alive) return;

    const igniteChance = (15 + (stacks - 1) * 5) / 100;
    const effectiveChance = igniteChance * procCoefficient;

    if (Math.random() < effectiveChance) {
      const dps = 1 + (stacks - 1) * 0.5;
      const duration = 3 + (stacks - 1) * 0.5;

      // Check if already burning - refresh duration and use higher DPS
      const existing = this.burningEnemies.find(b => b.enemy === enemy);
      if (existing) {
        existing.dps = Math.max(existing.dps, dps);
        existing.remaining = Math.max(existing.remaining, duration);
      } else {
        this.burningEnemies.push({ enemy, dps, remaining: duration, damageAccumulator: 0, tickTimer: 0 });
      }

      // Visual feedback: tint the enemy orange briefly
      if (enemy.cachedMaterials) {
        for (const mat of enemy.cachedMaterials) {
          mat.emissive.setHex(0xff6600);
          mat.emissiveIntensity = 0.8;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // On-death proc: Volatile
  // -----------------------------------------------------------------------

  /**
   * Called when an enemy dies. May cause an explosion.
   * @param enemy - The enemy that just died
   * @param enemies - All active enemies (for explosion splash)
   */
  onEnemyDeath(enemy: BaseEnemy, enemies: BaseEnemy[]): void {
    const stacks = this.getStacks(StackBuffType.Volatile);
    if (stacks === 0) return;

    // Prevent infinite chain-explosion cascades from saturating the frame.
    // After MAX_VOLATILE_CHAIN_DEPTH recursive detonations, damage still
    // applies but VFX are suppressed — keeps gameplay intact, saves FPS.
    if (this._volatileChainDepth >= BuffManager.MAX_VOLATILE_CHAIN_DEPTH) return;

    this._volatileChainDepth++;

    const dmgPercent = (50 + (stacks - 1) * 15) / 100;
    const explosionRadius = 1.5 + (stacks - 1) * 0.3;
    const explosionDamage = enemy.maxHealth * dmgPercent;

    // Damage nearby enemies
    for (const other of enemies) {
      if (other === enemy || !other.alive) continue;
      const dist = other.position.distanceTo(enemy.position);
      if (dist < explosionRadius) {
        const falloff = 1 - dist / explosionRadius;
        other.takeDamage(explosionDamage * falloff);
      }
    }

    // Visual/audio feedback — capped per frame to prevent particle budget blow-out.
    // Damage above always applies; only VFX are throttled.
    if (this._volatileVfxThisFrame < BuffManager.MAX_VOLATILE_VFX_PER_FRAME) {
      this._volatileVfxThisFrame++;
      this.onVolatileExplosion?.(enemy.position, explosionRadius, explosionDamage);
      getSoundEngine().play('bomb', { volume: 0.3, pitch: 1.5 + Math.random() * 0.3 });
    }

    this._volatileChainDepth--;
  }

  // -----------------------------------------------------------------------
  // Player-hit check: Tough Times block
  // -----------------------------------------------------------------------

  /**
   * Called when the player is about to take damage.
   * Returns true if the damage was blocked (Tough Times proc).
   */
  onPlayerHit(): boolean {
    const blockChance = this.getBlockChance();
    if (blockChance <= 0) return false;

    if (Math.random() < blockChance) {
      getSoundEngine().play('shieldHit', { volume: 0.5, pitch: 1.3 });
      return true; // Blocked!
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Per-frame update: Shock Aura + Burning DOT
  // -----------------------------------------------------------------------

  /**
   * Tick all proc effects. Call once per fixed update.
   * @param dt - Fixed timestep delta
   * @param playerPos - Player world position
   * @param enemies - All active enemies
   * @param scorePopups - Optional popup manager; when provided, damage numbers appear for ShockAura hits
   * @returns Array of enemies that died from aura/burn damage this frame
   */
  update(dt: number, playerPos: THREE.Vector3, enemies: BaseEnemy[], scorePopups?: ScorePopupManager): BaseEnemy[] {
    // Reset per-frame volatile VFX budget so onEnemyDeath() can track this frame's count
    this._volatileVfxThisFrame = 0;

    // Track enemies alive before update
    const killedThisFrame: BaseEnemy[] = [];
    const aliveBeforeUpdate = new Set<BaseEnemy>();
    for (const enemy of enemies) {
      if (enemy.alive) {
        aliveBeforeUpdate.add(enemy);
      }
    }

    this.updateShockAura(dt, playerPos, enemies, scorePopups);
    this.updateBurning(dt, scorePopups);
    this.updateShockArcs(dt);

    // Detect enemies that died from aura/burn this frame
    for (const enemy of aliveBeforeUpdate) {
      if (!enemy.alive) {
        killedThisFrame.push(enemy);
      }
    }

    return killedThisFrame;
  }

  // -----------------------------------------------------------------------
  // Shock Aura logic
  // -----------------------------------------------------------------------

  private updateShockAura(dt: number, playerPos: THREE.Vector3, enemies: BaseEnemy[], scorePopups?: ScorePopupManager): void {
    const stacks = this.getStacks(StackBuffType.ShockAura);
    if (stacks === 0) return;

    this.shockAuraTimer += dt;
    if (this.shockAuraTimer < this.SHOCK_AURA_TICK_INTERVAL) return;
    this.shockAuraTimer -= this.SHOCK_AURA_TICK_INTERVAL;

    const auraRadius = 2.0;
    const dps = 0.5 + (stacks - 1) * 0.3;
    const tickDamage = dps * this.SHOCK_AURA_TICK_INTERVAL;
    const chainChance = Math.min((30 + (stacks - 1) * 8) / 100, 1.0);
    const maxChainTargets = 1 + (stacks - 1);
    const chainRange = 3.0;

    // Find enemies in aura range
    const inRange: BaseEnemy[] = [];
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dist = enemy.position.distanceTo(playerPos);
      if (dist < auraRadius) {
        inRange.push(enemy);
      }
    }

    // Damage enemies in range + create shock arcs
    for (const enemy of inRange) {
      enemy.takeDamage(tickDamage);

      // Show damage number popup for aura hit (only if enemy survived — killed enemies show score popup)
      if (scorePopups && enemy.alive) {
        scorePopups.spawnDamage(enemy.position, tickDamage);
      }

      // Visual arc from player to enemy (uses pool to avoid per-tick Vector3 allocations)
      this.shockArcs.push(this._allocShockArc(playerPos, enemy.position, 0.15));

      // Chain chance: shock jumps to nearby enemies
      if (Math.random() < chainChance) {
        let chainCount = 0;
        // Avoid allocating a Set every tick: use a simple scan + skip inRange by distance check
        for (const other of enemies) {
          if (chainCount >= maxChainTargets) break;
          if (!other.alive) continue;
          // Skip if already in aura range (was already damaged above)
          const otherDistToPlayer = other.position.distanceTo(playerPos);
          if (otherDistToPlayer < auraRadius) continue;

          const chainDist = other.position.distanceTo(enemy.position);
          if (chainDist < chainRange) {
            other.takeDamage(tickDamage * 0.5); // Chain does half damage

            // Show damage number for chain hit too
            if (scorePopups && other.alive) {
              scorePopups.spawnDamage(other.position, tickDamage * 0.5);
            }

            chainCount++;

            // Visual arc from enemy to chained target (pooled)
            this.shockArcs.push(this._allocShockArc(enemy.position, other.position, 0.12));
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Burning DOT logic
  // -----------------------------------------------------------------------

  private readonly BURN_TICK_INTERVAL = 0.5; // show damage number every 0.5s

  private updateBurning(dt: number, scorePopups?: ScorePopupManager): void {
    for (let i = this.burningEnemies.length - 1; i >= 0; i--) {
      const burn = this.burningEnemies[i];

      if (!burn.enemy.alive) {
        this.burningEnemies.splice(i, 1);
        continue;
      }

      burn.remaining -= dt;
      if (burn.remaining <= 0) {
        // Reset emissive color when burn expires
        if (burn.enemy.cachedMaterials) {
          for (const mat of burn.enemy.cachedMaterials) {
            mat.emissiveIntensity = 0.4;
          }
        }
        this.burningEnemies.splice(i, 1);
        continue;
      }

      // Apply DOT damage
      const tickDamage = burn.dps * dt;
      burn.enemy.takeDamage(tickDamage);

      // Accumulate damage for throttled popup (avoid per-frame spam)
      burn.damageAccumulator += tickDamage;
      burn.tickTimer += dt;
      if (scorePopups && burn.tickTimer >= this.BURN_TICK_INTERVAL && burn.enemy.alive) {
        scorePopups.spawnDamage(burn.enemy.position, burn.damageAccumulator, '#ff7700');
        burn.damageAccumulator = 0;
        burn.tickTimer -= this.BURN_TICK_INTERVAL;
      }

      // Flicker emissive for burning visual
      if (burn.enemy.cachedMaterials) {
        const flicker = 0.5 + Math.sin(burn.remaining * 15) * 0.3;
        for (const mat of burn.enemy.cachedMaterials) {
          mat.emissive.setHex(0xff6600);
          mat.emissiveIntensity = flicker;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Shock arc visuals
  // -----------------------------------------------------------------------

  /** Recycle or create a ShockArc object (zero allocation when pool has entries). */
  private _allocShockArc(from: THREE.Vector3, to: THREE.Vector3, maxAge: number): ShockArc {
    const recycled = this._shockArcPool.pop();
    if (recycled) {
      recycled.from.copy(from);
      recycled.to.copy(to);
      recycled.age = 0;
      recycled.maxAge = maxAge;
      return recycled;
    }
    return { from: from.clone(), to: to.clone(), age: 0, maxAge };
  }

  private updateShockArcs(dt: number): void {
    for (let i = this.shockArcs.length - 1; i >= 0; i--) {
      this.shockArcs[i].age += dt;
      if (this.shockArcs[i].age >= this.shockArcs[i].maxAge) {
        // Recycle into pool instead of letting GC collect it
        this._shockArcPool.push(this.shockArcs[i]);
        this.shockArcs.splice(i, 1);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Buff drop logic
  // -----------------------------------------------------------------------

  /**
   * Roll for a buff drop when an enemy is killed.
   * Returns the StackBuffType to drop, or null if no drop.
   */
  static rollBuffDrop(): StackBuffType | null {
    // Roll for each rarity tier — mastery buffs are excluded (awarded by WeaponMasteryManager only)
    const allBuffs = Object.values(BUFF_DEFINITIONS)
      .filter(b => !b.type.startsWith('mastery_'));

    // Uncommon check first (lower chance, better buffs)
    const uncommonBuffs = allBuffs.filter(b => b.rarity === 'uncommon');
    if (Math.random() < DROP_RATES.uncommon && uncommonBuffs.length > 0) {
      return uncommonBuffs[Math.floor(Math.random() * uncommonBuffs.length)].type;
    }

    // Common check
    const commonBuffs = allBuffs.filter(b => b.rarity === 'common');
    if (Math.random() < DROP_RATES.common && commonBuffs.length > 0) {
      return commonBuffs[Math.floor(Math.random() * commonBuffs.length)].type;
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset(): void {
    this.stacks.clear();
    this.burningEnemies = [];
    this.shockAuraTimer = 0;
    this.shockArcs.length = 0;
  }

  dispose(): void {
    this.reset();
  }
}
