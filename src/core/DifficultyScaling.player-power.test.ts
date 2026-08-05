import { describe, expect, it } from 'vitest';
import {
  computeDifficultyLevel,
  generateScaledEndlessWave,
  getContinuousHealthMultiplier,
  type DifficultyInput,
} from './DifficultyScaling';
import {
  computePlayerPower,
  GUARDIAN_SHOTS_PER_SECOND,
  HUNTER_SHOTS_PER_SECOND,
} from '../shared/PlayerPowerModel';

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
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
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
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
    });
    const highPower = computePlayerPower({
      score: 1_000_000,
      survivalSeconds: 600,
      streak: 250,
      blaster: { damage: 2, shotsPerSecond: 9, projectilesPerShot: 4 },
      companions: {
        guardian: 2,
        hunter: 2,
        guardianDamage: 2,
        hunterDamage: 2,
        guardianShotsPerSecond: GUARDIAN_SHOTS_PER_SECOND,
        hunterShotsPerSecond: HUNTER_SHOTS_PER_SECOND,
      },
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

  it('beats the old same-wave high-power pressure with controlled inputs', () => {
    const legacyHighPower = computeDifficultyLevel({
      ...legacyBase,
      score: 1_000_000,
      totalKills: 250,
      playerLevel: 9,
      companionCount: 4,
    });
    const sharedPower = computePlayerPower({
      score: 1_000_000,
      survivalSeconds: 600,
      streak: 250,
      blaster: { damage: 2, shotsPerSecond: 9, projectilesPerShot: 4 },
      companions: {
        guardian: 2,
        hunter: 2,
        guardianDamage: 2,
        hunterDamage: 2,
        guardianShotsPerSecond: GUARDIAN_SHOTS_PER_SECOND,
        hunterShotsPerSecond: HUNTER_SHOTS_PER_SECOND,
      },
    });
    const sharedHighPower = computeDifficultyLevel({
      ...legacyBase,
      score: 1_000_000,
      totalKills: 250,
      playerLevel: 9,
      companionCount: 4,
      playerPower: sharedPower,
    });
    const legacyCount = waveCount(50, legacyHighPower);
    const sharedCount = waveCount(50, sharedHighPower);
    const legacyHealth = legacyCount * getContinuousHealthMultiplier(legacyHighPower);
    const sharedHealth = sharedCount * getContinuousHealthMultiplier(sharedHighPower);

    expect(sharedHighPower).toBeGreaterThan(legacyHighPower);
    expect(sharedCount).toBeGreaterThan(legacyCount);
    expect(sharedHealth).toBeGreaterThan(legacyHealth);
  });

  it('leaves a struggling baseline player without meaningful dominance uplift', () => {
    const struggling = computePlayerPower({
      score: 1_000,
      survivalSeconds: 5,
      streak: 0,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
    });
    expect(struggling.difficultyBonus).toBeLessThan(0.05);
    expect(struggling.hpMultiplier).toBe(1);
  });
});
