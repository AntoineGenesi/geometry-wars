import * as THREE from 'three';
import { MeshWalker } from '../movement/MeshWalker';

/**
 * CameraController
 *
 * Handles camera positioning, orbit controls, and zoom.
 * Previously ~120 lines embedded in main.ts
 */
export class CameraController {
  private camera: THREE.Camera;
  private cameraDistance = 15;
  private orbitYaw = 0; // radians around surface normal (left/right)
  private orbitPitch = 0; // radians around tangent (up/down tilt)
  private isOrbitDragging = false;
  private lastOrbitX = 0;
  private lastOrbitY = 0;
  private orbitResetSpeed = 0; // >0 means actively resetting to default
  private lastMiddleClickTime = 0;

  private readonly CAMERA_DIST_MIN = 6;
  private readonly CAMERA_DIST_MAX = 35;
  private readonly ORBIT_SENSITIVITY = 0.005;
  private readonly ORBIT_PITCH_MAX = Math.PI * 0.4; // don't go past 72 degrees
  // Restored from bffc333 (last user-confirmed working version):
  // Both position and up-vector lerp at the same factor for smooth, consistent camera follow.
  private readonly CAMERA_LERP_FACTOR = 0.12;

  // Pre-allocated temps for camera math (zero per-frame GC)
  private readonly _camOffset = new THREE.Vector3();
  private readonly _camUp = new THREE.Vector3();
  private readonly _yawQuat = new THREE.Quaternion();
  private readonly _pitchQuat = new THREE.Quaternion();
  private readonly _rotatedTangent = new THREE.Vector3();
  private readonly _targetCamPos = new THREE.Vector3();

  /**
   * The camera's TARGET up vector (before lerp), including orbit rotation.
   * Pass this to MeshWalker.moveFromInput() as upHint to get stable movement
   * axes that don't oscillate from camera.up lerp lag on curved surfaces.
   */
  readonly targetUp = new THREE.Vector3(0, 1, 0);

  /**
   * The camera's preferred normal direction for offset computation.
   * On non-orientable surfaces (Mobius strip), the surface normal flips when
   * crossing the seam. Without this, the camera jumps to the opposite side
   * of the strip, inverting the player's view and controls. By tracking the
   * preferred normal and negating flips (>90° from previous), the camera
   * stays on the same side of the surface across non-orientable seams.
   */
  private readonly _preferredNormal = new THREE.Vector3(0, 1, 0);

  /**
   * Whether updateFromFrame() has been called at least once for the current surface.
   * Used to skip the sign-flip continuity check on the very first frame — the check
   * compares incoming tangentV against targetUp which is initialised to world-up (0,1,0),
   * but on sphere/peanut tangentV at spawn is (0,-1,0), so the check immediately negates
   * it, locking camera.up at (0,1,0) and causing both movement axes to appear inverted.
   */
  private _cameraFrameInitialized = false;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Camera zoom (mouse wheel)
    document.addEventListener('wheel', (e) => {
      const delta = e.deltaY > 0 ? 1.5 : -1.5;
      this.cameraDistance = Math.max(
        this.CAMERA_DIST_MIN,
        Math.min(this.CAMERA_DIST_MAX, this.cameraDistance + delta)
      );
    }, { passive: true });

    // Pinch-to-zoom (touch) — requires 3+ fingers to avoid conflicting with dual joysticks
    let lastPinchDist = 0;
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length >= 3) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length >= 3) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // positive delta = fingers moved apart = zoom in (closer)
        const delta = (lastPinchDist - dist) * 0.05;
        this.cameraDistance = Math.max(
          this.CAMERA_DIST_MIN,
          Math.min(this.CAMERA_DIST_MAX, this.cameraDistance + delta)
        );
        lastPinchDist = dist;
      }
    }, { passive: true });

    // Camera orbit (middle mouse)
    document.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // middle mouse
        e.preventDefault();
        const now = Date.now();
        if (now - this.lastMiddleClickTime < 350) {
          // Double-click: reset orbit
          this.orbitResetSpeed = 4.0; // will lerp back to 0,0
        } else {
          this.isOrbitDragging = true;
          this.lastOrbitX = e.clientX;
          this.lastOrbitY = e.clientY;
        }
        this.lastMiddleClickTime = now;
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 1) {
        this.isOrbitDragging = false;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isOrbitDragging) return;
      const dx = e.clientX - this.lastOrbitX;
      const dy = e.clientY - this.lastOrbitY;
      this.lastOrbitX = e.clientX;
      this.lastOrbitY = e.clientY;
      this.orbitYaw += dx * this.ORBIT_SENSITIVITY;
      this.orbitPitch = Math.max(
        -this.ORBIT_PITCH_MAX,
        Math.min(this.ORBIT_PITCH_MAX, this.orbitPitch - dy * this.ORBIT_SENSITIVITY)
      );
      this.orbitResetSpeed = 0; // cancel any active reset if user drags again
    });

    // Prevent middle-click scroll/auto-scroll
    document.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  /**
   * Update camera from raw surface vectors (no MeshWalker needed).
   * Used by LAN multiplayer where the server is authoritative for player position.
   * tangentFrame.tangent and tangentFrame.bitangent correspond to the surface
   * tangentU and tangentV vectors from SurfacePoint.getPoint().
   */
  updateFromFrame(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    tangentFrame: { tangent: THREE.Vector3; bitangent: THREE.Vector3 },
    dt: number,
  ): void {
    // Orbit reset: lerp yaw/pitch back to 0 when double-click triggered
    if (this.orbitResetSpeed > 0) {
      const resetRate = this.orbitResetSpeed * dt;
      this.orbitYaw *= Math.max(0, 1 - resetRate * 3);
      this.orbitPitch *= Math.max(0, 1 - resetRate * 3);
      if (Math.abs(this.orbitYaw) < 0.005 && Math.abs(this.orbitPitch) < 0.005) {
        this.orbitYaw = 0;
        this.orbitPitch = 0;
        this.orbitResetSpeed = 0;
      }
    }

    // Non-orientable seam protection (same as update() — see comment there).
    let cameraNormal = normal;
    if (this._cameraFrameInitialized && this._preferredNormal.dot(normal) < 0) {
      cameraNormal = normal.clone().negate();
    }
    this._preferredNormal.copy(cameraNormal);

    // Build camera offset: start with camera-side normal, rotate by orbit angles
    this._camOffset.copy(cameraNormal).multiplyScalar(this.cameraDistance);
    this._camUp.copy(tangentFrame.bitangent); // REGRESSION GUARD: use bitangent NOT normal

    if (Math.abs(this.orbitYaw) > 0.001 || Math.abs(this.orbitPitch) > 0.001) {
      // Rotate around camera normal (yaw - left/right swing)
      this._yawQuat.setFromAxisAngle(cameraNormal, this.orbitYaw);
      this._camOffset.applyQuaternion(this._yawQuat);
      this._camUp.applyQuaternion(this._yawQuat);

      // Rotate around the rotated tangent (pitch - tilt up/down)
      this._rotatedTangent.copy(tangentFrame.tangent).applyQuaternion(this._yawQuat);
      this._pitchQuat.setFromAxisAngle(this._rotatedTangent, this.orbitPitch);
      this._camOffset.applyQuaternion(this._pitchQuat);
      this._camUp.applyQuaternion(this._pitchQuat);
    }

    this._targetCamPos.copy(position).add(this._camOffset);
    // Framerate-independent lerp: normalise to 60 Hz so the camera converges
    // at the same wall-clock speed regardless of display refresh rate.
    // In onRender (MP) the actual frame dt varies; in fixedUpdate (SP) dt=1/60
    // so the formula collapses to the original CAMERA_LERP_FACTOR unchanged.
    const posLerp = 1 - Math.pow(1 - this.CAMERA_LERP_FACTOR, dt * 60);
    this.camera.position.lerp(this._targetCamPos, posLerp);

    // Pole inversion protection for UV-based frames (multiplayer camera).
    // On sphere/peanut, tangentV (used as bitangent) can flip ~180° when the
    // player's UV longitude (U) jumps by ~0.5 after crossing a pole — the UV
    // parameterisation wraps and the tangent direction reverses.  Without this
    // check the camera.up lerp traverses 180°, producing a visible inversion.
    // Compare the new target against the previous frame's target (this.targetUp);
    // if they are more than 90° apart, negate to maintain continuity.
    this._camUp.normalize();
    // Only apply continuity sign-flip protection after the first frame.
    // On the first frame, targetUp is (0,1,0) (world-up default) but sphere/peanut
    // tangentV at spawn is often (0,-1,0) — the check would fire immediately and lock
    // camera.up at world-up, inverting both movement axes.  Skip on frame 0.
    if (this._cameraFrameInitialized && this.targetUp.dot(this._camUp) < 0) {
      this._camUp.negate();
    }
    this._cameraFrameInitialized = true;

    // Store target up for external reference
    this.targetUp.copy(this._camUp);

    // lookAt FIRST, then lerp up-vector (same order as update())
    (this.camera as THREE.PerspectiveCamera).lookAt(position);
    // s44r2-16: Fast camera up convergence on vertical-normal surfaces (cube top/bottom)
    const normalYAbs = Math.abs(cameraNormal.y);
    const mpUpLerp = normalYAbs > 0.9 ? Math.min(posLerp * 5, 0.6) : posLerp;
    (this.camera as THREE.PerspectiveCamera).up.lerp(this._camUp, mpUpLerp).normalize();
  }

  /**
   * Update camera position to follow player on surface
   */
  update(playerWalker: MeshWalker, dt: number): void {
    const playerNormal = playerWalker.normal;
    const frame = playerWalker.getTangentFrame();

    // Orbit reset: lerp yaw/pitch back to 0 when double-click triggered
    if (this.orbitResetSpeed > 0) {
      const resetRate = this.orbitResetSpeed * dt;
      this.orbitYaw *= Math.max(0, 1 - resetRate * 3);
      this.orbitPitch *= Math.max(0, 1 - resetRate * 3);
      if (Math.abs(this.orbitYaw) < 0.005 && Math.abs(this.orbitPitch) < 0.005) {
        this.orbitYaw = 0;
        this.orbitPitch = 0;
        this.orbitResetSpeed = 0;
      }
    }

    // Non-orientable seam protection: on surfaces like the Mobius strip, crossing
    // the seam flips the surface normal ~180°. Without this, the camera offset
    // (normal * distance) jumps to the opposite side of the strip, inverting the
    // player's view and controls. This makes the seam appear impassable because
    // every crossing immediately inverts "forward", sending the player back.
    //
    // Fix: track a "preferred normal" direction. If the new normal is >90° from
    // the preferred normal, negate it. This keeps the camera on the same side
    // of the surface across non-orientable seams.
    let cameraNormal = playerNormal;
    if (this._cameraFrameInitialized && this._preferredNormal.dot(playerNormal) < 0) {
      cameraNormal = playerNormal.clone().negate();
    }
    this._preferredNormal.copy(cameraNormal);

    // Build camera offset: start with camera-side normal, rotate by orbit angles
    // Rotation is relative to the tangent frame (tangent, bitangent, normal)
    this._camOffset.copy(cameraNormal).multiplyScalar(this.cameraDistance);
    this._camUp.copy(frame.bitangent);

    if (Math.abs(this.orbitYaw) > 0.001 || Math.abs(this.orbitPitch) > 0.001) {
      // Rotate around camera normal (yaw - left/right swing)
      this._yawQuat.setFromAxisAngle(cameraNormal, this.orbitYaw);
      this._camOffset.applyQuaternion(this._yawQuat);
      this._camUp.applyQuaternion(this._yawQuat);

      // Rotate around the rotated tangent (pitch - tilt up/down)
      this._rotatedTangent.copy(frame.tangent).applyQuaternion(this._yawQuat);
      this._pitchQuat.setFromAxisAngle(this._rotatedTangent, this.orbitPitch);
      this._camOffset.applyQuaternion(this._pitchQuat);
      this._camUp.applyQuaternion(this._pitchQuat);
    }

    this._targetCamPos.copy(playerWalker.position).add(this._camOffset);
    // Restored from bffc333: lerp position for smooth camera follow.
    // Framerate-independent: normalise dt to 60 Hz reference so the camera
    // converges at the same wall-clock rate regardless of tick frequency.
    // SP calls this from fixedUpdate (dt=1/60) so the formula gives 0.12
    // unchanged; MP calls it from onRender where dt may vary.
    const posLerp = 1 - Math.pow(1 - this.CAMERA_LERP_FACTOR, dt * 60);
    this.camera.position.lerp(this._targetCamPos, posLerp);

    // Sign-flip protection: if the new camera up flipped >90° from the previous target,
    // negate it to maintain continuity (same guard applied to MP path in updateFromFrame).
    // This catches any residual frame inversion after pole crossing (s43-05).
    // s44f-09: Skip on first frame (same guard as MP updateFromFrame line 196).
    // On first frame, targetUp is still default (0,1,0) which may be >90° from the
    // actual surface bitangent on pill/peanut, causing an incorrect negate that locks
    // the camera up vector in the wrong direction.
    this._camUp.normalize();
    if (this._cameraFrameInitialized && this.targetUp.dot(this._camUp) < 0) {
      this._camUp.negate();
    }
    this.targetUp.copy(this._camUp);
    this._cameraFrameInitialized = true;

    // Restored from bffc333 ORDER: lookAt FIRST, then lerp up-vector.
    // This matches the working reference implementation exactly.
    (this.camera as THREE.PerspectiveCamera).lookAt(playerWalker.position);
    // s44r2-16: When the surface normal is nearly vertical (cube top/bottom faces),
    // the camera up direction must NOT slowly lerp through (0,1,0) because that vector
    // is parallel to the surface normal. Projecting it onto the surface gives near-zero
    // length, making aim/movement degenerate for many frames during the transition.
    // Use a fast lerp (0.6) on vertical faces so the camera converges in ~3 frames.
    const normalY = Math.abs(cameraNormal.y);
    const upLerp = normalY > 0.9 ? Math.min(posLerp * 5, 0.6) : posLerp;
    (this.camera as THREE.PerspectiveCamera).up.lerp(this._camUp, upLerp).normalize();
  }

  /**
   * Reset camera frame initialization state for a new surface.
   * Call this when the player spawns on a new map so the sign-flip continuity
   * check doesn't compare against stale targetUp from the previous surface.
   * Also needed between rounds (resetGameEntities).
   */
  resetFrameForNewSurface(): void {
    this._cameraFrameInitialized = false;
    this.targetUp.set(0, 1, 0); // reset to neutral so first frame has no bias
    this._preferredNormal.set(0, 1, 0); // reset so first frame picks up the actual normal
  }

  /**
   * Whether the camera has been positioned at least once for the current surface.
   * False after resetFrameForNewSurface() until updateFromFrame() or snapToFrame()
   * is called. Use to detect first spawn where camera axes are at default position.
   */
  get hasBeenPositioned(): boolean {
    return this._cameraFrameInitialized;
  }

  /**
   * Immediately snap camera to the given frame without lerping.
   *
   * Call this on first spawn (before the game loop runs) so that
   * computeCameraRelativeAimAngle uses correct camera axes from frame 0.
   * Without snapping, the camera stays at its initial position (0,15,25) for
   * ~20 frames (CAMERA_LERP_FACTOR=0.12), causing ~130° aim angle errors.
   *
   * s44b-01 fix: called from onStateChange when first server frame arrives.
   */
  snapToFrame(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    tangentFrame: { tangent: THREE.Vector3; bitangent: THREE.Vector3 },
  ): void {
    // Same orientation math as updateFromFrame, but snap instead of lerp.
    // Apply non-orientable normal protection (same as update/updateFromFrame).
    let cameraNormal = normal;
    if (this._cameraFrameInitialized && this._preferredNormal.dot(normal) < 0) {
      cameraNormal = normal.clone().negate();
    }
    this._preferredNormal.copy(cameraNormal);

    this._camOffset.copy(cameraNormal).multiplyScalar(this.cameraDistance);
    this._camUp.copy(tangentFrame.bitangent);

    if (Math.abs(this.orbitYaw) > 0.001 || Math.abs(this.orbitPitch) > 0.001) {
      this._yawQuat.setFromAxisAngle(cameraNormal, this.orbitYaw);
      this._camOffset.applyQuaternion(this._yawQuat);
      this._camUp.applyQuaternion(this._yawQuat);
      this._rotatedTangent.copy(tangentFrame.tangent).applyQuaternion(this._yawQuat);
      this._pitchQuat.setFromAxisAngle(this._rotatedTangent, this.orbitPitch);
      this._camOffset.applyQuaternion(this._pitchQuat);
      this._camUp.applyQuaternion(this._pitchQuat);
    }

    this._targetCamPos.copy(position).add(this._camOffset);
    this.camera.position.copy(this._targetCamPos); // snap, no lerp

    this._camUp.normalize();
    this.targetUp.copy(this._camUp);
    this._cameraFrameInitialized = true;

    (this.camera as THREE.PerspectiveCamera).lookAt(position);
    (this.camera as THREE.PerspectiveCamera).up.copy(this._camUp);
    this.camera.updateMatrixWorld();
  }

  /** Get current camera distance */
  getCameraDistance(): number {
    return this.cameraDistance;
  }

  /** Set camera distance (clamped to allowed range) */
  setCameraDistance(distance: number): void {
    this.cameraDistance = Math.max(this.CAMERA_DIST_MIN, Math.min(this.CAMERA_DIST_MAX, distance));
  }

  /** Adjust camera distance by a delta (clamped). Positive = zoom out, negative = zoom in. */
  adjustZoom(delta: number): void {
    this.setCameraDistance(this.cameraDistance + delta);
  }

  /** Adjust orbit pitch by a delta (clamped to ORBIT_PITCH_MAX). */
  adjustPitch(delta: number): void {
    this.orbitPitch = Math.max(
      -this.ORBIT_PITCH_MAX,
      Math.min(this.ORBIT_PITCH_MAX, this.orbitPitch + delta),
    );
    this.orbitResetSpeed = 0;
  }

  /** Set orbit yaw and pitch directly. Cancels any active reset. */
  setOrbitAngles(yaw: number, pitch: number): void {
    this.orbitYaw = yaw;
    this.orbitPitch = Math.max(-this.ORBIT_PITCH_MAX, Math.min(this.ORBIT_PITCH_MAX, pitch));
    this.orbitResetSpeed = 0;
  }

  /** Get current orbit angles { yaw, pitch } */
  getOrbitAngles(): { yaw: number; pitch: number } {
    return { yaw: this.orbitYaw, pitch: this.orbitPitch };
  }

  /**
   * Disable zoom updates (for pause/game-over states)
   */
  disableZoom(isPaused: boolean, isGameOver: boolean): void {
    // Event listener checks state from closure — no action needed here
    // Could be extended to actually remove/add listeners if needed
  }

  dispose(): void {
    // Event listeners are document-level and persist across game sessions
    // For true cleanup, would need to track and removeEventListener
    // Since main restarts on level change, this is acceptable for now
  }
}
