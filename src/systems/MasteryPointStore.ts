// ---------------------------------------------------------------------------
// MasteryPointStore
// Persists earned/spent mastery points and permanent node unlocks to localStorage.
// Supports multi-level nodes (maxPoints > 1) — a node can be upgraded multiple times.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gw_mastery_points';

interface StoredState {
  totalPoints: number;
  spentPoints: number;
  /**
   * Points spent per node (value = how many points invested, 0 = not unlocked).
   * Replaces the old `permanentUnlocks: Record<string, true>` format.
   * Migration: if old format is detected on load, each entry is converted to 1 point.
   */
  nodePoints: Record<string, number>;
  /**
   * Legacy field — present in old saves. Migrated to nodePoints on load.
   * @deprecated
   */
  permanentUnlocks?: Record<string, true>;
}

export class MasteryPointStore {
  private totalPoints: number = 0;
  private spentPoints: number = 0;
  /** Points invested per node (0 = locked, ≥1 = at least partially unlocked). */
  private nodePoints: Record<string, number> = {};

  constructor() {
    this.load();
  }

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  get availablePoints(): number {
    return this.totalPoints - this.spentPoints;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /** Add 1 mastery point (call on player level-up). */
  earnPoint(): void {
    this.totalPoints = this.totalPoints + 1;
    this.save();
  }

  /**
   * Spend 1 point in a node.
   * - `maxPoints` controls how many total points can be invested (default 1).
   * - Returns true if the point was successfully spent; false if the node is
   *   already at max points or no points are available.
   */
  spendPoint(nodeId: string, maxPoints: number = 1): boolean {
    const current = this.nodePoints[nodeId] ?? 0;
    if (current >= maxPoints) return false;
    if (this.availablePoints <= 0) return false;

    this.nodePoints = { ...this.nodePoints, [nodeId]: current + 1 };
    this.spentPoints = this.spentPoints + 1;
    this.save();
    return true;
  }

  /**
   * Refund 1 point from a node.
   * For multi-level nodes, decrements by 1. If the count reaches 0, the node is locked.
   * Returns true if a point was refunded; false if node has no points invested.
   */
  refundPoint(nodeId: string): boolean {
    const current = this.nodePoints[nodeId] ?? 0;
    if (current <= 0) return false;

    const newCount = current - 1;
    if (newCount === 0) {
      const { [nodeId]: _removed, ...rest } = this.nodePoints;
      this.nodePoints = rest;
    } else {
      this.nodePoints = { ...this.nodePoints, [nodeId]: newCount };
    }
    this.spentPoints = this.spentPoints - 1;
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

  getTotalPoints(): number {
    return this.totalPoints;
  }

  getSpentPoints(): number {
    return this.spentPoints;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  save(): void {
    const state: StoredState = {
      totalPoints: this.totalPoints,
      spentPoints: this.spentPoints,
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
      this.totalPoints = typeof state.totalPoints === 'number' ? state.totalPoints : 0;
      this.spentPoints = typeof state.spentPoints === 'number' ? state.spentPoints : 0;

      if (state.nodePoints && typeof state.nodePoints === 'object') {
        // New format: node points map
        this.nodePoints = { ...state.nodePoints };
      } else if (state.permanentUnlocks && typeof state.permanentUnlocks === 'object') {
        // Legacy format migration: convert boolean unlocks to 1 point each
        this.nodePoints = {};
        for (const nodeId of Object.keys(state.permanentUnlocks)) {
          this.nodePoints[nodeId] = 1;
        }
      } else {
        this.nodePoints = {};
      }
    } catch {
      // Corrupt data — reset to defaults
      this.totalPoints = 0;
      this.spentPoints = 0;
      this.nodePoints = {};
    }
  }

  /** Hard-reset all stored data (for testing / debug). */
  reset(): void {
    this.totalPoints = 0;
    this.spentPoints = 0;
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
