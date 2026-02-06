import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS, getWeaponColor } from './WeaponTypes';

/**
 * Floating weapon pickup that grants new weapons to player
 */
export class WeaponPickup {
  readonly mesh: THREE.Group;
  readonly type: WeaponType;

  // Surface position
  surfaceU: number;
  surfaceV: number;

  // State
  active: boolean = true;
  private age: number = 0;
  private readonly maxAge: number = 20; // Despawn after 20 seconds
  private readonly fadeStart: number = 15; // Start fading at 15 seconds

  // Animation
  private bobPhase: number;
  private spinSpeed: number = 2;

  constructor(type: WeaponType, surfaceU: number, surfaceV: number) {
    this.type = type;
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
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

    // Outer octahedron (wireframe)
    const outerGeom = new THREE.OctahedronGeometry(0.35);
    const outerMat = new THREE.MeshBasicMaterial({
      color: color,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });
    const outerMesh = new THREE.Mesh(outerGeom, outerMat);
    group.add(outerMesh);

    // Inner solid core
    const innerGeom = new THREE.OctahedronGeometry(0.15);
    const innerMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
    });
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    innerMesh.name = 'core';
    group.add(innerMesh);

    // Glow sprite
    const glowTexture = this.createGlowTexture(color);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.setScalar(1.5);
    group.add(glowSprite);

    // Add weapon type indicator (small icon based on type)
    const indicator = this.createWeaponIndicator();
    if (indicator) {
      group.add(indicator);
    }

    return group;
  }

  /**
   * Create weapon-specific indicator mesh
   */
  private createWeaponIndicator(): THREE.Object3D | null {
    const color = new THREE.Color(0xffffff);

    switch (this.type) {
      case WeaponType.Spread: {
        // Fan of lines
        const group = new THREE.Group();
        const lineMat = new THREE.LineBasicMaterial({ color });
        for (let i = -2; i <= 2; i++) {
          const angle = (i * 15 * Math.PI) / 180;
          const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(Math.sin(angle) * 0.2, 0, Math.cos(angle) * 0.2),
          ];
          const geom = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geom, lineMat);
          group.add(line);
        }
        return group;
      }

      case WeaponType.ChainLightning: {
        // Zigzag lightning bolt
        const points = [
          new THREE.Vector3(-0.1, 0, 0.1),
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0.05, 0, -0.05),
          new THREE.Vector3(-0.05, 0, -0.1),
          new THREE.Vector3(0.1, 0, -0.15),
        ];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: 0x88aaff });
        return new THREE.Line(geom, mat);
      }

      case WeaponType.Homing: {
        // Small arrow pointing forward
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.08);
        shape.lineTo(0.06, -0.08);
        shape.lineTo(0, -0.04);
        shape.lineTo(-0.06, -0.08);
        shape.closePath();

        const geom = new THREE.ShapeGeometry(shape);
        geom.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
        return new THREE.Mesh(geom, mat);
      }

      case WeaponType.LaserBeam: {
        // Horizontal line
        const points = [
          new THREE.Vector3(-0.15, 0, 0),
          new THREE.Vector3(0.15, 0, 0),
        ];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
        return new THREE.Line(geom, mat);
      }

      default:
        return null;
    }
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
   */
  update(dt: number, totalTime: number): void {
    if (!this.active) return;

    this.age += dt;

    // Check expiration
    if (this.age >= this.maxAge) {
      this.active = false;
      return;
    }

    // Spin animation
    this.mesh.rotation.y = totalTime * this.spinSpeed;

    // Bob animation
    const bob = Math.sin(totalTime * 3 + this.bobPhase) * 0.05;
    this.mesh.position.y += bob * dt;

    // Pulse the inner core
    const core = this.mesh.getObjectByName('core');
    if (core) {
      const pulse = 0.15 + Math.sin(totalTime * 5) * 0.03;
      core.scale.setScalar(pulse / 0.15);
    }

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

    // Hover above surface
    this.mesh.position.copy(position).add(normal.clone().multiplyScalar(0.5));

    // Orient to surface
    const mat = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
    this.mesh.quaternion.setFromRotationMatrix(mat);
  }

  /**
   * Check if player is close enough to collect
   */
  checkPlayerCollision(playerU: number, playerV: number): boolean {
    if (!this.active) return false;

    const du = playerU - this.surfaceU;
    const dv = playerV - this.surfaceV;
    const dist = Math.sqrt(du * du + dv * dv);

    return dist < 0.08;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Line) {
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
    [WeaponType.TeslaCoil, 7],
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
