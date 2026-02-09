import * as THREE from 'three';
import { BulletPool } from './Bullet';
import { BaseEnemy } from './enemies/BaseEnemy';
import { getSoundEngine } from '../audio/SoundEngine';
import { SurfaceAgent } from '../agents/SurfaceAgent';
import { OrbitBehavior } from '../agents/behaviors';
import type { MeshSurface } from '../experimental/mesh-movement/MeshSurface';

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
const _tempSpinAxis = new THREE.Vector3(0, 1, 0);

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

  // Glow trail data
  private glowMaterial: THREE.MeshStandardMaterial;

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
    const { group, material } = createCompanionMesh(this.color);
    this.mesh = group;
    this.glowMaterial = material;

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
    orbitBehavior.setFrame(playerTransform.tangent, playerTransform.bitangent);
    this.agent.update(dt);
    this.orbitAngle = orbitBehavior.angle; // sync for any code reading orbitAngle

    // Position mesh slightly above surface
    this.mesh.position.copy(this.agent.position);
    this.mesh.position.addScaledVector(surfaceNormal, 0.2);

    // Keep approximate UV for bullet spawning (companion is near player)
    this.surfaceU = playerU;
    this.surfaceV = playerV;

    // Orient to surface using player's tangent frame (close enough for small orbits)
    _tempOrientMat.makeBasis(playerTransform.tangent, surfaceNormal, playerTransform.bitangent);
    this.mesh.quaternion.setFromRotationMatrix(_tempOrientMat);

    // Spin the companion for visual flair
    this.mesh.rotateOnAxis(_tempSpinAxis, dt * 3);

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
      if (dist > GUARDIAN_RANGE || dist < 0.1) continue;

      _tempToEnemy.normalize();

      // Dot product with player aim: negative = behind, 0 = side, 1 = ahead
      const dotAim = playerAimDir.dot(_tempToEnemy);

      // Score: prefer enemies that are NOT in the player's forward arc
      // Behind (dot ~ -1) scores highest, directly ahead (dot ~ 1) scores lowest
      const blindSpotScore = 1.0 - dotAim; // 0 to 2, higher = more behind
      const proximityScore = 1.0 - dist / GUARDIAN_RANGE; // closer = higher

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

  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'CompanionManager';
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

export class CompanionPickup {
  readonly mesh: THREE.Group;
  readonly companionType: CompanionType;

  surfaceU: number;
  surfaceV: number;
  active = true;

  private age = 0;
  private readonly maxAge = 25; // seconds before despawn
  private readonly fadeStart = 20;
  private bobPhase: number;

  constructor(companionType: CompanionType, surfaceU: number, surfaceV: number) {
    this.companionType = companionType;
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
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
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    innerMesh.name = 'core';
    group.add(innerMesh);

    // Glow sprite (uses radial gradient texture to avoid square artifact)
    const glowMat = new THREE.SpriteMaterial({
      map: getCompanionGlowTexture(),
      color: threeColor,
      transparent: true,
      opacity: 0.35,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.setScalar(1.2);
    group.add(glowSprite);

    return group;
  }

  update(dt: number, totalTime: number): void {
    if (!this.active) return;

    this.age += dt;
    if (this.age >= this.maxAge) {
      this.active = false;
      return;
    }

    // Spin
    this.mesh.rotation.y = totalTime * 2;

    // Bob
    const bob = Math.sin(totalTime * 3 + this.bobPhase) * 0.04;
    this.mesh.position.y += bob * dt;

    // Pulse core
    const core = this.mesh.getObjectByName('core');
    if (core) {
      const pulse = 0.12 + Math.sin(totalTime * 4) * 0.025;
      core.scale.setScalar(pulse / 0.12);
    }

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
          child.material.opacity = opacity * 0.3;
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
    this.mesh.position.copy(position).add(normal.clone().multiplyScalar(0.4));
    const mat = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
    this.mesh.quaternion.setFromRotationMatrix(mat);
  }

  checkPlayerCollision(playerU: number, playerV: number): boolean {
    if (!this.active) return false;
    const du = playerU - this.surfaceU;
    const dv = playerV - this.surfaceV;
    return Math.sqrt(du * du + dv * dv) < 0.08;
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
} {
  const group = new THREE.Group();
  group.name = 'Companion';

  const threeColor = new THREE.Color(color);

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
  const mesh = new THREE.Mesh(geom, mat);
  group.add(mesh);

  // Wireframe overlay for extra definition
  const wireGeom = new THREE.OctahedronGeometry(COMPANION_MESH_RADIUS * 1.15);
  const wireMat = new THREE.MeshBasicMaterial({
    color: threeColor,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
  });
  group.add(new THREE.Mesh(wireGeom, wireMat));

  // Soft glow sprite (uses radial gradient texture to avoid square artifact)
  const spriteMat = new THREE.SpriteMaterial({
    map: getCompanionGlowTexture(),
    color: threeColor,
    transparent: true,
    opacity: 0.3,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.setScalar(0.6);
  group.add(sprite);

  // 3D torus ring for a true 3D aura visible from all angles
  const ringGeom = new THREE.TorusGeometry(COMPANION_MESH_RADIUS * 1.8, 0.015, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: threeColor,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.name = 'companionRing';
  group.add(ring);

  return { group, material: mat };
}
