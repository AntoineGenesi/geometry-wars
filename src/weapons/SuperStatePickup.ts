import * as THREE from 'three';
import { SuperStateType } from './SuperState';

export interface SurfaceTransform {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
}

export class SuperStatePickup {
  readonly mesh: THREE.Group;
  surfaceU: number;
  surfaceV: number;
  type: SuperStateType;
  active: boolean;

  private dots: THREE.Mesh[] = [];
  private readonly dotRadius = 0.05;
  private animationTime = 0;

  constructor(type: SuperStateType, surfaceU: number, surfaceV: number) {
    this.type = type;
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
    this.active = true;
    this.mesh = new THREE.Group();

    this.createDotPattern();
  }

  private createDotPattern(): void {
    // Create a pattern of dots based on the super state type
    const patterns = this.getPatternForType();
    const color = this.getColorForType();

    for (const offset of patterns) {
      const dotGeometry = new THREE.SphereGeometry(this.dotRadius, 8, 8);
      const dotMaterial = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
      });
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.position.set(offset.x, offset.y, offset.z);
      this.dots.push(dot);
      this.mesh.add(dot);
    }
  }

  private getPatternForType(): Array<{ x: number; y: number; z: number }> {
    // Different patterns for different types
    switch (this.type) {
      case SuperStateType.QuadFire:
        return this.createSquarePattern();
      case SuperStateType.SplitFire:
        return this.createTrianglePattern();
      case SuperStateType.ReverseFire:
        return this.createArrowPattern();
      case SuperStateType.Missile:
        return this.createCrossPattern();
      case SuperStateType.Magnet:
        return this.createCirclePattern();
      case SuperStateType.TrailBomb:
        return this.createLinePattern();
      case SuperStateType.Shield:
        return this.createHexagonPattern();
      default:
        return this.createCirclePattern();
    }
  }

  private createSquarePattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.2;
    return [
      { x: -size, y: -size, z: 0 },
      { x: size, y: -size, z: 0 },
      { x: size, y: size, z: 0 },
      { x: -size, y: size, z: 0 },
    ];
  }

  private createTrianglePattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.2;
    return [
      { x: 0, y: size, z: 0 },
      { x: -size, y: -size, z: 0 },
      { x: size, y: -size, z: 0 },
    ];
  }

  private createArrowPattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.15;
    return [
      { x: 0, y: size * 2, z: 0 },
      { x: -size, y: size, z: 0 },
      { x: size, y: size, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -size, z: 0 },
    ];
  }

  private createCrossPattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.2;
    return [
      { x: 0, y: size, z: 0 },
      { x: 0, y: -size, z: 0 },
      { x: -size, y: 0, z: 0 },
      { x: size, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ];
  }

  private createCirclePattern(): Array<{ x: number; y: number; z: number }> {
    const radius = 0.2;
    const count = 8;
    const pattern: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      pattern.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: 0,
      });
    }

    return pattern;
  }

  private createLinePattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.15;
    return [
      { x: -size * 2, y: 0, z: 0 },
      { x: -size, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: size, y: 0, z: 0 },
      { x: size * 2, y: 0, z: 0 },
    ];
  }

  private createHexagonPattern(): Array<{ x: number; y: number; z: number }> {
    const radius = 0.2;
    const count = 6;
    const pattern: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      pattern.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: 0,
      });
    }

    return pattern;
  }

  private getColorForType(): number {
    // Neon colors for different types
    switch (this.type) {
      case SuperStateType.QuadFire:
        return 0xff0000; // Red
      case SuperStateType.SplitFire:
        return 0x00ff00; // Green
      case SuperStateType.ReverseFire:
        return 0x0000ff; // Blue
      case SuperStateType.Missile:
        return 0xffff00; // Yellow
      case SuperStateType.Magnet:
        return 0xff00ff; // Magenta
      case SuperStateType.TrailBomb:
        return 0x00ffff; // Cyan
      case SuperStateType.Shield:
        return 0xffffff; // White
      default:
        return 0xff00ff;
    }
  }

  update(dt: number): void {
    if (!this.active) return;

    // Animate dots - pulse effect
    this.animationTime += dt;
    const scale = 1 + Math.sin(this.animationTime * 3) * 0.3;

    for (const dot of this.dots) {
      dot.scale.set(scale, scale, scale);
    }

    // Rotate the pattern slowly
    this.mesh.rotation.z += dt * 0.5;
  }

  applySurfaceTransform(
    getTransform: (u: number, v: number) => SurfaceTransform
  ): void {
    const transform = getTransform(this.surfaceU, this.surfaceV);

    // Position the mesh on the surface
    this.mesh.position.copy(transform.position);

    // Orient to surface normal
    this.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      transform.normal
    );

    // Offset slightly above surface
    this.mesh.position.addScaledVector(transform.normal, 0.1);
  }

  checkPlayerCollision(playerU: number, playerV: number): boolean {
    // Check if player is close enough to destroy a dot
    const deltaU = playerU - this.surfaceU;
    const deltaV = playerV - this.surfaceV;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    return distance < 0.15; // Collision radius
  }

  removeClosestDot(playerU: number, playerV: number): boolean {
    if (this.dots.length === 0) return false;

    // Remove one dot when player gets close
    const dot = this.dots.pop();
    if (dot) {
      this.mesh.remove(dot);
      dot.geometry.dispose();
      (dot.material as THREE.Material).dispose();
    }

    return this.dots.length === 0; // Return true if all dots destroyed
  }

  isComplete(): boolean {
    return this.dots.length === 0;
  }

  dispose(): void {
    this.active = false;

    // Clean up all dots
    for (const dot of this.dots) {
      dot.geometry.dispose();
      (dot.material as THREE.Material).dispose();
      this.mesh.remove(dot);
    }

    this.dots = [];
  }
}
