#!/usr/bin/env node
/**
 * Profiling trends analyzer.
 *
 * Analyzes profiling snapshots from logs/profiling/ and shows performance trends across commits.
 *
 * Usage:
 *   node scripts/analyze-profiling-trends.mjs [--scope <name>] [--commits <n>]
 *
 * Options:
 *   --scope <name>    Filter to a specific scope label (e.g., "enemy_update")
 *   --commits <n>     Show last N commits (default: 10)
 *
 * Examples:
 *   node scripts/analyze-profiling-trends.mjs
 *   node scripts/analyze-profiling-trends.mjs --scope enemy_update
 *   node scripts/analyze-profiling-trends.mjs --commits 5
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROFILING_DIR = path.join(PROJECT_ROOT, 'logs/profiling');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    scope: null,
    commits: 10,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope' && args[i + 1]) {
      config.scope = args[i + 1];
      i++;
    } else if (args[i] === '--commits' && args[i + 1]) {
      config.commits = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Load all profiling snapshot files, sorted by timestamp descending (newest first).
 */
function loadSnapshots() {
  if (!fs.existsSync(PROFILING_DIR)) {
    console.error(`Error: Profiling directory not found: ${PROFILING_DIR}`);
    console.error('No profiling snapshots have been recorded yet.');
    process.exit(1);
  }

  const files = fs.readdirSync(PROFILING_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse(); // Newest first

  if (files.length === 0) {
    console.error('No profiling snapshots found.');
    process.exit(1);
  }

  const snapshots = [];
  for (const file of files) {
    try {
      const filepath = path.join(PROFILING_DIR, file);
      const raw = fs.readFileSync(filepath, 'utf8');
      const session = JSON.parse(raw);
      snapshots.push({ file, session });
    } catch (err) {
      console.warn(`Warning: Failed to parse ${file}:`, err.message);
    }
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// Analysis functions
// ---------------------------------------------------------------------------

/**
 * Aggregate scope data across all samples in a session.
 * Returns a map of scope label -> { totalMs, callCount, avgMs, sampleCount }
 */
function aggregateSession(session) {
  const aggregated = new Map();

  for (const sample of session.samples) {
    for (const scope of sample.scopes) {
      if (!aggregated.has(scope.label)) {
        aggregated.set(scope.label, {
          totalMs: 0,
          callCount: 0,
          sampleCount: 0,
        });
      }

      const agg = aggregated.get(scope.label);
      agg.totalMs += scope.totalMs;
      agg.callCount += scope.callCount;
      agg.sampleCount += 1;
    }
  }

  // Calculate averages
  for (const [label, agg] of aggregated.entries()) {
    agg.avgMs = agg.totalMs / agg.sampleCount;
    agg.avgCallCount = agg.callCount / agg.sampleCount;
  }

  return aggregated;
}

/**
 * Get top N scopes by average time.
 */
function getTopScopes(aggregated, n = 10) {
  return Array.from(aggregated.entries())
    .map(([label, data]) => ({ label, ...data }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, n);
}

/**
 * Format a duration in milliseconds.
 */
function formatDuration(ms) {
  return ms.toFixed(2) + 'ms';
}

/**
 * Format a percentage change.
 */
function formatChange(change) {
  const sign = change >= 0 ? '+' : '';
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
  return `${sign}${change.toFixed(1)}% ${arrow}`;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Show trend for a specific scope across commits.
 */
function showScopeTrend(scopeLabel, snapshots, maxCommits) {
  console.log(`\nTrend for scope: ${scopeLabel}`);
  console.log('='.repeat(80));

  const data = [];

  for (const { session } of snapshots.slice(0, maxCommits)) {
    const aggregated = aggregateSession(session);
    const scopeData = aggregated.get(scopeLabel);

    if (scopeData) {
      data.push({
        commit: session.metadata.gitCommitShort,
        branch: session.metadata.gitBranch,
        timestamp: session.metadata.timestamp,
        avgMs: scopeData.avgMs,
        avgCallCount: scopeData.avgCallCount,
        sampleCount: scopeData.sampleCount,
      });
    }
  }

  if (data.length === 0) {
    console.log(`No data found for scope: ${scopeLabel}`);
    return;
  }

  console.log(`\nCommit       Branch         Date                 Avg Time   Change     Calls  Samples`);
  console.log('-'.repeat(90));

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const prevD = data[i + 1];
    const change = prevD ? ((d.avgMs - prevD.avgMs) / prevD.avgMs) * 100 : 0;
    const changeStr = prevD ? formatChange(change) : '---';

    const date = new Date(d.timestamp).toISOString().slice(0, 16).replace('T', ' ');
    const commitStr = d.commit.padEnd(12);
    const branchStr = d.branch.padEnd(14);
    const timeStr = formatDuration(d.avgMs).padEnd(10);
    const callsStr = d.avgCallCount.toFixed(1).padEnd(6);
    const samplesStr = String(d.sampleCount).padEnd(7);

    console.log(`${commitStr} ${branchStr} ${date}  ${timeStr} ${changeStr.padEnd(10)} ${callsStr} ${samplesStr}`);
  }

  // Summary
  if (data.length > 1) {
    const first = data[data.length - 1];
    const last = data[0];
    const totalChange = ((last.avgMs - first.avgMs) / first.avgMs) * 100;
    console.log('\n' + '-'.repeat(90));
    console.log(`Overall change: ${formatDuration(first.avgMs)} → ${formatDuration(last.avgMs)} (${formatChange(totalChange)})`);
  }
}

/**
 * Show overview of all sessions.
 */
function showOverview(snapshots, maxCommits) {
  console.log('\nProfiling Snapshots Overview');
  console.log('='.repeat(80));
  console.log(`\nShowing last ${Math.min(maxCommits, snapshots.length)} of ${snapshots.length} total sessions\n`);
  console.log(`Commit       Branch         Date                 Samples  Duration  Top Scope`);
  console.log('-'.repeat(90));

  for (const { session } of snapshots.slice(0, maxCommits)) {
    const aggregated = aggregateSession(session);
    const topScope = getTopScopes(aggregated, 1)[0];

    const commit = session.metadata.gitCommitShort.padEnd(12);
    const branch = session.metadata.gitBranch.padEnd(14);
    const date = new Date(session.metadata.timestamp).toISOString().slice(0, 16).replace('T', ' ');
    const samples = String(session.samples.length).padEnd(8);
    const duration = (session.metadata.sessionDuration || 0).toFixed(0) + 's';
    const topScopeStr = topScope ? `${topScope.label} (${formatDuration(topScope.avgMs)})` : 'N/A';

    console.log(`${commit} ${branch} ${date}  ${samples} ${duration.padEnd(9)} ${topScopeStr}`);
  }

  console.log('\nRun with --scope <name> to see trends for a specific scope.');
  console.log('Example: node scripts/analyze-profiling-trends.mjs --scope enemy_update\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const config = parseArgs();
  const snapshots = loadSnapshots();

  if (config.scope) {
    showScopeTrend(config.scope, snapshots, config.commits);
  } else {
    showOverview(snapshots, config.commits);
  }
}

main();
