import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildOctahedron3D } from '../../utils/GeometryBuilder';

/**
 * Titan Spinner - larger, tougher version of the Spinner.
 * Chases player with wobble. Spawns 3 regular spinners on death.
 * Visual: oversized magenta octahedron with rapid spin.
 */
export class TitanSpinner extends BaseEnemy {
  private readonly wobbleAmount = 0.2;

  /** Called when titan dies to spawn regular spinners */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=5, score=250, geoms=3, speed=0.04, radius=0.5
    super(surfaceU, surfaceV, 5, 250, 3, 0.04, 0.5);
    this.createMesh();
  }

  private createMesh(): void {
    // Large octahedron in bright magenta
    this.mesh = buildOctahedron3D(0.45, 0xff22ff, 0.03);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Chase player with wobble (like Spinner but larger)
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

      this.surfacePosition = {
        u: this.surfacePosition.u + dirU * this.speed * dt,
        v: this.surfacePosition.v + dirV * this.speed * dt,
      };
    }

    // Rapid rotation
    if (this.mesh) {
      this.mesh.rotation.x += 4 * dt;
      this.mesh.rotation.y += 5 * dt;
    }
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 3 regular spinners on death
    if (TitanSpinner.onDeathSpawn) {
      TitanSpinner.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 3);
    }

    super.die();
  }
}
