/**
 * TestHarnessAPI — Full programmatic control of the running game for automated testing.
 *
 * Activated when URL has `?testMode=true`. Exposes `window.__TEST_API`.
 * Imports and controls REAL game objects (EnemySpawner, Player, WeaponManager, etc.)
 * — no separate codebase, no duplication.
 *
 * All return values are JSON-serializable for Puppeteer's page.evaluate().
 */

import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { EnemyType } from '../entities/enemies/EnemySpawner';
import { WeaponType } from '../weapons/WeaponTypes';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { StateRecorder } from './StateRecorder';
import { ScenarioEngine } from './ScenarioEngine';
import type { Scenario, ScenarioResult } from './ScenarioEngine';

// ---------------------------------------------------------------------------
// Serializable types (JSON-safe, no THREE objects)
// ---------------------------------------------------------------------------

export interface Vec3 { x: number; y: number; z: number }
export interface UV { u: number; v: number }

export interface DamageEvent {
  time: number;
  frame: number;
  source: string;       // 'enemy' | 'bullet' | 'tesla' | 'bomb' | 'companion'
  target: string;       // enemy type or 'player'
  targetId: string;
  position: Vec3;
}

export interface DeathEvent {
  time: number;
  frame: number;
  playerU: number;
  playerV: number;
  playerWorldPos: Vec3;
  nearestEnemyDist: number;
  nearestEnemyType: string;
  livesRemaining: number;
}

export interface EnemyInfo {
  id: string;
  type: string;
  u: number;
  v: number;
  worldPos: Vec3;
  alive: boolean;
  health: number;
  opacity: number;
}

export interface PickupInfo {
  id: string;
  type: string;
  u: number;
  v: number;
  worldPos: Vec3;
}

export interface GameStateSnapshot {
  enemies: number;
  bullets: number;
  pickups: number;
  score: number;
  lives: number;
  bombs: number;
  gameTime: number;
  frame: number;
  isPaused: boolean;
  isGameOver: boolean;
  currentWeapon: string;
  surface: string;
}

// ---------------------------------------------------------------------------
// TestHarnessAPI
// ---------------------------------------------------------------------------

/** Weapon mastery state for all weapons. */
export interface WeaponMasteryState {
  weapon: string;
  level: number;
  isMaxed: boolean;
}

/** Recent bullet trajectory info. */
export interface BulletTrajectory {
  u: number;
  v: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  age: number;
}

export class TestHarnessAPI {
  private ctx: GameContext;
  private frameCount = 0;
  private enemyIdCounter = 0;
  private readonly enemyIdMap = new Map<BaseEnemy, string>();

  // Event logs
  private damageLog: DamageEvent[] = [];
  private deathLog: DeathEvent[] = [];
  private prevAlive = true;

  // Integrated sub-systems
  private readonly stateRecorder: StateRecorder;
  private readonly scenarioEngine: ScenarioEngine;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.stateRecorder = new StateRecorder(ctx);
    this.scenarioEngine = new ScenarioEngine(this, this.stateRecorder);
  }

  // -----------------------------------------------------------------------
  // Enemy control
  // -----------------------------------------------------------------------

  /** Spawn an enemy at a specific UV position. Returns a stable ID. */
  spawnEnemy(type: string, u: number, v: number): string {
    const enemy = this.ctx.enemySpawner.spawn(type as EnemyType, u, v, 0, true);
    const id = `enemy_${this.enemyIdCounter++}`;
    this.enemyIdMap.set(enemy, id);
    (enemy as any).__testId = id;
    return id;
  }

  /** Move an enemy toward a target UV at a given speed (world units/sec). */
  moveEnemyTo(id: string, targetU: number, targetV: number, speed: number): void {
    const enemy = this.findEnemyById(id);
    if (!enemy) return;
    // Store movement target — the update() method drives this each frame
    (enemy as any).__testTarget = { u: targetU, v: targetV, speed };
  }

  /** Get an enemy's current position by ID. */
  getEnemyPosition(id: string): { u: number; v: number; worldPos: Vec3 } | null {
    const enemy = this.findEnemyById(id);
    if (!enemy) return null;
    const pos = enemy.mesh ? enemy.mesh.position : enemy.position;
    return {
      u: enemy.surfacePosition.u,
      v: enemy.surfacePosition.v,
      worldPos: { x: pos.x, y: pos.y, z: pos.z },
    };
  }

  /** Get all enemies with their state. */
  getEnemies(): EnemyInfo[] {
    const result: EnemyInfo[] = [];
    for (const enemy of this.ctx.enemySpawner.getEnemies()) {
      if (!enemy.active) continue;
      const pos = enemy.mesh ? enemy.mesh.position : enemy.position;
      let id = (enemy as any).__testId as string | undefined;
      if (!id) {
        id = `enemy_${this.enemyIdCounter++}`;
        this.enemyIdMap.set(enemy, id);
        (enemy as any).__testId = id;
      }

      // Read opacity from instance manager if available
      let opacity = 1.0;
      const instanceIndex = (enemy as any)._instanceIndex as number | undefined;
      const instanceType = (enemy as any)._instanceType as string | undefined;
      if (instanceIndex !== undefined && instanceType && this.ctx.enemyInstanceManager) {
        const batch = (this.ctx.enemyInstanceManager as any).batches?.get(instanceType);
        if (batch?.opacityAttribute) {
          opacity = batch.opacityAttribute.getX(instanceIndex);
        }
      }

      result.push({
        id,
        type: enemy.baseTypeName || enemy.constructor.name,
        u: enemy.surfacePosition.u,
        v: enemy.surfacePosition.v,
        worldPos: { x: pos.x, y: pos.y, z: pos.z },
        alive: enemy.alive,
        health: enemy.health,
        opacity,
      });
    }
    return result;
  }

  /** Clear (destroy) all enemies. */
  clearEnemies(): void {
    const enemies = this.ctx.enemySpawner.getEnemies().slice();
    for (const e of enemies) {
      if (e.active) e.destroy();
    }
  }

  // -----------------------------------------------------------------------
  // Player control
  // -----------------------------------------------------------------------

  /** Teleport player to a UV position. Syncs walker + mesh + clears velocity. */
  setPlayerPosition(u: number, v: number): void {
    const { player, surface, playerWalker } = this.ctx;
    player.surfaceU = u;
    player.surfaceV = v;
    // Clear velocity so player doesn't drift after teleport
    player.velocityU = 0;
    player.velocityV = 0;
    const sp = surface.getPoint(u, v);
    const worldPos = sp.position.clone().applyQuaternion(surface.worldRotation);
    playerWalker.position.copy(worldPos);
    player.mesh.position.copy(worldPos);
  }

  /** Get player position. */
  getPlayerPosition(): { u: number; v: number; worldPos: Vec3 } {
    const { player } = this.ctx;
    const pos = player.mesh.position;
    return {
      u: player.surfaceU,
      v: player.surfaceV,
      worldPos: { x: pos.x, y: pos.y, z: pos.z },
    };
  }

  /** Simulate weapon fire (one shot). */
  fireWeapon(): void {
    const { player, playerWalker } = this.ctx;
    if (!player.alive) return;
    // Use the player's aim direction or forward direction
    const origin = player.mesh.position.clone();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(player.mesh.quaternion);
    if (player.weaponFireHandler) {
      player.weaponFireHandler(origin, direction);
    }
  }

  /** Equip a weapon by name. */
  equipWeapon(type: string): void {
    this.ctx.weaponManager.equipWeapon(type as WeaponType);
  }

  /** Get current weapon type. */
  getCurrentWeapon(): string {
    return this.ctx.weaponManager.getCurrentWeapon();
  }

  // -----------------------------------------------------------------------
  // Pickup control
  // -----------------------------------------------------------------------

  /** Spawn a weapon pickup at a UV position. Returns an ID. */
  spawnPickup(type: string, u: number, v: number): string {
    // Force-spawn pickup at the given location by calling the pickup spawner's
    // underlying mechanism. We use the real PickupSpawner but override RNG.
    const id = `pickup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.ctx.pickupSpawner.spawnPickupsOnEnemyDeath(u, v);
    return id;
  }

  /** Get all visible pickups. */
  getVisiblePickups(): PickupInfo[] {
    const result: PickupInfo[] = [];
    const { pickupSpawner } = this.ctx;

    for (const wp of pickupSpawner.weaponPickups) {
      if (!wp.active) continue;
      const pos = wp.mesh.position;
      result.push({
        id: `wpn_${result.length}`,
        type: `weapon_${wp.type ?? 'unknown'}`,
        u: wp.surfaceU ?? 0,
        v: wp.surfaceV ?? 0,
        worldPos: { x: pos.x, y: pos.y, z: pos.z },
      });
    }
    for (const bp of pickupSpawner.buffPickups) {
      if (!bp.active) continue;
      const pos = bp.mesh.position;
      result.push({
        id: `buff_${result.length}`,
        type: `buff_${(bp as any).buffType ?? 'unknown'}`,
        u: bp.surfaceU ?? 0,
        v: bp.surfaceV ?? 0,
        worldPos: { x: pos.x, y: pos.y, z: pos.z },
      });
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Game state
  // -----------------------------------------------------------------------

  /** Get a snapshot of the current game state. */
  getGameState(): GameStateSnapshot {
    const { player, enemySpawner, bulletPool, pickupSpawner, weaponManager, game } = this.ctx;
    const pickupCount = pickupSpawner.weaponPickups.filter(p => p.active).length
      + pickupSpawner.buffPickups.filter(p => p.active).length;

    return {
      enemies: enemySpawner.getActiveCount(),
      bullets: bulletPool.activeCount,
      pickups: pickupCount,
      score: player.score,
      lives: player.lives,
      bombs: player.bombs,
      gameTime: game.clock.totalTime,
      frame: this.frameCount,
      isPaused: this.ctx.state.isPaused,
      isGameOver: this.ctx.state.isGameOver,
      currentWeapon: weaponManager.getCurrentWeapon(),
      surface: String(this.ctx.surfaceType),
    };
  }

  /** Pause the game. */
  pauseGame(): void {
    this.ctx.game.pause();
  }

  /** Resume the game. */
  resumeGame(): void {
    this.ctx.game.resume();
  }

  // -----------------------------------------------------------------------
  // Telemetry (enhanced — instant, not 500ms interval)
  // -----------------------------------------------------------------------

  /** Get the full telemetry snapshot instantly. */
  getTelemetry(): any {
    return (window as any).__GAME_TELEMETRY ?? null;
  }

  /** Get recent death events. */
  getRecentDeaths(): DeathEvent[] {
    return [...this.deathLog];
  }

  /** Get recent damage events. */
  getRecentDamageEvents(): DamageEvent[] {
    return [...this.damageLog];
  }

  /** Clear event logs (call between scenarios). */
  clearEvents(): void {
    this.damageLog = [];
    this.deathLog = [];
  }

  // -----------------------------------------------------------------------
  // New API methods — s44r13-01
  // -----------------------------------------------------------------------

  /** Get weapon mastery level for all weapons. */
  getWeaponMasteryState(): WeaponMasteryState[] {
    const results: WeaponMasteryState[] = [];
    const weaponTypes = Object.values(WeaponType).filter(v => typeof v === 'string') as string[];
    for (const weapon of weaponTypes) {
      const level = (this.ctx.weaponManager as any).masteryLevelFn?.(weapon) ?? 0;
      results.push({ weapon, level, isMaxed: level >= 5 });
    }
    return results;
  }

  /** Get recent bullet spawn positions + directions (UV + direction vector). */
  getBulletTrajectories(): BulletTrajectory[] {
    const result: BulletTrajectory[] = [];
    this.ctx.bulletPool.forEachActive((_idx, _pos, data) => {
      result.push({
        u: data.surfaceU,
        v: data.surfaceV,
        dirX: data.dirX,
        dirY: data.dirY,
        dirZ: data.dirZ,
        age: data.age,
      });
    });
    return result;
  }

  /** Simulate a key press (and optional release after duration ms). */
  simulateInput(key: string, durationMs?: number): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    if (durationMs && durationMs > 0) {
      setTimeout(() => {
        document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
      }, durationMs);
    }
  }

  /** Change game difficulty level. Sets waveScheduler.currentDifficultyLevel if accessible. */
  setDifficulty(level: number): void {
    const waveScheduler = (this.ctx as any).waveScheduler;
    if (waveScheduler) waveScheduler.currentDifficultyLevel = level;
  }

  /** Get collision mesh info — player/enemy hit radii from collision system. */
  getCollisionMeshInfo(): { playerRadius: number; enemyRadius: number; surfaceType: string } {
    const collisionSystem = (this.ctx as any).collisionSystem;
    return {
      playerRadius: collisionSystem?.playerRadius ?? -1,
      enemyRadius: collisionSystem?.enemyRadius ?? -1,
      surfaceType: String(this.ctx.surfaceType),
    };
  }

  /** Run a full scenario and return its result. */
  async runScenario(scenario: Scenario): Promise<ScenarioResult> {
    return this.scenarioEngine.runScenario(scenario);
  }

  /** Get recorded frame history from StateRecorder. */
  getRecordedHistory(lastNFrames?: number) {
    const all = this.stateRecorder.getHistory();
    if (lastNFrames !== undefined && lastNFrames > 0) {
      return all.slice(-lastNFrames);
    }
    return all;
  }

  /** Get the StateRecorder instance directly (for Puppeteer proxy access). */
  getStateRecorder(): StateRecorder {
    return this.stateRecorder;
  }

  /** Get the ScenarioEngine instance. */
  getScenarioEngine(): ScenarioEngine {
    return this.scenarioEngine;
  }

  // -----------------------------------------------------------------------
  // Frame update — called every game tick when testMode=true
  // -----------------------------------------------------------------------

  /** Called every fixed-update frame. Drives test-directed enemy movement + event tracking. */
  update(): void {
    this.frameCount++;
    const { player, enemySpawner, game } = this.ctx;
    const time = game.clock.totalTime;
    const dt = game.clock.fixedDeltaTime;

    // --- Drive test-directed enemy movement (runs AFTER gameLoop.update) ---
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.active) continue;
      const target = (enemy as any).__testTarget as
        | { u: number; v: number; speed: number }
        | undefined;
      if (!target) continue;

      // Compute world positions of current and target
      const currentSP = this.ctx.surface.getPoint(enemy.surfacePosition.u, enemy.surfacePosition.v);
      const targetSP = this.ctx.surface.getPoint(target.u, target.v);
      const currentWorld = currentSP.position.clone().applyQuaternion(this.ctx.surface.worldRotation);
      const targetWorld = targetSP.position.clone().applyQuaternion(this.ctx.surface.worldRotation);

      const dir = targetWorld.clone().sub(currentWorld);
      const dist = dir.length();
      if (dist < 0.1) {
        // Arrived
        (enemy as any).__testTarget = undefined;
        continue;
      }

      // Move toward target at requested speed
      const step = Math.min(target.speed * dt, dist);
      dir.multiplyScalar(step / dist);
      const newWorld = currentWorld.add(dir);

      // Project back to surface via worldToSurface
      const invRot = this.ctx.surface.worldRotation.clone().invert();
      const localPos = newWorld.applyQuaternion(invRot);
      const newUV = this.ctx.surface.worldToSurface(localPos);
      enemy.surfacePosition.u = newUV.u;
      enemy.surfacePosition.v = newUV.v;

      // Sync world position
      const newSP = this.ctx.surface.getPoint(newUV.u, newUV.v);
      const worldPos = newSP.position.clone().applyQuaternion(this.ctx.surface.worldRotation);
      if (enemy.mesh) {
        enemy.mesh.position.copy(worldPos);
      }
      enemy.position.copy(worldPos);
      // Also sync the walker to prevent it from fighting
      if (enemy.walker) {
        enemy.walker.position.copy(worldPos);
      }
    }

    // --- Death detection ---
    const currentlyAlive = player.alive;
    if (this.prevAlive && !currentlyAlive) {
      const pPos = player.mesh.position;
      let nearestType = 'unknown';
      let nearestDist = Infinity;
      for (const e of enemySpawner.getEnemies()) {
        if (!e.active || !e.mesh) continue;
        const d = pPos.distanceTo(e.mesh.position);
        if (d < nearestDist) {
          nearestDist = d;
          nearestType = e.baseTypeName || e.constructor.name;
        }
      }
      this.deathLog.push({
        time,
        frame: this.frameCount,
        playerU: player.surfaceU,
        playerV: player.surfaceV,
        playerWorldPos: { x: pPos.x, y: pPos.y, z: pPos.z },
        nearestEnemyDist: nearestDist === Infinity ? -1 : nearestDist,
        nearestEnemyType: nearestType,
        livesRemaining: player.lives,
      });
    }
    this.prevAlive = currentlyAlive;

    // --- Tick StateRecorder (frame-by-frame state capture) ---
    this.stateRecorder.update();

    // --- Tick ScenarioEngine (timeline-based scenario execution) ---
    this.scenarioEngine.tick(this.frameCount, time);

    // --- Expose on window for Puppeteer access ---
    (window as any).__TEST_API = this;
    (window as any).__STATE_RECORDER = this.stateRecorder;
    (window as any).__SCENARIO_ENGINE = this.scenarioEngine;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private findEnemyById(id: string): BaseEnemy | null {
    for (const enemy of this.ctx.enemySpawner.getEnemies()) {
      if ((enemy as any).__testId === id) return enemy;
    }
    return null;
  }

  /**
   * Record a damage event (called externally from collision system hooks).
   * In test mode, the collision system pushes events here.
   */
  recordDamage(source: string, target: string, targetId: string, position: Vec3): void {
    this.damageLog.push({
      time: this.ctx.game.clock.totalTime,
      frame: this.frameCount,
      source,
      target,
      targetId,
      position,
    });
  }
}
