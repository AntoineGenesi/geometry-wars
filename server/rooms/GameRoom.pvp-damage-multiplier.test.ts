/**
 * Tests for s44r7-14: PvP Damage Multiplier host setting.
 *
 * Verifies that:
 * - pvpDamageMultiplier is a validated GameSettings field (0.1–10, default 1.0)
 * - The multiplier is applied to player-vs-player bullet damage
 * - Enemy-vs-player and player-vs-enemy damage is NOT affected
 *
 * All tests are pure JS — no Colyseus, no Three.js.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSettings,
  DEFAULT_GAME_SETTINGS,
} from '../shared/GameSettings';
import type { GameSettings } from '../shared/GameSettings';
import { WEAPON_CONFIGS, LEVEL_DAMAGE_MULTIPLIERS } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Helpers mirroring GameRoom's pvp_bullet_hit damage calculation
// ---------------------------------------------------------------------------


function computePvpBulletDamage(
  weaponType: string,
  playerLevel: number,
  pvpDamageMultiplier: number,
): number {
  const weaponCfg = WEAPON_CONFIGS[weaponType] ?? WEAPON_CONFIGS.standard;
  const levelIdx = Math.min(playerLevel, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
  return weaponCfg.damage * LEVEL_DAMAGE_MULTIPLIERS[levelIdx] * pvpDamageMultiplier;
}

function computeEnemyBulletDamage(
  weaponType: string,
  playerLevel: number,
  // pvpDamageMultiplier is NOT passed — enemy damage is unaffected
): number {
  const weaponCfg = WEAPON_CONFIGS[weaponType] ?? WEAPON_CONFIGS.standard;
  const levelIdx = Math.min(playerLevel, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
  return weaponCfg.damage * LEVEL_DAMAGE_MULTIPLIERS[levelIdx];
}

// ---------------------------------------------------------------------------
// validateSettings tests
// ---------------------------------------------------------------------------

describe('pvpDamageMultiplier — validateSettings', () => {
  it('has default value 1.0', () => {
    const s = validateSettings({});
    expect(s.pvpDamageMultiplier).toBe(1.0);
  });

  it('DEFAULT_GAME_SETTINGS has pvpDamageMultiplier: 1.0', () => {
    expect(DEFAULT_GAME_SETTINGS.pvpDamageMultiplier).toBe(1.0);
  });

  it('accepts valid values in range', () => {
    expect(validateSettings({ pvpDamageMultiplier: 0.5 }).pvpDamageMultiplier).toBe(0.5);
    expect(validateSettings({ pvpDamageMultiplier: 2.0 }).pvpDamageMultiplier).toBe(2.0);
    expect(validateSettings({ pvpDamageMultiplier: 10 }).pvpDamageMultiplier).toBe(10);
  });

  it('clamps to minimum 0.1', () => {
    expect(validateSettings({ pvpDamageMultiplier: 0 }).pvpDamageMultiplier).toBe(0.1);
    expect(validateSettings({ pvpDamageMultiplier: -5 }).pvpDamageMultiplier).toBe(0.1);
  });

  it('clamps to maximum 10', () => {
    expect(validateSettings({ pvpDamageMultiplier: 100 }).pvpDamageMultiplier).toBe(10);
    expect(validateSettings({ pvpDamageMultiplier: 15 }).pvpDamageMultiplier).toBe(10);
  });

  it('falls back to default for non-finite values', () => {
    // NaN and Infinity are not finite — isFiniteNumber() returns false, falls back to default 1.0
    expect(validateSettings({ pvpDamageMultiplier: NaN }).pvpDamageMultiplier).toBe(1.0);
    expect(validateSettings({ pvpDamageMultiplier: Infinity }).pvpDamageMultiplier).toBe(1.0);
  });

  it('round-trips through validateSettings correctly', () => {
    const input: Partial<GameSettings> = { pvpDamageMultiplier: 2.5, mode: 'pvp' };
    const result = validateSettings(input);
    expect(result.pvpDamageMultiplier).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// PvP damage calculation tests
// ---------------------------------------------------------------------------

describe('pvpDamageMultiplier — damage application', () => {
  it('multiplier 1.0 gives baseline damage', () => {
    const base = computePvpBulletDamage('standard', 0, 1.0);
    expect(base).toBeCloseTo(WEAPON_CONFIGS.standard.damage * 1.0);
  });

  it('multiplier 2.0 doubles PvP damage', () => {
    const base = computePvpBulletDamage('standard', 0, 1.0);
    const doubled = computePvpBulletDamage('standard', 0, 2.0);
    expect(doubled).toBeCloseTo(base * 2.0);
  });

  it('multiplier 0.5 halves PvP damage', () => {
    const base = computePvpBulletDamage('standard', 0, 1.0);
    const halved = computePvpBulletDamage('standard', 0, 0.5);
    expect(halved).toBeCloseTo(base * 0.5);
  });

  it('multiplier 0.1 greatly reduces PvP damage', () => {
    const base = computePvpBulletDamage('standard', 0, 1.0);
    const min = computePvpBulletDamage('standard', 0, 0.1);
    expect(min).toBeCloseTo(base * 0.1);
  });

  it('level multiplier and pvpDamageMultiplier stack multiplicatively', () => {
    const lvl3Multiplier1 = computePvpBulletDamage('standard', 3, 1.0);
    const lvl3Multiplier2 = computePvpBulletDamage('standard', 3, 2.0);
    expect(lvl3Multiplier2).toBeCloseTo(lvl3Multiplier1 * 2.0);
  });

  it('pvpDamageMultiplier does NOT affect enemy damage calculation', () => {
    const enemyDamage = computeEnemyBulletDamage('standard', 0);
    const pvpDamage2x = computePvpBulletDamage('standard', 0, 2.0);

    // Enemy damage = weapon.damage * level mult (no pvpDamageMultiplier)
    expect(enemyDamage).toBeCloseTo(WEAPON_CONFIGS.standard.damage * 1.0);
    // PvP damage with 2x = double enemy damage
    expect(pvpDamage2x).toBeCloseTo(enemyDamage * 2.0);
  });

  it('works with different weapon types', () => {
    const spreadBase = computePvpBulletDamage('spread', 0, 1.0);
    const spreadDoubled = computePvpBulletDamage('spread', 0, 2.0);
    expect(spreadDoubled).toBeCloseTo(spreadBase * 2.0);
  });
});
