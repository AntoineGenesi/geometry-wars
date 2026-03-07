/**
 * SurfaceVerificationReport — Generates an interactive HTML report from surface verification data.
 *
 * Usage:
 *   import { generateSurfaceVerificationReport, writeSurfaceVerificationHTML } from './SurfaceVerificationReport';
 *   const html = generateSurfaceVerificationReport(run, historyRuns);
 *   writeSurfaceVerificationHTML(run, historyRuns, outputPath);
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  SpeedVerificationResult,
  BulletVerificationResult,
  HitDetectionResult,
  SeamTraversalResult,
} from './SurfaceVerifier';
import type { SurfaceType } from '../../src/surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SurfaceRunEntry {
  surface: SurfaceType;
  speed: SpeedVerificationResult;
  bulletOrigin: BulletVerificationResult;
  hitDetection: HitDetectionResult;
  seam: SeamTraversalResult | { status: 'skipped'; surface: SurfaceType };
  error?: string;
}

export interface SurfaceVerificationRun {
  runDate: string;
  gitHash: string;
  surfaces: SurfaceRunEntry[];
  summary: {
    totalSurfaces: number;
    speedFails: number;
    bulletFails: number;
    hitDetectionFails: number;
    seamFails: number;
    overallPass: boolean;
  };
}

// ---------------------------------------------------------------------------
// SVG Heatmap helpers
// ---------------------------------------------------------------------------

const SVG_W = 180;
const SVG_H = 180;
const PADDING = 10;

function statusToColor(status: string): string {
  switch (status) {
    case 'pass': return '#3fb950';
    case 'warn':
    case 'warning': return '#d29922';
    case 'slow':
    case 'error':
    case 'fail':
    case 'fail-no-damage':
    case 'fail-ghost-kill': return '#f85149';
    case 'teleport-failed':
    case 'no-bullet': return '#8b949e';
    case 'fast': return '#58a6ff';
    default: return '#8b949e';
  }
}

function buildSpeedHeatmap(result: SpeedVerificationResult): string {
  const plotW = SVG_W - PADDING * 2;
  const plotH = SVG_H - PADDING * 2;

  const dots = result.points.map(p => {
    const x = PADDING + p.u * plotW;
    const y = PADDING + (1 - p.v) * plotH;
    const fill = statusToColor(p.status);
    const opacity = p.status === 'pass' ? 0.6 : 1.0;
    const r = 3;
    const wp = p.worldPos;
    const dataPoint = JSON.stringify({
      u: p.u,
      v: p.v,
      worldPos: [wp.x.toFixed(2), wp.y.toFixed(2), wp.z.toFixed(2)],
      status: p.status,
      speedRatio: p.speedRatio.toFixed(2),
      distanceMoved: p.distanceMoved.toFixed(3),
    }).replace(/'/g, '&#39;');
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" opacity="${opacity}" data-point='${dataPoint}' onclick="showPointDetail(this)" style="cursor:pointer"><title>u=${p.u.toFixed(3)},v=${p.v.toFixed(3)}: ratio=${p.speedRatio.toFixed(2)} [${p.status}]</title></circle>`;
  }).join('\n    ');

  return buildSVGWrapper('Speed', dots);
}

function buildBulletHeatmap(result: BulletVerificationResult): string {
  const plotW = SVG_W - PADDING * 2;
  const plotH = SVG_H - PADDING * 2;

  const dots = result.points.map(p => {
    const x = PADDING + p.u * plotW;
    const y = PADDING + (1 - p.v) * plotH;
    const fill = statusToColor(p.status);
    const opacity = p.status === 'pass' ? 0.6 : 1.0;
    const r = 3;
    const pw = p.playerWorldPos;
    const bw = p.bulletWorldPos;
    const dataPoint = JSON.stringify({
      u: p.u,
      v: p.v,
      worldPos: [pw.x.toFixed(2), pw.y.toFixed(2), pw.z.toFixed(2)],
      bulletPos: bw ? [bw.x.toFixed(2), bw.y.toFixed(2), bw.z.toFixed(2)] : null,
      status: p.status,
      offsetDistance: p.offsetDistance !== null ? p.offsetDistance.toFixed(3) : null,
    }).replace(/'/g, '&#39;');
    const title = `u=${p.u.toFixed(3)},v=${p.v.toFixed(3)}: offset=${p.offsetDistance?.toFixed(2) ?? 'n/a'} [${p.status}]`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" opacity="${opacity}" data-point='${dataPoint}' onclick="showPointDetail(this)" style="cursor:pointer"><title>${title}</title></circle>`;
  }).join('\n    ');

  return buildSVGWrapper('Bullet Origin', dots);
}

function buildHitDetectionHeatmap(result: HitDetectionResult): string {
  const plotW = SVG_W - PADDING * 2;
  const plotH = SVG_H - PADDING * 2;

  const dots = result.samplePoints.map(p => {
    const x = PADDING + p.u * plotW;
    const y = PADDING + (1 - p.v) * plotH;
    const fill = statusToColor(p.status);
    const opacity = p.status === 'pass' ? 0.6 : 1.0;
    const r = 4;
    const pw = p.playerWorldPos;
    const dataPoint = JSON.stringify({
      u: p.u,
      v: p.v,
      worldPos: [pw.x.toFixed(2), pw.y.toFixed(2), pw.z.toFixed(2)],
      status: p.status,
      damageReceived: p.damageReceived,
    }).replace(/'/g, '&#39;');
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" opacity="${opacity}" data-point='${dataPoint}' onclick="showPointDetail(this)" style="cursor:pointer"><title>u=${p.u.toFixed(3)},v=${p.v.toFixed(3)}: [${p.status}]</title></circle>`;
  }).join('\n    ');

  return buildSVGWrapper('Hit Detection', dots);
}

function buildSeamSVG(seam: SeamTraversalResult | { status: 'skipped'; surface: SurfaceType }): string {
  if (seam.status === 'skipped') {
    return `<div style="width:${SVG_W}px;height:${SVG_H}px;display:flex;align-items:center;justify-content:center;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#8b949e;font-size:0.75rem">N/A (no seams)</div>`;
  }
  const result = seam as SeamTraversalResult;
  const fill = statusToColor(result.status);
  const label = result.status.toUpperCase();
  const detail = result.crossingDetected
    ? `Crossed at frame ${result.framesUsed}`
    : result.stuckBeforeSeam
    ? `Stuck at frame ${result.framesUsed}`
    : `No crossing in ${result.framesUsed} frames`;

  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" style="display:block;border:1px solid #30363d;border-radius:6px;background:#0d1117">
  <text x="${SVG_W / 2}" y="20" text-anchor="middle" font-size="9" fill="#8b949e">Seam Traversal</text>
  <circle cx="${SVG_W / 2}" cy="${SVG_H / 2 - 10}" r="40" fill="${fill}" opacity="0.3" stroke="${fill}" stroke-width="2"/>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 - 5}" text-anchor="middle" font-size="16" font-weight="bold" fill="${fill}">${label}</text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 + 15}" text-anchor="middle" font-size="8" fill="#8b949e">${detail}</text>
  <text x="${SVG_W / 2}" y="${SVG_H / 2 + 30}" text-anchor="middle" font-size="8" fill="#8b949e">dir: ${result.direction}</text>
</svg>`;
}

function buildSVGWrapper(label: string, dots: string): string {
  return `<svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" style="display:block;border:1px solid #30363d;border-radius:6px;background:#0d1117">
  <text x="${SVG_W / 2}" y="8" text-anchor="middle" font-size="7" fill="#8b949e">${label}</text>
  <text x="${SVG_W / 2}" y="16" text-anchor="middle" font-size="6" fill="#555d69">u →</text>
  <text x="6" y="${SVG_H / 2}" text-anchor="middle" font-size="6" fill="#555d69" transform="rotate(-90,6,${SVG_H / 2})">v ↑</text>
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

function surfaceOverallBadge(entry: SurfaceRunEntry): { cls: string; label: string } {
  if (entry.error) return { cls: 'fail', label: 'ERROR' };

  const speedFail = entry.speed.slowCount > 0;
  const bulletFail = entry.bulletOrigin.errorCount > 0;
  const hitFail = entry.hitDetection.failNoDamageCount > 0 || entry.hitDetection.failGhostKillCount > 0;
  const seamFail = entry.seam.status === 'fail';

  const speedWarn = entry.speed.fastCount > 0;
  const bulletWarn = entry.bulletOrigin.warningCount > 0;
  const seamWarn = entry.seam.status === 'warn';

  if (speedFail || bulletFail || hitFail || seamFail) return { cls: 'fail', label: 'FAIL' };
  if (speedWarn || bulletWarn || seamWarn) return { cls: 'warn', label: 'WARN' };
  return { cls: 'pass', label: 'PASS' };
}

// ---------------------------------------------------------------------------
// Per-surface section
// ---------------------------------------------------------------------------

function buildSurfaceSection(entry: SurfaceRunEntry): string {
  const badge = surfaceOverallBadge(entry);
  const totalDurationMs = entry.speed.durationMs + entry.bulletOrigin.durationMs +
    entry.hitDetection.durationMs + (entry.seam.status !== 'skipped' ? (entry.seam as SeamTraversalResult).framesUsed : 0);

  if (entry.error) {
    return `
<details class="surface-detail">
  <summary>
    <span class="surface-name">${entry.surface}</span>
    <span class="badge fail">ERROR</span>
    <span class="surface-meta">Test threw an exception</span>
  </summary>
  <div class="surface-content">
    <p style="color:var(--red);padding:0.5rem 0"><code>${entry.error}</code></p>
  </div>
</details>`;
  }

  const speedBadge = entry.speed.slowCount > 0
    ? `<span class="badge fail">${entry.speed.slowCount} SLOW</span>`
    : entry.speed.fastCount > 0
    ? `<span class="badge warn">${entry.speed.fastCount} FAST</span>`
    : `<span class="badge pass">PASS</span>`;

  const bulletBadge = entry.bulletOrigin.errorCount > 0
    ? `<span class="badge fail">${entry.bulletOrigin.errorCount} ERR</span>`
    : entry.bulletOrigin.warningCount > 0
    ? `<span class="badge warn">${entry.bulletOrigin.warningCount} WARN</span>`
    : `<span class="badge pass">PASS</span>`;

  const hitBadge = (entry.hitDetection.failNoDamageCount + entry.hitDetection.failGhostKillCount) > 0
    ? `<span class="badge fail">${entry.hitDetection.failNoDamageCount + entry.hitDetection.failGhostKillCount} FAIL</span>`
    : `<span class="badge pass">PASS</span>`;

  const seamBadge = entry.seam.status === 'skipped'
    ? `<span class="badge" style="background:#1c2128;color:#8b949e">SKIP</span>`
    : entry.seam.status === 'fail'
    ? `<span class="badge fail">FAIL</span>`
    : entry.seam.status === 'warn'
    ? `<span class="badge warn">WARN</span>`
    : `<span class="badge pass">PASS</span>`;

  const speedSvg = buildSpeedHeatmap(entry.speed);
  const bulletSvg = buildBulletHeatmap(entry.bulletOrigin);
  const hitSvg = buildHitDetectionHeatmap(entry.hitDetection);
  const seamSvg = buildSeamSVG(entry.seam);

  return `
<details class="surface-detail">
  <summary>
    <span class="surface-name">${entry.surface}</span>
    <span class="badge ${badge.cls}">${badge.label}</span>
    <span class="surface-meta">
      Speed ${speedBadge} &nbsp; Bullet ${bulletBadge} &nbsp; Hit ${hitBadge} &nbsp; Seam ${seamBadge}
    </span>
  </summary>
  <div class="surface-content">
    <div class="heatmaps-row">
      <div class="heatmap-col">
        <p class="heatmap-label">Speed Consistency<br><small>green=pass, yellow=fast, red=slow</small></p>
        ${speedSvg}
        <p class="heatmap-stat">${entry.speed.slowCount} slow &bull; ${entry.speed.fastCount} fast &bull; ${entry.speed.passCount} pass</p>
      </div>
      <div class="heatmap-col">
        <p class="heatmap-label">Bullet Origin<br><small>green=pass, yellow=warn, red=error</small></p>
        ${bulletSvg}
        <p class="heatmap-stat">${entry.bulletOrigin.errorCount} errors &bull; ${entry.bulletOrigin.warningCount} warns &bull; ${entry.bulletOrigin.passCount} pass</p>
      </div>
      <div class="heatmap-col">
        <p class="heatmap-label">Hit Detection<br><small>green=pass, red=fail</small></p>
        ${hitSvg}
        <p class="heatmap-stat">${entry.hitDetection.failNoDamageCount} no-dmg &bull; ${entry.hitDetection.failGhostKillCount} ghost &bull; ${entry.hitDetection.passCount} pass</p>
      </div>
      <div class="heatmap-col">
        <p class="heatmap-label">Seam Traversal<br><small>green=pass, yellow=warn, red=fail</small></p>
        ${seamSvg}
      </div>
    </div>
  </div>
</details>`;
}

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

/**
 * Generate a standalone HTML report string from a SurfaceVerificationRun.
 * The file is self-contained — no server needed, double-click to open.
 * History runs are embedded as inline JSON.
 */
export function generateSurfaceVerificationReport(
  run: SurfaceVerificationRun,
  historyRuns: SurfaceVerificationRun[] = [],
): string {
  const date = new Date(run.runDate).toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const { summary } = run;
  const overallClass = !summary.overallPass ? 'fail' : 'pass';
  const overallLabel = summary.overallPass ? 'ALL PASS' : 'FAILURES FOUND';

  const surfaceSections = run.surfaces.map(buildSurfaceSection).join('\n');

  const summaryRows = run.surfaces.map(entry => {
    const badge = surfaceOverallBadge(entry);
    const speedStr = entry.error ? '—' : `${entry.speed.slowCount}↓ ${entry.speed.fastCount}↑`;
    const bulletStr = entry.error ? '—' : `${entry.bulletOrigin.errorCount}e ${entry.bulletOrigin.warningCount}w`;
    const hitStr = entry.error ? '—' : `${entry.hitDetection.failNoDamageCount + entry.hitDetection.failGhostKillCount} fail`;
    const seamStr = entry.seam.status === 'skipped' ? 'skip' : entry.seam.status;
    return `<tr>
      <td><code>${entry.surface}</code></td>
      <td><span class="badge ${badge.cls}">${badge.label}</span></td>
      <td>${speedStr}</td>
      <td>${bulletStr}</td>
      <td>${hitStr}</td>
      <td><span class="badge ${entry.seam.status === 'pass' ? 'pass' : entry.seam.status === 'fail' ? 'fail' : entry.seam.status === 'warn' ? 'warn' : ''}">${seamStr}</span></td>
    </tr>`;
  }).join('\n');

  // History table rows — newest first
  const allRuns = [...historyRuns, run].sort(
    (a, b) => new Date(b.runDate).getTime() - new Date(a.runDate).getTime(),
  );

  const historyData = allRuns.map(r => ({
    date: new Date(r.runDate).toLocaleString('en-US', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
    gitHash: r.gitHash,
    speedFails: r.summary.speedFails,
    bulletFails: r.summary.bulletFails,
    hitFails: r.summary.hitDetectionFails,
    seamFails: r.summary.seamFails,
    overall: r.summary.overallPass ? 'PASS' : 'FAIL',
  }));

  const historyJson = JSON.stringify(historyData, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Surface Verification Report — ${date}</title>
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
    max-width: 1400px;
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
    min-width: 100px;
  }
  .stat .num { font-size: 2rem; font-weight: bold; display: block; }
  .stat .label { font-size: 0.8rem; color: #8b949e; }
  .stat.green .num { color: var(--green); }
  .stat.yellow .num { color: var(--yellow); }
  .stat.red .num { color: var(--red); }
  .stat.blue .num { color: var(--accent); }
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
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--accent); font-weight: 600; background: var(--card); font-size: 0.85rem; }
  td { font-size: 0.875rem; }
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
    flex-wrap: wrap;
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
  .surface-name { font-weight: 600; font-size: 0.95rem; min-width: 120px; }
  .surface-meta { color: #8b949e; font-size: 0.8rem; margin-left: auto; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .surface-content { padding: 0 1rem 1rem; }
  .heatmaps-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.75rem; }
  .heatmap-col { flex-shrink: 0; }
  .heatmap-label { font-size: 0.75rem; color: #8b949e; margin-bottom: 0.4rem; line-height: 1.3; }
  .heatmap-label small { color: #555d69; }
  .heatmap-stat { font-size: 0.7rem; color: #8b949e; margin-top: 0.3rem; }
  code { background: #1c2128; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; font-family: 'SFMono-Regular', Consolas, monospace; }
  .meta-row { color: #8b949e; font-size: 0.875rem; margin: 0.25rem 0; }
  p { margin: 0.5rem 0; }

  /* Point detail popup */
  #point-detail {
    display: none;
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: var(--card);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 1rem;
    max-width: 320px;
    z-index: 1000;
    font-size: 0.85rem;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  #point-detail .close-btn {
    float: right;
    cursor: pointer;
    color: #8b949e;
    font-size: 1rem;
    line-height: 1;
    margin-left: 0.5rem;
  }
  #point-detail .close-btn:hover { color: var(--red); }
  #point-detail h4 { margin-top: 0; color: var(--accent); }
  #point-detail .detail-row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.15rem 0; border-bottom: 1px solid #30363d; }
  #point-detail .detail-row:last-child { border-bottom: none; }
  #point-detail .detail-key { color: #8b949e; }
  #point-detail .detail-val { font-family: monospace; color: var(--text); }

  /* History table */
  .history-section { margin-top: 2rem; }
  .history-pass { color: var(--green); font-weight: 600; }
  .history-fail { color: var(--red); font-weight: 600; }
</style>
</head>
<body>

<h1>Surface Verification Report</h1>
<p class="meta-row">Run date: ${date} &nbsp;|&nbsp; Commit: <code>${run.gitHash}</code> &nbsp;|&nbsp; Surfaces: ${summary.totalSurfaces}</p>

<div class="verdict ${overallClass}">
  ${summary.overallPass ? '✓' : '✗'} ${overallLabel}
</div>

<div class="summary-bar">
  <div class="stat ${summary.speedFails > 0 ? 'red' : 'green'}">
    <span class="num">${summary.speedFails}</span>
    <span class="label">Speed Fails</span>
  </div>
  <div class="stat ${summary.bulletFails > 0 ? 'red' : 'green'}">
    <span class="num">${summary.bulletFails}</span>
    <span class="label">Bullet Fails</span>
  </div>
  <div class="stat ${summary.hitDetectionFails > 0 ? 'red' : 'green'}">
    <span class="num">${summary.hitDetectionFails}</span>
    <span class="label">Hit Detect Fails</span>
  </div>
  <div class="stat ${summary.seamFails > 0 ? 'red' : 'green'}">
    <span class="num">${summary.seamFails}</span>
    <span class="label">Seam Fails</span>
  </div>
  <div class="stat blue">
    <span class="num">${summary.totalSurfaces}</span>
    <span class="label">Surfaces Tested</span>
  </div>
</div>

<h2>Historical Runs</h2>
<div class="history-section">
  <table id="history-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Commit</th>
        <th>Speed Fails</th>
        <th>Bullet Fails</th>
        <th>Hit Fails</th>
        <th>Seam Fails</th>
        <th>Overall</th>
      </tr>
    </thead>
    <tbody id="history-rows"></tbody>
  </table>
</div>

<h2>Surface Summary</h2>
<table>
  <thead>
    <tr>
      <th>Surface</th>
      <th>Overall</th>
      <th>Speed (↓slow ↑fast)</th>
      <th>Bullet (e=error w=warn)</th>
      <th>Hit Detection</th>
      <th>Seam</th>
    </tr>
  </thead>
  <tbody>
    ${summaryRows}
  </tbody>
</table>

<h2>Per-Surface Details</h2>
<p style="color:#8b949e;font-size:0.85rem;margin-bottom:1rem">
  Click a surface to expand all 4 test heatmaps. Click any dot in the heatmap to see point details.
</p>
${surfaceSections}

<!-- Point detail popup -->
<div id="point-detail">
  <span class="close-btn" onclick="document.getElementById('point-detail').style.display='none'">✕</span>
  <h4 id="pd-title">Point Detail</h4>
  <div id="pd-rows"></div>
</div>

<script>
// ---------------------------------------------------------------------------
// History table
// ---------------------------------------------------------------------------
const HISTORY = ${historyJson};

(function renderHistory() {
  const tbody = document.getElementById('history-rows');
  if (!tbody || !HISTORY.length) return;

  HISTORY.forEach(function(r) {
    const tr = document.createElement('tr');
    const overallCls = r.overall === 'PASS' ? 'history-pass' : 'history-fail';
    tr.innerHTML =
      '<td>' + r.date + '</td>' +
      '<td><code>' + r.gitHash + '</code></td>' +
      '<td>' + r.speedFails + '</td>' +
      '<td>' + r.bulletFails + '</td>' +
      '<td>' + r.hitFails + '</td>' +
      '<td>' + r.seamFails + '</td>' +
      '<td class="' + overallCls + '">' + r.overall + '</td>';
    tbody.appendChild(tr);
  });
})();

// ---------------------------------------------------------------------------
// Point detail popup
// ---------------------------------------------------------------------------
function showPointDetail(circle) {
  const raw = circle.getAttribute('data-point');
  if (!raw) return;

  let data;
  try { data = JSON.parse(raw); } catch(e) { return; }

  const popup = document.getElementById('point-detail');
  const title = document.getElementById('pd-title');
  const rows = document.getElementById('pd-rows');
  if (!popup || !title || !rows) return;

  title.textContent = 'Point at u=' + (data.u !== undefined ? data.u.toFixed(4) : '?') + ', v=' + (data.v !== undefined ? data.v.toFixed(4) : '?');

  const statusColors = {
    pass: '#3fb950', warn: '#d29922', warning: '#d29922',
    slow: '#f85149', error: '#f85149', fail: '#f85149',
    'fail-no-damage': '#f85149', 'fail-ghost-kill': '#f85149',
    fast: '#58a6ff', 'no-bullet': '#8b949e', 'teleport-failed': '#8b949e',
  };

  const entries = [];
  if (data.status !== undefined) {
    const color = statusColors[data.status] || '#c9d1d9';
    entries.push(['Status', '<span style="color:' + color + ';font-weight:600">' + data.status + '</span>']);
  }
  if (data.worldPos) entries.push(['World XYZ', data.worldPos.join(', ')]);
  if (data.bulletPos) entries.push(['Bullet XYZ', data.bulletPos.join(', ')]);
  if (data.speedRatio !== undefined) entries.push(['Speed ratio', data.speedRatio]);
  if (data.distanceMoved !== undefined) entries.push(['Distance moved', data.distanceMoved]);
  if (data.offsetDistance !== null && data.offsetDistance !== undefined) entries.push(['Bullet offset', data.offsetDistance]);
  if (data.damageReceived !== undefined) entries.push(['Damage received', String(data.damageReceived)]);

  rows.innerHTML = entries.map(function(e) {
    return '<div class="detail-row"><span class="detail-key">' + e[0] + '</span><span class="detail-val">' + e[1] + '</span></div>';
  }).join('');

  popup.style.display = 'block';
}

// Close popup when clicking outside heatmaps
document.addEventListener('click', function(e) {
  const popup = document.getElementById('point-detail');
  if (!popup) return;
  if (popup.style.display !== 'block') return;
  const target = e.target;
  if (target && target.tagName === 'circle') return; // SVG circle
  if (target && (target === popup || popup.contains(target))) return;
  popup.style.display = 'none';
});
</script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------

/**
 * Write the HTML report to disk.
 */
export function writeSurfaceVerificationHTML(
  run: SurfaceVerificationRun,
  historyRuns: SurfaceVerificationRun[],
  outputPath: string,
): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const html = generateSurfaceVerificationReport(run, historyRuns);
  fs.writeFileSync(outputPath, html, 'utf-8');
}
