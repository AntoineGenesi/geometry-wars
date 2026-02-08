import * as THREE from 'three';
import { Entity, CollisionGroup } from '../../core/Entity';

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
