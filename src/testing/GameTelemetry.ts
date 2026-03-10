/**
 * GameTelemetry — Thin facade over the real game code for verification testing.
 *
 * This is NOT a simulation. It wraps RealGameTestHarness which runs through the
 * actual GameLoop.ts + CollisionSystem code path — the same code the user plays.
 *
 * Provides:
 * - Position queries (player, enemies, bullets) with surface UV + world coords
 * - Collision event logging with distance/threshold data
 * - Journey control (spawn entities, teleport player, fire weapons)
 * - Full frame snapshots for timeline analysis
 *
 * Usage:
 *   const telemetry = GameTelemetry.create({ surface: 'sphere' });
 *   telemetry.teleportPlayerTo(0.5, 0.5);
 *   telemetry.spawnEnemyAt('grunt', 0.5, 0.6);
 *   telemetry.tick(60);
 *   const collisions = telemetry.getCollisionLog();
 *   const snapshot = telemetry.getFrameSnapshot();
 *   telemetry.dispose();
 */

import * as THREE from 'three';
import { RealGameTestHarness } from '../test/RealGameTestHarness';
import type { SurfaceType } from '../surfaces/SurfaceFactory';
import type { EnemyType } from '../entities/enemies/EnemySpawner';
import type { CollisionEvent } from '../core/CollisionSystem';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryConfig {
  surface: SurfaceType;
  seed?: number;
  width?: number;
  height?: number;
}

export interface EntityPosition {
  id: number;
  type: string;
  surfaceUV: { u: number; v: number };
  worldPos: THREE.Vector3;
  /** For enemies: whether they're visible (not materializing, not ghost) */
  visible: boolean;
  alive: boolean;
  health: number;
  radius: number;
}

export interface BulletPosition {
  index: number;
  worldPos: THREE.Vector3;
  direction: THREE.Vector3;
}

export interface PlayerState {
  surfaceUV: { u: number; v: number };
  worldPos: THREE.Vector3;
  alive: boolean;
  lives: number;
  aimDirection: THREE.Vector3;
}

export interface FrameSnapshot {
  frame: number;
  player: PlayerState;
  enemies: EntityPosition[];
  bullets: BulletPosition[];
  collisionsThisFrame: CollisionEvent[];
}

export interface JourneyStep {
  action: 'spawn-enemy' | 'teleport-player' | 'press-key' | 'release-key' | 'tick' |
          'fire-at' | 'wait-materialization' | 'assert-collision' | 'assert-no-collision' |
          'assert-player-alive' | 'assert-player-dead' | 'assert-enemy-count';
  params: Record<string, any>;
}

export interface JourneyResult {
  surface: SurfaceType;
  steps: Array<{
    step: JourneyStep;
    success: boolean;
    message: string;
    snapshot?: FrameSnapshot;
  }>;
  collisionLog: CollisionEvent[];
  passed: boolean;
  failures: string[];
}

// ---------------------------------------------------------------------------
// GameTelemetry
// ---------------------------------------------------------------------------

export class GameTelemetry {
  readonly harness: RealGameTestHarness;
  readonly surface: SurfaceType;
  private _collisionLog: CollisionEvent[] = [];
  private _frameCollisions: CollisionEvent[] = [];
  private _frame = 0;

  private constructor(config: TelemetryConfig) {
    this.surface = config.surface;
    this.harness = new RealGameTestHarness({
      surface: config.surface,
      seed: config.seed,
      width: config.width ?? 800,
      height: config.height ?? 600,
    });

    // Wire collision telemetry
    this.harness.collisionSystem.onCollisionEvent = (event: CollisionEvent) => {
      this._collisionLog.push(event);
      this._frameCollisions.push(event);
    };

    // Set surface type for collision tuning
    this.harness.collisionSystem.surfaceType = config.surface;
  }

  static create(config: TelemetryConfig): GameTelemetry {
    return new GameTelemetry(config);
  }

  // =========================================================================
  // Position Queries
  // =========================================================================

  getPlayerState(): PlayerState {
    const uv = this.harness.getPlayerSurfaceUV();
    return {
      surfaceUV: uv,
      worldPos: this.harness.getPlayerWorldPos(),
      alive: this.harness.player.alive,
      lives: this.harness.player.lives,
      aimDirection: this.harness.player.getAimDirection(),
    };
  }

  getEnemyPositions(): EntityPosition[] {
    const enemies = this.harness.enemySpawner.getEnemies();
    return enemies.filter(e => e.active).map((e, i) => {
      const info = this.harness.getEntitySurfaceInfo(e.position);
      return {
        id: i,
        type: e.baseTypeName || 'unknown',
        surfaceUV: info.surfaceUV,
        worldPos: e.position.clone(),
        visible: e.alive && !e.isMaterializing && !e.isGhostForPlayer,
        alive: e.alive,
        health: e.health,
        radius: e.radius,
      };
    });
  }

  getBulletPositions(): BulletPosition[] {
    const bullets: BulletPosition[] = [];
    this.harness.bulletPool.forEachActive((idx, pos, data) => {
      bullets.push({
        index: idx,
        worldPos: pos.clone(),
        direction: new THREE.Vector3(data.dirX ?? 0, data.dirY ?? 0, data.dirZ ?? 0),
      });
    });
    return bullets;
  }

  // =========================================================================
  // Frame Control
  // =========================================================================

  /** Advance N frames. Returns collision events that occurred during these frames. */
  tick(frames = 1): CollisionEvent[] {
    const events: CollisionEvent[] = [];
    for (let i = 0; i < frames; i++) {
      this._frameCollisions = [];
      this.harness.collisionSystem.setTelemetryFrame(this._frame);
      this.harness.tick(1);
      this._frame++;
      events.push(...this._frameCollisions);
    }
    return events;
  }

  /** Advance T seconds of game time at 60fps. */
  tickSeconds(seconds: number): CollisionEvent[] {
    return this.tick(Math.round(seconds * 60));
  }

  /** Current frame number. */
  get frame(): number { return this._frame; }

  // =========================================================================
  // Journey Control
  // =========================================================================

  /** Teleport player to specific UV coordinates. */
  teleportPlayerTo(u: number, v: number): void {
    const point = this.harness.surface.getPoint(u, v);
    const projected = this.harness.meshSurface.closestPointOnSurface(point.position);
    if (projected) {
      this.harness.playerWalker.teleportTo(projected.point, projected.faceIndex, projected.normal);
    } else {
      this.harness.playerWalker.teleportTo(point.position, 0, point.normal);
    }
    this.harness.player.mesh.position.copy(this.harness.playerWalker.position);
    this.harness.player.respawn(u, v);
  }

  /** Spawn an enemy at specific UV coordinates. Returns the enemy index. */
  spawnEnemyAt(type: EnemyType, u: number, v: number): number {
    const countBefore = this.harness.enemySpawner.getEnemies().length;
    this.harness.spawnEnemy(type, u, v);
    return countBefore;
  }

  /** Wait for all spawned enemies to finish materializing. */
  waitForMaterialization(maxFrames = 120): void {
    this.harness.waitForMaterialization(maxFrames);
    this._frame += maxFrames;
  }

  /** Press a key (movement or action). */
  pressKey(key: string): void {
    this.harness.pressKey(key);
  }

  /** Release a key. */
  releaseKey(key: string): void {
    this.harness.releaseKey(key);
  }

  /** Release all keys. */
  releaseAllKeys(): void {
    this.harness.releaseAllKeys();
  }

  /** Fire weapon by setting mouse down. */
  startFiring(): void {
    this.harness.setMouseDown(true);
  }

  /** Stop firing. */
  stopFiring(): void {
    this.harness.setMouseDown(false);
  }

  /** Aim at a specific screen position. */
  aimAt(screenX: number, screenY: number): void {
    this.harness.setMousePosition(screenX, screenY);
  }

  // =========================================================================
  // Collision Log
  // =========================================================================

  /** Get all collision events since creation. */
  getCollisionLog(): ReadonlyArray<CollisionEvent> {
    return this._collisionLog;
  }

  /** Get collision events of a specific type. */
  getCollisionsByType(type: 'bullet-enemy' | 'player-enemy'): CollisionEvent[] {
    return this._collisionLog.filter(e => e.type === type);
  }

  /** Clear the collision log. */
  clearCollisionLog(): void {
    this._collisionLog = [];
  }

  /** Check if any player-enemy collision occurred. */
  hadPlayerEnemyCollision(): boolean {
    return this._collisionLog.some(e => e.type === 'player-enemy');
  }

  /** Check if any bullet-enemy collision occurred. */
  hadBulletEnemyCollision(): boolean {
    return this._collisionLog.some(e => e.type === 'bullet-enemy');
  }

  // =========================================================================
  // Frame Snapshots
  // =========================================================================

  /** Get a full snapshot of the current frame state. */
  getFrameSnapshot(): FrameSnapshot {
    return {
      frame: this._frame,
      player: this.getPlayerState(),
      enemies: this.getEnemyPositions(),
      bullets: this.getBulletPositions(),
      collisionsThisFrame: [...this._frameCollisions],
    };
  }

  // =========================================================================
  // Journey Runner
  // =========================================================================

  /** Execute a sequence of journey steps and collect results. */
  runJourney(steps: JourneyStep[]): JourneyResult {
    const results: JourneyResult['steps'] = [];
    const failures: string[] = [];

    for (const step of steps) {
      const result = this.executeStep(step);
      results.push(result);
      if (!result.success) {
        failures.push(`Step ${results.length}: ${result.message}`);
      }
    }

    return {
      surface: this.surface,
      steps: results,
      collisionLog: [...this._collisionLog],
      passed: failures.length === 0,
      failures,
    };
  }

  private executeStep(step: JourneyStep): JourneyResult['steps'][0] {
    const { action, params } = step;

    switch (action) {
      case 'spawn-enemy': {
        this.spawnEnemyAt(params.type, params.u, params.v);
        return { step, success: true, message: `Spawned ${params.type} at (${params.u}, ${params.v})` };
      }
      case 'teleport-player': {
        this.teleportPlayerTo(params.u, params.v);
        return { step, success: true, message: `Teleported player to (${params.u}, ${params.v})` };
      }
      case 'press-key': {
        this.pressKey(params.key);
        return { step, success: true, message: `Pressed ${params.key}` };
      }
      case 'release-key': {
        this.releaseKey(params.key);
        return { step, success: true, message: `Released ${params.key}` };
      }
      case 'tick': {
        const events = this.tick(params.frames ?? 1);
        return {
          step,
          success: true,
          message: `Ticked ${params.frames ?? 1} frames, ${events.length} collisions`,
          snapshot: this.getFrameSnapshot(),
        };
      }
      case 'wait-materialization': {
        this.waitForMaterialization(params.maxFrames ?? 120);
        return { step, success: true, message: 'Waited for materialization' };
      }
      case 'fire-at': {
        this.aimAt(params.screenX ?? 400, params.screenY ?? 300);
        this.startFiring();
        const events = this.tick(params.frames ?? 10);
        this.stopFiring();
        return {
          step,
          success: true,
          message: `Fired for ${params.frames ?? 10} frames, ${events.length} hits`,
          snapshot: this.getFrameSnapshot(),
        };
      }
      case 'assert-collision': {
        const type = params.type ?? 'player-enemy';
        const hasCollision = this._collisionLog.some(e => e.type === type);
        return {
          step,
          success: hasCollision,
          message: hasCollision
            ? `Collision ${type} occurred as expected`
            : `Expected ${type} collision but none occurred`,
          snapshot: this.getFrameSnapshot(),
        };
      }
      case 'assert-no-collision': {
        const type = params.type ?? 'player-enemy';
        const hasCollision = this._collisionLog.some(e => e.type === type);
        return {
          step,
          success: !hasCollision,
          message: !hasCollision
            ? `No ${type} collision as expected`
            : `Unexpected ${type} collision occurred (${this.getCollisionsByType(type).length} events)`,
          snapshot: this.getFrameSnapshot(),
        };
      }
      case 'assert-player-alive': {
        const alive = this.harness.player.alive;
        return {
          step,
          success: alive,
          message: alive ? 'Player is alive' : 'Player is dead (expected alive)',
          snapshot: this.getFrameSnapshot(),
        };
      }
      case 'assert-player-dead': {
        const dead = !this.harness.player.alive;
        return {
          step,
          success: dead,
          message: dead ? 'Player is dead as expected' : 'Player is still alive (expected dead)',
          snapshot: this.getFrameSnapshot(),
        };
      }
      case 'assert-enemy-count': {
        const expected = params.count;
        const actual = this.harness.getEnemies().length;
        const success = actual === expected;
        return {
          step,
          success,
          message: success
            ? `Enemy count is ${expected}`
            : `Expected ${expected} enemies, got ${actual}`,
          snapshot: this.getFrameSnapshot(),
        };
      }
      default:
        return { step, success: false, message: `Unknown action: ${action}` };
    }
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  dispose(): void {
    this.harness.collisionSystem.onCollisionEvent = null;
    this.harness.dispose();
  }
}

// ---------------------------------------------------------------------------
// Journey Builder — fluent DSL for creating journey steps
// ---------------------------------------------------------------------------

export class JourneyBuilder {
  private steps: JourneyStep[] = [];

  /** Teleport player to UV coordinates. */
  playerAt(u: number, v: number): this {
    this.steps.push({ action: 'teleport-player', params: { u, v } });
    return this;
  }

  /** Spawn an enemy at UV coordinates. */
  spawnEnemy(type: EnemyType, u: number, v: number): this {
    this.steps.push({ action: 'spawn-enemy', params: { type, u, v } });
    return this;
  }

  /** Wait for enemies to finish materializing. */
  waitMaterialization(maxFrames = 120): this {
    this.steps.push({ action: 'wait-materialization', params: { maxFrames } });
    return this;
  }

  /** Advance N frames. */
  tick(frames: number): this {
    this.steps.push({ action: 'tick', params: { frames } });
    return this;
  }

  /** Press a movement/action key. */
  pressKey(key: string): this {
    this.steps.push({ action: 'press-key', params: { key } });
    return this;
  }

  /** Release a key. */
  releaseKey(key: string): this {
    this.steps.push({ action: 'release-key', params: { key } });
    return this;
  }

  /** Fire weapon for N frames. */
  fireAt(screenX: number, screenY: number, frames = 10): this {
    this.steps.push({ action: 'fire-at', params: { screenX, screenY, frames } });
    return this;
  }

  /** Assert that a collision of the given type occurred. */
  expectCollision(type: 'player-enemy' | 'bullet-enemy' = 'player-enemy'): this {
    this.steps.push({ action: 'assert-collision', params: { type } });
    return this;
  }

  /** Assert that NO collision of the given type occurred. */
  expectNoCollision(type: 'player-enemy' | 'bullet-enemy' = 'player-enemy'): this {
    this.steps.push({ action: 'assert-no-collision', params: { type } });
    return this;
  }

  /** Assert player is alive. */
  expectPlayerAlive(): this {
    this.steps.push({ action: 'assert-player-alive', params: {} });
    return this;
  }

  /** Assert player is dead. */
  expectPlayerDead(): this {
    this.steps.push({ action: 'assert-player-dead', params: {} });
    return this;
  }

  /** Assert enemy count. */
  expectEnemyCount(count: number): this {
    this.steps.push({ action: 'assert-enemy-count', params: { count } });
    return this;
  }

  /** Build and return the steps. */
  build(): JourneyStep[] {
    return [...this.steps];
  }
}

/** Create a new journey builder. */
export function journey(): JourneyBuilder {
  return new JourneyBuilder();
}
