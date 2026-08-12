import * as THREE from 'three';
import type { MeshSurface } from '../surfaces/MeshSurface';
import type { FacePosition } from '../surfaces/geodesic/FaceWalker';

const _mpPatchWorld = new THREE.Vector3();

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

export function mpShouldApplyServerBulletUvSpawnOffset(surfaceType: string): boolean {
  return surfaceType !== 'torus';
}

export interface MpBulletGeodesicState {
  facePos: FacePosition;
  positionWorld: THREE.Vector3;
  dirWorld: THREE.Vector3;
}

export function mpReconcileHomingBulletGeodesicFromServerPatch(
  meshSurface: MeshSurface,
  geoState: MpBulletGeodesicState,
  patchPosition: THREE.Vector3,
  tangentU: THREE.Vector3,
  tangentV: THREE.Vector3,
  dirX: number,
  dirY: number,
  surfaceType: string,
  mapScale: number,
): boolean {
  const patchWorld = _mpPatchWorld.copy(patchPosition).multiplyScalar(mapScale);
  const closest = meshSurface.closestPointOnSurface(patchWorld);
  if (!closest) return false;

  geoState.facePos = meshSurface.initGeodesicPosition(closest.point, closest.faceIndex);
  geoState.positionWorld.copy(closest.point);
  mpBulletWorldDirectionFromServerPatch(
    tangentU,
    tangentV,
    dirX,
    dirY,
    surfaceType,
    geoState.dirWorld,
  );
  return true;
}
