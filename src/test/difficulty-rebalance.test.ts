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
  getContinuousHealthMultiplier,
  getContinuousSpeedMultiplier,
  getContinuousScaleMultiplier,
  MAX_TIER,
  type DifficultyInput,
} from '../core/DifficultyScaling';
import { BuffManager, StackBuffType } from '../buffs/BuffManager';

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

  it('entity count brake: no effect below 200 entities', () => {
    // Waves with 0 or 100 entities should produce the same counts
    const withNone = generateScaledEndlessWave(20, 4.0, 0);
    const withFew = generateScaledEndlessWave(20, 4.0, 100);
    const totalNone = withNone.reduce((s, e) => s + e.count, 0);
    const totalFew = withFew.reduce((s, e) => s + e.count, 0);
    expect(totalNone).toBe(totalFew); // below 200 → no change
  });

  it('entity count brake: reduces wave counts above 200 entities', () => {
    const waveBase = generateScaledEndlessWave(20, 4.0, 0);
    const wave300 = generateScaledEndlessWave(20, 4.0, 300);
    const totalBase = waveBase.reduce((s, e) => s + e.count, 0);
    const total300 = wave300.reduce((s, e) => s + e.count, 0);
    // At 300 entities (brake ≈ 0.67), should be meaningfully fewer
    expect(total300).toBeLessThan(totalBase * 0.85);
    expect(total300).toBeGreaterThan(0); // still spawning something
  });

  it('entity count brake: wave structure (types) unchanged at high counts', () => {
    // Same enemy types should appear regardless of brake — only counts change
    const waveBase = generateScaledEndlessWave(20, 4.0, 0);
    const waveHigh = generateScaledEndlessWave(20, 4.0, 400);
    const typesBase = waveBase.map(e => e.type).sort();
    const typesHigh = waveHigh.map(e => e.type).sort();
    expect(typesBase).toEqual(typesHigh);
  });

  it('entity count brake: floors at 0.40 at 500+ entities', () => {
    // At 500 entities: brake = max(0.40, 200/500) = max(0.40, 0.40) = 0.40
    // At 1000 entities: brake = max(0.40, 200/1000) = max(0.40, 0.20) = 0.40
    // Both should produce the same counts (floor has kicked in)
    const wave500 = generateScaledEndlessWave(20, 4.0, 500);
    const wave1000 = generateScaledEndlessWave(20, 4.0, 1000);
    const total500 = wave500.reduce((s, e) => s + e.count, 0);
    const total1000 = wave1000.reduce((s, e) => s + e.count, 0);
    expect(total500).toBe(total1000); // floor kicks in at same brake value
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

// ============================================================================
// 7. Super-tier continuous scaling (beyond tier 4) — regression tests
// ============================================================================

describe('Super-Tier Continuous Scaling (difficultyLevel > MAX_TIER)', () => {
  it('getContinuousHealthMultiplier: at MAX_TIER matches discrete tier health', () => {
    const tier4 = getDifficultyTier(MAX_TIER);
    expect(getContinuousHealthMultiplier(MAX_TIER)).toBeCloseTo(tier4.healthMultiplier, 5);
  });

  it('getContinuousHealthMultiplier: at difficulty 8, enemies have more HP than at difficulty 4', () => {
    const at4 = getContinuousHealthMultiplier(4);
    const at8 = getContinuousHealthMultiplier(8);
    expect(at8).toBeGreaterThan(at4);
  });

  it('getContinuousHealthMultiplier: monotonically increases beyond tier 4', () => {
    const at4 = getContinuousHealthMultiplier(4);
    const at5 = getContinuousHealthMultiplier(5);
    const at6 = getContinuousHealthMultiplier(6);
    const at8 = getContinuousHealthMultiplier(8);
    expect(at5).toBeGreaterThan(at4);
    expect(at6).toBeGreaterThan(at5);
    expect(at8).toBeGreaterThan(at6);
  });

  it('getContinuousHealthMultiplier: at difficulty 8, ~2x tier-4 base (60 * 2 = 120)', () => {
    // Formula: 60 * (1 + (8-4) * 0.25) = 60 * 2.0 = 120
    expect(getContinuousHealthMultiplier(8)).toBeCloseTo(120, 1);
  });

  it('getContinuousHealthMultiplier: capped at 500', () => {
    expect(getContinuousHealthMultiplier(100)).toBe(500);
  });

  it('getContinuousSpeedMultiplier: at difficulty 8, faster than at difficulty 4', () => {
    const at4 = getContinuousSpeedMultiplier(4);
    const at8 = getContinuousSpeedMultiplier(8);
    expect(at8).toBeGreaterThan(at4);
  });

  it('getContinuousSpeedMultiplier: capped at 3.0', () => {
    expect(getContinuousSpeedMultiplier(100)).toBe(3.0);
  });

  it('getContinuousScaleMultiplier: at difficulty 8, larger than at difficulty 4', () => {
    const at4 = getContinuousScaleMultiplier(4);
    const at8 = getContinuousScaleMultiplier(8);
    expect(at8).toBeGreaterThan(at4);
  });

  it('getContinuousScaleMultiplier: capped at 2.5', () => {
    expect(getContinuousScaleMultiplier(100)).toBe(2.5);
  });

  it('generateScaledEndlessWave: entries have difficultyLevel set when above MAX_TIER', () => {
    const wave = generateScaledEndlessWave(20, MAX_TIER + 2);
    expect(wave.length).toBeGreaterThan(0);
    for (const entry of wave) {
      expect(entry.difficultyLevel).toBe(MAX_TIER + 2);
    }
  });

  it('generateScaledEndlessWave: entries have no difficultyLevel when at or below MAX_TIER', () => {
    const wave = generateScaledEndlessWave(20, MAX_TIER);
    for (const entry of wave) {
      expect(entry.difficultyLevel).toBeUndefined();
    }
  });

  it('generateScaledEndlessWave: entries have no difficultyLevel at difficulty 3', () => {
    const wave = generateScaledEndlessWave(10, 3);
    for (const entry of wave) {
      expect(entry.difficultyLevel).toBeUndefined();
    }
  });
});

// ============================================================================
// 8. Buff power contribution to difficulty
// ============================================================================

describe('Buff Power Difficulty Contribution', () => {
  const baseInput: DifficultyInput = {
    score: 5_000_000,
    elapsedTime: 900,
    combo: 0,
    totalKills: 500,
    playerLevel: 5,
  };

  it('buffPower defaults to 0 — existing tests unaffected', () => {
    const withoutBuff = computeDifficultyLevel({ ...baseInput });
    const withZeroBuff = computeDifficultyLevel({ ...baseInput, buffPower: 0 });
    expect(withoutBuff).toBe(withZeroBuff);
  });

  it('high buffPower raises difficulty at least 2 levels above no-buff baseline', () => {
    // buffPower 8 → buffBonus = min(3.0, 8 * 0.25) = 2.0
    const noBuff = computeDifficultyLevel({ ...baseInput, buffPower: 0 });
    const highBuff = computeDifficultyLevel({ ...baseInput, buffPower: 8 });
    expect(highBuff - noBuff).toBeGreaterThanOrEqual(2.0);
  });

  it('buffPower is capped at +3.0 difficulty levels', () => {
    // Even at buffPower 20 (god-mode), bonus caps at 3.0
    const noBuff = computeDifficultyLevel({ ...baseInput, buffPower: 0 });
    const godMode = computeDifficultyLevel({ ...baseInput, buffPower: 20 });
    expect(godMode - noBuff).toBeLessThanOrEqual(3.0 + 0.001); // small tolerance
  });

  it('player with example load-out (buffPower ~8.45) gets meaningfully harder game', () => {
    // 4x hot hands (1.2) + 3x trigger happy (0.75) + 5x shock aura (2.0)
    // + 6x incendiary (1.8) + 4x volatile (2.0) + 1x afterburner (0.1)
    // + 3x magnetism (0.3) + 2x tough times (0.3) = ~8.45
    const buffPowerExample = 4 * 0.30 + 3 * 0.25 + 5 * 0.40 + 6 * 0.30 + 4 * 0.50 + 1 * 0.10 + 3 * 0.10 + 2 * 0.15;
    expect(buffPowerExample).toBeGreaterThanOrEqual(6.0);

    const noBuff = computeDifficultyLevel({ ...baseInput, buffPower: 0 });
    const withExampleBuff = computeDifficultyLevel({ ...baseInput, buffPower: buffPowerExample });
    expect(withExampleBuff - noBuff).toBeGreaterThanOrEqual(1.5);
  });

  it('moderate buff stack (buffPower 4) gives meaningful but not extreme bonus', () => {
    const noBuff = computeDifficultyLevel({ ...baseInput, buffPower: 0 });
    const moderateBuff = computeDifficultyLevel({ ...baseInput, buffPower: 4 });
    const diff = moderateBuff - noBuff;
    expect(diff).toBeGreaterThanOrEqual(0.9);
    expect(diff).toBeLessThanOrEqual(1.5);
  });
});

// ============================================================================
// 9. Phase 2 rebalance — score-curve acceptance criteria
// ============================================================================

describe('Phase 2 Rebalance: Score Curve Acceptance Criteria', () => {
  // Typical-play milestones from the task spec
  const milestone5M = {
    score: 5_000_000, elapsedTime: 1200, combo: 0,
    totalKills: 500, playerLevel: 9, buffPower: 3.0,
  };
  const milestone50M = {
    score: 50_000_000, elapsedTime: 2700, combo: 0,
    totalKills: 800, playerLevel: 9, buffPower: 6.0,
  };
  const milestone300M = {
    score: 300_000_000, elapsedTime: 5400, combo: 0,
    totalKills: 1295, playerLevel: 9, buffPower: 8.45,
  };

  it('AC1: typical 5M game (20min/500kills/L9/buff3) → difficulty >= 5.0', () => {
    const d = computeDifficultyLevel(milestone5M);
    expect(d).toBeGreaterThanOrEqual(5.0);
  });

  it('AC2: typical 50M game (45min/800kills/L9/buff6) → difficulty >= 8.0', () => {
    const d = computeDifficultyLevel(milestone50M);
    expect(d).toBeGreaterThanOrEqual(8.0);
  });

  it('AC3: typical 300M game (90min/1295kills/L9/buff8.45) → difficulty >= 12.0', () => {
    const d = computeDifficultyLevel(milestone300M);
    expect(d).toBeGreaterThanOrEqual(12.0);
  });

  it('AC4: each 10x score milestone adds >= 1.5 difficulty levels', () => {
    const d5M = computeDifficultyLevel(milestone5M);
    const d50M = computeDifficultyLevel(milestone50M);
    const d300M = computeDifficultyLevel(milestone300M);
    // 5M→50M (10x): should gain at least 1.5 levels
    expect(d50M - d5M).toBeGreaterThanOrEqual(1.5);
    // 50M→300M (6x, not full 10x but meaningful): should also gain >= 1.5
    expect(d300M - d50M).toBeGreaterThanOrEqual(1.5);
  });

  it('AC5: baseCount cap raised at difficulty 6+ — wave 30 at diff 8 allows more basic enemies', () => {
    // At difficulty 6+, baseCountCap = 40 (vs 30 before).
    // Wave 30 at diff 8: difficultyCountBonus=16, sqrt(30)*2≈10, base=(4+10+16)=30→min(40,30)=30
    // Wave 100 at diff 8: sqrt(100)*2=20, base=(4+20+16)=40→min(40,40)=40 (previously capped at 30)
    const wave100Diff8 = generateScaledEndlessWave(100, 8.0, 0);
    const basicEntry = wave100Diff8[0]; // first entry is always basic
    // At wave 100, diff 8: uncapped basic count = (4+20+16) = 40. Cap is 40 now.
    expect(basicEntry.count).toBeGreaterThanOrEqual(35); // meaningfully above old cap of 30
  });

  it('AC6: entityBrake floor raised to 0.60 at difficulty 8+ (was 0.40)', () => {
    // At diff 8, 500 entities: brake = max(0.60, 200/500) = 0.60
    // Crowded wave should retain >= 55% of uncrowded count (floor = 0.60)
    const uncrowded = generateScaledEndlessWave(20, 8.0, 0);
    const crowded = generateScaledEndlessWave(20, 8.0, 500);
    const totalUncrowded = uncrowded.reduce((s, e) => s + e.count, 0);
    const totalCrowded = crowded.reduce((s, e) => s + e.count, 0);
    expect(totalCrowded).toBeGreaterThanOrEqual(totalUncrowded * 0.55);
  });

  it('AC6: entityBrake floor still 0.40 below difficulty 8 (no regression)', () => {
    // At diff 4, 500 entities: brake = max(0.40, 200/500) = 0.40
    // Crowded wave should retain approximately 40% of uncrowded count
    const uncrowded = generateScaledEndlessWave(20, 4.0, 0);
    const crowded = generateScaledEndlessWave(20, 4.0, 500);
    const totalUncrowded = uncrowded.reduce((s, e) => s + e.count, 0);
    const totalCrowded = crowded.reduce((s, e) => s + e.count, 0);
    // Should be < 50% (confirming 0.40 floor, not 0.60)
    expect(totalCrowded).toBeLessThan(totalUncrowded * 0.50);
    expect(totalCrowded).toBeGreaterThan(0);
  });

  it('AC7: early game (5K score, 30s) stays at difficulty < 0.5', () => {
    const d = computeDifficultyLevel({
      score: 5_000, elapsedTime: 30, combo: 0, totalKills: 0, playerLevel: 0,
    });
    expect(d).toBeLessThan(0.5);
  });
});

// ============================================================================
// 10. Continuous Escalation — No Plateau (regression guard)
// ============================================================================

describe('Continuous Escalation — No Plateau', () => {
  // Realistic milestone snapshots: score, time, kills, level, buffPower
  const milestones: Array<DifficultyInput & { label: string }> = [
    { label: '100K',  score: 100_000,     elapsedTime: 120,  combo: 0, totalKills: 50,   playerLevel: 3, buffPower: 0 },
    { label: '1M',    score: 1_000_000,   elapsedTime: 600,  combo: 0, totalKills: 200,  playerLevel: 7, buffPower: 1.0 },
    { label: '5M',    score: 5_000_000,   elapsedTime: 1200, combo: 0, totalKills: 500,  playerLevel: 9, buffPower: 3.0 },
    { label: '20M',   score: 20_000_000,  elapsedTime: 2100, combo: 0, totalKills: 800,  playerLevel: 9, buffPower: 5.0 },
    { label: '100M',  score: 100_000_000, elapsedTime: 3600, combo: 0, totalKills: 1100, playerLevel: 9, buffPower: 7.0 },
    { label: '300M',  score: 300_000_000, elapsedTime: 5400, combo: 0, totalKills: 1295, playerLevel: 9, buffPower: 8.45 },
  ];

  it('should increase difficulty at each milestone', () => {
    let prevLevel = 0;
    for (const m of milestones) {
      const level = computeDifficultyLevel(m);
      expect(level, `difficulty at ${m.label} should exceed previous milestone`).toBeGreaterThan(prevLevel);
      prevLevel = level;
    }
  });

  it('should have at least 1.5 difficulty increase per 10x score jump (5M → 50M)', () => {
    const at5M = computeDifficultyLevel({
      score: 5_000_000, elapsedTime: 1200, combo: 0, totalKills: 500, playerLevel: 9, buffPower: 3.0,
    });
    const at50M = computeDifficultyLevel({
      score: 50_000_000, elapsedTime: 3000, combo: 0, totalKills: 800, playerLevel: 9, buffPower: 5.0,
    });
    expect(at50M - at5M).toBeGreaterThanOrEqual(1.5);
  });

  it('300M with full buff stack should be 5+ levels harder than 5M', () => {
    const at5M = computeDifficultyLevel({
      score: 5_000_000, elapsedTime: 1200, combo: 0, totalKills: 500, playerLevel: 9, buffPower: 3.0,
    });
    const at300M = computeDifficultyLevel({
      score: 300_000_000, elapsedTime: 5400, combo: 0, totalKills: 1295, playerLevel: 9, buffPower: 8.45,
    });
    expect(at300M - at5M).toBeGreaterThanOrEqual(5.0);
  });

  it('each milestone step must add at least 0.5 difficulty (no flat segments)', () => {
    for (let i = 1; i < milestones.length; i++) {
      const prev = computeDifficultyLevel(milestones[i - 1]);
      const curr = computeDifficultyLevel(milestones[i]);
      expect(
        curr - prev,
        `segment ${milestones[i - 1].label} → ${milestones[i].label} should add >= 0.5 levels`,
      ).toBeGreaterThanOrEqual(0.5);
    }
  });
});

// ============================================================================
// 11. BuffManager.getTotalBuffPower() — unit tests
// ============================================================================

describe('BuffManager.getTotalBuffPower()', () => {
  it('returns 0 with no buffs', () => {
    const bm = new BuffManager();
    expect(bm.getTotalBuffPower()).toBe(0);
  });

  it('returns correct value for a single Hot Hands stack', () => {
    const bm = new BuffManager();
    // Hot Hands weight = 0.30 per stack
    (bm as any).stacks.set(StackBuffType.HotHands, 1);
    expect(bm.getTotalBuffPower()).toBeCloseTo(0.30, 5);
  });

  it('returns correct value for a single ShockAura stack', () => {
    const bm = new BuffManager();
    // ShockAura weight = 0.40 per stack
    (bm as any).stacks.set(StackBuffType.ShockAura, 1);
    expect(bm.getTotalBuffPower()).toBeCloseTo(0.40, 5);
  });

  it('user example load-out (4×HOT, 3×TRG, 5×SHK, 6×INC, 4×VLT, 2×TGH, 3×MAG, 1×AFT) returns >= 6.0', () => {
    const bm = new BuffManager();
    const s = (bm as any).stacks as Map<StackBuffType, number>;
    // Manually set stacks without triggering addBuff() (which calls audio engine)
    s.set(StackBuffType.HotHands, 4);        // 4 * 0.30 = 1.20
    s.set(StackBuffType.TriggerHappy, 3);    // 3 * 0.25 = 0.75
    s.set(StackBuffType.ShockAura, 5);       // 5 * 0.40 = 2.00
    s.set(StackBuffType.IncendiaryRounds, 6); // 6 * 0.30 = 1.80
    s.set(StackBuffType.Volatile, 4);        // 4 * 0.50 = 2.00
    s.set(StackBuffType.ToughTimes, 2);      // 2 * 0.15 = 0.30
    s.set(StackBuffType.Magnetism, 3);       // 3 * 0.10 = 0.30
    s.set(StackBuffType.Afterburner, 1);     // 1 * 0.10 = 0.10
    // Total = 1.20 + 0.75 + 2.00 + 1.80 + 2.00 + 0.30 + 0.30 + 0.10 = 8.45
    expect(bm.getTotalBuffPower()).toBeGreaterThanOrEqual(6.0);
    expect(bm.getTotalBuffPower()).toBeCloseTo(8.45, 2);
  });

  it('offensive buffs contribute more than defensive/utility', () => {
    const offensive = new BuffManager();
    const defensive = new BuffManager();
    // 5 stacks of ShockAura (offensive AoE) = 5 * 0.40 = 2.0
    (offensive as any).stacks.set(StackBuffType.ShockAura, 5);
    // 5 stacks of Magnetism (utility) = 5 * 0.10 = 0.5
    (defensive as any).stacks.set(StackBuffType.Magnetism, 5);
    expect(offensive.getTotalBuffPower()).toBeGreaterThan(defensive.getTotalBuffPower());
  });

  it('Volatile stacks contribute 0.50 per stack (highest weight)', () => {
    const bm = new BuffManager();
    (bm as any).stacks.set(StackBuffType.Volatile, 3); // 3 * 0.50 = 1.50
    expect(bm.getTotalBuffPower()).toBeCloseTo(1.50, 5);
  });

  it('getTotalBuffPower scales linearly with additional stacks', () => {
    const bm1 = new BuffManager();
    const bm2 = new BuffManager();
    (bm1 as any).stacks.set(StackBuffType.HotHands, 2);  // 2 * 0.30 = 0.60
    (bm2 as any).stacks.set(StackBuffType.HotHands, 4);  // 4 * 0.30 = 1.20
    expect(bm2.getTotalBuffPower()).toBeCloseTo(bm1.getTotalBuffPower() * 2, 5);
  });
});
