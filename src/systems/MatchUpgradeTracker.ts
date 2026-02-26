import { WeaponType } from '../weapons/WeaponTypes';
import { UPGRADE_TREES } from './UpgradeTreeData';
import { MasteryPointStore } from './MasteryPointStore';

// ---------------------------------------------------------------------------
// MatchUpgradeTracker
// Per-match, non-persisted tracker.  Runs alongside WeaponMasteryManager —
// that system handles buff tier-ups; this one handles upgrade node activation.
// ---------------------------------------------------------------------------

export class MatchUpgradeTracker {
  /** Callback fired whenever a new upgrade node becomes active mid-match. */
  onUpgradeActivated: ((nodeId: string, weaponType: WeaponType) => void) | null = null;

  private killCounts: Map<WeaponType, number> = new Map();
  private activeUpgrades: Map<WeaponType, Set<string>> = new Map();
  private readonly permanentUnlocks: Set<string>;

  /**
   * @param permanentUnlocks - The set of permanently unlocked node IDs from
   *   MasteryPointStore.  These act as the "ceiling" — the tracker can only
   *   activate nodes that are permanently unlocked.
   */
  constructor(permanentUnlocks: Set<string>) {
    this.permanentUnlocks = new Set(permanentUnlocks);
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Record a kill with a weapon and check whether any new upgrade nodes
   * should activate for that weapon.
   */
  recordKill(weaponType: WeaponType): void {
    const prev = this.killCounts.get(weaponType) ?? 0;
    const next = prev + 1;
    this.killCounts.set(weaponType, next);
    this.checkActivations(weaponType, prev, next);
  }

  /**
   * Returns the set of node IDs that are currently active for the given
   * weapon — the intersection of permanently unlocked nodes and those whose
   * kill threshold the player has crossed in this match.
   */
  getActiveUpgrades(weaponType: WeaponType): Set<string> {
    return new Set(this.activeUpgrades.get(weaponType) ?? []);
  }

  /**
   * Returns the current kill count for a weapon in this match.
   */
  getKillCount(weaponType: WeaponType): number {
    return this.killCounts.get(weaponType) ?? 0;
  }

  /** Clear all state — call at the start of a new match. */
  reset(): void {
    this.killCounts = new Map();
    this.activeUpgrades = new Map();
  }

  /**
   * Refresh permanent unlocks from a (possibly updated) MasteryPointStore.
   * Call this after the player spends mastery points mid-match (via pause menu).
   * For any newly-unlocked nodes whose kill thresholds are already met, fires
   * onUpgradeActivated immediately.
   */
  refreshFromStore(store: MasteryPointStore): void {
    const newUnlocks = store.getUnlockedNodes();

    // Determine which nodes are newly unlocked (not already tracked)
    const newlyUnlocked: string[] = [];
    for (const nodeId of newUnlocks) {
      if (!this.permanentUnlocks.has(nodeId)) {
        newlyUnlocked.push(nodeId);
        this.permanentUnlocks.add(nodeId);
      }
    }

    if (newlyUnlocked.length === 0) return;

    // For each weapon type, check if newly-unlocked nodes already have met their kill threshold
    for (const [weaponTypeKey, tree] of Object.entries(UPGRADE_TREES)) {
      const weaponType = weaponTypeKey as WeaponType;
      const currentKills = this.killCounts.get(weaponType) ?? 0;
      for (const upgradeNode of tree.nodes) {
        if (!newlyUnlocked.includes(upgradeNode.id)) continue;
        if (currentKills >= upgradeNode.killThreshold) {
          this.activateNode(upgradeNode.id, weaponType);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private checkActivations(weaponType: WeaponType, prevKills: number, newKills: number): void {
    const tree = UPGRADE_TREES[weaponType];
    if (!tree) return;

    for (const upgradeNode of tree.nodes) {
      // Only consider permanently unlocked nodes
      if (!this.permanentUnlocks.has(upgradeNode.id)) continue;

      const threshold = upgradeNode.killThreshold;
      // Activate when the kill count crosses the threshold for the first time
      if (prevKills < threshold && newKills >= threshold) {
        this.activateNode(upgradeNode.id, weaponType);
      }
    }
  }

  private activateNode(nodeId: string, weaponType: WeaponType): void {
    let weaponSet = this.activeUpgrades.get(weaponType);
    if (!weaponSet) {
      weaponSet = new Set();
      this.activeUpgrades.set(weaponType, weaponSet);
    }
    if (weaponSet.has(nodeId)) return; // already active — guard against duplicate calls

    weaponSet.add(nodeId);
    this.onUpgradeActivated?.(nodeId, weaponType);
  }
}
