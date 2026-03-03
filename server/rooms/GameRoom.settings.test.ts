// server/rooms/GameRoom.settings.test.ts
// Unit tests for GameSettings data model and validateSettings() function.

import { describe, it, expect } from 'vitest';
import {
  validateSettings,
  DEFAULT_GAME_SETTINGS,
  VALID_MODES,
  VALID_SURFACES,
  VALID_STARTING_WEAPONS,
  PVP_MODES,
} from '../shared/GameSettings';
import type { GameSettings, GameMode, GameSurface } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

describe('DEFAULT_GAME_SETTINGS', () => {
  it('has all required fields', () => {
    const d = DEFAULT_GAME_SETTINGS;
    expect(d.mode).toBe('waves');
    expect(d.surface).toBe('sphere');
    expect(d.lives).toBe(3);
    expect(d.infiniteLives).toBe(false);
    expect(d.difficultyMultiplier).toBe(1.0);
    expect(d.enemySpawnRateMultiplier).toBe(1.0);
    expect(d.bossFrequency).toBe(0.5);
    expect(d.pvpEnabled).toBe(false);
    expect(d.pvpWinCondition).toBe('kills');
    expect(d.healingFrequency).toBe(30);
    expect(d.healingAmount).toBe(25);
    expect(d.healthBarVisibility).toBe('all');
    expect(d.friendlyFire).toBe(false);
    expect(d.weaponSpawnFrequency).toBe(1.0);
    expect(d.buffSpawnFrequency).toBe(1.0);
    expect(d.startingWeapon).toBe('standard');
    expect(d.timeLimit).toBe(0);
    expect(d.enemyCountCap).toBe(50);
    expect(d.bulletCountCap).toBe(500);
    expect(d.visualQuality).toBe('auto');
  });

  it('returns defaults when called with no arguments', () => {
    const result = validateSettings();
    expect(result).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('returns defaults when called with empty object', () => {
    const result = validateSettings({});
    expect(result).toEqual(DEFAULT_GAME_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// validateSettings — numeric clamping
// ---------------------------------------------------------------------------

describe('validateSettings — numeric clamping', () => {
  it('clamps lives to 1 (below minimum)', () => {
    expect(validateSettings({ lives: 0 }).lives).toBe(1);
    expect(validateSettings({ lives: -5 }).lives).toBe(1);
  });

  it('clamps lives to 9 (above maximum)', () => {
    expect(validateSettings({ lives: 10 }).lives).toBe(9);
    expect(validateSettings({ lives: 100 }).lives).toBe(9);
  });

  it('accepts valid lives values', () => {
    expect(validateSettings({ lives: 1 }).lives).toBe(1);
    expect(validateSettings({ lives: 5 }).lives).toBe(5);
    expect(validateSettings({ lives: 9 }).lives).toBe(9);
  });

  it('rounds fractional lives', () => {
    expect(validateSettings({ lives: 3.7 }).lives).toBe(4);
    expect(validateSettings({ lives: 2.2 }).lives).toBe(2);
  });

  it('clamps difficultyMultiplier to 0.5 min', () => {
    expect(validateSettings({ difficultyMultiplier: 0.1 }).difficultyMultiplier).toBe(0.5);
  });

  it('clamps difficultyMultiplier to 2.0 max', () => {
    expect(validateSettings({ difficultyMultiplier: 5.0 }).difficultyMultiplier).toBe(2.0);
  });

  it('accepts valid difficultyMultiplier', () => {
    expect(validateSettings({ difficultyMultiplier: 1.5 }).difficultyMultiplier).toBe(1.5);
  });

  it('clamps enemySpawnRateMultiplier to 0.25 min', () => {
    expect(validateSettings({ enemySpawnRateMultiplier: 0.1 }).enemySpawnRateMultiplier).toBe(0.25);
  });

  it('clamps enemySpawnRateMultiplier to 3.0 max', () => {
    expect(validateSettings({ enemySpawnRateMultiplier: 10 }).enemySpawnRateMultiplier).toBe(3.0);
  });

  it('clamps bossFrequency to [0, 1]', () => {
    expect(validateSettings({ bossFrequency: -1 }).bossFrequency).toBe(0);
    expect(validateSettings({ bossFrequency: 5 }).bossFrequency).toBe(1);
    expect(validateSettings({ bossFrequency: 0.3 }).bossFrequency).toBe(0.3);
  });

  it('clamps healingFrequency to [5, 120]', () => {
    expect(validateSettings({ healingFrequency: 1 }).healingFrequency).toBe(5);
    expect(validateSettings({ healingFrequency: 200 }).healingFrequency).toBe(120);
    expect(validateSettings({ healingFrequency: 60 }).healingFrequency).toBe(60);
  });

  it('clamps healingAmount to [5, 100]', () => {
    expect(validateSettings({ healingAmount: 0 }).healingAmount).toBe(5);
    expect(validateSettings({ healingAmount: 150 }).healingAmount).toBe(100);
    expect(validateSettings({ healingAmount: 50 }).healingAmount).toBe(50);
  });

  it('clamps weaponSpawnFrequency to [0.1, 3.0]', () => {
    expect(validateSettings({ weaponSpawnFrequency: 0 }).weaponSpawnFrequency).toBe(0.1);
    expect(validateSettings({ weaponSpawnFrequency: 5 }).weaponSpawnFrequency).toBe(3.0);
  });

  it('clamps buffSpawnFrequency to [0.1, 3.0]', () => {
    expect(validateSettings({ buffSpawnFrequency: 0 }).buffSpawnFrequency).toBe(0.1);
    expect(validateSettings({ buffSpawnFrequency: 99 }).buffSpawnFrequency).toBe(3.0);
  });

  it('allows timeLimit = 0 (unlimited)', () => {
    expect(validateSettings({ timeLimit: 0 }).timeLimit).toBe(0);
  });

  it('clamps non-zero timeLimit to [60, 3600]', () => {
    expect(validateSettings({ timeLimit: 10 }).timeLimit).toBe(60);
    expect(validateSettings({ timeLimit: 5000 }).timeLimit).toBe(3600);
    expect(validateSettings({ timeLimit: 300 }).timeLimit).toBe(300);
  });

  it('clamps enemyCountCap to [10, 100]', () => {
    expect(validateSettings({ enemyCountCap: 5 }).enemyCountCap).toBe(10);
    expect(validateSettings({ enemyCountCap: 200 }).enemyCountCap).toBe(100);
    expect(validateSettings({ enemyCountCap: 40 }).enemyCountCap).toBe(40);
  });

  it('clamps bulletCountCap to [50, 1000]', () => {
    expect(validateSettings({ bulletCountCap: 10 }).bulletCountCap).toBe(50);
    expect(validateSettings({ bulletCountCap: 9999 }).bulletCountCap).toBe(1000);
    expect(validateSettings({ bulletCountCap: 200 }).bulletCountCap).toBe(200);
  });

  it('uses default when numeric value is NaN', () => {
    expect(validateSettings({ lives: NaN }).lives).toBe(DEFAULT_GAME_SETTINGS.lives);
    expect(validateSettings({ difficultyMultiplier: NaN }).difficultyMultiplier).toBe(DEFAULT_GAME_SETTINGS.difficultyMultiplier);
  });

  it('uses default when numeric value is Infinity', () => {
    expect(validateSettings({ lives: Infinity }).lives).toBe(DEFAULT_GAME_SETTINGS.lives);
  });
});

// ---------------------------------------------------------------------------
// validateSettings — invalid mode/surface strings
// ---------------------------------------------------------------------------

describe('validateSettings — invalid mode strings', () => {
  it('rejects unknown mode string and falls back to default', () => {
    expect(validateSettings({ mode: 'deathmatch' as GameMode }).mode).toBe('waves');
    expect(validateSettings({ mode: '' as GameMode }).mode).toBe('waves');
    expect(validateSettings({ mode: 'WAVES' as GameMode }).mode).toBe('waves'); // case-sensitive
  });

  it('accepts all valid modes', () => {
    for (const mode of VALID_MODES) {
      expect(validateSettings({ mode }).mode).toBe(mode);
    }
  });

  it('rejects undefined mode and falls back to default', () => {
    const result = validateSettings({ mode: undefined });
    expect(result.mode).toBe('waves');
  });
});

describe('validateSettings — invalid surface strings', () => {
  it('rejects unknown surface and falls back to default', () => {
    expect(validateSettings({ surface: 'donut' as GameSurface }).surface).toBe('sphere');
    expect(validateSettings({ surface: '' as GameSurface }).surface).toBe('sphere');
    expect(validateSettings({ surface: 'custom' as GameSurface }).surface).toBe('sphere'); // custom not allowed server-side
  });

  it('accepts all valid surfaces', () => {
    for (const surface of VALID_SURFACES) {
      expect(validateSettings({ surface }).surface).toBe(surface);
    }
  });
});

// ---------------------------------------------------------------------------
// validateSettings — PvP settings stripped in non-pvp modes
// ---------------------------------------------------------------------------

describe('validateSettings — PvP settings stripped in non-PvP modes', () => {
  const nonPvpModes: GameMode[] = ['waves', 'king', 'sniper', 'rainbow', 'claustrophobia'];

  it('strips pvpEnabled to false for non-pvp modes', () => {
    for (const mode of nonPvpModes) {
      const result = validateSettings({ mode, pvpEnabled: true });
      expect(result.pvpEnabled).toBe(false);
    }
  });

  it('strips friendlyFire to false for non-pvp modes', () => {
    for (const mode of nonPvpModes) {
      const result = validateSettings({ mode, friendlyFire: true });
      expect(result.friendlyFire).toBe(false);
    }
  });

  it('strips pvpWinCondition to default for non-pvp modes', () => {
    for (const mode of nonPvpModes) {
      const result = validateSettings({ mode, pvpWinCondition: 'score' });
      expect(result.pvpWinCondition).toBe(DEFAULT_GAME_SETTINGS.pvpWinCondition);
    }
  });

  it('preserves pvpEnabled in pvp mode', () => {
    expect(validateSettings({ mode: 'pvp', pvpEnabled: true }).pvpEnabled).toBe(true);
    expect(validateSettings({ mode: 'pvpve', pvpEnabled: true }).pvpEnabled).toBe(true);
  });

  it('preserves pvpWinCondition in pvp mode', () => {
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'score' }).pvpWinCondition).toBe('score');
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'survival' }).pvpWinCondition).toBe('survival');
  });

  it('preserves friendlyFire in pvpve mode', () => {
    expect(validateSettings({ mode: 'pvpve', friendlyFire: true }).friendlyFire).toBe(true);
  });

  it('rejects invalid pvpWinCondition and falls back to default', () => {
    expect(validateSettings({ mode: 'pvp', pvpWinCondition: 'deathmatch' as 'kills' }).pvpWinCondition).toBe('kills');
  });

  it('PVP_MODES contains only pvp and pvpve', () => {
    expect(PVP_MODES).toContain('pvp');
    expect(PVP_MODES).toContain('pvpve');
    expect(PVP_MODES.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// validateSettings — miscellaneous field validation
// ---------------------------------------------------------------------------

describe('validateSettings — other fields', () => {
  it('accepts valid healthBarVisibility values', () => {
    for (const v of ['all', 'friendly', 'enemy', 'none'] as const) {
      expect(validateSettings({ healthBarVisibility: v }).healthBarVisibility).toBe(v);
    }
  });

  it('rejects invalid healthBarVisibility and falls back to default', () => {
    expect(validateSettings({ healthBarVisibility: 'hidden' as 'all' }).healthBarVisibility).toBe('all');
  });

  it('accepts valid visualQuality values', () => {
    for (const v of ['low', 'medium', 'high', 'auto'] as const) {
      expect(validateSettings({ visualQuality: v }).visualQuality).toBe(v);
    }
  });

  it('rejects invalid visualQuality and falls back to default', () => {
    expect(validateSettings({ visualQuality: 'ultra' as 'high' }).visualQuality).toBe('auto');
  });

  it('accepts valid startingWeapon values', () => {
    for (const w of VALID_STARTING_WEAPONS) {
      expect(validateSettings({ startingWeapon: w }).startingWeapon).toBe(w);
    }
  });

  it('rejects invalid startingWeapon and falls back to default', () => {
    expect(validateSettings({ startingWeapon: 'super_laser' as 'standard' }).startingWeapon).toBe('standard');
  });

  it('accepts boolean infiniteLives', () => {
    expect(validateSettings({ infiniteLives: true }).infiniteLives).toBe(true);
    expect(validateSettings({ infiniteLives: false }).infiniteLives).toBe(false);
  });

  it('uses default infiniteLives for non-boolean values', () => {
    expect(validateSettings({ infiniteLives: 1 as unknown as boolean }).infiniteLives).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateSettings — result shape
// ---------------------------------------------------------------------------

describe('validateSettings — result shape', () => {
  it('always returns a complete GameSettings object', () => {
    const keys: Array<keyof GameSettings> = [
      'mode', 'surface', 'lives', 'infiniteLives', 'difficultyMultiplier',
      'enemySpawnRateMultiplier', 'bossFrequency', 'pvpEnabled', 'pvpWinCondition',
      'healingFrequency', 'healingAmount', 'healthBarVisibility', 'friendlyFire',
      'weaponSpawnFrequency', 'buffSpawnFrequency', 'startingWeapon', 'timeLimit',
      'enemyCountCap', 'bulletCountCap', 'visualQuality',
    ];
    const result = validateSettings({ lives: -99, mode: 'bad' as GameMode });
    for (const key of keys) {
      expect(result).toHaveProperty(key);
    }
  });

  it('passes through valid partial settings unchanged', () => {
    const partial: Partial<GameSettings> = {
      mode: 'king',
      surface: 'torus',
      lives: 5,
      difficultyMultiplier: 1.5,
      enemyCountCap: 75,
    };
    const result = validateSettings(partial);
    expect(result.mode).toBe('king');
    expect(result.surface).toBe('torus');
    expect(result.lives).toBe(5);
    expect(result.difficultyMultiplier).toBe(1.5);
    expect(result.enemyCountCap).toBe(75);
  });
});
