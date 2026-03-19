/**
 * Tests for GameRoom reconnection and name-blocking logic.
 *
 * These tests exercise the pure logic (name checks, state save/restore conditions)
 * in isolation, without spinning up a real Colyseus room.
 *
 * The actual implementation in GameRoom.ts mirrors these helper functions exactly.
 */
import { describe, it, expect } from 'vitest';

// ── Replicate the name-checking logic from onJoin ───────────────────────────

interface MockPlayerState {
  id: string; name: string; score: number; lives: number; multiplier: number;
  health: number; maxHealth: number; color: number;
}

interface DisconnectedRecord {
  score: number; lives: number;
  cleanupTimer: ReturnType<typeof setTimeout>;
}

function checkNameConflict(
  rawName: string,
  activePlayers: Map<string, MockPlayerState>,
  disconnectedPlayers: Map<string, DisconnectedRecord>,
): 'reconnect' | 'conflict' | 'ok' {
  const normalized = rawName.toLowerCase();
  // Disconnected check first — reconnect takes priority over conflict
  if (disconnectedPlayers.has(normalized)) return 'reconnect';
  let conflict = false;
  activePlayers.forEach((p) => { if (p.name.toLowerCase() === normalized) conflict = true; });
  if (conflict) return 'conflict';
  return 'ok';
}

// ── Replicate the state-saving condition from onLeave ───────────────────────

function shouldSaveDisconnectedState(
  player: MockPlayerState | undefined,
  consented: boolean,
  roomPhase: string,
): boolean {
  return !!(player && !consented && roomPhase === 'playing');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GameRoom name-blocking', () => {
  it('returns "ok" for fresh player with unique name', () => {
    const active = new Map<string, MockPlayerState>();
    const disc = new Map<string, DisconnectedRecord>();
    expect(checkNameConflict('Antoine', active, disc)).toBe('ok');
  });

  it('returns "conflict" when name matches active player (case insensitive)', () => {
    const active = new Map([
      ['session1', { id: 's1', name: 'Antoine', score: 0, lives: 3, multiplier: 1, health: 100, maxHealth: 100, color: 0 }],
    ]);
    const disc = new Map<string, DisconnectedRecord>();
    expect(checkNameConflict('antoine', active, disc)).toBe('conflict');
    expect(checkNameConflict('ANTOINE', active, disc)).toBe('conflict');
    expect(checkNameConflict('Antoine', active, disc)).toBe('conflict');
  });

  it('returns "ok" for a name that differs from active player', () => {
    const active = new Map([
      ['session1', { id: 's1', name: 'Antoine', score: 0, lives: 3, multiplier: 1, health: 100, maxHealth: 100, color: 0 }],
    ]);
    const disc = new Map<string, DisconnectedRecord>();
    expect(checkNameConflict('Bob', active, disc)).toBe('ok');
  });

  it('returns "reconnect" when name matches disconnected player (case insensitive)', () => {
    const active = new Map<string, MockPlayerState>();
    const disc = new Map([
      ['antoine', { score: 500, lives: 2, cleanupTimer: setTimeout(() => {}, 60000) }],
    ]);
    expect(checkNameConflict('Antoine', active, disc)).toBe('reconnect');
    expect(checkNameConflict('ANTOINE', active, disc)).toBe('reconnect');
    disc.forEach((r) => clearTimeout(r.cleanupTimer));
  });

  it('reconnect takes priority — disconnected check runs before conflict check', () => {
    // If somehow a name is in both maps, reconnect wins (defensive)
    const active = new Map([
      ['session1', { id: 's1', name: 'Antoine', score: 0, lives: 3, multiplier: 1, health: 100, maxHealth: 100, color: 0 }],
    ]);
    const disc = new Map([
      ['antoine', { score: 500, lives: 2, cleanupTimer: setTimeout(() => {}, 60000) }],
    ]);
    expect(checkNameConflict('Antoine', active, disc)).toBe('reconnect');
    disc.forEach((r) => clearTimeout(r.cleanupTimer));
  });
});

describe('GameRoom disconnected state saving', () => {
  it('saves state on unexpected disconnect during playing phase', () => {
    const player: MockPlayerState = { id: 's1', name: 'Antoine', score: 500, lives: 2, multiplier: 3, health: 80, maxHealth: 100, color: 0xff0000 };
    expect(shouldSaveDisconnectedState(player, false, 'playing')).toBe(true);
  });

  it('does NOT save state on consented leave (player chose to quit)', () => {
    const player: MockPlayerState = { id: 's1', name: 'Antoine', score: 500, lives: 2, multiplier: 3, health: 80, maxHealth: 100, color: 0xff0000 };
    expect(shouldSaveDisconnectedState(player, true, 'playing')).toBe(false);
  });

  it('does NOT save state during lobby phase', () => {
    const player: MockPlayerState = { id: 's1', name: 'Antoine', score: 500, lives: 2, multiplier: 3, health: 80, maxHealth: 100, color: 0xff0000 };
    expect(shouldSaveDisconnectedState(player, false, 'lobby')).toBe(false);
  });

  it('does NOT save state during voting phase', () => {
    const player: MockPlayerState = { id: 's1', name: 'Antoine', score: 500, lives: 2, multiplier: 3, health: 80, maxHealth: 100, color: 0xff0000 };
    expect(shouldSaveDisconnectedState(player, false, 'voting')).toBe(false);
  });

  it('does NOT save state when player is undefined (rejected join)', () => {
    expect(shouldSaveDisconnectedState(undefined, false, 'playing')).toBe(false);
  });
});
