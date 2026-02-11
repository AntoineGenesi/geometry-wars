import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildSquare3D } from '../../utils/GeometryBuilder';

export class Duck extends BaseEnemy {
  private currentDirection: number; // 0=up, 1=right, 2=down, 3=left
  private directionTimer: number;
  private readonly directionChangeInterval: number = 0.5;

  constructor(surfaceU: number, surfaceV: number) {
    super(surfaceU, surfaceV, 1, 5, 1, 0.025, 0.3);

    this.currentDirection = Math.floor(Math.random() * 4);
    this.directionTimer = 0;

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D square/box frame with pink color
    const size = 0.22;
    this.mesh = buildSquare3D(size, 0xff44aa, 0.12, 0.025);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Update direction change timer
    this.directionTimer += dt;
    if (this.directionTimer >= this.directionChangeInterval) {
      this.directionTimer = 0;

      // Calculate direction that trends toward player
      const deltaU = playerU - this.surfacePosition.u;
      const deltaV = playerV - this.surfacePosition.v;

      // Bias toward player but maintain cardinal directions
      const absU = Math.abs(deltaU);
      const absV = Math.abs(deltaV);

      if (absU > absV) {
        // Move horizontally
        this.currentDirection = deltaU > 0 ? 1 : 3; // right or left
      } else {
        // Move vertically
        this.currentDirection = deltaV > 0 ? 0 : 2; // up or down
      }

      // Add some randomness (20% chance to pick random direction)
      if (Math.random() < 0.2) {
        this.currentDirection = Math.floor(Math.random() * 4);
      }
    }

    // Move in current cardinal direction
    let moveU = 0;
    let moveV = 0;

    switch (this.currentDirection) {
      case 0: // up (positive V)
        moveV = this.speed * dt;
        break;
      case 1: // right (positive U)
        moveU = this.speed * dt;
        break;
      case 2: // down (negative V)
        moveV = -this.speed * dt;
        break;
      case 3: // left (negative U)
        moveU = -this.speed * dt;
        break;
    }

    this.surfacePosition.u += moveU;
    this.surfacePosition.v += moveV;

    // Clamp to surface boundaries
    this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
    this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Update direction change timer (must run in both modes)
    this.directionTimer += dt;
    if (this.directionTimer >= this.directionChangeInterval) {
      this.directionTimer = 0;

      // Calculate direction that trends toward player
      const delta = playerWorldPos.clone().sub(this.walker.position);
      const tangentFrame = this.walker.getTangentFrame();

      // Project delta onto tangent/bitangent to get local U/V equivalent
      const deltaU = delta.dot(tangentFrame.tangent);
      const deltaV = delta.dot(tangentFrame.bitangent);

      // Bias toward player but maintain cardinal directions
      const absU = Math.abs(deltaU);
      const absV = Math.abs(deltaV);

      if (absU > absV) {
        this.currentDirection = deltaU > 0 ? 1 : 3; // right or left
      } else {
        this.currentDirection = deltaV > 0 ? 0 : 2; // up or down
      }

      // Add some randomness (20% chance to pick random direction)
      if (Math.random() < 0.2) {
        this.currentDirection = Math.floor(Math.random() * 4);
      }
    }

    // Move in current cardinal direction using tangent frame
    const tangentFrame = this.walker.getTangentFrame();
    let dir = new THREE.Vector3();

    switch (this.currentDirection) {
      case 0: // up (positive bitangent)
        dir.copy(tangentFrame.bitangent);
        break;
      case 1: // right (positive tangent)
        dir.copy(tangentFrame.tangent);
        break;
      case 2: // down (negative bitangent)
        dir.copy(tangentFrame.bitangent).negate();
        break;
      case 3: // left (negative tangent)
        dir.copy(tangentFrame.tangent).negate();
        break;
    }

    return dir.multiplyScalar(this.speed * this.walkerSpeedScale);
  }
}
