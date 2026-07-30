import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/PerformanceLogger';
import {
  filterScoreGraphEvents,
  getScoreGraphEventLabel,
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
    ];

    const filtered = filterScoreGraphEvents(events, 10);

    expect(filtered.map(e => e.type)).toEqual(['combo', 'pvp_kill', 'wave_start']);
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
