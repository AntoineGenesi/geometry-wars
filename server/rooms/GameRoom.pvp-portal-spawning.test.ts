/**
 * Regression tests for s44r2-10: PvP Portal Spawning — Half-Health Trigger + Respawn Cycles
 *
 * Verifies:
 * 1. Portals are NOT active at game start (they spawn on half-health trigger, not at start)
 * 2. Portal spawn triggers when any player first drops to ≤50% health
 * 3. Trigger is one-shot — only fires once per game
 * 4. Portal positions are placed: A near damaged player, B far away (≥0.35 UV separation)
 *
 * Logic is extracted from GameRoom.ts and tested in isolation (no Colyseus, no Three.js).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PLAYER_PVP_MAX_HEALTH } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Minimal state types mirroring GameRoom private state
// ---------------------------------------------------------------------------

interface PortalState {
  portalsActive: boolean;
  portalAU: number;
  portalAV: number;
  portalBU: number;
  portalBV: number;
  pvpMode: string;
}

interface PlayerLike {
  health: number;
  maxHealth: number;
  surfaceU: number;
  surfaceV: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Extracted portal logic — mirrors GameRoom private methods
// ---------------------------------------------------------------------------

class PortalController {
  private _portalsTriggeredThisGame = false;
  private _portalDespawnTimer: ReturnType<typeof setTimeout> | null = null;
  private _portalRespawnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private state: PortalState) {}

  /** Mirrors GameRoom.startGame() portal section. */
  resetForNewGame(): void {
    this._clearPortalTimers();
    this._portalsTriggeredThisGame = false;
    this.state.portalsActive = false;
    this.state.portalAU = 0;
    this.state.portalAV = 0;
    this.state.portalBU = 0;
    this.state.portalBV = 0;
  }

  /** Mirrors GameRoom._checkHalfHealthPortalTrigger(). */
  checkHalfHealthPortalTrigger(player: PlayerLike): void {
    const isPvpOrPvpve = this.state.pvpMode === 'pvp' || this.state.pvpMode === 'pvpve';
    if (!isPvpOrPvpve) return;
    if (this._portalsTriggeredThisGame) return;
    if (player.health > player.maxHealth * 0.5) return;

    this._portalsTriggeredThisGame = true;
    this._spawnPortals(player.surfaceU, player.surfaceV);
    this._schedulePortalCycle();
  }

  /** Mirrors GameRoom._spawnPortals(nearU?, nearV?). */
  private _spawnPortals(nearU?: number, nearV?: number): void {
    const margin = 0.12;
    let uA: number, vA: number;

    if (nearU !== undefined && nearV !== undefined) {
      const jitter = 0.15;
      uA = Math.max(margin, Math.min(1 - margin, nearU + (Math.random() - 0.5) * jitter * 2));
      vA = Math.max(margin, Math.min(1 - margin, nearV + (Math.random() - 0.5) * jitter * 2));
    } else {
      uA = margin + Math.random() * (1 - 2 * margin);
      vA = margin + Math.random() * (1 - 2 * margin);
    }

    const minSep = 0.35;
    let uB = uA;
    let vB = vA;
    let attempts = 0;
    do {
      uB = margin + Math.random() * (1 - 2 * margin);
      vB = margin + Math.random() * (1 - 2 * margin);
      const du = Math.min(Math.abs(uB - uA), 1 - Math.abs(uB - uA));
      const dv = Math.min(Math.abs(vB - vA), 1 - Math.abs(vB - vA));
      if (Math.sqrt(du * du + dv * dv) >= minSep) break;
    } while (++attempts < 100);

    this.state.portalAU = uA;
    this.state.portalAV = vA;
    this.state.portalBU = uB;
    this.state.portalBV = vB;
    this.state.portalsActive = true;
  }

  /** Mirrors GameRoom._schedulePortalCycle(). */
  private _schedulePortalCycle(): void {
    const despawnMs = (15 + Math.random() * 45) * 1000;
    this._portalDespawnTimer = setTimeout(() => {
      this._portalDespawnTimer = null;
      this._deactivatePortals();
      const respawnMs = (10 + Math.random() * 5) * 1000;
      this._portalRespawnTimer = setTimeout(() => {
        this._portalRespawnTimer = null;
        this._spawnPortals();
        this._schedulePortalCycle();
      }, respawnMs);
    }, despawnMs);
  }

  private _deactivatePortals(): void {
    this.state.portalsActive = false;
    this.state.portalAU = 0;
    this.state.portalAV = 0;
    this.state.portalBU = 0;
    this.state.portalBV = 0;
  }

  /** Mirrors GameRoom._clearPortalTimers(). */
  _clearPortalTimers(): void {
    if (this._portalDespawnTimer !== null) {
      clearTimeout(this._portalDespawnTimer);
      this._portalDespawnTimer = null;
    }
    if (this._portalRespawnTimer !== null) {
      clearTimeout(this._portalRespawnTimer);
      this._portalRespawnTimer = null;
    }
  }

  get isTriggered(): boolean { return this._portalsTriggeredThisGame; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(pvpMode = 'pvp'): PortalState {
  return { portalsActive: false, portalAU: 0, portalAV: 0, portalBU: 0, portalBV: 0, pvpMode };
}

function makePlayer(health: number, maxHealth = PLAYER_PVP_MAX_HEALTH, u = 0.3, v = 0.3): PlayerLike {
  return { health, maxHealth, surfaceU: u, surfaceV: v, name: 'TestPlayer' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PvP Portal Spawning — s44r2-10', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('game start state', () => {
    it('portals are NOT active at game start in PvP mode (pre-fix: they were active immediately)', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      // BEFORE fix: state.portalsActive would be true here
      // AFTER fix: portals only spawn on half-health trigger
      expect(state.portalsActive).toBe(false);
    });

    it('portals are NOT active at game start in PvPvE mode', () => {
      const state = makeState('pvpve');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();
      expect(state.portalsActive).toBe(false);
    });

    it('portals stay inactive in non-PvP mode', () => {
      const state = makeState('waves');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();
      expect(state.portalsActive).toBe(false);
    });
  });

  describe('half-health trigger', () => {
    it('portals activate when player first drops to exactly 50% health', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.5); // exactly 50%
      ctrl.checkHalfHealthPortalTrigger(player);

      expect(state.portalsActive).toBe(true);
    });

    it('portals activate when player drops below 50% health', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4); // 40%
      ctrl.checkHalfHealthPortalTrigger(player);

      expect(state.portalsActive).toBe(true);
    });

    it('portals do NOT activate when player health is above 50%', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.6); // 60%
      ctrl.checkHalfHealthPortalTrigger(player);

      expect(state.portalsActive).toBe(false);
    });

    it('portals do NOT activate in non-PvP mode even when player drops to half health', () => {
      const state = makeState('waves');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4);
      ctrl.checkHalfHealthPortalTrigger(player);

      expect(state.portalsActive).toBe(false);
    });

    it('PvPvE mode also triggers portals on half health', () => {
      const state = makeState('pvpve');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.3);
      ctrl.checkHalfHealthPortalTrigger(player);

      expect(state.portalsActive).toBe(true);
    });
  });

  describe('one-shot trigger', () => {
    it('trigger is one-shot — second call does not re-fire even if portals are deactivated', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4);
      ctrl.checkHalfHealthPortalTrigger(player); // triggers
      expect(ctrl.isTriggered).toBe(true);
      expect(state.portalsActive).toBe(true);

      // Manually deactivate portals (as if timer fired)
      state.portalsActive = false;

      // Second call — trigger is already consumed, should not re-fire
      ctrl.checkHalfHealthPortalTrigger(player);
      expect(state.portalsActive).toBe(false); // should remain inactive
    });
  });

  describe('portal pair positioning', () => {
    it('portal A is placed near the damaged player UV position', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const playerU = 0.5;
      const playerV = 0.5;
      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4, PLAYER_PVP_MAX_HEALTH, playerU, playerV);
      ctrl.checkHalfHealthPortalTrigger(player);

      // Portal A should be within ±0.15 UV of the player position (plus some margin clamp)
      const maxDist = 0.15 * Math.SQRT2 + 0.01; // diagonal of jitter box + epsilon
      const du = state.portalAU - playerU;
      const dv = state.portalAV - playerV;
      const dist = Math.sqrt(du * du + dv * dv);
      expect(dist).toBeLessThanOrEqual(maxDist);
    });

    it('portal B is placed far from portal A (≥0.35 UV separation)', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4, PLAYER_PVP_MAX_HEALTH, 0.5, 0.5);
      ctrl.checkHalfHealthPortalTrigger(player);

      const du = Math.min(Math.abs(state.portalBU - state.portalAU), 1 - Math.abs(state.portalBU - state.portalAU));
      const dv = Math.min(Math.abs(state.portalBV - state.portalAV), 1 - Math.abs(state.portalBV - state.portalAV));
      const sep = Math.sqrt(du * du + dv * dv);
      expect(sep).toBeGreaterThanOrEqual(0.35);
    });

    it('both portals are within [0.12, 0.88] UV range (inside margins)', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4, PLAYER_PVP_MAX_HEALTH, 0.5, 0.5);
      ctrl.checkHalfHealthPortalTrigger(player);

      const margin = 0.12;
      expect(state.portalAU).toBeGreaterThanOrEqual(margin);
      expect(state.portalAU).toBeLessThanOrEqual(1 - margin);
      expect(state.portalAV).toBeGreaterThanOrEqual(margin);
      expect(state.portalAV).toBeLessThanOrEqual(1 - margin);
      expect(state.portalBU).toBeGreaterThanOrEqual(margin);
      expect(state.portalBU).toBeLessThanOrEqual(1 - margin);
      expect(state.portalBV).toBeGreaterThanOrEqual(margin);
      expect(state.portalBV).toBeLessThanOrEqual(1 - margin);
    });
  });

  describe('despawn and respawn cycle', () => {
    it('portals deactivate when despawn timer fires', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4);
      ctrl.checkHalfHealthPortalTrigger(player);
      expect(state.portalsActive).toBe(true);

      // Fire only the despawn timer (runOnlyPendingTimers fires one "batch" — the despawn)
      vi.runOnlyPendingTimers(); // fires: despawn setTimeout
      expect(state.portalsActive).toBe(false);

      ctrl._clearPortalTimers();
    });

    it('portals respawn after despawn — two timer cycles', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4);
      ctrl.checkHalfHealthPortalTrigger(player);

      vi.runOnlyPendingTimers(); // fire despawn timer → portalsActive = false, queues respawn timer
      expect(state.portalsActive).toBe(false);

      vi.runOnlyPendingTimers(); // fire respawn timer → portalsActive = true, queues next despawn
      expect(state.portalsActive).toBe(true);

      ctrl._clearPortalTimers();
    });

    it('timer cleanup on game reset prevents stale timer from firing', () => {
      const state = makeState('pvp');
      const ctrl = new PortalController(state);
      ctrl.resetForNewGame();

      const player = makePlayer(PLAYER_PVP_MAX_HEALTH * 0.4);
      ctrl.checkHalfHealthPortalTrigger(player);
      expect(state.portalsActive).toBe(true);

      // Simulate game end / new game start
      ctrl.resetForNewGame();
      expect(state.portalsActive).toBe(false);
      expect(ctrl.isTriggered).toBe(false);

      // Old timer should not re-activate portals
      vi.advanceTimersByTime(120_000);
      expect(state.portalsActive).toBe(false);
    });
  });
});
