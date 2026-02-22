import * as THREE from 'three';
import { StackBuffType, BUFF_DEFINITIONS, BuffDefinition } from './BuffManager';
import { createSpawnIndicatorSprite, updateSpawnIndicator } from '../weapons/SpawnIndicator';

// ---------------------------------------------------------------------------
// BuffPickupNew - Hexagonal buff pickup entity
// ---------------------------------------------------------------------------

const PICKUP_LIFETIME = 12; // seconds
const FADE_START = 9;       // seconds before starting fade

// Pickup collision radius in UV space (MEDIUM map, scale 1.0). See WeaponPickup for rationale.
// 0.01 UV ≈ 0.50 world units at equator on sphere-radius-8 MEDIUM map.
const PICKUP_COLLISION_RADIUS = 0.01;

export class BuffPickupNew {
  readonly mesh: THREE.Group;
  readonly buffType: StackBuffType;
  readonly def: BuffDefinition;

  surfaceU: number;
  surfaceV: number;

  active = true;
  private age = 0;
  private bobPhase: number;
  private readonly mapSizeScaleFactor: number;

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
    const coreMesh = new THREE.Mesh(coreGeom, coreMat);
    coreMesh.name = 'core';
    group.add(coreMesh);

    // Category indicator letter (using a simple line-based mark)
    const indicator = this.createCategoryIndicator(categoryColor);
    if (indicator) {
      indicator.position.y = 0.12;
      group.add(indicator);
    }

    // Spawn indicator: flashing arrow for first 30s
    group.add(createSpawnIndicatorSprite(categoryColor));

    return group;
  }

  private createCategoryIndicator(color: THREE.Color): THREE.Object3D | null {
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });

    switch (this.def.category) {
      case 'offensive': {
        // Upward arrow (damage)
        const pts = [
          new THREE.Vector3(0, -0.06, 0),
          new THREE.Vector3(0, 0.06, 0),
          new THREE.Vector3(-0.04, 0.02, 0),
          new THREE.Vector3(0, 0.06, 0),
          new THREE.Vector3(0.04, 0.02, 0),
        ];
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      }
      case 'defensive': {
        // Shield shape
        const pts = [
          new THREE.Vector3(-0.04, 0.04, 0),
          new THREE.Vector3(0, 0.06, 0),
          new THREE.Vector3(0.04, 0.04, 0),
          new THREE.Vector3(0.04, -0.02, 0),
          new THREE.Vector3(0, -0.06, 0),
          new THREE.Vector3(-0.04, -0.02, 0),
          new THREE.Vector3(-0.04, 0.04, 0),
        ];
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      }
      case 'utility': {
        // Star/speed lines
        const group = new THREE.Group();
        for (let i = -1; i <= 1; i++) {
          const pts = [
            new THREE.Vector3(-0.05, i * 0.03, 0),
            new THREE.Vector3(0.05, i * 0.03, 0),
          ];
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
        return group;
      }
      case 'elemental': {
        // Lightning bolt
        const pts = [
          new THREE.Vector3(-0.02, 0.06, 0),
          new THREE.Vector3(0.01, 0.01, 0),
          new THREE.Vector3(-0.01, -0.01, 0),
          new THREE.Vector3(0.02, -0.06, 0),
        ];
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      }
      default:
        return null;
    }
  }

  update(dt: number, totalTime: number): void {
    if (!this.active) return;

    this.age += dt;
    if (this.age >= PICKUP_LIFETIME) {
      this.active = false;
      return;
    }

    // Slow spin
    this.mesh.rotation.y = totalTime * 2;

    // Bob up and down
    const bob = Math.sin(totalTime * 2.5 + this.bobPhase) * 0.04;
    this.mesh.position.y += bob * dt;

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

    // Animate spawn indicator (visible for first 30s)
    updateSpawnIndicator(this.mesh, this.age, totalTime);

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
    this.mesh.position.copy(position).add(normal.clone().multiplyScalar(0.4));
    const mat = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
    this.mesh.quaternion.setFromRotationMatrix(mat);
  }

  checkPlayerCollision(playerU: number, playerV: number): boolean {
    if (!this.active) return false;
    const du = playerU - this.surfaceU;
    const dv = playerV - this.surfaceV;
    return Math.sqrt(du * du + dv * dv) < PICKUP_COLLISION_RADIUS / this.mapSizeScaleFactor;
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
