import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildDiamond3D, buildTriangle3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp vectors for zero GC in update loop
const _fractalTempVec = new THREE.Vector3();

/** Number of orbiting satellite copies */
const SATELLITE_COUNT = 5;

/** Orbital radii and speeds for each satellite */
const SATELLITE_CONFIGS: Array<{
  radius: number;
  speed: number;
  tilt: number;
  scale: number;
  phaseOffset: number;
}> = [
  { radius: 0.18, speed: 1.8, tilt: 0.0, scale: 0.55, phaseOffset: 0 },
  { radius: 0.22, speed: -1.4, tilt: 0.5, scale: 0.4, phaseOffset: 1.2 },
  { radius: 0.15, speed: 2.5, tilt: -0.3, scale: 0.5, phaseOffset: 2.5 },
  { radius: 0.25, speed: -1.0, tilt: 0.8, scale: 0.35, phaseOffset: 3.8 },
  { radius: 0.2, speed: 1.6, tilt: -0.6, scale: 0.45, phaseOffset: 5.0 },
];

/**
 * Fractal Enemy
 *
 * A central diamond shape with smaller copies of itself orbiting around it
 * at different speeds and tilts, creating a mesmerizing orrery-like pattern.
 * Movement is a pulsing approach: advances toward player, pauses, retreats
 * slightly, then advances again -- a hypnotic predator.
 *
 * Color: green-gold (0x88cc22 core, 0xccaa00 satellites)
 */
export class Fractal extends BaseEnemy {
  /** Satellite mesh groups for orbital animation */
  private satellites: THREE.Group[] = [];
  /** Orbital angle per satellite */
  private orbitalAngles: number[] = [];
  /** Approach-retreat state machine */
  private approachPhase: 'advance' | 'pause' | 'retreat' = 'advance';
  private phaseTimer: number = 0;
  private readonly advanceDuration: number = 2.0;
  private readonly pauseDuration: number = 0.6;
  private readonly retreatDuration: number = 0.8;
  /** Direction angles cached during advance */
  private moveU: number = 0;
  private moveV: number = 0;
  /** Central mesh for scale pulse */
  private centralMesh: THREE.Group | null = null;
  /** Animation timer for central pulse */
  private pulseTime: number = 0;

  constructor(surfaceU: number, surfaceV: number) {
    // Medium health (5), high score (75), good geoms (4), moderate speed
    super(surfaceU, surfaceV, 5, 75, 4, 0.04, 0.4);
    this.baseTypeName = 'fractal';

    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const coreColor = 0x88cc22; // green
    const satColor = 0xccaa00; // gold

    // Central shape: diamond with depth
    const central = buildDiamond3D(0.15, coreColor, 0.12, 0.022);
    this.centralMesh = central;
    group.add(central);

    // Orbiting smaller copies (triangles to look like "fractal children")
    for (let i = 0; i < SATELLITE_COUNT; i++) {
      const config = SATELLITE_CONFIGS[i];
      const sat = buildTriangle3D(0.08 * config.scale, satColor, 0.06 * config.scale, 0.015);

      // Start at initial orbital position
      this.orbitalAngles.push(config.phaseOffset);
      const x = Math.cos(config.phaseOffset) * config.radius;
      const y = Math.sin(config.phaseOffset) * config.radius * Math.cos(config.tilt);
      const z = Math.sin(config.phaseOffset) * config.radius * Math.sin(config.tilt);
      sat.position.set(x, y, z);

      this.satellites.push(sat);
      group.add(sat);
    }

    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Direction to player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    // Approach-retreat state machine
    this.phaseTimer += dt;

    switch (this.approachPhase) {
      case 'advance': {
        if (distance > 0.001) {
          this.moveU = deltaU / distance;
          this.moveV = deltaV / distance;
        }
        this.surfacePosition.u += this.moveU * this.speed * dt;
        this.surfacePosition.v += this.moveV * this.speed * dt;

        if (this.phaseTimer >= this.advanceDuration || distance < 0.15) {
          this.approachPhase = 'pause';
          this.phaseTimer = 0;
        }
        break;
      }
      case 'pause': {
        // Hover in place, update move direction
        if (distance > 0.001) {
          this.moveU = deltaU / distance;
          this.moveV = deltaV / distance;
        }
        if (this.phaseTimer >= this.pauseDuration) {
          this.approachPhase = 'retreat';
          this.phaseTimer = 0;
        }
        break;
      }
      case 'retreat': {
        // Move away from player slowly
        this.surfacePosition.u -= this.moveU * this.speed * 0.5 * dt;
        this.surfacePosition.v -= this.moveV * this.speed * 0.5 * dt;

        if (this.phaseTimer >= this.retreatDuration) {
          this.approachPhase = 'advance';
          this.phaseTimer = 0;
        }
        break;
      }
    }

    // Clamp to surface
    this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
    this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));

    // Central pulse animation
    this.pulseTime += dt;
    if (this.centralMesh) {
      const corePulse = 1.0 + Math.sin(this.pulseTime * 3.0) * 0.1;
      this.centralMesh.scale.setScalar(corePulse);
      // Gentle spin
      this.centralMesh.rotation.y += 0.5 * dt;
    }

    // Animate orbiting satellites
    for (let i = 0; i < SATELLITE_COUNT; i++) {
      const config = SATELLITE_CONFIGS[i];
      const sat = this.satellites[i];

      // Update orbital angle
      // Speed up orbits when advancing, slow down when retreating
      const speedMult = this.approachPhase === 'advance' ? 1.3
        : this.approachPhase === 'retreat' ? 0.7
        : 1.0;
      this.orbitalAngles[i] += config.speed * speedMult * dt;
      const angle = this.orbitalAngles[i];

      // 3D orbital position with tilt
      const x = Math.cos(angle) * config.radius;
      const y = Math.sin(angle) * config.radius * Math.cos(config.tilt);
      const z = Math.sin(angle) * config.radius * Math.sin(config.tilt);
      sat.position.set(x, y, z);

      // Satellites spin on their own axis
      sat.rotation.x += 2.0 * dt;
      sat.rotation.z += 1.5 * dt;

      // Subtle scale pulse per satellite
      const satPulse = 1.0 + Math.sin(this.pulseTime * 2.0 + config.phaseOffset) * 0.2;
      sat.scale.setScalar(satPulse);
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Direction to player
    const delta = playerWorldPos.clone().sub(this.walker!.position);
    const distance = delta.length();
    const distanceUV = distance / this.walkerSpeedScale; // Convert to UV-equivalent

    // Approach-retreat state machine (same as updateBehavior)
    this.phaseTimer += dt;

    let velocity: THREE.Vector3 | null = null;

    switch (this.approachPhase) {
      case 'advance': {
        if (distance > 0.03) { // ~0.001 UV * 30
          this.moveU = delta.x / distance;
          this.moveV = delta.y / distance;
        }
        velocity = delta.clone().normalize().multiplyScalar(this.speed * this.walkerSpeedScale);

        if (this.phaseTimer >= this.advanceDuration || distanceUV < 0.15) {
          this.approachPhase = 'pause';
          this.phaseTimer = 0;
        }
        break;
      }
      case 'pause': {
        // Hover in place, update move direction
        if (distance > 0.03) {
          this.moveU = delta.x / distance;
          this.moveV = delta.y / distance;
        }
        if (this.phaseTimer >= this.pauseDuration) {
          this.approachPhase = 'retreat';
          this.phaseTimer = 0;
        }
        velocity = null;
        break;
      }
      case 'retreat': {
        // Move away from player slowly
        velocity = delta.clone().normalize().multiplyScalar(-this.speed * 0.5 * this.walkerSpeedScale);

        if (this.phaseTimer >= this.retreatDuration) {
          this.approachPhase = 'advance';
          this.phaseTimer = 0;
        }
        break;
      }
    }

    // Central pulse animation (same as updateBehavior)
    this.pulseTime += dt;
    if (this.centralMesh) {
      const corePulse = 1.0 + Math.sin(this.pulseTime * 3.0) * 0.1;
      this.centralMesh.scale.setScalar(corePulse);
      this.centralMesh.rotation.y += 0.5 * dt;
    }

    // Animate orbiting satellites (same as updateBehavior)
    for (let i = 0; i < SATELLITE_COUNT; i++) {
      const config = SATELLITE_CONFIGS[i];
      const sat = this.satellites[i];

      const speedMult = this.approachPhase === 'advance' ? 1.3
        : this.approachPhase === 'retreat' ? 0.7
        : 1.0;
      this.orbitalAngles[i] += config.speed * speedMult * dt;
      const angle = this.orbitalAngles[i];

      const x = Math.cos(angle) * config.radius;
      const y = Math.sin(angle) * config.radius * Math.cos(config.tilt);
      const z = Math.sin(angle) * config.radius * Math.sin(config.tilt);
      sat.position.set(x, y, z);

      sat.rotation.x += 2.0 * dt;
      sat.rotation.z += 1.5 * dt;

      const satPulse = 1.0 + Math.sin(this.pulseTime * 2.0 + config.phaseOffset) * 0.2;
      sat.scale.setScalar(satPulse);
    }

    return velocity;
  }
}
