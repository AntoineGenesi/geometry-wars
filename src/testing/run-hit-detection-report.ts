/**
 * Run Hit Detection Report — Execute all surface tests and generate HTML report.
 *
 * Usage (from main project directory):
 *   npx tsx src/testing/run-hit-detection-report.ts
 *
 * Output: reports/YYYY-MM-DD-hit-detection-verification.html
 */

import { runAllSurfaceTests, ALL_SURFACES } from './SurfaceHitDetectionTests';
import { generateHitDetectionReport } from './HitDetectionReport';
import * as fs from 'fs';
import * as path from 'path';

const results = runAllSurfaceTests(ALL_SURFACES);

const report = generateHitDetectionReport(results);

const dateStr = new Date().toISOString().split('T')[0];
const reportsDir = path.join(process.cwd(), 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const reportPath = path.join(reportsDir, `${dateStr}-hit-detection-verification.html`);
fs.writeFileSync(reportPath, report);

// Print summary to console
console.log('\n=== Surface Hit Detection Verification ===\n');

let totalPassed = 0;
let totalFailed = 0;

for (const result of results) {
  const icon = result.overall === 'PASS' ? '✓' : '✗';
  const color = result.overall === 'PASS' ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m ${result.surface.padEnd(15)} ${result.passed}/${result.tests.length} tests`);

  if (result.overall === 'FAIL') {
    for (const test of result.tests.filter(t => !t.passed)) {
      console.log(`    ✗ ${test.name}: ${test.message}`);
    }
  }

  totalPassed += result.passed;
  totalFailed += result.failed;
}

console.log(`\nTotal: ${totalPassed}/${totalPassed + totalFailed} tests passed across ${results.length} surfaces`);
console.log(`Report: ${reportPath}\n`);

process.exit(totalFailed > 0 ? 1 : 0);
