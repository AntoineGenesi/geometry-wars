/**
 * HitDetectionReport — Generates HTML report from surface hit detection test results.
 *
 * Outputs a self-contained HTML file with:
 * - Per-surface pass/fail status
 * - Collision distance thresholds (expected vs actual)
 * - Entity positions (surface UV and world coordinates)
 * - Overall summary matrix
 */

import type { SurfaceTestResult, TestCaseResult } from './SurfaceHitDetectionTests';

export function generateHitDetectionReport(
  results: SurfaceTestResult[],
  title = 'Surface Hit Detection Verification Report',
): string {
  const totalPassed = results.filter(r => r.overall === 'PASS').length;
  const totalFailed = results.filter(r => r.overall === 'FAIL').length;
  const totalSurfaces = results.length;
  const allTestsPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const allTestsFailed = results.reduce((sum, r) => sum + r.failed, 0);

  const now = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a1a; color: #e0e0e0; padding: 20px; }
    h1 { color: #00ccff; margin-bottom: 10px; font-size: 24px; }
    h2 { color: #88bbff; margin: 20px 0 10px; font-size: 18px; }
    .meta { color: #888; font-size: 12px; margin-bottom: 20px; }
    .summary { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
    .stat { background: #1a1a2e; border-radius: 8px; padding: 15px 20px; min-width: 120px; }
    .stat-value { font-size: 28px; font-weight: bold; }
    .stat-label { font-size: 12px; color: #888; margin-top: 4px; }
    .pass { color: #00ff88; }
    .fail { color: #ff4466; }
    .matrix { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    .matrix th, .matrix td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #222; }
    .matrix th { background: #1a1a2e; color: #88bbff; font-weight: 600; font-size: 13px; }
    .matrix td { font-size: 13px; }
    .matrix tr:hover { background: #1a1a2e; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-pass { background: #00ff8833; color: #00ff88; }
    .badge-fail { background: #ff446633; color: #ff4466; }
    .surface-section { background: #111122; border-radius: 8px; padding: 15px; margin-bottom: 15px; border-left: 3px solid #333; }
    .surface-section.pass-section { border-left-color: #00ff88; }
    .surface-section.fail-section { border-left-color: #ff4466; }
    .surface-title { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .surface-title:hover { color: #00ccff; }
    .test-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #1a1a2e; }
    .test-name { font-family: monospace; font-size: 12px; min-width: 200px; color: #aaa; }
    .test-message { font-size: 12px; flex: 1; }
    .test-details { font-size: 11px; color: #666; font-family: monospace; }
    .details-panel { display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #222; }
    .details-panel.open { display: block; }
    .collision-data { font-family: monospace; font-size: 11px; color: #aaa; background: #0a0a15; padding: 8px; border-radius: 4px; margin-top: 5px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Generated: ${now} | Code path: GameLoop.ts → CollisionSystem (real game)</div>

  <div class="summary">
    <div class="stat">
      <div class="stat-value">${totalSurfaces}</div>
      <div class="stat-label">Surfaces Tested</div>
    </div>
    <div class="stat">
      <div class="stat-value ${totalPassed === totalSurfaces ? 'pass' : ''}">${totalPassed}</div>
      <div class="stat-label">Surfaces Passing</div>
    </div>
    <div class="stat">
      <div class="stat-value ${totalFailed > 0 ? 'fail' : ''}">${totalFailed}</div>
      <div class="stat-label">Surfaces Failing</div>
    </div>
    <div class="stat">
      <div class="stat-value">${allTestsPassed}/${allTestsPassed + allTestsFailed}</div>
      <div class="stat-label">Tests Passing</div>
    </div>
  </div>

  <h2>Surface Matrix</h2>
  <table class="matrix">
    <thead>
      <tr>
        <th>Surface</th>
        <th>Status</th>
        <th>Close Kill</th>
        <th>Far Safe</th>
        <th>Bullet Hit</th>
        <th>Bullet Safe</th>
        <th>Spawn OK</th>
        <th>Positions</th>
      </tr>
    </thead>
    <tbody>
${results.map(r => renderMatrixRow(r)).join('\n')}
    </tbody>
  </table>

  <h2>Detailed Results</h2>
${results.map(r => renderSurfaceSection(r)).join('\n')}

  <script>
    document.querySelectorAll('.surface-title').forEach(el => {
      el.addEventListener('click', () => {
        const panel = el.parentElement.querySelector('.details-panel');
        panel.classList.toggle('open');
      });
    });
  </script>
</body>
</html>`;
}

function renderMatrixRow(result: SurfaceTestResult): string {
  const testNames = [
    'close-enemy-kills-player',
    'far-enemy-does-not-kill',
    'bullets-hit-close-enemy',
    'bullets-dont-hit-far-enemy',
    'player-survives-teleport',
    'enemy-positions-valid',
  ];

  const cells = testNames.map(name => {
    const test = result.tests.find(t => t.name === name);
    if (!test) return '<td>-</td>';
    return `<td><span class="badge ${test.passed ? 'badge-pass' : 'badge-fail'}">${test.passed ? 'PASS' : 'FAIL'}</span></td>`;
  });

  return `      <tr>
        <td><strong>${result.surface}</strong></td>
        <td><span class="badge ${result.overall === 'PASS' ? 'badge-pass' : 'badge-fail'}">${result.overall}</span></td>
        ${cells.join('\n        ')}
      </tr>`;
}

function renderSurfaceSection(result: SurfaceTestResult): string {
  const sectionClass = result.overall === 'PASS' ? 'pass-section' : 'fail-section';

  const testRows = result.tests.map(test => {
    const icon = test.passed ? '✓' : '✗';
    const cls = test.passed ? 'pass' : 'fail';
    const detailsStr = formatDetails(test);

    return `      <div class="test-row">
        <span class="${cls}" style="font-weight:bold;min-width:20px;">${icon}</span>
        <span class="test-name">${test.name}</span>
        <span class="test-message ${cls}">${escapeHtml(test.message)}</span>
      </div>${detailsStr ? `\n      <div class="test-details">${detailsStr}</div>` : ''}`;
  }).join('\n');

  return `  <div class="surface-section ${sectionClass}">
    <div class="surface-title">
      <span class="badge ${result.overall === 'PASS' ? 'badge-pass' : 'badge-fail'}">${result.overall}</span>
      <span>${result.surface}</span>
      <span style="color:#666;font-size:12px;">(${result.passed}/${result.tests.length} tests)</span>
    </div>
    <div class="details-panel">
${testRows}
    </div>
  </div>`;
}

function formatDetails(test: TestCaseResult): string {
  const parts: string[] = [];
  if (test.details.playerPos) {
    parts.push(`player: UV(${test.details.playerPos.u}, ${test.details.playerPos.v})`);
  }
  if (test.details.enemyPos) {
    parts.push(`enemy: UV(${test.details.enemyPos.u}, ${test.details.enemyPos.v})`);
  }
  if (test.details.distance !== undefined) {
    parts.push(`dist: ${test.details.distance.toFixed(4)}`);
  }
  if (test.details.threshold !== undefined) {
    parts.push(`threshold: ${test.details.threshold.toFixed(4)}`);
  }
  if (test.collisionCount > 0) {
    parts.push(`collisions: ${test.collisionCount}`);
  }
  return parts.length > 0 ? parts.join(' | ') : '';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
