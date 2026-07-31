/**
 * Regression tests for MP player orientation in the real surface frame.
 *
 * Surface frames satisfy tangentU x tangentV = normal, and server-returned
 * bullets use tangentU*cos(aimAngle) + tangentV*sin(aimAngle). The chevron's
 * local +Z must use that same world direction.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { orientPlayerOnSurface } from './SharedGameSetup';

function makeFrame(normalInput: THREE.Vector3, tangentInput: THREE.Vector3) {
  const normal = normalInput.clone().normalize();
  const tangentU = tangentInput.clone().projectOnPlane(normal).normalize();
  const tangentV = new THREE.Vector3().crossVectors(normal, tangentU).normalize();
  return { normal, tangentU, tangentV };
}

function orientedAxes(
  normal: THREE.Vector3,
  tangentU: THREE.Vector3,
  tangentV: THREE.Vector3,
  aimAngle: number,
) {
  const mesh = new THREE.Object3D();
  orientPlayerOnSurface(mesh, normal, aimAngle, tangentU, tangentV);
  return {
    forward: new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).normalize(),
    quaternion: mesh.quaternion.clone(),
  };
}

describe('orientPlayerOnSurface', () => {
  it('aligns zero-angle chevron forward with tangentU', () => {
    const { normal, tangentU, tangentV } = makeFrame(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    );
    const axes = orientedAxes(normal, tangentU, tangentV, 0);

    expect(axes.forward.dot(tangentU)).toBeCloseTo(1, 6);
    expect(axes.up.dot(normal)).toBeCloseTo(1, 6);
  });

  it('produces different orientations for opposite aim angles', () => {
    const { normal, tangentU, tangentV } = makeFrame(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    );
    const positive = orientedAxes(normal, tangentU, tangentV, Math.PI / 4);
    const negative = orientedAxes(normal, tangentU, tangentV, -Math.PI / 4);

    expect(Math.abs(positive.quaternion.dot(negative.quaternion))).not.toBeCloseTo(1, 3);
  });

  it('keeps chevron up aligned on a curved surface frame', () => {
    const { normal, tangentU, tangentV } = makeFrame(
      new THREE.Vector3(0.5, 0.5, 0.707),
      new THREE.Vector3(1, 0, 0),
    );
    const axes = orientedAxes(normal, tangentU, tangentV, Math.PI / 3);

    expect(axes.quaternion.length()).toBeCloseTo(1, 6);
    expect(axes.up.dot(normal)).toBeCloseTo(1, 6);
  });

  it('aligns mesh +Z with the server-returned bullet world direction', () => {
    const frames = [
      makeFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)),
      makeFrame(new THREE.Vector3(0.35, 0.82, 0.45), new THREE.Vector3(1, 0, 0)),
    ];
    const angles = [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.35, 1.2, -2.1];

    for (const { normal, tangentU, tangentV } of frames) {
      for (const aimAngle of angles) {
        const axes = orientedAxes(normal, tangentU, tangentV, aimAngle);
        const bulletAim = tangentU.clone()
          .multiplyScalar(Math.cos(aimAngle))
          .addScaledVector(tangentV, Math.sin(aimAngle))
          .normalize();

        expect(axes.forward.dot(bulletAim)).toBeCloseTo(1, 6);
        expect(axes.up.dot(normal)).toBeCloseTo(1, 6);
      }
    }
  });

  it('REGRESSION: uses the real tangentV handedness for non-horizontal aim', () => {
    const { normal, tangentU, tangentV } = makeFrame(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    );
    const axes = orientedAxes(normal, tangentU, tangentV, Math.PI / 2);
    const mirroredDirection = tangentV.clone().negate();

    expect(axes.forward.dot(tangentV)).toBeCloseTo(1, 6);
    expect(axes.forward.dot(mirroredDirection)).toBeCloseTo(-1, 6);
  });
});
