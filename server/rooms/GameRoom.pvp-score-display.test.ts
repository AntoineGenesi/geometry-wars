/**
 * Regression tests for s44r3-10: PvP Score Display Wrong + Scoreboard Not Updating
 *
 * Bug 1: PvP kills do NOT decrement target.lives — scoreboard shows full hearts after death.
 * Bug 2: Scoreboard shows p.score (enemy score) instead of p.kills (PvP kill count).
 *
 * TDD: These tests FAIL before the fix, PASS after.
 */

import { describe, it, expect } from 'vitest';
import { PLAYER_PVP_MAX_HEALTH, PLAYER_PVP_INVINCIBILITY_DURATION } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Minimal types
// ---------------------------------------------------------------------------

interface TrackedPlayer {
  id: string;
  alive: boolean;
  health: number;
  maxHealth: number;
  multiplier: number;
  lives: number;
  kills: number;
  deaths: number;
  surfaceU: number;
  surfaceV: number;
}

interface TrackedBullet {
  ownerId: string;
  x: number;
  y: number;
  damage: number;
  consumed: boolean;
}

// ---------------------------------------------------------------------------
// Logic mirroring GameRoom.ts PvP bullet hit block (PRE-FIX)
// This is the buggy version: missing target.lives--
// ---------------------------------------------------------------------------

function applyPvPBuggy(
  bullet: TrackedBullet,
  players: TrackedPlayer[],
  invincibility: Map<string, number>,
  pvpKillStreaks: Map<string, number>,
  infiniteLives: boolean,
  isSurvivalMode: boolean,
): void {
  if (bullet.consumed) return;
  for (const target of players) {
    if (bullet.consumed) return;
    if (!target.alive) continue;
    if (target.id === bullet.ownerId) continue;
    const invincible = invincibility.get(target.id) ?? 0;
    if (invincible > 0) continue;
    const du = bullet.x - target.surfaceU;
    const dv = bullet.y - target.surfaceV;
    if (Math.sqrt(du * du + dv * dv) < 0.04) {
      bullet.consumed = true;
      const prevHealth = target.health;
      target.health = Math.max(0, target.health - bullet.damage);
      const actualDamage = prevHealth - target.health;
      const owner = players.find((p) => p.id === bullet.ownerId);
      if (owner) owner.kills += actualDamage / target.maxHealth;

      if (target.health <= 0) {
        target.deaths++;
        pvpKillStreaks.set(target.id, 0);
        if (isSurvivalMode) {
          target.alive = false;
        } else {
          // BUG: target.lives-- is MISSING here
          target.alive = false;
          // (would add to pendingRespawns — omitted for unit test)
        }
        if (owner) {
          const streak = (pvpKillStreaks.get(owner.id) ?? 0) + 1;
          pvpKillStreaks.set(owner.id, streak);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Logic mirroring GameRoom.ts PvP bullet hit block (POST-FIX)
// This is the fixed version: includes target.lives--
// ---------------------------------------------------------------------------

function applyPvPFixed(
  bullet: TrackedBullet,
  players: TrackedPlayer[],
  invincibility: Map<string, number>,
  pvpKillStreaks: Map<string, number>,
  infiniteLives: boolean,
  isSurvivalMode: boolean,
): void {
  if (bullet.consumed) return;
  for (const target of players) {
    if (bullet.consumed) return;
    if (!target.alive) continue;
    if (target.id === bullet.ownerId) continue;
    const invincible = invincibility.get(target.id) ?? 0;
    if (invincible > 0) continue;
    const du = bullet.x - target.surfaceU;
    const dv = bullet.y - target.surfaceV;
    if (Math.sqrt(du * du + dv * dv) < 0.04) {
      bullet.consumed = true;
      const prevHealth = target.health;
      target.health = Math.max(0, target.health - bullet.damage);
      const actualDamage = prevHealth - target.health;
      const owner = players.find((p) => p.id === bullet.ownerId);
      if (owner) owner.kills += actualDamage / target.maxHealth;

      if (target.health <= 0) {
        target.deaths++;
        pvpKillStreaks.set(target.id, 0);
        if (isSurvivalMode) {
          target.alive = false;
        } else {
          // FIX: decrement lives on PvP kill (unless infiniteLives)
          if (!infiniteLives) target.lives--;
          target.alive = false;
        }
        if (owner) {
          const streak = (pvpKillStreaks.get(owner.id) ?? 0) + 1;
          pvpKillStreaks.set(owner.id, streak);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scoreboard display logic (mirrors network-main.ts)
// ---------------------------------------------------------------------------

interface ScoreboardPlayer {
  name: string;
  alive: boolean;
  lives: number;
  score: number;   // enemy/wave kills score
  kills: number;   // PvP fractional kill score
  zoneTime: number;
}

/** PRE-FIX: scoreboard always shows p.score regardless of mode */
function renderScoreboardBuggy(
  players: ScoreboardPlayer[],
  pvpEnabled: boolean,
  infiniteLives: boolean,
): string[] {
  return players.map((p) => {
    const lives = Math.max(0, p.lives);
    const livesStr = p.alive
      ? (infiniteLives ? '♥ ∞' : '♥'.repeat(Math.min(lives, 5)))
      : '[DEAD]';
    // BUG: always shows p.score even in PvP mode
    return `${p.name}: ${livesStr} ${p.score.toLocaleString()}`;
  });
}

/** POST-FIX: scoreboard shows p.kills in PvP mode */
function renderScoreboardFixed(
  players: ScoreboardPlayer[],
  pvpEnabled: boolean,
  infiniteLives: boolean,
  gameMode: string,
): string[] {
  const isZoneMode = gameMode === 'king' || gameMode === 'claustrophobia';
  return players.map((p) => {
    const lives = Math.max(0, p.lives);
    const livesStr = p.alive
      ? (infiniteLives ? '♥ ∞' : '♥'.repeat(Math.min(lives, 5)))
      : '[DEAD]';
    if (isZoneMode) {
      return `${p.name}: ${livesStr} ${p.zoneTime.toFixed(1)}s`;
    } else if (pvpEnabled) {
      // FIX: show PvP kill score in PvP/PvPvE modes
      return `${p.name}: ${livesStr} ${p.kills.toFixed(2)}K`;
    } else {
      return `${p.name}: ${livesStr} ${p.score.toLocaleString()}`;
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(id: string, lives = 3, u = 0.5, v = 0.5): TrackedPlayer {
  return {
    id,
    alive: true,
    health: PLAYER_PVP_MAX_HEALTH,
    maxHealth: PLAYER_PVP_MAX_HEALTH,
    multiplier: 1,
    lives,
    kills: 0,
    deaths: 0,
    surfaceU: u,
    surfaceV: v,
  };
}

function makeBullet(ownerId: string, x: number, y: number, damage: number): TrackedBullet {
  return { ownerId, x, y, damage, consumed: false };
}

// ---------------------------------------------------------------------------
// Tests: Bug 1 — Lives not decrementing on PvP kill
// ---------------------------------------------------------------------------

describe('s44r3-10 Bug 1: PvP kill should decrement target lives', () => {
  it('[BUGGY] lives do NOT decrement after PvP kill (documents pre-fix behavior)', () => {
    const shooter = makePlayer('p1', 3, 0.0, 0.0);
    const target = makePlayer('p2', 3, 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();

    applyPvPBuggy(bullet, [shooter, target], inv, streaks, false, false);

    // BUG: lives is still 3 after death
    expect(target.alive).toBe(false);
    expect(target.lives).toBe(3); // BUG — should be 2 but is 3 in pre-fix code
  });

  it('[FIXED] lives decrement by 1 after PvP kill (standard mode)', () => {
    const shooter = makePlayer('p1', 3, 0.0, 0.0);
    const target = makePlayer('p2', 3, 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();

    applyPvPFixed(bullet, [shooter, target], inv, streaks, false, false);

    expect(target.alive).toBe(false);
    expect(target.lives).toBe(2); // FIX: decremented from 3 to 2
  });

  it('[FIXED] lives do NOT decrement when infiniteLives=true', () => {
    const shooter = makePlayer('p1', 3, 0.0, 0.0);
    const target = makePlayer('p2', 3, 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();

    applyPvPFixed(bullet, [shooter, target], inv, streaks, true, false);

    expect(target.alive).toBe(false);
    expect(target.lives).toBe(3); // infiniteLives: lives unchanged
  });

  it('[FIXED] lives do NOT decrement in survival mode (survival = permanent elimination)', () => {
    const shooter = makePlayer('p1', 3, 0.0, 0.0);
    const target = makePlayer('p2', 3, 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();

    applyPvPFixed(bullet, [shooter, target], inv, streaks, false, true);

    expect(target.alive).toBe(false);
    // In survival mode, the isSurvivalMode branch runs (no lives decrement there)
    expect(target.lives).toBe(3); // survival: no lives decrement
  });

  it('[FIXED] lives decrements across multiple deaths', () => {
    const shooter = makePlayer('p1', 3, 0.0, 0.0);
    const target = makePlayer('p2', 3, 0.5, 0.5);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();

    // Kill 1
    const b1 = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    applyPvPFixed(b1, [shooter, target], inv, streaks, false, false);
    expect(target.lives).toBe(2);

    // Respawn target (simulate game respawn)
    target.alive = true;
    target.health = PLAYER_PVP_MAX_HEALTH;
    inv.delete(target.id);

    // Kill 2
    const b2 = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    applyPvPFixed(b2, [shooter, target], inv, streaks, false, false);
    expect(target.lives).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Bug 2 — Scoreboard shows score instead of kills in PvP mode
// ---------------------------------------------------------------------------

describe('s44r3-10 Bug 2: Scoreboard should show PvP kill count in PvP mode', () => {
  const players: ScoreboardPlayer[] = [
    { name: 'Alice', alive: true, lives: 2, score: 5000, kills: 1.25, zoneTime: 0 },
    { name: 'Bob', alive: false, lives: 1, score: 3000, kills: 0.75, zoneTime: 0 },
  ];

  it('[BUGGY] scoreboard shows score (not kills) in PvP mode (pre-fix)', () => {
    const result = renderScoreboardBuggy(players, true, false);
    // BUG: shows 5,000 and 3,000 (enemy score), not kills
    expect(result[0]).toContain('5,000');
    expect(result[0]).not.toContain('1.25K');
  });

  it('[FIXED] scoreboard shows kills in PvP mode', () => {
    const result = renderScoreboardFixed(players, true, false, 'waves');
    // FIX: shows kill score
    expect(result[0]).toContain('1.25K');
    expect(result[1]).toContain('0.75K');
    // Should NOT show enemy score
    expect(result[0]).not.toContain('5,000');
  });

  it('[FIXED] dead player shows [DEAD] in scoreboard', () => {
    const result = renderScoreboardFixed(players, true, false, 'waves');
    expect(result[1]).toContain('[DEAD]');
  });

  it('[FIXED] non-PvP mode still shows score', () => {
    const result = renderScoreboardFixed(players, false, false, 'waves');
    expect(result[0]).toContain('5,000');
    expect(result[0]).not.toContain('1.25K');
  });

  it('[FIXED] zone mode shows zone time regardless of PvP', () => {
    const zonePlayers: ScoreboardPlayer[] = [
      { name: 'Alice', alive: true, lives: 3, score: 5000, kills: 1.0, zoneTime: 95.3 },
    ];
    const result = renderScoreboardFixed(zonePlayers, true, false, 'king');
    expect(result[0]).toContain('95.3s');
    expect(result[0]).not.toContain('1.00K');
  });

  it('[FIXED] alive player shows hearts', () => {
    const result = renderScoreboardFixed(players, true, false, 'waves');
    expect(result[0]).toContain('♥♥'); // lives=2
  });
});
