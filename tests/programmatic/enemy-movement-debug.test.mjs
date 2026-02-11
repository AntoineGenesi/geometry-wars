#!/usr/bin/env node
/**
 * Debug: Why aren't enemies moving?
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

const harness = new BrowserTestHarness({
  surface: 'sphere',
  seed: 99999,
  headless: true,
});

async function run() {
  await harness.start();
  await harness.startGame();
  await harness.waitFrames(30);

  console.log('=== Spawning grunt at (0.3, 0.3) ===');
  await harness.spawnEnemy('grunt', 0.3, 0.3);
  await harness.waitFrames(10);

  const enemies1 = await harness.getEnemyStates();
  console.log(`Enemy count: ${enemies1.length}`);
  const grunt1 = enemies1.find(e => e.position.x < 10 && e.position.z < 10); // Find our newly spawned grunt
  if (grunt1) {
    console.log(`Grunt initial position: (${grunt1.surfaceUV.u.toFixed(4)}, ${grunt1.surfaceUV.v.toFixed(4)})`);
    console.log(`Grunt world position: (${grunt1.position.x.toFixed(4)}, ${grunt1.position.y.toFixed(4)}, ${grunt1.position.z.toFixed(4)})`);
  } else {
    console.log('No grunt found near spawn position!');
  }

  console.log('\n=== Waiting 60 frames ===');
  await harness.waitFrames(60);

  const enemies2 = await harness.getEnemyStates();
  const grunt2 = enemies2.find(e => e.position.x < 10 && e.position.z < 10);
  if (grunt2) {
    console.log(`Grunt final position: (${grunt2.surfaceUV.u.toFixed(4)}, ${grunt2.surfaceUV.v.toFixed(4)})`);
    console.log(`Grunt world position: (${grunt2.position.x.toFixed(4)}, ${grunt2.position.y.toFixed(4)}, ${grunt2.position.z.toFixed(4)})`);

    const du = grunt2.surfaceUV.u - grunt1.surfaceUV.u;
    const dv = grunt2.surfaceUV.v - grunt1.surfaceUV.v;
    const movement = Math.sqrt(du * du + dv * dv);
    console.log(`Movement: ${movement.toFixed(6)} UV units`);
  } else {
    console.log('Grunt disappeared!');
  }

  // Check if walker mode is active
  const walkersActive = await harness.page.evaluate(() => {
    const enemies = window.__gameDebug.enemySpawner.getEnemies();
    return enemies.map(e => ({
      type: e.constructor.name,
      hasWalker: !!e.walker,
      walkerPos: e.walker ? { x: e.walker.position.x, y: e.walker.position.y, z: e.walker.position.z } : null,
    }));
  });
  console.log('\nWalker status:', JSON.stringify(walkersActive, null, 2));

  await harness.stop();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
