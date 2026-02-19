import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceLogger } from './PerformanceLogger';
import { EnemyType } from '../entities/enemies/EnemySpawner';

describe('PerformanceLogger', () => {
  let logger: PerformanceLogger;
  let store: Record<string, string> = {};

  beforeEach(() => {
    // Mock localStorage
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
    });

    logger = new PerformanceLogger('sphere');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Basic Data Recording', () => {
    it('should record frame data', () => {
      logger.setFrameData(60, 10, 5);
      logger.recordFrame(0.5); // Force a sample by exceeding 0.5s interval

      const points = logger.getDataPoints();
      expect(points.length).toBeGreaterThan(0);
    });

    it('should record gameplay data', () => {
      logger.setGameplayData(1000, 10, 1, 'Standard', 'hot_hands:3', 5);
      logger.recordFrame(0.5); // Force a sample

      const points = logger.getDataPoints();
      expect(points.length).toBe(1);
      expect(points[0].score).toBe(1000);
      expect(points[0].kills).toBe(10);
      expect(points[0].deaths).toBe(1);
      expect(points[0].activeWeapon).toBe('Standard');
      expect(points[0].activeBuffs).toBe('hot_hands:3');
      expect(points[0].activeEffects).toBe(5);
    });

    it('should record visibility data', () => {
      logger.setFrameData(60, 10, 5);
      logger.setVisibilityData(8, 4, 2);
      logger.recordFrame(0.5); // Force a sample

      const points = logger.getDataPoints();
      expect(points.length).toBe(1);
      expect(points[0].visibleEnemies).toBe(8);
      expect(points[0].visibleBullets).toBe(4);
      expect(points[0].activeExplosions).toBe(2);
    });

    it('should record enemy types', () => {
      const enemyTypes = new Map<EnemyType, number>();
      enemyTypes.set('virus', 5);
      enemyTypes.set('titan_grunt', 3);

      logger.setEnemyTypes(enemyTypes);
      logger.recordFrame(0.5); // Force a sample

      const points = logger.getDataPoints();
      expect(points.length).toBe(1);
      expect(points[0].enemyTypes.get('virus')).toBe(5);
      expect(points[0].enemyTypes.get('titan_grunt')).toBe(3);
    });
  });

  describe('Session Summary', () => {
    it('should track min/max FPS', () => {
      logger.setFrameData(60, 0, 0);
      logger.recordFrame(0.016);
      logger.setFrameData(30, 0, 0);
      logger.recordFrame(0.016);
      logger.setFrameData(90, 0, 0);
      logger.recordFrame(0.016);

      const summary = logger.getSessionSummary();
      expect(summary.minFps).toBe(30);
      expect(summary.maxFps).toBe(90);
    });

    it('should track peak values', () => {
      logger.setFrameData(60, 100, 50);
      logger.recordFrame(0.016);
      logger.setFrameData(60, 200, 100);
      logger.recordFrame(0.016);

      const summary = logger.getSessionSummary();
      expect(summary.peakEnemies).toBe(200);
      expect(summary.peakBullets).toBe(100);
    });

    it('BUG-FIX: peakBullets tracks every-frame max, not just sampled peaks', () => {
      // Simulate a bullet burst: 300 bullets for one frame, then drop to 10
      // Previously the 0.5s sampling interval missed burst peaks
      logger.setFrameData(60, 50, 300);
      logger.recordFrame(0.016); // 16ms frame - NOT a sample interval
      logger.setFrameData(60, 50, 10);
      logger.recordFrame(0.016);

      const summary = logger.getSessionSummary();
      // peakBullets must capture the 300-bullet burst even between samples
      expect(summary.peakBullets).toBe(300);
    });
  });

  describe('Serialization', () => {
    it('should save and load sessions', () => {
      logger.setFrameData(60, 10, 5);
      logger.setGameplayData(1000, 10, 1, 'Standard', 'hot_hands:3', 5);
      logger.setVisibilityData(8, 4, 2);
      logger.recordFrame(0.5);

      logger.saveSession();

      const sessions = logger.loadAllSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].mapType).toBe('sphere');
      expect(sessions[0].dataPoints.length).toBe(1);

      const dp = sessions[0].dataPoints[0];
      expect(dp.s).toBe(1000); // score
      expect(dp.k).toBe(10);   // kills
      expect(dp.ve).toBe(8);   // visibleEnemies
      expect(dp.vb).toBe(4);   // visibleBullets
      expect(dp.ax).toBe(2);   // activeExplosions
    });

    it('should export CSV with visibility fields', () => {
      logger.setFrameData(60, 10, 5);
      logger.setVisibilityData(8, 4, 2);
      logger.recordFrame(0.5);
      logger.saveSession();

      const csv = PerformanceLogger.exportAllAsCSV();
      expect(csv).toContain('visible_enemies');
      expect(csv).toContain('visible_bullets');
      expect(csv).toContain('active_explosions');
    });
  });

  describe('Backward Compatibility', () => {
    it('should handle old sessions without visibility fields', () => {
      // Simulate an old session without visibility fields
      const oldSession = {
        timestamp: new Date().toISOString(),
        mapType: 'sphere',
        duration: 10,
        dataPoints: [
          {
            t: 0,
            f: 60,
            e: 10,
            b: 5,
            et: [],
            dc: 0,
            tr: 0,
            mm: 0,
            lh: 0,
            lm: 0,
            ll: 0,
            dd: 0,
            ql: 'HIGH',
            s: 1000,
            k: 10,
            d: 1,
            aw: 'Standard',
            ks: 0,
            ae: 5,
            // NO visibility fields (ve, vb, ax)
          },
        ],
      };

      localStorage.setItem('gw_perf_log', JSON.stringify([oldSession]));

      const sessions = logger.loadAllSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].dataPoints[0].ve).toBeUndefined();
      expect(sessions[0].dataPoints[0].vb).toBeUndefined();
      expect(sessions[0].dataPoints[0].ax).toBeUndefined();
    });
  });

  describe('Ring Buffer', () => {
    it('should maintain FIFO order in ring buffer', () => {
      // Record 10 samples
      for (let i = 0; i < 10; i++) {
        logger.setFrameData(60 - i, i, i);
        logger.recordFrame(0.5);
      }

      const points = logger.getDataPoints();
      expect(points.length).toBe(10);
      // First point should have fps=60, last should have fps=51
      expect(points[0].fps).toBe(60);
      expect(points[9].fps).toBe(51);
    });
  });

  describe('Zero Allocation Updates', () => {
    it('should update visibility data without allocations', () => {
      // First update
      logger.setVisibilityData(10, 5, 2);
      logger.recordFrame(0.5);

      // Second update (reuses internal state)
      logger.setVisibilityData(15, 8, 3);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points.length).toBe(2);
      expect(points[0].visibleEnemies).toBe(10);
      expect(points[1].visibleEnemies).toBe(15);
    });
  });

  describe('DDA Extended Metrics (difficulty tier + player power level)', () => {
    it('should record difficulty tier in data points', () => {
      logger.setDifficultyTier(2.5);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points.length).toBe(1);
      expect(points[0].difficultyTier).toBe(2.5);
    });

    it('should record player power level in data points', () => {
      logger.setPlayerPowerLevel(7);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points.length).toBe(1);
      expect(points[0].playerPowerLevel).toBe(7);
    });

    it('should track peak difficulty tier in session summary', () => {
      logger.setDifficultyTier(1.0);
      logger.recordFrame(0.016);
      logger.setDifficultyTier(3.75);
      logger.recordFrame(0.016);
      logger.setDifficultyTier(2.5);
      logger.recordFrame(0.016);

      const summary = logger.getSessionSummary()!;
      expect(summary.peakDifficultyTier).toBe(3.75);
    });

    it('should include final player power level in session summary', () => {
      logger.setPlayerPowerLevel(5);
      logger.recordFrame(0.016);
      logger.setPlayerPowerLevel(9);
      logger.recordFrame(0.016);

      const summary = logger.getSessionSummary()!;
      expect(summary.finalPlayerPowerLevel).toBe(9);
    });

    it('should serialize difficulty tier and player power level', () => {
      logger.setDifficultyTier(3.14);
      logger.setPlayerPowerLevel(4);
      logger.recordFrame(0.5);
      logger.saveSession();

      const sessions = logger.loadAllSessions();
      expect(sessions.length).toBe(1);
      const dp = sessions[0].dataPoints[0];
      expect(dp.dt).toBe(3.14);
      expect(dp.pl).toBe(4);
    });

    it('should omit difficulty tier and player level from serialized data when zero', () => {
      // When values are zero, they should be omitted to save storage space
      logger.setDifficultyTier(0);
      logger.setPlayerPowerLevel(0);
      logger.recordFrame(0.5);
      logger.saveSession();

      const sessions = logger.loadAllSessions();
      const dp = sessions[0].dataPoints[0];
      expect(dp.dt).toBeUndefined();
      expect(dp.pl).toBeUndefined();
    });

    it('should include difficulty_tier and player_power_level columns in CSV', () => {
      logger.setDifficultyTier(2.5);
      logger.setPlayerPowerLevel(3);
      logger.recordFrame(0.5);
      logger.saveSession();

      const csv = PerformanceLogger.exportAllAsCSV();
      expect(csv).toContain('difficulty_tier');
      expect(csv).toContain('player_power_level');
    });

    it('should handle old sessions without difficulty tier fields (backward compat)', () => {
      const oldSession = {
        timestamp: new Date().toISOString(),
        mapType: 'sphere',
        duration: 10,
        dataPoints: [
          {
            t: 0, f: 60, e: 10, b: 5, et: [],
            dc: 0, tr: 0, mm: 0, lh: 0, lm: 0, ll: 0,
            dd: 1.5,
            ql: 'HIGH',
            // NO dt or pl fields (old session format)
          },
        ],
      };

      localStorage.setItem('gw_perf_log', JSON.stringify([oldSession]));
      const sessions = logger.loadAllSessions();
      expect(sessions[0].dataPoints[0].dt).toBeUndefined();
      expect(sessions[0].dataPoints[0].pl).toBeUndefined();
    });

    it('should support super-tier values (difficulty tier > 4)', () => {
      // Super tiers are continuous values beyond Nightmare (>4)
      logger.setDifficultyTier(5.7);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points[0].difficultyTier).toBe(5.7);

      const summary = logger.getSessionSummary()!;
      expect(summary.peakDifficultyTier).toBe(5.7);
    });
  });
});
