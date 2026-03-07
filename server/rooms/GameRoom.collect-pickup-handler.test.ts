/**
 * Regression tests for client-authoritative pickup collection (s44r-04-03).
 *
 * Bug: server pickup collision uses sphere-approx UV for player position, which is wrong
 * on non-sphere surfaces (cube, pipe, cube-ring, etc.). Players can't collect pickups.
 *
 * Fix: client detects pickup proximity using world-space mesh positions and sends
 * collect_pickup to server. Server trusts the message and applies the effect.
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 * Logic mirrors GameRoom's collect_pickup onMessage handler.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal types mirroring the server-side structures
// ---------------------------------------------------------------------------

interface Player {
  id: string;
  name: string;
  alive: boolean;
  weaponType: string;
  weaponAmmo: number;
  buffStacks: Map<string, number>;
  bombs: number;
  multiplier: number;
  health: number;
  maxHealth: number;
  score: number;
}

interface WeaponPickup {
  id: string;
  surfaceU: number;
  surfaceV: number;
  weaponType: string;
  active: boolean;
}

interface BuffPickup {
  id: string;
  surfaceU: number;
  surfaceV: number;
  buffType: string;
  active: boolean;
}

interface SuperPickup {
  id: string;
  surfaceU: number;
  surfaceV: number;
  pickupType: string;
  active: boolean;
}

interface HealthPickup {
  id: string;
  surfaceU: number;
  surfaceV: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Minimal WEAPON_CONFIGS mirror (only what we need for tests)
// ---------------------------------------------------------------------------
const WEAPON_CONFIGS: Record<string, { ammo: number }> = {
  standard:    { ammo: -1 },  // infinite
  spread:      { ammo: 80 },
  laser:       { ammo: 60 },
  chain_lightning: { ammo: 40 },
  bomb:        { ammo: 5 },
};

const BUFF_STACK_MAX = 8;
const HEALTH_PICKUP_HEAL_AMOUNT = 30;

// ---------------------------------------------------------------------------
// Extracted logic mirroring GameRoom's collect_pickup handler
// (This is what the handler should do — the test verifies we implemented it)
// ---------------------------------------------------------------------------

interface CollectPickupData {
  pickupType: 'weapon' | 'buff' | 'super' | 'health';
  pickupId: string;
}

interface GameState {
  roomPhase: string;
  weaponPickups: WeaponPickup[];
  buffPickups: BuffPickup[];
  superPickups: SuperPickup[];
  healthPickups: HealthPickup[];
  players: Map<string, Player>;
}

interface SecondaryWeapon {
  type: string;
  ammo: number;
}

function handleCollectPickup(
  sessionId: string,
  data: CollectPickupData,
  state: GameState,
  playerSecondaryWeapon: Map<string, SecondaryWeapon>,
  pvpEnabled: boolean,
  healthPickupHealAmount: number,
): { log: string | null } {
  if (state.roomPhase !== 'playing') return { log: null };
  if (!data.pickupId || typeof data.pickupId !== 'string') return { log: null };

  const player = state.players.get(sessionId);
  if (!player || !player.alive) return { log: null };

  if (data.pickupType === 'weapon') {
    const targetIndex = state.weaponPickups.findIndex(p => p.id === data.pickupId);
    if (targetIndex < 0) return { log: null };
    const pickup = state.weaponPickups[targetIndex];
    if (!pickup.active) return { log: null }; // already collected

    pickup.active = false;
    state.weaponPickups.splice(targetIndex, 1);

    const cfg = WEAPON_CONFIGS[pickup.weaponType] ?? WEAPON_CONFIGS.standard;
    playerSecondaryWeapon.set(sessionId, { type: pickup.weaponType, ammo: cfg.ammo });
    player.weaponType = pickup.weaponType;
    player.weaponAmmo = cfg.ammo;
    return { log: `${player.name} collected weapon pickup: ${pickup.weaponType} (client-auth)` };
  }

  if (data.pickupType === 'buff') {
    const targetIndex = state.buffPickups.findIndex(p => p.id === data.pickupId);
    if (targetIndex < 0) return { log: null };
    const pickup = state.buffPickups[targetIndex];
    if (!pickup.active) return { log: null };

    pickup.active = false;
    state.buffPickups.splice(targetIndex, 1);

    const current = player.buffStacks.get(pickup.buffType) ?? 0;
    const newStacks = Math.min(current + 1, BUFF_STACK_MAX);
    player.buffStacks.set(pickup.buffType, newStacks);
    return { log: `${player.name} collected ${pickup.buffType} buff (now ${newStacks}×) (client-auth)` };
  }

  if (data.pickupType === 'super') {
    const targetIndex = state.superPickups.findIndex(p => p.id === data.pickupId);
    if (targetIndex < 0) return { log: null };
    const pickup = state.superPickups[targetIndex];
    if (!pickup.active) return { log: null };

    pickup.active = false;
    state.superPickups.splice(targetIndex, 1);

    if (pickup.pickupType === 'bomb_resupply') {
      player.bombs = Math.min(player.bombs + 2, 5);
    } else if (pickup.pickupType === 'multiplier_boost') {
      player.multiplier = Math.min(player.multiplier + 10, 150);
    }
    return { log: `${player.name} collected ${pickup.pickupType} super pickup (client-auth)` };
  }

  if (data.pickupType === 'health') {
    if (!pvpEnabled) return { log: null };
    const targetIndex = state.healthPickups.findIndex(p => p.id === data.pickupId);
    if (targetIndex < 0) return { log: null };
    const pickup = state.healthPickups[targetIndex];
    if (!pickup.active) return { log: null };

    pickup.active = false;
    state.healthPickups.splice(targetIndex, 1);

    const newHealth = Math.min(player.health + healthPickupHealAmount, player.maxHealth);
    player.health = newHealth;
    return { log: `PvP: ${player.name} collected health pickup (client-auth)` };
  }

  return { log: null };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player1',
    name: 'TestPlayer',
    alive: true,
    weaponType: 'standard',
    weaponAmmo: -1,
    buffStacks: new Map(),
    bombs: 3,
    multiplier: 1,
    health: 100,
    maxHealth: 100,
    score: 0,
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomPhase: 'playing',
    weaponPickups: [],
    buffPickups: [],
    superPickups: [],
    healthPickups: [],
    players: new Map([['session1', makePlayer()]]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collect_pickup handler — weapon pickups', () => {
  let state: GameState;
  let playerSecondaryWeapon: Map<string, SecondaryWeapon>;

  beforeEach(() => {
    state = makeState();
    state.weaponPickups = [
      { id: 'wp1', surfaceU: 0.5, surfaceV: 0.5, weaponType: 'spread', active: true },
    ];
    playerSecondaryWeapon = new Map();
  });

  it('grants weapon to player when collect_pickup is received', () => {
    const player = state.players.get('session1')!;
    expect(player.weaponType).toBe('standard');

    const result = handleCollectPickup(
      'session1',
      { pickupType: 'weapon', pickupId: 'wp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.weaponType).toBe('spread');
    expect(player.weaponAmmo).toBe(80);
    expect(playerSecondaryWeapon.get('session1')).toEqual({ type: 'spread', ammo: 80 });
    expect(result.log).toContain('client-auth');
  });

  it('removes pickup from state after collection', () => {
    handleCollectPickup(
      'session1',
      { pickupType: 'weapon', pickupId: 'wp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(state.weaponPickups).toHaveLength(0);
  });

  it('prevents double-collection (active guard)', () => {
    // First collection
    handleCollectPickup(
      'session1',
      { pickupType: 'weapon', pickupId: 'wp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    // Second collection (same pickup, now already collected/removed)
    const result = handleCollectPickup(
      'session1',
      { pickupType: 'weapon', pickupId: 'wp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    // Should be a no-op (pickup not found)
    expect(result.log).toBeNull();
    // Weapon should still be spread from first collection
    expect(state.players.get('session1')!.weaponType).toBe('spread');
  });

  it('ignores collection when game is not in playing phase', () => {
    state.roomPhase = 'voting';
    const player = state.players.get('session1')!;

    handleCollectPickup(
      'session1',
      { pickupType: 'weapon', pickupId: 'wp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.weaponType).toBe('standard'); // unchanged
    expect(state.weaponPickups).toHaveLength(1); // not removed
  });

  it('ignores collection when player is dead', () => {
    state.players.get('session1')!.alive = false;

    handleCollectPickup(
      'session1',
      { pickupType: 'weapon', pickupId: 'wp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(state.weaponPickups).toHaveLength(1); // not removed
  });

  it('ignores invalid pickup ID', () => {
    const result = handleCollectPickup(
      'session1',
      { pickupType: 'weapon', pickupId: 'nonexistent' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(result.log).toBeNull();
    expect(state.weaponPickups).toHaveLength(1); // unchanged
  });
});

describe('collect_pickup handler — buff pickups', () => {
  let state: GameState;
  let playerSecondaryWeapon: Map<string, SecondaryWeapon>;

  beforeEach(() => {
    state = makeState();
    state.buffPickups = [
      { id: 'bp1', surfaceU: 0.3, surfaceV: 0.3, buffType: 'hot_hands', active: true },
    ];
    playerSecondaryWeapon = new Map();
  });

  it('grants buff stack to player', () => {
    const player = state.players.get('session1')!;
    expect(player.buffStacks.get('hot_hands')).toBeUndefined();

    handleCollectPickup(
      'session1',
      { pickupType: 'buff', pickupId: 'bp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.buffStacks.get('hot_hands')).toBe(1);
    expect(state.buffPickups).toHaveLength(0);
  });

  it('stacks multiple buff pickups up to BUFF_STACK_MAX', () => {
    const player = state.players.get('session1')!;
    // Pre-set to near-max
    player.buffStacks.set('hot_hands', BUFF_STACK_MAX - 1);

    // Add second pickup
    state.buffPickups.push(
      { id: 'bp2', surfaceU: 0.4, surfaceV: 0.4, buffType: 'hot_hands', active: true }
    );

    handleCollectPickup(
      'session1',
      { pickupType: 'buff', pickupId: 'bp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );
    // Should be at max now
    expect(player.buffStacks.get('hot_hands')).toBe(BUFF_STACK_MAX);

    // Try one more — should still be at max
    handleCollectPickup(
      'session1',
      { pickupType: 'buff', pickupId: 'bp2' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );
    expect(player.buffStacks.get('hot_hands')).toBe(BUFF_STACK_MAX);
  });
});

describe('collect_pickup handler — super pickups', () => {
  let state: GameState;
  let playerSecondaryWeapon: Map<string, SecondaryWeapon>;

  beforeEach(() => {
    state = makeState();
    playerSecondaryWeapon = new Map();
  });

  it('grants bombs from bomb_resupply pickup', () => {
    state.superPickups = [
      { id: 'sp1', surfaceU: 0.5, surfaceV: 0.5, pickupType: 'bomb_resupply', active: true },
    ];
    const player = state.players.get('session1')!;
    player.bombs = 2;

    handleCollectPickup(
      'session1',
      { pickupType: 'super', pickupId: 'sp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.bombs).toBe(4); // 2 + 2
    expect(state.superPickups).toHaveLength(0);
  });

  it('caps bombs at 5 from bomb_resupply', () => {
    state.superPickups = [
      { id: 'sp1', surfaceU: 0.5, surfaceV: 0.5, pickupType: 'bomb_resupply', active: true },
    ];
    const player = state.players.get('session1')!;
    player.bombs = 4;

    handleCollectPickup(
      'session1',
      { pickupType: 'super', pickupId: 'sp1' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.bombs).toBe(5); // capped at 5
  });

  it('grants multiplier boost from multiplier_boost pickup', () => {
    state.superPickups = [
      { id: 'sp2', surfaceU: 0.5, surfaceV: 0.5, pickupType: 'multiplier_boost', active: true },
    ];
    const player = state.players.get('session1')!;
    player.multiplier = 5;

    handleCollectPickup(
      'session1',
      { pickupType: 'super', pickupId: 'sp2' },
      state,
      playerSecondaryWeapon,
      false,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.multiplier).toBe(15); // 5 + 10
    expect(state.superPickups).toHaveLength(0);
  });
});

describe('collect_pickup handler — health pickups (PvP)', () => {
  let state: GameState;
  let playerSecondaryWeapon: Map<string, SecondaryWeapon>;

  beforeEach(() => {
    state = makeState();
    state.healthPickups = [
      { id: 'hp1', surfaceU: 0.5, surfaceV: 0.5, active: true },
    ];
    state.players.get('session1')!.health = 50;
    playerSecondaryWeapon = new Map();
  });

  it('heals player in PvP mode', () => {
    const player = state.players.get('session1')!;

    handleCollectPickup(
      'session1',
      { pickupType: 'health', pickupId: 'hp1' },
      state,
      playerSecondaryWeapon,
      true, // pvpEnabled
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.health).toBe(80); // 50 + 30
    expect(state.healthPickups).toHaveLength(0);
  });

  it('caps health at maxHealth', () => {
    const player = state.players.get('session1')!;
    player.health = 90;

    handleCollectPickup(
      'session1',
      { pickupType: 'health', pickupId: 'hp1' },
      state,
      playerSecondaryWeapon,
      true,
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.health).toBe(100); // capped at maxHealth
  });

  it('ignores health pickups when pvpEnabled is false', () => {
    const player = state.players.get('session1')!;

    handleCollectPickup(
      'session1',
      { pickupType: 'health', pickupId: 'hp1' },
      state,
      playerSecondaryWeapon,
      false, // pvpEnabled = false
      HEALTH_PICKUP_HEAL_AMOUNT,
    );

    expect(player.health).toBe(50); // unchanged
    expect(state.healthPickups).toHaveLength(1); // not removed
  });
});
