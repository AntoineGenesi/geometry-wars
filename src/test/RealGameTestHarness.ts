/**
 * RealGameTestHarness — Tests the ACTUAL GameLoop.ts code path.
 *
 * Unlike PlaygroundTestHarness (which uses PlaygroundGame → GameInstance in demo mode),
 * this harness instantiates the real GameLoop with a full GameContext, identical to main.ts.
 *
 * This means:
 * - Player movement, shooting, aiming all go through GameLoop.update()
 * - Enemy spawning, collision, hit detection use the exact same code as the real game
 * - Camera controller, weapon manager, buff system — all real
 * - Only rendering (WebGLRenderer, GPU instancing, bloom) is mocked
 *
 * Session 19 lesson: PlaygroundTestHarness tested demo mode while real game was broken.
 * This harness ensures we never repeat that — it tests what the user actually plays.
 */

import * as THREE from 'three';
import { Game } from '../core/Game';
import { GameLoop } from '../core/GameLoop';
import type { GameContext } from '../core/GameContext';
import { Player } from '../entities/Player';
import { BulletPool } from '../entities/Bullet';
import { EnemySpawner, EnemyType } from '../entities/enemies/EnemySpawner';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';
import { InputManager } from '../input/InputManager';
import { WeaponManager } from '../weapons/WeaponManager';
import { WeaponType } from '../weapons/WeaponTypes';
import { ParticleSystem } from '../effects/ParticleSystem';
import { ScreenShake } from '../effects/ScreenShake';
import { SurfaceShockwave } from '../effects/SurfaceShockwave';
import { PlasmaExplosionEffect } from '../effects/PlasmaExplosionEffect';
import { ScoreManager } from '../core/ScoreManager';
import { GameMode, GameModeType, ModePhase } from '../core/GameMode';
import { PlayerLevel } from '../core/PlayerLevel';
import { SuperStateManager } from '../weapons/SuperState';
import { CollisionSystem } from '../core/CollisionSystem';
import { PickupSpawner } from '../core/PickupSpawner';
import { CameraController } from '../core/CameraController';
import { BuffManager } from '../buffs/BuffManager';
import { WeaponMasteryManager } from '../buffs/WeaponMasteryManager';
import { CompanionManager } from '../entities/Companion';
import { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';
import { BulletInstanceManager, BulletVisualType } from '../rendering/BulletInstanceManager';
import { LODManager, LODLevel } from '../rendering/LODManager';
import { AdaptiveQuality } from '../rendering/AdaptiveQuality';
import { DepthOcclusionSystem } from '../rendering/DepthOpacity';
import { SpatialHashVisibility } from '../rendering/SpatialHashVisibility';
import { PerformanceTracker } from '../core/PerformanceTracker';
import { ScorePopupManager } from '../effects/ScorePopup';
import { GlowTrail } from '../effects/GlowTrail';
import { EntityGlow, EntityGlowManager, GlowPresets } from '../effects/EntityGlow';
import { DDAPerformanceTracker } from '../difficulty/DDAPerformanceTracker';
import { DDADecisionEngine } from '../difficulty/DDADecisionEngine';
import { DDASpawnModifier } from '../difficulty/DDASpawnModifier';
import { DDALogger } from '../difficulty/DDALogger';
import { EntityAudit } from '../core/EntityAudit';
import { PerformanceLogger } from '../core/PerformanceLogger';
import { EnemyDeathCallbacks } from '../entities/enemies/EnemyDeathCallbacks';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import {
  createStandardSurfaceConfig,
  setupStandardLighting,
  makeSurfaceTransformFn,
} from '../rendering/SharedGameSetup';
import { getMapSizeScaleFactor, MapSize } from '../core/MapSize';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealGameHarnessOptions {
  surface?: SurfaceType;
  weapon?: WeaponType;
  mapSize?: MapSize;
  enemyCount?: number;
  /** Seed for deterministic testing (future use) */
  seed?: number;
  /** Width for camera projection */
  width?: number;
  /** Height for camera projection */
  height?: number;
}

/** Bullet spawn record for origin tracking */
export interface BulletSpawnRecord {
  worldPos: THREE.Vector3;
  direction: THREE.Vector3;
  surfaceUV: { u: number; v: number };
  aimAngle: number;
  playerWorldPos: THREE.Vector3;
  playerUV: { u: number; v: number };
  frame: number;
}

/** Entity surface position info */
export interface EntitySurfaceInfo {
  worldPos: THREE.Vector3;
  surfaceUV: { u: number; v: number };
  surfaceNormal: THREE.Vector3;
  distFromSurface: number;
  surfaceRegion: string;
  isOnSurface: boolean;
  isInsideSurface: boolean;
}

// ---------------------------------------------------------------------------
// Null/Stub implementations for UI-only systems
// ---------------------------------------------------------------------------

/** Stub for UI systems that GameContext requires but don't affect gameplay */
function createStubUI() {
  const noop = () => {};
  const noopRet = (..._: any[]) => ({});
  return {
    minimap: { update: noop, setVisible: noop, dispose: noop } as any,
    killLog: { update: noop, addKill: noop, onKill: null, dispose: noop } as any,
    totalKillCounter: { addKill: noop, getTotalKills: () => 0, hide: noop, dispose: noop } as any,
    weaponHUD: { update: noop, dispose: noop, setPosition: noop, showPickupNotification: noop, showMasteryTierUp: noop } as any,
    companionHUD: { update: noop, dispose: noop } as any,
    buffHUD: { update: noop, highlightBuff: noop, setCompactMode: noop, dispose: noop } as any,
    shockArcRenderer: { update: noop, root: new THREE.Group(), dispose: noop } as any,
    buffAuraRenderer: { update: noop, root: new THREE.Group(), dispose: noop } as any,
    pauseMenu: { show: noop, hide: noop, setIsHost: noop, setIsMultiplayer: noop, setMusic: noop, setPerformanceLogger: noop, setMasteryPointStore: noop, onResume: noop, onExit: noop, onMasteryScreenClose: noop, setVisualMode: noop, onVisualModeChange: noop, setGameData: noop, setPerformanceHTML: noop, dispose: noop } as any,
    gameOverScreen: { show: noop, onContinue: noop, dispose: noop } as any,
    levelCompleteScreen: { show: noop, onNext: noop, onReplay: noop, onMenu: noop, dispose: noop } as any,
    debugOverlay: { show: noop, hide: noop, setRendererBackend: noop, getSummaryHTML: () => '', update: noop, dispose: noop } as any,
    profilingOverlay: { update: noop, dispose: noop } as any,
    profilingPersistence: { stop: noop, flush: () => Promise.resolve(), dispose: noop } as any,
  };
}

// ---------------------------------------------------------------------------
// WaveScheduler (minimal replica of the one defined inside main.ts)
// ---------------------------------------------------------------------------

class TestWaveScheduler {
  private elapsed = 0;
  allSpawned = false;
  playerCount = 1;
  getDifficultyInput: (() => any) | null = null;
  currentDifficultyLevel = 0;

  private manualSpawns: Array<{ type: EnemyType; u: number; v: number }> = [];

  getElapsed() { return this.elapsed; }

  update(dt: number, _enemySpawner: EnemySpawner) {
    this.elapsed += dt;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_MOVE_SPEED = 3.0;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

// ---------------------------------------------------------------------------
// RealGameTestHarness
// ---------------------------------------------------------------------------

export class RealGameTestHarness {
  readonly game: Game;
  readonly gameLoop: GameLoop;
  readonly ctx: GameContext;
  readonly surface: Surface;
  readonly meshSurface: MeshSurface;
  readonly player: Player;
  readonly enemySpawner: EnemySpawner;
  readonly bulletPool: BulletPool;
  readonly playerWalker: MeshWalker;
  readonly weaponManager: WeaponManager;
  readonly waveScheduler: TestWaveScheduler;
  readonly collisionSystem: CollisionSystem;
  readonly surfaceType: SurfaceType;
  readonly width: number;
  readonly height: number;

  private readonly heldKeys = new Set<string>();
  private mouseX: number;
  private mouseY: number;
  private mouseDown = false;
  private _totalFrames = 0;

  /** Records of every bullet spawned, for origin verification */
  readonly bulletSpawnLog: BulletSpawnRecord[] = [];

  constructor(options: RealGameHarnessOptions = {}) {
    const surfaceType = options.surface ?? 'sphere';
    const mapSize = options.mapSize ?? MapSize.MEDIUM;
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;

    this.surfaceType = surfaceType;
    this.width = width;
    this.height = height;
    this.mouseX = width / 2;
    this.mouseY = height / 2;

    // -- Game engine (uses mocked renderer from vi.mock) --
    const game = new Game({
      bloom: { strength: 0.7, radius: 0.5, threshold: 0.6 },
      cameraDistance: 20,
      cameraSmoothing: 0.05,
    });
    game.disableBuiltInCameraUpdate = true;
    this.game = game;

    // -- Surface --
    const surfaceConfig = createStandardSurfaceConfig(surfaceType, 10, null);
    const surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);
    const mapSizeScaleFactor = getMapSizeScaleFactor(mapSize);
    if (mapSizeScaleFactor !== 1.0) {
      surface.group.scale.setScalar(mapSizeScaleFactor);
    }
    game.scene.add(surface.group);
    surface.group.updateMatrixWorld(true);
    this.surface = surface;

    // -- Mesh surface + movement --
    const meshSurface = new MeshSurface(surface.walkableMesh);
    this.meshSurface = meshSurface;

    // -- Depth occlusion (stub — no rendering in tests) --
    const depthOcclusion = new DepthOcclusionSystem({
      opacity0: 1.0, opacity1: 0.12, opacity2Plus: 0.04, lerpSpeed: 10.0,
    });
    depthOcclusion.setSurfaceMesh(surface.mesh);

    const spatialHashVisibility = new SpatialHashVisibility();

    // -- Input (patched to use harness keys) --
    const input = new InputManager();
    this.patchInputManager(input);

    // -- Surface transform --
    const getTransform = makeSurfaceTransformFn(surface, mapSizeScaleFactor);

    // -- Bullet pool --
    const bulletPool = new BulletPool();
    game.scene.add(bulletPool.root);
    bulletPool.setMeshSurface(meshSurface);
    bulletPool.setSurfaceFunctions(
      getTransform,
      (u: number, v: number, du: number, dv: number) => surface.moveOnSurface(u, v, du, dv),
    );
    bulletPool.lifetimeMultiplier = mapSizeScaleFactor;
    // Intercept bullet spawning to log origins
    const originalSpawn = bulletPool.spawn.bind(bulletPool);
    bulletPool.spawn = (origin: THREE.Vector3, direction: THREE.Vector3, u: number, v: number, aimAngle: number) => {
      this.bulletSpawnLog.push({
        worldPos: origin.clone(),
        direction: direction.clone(),
        surfaceUV: { u, v },
        aimAngle,
        playerWorldPos: this.playerWalker.position.clone(),
        playerUV: { u: this.player.surfaceU, v: this.player.surfaceV },
        frame: this._totalFrames,
      });
      return originalSpawn(origin, direction, u, v, aimAngle);
    };
    this.bulletPool = bulletPool;

    // -- Bullet instance manager (stub for tests — no GPU) --
    const bulletInstanceManager = new BulletInstanceManager(game.scene, 200);
    bulletPool.root.visible = false;
    const bulletInstanceIds = new Set<string>();

    // -- Player --
    const player = new Player(bulletPool);
    player.respawn(0.5, 0.5);
    player.lives = 99;
    game.scene.add(player.mesh);
    game.cameraTarget = player.mesh;
    this.player = player;

    // -- Player walker --
    const initialPoint = surface.getPoint(0.5, 0.5);
    const playerWalker = new MeshWalker(meshSurface, initialPoint.position, PLAYER_MOVE_SPEED * mapSizeScaleFactor);
    player.mesh.position.copy(playerWalker.position);
    const initialUV = surface.worldToSurface(playerWalker.position);
    player.surfaceU = initialUV.u;
    player.surfaceV = initialUV.v;
    this.playerWalker = playerWalker;

    // -- Glow trail (lightweight — no rendering) --
    const playerGlowTrail = new GlowTrail(new THREE.Color(GlowPresets.player.color), 60, 0.4);
    game.scene.add(playerGlowTrail.root);
    const glowManager = new EntityGlowManager();
    const playerGlow = new EntityGlow(
      GlowPresets.player.color, GlowPresets.player.size,
      GlowPresets.player.opacity, GlowPresets.player.pulseSpeed, GlowPresets.player.pulseAmount,
    );
    playerGlow.attachTo(player.mesh);

    // -- Enemy spawner --
    const enemySpawner = new EnemySpawner(game.scene, getTransform);
    enemySpawner.setMeshSurface(meshSurface);
    enemySpawner.setSurface(surface);
    enemySpawner.setSurfaceSpeedScale(surface.speedScale / mapSizeScaleFactor);
    this.enemySpawner = enemySpawner;

    // -- Enemy instance manager (stub) --
    const enemyInstanceManager = new EnemyInstanceManager(game.scene);
    enemySpawner.setInstanceManager(enemyInstanceManager);

    // -- DDA --
    const ddaTracker = new DDAPerformanceTracker(0);
    const ddaEngine = new DDADecisionEngine();
    ddaEngine.setEnabled(false); // Disable DDA in tests for determinism
    const ddaSpawnModifier = new DDASpawnModifier(ddaEngine);
    enemySpawner.setDDAModifier(ddaSpawnModifier);
    const ddaPlayers = [{ index: 0, u: 0.5, v: 0.5 }];
    enemySpawner.setDDAPlayers(ddaPlayers);
    const ddaLogger = new DDALogger([ddaTracker], ddaEngine, surfaceType);

    // -- LOD / Quality --
    const lodManager = new LODManager();
    const adaptiveQuality = new AdaptiveQuality();

    // -- Performance tracking --
    const perfTracker = new PerformanceTracker(surfaceType);
    const entityAudit = new EntityAudit();
    const perfLogger = new PerformanceLogger(surfaceType);

    // -- Particles --
    const particles = new ParticleSystem(5000);
    game.scene.add(particles.root);

    // -- Score / popups --
    const scorePopups = new ScorePopupManager();
    game.scene.add(scorePopups.root);
    scorePopups.setCamera(game.camera);
    const scoreManager = new ScoreManager();
    scoreManager.setPlayer(player);

    // -- Player level --
    const playerLevel = new PlayerLevel();
    game.scene.add(playerLevel.auraRing);

    // -- Buffs --
    const buffManager = new BuffManager();
    const weaponMastery = new WeaponMasteryManager();

    // -- Weapons --
    const weaponManager = new WeaponManager();
    weaponManager.setMeshSurface(meshSurface);
    weaponManager.playerPositionRef = playerWalker.position;
    game.scene.add(weaponManager.getVisualRoot());
    this.weaponManager = weaponManager;

    // Wire weapon callbacks (simplified — no sound/popups needed for tests)
    weaponManager.setCallbacks({
      getEnemies: () => enemySpawner.getEnemies()
        .filter(e => e.alive && e.mesh)
        .map((e, i) => ({ position: e.position.clone(), index: i, alive: e.alive })),
      onEnemyDamage: (index: number, damage: number, _weaponType: WeaponType) => {
        const enemies = enemySpawner.getEnemies().filter(e => e.alive && e.mesh);
        const enemy = enemies[index];
        if (!enemy) return;
        enemy.takeDamage(damage);
        if (!enemy.alive) {
          scoreManager.awardKill(enemy.scoreValue, enemy.constructor.name.toLowerCase());
          playerLevel.addKill();
          for (let g = 0; g < enemy.geomCount; g++) scoreManager.collectGeom();
        }
      },
      onEnemyPull: () => {},
      spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => {
        const { u, v } = surface.worldToSurface(origin);
        const aimAngle = Math.atan2(direction.x, direction.z);
        bulletPool.spawn(origin, direction, u, v, aimAngle);
      },
      onProjectileExplosion: () => {},
      onGravityGunMove: () => {},
    });

    // Set initial weapon
    if (options.weapon) {
      weaponManager.forceSetWeapon(options.weapon);
    }

    // -- Screen shake --
    const screenShake = new ScreenShake();

    // -- Surface effects --
    const surfaceShockwave = new SurfaceShockwave(surface);
    const plasmaExplosionEffect = new PlasmaExplosionEffect();
    game.scene.add(plasmaExplosionEffect.root);
    const shockwaveEffect = { spawnShockwave: () => {}, triggerWhiteFlash: () => {}, triggerChromatic: () => {}, update: () => {}, dispose: () => {} } as any;

    // -- Super state --
    const superStateManager = new SuperStateManager();

    // -- Collision system --
    const collisionSystem = new CollisionSystem();
    this.collisionSystem = collisionSystem;

    // -- Pickup spawner --
    const pickupSpawner = new PickupSpawner(game.scene, mapSizeScaleFactor);

    // -- Companions --
    const companionManager = new CompanionManager(mapSizeScaleFactor);
    companionManager.setMeshSurface(meshSurface);
    game.scene.add(companionManager.root);

    // -- Camera controller --
    const cameraController = new CameraController(game.camera);
    // Snap camera to initial position
    const initialFrame = playerWalker.getTangentFrame();
    cameraController.snapToFrame(playerWalker.position, playerWalker.normal, initialFrame);

    // -- Game mode --
    const gameMode = new GameMode({
      type: 'survival' as GameModeType,
      timeLimit: 0,
      lives: 99,
      bombs: 3,
      supers: 0,
      canShoot: true,
      starThresholds: [0, 0, 0],
    });
    // Skip countdown for tests — set phase directly (it's public)
    gameMode.phase = ModePhase.Playing;
    gameMode.countdownTimer = 0;

    // -- Wave scheduler --
    const waveScheduler = new TestWaveScheduler();
    this.waveScheduler = waveScheduler;

    // -- Enemy death callbacks --
    EnemyDeathCallbacks.wire(enemySpawner);

    // -- Mastery levels (empty for tests) --
    const persistentMasteryLevels = new Map<WeaponType, number>();
    for (const type of Object.values(WeaponType)) {
      persistentMasteryLevels.set(type, 0);
    }

    // -- Enemy colors --
    const ENEMY_COLORS: Record<string, THREE.Color> = {
      wanderer: new THREE.Color(0xaa44ff), grunt: new THREE.Color(0x4444ff),
      duck: new THREE.Color(0xff44aa), mayfly: new THREE.Color(0xaaff00),
      rocket: new THREE.Color(0xff8800), neutron: new THREE.Color(0x44dddd),
    };
    const ENEMY_COLOR_FALLBACK = new THREE.Color(0xffffff);

    // -- Weapon to bullet visual mapping --
    function weaponToBulletVisual(weapon: WeaponType): BulletVisualType {
      switch (weapon) {
        case WeaponType.Spread: return BulletVisualType.Spread;
        case WeaponType.Piercing: return BulletVisualType.Piercing;
        case WeaponType.Homing: return BulletVisualType.Homing;
        default: return BulletVisualType.Standard;
      }
    }

    // -- Helper function for stat multipliers --
    const applyStatMultipliers = () => {
      const perk = playerLevel.perk;
      const boostMult = player.boostActive ? 2.0 : 1.0;
      playerWalker.speed = PLAYER_MOVE_SPEED * mapSizeScaleFactor * perk.moveSpeedMultiplier * buffManager.getMoveSpeedMultiplier() * boostMult;
      player.fireRateMultiplier = perk.fireRateMultiplier * buffManager.getFireRateMultiplier();
      bulletPool.speedMultiplier = perk.bulletSpeedMultiplier;
    };

    // -- UI stubs --
    const ui = createStubUI();

    // -- Build GameContext --
    const ctx: GameContext = {
      game,
      player,
      surface,
      surfaceType,
      meshSurface,
      playerWalker,
      input,
      level: {
        id: -1, name: 'TEST', section: 'quick',
        mode: 'survival' as GameModeType, surface: surfaceType as any,
        surfaceScale: 10, timeLimit: 0, lives: 99, bombs: 3, supers: 0,
        starThresholds: [0, 0, 0] as [number, number, number],
        waves: [],
      },
      isEndless: true,
      bulletPool,
      enemySpawner,
      bulletInstanceManager,
      bulletInstanceIds,
      enemyInstanceManager,
      particles,
      screenShake,
      surfaceShockwave,
      plasmaExplosionEffect,
      glowTrail: playerGlowTrail,
      shockwaveEffect,
      scorePopups,
      scoreManager,
      playerLevel,
      weaponManager,
      superManager: superStateManager,
      buffManager,
      weaponMastery,
      companionManager,
      collisionSystem,
      pickupSpawner,
      portals: [],
      cameraController,
      lodManager,
      adaptiveQuality,
      depthOcclusion,
      spatialHashVisibility,
      perfTracker,
      entityAudit,
      perfLogger,
      ddaTracker,
      ddaEngine,
      ddaSpawnModifier,
      ddaLogger,
      ddaPlayers,
      mapSizeScaleFactor,
      persistentMasteryLevels,
      gameMode,
      waveScheduler: waveScheduler as any,
      ...ui,
      getTransform,
      weaponToBulletVisual,
      PLAYER_MOVE_SPEED,
      ENEMY_COLORS,
      ENEMY_COLOR_FALLBACK,
      state: {
        isPaused: false,
        isGameOver: false,
        isLevelComplete: false,
        respawnTimer: 0,
        RESPAWN_DELAY: 1.5,
        prevPlayerU: 0.5,
        prevPlayerV: 0.5,
        painterDamageCooldown: 0,
        lastEnemyCount: 0,
        hadEnemies: false,
        lodAssignments: new Map(),
        tunnelRaycaster: new THREE.Raycaster(),
        currentSurfaceOpacity: 0.05,
        currentGridOpacity: 0.10,
        baseSurfaceOpacity: 0.05,
        baseGridOpacity: 0.10,
        fadeSpeed: 8.0,
        isCurrentlyBlocked: false,
        lastRenderTime: 0,
        auditFrameCounter: 0,
        perfEnemyTypeMap: new Map(),
        perfEnemyTypeCounter: 0,
        perfBuffString: '',
        perfBuffStringCounter: 0,
      },
    };
    this.ctx = ctx;

    // -- GameLoop --
    const gameLoop = new GameLoop();
    gameLoop.setDependencies({
      playerGlowTrail,
      glowManager,
      playerGlow,
      bgMusic: { play: () => {}, stop: () => {}, volume: 0, isPlaying: false, setIntensity: () => {} },
      sound: { play: () => {}, init: () => {}, resume: () => {}, muted: false },
      applyStatMultipliers,
    });
    this.gameLoop = gameLoop;
  }

  // =======================================================================
  // Frame Advancement
  // =======================================================================

  /** Advance N frames at fixed dt (default 1/60s). */
  tick(frames = 1, dt = 1 / 60): void {
    for (let i = 0; i < frames; i++) {
      (this.game.clock as any).totalTime += dt;
      this.gameLoop.update(this.ctx, dt);
      this._totalFrames++;
    }
  }

  /** Advance T seconds of game time (at 60fps). */
  tickSeconds(seconds: number): void {
    this.tick(Math.round(seconds * 60));
  }

  /** Advance until predicate returns true, or maxFrames reached. Returns frame# or -1. */
  tickUntil(predicate: () => boolean, maxFrames = 1000): number {
    for (let i = 0; i < maxFrames; i++) {
      this.tick(1);
      if (predicate()) return i;
    }
    return -1;
  }

  /** Total frames ticked since construction. */
  get totalFrames(): number { return this._totalFrames; }

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
    return this.player.mesh.position.clone();
  }

  getPlayerSurfaceUV(): { u: number; v: number } {
    return { u: this.player.surfaceU, v: this.player.surfaceV };
  }

  getEnemyWorldPositions(): THREE.Vector3[] {
    return this.enemySpawner.getEnemies()
      .filter(e => e.alive && e.active)
      .map(e => e.position.clone());
  }

  getBulletWorldPositions(): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    this.bulletPool.forEachActive((_idx, pos) => {
      positions.push(pos.clone());
    });
    return positions;
  }

  getCameraState() {
    const cam = this.game.camera;
    return {
      position: cam.position.clone(),
      up: cam.up.clone(),
      quaternion: cam.quaternion.clone(),
    };
  }

  // =======================================================================
  // Entity Position Inspector (EntitySurfaceInfo API)
  // =======================================================================

  /**
   * Get detailed surface position info for any world-space position on any surface.
   * This is the core coordinate reverse-engineering API.
   */
  getEntitySurfaceInfo(worldPos: THREE.Vector3): EntitySurfaceInfo {
    // Find closest point on mesh surface
    const query = this.meshSurface.closestPointOnSurface(worldPos);
    if (!query) {
      return {
        worldPos: worldPos.clone(),
        surfaceUV: { u: 0, v: 0 },
        surfaceNormal: new THREE.Vector3(0, 1, 0),
        distFromSurface: Infinity,
        surfaceRegion: 'unknown',
        isOnSurface: false,
        isInsideSurface: false,
      };
    }

    // Get UV coordinates by reverse-engineering through Surface.worldToSurface
    const inverseRot = this.surface.worldRotation.clone().invert();
    const localPos = worldPos.clone().applyQuaternion(inverseRot);
    const uv = this.surface.worldToSurface(localPos);

    // Compute distance from surface (signed: negative = inside)
    const toEntity = new THREE.Vector3().subVectors(worldPos, query.point);
    const signedDist = toEntity.dot(query.normal);
    const dist = Math.abs(signedDist);

    // Determine surface region
    const region = this.classifySurfaceRegion(this.surfaceType, uv.u, uv.v);

    const SURFACE_TOLERANCE = 0.5; // world units

    return {
      worldPos: worldPos.clone(),
      surfaceUV: uv,
      surfaceNormal: query.normal.clone(),
      distFromSurface: dist,
      surfaceRegion: region,
      isOnSurface: dist < SURFACE_TOLERANCE,
      isInsideSurface: signedDist < -SURFACE_TOLERANCE,
    };
  }

  /** Get surface info for the player */
  getPlayerSurfaceInfo(): EntitySurfaceInfo {
    return this.getEntitySurfaceInfo(this.playerWalker.position);
  }

  /** Get surface info for all alive enemies */
  getEnemySurfaceInfos(): EntitySurfaceInfo[] {
    return this.enemySpawner.getEnemies()
      .filter(e => e.alive && e.active)
      .map(e => this.getEntitySurfaceInfo(e.position));
  }

  /** Get surface info for all active bullets */
  getBulletSurfaceInfos(): EntitySurfaceInfo[] {
    const infos: EntitySurfaceInfo[] = [];
    this.bulletPool.forEachActive((_idx, pos) => {
      infos.push(this.getEntitySurfaceInfo(pos));
    });
    return infos;
  }

  // =======================================================================
  // Enemy Spawning (for tests)
  // =======================================================================

  /** Spawn an enemy at specific UV coordinates */
  spawnEnemy(type: EnemyType, u: number, v: number): void {
    this.enemySpawner.spawn(type, u, v);
  }

  /** Get all alive enemies */
  getEnemies(): BaseEnemy[] {
    return this.enemySpawner.getEnemies().filter(e => e.alive);
  }

  // =======================================================================
  // Bullet Origin Verification
  // =======================================================================

  /** Clear the bullet spawn log */
  clearBulletLog(): void {
    this.bulletSpawnLog.length = 0;
  }

  /**
   * Get the last N bullet spawn records.
   * Each record contains the exact world position and UV where the bullet was created,
   * plus the player's position at that moment, for comparison.
   */
  getRecentBullets(count = 10): BulletSpawnRecord[] {
    return this.bulletSpawnLog.slice(-count);
  }

  /**
   * Assert that recent bullets originated near the player position.
   * Returns { passed, maxDistance, details } for each bullet.
   */
  verifyBulletOrigins(tolerance = 1.5): { passed: boolean; maxDistance: number; details: Array<{ bulletPos: THREE.Vector3; playerPos: THREE.Vector3; distance: number }> } {
    const details: Array<{ bulletPos: THREE.Vector3; playerPos: THREE.Vector3; distance: number }> = [];
    let maxDistance = 0;

    for (const record of this.bulletSpawnLog) {
      const dist = record.worldPos.distanceTo(record.playerWorldPos);
      maxDistance = Math.max(maxDistance, dist);
      details.push({
        bulletPos: record.worldPos,
        playerPos: record.playerWorldPos,
        distance: dist,
      });
    }

    return {
      passed: maxDistance <= tolerance,
      maxDistance,
      details,
    };
  }

  // =======================================================================
  // Private helpers
  // =======================================================================

  /** Classify which region of the surface a UV coordinate is in */
  private classifySurfaceRegion(type: SurfaceType, u: number, v: number): string {
    switch (type) {
      case 'torus': {
        // u = around tube, v = around ring
        // "inner" is where the tube faces inward (u near 0.5 on typical parameterization)
        const uNorm = ((u % 1) + 1) % 1;
        if (uNorm > 0.25 && uNorm < 0.75) return 'torus-inner';
        return 'torus-outer';
      }
      case 'cube':
      case 'cube-tunnel':
      case 'cube-ring': {
        // Cube faces: 6 faces mapped to UV
        if (v < 1/6) return 'cube-bottom';
        if (v < 2/6) return 'cube-front';
        if (v < 3/6) return 'cube-right';
        if (v < 4/6) return 'cube-back';
        if (v < 5/6) return 'cube-left';
        return 'cube-top';
      }
      case 'sphere':
      case 'sphere-tunnel': {
        if (v < 0.15) return 'sphere-south-pole';
        if (v > 0.85) return 'sphere-north-pole';
        return 'sphere-equator';
      }
      case 'pill':
      case 'capsule': {
        if (v < 0.15) return 'pill-pole-south';
        if (v > 0.85) return 'pill-pole-north';
        return 'pill-cylinder';
      }
      case 'peanut': {
        if (v < 0.15) return 'peanut-pole-south';
        if (v > 0.85) return 'peanut-pole-north';
        if (v > 0.4 && v < 0.6) return 'peanut-waist';
        return 'peanut-lobe';
      }
      case 'mobius':
      case 'mobius-bevel':
        return 'mobius-strip';
      case 'pipe':
        return 'pipe-body';
      case 'icosahedron':
        return 'icosahedron-face';
      default:
        return `${type}-unknown`;
    }
  }

  /** Patch InputManager to read from harness state */
  private patchInputManager(input: InputManager): void {
    const self = this;
    (input as any).getState = function () {
      // Convert held keys to movement axes
      let moveX = 0, moveY = 0;
      if (self.heldKeys.has('a') || self.heldKeys.has('arrowleft')) moveX -= 1;
      if (self.heldKeys.has('d') || self.heldKeys.has('arrowright')) moveX += 1;
      if (self.heldKeys.has('w') || self.heldKeys.has('arrowup')) moveY -= 1;
      if (self.heldKeys.has('s') || self.heldKeys.has('arrowdown')) moveY += 1;

      // Normalize diagonal
      const len = Math.sqrt(moveX * moveX + moveY * moveY);
      if (len > 1) { moveX /= len; moveY /= len; }

      // Mouse aim: convert screen position to -1..1 range from center
      const aimX = (self.mouseX - self.width / 2) / (self.width / 2);
      const aimY = (self.mouseY - self.height / 2) / (self.height / 2);

      return {
        moveX,
        moveY,
        aimX,
        aimY,
        shooting: self.mouseDown,
        bomb: self.heldKeys.has(' '),
        boost: self.heldKeys.has('shift'),
        weaponSwap: false,
      };
    };
    (input as any).endFrame = function () {};
  }
}
