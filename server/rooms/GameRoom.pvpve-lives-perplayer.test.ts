/**
 * Regression test for s44k-05: PvPvE lives shared bug.
 *
 * Bug: In PvPvE mode, the checkGameOver() function used a "last player standing"
 * condition (aliveCount <= 1 && players.size > 1) borrowed from pure PvP mode.
 * This ended the match as soon as ONE player ran out of lives, even though other
 * players still had lives remaining — making lives appear "shared" (one player
 * dying ended the round for everyone).
 *
 * Fix: Removed the "last player standing" check from PvPvE checkGameOver().
 * PvPvE now only ends the match when ALL players are eliminated or time runs out.
 * Each player fights independently; losing all lives makes you a spectator, not
 * an event that terminates other players' sessions.
 *
 * These tests simulate the checkGameOver() logic in isolation (pure JS, no Colyseus).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal types mirroring GameRoom state
// ---------------------------------------------------------------------------

interface Player {
  id: string;
  alive: boolean;
  lives: number;
}

interface GameConfig {
  gameMode: string;
  timeLimit: number;
  gameTime: number;
  players: Player[];
}

// ---------------------------------------------------------------------------
// Replicate the fixed checkGameOver logic for PvPvE
// ---------------------------------------------------------------------------

/**
 * Returns true if the game should end (transition to voting).
 * Mirrors the fixed GameRoom.checkGameOver() PvPvE block.
 */
function checkGameOverPvPvE(config: GameConfig): { over: boolean; reason: string } {
  if (config.gameMode !== 'pvpve') return { over: false, reason: 'not pvpve' };

  // Time limit
  if (config.timeLimit > 0 && config.gameTime >= config.timeLimit) {
    return { over: true, reason: 'time limit' };
  }

  // All Dead (the only elimination condition in the fixed code)
  if (config.players.length > 0) {
    const aliveCount = config.players.filter(p => p.alive).length;
    if (aliveCount === 0) {
      return { over: true, reason: 'all eliminated' };
    }
    // NOTE: No "last player standing" check — this was the bug.
    // With the fix, the last surviving player continues playing until eliminated.
  }

  return { over: false, reason: '' };
}

/**
 * Documents the BUGGY behavior for regression reference.
 * The buggy code had: if (aliveCount <= 1 && players.size > 1) → game over.
 */
function checkGameOverPvPvEBuggy(config: GameConfig): { over: boolean; reason: string } {
  if (config.gameMode !== 'pvpve') return { over: false, reason: 'not pvpve' };

  if (config.timeLimit > 0 && config.gameTime >= config.timeLimit) {
    return { over: true, reason: 'time limit' };
  }

  if (config.players.length > 0) {
    const aliveCount = config.players.filter(p => p.alive).length;
    if (aliveCount === 0) {
      return { over: true, reason: 'all eliminated' };
    }
    // BUG: This ends the game when one player is eliminated, even if another still has lives
    if (aliveCount <= 1 && config.players.length > 1) {
      return { over: true, reason: 'last player standing' };
    }
  }

  return { over: false, reason: '' };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makePlayer(id: string, alive: boolean, lives: number): Player {
  return { id, alive, lives };
}

// ---------------------------------------------------------------------------
// Tests: Per-player lives — the fix (s44k-05)
// ---------------------------------------------------------------------------

describe('PvPvE per-player lives: fixed behavior (s44k-05)', () => {
  it('2-player game: player A runs out of lives — game does NOT end (player B continues)', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 10,
      players: [
        makePlayer('p1', false, 0), // Player A: dead (out of lives)
        makePlayer('p2', true, 2),  // Player B: still alive with 2 lives
      ],
    };

    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(false); // Game continues — player B has lives
  });

  it('3-player game: 2 players eliminated — last player continues', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 30,
      players: [
        makePlayer('p1', false, 0), // eliminated
        makePlayer('p2', false, 0), // eliminated
        makePlayer('p3', true, 1),  // still alive — should continue
      ],
    };

    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(false); // Game continues — p3 has 1 life
  });

  it('game ends when ALL players are eliminated', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 50,
      players: [
        makePlayer('p1', false, 0), // eliminated
        makePlayer('p2', false, 0), // eliminated
      ],
    };

    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(true);
    expect(result.reason).toBe('all eliminated');
  });

  it('game ends when time limit is reached', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 120,
      gameTime: 120,
      players: [
        makePlayer('p1', true, 2),
        makePlayer('p2', true, 1),
      ],
    };

    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(true);
    expect(result.reason).toBe('time limit');
  });

  it('game does not end when time limit not yet reached', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 120,
      gameTime: 60,
      players: [
        makePlayer('p1', true, 2),
        makePlayer('p2', true, 1),
      ],
    };

    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(false);
  });

  it('solo player: game ends when they die (aliveCount === 0)', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 20,
      players: [makePlayer('p1', false, 0)],
    };

    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(true);
    expect(result.reason).toBe('all eliminated');
  });

  it('game continues while both players are alive', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 15,
      players: [
        makePlayer('p1', true, 3),
        makePlayer('p2', true, 3),
      ],
    };

    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(false);
  });

  it('lives are decremented independently per player (p1 loses life, p2 unchanged)', () => {
    // Simulate lives decrements — this mirrors GameRoom's enemy collision logic
    const initialLives = 3;
    const p1 = { id: 'p1', alive: true, lives: initialLives };
    const p2 = { id: 'p2', alive: true, lives: initialLives };

    // p1 hit by enemy
    p1.lives--;
    if (p1.lives <= 0) p1.alive = false;

    expect(p1.lives).toBe(2); // p1 lost 1 life
    expect(p2.lives).toBe(3); // p2 unchanged — lives are NOT shared
    expect(p1.alive).toBe(true);
    expect(p2.alive).toBe(true);
  });

  it('p1 out of lives: p1 spectator, p2 continues — game does not end', () => {
    const p1 = { id: 'p1', alive: true, lives: 1 };
    const p2 = { id: 'p2', alive: true, lives: 3 };

    // p1 takes final hit from enemy
    p1.lives--;
    if (p1.lives <= 0) p1.alive = false;

    expect(p1.lives).toBe(0);
    expect(p1.alive).toBe(false); // p1 is spectator
    expect(p2.lives).toBe(3);     // p2's lives unaffected
    expect(p2.alive).toBe(true);

    // Now check game over — game should NOT end because p2 is still alive
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 30,
      players: [p1, p2],
    };
    const result = checkGameOverPvPvE(config);
    expect(result.over).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Document the BUGGY behavior for regression awareness
// ---------------------------------------------------------------------------

describe('PvPvE per-player lives: BUGGY behavior (pre-s44k-05 fix, documents the bug)', () => {
  it('BUGGY: 2-player game, p1 dies — game incorrectly ends even though p2 has lives', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 10,
      players: [
        makePlayer('p1', false, 0), // Player A: dead
        makePlayer('p2', true, 2),  // Player B: alive with 2 lives
      ],
    };

    // With the buggy code, aliveCount=1, players.size=2 → "last player standing" → game over
    const result = checkGameOverPvPvEBuggy(config);
    expect(result.over).toBe(true);           // BUG: game ends
    expect(result.reason).toBe('last player standing'); // even though p2 has lives
  });

  it('FIXED: same scenario with the fix — game correctly continues', () => {
    const config: GameConfig = {
      gameMode: 'pvpve',
      timeLimit: 0,
      gameTime: 10,
      players: [
        makePlayer('p1', false, 0),
        makePlayer('p2', true, 2),
      ],
    };

    const fixed = checkGameOverPvPvE(config);
    expect(fixed.over).toBe(false); // CORRECT: player B continues
  });
});
