import * as THREE from 'three';
import { SuperStateType } from './SuperState';
import { SharedGeometries } from '../rendering/GeometryCache';
import { createSpawnIndicatorSprite, updateSpawnIndicator } from './SpawnIndicator';
import { WEAPON_PICKUP_WORLD_RADIUS as PICKUP_WORLD_RADIUS } from '../shared/GameBalanceConstants';

// Pre-allocated temps for applySurfaceTransform (zero per-call allocations)
const _sspMat4 = new THREE.Matrix4();
const _sspQSurface = new THREE.Quaternion();
const _sspQSpin = new THREE.Quaternion();
const _sspSpinAxis = new THREE.Vector3(0, 1, 0); // local Y = surface normal

export interface SurfaceTransform {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
}

// PICKUP_WORLD_RADIUS imported from src/shared/GameBalanceConstants.ts (s44r8-06).
// Was 0.3 — corrected to 0.35 to match WeaponPickup.ts and BuffPickup.ts.

export class SuperStatePickup {
  readonly mesh: THREE.Group;
  surfaceU: number;
  surfaceV: number;
  private readonly _surfaceWorldPos: THREE.Vector3 = new THREE.Vector3();
  type: SuperStateType;
  active: boolean;

  private dots: THREE.Mesh[] = [];
  private readonly dotRadius = 0.05;
  private animationTime = 0;
  private readonly mapSizeScaleFactor: number;
  private _bobPhase: number = Math.random() * Math.PI * 2;
  private readonly _storedCameraUp = new THREE.Vector3();
  private _hasCameraUp = false;

  constructor(type: SuperStateType, surfaceU: number, surfaceV: number, mapSizeScaleFactor: number = 1.0) {
    this.type = type;
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
    this.mapSizeScaleFactor = mapSizeScaleFactor;
    this.active = true;
    this.mesh = new THREE.Group();

    this.createDotPattern();
  }

  private createDotPattern(): void {
    // Create a pattern of dots based on the super state type
    const patterns = this.getPatternForType();
    const color = this.getColorForType();

    for (const offset of patterns) {
      // Shared geometry — all dots across all SuperStatePickups use the same sphere.
      const dotMaterial = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 1.0,
      });
      dotMaterial.userData.baseOpacity = 1.0;
      const dot = new THREE.Mesh(SharedGeometries.superPickupDot(), dotMaterial);
      dot.position.set(offset.x, offset.y, offset.z);
      this.dots.push(dot);
      this.mesh.add(dot);
    }

    // Spawn indicator: flashing arrow for first 30s
    this.mesh.add(createSpawnIndicatorSprite(new THREE.Color(color)));
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

  // Dot patterns use the XZ plane (y=0) because with makeBasis(tangent, normal, bitangent):
  // local X = tangent, local Y = normal (surface outward), local Z = bitangent.
  // XZ plane = surface tangent plane, so dots sit flat on the surface.

  private createSquarePattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.2;
    return [
      { x: -size, y: 0, z: -size },
      { x: size, y: 0, z: -size },
      { x: size, y: 0, z: size },
      { x: -size, y: 0, z: size },
    ];
  }

  private createTrianglePattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.2;
    return [
      { x: 0, y: 0, z: size },
      { x: -size, y: 0, z: -size },
      { x: size, y: 0, z: -size },
    ];
  }

  private createArrowPattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.15;
    return [
      { x: 0, y: 0, z: size * 2 },
      { x: -size, y: 0, z: size },
      { x: size, y: 0, z: size },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -size },
    ];
  }

  private createCrossPattern(): Array<{ x: number; y: number; z: number }> {
    const size = 0.2;
    return [
      { x: 0, y: 0, z: size },
      { x: 0, y: 0, z: -size },
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
        y: 0,
        z: Math.sin(angle) * radius,
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
        y: 0,
        z: Math.sin(angle) * radius,
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

  update(dt: number, cameraUp?: THREE.Vector3): void {
    if (!this.active) return;

    // Track age factor for surface dimming in RenderLoop (SuperStatePickup never fades)
    this.mesh.userData.ageFactor = 1.0;

    // Animate dots - pulse effect
    this.animationTime += dt;
    const scale = 1 + Math.sin(this.animationTime * 3) * 0.3;

    for (const dot of this.dots) {
      dot.scale.set(scale, scale, scale);
    }

    // Store cameraUp for deferred use in applySurfaceTransform()
    if (cameraUp) {
      this._storedCameraUp.copy(cameraUp);
      this._hasCameraUp = true;
    }
  }

  applySurfaceTransform(
    getTransform: (u: number, v: number) => SurfaceTransform
  ): void {
    const transform = getTransform(this.surfaceU, this.surfaceV);

    // Store surface point for hitbox
    this._surfaceWorldPos.copy(transform.position);

    // Hover above surface with bob animation along normal
    const bob = Math.sin(this.animationTime * 2.5 + this._bobPhase) * 0.07;
    this.mesh.position.copy(transform.position).addScaledVector(transform.normal, 0.3 + bob);

    // Orient to surface, then spin around local Y (= surface normal) so the dot pattern
    // visibly rotates rather than appearing as a static thin line edge-on to the camera.
    _sspMat4.makeBasis(transform.tangent, transform.normal, transform.bitangent);
    _sspQSurface.setFromRotationMatrix(_sspMat4);
    _sspQSpin.setFromAxisAngle(_sspSpinAxis, this.animationTime * 0.5);
    this.mesh.quaternion.copy(_sspQSurface).multiply(_sspQSpin);

    // Update spawn indicator after quaternion is set so cameraUp transforms correctly
    updateSpawnIndicator(this.mesh, this.animationTime, this.animationTime, this._hasCameraUp ? this._storedCameraUp : undefined);
  }

  checkPlayerCollision(playerU: number, playerV: number, playerWorldPos?: THREE.Vector3): boolean {
    if (playerWorldPos) {
      return playerWorldPos.distanceTo(this._surfaceWorldPos) < PICKUP_WORLD_RADIUS * this.mapSizeScaleFactor;
    }
    let du = playerU - this.surfaceU;
    let dv = playerV - this.surfaceV;
    if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
    if (dv > 0.5) dv -= 1; else if (dv < -0.5) dv += 1;
    return Math.sqrt(du * du + dv * dv) < 0.01 / this.mapSizeScaleFactor;
  }

  removeClosestDot(playerU: number, playerV: number): boolean {
    if (this.dots.length === 0) return false;

    // Remove one dot when player gets close
    const dot = this.dots.pop();
    if (dot) {
      this.mesh.remove(dot);
      // Do NOT dispose geometry — it's shared via GeometryCache.
      (dot.material as THREE.Material).dispose();
    }

    return this.dots.length === 0; // Return true if all dots destroyed
  }

  isComplete(): boolean {
    return this.dots.length === 0;
  }

  dispose(): void {
    this.active = false;

    // Clean up all dots. Do NOT dispose geometry — it's shared via GeometryCache.
    for (const dot of this.dots) {
      (dot.material as THREE.Material).dispose();
      this.mesh.remove(dot);
    }
    this.dots = [];

    // Clean up spawn indicator sprite
    const indicator = this.mesh.getObjectByName('spawn-indicator') as THREE.Sprite | undefined;
    if (indicator) {
      indicator.material.map?.dispose();
      indicator.material.dispose();
      this.mesh.remove(indicator);
    }
  }
}
