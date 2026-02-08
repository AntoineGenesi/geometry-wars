import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPinwheel3D } from '../../utils/GeometryBuilder';

/**
 * Giant Wanderer - oversized wanderer that breaks into 4 regular wanderers on death.
 * Wanders randomly like a Wanderer but larger, slower, and tankier.
 * Visual: big deep-purple pinwheel with slow spin.
 */
export class GiantWanderer extends BaseEnemy {
  private directionU: number;
  private directionV: number;
  private directionChangeTimer: number;
  private nextDirectionChange: number;
  private spinAngle: number = 0;

  /** Called when giant dies to spawn regular enemies */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=6, score=150, geoms=3, speed=0.03, radius=0.55
    super(surfaceU, surfaceV, 6, 150, 3, 0.03, 0.55);

    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);
    this.directionChangeTimer = 0;
    this.nextDirectionChange = 1.5 + Math.random();

    this.createMesh();
  }

  private createMesh(): void {
    // Oversized pinwheel in deeper purple with glow
    this.mesh = buildPinwheel3D(0.55, 0x7722cc, 0.15, 0.03);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.directionChangeTimer += dt;
    if (this.directionChangeTimer >= this.nextDirectionChange) {
      const angle = Math.random() * Math.PI * 2;
      this.directionU = Math.cos(angle);
      this.directionV = Math.sin(angle);
      this.directionChangeTimer = 0;
      this.nextDirectionChange = 1.5 + Math.random();
    }

    this.surfacePosition = {
      u: this.surfacePosition.u + this.directionU * this.speed * dt,
      v: this.surfacePosition.v + this.directionV * this.speed * dt,
    };

    // Bounce off boundaries
    if (this.surfacePosition.u <= 0 || this.surfacePosition.u >= 1) {
      this.directionU *= -1;
      this.surfacePosition = {
        u: Math.max(0, Math.min(1, this.surfacePosition.u)),
        v: this.surfacePosition.v,
      };
    }
    if (this.surfacePosition.v <= 0 || this.surfacePosition.v >= 1) {
      this.directionV *= -1;
      this.surfacePosition = {
        u: this.surfacePosition.u,
        v: Math.max(0, Math.min(1, this.surfacePosition.v)),
      };
    }

    // Slow menacing spin
    this.spinAngle += 2 * dt;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
      const scale = 1.0 + Math.sin(this.spinAngle * 0.5) * 0.06;
      this.mesh.scale.setScalar(scale);
    }
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 4 regular wanderers on death
    if (GiantWanderer.onDeathSpawn) {
      GiantWanderer.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 4);
    }

    super.die();
  }
}
