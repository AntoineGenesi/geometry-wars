/**
 * SeededRandom — Deterministic PRNG for reproducible gameplay testing.
 *
 * Uses a simple LCG (Linear Congruential Generator) to produce deterministic
 * random numbers from a seed. This allows replaying exact gameplay scenarios
 * by re-initializing with the same seed.
 *
 * Usage:
 *   setGameSeed(12345);
 *   const x = seededRandom(); // deterministic value based on seed
 *   const choice = seededRandomInt(0, 10); // deterministic integer in [0, 10)
 *
 * WARNING: This REPLACES Math.random() globally when a seed is set.
 * Call clearGameSeed() to restore Math.random().
 */

// LCG parameters (from Numerical Recipes, widely used and well-tested)
const LCG_A = 1664525;
const LCG_C = 1013904223;
const LCG_M = 2 ** 32;

let state: number | null = null;
let originalMathRandom: (() => number) | null = null;

/**
 * Set the global random seed and replace Math.random() with seeded version.
 * All subsequent Math.random() calls will be deterministic.
 */
export function setGameSeed(seed: number): void {
  state = seed >>> 0; // Ensure positive 32-bit integer

  // Save original Math.random if not already saved
  if (!originalMathRandom) {
    originalMathRandom = Math.random;
  }

  // Replace Math.random globally
  Math.random = seededRandom;
}

/**
 * Clear the seed and restore original Math.random().
 */
export function clearGameSeed(): void {
  if (originalMathRandom) {
    Math.random = originalMathRandom;
    originalMathRandom = null;
  }
  state = null;
}

/**
 * Get a seeded random value in [0, 1).
 * If no seed is set, falls back to Math.random().
 */
export function seededRandom(): number {
  if (state === null) {
    return originalMathRandom ? originalMathRandom() : Math.random();
  }

  state = (LCG_A * state + LCG_C) % LCG_M;
  return state / LCG_M;
}

/**
 * Get a seeded random integer in [min, max).
 */
export function seededRandomInt(min: number, max: number): number {
  return Math.floor(seededRandom() * (max - min)) + min;
}

/**
 * Get current seed state (for debugging/verification).
 */
export function getCurrentSeed(): number | null {
  return state;
}

/**
 * Check if a seed is currently active.
 */
export function isSeedActive(): boolean {
  return state !== null;
}
