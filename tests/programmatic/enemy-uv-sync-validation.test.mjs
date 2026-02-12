#!/usr/bin/env node
/**
 * Enemy UV Synchronization Validation Test
 *
 * Tests that enemy surfacePosition.u/v coordinates update correctly
 * when enemies move in mesh walker mode.
 *
 * This is a regression test for the bug where walker.position updates
 * but surfacePosition.u/v stay frozen at spawn coordinates.
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs'

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome'

// Test framework
let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.log(`  ✗ ${message}`)
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function runTest() {
  console.log('\n=== Enemy UV Synchronization Test ===\n')

  const harness = new BrowserTestHarness({
    surface: 'sphere',
    seed: 12345,
    headless: true,
  })

  try {
    console.log('[Setup] Starting harness...')
    await harness.start()
    await harness.startGame()
    console.log('[Setup] Game ready\n')

    // Spawn Orbiter enemy at UV (0.2, 0.2) - moves in circles
    console.log('[Test] Spawning Orbiter enemy at UV (0.2, 0.2)...')
    await harness.spawnEnemy('orbiter', 0.2, 0.2)
    await harness.fastForward(0.2) // Wait for spawn

    // Get initial state
    let enemies = await harness.getEnemyStates()
    if (enemies.length === 0) {
      throw new Error('Enemy did not spawn')
    }

    const player = await harness.getPlayerState()

    const initialU = enemies[0].surfaceUV.u
    const initialV = enemies[0].surfaceUV.v
    const initialWorld = enemies[0].position

    console.log(`Initial state:`)
    console.log(`  Player UV: (${player.surfaceUV.u.toFixed(3)}, ${player.surfaceUV.v.toFixed(3)})`)
    console.log(`  Player World: (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)})`)
    console.log(`  Enemy UV: (${initialU.toFixed(3)}, ${initialV.toFixed(3)})`)
    console.log(`  Enemy World: (${initialWorld.x.toFixed(2)}, ${initialWorld.y.toFixed(2)}, ${initialWorld.z.toFixed(2)})`)

    // Sample UV position over 2 seconds
    const samples = [{
      time: 0,
      u: initialU,
      v: initialV,
      world: initialWorld
    }]

    for (const dt of [0.5, 0.5, 0.5, 0.5]) {
      await harness.fastForward(dt)

      enemies = await harness.getEnemyStates()
      if (enemies.length === 0) {
        throw new Error('Enemy disappeared during test')
      }

      const enemy = enemies[0]
      const gameState = await harness.getGameState()

      samples.push({
        time: gameState.gameTime,
        u: enemy.surfaceUV.u,
        v: enemy.surfaceUV.v,
        world: enemy.position,
      })

      console.log(`\nSample at t=${gameState.gameTime.toFixed(2)}s:`)
      console.log(`  UV: (${enemy.surfaceUV.u.toFixed(3)}, ${enemy.surfaceUV.v.toFixed(3)})`)
      console.log(`  World: (${enemy.position.x.toFixed(2)}, ${enemy.position.y.toFixed(2)}, ${enemy.position.z.toFixed(2)})`)
    }

    // Verify that UV coordinates changed over time
    const finalSample = samples[samples.length - 1]
    const uChange = Math.abs(finalSample.u - initialU)
    const vChange = Math.abs(finalSample.v - initialV)
    const totalUVChange = Math.sqrt(uChange * uChange + vChange * vChange)

    console.log(`\n--- Results ---`)
    console.log(`UV change over ${finalSample.time.toFixed(2)}s:`)
    console.log(`  ΔU = ${uChange.toFixed(4)}`)
    console.log(`  ΔV = ${vChange.toFixed(4)}`)
    console.log(`  Total UV distance = ${totalUVChange.toFixed(4)}`)

    // Verify world position also changed (sanity check that enemy is actually moving)
    const worldChange = Math.sqrt(
      Math.pow(finalSample.world.x - initialWorld.x, 2) +
      Math.pow(finalSample.world.y - initialWorld.y, 2) +
      Math.pow(finalSample.world.z - initialWorld.z, 2)
    )
    console.log(`  World distance = ${worldChange.toFixed(2)} units`)

    // Assertions
    assert(worldChange > 0.5, `Enemy moves in world space (${worldChange.toFixed(2)} > 0.5 units)`)
    assert(totalUVChange > 0.05, `Enemy UV coordinates update (${totalUVChange.toFixed(4)} > 0.05 UV units)`)

    console.log('\n✓ Enemy UV coordinates update correctly during movement')

    await harness.stop()

  } catch (error) {
    console.error('\n✗ Test failed:', error.message)
    await harness.stop()
    throw error
  }
}

// Run test
runTest()
  .then(() => {
    console.log(`\n=== Test Summary ===`)
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${failed}`)
    process.exit(failed > 0 ? 1 : 0)
  })
  .catch((error) => {
    console.error('\nTest execution failed:', error)
    process.exit(1)
  })
