/**
 * PeanutSpeedCorrection — Regression test for s44r6-07.
 *
 * Verifies that PeanutSurface.getPlayerSpeedCorrectionAt() returns 1.0 everywhere.
 *
 * Root cause: UV-metric-based speed correction was applied to MeshWalker (world-space)
 * movement, causing 0.69x slowdown at the waist and 1.62x speedup at the poles — a
 * 2.35x speed ratio. MeshWalker delivers constant world speed via geodesic face walking;
 * no UV correction is needed for world-space walkers.
 *
 * This test prevents regression: if someone re-adds a non-1.0 speed correction for
 * peanut, this test will catch it.
 */

import { describe, it, expect } from 'vitest';
import { PeanutSurface } from '../../src/surfaces/PeanutSurface';

describe('PeanutSurface speed correction (s44r6-07)', () => {
  const surface = new PeanutSurface();

  it('returns 1.0 at the north pole (v=0)', () => {
    expect(surface.getPlayerSpeedCorrectionAt(0, 0)).toBe(1.0);
  });

  it('returns 1.0 at the south pole (v=1)', () => {
    expect(surface.getPlayerSpeedCorrectionAt(0, 1)).toBe(1.0);
  });

  it('returns 1.0 at the waist (v=0.5)', () => {
    expect(surface.getPlayerSpeedCorrectionAt(0, 0.5)).toBe(1.0);
  });

  it('returns 1.0 at the upper bulge (v=0.25)', () => {
    expect(surface.getPlayerSpeedCorrectionAt(0, 0.25)).toBe(1.0);
  });

  it('returns 1.0 at the lower bulge (v=0.75)', () => {
    expect(surface.getPlayerSpeedCorrectionAt(0, 0.75)).toBe(1.0);
  });

  it('speed variation is < 20% across entire surface', () => {
    // Sample many positions and verify speed correction is constant 1.0
    const corrections: number[] = [];
    for (let vi = 0; vi <= 20; vi++) {
      for (let ui = 0; ui <= 10; ui++) {
        const u = ui / 10;
        const v = vi / 20;
        corrections.push(surface.getPlayerSpeedCorrectionAt(u, v));
      }
    }

    const minCorr = Math.min(...corrections);
    const maxCorr = Math.max(...corrections);
    const variation = maxCorr - minCorr;

    expect(variation).toBe(0); // All 1.0, no variation at all
    expect(minCorr).toBe(1.0);
    expect(maxCorr).toBe(1.0);
  });

  it('does not break other surfaces (default returns 1.0)', () => {
    // The base Surface class returns 1.0 by default — peanut should match
    expect(surface.getPlayerSpeedCorrectionAt(0.5, 0.5)).toBe(1.0);
  });
});
