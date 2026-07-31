/**
 * Unit tests for server stop protection — per-player activity tracking (s44r22-08).
 *
 * The real isProtectedFromStop() lives in GameRoom.ts and depends on Colyseus + schema,
 * so these tests replicate the core logic in isolation to verify correctness.
 *
 * Logic under test:
 * - A player is "active" if they moved, rotated, OR shot within the last 60s
 * - If ANY player is active → protected = true
 * - If ALL players inactive for ≥ 60s → protected = false
 * - Empty room → protected = false
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the constants from GameRoom.ts
// ---------------------------------------------------------------------------

const STOP_PROTECTION_WINDOW_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Replicate the core isProtectedFromStop() logic in isolation
// ---------------------------------------------------------------------------

interface PlayerActivity {
  name: string;
  lastMoveTime: number;
  lastRotateTime: number;
  lastShotTime: number;
}

function isProtectedFromStop(
  players: Map<string, PlayerActivity>,
  now: number
): { protected: boolean; reason?: string } {
  if (players.size === 0) {
    return { protected: false };
  }

  for (const [, activity] of players) {
    const lastActive = Math.max(
      activity.lastMoveTime,
      activity.lastRotateTime,
      activity.lastShotTime
    );
    if (now - lastActive < STOP_PROTECTION_WINDOW_MS) {
      const secsAgo = Math.floor((now - lastActive) / 1000);
      return {
        protected: true,
        reason: `Player "${activity.name}" was active ${secsAgo}s ago (limit: ${STOP_PROTECTION_WINDOW_MS / 1000}s)`,
      };
    }
  }

  return { protected: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isProtectedFromStop', () => {
  const NOW = 1_000_000; // arbitrary fixed timestamp (ms)
  const ACTIVE = NOW - 30_000;      // 30s ago (within window)
  const INACTIVE = NOW - 65_000;    // 65s ago (outside window)
  const LONG_INACTIVE = NOW - 120_000; // 120s ago (well outside window)

  describe('empty room', () => {
    it('returns not protected when no players', () => {
      const result = isProtectedFromStop(new Map(), NOW);
      expect(result.protected).toBe(false);
    });
  });

  describe('single player', () => {
    it('protects when player moved recently', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Alice', lastMoveTime: ACTIVE, lastRotateTime: INACTIVE, lastShotTime: INACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(true);
      expect(result.reason).toContain('Alice');
    });

    it('protects when player rotated recently', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Bob', lastMoveTime: INACTIVE, lastRotateTime: ACTIVE, lastShotTime: INACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(true);
    });

    it('protects when player shot recently', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Carol', lastMoveTime: INACTIVE, lastRotateTime: INACTIVE, lastShotTime: ACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(true);
    });

    it('does NOT protect when player has been idle for 65s', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Dave', lastMoveTime: INACTIVE, lastRotateTime: INACTIVE, lastShotTime: INACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(false);
    });

    it('does NOT protect when player has never been active (timestamps = 0)', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Eve', lastMoveTime: 0, lastRotateTime: 0, lastShotTime: 0 }],
      ]);
      // 0 is treated as epoch (long time ago)
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(false);
    });

    it('protects when activity was exactly at the boundary minus 1ms', () => {
      const justInsideWindow = NOW - (STOP_PROTECTION_WINDOW_MS - 1);
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Frank', lastMoveTime: justInsideWindow, lastRotateTime: 0, lastShotTime: 0 }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(true);
    });

    it('does NOT protect when activity was exactly at the boundary', () => {
      const atBoundary = NOW - STOP_PROTECTION_WINDOW_MS;
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Grace', lastMoveTime: atBoundary, lastRotateTime: 0, lastShotTime: 0 }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(false);
    });
  });

  describe('multiple players', () => {
    it('protects if ANY player is active (even if others are inactive)', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Inactive', lastMoveTime: INACTIVE, lastRotateTime: INACTIVE, lastShotTime: INACTIVE }],
        ['p2', { name: 'Active', lastMoveTime: ACTIVE, lastRotateTime: INACTIVE, lastShotTime: INACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(true);
      expect(result.reason).toContain('Active');
    });

    it('does NOT protect when ALL players are inactive', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Player1', lastMoveTime: INACTIVE, lastRotateTime: INACTIVE, lastShotTime: INACTIVE }],
        ['p2', { name: 'Player2', lastMoveTime: LONG_INACTIVE, lastRotateTime: LONG_INACTIVE, lastShotTime: LONG_INACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(false);
    });

    it('protects when first player is active and second is inactive', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Active', lastMoveTime: ACTIVE, lastRotateTime: 0, lastShotTime: 0 }],
        ['p2', { name: 'Inactive', lastMoveTime: INACTIVE, lastRotateTime: INACTIVE, lastShotTime: INACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(true);
    });
  });

  describe('reason string', () => {
    it('includes player name and seconds elapsed', () => {
      const lastActive = NOW - 25_000; // 25s ago
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'TestPlayer', lastMoveTime: lastActive, lastRotateTime: 0, lastShotTime: 0 }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.protected).toBe(true);
      expect(result.reason).toContain('TestPlayer');
      expect(result.reason).toContain('25s ago');
      expect(result.reason).toContain('60s');
    });

    it('reason is undefined when not protected', () => {
      const players = new Map<string, PlayerActivity>([
        ['p1', { name: 'Idle', lastMoveTime: INACTIVE, lastRotateTime: INACTIVE, lastShotTime: INACTIVE }],
      ]);
      const result = isProtectedFromStop(players, NOW);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('tracking logic (simulated handleInput)', () => {
    let lastMoveTime: Map<string, number>;
    let lastRotateTime: Map<string, number>;
    let lastShotTime: Map<string, number>;
    let lastAimAngle: Map<string, number>;
    let playerShooting: Map<string, boolean>;

    function simulateInput(
      sessionId: string,
      input: { moveX: number; moveY: number; aimAngle: number; shooting: boolean },
      timestamp: number
    ) {
      if (input.moveX !== 0 || input.moveY !== 0) {
        lastMoveTime.set(sessionId, timestamp);
      }
      const prevAim = lastAimAngle.get(sessionId);
      if (prevAim === undefined || prevAim !== input.aimAngle) {
        lastRotateTime.set(sessionId, timestamp);
        lastAimAngle.set(sessionId, input.aimAngle);
      }
      if (input.shooting) {
        lastShotTime.set(sessionId, timestamp);
      }
      playerShooting.set(sessionId, input.shooting);
    }

    beforeEach(() => {
      lastMoveTime = new Map();
      lastRotateTime = new Map();
      lastShotTime = new Map();
      lastAimAngle = new Map();
      playerShooting = new Map();
    });

    it('records move time when moveX != 0', () => {
      simulateInput('p1', { moveX: 1, moveY: 0, aimAngle: 0, shooting: false }, 5000);
      expect(lastMoveTime.get('p1')).toBe(5000);
    });

    it('records move time when moveY != 0', () => {
      simulateInput('p1', { moveX: 0, moveY: -0.5, aimAngle: 0, shooting: false }, 6000);
      expect(lastMoveTime.get('p1')).toBe(6000);
    });

    it('does NOT record move when both are 0 (idle thumbstick)', () => {
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 0, shooting: false }, 7000);
      expect(lastMoveTime.get('p1')).toBeUndefined();
    });

    it('records rotate time on first input (no prior aimAngle)', () => {
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 1.5, shooting: false }, 8000);
      expect(lastRotateTime.get('p1')).toBe(8000);
    });

    it('records rotate time when aimAngle changes', () => {
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 0.0, shooting: false }, 8000);
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 1.5, shooting: false }, 9000);
      expect(lastRotateTime.get('p1')).toBe(9000);
    });

    it('does NOT update rotate time when aimAngle unchanged', () => {
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 1.5, shooting: false }, 8000);
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 1.5, shooting: false }, 9000);
      expect(lastRotateTime.get('p1')).toBe(8000); // stays at 8000
    });

    it('records shot time when shooting=true', () => {
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 0, shooting: true }, 10000);
      expect(lastShotTime.get('p1')).toBe(10000);
      expect(playerShooting.get('p1')).toBe(true);
    });

    it('does NOT record shot time when shooting=false', () => {
      simulateInput('p1', { moveX: 0, moveY: 0, aimAngle: 0, shooting: false }, 10000);
      expect(lastShotTime.get('p1')).toBeUndefined();
      expect(playerShooting.get('p1')).toBe(false);
    });
  });
});
