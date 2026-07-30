import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom';
import {
  validateMpUpgradeActivation,
  type UpgradeActivationRequest,
  type UpgradeActivationResult,
} from './mpUpgradeActivation';
import { WeaponType } from '../../src/weapons/WeaponTypes';

function validate(
  request: UpgradeActivationRequest,
  activeNodeIds: string[],
  killCount: number,
): UpgradeActivationResult {
  return validateMpUpgradeActivation(request, {
    activeNodeIds: new Set(activeNodeIds),
    killCount,
  });
}

function makeRoomForKillPath() {
  const room = Object.create(GameRoom.prototype) as {
    state: {
      roomPhase: string;
      players: Map<string, any>;
      enemies: any[];
    };
    enemyAI: Map<string, unknown>;
    playerUpgradeKillCounts: Map<string, Map<string, number>>;
    playerActiveUpgradeNodes: Map<string, Map<string, Set<string>>>;
    logger: { log: ReturnType<typeof vi.fn> };
    broadcast: ReturnType<typeof vi.fn>;
    trackDDAKill: ReturnType<typeof vi.fn>;
    spawnWeaponPickup: ReturnType<typeof vi.fn>;
    spawnBuffPickup: ReturnType<typeof vi.fn>;
    spawnShieldPickup: ReturnType<typeof vi.fn>;
    handleCompanionHit(sessionId: string, enemyId: string): void;
    useBomb(player: any): void;
    getUpgradeKillCount(sessionId: string, weaponType: string): number;
  };
  const player = {
    id: 'p1',
    name: 'Player 1',
    weaponType: WeaponType.TeslaCoil,
    score: 0,
    multiplier: 1,
    playerKills: 0,
    enemyKills: 0,
    playerLevel: 0,
    bombs: 1,
  };
  room.state = {
    roomPhase: 'playing',
    players: new Map([['p1', player]]),
    enemies: [],
  };
  room.enemyAI = new Map();
  room.playerUpgradeKillCounts = new Map();
  room.playerActiveUpgradeNodes = new Map();
  room.logger = { log: vi.fn() };
  room.broadcast = vi.fn();
  room.trackDDAKill = vi.fn();
  room.spawnWeaponPickup = vi.fn();
  room.spawnBuffPickup = vi.fn();
  room.spawnShieldPickup = vi.fn();
  return { room, player };
}

describe('MP upgrade activation validation', () => {
  it('accepts one valid activation and then rejects the duplicate in GameRoom state', () => {
    const room = Object.create(GameRoom.prototype) as {
      playerUpgradeKillCounts: Map<string, Map<string, number>>;
      playerActiveUpgradeNodes: Map<string, Map<string, Set<string>>>;
      logger: { log: ReturnType<typeof vi.fn> };
      handleUpgradeActivationRequest(sessionId: string, data: UpgradeActivationRequest): UpgradeActivationResult;
    };
    room.playerUpgradeKillCounts = new Map([
      ['p1', new Map([[WeaponType.Standard, 10]])],
    ]);
    room.playerActiveUpgradeNodes = new Map();
    room.logger = { log: vi.fn() };

    const request = {
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_1'],
    };

    expect(room.handleUpgradeActivationRequest('p1', request)).toMatchObject({
      accepted: true,
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
    });
    expect(room.handleUpgradeActivationRequest('p1', request)).toMatchObject({
      accepted: false,
      reason: 'duplicate',
    });
  });

  it('rejects unknown node IDs', () => {
    expect(validate({
      nodeId: 'standard_not_real',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_not_real'],
    }, [], 999)).toMatchObject({ accepted: false, reason: 'unknown_node' });
  });

  it('rejects weapon mismatch requests', () => {
    expect(validate({
      nodeId: 'standard_a_1',
      weaponType: WeaponType.PlasmaMortar,
      unlockedNodeIds: ['standard_a_1'],
    }, [], 999)).toMatchObject({ accepted: false, reason: 'weapon_mismatch' });
  });

  it('rejects activations without client-provided persistent unlock entitlement', () => {
    expect(validate({
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: [],
    }, [], 10)).toMatchObject({ accepted: false, reason: 'not_unlocked' });
  });

  it('rejects activations before the server-observed kill threshold', () => {
    expect(validate({
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_1'],
    }, [], 9)).toMatchObject({ accepted: false, reason: 'threshold_unmet' });
  });

  it('rejects activations with unmet prerequisites', () => {
    expect(validate({
      nodeId: 'standard_a_2',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_2'],
    }, [], 25)).toMatchObject({ accepted: false, reason: 'prerequisite_unmet' });
  });

  it('accepts activations when prerequisites are active server-side', () => {
    expect(validate({
      nodeId: 'standard_a_2',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_2'],
    }, ['standard_a_1'], 25)).toMatchObject({ accepted: true });
  });

  it('rejects excluded/conflicting activations', () => {
    expect(validate({
      nodeId: 'standard_ar_5',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_ar_5'],
    }, ['standard_a_4', 'standard_al_5'], 120)).toMatchObject({
      accepted: false,
      reason: 'excluded',
    });
  });

  it('companion_hit increments server upgrade kill count for the active server weapon', () => {
    const { room } = makeRoomForKillPath();
    room.state.enemies.push({
      id: 'e1',
      type: 'grunt',
      alive: true,
      health: 1,
      surfaceU: 0.5,
      surfaceV: 0.5,
    });

    room.handleCompanionHit('p1', 'e1');

    expect(room.getUpgradeKillCount('p1', WeaponType.TeslaCoil)).toBe(1);
    expect(room.state.enemies).toHaveLength(0);
  });

  it('bomb kills increment server upgrade kill count for every killed enemy', () => {
    const { room, player } = makeRoomForKillPath();
    player.weaponType = WeaponType.Standard;
    room.state.enemies.push(
      { id: 'e1', type: 'grunt', alive: true, health: 1, surfaceU: 0.1, surfaceV: 0.1 },
      { id: 'e2', type: 'grunt', alive: true, health: 1, surfaceU: 0.2, surfaceV: 0.2 },
    );

    room.useBomb(player);

    expect(room.getUpgradeKillCount('p1', WeaponType.Standard)).toBe(2);
    expect(player.playerKills).toBe(2);
    expect(room.state.enemies).toHaveLength(0);
  });
});
