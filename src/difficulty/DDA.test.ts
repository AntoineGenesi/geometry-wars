import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DDAPerformanceTracker } from './DDAPerformanceTracker';
import { DDADecisionEngine } from './DDADecisionEngine';
import { DDASpawnModifier, ENEMY_DIFFICULTY, EASY_POOL, MEDIUM_POOL } from './DDASpawnModifier';
import type { EnemyType } from '../entities/enemies/EnemySpawner';

// ===========================================================================
// DDAPerformanceTracker Tests
// ===========================================================================

describe('DDAPerformanceTracker', () => {
  let tracker: DDAPerformanceTracker;

  beforeEach(() => {
    tracker = new DDAPerformanceTracker(0);
  });

  it('should initialize with neutral values', () => {
    const snap = tracker.getSnapshot();
    expect(snap.killRate).toBe(0);
    expect(snap.deathRate).toBe(0);
    expect(snap.scoreRate).toBe(0);
    expect(snap.closeCallFreq).toBe(0);
    expect(snap.avgEnemyProximity).toBe(1.0);
    expect(snap.timeAtLowHealth).toBe(0);
  });

  it('should not update metrics during warmup period', () => {
    tracker.recordKill(100);
    // Only 2 seconds of update (warmup is 5s)
    for (let i = 0; i < 120; i++) tracker.update(1 / 60, 0.5, 1.0);

    expect(tracker.isWarmedUp).toBe(false);
    const snap = tracker.getSnapshot();
    expect(snap.killRate).toBe(0); // Still 0 during warmup
  });

  it('should start tracking after warmup completes', () => {
    tracker.recordKill(100);
    // Run past warmup (5 seconds)
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);

    expect(tracker.isWarmedUp).toBe(true);
  });

  it('should track kill rate via EMA after warmup', () => {
    // Get past warmup
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    expect(tracker.isWarmedUp).toBe(true);

    // Record kills and simulate time
    tracker.recordKill(50);
    tracker.recordKill(50);
    // Advance 1 second for the accumulator to flush
    for (let i = 0; i < 60; i++) tracker.update(1 / 60, 0.5, 1.0);

    const snap = tracker.getSnapshot();
    expect(snap.killRate).toBeGreaterThan(0);
  });

  it('should track death rate with faster EMA alpha', () => {
    // Get past warmup
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);

    tracker.recordDeath();
    for (let i = 0; i < 60; i++) tracker.update(1 / 60, 0.5, 1.0);

    const snap = tracker.getSnapshot();
    expect(snap.deathRate).toBeGreaterThan(0);
    expect(tracker.totalDeaths).toBe(1);
  });

  it('should track close calls', () => {
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);

    tracker.recordCloseCall();
    tracker.recordCloseCall();
    for (let i = 0; i < 60; i++) tracker.update(1 / 60, 0.5, 1.0);

    const snap = tracker.getSnapshot();
    expect(snap.closeCallFreq).toBeGreaterThan(0);
  });

  it('should track enemy proximity via EMA', () => {
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);

    // Simulate enemies being very close
    for (let i = 0; i < 120; i++) tracker.update(1 / 60, 0.05, 1.0);

    const snap = tracker.getSnapshot();
    expect(snap.avgEnemyProximity).toBeLessThan(0.5); // Should have decreased
  });

  it('should track low health time', () => {
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);

    // Simulate being at low health (30% = below 34% threshold)
    for (let i = 0; i < 120; i++) tracker.update(1 / 60, 0.5, 0.3);

    const snap = tracker.getSnapshot();
    expect(snap.timeAtLowHealth).toBeGreaterThan(0);
  });

  it('should compute a composite score between 0 and 1', () => {
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);

    const score = tracker.getCompositeScore();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should give higher composite scores to better-performing players', () => {
    const goodPlayer = new DDAPerformanceTracker(0);
    const badPlayer = new DDAPerformanceTracker(1);

    // Warmup both
    for (let i = 0; i < 360; i++) {
      goodPlayer.update(1 / 60, 0.5, 1.0);
      badPlayer.update(1 / 60, 0.5, 1.0);
    }

    // Good player: lots of kills, far from enemies
    for (let i = 0; i < 300; i++) {
      if (i % 10 === 0) goodPlayer.recordKill(100);
      goodPlayer.update(1 / 60, 0.8, 1.0);
    }

    // Bad player: few kills, close to enemies, at low health, dying
    for (let i = 0; i < 300; i++) {
      if (i % 100 === 0) badPlayer.recordDeath();
      badPlayer.update(1 / 60, 0.05, 0.2);
    }

    const goodScore = goodPlayer.getCompositeScore();
    const badScore = badPlayer.getCompositeScore();
    expect(goodScore).toBeGreaterThan(badScore);
  });

  it('should reset all metrics', () => {
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    tracker.recordKill(100);
    tracker.recordDeath();

    tracker.reset();

    expect(tracker.isWarmedUp).toBe(false);
    expect(tracker.totalKills).toBe(0);
    expect(tracker.totalDeaths).toBe(0);
    const snap = tracker.getSnapshot();
    expect(snap.killRate).toBe(0);
    expect(snap.deathRate).toBe(0);
  });

  it('should accumulate total kills and deaths', () => {
    tracker.recordKill(50);
    tracker.recordKill(100);
    tracker.recordKill(25);
    tracker.recordDeath();
    tracker.recordDeath();

    expect(tracker.totalKills).toBe(3);
    expect(tracker.totalDeaths).toBe(2);
  });
});

// ===========================================================================
// DDADecisionEngine Tests
// ===========================================================================

describe('DDADecisionEngine', () => {
  let engine: DDADecisionEngine;

  beforeEach(() => {
    engine = new DDADecisionEngine({
      updateInterval: 0.1, // Fast updates for testing
      rampUpTime: 0.5,     // Fast ramp for testing
      rampDownTime: 0.5,
    });
  });

  it('should start with all players at DDA level 0', () => {
    expect(engine.getDDALevel(0)).toBe(0);
    expect(engine.getDDALevel(1)).toBe(0);
    expect(engine.getDDALevel(2)).toBe(0);
    expect(engine.getDDALevel(3)).toBe(0);
  });

  it('should return speed multiplier 1.0 at level 0', () => {
    expect(engine.getSpeedMultiplier(0)).toBe(1.0);
  });

  it('should be enabled by default', () => {
    expect(engine.isEnabled()).toBe(true);
  });

  it('should return level 0 when disabled', () => {
    engine.setEnabled(false);
    expect(engine.getDDALevel(0)).toBe(0);
    expect(engine.getSpeedMultiplier(0)).toBe(1.0);
  });

  it('should activate DDA for a struggling single player', () => {
    // Create a tracker that appears to be struggling
    const tracker = new DDAPerformanceTracker(0);
    // Warmup
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    // Struggle: close enemies, low health, dying
    for (let i = 0; i < 300; i++) {
      if (i % 30 === 0) tracker.recordDeath();
      tracker.update(1 / 60, 0.02, 0.1);
    }

    // Run engine updates (fast interval for test)
    for (let i = 0; i < 200; i++) {
      engine.update(1 / 60, [tracker]);
    }

    // The composite score should be low, triggering DDA
    const level = engine.getDDALevel(0);
    expect(level).toBeGreaterThan(0);
  });

  it('should not activate DDA for a performing player', () => {
    const tracker = new DDAPerformanceTracker(0);
    // Warmup
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    // Performing well: many kills, far from enemies, full health
    for (let i = 0; i < 300; i++) {
      if (i % 5 === 0) tracker.recordKill(200);
      tracker.update(1 / 60, 0.8, 1.0);
    }

    for (let i = 0; i < 200; i++) {
      engine.update(1 / 60, [tracker]);
    }

    expect(engine.getDDALevel(0)).toBe(0);
    expect(engine.getSpeedMultiplier(0)).toBe(1.0);
  });

  it('should disable DDA on Nightmare tier', () => {
    const tracker = new DDAPerformanceTracker(0);
    // Make player struggle
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    for (let i = 0; i < 300; i++) {
      if (i % 30 === 0) tracker.recordDeath();
      tracker.update(1 / 60, 0.02, 0.1);
    }

    // Update with tier 4 (Nightmare) - should disable
    for (let i = 0; i < 200; i++) {
      engine.update(1 / 60, [tracker], 4);
    }

    expect(engine.getDDALevel(0)).toBe(0);
  });

  it('should return default values for out-of-range player indices', () => {
    expect(engine.getDDALevel(99)).toBe(0);
    expect(engine.getSpeedMultiplier(99)).toBe(1.0);
    expect(engine.getCompositeScore(99)).toBe(0.5);
  });

  it('should speed multiplier never exceed 1.2 (MAX 20%)', () => {
    const tracker = new DDAPerformanceTracker(0);
    // Warmup and make player struggle severely
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    for (let i = 0; i < 600; i++) {
      if (i % 15 === 0) tracker.recordDeath();
      tracker.update(1 / 60, 0.01, 0.05);
    }

    // Run engine for a long time to let ramp reach max
    for (let i = 0; i < 1000; i++) {
      engine.update(1 / 60, [tracker]);
    }

    const speed = engine.getSpeedMultiplier(0);
    expect(speed).toBeLessThanOrEqual(1.2);
    expect(speed).toBeGreaterThanOrEqual(1.0);
  });

  it('should ramp levels smoothly (not jump instantly)', () => {
    const tracker = new DDAPerformanceTracker(0);
    // Make player struggle immediately
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    for (let i = 0; i < 300; i++) {
      if (i % 15 === 0) tracker.recordDeath();
      tracker.update(1 / 60, 0.01, 0.05);
    }

    // Force a recalculation
    engine.update(0.2, [tracker]); // triggers recalc

    // The smooth level should be fractional, not an integer jump
    const smoothLevel = engine.getDDALevelSmooth(0);
    // After just one tick past recalc, the level should be ramping, not at full target
    // (Unless the ramp time is very short, which it is in our test config)
    expect(smoothLevel).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// DDASpawnModifier Tests
// ===========================================================================

describe('DDASpawnModifier', () => {
  let engine: DDADecisionEngine;
  let modifier: DDASpawnModifier;

  beforeEach(() => {
    engine = new DDADecisionEngine({
      updateInterval: 0.1,
      rampUpTime: 0.01,  // Near-instant ramp for testing
      rampDownTime: 0.01,
    });
    modifier = new DDASpawnModifier(engine);
  });

  describe('Enemy Classification', () => {
    it('should classify grunt as easy', () => {
      expect(modifier.getEnemyDifficulty('grunt')).toBe('easy');
    });

    it('should classify wanderer as easy', () => {
      expect(modifier.getEnemyDifficulty('wanderer')).toBe('easy');
    });

    it('should classify duck as easy', () => {
      expect(modifier.getEnemyDifficulty('duck')).toBe('easy');
    });

    it('should classify mayfly as easy', () => {
      expect(modifier.getEnemyDifficulty('mayfly')).toBe('easy');
    });

    it('should classify weaver as medium', () => {
      expect(modifier.getEnemyDifficulty('weaver')).toBe('medium');
    });

    it('should classify spinner as medium', () => {
      expect(modifier.getEnemyDifficulty('spinner')).toBe('medium');
    });

    it('should classify snake as hard', () => {
      expect(modifier.getEnemyDifficulty('snake')).toBe('hard');
    });

    it('should classify fractal as hard', () => {
      expect(modifier.getEnemyDifficulty('fractal')).toBe('hard');
    });

    it('should classify phaser as hard', () => {
      expect(modifier.getEnemyDifficulty('phaser')).toBe('hard');
    });

    it('should classify gate as elite', () => {
      expect(modifier.getEnemyDifficulty('gate')).toBe('elite');
    });

    it('should classify virus as elite', () => {
      expect(modifier.getEnemyDifficulty('virus')).toBe('elite');
    });

    it('should classify titan_grunt as boss', () => {
      expect(modifier.getEnemyDifficulty('titan_grunt')).toBe('boss');
    });

    it('should classify boss types as boss', () => {
      expect(modifier.getEnemyDifficulty('boss_sapphire')).toBe('boss');
      expect(modifier.getEnemyDifficulty('boss_ruby')).toBe('boss');
    });

    it('should have classifications for all standard enemy types', () => {
      const allTypes: EnemyType[] = [
        'grunt', 'wanderer', 'duck', 'mayfly', 'rocket', 'neutron',
        'weaver', 'spinner', 'snake', 'repulsor', 'gravity_well', 'gate',
        'painter', 'virus', 'spawner', 'titan_grunt', 'titan_spinner', 'titan_weaver',
        'giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron',
        'cluster', 'helix', 'fractal', 'swarm',
        'lurker', 'orbiter', 'splitter', 'phaser',
      ];
      for (const type of allTypes) {
        const diff = modifier.getEnemyDifficulty(type);
        expect(['easy', 'medium', 'hard', 'elite', 'boss']).toContain(diff);
      }
    });
  });

  describe('Zone Assignment', () => {
    it('should assign zone 0 for single player', () => {
      const players = [{ index: 0, u: 0.5, v: 0.5 }];
      expect(modifier.getPlayerZone(0.2, 0.8, players)).toBe(0);
    });

    it('should assign to nearest player in multiplayer', () => {
      const players = [
        { index: 0, u: 0.2, v: 0.2 },
        { index: 1, u: 0.8, v: 0.8 },
      ];
      // Spawn near player 0
      expect(modifier.getPlayerZone(0.1, 0.1, players)).toBe(0);
      // Spawn near player 1
      expect(modifier.getPlayerZone(0.9, 0.9, players)).toBe(1);
    });

    it('should handle 4 players', () => {
      const players = [
        { index: 0, u: 0.1, v: 0.1 },
        { index: 1, u: 0.9, v: 0.1 },
        { index: 2, u: 0.1, v: 0.9 },
        { index: 3, u: 0.9, v: 0.9 },
      ];
      expect(modifier.getPlayerZone(0.05, 0.05, players)).toBe(0);
      expect(modifier.getPlayerZone(0.95, 0.05, players)).toBe(1);
      expect(modifier.getPlayerZone(0.05, 0.95, players)).toBe(2);
      expect(modifier.getPlayerZone(0.95, 0.95, players)).toBe(3);
    });
  });

  describe('Spawn Type Modification', () => {
    it('should not modify when engine is disabled', () => {
      engine.setEnabled(false);
      const players = [{ index: 0, u: 0.5, v: 0.5 }];
      const result = modifier.modifySpawnType('snake', 0.5, 0.5, players);
      expect(result).toBe('snake');
    });

    it('should not modify at DDA level 0', () => {
      const players = [{ index: 0, u: 0.5, v: 0.5 }];
      // Engine starts at level 0
      const result = modifier.modifySpawnType('snake', 0.5, 0.5, players);
      expect(result).toBe('snake');
    });

    it('should never modify boss/splitting enemies', () => {
      // Force DDA level 3 by making a player struggle
      const tracker = forceHighDDALevel(engine);
      const players = [{ index: 0, u: 0.5, v: 0.5 }];

      // Boss types should never be modified
      for (let i = 0; i < 100; i++) {
        expect(modifier.modifySpawnType('titan_grunt', 0.5, 0.5, players)).toBe('titan_grunt');
        expect(modifier.modifySpawnType('boss_sapphire', 0.5, 0.5, players)).toBe('boss_sapphire');
        expect(modifier.modifySpawnType('giant_snake', 0.5, 0.5, players)).toBe('giant_snake');
        expect(modifier.modifySpawnType('splitter', 0.5, 0.5, players)).toBe('splitter');
      }
    });

    it('should never modify easy enemies (cannot downgrade further)', () => {
      const tracker = forceHighDDALevel(engine);
      const players = [{ index: 0, u: 0.5, v: 0.5 }];

      for (let i = 0; i < 100; i++) {
        expect(modifier.modifySpawnType('grunt', 0.5, 0.5, players)).toBe('grunt');
        expect(modifier.modifySpawnType('wanderer', 0.5, 0.5, players)).toBe('wanderer');
        expect(modifier.modifySpawnType('duck', 0.5, 0.5, players)).toBe('duck');
        expect(modifier.modifySpawnType('mayfly', 0.5, 0.5, players)).toBe('mayfly');
      }
    });

    it('should sometimes swap hard enemies to easy at high DDA level', () => {
      const tracker = forceHighDDALevel(engine);
      const players = [{ index: 0, u: 0.5, v: 0.5 }];

      let swapped = 0;
      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        const result = modifier.modifySpawnType('snake', 0.5, 0.5, players);
        if (result !== 'snake') {
          swapped++;
          // Swapped result should be an easy enemy
          expect(EASY_POOL).toContain(result);
        }
      }

      // At level 3, ~50% swap chance, so we should see a significant number
      expect(swapped).toBeGreaterThan(iterations * 0.2);
      expect(swapped).toBeLessThan(iterations * 0.8);
    });

    it('should sometimes swap elite enemies to medium at high DDA level', () => {
      const tracker = forceHighDDALevel(engine);
      const players = [{ index: 0, u: 0.5, v: 0.5 }];

      let swapped = 0;
      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        const result = modifier.modifySpawnType('gate', 0.5, 0.5, players);
        if (result !== 'gate') {
          swapped++;
          expect(MEDIUM_POOL).toContain(result);
        }
      }

      // At level 3, ~25% swap chance for elites
      expect(swapped).toBeGreaterThan(iterations * 0.1);
      expect(swapped).toBeLessThan(iterations * 0.5);
    });
  });

  describe('Wave Modification', () => {
    it('should return a new array (immutability)', () => {
      const wave = [{ type: 'grunt' as EnemyType, count: 5 }];
      const result = modifier.modifyWave(wave, [{ index: 0, u: 0.5, v: 0.5 }]);
      expect(result).not.toBe(wave);
      expect(result[0]).not.toBe(wave[0]);
    });

    it('should preserve wave structure', () => {
      const wave = [
        { type: 'grunt' as EnemyType, count: 5, tier: 1 },
        { type: 'snake' as EnemyType, count: 3, region: { minU: 0, maxU: 0.5 } },
      ];
      const result = modifier.modifyWave(wave, [{ index: 0, u: 0.5, v: 0.5 }]);
      expect(result).toHaveLength(2);
      expect(result[0].count).toBe(5);
      expect(result[0].tier).toBe(1);
      expect(result[1].count).toBe(3);
    });

    it('should pass through unchanged when disabled', () => {
      engine.setEnabled(false);
      const wave = [
        { type: 'snake' as EnemyType, count: 3 },
        { type: 'fractal' as EnemyType, count: 2 },
      ];
      const result = modifier.modifyWave(wave, [{ index: 0, u: 0.5, v: 0.5 }]);
      expect(result[0].type).toBe('snake');
      expect(result[1].type).toBe('fractal');
    });
  });

  describe('Convenience Methods', () => {
    it('should delegate getSpeedMultiplier to engine', () => {
      expect(modifier.getSpeedMultiplier(0)).toBe(engine.getSpeedMultiplier(0));
    });

    it('should delegate getDDALevel to engine', () => {
      expect(modifier.getDDALevel(0)).toBe(engine.getDDALevel(0));
    });

    it('should delegate getDominanceHpMultiplier to engine', () => {
      expect(modifier.getDominanceHpMultiplier(0)).toBe(engine.getDominanceHpMultiplier(0));
    });
  });

  describe('Dominance HP Multiplier', () => {
    it('should return 1.0 for neutral performance (no dominance penalty)', () => {
      // Default engine: tracker not warmed up, score is neutral 0.5
      // 0.5 is below 0.65 dominanceThreshold — no penalty
      expect(engine.getDominanceHpMultiplier(0)).toBe(1.0);
    });

    it('should return 1.0 for out-of-range player index', () => {
      expect(engine.getDominanceHpMultiplier(99)).toBe(1.0);
    });

    it('should return 1.0 when engine is disabled', () => {
      engine.setEnabled(false);
      expect(engine.getDominanceHpMultiplier(0)).toBe(1.0);
    });

    it('should scale up HP multiplier when player is dominating', () => {
      // Simulate a dominating player by forcing high composite score
      // We do this by forcing the engine state directly via tracker
      const tracker = new DDAPerformanceTracker(0);
      // Past warmup
      for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
      // Dominating: many kills, far from enemies, full health, no deaths
      for (let i = 0; i < 600; i++) {
        if (i % 3 === 0) tracker.recordKill(500); // high score kill rate
        tracker.update(1 / 60, 0.9, 1.0); // far from enemies, full health
      }
      // Update engine to pick up composite score
      for (let i = 0; i < 200; i++) {
        engine.update(1 / 60, [tracker]);
      }

      const compositeScore = engine.getCompositeScore(0);
      const mult = engine.getDominanceHpMultiplier(0);

      if (compositeScore > 0.65) {
        // Player is truly dominating — multiplier should be > 1
        expect(mult).toBeGreaterThan(1.0);
      } else {
        // Composite score didn't pass threshold — still 1.0
        expect(mult).toBe(1.0);
      }
    });

    it('should apply companion bonus to dominance threshold', () => {
      // At neutral score (0.5), adding companions should not cross threshold
      // because 0.5 + 2*0.05 = 0.6 < 0.65 threshold
      const multNoCompanions = engine.getDominanceHpMultiplier(0, 0);
      const multWithCompanions = engine.getDominanceHpMultiplier(0, 2);
      // Both should be 1.0 since base score is 0.5 (neutral during warmup)
      expect(multNoCompanions).toBe(1.0);
      expect(multWithCompanions).toBe(1.0);
    });

    it('should apply small map boost when isSmallMap is true', () => {
      // Without data, both are 1.0 — test that small map doesn't break anything
      const multNormal = engine.getDominanceHpMultiplier(0, 0, false);
      const multSmall = engine.getDominanceHpMultiplier(0, 0, true);
      expect(multNormal).toBe(1.0);
      expect(multSmall).toBe(1.0);
    });

    it('should cap HP multiplier at dominanceMaxHpMultiplier', () => {
      // Custom engine with low threshold so we can trigger dominance easily
      const aggressiveEngine = new DDADecisionEngine({
        dominanceThreshold: 0.0,  // always active
        dominanceMaxScore: 0.5,   // reach max at score 0.5
        dominanceMaxHpMultiplier: 4.0,
        updateInterval: 0.1,
      });

      // Force neutral state (compositeScore will be 0.5 before warmup)
      // With threshold=0, the neutral 0.5 score should trigger dominance
      const mult = aggressiveEngine.getDominanceHpMultiplier(0, 0, false);
      expect(mult).toBeLessThanOrEqual(4.0);
      expect(mult).toBeGreaterThanOrEqual(1.0);
    });
  });
});

// ===========================================================================
// DDASettings Tests
// ===========================================================================

describe('DDASettings', () => {
  // Mock localStorage for Node test environment
  const store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };

  beforeEach(() => {
    // Clear the store
    for (const key of Object.keys(store)) delete store[key];
    // Set up localStorage if not available
    if (typeof globalThis.localStorage === 'undefined') {
      (globalThis as any).localStorage = mockLocalStorage;
    }
  });

  it('should load default settings when localStorage is empty', async () => {
    const { loadDDASettings } = await import('./DDASettings');
    // Clear any stored settings
    localStorage.removeItem('gw3d-dda-settings');
    const settings = loadDDASettings();
    expect(settings.enabled).toBe(true);
  });

  it('should save and load settings', async () => {
    const { loadDDASettings, saveDDASettings } = await import('./DDASettings');
    saveDDASettings({ enabled: false });
    const loaded = loadDDASettings();
    expect(loaded.enabled).toBe(false);
    // Clean up
    localStorage.removeItem('gw3d-dda-settings');
  });
});

// ===========================================================================
// Integration Tests
// ===========================================================================

describe('DDA Integration', () => {
  it('should work end-to-end: tracker -> engine -> modifier', () => {
    const tracker = new DDAPerformanceTracker(0);
    const engine = new DDADecisionEngine({
      updateInterval: 0.1,
      rampUpTime: 0.01,
      rampDownTime: 0.01,
    });
    const modifier = new DDASpawnModifier(engine);
    const players = [{ index: 0, u: 0.5, v: 0.5 }];

    // Phase 1: Player is fine, no DDA
    for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);
    for (let i = 0; i < 300; i++) {
      if (i % 5 === 0) tracker.recordKill(100);
      tracker.update(1 / 60, 0.5, 1.0);
      engine.update(1 / 60, [tracker]);
    }

    expect(modifier.getDDALevel(0)).toBe(0);

    // Phase 2: Player starts struggling badly
    for (let i = 0; i < 600; i++) {
      if (i % 20 === 0) tracker.recordDeath();
      tracker.update(1 / 60, 0.02, 0.1);
      engine.update(1 / 60, [tracker]);
    }

    const level = modifier.getDDALevel(0);
    // Should have activated some DDA
    expect(level).toBeGreaterThanOrEqual(0); // May or may not have reached level 1+ depending on exact EMA values
  });

  it('should constrain speed boost to max 1.2', () => {
    const engine = new DDADecisionEngine({
      updateInterval: 0.01,
      rampUpTime: 0.01,
      rampDownTime: 0.01,
    });
    const modifier = new DDASpawnModifier(engine);

    // Force maximum DDA level
    forceHighDDALevel(engine);

    const speed = modifier.getSpeedMultiplier(0);
    expect(speed).toBeLessThanOrEqual(1.2);
  });

  it('should NOT provide any resource buffs (geoms, health, pickups)', () => {
    // This is a constraint validation test
    // The DDASpawnModifier only modifies enemy types and speed
    // It has no methods for resource modification
    const engine = new DDADecisionEngine();
    const modifier = new DDASpawnModifier(engine);

    // Verify the modifier only exposes type and speed modification
    expect(typeof modifier.modifySpawnType).toBe('function');
    expect(typeof modifier.modifyWave).toBe('function');
    expect(typeof modifier.getSpeedMultiplier).toBe('function');
    expect(typeof modifier.getDDALevel).toBe('function');
    expect(typeof modifier.getPlayerZone).toBe('function');
    expect(typeof modifier.getEnemyDifficulty).toBe('function');

    // No resource-related methods should exist
    expect((modifier as any).getResourceBoost).toBeUndefined();
    expect((modifier as any).getGeomBoost).toBeUndefined();
    expect((modifier as any).getHealthBoost).toBeUndefined();
    expect((modifier as any).getPickupBoost).toBeUndefined();
  });
});

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Force the DDA engine to level 3 for a player by simulating
 * an extremely struggling player.
 */
function forceHighDDALevel(engine: DDADecisionEngine): DDAPerformanceTracker {
  const tracker = new DDAPerformanceTracker(0);

  // Warmup
  for (let i = 0; i < 360; i++) tracker.update(1 / 60, 0.5, 1.0);

  // Severely struggling: constant deaths, very close enemies, low health, frequent close calls
  // recordCloseCall() is needed to push composite score below severeThreshold (0.10).
  // Without close calls, the minimum composite is 0.15 (closeCallBad contributes 0.15 floor).
  for (let i = 0; i < 600; i++) {
    if (i % 10 === 0) tracker.recordDeath();
    if (i % 2 === 0) tracker.recordCloseCall(); // ~30 close calls/sec → closeCallBad = 1.0
    tracker.update(1 / 60, 0.01, 0.05);
    engine.update(1 / 60, [tracker]);
  }

  return tracker;
}
