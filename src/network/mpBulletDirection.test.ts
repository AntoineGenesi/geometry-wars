import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mpBulletWorldDirectionFromServerPatch } from './mpBulletDirection';

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
});
