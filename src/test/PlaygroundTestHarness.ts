/**
 * PlaygroundTestHarness — Programmatic Verification Framework
 *
 * Headless wrapper around PlaygroundGame for automated gameplay verification.
 * Tests gameplay logic, movement, aiming, camera behavior, and screen-space
 * coordinate projection without a real browser or WebGL context.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FRAMEWORK OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is a FRAMEWORK for creating verification scenarios. It provides:
 *
 * 1. INPUT SIMULATION
 *    - pressKey('w'), setMousePosition(x, y), setMouseDown(true)
 *    - Programmatic control of all player inputs
 *
 * 2. FRAME ADVANCEMENT
 *    - tick(N) — advance N frames at 60fps
 *    - tickSeconds(T) — advance T seconds of game time
 *    - tickUntil(predicate, maxFrames) — advance until condition met
 *
 * 3. WORLD COORDINATE QUERIES
 *    - getPlayerWorldPos(), getPlayerSurfaceUV()
 *    - getEnemyWorldPositions(), getBulletWorldPositions()
 *    - getCameraState()
 *
 * 4. SCREEN COORDINATE QUERIES
 *    - getPlayerScreenPos() — player position in pixels
 *    - getEnemyScreenPositions() — enemy positions in pixels + world
 *    - getBulletScreenPositions(), getAimScreenDirection()
 *    - projectToScreen() — project any world pos to pixels
 *
 * 5. TRACE RECORDING
 *    - recordTrace(frames, sampleEvery) — full frame-by-frame state recording
 *    - Records: UV, world pos, screen pos, camera quaternion, stuck detection
 *    - Useful for visualizing movement paths and finding stuck points
 *
 * 6. LONG SIMULATION SUPPORT
 *    - walkUntilUV(predicate, maxFrames) — walk until UV condition met
 *    - walkTowardUV(targetU, targetV, maxFrames) — navigate toward UV target
 *    - walkUntilStuck(direction, maxFrames) — detect traversal walls
 *    - findSeamCrossing(direction, maxFrames) — locate UV wrapping points
 *
 * 7. STANDARD VERIFICATION
 *    - runStandardChecks() — run all standard checks, return structured report
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * QUICK START
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   // In your test file (after vi.mock setup — see verification-mocks.ts):
 *   import { PlaygroundTestHarness } from './PlaygroundTestHarness';
 *
 *   const h = new PlaygroundTestHarness('sphere');
 *   h.tick(10); // settle
 *
 *   // Test movement
 *   h.pressKey('w');
 *   h.tick(60);
 *   expect(h.getPlayerWorldPos().distanceTo(startPos)).toBeGreaterThan(0.1);
 *
 *   // Test aim
 *   h.setMousePosition(700, 300); // right of center
 *   h.tick(5);
 *   expect(h.getAimScreenDirection().x).toBeGreaterThan(0);
 *
 *   // Long simulation: walk 10 seconds forward
 *   h.pressKey('w');
 *   const trace = h.recordTrace(600, 10); // 600 frames, sample every 10
 *   // trace has 60 samples with UV, world pos, screen pos, camera state
 *
 *   // Find if mobius seam is crossable
 *   const result = h.findSeamCrossing('forward', 3000);
 *   // result.crossed: boolean, result.trace: frame-by-frame UV data
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MOCK SETUP REQUIRED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Before importing this module, set up mocks. Two options:
 *
 * OPTION A: Copy the vi.mock block from verification-mocks.ts (template)
 * OPTION B: Import verification-env.ts for DOM shims, add vi.mock yourself
 *
 * See playground-verification.test.ts for a complete working example.
 */

import * as THREE from 'three';
import { PlaygroundGame } from '../core/PlaygroundGame';
import { EffectDictionary } from '../core/EffectDictionary';
import type { SurfaceType } from '../surfaces/SurfaceFactory';
import { WeaponType } from '../weapons/WeaponTypes';
import { setGameSeed, clearGameSeed } from '../core/SeededRandom';
import type { EnemyType } from '../entities/enemies/EnemySpawner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenPos {
  x: number;
  y: number;
  visible: boolean;
}

export interface ScreenPosWithWorld extends ScreenPos {
  worldPos: THREE.Vector3;
}

/** A single frame snapshot for trace recording. */
export interface TraceFrame {
  frame: number;
  u: number;
  v: number;
  worldPos: THREE.Vector3;
  screenPos: ScreenPos;
  cameraUp: THREE.Vector3;
  cameraQuat: THREE.Quaternion;
  /** Distance moved from previous sample. 0 = stuck. */
  distFromPrev: number;
  /** Whether position has NaN. */
  hasNaN: boolean;
}

/** Result of a long simulation with trace recording. */
export interface TraceResult {
  frames: TraceFrame[];
  totalDistance: number;
  stuckFrames: number;
  nanFrames: number;
  uvRange: { minU: number; maxU: number; minV: number; maxV: number };
  /** UV values that crossed 0↔1 boundary (seam crossings). */
  seamCrossings: number;
}

/** Result from walkUntilStuck(). */
export interface StuckResult {
  stuckAtFrame: number | null;
  stuckAtUV: { u: number; v: number } | null;
  stuckAtWorldPos: THREE.Vector3 | null;
  totalFrames: number;
  trace: TraceFrame[];
}

/** Result from findSeamCrossing(). */
export interface SeamCrossingResult {
  crossed: boolean;
  crossedAtFrame: number | null;
  crossedFromUV: { u: number; v: number } | null;
  crossedToUV: { u: number; v: number } | null;
  trace: TraceFrame[];
}

/** Standard verification report. */
export interface VerificationReport {
  surface: string;
  movement: { forward: boolean; backward: boolean; left: boolean; right: boolean };
  camera: { stable: boolean; maxRotationDelta: number; avgRotationDelta: number };
  screen: { playerVisible: boolean; playerCentered: boolean };
  traversal: { totalDistance: number; reachedQuadrants: number };
  weapon: { fireHandlerConnected: boolean; currentWeapon: string };
  overall: 'PASS' | 'FAIL';
  failures: string[];
}

// ---------------------------------------------------------------------------
// Deterministic Testing Types
// ---------------------------------------------------------------------------

/** Entity state snapshot for timeline tracking. */
export interface EntityState {
  type: string;
  position: THREE.Vector3;
  alive: boolean;
  health: number;
  faceIndex?: number;
}

/** Single frame in an entity timeline. */
export interface EntityTimelineFrame {
  frame: number;
  player: { position: THREE.Vector3; aimDirection: THREE.Vector3 };
  enemies: Array<{ id: number; type: string; position: THREE.Vector3; alive: boolean }>;
  bullets: THREE.Vector3[];
}

/** Full entity timeline recording. */
export interface EntityTimeline {
  frames: EntityTimelineFrame[];
  seed: number;
  surface: string;
}

/** Scenario configuration for deterministic testing. */
export interface ScenarioConfig {
  playerPosition?: { u: number; v: number };
  enemies?: Array<{
    type: EnemyType;
    u: number;
    v: number;
    count?: number;
  }>;
  seed?: number;
}

/** Recorded input for a single frame. */
export interface ReplayInput {
  frame: number;
  keys: string[];
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
}

/** Complete replay data. */
export interface ReplayData {
  seed: number;
  surface: string;
  inputs: ReplayInput[];
  totalFrames: number;
}

/** Options for PlaygroundTestHarness constructor. */
export interface HarnessOptions {
  surface?: SurfaceType;
  weapon?: WeaponType | null;
  width?: number;
  height?: number;
  seed?: number;
  enemyCount?: number;
}

// ---------------------------------------------------------------------------
// Screen coordinate projection
// ---------------------------------------------------------------------------

/**
 * Projects a world-space position to screen pixel coordinates.
 * Returns { x, y } in pixels from top-left and a `visible` flag.
 */
export function projectToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ScreenPos {
  const v = worldPos.clone().project(camera);
  return {
    x: (v.x + 1) / 2 * width,
    y: (1 - v.y) / 2 * height,
    visible: v.z >= 0 && v.z <= 1,
  };
}

// ---------------------------------------------------------------------------
// PlaygroundTestHarness
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export class PlaygroundTestHarness {
  readonly pg: PlaygroundGame;
  readonly width: number;
  readonly height: number;
  readonly seed: number | null;

  private readonly heldKeys: Set<string> = new Set();
  private mouseX = DEFAULT_WIDTH / 2;
  private mouseY = DEFAULT_HEIGHT / 2;
  private mouseDown = false;
  private _totalFrames = 0;

  // Recording state
  private isRecording = false;
  private recordedInputs: ReplayInput[] = [];
  private recordingStartFrame = 0;

  constructor(
    surface?: SurfaceType,
    weapon?: WeaponType | null,
    width?: number,
    height?: number,
  );

  constructor(options: HarnessOptions);

  constructor(
    surfaceOrOptions: SurfaceType | HarnessOptions = 'sphere',
    weapon?: WeaponType | null,
    width?: number,
    height?: number,
  ) {
    // Parse constructor arguments (support both old and new signatures)
    let surface: SurfaceType;
    let enemyCount: number;
    let seed: number | null = null;

    if (typeof surfaceOrOptions === 'object' && surfaceOrOptions !== null) {
      const opts = surfaceOrOptions;
      surface = opts.surface ?? 'sphere';
      weapon = weapon ?? opts.weapon ?? null;
      width = width ?? opts.width ?? DEFAULT_WIDTH;
      height = height ?? opts.height ?? DEFAULT_HEIGHT;
      seed = opts.seed ?? null;
      enemyCount = opts.enemyCount ?? 0;
    } else {
      surface = (surfaceOrOptions as SurfaceType) ?? 'sphere';
      weapon = weapon ?? null;
      width = width ?? DEFAULT_WIDTH;
      height = height ?? DEFAULT_HEIGHT;
      enemyCount = 0;
    }

    this.width = width;
    this.height = height;
    this.seed = seed;

    // Set seed BEFORE creating PlaygroundGame (so enemy spawns are deterministic)
    if (seed !== null) {
      setGameSeed(seed);
    }

    const container = this.createMockContainer(width, height);

    this.pg = new PlaygroundGame({
      container,
      width,
      height,
      surface,
      weapon,
      enemyCount,
      lives: 99,
    });

    this.patchInputManager();
    this.updateCamera();
  }

  /** Total frames ticked since construction. */
  get totalFrames(): number { return this._totalFrames; }

  /** Access to player (for convenience). */
  get player() { return this.pg.player; }

  // =======================================================================
  // Frame Advancement
  // =======================================================================

  /** Advance N frames at fixed dt (default 1/60s). */
  tick(frames: number = 1, dt: number = 1 / 60): void {
    for (let i = 0; i < frames; i++) {
      // Record input if recording is active
      if (this.isRecording) {
        this.recordedInputs.push({
          frame: this._totalFrames - this.recordingStartFrame,
          keys: Array.from(this.heldKeys),
          mouseX: this.mouseX,
          mouseY: this.mouseY,
          mouseDown: this.mouseDown,
        });
      }

      (this.pg.game.clock as any).totalTime += dt;
      (this.pg as any).fixedUpdate(dt);
      (this.pg as any).renderUpdate();
      this._totalFrames++;
    }
  }

  /** Advance T seconds of game time (at 60fps). */
  tickSeconds(seconds: number): void {
    this.tick(Math.round(seconds * 60));
  }

  /**
   * Advance until a predicate returns true, or maxFrames reached.
   * Returns the frame number where the predicate was satisfied (or -1).
   */
  tickUntil(predicate: () => boolean, maxFrames: number = 1000): number {
    for (let i = 0; i < maxFrames; i++) {
      this.tick(1);
      if (predicate()) return i;
    }
    return -1;
  }

  // =======================================================================
  // Input Simulation
  // =======================================================================

  pressKey(key: string): void { this.heldKeys.add(key.toLowerCase()); }
  releaseKey(key: string): void { this.heldKeys.delete(key.toLowerCase()); }
  releaseAllKeys(): void { this.heldKeys.clear(); }

  setMousePosition(screenX: number, screenY: number): void {
    this.mouseX = screenX;
    this.mouseY = screenY;
  }

  setMouseDown(down: boolean): void { this.mouseDown = down; }

  // =======================================================================
  // World Coordinate Queries
  // =======================================================================

  getPlayerWorldPos(): THREE.Vector3 {
    return this.pg.player.mesh.position.clone();
  }

  getPlayerSurfaceUV(): { u: number; v: number } {
    return { u: this.pg.player.surfaceU, v: this.pg.player.surfaceV };
  }

  getEnemyWorldPositions(): THREE.Vector3[] {
    return this.pg.enemySpawner.getEnemies()
      .filter(e => e.alive && e.active)
      .map(e => e.position.clone());
  }

  getBulletWorldPositions(): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    this.pg.bulletPool.forEachActive((_idx, pos) => {
      positions.push(pos.clone());
    });
    return positions;
  }

  getCameraState(): { position: THREE.Vector3; up: THREE.Vector3; quaternion: THREE.Quaternion } {
    const cam = this.pg.game.camera;
    return {
      position: cam.position.clone(),
      up: cam.up.clone(),
      quaternion: cam.quaternion.clone(),
    };
  }

  // =======================================================================
  // Screen Coordinate Queries
  // =======================================================================

  getPlayerScreenPos(): ScreenPos {
    return projectToScreen(this.pg.player.mesh.position, this.pg.game.camera, this.width, this.height);
  }

  getEnemyScreenPositions(): ScreenPosWithWorld[] {
    return this.pg.enemySpawner.getEnemies()
      .filter(e => e.alive && e.active && e.mesh)
      .map(e => {
        const worldPos = e.position.clone();
        const screen = projectToScreen(worldPos, this.pg.game.camera, this.width, this.height);
        return { ...screen, worldPos };
      });
  }

  getBulletScreenPositions(): ScreenPos[] {
    const positions: ScreenPos[] = [];
    this.pg.bulletPool.forEachActive((_idx, pos) => {
      positions.push(projectToScreen(pos, this.pg.game.camera, this.width, this.height));
    });
    return positions;
  }

  /** Player aim direction in normalized screen space. */
  getAimScreenDirection(): { x: number; y: number } {
    const cam = this.pg.game.camera;
    const playerWorldPos = this.pg.player.mesh.position.clone();
    const aimDir = this.pg.player.getAimDirection();

    const playerScreen = projectToScreen(playerWorldPos, cam, this.width, this.height);
    const aimTarget = playerWorldPos.clone().add(aimDir.multiplyScalar(5));
    const aimScreen = projectToScreen(aimTarget, cam, this.width, this.height);

    const dx = aimScreen.x - playerScreen.x;
    const dy = aimScreen.y - playerScreen.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  /** Bullet travel direction in screen space (from player to bullet). */
  getBulletScreenDirection(): { x: number; y: number } | null {
    const positions: THREE.Vector3[] = [];
    this.pg.bulletPool.forEachActive((_idx, pos) => {
      positions.push(pos.clone());
    });
    if (positions.length === 0) return null;

    const lastBullet = positions[positions.length - 1];
    const screenBullet = projectToScreen(lastBullet, this.pg.game.camera, this.width, this.height);
    const playerScreen = this.getPlayerScreenPos();
    const dx = screenBullet.x - playerScreen.x;
    const dy = screenBullet.y - playerScreen.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return null;
    return { x: dx / len, y: dy / len };
  }

  // =======================================================================
  // Trace Recording — Frame-by-frame state capture
  // =======================================================================

  /**
   * Record a trace of player state over N frames.
   *
   * Use for long simulations (hundreds/thousands of frames) to capture
   * movement paths, find stuck points, detect seam crossings, etc.
   *
   * @param frames Total frames to simulate
   * @param sampleEvery Record a sample every N frames (1 = every frame)
   * @returns TraceResult with all samples + summary statistics
   *
   * Example:
   *   h.pressKey('w');
   *   const trace = h.recordTrace(3000, 5); // 10 seconds at 60fps, sample every 5
   *   // trace.stuckFrames — how many samples had zero movement
   *   // trace.seamCrossings — how many UV wraps detected
   *   // trace.frames[i].u, .v — UV path
   */
  recordTrace(frames: number, sampleEvery: number = 1): TraceResult {
    const samples: TraceFrame[] = [];
    let totalDistance = 0;
    let stuckFrames = 0;
    let nanFrames = 0;
    let seamCrossings = 0;
    let prevPos = this.getPlayerWorldPos();
    let prevUV = this.getPlayerSurfaceUV();

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

    for (let i = 0; i < frames; i++) {
      this.tick(1);

      if (i % sampleEvery === 0) {
        const worldPos = this.getPlayerWorldPos();
        const uv = this.getPlayerSurfaceUV();
        const screenPos = this.getPlayerScreenPos();
        const camState = this.getCameraState();

        const dist = prevPos.distanceTo(worldPos);
        totalDistance += dist;
        const hasNaN = isNaN(worldPos.x) || isNaN(worldPos.y) || isNaN(worldPos.z)
          || isNaN(uv.u) || isNaN(uv.v);

        if (dist < 0.0001) stuckFrames++;
        if (hasNaN) nanFrames++;

        // Detect seam crossing (UV jumps > 0.5 in a single sample)
        const uDelta = Math.abs(uv.u - prevUV.u);
        const vDelta = Math.abs(uv.v - prevUV.v);
        if (uDelta > 0.4 || vDelta > 0.4) seamCrossings++;

        minU = Math.min(minU, uv.u);
        maxU = Math.max(maxU, uv.u);
        minV = Math.min(minV, uv.v);
        maxV = Math.max(maxV, uv.v);

        samples.push({
          frame: this._totalFrames,
          u: uv.u,
          v: uv.v,
          worldPos,
          screenPos,
          cameraUp: camState.up,
          cameraQuat: camState.quaternion,
          distFromPrev: dist,
          hasNaN,
        });

        prevPos = worldPos;
        prevUV = uv;
      } else {
        // Still update prevPos for distance tracking even when not sampling
        const wp = this.getPlayerWorldPos();
        totalDistance += prevPos.distanceTo(wp);
        prevPos = wp;
        prevUV = this.getPlayerSurfaceUV();
      }
    }

    return {
      frames: samples,
      totalDistance,
      stuckFrames,
      nanFrames,
      uvRange: { minU, maxU, minV, maxV },
      seamCrossings,
    };
  }

  // =======================================================================
  // Long Simulation Helpers
  // =======================================================================

  /**
   * Walk in a direction until the player gets stuck (no movement for N consecutive frames).
   * Returns where the player got stuck and the trace leading up to it.
   *
   * @param direction Key to hold ('w', 'a', 's', 'd')
   * @param maxFrames Maximum frames to simulate
   * @param stuckThreshold Consecutive stuck samples to declare stuck (default 30)
   */
  walkUntilStuck(
    direction: string,
    maxFrames: number = 3000,
    stuckThreshold: number = 30,
  ): StuckResult {
    const trace: TraceFrame[] = [];
    let consecutiveStuck = 0;
    let prevPos = this.getPlayerWorldPos();

    this.pressKey(direction);

    for (let i = 0; i < maxFrames; i++) {
      this.tick(1);
      const worldPos = this.getPlayerWorldPos();
      const uv = this.getPlayerSurfaceUV();
      const dist = prevPos.distanceTo(worldPos);

      if (i % 5 === 0) {
        trace.push({
          frame: this._totalFrames,
          u: uv.u, v: uv.v,
          worldPos,
          screenPos: this.getPlayerScreenPos(),
          cameraUp: this.getCameraState().up,
          cameraQuat: this.getCameraState().quaternion,
          distFromPrev: dist,
          hasNaN: isNaN(worldPos.x) || isNaN(uv.u),
        });
      }

      if (dist < 0.0001) {
        consecutiveStuck++;
        if (consecutiveStuck >= stuckThreshold) {
          this.releaseKey(direction);
          return {
            stuckAtFrame: i,
            stuckAtUV: uv,
            stuckAtWorldPos: worldPos,
            totalFrames: i,
            trace,
          };
        }
      } else {
        consecutiveStuck = 0;
      }
      prevPos = worldPos;
    }

    this.releaseKey(direction);
    return {
      stuckAtFrame: null,
      stuckAtUV: null,
      stuckAtWorldPos: null,
      totalFrames: maxFrames,
      trace,
    };
  }

  /**
   * Walk forward until the UV crosses a 0↔1 boundary (seam crossing).
   *
   * @param direction Key to hold ('w', 'a', 's', 'd')
   * @param maxFrames Maximum frames (default 3000 = ~50 seconds)
   * @param uvAxis Which UV axis to monitor ('u' or 'v')
   */
  findSeamCrossing(
    direction: string = 'w',
    maxFrames: number = 3000,
    uvAxis: 'u' | 'v' = 'u',
  ): SeamCrossingResult {
    const trace: TraceFrame[] = [];
    let prevUV = this.getPlayerSurfaceUV();
    let prevPos = this.getPlayerWorldPos();

    this.pressKey(direction);

    for (let i = 0; i < maxFrames; i++) {
      this.tick(1);
      const uv = this.getPlayerSurfaceUV();
      const worldPos = this.getPlayerWorldPos();
      const dist = prevPos.distanceTo(worldPos);

      if (i % 3 === 0) {
        trace.push({
          frame: this._totalFrames,
          u: uv.u, v: uv.v,
          worldPos,
          screenPos: this.getPlayerScreenPos(),
          cameraUp: this.getCameraState().up,
          cameraQuat: this.getCameraState().quaternion,
          distFromPrev: dist,
          hasNaN: isNaN(worldPos.x) || isNaN(uv.u),
        });
      }

      // Detect seam crossing: large UV jump
      const delta = Math.abs(uv[uvAxis] - prevUV[uvAxis]);
      if (delta > 0.4 && i > 10) {
        this.releaseKey(direction);
        return {
          crossed: true,
          crossedAtFrame: i,
          crossedFromUV: prevUV,
          crossedToUV: uv,
          trace,
        };
      }

      prevUV = uv;
      prevPos = worldPos;
    }

    this.releaseKey(direction);
    return {
      crossed: false,
      crossedAtFrame: null,
      crossedFromUV: null,
      crossedToUV: null,
      trace,
    };
  }

  /**
   * Walk in a direction until a UV predicate is satisfied.
   *
   * Example: walk until u > 0.9:
   *   h.walkUntilUV(uv => uv.u > 0.9, 'w', 5000);
   */
  walkUntilUV(
    predicate: (uv: { u: number; v: number }) => boolean,
    direction: string = 'w',
    maxFrames: number = 3000,
  ): { reached: boolean; framesUsed: number; finalUV: { u: number; v: number } } {
    this.pressKey(direction);
    for (let i = 0; i < maxFrames; i++) {
      this.tick(1);
      const uv = this.getPlayerSurfaceUV();
      if (predicate(uv)) {
        this.releaseKey(direction);
        return { reached: true, framesUsed: i, finalUV: uv };
      }
    }
    this.releaseKey(direction);
    return { reached: false, framesUsed: maxFrames, finalUV: this.getPlayerSurfaceUV() };
  }

  // =======================================================================
  // Camera Stability
  // =======================================================================

  /** Measure camera rotation stability over N frames. */
  getCameraStability(frames: number): { maxRotationDelta: number; avgRotationDelta: number } {
    let maxDelta = 0;
    let totalDelta = 0;
    let prevQuat = this.pg.game.camera.quaternion.clone();

    for (let i = 0; i < frames; i++) {
      this.tick(1);
      const currentQuat = this.pg.game.camera.quaternion.clone();
      const delta = prevQuat.angleTo(currentQuat);
      maxDelta = Math.max(maxDelta, delta);
      totalDelta += delta;
      prevQuat = currentQuat;
    }

    return {
      maxRotationDelta: maxDelta,
      avgRotationDelta: totalDelta / frames,
    };
  }

  // =======================================================================
  // Simple Traversal Checks
  // =======================================================================

  /** Quick check: can player move in a direction? (10 frames) */
  canTraverse(direction: 'forward' | 'backward' | 'left' | 'right'): boolean {
    const keyMap: Record<string, string> = { forward: 'w', backward: 's', left: 'a', right: 'd' };
    const startPos = this.getPlayerWorldPos();
    this.pressKey(keyMap[direction]);
    this.tick(10);
    this.releaseKey(keyMap[direction]);
    return startPos.distanceTo(this.getPlayerWorldPos()) > 0.01;
  }

  /** Full traversal test: walk in all 4 directions, track distance and UV coverage. */
  testFullTraversal(framesPerDirection: number = 120): {
    totalDistanceMoved: number;
    visitedUVs: Array<{ u: number; v: number }>;
    reachedAllQuadrants: boolean;
  } {
    const visitedUVs: Array<{ u: number; v: number }> = [];
    let totalDistance = 0;
    const quadrants = new Set<string>();

    const recordUV = () => {
      const uv = this.getPlayerSurfaceUV();
      visitedUVs.push({ ...uv });
      quadrants.add((uv.u < 0.5 ? 'L' : 'R') + (uv.v < 0.5 ? 'T' : 'B'));
    };

    for (const key of ['w', 'd', 's', 'a']) {
      const startPos = this.getPlayerWorldPos();
      this.pressKey(key);
      for (let i = 0; i < framesPerDirection; i++) {
        this.tick(1);
        if (i % 10 === 0) recordUV();
      }
      this.releaseKey(key);
      totalDistance += startPos.distanceTo(this.getPlayerWorldPos());
    }

    return { totalDistanceMoved: totalDistance, visitedUVs, reachedAllQuadrants: quadrants.size >= 3 };
  }

  // =======================================================================
  // Spawn Helpers
  // =======================================================================

  /** Spawn enemies at evenly-distributed UV coordinates. */
  spawnEnemies(count: number, type: string = 'wanderer'): void {
    for (let i = 0; i < count; i++) {
      const u = 0.2 + (i / count) * 0.6;
      const v = 0.2 + (i / count) * 0.6;
      this.pg.enemySpawner.spawn(type as any, u, v);
    }
  }

  /** Wait for all enemies to finish materializing. */
  waitForMaterialization(maxFrames: number = 120): void {
    for (let i = 0; i < maxFrames; i++) {
      this.tick(1);
      const enemies = this.pg.enemySpawner.getEnemies();
      if (enemies.length > 0 && enemies.every(e => !e.isMaterializing)) return;
    }
  }

  // =======================================================================
  // Standard Verification Report
  // =======================================================================

  /**
   * Run all standard verification checks and return a structured report.
   *
   * This is the "one call" that verifies a surface works correctly:
   * - Movement in all 4 directions
   * - Camera stability during movement
   * - Player visible and centered on screen
   * - Surface traversal
   * - Weapon system connected
   *
   * Returns a VerificationReport with per-check pass/fail and overall verdict.
   */
  runStandardChecks(): VerificationReport {
    const failures: string[] = [];

    // --- Movement ---
    const movement = { forward: false, backward: false, left: false, right: false };
    for (const dir of ['forward', 'backward', 'left', 'right'] as const) {
      const keyMap: Record<string, string> = { forward: 'w', backward: 's', left: 'a', right: 'd' };
      const startPos = this.getPlayerWorldPos();
      this.pressKey(keyMap[dir]);
      this.tick(30);
      this.releaseKey(keyMap[dir]);
      const dist = startPos.distanceTo(this.getPlayerWorldPos());
      movement[dir] = dist > 0.01;
      if (!movement[dir]) failures.push(`movement.${dir}: only moved ${dist.toFixed(4)} units`);
    }

    // --- Camera ---
    this.pressKey('w');
    const camera = this.getCameraStability(60);
    this.releaseKey('w');
    if (camera.maxRotationDelta > Math.PI) {
      failures.push(`camera: max rotation ${(camera.maxRotationDelta * 180 / Math.PI).toFixed(1)}°/frame (>180°)`);
    }

    // --- Screen position ---
    this.tick(30);
    const screenPos = this.getPlayerScreenPos();
    const playerVisible = screenPos.visible && !isNaN(screenPos.x) && !isNaN(screenPos.y);
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const playerCentered = Math.abs(screenPos.x - centerX) < this.width * 0.35
      && Math.abs(screenPos.y - centerY) < this.height * 0.35;
    if (!playerVisible) failures.push('screen: player not visible');
    if (!playerCentered) failures.push(`screen: player at (${screenPos.x.toFixed(0)}, ${screenPos.y.toFixed(0)}), not centered`);

    // --- Traversal ---
    const traversal = this.testFullTraversal(120);
    if (traversal.totalDistanceMoved < 0.5) {
      failures.push(`traversal: only ${traversal.totalDistanceMoved.toFixed(2)} total distance`);
    }

    // --- Weapon ---
    const fireHandlerConnected = typeof this.pg.player.weaponFireHandler === 'function';
    const currentWeapon = this.pg.weaponManager.getCurrentWeapon();
    if (!fireHandlerConnected) failures.push('weapon: fireHandler not connected');

    const surfaceName = (this.pg as any)._surface?.constructor?.name || 'unknown';

    return {
      surface: surfaceName,
      movement,
      camera: { stable: camera.maxRotationDelta < Math.PI, ...camera },
      screen: { playerVisible, playerCentered },
      traversal: {
        totalDistance: traversal.totalDistanceMoved,
        reachedQuadrants: traversal.visitedUVs.length,
      },
      weapon: { fireHandlerConnected, currentWeapon },
      overall: failures.length === 0 ? 'PASS' : 'FAIL',
      failures,
    };
  }

  // =======================================================================
  // Particle / Effect Queries
  // =======================================================================

  /** Number of active particle effects + shatter fragments. */
  getActiveEffectCount(): number {
    return this.pg.particles.activeEffectCount;
  }

  /** Whether the particle system root is in the scene graph. */
  isParticleSystemInScene(): boolean {
    return this.pg.particles.root.parent === this.pg.game.scene;
  }

  /** Whether frustum culling is disabled on the particle system root. */
  isParticleSystemFrustumCullingDisabled(): boolean {
    return !this.pg.particles.root.frustumCulled;
  }

  // =======================================================================
  // Deterministic Testing — Entity Tracking
  // =======================================================================

  /** Get all enemy positions with their types and health. */
  getEnemyStates(): EntityState[] {
    return this.pg.enemySpawner.getEnemies()
      .map(e => ({
        type: e.baseTypeName || 'unknown',
        position: e.position.clone(),
        alive: e.alive,
        health: e.health,
        faceIndex: (e as any).faceIndex,
      }));
  }

  /**
   * Record all entity positions over N frames.
   * Returns a full timeline that can be compared for determinism verification.
   */
  recordEntityTimeline(frames: number, sampleEvery: number = 1): EntityTimeline {
    const timelineFrames: EntityTimelineFrame[] = [];

    for (let i = 0; i < frames; i++) {
      this.tick(1);

      if (i % sampleEvery === 0) {
        const enemies = this.pg.enemySpawner.getEnemies();
        const bullets: THREE.Vector3[] = [];
        this.pg.bulletPool.forEachActive((_idx, pos) => {
          bullets.push(pos.clone());
        });

        timelineFrames.push({
          frame: this._totalFrames,
          player: {
            position: this.getPlayerWorldPos(),
            aimDirection: this.player.getAimDirection(),
          },
          enemies: enemies
            .filter(e => e.alive && e.active)
            .map((e, id) => ({
              id,
              type: e.baseTypeName || 'unknown',
              position: e.position.clone(),
              alive: e.alive,
            })),
          bullets,
        });
      }
    }

    return {
      frames: timelineFrames,
      seed: this.seed ?? 0,
      surface: (this.pg as any)._surface?.constructor?.name || 'unknown',
    };
  }

  // =======================================================================
  // Deterministic Testing — Scenario Builder
  // =======================================================================

  /**
   * Build a specific test scenario with pre-positioned entities.
   * Use this to create reproducible test cases.
   */
  buildScenario(config: ScenarioConfig): void {
    // Apply seed if provided
    if (config.seed !== undefined) {
      setGameSeed(config.seed);
    }

    // Position player
    if (config.playerPosition) {
      const { u, v } = config.playerPosition;
      this.pg.player.respawn(u, v);
      const point = (this.pg as any)._surface.getPoint(u, v);
      const walker = (this.pg as any)._walker;
      const meshSurface = (this.pg as any)._meshSurface;
      if (meshSurface) {
        // Use teleportTo() to reinit _facePos — direct assignment leaves stale geodesic
        // state that causes snap-back to previous position on first movement.
        const projected = meshSurface.closestPointOnSurface(point.position);
        if (projected) {
          walker.teleportTo(projected.point, projected.faceIndex, projected.normal);
        } else {
          walker.teleportTo(point.position, 0, point.normal);
        }
      } else {
        walker.position.copy(point.position);
        walker.normal.copy(point.normal);
      }
      this.pg.player.mesh.position.copy(walker.position);
    }

    // Spawn enemies
    if (config.enemies) {
      for (const enemyGroup of config.enemies) {
        const count = enemyGroup.count ?? 1;
        for (let i = 0; i < count; i++) {
          this.pg.enemySpawner.spawn(enemyGroup.type, enemyGroup.u, enemyGroup.v);
        }
      }
    }

    // Let enemies materialize
    this.tick(10);
  }

  /**
   * Run a scenario and capture the full entity timeline.
   * Convenient one-shot method for scenario-based testing.
   */
  runScenario(config: ScenarioConfig, frames: number): EntityTimeline {
    this.buildScenario(config);
    return this.recordEntityTimeline(frames);
  }

  // =======================================================================
  // Deterministic Testing — Replay System
  // =======================================================================

  /** Start recording all inputs for replay. */
  startRecording(): void {
    this.isRecording = true;
    this.recordedInputs = [];
    this.recordingStartFrame = this._totalFrames;
  }

  /** Stop recording and return the replay data. */
  stopRecording(): ReplayData {
    this.isRecording = false;
    return {
      seed: this.seed ?? 0,
      surface: (this.pg as any)._surface?.constructor?.name || 'unknown',
      inputs: this.recordedInputs,
      totalFrames: this._totalFrames - this.recordingStartFrame,
    };
  }

  /**
   * Play back a recorded replay.
   * Returns the entity timeline produced by the replay.
   */
  playReplay(replay: ReplayData): EntityTimeline {
    // Reset seed to match original recording
    if (replay.seed !== 0) {
      setGameSeed(replay.seed);
    }

    // Reset state
    this.releaseAllKeys();
    this.pg.player.respawn(0.5, 0.5);
    this.pg.enemySpawner.clear();

    const timelineFrames: EntityTimelineFrame[] = [];
    let inputIndex = 0;

    for (let frame = 0; frame < replay.totalFrames; frame++) {
      // Apply recorded input if available for this frame
      if (inputIndex < replay.inputs.length && replay.inputs[inputIndex].frame <= frame) {
        const input = replay.inputs[inputIndex];

        // Clear keys
        this.releaseAllKeys();

        // Apply keys
        for (const key of input.keys) {
          this.pressKey(key);
        }

        // Apply mouse
        this.setMousePosition(input.mouseX, input.mouseY);
        this.setMouseDown(input.mouseDown);

        inputIndex++;
      }

      // Tick
      this.tick(1);

      // Record timeline
      const enemies = this.pg.enemySpawner.getEnemies();
      const bullets: THREE.Vector3[] = [];
      this.pg.bulletPool.forEachActive((_idx, pos) => {
        bullets.push(pos.clone());
      });

      timelineFrames.push({
        frame: this._totalFrames,
        player: {
          position: this.getPlayerWorldPos(),
          aimDirection: this.player.getAimDirection(),
        },
        enemies: enemies
          .filter(e => e.alive && e.active)
          .map((e, id) => ({
            id,
            type: e.baseTypeName || 'unknown',
            position: e.position.clone(),
            alive: e.alive,
          })),
        bullets,
      });
    }

    return {
      frames: timelineFrames,
      seed: replay.seed,
      surface: replay.surface,
    };
  }

  // =======================================================================
  // Cleanup
  // =======================================================================

  dispose(): void {
    this.releaseAllKeys();
    this.pg.dispose();

    // Clear seed if we set one
    if (this.seed !== null) {
      clearGameSeed();
    }

    // Clear EffectDictionary singleton to cancel its 2-second saveTimer.
    // Without this, the pending setTimeout keeps the Node process alive after
    // tests complete, causing vitest to hang indefinitely at 99% CPU.
    EffectDictionary.clear();
  }

  // =======================================================================
  // Private
  // =======================================================================

  private patchInputManager(): void {
    const self = this;

    this.pg.input.getState = () => {
      let mx = 0, my = 0;
      if (self.heldKeys.has('a') || self.heldKeys.has('arrowleft')) mx -= 1;
      if (self.heldKeys.has('d') || self.heldKeys.has('arrowright')) mx += 1;
      if (self.heldKeys.has('w') || self.heldKeys.has('arrowup')) my -= 1;
      if (self.heldKeys.has('s') || self.heldKeys.has('arrowdown')) my += 1;

      const moveLen = Math.sqrt(mx * mx + my * my);
      if (moveLen > 1) { mx /= moveLen; my /= moveLen; }

      const cx = self.width / 2;
      const cy = self.height / 2;
      const halfMin = Math.min(self.width / 2, self.height / 2);
      let ax = (self.mouseX - cx) / halfMin;
      let ay = (self.mouseY - cy) / halfMin;
      const aimLen = Math.sqrt(ax * ax + ay * ay);
      if (aimLen > 1) { ax /= aimLen; ay /= aimLen; }

      return {
        moveX: mx, moveY: my,
        aimX: ax, aimY: ay,
        shooting: self.mouseDown,
        bomb: self.heldKeys.has(' '),
        boost: self.heldKeys.has('shift'),
        weaponSwap: self.heldKeys.has('q'),
      };
    };

    this.pg.input.endFrame = () => {};
  }

  private updateCamera(): void {
    (this.pg as any).renderUpdate();
  }

  private createMockContainer(width: number, height: number): HTMLElement {
    if (typeof document !== 'undefined' && document.createElement) {
      const el = document.createElement('div');
      Object.defineProperty(el, 'clientWidth', { value: width, writable: true });
      Object.defineProperty(el, 'clientHeight', { value: height, writable: true });
      el.getBoundingClientRect = () => ({
        left: 0, top: 0, right: width, bottom: height,
        width, height, x: 0, y: 0, toJSON: () => ({}),
      });
      return el;
    }

    return {
      clientWidth: width, clientHeight: height,
      appendChild: () => {}, removeChild: () => {},
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: width, bottom: height,
        width, height, x: 0, y: 0, toJSON: () => ({}),
      }),
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLElement;
  }
}
