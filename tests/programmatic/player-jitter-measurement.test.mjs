#!/home/antoine/.nvm/versions/node/v20.19.5/bin/node
/**
 * Player Jitter Investigation Test
 *
 * Quantitatively measures vertical oscillation during horizontal movement.
 * Tests hypothesis that MeshWalker geodesic fallback or tangent frame updates
 * cause visible jitter.
 *
 * Expected: Vertical variance < 0.05 units for horizontal-only input
 * Observed: If variance > 0.1, jitter is visible
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

const SEED = 12345; // Deterministic behavior
const MEASUREMENT_INTERVAL = 0.05; // Sample every 50ms (20 samples/sec)
const HORIZONTAL_MOVEMENT_DURATION = 2.0; // Test horizontal movement for 2 seconds

/**
 * Calculate variance of an array of values
 * variance = sum((x_i - mean)^2) / n
 */
function calculateVariance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values) {
  return Math.sqrt(calculateVariance(values));
}

/**
 * Extract Y coordinates from position samples
 */
function extractYCoordinates(samples) {
  return samples.map(s => s.y);
}

/**
 * Test jitter on a single surface
 */
async function testJitterOnSurface(surfaceType) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing jitter on ${surfaceType.toUpperCase()}`);
  console.log('='.repeat(60));

  const harness = new BrowserTestHarness({
    surfaceType,
    seed: SEED,
    cameraDistance: 20,
  });

  try {
    await harness.start();
    await harness.startGame();

    // Teleport player to starting position (center of surface)
    await harness.page.evaluate(() => window.__gameDebug.teleportPlayer(0.5, 0.5));
    await harness.waitFrames(10); // Let position stabilize

    // Test 1: Hold A key (move left) for 2 seconds
    console.log('\n--- Test 1: Hold A (left) for 2 seconds ---');
    const leftSamples = [];
    const leftStartTime = performance.now();

    await harness.sendInput('a', true); // Press A key

    while ((performance.now() - leftStartTime) / 1000 < HORIZONTAL_MOVEMENT_DURATION) {
      const state = await harness.getPlayerState();
      leftSamples.push({
        time: (performance.now() - leftStartTime) / 1000,
        ...state.position
      });
      await harness.fastForward(MEASUREMENT_INTERVAL);
    }

    await harness.sendInput('a', false); // Release A key
    await harness.waitFrames(5);

    // Test 2: Hold D key (move right) for 2 seconds
    console.log('\n--- Test 2: Hold D (right) for 2 seconds ---');
    const rightSamples = [];
    const rightStartTime = performance.now();

    await harness.sendInput('d', true); // Press D key

    while ((performance.now() - rightStartTime) / 1000 < HORIZONTAL_MOVEMENT_DURATION) {
      const state = await harness.getPlayerState();
      rightSamples.push({
        time: (performance.now() - rightStartTime) / 1000,
        ...state.position
      });
      await harness.fastForward(MEASUREMENT_INTERVAL);
    }

    await harness.sendInput('d', false); // Release D key
    await harness.waitFrames(5);

    // Test 3: Alternate A/D every 0.1s (rapid switching)
    console.log('\n--- Test 3: Alternate A/D every 0.1s ---');
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
      alternateSamples.push({
        time: elapsed,
        direction: currentKey === 'a' ? -1 : 1,
        ...state.position
      });
      await harness.fastForward(MEASUREMENT_INTERVAL);
    }

    await harness.sendInput(currentKey, false); // Release final key

    // Calculate vertical variance for each test
    const leftY = extractYCoordinates(leftSamples);
    const rightY = extractYCoordinates(rightSamples);
    const alternateY = extractYCoordinates(alternateSamples);

    const leftVariance = calculateVariance(leftY);
    const rightVariance = calculateVariance(rightY);
    const alternateVariance = calculateVariance(alternateY);

    const leftStdDev = calculateStdDev(leftY);
    const rightStdDev = calculateStdDev(rightY);
    const alternateStdDev = calculateStdDev(alternateY);

    const leftMean = leftY.reduce((a, b) => a + b, 0) / leftY.length;
    const rightMean = rightY.reduce((a, b) => a + b, 0) / rightY.length;
    const alternateMean = alternateY.reduce((a, b) => a + b, 0) / alternateY.length;

    const leftMax = Math.max(...leftY);
    const leftMin = Math.min(...leftY);
    const rightMax = Math.max(...rightY);
    const rightMin = Math.min(...rightY);
    const alternateMax = Math.max(...alternateY);
    const alternateMin = Math.min(...alternateY);

    // Print detailed results
    console.log('\n' + '='.repeat(60));
    console.log(`JITTER MEASUREMENT RESULTS (${surfaceType.toUpperCase()})`);
    console.log('='.repeat(60));

    console.log(`\nTest 1: Hold A (left) - ${leftSamples.length} samples`);
    console.log(`  Y Mean: ${leftMean.toFixed(4)}`);
    console.log(`  Y Range: ${leftMin.toFixed(4)} to ${leftMax.toFixed(4)} (span: ${(leftMax - leftMin).toFixed(4)})`);
    console.log(`  Y Variance: ${leftVariance.toFixed(6)}`);
    console.log(`  Y Std Dev: ${leftStdDev.toFixed(4)}`);

    console.log(`\nTest 2: Hold D (right) - ${rightSamples.length} samples`);
    console.log(`  Y Mean: ${rightMean.toFixed(4)}`);
    console.log(`  Y Range: ${rightMin.toFixed(4)} to ${rightMax.toFixed(4)} (span: ${(rightMax - rightMin).toFixed(4)})`);
    console.log(`  Y Variance: ${rightVariance.toFixed(6)}`);
    console.log(`  Y Std Dev: ${rightStdDev.toFixed(4)}`);

    console.log(`\nTest 3: Alternate A/D - ${alternateSamples.length} samples`);
    console.log(`  Y Mean: ${alternateMean.toFixed(4)}`);
    console.log(`  Y Range: ${alternateMin.toFixed(4)} to ${alternateMax.toFixed(4)} (span: ${(alternateMax - alternateMin).toFixed(4)})`);
    console.log(`  Y Variance: ${alternateVariance.toFixed(6)}`);
    console.log(`  Y Std Dev: ${alternateStdDev.toFixed(4)}`);

    console.log('\n' + '-'.repeat(60));
    console.log('INTERPRETATION');
    console.log('-'.repeat(60));
    console.log('Expected: Variance < 0.05 (minimal jitter)');
    console.log('Problematic: Variance > 0.1 (visible jitter)');

    const maxVariance = Math.max(leftVariance, rightVariance, alternateVariance);
    if (maxVariance > 0.1) {
      console.log(`\n⚠️  JITTER DETECTED: Maximum variance ${maxVariance.toFixed(4)} exceeds threshold 0.1`);
    } else if (maxVariance > 0.05) {
      console.log(`\n⚠️  MINOR JITTER: Maximum variance ${maxVariance.toFixed(4)} exceeds ideal threshold 0.05`);
    } else {
      console.log(`\n✓ NO JITTER: Maximum variance ${maxVariance.toFixed(4)} is within acceptable range`);
    }

    // Sample some position data for pattern analysis
    console.log('\n' + '-'.repeat(60));
    console.log('POSITION SAMPLES (Alternate Test - First 10)');
    console.log('-'.repeat(60));
    for (let i = 0; i < Math.min(10, alternateSamples.length); i++) {
      const s = alternateSamples[i];
      console.log(`  t=${s.time.toFixed(2)}s dir=${s.direction > 0 ? 'D' : 'A'}: (${s.x.toFixed(3)}, ${s.y.toFixed(3)}, ${s.z.toFixed(3)})`);
    }

    await harness.stop();

    return {
      surface: surfaceType,
      leftVariance,
      rightVariance,
      alternateVariance,
      maxVariance,
      leftSamples: leftSamples.length,
      rightSamples: rightSamples.length,
      alternateSamples: alternateSamples.length,
    };

  } catch (error) {
    console.error(`\n❌ Test failed on ${surfaceType}:`, error);
    throw error;
  } finally {
    if (harness) await harness.stop();
  }
}

// Run tests
(async function main() {
  console.log('='.repeat(60));
  console.log('PLAYER JITTER INVESTIGATION');
  console.log('='.repeat(60));
  console.log('Measuring vertical oscillation during horizontal movement');
  console.log('Seed:', SEED);
  console.log('Measurement interval:', MEASUREMENT_INTERVAL, 's');
  console.log('Movement duration per test:', HORIZONTAL_MOVEMENT_DURATION, 's');

  const results = [];

  try {
    // Test on Sphere (simplest geometry)
    const sphereResult = await testJitterOnSurface('sphere');
    results.push(sphereResult);

    // Test on Torus (moderate curvature)
    const torusResult = await testJitterOnSurface('torus');
    results.push(torusResult);

    // Test on Cube (sharp edges, known tangent frame issues)
    const cubeResult = await testJitterOnSurface('cube');
    results.push(cubeResult);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    for (const result of results) {
      console.log(`\n${result.surface.toUpperCase()}:`);
      console.log(`  Max Variance: ${result.maxVariance.toFixed(6)}`);
      console.log(`  Left: ${result.leftVariance.toFixed(6)}`);
      console.log(`  Right: ${result.rightVariance.toFixed(6)}`);
      console.log(`  Alternate: ${result.alternateVariance.toFixed(6)}`);
      console.log(`  Total samples: ${result.leftSamples + result.rightSamples + result.alternateSamples}`);
    }

    const overallMax = Math.max(...results.map(r => r.maxVariance));
    console.log('\n' + '='.repeat(60));
    console.log(`OVERALL MAXIMUM VARIANCE: ${overallMax.toFixed(6)}`);
    if (overallMax > 0.1) {
      console.log('STATUS: ⚠️  SIGNIFICANT JITTER DETECTED');
    } else if (overallMax > 0.05) {
      console.log('STATUS: ⚠️  MINOR JITTER DETECTED');
    } else {
      console.log('STATUS: ✓ NO JITTER');
    }
    console.log('='.repeat(60));

    console.log('\n✅ Investigation complete');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Investigation failed:', error);
    process.exit(1);
  }
})();
