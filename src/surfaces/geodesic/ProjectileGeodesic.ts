import * as THREE from 'three';
import type { MeshSurface } from '../MeshSurface';
import type { GeodesicMoveResult } from './GeodesicSurface';
import type { FacePosition } from './FaceWalker';

export interface ProjectileGeodesicResult extends GeodesicMoveResult {
  usedSurfaceFallback: boolean;
}

const MIN_PROGRESS_RATIO = 0.75;
const MAX_PROGRESS_RATIO = 3;
const _fallbackDirection = new THREE.Vector3();
const _endpointDisplacement = new THREE.Vector3();

/** Advance a projectile with one shared SP/MP movement and recovery policy. */
export function advanceProjectileOnMesh(
  meshSurface: MeshSurface,
  facePosition: FacePosition,
  positionWorld: THREE.Vector3,
  directionWorld: THREE.Vector3,
  distance: number,
): ProjectileGeodesicResult | null {
  const geodesic = meshSurface.moveGeodesic(facePosition, directionWorld, distance);
  const endpointProgress = geodesic.position.distanceTo(positionWorld);
  const finite = Number.isFinite(geodesic.position.x)
    && Number.isFinite(geodesic.position.y)
    && Number.isFinite(geodesic.position.z)
    && Number.isFinite(geodesic.distanceTraveled);
  const claimedProgress = geodesic.distanceTraveled >= distance * 0.95;
  const plausibleEndpoint = endpointProgress >= distance * MIN_PROGRESS_RATIO
    && endpointProgress <= distance * MAX_PROGRESS_RATIO;
  const forwardAlignment = endpointProgress > 1e-8
    ? _endpointDisplacement.subVectors(geodesic.position, positionWorld)
      .multiplyScalar(1 / endpointProgress)
      .dot(directionWorld)
    : -1;

  if (finite && claimedProgress && plausibleEndpoint && forwardAlignment > 0.1) {
    const result = geodesic as ProjectileGeodesicResult;
    result.usedSurfaceFallback = false;
    return result;
  }

  const currentSurface = meshSurface.closestPointOnSurface(positionWorld);
  if (!currentSurface) return null;

  const fallback = meshSurface.moveOnSurface(
    currentSurface.point,
    currentSurface.normal,
    directionWorld,
    distance,
  );
  if (!fallback) return null;

  const fallbackProgress = fallback.point.distanceTo(positionWorld);
  if (!Number.isFinite(fallbackProgress) || fallbackProgress < distance * 0.05) {
    return null;
  }

  _fallbackDirection.copy(directionWorld)
    .addScaledVector(fallback.normal, -directionWorld.dot(fallback.normal));
  if (_fallbackDirection.lengthSq() < 1e-8) return null;
  _fallbackDirection.normalize();

  return {
    faceIndex: fallback.faceIndex,
    position: fallback.point,
    normal: fallback.normal,
    direction: _fallbackDirection,
    facePosition: meshSurface.initGeodesicPosition(fallback.point, fallback.faceIndex),
    distanceTraveled: fallbackProgress,
    crossedNonOrientable: false,
    usedSurfaceFallback: true,
  };
}
