import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS, getWeaponColor } from './WeaponTypes';
import { ChainLightningEffect } from '../effects/ChainLightning';
import { MeshSurface } from '../surfaces/MeshSurface';
import { BuffType, BUFF_CONFIGS, ActiveBuff } from './BuffPickup';

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

  // Surface for laser beam tracing
  private meshSurface: MeshSurface | null = null;

  // Player position reference for following effects
  playerPositionRef: THREE.Vector3 | null = null;

  // Materials for projectiles
  private projectileMaterials: Map<WeaponType, THREE.Material> = new Map();

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
   * If the weapon is already in inventory, stacks ammo.
   * Switches the active weapon to the newly equipped one.
   */
  equipWeapon(type: WeaponType, ammo?: number): void {
    const config = WEAPON_CONFIGS[type];

    if (type !== WeaponType.Standard) {
      const existingAmmo = this.ammo.get(type) ?? 0;
      const addedAmmo = ammo ?? config.ammo;
      this.ammo.set(type, existingAmmo + addedAmmo);

      // Stack: picking up the same weapon again increases its stack level
      if (this.currentWeapon === type) {
        const currentStack = this.stacks.get(type) ?? 1;
        this.stacks.set(type, Math.min(currentStack + 1, 5)); // cap at 5 stacks
      } else {
        // Switching to a new weapon - start at stack 1 (unless already stacked)
        if (!this.stacks.has(type)) {
          this.stacks.set(type, 1);
        }
      }

      // Add to inventory if not already present
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
      const cooldown = 1 / (blasterConfig.fireRate * rapidMult);
      return currentTime - this.lastBlasterFireTime >= cooldown;
    }

    // For non-blaster weapons, use primary weapon cooldown
    const config = WEAPON_CONFIGS[this.currentWeapon];
    const rapidMult = this.getBuffMultiplier(BuffType.RapidFire);
    const cooldown = 1 / (config.fireRate * rapidMult);

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
    const blasterCooldown = 1 / (blasterConfig.fireRate * rapidMult);
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

      // Check collisions
      this.checkProjectileCollisions(proj, i);
    }

    // Update active effects
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.elapsed += dt;

      if (effect.elapsed >= effect.duration) {
        if (effect.mesh) {
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
    // Dual-barrel setup: fire 2 bullets slightly offset perpendicular to aim direction
    const up = surfaceNormal?.clone().normalize() ?? new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(direction, up).normalize();
    const offset = 0.15;

    const leftOrigin = origin.clone().addScaledVector(right, -offset);
    const rightOrigin = origin.clone().addScaledVector(right, offset);

    this.callbacks?.spawnBullet(leftOrigin, direction);
    this.callbacks?.spawnBullet(rightOrigin, direction);
  }

  private fireSpread(origin: THREE.Vector3, direction: THREE.Vector3, surfaceNormal?: THREE.Vector3): void {
    const config = WEAPON_CONFIGS[WeaponType.Spread];
    const spreadAngle = Math.PI / 6; // 30 degrees total spread
    const bulletCount = 5;

    // Use surface normal for rotation axis, fallback to world Y
    const rotationAxis = surfaceNormal ? surfaceNormal.clone().normalize() : new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < bulletCount; i++) {
      const angle = (i - 2) * (spreadAngle / (bulletCount - 1));
      const rotatedDir = direction.clone()
        .applyAxisAngle(rotationAxis, angle);

      this.createProjectile(
        WeaponType.Spread,
        origin.clone(),
        rotatedDir,
        config.damage,
        config.projectileSpeed,
        4.0,
      );
    }
  }

  private firePiercing(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const config = WEAPON_CONFIGS[WeaponType.Piercing];
    const rangeMult = this.getBuffMultiplier(BuffType.ExtendedRange);
    const stackMult = this.getStackDamageMultiplier(WeaponType.Piercing);

    // Trace a geodesic beam path along the surface
    const beamLen = 25 * rangeMult;
    const beamPoints = this.traceBeamPath(origin, direction, beamLen, Math.ceil(36 * rangeMult));

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

      for (const enemy of enemies) {
        if (!enemy.alive) continue;

        for (let s = 0; s < beamPoints.length - 1; s++) {
          const segDist = distanceToSegment(
            enemy.position, beamPoints[s], beamPoints[s + 1],
          );
          if (segDist < hitRadius) {
            this.callbacks.onEnemyDamage(enemy.index, config.damage * stackMult, WeaponType.Piercing);
            break; // Only damage each enemy once
          }
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

    // Find chain targets
    const otherEnemies = enemies.filter(e => e.index !== firstTarget!.index);
    const chainTargets = ChainLightningEffect.findChainTargets(
      firstTarget.position,
      otherEnemies,
      5,
      3,
    );

    // Add first target at front
    chainTargets.unshift({
      position: firstTarget.position.clone(),
      damageMultiplier: 1.0,
      index: firstTarget.index,
    });

    // Fire the visual effect (apply stack multiplier)
    const stackMult = this.getStackDamageMultiplier(WeaponType.ChainLightning);
    this.chainLightning.fire(origin, chainTargets, (pos, mult, idx) => {
      this.callbacks?.onEnemyDamage(idx, config.damage * mult * stackMult, WeaponType.ChainLightning);
    });
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

    const proj = this.createProjectile(
      WeaponType.Homing,
      origin.clone(),
      direction.clone(),
      config.damage,
      config.projectileSpeed,
      6.0,
    );
    proj.targetIndex = targetIndex;
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

    this.activeEffects.push({
      type: 'laser',
      position: origin.clone(),
      direction: direction.clone(),
      duration: 0.5,
      elapsed: 0,
      mesh: laserMesh,
      beamPoints,
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

    // Create black hole visual
    const bhGeom = new THREE.SphereGeometry(0.3, 16, 16);
    const bhMat = new THREE.MeshBasicMaterial({
      color: 0x220044,
      transparent: true,
      opacity: 0.9,
    });
    const bhMesh = new THREE.Mesh(bhGeom, bhMat);
    bhMesh.position.copy(targetPos);

    this.projectileRoot.add(bhMesh);

    this.activeEffects.push({
      type: 'blackhole',
      position: targetPos,
      duration: 3.0,
      elapsed: 0,
      mesh: bhMesh,
    });
  }

  private fireTesla(origin: THREE.Vector3): void {
    // Tesla coil is an area effect around player (radius 3, stronger damage)
    const teslaGeom = new THREE.SphereGeometry(3, 16, 16);
    const teslaMat = new THREE.MeshBasicMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0.2,
      wireframe: true,
    });
    const teslaMesh = new THREE.Mesh(teslaGeom, teslaMat);
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
    // Apply Extended Range buff + stack damage multiplier
    const rangeMult = this.getBuffMultiplier(BuffType.ExtendedRange);
    const stackMult = this.getStackDamageMultiplier(type);
    const proj: Projectile = {
      type,
      position,
      direction: direction.normalize(),
      age: 0,
      maxAge: maxAge * rangeMult,
      damage: damage * stackMult,
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

    switch (type) {
      case WeaponType.Spread: {
        const geom = new THREE.SphereGeometry(0.08, 8, 8);
        return new THREE.Mesh(geom, material);
      }

      case WeaponType.Homing: {
        const geom = new THREE.ConeGeometry(0.1, 0.3, 6);
        geom.rotateX(Math.PI / 2);
        return new THREE.Mesh(geom, material);
      }

      case WeaponType.PlasmaMortar: {
        const geom = new THREE.SphereGeometry(0.35, 12, 12);
        return new THREE.Mesh(geom, material);
      }

      case WeaponType.GravityGun: {
        const geom = new THREE.TorusGeometry(0.15, 0.05, 8, 16);
        return new THREE.Mesh(geom, material);
      }

      default: {
        const geom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        return new THREE.Mesh(geom, material ?? new THREE.MeshBasicMaterial({ color: 0xffffff }));
      }
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
        const turnRate = 3.0 * dt;
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
          // AoE damage - devastating blast radius
          this.applyAoeDamage(proj.position, 3.0, proj.damage * 0.75);
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.PlasmaMortar);
          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.Homing) {
          this.callbacks.onProjectileExplosion?.(proj.position.clone(), WeaponType.Homing);
          this.removeProjectile(index);
          return;
        } else if (proj.type === WeaponType.GravityGun) {
          // Pull enemies together
          this.applyGravityPull(proj.position, 2.0);
          this.removeProjectile(index);
          return;
        } else {
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

  private applyGravityPull(center: THREE.Vector3, radius: number): void {
    if (!this.callbacks?.onEnemyPull) return;

    const enemies = this.callbacks.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      const dist = center.distanceTo(enemy.position);
      if (dist < radius) {
        const strength = 1 - dist / radius;
        this.callbacks.onEnemyPull(enemy.index, strength, center);
      }
    }
  }

  private updateEffect(effect: ActiveEffect, dt: number): void {
    const progress = effect.elapsed / effect.duration;

    switch (effect.type) {
      case 'laser':
        // Continuous damage along surface-following beam polyline
        if (this.callbacks && effect.beamPoints && effect.beamPoints.length >= 2) {
          const enemies = this.callbacks.getEnemies();
          const hitRadius = 0.35;

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
              this.callbacks.onEnemyDamage(enemy.index, 2 * dt, WeaponType.LaserBeam);
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
          const radius = 3 + progress * 2;

          for (const enemy of enemies) {
            if (!enemy.alive) continue;

            const dist = effect.position.distanceTo(enemy.position);
            if (dist < radius) {
              // Instant kill in center
              if (dist < 0.5) {
                this.callbacks.onEnemyDamage(enemy.index, 999, WeaponType.BlackHole);
              } else {
                // Pull toward center
                this.callbacks.onEnemyPull?.(enemy.index, 0.5, effect.position);
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

          const enemies = this.callbacks.getEnemies();
          const radius = 3;

          for (const enemy of enemies) {
            if (!enemy.alive) continue;

            const dist = effect.position.distanceTo(enemy.position);
            if (dist < radius) {
              this.callbacks.onEnemyDamage(enemy.index, 3 * dt, WeaponType.TeslaCoil);
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

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    this.chainLightning.dispose();

    for (const mat of this.projectileMaterials.values()) {
      mat.dispose();
    }
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
