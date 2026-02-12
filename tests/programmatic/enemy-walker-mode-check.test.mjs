#!/usr/bin/env node
/**
 * Check if enemy walker mode is actually being used during gameplay.
 * This test enables debug logging and checks if walker mode logs appear.
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs'

async function runCheck() {
  console.log('\n=== Enemy Walker Mode Check ===\n')

  const harness = new BrowserTestHarness({
    surface: 'sphere',
    seed: 12345,
    headless: true,
  })

  try {
    await harness.start()
    await harness.startGame()

    // Enable debug logging
    await harness.page.evaluate(() => {
      window.__debugEnemyUV = true
    })

    // Spawn an Orbiter enemy
    console.log('[Test] Spawning Orbiter enemy...')
    await harness.spawnEnemy('orbiter', 0.2, 0.2)

    // Collect console logs
    const logs = []
    harness.page.on('console', msg => {
      if (msg.text().includes('[Enemy')) {
        logs.push(msg.text())
      }
    })

    // Let the game run for a bit
    console.log('[Test] Letting game run for 2 seconds...')
    await harness.fastForward(2.0)

    // Check the enemy state
    const enemyState = await harness.page.evaluate(() => {
      const enemies = window.__gameDebug.enemySpawner.enemies
      if (enemies.length === 0) return null

      const enemy = enemies[0]
      return {
        hasWalker: !!enemy.walker,
        surfaceU: enemy.surfacePosition.u,
        surfaceV: enemy.surfacePosition.v,
        worldX: enemy.position.x,
        worldY: enemy.position.y,
        worldZ: enemy.position.z,
      }
    })

    console.log('\n--- Results ---')
    if (enemyState) {
      console.log(`Enemy has walker: ${enemyState.hasWalker}`)
      console.log(`Enemy UV: (${enemyState.surfaceU.toFixed(3)}, ${enemyState.surfaceV.toFixed(3)})`)
      console.log(`Enemy World: (${enemyState.worldX.toFixed(2)}, ${enemyState.worldY.toFixed(2)}, ${enemyState.worldZ.toFixed(2)})`)
    } else {
      console.log('No enemy found')
    }

    console.log(`\nConsole logs captured: ${logs.length}`)
    logs.forEach(log => console.log(`  ${log}`))

    if (logs.length === 0) {
      console.log('\n⚠️  NO DEBUG LOGS - Walker mode might not be executing!')
    } else if (logs.some(log => log.includes('Walker mode'))) {
      console.log('\n✓ Walker mode IS being used')
    } else if (logs.some(log => log.includes('UV mode'))) {
      console.log('\n✗ UV mode is being used instead of walker mode')
    }

    await harness.stop()

  } catch (error) {
    console.error('\nCheck failed:', error)
    await harness.stop()
    throw error
  }
}

runCheck()
  .then(() => {
    console.log('\n✓ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\nCheck execution failed:', error)
    process.exit(1)
  })
