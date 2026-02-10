import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DDALogger, type DDASessionLog } from './DDALogger';
import type { DDAPerformanceTracker, PerformanceSnapshot } from './DDAPerformanceTracker';
import type { DDADecisionEngine } from './DDADecisionEngine';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockTracker(overrides?: Partial<{
  kills: number;
  deaths: number;
  compositeScore: number;
  snapshot: Partial<PerformanceSnapshot>;
}>): DDAPerformanceTracker {
  const kills = overrides?.kills ?? 0;
  const deaths = overrides?.deaths ?? 0;
  const score = overrides?.compositeScore ?? 0.5;
  const snap: PerformanceSnapshot = {
    killRate: overrides?.snapshot?.killRate ?? 2.0,
    deathRate: overrides?.snapshot?.deathRate ?? 0.5,
    scoreRate: overrides?.snapshot?.scoreRate ?? 100,
    closeCallFreq: 0,
    avgEnemyProximity: 0.3,
    timeAtLowHealth: 0.1,
    ...overrides?.snapshot,
  };

  return {
    getSnapshot: () => snap,
    getCompositeScore: () => score,
    get totalKills() { return kills; },
    get totalDeaths() { return deaths; },
    get elapsed() { return 0; },
    get isWarmedUp() { return true; },
    recordKill: vi.fn(),
    recordDeath: vi.fn(),
    recordCloseCall: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
  } as unknown as DDAPerformanceTracker;
}

function createMockEngine(overrides?: Partial<{
  level: number;
  speed: number;
  enabled: boolean;
}>): DDADecisionEngine {
  return {
    getDDALevel: () => overrides?.level ?? 0,
    getDDALevelSmooth: () => overrides?.level ?? 0,
    getSpeedMultiplier: () => overrides?.speed ?? 1.0,
    getCompositeScore: () => 0.5,
    isEnabled: () => overrides?.enabled ?? true,
    update: vi.fn(),
  } as unknown as DDADecisionEngine;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DDALogger', () => {
  let logger: DDALogger;
  let tracker: DDAPerformanceTracker;
  let engine: DDADecisionEngine;

  // Mock localStorage
  const store: Record<string, string> = {};
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });

    tracker = createMockTracker({ kills: 10, deaths: 2, compositeScore: 0.65 });
    engine = createMockEngine({ level: 1, speed: 1.05, enabled: true });
    logger = new DDALogger([tracker], engine, 'sphere', 5.0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Sampling
  // -----------------------------------------------------------------------

  it('does not sample before interval elapses', () => {
    logger.update(3.0); // 3s < 5s interval
    const session = logger.finalize();
    expect(session.samples).toHaveLength(0);
  });

  it('captures sample after interval elapses', () => {
    logger.update(5.0);
    const session = logger.finalize();
    expect(session.samples).toHaveLength(1);
    expect(session.samples[0].t).toBeCloseTo(5.0, 0);
    expect(session.samples[0].players).toHaveLength(1);
  });

  it('captures multiple samples over time', () => {
    for (let i = 0; i < 6; i++) {
      logger.update(5.0);
    }
    const session = logger.finalize();
    expect(session.samples).toHaveLength(6);
  });

  it('sample contains correct player data', () => {
    logger.update(5.0);
    const session = logger.finalize();
    const p = session.samples[0].players[0];
    expect(p.score).toBeCloseTo(0.65, 2);
    expect(p.level).toBe(1);
    expect(p.speed).toBeCloseTo(1.05, 1);
    expect(p.kills).toBe(10);
    expect(p.deaths).toBe(2);
    expect(p.kr).toBeCloseTo(2.0, 0);
  });

  // -----------------------------------------------------------------------
  // Event recording
  // -----------------------------------------------------------------------

  it('records kill events', () => {
    logger.recordKill(0, 'Wanderer');
    logger.recordKill(0, 'Spinner');
    const session = logger.finalize();
    expect(session.events.filter(e => e.type === 'kill')).toHaveLength(2);
    expect(session.events[0].data).toBe('Wanderer');
  });

  it('records death events', () => {
    logger.recordDeath(0);
    const session = logger.finalize();
    expect(session.events.filter(e => e.type === 'death')).toHaveLength(1);
  });

  it('caps events at max limit', () => {
    for (let i = 0; i < 2100; i++) {
      logger.recordKill(0, 'Test');
    }
    const session = logger.finalize();
    expect(session.events.length).toBeLessThanOrEqual(2000);
  });

  // -----------------------------------------------------------------------
  // Level change detection
  // -----------------------------------------------------------------------

  it('detects DDA level changes', () => {
    // First sample at level 1 (engine returns level 1, prevLevel starts at 0)
    // This triggers an initial 0→1 change
    logger.update(5.0);

    // Change engine to return level 2
    (engine as any).getDDALevel = () => 2;
    logger.update(5.0);

    const session = logger.finalize();
    const levelChanges = session.events.filter(e => e.type === 'level_change');
    expect(levelChanges).toHaveLength(2); // 0→1, then 1→2
    expect(levelChanges[0].data).toBe(1);
    expect(levelChanges[1].data).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  it('finalize produces complete session log', () => {
    logger.update(5.0);
    logger.recordKill(0, 'Grunt');
    const session = logger.finalize();

    expect(session.startedAt).toBeDefined();
    expect(session.surface).toBe('sphere');
    expect(session.playerCount).toBe(1);
    expect(session.ddaEnabled).toBe(true);
    expect(session.samples.length).toBeGreaterThan(0);
    expect(session.events.length).toBeGreaterThan(0);
    expect(session.summary).not.toBeNull();
  });

  it('summary has correct player stats', () => {
    logger.update(5.0);
    logger.update(5.0);
    const session = logger.finalize();
    const summary = session.summary!;

    expect(summary.duration).toBeCloseTo(10.0, 0);
    expect(summary.players).toHaveLength(1);
    expect(summary.players[0].totalKills).toBe(10);
    expect(summary.players[0].totalDeaths).toBe(2);
    expect(summary.players[0].avgCompositeScore).toBeCloseTo(0.65, 2);
    expect(summary.players[0].maxDDALevel).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  it('persists session to localStorage on finalize', () => {
    logger.update(5.0);
    logger.finalize();

    const sessions = DDALogger.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].surface).toBe('sphere');
  });

  it('accumulates sessions in localStorage', () => {
    logger.update(5.0);
    logger.finalize();

    const logger2 = new DDALogger([tracker], engine, 'torus', 5.0);
    logger2.update(5.0);
    logger2.finalize();

    const sessions = DDALogger.getSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].surface).toBe('sphere');
    expect(sessions[1].surface).toBe('torus');
  });

  it('caps stored sessions at max limit', () => {
    for (let i = 0; i < 12; i++) {
      const l = new DDALogger([tracker], engine, `surface-${i}`, 5.0);
      l.update(5.0);
      l.finalize();
    }

    const sessions = DDALogger.getSessions();
    expect(sessions.length).toBeLessThanOrEqual(10);
    // Most recent sessions kept
    expect(sessions[sessions.length - 1].surface).toBe('surface-11');
  });

  it('exportAll returns JSON string', () => {
    logger.update(5.0);
    logger.finalize();

    const json = DDALogger.exportAll();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('clearAll removes all sessions', () => {
    logger.update(5.0);
    logger.finalize();
    expect(DDALogger.getSessions()).toHaveLength(1);

    DDALogger.clearAll();
    expect(DDALogger.getSessions()).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Inactivity after finalize
  // -----------------------------------------------------------------------

  it('stops logging after finalize', () => {
    logger.finalize();
    logger.update(10.0);
    logger.recordKill(0, 'Ghost');

    // No new data should have been added
    const sessions = DDALogger.getSessions();
    expect(sessions[0].samples).toHaveLength(0);
    expect(sessions[0].events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Multi-player
  // -----------------------------------------------------------------------

  it('handles multiple trackers', () => {
    const tracker2 = createMockTracker({ kills: 5, deaths: 4, compositeScore: 0.3 });
    const multiLogger = new DDALogger([tracker, tracker2], engine, 'cube', 5.0);

    multiLogger.update(5.0);
    const session = multiLogger.finalize();

    expect(session.playerCount).toBe(2);
    expect(session.samples[0].players).toHaveLength(2);
    expect(session.samples[0].players[0].kills).toBe(10);
    expect(session.samples[0].players[1].kills).toBe(5);
    expect(session.summary!.players).toHaveLength(2);
  });
});
