// ---------------------------------------------------------------------------
// MasteryPointStore
// Persists earned/spent mastery points and permanent node unlocks to localStorage.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gw_mastery_points';

interface StoredState {
  totalPoints: number;
  spentPoints: number;
  permanentUnlocks: Record<string, true>;
}

export class MasteryPointStore {
  private totalPoints: number = 0;
  private spentPoints: number = 0;
  private permanentUnlocks: Record<string, true> = {};

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
   * Permanently unlock a node by spending a point.
   * Returns true if successful; false if not enough points or already unlocked.
   */
  spendPoint(nodeId: string): boolean {
    if (this.permanentUnlocks[nodeId]) return false;
    if (this.availablePoints <= 0) return false;

    this.permanentUnlocks = { ...this.permanentUnlocks, [nodeId]: true };
    this.spentPoints = this.spentPoints + 1;
    this.save();
    return true;
  }

  /**
   * Re-lock a permanently unlocked node and refund its point.
   * Returns true if node was unlocked and has been refunded; false otherwise.
   */
  refundPoint(nodeId: string): boolean {
    if (!this.permanentUnlocks[nodeId]) return false;

    const { [nodeId]: _removed, ...rest } = this.permanentUnlocks;
    this.permanentUnlocks = rest;
    this.spentPoints = this.spentPoints - 1;
    this.save();
    return true;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getUnlockedNodes(): Set<string> {
    return new Set(Object.keys(this.permanentUnlocks));
  }

  isUnlocked(nodeId: string): boolean {
    return this.permanentUnlocks[nodeId] === true;
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
      permanentUnlocks: { ...this.permanentUnlocks },
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
      this.permanentUnlocks =
        state.permanentUnlocks && typeof state.permanentUnlocks === 'object'
          ? { ...state.permanentUnlocks }
          : {};
    } catch {
      // Corrupt data — reset to defaults
      this.totalPoints = 0;
      this.spentPoints = 0;
      this.permanentUnlocks = {};
    }
  }

  /** Hard-reset all stored data (for testing / debug). */
  reset(): void {
    this.totalPoints = 0;
    this.spentPoints = 0;
    this.permanentUnlocks = {};
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
