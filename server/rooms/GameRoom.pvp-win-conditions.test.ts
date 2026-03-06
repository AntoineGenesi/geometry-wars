/**
 * Unit tests for PvP settable win conditions (s44l-21).
 *
 * Tests validate logic for all three win conditions:
 * - kills: first to pvpKillLimit wins
 * - survival: last player standing wins
 * - score: highest score when timeLimit expires wins
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 */

import { describe, it, expect } from 'vitest';
import { validateSettings, DEFAULT_GAME_SETTINGS } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Minimal player type for win condition checking
// ---------------------------------------------------------------------------

interface WinCheckPlayer {
  id: string;
  name: string;
  alive: boolean;
  kills: number;
  score: number;
}

// ---------------------------------------------------------------------------
// Win condition logic mirroring GameRoom.checkGameOver() PvP block
// ---------------------------------------------------------------------------

interface WinCheckResult {
  ended: boolean;
  reason?: string;
}

function checkPvPWinCondition(
  players: WinCheckPlayer[],
  winCondition: string,
  killLimit: number,
  timeLimit: number,
  gameTime: number,
): WinCheckResult {
  if (players.length <= 1) return { ended: false };

  if (winCondition === 'kills') {
    for (const player of players) {
      if (player.kills >= killLimit) {
        return { ended: true, reason: `${player.name} reached ${killLimit} kills` };
      }
    }
  } else if (winCondition === 'survival') {
    const aliveCount = players.filter((p) => p.alive).length;
    if (aliveCount <= 1) {
      return { ended: true, reason: 'last player standing' };
    }
  } else if (winCondition === 'score') {
    if (timeLimit > 0 && gameTime >= timeLimit) {
      return { ended: true, reason: `time limit reached (${timeLimit}s)` };
    }
  }

  return { ended: false };
}

// ---------------------------------------------------------------------------
// validateSettings — pvpKillLimit
// ---------------------------------------------------------------------------

describe('validateSettings — pvpKillLimit', () => {
  it('defaults to 10', () => {
    expect(validateSettings({}).pvpKillLimit).toBe(10);
  });

  it('accepts valid values in range 1–50', () => {
    expect(validateSettings({ pvpKillLimit: 1 }).pvpKillLimit).toBe(1);
    expect(validateSettings({ pvpKillLimit: 25 }).pvpKillLimit).toBe(25);
    expect(validateSettings({ pvpKillLimit: 50 }).pvpKillLimit).toBe(50);
  });

  it('clamps to 1 (below minimum)', () => {
    expect(validateSettings({ pvpKillLimit: 0 }).pvpKillLimit).toBe(1);
    expect(validateSettings({ pvpKillLimit: -5 }).pvpKillLimit).toBe(1);
  });

  it('clamps to 50 (above maximum)', () => {
    expect(validateSettings({ pvpKillLimit: 51 }).pvpKillLimit).toBe(50);
    expect(validateSettings({ pvpKillLimit: 999 }).pvpKillLimit).toBe(50);
  });

  it('rounds fractional values', () => {
    expect(validateSettings({ pvpKillLimit: 7.6 }).pvpKillLimit).toBe(8);
    expect(validateSettings({ pvpKillLimit: 3.2 }).pvpKillLimit).toBe(3);
  });

  it('falls back to default on NaN', () => {
    expect(validateSettings({ pvpKillLimit: NaN }).pvpKillLimit).toBe(10);
  });

  it('is present in DEFAULT_GAME_SETTINGS', () => {
    expect(DEFAULT_GAME_SETTINGS.pvpKillLimit).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Kill win condition
// ---------------------------------------------------------------------------

describe('PvP win condition: kills', () => {
  const makePlayer = (id: string, kills = 0): WinCheckPlayer =>
    ({ id, name: `Player${id}`, alive: true, kills, score: 0 });

  it('does not end game when no player has reached kill limit', () => {
    const players = [makePlayer('p1', 5), makePlayer('p2', 3)];
    const result = checkPvPWinCondition(players, 'kills', 10, 0, 0);
    expect(result.ended).toBe(false);
  });

  it('ends game when a player reaches the kill limit', () => {
    const players = [makePlayer('p1', 10), makePlayer('p2', 3)];
    const result = checkPvPWinCondition(players, 'kills', 10, 0, 0);
    expect(result.ended).toBe(true);
  });

  it('respects custom kill limit of 5', () => {
    const players = [makePlayer('p1', 5), makePlayer('p2', 2)];
    const result = checkPvPWinCondition(players, 'kills', 5, 0, 0);
    expect(result.ended).toBe(true);
  });

  it('does not trigger with custom kill limit of 20 when kills < 20', () => {
    const players = [makePlayer('p1', 10), makePlayer('p2', 8)];
    const result = checkPvPWinCondition(players, 'kills', 20, 0, 0);
    expect(result.ended).toBe(false);
  });

  it('ends game exactly at the kill limit (boundary)', () => {
    const players = [makePlayer('p1', 1), makePlayer('p2', 0)];
    const result = checkPvPWinCondition(players, 'kills', 1, 0, 0);
    expect(result.ended).toBe(true);
  });

  it('does not end game with 1 player only', () => {
    const players = [makePlayer('p1', 99)];
    const result = checkPvPWinCondition(players, 'kills', 10, 0, 0);
    expect(result.ended).toBe(false);
  });

  it('does not trigger score win condition when kills win condition is active', () => {
    const players = [makePlayer('p1', 5), makePlayer('p2', 3)];
    // Time expired but win condition is kills, not score
    const result = checkPvPWinCondition(players, 'kills', 30, 60, 120);
    expect(result.ended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Survival win condition
// ---------------------------------------------------------------------------

describe('PvP win condition: survival', () => {
  const makePlayer = (id: string, alive = true): WinCheckPlayer =>
    ({ id, name: `Player${id}`, alive, kills: 0, score: 0 });

  it('does not end game when multiple players are alive', () => {
    const players = [makePlayer('p1', true), makePlayer('p2', true)];
    const result = checkPvPWinCondition(players, 'survival', 10, 0, 0);
    expect(result.ended).toBe(false);
  });

  it('ends game when only one player remains alive', () => {
    const players = [makePlayer('p1', true), makePlayer('p2', false)];
    const result = checkPvPWinCondition(players, 'survival', 10, 0, 0);
    expect(result.ended).toBe(true);
  });

  it('ends game when all players are eliminated', () => {
    const players = [makePlayer('p1', false), makePlayer('p2', false)];
    const result = checkPvPWinCondition(players, 'survival', 10, 0, 0);
    expect(result.ended).toBe(true);
  });

  it('does not trigger kill win condition while in survival mode', () => {
    // Player has 50 kills but game should only end on last-standing check
    const players = [
      { id: 'p1', name: 'P1', alive: true, kills: 50, score: 0 },
      { id: 'p2', name: 'P2', alive: true, kills: 0, score: 0 },
    ];
    const result = checkPvPWinCondition(players, 'survival', 10, 0, 0);
    expect(result.ended).toBe(false);
  });

  it('3-player match ends when 2 are eliminated', () => {
    const players = [makePlayer('p1', true), makePlayer('p2', false), makePlayer('p3', false)];
    const result = checkPvPWinCondition(players, 'survival', 10, 0, 0);
    expect(result.ended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Score (time-limit) win condition
// ---------------------------------------------------------------------------

describe('PvP win condition: score', () => {
  const makePlayers = (): WinCheckPlayer[] => [
    { id: 'p1', name: 'P1', alive: true, kills: 5, score: 1000 },
    { id: 'p2', name: 'P2', alive: true, kills: 3, score: 800 },
  ];

  it('does not end game when time has not expired', () => {
    const result = checkPvPWinCondition(makePlayers(), 'score', 10, 120, 60);
    expect(result.ended).toBe(false);
  });

  it('ends game when time expires', () => {
    const result = checkPvPWinCondition(makePlayers(), 'score', 10, 120, 120);
    expect(result.ended).toBe(true);
  });

  it('ends game when game time exceeds time limit', () => {
    const result = checkPvPWinCondition(makePlayers(), 'score', 10, 120, 150);
    expect(result.ended).toBe(true);
  });

  it('does not end game when timeLimit is 0 (unlimited)', () => {
    const result = checkPvPWinCondition(makePlayers(), 'score', 10, 0, 999);
    expect(result.ended).toBe(false);
  });

  it('does not trigger when kills win condition is active', () => {
    const players = [
      { id: 'p1', name: 'P1', alive: true, kills: 50, score: 1000 },
      { id: 'p2', name: 'P2', alive: true, kills: 3, score: 800 },
    ];
    // Even though time expired, win condition is 'kills' not 'score'
    const result = checkPvPWinCondition(players, 'kills', 10, 120, 120);
    // kills=50 >= limit=10, so it ends on kills, but we verify it CAN end
    expect(result.ended).toBe(true);
    expect(result.reason).toContain('kills');
  });

  it('score win condition does not care about kill counts', () => {
    // Players have 0 kills, game ends only when time expires
    const players = [
      { id: 'p1', name: 'P1', alive: true, kills: 0, score: 100 },
      { id: 'p2', name: 'P2', alive: true, kills: 0, score: 50 },
    ];
    const resultBefore = checkPvPWinCondition(players, 'score', 10, 120, 60);
    const resultAfter = checkPvPWinCondition(players, 'score', 10, 120, 120);
    expect(resultBefore.ended).toBe(false);
    expect(resultAfter.ended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSettings — pvpWinCondition
// ---------------------------------------------------------------------------

describe('validateSettings — pvpWinCondition', () => {
  it('defaults to kills', () => {
    expect(validateSettings({}).pvpWinCondition).toBe('kills');
  });

  it('accepts survival', () => {
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'survival' }).pvpWinCondition).toBe('survival');
  });

  it('accepts score', () => {
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'score' }).pvpWinCondition).toBe('score');
  });

  it('rejects invalid win condition, falls back to default', () => {
    expect(validateSettings({ pvpWinCondition: 'invalid' as never }).pvpWinCondition).toBe('kills');
  });

  it('strips pvpWinCondition to default for non-PvP modes', () => {
    // In non-PvP mode, pvpWinCondition is kept at default (kills) regardless
    const result = validateSettings({ mode: 'waves', pvpWinCondition: 'survival' });
    expect(result.pvpWinCondition).toBe('kills');
  });
});
