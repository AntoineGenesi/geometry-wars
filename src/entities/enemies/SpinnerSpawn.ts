import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D } from '../../utils/GeometryBuilder';

export class SpinnerSpawn extends BaseEnemy {
  private orbitCenterU: number;
  private orbitCenterV: number;
  private readonly orbitRadius = 0.3;
  private orbitAngle: number;
  private readonly orbitSpeed = 0.375; // radians per second
  private readonly driftSpeed = 0.0625;

  constructor(spawnU: number, spawnV: number) {
    const orbitAngle = Math.random() * Math.PI * 2;
    const orbitRadius = 0.3;
    const startU = spawnU + Math.cos(orbitAngle) * orbitRadius;
    const startV = spawnV + Math.sin(orbitAngle) * orbitRadius;

    super(startU, startV, 1, 25, 1, 0.5, 0.15);

    this.orbitCenterU = spawnU;
    this.orbitCenterV = spawnV;
    this.orbitAngle = orbitAngle;

    this.createMesh();
  }

  private createMesh(): void {
    // Create small 3D triangle prism with magenta color
    const size = 0.15;
    this.mesh = buildTriangle3D(size, 0xff44ff, 0.08, 0.018);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Update orbit angle
    this.orbitAngle += this.orbitSpeed * dt;

    // Calculate base orbit position
    const orbitU = this.orbitCenterU + Math.cos(this.orbitAngle) * this.orbitRadius;
    const orbitV = this.orbitCenterV + Math.sin(this.orbitAngle) * this.orbitRadius;

    // Drift toward player
    const deltaU = playerU - this.orbitCenterU;
    const deltaV = playerV - this.orbitCenterV;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      // Move orbit center toward player
      this.orbitCenterU += dirU * this.driftSpeed * dt;
      this.orbitCenterV += dirV * this.driftSpeed * dt;
    }

    // Set position to orbit position
    this.surfacePosition = { u: orbitU, v: orbitV };

    // Rotate mesh
    if (this.mesh) {
      this.mesh.rotation.z += 3 * dt;
    }
  }
}
