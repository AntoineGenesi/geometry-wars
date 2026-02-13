#!/usr/bin/env node
/**
 * Performance log export utility.
 *
 * Writes performance and game-state data to disk with git commit tagging.
 * Can be called from:
 *  - Game server endpoint (HTTP POST)
 *  - Standalone CLI (reading from stdin or file)
 *  - Puppeteer tests (programmatic API)
 *
 * Usage:
 *  node scripts/export-perf-logs.mjs --type performance --data '{"metadata": {...}, "data": [...]}'
 *  echo '{"metadata": {...}}' | node scripts/export-perf-logs.mjs --type performance
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

// ---------------------------------------------------------------------------
// Git version capture (Node.js context)
// ---------------------------------------------------------------------------

/**
 * Capture current git version info from the repository.
 * Returns null if not in a git repository.
 */
function captureGitVersion() {
  try {
    const commit = execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const commitShort = execSync('git rev-parse --short HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const dirty = status.length > 0;

    return { commit, commitShort, branch, dirty };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Log export functions
// ---------------------------------------------------------------------------

/**
 * Export performance data to logs/performance/
 *
 * @param {object} payload - { metadata, data, sessions }
 * @param {object} gitInfo - { commit, commitShort, branch, dirty }
 */
export function exportPerformanceLogs(payload, gitInfo = null) {
  const git = gitInfo || captureGitVersion() || {
    commit: 'unknown',
    commitShort: 'unknown',
    branch: 'unknown',
    dirty: false,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dirtyFlag = git.dirty ? '-dirty' : '';
  const filename = `${timestamp}-${git.commitShort}${dirtyFlag}.json`;
  const dir = path.join(LOGS_DIR, 'performance');

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Prepare output
  const output = {
    metadata: {
      timestamp: new Date().toISOString(),
      gitCommit: git.commit,
      gitCommitShort: git.commitShort,
      gitBranch: git.branch,
      dirty: git.dirty,
      ...(payload.metadata || {}),
    },
    sessions: payload.sessions || payload.data || [],
  };

  // Write to disk
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));

  return { filepath, filename };
}

/**
 * Export game state / DDA data to logs/game-state/
 *
 * @param {object} payload - { metadata, data, sessions }
 * @param {object} gitInfo - { commit, commitShort, branch, dirty }
 */
export function exportGameStateLogs(payload, gitInfo = null) {
  const git = gitInfo || captureGitVersion() || {
    commit: 'unknown',
    commitShort: 'unknown',
    branch: 'unknown',
    dirty: false,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dirtyFlag = git.dirty ? '-dirty' : '';
  const filename = `${timestamp}-${git.commitShort}${dirtyFlag}.json`;
  const dir = path.join(LOGS_DIR, 'game-state');

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Prepare output
  const output = {
    metadata: {
      timestamp: new Date().toISOString(),
      gitCommit: git.commit,
      gitCommitShort: git.commitShort,
      gitBranch: git.branch,
      dirty: git.dirty,
      ...(payload.metadata || {}),
    },
    sessions: payload.sessions || payload.data || [],
  };

  // Write to disk
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));

  return { filepath, filename };
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const typeIndex = args.indexOf('--type');
  const dataIndex = args.indexOf('--data');
  const fileIndex = args.indexOf('--file');

  if (typeIndex === -1) {
    console.error('Usage: export-perf-logs.mjs --type <performance|game-state> [--data <json>] [--file <path>]');
    process.exit(1);
  }

  const type = args[typeIndex + 1];

  let payload = {};

  // Read from --data flag
  if (dataIndex !== -1) {
    try {
      payload = JSON.parse(args[dataIndex + 1]);
    } catch (err) {
      console.error('Invalid JSON in --data:', err.message);
      process.exit(1);
    }
  }
  // Read from --file flag
  else if (fileIndex !== -1) {
    try {
      const filepath = args[fileIndex + 1];
      const raw = fs.readFileSync(filepath, 'utf8');
      payload = JSON.parse(raw);
    } catch (err) {
      console.error('Failed to read file:', err.message);
      process.exit(1);
    }
  }
  // Read from stdin
  else if (!process.stdin.isTTY) {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        processExport(type, payload);
      } catch (err) {
        console.error('Invalid JSON from stdin:', err.message);
        process.exit(1);
      }
    });
    // Don't proceed yet - wait for stdin
    process.exit = () => {}; // Prevent early exit
  } else {
    console.error('No data provided. Use --data, --file, or pipe JSON to stdin.');
    process.exit(1);
  }

  if (process.stdin.isTTY) {
    processExport(type, payload);
  }

  function processExport(type, payload) {
    const exportFn = type === 'performance' ? exportPerformanceLogs : exportGameStateLogs;
    const result = exportFn(payload);
    console.log(`Exported to: ${result.filepath}`);
  }
}
