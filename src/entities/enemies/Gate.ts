import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { Entity, CollisionGroup } from '../../core/Entity';
import { buildCircle3D, buildPrismFrame } from '../../utils/GeometryBuilder';

export class Gate extends BaseEnemy {
  private readonly width = 1.0;
  private readonly gapSize = 0.4;
  private leftEndpoint!: THREE.Group;
  private rightEndpoint!: THREE.Group;
  private leftEndpointSurface = { u: 0, v: 0 };
  private rightEndpointSurface = { u: 0, v: 0 };
  private centerLine!: THREE.Group;
  private hasDetonated = false;

  public static onDetonate: ((position: THREE.Vector3, score: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    super(surfaceU, surfaceV, 1, 50, 11, 0, 0.1);

    this.createMesh();
    this.createEndpoints();
  }

  private createMesh(): void {
    const group = new THREE.Group();

    // Create 3D dashed line in center using tube segments
    const halfWidth = this.width / 2;
    const dashSize = 0.1;
    const gapSize = 0.05;
    const totalLength = this.width;
    const numDashes = Math.floor(totalLength / (dashSize + gapSize));

    for (let i = 0; i < numDashes; i++) {
      const startX = -halfWidth + i * (dashSize + gapSize);
      const endX = startX + dashSize;

      if (endX <= halfWidth) {
        const start = new THREE.Vector3(startX, 0, 0.02);
        const end = new THREE.Vector3(endX, 0, 0.02);
        const startB = new THREE.Vector3(startX, 0, -0.02);
        const endB = new THREE.Vector3(endX, 0, -0.02);

        const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
          [start, end], [startB, endB], [start, startB], [end, endB]
        ];
        const dash = buildPrismFrame(edges, 0xffffff, 0.01, false);
        group.add(dash);
      }
    }

    this.centerLine = group;
    this.mesh = group;
  }

  private createEndpoints(): void {
    // Create 3D circle endpoints with orange color
    this.leftEndpoint = buildCircle3D(0.1, 16, 0xff8800, 0.04, 0.012);
    this.rightEndpoint = buildCircle3D(0.1, 16, 0xff8800, 0.04, 0.012);

    // Position endpoints
    this.leftEndpoint.position.x = -this.width / 2;
    this.rightEndpoint.position.x = this.width / 2;

    if (this.mesh) {
      this.mesh.add(this.leftEndpoint);
      this.mesh.add(this.rightEndpoint);
    }
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Gate is stationary, no movement

    // Gentle rotation for visual effect
    if (this.mesh) {
      this.mesh.rotation.z += 0.5 * dt;
    }

    // Pulse endpoints
    const pulse = 1 + Math.sin(Date.now() * 0.003) * 0.2;
    this.leftEndpoint.scale.setScalar(pulse);
    this.rightEndpoint.scale.setScalar(pulse);
  }

  computeMovementDirection(dt: number, _playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Gate is stationary
    // Still update visual effects
    if (this.mesh) {
      this.mesh.rotation.z += 0.5 * dt;
    }

    // Pulse endpoints
    const pulse = 1 + Math.sin(Date.now() * 0.003) * 0.2;
    this.leftEndpoint.scale.setScalar(pulse);
    this.rightEndpoint.scale.setScalar(pulse);

    return null; // No movement
  }

  applySurfaceTransform(getTransform: (u: number, v: number) => {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3
  }): void {
    // Update gate center
    super.applySurfaceTransform(getTransform);

    // Update endpoint entities
    const transform = getTransform(this.surfacePosition.u, this.surfacePosition.v);

    // Calculate endpoint positions in surface space
    const halfWidth = this.width / 2;
    const leftU = this.surfacePosition.u - halfWidth;
    const rightU = this.surfacePosition.u + halfWidth;

    const leftTransform = getTransform(leftU, this.surfacePosition.v);
    const rightTransform = getTransform(rightU, this.surfacePosition.v);

    this.leftEndpoint.position.copy(leftTransform.position);
    this.leftEndpointSurface = { u: leftU, v: this.surfacePosition.v };

    this.rightEndpoint.position.copy(rightTransform.position);
    this.rightEndpointSurface = { u: rightU, v: this.surfacePosition.v };
  }

  // Check if player passes through the gap
  public checkPlayerPassThrough(playerU: number, playerV: number, prevPlayerU: number, prevPlayerV: number): boolean {
    if (this.hasDetonated) return false;

    // Check if player crossed the gate line
    const gateU = this.surfacePosition.u;
    const crossedLine = (prevPlayerU < gateU && playerU >= gateU) ||
                        (prevPlayerU > gateU && playerU <= gateU);

    if (!crossedLine) return false;

    // Check if player is within the gap (not hitting endpoints)
    const distV = Math.abs(playerV - this.surfacePosition.v);
    const isInGap = distV < this.gapSize / 2;

    if (isInGap) {
      this.detonate();
      return true;
    }

    return false;
  }

  public detonate(): void {
    if (this.hasDetonated || !this.alive) return;

    this.hasDetonated = true;

    if (Gate.onDetonate) {
      Gate.onDetonate(this.position.clone(), this.scoreValue);
    }

    // Visual detonation effect
    if (this.mesh) {
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.color) {
            mat.color.setHex(0xffffff);
            mat.emissive.setHex(0xffffff);
          }
        }
      });

      // Scale up briefly before destruction
      this.mesh.scale.setScalar(2);
    }

    setTimeout(() => {
      this.destroy();
    }, 100);
  }

  public getEndpointPositions(): Array<{ position: THREE.Vector3; surface: { u: number; v: number }; radius: number }> {
    return [
      { position: this.leftEndpoint.position, surface: this.leftEndpointSurface, radius: 0.1 },
      { position: this.rightEndpoint.position, surface: this.rightEndpointSurface, radius: 0.1 }
    ];
  }

  destroy(): void {
    super.destroy();
  }
}
