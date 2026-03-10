/**
 * Regression test: s44r6c-04 — Portal kills player + double respawn on peanut map.
 *
 * Root cause (BEFORE s44r6c-02):
 *   _teleportPlayerToPortal() teleported the player to the exit portal but did NOT
 *   grant invincibility. In the NEXT tick, checkCollisions() saw the player at the
 *   exit portal position with enemies nearby → immediate death + respawn.
 *   On peanut map with enemies (PvPvE mode), enemies cluster around portal locations,
 *   making this nearly guaranteed on every teleport.
 *
 * Fix (s44r6c-02):
 *   playerInvincibility.set(sessionId, 1.0) in _teleportPlayerToPortal().
 *   1 second of invincibility lets the player escape before they can be hit.
 *
 * These tests extract the logic from GameRoom to verify the fix in isolation.
 * Tests are written in the same pattern as GameRoom.pvp-portal-spawning.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Extracted geometry — peanut chord distance (mirrors GameRoom.ts constants)
// ---------------------------------------------------------------------------

const PEANUT_BASE_RADIUS = 6;
const PEANUT_WAIST_DEPTH = 0.4;

function peanutChordDist(
  u1: number, v1: number,
  u2: number, v2: number,
  scaleFactor = 1.0,
): number {
  const B = PEANUT_BASE_RADIUS * scaleFactor;
  const W = PEANUT_WAIST_DEPTH;
  const phi1 = v1 * Math.PI, theta1 = u1 * 2 * Math.PI;
  const r1 = B * (1 + W * Math.cos(2 * phi1));
  const phi2 = v2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const r2 = B * (1 + W * Math.cos(2 * phi2));
  const dx = r1 * Math.sin(phi1) * Math.cos(theta1) - r2 * Math.sin(phi2) * Math.cos(theta2);
  const dy = r1 * Math.cos(phi1) - r2 * Math.cos(phi2);
  const dz = r1 * Math.sin(phi1) * Math.sin(theta1) - r2 * Math.sin(phi2) * Math.sin(theta2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------------------
// Minimal portal collision simulation — mirrors GameRoom private methods
// ---------------------------------------------------------------------------

const PORTAL_WORLD_RADIUS = 1.5;   // trigger radius (world units)
const ENEMY_HIT_WORLD = 2.5;       // enemy hit threshold on peanut (world units)
const PORTAL_INVINCIBILITY_S = 1.0; // granted after teleport (s44r6c-02 fix)
const PORTAL_COOLDOWN_MS = 2000;

interface SimPlayer {
  id: string;
  surfaceU: number;
  surfaceV: number;
  alive: boolean;
  lives: number;
}

interface SimEnemy {
  surfaceU: number;
  surfaceV: number;
  alive: boolean;
}

interface SimPortalState {
  portalsActive: boolean;
  portalAU: number;
  portalAV: number;
  portalBU: number;
  portalBV: number;
  surfaceType: string;
}

/** Simulates the portal collision controller extracted from GameRoom. */
class PortalCollisionSim {
  private cooldowns = new Map<string, number>();
  private invincibility = new Map<string, number>();

  constructor(
    private readonly state: SimPortalState,
    private readonly grantInvincibilityOnTeleport: boolean, // set false to simulate pre-fix bug
  ) {}

  /** Mirrors GameRoom.updatePortalCollision(). */
  updatePortalCollision(players: SimPlayer[], now = Date.now()): Map<string, { exitU: number; exitV: number }> {
    const teleported = new Map<string, { exitU: number; exitV: number }>();
    if (!this.state.portalsActive) return teleported;

    for (const player of players) {
      if (!player.alive) continue;
      if ((this.cooldowns.get(player.id) ?? 0) > now) continue;

      const distToA = peanutChordDist(player.surfaceU, player.surfaceV, this.state.portalAU, this.state.portalAV);
      if (distToA < PORTAL_WORLD_RADIUS) {
        this._teleportPlayerToPortal(player, 'B', now);
        teleported.set(player.id, { exitU: this.state.portalBU, exitV: this.state.portalBV });
        continue;
      }

      const distToB = peanutChordDist(player.surfaceU, player.surfaceV, this.state.portalBU, this.state.portalBV);
      if (distToB < PORTAL_WORLD_RADIUS) {
        this._teleportPlayerToPortal(player, 'A', now);
        teleported.set(player.id, { exitU: this.state.portalAU, exitV: this.state.portalAV });
      }
    }

    return teleported;
  }

  /** Mirrors GameRoom._teleportPlayerToPortal(). */
  private _teleportPlayerToPortal(player: SimPlayer, exit: 'A' | 'B', now: number): void {
    const exitU = exit === 'A' ? this.state.portalAU : this.state.portalBU;
    const exitV = exit === 'A' ? this.state.portalAV : this.state.portalBV;
    player.surfaceU = exitU;
    player.surfaceV = exitV;
    this.cooldowns.set(player.id, now + PORTAL_COOLDOWN_MS);

    // s44r6c-02 fix: grant invincibility after teleport
    // Without this, enemies at exit portal kill player instantly
    if (this.grantInvincibilityOnTeleport) {
      this.invincibility.set(player.id, PORTAL_INVINCIBILITY_S);
    }
  }

  /** Mirrors GameRoom.checkCollisions() — simplified enemy hit check. */
  checkEnemyCollisions(players: SimPlayer[], enemies: SimEnemy[]): SimPlayer[] {
    const killed: SimPlayer[] = [];

    for (const player of players) {
      if (!player.alive) continue;

      // s44r6c-02: invincibility prevents hit
      const invincible = this.invincibility.get(player.id) ?? 0;
      if (invincible > 0) continue;

      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        const dist = peanutChordDist(player.surfaceU, player.surfaceV, enemy.surfaceU, enemy.surfaceV);
        if (dist < ENEMY_HIT_WORLD) {
          player.lives--;
          if (player.lives <= 0) {
            player.alive = false;
          }
          killed.push(player);
          break;
        }
      }
    }

    return killed;
  }

  /** Advance invincibility timers by dt seconds. */
  drainInvincibility(dt: number): void {
    this.invincibility.forEach((remaining, id) => {
      const next = remaining - dt;
      if (next <= 0) {
        this.invincibility.delete(id);
      } else {
        this.invincibility.set(id, next);
      }
    });
  }

  getInvincibility(playerId: string): number {
    return this.invincibility.get(playerId) ?? 0;
  }

  getCooldown(playerId: string, now = Date.now()): number {
    return Math.max(0, (this.cooldowns.get(playerId) ?? 0) - now);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('portal-kills-player regression (s44r6c-04)', () => {
  // Peanut portal positions: A on one lobe, B on opposite lobe
  const PORTAL_A = { u: 0.3, v: 0.15 }; // near north bulge
  const PORTAL_B = { u: 0.8, v: 0.85 }; // near south bulge

  const basePortalState: SimPortalState = {
    portalsActive: true,
    portalAU: PORTAL_A.u,
    portalAV: PORTAL_A.v,
    portalBU: PORTAL_B.u,
    portalBV: PORTAL_B.v,
    surfaceType: 'peanut',
  };

  function makePlayer(u: number, v: number, lives = 3): SimPlayer {
    return { id: 'p1', surfaceU: u, surfaceV: v, alive: true, lives };
  }

  function makeEnemy(u: number, v: number): SimEnemy {
    return { surfaceU: u, surfaceV: v, alive: true };
  }

  describe('peanutChordDist geometry', () => {
    it('portal A and B are further apart than PORTAL_WORLD_RADIUS (portals do not overlap)', () => {
      const dist = peanutChordDist(PORTAL_A.u, PORTAL_A.v, PORTAL_B.u, PORTAL_B.v);
      expect(dist).toBeGreaterThan(PORTAL_WORLD_RADIUS * 2);
    });

    it('player at portal A entrance is within PORTAL_WORLD_RADIUS of portal A', () => {
      // Player at exactly portal A UV position → distance = 0
      const dist = peanutChordDist(PORTAL_A.u, PORTAL_A.v, PORTAL_A.u, PORTAL_A.v);
      expect(dist).toBeLessThan(PORTAL_WORLD_RADIUS);
    });

    it('player 2 world units from portal A is outside trigger radius', () => {
      // Offset player slightly from portal A in V direction
      // On peanut bulge, 0.03 dV ≈ 1.5 world units in worst case
      // Use 0.06 dV to ensure > 1.5 world units
      const dist = peanutChordDist(PORTAL_A.u, PORTAL_A.v + 0.06, PORTAL_A.u, PORTAL_A.v);
      expect(dist).toBeGreaterThan(PORTAL_WORLD_RADIUS);
    });
  });

  describe('WITH invincibility fix (s44r6c-02 — current behavior)', () => {
    let sim: PortalCollisionSim;

    beforeEach(() => {
      sim = new PortalCollisionSim(basePortalState, /* grantInvincibilityOnTeleport */ true);
    });

    it('player standing at portal A gets teleported to portal B in next tick', () => {
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v);
      sim.updatePortalCollision([player], Date.now());

      expect(player.surfaceU).toBeCloseTo(PORTAL_B.u);
      expect(player.surfaceV).toBeCloseTo(PORTAL_B.v);
    });

    it('player receives 1s invincibility immediately after portal teleport', () => {
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v);
      sim.updatePortalCollision([player], Date.now());

      expect(sim.getInvincibility(player.id)).toBeCloseTo(1.0, 2);
    });

    it('enemy at exit portal (portal B) cannot kill player in the tick after teleport', () => {
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, /* lives */ 3);
      const enemyAtB = makeEnemy(PORTAL_B.u, PORTAL_B.v);

      // Tick N: portal collision runs — player teleported to B, invincibility = 1.0s
      sim.updatePortalCollision([player], Date.now());

      // Tick N+1: collision check runs — player should be protected by invincibility
      const killed = sim.checkEnemyCollisions([player], [enemyAtB]);

      expect(killed).toHaveLength(0);
      expect(player.alive).toBe(true);
      expect(player.lives).toBe(3); // no lives lost
    });

    it('player is protected for full 1s invincibility window', () => {
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 3);
      const enemyAtB = makeEnemy(PORTAL_B.u, PORTAL_B.v);

      sim.updatePortalCollision([player], Date.now());

      // Simulate 10 ticks at 30Hz (333ms) — still within 1s window
      for (let i = 0; i < 10; i++) {
        sim.drainInvincibility(1 / 30);
        const killed = sim.checkEnemyCollisions([player], [enemyAtB]);
        expect(killed).toHaveLength(0);
        expect(player.alive).toBe(true);
      }
    });

    it('player can be hit after invincibility expires', () => {
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 3);
      const enemyAtB = makeEnemy(PORTAL_B.u, PORTAL_B.v);

      sim.updatePortalCollision([player], Date.now());

      // Drain full 1.1 seconds (past invincibility window)
      for (let i = 0; i < Math.ceil(1.1 / (1 / 30)); i++) {
        sim.drainInvincibility(1 / 30);
      }

      expect(sim.getInvincibility(player.id)).toBe(0);

      // Now collision should register
      const killed = sim.checkEnemyCollisions([player], [enemyAtB]);
      expect(killed).toHaveLength(1);
    });

    it('portal cooldown prevents double-teleport on same frame', () => {
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 3);
      const t0 = Date.now();

      // First teleport: A → B
      sim.updatePortalCollision([player], t0);
      expect(player.surfaceU).toBeCloseTo(PORTAL_B.u);

      // Second call in same tick — cooldown blocks it
      player.surfaceU = PORTAL_A.u; // manually move back to A
      player.surfaceV = PORTAL_A.v;
      sim.updatePortalCollision([player], t0); // same timestamp

      // Player should still be at A (not re-teleported)
      expect(player.surfaceU).toBeCloseTo(PORTAL_A.u);
    });

    it('portal cooldown prevents immediate re-entry from exit portal', () => {
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 3);
      const t0 = Date.now();

      // Teleport A → B
      sim.updatePortalCollision([player], t0);
      expect(player.surfaceU).toBeCloseTo(PORTAL_B.u);

      // Player is now AT portal B — same tick or shortly after
      // The cooldown should prevent B→A teleport
      const killed = sim.checkEnemyCollisions([player], []); // no enemies
      sim.updatePortalCollision([player], t0 + 50); // 50ms later — within 2s cooldown

      // Player should remain at B (not sent back to A)
      expect(player.surfaceU).toBeCloseTo(PORTAL_B.u);
    });
  });

  describe('WITHOUT invincibility fix (pre-s44r6c-02 behavior — reproduces the bug)', () => {
    let sim: PortalCollisionSim;

    beforeEach(() => {
      sim = new PortalCollisionSim(basePortalState, /* grantInvincibilityOnTeleport */ false);
    });

    it('BUG REPRODUCTION: enemy at exit portal kills player in tick after teleport', () => {
      // This test demonstrates the bug that existed before s44r6c-02.
      // With the fix applied, this test would fail (player would NOT die).
      // Since we're using the buggy mode (grantInvincibilityOnTeleport=false),
      // the player should die — demonstrating the bug.

      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 1); // 1 life
      const enemyAtB = makeEnemy(PORTAL_B.u, PORTAL_B.v);

      // Without fix: invincibility NOT set
      expect(sim.getInvincibility(player.id)).toBe(0);

      // Tick N: portal teleport fires — player moved to B, NO invincibility
      sim.updatePortalCollision([player], Date.now());
      expect(player.surfaceU).toBeCloseTo(PORTAL_B.u);
      expect(sim.getInvincibility(player.id)).toBe(0); // BUG: no invincibility!

      // Tick N+1: enemy collision — player is NOT invincible → dies (Respawn 1)
      const killed = sim.checkEnemyCollisions([player], [enemyAtB]);
      expect(killed).toHaveLength(1); // player killed!
      expect(player.alive).toBe(false); // player dead = forced respawn
    });

    it('BUG: no invincibility granted means portal death every time on PvPvE peanut', () => {
      // With enemies near portals (common in PvPvE), player dies on EVERY portal use
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 3);

      // Enemy placed very close to portal B — simulating enemy following portal
      const closeEnemy = makeEnemy(PORTAL_B.u, PORTAL_B.v + 0.01);

      sim.updatePortalCollision([player], Date.now());
      const killed = sim.checkEnemyCollisions([player], [closeEnemy]);

      expect(killed).toHaveLength(1); // dies without invincibility
      expect(player.lives).toBe(2);   // lost a life
    });
  });

  describe('respawn does not reset portal cooldown (secondary concern)', () => {
    it('portal cooldown persists across simulated respawn', () => {
      // When player dies and respawns near a portal, the original cooldown
      // from entering that portal should still be active (no double-teleport).
      const sim = new PortalCollisionSim(basePortalState, true);
      const t0 = Date.now();

      // Player enters portal A → teleported to B → cooldown = t0 + 2000ms
      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 3);
      sim.updatePortalCollision([player], t0);

      // Simulate player dying at B and respawning back at A (edge case)
      player.surfaceU = PORTAL_A.u;
      player.surfaceV = PORTAL_A.v;
      player.alive = true; // simulate respawn

      // Within cooldown window: should NOT be re-teleported
      sim.updatePortalCollision([player], t0 + 500); // 500ms later — within 2s cooldown
      expect(player.surfaceU).toBeCloseTo(PORTAL_A.u); // stayed at A
    });

    it('portal cooldown expires correctly and allows re-entry', () => {
      const sim = new PortalCollisionSim(basePortalState, true);
      const t0 = Date.now();

      const player = makePlayer(PORTAL_A.u, PORTAL_A.v, 3);
      sim.updatePortalCollision([player], t0);

      // After 2s cooldown expires, player can use portal again
      player.surfaceU = PORTAL_A.u;
      player.surfaceV = PORTAL_A.v;
      sim.updatePortalCollision([player], t0 + 2001); // just after cooldown expires

      expect(player.surfaceU).toBeCloseTo(PORTAL_B.u); // re-teleported to B
    });
  });
});
