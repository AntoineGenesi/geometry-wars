import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { SpinnerSpawn } from './SpinnerSpawn';
import { buildOctahedron3D } from '../../utils/GeometryBuilder';

export class Spinner extends BaseEnemy {
  private readonly wobbleAmount = 0.15;
  public static onSpawn: ((spawn: SpinnerSpawn) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    super(surfaceU, surfaceV, 1, 50, 1, 0.05, 0.3); // Reduced speed

    this.createMesh();
  }

  private createMesh(): void {
    // Create 3D octahedron frame with actual depth
    const size = 0.3;
    this.mesh = buildOctahedron3D(size, 0xff44ff, 0.025);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Chase player with some random wobble (less precise homing)
    const wobbleU = (Math.random() - 0.5) * this.wobbleAmount;
    const wobbleV = (Math.random() - 0.5) * this.wobbleAmount;

    const targetU = playerU + wobbleU;
    const targetV = playerV + wobbleV;

    const deltaU = targetU - this.surfacePosition.u;
    const deltaV = targetV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      this.surfacePosition.u += dirU * this.speed * dt;
      this.surfacePosition.v += dirV * this.speed * dt;
    }

    // Rotate mesh for visual effect
    if (this.mesh) {
      this.mesh.rotation.x += 2 * dt;
      this.mesh.rotation.y += 3 * dt;
    }
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 3 SpinnerSpawn entities
    if (Spinner.onSpawn) {
      for (let i = 0; i < 3; i++) {
        const spawn = new SpinnerSpawn(this.surfacePosition.u, this.surfacePosition.v);
        Spinner.onSpawn(spawn);
      }
    }

    // Call parent die() for score/geoms callback
    super.die();
  }
}
