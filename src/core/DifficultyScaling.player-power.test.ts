import { describe, expect, it } from 'vitest';
import {
  computeDifficultyLevel,
  generateScaledEndlessWave,
  getContinuousHealthMultiplier,
  type DifficultyInput,
} from './DifficultyScaling';
import { computePlayerPower } from '../shared/PlayerPowerModel';

const legacyBase: DifficultyInput = {
  score: 0,
  elapsedTime: 600,
  combo: 0,
  totalKills: 0,
  playerLevel: 0,
  playerCount: 1,
};

function waveCount(wave: number, difficulty: number): number {
  return generateScaledEndlessWave(wave, difficulty)
    .reduce((total, entry) => total + entry.count, 0);
}

describe('SP player-power pressure integration', () => {
  it('bypasses overlapping legacy level, buff, combo, kill, and companion bonuses', () => {
    const playerPower = computePlayerPower({
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 2 },
    });
    const clean = computeDifficultyLevel({ ...legacyBase, playerPower });
    const inflatedLegacy = computeDifficultyLevel({
      ...legacyBase,
      combo: 999,
      totalKills: 99_999,
      playerLevel: 9,
      buffPower: 99,
      companionCount: 99,
      playerPower,
    });
    expect(inflatedLegacy).toBe(clean);
  });

  it('moves final difficulty, aggregate health, and wave count for the reported case', () => {
    const baselinePower = computePlayerPower({
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 2 },
    });
    const highPower = computePlayerPower({
      score: 1_000_000,
      survivalSeconds: 600,
      streak: 250,
      blaster: { damage: 2, shotsPerSecond: 9, projectilesPerShot: 4 },
      companions: { guardian: 2, hunter: 2 },
    });
    const baselineDifficulty = computeDifficultyLevel({ ...legacyBase, playerPower: baselinePower });
    const highDifficulty = computeDifficultyLevel({ ...legacyBase, playerPower: highPower });
    const baselineCount = waveCount(50, baselineDifficulty);
    const highCount = waveCount(50, highDifficulty);
    const baselineHealth = baselineCount * getContinuousHealthMultiplier(baselineDifficulty);
    const highHealth = highCount * getContinuousHealthMultiplier(highDifficulty);

    expect(highDifficulty).toBeGreaterThan(baselineDifficulty + 2);
    expect(highHealth).toBeGreaterThan(baselineHealth);
    expect(highCount).toBeGreaterThan(baselineCount);
  });

  it('leaves a struggling baseline player without meaningful dominance uplift', () => {
    const struggling = computePlayerPower({
      score: 1_000,
      survivalSeconds: 5,
      streak: 0,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 2 },
    });
    expect(struggling.difficultyBonus).toBeLessThan(0.05);
    expect(struggling.hpMultiplier).toBeCloseTo(1, 1);
  });
});
