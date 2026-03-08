/**
 * Regression tests for s44r3-06:
 * Snake enemy bodies spawning inside pill surface / scattered at spawn.
 *
 * ROOT CAUSE 1 (transform cache):
 *   EnemySpawner.getCachedTransform() stores world-space transforms that include
 *   surface.worldRotation at cache time. As the surface rotates (player moves),
 *   cached entries become stale. Snake segments stay in the same UV cell for
 *   multiple frames → stale cache hit → segments rendered at pre-rotation positions.
 *
 * FIX 1: Add this.transformMap.clear() at start of EnemySpawner.update().
 *
 * ROOT CAUSE 2 (initial UV scatter):
 *   Snake.initSegments() and GiantSnake.createSegments() place initial segments at
 *   u = headU - (i+1)*step. For snakes with many segments near u=0,
 *   u goes negative (e.g., headU=0.1, step=0.09, seg1 → u=-0.08).
 *   Trig functions handle negative u, but place segments at the WRONG azimuthal
 *   position (opposite side of pill), appearing "randomly scattered" at spawn.
 *
 * FIX 2: Wrap initial u to [0,1) in initSegments / createSegments.
 *
 * ROOT CAUSE 3 (GiantSnake walker UV sync):
 *   GiantSnake.computeMovementDirection() calls worldToSurface(closest.point) without
 *   applying inverse worldRotation first. worldToSurface() expects local coordinates
 *   (before rotation). Produces wrong UV when surface has rotated, causing subsequent
 *   applySurfaceTransform to use wrong UV positions.
 *
 * FIX 3: Apply inverse worldRotation before worldToSurface (same as BaseEnemy.update()).
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { Snake } from './Snake';
import { GiantSnake } from './GiantSnake';

// ─────────────────────── Root Cause 2: Initial UV scatter ────────────────────────
// These tests FAIL on current code and PASS after fix.

describe('Snake initSegments — initial segment UV must be in [0,1) range (s44r3-06)', () => {
  afterAll(() => {
    Snake.onHeadDeath = null;
    Snake.onSegmentDeath = null;
  });

  it('default snake (2 segs) initial UV stays in [0,1)', () => {
    const snake = new Snake(0.5, 0.5, 14, 2);
    const segs = snake.getSegmentData();
    for (const seg of segs) {
      expect(seg.u).toBeGreaterThanOrEqual(0);
      expect(seg.u).toBeLessThan(1);
    }
    snake.destroy();
  });

  it('snake at u=0.1 with 5 segments: seg 1 was u=-0.08 (out of range) — must wrap', () => {
    // Before fix: seg1.u = 0.1 - 2*0.09 = -0.08  → fails [0,1) check
    // After fix: wraps to 0.92
    const snake = new Snake(0.1, 0.5, 14, 5);
    const segs = snake.getSegmentData();
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].u).toBeGreaterThanOrEqual(0);
      expect(segs[i].u).toBeLessThan(1);
    }
    snake.destroy();
  });

  it('snake at u=0.05 with 3 segments: seg 0 was u=-0.04 — must wrap', () => {
    const snake = new Snake(0.05, 0.5, 14, 3);
    const segs = snake.getSegmentData();
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].u).toBeGreaterThanOrEqual(0);
      expect(segs[i].u).toBeLessThan(1);
    }
    snake.destroy();
  });

  it('snake with max 14 segments at u=0.1 — all segs in [0,1)', () => {
    // Without fix: segs 1-14 all go negative (u = 0.1 - 2*0.09 = -0.08, ..., -1.17)
    const snake = new Snake(0.1, 0.5, 14, 14);
    const segs = snake.getSegmentData();
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].u).toBeGreaterThanOrEqual(0);
      expect(segs[i].u).toBeLessThan(1);
    }
    snake.destroy();
  });
});

describe('GiantSnake createSegments — initial segment UV must be in [0,1) range (s44r3-06)', () => {
  it('GiantSnake at u=0.5 with 7 segs: seg 6 was u=-0.34 — must wrap', () => {
    // Without fix: seg6.u = 0.5 - 7*0.12 = -0.34 → out of range
    const gs = new GiantSnake(0.5, 0.5, 7);
    const segs = gs.getSegmentData();
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].surface.u).toBeGreaterThanOrEqual(0);
      expect(segs[i].surface.u).toBeLessThan(1);
    }
    gs.destroy();
  });

  it('GiantSnake at u=0.1 with 7 segs: seg 0 was u=-0.02 — must wrap', () => {
    // Without fix: seg0.u = 0.1 - 1*0.12 = -0.02 (already out of range!)
    const gs = new GiantSnake(0.1, 0.5, 7);
    const segs = gs.getSegmentData();
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].surface.u).toBeGreaterThanOrEqual(0);
      expect(segs[i].surface.u).toBeLessThan(1);
    }
    gs.destroy();
  });

  it('GiantSnake at u=0.05 with 7 segs — all segs in [0,1)', () => {
    const gs = new GiantSnake(0.05, 0.5, 7);
    const segs = gs.getSegmentData();
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i].surface.u).toBeGreaterThanOrEqual(0);
      expect(segs[i].surface.u).toBeLessThan(1);
    }
    gs.destroy();
  });
});

// ─────────────────────── Root Cause 1: Stale transform cache (logic proof) ───────
// Documents the bug via pure logic. The actual fix is in EnemySpawner.update().

describe('Transform cache staleness — pure logic (s44r3-06 root cause 1)', () => {
  it('cache cleared each frame ensures fresh transform is returned after rotation', () => {
    let worldRotationAngle = 0;

    const getTransform = (u: number, v: number) => ({
      position: new THREE.Vector3(
        10 * Math.cos(u * Math.PI * 2 + worldRotationAngle),
        v,
        10 * Math.sin(u * Math.PI * 2 + worldRotationAngle),
      ),
      normal: new THREE.Vector3(Math.cos(u * Math.PI * 2 + worldRotationAngle), 0, Math.sin(u * Math.PI * 2 + worldRotationAngle)),
      tangent: new THREE.Vector3(1, 0, 0),
      bitangent: new THREE.Vector3(0, 1, 0),
    });

    // Simulate the cache (same logic as EnemySpawner.getCachedTransform)
    const cache = new Map<number, ReturnType<typeof getTransform>>();
    const getCached = (u: number, v: number) => {
      const gs = 0.005;
      const key = (Math.round(u / gs) << 14) | (Math.round(v / gs) & 0x3FFF);
      if (!cache.has(key)) cache.set(key, getTransform(u, v));
      return cache.get(key)!;
    };

    const u = 0.4, v = 0.5;

    // Frame 1: cache populated at rotation=0
    worldRotationAngle = 0;
    const frame1 = getCached(u, v);
    const posX_frame1 = frame1.position.x; // ≈ 10 * cos(0.8π)

    // Surface rotates by 90°
    worldRotationAngle = Math.PI / 2;

    // WITHOUT cache clear (current bug): same UV → stale cache hit
    const frame2_stale = getCached(u, v);
    expect(frame2_stale.position.x).toBeCloseTo(posX_frame1, 5); // stale!

    // WITH cache clear (the fix): fresh computation
    cache.clear(); // = what EnemySpawner.update() now does at frame start
    const frame2_fresh = getCached(u, v);
    // After 90° rotation, position is different
    expect(frame2_fresh.position.x).not.toBeCloseTo(posX_frame1, 1);
  });
});

// ─────────────────────── Integration: Segments land on surface ───────────────────

describe('Snake segment positioning with pill surface transform (s44r3-06 integration)', () => {
  it('snake segments are positioned on or above the pill surface (not inside it)', () => {
    const PILL_RADIUS = 10;
    const getTransform = (u: number, v: number) => {
      const theta = ((u % 1) + 1) % 1 * Math.PI * 2; // normalize u before use
      return {
        position: new THREE.Vector3(PILL_RADIUS * Math.cos(theta), v * 4 - 2, PILL_RADIUS * Math.sin(theta)),
        normal: new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)),
        tangent: new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta)),
        bitangent: new THREE.Vector3(0, 1, 0),
      };
    };

    const snake = new Snake(0.5, 0.5, 14, 5);

    // Build position history so segments have valid trailing positions
    for (let i = 0; i < 40; i++) {
      snake.updateBehavior(0.016, 0.5, 0.5);
    }
    snake.applySurfaceTransform(getTransform);

    // All segment meshes should be outside the pill surface (radius >= PILL_RADIUS)
    for (const seg of (snake as any).segs as Array<{ u: number; v: number; mesh: { position: THREE.Vector3 } }>) {
      const meshPos = seg.mesh.position;
      const distFromYAxis = Math.sqrt(meshPos.x * meshPos.x + meshPos.z * meshPos.z);
      // Segment should be at PILL_RADIUS + snake.radius (0.30), so ~10.3
      // Must NOT be < 9 (which would indicate inside the surface)
      expect(distFromYAxis).toBeGreaterThan(PILL_RADIUS * 0.9);
    }

    snake.destroy();
  });
});
