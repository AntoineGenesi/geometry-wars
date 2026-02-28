import * as THREE from 'three';

/**
 * Compute the LAN MP aim angle in surface UV space, corrected for camera-frame
 * vs surface-tangent-frame misalignment.
 *
 * Problem: The naive formula `atan2(-mouseY, mouseX)` assumes camera.right == tangentU
 * and camera.up == tangentV. This breaks when:
 *   - Camera is orbited via middle mouse (orbitYaw ≠ 0)
 *   - Camera lerp lags behind the surface tangent frame
 *
 * Fix: Project the camera's actual right/up vectors onto the surface tangent plane,
 * compute the world-space aim direction from mouse input, then project onto tangentU/V
 * to get the UV-space angle. This matches how GameLoop.ts SP computes aim (lines 233-251).
 *
 * @param mouseX   - Normalised mouse X (aimX from InputState), positive = right of screen
 * @param mouseY   - Normalised mouse Y (aimY from InputState), positive = below screen
 * @param camRight - Camera's world-space right vector (column 0 of camera.matrixWorld)
 * @param camUp    - Camera's world-space up vector (column 1 of camera.matrixWorld)
 * @param normal   - Surface normal at the player's position (world space)
 * @param tangentU - Surface tangentU at the player's position (world space)
 * @param tangentV - Surface tangentV at the player's position (world space)
 * @returns Aim angle in surface UV space, in radians
 */
export function computeCameraRelativeAimAngle(
  mouseX: number,
  mouseY: number,
  camRight: THREE.Vector3,
  camUp: THREE.Vector3,
  normal: THREE.Vector3,
  tangentU: THREE.Vector3,
  tangentV: THREE.Vector3,
): number {
  // Project camera axes onto the surface tangent plane (remove normal component)
  const right = camRight.clone().addScaledVector(normal, -camRight.dot(normal));
  const up = camUp.clone().addScaledVector(normal, -camUp.dot(normal));

  // Degenerate guard: if camera is looking edge-on at surface, fall back to screen-space formula
  if (right.lengthSq() < 0.01 || up.lengthSq() < 0.01) {
    return Math.atan2(-mouseY, mouseX);
  }

  right.normalize();
  up.normalize();

  // World-space aim direction: mouseX along camRight, -mouseY along camUp
  // (mouseY is positive down screen, so -mouseY = up on screen)
  const aimDir = right.clone().multiplyScalar(mouseX).addScaledVector(up, -mouseY);

  if (aimDir.lengthSq() < 0.0001) {
    return Math.atan2(-mouseY, mouseX); // fallback for zero input
  }

  // Project onto surface UV frame to get the UV-space angle
  return Math.atan2(aimDir.dot(tangentV), aimDir.dot(tangentU));
}
