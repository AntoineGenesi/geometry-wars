import * as THREE from 'three';
import { Entity, CollisionGroup } from '../../core/Entity';
import { getDifficultyTier } from '../../core/DifficultyScaling';
import type { DifficultyTier } from '../../core/DifficultyScaling';
import type { Surface } from '../../surfaces/Surface';
import type { MeshWalker } from '../../movement/MeshWalker';
import { profiler } from '../../core/PerformanceProfiler';

// Pre-allocated temp objects to avoid per-frame GC pressure
const _tempMatrix4 = new THREE.Matrix4();
const _tempEuler = new THREE.Euler();
const _tempOffsetVec3 = new THREE.Vector3();
const _tempMoveDir = new THREE.Vector3();
const _tempLocalPos = new THREE.Vector3();
const _tempInverseRot = new THREE.Quaternion();

export abstract class BaseEnemy extends Entity {
  health: number;
  maxHealth: number;
  scoreValue: number;
  geomCount: number;
  speed: number;
  alive: boolean;

  /** Difficulty tier applied to this enemy (0 = normal, 1+ = scaled). */
  difficultyTier: DifficultyTier;

  /** The base enemy type name used for spawning children on split death. */
  baseTypeName: string = '';

  /** Cached array of MeshStandardMaterial refs for fast iteration (avoids traverse). */
  cachedMaterials: THREE.MeshStandardMaterial[] | null = null;

  /** When true, this enemy's visual is handled by EnemyInstanceManager (mesh hidden). */
  isInstanced: boolean = false;

  /** When true, this enemy has not yet materialized (spawn warning in progress). */
  isMaterializing: boolean = false;

  /**
   * Surface speed normalization factor. Multiplied into ALL UV movement
   * automatically by the base update() method. Ensures consistent
   * perceived speed across surfaces of different sizes.
   *
   * Set by EnemySpawner based on the surface's speedScale property.
   * Default 1.0 = no adjustment (reference surface, e.g. sphere radius=10).
   * Values < 1 = surface is bigger than reference, slow UV movement down.
   * Values > 1 = surface is smaller than reference, speed UV movement up.
   */
  surfaceSpeedScale: number = 1.0;

  /**
   * Reference to the current surface for per-position UV correction.
   * When set, update() will:
   * 1. Compute the UV Jacobian at the current position
   * 2. Scale movement deltas inversely proportional to local area distortion
   * 3. Apply proper UV wrapping/clamping via surface.wrapUV()
   *
   * This fixes enemies bunching at UV boundaries on non-toroidal surfaces
   * (sphere poles, cube top/bottom, capsule/pill caps) by ensuring equal
   * UV deltas produce equal world-space distances everywhere.
   */
  surfaceRef: Surface | null = null;

  /**
   * Mesh walker for geodesic surface movement. When set, the enemy uses
   * world-space mesh walking instead of UV-based movement. Set by
   * EnemySpawner when a MeshSurface is available.
   *
   * During migration: enemies with walker use computeMovementDirection(),
   * enemies without walker use the existing updateBehavior() UV path.
   */
  walker: MeshWalker | null = null;

  /**
   * Factor to convert UV-based speed values to world-space speed for mesh walker mode.
   * UV speed 0.06 * 30 = 1.8 world units/sec (player is 3.0).
   * Set by EnemySpawner. May be tuned per-surface in the future.
   */
  walkerSpeedScale: number = 30;

  /** Tracks damage dealt by each player (playerId -> total damage). */
  readonly damageBy: Map<number, number> = new Map();

  protected playerU: number = 0.5;
  protected playerV: number = 0.5;

  /** Player world-space position for mesh-walker-mode enemies. */
  protected _playerWorldPos: THREE.Vector3 = new THREE.Vector3();

  static onDeath: ((position: THREE.Vector3, score: number, geoms: number) => void) | null = null;

  /** Global callback for tier-based split deaths.
   *  (type, u, v, count, childTier) => void */
  static onTierSplitDeath: ((
    type: string, u: number, v: number, count: number, childTier: number
  ) => void) | null = null;

  constructor(
    surfaceU: number,
    surfaceV: number,
    health: number,
    scoreValue: number,
    geomCount: number,
    speed: number,
    radius: number = 0.3
  ) {
    super();
    this.surfacePosition = { u: surfaceU, v: surfaceV };
    this.health = health;
    this.maxHealth = health;
    this.scoreValue = scoreValue;
    this.geomCount = geomCount;
    this.speed = speed;
    this.radius = radius;
    this.alive = true;
    this.collisionGroup = CollisionGroup.Enemy;
    this.difficultyTier = getDifficultyTier(0);
  }

  /**
   * Apply a difficulty tier to this enemy, scaling health, speed, size,
   * score, and geoms. Also applies a color tint to distinguish visually.
   * Must be called after the mesh is created (in the subclass constructor).
   */
  applyDifficultyTier(tier: number): void {
    if (tier <= 0) return; // Tier 0 is default, no changes needed

    const tierData = getDifficultyTier(tier);
    this.difficultyTier = tierData;

    // Scale stats
    this.health = Math.ceil(this.health * tierData.healthMultiplier);
    this.maxHealth = this.health;
    this.speed *= tierData.speedMultiplier;
    this.scoreValue = Math.ceil(this.scoreValue * tierData.scoreMultiplier);
    this.geomCount = Math.ceil(this.geomCount * tierData.geomMultiplier);
    this.radius *= tierData.scaleMultiplier;

    // Scale mesh size
    if (this.mesh) {
      this.mesh.scale.multiplyScalar(tierData.scaleMultiplier);
    }

    // Apply color tint to visually distinguish tiered enemies
    if (this.mesh && tierData.tintColor !== 0x000000) {
      this.applyTierTint(tierData.tintColor, tierData.tier);
    }
  }

  /**
   * Tint all materials on this enemy's mesh to blend toward the tier color.
   * Higher tiers get a stronger tint. The result is the same geometry shape
   * but a distinctly different color -- "color variant" per the design spec.
   */
  private applyTierTint(tintColor: number, tier: number): void {
    if (!this.mesh) return;

    const tintStrength = Math.min(0.7, 0.3 + tier * 0.1);
    const tint = new THREE.Color(tintColor);

    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.color !== undefined) {
          mat.color.lerp(tint, tintStrength);
        }
        if (mat.emissive !== undefined) {
          mat.emissive.lerp(tint, tintStrength * 0.8);
          mat.emissiveIntensity = Math.min(1.0, (mat.emissiveIntensity || 0.4) + tier * 0.15);
        }
      }
    });
  }

  takeDamage(amount: number, attackerId: number = -1): void {
    this.health -= amount;
    if (attackerId >= 0) {
      const prev = this.damageBy.get(attackerId) ?? 0;
      this.damageBy.set(attackerId, prev + amount);
    }
    if (this.health <= 0) {
      this.die();
    }
  }

  die(): void {
    this.alive = false;
    this.active = false;

    // Tier-based splitting: if this enemy's tier has splitCount > 0,
    // spawn children of the same base type at a lower tier
    const tier = this.difficultyTier;
    if (tier.splitCount > 0 && this.baseTypeName && BaseEnemy.onTierSplitDeath) {
      BaseEnemy.onTierSplitDeath(
        this.baseTypeName,
        this.surfacePosition.u,
        this.surfacePosition.v,
        tier.splitCount,
        tier.splitChildTier,
      );
    }

    if (BaseEnemy.onDeath) {
      BaseEnemy.onDeath(this.position.clone(), this.scoreValue, this.geomCount);
    }
  }

  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    }
  ): void {
    if (this.walker) {
      // ===== MESH WALKER MODE =====
      // Position/normal come directly from walker — no UV lookup needed
      this.position.copy(this.walker.position);

      if (this.mesh) {
        _tempOffsetVec3.copy(this.walker.position);
        _tempOffsetVec3.addScaledVector(this.walker.normal, this.radius);
        this.mesh.position.copy(_tempOffsetVec3);

        const frame = this.walker.getTangentFrame();
        _tempMatrix4.makeBasis(frame.bitangent, frame.normal, frame.tangent);
        _tempEuler.setFromRotationMatrix(_tempMatrix4);
        this.mesh.rotation.copy(_tempEuler);
      }
    } else {
      // ===== UV MODE (existing) =====
      const transform = getTransform(this.surfacePosition.u, this.surfacePosition.v);
      this.position.copy(transform.position);

      if (this.mesh) {
        _tempOffsetVec3.copy(transform.position);
        _tempOffsetVec3.addScaledVector(transform.normal, this.radius);
        this.mesh.position.copy(_tempOffsetVec3);

        _tempMatrix4.makeBasis(transform.bitangent, transform.normal, transform.tangent);
        _tempEuler.setFromRotationMatrix(_tempMatrix4);
        this.mesh.rotation.copy(_tempEuler);
      }
    }

    // Cache material references on first transform (avoids traverse every frame)
    if (this.mesh && !this.cachedMaterials) {
      this.cachedMaterials = [];
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.emissive !== undefined) {
            this.cachedMaterials!.push(mat);
          }
        }
      });
    }
  }

  setPlayerPosition(u: number, v: number): void {
    this.playerU = u;
    this.playerV = v;
  }

  /** Set player world-space position (used by mesh-walker-mode enemies). */
  setPlayerWorldPosition(worldPos: THREE.Vector3): void {
    this._playerWorldPos.copy(worldPos);
  }

  abstract updateBehavior(dt: number, playerU: number, playerV: number): void;

  /**
   * Compute desired movement in world space. Override this instead of
   * updateBehavior() for mesh-walker-based enemies.
   *
   * @returns World-space velocity vector (direction * speed in world units/sec),
   *          or null for no movement this frame. The base class extracts speed
   *          from the vector length and passes direction to walker.move().
   */
  computeMovementDirection(_dt: number, _playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    return null; // Default: no movement. Subclasses override when migrated to walker mode.
  }

  update(dt: number): void {
    if (!this.alive) return;

    if (this.walker) {
      // ===== MESH WALKER MODE =====
      profiler.begin('enemy_walker_mode');
      if (typeof window !== 'undefined' && (window as any).__debugEnemyUV) {
        console.log(`[Enemy ${this.constructor.name}] Entering walker mode, walker exists:`, !!this.walker);
      }
      // Enemy computes world-space velocity; walker handles surface-constrained movement.
      const velocity = this.computeMovementDirection(dt, this._playerWorldPos);
      if (velocity && velocity.lengthSq() > 0.0001) {
        const speed = velocity.length();
        this.walker.speed = speed;
        _tempMoveDir.copy(velocity).multiplyScalar(1 / speed); // normalize without alloc
        this.walker.move(_tempMoveDir, dt);
      }

      // Sync world position from walker
      this.position.copy(this.walker.position);

      // Bridge: derive UV coordinates for backward compatibility
      // (separation, DDA, gate pass-through, collision, etc. still use UV)
      // FIX: worldToSurface() expects local coordinates (before world rotation),
      // but walker.position is in world coordinates. Must apply inverse rotation first.
      if (this.surfaceRef) {
        _tempInverseRot.copy(this.surfaceRef.worldRotation).invert();
        _tempLocalPos.copy(this.walker.position).applyQuaternion(_tempInverseRot);
        const uv = this.surfaceRef.worldToSurface(_tempLocalPos);
        if (typeof window !== 'undefined' && (window as any).__debugEnemyUV) {
          console.log(`[Enemy ${this.constructor.name}] Walker mode UV sync: (${uv.u.toFixed(3)}, ${uv.v.toFixed(3)}) from world (${this.walker.position.x.toFixed(2)}, ${this.walker.position.y.toFixed(2)}, ${this.walker.position.z.toFixed(2)})`);
        }
        this.surfacePosition.u = uv.u;
        this.surfacePosition.v = uv.v;
      }
      profiler.end('enemy_walker_mode');
    } else {
      // ===== UV MODE (existing) =====
      if (typeof window !== 'undefined' && (window as any).__debugEnemyUV) {
        console.log(`[Enemy ${this.constructor.name}] Using UV mode (no walker)`);
      }
      // Record UV position before behavior update
      const prevU = this.surfacePosition.u;
      const prevV = this.surfacePosition.v;

      profiler.begin('enemy_uv_behavior');
      this.updateBehavior(dt, this.playerU, this.playerV);
      profiler.end('enemy_uv_behavior');

      // Compute the raw UV delta the subclass produced
      let deltaU = this.surfacePosition.u - prevU;
      let deltaV = this.surfacePosition.v - prevV;

      // Skip correction if movement is negligible
      if (Math.abs(deltaU) < 0.000001 && Math.abs(deltaV) < 0.000001) return;

      // Apply global surface speed normalization
      if (this.surfaceSpeedScale !== 1.0) {
        deltaU *= this.surfaceSpeedScale;
        deltaV *= this.surfaceSpeedScale;
      }

      profiler.begin('enemy_uv_correction');
      if (this.surfaceRef) {
        // Route through surface.moveOnSurface() which provides:
        // - Per-position UV correction (sphere pole compression, cube face convergence, etc.)
        // - Proper UV wrapping/clamping for the surface topology
        const result = this.surfaceRef.moveOnSurface(prevU, prevV, deltaU, deltaV);
        this.surfacePosition.u = result.u;
        this.surfacePosition.v = result.v;
      } else {
        // Fallback: apply delta directly with basic clamping (legacy behavior)
        this.surfacePosition.u = prevU + deltaU;
        this.surfacePosition.v = prevV + deltaV;
      }
      profiler.end('enemy_uv_correction');
    }
  }

  onCollision(other: Entity): void {
    // Base collision handling - can be overridden
  }
}
