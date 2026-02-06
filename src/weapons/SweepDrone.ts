import * as THREE from 'three';
import { BaseDrone, DroneType, DroneConfig } from './BaseDrone';

export class SweepDrone extends BaseDrone {
  private killRadius: number;
  private onSweepKill: (enemy: any) => void;
  private trail: THREE.Line | null;
  private trailPoints: THREE.Vector3[];
  private maxTrailPoints: number;

  constructor(level = 0, onSweepKill: (enemy: any) => void) {
    const config: DroneConfig = {
      type: DroneType.Sweep,
      level,
      color: 0xff8800,
      orbitRadius: 0.08,
      orbitSpeed: 4 + level * 1.33, // 4 rad/sec at level 0, 8 at level 3
    };

    super(config);
    this.onSweepKill = onSweepKill;
    this.killRadius = this.getKillRadius();
    this.trail = null;
    this.trailPoints = [];
    this.maxTrailPoints = 10;
    this.createMesh();
  }

  private createMesh(): void {
    const size = 0.02;
    const segments = 16;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.cos(angle) * size, Math.sin(angle) * size, 0)
      );
    }

    const mainShape = this.createLineShape(points, this.color);
    const glowShape = this.createGlowShape(points, this.color);

    this.mesh.add(mainShape);
    this.mesh.add(glowShape);
  }

  private getKillRadius(): number {
    // Kill radius: 0.2 at level 0, 0.4 at level 3
    return 0.2 + this.level * 0.067;
  }

  private updateTrail(): void {
    // Add current position to trail
    this.trailPoints.push(new THREE.Vector3(0, 0, 0));
    if (this.trailPoints.length > this.maxTrailPoints) {
      this.trailPoints.shift();
    }

    // Remove old trail
    if (this.trail) {
      this.mesh.remove(this.trail);
      this.trail.geometry.dispose();
      if (Array.isArray(this.trail.material)) {
        this.trail.material.forEach((m) => m.dispose());
      } else {
        this.trail.material.dispose();
      }
    }

    // Create new trail if we have enough points
    if (this.trailPoints.length > 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints(this.trailPoints);
      const material = new THREE.LineBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.3,
      });
      this.trail = new THREE.Line(geometry, material);
      this.mesh.add(this.trail);
    }
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

    // Update trail
    this.updateTrail();

    // Check for collisions with enemies
    for (const enemy of enemies) {
      const dx = enemy.surfaceU - this.surfaceU;
      const dy = enemy.surfaceV - this.surfaceV;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.killRadius) {
        this.onSweepKill(enemy);
      }
    }
  }

  upgrade(): void {
    super.upgrade();
    this.killRadius = this.getKillRadius();
    this.orbitSpeed = 4 + this.level * 1.33;
  }

  dispose(): void {
    if (this.trail) {
      this.trail.geometry.dispose();
      if (Array.isArray(this.trail.material)) {
        this.trail.material.forEach((m) => m.dispose());
      } else {
        this.trail.material.dispose();
      }
    }
    super.dispose();
  }
}
