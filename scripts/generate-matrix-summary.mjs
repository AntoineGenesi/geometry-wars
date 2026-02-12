#!/usr/bin/env node
/**
 * LAN Test Matrix Summary Generator
 *
 * Analyzes test results from run-lan-test-matrix.sh and generates:
 * 1. Aggregated summary JSON (matrix-summary.json)
 * 2. Pattern analysis (which network conditions work/fail)
 * 3. Per-test failure tracking (which tests fail under which conditions)
 *
 * Usage:
 *   node scripts/generate-matrix-summary.mjs
 *   node scripts/generate-matrix-summary.mjs --verbose
 *
 * Outputs:
 *   - test-results/lan/matrix-summary.json
 *   - Console summary table
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const MATRIX_DIR = resolve(PROJECT_ROOT, 'test-results/lan/matrix');
const OUTPUT_FILE = resolve(PROJECT_ROOT, 'test-results/lan/matrix-summary.json');

// CLI arguments
const VERBOSE = process.argv.includes('--verbose');

// Colors for console output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function log(msg) {
  console.log(msg);
}

function info(msg) {
  console.log(`${BLUE}${msg}${RESET}`);
}

function success(msg) {
  console.log(`${GREEN}${msg}${RESET}`);
}

function warning(msg) {
  console.log(`${YELLOW}${msg}${RESET}`);
}

function error(msg) {
  console.error(`${RED}ERROR: ${msg}${RESET}`);
  process.exit(1);
}

// Parse combination filename to extract network conditions
function parseComboName(filename) {
  // Expected format: lan-test-100ms-5loss-10jitter.json
  const match = filename.match(/lan-test-(\d+)ms-(\d+)loss-(\d+)jitter\.json/);
  if (!match) {
    return null;
  }

  return {
    latency: parseInt(match[1], 10),
    packetLoss: parseInt(match[2], 10),
    jitter: parseInt(match[3], 10),
    filename,
  };
}

// Read and parse a result file
function readResultFile(filepath) {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);
    return data;
  } catch (err) {
    warning(`Failed to parse ${filepath}: ${err.message}`);
    return null;
  }
}

// Analyze test results
function analyzeMatrix() {
  info('Analyzing LAN test matrix results...');
  info(`Matrix directory: ${MATRIX_DIR}`);
  console.log('');

  // Check if directory exists
  if (!existsSync(MATRIX_DIR)) {
    error(`Matrix directory not found: ${MATRIX_DIR}`);
  }

  // Read all result files
  const files = readdirSync(MATRIX_DIR).filter(f => f.startsWith('lan-test-') && f.endsWith('.json'));

  if (files.length === 0) {
    error(`No test result files found in ${MATRIX_DIR}`);
  }

  info(`Found ${files.length} test result files`);

  // Parse and aggregate results
  const combinations = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  const failuresByTest = {}; // Track which tests fail under which conditions
  const failuresByCondition = {}; // Track failure patterns by network condition

  for (const filename of files) {
    const combo = parseComboName(filename);
    if (!combo) {
      warning(`Skipping file with unexpected name: ${filename}`);
      continue;
    }

    const filepath = resolve(MATRIX_DIR, filename);
    const data = readResultFile(filepath);

    if (!data) {
      continue;
    }

    // Extract test results
    const passed = data.passed || 0;
    const failed = data.failed || 0;
    const duration = data.duration || 0;
    const tests = data.tests || [];

    // Identify failed tests
    const failedTests = tests
      .filter(t => t.status === 'failed')
      .map(t => t.name);

    // Update aggregates
    totalPassed += passed;
    totalFailed += failed;
    totalTests += tests.length;

    // Track failures by test name
    for (const testName of failedTests) {
      if (!failuresByTest[testName]) {
        failuresByTest[testName] = [];
      }
      failuresByTest[testName].push({
        latency: combo.latency,
        packetLoss: combo.packetLoss,
        jitter: combo.jitter,
      });
    }

    // Track failures by condition
    const conditionKey = `${combo.latency}ms-${combo.packetLoss}loss-${combo.jitter}jitter`;
    if (failed > 0) {
      failuresByCondition[conditionKey] = failedTests;
    }

    // Add to combinations list
    combinations.push({
      latency: combo.latency,
      packetLoss: combo.packetLoss,
      jitter: combo.jitter,
      passed,
      failed,
      duration,
      failedTests,
    });

    if (VERBOSE) {
      log(`  ${filename}: ${passed} passed, ${failed} failed (${duration}ms)`);
    }
  }

  // Sort combinations by latency, then packet loss, then jitter
  combinations.sort((a, b) => {
    if (a.latency !== b.latency) return a.latency - b.latency;
    if (a.packetLoss !== b.packetLoss) return a.packetLoss - b.packetLoss;
    return a.jitter - b.jitter;
  });

  console.log('');
  info('Summary:');
  log(`  Total combinations: ${combinations.length}`);
  log(`  Total test runs: ${totalTests}`);
  log(`  Total passed: ${totalPassed}`);
  log(`  Total failed: ${totalFailed}`);
  console.log('');

  // Identify patterns
  const patterns = identifyPatterns(combinations, failuresByTest);

  // Generate summary object
  const summary = {
    timestamp: new Date().toISOString(),
    totalCombinations: combinations.length,
    totalTestRuns: totalTests,
    totalPassed,
    totalFailed,
    combinations,
    failuresByTest,
    failuresByCondition,
    patterns,
  };

  return summary;
}

// Identify failure patterns
function identifyPatterns(combinations, failuresByTest) {
  const patterns = {
    passThreshold: null,
    partialFailure: [],
    criticalFailure: [],
    flaky: [],
  };

  // Find pass threshold (highest latency/loss where all tests pass)
  let maxPassLatency = -1;
  let maxPassLoss = -1;
  let anyPassed = false;

  for (const combo of combinations) {
    if (combo.failed === 0) {
      anyPassed = true;
      if (combo.latency > maxPassLatency) maxPassLatency = combo.latency;
      if (combo.packetLoss > maxPassLoss) maxPassLoss = combo.packetLoss;
    }
  }

  if (anyPassed) {
    patterns.passThreshold = `All tests pass at latency ≤ ${maxPassLatency}ms, packet loss ≤ ${maxPassLoss}%`;
  } else {
    patterns.passThreshold = 'No combination achieved 100% pass rate';
  }

  // Find partial failures (1-50% of tests fail)
  for (const combo of combinations) {
    const totalTestsInCombo = combo.passed + combo.failed;
    if (totalTestsInCombo === 0) continue;

    const failureRate = combo.failed / totalTestsInCombo;

    if (failureRate > 0 && failureRate < 0.5) {
      patterns.partialFailure.push(
        `${combo.failed}/${totalTestsInCombo} tests fail at ${combo.latency}ms latency, ${combo.packetLoss}% loss, ${combo.jitter}ms jitter`
      );
    } else if (failureRate >= 0.5) {
      patterns.criticalFailure.push(
        `${combo.failed}/${totalTestsInCombo} tests fail at ${combo.latency}ms latency, ${combo.packetLoss}% loss, ${combo.jitter}ms jitter`
      );
    }
  }

  // Find flaky tests (fail in some conditions but not others, where conditions are similar)
  for (const [testName, failures] of Object.entries(failuresByTest)) {
    if (failures.length > 0 && failures.length < combinations.length) {
      patterns.flaky.push(`${testName}: fails in ${failures.length}/${combinations.length} combinations`);
    }
  }

  return patterns;
}

// Print summary table
function printSummaryTable(summary) {
  info('Test Matrix Results:');
  console.log('');
  console.log('  Latency | Loss | Jitter | Passed | Failed | Duration | Failed Tests');
  console.log('  --------|------|--------|--------|--------|----------|-------------');

  for (const combo of summary.combinations) {
    const latency = String(combo.latency).padEnd(7);
    const loss = String(combo.packetLoss).padEnd(4);
    const jitter = String(combo.jitter).padEnd(6);
    const passed = String(combo.passed).padEnd(6);
    const failed = String(combo.failed).padEnd(6);
    const duration = String(Math.round(combo.duration / 1000)).padEnd(8) + 's';

    const failedTestsStr = combo.failedTests.length > 0
      ? combo.failedTests.slice(0, 2).join(', ') + (combo.failedTests.length > 2 ? '...' : '')
      : '-';

    const color = combo.failed === 0 ? GREEN : combo.failed < combo.passed ? YELLOW : RED;

    console.log(`  ${color}${latency} | ${loss} | ${jitter} | ${passed} | ${failed} | ${duration} | ${failedTestsStr}${RESET}`);
  }

  console.log('');
  info('Patterns:');
  console.log(`  ${GREEN}✓${RESET} Pass threshold: ${summary.patterns.passThreshold}`);

  if (summary.patterns.partialFailure.length > 0) {
    console.log(`  ${YELLOW}⚠${RESET} Partial failures:`);
    for (const msg of summary.patterns.partialFailure) {
      console.log(`    - ${msg}`);
    }
  }

  if (summary.patterns.criticalFailure.length > 0) {
    console.log(`  ${RED}✗${RESET} Critical failures:`);
    for (const msg of summary.patterns.criticalFailure) {
      console.log(`    - ${msg}`);
    }
  }

  if (summary.patterns.flaky.length > 0) {
    console.log(`  ${YELLOW}⚡${RESET} Flaky tests:`);
    for (const msg of summary.patterns.flaky.slice(0, 5)) {
      console.log(`    - ${msg}`);
    }
    if (summary.patterns.flaky.length > 5) {
      console.log(`    ... and ${summary.patterns.flaky.length - 5} more`);
    }
  }

  console.log('');
}

// Main execution
function main() {
  console.log('');
  info('===========================================');
  info('LAN Test Matrix Summary Generator');
  info('===========================================');
  console.log('');

  // Analyze matrix
  const summary = analyzeMatrix();

  // Print summary table
  printSummaryTable(summary);

  // Write summary JSON
  writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));
  success(`Summary written to: ${OUTPUT_FILE}`);

  // Exit code based on failures
  if (summary.totalFailed > 0) {
    warning(`Matrix completed with ${summary.totalFailed} failures`);
    process.exit(1);
  } else {
    success('All tests passed across all combinations!');
    process.exit(0);
  }
}

main();
