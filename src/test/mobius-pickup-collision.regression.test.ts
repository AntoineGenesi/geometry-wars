/**
 * Regression test: Mobius strip pickup collision — S28b fix
 *
 * Root cause: MobiusSurface.worldToSurface() used absolute distance calculations
 * that are NOT scale-invariant. At EPIC map scale (2x), enemy/player positions are
 * in scaled world space but the Mobius parametric equations use 1x local coords.
 * This caused v to be computed outside [0,1], clamped to strip edges, so pickups
 * spawned at wrong positions and player UV never matched pickup UV.
 *
 * Fix: MobiusSurface.worldToSurface now divides by this.group.scale.x before
 * computing UV, ensuring correct results regardless of map size scale.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MobiusSurface } from '../surfaces/MobiusSurface';
import { MobiusBevelSurface } from '../surfaces/MobiusBevelSurface';

describe('Mobius strip worldToSurface scale invariance (S28b regression)', () => {
  const SCALES = [1.0, 1.5, 2.0]; // SMALL=0.75, MEDIUM=1.0, LARGE=1.5, EPIC=2.0

  describe('MobiusSurface', () => {
    it('worldToSurface(getPoint(u,v).position * scale) ≈ (u,v) at all map scales', () => {
      const testPoints = [
        { u: 0.1, v: 0.3 },
        { u: 0.25, v: 0.5 },
        { u: 0.3, v: 0.7 },
        { u: 0.5, v: 0.3 },
        { u: 0.5, v: 0.5 },
        { u: 0.5, v: 0.7 },
        { u: 0.75, v: 0.4 },
        { u: 0.9, v: 0.6 },
      ];

      for (const scale of SCALES) {
        const surface = new MobiusSurface();
        // Apply the group scale (as main.ts does for EPIC maps)
        surface.group.scale.setScalar(scale);

        for (const { u, v } of testPoints) {
          // Get the 1x local position
          const pt = surface.getPoint(u, v);
          // Simulate scaled world position (as seen by enemies/player at EPIC scale)
          const scaledPos = pt.position.clone().multiplyScalar(scale);

          const recovered = surface.worldToSurface(scaledPos);

          expect(recovered.u).toBeCloseTo(u, 1);
          expect(recovered.v).toBeCloseTo(v, 1);
        }
      }
    });

    it('player UV ≈ pickup UV when player stands on pickup at EPIC scale', () => {
      const surface = new MobiusSurface();
      surface.group.scale.setScalar(2.0); // EPIC scale

      // Simulate: enemy dies at (u=0.3, v=0.7)
      const enemyU = 0.3, enemyV = 0.7;
      const enemyWorldPos = surface.getPoint(enemyU, enemyV).position.clone().multiplyScalar(2.0);

      // Pickup spawns at UV from worldToSurface(enemy.position)
      const pickupUV = surface.worldToSurface(enemyWorldPos);

      // Player walks to same world position
      const playerUV = surface.worldToSurface(enemyWorldPos);

      // Both should give same UV (collision can fire)
      expect(playerUV.u).toBeCloseTo(pickupUV.u, 3);
      expect(playerUV.v).toBeCloseTo(pickupUV.v, 3);

      // And they should be close to the original enemy UV
      expect(pickupUV.u).toBeCloseTo(enemyU, 1);
      expect(pickupUV.v).toBeCloseTo(enemyV, 1);
    });

    it('v coordinate is NOT clamped to 0/1 at EPIC scale for interior points', () => {
      const surface = new MobiusSurface();
      surface.group.scale.setScalar(2.0);

      // Before fix: v was always clamped to 0 or 1 at 2x scale
      // After fix: v should be well within (0.1, 0.9) for interior points
      const testPoints = [
        { u: 0.0, v: 0.5 },
        { u: 0.25, v: 0.5 },
        { u: 0.5, v: 0.5 },
        { u: 0.75, v: 0.5 },
        { u: 0.3, v: 0.3 },
        { u: 0.3, v: 0.7 },
      ];

      for (const { u, v } of testPoints) {
        const pt = surface.getPoint(u, v);
        const scaledPos = pt.position.clone().multiplyScalar(2.0);
        const recovered = surface.worldToSurface(scaledPos);

        // v must NOT be stuck at the strip edges
        expect(recovered.v).toBeGreaterThan(0.05);
        expect(recovered.v).toBeLessThan(0.95);
      }
    });
  });

  describe('MobiusBevelSurface', () => {
    it('worldToSurface is scale-invariant at EPIC scale', () => {
      const surface = new MobiusBevelSurface();
      surface.group.scale.setScalar(2.0);

      const testPoints = [
        { u: 0.25, v: 0.25 },
        { u: 0.5, v: 0.5 },
        { u: 0.75, v: 0.75 },
      ];

      for (const { u, v } of testPoints) {
        const pt = surface.getPoint(u, v);
        const scaledPos = pt.position.clone().multiplyScalar(2.0);
        const recovered = surface.worldToSurface(scaledPos);

        expect(recovered.u).toBeCloseTo(u, 1);
        expect(recovered.v).toBeCloseTo(v, 1);
      }
    });
  });
});
