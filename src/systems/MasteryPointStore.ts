// ---------------------------------------------------------------------------
// MasteryPointStore
// Persists earned/spent mastery points (per-weapon) and permanent node unlocks
// to localStorage.
//
// Points are PER WEAPON: killing with Blaster earns Blaster points, which can
// only be spent on Blaster upgrade nodes. Points from one weapon do NOT
// transfer to another.
//
// Supports multi-level nodes (maxPoints > 1) — a node can be upgraded multiple times.
// ---------------------------------------------------------------------------

import { WeaponType } from '../weapons/WeaponTypes';

const STORAGE_KEY = 'gw_mastery_points';

// ---------------------------------------------------------------------------
// Storage format
// ---------------------------------------------------------------------------

interface WeaponPointEntry {
  total: number;
  spent: number;
}

/** v2 format — per-weapon point pools */
interface StoredStateV2 {
  version: 2;
  /** Points earned/spent per weapon */
  weaponPoints: { [weaponType: string]: WeaponPointEntry };
  /**
   * Points spent per node (value = how many points invested, 0 = not unlocked).
   */
  nodePoints: Record<string, number>;
}

/** v1 (legacy) format — global shared pool */
interface StoredStateV1 {
  version?: undefined | 1;
  totalPoints: number;
  spentPoints: number;
  nodePoints?: Record<string, number>;
  /** @deprecated migrated to nodePoints */
  permanentUnlocks?: Record<string, true>;
}

type StoredState = StoredStateV2 | StoredStateV1;

// ---------------------------------------------------------------------------
// Helper: extract WeaponType from a node ID
// Node IDs have the format "${weaponType}_${branch}_${nodeIndex}".
// WeaponType values may contain underscores (e.g. 'chain_lightning'), so we
// check by prefix using all known weapon type strings.
// ---------------------------------------------------------------------------

// Sorted longest-first so that multi-word types ('chain_lightning') match
// before shorter prefixes that share a start ('chain').
const WEAPON_TYPE_VALUES = (Object.values(WeaponType) as string[]).sort(
  (a, b) => b.length - a.length,
);

export function weaponTypeFromNodeId(nodeId: string): WeaponType | null {
  for (const wt of WEAPON_TYPE_VALUES) {
    if (nodeId.startsWith(wt + '_')) return wt as WeaponType;
  }
  return null;
}

// ---------------------------------------------------------------------------
// MasteryPointStore
// ---------------------------------------------------------------------------

export class MasteryPointStore {
  /** Points earned/spent per weapon */
  private weaponPoints: Map<WeaponType, WeaponPointEntry> = new Map();
  /** Points invested per node (0 = locked, ≥1 = at least partially unlocked). */
  private nodePoints: Record<string, number> = {};

  constructor() {
    this.load();
  }

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  /** Available points for a specific weapon (total - spent). */
  getAvailablePoints(weaponType: WeaponType): number {
    const entry = this.weaponPoints.get(weaponType);
    if (!entry) return 0;
    return Math.max(0, entry.total - entry.spent);
  }

  /** Total points earned across all weapons (or for a specific weapon). */
  getTotalPoints(weaponType?: WeaponType): number {
    if (weaponType !== undefined) {
      return this.weaponPoints.get(weaponType)?.total ?? 0;
    }
    let sum = 0;
    for (const entry of this.weaponPoints.values()) sum += entry.total;
    return sum;
  }

  /** Total points spent across all weapons (or for a specific weapon). */
  getSpentPoints(weaponType?: WeaponType): number {
    if (weaponType !== undefined) {
      return this.weaponPoints.get(weaponType)?.spent ?? 0;
    }
    let sum = 0;
    for (const entry of this.weaponPoints.values()) sum += entry.spent;
    return sum;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Add 1 mastery point to a specific weapon's pool.
   * Called on player level-up using the currently equipped weapon.
   */
  earnPoint(weaponType: WeaponType): void {
    const entry = this.weaponPoints.get(weaponType) ?? { total: 0, spent: 0 };
    this.weaponPoints.set(weaponType, { ...entry, total: entry.total + 1 });
    this.save();
  }

  /**
   * Spend points in a node.
   * - `maxPoints` controls how many total points can be invested (default 1).
   * - `cost` controls how many points are deducted from the weapon's available
   *   points (default 1). Premium nodes may cost 2 points to initially unlock.
   * - Points are drawn from the pool of the weapon that owns this node (derived
   *   from the node ID prefix).
   * - Returns true if the spend was successful; false if node is at max points,
   *   insufficient weapon points are available, or nodeId has no weapon owner.
   */
  spendPoint(nodeId: string, maxPoints: number = 1, cost: number = 1): boolean {
    const weaponType = weaponTypeFromNodeId(nodeId);
    if (weaponType === null) return false;

    const current = this.nodePoints[nodeId] ?? 0;
    if (current >= maxPoints) return false;
    if (this.getAvailablePoints(weaponType) < cost) return false;

    const entry = this.weaponPoints.get(weaponType) ?? { total: 0, spent: 0 };
    this.weaponPoints.set(weaponType, { ...entry, spent: entry.spent + cost });
    this.nodePoints = { ...this.nodePoints, [nodeId]: current + 1 };
    this.save();
    return true;
  }

  /**
   * Refund 1 point from a node, returning it to the weapon's point pool.
   * For multi-level nodes, decrements by 1. If the count reaches 0, the node is locked.
   * Returns true if a point was refunded; false if node has no points invested
   * or nodeId has no weapon owner.
   */
  refundPoint(nodeId: string): boolean {
    const weaponType = weaponTypeFromNodeId(nodeId);
    if (weaponType === null) return false;

    const current = this.nodePoints[nodeId] ?? 0;
    if (current <= 0) return false;

    const newCount = current - 1;
    if (newCount === 0) {
      const { [nodeId]: _removed, ...rest } = this.nodePoints;
      this.nodePoints = rest;
    } else {
      this.nodePoints = { ...this.nodePoints, [nodeId]: newCount };
    }
    const entry = this.weaponPoints.get(weaponType) ?? { total: 0, spent: 0 };
    this.weaponPoints.set(weaponType, { ...entry, spent: Math.max(0, entry.spent - 1) });
    this.save();
    return true;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Returns the number of points currently invested in a node (0 if locked). */
  getNodePoints(nodeId: string): number {
    return this.nodePoints[nodeId] ?? 0;
  }

  /**
   * Returns true if at least 1 point has been invested in this node.
   * For multi-level nodes, this returns true even if not at max level.
   */
  isUnlocked(nodeId: string): boolean {
    return (this.nodePoints[nodeId] ?? 0) > 0;
  }

  /** Returns the set of all node IDs with at least 1 point invested. */
  getUnlockedNodes(): Set<string> {
    return new Set(Object.keys(this.nodePoints).filter(id => (this.nodePoints[id] ?? 0) > 0));
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  save(): void {
    const weaponPointsObj: { [k: string]: WeaponPointEntry } = {};
    for (const [wt, entry] of this.weaponPoints.entries()) {
      weaponPointsObj[wt] = { ...entry };
    }
    const state: StoredStateV2 = {
      version: 2,
      weaponPoints: weaponPointsObj,
      nodePoints: { ...this.nodePoints },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage unavailable (e.g. test environment) — silently ignore
    }
  }

  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as StoredState;

      if ((state as StoredStateV2).version === 2) {
        // Current v2 format
        const s2 = state as StoredStateV2;
        this.weaponPoints = new Map();
        for (const [wt, entry] of Object.entries(s2.weaponPoints ?? {})) {
          if (typeof entry.total === 'number' && typeof entry.spent === 'number') {
            this.weaponPoints.set(wt as WeaponType, { total: entry.total, spent: entry.spent });
          }
        }
        if (s2.nodePoints && typeof s2.nodePoints === 'object') {
          this.nodePoints = { ...s2.nodePoints };
        }
      } else {
        // Legacy v1 format: global pool. Migrate.
        // Keep node unlocks (they already have weapon prefixes). Discard global
        // point totals — they can't be attributed to specific weapons. The user
        // will re-earn per-weapon points going forward.
        const s1 = state as StoredStateV1;
        this.weaponPoints = new Map();

        if (s1.nodePoints && typeof s1.nodePoints === 'object') {
          this.nodePoints = { ...s1.nodePoints };
          // Reconstruct spent counts per weapon from existing nodePoints
          for (const [nodeId, pts] of Object.entries(this.nodePoints)) {
            if (pts <= 0) continue;
            const wt = weaponTypeFromNodeId(nodeId);
            if (!wt) continue;
            const entry = this.weaponPoints.get(wt) ?? { total: 0, spent: 0 };
            // Set total = spent so available = 0 (can't attribute old unspent points)
            const newSpent = entry.spent + pts;
            this.weaponPoints.set(wt, { total: newSpent, spent: newSpent });
          }
        } else if (s1.permanentUnlocks && typeof s1.permanentUnlocks === 'object') {
          // Very old format: boolean unlocks
          this.nodePoints = {};
          for (const nodeId of Object.keys(s1.permanentUnlocks)) {
            this.nodePoints[nodeId] = 1;
            const wt = weaponTypeFromNodeId(nodeId);
            if (!wt) continue;
            const entry = this.weaponPoints.get(wt) ?? { total: 0, spent: 0 };
            this.weaponPoints.set(wt, { total: entry.total + 1, spent: entry.spent + 1 });
          }
        }
      }
    } catch {
      // Corrupt data — reset to defaults
      this.weaponPoints = new Map();
      this.nodePoints = {};
    }
  }

  /** Hard-reset all stored data (for testing / debug). */
  reset(): void {
    this.weaponPoints = new Map();
    this.nodePoints = {};
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // Static factory
  // -------------------------------------------------------------------------

  /** Load from localStorage and return a fully initialised store. */
  static load(): MasteryPointStore {
    return new MasteryPointStore();
  }
}
