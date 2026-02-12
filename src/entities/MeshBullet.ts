/**
 * MeshBullet - A bullet that travels along any mesh surface.
 *
 * Replaces the spherical great-circle bullet system.
 * Key properties:
 * - Moves in world space, then projects back onto mesh surface each frame
 * - Follows the surface curvature regardless of shape
 * - Works on sphere, torus, cube, arbitrary meshes
 * - Speed is constant in world units per second
 */

import * as THREE from 'three';
import { MeshSurface } from '../surfaces/MeshSurface';

const BULLET_SPEED = 4.0;       // world units per second
const BULLET_LIFETIME = 4.0;    // seconds
const BULLET_LENGTH = 0.25;     // visual line length
const BULLET_COLOR = 0xffff44;  // bright yellow

interface MeshBulletData {
  alive: boolean;
  age: number;
  /** Current position on surface (world space) */
  position: THREE.Vector3;
  /** Current surface normal */
  normal: THREE.Vector3;
  /** Movement direction (tangent to surface, world space) */
  direction: THREE.Vector3;
  /** Face index for tracking */
  faceIndex: number;
}

export class MeshBulletPool {
  readonly root: THREE.Group;
  private readonly bullets: MeshBulletData[] = [];
  private readonly lines: THREE.Line[] = [];
  private readonly poolSize: number;
  private surface: MeshSurface | null = null;

  constructor(poolSize: number = 200) {
    this.poolSize = poolSize;
    this.root = new THREE.Group();
    this.root.name = 'MeshBulletPool';

    const geometry = this.createBulletGeometry();
    const material = new THREE.LineBasicMaterial({
      color: BULLET_COLOR,
      linewidth: 2,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let i = 0; i < poolSize; i++) {
      const line = new THREE.Line(geometry.clone(), material);
      line.visible = false;
      line.frustumCulled = false;
      this.root.add(line);
      this.lines.push(line);

      this.bullets.push({
        alive: false,
        age: 0,
        position: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),
        direction: new THREE.Vector3(0, 0, 1),
        faceIndex: 0,
      });
    }
  }

  /**
   * Set the mesh surface for bullet projection.
   * Must be called before spawning bullets.
   */
  setSurface(surface: MeshSurface): void {
    this.surface = surface;
  }

  /**
   * Spawn a bullet at a position on the mesh surface, traveling in a given direction.
   *
   * @param origin - World-space spawn position (should already be on surface)
   * @param direction - World-space direction (will be projected onto surface tangent)
   * @param surfaceNormal - Normal at spawn point
   */
  spawn(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    surfaceNormal: THREE.Vector3,
  ): void {
    const idx = this.findInactive();
    if (idx < 0) return;

    const b = this.bullets[idx];
    b.alive = true;
    b.age = 0;
    b.position.copy(origin);
    b.normal.copy(surfaceNormal);

    // Project direction onto surface tangent plane
    const normal = surfaceNormal.clone().normalize();
    const projDir = direction.clone();
    projDir.sub(normal.clone().multiplyScalar(projDir.dot(normal)));
    const len = projDir.length();
    if (len > 0.0001) {
      projDir.normalize();
    } else {
      // Fallback: pick arbitrary tangent direction
      const ref = Math.abs(normal.y) < 0.99
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      projDir.crossVectors(normal, ref).normalize();
    }
    b.direction.copy(projDir);

    const line = this.lines[idx];
    line.position.copy(origin);
    line.visible = true;
    this.orientLine(line, projDir);
  }

  /**
   * Update all active bullets.
   * Each bullet:
   * 1. Moves along its current direction in world space
   * 2. Projects back onto the mesh surface
   * 3. Updates direction to remain tangent to the surface
   */
  update(dt: number): void {
    if (!this.surface) return;

    for (let i = 0; i < this.poolSize; i++) {
      const b = this.bullets[i];
      if (!b.alive) continue;

      b.age += dt;
      if (b.age >= BULLET_LIFETIME) {
        this.kill(i);
        continue;
      }

      // Move in world space along current tangent direction
      const dist = BULLET_SPEED * dt;
      const newPos = b.position.clone().addScaledVector(b.direction, dist);

      // Project back onto mesh surface
      const result = this.surface.closestPointOnSurface(newPos);
      if (!result) {
        this.kill(i);
        continue;
      }

      // Update bullet state
      b.position.copy(result.point);
      b.normal.copy(result.normal);
      b.faceIndex = result.faceIndex;

      // Update direction to remain tangent to surface at new position
      const normal = result.normal.clone().normalize();
      const dot = b.direction.dot(normal);
      b.direction.sub(normal.clone().multiplyScalar(dot));
      const dirLen = b.direction.length();
      if (dirLen > 0.0001) {
        b.direction.normalize();
      } else {
        // Direction collapsed (bullet going straight into surface) - kill it
        this.kill(i);
        continue;
      }

      // Update visual
      const line = this.lines[i];
      line.position.copy(result.point);
      this.orientLine(line, b.direction);
    }
  }

  /**
   * Kill a bullet at the given index.
   */
  kill(i: number): void {
    this.bullets[i].alive = false;
    this.lines[i].visible = false;
  }

  /**
   * Iterate over all active bullets for collision checks.
   */
  forEachActive(
    fn: (index: number, position: THREE.Vector3, direction: THREE.Vector3) => void,
  ): void {
    for (let i = 0; i < this.poolSize; i++) {
      if (!this.bullets[i].alive) continue;
      fn(i, this.bullets[i].position, this.bullets[i].direction);
    }
  }

  /** Number of active bullets */
  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.poolSize; i++) {
      if (this.bullets[i].alive) n++;
    }
    return n;
  }

  /** Deactivate all bullets */
  clear(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.kill(i);
    }
  }

  private findInactive(): number {
    for (let i = 0; i < this.poolSize; i++) {
      if (!this.bullets[i].alive) return i;
    }
    return -1;
  }

  private createBulletGeometry(): THREE.BufferGeometry {
    const half = BULLET_LENGTH / 2;
    const vertices = new Float32Array([0, 0, -half, 0, 0, half]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    return geometry;
  }

  private orientLine(line: THREE.Line, dir: THREE.Vector3): void {
    const target = line.position.clone().add(dir);
    line.lookAt(target);
  }
}
