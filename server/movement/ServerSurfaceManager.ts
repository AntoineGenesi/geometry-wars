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
import {
  createServerMeshLocation,
  isWithinConnectedSurfacePatch,
  toFacePosition,
  type ServerMeshLocation,
} from './ServerMeshLocation';
import { PLAYER_WORLD_SPEED } from '../shared/GameConstants';

const SPHERE_TUNNEL_RADIUS = 10;
const SPHERE_TUNNEL_TUNNEL_RADIUS = 3;
const SPHERE_TUNNEL_BEVEL_RADIUS = 0.6;

export class ServerSurfaceManager {
  private meshSurface: MeshSurface | null = null;
  private surfaceType: SupportedSurface | null = null;
  private scaleFactor: number = 1.0;
  private readonly _portalDirection = new THREE.Vector3();

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

  getWalkerLocation(sessionId: string): ServerMeshLocation | null {
    return this.walkers.get(sessionId)?.getLocation() ?? null;
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
   * Teleport a player's walker to the position corresponding to a UV spawn coord.
   * Used for respawn: the BVH snap inside teleportToWorldPos corrects any
   * approximation error from the UV→world conversion.
   */
  teleportWalkerToUV(sessionId: string, u: number, v: number): void {
    const walker = this.walkers.get(sessionId);
    if (!walker) return;
    const worldPos = this._uvToApproxWorldPos(u, v);
    walker.teleportToWorldPos(worldPos.x, worldPos.y, worldPos.z);
  }

  /** Teleport directly to an authoritative face-constrained location. */
  teleportWalkerToLocation(sessionId: string, location: ServerMeshLocation): boolean {
    const walker = this.walkers.get(sessionId);
    if (!walker) return false;
    walker.teleportToLocation(location);
    return true;
  }

  /** Sample a portal directly on a mesh triangle, with no UV inverse/approximation. */
  createRandomLocation(random: () => number = Math.random): ServerMeshLocation | null {
    if (!this.meshSurface) return null;
    const faceCount = this.meshSurface.geodesic.halfEdge.faceCount;
    if (faceCount === 0) return null;
    const faceIndex = Math.min(faceCount - 1, Math.floor(random() * faceCount));
    const sqrtR1 = Math.sqrt(Math.max(0, Math.min(1, random())));
    const r2 = Math.max(0, Math.min(1, random()));
    return createServerMeshLocation(this.meshSurface, {
      faceIndex,
      bary: {
        u: 1 - sqrtR1,
        v: sqrtR1 * (1 - r2),
        w: sqrtR1 * r2,
      },
    });
  }

  /**
   * Place a portal a known geodesic step from a player's exact walker location.
   * Used by the half-health spawn so "near player" no longer means nearby UV.
   */
  createLocationNearWalker(
    sessionId: string,
    distance: number,
    angleRadians: number = Math.random() * Math.PI * 2,
  ): ServerMeshLocation | null {
    if (!this.meshSurface) return null;
    const start = this.walkers.get(sessionId)?.getLocation();
    if (!start) return null;
    this._portalDirection.set(0, 0, 0)
      .addScaledVector(
        new THREE.Vector3(start.tangentX, start.tangentY, start.tangentZ),
        Math.cos(angleRadians),
      )
      .addScaledVector(
        new THREE.Vector3(start.bitangentX, start.bitangentY, start.bitangentZ),
        Math.sin(angleRadians),
      )
      .normalize();
    const result = this.meshSurface.moveGeodesic(
      toFacePosition(start),
      this._portalDirection,
      distance,
    );
    return createServerMeshLocation(this.meshSurface, result.facePosition);
  }

  isWithinConnectedRadius(
    origin: ServerMeshLocation,
    candidate: ServerMeshLocation,
    radius: number,
  ): boolean {
    return this.meshSurface
      ? isWithinConnectedSurfacePatch(this.meshSurface, origin, candidate, radius)
      : false;
  }

  /**
   * Convert UV spawn offset to approximate world position.
   * Uses sphere parameterization as a universal approximation.
   * The actual snap-to-surface inside ServerMeshWalker constructor
   * (via BVH closestPointOnSurface) corrects any approximation error.
   */
  private _uvToApproxWorldPos(u: number, v: number): THREE.Vector3 {
    if (this.surfaceType === 'sphere-tunnel') {
      return this._sphereTunnelUVToWorldPos(u, v);
    }

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

  private _sphereTunnelUVToWorldPos(u: number, v: number): THREE.Vector3 {
    const R = SPHERE_TUNNEL_RADIUS * this.scaleFactor;
    const tr = SPHERE_TUNNEL_TUNNEL_RADIUS * this.scaleFactor;
    const bR = SPHERE_TUNNEL_BEVEL_RADIUS * this.scaleFactor;

    const sinPhiEnd = Math.min((tr + bR) / (R - bR), 0.99);
    const phiEnd = Math.asin(sinPhiEnd);
    const bevelCenterYTop = Math.cos(phiEnd) * (R - bR);
    const bevelCenterR = tr + bR;
    const bevelAngle = Math.PI / 2 + phiEnd;
    const sphereArcLen = (Math.PI - 2 * phiEnd) * R;
    const bevelArcLen = bR * bevelAngle;
    const tunnelLength = 2 * bevelCenterYTop;
    const totalPerimeter = sphereArcLen + 2 * bevelArcLen + tunnelLength;

    const pos = ((v % 1) + 1) % 1 * totalPerimeter;
    let acc = 0;
    let radial: number;
    let y: number;

    acc += sphereArcLen;
    if (pos < acc) {
      const localT = pos / sphereArcLen;
      const phi = (Math.PI - phiEnd) - localT * (Math.PI - 2 * phiEnd);
      radial = R * Math.sin(phi);
      y = R * Math.cos(phi);
    } else {
      acc += bevelArcLen;
      if (pos < acc) {
        const localT = (pos - (acc - bevelArcLen)) / bevelArcLen;
        const angle = (Math.PI / 2 - phiEnd) + localT * bevelAngle;
        radial = bevelCenterR + bR * Math.cos(angle);
        y = bevelCenterYTop + bR * Math.sin(angle);
      } else {
        acc += tunnelLength;
        if (pos < acc) {
          const localT = (pos - (acc - tunnelLength)) / tunnelLength;
          radial = tr;
          y = bevelCenterYTop * (1 - 2 * localT);
        } else {
          const localT = (pos - acc) / bevelArcLen;
          const angle = Math.PI + localT * bevelAngle;
          radial = bevelCenterR + bR * Math.cos(angle);
          y = -bevelCenterYTop + bR * Math.sin(angle);
        }
      }
    }

    const theta = ((u % 1) + 1) % 1 * Math.PI * 2;
    return new THREE.Vector3(
      radial * Math.cos(theta),
      y,
      radial * Math.sin(theta),
    );
  }

  /**
   * Convert a surface UV coordinate to an accurate world-space position.
   * Uses sphere approximation to seed the query, then BVH-snaps to the actual surface.
   * Used for zone center positioning in KotH/Claustrophobia modes — works on all surfaces.
   */
  getWorldPosForUV(u: number, v: number): THREE.Vector3 {
    const approxWorld = this._uvToApproxWorldPos(u, v);
    if (!this.meshSurface) return approxWorld;
    const result = this.meshSurface.closestPointOnSurface(approxWorld);
    return result ? result.point.clone() : approxWorld;
  }

  /**
   * Bounding sphere radius of the current surface geometry (scale already baked in).
   * Used to compute world-space zone radii proportional to surface size.
   */
  getBoundingSphereRadius(): number {
    if (!this.meshSurface) return 10 * this.scaleFactor;
    const geo = this.meshSurface.mesh.geometry;
    geo.computeBoundingSphere();
    return geo.boundingSphere?.radius ?? 10 * this.scaleFactor;
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
