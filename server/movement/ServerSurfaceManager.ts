/**
 * ServerSurfaceManager — manages the lifecycle of the server-side surface
 * (mesh + BVH) and all player walkers.
 *
 * GameRoom uses this as the single point for:
 * 1. Creating a surface for the chosen map type at game start
 * 2. Creating a ServerMeshWalker for each player on join / game start
 * 3. Providing world-space spawn positions from UV offsets
 * 4. Providing MeshSurface to other server systems (collision) if needed
 *
 * This keeps GameRoom from growing further — all surface/walker lifecycle
 * is encapsulated here.
 */

import * as THREE from 'three';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { buildSurfaceGeometry, SupportedSurface } from './SurfaceGeometryBuilder';
import { ServerMeshWalker } from './ServerMeshWalker';
import { PLAYER_WORLD_SPEED } from '../shared/GameConstants';

export class ServerSurfaceManager {
  private meshSurface: MeshSurface | null = null;
  private surfaceType: SupportedSurface | null = null;
  private scaleFactor: number = 1.0;

  /** Per-session-id walker. */
  private walkers: Map<string, ServerMeshWalker> = new Map();

  /**
   * Initialize surface for a new game.
   * Called from GameRoom.startGame() before any player movement.
   * Disposes the previous game's surface first (if any).
   */
  initSurface(surfaceType: string, scaleFactor: number = 1.0): void {
    this.dispose();

    const type = surfaceType as SupportedSurface;
    const mesh = buildSurfaceGeometry(type, scaleFactor);
    this.meshSurface = new MeshSurface(mesh);
    this.surfaceType = type;
    this.scaleFactor = scaleFactor;
  }

  /**
   * Create a walker for a player at a UV spawn position.
   * UV → approximate world pos → snap to nearest surface point.
   * Returns null if the surface hasn't been initialized yet.
   */
  createWalker(sessionId: string, spawnU: number, spawnV: number): ServerMeshWalker | null {
    if (!this.meshSurface) return null;

    const worldPos = this._uvToApproxWorldPos(spawnU, spawnV);
    const walker = new ServerMeshWalker(this.meshSurface, worldPos, PLAYER_WORLD_SPEED);
    this.walkers.set(sessionId, walker);
    return walker;
  }

  getWalker(sessionId: string): ServerMeshWalker | null {
    return this.walkers.get(sessionId) ?? null;
  }

  removeWalker(sessionId: string): void {
    this.walkers.delete(sessionId);
  }

  getMeshSurface(): MeshSurface | null {
    return this.meshSurface;
  }

  getSurfaceType(): SupportedSurface | null {
    return this.surfaceType;
  }

  getWalkerCount(): number {
    return this.walkers.size;
  }

  /**
   * Convert UV spawn offset to approximate world position.
   * Uses sphere parameterization as a universal approximation.
   * The actual snap-to-surface inside ServerMeshWalker constructor
   * (via BVH closestPointOnSurface) corrects any approximation error.
   */
  private _uvToApproxWorldPos(u: number, v: number): THREE.Vector3 {
    // Clamp v away from exact poles to avoid degenerate surface queries
    const safeV = Math.max(0.02, Math.min(0.98, v));
    const phi = safeV * Math.PI;
    const theta = u * 2 * Math.PI;
    const r = 10 * this.scaleFactor;
    return new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
  }

  /**
   * Dispose all walkers and surface BVH.
   * Call between game rounds, or when the room is destroyed.
   */
  dispose(): void {
    this.walkers.clear();
    if (this.meshSurface) {
      this.meshSurface.dispose();
      this.meshSurface = null;
    }
    this.surfaceType = null;
  }
}
