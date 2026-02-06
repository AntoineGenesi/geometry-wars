import * as THREE from 'three';
import { BaseDrone, DroneType, DroneConfig } from './BaseDrone';

enum RamState {
  Orbiting,
  Charging,
  Returning,
}

export class RamDrone extends BaseDrone {
  private state: RamState;
  private targetEnemy: any | null;
  private chargeSpeed: number;
  private detectionRange: number;
  private killRadius: number;
  private cooldownTimer: number;
  private cooldownDuration: number;
  private onRamKill: (enemy: any) => void;

  constructor(level = 0, onRamKill: (enemy: any) => void) {
    const config: DroneConfig = {
      type: DroneType.Ram,
      level,
      color: 0xff4444,
      orbitRadius: 0.06,
      orbitSpeed: 2.5,
    };

    super(config);
    this.onRamKill = onRamKill;
    this.state = RamState.Orbiting;
    this.targetEnemy = null;
    this.chargeSpeed = 12;
    this.detectionRange = 3.0;
    this.killRadius = 0.15;
    this.cooldownTimer = 0;
    this.cooldownDuration = this.getCooldownDuration();
    this.createMesh();
  }

  private createMesh(): void {
    const size = 0.025;
    const points = [
      new THREE.Vector3(size, 0, 0),
      new THREE.Vector3(-size * 0.5, size * 0.7, 0),
      new THREE.Vector3(-size * 0.3, 0, 0),
      new THREE.Vector3(-size * 0.5, -size * 0.7, 0),
      new THREE.Vector3(size, 0, 0),
    ];

    const mainShape = this.createLineShape(points, this.color);
    const glowShape = this.createGlowShape(points, this.color);

    this.mesh.add(mainShape);
    this.mesh.add(glowShape);
  }

  private getCooldownDuration(): number {
    // Cooldown: 2 sec at level 0, 1 sec at level 3
    return 2 - this.level * 0.33;
  }

  private findNearestEnemy(enemies: any[]): any | null {
    let nearest = null;
    let minDist = this.detectionRange;

    for (const enemy of enemies) {
      const dx = enemy.surfaceU - this.surfaceU;
      const dy = enemy.surfaceV - this.surfaceV;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        minDist = dist;
        nearest = enemy;
      }
    }

    return nearest;
  }

  update(
    dt: number,
    playerU: number,
    playerV: number,
    aimAngle: number,
    enemies: any[]
  ): void {
    this.cooldownTimer += dt;

    switch (this.state) {
      case RamState.Orbiting:
        this.orbitAngle += this.orbitSpeed * dt;
        this.surfaceU = playerU + this.orbitRadius * Math.cos(this.orbitAngle);
        this.surfaceV = playerV + this.orbitRadius * Math.sin(this.orbitAngle);

        // Look for target if cooldown expired
        if (this.cooldownTimer >= this.cooldownDuration) {
          const target = this.findNearestEnemy(enemies);
          if (target) {
            this.targetEnemy = target;
            this.state = RamState.Charging;
          }
        }
        break;

      case RamState.Charging:
        if (!this.targetEnemy) {
          this.state = RamState.Returning;
          break;
        }

        // Move toward target
        const dx = this.targetEnemy.surfaceU - this.surfaceU;
        const dy = this.targetEnemy.surfaceV - this.surfaceV;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.killRadius) {
          // Kill enemy
          this.onRamKill(this.targetEnemy);
          this.targetEnemy = null;
          this.state = RamState.Returning;
          this.cooldownTimer = 0;
        } else {
          // Move toward enemy
          const moveAmount = Math.min(this.chargeSpeed * dt, dist);
          this.surfaceU += (dx / dist) * moveAmount;
          this.surfaceV += (dy / dist) * moveAmount;
        }
        break;

      case RamState.Returning:
        // Return to orbit around player
        const returnDx = playerU - this.surfaceU;
        const returnDy = playerV - this.surfaceV;
        const returnDist = Math.sqrt(returnDx * returnDx + returnDy * returnDy);

        if (returnDist < this.orbitRadius * 1.5) {
          this.state = RamState.Orbiting;
        } else {
          const returnSpeed = this.chargeSpeed * 0.7;
          const moveAmount = Math.min(returnSpeed * dt, returnDist);
          this.surfaceU += (returnDx / returnDist) * moveAmount;
          this.surfaceV += (returnDy / returnDist) * moveAmount;
        }
        break;
    }
  }

  upgrade(): void {
    super.upgrade();
    this.cooldownDuration = this.getCooldownDuration();
  }
}
