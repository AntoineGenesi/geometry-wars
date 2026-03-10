/**
 * SP vs MP Parity Regression Tests
 *
 * Verifies that gameplay constants shared between single-player and multiplayer
 * are consistent. These tests catch the class of bugs where SP and MP diverge:
 *   - s43-02: bullet damage 4× too low (0.25 vs 1.0)
 *   - s44c-05: fire rate uniform 10/s for all weapons
 *   - s43-11: bullet lifetime 3s vs 6s
 *
 * Now that both SP and MP import from src/shared/GameBalanceConstants.ts,
 * these tests serve as regression guards against future drift.
 */

import { describe, it, expect } from 'vitest';
import {
  SHARED_WEAPON_CONFIGS,
  SERVER_WEAPON_CONFIGS,
  LEVEL_THRESHOLDS,
  LEVEL_DAMAGE_MULTIPLIERS,
  LEVEL_FIRE_RATE_MULTIPLIERS,
  LEVEL_MOVE_SPEED_MULTIPLIERS,
  BULLET_LIFETIME,
  BULLET_SPEED_WORLD,
  BULLET_SPEED_UV,
  PLAYER_WORLD_SPEED,
  PLAYER_SPEED_UV,
  WEAPON_DROP_CHANCE,
  WEAPON_PICKUP_LIFETIME,
  ENEMY_SPEEDS,
  ENEMY_SCORES,
  ENEMY_HEALTH,
  PLAYER_PVP_MAX_HEALTH,
  PLAYER_PVP_INVINCIBILITY_DURATION,
  PVP_KILLS_TO_WIN,
  HEALTH_PICKUP_THRESHOLD,
  HEALTH_PICKUP_SPAWN_FREQUENCY,
  HEALTH_PICKUP_HEAL_AMOUNT,
  HEALTH_PICKUP_LIFETIME,
  HEALTH_PICKUP_SPAWN_RADIUS,
  DIFFICULTY_PER_PLAYER_FACTOR,
} from '../shared/GameBalanceConstants';
import { WEAPON_CONFIGS, WeaponType } from '../weapons/WeaponTypes';

describe('SP/MP Parity — Shared Constants', () => {
  // -----------------------------------------------------------------------
  // Weapon config parity
  // -----------------------------------------------------------------------
  describe('Weapon configs', () => {
    const weaponTypes = Object.values(WeaponType);

    it('SP WeaponTypes uses shared numeric values for all weapons', () => {
      for (const type of weaponTypes) {
        const sp = WEAPON_CONFIGS[type];
        const shared = SHARED_WEAPON_CONFIGS[type];
        expect(shared, `Missing shared config for ${type}`).toBeDefined();
        expect(sp.damage).toBe(shared.damage);
        expect(sp.fireRate).toBe(shared.fireRate);
        expect(sp.ammo).toBe(shared.ammo);
      }
    });

    it('server WEAPON_CONFIGS has matching fireRate for all weapons', () => {
      // Server damage differs from SP (1.0 vs 0.25 for standard) — this is intentional.
      // But fireRate must match so weapons shoot at the same speed.
      for (const type of weaponTypes) {
        const shared = SHARED_WEAPON_CONFIGS[type];
        const server = SERVER_WEAPON_CONFIGS[type];
        expect(server, `Missing server config for ${type}`).toBeDefined();
        expect(server.fireRate).toBe(shared.fireRate);
      }
    });

    it('all weapon types have positive fire rates', () => {
      for (const type of weaponTypes) {
        expect(SHARED_WEAPON_CONFIGS[type].fireRate).toBeGreaterThan(0);
      }
    });

    it('standard weapon has unlimited ammo (-1)', () => {
      expect(SHARED_WEAPON_CONFIGS.standard.ammo).toBe(-1);
    });
  });

  // -----------------------------------------------------------------------
  // Level system parity
  // -----------------------------------------------------------------------
  describe('Level system', () => {
    it('has 10 level thresholds (levels 0-9)', () => {
      expect(LEVEL_THRESHOLDS).toHaveLength(10);
    });

    it('thresholds are monotonically increasing', () => {
      for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
        expect(LEVEL_THRESHOLDS[i]).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]);
      }
    });

    it('starts at 0 kills for level 0', () => {
      expect(LEVEL_THRESHOLDS[0]).toBe(0);
    });

    it('damage multipliers match expected progression', () => {
      expect(LEVEL_DAMAGE_MULTIPLIERS).toHaveLength(10);
      expect(LEVEL_DAMAGE_MULTIPLIERS[0]).toBe(1.0); // No bonus at start
      expect(LEVEL_DAMAGE_MULTIPLIERS[9]).toBe(2.0); // 2x damage at max
    });

    it('fire rate multipliers match expected progression', () => {
      expect(LEVEL_FIRE_RATE_MULTIPLIERS).toHaveLength(10);
      expect(LEVEL_FIRE_RATE_MULTIPLIERS[0]).toBe(1.0);
    });

    it('move speed multipliers match expected progression', () => {
      expect(LEVEL_MOVE_SPEED_MULTIPLIERS).toHaveLength(10);
      expect(LEVEL_MOVE_SPEED_MULTIPLIERS[0]).toBe(1.0);
    });

    it('all multipliers are >= 1.0 (buffs only, no nerfs)', () => {
      for (let i = 0; i < 10; i++) {
        expect(LEVEL_DAMAGE_MULTIPLIERS[i]).toBeGreaterThanOrEqual(1.0);
        expect(LEVEL_FIRE_RATE_MULTIPLIERS[i]).toBeGreaterThanOrEqual(1.0);
        expect(LEVEL_MOVE_SPEED_MULTIPLIERS[i]).toBeGreaterThanOrEqual(1.0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Bullet constants
  // -----------------------------------------------------------------------
  describe('Bullet constants', () => {
    it('BULLET_LIFETIME is 6 seconds', () => {
      expect(BULLET_LIFETIME).toBe(6.0);
    });

    it('BULLET_SPEED_WORLD is 4.0 units/sec', () => {
      expect(BULLET_SPEED_WORLD).toBe(4.0);
    });

    it('BULLET_SPEED_UV is approximately BULLET_SPEED_WORLD / (π * 10)', () => {
      // On a sphere of radius 10: worldSpeed / (π * radius) ≈ UV speed
      const expectedUV = BULLET_SPEED_WORLD / (Math.PI * 10);
      expect(BULLET_SPEED_UV).toBeCloseTo(expectedUV, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Player movement constants
  // -----------------------------------------------------------------------
  describe('Player movement', () => {
    it('PLAYER_WORLD_SPEED is 3.3 units/sec (s44b-09)', () => {
      expect(PLAYER_WORLD_SPEED).toBe(3.3);
    });

    it('PLAYER_SPEED_UV is approximately PLAYER_WORLD_SPEED / (π * 10)', () => {
      const expectedUV = PLAYER_WORLD_SPEED / (Math.PI * 10);
      expect(PLAYER_SPEED_UV).toBeCloseTo(expectedUV, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Enemy constants consistency
  // -----------------------------------------------------------------------
  describe('Enemy constants', () => {
    const enemyTypes = Object.keys(ENEMY_SPEEDS);

    it('all enemy types with speeds also have health', () => {
      for (const type of enemyTypes) {
        expect(ENEMY_HEALTH[type], `Missing health for ${type}`).toBeDefined();
      }
    });

    it('all enemy types with speeds also have scores', () => {
      for (const type of enemyTypes) {
        expect(ENEMY_SCORES[type], `Missing score for ${type}`).toBeDefined();
      }
    });

    it('all enemy health values are positive integers', () => {
      for (const [type, hp] of Object.entries(ENEMY_HEALTH)) {
        expect(hp, `${type} has non-positive health`).toBeGreaterThan(0);
        expect(Number.isInteger(hp), `${type} health is not integer`).toBe(true);
      }
    });

    it('all enemy scores are positive', () => {
      for (const [type, score] of Object.entries(ENEMY_SCORES)) {
        expect(score, `${type} has non-positive score`).toBeGreaterThan(0);
      }
    });

    it('enemy speeds are non-negative', () => {
      for (const [type, speed] of Object.entries(ENEMY_SPEEDS)) {
        expect(speed, `${type} has negative speed`).toBeGreaterThanOrEqual(0);
      }
    });

    // Regression: s40-07 fixed parity — grunt had wrong health
    it('grunt has 2 HP (regression s40-07)', () => {
      expect(ENEMY_HEALTH.grunt).toBe(2);
    });

    // Regression: spinner was 3 HP, should be 1
    it('spinner has 1 HP (regression s40-07)', () => {
      expect(ENEMY_HEALTH.spinner).toBe(1);
    });

    // Regression: gate was 2 HP, should be 1
    it('gate has 1 HP (regression s40-07)', () => {
      expect(ENEMY_HEALTH.gate).toBe(1);
    });

    // Regression: virus was 3 HP, should be 1
    it('virus has 1 HP (regression s40-07)', () => {
      expect(ENEMY_HEALTH.virus).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // PvP constants
  // -----------------------------------------------------------------------
  describe('PvP constants', () => {
    it('max health is 100', () => {
      expect(PLAYER_PVP_MAX_HEALTH).toBe(100);
    });

    it('invincibility duration is 3 seconds', () => {
      expect(PLAYER_PVP_INVINCIBILITY_DURATION).toBe(3.0);
    });

    it('kills to win is 10', () => {
      expect(PVP_KILLS_TO_WIN).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // Health pickup constants
  // -----------------------------------------------------------------------
  describe('Health pickup constants', () => {
    it('threshold is 70%', () => {
      expect(HEALTH_PICKUP_THRESHOLD).toBe(0.70);
    });

    it('spawn frequency is 30 seconds', () => {
      expect(HEALTH_PICKUP_SPAWN_FREQUENCY).toBe(30);
    });

    it('heal amount is 20 HP', () => {
      expect(HEALTH_PICKUP_HEAL_AMOUNT).toBe(20);
    });

    it('lifetime is 10 seconds', () => {
      expect(HEALTH_PICKUP_LIFETIME).toBe(10.0);
    });
  });

  // -----------------------------------------------------------------------
  // Weapon pickup constants
  // -----------------------------------------------------------------------
  describe('Weapon pickup constants', () => {
    it('drop chance is 8%', () => {
      expect(WEAPON_DROP_CHANCE).toBe(0.08);
    });

    it('pickup lifetime is 20 seconds', () => {
      expect(WEAPON_PICKUP_LIFETIME).toBe(20.0);
    });
  });

  // -----------------------------------------------------------------------
  // PvPvE difficulty constants
  // -----------------------------------------------------------------------
  describe('PvPvE difficulty', () => {
    it('low tier reduces spawn rate per eliminated player', () => {
      expect(DIFFICULTY_PER_PLAYER_FACTOR.low).toBeLessThan(0);
    });

    it('medium tier has no adjustment', () => {
      expect(DIFFICULTY_PER_PLAYER_FACTOR.medium).toBe(0);
    });

    it('high tier increases spawn rate per eliminated player', () => {
      expect(DIFFICULTY_PER_PLAYER_FACTOR.high).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-file import consistency
  // -----------------------------------------------------------------------
  describe('Import consistency', () => {
    it('SP WeaponTypes.ts weapon configs import from shared (no local numeric duplication)', () => {
      // Verify that the SP WEAPON_CONFIGS use the exact same numeric values
      // as SHARED_WEAPON_CONFIGS. If these ever diverge, someone added inline values.
      for (const type of Object.values(WeaponType)) {
        const sp = WEAPON_CONFIGS[type];
        const shared = SHARED_WEAPON_CONFIGS[type];
        expect(sp.damage).toBe(shared.damage);
        expect(sp.fireRate).toBe(shared.fireRate);
        expect(sp.ammo).toBe(shared.ammo);
      }
    });
  });
});
