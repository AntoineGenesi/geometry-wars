import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom';
import {
  validateMpUpgradeActivation,
  type UpgradeActivationRequest,
  type UpgradeActivationResult,
} from './mpUpgradeActivation';
import { WeaponType } from '../../src/weapons/WeaponTypes';
import { STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS, getNodeById } from '../../src/systems/UpgradeTreeData';

function threshold(nodeId: string): number {
  const node = getNodeById(nodeId);
  if (!node) throw new Error(`missing upgrade node ${nodeId}`);
  return node.killThreshold;
}

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
    enemyWalkers: Map<string, unknown>;
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
  room.enemyWalkers = new Map();
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
      ['p1', new Map([[WeaponType.Standard, threshold('standard_a_1')]])],
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
    }, [], threshold('standard_a_1'))).toMatchObject({ accepted: false, reason: 'not_unlocked' });
  });

  it('rejects activations before the server-observed kill threshold', () => {
    expect(validate({
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_1'],
    }, [], threshold('standard_a_1') - 1)).toMatchObject({ accepted: false, reason: 'threshold_unmet' });
  });

  it('rejects activations with unmet prerequisites', () => {
    expect(validate({
      nodeId: 'standard_a_2',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_2'],
    }, [], threshold('standard_a_2'))).toMatchObject({ accepted: false, reason: 'prerequisite_unmet' });
  });

  it('accepts activations when prerequisites are active server-side', () => {
    expect(validate({
      nodeId: 'standard_a_2',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_2'],
    }, ['standard_a_1'], threshold('standard_a_2'))).toMatchObject({ accepted: true });
  });

  it('accepts default-unlocked Blaster Focus nodes through the normal threshold chain', () => {
    expect(validate({
      nodeId: 'standard_b_1',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: [...STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS],
    }, [], threshold('standard_b_1'))).toMatchObject({ accepted: true });

    expect(validate({
      nodeId: 'standard_b_2',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: [...STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS],
    }, ['standard_b_1'], threshold('standard_b_2'))).toMatchObject({ accepted: true });

    expect(validate({
      nodeId: 'standard_b_3',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: [...STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS],
    }, ['standard_b_1', 'standard_b_2'], threshold('standard_b_3'))).toMatchObject({ accepted: true });

    expect(validate({
      nodeId: 'standard_b_2',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: [...STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS],
    }, [], threshold('standard_b_2'))).toMatchObject({
      accepted: false,
      reason: 'prerequisite_unmet',
    });
  });

  it('rejects unsupported Spread nodes after entitlement and prerequisites pass', () => {
    expect(validate({
      nodeId: 'spread_ar_4',
      weaponType: WeaponType.Spread,
      unlockedNodeIds: ['spread_ar_4'],
    }, ['spread_a_3'], 120)).toMatchObject({
      accepted: false,
      reason: 'unsupported_runtime_effect',
    });
  });

  it('rejects unsupported Standard upper-tier activations after conflict cleanup', () => {
    expect(validate({
      nodeId: 'standard_ar_5',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_ar_5'],
    }, ['standard_a_4', 'standard_al_5'], threshold('standard_ar_5'))).toMatchObject({
      accepted: false,
      reason: 'unsupported_runtime_effect',
    });
  });

  it('rejects unsupported retained Black Hole and Plasma mastery nodes', () => {
    expect(validate({
      nodeId: 'black_hole_a_1',
      weaponType: WeaponType.BlackHole,
      unlockedNodeIds: ['black_hole_a_1'],
    }, [], 10)).toMatchObject({
      accepted: false,
      reason: 'unsupported_runtime_effect',
    });

    expect(validate({
      nodeId: 'black_hole_al_4',
      weaponType: WeaponType.BlackHole,
      unlockedNodeIds: ['black_hole_al_4'],
    }, ['black_hole_a_3'], 80)).toMatchObject({
      accepted: false,
      reason: 'unsupported_runtime_effect',
    });

    expect(validate({
      nodeId: 'plasma_mortar_a_4',
      weaponType: WeaponType.PlasmaMortar,
      unlockedNodeIds: ['plasma_mortar_a_4'],
    }, ['plasma_mortar_a_3'], 80)).toMatchObject({
      accepted: false,
      reason: 'unsupported_runtime_effect',
    });
  });

  it('still rejects proven Black Hole conflicting activations', () => {
    expect(validate({
      nodeId: 'black_hole_ar_4',
      weaponType: WeaponType.BlackHole,
      unlockedNodeIds: ['black_hole_ar_4'],
    }, ['black_hole_a_3', 'black_hole_al_4'], 80)).toMatchObject({
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
