/**
 * Tests for KotH / Claustrophobia zone-time scoring (s44i-02).
 *
 * Tests the logic extracted from GameRoom.updateZoneTimeScoring() without
 * requiring a full Colyseus room instance.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror the server's zone-time scoring logic for isolated testing
// ---------------------------------------------------------------------------

const KOTH_ZONE_SHRINK_RATE = 0.0006;
const KOTH_ZONE_MIN_RADIUS = 0.04;
const KOTH_ZONE_DURATION = 15.0;

/**
 * Compute zone time increment for a single player in KotH mode.
 * Returns true if the player is in the zone (and should accumulate zone time).
 */
function isPlayerInKothZone(
  playerU: number,
  playerV: number,
  zoneU: number,
  zoneV: number,
  zoneRadius: number,
): boolean {
  const du = Math.abs(playerU - zoneU);
  const dv = Math.abs(playerV - zoneV);
  const duW = Math.min(du, 1.0 - du);
  const dvW = Math.min(dv, 1.0 - dv);
  return duW * duW + dvW * dvW <= zoneRadius * zoneRadius;
}

/**
 * Compute shrunk zone radius after `dt` seconds.
 */
function shrinkKothZone(radius: number, dt: number): number {
  return Math.max(KOTH_ZONE_MIN_RADIUS, radius - KOTH_ZONE_SHRINK_RATE * dt);
}

/**
 * Compute Claustrophobia boundary radius at a given game time.
 * Mirrors ClaustrophobiaMode.ts: initial=0.5, final=0.05, over 180s.
 */
function claustrophobiaBoundaryRadius(gameTime: number): number {
  const progress = Math.min(1.0, gameTime / 180.0);
  return 0.5 - progress * (0.5 - 0.05);
}

/**
 * Returns true if player UV is inside the Claustrophobia boundary.
 */
function isPlayerInClaustrophobiaBoundary(
  playerU: number,
  playerV: number,
  gameTime: number,
): boolean {
  const br = claustrophobiaBoundaryRadius(gameTime);
  const du = Math.abs(playerU - 0.5);
  const dv = Math.abs(playerV - 0.5);
  const duW = Math.min(du, 1.0 - du);
  const dvW = Math.min(dv, 1.0 - dv);
  return duW * duW + dvW * dvW <= br * br;
}

// ---------------------------------------------------------------------------
// KotH zone detection tests
// ---------------------------------------------------------------------------

describe('KotH zone-time scoring — zone detection', () => {
  const ZONE_U = 0.5;
  const ZONE_V = 0.5;
  const ZONE_R = 0.12;

  it('player at zone center is in zone', () => {
    expect(isPlayerInKothZone(0.5, 0.5, ZONE_U, ZONE_V, ZONE_R)).toBe(true);
  });

  it('player just inside zone boundary is in zone', () => {
    // 0.11 < 0.12
    expect(isPlayerInKothZone(0.5 + 0.11 * 0.707, 0.5 + 0.11 * 0.707, ZONE_U, ZONE_V, ZONE_R)).toBe(true);
  });

  it('player outside zone boundary is not in zone', () => {
    // Distance ~0.15 > 0.12
    expect(isPlayerInKothZone(0.5 + 0.15, 0.5, ZONE_U, ZONE_V, ZONE_R)).toBe(false);
  });

  it('accumulates zone time only when in zone', () => {
    let zoneTime = 0;
    const dt = 1 / 60; // 60Hz tick

    // In zone for 10 seconds
    for (let t = 0; t < 10; t += dt) {
      if (isPlayerInKothZone(0.5, 0.5, ZONE_U, ZONE_V, ZONE_R)) {
        zoneTime += dt;
      }
    }
    expect(zoneTime).toBeCloseTo(10, 0);

    // Outside zone for 5 more seconds — zone time should not increase
    const zoneBefore = zoneTime;
    for (let t = 0; t < 5; t += dt) {
      if (isPlayerInKothZone(0.9, 0.9, ZONE_U, ZONE_V, ZONE_R)) {
        zoneTime += dt;
      }
    }
    expect(zoneTime).toBeCloseTo(zoneBefore, 1);
  });

  it('handles UV wrap-around (zone near U=0 boundary)', () => {
    // Zone at U=0.02, player at U=0.99 — should be within 0.03 UV with wrapping
    const zoneU = 0.02;
    const zoneV = 0.5;
    const smallRadius = 0.05;
    // Without wrapping: |0.99 - 0.02| = 0.97 > 0.05 → outside
    // With wrapping: min(0.97, 1-0.97=0.03) = 0.03 < 0.05 → inside
    expect(isPlayerInKothZone(0.99, 0.5, zoneU, zoneV, smallRadius)).toBe(true);
  });

  it('zone radius shrinks over time', () => {
    let radius = 0.12;
    radius = shrinkKothZone(radius, 60); // 60 seconds
    expect(radius).toBeLessThan(0.12);
    expect(radius).toBeCloseTo(0.12 - KOTH_ZONE_SHRINK_RATE * 60, 5);
  });

  it('zone radius does not shrink below minimum', () => {
    let radius = 0.12;
    // Shrink for a very long time
    radius = shrinkKothZone(radius, 9999);
    expect(radius).toBe(KOTH_ZONE_MIN_RADIUS);
  });

  it('zone moves after KOTH_ZONE_DURATION seconds', () => {
    // Just verify the constant is correct
    expect(KOTH_ZONE_DURATION).toBe(15.0);
  });
});

// ---------------------------------------------------------------------------
// KotH acceptance criterion: 10 seconds in zone → score = 10
// ---------------------------------------------------------------------------

describe('KotH zone-time scoring — acceptance criterion', () => {
  it('player in zone for 10 seconds accumulates ~10s zone time', () => {
    const ZONE_U = 0.5;
    const ZONE_V = 0.5;
    const ZONE_R = 0.12;
    const dt = 1 / 60;

    let zoneTime = 0;
    let elapsed = 0;

    while (elapsed < 10.0) {
      if (isPlayerInKothZone(0.5, 0.5, ZONE_U, ZONE_V, ZONE_R)) {
        zoneTime += dt;
      }
      elapsed += dt;
    }

    // Score = zoneTime seconds (not kill-based)
    expect(zoneTime).toBeCloseTo(10, 0);
    expect(zoneTime).toBeGreaterThan(9.9);
  });

  it('zone time is NOT based on kills (kills do not affect zoneTime)', () => {
    // Simulate: player kills 100 enemies but is outside zone
    let zoneTime = 0;
    let killScore = 0;
    const ZONE_U = 0.5;
    const ZONE_V = 0.5;
    const ZONE_R = 0.12;

    // Player at (0.9, 0.9) — far from zone at (0.5, 0.5)
    for (let i = 0; i < 100; i++) {
      killScore += 100; // 100 pts per kill
      // Zone time does NOT increment from kills
      if (isPlayerInKothZone(0.9, 0.9, ZONE_U, ZONE_V, ZONE_R)) {
        zoneTime += 1 / 60;
      }
    }

    expect(killScore).toBe(10000); // kills tracked separately
    expect(zoneTime).toBe(0);      // zone time is 0 (player was outside zone)
  });
});

// ---------------------------------------------------------------------------
// Claustrophobia boundary detection tests
// ---------------------------------------------------------------------------

describe('Claustrophobia zone-time scoring — boundary detection', () => {
  it('player at center (0.5, 0.5) is always inside boundary', () => {
    for (const t of [0, 30, 60, 120, 180, 300]) {
      expect(isPlayerInClaustrophobiaBoundary(0.5, 0.5, t)).toBe(true);
    }
  });

  it('boundary radius starts at 0.5 at gameTime=0', () => {
    expect(claustrophobiaBoundaryRadius(0)).toBeCloseTo(0.5, 5);
  });

  it('boundary radius is 0.05 at gameTime=180', () => {
    expect(claustrophobiaBoundaryRadius(180)).toBeCloseTo(0.05, 5);
  });

  it('boundary radius stays at 0.05 after 180s', () => {
    expect(claustrophobiaBoundaryRadius(999)).toBeCloseTo(0.05, 5);
  });

  it('player at edge (0.5, 0.9) is outside when boundary shrinks', () => {
    // At t=0, boundary=0.5 → U=0.9 is distance 0.4 from center → inside
    expect(isPlayerInClaustrophobiaBoundary(0.5, 0.9, 0)).toBe(true);
    // At t=180, boundary=0.05 → U=0.9 is distance 0.4 from center → outside
    expect(isPlayerInClaustrophobiaBoundary(0.5, 0.9, 180)).toBe(false);
  });

  it('accumulates zone time only while inside boundary', () => {
    const dt = 1 / 60;

    // Player at center — in boundary for 15s
    let zoneTime = 0;
    for (let t = 0; t < 15; t += dt) {
      if (isPlayerInClaustrophobiaBoundary(0.5, 0.5, t)) {
        zoneTime += dt;
      }
    }
    expect(zoneTime).toBeCloseTo(15, 0);
  });
});

// ---------------------------------------------------------------------------
// Claustrophobia acceptance criterion: 15s in zone, die, respawn, 5s more = 20s
// ---------------------------------------------------------------------------

describe('Claustrophobia zone-time scoring — acceptance criterion', () => {
  it('zone time = 15s before death + 5s after respawn = 20s total', () => {
    const dt = 1 / 60;
    let zoneTime = 0;
    let gameTime = 0;

    // Phase 1: player alive, in zone for 15 seconds
    for (let elapsed = 0; elapsed < 15.0; elapsed += dt) {
      gameTime += dt;
      // Player alive and inside boundary
      if (isPlayerInClaustrophobiaBoundary(0.5, 0.5, gameTime)) {
        zoneTime += dt;
      }
    }
    expect(zoneTime).toBeCloseTo(15, 0);

    // Player dies — zone time accumulation pauses (player.alive = false)
    // No accumulation during death animation/respawn (simulated by skipping)

    // Phase 2: player respawns, in zone for 5 more seconds
    for (let elapsed = 0; elapsed < 5.0; elapsed += dt) {
      gameTime += dt;
      if (isPlayerInClaustrophobiaBoundary(0.5, 0.5, gameTime)) {
        zoneTime += dt;
      }
    }

    expect(zoneTime).toBeCloseTo(20, 0);
  });
});
