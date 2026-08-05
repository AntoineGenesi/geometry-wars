import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom';
import { WeaponType } from '../../src/weapons/WeaponTypes';
import { validateMpUpgradeActivation } from './mpUpgradeActivation';

function makeRoom() {
  const room = Object.create(GameRoom.prototype) as any;
  room.state = {
    gameTime: 0,
    surfaceType: 'sphere',
    bullets: [],
    players: new Map(),
  };
  room.playerActiveUpgradeNodes = new Map();
  room.playerUpgradeKillCounts = new Map();
  return room;
}

function makePlayer(weaponType: string = WeaponType.Standard) {
  return {
    id: 'p1',
    weaponType,
    weaponAmmo: weaponType === WeaponType.Standard ? -1 : 30,
    aimAngle: 0,
    surfaceU: 0.5,
    surfaceV: 0.5,
  };
}

function makeLifecycleRoom() {
  const room = Object.create(GameRoom.prototype) as any;
  const activeUpgradeNodes = new Map<string, number>([['standard:standard_a_1', 1]]);
  const player = {
    ...makePlayer(),
    activeUpgradeNodes,
    alive: true,
    buffStacks: new Map(),
    bombs: 3,
    deaths: 0,
    enemyKills: 0,
    health: 1,
    kills: 0,
    lives: 3,
    maxHealth: 1,
    multiplier: 1,
    playerKills: 0,
    playerLevel: 0,
    score: 100,
    shieldCount: 0,
    totalDamageDealt: 0,
    zoneTime: 0,
  };
  room.state = {
    roomPhase: 'playing',
    gameMode: 'waves',
    pvpMode: 'waves',
    surfaceType: 'cube',
    mapSize: 'medium',
    initialLives: 3,
    bullets: new Map(),
    players: new Map([['p1', player]]),
    enemies: new Map(),
    geoms: new Map(),
    weaponPickups: new Map(),
    superPickups: new Map(),
    buffPickups: new Map(),
    healthPickups: new Map(),
  };
  room.currentSettings = {
    startingWeapon: WeaponType.Standard,
    healingFrequency: 'normal',
    healingAmount: 1,
  };
  room.pendingSettings = null;
  room.maxClients = 1;
  room.KOTH_ZONE_DURATION = 10;
  room.surfaceManager = {
    initSurface: vi.fn(),
    getMeshSurface: vi.fn(() => null),
    getBoundingSphereRadius: vi.fn(() => 1),
    getWorldPosForUV: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    createWalker: vi.fn(() => null),
  };
  room.enemyWalkers = new Map();
  room.enemyAI = new Map();
  room.bulletDamageTracker = new Map();
  room.lastHealthPickupSpawnTime = new Map();
  room.playerInvincibility = new Map();
  room.lastNearMissLogTime = new Map();
  room.pendingRespawns = new Map();
  room._portalCooldowns = new Map();
  room._portalLocations = { A: null, B: null };
  room.pvpKillStreaks = new Map();
  room.playerWeaponInventory = new Map();
  room.playerWeaponIndex = new Map();
  room.playerPerfWindows = new Map();
  room.ddaDecreaseCounters = new Map();
  room.playerUpgradeKillCounts = new Map([['p1', new Map([[WeaponType.Standard, 25]])]]);
  room.playerActiveUpgradeNodes = new Map([
    ['p1', new Map([[WeaponType.Standard, new Set(['standard_a_1'])]])],
  ]);
  room._updateKothZoneWorldPos = vi.fn();
  room._clearPortalTimers = vi.fn();
  room.syncSettingsToState = vi.fn();
  room.setMetadata = vi.fn();
  room.broadcast = vi.fn();
  room.logger = { log: vi.fn() };
  return { room, activeUpgradeNodes };
}

describe('GameRoom MP weapon upgrade runtime parity', () => {
  it('emits one Standard starter bolt before mastery unlocks', () => {
    const room = makeRoom();
    const player = makePlayer();
    room.state.players.set('p1', player);

    room.tryShoot(player);

    const standardBullets = room.state.bullets.filter((b: any) => b.weaponType === WeaponType.Standard);
    expect(standardBullets).toHaveLength(1);
  });

  it('emits two Standard bolts when standard_a_1 is active', () => {
    const room = makeRoom();
    const player = makePlayer();
    room.state.players.set('p1', player);
    room.playerActiveUpgradeNodes.set('p1', new Map([
      [WeaponType.Standard, new Set(['standard_a_1'])],
    ]));

    room.tryShoot(player);

    const standardBullets = room.state.bullets.filter((b: any) => b.weaponType === WeaponType.Standard);
    expect(standardBullets).toHaveLength(2);
    expect(new Set(standardBullets.map((b: any) => b.dirY)).size).toBe(2);
  });

  it('emits upgraded Standard projectile patterns from server-authoritative nodes', () => {
    const room = makeRoom();
    const player = makePlayer();
    room.state.players.set('p1', player);
    room.playerActiveUpgradeNodes.set('p1', new Map([
      [WeaponType.Standard, new Set(['standard_a_4', 'standard_b_3'])],
    ]));

    room.tryShoot(player);

    const standardBullets = room.state.bullets.filter((b: any) => b.weaponType === WeaponType.Standard);
    expect(standardBullets).toHaveLength(9);
    expect(new Set(standardBullets.map((b: any) => b.dirY)).size).toBeGreaterThan(2);
  });

  it('emits upgraded Spread pellet count and applies server damage multiplier', () => {
    const room = makeRoom(WeaponType.Spread);
    const player = makePlayer(WeaponType.Spread);
    room.state.players.set('p1', player);
    room.playerActiveUpgradeNodes.set('p1', new Map([
      [WeaponType.Spread, new Set(['spread_a_1', 'spread_al_5'])],
    ]));

    room.tryShoot(player);

    const spreadBullets = room.state.bullets.filter((b: any) => b.weaponType === WeaponType.Spread);
    expect(spreadBullets).toHaveLength(11);
    expect(room.getUpgradeDamageMult('p1', WeaponType.Spread)).toBeCloseTo(1.15);
  });

  it('publishes accepted nodes through PlayerState when room state is present', () => {
    const room = makeRoom();
    const activeUpgradeNodes = new Map<string, number>();
    room.state.players.set('p1', { activeUpgradeNodes });
    room.playerUpgradeKillCounts.set('p1', new Map([[WeaponType.Standard, 10]]));
    room.logger = { log: vi.fn() };

    const result = room.handleUpgradeActivationRequest('p1', {
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_1'],
    });

    expect(result.accepted).toBe(true);
    expect(activeUpgradeNodes.get('standard:standard_a_1')).toBe(1);
  });

  it('clears private and schema upgrade state together at round reset', () => {
    const room = makeRoom();
    const activeUpgradeNodes = new Map<string, number>([['standard:standard_a_1', 1]]);
    room.state.players.set('p1', { activeUpgradeNodes });
    room.playerUpgradeKillCounts.set('p1', new Map([[WeaponType.Standard, 25]]));
    room.playerActiveUpgradeNodes.set('p1', new Map([
      [WeaponType.Standard, new Set(['standard_a_1'])],
    ]));

    room.clearActiveUpgradeState();

    expect(room.playerUpgradeKillCounts.size).toBe(0);
    expect(room.playerActiveUpgradeNodes.size).toBe(0);
    expect(activeUpgradeNodes.size).toBe(0);
  });

  it('startGame clears private and schema active upgrade state together', () => {
    const { room, activeUpgradeNodes } = makeLifecycleRoom();

    room.startGame();

    expect(room.playerUpgradeKillCounts.size).toBe(0);
    expect(room.playerActiveUpgradeNodes.size).toBe(0);
    expect(activeUpgradeNodes.size).toBe(0);
  });

  it('softRestartRound clears private and schema active upgrade state together', () => {
    const { room, activeUpgradeNodes } = makeLifecycleRoom();

    room.softRestartRound({
      surface: 'cube',
      mode: 'waves',
      infiniteLives: false,
      lives: 3,
      healingFrequency: 'normal',
      healingAmount: 1,
    });

    expect(room.playerUpgradeKillCounts.size).toBe(0);
    expect(room.playerActiveUpgradeNodes.size).toBe(0);
    expect(activeUpgradeNodes.size).toBe(0);
  });

  it('rejects accepted-tree nodes whose MP runtime effect is not implemented', () => {
    expect(validateMpUpgradeActivation({
      nodeId: 'standard_bl_5',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_bl_5'],
    }, {
      activeNodeIds: new Set(['standard_b_4']),
      killCount: 120,
    })).toMatchObject({ accepted: false, reason: 'unsupported_runtime_effect' });
  });

  it('rejects Standard heavy bolt until MP penetration is implemented', () => {
    expect(validateMpUpgradeActivation({
      nodeId: 'standard_b_4',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_b_4'],
    }, {
      activeNodeIds: new Set(['standard_b_3']),
      killCount: 120,
    })).toMatchObject({ accepted: false, reason: 'unsupported_runtime_effect' });
  });
});
