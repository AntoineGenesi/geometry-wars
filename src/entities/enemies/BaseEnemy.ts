import * as THREE from 'three';
import { Entity, CollisionGroup } from '../../core/Entity';
import { getDifficultyTier } from '../../core/DifficultyScaling';
import type { DifficultyTier } from '../../core/DifficultyScaling';

// Pre-allocated temp objects to avoid per-frame GC pressure
const _tempMatrix4 = new THREE.Matrix4();
const _tempEuler = new THREE.Euler();
const _tempOffsetVec3 = new THREE.Vector3();

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

  /** Tracks damage dealt by each player (playerId -> total damage). */
  readonly damageBy: Map<number, number> = new Map();

  protected playerU: number = 0.5;
  protected playerV: number = 0.5;

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
    const transform = getTransform(this.surfacePosition.u, this.surfacePosition.v);

    this.position.copy(transform.position);

    if (this.mesh) {
      // Offset the visual mesh above the surface by the enemy's radius
      // Uses pre-allocated vector instead of clone()
      _tempOffsetVec3.copy(transform.position);
      _tempOffsetVec3.addScaledVector(transform.normal, this.radius);
      this.mesh.position.copy(_tempOffsetVec3);

      // Reuse pre-allocated Matrix4/Euler instead of new allocations
      _tempMatrix4.makeBasis(transform.bitangent, transform.normal, transform.tangent);
      _tempEuler.setFromRotationMatrix(_tempMatrix4);
      this.mesh.rotation.copy(_tempEuler);

      // Cache material references on first transform (avoids traverse every frame)
      if (!this.cachedMaterials) {
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
  }

  setPlayerPosition(u: number, v: number): void {
    this.playerU = u;
    this.playerV = v;
  }

  abstract updateBehavior(dt: number, playerU: number, playerV: number): void;

  update(dt: number): void {
    if (!this.alive) return;

    this.updateBehavior(dt, this.playerU, this.playerV);
  }

  onCollision(other: Entity): void {
    // Base collision handling - can be overridden
  }
}
