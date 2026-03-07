/**
 * SPGridRunner — Runs SurfaceGridWalker across all 13 surface types.
 *
 * Produces an SPGridReport with aggregated results for all surfaces.
 * Results are written to reports/grid-traversal-sp-latest.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SurfaceGridWalker, SurfaceGridResult } from './SurfaceGridWalker';
import type { SurfaceType } from '../../src/surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SPGridReport {
  runDate: string;
  gridDensity: number;
  surfaces: SurfaceGridResult[];
  totalStuck: number;
  totalPoints: number;
  worstSurface: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All 13 surface types in deterministic order. */
export const ALL_SURFACES: SurfaceType[] = [
  'sphere',
  'cube',
  'pill',
  'pipe',
  'torus',
  'peanut',
  'capsule',
  'icosahedron',
  'mobius',
  'sphere-tunnel',
  'cube-ring',
  'cube-tunnel',
  'mobius-bevel',
];

/** Default density for CI runs. Full density (15) is used for manual runs only. */
const DEFAULT_DENSITY = 8;

/** Default frames per point. */
const DEFAULT_FRAMES_PER_POINT = 60;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run the full SP grid traversal suite across all 13 surfaces.
 *
 * @param density        - Grid density (density × density = points per surface). Default 8 for CI.
 * @param framesPerPoint - Frames to hold each direction key per point. Default 60.
 * @returns              - New SPGridReport (immutable — each call returns a new object).
 */
export function runSPGrid(
  density: number = DEFAULT_DENSITY,
  framesPerPoint: number = DEFAULT_FRAMES_PER_POINT,
): SPGridReport {
  const overallStart = Date.now();
  const surfaces: SurfaceGridResult[] = [];

  for (const surface of ALL_SURFACES) {
    const result = SurfaceGridWalker.runGrid(surface, density, framesPerPoint);
    surfaces.push(result);
  }

  const totalStuck = surfaces.reduce((sum, r) => sum + r.stuckCount, 0);
  const totalPoints = surfaces.reduce((sum, r) => sum + r.points.length, 0);

  const worstSurface = surfaces.reduce<SurfaceGridResult | null>((worst, r) => {
    if (worst === null) return r.stuckCount > 0 ? r : null;
    return r.stuckCount > worst.stuckCount ? r : worst;
  }, null);

  const report: SPGridReport = {
    runDate: new Date().toISOString(),
    gridDensity: density,
    surfaces,
    totalStuck,
    totalPoints,
    worstSurface: worstSurface ? worstSurface.surface : null,
    durationMs: Date.now() - overallStart,
  };

  return report;
}

/**
 * Write an SPGridReport to the standard output path.
 * Creates the reports/ directory if it doesn't exist.
 */
export function writeGridReport(report: SPGridReport, outputPath?: string): void {
  const reportPath =
    outputPath ??
    path.resolve(__dirname, '../../reports/grid-traversal-sp-latest.json');

  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
}
