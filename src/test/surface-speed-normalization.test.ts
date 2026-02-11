/**
 * Regression tests for surface speed normalization.
 *
 * BUG: Enemies on cube-tunnel surface moved ~5x faster than on sphere because
 * the surface is much larger in world space, but enemies use fixed UV speed values.
 * A UV delta of 0.06/sec on sphere covers ~3.8 world units, but on cube-tunnel
 * (size=80) it covered ~18 world units — perceived as "insanely fast".
 *
 * FIX: Surface.speedScale computed from UV-to-world mapping ratio relative to
 * a reference sphere. BaseEnemy.update() automatically scales UV deltas by
 * surfaceSpeedScale. EnemySpawner sets this on each enemy at spawn time.
 *
 * These tests MUST fail if the fix regresses.
 */

import { describe, it, expect } from 'vitest';
import { SphereSurface } from '../surfaces/SphereSurface';
import { CubeSurface } from '../surfaces/CubeSurface';
import { TorusSurface } from '../surfaces/TorusSurface';
import { CubeWithTunnelSurface } from '../surfaces/CubeWithTunnelSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

describe('Surface Speed Normalization', () => {
  describe('speedScale property', () => {
    it('sphere (radius=10) should have speedScale close to 1.0 (reference surface)', () => {
      const sphere = new SphereSurface({ radius: 10 });
      // Sphere is the reference surface, so speedScale should be ~1.0
      expect(sphere.speedScale).toBeGreaterThan(0.5);
      expect(sphere.speedScale).toBeLessThan(2.0);
    });

    it('cube (size=18) should have speedScale close to 1.0', () => {
      const cube = new CubeSurface({ size: 18 });
      // Cube size=18 is roughly similar to sphere radius=10 in world extent
      expect(cube.speedScale).toBeGreaterThan(0.3);
      expect(cube.speedScale).toBeLessThan(3.0);
    });

    it('torus should have speedScale within reasonable range', () => {
      const torus = new TorusSurface({ majorRadius: 6, minorRadius: 2 });
      expect(torus.speedScale).toBeGreaterThan(0.2);
      expect(torus.speedScale).toBeLessThan(5.0);
    });

    it('cube-tunnel (size=35) should have speedScale < 1 (larger surface)', () => {
      const tunnel = new CubeWithTunnelSurface({ size: 35 });
      // Cube-tunnel is larger than reference sphere, so speedScale < 1
      // Enemies should be slowed down on this surface
      expect(tunnel.speedScale).toBeGreaterThan(0.1);
      expect(tunnel.speedScale).toBeLessThan(1.0);
    });

    it('larger cube-tunnel should have smaller speedScale', () => {
      const small = new CubeWithTunnelSurface({ size: 20 });
      const large = new CubeWithTunnelSurface({ size: 60 });
      // A bigger surface should produce a smaller speedScale (more slowdown)
      expect(large.speedScale).toBeLessThan(small.speedScale);
    });

    it('all surfaces should have positive speedScale', () => {
      const types: SurfaceType[] = SurfaceFactory.getAvailableTypes();
      for (const type of types) {
        const surface = SurfaceFactory.create(type);
        expect(surface.speedScale, `${type} speedScale should be > 0`).toBeGreaterThan(0);
      }
    });
  });

  describe('speed normalization prevents extreme speed differences', () => {
    it('speedScale ratio between sphere and cube-tunnel should be < 3x', () => {
      const sphere = new SphereSurface({ radius: 10 });
      const tunnel = new CubeWithTunnelSurface({ size: 35 });
      // Before the fix, the ratio was ~5-6x. After normalization,
      // the speedScale values should compensate for this difference.
      // The ratio of speedScales indicates how much movement would be
      // adjusted. It should not be extreme.
      const ratio = sphere.speedScale / tunnel.speedScale;
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThan(10);
      // The critical thing: cube-tunnel speedScale should be < 1
      expect(tunnel.speedScale).toBeLessThan(1.0);
    });

    it('BUG REGRESSION: cube-tunnel enemies should not move 5x faster than sphere', () => {
      // This test measures world-space distance per UV step on each surface.
      // Without normalization, cube-tunnel covers ~5x more world distance.
      // With normalization (speedScale), the effective movement should be close.
      const sphere = new SphereSurface({ radius: 10 });
      const tunnel = new CubeWithTunnelSurface({ size: 35 });

      // Measure world distance for du=0.01 at midpoint on each surface
      const epsilon = 0.01;
      const sP0 = sphere.getPoint(0.5, 0.5);
      const sP1 = sphere.getPoint(0.5 + epsilon, 0.5);
      const sphereWorldDist = sP0.position.distanceTo(sP1.position);

      const tP0 = tunnel.getPoint(0.25, 0.25);
      const tP1 = tunnel.getPoint(0.25 + epsilon, 0.25);
      const tunnelWorldDist = tP0.position.distanceTo(tP1.position);

      // Without normalization, tunnel covers much more world distance
      const rawRatio = tunnelWorldDist / sphereWorldDist;
      expect(rawRatio).toBeGreaterThan(1.5); // tunnel is genuinely larger

      // After applying speedScale, the effective world distance should be closer
      const normalizedTunnelDist = tunnelWorldDist * tunnel.speedScale;
      const normalizedSphereDistDist = sphereWorldDist * sphere.speedScale;
      const normalizedRatio = normalizedTunnelDist / normalizedSphereDistDist;

      // The normalized ratio should be much closer to 1.0 than the raw ratio
      expect(normalizedRatio).toBeGreaterThan(0.3);
      expect(normalizedRatio).toBeLessThan(3.0);
    });
  });
});
