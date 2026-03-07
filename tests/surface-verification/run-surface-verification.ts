/**
 * Surface Verification Framework
 *
 * Runs a battery of physics and geometry tests on each surface type,
 * looking for real bugs: speed distortion at poles, normal errors,
 * UV roundtrip failures, seam/wraparound issues.
 *
 * Run with: npx tsx tests/surface-verification/run-surface-verification.ts
 */

import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import surface classes
import { PeanutSurface } from '../../src/surfaces/PeanutSurface';
import { TorusSurface } from '../../src/surfaces/TorusSurface';
import { MobiusSurface } from '../../src/surfaces/MobiusSurface';
import { SphereSurface } from '../../src/surfaces/SphereSurface';
import { CubeSurface } from '../../src/surfaces/CubeSurface';
import { Surface } from '../../src/surfaces/Surface';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  value: number;
  threshold: number;
  details: string;
  severity: 'pass' | 'warn' | 'fail';
}

interface SurfaceReport {
  surfaceName: string;
  tests: TestResult[];
  overallPass: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Core test functions
// ---------------------------------------------------------------------------

/**
 * Test 1: Speed Uniformity
 *
 * Measures world-space distance traveled for a fixed UV step at many points.
 * For a well-corrected surface, the ratio of max/min distance should be small.
 *
 * Known failure mode: Peanut surface near poles (V→0 or V→1) where sinPhi→0
 * causes the U correction term (rNorm * sinPhi) to become very small,
 * making correctedDu = du / very_small_number → huge movement.
 */
function testSpeedUniformity(
  surface: Surface,
  direction: 'u' | 'v',
  step: number,
  samplePoints: { u: number; v: number }[],
  thresholdRatio: number
): TestResult {
  const distances: number[] = [];

  for (const sp of samplePoints) {
    const p0 = surface.getPoint(sp.u, sp.v);
    let result: { u: number; v: number };

    if (direction === 'u') {
      result = surface.moveOnSurface(sp.u, sp.v, step, 0);
    } else {
      result = surface.moveOnSurface(sp.u, sp.v, 0, step);
    }

    const p1 = surface.getPoint(result.u, result.v);
    const dist = p0.position.distanceTo(p1.position);
    distances.push(dist);
  }

  const validDistances = distances.filter(d => d > 1e-6);
  if (validDistances.length === 0) {
    return {
      name: `Speed Uniformity (${direction.toUpperCase()})`,
      passed: false,
      value: 0,
      threshold: thresholdRatio,
      details: 'No valid distance measurements',
      severity: 'fail',
    };
  }

  const minDist = Math.min(...validDistances);
  const maxDist = Math.max(...validDistances);
  const ratio = minDist > 1e-9 ? maxDist / minDist : Infinity;

  // Find which sample point has the max/min
  const maxIdx = distances.indexOf(maxDist);
  const minIdx = distances.indexOf(minDist);
  const maxPt = samplePoints[maxIdx];
  const minPt = samplePoints[minIdx];

  const passed = ratio <= thresholdRatio;

  return {
    name: `Speed Uniformity (${direction.toUpperCase()})`,
    passed,
    value: ratio,
    threshold: thresholdRatio,
    details: `max/min ratio = ${ratio.toFixed(3)} (max=${maxDist.toFixed(4)} at v=${maxPt?.v.toFixed(3)}, min=${minDist.toFixed(4)} at v=${minPt?.v.toFixed(3)}) — step=${step}`,
    severity: passed ? 'pass' : (ratio > thresholdRatio * 2 ? 'fail' : 'warn'),
  };
}

/**
 * Test 2: Normal Perpendicularity
 *
 * The normal returned by getPoint() should be perpendicular to the tangent vectors.
 * A large dot product means the normal is wrong (not truly perpendicular to surface).
 */
function testNormalPerpendicularity(
  surface: Surface,
  samplePoints: { u: number; v: number }[],
  thresholdDot: number
): TestResult {
  let maxDotU = 0;
  let maxDotV = 0;
  let worstPt = samplePoints[0];

  for (const sp of samplePoints) {
    const pt = surface.getPoint(sp.u, sp.v);
    const dotU = Math.abs(pt.normal.dot(pt.tangentU));
    const dotV = Math.abs(pt.normal.dot(pt.tangentV));
    if (dotU + dotV > maxDotU + maxDotV) {
      maxDotU = dotU;
      maxDotV = dotV;
      worstPt = sp;
    }
  }

  const maxDot = Math.max(maxDotU, maxDotV);
  const passed = maxDot <= thresholdDot;

  return {
    name: 'Normal Perpendicularity',
    passed,
    value: maxDot,
    threshold: thresholdDot,
    details: `max |normal·tangent| = ${maxDot.toFixed(5)} at u=${worstPt.u.toFixed(3)} v=${worstPt.v.toFixed(3)} (dotU=${maxDotU.toFixed(5)}, dotV=${maxDotV.toFixed(5)})`,
    severity: passed ? 'pass' : (maxDot > 0.1 ? 'fail' : 'warn'),
  };
}

/**
 * Test 3: UV Roundtrip
 *
 * worldToSurface(getPoint(u,v).position) should return approximately (u, v).
 * Failure indicates either getPoint() or worldToSurface() is wrong.
 *
 * Note: wrapping surfaces may have multiple valid UV representations for a point.
 * We test that the world position matches (not necessarily the UV values directly).
 */
function testUVRoundtrip(
  surface: Surface,
  samplePoints: { u: number; v: number }[],
  thresholdError: number
): TestResult {
  let maxError = 0;
  let worstPt = samplePoints[0];
  let worstDetails = '';

  for (const sp of samplePoints) {
    const worldPt = surface.getPoint(sp.u, sp.v);
    const recovered = surface.worldToSurface(worldPt.position);

    // Recover world position from the returned UV
    const reWorldPt = surface.getPoint(recovered.u, recovered.v);
    const posError = worldPt.position.distanceTo(reWorldPt.position);

    if (posError > maxError) {
      maxError = posError;
      worstPt = sp;
      worstDetails = `getPoint(${sp.u.toFixed(3)},${sp.v.toFixed(3)}) → worldPos → worldToSurface → (${recovered.u.toFixed(3)},${recovered.v.toFixed(3)}) → posError=${posError.toFixed(4)}`;
    }
  }

  const passed = maxError <= thresholdError;

  return {
    name: 'UV Roundtrip',
    passed,
    value: maxError,
    threshold: thresholdError,
    details: `max world-pos error after roundtrip = ${maxError.toFixed(4)} at u=${worstPt.u.toFixed(3)} v=${worstPt.v.toFixed(3)}. ${worstDetails}`,
    severity: passed ? 'pass' : (maxError > thresholdError * 3 ? 'fail' : 'warn'),
  };
}

/**
 * Test 4: Circular Path Closure
 *
 * Walk in a circle (U direction, wrapping) and check if we return to start.
 * A poor metric correction will cause drift - the endpoint won't match start.
 */
function testCircularClosure(
  surface: Surface,
  startU: number,
  startV: number,
  numSteps: number,
  thresholdUError: number
): TestResult {
  const stepDu = 1.0 / numSteps;
  let u = startU;
  let v = startV;

  for (let i = 0; i < numSteps; i++) {
    const result = surface.moveOnSurface(u, v, stepDu, 0);
    u = result.u;
    v = result.v;
  }

  // After a full lap, u should be back near startU and v near startV
  const uError = Math.abs(u - startU);
  const vDrift = Math.abs(v - startV);
  const totalError = Math.max(uError, vDrift);

  const passed = vDrift <= thresholdUError;

  return {
    name: 'Circular Path Closure (V drift)',
    passed,
    value: vDrift,
    threshold: thresholdUError,
    details: `After ${numSteps} steps around U, V drifted by ${vDrift.toFixed(5)} (started v=${startV}, ended v=${v.toFixed(5)})`,
    severity: passed ? 'pass' : (vDrift > thresholdUError * 5 ? 'fail' : 'warn'),
  };
}

/**
 * Test 5: Pole Speed Ratio (specific to peanut/sphere-like surfaces)
 *
 * Compares speed near the pole (V close to 0 or 1) vs speed at the equator.
 * A large ratio indicates the UV correction doesn't handle poles well.
 * This is the key test for the peanut pole slowdown bug.
 */
function testPoleSpeedRatio(
  surface: Surface,
  step: number,
  thresholdRatio: number
): TestResult {
  // Test U movement near pole vs equator
  const equatorV = 0.5;
  const poleV = 0.12; // Close to pole but not at the singularity

  const poleStep = surface.moveOnSurface(0.5, poleV, step, 0);
  const equatorStep = surface.moveOnSurface(0.5, equatorV, step, 0);

  const poleDist = surface.getPoint(0.5, poleV).position.distanceTo(
    surface.getPoint(poleStep.u, poleStep.v).position
  );
  const equatorDist = surface.getPoint(0.5, equatorV).position.distanceTo(
    surface.getPoint(equatorStep.u, equatorStep.v).position
  );

  const ratio = equatorDist > 1e-9 ? poleDist / equatorDist : 0;

  const passed = ratio >= (1 / thresholdRatio) && ratio <= thresholdRatio;

  return {
    name: 'Pole Speed Ratio (U)',
    passed,
    value: ratio,
    threshold: thresholdRatio,
    details: `pole (v=${poleV}) dist=${poleDist.toFixed(4)}, equator (v=${equatorV}) dist=${equatorDist.toFixed(4)}, ratio=${ratio.toFixed(3)} (want ${(1/thresholdRatio).toFixed(2)}-${thresholdRatio})`,
    severity: passed ? 'pass' : (ratio < 0.3 || ratio > thresholdRatio * 2 ? 'fail' : 'warn'),
  };
}

/**
 * Test 6: Normal Consistency
 *
 * Sample normals at many points and check they all roughly point outward (away from center).
 * Inner surfaces (like torus inner tube) are expected to point inward relative to the center.
 * This tests for flipped/incorrect normals.
 */
function testNormalConsistency(
  surface: Surface,
  samplePoints: { u: number; v: number }[],
  thresholdMinMagnitude: number
): TestResult {
  let minMagnitude = Infinity;
  let zeroNormals = 0;
  let worstPt = samplePoints[0];

  for (const sp of samplePoints) {
    const pt = surface.getPoint(sp.u, sp.v);
    const mag = pt.normal.length();
    if (mag < 0.01) {
      zeroNormals++;
    }
    if (mag < minMagnitude) {
      minMagnitude = mag;
      worstPt = sp;
    }
  }

  const passed = minMagnitude >= thresholdMinMagnitude && zeroNormals === 0;

  return {
    name: 'Normal Magnitude',
    passed,
    value: minMagnitude,
    threshold: thresholdMinMagnitude,
    details: `min normal magnitude = ${minMagnitude.toFixed(4)}, zero normals = ${zeroNormals} (worst at u=${worstPt.u.toFixed(3)} v=${worstPt.v.toFixed(3)})`,
    severity: passed ? 'pass' : (minMagnitude < 0.5 ? 'fail' : 'warn'),
  };
}

/**
 * Test 7: UV Scale Uniformity
 *
 * Uses surface.getUVScaleAt() to check that UV metric is consistent.
 * Large variation = UV space is highly distorted (enemies will appear to speed up/slow down).
 */
function testUVScaleUniformity(
  surface: Surface,
  samplePoints: { u: number; v: number }[],
  thresholdRatio: number
): TestResult {
  const scales: number[] = [];
  let worstPt = samplePoints[0];

  for (const sp of samplePoints) {
    const { scaleU, scaleV } = surface.getUVScaleAt(sp.u, sp.v);
    const geomMean = Math.sqrt(scaleU * scaleV);
    scales.push(geomMean);
  }

  const validScales = scales.filter(s => s > 1e-6);
  if (validScales.length === 0) {
    return {
      name: 'UV Scale Uniformity',
      passed: false,
      value: 0,
      threshold: thresholdRatio,
      details: 'No valid UV scale measurements',
      severity: 'fail',
    };
  }

  const minScale = Math.min(...validScales);
  const maxScale = Math.max(...validScales);
  const ratio = minScale > 1e-9 ? maxScale / minScale : Infinity;

  const maxIdx = scales.indexOf(maxScale);
  const minIdx = scales.indexOf(minScale);

  const passed = ratio <= thresholdRatio;

  return {
    name: 'UV Scale Uniformity',
    passed,
    value: ratio,
    threshold: thresholdRatio,
    details: `UV scale max/min = ${ratio.toFixed(3)} (max=${maxScale.toFixed(2)} at ${JSON.stringify(samplePoints[maxIdx])}, min=${minScale.toFixed(2)} at ${JSON.stringify(samplePoints[minIdx])})`,
    severity: passed ? 'pass' : (ratio > thresholdRatio * 2 ? 'fail' : 'warn'),
  };
}

/**
 * Test 8: Mobius Seam Traversal
 *
 * On a Mobius strip, traversing the full loop (u: 0 → 1) should flip V.
 * Starting at v=0.3 and going around should arrive at v≈0.7 (the other side).
 * This tests that moveOnSurface correctly handles the Mobius twist.
 */
function testMobiusSeamTraversal(
  surface: Surface,
  numSteps: number,
  thresholdVFlip: number
): TestResult {
  const startU = 0.0;
  const startV = 0.3; // Not at center (0.5) to detect flip

  let u = startU;
  let v = startV;

  const stepDu = 1.0 / numSteps;
  for (let i = 0; i < numSteps; i++) {
    const result = surface.moveOnSurface(u, v, stepDu, 0);
    u = result.u;
    v = result.v;
  }

  // After one full loop, v should have flipped from startV (0.3) to ~0.7 (1 - 0.3)
  const expectedV = 1.0 - startV; // 0.7
  const flipError = Math.abs(v - expectedV);
  const passed = flipError <= thresholdVFlip;

  return {
    name: 'Mobius Seam Traversal (V flip)',
    passed,
    value: flipError,
    threshold: thresholdVFlip,
    details: `After 1 full loop, v=${v.toFixed(4)} (expected ≈${expectedV}, error=${flipError.toFixed(4)}) — Mobius twist should flip v from ${startV} to ${expectedV}`,
    severity: passed ? 'pass' : (flipError > thresholdVFlip * 3 ? 'fail' : 'warn'),
  };
}

// ---------------------------------------------------------------------------
// Sample point generators
// ---------------------------------------------------------------------------

function uniformSamples(rows = 6, cols = 8): { u: number; v: number }[] {
  const pts: { u: number; v: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        u: (c + 0.5) / cols,
        v: (r + 0.5) / rows,
      });
    }
  }
  return pts;
}

function poleAwareSamples(): { u: number; v: number }[] {
  // Dense near poles, plus equator samples
  const pts: { u: number; v: number }[] = [];
  const vValues = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
  const uValues = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
  for (const v of vValues) {
    for (const u of uValues) {
      pts.push({ u, v });
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Run tests for each surface
// ---------------------------------------------------------------------------

function runSurfaceTests(surfaceName: string, surface: Surface): SurfaceReport {
  const tests: TestResult[] = [];
  const samples = uniformSamples(6, 8);
  const poleSamples = poleAwareSamples();

  // ---- Speed uniformity (V direction) ----
  // Standard interior samples (not near poles)
  const interiorSamples = samples.filter(s => s.v > 0.1 && s.v < 0.9);
  tests.push(testSpeedUniformity(surface, 'v', 0.002, interiorSamples, 1.5));

  // ---- Speed uniformity (U direction) ----
  tests.push(testSpeedUniformity(surface, 'u', 0.002, interiorSamples, 2.0));

  // ---- Speed uniformity near poles (stricter test) ----
  const nearPoleSamples = poleSamples.filter(s => s.v <= 0.2 || s.v >= 0.8);
  tests.push(testSpeedUniformity(surface, 'u', 0.001, nearPoleSamples, 3.0));

  // ---- Pole speed ratio ----
  tests.push(testPoleSpeedRatio(surface, 0.002, 2.5));

  // ---- Normal perpendicularity ----
  tests.push(testNormalPerpendicularity(surface, samples, 0.05));

  // ---- Normal magnitude ----
  tests.push(testNormalConsistency(surface, samples, 0.95));

  // ---- UV Roundtrip ----
  tests.push(testUVRoundtrip(surface, interiorSamples, 0.5));

  // ---- Circular closure ----
  tests.push(testCircularClosure(surface, 0.0, 0.5, 100, 0.05));

  // ---- UV Scale Uniformity ----
  tests.push(testUVScaleUniformity(surface, interiorSamples, 5.0));

  const failCount = tests.filter(t => t.severity === 'fail').length;
  const warnCount = tests.filter(t => t.severity === 'warn').length;
  const overallPass = failCount === 0;

  return {
    surfaceName,
    tests,
    overallPass,
    summary: `${tests.length} tests: ${tests.filter(t => t.severity === 'pass').length} pass, ${warnCount} warn, ${failCount} fail`,
  };
}

function runMobiusTests(surface: MobiusSurface): SurfaceReport {
  const tests: TestResult[] = [];
  const samples = uniformSamples(6, 8);
  const interiorSamples = samples.filter(s => s.v > 0.1 && s.v < 0.9);

  // Standard tests
  tests.push(testSpeedUniformity(surface, 'v', 0.003, interiorSamples, 3.0)); // Mobius is more distorted
  tests.push(testSpeedUniformity(surface, 'u', 0.003, interiorSamples, 3.0));
  tests.push(testNormalPerpendicularity(surface, samples, 0.1)); // Mobius normals can be tricky
  tests.push(testNormalConsistency(surface, samples, 0.9));

  // Mobius-specific: seam traversal
  tests.push(testMobiusSeamTraversal(surface, 200, 0.1));

  // UV roundtrip (relaxed for Mobius due to non-orientability)
  tests.push(testUVRoundtrip(surface, interiorSamples, 1.0));

  const failCount = tests.filter(t => t.severity === 'fail').length;
  const warnCount = tests.filter(t => t.severity === 'warn').length;
  const overallPass = failCount === 0;

  return {
    surfaceName: 'MobiusSurface',
    tests,
    overallPass,
    summary: `${tests.length} tests: ${tests.filter(t => t.severity === 'pass').length} pass, ${warnCount} warn, ${failCount} fail`,
  };
}

// ---------------------------------------------------------------------------
// HTML Report Generator
// ---------------------------------------------------------------------------

function generateHTMLReport(reports: SurfaceReport[]): string {
  const totalTests = reports.reduce((sum, r) => sum + r.tests.length, 0);
  const totalFail = reports.reduce((sum, r) => sum + r.tests.filter(t => t.severity === 'fail').length, 0);
  const totalWarn = reports.reduce((sum, r) => sum + r.tests.filter(t => t.severity === 'warn').length, 0);
  const totalPass = totalTests - totalFail - totalWarn;

  const surfaceRows = reports.map(report => {
    const icon = report.overallPass ? '✅' : '❌';
    const testRows = report.tests.map(test => {
      const bg = test.severity === 'pass' ? '#1a3a1a' : test.severity === 'warn' ? '#3a3a1a' : '#3a1a1a';
      const badge = test.severity === 'pass' ? '✅ PASS' : test.severity === 'warn' ? '⚠️ WARN' : '❌ FAIL';
      return `
        <tr style="background:${bg}">
          <td style="padding:6px 10px;font-size:13px">${test.name}</td>
          <td style="padding:6px 10px;text-align:center">${badge}</td>
          <td style="padding:6px 10px;text-align:right;font-family:monospace">${test.value.toFixed(4)}</td>
          <td style="padding:6px 10px;text-align:right;font-family:monospace">${test.threshold}</td>
          <td style="padding:6px 10px;font-size:12px;color:#aaa">${test.details}</td>
        </tr>`;
    }).join('');

    return `
      <section style="margin-bottom:30px;border:1px solid #333;border-radius:8px;overflow:hidden">
        <h2 style="margin:0;padding:12px 16px;background:#1a1a2e;font-size:16px">
          ${icon} ${report.surfaceName} — ${report.summary}
        </h2>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#0d0d1a;color:#888;font-size:12px">
              <th style="padding:6px 10px;text-align:left">Test</th>
              <th style="padding:6px 10px">Status</th>
              <th style="padding:6px 10px">Value</th>
              <th style="padding:6px 10px">Threshold</th>
              <th style="padding:6px 10px;text-align:left">Details</th>
            </tr>
          </thead>
          <tbody>${testRows}</tbody>
        </table>
      </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Surface Verification Report — ${new Date().toISOString().slice(0,19)}</title>
  <style>
    body { background:#0d0d1a; color:#e0e0e0; font-family:system-ui,sans-serif; margin:0; padding:20px }
    h1 { color:#7eb8f7; margin-bottom:20px }
    .summary-bar { background:#1a1a2e; border-radius:8px; padding:16px; margin-bottom:24px; display:flex; gap:32px }
    .stat { text-align:center }
    .stat .n { font-size:36px; font-weight:bold }
    .stat .l { font-size:12px; color:#888; text-transform:uppercase }
    .pass-n { color:#4caf50 }
    .warn-n { color:#ff9800 }
    .fail-n { color:#f44336 }
    .findings { background:#1a1a2e; border-radius:8px; padding:16px; margin-bottom:24px }
    .findings h3 { color:#ff9800; margin-top:0 }
    .finding { margin:8px 0; padding:8px 12px; background:#2a2000; border-left:3px solid #ff9800; border-radius:4px; font-size:13px }
    .finding.fail { background:#2a0000; border-color:#f44336; }
    td, th { border-bottom:1px solid #222 }
  </style>
</head>
<body>
  <h1>🔬 Surface Verification Report</h1>
  <p style="color:#888">Generated: ${new Date().toISOString()} | s44o-05d</p>

  <div class="summary-bar">
    <div class="stat"><div class="n">${reports.length}</div><div class="l">Surfaces</div></div>
    <div class="stat"><div class="n pass-n">${totalPass}</div><div class="l">Tests Pass</div></div>
    <div class="stat"><div class="n warn-n">${totalWarn}</div><div class="l">Warnings</div></div>
    <div class="stat"><div class="n fail-n">${totalFail}</div><div class="l">Failures</div></div>
    <div class="stat"><div class="n" style="color:${totalFail > 0 ? '#f44336' : '#4caf50'}">${totalFail > 0 ? 'BUGS FOUND' : 'ALL PASS'}</div><div class="l">Overall</div></div>
  </div>

  ${generateFindingsSummary(reports)}

  ${surfaceRows}

  <footer style="color:#555;font-size:12px;margin-top:32px">
    Surface Verification Framework — s44o-05d — Geometry Wars 3D
  </footer>
</body>
</html>`;
}

function generateFindingsSummary(reports: SurfaceReport[]): string {
  const findings: { surface: string; test: TestResult }[] = [];

  for (const report of reports) {
    for (const test of report.tests) {
      if (test.severity !== 'pass') {
        findings.push({ surface: report.surfaceName, test });
      }
    }
  }

  if (findings.length === 0) {
    return `<div class="findings"><h3>✅ No Issues Found</h3><p>All surfaces passed all tests within thresholds.</p></div>`;
  }

  const items = findings.map(f => `
    <div class="finding ${f.test.severity === 'fail' ? 'fail' : ''}">
      <strong>[${f.surface}] ${f.test.name}</strong> — ${f.test.severity.toUpperCase()}
      <br><small>${f.test.details}</small>
    </div>`).join('');

  return `<div class="findings"><h3>⚠️ Issues Found (${findings.length})</h3>${items}</div>`;
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Surface Verification Framework ===');
  console.log('Running tests...\n');

  const reports: SurfaceReport[] = [];

  // Test each surface
  const surfaces: { name: string; surface: Surface }[] = [
    { name: 'SphereSurface', surface: new SphereSurface() },
    { name: 'PeanutSurface', surface: new PeanutSurface() },
    { name: 'TorusSurface', surface: new TorusSurface() },
    { name: 'CubeSurface', surface: new CubeSurface() },
  ];

  for (const { name, surface } of surfaces) {
    console.log(`Testing ${name}...`);
    const report = runSurfaceTests(name, surface);
    reports.push(report);

    // Print summary
    for (const test of report.tests) {
      const icon = test.severity === 'pass' ? '✅' : test.severity === 'warn' ? '⚠️' : '❌';
      console.log(`  ${icon} ${test.name}: value=${test.value.toFixed(4)}, threshold=${test.threshold}`);
      if (test.severity !== 'pass') {
        console.log(`     → ${test.details}`);
      }
    }
    console.log(`  ${report.summary}\n`);
  }

  // Mobius has specialized tests
  console.log('Testing MobiusSurface...');
  const mobius = new MobiusSurface();
  const mobiusReport = runMobiusTests(mobius);
  reports.push(mobiusReport);
  for (const test of mobiusReport.tests) {
    const icon = test.severity === 'pass' ? '✅' : test.severity === 'warn' ? '⚠️' : '❌';
    console.log(`  ${icon} ${test.name}: value=${test.value.toFixed(4)}, threshold=${test.threshold}`);
    if (test.severity !== 'pass') {
      console.log(`     → ${test.details}`);
    }
  }
  console.log(`  ${mobiusReport.summary}\n`);

  // Overall summary
  const totalFail = reports.reduce((sum, r) => sum + r.tests.filter(t => t.severity === 'fail').length, 0);
  const totalWarn = reports.reduce((sum, r) => sum + r.tests.filter(t => t.severity === 'warn').length, 0);
  const totalPass = reports.reduce((sum, r) => sum + r.tests.filter(t => t.severity === 'pass').length, 0);

  console.log('=== OVERALL SUMMARY ===');
  console.log(`Pass: ${totalPass} | Warn: ${totalWarn} | Fail: ${totalFail}`);
  if (totalFail > 0) {
    console.log('\n❌ BUGS FOUND:');
    for (const report of reports) {
      for (const test of report.tests) {
        if (test.severity === 'fail') {
          console.log(`  [${report.surfaceName}] ${test.name}: ${test.details}`);
        }
      }
    }
  } else if (totalWarn > 0) {
    console.log('\n⚠️ WARNINGS:');
    for (const report of reports) {
      for (const test of report.tests) {
        if (test.severity === 'warn') {
          console.log(`  [${report.surfaceName}] ${test.name}: ${test.details}`);
        }
      }
    }
  } else {
    console.log('\n✅ All tests passed within thresholds.');
    console.log('NOTE: If all pass, consider tightening thresholds to find real issues.');
  }

  // Generate HTML report
  const html = generateHTMLReport(reports);
  const reportPath = path.join(__dirname, '../../reports/surface-verification.html');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, html);
  console.log(`\n📄 HTML report written to: ${reportPath}`);

  // Return exit code based on failures
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
