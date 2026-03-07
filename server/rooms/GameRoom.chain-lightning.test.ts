/**
 * Regression test for s44r-04-05: Chain lightning (electric spark) not killing enemies in MP.
 *
 * Root cause: chain_lightning was routed through tryShoot() spawnBullet() — a UV-space projectile
 * that never reliably reached enemies (UV-position mismatch on non-sphere surfaces, and fundamentally
 * the weapon is area-effect in SP, not a projectile). On contact, enemies survived because the
 * server bullet never collided in UV space.
 *
 * Fix: chain_lightning in tryShoot() now calls fireChainLightningMP() instead of spawnBullet().
 * fireChainLightningMP() is an instant area-effect: damage applied directly to enemies within
 * CHAIN_UV_RANGE = 0.30 UV of the player (up to 5 targets, sorted by distance).
 *
 * These tests validate the fireChainLightningMP logic in isolation (no Colyseus Room instance).
 */

import { describe, it, expect } from 'vitest';
import { WEAPON_CONFIGS } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Replicate the exact logic from GameRoom.fireChainLightningMP()
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
  multiplier: number;
}

interface MockEnemy {
  id: string;
  alive: boolean;
  health: number;
  surfaceU: number;
  surfaceV: number;
  type: string;
}

const CHAIN_UV_RANGE = 0.30;
const MAX_TARGETS = 5;
const LEVEL_DAMAGE_MULTIPLIERS = [1.0, 1.1, 1.2, 1.35, 1.5, 1.7, 2.0, 2.3, 2.6, 3.0];

function fireChainLightningMP(
  player: MockPlayer,
  enemies: MockEnemy[],
): { hitIds: string[]; killedIds: string[] } {
  if (!player.alive) return { hitIds: [], killedIds: [] };

  const levelIdx = Math.min(player.playerLevel ?? 0, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
  const levelDamageMult = LEVEL_DAMAGE_MULTIPLIERS[levelIdx];
  const weapConfig = WEAPON_CONFIGS['chain_lightning'];
  const damage = weapConfig.damage * levelDamageMult;  // buff mult = 1.0 in tests

  // Collect enemies in range, sorted by UV distance
  const candidates: Array<{ eIndex: number; dist: number }> = [];
  enemies.forEach((enemy, eIndex) => {
    if (!enemy.alive) return;
    let dU = enemy.surfaceU - player.surfaceU;
    let dV = enemy.surfaceV - player.surfaceV;
    if (dU > 0.5) dU -= 1; else if (dU < -0.5) dU += 1;
    const dist = Math.sqrt(dU * dU + dV * dV);
    if (dist <= CHAIN_UV_RANGE) {
      candidates.push({ eIndex, dist });
    }
  });

  if (candidates.length === 0) return { hitIds: [], killedIds: [] };

  candidates.sort((a, b) => a.dist - b.dist);
  const hits = candidates.slice(0, MAX_TARGETS);

  const hitIds: string[] = [];
  const enemiesToKill: number[] = [];

  for (const { eIndex } of hits) {
    const enemy = enemies[eIndex];
    if (!enemy || !enemy.alive) continue;

    hitIds.push(enemy.id);
    enemy.health -= damage;

    if (enemy.health <= 0) {
      enemy.alive = false;
      enemiesToKill.push(eIndex);
      player.score += 100 * player.multiplier;
      player.playerKills++;
    }
  }

  // Remove killed in reverse index order
  enemiesToKill.sort((a, b) => b - a);
  const killedIds: string[] = [];
  for (const idx of enemiesToKill) {
    killedIds.push(enemies[idx].id);
    enemies.splice(idx, 1);
  }

  return { hitIds, killedIds };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chain_lightning area damage (s44r-04-05 regression)', () => {
  const makePlayer = (overrides: Partial<MockPlayer> = {}): MockPlayer => ({
    alive: true,
    weaponType: 'chain_lightning',
    weaponAmmo: 25,
    surfaceU: 0.5,
    surfaceV: 0.5,
    playerLevel: 0,
    score: 0,
    playerKills: 0,
    multiplier: 1,
    ...overrides,
  });

  const makeEnemy = (id: string, u: number, v: number, health = 100): MockEnemy => ({
    id,
    alive: true,
    health,
    surfaceU: u,
    surfaceV: v,
    type: 'grunt',
  });

  it('deals damage=4 to a nearby enemy (base level, no buffs)', () => {
    // This is the core regression: chain_lightning MUST deal damage 4 per hit
    const player = makePlayer();
    const enemies = [makeEnemy('e1', 0.5, 0.5)]; // same position as player
    fireChainLightningMP(player, enemies);
    const expectedDamage = WEAPON_CONFIGS['chain_lightning'].damage * LEVEL_DAMAGE_MULTIPLIERS[0];
    expect(enemies[0].health).toBeCloseTo(100 - expectedDamage, 5);
    expect(expectedDamage).toBe(4); // verify config: damage=4
  });

  it('kills an enemy with health <= 4 in one shot', () => {
    const player = makePlayer();
    const enemies = [makeEnemy('e1', 0.52, 0.5, 4)]; // health=4, exactly enough to kill
    const { killedIds } = fireChainLightningMP(player, enemies);
    expect(killedIds).toContain('e1');
    expect(enemies).toHaveLength(0);
    expect(player.playerKills).toBe(1);
    expect(player.score).toBeGreaterThan(0);
  });

  it('does NOT damage enemies outside CHAIN_UV_RANGE (0.30 UV)', () => {
    const player = makePlayer();
    const enemies = [makeEnemy('e_far', 0.85, 0.5)]; // UV dist = 0.35 > 0.30
    fireChainLightningMP(player, enemies);
    expect(enemies[0].health).toBe(100); // untouched
  });

  it('hits enemies just inside the range boundary (0.29 UV < 0.30 threshold)', () => {
    const player = makePlayer();
    const enemies = [makeEnemy('e_edge', 0.79, 0.5)]; // UV dist = 0.29 < CHAIN_UV_RANGE
    fireChainLightningMP(player, enemies);
    expect(enemies[0].health).toBeLessThan(100); // should be hit
  });

  it('hits up to MAX_TARGETS=5 enemies, not more', () => {
    const player = makePlayer();
    // 7 enemies all within range
    const enemies = [
      makeEnemy('e1', 0.51, 0.5),
      makeEnemy('e2', 0.52, 0.5),
      makeEnemy('e3', 0.53, 0.5),
      makeEnemy('e4', 0.54, 0.5),
      makeEnemy('e5', 0.55, 0.5),
      makeEnemy('e6', 0.56, 0.5),
      makeEnemy('e7', 0.57, 0.5),
    ];
    const { hitIds } = fireChainLightningMP(player, enemies);
    expect(hitIds).toHaveLength(5); // capped at MAX_TARGETS
  });

  it('hits closest enemies first (sorted by UV distance)', () => {
    const player = makePlayer();
    const enemies = [
      makeEnemy('far', 0.78, 0.5, 1000),    // dist=0.28
      makeEnemy('mid', 0.65, 0.5, 1000),    // dist=0.15
      makeEnemy('close', 0.51, 0.5, 1000),  // dist=0.01 — closest
    ];
    const { hitIds } = fireChainLightningMP(player, enemies);
    // All 3 within range, all should be hit
    expect(hitIds).toContain('close');
    expect(hitIds).toContain('mid');
    expect(hitIds).toContain('far');
    // Closest should take more damage (same damage for all, but confirm close is hit first)
    expect(hitIds[0]).toBe('close');
  });

  it('does nothing when player is dead', () => {
    const player = makePlayer({ alive: false });
    const enemies = [makeEnemy('e1', 0.5, 0.5)];
    const { hitIds } = fireChainLightningMP(player, enemies);
    expect(hitIds).toHaveLength(0);
    expect(enemies[0].health).toBe(100);
  });

  it('does nothing when no enemies are in range', () => {
    const player = makePlayer();
    const { hitIds, killedIds } = fireChainLightningMP(player, []);
    expect(hitIds).toHaveLength(0);
    expect(killedIds).toHaveLength(0);
  });

  it('skips already-dead enemies', () => {
    const player = makePlayer();
    const enemies = [{ ...makeEnemy('e_dead', 0.5, 0.5), alive: false }];
    const { hitIds } = fireChainLightningMP(player, enemies);
    expect(hitIds).toHaveLength(0);
    expect(enemies[0].health).toBe(100); // unchanged
  });

  it('handles U-wrap boundary (enemy at U near 0, player near 1)', () => {
    const player = makePlayer({ surfaceU: 0.96 });
    // Enemy at U=0.06 — naive dist = 0.90, wrapped dist = 0.10 (within range)
    const enemies = [makeEnemy('e_wrap', 0.06, 0.5)];
    const { hitIds } = fireChainLightningMP(player, enemies);
    expect(hitIds).toContain('e_wrap'); // should hit despite U-wrap
  });

  it('scales damage with player level', () => {
    const player0 = makePlayer({ playerLevel: 0 });
    const player5 = makePlayer({ playerLevel: 5 });
    const enemies0 = [makeEnemy('e0', 0.5, 0.5, 1000)];
    const enemies5 = [makeEnemy('e5', 0.5, 0.5, 1000)];

    fireChainLightningMP(player0, enemies0);
    fireChainLightningMP(player5, enemies5);

    const baseDamage = WEAPON_CONFIGS['chain_lightning'].damage;
    const level5Damage = baseDamage * LEVEL_DAMAGE_MULTIPLIERS[5];

    expect(enemies0[0].health).toBeCloseTo(1000 - baseDamage, 5);
    expect(enemies5[0].health).toBeCloseTo(1000 - level5Damage, 5);
    expect(enemies5[0].health).toBeLessThan(enemies0[0].health); // higher level = more damage
  });

  it('WEAPON_CONFIGS.chain_lightning matches expected values (damage=4, ammo=25, fireRate=3)', () => {
    // Guard against config regressions
    const cfg = WEAPON_CONFIGS['chain_lightning'];
    expect(cfg.damage).toBe(4);
    expect(cfg.ammo).toBe(25);
    expect(cfg.fireRate).toBe(3);
  });
});
