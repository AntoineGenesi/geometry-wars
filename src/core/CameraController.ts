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
    this.camera.position.lerp(this._targetCamPos, this.CAMERA_LERP_FACTOR);

    // Save pre-lerp target up for MeshWalker.moveFromInput() upHint.
    // This gives stable camera axes without the oscillation from lerp lag.
    this.targetUp.copy(this._camUp);

    // Lerp camera.up BEFORE lookAt so lookAt uses the current-frame bitangent
    // direction. This prevents a one-frame lag in the camera's right/up axes
    // that caused movement direction jitter on curved surfaces.
    (this.camera as THREE.PerspectiveCamera).up.lerp(this._camUp, this.CAMERA_LERP_FACTOR).normalize();
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
