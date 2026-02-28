import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS, getWeaponColor } from './WeaponTypes';
import { ChainLightningEffect } from '../effects/ChainLightning';
import { MeshSurface } from '../surfaces/MeshSurface';
import { BuffType, BUFF_CONFIGS, ActiveBuff } from './BuffPickup';
import { SharedGeometries } from '../rendering/GeometryCache';
import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';

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

/**
 * Projectile data for non-instant weapons
 */
export interface Projectile {
  type: WeaponType;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  age: number;
  maxAge: number;
  damage: number;
  speed: number;
  // For homing
  targetIndex?: number;
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
}

/**
 * Callback types for weapon system
 */
export interface WeaponCallbacks {
  getEnemies: () => { position: THREE.Vector3; index: number; alive: boolean }[];
  onEnemyDamage: (index: number, damage: number, weaponType: WeaponType) => void;
  onEnemyPull?: (index: number, pullStrength: number, pullCenter: THREE.Vector3) => void;
  spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => void;
  /** Called when a projectile detonates (homing, mortar, etc.) for weapon-specific VFX */
  onProjectileExplosion?: (position: THREE.Vector3, weaponType: WeaponType) => void;
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

  // Active gas clouds (Homing branch B node 3)
  private gasClouds: GasCloudInstance[] = [];

  // Spread cone alternation state (for spread_b_3)
  private spreadConeToggle = false;

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
        // Branch A nodes 1-3 are damage bonuses; 4+5 switch to fan-out (handled via getBlasterExtraBolts)
        if (active.has('standard_a_1')) bonus += 0.20;
        if (active.has('standard_a_2')) bonus += 0.40;
        if (active.has('standard_a_3')) bonus += 0.60;
        break;
      case WeaponType.ChainLightning:
        if (active.has('chain_lightning_b_1')) bonus += 0.25;
        if (active.has('chain_lightning_b_2')) bonus += 0.50;
        if (active.has('chain_lightning_b_3')) bonus += 0.80;
        // b_4 = stun (separate effect), b_5 = kill explosion (separate effect)
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
  private getUpgradeFireRateMult(weaponType: WeaponType): number {
    if (!this.upgradeTracker) return 1.0;
    const active = this.upgradeTracker.getActiveUpgrades(weaponType);
    let bonus = 0;
    if (weaponType === WeaponType.Standard) {
      if (active.has('standard_b_1')) bonus += 0.15;
      if (active.has('standard_b_2')) bonus += 0.30;
      if (active.has('standard_b_3')) bonus += 0.50;
      // standard_b_4/b_5 = homing on bolts (handled via getBlasterHomingStrength), no fire rate change
    } else if (weaponType === WeaponType.Piercing) {
      if (active.has('piercing_b_1')) bonus += 0.20;
      if (active.has('piercing_b_2')) bonus += 0.40;
      if (active.has('piercing_b_3')) bonus += 0.60;
      // piercing_bl_4/bl_5 = double/triple tap: fire rate unchanged, extra shots queued on fire
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
   * 0 = only the standard 2 parallel bolts; 6 = 7 total in a fan.
   */
  getBlasterExtraBolts(): number {
    if (!this.upgradeTracker) return 0;
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    if (active.has('standard_a_5')) return 6;  // 7 total
    if (active.has('standard_a_4')) return 4;  // 5 total
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
    if (active.has('standard_a_5')) return Math.PI / 4.5; // 40° fan
    if (active.has('standard_a_4')) return Math.PI / 7.2; // 25°
    if (active.has('standard_a_3')) return Math.PI / 12;  // 15°
    if (active.has('standard_a_2')) return Math.PI / 18;  // 10°
    if (active.has('standard_a_1')) return Math.PI / 36;  // 5°
    return 0;
  }

  /**
   * Returns whether blaster bolts have homing bias (Branch B nodes 4+5).
   * 0 = no homing; 0.8 = strong homing.
   * The caller lerps bullet direction toward nearest enemy each frame by this factor.
   */
  getBlasterHomingStrength(): number {
    if (!this.upgradeTracker) return 0;
    const active = this.upgradeTracker.getActiveUpgrades(WeaponType.Standard);
    if (active.has('standard_b_5')) return 0.8;  // strong homing
    if (active.has('standard_b_4')) return 0.4;  // mild homing
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
  }

  /**
   * Get current weapon type
   */
  getCurrentWeapon(): WeaponType {
    return this.currentWeapon;
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
  update(dt: number): void {
    // Tick down active buffs
    for (let i = this.activeBuffs.length - 1; i >= 0; i--) {
      this.activeBuffs[i].remaining -= dt;
      if (this.activeBuffs[i].remaining <= 0) {
        this.activeBuffs.splice(i, 1);
      }
    }

    // Update chain lightning effects
    this.chainLightning.update(dt);

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.age += dt;

      if (proj.age >= proj.maxAge) {
        // GravityGun that reaches max age hit the surface (not an enemy)
        if (proj.type === WeaponType.GravityGun) {
          this.callbacks?.onProjectileExplosion?.(proj.position.clone(), WeaponType.GravityGun);
        }
        this.removeProjectile(i);
        continue;
      }

      // Update position based on type
      this.updateProjectile(proj, dt);

      // Update mesh position
      const mesh = this.projectileMeshes.get(proj);
      if (mesh) {
        mesh.position.copy(proj.position);
      }

      // Check for spread pellet split (spawns child projectiles mid-flight)
      if (proj.canSplit && proj.splitTime !== undefined && proj.age >= proj.splitTime) {
        this.spawnSplitChildren(proj);
        proj.canSplit = false;
      }

      // Check collisions
      this.checkProjectileCollisions(proj, i);
    }

    // Update gas clouds (Homing branch B node 3)
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
          this.firePiercing(pending.origin, pending.direction, true); // isQueued=true: no further queuing
        } else if (pending.type === WeaponType.PlasmaMortar) {
          this.fireMortar(pending.origin, pending.direction);
        }
        this.pendingShots.splice(i, 1);
      }
    }

    // Update active effects
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.elapsed += dt;

      if (effect.elapsed >= effect.duration) {
        if (effect.mesh) {
          this.projectileRoot.remove(effect.mesh);
        }
        // LEVEL 5 FINAL FORM — Black Hole Event Horizon: massive AoE explosion on expiry
        if (effect.type === 'blackhole' && effect.isMasteryL5) {
          this.applyAoeDamage(effect.position, 8.0, 150);
          this.callbacks?.onProjectileExplosion?.(effect.position.clone(), WeaponType.BlackHole);
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
    // Dual-barrel setup: fire 2 bullets slightly offset perpendicular to aim direction
    const up = surfaceNormal?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(direction, up).normalize();
    const offset = 0.15;

    const leftOrigin = origin.clone().addScaledVector(right, -offset);
    const rightOrigin = origin.clone().addScaledVector(right, offset);

    // Branch A fan-out: standard_a_1 through standard_a_5 add extra bolts in a spreading cone
    const extraBolts = this.getBlasterExtraBolts();
    const fanAngle = this.getBlasterSpreadAngle();
    const rotAxis = up.clone();

    if (extraBolts > 0 && fanAngle > 0) {
      // Fan mode: fire the center bolt + extraBolts side bolts spread across ±fanAngle/2
      // The standard 2 parallel bolts are replaced by the fan for cleaner visuals
      const totalBolts = extraBolts + 1; // center + sides
      for (let i = 0; i < totalBolts; i++) {
        const t = totalBolts === 1 ? 0 : (i / (totalBolts - 1)) * 2 - 1; // -1 to +1
        const angle = t * (fanAngle / 2);
        const boltDir = direction.clone().applyAxisAngle(rotAxis, angle).normalize();
        this.callbacks?.spawnBullet(origin.clone(), boltDir);
      }
    } else {
      // Default: dual-barrel (no branch A upgrades)
      this.callbacks?.spawnBullet(leftOrigin, direction);
      this.callbacks?.spawnBullet(rightOrigin, direction);
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
  }

  private fireSpread(origin: THREE.Vector3, direction: THREE.Vector3, surfaceNormal?: THREE.Vector3): void {
    const config = WEAPON_CONFIGS[WeaponType.Spread];
    // LEVEL 5 FINAL FORM — Mega Fan: 9 pellets at 45° spread (vs normal 5 at 30°)
    const isL5 = this.isMasteryMaxLevel(WeaponType.Spread);
    const spreadNodes = this.activeUpgradeNodes(WeaponType.Spread);

    // Pellet count upgrades (branch A): base 5, +1 per node 1-3, then +4 and +5 for nodes 4 and 5
    const upgradePellets =
      (spreadNodes.has('spread_a_1') ? 1 : 0) +
      (spreadNodes.has('spread_a_2') ? 1 : 0) +
      (spreadNodes.has('spread_a_3') ? 1 : 0) +
      (spreadNodes.has('spread_al_4') ? 4 : 0) +  // +4 more (9 total with nodes 1-3)
      (spreadNodes.has('spread_al_5') ? 5 : 0);   // +5 more (10 total with nodes 1-3)
    const bulletCount = isL5 ? 9 : 5 + upgradePellets;

    // Pierce upgrades (branch B nodes 4+5): pellets pass through enemies
    const piercePellets =
      spreadNodes.has('spread_bl_5') ? 2 :
      spreadNodes.has('spread_bl_4') ? 1 : 0;

    // Cone width upgrades (branch B): b_3 alternates, b_1 tightens, b_2 widens
    let spreadAngle: number;
    if (isL5) {
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
      spreadAngle = Math.PI / 6; // base 30°
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
            this.callbacks.onEnemyDamage(enemy.index, config.damage * stackMult * masteryMult * sessionMult, WeaponType.Piercing);
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
          this.callbacks.onEnemyDamage(arcTarget.index, config.damage * stackMult * masteryMult * sessionMult * 0.5, WeaponType.Piercing);
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
      (chainNodes.has('chain_lightning_a_3') ? 2 : 0);

    // a_4 = +40% chain jump range
    const baseJumpRange = 3;
    const jumpRange = chainNodes.has('chain_lightning_a_4') ? baseJumpRange * 1.4 : baseJumpRange;

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

    // b_4 = stun: TODO — no slow/stun system exists yet. Stub for future implementation.
    // When a slow system is added: apply 30% speed reduction for 1s to all chain targets.
    // if (chainNodes.has('chain_lightning_b_4')) { applyStun(chainTargets, 0.3, 1.0); }
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
      (homingNodes.has('homing_a_5') ? 1.50 : 0);
    const upgradeSpeed = config.projectileSpeed * (1.0 + speedBonus);
    // turnMult increases how aggressively the missile steers toward its target
    // Applied in updateProjectile via a per-projectile field (stored in speed for now,
    // since Projectile doesn't have a separate turnRate field — the turn logic in
    // updateProjectile uses a fixed lerp rate of min(1.0, 12.0 * dt)).
    // For nodes 4+5, we scale the base speed higher so effectively missiles arrive faster;
    // the actual turn tightening would require a dedicated turnRate field (future enhancement).
    // TODO: add turnRate field to Projectile for proper turn tightening.

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
          20.0,
        );
        proj.targetIndex = targetIndex;
      }
    } else {
      const proj = this.createProjectile(
        WeaponType.Homing,
        origin.clone(),
        direction.clone(),
        config.damage,
        upgradeSpeed,
        20.0,
      );
      proj.targetIndex = targetIndex;
    }
  }

  private fireMortar(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const config = WEAPON_CONFIGS[WeaponType.PlasmaMortar];
    const range = 10;

    const proj = this.createProjectile(
      WeaponType.PlasmaMortar,
      origin.clone(),
      direction.clone(),
      config.damage,
      config.projectileSpeed,
      range / config.projectileSpeed,
    );
    proj.startPos = origin.clone();
    proj.endPos = origin.clone().add(direction.clone().multiplyScalar(range));
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

    // Duration upgrades (branch B): +20%, +40%, +70% per node
    const laserNodes = this.activeUpgradeNodes(WeaponType.LaserBeam);
    const durationBonus =
      (laserNodes.has('laser_beam_b_1') ? 0.20 : 0) +
      (laserNodes.has('laser_beam_b_2') ? 0.40 : 0) +
      (laserNodes.has('laser_beam_b_3') ? 0.70 : 0);
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
    const config = WEAPON_CONFIGS[WeaponType.BlackHole];
    let targetPos = origin.clone().add(direction.clone().multiplyScalar(4));

    // Project onto surface
    if (this.meshSurface) {
      const result = this.meshSurface.closestPointOnSurface(targetPos);
      if (result) {
        targetPos = result.point;
      }
    } else {
      // Fallback: project onto sphere
      const radius = origin.length();
      if (radius > 0.01) {
        targetPos.normalize().multiplyScalar(radius);
      }
    }

    // Duration upgrades (branch A): +30%, +60%, +100% per node
    // a_4 = twin holes (2 black holes), a_5 = doomsday (2 holes + +150% duration)
    const bhNodes = this.activeUpgradeNodes(WeaponType.BlackHole);
    const bhDurationBonus =
      (bhNodes.has('black_hole_a_1') ? 0.30 : 0) +
      (bhNodes.has('black_hole_a_2') ? 0.60 : 0) +
      (bhNodes.has('black_hole_a_3') ? 1.00 : 0) +
      (bhNodes.has('black_hole_al_5') ? 1.50 : 0); // doomsday extra duration

    // LEVEL 5 FINAL FORM — Event Horizon: 50% longer duration, stronger pull, AoE explosion on expiry
    const isL5 = this.isMasteryMaxLevel(WeaponType.BlackHole);
    const duration = (isL5 ? 4.5 : 3.0) * (1.0 + bhDurationBonus);

    // Helper to spawn one black hole at a position
    const spawnOneBlackHole = (pos: THREE.Vector3): void => {
      const bhMat = new THREE.MeshBasicMaterial({
        color: isL5 ? 0x110022 : 0x220044, // darker core at L5
        transparent: true,
        opacity: 0.9,
      });
      const bhMesh = new THREE.Mesh(SharedGeometries.blackholeSphere(), bhMat);
      bhMesh.position.copy(pos);
      this.projectileRoot.add(bhMesh);
      this.activeEffects.push({
        type: 'blackhole',
        position: pos,
        duration,
        elapsed: 0,
        mesh: bhMesh,
        isMasteryL5: isL5,
      });
    };

    spawnOneBlackHole(targetPos);

    // al_4/al_5 = twin holes: spawn a second black hole slightly offset
    if (bhNodes.has('black_hole_al_4') || bhNodes.has('black_hole_al_5')) {
      const perpOffset = new THREE.Vector3().crossVectors(direction, targetPos.clone().normalize()).normalize();
      const secondPos = targetPos.clone().addScaledVector(perpOffset, 1.5);
      // Project second hole onto surface
      if (this.meshSurface) {
        const result = this.meshSurface.closestPointOnSurface(secondPos);
        if (result) secondPos.copy(result.point);
      }
      spawnOneBlackHole(secondPos);
    }
  }

  private fireTesla(origin: THREE.Vector3): void {
    // Tesla coil is an area effect around player (radius 3, stronger damage)
    // Geometry shared via GeometryCache
    const teslaMat = new THREE.MeshBasicMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0.2,
      wireframe: true,
    });
    const teslaMesh = new THREE.Mesh(SharedGeometries.teslaSphere(), teslaMat);
    teslaMesh.position.copy(origin);

    this.projectileRoot.add(teslaMesh);

    this.activeEffects.push({
      type: 'tesla',
      position: origin,
      duration: 8.0,
      elapsed: 0,
      mesh: teslaMesh,
    });
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
      case WeaponType.Spread:
        return new THREE.Mesh(SharedGeometries.spreadProjectile(), material);

      case WeaponType.Homing:
        return new THREE.Mesh(SharedGeometries.homingProjectile(), material);

      case WeaponType.PlasmaMortar:
        return new THREE.Mesh(SharedGeometries.plasmaProjectile(), material);

      case WeaponType.GravityGun:
        return new THREE.Mesh(SharedGeometries.gravityProjectile(), material);

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

      default:
        // Spread animation: smoothly rotate to final angle over spreadDuration seconds
        if (proj.spreadEndDir !== undefined && proj.spreadDuration !== undefined && proj.spreadStartDir !== undefined) {
          const t = Math.min(proj.age / proj.spreadDuration, 1.0);
          if (t < 1.0) {
            proj.direction.lerpVectors(proj.spreadStartDir, proj.spreadEndDir, t).normalize();
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
        const dist = proj.position.distanceTo(enemy.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = enemy;
        }
      }

      if (nearestEnemy) {
        proj.targetIndex = nearestEnemy.index;
        const toTarget = nearestEnemy.position.clone().sub(proj.position).normalize();
        const turnRate = Math.min(1.0, 12.0 * dt);
        proj.direction.lerp(toTarget, turnRate).normalize();
      }
    }

    proj.position.add(proj.direction.clone().multiplyScalar(proj.speed * dt));
  }

  private checkProjectileCollisions(proj: Projectile, index: number): void {
    if (!this.callbacks) return;

    const enemies = this.callbacks.getEnemies();
    const hitRadius = 0.3;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      const dist = proj.position.distanceTo(enemy.position);
      if (dist < hitRadius) {
        this.callbacks.onEnemyDamage(enemy.index, proj.damage, proj.type);

        if (proj.type === WeaponType.PlasmaMortar) {
          // AoE radius upgrades (branch A): +30%, +60%, +100%
          const mortarNodes = this.activeUpgradeNodes(WeaponType.PlasmaMortar);
          const mortarRadiusBonus =
            (mortarNodes.has('plasma_mortar_a_1') ? 0.30 : 0) +
            (mortarNodes.has('plasma_mortar_a_2') ? 0.60 : 0) +
            (mortarNodes.has('plasma_mortar_a_3') ? 1.00 : 0);
          const blastRadius = 3.0 * (1.0 + mortarRadiusBonus);
          // b_5 = annihilator: instant-kill enemies below 10% HP. Since we don't have HP access,
          // apply a large bonus damage to push low-HP enemies over the threshold.
          // Implementation: deal double damage for b_5 which effectively one-shots weak enemies.
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
          // Explosion radius upgrades (branch B): +30%, +60%
          const homingNodes = this.activeUpgradeNodes(WeaponType.Homing);
          const homingRadiusBonus =
            (homingNodes.has('homing_b_1') ? 0.30 : 0) +
            (homingNodes.has('homing_b_2') ? 0.60 : 0);
          // b_5 = nova burst: combines explosion + napalm + stun; bigger radius than base
          const novaRadiusMult = homingNodes.has('homing_b_5') ? 1.5 : 1.0;
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

          // b_4 = napalm: spawn gas cloud on detonation (previously b_3's role)
          if (homingNodes.has('homing_b_4') || homingNodes.has('homing_b_5')) {
            this.spawnGasCloud(proj.position.clone());
          }

          // b_5 = nova burst stun: TODO — no slow system yet
          // When slow system added: apply 30% speed reduction for 0.5s to enemies in explosion radius.
          // if (homingNodes.has('homing_b_5')) { applyStun(nearbyEnemies, 0.3, 0.5); }

          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.GravityGun) {
          // Pull enemies together
          this.applyGravityPull(proj.position, 2.0);
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.GravityGun);
          this.removeProjectile(index);
          return;
        } else {
          // Check pierce mechanic (Spread pellets with spread_bl_4/bl_5 active)
          if (proj.canPierce !== undefined && proj.pierceCount !== undefined && proj.pierceCount < proj.canPierce) {
            // Pellet passes through — increment pierce count but don't remove
            proj.pierceCount++;
            return; // Done with this enemy; continue checking others for this projectile
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

      const dist = center.distanceTo(enemy.position);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        this.callbacks.onEnemyDamage(enemy.index, damage * falloff, WeaponType.PlasmaMortar);
      }
    }
  }

  private applyGravityPull(center: THREE.Vector3, baseRadius: number): void {
    if (!this.callbacks?.onEnemyPull) return;

    // Pull radius upgrades (branch A): +30%, +60%, +100%
    // a_4 = mass capture: +100% radius on top of existing bonuses
    const ggNodes = this.activeUpgradeNodes(WeaponType.GravityGun);
    const radiusBonus =
      (ggNodes.has('gravity_gun_a_1') ? 0.30 : 0) +
      (ggNodes.has('gravity_gun_a_2') ? 0.60 : 0) +
      (ggNodes.has('gravity_gun_a_3') ? 1.00 : 0) +
      (ggNodes.has('gravity_gun_a_4') ? 1.00 : 0);  // mass capture: +100% radius
    const radius = baseRadius * (1.0 + radiusBonus);

    // Kinetic crush damage per detonation (branch B) — extended for b_4/b_5
    const kineticDamage =
      ggNodes.has('gravity_gun_b_5') ? 20.0 :
      ggNodes.has('gravity_gun_b_4') ? 15.0 :
      ggNodes.has('gravity_gun_b_3') ? 9.0 :
      ggNodes.has('gravity_gun_b_2') ? 5.0 :
      ggNodes.has('gravity_gun_b_1') ? 2.0 : 0;

    const enemies = this.callbacks.getEnemies();
    const pulledPositions: THREE.Vector3[] = [];

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      const dist = center.distanceTo(enemy.position);
      if (dist < radius) {
        const strength = 1 - dist / radius;
        this.callbacks.onEnemyPull(enemy.index, strength, center);
        // Kinetic crush: deal instant damage when pulled
        if (kineticDamage > 0) {
          this.callbacks.onEnemyDamage(enemy.index, kineticDamage * strength, WeaponType.GravityGun);
        }
        pulledPositions.push(enemy.position.clone());
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
            // Collision damage: 2 damage to each
            this.callbacks.onEnemyDamage(collidingEnemies[i].index, 2, WeaponType.GravityGun);
            this.callbacks.onEnemyDamage(collidingEnemies[j].index, 2, WeaponType.GravityGun);
          }
        }
      }
    }
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
              this.callbacks.onEnemyDamage(enemy.index, 2 * dt * laserMasteryMult * laserSessionMult * laserUpgradeMult, WeaponType.LaserBeam);
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
        // Pull and damage enemies
        if (this.callbacks) {
          const enemies = this.callbacks.getEnemies();
          // Pull radius upgrades (branch B): +30%, +60%, +100%
          const bhActiveNodes = this.activeUpgradeNodes(WeaponType.BlackHole);
          const bhPullBonus =
            (bhActiveNodes.has('black_hole_b_1') ? 0.30 : 0) +
            (bhActiveNodes.has('black_hole_b_2') ? 0.60 : 0) +
            (bhActiveNodes.has('black_hole_b_3') ? 1.00 : 0);
          const radius = (3 + progress * 2) * (1.0 + bhPullBonus);

          // br_4/br_5 = crush damage: enemies trapped in the black hole take damage/sec
          const bhTrapDPS =
            bhActiveNodes.has('black_hole_br_5') ? 10 :
            bhActiveNodes.has('black_hole_br_4') ? 5 : 0;

          for (const enemy of enemies) {
            if (!enemy.alive) continue;

            const dist = effect.position.distanceTo(enemy.position);
            if (dist < radius) {
              // Instant kill in center
              if (dist < 0.5) {
                this.callbacks.onEnemyDamage(enemy.index, 999, WeaponType.BlackHole);
              } else {
                // LEVEL 5 FINAL FORM — Event Horizon: 30% stronger pull
                const pullStrength = effect.isMasteryL5 ? 0.65 : 0.5;
                this.callbacks.onEnemyPull?.(enemy.index, pullStrength, effect.position);
                // Crush damage per second for trapped enemies (b_4/b_5)
                if (bhTrapDPS > 0) {
                  this.callbacks.onEnemyDamage(enemy.index, bhTrapDPS * dt, WeaponType.BlackHole);
                }
              }
            }
          }

          // Animate mesh
          if (effect.mesh) {
            effect.mesh.scale.setScalar(1 + progress * 0.5);
            effect.mesh.rotation.z += dt * 2;
          }
        }
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

            const dist = effect.position.distanceTo(enemy.position);
            if (dist < radius) {
              this.callbacks.onEnemyDamage(enemy.index, 3 * dt * rapidTickMult * teslaMasteryMult * teslaSessionMult * teslaUpgradeDmgMult, WeaponType.TeslaCoil);
            } else if (arcRadius > 0 && dist < arcRadius) {
              // a_4 arc reach: 50% damage to outlying enemies in extended ring
              this.callbacks.onEnemyDamage(enemy.index, 3 * dt * 0.5 * teslaMasteryMult * teslaSessionMult * teslaUpgradeDmgMult, WeaponType.TeslaCoil);
            }
          }

          // b_5 stun: TODO — no slow system yet
          // When slow system added: apply 30% speed reduction for 0.5s to enemies in radius.

          if (effect.mesh) {
            effect.mesh.rotation.x += dt;
            effect.mesh.rotation.y += dt * 0.7;
          }
        }
        break;
    }
  }

  private spawnGasCloud(position: THREE.Vector3): void {
    const cloudMat = new THREE.MeshBasicMaterial({
      color: WEAPON_CONFIGS[WeaponType.Homing].color,
      transparent: true,
      opacity: 0.25,
    });
    const cloudMesh = new THREE.Mesh(SharedGeometries.blackholeSphere(), cloudMat);
    cloudMesh.scale.setScalar(GAS_CLOUD_RADIUS);
    cloudMesh.position.copy(position);
    this.projectileRoot.add(cloudMesh);

    this.gasClouds.push({
      position: position.clone(),
      elapsed: 0,
      duration: GAS_CLOUD_DURATION,
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
      if (effect.mesh) {
        this.projectileRoot.remove(effect.mesh);
      }
    }
    this.activeEffects = [];

    for (const cloud of this.gasClouds) {
      this.projectileRoot.remove(cloud.mesh);
    }
    this.gasClouds = [];
    this.pendingShots = [];

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
  const ab = b.clone().sub(a);
  const ap = p.clone().sub(a);
  const abLenSq = ab.lengthSq();

  // Degenerate segment (A === B)
  if (abLenSq < 0.000001) return ap.length();

  // Project AP onto AB, clamped to [0, 1]
  const t = Math.max(0, Math.min(1, ap.dot(ab) / abLenSq));

  // Closest point on segment
  const closest = a.clone().addScaledVector(ab, t);
  return p.distanceTo(closest);
}
