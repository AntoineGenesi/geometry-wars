/**
 * Regression test for orientPlayerOnSurface — s44r17-06.
 *
 * Verifies that the aim rotation uses the NEGATIVE aimAngle (matching SP behavior).
 * The bug: MP used +aimAngle while SP used -aimAngle, causing the player to spin
 * in the wrong direction on all surfaces.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { orientPlayerOnSurface } from './SharedGameSetup';

describe('orientPlayerOnSurface', () => {
  it('should rotate in the same direction as SP (negative aimAngle)', () => {
    // Setup: surface normal = Y-up, tangentU = X-right
    const mesh = new THREE.Object3D();
    const normal = new THREE.Vector3(0, 1, 0);
    const tangentU = new THREE.Vector3(1, 0, 0);

    // Apply zero aimAngle — establish reference orientation
    orientPlayerOnSurface(mesh, normal, 0, tangentU);
    const refQuat = mesh.quaternion.clone();

    // Apply a positive aimAngle
    orientPlayerOnSurface(mesh, normal, Math.PI / 4, tangentU);
    const posQuat = mesh.quaternion.clone();

    // SP equivalent: quaternion from basis, then premultiply setFromAxisAngle(normal, -aimAngle)
    // Build the same basis as orientPlayerOnSurface
    const right = new THREE.Vector3().crossVectors(normal, tangentU).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();
    const mat = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
    const spBasisQuat = new THREE.Quaternion().setFromRotationMatrix(mat);
    const spAimQuat = new THREE.Quaternion().setFromAxisAngle(normal, -Math.PI / 4);
    const spExpected = spBasisQuat.clone().premultiply(spAimQuat);

    // The MP result should match SP behavior (using -aimAngle around normal)
    expect(posQuat.dot(spExpected)).toBeCloseTo(1.0, 3);
  });

  it('should produce different orientations for opposite aimAngles', () => {
    const mesh = new THREE.Object3D();
    const normal = new THREE.Vector3(0, 1, 0);
    const tangentU = new THREE.Vector3(1, 0, 0);

    orientPlayerOnSurface(mesh, normal, Math.PI / 4, tangentU);
    const q1 = mesh.quaternion.clone();

    orientPlayerOnSurface(mesh, normal, -Math.PI / 4, tangentU);
    const q2 = mesh.quaternion.clone();

    // Opposite angles should produce different orientations
    expect(q1.dot(q2)).not.toBeCloseTo(1.0, 3);
  });

  it('should handle non-Y-up normals correctly (curved surface)', () => {
    const mesh = new THREE.Object3D();
    // Tilted normal (like a tube section of sphere-tunnel)
    const normal = new THREE.Vector3(0.5, 0.5, 0.707).normalize();
    const tangentU = new THREE.Vector3(1, 0, 0).normalize();

    // Should not throw and should produce a valid quaternion
    orientPlayerOnSurface(mesh, normal, Math.PI / 3, tangentU);
    expect(mesh.quaternion.length()).toBeCloseTo(1.0, 5);

    // Verify the local Y axis of the mesh aligns with the surface normal
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    // After aim rotation around normal, the local Y should still be the normal
    expect(localY.dot(normal)).toBeCloseTo(1.0, 3);
  });

  // REGRESSION GUARD: s44r17-06 — aimAngle sign must be negative
  it('REGRESSION: aimAngle rotation must match SP sign convention (-aimAngle)', () => {
    const mesh = new THREE.Object3D();
    const normal = new THREE.Vector3(0, 1, 0);
    const tangentU = new THREE.Vector3(1, 0, 0);
    const testAngle = 1.0; // ~57 degrees

    orientPlayerOnSurface(mesh, normal, testAngle, tangentU);

    // Extract the rotation around Y (the normal) from the final quaternion
    // by removing the basis component.
    const right = new THREE.Vector3().crossVectors(normal, tangentU).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();
    const basisMat = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
    const basisQuat = new THREE.Quaternion().setFromRotationMatrix(basisMat);
    const basisInv = basisQuat.clone().invert();

    // Remove basis to isolate the aim rotation
    const aimOnly = mesh.quaternion.clone().multiply(basisInv);
    // aimOnly should be a rotation around local Y by -testAngle
    // For a Y-axis rotation by angle θ: w = cos(θ/2), y = sin(θ/2)
    const expectedW = Math.cos(-testAngle / 2);
    const expectedY = Math.sin(-testAngle / 2);

    expect(aimOnly.w).toBeCloseTo(expectedW, 3);
    expect(aimOnly.y).toBeCloseTo(expectedY, 3);
    expect(Math.abs(aimOnly.x)).toBeLessThan(0.01);
    expect(Math.abs(aimOnly.z)).toBeLessThan(0.01);
  });
});
