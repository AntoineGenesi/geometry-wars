import * as THREE from 'three';
import { Entity, CollisionGroup } from '../../core/Entity';
import {
  getDifficultyTier,
  getContinuousHealthMultiplier,
  getContinuousSpeedMultiplier,
  getContinuousScaleMultiplier,
  MAX_TIER,
} from '../../core/DifficultyScaling';
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
const _tempSurfaceTargetPos = new THREE.Vector3();
const _tempSurfacePathDir = new THREE.Vector3();
const _tempPullLocalTarget = new THREE.Vector3();
const _tempPullTangent = new THREE.Vector3();
const _tempPullSpiral = new THREE.Vector3();
const _tempPreMovePos = new THREE.Vector3();
const DAMAGE_AGGRO_NATURAL_SPEED_TYPES = new Set([
  'grunt',
  'approach_glow',
  'stealth_stalker',
]);

// These bodies continuously steer toward the player (rather than following a
// fixed patrol, firing pattern, or the repulsor/magnet charge state).  Their
// individual implementations intentionally vary, but they must share the
// same readable closing-speed rule so a tier multiplier cannot turn a small
// tracker into an unavoidable contact hit.
const DIRECT_TRACKING_ENEMY_TYPES = new Set([
  'grunt',
  'mayfly',
  'swarm',
  'weaver',
  'spinner',
  'helix',
  'approach_glow',
  'stealth_stalker',
  'phaser',
  'orbiter',
  'sentinel_orb',
  'shatter_bloom',
  'titan_spinner',
  'titan_weaver',
]);

// Player walk speed is 3 world units/second on the reference surface. Direct
// trackers stay below it even after difficulty scaling, then brake hard inside
// melee range. This keeps a swarm threatening from afar without letting it
// erase the player's reaction window after it has reached them.
const TRACKING_FAR_SPEED_CAP = 2.1;
const TRACKING_CLOSE_SPEED_CAP = 0.9;
const TRACKING_BRAKE_START_DISTANCE = 5.0;

export abstract class BaseEnemy extends Entity {
  static readonly DAMAGE_AGGRO_DURATION = 4;

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
   * When true, this enemy is invisible/phasing and must not deal contact damage to the player.
   * Set by enemies like Phaser that cycle between visible and invisible states.
   * Does NOT affect bullet collision — bullets are still blocked (takeDamage is overridden).
   */
  isGhostForPlayer: boolean = false;

  /** Slow/stun movement factor. 1.0 = full speed, 0.0 = complete stun. */
  slowFactor: number = 1.0;
  /** Seconds remaining on the current slow/stun effect. */
  slowTimer: number = 0;

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

  /** Last commanded movement speed in world units/sec, exposed for live pressure proof. */
  lastCommandedWorldSpeed: number = 0;
  /** Last actual movement speed after MeshWalker projection, in world units/sec. */
  lastActualWorldSpeed: number = 0;
  /** Last world-space distance to the current player target. */
  lastDistanceToPlayer: number = 0;
  /** Whether this frame used the damage-aggro steering override. */
  lastDamageAggroActive: boolean = false;
  /** Whether this frame used mesh-walker or legacy UV movement. */
  lastMovementMode: 'walker' | 'uv' = 'uv';

  /**
   * Extra THREE.Object3D roots that were added to the scene alongside `mesh`.
   * Examples: Snake.segmentRoot, Painter.trailRoot.
   * Cleanup code (EnemySpawner, network-main.ts) removes these when the enemy dies.
   * Subclasses push their extra roots here in their constructor.
   */
  readonly auxiliaryObjects: THREE.Object3D[] = [];

  /** Tracks damage dealt by each player (playerId -> total damage). */
  readonly damageBy: Map<number, number> = new Map();
  /** Temporary player-owned damage target override; -1 means normal strategy. */
  aggroTargetId: number = -1;
  aggroUntil: number = 0;
  private _behaviorTime: number = 0;

  protected playerU: number = 0.5;
  protected playerV: number = 0.5;

  /** Player world-space position for mesh-walker-mode enemies. */
  protected _playerWorldPos: THREE.Vector3 = new THREE.Vector3();

  /** Knockback UV velocity (decays exponentially, half-life ~0.2s). */
  private _knockbackU: number = 0;
  private _knockbackV: number = 0;

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
   * Apply continuous difficulty scaling beyond tier 4 boundaries.
   *
   * Calls applyDifficultyTier(intTier) first to apply color tint, split behavior,
   * score/geom/radius scaling. Then overrides health and speed with continuous
   * values from getContinuousHealthMultiplier / getContinuousSpeedMultiplier.
   * For super-tier (difficultyLevel > MAX_TIER), also applies additional scale
   * and increased emissive glow.
   *
   * Must be called INSTEAD of applyDifficultyTier() when difficultyLevel > MAX_TIER.
   */
  applyDifficultyTierContinuous(difficultyLevel: number): void {
    const intTier = Math.min(MAX_TIER, Math.floor(difficultyLevel));

    // Save base values before discrete tier mutates them in-place
    const baseHealth = this.health;
    const baseSpeed = this.speed;

    // Apply discrete tier: sets difficultyTier (split behavior), tint, score, geom, mesh scale
    this.applyDifficultyTier(intTier);

    // Override health/speed with continuous values derived from original base stats
    const continuousHealth = getContinuousHealthMultiplier(difficultyLevel);
    const continuousSpeed = getContinuousSpeedMultiplier(difficultyLevel);
    this.maxHealth = Math.ceil(baseHealth * continuousHealth);
    this.health = this.maxHealth;
    this.speed = baseSpeed * continuousSpeed;

    // Apply additional scale beyond the discrete tier's contribution
    if (difficultyLevel > MAX_TIER && intTier > 0) {
      const continuousScale = getContinuousScaleMultiplier(difficultyLevel);
      const discreteScale = getDifficultyTier(intTier).scaleMultiplier;
      const additionalScale = continuousScale / discreteScale;
      if (additionalScale > 1.0) {
        if (this.mesh) {
          this.mesh.scale.multiplyScalar(additionalScale);
        }
        this.radius *= additionalScale;
      }

      // Visual signal: boost emissive glow for super-tier enemies (difficulty >= 5)
      if (difficultyLevel >= 5) {
        this.applySupertierGlow(difficultyLevel);
      }
    }
  }

  /**
   * Boost emissive glow intensity for super-tier enemies to visually signal
   * their increased power beyond normal tier 4. Called by applyDifficultyTierContinuous.
   */
  private applySupertierGlow(difficultyLevel: number): void {
    if (!this.mesh) return;
    const extraIntensity = Math.min(2.0, (difficultyLevel - MAX_TIER) * 0.3);
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive !== undefined) {
          mat.emissiveIntensity = Math.min(3.0, (mat.emissiveIntensity || 0.4) + extraIntensity);
        }
      }
    });
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
    if (this.health > 0 && attackerId >= 0) {
      this.aggroTargetId = attackerId;
      this.aggroUntil = this._behaviorTime + BaseEnemy.DAMAGE_AGGRO_DURATION;
    }
    if (this.health <= 0) {
      this.aggroTargetId = -1;
      this.aggroUntil = 0;
      this.die();
    }
  }

  isDamageAggroActive(): boolean {
    return this.aggroTargetId >= 0 && this._behaviorTime < this.aggroUntil;
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

        // Use direct read-only getters — zero allocations vs getTangentFrame() which clones 3 Vector3s
        // Use quaternion directly to skip the Euler→rotation conversion step
        _tempMatrix4.makeBasis(this.walker.bitangent, this.walker.normal, this.walker.tangent);
        this.mesh.quaternion.setFromRotationMatrix(_tempMatrix4);
      }
    } else {
      // ===== UV MODE (existing) =====
      const transform = getTransform(this.surfacePosition.u, this.surfacePosition.v);
      this.position.copy(transform.position);

      if (this.mesh) {
        _tempOffsetVec3.copy(transform.position);
        _tempOffsetVec3.addScaledVector(transform.normal, this.radius);
        this.mesh.position.copy(_tempOffsetVec3);

        // Use quaternion directly to skip the Euler→rotation conversion step
        _tempMatrix4.makeBasis(transform.bitangent, transform.normal, transform.tangent);
        this.mesh.quaternion.setFromRotationMatrix(_tempMatrix4);
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

  /** Apply a server-authoritative mesh location without reconstructing from UV. */
  applyCanonicalSurfaceTransform(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    tangent: THREE.Vector3,
    bitangent: THREE.Vector3,
  ): void {
    this.position.copy(position);
    if (this.mesh) {
      _tempOffsetVec3.copy(position).addScaledVector(normal, this.radius);
      this.mesh.position.copy(_tempOffsetVec3);
      _tempMatrix4.makeBasis(bitangent, normal, tangent);
      this.mesh.quaternion.setFromRotationMatrix(_tempMatrix4);
    }

    if (this.mesh && !this.cachedMaterials) {
      this.cachedMaterials = [];
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.emissive !== undefined) this.cachedMaterials!.push(mat);
        }
      });
    }
  }

  setPlayerPosition(u: number, v: number): void {
    this.playerU = u;
    this.playerV = v;
  }

  /**
   * Apply a UV-space knockback impulse to this enemy.
   * The impulse decays exponentially with half-life ~0.2s.
   * Walker-mode enemies ignore knockback (UV knockback is not meaningful in world-space walking).
   *
   * @param impulseU - UV velocity to add in the U direction
   * @param impulseV - UV velocity to add in the V direction
   */
  applyKnockback(impulseU: number, impulseV: number): void {
    if (this.walker) return; // Skip walker-mode enemies
    this._knockbackU += impulseU;
    this._knockbackV += impulseV;
  }

  /**
   * Move this enemy toward a world-space field center along its current surface.
   * Walker enemies use geodesic movement; legacy UV enemies route through the
   * surface movement API. The displacement is fully delta-time based.
   */
  applySurfacePull(
    center: THREE.Vector3,
    pullSpeed: number,
    spiralRatio: number,
    dt: number,
  ): boolean {
    if (!this.alive || pullSpeed <= 0 || dt <= 0) return false;

    if (this.walker) {
      _tempPullTangent.copy(center).sub(this.walker.position);
      _tempPullTangent.addScaledVector(
        this.walker.normal,
        -_tempPullTangent.dot(this.walker.normal),
      );

      // A nearby field has an unambiguous tangent direction. MeshWalker owns
      // the actual face crossing; UV routing is only needed for a degenerate
      // world chord (for example, separated tunnel walls).
      if (_tempPullTangent.lengthSq() <= 0.000001 && this.surfaceRef) {
        _tempInverseRot.copy(this.surfaceRef.worldRotation).invert();
        _tempPullLocalTarget.copy(center).applyQuaternion(_tempInverseRot);
        const targetUV = this.surfaceRef.worldToSurface(_tempPullLocalTarget);
        const deltaU = this.shortestAxisDelta(
          this.surfacePosition.u,
          targetUV.u,
          this.surfaceRef.wrapsU,
        );
        const deltaV = this.shortestAxisDelta(
          this.surfacePosition.v,
          targetUV.v,
          this.surfaceRef.wrapsV,
        );
        const uvDistance = Math.hypot(deltaU, deltaV);
        if (uvDistance > 0.000001) {
          const uvStep = Math.min(0.025, uvDistance);
          const next = this.surfaceRef.moveOnSurface(
            this.surfacePosition.u,
            this.surfacePosition.v,
            deltaU / uvDistance * uvStep,
            deltaV / uvDistance * uvStep,
          );
          const nextPoint = this.surfaceRef.getPoint(next.u, next.v);
          _tempSurfaceTargetPos.copy(nextPoint.position)
            .applyQuaternion(this.surfaceRef.worldRotation)
            .multiplyScalar(this.surfaceRef.group.scale.x);
          _tempPullTangent.copy(_tempSurfaceTargetPos).sub(this.walker.position);
        }
      }

      _tempPullTangent.addScaledVector(
        this.walker.normal,
        -_tempPullTangent.dot(this.walker.normal),
      );
      if (_tempPullTangent.lengthSq() <= 0.000001) return false;
      _tempPullTangent.normalize();
      _tempPullSpiral.crossVectors(this.walker.normal, _tempPullTangent).normalize();
      _tempMoveDir.copy(_tempPullTangent)
        .addScaledVector(_tempPullSpiral, spiralRatio)
        .normalize();
      this.walker.speed = pullSpeed;
      this.walker.move(_tempMoveDir, dt);
      this.position.copy(this.walker.position);

      if (this.surfaceRef) {
        _tempInverseRot.copy(this.surfaceRef.worldRotation).invert();
        _tempLocalPos.copy(this.walker.position).applyQuaternion(_tempInverseRot);
        const uv = this.surfaceRef.worldToSurface(_tempLocalPos);
        this.surfacePosition.u = uv.u;
        this.surfacePosition.v = uv.v;
      }
      return true;
    }

    if (!this.surfaceRef) return false;
    _tempInverseRot.copy(this.surfaceRef.worldRotation).invert();
    _tempPullLocalTarget.copy(center).applyQuaternion(_tempInverseRot);
    const targetUV = this.surfaceRef.worldToSurface(_tempPullLocalTarget);
    const deltaU = this.shortestAxisDelta(this.surfacePosition.u, targetUV.u, this.surfaceRef.wrapsU);
    const deltaV = this.shortestAxisDelta(this.surfacePosition.v, targetUV.v, this.surfaceRef.wrapsV);
    const uvDistance = Math.hypot(deltaU, deltaV);
    if (uvDistance <= 0.000001) return false;

    const radialU = deltaU / uvDistance;
    const radialV = deltaV / uvDistance;
    const directionU = radialU - radialV * spiralRatio;
    const directionV = radialV + radialU * spiralRatio;
    const directionLength = Math.hypot(directionU, directionV);
    const uvStep = pullSpeed / this.walkerSpeedScale * dt;
    const next = this.surfaceRef.moveOnSurface(
      this.surfacePosition.u,
      this.surfacePosition.v,
      directionU / directionLength * uvStep,
      directionV / directionLength * uvStep,
    );
    this.surfacePosition.u = next.u;
    this.surfacePosition.v = next.v;
    return true;
  }

  /**
   * Apply a slow or stun to this enemy. Uses the strongest active effect
   * (lowest slowFactor). Duration is refreshed if the incoming effect is at
   * least as strong as the current one.
   *
   * @param factor - Movement speed multiplier: 0 = full stun, 0.7 = 30% slow
   * @param duration - Seconds the effect lasts
   */
  applySlowEffect(factor: number, duration: number): void {
    if (factor <= this.slowFactor) {
      this.slowFactor = factor;
      this.slowTimer = duration;
    }
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

  private shortestAxisDelta(current: number, target: number, wraps: boolean): number {
    let delta = target - current;
    if (wraps) {
      if (delta > 0.5) delta -= 1.0;
      if (delta < -0.5) delta += 1.0;
    }
    return delta;
  }

  private cubeTunnelVRegion(v: number): 'outerWall' | 'topLip' | 'innerWall' | 'bottomLip' | null {
    const surface = this.surfaceRef as (Surface & { outerWallFrac?: number; lipFrac?: number }) | null;
    const outerWallFrac = surface?.outerWallFrac;
    const lipFrac = surface?.lipFrac;
    if (typeof outerWallFrac !== 'number' || typeof lipFrac !== 'number') return null;

    const wrapped = ((v % 1) + 1) % 1;
    if (wrapped < outerWallFrac) return 'outerWall';
    if (wrapped < outerWallFrac + lipFrac) return 'topLip';
    if (wrapped < 2 * outerWallFrac + lipFrac) return 'innerWall';
    return 'bottomLip';
  }

  private shouldUseSurfacePathAcrossWall(): boolean {
    if (!this.surfaceRef) return false;
    if (this.surfaceRef.areOnOppositeWallSides(this.playerV, this.surfacePosition.v)) return true;

    const playerRegion = this.cubeTunnelVRegion(this.playerV);
    const enemyRegion = this.cubeTunnelVRegion(this.surfacePosition.v);
    if (!playerRegion || !enemyRegion) return false;

    if (playerRegion === 'innerWall') return enemyRegion !== 'innerWall';
    if (playerRegion === 'outerWall') return enemyRegion !== 'outerWall';
    return false;
  }

  /**
   * Cube-tunnel has two nearby-but-separated wall sides. A straight world chord
   * from an outer wall enemy to an inner wall player points through the wall;
   * MeshWalker projects that onto almost no tangent motion, so the enemy stalls.
   * When the surface exposes that topology, steer toward the next wrapped UV
   * neighbor instead while preserving the subclass-chosen speed.
   */
  private applyOppositeWallSurfacePath(velocity: THREE.Vector3): THREE.Vector3 {
    if (!this.walker || !this.surfaceRef) return velocity;
    if (!this.shouldUseSurfacePathAcrossWall()) return velocity;

    const speed = velocity.length();
    if (speed <= 0.0001) return velocity;

    const deltaU = this.shortestAxisDelta(this.surfacePosition.u, this.playerU, this.surfaceRef.wrapsU);
    const deltaV = this.shortestAxisDelta(this.surfacePosition.v, this.playerV, this.surfaceRef.wrapsV);
    const uvLen = Math.sqrt(deltaU * deltaU + deltaV * deltaV);
    if (uvLen <= 0.000001) return velocity;

    const step = Math.min(0.02, uvLen);
    const next = this.surfaceRef.moveOnSurface(
      this.surfacePosition.u,
      this.surfacePosition.v,
      (deltaU / uvLen) * step,
      (deltaV / uvLen) * step,
    );
    const surfacePoint = this.surfaceRef.getPoint(next.u, next.v);
    _tempSurfaceTargetPos.copy(surfacePoint.position);
    _tempSurfacePathDir.copy(_tempSurfaceTargetPos).sub(this.walker.position);
    const pathLen = _tempSurfacePathDir.length();
    if (pathLen <= 0.0001) return velocity;

    return _tempSurfacePathDir.multiplyScalar(speed / pathLen);
  }

  private shouldCapDamageAggroToNaturalSpeed(): boolean {
    const type = this.baseTypeName || this.constructor.name.toLowerCase();
    return DAMAGE_AGGRO_NATURAL_SPEED_TYPES.has(type);
  }

  private getTrackingSpeedCap(distanceToPlayer: number): number | null {
    const type = this.baseTypeName || this.constructor.name.toLowerCase();
    if (!DIRECT_TRACKING_ENEMY_TYPES.has(type)) return null;

    // Linearly restore normal tracking speed over the final five world units.
    // This deliberately excludes repulsors and other telegraphed special moves.
    const rangeFactor = Math.max(0, Math.min(1, distanceToPlayer / TRACKING_BRAKE_START_DISTANCE));
    return TRACKING_CLOSE_SPEED_CAP +
      (TRACKING_FAR_SPEED_CAP - TRACKING_CLOSE_SPEED_CAP) * rangeFactor;
  }

  private capTrackingVelocity(velocity: THREE.Vector3, distanceToPlayer: number): THREE.Vector3 {
    const speedCap = this.getTrackingSpeedCap(distanceToPlayer);
    if (speedCap === null || velocity.lengthSq() <= speedCap * speedCap) return velocity;
    return velocity.multiplyScalar(speedCap / velocity.length());
  }

  update(dt: number): void {
    if (!this.alive) return;
    this._behaviorTime += dt;
    if (this.aggroTargetId >= 0 && this._behaviorTime >= this.aggroUntil) {
      this.aggroTargetId = -1;
      this.aggroUntil = 0;
    }

    // Tick slow/stun timer and compute effective delta time
    if (this.slowTimer > 0) {
      this.slowTimer = Math.max(0, this.slowTimer - dt);
      if (this.slowTimer === 0) this.slowFactor = 1.0;
    }
    const effectiveDt = dt * this.slowFactor;

    if (this.walker) {
      // ===== MESH WALKER MODE =====
      profiler.begin('enemy_walker_mode');
      if (typeof window !== 'undefined' && (window as any).__debugEnemyUV) {
        console.log(`[Enemy ${this.constructor.name}] Entering walker mode, walker exists:`, !!this.walker);
      }
      this.lastMovementMode = 'walker';
      this.lastDamageAggroActive = this.isDamageAggroActive();
      this.lastDistanceToPlayer = this._playerWorldPos.distanceTo(this.walker.position);
      this.lastCommandedWorldSpeed = 0;
      this.lastActualWorldSpeed = 0;
      _tempPreMovePos.copy(this.walker.position);

      const capAggroToNaturalSpeed = this.lastDamageAggroActive && this.shouldCapDamageAggroToNaturalSpeed();
      // Enemy computes world-space velocity; walker handles surface-constrained movement.
      // For specific early chasers, damage aggro should retarget without turning their
      // high legacy constructor speed into a faster-than-player magnet. Leave phase/timer
      // enemies on the old raw aggro path because their movement methods are stateful.
      const naturalVelocity = !this.lastDamageAggroActive || capAggroToNaturalSpeed
        ? this.computeMovementDirection(effectiveDt, this._playerWorldPos)
        : null;
      const velocity = this.lastDamageAggroActive
        ? (() => {
          const aggroDir = _tempSurfacePathDir.copy(this._playerWorldPos).sub(this.walker!.position);
          if (aggroDir.lengthSq() <= 0.0001) return null;
          const rawAggroSpeed = this.speed * this.walkerSpeedScale;
          const naturalSpeed = capAggroToNaturalSpeed ? naturalVelocity?.length() ?? 0 : 0;
          const aggroSpeed = capAggroToNaturalSpeed && naturalSpeed > 0.0001
            ? Math.min(rawAggroSpeed, naturalSpeed)
            : rawAggroSpeed;
          return aggroDir.normalize().multiplyScalar(aggroSpeed);
        })()
        : naturalVelocity;
      if (velocity && velocity.lengthSq() > 0.0001) {
        const cappedVelocity = this.capTrackingVelocity(velocity, this.lastDistanceToPlayer);
        const movementVelocity = this.applyOppositeWallSurfacePath(cappedVelocity);
        const speed = movementVelocity.length();
        this.lastCommandedWorldSpeed = speed;
        this.walker.speed = speed;
        _tempMoveDir.copy(movementVelocity).multiplyScalar(1 / speed); // normalize without alloc
        this.walker.move(_tempMoveDir, effectiveDt);
      }

      // Sync world position from walker
      this.position.copy(this.walker.position);
      if (effectiveDt > 0) {
        this.lastActualWorldSpeed = _tempPreMovePos.distanceTo(this.walker.position) / effectiveDt;
      }

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
      this.lastMovementMode = 'uv';
      this.lastDamageAggroActive = this.isDamageAggroActive();
      this.lastCommandedWorldSpeed = 0;
      this.lastActualWorldSpeed = 0;
      if (typeof window !== 'undefined' && (window as any).__debugEnemyUV) {
        console.log(`[Enemy ${this.constructor.name}] Using UV mode (no walker)`);
      }
      // Record UV position before knockback + behavior update
      const prevU = this.surfacePosition.u;
      const prevV = this.surfacePosition.v;

      // Apply knockback displacement before behavior (so behavior runs from knocked-back position)
      if (this._knockbackU !== 0 || this._knockbackV !== 0) {
        this.surfacePosition.u += this._knockbackU * dt;
        this.surfacePosition.v += this._knockbackV * dt;
        // Exponential decay — half-life 0.2s: factor = 0.5^(dt/0.2)
        const decay = Math.pow(0.5, dt / 0.2);
        this._knockbackU *= decay;
        this._knockbackV *= decay;
        // Zero out negligible residual
        if (Math.abs(this._knockbackU) < 0.0001) this._knockbackU = 0;
        if (Math.abs(this._knockbackV) < 0.0001) this._knockbackV = 0;
      }

      // Keep combat knockback intact; only clamp the voluntary/aggro movement
      // that follows it below.
      const behaviorStartU = this.surfacePosition.u;
      const behaviorStartV = this.surfacePosition.v;

      profiler.begin('enemy_uv_behavior');
      if (this.isDamageAggroActive()) {
        const wrapsU = this.surfaceRef?.wrapsU ?? true;
        const wrapsV = this.surfaceRef?.wrapsV ?? false;
        const deltaU = this.shortestAxisDelta(this.surfacePosition.u, this.playerU, wrapsU);
        const deltaV = this.shortestAxisDelta(this.surfacePosition.v, this.playerV, wrapsV);
        const distance = Math.hypot(deltaU, deltaV);
        if (distance > 0.0001) {
          this.surfacePosition.u += (deltaU / distance) * this.speed * effectiveDt;
          this.surfacePosition.v += (deltaV / distance) * this.speed * effectiveDt;
        }
      } else {
        this.updateBehavior(effectiveDt, this.playerU, this.playerV);
      }
      profiler.end('enemy_uv_behavior');

      const trackingSpeedCap = this.getTrackingSpeedCap(
        Math.hypot(
          this.shortestAxisDelta(behaviorStartU, this.playerU, this.surfaceRef?.wrapsU ?? true),
          this.shortestAxisDelta(behaviorStartV, this.playerV, this.surfaceRef?.wrapsV ?? false),
        ) * this.walkerSpeedScale,
      );
      if (trackingSpeedCap !== null && effectiveDt > 0) {
        const behaviorDeltaU = this.surfacePosition.u - behaviorStartU;
        const behaviorDeltaV = this.surfacePosition.v - behaviorStartV;
        const behaviorDistance = Math.hypot(behaviorDeltaU, behaviorDeltaV);
        const behaviorCap = trackingSpeedCap / this.walkerSpeedScale * effectiveDt;
        if (behaviorDistance > behaviorCap) {
          const scale = behaviorCap / behaviorDistance;
          this.surfacePosition.u = behaviorStartU + behaviorDeltaU * scale;
          this.surfacePosition.v = behaviorStartV + behaviorDeltaV * scale;
        }
      }

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

export function getEnemyTypeKey(enemy: BaseEnemy): string {
  return enemy.baseTypeName || enemy.constructor.name.toLowerCase();
}
