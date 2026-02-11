/**
 * SeededRandom Usage Examples
 *
 * This file demonstrates how to use the seeded random system for deterministic gameplay.
 * For testing: use setGameSeed() to enable deterministic behavior.
 * For production: leave seed unset for true randomness.
 */

import { setGameSeed, clearGameSeed, seededRandom, seededRandomInt } from './SeededRandom';

// Example 1: Basic seeded gameplay
function deterministicGameplayExample() {
  // Set seed for deterministic behavior
  setGameSeed(12345);

  // Now Math.random() is deterministic
  const angle = Math.random() * Math.PI * 2; // Always same for seed 12345
  const spawnU = Math.random(); // Always same sequence
  const spawnV = Math.random();

  console.log('Deterministic values:', { angle, spawnU, spawnV });

  // Clear seed to restore normal randomness
  clearGameSeed();
}

// Example 2: Deterministic enemy behavior testing
function testEnemyBehavior() {
  setGameSeed(42);

  // Spawn 100 enemies - positions will be identical each run
  const enemies = [];
  for (let i = 0; i < 100; i++) {
    enemies.push({
      u: Math.random(),
      v: Math.random(),
      speed: 0.03 + Math.random() * 0.04,
      angle: Math.random() * Math.PI * 2,
    });
  }

  // Run game logic...
  // All randomness is deterministic, so same seed = same outcome

  clearGameSeed();
  return enemies;
}

// Example 3: Replay system
interface GameSnapshot {
  seed: number;
  frame: number;
  // ... other state
}

function recordGameplay(): GameSnapshot {
  const seed = Date.now();
  setGameSeed(seed);

  // Play game...
  // All random decisions are deterministic

  return {
    seed,
    frame: 1000,
  };
}

function replayGameplay(snapshot: GameSnapshot) {
  // Restore same seed
  setGameSeed(snapshot.seed);

  // Re-run game from frame 0
  // Identical random sequence = identical outcome
}

// Example 4: Testing random distributions
function testRandomDistribution() {
  setGameSeed(99);

  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 10000; i++) {
    const value = Math.random(); // Deterministic
    const bucket = Math.floor(value * 10);
    buckets[bucket]++;
  }

  // Same seed always produces same distribution
  console.log('Distribution:', buckets);

  clearGameSeed();
}

// Example 5: Existing patterns work automatically
function existingCodePatterns() {
  setGameSeed(777);

  // All these patterns work without modification:

  // Random angle
  const angle = Math.random() * Math.PI * 2;

  // Random element from array
  const types = ['wanderer', 'grunt', 'duck'];
  const randomType = types[Math.floor(Math.random() * types.length)];

  // Random range
  const speed = 0.03 + Math.random() * 0.04;

  // Random boolean
  const shouldSpawn = Math.random() < 0.5;

  // Random integer
  const dice = Math.floor(Math.random() * 6) + 1;

  console.log({ angle, randomType, speed, shouldSpawn, dice });

  clearGameSeed();
}

// Example 6: Using seededRandom() directly (optional)
function directApiExample() {
  setGameSeed(123);

  // Can call seededRandom() directly if preferred
  const value1 = seededRandom(); // Same as Math.random() when seed is set

  // Helper for integer ranges
  const diceRoll = seededRandomInt(1, 7); // [1, 7) = 1-6

  clearGameSeed();
}

// Example 7: Test isolation
function testIsolation() {
  // Each test should clean up after itself
  setGameSeed(42);
  // ... test code ...
  clearGameSeed(); // Important: restore Math.random()
}

export {
  deterministicGameplayExample,
  testEnemyBehavior,
  recordGameplay,
  replayGameplay,
  testRandomDistribution,
  existingCodePatterns,
  directApiExample,
  testIsolation,
};
