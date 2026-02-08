import * as THREE from 'three';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { getSoundEngine } from '../audio/SoundEngine';

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
    description: '+1.5 unit geom collection radius per stack',
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

  /** Volatile explosion callback - set by main.ts to spawn particles */
  onVolatileExplosion: ((position: THREE.Vector3, radius: number, damage: number) => void) | null = null;

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
   * Tough Times: hyperbolic block chance.
   * Formula: 1 - 1/(1 + 0.15 * stacks)
   * Returns probability 0-1 (never reaches 1).
   */
  getBlockChance(): number {
    const stacks = this.getStacks(StackBuffType.ToughTimes);
    if (stacks === 0) return 0;
    return 1 - 1 / (1 + 0.15 * stacks);
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
        this.burningEnemies.push({ enemy, dps, remaining: duration });
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

    // Visual/audio feedback
    this.onVolatileExplosion?.(enemy.position.clone(), explosionRadius, explosionDamage);
    getSoundEngine().play('bomb', { volume: 0.3, pitch: 1.5 + Math.random() * 0.3 });
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
   */
  update(dt: number, playerPos: THREE.Vector3, enemies: BaseEnemy[]): void {
    this.updateShockAura(dt, playerPos, enemies);
    this.updateBurning(dt);
    this.updateShockArcs(dt);
  }

  // -----------------------------------------------------------------------
  // Shock Aura logic
  // -----------------------------------------------------------------------

  private updateShockAura(dt: number, playerPos: THREE.Vector3, enemies: BaseEnemy[]): void {
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

      // Visual arc from player to enemy
      this.shockArcs.push({
        from: playerPos.clone(),
        to: enemy.position.clone(),
        age: 0,
        maxAge: 0.15,
      });

      // Chain chance: shock jumps to nearby enemies
      if (Math.random() < chainChance) {
        let chainCount = 0;
        const chainedSet = new Set<BaseEnemy>(inRange);

        for (const other of enemies) {
          if (chainCount >= maxChainTargets) break;
          if (chainedSet.has(other) || !other.alive) continue;

          const chainDist = other.position.distanceTo(enemy.position);
          if (chainDist < chainRange) {
            other.takeDamage(tickDamage * 0.5); // Chain does half damage
            chainCount++;
            chainedSet.add(other);

            // Visual arc from enemy to chained target
            this.shockArcs.push({
              from: enemy.position.clone(),
              to: other.position.clone(),
              age: 0,
              maxAge: 0.12,
            });
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Burning DOT logic
  // -----------------------------------------------------------------------

  private updateBurning(dt: number): void {
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
      burn.enemy.takeDamage(burn.dps * dt);

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

  private updateShockArcs(dt: number): void {
    for (let i = this.shockArcs.length - 1; i >= 0; i--) {
      this.shockArcs[i].age += dt;
      if (this.shockArcs[i].age >= this.shockArcs[i].maxAge) {
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
    // Roll for each rarity tier
    const allBuffs = Object.values(BUFF_DEFINITIONS);

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
