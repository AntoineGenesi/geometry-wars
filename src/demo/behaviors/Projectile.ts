/**
 * Projectile — world-space projectile that travels straight toward a target.
 *
 * Projectiles travel through world space (not along the sphere surface).
 * They are lightweight THREE.Mesh objects that expire after a lifetime or on hit.
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';

export interface ProjectileConfig {
  /** Starting world position */
  origin: THREE.Vector3;
  /** Target world position (for direction calculation) */
  target: THREE.Vector3;
  /** Travel speed in world units per second */
  speed: number;
  /** Mesh to add to the scene */
  mesh: THREE.Mesh;
  /** World-space hit radius */
  hitRadius: number;
  /** Maximum lifetime in seconds before auto-expiry */
  lifetime: number;
  /** THREE.Scene to add/remove the mesh */
  scene: THREE.Scene;
  /** Apply a parabolic arc (downward gravity) */
  arc?: boolean;
}

export class Projectile {
  readonly mesh: THREE.Mesh;
  private readonly velocity: THREE.Vector3;
  private readonly scene: THREE.Scene;
  readonly hitRadius: number;
  private lifetime: number;
  private readonly arc: boolean;
  private dead = false;
  /** True if this projectile has been deflected back by a player bullet. */
  deflected = false;

  constructor(config: ProjectileConfig) {
    this.mesh = config.mesh;
    this.scene = config.scene;
    this.hitRadius = config.hitRadius;
    this.lifetime = config.lifetime;
    this.arc = config.arc ?? false;

    this.mesh.position.copy(config.origin);
    config.scene.add(this.mesh);

    // Compute initial velocity toward target
    const dir = new THREE.Vector3().subVectors(config.target, config.origin).normalize();
    this.velocity = dir.multiplyScalar(config.speed);
  }

  /**
   * Update position. Returns true if the projectile should be removed
   * (either expired or hit).
   */
  update(dt: number): boolean {
    if (this.dead) return true;

    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this._destroy();
      return true;
    }

    this.mesh.position.addScaledVector(this.velocity, dt);

    // Parabolic arc: slight downward pull (creates a lob trajectory)
    if (this.arc) {
      this.velocity.y -= 1.5 * dt; // gentle gravity
    }

    return false;
  }

  /** Check if this projectile is within hit radius of a world position. */
  isHitting(targetPos: THREE.Vector3): boolean {
    return this.mesh.position.distanceTo(targetPos) < this.hitRadius;
  }

  /** Mark as hit — removes from scene. */
  hit(): void {
    this._destroy();
  }

  /**
   * Deflect the projectile: reverse its velocity and change appearance.
   * After deflection it travels back toward where it came from.
   */
  deflect(): void {
    if (this.deflected || this.dead) return;
    this.deflected = true;
    this.velocity.negate();
    // Extend lifetime so deflected projectile can reach its source
    this.lifetime = Math.max(this.lifetime, 3.0);
    // Change color to cyan to indicate deflected state
    const mats = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat.color) mat.color.setHex(0x00ffff);
      if (mat.emissive) { mat.emissive.setHex(0x007777); mat.emissiveIntensity = 2.0; }
    }
  }

  get isDead(): boolean {
    return this.dead;
  }

  private _destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    if (Array.isArray(this.mesh.material)) {
      for (const m of this.mesh.material) m.dispose();
    } else {
      (this.mesh.material as THREE.Material).dispose();
    }
  }
}
