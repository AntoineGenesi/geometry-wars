import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildCircle3D } from '../../utils/GeometryBuilder';

/**
 * Giant Snake - oversized snake that breaks into 2 regular snakes on death.
 * Chases player with S-pattern movement, larger head and segments.
 * Visual: big bright-blue circles with trailing segments.
 */
export class GiantSnake extends BaseEnemy {
  private segments: Array<{ u: number; v: number; mesh: THREE.Group }> = [];
  private readonly segmentCount = 7;
  private readonly sineAmplitude = 0.5;
  private readonly sineFrequency = 1.8;
  private sinePhase = 0;
  private positionHistory: Array<{ u: number; v: number }> = [];
  private readonly historySize = 40;

  /** Called when giant dies to spawn regular enemies */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=10, score=200, geoms=4, speed=0.04, radius=0.4
    super(surfaceU, surfaceV, 10, 200, 4, 0.04, 0.4);
    this.createMesh();
    this.createSegments();
  }

  private createMesh(): void {
    // Large head circle in bright blue
    this.mesh = buildCircle3D(0.35, 16, 0x2266ff, 0.1, 0.025);
  }

  private createSegments(): void {
    for (let i = 0; i < this.segmentCount; i++) {
      const segSize = 0.28 - i * 0.02;
      const mesh = buildCircle3D(Math.max(segSize, 0.12), 12, 0x1144aa, 0.08, 0.02);

      this.segments.push({
        u: this.surfacePosition.u - (i + 1) * 0.12,
        v: this.surfacePosition.v,
        mesh,
      });
    }
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.sinePhase += this.sineFrequency * dt;

    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;
      const perpU = -dirV;
      const perpV = dirU;
      const sineOffset = Math.sin(this.sinePhase) * this.sineAmplitude;

      this.surfacePosition = {
        u: this.surfacePosition.u + (dirU + perpU * sineOffset) * this.speed * dt,
        v: this.surfacePosition.v + (dirV + perpV * sineOffset) * this.speed * dt,
      };
    }

    // Record position history
    this.positionHistory.unshift({ u: this.surfacePosition.u, v: this.surfacePosition.v });
    if (this.positionHistory.length > this.historySize) {
      this.positionHistory.pop();
    }

    // Update segments to follow head
    for (let i = 0; i < this.segments.length; i++) {
      const historyIndex = Math.min((i + 1) * 5, this.positionHistory.length - 1);
      if (historyIndex < this.positionHistory.length) {
        const target = this.positionHistory[historyIndex];
        this.segments[i].u = target.u;
        this.segments[i].v = target.v;
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
    super.applySurfaceTransform(getTransform);

    for (const segment of this.segments) {
      const transform = getTransform(segment.u, segment.v);
      const offsetPos = transform.position.clone().addScaledVector(transform.normal, 0.3);
      segment.mesh.position.copy(offsetPos);

      const matrix = new THREE.Matrix4();
      matrix.makeBasis(transform.bitangent, transform.normal, transform.tangent);
      segment.mesh.quaternion.setFromRotationMatrix(matrix);
    }
  }

  /** Get segment meshes for scene management */
  getSegmentMeshes(): THREE.Group[] {
    return this.segments.map(s => s.mesh);
  }

  /** Get segment collision data */
  getSegmentData(): Array<{ position: THREE.Vector3; surface: { u: number; v: number }; radius: number }> {
    return this.segments.map(s => ({
      position: s.mesh.position,
      surface: { u: s.u, v: s.v },
      radius: 0.25,
    }));
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 2 regular snakes on death
    if (GiantSnake.onDeathSpawn) {
      GiantSnake.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 2);
    }

    super.die();
  }

  destroy(): void {
    super.destroy();
    this.segments = [];
  }
}
