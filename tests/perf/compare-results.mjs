#!/usr/bin/env node
/**
 * Geometry Wars 3D — Benchmark Comparison
 *
 * Compares two benchmark result JSON files and prints a delta table
 * with a KEEP / REVERT verdict.
 *
 * Usage:
 *   node tests/perf/compare-results.mjs before.json after.json
 *   node tests/perf/compare-results.mjs tests/perf/results/before-bloom.json tests/perf/results/after-bloom.json
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node compare-results.mjs <before.json> <after.json>');
  process.exit(1);
}

function loadResult(filePath) {
  const fullPath = filePath.startsWith('/')
    ? filePath
    : resolve(PROJECT_ROOT, filePath);
  try {
    return JSON.parse(readFileSync(fullPath, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${fullPath}: ${err.message}`);
    process.exit(1);
  }
}

const before = loadResult(args[0]);
const after = loadResult(args[1]);

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function pct(before, after) {
  if (before === 0) return after === 0 ? 0 : Infinity;
  return ((after - before) / Math.abs(before)) * 100;
}

function formatPct(p, higherIsBetter) {
  if (!isFinite(p)) return '   N/A  ';
  const sign = p > 0 ? '+' : '';
  const val = `${sign}${p.toFixed(1)}%`;
  const isImproved = higherIsBetter ? p > 0 : p < 0;
  const isRegressed = higherIsBetter ? p < -2 : p > 2;
  const verdict = isImproved ? '✓ IMPROVED' : isRegressed ? '✗ REGRESSED' : '- UNCHANGED';
  return { formatted: val.padStart(8), verdict };
}

function pad(val, width) {
  return String(val).padStart(width);
}

// ---------------------------------------------------------------------------
// Print comparison table
// ---------------------------------------------------------------------------

const metrics = [
  { key: 'avgFps',        label: 'Avg FPS',     higherIsBetter: true  },
  { key: 'minFps',        label: 'Min FPS',     higherIsBetter: true  },
  { key: 'p95FrameTimeMs', label: 'P95 frame',  higherIsBetter: false },
  { key: 'drawCalls',     label: 'Draw calls',  higherIsBetter: false },
  { key: 'triangles',     label: 'Triangles',   higherIsBetter: false },
  { key: 'geometries',    label: 'Geometries',  higherIsBetter: false },
];

console.log('');
console.log('='.repeat(60));
console.log('  === Benchmark Comparison ===');
console.log('');
console.log(`  Before : ${args[0]}`);
console.log(`  After  : ${args[1]}`);
if (before.entityCount !== after.entityCount) {
  console.warn(`  WARNING: Entity counts differ (${before.entityCount} vs ${after.entityCount})`);
}
console.log('');

const headerLabel = 'Metric          ';
const headerBefore = '  Before';
const headerAfter = '   After';
const headerDelta = '    Delta';
console.log(`  ${headerLabel}${headerBefore}${headerAfter}${headerDelta}  Verdict`);
console.log('  ' + '-'.repeat(55));

let hasImprovement = false;
let hasRegression = false;
let fpsImprovement = 0;

for (const { key, label, higherIsBetter } of metrics) {
  const b = before[key] ?? 0;
  const a = after[key] ?? 0;
  const p = pct(b, a);
  const { formatted, verdict } = formatPct(p, higherIsBetter);

  const unit = key === 'p95FrameTimeMs' ? 'ms' : '';
  const bStr = pad(`${b}${unit}`, 7);
  const aStr = pad(`${a}${unit}`, 7);
  console.log(`  ${label.padEnd(16)}${bStr}  ${aStr}  ${formatted}  ${verdict}`);

  if (verdict.includes('IMPROVED')) hasImprovement = true;
  if (verdict.includes('REGRESSED')) hasRegression = true;
  if (key === 'avgFps') fpsImprovement = p;
}

console.log('  ' + '-'.repeat(55));
console.log('');

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

// KEEP if avg FPS improved >5% AND no regressions; REVERT otherwise
const KEEP_THRESHOLD = 5; // % FPS improvement required to KEEP
let verdict;
let reason;

if (hasRegression) {
  verdict = 'REVERT';
  reason = 'regressions detected';
} else if (fpsImprovement > KEEP_THRESHOLD) {
  verdict = 'KEEP';
  reason = `avg FPS improved ${fpsImprovement.toFixed(1)}% (threshold: ${KEEP_THRESHOLD}%)`;
} else if (fpsImprovement > 0) {
  verdict = 'KEEP (marginal)';
  reason = `avg FPS improved ${fpsImprovement.toFixed(1)}% — below ${KEEP_THRESHOLD}% threshold but no regressions`;
} else if (fpsImprovement < -2) {
  verdict = 'REVERT';
  reason = `avg FPS degraded ${Math.abs(fpsImprovement).toFixed(1)}%`;
} else {
  verdict = 'NEUTRAL';
  reason = 'no significant change';
}

console.log(`  VERDICT: ${verdict} (${reason})`);
console.log('');
console.log('='.repeat(60));
console.log('');
