import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPolygon3D } from '../../utils/GeometryBuilder';

export class Neutron extends BaseEnemy {
  private directionU: number;
  private directionV: number;
  private spinAngle: number = 0;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 2, 10, 1, 0.04, 0.25); // radius=0.25 matches 7-gon polygon visual radius (S27g hitbox fix)

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
    this.mesh = buildPolygon3D(sides, radius, 0x44dddd, radius * 0.65, 0.025);
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

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Convert UV direction to world space using tangent frame
    const tangentFrame = this.walker.getTangentFrame();
    const dir = tangentFrame.tangent
      .clone()
      .multiplyScalar(this.directionU)
      .add(tangentFrame.bitangent.clone().multiplyScalar(this.directionV))
      .normalize();

    // Fast spin (must run in both modes)
    this.spinAngle += 5 * dt;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
    }

    // Note: On mesh surfaces, we don't bounce - just keep moving in current direction
    // The random direction changes will still happen periodically in the collision system
    // or we could add a timer here, but for now just maintain current direction

    return dir.multiplyScalar(this.speed * this.walkerSpeedScale);
  }
}
