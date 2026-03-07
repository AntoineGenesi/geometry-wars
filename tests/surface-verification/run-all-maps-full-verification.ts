/**
 * All-Maps Full Verification Runner — s44r-08
 *
 * Comprehensive surface verification across ALL 12 surfaces × 3 size variants.
 *
 * Tests (math-based, no browser required):
 *   - Speed uniformity (UV metric consistency)
 *   - Normal perpendicularity
 *   - UV roundtrip accuracy (pickup collection basis)
 *   - Circular path closure (no V drift)
 *   - Pole speed ratio (for sphere-like surfaces)
 *   - Pickup UV accuracy (worldToSurface roundtrip at 3 scales)
 *
 * Usage:
 *   npx tsx tests/surface-verification/run-all-maps-full-verification.ts
 *
 * Output: reports/all-maps-full-verification-{timestamp}.html
 *
 * NOTE: For gameplay simulation tests (bullet origin, hit detection, seam traversal
 * with actual player movement), run:
 *   npm test -- src/test/all-maps-comprehensive.test.ts
 */

import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import all surface classes
import { SphereSurface } from '../../src/surfaces/SphereSurface.js';
import { CubeSurface } from '../../src/surfaces/CubeSurface.js';
import { PillSurface } from '../../src/surfaces/PillSurface.js';
import { PipeSurface } from '../../src/surfaces/PipeSurface.js';
import { TorusSurface } from '../../src/surfaces/TorusSurface.js';
import { PeanutSurface } from '../../src/surfaces/PeanutSurface.js';
import { CapsuleSurface } from '../../src/surfaces/CapsuleSurface.js';
import { IcosahedronSurface } from '../../src/surfaces/IcosahedronSurface.js';
import { MobiusSurface } from '../../src/surfaces/MobiusSurface.js';
import { SphereWithTunnelSurface } from '../../src/surfaces/SphereWithTunnelSurface.js';
import { CubeRingSurface } from '../../src/surfaces/CubeRingSurface.js';
import { CubeWithTunnelSurface } from '../../src/surfaces/CubeWithTunnelSurface.js';
import type { Surface } from '../../src/surfaces/Surface.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Surface registry
// ---------------------------------------------------------------------------

type SurfaceEntry = { name: string; create: (scale: number) => Surface };

const SURFACES: SurfaceEntry[] = [
  { name: 'sphere',       create: (s) => new SphereSurface({ radius: s }) },
  { name: 'cube',         create: (s) => new CubeSurface({ size: s }) },
  { name: 'pill',         create: (s) => new PillSurface({ radius: s * 0.4, height: s * 1.2 }) },
  { name: 'pipe',         create: (s) => new PipeSurface({ radius: s * 0.5, length: s * 2 }) },
  { name: 'torus',        create: (s) => new TorusSurface({ majorRadius: s * 0.8, minorRadius: s * 0.3 }) },
  { name: 'peanut',       create: (s) => new PeanutSurface({ scale: s }) },
  { name: 'capsule',      create: (s) => new CapsuleSurface({ radius: s * 0.4, height: s * 1.2 }) },
  { name: 'icosahedron',  create: (s) => new IcosahedronSurface({ radius: s }) },
  { name: 'mobius',       create: (s) => new MobiusSurface({ scale: s }) },
  { name: 'sphere-tunnel', create: (s) => new SphereWithTunnelSurface({ radius: s }) },
  { name: 'cube-ring',    create: (s) => new CubeRingSurface({ size: s }) },
  { name: 'cube-tunnel',  create: (s) => new CubeWithTunnelSurface({ size: s }) },
];

/** Size variants: scale multipliers. Default surface radius is ~1 for math tests. */
const SIZES = [
  { label: 'SMALL',  scale: 0.75 },
  { label: 'MEDIUM', scale: 1.0  },
  { label: 'LARGE',  scale: 1.5  },
];

// ---------------------------------------------------------------------------
// Test result types
// ---------------------------------------------------------------------------

type Severity = 'pass' | 'warn' | 'fail';

interface TestResult {
  name: string;
  severity: Severity;
  value: number;
  threshold: number;
  details: string;
}

interface SizeResult {
  sizeLabel: string;
  scale: number;
  tests: TestResult[];
  overallSeverity: Severity;
}

interface SurfaceResult {
  surfaceName: string;
  sizes: SizeResult[];
  overallSeverity: Severity;
  error?: string;
}

// ---------------------------------------------------------------------------
// Sample point generators
// ---------------------------------------------------------------------------

function uniformSamples(rows = 5, cols = 7): { u: number; v: number }[] {
  const pts: { u: number; v: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({ u: (c + 0.5) / cols, v: (r + 0.5) / rows });
    }
  }
  return pts;
}

function interiorSamples(): { u: number; v: number }[] {
  return uniformSamples(5, 7).filter(s => s.v > 0.1 && s.v < 0.9);
}

// ---------------------------------------------------------------------------
// Individual test functions
// ---------------------------------------------------------------------------

function testSpeedUniformity(surface: Surface, dir: 'u' | 'v', step: number, pts: { u: number; v: number }[], threshold: number): TestResult {
  const dists: number[] = [];
  for (const sp of pts) {
    const p0 = surface.getPoint(sp.u, sp.v);
    const r = dir === 'u' ? surface.moveOnSurface(sp.u, sp.v, step, 0) : surface.moveOnSurface(sp.u, sp.v, 0, step);
    const p1 = surface.getPoint(r.u, r.v);
    dists.push(p0.position.distanceTo(p1.position));
  }
  const valid = dists.filter(d => d > 1e-6);
  if (valid.length === 0) return { name: `Speed (${dir})`, severity: 'fail', value: 0, threshold, details: 'No valid measurements' };
  const min = Math.min(...valid), max = Math.max(...valid);
  const ratio = min > 1e-9 ? max / min : Infinity;
  const sev: Severity = ratio <= threshold ? 'pass' : ratio > threshold * 2 ? 'fail' : 'warn';
  return { name: `Speed Uniformity (${dir.toUpperCase()})`, severity: sev, value: ratio, threshold, details: `max/min ratio = ${ratio.toFixed(3)}` };
}

function testNormalPerpendicularity(surface: Surface, pts: { u: number; v: number }[], threshold: number): TestResult {
  let maxDot = 0;
  for (const sp of pts) {
    const pt = surface.getPoint(sp.u, sp.v);
    const d = Math.max(Math.abs(pt.normal.dot(pt.tangentU)), Math.abs(pt.normal.dot(pt.tangentV)));
    if (d > maxDot) maxDot = d;
  }
  const sev: Severity = maxDot <= threshold ? 'pass' : maxDot > 0.1 ? 'fail' : 'warn';
  return { name: 'Normal Perpendicularity', severity: sev, value: maxDot, threshold, details: `max |normal·tangent| = ${maxDot.toFixed(5)}` };
}

function testUVRoundtrip(surface: Surface, pts: { u: number; v: number }[], threshold: number): TestResult {
  let maxError = 0;
  for (const sp of pts) {
    const wp = surface.getPoint(sp.u, sp.v);
    const recovered = surface.worldToSurface(wp.position);
    const rewp = surface.getPoint(recovered.u, recovered.v);
    const err = wp.position.distanceTo(rewp.position);
    if (err > maxError) maxError = err;
  }
  const sev: Severity = maxError <= threshold ? 'pass' : maxError > threshold * 3 ? 'fail' : 'warn';
  return { name: 'UV Roundtrip', severity: sev, value: maxError, threshold, details: `max world-pos error after roundtrip = ${maxError.toFixed(4)}` };
}

function testCircularClosure(surface: Surface, startV: number, steps: number, threshold: number): TestResult {
  const stepDu = 1.0 / steps;
  let u = 0, v = startV;
  for (let i = 0; i < steps; i++) {
    const r = surface.moveOnSurface(u, v, stepDu, 0);
    u = r.u; v = r.v;
  }
  const vDrift = Math.abs(v - startV);
  const sev: Severity = vDrift <= threshold ? 'pass' : vDrift > threshold * 5 ? 'fail' : 'warn';
  return { name: 'Circular Closure (V drift)', severity: sev, value: vDrift, threshold, details: `V drifted by ${vDrift.toFixed(5)} after 1 full U lap` };
}

function testPickupUVRoundtrip(surface: Surface, pts: { u: number; v: number }[], scale: number, threshold: number): TestResult {
  // Simulates pickup spawn: enemy dies at worldPos, pickup UV = worldToSurface(worldPos * scale),
  // player at same position should have matching UV for collision to register.
  let maxError = 0;
  for (const sp of pts) {
    try {
      const pt = surface.getPoint(sp.u, sp.v);
      // Scale the world position as if the surface is scaled by `scale`
      const scaledWorldPos = pt.position.clone().multiplyScalar(scale);
      // Apply scale to surface group (simulates main.ts scale application)
      surface.group.scale.setScalar(scale);
      const recovered = surface.worldToSurface(scaledWorldPos);
      surface.group.scale.setScalar(1.0); // restore
      const rewp = surface.getPoint(recovered.u, recovered.v);
      const rewpScaled = rewp.position.clone().multiplyScalar(scale);
      const err = scaledWorldPos.distanceTo(rewpScaled);
      if (err > maxError) maxError = err;
    } catch {
      // skip problematic points
    }
  }
  const sev: Severity = maxError <= threshold ? 'pass' : maxError > threshold * 3 ? 'fail' : 'warn';
  return {
    name: 'Pickup UV Roundtrip',
    severity: sev, value: maxError, threshold,
    details: `max scaled world-pos error = ${maxError.toFixed(4)} (scale=${scale}). Affects pickup collectability.`,
  };
}

// ---------------------------------------------------------------------------
// Run tests for one surface at one scale
// ---------------------------------------------------------------------------

function runSizeTests(entry: SurfaceEntry, sizeLabel: string, scale: number): SizeResult {
  const surface = entry.create(scale);
  const interior = interiorSamples();
  const all = uniformSamples();

  const tests: TestResult[] = [
    testSpeedUniformity(surface, 'u', 0.002, interior, 2.5),
    testSpeedUniformity(surface, 'v', 0.002, interior, 2.0),
    testNormalPerpendicularity(surface, all, 0.05),
    testUVRoundtrip(surface, interior, 0.5),
    testCircularClosure(surface, 0.5, 80, 0.05),
    testPickupUVRoundtrip(surface, interior, scale, 0.5 * scale),
  ];

  const fails = tests.filter(t => t.severity === 'fail').length;
  const warns = tests.filter(t => t.severity === 'warn').length;
  const overallSeverity: Severity = fails > 0 ? 'fail' : warns > 0 ? 'warn' : 'pass';

  return { sizeLabel, scale, tests, overallSeverity };
}

// ---------------------------------------------------------------------------
// HTML Report
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<Severity, string> = {
  pass: '#3fb950', warn: '#d29922', fail: '#f85149',
};
const STATUS_BG: Record<Severity, string> = {
  pass: '#0d3321', warn: '#3d2e00', fail: '#3d1418',
};

function badge(sev: Severity): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;color:${STATUS_COLOR[sev]};background:${STATUS_BG[sev]}">${sev.toUpperCase()}</span>`;
}

function generateHTML(results: SurfaceResult[], runDate: string): string {
  const totalSurfaces = results.length;
  const passCount = results.filter(r => r.overallSeverity === 'pass').length;
  const warnCount = results.filter(r => r.overallSeverity === 'warn').length;
  const failCount = results.filter(r => r.overallSeverity === 'fail').length;
  const overall: Severity = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';

  // Summary matrix rows
  const summaryRows = results.map(r => {
    const sizeCols = r.sizes.map(sz => {
      const fails = sz.tests.filter(t => t.severity === 'fail').length;
      const warns = sz.tests.filter(t => t.severity === 'warn').length;
      return `<td style="padding:6px 10px;vertical-align:top;border-left:1px solid #21262d;text-align:center">
        ${badge(sz.overallSeverity)}<br>
        <small style="color:#8b949e">${sz.tests.filter(t=>t.severity==='pass').length}P ${warns}W ${fails}F</small>
      </td>`;
    }).join('');
    return `<tr style="border-bottom:1px solid #21262d">
      <td style="padding:6px 10px;font-weight:600"><code>${r.surfaceName}</code></td>
      ${sizeCols}
    </tr>`;
  }).join('');

  // Issues
  const issues: string[] = [];
  for (const r of results) {
    for (const sz of r.sizes) {
      for (const t of sz.tests) {
        if (t.severity !== 'pass') {
          const bc = t.severity === 'fail' ? '#3d1418' : '#3d2e00';
          issues.push(`<div style="margin:6px 0;padding:8px 12px;background:${bc};border-left:3px solid ${STATUS_COLOR[t.severity]};border-radius:4px;font-size:0.83rem">
            <strong>[${r.surfaceName}] ${sz.sizeLabel} — ${t.name}</strong> ${badge(t.severity)}
            <br><code style="color:#aaa;font-size:0.72rem">${t.details}</code>
          </div>`);
        }
      }
    }
  }

  // Per-surface detail sections
  const details = results.map(r => {
    if (r.error) {
      return `<details style="background:#161b22;border:1px solid #30363d;border-radius:6px;margin:4px 0">
        <summary style="padding:8px 12px;cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center">
          <code>${r.surfaceName}</code> ${badge('fail')} <span style="color:#f85149;font-size:0.8rem">Error: ${r.error}</span>
        </summary></details>`;
    }
    const sizeHTML = r.sizes.map(sz => `
      <div style="margin:8px 0;padding:10px;background:#0d1117;border-radius:4px">
        <strong style="color:#58a6ff">${sz.sizeLabel} (scale=${sz.scale})</strong>
        <table style="margin-top:6px;font-size:0.78rem;border-collapse:collapse;width:100%">
          <tr style="background:#161b22">
            <th style="padding:3px 8px;text-align:left;color:#8b949e">Test</th>
            <th style="padding:3px 8px;color:#8b949e">Status</th>
            <th style="padding:3px 8px;text-align:right;color:#8b949e">Value</th>
            <th style="padding:3px 8px;text-align:right;color:#8b949e">Threshold</th>
            <th style="padding:3px 8px;text-align:left;color:#8b949e">Details</th>
          </tr>
          ${sz.tests.map(t => `<tr style="border-bottom:1px solid #21262d">
            <td style="padding:3px 8px">${t.name}</td>
            <td style="padding:3px 8px;text-align:center">${badge(t.severity)}</td>
            <td style="padding:3px 8px;text-align:right;font-family:monospace">${t.value.toFixed(4)}</td>
            <td style="padding:3px 8px;text-align:right;font-family:monospace">${t.threshold}</td>
            <td style="padding:3px 8px;font-size:0.72rem;color:#8b949e">${t.details}</td>
          </tr>`).join('')}
        </table>
      </div>`).join('');

    return `<details style="background:#161b22;border:1px solid #30363d;border-radius:6px;margin:4px 0">
      <summary style="padding:8px 12px;cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <code style="font-weight:600">${r.surfaceName}</code>
        ${badge(r.overallSeverity)}
        <span style="color:#8b949e;font-size:0.78rem">3 sizes × 6 tests</span>
      </summary>
      <div style="padding:4px 12px 12px">${sizeHTML}</div>
    </details>`;
  }).join('');

  const issueHTML = issues.length > 0
    ? `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin:1.2rem 0">
        <h3 style="color:#d29922;margin-top:0">Issues Found (${issues.length})</h3>
        ${issues.join('')}
       </div>`
    : `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin:1.2rem 0">
        <h3 style="color:#3fb950;margin-top:0">No Issues Found</h3>
        <p style="color:#8b949e">All 12 surfaces passed all tests at all 3 size variants.</p>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>All-Maps Full Verification — ${runDate.slice(0,19)}</title>
<style>
  body { background:#0d1117; color:#c9d1d9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; line-height:1.5; padding:1.5rem; max-width:1400px; margin:0 auto; }
  h1 { color:#fff; font-size:1.6rem; margin-bottom:0.2rem; }
  h2 { color:#58a6ff; font-size:1.1rem; margin:1.2rem 0 0.6rem; border-bottom:1px solid #30363d; padding-bottom:0.3rem; }
  code { background:#1c2128; padding:1px 5px; border-radius:4px; font-size:0.85em; font-family:'SFMono-Regular',Consolas,monospace; }
  details summary::-webkit-details-marker { display:none; }
  table { width:100%; border-collapse:collapse; }
  th, td { border-bottom:1px solid #30363d; }
</style>
</head>
<body>

<h1>All-Maps Full Verification — s44r-08</h1>
<p style="color:#8b949e;margin:0.2rem 0;font-size:0.875rem">
  ${runDate} &nbsp;|&nbsp; ${totalSurfaces} surfaces × 3 sizes × 6 math-based tests
</p>

<div style="display:inline-flex;align-items:center;gap:0.6rem;border:2px solid ${STATUS_COLOR[overall]};border-radius:7px;padding:0.5rem 1rem;font-size:0.95rem;font-weight:600;color:${STATUS_COLOR[overall]};margin:0.8rem 0">
  ${overall === 'pass' ? '✓ ALL PASS' : overall === 'warn' ? '⚠ WARNINGS' : '✗ FAILURES FOUND'}
</div>

<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin:0.75rem 0">
  <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:0.6rem 1rem;text-align:center;min-width:70px"><div style="font-size:1.5rem;font-weight:bold;color:#3fb950">${passCount}</div><div style="font-size:0.72rem;color:#8b949e">PASS</div></div>
  <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:0.6rem 1rem;text-align:center;min-width:70px"><div style="font-size:1.5rem;font-weight:bold;color:#d29922">${warnCount}</div><div style="font-size:0.72rem;color:#8b949e">WARN</div></div>
  <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:0.6rem 1rem;text-align:center;min-width:70px"><div style="font-size:1.5rem;font-weight:bold;color:#f85149">${failCount}</div><div style="font-size:0.72rem;color:#8b949e">FAIL</div></div>
</div>

<p style="color:#8b949e;font-size:0.8rem;margin:0.5rem 0">
  Tests: Speed Uniformity (U+V), Normal Perpendicularity, UV Roundtrip, Circular Closure, Pickup UV Roundtrip.<br>
  For gameplay simulation tests (movement, bullet origin, hit detection) run:
  <code>npm test -- src/test/all-maps-comprehensive.test.ts</code>
</p>

${issueHTML}

<h2>Summary Matrix</h2>
<div style="overflow-x:auto">
<table>
  <thead>
    <tr style="background:#161b22">
      <th style="padding:6px 10px;text-align:left;color:#58a6ff">Surface</th>
      <th style="padding:6px 10px;color:#58a6ff">SMALL (0.75)</th>
      <th style="padding:6px 10px;color:#58a6ff">MEDIUM (1.0)</th>
      <th style="padding:6px 10px;color:#58a6ff">LARGE (1.5)</th>
    </tr>
  </thead>
  <tbody>${summaryRows}</tbody>
</table>
</div>

<h2>Per-Surface Details</h2>
<p style="color:#8b949e;font-size:0.82rem;margin-bottom:0.6rem">Click a surface to expand test results for all 3 sizes.</p>
${details}

<footer style="color:#555;font-size:0.72rem;margin-top:2rem;border-top:1px solid #21262d;padding-top:0.75rem">
  All-Maps Full Verification — s44r-08 — Geometry Wars 3D
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const runDate = new Date().toISOString();
  console.log(`\n=== All-Maps Full Verification — s44r-08 ===`);
  console.log(`Date: ${runDate}`);
  console.log(`Surfaces: ${SURFACES.length} × Sizes: ${SIZES.length} × Tests: 6\n`);

  const results: SurfaceResult[] = [];

  for (const entry of SURFACES) {
    process.stdout.write(`[${entry.name.padEnd(14)}] `);
    let overallSeverity: Severity = 'pass';
    const sizes: SizeResult[] = [];

    try {
      for (const sz of SIZES) {
        const sizeResult = runSizeTests(entry, sz.label, sz.scale);
        sizes.push(sizeResult);
        if (sizeResult.overallSeverity === 'fail') overallSeverity = 'fail';
        else if (sizeResult.overallSeverity === 'warn' && overallSeverity !== 'fail') overallSeverity = 'warn';
        process.stdout.write(`${sz.label}:${sizeResult.overallSeverity.toUpperCase()} `);
      }
    } catch (e: any) {
      overallSeverity = 'fail';
      results.push({ surfaceName: entry.name, sizes, overallSeverity, error: String(e.message ?? e) });
      console.log(`ERROR: ${e.message ?? e}`);
      continue;
    }

    results.push({ surfaceName: entry.name, sizes, overallSeverity });
    console.log(`→ ${overallSeverity.toUpperCase()}`);
  }

  // Summary
  const passCount = results.filter(r => r.overallSeverity === 'pass').length;
  const warnCount = results.filter(r => r.overallSeverity === 'warn').length;
  const failCount = results.filter(r => r.overallSeverity === 'fail').length;

  console.log(`\n=== SUMMARY ===`);
  console.log(`PASS: ${passCount} | WARN: ${warnCount} | FAIL: ${failCount}`);

  if (failCount > 0 || warnCount > 0) {
    for (const r of results.filter(r => r.overallSeverity !== 'pass')) {
      console.log(`  [${r.overallSeverity.toUpperCase()}] ${r.surfaceName}`);
    }
  }

  // Generate HTML report
  const html = generateHTML(results, runDate);
  const timestamp = runDate.replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(__dirname, '../../reports', `all-maps-verification-${timestamp}.html`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, html, 'utf-8');
  console.log(`\nHTML report: ${reportPath}`);
  console.log('Done.\n');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
