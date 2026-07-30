import { describe, expect, it, vi } from 'vitest';
import { MasteryPointStore, weaponTypeFromNodeId } from '../systems/MasteryPointStore';
import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';
import { WeaponType } from '../weapons/WeaponTypes';
import {
  reconcileUpgradeActivationResult,
  upgradeActivationKey,
  type PendingUpgradeActivation,
} from './mpUpgradeActivationClient';

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
});
