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
