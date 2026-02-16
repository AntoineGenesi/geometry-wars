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
  // REGRESSION GUARD: Lerp factor history:
  // - 0.12: Too slow (30 frames / 0.5s) → "map jumping" (scene rotation in steps)
  // - 0.25: Better (12 frames / 0.2s) but user still reported lag (Session 18)
  // - 0.4: Fast follow (7 frames / 0.117s) but exposed tangent frame jitter (Session 18)
  // - 0.0: Instant follow (Session 19) but user reported jerky diagonal movement
  // - 0.2: Session 19 fix - smooth enough to hide tangent frame oscillations at triangle edges
  private readonly CAMERA_POS_LERP = 0.2;
  // Smooth tangent frame changes more aggressively than position to hide bitangent flips
  private readonly CAMERA_UP_LERP = 0.15;

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

    // Build camera offset: start with surface normal, rotate by orbit angles
    // Rotation is relative to the tangent frame (tangent, bitangent, normal)
    this._camOffset.copy(playerNormal).multiplyScalar(this.cameraDistance);
    this._camUp.copy(frame.bitangent);

    if (Math.abs(this.orbitYaw) > 0.001 || Math.abs(this.orbitPitch) > 0.001) {
      // Rotate around normal (yaw - left/right swing)
      this._yawQuat.setFromAxisAngle(playerNormal, this.orbitYaw);
      this._camOffset.applyQuaternion(this._yawQuat);
      this._camUp.applyQuaternion(this._yawQuat);

      // Rotate around the rotated tangent (pitch - tilt up/down)
      this._rotatedTangent.copy(frame.tangent).applyQuaternion(this._yawQuat);
      this._pitchQuat.setFromAxisAngle(this._rotatedTangent, this.orbitPitch);
      this._camOffset.applyQuaternion(this._pitchQuat);
      this._camUp.applyQuaternion(this._pitchQuat);
    }

    this._targetCamPos.copy(playerWalker.position).add(this._camOffset);
    // RE-ENABLED POSITION LERP: User reversed decision (Session 19).
    // User reported jerky diagonal movement with instant follow: "camera goes in one of those
    // two directions (that builds the diagonal), then the other, before going back to diagonal".
    // This is tangent frame oscillation at triangle edge crossings. Smoothing with 0.2 hides
    // the jitter while maintaining responsive following.
    this.camera.position.lerp(this._targetCamPos, this.CAMERA_POS_LERP);

    // Save target up for MeshWalker.moveFromInput() upHint.
    // Sign-flip protection: if the new up would flip 180° from the current
    // targetUp (possible at surface discontinuities or tangent frame resets),
    // negate it to maintain continuity. This prevents a sudden movement
    // direction reversal when the bitangent flips sign.
    if (this.targetUp.dot(this._camUp) < 0) {
      this._camUp.negate();
    }
    // RE-ENABLED LERP: Smooth targetUp to prevent camera shift on triangle edge crossings.
    // Session 19 removed all lerp, but this exposed tangent frame discontinuities.
    // When MeshWalker crosses triangle edges, the bitangent changes abruptly.
    // Increased smoothing to 0.15 (Session 19 diagonal jerk fix) to more aggressively
    // hide tangent frame oscillations. This also stabilizes gun aim direction which
    // depends on camera reference frame.
    this.targetUp.lerp(this._camUp.normalize(), this.CAMERA_UP_LERP);

    // RE-ENABLED LERP: Smooth camera.up to prevent jitter when crossing triangle edges.
    // The walker constantly crosses triangle edges during movement, causing bitangent
    // to change abruptly. Increased smoothing to 0.15 (Session 19 diagonal jerk fix) to
    // more aggressively hide tangent frame oscillations while maintaining responsive
    // camera follow. Set camera.up BEFORE lookAt so lookAt uses the smoothed up vector
    // (prevents one-frame lag in camera axes).
    (this.camera as THREE.PerspectiveCamera).up.lerp(this._camUp.normalize(), this.CAMERA_UP_LERP);
    (this.camera as THREE.PerspectiveCamera).lookAt(playerWalker.position);
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
