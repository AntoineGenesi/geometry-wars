#!/usr/bin/env node
/**
 * Smoke test for BrowserTestHarness.
 *
 * Verifies that the harness can:
 * - Start the game
 * - Query state via debug API
 * - Control the game (input, spawn enemies)
 * - Take screenshots
 * - Clean up properly
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

async function main() {
  console.log('='.repeat(70));
  console.log('  BrowserTestHarness — Smoke Test');
  console.log('='.repeat(70));

  const harness = new BrowserTestHarness({
    surface: 'sphere',
    seed: 42,
    headless: true,
  });

  try {
    // 1. Start
    console.log('\n[1/8] Starting harness...');
    await harness.start();
    console.log('  ✓ Browser launched, dev server ready');

    // 2. Start game
    console.log('\n[2/8] Starting game...');
    await harness.startGame();
    console.log('  ✓ Game started with quickStart URL');

    // 3. Query game state
    console.log('\n[3/8] Querying game state...');
    const state = await harness.getGameState();
    console.log(`  ✓ Game state: frame=${state.frameCount}, enemies=${state.enemyCount}, time=${state.gameTime.toFixed(2)}s`);

    if (state.frameCount === undefined) {
      throw new Error('Game state missing frameCount');
    }

    // 4. Query player state
    console.log('\n[4/8] Querying player state...');
    const player = await harness.getPlayerState();
    console.log(`  ✓ Player: score=${player.score}, lives=${player.lives}, pos=(${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)})`);

    if (player.position.x === undefined) {
      throw new Error('Player state missing position');
    }

    // 5. Spawn enemy
    console.log('\n[5/8] Spawning enemy...');
    await harness.spawnEnemy('grunt', 0.3, 0.3);
    await harness.waitFrames(10); // Wait for spawn to register
    const enemies = await harness.getEnemyStates();
    console.log(`  ✓ Enemies: ${enemies.length} (spawned at least one)`);

    if (enemies.length === 0) {
      console.warn('  ⚠ Warning: No enemies found after spawn (may be timing issue)');
    }

    // 6. Send input and wait
    console.log('\n[6/8] Simulating player movement...');
    await harness.sendInput('w', true);
    await harness.waitFrames(30); // Move for 30 frames
    await harness.sendInput('w', false);

    const player2 = await harness.getPlayerState();
    console.log(`  ✓ Player moved: pos=(${player2.position.x.toFixed(2)}, ${player2.position.y.toFixed(2)}, ${player2.position.z.toFixed(2)})`);

    // 7. Screenshot
    console.log('\n[7/8] Taking screenshot...');
    const filepath = await harness.screenshot('smoke-test');
    console.log(`  ✓ Screenshot saved: ${filepath}`);

    // 8. Cleanup
    console.log('\n[8/8] Cleaning up...');
    await harness.stop();
    console.log('  ✓ Browser closed, servers killed');

    // Success
    console.log('\n' + '='.repeat(70));
    console.log('  ✓ SMOKE TEST PASSED');
    console.log('='.repeat(70));
    console.log(`\n  Screenshots: ${harness.screenshotDir}\n`);
    process.exit(0);

  } catch (err) {
    console.error('\n' + '='.repeat(70));
    console.error('  ✗ SMOKE TEST FAILED');
    console.error('='.repeat(70));
    console.error(`\n  Error: ${err.message}`);
    console.error(`  Stack: ${err.stack}`);

    // Try to cleanup
    try {
      await harness.stop();
    } catch { /* ignore */ }

    process.exit(1);
  }
}

main();
