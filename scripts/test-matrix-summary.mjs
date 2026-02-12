#!/usr/bin/env node
/**
 * Validation script for matrix summary generator
 * Creates mock test results and verifies summary generation works
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEST_DIR = resolve(PROJECT_ROOT, 'test-results/lan/matrix-test');

console.log('Matrix Summary Generator Validation Test');
console.log('==========================================\n');

// Clean up any previous test data
if (existsSync(TEST_DIR)) {
  rmSync(TEST_DIR, { recursive: true });
}

// Create test directory
mkdirSync(TEST_DIR, { recursive: true });

console.log('1. Creating mock test result files...');

// Mock test results for different combinations
const mockResults = [
  {
    name: 'lan-test-0ms-0loss-0jitter.json',
    data: {
      passed: 16,
      failed: 0,
      duration: 45000,
      tests: Array.from({ length: 16 }, (_, i) => ({
        name: `Test ${i + 1}`,
        status: 'passed',
        duration: 2500,
      })),
    },
  },
  {
    name: 'lan-test-100ms-0loss-0jitter.json',
    data: {
      passed: 14,
      failed: 2,
      duration: 78000,
      tests: [
        ...Array.from({ length: 14 }, (_, i) => ({
          name: `Test ${i + 1}`,
          status: 'passed',
          duration: 4500,
        })),
        { name: 'Movement syncs correctly', status: 'failed', duration: 5000 },
        { name: 'Enemy counts match', status: 'failed', duration: 5000 },
      ],
    },
  },
  {
    name: 'lan-test-100ms-10loss-0jitter.json',
    data: {
      passed: 10,
      failed: 6,
      duration: 92000,
      tests: [
        ...Array.from({ length: 10 }, (_, i) => ({
          name: `Test ${i + 1}`,
          status: 'passed',
          duration: 5000,
        })),
        { name: 'Movement syncs correctly', status: 'failed', duration: 6000 },
        { name: 'Enemy counts match', status: 'failed', duration: 6000 },
        { name: 'Bullet syncing works', status: 'failed', duration: 6000 },
        { name: 'Score updates correctly', status: 'failed', duration: 6000 },
        { name: 'Connection stability', status: 'failed', duration: 6000 },
        { name: 'No disconnection test', status: 'failed', duration: 6000 },
      ],
    },
  },
  {
    name: 'lan-test-200ms-0loss-0jitter.json',
    data: {
      passed: 8,
      failed: 8,
      duration: 110000,
      tests: [
        ...Array.from({ length: 8 }, (_, i) => ({
          name: `Test ${i + 1}`,
          status: 'passed',
          duration: 6000,
        })),
        { name: 'Movement syncs correctly', status: 'failed', duration: 8000 },
        { name: 'Enemy counts match', status: 'failed', duration: 8000 },
        { name: 'Bullet syncing works', status: 'failed', duration: 8000 },
        { name: 'Score updates correctly', status: 'failed', duration: 8000 },
        { name: 'Latency tolerance test', status: 'failed', duration: 8000 },
        { name: 'Client prediction accuracy', status: 'failed', duration: 8000 },
        { name: 'State reconciliation', status: 'failed', duration: 8000 },
        { name: 'Input responsiveness', status: 'failed', duration: 8000 },
      ],
    },
  },
];

for (const result of mockResults) {
  const filepath = resolve(TEST_DIR, result.name);
  writeFileSync(filepath, JSON.stringify(result.data, null, 2));
  console.log(`  ✓ Created: ${result.name}`);
}

console.log(`\n2. Running matrix summary generator on mock data...\n`);

// Temporarily modify the generator script to use test directory
const generatorPath = resolve(PROJECT_ROOT, 'scripts/generate-matrix-summary.mjs');
const originalContent = readFileSync(generatorPath, 'utf-8');
const modifiedContent = originalContent
  .replace(
    "const MATRIX_DIR = resolve(PROJECT_ROOT, 'test-results/lan/matrix');",
    `const MATRIX_DIR = resolve(PROJECT_ROOT, 'test-results/lan/matrix-test');`
  )
  .replace(
    "const OUTPUT_FILE = resolve(PROJECT_ROOT, 'test-results/lan/matrix-summary.json');",
    `const OUTPUT_FILE = resolve(PROJECT_ROOT, 'test-results/lan/matrix-summary-test.json');`
  );

const tempGeneratorPath = resolve(PROJECT_ROOT, 'scripts/generate-matrix-summary-temp.mjs');
writeFileSync(tempGeneratorPath, modifiedContent);

try {
  execSync(`node "${tempGeneratorPath}"`, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
} catch (err) {
  // Expected to exit with code 1 due to failures in mock data
  if (err.status !== 1) {
    console.error('Unexpected error:', err);
    process.exit(1);
  }
}

console.log('\n3. Validating summary output...\n');

// Read generated summary
const summaryPath = resolve(PROJECT_ROOT, 'test-results/lan/matrix-summary-test.json');
const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));

// Validate structure
const checks = [
  {
    name: 'Summary has timestamp',
    check: () => summary.timestamp && typeof summary.timestamp === 'string',
  },
  {
    name: 'Summary has totalCombinations',
    check: () => summary.totalCombinations === 4,
  },
  {
    name: 'Summary has combinations array',
    check: () => Array.isArray(summary.combinations) && summary.combinations.length === 4,
  },
  {
    name: 'Summary has patterns object',
    check: () => summary.patterns && typeof summary.patterns === 'object',
  },
  {
    name: 'Patterns identify pass threshold',
    check: () => summary.patterns.passThreshold && summary.patterns.passThreshold.includes('0ms'),
  },
  {
    name: 'Patterns identify partial failures',
    check: () => Array.isArray(summary.patterns.partialFailure) && summary.patterns.partialFailure.length > 0,
  },
  {
    name: 'Patterns identify critical failures',
    check: () => Array.isArray(summary.patterns.criticalFailure) && summary.patterns.criticalFailure.length > 0,
  },
  {
    name: 'Failed tests are tracked',
    check: () => summary.failuresByTest && Object.keys(summary.failuresByTest).length > 0,
  },
  {
    name: 'Combinations sorted correctly',
    check: () => {
      for (let i = 1; i < summary.combinations.length; i++) {
        const prev = summary.combinations[i - 1];
        const curr = summary.combinations[i];
        if (prev.latency > curr.latency) return false;
        if (prev.latency === curr.latency && prev.packetLoss > curr.packetLoss) return false;
      }
      return true;
    },
  },
];

let passed = 0;
let failed = 0;

for (const check of checks) {
  try {
    if (check.check()) {
      console.log(`  ✓ ${check.name}`);
      passed++;
    } else {
      console.log(`  ✗ ${check.name}`);
      failed++;
    }
  } catch (err) {
    console.log(`  ✗ ${check.name} (threw error: ${err.message})`);
    failed++;
  }
}

console.log(`\n4. Cleanup...\n`);

// Clean up test files
rmSync(TEST_DIR, { recursive: true });
rmSync(summaryPath);
rmSync(tempGeneratorPath);

console.log('==========================================');
console.log(`Validation Results: ${passed}/${checks.length} checks passed`);
console.log('==========================================\n');

if (failed > 0) {
  console.error(`FAILED: ${failed} checks failed`);
  process.exit(1);
} else {
  console.log('SUCCESS: All validation checks passed!');
  process.exit(0);
}
