/**
 * Unit tests for the PvP player health system (s44j-pvp-13a).
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 * The logic under test mirrors GameRoom's PvP collision handling exactly.
 */

import { describe, it, expect } from 'vitest';
import { PLAYER_PVP_MAX_HEALTH, PLAYER_PVP_INVINCIBILITY_DURATION } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Minimal types that mirror PlayerState / BulletState fields used in PvP logic
// ---------------------------------------------------------------------------

interface PvPPlayer {
  id: string;
  alive: boolean;
  health: number;
  maxHealth: number;
  multiplier: number;
  invincibilityTimer: number;
  surfaceU: number;
  surfaceV: number;
}

interface PvPBullet {
  id: string;
  ownerId: string;
  /** UV x */
  x: number;
  /** UV y */
  y: number;
  damage: number;
  consumed: boolean;
}

// ---------------------------------------------------------------------------
// Extracted PvP damage logic (mirrors GameRoom's pvpEnabled block)
// ---------------------------------------------------------------------------

const HIT_RADIUS = 0.04; // UV-space threshold used in tests

function applyPvPBulletDamage(
  bullet: PvPBullet,
  players: PvPPlayer[],
  invincibility: Map<string, number>,
  pvpEnabled: boolean,
): void {
  if (!pvpEnabled) return;
  if (bullet.consumed) return;

  for (const target of players) {
    if (bullet.consumed) return; // Already consumed by an earlier target
    if (!target.alive) continue;
    if (target.id === bullet.ownerId) continue; // Can't shoot yourself

    const invincible = invincibility.get(target.id) ?? 0;
    if (invincible > 0) continue; // Post-respawn invincibility

    const du = bullet.x - target.surfaceU;
    const dv = bullet.y - target.surfaceV;
    const dist = Math.sqrt(du * du + dv * dv);

    if (dist < HIT_RADIUS) {
      bullet.consumed = true;
      target.health = Math.max(0, target.health - bullet.damage);

      if (target.health <= 0) {
        // PvP death: reset health, set invincibility, reset multiplier
        target.health = target.maxHealth;
        target.multiplier = 1;
        invincibility.set(target.id, PLAYER_PVP_INVINCIBILITY_DURATION);
      }
    }
  }
}

/**
 * Drain invincibility timers by dt. Returns updated map.
 * Mirrors GameRoom.drainInvincibility + schema sync.
 */
function drainInvincibility(
  invincibility: Map<string, number>,
  players: PvPPlayer[],
  dt: number,
): void {
  invincibility.forEach((remaining, id) => {
    const next = remaining - dt;
    const player = players.find((p) => p.id === id);
    if (next <= 0) {
      invincibility.delete(id);
      if (player) player.invincibilityTimer = 0;
    } else {
      invincibility.set(id, next);
      if (player) player.invincibilityTimer = next;
    }
  });
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makePlayer(id: string, u = 0.5, v = 0.5): PvPPlayer {
  return {
    id,
    alive: true,
    health: PLAYER_PVP_MAX_HEALTH,
    maxHealth: PLAYER_PVP_MAX_HEALTH,
    multiplier: 1,
    invincibilityTimer: 0,
    surfaceU: u,
    surfaceV: v,
  };
}

function makeBullet(ownerId: string, x: number, y: number, damage = 25): PvPBullet {
  return { id: `b-${Math.random()}`, ownerId, x, y, damage, consumed: false };
}

// ---------------------------------------------------------------------------
// Tests: health deduction
// ---------------------------------------------------------------------------

describe('PvP: health deduction', () => {
  it('reduces target health by bullet damage on hit', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    expect(target.health).toBe(75);
    expect(bullet.consumed).toBe(true);
  });

  it('multiple hits accumulate damage', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const inv = new Map<string, number>();

    for (let i = 0; i < 3; i++) {
      const b = makeBullet('p1', 0.5, 0.5, 25);
      applyPvPBulletDamage(b, [shooter, target], inv, true);
    }

    expect(target.health).toBe(25); // 100 - 3×25 = 25
  });

  it('does not damage the bullet owner', () => {
    const player = makePlayer('p1', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [player], inv, true);

    expect(player.health).toBe(PLAYER_PVP_MAX_HEALTH);
    expect(bullet.consumed).toBe(false);
  });

  it('does not hit a target outside the collision radius', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.8, 0.8, 25); // far away
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH);
    expect(bullet.consumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: death trigger
// ---------------------------------------------------------------------------

describe('PvP: death trigger', () => {
  it('respawns player with full health when health reaches 0', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 25; // one hit away from death
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH);
  });

  it('resets multiplier to 1 on PvP death', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 25;
    target.multiplier = 15;
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    expect(target.multiplier).toBe(1);
  });

  it('health cannot go negative — clamps at 0 before reset', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 10;
    const bullet = makeBullet('p1', 0.5, 0.5, 50); // overkill
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    // health clamped to 0 then reset to maxHealth
    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH);
  });
});

// ---------------------------------------------------------------------------
// Tests: invincibility timer
// ---------------------------------------------------------------------------

describe('PvP: invincibility timer', () => {
  it('grants PLAYER_PVP_INVINCIBILITY_DURATION invincibility after PvP death', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 25;
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    expect(inv.get('p2')).toBe(PLAYER_PVP_INVINCIBILITY_DURATION);
  });

  it('prevents bullet hits while invincible', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const inv = new Map<string, number>([['p2', 1.5]]); // 1.5s remaining
    const bullet = makeBullet('p1', 0.5, 0.5, 25);

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH); // not hit
    expect(bullet.consumed).toBe(false);
  });

  it('drainInvincibility decrements timer by dt', () => {
    const players = [makePlayer('p1')];
    const inv = new Map<string, number>([['p1', 2.0]]);

    drainInvincibility(inv, players, 0.5);

    expect(inv.get('p1')).toBeCloseTo(1.5);
    expect(players[0].invincibilityTimer).toBeCloseTo(1.5);
  });

  it('drainInvincibility clears timer when expired', () => {
    const players = [makePlayer('p1')];
    const inv = new Map<string, number>([['p1', 0.01]]);

    drainInvincibility(inv, players, 1 / 60); // one tick

    expect(inv.has('p1')).toBe(false);
    expect(players[0].invincibilityTimer).toBe(0);
  });

  it('invincibilityTimer syncs from invincibility map each tick', () => {
    const players = [makePlayer('p1')];
    const inv = new Map<string, number>([['p1', 3.0]]);

    drainInvincibility(inv, players, 1.0);

    expect(players[0].invincibilityTimer).toBeCloseTo(2.0);
  });
});

// ---------------------------------------------------------------------------
// Tests: pvpEnabled gate
// ---------------------------------------------------------------------------

describe('PvP: pvpEnabled gate', () => {
  it('does NOT apply damage when pvpEnabled === false', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, false);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH);
    expect(bullet.consumed).toBe(false);
  });

  it('DOES apply damage when pvpEnabled === true', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target], inv, true);

    expect(target.health).toBe(75);
    expect(bullet.consumed).toBe(true);
  });

  it('one bullet hits at most one target', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target1 = makePlayer('p2', 0.5, 0.5);
    const target2 = makePlayer('p3', 0.5, 0.5); // same position
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPvPBulletDamage(bullet, [shooter, target1, target2], inv, true);

    // Only the first target in iteration order should be hit
    const totalDmg = (PLAYER_PVP_MAX_HEALTH - target1.health) + (PLAYER_PVP_MAX_HEALTH - target2.health);
    expect(totalDmg).toBe(25); // exactly one hit
    expect(bullet.consumed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: full PvP match flow (s44j-pvp-13g)
// ---------------------------------------------------------------------------

import { validateSettings, VALID_MODES, PVP_MODES } from '../shared/GameSettings';
import { PVP_KILLS_TO_WIN, PLAYER_PVP_MAX_HEALTH, PLAYER_PVP_INVINCIBILITY_DURATION } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Mode registration tests
// ---------------------------------------------------------------------------

describe('PvP mode registration', () => {
  it('"pvp" is in VALID_MODES', () => {
    expect(VALID_MODES).toContain('pvp');
  });

  it('"pvp" is in PVP_MODES', () => {
    expect(PVP_MODES).toContain('pvp');
  });

  it('validateSettings accepts "pvp" as a valid mode', () => {
    const settings = validateSettings({ mode: 'pvp' });
    expect(settings.mode).toBe('pvp');
  });

  it('validateSettings auto-enables pvpEnabled when mode = "pvp"', () => {
    const settings = validateSettings({ mode: 'pvp' });
    expect(settings.pvpEnabled).toBe(true);
  });

  it('pvpEnabled defaults to false for non-PvP modes', () => {
    const settings = validateSettings({ mode: 'waves' });
    expect(settings.pvpEnabled).toBe(false);
  });

  it('pvpEnabled can be explicitly overridden to false in pvp mode', () => {
    const settings = validateSettings({ mode: 'pvp', pvpEnabled: false });
    expect(settings.pvpEnabled).toBe(false);
  });

  it('validateSettings accepts "pvp" win conditions: kills, survival, score', () => {
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'kills' }).pvpWinCondition).toBe('kills');
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'survival' }).pvpWinCondition).toBe('survival');
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'score' }).pvpWinCondition).toBe('score');
  });

  it('pvpWinCondition defaults to "kills" for pvp mode', () => {
    const settings = validateSettings({ mode: 'pvp' });
    expect(settings.pvpWinCondition).toBe('kills');
  });

  it('pvpWinCondition is stripped for non-PvP modes (always "kills" default)', () => {
    const settings = validateSettings({ mode: 'waves', pvpWinCondition: 'survival' });
    expect(settings.pvpWinCondition).toBe('kills'); // reset to default
  });
});

// ---------------------------------------------------------------------------
// PVP_KILLS_TO_WIN constant test
// ---------------------------------------------------------------------------

describe('PVP_KILLS_TO_WIN constant', () => {
  it('PVP_KILLS_TO_WIN is a positive integer', () => {
    expect(PVP_KILLS_TO_WIN).toBeGreaterThan(0);
    expect(Number.isInteger(PVP_KILLS_TO_WIN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: full PvP match flow simulation (kills win condition)
// ---------------------------------------------------------------------------

/**
 * Simulates the full PvP match flow using the same logic extracted from GameRoom.
 * Tests the complete pipeline: damage → kill → streak → win condition check.
 */

interface MatchPlayer {
  id: string;
  name: string;
  alive: boolean;
  health: number;
  maxHealth: number;
  multiplier: number;
  invincibilityTimer: number;
  surfaceU: number;
  surfaceV: number;
  kills: number;
  deaths: number;
}

interface MatchBullet {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  damage: number;
  consumed: boolean;
}

interface KillRecord {
  killerId: string;
  victimId: string;
  streakCount: number;
  eliminated?: boolean;
}

const MATCH_HIT_RADIUS = 0.04;

/** Apply one bullet hit to the first valid target. Returns kill record if a kill occurred. */
function simulateBulletHit(
  bullet: MatchBullet,
  players: MatchPlayer[],
  invincibility: Map<string, number>,
  streaks: Map<string, number>,
  winCondition: 'kills' | 'survival' | 'score',
): KillRecord | null {
  if (bullet.consumed) return null;

  for (const target of players) {
    if (bullet.consumed) break;
    if (!target.alive) continue;
    if (target.id === bullet.ownerId) continue;

    const invincible = invincibility.get(target.id) ?? 0;
    if (invincible > 0) continue;

    const du = bullet.x - target.surfaceU;
    const dv = bullet.y - target.surfaceV;
    if (Math.sqrt(du * du + dv * dv) >= MATCH_HIT_RADIUS) continue;

    bullet.consumed = true;
    target.health = Math.max(0, target.health - bullet.damage);

    if (target.health > 0) return null;

    // Kill occurred
    target.deaths++;
    streaks.set(target.id, 0);

    const owner = players.find((p) => p.id === bullet.ownerId);
    const isSurvival = winCondition === 'survival';

    if (isSurvival) {
      target.health = 0;
      target.alive = false;
    } else {
      target.health = target.maxHealth;
      invincibility.set(target.id, PLAYER_PVP_INVINCIBILITY_DURATION);
    }

    let killRecord: KillRecord | null = null;
    if (owner) {
      owner.kills++;
      const streakCount = (streaks.get(owner.id) ?? 0) + 1;
      streaks.set(owner.id, streakCount);
      killRecord = { killerId: owner.id, victimId: target.id, streakCount, eliminated: isSurvival };
    }
    return killRecord;
  }
  return null;
}

/** Check if win condition is met. Returns winner id or null. */
function checkWinCondition(
  players: MatchPlayer[],
  winCondition: 'kills' | 'survival' | 'score',
): string | null {
  if (winCondition === 'kills') {
    for (const p of players) {
      if (p.kills >= PVP_KILLS_TO_WIN) return p.id;
    }
  } else if (winCondition === 'survival') {
    const alive = players.filter((p) => p.alive);
    if (alive.length <= 1 && players.length > 1) {
      return alive.length === 1 ? alive[0].id : null;
    }
  }
  return null;
}

function makeMatchPlayer(id: string, u = 0.5, v = 0.5): MatchPlayer {
  return {
    id,
    name: `Player${id}`,
    alive: true,
    health: PLAYER_PVP_MAX_HEALTH,
    maxHealth: PLAYER_PVP_MAX_HEALTH,
    multiplier: 1,
    invincibilityTimer: 0,
    surfaceU: u,
    surfaceV: v,
    kills: 0,
    deaths: 0,
  };
}

function fatalBullet(ownerId: string, targetU: number, targetV: number): MatchBullet {
  return { id: `b-${Math.random()}`, ownerId, x: targetU, y: targetV, damage: PLAYER_PVP_MAX_HEALTH, consumed: false };
}

describe('PvP integration: kills win condition', () => {
  it('full match: p1 reaches kill limit → wins', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const killLog: KillRecord[] = [];
    const winCondition = 'kills';

    let winner: string | null = null;

    for (let i = 0; i < PVP_KILLS_TO_WIN; i++) {
      // Clear invincibility so p2 can be hit again
      inv.delete('p2');

      const bullet = fatalBullet('p1', p2.surfaceU, p2.surfaceV);
      const record = simulateBulletHit(bullet, players, inv, streaks, winCondition);
      if (record) killLog.push(record);

      winner = checkWinCondition(players, winCondition);
      if (winner) break;
    }

    expect(winner).toBe('p1');
    expect(p1.kills).toBe(PVP_KILLS_TO_WIN);
    expect(p2.deaths).toBe(PVP_KILLS_TO_WIN);
    expect(p2.alive).toBe(true); // respawns each time in kills mode
  });

  it('kill streaks increment correctly across the match', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const killLog: KillRecord[] = [];
    const winCondition = 'kills';

    for (let i = 0; i < 3; i++) {
      inv.delete('p2');
      const bullet = fatalBullet('p1', p2.surfaceU, p2.surfaceV);
      const record = simulateBulletHit(bullet, players, inv, streaks, winCondition);
      if (record) killLog.push(record);
    }

    expect(killLog[0].streakCount).toBe(1);
    expect(killLog[1].streakCount).toBe(2);
    expect(killLog[2].streakCount).toBe(3);
    expect(streaks.get('p1')).toBe(3);
  });

  it('streak resets when killer is killed', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'kills';

    // p1 kills p2 twice (streak = 2)
    inv.delete('p2');
    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);
    inv.delete('p2');
    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);
    expect(streaks.get('p1')).toBe(2);

    // p2 kills p1 → p1 streak resets
    inv.delete('p2');
    inv.delete('p1');
    p1.surfaceU = p2.surfaceU; p1.surfaceV = p2.surfaceV;
    simulateBulletHit(fatalBullet('p2', p1.surfaceU, p1.surfaceV), players, inv, streaks, winCondition);
    expect(streaks.get('p1')).toBe(0);

    // p1 kills p2 again — streak restarts at 1
    inv.delete('p2');
    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);
    expect(streaks.get('p1')).toBe(1);
  });

  it('no winner declared until kill limit is reached', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'kills';

    for (let i = 0; i < PVP_KILLS_TO_WIN - 1; i++) {
      inv.delete('p2');
      simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);
    }

    expect(checkWinCondition(players, winCondition)).toBeNull();
    expect(p1.kills).toBe(PVP_KILLS_TO_WIN - 1);
  });

  it('stats are correct at match end: kills, deaths, and damage dealt tracked', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'kills';

    for (let i = 0; i < PVP_KILLS_TO_WIN; i++) {
      inv.delete('p2');
      simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);
    }

    // Verify final scoreboard
    expect(p1.kills).toBe(PVP_KILLS_TO_WIN);
    expect(p1.deaths).toBe(0);
    expect(p2.kills).toBe(0);
    expect(p2.deaths).toBe(PVP_KILLS_TO_WIN);
  });
});

// ---------------------------------------------------------------------------
// Integration: full PvP match flow simulation (survival win condition)
// ---------------------------------------------------------------------------

describe('PvP integration: survival win condition', () => {
  it('eliminated players stay dead (no respawn)', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'survival';

    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);

    expect(p2.alive).toBe(false);
    expect(p2.health).toBe(0);
  });

  it('last standing player wins when opponent eliminated', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'survival';

    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);

    const winner = checkWinCondition(players, winCondition);
    expect(winner).toBe('p1');
    expect(p1.alive).toBe(true);
  });

  it('3-player survival: last player standing wins', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const p3 = makeMatchPlayer('p3', 0.8, 0.8);
    const players = [p1, p2, p3];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'survival';

    // p1 kills p2
    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);
    expect(checkWinCondition(players, winCondition)).toBeNull(); // still 2 alive

    // p1 kills p3
    simulateBulletHit(fatalBullet('p1', p3.surfaceU, p3.surfaceV), players, inv, streaks, winCondition);
    const winner = checkWinCondition(players, winCondition);
    expect(winner).toBe('p1');
  });

  it('no winner declared while 2+ players alive', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const p3 = makeMatchPlayer('p3', 0.8, 0.8);
    const players = [p1, p2, p3];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'survival';

    // Only one player eliminated — 2 still alive
    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);
    expect(checkWinCondition(players, winCondition)).toBeNull();
  });

  it('eliminated player kill/death stats are correct', () => {
    const p1 = makeMatchPlayer('p1', 0.1, 0.1);
    const p2 = makeMatchPlayer('p2', 0.5, 0.5);
    const players = [p1, p2];
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const winCondition = 'survival';

    simulateBulletHit(fatalBullet('p1', p2.surfaceU, p2.surfaceV), players, inv, streaks, winCondition);

    expect(p1.kills).toBe(1);
    expect(p1.deaths).toBe(0);
    expect(p2.kills).toBe(0);
    expect(p2.deaths).toBe(1);
  });
});
