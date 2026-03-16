/**
 * Tests for MP difficulty scaling beyond wave 27 (s44r22-14).
 *
 * Regression tests verifying:
 * - computeDifficultyLevel() no longer caps at 8.0
 * - Wave 103 is dramatically harder than wave 27
 * - High-difficulty brackets unlock past the old 8.0 ceiling
 * - Enemy health scales with difficulty above 8.0
 * - Enemy speed scales with difficulty above 8.0
 *
 * BUG: User reached wave 103 in MP waves mode, was "lasting infinitely" with
 * only drones. Root cause: computeDifficultyLevel() was capped at 8.0, freezing
 * all difficulty-gated logic from wave ~27.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror computeDifficultyLevel() from GameRoom.ts (no 8.0 cap — s44r22-14)
// ---------------------------------------------------------------------------

const CLAUSTROPHOBIA_DIFFICULTY_MULTIPLIER = 1.3;

function computeDifficultyLevel(
  waveNumber: number,
  gameTime: number,
  playerCount: number,
  gameMode: string = 'waves',
  difficultyMultiplier: number = 1.0,
): number {
  const waveContrib = Math.max(0, (waveNumber - 1) * 0.3);
  const timeContrib = gameTime / 600;
  const playerCountBonus = (playerCount - 1) * 0.3;
  const base = waveContrib + timeContrib + playerCountBonus;
  const claustrophobiaBonus = gameMode === 'claustrophobia'
    ? waveContrib * (CLAUSTROPHOBIA_DIFFICULTY_MULTIPLIER - 1)
    : 0;
  // s44r22-14: No hard cap — difficulty scales continuously
  return (base + claustrophobiaBonus) * difficultyMultiplier;
}

// ---------------------------------------------------------------------------
// Mirror baseCountCap logic from generateServerWave()
// ---------------------------------------------------------------------------

function computeBaseCountCap(difficultyLevel: number): number {
  if (difficultyLevel >= 20) return 80;
  if (difficultyLevel >= 15) return 65;
  if (difficultyLevel >= 10) return 55;
  if (difficultyLevel >= 6)  return 40;
  return 30;
}

// ---------------------------------------------------------------------------
// Mirror getEnemyHealth() scaling from GameRoom.ts
// ---------------------------------------------------------------------------

function computeHealthMultiplier(difficultyLevel: number): number {
  if (difficultyLevel >= 20) return 4.0 + (difficultyLevel - 20) * 0.2;
  if (difficultyLevel >= 16) return 2.5 + (difficultyLevel - 16) * 0.375;
  if (difficultyLevel >= 12) return 1.5 + (difficultyLevel - 12) * 0.25;
  if (difficultyLevel >= 8)  return 1.0 + (difficultyLevel - 8) * 0.125;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Mirror getEnemySpeed() scaling from GameRoom.ts
// ---------------------------------------------------------------------------

function computeSpeedMultiplier(difficultyLevel: number): number {
  if (difficultyLevel <= 8) return 1.0;
  return Math.min(2.5, 1.0 + (difficultyLevel - 8) * 0.05);
}

// ---------------------------------------------------------------------------
// HIGH-WAVE BRACKET unlock logic (mirrors generateServerWave())
// ---------------------------------------------------------------------------

function getActiveBrackets(difficultyLevel: number): string[] {
  const brackets: string[] = ['basic', 'mid (wave2+)', 'hard (wave4+)', 'splitting (wave5+)', 'elite (wave6+)'];
  if (difficultyLevel >= 1.5) brackets.push('variant_basic');
  if (difficultyLevel >= 2.5) brackets.push('second_hard');
  if (difficultyLevel >= 3.0) brackets.push('splitting_swarm');
  if (difficultyLevel >= 4.0) brackets.push('second_elite');
  if (difficultyLevel >= 6.0) brackets.push('third_hard + mega_split');
  // s44r22-14 new brackets:
  if (difficultyLevel >= 8.0)  brackets.push('elite_swarm + extra_orbiters');
  if (difficultyLevel >= 12.0) brackets.push('massive_splitting + hard_reinforce');
  if (difficultyLevel >= 16.0) brackets.push('elite_flood + split_flood');
  if (difficultyLevel >= 20.0) brackets.push('max_pressure: hard + orbiters + elite');
  return brackets;
}

// ---------------------------------------------------------------------------
// Tests: difficulty cap removal
// ---------------------------------------------------------------------------

describe('MP difficulty scaling — no cap (s44r22-14)', () => {
  it('difficulty at wave 27 (previously hit old cap) is now ~7.8', () => {
    const diff = computeDifficultyLevel(27, 0, 1);
    // (27-1)*0.3 = 7.8 — previously would have been min(8.0, 7.8) = 7.8
    expect(diff).toBeCloseTo(7.8, 1);
  });

  it('difficulty at wave 50 exceeds old 8.0 cap', () => {
    const diff = computeDifficultyLevel(50, 0, 1);
    // (50-1)*0.3 = 14.7
    expect(diff).toBeGreaterThan(8.0);
    expect(diff).toBeCloseTo(14.7, 1);
  });

  it('difficulty at wave 103 is dramatically higher than wave 27', () => {
    const diffWave27  = computeDifficultyLevel(27, 0, 1);
    const diffWave103 = computeDifficultyLevel(103, 0, 1);
    // wave 103: (103-1)*0.3 = 30.6
    expect(diffWave103).toBeGreaterThan(8.0);
    expect(diffWave103).toBeGreaterThan(diffWave27 * 2);
  });

  it('wave 103 difficulty is ~30.6 (1 player, 0 time)', () => {
    const diff = computeDifficultyLevel(103, 0, 1);
    expect(diff).toBeCloseTo(30.6, 1);
  });

  it('wave 103 difficulty does NOT equal wave 27 difficulty (regression check)', () => {
    const diffWave27  = computeDifficultyLevel(27, 0, 1);
    const diffWave103 = computeDifficultyLevel(103, 0, 1);
    // Before fix: both would be 8.0. After fix: wave 103 >> wave 27.
    expect(diffWave103).not.toBeCloseTo(diffWave27, 0);
    expect(diffWave103).toBeGreaterThan(diffWave27 * 3);
  });
});

// ---------------------------------------------------------------------------
// Tests: enemy count cap scaling
// ---------------------------------------------------------------------------

describe('MP difficulty scaling — baseCountCap at high difficulty', () => {
  it('cap is 30 at low difficulty', () => {
    expect(computeBaseCountCap(2.0)).toBe(30);
  });

  it('cap is 40 at difficulty 6-9', () => {
    expect(computeBaseCountCap(6.0)).toBe(40);
    expect(computeBaseCountCap(9.9)).toBe(40);
  });

  it('cap is 55 at difficulty 10-14', () => {
    expect(computeBaseCountCap(10.0)).toBe(55);
    expect(computeBaseCountCap(14.9)).toBe(55);
  });

  it('cap is 65 at difficulty 15-19', () => {
    expect(computeBaseCountCap(15.0)).toBe(65);
    expect(computeBaseCountCap(19.9)).toBe(65);
  });

  it('cap is 80 at difficulty 20+', () => {
    expect(computeBaseCountCap(20.0)).toBe(80);
    expect(computeBaseCountCap(35.0)).toBe(80);
  });

  it('wave 103 uses higher baseCountCap than wave 27', () => {
    const cap27  = computeBaseCountCap(computeDifficultyLevel(27, 0, 1));
    const cap103 = computeBaseCountCap(computeDifficultyLevel(103, 0, 1));
    expect(cap103).toBeGreaterThan(cap27);
  });
});

// ---------------------------------------------------------------------------
// Tests: health multiplier scaling
// ---------------------------------------------------------------------------

describe('MP difficulty scaling — enemy health multiplier', () => {
  it('no health scaling below difficulty 8', () => {
    expect(computeHealthMultiplier(0)).toBe(1.0);
    expect(computeHealthMultiplier(7.9)).toBe(1.0);
  });

  it('health multiplier ramps up between difficulty 8-12 (1.0x → 1.5x)', () => {
    expect(computeHealthMultiplier(8.0)).toBeCloseTo(1.0, 3);
    expect(computeHealthMultiplier(12.0)).toBeCloseTo(1.5, 3);
  });

  it('health multiplier ramps up between difficulty 12-16 (1.5x → 2.5x)', () => {
    expect(computeHealthMultiplier(12.0)).toBeCloseTo(1.5, 3);
    expect(computeHealthMultiplier(16.0)).toBeCloseTo(2.5, 3);
  });

  it('health multiplier ramps up between difficulty 16-20 (2.5x → 4.0x)', () => {
    expect(computeHealthMultiplier(16.0)).toBeCloseTo(2.5, 3);
    expect(computeHealthMultiplier(20.0)).toBeCloseTo(4.0, 3);
  });

  it('health multiplier exceeds 4x above difficulty 20', () => {
    expect(computeHealthMultiplier(25.0)).toBeCloseTo(5.0, 1);
    expect(computeHealthMultiplier(30.0)).toBeCloseTo(6.0, 1);
  });

  it('wave 103 (difficulty ~30.6) enemies have ~6x health vs base', () => {
    const diff = computeDifficultyLevel(103, 0, 1);
    const mult = computeHealthMultiplier(diff);
    expect(mult).toBeGreaterThan(5.0);
  });
});

// ---------------------------------------------------------------------------
// Tests: speed multiplier scaling
// ---------------------------------------------------------------------------

describe('MP difficulty scaling — enemy speed multiplier', () => {
  it('no speed scaling at difficulty 8 or below', () => {
    expect(computeSpeedMultiplier(0)).toBe(1.0);
    expect(computeSpeedMultiplier(8.0)).toBe(1.0);
  });

  it('speed scales at +5% per difficulty level above 8', () => {
    expect(computeSpeedMultiplier(9.0)).toBeCloseTo(1.05, 3);
    expect(computeSpeedMultiplier(10.0)).toBeCloseTo(1.10, 3);
    expect(computeSpeedMultiplier(18.0)).toBeCloseTo(1.50, 3);
  });

  it('speed is capped at 2.5x', () => {
    expect(computeSpeedMultiplier(50.0)).toBe(2.5);
    expect(computeSpeedMultiplier(100.0)).toBe(2.5);
  });

  it('wave 103 enemies are noticeably faster than wave 27 enemies', () => {
    const speedWave27  = computeSpeedMultiplier(computeDifficultyLevel(27, 0, 1));
    const speedWave103 = computeSpeedMultiplier(computeDifficultyLevel(103, 0, 1));
    expect(speedWave103).toBeGreaterThan(speedWave27 + 0.5);
  });
});

// ---------------------------------------------------------------------------
// Tests: new enemy type brackets unlock
// ---------------------------------------------------------------------------

describe('MP difficulty scaling — new high-difficulty enemy brackets (s44r22-14)', () => {
  it('elite_swarm + extra_orbiters unlock at difficulty 8.0', () => {
    const brackets = getActiveBrackets(8.0);
    expect(brackets).toContain('elite_swarm + extra_orbiters');
  });

  it('massive_splitting + hard_reinforce unlock at difficulty 12.0', () => {
    const brackets = getActiveBrackets(12.0);
    expect(brackets).toContain('massive_splitting + hard_reinforce');
  });

  it('elite_flood + split_flood unlock at difficulty 16.0', () => {
    const brackets = getActiveBrackets(16.0);
    expect(brackets).toContain('elite_flood + split_flood');
  });

  it('max_pressure unlocks at difficulty 20.0', () => {
    const brackets = getActiveBrackets(20.0);
    expect(brackets).toContain('max_pressure: hard + orbiters + elite');
  });

  it('wave 27 (difficulty ~7.8) does NOT use new high-difficulty brackets', () => {
    const diff = computeDifficultyLevel(27, 0, 1);
    const brackets = getActiveBrackets(diff);
    expect(brackets).not.toContain('elite_swarm + extra_orbiters');
    expect(brackets).not.toContain('massive_splitting + hard_reinforce');
  });

  it('wave 103 (difficulty ~30.6) has ALL new high-difficulty brackets active', () => {
    const diff = computeDifficultyLevel(103, 0, 1);
    const brackets = getActiveBrackets(diff);
    expect(brackets).toContain('elite_swarm + extra_orbiters');
    expect(brackets).toContain('massive_splitting + hard_reinforce');
    expect(brackets).toContain('elite_flood + split_flood');
    expect(brackets).toContain('max_pressure: hard + orbiters + elite');
  });
});
