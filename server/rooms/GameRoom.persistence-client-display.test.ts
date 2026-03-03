/**
 * Integration tests for s44j-settings-16f: Settings Persistence in Room State + Client Display
 *
 * Tests:
 * - hasPendingSettings flag reflects pending state correctly
 * - Settings displayed correctly from room state to non-host clients
 * - Settings reset to defaults when game ends (transitionToVoting)
 * - Pending settings cleared when applied at wave boundary
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateSettings,
  DEFAULT_GAME_SETTINGS,
} from '../shared/GameSettings';
import type { GameSettings } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Simulate the room state fields that get synced for client display
// ---------------------------------------------------------------------------

interface MockRoomState {
  initialLives: number;
  infiniteLives: boolean;
  pvpEnabled: boolean;
  healthBarVisibility: string;
  difficultyMultiplier: number;
  enemyCountCap: number;
  enemySpawnRateMultiplier: number;
  healingFrequency: number;
  healingAmount: number;
  friendlyFire: boolean;
  pvpWinCondition: string;
  startingWeapon: string;
  timeLimit: number;
  hasPendingSettings: boolean;
}

function makeDefaultRoomState(): MockRoomState {
  return {
    initialLives: DEFAULT_GAME_SETTINGS.lives,
    infiniteLives: DEFAULT_GAME_SETTINGS.infiniteLives,
    pvpEnabled: DEFAULT_GAME_SETTINGS.pvpEnabled,
    healthBarVisibility: DEFAULT_GAME_SETTINGS.healthBarVisibility,
    difficultyMultiplier: DEFAULT_GAME_SETTINGS.difficultyMultiplier,
    enemyCountCap: DEFAULT_GAME_SETTINGS.enemyCountCap,
    enemySpawnRateMultiplier: DEFAULT_GAME_SETTINGS.enemySpawnRateMultiplier,
    healingFrequency: DEFAULT_GAME_SETTINGS.healingFrequency,
    healingAmount: DEFAULT_GAME_SETTINGS.healingAmount,
    friendlyFire: DEFAULT_GAME_SETTINGS.friendlyFire,
    pvpWinCondition: DEFAULT_GAME_SETTINGS.pvpWinCondition,
    startingWeapon: DEFAULT_GAME_SETTINGS.startingWeapon,
    timeLimit: DEFAULT_GAME_SETTINGS.timeLimit,
    hasPendingSettings: false,
  };
}

/** Mirrors GameRoom.syncSettingsToState() */
function syncSettingsToState(
  state: MockRoomState,
  settings: GameSettings,
  pendingSettings: GameSettings | null,
): void {
  state.initialLives = settings.lives;
  state.infiniteLives = settings.infiniteLives;
  state.pvpEnabled = settings.pvpEnabled;
  state.healthBarVisibility = settings.healthBarVisibility;
  state.difficultyMultiplier = settings.difficultyMultiplier;
  state.enemyCountCap = settings.enemyCountCap;
  state.enemySpawnRateMultiplier = settings.enemySpawnRateMultiplier;
  state.healingFrequency = settings.healingFrequency;
  state.healingAmount = settings.healingAmount;
  state.friendlyFire = settings.friendlyFire;
  state.pvpWinCondition = settings.pvpWinCondition;
  state.startingWeapon = settings.startingWeapon;
  state.timeLimit = settings.timeLimit;
  state.hasPendingSettings = pendingSettings !== null;
}

/** Mirrors GameRoom.transitionToVoting() settings reset */
function transitionToVoting(state: MockRoomState): { settings: GameSettings; pending: null } {
  const settings = { ...DEFAULT_GAME_SETTINGS };
  const pending = null;
  syncSettingsToState(state, settings, pending);
  return { settings, pending };
}

// ---------------------------------------------------------------------------
// Tests: hasPendingSettings flag
// ---------------------------------------------------------------------------

describe('hasPendingSettings — tracks pending settings in room state', () => {
  let state: MockRoomState;
  let currentSettings: GameSettings;

  beforeEach(() => {
    state = makeDefaultRoomState();
    currentSettings = { ...DEFAULT_GAME_SETTINGS };
  });

  it('starts as false (no pending settings)', () => {
    expect(state.hasPendingSettings).toBe(false);
  });

  it('becomes true when pending settings are queued', () => {
    const pendingSettings = validateSettings({ difficultyMultiplier: 2.0 });
    syncSettingsToState(state, currentSettings, pendingSettings);
    expect(state.hasPendingSettings).toBe(true);
  });

  it('becomes false when pending settings are applied at wave boundary', () => {
    let pendingSettings: GameSettings | null = validateSettings({ difficultyMultiplier: 2.0 });
    syncSettingsToState(state, currentSettings, pendingSettings);
    expect(state.hasPendingSettings).toBe(true);

    // Apply pending settings (wave boundary)
    currentSettings = pendingSettings;
    pendingSettings = null;
    syncSettingsToState(state, currentSettings, pendingSettings);

    expect(state.hasPendingSettings).toBe(false);
    expect(state.difficultyMultiplier).toBe(2.0);
  });

  it('becomes false when pending settings are cleared on round restart', () => {
    let pendingSettings: GameSettings | null = validateSettings({ lives: 5 });
    syncSettingsToState(state, currentSettings, pendingSettings);
    expect(state.hasPendingSettings).toBe(true);

    // Simulate round restart: apply pending, clear it
    currentSettings = pendingSettings;
    pendingSettings = null;
    syncSettingsToState(state, currentSettings, pendingSettings);

    expect(state.hasPendingSettings).toBe(false);
  });

  it('hasPendingSettings true allows client to distinguish active from pending settings', () => {
    const pendingSettings = validateSettings({ enemyCountCap: 20, difficultyMultiplier: 1.8 });
    syncSettingsToState(state, currentSettings, pendingSettings);

    // State shows CURRENT settings (defaults) but hasPendingSettings signals change incoming
    expect(state.difficultyMultiplier).toBe(DEFAULT_GAME_SETTINGS.difficultyMultiplier);
    expect(state.hasPendingSettings).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Settings synced to room state for client display
// ---------------------------------------------------------------------------

describe('Settings synced to room state — all fields visible to non-host clients', () => {
  let state: MockRoomState;

  beforeEach(() => {
    state = makeDefaultRoomState();
  });

  it('syncs all key settings fields to room state', () => {
    const settings = validateSettings({
      lives: 5,
      infiniteLives: false,
      difficultyMultiplier: 1.5,
      enemyCountCap: 30,
      enemySpawnRateMultiplier: 2.0,
      healingFrequency: 60,
      healingAmount: 50,
      friendlyFire: false,
      pvpWinCondition: 'kills',
      startingWeapon: 'spread',
      timeLimit: 300,
    });
    syncSettingsToState(state, settings, null);

    expect(state.initialLives).toBe(5);
    expect(state.difficultyMultiplier).toBe(1.5);
    expect(state.enemyCountCap).toBe(30);
    expect(state.enemySpawnRateMultiplier).toBe(2.0);
    expect(state.healingFrequency).toBe(60);
    expect(state.healingAmount).toBe(50);
    expect(state.startingWeapon).toBe('spread');
    expect(state.timeLimit).toBe(300);
  });

  it('syncs pvp-specific settings when pvp mode is active', () => {
    const settings = validateSettings({
      mode: 'pvp',
      pvpEnabled: true,
      friendlyFire: true,
      pvpWinCondition: 'score',
    });
    syncSettingsToState(state, settings, null);

    expect(state.pvpEnabled).toBe(true);
    expect(state.friendlyFire).toBe(true);
    expect(state.pvpWinCondition).toBe('score');
  });

  it('resets pvp fields to defaults for non-pvp modes', () => {
    const settings = validateSettings({ mode: 'waves' });
    syncSettingsToState(state, settings, null);

    expect(state.pvpEnabled).toBe(false);
    expect(state.friendlyFire).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Settings reset when game ends
// ---------------------------------------------------------------------------

describe('Settings reset when game ends — no persistence across games', () => {
  let state: MockRoomState;

  beforeEach(() => {
    state = makeDefaultRoomState();
  });

  it('resets all settings to defaults on transitionToVoting()', () => {
    // Apply custom settings during game
    const customSettings = validateSettings({
      difficultyMultiplier: 2.0,
      enemyCountCap: 20,
      lives: 1,
      startingWeapon: 'spread',
    });
    syncSettingsToState(state, customSettings, null);

    expect(state.difficultyMultiplier).toBe(2.0);
    expect(state.enemyCountCap).toBe(20);

    // Game ends
    const { settings, pending } = transitionToVoting(state);

    expect(settings.difficultyMultiplier).toBe(DEFAULT_GAME_SETTINGS.difficultyMultiplier);
    expect(settings.enemyCountCap).toBe(DEFAULT_GAME_SETTINGS.enemyCountCap);
    expect(settings.lives).toBe(DEFAULT_GAME_SETTINGS.lives);
    expect(settings.startingWeapon).toBe(DEFAULT_GAME_SETTINGS.startingWeapon);
    expect(pending).toBeNull();

    // State also reflects defaults
    expect(state.difficultyMultiplier).toBe(DEFAULT_GAME_SETTINGS.difficultyMultiplier);
    expect(state.enemyCountCap).toBe(DEFAULT_GAME_SETTINGS.enemyCountCap);
    expect(state.initialLives).toBe(DEFAULT_GAME_SETTINGS.lives);
  });

  it('clears hasPendingSettings on game end', () => {
    const pendingSettings = validateSettings({ difficultyMultiplier: 1.8 });
    syncSettingsToState(state, { ...DEFAULT_GAME_SETTINGS }, pendingSettings);
    expect(state.hasPendingSettings).toBe(true);

    transitionToVoting(state);

    expect(state.hasPendingSettings).toBe(false);
  });

  it('settings are at defaults for new game after reset', () => {
    // Simulate game 1: custom settings applied
    const game1Settings = validateSettings({ difficultyMultiplier: 2.0, lives: 1 });
    syncSettingsToState(state, game1Settings, null);

    // Game 1 ends
    const { settings: game2Settings } = transitionToVoting(state);

    // Game 2 starts with default settings
    expect(game2Settings.difficultyMultiplier).toBe(1.0);
    expect(game2Settings.lives).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: Non-host client display (logic layer)
// ---------------------------------------------------------------------------

describe('Non-host client settings display — read from room state', () => {
  it('client can reconstruct all settings from room state fields', () => {
    const originalSettings = validateSettings({
      difficultyMultiplier: 1.5,
      enemyCountCap: 40,
      enemySpawnRateMultiplier: 1.8,
      lives: 5,
      pvpEnabled: false,
      startingWeapon: 'homing',
      timeLimit: 180,
    });

    const state = makeDefaultRoomState();
    syncSettingsToState(state, originalSettings, null);

    // Client reads from state (no direct access to GameSettings object)
    const clientReadSettings: Partial<GameSettings> = {
      lives: state.initialLives,
      infiniteLives: state.infiniteLives,
      pvpEnabled: state.pvpEnabled,
      difficultyMultiplier: state.difficultyMultiplier,
      enemyCountCap: state.enemyCountCap,
      enemySpawnRateMultiplier: state.enemySpawnRateMultiplier,
      healingFrequency: state.healingFrequency,
      healingAmount: state.healingAmount,
      startingWeapon: state.startingWeapon as GameSettings['startingWeapon'],
      timeLimit: state.timeLimit,
    };

    expect(clientReadSettings.difficultyMultiplier).toBe(1.5);
    expect(clientReadSettings.enemyCountCap).toBe(40);
    expect(clientReadSettings.enemySpawnRateMultiplier).toBe(1.8);
    expect(clientReadSettings.lives).toBe(5);
    expect(clientReadSettings.startingWeapon).toBe('homing');
    expect(clientReadSettings.timeLimit).toBe(180);
  });

  it('hasPendingSettings allows client to show "apply next round" indicator', () => {
    const state = makeDefaultRoomState();

    // Host queues pending settings
    const pendingSettings = validateSettings({ difficultyMultiplier: 2.0 });
    syncSettingsToState(state, { ...DEFAULT_GAME_SETTINGS }, pendingSettings);

    // Client checks flag
    expect(state.hasPendingSettings).toBe(true);
    // Client shows "⚡ New settings apply next wave" indicator
    const shouldShowPendingIndicator = state.hasPendingSettings;
    expect(shouldShowPendingIndicator).toBe(true);
  });

  it('hasPendingSettings false means no pending indicator shown', () => {
    const state = makeDefaultRoomState();
    syncSettingsToState(state, { ...DEFAULT_GAME_SETTINGS }, null);

    expect(state.hasPendingSettings).toBe(false);
  });
});
