import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPolygon3D } from '../../utils/GeometryBuilder';

export class Neutron extends BaseEnemy {
  private directionU: number;
  private directionV: number;
  private spinAngle: number = 0;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 1, 10, 1, 0.04, 0.3); // Reduced speed

    // Pick random initial direction
    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D heptagon (7-sided) prism with yellow-green color
    const sides = 7;
    const radius = 0.25;
    this.mesh = buildPolygon3D(sides, radius, 0xccff00, 0.12, 0.025);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Move in current direction
    this.surfacePosition.u += this.directionU * this.speed * dt;
    this.surfacePosition.v += this.directionV * this.speed * dt;

    // Bounce off boundaries with random direction change
    let bounced = false;

    if (this.surfacePosition.u <= 0) {
      this.surfacePosition.u = 0;
      bounced = true;
    } else if (this.surfacePosition.u >= 1) {
      this.surfacePosition.u = 1;
      bounced = true;
    }

    if (this.surfacePosition.v <= 0) {
      this.surfacePosition.v = 0;
      bounced = true;
    } else if (this.surfacePosition.v >= 1) {
      this.surfacePosition.v = 1;
      bounced = true;
    }

    if (bounced) {
      // Pick new random direction on bounce
      const angle = Math.random() * Math.PI * 2;
      this.directionU = Math.cos(angle);
      this.directionV = Math.sin(angle);
    }

    // Fast spin
    this.spinAngle += 5 * dt;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
    }
  }
}
