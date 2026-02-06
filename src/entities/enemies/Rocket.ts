import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildArrow3D } from '../../utils/GeometryBuilder';

export class Rocket extends BaseEnemy {
  private directionU: number;
  private directionV: number;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 1, 15, 2, 0.05, 0.3); // Reduced speed

    // Pick random initial direction
    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D arrow/rocket shape with orange color
    const size = 0.3;
    this.mesh = buildArrow3D(size, 0xff8800, 0.12, 0.025);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Move in straight line
    this.surfacePosition.u += this.directionU * this.speed * dt;
    this.surfacePosition.v += this.directionV * this.speed * dt;

    // Bounce off boundaries
    let bounced = false;

    if (this.surfacePosition.u <= 0) {
      this.surfacePosition.u = 0;
      this.directionU = Math.abs(this.directionU);
      bounced = true;
    } else if (this.surfacePosition.u >= 1) {
      this.surfacePosition.u = 1;
      this.directionU = -Math.abs(this.directionU);
      bounced = true;
    }

    if (this.surfacePosition.v <= 0) {
      this.surfacePosition.v = 0;
      this.directionV = Math.abs(this.directionV);
      bounced = true;
    } else if (this.surfacePosition.v >= 1) {
      this.surfacePosition.v = 1;
      this.directionV = -Math.abs(this.directionV);
      bounced = true;
    }

    // Orient mesh to direction of travel
    if (this.mesh) {
      const angle = Math.atan2(this.directionV, this.directionU);
      this.mesh.rotation.z = angle - Math.PI / 2; // Adjust for arrow pointing up
    }
  }
}
