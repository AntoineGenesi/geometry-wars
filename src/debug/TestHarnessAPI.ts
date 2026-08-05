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
import { WeaponPickup } from '../weapons/WeaponPickup';
import { BuffPickup, BuffType } from '../weapons/BuffPickup';
import { SuperStatePickup } from '../weapons/SuperStatePickup';
import { SuperStateType } from '../weapons/SuperState';
import { BuffPickupNew } from '../buffs/BuffPickupNew';
import { StackBuffType } from '../buffs/BuffManager';
import { CompanionPickup, CompanionType } from '../entities/Companion';
import { HealPickup } from '../pickups/HealPickup';
import { ShieldPickup } from '../pickups/ShieldPickup';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { StateRecorder } from './StateRecorder';
import { ScenarioEngine } from './ScenarioEngine';
import type { Scenario, ScenarioResult } from './ScenarioEngine';
import { PerformanceProfiler } from './PerformanceProfiler';
import type { PerformanceProfile } from './PerformanceProfiler';
import { profiler as coreProfiler } from '../core/PerformanceProfiler';
import { UPGRADE_TREES } from '../systems/UpgradeTreeData';
import {
  createPickupVisualProofDebug,
  type PickupVisualProofRecord,
} from './PickupVisualProofDebug';

// ---------------------------------------------------------------------------
// Serializable types (JSON-safe, no THREE objects)
// ---------------------------------------------------------------------------

export interface Vec3 { x: number; y: number; z: number }
export interface UV { u: number; v: number }

export interface DamageEvent {
  time: number;
  frame: number;
  /** Sub-millisecond timestamp from performance.now() at event creation. */
  preciseTime: number;
  source: string;       // 'enemy' | 'bullet' | 'tesla' | 'bomb' | 'companion'
  target: string;       // enemy type or 'player'
  targetId: string;
  position: Vec3;
  /** For bullet-enemy hits: bullet UV position at impact. */
  bulletPos?: UV;
  /** For collision events: the colliding entity's UV position. */
  enemyPos?: UV;
  /** Exact UV distance between entities at collision moment. */
  distance?: number;
  /** Collision radius threshold used. */
  collisionRadius?: number;
  /** What triggered the collision check (e.g., "CollisionSystem.checkPlayerEnemyCollisions"). */
  collisionSource?: string;
  /** How long the bullet has been alive (bullet-enemy hits only). */
  bulletAge?: number;
  /** Weapon type that fired the bullet (bullet-enemy hits only). */
  weaponType?: string;
  /** Damage attributed by the weapon callback before health clamping. */
  damage?: number;
}

export interface DeathEvent {
  time: number;
  frame: number;
  /** Sub-millisecond timestamp from performance.now() at event creation. */
  preciseTime: number;
  playerU: number;
  playerV: number;
  playerWorldPos: Vec3;
  nearestEnemyDist: number;
  nearestEnemyType: string;
  /** UV position of the nearest enemy at death moment. */
  nearestEnemyU: number;
  nearestEnemyV: number;
  /** UV-space distance to the nearest enemy. */
  uvDistance: number;
  /** Collision radius that was used (from CollisionSystem). */
  collisionRadius: number;
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
  maxHealth: number;
  difficultyTier: number;
  difficultyTierName: string;
  opacity: number;
  /** Average brightness of the actual rendered instanceColor (0..1).
   *  After s44r18-20 fix, opacity is binary; all dimming is in instanceColor only.
   *  Use this (not opacity) to detect invisible enemies post-fix. */
  instanceColorBrightness: number;
  /** s44r29-05: Whether the enemy is still materializing (spawn warning phase).
   *  Materializing enemies are expected to have zero-scale — they're not visible yet. */
  isMaterializing: boolean;
  /** s44r29-05: Max component of the instance matrix scale vector.
   *  An enemy with high ICB but zero matrixScale is invisible — the matrix
   *  makes it zero-sized even though the color is correct. This catches
   *  enemies stuck at zero-scale from registration or LOD transitions. */
  instanceMatrixScale: number;
  /** s44r29-05: Which batch the enemy is actually rendered from.
   *  'high' = type-specific batch, 'lod-medium'/'lod-low' = shared LOD batch. */
  renderBatch: 'high' | 'lod-medium' | 'lod-low';
  /** Whether the routed render batch actually has a slot for this enemy. */
  renderSlotFound: boolean;
  /** Whether the routed slot is inside InstancedMesh.count and can be drawn by the GPU. */
  renderSlotDrawn: boolean;
  renderSlotIndex: number | null;
  renderDrawCount: number | null;
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

export interface WeaponProjectileInfo {
  type: string;
  position: Vec3;
  direction: Vec3;
  age: number;
  maxAge: number;
  damage: number;
  speed: number;
}

export interface WeaponEffectInfo {
  type: string;
  position: Vec3;
  direction: Vec3 | null;
  duration: number;
  elapsed: number;
  beamPointCount: number;
  phase: string | null;
  radius: number;
  affectedCount: number;
  visualChildCount: number;
}

export interface WeaponRuntimeSnapshot {
  currentWeapon: string;
  inventory: Array<{ type: string; ammo: number; stacks: number }>;
  bulletCount: number;
  bullets: BulletTrajectory[];
  projectileCount: number;
  projectiles: WeaponProjectileInfo[];
  effectCount: number;
  effects: WeaponEffectInfo[];
  visualRootChildren: number;
  blackHoleMeshCount: number;
}

export interface WeaponFireEvidence {
  selectedWeapon: string;
  firedSignal: boolean;
  firedIndicators: string[];
  origin: Vec3;
  direction: Vec3;
  targetEnemyId: string | null;
  targetBefore: EnemyInfo | null;
  runtimeBefore: WeaponRuntimeSnapshot;
  runtimeAfter: WeaponRuntimeSnapshot;
  baselineBulletCountBeforeClear: number;
  baselineBulletsCleared: boolean;
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
  private readonly performanceProfiler: PerformanceProfiler;
  private readonly pickupVisualProofRecords: PickupVisualProofRecord[] = [];
  private readonly pickupVisualProofDebug: ReturnType<typeof createPickupVisualProofDebug>;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.stateRecorder = new StateRecorder(ctx);
    this.scenarioEngine = new ScenarioEngine(this, this.stateRecorder);
    this.performanceProfiler = new PerformanceProfiler();
    this.pickupVisualProofDebug = createPickupVisualProofDebug({
      scene: ctx.game.scene,
      camera: ctx.game.camera,
      getPickups: () => this.pickupVisualProofRecords,
    });
    // Expose profiler globally so GameLoop wrappers can call it
    (window as any).__PERF_PROFILER = this.performanceProfiler;
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

  /** Configure a proof enemy without holding it at a harness-owned position. */
  configureEnemy(
    id: string,
    options: { health?: number; speed?: number; releaseMovement?: boolean },
  ): boolean {
    const enemy = this.findEnemyById(id);
    if (!enemy) return false;
    if (options.health !== undefined) {
      enemy.health = options.health;
      enemy.maxHealth = options.health;
    }
    if (options.speed !== undefined) enemy.speed = options.speed;
    if (options.releaseMovement !== false) {
      delete (enemy as any).__testTarget;
      delete (enemy as any).__testUV;
    }
    return true;
  }

  /** Project a world point onto the active walkable mesh and return both frames. */
  projectWorldPoint(worldPos: Vec3): { u: number; v: number; worldPos: Vec3 } | null {
    const projected = this.ctx.meshSurface.closestPointOnSurface(
      new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z),
    );
    if (!projected) return null;
    const local = projected.point.clone();
    const scale = this.ctx.surface.group.scale.x || 1;
    local.multiplyScalar(1 / scale);
    local.applyQuaternion(this.ctx.surface.worldRotation.clone().invert());
    const uv = this.ctx.surface.worldToSurface(local);
    return { u: uv.u, v: uv.v, worldPos: this.toVec3(projected.point) };
  }

  /** Get an enemy's current position by ID. */
  getEnemyPosition(id: string): { u: number; v: number; worldPos: Vec3 } | null {
    const enemy = this.findEnemyById(id);
    if (!enemy) return null;
    const pos = enemy.mesh ? enemy.mesh.position : enemy.position;
    // When under test control (__testUV set by moveEnemyTo), prefer the test-tracked UV.
    // surfacePosition gets overwritten by the game loop's worldToSurface each frame,
    // so reading it at an arbitrary time (page.evaluate) may return the game-loop value
    // rather than the test harness's intended position.
    const testUV = (enemy as any).__testUV as { u: number; v: number } | undefined;
    return {
      u: testUV ? testUV.u : enemy.surfacePosition.u,
      v: testUV ? testUV.v : enemy.surfacePosition.v,
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

      // Read opacity and instanceColor brightness from instance manager if available.
      // s44r29-05: Read from the CORRECT batch — if enemy is in a LOD batch,
      // read from LOD batch (where it actually renders), not the HIGH batch
      // (which has a stale zero-scale matrix for LOD enemies).
      let opacity = 1.0;
      let instanceColorBrightness = 1.0;
      let instanceMatrixScale = 1.0;
      let renderBatch: 'high' | 'lod-medium' | 'lod-low' = 'high';
      let renderSlotFound = !enemy.isInstanced;
      let renderSlotDrawn = !enemy.isInstanced;
      let renderSlotIndex: number | null = null;
      let renderDrawCount: number | null = null;
      const instanceIndex = (enemy as any)._instanceIndex as number | undefined;
      const instanceType = (enemy as any)._instanceType as string | undefined;
      if (instanceIndex !== undefined && instanceType && this.ctx.enemyInstanceManager) {
        const mgr = this.ctx.enemyInstanceManager as any;
        const isInLOD = mgr.enemyLODPlacement?.has(enemy);
        const lodLevel = isInLOD ? mgr.enemyLODPlacement.get(enemy) : undefined;

        if (isInLOD) {
          // Enemy renders from a LOD batch — read ICB and matrix from there
          const lodBatch = lodLevel === 1 /* MEDIUM */ ? mgr.lodMediumBatch : mgr.lodLowBatch;
          const lodSlot = lodBatch?.enemyToIndex?.get(enemy);
          renderBatch = lodLevel === 1 ? 'lod-medium' : 'lod-low';
          renderSlotFound = lodSlot !== undefined && !!lodBatch;
          renderSlotIndex = lodSlot ?? null;
          renderDrawCount = lodBatch?.instancedMesh?.count ?? null;
          renderSlotDrawn = renderSlotFound && renderDrawCount !== null && lodSlot! < renderDrawCount;
          if (lodSlot !== undefined && lodBatch) {
            if (lodBatch.opacityAttribute) {
              opacity = lodBatch.opacityAttribute.getX(lodSlot);
            }
            if (lodBatch.instancedMesh?.instanceColor) {
              const _c = new THREE.Color();
              lodBatch.instancedMesh.getColorAt(lodSlot, _c);
              instanceColorBrightness = (_c.r + _c.g + _c.b) / 3;
            }
            // Matrix scale from the LOD batch
            const _m = new THREE.Matrix4();
            const _s = new THREE.Vector3();
            lodBatch.instancedMesh.getMatrixAt(lodSlot, _m);
            _s.setFromMatrixScale(_m);
            instanceMatrixScale = Math.max(_s.x, _s.y, _s.z);
          } else {
            opacity = 0;
            instanceColorBrightness = 0;
            instanceMatrixScale = 0;
          }
        } else {
          // Enemy renders from the HIGH (type-specific) batch
          const batch = mgr.batches?.get(instanceType);
          renderSlotFound = !!batch;
          renderSlotIndex = instanceIndex;
          renderDrawCount = batch?.instancedMesh?.count ?? null;
          renderSlotDrawn = renderSlotFound && renderDrawCount !== null && instanceIndex < renderDrawCount;
          if (batch?.opacityAttribute) {
            opacity = batch.opacityAttribute.getX(instanceIndex);
          }
          if (batch?.instancedMesh?.instanceColor) {
            const _c = new THREE.Color();
            batch.instancedMesh.getColorAt(instanceIndex, _c);
            instanceColorBrightness = (_c.r + _c.g + _c.b) / 3;
          }
          // Matrix scale from the HIGH batch
          if (batch?.instancedMesh) {
            const _m = new THREE.Matrix4();
            const _s = new THREE.Vector3();
            batch.instancedMesh.getMatrixAt(instanceIndex, _m);
            _s.setFromMatrixScale(_m);
            instanceMatrixScale = Math.max(_s.x, _s.y, _s.z);
          } else {
            opacity = 0;
            instanceColorBrightness = 0;
            instanceMatrixScale = 0;
          }
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
        maxHealth: enemy.maxHealth,
        difficultyTier: enemy.difficultyTier?.tier ?? 0,
        difficultyTierName: enemy.difficultyTier?.name ?? 'Normal',
        opacity,
        isMaterializing: enemy.isMaterializing ?? false,
        instanceColorBrightness,
        instanceMatrixScale,
        renderBatch,
        renderSlotFound,
        renderSlotDrawn,
        renderSlotIndex,
        renderDrawCount,
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
    const scaleFactor = surface.group.scale.x;
    // Multiply by scaleFactor to match real game: player.mesh.position comes from matrixWorld
    // which includes surface.group.scale. Without this, zone check (world-space) mismatches.
    const worldPos = sp.position.clone().applyQuaternion(surface.worldRotation).multiplyScalar(scaleFactor);
    const projected = this.ctx.meshSurface.closestPointOnSurface(worldPos);
    if (projected) {
      playerWalker.teleportTo(projected.point, projected.faceIndex, projected.normal);
    } else {
      playerWalker.position.copy(worldPos);
    }
    player.mesh.position.copy(playerWalker.position);
    const frame = playerWalker.getTangentFrame();
    this.ctx.cameraController.snapToFrame(playerWalker.position, playerWalker.normal, frame);
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

  /** Simulate weapon fire (one shot). Returns proof-oriented runtime evidence. */
  fireWeapon(targetEnemyId?: string, options?: { clearBaselineBullets?: boolean }): WeaponFireEvidence {
    const { player } = this.ctx;
    const selectedWeapon = this.ctx.weaponManager.getCurrentWeapon();
    const origin = player.mesh.position.clone();
    const targetBefore = targetEnemyId ? this.getEnemyInfoById(targetEnemyId) : null;
    const direction = this.getFireDirection(origin, targetEnemyId);
    const runtimeBefore = this.getWeaponRuntimeSnapshot();

    if (player.alive && player.weaponFireHandler) {
      player.weaponFireHandler(origin, direction);
    }

    const baselineBulletCountBeforeClear = this.ctx.bulletPool.activeCount;
    const baselineBulletsCleared = options?.clearBaselineBullets === true;
    if (baselineBulletsCleared) this.ctx.bulletPool.clear();

    const runtimeAfter = this.getWeaponRuntimeSnapshot();
    const firedIndicators = this.getFireIndicators(runtimeBefore, runtimeAfter, selectedWeapon);

    return {
      selectedWeapon,
      firedSignal: firedIndicators.length > 0,
      firedIndicators,
      origin: this.toVec3(origin),
      direction: this.toVec3(direction),
      targetEnemyId: targetEnemyId ?? null,
      targetBefore,
      runtimeBefore,
      runtimeAfter,
      baselineBulletCountBeforeClear,
      baselineBulletsCleared,
    };
  }

  /** Equip a weapon by name. */
  equipWeapon(type: string): void {
    this.ctx.weaponManager.equipWeapon(type as WeaponType);
  }

  /** Force-equip a weapon by name for deterministic proof scripts. */
  forceEquipWeapon(type: string, ammo = 999): void {
    this.ctx.weaponManager.forceSetWeapon(type as WeaponType, ammo);
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

  /** Spawn one deterministic instance of every SP pickup visual for body-only proof. */
  spawnPickupVisualProofSet(u = 0.125, v = 0.7): Array<{ id: string; type: string }> {
    if (this.pickupVisualProofRecords.length > 0) {
      return this.pickupVisualProofRecords.map(({ id, type }) => ({ id, type }));
    }
    const { pickupSpawner, game } = this.ctx;
    const add = <T extends { mesh: THREE.Group }>(
      id: string,
      type: string,
      pickup: T,
      collection: T[],
    ): void => {
      pickup.mesh.userData.pickupProofId = id;
      pickup.mesh.userData.pickupVisualProof = true;
      game.scene.add(pickup.mesh);
      collection.push(pickup);
      this.pickupVisualProofRecords.push({ id, type, mesh: pickup.mesh });
    };

    add('sp-super', 'super', new SuperStatePickup(SuperStateType.QuadFire, u, v), pickupSpawner.superPickups);
    add('sp-weapon', 'weapon', new WeaponPickup(WeaponType.Spread, u, v), pickupSpawner.weaponPickups);
    add('sp-buff', 'buff', new BuffPickup(BuffType.RapidFire, u, v), pickupSpawner.buffPickups);
    add('sp-stack-buff', 'stack-buff', new BuffPickupNew(StackBuffType.HotHands, u, v), pickupSpawner.newBuffPickups);
    add('sp-companion', 'companion', new CompanionPickup(CompanionType.Guardian, u, v), pickupSpawner.companionPickups);
    add('sp-heal', 'heal', new HealPickup(u, v), pickupSpawner.healPickups);
    add('sp-shield', 'shield', new ShieldPickup(u, v), pickupSpawner.shieldPickups);
    return this.pickupVisualProofRecords.map(({ id, type }) => ({ id, type }));
  }

  getPickupVisualProofSamples() {
    return this.pickupVisualProofDebug.getPickupVisualProofSamples();
  }

  setPickupVisualProofIsolation(pickupId: string | null) {
    return this.pickupVisualProofDebug.setPickupVisualProofIsolation(pickupId);
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

  /** Get current wave number (1-based). Returns 0 before first wave starts. */
  getWave(): number {
    const waveScheduler = (this.ctx as any).waveScheduler;
    if (!waveScheduler) return 0;
    if (typeof waveScheduler.getCurrentWave === 'function') {
      return waveScheduler.getCurrentWave();
    }
    return 0;
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

  /** Get a DDA/dominance/difficulty snapshot from the real SP GameLoop path. */
  getDDAState(): any {
    const ctxAny = this.ctx as any;
    const waveScheduler = ctxAny.waveScheduler;
    const difficultyLevel = Number(waveScheduler?.currentDifficultyLevel ?? 0);
    const assistanceDisableOnTier =
      typeof this.ctx.ddaEngine.getDisableOnTier === 'function'
        ? this.ctx.ddaEngine.getDisableOnTier()
        : 4;
    const trackerSnapshot = this.ctx.ddaTracker.getSnapshot();
    const companionCount = this.ctx.companionManager.count;
    const isSmallMap = this.ctx.mapSizeScaleFactor < 1.0;
    const legacyDominanceHpMultiplier = this.ctx.ddaSpawnModifier.getDominanceHpMultiplier(
      0,
      companionCount,
      isSmallMap,
    );
    const activeEnemies = this.ctx.enemySpawner.getEnemies().filter((enemy) => enemy.active);
    const enemiesByTier: Record<string, number> = {};
    const enemiesByType: Record<string, number> = {};
    let totalHealth = 0;
    let maxHealth = 0;
    let maxTier = 0;

    for (const enemy of activeEnemies) {
      const tier = enemy.difficultyTier?.tier ?? 0;
      const type = enemy.baseTypeName || enemy.constructor.name.toLowerCase();
      enemiesByTier[String(tier)] = (enemiesByTier[String(tier)] ?? 0) + 1;
      enemiesByType[type] = (enemiesByType[type] ?? 0) + 1;
      totalHealth += enemy.maxHealth;
      maxHealth = Math.max(maxHealth, enemy.maxHealth);
      maxTier = Math.max(maxTier, tier);
    }

    const pickupSpawner = this.ctx.pickupSpawner as any;
    const renderer = this.ctx.game.renderer;
    const dominance = this.ctx.playerPowerRuntime?.breakdown;
    const dominanceBonus = dominance?.difficultyBonus ?? 0;
    const assistance = {
      level: this.ctx.ddaEngine.getDDALevel(0),
      smoothLevel: this.ctx.ddaEngine.getDDALevelSmooth(0),
      speedAid: this.ctx.ddaEngine.getSpeedMultiplier(0),
      struggleComposite: this.ctx.ddaEngine.getCompositeScore(0),
    };
    const pressure = {
      baseDifficulty: Math.max(0, difficultyLevel - dominanceBonus),
      dominanceBonus,
      finalDifficulty: difficultyLevel,
      enemyCap: this.ctx.enemySpawner.getMaxActiveEnemies(),
      spawnInterval: Math.max(0, Number(waveScheduler?.endlessNextSpawn ?? 0)
        - Number(waveScheduler?.getElapsed?.() ?? 0)),
      enemyCount: activeEnemies.length,
      aggregateHealth: totalHealth,
      maxTier,
    };

    return {
      path: 'sp-main-game-loop',
      time: this.ctx.game.clock.totalTime,
      frame: this.frameCount,
      surface: String(this.ctx.surfaceType),
      wave: {
        current: typeof waveScheduler?.getCurrentWave === 'function' ? waveScheduler.getCurrentWave() : 0,
        elapsed: typeof waveScheduler?.getElapsed === 'function' ? waveScheduler.getElapsed() : 0,
      },
      difficulty: {
        level: difficultyLevel,
        tier: Math.floor(difficultyLevel),
        assistanceDisableOnTier,
        assistanceShouldBeDisabled: difficultyLevel >= assistanceDisableOnTier,
      },
      assistance,
      dominance,
      pressure,
      player: {
        score: this.ctx.player.score,
        lives: this.ctx.player.lives,
        alive: this.ctx.player.alive,
        powerLevel: this.ctx.playerLevel.level,
        totalKills: this.ctx.playerLevel.totalKills,
        buffPower: this.ctx.buffManager.getTotalBuffPower(),
        activeBuffs: this.ctx.buffManager.getActiveBuffs().map((buff) => `${buff.type}:${buff.stacks}`),
        companions: companionCount,
        companionCounts: this.ctx.companionManager.getCompanionCounts(),
        currentWeapon: this.ctx.weaponManager.getCurrentWeapon(),
        activeNodes: this.getActiveNodes(),
      },
      dda: {
        enabled: this.ctx.ddaEngine.isEnabled(),
        assistanceLevel: this.ctx.ddaEngine.getDDALevel(0),
        assistanceLevelSmooth: this.ctx.ddaEngine.getDDALevelSmooth(0),
        speedMultiplier: this.ctx.ddaEngine.getSpeedMultiplier(0),
        compositeScore: this.ctx.ddaEngine.getCompositeScore(0),
        tracker: {
          killRate: trackerSnapshot.killRate,
          deathRate: trackerSnapshot.deathRate,
          scoreRate: trackerSnapshot.scoreRate,
          closeCallFreq: trackerSnapshot.closeCallFreq,
          avgEnemyProximity: trackerSnapshot.avgEnemyProximity,
          timeAtLowHealth: trackerSnapshot.timeAtLowHealth,
          warmedUp: this.ctx.ddaTracker.isWarmedUp,
          totalKills: this.ctx.ddaTracker.totalKills,
          totalDeaths: this.ctx.ddaTracker.totalDeaths,
        },
        dominanceHpMultiplier: dominance?.hpMultiplier ?? legacyDominanceHpMultiplier,
        isSmallMap,
      },
      spawner: {
        activeEnemyCount: this.ctx.enemySpawner.getActiveCount(),
        maxActiveEnemies: this.ctx.enemySpawner.getMaxActiveEnemies(),
        pickupRates: {
          superState: pickupSpawner.superStateDropRate,
          weapon: pickupSpawner.weaponDropRate,
          oldBuff: pickupSpawner.oldBuffDropRate,
          companion: pickupSpawner.companionDropRate,
          heal: pickupSpawner.healDropRate,
          shield: pickupSpawner.shieldDropRate,
        },
      },
      enemies: {
        active: activeEnemies.length,
        byTier: enemiesByTier,
        byType: enemiesByType,
        maxTier,
        avgMaxHealth: activeEnemies.length > 0 ? totalHealth / activeEnemies.length : 0,
        maxHealth,
        sample: activeEnemies.slice(0, 16).map((enemy) => ({
          type: enemy.baseTypeName || enemy.constructor.name.toLowerCase(),
          health: enemy.health,
          maxHealth: enemy.maxHealth,
          tier: enemy.difficultyTier?.tier ?? 0,
          tierName: enemy.difficultyTier?.name ?? 'Normal',
          materializing: enemy.isMaterializing,
        })),
      },
      renderer: {
        backend: (this.ctx.game as any).backend ?? 'unknown',
        isWebGPU: Boolean((this.ctx.game as any).isWebGPU),
        fixedFps: 1 / this.ctx.game.clock.fixedDeltaTime,
        pixelRatio: renderer.getPixelRatio(),
      },
    };
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

  /** Get live weapon projectile/effect state for browser proof scripts. */
  getWeaponRuntimeSnapshot(): WeaponRuntimeSnapshot {
    const weaponManager = this.ctx.weaponManager as any;
    const projectiles = (weaponManager.projectiles ?? []) as any[];
    const activeEffects = (weaponManager.activeEffects ?? []) as any[];
    const visualRoot = weaponManager.projectileRoot
      ?? (typeof this.ctx.weaponManager.getVisualRoot === 'function'
        ? this.ctx.weaponManager.getVisualRoot()
        : null);

    return {
      currentWeapon: this.ctx.weaponManager.getCurrentWeapon(),
      inventory: this.ctx.weaponManager.getInventory().map((entry) => ({
        type: entry.type,
        ammo: entry.ammo,
        stacks: entry.stacks,
      })),
      bulletCount: this.ctx.bulletPool.activeCount,
      bullets: this.getBulletTrajectories(),
      projectileCount: projectiles.length,
      projectiles: projectiles.slice(0, 24).map((projectile) => ({
        type: String(projectile.type ?? 'unknown'),
        position: this.toVec3(projectile.position),
        direction: this.toVec3(projectile.direction),
        age: Number(projectile.age ?? 0),
        maxAge: Number(projectile.maxAge ?? 0),
        damage: Number(projectile.damage ?? 0),
        speed: Number(projectile.speed ?? 0),
      })),
      effectCount: activeEffects.length,
      effects: activeEffects.slice(0, 24).map((effect) => ({
        type: String(effect.type ?? 'unknown'),
        position: this.toVec3(effect.position),
        direction: effect.direction ? this.toVec3(effect.direction) : null,
        duration: Number(effect.duration ?? 0),
        elapsed: Number(effect.elapsed ?? 0),
        beamPointCount: Array.isArray(effect.beamPoints) ? effect.beamPoints.length : 0,
        phase: effect.blackHolePhase ? String(effect.blackHolePhase) : null,
        radius: Number(effect.blackHoleRadius ?? 0),
        affectedCount: Number(effect.blackHoleAffectedCount ?? 0),
        visualChildCount: Number(effect.blackHoleVisual?.root?.children?.length ?? 0),
      })),
      visualRootChildren: weaponManager.projectileRoot?.children?.length ?? visualRoot?.children?.length ?? 0,
      blackHoleMeshCount: activeEffects
        .filter((effect) => effect.type === 'blackhole')
        .reduce((count, effect) => count + Number(effect.blackHoleVisual?.root?.children?.length ?? 0), 0),
    };
  }

  /** Clear WeaponManager projectiles/effects through the production lifecycle. */
  clearWeaponEffects(): void {
    this.ctx.weaponManager.clear();
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

  /**
   * Query recorded game events between two precise timestamps.
   * @param startTime performance.now()-based timestamp (inclusive)
   * @param endTime   performance.now()-based timestamp (inclusive)
   */
  getEventsBetween(startTime: number, endTime: number) {
    return this.stateRecorder.getEventsBetween(startTime, endTime);
  }

  /**
   * Query recorded game events by type.
   * @param type Event type to filter for
   */
  getEventsOfType(type: string) {
    return this.stateRecorder.getEvents(type);
  }

  /**
   * Query recorded game events near a UV position.
   * @param u Target U in [0,1]
   * @param v Target V in [0,1]
   * @param radius Max UV distance
   */
  getEventsNear(u: number, v: number, radius: number) {
    return this.stateRecorder.getEventsNear(u, v, radius);
  }

  /**
   * Get the complete recording snapshot for embedding in HTML reports.
   * Returns frames + events + summary as a single JSON-serializable object.
   */
  getFullRecording() {
    return this.stateRecorder.getFullRecording();
  }

  /** Get the ScenarioEngine instance. */
  getScenarioEngine(): ScenarioEngine {
    return this.scenarioEngine;
  }

  // -----------------------------------------------------------------------
  // Performance profiling (s44r13-03)
  // -----------------------------------------------------------------------

  /**
   * Get performance profile: top CPU sections, GC pressure, and frame timings.
   * Only meaningful after at least a few seconds of gameplay.
   */
  getPerformanceProfile(): PerformanceProfile {
    return this.performanceProfiler.getProfile();
  }

  /** Reset the performance profiler (call before starting a perf measurement window). */
  resetPerformanceProfile(): void {
    this.performanceProfiler.reset();
  }

  // -----------------------------------------------------------------------
  // KOTH mode API (s44r13-07)
  // -----------------------------------------------------------------------

  /**
   * Get the current KOTH (King Mode) zone state.
   * Returns null if the game is not in KOTH/King mode.
   */
  getKOTHZoneState(): {
    zoneU: number;
    zoneV: number;
    zoneRadiusUV: number;
    zoneTimeSeconds: number;
    inZone: boolean;
    zoneTimer: number;
  } | null {
    const mode = this.ctx.quickGameMode as any;
    if (!mode || typeof mode.zoneU === 'undefined') return null;
    return {
      zoneU: mode.zoneU,
      zoneV: mode.zoneV,
      zoneRadiusUV: mode.zoneRadiusUV,
      zoneTimeSeconds: mode.zoneTimeSeconds,
      inZone: mode.inZone,
      zoneTimer: mode.zoneTimer,
    };
  }

  /** Returns whether the local player is currently inside the KOTH capture zone. */
  isPlayerInZone(): boolean {
    const mode = this.ctx.quickGameMode as any;
    if (!mode || typeof mode.inZone === 'undefined') return false;
    return mode.inZone;
  }

  /**
   * Force-set the KOTH zone position (for deterministic testing).
   * Resets the zone move timer to a large value so the zone won't move during the test.
   * Only works when in KOTH/King mode.
   */
  setKOTHZonePosition(u: number, v: number): void {
    const mode = this.ctx.quickGameMode as any;
    if (!mode || typeof mode.zoneU === 'undefined') return;
    mode.zoneU = u;
    mode.zoneV = v;
    // Prevent zone from moving for 60 seconds during test
    mode.zoneTimer = 60;
  }

  /**
   * Get the current KOTH zone score (zone time in centiseconds, matching getScore() output).
   * Returns -1 if not in KOTH mode.
   */
  getKOTHScore(): number {
    const mode = this.ctx.quickGameMode as any;
    if (!mode || typeof mode.zoneTimeSeconds === 'undefined') return -1;
    return Math.round(mode.zoneTimeSeconds * 100);
  }

  /**
   * Get current camera state (position, up, quaternion, distance to player).
   * Returns null if camera not available.
   */
  getCameraState(): { position: { x: number; y: number; z: number }; up: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number }; distanceToPlayer: number } | null {
    try {
      const cam = this.ctx.game.camera;
      const playerPos = this.ctx.player.mesh?.position;
      const dist = playerPos ? cam.position.distanceTo(playerPos) : -1;
      const q = (cam as any).quaternion;
      return {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        up: { x: cam.up.x, y: cam.up.y, z: cam.up.z },
        quaternion: q ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: 0, y: 0, z: 0, w: 1 },
        distanceToPlayer: dist,
      };
    } catch {
      return null;
    }
  }

  /**
   * Capture the real SP GameLoop path frame used by visual parity probes.
   * This is test/debug-only data; it does not drive gameplay.
   */
  getParityFrame(): any {
    try {
      const cam = this.ctx.game.camera;
      cam.updateMatrixWorld();
      const player = this.ctx.player;
      const walker = this.ctx.playerWalker;
      const frame = walker.getTangentFrame();
      const inputState = this.ctx.input.getState();
      const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const projectedRight = camRight.clone().addScaledVector(walker.normal, -camRight.dot(walker.normal));
      const projectedUp = camUp.clone().addScaledVector(walker.normal, -camUp.dot(walker.normal));
      if (projectedRight.lengthSq() > 0.0001) projectedRight.normalize();
      if (projectedUp.lengthSq() > 0.0001) projectedUp.normalize();
      const cameraToPlayer = cam.position.clone().sub(walker.position);
      const renderer = this.ctx.game.renderer;
      const size = new THREE.Vector2();
      renderer.getSize(size);
      const bullets = this.getBulletTrajectories();
      return {
        path: 'sp-main-game-loop',
        time: this.ctx.game.clock.totalTime,
        frame: this.frameCount,
        surface: { type: String(this.ctx.surfaceType) },
        renderer: {
          backend: (this.ctx.game as any).backend ?? 'unknown',
          isWebGPU: Boolean((this.ctx.game as any).isWebGPU),
          pixelRatio: renderer.getPixelRatio(),
          width: size.x,
          height: size.y,
        },
        player: {
          u: player.surfaceU,
          v: player.surfaceV,
          worldPos: { x: walker.position.x, y: walker.position.y, z: walker.position.z },
          meshWorldPos: { x: player.mesh.position.x, y: player.mesh.position.y, z: player.mesh.position.z },
          normal: { x: walker.normal.x, y: walker.normal.y, z: walker.normal.z },
          tangent: { x: frame.tangent.x, y: frame.tangent.y, z: frame.tangent.z },
          bitangent: { x: frame.bitangent.x, y: frame.bitangent.y, z: frame.bitangent.z },
          faceIndex: walker.faceIndex,
          aimAngle: player.aimAngle,
          alive: player.alive,
          lives: player.lives,
        },
        camera: {
          position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
          quaternion: { x: cam.quaternion.x, y: cam.quaternion.y, z: cam.quaternion.z, w: cam.quaternion.w },
          up: { x: cam.up.x, y: cam.up.y, z: cam.up.z },
          right: { x: camRight.x, y: camRight.y, z: camRight.z },
          matrixUp: { x: camUp.x, y: camUp.y, z: camUp.z },
          projectedRight: { x: projectedRight.x, y: projectedRight.y, z: projectedRight.z },
          projectedUp: { x: projectedUp.x, y: projectedUp.y, z: projectedUp.z },
          distanceToPlayer: cameraToPlayer.length(),
          outsideSurfaceDot: cameraToPlayer.dot(walker.normal),
          targetUp: {
            x: this.ctx.cameraController.targetUp.x,
            y: this.ctx.cameraController.targetUp.y,
            z: this.ctx.cameraController.targetUp.z,
          },
        },
        aim: {
          input: inputState,
          aimAngle: player.aimAngle,
          latestBullet: bullets.length > 0 ? bullets[bullets.length - 1] : null,
          bulletCount: bullets.length,
        },
        movement: {
          input: { moveX: inputState.moveX, moveY: inputState.moveY },
          faceIndex: walker.faceIndex,
        },
        portals: {
          active: this.ctx.portals.length > 0,
          count: this.ctx.portals.length,
        },
      };
    } catch (err) {
      return { path: 'sp-main-game-loop', error: err instanceof Error ? err.message : String(err) };
    }
  }

  // -----------------------------------------------------------------------
  // Frame update — called every game tick when testMode=true
  // -----------------------------------------------------------------------

  /** Called every fixed-update frame. Drives test-directed enemy movement + event tracking. */
  update(): void {
    // --- Begin performance frame ---
    this.performanceProfiler.beginFrame();

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

      // Move in UV space toward target, then compute world position from UV.
      // Previous approach (world-space straight-line) fails on tube-like surfaces
      // (cube-ring, torus) where the target is on the other side of the cross-section:
      // the straight line goes through empty space and projects back to the same point.
      // UV interpolation follows the surface correctly on all geometries.
      //
      // CRITICAL: Track our own UV position independently of surfacePosition.
      // The game loop's enemy AI (walker.move toward player) runs BEFORE this update,
      // overwriting surfacePosition. If we read surfacePosition, we get the game-loop's
      // position (moved toward player), not our last-set position. This creates a
      // tug-of-war where the game fights the harness. By tracking __testUV separately,
      // we interpolate from OUR last position, ignoring the game loop's interference.
      const tracked = (enemy as any).__testUV as { u: number; v: number } | undefined;
      const curU = tracked ? tracked.u : enemy.surfacePosition.u;
      const curV = tracked ? tracked.v : enemy.surfacePosition.v;
      let du = target.u - curU;
      let dv = target.v - curV;

      // Handle wrapping for surfaces that wrap in U (torus, cube-ring, Mobius, etc.)
      const surface = this.ctx.surface;
      if (surface.wrapsU) {
        if (du > 0.5) du -= 1;
        else if (du < -0.5) du += 1;
      }
      if (surface.wrapsV) {
        if (dv > 0.5) dv -= 1;
        else if (dv < -0.5) dv += 1;
      }

      const uvDist = Math.sqrt(du * du + dv * dv);
      if (uvDist < 0.01) {
        // Arrived — snap to exact target and HOLD there.
        // Don't clear __testTarget: clearing would let the game loop's AI
        // immediately move the enemy away from the target before the scenario
        // harness polls getEnemyPosition (100ms later = 6 frames of drift).
        (enemy as any).__testUV = { u: target.u, v: target.v };
        enemy.surfacePosition.u = target.u;
        enemy.surfacePosition.v = target.v;
        const snapSP = surface.getPoint(target.u, target.v);
        const snapWorld = snapSP.position.clone().applyQuaternion(surface.worldRotation);
        if (enemy.mesh) enemy.mesh.position.copy(snapWorld);
        enemy.position.copy(snapWorld);
        if (enemy.walker) {
          const closest = this.ctx.meshSurface.closestPointOnSurface(snapWorld);
          if (closest) enemy.walker.teleportTo(closest.point, closest.faceIndex, closest.normal);
        }
        continue;
      }

      // Compute world-space distance for speed scaling.
      // Use the UV Jacobian to estimate world-space step from UV step.
      // Use a large step to move quickly — the game loop's own AI fights us each frame,
      // so we need to overwhelm it by converging in a few frames rather than many.
      const uvStep = Math.min(target.speed * dt * 2.0, uvDist);
      const ratio = uvStep / uvDist;
      let newU = curU + du * ratio;
      let newV = curV + dv * ratio;

      // Wrap UV coordinates
      if (surface.wrapsU) {
        newU = ((newU % 1) + 1) % 1;
      } else {
        newU = Math.max(0, Math.min(1, newU));
      }
      if (surface.wrapsV) {
        newV = ((newV % 1) + 1) % 1;
      } else {
        newV = Math.max(0, Math.min(1, newV));
      }

      // Store our tracked UV for next frame (independent of game loop)
      (enemy as any).__testUV = { u: newU, v: newV };
      enemy.surfacePosition.u = newU;
      enemy.surfacePosition.v = newV;

      // Sync world position from UV
      const newSP = surface.getPoint(newU, newV);
      const worldPos = newSP.position.clone().applyQuaternion(surface.worldRotation);
      if (enemy.mesh) {
        enemy.mesh.position.copy(worldPos);
      }
      enemy.position.copy(worldPos);
      // Sync the walker's full geodesic state (position + facePos + normal).
      // Just copying walker.position leaves _facePos stale — on the next frame,
      // walker.move() starts from the old _facePos and snaps back, undoing the
      // test harness's position override. teleportTo() resets ALL internal state.
      if (enemy.walker) {
        const closest = this.ctx.meshSurface.closestPointOnSurface(worldPos);
        if (closest) {
          enemy.walker.teleportTo(closest.point, closest.faceIndex, closest.normal);
        } else {
          enemy.walker.position.copy(worldPos);
        }
      }
    }

    // --- Death detection ---
    const currentlyAlive = player.alive;
    if (this.prevAlive && !currentlyAlive) {
      const pPos = player.mesh.position;
      let nearestType = 'unknown';
      let nearestDist = Infinity;
      let nearestEnemyU = 0;
      let nearestEnemyV = 0;
      for (const e of enemySpawner.getEnemies()) {
        if (!e.active || !e.mesh) continue;
        const d = pPos.distanceTo(e.mesh.position);
        if (d < nearestDist) {
          nearestDist = d;
          nearestType = e.baseTypeName || e.constructor.name;
          nearestEnemyU = e.surfacePosition.u;
          nearestEnemyV = e.surfacePosition.v;
        }
      }
      // UV-space distance to nearest enemy
      const dU = nearestEnemyU - player.surfaceU;
      const dV = nearestEnemyV - player.surfaceV;
      const uvDist = Math.sqrt(dU * dU + dV * dV);
      // Collision radius from collision system (if available)
      const collisionSystem = (this.ctx as any).collisionSystem;
      const collisionRadius = collisionSystem?.playerRadius ?? -1;

      this.deathLog.push({
        time,
        frame: this.frameCount,
        preciseTime: performance.now(),
        playerU: player.surfaceU,
        playerV: player.surfaceV,
        playerWorldPos: { x: pPos.x, y: pPos.y, z: pPos.z },
        nearestEnemyDist: nearestDist === Infinity ? -1 : nearestDist,
        nearestEnemyType: nearestType,
        nearestEnemyU,
        nearestEnemyV,
        uvDistance: uvDist,
        collisionRadius,
        livesRemaining: player.lives,
      });
    }
    this.prevAlive = currentlyAlive;

    // --- Tick StateRecorder (frame-by-frame state capture) ---
    this.stateRecorder.update();

    // --- Tick ScenarioEngine (timeline-based scenario execution) ---
    this.scenarioEngine.tick(this.frameCount, time);

    // --- Tick PerformanceProfiler (commit frame, harvest core profiler section data) ---
    // The core profiler (src/core/PerformanceProfiler) already wraps ALL GameLoop sections.
    // Record each section's totalMs for this frame in the debug profiler via direct feed.
    const coreFrameData = coreProfiler.getFrameData();
    for (const scope of coreFrameData) {
      this.performanceProfiler.recordSection(scope.label, scope.totalMs);
    }
    this.performanceProfiler.endFrame();

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

  private getEnemyInfoById(id: string): EnemyInfo | null {
    return this.getEnemies().find((enemy) => enemy.id === id) ?? null;
  }

  private getFireDirection(origin: THREE.Vector3, targetEnemyId?: string): THREE.Vector3 {
    if (targetEnemyId) {
      const enemy = this.findEnemyById(targetEnemyId);
      const targetPosition = enemy?.mesh ? enemy.mesh.position : enemy?.position;
      if (targetPosition) {
        const toTarget = targetPosition.clone().sub(origin);
        if (toTarget.lengthSq() > 0.0001) {
          return toTarget.normalize();
        }
      }
    }

    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.ctx.player.mesh.quaternion).normalize();
  }

  private getFireIndicators(
    before: WeaponRuntimeSnapshot,
    after: WeaponRuntimeSnapshot,
    selectedWeapon: string,
  ): string[] {
    const indicators: string[] = [];

    if (after.bulletCount > before.bulletCount) indicators.push('bullet_count_increased');
    if (after.projectileCount > before.projectileCount) indicators.push('projectile_count_increased');
    if (after.effectCount > before.effectCount) indicators.push('effect_count_increased');
    if (after.visualRootChildren > before.visualRootChildren) indicators.push('visual_root_child_count_increased');

    const beforeAmmo = before.inventory.find((entry) => entry.type === selectedWeapon)?.ammo;
    const afterAmmo = after.inventory.find((entry) => entry.type === selectedWeapon)?.ammo;
    if (
      beforeAmmo !== undefined
      && afterAmmo !== undefined
      && beforeAmmo >= 0
      && afterAmmo < beforeAmmo
    ) {
      indicators.push('selected_weapon_ammo_decreased');
    }

    const selectedEffectType = this.getExpectedEffectType(selectedWeapon);
    if (selectedEffectType && after.effects.some((effect) => effect.type === selectedEffectType)) {
      indicators.push(`selected_effect_active:${selectedEffectType}`);
    }

    if (after.projectiles.some((projectile) => projectile.type === selectedWeapon)) {
      indicators.push(`selected_projectile_active:${selectedWeapon}`);
    }

    if (selectedWeapon === WeaponType.Standard && after.bullets.length > before.bullets.length) {
      indicators.push('standard_bullet_active');
    }

    return [...new Set(indicators)];
  }

  private getExpectedEffectType(weaponType: string): string | null {
    switch (weaponType) {
      case WeaponType.LaserBeam:
        return 'laser';
      case WeaponType.TeslaCoil:
        return 'tesla';
      case WeaponType.BlackHole:
        return 'blackhole';
      default:
        return null;
    }
  }

  private toVec3(value: THREE.Vector3 | undefined | null): Vec3 {
    return {
      x: Number(value?.x ?? 0),
      y: Number(value?.y ?? 0),
      z: Number(value?.z ?? 0),
    };
  }

  /**
   * Record a damage event (called externally from collision system hooks).
   * In test mode, the collision system pushes events here.
   * @param extra Optional extended collision data (positions, distances, etc.)
   */
  recordDamage(
    source: string,
    target: string,
    targetId: string,
    position: Vec3,
    extra?: Partial<Pick<DamageEvent, 'bulletPos' | 'enemyPos' | 'distance' | 'collisionRadius' | 'collisionSource' | 'bulletAge' | 'weaponType' | 'damage'>>,
  ): void {
    this.damageLog.push({
      time: this.ctx.game.clock.totalTime,
      frame: this.frameCount,
      preciseTime: performance.now(),
      source,
      target,
      targetId,
      position,
      ...extra,
    });
  }

  // -----------------------------------------------------------------------
  // Test Arena API (s44r33-10a)
  // -----------------------------------------------------------------------

  /**
   * Force-activate mastery upgrade nodes, bypassing kill thresholds and MasteryPointStore.
   * Useful for testing weapon effects in the test arena without grinding kills.
   *
   * Usage: window.__TEST_API.activateNodes(['standard_al_5', 'homing_b_3'])
   */
  activateNodes(nodeIds: string[]): void {
    const tracker = (this.ctx.weaponManager as any).upgradeTracker as any;
    if (!tracker) {
      console.warn('[TestHarnessAPI] activateNodes: upgradeTracker not found on weaponManager');
      return;
    }
    for (const nodeId of nodeIds) {
      let found = false;
      for (const [weaponTypeKey, tree] of Object.entries(UPGRADE_TREES)) {
        const node = (tree as any).nodes.find((n: any) => n.id === nodeId);
        if (node) {
          (tracker as any).activateNode(nodeId, weaponTypeKey);
          found = true;
          break;
        }
      }
      if (!found) {
        console.warn(`[TestHarnessAPI] activateNodes: node '${nodeId}' not found in any tree`);
      }
    }
  }

  /**
   * Get all currently active upgrade node IDs across all weapons.
   * Useful for verifying that activateNodes() worked correctly.
   */
  getActiveNodes(): string[] {
    const tracker = (this.ctx.weaponManager as any).upgradeTracker as any;
    if (!tracker?.activeUpgrades) return [];
    const result: string[] = [];
    for (const nodeSet of (tracker.activeUpgrades as Map<unknown, Set<string>>).values()) {
      for (const nodeId of nodeSet) result.push(nodeId);
    }
    return result;
  }

  /** Configure the reported wave-50 loadout through real SP managers. */
  setupDDAPowerProof(): {
    activeNodes: string[];
    companionCounts: { guardian: number; hunter: number; protector: number };
    score: number;
    totalKills: number;
    stagedWave: number;
  } {
    const marker = '__DDA_POWER_PROOF_CONFIGURED';
    if (!(this as any)[marker]) {
      (this as any)[marker] = true;
      this.activateNodes([
        'standard_a_1', 'standard_a_2', 'standard_a_3',
        'standard_b_1', 'standard_b_2', 'standard_b_3',
      ]);
      this.ctx.player.addScore(Math.max(0, 1_000_000 - this.ctx.player.score));
      while (this.ctx.playerLevel.totalKills < 250) this.ctx.playerLevel.addKill();
      if (this.ctx.playerPowerRuntime) {
        this.ctx.playerPowerRuntime.proofOverride = { survivalSeconds: 600, streak: 250 };
      }
      const waveScheduler = this.ctx.waveScheduler as any;
      waveScheduler.endlessWave = 49;
      waveScheduler.elapsed = 600;
      waveScheduler.endlessNextSpawn = 602;
      (globalThis as any).__GOD_MODE = true;
      this.ctx.player.lives = 3;
    }

    const counts = this.ctx.companionManager.getCompanionCounts();
    if (counts.guardian !== 2 || counts.hunter !== 2 || counts.protector !== 0) {
      this.ctx.companionManager.reset();
      this.ctx.companionManager.addCompanion(CompanionType.Guardian);
      this.ctx.companionManager.addCompanion(CompanionType.Guardian);
      this.ctx.companionManager.addCompanion(CompanionType.Hunter);
      this.ctx.companionManager.addCompanion(CompanionType.Hunter);
    }
    this.ctx.weaponManager.forceSetWeapon(WeaponType.Standard, -1);

    return {
      activeNodes: this.getActiveNodes(),
      companionCounts: this.ctx.companionManager.getCompanionCounts(),
      score: this.ctx.player.score,
      totalKills: this.ctx.playerLevel.totalKills,
      stagedWave: 50,
    };
  }

  /**
   * Spawn a predictable grid of grunt enemies for weapon testing.
   * Clears existing enemies first, then spawns in a uniform UV grid.
   *
   * Usage: window.__TEST_API.spawnGrid() or window.__TEST_API.spawnGrid(3, 3)
   */
  spawnGrid(rows = 5, cols = 5): void {
    this.clearEnemies();
    const padding = 0.15; // keep away from arena edges
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = cols > 1 ? padding + (c / (cols - 1)) * (1 - 2 * padding) : 0.5;
        const v = rows > 1 ? padding + (r / (rows - 1)) * (1 - 2 * padding) : 0.5;
        this.spawnEnemy('grunt', u, v);
      }
    }
  }
}
