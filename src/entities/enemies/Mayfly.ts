import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D } from '../../utils/GeometryBuilder';

export class Mayfly extends BaseEnemy {
  private randomOffsetU: number;
  private randomOffsetV: number;
  private offsetChangeTimer: number;

  constructor(surfaceU: number, surfaceV: number) {
    // Reduced speed from 0.05 to 0.03 (player is 0.08)
    super(surfaceU, surfaceV, 1, 5, 1, 0.03, 0.15); // Smaller radius

    // Random offset for swarm behavior
    this.randomOffsetU = (Math.random() - 0.5) * 0.1;
    this.randomOffsetV = (Math.random() - 0.5) * 0.1;
    this.offsetChangeTimer = 0;

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D triangle prism shape (smaller for mayfly)
    const size = 0.15;
    this.mesh = buildTriangle3D(size, 0xaaff00, 0.08, 0.018);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Change random offset periodically for swarm jitter
    this.offsetChangeTimer += dt;
    if (this.offsetChangeTimer >= 0.3) {
      this.randomOffsetU = (Math.random() - 0.5) * 0.1;
      this.randomOffsetV = (Math.random() - 0.5) * 0.1;
      this.offsetChangeTimer = 0;
    }

    // Track player with slight random offset
    const targetU = playerU + this.randomOffsetU;
    const targetV = playerV + this.randomOffsetV;

    const deltaU = targetU - this.surfacePosition.u;
    const deltaV = targetV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.001) {
      // Normalize and move toward target
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      this.surfacePosition.u += dirU * this.speed * dt;
      this.surfacePosition.v += dirV * this.speed * dt;

      // Clamp to surface boundaries
      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Change random offset periodically for swarm jitter (must run in both modes)
    this.offsetChangeTimer += dt;
    if (this.offsetChangeTimer >= 0.3) {
      this.randomOffsetU = (Math.random() - 0.5) * 0.1;
      this.randomOffsetV = (Math.random() - 0.5) * 0.1;
      this.offsetChangeTimer = 0;
    }

    // Convert UV offset to world space offset
    const tangentFrame = this.walker.getTangentFrame();
    const offsetWorld = tangentFrame.tangent
      .clone()
      .multiplyScalar(this.randomOffsetU * 3) // Scale up for world space
      .add(tangentFrame.bitangent.clone().multiplyScalar(this.randomOffsetV * 3));

    // Track player with offset
    const targetPos = playerWorldPos.clone().add(offsetWorld);
    const dir = targetPos.sub(this.walker.position);
    const dist = dir.length();
    if (dist < 0.01) return null;
    dir.normalize();

    return dir.multiplyScalar(this.speed * this.walkerSpeedScale);
  }
}
