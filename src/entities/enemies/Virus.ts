import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildOctahedron3D } from '../../utils/GeometryBuilder';

/**
 * Virus enemy - slowly drifts, but when it touches another enemy it "infects" it,
 * converting killed enemies into more viruses (handled by game loop).
 * Visual: pulsing sickly green octahedron.
 */
export class Virus extends BaseEnemy {
  private pulsePhase = Math.random() * Math.PI * 2;
  private driftAngle: number;

  /** Static callback: game registers this to handle virus multiplication */
  public static onInfectKill: ((u: number, v: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=1, score=25, geoms=1, speed=0.02, radius=0.25
    super(surfaceU, surfaceV, 1, 25, 1, 0.02, 0.25);
    this.driftAngle = Math.random() * Math.PI * 2;
    this.createMesh();
  }

  private createMesh(): void {
    this.mesh = buildOctahedron3D(0.25, 0x00cc00, 0.02);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Slow drift toward player with some wobble
    const toPlayerU = playerU - this.surfacePosition.u;
    const toPlayerV = playerV - this.surfacePosition.v;
    const dist = Math.sqrt(toPlayerU * toPlayerU + toPlayerV * toPlayerV);

    // Mostly random drift, slight player bias
    this.driftAngle += (Math.random() - 0.5) * 2.0 * dt;

    let du = Math.cos(this.driftAngle) * this.speed * 0.6;
    let dv = Math.sin(this.driftAngle) * this.speed * 0.6;

    // Add slight pull toward player
    if (dist > 0.05) {
      du += (toPlayerU / dist) * this.speed * 0.4;
      dv += (toPlayerV / dist) * this.speed * 0.4;
    }

    this.surfacePosition = {
      u: Math.max(0, Math.min(1, this.surfacePosition.u + du * dt)),
      v: Math.max(0, Math.min(1, this.surfacePosition.v + dv * dt)),
    };

    // Pulsing visual
    this.pulsePhase += dt * 3;
    if (this.mesh) {
      const scale = 1.0 + Math.sin(this.pulsePhase) * 0.15;
      this.mesh.scale.setScalar(scale);
    }
  }

  die(): void {
    // On death, signal potential virus spawn at this location
    if (Virus.onInfectKill) {
      Virus.onInfectKill(this.surfacePosition.u, this.surfacePosition.v);
    }
    super.die();
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Update timers
    this.pulsePhase += dt * 3;
    if (this.mesh) {
      const scale = 1.0 + Math.sin(this.pulsePhase) * 0.15;
      this.mesh.scale.setScalar(scale);
    }

    // Random drift with slight player bias
    this.driftAngle += (Math.random() - 0.5) * 2.0 * dt;

    const toPlayer = playerWorldPos.clone().sub(this.walker.position);
    const distToPlayer = toPlayer.length();

    // Get tangent frame for surface-aligned movement
    const frame = this.walker.getTangentFrame();

    // Random drift direction (60% weight)
    const randomDir = new THREE.Vector3(
      Math.cos(this.driftAngle),
      0,
      Math.sin(this.driftAngle)
    );
    const tangentRandom = frame.tangent.clone().multiplyScalar(randomDir.x * 0.6);
    const bitangentRandom = frame.bitangent.clone().multiplyScalar(randomDir.z * 0.6);

    // Player bias (40% weight)
    let playerBias = new THREE.Vector3();
    if (distToPlayer > 0.05) {
      toPlayer.normalize();
      playerBias = toPlayer.multiplyScalar(0.4);
    }

    // Combine
    const combinedDir = tangentRandom.add(bitangentRandom).add(playerBias);
    if (combinedDir.length() > 0.001) {
      return combinedDir.normalize().multiplyScalar(this.speed * this.walkerSpeedScale);
    }

    return null;
  }
}
