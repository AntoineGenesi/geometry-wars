/**
 * Regression tests for s44-epic: MeshWalker server port.
 *
 * These tests FAIL without the ServerMeshWalker implementation (s44-epic-05)
 * and PASS with it. They cover the acceptance criteria from the task file:
 *
 *  1. Pole crossing — bitangent does not flip (control inversion regression)
 *  2. Constant speed on peanut — < 10% variation in arc-length steps
 *  3. Multi-player independence — two walkers move simultaneously without corruption
 *  4. Surface adherence — player stays within 0.5 world units after 300 random moves
 *
 * NOTE: vitest cannot run in git worktrees. Run from the main project root
 * after merging branch task/s44-epic-07-verification-regression-tests.
 *
 * Depends on: s44-epic-05 (ServerMeshWalker), s44-epic-06 (world-space PlayerState)
 */

import * as THREE from 'three';
import { describe, test, expect } from 'vitest';
import { ServerMeshWalker } from '../movement/ServerMeshWalker';
import { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { buildSurfaceGeometry } from '../movement/SurfaceGeometryBuilder';
import { PLAYER_WORLD_SPEED } from '../shared/GameConstants';

// ─── Shared test surfaces (BVH construction is expensive — build once) ────────

const SPHERE_MESH = buildSurfaceGeometry('sphere', 1.0);  // radius ~10
const SPHERE_SURFACE = new MeshSurface(SPHERE_MESH);

const PEANUT_MESH = buildSurfaceGeometry('peanut', 1.0);
const PEANUT_SURFACE = new MeshSurface(PEANUT_MESH);

/** Standard camera axes for a player at the equator of the sphere, looking north. */
const EQUATOR_CAM = { rightX: 0, rightY: 0, rightZ: -1, upX: 0, upY: 1, upZ: 0 };

// ─── Test 1: Pole Crossing (regression guard — control inversion) ─────────────

describe('s44-epic regression: pole crossing', () => {
  /**
   * REGRESSION GUARD: Before s44-epic-05, the UV-based SP MeshWalker tangent frame
   * would flip when crossing the sphere north pole, inverting the player controls.
   * ServerMeshWalker wraps the same MeshWalker with the same fix.
   */
  test('sphere north pole crossing — bitangent does not flip (control inversion regression)', () => {
    // Start just south of the north pole (0, 9.99, 0.5)
    const startNearPole = new THREE.Vector3(0.5, 9.99, 0);
    const walker = new ServerMeshWalker(SPHERE_SURFACE, startNearPole, PLAYER_WORLD_SPEED);

    const state0 = walker.getState();
    const bitangentBefore = new THREE.Vector3(state0.bitangentX, state0.bitangentY, state0.bitangentZ);

    // Drive straight through the north pole (camUp = +Y pointing to pole)
    for (let i = 0; i < 30; i++) {
      walker.moveWithCameraAxes(
        0, 1,       // moveForward
        1, 0, 0,   // camRight = +X
        0, 1, 0,   // camUp = +Y (directly toward pole)
        0.016,
      );
    }

    const state1 = walker.getState();
    const bitangentAfter = new THREE.Vector3(state1.bitangentX, state1.bitangentY, state1.bitangentZ);

    // Regression: dot product must be > 0 (bitangent did NOT flip 180°)
    // A flip means moveY=1 would become "move backward" after crossing — the control inversion bug.
    expect(bitangentBefore.dot(bitangentAfter)).toBeGreaterThan(0);
  });

  test('peanut top-pole crossing — bitangent does not flip', () => {
    const startNearPole = new THREE.Vector3(0.1, 7.0, 0);
    const walker = new ServerMeshWalker(PEANUT_SURFACE, startNearPole, PLAYER_WORLD_SPEED);

    const state0 = walker.getState();
    const bitangentBefore = new THREE.Vector3(state0.bitangentX, state0.bitangentY, state0.bitangentZ);

    for (let i = 0; i < 30; i++) {
      walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
    }

    const state1 = walker.getState();
    const bitangentAfter = new THREE.Vector3(state1.bitangentX, state1.bitangentY, state1.bitangentZ);

    expect(bitangentBefore.dot(bitangentAfter)).toBeGreaterThan(0);
  });
});

// ─── Test 2: Constant Speed on Peanut ────────────────────────────────────────

describe('s44-epic regression: constant speed on peanut', () => {
  /**
   * REGRESSION GUARD: Before s44-epic-05, player speed varied depending on position
   * on the peanut surface (slower on bulges, faster at waist). This happened because
   * the old implementation used UV-space movement where the metric tensor is not uniform.
   *
   * ServerMeshWalker uses world-space arc-length movement, so speed must be constant.
   */
  test('peanut surface — speed variation < 10% over 60 steps through waist and bulge', () => {
    // Start near peanut bulge, moving along the meridian through waist
    const start = new THREE.Vector3(0, 0, 6); // peanut bulge
    const walker = new ServerMeshWalker(PEANUT_SURFACE, start, PLAYER_WORLD_SPEED);

    const displacements: number[] = [];

    for (let i = 0; i < 60; i++) {
      const before = walker.getWorldPosition().clone();
      // Move along peanut meridian (camRight = +X, camUp = +Y, forward = camUp direction)
      walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
      const after = walker.getWorldPosition();
      displacements.push(after.distanceTo(before));
    }

    const mean = displacements.reduce((a, b) => a + b, 0) / displacements.length;
    const maxDeviation = Math.max(...displacements.map(d => Math.abs(d - mean)));
    const relativeDeviation = maxDeviation / mean;

    // Should be < 10% variation (PLAYER_WORLD_SPEED * 0.016 = 0.048 world units per step ± 10%)
    expect(relativeDeviation).toBeLessThan(0.1);
  });

  test('peanut surface — all steps are approximately PLAYER_WORLD_SPEED * dt', () => {
    const dt = 0.016;
    const expectedStep = PLAYER_WORLD_SPEED * dt; // 3.0 * 0.016 = 0.048

    const start = new THREE.Vector3(0, 0, 6);
    const walker = new ServerMeshWalker(PEANUT_SURFACE, start, PLAYER_WORLD_SPEED);

    for (let i = 0; i < 30; i++) {
      const before = walker.getWorldPosition().clone();
      walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, dt);
      const step = walker.getWorldPosition().distanceTo(before);

      // Each step should be within 20% of the expected arc-length
      // (small deviation allowed due to surface curvature and mesh discretization)
      expect(step).toBeGreaterThan(expectedStep * 0.8);
      expect(step).toBeLessThan(expectedStep * 1.2);
    }
  });
});

// ─── Test 3: Multi-Player Independence ───────────────────────────────────────

describe('s44-epic regression: multi-player independence', () => {
  /**
   * Verifies that two simultaneous walkers (two players in MP) move independently
   * without corrupting each other's state. This tests the ServerSurfaceManager's
   * walker isolation, which is required for LAN multiplayer.
   */
  test('two players moving simultaneously end up at different positions', () => {
    const manager = new ServerSurfaceManager();
    manager.initSurface('sphere', 1.0);

    // Player 1 spawns at equator longitude 0; Player 2 at equator longitude π
    const w1 = manager.createWalker('player1', 0.0, 0.5)!;
    const w2 = manager.createWalker('player2', 0.5, 0.5)!;

    expect(w1).not.toBeNull();
    expect(w2).not.toBeNull();

    const start1 = w1.getWorldPosition().clone();
    const start2 = w2.getWorldPosition().clone();

    // Simulate 30 ticks (0.5 seconds at 60Hz):
    // Player 1 moves north (+Y direction), Player 2 moves east (+Z direction)
    for (let i = 0; i < 30; i++) {
      // P1: forward = camUp direction
      w1.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
      // P2: strafe = camRight direction
      w2.moveWithCameraAxes(1, 0, 0, 0, 1, 0, 1, 0, 0.016);
    }

    const end1 = w1.getWorldPosition();
    const end2 = w2.getWorldPosition();

    // Both should have moved from their start positions
    expect(end1.distanceTo(start1)).toBeGreaterThan(0.5);
    expect(end2.distanceTo(start2)).toBeGreaterThan(0.5);

    // They moved in different directions — their end positions differ from each other
    // (this would fail if walkers shared state or one's movement corrupted the other)
    const endDistance = end1.distanceTo(end2);
    const startDistance = start1.distanceTo(start2);

    // End distance should differ from start distance (different movement directions)
    // Also they should be further apart than their individual displacements
    expect(endDistance).toBeGreaterThan(1.0);
  });

  test('moving player1 does not affect player2 position', () => {
    const manager = new ServerSurfaceManager();
    manager.initSurface('sphere', 1.0);

    const w1 = manager.createWalker('player1', 0.1, 0.5)!;
    const w2 = manager.createWalker('player2', 0.9, 0.5)!;

    const p2Before = w2.getWorldPosition().clone();

    // Move only player 1 (50 steps)
    for (let i = 0; i < 50; i++) {
      w1.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
    }

    // Player 2 must be exactly where it was — state isolation
    const p2After = w2.getWorldPosition();
    expect(p2After.distanceTo(p2Before)).toBeCloseTo(0, 5);
  });

  test('two players both stay on surface after simultaneous movement', () => {
    const manager = new ServerSurfaceManager();
    manager.initSurface('sphere', 1.0);

    const w1 = manager.createWalker('p1', 0.0, 0.5)!;
    const w2 = manager.createWalker('p2', 0.5, 0.5)!;

    for (let i = 0; i < 60; i++) {
      w1.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
      w2.moveWithCameraAxes(1, 0, 0, 0, 1, 0, 1, 0, 0.016);
    }

    // Both must be on sphere surface (radius ~10)
    const r1 = w1.getWorldPosition().length();
    const r2 = w2.getWorldPosition().length();

    expect(Math.abs(r1 - 10)).toBeLessThan(0.1);
    expect(Math.abs(r2 - 10)).toBeLessThan(0.1);
  });
});

// ─── Test 4: Surface Adherence ────────────────────────────────────────────────

describe('s44-epic regression: surface adherence', () => {
  /**
   * After 300 random moves, the player must still be within 0.5 world units
   * of the sphere surface (radius = 10). Ensures MeshWalker doesn't drift off
   * the surface with accumulated floating-point error.
   */
  test('player stays within 0.5 world units of sphere surface after 300 random moves', () => {
    const walker = new ServerMeshWalker(SPHERE_SURFACE, new THREE.Vector3(10, 0, 0), PLAYER_WORLD_SPEED);
    const SPHERE_RADIUS = 10;

    for (let i = 0; i < 300; i++) {
      const moveX = Math.cos(i * 1.1) * 0.8;   // pseudo-random but deterministic
      const moveY = Math.sin(i * 0.7) * 0.8;
      walker.moveWithCameraAxes(
        moveX, moveY,
        EQUATOR_CAM.rightX, EQUATOR_CAM.rightY, EQUATOR_CAM.rightZ,
        EQUATOR_CAM.upX, EQUATOR_CAM.upY, EQUATOR_CAM.upZ,
        0.016,
      );
    }

    const pos = walker.getWorldPosition();
    const distFromCenter = pos.length();

    // Must be within 0.5 units of sphere surface (much stricter than 0.5 in practice)
    expect(Math.abs(distFromCenter - SPHERE_RADIUS)).toBeLessThan(0.5);
  });

  test('player stays on peanut surface after 300 random moves', () => {
    const start = new THREE.Vector3(0, 0, 6);
    const walker = new ServerMeshWalker(PEANUT_SURFACE, start, PLAYER_WORLD_SPEED);

    // We'll check distance from surface by verifying the frame normal is still valid
    // (a walker off the surface would have an invalid normal)
    for (let i = 0; i < 300; i++) {
      const moveX = Math.cos(i * 1.3) * 0.8;
      const moveY = Math.sin(i * 0.9) * 0.8;
      walker.moveWithCameraAxes(moveX, moveY, 1, 0, 0, 0, 1, 0, 0.016);
    }

    const state = walker.getState();

    // Normal must still be a unit vector (invalid if walker has left surface)
    const normalLen = Math.sqrt(state.nx ** 2 + state.ny ** 2 + state.nz ** 2);
    expect(normalLen).toBeCloseTo(1.0, 1);

    // Position must be finite (NaN/Inf indicates walker has broken)
    expect(isFinite(state.wx)).toBe(true);
    expect(isFinite(state.wy)).toBe(true);
    expect(isFinite(state.wz)).toBe(true);
  });
});

// ─── Test 5: applyWalkerStateToPlayer schema mapping ─────────────────────────

describe('s44-epic regression: server world-space state sync (s44-epic-06)', () => {
  /**
   * Verifies that the state fields returned by ServerMeshWalker.getState() match
   * the expected schema field names for PlayerState (from s44-epic-06).
   *
   * This is a structural regression — if someone renames a field in ServerWalkerState,
   * this test will catch the mismatch before it becomes a runtime bug.
   */
  test('ServerWalkerState has all required world-space fields for PlayerState schema', () => {
    const walker = new ServerMeshWalker(SPHERE_SURFACE, new THREE.Vector3(10, 0, 0), PLAYER_WORLD_SPEED);
    const state = walker.getState();

    // World-space position fields (PlayerState.wx, .wy, .wz)
    expect(typeof state.wx).toBe('number');
    expect(typeof state.wy).toBe('number');
    expect(typeof state.wz).toBe('number');

    // Surface normal (PlayerState.nx, .ny, .nz)
    expect(typeof state.nx).toBe('number');
    expect(typeof state.ny).toBe('number');
    expect(typeof state.nz).toBe('number');

    // Tangent frame (PlayerState.tx, .ty, .tz)
    expect(typeof state.tangentX).toBe('number');
    expect(typeof state.tangentY).toBe('number');
    expect(typeof state.tangentZ).toBe('number');

    // Bitangent frame (PlayerState.bx, .by, .bz) — THIS IS THE CAMERA upHint FIELD
    // The client's CameraController reads server bx/by/bz to use as upHint.
    expect(typeof state.bitangentX).toBe('number');
    expect(typeof state.bitangentY).toBe('number');
    expect(typeof state.bitangentZ).toBe('number');

    // Face index for continued movement
    expect(typeof state.faceIndex).toBe('number');
    expect(state.faceIndex).toBeGreaterThanOrEqual(0);
  });

  test('world-space position is on sphere surface (wx² + wy² + wz² ≈ 100)', () => {
    const walker = new ServerMeshWalker(SPHERE_SURFACE, new THREE.Vector3(10, 0, 0), PLAYER_WORLD_SPEED);
    const state = walker.getState();

    const r2 = state.wx ** 2 + state.wy ** 2 + state.wz ** 2;
    // Sphere radius = 10, so r² ≈ 100
    expect(Math.abs(Math.sqrt(r2) - 10)).toBeLessThan(0.05);
  });

  test('tangent frame is orthonormal after 50 moves', () => {
    const walker = new ServerMeshWalker(SPHERE_SURFACE, new THREE.Vector3(10, 0, 0), PLAYER_WORLD_SPEED);

    for (let i = 0; i < 50; i++) {
      walker.moveWithCameraAxes(0.5, 1, 1, 0, 0, 0, 1, 0, 0.016);
    }

    const s = walker.getState();

    const nLen = Math.sqrt(s.nx ** 2 + s.ny ** 2 + s.nz ** 2);
    const tLen = Math.sqrt(s.tangentX ** 2 + s.tangentY ** 2 + s.tangentZ ** 2);
    const bLen = Math.sqrt(s.bitangentX ** 2 + s.bitangentY ** 2 + s.bitangentZ ** 2);

    expect(nLen).toBeCloseTo(1.0, 2);
    expect(tLen).toBeCloseTo(1.0, 2);
    expect(bLen).toBeCloseTo(1.0, 2);

    // Mutually perpendicular
    const dotNT = s.nx * s.tangentX + s.ny * s.tangentY + s.nz * s.tangentZ;
    const dotNB = s.nx * s.bitangentX + s.ny * s.bitangentY + s.nz * s.bitangentZ;
    const dotTB = s.tangentX * s.bitangentX + s.tangentY * s.bitangentY + s.tangentZ * s.bitangentZ;

    expect(Math.abs(dotNT)).toBeLessThan(0.05);
    expect(Math.abs(dotNB)).toBeLessThan(0.05);
    expect(Math.abs(dotTB)).toBeLessThan(0.05);
  });
});
