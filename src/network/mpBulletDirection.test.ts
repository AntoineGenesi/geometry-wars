import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MeshSurface } from '../surfaces/MeshSurface';
import {
  mpBulletWorldDirectionFromServerPatch,
  mpReconcileHomingBulletGeodesicFromServerPatch,
  mpShouldApplyServerBulletUvSpawnOffset,
} from './mpBulletDirection';

describe('mpBulletWorldDirectionFromServerPatch', () => {
  it('updates an existing geodesic direction from patched server UV direction', () => {
    const tangentU = new THREE.Vector3(1, 0, 0);
    const tangentV = new THREE.Vector3(0, 1, 0);
    const dirWorld = new THREE.Vector3(1, 0, 0);

    mpBulletWorldDirectionFromServerPatch(tangentU, tangentV, 0, 1, 'sphere', dirWorld);

    expect(dirWorld.x).toBeCloseTo(0, 5);
    expect(dirWorld.y).toBeCloseTo(1, 5);
    expect(dirWorld.length()).toBeCloseTo(1, 5);
  });

  it('preserves the existing torus server/client dirX sign correction', () => {
    const tangentU = new THREE.Vector3(1, 0, 0);
    const tangentV = new THREE.Vector3(0, 1, 0);
    const dirWorld = mpBulletWorldDirectionFromServerPatch(tangentU, tangentV, 1, 0, 'torus');

    expect(dirWorld.x).toBeCloseTo(-1, 5);
    expect(dirWorld.y).toBeCloseTo(0, 5);
  });

  it('does not treat advanced torus bullet UV as a spawn offset', () => {
    expect(mpShouldApplyServerBulletUvSpawnOffset('torus')).toBe(false);
    expect(mpShouldApplyServerBulletUvSpawnOffset('sphere')).toBe(true);
  });

  it('rebuilds homing geodesic position from the authoritative server patch', () => {
    const nextFacePos = { faceIndex: 12, bary: { u: 0.2, v: 0.3, w: 0.5 } };
    const meshSurface = {
      closestPointOnSurface: (worldPoint: THREE.Vector3) => ({
        point: worldPoint.clone(),
        normal: new THREE.Vector3(1, 0, 0),
        distance: 0,
        faceIndex: nextFacePos.faceIndex,
      }),
      initGeodesicPosition: (_worldPoint: THREE.Vector3, faceIndex: number) => ({
        faceIndex,
        bary: nextFacePos.bary,
      }),
    } as unknown as MeshSurface;
    const geoState = {
      facePos: { faceIndex: 3, bary: { u: 1, v: 0, w: 0 } },
      positionWorld: new THREE.Vector3(-5, 0, 0),
      dirWorld: new THREE.Vector3(1, 0, 0),
    };

    const reconciled = mpReconcileHomingBulletGeodesicFromServerPatch(
      meshSurface,
      geoState,
      new THREE.Vector3(5, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      0,
      1,
      'sphere',
      2,
    );

    expect(reconciled).toBe(true);
    expect(geoState.facePos.faceIndex).toBe(12);
    expect(geoState.positionWorld.x).toBeCloseTo(10, 5);
    expect(geoState.dirWorld.x).toBeCloseTo(0, 5);
    expect(geoState.dirWorld.y).toBeCloseTo(1, 5);
  });
});
