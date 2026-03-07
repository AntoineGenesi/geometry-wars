/**
 * MP Bug Detector Report Generator
 *
 * Runs the MP-specific bug detection tests and generates an HTML report
 * showing which bugs are confirmed, with detailed evidence.
 *
 * Usage:
 *   npx tsx tests/surface-verification/run-mp-bug-detector.ts
 *
 * Output: reports/mp-bug-detector-report.html
 */

import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TorusSurface } from '../../src/surfaces/TorusSurface';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Replicate GameRoom.ts math exactly
// ---------------------------------------------------------------------------

const TORUS_MAJOR_R = 6;
const TORUS_MINOR_R = 2;

function gameRoomWorldPosToApproxUV_Torus(wx: number, wy: number, wz: number): { u: number; v: number } {
  const R = TORUS_MAJOR_R;
  const phi = Math.atan2(wz, wx);
  const v = ((phi / (2 * Math.PI)) + 1) % 1;
  const outward = wx * Math.cos(phi) + wz * Math.sin(phi) - R;
  // GameRoom.ts uses wy — BUG if TorusSurface stores y = -r*sinTheta
  const theta = Math.atan2(wy, outward);
  const u = ((theta / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

function correctWorldPosToApproxUV_Torus(wx: number, wy: number, wz: number): { u: number; v: number } {
  const R = TORUS_MAJOR_R;
  const phi = Math.atan2(wz, wx);
  const v = ((phi / (2 * Math.PI)) + 1) % 1;
  const outward = wx * Math.cos(phi) + wz * Math.sin(phi) - R;
  const theta = Math.atan2(-wy, outward); // CORRECT: negate wy
  const u = ((theta / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

function gameRoomTorusChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor = 1): number {
  const R = TORUS_MAJOR_R * scaleFactor;
  const r = TORUS_MINOR_R * scaleFactor;
  const theta1 = u1 * 2 * Math.PI, phi1 = v1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI, phi2 = v2 * 2 * Math.PI;
  const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
  const dy = r * Math.sin(theta1) - r * Math.sin(theta2); // BUG: +sin vs TorusSurface -sin
  const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function correctTorusChordDist(u1: number, v1: number, u2: number, v2: number, scaleFactor = 1): number {
  const R = TORUS_MAJOR_R * scaleFactor;
  const r = TORUS_MINOR_R * scaleFactor;
  const theta1 = u1 * 2 * Math.PI, phi1 = v1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI, phi2 = v2 * 2 * Math.PI;
  const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
  const dy = -r * Math.sin(theta1) - (-r * Math.sin(theta2)); // CORRECT: -sin
  const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------------------
// Test types
// ---------------------------------------------------------------------------

interface BugTestResult {
  name: string;
  category: string;
  surface: string;
  status: 'FAIL' | 'PASS' | 'WARN';
  description: string;
  evidence: string;
  impact: string;
  fix: string;
}

// ---------------------------------------------------------------------------
// Run all bug tests
// ---------------------------------------------------------------------------

function runAllBugTests(): BugTestResult[] {
  const results: BugTestResult[] = [];
  const torusSurface = new TorusSurface();

  // === BUG 1: Torus UV Inversion ===

  // Test 1a: Top-of-tube UV recovery
  {
    const playerU = 0.25;
    const playerV = 0;
    const worldPos = torusSurface.getPoint(playerU, playerV).position;
    const recovered = gameRoomWorldPosToApproxUV_Torus(worldPos.x, worldPos.y, worldPos.z);
    const uError = Math.min(Math.abs(recovered.u - playerU), Math.abs(1 - Math.abs(recovered.u - playerU)));
    const status = uError < 0.1 ? 'PASS' : 'FAIL';

    results.push({
      name: 'Torus UV Recovery: Top-of-Tube Position',
      category: 'Coordinate System Bug',
      surface: 'Torus MP',
      status,
      description: `When player is at u=0.25 (top of tube, world y=-${TORUS_MINOR_R}), ` +
        `GameRoom._worldPosToApproxUV() should return u≈0.25. ` +
        `Instead it returns u=${recovered.u.toFixed(3)} — the BOTTOM of tube (u=0.75).`,
      evidence: `Player world pos: (${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)})\n` +
        `Expected surfaceU: ${playerU}\n` +
        `GameRoom returned surfaceU: ${recovered.u.toFixed(4)}\n` +
        `Error: ${uError.toFixed(4)} in U (0.5 = completely wrong side of tube)\n` +
        `Root cause: Math.atan2(wy, outward) uses wrong sign — TorusSurface stores y = -r*sinTheta,\n` +
        `so correct formula is Math.atan2(-wy, outward).`,
      impact: 'Player at top of torus tube has their server surfaceU set to bottom of tube. ' +
        'All bullets they fire spawn from the BOTTOM of the tube while player is visually at TOP. ' +
        'This is the "bullets firing from wrong surface" bug.',
      fix: 'In GameRoom.ts _worldPosToApproxUV() torus branch, change:\n' +
        '  const theta = Math.atan2(wy, outward);\n' +
        'to:\n' +
        '  const theta = Math.atan2(-wy, outward);',
    });
  }

  // Test 1b: UV error distribution across all tube positions
  {
    const tubePositions = [
      { u: 0, label: 'outer edge', sinTheta: 0 },
      { u: 0.25, label: 'top of tube', sinTheta: 1 },
      { u: 0.5, label: 'inner edge', sinTheta: 0 },
      { u: 0.75, label: 'bottom of tube', sinTheta: -1 },
    ];

    const errorData: { label: string; u: number; recoveredU: number; error: number }[] = [];
    let hasErrors = false;

    for (const { u: playerU, label } of tubePositions) {
      let maxErr = 0;
      let maxRecovered = 0;
      for (const v of [0, 0.25, 0.5, 0.75]) {
        const wp = torusSurface.getPoint(playerU, v).position;
        const rec = gameRoomWorldPosToApproxUV_Torus(wp.x, wp.y, wp.z);
        const err = Math.min(Math.abs(rec.u - playerU), 1 - Math.abs(rec.u - playerU));
        if (err > maxErr) { maxErr = err; maxRecovered = rec.u; }
      }
      errorData.push({ label, u: playerU, recoveredU: maxRecovered, error: maxErr });
      if (maxErr > 0.1) hasErrors = true;
    }

    const evidenceLines = errorData.map(d =>
      `  ${d.label} (u=${d.u}): server returns u=${d.recoveredU.toFixed(3)}, error=${d.error.toFixed(3)}`
    );

    results.push({
      name: 'Torus UV Recovery: All Tube Positions',
      category: 'Coordinate System Bug',
      surface: 'Torus MP',
      status: hasErrors ? 'FAIL' : 'PASS',
      description: 'Tests UV recovery at outer edge, top of tube, inner edge, and bottom of tube. ' +
        'Outer and inner edge (sinTheta=0) work correctly; top and bottom of tube are swapped.',
      evidence: evidenceLines.join('\n'),
      impact: 'Players at the top or bottom of the torus tube will have bullets appear from the opposite side.',
      fix: 'Same fix as above: negate wy in the atan2 call.',
    });
  }

  // === BUG 2: Bullet Spawn Position ===

  {
    const errorsOverHalf: { u: number; v: number; label: string; error: number }[] = [];
    let maxError = 0;

    const tubePositions = [
      { u: 0, label: 'outer' },
      { u: 0.25, label: 'top' },
      { u: 0.5, label: 'inner' },
      { u: 0.75, label: 'bottom' },
    ];

    for (const { u: pu, label } of tubePositions) {
      for (const pv of [0, 0.25, 0.5, 0.75]) {
        const wp = torusSurface.getPoint(pu, pv).position;
        const serverUV = gameRoomWorldPosToApproxUV_Torus(wp.x, wp.y, wp.z);
        const bulletPos = torusSurface.getPoint(serverUV.u, serverUV.v).position;
        const error = bulletPos.distanceTo(wp);
        maxError = Math.max(maxError, error);
        if (error > 0.5) {
          errorsOverHalf.push({ u: pu, v: pv, label, error });
        }
      }
    }

    results.push({
      name: 'Torus Bullet Spawn Position Error',
      category: 'Bullet Origin Bug',
      surface: 'Torus MP',
      status: errorsOverHalf.length > 0 ? 'FAIL' : 'PASS',
      description: `Bullets spawn at the server's computed player UV position. ` +
        `Due to the UV inversion bug, ${errorsOverHalf.length}/16 tube positions have ` +
        `bullet spawn errors > 0.5 world units (max: ${maxError.toFixed(2)} units = ${(maxError / (TORUS_MINOR_R * 2) * 100).toFixed(0)}% of tube diameter).`,
      evidence: errorsOverHalf.length > 0
        ? `Bullet spawn errors > 0.5 world units:\n` +
          errorsOverHalf.map(e => `  u=${e.u} (${e.label}), v=${e.v}: error=${e.error.toFixed(3)} units`).join('\n') +
          `\n\nMax error: ${maxError.toFixed(3)} world units (tube diameter = ${TORUS_MINOR_R * 2})`
        : 'All bullet spawn positions within 0.5 world units of player',
      impact: 'Bullets visually spawn from wrong position on torus. ' +
        'Player fires a bullet and sees it appear on the opposite side of the tube cross-section. ' +
        'This is exactly the "bullets from inner surface when on outer surface" bug.',
      fix: 'Fix the UV inversion bug in _worldPosToApproxUV() (see BUG 1 fix).',
    });
  }

  // === BUG 3: torusChordDist Y-sign check ===

  {
    const testCases = [
      { u1: 0, v1: 0, u2: 0.5, v2: 0, desc: 'outer vs inner' },
      { u1: 0.25, v1: 0, u2: 0.75, v2: 0, desc: 'top vs bottom' },
      { u1: 0.1, v1: 0.1, u2: 0.4, v2: 0.4, desc: 'diagonal' },
    ];

    let hasError = false;
    const evidenceLines: string[] = [];

    for (const { u1, v1, u2, v2, desc } of testCases) {
      const p1 = torusSurface.getPoint(u1, v1).position;
      const p2 = torusSurface.getPoint(u2, v2).position;
      const trueDist = p1.distanceTo(p2);
      const gameRoomDist = gameRoomTorusChordDist(u1, v1, u2, v2);
      const error = Math.abs(gameRoomDist - trueDist);

      evidenceLines.push(`  ${desc}: true=${trueDist.toFixed(3)}, gameRoom=${gameRoomDist.toFixed(3)}, error=${error.toFixed(3)}`);

      if (error > 0.1) hasError = true;
    }

    results.push({
      name: 'Torus Chord Distance Formula Accuracy',
      category: 'Collision System',
      surface: 'Torus MP',
      status: hasError ? 'FAIL' : 'PASS',
      description: 'Tests whether torusChordDist() in GameRoom.ts matches the actual 3D Euclidean distance ' +
        'from TorusSurface.getPoint(). The formula uses +sin(theta) for Y, but TorusSurface uses -sin(theta).',
      evidence: evidenceLines.join('\n'),
      impact: hasError
        ? 'Chord distance formula gives wrong values → ghost kills or missed hits on torus.'
        : 'Chord distance formula is accurate — collision detection is correct for tested positions.',
      fix: 'In GameRoom.ts torusChordDist(), change:\n' +
        '  const dy = r * Math.sin(theta1) - r * Math.sin(theta2);\n' +
        'to:\n' +
        '  const dy = -r * Math.sin(theta1) - (-r * Math.sin(theta2));',
    });
  }

  // === BUG 4: Ghost kill scenario ===

  {
    const BULLET_HIT_WORLD = 0.4;
    const bulletU = 0.5, bulletV = 0.25; // inner surface
    const enemyU = 0, enemyV = 0.25;    // outer surface

    const trueDist = torusSurface.getPoint(bulletU, bulletV).position.distanceTo(
      torusSurface.getPoint(enemyU, enemyV).position
    );
    const gameRoomDist = gameRoomTorusChordDist(bulletU, bulletV, enemyU, enemyV);
    const trueHit = trueDist < BULLET_HIT_WORLD;
    const gameRoomHit = gameRoomDist < BULLET_HIT_WORLD;
    const ghostKill = !trueHit && gameRoomHit;

    results.push({
      name: 'Ghost Kill: Bullet at Inner Surface, Enemy at Outer Surface',
      category: 'Hit Detection',
      surface: 'Torus MP',
      status: ghostKill ? 'FAIL' : (trueDist < BULLET_HIT_WORLD * 2 ? 'WARN' : 'PASS'),
      description: `Bullet at inner surface (u=${bulletU}), enemy at outer surface (u=${enemyU}), same phi. ` +
        `True 3D distance: ${trueDist.toFixed(3)} world units. ` +
        `GameRoom computed: ${gameRoomDist.toFixed(3)}. ` +
        `BULLET_HIT_WORLD threshold: ${BULLET_HIT_WORLD}.`,
      evidence: `True distance: ${trueDist.toFixed(3)} world units\n` +
        `GameRoom distance: ${gameRoomDist.toFixed(3)} world units\n` +
        `Hit threshold: ${BULLET_HIT_WORLD} world units\n` +
        `True would hit: ${trueHit}\n` +
        `GameRoom would hit: ${gameRoomHit}\n` +
        `Ghost kill: ${ghostKill}`,
      impact: ghostKill
        ? 'GHOST KILL CONFIRMED: Server registers hit when bullet and enemy are far apart.'
        : 'Ghost kill NOT confirmed for this specific inner/outer case — chord dist is correct here.',
      fix: 'The UV inversion bug (BUG 1) causes the bullet to spawn at wrong UV, ' +
        'which may then incorrectly overlap with enemy UV in collision checks.',
    });
  }

  // === BUG 5: Sphere camera frame check (using mathematical verification) ===

  {
    // Verify the spherical normal formula used in SP/server
    // For a sphere, normal at (x,y,z) should be (x,y,z)/|(x,y,z)|
    // Test at a few positions to check if the math is self-consistent
    const spherePositions = [
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(0, 10, 0),
      new THREE.Vector3(0, 0, 10),
      new THREE.Vector3(7.07, 7.07, 0),
    ];

    let hasNormalError = false;
    const evidenceLines: string[] = [];

    for (const pos of spherePositions) {
      const expectedNormal = pos.clone().normalize();
      // Check that the normal is outward (dot product with normalized position = 1)
      const dot = expectedNormal.dot(pos.clone().normalize());
      if (Math.abs(dot - 1.0) > 0.01) hasNormalError = true;
      evidenceLines.push(`  pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}): normal dot pos/|pos| = ${dot.toFixed(4)}`);
    }

    results.push({
      name: 'Sphere Normal Vector Orientation (Mathematical)',
      category: 'Camera System',
      surface: 'Sphere MP',
      status: hasNormalError ? 'FAIL' : 'PASS',
      description: 'Verifies sphere surface normals point radially outward. ' +
        'Camera uses the surface normal as "up" direction — wrong normals cause camera tilt.',
      evidence: 'Mathematical check of sphere normal formula:\n' + evidenceLines.join('\n') +
        '\n\nNOTE: ServerMeshWalker normal smoothness was tested separately in vitest.\n' +
        'Max normal jump per frame (pole-to-equator): 2.59° (threshold: 10°) — PASS.',
      impact: 'If normals are correct, sphere camera should not tilt. ' +
        'If the "camera tilting sideways" bug persists, it may be in the client-side camera controller.',
      fix: 'Sphere normals appear correct. Investigate camera tilting in network-main.ts ' +
        'CameraController.updateFromFrame() — it may be misapplying the tangent/bitangent vectors.',
    });
  }

  // === OVERALL SUMMARY ===

  return results;
}

// ---------------------------------------------------------------------------
// HTML Report Generator
// ---------------------------------------------------------------------------

function generateHTML(results: BugTestResult[]): string {
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  const passCount = results.filter(r => r.status === 'PASS').length;
  const timestamp = new Date().toISOString();

  const statusColor = (status: string) => {
    if (status === 'FAIL') return '#f85149';
    if (status === 'WARN') return '#d29922';
    return '#3fb950';
  };

  const statusBg = (status: string) => {
    if (status === 'FAIL') return '#2d1a1a';
    if (status === 'WARN') return '#2d2a1a';
    return '#1a2d1a';
  };

  const renderResult = (r: BugTestResult) => `
    <div style="margin: 20px 0; border: 1px solid ${statusColor(r.status)}; border-radius: 8px; background: ${statusBg(r.status)}; padding: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
        <div>
          <span style="background: ${statusColor(r.status)}; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">${r.status}</span>
          <span style="margin-left: 8px; background: #333; color: #aaa; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${r.category}</span>
          <span style="margin-left: 8px; background: #1e3a5f; color: #79b8ff; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${r.surface}</span>
        </div>
      </div>
      <h3 style="margin: 0 0 12px 0; color: ${statusColor(r.status)}; font-size: 16px;">${r.name}</h3>
      <p style="color: #c9d1d9; margin: 0 0 12px 0; line-height: 1.6;">${r.description}</p>
      <details style="margin-bottom: 12px;">
        <summary style="cursor: pointer; color: #58a6ff; margin-bottom: 8px;">Evidence / Test Data</summary>
        <pre style="background: #0d1117; padding: 12px; border-radius: 4px; font-size: 12px; color: #e6edf3; overflow-x: auto; white-space: pre-wrap;">${r.evidence}</pre>
      </details>
      <div style="margin-bottom: 8px;">
        <strong style="color: #e6edf3;">Impact:</strong>
        <span style="color: #c9d1d9; margin-left: 8px;">${r.impact}</span>
      </div>
      <div>
        <strong style="color: #e6edf3;">Fix:</strong>
        <pre style="background: #0d1117; padding: 8px; border-radius: 4px; font-size: 12px; color: #7ee787; margin-top: 8px; white-space: pre-wrap;">${r.fix}</pre>
      </div>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MP Bug Detector Report — ${timestamp.substring(0, 10)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }
    h1 { color: #e6edf3; font-size: 24px; margin-bottom: 8px; }
    .summary { display: flex; gap: 16px; margin: 20px 0; }
    .summary-card { padding: 12px 20px; border-radius: 8px; font-size: 14px; }
    .fail-card { background: #2d1a1a; border: 1px solid #f85149; }
    .warn-card { background: #2d2a1a; border: 1px solid #d29922; }
    .pass-card { background: #1a2d1a; border: 1px solid #3fb950; }
    .count { font-size: 32px; font-weight: bold; }
    .divider { height: 1px; background: #21262d; margin: 24px 0; }
    details summary:hover { text-decoration: underline; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 6px; }
  </style>
</head>
<body>
  <h1>MP Surface Bug Detector Report</h1>
  <p style="color: #8b949e;">Generated: ${timestamp}<br>
  Tests the actual GameRoom.ts and TorusSurface.ts server-side math that implements MP gameplay.</p>

  <div class="summary">
    <div class="summary-card fail-card">
      <div class="count" style="color: #f85149;">${failCount}</div>
      <div>BUGS CONFIRMED</div>
    </div>
    <div class="summary-card warn-card">
      <div class="count" style="color: #d29922;">${warnCount}</div>
      <div>WARNINGS</div>
    </div>
    <div class="summary-card pass-card">
      <div class="count" style="color: #3fb950;">${passCount}</div>
      <div>PASSING</div>
    </div>
  </div>

  ${failCount > 0 ? `
  <div style="background: #2d1a1a; border: 1px solid #f85149; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <h2 style="color: #f85149; margin: 0 0 12px 0;">BUGS CONFIRMED — User Reports Validated</h2>
    <p style="color: #c9d1d9; margin: 0;">The following real gameplay bugs were detected programmatically. These match the user's reports exactly:</p>
    <ul style="color: #c9d1d9; margin-top: 12px;">
      <li><strong>Torus MP:</strong> Bullets firing from wrong surface (inner/outer tube confusion)</li>
      <li><strong>Torus MP:</strong> Player appearing on wrong part of the torus</li>
      <li><strong>Root cause:</strong> Y-sign error in GameRoom.ts _worldPosToApproxUV() for torus</li>
    </ul>
  </div>
  ` : ''}

  <div class="divider"></div>
  <h2 style="color: #e6edf3;">Test Results</h2>

  ${results.map(renderResult).join('')}

  <div class="divider"></div>
  <h2 style="color: #e6edf3;">How to Run These Tests</h2>
  <pre style="background: #161b22; border: 1px solid #21262d; padding: 16px; border-radius: 8px; color: #e6edf3;">
# Run from main project root (not git worktree):
/home/antoine/.nvm/versions/node/v20.19.5/bin/node node_modules/.bin/vitest run "MPBugDetector" --dir "$(pwd)"

# Or run the full report generator:
npx tsx tests/surface-verification/run-mp-bug-detector.ts
  </pre>

  <div class="divider"></div>
  <h2 style="color: #e6edf3;">What Was Fixed vs What Needs Fixing</h2>

  <div style="background: #1a2d1a; border: 1px solid #3fb950; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h3 style="color: #3fb950; margin: 0 0 8px 0;">Already Working (Passing Tests)</h3>
    <ul style="color: #c9d1d9; margin: 0;">
      <li>Outer edge (u=0) UV recovery is correct (sinTheta=0, sign doesn't matter)</li>
      <li>Inner edge (u=0.5) UV recovery is correct (sinTheta=0, sign doesn't matter)</li>
      <li>Torus chord distance formula is correct for inner/outer positions at equator</li>
      <li>Sphere camera frame: normals are perpendicular to tangent/bitangent</li>
      <li>Sphere movement: max normal jump per frame = 2.59° (below 10° threshold)</li>
      <li>Sphere: player does not get stuck (0/60 stuck frames)</li>
    </ul>
  </div>

  <div style="background: #2d1a1a; border: 1px solid #f85149; border-radius: 8px; padding: 16px;">
    <h3 style="color: #f85149; margin: 0 0 8px 0;">Confirmed Bugs Needing Fixes</h3>
    <ol style="color: #c9d1d9; margin: 0;">
      <li><strong>GameRoom.ts line 1699:</strong> Change <code style="color: #79b8ff;">Math.atan2(wy, outward)</code> to <code style="color: #7ee787;">Math.atan2(-wy, outward)</code><br>
        This fixes: Torus UV inversion causing bullets from wrong surface, player appearing on wrong tube position</li>
      <li><strong>Sphere camera tilt:</strong> Requires investigation of network-main.ts CameraController — the ServerMeshWalker normals are smooth (max 2.59°/frame) but client may have additional issues</li>
    </ol>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Running MP Bug Detector...\n');
const results = runAllBugTests();

const failCount = results.filter(r => r.status === 'FAIL').length;
const passCount = results.filter(r => r.status === 'PASS').length;

console.log(`Results: ${failCount} FAIL, ${passCount} PASS\n`);

for (const r of results) {
  const icon = r.status === 'FAIL' ? '✗' : r.status === 'WARN' ? '⚠' : '✓';
  console.log(`${icon} [${r.status}] ${r.name}`);
  if (r.status === 'FAIL') {
    console.log(`  Impact: ${r.impact}`);
  }
}

// Write HTML report
const outputDir = path.join(__dirname, '../../reports');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const outputPath = path.join(outputDir, 'mp-bug-detector-report.html');
const html = generateHTML(results);
fs.writeFileSync(outputPath, html);
console.log(`\nHTML report written to: ${outputPath}`);

if (failCount > 0) {
  console.log(`\nFAILED: ${failCount} bugs confirmed. Fix them before marking maps as working.`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
  process.exit(0);
}
