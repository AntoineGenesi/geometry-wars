import * as THREE from 'three';

export function mpBulletWorldDirectionFromServerPatch(
  tangentU: THREE.Vector3,
  tangentV: THREE.Vector3,
  dirX: number,
  dirY: number,
  surfaceType: string,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const correctedDirX = surfaceType === 'torus' ? -dirX : dirX;
  return target.set(0, 0, 0)
    .addScaledVector(tangentU, correctedDirX)
    .addScaledVector(tangentV, dirY)
    .normalize();
}
