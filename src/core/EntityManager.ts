import * as THREE from 'three';
import { Entity, CollisionGroup } from './Entity';

/**
 * A simple generic object pool.
 *
 * Entities that carry a `poolTag` are returned here when deactivated
 * instead of being garbage-collected, so they can be reused without
 * allocating new objects.
 */
class ObjectPool<T extends Entity> {
  private readonly pools: Map<string, T[]> = new Map();

  /**
   * Return an inactive entity to the pool.
   */
  release(entity: T): void {
    const tag = entity.poolTag;
    if (!tag) return;

    let pool = this.pools.get(tag);
    if (!pool) {
      pool = [];
      this.pools.set(tag, pool);
    }
    pool.push(entity);
  }

  /**
   * Try to acquire a recycled entity from the pool.
   * @returns A previously pooled entity, or `undefined` if none available.
   */
  acquire(tag: string): T | undefined {
    const pool = this.pools.get(tag);
    if (!pool || pool.length === 0) return undefined;
    return pool.pop();
  }

  /**
   * Number of entities currently sitting idle in a given pool.
   */
  available(tag: string): number {
    return this.pools.get(tag)?.length ?? 0;
  }

  /**
   * Discard all pooled entities.
   */
  clear(): void {
    this.pools.clear();
  }
}

/**
 * Describes a pair of collision groups that should be tested against
 * each other, together with the callback to invoke on collision.
 */
interface CollisionRule {
  groupA: CollisionGroup;
  groupB: CollisionGroup;
  onCollision: (a: Entity, b: Entity) => void;
}

/**
 * Manages the full lifecycle of every Entity in the game:
 * creation, per-tick updates, collision detection, removal, and pooling.
 */
export class EntityManager {
  // ---- Storage --------------------------------------------------------

  /** Master list of all active entities. */
  private readonly entities: Entity[] = [];

  /** Fast lookup by collision group for the current frame. */
  private readonly groupCache: Map<CollisionGroup, Entity[]> = new Map();

  /** Whether groupCache needs rebuilding before collision checks. */
  private groupCacheDirty: boolean = true;

  /** Entities queued for addition at the end of the current tick. */
  private readonly pendingAdd: Entity[] = [];

  /** Object pool for bullets, particles, and other frequently
   *  spawned/destroyed entities. */
  readonly pool: ObjectPool<Entity> = new ObjectPool();

  /** Registered collision rules. */
  private readonly collisionRules: CollisionRule[] = [];

  // ---- Public API -----------------------------------------------------

  /**
   * Register a new entity.  It will be added to the active list at the
   * end of the current physics tick (or immediately if no tick is in
   * progress).
   */
  add(entity: Entity): void {
    this.pendingAdd.push(entity);
    this.groupCacheDirty = true;
  }

  /**
   * Register a collision rule between two groups.  The default callback
   * simply invokes `onCollision` on both entities.
   */
  addCollisionRule(
    groupA: CollisionGroup,
    groupB: CollisionGroup,
    onCollision?: (a: Entity, b: Entity) => void,
  ): void {
    this.collisionRules.push({
      groupA,
      groupB,
      onCollision: onCollision ?? ((a, b) => {
        a.onCollision(b);
        b.onCollision(a);
      }),
    });
  }

  /**
   * Run one fixed-timestep physics tick for every active entity,
   * then resolve collisions and clean up dead entities.
   */
  update(dt: number): void {
    // 1. Flush pending additions so they participate this tick.
    this.flushPendingAdds();

    // 2. Snapshot positions for interpolation.
    for (let i = 0; i < this.entities.length; i++) {
      this.entities[i].savePosition();
    }

    // 3. Update every entity.
    for (let i = 0; i < this.entities.length; i++) {
      const entity = this.entities[i];
      if (entity.active) {
        entity.update(dt);
      }
    }

    // 4. Collision detection.
    this.resolveCollisions();

    // 5. Remove dead entities (sweep back-to-front to avoid index shift).
    this.sweep();
  }

  /**
   * Remove all entities and clear pools.
   */
  clear(): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      this.removeEntity(this.entities[i]);
    }
    this.entities.length = 0;
    this.pendingAdd.length = 0;
    this.pool.clear();
    this.groupCacheDirty = true;
  }

  /**
   * Return every currently active entity.  The returned array is a
   * snapshot -- mutations do not affect the manager.
   */
  getAll(): ReadonlyArray<Entity> {
    return this.entities;
  }

  /**
   * Return all active entities that belong to a given collision group.
   */
  getByGroup(group: CollisionGroup): ReadonlyArray<Entity> {
    this.rebuildGroupCacheIfNeeded();
    return this.groupCache.get(group) ?? [];
  }

  /** Total number of active entities. */
  get count(): number {
    return this.entities.length;
  }

  // ---- Internals ------------------------------------------------------

  /** Move entities from the pending queue into the active list. */
  private flushPendingAdds(): void {
    if (this.pendingAdd.length === 0) return;

    for (let i = 0; i < this.pendingAdd.length; i++) {
      this.entities.push(this.pendingAdd[i]);
    }
    this.pendingAdd.length = 0;
    this.groupCacheDirty = true;
  }

  /** Rebuild the group lookup cache. */
  private rebuildGroupCacheIfNeeded(): void {
    if (!this.groupCacheDirty) return;

    this.groupCache.clear();
    for (let i = 0; i < this.entities.length; i++) {
      const entity = this.entities[i];
      if (!entity.active) continue;

      const group = entity.collisionGroup;
      if (group === CollisionGroup.None) continue;

      let list = this.groupCache.get(group);
      if (!list) {
        list = [];
        this.groupCache.set(group, list);
      }
      list.push(entity);
    }
    this.groupCacheDirty = false;
  }

  /**
   * Broad + narrow phase collision detection.
   *
   * For each registered collision rule we test every entity in groupA
   * against every entity in groupB using bounding-sphere overlap.
   * This is O(n*m) per rule which is perfectly fine for the entity
   * counts in Geometry Wars (~hundreds at peak).
   */
  private resolveCollisions(): void {
    this.rebuildGroupCacheIfNeeded();

    for (let r = 0; r < this.collisionRules.length; r++) {
      const rule = this.collisionRules[r];
      const listA = this.groupCache.get(rule.groupA);
      const listB = this.groupCache.get(rule.groupB);
      if (!listA || !listB) continue;

      for (let i = 0; i < listA.length; i++) {
        const a = listA[i];
        if (!a.active) continue;

        for (let j = 0; j < listB.length; j++) {
          const b = listB[j];
          if (!b.active) continue;

          // Skip self-collision when both groups are the same.
          if (a === b) continue;

          if (a.overlaps(b)) {
            rule.onCollision(a, b);
          }
        }
      }
    }
  }

  /**
   * Remove inactive entities from the list, returning poolable ones to
   * the object pool and disposing meshes for the rest.
   */
  private sweep(): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i];
      if (entity.active) continue;

      this.removeEntity(entity);
      this.entities.splice(i, 1);
    }

    this.groupCacheDirty = true;
  }

  /**
   * Handle cleanup for a single entity being removed.
   */
  private removeEntity(entity: Entity): void {
    // Detach from the scene graph.
    if (entity.mesh?.parent) {
      entity.mesh.parent.remove(entity.mesh);
    }

    // Return to pool or dispose GPU resources.
    if (entity.poolTag) {
      entity.active = false;
      this.pool.release(entity);
    } else if (entity.mesh) {
      // Non-pooled entity: dispose all GPU resources (geometry + materials)
      // to prevent VRAM leaks. Each enemy creates unique CylinderGeometry /
      // SphereGeometry per tube segment — without disposal these accumulate.
      EntityManager.disposeObject3D(entity.mesh);
    }
  }

  /**
   * Traverse an Object3D and dispose all GPU resources (geometry + materials).
   * Safe to call on Groups, Meshes, Lines, and Points.
   * Does NOT dispose textures because those are typically shared/cached.
   */
  private static disposeObject3D(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const renderable = child as THREE.Mesh | THREE.Line | THREE.Points;
      if (renderable.geometry) {
        renderable.geometry.dispose();
      }
      if (renderable.material) {
        if (Array.isArray(renderable.material)) {
          renderable.material.forEach((m: THREE.Material) => m.dispose());
        } else {
          (renderable.material as THREE.Material).dispose();
        }
      }
    });
  }
}
