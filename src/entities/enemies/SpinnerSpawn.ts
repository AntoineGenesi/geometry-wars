import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D } from '../../utils/GeometryBuilder';

export class SpinnerSpawn extends BaseEnemy {
  private orbitCenterU: number;
  private orbitCenterV: number;
  private readonly orbitRadius = 0.3;
  private orbitAngle: number;
  private readonly orbitSpeed = 0.375; // radians per second
  private readonly driftSpeed = 0.0625;

  constructor(spawnU: number, spawnV: number) {
    const orbitAngle = Math.random() * Math.PI * 2;
    const orbitRadius = 0.3;
    const startU = spawnU + Math.cos(orbitAngle) * orbitRadius;
    const startV = spawnV + Math.sin(orbitAngle) * orbitRadius;

    super(startU, startV, 1, 25, 1, 0.5, 0.15);

    this.orbitCenterU = spawnU;
    this.orbitCenterV = spawnV;
    this.orbitAngle = orbitAngle;

    this.createMesh();
  }

  private createMesh(): void {
    // Create small 3D triangle prism with light pink color
    const size = 0.15;
    this.mesh = buildTriangle3D(size, 0xff88cc, 0.08, 0.018);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Update orbit angle
    this.orbitAngle += this.orbitSpeed * dt;

    // Calculate base orbit position
    const orbitU = this.orbitCenterU + Math.cos(this.orbitAngle) * this.orbitRadius;
    const orbitV = this.orbitCenterV + Math.sin(this.orbitAngle) * this.orbitRadius;

    // Drift toward player
    const deltaU = playerU - this.orbitCenterU;
    const deltaV = playerV - this.orbitCenterV;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      // Move orbit center toward player
      this.orbitCenterU += dirU * this.driftSpeed * dt;
      this.orbitCenterV += dirV * this.driftSpeed * dt;
    }

    // Set position to orbit position
    this.surfacePosition = { u: orbitU, v: orbitV };

    // Rotate mesh
    if (this.mesh) {
      this.mesh.rotation.z += 3 * dt;
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // For walker mode, need to track orbit center in world space
    // Use a private property to track the world-space orbit center
    if (!(this as any).worldOrbitCenter) {
      (this as any).worldOrbitCenter = this.walker.position.clone();
    }
    const worldOrbitCenter: THREE.Vector3 = (this as any).worldOrbitCenter;

    // Update orbit angle
    this.orbitAngle += this.orbitSpeed * dt;

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

    // Calculate target orbit position
    const targetPos = worldOrbitCenter.clone().add(orbitOffsetWorld);

    // Drift orbit center toward player
    const driftDir = playerWorldPos.clone().sub(worldOrbitCenter);
    const distance = driftDir.length();

    if (distance > 0.01) {
      driftDir.normalize();
      worldOrbitCenter.addScaledVector(driftDir, this.driftSpeed * dt);
    }

    // Move toward target orbit position
    const moveDir = targetPos.sub(this.walker.position);
    const moveDist = moveDir.length();

    if (moveDist < 0.001) return null;

    moveDir.normalize();

    // Rotate mesh
    if (this.mesh) {
      this.mesh.rotation.z += 3 * dt;
    }

    // Return velocity scaled by walkerSpeedScale (orbit motion is already in world units)
    return moveDir.multiplyScalar(moveDist * 5); // Fast convergence to orbit path
  }
}
