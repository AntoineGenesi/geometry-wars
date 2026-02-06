import * as THREE from 'three';
import { BaseDrone, DroneType, DroneConfig } from './BaseDrone';

export class SnipeDrone extends BaseDrone {
  private fireTimer: number;
  private fireInterval: number;
  private onSnipeHit: (enemy: any) => void;
  private visualRay: THREE.Line | null;
  private rayVisibleTimer: number;
  private rayVisibleDuration: number;

  constructor(level = 0, onSnipeHit: (enemy: any) => void) {
    const config: DroneConfig = {
      type: DroneType.Snipe,
      level,
      color: 0xffffff,
      orbitRadius: 0.055,
      orbitSpeed: 1.8,
    };

    super(config);
    this.onSnipeHit = onSnipeHit;
    this.fireTimer = 0;
    this.fireInterval = this.getFireInterval();
    this.visualRay = null;
    this.rayVisibleTimer = 0;
    this.rayVisibleDuration = 0.1;
    this.createMesh();
  }

  private createMesh(): void {
    const size = 0.015;
    const points = [
      new THREE.Vector3(-size, 0, 0),
      new THREE.Vector3(size, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -size, 0),
      new THREE.Vector3(0, size, 0),
    ];

    const mainShape = this.createLineShape(points, this.color);
    const glowShape = this.createGlowShape(points, this.color);

    this.mesh.add(mainShape);
    this.mesh.add(glowShape);
  }

  private getFireInterval(): number {
    // Fire rate: 2 seconds at level 0, 0.5 seconds at level 3
    return 2 - this.level * 0.5;
  }

  private findNearestEnemy(enemies: any[]): any | null {
    let nearest = null;
    let minDist = Infinity;

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

  private createVisualRay(targetU: number, targetV: number): void {
    // Remove old ray if exists
    if (this.visualRay) {
      this.mesh.remove(this.visualRay);
      this.visualRay.geometry.dispose();
      if (Array.isArray(this.visualRay.material)) {
        this.visualRay.material.forEach((m) => m.dispose());
      } else {
        this.visualRay.material.dispose();
      }
    }

    // Create ray from drone to target (in local space, approximate)
    const dx = targetU - this.surfaceU;
    const dy = targetV - this.surfaceV;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, dist * 0.5, 0), // Approximate visual direction
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.8,
    });

    this.visualRay = new THREE.Line(geometry, material);
    this.mesh.add(this.visualRay);
    this.rayVisibleTimer = 0;
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
      const target = this.findNearestEnemy(enemies);
      if (target) {
        this.onSnipeHit(target);
        this.createVisualRay(target.surfaceU, target.surfaceV);
      }
    }

    // Update visual ray
    if (this.visualRay) {
      this.rayVisibleTimer += dt;
      if (this.rayVisibleTimer >= this.rayVisibleDuration) {
        this.mesh.remove(this.visualRay);
        this.visualRay.geometry.dispose();
        if (Array.isArray(this.visualRay.material)) {
          this.visualRay.material.forEach((m) => m.dispose());
        } else {
          this.visualRay.material.dispose();
        }
        this.visualRay = null;
      }
    }
  }

  upgrade(): void {
    super.upgrade();
    this.fireInterval = this.getFireInterval();
  }

  dispose(): void {
    if (this.visualRay) {
      this.visualRay.geometry.dispose();
      if (Array.isArray(this.visualRay.material)) {
        this.visualRay.material.forEach((m) => m.dispose());
      } else {
        this.visualRay.material.dispose();
      }
    }
    super.dispose();
  }
}
