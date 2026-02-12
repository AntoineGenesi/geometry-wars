#!/usr/bin/env node
/**
 * Mass Spawn Freeze Investigation
 *
 * Systematically test spawning increasing numbers of enemies to find:
 * - The exact threshold where freezing occurs
 * - Whether it's specific enemy types or total count
 * - Frame count behavior during the freeze
 * - Any console errors or warnings
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

const BASE_SEED = 88888;
const SURFACE = 'sphere';
const HEADLESS = true;

// Enemy types that were reported to cause freeze when spawned together
const PROBLEMATIC_TYPES = [
  'gate', 'spawner', 'gravity_well', 'painter',
  'virus', 'cluster', 'boss_sapphire', 'stealth_stalker', 'mayfly'
];

// Simple enemy types for comparison
const SIMPLE_TYPES = ['grunt', 'wanderer', 'swarm'];

async function testSpawnBatch(enemyTypes, description) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${description}`);
  console.log(`Spawning ${enemyTypes.length} enemies: ${enemyTypes.join(', ')}`);
  console.log('='.repeat(70));

  const harness = new BrowserTestHarness({
    surface: SURFACE,
    seed: BASE_SEED,
    headless: HEADLESS
  });

  try {
    await harness.start();
    await harness.startGame();

    // Wait for game to stabilize
    await harness.waitFrames(30);

    const stateBefore = await harness.getGameState();
    const framesBefore = stateBefore.frameCount;
    console.log(`Frame count before spawn: ${framesBefore}`);

    // Spawn all enemies
    console.log(`Spawning ${enemyTypes.length} enemies...`);
    const spawnStart = Date.now();

    for (let i = 0; i < enemyTypes.length; i++) {
      const type = enemyTypes[i];
      // Distribute in a circle around the player
      const angle = (i / enemyTypes.length) * Math.PI * 2;
      const u = 0.5 + 0.3 * Math.cos(angle);
      const v = 0.5 + 0.3 * Math.sin(angle);

      console.log(`  [${i + 1}/${enemyTypes.length}] Spawning ${type} at UV (${u.toFixed(2)}, ${v.toFixed(2)})`);
      await harness.spawnEnemy(type, u, v);
    }

    const spawnDuration = Date.now() - spawnStart;
    console.log(`All spawns completed in ${spawnDuration}ms`);

    // Check if game is still advancing
    console.log('Checking if game loop is running...');
    const stateAfterSpawn = await harness.getGameState();
    const framesAfterSpawn = stateAfterSpawn.frameCount;
    console.log(`Frame count after spawn: ${framesAfterSpawn}`);

    if (framesAfterSpawn === framesBefore) {
      console.log('⚠️  WARNING: Frame count not advancing immediately after spawn!');
    }

    // Wait and measure frame advancement
    console.log('Waiting 2 seconds to measure frame advancement...');
    const measureStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, 2000));

    const stateAfterWait = await harness.getGameState();
    const framesAfterWait = stateAfterWait.frameCount;
    const measureDuration = Date.now() - measureStart;
    const framesDelta = framesAfterWait - framesAfterSpawn;

    console.log(`Frame count after 2s wait: ${framesAfterWait}`);
    console.log(`Frames advanced: ${framesDelta} in ${measureDuration}ms`);

    if (framesDelta === 0) {
      console.log('❌ FREEZE DETECTED: Frame count did not advance!');

      // Try to get enemy states to see if API is responsive
      try {
        const enemies = await harness.getEnemyStates();
        console.log(`  - API responsive: ${enemies.length} enemies reported`);
      } catch (err) {
        console.log(`  - API unresponsive: ${err.message}`);
      }

      await harness.stop();
      return { frozen: true, count: enemyTypes.length, types: enemyTypes };
    } else {
      const fps = framesDelta / (measureDuration / 1000);
      console.log(`✓ Game running: ~${fps.toFixed(1)} FPS`);

      const enemies = await harness.getEnemyStates();
      console.log(`Enemy count: ${enemies.length}`);

      await harness.stop();
      return { frozen: false, count: enemyTypes.length, fps };
    }

  } catch (err) {
    console.error(`Error during test: ${err.message}`);
    await harness.stop();
    return { error: err.message, count: enemyTypes.length };
  }
}

async function runInvestigation() {
  console.log('MASS SPAWN FREEZE INVESTIGATION');
  console.log(`Surface: ${SURFACE}, Seed: ${BASE_SEED}, Headless: ${HEADLESS}\n`);

  const results = [];

  // Test 1: Spawn simple enemies in increasing batches
  console.log('\n📊 PHASE 1: Simple enemies (grunt, wanderer, swarm)');
  for (let count = 1; count <= 10; count += 2) {
    const types = Array(count).fill(null).map((_, i) => SIMPLE_TYPES[i % SIMPLE_TYPES.length]);
    const result = await testSpawnBatch(types, `${count} simple enemies`);
    results.push(result);

    if (result.frozen) {
      console.log(`\n🔍 Freeze threshold found: ${count} simple enemies`);
      break;
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Test 2: Spawn the exact problematic combination
  console.log('\n📊 PHASE 2: Problematic enemy types (original report)');
  const result = await testSpawnBatch(PROBLEMATIC_TYPES, 'Original 9 problematic types');
  results.push(result);

  // Test 3: Binary search to find exact threshold with problematic types
  if (result.frozen) {
    console.log('\n📊 PHASE 3: Binary search for threshold');
    let low = 1, high = PROBLEMATIC_TYPES.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const types = PROBLEMATIC_TYPES.slice(0, mid);
      const result = await testSpawnBatch(types, `${mid} problematic enemies`);
      results.push(result);

      if (result.frozen) {
        high = mid;
      } else {
        low = mid + 1;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n🎯 Exact freeze threshold: ${low} problematic enemies`);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('INVESTIGATION SUMMARY');
  console.log('='.repeat(70));

  results.forEach((r, i) => {
    const status = r.frozen ? '❌ FROZEN' : r.error ? '⚠️  ERROR' : '✓ OK';
    const detail = r.frozen ? '' : r.error ? ` (${r.error})` : ` (${r.fps?.toFixed(1)} FPS)`;
    console.log(`Test ${i + 1}: ${status} - ${r.count} enemies${detail}`);
  });

  const firstFreeze = results.find(r => r.frozen);
  if (firstFreeze) {
    console.log(`\n🔍 CONCLUSION: Freeze occurs at ${firstFreeze.count} enemies`);
    console.log(`Enemy types: ${firstFreeze.types?.join(', ')}`);
  } else {
    console.log('\n✓ CONCLUSION: No freeze detected in any test');
  }
}

runInvestigation()
  .then(() => {
    console.log('\n✓ Investigation complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Investigation failed:', err);
    process.exit(1);
  });
