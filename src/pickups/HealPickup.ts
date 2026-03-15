import * as THREE from 'three';
import { WEAPON_PICKUP_WORLD_RADIUS as PICKUP_WORLD_RADIUS } from '../shared/GameBalanceConstants';

const HEAL_PICKUP_LIFETIME = 10; // seconds
const HEAL_PICKUP_FADE_START = 7;
const HEAL_COLOR = 0x00ff44;

const _mat4 = new THREE.Matrix4();
const _qSurface = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _spinAxis = new THREE.Vector3(0, 1, 0);

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
  /** Cached opacity multiplier — only call traverse() when this changes (s44r18-19 fix). */
  private _lastOpacityMultiplier = 1.0;

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
    group.add(new THREE.Mesh(innerGeom, innerMat));

    // Cross/plus indicator (two thin boxes — health cross symbol)
    const crossH = new THREE.BoxGeometry(0.12, 0.03, 0.03);
    const crossV = new THREE.BoxGeometry(0.03, 0.12, 0.03);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    crossMat.userData.baseOpacity = 0.9;
    group.add(new THREE.Mesh(crossH, crossMat));
    group.add(new THREE.Mesh(crossV, crossMat.clone()));

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

    // Fade near end of life.
    // Only call traverse() when opacity actually changes — avoids per-frame mesh walks (s44r18-19 fix).
    if (this.age > HEAL_PICKUP_FADE_START) {
      const fadeProgress = (this.age - HEAL_PICKUP_FADE_START) / (HEAL_PICKUP_LIFETIME - HEAL_PICKUP_FADE_START);
      const opacity = Math.max(0, 1 - fadeProgress);
      if (Math.abs(opacity - this._lastOpacityMultiplier) > 0.005) {
        this._lastOpacityMultiplier = opacity;
        this.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshBasicMaterial;
            if (mat.transparent && mat.userData.baseOpacity != null) {
              mat.opacity = opacity * mat.userData.baseOpacity;
            }
          }
        });
      }
    }
  }

  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    const { position, normal, tangent, bitangent } = getTransform(this.surfaceU, this.surfaceV);
    this._surfaceWorldPos.copy(position);
    const bob = Math.sin(this._currentTotalTime * 3 + this.bobPhase) * 0.06 * this.mapSizeScaleFactor;
    this.mesh.position.copy(position).addScaledVector(normal, 0.35 + bob);
    _mat4.makeBasis(tangent, normal, bitangent);
    _qSurface.setFromRotationMatrix(_mat4);
    _qSpin.setFromAxisAngle(_spinAxis, this._currentTotalTime * 1.5);
    this.mesh.quaternion.copy(_qSurface).multiply(_qSpin);
  }

  checkPlayerCollision(playerU: number, playerV: number, playerWorldPos?: THREE.Vector3): boolean {
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
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        const mat = child.material;
        if (mat instanceof THREE.Material) mat.dispose();
      }
    });
  }
}
