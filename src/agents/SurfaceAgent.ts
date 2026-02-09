/**
 * SurfaceAgent - A reusable, zero-GC entity that moves on a MeshSurface.
 *
 * Uses BVH projection (closestPointOnSurface / moveOnSurface) to stay on any
 * mesh shape. Simpler than MeshWalker (no geodesic face walking, no half-edge
 * mesh) - appropriate for companions, drones, RTS units, and any non-player
 * entity that needs surface-constrained movement.
 *
 * Movement is driven by a composable AgentBehavior (idle, orbit, follow, etc).
 */

import * as THREE from 'three';
import type { MeshSurface } from '../experimental/mesh-movement/MeshSurface';
import type { AgentBehavior, AgentHandle } from './behaviors';
import { BehaviorStatus } from './behaviors';

// ---------------------------------------------------------------------------
// Module-level pre-allocated temp vectors (CRITICAL: zero GC per frame)
// ---------------------------------------------------------------------------

const _dir = new THREE.Vector3();

// ---------------------------------------------------------------------------
// SurfaceAgent
// ---------------------------------------------------------------------------

export class SurfaceAgent implements AgentHandle {
  readonly position: THREE.Vector3;
  readonly normal: THREE.Vector3;
  speed: number;

  private meshSurface: MeshSurface | null;
  private behavior: AgentBehavior | null = null;

  constructor(
    meshSurface: MeshSurface | null,
    initialPos: THREE.Vector3,
    speed: number,
  ) {
    this.position = initialPos.clone();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.speed = speed;
    this.meshSurface = meshSurface;
    this.snapToSurface();
  }

  // -----------------------------------------------------------------------
  // Movement primitives (called by behaviors via AgentHandle)
  // -----------------------------------------------------------------------

  /**
   * Move toward a target position. Returns remaining distance to target.
   */
  moveToward(target: THREE.Vector3, dt: number): number {
    _dir.copy(target).sub(this.position);
    const dist = _dir.length();

    if (dist < 0.001) return dist;

    _dir.normalize();
    const stepDist = Math.min(this.speed * dt, dist);

    if (this.meshSurface) {
      const result = this.meshSurface.moveOnSurface(
        this.position,
        this.normal,
        _dir,
        stepDist,
      );
      if (result) {
        this.position.copy(result.point);
        this.normal.copy(result.normal);
      }
    } else {
      // World-space fallback when no mesh surface
      this.position.addScaledVector(_dir, stepDist);
    }

    return dist - stepDist;
  }

  /**
   * Place agent at center + tangent/bitangent offset, then snap to surface.
   * Used by OrbitBehavior.
   */
  projectOffset(
    center: THREE.Vector3,
    tangent: THREE.Vector3,
    bitangent: THREE.Vector3,
    cosA: number,
    sinA: number,
    radius: number,
  ): void {
    this.position.copy(center);
    this.position.addScaledVector(tangent, cosA * radius);
    this.position.addScaledVector(bitangent, sinA * radius);
    this.snapToSurface();
  }

  /**
   * Snap current position to the nearest point on the mesh surface.
   */
  snapToSurface(): void {
    if (!this.meshSurface) return;

    const result = this.meshSurface.closestPointOnSurface(this.position);
    if (result) {
      this.position.copy(result.point);
      this.normal.copy(result.normal);
    }
  }

  // -----------------------------------------------------------------------
  // Behavior management
  // -----------------------------------------------------------------------

  setBehavior(behavior: AgentBehavior | null): void {
    this.behavior = behavior;
  }

  getBehavior(): AgentBehavior | null {
    return this.behavior;
  }

  /**
   * Update the agent's behavior. Returns true if behavior is still active.
   */
  update(dt: number): boolean {
    if (!this.behavior) return false;

    const status = this.behavior.update(this, dt);
    return status === BehaviorStatus.Active;
  }

  // -----------------------------------------------------------------------
  // MeshSurface management
  // -----------------------------------------------------------------------

  setMeshSurface(ms: MeshSurface | null): void {
    this.meshSurface = ms;
  }

  getMeshSurface(): MeshSurface | null {
    return this.meshSurface;
  }

  // -----------------------------------------------------------------------
  // Network serialization
  // -----------------------------------------------------------------------

  getNetworkState(): {
    px: number;
    py: number;
    pz: number;
    nx: number;
    ny: number;
    nz: number;
    speed: number;
    behaviorType: string;
  } {
    return {
      px: this.position.x,
      py: this.position.y,
      pz: this.position.z,
      nx: this.normal.x,
      ny: this.normal.y,
      nz: this.normal.z,
      speed: this.speed,
      behaviorType: this.behavior?.type ?? 'none',
    };
  }
}
