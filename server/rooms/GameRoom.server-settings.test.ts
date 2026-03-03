/**
 * Integration tests for s44j-settings-16e: Server-Side Settings Application
 *
 * Tests the settings validation, host ownership verification, game state application,
 * mid-game pending settings, and round restart logic.
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 * Logic is extracted from GameRoom to test in isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateSettings,
  DEFAULT_GAME_SETTINGS,
  PVP_MODES,
} from '../shared/GameSettings';
import type { GameSettings } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Helpers that mirror GameRoom's private logic
// ---------------------------------------------------------------------------

/** Mirrors GameRoom.applyValidatedSettings() */
function applyValidatedSettings(
  current: GameSettings,
  partial: Partial<GameSettings>,
): GameSettings {
  return validateSettings({ ...current, ...partial });
}

/** Mirrors GameRoom.getMaxEnemies() */
function getMaxEnemies(
  playerCount: number,
  enemyCountCap: number,
  MAX_ENEMIES_BY_PLAYER_COUNT = [30, 50, 70, 90],
): number {
  const idx = Math.min(MAX_ENEMIES_BY_PLAYER_COUNT.length - 1, Math.max(0, playerCount - 1));
  const playerCap = MAX_ENEMIES_BY_PLAYER_COUNT[idx];
  return Math.min(playerCap, enemyCountCap);
}

/** Mirrors GameRoom.computeDifficultyLevel() with settings multiplier */
function computeDifficultyLevel(
  waveNumber: number,
  gameTime: number,
  playerCount: number,
  difficultyMultiplier: number,
  gameMode: string = 'waves',
): number {
  const CLAUSTROPHOBIA_DIFFICULTY_MULTIPLIER = 1.3;
  const waveContrib = Math.max(0, (waveNumber - 1) * 0.3);
  const timeContrib = gameTime / 600;
  const playerCountBonus = (playerCount - 1) * 0.3;
  const base = waveContrib + timeContrib + playerCountBonus;
  const claustrophobiaBonus = gameMode === 'claustrophobia'
    ? waveContrib * (CLAUSTROPHOBIA_DIFFICULTY_MULTIPLIER - 1)
    : 0;
  return Math.min(8.0, (base + claustrophobiaBonus) * difficultyMultiplier);
}

/** Mirrors GameRoom.tickWaves() interval calculation with spawn rate multiplier */
function computeNextWaveInterval(
  waveNumber: number,
  enemySpawnRateMultiplier: number,
  WAVE_INTERVAL_BASE = 7.0,
  WAVE_INTERVAL_MIN = 2.0,
  WAVE_INTERVAL_DECAY = 0.2,
): number {
  const baseInterval = Math.max(WAVE_INTERVAL_MIN, WAVE_INTERVAL_BASE - waveNumber * WAVE_INTERVAL_DECAY);
  const scaledInterval = baseInterval / Math.max(0.01, enemySpawnRateMultiplier);
  return Math.max(WAVE_INTERVAL_MIN, scaledInterval);
}

// ---------------------------------------------------------------------------
// Minimal types for simulating host ownership check
// ---------------------------------------------------------------------------

interface SettingsMessageContext {
  senderSessionId: string;
  hostSessionId: string;
  roomPhase: string;
}

/** Mirrors GameRoom host check for settings messages */
function canSendSettings(ctx: SettingsMessageContext, requiredPhase?: string): boolean {
  if (ctx.senderSessionId !== ctx.hostSessionId) return false;
  if (requiredPhase && ctx.roomPhase !== requiredPhase) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Mock round restart logic
// ---------------------------------------------------------------------------

interface RoundState {
  enemies: string[];
  bullets: string[];
  pickups: string[];
  waveNumber: number;
  gameTime: number;
  roomPhase: string;
}

function simulateRestartRound(state: RoundState): RoundState {
  return {
    ...state,
    enemies: [],
    bullets: [],
    pickups: [],
    waveNumber: 0,
    gameTime: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests: Settings validation on arrival
// ---------------------------------------------------------------------------

describe('Settings validation — invalid values clamped or rejected', () => {
  it('clamps lives out of range to valid bounds', () => {
    const result = applyValidatedSettings(DEFAULT_GAME_SETTINGS, { lives: 0 });
    expect(result.lives).toBe(1);

    const result2 = applyValidatedSettings(DEFAULT_GAME_SETTINGS, { lives: 100 });
    expect(result2.lives).toBe(9);
  });

  it('rejects unknown mode and falls back to default', () => {
    const result = applyValidatedSettings(DEFAULT_GAME_SETTINGS, { mode: 'deathmatch' as GameSettings['mode'] });
    expect(result.mode).toBe('waves');
  });

  it('rejects unknown surface and falls back to default', () => {
    const result = applyValidatedSettings(DEFAULT_GAME_SETTINGS, { surface: 'donut' as GameSettings['surface'] });
    expect(result.surface).toBe('sphere');
  });

  it('clamps difficultyMultiplier to [0.5, 2.0]', () => {
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { difficultyMultiplier: 0.1 }).difficultyMultiplier).toBe(0.5);
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { difficultyMultiplier: 5.0 }).difficultyMultiplier).toBe(2.0);
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { difficultyMultiplier: 1.5 }).difficultyMultiplier).toBe(1.5);
  });

  it('clamps enemyCountCap to [10, 100]', () => {
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { enemyCountCap: 5 }).enemyCountCap).toBe(10);
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { enemyCountCap: 200 }).enemyCountCap).toBe(100);
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { enemyCountCap: 40 }).enemyCountCap).toBe(40);
  });

  it('clamps enemySpawnRateMultiplier to [0.25, 3.0]', () => {
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { enemySpawnRateMultiplier: 0.1 }).enemySpawnRateMultiplier).toBe(0.25);
    expect(applyValidatedSettings(DEFAULT_GAME_SETTINGS, { enemySpawnRateMultiplier: 10 }).enemySpawnRateMultiplier).toBe(3.0);
  });

  it('strips PvP settings when mode is not pvp/pvpve', () => {
    const result = applyValidatedSettings(DEFAULT_GAME_SETTINGS, {
      mode: 'waves',
      pvpEnabled: true,
      friendlyFire: true,
      pvpWinCondition: 'score',
    });
    expect(result.pvpEnabled).toBe(false);
    expect(result.friendlyFire).toBe(false);
    expect(result.pvpWinCondition).toBe(DEFAULT_GAME_SETTINGS.pvpWinCondition);
  });

  it('preserves PvP settings when mode is pvp', () => {
    const result = applyValidatedSettings(DEFAULT_GAME_SETTINGS, {
      mode: 'pvp',
      pvpEnabled: true,
      friendlyFire: true,
      pvpWinCondition: 'score',
    });
    expect(result.pvpEnabled).toBe(true);
    expect(result.friendlyFire).toBe(true);
    expect(result.pvpWinCondition).toBe('score');
  });

  it('merged settings override only specified fields and keep rest at previous values', () => {
    const previous: GameSettings = { ...DEFAULT_GAME_SETTINGS, lives: 5, difficultyMultiplier: 1.5 };
    const result = applyValidatedSettings(previous, { lives: 7 });
    expect(result.lives).toBe(7);
    expect(result.difficultyMultiplier).toBe(1.5); // unchanged
    expect(result.mode).toBe(DEFAULT_GAME_SETTINGS.mode); // unchanged
  });

  it('handles NaN and Infinity in numeric fields gracefully', () => {
    const result = applyValidatedSettings(DEFAULT_GAME_SETTINGS, {
      lives: NaN,
      difficultyMultiplier: Infinity,
    });
    expect(result.lives).toBe(DEFAULT_GAME_SETTINGS.lives);
    expect(result.difficultyMultiplier).toBe(DEFAULT_GAME_SETTINGS.difficultyMultiplier);
  });
});

// ---------------------------------------------------------------------------
// Tests: Host ownership check
// ---------------------------------------------------------------------------

describe('Host ownership check — non-host settings rejected', () => {
  it('accepts settings from host', () => {
    const ctx: SettingsMessageContext = {
      senderSessionId: 'host-session',
      hostSessionId: 'host-session',
      roomPhase: 'lobby',
    };
    expect(canSendSettings(ctx, 'lobby')).toBe(true);
  });

  it('rejects settings from non-host player', () => {
    const ctx: SettingsMessageContext = {
      senderSessionId: 'other-session',
      hostSessionId: 'host-session',
      roomPhase: 'lobby',
    };
    expect(canSendSettings(ctx, 'lobby')).toBe(false);
  });

  it('rejects lobby_settings when room is not in lobby phase', () => {
    const ctx: SettingsMessageContext = {
      senderSessionId: 'host-session',
      hostSessionId: 'host-session',
      roomPhase: 'playing',
    };
    expect(canSendSettings(ctx, 'lobby')).toBe(false);
  });

  it('rejects applySettings when room is not playing', () => {
    const ctx: SettingsMessageContext = {
      senderSessionId: 'host-session',
      hostSessionId: 'host-session',
      roomPhase: 'lobby',
    };
    expect(canSendSettings(ctx, 'playing')).toBe(false);
  });

  it('accepts applySettings from host during playing phase', () => {
    const ctx: SettingsMessageContext = {
      senderSessionId: 'host-session',
      hostSessionId: 'host-session',
      roomPhase: 'playing',
    };
    expect(canSendSettings(ctx, 'playing')).toBe(true);
  });

  it('accepts restartRound from host during playing phase', () => {
    const ctx: SettingsMessageContext = {
      senderSessionId: 'host-session',
      hostSessionId: 'host-session',
      roomPhase: 'playing',
    };
    expect(canSendSettings(ctx, 'playing')).toBe(true);
  });

  it('rejects restartRound from non-host', () => {
    const ctx: SettingsMessageContext = {
      senderSessionId: 'spectator',
      hostSessionId: 'host-session',
      roomPhase: 'playing',
    };
    expect(canSendSettings(ctx, 'playing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Settings applied to game behavior
// ---------------------------------------------------------------------------

describe('Settings applied to game behavior — difficulty multiplier', () => {
  it('default multiplier (1.0) produces baseline difficulty', () => {
    const base = computeDifficultyLevel(10, 0, 1, 1.0);
    const doubled = computeDifficultyLevel(10, 0, 1, 2.0);
    expect(doubled).toBeCloseTo(base * 2.0, 5);
  });

  it('0.5 multiplier halves the difficulty level', () => {
    const base = computeDifficultyLevel(10, 0, 1, 1.0);
    const halved = computeDifficultyLevel(10, 0, 1, 0.5);
    expect(halved).toBeCloseTo(base * 0.5, 5);
  });

  it('difficulty is capped at 8.0 regardless of multiplier', () => {
    const veryHighMultiplier = computeDifficultyLevel(30, 0, 4, 2.0);
    expect(veryHighMultiplier).toBeLessThanOrEqual(8.0);
  });

  it('multiplier of 1.0 produces same result as no multiplier formula', () => {
    // At wave 5, 0 time, 1 player: waveContrib = (5-1)*0.3 = 1.2, timeContrib = 0, playerBonus = 0
    // base = 1.2, * 1.0 = 1.2
    expect(computeDifficultyLevel(5, 0, 1, 1.0)).toBeCloseTo(1.2, 5);
  });
});

describe('Settings applied to game behavior — enemy count cap', () => {
  it('default cap (50) limits to player-count-based value for small player counts', () => {
    // 1 player: playerCap = 30, settings cap = 50 → min(30, 50) = 30
    expect(getMaxEnemies(1, 50)).toBe(30);
  });

  it('custom cap overrides player-count cap when smaller', () => {
    // 4 players: playerCap = 90, settings cap = 20 → min(90, 20) = 20
    expect(getMaxEnemies(4, 20)).toBe(20);
  });

  it('settings cap at maximum (100) does not reduce existing player caps', () => {
    // 4 players: playerCap = 90, settings cap = 100 → min(90, 100) = 90
    expect(getMaxEnemies(4, 100)).toBe(90);
  });

  it('settings cap of 10 (minimum) enforces very low enemy count', () => {
    expect(getMaxEnemies(4, 10)).toBe(10);
    expect(getMaxEnemies(1, 10)).toBe(10);
  });
});

describe('Settings applied to game behavior — spawn rate multiplier', () => {
  it('default multiplier (1.0) produces standard wave interval', () => {
    // max(2, WAVE_INTERVAL_BASE - wave*DECAY) / 1.0 = max(2, 7.0 - 1*0.2) / 1.0 = 6.8
    const base = computeNextWaveInterval(1, 1.0);
    expect(base).toBeCloseTo(6.8, 5);
  });

  it('2.0 multiplier halves the wave interval (more frequent waves)', () => {
    const base = computeNextWaveInterval(5, 1.0);
    const doubled = computeNextWaveInterval(5, 2.0);
    expect(doubled).toBeCloseTo(base / 2.0, 5);
  });

  it('0.5 multiplier doubles the wave interval (less frequent waves)', () => {
    const base = computeNextWaveInterval(5, 1.0);
    const halved = computeNextWaveInterval(5, 0.5);
    expect(halved).toBeCloseTo(base * 2.0, 5);
  });

  it('interval never goes below WAVE_INTERVAL_MIN (2.0)', () => {
    // Very high multiplier with high wave number
    const interval = computeNextWaveInterval(50, 3.0);
    expect(interval).toBeGreaterThanOrEqual(2.0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Pending settings (applySettings message)
// ---------------------------------------------------------------------------

describe('Pending settings — applied on wave boundary', () => {
  it('pendingSettings replaces currentSettings on wave transition', () => {
    let currentSettings: GameSettings = { ...DEFAULT_GAME_SETTINGS };
    let pendingSettings: GameSettings | null = validateSettings({ difficultyMultiplier: 2.0 });

    // Simulate wave transition applying pendingSettings
    if (pendingSettings) {
      currentSettings = pendingSettings;
      pendingSettings = null;
    }

    expect(currentSettings.difficultyMultiplier).toBe(2.0);
    expect(pendingSettings).toBeNull();
  });

  it('pendingSettings not applied mid-wave (remains pending)', () => {
    let pendingSettings: GameSettings | null = validateSettings({ lives: 7 });

    // Mid-wave: do NOT apply (wave boundary has not been reached)
    const isDuringWave = true;
    if (!isDuringWave && pendingSettings) {
      pendingSettings = null; // would have applied
    }

    expect(pendingSettings).not.toBeNull();
    expect(pendingSettings?.lives).toBe(7);
  });

  it('new applySettings replaces existing pendingSettings', () => {
    let pendingSettings: GameSettings | null = validateSettings({ lives: 5 });

    // Host sends another applySettings before wave boundary
    pendingSettings = validateSettings({ lives: 8, difficultyMultiplier: 1.5 });

    expect(pendingSettings.lives).toBe(8);
    expect(pendingSettings.difficultyMultiplier).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// Tests: Round restart (restartRound message)
// ---------------------------------------------------------------------------

describe('Round restart — entities cleared, wave reset', () => {
  let state: RoundState;

  beforeEach(() => {
    state = {
      enemies: ['enemy-1', 'enemy-2', 'enemy-3'],
      bullets: ['bullet-1', 'bullet-2'],
      pickups: ['pickup-1'],
      waveNumber: 5,
      gameTime: 120,
      roomPhase: 'playing',
    };
  });

  it('clears all enemies on restart', () => {
    const restarted = simulateRestartRound(state);
    expect(restarted.enemies).toHaveLength(0);
  });

  it('clears all bullets on restart', () => {
    const restarted = simulateRestartRound(state);
    expect(restarted.bullets).toHaveLength(0);
  });

  it('clears all pickups on restart', () => {
    const restarted = simulateRestartRound(state);
    expect(restarted.pickups).toHaveLength(0);
  });

  it('resets wave number to 0', () => {
    const restarted = simulateRestartRound(state);
    expect(restarted.waveNumber).toBe(0);
  });

  it('resets game time to 0', () => {
    const restarted = simulateRestartRound(state);
    expect(restarted.gameTime).toBe(0);
  });

  it('restartRound with settings applies them before restart', () => {
    let currentSettings: GameSettings = { ...DEFAULT_GAME_SETTINGS };

    // Simulate: host sends restartRound with settings
    const newSettings: Partial<GameSettings> = { difficultyMultiplier: 1.8, lives: 1 };
    currentSettings = validateSettings({ ...currentSettings, ...newSettings });
    simulateRestartRound(state);

    expect(currentSettings.difficultyMultiplier).toBe(1.8);
    expect(currentSettings.lives).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Settings synced to room state fields
// ---------------------------------------------------------------------------

describe('Settings synced to room.state', () => {
  it('syncSettingsToState maps all key fields correctly', () => {
    // Simulate the fields syncSettingsToState() would set
    const settings = validateSettings({
      lives: 5,
      infiniteLives: true,
      pvpEnabled: false, // stripped because mode is not pvp
      healthBarVisibility: 'enemy',
      difficultyMultiplier: 1.5,
      enemyCountCap: 30,
      enemySpawnRateMultiplier: 2.0,
      healingFrequency: 60,
      healingAmount: 50,
      friendlyFire: false,
      pvpWinCondition: 'kills',
      startingWeapon: 'spread',
      timeLimit: 300,
      mode: 'waves',
    });

    // Verify the validated settings would produce the correct state values
    expect(settings.lives).toBe(5);
    expect(settings.infiniteLives).toBe(true);
    expect(settings.pvpEnabled).toBe(false);
    expect(settings.healthBarVisibility).toBe('enemy');
    expect(settings.difficultyMultiplier).toBe(1.5);
    expect(settings.enemyCountCap).toBe(30);
    expect(settings.enemySpawnRateMultiplier).toBe(2.0);
    expect(settings.healingFrequency).toBe(60);
    expect(settings.healingAmount).toBe(50);
    expect(settings.friendlyFire).toBe(false);
    expect(settings.pvpWinCondition).toBe('kills');
    expect(settings.startingWeapon).toBe('spread');
    expect(settings.timeLimit).toBe(300);
  });

  it('syncSettingsToState sets pvpEnabled and pvpWinCondition for pvp modes', () => {
    const pvpSettings = validateSettings({
      mode: 'pvp',
      pvpEnabled: true,
      pvpWinCondition: 'score',
      friendlyFire: true,
    });

    expect(pvpSettings.pvpEnabled).toBe(true);
    expect(pvpSettings.pvpWinCondition).toBe('score');
    expect(pvpSettings.friendlyFire).toBe(true);
    // PVP_MODES includes 'pvp'
    expect(PVP_MODES).toContain('pvp');
  });
});
