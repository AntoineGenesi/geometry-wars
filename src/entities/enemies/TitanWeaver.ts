import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildDiamond3D } from '../../utils/GeometryBuilder';

/**
 * Titan Weaver - larger, tougher version of the Weaver.
 * Chases player with momentum-based movement, dodges bullets.
 * Spawns 3 regular weavers on death.
 * Visual: oversized green diamond with strong glow.
 */
export class TitanWeaver extends BaseEnemy {
  private momentumU = 0;
  private momentumV = 0;
  private readonly friction = 0.92;
  private readonly acceleration = 0.25;
  private readonly dodgeRadius = 1.0;
  private readonly dodgeForce = 0.4;

  /** Called when titan dies to spawn regular weavers */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=8, score=250, geoms=3, speed=0.035, radius=0.5
    super(surfaceU, surfaceV, 8, 250, 3, 0.035, 0.5);
    this.createMesh();
  }

  private createMesh(): void {
    // Large diamond in bright green
    this.mesh = buildDiamond3D(0.45, 0x22ff44, 0.18, 0.03);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Momentum-based chase toward player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      this.momentumU += dirU * this.acceleration * dt;
      this.momentumV += dirV * this.acceleration * dt;
    }

    // Apply friction
    this.momentumU *= this.friction;
    this.momentumV *= this.friction;

    // Limit speed
    const currentSpeed = Math.sqrt(this.momentumU * this.momentumU + this.momentumV * this.momentumV);
    if (currentSpeed > this.speed) {
      const scale = this.speed / currentSpeed;
      this.momentumU *= scale;
      this.momentumV *= scale;
    }

    this.surfacePosition = {
      u: this.surfacePosition.u + this.momentumU * dt,
      v: this.surfacePosition.v + this.momentumV * dt,
    };

    // Rotate mesh
    if (currentSpeed > 0.05 && this.mesh) {
      const angle = Math.atan2(this.momentumV, this.momentumU);
      this.mesh.rotation.z = angle + Math.PI / 4;
    }
  }

  /** Dodge away from a bullet position */
  public dodgeFromBullet(bulletU: number, bulletV: number): void {
    const deltaU = bulletU - this.surfacePosition.u;
    const deltaV = bulletV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance < this.dodgeRadius && distance > 0.01) {
      const perpU = -deltaV / distance;
      const perpV = deltaU / distance;
      this.momentumU += perpU * this.dodgeForce * 0.016;
      this.momentumV += perpV * this.dodgeForce * 0.016;
    }
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 3 regular weavers on death
    if (TitanWeaver.onDeathSpawn) {
      TitanWeaver.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 3);
    }

    super.die();
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Momentum-based chase toward player
    const delta = playerWorldPos.clone().sub(this.walker!.position);
    const distance = delta.length();

    if (distance > 0.3) { // ~0.01 UV * 30 = 0.3 world units
      const dirU = delta.x / distance;
      const dirV = delta.y / distance;

      this.momentumU += dirU * this.acceleration * dt;
      this.momentumV += dirV * this.acceleration * dt;
    }

    // Apply friction
    this.momentumU *= this.friction;
    this.momentumV *= this.friction;

    // Limit speed (UV-based momentum, convert to world units)
    const currentSpeedUV = Math.sqrt(this.momentumU * this.momentumU + this.momentumV * this.momentumV);
    if (currentSpeedUV > this.speed) {
      const scale = this.speed / currentSpeedUV;
      this.momentumU *= scale;
      this.momentumV *= scale;
    }

    // Rotate mesh based on velocity direction
    if (currentSpeedUV > 0.05 && this.mesh) {
      const angle = Math.atan2(this.momentumV, this.momentumU);
      this.mesh.rotation.z = angle + Math.PI / 4;
    }

    // Convert momentum from UV-space to world-space velocity
    if (currentSpeedUV > 0.001) {
      const frame = this.walker!.getTangentFrame();
      const worldVel = frame.tangent.clone().multiplyScalar(this.momentumU * this.walkerSpeedScale)
        .addScaledVector(frame.bitangent, this.momentumV * this.walkerSpeedScale);
      return worldVel;
    }

    return null;
  }
}
