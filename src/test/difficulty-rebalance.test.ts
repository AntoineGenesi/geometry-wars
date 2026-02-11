/**
 * Difficulty Scaling Verification Tests
 *
 * Verifies the difficulty system meets these requirements:
 * 1. Early game (first 30-60s) stays easy — gentle on-ramp
 * 2. Difficulty ramps up meaningfully with score, time, kills, and buffs
 * 3. At 100M+ score, enemies are a serious challenge
 * 4. Tier HP multipliers match player power scaling (hot hands, damage mult)
 * 5. Splitting enemies appear as a core mechanic, not a rare event
 */

import { describe, it, expect } from 'vitest';
import {
  computeDifficultyLevel,
  generateScaledEndlessWave,
  getDifficultyTier,
  getMaxSpawnTier,
  type DifficultyInput,
} from '../core/DifficultyScaling';

// ============================================================================
// Helper: compute total enemy count from a scaled wave
// ============================================================================

function totalEnemyCount(waveNum: number, difficultyLevel: number): number {
  const wave = generateScaledEndlessWave(waveNum, difficultyLevel);
  return wave.reduce((sum, entry) => sum + entry.count, 0);
}

// ============================================================================
// 1. Difficulty level progression — faster ramp with score milestones
// ============================================================================

describe('Difficulty Level Progression', () => {
  const baseInput: DifficultyInput = {
    score: 0,
    elapsedTime: 0,
    combo: 0,
    totalKills: 0,
    playerLevel: 0,
  };

  it('should stay at Tier 0 in the first 30 seconds with low score', () => {
    // At 5K score, 30s elapsed — just started
    const level = computeDifficultyLevel({ ...baseInput, score: 5_000, elapsedTime: 30 });
    expect(level).toBeLessThan(0.5); // Tier 0
  });

  it('should start reaching Tier 1 around 50K-100K score', () => {
    const level = computeDifficultyLevel({ ...baseInput, score: 100_000, elapsedTime: 300 });
    expect(level).toBeGreaterThanOrEqual(1.0);
    expect(level).toBeLessThan(3.0);
  });

  it('should reach Tier 2 around 500K score', () => {
    const level = computeDifficultyLevel({ ...baseInput, score: 500_000, elapsedTime: 600 });
    expect(level).toBeGreaterThanOrEqual(1.5);
    expect(level).toBeLessThan(4.0);
  });

  it('should reach Tier 3+ at 3-6M points (real challenge)', () => {
    const at3M = computeDifficultyLevel({ ...baseInput, score: 3_000_000, elapsedTime: 900 });
    expect(at3M).toBeGreaterThanOrEqual(3.0);

    const at6M = computeDifficultyLevel({ ...baseInput, score: 6_000_000, elapsedTime: 1200 });
    expect(at6M).toBeGreaterThanOrEqual(4.0);
  });

  it('should reach Tier 4 well before 50M score', () => {
    const at10M = computeDifficultyLevel({ ...baseInput, score: 10_000_000, elapsedTime: 1500 });
    expect(at10M).toBeGreaterThanOrEqual(4.0);
  });

  it('player level should contribute meaningfully to difficulty', () => {
    // Level 9 player has more buffs — difficulty should scale with that
    const withoutLevel = computeDifficultyLevel({ ...baseInput, score: 100_000, elapsedTime: 300 });
    const withLevel = computeDifficultyLevel({ ...baseInput, score: 100_000, elapsedTime: 300, playerLevel: 9 });
    const difference = withLevel - withoutLevel;
    expect(difference).toBeGreaterThanOrEqual(0.5);
    expect(difference).toBeLessThanOrEqual(1.5);
  });

  it('time contributes moderate difficulty ramp', () => {
    // 5 minutes of time adds about 0.5 level
    const timeOnly = computeDifficultyLevel({ ...baseInput, elapsedTime: 300 });
    expect(timeOnly).toBeGreaterThanOrEqual(0.3);
    expect(timeOnly).toBeLessThan(1.5);
  });

  it('kill count adds difficulty for aggressive players', () => {
    const noKills = computeDifficultyLevel({ ...baseInput, score: 100_000, elapsedTime: 300 });
    const withKills = computeDifficultyLevel({
      ...baseInput, score: 100_000, elapsedTime: 300, totalKills: 1400,
    });
    expect(withKills - noKills).toBeGreaterThanOrEqual(1.0);
  });
});

// ============================================================================
// 2. Enemy counts per wave — should be challenging, with real numbers
// ============================================================================

describe('Enemy Counts Per Wave', () => {
  it('early waves (1-3) at low difficulty should have small groups', () => {
    for (let wave = 1; wave <= 3; wave++) {
      const count = totalEnemyCount(wave, 0);
      expect(count).toBeLessThanOrEqual(15);
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  it('mid waves (10-20) should have meaningful enemy count', () => {
    for (let wave = 10; wave <= 20; wave++) {
      const count = totalEnemyCount(wave, 2.0);
      expect(count).toBeGreaterThanOrEqual(10);
      expect(count).toBeLessThanOrEqual(60);
    }
  });

  it('high difficulty should produce large waves', () => {
    const wave30 = totalEnemyCount(30, 4.0);
    expect(wave30).toBeGreaterThanOrEqual(30);
    expect(wave30).toBeLessThanOrEqual(100);
  });

  it('extreme difficulty (5+) should produce aggressive waves', () => {
    const count = totalEnemyCount(40, 5.5);
    expect(count).toBeGreaterThanOrEqual(40);
    expect(count).toBeLessThanOrEqual(120);
  });
});

// ============================================================================
// 3. Tier multipliers — scaled to match player power
// ============================================================================

describe('Tier Multipliers', () => {
  it('Tier 1 (Hardened) should be a noticeable step up', () => {
    const tier = getDifficultyTier(1);
    expect(tier.healthMultiplier).toBe(3.0);
    expect(tier.speedMultiplier).toBe(1.15);
  });

  it('Tier 2 (Veteran) should require sustained fire', () => {
    const tier = getDifficultyTier(2);
    expect(tier.healthMultiplier).toBe(10.0);
    expect(tier.speedMultiplier).toBe(1.30);
    expect(tier.splitCount).toBe(2);
  });

  it('Tier 3 (Elite) should be tanky with dangerous children', () => {
    const tier = getDifficultyTier(3);
    expect(tier.healthMultiplier).toBe(25.0);
    expect(tier.speedMultiplier).toBe(1.50);
    expect(tier.splitCount).toBe(3);
    expect(tier.splitChildTier).toBe(1); // hardened children
  });

  it('Tier 4 (Nightmare) should be a real threat', () => {
    const tier = getDifficultyTier(4);
    expect(tier.healthMultiplier).toBe(60.0);
    expect(tier.speedMultiplier).toBe(1.70);
    expect(tier.splitCount).toBe(4);
    expect(tier.splitChildTier).toBe(2); // veteran children
  });

  it('split children should be lower tier than parent', () => {
    const tier3 = getDifficultyTier(3);
    const tier4 = getDifficultyTier(4);
    expect(tier3.splitChildTier).toBeLessThan(tier3.tier);
    expect(tier4.splitChildTier).toBeLessThan(tier4.tier);
  });

  it('HP multipliers should roughly match player damage scaling', () => {
    // Player at high level + hot hands 5 = ~8.75x damage
    // Tier 3 (25x HP) with base 2 HP grunt = 50 HP / 8.75 = ~6 bullets
    // Tier 4 (60x HP) with base 2 HP grunt = 120 HP / 8.75 = ~14 bullets
    // These numbers create real tension without being bullet sponges
    const tier3 = getDifficultyTier(3);
    const tier4 = getDifficultyTier(4);
    expect(tier3.healthMultiplier / 8.75).toBeLessThan(5); // < 5 shots for 1HP enemy
    expect(tier4.healthMultiplier / 8.75).toBeLessThan(10); // < 10 shots for 1HP enemy
  });
});

// ============================================================================
// 4. Enemy type introduction — earlier and more aggressive
// ============================================================================

describe('Enemy Type Introduction', () => {
  it('splitting enemies should appear by wave 6', () => {
    const entries = generateScaledEndlessWave(6, 1.0);
    const hasSplitting = entries.some(e =>
      ['giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron',
       'titan_grunt', 'titan_spinner', 'titan_weaver', 'splitter'].includes(e.type),
    );
    expect(hasSplitting).toBe(true);
  });

  it('hard enemies should appear by wave 5', () => {
    const entries = generateScaledEndlessWave(5, 2.0);
    const hasHard = entries.some(e =>
      ['snake', 'repulsor', 'gravity_well', 'spawner', 'cluster',
       'fractal', 'phaser', 'stealth_stalker'].includes(e.type),
    );
    expect(hasHard).toBe(true);
  });

  it('elite enemies should appear by wave 8', () => {
    const entries = generateScaledEndlessWave(8, 3.0);
    const hasElite = entries.some(e =>
      ['gate', 'virus', 'painter'].includes(e.type),
    );
    expect(hasElite).toBe(true);
  });

  it('wave 1 at difficulty 0 should only have basic + mid enemies', () => {
    const entries = generateScaledEndlessWave(1, 0);
    // Wave 1 should have no hard/elite/splitting (too early)
    const allBasicOrMid = entries.every(e =>
      ['grunt', 'wanderer', 'duck', 'weaver', 'spinner', 'rocket',
       'neutron', 'mayfly', 'helix', 'swarm', 'lurker', 'orbiter',
       'approach_glow'].includes(e.type),
    );
    expect(allBasicOrMid).toBe(true);
  });

  it('high difficulty waves should have multiple enemy categories', () => {
    const entries = generateScaledEndlessWave(20, 4.0);
    const categories = new Set<string>();
    for (const e of entries) {
      if (['grunt', 'wanderer', 'duck'].includes(e.type)) categories.add('basic');
      if (['gate', 'virus', 'painter'].includes(e.type)) categories.add('elite');
      if (['snake', 'repulsor', 'gravity_well', 'spawner', 'cluster',
           'fractal', 'phaser', 'stealth_stalker'].includes(e.type)) categories.add('hard');
      if (['giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron',
           'titan_grunt', 'titan_spinner', 'titan_weaver', 'splitter'].includes(e.type)) categories.add('splitting');
    }
    // Should have at least 3 different categories at high difficulty
    expect(categories.size).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// 5. Speed scaling at tiers
// ============================================================================

describe('Enemy Speed Scaling', () => {
  it('Tier 0 enemies should have no speed increase', () => {
    const tier = getDifficultyTier(0);
    expect(tier.speedMultiplier).toBe(1.0);
  });

  it('Tier 1 speed increase should be 15%', () => {
    const tier = getDifficultyTier(1);
    expect(tier.speedMultiplier).toBe(1.15);
  });

  it('Tier 4 speed should be 70% increase', () => {
    const tier = getDifficultyTier(4);
    expect(tier.speedMultiplier).toBe(1.70);
  });

  it('speed scaling should increase monotonically', () => {
    for (let i = 1; i <= 4; i++) {
      const prev = getDifficultyTier(i - 1);
      const curr = getDifficultyTier(i);
      expect(curr.speedMultiplier).toBeGreaterThan(prev.speedMultiplier);
    }
  });
});

// ============================================================================
// 6. Full game simulation — difficulty at user's reported scenario
// ============================================================================

describe('Full Game Simulation', () => {
  it('at 440M score with 1.4K kills should be very high difficulty', () => {
    const diffLevel = computeDifficultyLevel({
      score: 440_000_000,
      elapsedTime: 2000,
      combo: 100,
      totalKills: 1400,
      playerLevel: 9,
    });
    // Should be well past Tier 4 — extreme difficulty
    expect(diffLevel).toBeGreaterThanOrEqual(6.0);
    expect(getMaxSpawnTier(diffLevel)).toBe(4); // capped at max tier
  });

  it('waves at extreme difficulty should have large enemy groups', () => {
    const count = totalEnemyCount(30, 6.0);
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it('progression summary: difficulty level at key score milestones', () => {
    const milestones = [
      { score: 10_000, time: 60, label: '10K' },
      { score: 50_000, time: 180, label: '50K' },
      { score: 100_000, time: 300, label: '100K' },
      { score: 500_000, time: 600, label: '500K' },
      { score: 1_000_000, time: 900, label: '1M' },
      { score: 3_000_000, time: 1200, label: '3M' },
      { score: 6_000_000, time: 1500, label: '6M' },
      { score: 10_000_000, time: 1800, label: '10M' },
      { score: 50_000_000, time: 3600, label: '50M' },
    ];

    const results = milestones.map(m => {
      const level = computeDifficultyLevel({
        score: m.score, elapsedTime: m.time, combo: 0, totalKills: 0, playerLevel: 0,
      });
      return { label: m.label, diffLevel: level, tier: getMaxSpawnTier(level) };
    });

    // Key assertions about the harder progression
    expect(results[0].tier).toBe(0); // 10K: still easy on-ramp
    expect(results[2].tier).toBeGreaterThanOrEqual(1); // 100K: Tier 1+
    expect(results[3].tier).toBeGreaterThanOrEqual(1); // 500K: Tier 1+
    expect(results[4].tier).toBeGreaterThanOrEqual(2); // 1M: Tier 2+
    expect(results[5].tier).toBeGreaterThanOrEqual(3); // 3M: Tier 3+
    expect(results[6].tier).toBeGreaterThanOrEqual(4); // 6M: Tier 4 (Nightmare)
    expect(results[7].tier).toBe(4); // 10M: deep Nightmare
    expect(results[8].tier).toBe(4); // 50M: deep Nightmare (capped)
  });
});
