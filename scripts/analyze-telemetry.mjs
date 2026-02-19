#!/usr/bin/env node
/**
 * Telemetry Analysis Script
 *
 * Reads performance and DDA session logs from logs/performance/ and logs/game-state/,
 * correlates them by commit hash, and generates an HTML report.
 *
 * Usage:
 *   node scripts/analyze-telemetry.mjs
 *   node scripts/analyze-telemetry.mjs --since 2026-01-01
 *   node scripts/analyze-telemetry.mjs --commit abc1234
 *   node scripts/analyze-telemetry.mjs --output reports/telemetry-report.html
 *
 * Output: reports/telemetry-<date>.html (or --output path)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const sinceIndex = args.indexOf('--since');
const commitIndex = args.indexOf('--commit');
const outputIndex = args.indexOf('--output');

const sinceDate = sinceIndex !== -1 ? new Date(args[sinceIndex + 1]) : null;
const filterCommit = commitIndex !== -1 ? args[commitIndex + 1] : null;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputPath = outputIndex !== -1
  ? args[outputIndex + 1]
  : path.join(REPORTS_DIR, `telemetry-${timestamp}.html`);

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadSessionFiles(subdir) {
  const dir = path.join(LOGS_DIR, subdir);
  if (!fs.existsSync(dir)) return [];

  const sessions = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const parsed = JSON.parse(raw);
      sessions.push({ file, ...parsed });
    } catch {
      // Skip corrupt files
    }
  }
  return sessions;
}

function filterByDate(sessions, since) {
  if (!since) return sessions;
  return sessions.filter(s => {
    const ts = s.metadata?.timestamp || s.timestamp;
    return ts && new Date(ts) >= since;
  });
}

function filterByCommit(sessions, commit) {
  if (!commit) return sessions;
  return sessions.filter(s => {
    const c = s.metadata?.gitCommitShort || s.metadata?.gitCommit || '';
    return c.startsWith(commit);
  });
}

// ---------------------------------------------------------------------------
// Statistics calculation
// ---------------------------------------------------------------------------

/**
 * Compute statistics from an array of PerformanceLogger StoredSession objects.
 * Each file may contain multiple sessions in .sessions[]
 */
function computePerfStats(files) {
  const allSessions = [];
  for (const file of files) {
    const sessions = file.sessions || [];
    for (const session of sessions) {
      allSessions.push({ ...session, _commit: file.metadata?.gitCommitShort || 'unknown' });
    }
  }

  if (allSessions.length === 0) return null;

  // Per-session summary
  const sessionStats = allSessions.map(s => ({
    timestamp: s.timestamp,
    mapType: s.mapType,
    duration: s.duration,
    avgFps: s.summary?.avgFps ?? 0,
    minFps: s.summary?.minFps ?? 0,
    maxFps: s.summary?.maxFps ?? 0,
    peakEnemies: s.summary?.peakEnemies ?? 0,
    peakDifficultyTier: s.summary?.peakDifficultyTier ?? 0,
    finalPlayerPowerLevel: s.summary?.finalPlayerPowerLevel ?? 0,
    totalKills: s.summary?.totalKills ?? 0,
    totalDeaths: s.summary?.totalDeaths ?? 0,
    totalSpikes: s.summary?.totalSpikes ?? 0,
    commit: s._commit,
  }));

  // Difficulty escalation curve: avg difficultyTier over time (from data points)
  const difficultyOverTime = {};  // time_bucket (rounded to 30s) -> [tier values]
  for (const session of allSessions) {
    const points = session.dataPoints || [];
    for (const pt of points) {
      // pt.dt is difficultyTier (compact key)
      const tier = pt.dt ?? 0;
      const timeBucket = Math.floor((pt.t || 0) / 30) * 30;
      if (!difficultyOverTime[timeBucket]) difficultyOverTime[timeBucket] = [];
      difficultyOverTime[timeBucket].push(tier);
    }
  }

  // Buff usage distribution
  const buffCounts = {};
  for (const session of allSessions) {
    const points = session.dataPoints || [];
    for (const pt of points) {
      const buffStr = pt.ab || '';
      if (!buffStr) continue;
      for (const entry of buffStr.split(',')) {
        const [type] = entry.split(':');
        if (type) buffCounts[type] = (buffCounts[type] || 0) + 1;
      }
    }
  }

  return { sessionStats, difficultyOverTime, buffCounts, totalSessions: allSessions.length };
}

/**
 * Compute statistics from DDALogger session files.
 */
function computeDDAStats(files) {
  const allSessions = [];
  for (const file of files) {
    const sessions = file.sessions || [];
    for (const session of sessions) {
      allSessions.push({ ...session, _commit: file.metadata?.gitCommitShort || 'unknown' });
    }
  }

  if (allSessions.length === 0) return null;

  const sessionStats = allSessions.map(s => ({
    startedAt: s.startedAt,
    surface: s.surface,
    duration: s.summary?.duration ?? 0,
    ddaEnabled: s.ddaEnabled,
    totalKills: s.summary?.players?.[0]?.totalKills ?? 0,
    totalDeaths: s.summary?.players?.[0]?.totalDeaths ?? 0,
    avgCompositeScore: s.summary?.players?.[0]?.avgCompositeScore ?? 0,
    maxDDALevel: s.summary?.players?.[0]?.maxDDALevel ?? 0,
    commit: s._commit,
  }));

  return { sessionStats, totalSessions: allSessions.length };
}

// ---------------------------------------------------------------------------
// Commit history
// ---------------------------------------------------------------------------

function getRecentCommits(n = 20) {
  try {
    const raw = execSync(`git log --oneline -${n}`, { cwd: PROJECT_ROOT, encoding: 'utf8' });
    return raw.trim().split('\n').map(line => {
      const [hash, ...rest] = line.split(' ');
      return { hash, message: rest.join(' ') };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// HTML report generation
// ---------------------------------------------------------------------------

function buildHtmlReport(perfStats, ddaStats, commits) {
  const now = new Date().toISOString();

  const sessionTableRows = (perfStats?.sessionStats || []).map(s => `
    <tr>
      <td>${s.timestamp?.slice(0, 19) ?? '-'}</td>
      <td>${s.mapType ?? '-'}</td>
      <td>${s.duration?.toFixed(0) ?? 0}s</td>
      <td class="${s.avgFps < 30 ? 'bad' : s.avgFps < 50 ? 'warn' : 'good'}">${s.avgFps?.toFixed(1) ?? 0}</td>
      <td class="${s.minFps < 20 ? 'bad' : s.minFps < 30 ? 'warn' : ''}">${s.minFps?.toFixed(1) ?? 0}</td>
      <td>${s.peakEnemies ?? 0}</td>
      <td>${s.peakDifficultyTier?.toFixed(2) ?? 0}</td>
      <td>${s.finalPlayerPowerLevel ?? 0}</td>
      <td>${s.totalKills ?? 0}</td>
      <td>${s.totalDeaths ?? 0}</td>
      <td>${s.totalSpikes ?? 0}</td>
      <td><code>${s.commit ?? 'unknown'}</code></td>
    </tr>
  `).join('');

  const ddaTableRows = (ddaStats?.sessionStats || []).map(s => `
    <tr>
      <td>${s.startedAt?.slice(0, 19) ?? '-'}</td>
      <td>${s.surface ?? '-'}</td>
      <td>${s.duration?.toFixed(0) ?? 0}s</td>
      <td>${s.ddaEnabled ? 'Yes' : 'No'}</td>
      <td>${s.totalKills ?? 0}</td>
      <td>${s.totalDeaths ?? 0}</td>
      <td>${s.avgCompositeScore?.toFixed(3) ?? 0}</td>
      <td>${s.maxDDALevel ?? 0}</td>
      <td><code>${s.commit ?? 'unknown'}</code></td>
    </tr>
  `).join('');

  // Difficulty curve data for chart
  const diffCurve = perfStats?.difficultyOverTime ?? {};
  const diffTimes = Object.keys(diffCurve).map(Number).sort((a, b) => a - b);
  const diffAvgs = diffTimes.map(t => {
    const vals = diffCurve[t];
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  const diffChartData = JSON.stringify({
    labels: diffTimes.map(t => `${t}s`),
    data: diffAvgs,
  });

  // Buff distribution data
  const buffEntries = Object.entries(perfStats?.buffCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const buffChartData = JSON.stringify({
    labels: buffEntries.map(([t]) => t),
    data: buffEntries.map(([, c]) => c),
  });

  // Per-session FPS data for chart
  const sessionFpsData = JSON.stringify({
    labels: (perfStats?.sessionStats || []).map((s, i) => `S${i + 1} (${s.commit ?? '?'})`),
    avgFps: (perfStats?.sessionStats || []).map(s => s.avgFps ?? 0),
    minFps: (perfStats?.sessionStats || []).map(s => s.minFps ?? 0),
  });

  const commitsHtml = commits.map(c =>
    `<tr><td><code>${c.hash}</code></td><td>${c.message}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Geometry Wars 3D — Telemetry Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0a0a12; color: #e0e0f0; padding: 20px; }
    h1 { color: #00e5ff; margin-bottom: 5px; }
    h2 { color: #7c4dff; margin: 20px 0 10px; border-bottom: 1px solid #333; padding-bottom: 5px; }
    h3 { color: #aaa; margin: 15px 0 8px; }
    .meta { color: #666; font-size: 0.85em; margin-bottom: 20px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: #141424; border: 1px solid #333; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-card .value { font-size: 2em; font-weight: bold; color: #00e5ff; }
    .stat-card .label { font-size: 0.8em; color: #888; margin-top: 4px; }
    .chart-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 24px; }
    .chart-box { background: #141424; border: 1px solid #333; border-radius: 8px; padding: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85em; margin-bottom: 20px; }
    th { background: #1a1a2e; color: #7c4dff; padding: 8px 10px; text-align: left; }
    td { padding: 6px 10px; border-bottom: 1px solid #1e1e2e; }
    tr:hover td { background: #1a1a2a; }
    .good { color: #4caf50; }
    .warn { color: #ff9800; }
    .bad { color: #f44336; }
    code { color: #64ffda; font-size: 0.9em; }
    .section { background: #0e0e1e; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .no-data { color: #555; font-style: italic; padding: 20px; text-align: center; }
    canvas { max-height: 280px; }
  </style>
</head>
<body>
  <h1>Geometry Wars 3D — Telemetry Report</h1>
  <p class="meta">Generated: ${now} | Sessions: ${perfStats?.totalSessions ?? 0} perf, ${ddaStats?.totalSessions ?? 0} DDA</p>

  <div class="stats-grid">
    <div class="stat-card"><div class="value">${perfStats?.totalSessions ?? 0}</div><div class="label">Perf Sessions</div></div>
    <div class="stat-card"><div class="value">${ddaStats?.totalSessions ?? 0}</div><div class="label">DDA Sessions</div></div>
    <div class="stat-card"><div class="value">${perfStats?.sessionStats?.length > 0 ? perfStats.sessionStats.reduce((a, s) => a + (s.avgFps ?? 0), 0) / perfStats.sessionStats.length | 0 : 0}</div><div class="label">Avg FPS (all sessions)</div></div>
    <div class="stat-card"><div class="value">${Math.max(...(perfStats?.sessionStats?.map(s => s.peakDifficultyTier ?? 0) || [0])).toFixed(2)}</div><div class="label">Peak Difficulty Tier</div></div>
    <div class="stat-card"><div class="value">${Math.max(...(perfStats?.sessionStats?.map(s => s.finalPlayerPowerLevel ?? 0) || [0]))}</div><div class="label">Max Player Level</div></div>
    <div class="stat-card"><div class="value">${perfStats?.sessionStats?.reduce((a, s) => a + (s.totalSpikes ?? 0), 0) ?? 0}</div><div class="label">Total Frame Spikes</div></div>
  </div>

  <h2>FPS Trend (per session)</h2>
  <div class="section">
    ${(perfStats?.sessionStats?.length ?? 0) > 0 ? `<div class="chart-box"><canvas id="fpsChart"></canvas></div>` : '<p class="no-data">No performance data available. Run the game with the Colyseus server to generate logs.</p>'}
  </div>

  <h2>Difficulty Escalation Curve</h2>
  <div class="section">
    ${diffTimes.length > 0 ? `<div class="chart-box"><canvas id="diffChart"></canvas></div>` : '<p class="no-data">No difficulty curve data available.</p>'}
  </div>

  <div class="chart-row">
    <div>
      <h2>Buff Stack Distribution</h2>
      <div class="section">
        ${buffEntries.length > 0 ? `<div class="chart-box"><canvas id="buffChart"></canvas></div>` : '<p class="no-data">No buff data available.</p>'}
      </div>
    </div>
  </div>

  <h2>Performance Sessions</h2>
  <div class="section">
    ${sessionTableRows ? `
    <table>
      <thead><tr>
        <th>Timestamp</th><th>Map</th><th>Duration</th><th>Avg FPS</th><th>Min FPS</th>
        <th>Peak Enemies</th><th>Peak Diff Tier</th><th>Player Level</th>
        <th>Kills</th><th>Deaths</th><th>Spikes</th><th>Commit</th>
      </tr></thead>
      <tbody>${sessionTableRows}</tbody>
    </table>` : '<p class="no-data">No performance sessions found.</p>'}
  </div>

  <h2>DDA Sessions</h2>
  <div class="section">
    ${ddaTableRows ? `
    <table>
      <thead><tr>
        <th>Started At</th><th>Surface</th><th>Duration</th><th>DDA Active</th>
        <th>Kills</th><th>Deaths</th><th>Avg Score</th><th>Max DDA Level</th><th>Commit</th>
      </tr></thead>
      <tbody>${ddaTableRows}</tbody>
    </table>` : '<p class="no-data">No DDA sessions found.</p>'}
  </div>

  <h2>Recent Commits</h2>
  <div class="section">
    ${commitsHtml ? `
    <table>
      <thead><tr><th>Hash</th><th>Message</th></tr></thead>
      <tbody>${commitsHtml}</tbody>
    </table>` : '<p class="no-data">No commit history available.</p>'}
  </div>

  <script>
    const sessionFpsData = ${sessionFpsData};
    const diffChartData = ${diffChartData};
    const buffChartData = ${buffChartData};

    const chartDefaults = {
      plugins: { legend: { labels: { color: '#aaa' } } },
      scales: {
        x: { ticks: { color: '#888' }, grid: { color: '#222' } },
        y: { ticks: { color: '#888' }, grid: { color: '#222' } }
      }
    };

    if (document.getElementById('fpsChart') && sessionFpsData.labels.length > 0) {
      new Chart(document.getElementById('fpsChart'), {
        type: 'bar',
        data: {
          labels: sessionFpsData.labels,
          datasets: [
            { label: 'Avg FPS', data: sessionFpsData.avgFps, backgroundColor: 'rgba(0,229,255,0.5)', borderColor: '#00e5ff', borderWidth: 1 },
            { label: 'Min FPS', data: sessionFpsData.minFps, backgroundColor: 'rgba(244,67,54,0.4)', borderColor: '#f44336', borderWidth: 1 }
          ]
        },
        options: { ...chartDefaults }
      });
    }

    if (document.getElementById('diffChart') && diffChartData.labels.length > 0) {
      new Chart(document.getElementById('diffChart'), {
        type: 'line',
        data: {
          labels: diffChartData.labels,
          datasets: [{
            label: 'Avg Difficulty Tier',
            data: diffChartData.data,
            borderColor: '#7c4dff',
            backgroundColor: 'rgba(124,77,255,0.15)',
            fill: true,
            tension: 0.3
          }]
        },
        options: { ...chartDefaults }
      });
    }

    if (document.getElementById('buffChart') && buffChartData.labels.length > 0) {
      new Chart(document.getElementById('buffChart'), {
        type: 'bar',
        data: {
          labels: buffChartData.labels,
          datasets: [{
            label: 'Sample Count',
            data: buffChartData.data,
            backgroundColor: 'rgba(0,230,118,0.5)',
            borderColor: '#00e676',
            borderWidth: 1
          }]
        },
        options: { ...chartDefaults, indexAxis: 'y' }
      });
    }
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[analyze-telemetry] Loading session files...');

  let perfFiles = loadSessionFiles('performance');
  let ddaFiles = loadSessionFiles('game-state');

  if (sinceDate) {
    perfFiles = filterByDate(perfFiles, sinceDate);
    ddaFiles = filterByDate(ddaFiles, sinceDate);
    console.log(`[analyze-telemetry] Filtered by date: ${sinceDate.toISOString()}`);
  }
  if (filterCommit) {
    perfFiles = filterByCommit(perfFiles, filterCommit);
    ddaFiles = filterByCommit(ddaFiles, filterCommit);
    console.log(`[analyze-telemetry] Filtered by commit: ${filterCommit}`);
  }

  console.log(`[analyze-telemetry] Found ${perfFiles.length} perf files, ${ddaFiles.length} DDA files`);

  const perfStats = computePerfStats(perfFiles);
  const ddaStats = computeDDAStats(ddaFiles);
  const commits = getRecentCommits(20);

  const html = buildHtmlReport(perfStats, ddaStats, commits);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);

  console.log(`[analyze-telemetry] Report written to: ${outputPath}`);
  console.log(`[analyze-telemetry] Sessions analyzed: ${perfStats?.totalSessions ?? 0} perf, ${ddaStats?.totalSessions ?? 0} DDA`);
}

main().catch(err => {
  console.error('[analyze-telemetry] Error:', err.message);
  process.exit(1);
});
