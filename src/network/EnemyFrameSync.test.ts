import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SphereWithTunnelSurface } from '../surfaces/SphereWithTunnelSurface';
import { resolveEnemyRenderTargetFrame, type NetworkEnemyFrameState } from './EnemyFrameSync';

describe('resolveEnemyRenderTargetFrame', () => {
  function makeEnemy(overrides: Partial<NetworkEnemyFrameState> = {}): NetworkEnemyFrameState {
    return {
      surfaceU: 0.5,
      surfaceV: 0.75,
      wx: 4,
      wy: 5,
      wz: 6,
      ...overrides,
    };
  }

  it('prefers the finite server walker frame over sphere-tunnel UV reconstruction', () => {
    const sphereTunnel = new SphereWithTunnelSurface();
    const wrongUvFrame = sphereTunnel.getPoint(0.1, 0.25);
    const serverNormal = new THREE.Vector3(0, 0, -1);
    const serverTangent = new THREE.Vector3(1, 0, 0);
    const serverBitangent = new THREE.Vector3(0, 1, 0);

    const resolved = resolveEnemyRenderTargetFrame(
      makeEnemy({
        surfaceU: 0.1,
        surfaceV: 0.25,
        nx: serverNormal.x,
        ny: serverNormal.y,
        nz: serverNormal.z,
        tx: serverTangent.x,
        ty: serverTangent.y,
        tz: serverTangent.z,
        bx: serverBitangent.x,
        by: serverBitangent.y,
        bz: serverBitangent.z,
      }),
      wrongUvFrame,
    );

    expect(resolved.source).toBe('server-frame');
    expect(resolved.position.toArray()).toEqual([4, 5, 6]);
    expect(resolved.normal.distanceTo(serverNormal)).toBeLessThan(1e-6);
    expect(resolved.tangent.distanceTo(serverTangent)).toBeLessThan(1e-6);
    expect(resolved.bitangent.distanceTo(serverBitangent)).toBeLessThan(1e-6);
    expect(resolved.normal.distanceTo(wrongUvFrame.normal)).toBeGreaterThan(0.1);
  });

  it('falls back to the UV surface frame when the server frame is missing or degenerate', () => {
    const fallbackFrame = {
      position: new THREE.Vector3(9, 9, 9),
      normal: new THREE.Vector3(0, 1, 0),
      tangentU: new THREE.Vector3(1, 0, 0),
      tangentV: new THREE.Vector3(0, 0, 1),
    };

    const resolvedMissing = resolveEnemyRenderTargetFrame(makeEnemy(), fallbackFrame);
    expect(resolvedMissing.source).toBe('surface-uv');
    expect(resolvedMissing.normal.distanceTo(fallbackFrame.normal)).toBeLessThan(1e-6);

    const resolvedDegenerate = resolveEnemyRenderTargetFrame(
      makeEnemy({
        nx: 0,
        ny: 1,
        nz: 0,
        tx: 1,
        ty: 0,
        tz: 0,
        bx: 2,
        by: 0,
        bz: 0,
      }),
      fallbackFrame,
    );
    expect(resolvedDegenerate.source).toBe('surface-uv');
    expect(resolvedDegenerate.bitangent.distanceTo(fallbackFrame.tangentV)).toBeLessThan(1e-6);
  });
});
