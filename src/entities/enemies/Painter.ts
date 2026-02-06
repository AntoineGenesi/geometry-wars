import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildSquare3D } from '../../utils/GeometryBuilder';

/**
 * Painter enemy - leaves a trail of hazard zones on the surface.
 * Wanders randomly, painting the surface behind it.
 * Player must avoid painted zones or take damage.
 * In GW3D, painters change the grid color where they walk.
 */
export class Painter extends BaseEnemy {
  private angle: number;
  private turnTimer = 0;
  private readonly turnInterval = 2.0; // seconds between direction changes
  /** UV positions this painter has visited (for hazard zones) */
  public readonly trail: Array<{ u: number; v: number; age: number }> = [];
  private readonly maxTrailLength = 40;
  private readonly trailSpacing = 0.02;
  private lastTrailU: number;
  private lastTrailV: number;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=2, score=75, geoms=1, speed=0.035, radius=0.3
    super(surfaceU, surfaceV, 2, 75, 1, 0.035, 0.3);
    this.angle = Math.random() * Math.PI * 2;
    this.lastTrailU = surfaceU;
    this.lastTrailV = surfaceV;
    this.createMesh();
  }

  private createMesh(): void {
    // Flat square shape in magenta-pink
    this.mesh = buildSquare3D(0.28, 0xff44aa, 0.12, 0.02);
  }

  updateBehavior(dt: number, _playerU: number, _playerV: number): void {
    // Random wandering with periodic direction changes
    this.turnTimer += dt;
    if (this.turnTimer >= this.turnInterval) {
      this.turnTimer = 0;
      this.angle += (Math.random() - 0.5) * Math.PI; // turn up to 90 degrees
    }

    // Gentle drift with smooth turning
    const du = Math.cos(this.angle) * this.speed * dt;
    const dv = Math.sin(this.angle) * this.speed * dt;

    const newU = this.surfacePosition.u + du;
    const newV = this.surfacePosition.v + dv;

    // Bounce off edges
    if (newU < 0.02 || newU > 0.98) this.angle = Math.PI - this.angle;
    if (newV < 0.02 || newV > 0.98) this.angle = -this.angle;

    this.surfacePosition = {
      u: Math.max(0.01, Math.min(0.99, newU)),
      v: Math.max(0.01, Math.min(0.99, newV)),
    };

    // Leave trail
    const distFromLast = Math.sqrt(
      (this.surfacePosition.u - this.lastTrailU) ** 2 +
      (this.surfacePosition.v - this.lastTrailV) ** 2
    );
    if (distFromLast >= this.trailSpacing) {
      this.trail.push({ u: this.surfacePosition.u, v: this.surfacePosition.v, age: 0 });
      this.lastTrailU = this.surfacePosition.u;
      this.lastTrailV = this.surfacePosition.v;

      // Trim old trail points
      if (this.trail.length > this.maxTrailLength) {
        this.trail.shift();
      }
    }

    // Age trail points
    for (const point of this.trail) {
      point.age += dt;
    }

    // Rotate mesh
    if (this.mesh) {
      this.mesh.rotation.y += 1.5 * dt;
    }
  }

  /** Check if a UV position is on the painted trail */
  isOnTrail(u: number, v: number, threshold = 0.025): boolean {
    for (const point of this.trail) {
      const du = u - point.u;
      const dv = v - point.v;
      if (du * du + dv * dv < threshold * threshold) return true;
    }
    return false;
  }
}
