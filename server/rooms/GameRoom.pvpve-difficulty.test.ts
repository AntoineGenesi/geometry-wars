/**
 * Unit tests for PvPvE player-count difficulty adjustment (s44j-pvpve-14b).
 *
 * Tests the pure calculation logic extracted from GameRoom's
 * computePlayerCountDifficultyMultiplier() method.
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 */

import { describe, it, expect } from 'vitest';
import { DIFFICULTY_PER_PLAYER_FACTOR } from '../shared/GameConstants';
import { validateSettings, DEFAULT_GAME_SETTINGS } from '../shared/GameSettings';
import type { EnemyDifficultyPerPlayer } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Pure function mirroring GameRoom.computePlayerCountDifficultyMultiplier()
// ---------------------------------------------------------------------------

/**
 * Compute spawn-rate multiplier from active player count.
 * Formula: clamp(1 + factor * (totalPlayers - activePlayers), 0.1, 10.0)
 */
function computePlayerCountDifficultyMultiplier(
  tier: EnemyDifficultyPerPlayer,
  totalPlayers: number,
  activePlayers: number,
): number {
  const factor = DIFFICULTY_PER_PLAYER_FACTOR[tier] ?? 0;
  if (factor === 0) return 1.0;
  const eliminated = totalPlayers - activePlayers;
  return Math.max(0.1, Math.min(10.0, 1 + factor * eliminated));
}

// ---------------------------------------------------------------------------
// Tests: DIFFICULTY_PER_PLAYER_FACTOR constants
// ---------------------------------------------------------------------------

describe('DIFFICULTY_PER_PLAYER_FACTOR constants', () => {
  it('low tier has factor -0.20', () => {
    expect(DIFFICULTY_PER_PLAYER_FACTOR['low']).toBe(-0.20);
  });

  it('medium tier has factor 0.00', () => {
    expect(DIFFICULTY_PER_PLAYER_FACTOR['medium']).toBe(0.00);
  });

  it('high tier has factor +0.30', () => {
    expect(DIFFICULTY_PER_PLAYER_FACTOR['high']).toBe(0.30);
  });
});

// ---------------------------------------------------------------------------
// Tests: multiplier calculation — medium tier (baseline)
// ---------------------------------------------------------------------------

describe('medium tier — no adjustment', () => {
  it('1 player, 1 active → 1.0', () => {
    expect(computePlayerCountDifficultyMultiplier('medium', 1, 1)).toBe(1.0);
  });

  it('4 players, 1 active (3 eliminated) → 1.0', () => {
    expect(computePlayerCountDifficultyMultiplier('medium', 4, 1)).toBe(1.0);
  });

  it('4 players, 0 active → 1.0', () => {
    expect(computePlayerCountDifficultyMultiplier('medium', 4, 0)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Tests: multiplier calculation — low tier (gets easier)
// ---------------------------------------------------------------------------

describe('low tier — spawn rate decreases as players eliminated', () => {
  it('4 players, 4 active (0 eliminated) → 1.0', () => {
    expect(computePlayerCountDifficultyMultiplier('low', 4, 4)).toBe(1.0);
  });

  it('4 players, 3 active (1 eliminated) → 0.8', () => {
    expect(computePlayerCountDifficultyMultiplier('low', 4, 3)).toBeCloseTo(0.80);
  });

  it('4 players, 2 active (2 eliminated) → 0.6', () => {
    expect(computePlayerCountDifficultyMultiplier('low', 4, 2)).toBeCloseTo(0.60);
  });

  it('4 players, 1 active (3 eliminated) → 0.4', () => {
    expect(computePlayerCountDifficultyMultiplier('low', 4, 1)).toBeCloseTo(0.40);
  });

  it('1 player, 1 active (0 eliminated) → 1.0', () => {
    expect(computePlayerCountDifficultyMultiplier('low', 1, 1)).toBe(1.0);
  });

  it('2 players, 1 active (1 eliminated) → 0.8', () => {
    expect(computePlayerCountDifficultyMultiplier('low', 2, 1)).toBeCloseTo(0.80);
  });

  it('3 players, 1 active (2 eliminated) → 0.6', () => {
    expect(computePlayerCountDifficultyMultiplier('low', 3, 1)).toBeCloseTo(0.60);
  });

  it('clamps to minimum 0.1 even if formula goes negative', () => {
    // Extreme case: 10 players all eliminated → 1 + (-0.20)*10 = -1.0 → clamp to 0.1
    expect(computePlayerCountDifficultyMultiplier('low', 10, 0)).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// Tests: multiplier calculation — high tier (gets harder)
// ---------------------------------------------------------------------------

describe('high tier — spawn rate increases as players eliminated', () => {
  it('4 players, 4 active (0 eliminated) → 1.0', () => {
    expect(computePlayerCountDifficultyMultiplier('high', 4, 4)).toBe(1.0);
  });

  it('4 players, 3 active (1 eliminated) → 1.3', () => {
    expect(computePlayerCountDifficultyMultiplier('high', 4, 3)).toBeCloseTo(1.30);
  });

  it('4 players, 2 active (2 eliminated) → 1.6', () => {
    expect(computePlayerCountDifficultyMultiplier('high', 4, 2)).toBeCloseTo(1.60);
  });

  it('4 players, 1 active (3 eliminated) → 1.9', () => {
    expect(computePlayerCountDifficultyMultiplier('high', 4, 1)).toBeCloseTo(1.90);
  });

  it('1 player, 1 active (0 eliminated) → 1.0', () => {
    expect(computePlayerCountDifficultyMultiplier('high', 1, 1)).toBe(1.0);
  });

  it('2 players, 1 active (1 eliminated) → 1.3', () => {
    expect(computePlayerCountDifficultyMultiplier('high', 2, 1)).toBeCloseTo(1.30);
  });

  it('3 players, 1 active (2 eliminated) → 1.6', () => {
    expect(computePlayerCountDifficultyMultiplier('high', 3, 1)).toBeCloseTo(1.60);
  });
});

// ---------------------------------------------------------------------------
// Tests: GameSettings validation
// ---------------------------------------------------------------------------

describe('validateSettings — enemyDifficultyPerPlayer', () => {
  it('defaults to medium when not specified', () => {
    const settings = validateSettings({});
    expect(settings.enemyDifficultyPerPlayer).toBe('medium');
  });

  it('accepts low', () => {
    const settings = validateSettings({ enemyDifficultyPerPlayer: 'low' });
    expect(settings.enemyDifficultyPerPlayer).toBe('low');
  });

  it('accepts medium', () => {
    const settings = validateSettings({ enemyDifficultyPerPlayer: 'medium' });
    expect(settings.enemyDifficultyPerPlayer).toBe('medium');
  });

  it('accepts high', () => {
    const settings = validateSettings({ enemyDifficultyPerPlayer: 'high' });
    expect(settings.enemyDifficultyPerPlayer).toBe('high');
  });

  it('falls back to medium for invalid value', () => {
    const settings = validateSettings({ enemyDifficultyPerPlayer: 'invalid' as EnemyDifficultyPerPlayer });
    expect(settings.enemyDifficultyPerPlayer).toBe('medium');
  });

  it('DEFAULT_GAME_SETTINGS has medium as default', () => {
    expect(DEFAULT_GAME_SETTINGS.enemyDifficultyPerPlayer).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Tests: effective spawn rate integration
// ---------------------------------------------------------------------------

describe('effective spawn rate interaction with enemySpawnRateMultiplier', () => {
  /**
   * Simulate the wave interval calculation from GameRoom.tickWaves()
   * scaledInterval = baseInterval / (enemySpawnRateMultiplier * playerCountMult)
   */
  function computeScaledInterval(
    baseInterval: number,
    enemySpawnRateMult: number,
    tier: EnemyDifficultyPerPlayer,
    totalPlayers: number,
    activePlayers: number,
  ): number {
    const playerCountMult = computePlayerCountDifficultyMultiplier(tier, totalPlayers, activePlayers);
    const effectiveSpawnRate = enemySpawnRateMult * playerCountMult;
    return baseInterval / Math.max(0.01, effectiveSpawnRate);
  }

  it('medium tier: interval unchanged regardless of player count', () => {
    const base = 20;
    const rate = 1.0;
    const full = computeScaledInterval(base, rate, 'medium', 4, 4);
    const oneLeft = computeScaledInterval(base, rate, 'medium', 4, 1);
    expect(full).toBeCloseTo(oneLeft);
  });

  it('low tier: interval increases (spawn rate decreases) as players eliminated', () => {
    const base = 20;
    const rate = 1.0;
    const full = computeScaledInterval(base, rate, 'low', 4, 4);   // 1.0 mult → interval=20
    const oneLeft = computeScaledInterval(base, rate, 'low', 4, 1); // 0.4 mult → interval=50
    expect(oneLeft).toBeGreaterThan(full);
    expect(oneLeft).toBeCloseTo(50); // 20 / 0.4 = 50
  });

  it('high tier: interval decreases (spawn rate increases) as players eliminated', () => {
    const base = 20;
    const rate = 1.0;
    const full = computeScaledInterval(base, rate, 'high', 4, 4);   // 1.0 mult → interval=20
    const oneLeft = computeScaledInterval(base, rate, 'high', 4, 1); // 1.9 mult → interval≈10.5
    expect(oneLeft).toBeLessThan(full);
    expect(oneLeft).toBeCloseTo(20 / 1.9, 1);
  });

  it('high tier + custom spawn rate multiplier compound correctly', () => {
    const base = 20;
    const rate = 2.0; // host doubled spawn rate
    const oneLeft = computeScaledInterval(base, rate, 'high', 4, 1); // 2.0 * 1.9 = 3.8 → 20/3.8 ≈ 5.26
    expect(oneLeft).toBeCloseTo(20 / (2.0 * 1.9), 1);
  });
});
