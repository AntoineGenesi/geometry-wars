import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildDiamond3D } from '../../utils/GeometryBuilder';

export class Grunt extends BaseEnemy {
  private currentSpeed: number;
  // Reduced speeds: player is 0.08, so max should be slower
  private readonly maxSpeed: number = 0.06;
  private readonly speedIncreaseRate: number = 0.002;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 2, 10, 2, 0.2, 0.3);
    this.currentSpeed = 0.02;

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D diamond prism shape with depth
    const size = 0.25;
    this.mesh = buildDiamond3D(size, 0x4444ff, 0.15, 0.025);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Increase speed over time up to max
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.speedIncreaseRate * dt);

    // Calculate direction to player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distanceSq = deltaU * deltaU + deltaV * deltaV;

    // Optimization: check squared distance first to avoid expensive sqrt
    if (distanceSq > 0.000001) {
      // Only compute sqrt when we actually need the distance for normalization
      const distance = Math.sqrt(distanceSq);
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      this.surfacePosition.u += dirU * this.currentSpeed * dt;
      this.surfacePosition.v += dirV * this.currentSpeed * dt;

      // Clamp to surface boundaries
      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Increase speed over time up to max (same as UV mode)
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.speedIncreaseRate * dt);

    // Direction to player in world space
    const dir = playerWorldPos.clone().sub(this.walker.position);
    const dist = dir.length();
    if (dist < 0.01) return null;
    dir.normalize();

    // Return velocity = direction * world speed
    return dir.multiplyScalar(this.currentSpeed * this.walkerSpeedScale);
  }
}
