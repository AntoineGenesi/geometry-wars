import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SurfaceShockwave } from './SurfaceShockwave';
import type { Surface } from '../surfaces/Surface';
import type { SpringVertex } from '../surfaces/Surface';

// ---------------------------------------------------------------------------
// Minimal mock Surface
// ---------------------------------------------------------------------------

function makeSpring(x: number, y: number, z: number): SpringVertex {
  return {
    restPosition: new THREE.Vector3(x, y, z),
    offset: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    damping: 0.95,
    stiffness: 0.2,
  };
}

function makeMockSurface(springs: SpringVertex[]): Surface {
  return {
    gridVertexSprings: springs,
    worldRotation: new THREE.Quaternion(), // identity — no rotation
  } as unknown as Surface;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SurfaceShockwave', () => {
  let springs: SpringVertex[];
  let surface: Surface;
  let sw: SurfaceShockwave;

  beforeEach(() => {
    // Place springs at various distances from origin:
    // at distance 0: (0,0,0)
    // at distance 5: (5,0,0)
    // at distance 10: (10,0,0)
    // at distance 15: (15,0,0)
    springs = [
      makeSpring(0, 0, 0),
      makeSpring(5, 0, 0),
      makeSpring(10, 0, 0),
      makeSpring(15, 0, 0),
    ];
    surface = makeMockSurface(springs);
    sw = new SurfaceShockwave(surface);
  });

  describe('spawn', () => {
    it('creates an active wave', () => {
      expect(sw.getActiveWaveCount()).toBe(0);
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      expect(sw.getActiveWaveCount()).toBe(1);
    });

    it('supports multiple simultaneous waves up to pool limit (4)', () => {
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      sw.spawn(new THREE.Vector3(1, 0, 0), 20, 10, 5);
      sw.spawn(new THREE.Vector3(2, 0, 0), 20, 10, 5);
      sw.spawn(new THREE.Vector3(3, 0, 0), 20, 10, 5);
      expect(sw.getActiveWaveCount()).toBe(4);
    });

    it('drops new waves when pool is full', () => {
      // Spawn 5 waves into a pool of 4
      for (let i = 0; i < 5; i++) {
        sw.spawn(new THREE.Vector3(i, 0, 0), 20, 10, 5);
      }
      // Pool can hold at most 4
      expect(sw.getActiveWaveCount()).toBe(4);
    });
  });

  describe('update — radius advancement', () => {
    it('advances current radius by speed * dt each frame', () => {
      // Spawn at origin with speed=10. After dt=0.1, currentRadius should be 1.
      // We observe by checking which vertices got kicked.
      // spring at dist=5: not in [0, 1) → not kicked
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      sw.update(0.1); // ring band [0, 1)
      // dist=5 spring should NOT be kicked
      expect(springs[1].velocity.length()).toBe(0);
    });

    it('kicks vertices as ring passes over them', () => {
      // speed=10, dt=0.6 → ring crosses [0, 6): covers springs at dist=0 and dist=5
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      sw.update(0.6); // ring band [0, 6): dist=5 vertex should be kicked
      expect(springs[1].velocity.length()).toBeGreaterThan(0);
      // dist=10 not yet reached
      expect(springs[2].velocity.length()).toBe(0);
    });

    it('does not re-kick vertices already passed', () => {
      // After first update, ring passes over dist=5 vertex
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      sw.update(0.6); // ring [0, 6): dist=5 kicked
      const vel1 = springs[1].velocity.length();
      expect(vel1).toBeGreaterThan(0);

      // Second update: ring advances from 6 to 12. dist=5 is at prevRadius=6 — NOT in [6, 12)
      sw.update(0.6); // ring [6, 12): dist=5 not in band
      // velocity should not increase (spring physics may dampen but not our shockwave code)
      // we're just checking that the shockwave didn't kick it again
      // The velocity from shockwave code stays same or can drift due to spring physics
      // but shockwave should not ADD more velocity
      expect(springs[1].velocity.length()).toBeLessThanOrEqual(vel1 + 0.001);
    });
  });

  describe('update — ring band exclusivity', () => {
    it('only kicks vertices in [prevRadius, currentRadius) — not those before or after', () => {
      // speed=10. First update: ring [0, 6). Only dist=5 vertex should be kicked.
      // dist=0 is at origin (same as impact) — skipped by dist > 0.0001 guard
      // dist=10, dist=15: not in band
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      sw.update(0.6);

      expect(springs[0].velocity.length()).toBe(0); // dist=0 — skipped (too close)
      expect(springs[1].velocity.length()).toBeGreaterThan(0); // dist=5 — IN band [0,6)
      expect(springs[2].velocity.length()).toBe(0); // dist=10 — not yet
      expect(springs[3].velocity.length()).toBe(0); // dist=15 — not yet
    });

    it('kicks outward (velocity direction away from impact)', () => {
      // Spring at (5,0,0), impact at origin → expect velocity.x > 0 (outward)
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      sw.update(0.6);
      expect(springs[1].velocity.x).toBeGreaterThan(0);
    });
  });

  describe('update — wave expiry', () => {
    it('deactivates wave when ring passes maxRadius', () => {
      // maxRadius=8, speed=10. After dt=1.0, currentRadius=10 > maxRadius=8
      // Wave should stop after prevRadius >= maxRadius
      sw.spawn(new THREE.Vector3(0, 0, 0), 8, 10, 5);
      sw.update(0.85); // ring [0, 8.5): passes maxRadius=8 on this frame, clamps at 8
      expect(sw.getActiveWaveCount()).toBe(1); // still active while ring is at 8.5
      sw.update(0.01); // now prevRadius=8.5 >= maxRadius=8 → deactivate
      expect(sw.getActiveWaveCount()).toBe(0);
    });

    it('does not kick vertices beyond maxRadius', () => {
      // maxRadius=8. Vertex at dist=10 should never get kicked.
      sw.spawn(new THREE.Vector3(0, 0, 0), 8, 10, 5);
      sw.update(0.5); // ring [0, 5)
      sw.update(0.5); // ring [5, 8] (capped at maxRadius=8)
      sw.update(0.5); // wave expired
      expect(springs[2].velocity.length()).toBe(0); // dist=10 — beyond maxRadius
    });
  });

  describe('multiple waves', () => {
    it('advances all active waves independently', () => {
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);  // wave 1
      sw.spawn(new THREE.Vector3(0, 0, 0), 20, 20, 5);  // wave 2 (faster)
      sw.update(0.4); // wave1 ring [0, 4), wave2 ring [0, 8)

      // dist=5 only covered by wave2 in this step (wave1 [0,4) misses it)
      expect(springs[1].velocity.length()).toBeGreaterThan(0); // wave2 reached it
    });
  });

  describe('world rotation', () => {
    it('applies inverse worldRotation to convert impact point to local space', () => {
      // Surface rotated 90° around Y: local(5,0,0) ↔ world(0,0,-5).
      // Impact is at world origin (0,0,0) → local origin (invariant under rotation).
      // Spring at local(5,0,0): dist=5 from local origin → in ring [0,6).
      const rotSurface = makeMockSurface([makeSpring(5, 0, 0)]) as any;
      rotSurface.worldRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 2
      );
      const rotSW = new SurfaceShockwave(rotSurface);

      // Impact at world origin → after inverse rotation still at local origin.
      // Spring at local (5,0,0) is dist=5 away, falls in ring band [0, 6).
      rotSW.spawn(new THREE.Vector3(0, 0, 0), 20, 10, 5);
      rotSW.update(0.6); // ring [0, 6): local dist=5 in band → spring kicked

      expect(rotSurface.gridVertexSprings[0].velocity.length()).toBeGreaterThan(0);
    });

    it('uses local-space distances (rotation transforms impact correctly)', () => {
      // Two springs: A at local(5,0,0)→world(0,0,-5), B at local(0,0,5)→world(5,0,0)
      // Surface rotated 90° around Y.
      // Impact at world(4,0,0) → inverse-rotate(-90° around Y) → local(0,0,4).
      // dist to spring A local(5,0,0): sqrt(25+16) ≈ 5.66 → in ring [0,7)
      // dist to spring B local(0,0,5): 1 → in ring [0,7)
      // Without inverse rotation (wrong): world impact(4,0,0) vs local(0,0,5) = 6.4 → outside [0,7)
      // So spring B being kicked proves inverse rotation is applied correctly.
      const springA = makeSpring(5, 0, 0);
      const springB = makeSpring(0, 0, 5);
      const rotSurface = makeMockSurface([springA, springB]) as any;
      rotSurface.worldRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 2
      );
      const rotSW = new SurfaceShockwave(rotSurface);

      rotSW.spawn(new THREE.Vector3(4, 0, 0), 20, 10, 5);
      rotSW.update(0.7); // ring [0, 7)

      // Spring B (local dist=1 from local impact (0,0,4)) should be kicked
      expect(springB.velocity.length()).toBeGreaterThan(0);
    });
  });
});
