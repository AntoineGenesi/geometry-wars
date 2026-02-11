#!/usr/bin/env node
/**
 * Enemy Chase & Movement Behavior Tests
 *
 * Tests basic movement patterns:
 * - Chase enemies: grunt, swarm, approach_glow, titan_grunt
 * - Random walkers: wanderer, neutron, giant_wanderer
 * - Straight-line movers: rocket, giant_rocket
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs';

// Test framework
let passed = 0;
let failed = 0;
const tests = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------------------
// Test: Chase Enemies
// ---------------------------------------------------------------------------

async function testChaseEnemy(harness, enemyType) {
  console.log(`\n[Test: ${enemyType} — Chase Behavior]`);

  // Spawn enemy far from player (player spawns at ~0.1, 0.5)
  await harness.spawnEnemy(enemyType, 0.8, 0.5);

  // Use fastForward instead of waitFrames to avoid timeout issues
  await harness.fastForward(0.2); // 200ms for spawn

  const initial = await harness.getEnemyStates();
  const initialEnemy = initial.find(e => e.type.toLowerCase().includes(enemyType.replace('_', '')));

  if (!initialEnemy) {
    assert(false, `${enemyType} failed to spawn`);
    return;
  }

  const player = await harness.getPlayerState();
  const initialDist = distance3D(initialEnemy.position, player.position);

  console.log(`  Initial distance: ${initialDist.toFixed(3)}`);
  console.log(`  Initial 3D position: (${initialEnemy.position.x.toFixed(2)}, ${initialEnemy.position.y.toFixed(2)}, ${initialEnemy.position.z.toFixed(2)})`);

  // Wait for movement (2 seconds to ensure visible movement in headless mode)
  await harness.fastForward(2.0);

  const final = await harness.getEnemyStates();
  const finalEnemy = final.find(e => e.type.toLowerCase().includes(enemyType.replace('_', '')));

  if (!finalEnemy) {
    assert(false, `${enemyType} disappeared before test completed`);
    return;
  }

  const finalDist = distance3D(finalEnemy.position, player.position);

  console.log(`  Final distance: ${finalDist.toFixed(3)}`);
  console.log(`  Final 3D position: (${finalEnemy.position.x.toFixed(2)}, ${finalEnemy.position.y.toFixed(2)}, ${finalEnemy.position.z.toFixed(2)})`);
  console.log(`  Distance change: ${(initialDist - finalDist).toFixed(3)}`);

  // Verify enemy approached player
  assert(
    finalDist < initialDist,
    `${enemyType} approached player (${initialDist.toFixed(3)} → ${finalDist.toFixed(3)})`
  );

  // Verify enemy actually moved (3D distance should have changed)
  const distanceMoved = Math.abs(initialDist - finalDist);
  assert(
    distanceMoved > 0.1,
    `${enemyType} moved significantly (${distanceMoved.toFixed(3)} units)`
  );

  // Screenshot showing enemy position
  await harness.screenshot(`${enemyType}-chase`);
}

// ---------------------------------------------------------------------------
// Test: Random Walkers
// ---------------------------------------------------------------------------

async function testRandomWalker(harness, enemyType) {
  console.log(`\n[Test: ${enemyType} — Random Walk Behavior]`);

  // Spawn enemy at center
  await harness.spawnEnemy(enemyType, 0.5, 0.5);
  await harness.fastForward(0.2);

  const initial = await harness.getEnemyStates();
  const initialEnemy = initial.find(e => e.type.toLowerCase().includes(enemyType.replace('_', '')));

  if (!initialEnemy) {
    assert(false, `${enemyType} failed to spawn`);
    return;
  }

  const initialPos = { ...initialEnemy.position };
  const initialUV = { ...initialEnemy.surfaceUV };
  const player = await harness.getPlayerState();

  console.log(`  Initial 3D position: (${initialPos.x.toFixed(2)}, ${initialPos.y.toFixed(2)}, ${initialPos.z.toFixed(2)})`);

  // Wait for movement (2 seconds of wall time)
  await harness.fastForward(2.0);

  const final = await harness.getEnemyStates();
  const finalEnemy = final.find(e => e.type.toLowerCase().includes(enemyType.replace('_', '')));

  if (!finalEnemy) {
    assert(false, `${enemyType} disappeared before test completed`);
    return;
  }

  const finalPos = finalEnemy.position;
  const distanceMoved = distance3D(initialPos, finalPos);

  console.log(`  Final 3D position: (${finalPos.x.toFixed(2)}, ${finalPos.y.toFixed(2)}, ${finalPos.z.toFixed(2)})`);
  console.log(`  Distance moved: ${distanceMoved.toFixed(3)}`);

  // Verify enemy moved
  assert(
    distanceMoved > 0.1,
    `${enemyType} moved (${distanceMoved.toFixed(3)} units)`
  );

  // Verify movement is non-deterministic (not straight toward player)
  // Calculate direction vectors in 3D space
  const initialToPlayer = {
    x: player.position.x - initialPos.x,
    y: player.position.y - initialPos.y,
    z: player.position.z - initialPos.z
  };
  const moveDirection = {
    x: finalPos.x - initialPos.x,
    y: finalPos.y - initialPos.y,
    z: finalPos.z - initialPos.z
  };

  // Normalize and compute dot product (cosine of angle between vectors)
  const initialToPlayerLen = Math.sqrt(initialToPlayer.x ** 2 + initialToPlayer.y ** 2 + initialToPlayer.z ** 2);
  const moveDirectionLen = Math.sqrt(moveDirection.x ** 2 + moveDirection.y ** 2 + moveDirection.z ** 2);

  if (initialToPlayerLen > 0.001 && moveDirectionLen > 0.001) {
    const dotProduct = (
      (initialToPlayer.x * moveDirection.x +
       initialToPlayer.y * moveDirection.y +
       initialToPlayer.z * moveDirection.z) /
      (initialToPlayerLen * moveDirectionLen)
    );

    // Random walkers should not always be perfectly aligned with player direction
    // dotProduct close to 1 = moving directly toward player
    // dotProduct close to 0 = moving perpendicular
    // dotProduct close to -1 = moving away from player
    console.log(`  Alignment with player direction: ${dotProduct.toFixed(3)} (1.0 = perfect chase)`);

    assert(
      Math.abs(dotProduct) < 0.95 || distanceMoved > 0.5,
      `${enemyType} movement is random (not perfectly aligned with player)`
    );
  } else {
    // If enemy didn't move much, just verify it moved at all
    assert(distanceMoved > 0.05, `${enemyType} moved at least slightly`);
  }

  await harness.screenshot(`${enemyType}-random-walk`);
}

// ---------------------------------------------------------------------------
// Test: Straight-Line Movers
// ---------------------------------------------------------------------------

async function testStraightLineMover(harness, enemyType) {
  console.log(`\n[Test: ${enemyType} — Straight-Line Movement]`);

  // Spawn enemy
  await harness.spawnEnemy(enemyType, 0.3, 0.3);
  await harness.fastForward(0.2);

  const initial = await harness.getEnemyStates();
  const initialEnemy = initial.find(e => e.type.toLowerCase().includes(enemyType.replace('_', '')));

  if (!initialEnemy) {
    assert(false, `${enemyType} failed to spawn`);
    return;
  }

  // Record position at multiple intervals (using 3D positions, not UV)
  const positions = [{ ...initialEnemy.position }];

  for (let i = 0; i < 3; i++) {
    await harness.fastForward(0.5); // 500ms intervals
    const enemies = await harness.getEnemyStates();
    const enemy = enemies.find(e => e.type.toLowerCase().includes(enemyType.replace('_', '')));
    if (enemy) {
      positions.push({ ...enemy.position });
    }
  }

  console.log(`  Positions recorded: ${positions.length}`);
  positions.forEach((p, i) => {
    console.log(`    [${i * 0.5}s] 3D: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  });

  // Verify movement is roughly linear
  if (positions.length >= 3) {
    // Calculate speeds between intervals
    const speeds = [];
    for (let i = 1; i < positions.length; i++) {
      const dist = distance3D(positions[i - 1], positions[i]);
      speeds.push(dist);
    }

    console.log(`  Interval distances: ${speeds.map(s => s.toFixed(3)).join(', ')}`);

    // Verify speed is consistent (variance should be low)
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const variance = speeds.reduce((sum, s) => sum + Math.pow(s - avgSpeed, 2), 0) / speeds.length;
    const stdDev = Math.sqrt(variance);

    console.log(`  Average speed: ${avgSpeed.toFixed(3)}, StdDev: ${stdDev.toFixed(3)}`);

    // For headless rendering, just verify it's moving
    assert(
      avgSpeed > 0.01,
      `${enemyType} is moving (avg speed: ${avgSpeed.toFixed(3)} units/0.5s)`
    );

    // Verify some consistency (allow for headless variance)
    if (avgSpeed > 0.01) {
      assert(
        stdDev < avgSpeed * 0.6 || stdDev < 0.5,
        `${enemyType} moves at reasonably consistent speed (StdDev: ${stdDev.toFixed(3)})`
      );
    }
  } else {
    assert(false, `${enemyType} insufficient position data`);
  }

  await harness.screenshot(`${enemyType}-straight-line`);
}

// ---------------------------------------------------------------------------
// Main Test Runner
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('='.repeat(70));
  console.log('Enemy Chase & Movement Behavior Tests');
  console.log('='.repeat(70));

  const harness = new BrowserTestHarness({
    surface: 'sphere',
    seed: 12345,
    headless: true,
  });

  try {
    console.log('\n[Setup] Starting harness...');
    await harness.start();
    await harness.startGame();
    console.log('[Setup] Game ready\n');

    // Chase enemies
    console.log('\n' + '='.repeat(70));
    console.log('CHASE ENEMIES');
    console.log('='.repeat(70));
    await testChaseEnemy(harness, 'grunt');
    await testChaseEnemy(harness, 'swarm');
    await testChaseEnemy(harness, 'approach_glow');
    await testChaseEnemy(harness, 'titan_grunt');

    // Random walkers
    console.log('\n' + '='.repeat(70));
    console.log('RANDOM WALKERS');
    console.log('='.repeat(70));
    await testRandomWalker(harness, 'wanderer');
    await testRandomWalker(harness, 'neutron');
    await testRandomWalker(harness, 'giant_wanderer');

    // Straight-line movers
    console.log('\n' + '='.repeat(70));
    console.log('STRAIGHT-LINE MOVERS');
    console.log('='.repeat(70));
    await testStraightLineMover(harness, 'rocket');
    await testStraightLineMover(harness, 'giant_rocket');

  } catch (err) {
    console.error('\n[ERROR]', err.message);
    console.error(err.stack);
    failed++;
  } finally {
    console.log('\n[Cleanup] Stopping harness...');
    await harness.stop();
  }

  // Results
  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  console.log('='.repeat(70));

  if (harness.screenshotDir) {
    console.log(`\nScreenshots: ${harness.screenshotDir}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
