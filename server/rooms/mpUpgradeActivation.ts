import {
  UPGRADE_TREES,
  isPrerequisiteMet,
  isExcluded,
  type UpgradeNode,
  type UpgradeTree,
} from '../../src/systems/UpgradeTreeData';
import { WeaponType } from '../../src/weapons/WeaponTypes';
import { isMpUpgradeNodeSupported } from '../../src/shared/WeaponUpgradeEffects';

export interface UpgradeActivationRequest {
  nodeId?: unknown;
  weaponType?: unknown;
  unlockedNodeIds?: unknown;
}

export interface UpgradeActivationValidationState {
  activeNodeIds: ReadonlySet<string>;
  killCount: number;
}

export interface UpgradeActivationResult {
  accepted: boolean;
  nodeId: string;
  weaponType: string;
  reason?: string;
}

function isWeaponType(value: unknown): value is WeaponType {
  return typeof value === 'string' && Object.values(WeaponType).includes(value as WeaponType);
}

function findNode(tree: UpgradeTree, nodeId: string): UpgradeNode | undefined {
  return tree.nodes.find((node) => node.id === nodeId);
}

function findNodeWeapon(nodeId: string): WeaponType | null {
  for (const [weaponType, tree] of Object.entries(UPGRADE_TREES)) {
    if (tree.nodes.some((node) => node.id === nodeId)) {
      return weaponType as WeaponType;
    }
  }
  return null;
}

export function validateMpUpgradeActivation(
  request: UpgradeActivationRequest,
  state: UpgradeActivationValidationState,
): UpgradeActivationResult {
  const nodeId = typeof request.nodeId === 'string' ? request.nodeId : '';
  const weaponType = isWeaponType(request.weaponType) ? request.weaponType : '';
  const unlockedNodeIds = Array.isArray(request.unlockedNodeIds)
    ? new Set(request.unlockedNodeIds.filter((id): id is string => typeof id === 'string'))
    : new Set<string>();

  if (!nodeId || !weaponType) {
    return { accepted: false, nodeId, weaponType, reason: 'invalid_payload' };
  }

  const tree = UPGRADE_TREES[weaponType];
  if (!tree) {
    return { accepted: false, nodeId, weaponType, reason: 'unknown_weapon' };
  }

  const actualWeapon = findNodeWeapon(nodeId);
  if (actualWeapon && actualWeapon !== weaponType) {
    return { accepted: false, nodeId, weaponType, reason: 'weapon_mismatch' };
  }

  const node = findNode(tree, nodeId);
  if (!node) {
    return { accepted: false, nodeId, weaponType, reason: 'unknown_node' };
  }

  if (!unlockedNodeIds.has(nodeId)) {
    return { accepted: false, nodeId, weaponType, reason: 'not_unlocked' };
  }

  if (state.activeNodeIds.has(nodeId)) {
    return { accepted: false, nodeId, weaponType, reason: 'duplicate' };
  }

  if (state.killCount < node.killThreshold) {
    return { accepted: false, nodeId, weaponType, reason: 'threshold_unmet' };
  }

  const pointLookup = {
    getNodePoints: (id: string) => (state.activeNodeIds.has(id) ? 1 : 0),
  };

  if (!isPrerequisiteMet(node, tree, pointLookup)) {
    return { accepted: false, nodeId, weaponType, reason: 'prerequisite_unmet' };
  }

  if (isExcluded(nodeId, tree, pointLookup)) {
    return { accepted: false, nodeId, weaponType, reason: 'excluded' };
  }

  if (node.excludes?.some((excludedId) => state.activeNodeIds.has(excludedId))) {
    return { accepted: false, nodeId, weaponType, reason: 'excluded' };
  }

  if (!isMpUpgradeNodeSupported(nodeId)) {
    return { accepted: false, nodeId, weaponType, reason: 'unsupported_runtime_effect' };
  }

  return { accepted: true, nodeId, weaponType };
}
