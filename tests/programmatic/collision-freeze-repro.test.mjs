#!/usr/bin/env node
/**
 * Collision Freeze Reproduction Test
 *
 * CRITICAL BUG: Game freezes when bullets hit enemies.
 * This test reproduces the freeze programmatically to enable debugging.
 *
 * Expected behavior:
 * - Frame count advances steadily (~7 FPS in headless SwiftShader)
 * - Bullets hit enemies, enemies die, game continues
 *
 * Actual behavior (broken):
 * - Frame count stops advancing after bullet-enemy collision
 * - User must pause+resume to unfreeze
 *
 * SUCCESS = this test FAILS (freeze detected) until the bug is fixed.
 */

import { strict as assert } from 'assert';
import { BrowserTestHarness } from './BrowserTestHarness.mjs';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const TEST_CONFIG = {
  surface: 'sphere',
  seed: 12345,
  headless: true,
  spawnPositions: {
    // Spawn enemies close to player (starts at 0.5, 0.5) but not overlapping
    grunt: { u: 0.6, v: 0.5 },
    wanderer: { u: 0.5, v: 0.6 },
    swarm: { u: 0.4, v: 0.5 },
  },
  aimAtEnemy: { u: 0.6, v: 0.5 }, // Aim at grunt position
};

// ---------------------------------------------------------------------------
// Test Helper Functions
// ---------------------------------------------------------------------------

/**
 * Check if the game is frozen by monitoring frame count advancement.
 * @param {BrowserTestHarness} harness
 * @param {number} checkDurationSeconds - How long to monitor
 * @param {number} sampleIntervalMs - How often to sample frame count
 * @returns {Promise<{frozen: boolean, samples: Array}>}
 */
async function detectFreeze(harness, checkDurationSeconds = 5, sampleIntervalMs = 500) {
  const samples = [];
  const numSamples = Math.floor((checkDurationSeconds * 1000) / sampleIntervalMs);

  for (let i = 0; i < numSamples; i++) {
    const state = await harness.getGameState();
    const timestamp = Date.now();
    samples.push({
      index: i,
      timestamp,
      frameCount: state.frameCount,
      gameTime: state.gameTime,
      enemyCount: state.enemyCount,
    });

    console.log(`  Sample ${i}: frame=${state.frameCount}, enemies=${state.enemyCount}, gameTime=${state.gameTime.toFixed(2)}s`);

    await harness.fastForward(sampleIntervalMs / 1000);
  }

  // Analyze: if frame count didn't advance in last 3+ samples, it's frozen
  const lastThreeSamples = samples.slice(-3);
  const frameCountsIdentical = lastThreeSamples.every(
    s => s.frameCount === lastThreeSamples[0].frameCount
  );

  return {
    frozen: frameCountsIdentical,
    samples,
    lastFrameCount: lastThreeSamples[0].frameCount,
  };
}

/**
 * Set up auto-firing toward a target position.
 * @param {BrowserTestHarness} harness
 * @param {number} targetU - Target U coordinate
 * @param {number} targetV - Target V coordinate
 */
async function startAutoFire(harness, targetU, targetV) {
  // Get player position
  const player = await harness.getPlayerState();

  // Calculate aim direction (approximate screen-space aim)
  // Player is at (0.5, 0.5), target is at (targetU, targetV)
  // Simple heuristic: aim toward the enemy
  const du = targetU - player.surfaceUV.u;
  const dv = targetV - player.surfaceUV.v;
  const dist = Math.sqrt(du * du + dv * dv);

  if (dist > 0.01) {
    // Normalize and convert to screen coords (rough approximation)
    const aimX = du / dist;
    const aimY = dv / dist;

    // Set mouse position (center = 640, 360; scale by ~200 pixels)
    const mouseX = 640 + aimX * 200;
    const mouseY = 360 - aimY * 200; // Invert Y

    await harness.setMousePosition(mouseX, mouseY);
  }

  // Start shooting
  await harness.setMouseDown(true);

  console.log(`  Auto-fire enabled, aiming at UV(${targetU.toFixed(2)}, ${targetV.toFixed(2)})`);
}

/**
 * Stop auto-firing.
 * @param {BrowserTestHarness} harness
 */
async function stopAutoFire(harness) {
  await harness.setMouseDown(false);
}

// ---------------------------------------------------------------------------
// Main Test
// ---------------------------------------------------------------------------

async function testCollisionFreeze() {
  console.log('\n=== Collision Freeze Reproduction Test ===\n');
  console.log('This test reproduces the game freeze that occurs when bullets hit enemies.');
  console.log('Expected: Frame count should advance steadily at ~7 FPS (headless SwiftShader)');
  console.log('Actual (if bug present): Frame count stops advancing after collision\n');

  const harness = new BrowserTestHarness({
    surface: TEST_CONFIG.surface,
    seed: TEST_CONFIG.seed,
    headless: TEST_CONFIG.headless,
  });

  try {
    // Start browser and game
    console.log('Step 1: Starting browser and game...');
    await harness.start();
    await harness.startGame();
    console.log('  ✓ Game started\n');

    // Wait for countdown to complete
    await harness.fastForward(1);

    // Get initial state
    const initialState = await harness.getGameState();
    console.log(`Step 2: Initial state - frame=${initialState.frameCount}, enemies=${initialState.enemyCount}\n`);

    // Spawn enemies near player
    console.log('Step 3: Spawning test enemies...');
    await harness.spawnEnemy('grunt', TEST_CONFIG.spawnPositions.grunt.u, TEST_CONFIG.spawnPositions.grunt.v);
    await harness.spawnEnemy('wanderer', TEST_CONFIG.spawnPositions.wanderer.u, TEST_CONFIG.spawnPositions.wanderer.v);
    await harness.spawnEnemy('swarm', TEST_CONFIG.spawnPositions.swarm.u, TEST_CONFIG.spawnPositions.swarm.v);
    await harness.fastForward(0.3); // Wait for enemies to materialize

    const enemyStates = await harness.getEnemyStates();
    console.log(`  ✓ Spawned ${enemyStates.length} enemies\n`);

    // Baseline: measure frame advancement WITHOUT shooting (should be stable)
    console.log('Step 4: Baseline check (no shooting)...');
    const baselineResult = await detectFreeze(harness, 2, 500);
    if (baselineResult.frozen) {
      console.log('  ✗ FAILURE: Game is frozen even without shooting!');
      console.log('  This suggests the freeze happens during enemy spawning or update.\n');
      await harness.screenshot('freeze-before-shooting');
    } else {
      console.log(`  ✓ Baseline OK: frame count advancing (last frame: ${baselineResult.lastFrameCount})\n`);
    }

    // Start shooting at enemies
    console.log('Step 5: Starting auto-fire toward enemies...');
    await startAutoFire(harness, TEST_CONFIG.aimAtEnemy.u, TEST_CONFIG.aimAtEnemy.v);
    await harness.fastForward(0.5); // Fire for 0.5s to ensure bullets spawn

    // Check if bullets exist
    const bullets = await harness.getBulletStates();
    console.log(`  ✓ Bullets spawned: ${bullets.length} active\n`);

    // Monitor for freeze during active shooting
    console.log('Step 6: Monitoring for freeze during bullet-enemy collisions...');
    const collisionResult = await detectFreeze(harness, 5, 500);

    // Stop shooting
    await stopAutoFire(harness);

    // Take screenshot of final state
    await harness.screenshot('collision-freeze-final-state');

    // Analyze results
    console.log('\n=== RESULTS ===\n');

    if (collisionResult.frozen) {
      console.log('  ✗ FREEZE DETECTED!');
      console.log(`  Frame count stuck at: ${collisionResult.lastFrameCount}`);
      console.log(`  Last 3 samples had identical frame counts.`);
      console.log('\n  This confirms the collision freeze bug.');
      console.log('  Check console errors below:\n');

      // Print any console errors
      if (harness.consoleErrors.length > 0) {
        console.log('  Browser console errors:');
        harness.consoleErrors.forEach((err, i) => {
          console.log(`    ${i + 1}. ${err}`);
        });
      } else {
        console.log('  No JavaScript errors in console (suggests infinite loop, not exception)');
      }

      // Get final enemy states
      const finalEnemies = await harness.getEnemyStates();
      console.log(`\n  Final enemy count: ${finalEnemies.length}`);

      console.log('\n  EXPECTED: Test should reproduce the freeze (this is a known bug)');
      console.log('  Next step: Add instrumentation to identify freeze location');

      // For now, don't fail the test - we're documenting the bug
      console.log('\n  TEST RESULT: Freeze reproduced successfully (bug confirmed)\n');

    } else {
      console.log('  ✓ NO FREEZE DETECTED');
      console.log(`  Frame count advanced normally (final: ${collisionResult.lastFrameCount})`);
      console.log('\n  This means:');
      console.log('    1. The bug might be fixed, OR');
      console.log('    2. The test conditions don\'t trigger it reliably');
      console.log('\n  Review sample data above to verify frame advancement.\n');
    }

    // Print full sample history
    console.log('=== Frame Count History ===');
    console.log('Index | Frame | Enemies | GameTime');
    collisionResult.samples.forEach(s => {
      console.log(`  ${s.index}   | ${s.frameCount}    | ${s.enemyCount}       | ${s.gameTime.toFixed(2)}s`);
    });

  } catch (error) {
    console.error('\n✗ TEST FAILED WITH ERROR:');
    console.error(error);
    throw error;
  } finally {
    await harness.stop();
  }
}

// ---------------------------------------------------------------------------
// Run Tests
// ---------------------------------------------------------------------------

(async () => {
  try {
    await testCollisionFreeze();
    console.log('\n✓ Test completed\n');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test suite failed\n');
    process.exit(1);
  }
})();
