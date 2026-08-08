import * as THREE from 'three';
import { applyPickupSurfacePose } from './PickupSurfaceVisual';
import { createHealthIconSprite, disposePickupIconSprites } from './PickupIconSprite';
import { WEAPON_PICKUP_WORLD_RADIUS as PICKUP_WORLD_RADIUS } from '../shared/GameBalanceConstants';

const HEAL_PICKUP_LIFETIME = 10; // seconds
const HEAL_PICKUP_FADE_START = 7;
const HEAL_COLOR = 0x00ff44;

/**
 * HealPickup — green orb pickup that restores player HP.
 * Spawns on enemy death; collected by walking over it.
 */
export class HealPickup {
  readonly mesh: THREE.Group;
  surfaceU: number;
  surfaceV: number;
  active = true;

  private age = 0;
  private bobPhase: number;
  private readonly mapSizeScaleFactor: number;
  private _currentTotalTime = 0;
  private readonly _surfaceWorldPos = new THREE.Vector3();

  constructor(u: number, v: number, mapSizeScaleFactor = 1.0) {
    this.surfaceU = u;
    this.surfaceV = v;
    this.mapSizeScaleFactor = mapSizeScaleFactor;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.mesh = this.createMesh();
  }

  private createMesh(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'HealPickup';

    const color = new THREE.Color(HEAL_COLOR);

    // Outer glow sphere
    const outerGeom = new THREE.SphereGeometry(0.18, 8, 8);
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      wireframe: true,
    });
    outerMat.userData.baseOpacity = 0.4;
    group.add(new THREE.Mesh(outerGeom, outerMat));

    // Inner solid sphere
    const innerGeom = new THREE.SphereGeometry(0.10, 8, 6);
    const innerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
    });
    innerMat.userData.baseOpacity = 0.9;
    const inner = new THREE.Mesh(innerGeom, innerMat);
    inner.name = 'core';
    group.add(inner);

    // Cross/plus indicator (two thin boxes — health cross symbol)
    const crossH = new THREE.BoxGeometry(0.12, 0.03, 0.03);
    const crossV = new THREE.BoxGeometry(0.03, 0.12, 0.03);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    crossMat.userData.baseOpacity = 0.9;
    group.add(new THREE.Mesh(crossH, crossMat));
    group.add(new THREE.Mesh(crossV, crossMat.clone()));
    group.add(createHealthIconSprite(color));

    return group;
  }

  update(dt: number, totalTime: number): void {
    if (!this.active) return;
    this.age += dt;
    if (this.age >= HEAL_PICKUP_LIFETIME) {
      this.active = false;
      return;
    }
    this._currentTotalTime = totalTime;

    this.mesh.userData.ageFactor = this.age > HEAL_PICKUP_FADE_START
      ? Math.max(0, 1 - (this.age - HEAL_PICKUP_FADE_START) / (HEAL_PICKUP_LIFETIME - HEAL_PICKUP_FADE_START))
      : 1;
  }

  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    const frame = getTransform(this.surfaceU, this.surfaceV);
    this._surfaceWorldPos.copy(frame.position);
    const bob = Math.sin(this._currentTotalTime * 3 + this.bobPhase) * 0.06 * this.mapSizeScaleFactor;
    applyPickupSurfacePose(this.mesh, frame, {
      normalOffset: 0.35 + bob,
      spinAngle: this._currentTotalTime * 1.5,
    });
  }

  checkPlayerCollision(playerU: number, playerV: number, playerWorldPos?: THREE.Vector3): boolean {
    if (this.mesh.userData.pickupVisualProof === true) return false;
    if (!this.active) return false;
    if (playerWorldPos) {
      return playerWorldPos.distanceTo(this._surfaceWorldPos) < PICKUP_WORLD_RADIUS * this.mapSizeScaleFactor;
    }
    let du = playerU - this.surfaceU;
    let dv = playerV - this.surfaceV;
    if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
    if (dv > 0.5) dv -= 1; else if (dv < -0.5) dv += 1;
    return Math.sqrt(du * du + dv * dv) < 0.01 / this.mapSizeScaleFactor;
  }

  dispose(): void {
    disposePickupIconSprites(this.mesh);
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        const mat = child.material;
        if (mat instanceof THREE.Material) mat.dispose();
      }
    });
  }
}
