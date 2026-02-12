/**
 * MeshWalker - An entity that walks on any mesh surface.
 *
 * Replaces the UV-based player/enemy movement system.
 * Key properties:
 * - Speed is in world units per second (constant everywhere)
 * - No UV coordinates, no shape-specific code
 * - Works on sphere, torus, cube, cup, statue, anything
 * - No pole singularities or speed distortions
 *
 * Internally uses geodesic face walking (HalfEdgeMesh + FaceWalker)
 * for movement with parallel transport across edges. Falls back to
 * BVH snap-to-surface only for initialization and recovery.
 */

import * as THREE from 'three';
import { MeshSurface, SurfaceQueryResult, TangentFrame, FacePosition } from '../surfaces/MeshSurface';

export interface WalkerState {
  /** Current position on the mesh surface (world space) */
  position: THREE.Vector3;
  /** Surface normal at current position */
  normal: THREE.Vector3;
  /** Tangent frame at current position */
  tangentFrame: TangentFrame;
  /** Current face index on the mesh */
  faceIndex: number;
}

export class MeshWalker {
  readonly surface: MeshSurface;

  /** Current state on the surface */
  position: THREE.Vector3;
  normal: THREE.Vector3;
  faceIndex: number;

  /** Persistent tangent frame that smoothly rotates with the surface.
   *  Avoids the discontinuity of recomputing from scratch each frame. */
  private _tangent: THREE.Vector3;
  private _bitangent: THREE.Vector3;

  /** Geodesic face position (face index + barycentric coordinates) */
  private _facePos: FacePosition;

  /** Movement speed in world units per second */
  speed: number;

  /** Visual mesh for this entity */
  mesh: THREE.Object3D | null = null;

  constructor(surface: MeshSurface, startPos: THREE.Vector3, speed: number) {
    this.surface = surface;
    this.speed = speed;

    // Project starting position onto surface via BVH
    const result = surface.closestPointOnSurface(startPos);
    if (result) {
      this.position = result.point.clone();
      this.normal = result.normal.clone();
      this.faceIndex = result.faceIndex;
    } else {
      this.position = startPos.clone();
      this.normal = new THREE.Vector3(0, 1, 0);
      this.faceIndex = 0;
    }

    // Initialize geodesic face position
    this._facePos = surface.initGeodesicPosition(this.position, this.faceIndex);

    // Initialize tangent frame
    const frame = surface.getTangentFrame(this.normal);
    this._tangent = frame.tangent.clone();
    this._bitangent = frame.bitangent.clone();
  }

  /**
   * Get the current tangent frame at the walker's position.
   * Uses the persistent tangent that smoothly rotates with the surface,
   * avoiding discontinuities on shapes like torus.
   */
  getTangentFrame(): TangentFrame {
    return {
      normal: this.normal.clone(),
      tangent: this._tangent.clone(),
      bitangent: this._bitangent.clone(),
    };
  }

  /**
   * Move the walker on the surface.
   *
   * @param moveDir - Desired movement direction in WORLD SPACE
   * @param dt - Delta time in seconds
   * @returns The new surface query result, or null if movement failed
   */
  move(moveDir: THREE.Vector3, dt: number): SurfaceQueryResult | null {
    const distance = this.speed * dt;
    if (distance < 1e-6) return null;

    // Project moveDir onto surface tangent plane
    const n = this.normal;
    const dotN = moveDir.dot(n);
    const projDir = moveDir.clone().addScaledVector(n, -dotN);
    const projLen = projDir.length();

    if (projLen < 0.0001) {
      // moveDir is parallel to normal - try using tangent frame components
      const tDot = moveDir.dot(this._tangent);
      const bDot = moveDir.dot(this._bitangent);
      const inPlaneLen = Math.sqrt(tDot * tDot + bDot * bDot);

      if (inPlaneLen < 0.01) {
        return null; // Truly perpendicular to surface, can't move
      }

      projDir.copy(this._tangent).multiplyScalar(tDot)
        .addScaledVector(this._bitangent, bDot)
        .normalize();
    } else {
      projDir.multiplyScalar(1 / projLen);
    }

    // Walk geodesically
    const geoResult = this.surface.moveGeodesic(this._facePos, projDir, distance);

    if (geoResult.distanceTraveled < distance * 0.05) {
      // Geodesic walk made almost no progress (boundary, degenerate face, etc.)
      // Fall back to BVH snap-to-surface for the full distance
      return this._fallbackMove(moveDir, distance);
    }

    // NaN guard: if geodesic produced invalid result, fall back to BVH
    if (isNaN(geoResult.position.x) || isNaN(geoResult.position.y) || isNaN(geoResult.position.z) ||
        isNaN(geoResult.normal.x) || isNaN(geoResult.normal.y) || isNaN(geoResult.normal.z)) {
      return this._fallbackMove(moveDir, distance);
    }

    // Apply geodesic result
    this._facePos = geoResult.facePosition;
    this.position.copy(geoResult.position);
    this.faceIndex = geoResult.faceIndex;

    // Update tangent frame using parallel-transported direction from geodesic
    this._updateTangentFrame(geoResult.normal, geoResult.direction);
    this.normal.copy(geoResult.normal);

    // If geodesic walk only covered part of the distance, use BVH for the remainder
    const remainingDist = distance - geoResult.distanceTraveled;
    if (remainingDist > distance * 0.1) {
      const bvhResult = this.surface.moveOnSurface(
        this.position,
        this.normal,
        geoResult.direction,
        remainingDist,
      );
      if (bvhResult && this.position.distanceTo(bvhResult.point) > remainingDist * 0.05) {
        this.position.copy(bvhResult.point);
        this._updateTangentFrame(bvhResult.normal);
        this.normal.copy(bvhResult.normal);
        this.faceIndex = bvhResult.faceIndex;
        this._facePos = this.surface.initGeodesicPosition(bvhResult.point, bvhResult.faceIndex);
      }
    }

    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.alignToSurface();
    }

    return {
      point: this.position.clone(),
      normal: this.normal.clone(),
      distance: geoResult.distanceTraveled,
      faceIndex: this.faceIndex,
    };
  }

  /**
   * Fallback to BVH-based movement when geodesic walk fails.
   * This handles edge cases like boundary edges, degenerate triangles, etc.
   * Tries multiple strategies: direct BVH, tangent-frame decomposition, then fallback axes.
   */
  private _fallbackMove(moveDir: THREE.Vector3, distance: number): SurfaceQueryResult | null {
    // Strategy 1: Direct BVH snap-to-surface
    const result = this.surface.moveOnSurface(
      this.position,
      this.normal,
      moveDir,
      distance,
    );

    if (result && this.position.distanceTo(result.point) > distance * 0.05) {
      return this._applyBvhResult(result);
    }

    // Strategy 2: Decompose into tangent frame (helps when moveDir is nearly parallel to normal)
    const tDot = moveDir.dot(this._tangent);
    const bDot = moveDir.dot(this._bitangent);
    const inPlaneLen = Math.sqrt(tDot * tDot + bDot * bDot);

    if (inPlaneLen > 0.01) {
      const onSurfaceDir = this._tangent.clone().multiplyScalar(tDot)
        .add(this._bitangent.clone().multiplyScalar(bDot))
        .normalize();

      const retryResult = this.surface.moveOnSurface(
        this.position,
        this.normal,
        onSurfaceDir,
        distance,
      );

      if (retryResult && this.position.distanceTo(retryResult.point) > distance * 0.05) {
        return this._applyBvhResult(retryResult);
      }
    }

    // Strategy 3: Try tangent and bitangent as fallback directions
    const tangentResult = this.surface.moveOnSurface(
      this.position,
      this.normal,
      this._tangent,
      distance,
    );
    if (tangentResult && this.position.distanceTo(tangentResult.point) > distance * 0.05) {
      return this._applyBvhResult(tangentResult);
    }

    const bitangentResult = this.surface.moveOnSurface(
      this.position,
      this.normal,
      this._bitangent,
      distance,
    );
    if (bitangentResult && this.position.distanceTo(bitangentResult.point) > distance * 0.05) {
      return this._applyBvhResult(bitangentResult);
    }

    // If nothing worked, just apply whatever result we got
    if (result) {
      return this._applyBvhResult(result);
    }
    return null;
  }

  /**
   * Apply a BVH surface query result and re-sync geodesic state.
   */
  private _applyBvhResult(result: SurfaceQueryResult): SurfaceQueryResult {
    this.position.copy(result.point);
    this._updateTangentFrame(result.normal);
    this.normal.copy(result.normal);
    this.faceIndex = result.faceIndex;
    this._facePos = this.surface.initGeodesicPosition(result.point, result.faceIndex);

    if (this.mesh) {
      this.mesh.position.copy(result.point);
      this.alignToSurface();
    }
    return result;
  }

  /**
   * Update the persistent tangent frame after the normal changes.
   *
   * When a transported tangent is provided (from geodesic walking), use it directly.
   * This gives true parallel transport and avoids discontinuities at sharp edges.
   *
   * When no transported tangent is available (BVH fallback), project the old tangent
   * onto the new normal's plane using Gram-Schmidt. This is less accurate but works
   * for surfaces without geodesic support.
   *
   * @param newNormal - The new surface normal
   * @param transportedTangent - Optional parallel-transported tangent from geodesic walk
   */
  private _updateTangentFrame(newNormal: THREE.Vector3, transportedTangent?: THREE.Vector3): void {
    const n = newNormal.clone().normalize();

    if (transportedTangent) {
      // Use the parallel-transported tangent from geodesic walking.
      // This is the "natural" tangent direction along the geodesic path.
      let newTangent = transportedTangent.clone().normalize();

      // Project onto tangent plane (remove any normal component due to numerical error)
      const dotN = newTangent.dot(n);
      newTangent.addScaledVector(n, -dotN).normalize();

      // Recompute the perpendicular direction from cross product (right-handed: bitangent = tangent × normal)
      let newBitangent = new THREE.Vector3().crossVectors(newTangent, n).normalize();

      // The transported tangent from geodesic is the tangent TO THE PATH, not necessarily
      // aligned with our frame's "tangent" axis. When moving along the bitangent direction,
      // the path tangent IS the bitangent. We need to maintain consistent axis assignment
      // across frames to avoid swapping.
      //
      // Check which assignment maintains better continuity:
      // Option A: keep as-is (tangent=newTangent, bitangent=newBitangent)
      // Option B: swap them (tangent=newBitangent, bitangent=newTangent)
      const dotTT = Math.abs(newTangent.dot(this._tangent));
      const dotBB = Math.abs(newBitangent.dot(this._bitangent));
      const dotTB = Math.abs(newTangent.dot(this._bitangent));
      const dotBT = Math.abs(newBitangent.dot(this._tangent));

      const keepScore = dotTT + dotBB;  // tangent stays tangent, bitangent stays bitangent
      const swapScore = dotTB + dotBT;  // tangent becomes bitangent, bitangent becomes tangent

      if (swapScore > keepScore) {
        // Swap them to maintain axis roles
        const temp = newTangent;
        newTangent = newBitangent;
        newBitangent = temp;
      }

      // Now apply sign continuity to maintain direction
      if (newTangent.dot(this._tangent) < 0) {
        newTangent.negate();
      }
      if (newBitangent.dot(this._bitangent) < 0) {
        newBitangent.negate();
      }

      this._tangent.copy(newTangent);
      this._bitangent.copy(newBitangent);
      return;
    }

    // Fallback: Gram-Schmidt projection for BVH-based movement
    // Project old tangent onto new tangent plane (Gram-Schmidt against new normal)
    const dot = this._tangent.dot(n);
    this._tangent.sub(n.clone().multiplyScalar(dot));

    const tangentLen = this._tangent.length();
    if (tangentLen < 0.001) {
      // Tangent collapsed (normal did a 90-degree flip) - fall back to surface method
      const fallback = this.surface.getTangentFrame(n);
      this._tangent.copy(fallback.tangent);
      this._bitangent.copy(fallback.bitangent);
      return;
    }

    this._tangent.multiplyScalar(1 / tangentLen);

    // Recompute bitangent from cross product (right-handed: bitangent = tangent × normal)
    this._bitangent.crossVectors(this._tangent, n).normalize();
  }

  /**
   * Move using screen-space input (WASD-style).
   * Maps screen-space input to the walker's tangent frame.
   *
   * The camera looks along the surface normal (from above the surface down
   * at the player).  Its "up" is set to the walker's bitangent each frame,
   * so the visual axes on screen correspond directly to the tangent frame:
   *   - screen right  = walker tangent
   *   - screen up     = walker bitangent
   *
   * Projecting the camera's own basis vectors onto the tangent plane fails
   * because the camera's forward (-Z) is nearly parallel to the surface
   * normal, producing a near-zero on-surface vector.  Using the tangent
   * frame directly avoids this entirely.
   *
   * @param inputX - Horizontal input (-1 to 1, A/D or left/right stick)
   * @param inputY - Vertical input (-1 to 1, positive = visual "up" on screen)
   * @param _camera - The camera (kept for API compatibility; not used)
   * @param dt - Delta time
   */
  moveFromInput(
    inputX: number,
    inputY: number,
    _camera: THREE.Camera,
    dt: number,
  ): SurfaceQueryResult | null {
    if (Math.abs(inputX) < 0.01 && Math.abs(inputY) < 0.01) return null;

    // Map screen axes directly to the walker's persistent tangent frame.
    // tangent  = screen right  (D = +inputX, A = -inputX)
    // bitangent = screen up    (W = +inputY after call-site negation, S = -inputY)
    const moveDir = new THREE.Vector3()
      .addScaledVector(this._tangent, inputX)
      .addScaledVector(this._bitangent, inputY);

    if (moveDir.lengthSq() < 0.0001) return null;

    return this.move(moveDir, dt);
  }

  /**
   * Compute aim direction from screen-space input.
   * Maps screen-space aim to the walker's tangent frame, same as moveFromInput.
   *
   * @param aimX - Horizontal aim (-1 to 1, mouse delta or right stick)
   * @param aimY - Vertical aim (-1 to 1, positive = screen down in raw mouse coords)
   * @param _camera - The camera (kept for API compatibility; not used)
   * @returns World-space aim direction on the surface tangent plane
   */
  getAimDirection(
    aimX: number,
    aimY: number,
    _camera: THREE.Camera,
  ): THREE.Vector3 {
    const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);
    if (aimLen < 0.01) {
      // Default: aim along bitangent (screen up)
      return this._bitangent.clone();
    }

    // Map screen axes to tangent frame.
    // tangent   = screen right  (+aimX)
    // bitangent = screen up     (-aimY, because raw mouse Y increases downward)
    const aimDir = new THREE.Vector3()
      .addScaledVector(this._tangent, aimX)
      .addScaledVector(this._bitangent, -aimY);

    const len = aimDir.length();
    if (len < 0.0001) {
      return this._bitangent.clone();
    }

    return aimDir.normalize();
  }

  /**
   * Align the visual mesh to the surface normal.
   * The mesh "stands up" on the surface with its Y axis along the normal.
   */
  alignToSurface(): void {
    if (!this.mesh) return;

    const frame = this.getTangentFrame();
    const rotMatrix = new THREE.Matrix4().makeBasis(
      frame.tangent,
      frame.normal,
      frame.bitangent,
    );
    this.mesh.quaternion.setFromRotationMatrix(rotMatrix);
  }

  /**
   * Orient the visual mesh to face a given direction on the surface.
   * Used for player facing aim direction.
   */
  faceDirection(direction: THREE.Vector3): void {
    if (!this.mesh) return;

    const normal = this.normal.clone().normalize();
    const forward = direction.clone();

    // Ensure forward is on the tangent plane
    forward.sub(normal.clone().multiplyScalar(forward.dot(normal))).normalize();
    if (forward.lengthSq() < 0.001) return;

    const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
    this.mesh.quaternion.setFromRotationMatrix(rotMatrix);
  }

  /**
   * Get visibility (0-1) relative to camera.
   * Used for depth-based opacity of far-side entities.
   */
  getVisibility(cameraPos: THREE.Vector3): number {
    return this.surface.getVisibility(this.position, this.normal, cameraPos);
  }

  /**
   * Get the state for serialization or debugging.
   */
  getState(): WalkerState {
    return {
      position: this.position.clone(),
      normal: this.normal.clone(),
      tangentFrame: this.getTangentFrame(),
      faceIndex: this.faceIndex,
    };
  }
}
