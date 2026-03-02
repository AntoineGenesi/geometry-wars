import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS, getWeaponColor } from './WeaponTypes';
import { SharedGeometries } from '../rendering/GeometryCache';
import { createSpawnIndicatorSprite, updateSpawnIndicator } from './SpawnIndicator';
import { createWeaponIconSprite } from '../pickups/PickupIconSprite';

// Pre-allocated temps for applySurfaceTransform (zero per-call allocations)
const _wpMat4 = new THREE.Matrix4();
const _wpQSurface = new THREE.Quaternion();
const _wpQSpin = new THREE.Quaternion();
const _wpSpinAxis = new THREE.Vector3(0, 1, 0); // local Y = surface normal

// World-space pickup collision radius (in world units).
// Using world-space distance instead of UV-space because UV metric is non-uniform:
// 0.01 UV = 0.63 world units at sphere equator but only 0.13 on torus tube direction.
// Player visual radius ≈ 0.15 world units; increased to 0.25 for more forgiving collection.
// Multiplied by mapSizeScaleFactor so UV-proximity feel is consistent across map sizes.
// At MEDIUM (scale=1): 0.25 = ~0.8 player-widths. At EPIC (scale=2): 0.50 = 1.6 player-widths.
// S44f-05: Increased from 0.15 to 0.25 for less strict collection (user was hitting pickups but not collecting).
const PICKUP_WORLD_RADIUS = 0.25;

/**
 * Floating weapon pickup that grants new weapons to player
 */
export class WeaponPickup {
  readonly mesh: THREE.Group;
  readonly type: WeaponType;

  // Surface position
  surfaceU: number;
  surfaceV: number;

  // World-space position on surface (updated in applySurfaceTransform; used for hitbox)
  private readonly _surfaceWorldPos: THREE.Vector3 = new THREE.Vector3();

  // State
  active: boolean = true;
  private age: number = 0;
  private readonly maxAge: number = 20; // Despawn after 20 seconds
  private readonly fadeStart: number = 15; // Start fading at 15 seconds
  private readonly mapSizeScaleFactor: number;

  // Animation
  private bobPhase: number;
  private spinSpeed: number = 2;
  private _currentTotalTime: number = 0;

  // Deferred cameraUp: stored in update(), consumed in applySurfaceTransform() after quaternion is set
  private readonly _storedCameraUp = new THREE.Vector3();
  private _hasCameraUp = false;

  constructor(type: WeaponType, surfaceU: number, surfaceV: number, mapSizeScaleFactor: number = 1.0) {
    this.type = type;
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
    this.mapSizeScaleFactor = mapSizeScaleFactor;
    this.bobPhase = Math.random() * Math.PI * 2;

    this.mesh = this.createMesh();
  }

  /**
   * Create the pickup visual - rotating octahedron with inner icon
   */
  private createMesh(): THREE.Group {
    const group = new THREE.Group();
    group.name = `WeaponPickup_${this.type}`;

    const config = WEAPON_CONFIGS[this.type];
    const color = new THREE.Color(config.color);

    // Outer octahedron (wireframe) — shared geometry, per-instance material
    const outerMat = new THREE.MeshBasicMaterial({
      color: color,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });
    outerMat.userData.baseOpacity = 0.8;
    const outerMesh = new THREE.Mesh(SharedGeometries.weaponPickupOuter(), outerMat);
    group.add(outerMesh);

    // Inner solid core — shared geometry, per-instance material
    const innerMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
    });
    innerMat.userData.baseOpacity = 0.6;
    const innerMesh = new THREE.Mesh(SharedGeometries.weaponPickupInner(), innerMat);
    innerMesh.name = 'core';
    group.add(innerMesh);

    // Glow sprite
    const glowTexture = this.createGlowTexture(color);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0.4,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    glowMat.userData.baseOpacity = 0.4;
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.setScalar(1.5);
    group.add(glowSprite);

    // Canvas icon sprite (faces camera; covers all weapon types with recognizable symbols)
    const iconSprite = createWeaponIconSprite(this.type, color);
    group.add(iconSprite);

    // Spawn indicator: flashing arrow for first 30s
    group.add(createSpawnIndicatorSprite(color));

    return group;
  }

  /**
   * Create glow texture
   */
  private createGlowTexture(color: THREE.Color): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );

    const r = Math.floor(color.r * 255);
    const g = Math.floor(color.g * 255);
    const b = Math.floor(color.b * 255);

    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.5)`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
  }

  /**
   * Update pickup animation and state
   * @param cameraUp  Camera's world-space up vector — passed to spawn indicator for correct screen placement
   */
  update(dt: number, totalTime: number, cameraUp?: THREE.Vector3): void {
    if (!this.active) return;

    this.age += dt;

    // Check expiration
    if (this.age >= this.maxAge) {
      this.active = false;
      return;
    }

    // Store totalTime for use in applySurfaceTransform (bob along surface normal)
    this._currentTotalTime = totalTime;

    // Pulse the inner core
    const core = this.mesh.getObjectByName('core');
    if (core) {
      const pulse = 0.15 + Math.sin(totalTime * 5) * 0.03;
      core.scale.setScalar(pulse / 0.15);
    }

    // Store cameraUp for use in applySurfaceTransform() (called after update()).
    // updateSpawnIndicator is deferred there so it runs with the correct surface quaternion.
    if (cameraUp) {
      this._storedCameraUp.copy(cameraUp);
      this._hasCameraUp = true;
    }

    // Track age factor for surface dimming in RenderLoop
    this.mesh.userData.ageFactor = this.age > this.fadeStart
      ? Math.max(0, 1 - (this.age - this.fadeStart) / (this.maxAge - this.fadeStart))
      : 1.0;

    // Fade out near end of life
    if (this.age > this.fadeStart) {
      const fadeProgress = (this.age - this.fadeStart) / (this.maxAge - this.fadeStart);
      const opacity = 1 - fadeProgress;

      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          const mat = child.material as THREE.Material;
          if ('opacity' in mat) {
            mat.opacity = opacity * (mat.userData.baseOpacity ?? 0.8);
          }
        }
        if (child instanceof THREE.Sprite) {
          child.material.opacity = opacity * 0.4;
        }
      });
    }
  }

  /**
   * Apply surface transform to position pickup correctly
   */
  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    const { position, normal, tangent, bitangent } = getTransform(this.surfaceU, this.surfaceV);

    // Store surface world position (before hover offset) for hitbox
    this._surfaceWorldPos.copy(position);

    // Hover above surface with bob animation along normal (scaled by map size for consistency)
    const bob = Math.sin(this._currentTotalTime * 3 + this.bobPhase) * 0.08 * this.mapSizeScaleFactor;
    this.mesh.position.copy(position).addScaledVector(normal, 0.5 + bob);

    // Orient to surface, then apply spin around local Y (= surface normal).
    // This makes the 3D wireframe visibly rotate so the octahedron looks 3D,
    // not like a flat 2D diamond. (Previously rotation.y in update() was overridden here.)
    _wpMat4.makeBasis(tangent, normal, bitangent);
    _wpQSurface.setFromRotationMatrix(_wpMat4);
    _wpQSpin.setFromAxisAngle(_wpSpinAxis, this._currentTotalTime * this.spinSpeed);
    this.mesh.quaternion.copy(_wpQSurface).multiply(_wpQSpin);

    // Update spawn indicator NOW (after quaternion is set) so the correct surface
    // orientation is used to transform cameraUp into local space.
    updateSpawnIndicator(this.mesh, this.age, this._currentTotalTime, this._hasCameraUp ? this._storedCameraUp : undefined);
  }

  /**
   * Check if player is close enough to collect.
   * Uses world-space distance (uniform across all surfaces and map sizes).
   * Falls back to UV-space when playerWorldPos is unavailable.
   */
  checkPlayerCollision(playerU: number, playerV: number, playerWorldPos?: THREE.Vector3): boolean {
    if (!this.active) return false;

    if (playerWorldPos) {
      return playerWorldPos.distanceTo(this._surfaceWorldPos) < PICKUP_WORLD_RADIUS * this.mapSizeScaleFactor;
    }

    // UV fallback with shortest-path wrapping for seam-safe distance
    let du = playerU - this.surfaceU;
    let dv = playerV - this.surfaceV;
    if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
    if (dv > 0.5) dv -= 1; else if (dv < -0.5) dv += 1;
    return Math.sqrt(du * du + dv * dv) < 0.01 / this.mapSizeScaleFactor;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Do NOT dispose shared geometries (outer/inner octahedra from GeometryCache).
        // Only dispose per-instance materials.
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Line) {
        // Line geometries (weapon indicator shapes) are unique per instance — dispose them.
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        child.material.dispose();
        child.material.map?.dispose();
      }
    });
  }
}

/**
 * Random weapon type selection (weighted toward more common weapons)
 */
export function getRandomWeaponType(): WeaponType {
  const weights: [WeaponType, number][] = [
    [WeaponType.Spread, 20],
    [WeaponType.Piercing, 15],
    [WeaponType.ChainLightning, 12],
    [WeaponType.Homing, 15],
    [WeaponType.PlasmaMortar, 10],
    [WeaponType.GravityGun, 8],
    [WeaponType.LaserBeam, 8],
    [WeaponType.TeslaCoil, 3],  // nerfed from 7 — ammo halved + less frequent
    [WeaponType.BlackHole, 5],
  ];

  const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (const [type, weight] of weights) {
    random -= weight;
    if (random <= 0) return type;
  }

  return WeaponType.Spread;
}
