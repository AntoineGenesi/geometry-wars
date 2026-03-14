import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildArrow3D } from '../../utils/GeometryBuilder';

export class Rocket extends BaseEnemy {
  private directionU: number;
  private directionV: number;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 2, 15, 2, 0.05, 0.3); // Reduced speed

    // Pick random initial direction
    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D arrow/rocket shape with orange color
    const size = 0.3;
    this.mesh = buildArrow3D(size, 0xff8800, size * 0.6, 0.025);
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

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Convert UV direction to world space using tangent frame
    const tangentFrame = this.walker.getTangentFrame();
    const dir = tangentFrame.tangent
      .clone()
      .multiplyScalar(this.directionU)
      .add(tangentFrame.bitangent.clone().multiplyScalar(this.directionV))
      .normalize();

    // Orient mesh to direction of travel (must run in both modes)
    if (this.mesh && this.walker) {
      // Calculate world-space velocity direction for orientation
      const worldVel = dir.clone();
      const tangentFrame = this.walker.getTangentFrame();

      // Project velocity onto tangent plane to get local angle
      const localU = worldVel.dot(tangentFrame.tangent);
      const localV = worldVel.dot(tangentFrame.bitangent);
      const angle = Math.atan2(localV, localU);
      this.mesh.rotation.z = angle - Math.PI / 2;
    }

    return dir.multiplyScalar(this.speed * this.walkerSpeedScale);
  }
}
