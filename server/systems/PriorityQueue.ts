/**
 * Priority-based entity sync scheduling.
 *
 * Entities are assigned a sync priority based on their UV distance
 * from a player. Closer entities sync more frequently.
 *
 * Priority tiers:
 *   HIGH   (distance < 0.1 UV) - sync every tick
 *   MEDIUM (0.1 - 0.2 UV)     - sync every 3rd tick
 *   LOW    (0.2 - 0.3 UV)     - sync every 6th tick
 *   NONE   (> AOI radius)     - not synced
 */

export const enum SyncPriority {
  HIGH = 0,
  MEDIUM = 1,
  LOW = 2,
  NONE = 3,
}

/** Thresholds in UV-space distance */
export interface PriorityThresholds {
  high: number;   // max distance for HIGH priority
  medium: number; // max distance for MEDIUM priority
  low: number;    // max distance for LOW priority (= AOI radius)
}

/** Tick interval per priority tier */
export interface SyncIntervals {
  high: number;   // sync every N ticks (1 = every tick)
  medium: number; // sync every N ticks
  low: number;    // sync every N ticks
}

export const DEFAULT_THRESHOLDS: PriorityThresholds = {
  high: 0.1,
  medium: 0.2,
  low: 0.3,
};

export const DEFAULT_INTERVALS: SyncIntervals = {
  high: 1,
  medium: 3,
  low: 6,
};

/** Entity position in UV space */
export interface UVPosition {
  u: number;
  v: number;
}

/** Result of priority classification for one entity relative to one player */
export interface PriorityEntry {
  entityId: string;
  priority: SyncPriority;
  distance: number;
}

/**
 * Compute the shortest UV-space distance between two points,
 * accounting for wrapping on the U axis (spherical/toroidal surfaces).
 *
 * @param a - First UV position
 * @param b - Second UV position
 * @param wrapU - Whether U wraps around (true for sphere, torus, cylinder)
 * @param wrapV - Whether V wraps around (true for torus)
 */
export function uvDistance(
  a: UVPosition,
  b: UVPosition,
  wrapU: boolean,
  wrapV: boolean,
): number {
  let du = Math.abs(a.u - b.u);
  if (wrapU) {
    du = Math.min(du, 1.0 - du);
  }

  let dv = Math.abs(a.v - b.v);
  if (wrapV) {
    dv = Math.min(dv, 1.0 - dv);
  }

  return Math.sqrt(du * du + dv * dv);
}

/**
 * Classify an entity's sync priority relative to a player.
 */
export function classifyPriority(
  distance: number,
  thresholds: PriorityThresholds = DEFAULT_THRESHOLDS,
): SyncPriority {
  if (distance <= thresholds.high) return SyncPriority.HIGH;
  if (distance <= thresholds.medium) return SyncPriority.MEDIUM;
  if (distance <= thresholds.low) return SyncPriority.LOW;
  return SyncPriority.NONE;
}

/**
 * Determine whether an entity should sync on this tick
 * based on its priority and the current tick number.
 */
export function shouldSyncOnTick(
  priority: SyncPriority,
  tickNumber: number,
  intervals: SyncIntervals = DEFAULT_INTERVALS,
): boolean {
  switch (priority) {
    case SyncPriority.HIGH:
      return tickNumber % intervals.high === 0;
    case SyncPriority.MEDIUM:
      return tickNumber % intervals.medium === 0;
    case SyncPriority.LOW:
      return tickNumber % intervals.low === 0;
    case SyncPriority.NONE:
      return false;
  }
}

/**
 * PriorityQueue classifies a batch of entities for a single player
 * and tracks which should sync on the current tick.
 */
export class PriorityQueue {
  private readonly thresholds: PriorityThresholds;
  private readonly intervals: SyncIntervals;

  constructor(
    thresholds: PriorityThresholds = DEFAULT_THRESHOLDS,
    intervals: SyncIntervals = DEFAULT_INTERVALS,
  ) {
    this.thresholds = thresholds;
    this.intervals = intervals;
  }

  /**
   * Classify all entities relative to a player position.
   *
   * @returns Array of PriorityEntry sorted by distance ascending.
   */
  classify(
    playerPos: UVPosition,
    entities: ReadonlyArray<{ id: string } & UVPosition>,
    wrapU: boolean,
    wrapV: boolean,
  ): PriorityEntry[] {
    const entries: PriorityEntry[] = [];

    for (const entity of entities) {
      const dist = uvDistance(playerPos, entity, wrapU, wrapV);
      const priority = classifyPriority(dist, this.thresholds);
      entries.push({ entityId: entity.id, priority, distance: dist });
    }

    // Sort by distance ascending (closest first)
    entries.sort((a, b) => a.distance - b.distance);
    return entries;
  }

  /**
   * Given classified entries and the current tick, return the set of
   * entity IDs that should be synced this tick.
   */
  filterForTick(entries: ReadonlyArray<PriorityEntry>, tickNumber: number): Set<string> {
    const result = new Set<string>();
    for (const entry of entries) {
      if (shouldSyncOnTick(entry.priority, tickNumber, this.intervals)) {
        result.add(entry.entityId);
      }
    }
    return result;
  }

  getThresholds(): PriorityThresholds {
    return { ...this.thresholds };
  }

  getIntervals(): SyncIntervals {
    return { ...this.intervals };
  }
}
