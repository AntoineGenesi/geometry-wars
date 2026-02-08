/**
 * WASM-based collision detection using Rapier3D.
 *
 * Wraps the Rapier physics world to provide efficient broad-phase + narrow-phase
 * collision detection for 10K+ entities. Uses sensor colliders (no physics response)
 * since entity movement is handled by the surface/geodesic system, not physics.
 *
 * All colliders are spheres. Gravity is zero. This is purely a collision query engine.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import {
  COLLISION_CATEGORY,
  COLLISION_FILTER,
  makeInteractionGroups,
} from './CollisionGroups';

/** Result of a collision query: two entity IDs that overlap. */
export interface CollisionPair {
  idA: string;
  idB: string;
}

/** Position with 3 coordinates. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Tracks a Rapier rigid body + collider for one game entity. */
interface BodyEntry {
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  category: string;
}

/**
 * Lazily loads and initializes the Rapier WASM module.
 * Returns the RAPIER namespace. Caches the result for subsequent calls.
 */
let rapierPromise: Promise<typeof RAPIER> | null = null;

export function initRapier(): Promise<typeof RAPIER> {
  if (!rapierPromise) {
    rapierPromise = import('@dimforge/rapier3d-compat').then(async (module) => {
      await module.default.init();
      return module.default;
    });
  }
  return rapierPromise;
}

/**
 * Reset the cached RAPIER promise. Used in tests to allow re-initialization.
 */
export function resetRapierInit(): void {
  rapierPromise = null;
}

export class RapierWorld {
  private rapier: typeof RAPIER | null = null;
  private world: RAPIER.World | null = null;
  private eventQueue: RAPIER.EventQueue | null = null;
  private bodies: Map<string, BodyEntry> = new Map();
  private colliderToId: Map<number, string> = new Map();
  private initialized = false;

  /** Whether Rapier WASM has been loaded and the world is ready. */
  get isReady(): boolean {
    return this.initialized;
  }

  /** Number of tracked entities. */
  get entityCount(): number {
    return this.bodies.size;
  }

  /**
   * Initialize Rapier WASM and create the physics world.
   * Must be called (and awaited) before any other methods.
   * Safe to call multiple times -- subsequent calls are no-ops.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.rapier = await initRapier();
    // Zero gravity: entities move via game logic, not physics
    this.world = new this.rapier.World({ x: 0, y: 0, z: 0 });
    // Event queue for collision events (autoDrain=true to prevent unbounded memory)
    this.eventQueue = new this.rapier.EventQueue(true);
    this.initialized = true;
  }

  /**
   * Add a sensor collider (sphere) for an entity.
   *
   * @param id - Unique entity identifier
   * @param position - World-space position
   * @param radius - Bounding sphere radius
   * @param category - Entity type: 'player', 'enemy', 'bullet', 'geom', 'pickup'
   */
  addEntity(id: string, position: Vec3Like, radius: number, category: string): void {
    if (!this.initialized || !this.rapier || !this.world) {
      throw new Error('RapierWorld not initialized. Call init() first.');
    }

    // Remove existing body with same ID if present
    if (this.bodies.has(id)) {
      this.removeEntity(id);
    }

    // Create kinematic rigid body (we control position, no physics simulation)
    const bodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);
    const rigidBody = this.world.createRigidBody(bodyDesc);

    // Create sphere collider as sensor (detects overlaps, no physics response)
    const membership = this.getCategoryBit(category);
    const filter = this.getFilterBit(category);
    const interactionGroups = makeInteractionGroups(membership, filter);

    const colliderDesc = this.rapier.ColliderDesc.ball(radius)
      .setSensor(true)
      .setCollisionGroups(interactionGroups)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, rigidBody);

    this.bodies.set(id, { rigidBody, collider, radius, category });
    this.colliderToId.set(collider.handle, id);
  }

  /**
   * Update an entity's position in the physics world.
   *
   * @param id - Entity identifier (must have been added first)
   * @param position - New world-space position
   */
  updateEntity(id: string, position: Vec3Like): void {
    const entry = this.bodies.get(id);
    if (!entry) return;

    entry.rigidBody.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z,
    });
  }

  /**
   * Update an entity's position and radius.
   */
  updateEntityFull(id: string, position: Vec3Like, radius: number): void {
    const entry = this.bodies.get(id);
    if (!entry || !this.rapier || !this.world) return;

    entry.rigidBody.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z,
    });

    // Only recreate collider if radius changed significantly
    if (Math.abs(entry.radius - radius) > 0.001) {
      // Remove old collider handle from lookup
      this.colliderToId.delete(entry.collider.handle);
      this.world.removeCollider(entry.collider, false);

      const membership = this.getCategoryBit(entry.category);
      const filter = this.getFilterBit(entry.category);
      const interactionGroups = makeInteractionGroups(membership, filter);

      const colliderDesc = this.rapier.ColliderDesc.ball(radius)
        .setSensor(true)
        .setCollisionGroups(interactionGroups)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
      entry.collider = this.world.createCollider(colliderDesc, entry.rigidBody);
      entry.radius = radius;

      // Update lookup with new handle
      this.colliderToId.set(entry.collider.handle, id);
    }
  }

  /**
   * Remove an entity from the physics world.
   *
   * @param id - Entity identifier
   */
  removeEntity(id: string): void {
    const entry = this.bodies.get(id);
    if (!entry || !this.world) return;

    this.colliderToId.delete(entry.collider.handle);
    this.world.removeRigidBody(entry.rigidBody);
    this.bodies.delete(id);
  }

  /**
   * Step the physics world and return all currently overlapping sensor pairs.
   *
   * Uses intersectionPairsWith on each collider to find all current overlaps.
   * This gives a snapshot of ALL overlapping pairs, not just events.
   *
   * Deduplication: We track seen pairs to avoid reporting (A,B) and (B,A).
   */
  getCollisions(): CollisionPair[] {
    if (!this.world || !this.eventQueue || !this.rapier) return [];

    // Step to commit kinematic positions and run broadphase + narrow phase
    this.world.step(this.eventQueue);

    const pairs: CollisionPair[] = [];
    const seen = new Set<string>();

    // Use intersectionsWithShape for each entity to find overlaps.
    // This is more reliable than intersectionPairsWith because it performs
    // a direct broadphase query rather than relying on pre-computed narrow
    // phase pairs (which can miss newly-added sensors).
    for (const [id, entry] of this.bodies) {
      const translation = entry.rigidBody.translation();
      const shape = new this.rapier.Ball(entry.radius);
      const shapePos = { x: translation.x, y: translation.y, z: translation.z };
      const shapeRot = { x: 0, y: 0, z: 0, w: 1 };

      // Query with this entity's collision group filters
      const membership = this.getCategoryBit(entry.category);
      const filter = this.getFilterBit(entry.category);
      const interactionGroups = makeInteractionGroups(membership, filter);

      this.world.intersectionsWithShape(
        shapePos, shapeRot, shape,
        (otherCollider) => {
          const otherId = this.colliderToId.get(otherCollider.handle);
          if (otherId === undefined) return true;

          // Deduplicate: use sorted pair key
          const pairKey = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
          if (seen.has(pairKey)) return true;
          seen.add(pairKey);

          pairs.push({ idA: id, idB: otherId });
          return true; // continue iterating
        },
        undefined,  // filterFlags
        interactionGroups,  // filterGroups
        entry.collider,  // filterExcludeCollider (skip self)
      );
    }

    return pairs;
  }

  /**
   * Step the physics world without returning collision results.
   * Call this once per frame before using queryNearby or getCollisionsForCategory.
   */
  step(): void {
    if (!this.world || !this.eventQueue) return;
    this.world.step(this.eventQueue);
  }

  /**
   * Get collisions only for entities of a specific category.
   * More efficient than getCollisions() since it only queries a subset.
   *
   * Call step() first, then this method for each category you need.
   *
   * @param category - The category to query from ('bullet', 'player', etc.)
   * @returns Array of collision pairs where one entity is of the specified category
   */
  getCollisionsForCategory(category: string): CollisionPair[] {
    if (!this.world || !this.rapier) return [];

    const pairs: CollisionPair[] = [];
    const membership = this.getCategoryBit(category);
    const filter = this.getFilterBit(category);
    const interactionGroups = makeInteractionGroups(membership, filter);

    for (const [id, entry] of this.bodies) {
      if (entry.category !== category) continue;

      const translation = entry.rigidBody.translation();
      const shape = new this.rapier.Ball(entry.radius);
      const shapePos = { x: translation.x, y: translation.y, z: translation.z };
      const shapeRot = { x: 0, y: 0, z: 0, w: 1 };

      this.world.intersectionsWithShape(
        shapePos, shapeRot, shape,
        (otherCollider) => {
          const otherId = this.colliderToId.get(otherCollider.handle);
          if (otherId === undefined) return true;
          pairs.push({ idA: id, idB: otherId });
          return true;
        },
        undefined,
        interactionGroups,
        entry.collider,
      );
    }

    return pairs;
  }

  /**
   * Query all entities within a sphere at the given position.
   * Uses Rapier's broadphase for O(log n) spatial query.
   *
   * @param position - Center of the query sphere
   * @param radius - Query radius
   * @returns Array of entity IDs within range
   */
  queryNearby(position: Vec3Like, radius: number): string[] {
    if (!this.world || !this.rapier) return [];

    const results: string[] = [];

    // Use Rapier's intersection test with a sphere shape
    const shape = new this.rapier.Ball(radius);
    const shapePos = { x: position.x, y: position.y, z: position.z };
    const shapeRot = { x: 0, y: 0, z: 0, w: 1 };

    this.world.intersectionsWithShape(shapePos, shapeRot, shape, (collider) => {
      const id = this.colliderToId.get(collider.handle);
      if (id !== undefined) {
        results.push(id);
      }
      return true; // continue iterating
    });

    return results;
  }

  /**
   * Remove all entities and clean up. Does NOT destroy the world itself.
   */
  clear(): void {
    if (!this.world) return;

    for (const [, entry] of this.bodies) {
      this.world.removeRigidBody(entry.rigidBody);
    }
    this.bodies.clear();
    this.colliderToId.clear();
  }

  /**
   * Fully destroy the physics world. After calling this, init() must
   * be called again before reuse.
   */
  destroy(): void {
    this.clear();
    if (this.eventQueue) {
      this.eventQueue.free();
      this.eventQueue = null;
    }
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    this.rapier = null;
    this.initialized = false;
  }

  // ---- Internal helpers ----

  private getCategoryBit(category: string): number {
    switch (category) {
      case 'player': return COLLISION_CATEGORY.PLAYER;
      case 'enemy':  return COLLISION_CATEGORY.ENEMY;
      case 'bullet': return COLLISION_CATEGORY.BULLET;
      case 'geom':   return COLLISION_CATEGORY.GEOM;
      case 'pickup': return COLLISION_CATEGORY.PICKUP;
      default:       return 0;
    }
  }

  private getFilterBit(category: string): number {
    switch (category) {
      case 'player': return COLLISION_FILTER.PLAYER;
      case 'enemy':  return COLLISION_FILTER.ENEMY;
      case 'bullet': return COLLISION_FILTER.BULLET;
      case 'geom':   return COLLISION_FILTER.GEOM;
      case 'pickup': return COLLISION_FILTER.PICKUP;
      default:       return 0;
    }
  }
}
