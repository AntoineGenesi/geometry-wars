/**
 * MPRealGameTestHarness — Tests the ACTUAL MP code path algorithms.
 *
 * network-main.ts is a 7000-line browser closure that can't be instantiated in tests.
 * This harness replicates the KEY ALGORITHMS that differ between SP and MP:
 *
 *   1. Aim angle computation — `computeCameraRelativeAimAngle` with torus/pill UV fix
 *   2. Bullet direction reconstruction — server sends (dirX, dirY) UV-space components,
 *      client reconstructs world direction via `tangentU * dirX + tangentV * dirY`
 *   3. Hit detection — server uses world-space distance (`surfaceWorldDist`) per surface
 *   4. Player movement — geodesic stepping via `MeshSurface.moveGeodesic` (server path)
 *
 * This is "Approach B" from the task file: mock server state, real surface geometry.
 * Faster than a full Colyseus connection while still testing the MP-specific code paths.
 *
 * FALSE POSITIVE CONTEXT (s44r3):
 * s44r3-03 (cube aim), s44r3-08 (Mobius seam), s44r3-09 (hit detection) were all marked
 * VERIFIED using SP-only tests. They were STILL BROKEN in MP because the SP harness
 * (RealGameTestHarness) tests GameLoop.ts, not network-main.ts. This harness exists to
 * prevent that failure mode.
 *
 * @see src/test/RealGameTestHarness.ts — SP equivalent
 * @see src/utils/aimAngle.ts — MP aim angle computation (the key MP-specific function)
 * @see server/rooms/GameRoom.ts — server-side hit detection (surfaceWorldDist inlined here)
 */

import * as THREE from 'three';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';
import { CameraController } from '../core/CameraController';
import { computeCameraRelativeAimAngle } from '../utils/aimAngle';
import {
  createStandardSurfaceConfig,
  makeSurfaceTransformFn,
  DEFAULT_SURFACE_SCALE,
} from '../rendering/SharedGameSetup';
import { getMapSizeScaleFactor, MapSize } from '../core/MapSize';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MPHarnessOptions {
  surface?: SurfaceType;
  mapSize?: MapSize;
  /** Viewport width for camera and aim angle normalisation */
  width?: number;
  /** Viewport height for camera and aim angle normalisation */
  height?: number;
}

/** Simulated server player state (mirrors NetworkPlayerState fields used in aim/bullet code) */
export interface MPPlayerState {
  surfaceU: number;
  surfaceV: number;
  /** World position (from server geodesic walk — wx/wy/wz in NetworkPlayerState) */
  worldPos: THREE.Vector3;
  aimAngle: number;
}

/** Result of reconstructing a bullet from server state (mirrors network-main.ts onStateChange bullet handling) */
export interface MPBulletState {
  /** World-space position where bullet originated */
  worldPos: THREE.Vector3;
  /** World-space normalised direction vector */
  worldDir: THREE.Vector3;
  /** UV-space direction components from server */
  dirX: number;
  dirY: number;
  /** Surface UV where bullet was spawned */
  u: number;
  v: number;
}

/** Hit detection result (mirrors server checkCollisions) */
export interface MPHitResult {
  hit: boolean;
  worldDist: number;
}

// ---------------------------------------------------------------------------
// Inlined server-side distance functions (from server/rooms/GameRoom.ts).
// Cannot import GameRoom.ts directly — it depends on Colyseus.
// These are pure math; keep in sync with server equivalents.
// ---------------------------------------------------------------------------

const _PEANUT_WAIST_DEPTH = 0.3;

function _sphereGreatCircleDist(
  u1: number, v1: number, u2: number, v2: number, R: number,
): number {
  const phi1 = v1 * Math.PI, phi2 = v2 * Math.PI;
  const theta1 = u1 * 2 * Math.PI, theta2 = u2 * 2 * Math.PI;
  const dot =
    Math.sin(phi1) * Math.cos(theta1) * Math.sin(phi2) * Math.cos(theta2)
    + Math.sin(phi1) * Math.sin(theta1) * Math.sin(phi2) * Math.sin(theta2)
    + Math.cos(phi1) * Math.cos(phi2);
  return R * Math.acos(Math.max(-1, Math.min(1, dot)));
}

function _torusChordDist(u1: number, v1: number, u2: number, v2: number, scale: number): number {
  const R = 3.0 * scale * DEFAULT_SURFACE_SCALE / 10;
  const r = 1.0 * scale * DEFAULT_SURFACE_SCALE / 10;
  const toX = (u: number, v: number) => {
    const tu = u * 2 * Math.PI, tv = v * 2 * Math.PI;
    return [(R + r * Math.cos(tv)) * Math.cos(tu), (R + r * Math.cos(tv)) * Math.sin(tu), r * Math.sin(tv)] as const;
  };
  const [x1, y1, z1] = toX(u1, v1);
  const [x2, y2, z2] = toX(u2, v2);
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function _pillPoint3D(u: number, v: number, scale: number): [number, number, number] {
  const cylH = 0.5 * scale * DEFAULT_SURFACE_SCALE;
  const capR = scale * DEFAULT_SURFACE_SCALE / 2;
  const capFrac = capR / (cylH + 2 * capR);
  const tu = u * 2 * Math.PI;
  if (v < capFrac) {
    const phi = (v / capFrac) * (Math.PI / 2);
    return [capR * Math.sin(phi) * Math.cos(tu), -cylH - capR * Math.cos(phi), capR * Math.sin(phi) * Math.sin(tu)];
  } else if (v > 1 - capFrac) {
    const phi = ((v - (1 - capFrac)) / capFrac) * (Math.PI / 2);
    return [capR * Math.sin(phi) * Math.cos(tu), cylH + capR * Math.cos(phi), capR * Math.sin(phi) * Math.sin(tu)];
  } else {
    const y = (((v - capFrac) / (1 - 2 * capFrac)) - 0.5) * 2 * cylH;
    return [capR * Math.cos(tu), y, capR * Math.sin(tu)];
  }
}

function _pillChordDist(u1: number, v1: number, u2: number, v2: number, scale: number): number {
  const [x1, y1, z1] = _pillPoint3D(u1, v1, scale);
  const [x2, y2, z2] = _pillPoint3D(u2, v2, scale);
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2);
}

function _peanutPoint3D(u: number, v: number, scale: number): [number, number, number] {
  const phi = v * Math.PI;
  const theta = u * 2 * Math.PI;
  const r = (1 + _PEANUT_WAIST_DEPTH * Math.cos(2 * phi)) * scale * DEFAULT_SURFACE_SCALE;
  return [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

function _peanutChordDist(u1: number, v1: number, u2: number, v2: number, scale: number): number {
  const [x1, y1, z1] = _peanutPoint3D(u1, v1, scale);
  const [x2, y2, z2] = _peanutPoint3D(u2, v2, scale);
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2);
}

function _mobiusPoint3D(u: number, v: number, scale: number): [number, number, number] {
  const theta = u * 2 * Math.PI;
  const w = (v - 0.5) * 2 * scale;
  const R = scale * DEFAULT_SURFACE_SCALE;
  const x = (R + w * Math.cos(theta / 2)) * Math.cos(theta);
  const y = (R + w * Math.cos(theta / 2)) * Math.sin(theta);
  const z = w * Math.sin(theta / 2);
  return [x, y, z];
}

function _mobiusChordDist(u1: number, v1: number, u2: number, v2: number, scale: number): number {
  const [x1, y1, z1] = _mobiusPoint3D(u1, v1, scale);
  const [x2, y2, z2] = _mobiusPoint3D(u2, v2, scale);
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2);
}

/**
 * Inlined server-side surfaceWorldDist — mirrors GameRoom.ts surfaceWorldDist().
 * Returns world-space distance in units between two UV-parameterised surface points.
 * Used for bullet-enemy and player-enemy hit detection in the server's checkCollisions().
 */
export function mpSurfaceWorldDist(
  surfaceType: string,
  u1: number, v1: number,
  u2: number, v2: number,
  scaleFactor: number,
  sphereR: number,
): number {
  if (surfaceType === 'peanut')    return _peanutChordDist(u1, v1, u2, v2, scaleFactor);
  if (surfaceType === 'torus')     return _torusChordDist(u1, v1, u2, v2, scaleFactor);
  if (surfaceType === 'pill')      return _pillChordDist(u1, v1, u2, v2, scaleFactor);
  if (surfaceType === 'mobius')    return _mobiusChordDist(u1, v1, u2, v2, scaleFactor);
  // sphere, capsule, icosahedron, cube, etc. — use great-circle / approximation
  return _sphereGreatCircleDist(u1, v1, u2, v2, sphereR);
}

// ---------------------------------------------------------------------------
// Constants (mirror server values)
// ---------------------------------------------------------------------------

/** Server's enemy-player hit threshold in world units (from GameRoom.ts ENEMY_HIT_WORLD) */
export const ENEMY_HIT_WORLD = 0.5;

/** Server's bullet-enemy hit threshold in world units (from GameRoom.ts BULLET_HIT_WORLD) */
export const BULLET_HIT_WORLD = 0.6;

// ---------------------------------------------------------------------------
// MPRealGameTestHarness
// ---------------------------------------------------------------------------

export class MPRealGameTestHarness {
  readonly surface: Surface;
  readonly meshSurface: MeshSurface;
  readonly surfaceType: SurfaceType;
  readonly mapSizeScaleFactor: number;
  readonly width: number;
  readonly height: number;

  /** Camera (same as real MP game uses for aim angle computation) */
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cameraController: CameraController;

  /** Virtual player walker on surface (mirrors server's ServerMeshWalker) */
  private readonly walker: MeshWalker;

  /** Current simulated server player state */
  private _playerState: MPPlayerState;

  /** Mouse aim (normalised -1..1, same as InputState.aimX/aimY) */
  private _mouseX = 0;
  private _mouseY = 0;

  constructor(options: MPHarnessOptions = {}) {
    const surfaceType = options.surface ?? 'sphere';
    const mapSize = options.mapSize ?? MapSize.MEDIUM;
    this.surfaceType = surfaceType;
    this.mapSizeScaleFactor = getMapSizeScaleFactor(mapSize);
    this.width = options.width ?? 800;
    this.height = options.height ?? 600;

    // -- Surface --
    const surfaceConfig = createStandardSurfaceConfig(surfaceType, 10, null);
    const surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);
    if (this.mapSizeScaleFactor !== 1.0) {
      surface.group.scale.setScalar(this.mapSizeScaleFactor);
    }
    surface.group.updateMatrixWorld(true);
    this.surface = surface;

    // -- Mesh surface (for geodesic movement, same as server's ServerMeshWalker) --
    this.meshSurface = new MeshSurface(surface.walkableMesh);

    // -- Camera (needed for computeCameraRelativeAimAngle) --
    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.cameraController = new CameraController(this.camera);

    // -- Walker (geodesic position on surface) --
    const startSp = surface.getPoint(0.5, 0.5);
    const startWorldPos = startSp.position.clone().multiplyScalar(this.mapSizeScaleFactor);
    const closestPt = this.meshSurface.closestPointOnSurface(startWorldPos);
    const startPoint = closestPt ? closestPt.point : startWorldPos;
    const startFace = closestPt ? closestPt.faceIndex : 0;
    this.walker = new MeshWalker(this.meshSurface, startPoint, 3.0 * this.mapSizeScaleFactor);

    // Snap camera to initial position
    const initialFrame = this.walker.getTangentFrame();
    this.cameraController.snapToFrame(this.walker.position, this.walker.normal, initialFrame);
    this.camera.updateMatrixWorld();

    this._playerState = {
      surfaceU: 0.5,
      surfaceV: 0.5,
      worldPos: this.walker.position.clone(),
      aimAngle: 0,
    };
  }

  // ==========================================================================
  // Player State Management
  // ==========================================================================

  /**
   * Place the player at UV coordinates on the surface.
   * Equivalent to server teleporting player to UV position.
   */
  placePlayerAt(u: number, v: number): void {
    const sp = this.surface.getPoint(u, v);
    const worldPos = sp.position.clone().multiplyScalar(this.mapSizeScaleFactor);

    const closest = this.meshSurface.closestPointOnSurface(worldPos);
    if (closest) {
      this.walker.teleportTo(closest.point, closest.faceIndex, closest.normal);
    } else {
      // Fallback: no BVH result, use surface point directly
      this.walker.teleportTo(worldPos, 0, sp.normal);
    }

    this._playerState = {
      surfaceU: u,
      surfaceV: v,
      worldPos: this.walker.position.clone(),
      aimAngle: this._playerState.aimAngle,
    };

    // Snap camera to new position
    const frame = this.walker.getTangentFrame();
    this.cameraController.snapToFrame(this.walker.position, this.walker.normal, frame);
    this.camera.updateMatrixWorld();
  }

  /** Get current player state (mirrors server NetworkPlayerState) */
  get playerState(): Readonly<MPPlayerState> { return this._playerState; }

  // ==========================================================================
  // Camera Management (needed for realistic aim angle computation)
  // ==========================================================================

  /**
   * Advance camera N frames at dt (default 1/60s).
   * The camera controller lerps toward the player position each frame.
   * After settling (60+ frames), `computeAimAngle()` gives stable results.
   */
  tickCamera(frames = 1, dt = 1 / 60): void {
    for (let i = 0; i < frames; i++) {
      const frame = this.walker.getTangentFrame();
      this.cameraController.updateFromFrame(
        this.walker.position,
        this.walker.normal,
        frame,
        dt,
      );
      this.camera.updateMatrixWorld();
    }
  }

  // ==========================================================================
  // Aim Angle Computation (MP code path — network-main.ts onFixedUpdate)
  // ==========================================================================

  /**
   * Set the virtual mouse position (normalised -1..1 from screen center).
   * aimX: positive = right. aimY: positive = down (screen Y increases downward).
   */
  setMouse(aimX: number, aimY: number): void {
    this._mouseX = aimX;
    this._mouseY = aimY;
  }

  /**
   * Compute the MP aim angle for the current player position and mouse input.
   *
   * Mirrors network-main.ts onFixedUpdate (lines 5295–5332):
   * 1. Uses computeCameraRelativeAimAngle (not the naive atan2(-mouseY, mouseX))
   * 2. For torus/pill: uses surface.worldToSurface(playerMesh.position) for UV
   *    (sphere-approx surfaceU/V has swapped/wrong axes on these surfaces)
   * 3. Server uses the aimAngle to compute bullet.dirX = cos(aimAngle), dirY = sin(aimAngle)
   */
  computeAimAngle(): number {
    const u = this._playerState.surfaceU;
    const v = this._playerState.surfaceV;

    // MP torus/pill fix: use worldToSurface for accurate UV (mirrors network-main.ts line 5319)
    const uvForTangent =
      (this.surfaceType === 'torus' || this.surfaceType === 'pill')
        ? this.surface.worldToSurface(this._playerState.worldPos)
        : { u, v };

    const sp = this.surface.getPoint(uvForTangent.u, uvForTangent.v);

    // Camera axes (same as network-main.ts lines 5300–5301)
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);

    // Use server normal when available (stable), else UV normal
    const normal = this.walker.normal.clone();

    return computeCameraRelativeAimAngle(
      this._mouseX, this._mouseY,
      camRight, camUp,
      normal, sp.tangentU, sp.tangentV,
    );
  }

  // ==========================================================================
  // Bullet Direction Reconstruction (MP code path — network-main.ts onStateChange)
  // ==========================================================================

  /**
   * Given a "server bullet" (u, v in UV space, dirX/dirY UV-space components),
   * reconstruct the world-space position and direction — mirrors network-main.ts
   * onStateChange bullet processing (lines 3700–3854).
   *
   * Server bullet spawning (GameRoom.ts spawnBullet):
   *   bullet.dirX = cos(aimAngle)   ← UV-space tangentU component
   *   bullet.dirY = sin(aimAngle)   ← UV-space tangentV component
   *
   * Client reconstruction:
   *   worldDir = tangentU * dirX + tangentV * dirY
   *
   * @param u, v     - UV spawn coordinates
   * @param dirX     - UV-space tangentU component (cos(aimAngle))
   * @param dirY     - UV-space tangentV component (sin(aimAngle))
   * @param ownerPos - Owner world pos (from server wx/wy/wz). Defaults to player world pos.
   */
  reconstructBullet(
    u: number, v: number,
    dirX: number, dirY: number,
    ownerPos?: THREE.Vector3,
  ): MPBulletState {
    const worldPos = ownerPos ?? this._playerState.worldPos.clone();

    // For torus/pill, worldToSurface gives more accurate UV for tangent computation
    // (mirrors network-main.ts line 3818)
    const uvForTangent =
      (this.surfaceType === 'torus' || this.surfaceType === 'pill')
        ? this.surface.worldToSurface(worldPos)
        : { u, v };

    const sp = this.surface.getPoint(uvForTangent.u, uvForTangent.v);

    // World-space direction: tangentU * dirX + tangentV * dirY
    // (mirrors network-main.ts onStateChange bullet rendering, line ~3870+)
    const worldDir = sp.tangentU.clone()
      .multiplyScalar(dirX)
      .addScaledVector(sp.tangentV, dirY);

    if (worldDir.lengthSq() > 0.0001) {
      worldDir.normalize();
    }

    return { worldPos: worldPos.clone(), worldDir, dirX, dirY, u, v };
  }

  /**
   * Compute server bullet components from an aim angle.
   * Mirrors GameRoom.ts spawnBullet:
   *   dirX = cos(aimAngle)
   *   dirY = sin(aimAngle)
   * (with torus negation for torus surfaces — mirrors GameRoom.ts line 2111)
   */
  aimAngleToBulletComponents(aimAngle: number): { dirX: number; dirY: number } {
    let dirX = Math.cos(aimAngle);
    const dirY = Math.sin(aimAngle);
    // Torus negation (mirrors GameRoom.ts spawnBullet line 2111)
    if (this.surfaceType === 'torus') {
      dirX = -dirX;
    }
    return { dirX, dirY };
  }

  // ==========================================================================
  // Hit Detection (MP code path — server GameRoom.ts checkCollisions)
  // ==========================================================================

  /**
   * Check if two UV-space positions would register a hit in the server's collision system.
   * Uses `mpSurfaceWorldDist` which mirrors server's `surfaceWorldDist`.
   *
   * @param u1, v1 - First entity (e.g., player)
   * @param u2, v2 - Second entity (e.g., enemy)
   * @param threshold - World-space hit threshold (default: ENEMY_HIT_WORLD = 0.5)
   */
  checkHit(
    u1: number, v1: number,
    u2: number, v2: number,
    threshold = ENEMY_HIT_WORLD,
  ): MPHitResult {
    const sphereR = DEFAULT_SURFACE_SCALE * this.mapSizeScaleFactor;
    const dist = mpSurfaceWorldDist(
      this.surfaceType,
      u1, v1, u2, v2,
      this.mapSizeScaleFactor,
      sphereR,
    );
    return { hit: dist < threshold, worldDist: dist };
  }

  /**
   * Compute world-space distance between two UV positions on this surface.
   * Direct access to the distance computation used by server hit detection.
   */
  worldDist(u1: number, v1: number, u2: number, v2: number): number {
    const sphereR = DEFAULT_SURFACE_SCALE * this.mapSizeScaleFactor;
    return mpSurfaceWorldDist(this.surfaceType, u1, v1, u2, v2, this.mapSizeScaleFactor, sphereR);
  }

  // ==========================================================================
  // Player Movement (server geodesic path via MeshSurface.moveGeodesic)
  // ==========================================================================

  /**
   * Move the player geodesically in world-space direction for a given distance.
   * Mirrors server's ServerMeshWalker step in GameRoom.ts player update.
   *
   * @param worldDir - Normalised world-space movement direction
   * @param distance - Distance in world units to move
   */
  movePlayer(worldDir: THREE.Vector3, distance: number): void {
    if (distance <= 0) return;
    // Use MeshWalker.move(): speed=distance, dt=1.0 → moves exactly `distance` world units.
    const prevSpeed = this.walker.speed;
    this.walker.speed = distance;
    this.walker.move(worldDir.clone().normalize(), 1.0);
    this.walker.speed = prevSpeed;

    // Update player state UV via worldToSurface
    const uv = this.surface.worldToSurface(this.walker.position);
    this._playerState = {
      ...this._playerState,
      surfaceU: uv.u,
      surfaceV: uv.v,
      worldPos: this.walker.position.clone(),
    };
  }

  /**
   * Move the player using UV-space input (mirrors server movement: moveX=tangentU, moveY=tangentV).
   * @param moveX - tangentU component (-1..1)
   * @param moveY - tangentV component (-1..1)
   * @param speedScale - Movement distance per call (world units)
   */
  movePlayerUV(moveX: number, moveY: number, speedScale = 0.5): void {
    const sp = this.surface.getPoint(this._playerState.surfaceU, this._playerState.surfaceV);
    const worldDir = sp.tangentU.clone()
      .multiplyScalar(moveX)
      .addScaledVector(sp.tangentV, moveY);
    const dist = worldDir.length() * speedScale;
    if (dist > 0.0001) {
      this.movePlayer(worldDir.normalize(), dist);
    }
  }

  // ==========================================================================
  // Convenience helpers
  // ==========================================================================

  /**
   * Fire a full "shot" from the current player position and mouse aim.
   * Computes aim angle → server bullet components → reconstructed world bullet.
   * This exercises the full MP shot pipeline in one call.
   */
  shoot(): MPBulletState {
    const aimAngle = this.computeAimAngle();
    const { dirX, dirY } = this.aimAngleToBulletComponents(aimAngle);
    return this.reconstructBullet(
      this._playerState.surfaceU,
      this._playerState.surfaceV,
      dirX, dirY,
      this._playerState.worldPos,
    );
  }

  /**
   * Get the surface tangent frame at the current player position.
   * Useful for asserting bullet direction alignment with screen space.
   */
  getSurfaceTangentFrame(): { tangentU: THREE.Vector3; tangentV: THREE.Vector3; normal: THREE.Vector3 } {
    const sp = this.surface.getPoint(this._playerState.surfaceU, this._playerState.surfaceV);
    return { tangentU: sp.tangentU.clone(), tangentV: sp.tangentV.clone(), normal: sp.normal.clone() };
  }

  /** Get camera's world-space right and up vectors (same as network-main.ts onFixedUpdate) */
  getCameraAxes(): { right: THREE.Vector3; up: THREE.Vector3 } {
    return {
      right: new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0),
      up: new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1),
    };
  }
}
