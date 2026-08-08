import * as THREE from 'three';
import { applyPickupSurfacePose } from './PickupSurfaceVisual';
import { createShieldIconSprite, disposePickupIconSprites } from './PickupIconSprite';
import { WEAPON_PICKUP_WORLD_RADIUS as PICKUP_WORLD_RADIUS } from '../shared/GameBalanceConstants';

const SHIELD_PICKUP_LIFETIME = 12; // seconds — slightly longer than heal
const SHIELD_PICKUP_FADE_START = 9;
const SHIELD_COLOR = 0x4488ff;

/**
 * ShieldPickup — blue diamond pickup that grants one stackable shield layer.
 * Shields absorb one enemy hit entirely before HP is affected.
 */
export class ShieldPickup {
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
    group.name = 'ShieldPickup';

    const color = new THREE.Color(SHIELD_COLOR);

    // Outer hexagonal wireframe ring — distinct diamond-like shape
    const outerGeom = new THREE.OctahedronGeometry(0.18, 0);
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      wireframe: true,
    });
    outerMat.userData.baseOpacity = 0.35;
    group.add(new THREE.Mesh(outerGeom, outerMat));

    // Inner solid diamond (octahedron)
    const innerGeom = new THREE.OctahedronGeometry(0.09, 0);
    const innerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
    });
    innerMat.userData.baseOpacity = 0.9;
    const inner = new THREE.Mesh(innerGeom, innerMat);
    inner.name = 'core';
    group.add(inner);

    // Bright core
    const coreGeom = new THREE.SphereGeometry(0.04, 6, 6);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xaaccff,
      transparent: true,
      opacity: 1.0,
    });
    coreMat.userData.baseOpacity = 1.0;
    group.add(new THREE.Mesh(coreGeom, coreMat));
    group.add(createShieldIconSprite(color));

    return group;
  }

  update(dt: number, totalTime: number): void {
    if (!this.active) return;
    this.age += dt;
    if (this.age >= SHIELD_PICKUP_LIFETIME) {
      this.active = false;
      return;
    }
    this._currentTotalTime = totalTime;

    this.mesh.userData.ageFactor = this.age > SHIELD_PICKUP_FADE_START
      ? Math.max(0, 1 - (this.age - SHIELD_PICKUP_FADE_START) / (SHIELD_PICKUP_LIFETIME - SHIELD_PICKUP_FADE_START))
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
    const bob = Math.sin(this._currentTotalTime * 2.5 + this.bobPhase) * 0.07 * this.mapSizeScaleFactor;
    applyPickupSurfacePose(this.mesh, frame, {
      normalOffset: 0.35 + bob,
      spinAngle: -this._currentTotalTime * 1.2,
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
