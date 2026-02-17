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
  // REGRESSION GUARD: Camera position uses .copy() not .lerp() — S22: user explicitly demanded instant
  // position tracking. Position lag = camera lets player move before repositioning = user hates this.
  // History: s19 removed both lerps (jerky), s22 removed only position lerp (correct).
  private static readonly CAMERA_POSITION_LERP = 0.08; // kept for reference, not used
  // Up-vector: S22 programmatic tests showed velocity-damped lerp caused CV=3.56 orientation variance
  // and 8 jerk frames per 120-frame segment. Root cause: 0.15/(1+v*25) suppressed lerp during
  // movement, then "snapped" on recovery → user felt "nothing happens, then camera repositions."
  // Fix: camera.up.copy() directly from bitangent. Bitangent is stable after iteration 7
  // dual Gram-Schmidt fix, so no smoothing is needed. lookAt called AFTER up update.
  // Tests: CameraController.jerk.test.ts — must PASS with this approach.

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
    this.camera.position.copy(this._targetCamPos);

    // Sign-flip protection: prevent _camUp from flipping 180° relative to the
    // previous targetUp (possible at surface discontinuities or tangent frame resets).
    // This prevents a sudden movement direction reversal when the bitangent flips sign.
    if (this.targetUp.dot(this._camUp) < 0) {
      this._camUp.negate();
    }
    // Store raw (non-lerped) target up for movement upHint.
    // REGRESSION GUARD: targetUp uses .copy() not .lerp() — avoids double-lerp.
    // Double-lerping (lerping both targetUp AND camera.up) caused camera up-lurching
    // at triangle edge crossings. Matches bffc333 intent: upHint = raw computed camUp.
    this.targetUp.copy(this._camUp).normalize();

    // Moderate up-vector lerp (0.35): smooths frame-to-frame normal changes on curved surfaces
    // at 60 FPS without introducing the velocity-damped jerk from S22. Position is instant
    // (already .copy() above). targetUp stays .copy() for movement upHint — no double-lerp.
    // 0.35 converges within 2-3 frames at 60 FPS, preventing harsh/jittery camera on curved surfaces.
    // lookAt AFTER camera.up update so orientation uses the correct up vector.
    (this.camera as THREE.PerspectiveCamera).up.lerp(this._camUp, 0.35);
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
