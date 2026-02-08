import * as THREE from 'three';

/**
 * Buff type identifiers
 */
export enum BuffType {
  ExtendedRange = 'extended_range',
  RapidFire = 'rapid_fire',
  DurationPlus = 'duration_plus',
}

/**
 * Buff configuration
 */
export interface BuffConfig {
  type: BuffType;
  name: string;
  color: number;
  duration: number; // seconds the buff lasts
  multiplier: number; // how much to boost the stat
  description: string;
}

export const BUFF_CONFIGS: Record<BuffType, BuffConfig> = {
  [BuffType.ExtendedRange]: {
    type: BuffType.ExtendedRange,
    name: 'Extended Range',
    color: 0x44ff88,
    duration: 15,
    multiplier: 1.75,
    description: 'Projectiles travel 75% further',
  },
  [BuffType.RapidFire]: {
    type: BuffType.RapidFire,
    name: 'Rapid Fire',
    color: 0xff8844,
    duration: 10,
    multiplier: 2.0,
    description: 'Double fire rate',
  },
  [BuffType.DurationPlus]: {
    type: BuffType.DurationPlus,
    name: 'Duration+',
    color: 0x8844ff,
    duration: 20,
    multiplier: 2.0,
    description: 'Weapon ammo lasts twice as long',
  },
};

/**
 * Active buff state
 */
export interface ActiveBuff {
  type: BuffType;
  remaining: number; // seconds left
  multiplier: number;
}

/**
 * Floating buff pickup on the surface
 */
export class BuffPickup {
  readonly mesh: THREE.Group;
  readonly buffType: BuffType;

  surfaceU: number;
  surfaceV: number;

  active: boolean = true;
  private age: number = 0;
  private readonly maxAge: number = 15;
  private readonly fadeStart: number = 11;
  private bobPhase: number;

  constructor(buffType: BuffType, surfaceU: number, surfaceV: number) {
    this.buffType = buffType;
    this.surfaceU = surfaceU;
    this.surfaceV = surfaceV;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.mesh = this.createMesh();
  }

  private createMesh(): THREE.Group {
    const group = new THREE.Group();
    group.name = `BuffPickup_${this.buffType}`;

    const config = BUFF_CONFIGS[this.buffType];
    const color = new THREE.Color(config.color);

    // Diamond shape (rotated cube) - distinct from weapon octahedron
    const outerGeom = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });
    const outerMesh = new THREE.Mesh(outerGeom, outerMat);
    outerMesh.rotation.set(Math.PI / 4, 0, Math.PI / 4);
    group.add(outerMesh);

    // Inner core
    const innerGeom = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const innerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
    });
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    innerMesh.rotation.set(Math.PI / 4, 0, Math.PI / 4);
    innerMesh.name = 'core';
    group.add(innerMesh);

    // Arrow indicator based on buff type
    const indicator = this.createBuffIndicator(color);
    if (indicator) group.add(indicator);

    return group;
  }

  private createBuffIndicator(color: THREE.Color): THREE.Object3D | null {
    switch (this.buffType) {
      case BuffType.ExtendedRange: {
        // Right-pointing arrow (range)
        const points = [
          new THREE.Vector3(-0.1, 0, 0),
          new THREE.Vector3(0.1, 0, 0),
          new THREE.Vector3(0.06, 0.04, 0),
          new THREE.Vector3(0.1, 0, 0),
          new THREE.Vector3(0.06, -0.04, 0),
        ];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geom, new THREE.LineBasicMaterial({ color }));
      }
      case BuffType.RapidFire: {
        // Triple horizontal lines (speed)
        const group = new THREE.Group();
        const mat = new THREE.LineBasicMaterial({ color });
        for (let i = -1; i <= 1; i++) {
          const pts = [
            new THREE.Vector3(-0.08, i * 0.04, 0),
            new THREE.Vector3(0.08, i * 0.04, 0),
          ];
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
        }
        return group;
      }
      case BuffType.DurationPlus: {
        // Plus sign
        const mat = new THREE.LineBasicMaterial({ color });
        const h = [new THREE.Vector3(-0.08, 0, 0), new THREE.Vector3(0.08, 0, 0)];
        const v = [new THREE.Vector3(0, -0.08, 0), new THREE.Vector3(0, 0.08, 0)];
        const group = new THREE.Group();
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(h), mat));
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), mat));
        return group;
      }
      default:
        return null;
    }
  }

  update(dt: number, totalTime: number): void {
    if (!this.active) return;

    this.age += dt;
    if (this.age >= this.maxAge) {
      this.active = false;
      return;
    }

    // Spin (faster than weapons to distinguish)
    this.mesh.rotation.y = totalTime * 3;

    // Bob
    const bob = Math.sin(totalTime * 3 + this.bobPhase) * 0.05;
    this.mesh.position.y += bob * dt;

    // Pulse core
    const core = this.mesh.getObjectByName('core');
    if (core) {
      const pulse = 1 + Math.sin(totalTime * 6) * 0.2;
      core.scale.setScalar(pulse);
    }

    // Fade near end of life
    if (this.age > this.fadeStart) {
      const fadeProgress = (this.age - this.fadeStart) / (this.maxAge - this.fadeStart);
      const opacity = 1 - fadeProgress;
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          const mat = child.material as THREE.Material;
          if ('opacity' in mat) {
            (mat as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
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
    this.mesh.position.copy(position).add(normal.clone().multiplyScalar(0.5));
    const mat = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
    this.mesh.quaternion.setFromRotationMatrix(mat);
  }

  checkPlayerCollision(playerU: number, playerV: number): boolean {
    if (!this.active) return false;
    const du = playerU - this.surfaceU;
    const dv = playerV - this.surfaceV;
    return Math.sqrt(du * du + dv * dv) < 0.08;
  }

  dispose(): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        (child as THREE.Mesh).geometry.dispose();
        if ((child as THREE.Mesh).material instanceof THREE.Material) {
          ((child as THREE.Mesh).material as THREE.Material).dispose();
        }
      }
    });
  }
}

/**
 * Random buff type selection (equal weights)
 */
export function getRandomBuffType(): BuffType {
  const types = [BuffType.ExtendedRange, BuffType.RapidFire, BuffType.DurationPlus];
  return types[Math.floor(Math.random() * types.length)];
}
