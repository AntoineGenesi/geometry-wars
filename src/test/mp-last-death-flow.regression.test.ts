/**
 * Regression test: MP last-death flow (s44r6-02)
 *
 * Verifies the logic that controls the 3-second death camera hold before
 * transitioning to mastery/voting screens when the last player dies.
 *
 * Bug: When the final player died in MP, the game jumped straight to the
 * hosting/lobby screen, skipping explosion, death camera, mastery screen.
 *
 * Fix: Detect "final death" (local player dies with no other alive players),
 * delay the voting transition by 3 seconds, always show WeaponMasteryScreen.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Pure logic extracted from network-main.ts for testability:
// The final-death detection and delay logic
// ---------------------------------------------------------------------------

interface MockPlayerState {
  id: string;
  alive: boolean;
  lives: number;
}

interface MockGameState {
  players: Map<string, MockPlayerState>;
}

/**
 * Mirrors the final-death detection logic in network-main.ts.
 * Returns true if the local player just died with no other alive players.
 */
function detectFinalDeath(
  localPlayerId: string,
  state: MockGameState,
  dyingPlayerId: string,
): boolean {
  if (dyingPlayerId !== localPlayerId) return false;
  let hasAliveSpectateTarget = false;
  state.players.forEach((p, pid) => {
    if (pid !== dyingPlayerId && p.alive) hasAliveSpectateTarget = true;
  });
  return !hasAliveSpectateTarget;
}

/**
 * Mirrors the delay calculation in network-main.ts for the voting transition.
 * Returns the remaining delay in ms (0 means proceed immediately).
 */
function calculateVotingDelay(
  localPlayerFinalDeathTime: number | null,
  DEATH_CAM_HOLD_MS = 3000,
): number {
  if (localPlayerFinalDeathTime === null) return 0;
  const elapsed = Date.now() - localPlayerFinalDeathTime;
  return Math.max(0, DEATH_CAM_HOLD_MS - elapsed);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MP last-death flow — final death detection (s44r6-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('detectFinalDeath()', () => {
    it('returns true when local player dies and no other alive players (solo game)', () => {
      const state: MockGameState = {
        players: new Map([
          ['player1', { id: 'player1', alive: false, lives: 0 }],
        ]),
      };
      expect(detectFinalDeath('player1', state, 'player1')).toBe(true);
    });

    it('returns true when local player is last alive (all others already dead)', () => {
      const state: MockGameState = {
        players: new Map([
          ['player1', { id: 'player1', alive: false, lives: 0 }], // just died
          ['player2', { id: 'player2', alive: false, lives: 0 }], // already dead
          ['player3', { id: 'player3', alive: false, lives: 0 }], // already dead
        ]),
      };
      // player1 is the local player, dying now — no other alive players
      expect(detectFinalDeath('player1', state, 'player1')).toBe(true);
    });

    it('returns false when local player dies but other players are still alive', () => {
      const state: MockGameState = {
        players: new Map([
          ['player1', { id: 'player1', alive: false, lives: 0 }], // just died
          ['player2', { id: 'player2', alive: true, lives: 2 }],  // still alive
        ]),
      };
      // Not a final death — player2 can still play
      expect(detectFinalDeath('player1', state, 'player1')).toBe(false);
    });

    it('returns false when a REMOTE player dies (not the local player)', () => {
      const state: MockGameState = {
        players: new Map([
          ['player1', { id: 'player1', alive: true, lives: 2 }],  // local player, alive
          ['player2', { id: 'player2', alive: false, lives: 0 }], // remote dies
        ]),
      };
      // Remote player dying — local player is unaffected
      expect(detectFinalDeath('player1', state, 'player2')).toBe(false);
    });

    it('returns false when remote player is last — local was already dead', () => {
      const state: MockGameState = {
        players: new Map([
          ['player1', { id: 'player1', alive: false, lives: 0 }], // local, already dead
          ['player2', { id: 'player2', alive: false, lives: 0 }], // remote just died
        ]),
      };
      // Remote player dying — local player already spectating, isFinalDeath only
      // fires for local player's own death moment
      expect(detectFinalDeath('player1', state, 'player2')).toBe(false);
    });
  });

  describe('calculateVotingDelay()', () => {
    it('returns 0 when no final death occurred (null timestamp)', () => {
      expect(calculateVotingDelay(null)).toBe(0);
    });

    it('returns ~3000 when final death JUST occurred (0ms elapsed)', () => {
      const now = Date.now();
      vi.setSystemTime(now);
      const delay = calculateVotingDelay(now);
      expect(delay).toBeCloseTo(3000, -1); // within 100ms
    });

    it('returns ~1500 when 1500ms have elapsed since final death', () => {
      const deathTime = Date.now();
      vi.setSystemTime(deathTime + 1500);
      const delay = calculateVotingDelay(deathTime);
      expect(delay).toBeCloseTo(1500, -1); // within 100ms
    });

    it('returns 0 when 3+ seconds have elapsed since final death', () => {
      const deathTime = Date.now();
      vi.setSystemTime(deathTime + 3500); // 3.5s later
      const delay = calculateVotingDelay(deathTime);
      expect(delay).toBe(0);
    });

    it('returns 0 when 10 seconds have elapsed (long spectator phase)', () => {
      const deathTime = Date.now();
      vi.setSystemTime(deathTime + 10000);
      const delay = calculateVotingDelay(deathTime);
      expect(delay).toBe(0);
    });
  });

  describe('REGRESSION: voting transition delays correctly on final death', () => {
    it('delays exactly 3 seconds from the moment of final death', () => {
      const deathTime = 1000; // arbitrary base time
      vi.setSystemTime(deathTime); // death happens at t=1000
      const finalDeathTime = Date.now(); // = 1000

      // Voting transition triggered at t=1000 (same frame as death)
      const delay = calculateVotingDelay(finalDeathTime);
      expect(delay).toBe(3000); // should wait full 3 seconds
    });

    it('delays only remaining time if voting arrives after partial death cam', () => {
      const deathTime = 1000;
      vi.setSystemTime(deathTime);
      const finalDeathTime = Date.now();

      // Voting transition arrives 1.2 seconds after death
      vi.setSystemTime(deathTime + 1200);
      const delay = calculateVotingDelay(finalDeathTime);
      expect(delay).toBe(1800); // 3000 - 1200 = 1800ms remaining
    });

    it('no delay when final death did NOT happen (time limit, kill limit)', () => {
      // Game ended by time/kill limit, not final death
      const delay = calculateVotingDelay(null);
      expect(delay).toBe(0); // immediate transition
    });
  });
});
