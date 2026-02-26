import * as THREE from 'three';
import { StackBuffType, BUFF_DEFINITIONS, BuffDefinition } from './BuffManager';
import { createSpawnIndicatorSprite, updateSpawnIndicator } from '../weapons/SpawnIndicator';
import { createBuffIconSprite } from '../pickups/PickupIconSprite';

// ---------------------------------------------------------------------------
// BuffPickupNew - Hexagonal buff pickup entity
// ---------------------------------------------------------------------------

const PICKUP_LIFETIME = 12; // seconds
const FADE_START = 9;       // seconds before starting fade

// World-space pickup collision radius. See WeaponPickup.ts for rationale.
const PICKUP_WORLD_RADIUS = 0.6;

export class BuffPickupNew {
  readonly mesh: THREE.Group;
  readonly buffType: StackBuffType;
  readonly def: BuffDefinition;

  surfaceU: number;
  surfaceV: number;

  private readonly _surfaceWorldPos: THREE.Vector3 = new THREE.Vector3();

  active = true;
  private age = 0;
  private bobPhase: number;
  private _currentTotalTime = 0;
  private readonly mapSizeScaleFactor: number;
  private readonly _storedCameraUp = new THREE.Vector3();
  private _hasCameraUp = false;

  constructor(type: StackBuffType, surfaceU: number, surfaceV: number, mapSizeScaleFactor: number = 1.0) {
    this.buffType = type;
    this.def = BUFF_DEFINITIONS[type];
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
    this.mapSizeScaleFactor = mapSizeScaleFactor;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.mesh = this.createMesh();
  }

  private createMesh(): THREE.Group {
    const group = new THREE.Group();
    group.name = `BuffPickup_${this.buffType}`;

    const categoryColor = new THREE.Color(this.def.iconColor);
    const rarityColor = this.def.rarity === 'uncommon'
      ? new THREE.Color(0x44ff44)
      : new THREE.Color(0xffffff);

    // Hexagonal prism (6-sided, flat top/bottom) - distinct from weapon octahedrons
    const hexGeom = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 6, 1, false);
    const hexMat = new THREE.MeshBasicMaterial({
      color: categoryColor,
      transparent: true,
      opacity: 0.7,
    });
    hexMat.userData.baseOpacity = 0.7;
    const hexMesh = new THREE.Mesh(hexGeom, hexMat);
    hexMesh.name = 'hex-body';
    group.add(hexMesh);

    // Rarity wireframe ring
    const ringGeom = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 6, 1, true);
    const ringMat = new THREE.MeshBasicMaterial({
      color: rarityColor,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });
    ringMat.userData.baseOpacity = 0.6;
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.name = 'rarity-ring';
    group.add(ringMesh);

    // Inner glow core (small sphere)
    const coreGeom = new THREE.SphereGeometry(0.06, 8, 8);
    const coreMat = new THREE.MeshBasicMaterial({
      color: categoryColor,
      transparent: true,
      opacity: 0.9,
    });
    coreMat.userData.baseOpacity = 0.9;
    const coreMesh = new THREE.Mesh(coreGeom, coreMat);
    coreMesh.name = 'core';
    group.add(coreMesh);

    // Canvas icon sprite (per-buff-type, faces camera for readability)
    const iconSprite = createBuffIconSprite(this.buffType, categoryColor, this.def.category);
    group.add(iconSprite);

    // Spawn indicator: flashing arrow for first 30s
    group.add(createSpawnIndicatorSprite(categoryColor));

    return group;
  }

  update(dt: number, totalTime: number, cameraUp?: THREE.Vector3): void {
    if (!this.active) return;

    this.age += dt;
    if (this.age >= PICKUP_LIFETIME) {
      this.active = false;
      return;
    }

    // Store totalTime for bob animation in applySurfaceTransform
    this._currentTotalTime = totalTime;

    // Slow spin
    this.mesh.rotation.y = totalTime * 2;

    // Pulse core
    const core = this.mesh.getObjectByName('core');
    if (core) {
      const pulse = 1 + Math.sin(totalTime * 5) * 0.25;
      core.scale.setScalar(pulse);
    }

    // Pulse rarity ring
    const ring = this.mesh.getObjectByName('rarity-ring');
    if (ring) {
      const ringPulse = 1 + Math.sin(totalTime * 3) * 0.1;
      ring.scale.setScalar(ringPulse);
    }

    // Store cameraUp for deferred use in applySurfaceTransform()
    if (cameraUp) {
      this._storedCameraUp.copy(cameraUp);
      this._hasCameraUp = true;
    }

    // Track age factor for surface dimming in RenderLoop
    this.mesh.userData.ageFactor = this.age > FADE_START
      ? Math.max(0, 1 - (this.age - FADE_START) / (PICKUP_LIFETIME - FADE_START))
      : 1.0;

    // Fade near end of life
    if (this.age > FADE_START) {
      const fadeProgress = (this.age - FADE_START) / (PICKUP_LIFETIME - FADE_START);
      const opacity = 1 - fadeProgress;
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          const mat = child.material as THREE.Material;
          if ('opacity' in mat) {
            (mat as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
          }
        }
      });
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
    const bob = Math.sin(this._currentTotalTime * 2.5 + this.bobPhase) * 0.08;
    this.mesh.position.copy(position).addScaledVector(normal, 0.4 + bob);
    const mat = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
    this.mesh.quaternion.setFromRotationMatrix(mat);

    // Update spawn indicator after quaternion is set so cameraUp transforms correctly
    updateSpawnIndicator(this.mesh, this.age, this._currentTotalTime, this._hasCameraUp ? this._storedCameraUp : undefined);
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
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        (child as THREE.Mesh).geometry?.dispose();
        const mat = (child as THREE.Mesh).material;
        if (mat instanceof THREE.Material) {
          mat.dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    });
  }
}
