#!/usr/bin/env node
/**
 * Quick 9-Enemy Freeze Test
 *
 * Reproduce the exact freeze reported in DISCOVERIES.md:
 * Spawn 9 enemies (Gate, Spawner, GravityWell, Painter, Virus, Cluster, Boss, StealthStalker, Mayfly)
 * and check if the game freezes.
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

const SEED = 88888;
const SURFACE = 'sphere';

// Exact enemy types from DISCOVERIES.md report
const ENEMY_TYPES = [
  'gate', 'spawner', 'gravity_well', 'painter',
  'virus', 'cluster', 'boss_sapphire', 'stealth_stalker', 'mayfly'
];

async function test() {
  console.log('Quick 9-Enemy Freeze Test');
  console.log(`Spawning: ${ENEMY_TYPES.join(', ')}\n`);

  const harness = new BrowserTestHarness({ surface: SURFACE, seed: SEED, headless: true });

  try {
    console.log('[1/5] Starting harness...');
    await harness.start();

    console.log('[2/5] Starting game...');
    await harness.startGame();

    console.log('[3/5] Waiting for game to stabilize...');
    await harness.waitFrames(30);

    const stateBefore = await harness.getGameState();
    console.log(`Frame count before spawn: ${stateBefore.frameCount}`);

    console.log('[4/5] Spawning 9 enemies...');
    const spawnStart = Date.now();

    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const type = ENEMY_TYPES[i];
      const angle = (i / ENEMY_TYPES.length) * Math.PI * 2;
      const u = 0.5 + 0.3 * Math.cos(angle);
      const v = 0.5 + 0.3 * Math.sin(angle);

      console.log(`  Spawning ${i + 1}/9: ${type} at (${u.toFixed(2)}, ${v.toFixed(2)})`);
      await harness.spawnEnemy(type, u, v);
    }

    const spawnDuration = Date.now() - spawnStart;
    console.log(`All 9 enemies spawned in ${spawnDuration}ms`);

    console.log('[5/5] Checking if game loop is still running...');
    const stateAfterSpawn = await harness.getGameState();
    console.log(`Frame count after spawn: ${stateAfterSpawn.frameCount}`);

    // Wait 2 seconds and check if frames are advancing
    console.log('Waiting 2 seconds to measure frame advancement...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const stateAfterWait = await harness.getGameState();
    const framesDelta = stateAfterWait.frameCount - stateAfterSpawn.frameCount;

    console.log(`Frame count after 2s wait: ${stateAfterWait.frameCount}`);
    console.log(`Frames advanced: ${framesDelta}`);

    if (framesDelta === 0) {
      console.log('\n❌ FREEZE CONFIRMED: Frame count did not advance!');
      console.log('The game loop is frozen after spawning 9 enemies.');

      // Try to get more info
      try {
        const enemies = await harness.getEnemyStates();
        console.log(`  Enemy count reported by API: ${enemies.length}`);
      } catch (err) {
        console.log(`  API error: ${err.message}`);
      }
    } else {
      const fps = framesDelta / 2;
      console.log(`\n✓ Game is running: ~${fps.toFixed(1)} FPS`);

      const enemies = await harness.getEnemyStates();
      console.log(`  Enemy count: ${enemies.length}`);
    }

    await harness.screenshot('9-enemy-test');
    await harness.stop();

    return framesDelta === 0;

  } catch (err) {
    console.error(`\nError: ${err.message}`);
    console.error(err.stack);
    await harness.stop();
    throw err;
  }
}

test()
  .then(frozen => {
    if (frozen) {
      console.log('\n🔍 RESULT: Freeze reproduced!');
      process.exit(1); // Exit with error to signal freeze detected
    } else {
      console.log('\n✓ RESULT: No freeze detected');
      process.exit(0);
    }
  })
  .catch(err => {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  });
