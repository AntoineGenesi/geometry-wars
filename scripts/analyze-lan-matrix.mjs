#!/usr/bin/env node
/**
 * LAN Network Simulation Analysis Script
 *
 * Analyzes test matrix results from test-results/lan/matrix/
 * Identifies failure patterns, thresholds, and generates recommendations
 *
 * Usage:
 *   node scripts/analyze-lan-matrix.mjs [--mock]
 *
 * Options:
 *   --mock    Generate report with mock data for demonstration
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const MATRIX_DIR = path.join(PROJECT_ROOT, 'test-results', 'lan', 'matrix');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');
const DECISIONS_DIR = path.join(PROJECT_ROOT, 'decisions');

// Real-world network conditions for comparison
const REAL_WORLD_CONDITIONS = {
  'Localhost (same PC)': { latency: 0, loss: 0, jitter: 0 },
  'LAN (Ethernet)': { latency: 5, loss: 0, jitter: 1 },
  'WiFi (same room)': { latency: 30, loss: 1, jitter: 10 },
  'WiFi (different floor)': { latency: 50, loss: 2, jitter: 15 },
  'Bad WiFi': { latency: 100, loss: 5, jitter: 25 },
  'Very Bad WiFi': { latency: 200, loss: 10, jitter: 50 },
};

/**
 * Calculate Euclidean distance in (latency, loss, jitter) space
 */
function calculateDistance(a, b) {
  const latencyDiff = (a.latency - b.latency) / 200; // Normalize to 0-1
  const lossDiff = (a.loss - b.loss) / 10; // Normalize to 0-1
  const jitterDiff = (a.jitter - b.jitter) / 50; // Normalize to 0-1
  return Math.sqrt(latencyDiff ** 2 + lossDiff ** 2 + jitterDiff ** 2);
}

/**
 * Find the closest tested condition to a target condition
 */
function findClosestCondition(target, tested) {
  let closest = null;
  let minDistance = Infinity;

  for (const result of tested) {
    const distance = calculateDistance(target, result.config);
    if (distance < minDistance) {
      minDistance = distance;
      closest = result;
    }
  }

  return closest;
}

/**
 * Classify result status
 */
function classifyStatus(result) {
  const total = result.passed + result.failed;
  const failRate = total > 0 ? result.failed / total : 0;

  if (failRate === 0) return 'PASS';
  if (failRate < 0.5) return 'PARTIAL';
  return 'FAIL';
}

/**
 * Identify pass threshold (max latency/loss where all tests pass)
 */
function identifyPassThreshold(results) {
  const allPass = results.filter(r => r.failed === 0);

  if (allPass.length === 0) {
    return { latency: 0, loss: 0, jitter: 0 };
  }

  const maxPassLatency = Math.max(...allPass.map(r => r.config.latency));
  const maxPassLoss = Math.max(...allPass.map(r => r.config.loss));
  const maxPassJitter = Math.max(...allPass.map(r => r.config.jitter));

  return { latency: maxPassLatency, loss: maxPassLoss, jitter: maxPassJitter };
}

/**
 * Identify failure patterns by test name
 */
function identifyFailurePatterns(results) {
  const testFailures = new Map();

  for (const result of results) {
    for (const test of result.failedTests || []) {
      if (!testFailures.has(test)) {
        testFailures.set(test, []);
      }
      testFailures.set(test, [...testFailures.get(test), result.config]);
    }
  }

  return Array.from(testFailures.entries()).map(([testName, conditions]) => ({
    testName,
    failureCount: conditions.length,
    conditions,
  }));
}

/**
 * Generate HTML report
 */
function generateHTMLReport(results, analysis) {
  const timestamp = new Date().toISOString().split('T')[0];
  const totalTests = results.reduce((sum, r) => sum + r.passed + r.failed, 0);
  const passedTests = results.reduce((sum, r) => sum + r.passed, 0);
  const failedTests = results.reduce((sum, r) => sum + r.failed, 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LAN Network Simulation Report — Geometry Wars 3D</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 40px auto;
      padding: 0 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
    h2 { color: #34495e; margin-top: 40px; border-bottom: 2px solid #ecf0f1; padding-bottom: 8px; }
    h3 { color: #7f8c8d; margin-top: 30px; }

    .metadata {
      background: #ecf0f1;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
    }
    .metadata p { margin: 5px 0; }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 20px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    th, td {
      border: 1px solid #ddd;
      padding: 12px;
      text-align: center;
    }
    th {
      background: #34495e;
      color: white;
      font-weight: 600;
    }
    tr:nth-child(even) { background: #f9f9f9; }
    tr:hover { background: #f5f5f5; }

    .pass { background: #27ae60 !important; color: white; font-weight: bold; }
    .partial { background: #f39c12 !important; color: white; font-weight: bold; }
    .fail { background: #e74c3c !important; color: white; font-weight: bold; }

    .summary-box {
      background: #3498db;
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .summary-box h3 { color: white; margin-top: 0; border: none; }
    .summary-box strong { color: #ecf0f1; }

    .recommendation {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px 20px;
      margin: 20px 0;
    }
    .recommendation h4 { margin-top: 0; color: #856404; }

    .test-details {
      background: #f8f9fa;
      padding: 15px;
      border-left: 4px solid #6c757d;
      margin: 10px 0;
    }

    .code {
      background: #2c3e50;
      color: #ecf0f1;
      padding: 15px;
      border-radius: 5px;
      font-family: 'Courier New', monospace;
      overflow-x: auto;
      margin: 10px 0;
    }

    ul, ol { padding-left: 25px; }
    li { margin: 8px 0; }

    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 2px solid #ecf0f1;
      color: #7f8c8d;
      font-size: 14px;
    }

    a { color: #3498db; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>🌐 LAN Network Simulation Report</h1>

  <div class="metadata">
    <p><strong>Generated:</strong> ${timestamp}</p>
    <p><strong>Test Matrix:</strong> ${results.length} network condition combinations</p>
    <p><strong>Total Test Runs:</strong> ${totalTests} (${passedTests} passed, ${failedTests} failed)</p>
    <p><strong>Verification Level:</strong> Level 4 — Programmatic visual testing under simulated network conditions</p>
  </div>

  <div class="summary-box">
    <h3>📊 Executive Summary</h3>
    <p><strong>Pass Threshold:</strong> ${analysis.passThreshold.latency}ms latency, ${analysis.passThreshold.loss}% packet loss, ${analysis.passThreshold.jitter}ms jitter</p>
    <p><strong>Failure Pattern:</strong> ${analysis.failurePattern}</p>
    <p><strong>Recommendation:</strong> ${analysis.recommendation}</p>
  </div>

  <h2>Test Matrix Results</h2>
  <table>
    <thead>
      <tr>
        <th>Latency</th>
        <th>Packet Loss</th>
        <th>Jitter</th>
        <th>Passed</th>
        <th>Failed</th>
        <th>Total</th>
        <th>Duration</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${results.map(r => {
        const status = classifyStatus(r);
        const duration = r.duration ? `${Math.round(r.duration / 1000)}s` : 'N/A';
        const total = r.passed + r.failed;
        return `
      <tr class="${status.toLowerCase()}">
        <td>${r.config.latency}ms</td>
        <td>${r.config.loss}%</td>
        <td>${r.config.jitter}ms</td>
        <td>${r.passed}</td>
        <td>${r.failed}</td>
        <td>${total}</td>
        <td>${duration}</td>
        <td>${status}</td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>

  <h2>Real-World Network Comparison</h2>
  <p>How do our test results map to real-world network conditions?</p>
  <table>
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Expected Conditions</th>
        <th>Closest Test</th>
        <th>Result</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(REAL_WORLD_CONDITIONS).map(([scenario, conditions]) => {
        const closest = findClosestCondition(conditions, results);
        if (!closest) return '';
        const status = classifyStatus(closest);
        const statusIcon = status === 'PASS' ? '✓' : status === 'PARTIAL' ? '⚠' : '✗';
        return `
      <tr class="${status.toLowerCase()}">
        <td><strong>${scenario}</strong></td>
        <td>${conditions.latency}ms, ${conditions.loss}% loss, ${conditions.jitter}ms jitter</td>
        <td>${closest.config.latency}ms, ${closest.config.loss}% loss, ${closest.config.jitter}ms jitter</td>
        <td>${statusIcon} ${status}</td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>

  <h2>Failed Tests by Condition</h2>
  ${analysis.failuresByTest.length === 0 ? '<p>✓ All tests passed in all conditions!</p>' : `
  ${analysis.failuresByTest.map(({ testName, failureCount, conditions }) => `
    <div class="test-details">
      <h4>"${testName}" — Failed ${failureCount} time${failureCount > 1 ? 's' : ''}</h4>
      <p><strong>Conditions where this test failed:</strong></p>
      <ul>
        ${conditions.map(c => `<li>${c.latency}ms latency, ${c.loss}% loss, ${c.jitter}ms jitter</li>`).join('')}
      </ul>
    </div>
  `).join('')}
  `}

  <h2>Analysis</h2>
  <h3>Why Automated Tests ${analysis.testsPassAtRealisticConditions ? 'Pass' : 'Fail'} at Realistic Conditions</h3>
  ${analysis.conclusion}

  <h2>Recommendations</h2>
  <div class="recommendation">
    <h4>Next Steps</h4>
    <ol>
      ${analysis.recommendations.map(rec => `<li>${rec}</li>`).join('')}
    </ol>
  </div>

  <h2>Related Documents</h2>
  <ul>
    <li><a href="../decisions/lan-deep-audit-2026-02-11.md">Deep LAN Audit (12 issues identified)</a></li>
    <li><a href="../decisions/lan-quick-wins-implemented-2026-02-11.md">Quick Wins (5 fixes implemented)</a></li>
    <li><a href="../.claude/docs/network-simulation-setup.md">Network Simulation Setup</a></li>
    <li><a href="../decisions/lan-network-simulation-results-2026-02-12.md">Detailed Analysis Report</a></li>
  </ul>

  <h2>User Testing Required</h2>
  <p><strong>Verification Level 4</strong> provides programmatic validation but cannot replicate real human perception.</p>
  <p><strong>Level 6 testing needed:</strong> Human testing in real browser with actual network conditions (LAN Ethernet, WiFi)</p>

  <div class="footer">
    <p>Generated by <strong>analyze-lan-matrix.mjs</strong> — Geometry Wars 3D LAN Analysis Tool</p>
    <p>Session 13 — February 2026</p>
  </div>
</body>
</html>`;

  return html;
}

/**
 * Generate decision document
 */
function generateDecisionDocument(results, analysis) {
  const timestamp = new Date().toISOString().split('T')[0];

  return `# LAN Network Simulation Results — ${timestamp}

## Context

After multiple sessions of LAN multiplayer fixes (Sessions 4-12), user reports that LAN mode still feels "laggy and weird" despite automated tests passing. This analysis phase runs comprehensive network simulation tests to identify if the issue is network-related or architectural.

**Goal:** Answer the question "Why does LAN feel laggy when user tests it, but automated tests pass?"

## Test Matrix

### Methodology

- **Network simulation:** Linux tc (traffic control) with netem qdisc
- **Conditions tested:** ${results.length} combinations of latency, packet loss, and jitter
- **Test suite:** ${results[0]?.passed + results[0]?.failed || 16} tests per combination
- **Total test runs:** ${results.reduce((sum, r) => sum + r.passed + r.failed, 0)}
- **Verification method:** Puppeteer visual testing with SwiftShader headless WebGL

### Test Matrix Results

| Latency | Packet Loss | Jitter | Passed | Failed | Status |
|---------|-------------|--------|--------|--------|--------|
${results.map(r => {
  const status = classifyStatus(r);
  const statusIcon = status === 'PASS' ? '✓' : status === 'PARTIAL' ? '⚠' : '✗';
  return `| ${r.config.latency}ms | ${r.config.loss}% | ${r.config.jitter}ms | ${r.passed} | ${r.failed} | ${statusIcon} ${status} |`;
}).join('\n')}

## Findings

### Pass Threshold

**All tests pass at:**
- Latency ≤ ${analysis.passThreshold.latency}ms
- Packet loss ≤ ${analysis.passThreshold.loss}%
- Jitter ≤ ${analysis.passThreshold.jitter}ms

### Failure Patterns

${analysis.failuresByTest.length === 0 ? 'No failures detected — all tests pass in all conditions.' : `
${analysis.failuresByTest.map(({ testName, failureCount, conditions }) => `
**"${testName}"** — Failed ${failureCount}/${results.length} times
- Fails at: ${conditions.map(c => `${c.latency}ms/${c.loss}%/${c.jitter}ms`).join(', ')}
- Pattern: ${failureCount === results.length ? 'Always fails' : failureCount < 3 ? 'Flaky test' : 'Fails under high latency/loss'}
`).join('\n')}
`}

### Real-World Network Comparison

${Object.entries(REAL_WORLD_CONDITIONS).map(([scenario, conditions]) => {
  const closest = findClosestCondition(conditions, results);
  if (!closest) return '';
  const status = classifyStatus(closest);
  const statusIcon = status === 'PASS' ? '✓' : status === 'PARTIAL' ? '⚠' : '✗';
  return `**${scenario}** (${conditions.latency}ms, ${conditions.loss}% loss) — ${statusIcon} ${status}\n- Closest test: ${closest.config.latency}ms, ${closest.config.loss}% loss, ${closest.config.jitter}ms jitter`;
}).join('\n\n')}

## Analysis

${analysis.conclusion}

## Recommendations

${analysis.recommendations.map((rec, i) => `${i + 1}. ${rec}`).join('\n')}

## Next Steps

**If tests pass at realistic latencies (LAN/WiFi):**
- Focus on architectural issues (rendering, prediction, server logic)
- Profile client-side performance (frame time, render loop)
- Check for non-network-related stuttering

**If tests fail at realistic latencies:**
- Improve client prediction (apply all state changes locally)
- Add interpolation buffer (smooth out network jitter)
- Display network quality indicator to user
- Set user expectations ("Requires stable connection <100ms latency")

## Reversibility

**Easy** — All network simulation is external to game code. No game changes were made. Analysis scripts can be re-run with different test matrices at any time.

## Related Documents

- [Deep LAN Audit (12 issues)](lan-deep-audit-2026-02-11.md)
- [Quick Wins Implemented (5 fixes)](lan-quick-wins-implemented-2026-02-11.md)
- [Network Simulation Setup](./.claude/docs/network-simulation-setup.md)
- [Test Matrix Scripts](../scripts/run-lan-test-matrix.sh)
`;
}

/**
 * Parse matrix results from directory
 */
function parseMatrixResults() {
  if (!fs.existsSync(MATRIX_DIR)) {
    console.error(`❌ Matrix directory not found: ${MATRIX_DIR}`);
    console.error('   Run the test matrix first: sudo scripts/run-lan-test-matrix.sh');
    return null;
  }

  const files = fs.readdirSync(MATRIX_DIR).filter(f => f.startsWith('lan-test-') && f.endsWith('.json'));

  if (files.length === 0) {
    console.error(`❌ No test result files found in ${MATRIX_DIR}`);
    console.error('   Run the test matrix first: sudo scripts/run-lan-test-matrix.sh');
    return null;
  }

  const results = [];
  for (const file of files) {
    try {
      const filePath = path.join(MATRIX_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Extract config from filename: lan-test-100ms-5loss-10jitter.json
      const match = file.match(/lan-test-(\d+)ms-(\d+)loss-(\d+)jitter\.json/);
      if (match) {
        const config = {
          latency: parseInt(match[1], 10),
          loss: parseInt(match[2], 10),
          jitter: parseInt(match[3], 10),
        };

        // Extract results
        const passed = data.tests?.filter(t => t.status === 'passed').length || 0;
        const failed = data.tests?.filter(t => t.status === 'failed').length || 0;
        const failedTests = data.tests?.filter(t => t.status === 'failed').map(t => t.name) || [];

        results.push({
          config,
          passed,
          failed,
          failedTests,
          duration: data.duration || 0,
        });
      }
    } catch (error) {
      console.error(`⚠️  Failed to parse ${file}:`, error.message);
    }
  }

  return results;
}

/**
 * Generate mock data for demonstration
 */
function generateMockData() {
  const latencies = [0, 50, 100, 200];
  const losses = [0, 5, 10];
  const results = [];

  for (const latency of latencies) {
    for (const loss of losses) {
      // Determine pass/fail based on thresholds
      let passed = 16;
      let failed = 0;
      const failedTests = [];

      // Failures increase with latency and loss
      if (latency > 100 || loss > 5) {
        failed = 4;
        passed = 12;
        failedTests.push('Movement syncs correctly', 'Enemy counts match');
      }
      if (latency > 150 || loss > 8) {
        failed = 8;
        passed = 8;
        failedTests.push('Bullets spawn correctly', 'Weapon state syncs');
      }
      if (latency > 200 || loss > 10) {
        failed = 12;
        passed = 4;
        failedTests.push('Client connects successfully', 'Game state syncs');
      }

      results.push({
        config: { latency, loss, jitter: 0 },
        passed,
        failed,
        failedTests,
        duration: 45000 + Math.random() * 15000,
      });
    }
  }

  return results;
}

/**
 * Analyze results and generate recommendations
 */
function analyzeResults(results) {
  const passThreshold = identifyPassThreshold(results);
  const failuresByTest = identifyFailurePatterns(results);

  // Determine if tests pass at realistic conditions
  const lanCondition = findClosestCondition(REAL_WORLD_CONDITIONS['LAN (Ethernet)'], results);
  const wifiCondition = findClosestCondition(REAL_WORLD_CONDITIONS['WiFi (same room)'], results);

  const lanPasses = lanCondition && lanCondition.failed === 0;
  const wifiPasses = wifiCondition && wifiCondition.failed === 0;
  const testsPassAtRealisticConditions = lanPasses && wifiPasses;

  // Generate conclusion
  let conclusion;
  let failurePattern;
  let recommendation;
  let recommendations = [];

  if (testsPassAtRealisticConditions) {
    failurePattern = 'Tests pass at realistic LAN/WiFi latencies';
    recommendation = 'User\'s "laggy" feeling is likely architectural, not network-related';
    conclusion = `<p><strong>Key Finding:</strong> Automated tests PASS at realistic LAN (≤10ms) and WiFi (30-50ms) latencies.</p>
    <p>This suggests that the "laggy and weird" feeling reported by the user is <strong>NOT caused by network latency</strong>.</p>
    <p><strong>Likely causes:</strong></p>
    <ul>
      <li><strong>Rendering performance:</strong> Client-side frame drops, stuttering, or expensive render operations</li>
      <li><strong>Prediction mismatch:</strong> Client prediction doesn't match server physics (causes "rubber-banding")</li>
      <li><strong>Server tick rate:</strong> 60Hz tick rate may not be smooth enough for fast-paced gameplay</li>
      <li><strong>Interpolation issues:</strong> Entity positions jump instead of smoothly interpolating</li>
    </ul>`;

    recommendations = [
      'Profile client-side rendering performance (check frame times with F3 overlay)',
      'Verify client prediction matches server physics exactly (same deltaTime, same order)',
      'Add interpolation buffer for remote entities (smooth out 60Hz updates)',
      'Check for frame drops caused by expensive operations (garbage collection, shader compilation)',
      'Test on different hardware (user may have slower GPU/CPU)',
    ];
  } else {
    failurePattern = `Tests fail at latency >${passThreshold.latency}ms or packet loss >${passThreshold.loss}%`;
    recommendation = 'LAN multiplayer is network-sensitive, requires architectural improvements';
    conclusion = `<p><strong>Key Finding:</strong> Automated tests FAIL at realistic WiFi latencies (30-50ms).</p>
    <p>This suggests that LAN multiplayer is <strong>network-sensitive</strong> and requires better handling of latency/loss.</p>
    <p><strong>Architectural improvements needed:</strong></p>
    <ul>
      <li><strong>Client prediction:</strong> Apply all state changes locally, not just movement (weapon fire, enemy spawns)</li>
      <li><strong>Interpolation buffer:</strong> Buffer 2-3 server updates, interpolate smoothly instead of snapping</li>
      <li><strong>Lag compensation:</strong> Server rewinds time for hit detection (standard FPS technique)</li>
      <li><strong>Adaptive quality:</strong> Reduce patch rate on high latency (60Hz → 30Hz → 20Hz)</li>
    </ul>`;

    recommendations = [
      'Implement full client prediction (not just movement, but all state changes)',
      'Add interpolation buffer (2-3 server updates, 100-150ms) for smooth remote entity movement',
      'Implement lag compensation for hit detection (rewind server state by latency)',
      'Add network quality indicator to UI (show ping, packet loss, prediction error)',
      'Warn users when network quality is poor ("Latency >100ms, gameplay may be affected")',
      'Consider adaptive patch rate (reduce from 60Hz to 30Hz on high latency)',
    ];
  }

  return {
    passThreshold,
    failuresByTest,
    testsPassAtRealisticConditions,
    failurePattern,
    recommendation,
    conclusion,
    recommendations,
  };
}

/**
 * Main execution
 */
function main() {
  const useMockData = process.argv.includes('--mock');

  console.log('🌐 LAN Network Simulation Analysis');
  console.log('==================================\n');

  let results;
  if (useMockData) {
    console.log('📦 Using mock data for demonstration\n');
    results = generateMockData();
  } else {
    console.log('📊 Parsing matrix results...\n');
    results = parseMatrixResults();

    if (!results || results.length === 0) {
      console.log('\n💡 Tip: Use --mock flag to generate report with sample data');
      process.exit(1);
    }
  }

  console.log(`✓ Parsed ${results.length} test combinations\n`);
  console.log('🔍 Analyzing patterns...\n');

  const analysis = analyzeResults(results);

  console.log(`✓ Pass threshold: ${analysis.passThreshold.latency}ms latency, ${analysis.passThreshold.loss}% loss`);
  console.log(`✓ Found ${analysis.failuresByTest.length} flaky/failing tests\n`);

  // Ensure output directories exist
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(DECISIONS_DIR, { recursive: true });

  // Generate HTML report
  console.log('📝 Generating HTML report...');
  const html = generateHTMLReport(results, analysis);
  const reportPath = path.join(REPORTS_DIR, 'lan-network-simulation-report.html');
  fs.writeFileSync(reportPath, html, 'utf8');
  console.log(`✓ Report saved: ${reportPath}\n`);

  // Generate decision document
  console.log('📝 Generating decision document...');
  const decision = generateDecisionDocument(results, analysis);
  const decisionPath = path.join(DECISIONS_DIR, 'lan-network-simulation-results-2026-02-12.md');
  fs.writeFileSync(decisionPath, decision, 'utf8');
  console.log(`✓ Decision document saved: ${decisionPath}\n`);

  console.log('✅ Analysis complete!');
  console.log(`\n📊 Summary:`);
  console.log(`   - Tests: ${results.reduce((sum, r) => sum + r.passed + r.failed, 0)} total`);
  console.log(`   - Pass rate: ${Math.round(results.reduce((sum, r) => sum + r.passed, 0) / results.reduce((sum, r) => sum + r.passed + r.failed, 0) * 100)}%`);
  console.log(`   - Recommendation: ${analysis.recommendation}`);
  console.log(`\n👉 View report: ${reportPath}`);

  if (useMockData) {
    console.log('\n⚠️  This report uses MOCK DATA. Run actual tests with:');
    console.log('   sudo scripts/run-lan-test-matrix.sh');
    console.log('   Then re-run: node scripts/analyze-lan-matrix.mjs');
  }
}

main();
