/**
 * RealGameTestHarness — Tests the ACTUAL GameLoop.ts code path.
 *
 * This harness instantiates the real GameLoop with a full GameContext, identical to main.ts.
 *
 * This means:
 * - Player movement, shooting, aiming all go through GameLoop.update()
 * - Enemy spawning, collision, hit detection use the exact same code as the real game
 * - Camera controller, weapon manager, buff system — all real
 * - Only rendering (WebGLRenderer, GPU instancing, bloom) is mocked
 *
 * This is the ONLY test harness. It replaces the old PlaygroundTestHarness which tested
 * through PlaygroundGame → GameInstance (demo mode) instead of the real game.
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
import { setGameSeed, clearGameSeed } from '../core/SeededRandom';
import { EffectDictionary } from '../core/EffectDictionary';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealGameHarnessOptions {
  surface?: SurfaceType;
  weapon?: WeaponType | null;
  mapSize?: MapSize;
  enemyCount?: number;
  /** Seed for deterministic testing */
  seed?: number;
  /** Width for camera projection */
  width?: number;
  /** Height for camera projection */
  height?: number;
  /** Surface scale (radius/size). Default: 10. */
  surfaceScale?: number;
}

// ---------------------------------------------------------------------------
// Screen coordinate types & projection
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
  distFromPrev: number;
  hasNaN: boolean;
}

/** Result of a long simulation with trace recording. */
export interface TraceResult {
  frames: TraceFrame[];
  totalDistance: number;
  stuckFrames: number;
  nanFrames: number;
  uvRange: { minU: number; maxU: number; minV: number; maxV: number };
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

/**
 * Projects a world-space position to screen pixel coordinates.
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
  readonly particles: ParticleSystem;
  readonly input: InputManager;
  readonly surfaceType: SurfaceType;
  readonly width: number;
  readonly height: number;
  readonly seed: number | null;

  private readonly heldKeys = new Set<string>();
  private mouseX: number;
  private mouseY: number;
  private mouseDown = false;
  private _totalFrames = 0;

  // Recording state
  private isRecording = false;
  private recordedInputs: ReplayInput[] = [];
  private recordingStartFrame = 0;

  /** Records of every bullet spawned, for origin verification */
  readonly bulletSpawnLog: BulletSpawnRecord[] = [];

  /** Overloaded constructors for backward compatibility with PlaygroundTestHarness */
  constructor(surface?: SurfaceType, weapon?: WeaponType | null, width?: number, height?: number);
  constructor(options: RealGameHarnessOptions);
  constructor(
    surfaceOrOptions: SurfaceType | RealGameHarnessOptions = 'sphere',
    weapon?: WeaponType | null,
    width?: number,
    height?: number,
  ) {
    let options: RealGameHarnessOptions;
    if (typeof surfaceOrOptions === 'object' && surfaceOrOptions !== null) {
      options = surfaceOrOptions;
    } else {
      options = {
        surface: surfaceOrOptions as SurfaceType,
        weapon: weapon ?? undefined,
        width,
        height,
      };
    }

    const surfaceType = options.surface ?? 'sphere';
    const mapSize = options.mapSize ?? MapSize.MEDIUM;
    const resolvedWidth = options.width ?? DEFAULT_WIDTH;
    const resolvedHeight = options.height ?? DEFAULT_HEIGHT;
    const seed = options.seed ?? null;

    this.seed = seed;
    if (seed !== null) {
      setGameSeed(seed);
    }

    this.surfaceType = surfaceType;
    this.width = resolvedWidth;
    this.height = resolvedHeight;
    this.mouseX = resolvedWidth / 2;
    this.mouseY = resolvedHeight / 2;

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
    this.input = input;
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
    this.particles = particles;

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
    if (options.weapon != null) {
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
        // Homing: missiles are 3D meshes from WeaponManager, blaster stays Standard
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
      if (this.isRecording) {
        this.recordedInputs.push({
          frame: this._totalFrames - this.recordingStartFrame,
          keys: Array.from(this.heldKeys),
          mouseX: this.mouseX,
          mouseY: this.mouseY,
          mouseDown: this.mouseDown,
        });
      }
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
  // Screen Coordinate Queries
  // =======================================================================

  getPlayerScreenPos(): ScreenPos {
    return projectToScreen(this.player.mesh.position, this.game.camera, this.width, this.height);
  }

  getEnemyScreenPositions(): ScreenPosWithWorld[] {
    return this.enemySpawner.getEnemies()
      .filter(e => e.alive && e.active && e.mesh)
      .map(e => {
        const worldPos = e.position.clone();
        const screen = projectToScreen(worldPos, this.game.camera, this.width, this.height);
        return { ...screen, worldPos };
      });
  }

  getBulletScreenPositions(): ScreenPos[] {
    const positions: ScreenPos[] = [];
    this.bulletPool.forEachActive((_idx, pos) => {
      positions.push(projectToScreen(pos, this.game.camera, this.width, this.height));
    });
    return positions;
  }

  getAimScreenDirection(): { x: number; y: number } {
    const cam = this.game.camera;
    const playerWorldPos = this.player.mesh.position.clone();
    const aimDir = this.player.getAimDirection();

    const playerScreen = projectToScreen(playerWorldPos, cam, this.width, this.height);
    const aimTarget = playerWorldPos.clone().add(aimDir.multiplyScalar(5));
    const aimScreen = projectToScreen(aimTarget, cam, this.width, this.height);

    const dx = aimScreen.x - playerScreen.x;
    const dy = aimScreen.y - playerScreen.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  getBulletScreenDirection(): { x: number; y: number } | null {
    const positions: THREE.Vector3[] = [];
    this.bulletPool.forEachActive((_idx, pos) => {
      positions.push(pos.clone());
    });
    if (positions.length === 0) return null;

    const lastBullet = positions[positions.length - 1];
    const screenBullet = projectToScreen(lastBullet, this.game.camera, this.width, this.height);
    const playerScreen = this.getPlayerScreenPos();
    const dx = screenBullet.x - playerScreen.x;
    const dy = screenBullet.y - playerScreen.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return null;
    return { x: dx / len, y: dy / len };
  }

  // =======================================================================
  // Trace Recording
  // =======================================================================

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
        const wp = this.getPlayerWorldPos();
        totalDistance += prevPos.distanceTo(wp);
        prevPos = wp;
        prevUV = this.getPlayerSurfaceUV();
      }
    }

    return { frames: samples, totalDistance, stuckFrames, nanFrames, uvRange: { minU, maxU, minV, maxV }, seamCrossings };
  }

  // =======================================================================
  // Long Simulation Helpers
  // =======================================================================

  walkUntilStuck(direction: string, maxFrames: number = 3000, stuckThreshold: number = 30): StuckResult {
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
          return { stuckAtFrame: i, stuckAtUV: uv, stuckAtWorldPos: worldPos, totalFrames: i, trace };
        }
      } else {
        consecutiveStuck = 0;
      }
      prevPos = worldPos;
    }

    this.releaseKey(direction);
    return { stuckAtFrame: null, stuckAtUV: null, stuckAtWorldPos: null, totalFrames: maxFrames, trace };
  }

  findSeamCrossing(direction: string = 'w', maxFrames: number = 3000, uvAxis: 'u' | 'v' = 'u'): SeamCrossingResult {
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

      const delta = Math.abs(uv[uvAxis] - prevUV[uvAxis]);
      if (delta > 0.4 && i > 10) {
        this.releaseKey(direction);
        return { crossed: true, crossedAtFrame: i, crossedFromUV: prevUV, crossedToUV: uv, trace };
      }

      prevUV = uv;
      prevPos = worldPos;
    }

    this.releaseKey(direction);
    return { crossed: false, crossedAtFrame: null, crossedFromUV: null, crossedToUV: null, trace };
  }

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

  getCameraStability(frames: number): { maxRotationDelta: number; avgRotationDelta: number } {
    let maxDelta = 0;
    let totalDelta = 0;
    let prevQuat = this.game.camera.quaternion.clone();

    for (let i = 0; i < frames; i++) {
      this.tick(1);
      const currentQuat = this.game.camera.quaternion.clone();
      const delta = prevQuat.angleTo(currentQuat);
      maxDelta = Math.max(maxDelta, delta);
      totalDelta += delta;
      prevQuat = currentQuat;
    }

    return { maxRotationDelta: maxDelta, avgRotationDelta: totalDelta / frames };
  }

  // =======================================================================
  // Traversal Helpers
  // =======================================================================

  canTraverse(direction: 'forward' | 'backward' | 'left' | 'right'): boolean {
    const keyMap: Record<string, string> = { forward: 'w', backward: 's', left: 'a', right: 'd' };
    const startPos = this.getPlayerWorldPos();
    this.pressKey(keyMap[direction]);
    this.tick(10);
    this.releaseKey(keyMap[direction]);
    return startPos.distanceTo(this.getPlayerWorldPos()) > 0.01;
  }

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

  spawnEnemies(count: number, type: string = 'wanderer'): void {
    for (let i = 0; i < count; i++) {
      const u = 0.2 + (i / count) * 0.6;
      const v = 0.2 + (i / count) * 0.6;
      this.enemySpawner.spawn(type as any, u, v);
    }
  }

  waitForMaterialization(maxFrames: number = 120): void {
    for (let i = 0; i < maxFrames; i++) {
      this.tick(1);
      const enemies = this.enemySpawner.getEnemies();
      if (enemies.length > 0 && enemies.every(e => !e.isMaterializing)) return;
    }
  }

  // =======================================================================
  // Weapon Helper
  // =======================================================================

  setWeapon(weapon: WeaponType): void {
    this.weaponManager.forceSetWeapon(weapon);
  }

  // =======================================================================
  // Particle / Effect Queries
  // =======================================================================

  getActiveEffectCount(): number {
    return this.particles.activeEffectCount;
  }

  isParticleSystemInScene(): boolean {
    return this.particles.root.parent === this.game.scene;
  }

  isParticleSystemFrustumCullingDisabled(): boolean {
    return !this.particles.root.frustumCulled;
  }

  // =======================================================================
  // Standard Verification Report
  // =======================================================================

  runStandardChecks(): VerificationReport {
    const failures: string[] = [];

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

    this.pressKey('w');
    const camera = this.getCameraStability(60);
    this.releaseKey('w');
    if (camera.maxRotationDelta > Math.PI) {
      failures.push(`camera: max rotation ${(camera.maxRotationDelta * 180 / Math.PI).toFixed(1)}°/frame (>180°)`);
    }

    this.tick(30);
    const screenPos = this.getPlayerScreenPos();
    const playerVisible = screenPos.visible && !isNaN(screenPos.x) && !isNaN(screenPos.y);
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const playerCentered = Math.abs(screenPos.x - centerX) < this.width * 0.35
      && Math.abs(screenPos.y - centerY) < this.height * 0.35;
    if (!playerVisible) failures.push('screen: player not visible');
    if (!playerCentered) failures.push(`screen: player at (${screenPos.x.toFixed(0)}, ${screenPos.y.toFixed(0)}), not centered`);

    const traversal = this.testFullTraversal(120);
    if (traversal.totalDistanceMoved < 0.5) {
      failures.push(`traversal: only ${traversal.totalDistanceMoved.toFixed(2)} total distance`);
    }

    const fireHandlerConnected = typeof this.player.weaponFireHandler === 'function';
    const currentWeapon = this.weaponManager.getCurrentWeapon();
    if (!fireHandlerConnected) failures.push('weapon: fireHandler not connected');

    return {
      surface: this.surfaceType,
      movement,
      camera: { stable: camera.maxRotationDelta < Math.PI, ...camera },
      screen: { playerVisible, playerCentered },
      traversal: { totalDistance: traversal.totalDistanceMoved, reachedQuadrants: traversal.visitedUVs.length },
      weapon: { fireHandlerConnected, currentWeapon },
      overall: failures.length === 0 ? 'PASS' : 'FAIL',
      failures,
    };
  }

  // =======================================================================
  // Deterministic Testing
  // =======================================================================

  getEnemyStates(): EntityState[] {
    return this.enemySpawner.getEnemies()
      .map(e => ({
        type: e.baseTypeName || 'unknown',
        position: e.position.clone(),
        alive: e.alive,
        health: e.health,
        faceIndex: (e as any).faceIndex,
      }));
  }

  recordEntityTimeline(frames: number, sampleEvery: number = 1): EntityTimeline {
    const timelineFrames: EntityTimelineFrame[] = [];

    for (let i = 0; i < frames; i++) {
      this.tick(1);

      if (i % sampleEvery === 0) {
        const enemies = this.enemySpawner.getEnemies();
        const bullets: THREE.Vector3[] = [];
        this.bulletPool.forEachActive((_idx, pos) => {
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

    return { frames: timelineFrames, seed: this.seed ?? 0, surface: this.surfaceType };
  }

  buildScenario(config: ScenarioConfig): void {
    if (config.seed !== undefined) {
      setGameSeed(config.seed);
    }

    if (config.playerPosition) {
      const { u, v } = config.playerPosition;
      this.player.respawn(u, v);
      const point = this.surface.getPoint(u, v);
      const projected = this.meshSurface.closestPointOnSurface(point.position);
      if (projected) {
        this.playerWalker.teleportTo(projected.point, projected.faceIndex, projected.normal);
      } else {
        this.playerWalker.teleportTo(point.position, 0, point.normal);
      }
      this.player.mesh.position.copy(this.playerWalker.position);
    }

    if (config.enemies) {
      for (const enemyGroup of config.enemies) {
        const count = enemyGroup.count ?? 1;
        for (let i = 0; i < count; i++) {
          this.enemySpawner.spawn(enemyGroup.type, enemyGroup.u, enemyGroup.v);
        }
      }
    }

    this.tick(10);
  }

  runScenario(config: ScenarioConfig, frames: number): EntityTimeline {
    this.buildScenario(config);
    return this.recordEntityTimeline(frames);
  }

  // =======================================================================
  // Replay System
  // =======================================================================

  startRecording(): void {
    this.isRecording = true;
    this.recordedInputs = [];
    this.recordingStartFrame = this._totalFrames;
  }

  stopRecording(): ReplayData {
    this.isRecording = false;
    return {
      seed: this.seed ?? 0,
      surface: this.surfaceType,
      inputs: this.recordedInputs,
      totalFrames: this._totalFrames - this.recordingStartFrame,
    };
  }

  playReplay(replay: ReplayData): EntityTimeline {
    if (replay.seed !== 0) {
      setGameSeed(replay.seed);
    }

    this.releaseAllKeys();
    this.player.respawn(0.5, 0.5);
    this.enemySpawner.clear();

    const timelineFrames: EntityTimelineFrame[] = [];
    let inputIndex = 0;

    for (let frame = 0; frame < replay.totalFrames; frame++) {
      if (inputIndex < replay.inputs.length && replay.inputs[inputIndex].frame <= frame) {
        const inp = replay.inputs[inputIndex];
        this.releaseAllKeys();
        for (const key of inp.keys) this.pressKey(key);
        this.setMousePosition(inp.mouseX, inp.mouseY);
        this.setMouseDown(inp.mouseDown);
        inputIndex++;
      }

      this.tick(1);

      const enemies = this.enemySpawner.getEnemies();
      const bullets: THREE.Vector3[] = [];
      this.bulletPool.forEachActive((_idx, pos) => { bullets.push(pos.clone()); });

      timelineFrames.push({
        frame: this._totalFrames,
        player: { position: this.getPlayerWorldPos(), aimDirection: this.player.getAimDirection() },
        enemies: enemies.filter(e => e.alive && e.active).map((e, id) => ({
          id, type: e.baseTypeName || 'unknown', position: e.position.clone(), alive: e.alive,
        })),
        bullets,
      });
    }

    return { frames: timelineFrames, seed: replay.seed, surface: replay.surface };
  }

  // =======================================================================
  // Cleanup
  // =======================================================================

  dispose(): void {
    this.releaseAllKeys();
    if (this.seed !== null) {
      clearGameSeed();
    }
    EffectDictionary.clear();
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
