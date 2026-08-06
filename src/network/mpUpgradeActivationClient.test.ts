import { describe, expect, it, vi } from 'vitest';
import { MasteryPointStore, weaponTypeFromNodeId } from '../systems/MasteryPointStore';
import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';
import { WeaponType } from '../weapons/WeaponTypes';
import {
  filterMpBuildChoiceNodeIds,
  reconcileActiveUpgradeSnapshot,
  reconcileUpgradeActivationResult,
  upgradeActivationKey,
  type PendingUpgradeActivation,
} from './mpUpgradeActivationClient';

const SERVER_TO_WEAPON_TYPE = {
  standard: WeaponType.Standard,
  spread: WeaponType.Spread,
} satisfies Record<string, WeaponType>;

function makeStore(nodeIds: string[]): MasteryPointStore {
  const store = new MasteryPointStore();
  for (const nodeId of nodeIds) {
    const weaponType = weaponTypeFromNodeId(nodeId);
    if (!weaponType) continue;
    store.earnPoint(weaponType);
    store.spendPoint(nodeId);
  }
  return store;
}

function makePending(
  nodeId: string,
  weaponType: WeaponType,
): {
  tracker: MatchUpgradeTracker;
  pendingUpgradeActivations: Map<string, PendingUpgradeActivation>;
} {
  const tracker = new MatchUpgradeTracker(makeStore([nodeId]));
  tracker.onBuildChoiceAvailable = vi.fn();
  for (let i = 0; i < 10; i++) {
    tracker.recordKill(weaponType);
  }

  const pendingUpgradeActivations = new Map<string, PendingUpgradeActivation>([
    [upgradeActivationKey(nodeId, weaponType), { nodeId, weaponType }],
  ]);
  return { tracker, pendingUpgradeActivations };
}

describe('MP upgrade activation client reconciliation', () => {
  it('does not locally activate a pending upgrade before server acceptance', () => {
    const { tracker } = makePending('standard_a_1', WeaponType.Standard);

    expect(tracker.getPendingChoice()).not.toBeNull();
    expect(tracker.getActiveUpgrades(WeaponType.Standard).size).toBe(0);
  });

  it('activates local upgrade effects after server acceptance', () => {
    const { tracker, pendingUpgradeActivations } = makePending('standard_a_1', WeaponType.Standard);
    const onActivated = vi.fn();
    tracker.onUpgradeActivated = onActivated;

    const status = reconcileUpgradeActivationResult({
      accepted: true,
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      pendingUpgradeActivations,
      matchUpgradeTracker: tracker,
    });

    expect(status).toBe('accepted');
    expect(pendingUpgradeActivations.size).toBe(0);
    expect(tracker.getPendingChoice()).toBeNull();
    expect(tracker.getActiveUpgrades(WeaponType.Standard)).toContain('standard_a_1');
    expect(onActivated).toHaveBeenCalledWith('standard_a_1', WeaponType.Standard);
  });

  it('clears rejected duplicate or impossible activation without local active effects', () => {
    const { tracker, pendingUpgradeActivations } = makePending('standard_a_1', WeaponType.Standard);
    const onActivated = vi.fn();
    tracker.onUpgradeActivated = onActivated;

    const status = reconcileUpgradeActivationResult({
      accepted: false,
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      pendingUpgradeActivations,
      matchUpgradeTracker: tracker,
    });

    expect(status).toBe('rejected');
    expect(pendingUpgradeActivations.size).toBe(0);
    expect(tracker.getPendingChoice()).toBeNull();
    expect(tracker.getActiveUpgrades(WeaponType.Standard).size).toBe(0);
    expect(onActivated).not.toHaveBeenCalled();
  });

  it('treats an empty server active-upgrade snapshot as a complete clear', () => {
    const tracker = new MatchUpgradeTracker(makeStore([]));
    tracker.syncActiveUpgrades(WeaponType.Standard, ['standard_a_2']);
    tracker.syncActiveUpgrades(WeaponType.Spread, ['spread_a_1']);

    const activeKeys = reconcileActiveUpgradeSnapshot({
      activeUpgradeNodes: new Map<string, number>(),
      serverToWeaponType: SERVER_TO_WEAPON_TYPE,
      knownWeaponTypes: [WeaponType.Standard, WeaponType.Spread],
      matchUpgradeTracker: tracker,
    });

    expect(activeKeys).toEqual([]);
    expect(tracker.getActiveUpgrades(WeaponType.Standard).size).toBe(0);
    expect(tracker.getActiveUpgrades(WeaponType.Spread).size).toBe(0);
  });

  it('treats a reduced server active-upgrade snapshot as a replacement', () => {
    const tracker = new MatchUpgradeTracker(makeStore([]));
    tracker.syncActiveUpgrades(WeaponType.Standard, ['standard_a_2']);
    tracker.syncActiveUpgrades(WeaponType.Spread, ['spread_a_1', 'spread_a_2']);

    const activeKeys = reconcileActiveUpgradeSnapshot({
      activeUpgradeNodes: new Map<string, number>([['standard:standard_a_1', 1]]),
      serverToWeaponType: SERVER_TO_WEAPON_TYPE,
      knownWeaponTypes: [WeaponType.Standard, WeaponType.Spread],
      matchUpgradeTracker: tracker,
    });

    expect(activeKeys).toEqual(['standard:standard_a_1']);
    expect([...tracker.getActiveUpgrades(WeaponType.Standard)]).toEqual(['standard_a_1']);
    expect(tracker.getActiveUpgrades(WeaponType.Spread).size).toBe(0);
  });

  it('filters unsupported MP build choices while preserving supported choices', () => {
    expect(filterMpBuildChoiceNodeIds([
      'standard_a_1',
      'standard_b_4',
      'spread_b_2',
      'black_hole_al_4',
      'plasma_mortar_a_4',
    ])).toEqual({
      supportedNodeIds: ['standard_a_1', 'spread_b_2'],
      unsupportedNodeIds: ['standard_b_4', 'black_hole_al_4', 'plasma_mortar_a_4'],
      shouldShowChoiceScreen: true,
    });
  });

  it('lets the MP caller skip the build-choice overlay when all choices are unsupported', () => {
    expect(filterMpBuildChoiceNodeIds([
      'standard_b_4',
      'black_hole_al_4',
      'plasma_mortar_a_4',
    ])).toEqual({
      supportedNodeIds: [],
      unsupportedNodeIds: ['standard_b_4', 'black_hole_al_4', 'plasma_mortar_a_4'],
      shouldShowChoiceScreen: false,
    });
  });
});
