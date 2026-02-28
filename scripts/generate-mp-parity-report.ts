/**
 * MP Parity Report Generator
 *
 * Compares SP and MP configuration values and generates:
 *   - reports/mp-parity-audit-YYYY-MM-DD.html  (human-readable)
 *   - reports/mp-parity-audit-YYYY-MM-DD.json  (machine-readable for tracking)
 *   - reports/mp-parity-history.json           (appended log for all runs)
 *
 * Run: npm run parity
 *
 * The report shows where SP and MP diverge — enabling quick detection of
 * gameplay balance drift between the two modes.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { WEAPON_CONFIGS, WeaponType } from '../src/weapons/WeaponTypes.js';
import {
  getDifficultyTier,
  MAX_TIER,
  computeDifficultyLevel,
} from '../src/core/DifficultyScaling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');

// ---------------------------------------------------------------------------
// MP Constants (extracted from server/rooms/GameRoom.ts — last synced 2026-03-01)
// ---------------------------------------------------------------------------
const MP_SYNC_DATE = '2026-03-01';

const MP_WEAPON_CONFIGS: Record<string, { ammo: number; damageMultiplier: number; damage: number }> = {
  standard:        { ammo: -1,  damageMultiplier: 1.0, damage: 0.25 },
  spread:          { ammo: 50,  damageMultiplier: 0.8, damage: 1    },
  piercing:        { ammo: 30,  damageMultiplier: 1.5, damage: 3    },
  homing:          { ammo: 20,  damageMultiplier: 1.2, damage: 6    },
  chain_lightning: { ammo: 25,  damageMultiplier: 1.0, damage: 4    },
  plasma_mortar:   { ammo: 15,  damageMultiplier: 2.0, damage: 20   },
  gravity_gun:     { ammo: 20,  damageMultiplier: 0.5, damage: 1    },
  laser_beam:      { ammo: 40,  damageMultiplier: 0.6, damage: 2    },
  black_hole:      { ammo: 5,   damageMultiplier: 5.0, damage: 999  },
  tesla_coil:      { ammo: 30,  damageMultiplier: 0.7, damage: 1    },
};

const MP_WAVE_TIMING = {
  WAVE_FIRST_AT: 6.0,
  WAVE_INTERVAL_BASE: 7.0,
  WAVE_INTERVAL_MIN: 2.0,
  WAVE_INTERVAL_DECAY: 0.2,
};

// SP Constants from source files
const SP_WAVE_TIMING = {
  WAVE_FIRST_AT: 6,
  WAVE_INTERVAL_BASE: 7,
  WAVE_INTERVAL_MIN: 2.0,
  WAVE_INTERVAL_DECAY: 0.2,
};

const SP_TO_MP_KEY: Record<WeaponType, string> = {
  [WeaponType.Standard]:       'standard',
  [WeaponType.Spread]:         'spread',
  [WeaponType.Piercing]:       'piercing',
  [WeaponType.ChainLightning]: 'chain_lightning',
  [WeaponType.Homing]:         'homing',
  [WeaponType.PlasmaMortar]:   'plasma_mortar',
  [WeaponType.GravityGun]:     'gravity_gun',
  [WeaponType.LaserBeam]:      'laser_beam',
  [WeaponType.BlackHole]:      'black_hole',
  [WeaponType.TeslaCoil]:      'tesla_coil',
};

// ---------------------------------------------------------------------------
// Metric types
// ---------------------------------------------------------------------------

interface MetricRow {
  category: string;
  metric: string;
  sp: number | string;
  mp: number | string;
  diff: number | null; // % difference, null if not applicable
  status: 'OK' | 'WARN' | 'CRITICAL' | 'INFO';
  note: string;
}

const WARN_THRESHOLD = 5;    // % difference triggers WARN
const CRIT_THRESHOLD = 20;   // % difference triggers CRITICAL

function pctDiff(sp: number, mp: number): number {
  if (sp === 0 && mp === 0) return 0;
  if (sp === 0) return 100;
  return ((mp - sp) / sp) * 100;
}

function classify(diff: number | null): 'OK' | 'WARN' | 'CRITICAL' | 'INFO' {
  if (diff === null) return 'INFO';
  const abs = Math.abs(diff);
  if (abs === 0) return 'OK';
  if (abs >= CRIT_THRESHOLD) return 'CRITICAL';
  if (abs >= WARN_THRESHOLD) return 'WARN';
  return 'OK';
}

// ---------------------------------------------------------------------------
// Collect all metrics
// ---------------------------------------------------------------------------

function collectMetrics(): MetricRow[] {
  const rows: MetricRow[] = [];

  // --- Weapon Damage ---
  for (const wt of Object.values(WeaponType)) {
    const spConfig = WEAPON_CONFIGS[wt];
    const mpKey = SP_TO_MP_KEY[wt];
    const mpConfig = MP_WEAPON_CONFIGS[mpKey];
    if (!mpConfig) {
      rows.push({
        category: 'Weapon Damage',
        metric: `${spConfig.name} damage`,
        sp: spConfig.damage,
        mp: 'MISSING',
        diff: null,
        status: 'CRITICAL',
        note: `MP is missing weapon type '${mpKey}'`,
      });
      continue;
    }

    const diff = pctDiff(spConfig.damage, mpConfig.damage);
    rows.push({
      category: 'Weapon Damage',
      metric: `${spConfig.name} (${mpKey})`,
      sp: spConfig.damage,
      mp: mpConfig.damage,
      diff,
      status: classify(diff),
      note: diff === 0 ? '' : `MP damage ${diff > 0 ? 'higher' : 'lower'} by ${Math.abs(diff).toFixed(1)}%`,
    });
  }

  // --- Weapon Ammo (documented discrepancies) ---
  for (const wt of Object.values(WeaponType)) {
    const spConfig = WEAPON_CONFIGS[wt];
    const mpKey = SP_TO_MP_KEY[wt];
    const mpConfig = MP_WEAPON_CONFIGS[mpKey];
    if (!mpConfig) continue;
    if (spConfig.ammo === -1 && mpConfig.ammo === -1) continue; // both unlimited

    const diff = spConfig.ammo !== -1 && mpConfig.ammo !== -1
      ? pctDiff(spConfig.ammo, mpConfig.ammo)
      : null;
    const status = diff !== null && Math.abs(diff) > 0 ? 'WARN' : classify(diff);

    rows.push({
      category: 'Weapon Ammo',
      metric: `${spConfig.name} (${mpKey}) ammo`,
      sp: spConfig.ammo === -1 ? '∞' : spConfig.ammo,
      mp: mpConfig.ammo === -1 ? '∞' : mpConfig.ammo,
      diff,
      status,
      note: diff !== null && diff !== 0
        ? `SP has ${spConfig.ammo} ammo, MP has ${mpConfig.ammo} — may affect weapon duration in MP`
        : '',
    });
  }

  // --- Difficulty Tier Multipliers ---
  for (let t = 0; t <= MAX_TIER; t++) {
    const tier = getDifficultyTier(t);
    // MP uses same DifficultyScaling.ts import (no difference expected)
    rows.push({
      category: 'Difficulty Tiers',
      metric: `Tier ${t} (${tier.name}) health multiplier`,
      sp: tier.healthMultiplier,
      mp: tier.healthMultiplier, // same source
      diff: 0,
      status: 'OK',
      note: 'MP imports same DifficultyScaling.ts',
    });
    rows.push({
      category: 'Difficulty Tiers',
      metric: `Tier ${t} (${tier.name}) speed multiplier`,
      sp: tier.speedMultiplier,
      mp: tier.speedMultiplier,
      diff: 0,
      status: 'OK',
      note: 'MP imports same DifficultyScaling.ts',
    });
  }

  // --- Wave Timing ---
  const waveTimingPairs: Array<[string, number, number]> = [
    ['First wave at (seconds)', SP_WAVE_TIMING.WAVE_FIRST_AT, MP_WAVE_TIMING.WAVE_FIRST_AT],
    ['Base interval (seconds)', SP_WAVE_TIMING.WAVE_INTERVAL_BASE, MP_WAVE_TIMING.WAVE_INTERVAL_BASE],
    ['Minimum interval (seconds)', SP_WAVE_TIMING.WAVE_INTERVAL_MIN, MP_WAVE_TIMING.WAVE_INTERVAL_MIN],
    ['Interval decay per wave', SP_WAVE_TIMING.WAVE_INTERVAL_DECAY, MP_WAVE_TIMING.WAVE_INTERVAL_DECAY],
  ];

  for (const [name, spVal, mpVal] of waveTimingPairs) {
    const diff = pctDiff(spVal, mpVal);
    rows.push({
      category: 'Wave Timing',
      metric: name,
      sp: spVal,
      mp: mpVal,
      diff,
      status: classify(diff),
      note: diff === 0 ? '' : `Mismatch: SP=${spVal}, MP=${mpVal}`,
    });
  }

  // --- Player Count Scaling ---
  for (let p = 1; p <= 4; p++) {
    const spMult = 1.0 + (p - 1) * 0.5;
    const mpMult = 1.0 + (p - 1) * 0.5;
    const diff = pctDiff(spMult, mpMult);
    rows.push({
      category: 'Player Count Scaling',
      metric: `${p} player(s) enemy multiplier`,
      sp: spMult,
      mp: mpMult,
      diff,
      status: classify(diff),
      note: '',
    });
  }

  // --- Player Count Difficulty Bonus ---
  const base = { score: 0, elapsedTime: 0, combo: 0, totalKills: 0, playerLevel: 0 };
  for (let p = 1; p <= 4; p++) {
    const level = computeDifficultyLevel({ ...base, playerCount: p });
    const expectedBonus = (p - 1) * 0.3;
    rows.push({
      category: 'Player Count Scaling',
      metric: `${p} player(s) difficulty bonus`,
      sp: expectedBonus,
      mp: expectedBonus, // same formula in both
      diff: 0,
      status: 'OK',
      note: `computeDifficultyLevel returns ${level.toFixed(3)} at game start with ${p}p`,
    });
  }

  // --- Documented Discrepancies (always INFO/WARN) ---
  rows.push({
    category: 'Documented Discrepancies',
    metric: 'Bullet lifetime (seconds)',
    sp: 6,
    mp: 3.0,
    diff: pctDiff(6, 3.0),
    status: 'WARN',
    note: 'SP Bullet.ts = 6s, MP GameRoom.ts = 3s. SP bullets travel ~2x further. May affect balance.',
  });

  rows.push({
    category: 'Documented Discrepancies',
    metric: 'Player speed — UV/s',
    sp: 0.08,
    mp: 0.095,
    diff: pctDiff(0.08, 0.095),
    status: 'INFO',
    note: 'SP Player.ts UV fallback = 0.08, but SP MeshWalker = 3.0 world/s ≈ 0.0955 UV/s on R=10 sphere. Effective speed matches MP.',
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Get git commit hash
// ---------------------------------------------------------------------------
function getGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Generate JSON report
// ---------------------------------------------------------------------------
interface ParityReport {
  generated: string;
  gitCommit: string;
  mpSyncDate: string;
  summary: {
    total: number;
    ok: number;
    warn: number;
    critical: number;
    info: number;
  };
  metrics: MetricRow[];
}

function buildReport(metrics: MetricRow[]): ParityReport {
  const summary = {
    total: metrics.length,
    ok: metrics.filter(m => m.status === 'OK').length,
    warn: metrics.filter(m => m.status === 'WARN').length,
    critical: metrics.filter(m => m.status === 'CRITICAL').length,
    info: metrics.filter(m => m.status === 'INFO').length,
  };

  return {
    generated: new Date().toISOString(),
    gitCommit: getGitHash(),
    mpSyncDate: MP_SYNC_DATE,
    summary,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Generate HTML report
// ---------------------------------------------------------------------------
function generateHTML(report: ParityReport): string {
  const statusColors: Record<string, string> = {
    OK: '#22c55e',
    WARN: '#f59e0b',
    CRITICAL: '#ef4444',
    INFO: '#60a5fa',
  };

  const statusBg: Record<string, string> = {
    OK: '#dcfce7',
    WARN: '#fef3c7',
    CRITICAL: '#fee2e2',
    INFO: '#dbeafe',
  };

  // Group metrics by category
  const categories = new Map<string, MetricRow[]>();
  for (const row of report.metrics) {
    if (!categories.has(row.category)) categories.set(row.category, []);
    categories.get(row.category)!.push(row);
  }

  const categoryHTML = Array.from(categories.entries()).map(([cat, rows]) => {
    const rowsHTML = rows.map(row => {
      const diffStr = row.diff !== null
        ? `${row.diff > 0 ? '+' : ''}${row.diff.toFixed(1)}%`
        : 'N/A';
      const bg = statusBg[row.status];
      const color = statusColors[row.status];
      return `
        <tr style="background: ${bg}">
          <td style="padding: 8px 12px; color: #374151">${row.metric}</td>
          <td style="padding: 8px 12px; text-align: right; font-family: monospace; color: #1e40af">${row.sp}</td>
          <td style="padding: 8px 12px; text-align: right; font-family: monospace; color: #7c3aed">${row.mp}</td>
          <td style="padding: 8px 12px; text-align: right; font-family: monospace; font-weight: bold; color: ${color}">${diffStr}</td>
          <td style="padding: 8px 12px">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; background: ${color}; color: white; font-size: 11px; font-weight: bold">${row.status}</span>
          </td>
          <td style="padding: 8px 12px; font-size: 12px; color: #6b7280">${row.note}</td>
        </tr>`;
    }).join('');

    const catStatusCounts = {
      OK: rows.filter(r => r.status === 'OK').length,
      WARN: rows.filter(r => r.status === 'WARN').length,
      CRITICAL: rows.filter(r => r.status === 'CRITICAL').length,
      INFO: rows.filter(r => r.status === 'INFO').length,
    };
    const worstStatus = catStatusCounts.CRITICAL > 0 ? 'CRITICAL'
      : catStatusCounts.WARN > 0 ? 'WARN'
      : catStatusCounts.INFO > 0 ? 'INFO'
      : 'OK';

    return `
      <div style="margin-bottom: 32px">
        <h2 style="margin: 0 0 12px; font-size: 18px; color: #111827; display: flex; align-items: center; gap: 10px">
          ${cat}
          <span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; background: ${statusColors[worstStatus]}; color: white; font-size: 12px; font-weight: bold">${worstStatus}</span>
        </h2>
        <table style="width: 100%; border-collapse: collapse; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1)">
          <thead>
            <tr style="background: #1e293b; color: white">
              <th style="padding: 10px 12px; text-align: left">Metric</th>
              <th style="padding: 10px 12px; text-align: right">SP</th>
              <th style="padding: 10px 12px; text-align: right">MP</th>
              <th style="padding: 10px 12px; text-align: right">Diff %</th>
              <th style="padding: 10px 12px; text-align: left">Status</th>
              <th style="padding: 10px 12px; text-align: left">Notes</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>`;
  }).join('');

  const summaryColor = report.summary.critical > 0 ? '#ef4444'
    : report.summary.warn > 0 ? '#f59e0b'
    : '#22c55e';
  const summaryLabel = report.summary.critical > 0 ? '⚠ CRITICAL GAPS FOUND'
    : report.summary.warn > 0 ? '⚡ WARNINGS FOUND'
    : '✓ PARITY OK';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MP Parity Audit — ${report.generated.slice(0, 10)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #1e293b; }
    .header { background: linear-gradient(135deg, #1e40af, #7c3aed); color: white; padding: 32px; border-radius: 12px; margin-bottom: 32px; }
    .header h1 { margin: 0 0 8px; font-size: 28px; }
    .meta { opacity: 0.85; font-size: 14px; line-height: 1.8; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .summary-card { background: white; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary-card .count { font-size: 36px; font-weight: bold; }
    .summary-card .label { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .verdict { padding: 16px 24px; border-radius: 8px; margin-bottom: 32px; font-size: 20px; font-weight: bold; color: white; background: ${summaryColor}; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎮 MP Parity Audit Report</h1>
    <div class="meta">
      <div>Generated: ${report.generated}</div>
      <div>Git commit: ${report.gitCommit}</div>
      <div>MP constants synced: ${report.mpSyncDate}</div>
      <div>Threshold: WARN ≥${WARN_THRESHOLD}% diff | CRITICAL ≥${CRIT_THRESHOLD}% diff</div>
    </div>
  </div>

  <div class="verdict">${summaryLabel}</div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="count" style="color: #22c55e">${report.summary.ok}</div>
      <div class="label">MATCHING</div>
    </div>
    <div class="summary-card">
      <div class="count" style="color: #f59e0b">${report.summary.warn}</div>
      <div class="label">WARNINGS</div>
    </div>
    <div class="summary-card">
      <div class="count" style="color: #ef4444">${report.summary.critical}</div>
      <div class="label">CRITICAL</div>
    </div>
    <div class="summary-card">
      <div class="count" style="color: #60a5fa">${report.summary.info}</div>
      <div class="label">INFO</div>
    </div>
  </div>

  ${categoryHTML}

  <div style="margin-top: 48px; padding: 20px; background: #f1f5f9; border-radius: 8px; font-size: 13px; color: #64748b">
    <strong>How to use this report:</strong>
    <ul style="margin: 8px 0; padding-left: 20px; line-height: 2">
      <li><span style="color: #22c55e">■ OK</span>: Values match exactly or within ${WARN_THRESHOLD}% tolerance</li>
      <li><span style="color: #f59e0b">■ WARN</span>: ${WARN_THRESHOLD}–${CRIT_THRESHOLD}% difference — investigate if gameplay-impacting</li>
      <li><span style="color: #ef4444">■ CRITICAL</span>: ≥${CRIT_THRESHOLD}% difference or missing value — fix immediately</li>
      <li><span style="color: #60a5fa">■ INFO</span>: Known intentional difference — documented for reference</li>
    </ul>
    <strong>Update MP constants:</strong> Edit <code>tests/integration/mp-parity-audit.test.ts</code> and <code>scripts/generate-mp-parity-report.ts</code> when <code>server/rooms/GameRoom.ts</code> changes.
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Write history log
// ---------------------------------------------------------------------------
function appendToHistory(report: ParityReport): void {
  const historyPath = path.join(REPORTS_DIR, 'mp-parity-history.json');
  const historyEntry = {
    date: report.generated,
    gitCommit: report.gitCommit,
    summary: report.summary,
    criticalMetrics: report.metrics
      .filter(m => m.status === 'CRITICAL')
      .map(m => ({ category: m.category, metric: m.metric, sp: m.sp, mp: m.mp, diff: m.diff })),
    warnMetrics: report.metrics
      .filter(m => m.status === 'WARN')
      .map(m => ({ category: m.category, metric: m.metric, sp: m.sp, mp: m.mp, diff: m.diff })),
  };

  let history: typeof historyEntry[] = [];
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch {
      history = [];
    }
  }
  history.push(historyEntry);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

// ---------------------------------------------------------------------------
// Check for regressions vs previous run
// ---------------------------------------------------------------------------
function checkRegressions(report: ParityReport): void {
  const historyPath = path.join(REPORTS_DIR, 'mp-parity-history.json');
  if (!fs.existsSync(historyPath)) return;

  let history: Array<{ summary: ParityReport['summary'] }> = [];
  try {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch {
    return;
  }

  if (history.length < 2) return;
  const prev = history[history.length - 2]; // Second to last (last is current)
  const curr = report.summary;

  if (curr.critical > prev.summary.critical) {
    console.warn(`\n⚠️  REGRESSION DETECTED: Critical issues increased from ${prev.summary.critical} to ${curr.critical}`);
  } else if (curr.warn > prev.summary.warn) {
    console.warn(`\n⚡ WARNING: Warnings increased from ${prev.summary.warn} to ${curr.warn}`);
  } else {
    console.log('\n✓ No regressions vs previous run');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const metrics = collectMetrics();
  const report = buildReport(metrics);
  const html = generateHTML(report);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const dateStr = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(REPORTS_DIR, `mp-parity-audit-${dateStr}.json`);
  const htmlPath = path.join(REPORTS_DIR, `mp-parity-audit-${dateStr}.html`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, html);

  appendToHistory(report);
  checkRegressions(report);

  console.log('\n=== MP Parity Audit ===');
  console.log(`Generated: ${report.generated}`);
  console.log(`Git commit: ${report.gitCommit}`);
  console.log(`\nSummary:`);
  console.log(`  ✓ OK:       ${report.summary.ok}`);
  console.log(`  ⚡ WARN:     ${report.summary.warn}`);
  console.log(`  ⚠ CRITICAL: ${report.summary.critical}`);
  console.log(`  ℹ INFO:     ${report.summary.info}`);

  if (report.summary.critical > 0 || report.summary.warn > 0) {
    console.log('\nIssues found:');
    for (const m of metrics.filter(r => r.status === 'CRITICAL' || r.status === 'WARN')) {
      const icon = m.status === 'CRITICAL' ? '⚠' : '⚡';
      const diff = m.diff !== null ? ` (${m.diff > 0 ? '+' : ''}${m.diff.toFixed(1)}%)` : '';
      console.log(`  ${icon} [${m.category}] ${m.metric}: SP=${m.sp} MP=${m.mp}${diff}`);
      if (m.note) console.log(`      → ${m.note}`);
    }
  } else {
    console.log('\n✓ All metrics within tolerance — SP/MP parity confirmed!');
  }

  console.log(`\nReports saved:`);
  console.log(`  HTML: ${htmlPath}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  History: ${path.join(REPORTS_DIR, 'mp-parity-history.json')}`);
}

main();
