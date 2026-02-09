/**
 * Interest Management System for Colyseus-based multiplayer.
 *
 * Tracks each player's "area of interest" (AOI) in UV space and
 * determines which entities should be synced to which clients.
 * Combined with PriorityQueue, closer entities sync more frequently
 * while distant ones sync less often or not at all.
 *
 * Surface wrapping rules:
 *   sphere:   U wraps, V does NOT wrap (poles)
 *   torus:    U wraps, V wraps
 *   pill:     U wraps, V does NOT wrap
 *   pipe:     U wraps, V wraps
 *   cube:     neither wraps (6 discrete faces mapped to UV)
 *   capsule:  U wraps, V does NOT wrap
 *   peanut:   U wraps, V does NOT wrap
 */

import {
  PriorityQueue,
  PriorityEntry,
  SyncPriority,
  UVPosition,
  DEFAULT_THRESHOLDS,
  DEFAULT_INTERVALS,
  type PriorityThresholds,
  type SyncIntervals,
} from './PriorityQueue';

/** Per-player filtering result for a single tick */
export interface PlayerSyncSet {
  playerId: string;
  enemyIds: Set<string>;
  bulletIds: Set<string>;
  geomIds: Set<string>;
  pickupIds: Set<string>;
}

/** Metrics for bandwidth monitoring */
export interface InterestMetrics {
  /** Total entities in the world */
  totalEntities: number;
  /** Per-player counts of entities synced this tick */
  perPlayer: Map<string, {
    enemies: number;
    bullets: number;
    geoms: number;
    pickups: number;
    total: number;
  }>;
  /** Average entities synced per player this tick */
  avgEntitiesPerPlayer: number;
  /** Estimated bandwidth savings ratio (0-1, where 1 = 100% saved) */
  bandwidthSavingsRatio: number;
}

/** Surface wrapping configuration */
export interface SurfaceWrapConfig {
  wrapU: boolean;
  wrapV: boolean;
}

/** Known surface wrapping rules */
const SURFACE_WRAP_CONFIGS: Record<string, SurfaceWrapConfig> = {
  sphere:   { wrapU: true,  wrapV: false },
  torus:    { wrapU: true,  wrapV: true },
  pill:     { wrapU: true,  wrapV: false },
  pipe:     { wrapU: true,  wrapV: true },
  cube:     { wrapU: false, wrapV: false },
  capsule:  { wrapU: true,  wrapV: false },
  peanut:   { wrapU: true,  wrapV: false },
  icosphere:{ wrapU: true,  wrapV: false },
  cone:     { wrapU: true,  wrapV: false },
  plane:    { wrapU: false, wrapV: false },
  mobius:   { wrapU: true,  wrapV: false },
};

/** Entity with UV position and ID (minimal interface for filtering) */
export interface SyncableEntity {
  id: string;
  u: number;
  v: number;
}

/**
 * InterestManager configuration
 */
export interface InterestManagerConfig {
  /** AOI radius in UV space (default 0.3) */
  aoiRadius: number;
  /** Priority thresholds */
  thresholds: PriorityThresholds;
  /** Sync intervals per priority tier */
  intervals: SyncIntervals;
  /** Always sync players regardless of distance */
  alwaysSyncPlayers: boolean;
}

const DEFAULT_CONFIG: InterestManagerConfig = {
  aoiRadius: 0.3,
  thresholds: DEFAULT_THRESHOLDS,
  intervals: DEFAULT_INTERVALS,
  alwaysSyncPlayers: true,
};

/**
 * InterestManager tracks per-player areas of interest and produces
 * per-client entity filter sets each tick.
 */
export class InterestManager {
  private readonly config: InterestManagerConfig;
  private readonly priorityQueue: PriorityQueue;
  private readonly surfaceWrap: SurfaceWrapConfig;
  private tickNumber: number = 0;

  /** Cached per-player priority entries (recomputed each tick) */
  private playerPriorities: Map<string, {
    enemies: PriorityEntry[];
    bullets: PriorityEntry[];
    geoms: PriorityEntry[];
    pickups: PriorityEntry[];
  }> = new Map();

  /** Latest metrics */
  private lastMetrics: InterestMetrics = {
    totalEntities: 0,
    perPlayer: new Map(),
    avgEntitiesPerPlayer: 0,
    bandwidthSavingsRatio: 0,
  };

  constructor(
    surfaceType: string,
    config: Partial<InterestManagerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Override thresholds.low to match AOI radius
    this.config.thresholds = {
      ...this.config.thresholds,
      low: this.config.aoiRadius,
    };

    this.priorityQueue = new PriorityQueue(
      this.config.thresholds,
      this.config.intervals,
    );

    this.surfaceWrap = SURFACE_WRAP_CONFIGS[surfaceType] || { wrapU: false, wrapV: false };
  }

  /**
   * Run one tick of interest management.
   *
   * @param players - Map of playerId -> UV position
   * @param enemies - Array of enemies with id + UV
   * @param bullets - Array of bullets with id + UV
   * @param geoms - Array of geoms with id + UV
   * @param pickups - Array of weapon pickups with id + UV
   * @returns Per-player sync sets
   */
  update(
    players: ReadonlyMap<string, UVPosition>,
    enemies: ReadonlyArray<SyncableEntity>,
    bullets: ReadonlyArray<SyncableEntity>,
    geoms: ReadonlyArray<SyncableEntity>,
    pickups: ReadonlyArray<SyncableEntity>,
  ): Map<string, PlayerSyncSet> {
    this.tickNumber++;
    this.playerPriorities.clear();

    const results = new Map<string, PlayerSyncSet>();
    const { wrapU, wrapV } = this.surfaceWrap;

    let totalSynced = 0;
    const totalEntities = enemies.length + bullets.length + geoms.length + pickups.length;
    const perPlayerMetrics = new Map<string, {
      enemies: number;
      bullets: number;
      geoms: number;
      pickups: number;
      total: number;
    }>();

    for (const [playerId, playerPos] of players) {
      // Classify all entity types
      const enemyEntries = this.priorityQueue.classify(
        playerPos, this.toUVArray(enemies), wrapU, wrapV,
      );
      const bulletEntries = this.priorityQueue.classify(
        playerPos, this.toUVArray(bullets), wrapU, wrapV,
      );
      const geomEntries = this.priorityQueue.classify(
        playerPos, this.toUVArray(geoms), wrapU, wrapV,
      );
      const pickupEntries = this.priorityQueue.classify(
        playerPos, this.toUVArray(pickups), wrapU, wrapV,
      );

      // Cache for external queries
      this.playerPriorities.set(playerId, {
        enemies: enemyEntries,
        bullets: bulletEntries,
        geoms: geomEntries,
        pickups: pickupEntries,
      });

      // Filter for this tick
      const enemyIds = this.priorityQueue.filterForTick(enemyEntries, this.tickNumber);
      const bulletIds = this.priorityQueue.filterForTick(bulletEntries, this.tickNumber);
      const geomIds = this.priorityQueue.filterForTick(geomEntries, this.tickNumber);
      const pickupIds = this.priorityQueue.filterForTick(pickupEntries, this.tickNumber);

      results.set(playerId, { playerId, enemyIds, bulletIds, geomIds, pickupIds });

      const playerTotal = enemyIds.size + bulletIds.size + geomIds.size + pickupIds.size;
      totalSynced += playerTotal;
      perPlayerMetrics.set(playerId, {
        enemies: enemyIds.size,
        bullets: bulletIds.size,
        geoms: geomIds.size,
        pickups: pickupIds.size,
        total: playerTotal,
      });
    }

    // Compute metrics
    const playerCount = players.size || 1;
    const avgSynced = totalSynced / playerCount;
    // Without interest management, every player gets every entity every tick
    const baselineSynced = totalEntities * playerCount;
    const savingsRatio = baselineSynced > 0
      ? 1.0 - (totalSynced / baselineSynced)
      : 0;

    this.lastMetrics = {
      totalEntities,
      perPlayer: perPlayerMetrics,
      avgEntitiesPerPlayer: avgSynced,
      bandwidthSavingsRatio: Math.max(0, savingsRatio),
    };

    return results;
  }

  /**
   * Check if a specific entity should be synced to a specific player
   * on the current tick. Useful for Colyseus @filterChildren.
   */
  shouldSync(
    playerId: string,
    entityId: string,
    entityType: 'enemy' | 'bullet' | 'geom' | 'pickup',
  ): boolean {
    const priorities = this.playerPriorities.get(playerId);
    if (!priorities) return true; // No data yet, sync everything

    let entries: PriorityEntry[];
    switch (entityType) {
      case 'enemy': entries = priorities.enemies; break;
      case 'bullet': entries = priorities.bullets; break;
      case 'geom': entries = priorities.geoms; break;
      case 'pickup': entries = priorities.pickups; break;
    }

    const entry = entries.find(e => e.entityId === entityId);
    if (!entry) return false; // Entity not in classified set

    return entry.priority !== SyncPriority.NONE &&
      this.shouldSyncPriorityOnTick(entry.priority);
  }

  private shouldSyncPriorityOnTick(priority: SyncPriority): boolean {
    const intervals = this.config.intervals;
    switch (priority) {
      case SyncPriority.HIGH:
        return this.tickNumber % intervals.high === 0;
      case SyncPriority.MEDIUM:
        return this.tickNumber % intervals.medium === 0;
      case SyncPriority.LOW:
        return this.tickNumber % intervals.low === 0;
      case SyncPriority.NONE:
        return false;
    }
  }

  /**
   * Get the priority entries for a specific player and entity type.
   * Useful for debugging and metrics.
   */
  getPriorities(
    playerId: string,
    entityType: 'enemy' | 'bullet' | 'geom' | 'pickup',
  ): ReadonlyArray<PriorityEntry> {
    const priorities = this.playerPriorities.get(playerId);
    if (!priorities) return [];

    switch (entityType) {
      case 'enemy': return priorities.enemies;
      case 'bullet': return priorities.bullets;
      case 'geom': return priorities.geoms;
      case 'pickup': return priorities.pickups;
    }
  }

  /** Get latest metrics snapshot */
  getMetrics(): InterestMetrics {
    return this.lastMetrics;
  }

  /** Get current tick number */
  getTickNumber(): number {
    return this.tickNumber;
  }

  /** Get surface wrap config */
  getSurfaceWrap(): SurfaceWrapConfig {
    return { ...this.surfaceWrap };
  }

  /** Get AOI radius */
  getAoiRadius(): number {
    return this.config.aoiRadius;
  }

  /**
   * Estimate bandwidth savings for a given entity count.
   * Returns bytes saved per second assuming ~20 bytes per entity per sync.
   */
  static estimateBandwidthSavings(
    entityCount: number,
    playerCount: number,
    aoiRadius: number,
    tickRate: number = 60,
  ): {
    withoutIM: number;
    withIM: number;
    savedBytes: number;
    savingsPercent: number;
  } {
    const bytesPerEntity = 20; // Approximate Colyseus schema patch size

    // Without interest management: every entity to every player every tick
    const withoutIM = entityCount * playerCount * tickRate * bytesPerEntity;

    // With interest management:
    // AOI covers pi*r^2 of the UV space (area = 1.0)
    // But UV space is [0,1]x[0,1] so total area = 1.0
    const aoiArea = Math.min(1.0, Math.PI * aoiRadius * aoiRadius);

    // Entities within AOI (proportional to area)
    const entitiesInAOI = entityCount * aoiArea;

    // Factor in priority-based throttling:
    // HIGH (inner 1/3 of radius): every tick -> proportion = pi*(r/3)^2 = aoiArea/9
    // MEDIUM (1/3 to 2/3): every 3rd tick -> proportion = pi*((2r/3)^2 - (r/3)^2) = aoiArea*3/9
    // LOW (2/3 to 1): every 6th tick -> proportion = pi*(r^2 - (2r/3)^2) = aoiArea*5/9
    const highArea = aoiArea / 9;
    const mediumArea = aoiArea * 3 / 9;
    const lowArea = aoiArea * 5 / 9;

    const effectiveSyncsPerTick =
      entityCount * highArea * 1.0 +
      entityCount * mediumArea * (1 / 3) +
      entityCount * lowArea * (1 / 6);

    const withIM = effectiveSyncsPerTick * playerCount * tickRate * bytesPerEntity;

    return {
      withoutIM: Math.round(withoutIM),
      withIM: Math.round(withIM),
      savedBytes: Math.round(withoutIM - withIM),
      savingsPercent: withoutIM > 0
        ? Math.round((1 - withIM / withoutIM) * 100)
        : 0,
    };
  }

  /** Convert SyncableEntity[] to UVPosition + id format */
  private toUVArray(entities: ReadonlyArray<SyncableEntity>): Array<{ id: string } & UVPosition> {
    return entities.map(e => ({ id: e.id, u: e.u, v: e.v }));
  }
}
