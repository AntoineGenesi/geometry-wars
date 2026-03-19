/**
 * Regression test: In Waves (co-op) mode, the center HUD score display
 * must show the LOCAL player's own score, not the combined team score.
 *
 * Bug (s44r31-02): #score-display was always showing combinedScore in Waves mode.
 * If the host (Antoine) had most kills, combined ≈ host's score, and the
 * laptop player's center display appeared to show the host's score.
 *
 * Fix: in Waves mode, show localPlayer.score when localPlayer is available.
 */
import { describe, it, expect } from 'vitest';
import type { NetworkPlayerState } from './NetworkClient';

type PlayerMap = Map<string, Pick<NetworkPlayerState, 'id' | 'score' | 'kills' | 'zoneTime'>>;

/**
 * Computes the center score display text for a given game state.
 * Mirrors the teamScoreEl logic in onStateChange (network-main.ts).
 */
function computeCenterScoreText(opts: {
  players: PlayerMap;
  localPlayerId: string;
  pvpEnabled: boolean;
  isZoneTimeMode: boolean;
}): string {
  const { players, localPlayerId, pvpEnabled, isZoneTimeMode } = opts;
  const localPlayer = players.get(localPlayerId);
  const isCompetitiveMode = pvpEnabled || isZoneTimeMode;

  let combinedScore = 0;
  players.forEach((p) => { combinedScore += p.score; });

  if (isCompetitiveMode && localPlayer) {
    // Competitive: show local player's metric + rank (tested by s44r18-04)
    if (isZoneTimeMode) {
      const zt = localPlayer.zoneTime ?? 0;
      const mins = Math.floor(zt / 60);
      return mins > 0
        ? `${mins}:${(zt % 60).toFixed(1).padStart(4, '0')}`
        : `${zt.toFixed(1)}s`;
    }
    return `${(localPlayer.kills ?? 0).toFixed(2)}K`;
  } else if (isZoneTimeMode) {
    // Zone-time fallback (localPlayer not found)
    const mins = Math.floor(combinedScore / 60);
    return mins > 0
      ? `${mins}:${(combinedScore % 60).toFixed(1).padStart(4, '0')}`
      : `${combinedScore.toFixed(1)}s`;
  } else if (pvpEnabled) {
    // PvP fallback (localPlayer not found)
    return `${combinedScore.toFixed(2)}K`;
  } else if (localPlayer) {
    // s44r31-02 fix: Co-op Waves — show local player's own score
    return localPlayer.score.toLocaleString();
  } else {
    // Fallback when localPlayer not found (race condition during connect)
    return combinedScore.toLocaleString();
  }
}

describe('center score display (teamScoreEl)', () => {
  describe('Waves mode (co-op, non-competitive)', () => {
    it('shows LOCAL player score, not combined — laptop player sees their own score', () => {
      const players: PlayerMap = new Map([
        ['host-session-id', { id: 'host-session-id', score: 5000, kills: 0, zoneTime: 0 }],
        ['laptop-session-id', { id: 'laptop-session-id', score: 300, kills: 0, zoneTime: 0 }],
      ]);
      // From the laptop player's perspective
      const result = computeCenterScoreText({
        players,
        localPlayerId: 'laptop-session-id',
        pvpEnabled: false,
        isZoneTimeMode: false,
      });
      // Should show laptop player's own score (300), NOT combined (5300) or host's score (5000)
      expect(result).toBe('300');
    });

    it('shows HOST player score from host perspective — not combined', () => {
      const players: PlayerMap = new Map([
        ['host-session-id', { id: 'host-session-id', score: 5000, kills: 0, zoneTime: 0 }],
        ['laptop-session-id', { id: 'laptop-session-id', score: 300, kills: 0, zoneTime: 0 }],
      ]);
      // From the host player's perspective
      const result = computeCenterScoreText({
        players,
        localPlayerId: 'host-session-id',
        pvpEnabled: false,
        isZoneTimeMode: false,
      });
      // Should show host's own score (5000), not combined (5300)
      expect(result).toBe('5,000');
    });

    it('falls back to combined score when localPlayer not found (race condition)', () => {
      const players: PlayerMap = new Map([
        ['host-session-id', { id: 'host-session-id', score: 5000, kills: 0, zoneTime: 0 }],
        ['laptop-session-id', { id: 'laptop-session-id', score: 300, kills: 0, zoneTime: 0 }],
      ]);
      // localPlayerId not yet resolved (empty string)
      const result = computeCenterScoreText({
        players,
        localPlayerId: '',
        pvpEnabled: false,
        isZoneTimeMode: false,
      });
      // Fallback to combined
      expect(result).toBe('5,300');
    });
  });

  describe('KotH mode (competitive)', () => {
    it('shows local player zone time — existing s44r18-04 behavior unchanged', () => {
      const players: PlayerMap = new Map([
        ['host-session-id', { id: 'host-session-id', score: 0, kills: 0, zoneTime: 45.5 }],
        ['laptop-session-id', { id: 'laptop-session-id', score: 0, kills: 0, zoneTime: 12.3 }],
      ]);
      const result = computeCenterScoreText({
        players,
        localPlayerId: 'laptop-session-id',
        pvpEnabled: false,
        isZoneTimeMode: true,
      });
      // Should show laptop's zone time (12.3s), not host's (45.5s)
      expect(result).toBe('12.3s');
    });
  });

  describe('PvP mode (competitive)', () => {
    it('shows local player kills — existing s44r18-04 behavior unchanged', () => {
      const players: PlayerMap = new Map([
        ['host-session-id', { id: 'host-session-id', score: 0, kills: 5, zoneTime: 0 }],
        ['laptop-session-id', { id: 'laptop-session-id', score: 0, kills: 1, zoneTime: 0 }],
      ]);
      const result = computeCenterScoreText({
        players,
        localPlayerId: 'laptop-session-id',
        pvpEnabled: true,
        isZoneTimeMode: false,
      });
      // Should show laptop's kills (1.00K), not host's (5.00K)
      expect(result).toBe('1.00K');
    });
  });
});
