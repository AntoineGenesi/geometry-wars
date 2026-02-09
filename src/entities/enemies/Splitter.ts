import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPolygon3D } from '../../utils/GeometryBuilder';

/**
 * Splitter - Large hexagonal frame that splits into smaller hexagons on death.
 *
 * Moves in straight lines and bounces off surface edges. When killed,
 * splits into 3 medium SplitterChild hexagons (generation 1). Those
 * split into 2 small hexagons each (generation 2). Creates cascading chaos.
 *
 * Visual: hexagonal tube-frame that pulses in size, yellow-green color.
 */

// Pre-allocated temps for zero GC
const _splitDir = { u: 0, v: 0 };

/** Callback for spawning children on death (set by game/spawner) */
export type SplitterSpawnCallback = (
  u: number, v: number, generation: number
) => void;

export class Splitter extends BaseEnemy {
  /** 0 = original (large), 1 = medium child, 2 = tiny grandchild */
  readonly generation: number;

  private directionU: number;
  private directionV: number;
  private pulseTimer: number = 0;
  private readonly baseMeshScale: number;

  /** Global callback to spawn children when this splitter dies. */
  static onSplitterDeath: SplitterSpawnCallback | null = null;

  constructor(surfaceU: number, surfaceV: number, generation: number = 0) {
    // Stats scale down per generation
    const healthByGen = [5, 3, 1];
    const scoreByGen = [40, 20, 10];
    const geomsByGen = [4, 2, 1];
    const speedByGen = [0.04, 0.055, 0.07]; // smaller ones are faster
    const radiusByGen = [0.35, 0.22, 0.13];

    const gen = Math.min(generation, 2);
    super(
      surfaceU, surfaceV,
      healthByGen[gen],
      scoreByGen[gen],
      geomsByGen[gen],
      speedByGen[gen],
      radiusByGen[gen]
    );

    this.generation = gen;
    this.baseTypeName = 'splitter';

    // Random initial direction
    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);

    // Mesh scale depends on generation
    this.baseMeshScale = [1.0, 0.6, 0.35][gen];

    this.createMesh();
  }

  private createMesh(): void {
    // Hexagonal tube-frame - yellow-green
    const sizeByGen = [0.3, 0.18, 0.1];
    const size = sizeByGen[this.generation];
    this.mesh = buildPolygon3D(6, size, 0xaaff00, 0.06, 0.02);

    if (this.mesh) {
      this.mesh.scale.setScalar(this.baseMeshScale);
    }
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Pulse the mesh scale
    this.pulseTimer += dt;
    if (this.mesh) {
      const pulse = 1.0 + Math.sin(this.pulseTimer * 3) * 0.1;
      const s = this.baseMeshScale * pulse;
      this.mesh.scale.set(s, s, s);
    }

    // Move in straight line
    this.surfacePosition.u += this.directionU * this.speed * dt;
    this.surfacePosition.v += this.directionV * this.speed * dt;

    // Bounce off surface edges
    if (this.surfacePosition.u <= 0 || this.surfacePosition.u >= 1) {
      this.directionU *= -1;
      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
    }
    if (this.surfacePosition.v <= 0 || this.surfacePosition.v >= 1) {
      this.directionV *= -1;
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }

    // Slow rotation
    if (this.mesh) {
      this.mesh.rotation.z += 0.8 * dt;
    }
  }

  die(): void {
    if (!this.alive) return;

    // Split into children if not at max generation
    if (this.generation < 2 && Splitter.onSplitterDeath) {
      const childCount = this.generation === 0 ? 3 : 2;
      const childGen = this.generation + 1;

      for (let i = 0; i < childCount; i++) {
        // Spread children out slightly from death position
        const spreadAngle = (i / childCount) * Math.PI * 2 + Math.random() * 0.5;
        const spreadDist = 0.03 + Math.random() * 0.02;
        const childU = Math.max(0, Math.min(1,
          this.surfacePosition.u + Math.cos(spreadAngle) * spreadDist
        ));
        const childV = Math.max(0, Math.min(1,
          this.surfacePosition.v + Math.sin(spreadAngle) * spreadDist
        ));
        Splitter.onSplitterDeath(childU, childV, childGen);
      }
    }

    super.die();
  }
}
