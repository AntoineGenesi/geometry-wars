import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { Entity } from '../../core/Entity';
import { buildCircle3D } from '../../utils/GeometryBuilder';

export class GravityWell extends BaseEnemy {
  private gravityActive = false;
  private consumedCount = 0;
  private readonly maxConsumed = 10;
  private readonly pullRadius = 2.0;
  private readonly pullStrength = 5;
  private pulsePhase = 0;

  public static onDetonate: ((position: THREE.Vector3, score: number) => void) | null = null;
  public static onApplyGridForce: ((u: number, v: number, strength: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    super(surfaceU, surfaceV, 10, 500, 2, 0.00625, 0.4);

    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();

    // Create concentric 3D circles/rings with depth
    const rings = [0.4, 0.3, 0.2, 0.1];
    for (const radius of rings) {
      const ring = buildCircle3D(radius, 24, 0x4488ff, 0.04, 0.012);
      group.add(ring);
    }

    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Slow drift
    if (!this.gravityActive) {
      const driftAngle = Date.now() * 0.0001;
      this.surfacePosition.u += Math.cos(driftAngle) * this.speed * dt;
      this.surfacePosition.v += Math.sin(driftAngle) * this.speed * dt;
    }

    // Pulsating scale effect
    this.pulsePhase += dt * 2;
    const scale = 1 + Math.sin(this.pulsePhase) * 0.2;
    if (this.mesh) {
      this.mesh.scale.setScalar(scale);
    }

    // Apply grid distortion when active
    if (this.gravityActive && GravityWell.onApplyGridForce) {
      GravityWell.onApplyGridForce(this.surfacePosition.u, this.surfacePosition.v, this.pullStrength);
    }

    // Check for detonation
    if (this.consumedCount >= this.maxConsumed) {
      this.detonate();
    }
  }

  takeDamage(amount: number): void {
    super.takeDamage(amount);

    // Activate on first hit
    if (!this.gravityActive) {
      this.gravityActive = true;
      // Change color to indicate activation
      if (this.mesh) {
        this.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.color) {
              mat.color.setHex(0xff00ff);
              mat.emissive.setHex(0xff00ff);
            }
          }
        });
      }
    }
  }

  // Pull nearby entities
  public pullEntity(entity: Entity): void {
    if (!this.gravityActive) return;

    const deltaU = this.surfacePosition.u - entity.surfacePosition.u;
    const deltaV = this.surfacePosition.v - entity.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance < this.pullRadius && distance > 0.01) {
      // Apply force toward gravity well
      const strength = this.pullStrength * (1 - distance / this.pullRadius);
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      // Modify entity's surface position (game would need to handle this)
      entity.surfacePosition.u += dirU * strength * 0.016;
      entity.surfacePosition.v += dirV * strength * 0.016;
    }
  }

  // Called when an enemy is consumed
  public consumeEnemy(scoreValue: number): void {
    this.consumedCount++;
    this.scoreValue += scoreValue;
    this.geomCount += 1;

    // Visual feedback
    this.pulsePhase = 0;
    const flash = 1.5;
    if (this.mesh) {
      this.mesh.scale.setScalar(flash);
    }
  }

  private detonate(): void {
    if (!this.alive) return;

    // Calculate final score based on consumed enemies
    const finalScore = this.scoreValue + this.consumedCount * 50;

    if (GravityWell.onDetonate) {
      GravityWell.onDetonate(this.position.clone(), finalScore);
    }

    this.die();
  }

  public isGravityActive(): boolean {
    return this.gravityActive;
  }

  public getPullRadius(): number {
    return this.pullRadius;
  }
}
