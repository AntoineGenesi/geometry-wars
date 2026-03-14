import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildSquare3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp vectors for zero GC in update loop
const _clusterTempVec = new THREE.Vector3();

/** Number of cube sub-parts in the cluster blob */
const CUBE_COUNT = 7;

/** Cube placement offsets (irregular blob layout, pre-computed) */
const CUBE_OFFSETS: Array<{ x: number; y: number; z: number; scale: number; phaseOffset: number }> = [
  { x: 0, y: 0, z: 0, scale: 1.0, phaseOffset: 0 },            // center, largest
  { x: 0.12, y: 0.08, z: 0.04, scale: 0.7, phaseOffset: 0.8 },
  { x: -0.1, y: 0.1, z: -0.03, scale: 0.6, phaseOffset: 1.5 },
  { x: 0.05, y: -0.12, z: 0.06, scale: 0.75, phaseOffset: 2.3 },
  { x: -0.08, y: -0.06, z: -0.07, scale: 0.55, phaseOffset: 3.1 },
  { x: 0.14, y: -0.04, z: -0.05, scale: 0.5, phaseOffset: 4.0 },
  { x: -0.13, y: 0.02, z: 0.08, scale: 0.65, phaseOffset: 4.8 },
];

/**
 * Cluster Enemy
 *
 * A tanky blob of multiple irregular cubes fused together. Moves slowly toward
 * the player. The cubes rhythmically pulse outward and inward, creating a
 * breathing organic feel. High health, low speed, decent score value.
 *
 * Color: orange-red (0xff4422)
 */
export class Cluster extends BaseEnemy {
  private cubeGroups: THREE.Group[] = [];
  /** Base positions for each cube (stored for pulsation reference) */
  private cubeBasePositions: THREE.Vector3[] = [];
  /** Pulse animation timer */
  private pulseTime: number = 0;
  /** Slow acceleration toward player */
  private currentSpeed: number;
  private readonly maxSpeed: number = 0.035;
  private readonly speedIncreaseRate: number = 0.001;

  constructor(surfaceU: number, surfaceV: number) {
    // High health (8), good score (60), decent geoms (5), very slow, larger radius
    super(surfaceU, surfaceV, 8, 60, 5, 0.025, 0.45);
    this.currentSpeed = 0.015;
    this.baseTypeName = 'cluster';

    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();
    const baseColor = 0xff4422; // orange-red

    for (let i = 0; i < CUBE_COUNT; i++) {
      const offset = CUBE_OFFSETS[i];
      const cubeSize = 0.1 * offset.scale;
      const depth = cubeSize * 0.7;
      const cube = buildSquare3D(cubeSize, baseColor, depth, 0.018);

      cube.position.set(offset.x, offset.y, offset.z);

      // Slight random rotation for irregular feel
      cube.rotation.set(
        offset.phaseOffset * 0.3,
        offset.phaseOffset * 0.5,
        offset.phaseOffset * 0.2
      );

      this.cubeBasePositions.push(new THREE.Vector3(offset.x, offset.y, offset.z));
      this.cubeGroups.push(cube);
      group.add(cube);
    }

    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Slowly accelerate toward player
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.speedIncreaseRate * dt);

    // Move toward player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.001) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      this.surfacePosition.u += dirU * this.currentSpeed * dt;
      this.surfacePosition.v += dirV * this.currentSpeed * dt;

      // Clamp to surface boundaries
      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }

    // Animate pulsation: cubes push outward and pull inward rhythmically
    this.pulseTime += dt;
    const pulseBase = Math.sin(this.pulseTime * 2.5); // main rhythm ~2.5 Hz

    for (let i = 0; i < this.cubeGroups.length; i++) {
      const cube = this.cubeGroups[i];
      const basePos = this.cubeBasePositions[i];
      const offset = CUBE_OFFSETS[i];

      // Each cube has its own phase offset for staggered pulsation
      const individualPulse = Math.sin(this.pulseTime * 2.5 + offset.phaseOffset);

      // Expand outward from center (direction = normalized base position)
      _clusterTempVec.copy(basePos);
      const len = _clusterTempVec.length();
      if (len > 0.001) {
        _clusterTempVec.normalize();
      } else {
        _clusterTempVec.set(0, 1, 0); // center cube pulses upward
      }

      const pulseAmount = individualPulse * 0.04; // displacement amount
      cube.position.set(
        basePos.x + _clusterTempVec.x * pulseAmount,
        basePos.y + _clusterTempVec.y * pulseAmount,
        basePos.z + _clusterTempVec.z * pulseAmount
      );

      // Scale pulsation: cubes swell and shrink slightly
      const scalePulse = 1.0 + individualPulse * 0.12;
      cube.scale.setScalar(scalePulse);
    }

    // Slow rotation of the whole cluster
    if (this.mesh) {
      this.mesh.rotation.y += 0.3 * dt;
      this.mesh.rotation.x += 0.15 * dt;
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Slowly accelerate toward player
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.speedIncreaseRate * dt);

    // Move toward player
    const dir = playerWorldPos.clone().sub(this.walker.position);
    const distance = dir.length();

    if (distance < 0.001) return null;

    dir.normalize();

    // Animate pulsation: cubes push outward and pull inward rhythmically
    this.pulseTime += dt;
    const pulseBase = Math.sin(this.pulseTime * 2.5); // main rhythm ~2.5 Hz

    for (let i = 0; i < this.cubeGroups.length; i++) {
      const cube = this.cubeGroups[i];
      const basePos = this.cubeBasePositions[i];
      const offset = CUBE_OFFSETS[i];

      // Each cube has its own phase offset for staggered pulsation
      const individualPulse = Math.sin(this.pulseTime * 2.5 + offset.phaseOffset);

      // Expand outward from center (direction = normalized base position)
      _clusterTempVec.copy(basePos);
      const len = _clusterTempVec.length();
      if (len > 0.001) {
        _clusterTempVec.normalize();
      } else {
        _clusterTempVec.set(0, 1, 0); // center cube pulses upward
      }

      const pulseAmount = individualPulse * 0.04; // displacement amount
      cube.position.set(
        basePos.x + _clusterTempVec.x * pulseAmount,
        basePos.y + _clusterTempVec.y * pulseAmount,
        basePos.z + _clusterTempVec.z * pulseAmount
      );

      // Scale pulsation: cubes swell and shrink slightly
      const scalePulse = 1.0 + individualPulse * 0.12;
      cube.scale.setScalar(scalePulse);
    }

    // Slow rotation of the whole cluster
    if (this.mesh) {
      this.mesh.rotation.y += 0.3 * dt;
      this.mesh.rotation.x += 0.15 * dt;
    }

    return dir.multiplyScalar(this.currentSpeed * this.walkerSpeedScale);
  }
}
