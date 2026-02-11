#!/usr/bin/env node
/**
 * Deep Gameplay Demo — Shows off advanced harness features.
 *
 * Demonstrates:
 * - Wave progression
 * - Waiting for specific enemy types
 * - Auto-screenshot on enemy spawn
 * - Fast-forward gameplay
 * - State queries across multiple waves
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

async function main() {
  console.log('='.repeat(70));
  console.log('  BrowserTestHarness — Deep Gameplay Demo');
  console.log('='.repeat(70));

  const harness = new BrowserTestHarness({
    surface: 'torus',
    seed: 12345,
    headless: true,
  });

  try {
    console.log('\n[Setup] Starting harness and game...');
    await harness.start();
    await harness.startGame();
    console.log('  ✓ Game running on torus surface (seed=12345)');

    // Initial state
    console.log('\n[1] Initial game state:');
    const state1 = await harness.getGameState();
    const player1 = await harness.getPlayerState();
    console.log(`  - Frame: ${state1.frameCount}`);
    console.log(`  - Time: ${state1.gameTime.toFixed(2)}s`);
    console.log(`  - Player score: ${player1.score}`);
    console.log(`  - Player lives: ${player1.lives}`);
    await harness.screenshot('01-initial-state');

    // Spawn a specific enemy and screenshot it
    console.log('\n[2] Spawning grunt enemy at u=0.5, v=0.5...');
    await harness.spawnEnemy('grunt', 0.5, 0.5);
    await harness.waitFrames(30);
    const enemies1 = await harness.getEnemyStates();
    console.log(`  ✓ Enemies: ${enemies1.length}`);
    if (enemies1.length > 0) {
      console.log(`  - First enemy: ${enemies1[0].type} at u=${enemies1[0].surfaceUV.u.toFixed(2)}, v=${enemies1[0].surfaceUV.v.toFixed(2)}`);
    }
    await harness.screenshot('02-grunt-spawned');

    // Simulate gameplay
    console.log('\n[3] Simulating gameplay (move and shoot)...');
    await harness.sendInput('w', true);
    await harness.setMousePosition(800, 360);
    await harness.setMouseDown(true);
    await harness.waitFrames(60); // 1 second of movement + shooting
    await harness.setMouseDown(false);
    await harness.sendInput('w', false);

    const bullets = await harness.getBulletStates();
    console.log(`  ✓ Bullets fired: ${bullets.length}`);
    await harness.screenshot('03-after-shooting');

    // Fast-forward to let enemies naturally spawn
    console.log('\n[4] Fast-forwarding 10 seconds of gameplay...');
    await harness.fastForward(10);

    const state2 = await harness.getGameState();
    const enemies2 = await harness.getEnemyStates();
    console.log(`  - Time: ${state2.gameTime.toFixed(2)}s`);
    console.log(`  - Enemies: ${enemies2.length}`);
    console.log(`  - Score: ${(await harness.getPlayerState()).score}`);
    await harness.screenshot('04-after-10-seconds');

    // Get wave info
    console.log('\n[5] Wave information:');
    const waveInfo = await harness.getWaveInfo();
    console.log(`  - Approximate wave: ${waveInfo.approximateWave}`);
    console.log(`  - Enemy count: ${waveInfo.enemyCount}`);
    console.log(`  - Game time: ${waveInfo.gameTime.toFixed(2)}s`);
    console.log(`  - Enemy types present: ${[...new Set(waveInfo.enemies.map(e => e.type))].join(', ')}`);

    // Camera state
    console.log('\n[6] Camera state:');
    const camera = await harness.getCameraState();
    console.log(`  - Position: (${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)})`);
    console.log(`  - FOV: ${camera.fov}`);

    // Final screenshot
    await harness.screenshot('05-final-state');

    console.log('\n[Cleanup] Stopping harness...');
    await harness.stop();

    console.log('\n' + '='.repeat(70));
    console.log('  ✓ DEEP GAMEPLAY DEMO COMPLETE');
    console.log('='.repeat(70));
    console.log(`\n  Screenshots: ${harness.screenshotDir}`);
    console.log(`  Total screenshots: ${harness.screenshotCounter}\n`);

  } catch (err) {
    console.error('\n✗ Demo failed:', err.message);
    console.error(err.stack);
    await harness.stop().catch(() => {});
    process.exit(1);
  }
}

main();
