import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildCircle3D } from '../../utils/GeometryBuilder';

// Pre-allocated temps — zero per-frame allocations
const _gsSegMatrix = new THREE.Matrix4();
const _gsInvRot = new THREE.Quaternion();
const _gsLocalPos = new THREE.Vector3();

/** Default segment count for GiantSnake. */
const DEFAULT_GIANT_SEGMENT_COUNT = 7;

/**
 * Giant Snake - oversized snake that breaks into 2 regular snakes on death.
 * Chases player with S-pattern movement, larger head and segments.
 * Visual: big bright-blue circles with trailing segments.
 */

export class GiantSnake extends BaseEnemy {
  private segments: Array<{ u: number; v: number; mesh: THREE.Group }> = [];
  private readonly segmentCount: number;

  /** All segment meshes in a shared root — added to scene by EnemySpawner, same pattern as Snake. */
  public readonly segmentRoot = new THREE.Group();
  private readonly sineAmplitude = 0.5;
  private readonly sineFrequency = 1.8;
  private sinePhase = 0;
  private positionHistory: Array<{ u: number; v: number }> = [];
  private positionHistoryWorld: Array<THREE.Vector3> = []; // For walker mode
  private readonly historySize: number;

  /** Called when giant dies to spawn regular enemies */
  public static onDeathSpawn: ((u: number, v: number, count: number) => void) | null = null;

  /**
   * @param surfaceU - Initial surface U coordinate
   * @param surfaceV - Initial surface V coordinate
   * @param segmentCount - Number of body segments (default 7; use 15-20 for late-game waves)
   */
  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5, segmentCount: number = DEFAULT_GIANT_SEGMENT_COUNT) {
    // health=10, score=200, geoms=4, speed=0.04, radius=0.4
    super(surfaceU, surfaceV, 10, 200, 4, 0.04, 0.4);
    this.segmentCount = segmentCount;
    // Scale history to ensure all segments can trail the head properly
    this.historySize = Math.max(40, (segmentCount + 2) * 5);
    this.createMesh();
    this.createSegments();
    // Register segmentRoot so generic cleanup code (network-main.ts) removes it from scene.
    this.auxiliaryObjects.push(this.segmentRoot);
  }

  private createMesh(): void {
    // Large head circle in bright blue
    this.mesh = buildCircle3D(0.35, 16, 0x2266ff, 0.1, 0.025);
  }

  private createSegments(): void {
    for (let i = 0; i < this.segmentCount; i++) {
      const segSize = 0.28 - i * 0.02;
      const mesh = buildCircle3D(Math.max(segSize, 0.12), 12, 0x1144aa, 0.08, 0.02);
      this.segmentRoot.add(mesh);
      this.segments.push({
        u: (((this.surfacePosition.u - (i + 1) * 0.12) % 1) + 1) % 1,
        v: this.surfacePosition.v,
        mesh,
      });
    }
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.sinePhase += this.sineFrequency * dt;

    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;
      const perpU = -dirV;
      const perpV = dirU;
      const sineOffset = Math.sin(this.sinePhase) * this.sineAmplitude;

      this.surfacePosition = {
        u: this.surfacePosition.u + (dirU + perpU * sineOffset) * this.speed * dt,
        v: this.surfacePosition.v + (dirV + perpV * sineOffset) * this.speed * dt,
      };
    }

    // Record position history
    this.positionHistory.unshift({ u: this.surfacePosition.u, v: this.surfacePosition.v });
    if (this.positionHistory.length > this.historySize) {
      this.positionHistory.pop();
    }

    // Update segments to follow head
    for (let i = 0; i < this.segments.length; i++) {
      const historyIndex = Math.min((i + 1) * 5, this.positionHistory.length - 1);
      if (historyIndex < this.positionHistory.length) {
        const target = this.positionHistory[historyIndex];
        this.segments[i].u = target.u;
        this.segments[i].v = target.v;
      }
    }
  }

  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    super.applySurfaceTransform(getTransform);

    // In MP mode, updateBehavior is not called (server is authoritative for positions),
    // so positionHistory never gets filled and segments would stay at their initial spawn positions.
    // Detect this by checking if head has moved since the last history entry.
    // In SP, updateBehavior already recorded the same position → no duplicate added.
    const headU = this.surfacePosition.u;
    const headV = this.surfacePosition.v;
    const lastH = this.positionHistory[0];
    if (!lastH || Math.abs(lastH.u - headU) > 0.0005 || Math.abs(lastH.v - headV) > 0.0005) {
      this.positionHistory.unshift({ u: headU, v: headV });
      if (this.positionHistory.length > this.historySize) this.positionHistory.pop();
      // Update segment UV positions from history so they trail the head
      for (let i = 0; i < this.segments.length; i++) {
        const historyIndex = Math.min((i + 1) * 5, this.positionHistory.length - 1);
        if (historyIndex < this.positionHistory.length) {
          this.segments[i].u = this.positionHistory[historyIndex].u;
          this.segments[i].v = this.positionHistory[historyIndex].v;
        }
      }
    }

    // Update each segment mesh in world space using pre-allocated matrix
    for (const segment of this.segments) {
      const t = getTransform(segment.u, segment.v);
      segment.mesh.position.copy(t.position).addScaledVector(t.normal, 0.3);
      _gsSegMatrix.makeBasis(t.bitangent, t.normal, t.tangent);
      segment.mesh.quaternion.setFromRotationMatrix(_gsSegMatrix);
    }
  }

  /** Get segment meshes for scene management */
  getSegmentMeshes(): THREE.Group[] {
    return this.segments.map(s => s.mesh);
  }

  /** Get segment collision data */
  getSegmentData(): Array<{ position: THREE.Vector3; surface: { u: number; v: number }; radius: number }> {
    return this.segments.map(s => ({
      position: s.mesh.position,
      surface: { u: s.u, v: s.v },
      radius: 0.25,
    }));
  }

  die(): void {
    if (!this.alive) return;

    // Spawn 2 regular snakes on death
    if (GiantSnake.onDeathSpawn) {
      GiantSnake.onDeathSpawn(this.surfacePosition.u, this.surfacePosition.v, 2);
    }

    super.die();
  }

  destroy(): void {
    for (const seg of this.segments) {
      this.segmentRoot.remove(seg.mesh);
      seg.mesh.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mt) => (mt as THREE.Material).dispose());
          else (m.material as THREE.Material).dispose();
        }
      });
    }
    this.segments = [];
    super.destroy();
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    this.sinePhase += this.sineFrequency * dt;

    const toPlayer = playerWorldPos.clone().sub(this.walker.position);
    const distance = toPlayer.length();

    if (distance > 0.01) {
      const dirToPlayer = toPlayer.clone().normalize();

      // Get tangent frame
      const frame = this.walker.getTangentFrame();

      // Project player direction onto tangent plane
      const tangentComponent = dirToPlayer.dot(frame.tangent);
      const bitangentComponent = dirToPlayer.dot(frame.bitangent);

      // Perpendicular in tangent plane (rotate 90 degrees)
      const perpTangent = -bitangentComponent;
      const perpBitangent = tangentComponent;

      // Apply S-pattern offset
      const sineOffset = Math.sin(this.sinePhase) * this.sineAmplitude;

      // Combine forward direction with perpendicular sine wave
      const moveDir = frame.tangent.clone().multiplyScalar(tangentComponent + perpTangent * sineOffset)
        .add(frame.bitangent.clone().multiplyScalar(bitangentComponent + perpBitangent * sineOffset));

      // Add current position to world history
      this.positionHistoryWorld.unshift(this.walker.position.clone());
      if (this.positionHistoryWorld.length > this.historySize) {
        this.positionHistoryWorld.pop();
      }

      // Update segments to follow head with delay (using world positions)
      if (this.walker.surface && this.surfaceRef) {
        for (let i = 0; i < this.segments.length; i++) {
          const historyIndex = Math.min((i + 1) * 5, this.positionHistoryWorld.length - 1);
          if (historyIndex < this.positionHistoryWorld.length) {
            const targetWorldPos = this.positionHistoryWorld[historyIndex];

            // Get closest point on surface to target world position
            const closest = this.walker.surface.closestPointOnSurface(targetWorldPos);
            if (closest) {
              this.segments[i].mesh.position.copy(closest.point).addScaledVector(closest.normal, 0.3);

              // Store UV for backward compatibility.
              // worldToSurface() expects local coordinates (before worldRotation).
              // Apply inverse worldRotation first, same as BaseEnemy.update().
              _gsInvRot.copy(this.surfaceRef.worldRotation).invert();
              _gsLocalPos.copy(closest.point).applyQuaternion(_gsInvRot);
              const uv = this.surfaceRef.worldToSurface(_gsLocalPos);
              this.segments[i].u = uv.u;
              this.segments[i].v = uv.v;
            }
          }
        }
      }

      if (moveDir.length() > 0.001) {
        return moveDir.normalize().multiplyScalar(this.speed * this.walkerSpeedScale);
      }
    }

    return null;
  }
}
