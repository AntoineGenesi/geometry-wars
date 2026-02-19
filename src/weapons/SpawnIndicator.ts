import * as THREE from 'three';

/**
 * Creates a flashing downward-pointing arrow sprite to appear above pickups
 * for the first 30 seconds after spawning. Helps players distinguish pickups
 * from enemies at a glance.
 *
 * Returns a Sprite named 'spawn-indicator' at local position (0, 0.8, 0).
 * Call updateSpawnIndicator() each frame to animate it.
 */
export function createSpawnIndicatorSprite(tint: THREE.Color = new THREE.Color(0xffffff)): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 40;
  const ctx = canvas.getContext('2d')!;

  const r = Math.round(tint.r * 255);
  const g = Math.round(tint.g * 255);
  const b = Math.round(tint.b * 255);
  const fillColor = `rgb(${r},${g},${b})`;

  // Downward-pointing arrow (▼) with shaft
  ctx.fillStyle = fillColor;

  // Shaft (top portion)
  ctx.fillRect(11, 2, 10, 18);

  // Arrowhead (bottom triangle)
  ctx.beginPath();
  ctx.moveTo(16, 38); // tip
  ctx.lineTo(4, 18);  // left
  ctx.lineTo(28, 18); // right
  ctx.closePath();
  ctx.fill();

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
  sprite.scale.set(0.35, 0.45, 1.0);
  sprite.position.set(0, 0.9, 0);
  return sprite;
}

/**
 * Animate the spawn indicator. Call inside pickup update().
 * @param mesh  The pickup's root THREE.Group
 * @param age   How long the pickup has existed (seconds)
 * @param t     Running time for phase animation
 */
export function updateSpawnIndicator(mesh: THREE.Object3D, age: number, t: number): void {
  const indicator = mesh.getObjectByName('spawn-indicator') as THREE.Sprite | undefined;
  if (!indicator) return;

  if (age >= 30) {
    indicator.visible = false;
    return;
  }

  indicator.visible = true;

  // Pulse: 0.3 → 1.0 at ~4 Hz
  const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 8));
  (indicator.material as THREE.SpriteMaterial).opacity = pulse;

  // Bounce up/down slightly (0 → 0.15 → 0 cycle)
  indicator.position.y = 0.9 + Math.abs(Math.sin(t * 4)) * 0.15;
}
