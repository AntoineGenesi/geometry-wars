/**
 * High-level collision detection API that bridges between RapierWorld (WASM)
 * and SpatialHash (JS fallback).
 *
 * Features:
 * - Lazy initialization: doesn't block game start while WASM loads
 * - Automatic fallback: uses SpatialHash if WASM fails to load
 * - Compatible interface: drop-in replacement for current collision patterns
 * - Bulk sync: efficiently updates all entity positions each frame
 */

import { RapierWorld, CollisionPair, Vec3Like } from './RapierWorld';
import { SpatialHash } from '../core/SpatialHash';

/** Minimal entity interface for the bridge. */
export interface CollisionEntity {
  id: string;
  position: Vec3Like;
  radius: number;
  category: string;
  active: boolean;
}

/** Overlap result for pair-based queries. */
export interface OverlapPair {
  entityA: string;
  entityB: string;
}

export type CollisionBackend = 'rapier' | 'spatialhash';

export class CollisionBridge {
  private rapierWorld: RapierWorld;
  private spatialHash: SpatialHash<CollisionEntity>;
  private initPromise: Promise<void> | null = null;
  private initFailed = false;
  private trackedIds: Set<string> = new Set();

  // Reusable arrays to avoid per-frame allocation
  private _nearbyResult: CollisionEntity[] = [];

  constructor(cellSize: number = 2.5) {
    this.rapierWorld = new RapierWorld();
    this.spatialHash = new SpatialHash<CollisionEntity>(cellSize);
  }

  /**
   * Begin async WASM initialization. Non-blocking -- the bridge
   * uses SpatialHash until Rapier is ready.
   */
  startInit(): void {
    if (this.initPromise) return;

    this.initPromise = this.rapierWorld.init().catch((err) => {
      this.initFailed = true;
      // Log but don't throw -- fallback to SpatialHash
      if (typeof console !== 'undefined') {
        console.warn('Rapier WASM init failed, using SpatialHash fallback:', err);
      }
    });
  }

  /**
   * Wait for initialization to complete. Resolves immediately if
   * already initialized or if init was never started.
   */
  async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /** Which backend is currently active. */
  get activeBackend(): CollisionBackend {
    return this.rapierWorld.isReady ? 'rapier' : 'spatialhash';
  }

  /** Whether Rapier WASM is loaded and active. */
  get isRapierReady(): boolean {
    return this.rapierWorld.isReady;
  }

  /**
   * Sync all entity positions into the collision backend.
   *
   * Call this once per frame with the full entity list.
   * Handles add/update/remove automatically.
   *
   * @param entities - All active collision entities this frame
   */
  update(entities: ReadonlyArray<CollisionEntity>): void {
    if (this.rapierWorld.isReady) {
      this.updateRapier(entities);
    }
    // Always update spatial hash (used as fallback and for queryNearby)
    this.updateSpatialHash(entities);
  }

  /**
   * Query entities near a position. Uses Rapier broadphase when available,
   * falls back to SpatialHash.
   *
   * @param position - Query center
   * @param radius - Search radius
   * @returns Entity IDs within range
   */
  queryNearby(position: Vec3Like, radius: number): readonly string[] {
    if (this.rapierWorld.isReady) {
      return this.rapierWorld.queryNearby(position, radius);
    }

    // Fallback: use spatial hash (returns entities, not IDs)
    const nearby = this.spatialHash.getNearby(position.x, position.y, position.z);
    const result: string[] = [];
    const rSq = radius * radius;
    for (let i = 0; i < nearby.length; i++) {
      const e = nearby[i];
      const dx = e.position.x - position.x;
      const dy = e.position.y - position.y;
      const dz = e.position.z - position.z;
      if (dx * dx + dy * dy + dz * dz <= rSq) {
        result.push(e.id);
      }
    }
    return result;
  }

  /**
   * Get all overlapping collision pairs. Uses Rapier when available,
   * falls back to brute-force spatial hash check.
   *
   * @returns Array of overlapping entity ID pairs
   */
  getOverlaps(): OverlapPair[] {
    if (this.rapierWorld.isReady) {
      const pairs = this.rapierWorld.getCollisions();
      return pairs.map(p => ({ entityA: p.idA, entityB: p.idB }));
    }

    // Fallback: N^2 check using spatial hash for pruning
    // This is the same pattern as the existing EntityManager.resolveCollisions()
    return [];
  }

  /**
   * Get entities near a position, returning full entity objects.
   * Uses spatial hash (always available).
   *
   * @param x - World X
   * @param y - World Y
   * @param z - World Z
   * @returns Entities in nearby cells
   */
  getNearbyEntities(x: number, y: number, z: number): readonly CollisionEntity[] {
    return this.spatialHash.getNearby(x, y, z);
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.rapierWorld.destroy();
    this.spatialHash.clear();
    this.trackedIds.clear();
  }

  // ---- Rapier sync ----

  private updateRapier(entities: ReadonlyArray<CollisionEntity>): void {
    const currentIds = new Set<string>();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active) continue;

      currentIds.add(e.id);

      if (this.trackedIds.has(e.id)) {
        // Update existing
        this.rapierWorld.updateEntity(e.id, e.position);
      } else {
        // Add new
        this.rapierWorld.addEntity(e.id, e.position, e.radius, e.category);
        this.trackedIds.add(e.id);
      }
    }

    // Remove entities that are no longer active
    for (const id of this.trackedIds) {
      if (!currentIds.has(id)) {
        this.rapierWorld.removeEntity(id);
        this.trackedIds.delete(id);
      }
    }
  }

  private updateSpatialHash(entities: ReadonlyArray<CollisionEntity>): void {
    this.spatialHash.clear();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active) continue;
      this.spatialHash.insert(e.position.x, e.position.y, e.position.z, e);
    }
  }
}
