import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPolygon3D } from '../../utils/GeometryBuilder';

/**
 * Giant Neutron - oversized neutron that breaks into 3 regular neutrons on death.
 * Bounces around randomly like a Neutron but larger and tankier.
 * Visual: big teal heptagon with fast spin.
 */
export class GiantNeutron extends BaseEnemy {
  private directionU: number;
  private directionV: number;
  private spinAngle: number = 0;
  private pulsePhase = Math.random() * Math.PI * 2;

  /** Called when giant dies to spawn regular enemies */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=6, score=120, geoms=2, speed=0.035, radius=0.5
    super(surfaceU, surfaceV, 6, 120, 2, 0.035, 0.5);

    const angle = Math.random() * Math.PI * 2;
    this.directionU = Math.cos(angle);
    this.directionV = Math.sin(angle);

    this.createMesh();
  }

  private createMesh(): void {
    // Oversized heptagon in bright teal
    this.mesh = buildPolygon3D(7, 0.45, 0x22aaaa, 0.30, 0.035);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.surfacePosition = {
      u: this.surfacePosition.u + this.directionU * this.speed * dt,
      v: this.surfacePosition.v + this.directionV * this.speed * dt,
    };

    // Bounce off boundaries with random angle
    let bounced = false;
    if (this.surfacePosition.u <= 0) {
      this.surfacePosition = { u: 0, v: this.surfacePosition.v };
      bounced = true;
    } else if (this.surfacePosition.u >= 1) {
      this.surfacePosition = { u: 1, v: this.surfacePosition.v };
      bounced = true;
    }
    if (this.surfacePosition.v <= 0) {
      this.surfacePosition = { u: this.surfacePosition.u, v: 0 };
      bounced = true;
    } else if (this.surfacePosition.v >= 1) {
      this.surfacePosition = { u: this.surfacePosition.u, v: 1 };
      bounced = true;
    }

    if (bounced) {
      const angle = Math.random() * Math.PI * 2;
      this.directionU = Math.cos(angle);
      this.directionV = Math.sin(angle);
    }

    // Fast spin + pulsing
    this.spinAngle += 4 * dt;
    this.pulsePhase += dt * 2;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
      const scale = 1.0 + Math.sin(this.pulsePhase) * 0.06;
      this.mesh.scale.setScalar(scale);
    }
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 3 regular neutrons on death
    if (GiantNeutron.onDeathSpawn) {
      GiantNeutron.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 3);
    }

    super.die();
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Fast spin + pulsing (same as updateBehavior)
    this.spinAngle += 4 * dt;
    this.pulsePhase += dt * 2;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
      const scale = 1.0 + Math.sin(this.pulsePhase) * 0.06;
      this.mesh.scale.setScalar(scale);
    }

    // Convert direction from local UV-like direction to world space
    const frame = this.walker!.getTangentFrame();
    const worldDir = frame.tangent.clone().multiplyScalar(this.directionU)
      .addScaledVector(frame.bitangent, this.directionV)
      .normalize();

    // Scale by world speed
    worldDir.multiplyScalar(this.speed * this.walkerSpeedScale);

    return worldDir;
  }
}
