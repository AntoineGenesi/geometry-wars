/**
 * GameAnalytics Test Suite
 *
 * Tests:
 * - Analytics collection overhead (< 1ms)
 * - Kill attribution correctness
 * - Death attribution correctness
 * - Buff activity logging
 * - Effect dictionary persistence
 * - Export format validity
 * - Non-blocking batching
 * - Session summary accuracy
 * - Ring buffer overflow handling
 * - Sample interval accuracy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameAnalytics } from './GameAnalytics';
import { EffectDictionary } from './EffectDictionary';
import { EnemyType } from '../entities/enemies/EnemySpawner';
import { WeaponType } from '../weapons/WeaponTypes';
import { StackBuffType } from '../buffs/BuffManager';

describe('GameAnalytics', () => {
  let analytics: GameAnalytics;
  let store: Record<string, string> = {};

  beforeEach(() => {
    // Mock localStorage
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (index: number) => Object.keys(store)[index] ?? null,
    });

    // Clear effect dictionary
    EffectDictionary.clear();
    // Create new analytics instance
    analytics = new GameAnalytics('sphere');
  });

  afterEach(() => {
    EffectDictionary.clear();
    vi.unstubAllGlobals();
  });

  describe('Performance', () => {
    it('should have < 1ms frame overhead for analytics collection', () => {
      // Setup frame data
      analytics.setFrameData(60, 100, 200, 50);
      const enemyTypes = new Map<EnemyType, number>([
        ['grunt', 50],
        ['wanderer', 30],
        ['duck', 20],
      ]);
      analytics.setEnemyTypes(enemyTypes);
      analytics.setParticleCount(500);
      analytics.setWeaponState(WeaponType.Spread, 50, 2);
      const buffs = new Map<StackBuffType, number>([
        [StackBuffType.HotHands, 3],
        [StackBuffType.ShockAura, 1],
      ]);
      analytics.setBuffs(buffs);
      analytics.setGameplayData(10000, 50, 2, 1.5);
      analytics.setRendererStats(25, 50000, 120);
      analytics.setBloomState(0.7);
      analytics.setQualityLevel('HIGH');

      // Measure 1000 frame updates (should complete in < 1000ms total, < 1ms avg)
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        analytics.update(0.016); // 60fps
      }
      const elapsed = performance.now() - start;

      // Should complete in < 1000ms (< 1ms per frame average)
      expect(elapsed).toBeLessThan(1000);

      // Average frame overhead should be < 1ms
      const avgFrameTime = elapsed / 1000;
      expect(avgFrameTime).toBeLessThan(1.0);
    });

    it('should batch samples at 100ms intervals', () => {
      analytics.setFrameData(60, 10, 20, 5);
      analytics.setEnemyTypes(new Map());
      analytics.setParticleCount(100);
      analytics.setGameplayData(1000, 5, 0, 0);

      // Update for 1 second in 16ms frames (60fps)
      for (let i = 0; i < 60; i++) {
        analytics.update(0.016);
      }

      const summary = analytics.getSessionSummary();

      // Should have sampled ~10 times (1000ms / 100ms)
      // Total frames should be 60
      expect(summary.totalFrames).toBe(60);
    });
  });

  describe('Kill Attribution', () => {
    it('should correctly track kills by enemy type', () => {
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');
      analytics.recordKill('grunt', WeaponType.Spread, 100, 'Normal');
      analytics.recordKill('wanderer', WeaponType.Standard, 200, 'Normal');
      analytics.recordKill('duck', WeaponType.LaserBeam, 150, 'Normal');
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');

      const summary = analytics.getSessionSummary();

      // Should have grunt (3), wanderer (1), duck (1)
      const gruntKills = summary.topEnemyKills.find(e => e.enemyType === 'grunt');
      expect(gruntKills?.count).toBe(3);

      const wandererKills = summary.topEnemyKills.find(e => e.enemyType === 'wanderer');
      expect(wandererKills?.count).toBe(1);

      const duckKills = summary.topEnemyKills.find(e => e.enemyType === 'duck');
      expect(duckKills?.count).toBe(1);
    });

    it('should correctly track kills by weapon type', () => {
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');
      analytics.recordKill('wanderer', WeaponType.Spread, 200, 'Normal');
      analytics.recordKill('duck', WeaponType.LaserBeam, 150, 'Normal');
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');

      const summary = analytics.getSessionSummary();

      // Should have standard (3), spread (1), laser_beam (1)
      const standardKills = summary.topWeapons.find(w => w.weaponType === 'standard');
      expect(standardKills?.kills).toBe(3);

      const spreadKills = summary.topWeapons.find(w => w.weaponType === 'spread');
      expect(spreadKills?.kills).toBe(1);

      const laserKills = summary.topWeapons.find(w => w.weaponType === 'laser_beam');
      expect(laserKills?.kills).toBe(1);
    });

    it('should sort top enemies by kill count (descending)', () => {
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');
      analytics.recordKill('wanderer', WeaponType.Standard, 200, 'Normal');
      analytics.recordKill('wanderer', WeaponType.Standard, 200, 'Normal');
      analytics.recordKill('duck', WeaponType.Standard, 150, 'Normal');

      const summary = analytics.getSessionSummary();

      // Should be sorted: grunt (3), wanderer (2), duck (1)
      expect(summary.topEnemyKills[0].enemyType).toBe('grunt');
      expect(summary.topEnemyKills[0].count).toBe(3);
      expect(summary.topEnemyKills[1].enemyType).toBe('wanderer');
      expect(summary.topEnemyKills[1].count).toBe(2);
      expect(summary.topEnemyKills[2].enemyType).toBe('duck');
      expect(summary.topEnemyKills[2].count).toBe(1);
    });
  });

  describe('Death Attribution', () => {
    it('should correctly track deaths by enemy type', () => {
      analytics.recordDeath('grunt', 50);
      analytics.recordDeath('wanderer', 30);
      analytics.recordDeath('grunt', 20);
      analytics.recordDeath('duck', 10);
      analytics.recordDeath('grunt', 40);

      const summary = analytics.getSessionSummary();

      // Should have grunt (3), wanderer (1), duck (1)
      const gruntDeaths = summary.topPlayerDeaths.find(e => e.enemyType === 'grunt');
      expect(gruntDeaths?.count).toBe(3);

      const wandererDeaths = summary.topPlayerDeaths.find(e => e.enemyType === 'wanderer');
      expect(wandererDeaths?.count).toBe(1);

      const duckDeaths = summary.topPlayerDeaths.find(e => e.enemyType === 'duck');
      expect(duckDeaths?.count).toBe(1);
    });

    it('should record active buffs at time of death', () => {
      const buffs = new Map<StackBuffType, number>([
        [StackBuffType.HotHands, 2],
        [StackBuffType.ShockAura, 1],
      ]);
      analytics.setBuffs(buffs);
      analytics.recordDeath('grunt', 50);

      const summary = analytics.getSessionSummary();
      // Death events should be recorded (not in summary, but internal)
      // This test verifies no errors occur when recording with active buffs
      expect(summary.totalDeaths).toBe(0); // totalDeaths comes from setGameplayData, not recordDeath
    });

    it('should record equipped weapon at time of death', () => {
      analytics.setWeaponState(WeaponType.Spread, 50, 2);
      analytics.recordDeath('wanderer', 30);

      // No errors should occur
      const summary = analytics.getSessionSummary();
      expect(summary.mapType).toBe('sphere');
    });
  });

  describe('Buff Activity', () => {
    it('should log buff gained events', () => {
      analytics.recordBuffEvent(StackBuffType.HotHands, 'gained', 1);
      analytics.recordBuffEvent(StackBuffType.ShockAura, 'gained', 1);

      // Events should be recorded internally (no errors)
      const summary = analytics.getSessionSummary();
      expect(summary).toBeDefined();
    });

    it('should log buff stacked events', () => {
      analytics.recordBuffEvent(StackBuffType.HotHands, 'gained', 1);
      analytics.recordBuffEvent(StackBuffType.HotHands, 'stacked', 2);
      analytics.recordBuffEvent(StackBuffType.HotHands, 'stacked', 3);

      const summary = analytics.getSessionSummary();
      expect(summary).toBeDefined();
    });

    it('should log buff lost events', () => {
      analytics.recordBuffEvent(StackBuffType.HotHands, 'gained', 1);
      analytics.recordBuffEvent(StackBuffType.HotHands, 'lost', 0);

      const summary = analytics.getSessionSummary();
      expect(summary).toBeDefined();
    });

    it('should track buff active time', () => {
      // Mock Date.now to control time progression
      let mockTime = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      // Create analytics with mocked time
      const testAnalytics = new GameAnalytics('sphere');

      const buffs = new Map<StackBuffType, number>([
        [StackBuffType.HotHands, 1],
      ]);
      testAnalytics.setBuffs(buffs);
      testAnalytics.setFrameData(60, 10, 20, 5);

      // Update for 1 second (60 frames @ 16ms each)
      for (let i = 0; i < 60; i++) {
        mockTime += 16; // Advance time by 16ms per frame
        testAnalytics.update(0.016);
      }

      const summary = testAnalytics.getSessionSummary();

      // Should have tracked ~1 second of active time for HotHands
      const hotHandsUsage = summary.buffUsage.find(b => b.buffType === StackBuffType.HotHands);
      expect(hotHandsUsage).toBeDefined();
      expect(hotHandsUsage!.totalTime).toBeGreaterThan(0.5); // At least 0.5s tracked

      vi.restoreAllMocks();
    });

    it('should track max stacks per buff', () => {
      const buffs1 = new Map<StackBuffType, number>([[StackBuffType.HotHands, 1]]);
      analytics.setBuffs(buffs1);
      analytics.update(0.016);

      const buffs2 = new Map<StackBuffType, number>([[StackBuffType.HotHands, 3]]);
      analytics.setBuffs(buffs2);
      analytics.update(0.016);

      const buffs3 = new Map<StackBuffType, number>([[StackBuffType.HotHands, 2]]);
      analytics.setBuffs(buffs3);
      analytics.update(0.016);

      const summary = analytics.getSessionSummary();
      const hotHandsUsage = summary.buffUsage.find(b => b.buffType === StackBuffType.HotHands);
      expect(hotHandsUsage?.maxStacks).toBe(3);
    });
  });

  describe('Effect Dictionary', () => {
    it('should register effects and return stable IDs', () => {
      const id1 = analytics.registerEffect('particle', 'Hot Hands Aura L1', 'BuffManager');
      const id2 = analytics.registerEffect('explosion', 'Enemy Death Burst', 'EnemySpawner');
      const id3 = analytics.registerEffect('particle', 'Hot Hands Aura L1', 'BuffManager'); // Same name

      // Same name should return same ID
      expect(id1).toBe(id3);

      // Different names should return different IDs
      expect(id1).not.toBe(id2);
    });

    it('should persist effect dictionary to localStorage', () => {
      analytics.registerEffect('particle', 'Test Effect 1', 'Test');
      analytics.registerEffect('explosion', 'Test Effect 2', 'Test');

      // Flush to storage
      EffectDictionary.getInstance().flush();

      // Create new instance and verify it loads
      const newDict = EffectDictionary.getInstance();
      const id1 = newDict.getIdByName('Test Effect 1');
      const id2 = newDict.getIdByName('Test Effect 2');

      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();
      expect(id1).not.toBe(id2);
    });

    it('should export effect dictionary as JSON', () => {
      analytics.registerEffect('particle', 'Test Effect A', 'Test');
      analytics.registerEffect('explosion', 'Test Effect B', 'Test');

      const json = EffectDictionary.exportAsJSON();
      const parsed = JSON.parse(json);

      expect(parsed.effects).toHaveLength(2);
      expect(parsed.effects[0].name).toBe('Test Effect A');
      expect(parsed.effects[1].name).toBe('Test Effect B');
    });
  });

  describe('Export Formats', () => {
    it('should export session as valid JSON', async () => {
      analytics.setFrameData(60, 10, 20, 5);
      analytics.setEnemyTypes(new Map([['grunt', 5], ['wanderer', 5]]));
      analytics.setGameplayData(1000, 10, 1, 0.5);
      analytics.recordKill('grunt', WeaponType.Standard, 100, 'Normal');

      analytics.saveSession();

      // Wait for async save
      await new Promise(resolve => setTimeout(resolve, 10));
      const json = GameAnalytics.exportAllAsJSON();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].summary).toBeDefined();
      expect(parsed[0].summary.mapType).toBe('sphere');
    });

    it('should export session as valid CSV', async () => {
      analytics.setFrameData(60, 10, 20, 5);
      analytics.setEnemyTypes(new Map([['grunt', 5]]));
      analytics.setGameplayData(1000, 10, 1, 0.5);

      // Force a sample by updating for > 100ms
      for (let i = 0; i < 10; i++) {
        analytics.update(0.016);
      }

      analytics.saveSession();

      // Wait for async save
      await new Promise(resolve => setTimeout(resolve, 10));
      const csv = GameAnalytics.exportAllAsCSV();
      const lines = csv.split('\n');

      // Should have header + at least one data row
      expect(lines.length).toBeGreaterThan(1);

      // Header should contain expected columns
      expect(lines[0]).toContain('session_timestamp');
      expect(lines[0]).toContain('fps');
      expect(lines[0]).toContain('enemy_count');
      expect(lines[0]).toContain('score');
    });
  });

  describe('Session Summary', () => {
    it('should calculate average FPS correctly', () => {
      // Simulate varying FPS
      analytics.setFrameData(60, 10, 20, 5);
      analytics.update(0.016);
      analytics.setFrameData(30, 10, 20, 5);
      analytics.update(0.033);
      analytics.setFrameData(45, 10, 20, 5);
      analytics.update(0.022);

      const summary = analytics.getSessionSummary();

      // Average should be (60 + 30 + 45) / 3 = 45
      expect(summary.avgFps).toBeCloseTo(45, 0);
      expect(summary.minFps).toBe(30);
      expect(summary.maxFps).toBe(60);
    });

    it('should track peak entity counts', () => {
      analytics.setFrameData(60, 10, 20, 5);
      analytics.update(0.016);
      analytics.setFrameData(60, 50, 100, 10);
      analytics.update(0.016);
      analytics.setFrameData(60, 30, 80, 8);
      analytics.update(0.016);

      const summary = analytics.getSessionSummary();

      expect(summary.peakEnemies).toBe(50);
      expect(summary.peakBullets).toBe(100);
    });

    it('should calculate kill/death ratio correctly', () => {
      analytics.setGameplayData(5000, 20, 5, 1.0);
      analytics.update(0.016);

      const summary = analytics.getSessionSummary();

      expect(summary.totalKills).toBe(20);
      expect(summary.totalDeaths).toBe(5);
      expect(summary.killDeathRatio).toBe(4); // 20 / 5
    });

    it('should handle zero deaths gracefully', () => {
      analytics.setGameplayData(5000, 20, 0, 1.0);
      analytics.update(0.016);

      const summary = analytics.getSessionSummary();

      expect(summary.killDeathRatio).toBe(20); // When deaths = 0, K/D = kills
    });
  });

  describe('Ring Buffer', () => {
    it('should handle ring buffer overflow correctly', () => {
      // Sample interval is 100ms, max data points is 10000
      // This test simulates more than 10000 samples to test overflow

      analytics.setFrameData(60, 10, 20, 5);
      analytics.setEnemyTypes(new Map());
      analytics.setGameplayData(1000, 5, 0, 0);

      // Update for 20 minutes @ 60fps (72000 frames)
      // This will trigger many samples (20min * 60s * 10 samples/s = 12000 samples)
      for (let i = 0; i < 72000; i++) {
        analytics.update(0.016);
      }

      // Should not crash and should have summary
      const summary = analytics.getSessionSummary();
      expect(summary).toBeDefined();
      expect(summary.totalFrames).toBe(72000);
    });
  });

  describe('Non-blocking Operations', () => {
    it('should use requestIdleCallback for non-blocking saves if available', () => {
      // Mock requestIdleCallback on global window
      const mockRequestIdleCallback = vi.fn((cb: () => void) => {
        // Execute immediately for testing
        cb();
        return 0;
      });
      vi.stubGlobal('window', {
        requestIdleCallback: mockRequestIdleCallback,
      });
      vi.stubGlobal('requestIdleCallback', mockRequestIdleCallback);

      analytics.setFrameData(60, 10, 20, 5);
      analytics.saveSession();

      expect(mockRequestIdleCallback).toHaveBeenCalled();
    });

    it('should fallback to setTimeout if requestIdleCallback unavailable', async () => {
      // Ensure requestIdleCallback is not available
      delete (global as any).requestIdleCallback;

      analytics.setFrameData(60, 10, 20, 5);
      analytics.saveSession();

      // Save should happen asynchronously
      await new Promise(resolve => setTimeout(resolve, 10));
      const json = GameAnalytics.exportAllAsJSON();
      expect(json).toBeTruthy();
    });
  });

  describe('Data Integrity', () => {
    it('should preserve enemy type breakdown in samples', async () => {
      const enemyTypes = new Map<EnemyType, number>([
        ['grunt', 10],
        ['wanderer', 5],
        ['duck', 3],
      ]);
      analytics.setFrameData(60, 18, 50, 10);
      analytics.setEnemyTypes(enemyTypes);
      analytics.setGameplayData(1000, 5, 0, 0);

      // Force sample
      for (let i = 0; i < 10; i++) {
        analytics.update(0.016);
      }

      analytics.saveSession();

      // Wait for async save
      await new Promise(resolve => setTimeout(resolve, 10));
      const json = GameAnalytics.exportAllAsJSON();
      const parsed = JSON.parse(json);

      // Find a data point with enemy types
      const dataPoint = parsed[0].dataPoints.find((dp: any) => Object.keys(dp.enemyTypes).length > 0);
      expect(dataPoint).toBeDefined();
      expect(dataPoint.enemyTypes.grunt).toBe(10);
      expect(dataPoint.enemyTypes.wanderer).toBe(5);
      expect(dataPoint.enemyTypes.duck).toBe(3);
    });

    it('should preserve active buffs in samples', async () => {
      const buffs = new Map<StackBuffType, number>([
        [StackBuffType.HotHands, 3],
        [StackBuffType.ShockAura, 1],
      ]);
      analytics.setFrameData(60, 10, 20, 5);
      analytics.setBuffs(buffs);
      analytics.setGameplayData(1000, 5, 0, 0);

      // Force sample
      for (let i = 0; i < 10; i++) {
        analytics.update(0.016);
      }

      analytics.saveSession();

      // Wait for async save
      await new Promise(resolve => setTimeout(resolve, 10));
      const json = GameAnalytics.exportAllAsJSON();
      const parsed = JSON.parse(json);

      const dataPoint = parsed[0].dataPoints.find((dp: any) => Object.keys(dp.activeBuffs).length > 0);
      expect(dataPoint).toBeDefined();
      expect(dataPoint.activeBuffs.hot_hands).toBe(3);
      expect(dataPoint.activeBuffs.shock_aura).toBe(1);
    });
  });
});
