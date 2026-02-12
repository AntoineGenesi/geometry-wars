#!/usr/bin/env node
/**
 * Enemy Special Abilities Test Suite
 *
 * Tests unique behaviors of special enemies using BrowserTestHarness.
 * Each enemy type runs in its own browser session to avoid game freezes.
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';
import assert from 'assert';

const BASE_SEED = 99999;
const SURFACE = 'sphere';
const HEADLESS = true;

function distance3D(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function findEnemyByType(enemies, typePattern) {
  return enemies.find(e => e.type.toLowerCase().includes(typePattern.toLowerCase()));
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('ENEMY SPECIAL ABILITIES TEST SUITE');
  console.log('='.repeat(70));
  console.log(`Surface: ${SURFACE}, Base Seed: ${BASE_SEED}, Headless: ${HEADLESS}\n`);

  let testsPassed = 0;
  let testsFailed = 0;

  // ---------------------------------------------------------------------------
  // Test 1: Gate - Stationary
  // ---------------------------------------------------------------------------
  console.log('[TEST 1] Gate - Stationary Behavior');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 1, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    await harness.spawnEnemy('gate', 0.5, 0.5);
    await harness.waitFrames(10);

    const enemies1 = await harness.getEnemyStates();
    const gate1 = findEnemyByType(enemies1, 'gate');
    assert(gate1, 'Gate should exist');

    await harness.waitFrames(90);

    const enemies2 = await harness.getEnemyStates();
    const gate2 = findEnemyByType(enemies2, 'gate');
    assert(gate2, 'Gate should still exist');

    const drift = distance3D(gate1.position, gate2.position);
    console.log(`  Drift: ${drift.toFixed(6)} world units`);
    assert(drift < 0.01, `Gate should be stationary (drift: ${drift})`);

    await harness.screenshot('gate-stationary');
    await harness.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 2: Spawner - Children Spawning
  // ---------------------------------------------------------------------------
  console.log('[TEST 2] Spawner - Children Spawning');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 2, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    await harness.spawnEnemy('spawner', 0.4, 0.6);
    await harness.waitFrames(10);

    const initial = await harness.getEnemyStates();
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
    await harness.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 3: GravityWell - Attraction
  // ---------------------------------------------------------------------------
  console.log('[TEST 3] GravityWell - Attraction');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 3, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    // Spawn gravity well at center
    await harness.spawnEnemy('gravity_well', 0.5, 0.5);
    await harness.waitFrames(5);

    // Spawn 3 grunts around the well
    await harness.spawnEnemy('grunt', 0.3, 0.5);
    await harness.spawnEnemy('grunt', 0.7, 0.5);
    await harness.spawnEnemy('grunt', 0.5, 0.3);
    await harness.waitFrames(5);

    const initial = await harness.getEnemyStates();
    const well = findEnemyByType(initial, 'gravity');
    assert(well, 'GravityWell should exist');

    const grunts1 = initial.filter(e => e.type.includes('grunt'));
    console.log(`  Found ${grunts1.length} grunts (natural spawn + manual spawn)`);
    assert(grunts1.length >= 3, `Should have at least 3 grunts (got ${grunts1.length})`);

    // Use only the first 3 grunts for measurement (our manually spawned ones)
    const testGrunts1 = grunts1.slice(0, 3);

    // Calculate initial distances
    const initialDistances = testGrunts1.map(g => distance3D(g.position, well.position));
    console.log(`  Initial distances: ${initialDistances.map(d => d.toFixed(3)).join(', ')}`);

    // Wait for attraction
    await harness.waitFrames(120);

    const enemies2 = await harness.getEnemyStates();
    const grunts2 = enemies2.filter(e => e.type.includes('grunt'));

    // Match grunts by finding closest ones to original positions
    const testGrunts2 = testGrunts1.map(g1 => {
      return grunts2.reduce((closest, g2) => {
        const dist = distance3D(g1.position, g2.position);
        const closestDist = distance3D(g1.position, closest.position);
        return dist < closestDist ? g2 : closest;
      }, grunts2[0]);
    });

    // Calculate final distances
    const finalDistances = testGrunts2.map(g => distance3D(g.position, well.position));
    console.log(`  Final distances: ${finalDistances.map(d => d.toFixed(3)).join(', ')}`);

    // At least one grunt should have moved closer
    const anyCloser = testGrunts2.some((g, i) => {
      const initial = initialDistances[i];
      const final = finalDistances[i];
      return final < initial * 0.95; // 5% closer
    });

    console.log(`  Grunts attracted: ${anyCloser ? 'Yes' : 'No'}`);
    assert(anyCloser, 'At least one grunt should move toward gravity well');

    await harness.screenshot('gravitywell-attraction');
    await harness.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 4: Painter - Movement (Trail not queryable via debug API)
  // ---------------------------------------------------------------------------
  console.log('[TEST 4] Painter - Movement');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 4, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    await harness.spawnEnemy('painter', 0.2, 0.2);
    await harness.waitFrames(10);

    const enemies1 = await harness.getEnemyStates();
    const painter1 = findEnemyByType(enemies1, 'painter');
    assert(painter1, 'Painter should exist');

    await harness.waitFrames(120);

    const enemies2 = await harness.getEnemyStates();
    const painter2 = findEnemyByType(enemies2, 'painter');
    assert(painter2, 'Painter should still exist');

    const movement = distance3D(painter1.position, painter2.position);
    console.log(`  Movement: ${movement.toFixed(6)} world units`);
    assert(movement > 0.1, `Painter should move (movement: ${movement})`);

    await harness.screenshot('painter-movement');
    await harness.stop();

    console.log('  ✓ PASS (trail particles not queryable via debug API)\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 5: Duck - Chase Behavior
  // ---------------------------------------------------------------------------
  console.log('[TEST 5] Duck - Chase Behavior');
  let harness5;
  try {
    harness5 = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 5, headless: HEADLESS });
    await harness5.start();
    await harness5.startGame();
    await harness5.waitFrames(30);

    await harness5.spawnEnemy('duck', 0.3, 0.3);
    await harness5.fastForward(0.5); // Use fast forward instead of waitFrames

    const enemies1 = await harness5.getEnemyStates();
    const duck1 = findEnemyByType(enemies1, 'duck');
    assert(duck1, 'Duck should exist');

    await harness5.fastForward(1.5);

    const enemies2 = await harness5.getEnemyStates();
    const duck2 = findEnemyByType(enemies2, 'duck');
    assert(duck2, 'Duck should still exist');

    const movement = distance3D(duck1.position, duck2.position);
    console.log(`  Movement: ${movement.toFixed(6)} world units`);
    assert(movement > 0.05, `Duck should chase (movement: ${movement})`);

    await harness5.screenshot('duck-chase');
    await harness5.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    if (harness5) await harness5.stop();
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 6: Virus - Random Drift
  // ---------------------------------------------------------------------------
  console.log('[TEST 6] Virus - Random Drift');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 6, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    await harness.spawnEnemy('virus', 0.5, 0.5);
    await harness.waitFrames(10);

    const enemies1 = await harness.getEnemyStates();
    const virus1 = findEnemyByType(enemies1, 'virus');
    assert(virus1, 'Virus should exist');

    await harness.waitFrames(120);

    const enemies2 = await harness.getEnemyStates();
    const virus2 = findEnemyByType(enemies2, 'virus');
    assert(virus2, 'Virus should still exist');

    const movement = distance3D(virus1.position, virus2.position);
    console.log(`  Movement: ${movement.toFixed(6)} world units`);
    assert(movement > 0.01, `Virus should drift (movement: ${movement})`);

    await harness.screenshot('virus-drift');
    await harness.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 7: Cluster - Slow Chase
  // ---------------------------------------------------------------------------
  console.log('[TEST 7] Cluster - Slow Chase');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 7, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    await harness.spawnEnemy('cluster', 0.6, 0.6);
    await harness.waitFrames(10);

    const enemies1 = await harness.getEnemyStates();
    const cluster1 = findEnemyByType(enemies1, 'cluster');
    assert(cluster1, 'Cluster should exist');

    await harness.waitFrames(120);

    const enemies2 = await harness.getEnemyStates();
    const cluster2 = findEnemyByType(enemies2, 'cluster');
    assert(cluster2, 'Cluster should still exist');

    const movement = distance3D(cluster1.position, cluster2.position);
    console.log(`  Movement: ${movement.toFixed(6)} world units`);
    assert(movement > 0.05, `Cluster should chase (movement: ${movement})`);

    await harness.screenshot('cluster-chase');
    await harness.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 8: Boss - Existence & Movement
  // ---------------------------------------------------------------------------
  console.log('[TEST 8] Boss - Existence & Movement');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 8, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    await harness.spawnEnemy('boss_sapphire', 0.7, 0.7);
    await harness.waitFrames(10);

    const enemies1 = await harness.getEnemyStates();
    const boss1 = findEnemyByType(enemies1, 'boss');
    assert(boss1, 'Boss should exist');

    await harness.waitFrames(120);

    const enemies2 = await harness.getEnemyStates();
    const boss2 = findEnemyByType(enemies2, 'boss');
    assert(boss2, 'Boss should still exist');

    const movement = distance3D(boss1.position, boss2.position);
    console.log(`  Movement: ${movement.toFixed(6)} world units`);
    assert(movement > 0.05, `Boss should move (movement: ${movement})`);

    await harness.screenshot('boss-movement');
    await harness.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 9: StealthStalker - Approach
  // ---------------------------------------------------------------------------
  console.log('[TEST 9] StealthStalker - Approach Behavior');
  try {
    const harness = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 9, headless: HEADLESS });
    await harness.start();
    await harness.startGame();
    await harness.waitFrames(30);

    await harness.spawnEnemy('stealth_stalker', 0.8, 0.8);
    await harness.waitFrames(10);

    const enemies1 = await harness.getEnemyStates();
    const stalker1 = findEnemyByType(enemies1, 'stealth');
    assert(stalker1, 'StealthStalker should exist');

    await harness.waitFrames(120);

    const enemies2 = await harness.getEnemyStates();
    const stalker2 = findEnemyByType(enemies2, 'stealth');
    assert(stalker2, 'StealthStalker should still exist');

    const movement = distance3D(stalker1.position, stalker2.position);
    console.log(`  Movement: ${movement.toFixed(6)} world units`);
    assert(movement > 0.05, `StealthStalker should approach (movement: ${movement})`);

    await harness.screenshot('stealthstalker-approach');
    await harness.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
  }

  // ---------------------------------------------------------------------------
  // Test 10: Mayfly - Chase
  // ---------------------------------------------------------------------------
  console.log('[TEST 10] Mayfly - Chase Behavior');
  let harness10;
  try {
    harness10 = new BrowserTestHarness({ surface: SURFACE, seed: BASE_SEED + 10, headless: HEADLESS });
    await harness10.start();
    await harness10.startGame();
    await harness10.waitFrames(30);

    await harness10.spawnEnemy('mayfly', 0.9, 0.9);
    await harness10.fastForward(0.5); // Use fast forward instead of waitFrames

    const enemies1 = await harness10.getEnemyStates();
    const mayfly1 = findEnemyByType(enemies1, 'mayfly');
    assert(mayfly1, 'Mayfly should exist');

    await harness10.fastForward(1.5);

    const enemies2 = await harness10.getEnemyStates();
    const mayfly2 = findEnemyByType(enemies2, 'mayfly');
    assert(mayfly2, 'Mayfly should still exist');

    const movement = distance3D(mayfly1.position, mayfly2.position);
    console.log(`  Movement: ${movement.toFixed(6)} world units`);
    assert(movement > 0.1, `Mayfly should chase (movement: ${movement})`);

    await harness10.screenshot('mayfly-chase');
    await harness10.stop();

    console.log('  ✓ PASS\n');
    testsPassed++;
  } catch (err) {
    if (harness10) await harness10.stop();
    console.log(`  ✗ FAIL: ${err.message}\n`);
    testsFailed++;
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
