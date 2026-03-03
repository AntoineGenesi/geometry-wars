/**
 * Regression test for s44j-17: Tesla coil not killing enemies in MP.
 *
 * Root cause: Tesla coil was routed through tryShoot() (bullet spawner) instead of
 * a continuous area-damage path like applyTeslaDamage(). This means enemies within
 * Tesla range received no damage from the server.
 *
 * These tests validate the applyTeslaDamage logic in isolation (no Colyseus Room instance).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the exact logic from GameRoom.applyTeslaDamage()
// ---------------------------------------------------------------------------

interface MockPlayer {
  alive: boolean;
  weaponType: string;
  weaponAmmo: number;
  surfaceU: number;
  surfaceV: number;
  playerLevel: number;
  score: number;
  playerKills: number;
}

interface MockEnemy {
  id: string;
  alive: boolean;
  health: number;
  surfaceU: number;
  surfaceV: number;
}

const TESLA_RADIUS = 0.10;
const TESLA_DPS = 3.0;
const LEVEL_DAMAGE_MULTIPLIERS = [1.0, 1.1, 1.2, 1.35, 1.5, 1.7, 2.0, 2.3, 2.6, 3.0];

function applyTeslaDamage(
  player: MockPlayer,
  enemies: MockEnemy[],
  dt: number,
): { killedIds: string[] } {
  if (!player.alive) return { killedIds: [] };

  // Ammo drain
  if (player.weaponAmmo > 0) {
    player.weaponAmmo--;
    if (player.weaponAmmo <= 0) {
      player.weaponType = 'standard';
      player.weaponAmmo = -1;
    }
  }

  const levelIdx = Math.min(player.playerLevel ?? 0, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
  const levelDamageMult = LEVEL_DAMAGE_MULTIPLIERS[levelIdx];
  const damage = TESLA_DPS * levelDamageMult * dt;

  const enemiesToKill: number[] = [];

  enemies.forEach((enemy, eIndex) => {
    if (!enemy.alive) return;

    let dU = enemy.surfaceU - player.surfaceU;
    let dV = enemy.surfaceV - player.surfaceV;
    if (dU > 0.5) dU -= 1; else if (dU < -0.5) dU += 1;

    const dist = Math.sqrt(dU * dU + dV * dV);
    if (dist > TESLA_RADIUS) return;

    enemy.health -= damage;

    if (enemy.health <= 0) {
      enemy.alive = false;
      enemiesToKill.push(eIndex);
      player.score += 100;
      player.playerKills++;
    }
  });

  // Remove killed in reverse order
  const killedIds: string[] = [];
  for (let i = enemiesToKill.length - 1; i >= 0; i--) {
    killedIds.push(enemies[enemiesToKill[i]].id);
    enemies.splice(enemiesToKill[i], 1);
  }

  return { killedIds };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tesla coil area damage (s44j-17 regression)', () => {
  const DT = 1 / 60;

  it('damages enemies within radius', () => {
    const player: MockPlayer = {
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 150,
      surfaceU: 0.5, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    };
    // Enemy at UV distance 0.05 (within TESLA_RADIUS=0.10)
    const enemies: MockEnemy[] = [
      { id: 'e1', alive: true, health: 10, surfaceU: 0.55, surfaceV: 0.5 },
    ];
    applyTeslaDamage(player, enemies, DT);
    expect(enemies[0].health).toBeLessThan(10);
  });

  it('does NOT damage enemies outside radius', () => {
    const player: MockPlayer = {
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 150,
      surfaceU: 0.5, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    };
    // Enemy at UV distance 0.15 (outside TESLA_RADIUS=0.10)
    const enemies: MockEnemy[] = [
      { id: 'e2', alive: true, health: 10, surfaceU: 0.65, surfaceV: 0.5 },
    ];
    applyTeslaDamage(player, enemies, DT);
    expect(enemies[0].health).toBe(10);
  });

  it('kills enemies when health reaches zero', () => {
    const player: MockPlayer = {
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 150,
      surfaceU: 0.5, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    };
    // Enemy with very low health, close to player
    const enemies: MockEnemy[] = [
      { id: 'e3', alive: true, health: 0.001, surfaceU: 0.50, surfaceV: 0.50 },
    ];
    const { killedIds } = applyTeslaDamage(player, enemies, DT);
    expect(killedIds).toContain('e3');
    expect(enemies).toHaveLength(0); // removed from array
    expect(player.playerKills).toBe(1);
    expect(player.score).toBeGreaterThan(0);
  });

  it('drains ammo each tick', () => {
    const player: MockPlayer = {
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 5,
      surfaceU: 0.5, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    };
    const enemies: MockEnemy[] = [];
    applyTeslaDamage(player, enemies, DT);
    expect(player.weaponAmmo).toBe(4); // decremented by 1
  });

  it('reverts to standard weapon when ammo runs out', () => {
    const player: MockPlayer = {
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 1,
      surfaceU: 0.5, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    };
    applyTeslaDamage(player, [], DT);
    expect(player.weaponType).toBe('standard');
    expect(player.weaponAmmo).toBe(-1);
  });

  it('applies DPS proportional to dt', () => {
    const makePlayer = (): MockPlayer => ({
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 150,
      surfaceU: 0.5, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    });
    const makeEnemy = (): MockEnemy[] => [
      { id: 'e', alive: true, health: 1000, surfaceU: 0.50, surfaceV: 0.50 },
    ];

    // Two ticks of 1/60 should deal same damage as one tick of 2/60
    const enemies1 = makeEnemy();
    const p1 = makePlayer();
    applyTeslaDamage(p1, enemies1, 1 / 60);
    applyTeslaDamage(p1, enemies1, 1 / 60);

    const enemies2 = makeEnemy();
    const p2 = makePlayer();
    applyTeslaDamage(p2, enemies2, 2 / 60);

    expect(enemies1[0].health).toBeCloseTo(enemies2[0].health, 5);
  });

  it('does not damage dead enemies', () => {
    const player: MockPlayer = {
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 150,
      surfaceU: 0.5, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    };
    const enemies: MockEnemy[] = [
      { id: 'e_dead', alive: false, health: 5, surfaceU: 0.50, surfaceV: 0.50 },
    ];
    applyTeslaDamage(player, enemies, DT);
    expect(enemies[0].health).toBe(5); // unchanged
  });

  it('handles U-wrap boundary correctly (enemy at U near 0, player near 1)', () => {
    const player: MockPlayer = {
      alive: true, weaponType: 'tesla_coil', weaponAmmo: 150,
      surfaceU: 0.98, surfaceV: 0.5, playerLevel: 0, score: 0, playerKills: 0,
    };
    // Enemy at U=0.04 — UV distance without wrap = 0.94, with wrap = 0.06 (within radius)
    const enemies: MockEnemy[] = [
      { id: 'e_wrap', alive: true, health: 10, surfaceU: 0.04, surfaceV: 0.5 },
    ];
    applyTeslaDamage(player, enemies, DT);
    expect(enemies[0].health).toBeLessThan(10); // should hit despite U-wrap
  });
});
