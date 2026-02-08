import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { CollisionGroup } from '../../core/Entity';
import { buildDiamond3D } from '../../utils/GeometryBuilder';

export class Weaver extends BaseEnemy {
  private momentumU: number = 0;
  private momentumV: number = 0;
  private readonly friction = 0.92;
  private readonly acceleration = 0.3;
  private readonly dodgeRadius = 0.8;
  private readonly dodgeForce = 0.375;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    super(surfaceU, surfaceV, 2, 25, 1, 0.04, 0.3); // Reduced speed

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D diamond prism shape with green color
    const size = 0.3;
    this.mesh = buildDiamond3D(size, 0x00ff44, 0.15, 0.025);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Calculate direction to player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      // Apply acceleration toward player
      this.momentumU += dirU * this.acceleration * dt;
      this.momentumV += dirV * this.acceleration * dt;
    }

    // Check for nearby bullets and dodge
    this.checkAndDodgeBullets();

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

    // Update position
    this.surfacePosition = {
      u: this.surfacePosition.u + this.momentumU * dt,
      v: this.surfacePosition.v + this.momentumV * dt
    };

    // Rotate mesh based on movement direction
    if (currentSpeed > 0.1 && this.mesh) {
      const angle = Math.atan2(this.momentumV, this.momentumU);
      this.mesh.rotation.z = angle + Math.PI / 4; // +45deg for diamond orientation
    }
  }

  private checkAndDodgeBullets(): void {
    // This would ideally check the game's bullet collection
    // For now, we'll create a hook that the game can populate
    // The game would need to call setNearbyBullets or similar
    // Placeholder: dodge logic would calculate perpendicular vector and apply force

    // Example implementation (requires bullet data from game):
    // if (nearestBullet && distance < dodgeRadius) {
    //   const perpU = -deltaV / distance;
    //   const perpV = deltaU / distance;
    //   this.momentumU += perpU * this.dodgeForce * dt;
    //   this.momentumV += perpV * this.dodgeForce * dt;
    // }
  }

  // Method that game can call to provide bullet positions for dodging
  public dodgeFromBullet(bulletU: number, bulletV: number): void {
    const deltaU = bulletU - this.surfacePosition.u;
    const deltaV = bulletV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance < this.dodgeRadius && distance > 0.01) {
      // Apply perpendicular force to dodge
      const perpU = -deltaV / distance;
      const perpV = deltaU / distance;
      this.momentumU += perpU * this.dodgeForce * 0.016; // Approximate dt
      this.momentumV += perpV * this.dodgeForce * 0.016;
    }
  }
}
