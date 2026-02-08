import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { Entity, CollisionGroup } from '../../core/Entity';
import { buildCircle3D } from '../../utils/GeometryBuilder';

interface SnakeSegment {
  u: number;
  v: number;
  mesh: THREE.Group;
  entity: THREE.Group;
  entitySurface: { u: number; v: number };
}

export class Snake extends BaseEnemy {
  private segments: SnakeSegment[] = [];
  private readonly segmentCount = 5;
  private readonly segmentSpacing = 0.15;
  private readonly sineAmplitude = 0.4;
  private readonly sineFrequency = 2;
  private sinePhase = 0;
  private positionHistory: Array<{ u: number; v: number }> = [];
  private readonly historySize = 30;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    super(surfaceU, surfaceV, 4, 35, 3, 0.05, 0.2);

    this.createMesh();
    this.createSegments();
  }

  private createMesh(): void {
    // Head mesh - 3D blue circle/ring with depth
    this.mesh = buildCircle3D(0.2, 16, 0x4488ff, 0.06, 0.015);
  }

  private createSegments(): void {
    for (let i = 0; i < this.segmentCount; i++) {
      // Create 3D ring segment with darker blue
      const mesh = buildCircle3D(0.15, 12, 0x224488, 0.05, 0.012);

      // Create group for collision
      const entity = new THREE.Group();
      entity.add(mesh);

      const surfaceU = this.surfacePosition.u - (i + 1) * this.segmentSpacing;
      const surfaceV = this.surfacePosition.v;

      this.segments.push({
        u: surfaceU,
        v: surfaceV,
        mesh,
        entity,
        entitySurface: { u: surfaceU, v: surfaceV }
      });
    }
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.sinePhase += this.sineFrequency * dt;

    // Calculate direction to player
    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      // Calculate perpendicular for S-pattern
      const perpU = -dirV;
      const perpV = dirU;

      // Apply S-pattern offset
      const sineOffset = Math.sin(this.sinePhase) * this.sineAmplitude;

      this.surfacePosition.u += (dirU + perpU * sineOffset) * this.speed * dt;
      this.surfacePosition.v += (dirV + perpV * sineOffset) * this.speed * dt;
    }

    // Add current position to history
    this.positionHistory.unshift({ u: this.surfacePosition.u, v: this.surfacePosition.v });
    if (this.positionHistory.length > this.historySize) {
      this.positionHistory.pop();
    }

    // Update segments to follow head with delay
    for (let i = 0; i < this.segments.length; i++) {
      const historyIndex = Math.min((i + 1) * 5, this.positionHistory.length - 1);
      if (historyIndex < this.positionHistory.length) {
        const targetPos = this.positionHistory[historyIndex];
        this.segments[i].u = targetPos.u;
        this.segments[i].v = targetPos.v;
        this.segments[i].entitySurface = { u: targetPos.u, v: targetPos.v };
      }
    }
  }

  applySurfaceTransform(getTransform: (u: number, v: number) => {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3
  }): void {
    // Update head
    super.applySurfaceTransform(getTransform);

    // Update segments
    for (const segment of this.segments) {
      const transform = getTransform(segment.u, segment.v);
      segment.entity.position.copy(transform.position);

      // Orient segment to surface
      const up = transform.normal;
      const right = transform.tangent;
      const forward = transform.bitangent;

      const matrix = new THREE.Matrix4();
      matrix.makeBasis(right, up, forward);
      segment.entity.quaternion.setFromRotationMatrix(matrix);
    }
  }

  destroy(): void {
    super.destroy();

    // Clean up segments
    this.segments = [];
  }

  // Return all segment data for collision detection
  public getSegmentData(): Array<{ position: THREE.Vector3; surface: { u: number; v: number }; radius: number }> {
    return this.segments.map(s => ({
      position: s.entity.position,
      surface: s.entitySurface,
      radius: 0.15
    }));
  }
}
