import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp vectors for zero GC in update loop
const _swarmDir = new THREE.Vector3();
const _swarmOffset = new THREE.Vector3();

/** Number of tiny triangles composing the swarm */
const PARTICLE_COUNT = 12;

/** Pre-computed random offsets for each swarm particle */
const PARTICLE_SEEDS: Array<{
  baseX: number;
  baseY: number;
  baseZ: number;
  wobbleSpeedX: number;
  wobbleSpeedY: number;
  wobbleSpeedZ: number;
  phaseX: number;
  phaseY: number;
  phaseZ: number;
}> = [];

// Initialize deterministic random seeds for particles
for (let i = 0; i < PARTICLE_COUNT; i++) {
  const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
  const r = 0.04 + (i % 3) * 0.025;
  PARTICLE_SEEDS.push({
    baseX: Math.cos(angle) * r,
    baseY: Math.sin(angle) * r,
    baseZ: ((i % 5) - 2) * 0.02,
    wobbleSpeedX: 2.0 + (i % 4) * 0.5,
    wobbleSpeedY: 1.8 + (i % 3) * 0.6,
    wobbleSpeedZ: 2.2 + (i % 5) * 0.4,
    phaseX: (i * 0.7) % (Math.PI * 2),
    phaseY: (i * 1.3) % (Math.PI * 2),
    phaseZ: (i * 0.9) % (Math.PI * 2),
  });
}

/**
 * Swarm Enemy
 *
 * NOT a single entity visually -- a tight cluster of tiny triangles that moves
 * as a group with individual wobble. The cluster shifts shape: elongates toward
 * the player when advancing, bunches up when idle. Medium speed, medium health.
 *
 * The swarm stretches along its movement direction, giving an organic boid-like
 * appearance.
 *
 * Color: hot pink (0xff1177)
 */
export class Swarm extends BaseEnemy {
  /** References to individual particle meshes */
  private particles: THREE.Group[] = [];
  /** Animation timer */
  private time: number = 0;
  /** Current movement direction (for stretching) */
  private dirU: number = 0;
  private dirV: number = 0;
  /** Stretch factor: 1.0 = bunched, increases when moving */
  private stretchFactor: number = 1.0;
  /** Speed ramp */
  private currentSpeed: number;
  private readonly maxSpeed: number = 0.055;

  constructor(surfaceU: number, surfaceV: number) {
    // Medium health (4), decent score (50), good geoms (3), medium speed
    super(surfaceU, surfaceV, 4, 50, 3, 0.045, 0.35);
    this.currentSpeed = 0.03;
    this.baseTypeName = 'swarm';

    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const color = 0xff1177; // hot pink

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const seed = PARTICLE_SEEDS[i];
      // Tiny triangle particle
      const size = 0.04 + (i % 3) * 0.01;
      const particle = buildTriangle3D(size, color, size * 0.7, 0.012);

      particle.position.set(seed.baseX, seed.baseY, seed.baseZ);
      // Random initial rotation for variety
      particle.rotation.set(seed.phaseX, seed.phaseY, seed.phaseZ);

      this.particles.push(particle);
      group.add(particle);
    }

    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.time += dt;

    // Accelerate toward player
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + 0.002 * dt);

    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.001) {
      this.dirU = deltaU / distance;
      this.dirV = deltaV / distance;

      this.surfacePosition.u += this.dirU * this.currentSpeed * dt;
      this.surfacePosition.v += this.dirV * this.currentSpeed * dt;

      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }

    // Stretch factor: elongate when moving toward player, bunch up when close
    const targetStretch = distance > 0.2 ? 2.0 : 1.0;
    this.stretchFactor += (targetStretch - this.stretchFactor) * 2.0 * dt;

    // Calculate a local stretch axis from movement direction
    // We use dirU/dirV mapped to approximate x/y local space
    const stretchAngle = Math.atan2(this.dirV, this.dirU);

    // Animate individual particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particle = this.particles[i];
      const seed = PARTICLE_SEEDS[i];

      // Individual wobble
      const wobbleX = Math.sin(this.time * seed.wobbleSpeedX + seed.phaseX) * 0.02;
      const wobbleY = Math.sin(this.time * seed.wobbleSpeedY + seed.phaseY) * 0.02;
      const wobbleZ = Math.sin(this.time * seed.wobbleSpeedZ + seed.phaseZ) * 0.01;

      // Base position
      let px = seed.baseX + wobbleX;
      let py = seed.baseY + wobbleY;
      let pz = seed.baseZ + wobbleZ;

      // Apply directional stretching: scale along movement direction
      // Project position onto movement direction and stretch
      const cosA = Math.cos(stretchAngle);
      const sinA = Math.sin(stretchAngle);
      const projAlongDir = px * cosA + py * sinA;
      const projPerpDir = -px * sinA + py * cosA;

      // Stretch along movement direction, compress perpendicular
      const stretchedAlong = projAlongDir * this.stretchFactor;
      const compressedPerp = projPerpDir / Math.sqrt(this.stretchFactor);

      // Transform back
      px = stretchedAlong * cosA - compressedPerp * sinA;
      py = stretchedAlong * sinA + compressedPerp * cosA;

      particle.position.set(px, py, pz);

      // Spin each particle slightly
      particle.rotation.x += (1.5 + i * 0.2) * dt;
      particle.rotation.z += (1.0 + i * 0.15) * dt;

      // Subtle scale breathing per particle
      const breathe = 1.0 + Math.sin(this.time * 3.0 + seed.phaseX) * 0.15;
      particle.scale.setScalar(breathe);
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Accelerate toward player (same as updateBehavior)
    this.time += dt;
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + 0.002 * dt);

    // Direction to player in world space
    _swarmDir.copy(playerWorldPos).sub(this.walker!.position);
    const distance = _swarmDir.length();

    if (distance > 0.001) {
      // Store direction for stretching calculation (convert to local approximation)
      const frame = this.walker!.getTangentFrame();
      this.dirU = _swarmDir.dot(frame.tangent);
      this.dirV = _swarmDir.dot(frame.bitangent);

      // Calculate stretch factor
      const targetStretch = distance > 6.0 ? 2.0 : 1.0; // 6 world units ~= 0.2 UV on reference surface
      this.stretchFactor += (targetStretch - this.stretchFactor) * 2.0 * dt;

      // Calculate local stretch angle from direction
      const stretchAngle = Math.atan2(this.dirV, this.dirU);

      // Animate individual particles (same as updateBehavior)
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const particle = this.particles[i];
        const seed = PARTICLE_SEEDS[i];

        const wobbleX = Math.sin(this.time * seed.wobbleSpeedX + seed.phaseX) * 0.02;
        const wobbleY = Math.sin(this.time * seed.wobbleSpeedY + seed.phaseY) * 0.02;
        const wobbleZ = Math.sin(this.time * seed.wobbleSpeedZ + seed.phaseZ) * 0.01;

        let px = seed.baseX + wobbleX;
        let py = seed.baseY + wobbleY;
        let pz = seed.baseZ + wobbleZ;

        // Apply directional stretching
        const cosA = Math.cos(stretchAngle);
        const sinA = Math.sin(stretchAngle);
        const projAlongDir = px * cosA + py * sinA;
        const projPerpDir = -px * sinA + py * cosA;

        const stretchedAlong = projAlongDir * this.stretchFactor;
        const compressedPerp = projPerpDir / Math.sqrt(this.stretchFactor);

        px = stretchedAlong * cosA - compressedPerp * sinA;
        py = stretchedAlong * sinA + compressedPerp * cosA;

        particle.position.set(px, py, pz);
        particle.rotation.x += (1.5 + i * 0.2) * dt;
        particle.rotation.z += (1.0 + i * 0.15) * dt;

        const breathe = 1.0 + Math.sin(this.time * 3.0 + seed.phaseX) * 0.15;
        particle.scale.setScalar(breathe);
      }

      // Normalize and scale by world speed
      _swarmDir.normalize().multiplyScalar(this.currentSpeed * this.walkerSpeedScale);
      return _swarmDir;
    }

    return null;
  }
}
