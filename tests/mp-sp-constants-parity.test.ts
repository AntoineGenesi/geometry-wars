/**
 * MP ↔ SP Constants Parity Test
 *
 * Guards against future drift between SP (src/weapons/WeaponTypes.ts,
 * src/core/PlayerLevel.ts) and server (server/shared/GameConstants.ts).
 *
 * When to update this file:
 *   If a test fails, it means a constant changed in one place but not the other.
 *   Fix the production code to be in sync, THEN update the values here.
 *   DO NOT just update this file without fixing the production code.
 *
 * Phase H regression guard — part of s42-04h task.
 */

import { describe, it, expect } from 'vitest';
import { WEAPON_CONFIGS as SP_WEAPON_CONFIGS, WeaponType } from '../src/weapons/WeaponTypes.js';
import { getLevelPerk } from '../src/core/PlayerLevel.js';
import {
  WEAPON_CONFIGS as SERVER_WEAPON_CONFIGS,
  LEVEL_THRESHOLDS as SERVER_LEVEL_THRESHOLDS,
  LEVEL_DAMAGE_MULTIPLIERS as SERVER_LEVEL_DAMAGE_MULTIPLIERS,
  LEVEL_FIRE_RATE_MULTIPLIERS as SERVER_LEVEL_FIRE_RATE_MULTIPLIERS,
  LEVEL_MOVE_SPEED_MULTIPLIERS as SERVER_LEVEL_MOVE_SPEED_MULTIPLIERS,
} from '../server/shared/GameConstants.js';

// SP weapon type → server weapon key mapping
const SP_TO_SERVER_KEY: Record<WeaponType, string> = {
  [WeaponType.Standard]:       'standard',
  [WeaponType.Spread]:         'spread',
  [WeaponType.Piercing]:       'piercing',
  [WeaponType.ChainLightning]: 'chain_lightning',
  [WeaponType.Homing]:         'homing',
  [WeaponType.PlasmaMortar]:   'plasma_mortar',
  [WeaponType.GravityGun]:     'gravity_gun',
  [WeaponType.LaserBeam]:      'laser_beam',
  [WeaponType.BlackHole]:      'black_hole',
  [WeaponType.TeslaCoil]:      'tesla_coil',
};

// SP level thresholds are private constants in PlayerLevel.ts.
// These expected values are extracted from the source and must be kept
// in sync with the private LEVEL_THRESHOLDS in PlayerLevel.ts.
// REGRESSION GUARD: if someone changes thresholds in one place, this fails.
const SP_LEVEL_THRESHOLDS_EXPECTED = [0, 10, 25, 50, 80, 120, 175, 250, 350, 500];

// ---------------------------------------------------------------------------
// Section 1: Weapon Base Damage (SP vs Server)
// CRITICAL: If these diverge, gameplay balance is inconsistent between modes.
// ---------------------------------------------------------------------------

describe('Weapon base damage: SP src/weapons/WeaponTypes.ts vs server/shared/GameConstants.ts', () => {

  it('standard weapon: SP=0.25, server=0.25 (REGRESSION GUARD: was 1.0 before S38c-05 fix)', () => {
    expect(SP_WEAPON_CONFIGS[WeaponType.Standard].damage).toBe(0.25);
    expect(SERVER_WEAPON_CONFIGS.standard.damage).toBe(0.25);
  });

  it('spread weapon: SP=1, server=1', () => {
    expect(SP_WEAPON_CONFIGS[WeaponType.Spread].damage).toBe(1);
    expect(SERVER_WEAPON_CONFIGS.spread.damage).toBe(1);
  });

  it('piercing weapon: SP=3, server=3', () => {
    expect(SP_WEAPON_CONFIGS[WeaponType.Piercing].damage).toBe(3);
    expect(SERVER_WEAPON_CONFIGS.piercing.damage).toBe(3);
  });

  it('homing weapon: SP=6, server=6', () => {
    expect(SP_WEAPON_CONFIGS[WeaponType.Homing].damage).toBe(6);
    expect(SERVER_WEAPON_CONFIGS.homing.damage).toBe(6);
  });

  it('chain_lightning weapon: SP=4, server=4', () => {
    expect(SP_WEAPON_CONFIGS[WeaponType.ChainLightning].damage).toBe(4);
    expect(SERVER_WEAPON_CONFIGS.chain_lightning.damage).toBe(4);
  });

  it('plasma_mortar weapon: SP=20, server=20', () => {
    expect(SP_WEAPON_CONFIGS[WeaponType.PlasmaMortar].damage).toBe(20);
    expect(SERVER_WEAPON_CONFIGS.plasma_mortar.damage).toBe(20);
  });

  it('all weapon types: SP damage matches server damage', () => {
    for (const [spType, serverKey] of Object.entries(SP_TO_SERVER_KEY)) {
      const weaponType = spType as WeaponType;
      const spDamage = SP_WEAPON_CONFIGS[weaponType].damage;
      const serverDamage = SERVER_WEAPON_CONFIGS[serverKey]?.damage;
      expect(serverDamage).toBeDefined(
        /* message */ `server/shared/GameConstants.ts missing weapon key: ${serverKey}`
      );
      expect(serverDamage).toBe(spDamage,
        /* message */ `Damage mismatch for ${weaponType}: SP=${spDamage}, server=${serverDamage}. ` +
        `Update server/shared/GameConstants.ts to match src/weapons/WeaponTypes.ts.`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2: Level Thresholds (SP private vs Server exported)
// ---------------------------------------------------------------------------

describe('Level kill thresholds: src/core/PlayerLevel.ts vs server/shared/GameConstants.ts', () => {

  it('server exports 10 level thresholds (levels 0-9)', () => {
    expect(SERVER_LEVEL_THRESHOLDS.length).toBe(10);
  });

  it('server level thresholds match expected SP values', () => {
    // SP thresholds are private — expected values extracted from PlayerLevel.ts
    expect(SERVER_LEVEL_THRESHOLDS).toEqual(SP_LEVEL_THRESHOLDS_EXPECTED);
  });

  it('level 0 threshold is 0 kills (starting level)', () => {
    expect(SERVER_LEVEL_THRESHOLDS[0]).toBe(0);
  });

  it('level 1 threshold is 10 kills', () => {
    expect(SERVER_LEVEL_THRESHOLDS[1]).toBe(10);
  });

  it('level 2 threshold is 25 kills', () => {
    expect(SERVER_LEVEL_THRESHOLDS[2]).toBe(25);
  });

  it('level 9 (max) threshold is 500 kills', () => {
    expect(SERVER_LEVEL_THRESHOLDS[9]).toBe(500);
  });

  it('thresholds are strictly increasing', () => {
    for (let i = 1; i < SERVER_LEVEL_THRESHOLDS.length; i++) {
      expect(SERVER_LEVEL_THRESHOLDS[i]).toBeGreaterThan(SERVER_LEVEL_THRESHOLDS[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3: Level Damage Multipliers (SP getLevelPerk() vs Server constants)
// ---------------------------------------------------------------------------

describe('Level damage multipliers: getLevelPerk() vs server/shared/GameConstants.ts', () => {

  it('server exports 10 damage multipliers (one per level)', () => {
    expect(SERVER_LEVEL_DAMAGE_MULTIPLIERS.length).toBe(10);
  });

  it('level 0: SP=1.0, server=1.0 (no bonus at start)', () => {
    expect(getLevelPerk(0).damageMultiplier).toBe(1.0);
    expect(SERVER_LEVEL_DAMAGE_MULTIPLIERS[0]).toBe(1.0);
  });

  it('level 1: SP=1.15, server=1.15 (Sharpshooter +15% damage)', () => {
    expect(getLevelPerk(1).damageMultiplier).toBe(1.15);
    expect(SERVER_LEVEL_DAMAGE_MULTIPLIERS[1]).toBe(1.15);
  });

  it('level 5: SP=1.45, server=1.45 (Destroyer +30% damage)', () => {
    expect(getLevelPerk(5).damageMultiplier).toBe(1.45);
    expect(SERVER_LEVEL_DAMAGE_MULTIPLIERS[5]).toBe(1.45);
  });

  it('level 9: SP=2.0, server=2.0 (Apex max level)', () => {
    expect(getLevelPerk(9).damageMultiplier).toBe(2.0);
    expect(SERVER_LEVEL_DAMAGE_MULTIPLIERS[9]).toBe(2.0);
  });

  it('all levels: SP getLevelPerk().damageMultiplier matches server constants', () => {
    for (let level = 0; level < 10; level++) {
      const spMult = getLevelPerk(level).damageMultiplier;
      const serverMult = SERVER_LEVEL_DAMAGE_MULTIPLIERS[level];
      expect(serverMult).toBe(spMult,
        /* message */ `Damage multiplier mismatch at level ${level}: ` +
        `SP getLevelPerk(${level}).damageMultiplier=${spMult}, ` +
        `server LEVEL_DAMAGE_MULTIPLIERS[${level}]=${serverMult}. ` +
        `Update server/shared/GameConstants.ts to match src/core/PlayerLevel.ts.`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Section 4: Level Fire Rate Multipliers (SP vs Server)
// ---------------------------------------------------------------------------

describe('Level fire rate multipliers: getLevelPerk() vs server/shared/GameConstants.ts', () => {

  it('server exports 10 fire rate multipliers', () => {
    expect(SERVER_LEVEL_FIRE_RATE_MULTIPLIERS.length).toBe(10);
  });

  it('all levels: SP fire rate multiplier matches server', () => {
    for (let level = 0; level < 10; level++) {
      const spMult = getLevelPerk(level).fireRateMultiplier;
      const serverMult = SERVER_LEVEL_FIRE_RATE_MULTIPLIERS[level];
      expect(serverMult).toBe(spMult,
        /* message */ `Fire rate multiplier mismatch at level ${level}: SP=${spMult}, server=${serverMult}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Section 5: Level Move Speed Multipliers (SP vs Server)
// ---------------------------------------------------------------------------

describe('Level move speed multipliers: getLevelPerk() vs server/shared/GameConstants.ts', () => {

  it('server exports 10 move speed multipliers', () => {
    expect(SERVER_LEVEL_MOVE_SPEED_MULTIPLIERS.length).toBe(10);
  });

  it('all levels: SP move speed multiplier matches server', () => {
    for (let level = 0; level < 10; level++) {
      const spMult = getLevelPerk(level).moveSpeedMultiplier;
      const serverMult = SERVER_LEVEL_MOVE_SPEED_MULTIPLIERS[level];
      expect(serverMult).toBe(spMult,
        /* message */ `Move speed multiplier mismatch at level ${level}: SP=${spMult}, server=${serverMult}`
      );
    }
  });
});
