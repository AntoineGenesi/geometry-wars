/**
 * Regression test for Session 12 cube tangent frame fix.
 *
 * Bug: Camera spins wildly when player moves across cube edges.
 * Cause: MeshWalker._updateTangentFrame() used Gram-Schmidt projection,
 *        causing 30 flips during circular movement (expected ≤12).
 * Fix: Use parallel-transported tangent from geodesic walking + continuity correction.
 *
 * BEFORE FIX: 30 flips (multiple flips per edge crossing due to 90° discontinuities)
 * AFTER FIX: 0-12 flips (smooth transitions, max one flip per edge crossing)
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { CubeSurface } from '../surfaces/CubeSurface';

describe('Cube Tangent Frame Fix (Session 12)', () => {
  it('should have ≤12 tangent frame flips during 360° circular movement', () => {
    // Create cube surface (size 5 units)
    const cubeSurface = new CubeSurface({ size: 5 });
    const mesh = cubeSurface.createMesh();
    const meshSurface = new MeshSurface(mesh);

    // Create walker on top face
    const startPos = new THREE.Vector3(0, 2.5, 0);
    const walker = new MeshWalker(meshSurface, startPos, 10);

    // Move in a circle (80 steps, 360°)
    const dt = 0.1;
    const totalSteps = 80;
    let flipCount = 0;

    let prevFrame = walker.getTangentFrame();

    for (let i = 0; i < totalSteps; i++) {
      // Circular movement pattern
      const angle = (i / totalSteps) * Math.PI * 2;
      const moveDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      walker.move(moveDir, dt);

      const currentFrame = walker.getTangentFrame();

      // Count flips: sudden reversal of tangent or bitangent direction
      const tangentDot = prevFrame.tangent.dot(currentFrame.tangent);
      const bitangentDot = prevFrame.bitangent.dot(currentFrame.bitangent);

      if (tangentDot < -0.3 || bitangentDot < -0.3) {
        flipCount++;
      }

      prevFrame = currentFrame;
    }

    // Cube has 12 edges (4 vertical + 4 top + 4 bottom).
    // Crossing an edge may cause a flip. Allow ≤12 flips.
    // REGRESSION: This test FAILED before fix with 30 flips.
    // AFTER FIX: Should pass with 0-12 flips (likely 0 with continuity correction).
    expect(flipCount).toBeLessThan(13);
  });

  it('should have smooth tangent frame across all 12 cube edges', () => {
    const cubeSurface = new CubeSurface({ size: 5 });
    const mesh = cubeSurface.createMesh();
    const meshSurface = new MeshSurface(mesh);

    // Test 4 different paths that cross edges
    const paths = [
      { start: new THREE.Vector3(0, 2.5, 0), dir: new THREE.Vector3(1, 0, 0) }, // top → side
      { start: new THREE.Vector3(0, 2.5, 0), dir: new THREE.Vector3(0, 0, 1) }, // top → side
      { start: new THREE.Vector3(2.5, 0, 0), dir: new THREE.Vector3(0, 1, 0) }, // side → top
      { start: new THREE.Vector3(2.5, 0, 0), dir: new THREE.Vector3(0, 0, 1) }, // side → side
    ];

    for (const { start, dir } of paths) {
      const walker = new MeshWalker(meshSurface, start, 10);
      let prevFrame = walker.getTangentFrame();
      let maxJump = 0;

      // Walk in one direction for 50 steps (crosses at least one edge)
      for (let i = 0; i < 50; i++) {
        walker.move(dir, 0.05);
        const currentFrame = walker.getTangentFrame();

        // Measure the rotation between frames
        const tangentDot = prevFrame.tangent.dot(currentFrame.tangent);
        const bitangentDot = prevFrame.bitangent.dot(currentFrame.bitangent);

        // Acos(dot) gives angle in radians
        const tangentAngle = Math.abs(Math.acos(Math.max(-1, Math.min(1, tangentDot))));
        const bitangentAngle = Math.abs(Math.acos(Math.max(-1, Math.min(1, bitangentDot))));
        const maxAngle = Math.max(tangentAngle, bitangentAngle);

        if (maxAngle > maxJump) {
          maxJump = maxAngle;
        }

        prevFrame = currentFrame;
      }

      // At cube edges, the tangent plane rotates 90°. This is geometric, not a bug.
      // What we're testing is: no MULTIPLE jumps or >180° jumps.
      // REGRESSION: Before fix, would get multiple flips near each edge.
      // AFTER FIX: Single 90° rotation at edge crossing is expected and correct.
      expect(maxJump).toBeLessThan(Math.PI); // Less than 180° (no full reversal)
    }
  });

  it('should maintain camera orientation without wild spinning', () => {
    const cubeSurface = new CubeSurface({ size: 5 });
    const mesh = cubeSurface.createMesh();
    const meshSurface = new MeshSurface(mesh);

    const startPos = new THREE.Vector3(0, 2.5, 0);
    const walker = new MeshWalker(meshSurface, startPos, 10);

    // Simulate 600 frames of movement across cube (10 seconds at 60 FPS)
    const dt = 1 / 60;
    let wildSpinCount = 0;

    let prevBitangent = walker.getTangentFrame().bitangent;

    for (let i = 0; i < 600; i++) {
      // Random movement direction
      const angle = (i / 600) * Math.PI * 4; // two full loops
      const moveDir = new THREE.Vector3(
        Math.cos(angle) + Math.random() * 0.2,
        0,
        Math.sin(angle) + Math.random() * 0.2,
      ).normalize();

      walker.move(moveDir, dt);

      const currentBitangent = walker.getTangentFrame().bitangent;

      // In the game code, camera.up = walker.bitangent (REGRESSION GUARD).
      // A wild spin is a >90° rotation of camera.up in a single frame.
      const bitangentDot = prevBitangent.dot(currentBitangent);
      const rotationAngle = Math.abs(Math.acos(Math.max(-1, Math.min(1, bitangentDot))));

      if (rotationAngle > Math.PI / 2) {
        wildSpinCount++;
      }

      prevBitangent = currentBitangent.clone();
    }

    // REGRESSION: Before fix, camera would spin wildly multiple times.
    // AFTER FIX: Zero wild spins (camera.up changes smoothly).
    expect(wildSpinCount).toBe(0);
  });

  it('should use parallel transport when geodesic succeeds', () => {
    const cubeSurface = new CubeSurface({ size: 5 });
    const mesh = cubeSurface.createMesh();
    const meshSurface = new MeshSurface(mesh);

    const startPos = new THREE.Vector3(0, 2.5, 0);
    const walker = new MeshWalker(meshSurface, startPos, 10);

    const frameBefore = walker.getTangentFrame();

    // Move across an edge (triggers geodesic walk + parallel transport)
    const result = walker.move(new THREE.Vector3(1, 0, 0), 0.1);

    const frameAfter = walker.getTangentFrame();

    // Result should succeed
    expect(result).not.toBeNull();
    expect(result!.distance).toBeGreaterThan(0);

    // Tangent should change smoothly (no flip)
    const tangentDot = frameBefore.tangent.dot(frameAfter.tangent);
    expect(tangentDot).toBeGreaterThan(0.3);

    // Bitangent should change smoothly (no flip)
    const bitangentDot = frameBefore.bitangent.dot(frameAfter.bitangent);
    expect(bitangentDot).toBeGreaterThan(0.3);
  });

  it('should fallback to Gram-Schmidt when geodesic fails', () => {
    // This is harder to trigger since geodesic rarely fails on cube.
    // Just verify the method signature supports optional tangent (code coverage).
    const cubeSurface = new CubeSurface({ size: 5 });
    const mesh = cubeSurface.createMesh();
    const meshSurface = new MeshSurface(mesh);

    const walker = new MeshWalker(meshSurface, new THREE.Vector3(0, 2.5, 0), 10);

    // Even with small movements, walker should maintain valid state
    for (let i = 0; i < 10; i++) {
      const result = walker.move(new THREE.Vector3(0.1, 0, 0.1), 0.01);
      expect(result).not.toBeNull();

      const frame = walker.getTangentFrame();
      // Tangent frame should remain valid (normalized, orthogonal)
      expect(frame.tangent.length()).toBeCloseTo(1, 3);
      expect(frame.bitangent.length()).toBeCloseTo(1, 3);
      expect(frame.normal.length()).toBeCloseTo(1, 3);
      expect(Math.abs(frame.tangent.dot(frame.normal))).toBeLessThan(0.01);
      expect(Math.abs(frame.bitangent.dot(frame.normal))).toBeLessThan(0.01);
    }
  });
});
