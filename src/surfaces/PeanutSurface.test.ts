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

    it('worldToSurface round-trip is accurate at all V positions (s44f-08 regression)', () => {
      // s44f-08: worldToSurface was inaccurate at the peanut waist because it
      // estimated scale using totalDist/maxProfileR. At the waist, the radius is
      // much smaller than maxProfileR, so the estimated scale was too low, causing
      // the phi scan to find the wrong position (shifted toward the bulge).
      // This manifested as MP bullets spawning offset from the player on peanut.
      const testUV = [
        { u: 0.25, v: 0.15 }, // near top bulge
        { u: 0.5, v: 0.3 },   // between bulge and waist
        { u: 0.75, v: 0.5 },  // at the waist (where the bug was worst)
        { u: 0.1, v: 0.65 },  // between waist and bottom bulge
        { u: 0.6, v: 0.85 },  // near bottom bulge
      ]

      for (const { u, v } of testUV) {
        const pt = surface.getPoint(u, v)
        const recovered = surface.worldToSurface(pt.position)
        // V should be accurate within 0.02 (1 step of the 100-step scan)
        const vErr = Math.abs(recovered.v - v)
        expect(vErr, `worldToSurface V error at (${u},${v}): ${vErr}`).toBeLessThan(0.02)
        // U should be accurate within 0.02
        let uErr = Math.abs(recovered.u - u)
        if (uErr > 0.5) uErr = 1 - uErr // wrap-aware
        expect(uErr, `worldToSurface U error at (${u},${v}): ${uErr}`).toBeLessThan(0.02)
      }
    })

    it('worldToSurface round-trip is accurate with scaled inputs (s44f-08 regression)', () => {
      // Simulates MP scenario where worldPos is scaled by mapSizeScaleFactor (e.g., 2.0)
      const scale = 2.0
      const testUV = [
        { u: 0.25, v: 0.15 },
        { u: 0.5, v: 0.5 },   // waist — the critical failure point
        { u: 0.75, v: 0.85 },
      ]

      for (const { u, v } of testUV) {
        const pt = surface.getPoint(u, v)
        const scaledPos = pt.position.clone().multiplyScalar(scale)
        const recovered = surface.worldToSurface(scaledPos)
        const vErr = Math.abs(recovered.v - v)
        expect(vErr, `worldToSurface V error at scaled (${u},${v}): ${vErr}`).toBeLessThan(0.02)
        let uErr = Math.abs(recovered.u - u)
        if (uErr > 0.5) uErr = 1 - uErr
        expect(uErr, `worldToSurface U error at scaled (${u},${v}): ${uErr}`).toBeLessThan(0.02)
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

  describe('getPlayerSpeedCorrectionAt — UV-aware speed normalization (s44j-12 regression)', () => {
    const surface = new PeanutSurface()

    it('returns > 1.0 on the bulge (wider areas, v ≈ 0.25 and 0.75)', () => {
      // The peanut bulge is wider than average — player should move faster there
      // to cover the same UV fraction per second as on the waist
      const bulgeFactor = surface.getPlayerSpeedCorrectionAt(0.5, 0.25)
      expect(bulgeFactor).toBeGreaterThan(1.0)
    })

    it('returns < 1.0 on the waist (narrower area, v ≈ 0.5)', () => {
      // The waist is narrower than average — player should move slower to be consistent
      const waistFactor = surface.getPlayerSpeedCorrectionAt(0.5, 0.5)
      expect(waistFactor).toBeLessThan(1.0)
    })

    it('returns a value clamped within [0.4, 2.5]', () => {
      const testVPositions = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]
      for (const v of testVPositions) {
        const factor = surface.getPlayerSpeedCorrectionAt(0.5, v)
        expect(factor, `factor at v=${v}`).toBeGreaterThanOrEqual(0.4)
        expect(factor, `factor at v=${v}`).toBeLessThanOrEqual(2.5)
      }
    })

    it('correction is U-independent (surface of revolution)', () => {
      // The peanut is a surface of revolution — U should not affect the metric
      const v = 0.3
      const factorU0 = surface.getPlayerSpeedCorrectionAt(0.0, v)
      const factorU5 = surface.getPlayerSpeedCorrectionAt(0.5, v)
      const factorU9 = surface.getPlayerSpeedCorrectionAt(0.9, v)
      expect(Math.abs(factorU0 - factorU5)).toBeLessThan(0.001)
      expect(Math.abs(factorU0 - factorU9)).toBeLessThan(0.001)
    })

    it('area-weighted average correction is approximately 1.0', () => {
      // The correction is designed to be area-averaged to 1.0, so average speed is preserved
      const STEPS = 40
      let totalWeight = 0
      let totalFactor = 0
      for (let i = 1; i < STEPS; i++) {
        const v = i / STEPS
        const phi = v * Math.PI
        const weight = Math.sin(phi) // area element on surface of revolution
        totalFactor += surface.getPlayerSpeedCorrectionAt(0.5, v) * weight
        totalWeight += weight
      }
      const avgFactor = totalFactor / totalWeight
      // Should be close to 1.0 (within 5% — clamping may shift it slightly)
      expect(avgFactor).toBeGreaterThan(0.95)
      expect(avgFactor).toBeLessThan(1.05)
    })
  })
})
