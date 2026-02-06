import * as THREE from 'three';
import { BaseDrone, DroneType, DroneConfig } from './BaseDrone';

export class DefendDrone extends BaseDrone {
  private fireTimer: number;
  private fireInterval: number;
  private onShoot: (origin: { u: number; v: number }, direction: number) => void;

  constructor(
    level = 0,
    onShoot: (origin: { u: number; v: number }, direction: number) => void
  ) {
    const config: DroneConfig = {
      type: DroneType.Defend,
      level,
      color: 0xaa44ff,
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
    // Fire rate: 4/sec at level 0, 7/sec at level 3
    const fireRate = 4 + this.level;
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

    // Update firing - shoot opposite to player aim
    this.fireTimer += dt;
    if (this.fireTimer >= this.fireInterval) {
      this.fireTimer = 0;
      const oppositeAngle = aimAngle + Math.PI;
      this.onShoot({ u: this.surfaceU, v: this.surfaceV }, oppositeAngle);
    }
  }

  upgrade(): void {
    super.upgrade();
    this.fireInterval = this.getFireInterval();
  }
}
