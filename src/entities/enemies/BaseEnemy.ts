import * as THREE from 'three';
import { Entity, CollisionGroup } from '../../core/Entity';

export abstract class BaseEnemy extends Entity {
  health: number;
  maxHealth: number;
  scoreValue: number;
  geomCount: number;
  speed: number;
  alive: boolean;

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
      // This prevents enemies from appearing half-embedded in the surface
      const offsetPosition = transform.position.clone();
      offsetPosition.addScaledVector(transform.normal, this.radius);
      this.mesh.position.copy(offsetPosition);

      const up = transform.normal;
      const forward = transform.tangent;
      const right = transform.bitangent;

      const rotationMatrix = new THREE.Matrix4();
      rotationMatrix.makeBasis(right, up, forward);

      const rotation = new THREE.Euler();
      rotation.setFromRotationMatrix(rotationMatrix);
      this.mesh.rotation.copy(rotation);
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
