/**
 * Unit tests for PvP kill/death tracking (s44j-pvp-13b).
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 * The logic mirrors GameRoom's PvP kill tracking exactly.
 */

import { describe, it, expect } from 'vitest';
import { PLAYER_PVP_MAX_HEALTH, PLAYER_PVP_INVINCIBILITY_DURATION } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Minimal types mirroring the fields used in PvP kill/death tracking
// ---------------------------------------------------------------------------

interface TrackedPlayer {
  id: string;
  alive: boolean;
  health: number;
  maxHealth: number;
  multiplier: number;
  invincibilityTimer: number;
  surfaceU: number;
  surfaceV: number;
  /** PvP kills — incremented on each kill */
  kills: number;
  /** PvP deaths — incremented on each death */
  deaths: number;
}

interface TrackedBullet {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  damage: number;
  consumed: boolean;
}

// ---------------------------------------------------------------------------
// Kill/death/streak logic extracted from GameRoom (mirrors the server block)
// ---------------------------------------------------------------------------

interface KillEvent {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  streakCount: number;
}

const HIT_RADIUS = 0.04;

/**
 * Apply PvP bullet damage with full kill/death/streak tracking.
 * Mirrors the GameRoom pvpEnabled block.
 */
function applyPvPWithTracking(
  bullet: TrackedBullet,
  players: TrackedPlayer[],
  invincibility: Map<string, number>,
  pvpKillStreaks: Map<string, number>,
  broadcastedEvents: KillEvent[],
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
    const dist = Math.sqrt(du * du + dv * dv);

    if (dist < HIT_RADIUS) {
      bullet.consumed = true;
      target.health = Math.max(0, target.health - bullet.damage);

      if (target.health <= 0) {
        // PvP kill: reset health, invincibility, multiplier
        target.health = target.maxHealth;
        target.multiplier = 1;

        // Track death on victim; reset their streak
        target.deaths++;
        pvpKillStreaks.set(target.id, 0);

        invincibility.set(target.id, PLAYER_PVP_INVINCIBILITY_DURATION);

        // Find owner and track their kill + streak
        const owner = players.find((p) => p.id === bullet.ownerId);
        if (owner) {
          owner.kills++;
          const streakCount = (pvpKillStreaks.get(owner.id) ?? 0) + 1;
          pvpKillStreaks.set(owner.id, streakCount);

          broadcastedEvents.push({
            killerId: owner.id,
            killerName: `Player${owner.id}`,
            victimId: target.id,
            victimName: `Player${target.id}`,
            streakCount,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(id: string, u = 0.5, v = 0.5): TrackedPlayer {
  return {
    id,
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

function makeBullet(ownerId: string, x: number, y: number, damage = 25): TrackedBullet {
  return { id: `b-${Math.random()}`, ownerId, x, y, damage, consumed: false };
}

/** Deliver one fatal hit to target from shooter */
function fatalHit(shooter: TrackedPlayer, target: TrackedPlayer): { bullet: TrackedBullet } {
  target.health = shooter.health; // set target low enough for one shot
  target.health = 1; // one damage away from death
  const bullet = makeBullet(shooter.id, target.surfaceU, target.surfaceV, PLAYER_PVP_MAX_HEALTH);
  return { bullet };
}

// ---------------------------------------------------------------------------
// Tests: kill/death increment
// ---------------------------------------------------------------------------

describe('PvP kill/death tracking: counters', () => {
  it('increments killer kills by 1 on each kill', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 25;
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    applyPvPWithTracking(bullet, [shooter, target], inv, streaks, events);

    expect(shooter.kills).toBe(1);
    expect(target.kills).toBe(0);
  });

  it('increments victim deaths by 1 on each death', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 25;
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    applyPvPWithTracking(bullet, [shooter, target], inv, streaks, events);

    expect(target.deaths).toBe(1);
    expect(shooter.deaths).toBe(0);
  });

  it('accumulates kills across multiple victims', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const t1 = makePlayer('p2', 0.5, 0.5);
    const t2 = makePlayer('p3', 0.2, 0.2);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    // Kill t1
    t1.health = 1;
    const b1 = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b1, [shooter, t1, t2], inv, streaks, events);

    // Kill t2 (invincibility for t1 resets — just use new positions)
    t2.health = 1;
    const b2 = makeBullet('p1', 0.2, 0.2, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b2, [shooter, t1, t2], inv, streaks, events);

    expect(shooter.kills).toBe(2);
  });

  it('does not increment kills when bullet does not kill', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 10); // partial damage
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    applyPvPWithTracking(bullet, [shooter, target], inv, streaks, events);

    expect(shooter.kills).toBe(0);
    expect(target.deaths).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: kill streak
// ---------------------------------------------------------------------------

describe('PvP kill/death tracking: kill streak', () => {
  it('kill streak starts at 1 on first kill', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 1;
    const bullet = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    applyPvPWithTracking(bullet, [shooter, target], inv, streaks, events);

    expect(streaks.get('p1')).toBe(1);
  });

  it('kill streak increments on consecutive kills', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const t1 = makePlayer('p2', 0.5, 0.5);
    const t2 = makePlayer('p3', 0.2, 0.2);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    // Kill 1
    t1.health = 1;
    const b1 = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b1, [shooter, t1, t2], inv, streaks, events);
    expect(streaks.get('p1')).toBe(1);

    // Kill 2
    t2.health = 1;
    const b2 = makeBullet('p1', 0.2, 0.2, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b2, [shooter, t1, t2], inv, streaks, events);
    expect(streaks.get('p1')).toBe(2);
  });

  it('kill streak resets to 0 when the killer is killed', () => {
    const p1 = makePlayer('p1', 0.0, 0.0);
    const p2 = makePlayer('p2', 0.5, 0.5);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    // p1 kills p2 twice (streak = 2)
    p2.health = 1;
    const b1 = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b1, [p1, p2], inv, streaks, events);
    // p2 respawns with full health; clear invincibility for test
    inv.delete('p2');

    p2.health = 1;
    const b2 = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b2, [p1, p2], inv, streaks, events);
    expect(streaks.get('p1')).toBe(2);

    // Now p2 kills p1 → p1's streak resets
    inv.delete('p2'); // clear invincibility
    p1.health = 1;
    p2.surfaceU = 0.0; p2.surfaceV = 0.0;
    const b3 = makeBullet('p2', 0.0, 0.0, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b3, [p1, p2], inv, streaks, events);

    expect(streaks.get('p1')).toBe(0);
  });

  it('victim streak resets to 0 on death even if they had kills', () => {
    const p1 = makePlayer('p1', 0.0, 0.0);
    const p2 = makePlayer('p2', 0.5, 0.5);
    const p3 = makePlayer('p3', 0.8, 0.8);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    // p2 kills p3 first (streak = 1)
    p3.health = 1;
    const b1 = makeBullet('p2', 0.8, 0.8, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b1, [p1, p2, p3], inv, streaks, events);
    expect(streaks.get('p2')).toBe(1);

    // Now p1 kills p2 → p2's streak resets
    inv.delete('p2');
    p2.health = 1;
    p1.surfaceU = 0.5; p1.surfaceV = 0.5;
    const b2 = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    applyPvPWithTracking(b2, [p1, p2, p3], inv, streaks, events);

    expect(streaks.get('p2')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: kill event broadcast
// ---------------------------------------------------------------------------

describe('PvP kill event broadcast', () => {
  it('broadcasts a kill event with correct killerId, victimId, and streakCount', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    target.health = 1;
    const bullet = makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    applyPvPWithTracking(bullet, [shooter, target], inv, streaks, events);

    expect(events).toHaveLength(1);
    expect(events[0].killerId).toBe('p1');
    expect(events[0].victimId).toBe('p2');
    expect(events[0].streakCount).toBe(1);
  });

  it('kill event streakCount reflects consecutive kills', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const t1 = makePlayer('p2', 0.5, 0.5);
    const t2 = makePlayer('p3', 0.2, 0.2);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    // First kill
    t1.health = 1;
    applyPvPWithTracking(makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH), [shooter, t1, t2], inv, streaks, events);

    // Second kill
    t2.health = 1;
    applyPvPWithTracking(makeBullet('p1', 0.2, 0.2, PLAYER_PVP_MAX_HEALTH), [shooter, t1, t2], inv, streaks, events);

    expect(events[0].streakCount).toBe(1);
    expect(events[1].streakCount).toBe(2);
  });

  it('streakCount resets to 1 after attacker is killed', () => {
    const p1 = makePlayer('p1', 0.0, 0.0);
    const p2 = makePlayer('p2', 0.5, 0.5);
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    // p1 kills p2 (streak 1)
    p2.health = 1;
    applyPvPWithTracking(makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH), [p1, p2], inv, streaks, events);

    // p2 kills p1 — p1 streak resets
    inv.delete('p2');
    p1.health = 1;
    p2.surfaceU = 0.0; p2.surfaceV = 0.0;
    applyPvPWithTracking(makeBullet('p2', 0.0, 0.0, PLAYER_PVP_MAX_HEALTH), [p1, p2], inv, streaks, events);

    // p1 kills p2 again — streak should restart at 1
    inv.delete('p1');
    p2.health = 1;
    p2.surfaceU = 0.5; p2.surfaceV = 0.5;
    p1.surfaceU = 0.0; p1.surfaceV = 0.0;
    applyPvPWithTracking(makeBullet('p1', 0.5, 0.5, PLAYER_PVP_MAX_HEALTH), [p1, p2], inv, streaks, events);

    // events[0]: p1 kills p2 streak=1
    // events[1]: p2 kills p1 streak=1
    // events[2]: p1 kills p2 again, should be streak=1 (reset after death)
    expect(events[2].streakCount).toBe(1);
  });

  it('no broadcast event fired for partial damage (non-lethal)', () => {
    const shooter = makePlayer('p1', 0.0, 0.0);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 10); // non-lethal
    const inv = new Map<string, number>();
    const streaks = new Map<string, number>();
    const events: KillEvent[] = [];

    applyPvPWithTracking(bullet, [shooter, target], inv, streaks, events);

    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: K/D ratio (client-side derived)
// ---------------------------------------------------------------------------

describe('K/D ratio calculation (client-side)', () => {
  /** Mirror of the client-side K/D formula */
  function calcKD(kills: number, deaths: number): number {
    return kills / Math.max(deaths, 1);
  }

  it('calculates K/D ratio correctly', () => {
    expect(calcKD(6, 2)).toBeCloseTo(3.0);
  });

  it('K/D = kills when deaths = 0 (avoids divide-by-zero via max(deaths,1))', () => {
    expect(calcKD(5, 0)).toBe(5.0);
  });

  it('K/D = 0 when no kills', () => {
    expect(calcKD(0, 3)).toBe(0);
  });

  it('K/D = 1 when kills equal deaths', () => {
    expect(calcKD(4, 4)).toBe(1.0);
  });

  it('K/D handles 0/0 gracefully (no kills, no deaths)', () => {
    expect(calcKD(0, 0)).toBe(0);
  });
});
