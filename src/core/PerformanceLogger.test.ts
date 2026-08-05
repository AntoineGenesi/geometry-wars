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
    vi.useRealTimers();
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

  describe('Player Surface Position Tracking', () => {
    it('should record player surface position in data points', () => {
      logger.setPlayerSurfacePosition(0.3, 0.7, 42, 1.5, 2.5, 3.5);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points.length).toBe(1);
      expect(points[0].playerSurfaceU).toBeCloseTo(0.3, 5);
      expect(points[0].playerSurfaceV).toBeCloseTo(0.7, 5);
      expect(points[0].playerFaceIndex).toBe(42);
      expect(points[0].playerWorldX).toBeCloseTo(1.5, 3);
      expect(points[0].playerWorldY).toBeCloseTo(2.5, 3);
      expect(points[0].playerWorldZ).toBeCloseTo(3.5, 3);
    });

    it('should not flag stuck on first call (player not yet moving)', () => {
      logger.setPlayerSurfacePosition(0.5, 0.5, 0, 0, 0, 0);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points[0].playerStuck).toBe(false);
    });

    it('should reset stuck timer when position changes', () => {
      vi.useFakeTimers();

      // Simulate player stationary for 1.5 seconds
      logger.setPlayerSurfacePosition(0.3, 0.3, 5, 1, 2, 3);
      vi.advanceTimersByTime(1500);

      // Player moves — should reset timer
      logger.setPlayerSurfacePosition(0.4, 0.4, 5, 1.1, 2, 3);
      vi.advanceTimersByTime(1000); // only 1 second since last move

      logger.recordFrame(0.5);
      const points = logger.getDataPoints();
      expect(points[0].playerStuck).toBe(false);

      vi.useRealTimers();
    });

    it('should flag stuck after >2 seconds without position change', () => {
      vi.useFakeTimers();
      // Advance initial time slightly so constructor timestamp isn't "now"
      vi.advanceTimersByTime(10);

      // Position changes on first call (different from _stuckLastU=0 default)
      logger.setPlayerSurfacePosition(0.5, 0.5, 10, 1, 2, 3);
      vi.advanceTimersByTime(2100); // 2.1 seconds later, same position

      logger.setPlayerSurfacePosition(0.5, 0.5, 10, 1, 2, 3);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points[0].playerStuck).toBe(true);

      vi.useRealTimers();
    });

    it('should not flag stuck if face changes even when UV is same', () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(10);

      logger.setPlayerSurfacePosition(0.5, 0.5, 10, 1, 2, 3);
      vi.advanceTimersByTime(2100);

      // UV same but face changed — still moving
      logger.setPlayerSurfacePosition(0.5, 0.5, 11, 1, 2, 3);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      expect(points[0].playerStuck).toBe(false);

      vi.useRealTimers();
    });

    it('should serialize and restore player surface position fields', () => {
      logger.setPlayerSurfacePosition(0.25, 0.75, 100, 5.5, -2.3, 1.1);
      logger.recordFrame(0.5);
      logger.saveSession();

      const sessions = logger.loadAllSessions();
      expect(sessions.length).toBe(1);
      const dp = sessions[0].dataPoints[0];
      expect(dp.pu).toBeCloseTo(0.25, 5);
      expect(dp.pv).toBeCloseTo(0.75, 5);
      expect(dp.pf).toBe(100);
    });

    it('should include player surface position columns in CSV', () => {
      logger.setPlayerSurfacePosition(0.3, 0.7, 42, 1.5, 2.5, 3.5);
      logger.recordFrame(0.5);
      logger.saveSession();

      const csv = PerformanceLogger.exportAllAsCSV();
      expect(csv).toContain('player_surface_u');
      expect(csv).toContain('player_surface_v');
      expect(csv).toContain('player_face_index');
      expect(csv).toContain('player_world_x');
      expect(csv).toContain('player_world_y');
      expect(csv).toContain('player_world_z');
      expect(csv).toContain('player_stuck');
    });

    it('should handle old sessions without player surface fields (backward compat)', () => {
      const oldSession = {
        timestamp: new Date().toISOString(),
        mapType: 'sphere',
        duration: 10,
        dataPoints: [
          {
            t: 0, f: 60, e: 10, b: 5, et: [],
            dc: 0, tr: 0, mm: 0, lh: 0, lm: 0, ll: 0,
            dd: 0, ql: 'HIGH', s: 0, k: 0, d: 0, aw: 'Standard', ks: 0, ae: 0,
            // NO player surface fields (old session format)
          },
        ],
      };

      localStorage.setItem('gw_perf_log', JSON.stringify([oldSession]));
      const sessions = logger.loadAllSessions();
      expect(sessions[0].dataPoints[0].pu).toBeUndefined();
      expect(sessions[0].dataPoints[0].ps).toBeUndefined();
    });
  });

  describe('Weapon Analytics', () => {
    it('should return empty analytics with no data', () => {
      const analytics = logger.getWeaponAnalytics();
      expect(analytics.weaponTimeline).toHaveLength(0);
      expect(analytics.killsByWeapon).toHaveLength(0);
      expect(analytics.buffKillContrib).toHaveLength(0);
    });

    it('should count kills per weapon', () => {
      logger.recordWeaponKill('Standard', '');
      logger.recordWeaponKill('Standard', '');
      logger.recordWeaponKill('spread', '');

      const analytics = logger.getWeaponAnalytics();
      const standard = analytics.killsByWeapon.find(w => w.weapon === 'Standard');
      const spread = analytics.killsByWeapon.find(w => w.weapon === 'spread');
      expect(standard?.kills).toBe(2);
      expect(spread?.kills).toBe(1);
    });

    it('should sort kills by weapon descending', () => {
      logger.recordWeaponKill('spread', '');
      logger.recordWeaponKill('Standard', '');
      logger.recordWeaponKill('Standard', '');
      logger.recordWeaponKill('Standard', '');

      const analytics = logger.getWeaponAnalytics();
      expect(analytics.killsByWeapon[0].weapon).toBe('Standard');
      expect(analytics.killsByWeapon[0].kills).toBe(3);
    });

    it('should track buff kill contributions', () => {
      logger.recordWeaponKill('Standard', 'hot_hands:3,shock_aura:1');
      logger.recordWeaponKill('Standard', 'hot_hands:2');
      logger.recordWeaponKill('spread', '');

      const analytics = logger.getWeaponAnalytics();
      const hotHands = analytics.buffKillContrib.find(b => b.buff === 'hot_hands');
      const shockAura = analytics.buffKillContrib.find(b => b.buff === 'shock_aura');
      expect(hotHands?.kills).toBe(2);
      expect(shockAura?.kills).toBe(1);
    });

    it('should compute weapon timeline from sample data', () => {
      // Record 3 samples with Standard, 1 with spread
      logger.setGameplayData(0, 0, 0, 'Standard', '', 0);
      logger.recordFrame(0.5);
      logger.recordFrame(0.5);
      logger.recordFrame(0.5);
      logger.setGameplayData(0, 0, 0, 'spread', '', 0);
      logger.recordFrame(0.5);

      const analytics = logger.getWeaponAnalytics();
      expect(analytics.weaponTimeline.length).toBeGreaterThan(0);
      const standard = analytics.weaponTimeline.find(w => w.weapon === 'Standard');
      expect(standard).toBeDefined();
      expect(standard!.pct).toBeCloseTo(75, 0);
    });

    it('should include weapon analytics in session summary', () => {
      logger.recordWeaponKill('Standard', 'hot_hands:1');
      const summary = logger.getSessionSummary();
      expect(summary?.killsByWeapon).toBeDefined();
      expect(summary?.weaponTimeline).toBeDefined();
      expect(summary?.buffKillContrib).toBeDefined();
    });
  });

  describe('Kill Breakdown by Enemy Type', () => {
    it('should aggregate kills by enemy type from events', () => {
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'grunt');
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'spinner');

      const breakdown = logger.getKillsByEnemyType();
      expect(breakdown.length).toBe(3);
      // Sorted descending by count
      expect(breakdown[0]).toEqual({ enemyType: 'wanderer', kills: 3 });
      expect(breakdown[1]).toEqual({ enemyType: 'grunt', kills: 1 });
      expect(breakdown[2]).toEqual({ enemyType: 'spinner', kills: 1 });
    });

    it('should return empty array when no kills', () => {
      const breakdown = logger.getKillsByEnemyType();
      expect(breakdown).toEqual([]);
    });

    it('should not count non-kill events', () => {
      logger.recordEvent('wave_start', 'Wave 1', 1);
      logger.recordEvent('player_death', 'Death');
      logger.recordEvent('kill', 'wanderer');

      const breakdown = logger.getKillsByEnemyType();
      expect(breakdown.length).toBe(1);
      expect(breakdown[0].enemyType).toBe('wanderer');
    });

    it('should compute kill timeline by enemy type', () => {
      // Record some data points first (needed for timeline times)
      logger.setFrameData(60, 10, 5);
      logger.recordFrame(0.5);
      // Record kills between first and second data point
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'grunt');
      logger.setFrameData(60, 10, 5);
      logger.recordFrame(0.5);
      // More kills
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'spinner');
      logger.setFrameData(60, 10, 5);
      logger.recordFrame(0.5);

      const timeline = logger.getKillTimelineByEnemyType(3);
      expect(timeline.types.length).toBeGreaterThan(0);
      expect(timeline.times.length).toBe(3);
      expect(timeline.series.length).toBe(timeline.types.length);

      // Wanderer should be the first type (most kills)
      expect(timeline.types[0]).toBe('wanderer');

      // At the last time point, wanderer should have 3 cumulative kills
      const wandererSeries = timeline.series[0];
      expect(wandererSeries[wandererSeries.length - 1]).toBe(3);
    });

    it('should lump excess types as "other" in timeline', () => {
      // Create kills for 4 different types, use topN=2
      logger.setFrameData(60, 10, 5);
      logger.recordFrame(0.5);
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'wanderer');
      logger.recordEvent('kill', 'grunt');
      logger.recordEvent('kill', 'spinner');
      logger.recordEvent('kill', 'rocket');
      logger.setFrameData(60, 10, 5);
      logger.recordFrame(0.5);

      const timeline = logger.getKillTimelineByEnemyType(2);
      // Should have top 2 types + "other"
      expect(timeline.types.length).toBe(3);
      expect(timeline.types[0]).toBe('wanderer');
      expect(timeline.types[timeline.types.length - 1]).toBe('other');

      // "other" should include spinner + rocket = 2
      const otherSeries = timeline.series[timeline.types.length - 1];
      expect(otherSeries[otherSeries.length - 1]).toBe(2);
    });
  });

  describe('PvE combo timeline events', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      logger = new PerformanceLogger('sphere');
    });

    it('aggregates dense PvE kills into a time-limited combo while preserving raw kill data', () => {
      logger.recordEvent('kill', 'wanderer');
      vi.advanceTimersByTime(600);
      logger.recordEvent('kill', 'prism_lancer');
      vi.advanceTimersByTime(800);
      logger.recordEvent('kill', 'wanderer');

      const events = logger.getEvents();
      const combos = events.filter(e => e.type === 'combo');
      const rawKills = events.filter(e => e.type === 'kill');

      expect(rawKills).toHaveLength(3);
      expect(combos).toHaveLength(1);
      expect(combos[0].value).toBe(3);
      expect(combos[0].label).toBe('3x PvE Combo');
      expect(combos[0].metadata).toMatchObject({
        startTime: 0,
        endTime: 1.4,
        duration: 1.4,
        enemyTypes: {
          wanderer: 2,
          prism_lancer: 1,
        },
      });

      expect(logger.getKillsByEnemyType()[0]).toEqual({ enemyType: 'wanderer', kills: 2 });
    });

    it('does not create combo markers for sparse or below-threshold PvE kills', () => {
      logger.recordEvent('kill', 'wanderer');
      vi.advanceTimersByTime(1_600);
      logger.recordEvent('kill', 'grunt');
      vi.advanceTimersByTime(200);
      logger.recordEvent('kill', 'grunt');

      const events = logger.getEvents();
      expect(events.filter(e => e.type === 'kill')).toHaveLength(3);
      expect(events.some(e => e.type === 'combo')).toBe(false);
    });

    it('tracks continuous PvE streaks across sparse kills and resets them on death', () => {
      [0, 2, 4, 6, 8].forEach((elapsed, index) => {
        logger.recordEventAtElapsedForReview(elapsed, 'kill', index % 2 === 0 ? 'wanderer' : 'grunt');
      });
      logger.recordEventAtElapsedForReview(9, 'player_death', 'Death');
      [10, 12, 14, 16, 18].forEach((elapsed, index) => {
        logger.recordEventAtElapsedForReview(elapsed, 'kill', index % 2 === 0 ? 'rocket' : 'spinner');
      });

      const events = logger.getEvents();
      const streaks = events.filter(e => e.type === 'kill_streak');

      expect(events.some(e => e.type === 'combo')).toBe(false);
      expect(streaks.map(e => e.value)).toEqual([5, 5]);
      expect(streaks.map(e => e.time)).toEqual([8, 18]);
      expect(events.filter(e => e.type === 'player_death')).toHaveLength(1);
    });

    it('does not derive graph kill streak markers from a 500ms sample burst', () => {
      logger.setFrameData(60, 8, 4);
      logger.setGameplayData(300, 3, 0, 'Standard', '', 1);
      logger.recordFrame(0.5);

      const points = logger.getDataPoints();
      const events = logger.getEvents();

      expect(points[0].killsThisSample).toBe(3);
      expect(events.some(e => e.type === 'kill_streak')).toBe(false);
    });

    it('keeps PvP kills explicit and outside PvE combo aggregation', () => {
      logger.recordEvent('kill', 'wanderer');
      vi.advanceTimersByTime(200);
      logger.recordEvent('kill', 'grunt');
      vi.advanceTimersByTime(200);
      logger.recordPvpKill({
        killerId: 'p1',
        killerName: 'Host',
        victimId: 'p2',
        victimName: 'Join',
        streakCount: 4,
      });

      const events = logger.getEvents();
      const pvpKills = events.filter(e => e.type === 'pvp_kill');

      expect(events.some(e => e.type === 'combo')).toBe(false);
      expect(pvpKills).toHaveLength(1);
      expect(pvpKills[0]).toMatchObject({
        label: 'Host defeated Join',
        value: 4,
        metadata: {
          killerId: 'p1',
          killerName: 'Host',
          victimId: 'p2',
          victimName: 'Join',
          streakCount: 4,
        },
      });
    });

    it('does not repurpose kill_streak events as combo events', () => {
      logger.recordEvent('kill', 'wanderer');
      vi.advanceTimersByTime(100);
      logger.recordEvent('kill', 'wanderer');
      vi.advanceTimersByTime(100);
      logger.recordEvent('kill', 'shatter_bloom');
      logger.recordEvent('kill_streak', 'Triple Kill', 3);

      const events = logger.getEvents();
      expect(events.filter(e => e.type === 'combo')).toHaveLength(1);
      expect(events.filter(e => e.type === 'kill_streak')).toHaveLength(1);
      expect(events.filter(e => e.type === 'kill_streak')[0].label).toBe('Triple Kill');
    });
  });
});
