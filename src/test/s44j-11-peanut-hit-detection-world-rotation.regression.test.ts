/**
 * Regression test: s44j-11 — Peanut hit detection broken when surface is rotated.
 *
 * ROOT CAUSE: PeanutSurface.getPoint() did NOT call applyWorldRotation(), returning
 * local coordinates instead of world coordinates. All other surfaces (Sphere, Torus,
 * Cube, etc.) apply worldRotation in getPoint(). Without this:
 *
 * - Enemy positions from getTransform() → getPoint() were in LOCAL surface coordinates
 * - Bullet positions from MeshSurface BVH geodesic walker were in WORLD coordinates
 *   (using mesh.matrixWorld which includes the surface group's worldRotation)
 * - CollisionSystem's `bulletPos.distanceToSquared(enemy.position)` compared
 *   LOCAL vs WORLD positions → mismatch grew as player moved and surface rotated
 *
 * FIX: Added getPointLocal() private method, getPoint() now calls
 * applyWorldRotation(getPointLocal()), consistent with all other surfaces.
 *
 * REGRESSION GUARD: getPoint() must return world-space positions (including worldRotation).
 * If this test fails, applyWorldRotation was removed from PeanutSurface.getPoint().
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PeanutSurface } from '../surfaces/PeanutSurface';

describe('s44j-11: PeanutSurface.getPoint() worldRotation fix', () => {
  it('getPoint returns position in world space when worldRotation is identity', () => {
    const peanut = new PeanutSurface();

    // At identity rotation, world space == local space
    // Position at u=0, v=0.5 (equator/waist area)
    const pt = peanut.getPoint(0, 0.5);

    // Should be on the surface at some positive radius from origin
    expect(pt.position.length()).toBeGreaterThan(0);
    expect(isNaN(pt.position.x)).toBe(false);
    expect(isNaN(pt.position.y)).toBe(false);
    expect(isNaN(pt.position.z)).toBe(false);
  });

  it('getPoint applies worldRotation — rotated position differs from local', () => {
    const peanut = new PeanutSurface();

    // Get position BEFORE rotation (should be identity)
    const ptBefore = peanut.getPoint(0, 0.25);

    // Apply a 90-degree rotation around Z axis (simulates player movement)
    const rot90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    peanut.worldRotation.copy(rot90);
    peanut.group.quaternion.copy(rot90);

    // Get position AFTER rotation
    const ptAfter = peanut.getPoint(0, 0.25);

    // After rotation, the position should be different from before
    // (worldRotation changes the returned position)
    const diff = ptAfter.position.distanceTo(ptBefore.position);
    expect(diff).toBeGreaterThan(0.1);

    // The MAGNITUDE (distance from origin) should remain the same
    // (rotation doesn't change distance from origin)
    expect(Math.abs(ptAfter.position.length() - ptBefore.position.length())).toBeLessThan(0.001);
  });

  it('REGRESSION GUARD: hit detection works when worldRotation is non-identity', () => {
    // This test simulates what CollisionSystem does:
    // 1. Enemy position comes from getPoint() → should be in world space
    // 2. Bullet position is in world space (from MeshSurface)
    // 3. distanceToSquared(enemy.position, bulletPos) should be near-zero when bullet hits enemy

    const peanut = new PeanutSurface();

    // Apply a 45-degree rotation (simulates player having moved)
    const rot45 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4);
    peanut.worldRotation.copy(rot45);

    // Enemy is at UV position (u=0.25, v=0.5) — in the waist area
    const u = 0.25;
    const v = 0.5;
    const enemyPoint = peanut.getPoint(u, v);
    const enemyWorldPos = enemyPoint.position;

    // Bullet is spawned exactly at the enemy's world position
    // (simulates a perfect hit — bullet and enemy at same location)
    const bulletWorldPos = enemyWorldPos.clone();

    // Distance should be zero (perfect hit)
    const distSq = bulletWorldPos.distanceToSquared(enemyWorldPos);
    expect(distSq).toBeLessThan(0.0001);

    // Also verify the position is actually rotated (world space, not local space)
    // Get the local (unrotated) position for comparison
    const peanutIdentity = new PeanutSurface(); // fresh, identity rotation
    const localPoint = peanutIdentity.getPoint(u, v);

    // The rotated world position should differ from local position
    // (confirming that worldRotation was applied)
    const rotationDiff = enemyWorldPos.distanceTo(localPoint.position);
    expect(rotationDiff).toBeGreaterThan(0.1);
  });

  it('getPoint normal is also rotated with worldRotation', () => {
    const peanut = new PeanutSurface();

    // At v=0.01 (near north pole), normal should point roughly up (+Y) when not rotated
    const ptIdentity = peanut.getPoint(0, 0.01);
    expect(ptIdentity.normal.y).toBeGreaterThan(0.9);

    // Apply 90-degree rotation around X axis
    // Three.js X-axis rotation: (x,y,z) → (x, y*cos - z*sin, y*sin + z*cos)
    // At PI/2: (x,y,z) → (x, -z, y). So +Y normal → +Z
    const rot90x = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    peanut.worldRotation.copy(rot90x);

    // After 90-degree X rotation, the north pole normal should point toward +Z
    const ptRotated = peanut.getPoint(0, 0.01);
    expect(Math.abs(ptRotated.normal.y)).toBeLessThan(0.2);
    expect(ptRotated.normal.z).toBeGreaterThan(0.9);
  });
});
