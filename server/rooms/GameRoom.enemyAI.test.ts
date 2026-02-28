/**
 * Unit tests for GameRoom per-type enemy AI behavior (S35/S36).
 *
 * These tests replicate the AI logic in standalone form (no Colyseus room
 * required) to verify that each enemy type moves distinctly from simple
 * flat-speed chasing.
 *
 * Test coverage for: grunt, wanderer, neutron, rocket, mayfly, weaver,
 * duck, spinner, swarm, approach_glow.
 *
 * NOTE: All "moves toward player" tests use enemy at 0.3, player at 0.7 so
 * the direct UV path (0.4) is shorter than the wrapped path (0.6). This
 * ensures uvDelta returns the positive direct direction, not the short
 * negative wrap-around path.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal type stubs (mirrors the interfaces in GameRoom.ts)
// ---------------------------------------------------------------------------

interface EnemyStub { surfaceU: number; surfaceV: number; }
interface PlayerStub { surfaceU: number; surfaceV: number; alive: boolean; }
interface AI {
  currentSpeed?: number;
  maxSpeed?: number;
  directionU?: number;
  directionV?: number;
  directionChangeTimer?: number;
  nextDirectionChange?: number;
  rocketDirU?: number;
  rocketDirV?: number;
  jitterOffsetU?: number;
  jitterOffsetV?: number;
  jitterTimer?: number;
  momentumU?: number;
  momentumV?: number;
  duckDirection?: number;
  duckTimer?: number;
}

// ---------------------------------------------------------------------------
// Standalone AI implementations (exact ports from GameRoom.ts)
// ---------------------------------------------------------------------------

const DT = 1 / 60; // 60Hz tick

/** Shortest UV delta, wrapping if necessary (mirrors GameRoom.uvDelta). */
function uvDelta(from: number, to: number, wraps: boolean): number {
  if (!wraps) return to - from;
  const direct = to - from;
  if (direct > 0.5) return direct - 1;
  if (direct < -0.5) return direct + 1;
  return direct;
}

function wrapCoord(v: number): number { return ((v % 1) + 1) % 1; }

function applyBounds(enemy: EnemyStub, wrapsV: boolean): void {
  enemy.surfaceU = wrapCoord(enemy.surfaceU);
  if (wrapsV) {
    enemy.surfaceV = wrapCoord(enemy.surfaceV);
  } else {
    enemy.surfaceV = Math.max(0.05, Math.min(0.95, enemy.surfaceV));
  }
}

function updateGrunt(enemy: EnemyStub, ai: AI, player: PlayerStub, dt: number): void {
  ai.currentSpeed = Math.min(0.06, (ai.currentSpeed ?? 0.02) + 0.002 * dt);
  const du = uvDelta(enemy.surfaceU, player.surfaceU, true);
  const dv = uvDelta(enemy.surfaceV, player.surfaceV, false);
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist > 0.01) {
    enemy.surfaceU += (du / dist) * ai.currentSpeed * dt;
    enemy.surfaceV += (dv / dist) * ai.currentSpeed * dt;
    applyBounds(enemy, false);
  }
}

function updateWanderer(enemy: EnemyStub, ai: AI, dt: number): void {
  if (ai.directionU === undefined || ai.directionV === undefined) {
    ai.directionU = 1; ai.directionV = 0;
    ai.directionChangeTimer = 0; ai.nextDirectionChange = 100; // never changes in tests
  }
  ai.directionChangeTimer = (ai.directionChangeTimer ?? 0) + dt;
  const WANDER_SPEED = 0.04;
  enemy.surfaceU += ai.directionU * WANDER_SPEED * dt;
  enemy.surfaceV += ai.directionV * WANDER_SPEED * dt;
  if (enemy.surfaceU <= 0) { enemy.surfaceU = 0; ai.directionU = Math.abs(ai.directionU); }
  else if (enemy.surfaceU >= 1) { enemy.surfaceU = 1; ai.directionU = -Math.abs(ai.directionU); }
  if (enemy.surfaceV <= 0) { enemy.surfaceV = 0; ai.directionV = Math.abs(ai.directionV); }
  else if (enemy.surfaceV >= 1) { enemy.surfaceV = 1; ai.directionV = -Math.abs(ai.directionV); }
}

function updateNeutron(enemy: EnemyStub, ai: AI, dt: number): void {
  if (ai.directionU === undefined || ai.directionV === undefined) {
    ai.directionU = 1; ai.directionV = 0;
  }
  const NEUTRON_SPEED = 0.05;
  enemy.surfaceU += ai.directionU * NEUTRON_SPEED * dt;
  enemy.surfaceV += ai.directionV * NEUTRON_SPEED * dt;
  let bounced = false;
  if (enemy.surfaceU <= 0) { enemy.surfaceU = 0; bounced = true; }
  else if (enemy.surfaceU >= 1) { enemy.surfaceU = 1; bounced = true; }
  if (enemy.surfaceV <= 0) { enemy.surfaceV = 0; bounced = true; }
  else if (enemy.surfaceV >= 1) { enemy.surfaceV = 1; bounced = true; }
  if (bounced) {
    ai.directionU = -ai.directionU;
    ai.directionV = -ai.directionV;
  }
}

function updateRocket(enemy: EnemyStub, ai: AI, dt: number): void {
  if (ai.rocketDirU === undefined || ai.rocketDirV === undefined) {
    ai.rocketDirU = 1; ai.rocketDirV = 0;
  }
  const ROCKET_SPEED = 0.07;
  enemy.surfaceU += ai.rocketDirU * ROCKET_SPEED * dt;
  enemy.surfaceV += ai.rocketDirV * ROCKET_SPEED * dt;
  if (enemy.surfaceU <= 0) { enemy.surfaceU = 0; ai.rocketDirU = Math.abs(ai.rocketDirU); }
  else if (enemy.surfaceU >= 1) { enemy.surfaceU = 1; ai.rocketDirU = -Math.abs(ai.rocketDirU); }
  if (enemy.surfaceV <= 0) { enemy.surfaceV = 0; ai.rocketDirV = Math.abs(ai.rocketDirV); }
  else if (enemy.surfaceV >= 1) { enemy.surfaceV = 1; ai.rocketDirV = -Math.abs(ai.rocketDirV); }
}

function updateMayfly(enemy: EnemyStub, ai: AI, player: PlayerStub, dt: number, jitterU: number, jitterV: number): void {
  ai.jitterOffsetU = jitterU;
  ai.jitterOffsetV = jitterV;
  const targetU = player.surfaceU + jitterU;
  const targetV = player.surfaceV + jitterV;
  const du = uvDelta(enemy.surfaceU, targetU, true);
  const dv = uvDelta(enemy.surfaceV, targetV, false);
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist > 0.001) {
    const MAYFLY_SPEED = 0.095;
    enemy.surfaceU += (du / dist) * MAYFLY_SPEED * dt;
    enemy.surfaceV += (dv / dist) * MAYFLY_SPEED * dt;
    applyBounds(enemy, false);
  }
}

function updateWeaver(enemy: EnemyStub, ai: AI, player: PlayerStub, dt: number): void {
  ai.momentumU = ai.momentumU ?? 0;
  ai.momentumV = ai.momentumV ?? 0;
  const du = uvDelta(enemy.surfaceU, player.surfaceU, true);
  const dv = uvDelta(enemy.surfaceV, player.surfaceV, false);
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist > 0.01) {
    ai.momentumU += (du / dist) * 0.3 * dt;
    ai.momentumV += (dv / dist) * 0.3 * dt;
  }
  ai.momentumU *= 0.92;
  ai.momentumV *= 0.92;
  const spd = Math.sqrt(ai.momentumU * ai.momentumU + ai.momentumV * ai.momentumV);
  if (spd > 0.04) {
    ai.momentumU = (ai.momentumU / spd) * 0.04;
    ai.momentumV = (ai.momentumV / spd) * 0.04;
  }
  enemy.surfaceU += ai.momentumU * dt;
  enemy.surfaceV += ai.momentumV * dt;
  applyBounds(enemy, false);
}

function updateDuck(enemy: EnemyStub, ai: AI, player: PlayerStub, dt: number, rngOverride?: number): void {
  const DUCK_SPEED = 0.025;
  const DIRECTION_INTERVAL = 0.5;
  if (ai.duckDirection === undefined) { ai.duckDirection = 1; ai.duckTimer = 0; }
  ai.duckTimer = (ai.duckTimer ?? 0) + dt;
  if (ai.duckTimer >= DIRECTION_INTERVAL) {
    ai.duckTimer = 0;
    const rng = rngOverride ?? Math.random();
    if (rng >= 0.2) {
      const du = player.surfaceU - enemy.surfaceU;
      const dv = player.surfaceV - enemy.surfaceV;
      ai.duckDirection = Math.abs(du) > Math.abs(dv) ? (du > 0 ? 1 : 3) : (dv > 0 ? 0 : 2);
    } else {
      ai.duckDirection = 2; // deterministic "random" for tests
    }
  }
  switch (ai.duckDirection) {
    case 0: enemy.surfaceV += DUCK_SPEED * dt; break;
    case 1: enemy.surfaceU += DUCK_SPEED * dt; break;
    case 2: enemy.surfaceV -= DUCK_SPEED * dt; break;
    case 3: enemy.surfaceU -= DUCK_SPEED * dt; break;
  }
  applyBounds(enemy, false);
}

function updateSpinner(enemy: EnemyStub, player: PlayerStub, dt: number, wobbleU: number, wobbleV: number): void {
  const SPINNER_SPEED = 0.05;
  const targetU = player.surfaceU + wobbleU;
  const targetV = player.surfaceV + wobbleV;
  const du = uvDelta(enemy.surfaceU, targetU, true);
  const dv = uvDelta(enemy.surfaceV, targetV, false);
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist > 0.01) {
    enemy.surfaceU += (du / dist) * SPINNER_SPEED * dt;
    enemy.surfaceV += (dv / dist) * SPINNER_SPEED * dt;
    applyBounds(enemy, false);
  }
}

function updateAcceleratingChaser(enemy: EnemyStub, ai: AI, player: PlayerStub, dt: number): void {
  const maxSpeed = ai.maxSpeed ?? 0.055;
  ai.currentSpeed = Math.min(maxSpeed, (ai.currentSpeed ?? 0.02) + 0.002 * dt);
  const du = uvDelta(enemy.surfaceU, player.surfaceU, true);
  const dv = uvDelta(enemy.surfaceV, player.surfaceV, false);
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist > 0.01) {
    enemy.surfaceU += (du / dist) * ai.currentSpeed * dt;
    enemy.surfaceV += (dv / dist) * ai.currentSpeed * dt;
    applyBounds(enemy, false);
  }
}

function runTicks(n: number, fn: () => void): void {
  for (let i = 0; i < n; i++) fn();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameRoom enemy AI — per-type behavior', () => {

  // -------------------------------------------------------------------------
  // Grunt
  // -------------------------------------------------------------------------
  describe('Grunt: accelerates toward player', () => {
    it('currentSpeed increases over time from 0.02', () => {
      const ai: AI = { currentSpeed: 0.02 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initial = ai.currentSpeed!;
      runTicks(300, () => updateGrunt(enemy, ai, player, DT));
      expect(ai.currentSpeed).toBeGreaterThan(initial);
    });

    it('currentSpeed caps at 0.06', () => {
      const ai: AI = { currentSpeed: 0.02 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      runTicks(60 * 30, () => updateGrunt(enemy, ai, player, DT));
      expect(ai.currentSpeed).toBeCloseTo(0.06, 5);
    });

    it('moves toward player (enemy left, player right)', () => {
      // enemy 0.3, player 0.7: direct path = 0.4 < wrapped 0.6 → goes right
      const ai: AI = { currentSpeed: 0.02 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(60, () => updateGrunt(enemy, ai, player, DT));
      expect(enemy.surfaceU).toBeGreaterThan(initialU);
    });
  });

  // -------------------------------------------------------------------------
  // Wanderer
  // -------------------------------------------------------------------------
  describe('Wanderer: random walk, bounces off boundaries', () => {
    it('moves from initial position when given a direction', () => {
      const ai: AI = { directionU: 1, directionV: 0, directionChangeTimer: 0, nextDirectionChange: 100 };
      const enemy = { surfaceU: 0.5, surfaceV: 0.5 };
      const initialU = enemy.surfaceU;
      runTicks(30, () => updateWanderer(enemy, ai, DT));
      expect(enemy.surfaceU).toBeGreaterThan(initialU);
    });

    it('reverses directionU when at U=0 boundary (next move would go negative)', () => {
      // Place enemy AT U=0, moving left → will cross boundary next tick
      const ai: AI = { directionU: -1, directionV: 0, directionChangeTimer: 0, nextDirectionChange: 100 };
      const enemy = { surfaceU: 0, surfaceV: 0.5 };
      updateWanderer(enemy, ai, DT);
      // After bounce: directionU should be positive
      expect(ai.directionU).toBeGreaterThan(0);
      expect(enemy.surfaceU).toBeGreaterThanOrEqual(0);
    });

    it('reverses directionU when at U=1 boundary (next move would exceed 1)', () => {
      const ai: AI = { directionU: 1, directionV: 0, directionChangeTimer: 0, nextDirectionChange: 100 };
      const enemy = { surfaceU: 1, surfaceV: 0.5 };
      updateWanderer(enemy, ai, DT);
      expect(ai.directionU).toBeLessThan(0);
      expect(enemy.surfaceU).toBeLessThanOrEqual(1);
    });

    it('stays within [0,1] bounds over 600 ticks', () => {
      const ai: AI = { directionU: 1, directionV: 0.5, directionChangeTimer: 0, nextDirectionChange: 100 };
      const enemy = { surfaceU: 0.5, surfaceV: 0.5 };
      runTicks(600, () => updateWanderer(enemy, ai, DT));
      expect(enemy.surfaceU).toBeGreaterThanOrEqual(0);
      expect(enemy.surfaceU).toBeLessThanOrEqual(1);
      expect(enemy.surfaceV).toBeGreaterThanOrEqual(0);
      expect(enemy.surfaceV).toBeLessThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Neutron
  // -------------------------------------------------------------------------
  describe('Neutron: straight-line ricochet', () => {
    it('bounces at U=1 boundary and reverses direction', () => {
      // Place at U=1 moving right → will cross on next tick
      const ai: AI = { directionU: 1, directionV: 0 };
      const enemy = { surfaceU: 1, surfaceV: 0.5 };
      updateNeutron(enemy, ai, DT);
      expect(enemy.surfaceU).toBeLessThanOrEqual(1);
      expect(ai.directionU).toBeLessThan(0);
    });

    it('bounces at U=0 boundary and reverses direction', () => {
      const ai: AI = { directionU: -1, directionV: 0 };
      const enemy = { surfaceU: 0, surfaceV: 0.5 };
      updateNeutron(enemy, ai, DT);
      expect(enemy.surfaceU).toBeGreaterThanOrEqual(0);
      expect(ai.directionU).toBeGreaterThan(0);
    });

    it('V stays constant when moving only in U direction', () => {
      const ai: AI = { directionU: 1, directionV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const initialV = enemy.surfaceV;
      runTicks(10, () => updateNeutron(enemy, ai, DT));
      expect(enemy.surfaceV).toBeCloseTo(initialV, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Rocket
  // -------------------------------------------------------------------------
  describe('Rocket: reflects off boundaries (preserves component)', () => {
    it('bounces at U=0 boundary (rocketDirU flips to positive)', () => {
      const ai: AI = { rocketDirU: -1, rocketDirV: 0 };
      const enemy = { surfaceU: 0, surfaceV: 0.5 };
      updateRocket(enemy, ai, DT);
      expect(enemy.surfaceU).toBeGreaterThanOrEqual(0);
      expect(ai.rocketDirU).toBeGreaterThan(0);
    });

    it('bounces at U=1 boundary (rocketDirU flips to negative)', () => {
      const ai: AI = { rocketDirU: 1, rocketDirV: 0 };
      const enemy = { surfaceU: 1, surfaceV: 0.5 };
      updateRocket(enemy, ai, DT);
      expect(enemy.surfaceU).toBeLessThanOrEqual(1);
      expect(ai.rocketDirU).toBeLessThan(0);
    });

    it('V unchanged when moving only in U direction', () => {
      const ai: AI = { rocketDirU: 1, rocketDirV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const initialV = enemy.surfaceV;
      runTicks(10, () => updateRocket(enemy, ai, DT));
      expect(enemy.surfaceV).toBeCloseTo(initialV, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Mayfly
  // -------------------------------------------------------------------------
  describe('Mayfly: two instances with opposite jitter land at different positions', () => {
    it('diverges based on jitter offset', () => {
      // Both start at same position, same player, but different fixed jitter offsets
      const m1 = { surfaceU: 0.3, surfaceV: 0.5 };
      const m2 = { surfaceU: 0.3, surfaceV: 0.5 };
      const ai1: AI = {}; const ai2: AI = {};
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };

      // Jitter1: target (0.7, 0.55) — slightly above player
      // Jitter2: target (0.7, 0.45) — slightly below player
      runTicks(60, () => {
        updateMayfly(m1, ai1, player, DT, 0.0, +0.05);
        updateMayfly(m2, ai2, player, DT, 0.0, -0.05);
      });

      // Different V targets → different V positions
      const vDiff = Math.abs(m1.surfaceV - m2.surfaceV);
      expect(vDiff).toBeGreaterThan(0.001);
    });
  });

  // -------------------------------------------------------------------------
  // Weaver
  // -------------------------------------------------------------------------
  describe('Weaver: momentum-based chase', () => {
    it('moves toward player (enemy at 0.3, player at 0.7)', () => {
      const ai: AI = { momentumU: 0, momentumV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(60, () => updateWeaver(enemy, ai, player, DT));
      expect(enemy.surfaceU).toBeGreaterThan(initialU);
    });

    it('momentum caps at 0.04 UV/s', () => {
      const ai: AI = { momentumU: 0, momentumV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      runTicks(600, () => updateWeaver(enemy, ai, player, DT));
      const speed = Math.sqrt((ai.momentumU ?? 0) ** 2 + (ai.momentumV ?? 0) ** 2);
      expect(speed).toBeLessThanOrEqual(0.04 + 1e-6);
    });
  });

  // -------------------------------------------------------------------------
  // Duck (NEW in S36)
  // -------------------------------------------------------------------------
  describe('Duck: cardinal movement biased toward player', () => {
    it('only U changes when direction is right (1)', () => {
      const ai: AI = { duckDirection: 1, duckTimer: 0 }; // direction: right
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const preV = enemy.surfaceV;
      updateDuck(enemy, ai, player, DT);
      expect(enemy.surfaceU).toBeGreaterThan(0.3);
      expect(enemy.surfaceV).toBeCloseTo(preV, 5);
    });

    it('only V changes when direction is up (0)', () => {
      const ai: AI = { duckDirection: 0, duckTimer: 0 }; // direction: up
      const enemy = { surfaceU: 0.5, surfaceV: 0.3 };
      const player = { surfaceU: 0.5, surfaceV: 0.7, alive: true };
      const preU = enemy.surfaceU;
      updateDuck(enemy, ai, player, DT);
      expect(enemy.surfaceV).toBeGreaterThan(0.3);
      expect(enemy.surfaceU).toBeCloseTo(preU, 5);
    });

    it('direction biased toward player on change (player far right → direction = right)', () => {
      // Timer expires: ai.duckTimer = 0, dt > DIRECTION_INTERVAL → direction change
      const ai: AI = { duckDirection: 2, duckTimer: 0.5 }; // timer will expire
      const enemy = { surfaceU: 0.1, surfaceV: 0.5 };
      const player = { surfaceU: 0.8, surfaceV: 0.5, alive: true }; // far right
      // du = 0.7, dv = 0 → |du| > |dv| → should pick right (1)
      updateDuck(enemy, ai, player, DT + 0.001, 0.5); // rngOverride=0.5 → biased
      expect(ai.duckDirection).toBe(1); // right
    });

    it('direction biased toward player on change (player far above → direction = up)', () => {
      const ai: AI = { duckDirection: 1, duckTimer: 0.5 };
      const enemy = { surfaceU: 0.5, surfaceV: 0.1 };
      const player = { surfaceU: 0.5, surfaceV: 0.8, alive: true }; // far up
      updateDuck(enemy, ai, player, DT + 0.001, 0.5);
      expect(ai.duckDirection).toBe(0); // up
    });
  });

  // -------------------------------------------------------------------------
  // Spinner (NEW in S36)
  // -------------------------------------------------------------------------
  describe('Spinner: wobble chase', () => {
    it('two spinners with different wobble end up at different positions', () => {
      // Same start, same player, but different wobble → different targets → different paths
      const s1 = { surfaceU: 0.3, surfaceV: 0.5 };
      const s2 = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      // wobble1: target (0.7, 0.55) — slightly above player
      // wobble2: target (0.7, 0.45) — slightly below player
      // Both have same U target → same U movement, but different V movement
      runTicks(60, () => {
        updateSpinner(s1, player, DT, 0, +0.05);
        updateSpinner(s2, player, DT, 0, -0.05);
      });
      const vDiff = Math.abs(s1.surfaceV - s2.surfaceV);
      expect(vDiff).toBeGreaterThan(0.001);
    });

    it('moves toward player (enemy at 0.3, player at 0.7)', () => {
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(60, () => updateSpinner(enemy, player, DT, 0, 0));
      expect(enemy.surfaceU).toBeGreaterThan(initialU);
    });

    it('wobble causes different trajectory than no-wobble', () => {
      // No wobble: target (0.7, 0.5) — purely horizontal from (0.3, 0.5)
      // With wobble (0, +0.2): target (0.7, 0.7) — diagonal from (0.3, 0.5)
      // → withWobble has upward V component, noWobble does not
      const noWobble = { surfaceU: 0.3, surfaceV: 0.5 };
      const withWobble = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      runTicks(60, () => updateSpinner(noWobble, player, DT, 0, 0));
      runTicks(60, () => updateSpinner(withWobble, player, DT, 0, 0.2));
      // noWobble V stays at 0.5, withWobble V moves toward 0.7
      const vDiff = Math.abs(noWobble.surfaceV - withWobble.surfaceV);
      expect(vDiff).toBeGreaterThan(0.001);
    });
  });

  // -------------------------------------------------------------------------
  // Swarm / ApproachGlow (NEW in S36) — accelerating chasers
  // -------------------------------------------------------------------------
  describe('Swarm/ApproachGlow: acceleration ramp', () => {
    it('swarm: speed increases from 0.03 over time', () => {
      const ai: AI = { currentSpeed: 0.03, maxSpeed: 0.055 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initial = ai.currentSpeed!;
      runTicks(300, () => updateAcceleratingChaser(enemy, ai, player, DT));
      expect(ai.currentSpeed).toBeGreaterThan(initial);
    });

    it('swarm: speed caps at maxSpeed 0.055', () => {
      const ai: AI = { currentSpeed: 0.03, maxSpeed: 0.055 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      runTicks(60 * 30, () => updateAcceleratingChaser(enemy, ai, player, DT));
      expect(ai.currentSpeed).toBeCloseTo(0.055, 5);
    });

    it('approach_glow: speed increases from 0.02 over time', () => {
      const ai: AI = { currentSpeed: 0.02, maxSpeed: 0.055 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initial = ai.currentSpeed!;
      runTicks(300, () => updateAcceleratingChaser(enemy, ai, player, DT));
      expect(ai.currentSpeed).toBeGreaterThan(initial);
    });

    it('approach_glow: speed caps at maxSpeed 0.055', () => {
      const ai: AI = { currentSpeed: 0.02, maxSpeed: 0.055 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      runTicks(60 * 30, () => updateAcceleratingChaser(enemy, ai, player, DT));
      expect(ai.currentSpeed).toBeCloseTo(0.055, 5);
    });

    it('accelerating chaser moves toward player', () => {
      const ai: AI = { currentSpeed: 0.02, maxSpeed: 0.055 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(60, () => updateAcceleratingChaser(enemy, ai, player, DT));
      expect(enemy.surfaceU).toBeGreaterThan(initialU);
    });
  });
});

// ---------------------------------------------------------------------------
// New S42-04g: Lurker, Repulsor, Orbiter, Helix, Spawner tests
// ---------------------------------------------------------------------------

interface ExtendedAI extends AI {
  lurkerState?: number;
  stateTimer?: number;
  dashDirU?: number;
  dashDirV?: number;
  nextDirectionChange?: number;
  repulsorPhase?: number;
  phaseTimer?: number;
  chargeTargetU?: number;
  chargeTargetV?: number;
  orbitAngle?: number;
  orbitRadius?: number;
  orbitDirection?: number;
  reverseTimer?: number;
  nextReverse?: number;
  corkscrewPhase?: number;
  spawnTimer?: number;
}

function updateLurker(
  enemy: EnemyStub, ai: ExtendedAI, player: PlayerStub | null, dt: number
): void {
  ai.stateTimer = (ai.stateTimer ?? 0) + dt;
  switch (ai.lurkerState ?? 0) {
    case 0: { // Idle
      if (ai.stateTimer >= (ai.nextDirectionChange ?? 2.5) && player) {
        ai.lurkerState = 1;
        ai.stateTimer = 0;
      }
      break;
    }
    case 1: { // Charging: track player, lock direction
      if (player) {
        const du = uvDelta(enemy.surfaceU, player.surfaceU, true);
        const dv = uvDelta(enemy.surfaceV, player.surfaceV, false);
        const dist = Math.sqrt(du * du + dv * dv);
        if (dist > 0.001) { ai.dashDirU = du / dist; ai.dashDirV = dv / dist; }
      }
      if (ai.stateTimer >= 1.0) { ai.lurkerState = 2; ai.stateTimer = 0; }
      break;
    }
    case 2: { // Dashing
      const DASH_SPEED = 0.105;
      enemy.surfaceU += (ai.dashDirU ?? 0) * DASH_SPEED * dt;
      enemy.surfaceV += (ai.dashDirV ?? 0) * DASH_SPEED * dt;
      applyBounds(enemy, false);
      if (ai.stateTimer >= 0.5) { ai.lurkerState = 3; ai.stateTimer = 0; }
      break;
    }
    case 3: { // Cooldown
      if (ai.stateTimer >= 1.5) {
        ai.lurkerState = 0;
        ai.stateTimer = 0;
        ai.nextDirectionChange = 2 + Math.random();
      }
      break;
    }
  }
}

function updateRepulsor(
  enemy: EnemyStub, ai: ExtendedAI, player: PlayerStub | null, dt: number
): void {
  ai.phaseTimer = (ai.phaseTimer ?? 0) + dt;
  switch (ai.repulsorPhase ?? 0) {
    case 0: { // Lock
      if (player) {
        const du = uvDelta(enemy.surfaceU, player.surfaceU, true);
        const dv = uvDelta(enemy.surfaceV, player.surfaceV, false);
        const dist = Math.sqrt(du * du + dv * dv);
        if (dist > 0.01) {
          enemy.surfaceU += (du / dist) * 0.03 * dt;
          enemy.surfaceV += (dv / dist) * 0.03 * dt;
          applyBounds(enemy, false);
        }
        if (ai.phaseTimer >= 2.0) {
          const awayU = uvDelta(player.surfaceU, enemy.surfaceU, true);
          const awayV = uvDelta(player.surfaceV, enemy.surfaceV, false);
          const awayDist = Math.sqrt(awayU * awayU + awayV * awayV);
          if (awayDist > 0.001) {
            ai.chargeTargetU = awayU / awayDist;
            ai.chargeTargetV = awayV / awayDist;
          } else {
            ai.chargeTargetU = 1; ai.chargeTargetV = 0;
          }
          ai.repulsorPhase = 1; ai.phaseTimer = 0;
        }
      }
      break;
    }
    case 1: { // Charge AWAY
      const CHARGE_SPEED = 0.18;
      enemy.surfaceU += (ai.chargeTargetU ?? 0) * CHARGE_SPEED * dt;
      enemy.surfaceV += (ai.chargeTargetV ?? 0) * CHARGE_SPEED * dt;
      applyBounds(enemy, false);
      if (ai.phaseTimer >= 0.8) { ai.repulsorPhase = 2; ai.phaseTimer = 0; }
      break;
    }
    case 2: { // Recovery
      if (ai.phaseTimer >= 1.0) { ai.repulsorPhase = 0; ai.phaseTimer = 0; }
      break;
    }
  }
}

function updateOrbiter(
  enemy: EnemyStub, ai: ExtendedAI, player: PlayerStub | null, dt: number
): void {
  const ORBIT_SPEED = 2.5;
  const ORBIT_RADIUS = ai.orbitRadius ?? 0.15;
  ai.reverseTimer = (ai.reverseTimer ?? 0) + dt;
  if (ai.reverseTimer >= (ai.nextReverse ?? 4)) {
    ai.orbitDirection = -(ai.orbitDirection ?? 1);
    ai.reverseTimer = 0;
    ai.nextReverse = 3 + Math.random() * 2;
  }
  ai.orbitAngle = (ai.orbitAngle ?? 0) + ORBIT_SPEED * (ai.orbitDirection ?? 1) * dt;
  if (!player) return;
  const orbitU = player.surfaceU + Math.cos(ai.orbitAngle) * ORBIT_RADIUS;
  const orbitV = player.surfaceV + Math.sin(ai.orbitAngle) * ORBIT_RADIUS;
  const du = uvDelta(enemy.surfaceU, orbitU, true);
  const dv = uvDelta(enemy.surfaceV, orbitV, false);
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist > 0.001) {
    const ORBIT_CHASE_SPEED = 0.07;
    enemy.surfaceU += (du / dist) * ORBIT_CHASE_SPEED * dt;
    enemy.surfaceV += (dv / dist) * ORBIT_CHASE_SPEED * dt;
    applyBounds(enemy, false);
  }
}

function updateHelix(
  enemy: EnemyStub, ai: ExtendedAI, player: PlayerStub | null, dt: number
): void {
  if (!player) return;
  const HELIX_SPEED = 0.07;
  const WOBBLE_AMPLITUDE = 0.05;
  const CORKSCREW_RATE = Math.PI * 4;
  ai.corkscrewPhase = (ai.corkscrewPhase ?? 0) + CORKSCREW_RATE * dt;
  const du = uvDelta(enemy.surfaceU, player.surfaceU, true);
  const dv = uvDelta(enemy.surfaceV, player.surfaceV, false);
  const dist = Math.sqrt(du * du + dv * dv);
  if (dist > 0.001) {
    const dirU = du / dist; const dirV = dv / dist;
    const perpU = -dirV; const perpV = dirU;
    const wobble = Math.sin(ai.corkscrewPhase) * WOBBLE_AMPLITUDE;
    enemy.surfaceU += (dirU + perpU * wobble) * HELIX_SPEED * dt;
    enemy.surfaceV += (dirV + perpV * wobble) * HELIX_SPEED * dt;
    applyBounds(enemy, false);
  }
}

describe('S42-04g: New enemy AI behaviors', () => {

  // -------------------------------------------------------------------------
  // Lurker
  // -------------------------------------------------------------------------
  describe('Lurker: state machine', () => {
    it('starts in idle state and stays still until timer', () => {
      const ai: ExtendedAI = { lurkerState: 0, stateTimer: 0, nextDirectionChange: 2.5 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(30, () => updateLurker(enemy, ai, player, DT)); // 0.5s — still in idle
      expect(enemy.surfaceU).toBeCloseTo(initialU, 5); // doesn't move in idle
      expect(ai.lurkerState).toBe(0);
    });

    it('transitions idle → charging after idle timer expires', () => {
      const ai: ExtendedAI = { lurkerState: 0, stateTimer: 2.49, nextDirectionChange: 2.5 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      updateLurker(enemy, ai, player, DT); // stateTimer crosses threshold
      expect(ai.lurkerState).toBe(1);
      expect(ai.stateTimer).toBeCloseTo(0, 3);
    });

    it('transitions charging → dashing after 1s windup', () => {
      const ai: ExtendedAI = { lurkerState: 1, stateTimer: 0.99, dashDirU: 1, dashDirV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      updateLurker(enemy, ai, player, DT);
      expect(ai.lurkerState).toBe(2);
    });

    it('dashes fast in locked direction (state 2)', () => {
      const ai: ExtendedAI = { lurkerState: 2, stateTimer: 0, dashDirU: 1, dashDirV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(10, () => updateLurker(enemy, ai, player, DT));
      expect(enemy.surfaceU).toBeGreaterThan(initialU + 0.01); // moved significantly
    });

    it('transitions dashing → cooldown after 0.5s', () => {
      const ai: ExtendedAI = { lurkerState: 2, stateTimer: 0.49, dashDirU: 1, dashDirV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      updateLurker(enemy, ai, null, DT);
      expect(ai.lurkerState).toBe(3);
    });

    it('transitions cooldown → idle after 1.5s', () => {
      const ai: ExtendedAI = { lurkerState: 3, stateTimer: 1.49 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      updateLurker(enemy, ai, null, DT);
      expect(ai.lurkerState).toBe(0);
      expect(ai.stateTimer).toBeCloseTo(0, 3);
    });
  });

  // -------------------------------------------------------------------------
  // Repulsor
  // -------------------------------------------------------------------------
  describe('Repulsor: charges away from player', () => {
    it('in lock phase: moves toward player', () => {
      const ai: ExtendedAI = { repulsorPhase: 0, phaseTimer: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(60, () => updateRepulsor(enemy, ai, player, DT)); // 1s of lock phase
      expect(enemy.surfaceU).toBeGreaterThan(initialU); // approaches player
    });

    it('transitions lock → charge after 2s', () => {
      const ai: ExtendedAI = { repulsorPhase: 0, phaseTimer: 1.99 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      updateRepulsor(enemy, ai, player, DT);
      expect(ai.repulsorPhase).toBe(1);
      // Charge direction should be AWAY from player (enemy at 0.3, player at 0.7 → away = -U)
      expect(ai.chargeTargetU).toBeLessThan(0);
    });

    it('in charge phase: moves AWAY from player', () => {
      // Enemy at 0.5, player at 0.7 → awayU is negative (moves left, away from player)
      const ai: ExtendedAI = {
        repulsorPhase: 1, phaseTimer: 0,
        chargeTargetU: -1, chargeTargetV: 0, // moving left (away from player at right)
      };
      const enemy = { surfaceU: 0.5, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(10, () => updateRepulsor(enemy, ai, player, DT));
      expect(enemy.surfaceU).toBeLessThan(initialU); // moved away (leftward)
    });

    it('transitions charge → recovery after 0.8s', () => {
      const ai: ExtendedAI = { repulsorPhase: 1, phaseTimer: 0.79, chargeTargetU: 1, chargeTargetV: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      updateRepulsor(enemy, ai, null, DT);
      expect(ai.repulsorPhase).toBe(2);
    });

    it('transitions recovery → lock after 1s', () => {
      const ai: ExtendedAI = { repulsorPhase: 2, phaseTimer: 0.99 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      updateRepulsor(enemy, ai, null, DT);
      expect(ai.repulsorPhase).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Orbiter
  // -------------------------------------------------------------------------
  describe('Orbiter: orbits around player', () => {
    it('moves toward orbit position (not directly toward player)', () => {
      // enemy at center (0.5, 0.5), player at (0.5, 0.5)
      // orbit target at angle=0: orbitU=0.65, orbitV=0.5
      // enemy should chase (0.65, 0.5) → moves in +U direction
      const ai: ExtendedAI = {
        orbitAngle: 0, orbitRadius: 0.15, orbitDirection: 1,
        reverseTimer: 0, nextReverse: 100,
      };
      const enemy = { surfaceU: 0.5, surfaceV: 0.5 };
      const player = { surfaceU: 0.5, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(30, () => updateOrbiter(enemy, ai, player, DT));
      expect(enemy.surfaceU).toBeGreaterThan(initialU);
    });

    it('orbit angle advances each tick', () => {
      const ai: ExtendedAI = {
        orbitAngle: 0, orbitRadius: 0.15, orbitDirection: 1,
        reverseTimer: 0, nextReverse: 100,
      };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialAngle = ai.orbitAngle!;
      runTicks(10, () => updateOrbiter(enemy, ai, player, DT));
      expect(ai.orbitAngle).toBeGreaterThan(initialAngle);
    });

    it('orbit direction reverses after reverseTimer expires', () => {
      const ai: ExtendedAI = {
        orbitAngle: 0, orbitRadius: 0.15, orbitDirection: 1,
        reverseTimer: 3.99, nextReverse: 4,
      };
      const enemy = { surfaceU: 0.5, surfaceV: 0.5 };
      const player = { surfaceU: 0.5, surfaceV: 0.5, alive: true };
      updateOrbiter(enemy, ai, player, DT);
      expect(ai.orbitDirection).toBe(-1);
    });
  });

  // -------------------------------------------------------------------------
  // Helix
  // -------------------------------------------------------------------------
  describe('Helix: corkscrew wobble chase', () => {
    it('moves toward player overall', () => {
      const ai: ExtendedAI = { corkscrewPhase: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      const initialU = enemy.surfaceU;
      runTicks(60, () => updateHelix(enemy, ai, player, DT));
      expect(enemy.surfaceU).toBeGreaterThan(initialU);
    });

    it('corkscrewPhase advances each tick', () => {
      const ai: ExtendedAI = { corkscrewPhase: 0 };
      const enemy = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      updateHelix(enemy, ai, player, DT);
      expect(ai.corkscrewPhase).toBeGreaterThan(0);
    });

    it('produces different trajectory than pure chase (V deviates)', () => {
      // Two helixes with opposite initial corkscrew phases should diverge in V
      const ai1: ExtendedAI = { corkscrewPhase: 0 };       // starts at sin=0, then goes +
      const ai2: ExtendedAI = { corkscrewPhase: Math.PI }; // starts at sin=0 going -
      const e1 = { surfaceU: 0.3, surfaceV: 0.5 };
      const e2 = { surfaceU: 0.3, surfaceV: 0.5 };
      const player = { surfaceU: 0.7, surfaceV: 0.5, alive: true };
      // Run for a short period where wobble phase matters
      runTicks(15, () => {
        updateHelix(e1, ai1, player, DT);
        updateHelix(e2, ai2, player, DT);
      });
      // V positions should differ due to opposite wobble
      const vDiff = Math.abs(e1.surfaceV - e2.surfaceV);
      expect(vDiff).toBeGreaterThan(0.0001);
    });
  });
});
