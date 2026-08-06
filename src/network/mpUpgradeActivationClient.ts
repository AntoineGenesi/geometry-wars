import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';
import { filterMpSupportedUpgradeNodeIds } from '../shared/WeaponUpgradeEffects';
import { WeaponType } from '../weapons/WeaponTypes';

export interface PendingUpgradeActivation {
  nodeId: string;
  weaponType: WeaponType;
}

export type UpgradeActivationReconcileStatus = 'accepted' | 'rejected' | 'missing_pending';

export interface ActiveUpgradeNodeSnapshot {
  forEach(cb: (value: number, key: string) => void): void;
}

export interface MpBuildChoiceSupportFilterResult {
  supportedNodeIds: string[];
  unsupportedNodeIds: string[];
  shouldShowChoiceScreen: boolean;
}

export function upgradeActivationKey(nodeId: string, weaponType: WeaponType): string {
  return `${weaponType}:${nodeId}`;
}

export function filterMpBuildChoiceNodeIds(
  availableNodeIds: readonly string[],
): MpBuildChoiceSupportFilterResult {
  const supportedNodeIds = filterMpSupportedUpgradeNodeIds(availableNodeIds);
  const supported = new Set(supportedNodeIds);
  const unsupportedNodeIds = availableNodeIds.filter(nodeId => !supported.has(nodeId));
  return {
    supportedNodeIds,
    unsupportedNodeIds,
    shouldShowChoiceScreen: supportedNodeIds.length > 0,
  };
}

export function reconcileActiveUpgradeSnapshot(options: {
  activeUpgradeNodes: ActiveUpgradeNodeSnapshot;
  serverToWeaponType: Record<string, WeaponType | undefined>;
  knownWeaponTypes: Iterable<WeaponType>;
  matchUpgradeTracker: MatchUpgradeTracker;
}): string[] {
  const byWeapon = new Map<WeaponType, string[]>();
  for (const weaponType of options.knownWeaponTypes) {
    byWeapon.set(weaponType, []);
  }

  const activeKeys: string[] = [];
  options.activeUpgradeNodes.forEach((_value, key) => {
    activeKeys.push(key);
    const separator = key.indexOf(':');
    if (separator <= 0) return;
    const weaponType = options.serverToWeaponType[key.slice(0, separator)];
    if (!weaponType || !byWeapon.has(weaponType)) return;
    byWeapon.get(weaponType)!.push(key.slice(separator + 1));
  });

  for (const [weaponType, nodeIds] of byWeapon) {
    options.matchUpgradeTracker.syncActiveUpgrades(weaponType, nodeIds);
  }

  return activeKeys.sort();
}

export function reconcileUpgradeActivationResult(options: {
  accepted: boolean;
  nodeId: string;
  weaponType: WeaponType;
  pendingUpgradeActivations: Map<string, PendingUpgradeActivation>;
  matchUpgradeTracker: MatchUpgradeTracker;
}): UpgradeActivationReconcileStatus {
  const key = upgradeActivationKey(options.nodeId, options.weaponType);
  const pending = options.pendingUpgradeActivations.get(key);
  if (!pending) return 'missing_pending';

  options.pendingUpgradeActivations.delete(key);

  if (options.accepted) {
    options.matchUpgradeTracker.confirmChoice(pending.nodeId, pending.weaponType);
    return 'accepted';
  }

  options.matchUpgradeTracker.clearPendingChoice();
  return 'rejected';
}
