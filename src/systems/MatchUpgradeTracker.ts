import { WeaponType } from '../weapons/WeaponTypes';
import { UPGRADE_TREES } from './UpgradeTreeData';

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
