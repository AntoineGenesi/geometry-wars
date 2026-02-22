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

  /**
   * Read-only reference to the internal tangent vector.
   * Zero-allocation access for hot paths. Do NOT modify.
   */
  get tangent(): THREE.Vector3 { return this._tangent; }

  /**
   * Read-only reference to the internal bitangent vector.
   * Zero-allocation access for hot paths. Do NOT modify.
   */
  get bitangent(): THREE.Vector3 { return this._bitangent; }

  /** Geodesic face position (face index + barycentric coordinates) */
  private _facePos: FacePosition;

  /** Movement speed in world units per second */
  speed: number;

  /** Visual mesh for this entity */
  mesh: THREE.Object3D | null = null;

  // Pre-allocated temp vectors for camera-relative input (zero per-frame GC)
  private readonly _camRight = new THREE.Vector3();
  private readonly _camUp = new THREE.Vector3();
  private readonly _moveDir = new THREE.Vector3();
  private readonly _worldQuat = new THREE.Quaternion();
  private readonly _camWorldPos = new THREE.Vector3();

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
   * Teleport the walker to a new position on the mesh surface.
   * Resets ALL internal state (position, normal, faceIndex, _facePos, tangent frame)
   * so that the next moveFromInput() call starts from the new location.
   *
   * Use this for respawns and instant position resets. Direct assignment to
   * `position`/`faceIndex` skips `_facePos` reinit, causing snap-back on first move.
   */
  teleportTo(point: THREE.Vector3, faceIndex: number, normal?: THREE.Vector3): void {
    this.position.copy(point);
    this.faceIndex = faceIndex;
    this._facePos = this.surface.initGeodesicPosition(point, faceIndex);

    if (normal) {
      this.normal.copy(normal);
    } else {
      // Recompute normal from the surface at this position
      const result = this.surface.closestPointOnSurface(point);
      if (result) {
        this.normal.copy(result.normal);
      }
    }
    this._updateTangentFrame(this.normal);
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
   * Get a smooth tangent frame using interpolated vertex normals.
   *
   * This eliminates direction drift caused by discontinuous face normals.
   * The smooth normal is computed by interpolating vertex normals at the
   * current barycentric position, then computing a stable bitangent.
   *
   * Use the returned bitangent as upHint in moveFromInput() to prevent
   * camera-relative input drift on curved surfaces.
   */
  getSmoothTangentFrame(): TangentFrame {
    const smoothNormal = this._getSmoothNormal();

    // Compute bitangent from smooth normal using existing tangent as reference.
    // Project existing tangent onto the smooth normal's tangent plane.
    const tangent = this._tangent.clone();
    tangent.addScaledVector(smoothNormal, -tangent.dot(smoothNormal));
    const tangentLen = tangent.length();

    if (tangentLen < 0.001) {
      // Fallback: tangent collapsed (shouldn't happen in practice)
      const frame = this.surface.getTangentFrame(smoothNormal);
      return {
        normal: smoothNormal,
        tangent: frame.tangent,
        bitangent: frame.bitangent,
      };
    }

    tangent.multiplyScalar(1 / tangentLen);
    const bitangent = new THREE.Vector3().crossVectors(tangent, smoothNormal).normalize();

    return {
      normal: smoothNormal,
      tangent,
      bitangent,
    };
  }

  /**
   * Get interpolated vertex normal at the current position.
   * Returns face normal as fallback if vertex normals aren't available.
   */
  private _getSmoothNormal(): THREE.Vector3 {
    const geometry = this.surface.mesh.geometry;
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | null;
    const indexAttr = geometry.index;

    if (!normalAttr || !indexAttr) {
      // No vertex normals - fall back to face normal
      return this.normal.clone();
    }

    const fi = this._facePos.faceIndex;
    const bary = this._facePos.bary;

    // Get vertex indices for this face
    const i0 = indexAttr.getX(fi * 3);
    const i1 = indexAttr.getX(fi * 3 + 1);
    const i2 = indexAttr.getX(fi * 3 + 2);

    // Get vertex normals
    const n0 = new THREE.Vector3().fromBufferAttribute(normalAttr, i0);
    const n1 = new THREE.Vector3().fromBufferAttribute(normalAttr, i1);
    const n2 = new THREE.Vector3().fromBufferAttribute(normalAttr, i2);

    // Interpolate using barycentric coordinates
    const smoothNormal = new THREE.Vector3()
      .addScaledVector(n0, bary.u)
      .addScaledVector(n1, bary.v)
      .addScaledVector(n2, bary.w);

    // Transform to world space
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.surface.mesh.matrixWorld);
    smoothNormal.applyMatrix3(normalMatrix).normalize();

    return smoothNormal;
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
  // REGRESSION GUARD — Iteration 7 rewrite (dual Gram-Schmidt):
  // Iterations 1-6 used the geodesic transported tangent + swap/sign logic.
  // The swap oscillated at ~45° movement angles: after a swap, the NEXT frame's
  // scores would flip back (keepScore≈0, swapScore≈2), causing the axes to toggle
  // every frame. This propagated to targetUp → camRight → movement direction,
  // causing lateral jerk and diagonal freeze.
  //
  // Approach: project old tangent onto the new tangent plane (Gram-Schmidt),
  // then DERIVE bitangent from cross product (n × tangent). This guarantees
  // bitangent is always exactly 90° from tangent — dual Gram-Schmidt on both
  // axes independently caused 90° frame rotations on cylindrical surfaces like
  // the pill, making W alternate between "up" and "sideways" on adjacent triangles.
  private _updateTangentFrame(newNormal: THREE.Vector3, _transportedTangent?: THREE.Vector3): void {
    const n = newNormal.clone().normalize();

    // Store old tangent for sign-flip detection
    const oldTangent = this._tangent.clone();

    // Project old tangent onto new tangent plane (Gram-Schmidt)
    const dotT = this._tangent.dot(n);
    this._tangent.addScaledVector(n, -dotT);
    const tangentLen = this._tangent.length();

    if (tangentLen < 0.001) {
      // Tangent collapsed (normal flipped ~90°) — fall back to surface method
      const fallback = this.surface.getTangentFrame(n);
      this._tangent.copy(fallback.tangent);
      this._bitangent.crossVectors(n, this._tangent).normalize();
      return;
    }
    this._tangent.multiplyScalar(1 / tangentLen);

    // Sign-flip protection on tangent: prevents 180° flip of primary axis
    if (oldTangent.dot(this._tangent) < 0) {
      this._tangent.negate();
    }

    // Derive bitangent from cross product: bitangent = n × tangent
    // This always produces a bitangent exactly 90° from tangent, eliminating
    // the frame inconsistency on cylindrical/spherical surfaces (pill bug).
    this._bitangent.crossVectors(n, this._tangent).normalize();
  }

  /**
   * Move using screen-space input (WASD-style).
   * Uses CAMERA-RELATIVE axes: projects the camera's right and up vectors
   * onto the surface tangent plane so WASD always matches what the player
   * sees on screen, even when the camera orbits.
   *
   * Falls back to tangent-frame-direct mapping only when the camera axes
   * project to near-zero on the tangent plane (camera looking edge-on at surface).
   *
   * @param inputX - Horizontal input (-1 to 1, A/D or left/right stick)
   * @param inputY - Vertical input (-1 to 1, positive = visual "up" on screen)
   * @param camera - The camera (used to extract screen-space axes)
   * @param dt - Delta time
   * @param upHint - Optional pre-lerp camera up vector. When provided, computes
   *   camera axes from camera world position + upHint instead of camera.getWorldQuaternion.
   *   This eliminates frame-to-frame oscillation caused by camera.up lerp lag on
   *   curved surfaces. Pass CameraController.targetUp or walker tangent frame bitangent.
   */
  moveFromInput(
    inputX: number,
    inputY: number,
    camera: THREE.Camera,
    dt: number,
    upHint?: THREE.Vector3,
  ): SurfaceQueryResult | null {
    if (Math.abs(inputX) < 0.01 && Math.abs(inputY) < 0.01) return null;

    const camRight = this._camRight;
    const camUp = this._camUp;

    if (upHint) {
      // Stable path: compute camera axes from actual camera position + ideal up.
      // Avoids oscillation from the camera's lerped up vector (which lags behind
      // the actual surface orientation on curved surfaces at 60 FPS).
      this._computeStableCameraAxes(camera, upHint, camRight, camUp);
    } else {
      // Legacy path: extract from camera's actual world quaternion.
      // Used by tests that don't provide upHint.
      const worldQuat = camera.getWorldQuaternion(this._worldQuat);
      camRight.set(1, 0, 0).applyQuaternion(worldQuat);
      camUp.set(0, 1, 0).applyQuaternion(worldQuat);
    }

    const n = this.normal;
    camRight.addScaledVector(n, -camRight.dot(n));
    camUp.addScaledVector(n, -camUp.dot(n));

    const rightLen = camRight.length();
    const upLen = camUp.length();

    if (rightLen < 0.001 || upLen < 0.001) {
      // Degenerate projection (camera axis parallel to surface normal).
      // Fall back to tangent frame.
      const moveDir = this._moveDir
        .set(0, 0, 0)
        .addScaledVector(this._tangent, inputX)
        .addScaledVector(this._bitangent, inputY);
      if (moveDir.lengthSq() < 0.0001) return null;
      return this.move(moveDir, dt);
    }

    camRight.multiplyScalar(1 / rightLen);
    camUp.multiplyScalar(1 / upLen);

    // Build movement direction from camera-relative screen axes
    const moveDir = this._moveDir
      .set(0, 0, 0)
      .addScaledVector(camRight, inputX)
      .addScaledVector(camUp, inputY);

    if (moveDir.lengthSq() < 0.0001) return null;

    return this.move(moveDir, dt);
  }

  /**
   * Compute aim direction from screen-space input.
   * Uses camera-relative axes (same projection as moveFromInput) so aiming
   * always matches what the player sees on screen.
   *
   * @param aimX - Horizontal aim (-1 to 1, mouse delta or right stick)
   * @param aimY - Vertical aim (-1 to 1, positive = screen down in raw mouse coords)
   * @param camera - The camera (used to extract screen-space axes)
   * @param upHint - Optional pre-lerp camera up vector (same as moveFromInput)
   * @returns World-space aim direction on the surface tangent plane
   */
  getAimDirection(
    aimX: number,
    aimY: number,
    camera: THREE.Camera,
    upHint?: THREE.Vector3,
  ): THREE.Vector3 {
    const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);
    if (aimLen < 0.01) {
      return this._bitangent.clone();
    }

    const camRight = this._camRight;
    const camUp = this._camUp;

    if (upHint) {
      this._computeStableCameraAxes(camera, upHint, camRight, camUp);
    } else {
      const worldQuat = camera.getWorldQuaternion(this._worldQuat);
      camRight.set(1, 0, 0).applyQuaternion(worldQuat);
      camUp.set(0, 1, 0).applyQuaternion(worldQuat);
    }

    const n = this.normal;
    camRight.addScaledVector(n, -camRight.dot(n));
    camUp.addScaledVector(n, -camUp.dot(n));

    const rightLen = camRight.length();
    const upLen = camUp.length();

    if (rightLen < 0.001 || upLen < 0.001) {
      // Degenerate projection: fall back to tangent frame
      const aimDir = new THREE.Vector3()
        .addScaledVector(this._tangent, aimX)
        .addScaledVector(this._bitangent, -aimY);
      const len = aimDir.length();
      if (len < 0.0001) return this._bitangent.clone();
      return aimDir.multiplyScalar(1 / len);
    }

    camRight.multiplyScalar(1 / rightLen);
    camUp.multiplyScalar(1 / upLen);

    // aimX → screen right (camera right projected)
    // -aimY → screen up (negate because raw mouse Y increases downward)
    // FIXED: Removed incorrect aimX negation that caused mirrored gun direction.
    // Mouse left should aim left, not right. The negation added in commit fdd0423
    // was incorrect and caused bullets to fire in the mirror of the mouse direction.
    const aimDir = new THREE.Vector3()
      .addScaledVector(camRight, aimX)
      .addScaledVector(camUp, -aimY);

    const len = aimDir.length();
    if (len < 0.0001) return this._bitangent.clone();
    return aimDir.multiplyScalar(1 / len);
  }

  /**
   * Compute stable camera right/up axes from camera world position + ideal up vector.
   * Uses the same lookAt convention as Three.js (z = eye - target, x = cross(up, z),
   * y = cross(z, x)) but with the ACTUAL up hint (no lerp) for frame-stable results.
   *
   * This eliminates the oscillation caused by camera.up lerp lag: the camera's lerped
   * up vector lags behind the surface bitangent on curved surfaces, causing the
   * extracted right/up to jitter at 60 FPS. Using the pre-lerp target up (upHint)
   * gives instant, stable axes that exactly match the ideal screen directions.
   */
  private _computeStableCameraAxes(
    camera: THREE.Camera,
    upHint: THREE.Vector3,
    outRight: THREE.Vector3,
    outUp: THREE.Vector3,
  ): void {
    // z = normalize(eye - target) — camera-to-player direction
    const camWorldPos = camera.getWorldPosition(this._camWorldPos);
    const z = this._moveDir.copy(camWorldPos).sub(this.position);
    const zLen = z.length();

    if (zLen < 0.001) {
      // Camera at player position — degenerate, use tangent frame
      outRight.crossVectors(this._bitangent, this.normal).normalize();
      outUp.copy(this._bitangent);
      return;
    }
    z.multiplyScalar(1 / zLen);

    // right = normalize(upHint × z) — Three.js lookAt convention
    outRight.crossVectors(upHint, z);
    const rLen = outRight.length();

    if (rLen < 0.001) {
      // upHint is parallel to z — degenerate, use tangent frame
      outRight.crossVectors(this._bitangent, this.normal).normalize();
      outUp.copy(this._bitangent);
      return;
    }
    outRight.multiplyScalar(1 / rLen);

    // up = normalize(z × right) — corrected up perpendicular to both z and right
    outUp.crossVectors(z, outRight).normalize();
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
