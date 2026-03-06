import * as THREE from 'three';
import { BulletPool } from './Bullet';
import { BaseEnemy } from './enemies/BaseEnemy';
import { getSoundEngine } from '../audio/SoundEngine';
import { SurfaceAgent } from '../agents/SurfaceAgent';
import { OrbitBehavior } from '../agents/behaviors';
import type { MeshSurface } from '../surfaces/MeshSurface';
import { createSpawnIndicatorSprite, updateSpawnIndicator } from '../weapons/SpawnIndicator';

// ---------------------------------------------------------------------------
// Companion Types
// ---------------------------------------------------------------------------

export enum CompanionType {
  Guardian = 'guardian',  // Blue - shoots nearby enemies in blind spots
  Hunter = 'hunter',      // Red - targets highest-HP enemy
  Protector = 'protector', // Green - shield on player hit
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORBIT_RADIUS = 1.5;
const ORBIT_SPEED_BASE = 1.8; // rad/sec base orbit speed

const GUARDIAN_FIRE_RATE = 3;      // shots/sec
const GUARDIAN_RANGE = 3.0;         // world units
const GUARDIAN_DAMAGE = 1;

const HUNTER_FIRE_RATE = 1.5;     // shots/sec
const HUNTER_DAMAGE = 2;
const HUNTER_RANGE = Infinity;     // targets any visible enemy

const PROTECTOR_RECHARGE_BASE = 18; // seconds base recharge
const PROTECTOR_SHIELD_DURATION = 1; // seconds of invincibility

const COMPANION_MESH_RADIUS = 0.15;

const COMPANION_COLORS: Record<CompanionType, number> = {
  [CompanionType.Guardian]: 0x4488ff,
  [CompanionType.Hunter]: 0xff4444,
  [CompanionType.Protector]: 0x44ff44,
};

// Shared soft-glow texture for companion sprites (created lazily)
let sharedCompanionGlowTexture: THREE.Texture | null = null;

function getCompanionGlowTexture(): THREE.Texture {
  if (!sharedCompanionGlowTexture) {
    if (typeof document === 'undefined') {
      sharedCompanionGlowTexture = new THREE.Texture();
      return sharedCompanionGlowTexture;
    }
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.7)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
    gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.05)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    sharedCompanionGlowTexture = new THREE.CanvasTexture(canvas);
    sharedCompanionGlowTexture.needsUpdate = true;
  }
  return sharedCompanionGlowTexture;
}

// Pre-allocated temp vectors
const _tempAimDir = new THREE.Vector3();
const _tempToEnemy = new THREE.Vector3();
const _tempCompPos = new THREE.Vector3();
const _tempOrientMat = new THREE.Matrix4();
// Orbit: guaranteed-perpendicular bitangent = normal × tangent
const _tempOrbitBitangent = new THREE.Vector3();
// Orient: right-handed Z axis = tangent × normal (makes det=+1, prevents flat appearance)
const _tempOrientZ = new THREE.Vector3();
// Spin axes for independent ring/core rotation (3D gyroscope effect)
const _spinX = new THREE.Vector3(1, 0, 0);
const _spinY = new THREE.Vector3(0, 1, 0);
const _spinZ = new THREE.Vector3(0, 0, 1);

// Pre-allocated temps for CompanionPickup.applySurfaceTransform
const _cpMat4 = new THREE.Matrix4();
const _cpQSurface = new THREE.Quaternion();
const _cpQSpin = new THREE.Quaternion();
const _cpSpinAxis = new THREE.Vector3(0, 1, 0); // local Y = surface normal

// ---------------------------------------------------------------------------
// Single Companion entity
// ---------------------------------------------------------------------------

class Companion {
  readonly type: CompanionType;
  readonly mesh: THREE.Group;
  readonly color: number;

  health = Infinity;

  // Orbit state
  orbitAngle: number;
  orbitRadius: number = ORBIT_RADIUS;
  orbitSpeed: number;

  // Surface position (UV for surface.getTransform)
  surfaceU = 0;
  surfaceV = 0;

  // Shooting
  private fireCooldown = 0;
  private readonly fireInterval: number;

  // Protector-specific
  rechargeTimer = 0;
  isReady = true;

  // Map scale factor — guardian range scales with map size
  mapSizeScaleFactor = 1;

  // Glow trail data
  private glowMaterial: THREE.MeshStandardMaterial;

  // Per-part references for independent 3D rotation (gyroscope effect)
  private corePart: THREE.Group;
  private ring1: THREE.Mesh;
  private ring2: THREE.Mesh;

  // Surface-aware movement agent (orbit delegated to SurfaceAgent + OrbitBehavior)
  private agent: SurfaceAgent;

  constructor(type: CompanionType, orbitPhase: number) {
    this.type = type;
    this.color = COMPANION_COLORS[type];
    this.orbitAngle = orbitPhase;

    // Vary orbit speeds slightly by type for visual interest
    switch (type) {
      case CompanionType.Guardian:
        this.orbitSpeed = ORBIT_SPEED_BASE * 1.0;
        this.fireInterval = 1 / GUARDIAN_FIRE_RATE;
        break;
      case CompanionType.Hunter:
        this.orbitSpeed = ORBIT_SPEED_BASE * 0.8;
        this.fireInterval = 1 / HUNTER_FIRE_RATE;
        break;
      case CompanionType.Protector:
        this.orbitSpeed = ORBIT_SPEED_BASE * 1.2;
        this.fireInterval = Infinity; // protector never shoots
        break;
    }

    // Build visual mesh
    const { group, material, corePart, ring1, ring2 } = createCompanionMesh(this.color);
    this.mesh = group;
    this.glowMaterial = material;
    this.corePart = corePart;
    this.ring1 = ring1;
    this.ring2 = ring2;

    // Initialize surface agent with orbit behavior
    this.agent = new SurfaceAgent(null, new THREE.Vector3(), this.orbitSpeed);
    this.agent.setBehavior(new OrbitBehavior(
      new THREE.Vector3(), // center - updated each frame
      ORBIT_RADIUS,
      this.orbitSpeed,
      this.orbitAngle,
    ));
  }

  /**
   * Update companion orbit position, AI targeting, and shooting.
   */
  update(
    dt: number,
    playerU: number,
    playerV: number,
    playerWorldPos: THREE.Vector3,
    playerAimDir: THREE.Vector3,
    enemies: BaseEnemy[],
    bulletPool: BulletPool,
    ownerId: number,
    surfaceNormal: THREE.Vector3,
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    // Delegate orbit positioning to SurfaceAgent + OrbitBehavior
    const orbitBehavior = this.agent.getBehavior() as OrbitBehavior;
    const playerTransform = getTransform(playerU, playerV);
    orbitBehavior.center.copy(playerWorldPos);
    // FIX: Compute guaranteed-perpendicular bitangent = tangent × normal.
    // The surface's tangentV can be parallel to tangentU on certain cube face strips
    // (e.g. top face strip 1 where faceRight=(0,0,-1) equals the world-axis override
    // tangentV=(0,0,-1)), collapsing the orbit to 1D "up/down" oscillation.
    // Using tangent × normal maintains right-handed frame consistency with the mesh orientation
    // computed below (line 224: tangent × normal for Z axis).
    _tempOrbitBitangent.crossVectors(playerTransform.tangent, playerTransform.normal);
    orbitBehavior.setFrame(playerTransform.tangent, _tempOrbitBitangent);
    this.agent.update(dt);
    this.orbitAngle = orbitBehavior.angle; // sync for any code reading orbitAngle

    // Position mesh slightly above surface
    this.mesh.position.copy(this.agent.position);
    this.mesh.position.addScaledVector(surfaceNormal, 0.2);

    // Keep approximate UV for bullet spawning (companion is near player)
    this.surfaceU = playerU;
    this.surfaceV = playerV;

    // Orient the group to the surface using a right-handed basis.
    // FIX: Previous makeBasis(tangent, normal, bitangent) produced det=-1 (left-handed)
    // because tangent × normal ≠ bitangent on most surfaces. Left-handed matrices cause
    // Three.js setFromRotationMatrix to extract garbage quaternions, making meshes appear flat.
    // Correct approach: Z axis = tangent × normal guarantees det=+1.
    _tempOrientZ.crossVectors(playerTransform.tangent, surfaceNormal);
    _tempOrientMat.makeBasis(playerTransform.tangent, surfaceNormal, _tempOrientZ);
    this.mesh.quaternion.setFromRotationMatrix(_tempOrientMat);

    // 3D gyroscope effect: each part spins on a different local axis
    // corePart spins around surface normal (Y) — diamond tumbles in the tangent plane
    this.corePart.rotateOnAxis(_spinY, dt * 3.0);
    // ring1 spins around tangent (X) — wobbles in the normal-bitangent plane (looks 3D)
    this.ring1.rotateOnAxis(_spinX, dt * 2.0);
    // ring2 spins around bitangent (Z) — wobbles in the normal-tangent plane (different arc)
    this.ring2.rotateOnAxis(_spinZ, dt * -1.5);

    // Type-specific behavior
    switch (this.type) {
      case CompanionType.Guardian:
        this.updateGuardian(dt, playerWorldPos, playerAimDir, enemies, bulletPool, ownerId, surfaceNormal);
        break;
      case CompanionType.Hunter:
        this.updateHunter(dt, enemies, bulletPool, ownerId, surfaceNormal);
        break;
      case CompanionType.Protector:
        this.updateProtector(dt);
        break;
    }
  }

  // -- Guardian AI: shoot nearby enemies in blind spots --

  private updateGuardian(
    dt: number,
    playerWorldPos: THREE.Vector3,
    playerAimDir: THREE.Vector3,
    enemies: BaseEnemy[],
    bulletPool: BulletPool,
    ownerId: number,
    surfaceNormal: THREE.Vector3,
  ): void {
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return;

    // Find best target: prefer enemies behind/beside the player (blind spots)
    let bestTarget: BaseEnemy | null = null;
    let bestScore = -Infinity;

    for (const enemy of enemies) {
      if (!enemy.alive || !enemy.mesh) continue;

      _tempToEnemy.copy(enemy.position).sub(playerWorldPos);
      const dist = _tempToEnemy.length();
      const effectiveRange = GUARDIAN_RANGE * this.mapSizeScaleFactor;
      if (dist > effectiveRange || dist < 0.1) continue;

      _tempToEnemy.normalize();

      // Dot product with player aim: negative = behind, 0 = side, 1 = ahead
      const dotAim = playerAimDir.dot(_tempToEnemy);

      // Score: prefer enemies that are NOT in the player's forward arc
      // Behind (dot ~ -1) scores highest, directly ahead (dot ~ 1) scores lowest
      const blindSpotScore = 1.0 - dotAim; // 0 to 2, higher = more behind
      const proximityScore = 1.0 - dist / effectiveRange; // closer = higher

      const score = blindSpotScore * 0.7 + proximityScore * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }

    if (bestTarget) {
      this.fireCooldown = this.fireInterval;
      this.fireAt(bestTarget.position, bulletPool, ownerId, surfaceNormal);
    }
  }

  // -- Hunter AI: target highest-HP enemy --

  private updateHunter(
    dt: number,
    enemies: BaseEnemy[],
    bulletPool: BulletPool,
    ownerId: number,
    surfaceNormal: THREE.Vector3,
  ): void {
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return;

    let bestTarget: BaseEnemy | null = null;
    let bestHP = -1;

    for (const enemy of enemies) {
      if (!enemy.alive || !enemy.mesh) continue;

      if (enemy.health > bestHP) {
        bestHP = enemy.health;
        bestTarget = enemy;
      }
    }

    if (bestTarget) {
      this.fireCooldown = this.fireInterval;
      this.fireAt(bestTarget.position, bulletPool, ownerId, surfaceNormal);
    }
  }

  // -- Protector: recharge timer + visual dimming --

  private updateProtector(dt: number): void {
    if (!this.isReady) {
      this.rechargeTimer -= dt;
      if (this.rechargeTimer <= 0) {
        this.isReady = true;
        this.rechargeTimer = 0;
        // Brighten mesh
        this.glowMaterial.emissiveIntensity = 0.8;
        this.glowMaterial.opacity = 1.0;
      } else {
        // Dim mesh proportionally to recharge progress
        const progress = 1 - this.rechargeTimer / PROTECTOR_RECHARGE_BASE;
        this.glowMaterial.emissiveIntensity = 0.2 + progress * 0.6;
        this.glowMaterial.opacity = 0.4 + progress * 0.6;
      }
    }
  }

  /**
   * Activate protector shield. Returns true if shield was available.
   */
  activateShield(rechargeTime: number): boolean {
    if (!this.isReady || this.type !== CompanionType.Protector) return false;
    this.isReady = false;
    this.rechargeTimer = rechargeTime;
    // Dim the mesh immediately
    this.glowMaterial.emissiveIntensity = 0.15;
    this.glowMaterial.opacity = 0.3;
    return true;
  }

  // -- Shared shooting logic --

  private fireAt(
    targetPos: THREE.Vector3,
    bulletPool: BulletPool,
    ownerId: number,
    surfaceNormal: THREE.Vector3,
  ): void {
    _tempAimDir.copy(targetPos).sub(this.mesh.position).normalize();

    // Project aim direction onto surface tangent plane (remove normal component)
    const dot = _tempAimDir.dot(surfaceNormal);
    _tempAimDir.addScaledVector(surfaceNormal, -dot);
    const len = _tempAimDir.length();
    if (len < 0.001) return;
    _tempAimDir.multiplyScalar(1 / len);

    const aimAngle = Math.atan2(_tempAimDir.x, _tempAimDir.z);

    bulletPool.spawn(
      this.mesh.position.clone(),
      _tempAimDir.clone(),
      this.surfaceU,
      this.surfaceV,
      aimAngle,
      ownerId,
      true, // isCompanion = true for guardian/hunter/protector bullets
    );

    getSoundEngine().play('shoot', { volume: 0.15, pitch: 1.4 + Math.random() * 0.3 });
  }

  setMeshSurface(ms: MeshSurface | null): void {
    this.agent.setMeshSurface(ms);
  }

  dispose(): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        child.material.dispose();
        child.material.map?.dispose();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// CompanionManager - manages all companions for a player
// ---------------------------------------------------------------------------

export class CompanionManager {
  readonly root: THREE.Group;
  private companions: Companion[] = [];
  private meshSurface: MeshSurface | null = null;

  // Shield bubble for protector
  private shieldBubble: THREE.Mesh | null = null;
  private shieldTimer = 0;
  private shieldActive = false;

  private mapSizeScaleFactor = 1;

  constructor(mapSizeScaleFactor = 1) {
    this.root = new THREE.Group();
    this.root.name = 'CompanionManager';
    this.mapSizeScaleFactor = mapSizeScaleFactor;
  }

  setMapSizeScaleFactor(factor: number): void {
    this.mapSizeScaleFactor = factor;
  }

  /**
   * Add a new companion of the given type.
   * Distributes orbit phases evenly among same-type companions.
   */
  addCompanion(type: CompanionType): void {
    const sameTypeCount = this.companions.filter(c => c.type === type).length;
    const totalAfterAdd = sameTypeCount + 1;

    // Redistribute orbit phases for all same-type companions
    const phase = (sameTypeCount / totalAfterAdd) * Math.PI * 2;
    const companion = new Companion(type, phase);

    // Redistribute existing same-type companions
    let idx = 0;
    for (const c of this.companions) {
      if (c.type === type) {
        c.orbitAngle = (idx / totalAfterAdd) * Math.PI * 2;
        idx++;
      }
    }

    companion.mapSizeScaleFactor = this.mapSizeScaleFactor;
    companion.setMeshSurface(this.meshSurface);
    this.companions.push(companion);
    this.root.add(companion.mesh);
  }

  /**
   * Set the MeshSurface for all companions (enables BVH surface snapping).
   * Also stored so newly added companions get it automatically.
   */
  setMeshSurface(ms: MeshSurface | null): void {
    this.meshSurface = ms;
    for (const companion of this.companions) {
      companion.setMeshSurface(ms);
    }
  }

  /**
   * Update all companions. Call each frame.
   */
  update(
    dt: number,
    playerU: number,
    playerV: number,
    playerWorldPos: THREE.Vector3,
    playerAimDir: THREE.Vector3,
    enemies: BaseEnemy[],
    bulletPool: BulletPool,
    ownerId: number,
    surfaceNormal: THREE.Vector3,
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    for (const companion of this.companions) {
      companion.update(
        dt,
        playerU,
        playerV,
        playerWorldPos,
        playerAimDir,
        enemies,
        bulletPool,
        ownerId,
        surfaceNormal,
        getTransform,
      );
    }

    // Update shield bubble
    if (this.shieldActive) {
      this.shieldTimer -= dt;
      if (this.shieldBubble) {
        this.shieldBubble.position.copy(playerWorldPos);
        // Fade out over the last 0.3s
        const fadeStart = 0.3;
        const opacity = this.shieldTimer < fadeStart
          ? Math.max(0, this.shieldTimer / fadeStart) * 0.35
          : 0.35;
        (this.shieldBubble.material as THREE.MeshStandardMaterial).opacity = opacity;

        // Pulse effect
        const pulse = 1.0 + Math.sin(this.shieldTimer * 15) * 0.05;
        this.shieldBubble.scale.setScalar(1.8 * pulse);
      }
      if (this.shieldTimer <= 0) {
        this.deactivateShield();
      }
    }
  }

  /**
   * Called when the player takes a hit. If green protectors are ready,
   * activates the shield and returns true (player should be made invincible).
   */
  onPlayerHit(): boolean {
    const protectors = this.companions.filter(
      c => c.type === CompanionType.Protector && c.isReady,
    );

    if (protectors.length === 0) return false;

    // Calculate recharge time: base / total protector count
    const totalProtectors = this.companions.filter(
      c => c.type === CompanionType.Protector,
    ).length;
    const rechargeTime = PROTECTOR_RECHARGE_BASE / totalProtectors;

    // Activate all ready protectors
    for (const p of protectors) {
      p.activateShield(rechargeTime);
    }

    // Activate shield bubble visual
    this.activateShieldBubble();

    return true;
  }

  /**
   * Returns true if the shield is currently active (player is invincible).
   */
  isShieldActive(): boolean {
    return this.shieldActive;
  }

  /**
   * Get companion counts by type for HUD display.
   */
  getCompanionCounts(): { guardian: number; hunter: number; protector: number } {
    let guardian = 0;
    let hunter = 0;
    let protector = 0;
    for (const c of this.companions) {
      switch (c.type) {
        case CompanionType.Guardian: guardian++; break;
        case CompanionType.Hunter: hunter++; break;
        case CompanionType.Protector: protector++; break;
      }
    }
    return { guardian, hunter, protector };
  }

  /**
   * Total number of companions.
   */
  get count(): number {
    return this.companions.length;
  }

  /**
   * Remove all companions between rounds. The manager itself remains reusable —
   * call addCompanion() to populate again next round.
   */
  reset(): void {
    for (const c of this.companions) {
      this.root.remove(c.mesh);
      c.dispose();
    }
    this.companions = [];
    this.shieldTimer = 0;
    this.shieldActive = false;
    if (this.shieldBubble) {
      this.shieldBubble.geometry.dispose();
      (this.shieldBubble.material as THREE.Material).dispose();
      this.root.remove(this.shieldBubble);
      this.shieldBubble = null;
    }
  }

  /**
   * Dispose all companions and resources.
   */
  dispose(): void {
    for (const c of this.companions) {
      c.dispose();
    }
    this.companions = [];
    if (this.shieldBubble) {
      this.shieldBubble.geometry.dispose();
      (this.shieldBubble.material as THREE.Material).dispose();
      this.root.remove(this.shieldBubble);
      this.shieldBubble = null;
    }
  }

  // -- Shield bubble visual --

  private activateShieldBubble(): void {
    if (!this.shieldBubble) {
      const geom = new THREE.SphereGeometry(1, 24, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x44ff44,
        emissive: 0x44ff44,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.shieldBubble = new THREE.Mesh(geom, mat);
      this.shieldBubble.name = 'ProtectorShieldBubble';
      this.shieldBubble.scale.setScalar(1.8);
      this.root.add(this.shieldBubble);
    }

    this.shieldBubble.visible = true;
    (this.shieldBubble.material as THREE.MeshStandardMaterial).opacity = 0.35;
    this.shieldActive = true;
    this.shieldTimer = PROTECTOR_SHIELD_DURATION;

    getSoundEngine().play('shieldHit', { volume: 0.5, pitch: 1.5 });
  }

  private deactivateShield(): void {
    this.shieldActive = false;
    this.shieldTimer = 0;
    if (this.shieldBubble) {
      this.shieldBubble.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Companion pickup (dropped by enemies, floats on surface)
// ---------------------------------------------------------------------------

// World-space pickup collision radius. See WeaponPickup.ts for rationale.
const COMPANION_PICKUP_WORLD_RADIUS = 0.3;

export class CompanionPickup {
  readonly mesh: THREE.Group;
  readonly companionType: CompanionType;

  surfaceU: number;
  surfaceV: number;
  active = true;

  private readonly _surfaceWorldPos: THREE.Vector3 = new THREE.Vector3();
  private age = 0;
  private readonly maxAge = 25; // seconds before despawn
  private readonly fadeStart = 20;
  private bobPhase: number;
  private _currentTotalTime = 0;
  private readonly mapSizeScaleFactor: number;
  private readonly _storedCameraUp = new THREE.Vector3();
  private _hasCameraUp = false;

  constructor(companionType: CompanionType, surfaceU: number, surfaceV: number, mapSizeScaleFactor: number = 1.0) {
    this.companionType = companionType;
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
    this.mapSizeScaleFactor = mapSizeScaleFactor;
    this.bobPhase = Math.random() * Math.PI * 2;

    const color = COMPANION_COLORS[companionType];
    this.mesh = this.createPickupMesh(color);
  }

  private createPickupMesh(color: number): THREE.Group {
    const group = new THREE.Group();
    group.name = `CompanionPickup_${this.companionType}`;

    const threeColor = new THREE.Color(color);

    // Outer wireframe octahedron
    const outerGeom = new THREE.OctahedronGeometry(0.3);
    const outerMat = new THREE.MeshBasicMaterial({
      color: threeColor,
      wireframe: true,
      transparent: true,
      opacity: 0.7,
    });
    outerMat.userData.baseOpacity = 0.7;
    group.add(new THREE.Mesh(outerGeom, outerMat));

    // Inner solid diamond
    const innerGeom = new THREE.OctahedronGeometry(0.12);
    const innerMat = new THREE.MeshStandardMaterial({
      color: threeColor,
      emissive: threeColor,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.9,
    });
    innerMat.userData.baseOpacity = 0.9;
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    innerMesh.name = 'core';
    group.add(innerMesh);

    // 3D glow sphere (replaces flat sprite — visible from all angles)
    const glowGeom = new THREE.SphereGeometry(0.45, 12, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: threeColor,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    glowMat.userData.baseOpacity = 0.2;
    const glowSphere = new THREE.Mesh(glowGeom, glowMat);
    glowSphere.name = 'pickupGlow';
    group.add(glowSphere);

    // Spawn indicator: flashing arrow for first 30s
    group.add(createSpawnIndicatorSprite(threeColor));

    return group;
  }

  update(dt: number, totalTime: number, cameraUp?: THREE.Vector3): void {
    if (!this.active) return;

    this.age += dt;
    if (this.age >= this.maxAge) {
      this.active = false;
      return;
    }

    // Store totalTime for bob animation in applySurfaceTransform
    this._currentTotalTime = totalTime;

    // Spin applied in applySurfaceTransform() to avoid quaternion override issue.

    // Pulse core
    const core = this.mesh.getObjectByName('core');
    if (core) {
      const pulse = 0.12 + Math.sin(totalTime * 4) * 0.025;
      core.scale.setScalar(pulse / 0.12);
    }

    // Store cameraUp for deferred use in applySurfaceTransform()
    if (cameraUp) {
      this._storedCameraUp.copy(cameraUp);
      this._hasCameraUp = true;
    }

    // Track age factor for surface dimming in RenderLoop
    this.mesh.userData.ageFactor = this.age > this.fadeStart
      ? Math.max(0, 1 - (this.age - this.fadeStart) / (this.maxAge - this.fadeStart))
      : 1.0;

    // Fade near end of life
    if (this.age > this.fadeStart) {
      const fadeProgress = (this.age - this.fadeStart) / (this.maxAge - this.fadeStart);
      const opacity = 1 - fadeProgress;
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.Material;
          if ('opacity' in mat) {
            (mat as any).opacity = opacity * ((mat as any).userData?.baseOpacity ?? 0.8);
          }
        }
        if (child instanceof THREE.Sprite) {
          if ((child as THREE.Sprite).name !== 'spawn-indicator') {
            child.material.opacity = opacity * 0.3;
          }
        }
      });
    }
  }

  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    const { position, normal, tangent, bitangent } = getTransform(this.surfaceU, this.surfaceV);
    this._surfaceWorldPos.copy(position);
    const bob = Math.sin(this._currentTotalTime * 3 + this.bobPhase) * 0.07 * this.mapSizeScaleFactor;
    this.mesh.position.copy(position).addScaledVector(normal, 0.4 + bob);
    // Orient to surface + spin around local Y (= surface normal) so the wireframe
    // octahedron reads as 3D rather than a flat 2D diamond silhouette.
    _cpMat4.makeBasis(tangent, normal, bitangent);
    _cpQSurface.setFromRotationMatrix(_cpMat4);
    _cpQSpin.setFromAxisAngle(_cpSpinAxis, this._currentTotalTime * 2);
    this.mesh.quaternion.copy(_cpQSurface).multiply(_cpQSpin);

    // Update spawn indicator after quaternion is set so cameraUp transforms correctly
    updateSpawnIndicator(this.mesh, this.age, this._currentTotalTime, this._hasCameraUp ? this._storedCameraUp : undefined);
  }

  checkPlayerCollision(playerU: number, playerV: number, playerWorldPos?: THREE.Vector3): boolean {
    if (!this.active) return false;
    if (playerWorldPos) {
      return playerWorldPos.distanceTo(this._surfaceWorldPos) < COMPANION_PICKUP_WORLD_RADIUS * this.mapSizeScaleFactor;
    }
    let du = playerU - this.surfaceU;
    let dv = playerV - this.surfaceV;
    if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
    if (dv > 0.5) dv -= 1; else if (dv < -0.5) dv += 1;
    return Math.sqrt(du * du + dv * dv) < 0.01 / this.mapSizeScaleFactor;
  }

  dispose(): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Companion HUD - shows colored diamonds with counts
// ---------------------------------------------------------------------------

export class CompanionHUD {
  private container: HTMLDivElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'companion-hud';
    this.container.style.cssText =
      'position:fixed;bottom:60px;right:20px;display:flex;gap:10px;' +
      'font-family:"Segoe UI",Arial,sans-serif;font-size:14px;' +
      'letter-spacing:1px;pointer-events:none;z-index:100;';
    document.body.appendChild(this.container);
  }

  update(counts: { guardian: number; hunter: number; protector: number }): void {
    const items: Array<{ label: string; count: number; color: string; shadow: string }> = [];

    if (counts.guardian > 0) {
      items.push({
        label: '\u25C6', // diamond
        count: counts.guardian,
        color: '#4488ff',
        shadow: '0 0 6px #4488ff',
      });
    }
    if (counts.hunter > 0) {
      items.push({
        label: '\u25C6',
        count: counts.hunter,
        color: '#ff4444',
        shadow: '0 0 6px #ff4444',
      });
    }
    if (counts.protector > 0) {
      items.push({
        label: '\u25C6',
        count: counts.protector,
        color: '#44ff44',
        shadow: '0 0 6px #44ff44',
      });
    }

    this.container.innerHTML = items
      .map(
        (item) =>
          `<span style="color:${item.color};text-shadow:${item.shadow};">` +
          `${item.label}x${item.count}</span>`,
      )
      .join('');
  }

  dispose(): void {
    this.container.remove();
  }
}

// ---------------------------------------------------------------------------
// Random companion type selection (weighted)
// ---------------------------------------------------------------------------

export function getRandomCompanionType(): CompanionType {
  const roll = Math.random();
  if (roll < 0.40) return CompanionType.Guardian;
  if (roll < 0.75) return CompanionType.Hunter;
  return CompanionType.Protector;
}

// ---------------------------------------------------------------------------
// Mesh builder
// ---------------------------------------------------------------------------

function createCompanionMesh(color: number): {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  corePart: THREE.Group;
  ring1: THREE.Mesh;
  ring2: THREE.Mesh;
} {
  const group = new THREE.Group();
  group.name = 'Companion';

  const threeColor = new THREE.Color(color);

  // -- Core part (octahedron + glow) — spins as a unit around surface normal --
  const corePart = new THREE.Group();
  corePart.name = 'companionCore';
  group.add(corePart);

  // Octahedron (diamond shape)
  const geom = new THREE.OctahedronGeometry(COMPANION_MESH_RADIUS);
  const mat = new THREE.MeshStandardMaterial({
    color: threeColor,
    emissive: threeColor,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 1.0,
    metalness: 0.3,
    roughness: 0.4,
  });
  const coreMesh = new THREE.Mesh(geom, mat);
  corePart.add(coreMesh);

  // Wireframe overlay for extra definition
  const wireGeom = new THREE.OctahedronGeometry(COMPANION_MESH_RADIUS * 1.15);
  const wireMat = new THREE.MeshBasicMaterial({
    color: threeColor,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
  });
  corePart.add(new THREE.Mesh(wireGeom, wireMat));

  // 3D glow sphere (ambient glow visible from all angles)
  const glowGeom = new THREE.SphereGeometry(COMPANION_MESH_RADIUS * 1.6, 16, 12);
  const glowMat = new THREE.MeshBasicMaterial({
    color: threeColor,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const glowSphere = new THREE.Mesh(glowGeom, glowMat);
  glowSphere.name = 'companionGlow';
  corePart.add(glowSphere);

  // -- Ring 1: starts tilted 45° so it's never face-on from above --
  // Spins on local X (tangent) axis → wobbles in the normal-bitangent plane
  const ring1Geom = new THREE.TorusGeometry(COMPANION_MESH_RADIUS * 1.9, 0.018, 8, 28);
  const ring1Mat = new THREE.MeshBasicMaterial({
    color: threeColor,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const ring1 = new THREE.Mesh(ring1Geom, ring1Mat);
  ring1.rotation.x = Math.PI / 4; // 45° initial tilt — never purely face-on from any angle
  ring1.name = 'companionRing1';
  group.add(ring1);

  // -- Ring 2: starts tilted 90° + 45° from ring1 for 3D cage coverage --
  // Spins on local Z (bitangent) axis → wobbles in the normal-tangent plane
  const ring2Geom = new THREE.TorusGeometry(COMPANION_MESH_RADIUS * 1.65, 0.014, 8, 24);
  const ring2Mat = new THREE.MeshBasicMaterial({
    color: threeColor,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const ring2 = new THREE.Mesh(ring2Geom, ring2Mat);
  ring2.rotation.set(Math.PI / 2, Math.PI / 4, 0); // 90° + 45° offset from ring1
  ring2.name = 'companionRing2';
  group.add(ring2);

  return { group, material: mat, corePart, ring1, ring2 };
}
