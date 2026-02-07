/**
 * MeshSurface - Wraps any THREE.Mesh with a BVH for fast surface queries.
 *
 * This is the core of the new mesh-agnostic movement system.
 * It replaces the UV-based Surface class with one that works for ANY mesh shape.
 *
 * Key capabilities:
 * - Find closest point on mesh surface from any world position
 * - Get surface normal at any point
 * - Compute tangent plane for movement
 * - Raycast onto mesh surface
 *
 * No UV coordinates. No shape-specific code. Works for sphere, torus, cup, statue, anything.
 */

import * as THREE from 'three';
import { MeshBVH, getTriangleHitPointInfo } from 'three-mesh-bvh';
import { GeodesicSurface, GeodesicMoveResult } from './geodesic/GeodesicSurface';
import { FacePosition } from './geodesic/FaceWalker';

export interface SurfaceQueryResult {
  /** Closest point on the mesh surface (world space) */
  point: THREE.Vector3;
  /** Surface normal at the closest point (world space) */
  normal: THREE.Vector3;
  /** Distance from query point to surface */
  distance: number;
  /** Triangle index in the geometry */
  faceIndex: number;
}

export interface TangentFrame {
  /** Surface normal */
  normal: THREE.Vector3;
  /** Tangent vector (arbitrary but consistent direction along surface) */
  tangent: THREE.Vector3;
  /** Bitangent (perpendicular to both normal and tangent) */
  bitangent: THREE.Vector3;
}

export class MeshSurface {
  readonly mesh: THREE.Mesh;
  readonly bvh: MeshBVH;
  /** Geodesic walking system (half-edge mesh + face walker) */
  readonly geodesic: GeodesicSurface;

  /** Reusable objects to avoid GC pressure */
  private readonly _closestTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  private readonly _hitInfo = { face: { a: 0, b: 0, c: 0, materialIndex: 0, normal: new THREE.Vector3() }, uv: new THREE.Vector2() };
  private readonly _invMatrix = new THREE.Matrix4();
  private readonly _ray = new THREE.Ray();
  private readonly _tempVec = new THREE.Vector3();

  constructor(mesh: THREE.Mesh) {
    this.mesh = mesh;

    // Build BVH for fast spatial queries
    const geometry = mesh.geometry;
    if (!geometry.boundsTree) {
      geometry.boundsTree = new MeshBVH(geometry);
    }
    this.bvh = geometry.boundsTree as MeshBVH;

    // Build geodesic walking structures (half-edge mesh + face walker)
    this.geodesic = new GeodesicSurface(geometry);
  }

  /**
   * Find the closest point on the mesh surface to a given world-space position.
   * This is the primary query for keeping entities on the surface.
   */
  closestPointOnSurface(worldPoint: THREE.Vector3): SurfaceQueryResult | null {
    // Transform query point to mesh local space
    this._invMatrix.copy(this.mesh.matrixWorld).invert();
    const localPoint = this._tempVec.copy(worldPoint).applyMatrix4(this._invMatrix);

    // Query BVH for closest point
    const result = this.bvh.closestPointToPoint(localPoint, this._closestTarget);
    if (!result) return null;

    // Get face normal at the closest point
    getTriangleHitPointInfo(
      this._closestTarget.point,
      this.mesh.geometry,
      this._closestTarget.faceIndex,
      this._hitInfo,
    );

    // Transform results back to world space
    const worldSurfacePoint = this._closestTarget.point.clone()
      .applyMatrix4(this.mesh.matrixWorld);

    // Transform normal to world space (use normal matrix for correct scaling)
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.mesh.matrixWorld);
    const worldNormal = this._hitInfo.face.normal.clone()
      .applyMatrix3(normalMatrix)
      .normalize();

    return {
      point: worldSurfacePoint,
      normal: worldNormal,
      distance: this._closestTarget.distance,
      faceIndex: this._closestTarget.faceIndex,
    };
  }

  /**
   * Raycast from a point toward the mesh surface.
   * Useful for projecting entities "down" onto the surface.
   */
  raycastOntoSurface(origin: THREE.Vector3, direction: THREE.Vector3): SurfaceQueryResult | null {
    // Transform ray to local space
    this._invMatrix.copy(this.mesh.matrixWorld).invert();
    this._ray.origin.copy(origin).applyMatrix4(this._invMatrix);
    this._ray.direction.copy(direction).transformDirection(this._invMatrix).normalize();

    const hit = this.bvh.raycastFirst(this._ray);
    if (!hit) return null;

    // Get face normal
    getTriangleHitPointInfo(
      hit.point,
      this.mesh.geometry,
      hit.faceIndex!,
      this._hitInfo,
    );

    // Transform to world space
    const worldPoint = hit.point.applyMatrix4(this.mesh.matrixWorld);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.mesh.matrixWorld);
    const worldNormal = this._hitInfo.face.normal.clone()
      .applyMatrix3(normalMatrix)
      .normalize();

    return {
      point: worldPoint,
      normal: worldNormal,
      distance: hit.distance,
      faceIndex: hit.faceIndex!,
    };
  }

  /**
   * Compute a tangent frame at a surface point.
   * Returns orthonormal basis (normal, tangent, bitangent) for movement.
   *
   * The tangent/bitangent define the surface plane - entities move within this plane.
   */
  getTangentFrame(surfaceNormal: THREE.Vector3): TangentFrame {
    const normal = surfaceNormal.clone().normalize();

    // Choose a reference vector that's not parallel to the normal
    const ref = Math.abs(normal.y) < 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);

    // Gram-Schmidt orthogonalization
    const tangent = ref.clone().sub(normal.clone().multiplyScalar(ref.dot(normal))).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    return { normal, tangent, bitangent };
  }

  /**
   * Move a point along the surface by a given world-space displacement.
   *
   * Algorithm:
   * 1. Compute tangent plane at current position
   * 2. Project desired movement onto tangent plane
   * 3. Move to new position in world space
   * 4. Project back onto mesh surface (closestPointToPoint)
   *
   * Speed is in world units - constant everywhere on any shape.
   */
  moveOnSurface(
    currentPos: THREE.Vector3,
    currentNormal: THREE.Vector3,
    moveDirWorld: THREE.Vector3,
    distance: number,
  ): SurfaceQueryResult | null {
    if (distance < 0.0001) {
      return this.closestPointOnSurface(currentPos);
    }

    // Project movement direction onto tangent plane (remove normal component)
    const normal = currentNormal.clone().normalize();
    const projectedDir = moveDirWorld.clone();
    projectedDir.sub(normal.clone().multiplyScalar(projectedDir.dot(normal)));

    const projLen = projectedDir.length();

    // If projected direction is too small, the moveDir is parallel to the normal.
    // Return the current position (let the MeshWalker handle stuck recovery using
    // its persistent tangent frame).
    if (projLen < 0.0001) {
      return this.closestPointOnSurface(currentPos);
    }
    projectedDir.normalize();

    // Move along the tangent plane
    const newPos = currentPos.clone().add(projectedDir.clone().multiplyScalar(distance));

    // Project back onto mesh surface
    return this.closestPointOnSurface(newPos);
  }

  /**
   * Check if a point is on the "near" side of the mesh relative to a camera.
   * Returns a value from 0 to 1:
   * - 1.0 = point is facing the camera (front side)
   * - 0.0 = point is facing away from the camera (back side)
   *
   * Used for depth-based opacity of far-side entities.
   */
  getVisibility(
    entityPos: THREE.Vector3,
    entityNormal: THREE.Vector3,
    cameraPos: THREE.Vector3,
  ): number {
    const toCamera = cameraPos.clone().sub(entityPos).normalize();
    const dot = entityNormal.dot(toCamera);
    // Remap: dot > 0 means facing camera, dot < 0 means facing away
    // Smooth transition: front side = 1.0, back side = 0.2
    return Math.max(0.2, dot * 0.5 + 0.5);
  }

  /**
   * Get the approximate center of the mesh (for gravity direction calculations).
   */
  getCenter(): THREE.Vector3 {
    const box = new THREE.Box3().setFromObject(this.mesh);
    return box.getCenter(new THREE.Vector3());
  }

  /**
   * Initialize a geodesic face position from a world point and BVH face index.
   * Call once when creating a walker, then pass the returned FacePosition to moveGeodesic().
   */
  initGeodesicPosition(worldPoint: THREE.Vector3, faceIndex: number): FacePosition {
    return this.geodesic.initializePosition(worldPoint, faceIndex);
  }

  /**
   * Move geodesically on the surface using face walking + parallel transport.
   *
   * Unlike moveOnSurface() which projects off-surface and snaps back via BVH,
   * this walks along triangle faces, crossing edges with proper direction transport.
   * This gives true geodesic paths with no drift on complex shapes (torus, peanut, etc).
   *
   * @param facePos - Current face position (from initGeodesicPosition or previous moveGeodesic)
   * @param directionWorld - Movement direction in world space (tangent to surface)
   * @param distance - Distance to walk in world units
   * @returns Geodesic move result with new face position, world position, normal, and transported direction
   */
  moveGeodesic(
    facePos: FacePosition,
    directionWorld: THREE.Vector3,
    distance: number,
  ): GeodesicMoveResult {
    return this.geodesic.moveGeodesic(facePos, directionWorld, distance);
  }

  dispose(): void {
    this.mesh.geometry.boundsTree = undefined;
  }
}

export type { FacePosition };
