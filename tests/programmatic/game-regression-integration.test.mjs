#!/home/antoine/.nvm/versions/node/v20.19.5/bin/node
/**
 * Game Regression Integration Test (S12)
 *
 * Verifies all 3 critical fixes work together:
 * 1. Collision freeze fix - game doesn't freeze when bullets hit enemies
 * 2. Enemy UV sync fix - enemy UV coordinates update correctly during movement
 * 3. Player UV/Walker sync fix - no position discontinuities during movement
 *
 * This integration test ensures fixes don't conflict or regress when combined.
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

const SEED = 12345;
const TEST_DURATION = 60; // 60 seconds wall-clock time
const SAMPLE_INTERVAL = 0.5; // Sample every 500ms

/**
 * Calculate position deltas between consecutive samples
 * Returns array of distances between consecutive positions
 */
function calculatePositionDeltas(samples) {
  const deltas = [];
  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i-1].x;
    const dy = samples[i].y - samples[i-1].y;
    const dz = samples[i].z - samples[i-1].z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    deltas.push(distance);
  }
  return deltas;
}

/**
 * Check for position discontinuities (sudden large jumps)
 * Returns true if no large jumps detected
 *
 * At SAMPLE_INTERVAL=0.5s and player speed ~5-10 units/sec:
 * - Expected movement per sample: 2.5 - 5.0 units
 * - Threshold for "jump": 10 units (2x max expected movement)
 */
function checkSmoothMovement(deltas, maxDelta = 10.0) {
  const largeJumps = deltas.filter(d => d > maxDelta);
  return {
    smooth: largeJumps.length === 0,
    maxDelta: Math.max(...deltas),
    jumpCount: largeJumps.length,
  };
}

/**
 * Run comprehensive integration test
 */
async function runIntegrationTest() {
  console.log('='.repeat(70));
  console.log('GAME REGRESSION INTEGRATION TEST (S12)');
  console.log('='.repeat(70));
  console.log('Testing all 3 fixes together for 60 seconds:');
  console.log('  1. Collision freeze fix');
  console.log('  2. Enemy UV sync fix');
  console.log('  3. Player UV/Walker sync fix');
  console.log('='.repeat(70));

  const harness = new BrowserTestHarness({
    surfaceType: 'sphere',
    seed: SEED,
    cameraDistance: 20,
  });

  try {
    // Setup
    console.log('\n[Setup] Starting game...');
    await harness.start();
    await harness.startGame();

    // Teleport player to center
    await harness.page.evaluate(() => window.__gameDebug.teleportPlayer(0.5, 0.5));
    await harness.waitFrames(10);

    // Spawn test enemies
    console.log('[Setup] Spawning 5 enemies (grunt, wanderer, orbiter, rocket, mayfly)...');
    await harness.spawnEnemy('grunt', 0.3, 0.3);
    await harness.spawnEnemy('wanderer', 0.4, 0.6);
    await harness.spawnEnemy('orbiter', 0.6, 0.4);
    await harness.spawnEnemy('rocket', 0.7, 0.7);
    await harness.spawnEnemy('mayfly', 0.5, 0.7);
    await harness.waitFrames(5);

    console.log('[Setup] Starting movement + auto-fire...');

    // Enable circular movement (A/D alternating) and auto-fire
    await harness.sendInput('fire', true);

    // Data collection
    const frameSamples = [];
    const playerPosSamples = [];
    const enemyUVSamples = [];
    const timestamps = [];

    const startTime = performance.now();
    let lastSampleTime = startTime;
    let currentKey = 'a';
    let switchTime = startTime;
    const switchInterval = 2000; // Switch A/D every 2 seconds

    console.log('\n[Test] Running for 60 seconds...');

    // Main test loop
    while ((performance.now() - startTime) / 1000 < TEST_DURATION) {
      const elapsed = performance.now() - startTime;

      // Switch A/D keys periodically for circular movement
      if (elapsed - (switchTime - startTime) >= switchInterval) {
        await harness.sendInput(currentKey, false);
        currentKey = currentKey === 'a' ? 'd' : 'a';
        await harness.sendInput(currentKey, true);
        switchTime = performance.now();
      }

      // Sample game state
      const elapsed_sec = elapsed / 1000;
      if (elapsed - (lastSampleTime - startTime) >= SAMPLE_INTERVAL * 1000) {
        const playerState = await harness.getPlayerState();
        const enemyStates = await harness.getEnemyStates();
        const gameState = await harness.page.evaluate(() => {
          return window.__gameDebug.getGameState();
        });

        frameSamples.push(gameState.frameCount);
        playerPosSamples.push(playerState.position);
        timestamps.push(elapsed_sec);

        // Track first enemy's UV for sync verification
        if (enemyStates.length > 0 && enemyStates[0].surfaceUV) {
          enemyUVSamples.push({
            u: enemyStates[0].surfaceUV.u,
            v: enemyStates[0].surfaceUV.v,
          });
        }

        // Progress indicator every 10 seconds
        if (Math.floor(elapsed_sec) % 10 === 0 && Math.abs(elapsed_sec - Math.floor(elapsed_sec)) < 0.5) {
          console.log(`  [${Math.floor(elapsed_sec)}s] frame=${gameState.frameCount}, enemies=${enemyStates.length}`);
        }

        lastSampleTime = performance.now();
      }

      // Advance time
      await harness.fastForward(0.1);
    }

    // Stop movement and firing
    await harness.sendInput(currentKey, false);
    await harness.sendInput('fire', false);

    console.log('\n[Test] 60 seconds complete. Analyzing results...');

    // ========================================================================
    // ANALYSIS 1: Collision Freeze Check
    // ========================================================================
    const frameIncreasing = frameSamples.every((f, i) => i === 0 || f > frameSamples[i-1]);
    const finalFrame = frameSamples[frameSamples.length - 1];
    const initialFrame = frameSamples[0];
    const frameAdvancement = finalFrame - initialFrame;

    console.log('\n' + '='.repeat(70));
    console.log('RESULT 1: COLLISION FREEZE');
    console.log('='.repeat(70));
    console.log(`  Initial frame: ${initialFrame}`);
    console.log(`  Final frame: ${finalFrame}`);
    console.log(`  Frame advancement: ${frameAdvancement} frames`);
    console.log(`  Continuous advancement: ${frameIncreasing ? 'YES ✓' : 'NO ✗'}`);

    const collisionFreezeFixed = frameIncreasing && frameAdvancement > 300;
    console.log(`  Status: ${collisionFreezeFixed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  ${collisionFreezeFixed ? 'No freeze detected during bullet-enemy collisions' : 'Frame count stalled or regressed'}`);

    // ========================================================================
    // ANALYSIS 2: Enemy UV Sync Check
    // ========================================================================
    const initialUV = enemyUVSamples[0];
    const finalUV = enemyUVSamples[enemyUVSamples.length - 1];
    const deltaU = Math.abs(finalUV.u - initialUV.u);
    const deltaV = Math.abs(finalUV.v - initialUV.v);
    const totalUVChange = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    console.log('\n' + '='.repeat(70));
    console.log('RESULT 2: ENEMY UV SYNC');
    console.log('='.repeat(70));
    console.log(`  Initial UV: (${initialUV.u.toFixed(3)}, ${initialUV.v.toFixed(3)})`);
    console.log(`  Final UV: (${finalUV.u.toFixed(3)}, ${finalUV.v.toFixed(3)})`);
    console.log(`  Total UV change: ${totalUVChange.toFixed(3)} units`);

    const enemyUVFixed = totalUVChange > 0.05;
    console.log(`  Status: ${enemyUVFixed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  ${enemyUVFixed ? 'Enemy UV coordinates updated correctly' : 'Enemy UV coordinates did not update'}`);

    // ========================================================================
    // ANALYSIS 3: Player Movement Smoothness (UV/Walker Sync)
    // ========================================================================
    const posDeltas = calculatePositionDeltas(playerPosSamples);
    const smoothness = checkSmoothMovement(posDeltas, 10.0);

    console.log('\n' + '='.repeat(70));
    console.log('RESULT 3: PLAYER MOVEMENT SMOOTHNESS');
    console.log('='.repeat(70));
    console.log(`  Position samples: ${playerPosSamples.length}`);
    console.log(`  Max position delta: ${smoothness.maxDelta.toFixed(3)} units`);
    console.log(`  Large jumps (>10.0 units): ${smoothness.jumpCount}`);
    console.log(`  Smooth movement: ${smoothness.smooth ? 'YES ✓' : 'NO ✗'}`);

    const playerMovementFixed = smoothness.smooth;
    console.log(`  Status: ${playerMovementFixed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  ${playerMovementFixed ? 'No position discontinuities detected' : 'Position jumps detected - UV/Walker desync likely'}`);

    // ========================================================================
    // FINAL VERDICT
    // ========================================================================
    console.log('\n' + '='.repeat(70));
    console.log('INTEGRATION TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`  [1/3] Collision Freeze: ${collisionFreezeFixed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  [2/3] Enemy UV Sync: ${enemyUVFixed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  [3/3] Player Movement: ${playerMovementFixed ? '✓ PASS' : '✗ FAIL'}`);
    console.log('='.repeat(70));

    const allPassed = collisionFreezeFixed && enemyUVFixed && playerMovementFixed;

    if (allPassed) {
      console.log('\n✅ INTEGRATION TEST PASSED');
      console.log('   All 3 fixes verified working together without regression.');
      console.log('   Game is playable for extended sessions without freeze or jitter.');
    } else {
      console.log('\n❌ INTEGRATION TEST FAILED');
      console.log('   One or more fixes did not work as expected.');
      console.log('   Review individual test results above for details.');
    }

    console.log('\n' + '='.repeat(70));

    await harness.stop();

    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    if (harness) await harness.stop();
    process.exit(1);
  }
}

// Run test
runIntegrationTest();
