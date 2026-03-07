/**
 * GridTraversalReport — Generates an interactive HTML report from SPGridReport data.
 *
 * Usage:
 *   import { generateGridReport, writeGridReportHTML } from './GridTraversalReport';
 *   const html = generateGridReport(report);
 *   writeGridReportHTML(report); // writes to reports/grid-traversal-report.html
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SPGridReport } from './SPGridRunner';
import type { SurfaceGridResult, GridPoint } from './SurfaceGridWalker';

// ---------------------------------------------------------------------------
// SVG Heatmap
// ---------------------------------------------------------------------------

const SVG_W = 200;
const SVG_H = 200;
const PADDING = 10;

function buildSVGHeatmap(result: SurfaceGridResult): string {
  const plotW = SVG_W - PADDING * 2;
  const plotH = SVG_H - PADDING * 2;

  const dots = result.points
    .map((p: GridPoint) => {
      const x = PADDING + p.u * plotW;
      const y = PADDING + (1 - p.v) * plotH;
      const fill = p.stuck ? '#f85149' : '#3fb950';
      const opacity = p.stuck ? 1.0 : 0.55;
      const r = 3;
      const title = p.stuck
        ? `u=${p.u.toFixed(3)},v=${p.v.toFixed(3)}: ${p.stuckReason || 'stuck'}`
        : `u=${p.u.toFixed(3)},v=${p.v.toFixed(3)}: moved ${p.distanceMoved.toFixed(2)}`;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" opacity="${opacity}"><title>${title}</title></circle>`;
    })
    .join('\n    ');

  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" style="display:block;border:1px solid #30363d;border-radius:6px;background:#0d1117">
  <text x="${SVG_W / 2}" y="8" text-anchor="middle" font-size="7" fill="#8b949e">u →</text>
  <text x="6" y="${SVG_H / 2}" text-anchor="middle" font-size="7" fill="#8b949e" transform="rotate(-90,6,${SVG_H / 2})">v ↑</text>
  <!-- grid lines -->
  <line x1="${PADDING}" y1="${PADDING}" x2="${PADDING}" y2="${SVG_H - PADDING}" stroke="#30363d" stroke-width="0.5"/>
  <line x1="${SVG_W - PADDING}" y1="${PADDING}" x2="${SVG_W - PADDING}" y2="${SVG_H - PADDING}" stroke="#30363d" stroke-width="0.5"/>
  <line x1="${PADDING}" y1="${PADDING}" x2="${SVG_W - PADDING}" y2="${PADDING}" stroke="#30363d" stroke-width="0.5"/>
  <line x1="${PADDING}" y1="${SVG_H - PADDING}" x2="${SVG_W - PADDING}" y2="${SVG_H - PADDING}" stroke="#30363d" stroke-width="0.5"/>
  ${dots}
</svg>`;
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function stuckRate(result: SurfaceGridResult): number {
  if (result.points.length === 0) return 0;
  return result.stuckCount / result.points.length;
}

function surfaceBadgeClass(result: SurfaceGridResult): string {
  const rate = stuckRate(result);
  if (rate === 0) return 'pass';
  if (rate < 0.05) return 'warn';
  return 'fail';
}

function surfaceBadgeLabel(result: SurfaceGridResult): string {
  const rate = stuckRate(result);
  if (rate === 0) return 'PASS';
  return `${result.stuckCount} STUCK (${(rate * 100).toFixed(1)}%)`;
}

// ---------------------------------------------------------------------------
// Per-surface section
// ---------------------------------------------------------------------------

function buildSurfaceSection(result: SurfaceGridResult): string {
  const badgeClass = surfaceBadgeClass(result);
  const badgeLabel = surfaceBadgeLabel(result);
  const svg = buildSVGHeatmap(result);

  const stuckRows = result.points
    .filter((p: GridPoint) => p.stuck)
    .map(
      (p: GridPoint) =>
        `<tr>
          <td><code>u=${p.u.toFixed(4)}</code></td>
          <td><code>v=${p.v.toFixed(4)}</code></td>
          <td>${p.stuckReason || '—'}</td>
          <td>${p.distanceMoved.toFixed(4)}</td>
          <td><code>${p.worldPos.x.toFixed(2)}, ${p.worldPos.y.toFixed(2)}, ${p.worldPos.z.toFixed(2)}</code></td>
        </tr>`,
    )
    .join('\n');

  const stuckTable =
    result.stuckCount > 0
      ? `<table>
          <thead><tr>
            <th>U</th><th>V</th><th>Reason</th><th>Distance Moved</th><th>World Position</th>
          </tr></thead>
          <tbody>${stuckRows}</tbody>
        </table>`
      : `<p style="color:var(--green);margin:0.5rem 0">No stuck points on this surface.</p>`;

  return `
<details class="surface-detail">
  <summary>
    <span class="surface-name">${result.surface}</span>
    <span class="badge ${badgeClass}">${badgeLabel}</span>
    <span class="surface-meta">${result.points.length} pts &middot; ${result.durationMs}ms</span>
  </summary>
  <div class="surface-content">
    <div class="surface-body">
      <div class="heatmap-wrap">
        <p class="heatmap-label">UV Heatmap — green: pass, red: stuck</p>
        ${svg}
      </div>
      <div class="stuck-list">
        <h4>Stuck Points (${result.stuckCount})</h4>
        ${stuckTable}
      </div>
    </div>
  </div>
</details>`;
}

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

/**
 * Generate a standalone HTML report string from an SPGridReport.
 * The file is self-contained — no server needed, double-click to open.
 */
export function generateGridReport(report: SPGridReport): string {
  const date = new Date(report.runDate).toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const passCount = report.surfaces.filter((r: SurfaceGridResult) => r.stuckCount === 0).length;
  const warnCount = report.surfaces.filter(
    (r: SurfaceGridResult) => r.stuckCount > 0 && stuckRate(r) < 0.05,
  ).length;
  const failCount = report.surfaces.filter((r: SurfaceGridResult) => stuckRate(r) >= 0.05).length;

  const overallClass = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';
  const overallLabel = failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'ALL PASS';

  const surfaceSections = report.surfaces
    .map((r: SurfaceGridResult) => buildSurfaceSection(r))
    .join('\n');

  const summaryRows = report.surfaces
    .map((r: SurfaceGridResult) => {
      const cls = surfaceBadgeClass(r);
      const lbl = surfaceBadgeLabel(r);
      return `<tr>
        <td><code>${r.surface}</code></td>
        <td>${r.points.length}</td>
        <td><span class="badge ${cls}">${lbl}</span></td>
        <td>${r.stuckCount}</td>
        <td>${r.passCount}</td>
        <td>${r.durationMs}ms</td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Grid Traversal Report — ${date}</title>
<style>
  :root {
    --bg: #0d1117;
    --card: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --accent: #58a6ff;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
    --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    line-height: 1.6;
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  h1 { color: #fff; font-size: 2rem; margin-bottom: 0.5rem; }
  h2 { color: var(--accent); font-size: 1.4rem; margin: 2rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  h4 { color: var(--purple); font-size: 0.95rem; margin: 0.75rem 0 0.4rem; }
  .summary-bar { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0; }
  .stat {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.5rem;
    text-align: center;
    flex: 1;
    min-width: 110px;
  }
  .stat .num { font-size: 2rem; font-weight: bold; display: block; }
  .stat .label { font-size: 0.8rem; color: #8b949e; }
  .stat.green .num { color: var(--green); }
  .stat.yellow .num { color: var(--yellow); }
  .stat.red .num { color: var(--red); }
  .stat.blue .num { color: var(--accent); }

  /* Overall verdict banner */
  .verdict {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 1.5rem;
    font-size: 1.1rem;
    font-weight: 600;
    margin: 1rem 0;
  }
  .verdict.pass { border-color: var(--green); color: var(--green); }
  .verdict.warn { border-color: var(--yellow); color: var(--yellow); }
  .verdict.fail { border-color: var(--red); color: var(--red); }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .badge.pass { background: #0d3321; color: var(--green); }
  .badge.warn { background: #3d2e00; color: var(--yellow); }
  .badge.fail { background: #3d1418; color: var(--red); }

  /* Summary table */
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--accent); font-weight: 600; background: var(--card); font-size: 0.85rem; }
  td { font-size: 0.875rem; }

  /* Per-surface details */
  details.surface-detail {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 0.5rem 0;
  }
  details.surface-detail summary {
    padding: 0.75rem 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    list-style: none;
    user-select: none;
  }
  details.surface-detail summary::-webkit-details-marker { display: none; }
  details.surface-detail summary::before {
    content: '▶';
    font-size: 0.65rem;
    color: #8b949e;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  details.surface-detail[open] summary::before { transform: rotate(90deg); }
  details.surface-detail summary:hover { background: #1c2128; border-radius: 8px 8px 0 0; }
  .surface-name { font-weight: 600; font-size: 0.95rem; min-width: 140px; }
  .surface-meta { color: #8b949e; font-size: 0.8rem; margin-left: auto; }
  .surface-content { padding: 0 1rem 1rem; }
  .surface-body { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
  .heatmap-wrap { flex-shrink: 0; }
  .heatmap-label { font-size: 0.75rem; color: #8b949e; margin-bottom: 0.4rem; }
  .stuck-list { flex: 1; min-width: 300px; }

  code { background: #1c2128; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; font-family: 'SFMono-Regular', Consolas, monospace; }
  .meta-row { color: #8b949e; font-size: 0.875rem; margin: 0.25rem 0; }
  p { margin: 0.5rem 0; }
</style>
</head>
<body>

<h1>Grid Traversal Report</h1>
<p class="meta-row">Run date: ${date} &nbsp;|&nbsp; Density: ${report.gridDensity} &nbsp;|&nbsp; Total points: ${report.totalPoints} &nbsp;|&nbsp; Duration: ${report.durationMs}ms</p>

<div class="verdict ${overallClass}">
  ${overallLabel === 'ALL PASS' ? '✓' : overallClass === 'warn' ? '⚠' : '✗'} ${overallLabel}
  ${report.totalStuck > 0 ? `&nbsp;— ${report.totalStuck} stuck point${report.totalStuck === 1 ? '' : 's'}` : '— 0 stuck points'}
  ${report.worstSurface ? `&nbsp;(worst: <code>${report.worstSurface}</code>)` : ''}
</div>

<div class="summary-bar">
  <div class="stat green"><span class="num">${passCount}</span><span class="label">Surfaces Pass</span></div>
  <div class="stat yellow"><span class="num">${warnCount}</span><span class="label">Surfaces Warn (&lt;5%)</span></div>
  <div class="stat red"><span class="num">${failCount}</span><span class="label">Surfaces Fail (&ge;5%)</span></div>
  <div class="stat blue"><span class="num">${report.totalPoints}</span><span class="label">Total Points</span></div>
  <div class="stat ${report.totalStuck > 0 ? 'red' : 'green'}"><span class="num">${report.totalStuck}</span><span class="label">Total Stuck</span></div>
</div>

<h2>Surface Summary</h2>
<table>
  <thead>
    <tr>
      <th>Surface</th>
      <th>Points</th>
      <th>Status</th>
      <th>Stuck</th>
      <th>Pass</th>
      <th>Duration</th>
    </tr>
  </thead>
  <tbody>
    ${summaryRows}
  </tbody>
</table>

<h2>Per-Surface Details</h2>
<p style="color:#8b949e;font-size:0.85rem;margin-bottom:1rem">Click a surface to expand the UV heatmap and stuck point list.</p>
${surfaceSections}

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------

/**
 * Write the HTML report to disk.
 * Default output: reports/grid-traversal-report.html (relative to project root).
 */
export function writeGridReportHTML(report: SPGridReport, outputPath?: string): void {
  const resolvedPath =
    outputPath ??
    path.resolve(__dirname, '../../reports/grid-traversal-report.html');

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const html = generateGridReport(report);
  fs.writeFileSync(resolvedPath, html, 'utf-8');
}
