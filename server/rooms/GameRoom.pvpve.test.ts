/**
 * Integration tests for PvPvE mode: friendly fire toggle + kill tracking (s44j-pvpve-14e).
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 * Logic mirrors GameRoom's PvPvE collision handling exactly.
 */

import { describe, it, expect } from 'vitest';
import {
  PLAYER_PVP_MAX_HEALTH,
  PLAYER_PVP_INVINCIBILITY_DURATION,
  ENEMY_HEALTH,
} from '../shared/GameConstants';
import { validateSettings } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Minimal types mirroring the server-side structures
// ---------------------------------------------------------------------------

interface PvPvEPlayer {
  id: string;
  name: string;
  alive: boolean;
  health: number;
  maxHealth: number;
  surfaceU: number;
  surfaceV: number;
  kills: number;       // PvP kills
  playerKills: number; // enemy kills
  deaths: number;
}

interface Bullet {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  damage: number;
  consumed: boolean;
}

interface Enemy {
  id: string;
  type: string;
  alive: boolean;
  health: number;
  surfaceU: number;
  surfaceV: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(id: string, u = 0.5, v = 0.5): PvPvEPlayer {
  return {
    id,
    name: `Player${id}`,
    alive: true,
    health: PLAYER_PVP_MAX_HEALTH,
    maxHealth: PLAYER_PVP_MAX_HEALTH,
    surfaceU: u,
    surfaceV: v,
    kills: 0,
    playerKills: 0,
    deaths: 0,
  };
}

function makeBullet(ownerId: string, x: number, y: number, damage = 10): Bullet {
  return { id: `b-${ownerId}-${x}-${y}`, ownerId, x, y, damage, consumed: false };
}

function makeEnemy(id: string, type: string, u = 0.5, v = 0.5): Enemy {
  return {
    id,
    type,
    alive: true,
    health: ENEMY_HEALTH[type] ?? 2,
    surfaceU: u,
    surfaceV: v,
  };
}

// ---------------------------------------------------------------------------
// Extracted logic (mirrors GameRoom's pvpve blocks)
// ---------------------------------------------------------------------------

const HIT_RADIUS = 0.04;

/**
 * Apply bullet damage to a player (friendly fire gate).
 * mode === 'pvpve' with friendlyFire=false → blocks player-to-player damage.
 * Mirrors the pvpEnabled && allowPlayerDamage block in GameRoom.ts.
 */
function applyPlayerBulletToPlayer(
  bullet: Bullet,
  players: PvPvEPlayer[],
  invincibility: Map<string, number>,
  pvpEnabled: boolean,
  mode: string,
  friendlyFire: boolean,
): void {
  const allowPlayerDamage = mode !== 'pvpve' || friendlyFire;
  if (!pvpEnabled || !allowPlayerDamage) return;
  if (bullet.consumed) return;

  for (const target of players) {
    if (bullet.consumed) break;
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
    }
  }
}

/**
 * Apply enemy touch damage to a player.
 * Enemy damage is NEVER gated by friendlyFire — always applies in PvPvE.
 */
function applyEnemyToPlayer(enemy: Enemy, player: PvPvEPlayer, damage: number): void {
  if (!enemy.alive || !player.alive) return;
  player.health = Math.max(0, player.health - damage);
}

/**
 * Apply bullet damage to an enemy (player kills enemy).
 * Mirrors bullet-enemy collision in GameRoom.ts.
 */
function applyBulletToEnemy(bullet: Bullet, enemy: Enemy, shooter: PvPvEPlayer): void {
  if (bullet.consumed || !enemy.alive) return;

  const du = bullet.x - enemy.surfaceU;
  const dv = bullet.y - enemy.surfaceV;
  const dist = Math.sqrt(du * du + dv * dv);

  if (dist < HIT_RADIUS) {
    bullet.consumed = true;
    enemy.health = Math.max(0, enemy.health - bullet.damage);
    if (enemy.health <= 0) {
      enemy.alive = false;
      shooter.playerKills++;
    }
  }
}

/**
 * Simplified version of GameRoom.computeDifficultyLevel() + generateServerWave() base count.
 * Mirrors the base-count formula for wave escalation tests.
 */
function computeBaseWaveCount(waveNumber: number, playerCount = 1): number {
  const waveContrib = Math.max(0, (waveNumber - 1) * 0.3);
  const playerCountBonus = (playerCount - 1) * 0.3;
  const difficultyLevel = waveContrib + playerCountBonus;
  const difficultyCountBonus = Math.floor(difficultyLevel * 2.0);
  const baseCountCap = difficultyLevel >= 6 ? 40 : 30;
  return Math.min(
    baseCountCap,
    4 + Math.floor(Math.sqrt(waveNumber) * 2) + difficultyCountBonus,
  );
}

// ---------------------------------------------------------------------------
// Tests: Friendly fire gate
// ---------------------------------------------------------------------------

describe('PvPvE — friendly fire gate', () => {
  it('blocks player-to-player damage when friendlyFire=false in pvpve mode', () => {
    const shooter = makePlayer('p1', 0.1, 0.1);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5);
    const inv = new Map<string, number>();

    applyPlayerBulletToPlayer(bullet, [shooter, target], inv, true, 'pvpve', false);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH); // no damage
    expect(bullet.consumed).toBe(false);
  });

  it('allows player-to-player damage when friendlyFire=true in pvpve mode', () => {
    const shooter = makePlayer('p1', 0.1, 0.1);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPlayerBulletToPlayer(bullet, [shooter, target], inv, true, 'pvpve', true);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH - 25);
    expect(bullet.consumed).toBe(true);
  });

  it('always allows player damage in pure pvp mode regardless of friendlyFire flag', () => {
    const shooter = makePlayer('p1', 0.1, 0.1);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 30);
    const inv = new Map<string, number>();

    // friendlyFire=false but mode='pvp' → damage still applies (pure PvP is always on)
    applyPlayerBulletToPlayer(bullet, [shooter, target], inv, true, 'pvp', false);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH - 30);
    expect(bullet.consumed).toBe(true);
  });

  it('does not apply damage to the shooter themselves', () => {
    const shooter = makePlayer('p1', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 50);
    const inv = new Map<string, number>();

    applyPlayerBulletToPlayer(bullet, [shooter], inv, true, 'pvpve', true);

    expect(shooter.health).toBe(PLAYER_PVP_MAX_HEALTH); // no self damage
    expect(bullet.consumed).toBe(false);
  });

  it('invincibility prevents damage even when friendlyFire=true', () => {
    const shooter = makePlayer('p1', 0.1, 0.1);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>([['p2', PLAYER_PVP_INVINCIBILITY_DURATION]]);

    applyPlayerBulletToPlayer(bullet, [shooter, target], inv, true, 'pvpve', true);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH); // protected by invincibility
    expect(bullet.consumed).toBe(false);
  });

  it('blocks all player damage when pvpEnabled=false', () => {
    const shooter = makePlayer('p1', 0.1, 0.1);
    const target = makePlayer('p2', 0.5, 0.5);
    const bullet = makeBullet('p1', 0.5, 0.5, 25);
    const inv = new Map<string, number>();

    applyPlayerBulletToPlayer(bullet, [shooter, target], inv, false, 'pvpve', true);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH);
    expect(bullet.consumed).toBe(false);
  });

  it('bullet beyond hit radius does not damage target', () => {
    const shooter = makePlayer('p1', 0.1, 0.1);
    const target = makePlayer('p2', 0.5, 0.5);
    // Bullet far from target
    const bullet = makeBullet('p1', 0.1, 0.1, 20);
    const inv = new Map<string, number>();

    applyPlayerBulletToPlayer(bullet, [shooter, target], inv, true, 'pvpve', true);

    expect(target.health).toBe(PLAYER_PVP_MAX_HEALTH);
    expect(bullet.consumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Enemy damage (unaffected by friendlyFire)
// ---------------------------------------------------------------------------

describe('PvPvE — enemy damage to players (unaffected by friendlyFire)', () => {
  it('enemies always damage players regardless of friendlyFire', () => {
    const player = makePlayer('p1', 0.3, 0.3);
    const enemy = makeEnemy('e1', 'grunt', 0.3, 0.3);

    applyEnemyToPlayer(enemy, player, 1);

    expect(player.health).toBe(PLAYER_PVP_MAX_HEALTH - 1);
  });

  it('dead enemies cannot damage players', () => {
    const player = makePlayer('p1', 0.5, 0.5);
    const enemy = makeEnemy('e1', 'grunt', 0.5, 0.5);
    enemy.alive = false;

    applyEnemyToPlayer(enemy, player, 1);

    expect(player.health).toBe(PLAYER_PVP_MAX_HEALTH);
  });

  it('multiple enemies can damage multiple players', () => {
    const p1 = makePlayer('p1', 0.3, 0.3);
    const p2 = makePlayer('p2', 0.7, 0.7);
    const e1 = makeEnemy('e1', 'grunt', 0.3, 0.3);
    const e2 = makeEnemy('e2', 'grunt', 0.7, 0.7);

    applyEnemyToPlayer(e1, p1, 1);
    applyEnemyToPlayer(e2, p2, 1);

    expect(p1.health).toBe(PLAYER_PVP_MAX_HEALTH - 1);
    expect(p2.health).toBe(PLAYER_PVP_MAX_HEALTH - 1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Kill leaderboard tracks both kill types
// ---------------------------------------------------------------------------

describe('PvPvE — kill leaderboard tracks both kill types', () => {
  it('enemy kills (playerKills) increment when player kills an enemy', () => {
    const shooter = makePlayer('p1', 0.1, 0.1);
    const enemy = makeEnemy('e1', 'grunt', 0.5, 0.5);

    // Grunt has 2 HP; standard bullet does 1 damage
    const b1 = makeBullet('p1', 0.5, 0.5, 1.0);
    const b2 = makeBullet('p1', 0.5, 0.5, 1.0);

    applyBulletToEnemy(b1, enemy, shooter);
    expect(enemy.alive).toBe(true);
    expect(shooter.playerKills).toBe(0);

    applyBulletToEnemy(b2, enemy, shooter);
    expect(enemy.alive).toBe(false);
    expect(shooter.playerKills).toBe(1); // enemy kill tracked
    expect(shooter.kills).toBe(0);       // no PvP kills
  });

  it('player kills (kills) track PvP kills independently from enemy kills', () => {
    const shooter = makePlayer('p1');
    const target = makePlayer('p2', 0.5, 0.5);

    // Simulate PvP kill (mirrors GameRoom pvp_kill block)
    target.health = 0;
    shooter.kills++;
    target.deaths++;

    expect(shooter.kills).toBe(1);
    expect(shooter.playerKills).toBe(0);
    expect(target.deaths).toBe(1);
  });

  it('combined total = enemy kills + PvP kills', () => {
    const player = makePlayer('p1');
    player.playerKills = 5;  // 5 enemy kills
    player.kills = 2;         // 2 PvP kills

    expect(player.kills + player.playerKills).toBe(7);
  });

  it('leaderboard ranked by combined kill total', () => {
    const players = [
      { id: 'p1', name: 'Alice', kills: 2, playerKills: 5 },  // total 7
      { id: 'p2', name: 'Bob',   kills: 1, playerKills: 8 },  // total 9
      { id: 'p3', name: 'Carol', kills: 3, playerKills: 3 },  // total 6
    ];

    const ranked = [...players]
      .sort((a, b) => (b.kills + b.playerKills) - (a.kills + a.playerKills));

    expect(ranked[0].name).toBe('Bob');   // 9 total
    expect(ranked[1].name).toBe('Alice'); // 7 total
    expect(ranked[2].name).toBe('Carol'); // 6 total
  });
});

// ---------------------------------------------------------------------------
// Tests: Wave escalation
// ---------------------------------------------------------------------------

describe('PvPvE — enemy wave escalation', () => {
  it('wave 1 spawns a minimum enemy count', () => {
    const count = computeBaseWaveCount(1);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it('wave count increases with wave number', () => {
    const wave1 = computeBaseWaveCount(1);
    const wave5 = computeBaseWaveCount(5);
    const wave10 = computeBaseWaveCount(10);

    expect(wave5).toBeGreaterThan(wave1);
    expect(wave10).toBeGreaterThan(wave5);
  });

  it('wave count is bounded by the cap in early waves', () => {
    const wave8 = computeBaseWaveCount(8);
    expect(wave8).toBeLessThanOrEqual(30);
  });

  it('more players scale up wave difficulty', () => {
    const count1 = computeBaseWaveCount(5, 1);
    const count3 = computeBaseWaveCount(5, 3);
    expect(count3).toBeGreaterThanOrEqual(count1);
  });
});

// ---------------------------------------------------------------------------
// Tests: validateSettings friendly fire defaults
// ---------------------------------------------------------------------------

describe('PvPvE — validateSettings friendlyFire defaults', () => {
  it('friendlyFire defaults to false in pvpve mode', () => {
    const settings = validateSettings({ mode: 'pvpve' });
    expect(settings.friendlyFire).toBe(false);
  });

  it('friendlyFire can be explicitly enabled in pvpve mode', () => {
    const settings = validateSettings({ mode: 'pvpve', friendlyFire: true });
    expect(settings.friendlyFire).toBe(true);
  });

  it('friendlyFire is false for non-pvp modes', () => {
    const settings = validateSettings({ mode: 'waves' });
    expect(settings.friendlyFire).toBe(false);
  });

  it('friendlyFire forced to false for non-pvp modes even if set to true', () => {
    const settings = validateSettings({ mode: 'waves', friendlyFire: true });
    expect(settings.friendlyFire).toBe(false);
  });

  it('pvpEnabled is automatically true for pvpve mode', () => {
    const settings = validateSettings({ mode: 'pvpve' });
    expect(settings.pvpEnabled).toBe(true);
  });

  it('mode is preserved as pvpve', () => {
    const settings = validateSettings({ mode: 'pvpve' });
    expect(settings.mode).toBe('pvpve');
  });
});

// ---------------------------------------------------------------------------
// Tests: Full PvPvE match flow simulation
// ---------------------------------------------------------------------------

describe('PvPvE — full match flow simulation', () => {
  it('enemies damage both players; players cannot damage each other when friendlyFire=false', () => {
    const p1 = makePlayer('p1', 0.3, 0.3);
    const p2 = makePlayer('p2', 0.7, 0.7);
    const enemy = makeEnemy('e1', 'grunt', 0.3, 0.3);
    const inv = new Map<string, number>();

    // Enemy damages p1 (always applies)
    applyEnemyToPlayer(enemy, p1, 1);
    expect(p1.health).toBe(PLAYER_PVP_MAX_HEALTH - 1);

    // p1 tries to shoot p2 — blocked by friendlyFire=false
    const friendlyBullet = makeBullet('p1', 0.7, 0.7, 20);
    applyPlayerBulletToPlayer(friendlyBullet, [p1, p2], inv, true, 'pvpve', false);
    expect(p2.health).toBe(PLAYER_PVP_MAX_HEALTH); // no friendly fire damage

    // p2 kills the enemy
    const attackBullet = makeBullet('p2', 0.3, 0.3, ENEMY_HEALTH.grunt);
    applyBulletToEnemy(attackBullet, enemy, p2);
    expect(enemy.alive).toBe(false);
    expect(p2.playerKills).toBe(1);

    // Leaderboard state: p1 = 0 kills, p2 = 1 enemy kill
    expect(p1.kills + p1.playerKills).toBe(0);
    expect(p2.kills + p2.playerKills).toBe(1);
  });

  it('both enemies and players take damage when friendlyFire=true', () => {
    const p1 = makePlayer('p1', 0.3, 0.3);
    const p2 = makePlayer('p2', 0.7, 0.7);
    const enemy = makeEnemy('e1', 'grunt', 0.3, 0.3);
    const inv = new Map<string, number>();

    // Enemy damages p1
    applyEnemyToPlayer(enemy, p1, 1);
    expect(p1.health).toBe(PLAYER_PVP_MAX_HEALTH - 1);

    // p1 shoots p2 — friendlyFire=true allows it
    const pvpBullet = makeBullet('p1', 0.7, 0.7, 20);
    applyPlayerBulletToPlayer(pvpBullet, [p1, p2], inv, true, 'pvpve', true);
    expect(p2.health).toBe(PLAYER_PVP_MAX_HEALTH - 20);
    expect(pvpBullet.consumed).toBe(true);
  });

  it('wave escalation: wave 5 spawns more enemies than wave 1', () => {
    const wave1 = computeBaseWaveCount(1, 2);
    const wave5 = computeBaseWaveCount(5, 2);
    expect(wave5).toBeGreaterThan(wave1);
  });
});
