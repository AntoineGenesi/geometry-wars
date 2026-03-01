/**
 * ServerMeshWalker — server-side wrapper around MeshSurface + MeshWalker.
 *
 * Manages a single entity's geodesic position on the server.
 * Key differences from MeshWalker:
 * - No visual mesh attachment (mesh is always null)
 * - No THREE.Camera dependency — accepts pre-computed world-space camera axes
 * - Serializes state to/from plain objects for Colyseus schema fields
 */

import * as THREE from 'three';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { MeshWalker } from '../../src/movement/MeshWalker';

export interface ServerWalkerState {
  wx: number; wy: number; wz: number;          // world position
  nx: number; ny: number; nz: number;          // surface normal
  tangentX: number; tangentY: number; tangentZ: number;          // tangent (surface "right")
  bitangentX: number; bitangentY: number; bitangentZ: number;    // bitangent (surface "forward/up")
  faceIndex: number;
}

export class ServerMeshWalker {
  private walker: MeshWalker;

  // Pre-allocated temp vectors (zero per-frame GC)
  private readonly _camRight = new THREE.Vector3();
  private readonly _camUp = new THREE.Vector3();
  private readonly _moveDir = new THREE.Vector3();

  constructor(surface: MeshSurface, startWorldPos: THREE.Vector3, speed: number) {
    this.walker = new MeshWalker(surface, startWorldPos, speed);
  }

  /**
   * Move using camera-relative axes from client input.
   *
   * The client sends its camera right/up axes (world space) along with the
   * movement input. The server replicates the SP projection logic:
   * project the camera axes onto the surface tangent plane, then move.
   *
   * @param moveX  horizontal input (-1 to 1)
   * @param moveY  vertical input (-1 to 1)
   * @param camRightX/Y/Z  camera right axis in world space (from client)
   * @param camUpX/Y/Z     camera up axis in world space (from client)
   * @param dt  delta time in seconds
   */
  moveWithCameraAxes(
    moveX: number, moveY: number,
    camRightX: number, camRightY: number, camRightZ: number,
    camUpX: number, camUpY: number, camUpZ: number,
    dt: number,
  ): void {
    this._camRight.set(camRightX, camRightY, camRightZ);
    this._camUp.set(camUpX, camUpY, camUpZ);

    // Project camera axes onto surface tangent plane (same as MeshWalker.moveFromInput)
    const n = this.walker.normal;
    this._camRight.addScaledVector(n, -this._camRight.dot(n));
    this._camUp.addScaledVector(n, -this._camUp.dot(n));

    const rightLen = this._camRight.length();
    const upLen = this._camUp.length();

    if (rightLen < 0.001 || upLen < 0.001) {
      // Degenerate: camera axis is nearly parallel to surface normal.
      // Fall back to tangent frame directly.
      this._moveDir.set(0, 0, 0)
        .addScaledVector(this.walker.tangent, moveX)
        .addScaledVector(this.walker.bitangent, moveY);
    } else {
      this._camRight.multiplyScalar(1 / rightLen);
      this._camUp.multiplyScalar(1 / upLen);
      this._moveDir.set(0, 0, 0)
        .addScaledVector(this._camRight, moveX)
        .addScaledVector(this._camUp, moveY);
    }

    if (this._moveDir.lengthSq() > 0.0001) {
      this.walker.move(this._moveDir, dt);
    }
  }

  /**
   * Teleport to a world-space position (respawn, round start).
   * Uses the BVH to snap to the nearest surface point.
   */
  teleportToWorldPos(wx: number, wy: number, wz: number): void {
    const surface = this.walker.surface;
    const pt = new THREE.Vector3(wx, wy, wz);
    const result = surface.closestPointOnSurface(pt);
    if (result) {
      this.walker.teleportTo(result.point, result.faceIndex, result.normal);
    }
  }

  /** Get current state for serialization into Colyseus schema fields. */
  getState(): ServerWalkerState {
    const frame = this.walker.getTangentFrame();
    return {
      wx: this.walker.position.x,
      wy: this.walker.position.y,
      wz: this.walker.position.z,
      nx: frame.normal.x,
      ny: frame.normal.y,
      nz: frame.normal.z,
      tangentX: frame.tangent.x,
      tangentY: frame.tangent.y,
      tangentZ: frame.tangent.z,
      bitangentX: frame.bitangent.x,
      bitangentY: frame.bitangent.y,
      bitangentZ: frame.bitangent.z,
      faceIndex: this.walker.faceIndex,
    };
  }

  /** Get world-space position for collision checks (enemy-player, bullet-player). */
  getWorldPosition(): THREE.Vector3 {
    return this.walker.position;
  }

  /** Expose speed for level-based multipliers. */
  get speed(): number { return this.walker.speed; }
  set speed(v: number) { this.walker.speed = v; }
}
