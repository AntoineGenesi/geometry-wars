import * as THREE from 'three';

export interface DroneConfig {
  type: DroneType;
  level: number; // 0-3 (upgrade tier)
  color: number;
  orbitRadius: number; // distance from player in surface coords
  orbitSpeed: number; // rad/sec
}

export enum DroneType {
  Attack = 'attack',
  Collect = 'collect',
  Ram = 'ram',
  Snipe = 'snipe',
  Defend = 'defend',
  Sweep = 'sweep',
}

export abstract class BaseDrone {
  readonly mesh: THREE.Group;
  type: DroneType;
  level: number;
  surfaceU: number;
  surfaceV: number;
  orbitAngle: number;
  protected color: number;
  protected orbitRadius: number;
  protected orbitSpeed: number;

  constructor(config: DroneConfig) {
    this.type = config.type;
    this.level = config.level;
    this.color = config.color;
    this.orbitRadius = config.orbitRadius;
    this.orbitSpeed = config.orbitSpeed;
    this.surfaceU = 0;
    this.surfaceV = 0;
    this.orbitAngle = 0;
    this.mesh = new THREE.Group();
  }

  // Called each fixed timestep
  abstract update(
    dt: number,
    playerU: number,
    playerV: number,
    aimAngle: number,
    enemies: any[]
  ): void;

  // Apply surface transform (same pattern as player/enemies)
  applySurfaceTransform(
    getTransform: (u: number, v: number) => { position: THREE.Vector3; normal: THREE.Vector3 }
  ): void {
    const { position, normal } = getTransform(this.surfaceU, this.surfaceV);
    this.mesh.position.copy(position);
    this.mesh.lookAt(position.clone().add(normal));
  }

  // Upgrade the drone (increases level, improves stats)
  upgrade(): void {
    if (this.level < 3) {
      this.level++;
    }
  }

  dispose(): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  protected createLineShape(points: THREE.Vector3[], color: number, scale = 1): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geometry, material);
    line.scale.set(scale, scale, scale);
    return line;
  }

  protected createGlowShape(points: THREE.Vector3[], color: number, scale = 1.2): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
    });
    const line = new THREE.Line(geometry, material);
    line.scale.set(scale, scale, scale);
    return line;
  }
}
