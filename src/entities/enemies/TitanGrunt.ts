import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildSquare3D } from '../../utils/GeometryBuilder';

/**
 * Titan Grunt - larger, tougher version of the Grunt.
 * Slow but tanky, chases player directly. Spawns 2 regular grunts on death.
 * Visual: oversized deep-blue cube with pulsing glow.
 */
export class TitanGrunt extends BaseEnemy {
  private pulsePhase = Math.random() * Math.PI * 2;

  /** Called when titan dies to spawn regular enemies */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=6, score=200, geoms=3, speed=0.025, radius=0.5
    super(surfaceU, surfaceV, 6, 200, 3, 0.025, 0.5);
    this.createMesh();
  }

  private createMesh(): void {
    // Large cube with deep blue color
    this.mesh = buildSquare3D(0.5, 0x2244cc, 0.2, 0.03);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Direct chase toward player (like Grunt but slower)
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      this.surfacePosition = {
        u: this.surfacePosition.u + dirU * this.speed * dt,
        v: this.surfacePosition.v + dirV * this.speed * dt,
      };
    }

    // Pulsing effect - slow menacing pulse
    this.pulsePhase += dt * 1.5;
    if (this.mesh) {
      const scale = 1.0 + Math.sin(this.pulsePhase) * 0.08;
      this.mesh.scale.setScalar(scale);
    }
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 2 regular grunts on death
    if (TitanGrunt.onDeathSpawn) {
      TitanGrunt.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 2);
    }

    super.die();
  }
}
