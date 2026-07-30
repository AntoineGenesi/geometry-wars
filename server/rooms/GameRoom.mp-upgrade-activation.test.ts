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
});
