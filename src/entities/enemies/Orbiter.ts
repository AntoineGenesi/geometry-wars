import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildCircle3D } from '../../utils/GeometryBuilder';

/**
 * Orbiter - Ring-shaped enemy that orbits the player.
 *
 * Instead of chasing directly, it maintains an orbit around the player
 * at a set distance, slowly spiraling inward. Periodically reverses
 * orbit direction, making it hard to predict. Always moving perpendicular
 * to the player, so it's difficult to hit.
 *
 * Visual: torus/ring made of tube segments, teal colored, spins on its axis.
 */

// Pre-allocated temp values for zero GC
const _orbDelta = { u: 0, v: 0 };

export class Orbiter extends BaseEnemy {
  private orbitAngle: number;
  private orbitRadius: number;
  private readonly initialOrbitRadius: number = 0.35;
  private readonly minOrbitRadius: number = 0.04;
  private readonly orbitSpeed: number = 2.5;        // radians/sec
  private readonly spiralInRate: number = 0.015;     // UV units/sec inward
  private orbitDirection: number = 1;                // 1 or -1
  private reverseTimer: number = 0;
  private nextReverse: number;
  private spinAngle: number = 0;

  constructor(surfaceU: number, surfaceV: number) {
    // health=2, score=25, geoms=2, speed=0.06, radius=0.2
    super(surfaceU, surfaceV, 2, 25, 2, 0.06, 0.2);
    this.baseTypeName = 'orbiter';

    this.orbitAngle = Math.random() * Math.PI * 2;
    this.orbitRadius = this.initialOrbitRadius;
    this.nextReverse = 2 + Math.random() * 3; // 2-5 seconds between reversals

    this.createMesh();
  }

  private createMesh(): void {
    // Ring/torus shape made of tube segments - teal color
    this.mesh = buildCircle3D(0.18, 12, 0x00ccaa, 0.06, 0.022);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Reverse direction periodically
    this.reverseTimer += dt;
    if (this.reverseTimer >= this.nextReverse) {
      this.orbitDirection *= -1;
      this.reverseTimer = 0;
      this.nextReverse = 2 + Math.random() * 3;
    }

    // Advance orbit angle
    this.orbitAngle += this.orbitSpeed * this.orbitDirection * dt;

    // Spiral inward
    this.orbitRadius = Math.max(this.minOrbitRadius, this.orbitRadius - this.spiralInRate * dt);

    // Calculate orbit position around player
    const orbitU = playerU + Math.cos(this.orbitAngle) * this.orbitRadius;
    const orbitV = playerV + Math.sin(this.orbitAngle) * this.orbitRadius;

    // Smoothly move toward calculated orbit position
    _orbDelta.u = orbitU - this.surfacePosition.u;
    _orbDelta.v = orbitV - this.surfacePosition.v;
    const dist = Math.sqrt(_orbDelta.u * _orbDelta.u + _orbDelta.v * _orbDelta.v);

    if (dist > 0.001) {
      // Blend toward orbit position (smooth following)
      const blendRate = 5.0; // how quickly it locks onto orbit path
      const blend = Math.min(1.0, blendRate * dt);
      this.surfacePosition.u += _orbDelta.u * blend;
      this.surfacePosition.v += _orbDelta.v * blend;
    }

    // Clamp to surface
    this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
    this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));

    // Spin the ring on its axis
    this.spinAngle += 4 * dt;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
      // Tilt ring to face movement direction
      this.mesh.rotation.x = Math.sin(this.orbitAngle) * 0.5;
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Reverse direction periodically
    this.reverseTimer += dt;
    if (this.reverseTimer >= this.nextReverse) {
      this.orbitDirection *= -1;
      this.reverseTimer = 0;
      this.nextReverse = 2 + Math.random() * 3;
    }

    // Advance orbit angle
    this.orbitAngle += this.orbitSpeed * this.orbitDirection * dt;

    // Spiral inward
    this.orbitRadius = Math.max(this.minOrbitRadius, this.orbitRadius - this.spiralInRate * dt);

    // Get the tangent frame at current position to define the orbit plane
    const frame = this.walker.getTangentFrame();

    // Calculate orbit offset in the tangent plane
    const orbitOffsetLocal = new THREE.Vector3(
      Math.cos(this.orbitAngle) * this.orbitRadius,
      Math.sin(this.orbitAngle) * this.orbitRadius,
      0
    );

    // Transform to world space using tangent frame
    const orbitOffsetWorld = new THREE.Vector3();
    orbitOffsetWorld.addScaledVector(frame.tangent, orbitOffsetLocal.x);
    orbitOffsetWorld.addScaledVector(frame.bitangent, orbitOffsetLocal.y);

    // Calculate target orbit position around player
    const targetPos = playerWorldPos.clone().add(orbitOffsetWorld);

    // Smoothly move toward calculated orbit position
    const delta = targetPos.sub(this.walker.position);
    const dist = delta.length();

    if (dist < 0.001) return null;

    // Blend toward orbit position (smooth following)
    const blendRate = 5.0; // how quickly it locks onto orbit path
    const blend = Math.min(1.0, blendRate * dt);

    delta.normalize();

    // Spin the ring on its axis
    this.spinAngle += 4 * dt;
    if (this.mesh) {
      this.mesh.rotation.z = this.spinAngle;
      // Tilt ring to face movement direction
      this.mesh.rotation.x = Math.sin(this.orbitAngle) * 0.5;
    }

    // Return velocity: direction to orbit position, scaled by distance and blend rate
    return delta.multiplyScalar(dist * blendRate);
  }
}
