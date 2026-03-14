import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildArrow3D } from '../../utils/GeometryBuilder';

/**
 * Giant Rocket - oversized rocket that breaks into 3 regular rockets on death.
 * Moves in straight lines and bounces, like Rocket but larger and tankier.
 * Visual: big fiery-orange arrow with pulsing glow.
 */
export class GiantRocket extends BaseEnemy {
  private directionU: number;
  private directionV: number;
  private pulsePhase = Math.random() * Math.PI * 2;

  /** Called when giant dies to spawn regular enemies */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=6, score=150, geoms=3, speed=0.04, radius=0.5
    super(surfaceU, surfaceV, 6, 150, 3, 0.04, 0.5);

    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);

    this.createMesh();
  }

  private createMesh(): void {
    // Oversized arrow in bright orange
    this.mesh = buildArrow3D(0.5, 0xff6600, 0.32, 0.035);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.surfacePosition = {
      u: this.surfacePosition.u + this.directionU * this.speed * dt,
      v: this.surfacePosition.v + this.directionV * this.speed * dt,
    };

    // Bounce off boundaries
    if (this.surfacePosition.u <= 0) {
      this.surfacePosition = { u: 0, v: this.surfacePosition.v };
      this.directionU = Math.abs(this.directionU);
    } else if (this.surfacePosition.u >= 1) {
      this.surfacePosition = { u: 1, v: this.surfacePosition.v };
      this.directionU = -Math.abs(this.directionU);
    }

    if (this.surfacePosition.v <= 0) {
      this.surfacePosition = { u: this.surfacePosition.u, v: 0 };
      this.directionV = Math.abs(this.directionV);
    } else if (this.surfacePosition.v >= 1) {
      this.surfacePosition = { u: this.surfacePosition.u, v: 1 };
      this.directionV = -Math.abs(this.directionV);
    }

    // Orient to direction + pulsing scale
    this.pulsePhase += dt * 2;
    if (this.mesh) {
      const angle = Math.atan2(this.directionV, this.directionU);
      this.mesh.rotation.z = angle - Math.PI / 2;
      const scale = 1.0 + Math.sin(this.pulsePhase) * 0.07;
      this.mesh.scale.setScalar(scale);
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Convert UV direction to world space using tangent frame
    const tangentFrame = this.walker.getTangentFrame();
    const dir = tangentFrame.tangent
      .clone()
      .multiplyScalar(this.directionU)
      .add(tangentFrame.bitangent.clone().multiplyScalar(this.directionV))
      .normalize();

    // Orient to direction + pulsing scale (must run in both modes)
    this.pulsePhase += dt * 2;
    if (this.mesh && this.walker) {
      // Calculate world-space velocity direction for orientation
      const worldVel = dir.clone();
      const tangentFrame = this.walker.getTangentFrame();

      // Project velocity onto tangent plane to get local angle
      const localU = worldVel.dot(tangentFrame.tangent);
      const localV = worldVel.dot(tangentFrame.bitangent);
      const angle = Math.atan2(localV, localU);
      this.mesh.rotation.z = angle - Math.PI / 2;

      const scale = 1.0 + Math.sin(this.pulsePhase) * 0.07;
      this.mesh.scale.setScalar(scale);
    }

    return dir.multiplyScalar(this.speed * this.walkerSpeedScale);
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 3 regular rockets on death
    if (GiantRocket.onDeathSpawn) {
      GiantRocket.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 3);
    }

    super.die();
  }
}
