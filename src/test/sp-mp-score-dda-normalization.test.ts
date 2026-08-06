import { describe, expect, it } from 'vitest';
import { ScoreManager } from '../core/ScoreManager';
import { computePlayerPower } from '../shared/PlayerPowerModel';
import { ENEMY_SCORES } from '../shared/GameBalanceConstants';

type MockPlayer = {
  score: number;
  multiplier: number;
  addScore: (points: number) => void;
  addMultiplier: (amount: number) => void;
};

function makeMockPlayer(): MockPlayer {
  return {
    score: 0,
    multiplier: 1,
    addScore(points: number) {
      this.score += points * this.multiplier;
    },
    addMultiplier(amount: number) {
      this.multiplier += amount;
    },
  };
}

function runSpScoreTrace(enemyTypes: string[]) {
  const player = makeMockPlayer();
  const scoreManager = new ScoreManager();
  scoreManager.setPlayer(player as never);

  for (const enemyType of enemyTypes) {
    scoreManager.awardKill(ENEMY_SCORES[enemyType] ?? 25, enemyType);
    scoreManager.collectGeom();
  }

  return {
    kills: enemyTypes.length,
    rawScore: scoreManager.getRawKillScore(),
    comboAdjustedScore: scoreManager.getComboAdjustedKillScore(),
    displayScore: player.score,
    multiplier: player.multiplier,
  };
}

function runMpScoreTrace(enemyTypes: string[]) {
  let score = 0;
  const multiplier = 1;
  let rawScore = 0;

  for (const enemyType of enemyTypes) {
    const baseScore = ENEMY_SCORES[enemyType] ?? 25;
    rawScore += baseScore;
    score += baseScore * multiplier;
  }

  return {
    kills: enemyTypes.length,
    rawScore,
    displayScore: score,
    multiplier,
  };
}

describe('SP/MP scoring and DDA normalization proof', () => {
  it('proves comparable kill streams diverge in display score and need explicit MP player-power fields', () => {
    const enemyTypes = Array.from({ length: 6 }, () => [
      'grunt',
      'wanderer',
      'weaver',
      'spinner',
      'rocket',
    ]).flat();

    const sp = runSpScoreTrace(enemyTypes);
    const mp = runMpScoreTrace(enemyTypes);

    expect(sp.kills).toBe(mp.kills);
    expect(sp.rawScore).toBe(mp.rawScore);
    expect(sp.comboAdjustedScore).toBeGreaterThan(mp.rawScore);
    expect(sp.displayScore).toBeGreaterThan(mp.displayScore * 5);

    const legacyMpPower = computePlayerPower({
      score: mp.displayScore,
      survivalSeconds: 300,
      streak: mp.kills,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
    });
    const normalizedMpPower = computePlayerPower({
      score: mp.displayScore,
      rawScore: mp.rawScore,
      multipliedScore: mp.displayScore,
      totalKills: mp.kills,
      survivalSeconds: 300,
      streak: mp.kills,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
    });

    expect(legacyMpPower.killPressure).toBe(0);
    expect(normalizedMpPower.killPressure).toBeGreaterThan(0);
    expect(normalizedMpPower.difficultyBonus).toBeGreaterThan(legacyMpPower.difficultyBonus);
    expect(normalizedMpPower.rawScore).toBe(mp.rawScore);
    expect(normalizedMpPower.multipliedScore).toBe(mp.displayScore);
  });
});
