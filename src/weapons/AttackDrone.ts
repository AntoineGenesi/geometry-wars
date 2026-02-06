import * as THREE from 'three';
import { BaseDrone, DroneType, DroneConfig } from './BaseDrone';

export class AttackDrone extends BaseDrone {
  private fireTimer: number;
  private fireInterval: number;
  private onShoot: (origin: { u: number; v: number }, direction: number) => void;

  constructor(
    level = 0,
    onShoot: (origin: { u: number; v: number }, direction: number) => void
  ) {
    const config: DroneConfig = {
      type: DroneType.Attack,
      level,
      color: 0x00ccff,
      orbitRadius: 0.05,
      orbitSpeed: 2,
    };

    super(config);
    this.onShoot = onShoot;
    this.fireTimer = 0;
    this.fireInterval = this.getFireInterval();
    this.createMesh();
  }

  private createMesh(): void {
    const size = 0.02;
    const points = [
      new THREE.Vector3(0, size, 0),
      new THREE.Vector3(-size * 0.6, -size * 0.5, 0),
      new THREE.Vector3(size * 0.6, -size * 0.5, 0),
      new THREE.Vector3(0, size, 0),
    ];

    const mainShape = this.createLineShape(points, this.color);
    const glowShape = this.createGlowShape(points, this.color);

    this.mesh.add(mainShape);
    this.mesh.add(glowShape);
  }

  private getFireInterval(): number {
    // Fire rate: 5/sec at level 0, 8/sec at level 3
    const fireRate = 5 + this.level;
    return 1 / fireRate;
  }

  update(
    dt: number,
    playerU: number,
    playerV: number,
    aimAngle: number,
    enemies: any[]
  ): void {
    // Update orbit position
    this.orbitAngle += this.orbitSpeed * dt;
    this.surfaceU = playerU + this.orbitRadius * Math.cos(this.orbitAngle);
    this.surfaceV = playerV + this.orbitRadius * Math.sin(this.orbitAngle);

    // Update firing
    this.fireTimer += dt;
    if (this.fireTimer >= this.fireInterval) {
      this.fireTimer = 0;
      this.onShoot({ u: this.surfaceU, v: this.surfaceV }, aimAngle);
    }
  }

  upgrade(): void {
    super.upgrade();
    this.fireInterval = this.getFireInterval();
  }
}
