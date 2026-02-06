import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPinwheel3D } from '../../utils/GeometryBuilder';

export class Wanderer extends BaseEnemy {
  private directionU: number;
  private directionV: number;
  private directionChangeTimer: number;
  private nextDirectionChange: number;
  private spinAngle: number = 0;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 1, 5, 1, 0.04, 0.3); // Reduced speed

    // Initialize random direction
    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);

    this.directionChangeTimer = 0;
    this.nextDirectionChange = 1 + Math.random(); // 1-2 seconds

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D pinwheel shape with depth
    const bladeLength = 0.3;
    this.mesh = buildPinwheel3D(bladeLength, 0xaa44ff, 0.1, 0.02);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Update direction change timer
    this.directionChangeTimer += dt;
    if (this.directionChangeTimer >= this.nextDirectionChange) {
      // Pick new random direction
      const angle = Math.random() * Math.PI * 2;
      this.directionU = Math.cos(angle);
      this.directionV = Math.sin(angle);

      this.directionChangeTimer = 0;
      this.nextDirectionChange = 1 + Math.random();
    }

    // Move in current direction
    const moveU = this.directionU * this.speed * dt;
    const moveV = this.directionV * this.speed * dt;

    this.surfacePosition.u += moveU;
    this.surfacePosition.v += moveV;

    // Bounce off boundaries
    if (this.surfacePosition.u <= 0 || this.surfacePosition.u >= 1) {
      this.directionU *= -1;
      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
    }

    if (this.surfacePosition.v <= 0 || this.surfacePosition.v >= 1) {
      this.directionV *= -1;
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }

    // Spin the pinwheel
    this.spinAngle += 3 * dt;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
    }
  }
}
