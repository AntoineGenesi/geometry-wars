import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/PerformanceLogger';
import {
  filterScoreGraphEvents,
  getScoreGraphEventLabel,
  getVisibleKillTimeline,
} from './ScoreGraphPanel';

describe('ScoreGraphPanel timeline event semantics', () => {
  it('shows combo and PvP kill markers while suppressing raw PvE kill markers', () => {
    const events: GameEvent[] = [
      { time: 1, type: 'kill', label: 'wanderer' },
      {
        time: 1.4,
        type: 'combo',
        label: '3x PvE Combo',
        value: 3,
        metadata: {
          startTime: 0,
          endTime: 1.4,
          duration: 1.4,
          enemyTypes: { wanderer: 2, prism_lancer: 1 },
        },
      },
      {
        time: 2,
        type: 'pvp_kill',
        label: 'Host defeated Join',
        value: 2,
        metadata: {
          killerName: 'Host',
          victimName: 'Join',
          streakCount: 2,
        },
      },
      { time: 3, type: 'wave_start', label: 'Wave 2', value: 2 },
      { time: 4, type: 'kill_streak', label: '5-kill streak', value: 5 },
    ];

    const filtered = filterScoreGraphEvents(events, 10);

    expect(filtered.map(e => e.type)).toEqual(['combo', 'pvp_kill', 'wave_start', 'kill_streak']);
  });

  it('formats combo and PvP tooltip labels distinctly', () => {
    expect(getScoreGraphEventLabel({
      time: 1.4,
      type: 'combo',
      label: '4x PvE Combo',
      value: 4,
      metadata: {
        startTime: 0,
        endTime: 1.4,
        duration: 1.4,
        enemyTypes: { sentinel_orb: 4 },
      },
    })).toBe('4x PvE combo over 1.4s');

    expect(getScoreGraphEventLabel({
      time: 2,
      type: 'pvp_kill',
      label: 'Fallback label',
      value: 1,
      metadata: {
        killerName: 'Host',
        victimName: 'Join',
        streakCount: 1,
      },
    })).toBe('Host defeated Join');
  });
});

describe('ScoreGraphPanel kills-by-type visibility', () => {
  const timeline = {
    times: [1, 2, 3],
    types: ['wanderer', 'spinner', 'titan_grunt'],
    series: [
      [1, 2, 3],
      [0, 1, 1],
      [0, 0, 2],
    ],
  };

  it('keeps exact killed type labels while excluding hidden series from the visible timeline', () => {
    const visible = getVisibleKillTimeline(timeline, new Set(['spinner']));

    expect(visible.types).toEqual(['wanderer', 'titan_grunt']);
    expect(visible.hiddenTypes).toEqual(['spinner']);
    expect(visible.originalIndices).toEqual([0, 2]);
    expect(visible.types).not.toContain('other');
    expect(visible.series).toEqual([
      [1, 2, 3],
      [0, 0, 2],
    ]);
  });

  it('allows an all-hidden visible timeline for fallback callers without inventing Other', () => {
    const visible = getVisibleKillTimeline(
      timeline,
      new Set(['wanderer', 'spinner', 'titan_grunt']),
    );

    expect(visible.types).toEqual([]);
    expect(visible.series).toEqual([]);
    expect(visible.hiddenTypes).toEqual(['wanderer', 'spinner', 'titan_grunt']);
    expect(visible.hiddenTypes).not.toContain('other');
  });
});
