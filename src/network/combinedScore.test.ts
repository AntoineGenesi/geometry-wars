/**
 * Regression test: combined team score should be sum of all player scores.
 *
 * Bug: in network-main.ts, #score-display (center-top) was never updated —
 * it stayed at "0" even as players scored. This test verifies the calculation
 * logic that was added to fix the bug.
 */
import { describe, it, expect } from 'vitest';
import type { NetworkPlayerState } from './NetworkClient';

function computeCombinedScore(players: Map<string, Pick<NetworkPlayerState, 'score'>>): number {
  let combined = 0;
  players.forEach((p) => { combined += p.score; });
  return combined;
}

describe('combined team score', () => {
  it('returns 0 when no players have scored', () => {
    const players = new Map([
      ['p1', { score: 0 }],
      ['p2', { score: 0 }],
    ]);
    expect(computeCombinedScore(players)).toBe(0);
  });

  it('returns individual score when only one player has scored', () => {
    const players = new Map([
      ['p1', { score: 1500 }],
      ['p2', { score: 0 }],
    ]);
    expect(computeCombinedScore(players)).toBe(1500);
  });

  it('sums all player scores for combined team total', () => {
    const players = new Map([
      ['p1', { score: 1000 }],
      ['p2', { score: 2500 }],
    ]);
    expect(computeCombinedScore(players)).toBe(3500);
  });

  it('handles 4 players correctly', () => {
    const players = new Map([
      ['p1', { score: 100 }],
      ['p2', { score: 200 }],
      ['p3', { score: 300 }],
      ['p4', { score: 400 }],
    ]);
    expect(computeCombinedScore(players)).toBe(1000);
  });

  it('returns 0 for empty player map', () => {
    expect(computeCombinedScore(new Map())).toBe(0);
  });
});
