import * as THREE from 'three';
import { BaseDrone, DroneType, DroneConfig } from './BaseDrone';

export class CollectDrone extends BaseDrone {
  private speed: number;
  private collectionRadius: number;
  private onCollectGeom: (surfaceU: number, surfaceV: number) => void;
  private targetGeom: { u: number; v: number } | null;

  constructor(
    level = 0,
    onCollectGeom: (surfaceU: number, surfaceV: number) => void
  ) {
    const config: DroneConfig = {
      type: DroneType.Collect,
      level,
      color: 0x00ff88,
      orbitRadius: 0.07,
      orbitSpeed: 1.5,
    };

    super(config);
    this.onCollectGeom = onCollectGeom;
    this.speed = this.getSpeed();
    this.collectionRadius = this.getCollectionRadius();
    this.targetGeom = null;
    this.createMesh();
  }

  private createMesh(): void {
    const size = 0.02;
    const points = [
      new THREE.Vector3(0, size, 0),
      new THREE.Vector3(size, 0, 0),
      new THREE.Vector3(0, -size, 0),
      new THREE.Vector3(-size, 0, 0),
      new THREE.Vector3(0, size, 0),
    ];

    const mainShape = this.createLineShape(points, this.color);
    const glowShape = this.createGlowShape(points, this.color);

    this.mesh.add(mainShape);
    this.mesh.add(glowShape);
  }

  private getSpeed(): number {
    // Speed: 6 units/sec at level 0, 10 at level 3
    return 6 + this.level * 1.33;
  }

  private getCollectionRadius(): number {
    // Collection radius: 0.5 at level 0, 1.5 at level 3
    return 0.5 + this.level * 0.33;
  }

  update(
    dt: number,
    playerU: number,
    playerV: number,
    aimAngle: number,
    enemies: any[]
  ): void {
    // If no target, find nearest geom (passed via enemies array for now)
    // In actual implementation, geoms would be passed separately
    if (!this.targetGeom) {
      this.orbitAngle += this.orbitSpeed * dt;
      this.surfaceU = playerU + this.orbitRadius * Math.cos(this.orbitAngle);
      this.surfaceV = playerV + this.orbitRadius * Math.sin(this.orbitAngle);
      // Target would be set by game manager when geoms are available
    } else {
      // Move toward target
      const dx = this.targetGeom.u - this.surfaceU;
      const dy = this.targetGeom.v - this.surfaceV;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.collectionRadius) {
        // Collect the geom
        this.onCollectGeom(this.surfaceU, this.surfaceV);
        this.targetGeom = null;
      } else {
        // Move toward target
        const moveAmount = Math.min(this.speed * dt, dist);
        this.surfaceU += (dx / dist) * moveAmount;
        this.surfaceV += (dy / dist) * moveAmount;
      }
    }
  }

  setTarget(geom: { u: number; v: number } | null): void {
    this.targetGeom = geom;
  }

  upgrade(): void {
    super.upgrade();
    this.speed = this.getSpeed();
    this.collectionRadius = this.getCollectionRadius();
  }
}
