import * as THREE from 'three';

/**
 * Parametric surface coordinates.
 *
 * u and v each range over [0, 1] and map to a position on the
 * underlying 3-D surface (sphere, torus, peanut, etc.).
 */
export interface SurfacePosition {
  u: number;
  v: number;
}

/**
 * Collision group flags.  Each entity belongs to one group and can
 * collide with entities in other groups.  The EntityManager uses these
 * to decide which pairs to test.
 */
export enum CollisionGroup {
  None = 0,
  Player = 1 << 0,
  Enemy = 1 << 1,
  Bullet = 1 << 2,
  Geom = 1 << 3,
  Particle = 1 << 4,
}

/**
 * Abstract base class for every game object.
 *
 * Subclasses must implement `update` and `onCollision`.
 * Position / velocity are maintained both in world-space (THREE.Vector3)
 * and in parametric surface coordinates so that entities can move
 * correctly along curved 3-D surfaces.
 */
export abstract class Entity {
  // ---- Spatial state --------------------------------------------------

  /** World-space position (derived from surfacePosition each frame). */
  readonly position: THREE.Vector3 = new THREE.Vector3();

  /**
   * Velocity expressed as a tangent vector on the surface.
   * The physics step integrates this along the surface.
   */
  readonly velocity: THREE.Vector3 = new THREE.Vector3();

  /** Parametric coordinates on the current surface. */
  surfacePosition: SurfacePosition = { u: 0, v: 0 };

  // ---- Visual ---------------------------------------------------------

  /** The Three.js scene object for this entity.  May be null for
   *  invisible entities (e.g. spawn markers). */
  mesh: THREE.Object3D | null = null;

  // ---- Collision ------------------------------------------------------

  /** Bounding-sphere radius used for broad-phase collision checks. */
  radius: number = 0.5;

  /** The collision group this entity belongs to. */
  collisionGroup: CollisionGroup = CollisionGroup.None;

  /**
   * Bitmask of collision groups this entity can collide *with*.
   * For example a bullet might set this to `CollisionGroup.Enemy`.
   */
  collisionMask: CollisionGroup = CollisionGroup.None;

  // ---- Lifecycle ------------------------------------------------------

  /** When false the entity is considered "dead" and will be recycled or
   *  removed by the EntityManager at the end of the current frame. */
  active: boolean = true;

  /** Optional type tag used by the object pool for recycling. */
  poolTag: string = '';

  // ---- Previous-frame state for interpolation -------------------------

  /** Position snapshot taken at the start of each physics tick.
   *  The renderer lerps between previousPosition and position using
   *  the clock's interpolation alpha. */
  readonly previousPosition: THREE.Vector3 = new THREE.Vector3();

  // ---- Abstract methods -----------------------------------------------

  /**
   * Called once per fixed-timestep physics tick.
   * @param dt - Fixed delta time in seconds (1/60).
   */
  abstract update(dt: number): void;

  /**
   * Called by the EntityManager when a collision is detected.
   * @param other - The entity this one collided with.
   */
  abstract onCollision(other: Entity): void;

  // ---- Helpers --------------------------------------------------------

  /**
   * Deactivate this entity.  It will be removed (or returned to the
   * pool) at the end of the current frame.
   */
  destroy(): void {
    this.active = false;
  }

  /**
   * Snapshot the current position for interpolation.
   * Called by the EntityManager at the start of each physics tick.
   */
  savePosition(): void {
    this.previousPosition.copy(this.position);
  }

  /**
   * Compute the interpolated position between the previous and current
   * physics positions.
   * @param alpha - Interpolation factor in [0, 1].
   * @param out   - Vector to write the result into.
   */
  getInterpolatedPosition(alpha: number, out: THREE.Vector3): void {
    out.lerpVectors(this.previousPosition, this.position, alpha);
  }

  /**
   * Squared distance to another entity (cheaper than sqrt for
   * broad-phase checks).
   */
  distanceToSquared(other: Entity): number {
    return this.position.distanceToSquared(other.position);
  }

  /**
   * Check whether this entity overlaps another using bounding spheres.
   */
  overlaps(other: Entity): boolean {
    const combinedRadius = this.radius + other.radius;
    return this.distanceToSquared(other) <= combinedRadius * combinedRadius;
  }
}
