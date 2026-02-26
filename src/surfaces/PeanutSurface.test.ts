/**
 * PeanutSurface unit tests
 *
 * Regression tests for S36: moveOnSurface must produce constant
 * world-space speed across all V positions (no sluggish waist / fast bulge).
 */
import { describe, it, expect } from 'vitest'
import { PeanutSurface } from './PeanutSurface'

describe('PeanutSurface', () => {
  describe('moveOnSurface — constant world-space speed (S36 regression)', () => {
    const surface = new PeanutSurface()

    /**
     * Approximate world-space distance covered by a small dv step at a given V.
     * Uses finite difference via getPoint to measure actual surface displacement.
     */
    function worldDistanceForV(v: number, dv: number): number {
      const u = 0.5
      const result = surface.moveOnSurface(u, v, 0, dv)
      const before = surface.getPoint(u, v)
      const after = surface.getPoint(result.u, result.v)
      return before.position.distanceTo(after.position)
    }

    /**
     * Approximate world-space distance covered by a small du step at a given V.
     * Uses finite difference via getPoint to measure actual surface displacement.
     */
    function worldDistanceForU(v: number, du: number): number {
      const u = 0.5
      const result = surface.moveOnSurface(u, v, du, 0)
      const before = surface.getPoint(u, v)
      const after = surface.getPoint(result.u, result.v)
      return before.position.distanceTo(after.position)
    }

    it('V movement world-space speed is consistent across peanut surface', () => {
      // Test at representative V positions away from clamped poles
      // v=0.15 is near the top bulge, v=0.5 is the waist, v=0.85 is near the bottom bulge
      const dv = 0.002
      const vPositions = [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85]

      const distances = vPositions.map(v => worldDistanceForV(v, dv))

      // All V-movement distances should be within 15% of the median.
      // Without the fix, bulge distances are ~2x the waist distance.
      const median = distances.slice().sort((a, b) => a - b)[Math.floor(distances.length / 2)]
      for (const d of distances) {
        expect(d).toBeGreaterThan(median * 0.85)
        expect(d).toBeLessThan(median * 1.15)
      }
    })

    it('U movement world-space speed is consistent across peanut surface', () => {
      // Test at V positions away from the pole singularity (sinPhi→0)
      const du = 0.002
      const vPositions = [0.2, 0.35, 0.5, 0.65, 0.8]

      const distances = vPositions.map(v => worldDistanceForU(v, du))

      // All U-movement distances should be within 20% of the median.
      // Without the fix, the rNorm factor is missing so bulges are relatively faster.
      const median = distances.slice().sort((a, b) => a - b)[Math.floor(distances.length / 2)]
      for (const d of distances) {
        expect(d).toBeGreaterThan(median * 0.80)
        expect(d).toBeLessThan(median * 1.20)
      }
    })

    it('moveOnSurface wraps U and clamps V near poles', () => {
      // U wraps around
      const wrapResult = surface.moveOnSurface(0.99, 0.5, 0.1, 0)
      expect(wrapResult.u).toBeLessThan(0.5) // wrapped around 0→1

      // V clamped to avoid poles
      const poleResult = surface.moveOnSurface(0.5, 0.01, 0, -0.1)
      expect(poleResult.v).toBeGreaterThanOrEqual(0.01)

      const southResult = surface.moveOnSurface(0.5, 0.99, 0, 0.1)
      expect(southResult.v).toBeLessThanOrEqual(0.99)
    })
  })
})
