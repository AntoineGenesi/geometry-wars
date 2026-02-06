import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildRepulsorShape } from '../../utils/GeometryBuilder';

enum RepulsorPhase {
  Lock,
  Charge,
  Recovery
}

export class Repulsor extends BaseEnemy {
  private phase: RepulsorPhase = RepulsorPhase.Lock;
  private phaseTimer = 0;
  private readonly lockDuration = 1.5;
  private readonly recoveryDuration = 2;
  private chargeTargetU = 0;
  private chargeTargetV = 0;
  private chargeSpeed = 0.1875;
  private facingAngle = 0;

  private frontMesh!: THREE.Group;
  private rearMesh!: THREE.Group;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    super(surfaceU, surfaceV, 3, 425, 4, 0.06, 0.35); // Reduced speed

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D two-part arrow shape with front (orange) and rear (blue)
    const size = 0.25;
    const { front, rear } = buildRepulsorShape(size, 0xff4400, 0x4444ff, 0.12, 0.025);

    this.frontMesh = front;
    this.rearMesh = rear;

    // Create a group to hold both parts
    const group = new THREE.Group();
    group.add(this.frontMesh);
    group.add(this.rearMesh);
    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.phaseTimer += dt;

    switch (this.phase) {
      case RepulsorPhase.Lock:
        this.updateLockPhase(dt, playerU, playerV);
        break;
      case RepulsorPhase.Charge:
        this.updateChargePhase(dt);
        break;
      case RepulsorPhase.Recovery:
        this.updateRecoveryPhase(dt);
        break;
    }

    // Update visual orientation
    if (this.mesh) {
      this.mesh.rotation.z = this.facingAngle;
    }
  }

  private updateLockPhase(dt: number, playerU: number, playerV: number): void {
    // Face the player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    this.facingAngle = Math.atan2(deltaV, deltaU);

    if (this.phaseTimer >= this.lockDuration) {
      // Store charge target and switch to charge
      this.chargeTargetU = playerU;
      this.chargeTargetV = playerV;
      this.phase = RepulsorPhase.Charge;
      this.phaseTimer = 0;
    }

    // Pulse front mesh during lock
    const pulse = 1 + Math.sin(this.phaseTimer * 8) * 0.2;
    this.frontMesh.scale.setScalar(pulse);
  }

  private updateChargePhase(dt: number): void {
    // Dash toward stored target position
    const deltaU = this.chargeTargetU - this.surfacePosition.u;
    const deltaV = this.chargeTargetV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.1) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      this.surfacePosition.u += dirU * this.chargeSpeed * dt;
      this.surfacePosition.v += dirV * this.chargeSpeed * dt;
    } else {
      // Reached target, enter recovery
      this.phase = RepulsorPhase.Recovery;
      this.phaseTimer = 0;
    }

    // Trail effect (scale front)
    this.frontMesh.scale.setScalar(1.2);
  }

  private updateRecoveryPhase(dt: number): void {
    // Slow down and turn around
    const turnSpeed = Math.PI / this.recoveryDuration;
    this.facingAngle += turnSpeed * dt;

    this.frontMesh.scale.setScalar(1);

    if (this.phaseTimer >= this.recoveryDuration) {
      // Back to lock phase
      this.phase = RepulsorPhase.Lock;
      this.phaseTimer = 0;
    }
  }

  takeDamage(amount: number): void {
    // Only take damage if hit from behind
    // This would require checking the bullet's approach angle
    // For now, we'll implement a simple rear-only damage system
    // The game/collision system would need to check if hit is on rear mesh

    super.takeDamage(amount);
  }

  // Method for game to check if a position hits the vulnerable rear
  public isRearHit(hitU: number, hitV: number): boolean {
    const deltaU = hitU - this.surfacePosition.u;
    const deltaV = hitV - this.surfacePosition.v;
    const hitAngle = Math.atan2(deltaV, deltaU);

    // Calculate angle difference
    let angleDiff = hitAngle - this.facingAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Rear is hit if angle is roughly opposite to facing direction
    return Math.abs(angleDiff) > Math.PI / 2;
  }
}
