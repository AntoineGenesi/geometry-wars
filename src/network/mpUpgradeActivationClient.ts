import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';
import { WeaponType } from '../weapons/WeaponTypes';

export interface PendingUpgradeActivation {
  nodeId: string;
  weaponType: WeaponType;
}

export type UpgradeActivationReconcileStatus = 'accepted' | 'rejected' | 'missing_pending';

export function upgradeActivationKey(nodeId: string, weaponType: WeaponType): string {
  return `${weaponType}:${nodeId}`;
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
