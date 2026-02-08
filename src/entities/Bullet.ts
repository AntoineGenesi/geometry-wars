import * as THREE from 'three';
import { MeshSurface } from '../experimental/mesh-movement/MeshSurface';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BULLET_SPEED = 4.0; // units / sec (world space) - fast for responsive gameplay
const BULLET_LIFETIME = 6; // seconds
const POOL_SIZE = 200; // max bullets alive at once
const BULLET_LENGTH = 0.25; // visual length of the line
const BULLET_COLOR = new THREE.Color(0x88ffff); // white-cyan (GW3D authentic)

// Default sphere radius for projection (used if no surface function provided)
const DEFAULT_SPHERE_RADIUS = 8;

// ---------------------------------------------------------------------------
// Single bullet data (plain object, no class overhead)
// ---------------------------------------------------------------------------

interface BulletData {
  alive: boolean;
  age: number;
  /** Surface coordinates (stored but not used for movement in this version). */
  surfaceU: number;
  surfaceV: number;
  /** Direction angle on the surface (radians). */
  angle: number;
  /** World-space velocity direction. */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Sphere radius for projection (captured at spawn). */
  sphereRadius: number;
  /** Player who fired this bullet (-1 = unowned, 0 = P1, 1 = P2, etc.) */
  ownerId: number;
}

// ---------------------------------------------------------------------------
// Surface transform function type
// ---------------------------------------------------------------------------

type SurfaceTransformFn = (u: number, v: number) => {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
};

// ---------------------------------------------------------------------------
// BulletPool -- object-pooled collection of bullets
// ---------------------------------------------------------------------------

export class BulletPool {
  /** Shared parent that holds all bullet line meshes. */
  readonly root: THREE.Group;

  private readonly bullets: BulletData[] = [];
  private readonly lines: THREE.Line[] = [];

  /** Surface transform function (optional, used for projection if set). */
  private getTransform: SurfaceTransformFn | null = null;

  /** Sphere radius used for projection. */
  private sphereRadius: number = DEFAULT_SPHERE_RADIUS;

  /** Mesh-based surface for shape-agnostic bullet projection. */
  private meshSurface: MeshSurface | null = null;

  /** External speed multiplier (e.g. from player leveling). */
  speedMultiplier = 1.0;

  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'BulletPool';

    const geometry = createBulletGeometry();
    const material = new THREE.LineBasicMaterial({
      color: BULLET_COLOR,
      linewidth: 2,
      transparent: true,
      opacity: 1.0,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    for (let i = 0; i < POOL_SIZE; i++) {
      const line = new THREE.Line(geometry.clone(), material);
      line.visible = false;
      line.frustumCulled = false;
      this.root.add(line);
      this.lines.push(line);

      this.bullets.push({
        alive: false,
        age: 0,
        surfaceU: 0,
        surfaceV: 0,
        angle: 0,
        dirX: 0,
        dirY: 0,
        dirZ: 0,
        sphereRadius: DEFAULT_SPHERE_RADIUS,
        ownerId: -1,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Set the surface functions for positioning.
   * For backwards compatibility - the UV-based movement is no longer used.
   */
  setSurfaceFunctions(
    getTransform: SurfaceTransformFn,
    _moveOnSurface?: (u: number, v: number, du: number, dv: number) => { u: number; v: number }
  ): void {
    this.getTransform = getTransform;
  }

  /**
   * Set the sphere radius for bullet projection.
   */
  setSphereRadius(radius: number): void {
    this.sphereRadius = radius;
  }

  /**
   * Set a MeshSurface for shape-agnostic bullet projection.
   * When set, bullets project onto this mesh instead of assuming a sphere.
   */
  setMeshSurface(meshSurface: MeshSurface): void {
    this.meshSurface = meshSurface;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Activate a pooled bullet at the given world-space origin, travelling in
   * the specified direction.
   */
  spawn(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    surfaceU: number,
    surfaceV: number,
    angle: number,
    ownerId: number = -1,
  ): void {
    const idx = this.findInactive();
    if (idx < 0) return; // pool exhausted

    const b = this.bullets[idx];
    b.alive = true;
    b.age = 0;
    b.surfaceU = surfaceU;
    b.surfaceV = surfaceV;
    b.angle = angle;
    b.dirX = direction.x;
    b.dirY = direction.y;
    b.dirZ = direction.z;
    b.sphereRadius = origin.length(); // Use spawn distance as radius
    b.ownerId = ownerId;

    const line = this.lines[idx];
    line.position.copy(origin);
    line.visible = true;

    // Orient the line to face the travel direction
    orientLine(line, direction);
  }

  /**
   * Advance all active bullets by `dt` seconds.
   *
   * When meshSurface is set (preferred):
   *   Uses BVH-based closest-point query to project onto ANY mesh surface.
   *   Works for sphere, torus, cube, arbitrary meshes.
   *
   * Fallback (no meshSurface):
   *   Legacy sphere projection (normalize to radius).
   */
  update(dt: number): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const b = this.bullets[i];
      if (!b.alive) continue;

      b.age += dt;
      if (b.age >= BULLET_LIFETIME) {
        this.kill(i);
        continue;
      }

      const line = this.lines[i];

      // Move in world space along direction
      const dist = BULLET_SPEED * this.speedMultiplier * dt;
      const prevX = line.position.x;
      const prevY = line.position.y;
      const prevZ = line.position.z;
      line.position.x += b.dirX * dist;
      line.position.y += b.dirY * dist;
      line.position.z += b.dirZ * dist;

      if (this.meshSurface) {
        // -- Mesh-based projection (shape-agnostic) --
        const result = this.meshSurface.closestPointOnSurface(line.position);
        if (!result) {
          this.kill(i);
          continue;
        }

        // Guard: if projection snapped the bullet too far from its previous
        // position, it likely jumped through the surface to the other side.
        const dx = result.point.x - prevX;
        const dy = result.point.y - prevY;
        const dz = result.point.z - prevZ;
        const jumpDistSq = dx * dx + dy * dy + dz * dz;
        if (jumpDistSq > dist * dist * 9) { // > 3x step distance
          this.kill(i);
          continue;
        }

        line.position.copy(result.point);

        // Update direction to remain tangent to surface at new position
        const normal = result.normal;
        const dir = new THREE.Vector3(b.dirX, b.dirY, b.dirZ);
        const dot = dir.dot(normal);
        dir.x -= dot * normal.x;
        dir.y -= dot * normal.y;
        dir.z -= dot * normal.z;
        const dirLen = dir.length();
        if (dirLen > 0.0001) {
          dir.multiplyScalar(1 / dirLen);
        } else {
          this.kill(i);
          continue;
        }

        b.dirX = dir.x;
        b.dirY = dir.y;
        b.dirZ = dir.z;
      } else {
        // -- Legacy sphere projection (fallback) --
        const currentDist = line.position.length();
        if (currentDist > 0.001) {
          const targetRadius = b.sphereRadius > 0 ? b.sphereRadius : this.sphereRadius;
          line.position.multiplyScalar(targetRadius / currentDist);
        }

        const normal = line.position.clone().normalize();
        const dir = new THREE.Vector3(b.dirX, b.dirY, b.dirZ);
        const dot = dir.dot(normal);
        dir.x -= dot * normal.x;
        dir.y -= dot * normal.y;
        dir.z -= dot * normal.z;
        dir.normalize();

        b.dirX = dir.x;
        b.dirY = dir.y;
        b.dirZ = dir.z;
      }

      // Orient the line visual to match direction
      orientLine(line, new THREE.Vector3(b.dirX, b.dirY, b.dirZ));
    }
  }

  /**
   * Project all active bullets onto the surface.
   * Called each frame to ensure bullets stick to the rotating surface.
   */
  applySurfaceProjection(
    getTransform: (
      u: number,
      v: number,
    ) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    // Store for future use
    if (!this.getTransform) {
      this.getTransform = getTransform;
    }
    // Note: For the rotation system, bullets move in world space and
    // project onto a sphere. The surface rotates with the group,
    // so bullets appear to follow great circles on the surface.
  }

  /**
   * Deactivate the bullet at index `i`.
   */
  kill(i: number): void {
    this.bullets[i].alive = false;
    this.lines[i].visible = false;
  }

  /**
   * Iterate over all active bullets (index + data) for collision checks.
   */
  forEachActive(
    fn: (index: number, position: THREE.Vector3, data: Readonly<BulletData>) => void,
  ): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!this.bullets[i].alive) continue;
      fn(i, this.lines[i].position, this.bullets[i]);
    }
  }

  /** Number of currently active bullets. */
  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.bullets[i].alive) n++;
    }
    return n;
  }

  /** Deactivate all bullets. */
  clear(): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.kill(i);
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private findInactive(): number {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!this.bullets[i].alive) return i;
    }
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a short line segment along local +Z. */
function createBulletGeometry(): THREE.BufferGeometry {
  const half = BULLET_LENGTH / 2;
  const vertices = new Float32Array([0, 0, -half, 0, 0, half]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return geometry;
}

/** Point a line object so that its local +Z aligns with `dir`. */
function orientLine(line: THREE.Line, dir: THREE.Vector3): void {
  const target = line.position.clone().add(dir);
  line.lookAt(target);
}
