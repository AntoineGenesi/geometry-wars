import { describe, expect, it, vi } from 'vitest';
import { MasteryPointStore, weaponTypeFromNodeId } from '../systems/MasteryPointStore';
import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';
import { getNodeById } from '../systems/UpgradeTreeData';
import { WeaponType } from '../weapons/WeaponTypes';
import {
  filterMpBuildChoiceNodeIds,
  handleMpBuildChoiceAvailability,
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
  const tracker = new MatchUpgradeTracker(makeStore([nodeId]), { autoApplySingleNode: false });
  tracker.onBuildChoiceAvailable = vi.fn();
  const node = getNodeById(nodeId);
  expect(node).toBeDefined();
  expect(node?.id).toBe(nodeId);
  for (let i = 0; i < node!.killThreshold; i++) {
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

  it('filters unsupported retained nodes before MP build-choice UI sends requests', () => {
    const result = filterMpBuildChoiceNodeIds([
      'standard_a_1',
      'standard_b_4',
      'spread_b_2',
      'black_hole_a_1',
    ]);

    expect(result).toEqual({
      supportedNodeIds: ['standard_a_1', 'spread_b_2'],
      unsupportedNodeIds: ['standard_b_4', 'black_hole_a_1'],
      autoApplyNodeId: null,
      shouldShowChoiceScreen: true,
    });
  });

  it('marks one supported MP node as an auto activation request, not a choice screen', () => {
    const result = filterMpBuildChoiceNodeIds([
      'standard_a_1',
      'standard_b_4',
    ]);

    expect(result).toEqual({
      supportedNodeIds: ['standard_a_1'],
      unsupportedNodeIds: ['standard_b_4'],
      autoApplyNodeId: 'standard_a_1',
      shouldShowChoiceScreen: false,
    });
  });

  it('live MP availability handler sends exactly one server activation request for one supported node', () => {
    const clearPendingChoice = vi.fn();
    const setBuildChoiceActive = vi.fn();
    const sendUpgradeActivationRequest = vi.fn();
    const showChoiceScreen = vi.fn();

    const result = handleMpBuildChoiceAvailability({
      weaponType: WeaponType.Standard,
      availableNodeIds: ['standard_a_1', 'standard_b_4'],
      clearPendingChoice,
      setBuildChoiceActive,
      sendUpgradeActivationRequest,
      showChoiceScreen,
    });

    expect(result).toBe('auto_requested');
    expect(sendUpgradeActivationRequest).toHaveBeenCalledTimes(1);
    expect(sendUpgradeActivationRequest).toHaveBeenCalledWith('standard_a_1', WeaponType.Standard, true);
    expect(clearPendingChoice).not.toHaveBeenCalled();
    expect(showChoiceScreen).not.toHaveBeenCalled();
    expect(setBuildChoiceActive).toHaveBeenCalledWith(false);
  });

  it('live MP availability handler preserves unsupported-only no-op with no request', () => {
    const clearPendingChoice = vi.fn();
    const setBuildChoiceActive = vi.fn();
    const sendUpgradeActivationRequest = vi.fn();
    const showChoiceScreen = vi.fn();

    const result = handleMpBuildChoiceAvailability({
      weaponType: WeaponType.Standard,
      availableNodeIds: ['standard_b_4', 'standard_ar_5', 'black_hole_a_1'],
      clearPendingChoice,
      setBuildChoiceActive,
      sendUpgradeActivationRequest,
      showChoiceScreen,
    });

    expect(result).toBe('no_supported_nodes');
    expect(sendUpgradeActivationRequest).not.toHaveBeenCalled();
    expect(clearPendingChoice).toHaveBeenCalledTimes(1);
    expect(showChoiceScreen).not.toHaveBeenCalled();
    expect(setBuildChoiceActive).toHaveBeenCalledWith(false);
  });

  it('live MP availability handler preserves multi-supported choice UI', () => {
    const clearPendingChoice = vi.fn();
    const setBuildChoiceActive = vi.fn();
    const sendUpgradeActivationRequest = vi.fn();
    const showChoiceScreen = vi.fn();

    const result = handleMpBuildChoiceAvailability({
      weaponType: WeaponType.Standard,
      availableNodeIds: ['standard_a_1', 'standard_b_1', 'standard_b_4'],
      clearPendingChoice,
      setBuildChoiceActive,
      sendUpgradeActivationRequest,
      showChoiceScreen,
    });

    expect(result).toBe('choice_screen');
    expect(sendUpgradeActivationRequest).not.toHaveBeenCalled();
    expect(clearPendingChoice).not.toHaveBeenCalled();
    expect(showChoiceScreen).toHaveBeenCalledWith(['standard_a_1', 'standard_b_1'], ['standard_b_4']);
    expect(setBuildChoiceActive).toHaveBeenCalledWith(true);
  });

  it('lets the MP build-choice caller clear pending state without pausing when all offers are unsupported', () => {
    const result = filterMpBuildChoiceNodeIds([
      'standard_b_4',
      'standard_ar_5',
      'black_hole_a_1',
    ]);

    expect(result).toEqual({
      supportedNodeIds: [],
      unsupportedNodeIds: ['standard_b_4', 'standard_ar_5', 'black_hole_a_1'],
      autoApplyNodeId: null,
      shouldShowChoiceScreen: false,
    });
  });
});
