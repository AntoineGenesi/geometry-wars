#!/usr/bin/env node
/**
 * Enemy Special Abilities Test Suite
 *
 * Tests unique behaviors of special enemies using BrowserTestHarness.
 * Spawns all enemies at once to avoid repeated clear/spawn cycles.
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';
import assert from 'assert';

const SEED = 99999;
const SURFACE = 'sphere';
const HEADLESS = true;

function uvDistance(u1, v1, u2, v2) {
  const du = u2 - u1;
  const dv = v2 - v1;
  return Math.sqrt(du * du + dv * dv);
}

function findEnemyByType(enemies, typePattern) {
  return enemies.find(e => e.type.toLowerCase().includes(typePattern.toLowerCase()));
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('ENEMY SPECIAL ABILITIES TEST SUITE');
  console.log('='.repeat(70));
  console.log(`Surface: ${SURFACE}, Seed: ${SEED}, Headless: ${HEADLESS}\n`);

  const harness = new BrowserTestHarness({ surface: SURFACE, seed: SEED, headless: HEADLESS });

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    // Spawn all test enemies at once in different positions
    console.log('Spawning all test enemies...\n');
    await harness.spawnEnemy('gate', 0.1, 0.1);
    await harness.spawnEnemy('spawner', 0.2, 0.2);
    await harness.spawnEnemy('gravity_well', 0.3, 0.3);
    await harness.spawnEnemy('painter', 0.4, 0.4);
    await harness.spawnEnemy('virus', 0.5, 0.5);
    await harness.spawnEnemy('cluster', 0.6, 0.6);
    await harness.spawnEnemy('boss_sapphire', 0.7, 0.7);
    await harness.spawnEnemy('stealth_stalker', 0.8, 0.8);
    await harness.spawnEnemy('mayfly', 0.9, 0.9);

    await harness.waitFrames(10);

    // Get initial states
    const initial = await harness.getEnemyStates();
    console.log(`Total enemies spawned: ${initial.length}\n`);

    // ---------------------------------------------------------------------------
    // Test 1: Gate - Stationary
    // ---------------------------------------------------------------------------
    console.log('[TEST 1] Gate - Stationary Behavior');
    try {
      const gate1 = findEnemyByType(initial, 'gate');
      assert(gate1, 'Gate should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const gate2 = findEnemyByType(enemies2, 'gate');
      assert(gate2, 'Gate should still exist');

      const drift = uvDistance(gate1.surfaceUV.u, gate1.surfaceUV.v, gate2.surfaceUV.u, gate2.surfaceUV.v);
      console.log(`  Drift: ${drift.toFixed(6)} UV units`);
      assert(drift < 0.001, `Gate should be stationary (drift: ${drift})`);

      await harness.screenshot('gate-stationary');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 2: Painter - Movement
    // ---------------------------------------------------------------------------
    console.log('[TEST 2] Painter - Random Movement');
    try {
      const painter1 = findEnemyByType(initial, 'painter');
      assert(painter1, 'Painter should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const painter2 = findEnemyByType(enemies2, 'painter');
      assert(painter2, 'Painter should still exist');

      const movement = uvDistance(painter1.surfaceUV.u, painter1.surfaceUV.v, painter2.surfaceUV.u, painter2.surfaceUV.v);
      console.log(`  Movement: ${movement.toFixed(6)} UV units`);
      assert(movement > 0.01, `Painter should move (movement: ${movement})`);

      await harness.screenshot('painter-movement');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 3: Virus - Random Drift
    // ---------------------------------------------------------------------------
    console.log('[TEST 3] Virus - Random Drift');
    try {
      const virus1 = findEnemyByType(initial, 'virus');
      assert(virus1, 'Virus should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const virus2 = findEnemyByType(enemies2, 'virus');
      assert(virus2, 'Virus should still exist');

      const movement = uvDistance(virus1.surfaceUV.u, virus1.surfaceUV.v, virus2.surfaceUV.u, virus2.surfaceUV.v);
      console.log(`  Movement: ${movement.toFixed(6)} UV units`);
      assert(movement > 0.001, `Virus should drift (movement: ${movement})`);

      await harness.screenshot('virus-drift');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 4: Cluster - Slow Chase
    // ---------------------------------------------------------------------------
    console.log('[TEST 4] Cluster - Slow Chase');
    try {
      const cluster1 = findEnemyByType(initial, 'cluster');
      assert(cluster1, 'Cluster should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const cluster2 = findEnemyByType(enemies2, 'cluster');
      assert(cluster2, 'Cluster should still exist');

      const movement = uvDistance(cluster1.surfaceUV.u, cluster1.surfaceUV.v, cluster2.surfaceUV.u, cluster2.surfaceUV.v);
      console.log(`  Movement: ${movement.toFixed(6)} UV units`);
      assert(movement > 0.001, `Cluster should chase (movement: ${movement})`);

      await harness.screenshot('cluster-chase');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 5: Boss - Existence & Movement
    // ---------------------------------------------------------------------------
    console.log('[TEST 5] Boss - Existence & Movement');
    try {
      const boss1 = findEnemyByType(initial, 'boss');
      assert(boss1, 'Boss should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const boss2 = findEnemyByType(enemies2, 'boss');
      assert(boss2, 'Boss should still exist');

      const movement = uvDistance(boss1.surfaceUV.u, boss1.surfaceUV.v, boss2.surfaceUV.u, boss2.surfaceUV.v);
      console.log(`  Movement: ${movement.toFixed(6)} UV units`);
      assert(movement > 0.001, `Boss should move (movement: ${movement})`);

      await harness.screenshot('boss-movement');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 6: StealthStalker - Approach
    // ---------------------------------------------------------------------------
    console.log('[TEST 6] StealthStalker - Approach Behavior');
    try {
      const stalker1 = findEnemyByType(initial, 'stealth');
      assert(stalker1, 'StealthStalker should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const stalker2 = findEnemyByType(enemies2, 'stealth');
      assert(stalker2, 'StealthStalker should still exist');

      const movement = uvDistance(stalker1.surfaceUV.u, stalker1.surfaceUV.v, stalker2.surfaceUV.u, stalker2.surfaceUV.v);
      console.log(`  Movement: ${movement.toFixed(6)} UV units`);
      assert(movement > 0.001, `StealthStalker should approach (movement: ${movement})`);

      await harness.screenshot('stealthstalker-approach');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 7: Mayfly - Chase
    // ---------------------------------------------------------------------------
    console.log('[TEST 7] Mayfly - Chase Behavior');
    try {
      const mayfly1 = findEnemyByType(initial, 'mayfly');
      assert(mayfly1, 'Mayfly should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const mayfly2 = findEnemyByType(enemies2, 'mayfly');
      assert(mayfly2, 'Mayfly should still exist');

      const movement = uvDistance(mayfly1.surfaceUV.u, mayfly1.surfaceUV.v, mayfly2.surfaceUV.u, mayfly2.surfaceUV.v);
      console.log(`  Movement: ${movement.toFixed(6)} UV units`);
      assert(movement > 0.001, `Mayfly should chase (movement: ${movement})`);

      await harness.screenshot('mayfly-chase');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 8: GravityWell - Stays in place
    // ---------------------------------------------------------------------------
    console.log('[TEST 8] GravityWell - Stationary');
    try {
      const well1 = findEnemyByType(initial, 'gravity');
      assert(well1, 'GravityWell should exist');

      await harness.waitFrames(90);
      const enemies2 = await harness.getEnemyStates();
      const well2 = findEnemyByType(enemies2, 'gravity');
      assert(well2, 'GravityWell should still exist');

      const drift = uvDistance(well1.surfaceUV.u, well1.surfaceUV.v, well2.surfaceUV.u, well2.surfaceUV.v);
      console.log(`  Drift: ${drift.toFixed(6)} UV units`);
      assert(drift < 0.1, `GravityWell should stay roughly in place (drift: ${drift})`);

      await harness.screenshot('gravitywell-stationary');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

    // ---------------------------------------------------------------------------
    // Test 9: Spawner - Spawning (separate test, needs time)
    // ---------------------------------------------------------------------------
    console.log('[TEST 9] Spawner - Children Spawning');
    try {
      const spawner1 = findEnemyByType(initial, 'spawner');
      assert(spawner1, 'Spawner should exist');

      const initialCount = initial.length;
      console.log(`  Initial enemy count: ${initialCount}`);

      // Wait for spawn interval (4 seconds)
      console.log('  Waiting for spawn interval...');
      await harness.fastForward(4.5);

      const enemies2 = await harness.getEnemyStates();
      const finalCount = enemies2.length;
      console.log(`  Final enemy count: ${finalCount}`);

      // Spawner should have spawned at least one child
      const spawned = finalCount > initialCount;
      console.log(`  Children spawned: ${spawned ? 'Yes' : 'No'}`);
      assert(spawned, `Spawner should spawn children (initial: ${initialCount}, final: ${finalCount})`);

      await harness.screenshot('spawner-children');
      console.log('  ✓ PASS\n');
      testsPassed++;
    } catch (err) {
      console.log(`  ✗ FAIL: ${err.message}\n`);
      testsFailed++;
    }

  } finally {
    await harness.stop();
  }

  // Summary
  console.log('='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total tests: ${testsPassed + testsFailed}`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}\n`);

  if (testsFailed > 0) {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('✅ ALL TESTS PASSED');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
