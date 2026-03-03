/**
 * Integration tests for PvP health pickup system (s44j-pvp-13c).
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 * Logic mirrors GameRoom's health pickup spawn/collection/expiry behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  PLAYER_PVP_MAX_HEALTH,
  HEALTH_PICKUP_THRESHOLD,
  HEALTH_PICKUP_SPAWN_FREQUENCY,
  HEALTH_PICKUP_HEAL_AMOUNT,
  HEALTH_PICKUP_LIFETIME,
  HEALTH_PICKUP_SPAWN_RADIUS,
} from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Minimal types mirroring the server-side structures
// ---------------------------------------------------------------------------

interface Player {
  id: string;
  health: number;
  maxHealth: number;
  surfaceU: number;
  surfaceV: number;
  alive: boolean;
}

interface HealthPickup {
  id: string;
  surfaceU: number;
  surfaceV: number;
  active: boolean;
  age: number;
}

// ---------------------------------------------------------------------------
// Extracted logic (mirrors GameRoom methods)
// ---------------------------------------------------------------------------

let nextPickupId = 0;

function spawnHealthPickup(
  u: number,
  v: number,
  pickups: HealthPickup[],
): HealthPickup {
  const pickup: HealthPickup = {
    id: `hp${nextPickupId++}`,
    surfaceU: u + (Math.random() - 0.5) * HEALTH_PICKUP_SPAWN_RADIUS,
    surfaceV: v + (Math.random() - 0.5) * HEALTH_PICKUP_SPAWN_RADIUS,
    active: true,
    age: 0,
  };
  pickups.push(pickup);
  return pickup;
}

function trySpawnHealthPickupForDamagedPlayer(
  target: Player,
  pvpEnabled: boolean,
  lastSpawnTimes: Map<string, number>,
  gameTime: number,
  pickups: HealthPickup[],
  frequency: number = HEALTH_PICKUP_SPAWN_FREQUENCY,
): boolean {
  if (!pvpEnabled) return false;
  if (target.health <= 0) return false; // dead player — handled by kill logic
  if (target.health / target.maxHealth >= HEALTH_PICKUP_THRESHOLD) return false;
  const lastSpawn = lastSpawnTimes.get(target.id) ?? -Infinity;
  if (gameTime - lastSpawn < frequency) return false;
  spawnHealthPickup(target.surfaceU, target.surfaceV, pickups);
  lastSpawnTimes.set(target.id, gameTime);
  return true;
}

function updateHealthPickups(pickups: HealthPickup[], dt: number): HealthPickup[] {
  const toRemove: number[] = [];
  pickups.forEach((p, i) => {
    if (!p.active) { toRemove.push(i); return; }
    p.age += dt;
    if (p.age > HEALTH_PICKUP_LIFETIME) {
      p.active = false;
      toRemove.push(i);
    }
  });
  for (let i = toRemove.length - 1; i >= 0; i--) {
    pickups.splice(toRemove[i], 1);
  }
  return pickups;
}

const PICKUP_COLLECT_RADIUS = 0.04; // UV-space threshold used in tests

function collectHealthPickups(
  player: Player,
  pickups: HealthPickup[],
  healAmount: number = HEALTH_PICKUP_HEAL_AMOUNT,
): number[] {
  const collected: number[] = [];
  pickups.forEach((pickup, index) => {
    if (!pickup.active) return;
    const du = player.surfaceU - pickup.surfaceU;
    const dv = player.surfaceV - pickup.surfaceV;
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist < PICKUP_COLLECT_RADIUS) {
      pickup.active = false;
      collected.push(index);
      player.health = Math.min(player.health + healAmount, player.maxHealth);
    }
  });
  return collected;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(id: string, health = PLAYER_PVP_MAX_HEALTH, u = 0.5, v = 0.5): Player {
  return { id, health, maxHealth: PLAYER_PVP_MAX_HEALTH, surfaceU: u, surfaceV: v, alive: true };
}

// ---------------------------------------------------------------------------
// Tests: constants
// ---------------------------------------------------------------------------

describe('Health pickup constants', () => {
  it('HEALTH_PICKUP_THRESHOLD is 0.70', () => {
    expect(HEALTH_PICKUP_THRESHOLD).toBe(0.70);
  });

  it('HEALTH_PICKUP_SPAWN_FREQUENCY default is 30 seconds', () => {
    expect(HEALTH_PICKUP_SPAWN_FREQUENCY).toBe(30);
  });

  it('HEALTH_PICKUP_HEAL_AMOUNT default is 20 HP', () => {
    expect(HEALTH_PICKUP_HEAL_AMOUNT).toBe(20);
  });

  it('HEALTH_PICKUP_LIFETIME is 10 seconds', () => {
    expect(HEALTH_PICKUP_LIFETIME).toBe(10.0);
  });
});

// ---------------------------------------------------------------------------
// Tests: spawn near damaged player
// ---------------------------------------------------------------------------

describe('Health pickup: spawn near damaged player', () => {
  it('spawns when health < 70% of maxHealth (pvpEnabled)', () => {
    const player = makePlayer('p1');
    player.health = 69; // below 70%
    const pickups: HealthPickup[] = [];
    const spawned = trySpawnHealthPickupForDamagedPlayer(player, true, new Map(), 0, pickups);
    expect(spawned).toBe(true);
    expect(pickups).toHaveLength(1);
  });

  it('does NOT spawn when health >= 70%', () => {
    const player = makePlayer('p1');
    player.health = 70; // exactly 70%
    const pickups: HealthPickup[] = [];
    const spawned = trySpawnHealthPickupForDamagedPlayer(player, true, new Map(), 0, pickups);
    expect(spawned).toBe(false);
    expect(pickups).toHaveLength(0);
  });

  it('does NOT spawn when pvpEnabled === false', () => {
    const player = makePlayer('p1');
    player.health = 50;
    const pickups: HealthPickup[] = [];
    const spawned = trySpawnHealthPickupForDamagedPlayer(player, false, new Map(), 0, pickups);
    expect(spawned).toBe(false);
    expect(pickups).toHaveLength(0);
  });

  it('does NOT spawn on a freshly killed player (health = 0)', () => {
    const player = makePlayer('p1');
    player.health = 0;
    const pickups: HealthPickup[] = [];
    const spawned = trySpawnHealthPickupForDamagedPlayer(player, true, new Map(), 0, pickups);
    expect(spawned).toBe(false);
    expect(pickups).toHaveLength(0);
  });

  it('spawn position is within HEALTH_PICKUP_SPAWN_RADIUS of the player UV', () => {
    const player = makePlayer('p1', 50, 0.5, 0.5);
    const pickups: HealthPickup[] = [];
    trySpawnHealthPickupForDamagedPlayer(player, true, new Map(), 0, pickups);
    expect(pickups).toHaveLength(1);
    const du = Math.abs(pickups[0].surfaceU - player.surfaceU);
    const dv = Math.abs(pickups[0].surfaceV - player.surfaceV);
    expect(du).toBeLessThanOrEqual(HEALTH_PICKUP_SPAWN_RADIUS / 2 + 0.001);
    expect(dv).toBeLessThanOrEqual(HEALTH_PICKUP_SPAWN_RADIUS / 2 + 0.001);
  });
});

// ---------------------------------------------------------------------------
// Tests: spawn frequency cooldown
// ---------------------------------------------------------------------------

describe('Health pickup: spawn frequency cooldown', () => {
  it('respects spawn frequency — does not spawn before cooldown elapses', () => {
    const player = makePlayer('p1', 50);
    const pickups: HealthPickup[] = [];
    const lastSpawnTimes = new Map<string, number>();

    // First spawn at t=0
    trySpawnHealthPickupForDamagedPlayer(player, true, lastSpawnTimes, 0, pickups);
    expect(pickups).toHaveLength(1);

    // Attempt at t=15 (before 30s cooldown)
    trySpawnHealthPickupForDamagedPlayer(player, true, lastSpawnTimes, 15, pickups);
    expect(pickups).toHaveLength(1); // no new pickup

    // Attempt at t=30 (cooldown elapsed)
    trySpawnHealthPickupForDamagedPlayer(player, true, lastSpawnTimes, 30, pickups);
    expect(pickups).toHaveLength(2); // new pickup spawned
  });

  it('different players have independent cooldowns', () => {
    const p1 = makePlayer('p1', 50);
    const p2 = makePlayer('p2', 50);
    const pickups: HealthPickup[] = [];
    const lastSpawnTimes = new Map<string, number>();

    trySpawnHealthPickupForDamagedPlayer(p1, true, lastSpawnTimes, 0, pickups);
    trySpawnHealthPickupForDamagedPlayer(p2, true, lastSpawnTimes, 0, pickups);
    expect(pickups).toHaveLength(2); // each player gets their own cooldown
  });

  it('configurable spawn frequency is respected', () => {
    const player = makePlayer('p1', 50);
    const pickups: HealthPickup[] = [];
    const lastSpawnTimes = new Map<string, number>();
    const customFrequency = 10;

    trySpawnHealthPickupForDamagedPlayer(player, true, lastSpawnTimes, 0, pickups, customFrequency);
    trySpawnHealthPickupForDamagedPlayer(player, true, lastSpawnTimes, 9, pickups, customFrequency);
    expect(pickups).toHaveLength(1); // not yet

    trySpawnHealthPickupForDamagedPlayer(player, true, lastSpawnTimes, 10, pickups, customFrequency);
    expect(pickups).toHaveLength(2); // now
  });
});

// ---------------------------------------------------------------------------
// Tests: pickup expiration
// ---------------------------------------------------------------------------

describe('Health pickup: expiration after 10 seconds', () => {
  it('pickup expires and is removed after HEALTH_PICKUP_LIFETIME', () => {
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: 0.5, surfaceV: 0.5, active: true, age: 0 },
    ];

    // Advance time but not enough to expire
    updateHealthPickups(pickups, HEALTH_PICKUP_LIFETIME - 0.1);
    expect(pickups).toHaveLength(1);
    expect(pickups[0].active).toBe(true);

    // Advance past lifetime
    updateHealthPickups(pickups, 0.2);
    expect(pickups).toHaveLength(0);
  });

  it('multiple pickups expire independently', () => {
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: 0.5, surfaceV: 0.5, active: true, age: 8 },
      { id: 'hp1', surfaceU: 0.6, surfaceV: 0.6, active: true, age: 0 },
    ];

    updateHealthPickups(pickups, 2.5); // hp0 age → 10.5 (expired), hp1 age → 2.5 (alive)
    expect(pickups).toHaveLength(1);
    expect(pickups[0].id).toBe('hp1');
  });

  it('inactive pickups are cleaned up without lifetime penalty', () => {
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: 0.5, surfaceV: 0.5, active: false, age: 0 },
    ];
    updateHealthPickups(pickups, 0.016);
    expect(pickups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: collection heals player
// ---------------------------------------------------------------------------

describe('Health pickup: collection heals player', () => {
  it('collecting a pickup restores HEALTH_PICKUP_HEAL_AMOUNT HP', () => {
    const player = makePlayer('p1', 50);
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: player.surfaceU, surfaceV: player.surfaceV, active: true, age: 0 },
    ];

    collectHealthPickups(player, pickups);
    expect(player.health).toBe(50 + HEALTH_PICKUP_HEAL_AMOUNT);
    expect(pickups[0].active).toBe(false);
  });

  it('healing is clamped to maxHealth', () => {
    const player = makePlayer('p1', PLAYER_PVP_MAX_HEALTH - 5); // 5 HP below max
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: player.surfaceU, surfaceV: player.surfaceV, active: true, age: 0 },
    ];

    collectHealthPickups(player, pickups); // heal 20, but only 5 available
    expect(player.health).toBe(PLAYER_PVP_MAX_HEALTH); // clamped to max
  });

  it('does not collect pickup outside collision radius', () => {
    const player = makePlayer('p1', 50);
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: player.surfaceU + 0.2, surfaceV: player.surfaceV + 0.2, active: true, age: 0 },
    ];

    collectHealthPickups(player, pickups);
    expect(player.health).toBe(50); // no change
    expect(pickups[0].active).toBe(true);
  });

  it('does not collect an inactive pickup', () => {
    const player = makePlayer('p1', 50);
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: player.surfaceU, surfaceV: player.surfaceV, active: false, age: 0 },
    ];

    collectHealthPickups(player, pickups);
    expect(player.health).toBe(50); // no change
  });

  it('configurable heal amount is applied', () => {
    const player = makePlayer('p1', 50);
    const pickups: HealthPickup[] = [
      { id: 'hp0', surfaceU: player.surfaceU, surfaceV: player.surfaceV, active: true, age: 0 },
    ];

    collectHealthPickups(player, pickups, 35);
    expect(player.health).toBe(85);
  });
});
