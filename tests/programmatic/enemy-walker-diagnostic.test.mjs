#!/usr/bin/env node
/**
 * Diagnostic test to check if enemies get walkers when spawned.
 * This will help us understand why the UV sync isn't working.
 */

import { BrowserTestHarness } from './BrowserTestHarness.mjs'

async function runDiagnostic() {
  console.log('\n=== Enemy Walker Diagnostic ===\n')

  const harness = new BrowserTestHarness({
    surface: 'sphere',
    seed: 12345,
    headless: true,
  })

  try {
    await harness.start()
    await harness.startGame()

    // Check if enemySpawner has meshSurface
    const spawnerHasMeshSurface = await harness.page.evaluate(() => {
      const spawner = window.__gameDebug.enemySpawner
      return spawner.getMeshSurface() !== null
    })

    console.log(`EnemySpawner has meshSurface: ${spawnerHasMeshSurface}`)

    // Spawn an Orbiter enemy
    await harness.spawnEnemy('orbiter', 0.2, 0.2)
    await harness.fastForward(0.2)

    // Check if the enemy has a walker
    const enemyWalkerStatus = await harness.page.evaluate(() => {
      const enemies = window.__gameDebug.enemySpawner.enemies
      if (enemies.length === 0) {
        return { hasEnemy: false }
      }

      const enemy = enemies[0]
      return {
        hasEnemy: true,
        hasWalker: !!enemy.walker,
        walkerExists: enemy.walker !== null && enemy.walker !== undefined,
        enemyType: enemy.constructor.name,
        hasComputeMovementDirection: typeof enemy.computeMovementDirection === 'function',
        computeReturnsNull: false, // We'll check this separately
      }
    })

    console.log('\nEnemy status:')
    console.log(`  Has enemy: ${enemyWalkerStatus.hasEnemy}`)
    if (enemyWalkerStatus.hasEnemy) {
      console.log(`  Enemy type: ${enemyWalkerStatus.enemyType}`)
      console.log(`  Has walker: ${enemyWalkerStatus.hasWalker}`)
      console.log(`  Walker exists: ${enemyWalkerStatus.walkerExists}`)
      console.log(`  Has computeMovementDirection: ${enemyWalkerStatus.hasComputeMovementDirection}`)
    }

    // If enemy has walker, try calling computeMovementDirection
    if (enemyWalkerStatus.hasWalker) {
      const computeResult = await harness.page.evaluate(() => {
        const enemy = window.__gameDebug.enemySpawner.enemies[0]
        const player = window.__gameDebug.player
        const velocity = enemy.computeMovementDirection(0.016, player.position)
        return {
          velocityIsNull: velocity === null,
          velocityLength: velocity ? velocity.length() : 0,
        }
      })

      console.log(`  computeMovementDirection returns null: ${computeResult.velocityIsNull}`)
      if (!computeResult.velocityIsNull) {
        console.log(`  Velocity length: ${computeResult.velocityLength.toFixed(4)}`)
      }
    }

    await harness.stop()

  } catch (error) {
    console.error('\nDiagnostic failed:', error)
    await harness.stop()
    throw error
  }
}

runDiagnostic()
  .then(() => {
    console.log('\n✓ Diagnostic complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\nDiagnostic execution failed:', error)
    process.exit(1)
  })
