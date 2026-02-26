import * as THREE from 'three';

// Pre-allocated temps for updateSpawnIndicator (zero per-frame allocations)
const _indicatorInvQ = new THREE.Quaternion();
const _indicatorLocalUp = new THREE.Vector3();

/**
 * Creates a flashing downward-pointing arrow sprite to appear above pickups
 * for the first 30 seconds after spawning. Helps players distinguish pickups
 * from enemies at a glance.
 *
 * Returns a Sprite named 'spawn-indicator' at local position (0, 0, 0.9).
 * Pass camera.up to updateSpawnIndicator() each frame to position it correctly
 * above the pickup in screen space regardless of surface orientation.
 */
export function createSpawnIndicatorSprite(tint: THREE.Color = new THREE.Color(0xffffff)): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;

  const r = Math.round(tint.r * 255);
  const g = Math.round(tint.g * 255);
  const b = Math.round(tint.b * 255);

  // Outer glow (soft halo)
  const glowGrad = ctx.createRadialGradient(32, 40, 4, 32, 40, 30);
  glowGrad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
  glowGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, 64, 80);

  // Bright arrow body
  ctx.fillStyle = `rgb(${r},${g},${b})`;

  // Shaft (top portion) — wider for visibility
  ctx.fillRect(22, 4, 20, 36);

  // Arrowhead (bottom triangle) — larger
  ctx.beginPath();
  ctx.moveTo(32, 76); // tip
  ctx.lineTo(6, 36);  // left
  ctx.lineTo(58, 36); // right
  ctx.closePath();
  ctx.fill();

  // Bright white highlight on shaft for contrast
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(27, 4, 10, 30);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const sprite = new THREE.Sprite(mat);
  sprite.name = 'spawn-indicator';
  // Scale up 2x from original (0.35, 0.45) → now prominent and visible
  sprite.scale.set(0.7, 0.9, 1.0);
  // Position along local Z (= bitangent = camera "up") so the arrow appears
  // above the pickup on screen. Local Y = surface normal (perpendicular to camera up),
  // so using Y would place the arrow beside the pickup, not above it.
  sprite.position.set(0, 0, 1.0);
  return sprite;
}

/**
 * Animate the spawn indicator. Call inside pickup update().
 * @param mesh      The pickup's root THREE.Group
 * @param age       How long the pickup has existed (seconds)
 * @param t         Running time for phase animation
 * @param cameraUp  Camera's world-space up vector (camera.up). When provided, the
 *                  sprite is positioned so it appears ABOVE the pickup in screen space.
 *                  Without it the sprite falls back to local-Z offset which is wrong on
 *                  surfaces where tangentV (bitangent) at the pickup differs from camera up
 *                  (e.g. torus — tangentV rotates 360° around the ring).
 */
export function updateSpawnIndicator(
  mesh: THREE.Object3D,
  age: number,
  t: number,
  cameraUp?: THREE.Vector3,
): void {
  const indicator = mesh.getObjectByName('spawn-indicator') as THREE.Sprite | undefined;
  if (!indicator) return;

  if (age >= 30) {
    indicator.visible = false;
    return;
  }

  indicator.visible = true;

  // Pulse: 0.5 → 1.0 at ~3 Hz (more pronounced flash)
  const pulse = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 6));
  (indicator.material as THREE.SpriteMaterial).opacity = pulse;

  // Bounce distance
  const offsetDist = 1.0 + Math.abs(Math.sin(t * 4)) * 0.25;

  if (cameraUp) {
    // Transform camera.up (world space) into the pickup group's local space so the
    // sprite's world position = pickup.position + cameraUp * offsetDist.
    // This ensures the sprite always appears ABOVE the pickup on screen regardless of
    // where on the surface the pickup is (fixes torus and any other surface where the
    // pickup's bitangent diverges from the player's bitangent / camera up).
    _indicatorInvQ.copy(mesh.quaternion).invert();
    _indicatorLocalUp.copy(cameraUp).applyQuaternion(_indicatorInvQ);
    indicator.position.copy(_indicatorLocalUp).multiplyScalar(offsetDist);
  } else {
    // Fallback: offset along local Z (= bitangent at pickup position).
    // Correct when camera up ≈ pickup bitangent, but wrong on torus.
    indicator.position.z = offsetDist;
  }
}
