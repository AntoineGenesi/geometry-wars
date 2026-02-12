#!/home/antoine/.nvm/versions/node/v20.19.5/bin/node
/**
 * Player Jitter Regression Test
 *
 * Verifies that the UV/Walker desync fix prevents vertical jitter during horizontal movement.
 *
 * ROOT CAUSE (Fixed): Player had dual position representation (UV + MeshWalker) that weren't
 * synchronized. Movement updated walker position but not player.surfaceU/V, causing desync.
 *
 * FIX: GameLoop.ts and PlaygroundGame.ts now sync player.surfaceU/V after every walker.moveFromInput()
 * by converting walker world position to UV via surface.worldToSurface().
 *
 * This test must FAIL on commit 680935f (before fix) and PASS after fix.
 * Expected: Vertical variance < 0.05 units during horizontal-only movement
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

const SEED = 12345; // Deterministic behavior
const MEASUREMENT_INTERVAL = 0.05; // Sample every 50ms (20 samples/sec)
const HORIZONTAL_MOVEMENT_DURATION = 2.0; // Test for 2 seconds
const JITTER_THRESHOLD = 0.05; // Maximum acceptable variance
const FAILURE_THRESHOLD = 0.1; // Variance above this indicates visible jitter

/**
 * Calculate variance of an array of values
 */
function calculateVariance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Test jitter on a single surface
 */
async function testJitterOnSurface(surfaceType) {
  const harness = new BrowserTestHarness({
    surfaceType,
    seed: SEED,
    cameraDistance: 20,
  });

  try {
    await harness.start();
    await harness.startGame();

    // Teleport player to center of surface
    await harness.page.evaluate(() => window.__gameDebug.teleportPlayer(0.5, 0.5));
    await harness.waitFrames(10); // Let position stabilize

    // Test 1: Hold A key (move left) for 2 seconds
    const leftSamples = [];
    const leftStartTime = performance.now();

    await harness.sendInput('a', true); // Press A key

    while ((performance.now() - leftStartTime) / 1000 < HORIZONTAL_MOVEMENT_DURATION) {
      const state = await harness.getPlayerState();
      leftSamples.push(state.position.y);
      await harness.fastForward(MEASUREMENT_INTERVAL);
    }

    await harness.sendInput('a', false); // Release A key
    await harness.waitFrames(5);

    // Test 2: Alternate A/D every 0.1s (rapid switching)
    const alternateSamples = [];
    const alternateStartTime = performance.now();
    const switchInterval = 0.1; // 100ms
    let lastSwitch = 0;
    let currentKey = 'a'; // Start with A

    await harness.sendInput(currentKey, true);

    while ((performance.now() - alternateStartTime) / 1000 < HORIZONTAL_MOVEMENT_DURATION) {
      const elapsed = (performance.now() - alternateStartTime) / 1000;

      // Switch direction every 0.1s
      if (elapsed - lastSwitch >= switchInterval) {
        await harness.sendInput(currentKey, false); // Release old key
        currentKey = currentKey === 'a' ? 'd' : 'a';
        await harness.sendInput(currentKey, true); // Press new key
        lastSwitch = elapsed;
      }

      const state = await harness.getPlayerState();
      alternateSamples.push(state.position.y);
      await harness.fastForward(MEASUREMENT_INTERVAL);
    }

    await harness.sendInput(currentKey, false); // Release final key

    // Calculate vertical variance
    const leftVariance = calculateVariance(leftSamples);
    const alternateVariance = calculateVariance(alternateSamples);
    const maxVariance = Math.max(leftVariance, alternateVariance);

    await harness.stop();

    return {
      surface: surfaceType,
      leftVariance,
      alternateVariance,
      maxVariance,
      passed: maxVariance < JITTER_THRESHOLD,
      hasVisibleJitter: maxVariance > FAILURE_THRESHOLD,
    };

  } catch (error) {
    console.error(`\n❌ Test failed on ${surfaceType}:`, error);
    throw error;
  } finally {
    if (harness) await harness.stop();
  }
}

// Run regression test
(async function main() {
  console.log('='.repeat(70));
  console.log('PLAYER JITTER REGRESSION TEST');
  console.log('='.repeat(70));
  console.log('Verifying fix for UV/Walker desync (player jitter)');
  console.log('Expected: Vertical variance < 0.05 during horizontal movement');
  console.log('='.repeat(70));

  const results = [];

  try {
    // Test on Sphere (simplest geometry, most reliable)
    console.log('\n[1/3] Testing Sphere...');
    const sphereResult = await testJitterOnSurface('sphere');
    results.push(sphereResult);
    console.log(`  Max Variance: ${sphereResult.maxVariance.toFixed(6)} ${sphereResult.passed ? '✓ PASS' : '✗ FAIL'}`);

    // Test on Torus (moderate curvature)
    console.log('\n[2/3] Testing Torus...');
    const torusResult = await testJitterOnSurface('torus');
    results.push(torusResult);
    console.log(`  Max Variance: ${torusResult.maxVariance.toFixed(6)} ${torusResult.passed ? '✓ PASS' : '✗ FAIL'}`);

    // Test on Cube (sharp edges, known tangent frame challenges)
    console.log('\n[3/3] Testing Cube...');
    const cubeResult = await testJitterOnSurface('cube');
    results.push(cubeResult);
    console.log(`  Max Variance: ${cubeResult.maxVariance.toFixed(6)} ${cubeResult.passed ? '✓ PASS' : '✗ FAIL'}`);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('REGRESSION TEST RESULTS');
    console.log('='.repeat(70));

    for (const result of results) {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      const jitterLevel = result.hasVisibleJitter ? 'VISIBLE JITTER' :
                         result.passed ? 'NO JITTER' : 'MINOR JITTER';
      console.log(`${result.surface.toUpperCase()}: ${status} (variance: ${result.maxVariance.toFixed(6)}, ${jitterLevel})`);
    }

    const allPassed = results.every(r => r.passed);
    const anyVisibleJitter = results.some(r => r.hasVisibleJitter);
    const overallMax = Math.max(...results.map(r => r.maxVariance));

    console.log('='.repeat(70));
    console.log(`Overall Max Variance: ${overallMax.toFixed(6)}`);
    console.log(`Threshold: ${JITTER_THRESHOLD} (acceptable), ${FAILURE_THRESHOLD} (visible jitter)`);

    if (allPassed) {
      console.log('\n✅ REGRESSION TEST PASSED: No jitter detected on any surface');
      console.log('   The UV/Walker desync fix is working correctly.');
      process.exit(0);
    } else if (anyVisibleJitter) {
      console.log('\n❌ REGRESSION TEST FAILED: Visible jitter detected!');
      console.log('   UV/Walker positions are not synchronized correctly.');
      process.exit(1);
    } else {
      console.log('\n⚠️  REGRESSION TEST MARGINAL: Minor jitter detected');
      console.log('   Variance exceeds ideal threshold but below visible jitter level.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Regression test crashed:', error);
    process.exit(1);
  }
})();
