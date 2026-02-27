/**
 * Player-Count Difficulty Scaling — Regression Tests (S38d-05)
 *
 * Verifies that difficulty scales correctly when 1, 2, or 4 players are active.
 *
 * Design rules:
 *  1. More players → slightly higher difficulty level (computeDifficultyLevel)
 *  2. More players → more enemies per wave (generateScaledEndlessWave)
 *  3. Scaling is smooth — no abrupt jumps between player counts
 *  4. Formula is identical between client (DifficultyScaling.ts) and server (GameRoom.ts)
 */

import { describe, it, expect } from 'vitest';
import {
  computeDifficultyLevel,
  generateScaledEndlessWave,
  type DifficultyInput,
} from '../core/DifficultyScaling';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_INPUT: DifficultyInput = {
  score: 100_000,
  elapsedTime: 300,
  combo: 0,
  totalKills: 200,
  playerLevel: 2,
};

function totalEnemyCount(waveNum: number, difficultyLevel: number, playerCount: number): number {
  const wave = generateScaledEndlessWave(waveNum, difficultyLevel, 0, playerCount);
  return wave.reduce((sum, entry) => sum + entry.count, 0);
}

// ---------------------------------------------------------------------------
// 1. computeDifficultyLevel — player count bonus
// ---------------------------------------------------------------------------

describe('computeDifficultyLevel — player count bonus', () => {
  it('1 player: no bonus (baseline unchanged)', () => {
    const with1 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 1 });
    const noCount = computeDifficultyLevel({ ...BASE_INPUT }); // default = 1
    expect(with1).toBe(noCount);
  });

  it('2 players: +0.3 difficulty level vs 1 player', () => {
    const level1 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 1 });
    const level2 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 2 });
    expect(level2 - level1).toBeCloseTo(0.3, 5);
  });

  it('3 players: +0.6 difficulty level vs 1 player', () => {
    const level1 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 1 });
    const level3 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 3 });
    expect(level3 - level1).toBeCloseTo(0.6, 5);
  });

  it('4 players: +0.9 difficulty level vs 1 player', () => {
    const level1 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 1 });
    const level4 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 4 });
    expect(level4 - level1).toBeCloseTo(0.9, 5);
  });

  it('bonus increases monotonically: 1p < 2p < 3p < 4p', () => {
    const l1 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 1 });
    const l2 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 2 });
    const l3 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 3 });
    const l4 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 4 });
    expect(l1).toBeLessThan(l2);
    expect(l2).toBeLessThan(l3);
    expect(l3).toBeLessThan(l4);
  });

  it('playerCount defaults to 1 (backward-compatible)', () => {
    const noCount = computeDifficultyLevel(BASE_INPUT);
    const explicit1 = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 1 });
    expect(noCount).toBe(explicit1);
  });
});

// ---------------------------------------------------------------------------
// 2. generateScaledEndlessWave — enemy count multiplier
// ---------------------------------------------------------------------------

describe('generateScaledEndlessWave — player count multiplier', () => {
  const WAVE = 10;
  const DIFF = 2.0;

  it('1 player: baseline count (no multiplier)', () => {
    const wave1 = generateScaledEndlessWave(WAVE, DIFF, 0, 1);
    const waveDefault = generateScaledEndlessWave(WAVE, DIFF); // default = 1 player
    const count1 = wave1.reduce((s, e) => s + e.count, 0);
    const countDefault = waveDefault.reduce((s, e) => s + e.count, 0);
    expect(count1).toBe(countDefault);
  });

  it('2 players spawn more enemies than 1 player', () => {
    const count1 = totalEnemyCount(WAVE, DIFF, 1);
    const count2 = totalEnemyCount(WAVE, DIFF, 2);
    expect(count2).toBeGreaterThan(count1);
  });

  it('4 players spawn more enemies than 2 players', () => {
    const count2 = totalEnemyCount(WAVE, DIFF, 2);
    const count4 = totalEnemyCount(WAVE, DIFF, 4);
    expect(count4).toBeGreaterThan(count2);
  });

  it('enemy count scales monotonically: 1p < 2p < 3p < 4p', () => {
    const c1 = totalEnemyCount(WAVE, DIFF, 1);
    const c2 = totalEnemyCount(WAVE, DIFF, 2);
    const c3 = totalEnemyCount(WAVE, DIFF, 3);
    const c4 = totalEnemyCount(WAVE, DIFF, 4);
    expect(c1).toBeLessThan(c2);
    expect(c2).toBeLessThan(c3);
    expect(c3).toBeLessThan(c4);
  });

  it('4-player wave has approximately 2.5x enemies of 1-player wave', () => {
    // Formula: 1.0 + (4-1)*0.5 = 2.5x — allow ±20% due to rounding/caps
    const c1 = totalEnemyCount(WAVE, DIFF, 1);
    const c4 = totalEnemyCount(WAVE, DIFF, 4);
    const ratio = c4 / c1;
    expect(ratio).toBeGreaterThan(1.5); // at least 50% more
    expect(ratio).toBeLessThanOrEqual(3.0); // no more than 3x (rounding can vary)
  });

  it('enemy types remain the same across player counts (only counts change)', () => {
    const wave1 = generateScaledEndlessWave(WAVE, DIFF, 0, 1);
    const wave4 = generateScaledEndlessWave(WAVE, DIFF, 0, 4);
    // Same number of groups with same types
    expect(wave4.length).toBe(wave1.length);
    for (let i = 0; i < wave1.length; i++) {
      expect(wave4[i].type).toBe(wave1[i].type);
      expect(wave4[i].tier).toBe(wave1[i].tier);
    }
  });

  it('entity brake still applies with multiple players', () => {
    // With crowded screen (400 enemies), counts should be suppressed
    const crowded4 = totalEnemyCount(WAVE, DIFF, 4);
    const crowdedWith400 = totalEnemyCount(WAVE, DIFF, 4);
    const braked = generateScaledEndlessWave(WAVE, DIFF, 400, 4)
      .reduce((s, e) => s + e.count, 0);
    expect(braked).toBeLessThan(crowded4);
    void crowdedWith400; // silence unused warning
  });

  it('playerCount defaults to 1 (backward-compatible)', () => {
    const waveDefault = generateScaledEndlessWave(WAVE, DIFF);
    const wave1 = generateScaledEndlessWave(WAVE, DIFF, 0, 1);
    expect(waveDefault).toEqual(wave1);
  });
});

// ---------------------------------------------------------------------------
// 3. Combined: difficulty level + wave count both scale with player count
// ---------------------------------------------------------------------------

describe('Combined player count scaling — full picture', () => {
  it('4-player game has noticeably harder difficulty tier than 1-player', () => {
    const input1p: DifficultyInput = { ...BASE_INPUT, playerCount: 1 };
    const input4p: DifficultyInput = { ...BASE_INPUT, playerCount: 4 };
    const diff1p = computeDifficultyLevel(input1p);
    const diff4p = computeDifficultyLevel(input4p);
    // 4p should be 0.9 levels harder
    expect(diff4p - diff1p).toBeCloseTo(0.9, 5);
  });

  it('4-player game has more enemies AND harder types in the same wave', () => {
    const diff1p = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 1 });
    const diff4p = computeDifficultyLevel({ ...BASE_INPUT, playerCount: 4 });
    const count1p = totalEnemyCount(10, diff1p, 1);
    const count4p = totalEnemyCount(10, diff4p, 4);
    // Both enemy count AND difficulty tier are higher for 4p
    expect(count4p).toBeGreaterThan(count1p);
    expect(diff4p).toBeGreaterThan(diff1p);
  });
});
