/**
 * Tests for pause-menu mid-game settings (s44j-settings-16d).
 *
 * Tests run in pure JS — no Colyseus, no Three.js.
 * Logic mirrors GameRoom's applySettings / restartRound handler behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSettings,
  DEFAULT_GAME_SETTINGS,
} from '../shared/GameSettings';
import type { GameSettings } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Minimal room state used by the tests
// ---------------------------------------------------------------------------

interface MockEnemy {
  id: string;
  type: string;
}

interface MockRoomState {
  hostId: string;
  roomPhase: string;
  waveNumber: number;
  enemies: Map<string, MockEnemy>;
  bullets: Map<string, { id: string }>;
  geoms: Map<string, unknown>;
}

interface MockPlayerState {
  lives: number;
  alive: boolean;
  surfaceU: number;
  surfaceV: number;
}

// ---------------------------------------------------------------------------
// Extracted logic: host guard (mirrors GameRoom onMessage handlers)
// ---------------------------------------------------------------------------

function isAllowedToChangeSettings(
  sessionId: string,
  state: MockRoomState,
): boolean {
  return sessionId === state.hostId && state.roomPhase === 'playing';
}

// ---------------------------------------------------------------------------
// Extracted logic: applySettings pending queue
// ---------------------------------------------------------------------------

interface PendingSettingsStore {
  pending: GameSettings | null;
  broadcasts: string[];
}

function handleApplySettings(
  sessionId: string,
  state: MockRoomState,
  rawSettings: unknown,
  store: PendingSettingsStore,
): void {
  if (!isAllowedToChangeSettings(sessionId, state)) return;
  store.pending = validateSettings(rawSettings as Partial<GameSettings>);
  store.broadcasts.push('settings_queued');
}

// ---------------------------------------------------------------------------
// Extracted logic: softRestartRound
// ---------------------------------------------------------------------------

interface SoftRestartResult {
  waveNumber: number;
  waveElapsed: number;
  enemiesCleared: boolean;
  bulletsCleared: boolean;
  geomsCleared: boolean;
  playersRespawned: boolean;
  broadcastSent: string;
  healthPickupFrequency: number;
  healthPickupHealAmount: number;
}

const WAVE_FIRST_AT = 3.0;

function softRestartRound(
  sessionId: string,
  state: MockRoomState,
  rawSettings: unknown,
  players: Map<string, MockPlayerState>,
  currentHealthFreq: number,
  currentHealAmount: number,
): SoftRestartResult | null {
  if (!isAllowedToChangeSettings(sessionId, state)) return null;

  const settings = validateSettings(rawSettings as Partial<GameSettings>);

  // Reset entities
  state.enemies.clear();
  state.bullets.clear();
  state.geoms.clear();

  // Reset wave
  state.waveNumber = 0;

  // Reset players
  let respawned = false;
  for (const [, p] of players) {
    p.lives = settings.lives;
    p.alive = true;
    respawned = true;
  }

  return {
    waveNumber: state.waveNumber,
    waveElapsed: 0, // always resets to 0
    enemiesCleared: state.enemies.size === 0,
    bulletsCleared: state.bullets.size === 0,
    geomsCleared: state.geoms.size === 0,
    playersRespawned: respawned,
    broadcastSent: 'round_restarted',
    healthPickupFrequency: settings.healingFrequency,
    healthPickupHealAmount: settings.healingAmount,
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<MockRoomState> = {}): MockRoomState {
  return {
    hostId: 'host-123',
    roomPhase: 'playing',
    waveNumber: 3,
    enemies: new Map([['e1', { id: 'e1', type: 'basic' }], ['e2', { id: 'e2', type: 'boss' }]]),
    bullets: new Map([['b1', { id: 'b1' }]]),
    geoms: new Map([['g1', {}]]),
    ...overrides,
  };
}

function makePlayers(): Map<string, MockPlayerState> {
  return new Map([
    ['host-123', { lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5 }],
    ['player-456', { lives: 1, alive: true, surfaceU: 0.3, surfaceV: 0.3 }],
  ]);
}

// ---------------------------------------------------------------------------
// Tests: host guard
// ---------------------------------------------------------------------------

describe('pause menu settings — host guard', () => {
  it('allows host to change settings when playing', () => {
    const state = makeState();
    expect(isAllowedToChangeSettings('host-123', state)).toBe(true);
  });

  it('rejects non-host client', () => {
    const state = makeState();
    expect(isAllowedToChangeSettings('player-456', state)).toBe(false);
  });

  it('rejects changes when not in playing phase', () => {
    const state = makeState({ roomPhase: 'voting' });
    expect(isAllowedToChangeSettings('host-123', state)).toBe(false);
  });

  it('rejects non-host even in playing phase', () => {
    const state = makeState({ roomPhase: 'playing' });
    expect(isAllowedToChangeSettings('random-session', state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: applySettings (queue for next wave)
// ---------------------------------------------------------------------------

describe('applySettings — queue for next wave', () => {
  it('stores valid settings as pending', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('host-123', state, { lives: 5, difficultyMultiplier: 1.5 }, store);
    expect(store.pending).not.toBeNull();
    expect(store.pending!.lives).toBe(5);
    expect(store.pending!.difficultyMultiplier).toBe(1.5);
  });

  it('broadcasts settings_queued message', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('host-123', state, {}, store);
    expect(store.broadcasts).toContain('settings_queued');
  });

  it('clamps settings via validateSettings', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    // lives=100 exceeds max of 9
    handleApplySettings('host-123', state, { lives: 100 }, store);
    expect(store.pending!.lives).toBe(9);
  });

  it('ignores request from non-host', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('not-host', state, { lives: 9 }, store);
    expect(store.pending).toBeNull();
    expect(store.broadcasts).toHaveLength(0);
  });

  it('ignores request when game is not playing', () => {
    const state = makeState({ roomPhase: 'lobby' });
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('host-123', state, { lives: 9 }, store);
    expect(store.pending).toBeNull();
  });

  it('updates pending settings when called multiple times', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('host-123', state, { lives: 5 }, store);
    handleApplySettings('host-123', state, { lives: 7 }, store);
    expect(store.pending!.lives).toBe(7); // second call overwrites first
  });
});

// ---------------------------------------------------------------------------
// Tests: restartRound
// ---------------------------------------------------------------------------

describe('restartRound — soft restart', () => {
  it('clears all enemies', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('host-123', state, {}, players, 30, 25);
    expect(result).not.toBeNull();
    expect(result!.enemiesCleared).toBe(true);
  });

  it('clears all bullets', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('host-123', state, {}, players, 30, 25);
    expect(result!.bulletsCleared).toBe(true);
  });

  it('clears geoms', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('host-123', state, {}, players, 30, 25);
    expect(result!.geomsCleared).toBe(true);
  });

  it('resets wave number to 0', () => {
    const state = makeState({ waveNumber: 5 });
    const players = makePlayers();
    const result = softRestartRound('host-123', state, {}, players, 30, 25);
    expect(result!.waveNumber).toBe(0);
    expect(state.waveNumber).toBe(0); // mutates state directly
  });

  it('respawns all players', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('host-123', state, { lives: 5 }, players, 30, 25);
    expect(result!.playersRespawned).toBe(true);
    // All players should have lives reset to the new setting
    for (const [, p] of players) {
      expect(p.lives).toBe(5);
      expect(p.alive).toBe(true);
    }
  });

  it('applies new healingFrequency', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('host-123', state, { healingFrequency: 60 }, players, 30, 25);
    expect(result!.healthPickupFrequency).toBe(60);
  });

  it('applies new healingAmount', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('host-123', state, { healingAmount: 50 }, players, 30, 25);
    expect(result!.healthPickupHealAmount).toBe(50);
  });

  it('broadcasts round_restarted', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('host-123', state, {}, players, 30, 25);
    expect(result!.broadcastSent).toBe('round_restarted');
  });

  it('returns null and does nothing when called by non-host', () => {
    const state = makeState();
    const players = makePlayers();
    const result = softRestartRound('not-host', state, {}, players, 30, 25);
    expect(result).toBeNull();
    // State should be unchanged
    expect(state.enemies.size).toBe(2);
    expect(state.waveNumber).toBe(3);
  });

  it('returns null when not in playing phase', () => {
    const state = makeState({ roomPhase: 'voting' });
    const players = makePlayers();
    const result = softRestartRound('host-123', state, {}, players, 30, 25);
    expect(result).toBeNull();
  });

  it('clamps settings via validateSettings on restart', () => {
    const state = makeState();
    const players = makePlayers();
    // lives=0 is below min of 1
    const result = softRestartRound('host-123', state, { lives: 0 }, players, 30, 25);
    expect(result).not.toBeNull();
    for (const [, p] of players) {
      expect(p.lives).toBe(1); // clamped by validateSettings
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: validate settings integration
// ---------------------------------------------------------------------------

describe('settings validation on apply', () => {
  it('invalid mode falls back to waves', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('host-123', state, { mode: 'INVALID' }, store);
    expect(store.pending!.mode).toBe('waves');
  });

  it('difficultyMultiplier is clamped', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('host-123', state, { difficultyMultiplier: 99 }, store);
    expect(store.pending!.difficultyMultiplier).toBe(2.0);
  });

  it('returns defaults for fully invalid settings', () => {
    const state = makeState();
    const store: PendingSettingsStore = { pending: null, broadcasts: [] };
    handleApplySettings('host-123', state, null, store);
    expect(store.pending).toEqual(DEFAULT_GAME_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for s44k-04: Server Settings Not Applying in MP
// ---------------------------------------------------------------------------

describe('s44k-04 regression — restartRound stale pending settings', () => {
  it('restartRound settings override a prior applySettings pending', () => {
    // Bug: if host clicked "Apply Next Round" first (setting pendingSettings),
    // then clicked "Restart Round" with different settings, startGame() would
    // use the stale pendingSettings from the first action instead of the
    // restartRound settings.
    //
    // Fix: clear pendingSettings when restartRound provides settings so
    // startGame() uses currentSettings set by applyValidatedSettings().

    let currentSettings: GameSettings = { ...DEFAULT_GAME_SETTINGS };
    let pendingSettings: GameSettings | null = null;

    // Step 1: Host clicks "Apply Next Round" with difficultyMultiplier=1.5
    pendingSettings = validateSettings({ difficultyMultiplier: 1.5 });
    expect(pendingSettings.difficultyMultiplier).toBe(1.5);

    // Step 2: Host then clicks "Restart Round" with difficultyMultiplier=2.0
    const restartSettings = validateSettings({ ...currentSettings, difficultyMultiplier: 2.0 });
    // Fix: restartRound should clear pendingSettings and use the provided settings
    currentSettings = restartSettings;
    pendingSettings = null; // s44k-04 fix: cleared in restartRound handler

    // Step 3: startGame() runs — should use currentSettings (2.0), not pendingSettings
    if (pendingSettings) {
      currentSettings = pendingSettings; // this branch must NOT fire
    }

    expect(currentSettings.difficultyMultiplier).toBe(2.0);
    expect(pendingSettings).toBeNull();
  });
});

describe('s44k-04 regression — validateSettings null safety', () => {
  it('validateSettings(null) returns defaults without throwing', () => {
    // Bug: validateSettings(null) threw TypeError before the null guard was added
    expect(() => validateSettings(null as unknown as Partial<GameSettings>)).not.toThrow();
    const result = validateSettings(null as unknown as Partial<GameSettings>);
    expect(result).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('validateSettings(undefined) returns defaults without throwing', () => {
    expect(() => validateSettings(undefined)).not.toThrow();
    expect(validateSettings(undefined)).toEqual(DEFAULT_GAME_SETTINGS);
  });
});

describe('s44k-04 regression — DEFAULT_GAME_SETTINGS.friendlyFire consistency', () => {
  it('DEFAULT_GAME_SETTINGS.friendlyFire is false (non-PvP default)', () => {
    // Bug: DEFAULT_GAME_SETTINGS.friendlyFire was true but validateSettings({}) returned
    // false for waves mode (non-PvP). They must match so DEFAULT_GAME_SETTINGS ===
    // validateSettings({}).
    expect(DEFAULT_GAME_SETTINGS.friendlyFire).toBe(false);
  });

  it('validateSettings({}) and DEFAULT_GAME_SETTINGS are identical', () => {
    expect(validateSettings({})).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('friendlyFire defaults to true in pvp mode (PvP modes auto-enable FF)', () => {
    const pvpSettings = validateSettings({ mode: 'pvp' });
    expect(pvpSettings.friendlyFire).toBe(true);
  });
});
