import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS, getWeaponColor } from './WeaponTypes';
import { ChainLightningEffect } from '../effects/ChainLightning';
import { MeshSurface } from '../surfaces/MeshSurface';
import { BuffType, BUFF_CONFIGS, ActiveBuff } from './BuffPickup';
import { SharedGeometries } from '../rendering/GeometryCache';
import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';
import type { WeaponPowerInput } from '../shared/PlayerPowerModel';
import {
  createBlackHoleConfig,
  getBlackHoleDamageTickCount,
  getBlackHolePullSpeed,
  getBlackHoleState,
  type BlackHoleConfig,
  type BlackHolePhase,
} from '../shared/BlackHoleModel';
import { getSpreadUpgradePattern } from '../shared/WeaponUpgradeEffects';
import { BlackHoleVisual } from '../effects/BlackHoleVisual';

// ---------------------------------------------------------------------------
// Gas Cloud (Homing branch B node 3)
// ---------------------------------------------------------------------------

interface GasCloudInstance {
  position: THREE.Vector3;
  elapsed: number;
  duration: number;
  tickTimer: number;
  mesh: THREE.Mesh;
}

const GAS_CLOUD_RADIUS = 2.0;
const GAS_CLOUD_DAMAGE = 3.0;   // per tick
const GAS_CLOUD_DURATION = 5.0; // seconds
const GAS_CLOUD_TICK = 0.5;     // seconds between damage ticks
const BLACK_HOLE_BOLT_MAX_AGE = 1.2;
const BLACK_HOLE_BOLT_PULL_RADIUS_FACTOR = 0.35;
const BLACK_HOLE_BOLT_MIN_PULL_RADIUS = 1.25;
const BLACK_HOLE_BOLT_MAX_PULL_RADIUS = 2.75;
const BLACK_HOLE_BOLT_PULL_SPEED_FACTOR = 0.7;
const BLACK_HOLE_BOLT_HIT_RADIUS = 0.35;

// Pre-allocated constant for projectile mesh orientation.
// Homing cone geometry apex is baked at local +Z (after geo.rotateX(π/2)).
// We rotate the mesh each frame so its +Z aligns with the projectile's travel direction.
const _PROJ_CONE_FWD = new THREE.Vector3(0, 0, 1);
// Fallback up axis for degenerate cases (anti-parallel direction)
const _PROJ_CONE_UP = new THREE.Vector3(0, 1, 0);

/**
 * Projectile data for non-instant weapons
 */
export interface Projectile {
  type: WeaponType;
  position: THREE.Vector3;
  previousPosition?: THREE.Vector3;
  direction: THREE.Vector3;
  age: number;
  maxAge: number;
  damage: number;
  speed: number;
  // For homing
  targetIndex?: number;
  /**
   * Homing bias for Seeking blaster bolts (Standard BL sub-branch).
   * 0 = straight, 1 = tight homing. Applied in updateProjectile for Standard type.
   */
  homingBias?: number;
  /**
   * True for Apex hunter (bl_10): bolt reverses toward nearest enemy on first expiry
   * instead of disappearing, then expires normally on the return pass.
   */
  loopBackOnMiss?: boolean;
  /** Set when the bolt has already looped back — prevents infinite looping */
  hasLoopedBack?: boolean;
  // For mortar
  startPos?: THREE.Vector3;
  endPos?: THREE.Vector3;
  // For spread shot animation: direction lerps from start to end over spreadDuration seconds
  spreadStartDir?: THREE.Vector3;
  spreadEndDir?: THREE.Vector3;
  spreadDuration?: number;
  // For split mechanic: child projectiles spawn at splitTime
  canSplit?: boolean;
  splitTime?: number;
  isChild?: boolean;
  // For pierce mechanic: number of additional enemies this projectile can pass through
  canPierce?: number;
  pierceCount?: number; // how many enemies already pierced
  /** Homing turn rate multiplier. 1.0 = default 12.0 rad/s; 2.0 = tighter tracking. */
  turnRateMult?: number;
  /** Set for AR rapid-fire bolts — distinguishes from BL seeking bolts in collision handler */
  isARBolt?: boolean;
  /** Set for BR devastation bolts — enables explosion and death-bolt effects on hit */
  isBRBolt?: boolean;
  /** b_8 carpet bomb: fraction (0–1) of maxAge at which missile splits into 3 sub-munitions */
  splitAt?: number;
  /** True once the b_8 mid-flight split has spawned children — prevents double-split */
  hasSplit?: boolean;
  /** b_9 devastator: child missiles trigger nova burst on detonation */
  isDevastatorChild?: boolean;
}

/**
 * Active effect data
 */
interface ActiveEffect {
  type: 'laser' | 'tesla' | 'blackhole';
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  duration: number;
  elapsed: number;
  mesh?: THREE.Object3D;
  /** For surface-following laser: the traced polyline points (world space) */
  beamPoints?: THREE.Vector3[];
  /** Level 5 mastery final form flag — used for Black Hole Event Horizon expiry logic */
  isMasteryL5?: boolean;
  /** For laser beam sweep mode (b_5): current sweep angle offset in radians */
  sweepAngle?: number;
  /** For laser beam sweep mode (b_5): sweep direction (1 or -1) */
  sweepDir?: number;
  /** For laser beam wide beam (b_4): wider hit radius */
  wideBeam?: boolean;
  /** ar_5 Eternal Collapse: persists until all enemies absorbed, then AoE shockwave on expiry */
  isEternalCollapse?: boolean;
  blackHoleConfig?: BlackHoleConfig;
  blackHoleVisual?: BlackHoleVisual;
  blackHolePhase?: BlackHolePhase;
  blackHoleRadius?: number;
  blackHoleAffectedCount?: number;
  blackHoleCollapseDeadline?: number;
  collapseApplied?: boolean;
}

export interface WeaponEnemyTarget {
  position: THREE.Vector3;
  meshPosition?: THREE.Vector3;
  index: number;
  alive: boolean;
  maxHealth?: number;
  health?: number;
  /** Stable identity used when an earlier callback removes another target. */
  targetId?: object | string | number;
}

/**
 * Callback types for weapon system
 */
export interface WeaponCallbacks {
  getEnemies: () => WeaponEnemyTarget[];
  onEnemyDamage: (
    index: number,
    damage: number,
    weaponType: WeaponType,
    targetId?: WeaponEnemyTarget['targetId'],
  ) => void;
  onEnemyPull?: (index: number, pullStrength: number, pullCenter: THREE.Vector3) => void;
  onBlackHolePull?: (
    index: number,
    pullStrength: number,
    pullCenter: THREE.Vector3,
    dt: number,
    spiralRatio: number,
    targetId?: WeaponEnemyTarget['targetId'],
  ) => void;
  /** Called to slow or stun an enemy. factor=0 = complete stun, factor=0.7 = 30% slow. */
  onEnemySlow?: (index: number, factor: number, duration: number) => void;
  spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => void;
  /** Called when a projectile detonates (homing, mortar, etc.) for weapon-specific VFX */
  onProjectileExplosion?: (position: THREE.Vector3, weaponType: WeaponType) => void;
  /** Called each update tick for each active gravity gun projectile (for surface suction VFX) */
  onGravityGunMove?: (position: THREE.Vector3) => void;
}

/**
 * Inventory entry for a collected weapon
 */
export interface WeaponInventoryEntry {
  type: WeaponType;
  ammo: number;   // -1 = infinite (Standard)
  stacks: number; // 1-5
}

/**
 * Per-pickup session bonus rates.
 * Multiplier formula: 1.0 + (sessionLevel - 1) * damagePerLevel
 * Level 1 = no bonus, Level 2 = +damagePerLevel, Level 7 = +6*damagePerLevel.
 */
const SESSION_LEVEL_BONUSES: Record<WeaponType, { damagePerLevel: number }> = {
  [WeaponType.Standard]:       { damagePerLevel: 0.05 },
  [WeaponType.Spread]:         { damagePerLevel: 0.05 },
  [WeaponType.Piercing]:       { damagePerLevel: 0.06 },
  [WeaponType.ChainLightning]: { damagePerLevel: 0.05 },
  [WeaponType.Homing]:         { damagePerLevel: 0.05 },
  [WeaponType.PlasmaMortar]:   { damagePerLevel: 0.07 },
  [WeaponType.GravityGun]:     { damagePerLevel: 0.06 },
  [WeaponType.LaserBeam]:      { damagePerLevel: 0.08 },
  [WeaponType.BlackHole]:      { damagePerLevel: 0.07 },
  [WeaponType.TeslaCoil]:      { damagePerLevel: 0.07 },
};

/**
 * Manages all weapon types, ammo, inventory, and firing
 */
export class WeaponManager {
  // Current weapon
  private currentWeapon: WeaponType = WeaponType.Standard;
  private ammo: Map<WeaponType, number> = new Map();
  private stacks: Map<WeaponType, number> = new Map();
  private lastFireTime: number = 0;
  private lastBlasterFireTime: number = 0;

  // Weapon inventory: ordered list of collected weapons (Standard always first)
  private inventory: WeaponType[] = [WeaponType.Standard];

  // Visual effects
  readonly chainLightning: ChainLightningEffect;
  readonly projectileRoot: THREE.Group;

  // Active projectiles and effects
  private projectiles: Projectile[] = [];
  private activeEffects: ActiveEffect[] = [];
  private projectileMeshes: Map<Projectile, THREE.Object3D> = new Map();

  // Active buffs
  private activeBuffs: ActiveBuff[] = [];

  // Callbacks
  private callbacks: WeaponCallbacks | null = null;

  // Optional mastery damage multiplier — injected from outside, not hardcoded
  private masteryMultiplierFn: ((type: WeaponType) => number) | null = null;

  // Optional mastery level function — injected for Level 5 final form behavior gates
  private masteryLevelFn: ((type: WeaponType) => number) | null = null;

  // Upgrade tracker — per-match, wired from main.ts
  private upgradeTracker: MatchUpgradeTracker | null = null;

  // Active gas clouds (Homing branch B node 4+)
  private gasClouds: GasCloudInstance[] = [];

  // Per-frame deduplication for homing missiles: tracks enemy indices hit this frame.
  // Prevents multiple missiles targeting the same weak enemy from all detonating simultaneously.
  private missileHitThisFrame = new Set<number>();

  // Spread cone alternation state (for spread_b_3)
  private spreadConeToggle = false;

  // Piercing BR sub-branch state
  private piercingShotCounter: number = 0;       // for piercing_br_5: every 5th shot auto-charged
  private piercingChargeMultiplier: number = 1.0; // set to 5.0 before firing a charged piercing shot

  // AR rapid-fire sub-branch tracking
  private arShotCounter: number = 0;           // for AR_8 railgun every 10th shot
  private arInfinityBurstRemaining: number = 0; // for AR_10 unlimited burst on kill

  // Laser ramp-up progress [0.0 = cold start, 1.0 = full power]
  private laserRampProgress: number = 0;

  // b_10 Armageddon: screen-wide shockwave fires once per wave on first missile hit
  private armageddonFiredThisWave = false;

  // Pending delayed shots: used for piercing double/triple tap, mortar carpet bomb, chain blast secondary
  private pendingShots: Array<{
    delay: number;
    remaining: number;
    type: WeaponType;
    origin: THREE.Vector3;
    direction: THREE.Vector3;
    surfaceNormal?: THREE.Vector3;
    // For chain blast: spawn AoE explosion at position instead of a projectile
    isChainBlast?: boolean;
    chainBlastRadius?: number;
    chainBlastDamage?: number;
    // For piercing_br_4/br_5: fire a charged shot with 5× damage
    isChargedShot?: boolean;
  }> = [];

  // Session pickup counters: uncapped, NOT reset by ammo depletion
  private sessionPickupCounts: Map<WeaponType, number> = new Map();

  /** Fires after each weapon pickup with the new session level. Level 1 = first pickup. */
  onWeaponLevelUp?: (type: WeaponType, newLevel: number) => void;

  // Surface for laser beam tracing
  private meshSurface: MeshSurface | null = null;

  // Player position reference for following effects
  playerPositionRef: THREE.Vector3 | null = null;

  // Materials for projectiles
  private projectileMaterials: Map<WeaponType, THREE.Material> = new Map();
  // Distinct material for child (split) projectiles
  private childSpreadMaterial: THREE.MeshBasicMaterial | null = null;
  private blackHoleBoltHaloMaterial: THREE.MeshBasicMaterial | null = null;

  constructor() {
    this.chainLightning = new ChainLightningEffect();
    this.projectileRoot = new THREE.Group();
    this.projectileRoot.name = 'WeaponProjectiles';

    this.initMaterials();
  }

  /**
   * Set callbacks for weapon interactions
   */
  setCallbacks(callbacks: WeaponCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Set a MeshSurface for surface-following weapons (e.g. laser beam).
   */
  setMeshSurface(ms: MeshSurface): void {
    this.meshSurface = ms;
    this.chainLightning.setMeshSurface(ms);
  }

  /**
   * Inject a mastery damage multiplier function.
   * Called by the game integration layer (Phase 3) after WeaponMasteryManager
   * is wired in. Returns 1.0 for any weapon with no mastery stacks.
   */
  setMasteryMultiplierFn(fn: (type: WeaponType) => number): void {
    this.masteryMultiplierFn = fn;
  }

  /**
   * Inject a mastery level function (returns 0-5 for each weapon type).
   * Called from main.ts after MasteryStore is initialized.
   * Used to gate Level 5 "final form" behavior.
   */
  setMasteryLevelFn(fn: (type: WeaponType) => number): void {
    this.masteryLevelFn = fn;
  }

  /** Returns true if the given weapon has reached Level 5 (max mastery). */
  private isMasteryMaxLevel(type: WeaponType): boolean {
    return (this.masteryLevelFn?.(type) ?? 0) >= 5;
  }

  /**
   * Set the per-match upgrade tracker. Call before match start.
   * Pass null to disable upgrade effects (e.g. on game over).
   */
  setUpgradeTracker(tracker: MatchUpgradeTracker | null): void {
    this.upgradeTracker = tracker;
  }

  /**
   * Record a kill towards upgrade thresholds for a weapon.
   * Called by GameLoop for blaster kills (which bypass main.ts's onEnemyDamage).
   */
  recordKillForUpgrades(weaponType: WeaponType): void {
    this.upgradeTracker?.recordKill(weaponType);
    // AR_10 Infinity burst: kill while Standard active → start 3s rapid-fire burst
    if (weaponType === WeaponType.Standard && this.upgradeTracker) {
      const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
      if (active.has('standard_ar_10')) {
        this.arInfinityBurstRemaining = 3.0;
      }
    }
  }

  /**
   * Returns the upgrade damage multiplier for a weapon (additive bonuses from active nodes).
   * Public so GameLoop.ts can apply it to blaster bullets which bypass createProjectile.
   */
  getUpgradeDamageMult(weaponType: WeaponType): number {
    if (!this.upgradeTracker) return 1.0;
    const active = this.upgradeTracker.getActiveUpgrades(weaponType);
    let bonus = 0;
    switch (weaponType) {
      case WeaponType.Standard:
        // Branch A a_1 is the dual-bolt unlock; later trunk nodes add damage.
        if (active.has('standard_a_2')) bonus += 0.40;
        if (active.has('standard_a_3')) bonus += 0.60;
        if (active.has('standard_b_4')) bonus += 0.40; // Heavy bolt: +40% damage
        // AL sub-branch damage bonuses
        if (active.has('standard_al_10')) bonus += 0.50;          // Omega scatter: +50%
        else if (active.has('standard_al_9')) bonus += 0.30;      // Annihilator: +30%
        // BR sub-branch damage bonuses (cumulative)
        if (active.has('standard_br_5'))  bonus += 0.60;          // Power shot: +60%
        if (active.has('standard_br_7'))  bonus += 0.40;          // Supercharged: cumulative +100%
        if (active.has('standard_br_8'))  bonus += 0.30;          // Armor-pierce: +30% (no armor system)
        if (active.has('standard_br_10')) bonus += 0.50;          // Annihilator: cumulative ~+180%
        break;
      case WeaponType.Spread:
        // Branch A nodes add damage per pellet
        if (active.has('spread_al_5')) bonus += 0.15; // +15% damage/pellet
        // Branch B nodes add damage bonuses
        if (active.has('spread_b_2')) bonus += 0.10;  // +10% damage
        if (active.has('spread_b_3')) bonus += 0.20;  // +20% damage
        if (active.has('spread_bl_5')) bonus += 0.50; // +50% damage
        // BR sub-branch: sniper spread — cumulative damage bonuses
        if (active.has('spread_br_4')) bonus += 0.50; // Sniper spread: +50% damage per pellet
        if (active.has('spread_br_5')) bonus += 0.30; // Railgun burst: +30% more (cumulative +80% with br_4)
        break;
      case WeaponType.ChainLightning:
        if (active.has('chain_lightning_b_1')) bonus += 0.25;
        if (active.has('chain_lightning_b_2')) bonus += 0.50;
        if (active.has('chain_lightning_b_3')) bonus += 0.80;
        // b_4 = stun (separate effect, Wave 2 slow system)
        if (active.has('chain_lightning_b_5')) bonus += 0.30; // kill explosion: +30% damage
        break;
      case WeaponType.PlasmaMortar:
        if (active.has('plasma_mortar_b_1')) bonus += 0.25;
        if (active.has('plasma_mortar_b_2')) bonus += 0.50;
        if (active.has('plasma_mortar_b_3')) bonus += 0.80;
        // b_4 = armor pierce: no armor system yet, treat as +30% damage bonus
        if (active.has('plasma_mortar_b_4')) bonus += 0.30;
        // b_5 = annihilator: instant-kill threshold (handled in collision), still gets damage bonus
        if (active.has('plasma_mortar_b_5')) bonus += 0.50;
        break;
      case WeaponType.LaserBeam:
        // Ramp nodes treated as damage increase; nodes 4+5 extend the max cap
        if (active.has('laser_beam_a_1')) bonus += 0.25;
        if (active.has('laser_beam_a_2')) bonus += 0.50;
        if (active.has('laser_beam_a_3')) bonus += 1.00; // instant peak
        if (active.has('laser_beam_a_4')) bonus += 1.50;
        if (active.has('laser_beam_a_5')) bonus += 2.00; // max dmg 3× baseline; also adds ignite DoT (TODO: DoT system)
        break;
      case WeaponType.TeslaCoil:
        if (active.has('tesla_coil_b_1')) bonus += 0.25;
        if (active.has('tesla_coil_b_2')) bonus += 0.50;
        if (active.has('tesla_coil_b_3')) bonus += 0.80;
        // b_4 = rapid tick (tick rate handled in updateEffect), still +damage per tick
        if (active.has('tesla_coil_b_4')) bonus += 1.00;
        // b_5 = surge overload: +150% dmg/tick + stun (stun is TODO: no slow system yet)
        if (active.has('tesla_coil_b_5')) bonus += 1.50;
        break;
      case WeaponType.Piercing:
        // Piercing has no dedicated damage branch; fire rate is branch B, range is branch A
        break;
      default:
        break;
    }
    return 1.0 + bonus;
  }

  /** Upgrade fire rate multiplier for a weapon (used in cooldown computation). */
  getUpgradeFireRateMult(weaponType: WeaponType): number {
    if (!this.upgradeTracker) return 1.0;
    const active = this.upgradeTracker.getActiveUpgrades(weaponType);
    let bonus = 0;
    if (weaponType === WeaponType.Standard) {
      // Branch B b_1 is the focused-pair unlock; later trunk nodes add fire rate.
      if (active.has('standard_b_2')) bonus += 0.30;
      if (active.has('standard_b_3')) bonus += 0.50;
      if (active.has('standard_a_4')) bonus += 0.30; // Rapid bolt: +30% fire rate
      // standard_b_4 (Heavy bolt) = damage bonus, no fire rate change
      // standard_bl_5..bl_10 (Seeking/BL sub-branch) = seeking bolts handled in fireSeekingBlasterBolts, no fire rate change
      // AR sub-branch fire rate bonuses (cumulative)
      if (active.has('standard_ar_5'))  bonus += 0.50; // Overclock: +50%
      if (active.has('standard_ar_6'))  bonus += 0.30; // Hyperclock: cumulative +80%
      if (active.has('standard_ar_7'))  bonus += 0.40; // Machine gun: cumulative +120%
      if (active.has('standard_ar_9'))  bonus += 0.80; // Minigun: cumulative +200% (ar_8 no fire rate change)
      if (active.has('standard_ar_10')) bonus += 0.80; // Infinity burst: cumulative +280%
      // Infinity burst active window: massive additional fire rate
      if (active.has('standard_ar_10') && this.arInfinityBurstRemaining > 0) bonus += 7.0;
    } else if (weaponType === WeaponType.Piercing) {
      if (active.has('piercing_b_1')) bonus += 0.20;
      if (active.has('piercing_b_2')) bonus += 0.40;
      if (active.has('piercing_b_3')) bonus += 0.60;
      if (active.has('piercing_bl_5')) bonus += 0.70; // Triple tap: +70% fire rate
      // piercing_bl_4 = double tap: extra shots queued on fire
    }
    return 1.0 + bonus;
  }

  /** Active upgrade node set for a weapon (empty set if no tracker). */
  private activeUpgradeNodes(weaponType: WeaponType): Set<string> {
    return this.upgradeTracker?.getActiveUpgrades(weaponType) ?? new Set();
  }

  // ---------------------------------------------------------------------------
  // Blaster (Standard) fan-out helpers — queried by fireStandard and by GameLoop
  // for damage numbers that use BulletPool instead of createProjectile.
  // ---------------------------------------------------------------------------

  /**
   * Returns how many extra side bolts to spawn for the blaster (Branch A fan-out).
   * 0 = only the standard single starter bolt; 6 = 7 total in a fan.
   */
  getBlasterExtraBolts(): number {
    if (!this.upgradeTracker) return 0;
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    // AL sub-branch overrides: al_6 (Nova burst) fires 9 bolts total (8 extra)
    if (active.has('standard_al_6'))  return 8;  // Nova burst: 9 total
    // al_5 (Shotgun spread): same bolt count as a_4, but a wider scatter arc.
    if (active.has('standard_a_4') || active.has('standard_al_5')) return 4;  // 5 total
    if (active.has('standard_a_3')) return 3;  // 4 total
    if (active.has('standard_a_2')) return 2;  // 3 total
    if (active.has('standard_a_1')) return 1;  // 2 total
    return 0;
  }

  /**
   * Returns blaster cone spread angle in radians for the fan-out (Branch A).
   * 0 means no fan (two parallel bolts only).
   */
  getBlasterSpreadAngle(): number {
    if (!this.upgradeTracker) return 0;
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    // AL sub-branch overrides
    if (active.has('standard_al_6'))  return Math.PI * 55 / 180; // Nova burst: 55° fan
    if (active.has('standard_al_5'))  return Math.PI * 35 / 180;  // Shotgun spread: 35 degrees
    if (active.has('standard_a_4')) return Math.PI / 7.2; // 25°
    if (active.has('standard_a_3')) return Math.PI / 12;  // 15°
    if (active.has('standard_a_2')) return Math.PI / 18;  // 10°
    if (active.has('standard_a_1')) return Math.PI / 36;  // 5°
    return 0;
  }

  /**
   * Returns the homing bias for Seeking (BL sub-branch) blaster bolts.
   * 0 = no homing; 0.95 = near-perfect homing (bl_10 Apex hunter).
   * Returns 0 if no BL nodes are active.
   */
  getBlasterHomingStrength(): number {
    if (!this.upgradeTracker) return 0;
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    // BL sub-branch: bl_5 (mild) through bl_10 (near-perfect)
    if (active.has('standard_bl_10')) return 0.95; // Apex hunter: near-perfect homing
    if (active.has('standard_bl_9'))  return 0.85; // Guided cluster
    if (active.has('standard_bl_8'))  return 0.80; // Lock-on volley
    if (active.has('standard_bl_7'))  return 0.75; // Precision burst
    if (active.has('standard_bl_6'))  return 0.60; // Smart swarm
    if (active.has('standard_bl_5'))  return 0.30; // Seeking bolts: mild homing
    return 0;
  }

  getBlasterPierceCount(): number {
    return 0;
  }

  /**
   * Returns BL seeking bolt count and whether loop-back is active.
   * Used by fireStandard to spawn the correct number of seeking projectiles.
   */
  private getBlasterBLSeekingConfig(): { boltCount: number; loopBack: boolean; splitTargets: number } {
    if (!this.upgradeTracker) return { boltCount: 0, loopBack: false, splitTargets: 1 };
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    if (active.has('standard_bl_10')) return { boltCount: 6,  loopBack: true,  splitTargets: 1 };
    if (active.has('standard_bl_9'))  return { boltCount: 6,  loopBack: false, splitTargets: 1 };
    if (active.has('standard_bl_8'))  return { boltCount: 8,  loopBack: false, splitTargets: 2 };
    if (active.has('standard_bl_7'))  return { boltCount: 6,  loopBack: false, splitTargets: 1 };
    if (active.has('standard_bl_6'))  return { boltCount: 5,  loopBack: false, splitTargets: 1 };
    if (active.has('standard_bl_5'))  return { boltCount: 4,  loopBack: false, splitTargets: 1 };
    return { boltCount: 0, loopBack: false, splitTargets: 1 };
  }

  /**
   * Returns extra tight-cluster bolts from Branch B (Damage theme).
   * b_1 = 1 extra (2 total tight pair), b_2 = 2 extra (3 total needle), b_3 = 3 extra (4 total lance).
   * These stack additively with Branch A fan bolts when both are active.
   */
  getBlasterBranchBExtraBolts(): number {
    if (!this.upgradeTracker) return 0;
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    if (active.has('standard_b_3')) return 3;  // Quad lance: 4 total tight bolts
    if (active.has('standard_b_2')) return 2;  // Triple needle: 3 total tight bolts
    if (active.has('standard_b_1')) return 1;  // Focused pair: 2 total tight bolts
    return 0;
  }

  /**
   * Returns the tight cone angle (radians) for Branch B bolt cluster.
   * b_1 = 3° (focused pair), b_2 = 4° (triple needle), b_3 = 5° (quad lance).
   */
  getBlasterBranchBConeAngle(): number {
    if (!this.upgradeTracker) return 0;
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    if (active.has('standard_b_3')) return Math.PI / 36;  // 5° tight lance
    if (active.has('standard_b_2')) return Math.PI / 45;  // 4° needle
    if (active.has('standard_b_1')) return Math.PI / 60;  // 3° focused pair
    return 0;
  }

  /**
   * Get the root group containing all weapon visuals (add to scene)
   */
  getVisualRoot(): THREE.Group {
    const root = new THREE.Group();
    root.add(this.chainLightning.root);
    root.add(this.projectileRoot);
    return root;
  }

  /**
   * Initialize projectile materials
   */
  private initMaterials(): void {
    // Spread shot - cyan
    this.projectileMaterials.set(WeaponType.Spread, new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.Spread].color,
      transparent: true,
      opacity: 0.9,
    }));

    // Child (split) projectiles - orange, visually distinct
    this.childSpreadMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.85,
    });

    // Homing - red
    this.projectileMaterials.set(WeaponType.Homing, new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.Homing].color,
    }));

    // Plasma mortar - green glow
    this.projectileMaterials.set(WeaponType.PlasmaMortar, new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.PlasmaMortar].color,
      transparent: true,
      opacity: 0.9,
    }));

    // Gravity gun - purple
    this.projectileMaterials.set(WeaponType.GravityGun, new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.GravityGun].color,
      transparent: true,
      opacity: 0.8,
    }));

    this.projectileMaterials.set(WeaponType.BlackHole, new THREE.MeshBasicMaterial({
      color: 0x140018,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }));
    this.blackHoleBoltHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    // Standard (seeking bolts) - yellow-gold, visually distinct from BulletPool bolts
    this.projectileMaterials.set(WeaponType.Standard, new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.Standard].color,
      transparent: true,
      opacity: 0.85,
    }));
  }

  /**
   * Get current weapon type
   */
  getCurrentWeapon(): WeaponType {
    return this.currentWeapon;
  }

  /** Read-only live weapon capability for the shared DDA power model. */
  getPlayerPowerWeapons(blasterDamagePerBolt: number): {
    blaster: WeaponPowerInput;
    activeWeapon?: WeaponPowerInput;
  } {
    const rapidMult = this.getBuffMultiplier(BuffType.RapidFire);
    const blasterRate = WEAPON_CONFIGS[WeaponType.Standard].fireRate
      * rapidMult
      * this.getUpgradeFireRateMult(WeaponType.Standard);
    const fanExtraBolts = this.getBlasterExtraBolts();
    const branchBExtraBolts = this.getBlasterBranchBExtraBolts();
    const blasterProjectiles = fanExtraBolts > 0 || branchBExtraBolts > 0
      ? (fanExtraBolts > 0 ? fanExtraBolts + 1 : 0)
        + (branchBExtraBolts > 0 ? branchBExtraBolts + 1 : 0)
      : 1;
    const blaster: WeaponPowerInput = {
      damage: Math.max(0, blasterDamagePerBolt),
      shotsPerSecond: blasterRate,
      projectilesPerShot: blasterProjectiles,
      multiHitPotential: 1 + Math.min(1, this.getBlasterPierceCount() * 0.5),
    };

    if (this.currentWeapon === WeaponType.Standard) return { blaster };

    const config = WEAPON_CONFIGS[this.currentWeapon];
    const masteryMult = this.masteryMultiplierFn?.(this.currentWeapon) ?? 1;
    const damage = config.damage
      * this.getStackDamageMultiplier(this.currentWeapon)
      * masteryMult
      * this.getSessionDamageMultiplier(this.currentWeapon)
      * this.getUpgradeDamageMult(this.currentWeapon);
    const projectilesPerShot = this.currentWeapon === WeaponType.Spread ? 5 : 1;
    const multiHitPotential = this.currentWeapon === WeaponType.ChainLightning ? 4
      : this.currentWeapon === WeaponType.Piercing ? 2
      : this.currentWeapon === WeaponType.PlasmaMortar ? 2
      : 1;

    return {
      blaster,
      activeWeapon: {
        damage,
        shotsPerSecond: config.fireRate * rapidMult * this.getUpgradeFireRateMult(this.currentWeapon),
        projectilesPerShot,
        multiHitPotential,
      },
    };
  }

  /**
   * Get ammo for current weapon (-1 means unlimited)
   */
  getCurrentAmmo(): number {
    if (this.currentWeapon === WeaponType.Standard) return -1;
    return this.ammo.get(this.currentWeapon) ?? 0;
  }

  /**
   * Check if tesla coil effect is currently active
   */
  isTeslaActive(): boolean {
    return this.activeEffects.some(effect => effect.type === 'tesla');
  }

  /**
   * Equip a new weapon with ammo. Adds to inventory if not already present.
   * If the weapon is already in inventory, stacks ammo and increases stack level.
   *
   * Auto-switches to the new weapon only when:
   *   - Currently on Standard (auto-equip first special weapon)
   *   - Picking up the same type as currently active (no-op switch)
   * Otherwise silently adds to inventory — player presses [E] to cycle.
   *
   * Returns true if the active weapon was switched, false if silently added.
   */
  equipWeapon(type: WeaponType, ammo?: number): boolean {
    const config = WEAPON_CONFIGS[type];

    if (type !== WeaponType.Standard) {
      const existingAmmo = this.ammo.get(type) ?? 0;
      const addedAmmo = ammo ?? config.ammo;
      this.ammo.set(type, existingAmmo + addedAmmo);

      // Stack: each pickup of the same type increments the stack level (up to 5)
      // regardless of which weapon is currently active.
      if (this.stacks.has(type)) {
        const currentStack = this.stacks.get(type)!;
        this.stacks.set(type, Math.min(currentStack + 1, 5));
      } else {
        this.stacks.set(type, 1);
      }

      // Session pickup counter: uncapped, survives ammo depletion within a session
      const prevSessionCount = this.sessionPickupCounts.get(type) ?? 0;
      const newSessionCount = prevSessionCount + 1;
      this.sessionPickupCounts.set(type, newSessionCount);
      this.onWeaponLevelUp?.(type, newSessionCount);

      // Add to inventory if not already present
      if (!this.inventory.includes(type)) {
        this.inventory.push(type);
      }
    }

    // Only auto-switch if player hasn't equipped a special weapon yet,
    // or if they picked up the same type they're already using.
    const shouldSwitch = this.currentWeapon === WeaponType.Standard || type === this.currentWeapon;
    if (shouldSwitch) {
      this.currentWeapon = type;
    }
    return shouldSwitch;
  }

  /**
   * Force-set the current weapon, bypassing the auto-switch logic of equipWeapon().
   * Used by the network client to sync currentWeapon with the server-authoritative
   * weapon type. Unlike equipWeapon(), this ALWAYS switches currentWeapon regardless
   * of what was previously active.
   */
  forceSetWeapon(type: WeaponType, ammo?: number): void {
    if (type !== WeaponType.Standard) {
      const existingAmmo = this.ammo.get(type) ?? 0;
      const addedAmmo = ammo ?? WEAPON_CONFIGS[type].ammo;
      this.ammo.set(type, existingAmmo + addedAmmo);
      if (!this.stacks.has(type)) {
        this.stacks.set(type, 1);
      }
      if (!this.inventory.includes(type)) {
        this.inventory.push(type);
      }
    }
    this.currentWeapon = type;
  }

  /**
   * Cycle to the next weapon in inventory.
   * Skips weapons with 0 ammo (removes them from inventory).
   * Returns the new active weapon type.
   */
  cycleWeapon(): WeaponType {
    // Clean up depleted weapons from inventory (keep Standard)
    this.pruneDepletedWeapons();

    if (this.inventory.length <= 1) {
      // Only Standard left
      this.currentWeapon = WeaponType.Standard;
      return this.currentWeapon;
    }

    const currentIndex = this.inventory.indexOf(this.currentWeapon);
    const nextIndex = (currentIndex + 1) % this.inventory.length;
    this.currentWeapon = this.inventory[nextIndex];
    return this.currentWeapon;
  }

  /**
   * Get the full weapon inventory for HUD display.
   * Standard is always first with ammo = -1.
   */
  getInventory(): WeaponInventoryEntry[] {
    // Clean up depleted weapons first
    this.pruneDepletedWeapons();

    return this.inventory.map(type => ({
      type,
      ammo: type === WeaponType.Standard ? -1 : (this.ammo.get(type) ?? 0),
      stacks: this.stacks.get(type) ?? 1,
    }));
  }

  /**
   * Remove weapons with 0 ammo from inventory (never removes Standard).
   * If current weapon was removed, switch to next available or Standard.
   *
   * IMPORTANT: Also updates currentWeapon when the active weapon is pruned.
   * This ensures the HUD (which calls getInventory() every frame) always shows
   * the correct active weapon without requiring a fire() call to trigger auto-switch.
   */
  private pruneDepletedWeapons(): void {
    for (let i = this.inventory.length - 1; i >= 0; i--) {
      const type = this.inventory[i];
      if (type === WeaponType.Standard) continue;
      const ammo = this.ammo.get(type) ?? 0;
      if (ammo <= 0) {
        this.inventory.splice(i, 1);
        this.ammo.delete(type);
        this.stacks.delete(type);
      }
    }

    // If currentWeapon was just pruned, switch to next available or Standard.
    // This keeps currentWeapon in sync with inventory at all times, not just on fire().
    if (this.currentWeapon !== WeaponType.Standard && !this.inventory.includes(this.currentWeapon)) {
      const nonStandard = this.inventory.filter(t => t !== WeaponType.Standard);
      this.currentWeapon = nonStandard.length > 0 ? nonStandard[0] : WeaponType.Standard;
    }
  }

  /**
   * Auto-switch to the next weapon with ammo when current runs out.
   * Prefers the next weapon in inventory order, falls back to Standard.
   */
  private autoSwitchOnDepletion(): void {
    if (this.currentWeapon === WeaponType.Standard) return;

    const ammo = this.ammo.get(this.currentWeapon) ?? 0;
    if (ammo > 0) return;

    // Current weapon depleted - find next available
    this.pruneDepletedWeapons();

    // If still in inventory somehow, stay
    if (this.inventory.includes(this.currentWeapon)) return;

    // Find next weapon with ammo (skip Standard, try others first)
    const nonStandard = this.inventory.filter(t => t !== WeaponType.Standard);
    if (nonStandard.length > 0) {
      this.currentWeapon = nonStandard[0];
    } else {
      this.currentWeapon = WeaponType.Standard;
    }
  }

  /**
   * Check if weapon can fire (cooldown and ammo)
   */
  canFire(currentTime: number): boolean {
    // When blaster is the active weapon, use blaster cooldown
    if (this.currentWeapon === WeaponType.Standard) {
      const blasterConfig = WEAPON_CONFIGS[WeaponType.Standard];
      const rapidMult = this.getBuffMultiplier(BuffType.RapidFire);
      const upgradeRateMult = this.getUpgradeFireRateMult(WeaponType.Standard);
      const cooldown = 1 / (blasterConfig.fireRate * rapidMult * upgradeRateMult);
      return currentTime - this.lastBlasterFireTime >= cooldown;
    }

    // For non-blaster weapons, use primary weapon cooldown
    const config = WEAPON_CONFIGS[this.currentWeapon];
    const rapidMult = this.getBuffMultiplier(BuffType.RapidFire);
    const upgradeRateMult = this.getUpgradeFireRateMult(this.currentWeapon);
    const cooldown = 1 / (config.fireRate * rapidMult * upgradeRateMult);

    if (currentTime - this.lastFireTime < cooldown) return false;

    const ammo = this.ammo.get(this.currentWeapon) ?? 0;
    if (ammo <= 0) {
      this.autoSwitchOnDepletion();
      return this.canFire(currentTime);
    }

    return true;
  }

  /**
   * Fire the current weapon
   * @param origin - Player position
   * @param direction - Aim direction (normalized)
   * @param currentTime - Current game time
   * @param surfaceNormal - Surface normal at player position (for spread rotation)
   * @returns true if weapon fired
   */
  fire(origin: THREE.Vector3, direction: THREE.Vector3, currentTime: number, surfaceNormal?: THREE.Vector3): boolean {
    let firedAnything = false;

    // Blaster fires on its OWN independent cooldown (always active)
    const blasterConfig = WEAPON_CONFIGS[WeaponType.Standard];
    const rapidMult = this.getBuffMultiplier(BuffType.RapidFire);
    const blasterUpgradeRate = this.getUpgradeFireRateMult(WeaponType.Standard);
    const blasterCooldown = 1 / (blasterConfig.fireRate * rapidMult * blasterUpgradeRate);
    if (currentTime - this.lastBlasterFireTime >= blasterCooldown) {
      this.lastBlasterFireTime = currentTime;
      this.fireStandard(origin, direction, surfaceNormal);
      firedAnything = true;
    }

    // Primary weapon fires on its own cooldown (if not Standard, which is blaster)
    if (this.currentWeapon !== WeaponType.Standard && this.canFire(currentTime)) {
      this.lastFireTime = currentTime;

      // Consume ammo (Duration+ buff halves consumption)
      const durationMult = this.getBuffMultiplier(BuffType.DurationPlus);
      const consumeChance = 1.0 / durationMult;
      if (Math.random() < consumeChance) {
        const ammo = this.ammo.get(this.currentWeapon) ?? 0;
        this.ammo.set(this.currentWeapon, ammo - 1);
      }

      switch (this.currentWeapon) {
        case WeaponType.Spread:
          this.fireSpread(origin, direction, surfaceNormal);
          break;
        case WeaponType.Piercing:
          this.firePiercing(origin, direction);
          break;
        case WeaponType.ChainLightning:
          this.fireChainLightning(origin, direction);
          break;
        case WeaponType.Homing:
          this.fireHoming(origin, direction);
          break;
        case WeaponType.PlasmaMortar:
          this.fireMortar(origin, direction);
          break;
        case WeaponType.GravityGun:
          this.fireGravityGun(origin, direction);
          break;
        case WeaponType.LaserBeam:
          this.fireLaser(origin, direction);
          break;
        case WeaponType.BlackHole:
          this.fireBlackHole(origin, direction);
          break;
        case WeaponType.TeslaCoil:
          this.fireTesla(origin);
          break;
      }
      firedAnything = true;
    }

    // If only blaster equipped, use blaster cooldown for the return value
    if (this.currentWeapon === WeaponType.Standard) {
      return firedAnything;
    }

    return firedAnything;
  }

  /**
   * Update all projectiles and effects
   */
  update(dt: number, primaryFireHeld = false): void {
    // Tick down active buffs
    for (let i = this.activeBuffs.length - 1; i >= 0; i--) {
      this.activeBuffs[i].remaining -= dt;
      if (this.activeBuffs[i].remaining <= 0) {
        this.activeBuffs.splice(i, 1);
      }
    }

    // AR_10 Infinity burst countdown
    if (this.arInfinityBurstRemaining > 0) {
      this.arInfinityBurstRemaining = Math.max(0, this.arInfinityBurstRemaining - dt);
    }

    // Update chain lightning effects
    this.chainLightning.update(dt);

    // Laser ramp-up: accumulate while laser is active, reset to 0 when not firing
    {
      const laserActive = this.activeEffects.some(e => e.type === 'laser');
      if (laserActive) {
        const laserNodes = this.activeUpgradeNodes(WeaponType.LaserBeam);
        if (laserNodes.has('laser_beam_a_3')) {
          this.laserRampProgress = 1.0; // instant peak
        } else {
          const rampTime = laserNodes.has('laser_beam_a_2') ? 0.6 :
                           laserNodes.has('laser_beam_a_1') ? 1.05 : 1.5;
          this.laserRampProgress = Math.min(1.0, this.laserRampProgress + dt / rampTime);
        }
      } else {
        this.laserRampProgress = 0;
      }
    }

    // Update projectiles
    // Clear per-frame missile deduplication set before processing this frame's projectiles
    this.missileHitThisFrame.clear();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.age += dt;

      if (proj.age >= proj.maxAge) {
        // GravityGun that reaches max age hit the surface (not an enemy)
        if (proj.type === WeaponType.GravityGun) {
          this.callbacks?.onProjectileExplosion?.(proj.position.clone(), WeaponType.GravityGun);
        }
        // Apex hunter (bl_10): loop back once on miss — reverse toward nearest enemy instead of expiring
        if (proj.type === WeaponType.Standard && proj.loopBackOnMiss && !proj.hasLoopedBack && this.callbacks) {
          const enemies = this.callbacks.getEnemies();
          let nearestEnemy: { position: THREE.Vector3; index: number } | null = null;
          let nearestDist = Infinity;
          for (const e of enemies) {
            if (!e.alive) continue;
            const d = proj.position.distanceTo(e.position);
            if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
          }
          if (nearestEnemy) {
            // Reverse direction toward nearest enemy and give another life (same duration)
            proj.direction.copy(nearestEnemy.position.clone().sub(proj.position).normalize());
            proj.targetIndex = nearestEnemy.index;
            proj.age = 0; // reset age for the return pass
            proj.hasLoopedBack = true; // prevent looping again
            continue; // don't remove — let it continue
          }
        }
        this.removeProjectile(i);
        continue;
      }

      const previousPosition = proj.position.clone();

      // Update position based on type
      this.updateProjectile(proj, dt);
      proj.previousPosition = previousPosition;

      // Update mesh position and orientation
      const mesh = this.projectileMeshes.get(proj);
      if (mesh) {
        mesh.position.copy(proj.position);
        // Orient cone-shaped projectiles to face direction of travel.
        // Without this, the cone always points world +Z (identity quaternion),
        // appearing as a "red line" instead of a distinct missile shape.
        if (proj.type === WeaponType.Homing && proj.direction.lengthSq() > 0.0001) {
          const dir = proj.direction.clone().normalize();
          const dot = _PROJ_CONE_FWD.dot(dir);
          if (dot < -0.9999) {
            // Anti-parallel: rotate 180° around up axis
            mesh.quaternion.setFromAxisAngle(_PROJ_CONE_UP, Math.PI);
          } else {
            mesh.quaternion.setFromUnitVectors(_PROJ_CONE_FWD, dir);
          }
        }
      }

      // Notify surface VFX system and apply continuous enemy pull for gravity gun
      if (proj.type === WeaponType.GravityGun) {
        this.callbacks?.onGravityGunMove?.(proj.position);
        // Continuously attract enemies toward the projectile while it travels.
        // Pull radius slightly larger than detonation radius (3.0 vs 2.0) to create
        // a "suction field" ahead of the projectile. Strength capped at 50% vs full
        // detonation pull to avoid over-powering before the bullet arrives.
        this.applyGravityPull(proj.position, 3.0, true);
      }

      if (proj.type === WeaponType.BlackHole) {
        this.applyBlackHoleBoltPull(proj, dt);
      }

      // Check for spread pellet split (spawns child projectiles mid-flight)
      if (proj.canSplit && proj.splitTime !== undefined && proj.age >= proj.splitTime) {
        this.spawnSplitChildren(proj);
        proj.canSplit = false;
      }

      // Check collisions
      this.checkProjectileCollisions(proj, i);
    }

    // Update gas clouds (Homing branch B node 4+)
    for (let i = this.gasClouds.length - 1; i >= 0; i--) {
      const cloud = this.gasClouds[i];
      cloud.elapsed += dt;
      cloud.tickTimer += dt;

      if (cloud.elapsed >= cloud.duration) {
        this.projectileRoot.remove(cloud.mesh);
        this.gasClouds.splice(i, 1);
        continue;
      }

      // Damage tick every 0.5s
      if (cloud.tickTimer >= GAS_CLOUD_TICK) {
        cloud.tickTimer -= GAS_CLOUD_TICK;
        this.applyAoeDamage(cloud.position, GAS_CLOUD_RADIUS, GAS_CLOUD_DAMAGE);
      }

      // Pulsing animation
      const pulse = 0.9 + Math.sin(cloud.elapsed * Math.PI * 2) * 0.1;
      cloud.mesh.scale.setScalar(GAS_CLOUD_RADIUS * pulse);
      cloud.mesh.rotation.y += dt * 0.5;
    }

    // Process pending delayed shots (piercing double/triple tap, mortar chain blast, carpet bomb)
    for (let i = this.pendingShots.length - 1; i >= 0; i--) {
      const pending = this.pendingShots[i];
      pending.remaining -= dt;
      if (pending.remaining <= 0) {
        if (pending.isChainBlast) {
          // Chain blast: secondary explosion at same position
          this.applyAoeDamage(pending.origin, pending.chainBlastRadius ?? 1.5, pending.chainBlastDamage ?? 0);
          this.callbacks?.onProjectileExplosion?.(pending.origin.clone(), WeaponType.PlasmaMortar);
        } else if (pending.type === WeaponType.Piercing) {
          if (pending.isChargedShot) this.piercingChargeMultiplier = 5.0; // BR charged bolt: 5× damage
          this.firePiercing(pending.origin, pending.direction, true); // isQueued=true: no further queuing
        } else if (pending.type === WeaponType.Spread) {
          this.fireSpread(pending.origin, pending.direction, pending.surfaceNormal, true); // isQueued=true
        } else if (pending.type === WeaponType.PlasmaMortar) {
          this.fireMortar(pending.origin, pending.direction);
        }
        this.pendingShots.splice(i, 1);
      }
    }

    if (this.currentWeapon === WeaponType.TeslaCoil && !primaryFireHeld) {
      this.removeTeslaEffects();
    }

    // Tesla coil: maintain persistent aura while fire is held so orbs follow the player.
    if (primaryFireHeld && this.currentWeapon === WeaponType.TeslaCoil && this.playerPositionRef !== null) {
      if (!this.activeEffects.some(e => e.type === 'tesla')) {
        this.fireTesla(this.playerPositionRef.clone());
      }
    }

    // Update active effects
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.elapsed += dt;

      if (effect.elapsed >= effect.duration) {
        if (effect.type === 'blackhole') {
          this.completeBlackHole(effect);
          effect.blackHoleVisual?.dispose();
        } else if (effect.mesh) {
          this.projectileRoot.remove(effect.mesh);
        }
        this.activeEffects.splice(i, 1);
        continue;
      }

      this.updateEffect(effect, dt);
    }
  }

  // -------------------------------------------------------------------------
  // Weapon-specific fire methods
  // -------------------------------------------------------------------------

  private fireStandard(origin: THREE.Vector3, direction: THREE.Vector3, surfaceNormal?: THREE.Vector3): void {
    // Dual/focused unlock setup: offset paired bullets perpendicular to aim direction.
    const up = surfaceNormal?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(direction, up).normalize();
    const offset = 0.15;

    // Scale barrel offset by the local surface metric to prevent tie-fighter spread at poles.
    // Near poles of pill/capsule/sphere surfaces, the azimuthal circumference converges to zero.
    // The metric factor is the magnitude of the normal's horizontal component (perpendicular to Y).
    // At body (normal horizontal): factor = 1, full offset. At pole (normal = ±Y): factor = 0.
    // This makes both barrels converge to a single point at the pole, matching the visual geometry.
    const poleMetricFactor = surfaceNormal
      ? Math.sqrt(Math.max(0, 1.0 - surfaceNormal.y * surfaceNormal.y))
      : 1.0;
    const scaledOffset = offset * poleMetricFactor;

    const leftOrigin = origin.clone().addScaledVector(right, -scaledOffset);
    const rightOrigin = origin.clone().addScaledVector(right, scaledOffset);

    // Branch A fan-out: standard_a_1 through standard_a_4 add extra bolts in a spreading cone
    const extraBoltsA = this.getBlasterExtraBolts();
    const fanAngle = this.getBlasterSpreadAngle();
    // Branch B tight cluster: standard_b_1 through standard_b_3 add bolts in a tight cone
    const extraBoltsB = this.getBlasterBranchBExtraBolts();
    const tightAngle = this.getBlasterBranchBConeAngle();
    const rotAxis = up.clone();

    const hasBranchA = extraBoltsA > 0 && fanAngle > 0;
    const hasBranchB = extraBoltsB > 0 && tightAngle > 0;

    if (hasBranchA && hasBranchB) {
      // COMBINED — Rapid Quad Lance: both branches active simultaneously.
      // Branch A fan bolts fire from center; Branch B tight cluster fires as inner core.
      // Total bolts = (extraBoltsA + 1) + (extraBoltsB + 1) — reward for investing both paths.
      const totalFanBolts = extraBoltsA + 1;
      for (let i = 0; i < totalFanBolts; i++) {
        const t = totalFanBolts === 1 ? 0 : (i / (totalFanBolts - 1)) * 2 - 1;
        const angle = t * (fanAngle / 2);
        const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();
        this.callbacks?.spawnBullet(origin.clone(), boltDir);
      }
      const totalTightBolts = extraBoltsB + 1;
      for (let i = 0; i < totalTightBolts; i++) {
        const t = totalTightBolts === 1 ? 0 : (i / (totalTightBolts - 1)) * 2 - 1;
        const angle = t * (tightAngle / 2);
        const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();
        this.callbacks?.spawnBullet(origin.clone(), boltDir);
      }
    } else if (hasBranchA) {
      // Fan mode only (Branch A): center bolt + extraBoltsA side bolts spread across ±fanAngle/2
      const totalBolts = extraBoltsA + 1;
      for (let i = 0; i < totalBolts; i++) {
        const t = totalBolts === 1 ? 0 : (i / (totalBolts - 1)) * 2 - 1; // -1 to +1
        const angle = t * (fanAngle / 2);
        const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();
        this.callbacks?.spawnBullet(origin.clone(), boltDir);
      }
    } else if (hasBranchB) {
      // Tight cluster only (Branch B): bolts fired in a tight cone from center
      const totalBolts = extraBoltsB + 1;
      for (let i = 0; i < totalBolts; i++) {
        const t = totalBolts === 1 ? 0 : (i / (totalBolts - 1)) * 2 - 1;
        const angle = t * (tightAngle / 2);
        const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();
        const boltOrigin = totalBolts === 2
          ? (i === 0 ? leftOrigin : rightOrigin)
          : origin;
        this.callbacks?.spawnBullet(boltOrigin.clone(), boltDir);
      }
    } else {
      // Default: single starter bolt. Dual/focused pairs are real mastery unlocks.
      this.callbacks?.spawnBullet(origin.clone(), direction);
    }

    // LEVEL 5 FINAL FORM — Twin Stream: fire 2 additional V-patterned bullets at ±15°
    // Creates a spectacular 4-bullet spread that effectively doubles DPS
    if (this.isMasteryMaxLevel(WeaponType.Standard)) {
      const spreadAngle = Math.PI / 12; // 15 degrees
      const leftDir = direction.clone().applyAxisAngle(rotAxis, -spreadAngle).normalize();
      const rightDir = direction.clone().applyAxisAngle(rotAxis, spreadAngle).normalize();
      this.callbacks?.spawnBullet(leftOrigin, leftDir);
      this.callbacks?.spawnBullet(rightOrigin, rightDir);
    }

    // BL Sub-branch: Seeking bolts (standard_bl_5 through standard_bl_10)
    // When any BL node is active, spawn Projectile-based homing bolts that track enemies.
    // These supplement the normal Standard bolts (they do not replace them).
    const blConfig = this.getBlasterBLSeekingConfig();
    if (blConfig.boltCount > 0) {
      this.fireSeekingBlasterBolts(origin, direction, rotAxis, blConfig);
    }

    // AL_7+ Ring scatter: supplemental ring/fan BulletPool bolts
    const active = this.upgradeTracker?.getActiveUpgrades(WeaponType.Standard) ?? new Set<string>();
    const hasALRing = active.has('standard_al_7') || active.has('standard_al_8') ||
                      active.has('standard_al_9') || active.has('standard_al_10');
    if (hasALRing) {
      this.fireALScatterRing(origin, direction, rotAxis, active);
    }

    // AR_6+ Special rapid bolts: supplemental Projectile bolts with pierce/homing
    const hasARSpecial = active.has('standard_ar_6') || active.has('standard_ar_7') ||
                         active.has('standard_ar_8') || active.has('standard_ar_9') ||
                         active.has('standard_ar_10');
    if (hasARSpecial) {
      this.fireARSpecialBolts(origin, direction, rotAxis, active);
    }

    // BR_6+ Devastation bolts: supplemental Projectile bolts with explosion on hit
    const hasBRDev = active.has('standard_br_6') || active.has('standard_br_7') ||
                     active.has('standard_br_8') || active.has('standard_br_9') ||
                     active.has('standard_br_10');
    if (hasBRDev) {
      this.fireBRDevastationBolts(origin, direction, rotAxis, active);
    }
  }

  /**
   * Fires seeking blaster bolts as Projectile objects (not BulletPool bullets).
   * Called by fireStandard when BL sub-branch nodes are active.
   * Bolts use the existing Projectile homing update path via the homingBias field.
   */
  private fireSeekingBlasterBolts(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    rotAxis: THREE.Vector3,
    config: { boltCount: number; loopBack: boolean; splitTargets: number },
  ): void {
    const homingBias = this.getBlasterHomingStrength();
    const blasterConfig = WEAPON_CONFIGS[WeaponType.Standard];
    // Seeking bolts get a slight speed boost vs normal bolts
    const hasSpeedNode = this.upgradeTracker?.getActiveUpgrades(WeaponType.Standard).has('standard_bl_7') ?? false;
    const speedMult = hasSpeedNode ? 1.1 : 1.0;
    const speed = blasterConfig.projectileSpeed * speedMult;

    // Find target enemies (up to splitTargets for lock-on volley)
    const enemies = this.callbacks?.getEnemies().filter(e => e.alive) ?? [];
    const targets: Array<{ position: THREE.Vector3; index: number }> = [];
    if (config.splitTargets > 1 && enemies.length >= 2) {
      // Lock-on volley (bl_8): split bolts between 2 nearest enemies
      const sorted = enemies.slice().sort((a, b) =>
        a.position.distanceTo(origin) - b.position.distanceTo(origin),
      );
      targets.push(sorted[0], sorted[1]);
    } else if (enemies.length > 0) {
      const nearest = enemies.reduce((best, e) =>
        e.position.distanceTo(origin) < best.position.distanceTo(origin) ? e : best,
      );
      targets.push(nearest);
    }

    // Spread bolts in a fan; each bolt independently homes toward its target
    const fanCount = config.boltCount;
    const fanHalfAngle = Math.PI / 12; // ±15° spread for visual separation
    for (let i = 0; i < fanCount; i++) {
      const t = fanCount === 1 ? 0 : (i / (fanCount - 1)) * 2 - 1; // -1..+1
      const angle = t * fanHalfAngle;
      const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();

      // Pick target: alternate between targets for split-target mode
      const target = targets.length > 0 ? targets[i % targets.length] : undefined;

      const proj = this.createProjectile(
        WeaponType.Standard,
        origin.clone(),
        boltDir,
        blasterConfig.damage,
        speed,
        5.0, // seeking bolts have shorter range than homing missiles
      );
      proj.homingBias = homingBias;
      proj.loopBackOnMiss = config.loopBack;
      if (target) {
        proj.targetIndex = target.index;
      }
      const pierceCount = this.getBlasterPierceCount();
      if (pierceCount > 0) {
        proj.canPierce = pierceCount;
        proj.pierceCount = 0;
      }
    }
  }

  /**
   * Fires AL sub-branch ring/scatter patterns as supplemental BulletPool bolts.
   * al_7: 12-bolt 360° ring
   * al_8/al_9: 360° ring + 5-bolt forward fan
   * al_10: two rings (15° offset) + 15-bolt forward fan
   */
  private fireALScatterRing(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    rotAxis: THREE.Vector3,
    active: Set<string>,
  ): void {
    const fireRing = (count: number, angularOffset: number = 0) => {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + angularOffset;
        const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();
        this.callbacks?.spawnBullet(origin.clone(), boltDir);
      }
    };

    const fireFan = (count: number, halfArcRad: number) => {
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const angle = t * halfArcRad;
        const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();
        this.callbacks?.spawnBullet(origin.clone(), boltDir);
      }
    };

    if (active.has('standard_al_10')) {
      // Omega scatter: dual-phase ring (two rings offset 15°) + 15-bolt fan
      fireRing(12, 0);
      fireRing(12, Math.PI / 12); // second ring rotated 15°
      fireFan(15, Math.PI / 6);   // 15 bolts in ±30° arc
    } else if (active.has('standard_al_9') || active.has('standard_al_8')) {
      // Bullet wall / Annihilator: 360° ring + 5-bolt forward fan
      fireRing(12, 0);
      fireFan(5, Math.PI / 12);   // 5 bolts in ±15° arc
    } else if (active.has('standard_al_7')) {
      // Ring shot: 12 bolts in full 360°
      fireRing(12, 0);
    }
  }

  /**
   * Fires AR sub-branch special bolts (Projectile objects, supplemental to base BulletPool bolts).
   * ar_6: bullets pierce 1 enemy
   * ar_7: slight homing bias (0.15)
   * ar_8: every 10th shot fires a high-damage full-pierce railgun bolt
   * ar_9/ar_10: handled via fire rate bonuses in getUpgradeFireRateMult
   */
  private fireARSpecialBolts(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    _rotAxis: THREE.Vector3,
    active: Set<string>,
  ): void {
    const blasterConfig = WEAPON_CONFIGS[WeaponType.Standard];
    const speedMult = active.has('standard_ar_10') ? 1.30 : 1.0;
    const speed = blasterConfig.projectileSpeed * speedMult;

    const proj = this.createProjectile(
      WeaponType.Standard,
      origin.clone(),
      direction.clone(),
      blasterConfig.damage,
      speed,
      5.0,
    );
    proj.isARBolt = true;
    proj.canPierce = 1;
    proj.pierceCount = 0;
    if (active.has('standard_ar_7') || active.has('standard_ar_8') ||
        active.has('standard_ar_9') || active.has('standard_ar_10')) {
      proj.homingBias = 0.15; // slight homing (note: isARBolt checked first in collision handler)
    }

    // AR_8 Railgun charge: every 10th shot fires a full-pierce high-damage bolt
    if (active.has('standard_ar_8') || active.has('standard_ar_9') || active.has('standard_ar_10')) {
      this.arShotCounter++;
      if (this.arShotCounter >= 10) {
        this.arShotCounter = 0;
        const railgunProj = this.createProjectile(
          WeaponType.Standard,
          origin.clone(),
          direction.clone(),
          blasterConfig.damage * 3.0, // 3× damage for railgun bolt
          blasterConfig.projectileSpeed * 1.5,
          8.0,
        );
        railgunProj.isARBolt = true;
        railgunProj.canPierce = 999; // pierces everything
        railgunProj.pierceCount = 0;
      }
    }
  }

  /**
   * Fires BR sub-branch devastation bolts (Projectile objects, supplemental to base BulletPool bolts).
   * br_6+: bolt explodes on impact (AoE splash)
   * br_9+: 5% chance for instant-kill
   * br_10: additional shockwave AoE
   */
  private fireBRDevastationBolts(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    rotAxis: THREE.Vector3,
    active: Set<string>,
  ): void {
    const blasterConfig = WEAPON_CONFIGS[WeaponType.Standard];
    // BR fires bolts matching the B-branch tight cluster angle
    const tightAngle = this.getBlasterBranchBConeAngle();
    const boltCount = this.getBlasterBranchBExtraBolts() + 1; // at least 1 bolt

    for (let i = 0; i < boltCount; i++) {
      const t = boltCount === 1 ? 0 : (i / (boltCount - 1)) * 2 - 1;
      const angle = t * (tightAngle / 2);
      const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();

      const proj = this.createProjectile(
        WeaponType.Standard,
        origin.clone(),
        boltDir,
        blasterConfig.damage,
        blasterConfig.projectileSpeed,
        5.0,
      );
      proj.isBRBolt = true;
    }
  }

  private fireSpread(origin: THREE.Vector3, direction: THREE.Vector3, surfaceNormal?: THREE.Vector3, isQueued = false): void {
    const config = WEAPON_CONFIGS[WeaponType.Spread];
    // LEVEL 5 FINAL FORM — Mega Fan: 9 pellets at 45° spread (vs normal 5 at 30°)
    const isL5 = this.isMasteryMaxLevel(WeaponType.Spread);
    const spreadNodes = this.activeUpgradeNodes(WeaponType.Spread);

    const spreadPattern = getSpreadUpgradePattern(spreadNodes);
    const bulletCount = isL5 ? 9 : spreadPattern.bulletCount;

    // Pierce upgrades (branch B nodes 4+5): pellets pass through enemies
    const piercePellets =
      spreadNodes.has('spread_bl_5') ? 2 :
      spreadNodes.has('spread_bl_4') ? 1 : 0;

    // Cone width upgrades (branch B): b_3 alternates, b_1 tightens, b_2 widens
    let spreadAngle: number;
    if (spreadNodes.has('spread_br_4') || spreadNodes.has('spread_br_5')) {
      spreadAngle = Math.PI / 36; // BR sniper spread: ultra-tight 5° cone
    } else if (isL5) {
      spreadAngle = Math.PI / 4; // L5 override
    } else if (spreadNodes.has('spread_b_3')) {
      // Adaptive cone: alternate tight/wide each shot
      this.spreadConeToggle = !this.spreadConeToggle;
      spreadAngle = this.spreadConeToggle ? Math.PI / 8 : Math.PI / 4; // 22.5° / 45°
    } else if (spreadNodes.has('spread_b_2')) {
      spreadAngle = Math.PI / 5; // +20% wider ≈ 36°
    } else if (spreadNodes.has('spread_b_1')) {
      spreadAngle = Math.PI / 7.5; // -15% tighter ≈ 24°
    } else {
      spreadAngle = spreadPattern.spreadAngle;
    }
    // Spread animation: pellets start aimed at center, fan out over 0.35-0.5s
    const spreadDuration = 0.35 + Math.random() * 0.15;

    // Use surface normal for rotation axis, fallback to world Y
    const rotationAxis = surfaceNormal ? surfaceNormal.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const centerDir = direction.clone().normalize();
    const centerIdx = Math.floor(bulletCount / 2); // 2 for 5 bullets, 4 for 9 bullets

    for (let i = 0; i < bulletCount; i++) {
      const targetAngle = (i - centerIdx) * (spreadAngle / (bulletCount - 1));
      const targetDir = direction.clone().applyAxisAngle(rotationAxis, targetAngle).normalize();

      // 30% chance per pellet to split mid-flight (not the center pellet)
      const willSplit = i !== centerIdx && Math.random() < 0.30;
      const splitTime = willSplit ? 0.3 + Math.random() * 0.4 : undefined;

      const proj = this.createProjectile(
        WeaponType.Spread,
        origin.clone(),
        centerDir.clone(), // All pellets start aimed at center
        config.damage,
        config.projectileSpeed,
        4.0,
      );
      // Attach spread animation metadata
      proj.spreadStartDir = centerDir.clone();
      proj.spreadEndDir = targetDir;
      proj.spreadDuration = spreadDuration;
      proj.canSplit = willSplit;
      proj.splitTime = splitTime;
      // Pierce: branch B nodes 4+5 allow pellets to pass through enemies
      if (piercePellets > 0) {
        proj.canPierce = piercePellets;
        proj.pierceCount = 0;
      }
    }

    // br_5 = railgun burst: 4 rapid shots (1 immediate + 3 queued at 50ms intervals)
    if (!isQueued && spreadNodes.has('spread_br_5')) {
      for (let i = 1; i <= 3; i++) {
        this.pendingShots.push({
          delay: i * 0.05,
          remaining: i * 0.05,
          type: WeaponType.Spread,
          origin: origin.clone(),
          direction: direction.clone(),
          surfaceNormal: surfaceNormal?.clone(),
        });
      }
    }
  }

  private firePiercing(origin: THREE.Vector3, direction: THREE.Vector3, isQueued = false): void {
    const config = WEAPON_CONFIGS[WeaponType.Piercing];
    const rangeMult = this.getBuffMultiplier(BuffType.ExtendedRange);
    const stackMult = this.getStackDamageMultiplier(WeaponType.Piercing);
    const masteryMult = this.masteryMultiplierFn?.(WeaponType.Piercing) ?? 1.0;
    const sessionMult = this.getSessionDamageMultiplier(WeaponType.Piercing);

    // Beam length upgrades (branch A): +50%, +100%, +200%, +300%, +500% per node
    // a_4 = arc beam (secondary arc to a 2nd target); a_5 = wrap-eligible (doubled max length)
    const piercingNodes = this.activeUpgradeNodes(WeaponType.Piercing);

    // br_4/br_5 = charged bolt: queue a 0.5s delayed mega-shot instead of firing immediately
    // br_4 alone: every shot is charged (returns early after queuing)
    // br_5 (requires br_4): every 5th shot is auto-charged, others fire normally
    if (!isQueued) {
      this.piercingShotCounter++;
      const isAutoCharge = piercingNodes.has('piercing_br_5') && this.piercingShotCounter % 5 === 0;
      const isAlwaysCharge = piercingNodes.has('piercing_br_4') && !piercingNodes.has('piercing_br_5');
      if (isAlwaysCharge || isAutoCharge) {
        this.pendingShots.push({
          delay: 0.5,
          remaining: 0.5,
          type: WeaponType.Piercing,
          origin: origin.clone(),
          direction: direction.clone(),
          isChargedShot: true,
        });
        if (isAlwaysCharge) return; // br_4 only: skip immediate fire
      }
    }

    // Read and reset charge multiplier (set by pendingShots dispatch for isChargedShot)
    const chargeMult = this.piercingChargeMultiplier;
    this.piercingChargeMultiplier = 1.0;
    const lengthBonus =
      (piercingNodes.has('piercing_a_1') ? 0.50 : 0) +
      (piercingNodes.has('piercing_a_2') ? 1.00 : 0) +
      (piercingNodes.has('piercing_a_3') ? 2.00 : 0);
    // a_5: beam so long it wraps — double the max length
    const wrapMult = piercingNodes.has('piercing_al_5') ? 2.0 : 1.0;
    const upgradeLengthMult = (1.0 + lengthBonus) * wrapMult;

    // Trace a geodesic beam path along the surface
    const beamLen = 25 * rangeMult * upgradeLengthMult;
    const beamPoints = this.traceBeamPath(origin, direction, beamLen, Math.ceil(36 * rangeMult * upgradeLengthMult));

    // Build a thick white beam visual
    const curve = new THREE.CatmullRomCurve3(beamPoints, false, 'catmullrom', 0.5);
    const tubeGeom = new THREE.TubeGeometry(curve, beamPoints.length * 2, 0.05, 6, false);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
    });
    const beamMesh = new THREE.Mesh(tubeGeom, beamMat);
    this.projectileRoot.add(beamMesh);

    // Instant damage to all enemies along the beam path
    if (this.callbacks) {
      const enemies = this.callbacks.getEnemies();
      const hitRadius = 0.4;

      // a_4 = arc beam: track the primary hit to arc to a secondary target
      let primaryHitPos: THREE.Vector3 | null = null;
      let primaryHitDir: THREE.Vector3 | null = null;

      for (const enemy of enemies) {
        if (!enemy.alive) continue;

        for (let s = 0; s < beamPoints.length - 1; s++) {
          const segDist = distanceToSegment(
            enemy.position, beamPoints[s], beamPoints[s + 1],
          );
          if (segDist < hitRadius) {
            this.callbacks.onEnemyDamage(enemy.index, config.damage * stackMult * masteryMult * sessionMult * chargeMult, WeaponType.Piercing);
            // Record hit location for arc beam
            if (!primaryHitPos) {
              primaryHitPos = enemy.position.clone();
              primaryHitDir = direction.clone().normalize();
            }
            break; // Only damage each enemy once
          }
        }
      }

      // a_4 = arc beam: after primary hit, arc to a 2nd enemy within 15° of beam direction
      if (piercingNodes.has('piercing_al_4') && primaryHitPos) {
        const arcAngleCos = Math.cos(Math.PI / 12); // 15°
        let arcTarget: { position: THREE.Vector3; index: number } | null = null;
        let arcMinDist = Infinity;
        for (const enemy of enemies) {
          if (!enemy.alive) continue;
          const toEnemy = enemy.position.clone().sub(primaryHitPos!);
          const dist = toEnemy.length();
          const dot = toEnemy.normalize().dot(primaryHitDir!);
          if (dot > arcAngleCos && dist < arcMinDist && dist > 0.1) {
            arcMinDist = dist;
            arcTarget = enemy;
          }
        }
        if (arcTarget) {
          // 50% damage for arc
          this.callbacks.onEnemyDamage(arcTarget.index, config.damage * stackMult * masteryMult * sessionMult * chargeMult * 0.5, WeaponType.Piercing);
        }
      }
    }

    // Brief flash effect (fades out over 0.25s)
    this.activeEffects.push({
      type: 'laser',
      position: origin.clone(),
      direction: direction.clone(),
      duration: 0.25,
      elapsed: 0,
      mesh: beamMesh,
      beamPoints,
    });

    // bl_4 = double tap / bl_5 = triple tap: queue extra shots (only on the INITIAL fire, not recursive)
    if (!isQueued) {
      if (piercingNodes.has('piercing_bl_5')) {
        this.pendingShots.push({ delay: 0.1, remaining: 0.1, type: WeaponType.Piercing, origin: origin.clone(), direction: direction.clone() });
        this.pendingShots.push({ delay: 0.2, remaining: 0.2, type: WeaponType.Piercing, origin: origin.clone(), direction: direction.clone() });
      } else if (piercingNodes.has('piercing_bl_4')) {
        this.pendingShots.push({ delay: 0.1, remaining: 0.1, type: WeaponType.Piercing, origin: origin.clone(), direction: direction.clone() });
      }

      // ar_4 = twin beams: fire a 2nd parallel beam with slight perpendicular offset
      // ar_5 = fan sweep: fire 3 beams in a 45° fan (-22.5°, 0°, +22.5°)
      const localUp = origin.clone().normalize();
      if (piercingNodes.has('piercing_ar_5')) {
        const left  = direction.clone().applyAxisAngle(localUp, -Math.PI / 8).normalize();
        const right = direction.clone().applyAxisAngle(localUp,  Math.PI / 8).normalize();
        this.firePiercing(origin, left,  true); // isQueued=true: no further multi-beam recursion
        this.firePiercing(origin, right, true);
      } else if (piercingNodes.has('piercing_ar_4')) {
        const perp = new THREE.Vector3().crossVectors(direction, localUp).normalize().multiplyScalar(0.3);
        this.firePiercing(origin.clone().add(perp), direction, true);
      }
    }
  }

  private fireChainLightning(origin: THREE.Vector3, direction: THREE.Vector3): void {
    if (!this.callbacks) return;

    const config = WEAPON_CONFIGS[WeaponType.ChainLightning];
    const enemies = this.callbacks.getEnemies()
      .filter(e => e.alive);

    if (enemies.length === 0) return;

    // Find first target in the aim direction
    const rayDir = direction.clone().normalize();
    let firstTarget: { position: THREE.Vector3; index: number } | null = null;
    let minScore = Infinity;

    for (const enemy of enemies) {
      const toEnemy = enemy.position.clone().sub(origin);
      const dist = toEnemy.length();
      const dot = toEnemy.normalize().dot(rayDir);

      // Prefer enemies in aim direction and close
      const score = dist * (2 - dot);
      if (dot > 0.5 && score < minScore) {
        minScore = score;
        firstTarget = enemy;
      }
    }

    if (!firstTarget) {
      // No valid target in aim direction, find closest
      let minDist = Infinity;
      for (const enemy of enemies) {
        const dist = enemy.position.distanceTo(origin);
        if (dist < minDist && dist < 10) {
          minDist = dist;
          firstTarget = enemy;
        }
      }
    }

    if (!firstTarget) return;

    // Find chain targets (virality upgrades: +2 per branch-A node, base 5)
    const chainNodes = this.activeUpgradeNodes(WeaponType.ChainLightning);
    const extraTargets =
      (chainNodes.has('chain_lightning_a_1') ? 2 : 0) +
      (chainNodes.has('chain_lightning_a_2') ? 2 : 0) +
      (chainNodes.has('chain_lightning_a_3') ? 2 : 0) +
      (chainNodes.has('chain_lightning_a_4') ? 7 : 0); // Mass hysteria: +7 chain targets

    // a_2/a_3/a_4 = chain jump range bonuses (+15%/+25%/+40% cumulative)
    const baseJumpRange = 3;
    const jumpRangeBonus =
      (chainNodes.has('chain_lightning_a_2') ? 0.15 : 0) +
      (chainNodes.has('chain_lightning_a_3') ? 0.25 : 0) +
      (chainNodes.has('chain_lightning_a_4') ? 0.40 : 0);
    const jumpRange = baseJumpRange * (1.0 + jumpRangeBonus);

    const otherEnemies = enemies.filter(e => e.index !== firstTarget!.index);
    const chainTargets = ChainLightningEffect.findChainTargets(
      firstTarget.position,
      otherEnemies,
      5 + extraTargets,
      jumpRange,
    );

    // Add first target at front
    chainTargets.unshift({
      position: firstTarget.position.clone(),
      damageMultiplier: 1.0,
      index: firstTarget.index,
    });

    // Fire the visual effect (apply stack multiplier + mastery multiplier + session multiplier + upgrade)
    const stackMult = this.getStackDamageMultiplier(WeaponType.ChainLightning);
    const masteryMult = this.masteryMultiplierFn?.(WeaponType.ChainLightning) ?? 1.0;
    const sessionMult = this.getSessionDamageMultiplier(WeaponType.ChainLightning);
    const upgradeDmgMult = this.getUpgradeDamageMult(WeaponType.ChainLightning);

    // b_5 = kill explosion: track enemies killed to trigger small AoE
    const killExplosion = chainNodes.has('chain_lightning_b_5');

    this.chainLightning.fire(origin, chainTargets, (pos, mult, idx) => {
      this.callbacks?.onEnemyDamage(idx, config.damage * mult * stackMult * masteryMult * sessionMult * upgradeDmgMult, WeaponType.ChainLightning);
      // b_5: small AoE explosion on kill (approximated — we don't get kill callbacks here,
      // so apply half-damage AoE on each hit; a true kill-only version requires onEnemyKill callback)
      if (killExplosion) {
        // TODO: upgrade to kill-only trigger if onEnemyKill callback is added
        this.applyAoeDamage(pos, 1.5, config.damage * 0.3 * stackMult * masteryMult * sessionMult * upgradeDmgMult);
      }
    });

    // a_5 = re-arc: after initial chain resolves, a second pass re-arcs to already-hit targets for 30% bonus
    if (chainNodes.has('chain_lightning_a_5') && chainTargets.length > 1) {
      // Re-arc to each target in reverse order at 30% damage
      for (const target of chainTargets) {
        this.callbacks?.onEnemyDamage(
          target.index,
          config.damage * 0.3 * target.damageMultiplier * stackMult * masteryMult * sessionMult * upgradeDmgMult,
          WeaponType.ChainLightning,
        );
      }
    }

    // b_4 = stun bolt: slow chain targets 30% for 1s
    if (chainNodes.has('chain_lightning_b_4') && this.callbacks?.onEnemySlow) {
      for (const target of chainTargets) {
        this.callbacks.onEnemySlow(target.index, 0.7, 1.0);
      }
    }
  }

  private fireHoming(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const config = WEAPON_CONFIGS[WeaponType.Homing];
    const enemies = this.callbacks?.getEnemies().filter(e => e.alive) ?? [];

    // Find target (nearest in general direction)
    let targetIndex: number | undefined;
    let minDist = Infinity;

    for (const enemy of enemies) {
      const toEnemy = enemy.position.clone().sub(origin);
      const dist = toEnemy.length();
      if (dist < minDist) {
        minDist = dist;
        targetIndex = enemy.index;
      }
    }

    // Speed upgrades (branch A): +25%, +50%, +80%, +100%, +150% per node
    // Nodes 4+5 also apply turn multiplier to make tracking tighter
    const homingNodes = this.activeUpgradeNodes(WeaponType.Homing);
    const speedBonus =
      (homingNodes.has('homing_a_1') ? 0.25 : 0) +
      (homingNodes.has('homing_a_2') ? 0.50 : 0) +
      (homingNodes.has('homing_a_3') ? 0.80 : 0) +
      (homingNodes.has('homing_a_4') ? 1.00 : 0) +
      (homingNodes.has('homing_a_5') ? 1.50 : 0) +
      // a_6 Ramjet: additional +200% speed (stacks with prior bonuses)
      (homingNodes.has('homing_a_6') ? 2.00 : 0);
    const upgradeSpeed = config.projectileSpeed * (1.0 + speedBonus);
    // a_3/a_4 = turn tightening: missiles track more aggressively
    const turnMult =
      homingNodes.has('homing_a_4') ? 3.0 :  // Very tight tracking
      homingNodes.has('homing_a_3') ? 2.0 : 1.0; // Tighter tracking
    // homing_b_5 = contact stun: TODO Wave 2 — needs slow/stun system

    // a_7–a_10: Railshot — instant beam hit(s) instead of projectile
    if (homingNodes.has('homing_a_7') || homingNodes.has('homing_a_8') ||
        homingNodes.has('homing_a_9') || homingNodes.has('homing_a_10')) {
      const stackMult = this.getStackDamageMultiplier(WeaponType.Homing);
      const masteryMult = this.masteryMultiplierFn?.(WeaponType.Homing) ?? 1.0;
      const sessionMult = this.getSessionDamageMultiplier(WeaponType.Homing);
      const railCount = homingNodes.has('homing_a_10') ? 6 :
                        homingNodes.has('homing_a_9')  ? 4 :
                        homingNodes.has('homing_a_8')  ? 2 : 1;
      const canPierce = homingNodes.has('homing_a_10');
      const localUp = origin.clone().normalize();
      const fanSpread = 0.08; // ~4.6° between rails
      const fanOffsets = [0, -fanSpread, fanSpread, -fanSpread * 2, fanSpread * 2, -fanSpread * 3];

      for (let r = 0; r < railCount; r++) {
        const railDir = direction.clone().applyAxisAngle(localUp, fanOffsets[r]).normalize();
        const beamPoints = this.traceBeamPath(origin, railDir, 40, 60);

        // Instant damage along beam
        if (this.callbacks) {
          let hitAny = false;
          for (const enemy of this.callbacks.getEnemies()) {
            if (!enemy.alive) continue;
            let hit = false;
            for (let s = 0; s < beamPoints.length - 1; s++) {
              const segDist = distanceToSegment(enemy.position, beamPoints[s], beamPoints[s + 1]);
              if (segDist < 0.4) {
                this.callbacks.onEnemyDamage(
                  enemy.index,
                  config.damage * stackMult * masteryMult * sessionMult,
                  WeaponType.Homing,
                );
                this.callbacks.onProjectileExplosion?.(enemy.position.clone(), WeaponType.Homing);
                hit = true;
                hitAny = true;
                break;
              }
            }
            if (hit && !canPierce) break; // non-pierce: stop at first enemy
          }
          if (!hitAny) {
            // No enemies hit — still show beam flash at max extent
            this.callbacks.onProjectileExplosion?.(beamPoints[beamPoints.length - 1].clone(), WeaponType.Homing);
          }
        }

        // Beam flash visual
        this.activeEffects.push({
          type: 'laser',
          position: origin.clone(),
          direction: railDir.clone(),
          duration: 0.15,
          elapsed: 0,
          beamPoints,
        });
      }
      return; // railshot: no projectile spawned
    }

    // Missiles persist until they hit something; 60s hard cap prevents infinite missiles
    // (e.g. if the last enemy dies before being reached).
    const MISSILE_MAX_AGE = 60.0;

    // LEVEL 5 FINAL FORM — Seeking Swarm: fire 3 missiles simultaneously in V-formation
    // Each missile tracks independently — spectacular when all 3 converge on one target
    if (this.isMasteryMaxLevel(WeaponType.Homing)) {
      const localUp = origin.clone().normalize(); // approximate surface normal
      const spreadAngle = Math.PI / 12; // 15 degrees
      for (let i = -1; i <= 1; i++) {
        const missileDir = direction.clone().applyAxisAngle(localUp, i * spreadAngle).normalize();
        const proj = this.createProjectile(
          WeaponType.Homing,
          origin.clone(),
          missileDir,
          config.damage,
          upgradeSpeed,
          MISSILE_MAX_AGE,
        );
        proj.targetIndex = targetIndex;
        if (turnMult > 1.0) proj.turnRateMult = turnMult;
        // b_8+ carpet bombing: missile splits into sub-munitions at 50% travel
        if (homingNodes.has('homing_b_8') || homingNodes.has('homing_b_9') || homingNodes.has('homing_b_10')) {
          proj.splitAt = 0.5;
        }
      }
    } else {
      const proj = this.createProjectile(
        WeaponType.Homing,
        origin.clone(),
        direction.clone(),
        config.damage,
        upgradeSpeed,
        MISSILE_MAX_AGE,
      );
      proj.targetIndex = targetIndex;
      if (turnMult > 1.0) proj.turnRateMult = turnMult;
      // b_8+ carpet bombing: missile splits into sub-munitions at 50% travel
      if (homingNodes.has('homing_b_8') || homingNodes.has('homing_b_9') || homingNodes.has('homing_b_10')) {
        proj.splitAt = 0.5;
      }
    }
  }

  private fireMortar(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const config = WEAPON_CONFIGS[WeaponType.PlasmaMortar];
    // Hard cap: 30s max travel time prevents infinite projectiles if no enemy is reachable.
    const MORTAR_MAX_TRAVEL = 30.0;

    // Find nearest enemy to target — mortar should travel TO an enemy, not past them.
    // Falls back to a fixed range of 10 if no enemies are alive.
    let targetPos: THREE.Vector3 | null = null;
    if (this.callbacks) {
      const enemies = this.callbacks.getEnemies().filter(e => e.alive);
      let minDist = Infinity;
      for (const enemy of enemies) {
        const dist = origin.distanceTo(enemy.position);
        if (dist < minDist) {
          minDist = dist;
          targetPos = enemy.position.clone();
        }
      }
    }

    // Compute end position and travel time
    let endPos: THREE.Vector3;
    let travelTime: number;
    if (targetPos) {
      endPos = targetPos;
      const dist = origin.distanceTo(endPos);
      travelTime = Math.min(dist / config.projectileSpeed, MORTAR_MAX_TRAVEL);
    } else {
      // No enemies: fire in aimed direction to default range
      const range = 10;
      endPos = origin.clone().add(direction.clone().multiplyScalar(range));
      travelTime = range / config.projectileSpeed;
    }

    const proj = this.createProjectile(
      WeaponType.PlasmaMortar,
      origin.clone(),
      direction.clone(),
      config.damage,
      config.projectileSpeed,
      travelTime,
    );
    proj.startPos = origin.clone();
    proj.endPos = endPos;
  }

  private fireGravityGun(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const config = WEAPON_CONFIGS[WeaponType.GravityGun];

    this.createProjectile(
      WeaponType.GravityGun,
      origin.clone(),
      direction.clone(),
      config.damage,
      config.projectileSpeed,
      5.0,
    );
  }

  private fireLaser(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const rangeMult = this.getBuffMultiplier(BuffType.ExtendedRange);

    // Trace beam path along the surface (or fallback to straight line)
    const beamLen = 30 * rangeMult;
    const beamPoints = this.traceBeamPath(origin, direction, beamLen, Math.ceil(45 * rangeMult));

    // Build a TubeGeometry from the traced points
    const curve = new THREE.CatmullRomCurve3(beamPoints, false, 'catmullrom', 0.5);
    const tubeGeom = new THREE.TubeGeometry(curve, beamPoints.length * 2, 0.025, 6, false);
    const laserMat = new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.LaserBeam].color,
      transparent: true,
      opacity: 0.85,
    });
    const laserMesh = new THREE.Mesh(tubeGeom, laserMat);

    this.projectileRoot.add(laserMesh);

    // Duration upgrades (branch B): +20%, +40%, +70%, +100%, +150% per node
    const laserNodes = this.activeUpgradeNodes(WeaponType.LaserBeam);
    const durationBonus =
      (laserNodes.has('laser_beam_b_1') ? 0.20 : 0) +
      (laserNodes.has('laser_beam_b_2') ? 0.40 : 0) +
      (laserNodes.has('laser_beam_b_3') ? 0.70 : 0) +
      (laserNodes.has('laser_beam_b_4') ? 1.00 : 0) + // Wide beam: +100% duration
      (laserNodes.has('laser_beam_b_5') ? 1.50 : 0);  // Sweep beam: +150% duration
    const laserDuration = 0.5 * (1.0 + durationBonus);

    // b_4 = wide beam: hits enemies within 0.3 units of beam line instead of 0.35
    const wideBeam = laserNodes.has('laser_beam_b_4');
    // b_5 = sweep mode: beam rotates ±0.4 rad/s while active
    const sweepMode = laserNodes.has('laser_beam_b_5');

    this.activeEffects.push({
      type: 'laser',
      position: origin.clone(),
      direction: direction.clone(),
      duration: laserDuration,
      elapsed: 0,
      mesh: laserMesh,
      beamPoints,
      wideBeam,
      sweepAngle: sweepMode ? 0 : undefined,
      sweepDir: sweepMode ? 1 : undefined,
    });
  }

  /**
   * Trace a beam path along the mesh surface starting from startPos
   * heading in the given direction. Each step projects onto the surface
   * and re-aligns the direction to stay tangent.
   */
  private traceBeamPath(
    startPos: THREE.Vector3,
    direction: THREE.Vector3,
    totalLength: number = 20,
    segments: number = 30,
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [startPos.clone()];
    let currentPos = startPos.clone();
    let currentDir = direction.clone().normalize();
    const stepSize = totalLength / segments;

    for (let i = 0; i < segments; i++) {
      // Step forward in current tangent direction
      const newPos = currentPos.clone().addScaledVector(currentDir, stepSize);

      if (this.meshSurface) {
        // Project onto the mesh surface
        const result = this.meshSurface.closestPointOnSurface(newPos);
        if (!result) break;

        // Update direction to remain tangent to the surface at the new point
        const normal = result.normal.clone().normalize();
        const dot = currentDir.dot(normal);
        currentDir = currentDir.clone().sub(normal.clone().multiplyScalar(dot));
        const dirLen = currentDir.length();
        if (dirLen < 0.0001) break;
        currentDir.multiplyScalar(1 / dirLen);

        currentPos = result.point.clone();
      } else {
        // Fallback: project onto sphere of radius equal to startPos length
        const radius = startPos.length();
        if (radius > 0.01) {
          newPos.normalize().multiplyScalar(radius);
        }
        // Re-tangentize direction to sphere
        const normal = newPos.clone().normalize();
        const dot = currentDir.dot(normal);
        currentDir = currentDir.clone().sub(normal.clone().multiplyScalar(dot));
        const dirLen = currentDir.length();
        if (dirLen < 0.0001) break;
        currentDir.multiplyScalar(1 / dirLen);

        currentPos = newPos.clone();
      }

      points.push(currentPos.clone());
    }

    // Need at least 2 points for a curve
    if (points.length < 2) {
      points.push(startPos.clone().addScaledVector(direction, 0.1));
    }

    return points;
  }

  private fireBlackHole(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const bhNodes = this.activeUpgradeNodes(WeaponType.BlackHole);
    const blackHoleConfig = this.createActiveBlackHoleConfig();

    // a_2/a_3 = extra shots: singularity pulse (+1 extra) / triple singularity (+2 extra)
    const extraShots = bhNodes.has('black_hole_a_3') ? 2 :
                       bhNodes.has('black_hole_a_2') ? 1 : 0;

    // al_4/al_5 = twin holes: fire a second bolt slightly offset.
    const twinBolts = bhNodes.has('black_hole_al_4') || bhNodes.has('black_hole_al_5') ? 1 : 0;
    const boltCount = 1 + extraShots + twinBolts;
    const normal = origin.lengthSq() > 0.0001 ? origin.clone().normalize() : new THREE.Vector3(0, 1, 0);
    let side = new THREE.Vector3().crossVectors(direction, normal);
    if (side.lengthSq() < 0.0001) {
      side = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
    }
    if (side.lengthSq() < 0.0001) {
      side.set(1, 0, 0);
    }
    side.normalize();

    for (let i = 0; i < boltCount; i++) {
      const offset = (i - (boltCount - 1) / 2) * 0.45;
      const boltOrigin = this.projectPointToWeaponSurface(origin.clone().addScaledVector(side, offset));
      this.createProjectile(
        WeaponType.BlackHole,
        boltOrigin,
        direction.clone(),
        0,
        blackHoleConfig.projectileSpeed,
        BLACK_HOLE_BOLT_MAX_AGE,
      );
    }
  }

  private createActiveBlackHoleConfig(): BlackHoleConfig & { projectileSpeed: number } {
    const activeNodes = this.activeUpgradeNodes(WeaponType.BlackHole);
    const masteryLevel5 = this.isMasteryMaxLevel(WeaponType.BlackHole);
    return {
      ...createBlackHoleConfig({ activeNodes, masteryLevel5 }),
      projectileSpeed: WEAPON_CONFIGS[WeaponType.BlackHole].projectileSpeed,
    };
  }

  private spawnBlackHoleEffect(position: THREE.Vector3): void {
    const blackHoleConfig = this.createActiveBlackHoleConfig();
    const isL5 = this.isMasteryMaxLevel(WeaponType.BlackHole);
    const point = this.projectPointToWeaponSurface(position);
    const normal = this.getWeaponSurfaceNormal(point);
    const visual = new BlackHoleVisual(point, normal);
    this.projectileRoot.add(visual.root);
    this.activeEffects.push({
      type: 'blackhole',
      position: point.clone(),
      duration: blackHoleConfig.duration,
      elapsed: 0,
      mesh: visual.root,
      isMasteryL5: isL5,
      isEternalCollapse: blackHoleConfig.isEternalCollapse,
      blackHoleConfig,
      blackHoleVisual: visual,
      blackHolePhase: 'formation',
      blackHoleRadius: 0,
      blackHoleAffectedCount: 0,
      collapseApplied: false,
    });
  }

  private projectPointToWeaponSurface(point: THREE.Vector3): THREE.Vector3 {
    if (this.meshSurface) {
      return this.meshSurface.closestPointOnSurface(point)?.point.clone() ?? point;
    }

    const radius = point.length();
    return radius > 0.01 ? point.clone().multiplyScalar(8 / radius) : point;
  }

  private getWeaponSurfaceNormal(point: THREE.Vector3): THREE.Vector3 {
    if (this.meshSurface) {
      return this.meshSurface.closestPointOnSurface(point)?.normal.clone().normalize()
        ?? point.clone().normalize();
    }
    return point.lengthSq() > 0.0001 ? point.clone().normalize() : new THREE.Vector3(0, 1, 0);
  }

  private fireTesla(origin: THREE.Vector3): void {
    // Tesla coil is an area effect around player (radius 3, stronger damage)
    const existing = this.activeEffects.find(effect => effect.type === 'tesla');
    if (existing) {
      existing.position.copy(origin);
      existing.elapsed = 0;
      if (existing.mesh) {
        existing.mesh.position.copy(origin);
      }
      return;
    }

    // Geometry shared via GeometryCache
    const teslaMat = new THREE.MeshBasicMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0.2,
      wireframe: true,
      depthTest: false,  // Don't use depth test so damage numbers render on top
    });
    const teslaMesh = new THREE.Mesh(SharedGeometries.teslaSphere(), teslaMat);
    teslaMesh.position.copy(origin);
    teslaMesh.renderOrder = 50;  // Render before damage numbers (which have renderOrder = 999)

    this.projectileRoot.add(teslaMesh);

    this.activeEffects.push({
      type: 'tesla',
      position: origin,
      duration: 8.0,
      elapsed: 0,
      mesh: teslaMesh,
    });
  }

  private removeTeslaEffects(): void {
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      if (effect.type !== 'tesla') continue;
      if (effect.mesh) {
        this.projectileRoot.remove(effect.mesh);
      }
      this.activeEffects.splice(i, 1);
    }
  }

  /**
   * Spawn two diverging child projectiles from a split spread pellet.
   * Children are orange, smaller, and cannot split again.
   */
  private spawnSplitChildren(parent: Projectile): void {
    // Approximate local surface normal from position (works for sphere, rough for others)
    const localNormal = parent.position.clone().normalize();
    const splitAngle = Math.PI / 6; // 30° each side

    for (let s = -1; s <= 1; s += 2) {
      const childDir = parent.direction.clone().applyAxisAngle(localNormal, s * splitAngle).normalize();
      const child = this.createProjectile(
        WeaponType.Spread,
        parent.position.clone(),
        childDir,
        parent.damage * 0.6,   // 60% of parent damage
        parent.speed * 1.2,    // slightly faster
        2.0,                   // shorter lifetime
      );
      child.isChild = true;

      // Apply orange visual to distinguish from parent pellets
      const mesh = this.projectileMeshes.get(child);
      if (mesh && this.childSpreadMaterial) {
        mesh.scale.setScalar(0.55);
        if (mesh instanceof THREE.Mesh) {
          mesh.material = this.childSpreadMaterial;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Projectile helpers
  // -------------------------------------------------------------------------

  private createProjectile(
    type: WeaponType,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number,
    speed: number,
    maxAge: number,
  ): Projectile {
    // Apply Extended Range buff + stack damage multiplier + mastery multiplier + session multiplier + upgrade
    const rangeMult = this.getBuffMultiplier(BuffType.ExtendedRange);
    const stackMult = this.getStackDamageMultiplier(type);
    const masteryMult = this.masteryMultiplierFn?.(type) ?? 1.0;
    const sessionMult = this.getSessionDamageMultiplier(type);
    const upgradeDmgMult = this.getUpgradeDamageMult(type);
    const proj: Projectile = {
      type,
      position,
      direction: direction.normalize(),
      age: 0,
      maxAge: maxAge * rangeMult,
      damage: damage * stackMult * masteryMult * sessionMult * upgradeDmgMult,
      speed,
    };

    this.projectiles.push(proj);

    // Create visual mesh
    const mesh = this.createProjectileMesh(type);
    mesh.position.copy(position);
    this.projectileRoot.add(mesh);
    this.projectileMeshes.set(proj, mesh);

    return proj;
  }

  private createProjectileMesh(type: WeaponType): THREE.Object3D {
    const material = this.projectileMaterials.get(type);

    // Geometries are shared via GeometryCache — no allocation per projectile.
    switch (type) {
      case WeaponType.Standard:
        // Seeking bolts: use small sphere (similar to spread pellets) in yellow-gold color
        return new THREE.Mesh(SharedGeometries.spreadProjectile(), material);

      case WeaponType.Spread:
        return new THREE.Mesh(SharedGeometries.spreadProjectile(), material);

      case WeaponType.Homing:
        return new THREE.Mesh(SharedGeometries.homingProjectile(), material);

      case WeaponType.PlasmaMortar:
        return new THREE.Mesh(SharedGeometries.plasmaProjectile(), material);

      case WeaponType.GravityGun:
        return new THREE.Mesh(SharedGeometries.gravityProjectile(), material);

      case WeaponType.BlackHole: {
        const bolt = new THREE.Group();
        bolt.name = 'BlackHoleBolt';
        const core = new THREE.Mesh(SharedGeometries.blackholeSphere(), material);
        core.scale.setScalar(0.58);
        const halo = new THREE.Mesh(
          SharedGeometries.gravityProjectile(),
          this.blackHoleBoltHaloMaterial ?? material,
        );
        halo.scale.setScalar(1.35);
        halo.renderOrder = 25;
        bolt.add(core, halo);
        return bolt;
      }

      default:
        return new THREE.Mesh(
          SharedGeometries.defaultProjectile(),
          material ?? new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
    }
  }

  private updateProjectile(proj: Projectile, dt: number): void {
    switch (proj.type) {
      case WeaponType.Homing:
        this.updateHomingProjectile(proj, dt);
        break;

      case WeaponType.PlasmaMortar:
        // Arc trajectory - high, dramatic arc for a heavy mortar round
        if (proj.startPos && proj.endPos) {
          const t = proj.age / proj.maxAge;
          proj.position.lerpVectors(proj.startPos, proj.endPos, t);
          // Add arc height along surface normal
          if (this.meshSurface) {
            const midResult = this.meshSurface.closestPointOnSurface(proj.position);
            if (midResult) {
              const arcHeight = Math.sin(t * Math.PI) * 2.5;
              proj.position.copy(midResult.point).addScaledVector(midResult.normal, arcHeight);
            }
          } else {
            // Fallback: use world Y
            proj.position.y += Math.sin(t * Math.PI) * 2.5;
          }
        }
        break;

      case WeaponType.Standard:
        // Seeking blaster bolts (BL sub-branch): apply homing if homingBias is set
        if (proj.homingBias && proj.homingBias > 0 && this.callbacks) {
          const enemies = this.callbacks.getEnemies();
          let nearestEnemy: { position: THREE.Vector3; index: number } | null = null;

          // Prefer the locked target; fall back to nearest alive enemy
          if (proj.targetIndex !== undefined) {
            const locked = enemies.find(e => e.index === proj.targetIndex && e.alive);
            if (locked) {
              nearestEnemy = locked;
            }
          }
          if (!nearestEnemy) {
            let nearestDist = Infinity;
            for (const e of enemies) {
              if (!e.alive) continue;
              const d = proj.position.distanceTo(e.position);
              if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
            }
            if (nearestEnemy) proj.targetIndex = nearestEnemy.index;
          }

          if (nearestEnemy) {
            const toTarget = nearestEnemy.position.clone().sub(proj.position).normalize();
            const turnRate = Math.min(proj.homingBias, 8.0 * dt * proj.homingBias);
            proj.direction.lerp(toTarget, turnRate).normalize();
          }
        }
        // Linear movement
        proj.position.add(proj.direction.clone().multiplyScalar(proj.speed * dt));
        break;

      default:
        // Spread animation: smoothly rotate to final angle over spreadDuration seconds
        if (proj.spreadEndDir !== undefined && proj.spreadDuration !== undefined && proj.spreadStartDir !== undefined) {
          const t = Math.min(proj.age / proj.spreadDuration, 1.0);
          if (t < 1.0) {
            proj.direction.lerpVectors(proj.spreadStartDir, proj.spreadEndDir, t).normalize();
          } else {
            proj.direction.copy(proj.spreadEndDir).normalize();
          }
        }
        // Linear movement
        proj.position.add(proj.direction.clone().multiplyScalar(proj.speed * dt));
        break;
    }

    // Project onto surface using MeshSurface BVH, fallback to sphere
    if (this.meshSurface) {
      const result = this.meshSurface.closestPointOnSurface(proj.position);
      if (result) {
        proj.position.copy(result.point);
        // Re-tangentize direction to stay on surface
        const normal = result.normal.clone().normalize();
        const dot = proj.direction.dot(normal);
        proj.direction.sub(normal.clone().multiplyScalar(dot));
        const dirLen = proj.direction.length();
        if (dirLen > 0.0001) {
          proj.direction.multiplyScalar(1 / dirLen);
        }
      }
    } else {
      // Fallback: project onto sphere (radius 8)
      const dist = proj.position.length();
      if (dist > 0.01) {
        proj.position.multiplyScalar(8 / dist);
        // Re-tangentize direction
        const normal = proj.position.clone().normalize();
        const dot = proj.direction.dot(normal);
        proj.direction.sub(normal.clone().multiplyScalar(dot));
        const dirLen = proj.direction.length();
        if (dirLen > 0.0001) {
          proj.direction.multiplyScalar(1 / dirLen);
        }
      }
    }
  }

  private updateHomingProjectile(proj: Projectile, dt: number): void {
    if (this.callbacks) {
      const enemies = this.callbacks.getEnemies();

      // Re-target nearest alive enemy to the PROJECTILE each frame
      let nearestDist = Infinity;
      let nearestEnemy: { position: THREE.Vector3; index: number } | null = null;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        // s44r6-04: Use min of on-surface and visual distance (Mobius normal divergence)
        const onSurfaceDist = proj.position.distanceTo(enemy.position);
        const visualDist = enemy.meshPosition ? proj.position.distanceTo(enemy.meshPosition) : onSurfaceDist;
        const dist = Math.min(onSurfaceDist, visualDist);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = enemy;
        }
      }

      if (nearestEnemy) {
        proj.targetIndex = nearestEnemy.index;
        const toTarget = nearestEnemy.position.clone().sub(proj.position).normalize();
        const baseTurnRate = 12.0 * (proj.turnRateMult ?? 1.0);
        const turnRate = Math.min(1.0, baseTurnRate * dt);
        proj.direction.lerp(toTarget, turnRate).normalize();
      }
    }

    proj.position.add(proj.direction.clone().multiplyScalar(proj.speed * dt));

    const homingNodesUpdate = this.activeUpgradeNodes(WeaponType.Homing);

    // a_6 Ramjet: near-miss explosion — if missile passes within 0.35 units of an enemy
    // without actually hitting (hit radius is 0.3 in checkProjectileCollisions)
    if (homingNodesUpdate.has('homing_a_6') && this.callbacks) {
      const nearMissRadius = 0.35;
      const hitRadius = 0.3;
      for (const enemy of this.callbacks.getEnemies()) {
        if (!enemy.alive) continue;
        const d = proj.position.distanceTo(enemy.position);
        if (d < nearMissRadius && d >= hitRadius) {
          this.applyAoeDamage(proj.position, 2.0, proj.damage * 0.5);
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.Homing);
          proj.age = proj.maxAge + 1; // expire missile after near-miss trigger
          break;
        }
      }
    }

    // b_8+ carpet bombing: split into 3 child missiles at 50% of max travel time
    if (proj.splitAt !== undefined && !proj.hasSplit && proj.age >= proj.splitAt * proj.maxAge) {
      proj.hasSplit = true;
      const isDevastator = homingNodesUpdate.has('homing_b_9') || homingNodesUpdate.has('homing_b_10');
      const localUp = proj.position.clone().normalize();
      const miniAngles = [-Math.PI / 8, 0, Math.PI / 8]; // 3 spread directions ~22.5°
      const config = WEAPON_CONFIGS[WeaponType.Homing];
      for (const angle of miniAngles) {
        const miniDir = proj.direction.clone().applyAxisAngle(localUp, angle).normalize();
        const child = this.createProjectile(
          WeaponType.Homing,
          proj.position.clone(),
          miniDir,
          config.damage * 0.6, // sub-munitions deal 60% damage each
          proj.speed * 1.2,
          15.0,
        );
        child.targetIndex = proj.targetIndex;
        if (isDevastator) child.isDevastatorChild = true;
      }
      proj.age = proj.maxAge + 1; // expire parent after split
    }
  }

  private checkProjectileCollisions(proj: Projectile, index: number): void {
    if (!this.callbacks) return;

    const enemies = this.callbacks.getEnemies();
    const hitRadius = 0.3;

    // Enemies with maxHealth at or above this threshold are considered "strong targets"
    // (bosses, titans, etc.) that can absorb multiple simultaneous missile hits.
    // Below this threshold, only the first missile to hit detonates; others retarget.
    const MISSILE_BOSS_THRESHOLD = 15;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      // s44r6-04: Use min of on-surface and visual distance (Mobius normal divergence)
      const onSurfaceDist = proj.position.distanceTo(enemy.position);
      const visualDist = enemy.meshPosition ? proj.position.distanceTo(enemy.meshPosition) : onSurfaceDist;
      const dist = Math.min(onSurfaceDist, visualDist);

      if (proj.type === WeaponType.BlackHole) {
        const start = proj.previousPosition ?? proj.position;
        const end = proj.position;
        const surfaceImpact = closestPointOnSegment(enemy.position, start, end);
        const surfaceHitDistance = enemy.position.distanceTo(surfaceImpact);
        const visualImpact = enemy.meshPosition
          ? closestPointOnSegment(enemy.meshPosition, start, end)
          : surfaceImpact;
        const visualHitDistance = enemy.meshPosition
          ? enemy.meshPosition.distanceTo(visualImpact)
          : surfaceHitDistance;
        const hitDistance = Math.min(surfaceHitDistance, visualHitDistance);
        if (hitDistance < BLACK_HOLE_BOLT_HIT_RADIUS) {
          this.spawnBlackHoleEffect(surfaceHitDistance <= visualHitDistance ? surfaceImpact : visualImpact);
          this.removeProjectile(index);
          return;
        }
        continue;
      }

      if (dist < hitRadius) {
        // Homing missile deduplication: if another missile already hit this (weak) enemy
        // this frame, retarget instead of detonating. Strong enemies (bosses, titans)
        // skip this check and accept multiple hits simultaneously.
        if (proj.type === WeaponType.Homing) {
          const isBoss = (enemy.maxHealth ?? 0) >= MISSILE_BOSS_THRESHOLD;
          if (!isBoss && this.missileHitThisFrame.has(enemy.index)) {
            // Target already struck this frame — retarget to a different enemy
            proj.targetIndex = undefined; // force re-acquisition next frame
            return; // skip detonation, missile keeps flying
          }
        }

        this.callbacks.onEnemyDamage(enemy.index, proj.damage, proj.type);

        if (proj.type === WeaponType.PlasmaMortar) {
          // AoE radius upgrades (branch A): +30%, +60%, +100%
          const mortarNodes = this.activeUpgradeNodes(WeaponType.PlasmaMortar);
          const mortarRadiusBonus =
            (mortarNodes.has('plasma_mortar_a_1') ? 0.30 : 0) +
            (mortarNodes.has('plasma_mortar_a_2') ? 0.60 : 0) +
            (mortarNodes.has('plasma_mortar_a_3') ? 1.00 : 0);
          const blastRadius = 3.0 * (1.0 + mortarRadiusBonus);
          // b_5 = annihilator: instant-kill enemies below 20% HP in the blast radius
          if (mortarNodes.has('plasma_mortar_b_5')) {
            const blastEnemies = this.callbacks.getEnemies().filter(e => e.alive);
            for (const e of blastEnemies) {
              const eDist = proj.position.distanceTo(e.position);
              if (eDist < blastRadius) {
                const currentHp = e.health ?? e.maxHealth ?? Infinity;
                const maxHp = e.maxHealth ?? currentHp;
                if (currentHp < maxHp * 0.20) {
                  this.callbacks.onEnemyDamage(e.index, 999, WeaponType.PlasmaMortar);
                }
              }
            }
          }
          // AoE blast (b_5 gets +100% damage bonus on top of instant-kill)
          const annihilatorMult = mortarNodes.has('plasma_mortar_b_5') ? 2.0 : 1.0;
          this.applyAoeDamage(proj.position, blastRadius, proj.damage * 0.75 * annihilatorMult);
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.PlasmaMortar);

          // a_4 = chain blast: 0.3s after main explosion, secondary blast at 50% radius
          if (mortarNodes.has('plasma_mortar_a_4') || mortarNodes.has('plasma_mortar_a_5')) {
            this.pendingShots.push({
              delay: 0.3,
              remaining: 0.3,
              type: WeaponType.PlasmaMortar,
              origin: proj.position.clone(),
              direction: proj.direction.clone(),
              isChainBlast: true,
              chainBlastRadius: blastRadius * 0.5,
              chainBlastDamage: proj.damage * 0.4,
            });
          }

          // a_5 = carpet bomb: queue 2 additional mortars offset from player origin
          // NOTE: We don't have player origin here, so we use the mortar's start position
          // and fan the extra shots at ±15° from original direction
          if (mortarNodes.has('plasma_mortar_a_5') && proj.startPos) {
            const localUp = proj.startPos.clone().normalize();
            const angles = [-Math.PI / 12, Math.PI / 12]; // ±15°
            for (const ang of angles) {
              const fanDir = proj.direction.clone().applyAxisAngle(localUp, ang).normalize();
              this.pendingShots.push({
                delay: 0.05,
                remaining: 0.05,
                type: WeaponType.PlasmaMortar,
                origin: proj.startPos.clone(),
                direction: fanDir,
              });
            }
          }

          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.Homing) {
          // Mark this enemy as hit this frame — other missiles targeting same enemy
          // will retarget to a different target (unless the enemy is a boss).
          this.missileHitThisFrame.add(enemy.index);

          // b_9 devastator child missiles: trigger nova burst only, skip full warhead chain
          if (proj.isDevastatorChild) {
            const homingNodesDev = this.activeUpgradeNodes(WeaponType.Homing);
            const radiusBonusDev =
              (homingNodesDev.has('homing_b_1') ? 0.30 : 0) +
              (homingNodesDev.has('homing_b_2') ? 0.60 : 0);
            this.applyAoeDamage(proj.position, 3.5 * (1.0 + radiusBonusDev), proj.damage * 0.8);
            this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.Homing);
            this.removeProjectile(index);
            return;
          }

          // Explosion radius upgrades (branch B): +30%, +60%
          const homingNodes = this.activeUpgradeNodes(WeaponType.Homing);
          const homingRadiusBonus =
            (homingNodes.has('homing_b_1') ? 0.30 : 0) +
            (homingNodes.has('homing_b_2') ? 0.60 : 0);
          // b_5 = nova burst: combines explosion + napalm + stun; bigger radius than base
          const novaRadiusMult = homingNodes.has('homing_b_5') || homingNodes.has('homing_b_6') ||
            homingNodes.has('homing_b_7') || homingNodes.has('homing_b_8') ||
            homingNodes.has('homing_b_9') || homingNodes.has('homing_b_10') ? 1.5 : 1.0;
          this.applyAoeDamage(proj.position, 3.5 * (1.0 + homingRadiusBonus) * novaRadiusMult, proj.damage * 0.8);
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.Homing);

          // b_3 = cluster bomb: spawn 3 mini-missiles on detonation
          if (homingNodes.has('homing_b_3')) {
            const miniConfig = WEAPON_CONFIGS[WeaponType.Homing];
            const localUp = proj.position.clone().normalize();
            const miniAngles = [-Math.PI / 6, 0, Math.PI / 6]; // 3 directions
            for (const angle of miniAngles) {
              const miniDir = proj.direction.clone().applyAxisAngle(localUp, angle).normalize();
              const mini = this.createProjectile(
                WeaponType.Homing,
                proj.position.clone(),
                miniDir,
                miniConfig.damage * 0.5,  // 50% damage for mini-missiles
                proj.speed * 1.1,
                8.0,
              );
              mini.targetIndex = proj.targetIndex; // track same target
            }
          }

          // b_4/b_5 = napalm / nova burst: standard gas cloud
          // b_7+ upgrades the cloud to larger radius/duration (handled below) — skip standard cloud
          if ((homingNodes.has('homing_b_4') || homingNodes.has('homing_b_5')) &&
              !homingNodes.has('homing_b_7') && !homingNodes.has('homing_b_8') &&
              !homingNodes.has('homing_b_9') && !homingNodes.has('homing_b_10')) {
            this.spawnGasCloud(proj.position.clone());
          }

          // b_5 = nova burst stun: full stun for 0.5s to enemies in nova radius
          if (homingNodes.has('homing_b_5') && this.callbacks?.onEnemySlow) {
            const stunRadius = 3.5 * (1.0 + homingRadiusBonus) * novaRadiusMult;
            const allEnemies = this.callbacks.getEnemies();
            for (const e of allEnemies) {
              if (!e.alive) continue;
              if (e.position.distanceTo(proj.position) < stunRadius) {
                this.callbacks.onEnemySlow(e.index, 0.0, 0.5);
              }
            }
          }

          // b_6 Thermobaric: secondary explosion 0.5s after primary
          if (homingNodes.has('homing_b_6') || homingNodes.has('homing_b_7') ||
              homingNodes.has('homing_b_8') || homingNodes.has('homing_b_9') ||
              homingNodes.has('homing_b_10')) {
            const secondaryRadius = 3.5 * (1.0 + homingRadiusBonus) * novaRadiusMult;
            this.pendingShots.push({
              delay: 0.5,
              remaining: 0.5,
              type: WeaponType.Homing,
              origin: proj.position.clone(),
              direction: proj.direction.clone(),
              isChainBlast: true,
              chainBlastRadius: secondaryRadius,
              chainBlastDamage: proj.damage * 0.6,
            });
          }

          // b_7 Fuel-air bomb: double-size long-duration gas cloud
          if (homingNodes.has('homing_b_7') || homingNodes.has('homing_b_8') ||
              homingNodes.has('homing_b_9') || homingNodes.has('homing_b_10')) {
            this.spawnGasCloud(proj.position.clone(), GAS_CLOUD_RADIUS * 2, GAS_CLOUD_DURATION);
          }

          // b_10 Armageddon: screen-wide shockwave on first missile hit this wave
          if (homingNodes.has('homing_b_10') && !this.armageddonFiredThisWave) {
            this.armageddonFiredThisWave = true;
            this.applyAoeDamage(proj.position, 28.0, proj.damage * 0.4);
            this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.Homing);
          }

          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.GravityGun) {
          // Pull enemies together
          this.applyGravityPull(proj.position, 2.0);
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.GravityGun);
          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.Standard && proj.isARBolt) {
          // AR rapid-fire bolt hit — check pierce
          if (proj.canPierce !== undefined && proj.pierceCount !== undefined && proj.pierceCount < proj.canPierce) {
            proj.pierceCount++;
            return; // pass through enemy, continue checking next
          }
          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.Standard && proj.isBRBolt) {
          // BR devastation bolt hit — trigger explosion AoE
          const brActive = this.activeUpgradeNodes(WeaponType.Standard);
          const aoeRadius = brActive.has('standard_br_10') ? 2.5 :
                            brActive.has('standard_br_7')  ? 2.2 : 2.0;
          this.applyAoeDamage(proj.position, aoeRadius, proj.damage * 0.5);
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.Standard);
          // Death bolt (br_9+): 5% chance instant-kill via massive bonus damage
          if ((brActive.has('standard_br_9') || brActive.has('standard_br_10')) && Math.random() < 0.05) {
            this.callbacks.onEnemyDamage(enemy.index, 9999, WeaponType.Standard);
          }
          // Annihilator shockwave (br_10): additional AoE
          if (brActive.has('standard_br_10')) {
            this.applyAoeDamage(proj.position, 3.0, proj.damage * 0.3);
          }
          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.Standard && proj.homingBias) {
          // Seeking blaster bolt (BL sub-branch) hit an enemy
          // bl_9 (Guided cluster): spawn a secondary seeker on impact
          if (this.upgradeTracker?.getActiveUpgrades(WeaponType.Standard).has('standard_bl_9')) {
            const localUp = proj.position.clone().normalize();
            const seekerDir = proj.direction.clone().applyAxisAngle(localUp, (Math.random() - 0.5) * 0.5).normalize();
            const seeker = this.createProjectile(
              WeaponType.Standard,
              proj.position.clone(),
              seekerDir,
              proj.damage * 0.5, // secondary seeker deals half damage
              proj.speed,
              3.0,
            );
            seeker.homingBias = proj.homingBias;
          }
          this.removeProjectile(index);
          return;
        } else {
          // Check pierce mechanic (Spread pellets with spread_bl_4/bl_5 active)
          if (proj.canPierce !== undefined && proj.pierceCount !== undefined && proj.pierceCount < proj.canPierce) {
            // Pellet passes through — increment pierce count but don't remove
            proj.pierceCount++;
            return; // Done with this enemy; continue checking others for this projectile
          }
          // ar_4/ar_5 = explosive pellets: AoE splash on impact
          if (proj.type === WeaponType.Spread) {
            const spreadHitNodes = this.activeUpgradeNodes(WeaponType.Spread);
            if (spreadHitNodes.has('spread_ar_5')) {
              // Nova burst: larger shockwave per pellet
              this.applyAoeDamage(proj.position, 2.5, proj.damage * 1.0);
              this.callbacks?.onProjectileExplosion?.(proj.position.clone(), WeaponType.Spread);
            } else if (spreadHitNodes.has('spread_ar_4')) {
              // Explosive pellets: small AoE splash on impact
              this.applyAoeDamage(proj.position, 1.5, proj.damage * 0.6);
              this.callbacks?.onProjectileExplosion?.(proj.position.clone(), WeaponType.Spread);
            }
          }
          this.removeProjectile(index);
          return;
        }
      }
    }
  }

  private applyAoeDamage(center: THREE.Vector3, radius: number, damage: number): void {
    if (!this.callbacks) return;

    const enemies = this.callbacks.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      // s44r6-04: Use min of on-surface and visual distance (Mobius normal divergence)
      const onSurfaceDist = center.distanceTo(enemy.position);
      const visualDist = enemy.meshPosition ? center.distanceTo(enemy.meshPosition) : onSurfaceDist;
      const dist = Math.min(onSurfaceDist, visualDist);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        this.callbacks.onEnemyDamage(enemy.index, damage * falloff, WeaponType.PlasmaMortar);
      }
    }
  }

  private applyGravityPull(center: THREE.Vector3, baseRadius: number, continuousPull: boolean = false): void {
    if (!this.callbacks?.onEnemyPull) return;

    // Pull radius upgrades (branch A): +30%, +60%, +100%
    // a_4 = mass capture: +100% radius on top of existing bonuses
    const ggNodes = this.activeUpgradeNodes(WeaponType.GravityGun);
    const radiusBonus =
      (ggNodes.has('gravity_gun_a_1') ? 0.30 : 0) +
      (ggNodes.has('gravity_gun_a_2') ? 0.60 : 0) +
      (ggNodes.has('gravity_gun_a_3') ? 1.00 : 0) +
      (ggNodes.has('gravity_gun_a_4') ? 1.00 : 0) +  // mass capture: +100% radius
      (ggNodes.has('gravity_gun_a_5') ? 1.50 : 0);   // event gravity: +150% radius
    const radius = baseRadius * (1.0 + radiusBonus);

    // Kinetic crush damage per detonation (branch B) — extended for b_4/b_5
    // Continuous pull mode skips kinetic damage (damage only on detonation impact)
    const kineticDamage = continuousPull ? 0 :
      ggNodes.has('gravity_gun_b_5') ? 20.0 :
      ggNodes.has('gravity_gun_b_4') ? 15.0 :
      ggNodes.has('gravity_gun_b_3') ? 9.0 :
      ggNodes.has('gravity_gun_b_2') ? 5.0 :
      ggNodes.has('gravity_gun_b_1') ? 2.0 : 0;

    const enemies = this.callbacks.getEnemies();
    const pulledPositions: THREE.Vector3[] = [];
    // a_4 = mass capture: focused singularity — cap at 8 enemies for concentrated effect
    const maxPulledEnemies = ggNodes.has('gravity_gun_a_4') ? 8 : Infinity;
    let pulledCount = 0;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (pulledCount >= maxPulledEnemies) break;

      // s44r6-04: Use min of on-surface and visual distance (Mobius normal divergence)
      const onSurfaceDist = center.distanceTo(enemy.position);
      const visualDist = enemy.meshPosition ? center.distanceTo(enemy.meshPosition) : onSurfaceDist;
      const dist = Math.min(onSurfaceDist, visualDist);
      if (dist < radius) {
        // Continuous in-flight pull uses 50% max strength (same as Black Hole per-frame pull).
        // On-impact detonation uses full 100% strength.
        const baseStrength = Math.pow(1 - dist / radius, 0.5);
        const strength = continuousPull ? baseStrength * 0.5 : baseStrength;
        this.callbacks.onEnemyPull(enemy.index, strength, center);
        // Kinetic crush: deal instant damage when pulled (detonation only)
        if (kineticDamage > 0) {
          this.callbacks.onEnemyDamage(enemy.index, kineticDamage * strength, WeaponType.GravityGun);
          // b_5 = field-kill explosion: approximate trigger when dealing max kinetic damage
          // (strength near 1.0 = enemy is very close to center = likely kill zone)
          // TODO: use onEnemyKill callback for precise kill-only trigger (Wave 2)
          if (ggNodes.has('gravity_gun_b_5') && strength > 0.7) {
            this.applyAoeDamage(enemy.position, 1.5, kineticDamage * 0.4);
          }
        }
        pulledPositions.push(enemy.position.clone());
        pulledCount++;
      }
    }

    // a_5 = event gravity: enemies pulled together deal collision damage to each other
    // Check enemies within 1.0 units of each other in the pulled set
    if (ggNodes.has('gravity_gun_a_5') && pulledPositions.length >= 2) {
      const collidingEnemies = this.callbacks.getEnemies().filter(e => e.alive && center.distanceTo(e.position) < radius);
      for (let i = 0; i < collidingEnemies.length; i++) {
        for (let j = i + 1; j < collidingEnemies.length; j++) {
          const dist = collidingEnemies[i].position.distanceTo(collidingEnemies[j].position);
          if (dist < 1.0) {
            // b_4/b_5 = kinetic annihilator: 3x collision damage
            const collisionDmg = (ggNodes.has('gravity_gun_b_4') || ggNodes.has('gravity_gun_b_5')) ? 6 : 2;
            this.callbacks.onEnemyDamage(collidingEnemies[i].index, collisionDmg, WeaponType.GravityGun);
            this.callbacks.onEnemyDamage(collidingEnemies[j].index, collisionDmg, WeaponType.GravityGun);
          }
        }
      }
    }
  }

  private applyBlackHoleBoltPull(proj: Projectile, dt: number): void {
    if (!this.callbacks?.onBlackHolePull) return;

    const config = this.createActiveBlackHoleConfig();
    const pullRadius = Math.max(
      BLACK_HOLE_BOLT_MIN_PULL_RADIUS,
      Math.min(BLACK_HOLE_BOLT_MAX_PULL_RADIUS, config.maxRadius * BLACK_HOLE_BOLT_PULL_RADIUS_FACTOR),
    );
    const start = proj.previousPosition ?? proj.position;
    const end = proj.position;
    const targets = this.callbacks.getEnemies()
      .filter((enemy) => enemy.alive)
      .map((enemy) => {
        const surfaceCenter = closestPointOnSegment(enemy.position, start, end);
        const surfaceDistance = enemy.position.distanceTo(surfaceCenter);
        if (!enemy.meshPosition) {
          return { enemy, center: surfaceCenter, distance: surfaceDistance };
        }
        const visualCenter = closestPointOnSegment(enemy.meshPosition, start, end);
        const visualDistance = enemy.meshPosition.distanceTo(visualCenter);
        return visualDistance < surfaceDistance
          ? { enemy, center: visualCenter, distance: visualDistance }
          : { enemy, center: surfaceCenter, distance: surfaceDistance };
      })
      .filter((target) => target.distance < pullRadius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, config.captureLimit);

    for (const { enemy, center, distance } of targets) {
      const pullSpeed = getBlackHolePullSpeed(
        distance,
        pullRadius,
        config.maxPullSpeed * BLACK_HOLE_BOLT_PULL_SPEED_FACTOR,
      );
      if (pullSpeed <= 0) continue;
      this.callbacks.onBlackHolePull(
        enemy.index,
        pullSpeed,
        center,
        dt,
        config.spiralRatio * 0.5,
        enemy.targetId,
      );
    }
  }

  private updateBlackHole(effect: ActiveEffect, dt: number): void {
    const config = effect.blackHoleConfig;
    if (!config || !this.callbacks) return;

    let state = getBlackHoleState(effect.elapsed, config, effect.duration);
    const targets = this.callbacks.getEnemies()
      .filter((enemy) => enemy.alive)
      .map((enemy) => {
        const surfaceDistance = effect.position.distanceTo(enemy.position);
        const visualDistance = enemy.meshPosition
          ? effect.position.distanceTo(enemy.meshPosition)
          : surfaceDistance;
        return { enemy, distance: Math.min(surfaceDistance, visualDistance) };
      })
      .filter((target) => target.distance < state.radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, config.captureLimit);

    const previousElapsed = Math.max(0, effect.elapsed - dt);
    const damageTicks = getBlackHoleDamageTickCount(
      previousElapsed,
      effect.elapsed,
      config,
      effect.duration,
    );
    const damageMultiplier = (this.masteryMultiplierFn?.(WeaponType.BlackHole) ?? 1)
      * this.getSessionDamageMultiplier(WeaponType.BlackHole);

    for (const { enemy, distance } of targets) {
      const pullSpeed = getBlackHolePullSpeed(distance, state.radius, config.maxPullSpeed) * state.pullScale;
      if (pullSpeed > 0) {
        this.callbacks.onBlackHolePull?.(
          enemy.index,
          pullSpeed,
          effect.position,
          dt,
          config.spiralRatio,
          enemy.targetId,
        );
      }
      if (damageTicks > 0) {
        this.callbacks.onEnemyDamage(
          enemy.index,
          config.damagePerSecond * config.damageCadence * damageTicks * damageMultiplier,
          WeaponType.BlackHole,
          enemy.targetId,
        );
      }
    }

    const activeNodes = this.activeUpgradeNodes(WeaponType.BlackHole);
    if (activeNodes.has('black_hole_bl_5')) {
      for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
          if (targets[i].enemy.position.distanceTo(targets[j].enemy.position) >= 1) continue;
          this.callbacks.onEnemyDamage(
            targets[i].enemy.index,
            2 * dt,
            WeaponType.BlackHole,
            targets[i].enemy.targetId,
          );
          this.callbacks.onEnemyDamage(
            targets[j].enemy.index,
            2 * dt,
            WeaponType.BlackHole,
            targets[j].enemy.targetId,
          );
        }
      }
    }

    if (
      config.isEternalCollapse &&
      effect.elapsed > 2 &&
      targets.length === 0 &&
      effect.blackHoleCollapseDeadline === undefined
    ) {
      effect.blackHoleCollapseDeadline = effect.elapsed + config.collapseDuration;
      effect.duration = effect.blackHoleCollapseDeadline;
      state = getBlackHoleState(effect.elapsed, config, effect.duration);
    }

    effect.blackHolePhase = state.phase;
    effect.blackHoleRadius = state.radius;
    effect.blackHoleAffectedCount = targets.length;
    effect.blackHoleVisual?.update(state, effect.elapsed, targets.map(({ enemy }) => enemy.position));
  }

  private completeBlackHole(effect: ActiveEffect): void {
    if (effect.collapseApplied) return;
    effect.collapseApplied = true;

    const config = effect.blackHoleConfig;
    if (config && this.callbacks) {
      const targets = this.callbacks.getEnemies()
        .filter((enemy) => enemy.alive)
        .map((enemy) => ({ enemy, distance: effect.position.distanceTo(enemy.position) }))
        .filter((target) => target.distance < config.collapseRadius)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, config.captureLimit);
      const damageMultiplier = (this.masteryMultiplierFn?.(WeaponType.BlackHole) ?? 1)
        * this.getSessionDamageMultiplier(WeaponType.BlackHole);
      for (const { enemy } of targets) {
        this.callbacks.onEnemyDamage(
          enemy.index,
          config.collapseDamage * damageMultiplier,
          WeaponType.BlackHole,
          enemy.targetId,
        );
      }
    }
    this.callbacks?.onProjectileExplosion?.(effect.position.clone(), WeaponType.BlackHole);
  }

  private updateEffect(effect: ActiveEffect, dt: number): void {
    const progress = effect.elapsed / effect.duration;

    switch (effect.type) {
      case 'laser':
        // b_5 = sweep mode: rotate beam direction by ±0.4 rad/s, bouncing at ±15° (0.26 rad)
        if (effect.sweepAngle !== undefined && effect.sweepDir !== undefined && effect.direction) {
          const sweepRate = 0.4; // rad/s
          const maxSweep = Math.PI / 12; // 15°
          effect.sweepAngle += sweepRate * effect.sweepDir * dt;
          if (Math.abs(effect.sweepAngle) >= maxSweep) {
            effect.sweepDir = -effect.sweepDir;
            effect.sweepAngle = Math.sign(effect.sweepAngle) * maxSweep;
          }
          // Re-trace beam with swept direction each frame for accurate hit detection
          if (this.meshSurface) {
            const localUp = effect.position.clone().normalize();
            const sweptDir = effect.direction.clone().applyAxisAngle(localUp, effect.sweepAngle).normalize();
            const rangeMult = this.getBuffMultiplier(BuffType.ExtendedRange);
            const laserNodesNow = this.activeUpgradeNodes(WeaponType.LaserBeam);
            const dBon =
              (laserNodesNow.has('laser_beam_b_1') ? 0.20 : 0) +
              (laserNodesNow.has('laser_beam_b_2') ? 0.40 : 0) +
              (laserNodesNow.has('laser_beam_b_3') ? 0.70 : 0);
            const sweptLen = 30 * rangeMult * (1.0 + dBon);
            effect.beamPoints = this.traceBeamPath(effect.position, sweptDir, sweptLen, Math.ceil(45 * rangeMult));
          }
        }

        // Continuous damage along surface-following beam polyline
        if (this.callbacks && effect.beamPoints && effect.beamPoints.length >= 2) {
          const enemies = this.callbacks.getEnemies();
          // b_4 = wide beam: 0.5 unit cylinder; default 0.35
          const hitRadius = effect.wideBeam ? 0.5 : 0.35;

          for (const enemy of enemies) {
            if (!enemy.alive) continue;

            // Check distance to each segment of the beam polyline
            let minDist = Infinity;
            for (let s = 0; s < effect.beamPoints.length - 1; s++) {
              const segDist = distanceToSegment(
                enemy.position, effect.beamPoints[s], effect.beamPoints[s + 1],
              );
              if (segDist < minDist) minDist = segDist;
              // Early exit if already within hit radius
              if (minDist < hitRadius) break;
            }

            if (minDist < hitRadius) {
              const laserMasteryMult = this.masteryMultiplierFn?.(WeaponType.LaserBeam) ?? 1.0;
              const laserSessionMult = this.getSessionDamageMultiplier(WeaponType.LaserBeam);
              const laserUpgradeMult = this.getUpgradeDamageMult(WeaponType.LaserBeam);
              // Ramp factor: starts at 25% damage, reaches 100% at full ramp
              const rampFactor = 0.25 + 0.75 * this.laserRampProgress;
              this.callbacks.onEnemyDamage(enemy.index, 2 * dt * rampFactor * laserMasteryMult * laserSessionMult * laserUpgradeMult, WeaponType.LaserBeam);
            }
          }
        }

        // Fade out the beam over its duration
        if (effect.mesh && effect.mesh instanceof THREE.Mesh) {
          const mat = effect.mesh.material;
          if (mat instanceof THREE.MeshBasicMaterial) {
            mat.opacity = 0.85 * (1 - progress);
          }
        }
        break;

      case 'blackhole':
        this.updateBlackHole(effect, dt);
        break;

      case 'tesla':
        // Damage all nearby enemies (radius 3, 3x damage)
        if (this.callbacks) {
          // Follow player position
          if (this.playerPositionRef) {
            effect.position.copy(this.playerPositionRef);
            if (effect.mesh) {
              effect.mesh.position.copy(this.playerPositionRef);
            }
          }

          // Radius upgrades (branch A): +25%, +50%, +80%
          // a_4 = arc reach: +20% bonus radius for a secondary arc ring
          // a_5 = tempest: +120% additive radius
          const teslaNodes = this.activeUpgradeNodes(WeaponType.TeslaCoil);
          const teslaRadiusBonus =
            (teslaNodes.has('tesla_coil_a_1') ? 0.25 : 0) +
            (teslaNodes.has('tesla_coil_a_2') ? 0.50 : 0) +
            (teslaNodes.has('tesla_coil_a_3') ? 0.80 : 0) +
            (teslaNodes.has('tesla_coil_a_5') ? 1.20 : 0); // tempest: +120% radius
          const radius = 3 * (1.0 + teslaRadiusBonus);
          // Arc reach: secondary ring extends 20% beyond the main field
          const arcRadius = teslaNodes.has('tesla_coil_a_4') ? radius * 1.20 : 0;

          const enemies = this.callbacks.getEnemies();
          const teslaMasteryMult = this.masteryMultiplierFn?.(WeaponType.TeslaCoil) ?? 1.0;
          const teslaSessionMult = this.getSessionDamageMultiplier(WeaponType.TeslaCoil);
          const teslaUpgradeDmgMult = this.getUpgradeDamageMult(WeaponType.TeslaCoil);

          // b_4 = rapid tick: effectively doubles DPS by applying 2× dt per update tick
          // b_5 = surge overload: stun (TODO: no slow system) + already handled via damage mult
          const rapidTickMult = teslaNodes.has('tesla_coil_b_4') || teslaNodes.has('tesla_coil_b_5') ? 2.0 : 1.0;

          for (const enemy of enemies) {
            if (!enemy.alive) continue;

            // s44r6-04: Use the minimum of on-surface distance and visual (mesh)
            // distance. On non-orientable surfaces (Mobius), the normal-based mesh
            // elevation can push enemies to unexpected positions, making one metric
            // inaccurate while the other remains correct.
            const onSurfaceDist = effect.position.distanceTo(enemy.position);
            const visualDist = enemy.meshPosition
              ? effect.position.distanceTo(enemy.meshPosition)
              : onSurfaceDist;
            const dist = Math.min(onSurfaceDist, visualDist);
            if (dist < radius) {
              this.callbacks.onEnemyDamage(enemy.index, 3 * dt * rapidTickMult * teslaMasteryMult * teslaSessionMult * teslaUpgradeDmgMult, WeaponType.TeslaCoil);
            } else if (arcRadius > 0 && dist < arcRadius) {
              // a_4 arc reach: 50% damage to outlying enemies in extended ring
              this.callbacks.onEnemyDamage(enemy.index, 3 * dt * 0.5 * teslaMasteryMult * teslaSessionMult * teslaUpgradeDmgMult, WeaponType.TeslaCoil);
            }
          }

          // b_5 = surge overload: stun enemies in the tesla field for 0.3s each frame
          if (teslaNodes.has('tesla_coil_b_5') && this.callbacks?.onEnemySlow) {
            for (const enemy of enemies) {
              if (!enemy.alive) continue;
              const onSurfaceDist = effect.position.distanceTo(enemy.position);
              const visualDist = enemy.meshPosition
                ? effect.position.distanceTo(enemy.meshPosition)
                : onSurfaceDist;
              if (Math.min(onSurfaceDist, visualDist) < radius) {
                this.callbacks.onEnemySlow(enemy.index, 0.0, 0.3);
              }
            }
          }

          if (effect.mesh) {
            effect.mesh.rotation.x += dt;
            effect.mesh.rotation.y += dt * 0.7;
          }
        }
        break;
    }
  }

  private spawnGasCloud(position: THREE.Vector3, radius = GAS_CLOUD_RADIUS, duration = GAS_CLOUD_DURATION): void {
    const cloudMat = new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.Homing].color,
      transparent: true,
      opacity: 0.25,
    });
    const cloudMesh = new THREE.Mesh(SharedGeometries.blackholeSphere(), cloudMat);
    cloudMesh.scale.setScalar(radius);
    cloudMesh.position.copy(position);
    this.projectileRoot.add(cloudMesh);

    this.gasClouds.push({
      position: position.clone(),
      elapsed: 0,
      duration,
      tickTimer: 0,
      mesh: cloudMesh,
    });
  }

  private removeProjectile(index: number): void {
    const proj = this.projectiles[index];
    const mesh = this.projectileMeshes.get(proj);

    if (mesh) {
      this.projectileRoot.remove(mesh);
      if (mesh instanceof THREE.Mesh) {
        mesh.geometry.dispose();
      }
      this.projectileMeshes.delete(proj);
    }

    this.projectiles.splice(index, 1);
  }

  /**
   * Clear all projectiles and effects
   */
  clear(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }

    for (const effect of this.activeEffects) {
      if (effect.type === 'blackhole') {
        effect.blackHoleVisual?.dispose();
      } else if (effect.mesh) {
        this.projectileRoot.remove(effect.mesh);
      }
    }
    this.activeEffects = [];

    for (const cloud of this.gasClouds) {
      this.projectileRoot.remove(cloud.mesh);
    }
    this.gasClouds = [];
    this.pendingShots = [];
    this.armageddonFiredThisWave = false;

    this.chainLightning.clear();
  }

  // -------------------------------------------------------------------------
  // Buff system
  // -------------------------------------------------------------------------

  /**
   * Apply a buff to the weapon system
   */
  applyBuff(type: BuffType): void {
    const config = BUFF_CONFIGS[type];

    // Replace existing buff of same type (reset duration)
    const existing = this.activeBuffs.find(b => b.type === type);
    if (existing) {
      existing.remaining = config.duration;
      existing.multiplier = config.multiplier;
      return;
    }

    this.activeBuffs.push({
      type,
      remaining: config.duration,
      multiplier: config.multiplier,
    });
  }

  /**
   * Check if a specific buff is active
   */
  hasBuff(type: BuffType): boolean {
    return this.activeBuffs.some(b => b.type === type);
  }

  /**
   * Get the multiplier for a buff type (1.0 if not active)
   */
  getBuffMultiplier(type: BuffType): number {
    const buff = this.activeBuffs.find(b => b.type === type);
    return buff ? buff.multiplier : 1.0;
  }

  /**
   * Get all active buffs (for HUD display)
   */
  getActiveBuffs(): readonly ActiveBuff[] {
    return this.activeBuffs;
  }

  /**
   * Get the stack level for the current weapon (1-5).
   * Each additional pickup of the same weapon adds +1 stack.
   */
  getStackLevel(type?: WeaponType): number {
    return this.stacks.get(type ?? this.currentWeapon) ?? 1;
  }

  /**
   * Get the damage multiplier from weapon stacking.
   * Each stack adds +25% damage (stack 1 = 1.0x, stack 5 = 2.0x).
   */
  getStackDamageMultiplier(type?: WeaponType): number {
    const stack = this.getStackLevel(type);
    return 1 + (stack - 1) * 0.25;
  }

  // -------------------------------------------------------------------------
  // Session pickup level
  // -------------------------------------------------------------------------

  /**
   * How many times this weapon has been picked up this session (0 if never).
   * Uncapped and NOT reset when ammo depletes.
   */
  getSessionLevel(type: WeaponType): number {
    return this.sessionPickupCounts.get(type) ?? 0;
  }

  /**
   * All weapons that have been picked up at least once this session.
   * Returns a snapshot Map — safe to iterate without holding a reference.
   */
  getSessionLevels(): Map<WeaponType, number> {
    return new Map(this.sessionPickupCounts);
  }

  /**
   * Session damage multiplier for the given weapon type.
   * Level 1 = 1.0 (no bonus). Each additional pickup adds SESSION_LEVEL_BONUSES[type].damagePerLevel.
   * Formula: 1.0 + (level - 1) * damagePerLevel
   */
  getSessionDamageMultiplier(type: WeaponType): number {
    const level = this.getSessionLevel(type);
    if (level <= 1) return 1.0;
    return 1.0 + (level - 1) * SESSION_LEVEL_BONUSES[type].damagePerLevel;
  }

  /**
   * Clear all session pickup counts. Call on game restart (new session).
   * NOTE: In most cases the WeaponManager is fully reconstructed on restart,
   * so this is mainly useful for explicit resets within a session.
   */
  resetSession(): void {
    this.sessionPickupCounts.clear();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    this.chainLightning.dispose();

    for (const mat of this.projectileMaterials.values()) {
      mat.dispose();
    }
    this.childSpreadMaterial?.dispose();
    this.childSpreadMaterial = null;
    this.blackHoleBoltHaloMaterial?.dispose();
    this.blackHoleBoltHaloMaterial = null;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Compute the shortest distance from point P to the line segment A-B.
 * Uses clamped projection onto the segment.
 */
function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  return p.distanceTo(closestPointOnSegment(p, a, b));
}

function closestPointOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const ab = b.clone().sub(a);
  const ap = p.clone().sub(a);
  const abLenSq = ab.lengthSq();

  // Degenerate segment (A === B)
  if (abLenSq < 0.000001) return a.clone();

  // Project AP onto AB, clamped to [0, 1]
  const t = Math.max(0, Math.min(1, ap.dot(ab) / abLenSq));

  // Closest point on segment
  return a.clone().addScaledVector(ab, t);
}
