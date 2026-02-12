#!/usr/bin/env node
/**
 * Quick validation script to test network simulation CLI flag parsing
 * Tests that the test harness correctly parses network simulation flags
 * without running the full test suite.
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const NVM_PATH = process.env.NVM_BIN || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

function runTest(args, expectedOutput) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      `${NVM_PATH}/node`,
      ['tests/lan/run-lan-tests.mjs', ...args],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PATH: `${NVM_PATH}:/usr/bin:/bin` },
      }
    );

    let output = '';
    let foundExpected = false;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;

      // Check if we found the expected output
      if (text.includes(expectedOutput)) {
        foundExpected = true;
        proc.kill('SIGTERM');
        resolve({ success: true, output: text });
      }

      // Also kill if we see "Launching browser" (means we got past config)
      if (text.includes('Launching browser')) {
        proc.kill('SIGTERM');
        resolve({ success: foundExpected, output });
      }
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('exit', () => {
      if (!foundExpected) {
        reject(new Error(`Did not find expected output: "${expectedOutput}"\nGot: ${output.slice(0, 500)}`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Test timeout after 30s'));
    }, 30000);
  });
}

async function main() {
  console.log('Testing network simulation CLI flag parsing...\n');

  // Test 1: No flags (disabled)
  console.log('Test 1: No network simulation flags');
  try {
    const result = await runTest([], 'Network Simulation: DISABLED');
    console.log('  ✓ PASS - Network simulation disabled by default\n');
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    process.exit(1);
  }

  // Test 2: --network-sim with latency
  console.log('Test 2: --network-sim --latency 50');
  try {
    const result = await runTest(
      ['--network-sim', '--latency', '50'],
      'Latency: 50ms'
    );
    console.log('  ✓ PASS - Latency flag parsed correctly\n');
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    process.exit(1);
  }

  // Test 3: --network-sim with packet loss
  console.log('Test 3: --network-sim --latency 100 --packet-loss 5');
  try {
    const result = await runTest(
      ['--network-sim', '--latency', '100', '--packet-loss', '5'],
      'Packet Loss: 5%'
    );
    console.log('  ✓ PASS - Packet loss flag parsed correctly\n');
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    process.exit(1);
  }

  // Test 4: --network-sim with jitter
  console.log('Test 4: --network-sim --latency 50 --jitter 10');
  try {
    const result = await runTest(
      ['--network-sim', '--latency', '50', '--jitter', '10'],
      'Jitter: 10ms'
    );
    console.log('  ✓ PASS - Jitter flag parsed correctly\n');
  } catch (err) {
    console.error('  ✗ FAIL:', err.message);
    process.exit(1);
  }

  console.log('All tests passed! ✓');
  console.log('\nNetwork simulation CLI flags are working correctly.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
