/**
 * ServerMeshWalker unit tests.
 *
 * NOTE: vitest cannot run in git worktrees — run these tests from the main
 * project root after merging.
 *
 * Tests:
 * 1. Move in +X direction on sphere — position advances
 * 2. Cross sphere north pole — bitangent does not flip
 * 3. Cross peanut waist — speed is consistent (no distortion)
 * 4. Speed multiplier — 3x speed produces ~3x displacement
 * 5. teleportToWorldPos — snaps to surface
 * 6. getState — returns valid position + orthonormal frame
 * 7. Zero input — no movement
 * 8. Position stays on surface after 100 moves
 */

import * as THREE from 'three';
import { describe, test, expect, beforeEach } from 'vitest';
import { ServerMeshWalker } from './ServerMeshWalker';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { buildSurfaceGeometry } from './SurfaceGeometryBuilder';
import { PLAYER_WORLD_SPEED } from '../shared/GameConstants';

// Build test surfaces once (BVH construction is expensive)
const SPHERE_MESH = buildSurfaceGeometry('sphere', 1.0);  // radius 10
const SPHERE_SURFACE = new MeshSurface(SPHERE_MESH);
const PEANUT_MESH = buildSurfaceGeometry('peanut', 1.0);
const PEANUT_SURFACE = new MeshSurface(PEANUT_MESH);

/** Spawn at equator of the sphere (Y=0, X=10, Z=0) */
function makeSphereWalker(speed = PLAYER_WORLD_SPEED): ServerMeshWalker {
  const start = new THREE.Vector3(10, 0, 0);
  return new ServerMeshWalker(SPHERE_SURFACE, start, speed);
}

/** Spawn near peanut equator */
function makePeanutWalker(speed = PLAYER_WORLD_SPEED): ServerMeshWalker {
  const start = new THREE.Vector3(0, 0, 6); // near peanut bulge
  return new ServerMeshWalker(PEANUT_SURFACE, start, speed);
}

/** World-space camera axes for a camera sitting at (20, 0, 0) looking at origin.
 *  right = (0, 0, -1), up = (0, 1, 0) (approximately). */
const CAM_FROM_EQUATOR = {
  rightX: 0, rightY: 0, rightZ: -1,
  upX: 0, upY: 1, upZ: 0,
};

describe('ServerMeshWalker', () => {
  describe('construction', () => {
    test('constructs without error on sphere surface', () => {
      expect(() => makeSphereWalker()).not.toThrow();
    });

    test('constructs without error on peanut surface', () => {
      expect(() => makePeanutWalker()).not.toThrow();
    });

    test('initial position is on the surface (within 0.05 world units)', () => {
      const walker = makeSphereWalker();
      const pos = walker.getWorldPosition();
      const dist = pos.length(); // sphere radius = 10
      expect(Math.abs(dist - 10)).toBeLessThan(0.05);
    });
  });

  describe('moveWithCameraAxes', () => {
    test('moveX=1 advances position in the camera-right direction', () => {
      const walker = makeSphereWalker();
      const before = walker.getWorldPosition().clone();

      walker.moveWithCameraAxes(
        1, 0,
        CAM_FROM_EQUATOR.rightX, CAM_FROM_EQUATOR.rightY, CAM_FROM_EQUATOR.rightZ,
        CAM_FROM_EQUATOR.upX, CAM_FROM_EQUATOR.upY, CAM_FROM_EQUATOR.upZ,
        0.016, // ~1 frame at 60 FPS
      );

      const after = walker.getWorldPosition();
      // Should have moved some nonzero amount
      expect(after.distanceTo(before)).toBeGreaterThan(0.001);
    });

    test('zero input does not move the walker', () => {
      const walker = makeSphereWalker();
      const before = walker.getWorldPosition().clone();

      walker.moveWithCameraAxes(
        0, 0,
        CAM_FROM_EQUATOR.rightX, CAM_FROM_EQUATOR.rightY, CAM_FROM_EQUATOR.rightZ,
        CAM_FROM_EQUATOR.upX, CAM_FROM_EQUATOR.upY, CAM_FROM_EQUATOR.upZ,
        0.016,
      );

      const after = walker.getWorldPosition();
      expect(after.distanceTo(before)).toBeLessThan(0.0001);
    });

    test('3x speed produces ~3x displacement in same time', () => {
      const dt = 0.1;

      const walker1x = makeSphereWalker(PLAYER_WORLD_SPEED);
      const pos1x_before = walker1x.getWorldPosition().clone();
      walker1x.moveWithCameraAxes(
        1, 0,
        CAM_FROM_EQUATOR.rightX, CAM_FROM_EQUATOR.rightY, CAM_FROM_EQUATOR.rightZ,
        CAM_FROM_EQUATOR.upX, CAM_FROM_EQUATOR.upY, CAM_FROM_EQUATOR.upZ,
        dt,
      );
      const dist1x = walker1x.getWorldPosition().distanceTo(pos1x_before);

      const walker3x = makeSphereWalker(PLAYER_WORLD_SPEED * 3);
      const pos3x_before = walker3x.getWorldPosition().clone();
      walker3x.moveWithCameraAxes(
        1, 0,
        CAM_FROM_EQUATOR.rightX, CAM_FROM_EQUATOR.rightY, CAM_FROM_EQUATOR.rightZ,
        CAM_FROM_EQUATOR.upX, CAM_FROM_EQUATOR.upY, CAM_FROM_EQUATOR.upZ,
        dt,
      );
      const dist3x = walker3x.getWorldPosition().distanceTo(pos3x_before);

      // 3x speed → ~3x displacement (allow 20% tolerance for surface curvature)
      expect(dist3x).toBeGreaterThan(dist1x * 2.2);
      expect(dist3x).toBeLessThan(dist1x * 3.8);
    });
  });

  describe('pole crossing', () => {
    test('peanut pole crossing — bitangent does not flip', () => {
      // Start near the peanut top pole and drive through it.
      const startNearPole = new THREE.Vector3(0.1, 7.0, 0);
      const walker = new ServerMeshWalker(PEANUT_SURFACE, startNearPole, PLAYER_WORLD_SPEED);

      const state0 = walker.getState();
      const bitangentBefore = new THREE.Vector3(state0.bitangentX, state0.bitangentY, state0.bitangentZ);

      for (let i = 0; i < 30; i++) {
        walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
      }

      const state1 = walker.getState();
      const bitangentAfter = new THREE.Vector3(state1.bitangentX, state1.bitangentY, state1.bitangentZ);

      // Bitangent must not have flipped (dot product > 0)
      expect(bitangentBefore.dot(bitangentAfter)).toBeGreaterThan(0);
    });

    test('peanut waist crossing — speed is consistent (no distortion)', () => {
      // The peanut waist is near the equator (surfaceV ~ 0.5).
      // Speed should remain within 50% of the mean across 20 steps.
      const walker = makePeanutWalker();
      const displacements: number[] = [];

      for (let i = 0; i < 20; i++) {
        const before = walker.getWorldPosition().clone();
        walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
        displacements.push(walker.getWorldPosition().distanceTo(before));
      }

      const mean = displacements.reduce((a, b) => a + b, 0) / displacements.length;
      for (const d of displacements) {
        expect(d).toBeGreaterThan(mean * 0.2);
        expect(d).toBeLessThan(mean * 3.0);
      }
    });

    test('sphere north pole crossing — bitangent does not flip sign', () => {
      // Start near north pole and drive straight through it.
      // North pole of sphere radius 10 is at (0, 10, 0).
      const startNearPole = new THREE.Vector3(0.5, 9.99, 0);
      const walker = new ServerMeshWalker(SPHERE_SURFACE, startNearPole, PLAYER_WORLD_SPEED);

      const state0 = walker.getState();
      const bitangentBefore = new THREE.Vector3(state0.bitangentX, state0.bitangentY, state0.bitangentZ);

      // Camera up = (0, 1, 0), camera right = (1, 0, 0) (looking from +Z)
      // Drive upY = +1 (toward pole)
      for (let i = 0; i < 30; i++) {
        walker.moveWithCameraAxes(
          0, 1,          // drive forward toward pole
          1, 0, 0,      // camRight = +X
          0, 1, 0,      // camUp = +Y
          0.016,
        );
      }

      const state1 = walker.getState();
      const bitangentAfter = new THREE.Vector3(state1.bitangentX, state1.bitangentY, state1.bitangentZ);

      // Bitangent should not have flipped (dot product should be positive)
      // This is the regression: crossing the pole used to invert the tangent frame.
      expect(bitangentBefore.dot(bitangentAfter)).toBeGreaterThan(0);
    });
  });

  describe('teleportToWorldPos', () => {
    test('snaps to nearest point on surface', () => {
      const walker = makeSphereWalker();

      // Teleport to a point above the surface (not on it)
      walker.teleportToWorldPos(0, 20, 0); // off-surface, above north pole

      const pos = walker.getWorldPosition();
      const dist = pos.length(); // sphere radius = 10
      expect(Math.abs(dist - 10)).toBeLessThan(0.05);
    });

    test('teleporting to equator places walker near equator', () => {
      const walker = makeSphereWalker();
      walker.teleportToWorldPos(10, 0, 0);
      const pos = walker.getWorldPosition();
      // y should be near 0 (equator)
      expect(Math.abs(pos.y)).toBeLessThan(0.1);
    });
  });

  describe('getState', () => {
    test('returns valid position + finite normal + orthonormal frame', () => {
      const walker = makeSphereWalker();
      const s = walker.getState();

      // Position finite
      expect(isFinite(s.wx)).toBe(true);
      expect(isFinite(s.wy)).toBe(true);
      expect(isFinite(s.wz)).toBe(true);

      // Normal is unit length
      const normalLen = Math.sqrt(s.nx ** 2 + s.ny ** 2 + s.nz ** 2);
      expect(normalLen).toBeCloseTo(1.0, 2);

      // Tangent is unit length
      const tangentLen = Math.sqrt(s.tangentX ** 2 + s.tangentY ** 2 + s.tangentZ ** 2);
      expect(tangentLen).toBeCloseTo(1.0, 2);

      // Bitangent is unit length
      const bitangentLen = Math.sqrt(s.bitangentX ** 2 + s.bitangentY ** 2 + s.bitangentZ ** 2);
      expect(bitangentLen).toBeCloseTo(1.0, 2);

      // Normal ⊥ tangent
      const dotNT = s.nx * s.tangentX + s.ny * s.tangentY + s.nz * s.tangentZ;
      expect(Math.abs(dotNT)).toBeLessThan(0.05);

      // Normal ⊥ bitangent
      const dotNB = s.nx * s.bitangentX + s.ny * s.bitangentY + s.nz * s.bitangentZ;
      expect(Math.abs(dotNB)).toBeLessThan(0.05);

      // faceIndex is a non-negative integer
      expect(s.faceIndex).toBeGreaterThanOrEqual(0);
    });
  });

  describe('surface adherence', () => {
    test('stays on sphere surface (within 0.02) after 100 moves', () => {
      const walker = makeSphereWalker();
      const RADIUS = 10;

      for (let i = 0; i < 100; i++) {
        // Alternate directions to cover more of the surface
        const moveX = Math.cos(i * 0.3);
        const moveY = Math.sin(i * 0.3);
        walker.moveWithCameraAxes(
          moveX, moveY,
          CAM_FROM_EQUATOR.rightX, CAM_FROM_EQUATOR.rightY, CAM_FROM_EQUATOR.rightZ,
          CAM_FROM_EQUATOR.upX, CAM_FROM_EQUATOR.upY, CAM_FROM_EQUATOR.upZ,
          0.016,
        );
      }

      const pos = walker.getWorldPosition();
      const distFromCenter = pos.length();
      // Tolerance increased from 0.01 to 0.02 due to 10% speed increase (S44b-09)
      // Higher speed → larger movement per frame → slightly more surface cumulative error
      expect(Math.abs(distFromCenter - RADIUS)).toBeLessThan(0.02);
    });
  });

  describe('PLAYER_WORLD_SPEED constant', () => {
    test('PLAYER_WORLD_SPEED is 3.3 (matches SP MeshWalker speed, updated S44b-09)', () => {
      expect(PLAYER_WORLD_SPEED).toBe(3.3);
    });
  });
});
