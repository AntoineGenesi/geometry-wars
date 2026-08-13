import { WeaponType } from '../weapons/WeaponTypes';
import {
  UPGRADE_TREES,
  isExcluded,
  isPrerequisiteMet,
} from './UpgradeTreeData';
import { MasteryPointStore } from './MasteryPointStore';

// ---------------------------------------------------------------------------
// MatchUpgradeTracker
// Per-match, non-persisted tracker.  Runs alongside WeaponMasteryManager —
// that system handles buff tier-ups; this one handles upgrade node activation.
//
// Flow: kill threshold crossed → onBuildChoiceAvailable → player picks →
//       confirmChoice() → onUpgradeActivated
// ---------------------------------------------------------------------------

export class MatchUpgradeTracker {
  /** Callback fired after the player confirms a build choice (a node is now active). */
  onUpgradeActivated: ((nodeId: string, weaponType: WeaponType) => void) | null = null;

  /** Callback fired when a single actionable node auto-applies without choice UI. */
  onAutoUpgradeApplied: ((nodeId: string, weaponType: WeaponType) => void) | null = null;

  /**
   * Callback fired when a kill threshold is crossed and one or more nodes are
   * available for the player to choose.  The caller should pause the game and
   * show build-choice UI; call confirmChoice() when the player picks.
   */
  onBuildChoiceAvailable: ((weaponType: WeaponType, availableNodeIds: string[]) => void) | null = null;

  private killCounts: Map<WeaponType, number> = new Map();
  private activeUpgrades: Map<WeaponType, Set<string>> = new Map();
  private readonly permanentUnlocks: Set<string>;
  private readonly store: MasteryPointStore;
  private pendingChoice: { weaponType: WeaponType; nodeIds: string[] } | null = null;
  private readonly autoApplySingleNode: boolean;

  /**
   * @param store - The persistent mastery point store.  The tracker is seeded
   *   with the nodes already unlocked in the store, and will call
   *   earnPoint/spendPoint when the player confirms an in-game build choice.
   */
  constructor(store: MasteryPointStore, options: { autoApplySingleNode?: boolean } = {}) {
    this.store = store;
    this.permanentUnlocks = new Set(store.getUnlockedNodes());
    this.autoApplySingleNode = options.autoApplySingleNode ?? true;
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Record a kill with a weapon and check whether any new upgrade nodes
   * are available for the player to choose.
   */
  recordKill(weaponType: WeaponType): void {
    const prev = this.killCounts.get(weaponType) ?? 0;
    const next = prev + 1;
    this.killCounts.set(weaponType, next);
    this.checkActivations(weaponType, prev, next);
  }

  /**
   * Returns the set of node IDs that are currently active for the given
   * weapon — nodes the player has confirmed via confirmChoice() this match.
   * REGRESSION GUARD: WeaponManager reads this to apply in-match upgrade buffs.
   */
  getActiveUpgrades(weaponType: WeaponType): Set<string> {
    return new Set(this.activeUpgrades.get(weaponType) ?? []);
  }

  /**
   * Reconcile local visual/effect state with server-confirmed MP upgrades.
   * This does not spend points or fire the build-choice callback.
   */
  syncActiveUpgrades(weaponType: WeaponType, nodeIds: Iterable<string>): void {
    this.activeUpgrades.set(weaponType, new Set(nodeIds));
  }

  /**
   * Returns the current kill count for a weapon in this match.
   */
  getKillCount(weaponType: WeaponType): number {
    return this.killCounts.get(weaponType) ?? 0;
  }

  /**
   * Returns the current pending build choice, or null if none.
   * Use for recovery if the choice screen is dismissed unexpectedly.
   */
  getPendingChoice(): { weaponType: WeaponType; nodeIds: string[] } | null {
    if (!this.pendingChoice) return null;
    return { ...this.pendingChoice, nodeIds: [...this.pendingChoice.nodeIds] };
  }

  /**
   * Clear the pending build choice without activating it.
   * MP uses this when the authoritative server rejects an activation request.
   */
  clearPendingChoice(): void {
    this.pendingChoice = null;
  }

  /**
   * Confirm the player's node selection.  Permanently records the choice in
   * MasteryPointStore (earn + spend atomically), activates the node in-match,
   * and fires onUpgradeActivated.  Clears the pending choice.
   *
   * The earn+spend pair persists in-game choices to localStorage so they carry
   * over to future games.  If spendPoint fails (e.g. node already unlocked via
   * the mastery menu), the local in-match activation still proceeds.
   */
  confirmChoice(nodeId: string, weaponType: WeaponType): boolean {
    this.pendingChoice = null;
    const tree = UPGRADE_TREES[weaponType];
    const node = tree?.nodes.find(upgradeNode => upgradeNode.id === nodeId);
    if (!tree || !node) return false;

    const ps = this.makePointLookup(weaponType);
    if (isExcluded(nodeId, tree, ps)) return false;
    if (node.excludes?.some(excludedId => ps.getNodePoints(excludedId) > 0)) return false;

    this.store.earnPoint(weaponType);
    this.store.spendPoint(nodeId, node.maxPoints ?? 1, node.cost ?? 1, tree);
    return this.activateNode(nodeId, weaponType);
  }

  /** Clear all per-match state. Permanent unlocks stay available to earn again through kill thresholds. */
  reset(): void {
    this.killCounts = new Map();
    this.activeUpgrades = new Map();
    this.pendingChoice = null;
  }

  /**
   * Refresh permanent unlocks from a (possibly updated) MasteryPointStore.
   * Call this after the player spends mastery points mid-match (via pause menu).
   * For any newly-unlocked nodes whose kill thresholds are already met, fires
   * onBuildChoiceAvailable so the player can confirm immediately.
   */
  refreshFromStore(store: MasteryPointStore): void {
    const newUnlocks = store.getUnlockedNodes();

    const newlyUnlocked: string[] = [];
    for (const nodeId of newUnlocks) {
      if (!this.permanentUnlocks.has(nodeId)) {
        newlyUnlocked.push(nodeId);
        this.permanentUnlocks.add(nodeId);
      }
    }

    if (newlyUnlocked.length === 0) return;

    for (const [weaponTypeKey, tree] of Object.entries(UPGRADE_TREES)) {
      const weaponType = weaponTypeKey as WeaponType;
      const currentKills = this.killCounts.get(weaponType) ?? 0;
      const ps = this.makePointLookup(weaponType);

      const available: string[] = [];
      for (const upgradeNode of tree.nodes) {
        if (!newlyUnlocked.includes(upgradeNode.id)) continue;
        const alreadyActive = this.activeUpgrades.get(weaponType)?.has(upgradeNode.id) ?? false;
        if (
          !alreadyActive
          && currentKills >= upgradeNode.killThreshold
          && isPrerequisiteMet(upgradeNode, tree, ps)
          && !isExcluded(upgradeNode.id, tree, ps)
        ) {
          available.push(upgradeNode.id);
        }
      }

      this.handleAvailableNodes(weaponType, available);
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /** Creates a PointLookup that treats confirmed in-match nodes as fully invested. */
  private makePointLookup(weaponType: WeaponType) {
    const activeSet = this.activeUpgrades.get(weaponType) ?? new Set<string>();
    return { getNodePoints: (id: string) => (activeSet.has(id) ? 1 : 0) };
  }

  private checkActivations(weaponType: WeaponType, prevKills: number, newKills: number): void {
    const tree = UPGRADE_TREES[weaponType];
    if (!tree) return;

    const ps = this.makePointLookup(weaponType);
    const available: string[] = [];

    for (const upgradeNode of tree.nodes) {
      if (!this.permanentUnlocks.has(upgradeNode.id)) continue;
      const threshold = upgradeNode.killThreshold;
      if (prevKills < threshold && newKills >= threshold) {
        const alreadyActive = this.activeUpgrades.get(weaponType)?.has(upgradeNode.id) ?? false;
        if (!alreadyActive && isPrerequisiteMet(upgradeNode, tree, ps) && !isExcluded(upgradeNode.id, tree, ps)) {
          available.push(upgradeNode.id);
        }
      }
    }

    this.handleAvailableNodes(weaponType, available);
  }

  private handleAvailableNodes(weaponType: WeaponType, nodeIds: string[]): void {
    if (nodeIds.length === 0) return;
    if (this.autoApplySingleNode && nodeIds.length === 1) {
      const nodeId = nodeIds[0];
      if (this.confirmChoice(nodeId, weaponType)) {
        this.onAutoUpgradeApplied?.(nodeId, weaponType);
      }
      return;
    }

    this.pendingChoice = { weaponType, nodeIds };
    this.onBuildChoiceAvailable?.(weaponType, nodeIds);
  }

  private activateNode(nodeId: string, weaponType: WeaponType): boolean {
    let weaponSet = this.activeUpgrades.get(weaponType);
    if (!weaponSet) {
      weaponSet = new Set();
      this.activeUpgrades.set(weaponType, weaponSet);
    }
    if (weaponSet.has(nodeId)) return false; // already active — guard against duplicate calls

    weaponSet.add(nodeId);
    this.onUpgradeActivated?.(nodeId, weaponType);
    return true;
  }
}
