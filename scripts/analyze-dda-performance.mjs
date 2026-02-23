#!/usr/bin/env node
/**
 * Geometry Wars 3D — DDA + Performance Analysis Queries
 *
 * Loads session data from logs/ and runs targeted analysis queries.
 * Designed for beta testing readout — run after each play session.
 *
 * Usage:
 *   node scripts/analyze-dda-performance.mjs
 *   node scripts/analyze-dda-performance.mjs --query dda
 *   node scripts/analyze-dda-performance.mjs --query fps
 *   node scripts/analyze-dda-performance.mjs --query stuck
 *   node scripts/analyze-dda-performance.mjs --query all
 *   node scripts/analyze-dda-performance.mjs --last 3        # Last N sessions
 *   node scripts/analyze-dda-performance.mjs --output reports/analysis.html
 *
 * Queries:
 *   dda        DDA difficulty progression over time + level changes
 *   fps        FPS/CPU performance metrics per session
 *   correlation FPS vs difficulty correlation
 *   progression Player progression patterns (kills, power level, weapon use)
 *   stuck      Sessions where player got stuck (playerStuck = true)
 *   all        Run all queries (default)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_PERF_DIR = path.join(PROJECT_ROOT, 'logs', 'performance');
const LOGS_DDA_DIR = path.join(PROJECT_ROOT, 'logs', 'game-state');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const queryArg = args[args.indexOf('--query') + 1] ?? 'all';
const lastN = args.indexOf('--last') !== -1 ? parseInt(args[args.indexOf('--last') + 1], 10) : null;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputPath = args.indexOf('--output') !== -1
  ? args[args.indexOf('--output') + 1]
  : path.join(REPORTS_DIR, `dda-analysis-${timestamp}.html`);

// ─── Data Loading ────────────────────────────────────────────────────────────

function loadDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .flatMap(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const commit = raw.metadata?.gitCommitShort ?? 'unknown';
        return (raw.sessions ?? []).map(s => ({ ...s, _commit: commit, _file: f }));
      } catch { return []; }
    });
}

/** Load data points from a perf session, expanding compact keys. */
function expandPoints(session) {
  return (session.dataPoints ?? []).map(p => ({
    time:            p.t  ?? 0,
    fps:             p.f  ?? 0,
    enemyCount:      p.e  ?? 0,
    bulletCount:     p.b  ?? 0,
    drawCalls:       p.dc ?? 0,
    triangles:       p.tr ?? 0,
    memoryMB:        p.mm ?? 0,
    ddaLevel:        p.dd ?? 0,
    difficultyTier:  p.dt ?? 0,
    playerPowerLevel: p.pl ?? 0,
    qualityLevel:    p.ql ?? '',
    score:           p.s  ?? 0,
    kills:           p.k  ?? 0,
    deaths:          p.d  ?? 0,
    activeWeapon:    p.aw ?? 'Standard',
    activeBuffs:     p.ab ?? '',
    killsThisSample: p.ks ?? 0,
    activeEffects:   p.ae ?? 0,
    visibleEnemies:  p.ve ?? 0,
    playerSurfaceU:  p.pu ?? 0,
    playerSurfaceV:  p.pv ?? 0,
    playerFaceIndex: p.pf ?? 0,
    playerWorldX:    p.px ?? 0,
    playerWorldY:    p.py ?? 0,
    playerWorldZ:    p.pz ?? 0,
    playerStuck:     p.ps === true,
  }));
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * p / 100)];
}
function corr(xs, ys) {
  if (xs.length < 2) return 0;
  const mx = avg(xs), my = avg(ys);
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((a, x) => a + (x - mx) ** 2, 0) *
    ys.reduce((a, y) => a + (y - my) ** 2, 0)
  );
  return den ? num / den : 0;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Q1: DDA difficulty progression — show how DDA level + difficulty tier evolve per session. */
function queryDDA(perfSessions, ddaSessions) {
  const results = perfSessions.map(s => {
    const pts = expandPoints(s);
    if (!pts.length) return null;

    // Group samples into 30-second buckets
    const buckets = {};
    for (const p of pts) {
      const b = Math.floor(p.time / 30) * 30;
      if (!buckets[b]) buckets[b] = { dda: [], diff: [], fps: [] };
      buckets[b].dda.push(p.ddaLevel);
      buckets[b].diff.push(p.difficultyTier);
      buckets[b].fps.push(p.fps);
    }

    const curve = Object.entries(buckets)
      .sort(([a], [b]) => +a - +b)
      .map(([t, v]) => ({
        timeS: +t,
        avgDDA: Math.round(avg(v.dda) * 100) / 100,
        avgDiff: Math.round(avg(v.diff) * 100) / 100,
        avgFps: Math.round(avg(v.fps) * 10) / 10,
      }));

    return {
      timestamp: s.timestamp?.slice(0, 19) ?? '-',
      mapType: s.mapType ?? '-',
      duration: s.duration ?? 0,
      commit: s._commit,
      startDDA: curve[0]?.avgDDA ?? 0,
      endDDA: curve[curve.length - 1]?.avgDDA ?? 0,
      ddaTrend: (curve[curve.length - 1]?.avgDDA ?? 0) - (curve[0]?.avgDDA ?? 0),
      peakDiff: s.summary?.peakDifficultyTier ?? 0,
      curve,
    };
  }).filter(Boolean);

  return results;
}

/** Q2: FPS / CPU performance metrics — per-session distribution stats. */
function queryFPS(perfSessions) {
  return perfSessions.map(s => {
    const pts = expandPoints(s);
    const fpsList = pts.map(p => p.fps).filter(f => f > 0);
    const spikes = pts.filter(p => p.fps < 30);
    const lowFpsWindows = pts.filter(p => p.fps < 45);

    // Worst moments: low FPS with high enemy count
    const worstMoments = pts
      .filter(p => p.fps < 35)
      .sort((a, b) => a.fps - b.fps)
      .slice(0, 3)
      .map(p => ({
        timeS: p.time,
        fps: p.fps,
        enemies: p.enemyCount,
        bullets: p.bulletCount,
        diffTier: p.difficultyTier,
      }));

    return {
      timestamp: s.timestamp?.slice(0, 19) ?? '-',
      mapType: s.mapType ?? '-',
      duration: s.duration ?? 0,
      commit: s._commit,
      avgFps: Math.round(avg(fpsList) * 10) / 10,
      medianFps: Math.round(median(fpsList) * 10) / 10,
      p5Fps: Math.round(pct(fpsList, 5) * 10) / 10,
      p1Fps: Math.round(pct(fpsList, 1) * 10) / 10,
      minFps: s.summary?.minFps ?? Math.min(...fpsList),
      spikeCount: spikes.length,
      lowFpsPct: fpsList.length ? Math.round((lowFpsWindows.length / fpsList.length) * 100) : 0,
      peakEnemies: s.summary?.peakEnemies ?? 0,
      peakBullets: s.summary?.peakBullets ?? 0,
      peakDrawCalls: s.summary?.peakDrawCalls ?? 0,
      worstMoments,
    };
  });
}

/** Q3: FPS vs difficulty correlation — does high difficulty correlate with FPS drops? */
function queryCorrelation(perfSessions) {
  const results = perfSessions.map(s => {
    const pts = expandPoints(s);
    if (pts.length < 10) return null;

    const fps   = pts.map(p => p.fps);
    const diff  = pts.map(p => p.difficultyTier);
    const enemy = pts.map(p => p.enemyCount);

    const fpsDiffCorr  = Math.round(corr(fps, diff) * 1000) / 1000;
    const fpsEnemyCorr = Math.round(corr(fps, enemy) * 1000) / 1000;

    // Difficulty buckets: group by tier integer
    const tierBuckets = {};
    for (const p of pts) {
      const t = Math.floor(p.difficultyTier);
      if (!tierBuckets[t]) tierBuckets[t] = [];
      tierBuckets[t].push(p.fps);
    }
    const tierFpsMap = Object.entries(tierBuckets)
      .sort(([a], [b]) => +a - +b)
      .map(([tier, fpsList]) => ({
        tier: +tier,
        avgFps: Math.round(avg(fpsList) * 10) / 10,
        samples: fpsList.length,
      }));

    return {
      timestamp: s.timestamp?.slice(0, 19) ?? '-',
      mapType: s.mapType ?? '-',
      commit: s._commit,
      fpsDiffCorr,
      fpsEnemyCorr,
      tierFpsMap,
      interpretation:
        fpsDiffCorr < -0.5 ? 'STRONG: FPS drops significantly with difficulty' :
        fpsDiffCorr < -0.2 ? 'MODERATE: Some FPS impact from difficulty' :
        fpsDiffCorr > 0.1  ? 'POSITIVE: FPS stays high at high difficulty (good sign)' :
                             'WEAK: Difficulty does not strongly affect FPS',
    };
  }).filter(Boolean);
  return results;
}

/** Q4: Player progression — kills, weapon upgrades, power level, kill rate over time. */
function queryProgression(perfSessions) {
  return perfSessions.map(s => {
    const pts = expandPoints(s);
    if (!pts.length) return null;

    // Weapon timeline: when did player switch weapons?
    const weaponChanges = [];
    let lastWeapon = '';
    for (const p of pts) {
      if (p.activeWeapon !== lastWeapon) {
        weaponChanges.push({ timeS: p.time, weapon: p.activeWeapon });
        lastWeapon = p.activeWeapon;
      }
    }

    // Kill rate over time (30s buckets)
    const killRateBuckets = {};
    for (const p of pts) {
      const b = Math.floor(p.time / 30) * 30;
      if (!killRateBuckets[b]) killRateBuckets[b] = [];
      killRateBuckets[b].push(p.killsThisSample * 2); // per-minute equivalent
    }
    const killRateCurve = Object.entries(killRateBuckets)
      .sort(([a], [b]) => +a - +b)
      .map(([t, v]) => ({ timeS: +t, killsPerMin: Math.round(avg(v) * 10) / 10 }));

    // Power level milestones
    const powerMilestones = [];
    let lastLevel = 0;
    for (const p of pts) {
      if (p.playerPowerLevel > lastLevel) {
        powerMilestones.push({ timeS: p.time, level: p.playerPowerLevel });
        lastLevel = p.playerPowerLevel;
      }
    }

    return {
      timestamp: s.timestamp?.slice(0, 19) ?? '-',
      mapType: s.mapType ?? '-',
      duration: s.duration ?? 0,
      commit: s._commit,
      finalKills: s.summary?.totalKills ?? 0,
      finalDeaths: s.summary?.totalDeaths ?? 0,
      finalPowerLevel: s.summary?.finalPlayerPowerLevel ?? 0,
      finalScore: s.summary?.finalScore ?? 0,
      kdr: s.summary?.totalDeaths > 0
        ? Math.round((s.summary.totalKills / s.summary.totalDeaths) * 100) / 100
        : s.summary?.totalKills ?? 0,
      weaponChanges,
      killRateCurve,
      powerMilestones,
    };
  }).filter(Boolean);
}

/** Q5: Stuck detection — sessions where playerStuck was true + duration/frequency. */
function queryStuck(perfSessions) {
  const stuckSessions = [];

  for (const s of perfSessions) {
    const pts = expandPoints(s);
    const stuckPts = pts.filter(p => p.playerStuck);
    if (!stuckPts.length) continue;

    // Group consecutive stuck samples into events
    const events = [];
    let eventStart = null;
    let prevTime = -Infinity;
    for (const p of stuckPts) {
      if (p.time - prevTime > 2) {
        if (eventStart !== null) events.push({ startS: eventStart, endS: prevTime, durationS: prevTime - eventStart });
        eventStart = p.time;
      }
      prevTime = p.time;
    }
    if (eventStart !== null) events.push({ startS: eventStart, endS: prevTime, durationS: prevTime - eventStart });

    stuckSessions.push({
      timestamp: s.timestamp?.slice(0, 19) ?? '-',
      mapType: s.mapType ?? '-',
      duration: s.duration ?? 0,
      commit: s._commit,
      stuckSampleCount: stuckPts.length,
      stuckPct: Math.round((stuckPts.length / pts.length) * 100),
      totalStuckSecs: Math.round(stuckPts.length * 0.5),
      stuckEvents: events,
      // Position where stuck happened
      stuckPositions: events.map(ev => {
        const pt = pts.find(p => p.playerStuck && Math.abs(p.time - ev.startS) < 1);
        return pt ? { u: pt.playerSurfaceU, v: pt.playerSurfaceV, face: pt.playerFaceIndex,
                      world: { x: pt.playerWorldX, y: pt.playerWorldY, z: pt.playerWorldZ } } : null;
      }).filter(Boolean),
    });
  }

  return stuckSessions;
}

// ─── Report Generation ───────────────────────────────────────────────────────

function colorFps(fps) {
  if (fps < 25) return '#f44336';
  if (fps < 40) return '#ff9800';
  if (fps < 55) return '#ffeb3b';
  return '#4caf50';
}

function colorCorr(r) {
  if (r < -0.5) return '#f44336';
  if (r < -0.2) return '#ff9800';
  if (r > 0.2) return '#4caf50';
  return '#888';
}

function buildReport({ ddaResults, fpsResults, corrResults, progResults, stuckResults, perfSessions, ddaSessions }) {
  const now = new Date().toISOString();

  // ─ Summary cards ─
  const totalSessions = perfSessions.length;
  const overallAvgFps = Math.round(avg(fpsResults.map(r => r.avgFps)) * 10) / 10;
  const totalStuckEvents = stuckResults.reduce((a, r) => a + r.stuckEvents.length, 0);
  const avgKDR = Math.round(avg(progResults.map(r => r.kdr)) * 100) / 100;
  const maxDiffTier = Math.max(0, ...ddaResults.map(r => r.peakDiff));

  // ─ Chart data ─
  // DDA curve (avg across sessions, 30s buckets)
  const allBuckets = {};
  for (const r of ddaResults) {
    for (const pt of r.curve) {
      if (!allBuckets[pt.timeS]) allBuckets[pt.timeS] = { dda: [], diff: [] };
      allBuckets[pt.timeS].dda.push(pt.avgDDA);
      allBuckets[pt.timeS].diff.push(pt.avgDiff);
    }
  }
  const ddaCurveData = {
    labels: Object.keys(allBuckets).map(Number).sort((a, b) => a - b).map(t => `${t}s`),
    dda:  Object.keys(allBuckets).sort((a, b) => +a - +b).map(t => Math.round(avg(allBuckets[t].dda) * 100) / 100),
    diff: Object.keys(allBuckets).sort((a, b) => +a - +b).map(t => Math.round(avg(allBuckets[t].diff) * 100) / 100),
  };

  // FPS per session
  const sessionFpsData = {
    labels: fpsResults.map((r, i) => `S${i+1}\n${r.mapType}`),
    avg: fpsResults.map(r => r.avgFps),
    p5:  fpsResults.map(r => r.p5Fps),
    min: fpsResults.map(r => r.minFps),
  };

  // ─ DDA table ─
  const ddaTableRows = ddaResults.map((r, i) => `
    <tr>
      <td>S${i+1}</td>
      <td>${r.timestamp}</td>
      <td>${r.mapType}</td>
      <td>${r.duration.toFixed(0)}s</td>
      <td>${r.startDDA.toFixed(2)}</td>
      <td>${r.endDDA.toFixed(2)}</td>
      <td style="color:${r.ddaTrend > 0.3 ? '#ff9800' : r.ddaTrend < -0.3 ? '#4caf50' : '#888'}">${r.ddaTrend > 0 ? '+' : ''}${r.ddaTrend.toFixed(2)}</td>
      <td>${r.peakDiff.toFixed(2)}</td>
      <td><code>${r.commit}</code></td>
    </tr>
  `).join('');

  // ─ FPS table ─
  const fpsTableRows = fpsResults.map((r, i) => `
    <tr>
      <td>S${i+1}</td>
      <td>${r.timestamp}</td>
      <td>${r.mapType}</td>
      <td style="color:${colorFps(r.avgFps)}">${r.avgFps}</td>
      <td style="color:${colorFps(r.medianFps)}">${r.medianFps}</td>
      <td style="color:${colorFps(r.p5Fps)}">${r.p5Fps}</td>
      <td style="color:${colorFps(r.p1Fps)}">${r.p1Fps}</td>
      <td style="color:${r.spikeCount > 20 ? '#f44336' : r.spikeCount > 5 ? '#ff9800' : '#888'}">${r.spikeCount}</td>
      <td>${r.lowFpsPct}%</td>
      <td>${r.peakEnemies}</td>
      <td><code>${r.commit}</code></td>
    </tr>
  `).join('');

  // ─ Correlation table ─
  const corrTableRows = corrResults.map((r, i) => `
    <tr>
      <td>S${i+1}</td>
      <td>${r.timestamp}</td>
      <td>${r.mapType}</td>
      <td style="color:${colorCorr(r.fpsDiffCorr)}">${r.fpsDiffCorr.toFixed(3)}</td>
      <td style="color:${colorCorr(r.fpsEnemyCorr)}">${r.fpsEnemyCorr.toFixed(3)}</td>
      <td>${r.interpretation}</td>
    </tr>
  `).join('');

  // ─ Progression table ─
  const progTableRows = progResults.map((r, i) => `
    <tr>
      <td>S${i+1}</td>
      <td>${r.timestamp}</td>
      <td>${r.mapType}</td>
      <td>${r.finalKills}</td>
      <td>${r.finalDeaths}</td>
      <td style="color:${r.kdr >= 5 ? '#4caf50' : r.kdr >= 2 ? '#ffeb3b' : '#f44336'}">${r.kdr}</td>
      <td>${r.finalPowerLevel}</td>
      <td>${r.finalScore.toLocaleString()}</td>
      <td>${r.weaponChanges.map(w => `${w.weapon}@${w.timeS.toFixed(0)}s`).join(' → ')}</td>
    </tr>
  `).join('');

  // ─ Stuck table ─
  const stuckTableRows = stuckResults.length > 0
    ? stuckResults.map(r => `
      <tr>
        <td>${r.timestamp}</td>
        <td>${r.mapType}</td>
        <td style="color:#f44336">${r.stuckEvents.length}</td>
        <td>${r.totalStuckSecs}s (${r.stuckPct}% of session)</td>
        <td>${r.stuckEvents.map(e => `${e.startS.toFixed(0)}s–${e.endS.toFixed(0)}s`).join(', ')}</td>
        <td>${r.stuckPositions.map(p => `U=${p.u.toFixed(3)},V=${p.v.toFixed(3)} face#${p.face}`).join(' | ')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="6" class="no-data">No stuck events detected — good!</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GW3D — DDA + Performance Analysis</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #09090f; color: #e0e0f0; padding: 24px; line-height: 1.5; }
    h1 { color: #00e5ff; margin-bottom: 4px; font-size: 1.6em; }
    h2 { color: #7c4dff; margin: 24px 0 10px; border-bottom: 1px solid #1e1e30; padding-bottom: 6px; font-size: 1.1em; }
    .meta { color: #555; font-size: 0.82em; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #12121e; border: 1px solid #2a2a40; border-radius: 8px; padding: 14px; text-align: center; }
    .card .val { font-size: 2em; font-weight: 700; color: #00e5ff; line-height: 1.1; }
    .card .lbl { font-size: 0.75em; color: #666; margin-top: 4px; text-transform: uppercase; letter-spacing: .05em; }
    .chart-wrap { background: #12121e; border: 1px solid #2a2a40; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    canvas { max-height: 260px; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82em; }
    th { background: #16162a; color: #9c88ff; padding: 8px 10px; text-align: left; font-weight: 600; }
    td { padding: 6px 10px; border-bottom: 1px solid #191928; vertical-align: top; }
    tr:hover td { background: #141425; }
    code { color: #64ffda; font-size: 0.9em; }
    .no-data { color: #444; font-style: italic; padding: 16px 10px; }
    .section { background: #0d0d18; border: 1px solid #1a1a2e; border-radius: 8px; padding: 16px; margin-bottom: 20px; overflow-x: auto; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 0.75em; font-weight: 600; margin-right: 4px; }
    .badge-green { background: rgba(76,175,80,.2); color: #4caf50; }
    .badge-yellow { background: rgba(255,193,7,.2); color: #ffc107; }
    .badge-red { background: rgba(244,67,54,.2); color: #f44336; }
    .query-note { color: #666; font-size: 0.82em; margin-top: -6px; margin-bottom: 12px; font-style: italic; }
  </style>
</head>
<body>
  <h1>GW3D — DDA + Performance Analysis</h1>
  <p class="meta">Generated: ${now} | ${totalSessions} sessions | Commit: ${perfSessions[0]?._commit ?? '?'}</p>

  <div class="grid">
    <div class="card"><div class="val">${totalSessions}</div><div class="lbl">Sessions</div></div>
    <div class="card"><div class="val" style="color:${colorFps(overallAvgFps)}">${overallAvgFps}</div><div class="lbl">Avg FPS</div></div>
    <div class="card"><div class="val">${maxDiffTier.toFixed(1)}</div><div class="lbl">Peak Diff Tier</div></div>
    <div class="card"><div class="val">${avgKDR}</div><div class="lbl">Avg K/D Ratio</div></div>
    <div class="card"><div class="val" style="color:${totalStuckEvents > 0 ? '#f44336' : '#4caf50'}">${totalStuckEvents}</div><div class="lbl">Stuck Events</div></div>
  </div>

  <!-- ─── Q1: DDA Progression ─────────────────────────────── -->
  <h2>Query 1: DDA Difficulty Progression Over Time</h2>
  <p class="query-note">DDA level (0=hardest, 3=most assistance) and wave difficulty tier over game time. Shows how the system adjusts to player skill.</p>
  <div class="chart-wrap"><canvas id="ddaCurveChart"></canvas></div>
  <div class="section">
    <table>
      <thead><tr><th>#</th><th>Timestamp</th><th>Map</th><th>Duration</th><th>Start DDA</th><th>End DDA</th><th>DDA Trend</th><th>Peak Diff Tier</th><th>Commit</th></tr></thead>
      <tbody>${ddaTableRows}</tbody>
    </table>
  </div>

  <!-- ─── Q2: FPS / CPU Performance ──────────────────────── -->
  <h2>Query 2: FPS / CPU Performance Metrics</h2>
  <p class="query-note">FPS distribution per session. P5 = 5th percentile (only 5% of frames below this). Spikes = frames &lt; 30 FPS. Low% = fraction of session below 45 FPS.</p>
  <div class="chart-wrap"><canvas id="fpsTrendChart"></canvas></div>
  <div class="section">
    <table>
      <thead><tr><th>#</th><th>Timestamp</th><th>Map</th><th>Avg FPS</th><th>Median</th><th>P5</th><th>P1</th><th>Spikes</th><th>Low%</th><th>Peak Enemies</th><th>Commit</th></tr></thead>
      <tbody>${fpsTableRows}</tbody>
    </table>
  </div>

  <!-- ─── Q3: Correlation ─────────────────────────────────── -->
  <h2>Query 3: Difficulty ↔ FPS Correlation</h2>
  <p class="query-note">Pearson correlation between FPS and difficulty tier per session. −1 = strong negative (high difficulty → low FPS), 0 = no link, +1 = positive.</p>
  <div class="section">
    <table>
      <thead><tr><th>#</th><th>Timestamp</th><th>Map</th><th>FPS/Diff Corr</th><th>FPS/Enemy Corr</th><th>Interpretation</th></tr></thead>
      <tbody>${corrTableRows}</tbody>
    </table>
  </div>

  <!-- ─── Q4: Player Progression ──────────────────────────── -->
  <h2>Query 4: Player Progression Patterns</h2>
  <p class="query-note">Kills, deaths, K/D ratio, power level, score, and weapon upgrade timeline per session.</p>
  <div class="section">
    <table>
      <thead><tr><th>#</th><th>Timestamp</th><th>Map</th><th>Kills</th><th>Deaths</th><th>K/D</th><th>Power Lvl</th><th>Score</th><th>Weapon Path</th></tr></thead>
      <tbody>${progTableRows}</tbody>
    </table>
  </div>

  <!-- ─── Q5: Stuck Detection ─────────────────────────────── -->
  <h2>Query 5: Stuck Player Anomalies</h2>
  <p class="query-note">Sessions where playerStuck=true (UV+face unchanged for &gt;2s). Shows timing, duration, and mesh UV position for debugging.</p>
  <div class="section">
    <table>
      <thead><tr><th>Timestamp</th><th>Map</th><th>Stuck Events</th><th>Total Stuck Time</th><th>Time Ranges</th><th>UV Positions</th></tr></thead>
      <tbody>${stuckTableRows}</tbody>
    </table>
  </div>

  <script>
    const ddaCurve   = ${JSON.stringify(ddaCurveData)};
    const sessionFps = ${JSON.stringify(sessionFpsData)};

    const baseOpts = {
      plugins: { legend: { labels: { color: '#aaa', boxWidth: 14 } } },
      scales: {
        x: { ticks: { color: '#666', font: { size: 11 } }, grid: { color: '#1a1a2e' } },
        y: { ticks: { color: '#666', font: { size: 11 } }, grid: { color: '#1a1a2e' } }
      }
    };

    if (ddaCurve.labels.length) {
      new Chart('ddaCurveChart', {
        type: 'line',
        data: {
          labels: ddaCurve.labels,
          datasets: [
            { label: 'Avg DDA Level', data: ddaCurve.dda, borderColor: '#7c4dff', backgroundColor: 'rgba(124,77,255,.1)', fill: true, tension: .3, yAxisID: 'yDDA' },
            { label: 'Avg Difficulty Tier', data: ddaCurve.diff, borderColor: '#00e5ff', backgroundColor: 'rgba(0,229,255,.05)', fill: false, tension: .3, yAxisID: 'yDiff' },
          ]
        },
        options: { ...baseOpts, scales: {
          ...baseOpts.scales,
          yDDA:  { position: 'left',  min: 0, max: 3,   ticks: { color: '#9c88ff' }, grid: { color: '#1a1a2e' }, title: { display: true, text: 'DDA Level (0-3)', color: '#9c88ff' } },
          yDiff: { position: 'right', min: 0, max: 5,   ticks: { color: '#00e5ff' }, grid: { display: false }, title: { display: true, text: 'Diff Tier', color: '#00e5ff' } },
        } }
      });
    }

    if (sessionFps.labels.length) {
      new Chart('fpsTrendChart', {
        type: 'bar',
        data: {
          labels: sessionFps.labels,
          datasets: [
            { label: 'Avg FPS', data: sessionFps.avg, backgroundColor: 'rgba(0,229,255,.5)', borderColor: '#00e5ff', borderWidth: 1 },
            { label: 'P5 FPS', data: sessionFps.p5,  backgroundColor: 'rgba(255,152,0,.4)',  borderColor: '#ff9800', borderWidth: 1 },
            { label: 'Min FPS', data: sessionFps.min, backgroundColor: 'rgba(244,67,54,.3)',  borderColor: '#f44336', borderWidth: 1 },
          ]
        },
        options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, suggestedMin: 0, suggestedMax: 70 } } }
      });
    }
  </script>
</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let perfSessions = loadDir(LOGS_PERF_DIR);
  const ddaSessions = loadDir(LOGS_DDA_DIR);

  if (perfSessions.length === 0) {
    console.warn('[analyze-dda-performance] No performance sessions found in logs/performance/');
    console.warn('  → Export data from the browser: press F3 → EXPORT in-game');
    console.warn('  → Or run: node scripts/generate-sample-data.mjs');
    process.exit(0);
  }

  // Filter stubs (no data points)
  perfSessions = perfSessions.filter(s => (s.dataPoints?.length ?? 0) > 2);

  if (lastN) {
    perfSessions = perfSessions.slice(-lastN);
    console.log(`[analyze-dda-performance] Using last ${lastN} sessions`);
  }

  console.log(`[analyze-dda-performance] Analyzing ${perfSessions.length} perf sessions, ${ddaSessions.length} DDA sessions`);

  const ddaResults    = queryDDA(perfSessions, ddaSessions);
  const fpsResults    = queryFPS(perfSessions);
  const corrResults   = queryCorrelation(perfSessions);
  const progResults   = queryProgression(perfSessions);
  const stuckResults  = queryStuck(perfSessions);

  // Console summary
  console.log('\n── DDA Progression ────────────────────────────────────');
  for (const r of ddaResults) {
    const trend = r.ddaTrend > 0.3 ? '↑ (player struggling)' : r.ddaTrend < -0.3 ? '↓ (player improving)' : '→ stable';
    console.log(`  ${r.timestamp} ${r.mapType.padEnd(8)} DDA ${r.startDDA.toFixed(2)} → ${r.endDDA.toFixed(2)} ${trend} | PeakDiff=${r.peakDiff.toFixed(2)}`);
  }

  console.log('\n── FPS Performance ────────────────────────────────────');
  for (const r of fpsResults) {
    const health = r.avgFps >= 55 ? '✓ GOOD' : r.avgFps >= 40 ? '⚠ WARN' : '✗ BAD ';
    console.log(`  ${r.timestamp} ${r.mapType.padEnd(8)} ${health} avg=${r.avgFps} p5=${r.p5Fps} min=${r.minFps} spikes=${r.spikeCount}`);
  }

  console.log('\n── FPS/Difficulty Correlation ─────────────────────────');
  for (const r of corrResults) {
    console.log(`  ${r.timestamp} ${r.mapType.padEnd(8)} corr(fps,diff)=${r.fpsDiffCorr.toFixed(3)} — ${r.interpretation}`);
  }

  console.log('\n── Player Progression ─────────────────────────────────');
  for (const r of progResults) {
    console.log(`  ${r.timestamp} ${r.mapType.padEnd(8)} kills=${r.finalKills} kdr=${r.kdr} level=${r.finalPowerLevel} score=${r.finalScore.toLocaleString()}`);
  }

  console.log('\n── Stuck Detection ────────────────────────────────────');
  if (stuckResults.length === 0) {
    console.log('  No stuck events detected across all sessions');
  } else {
    for (const r of stuckResults) {
      console.log(`  ⚠ ${r.timestamp} ${r.mapType.padEnd(8)} ${r.stuckEvents.length} events, ${r.totalStuckSecs}s total stuck`);
      for (const pos of r.stuckPositions) {
        console.log(`    at UV (${pos.u.toFixed(3)}, ${pos.v.toFixed(3)}) face#${pos.face}`);
      }
    }
  }

  // Write HTML report
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const html = buildReport({ ddaResults, fpsResults, corrResults, progResults, stuckResults, perfSessions, ddaSessions });
  fs.writeFileSync(outputPath, html);
  console.log(`\n[analyze-dda-performance] Report → ${outputPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
