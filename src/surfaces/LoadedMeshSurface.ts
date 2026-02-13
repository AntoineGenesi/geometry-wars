/**
 * LoadedMeshSurface - Surface wrapper for arbitrary loaded meshes.
 *
 * Provides UV-based movement for enemies on arbitrary 3D models by combining:
 * - Spherical UV projection (maps (u,v) to a sphere around the mesh)
 * - BVH snap-to-surface (projects from sphere onto actual mesh geometry)
 * - MeshSurface for geodesic movement and surface queries
 *
 * This enables enemy spawning and movement on any loaded mesh without requiring
 * the mesh to have pre-defined UV coordinates.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Surface, SurfaceConfig, SurfacePoint } from './Surface';
import { MeshSurface } from './MeshSurface';
import type { LoadedMesh } from '../loaders/MeshLoader';

export interface LoadedMeshConfig extends SurfaceConfig {
  /** Override the automatically computed bounding sphere radius */
  radius?: number;
  /** Grid resolution for UV grid lines */
  gridSegmentsU?: number;
  gridSegmentsV?: number;
  /** Animation playback speed (default: 1.0) */
  animationSpeed?: number;
}

export class LoadedMeshSurface extends Surface {
  /** Underlying MeshSurface for BVH queries and geodesic movement */
  private readonly meshSurface: MeshSurface;

  /** Bounding sphere used for spherical UV projection */
  private readonly boundingSphere: THREE.Sphere;

  /** Grid resolution */
  private readonly gridSegmentsU: number;
  private readonly gridSegmentsV: number;

  /** The original loaded mesh */
  readonly loadedMesh: LoadedMesh;

  /** Animation mixer for playing GLTF animations (null if no animations) */
  private readonly animationMixer: THREE.AnimationMixer | null = null;

  /** Animation clips from the loaded mesh */
  private readonly animations: THREE.AnimationClip[];

  /** Pre-allocated temp objects to avoid GC pressure */
  private readonly _tempDir = new THREE.Vector3();
  private readonly _tempRayOrigin = new THREE.Vector3();
  private readonly _tempRayDir = new THREE.Vector3();
  private readonly _tempSpherePoint = new THREE.Vector3();

  private static getInitData(): {
    loadedMesh: LoadedMesh;
    gridSegmentsU: number;
    gridSegmentsV: number;
  } {
    return (
      (LoadedMeshSurface as any).__initData ?? {
        loadedMesh: null as any,
        gridSegmentsU: 20,
        gridSegmentsV: 20,
      }
    );
  }

  constructor(loadedMesh: LoadedMesh, config?: LoadedMeshConfig) {
    // Store in a temp object since we can't assign before super()
    // (super() calls createMesh() which needs loadedMesh)
    const self = {
      loadedMesh,
      gridSegmentsU: config?.gridSegmentsU ?? 20,
      gridSegmentsV: config?.gridSegmentsV ?? 20
    };
    (LoadedMeshSurface as any).__initData = self;

    super(config);

    this.loadedMesh = loadedMesh;
    this.gridSegmentsU = self.gridSegmentsU;
    this.gridSegmentsV = self.gridSegmentsV;
    this.animations = loadedMesh.animations || [];

    // Create MeshSurface for BVH queries
    this.meshSurface = new MeshSurface(loadedMesh.mesh);

    // Initialize animations if present
    if (this.animations.length > 0) {
      this.animationMixer = new THREE.AnimationMixer(loadedMesh.mesh);

      // Set animation speed
      const animationSpeed = config?.animationSpeed ?? 1.0;
      this.animationMixer.timeScale = animationSpeed;

      // Play all animations (looping)
      for (const clip of this.animations) {
        const action = this.animationMixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
    }

    // Compute bounding sphere for UV projection
    loadedMesh.mesh.geometry.computeBoundingSphere();
    const bs = loadedMesh.mesh.geometry.boundingSphere;
    if (!bs) {
      throw new Error('Failed to compute bounding sphere for loaded mesh. This may indicate the mesh has no valid geometry or contains only degenerate triangles.');
    }

    this.boundingSphere = new THREE.Sphere().copy(bs);

    // Override radius if provided, otherwise use computed bounding sphere radius
    if (config?.radius !== undefined) {
      this.boundingSphere.radius = config.radius;
    }

    // Set surface radius for player positioning
    this.surfaceRadius = this.boundingSphere.radius;

    // Position player at "front" of the mesh (slightly above center)
    this.playerLocalPosition = new THREE.Vector3(0, this.surfaceRadius * 0.7, this.surfaceRadius * 0.7).normalize().multiplyScalar(this.surfaceRadius);
  }

  /**
   * Map UV coordinates to a point on the mesh surface.
   *
   * Algorithm:
   * 1. Convert (u, v) to spherical coordinates (theta, phi)
   * 2. Compute direction vector from sphere center
   * 3. Raycast from outside the bounding sphere toward center
   * 4. If raycast hits, return the hit point
   * 5. If raycast misses, fall back to closest point on mesh
   *
   * This ensures every (u, v) maps to a valid point on the mesh surface.
   */
  getPoint(u: number, v: number): SurfacePoint {
    // Convert UV to spherical coordinates
    // u = [0, 1] maps to theta = [0, 2π] (longitude)
    // v = [0, 1] maps to phi = [0, π] (latitude, 0 = north pole, π = south pole)
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI;

    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    // Direction from bounding sphere center
    this._tempDir.set(
      sinPhi * cosTheta,
      cosPhi,
      sinPhi * sinTheta
    );

    // Raycast from outside the bounding sphere toward the center
    // Start at 2x radius to ensure we're outside
    this._tempRayOrigin.copy(this.boundingSphere.center)
      .addScaledVector(this._tempDir, this.boundingSphere.radius * 2);

    this._tempRayDir.copy(this._tempDir).negate();

    const raycastResult = this.meshSurface.raycastOntoSurface(
      this._tempRayOrigin,
      this._tempRayDir
    );

    if (raycastResult) {
      // Raycast succeeded - use the hit point
      return {
        position: raycastResult.point,
        normal: raycastResult.normal,
        tangentU: this.meshSurface.getTangentFrame(raycastResult.normal).tangent,
        tangentV: this.meshSurface.getTangentFrame(raycastResult.normal).bitangent,
      };
    }

    // Raycast missed - fall back to closest point on mesh surface
    // This handles concave regions where the ray might not hit
    this._tempSpherePoint.copy(this.boundingSphere.center)
      .addScaledVector(this._tempDir, this.boundingSphere.radius);

    const closestResult = this.meshSurface.closestPointOnSurface(this._tempSpherePoint);
    if (!closestResult) {
      // Extremely unlikely - BVH failed completely
      // Return a fallback point on the bounding sphere
      const fallbackPos = this._tempSpherePoint.clone();
      const fallbackNormal = this._tempDir.clone();
      const frame = this.meshSurface.getTangentFrame(fallbackNormal);
      return {
        position: fallbackPos,
        normal: fallbackNormal,
        tangentU: frame.tangent,
        tangentV: frame.bitangent,
      };
    }

    return {
      position: closestResult.point,
      normal: closestResult.normal,
      tangentU: this.meshSurface.getTangentFrame(closestResult.normal).tangent,
      tangentV: this.meshSurface.getTangentFrame(closestResult.normal).bitangent,
    };
  }

  /**
   * Move on the surface in UV space.
   *
   * Algorithm:
   * 1. Get current world position from (u, v)
   * 2. Compute tangent frame at current position
   * 3. Move in world space using du/dv as tangent-space directions
   * 4. Snap the new position back to mesh surface
   * 5. Convert back to UV coordinates
   *
   * This uses MeshSurface.moveOnSurface() internally, which handles
   * tangent-plane projection and BVH snapping.
   */
  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    if (Math.abs(du) < 0.0001 && Math.abs(dv) < 0.0001) {
      return { u, v };
    }

    // Get current position on surface
    const currentPoint = this.getPoint(u, v);

    // Compute movement in world space
    // du maps to movement along tangentU, dv maps to movement along tangentV
    // Scale by approximate world units per UV unit (use bounding sphere circumference as reference)
    const worldScaleU = this.boundingSphere.radius * Math.PI * 2; // Circumference
    const worldScaleV = this.boundingSphere.radius * Math.PI; // Half circumference

    const worldDu = du * worldScaleU;
    const worldDv = dv * worldScaleV;

    // Compute world-space movement direction
    const moveDir = new THREE.Vector3()
      .addScaledVector(currentPoint.tangentU, worldDu)
      .addScaledVector(currentPoint.tangentV, worldDv);

    const moveDistance = moveDir.length();
    if (moveDistance < 0.0001) {
      return { u, v };
    }

    moveDir.normalize();

    // Move on surface using MeshSurface
    const newPosResult = this.meshSurface.moveOnSurface(
      currentPoint.position,
      currentPoint.normal,
      moveDir,
      moveDistance
    );

    if (!newPosResult) {
      // Move failed - return current UV
      return { u, v };
    }

    // Convert new position back to UV coordinates
    return this.worldToSurface(newPosResult.point);
  }

  /**
   * Convert a world position to UV coordinates.
   *
   * Uses inverse spherical projection:
   * 1. Find closest point on mesh surface (in case position is off-surface)
   * 2. Compute vector from bounding sphere center to surface point
   * 3. Convert to spherical coordinates (theta, phi)
   * 4. Map to (u, v)
   */
  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    // Find the closest point on the mesh surface
    const surfaceResult = this.meshSurface.closestPointOnSurface(worldPos);
    const surfacePoint = surfaceResult ? surfaceResult.point : worldPos;

    // Compute direction from bounding sphere center
    const dir = this._tempDir.copy(surfacePoint).sub(this.boundingSphere.center);

    // Normalize to get direction (even if point is not exactly on bounding sphere)
    const len = dir.length();
    if (len < 0.0001) {
      // Point is at the center - return arbitrary UV
      return { u: 0.5, v: 0.5 };
    }
    dir.divideScalar(len);

    // Convert to spherical coordinates
    // phi = acos(y), theta = atan2(z, x)
    const phi = Math.acos(Math.max(-1, Math.min(1, dir.y)));
    let theta = Math.atan2(dir.z, dir.x);
    if (theta < 0) theta += Math.PI * 2;

    const u = theta / (Math.PI * 2);
    const v = phi / Math.PI;

    return { u, v };
  }

  /**
   * Create the visual mesh for the surface.
   * Uses the loaded mesh directly.
   */
  createMesh(): THREE.Mesh {
    const { loadedMesh } = LoadedMeshSurface.getInitData();
    // Clone the loaded mesh to avoid modifying the original
    const clonedGeo = loadedMesh.mesh.geometry.clone();
    return new THREE.Mesh(clonedGeo, this.createSurfaceMaterial());
  }

  /**
   * Create a UV grid overlay.
   * Draws longitude and latitude lines based on the spherical UV projection.
   */
  createGrid(): THREE.LineSegments {
    const vertices: number[] = [];
    const lineDetail = 32;

    // Longitude lines (constant u, varying v)
    for (let i = 0; i < this.gridSegmentsU; i++) {
      const u = i / this.gridSegmentsU;
      for (let j = 0; j < lineDetail; j++) {
        const v0 = j / lineDetail;
        const v1 = (j + 1) / lineDetail;

        // Get points on the actual mesh surface (not just the sphere)
        const p0 = this.getPoint(u, v0);
        const p1 = this.getPoint(u, v1);

        vertices.push(p0.position.x, p0.position.y, p0.position.z);
        vertices.push(p1.position.x, p1.position.y, p1.position.z);
      }
    }

    // Latitude lines (constant v, varying u)
    for (let j = 1; j < this.gridSegmentsV; j++) {
      const v = j / this.gridSegmentsV;
      for (let i = 0; i < lineDetail; i++) {
        const u0 = i / lineDetail;
        const u1 = (i + 1) / lineDetail;

        const p0 = this.getPoint(u0, v);
        const p1 = this.getPoint(u1, v);

        vertices.push(p0.position.x, p0.position.y, p0.position.z);
        vertices.push(p1.position.x, p1.position.y, p1.position.z);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    return new THREE.LineSegments(geometry, this.createGridMaterial());
  }

  /**
   * UV wrapping behavior: u wraps (periodic), v clamps (has poles).
   * This matches spherical topology.
   */
  wrapUV(u: number, v: number): { u: number; v: number } {
    const epsilon = 0.005;
    return {
      u: ((u % 1) + 1) % 1,
      v: Math.max(epsilon, Math.min(1 - epsilon, v)),
    };
  }

  /** U axis wraps (periodic longitude) */
  get wrapsU(): boolean {
    return true;
  }

  /** V axis does not wrap (has poles at v=0 and v=1) */
  get wrapsV(): boolean {
    return false;
  }

  /**
   * Update animations. Called from Game.onFixedUpdate().
   * Uses fixed timestep delta (not wall-clock delta) for determinism.
   *
   * @param dt - Fixed timestep delta in seconds (typically 1/60)
   */
  updateAnimations(dt: number): void {
    if (!this.animationMixer) return;

    // Update animation mixer with fixed timestep
    this.animationMixer.update(dt);

    // After animation updates, rebuild BVH (mesh vertices may have moved)
    // Note: This is expensive for large meshes (~5-10ms for 50k triangles).
    // For production optimization, consider:
    // - Rebuilding only every N frames (e.g., every 3 frames)
    // - Using a simplified collision mesh (low-poly version for BVH)
    // - Offloading BVH build to a worker thread
    // - Only rebuilding if vertex displacement exceeds a threshold
    const geometry = this.loadedMesh.mesh.geometry;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Rebuild the BVH to reflect animated geometry changes
    // three-mesh-bvh creates a new BVH when we assign to boundsTree
    geometry.boundsTree = new MeshBVH(geometry);
  }

  dispose(): void {
    super.dispose();
    this.meshSurface.dispose();
    if (this.animationMixer) {
      this.animationMixer.stopAllAction();
    }
  }
}
