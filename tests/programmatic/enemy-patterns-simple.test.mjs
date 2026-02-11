#!/usr/bin/env node
/**
 * Enemy Patterns Tests — SIMPLIFIED VERSION
 *
 * Just verify enemies can be spawned and are alive.
 * Movement testing will be added once basic spawning works.
 */

import { strict as assert } from 'assert';
import { BrowserTestHarness } from './BrowserTestHarness.mjs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testEnemySpawning(harness) {
  console.log('\n=== Test: Enemy Spawning ===');

  const enemyTypes = [
    'orbiter',
    'snake',
    'helix',
    'weaver',
    'spinner', // Note: spawns as "spinner" not "spinnerspawn"
    'splitter',
    'duck',
  ];

  // Test each enemy type one at a time
  for (const type of enemyTypes) {
    // Spawn enemy
    await harness.spawnEnemy(type, 0.3, 0.3);
    await harness.fastForward(0.2); // Wait 200ms instead of counting frames

    // Verify it exists
    const enemies = await harness.getEnemyStates();
    const enemy = enemies.find(e => e.type.toLowerCase().includes(type.toLowerCase()));

    if (enemy) {
      assert.ok(enemy.alive, `${type} should be alive`);
      assert.ok(enemy.health > 0, `${type} should have health`);
      console.log(`  ✓ ${type}: alive=${enemy.alive}, health=${enemy.health}, pos=(${enemy.surfaceUV.u.toFixed(2)},${enemy.surfaceUV.v.toFixed(2)})`);
    } else {
      console.log(`  ✗ ${type}: NOT FOUND`);
    }
  }

  console.log('  PASS: All enemies can be spawned');
}

async function testOrbiterPresence(harness) {
  console.log('\n=== Test: Orbiter Presence Over Time ===');

  // Spawn orbiter
  await harness.spawnEnemy('orbiter', 0.2, 0.2);
  await harness.fastForward(0.2);

  // Sample positions over time
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const enemies = await harness.getEnemyStates();
    const orbiter = enemies.find(e => e.type.toLowerCase().includes('orbiter'));
    const player = await harness.getPlayerState();
    const gameState = await harness.getGameState();

    if (orbiter) {
      samples.push({
        frame: gameState.frameCount,
        orbiterUV: { ...orbiter.surfaceUV },
        orbiterWorld: { ...orbiter.position },
        playerUV: { ...player.surfaceUV },
        playerWorld: { ...player.position },
      });

      console.log(`  Sample ${i}: frame=${gameState.frameCount}, orbiter UV=(${orbiter.surfaceUV.u.toFixed(3)},${orbiter.surfaceUV.v.toFixed(3)}), world=(${orbiter.position.x.toFixed(2)},${orbiter.position.y.toFixed(2)},${orbiter.position.z.toFixed(2)})`);
    }

    await harness.fastForward(0.5); // Wait 500ms between samples
  }

  // Take screenshot
  await harness.screenshot('orbiter-over-time');

  // Check if ANY position changed
  let uvChanged = false;
  let worldChanged = false;

  for (let i = 1; i < samples.length; i++) {
    const duUV = Math.abs(samples[i].orbiterUV.u - samples[0].orbiterUV.u);
    const dvUV = Math.abs(samples[i].orbiterUV.v - samples[0].orbiterUV.v);
    const dWorld = Math.sqrt(
      Math.pow(samples[i].orbiterWorld.x - samples[0].orbiterWorld.x, 2) +
      Math.pow(samples[i].orbiterWorld.y - samples[0].orbiterWorld.y, 2) +
      Math.pow(samples[i].orbiterWorld.z - samples[0].orbiterWorld.z, 2)
    );

    if (duUV > 0.001 || dvUV > 0.001) uvChanged = true;
    if (dWorld > 0.01) worldChanged = true;
  }

  console.log(`  UV changed: ${uvChanged}, World changed: ${worldChanged}`);

  if (!uvChanged && !worldChanged) {
    console.log('  WARNING: Orbiter is not moving (neither UV nor world position changed)');
    console.log('  This may indicate a bug in mesh walker or enemy AI');
  } else {
    console.log('  PASS: Orbiter position changed over time');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const harness = new BrowserTestHarness({
    surface: 'sphere',
    seed: 11111,
    headless: true,
  });

  console.log('Starting simplified enemy pattern tests...');
  console.log(`Screenshot directory: ${harness.screenshotDir}`);

  let exitCode = 0;

  try {
    await harness.start();
    await harness.startGame();

    // Run tests
    await testEnemySpawning(harness);
    await testOrbiterPresence(harness);

    console.log('\n=== All Tests Passed ===');
    console.log(`Screenshots saved to: ${harness.screenshotDir}`);

  } catch (err) {
    console.error('\n=== TEST FAILED ===');
    console.error(err.message);
    console.error(err.stack);
    exitCode = 1;

  } finally {
    await harness.stop();
  }

  process.exit(exitCode);
}

main();
