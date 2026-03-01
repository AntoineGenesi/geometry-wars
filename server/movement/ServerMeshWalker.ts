/**
 * ServerMeshWalker — server-side wrapper around MeshSurface + MeshWalker.
 *
 * Manages a single entity's geodesic position on the server without any
 * camera or visual mesh dependency. The client sends camera axes in the input
 * message; this class projects them onto the surface and delegates to MeshWalker.
 */

import * as THREE from 'three';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { MeshWalker } from '../../src/movement/MeshWalker';

export interface ServerWalkerState {
  wx: number; wy: number; wz: number;
  nx: number; ny: number; nz: number;
  tangentX: number; tangentY: number; tangentZ: number;
  bitangentX: number; bitangentY: number; bitangentZ: number;
  faceIndex: number;
}

export class ServerMeshWalker {
  private readonly walker: MeshWalker;

  // Pre-allocated temp vectors — zero per-tick allocation
  private readonly _camRight = new THREE.Vector3();
  private readonly _camUp = new THREE.Vector3();
  private readonly _moveDir = new THREE.Vector3();

  constructor(surface: MeshSurface, startWorldPos: THREE.Vector3, speed: number) {
    this.walker = new MeshWalker(surface, startWorldPos, speed);
  }

  /**
   * Move using camera-relative axes from client input.
   * @param moveX  horizontal input (-1..1)
   * @param moveY  vertical input (-1..1)
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

    // Project camera axes onto surface tangent plane (remove normal component)
    const n = this.walker.normal;
    this._camRight.addScaledVector(n, -this._camRight.dot(n));
    this._camUp.addScaledVector(n, -this._camUp.dot(n));

    const rightLen = this._camRight.length();
    const upLen = this._camUp.length();

    if (rightLen < 0.001 || upLen < 0.001) {
      // Degenerate: camera axes are parallel to surface normal — use tangent frame
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
   * Uses BVH to snap to nearest surface point.
   */
  teleportToWorldPos(wx: number, wy: number, wz: number): void {
    const pt = new THREE.Vector3(wx, wy, wz);
    const result = this.walker.surface.closestPointOnSurface(pt);
    if (result) {
      this.walker.teleportTo(result.point, result.faceIndex, result.normal);
    }
  }

  /** Get current state for serialization into Colyseus schema. */
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

  /** Get world-space position (for collision checks). */
  getWorldPosition(): THREE.Vector3 {
    return this.walker.position;
  }
}
