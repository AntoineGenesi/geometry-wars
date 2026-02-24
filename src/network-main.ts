/**
 * Network Multiplayer Mode
 *
 * Connects to a Colyseus server for online/LAN multiplayer.
 * REUSES the same visual components as single player and local co-op:
 * - Real Player class (same chevron mesh from GeometryBuilder)
 * - Real EnemySpawner (same enemy meshes from GeometryBuilder)
 * - Same SurfaceFactory, ParticleSystem, ScreenShake, ScorePopupManager
 * - Same audio (SoundEngine, BackgroundMusic)
 * - Same lighting, bloom, and post-processing pipeline via Game class
 * - Same KillLog, TotalKillCounter, WeaponPickup, WeaponHUD
 *
 * The server is authoritative: it runs game logic (movement, collisions,
 * spawning). This client renders the server's state using the exact same
 * visual pipeline as single player. Input is sent to the server; entity
 * positions are received back and applied to real game objects.
 *
 * IMPORTANT: Surface type is determined by the SERVER, not the URL parameter.
 *
 * Usage: Open http://localhost:3000?mode=network
 * Server must be running: npm run server
 */

import * as THREE from 'three';
import { Game } from './core/Game';
import { SurfaceFactory, SurfaceType } from './surfaces/SurfaceFactory';
import { Surface, SurfacePoint } from './surfaces/Surface';
import { Player } from './entities/Player';
import { BulletPool } from './entities/Bullet';
import { GeomPool } from './entities/Geom';
import { EnemySpawner, EnemyType } from './entities/enemies/EnemySpawner';
import { BaseEnemy } from './entities/enemies/BaseEnemy';
import { ParticleSystem } from './effects/ParticleSystem';
import { ScreenShake } from './effects/ScreenShake';
import { ScorePopupManager } from './effects/ScorePopup';
import { GlowTrail } from './effects/GlowTrail';
import { EntityGlow, EntityGlowManager, GlowPresets } from './effects/EntityGlow';
import { InputManager } from './input/InputManager';
import { isMobile } from './core/MobileDetector';
import { TouchInput } from './input/TouchInput';
import { MeshSurface } from './surfaces/MeshSurface';
import { getSoundEngine } from './audio/SoundEngine';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { KillLog } from './ui/KillLog';
import { TotalKillCounter } from './ui/TotalKillCounter';
import { WeaponPickup } from './weapons/WeaponPickup';
import { WeaponType, WEAPON_CONFIGS } from './weapons/WeaponTypes';
import { WeaponHUD } from './ui/WeaponHUD';
import { WeaponManager } from './weapons/WeaponManager';
import type { WeaponInventoryEntry } from './weapons/WeaponManager';
import { AllyGlowManager } from './effects/AllyGlow';
import { PlayerLevel, LevelUpNotification } from './core/PlayerLevel';
import { BuffManager } from './buffs/BuffManager';
import { BuffHUD } from './buffs/BuffHUD';
import { BuffAuraRenderer } from './buffs/BuffAuraRenderer';
import { BuffParticleAura } from './buffs/BuffParticleAura';
import { ShockArcRenderer } from './buffs/ShockArcRenderer';
import { BuffPickupNew } from './buffs/BuffPickupNew';
import { CompanionManager, CompanionPickup, CompanionHUD, getRandomCompanionType } from './entities/Companion';
import { CameraController } from './core/CameraController';
import { EnemyInstanceManager } from './rendering/EnemyInstanceManager';
import { BulletInstanceManager, BulletVisualType } from './rendering/BulletInstanceManager';
import { LODManager } from './rendering/LODManager';
import { DepthOcclusionSystem } from './rendering/DepthOpacity';
import { OcclusionSurfaceMaterial } from './rendering/OcclusionSurfaceMaterial';
import { AdaptiveQuality, QualityLevel } from './rendering/AdaptiveQuality';
import {
  NetworkClient,
  NetworkPlayerState,
  NetworkEnemyState,
  NetworkBulletState,
  NetworkGeomState,
  NetworkWeaponPickupState,
  NetworkGameState,
  ClientMetricsPayload,
} from './network/NetworkClient';
import { PlayerNameLabels } from './ui/PlayerNameLabel';
import { Minimap } from './ui/Minimap';
import { GameOverScreen } from './ui/GameOverScreen';
import { VotingScreen } from './ui/VotingScreen';
import { PauseMenu, PauseMenuGameData } from './ui/PauseMenu';
import { DDAPerformanceTracker } from './difficulty/DDAPerformanceTracker';
import { DDADecisionEngine } from './difficulty/DDADecisionEngine';
import { DDASpawnModifier } from './difficulty/DDASpawnModifier';
import { loadDDASettings } from './difficulty/DDASettings';
import type { PlayerPosition } from './difficulty/DDASpawnModifier';
import { SettingsMenu, loadDebugSettings } from './ui/SettingsMenu';
import { loadVisualStyle, loadVisualMode, saveVisualMode } from './ui/VisualStyleSettings';
import { PerformanceTracker } from './core/PerformanceTracker';
import { DebugOverlay } from './ui/DebugOverlay';
import { MapSize, getDefaultMapSizeForSurface, getMapSizeScaleFactor } from './core/MapSize';
import {
  createStandardSurfaceConfig,
  setupStandardLighting,
  setupShockwaveEffect,
  makeSurfaceTransformFn as sharedMakeSurfaceTransformFn,
  orientPlayerOnSurface as sharedOrientPlayerOnSurface,
  DEFAULT_SURFACE_SCALE,
  type SurfaceTransformFn,
} from './rendering/SharedGameSetup';
import {
  isStartupCacheFresh,
  setStartupCache,
  type StartupConfigData,
} from './utils/StartupCache';
import type { NetworkStartupConfig } from './network/NetworkClient';

// ---------------------------------------------------------------------------
// Bullet visual type helper (mirrors main.ts — no server weapon type in state)
// ---------------------------------------------------------------------------

function weaponToBulletVisual(weapon: WeaponType): BulletVisualType {
  switch (weapon) {
    case WeaponType.Spread:       return BulletVisualType.Spread;
    case WeaponType.Piercing:     return BulletVisualType.Piercing;
    case WeaponType.Homing:       return BulletVisualType.Homing;
    case WeaponType.PlasmaMortar: return BulletVisualType.Homing;  // large projectile visual
    case WeaponType.GravityGun:   return BulletVisualType.Default;
    case WeaponType.BlackHole:    return BulletVisualType.Default;
    default:                      return BulletVisualType.Standard;
  }
}

// ---------------------------------------------------------------------------
// Debug API type (exposed as window.__gameDebug when ?debug=true)
// Used by tests/lan/run-lan-tests.mjs for programmatic game state inspection.
// ---------------------------------------------------------------------------

interface GameDebugAPI {
  getPlayerPosition: () => { u: number; v: number } | null;
  getEnemyCount: () => number;
  getEnemies: () => { id: string; type: string; u: number; v: number; hp: number }[];
  getBulletCount: () => number;
  getScore: () => number;
  isConnected: () => boolean;
  getPlayerCount: () => number;
  getLocalPlayerId: () => string;
  getSurfaceType: () => string;
  isGameStarted: () => boolean;
  getWaveText: () => string;
}

// ---------------------------------------------------------------------------
// LAN Diagnostic API (exposed as window.__lanDebug in ALL network games)
// User can paste diagnostic commands in browser console to help debug issues.
// ---------------------------------------------------------------------------

interface LANDiagAPI {
  /** Full connection and game state snapshot */
  status: () => Record<string, unknown>;
  /** Entity count comparison (client vs what we think server has) */
  entities: () => Record<string, unknown>;
  /** Measure round-trip latency to server health endpoint */
  latency: () => Promise<Record<string, unknown>>;
  /** Copy full diagnostic report to clipboard */
  report: () => Promise<string>;
  /** Toggle real-time diagnostic overlay on screen */
  overlay: (show?: boolean) => void;
}

declare global {
  interface Window {
    __gameDebug?: GameDebugAPI;
    __lanDebug?: LANDiagAPI;
  }
}

// Debug logging: gated behind ?debug=true URL flag, same as NetworkClient.
// The LAN E2E test suite uses these [NetworkMain] logs for diagnostics.
const _netMainDebug = new URLSearchParams(window.location.search).has('debug');
function netMainLog(...args: unknown[]): void {
  if (_netMainDebug) {
    console.log(...args);
  }
}

// Pre-allocated temp vectors for network state sync (zero per-frame allocation)
const _netTempPos = new THREE.Vector3();
const _netTempDir = new THREE.Vector3();
const _netTempNormal = new THREE.Vector3();
const _bulletTmpColor = new THREE.Color();

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function getUrlSurfaceType(): SurfaceType {
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  const validTypes = SurfaceFactory.getAvailableTypes();
  if (surfaceParam && validTypes.includes(surfaceParam as SurfaceType)) {
    return surfaceParam as SurfaceType;
  }
  return 'sphere';
}

function isValidSurfaceType(s: string): s is SurfaceType {
  return SurfaceFactory.getAvailableTypes().includes(s as SurfaceType);
}

function getServerUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicitServer = params.get('server');
  if (explicitServer) return explicitServer;
  const port = params.get('port') || '2567';
  return `ws://${window.location.hostname}:${port}`;
}

function getPlayerName(): string {
  const params = new URLSearchParams(window.location.search);
  const urlName = params.get('name');
  if (urlName) return urlName;
  const savedName = localStorage.getItem('gw3d_player_name');
  if (savedName) return savedName;
  return `Player ${Math.floor(Math.random() * 9000) + 1000}`;
}

// ---------------------------------------------------------------------------
// Enemy colors for death particle effects (same map as single player / co-op)
// ---------------------------------------------------------------------------

const ENEMY_COLORS: Record<string, THREE.Color> = {
  wanderer: new THREE.Color(0xaa44ff),
  grunt: new THREE.Color(0x4444ff),
  duck: new THREE.Color(0xff44aa),
  mayfly: new THREE.Color(0xddddff),
  rocket: new THREE.Color(0xff8800),
  neutron: new THREE.Color(0xccff00),
  weaver: new THREE.Color(0x00ff44),
  spinner: new THREE.Color(0xff44ff),
  spinnerspawn: new THREE.Color(0xff88cc),
  snake: new THREE.Color(0x4488ff),
  repulsor: new THREE.Color(0xff4400),
  gravitywell: new THREE.Color(0x4488ff),
  spawner: new THREE.Color(0xff2222),
  virus: new THREE.Color(0x00cc00),
  gate: new THREE.Color(0xff8800),
  painter: new THREE.Color(0xff44aa),
  titangrunt: new THREE.Color(0x2244cc),
  titanspinner: new THREE.Color(0xff22ff),
  titanweaver: new THREE.Color(0x22ff44),
  boss: new THREE.Color(0x4488ff),
  // Server-side enemy types that may not map 1:1 to single player types
  arrow: new THREE.Color(0xffff00),
  blackhole: new THREE.Color(0x4488ff),
  proton: new THREE.Color(0x00ffff),
  ufo: new THREE.Color(0xffffff),
  mines: new THREE.Color(0xff0000),
  mutator: new THREE.Color(0x8080ff),
  bubbles: new THREE.Color(0x00ff80),
  spawnlet: new THREE.Color(0xff8080),
};

// ---------------------------------------------------------------------------
// Server enemy type -> EnemySpawner type mapping
// The server uses some enemy type names that differ from EnemySpawner types.
// Map them so we create the correct visual entity.
// ---------------------------------------------------------------------------

const SERVER_TO_SPAWNER_TYPE: Record<string, EnemyType> = {
  grunt: 'grunt',
  arrow: 'grunt', // server "arrow" -> closest local type
  wanderer: 'wanderer',
  weaver: 'weaver',
  spinner: 'spinner',
  snake: 'snake',
  gate: 'gate',
  blackhole: 'gravity_well',
  repulsor: 'repulsor',
  mayfly: 'mayfly',
  duck: 'duck',
  rocket: 'rocket',
  neutron: 'neutron',
  virus: 'virus',
  spawner: 'spawner',
  painter: 'painter',
  titan_grunt: 'titan_grunt',
  titan_spinner: 'titan_spinner',
  titan_weaver: 'titan_weaver',
  proton: 'neutron', // closest visual match
  ufo: 'wanderer', // closest visual match
  mines: 'grunt', // closest visual match
  mutator: 'weaver', // closest visual match
  bubbles: 'wanderer', // closest visual match
  spawnlet: 'grunt', // closest visual match
};

// ---------------------------------------------------------------------------
// Server weapon type -> WeaponType mapping
// ---------------------------------------------------------------------------

const SERVER_TO_WEAPON_TYPE: Record<string, WeaponType> = {
  standard: WeaponType.Standard,
  spread: WeaponType.Spread,
  piercing: WeaponType.Piercing,
  homing: WeaponType.Homing,
  chain_lightning: WeaponType.ChainLightning,
  plasma_mortar: WeaponType.PlasmaMortar,
  gravity_gun: WeaponType.GravityGun,
  laser_beam: WeaponType.LaserBeam,
  black_hole: WeaponType.BlackHole,
  tesla_coil: WeaponType.TeslaCoil,
};

// ---------------------------------------------------------------------------
// Surface transform helper — now using shared module (SharedGameSetup.ts)
// ---------------------------------------------------------------------------

// Re-export from shared module (keeps backward-compatible local references)
const makeSurfaceTransformFn = sharedMakeSurfaceTransformFn;

// ---------------------------------------------------------------------------
// Orient player on surface — now using shared module (SharedGameSetup.ts)
// ---------------------------------------------------------------------------

function orientPlayerOnSurface(
  player: Player,
  surfaceNormal: THREE.Vector3,
  aimAngle: number,
  tangentU: THREE.Vector3,
): void {
  sharedOrientPlayerOnSurface(player.mesh, surfaceNormal, aimAngle, tangentU);
}

// ---------------------------------------------------------------------------
// Player colors (same as co-op)
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [0x00ffff, 0xff00ff, 0x00ff00, 0xffaa00];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Dismiss loading screen. Normally the StartMenu dismisses it when it creates
  // itself, but when navigating directly via QR code (?mode=network) or a shared
  // link, the StartMenu is skipped entirely. Without this, the loading spinner
  // stays visible forever, covering all connection UI (the core mobile bug).
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('fade-out');
    loadingScreen.addEventListener('transitionend', () => loadingScreen.remove(), { once: true });
  }

  // Detect mobile mode early — affects input, quality, and entity limits.
  const mobile = isMobile();

  // Initialize audio (same as co-op).
  // AudioContext may already be initialized if coming from StartMenu (where we
  // call init() synchronously within the click handler). If coming from a direct
  // URL (QR code scan), AudioContext will start suspended because there was no
  // user gesture. We add a one-shot listener to resume it on first interaction.
  const sound = getSoundEngine();
  sound.init();
  sound.resume();

  // One-shot listener: resume AudioContext on first user interaction.
  // Covers the QR-code-scan path where page loads without a user gesture.
  if (sound.getContext()?.state === 'suspended') {
    const resumeAudio = () => {
      sound.resume();
      document.removeEventListener('click', resumeAudio);
      document.removeEventListener('keydown', resumeAudio);
      document.removeEventListener('pointerdown', resumeAudio);
    };
    document.addEventListener('click', resumeAudio, { once: true });
    document.addEventListener('keydown', resumeAudio, { once: true });
    document.addEventListener('pointerdown', resumeAudio, { once: true });
  }

  const bgMusic = new BackgroundMusic();

  // -- Visual style (user-selected from Visual Styles playground) --
  const savedStyle = loadVisualStyle();

  // -- Game engine (same config as co-op, mobile reduces bloom) --
  const game = new Game({
    bloom: {
      strength: savedStyle?.bloomStrength ?? (mobile ? 0.4 : 0.7),
      radius: savedStyle?.bloomRadius ?? (mobile ? 0.3 : 0.5),
      threshold: savedStyle?.bloomThreshold ?? 0.6,
    },
    cameraDistance: 15,
    cameraSmoothing: 0.05,
  });
  game.disableBuiltInCameraUpdate = true;

  // Apply mobile quality settings (same as main.ts)
  if (mobile) {
    game.entityLimits = {
      maxEnemies: 200,
      maxBullets: 500,
      maxParticles: 2000,
      maxGeoms: 300,
      bloomEnabled: true,
      shadowsEnabled: false,
    };
    // Cap pixel ratio to 1.5x on mobile — saves ~44% GPU fill vs 2.0x cap
    game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  // Set global renderer info so all SettingsMenu instances show it
  SettingsMenu.setGlobalRendererInfo(game.backend, game.isWebGPU);

  // Debug performance overlay — F3 key (same as single-player)
  // Surface type is unknown until server connects; 'network' is used as placeholder.
  const perfTracker = new PerformanceTracker('network');
  const debugOverlay = new DebugOverlay(perfTracker);
  debugOverlay.setRendererBackend(game.backend);

  // Apply saved debug settings and wire up toggle (mirrors main.ts behaviour)
  const initialDebugSettings = loadDebugSettings();
  if (!initialDebugSettings.showDebugStatistics) {
    debugOverlay.hide();
  }
  SettingsMenu.setGlobalDebugChangeCallback((debugSettings) => {
    if (debugSettings.showDebugStatistics) {
      debugOverlay.show();
    } else {
      debugOverlay.hide();
    }
  });

  // Apply saved visual mode (pixelated = half-res bloom, modern = full-res bloom)
  const savedVisualMode = loadVisualMode();
  game.setVisualMode(savedVisualMode);

  const scene = game.scene;
  const camera = game.camera;

  // Frame-time tracker for depth-occlusion lerp in onRender (avoids per-frame allocation)
  let _lastNetRenderTime = performance.now();

  // Tunnel transparency: dynamic grid opacity when surface blocks camera-to-player view.
  // Same logic as SP's RenderLoop.ts — fades grid when player is behind the surface.
  const _tunnelRaycaster = new THREE.Raycaster();
  const _tunnelToPlayer = new THREE.Vector3();
  const _tunnelToPlayerDir = new THREE.Vector3();
  let _currentGridOpacity = 0.3; // matches default gridOpacity
  const _gridFadeSpeed = 3.0; // opacity per second convergence rate

  // -- CameraController: orbit (middle mouse), zoom (scroll wheel), follow (same as single-player) --
  const cameraController = new CameraController(camera);
  cameraController.setCameraDistance(20); // Match existing LAN camera distance

  // -- ShockwaveEffect (shared with single-player via SharedGameSetup) --
  const shockwaveEffect = setupShockwaveEffect(game, camera);

  // Hide default single-player HUD (same as co-op)
  const defaultHUD = document.getElementById('game-hud');
  if (defaultHUD) defaultHUD.style.display = 'none';

  // -- Lighting (shared with single-player via SharedGameSetup) --
  setupStandardLighting(scene);

  // -- Surface (created after connecting, using server's authoritative type) --
  let surface: Surface | null = null;
  let meshSurface: MeshSurface | null = null;
  let surfaceReady = false;
  let getTransform: ReturnType<typeof makeSurfaceTransformFn> | null = null;
  let lastCreatedSurfaceType: string = '';
  let lastMapSize: string = '';
  let currentMapSizeScaleFactor = 1.0;

  // -- Enemy spawner (created after surface, used to create real enemy meshes) --
  let enemySpawner: EnemySpawner | null = null;

  function cleanupSurface(): void {
    if (surface) {
      scene.remove(surface.group);
    }
    if (meshSurface) {
      meshSurface.dispose();
    }
    // Clean up enemies created by old spawner
    networkEnemies.forEach((enemy) => {
      // Unregister from instance manager first (frees the instance slot)
      enemyInstanceManager.unregister(enemy);
      if (enemy.mesh) scene.remove(enemy.mesh);
      // Remove auxiliary scene objects (e.g. Snake.segmentRoot, Painter.trailRoot)
      for (const aux of enemy.auxiliaryObjects) scene.remove(aux);
    });
    networkEnemies.clear();
    enemyTargetUV.clear();
    enemyGlowTrails.forEach((trail) => {
      scene.remove(trail.root);
      trail.dispose();
    });
    enemyGlowTrails.clear();
    remotePlayerTargetUV.clear();
    bulletTargetUV.clear();
    geomTargetUV.clear();
    surface = null;
    meshSurface = null;
    getTransform = null;
    enemySpawner = null;
    surfaceReady = false;
    lastCreatedSurfaceType = '';
    lastMapSize = '';
  }

  function initSurface(serverSurfaceType: string, confirmedFromServer: boolean = false, mapSize?: string): void {
    // Allow re-initialization if the surface type or map size differs from what was created,
    // OR if this is the first confirmed-from-server call and the previous init
    // was just a guess from connect-time (which may have had stale defaults).
    if (surfaceReady) {
      const currentType = isValidSurfaceType(serverSurfaceType) ? serverSurfaceType : null;
      if (!currentType) return; // Still no valid type, skip

      const incomingMapSize = mapSize ?? '';
      const typeChanged = lastCreatedSurfaceType !== currentType;
      const mapSizeChanged = incomingMapSize !== '' && lastMapSize !== incomingMapSize;

      // If type or map size changed — tear down and recreate
      if (typeChanged || mapSizeChanged) {
        if (typeChanged) {
          console.warn(`[NetworkMain] Surface type mismatch corrected: ${lastCreatedSurfaceType} → ${currentType}`);
          netMainLog(`[NetworkMain] Surface type changed: ${lastCreatedSurfaceType} -> ${currentType}, rebuilding`);
        } else {
          netMainLog(`[NetworkMain] Map size changed: ${lastMapSize} -> ${incomingMapSize}, rebuilding`);
        }
        cleanupSurface();
      } else if (surfaceConfirmedFromServer) {
        return; // Already confirmed with same type + size, skip
      } else if (confirmedFromServer) {
        // Type matches but was NOT confirmed from server, and this IS a confirmed call.
        // Skip rebuild but upgrade to confirmed status.
        surfaceConfirmedFromServer = true;
        return;
      } else {
        return; // Same type + size, not a confirmed upgrade, skip
      }
    }

    if (confirmedFromServer) {
      surfaceConfirmedFromServer = true;
    }

    const surfaceType: SurfaceType = isValidSurfaceType(serverSurfaceType)
      ? serverSurfaceType
      : getUrlSurfaceType();

    // Apply map size scale to surface geometry.
    // Must happen BEFORE scene.add() and updateMatrixWorld() so MeshSurface
    // (BVH for collision/movement) is built against the correctly-scaled geometry.
    const resolvedMapSize: MapSize = (mapSize as MapSize) ?? getDefaultMapSizeForSurface(surfaceType);
    const mapSizeScaleFactor = getMapSizeScaleFactor(resolvedMapSize);

    // Surface config — shared with single-player via SharedGameSetup.
    // Uses DEFAULT_SURFACE_SCALE (10) which matches SP's endless mode surfaceScale.
    const surfaceConfig = createStandardSurfaceConfig(surfaceType, DEFAULT_SURFACE_SCALE, savedStyle);

    surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);

    if (mapSizeScaleFactor !== 1.0) {
      surface.group.scale.setScalar(mapSizeScaleFactor);
    }
    console.log(`[MapSize] ${surfaceType} → ${resolvedMapSize} (scale: ${mapSizeScaleFactor}x)`);

    scene.add(surface.group);

    // CRITICAL: updateMatrixWorld before MeshSurface construction so the BVH
    // bakes correctly-scaled world-space coordinates (not unscaled local coords).
    surface.mesh.updateMatrixWorld(true);
    meshSurface = new MeshSurface(surface.mesh);
    bulletPool.setMeshSurface(meshSurface);
    companionBulletPool.setMeshSurface(meshSurface);
    companionManager.setMeshSurface(meshSurface);
    currentMapSizeScaleFactor = mapSizeScaleFactor;
    // Scale bullet range with map size: larger maps → bullets travel proportionally further.
    bulletPool.lifetimeMultiplier = mapSizeScaleFactor;
    // Wire depth occlusion to new surface mesh (BVH built internally for fast raycasting)
    depthOcclusion.setSurfaceMesh(surface.mesh);
    localWeaponManager.setMeshSurface(meshSurface);

    // Pass mapSizeScaleFactor so UV→world transforms correctly reflect the surface scale.
    getTransform = makeSurfaceTransformFn(surface, mapSizeScaleFactor);

    // Create enemy spawner with real surface transform (same as co-op)
    enemySpawner = new EnemySpawner(scene, getTransform);
    enemySpawner.setSurfaceSpeedScale(surface.speedScale);
    enemySpawner.setSurface(surface);

    // Wire instance manager for GPU-batched enemy rendering
    enemySpawner.setInstanceManager(enemyInstanceManager);

    // Wire DDA modifier into enemy spawner (host uses this for spawn modifications)
    enemySpawner.setDDAModifier(ddaSpawnModifier);
    enemySpawner.setDDAPlayers(ddaPlayers);

    surfaceReady = true;
    lastCreatedSurfaceType = surfaceType;
    lastMapSize = mapSize ?? '';
    netMainLog(`[NetworkMain] Surface initialized: ${surfaceType} (mapSize: ${resolvedMapSize}, scale: ${mapSizeScaleFactor}x)`);
  }

  // -- Shared visual systems (same as co-op) --
  const bulletPool = new BulletPool();
  scene.add(bulletPool.root);

  // -- GPU instanced enemy rendering (reduces draw calls from ~2000 to ~15) --
  // Created before initSurface() so it can be wired into the enemySpawner.
  const enemyInstanceManager = new EnemyInstanceManager(scene);

  // -- Depth-based occlusion: dims enemies behind the surface (view-based, not proximity-based) --
  // S27b: replaces the disabled proximity-based depth opacity with raycast-based occlusion.
  // Uses EnemyInstanceManager for performance-friendly instanced visibility updates.
  const depthOcclusion = new DepthOcclusionSystem();

  // -- LOD: reduce triangle count for distant enemies (same as single-player) --
  const lodManager = new LODManager();

  // -- Adaptive quality: FPS-based auto quality adjustment (same as single-player) --
  const adaptiveQuality = new AdaptiveQuality({ initialLevel: QualityLevel.ULTRA });

  // Wire quality change callback: adjusts bloom, particle budget, LOD distances
  adaptiveQuality.onQualityChange = (_oldLevel, newLevel) => {
    const settings = adaptiveQuality.getSettings();

    // Bloom strength + threshold
    if (settings.bloomEnabled) {
      const strength = (savedStyle?.bloomStrength ?? 1.0) * settings.bloomResolutionScale;
      game.setBloomSettings(strength, 0.6);
      if (game.bloomPass) {
        game.bloomPass.radius = (savedStyle?.bloomRadius ?? 0.4) * settings.bloomResolutionScale;
      }
    } else {
      game.setBloomSettings(0, 0.6);
    }

    // Bloom render-target resolution (lower quality = smaller target = faster)
    if (game.composer) {
      const scale = settings.bloomEnabled ? Math.max(0.25, settings.bloomResolutionScale) : 0.25;
      game.bloomResolutionScale = scale;
      game.composer.setSize(
        Math.floor(window.innerWidth * scale),
        Math.floor(window.innerHeight * scale),
      );
    }

    // Particle emission budget
    const budgets: Record<string, [number, number]> = {
      ULTRA:   [200, 40],
      HIGH:    [150, 30],
      MEDIUM:  [80,  20],
      LOW:     [30,  10],
      MINIMAL: [15,   5],
    };
    const [maxP, maxF] = budgets[newLevel] ?? [200, 40];
    particles.setEmitBudget(maxP, maxF);

    // LOD distance thresholds: tighter at lower quality = more enemies at simplified geometry
    const lodDistances: Record<string, { highDistance: number; mediumDistance: number }> = {
      ULTRA:   { highDistance: 60, mediumDistance: 120 },
      HIGH:    { highDistance: 40, mediumDistance: 80  },
      MEDIUM:  { highDistance: 25, mediumDistance: 50  },
      LOW:     { highDistance: 15, mediumDistance: 30  },
      MINIMAL: { highDistance: 10, mediumDistance: 20  },
    };
    const lodCfg = lodDistances[newLevel];
    if (lodCfg) {
      lodManager.setConfig(lodCfg);
    }
  };

  // -- GPU instanced bullet rendering (replaces flat line-based visuals) --
  const bulletInstanceManager = new BulletInstanceManager(scene, 200);
  // Track which bullet IDs have been registered with the instance manager
  const bulletInstanceIds = new Set<string>();
  // Track weapon type per bullet (populated from ownerId → player.weaponType in onStateChange)
  const bulletWeaponType = new Map<string, WeaponType>();
  // Hide the original line-based bullet visuals (BulletInstanceManager takes over)
  bulletPool.root.visible = false;

  const geomPool = new GeomPool();
  scene.add(geomPool.root);

  // -- WeaponManager for local player special weapon visuals --
  // The server is authoritative for damage and bullet spawning.
  // WeaponManager handles only CLIENT-SIDE visuals for instant/field weapons
  // (LaserBeam, ChainLightning, TeslaCoil) that are NOT represented in bullet state.
  const localWeaponManager = new WeaponManager();
  scene.add(localWeaponManager.getVisualRoot());
  localWeaponManager.setCallbacks({
    getEnemies: () => {
      const result: { position: THREE.Vector3; index: number; alive: boolean }[] = [];
      let idx = 0;
      networkEnemies.forEach((enemy) => {
        result.push({ position: enemy.position, index: idx++, alive: enemy.alive });
      });
      return result;
    },
    onEnemyDamage: () => {}, // Server is authoritative for damage in LAN mode
    spawnBullet: () => {},   // Server handles bullet creation; no local bullet meshes
  });

  // Special weapons that produce visual effects NOT represented in server bullet state.
  // Projectile weapons (Spread, Homing, Mortar, etc.) are already rendered by
  // BulletInstanceManager from server-sent bullet state — don't double-render them.
  const SPECIAL_VISUAL_WEAPONS = new Set<WeaponType>([
    WeaponType.LaserBeam,
    WeaponType.ChainLightning,
    WeaponType.TeslaCoil,
  ]);

  // Current weapon type for the local player — synced from server state
  let localPlayerWeaponType: WeaponType = WeaponType.Standard;

  const particles = new ParticleSystem(5000);
  scene.add(particles.root);
  if (mobile) {
    particles.setEmitBudget(60, 20);
  }

  const scorePopups = new ScorePopupManager();
  scene.add(scorePopups.root);
  scorePopups.setCamera(camera);

  const screenShake = new ScreenShake();

  // Kill log + total kill counter (same as co-op / single player)
  const killLog = new KillLog();
  const totalKillCounter = new TotalKillCounter();
  killLog.onKill = (type, color) => totalKillCounter.addKill(type, color);

  // Weapon HUD — same graphical inventory panel as single-player
  const weaponHUD = new WeaponHUD();
  weaponHUD.setPosition(10, window.innerHeight / 2 - 60);

  // Ally glow manager for remote player indicators
  const allyGlowManager = new AllyGlowManager(scene);

  // Floating name labels above player ships
  const nameLabels = new PlayerNameLabels();

  // Minimap (same as single-player — shows local player, enemies, geoms)
  const minimap = new Minimap();

  // -- Player tracking --
  // Maps server player ID -> real Player instance (same class as single player)
  const networkPlayers = new Map<string, Player>();
  const playerGlowTrails = new Map<string, GlowTrail>();
  const playerAliveState = new Map<string, boolean>();

  // -- EntityGlow for local player (pulsing halo, same as single-player) --
  const glowManager = new EntityGlowManager();

  // -- PlayerLevel: visual-only kill progression for local player in LAN --
  // Stat multipliers (damage, fireRate, etc.) are NOT applied — server controls those.
  // Only the visual aura ring and level-up notification are active.
  const playerLevel = new PlayerLevel();
  const levelUpNotification = new LevelUpNotification();
  playerLevel.onLevelUp = (level, perk) => {
    levelUpNotification.show(level, perk);
    sound.play('multiplierUp', { pitch: 1.2 + level * 0.05 });
  };

  // -- Buff system: client-side buff collection + visual effects --
  // Buffs are collected via client-side pickup drops (see localBuffPickups).
  // Server does not send buff state; stats (damage bonus, fire rate) are NOT applied.
  // Visual effects (ShockAura arcs, aura glow, particle cloud) ARE active via buffManager.update().
  const buffManager = new BuffManager();
  const buffHUD = new BuffHUD();
  buffManager.onBuffGained = (type, _stacks) => { buffHUD.highlightBuff(type); };
  const buffAuraRenderer = new BuffAuraRenderer();
  const buffParticleAura = new BuffParticleAura();
  const shockArcRenderer = new ShockArcRenderer();
  scene.add(buffAuraRenderer.root);
  scene.add(buffParticleAura.root);
  scene.add(shockArcRenderer.root);

  // -- Companion system: client-side drones/companions (not server-authoritative) --
  // Mirrors SP behavior: pickups spawn on enemy death, player collects them, companions orbit.
  // Server doesn't track companions; gameplay effects (shots, shield) are client-local only.
  const companionManager = new CompanionManager();
  scene.add(companionManager.root);
  const companionHUD = new CompanionHUD();
  const localCompanionPickups: CompanionPickup[] = [];
  const localBuffPickups: BuffPickupNew[] = [];
  // Separate bullet pool for companion shots — kept isolated from the network-synced
  // bulletPool so server bullet state sync never stomps on companion bullet slots.
  const companionBulletPool = new BulletPool();
  scene.add(companionBulletPool.root);

  // -- Enemy tracking --
  // Maps server enemy ID -> real BaseEnemy instance (created via EnemySpawner)
  const networkEnemies = new Map<string, BaseEnemy>();
  // Maps fast enemy ID -> GlowTrail (Mayfly/Rocket/Duck only, same as single-player)
  const enemyGlowTrails = new Map<string, GlowTrail>();
  const FAST_ENEMY_TYPES = new Set<string>(['mayfly', 'rocket', 'duck']);

  // -- Interpolation targets (updated at 30Hz from server, consumed at 60Hz in render) --
  // Store target UV positions for enemies and remote players so we can
  // lerp toward them every RENDER frame (60Hz) instead of only on state
  // change (30Hz). This is the #1 reason co-op feels smooth and LAN doesn't.
  const enemyTargetUV = new Map<string, { u: number; v: number }>();
  const remotePlayerTargetUV = new Map<string, { u: number; v: number; aimAngle: number }>();

  // -- Bullet tracking --
  const bulletIdToIndex = new Map<string, number>();
  // Interpolation targets for bullets: lerp toward server UV in onRender (60Hz)
  // instead of snapping in onStateChange (was 30Hz, now 60Hz but still benefits
  // from smooth lerp). Same pattern as enemyTargetUV.
  const bulletTargetUV = new Map<string, { u: number; v: number; dirX: number; dirY: number }>();

  // -- Geom tracking --
  const geomIdToIndex = new Map<string, number>();
  // Interpolation targets for geoms (same pattern)
  const geomTargetUV = new Map<string, { u: number; v: number }>();

  // -- Weapon pickup tracking --
  // Uses real WeaponPickup instances (same as co-op)
  const networkWeaponPickups = new Map<string, WeaponPickup>();

  // -- Spawn warning rings (LAN visual parity) --
  // Created when 'pre_spawn' message arrives; cleaned up when enemy appears or times out.
  interface SpawnWarningRing {
    mesh: THREE.Mesh;
    u: number;
    v: number;
    spawnedAt: number; // performance.now() timestamp when created (ms)
  }
  const PRE_SPAWN_DURATION = 1.5; // seconds — must match server PRE_SPAWN_WARNING_MS / 1000
  const spawnWarningRings: SpawnWarningRing[] = [];
  // Shared geometry/material for all warning rings (created once, reused)
  const warningRingGeometry = new THREE.RingGeometry(0.2, 0.35, 16);
  const warningRingBaseMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4444,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // -- Local input --
  // On mobile, use virtual joystick touch controls; otherwise keyboard+mouse.
  const input = mobile ? new TouchInput() : new InputManager();

  // -- Network client --
  const network = new NetworkClient(getServerUrl());
  let localPlayerId = '';
  let isHost = false;
  let isPaused = false;
  let isInLookMode = false;
  // Holds the startup config hash received from the server so onStartupConfig
  // can store it in localStorage along with the cached data.
  let pendingStartupHash: string | null = null;
  let localMenuOpen = false;

  // -- Dynamic Difficulty Adjustment (DDA) system --
  // In LAN mode, DDA tracks local player metrics on every client.
  // If this client is the host, the DDA engine runs for all players and the
  // spawn modifier is wired into the enemySpawner (host controls spawning).
  // Non-host clients only track local metrics (for debug display / future use).
  const ddaSettings = loadDDASettings();
  // Map of player server ID -> tracker (dynamically created as players join)
  const ddaTrackerMap = new Map<string, DDAPerformanceTracker>();
  let ddaPlayerIndex = 0;
  const ddaEngine = new DDADecisionEngine();
  ddaEngine.setEnabled(ddaSettings.enabled);
  const ddaSpawnModifier = new DDASpawnModifier(ddaEngine);
  // Pre-allocated player positions for DDA zone detection (max 4 players)
  const ddaPlayers: PlayerPosition[] = [];

  /** Get or create a DDA tracker for a player by server ID. */
  function getOrCreateDDATracker(playerId: string): DDAPerformanceTracker {
    let tracker = ddaTrackerMap.get(playerId);
    if (!tracker) {
      tracker = new DDAPerformanceTracker(ddaPlayerIndex);
      ddaTrackerMap.set(playerId, tracker);
      ddaPlayers.push({ index: ddaPlayerIndex, u: 0.5, v: 0.5 });
      ddaPlayerIndex++;
    }
    return tracker;
  }

  // Track whether surface has been confirmed from a real server state change
  // (not just a connect-time guess that might have stale defaults).
  let surfaceConfirmedFromServer = false;

  // Input throttle: send at 60Hz to match server tick rate (TICK_RATE=60).
  // Previous 33ms (30Hz) meant inputs were quantized to half the server rate,
  // adding up to 33ms of latency. Matching the server rate eliminates this.
  const INPUT_SEND_INTERVAL = 0.016;
  let lastInputSendTime = 0;

  // Metrics logging: send perf/DDA data to server every 500ms for persistent logging.
  // Server saves to logs/mp-perf-{sessionId}-{date}.jsonl for post-match analysis.
  const METRICS_SEND_INTERVAL = 0.5;
  let metricsAccumulator = 0;
  let latestGameTime = 0;
  let latestWaveNumber = 0;
  let latestMapSize = 'medium';
  let lastSentInput: {
    moveX: number; moveY: number; aimAngle: number;
    shooting: boolean; bomb: boolean;
  } | null = null;
  let shootSoundTimer = 0;

  // -----------------------------------------------------------------------
  // UI elements (network-specific HUD)
  // -----------------------------------------------------------------------

  const statusEl = document.createElement('div');
  statusEl.style.cssText =
    'position:fixed;top:10px;left:50%;transform:translateX(-50%);' +
    'color:#0ff;font:20px monospace;text-shadow:0 0 10px #0ff;z-index:100;';
  statusEl.textContent = 'Connecting...';
  document.body.appendChild(statusEl);

  const scoreEl = document.createElement('div');
  scoreEl.style.cssText =
    'position:fixed;top:10px;right:10px;color:#0f0;font:24px monospace;' +
    'text-shadow:0 0 10px #0f0;z-index:100;text-align:right;';
  document.body.appendChild(scoreEl);

  // Combined team score display — reuse #score-display (center-top, below wave label)
  const teamScoreEl = document.getElementById('score-display');
  if (teamScoreEl) {
    // Push it below the statusEl (Wave N) which is at top:10px with ~25px line height
    teamScoreEl.style.top = '45px';
    teamScoreEl.textContent = '0';
  }
  // Hide single-player multiplier display (not meaningful in network mode)
  const spMultiplierEl = document.getElementById('multiplier-display');
  if (spMultiplierEl) spMultiplierEl.style.display = 'none';

  const playersEl = document.createElement('div');
  playersEl.style.cssText =
    'position:fixed;top:10px;left:10px;color:#ff0;font:16px monospace;' +
    'text-shadow:0 0 10px #ff0;z-index:100;';
  document.body.appendChild(playersEl);

  const weaponEl = document.createElement('div');
  weaponEl.style.cssText =
    'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);' +
    'color:#ff0;font:16px monospace;text-shadow:0 0 8px #ff0;z-index:100;';
  document.body.appendChild(weaponEl);

  // Start button
  const startBtn = document.createElement('button');
  startBtn.textContent = 'START GAME';
  startBtn.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'padding:20px 40px;font:bold 24px monospace;background:#0a0;color:#fff;' +
    'border:2px solid #0f0;cursor:pointer;z-index:100;display:none;';
  startBtn.onclick = () => {
    if (!network.isConnected()) {
      statusEl.textContent = 'Not connected to server!';
      statusEl.style.color = '#f44';
      return;
    }
    if (!isHost) {
      // Should not happen (button is hidden for non-hosts) but guard just in case.
      statusEl.textContent = 'Only the host can start the game.';
      return;
    }
    network.startGame();
    startBtn.style.display = 'none';
    statusEl.textContent = 'Starting...';
  };
  document.body.appendChild(startBtn);

  // Back to menu button
  const backBtn = document.createElement('button');
  backBtn.textContent = 'BACK TO MENU';
  backBtn.style.cssText =
    'position:fixed;top:60%;left:50%;transform:translate(-50%,-50%);' +
    'padding:15px 30px;font:bold 18px monospace;background:#a00;color:#fff;' +
    'border:2px solid #f44;cursor:pointer;z-index:100;display:none;';
  backBtn.onclick = () => {
    window.location.href = window.location.pathname;
  };
  document.body.appendChild(backBtn);

  // Stop Server button (visible to host, top-right corner)
  const stopServerBtn = document.createElement('button');
  stopServerBtn.textContent = 'STOP SERVER';
  stopServerBtn.style.cssText =
    'position:fixed;top:50px;right:10px;' +
    'padding:8px 16px;font:bold 12px monospace;background:#800;color:#fff;' +
    'border:2px solid #f44;cursor:pointer;z-index:100;display:none;' +
    'text-shadow:0 0 5px #f44;';
  stopServerBtn.onclick = async () => {
    // Send end_game to server (which broadcasts to all clients)
    network.sendEndGame();
    // Try to stop the server process via LAN API
    try {
      await fetch('/__lan/stop', { method: 'POST' });
    } catch {
      // Ignore — server may not be managed by this Vite instance
    }
    // Navigate back to menu
    window.location.href = window.location.pathname;
  };
  document.body.appendChild(stopServerBtn);

  // Pause menu — shown when the server has paused the game.
  // Both host and non-host see the full PauseMenu.
  // Host gets END GAME / STOP SERVER buttons; non-host does not (isHost=false).
  const pauseMenu = new PauseMenu();
  pauseMenu.setIsHost(false); // updated dynamically before each show()
  pauseMenu.setNetworkCallbacks({
    onPause: (paused: boolean) => {
      // Only send to server when state actually changes (prevents circular trigger
      // when showPauseOverlay() calls pauseMenu.show() in response to server state).
      if (isPaused !== paused) {
        isPaused = paused;
        network.sendPause(paused);
      }
    },
    onEndGame: () => {
      network.sendEndGame();
      network.disconnect();
      window.location.href = window.location.pathname;
    },
    onStopServer: async () => {
      network.sendEndGame();
      try { await fetch('/__lan/stop', { method: 'POST' }); } catch { /* ignore */ }
      network.disconnect();
      window.location.href = window.location.pathname;
    },
  });
  pauseMenu.onResume(() => {
    game.resume(); // Resync game clock after host resumes via PauseMenu button
  });
  pauseMenu.onLookMode(() => {
    // Non-host player entered look mode: menu is closed but game stays paused
    isInLookMode = true;
    // Game remains paused globally, camera can move locally
  });
  pauseMenu.onExit(() => {
    network.disconnect();
    window.location.href = window.location.pathname;
  });

  // Sync pause menu with saved visual mode; wire the toggle
  pauseMenu.setVisualMode(savedVisualMode);
  pauseMenu.onVisualModeChange((mode) => {
    saveVisualMode(mode);
    game.setVisualMode(mode);
  });

  // Show QR code / join URL in pause menu so other players can join conveniently.
  // Strip personal params (name=) from the URL before sharing.
  {
    const params = new URLSearchParams(window.location.search);
    params.delete('name');
    const joinUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    pauseMenu.setJoinUrl(joinUrl);
  }

  /** Build PauseMenuGameData from current local player state (buffs, weapon, kills). */
  function buildPauseMenuGameData(): PauseMenuGameData {
    const weaponConfig = WEAPON_CONFIGS[localPlayerWeaponType];
    const buffs = buffManager.getActiveBuffs().map(b => ({
      name: b.def.name,
      stacks: b.stacks,
      description: b.def.description,
      currentValue: b.def.formatValue(b.stacks),
      color: '#' + b.def.iconColor.toString(16).padStart(6, '0'),
    }));
    const perk = playerLevel.perk;
    const totalDamageBonus = Math.round((perk.damageMultiplier * buffManager.getDamageMultiplier() - 1) * 100);
    const totalFireRateBonus = Math.round((perk.fireRateMultiplier * buffManager.getFireRateMultiplier() - 1) * 100);
    const totalSpeedBonus = Math.round((perk.moveSpeedMultiplier * buffManager.getMoveSpeedMultiplier() - 1) * 100);
    return {
      playerLevel: {
        level: playerLevel.level,
        name: perk.name,
        description: perk.description,
        color: '#' + perk.auraColor.toString(16).padStart(6, '0'),
      },
      cumulativeBonuses: {
        damageBonus: totalDamageBonus,
        fireRateBonus: totalFireRateBonus,
        speedBonus: totalSpeedBonus,
      },
      buffs,
      totalKills: totalKillCounter.getTotalKills(),
      weapon: {
        name: weaponConfig?.name ?? 'Standard',
        baseDamage: weaponConfig?.damage ?? 1,
        fireRate: weaponConfig?.fireRate ?? 1,
      },
    };
  }

  function showPauseOverlay(paused: boolean): void {
    isPaused = paused;
    if (paused) {
      game.pause(); // Sync game clock to prevent dt accumulation during pause
      // Both host and non-host see the full PauseMenu.
      // Host gets END GAME / STOP SERVER buttons; non-host does not.
      pauseMenu.setIsHost(isHost);
      pauseMenu.setGameData(buildPauseMenuGameData());
      pauseMenu.setPerformanceHTML(debugOverlay.getSummaryHTML());
      pauseMenu.show();
    } else {
      isInLookMode = false; // Reset look mode when game resumes
      pauseMenu.hide();
      game.resume(); // Resync game clock to avoid massive dt spike on first frame after resume
    }
  }

  // -----------------------------------------------------------------------
  // Connection Lost overlay — shown when the server disconnects unexpectedly.
  // Replaces the frozen-screen bug: game loop keeps running but this overlay
  // blocks interaction and provides a clear path back to the main menu.
  // -----------------------------------------------------------------------

  let connectionLost = false;

  const connectionLostOverlay = document.createElement('div');
  connectionLostOverlay.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'background:rgba(0,0,0,0.85);z-index:500;' +
    'display:none;flex-direction:column;justify-content:center;align-items:center;' +
    'font-family:monospace;';

  const connectionLostTitle = document.createElement('div');
  connectionLostTitle.style.cssText =
    'color:#ff4444;font-size:48px;font-weight:bold;' +
    'text-shadow:0 0 20px #ff2222;margin-bottom:16px;letter-spacing:4px;';
  connectionLostTitle.textContent = 'CONNECTION LOST';
  connectionLostOverlay.appendChild(connectionLostTitle);

  const connectionLostReason = document.createElement('div');
  connectionLostReason.style.cssText =
    'color:#ffaaaa;font-size:20px;margin-bottom:36px;text-align:center;';
  connectionLostOverlay.appendChild(connectionLostReason);

  const connectionLostHint = document.createElement('div');
  connectionLostHint.style.cssText =
    'color:#888888;font-size:14px;margin-bottom:24px;letter-spacing:2px;';
  connectionLostHint.textContent = 'Press ESC or click below to return to main menu';
  connectionLostOverlay.appendChild(connectionLostHint);

  const connectionLostBackBtn = document.createElement('button');
  connectionLostBackBtn.textContent = '◀  RETURN TO MAIN MENU';
  connectionLostBackBtn.style.cssText =
    'padding:16px 48px;font:bold 20px monospace;' +
    'background:#220000;color:#fff;border:2px solid #cc4444;cursor:pointer;' +
    'letter-spacing:2px;min-width:320px;';
  connectionLostBackBtn.addEventListener('mouseenter', () => {
    connectionLostBackBtn.style.filter = 'brightness(1.3)';
  });
  connectionLostBackBtn.addEventListener('mouseleave', () => {
    connectionLostBackBtn.style.filter = '';
  });
  connectionLostBackBtn.onclick = () => {
    window.location.href = window.location.pathname;
  };
  connectionLostOverlay.appendChild(connectionLostBackBtn);

  document.body.appendChild(connectionLostOverlay);

  /**
   * Show the connection-lost overlay. Idempotent — safe to call multiple times.
   * Stops music, shows a clear message, and ensures Escape works.
   */
  function handleConnectionLost(reason: string): void {
    if (connectionLost) return; // Already showing — don't double-trigger
    connectionLost = true;
    bgMusic.stop();
    connectionLostReason.textContent = reason;
    connectionLostOverlay.style.display = 'flex';
    // Pause game clock so the background scene doesn't keep animating
    game.pause();
  }

  // -----------------------------------------------------------------------
  // Dead player overlay — shown when local player loses all lives in MP.
  // Game continues for other alive players; this player spectates.
  // Hidden automatically when a new game starts (player respawns).
  // -----------------------------------------------------------------------

  const deadOverlay = document.createElement('div');
  deadOverlay.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:50;' +    // low z-index — does not block game input
    'display:none;flex-direction:column;justify-content:flex-end;align-items:center;' +
    'padding-bottom:80px;font-family:monospace;';

  const deadOverlayText = document.createElement('div');
  deadOverlayText.style.cssText =
    'color:rgba(255,80,80,0.9);font-size:22px;font-weight:bold;' +
    'letter-spacing:3px;text-shadow:0 0 12px #ff0000;' +
    'background:rgba(0,0,0,0.55);padding:10px 28px;border:1px solid rgba(255,80,80,0.4);';
  deadOverlayText.textContent = 'YOU DIED — SPECTATING';
  deadOverlay.appendChild(deadOverlayText);
  document.body.appendChild(deadOverlay);

  // -----------------------------------------------------------------------
  // Local player menu — opened by Escape, visible to ALL players.
  // Does NOT pause the server game. Each player manages their own menu.
  // Non-hosts can use this to disconnect. Hosts can stop the server.
  // -----------------------------------------------------------------------

  const localMenuEl = document.createElement('div');
  localMenuEl.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'background:rgba(0,0,20,0.88);z-index:300;' +
    'display:none;flex-direction:column;justify-content:center;align-items:center;' +
    'backdrop-filter:blur(4px);font-family:monospace;';

  const localMenuTitle = document.createElement('div');
  localMenuTitle.textContent = 'MENU';
  localMenuTitle.style.cssText =
    'color:#ffff00;font-size:64px;font-weight:bold;' +
    'text-shadow:0 0 20px #ffff00,0 0 40px #ffaa00;' +
    'margin-bottom:16px;letter-spacing:10px;';
  localMenuEl.appendChild(localMenuTitle);

  const localMenuWarning = document.createElement('div');
  localMenuWarning.textContent = '⚠  Game continues — only the host can pause the server';
  localMenuWarning.style.cssText =
    'color:#ff8800;font-size:14px;margin-bottom:36px;letter-spacing:1px;';
  localMenuEl.appendChild(localMenuWarning);

  function makeMenuBtn(
    text: string,
    bg: string,
    borderColor: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText =
      'margin:8px;padding:16px 48px;font:bold 20px monospace;' +
      `background:${bg};color:#fff;border:2px solid ${borderColor};cursor:pointer;` +
      'letter-spacing:2px;min-width:320px;transition:filter 0.15s;';
    btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.3)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });
    return btn;
  }

  const localMenuResumeBtn = makeMenuBtn('▶  RESUME GAME', '#004400', '#00cc00');
  localMenuResumeBtn.onclick = () => { hideLocalMenu(); };
  localMenuEl.appendChild(localMenuResumeBtn);

  const localMenuReturnBtn = makeMenuBtn('◀  RETURN TO MAIN MENU', '#220000', '#cc4444');
  localMenuReturnBtn.onclick = () => {
    hideLocalMenu();
    network.disconnect();
    window.location.href = window.location.pathname;
  };
  localMenuEl.appendChild(localMenuReturnBtn);

  // Host-only: stop the server and kick all players back to menu
  const localMenuStopServerBtn = makeMenuBtn('⏹  STOP SERVER (ALL PLAYERS)', '#440000', '#ff2200');
  localMenuStopServerBtn.style.display = 'none';
  localMenuStopServerBtn.onclick = async () => {
    hideLocalMenu();
    network.sendEndGame();
    try { await fetch('/__lan/stop', { method: 'POST' }); } catch { /* ignore */ }
    window.location.href = window.location.pathname;
  };
  localMenuEl.appendChild(localMenuStopServerBtn);

  const localMenuHint = document.createElement('div');
  localMenuHint.textContent = 'Press ESC to resume';
  localMenuHint.style.cssText = 'color:#555566;font-size:13px;margin-top:28px;letter-spacing:2px;';
  localMenuEl.appendChild(localMenuHint);

  document.body.appendChild(localMenuEl);

  function showLocalMenu(): void {
    localMenuOpen = true;
    localMenuStopServerBtn.style.display = isHost ? 'block' : 'none';
    localMenuEl.style.display = 'flex';
    // Send zero input immediately so the server stops moving this player
    if (network.isConnected()) {
      const zeroInput = {
        moveX: 0,
        moveY: 0,
        aimAngle: lastSentInput?.aimAngle ?? 0,
        shooting: false,
        bomb: false,
      };
      network.sendInput(zeroInput);
      lastSentInput = { ...zeroInput };
    }
  }

  function hideLocalMenu(): void {
    localMenuOpen = false;
    localMenuEl.style.display = 'none';
  }

  // Escape key handler:
  // - HOST: pauses/resumes the server (enemies freeze for everyone)
  // - Non-host (game running): opens local menu (game continues, only host can pause)
  // - Non-host (server paused): closes the pause menu overlay (game stays frozen server-side)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // After disconnect, Escape always returns to main menu.
      if (connectionLost) {
        window.location.href = window.location.pathname;
        return;
      }

      if (!network.isConnected()) return;

      if (localMenuOpen) {
        // Close the local menu
        hideLocalMenu();
      } else if (!isPaused) {
        // Re-check host status in case it changed since connect
        if (!isHost) {
          const serverHostId = network.getServerHostId();
          if (serverHostId && serverHostId === localPlayerId) {
            isHost = true;
            netMainLog('[NetworkMain] Host status confirmed on ESC press');
          }
        }
        if (isHost) {
          // Host: pause the server — enemies freeze for ALL players
          isPaused = true;
          network.sendPause(true);
          showPauseOverlay(true);
        } else {
          // Non-host: open local menu (only host can pause the server)
          showLocalMenu();
        }
      } else if (isHost) {
        // Server is paused (by host) — host can resume with Escape
        isPaused = false;
        network.sendPause(false);
        showPauseOverlay(false);
      } else if (isInLookMode) {
        // Non-host: in look mode — Escape returns to pause menu
        isInLookMode = false;
        pauseMenu.exitLookMode();
      } else {
        // Non-host: server is paused — Escape enters look mode
        // (lets player look around while game stays paused globally)
        isInLookMode = true;
        pauseMenu.enterLookMode();
      }
    }
  });

  // Window blur handler: when the browser window loses focus (user switches
  // to a different window on same PC), immediately send zero-input to the
  // server. Without this, the server keeps applying the last non-zero input
  // at 60Hz until the client sends an update — but requestAnimationFrame is
  // throttled when the window is hidden, so the update could be delayed by
  // hundreds of milliseconds. This causes the player to drift after switching
  // windows, making same-PC LAN unplayable.
  window.addEventListener('blur', () => {
    if (network.isConnected()) {
      const zeroInput = {
        moveX: 0,
        moveY: 0,
        aimAngle: lastSentInput?.aimAngle ?? 0,
        shooting: false,
        bomb: false,
      };
      network.sendInput(zeroInput);
      lastSentInput = { ...zeroInput };
    }
  });

  // Also handle document visibility changes (tab switching, minimizing).
  // This fires in addition to blur in some cases, but the server handles
  // duplicate zero-inputs gracefully (movement is already 0).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && network.isConnected()) {
      const zeroInput = {
        moveX: 0,
        moveY: 0,
        aimAngle: lastSentInput?.aimAngle ?? 0,
        shooting: false,
        bomb: false,
      };
      network.sendInput(zeroInput);
      lastSentInput = { ...zeroInput };
    }
  });

  // -----------------------------------------------------------------------
  // Game Over screen (replaces bare statusEl "GAME OVER" text)
  // -----------------------------------------------------------------------

  const gameOverScreen = new GameOverScreen();
  // In network mode, auto-transition fires after 4s (or Enter key) — just hide
  // and let the roomPhase→'voting' server push show VotingScreen.
  gameOverScreen.onContinue(() => {
    gameOverScreen.hide();
  });
  // "RETURN TO MENU" button in network mode: end game (host only) then disconnect.
  gameOverScreen.onReturnToMenu(() => {
    if (isHost) {
      network.sendEndGame();
    } else {
      network.disconnect();
    }
    window.location.href = window.location.pathname;
  });
  let gameOverShown = false;

  // -----------------------------------------------------------------------
  // Voting screen (Phase 3 stub — wired now, real UI in Phase 3)
  // -----------------------------------------------------------------------

  const votingScreen = new VotingScreen();
  votingScreen.setCallbacks({
    onVote: (choice: string) => {
      network.sendVote(choice);
    },
    onHostSetPickMode: (pickMode: boolean) => {
      network.sendHostSetPickMode(pickMode);
    },
    onHostLaunch: (choice: string) => {
      network.sendHostLaunch(choice);
    },
    onReturnToMenu: () => {
      if (isHost) {
        network.sendEndGame();
      } else {
        network.disconnect();
      }
      window.location.href = window.location.pathname;
    },
  });

  // Track the current room phase so we can detect transitions
  let currentRoomPhase: string = 'lobby';

  // -----------------------------------------------------------------------
  // Helper: get or create a real Player for a network player
  // -----------------------------------------------------------------------

  function getOrCreatePlayer(id: string, netPlayer: NetworkPlayerState): Player {
    let player = networkPlayers.get(id);
    if (player) return player;

    // Create a real Player instance (same class as single player)
    player = new Player(bulletPool);
    player.respawn(netPlayer.surfaceU, netPlayer.surfaceV);
    player.lives = netPlayer.lives;
    player.bombs = netPlayer.bombs;
    player.score = netPlayer.score;
    player.multiplier = netPlayer.multiplier;

    // Set player color (same as co-op)
    player.setColor(netPlayer.color);

    scene.add(player.mesh);
    networkPlayers.set(id, player);

    // Create glow trail (same as single player's GlowTrail)
    const trail = new GlowTrail(new THREE.Color(netPlayer.color), 60, 0.4);
    scene.add(trail.root);
    playerGlowTrails.set(id, trail);

    // Attach EntityGlow halo to local player mesh (same as single-player main.ts)
    if (id === localPlayerId) {
      const preset = GlowPresets.player;
      glowManager.addGlow(player.mesh, preset.color, preset.size, preset.opacity);
      // Add PlayerLevel aura ring to scene (grows visually with kills)
      scene.add(playerLevel.auraRing);
    }

    // Add ally glow for remote players
    if (id !== localPlayerId) {
      allyGlowManager.addGlow(id, netPlayer.color, 0.9);
    }

    return player;
  }

  // -----------------------------------------------------------------------
  // Helper: get or create a real enemy for a network enemy
  // -----------------------------------------------------------------------

  function getOrCreateEnemy(id: string, netEnemy: NetworkEnemyState): BaseEnemy | null {
    let enemy = networkEnemies.get(id);
    if (enemy) return enemy;

    if (!enemySpawner) return null;

    // Map server enemy type to spawner type
    const spawnerType = SERVER_TO_SPAWNER_TYPE[netEnemy.type] || 'wanderer';

    // Use real EnemySpawner to create the enemy with proper mesh.
    // Pass skipSpawnWarning=true to avoid creating red ring indicators that
    // would never be cleaned up (enemySpawner.update() is not called in
    // network mode because the server is authoritative for enemy positions).
    enemy = enemySpawner.spawn(spawnerType, netEnemy.surfaceU, netEnemy.surfaceV, 0, true);

    networkEnemies.set(id, enemy);

    // Create glow trail for fast enemy types (Mayfly/Rocket/Duck), same as single-player
    if (FAST_ENEMY_TYPES.has(spawnerType)) {
      const trailColor = ENEMY_COLORS[netEnemy.type] ?? new THREE.Color(0xff8800);
      const enemyTrail = new GlowTrail(trailColor, 60, 0.4);
      scene.add(enemyTrail.root);
      enemyGlowTrails.set(id, enemyTrail);
    }

    return enemy;
  }

  // -----------------------------------------------------------------------
  // Game entity reset: clear all transient game state between rounds
  // Called when roomPhase transitions from 'voting' back to 'playing'.
  // Players stay connected; the server resets their lives/scores via state sync.
  // -----------------------------------------------------------------------

  function resetGameEntities(): void {
    // Clear all active bullets
    bulletIdToIndex.forEach((idx, id) => {
      bulletPool.kill(idx);
      bulletInstanceManager.removeBullet(id);
    });
    bulletIdToIndex.clear();
    bulletTargetUV.clear();
    bulletInstanceIds.clear();
    // Safety: clear the entire bullet pool to ensure no orphaned alive slots.
    // This guards against any state desync between bulletIdToIndex and the pool.
    bulletPool.clear();
    bulletInstanceManager.clear();

    // Clear all enemies from scene
    networkEnemies.forEach((enemy) => {
      enemyInstanceManager.unregister(enemy);
      if (enemy.mesh) scene.remove(enemy.mesh);
      // Remove auxiliary scene objects (e.g. Snake.segmentRoot, Painter.trailRoot)
      for (const aux of enemy.auxiliaryObjects) scene.remove(aux);
    });
    networkEnemies.clear();
    enemyTargetUV.clear();

    // Clear all geoms
    geomIdToIndex.forEach((idx) => {
      geomPool.kill(idx);
    });
    geomIdToIndex.clear();
    geomTargetUV.clear();

    // Clear weapon pickups
    networkWeaponPickups.forEach((pickup) => {
      scene.remove(pickup.mesh);
      pickup.dispose();
    });
    networkWeaponPickups.clear();

    // Clear local companion + buff pickups
    for (const cp of localCompanionPickups) { scene.remove(cp.mesh); cp.dispose(); }
    localCompanionPickups.length = 0;
    for (const bp of localBuffPickups) { scene.remove(bp.mesh); bp.dispose(); }
    localBuffPickups.length = 0;

    // Reset buff stacks so new game starts from scratch
    buffManager.reset();

    // Reset game-over flag so GameOverScreen can show again next game
    gameOverShown = false;

    // Hide dead overlay — local player is alive again in the new round
    deadOverlay.style.display = 'none';

    // Clear any pending spawn warning rings from the previous round
    for (const w of spawnWarningRings) {
      scene.remove(w.mesh);
      (w.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    spawnWarningRings.length = 0;

    netMainLog('[NetworkMain] Game entities reset for new round');
  }

  // -----------------------------------------------------------------------
  // State change callback: sync server state to local visual entities
  // -----------------------------------------------------------------------

  function onStateChange(state: NetworkGameState) {
    // Track latest server state values for metrics logging
    latestGameTime = state.gameTime;
    latestWaveNumber = state.waveNumber;
    latestMapSize = state.mapSize || 'medium';

    // Always try to init/update surface from authoritative server state.
    // This handles both initial creation AND correcting a wrong initial guess.
    if (state.surfaceType) {
      initSurface(state.surfaceType, true, state.mapSize || undefined);
    }
    if (!surface || !meshSurface || !getTransform) return;

    // Always sync isHost from the server's authoritative hostId.
    // Previously used `&& !isHost` guard, which meant isHost could only ever
    // go from false→true, never true→false. This prevented correct updates when:
    //   1. Initial state arrived before localPlayerId was set (timing race)
    //   2. Host was transferred to another player (new host needed to be reflected)
    // Now we always re-evaluate so isHost stays in sync with the server.
    if (localPlayerId) {
      const nowIsHost = state.hostId !== '' && state.hostId === localPlayerId;
      if (nowIsHost !== isHost) {
        isHost = nowIsHost;
        stopServerBtn.style.display = isHost ? 'block' : 'none';
        localMenuStopServerBtn.style.display = isHost ? 'block' : 'none';
        pauseMenu.setIsHost(isHost); // Keep pause menu in sync with current host status
        netMainLog(`[NetworkMain] Host status updated: ${isHost ? 'IS host' : 'NOT host'}`);
      }
    }

    const surf = surface;

    // ----- Sync players -----
    state.players.forEach((netPlayer: NetworkPlayerState, id: string) => {
      const player = getOrCreatePlayer(id, netPlayer);

      // Sync state from server
      player.lives = netPlayer.lives;
      player.bombs = netPlayer.bombs;
      player.score = netPlayer.score;
      player.multiplier = netPlayer.multiplier;

      // Position on surface using real surface transform (same as co-op).
      // For LOCAL player: snap to server position (corrects client-side prediction drift).
      // For REMOTE players: store target UV for per-frame interpolation in onRender.
      //   The interpolation is done in the render loop at 60Hz instead of here at
      //   30Hz, which is the #1 fix for making LAN feel as smooth as co-op.
      if (id === localPlayerId) {
        // Local player: snap UV to server for drift correction
        player.surfaceU = netPlayer.surfaceU;
        player.surfaceV = netPlayer.surfaceV;
        const sp: SurfacePoint = surf.getPoint(netPlayer.surfaceU, netPlayer.surfaceV);
        player.mesh.position.copy(sp.position).multiplyScalar(currentMapSizeScaleFactor).addScaledVector(sp.normal, 0.15);
        orientPlayerOnSurface(player, sp.normal, netPlayer.aimAngle, sp.tangentU);
      } else {
        // Remote player: store target UV for smooth per-frame interpolation
        remotePlayerTargetUV.set(id, {
          u: netPlayer.surfaceU,
          v: netPlayer.surfaceV,
          aimAngle: netPlayer.aimAngle,
        });
        // Also update the Player object's UV (used for HUD, DDA, etc.)
        player.surfaceU = netPlayer.surfaceU;
        player.surfaceV = netPlayer.surfaceV;
      }

      // Detect alive state transitions -> trigger effects
      const wasAlive = playerAliveState.get(id) ?? true;
      if (wasAlive && !netPlayer.alive) {
        // Player just died: trigger death effects
        particles.playerDeath(player.mesh.position);
        screenShake.shake(0.5, 0.4);
        sound.play('playerDeath');
        // DDA: track death event for this player
        const tracker = getOrCreateDDATracker(id);
        tracker.recordDeath();
        // Show spectating overlay for the local player only
        if (id === localPlayerId) {
          deadOverlay.style.display = 'flex';
        }
      } else if (!wasAlive && netPlayer.alive) {
        // Player just respawned (alive transitioned false->true).
        // This happens when the game restarts via "PLAY AGAIN", or
        // if the server adds a respawn-after-delay mechanism.
        // Force-restore full visibility on the mesh and ALL children.
        // This guards against stale child visibility from invincibility
        // blink, death effects, or any other code that may have hidden
        // individual child meshes while the player was dead.
        player.mesh.visible = true;
        player.mesh.traverse((child) => {
          child.visible = true;
        });
        // Reset bullet pool state for this player (ensure bullets render)
        // Play a respawn sound as feedback
        sound.play('playerDeath', { pitch: 1.5 });
        netMainLog(`[NetworkMain] Player ${id} respawned, mesh visibility restored`);
        // Hide spectating overlay when local player is revived (new round)
        if (id === localPlayerId) {
          deadOverlay.style.display = 'none';
        }
      }
      playerAliveState.set(id, netPlayer.alive);

      // Sync alive state and mesh visibility
      player.alive = netPlayer.alive;
      player.mesh.visible = netPlayer.alive;

      // Update glow trail
      const trail = playerGlowTrails.get(id);
      if (trail && netPlayer.alive) {
        trail.addPoint(player.mesh.position.clone());
      }

      // Sync ally glow position for remote players
      if (id !== localPlayerId && netPlayer.alive) {
        allyGlowManager.setPosition(id, player.mesh.position);
      }

      // Update floating name label
      nameLabels.setLabel(id, netPlayer.name, netPlayer.color);
    });

    // Remove disconnected players
    networkPlayers.forEach((_player, id) => {
      if (!state.players.has(id)) {
        const player = networkPlayers.get(id);
        if (player) {
          glowManager.removeGlow(player.mesh);
          scene.remove(player.mesh);
        }
        // Remove PlayerLevel aura ring when local player disconnects
        if (id === localPlayerId) {
          scene.remove(playerLevel.auraRing);
        }
        networkPlayers.delete(id);

        const trail = playerGlowTrails.get(id);
        if (trail) {
          scene.remove(trail.root);
          playerGlowTrails.delete(id);
        }

        allyGlowManager.removeGlow(id);
        nameLabels.removeLabel(id);
        remotePlayerTargetUV.delete(id);
      }
    });

    // ----- Sync enemies -----
    const activeEnemyIds = new Set<string>();
    state.enemies.forEach((netEnemy: NetworkEnemyState) => {
      activeEnemyIds.add(netEnemy.id);

      const enemy = getOrCreateEnemy(netEnemy.id, netEnemy);
      if (!enemy) return;

      // Store target UV for per-frame interpolation in onRender (60Hz).
      // Previously this lerp happened here at 30Hz, causing visible stutter.
      const isNewEnemy = !enemyTargetUV.has(netEnemy.id);
      enemyTargetUV.set(netEnemy.id, { u: netEnemy.surfaceU, v: netEnemy.surfaceV });

      // On first creation, snap to position immediately (no lerp needed)
      if (isNewEnemy) {
        enemy.surfacePosition.u = netEnemy.surfaceU;
        enemy.surfacePosition.v = netEnemy.surfaceV;
        if (getTransform) {
          enemy.applySurfaceTransform(getTransform);
        }

        // Remove any matching spawn warning ring at this UV position.
        // The ring was created 1.5s ago by the 'pre_spawn' message.
        for (let i = spawnWarningRings.length - 1; i >= 0; i--) {
          const w = spawnWarningRings[i];
          const du = Math.abs(w.u - netEnemy.surfaceU);
          const dv = Math.abs(w.v - netEnemy.surfaceV);
          if (du < 0.02 && dv < 0.02) {
            scene.remove(w.mesh);
            (w.mesh.material as THREE.MeshBasicMaterial).dispose();
            spawnWarningRings.splice(i, 1);
            break; // one ring per spawn position
          }
        }
      }

      // Visibility is set based on alive state. Depth-based opacity is
      // applied in the render loop (onRender) instead of here, to avoid
      // expensive mesh.traverse() calls on every 30Hz state update.
      if (enemy.mesh) {
        enemy.mesh.visible = netEnemy.alive;
      }
    });

    // Remove dead/removed enemies (with death effects)
    networkEnemies.forEach((enemy, id) => {
      if (!activeEnemyIds.has(id)) {
        // Trigger death effects (same as co-op)
        const enemyType = enemy.baseTypeName || enemy.constructor.name.toLowerCase();
        const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xff0000);
        particles.enemyDeath(enemy.position, color);
        screenShake.shake(0.15, 0.15);
        // Shockwave only for boss-tier enemies (not every regular enemy death)
        if (enemy.baseTypeName.startsWith('boss_')) {
          shockwaveEffect.spawnShockwave(enemy.position, 0.04, 0.7, 0.6);
        }
        if (surface) surface.applyForce(enemy.position, 0.2, 1.0);
        sound.play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });

        // Client-side companion + buff pickup drops (mirrors SP PickupSpawner.spawnPickupsOnEnemyDeath)
        if (surface) {
          const deathUV = surface.worldToSurface(enemy.position);
          if (deathUV) {
            // ~5% chance for a companion pickup (Guardian, Hunter, or Protector)
            if (Math.random() < 0.05) {
              const cPickup = new CompanionPickup(
                getRandomCompanionType(), deathUV.u, deathUV.v, currentMapSizeScaleFactor,
              );
              scene.add(cPickup.mesh);
              localCompanionPickups.push(cPickup);
            }
            // Stackable buff pickup (HotHands, TriggerHappy, etc.)
            const droppedBuff = BuffManager.rollBuffDrop();
            if (droppedBuff) {
              const bPickup = new BuffPickupNew(droppedBuff, deathUV.u, deathUV.v, currentMapSizeScaleFactor);
              scene.add(bPickup.mesh);
              localBuffPickups.push(bPickup);
            }
          }
        }

        // Score popup at death position
        scorePopups.spawnScore(enemy.position.clone(), enemy.scoreValue);

        // Kill log entry (same as co-op)
        killLog.addKill(enemyType, color.getHex());

        // DDA: attribute kill to nearest player (heuristic, server doesn't
        // send killer ID in state). This is sufficient for DDA tracking since
        // zone-based difficulty only needs approximate attribution.
        {
          let nearestId = localPlayerId;
          let nearestDistSq = Infinity;
          networkPlayers.forEach((p, pid) => {
            const dx = p.mesh.position.x - enemy.position.x;
            const dy = p.mesh.position.y - enemy.position.y;
            const dz = p.mesh.position.z - enemy.position.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq;
              nearestId = pid;
            }
          });
          const tracker = getOrCreateDDATracker(nearestId);
          tracker.recordKill(enemy.scoreValue);

          // PlayerLevel kill attribution: count kill for local player progression
          if (nearestId === localPlayerId) {
            playerLevel.addKill();
          }
        }

        // Clean up: unregister from instance manager before removing from scene
        enemyInstanceManager.unregister(enemy);
        if (enemy.mesh) {
          scene.remove(enemy.mesh);
        }
        // Remove auxiliary scene objects (e.g. Snake.segmentRoot, Painter.trailRoot).
        // These are added to the scene by EnemySpawner but not children of enemy.mesh,
        // so they must be removed explicitly to prevent ghost entities.
        for (const aux of enemy.auxiliaryObjects) scene.remove(aux);
        networkEnemies.delete(id);
        enemyTargetUV.delete(id);

        // Clean up glow trail for fast enemies
        const enemyTrail = enemyGlowTrails.get(id);
        if (enemyTrail) {
          scene.remove(enemyTrail.root);
          enemyTrail.dispose();
          enemyGlowTrails.delete(id);
        }
      }
    });

    // ----- Sync bullets -----
    // Use a simpler approach: clear all bullets not in server state,
    // update existing ones, spawn new ones. Avoid O(n*poolSize) scan.
    const activeBulletIds = new Set<string>();

    state.bullets.forEach((bullet: NetworkBulletState) => {
      activeBulletIds.add(bullet.id);
      const existingIdx = bulletIdToIndex.get(bullet.id);

      if (existingIdx !== undefined) {
        // Store target UV for interpolation in onRender (same pattern as enemies).
        // Previously this snapped position directly at patch rate, causing stutter.
        // Now onRender lerps smoothly toward the target every frame.
        bulletTargetUV.set(bullet.id, {
          u: bullet.x, v: bullet.y,
          dirX: bullet.dirX, dirY: bullet.dirY,
        });
      } else {
        // New bullet: find an inactive pool slot and activate it directly.
        // We CANNOT call bulletPool.spawn() because it internally calls
        // findInactive() which may find a DIFFERENT slot than newIdx,
        // causing bulletIdToIndex to point to the wrong bullet (race condition).
        // Instead, set the pool data at the found index directly via public API.
        const newIdx = bulletPool.findInactiveSlot();
        if (newIdx >= 0) {
          const sp: SurfacePoint = surf.getPoint(bullet.x, bullet.y);
          // Activate the slot directly (no spawn() call, no index mismatch)
          const b = bulletPool.getBulletData(newIdx);
          b.alive = true;
          b.age = 0;
          b.surfaceU = bullet.x;
          b.surfaceV = bullet.y;
          b.angle = Math.atan2(bullet.dirY, bullet.dirX);
          b.dirX = bullet.dirX;
          b.dirY = bullet.dirY;
          b.dirZ = bullet.dirZ;
          // Position the line visual (uses pre-allocated temp vector)
          _netTempPos.copy(sp.position).addScaledVector(sp.normal, 0.02);
          const line = bulletPool.getLine(newIdx);
          line.position.copy(_netTempPos);
          line.visible = true;
          // Orient line to face direction on the surface.
          // bullet.dirX/dirY are UV-space direction (cos/sin of aimAngle).
          // Convert to 3D world direction using the surface tangent frame:
          // 3D_direction = dirX * tangentU + dirY * tangentV
          // Without this conversion, bullets point in arbitrary world-space
          // directions because UV axes don't align with XYZ axes on curved surfaces.
          _netTempDir.set(0, 0, 0)
            .addScaledVector(sp.tangentU, bullet.dirX)
            .addScaledVector(sp.tangentV, bullet.dirY)
            .normalize();
          line.lookAt(_netTempPos.copy(line.position).add(_netTempDir));
          bulletIdToIndex.set(bullet.id, newIdx);
          // Store initial target for interpolation
          bulletTargetUV.set(bullet.id, {
            u: bullet.x, v: bullet.y,
            dirX: bullet.dirX, dirY: bullet.dirY,
          });
          // Store owner's weapon type for visual assignment in the render loop.
          // Look up ownerId → player.weaponType from current state snapshot.
          // This replaces the UV proximity heuristic and works for ALL players.
          const ownerPlayer = state.players.get(bullet.ownerId);
          const ownerWeapon = SERVER_TO_WEAPON_TYPE[ownerPlayer?.weaponType ?? 'standard'] ?? WeaponType.Standard;
          bulletWeaponType.set(bullet.id, ownerWeapon);
        }
      }
    });

    // Remove bullets no longer in server state
    bulletIdToIndex.forEach((idx, id) => {
      if (!activeBulletIds.has(id)) {
        bulletPool.kill(idx);
        bulletIdToIndex.delete(id);
        bulletTargetUV.delete(id);
        bulletWeaponType.delete(id);
        // Remove from instanced rendering
        bulletInstanceManager.removeBullet(id);
        bulletInstanceIds.delete(id);
      }
    });

    // ----- Sync geoms -----
    const activeGeomIds = new Set<string>();

    state.geoms.forEach((geom: NetworkGeomState) => {
      if (!geom.active) return;
      activeGeomIds.add(geom.id);

      if (geomIdToIndex.has(geom.id)) {
        // Store target UV for interpolation in onRender (same pattern as bullets/enemies).
        geomTargetUV.set(geom.id, { u: geom.surfaceU, v: geom.surfaceV });
      } else {
        // New geom: find inactive slot and activate directly via public API.
        // We CANNOT call geomPool.spawn() because it internally calls
        // findInactive() which may find a DIFFERENT slot, causing
        // geomIdToIndex to point to the wrong geom (same race condition
        // as bullets). Also, if no slot is found, we skip instead of
        // spawning an untracked geom that would leak.
        const newIdx = geomPool.findInactiveSlot();
        if (newIdx >= 0) {
          // Activate the slot directly (no spawn() call, no index mismatch)
          const g = geomPool.getGeomData(newIdx);
          g.alive = true;
          g.age = 0;
          g.surfaceU = geom.surfaceU;
          g.surfaceV = geom.surfaceV;
          g.velU = 0;
          g.velV = 0;
          g.magnetSpeed = 0;
          g.attracted = false;
          // Make mesh visible
          const mesh = geomPool.getMesh(newIdx);
          if (mesh) {
            mesh.visible = true;
          }
          geomIdToIndex.set(geom.id, newIdx);
          geomTargetUV.set(geom.id, { u: geom.surfaceU, v: geom.surfaceV });
        }
        // If no inactive slot found, skip spawning. Better to miss a geom
        // than leak an untracked entity that can never be cleaned up.
      }
    });

    // Remove geoms no longer in server state
    geomIdToIndex.forEach((idx, id) => {
      if (!activeGeomIds.has(id)) {
        geomPool.kill(idx);
        geomIdToIndex.delete(id);
        geomTargetUV.delete(id);
      }
    });

    // ----- Sync weapon pickups (using real WeaponPickup class) -----
    const activePickupIds = new Set<string>();
    state.weaponPickups.forEach((netPickup: NetworkWeaponPickupState) => {
      if (!netPickup.active) return;
      activePickupIds.add(netPickup.id);

      let pickup = networkWeaponPickups.get(netPickup.id);
      if (!pickup) {
        // Create a real WeaponPickup (same as co-op)
        const weaponType = SERVER_TO_WEAPON_TYPE[netPickup.weaponType] ?? WeaponType.Spread;
        pickup = new WeaponPickup(weaponType, netPickup.surfaceU, netPickup.surfaceV);
        scene.add(pickup.mesh);
        networkWeaponPickups.set(netPickup.id, pickup);
      }

      // Update position from server
      pickup.surfaceU = netPickup.surfaceU;
      pickup.surfaceV = netPickup.surfaceV;
      if (getTransform) {
        pickup.applySurfaceTransform(getTransform);
      }
    });

    // Remove collected/expired pickups
    networkWeaponPickups.forEach((pickup, id) => {
      if (!activePickupIds.has(id)) {
        scene.remove(pickup.mesh);
        pickup.dispose();
        networkWeaponPickups.delete(id);
      }
    });

    // ----- Update UI -----
    const localPlayer = state.players.get(localPlayerId);
    if (localPlayer) {
      // Score display with multiplier color (same logic as single player)
      const m = localPlayer.multiplier;
      let mColor = '#0f0';
      if (m >= 100) mColor = '#ff00ff';
      else if (m >= 50) mColor = '#ff8800';
      else if (m >= 20) mColor = '#ffff00';
      else if (m >= 5) mColor = '#00ff88';

      // Lives display (hearts, same as single player)
      const lives = Math.max(0, localPlayer.lives);
      const livesStr = lives <= 5
        ? '\u2665'.repeat(lives)
        : `\u2665 x${lives}`;

      // Bombs display
      const bombs = Math.max(0, localPlayer.bombs);
      const bombsStr = bombs <= 5
        ? '\u25cf'.repeat(bombs)
        : `\u25cf x${bombs}`;

      scoreEl.innerHTML =
        `Score: ${localPlayer.score.toLocaleString()}<br>` +
        `<span style="color:${mColor}">x${localPlayer.multiplier}</span><br>` +
        `${livesStr}<br>` +
        `${bombsStr}`;

      // Weapon display (legacy text fallback)
      const wName = localPlayer.weaponType.replace(/_/g, ' ').toUpperCase();
      const ammoStr = localPlayer.weaponAmmo < 0 ? '' : ` [${localPlayer.weaponAmmo}]`;
      weaponEl.textContent = wName === 'STANDARD' ? '' : `${wName}${ammoStr}`;

      // WeaponHUD — graphical weapon panel (same as single-player)
      const activeWeaponType = SERVER_TO_WEAPON_TYPE[localPlayer.weaponType] ?? WeaponType.Standard;
      const hudInventory: WeaponInventoryEntry[] = [{ type: WeaponType.Standard, ammo: -1, stacks: 1 }];
      if (activeWeaponType !== WeaponType.Standard) {
        hudInventory.push({ type: activeWeaponType, ammo: localPlayer.weaponAmmo, stacks: 1 });
      }
      weaponHUD.update(hudInventory, activeWeaponType);

      // Sync local weapon manager to server-authoritative weapon type.
      // Only update if the weapon type changed to avoid unnecessary re-stacking.
      if (activeWeaponType !== localPlayerWeaponType) {
        localPlayerWeaponType = activeWeaponType;
        // forceSetWeapon() always switches currentWeapon (unlike equipWeapon which
        // has conditional auto-switch logic that can leave currentWeapon stale when
        // switching between two non-Standard weapons, breaking SPECIAL_VISUAL_WEAPONS effects).
        // Set a large ammo reserve so the WeaponManager can fire visuals freely.
        // Actual ammo/damage is server-authoritative; we only need the visual effect.
        const ammoReserve = activeWeaponType !== WeaponType.Standard ? 999 : undefined;
        localWeaponManager.forceSetWeapon(activeWeaponType, ammoReserve);
      }
    }

    // Player list
    // Combined team score — sum of all player scores
    let combinedScore = 0;
    let playerList = '<b>Players:</b><br>';
    state.players.forEach((p: NetworkPlayerState) => {
      combinedScore += p.score;
      const you = p.id === localPlayerId ? ' (YOU)' : '';
      const status = p.alive ? '' : ' [DEAD]';
      playerList += `${p.name}${you}: ${p.score.toLocaleString()}${status}<br>`;
    });
    playersEl.innerHTML = playerList;
    if (teamScoreEl) teamScoreEl.textContent = combinedScore.toLocaleString();

    // Sync pause state from server
    if (state.isPaused !== isPaused) {
      showPauseOverlay(state.isPaused);
    }

    // ---- Room phase handling (voting lobby state machine) ----
    const newPhase = state.roomPhase || 'lobby';
    if (newPhase !== currentRoomPhase) {
      netMainLog(`[NetworkMain] roomPhase: ${currentRoomPhase} → ${newPhase}`);

      if (newPhase === 'voting') {
        // Game ended — transition to voting screen.
        // Hide GameOverScreen if it snuck in (from the old gameOver bool path).
        gameOverScreen.hide();
        // Show VotingScreen stub
        votingScreen.show(state, isHost, localPlayerId);
      } else if (newPhase === 'playing' && currentRoomPhase === 'voting') {
        // New game starting after vote — reset and launch.
        votingScreen.hide();
        resetGameEntities();
        // initSurface at the top of onStateChange already handles surface reinit
        // (called with state.surfaceType and confirmedFromServer=true).
      } else if (newPhase === 'playing' && currentRoomPhase === 'lobby') {
        // Initial game start: lobby → playing.
        // Reset entities (safe to call even when empty — clears any stale state).
        resetGameEntities();
        gameOverScreen.hide();
        votingScreen.hide();
      } else if (newPhase === 'lobby') {
        votingScreen.hide();
        gameOverScreen.hide();
      }

      currentRoomPhase = newPhase;
    }

    // If currently in voting phase, keep VotingScreen updated with latest state
    if (currentRoomPhase === 'voting') {
      votingScreen.update(state, isHost, localPlayerId);
    }

    // Game state — derive status text from roomPhase + legacy flags
    if (currentRoomPhase === 'voting') {
      statusEl.textContent = 'VOTING';
      startBtn.style.display = 'none';
    } else if (state.gameStarted && currentRoomPhase === 'playing') {
      statusEl.textContent = state.isPaused ? 'PAUSED' : `Wave ${state.waveNumber}`;
      startBtn.style.display = 'none';
    } else if (state.gameOver && currentRoomPhase !== 'voting') {
      // Legacy path: gameOver flag (pre-voting-state-machine servers or initial game)
      statusEl.textContent = 'GAME OVER';
      startBtn.style.display = 'none';
      if (!gameOverShown) {
        gameOverShown = true;
        const localPlayer = state.players.get(localPlayerId);
        const score = localPlayer?.score ?? 0;
        gameOverScreen.show(score, lastCreatedSurfaceType || 'sphere', 'network');
      }
    } else if (currentRoomPhase === 'lobby' || (!state.gameStarted && !state.gameOver)) {
      if (isHost) {
        // Host sees the Start Game button — only the host can trigger game start.
        statusEl.textContent = 'Waiting for players... (Host: press START GAME)';
        startBtn.style.display = 'block';
      } else {
        // Non-host: show waiting message, no button (server-side guard rejects non-host starts).
        statusEl.textContent = 'Waiting for host to start the game...';
        startBtn.style.display = 'none';
      }
    }
  }

  // -----------------------------------------------------------------------
  // Connect to server
  // -----------------------------------------------------------------------

  const urlSurfaceType = getUrlSurfaceType();
  const playerName = getPlayerName();
  const serverUrl = getServerUrl();

  // Always log connection details — essential for LAN debugging
  console.log('[NetworkMain] === LAN CONNECTION INFO ===');
  console.log(`[NetworkMain] Server URL:  ${serverUrl}`);
  console.log(`[NetworkMain] Page URL:    ${window.location.href}`);
  console.log(`[NetworkMain] Player name: ${playerName}`);
  console.log(`[NetworkMain] Surface:     ${urlSurfaceType}`);
  console.log('[NetworkMain] Connecting...');

  // 30-second connection timeout: if Colyseus handshake hangs (server reachable
  // but not responding — common on mobile over Wi-Fi), reject with a clear error
  // instead of waiting forever.
  const CONNECTION_TIMEOUT_MS = 30_000;
  let connectionResolved = false;
  const timeoutId = setTimeout(() => {
    if (!connectionResolved) {
      network.disconnect();
      // Synthesise a timeout error that feeds into the existing .catch() handler
      const timeoutError = new Error(
        `Connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s. ` +
        `Is the server running and reachable from this device?`
      );
      // Manually trigger the catch path by re-running the error UI inline
      statusEl.style.display = 'none';
      const errPanel = document.createElement('div');
      errPanel.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.92);z-index:200;' +
        'display:flex;flex-direction:column;justify-content:center;align-items:center;' +
        'font-family:monospace;padding:20px;box-sizing:border-box;';
      const title = document.createElement('div');
      title.style.cssText = 'color:#f44;font-size:32px;font-weight:bold;letter-spacing:4px;margin-bottom:12px;text-align:center;';
      title.textContent = 'CONNECTION TIMED OUT';
      errPanel.appendChild(title);
      const reason = document.createElement('div');
      reason.style.cssText = 'color:#faa;font-size:14px;margin-bottom:24px;max-width:600px;text-align:center;';
      reason.textContent = timeoutError.message;
      errPanel.appendChild(reason);
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:16px;margin-top:8px;flex-wrap:wrap;justify-content:center;';
      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'RETRY';
      retryBtn.style.cssText = 'padding:12px 28px;font:bold 16px monospace;background:#060;color:#0f0;border:2px solid #0f0;cursor:pointer;letter-spacing:2px;';
      retryBtn.onclick = () => window.location.reload();
      btns.appendChild(retryBtn);
      const backBtnEl = document.createElement('button');
      backBtnEl.textContent = '◀ MAIN MENU';
      backBtnEl.style.cssText = 'padding:12px 28px;font:bold 16px monospace;background:#110;color:#888;border:2px solid #446;cursor:pointer;letter-spacing:2px;';
      backBtnEl.onclick = () => { window.location.href = window.location.pathname; };
      btns.appendChild(backBtnEl);
      errPanel.appendChild(btns);
      document.body.appendChild(errPanel);
      console.error(`[NetworkMain] Connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`);
    }
  }, CONNECTION_TIMEOUT_MS);

  network.connect({
    name: playerName,
    surfaceType: urlSurfaceType,
  }).then(() => {
    connectionResolved = true;
    clearTimeout(timeoutId);
    localPlayerId = network.getLocalPlayerId();
    console.log(`[NetworkMain] Connected! Session ID: ${localPlayerId}`);
    console.log(`[NetworkMain] Server: ${serverUrl}`);
    // Try to detect host status, but this may be wrong if state hasn't decoded.
    // onStateChange will re-check and correct this.
    const serverHostId = network.getServerHostId();
    isHost = serverHostId !== '' && localPlayerId === serverHostId;
    if (isHost) {
      console.log('[NetworkMain] This client is the HOST');
      stopServerBtn.style.display = 'block';
    }

    // Use URL surface type as initial guess (NOT server state, which may be
    // stale 'sphere' default). The authoritative surface type will come from
    // onStateChange and override this if different.
    initSurface(urlSurfaceType, false);

    // Show Start Game button immediately if we're the host; onStateChange will
    // re-evaluate this on every state update with the authoritative isHost value.
    if (isHost) {
      statusEl.textContent = 'Connected! You are the HOST — press START GAME.';
      startBtn.style.display = 'block';
    } else {
      statusEl.textContent = 'Connected! Waiting for host to start the game...';
      startBtn.style.display = 'none';
    }

    network.setCallbacks({
      onStateChange,
      onGameStart: () => {
        statusEl.textContent = 'Game starting...';
        startBtn.style.display = 'none';
        gameOverShown = false; // Reset so GameOverScreen can show next game over
        gameOverScreen.hide(); // Dismiss any lingering game over screen
        votingScreen.hide();  // Dismiss voting screen (roomPhase → playing)
        // Start background music (route through compressor to prevent clipping)
        const audioCtx = sound.getAudioContext();
        if (audioCtx) {
          const compressor = sound.getCompressor();
          bgMusic.start(audioCtx, compressor ?? undefined);
        }
      },
      onGameOver: () => {
        bgMusic.stop();
        // Show styled GameOverScreen instead of bare text
        if (!gameOverShown) {
          gameOverShown = true;
          const localPlayer = networkPlayers.get(localPlayerId);
          const score = localPlayer?.score ?? 0;
          gameOverScreen.show(score, lastCreatedSurfaceType || 'sphere', 'network');
        }
        // Clear all pending warning rings when game ends
        for (const w of spawnWarningRings) {
          scene.remove(w.mesh);
          (w.mesh.material as THREE.MeshBasicMaterial).dispose();
        }
        spawnWarningRings.length = 0;
      },
      onPreSpawn: (data: { type: string; u: number; v: number }) => {
        // Create a standalone pulsing red ring at the spawn position.
        // Does NOT require enemySpawner.update() — animated independently in onRender.
        if (!getTransform) return;
        const t = getTransform(data.u, data.v);
        const mat = warningRingBaseMaterial.clone();
        const mesh = new THREE.Mesh(warningRingGeometry, mat);
        mesh.position.copy(t.position).addScaledVector(t.normal, 0.05);
        mesh.lookAt(mesh.position.clone().add(t.normal));
        scene.add(mesh);
        spawnWarningRings.push({ mesh, u: data.u, v: data.v, spawnedAt: performance.now() });
      },
      onError: (err) => {
        statusEl.textContent = `Error: ${err.message}`;
      },
      onHostLeft: () => {
        handleConnectionLost('Host disconnected from the game.');
      },
      onHostChanged: (newHostId: string) => {
        // isHost is updated via onStateChange (state.hostId sync), but give
        // immediate visual feedback here before the next state patch arrives.
        if (newHostId === localPlayerId) {
          isHost = true;
          stopServerBtn.style.display = 'block';
          statusEl.textContent = 'You are now the host!';
          statusEl.style.color = '#0ff';
          netMainLog('[NetworkMain] Host role transferred to this client');
        }
      },
      onGameEnded: () => {
        handleConnectionLost('The host has ended the game.');
      },
      onDisconnected: (code: number) => {
        // Fired when the WebSocket closes for any reason (server crash, network
        // drop, etc.). Only show the overlay if not already handled by a more
        // specific callback (e.g. onHostLeft) and not a deliberate disconnect
        // (code 1000 = normal closure triggered by our own disconnect() call).
        if (!connectionLost && code !== 1000) {
          handleConnectionLost(`Server connection closed (code ${code}).`);
        }
      },
      onStartupHash: (hash: string) => {
        // Check if we have fresh cached startup config for this server version.
        const hit = isStartupCacheFresh(hash);
        netMainLog(`[NetworkMain] startup_hash=${hash} cache=${hit ? 'HIT' : 'MISS'}`);
        // Save hash so onStartupConfig can store it with the cached payload.
        pendingStartupHash = hash;
        network.sendStartupCacheAck(hit);
      },
      onStartupConfig: (config: NetworkStartupConfig) => {
        // Cache miss: server sent the full config. Persist it to localStorage
        // using the hash we received in the prior startup_hash message.
        if (!pendingStartupHash) return;
        const cacheData: StartupConfigData = {
          weaponConfigs: config.weaponConfigs,
          serverVersion: config.serverVersion,
        };
        setStartupCache(pendingStartupHash, cacheData);
        netMainLog(`[NetworkMain] startup_config cached (hash=${pendingStartupHash})`);
        pendingStartupHash = null;
      },
    });
  }).catch((err) => {
    connectionResolved = true; // Prevent the timeout handler from also showing an error
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    const isServerDown = msg.includes('Cannot reach') || msg.includes('ERR_EMPTY_RESPONSE')
      || msg.includes('ProgressEvent') || msg.includes('ECONNREFUSED');

    // Replace the small status text with a full-screen error panel so the
    // cause and fix are immediately visible without opening DevTools.
    statusEl.style.display = 'none';

    const errPanel = document.createElement('div');
    errPanel.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.92);z-index:200;' +
      'display:flex;flex-direction:column;justify-content:center;align-items:center;' +
      'font-family:monospace;padding:20px;';

    const title = document.createElement('div');
    title.style.cssText = 'color:#f44;font-size:32px;font-weight:bold;letter-spacing:4px;margin-bottom:12px;';
    title.textContent = isServerDown ? 'SERVER UNREACHABLE' : 'CONNECTION FAILED';
    errPanel.appendChild(title);

    const reason = document.createElement('div');
    reason.style.cssText = 'color:#faa;font-size:14px;margin-bottom:24px;max-width:600px;text-align:center;';
    reason.textContent = isServerDown
      ? `Could not reach game server at ${serverUrl}`
      : `Error: ${msg.slice(0, 120)}`;
    errPanel.appendChild(reason);

    // Possible-cause checklist (always visible)
    const healthUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const isHttps = window.location.protocol === 'https:';
    // Detect WSL2 internal IP (172.16–31.x.x range, typically 172.28.x.x for WSL2)
    const hostname = window.location.hostname;
    const isWSL2Ip = /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname);
    const steps = [
      isServerDown
        ? '1. Is the "Geometry Wars Server" window open and running on the host PC?'
        : '1. The server started but the handshake failed — try RETRY below',
      `2. Firewall: Windows must allow inbound TCP on port 2567`,
      '3. Both devices must be on the same WiFi / LAN',
      isHttps
        ? '4. ⚠ You are on HTTPS — change to http:// to allow WebSocket connections'
        : `4. Test server health: open ${healthUrl}/health in a browser tab`,
      ...(isWSL2Ip ? [
        `5. ⚠ WSL2 IP detected (${hostname}) — this IP is unreachable from other devices!`,
        '   Use the Windows LAN IP (192.168.x.x) shown in the host screen instead.',
        '   Run Setup-WSL-LAN.bat as Administrator to enable port forwarding.',
      ] : []),
    ];
    const list = document.createElement('div');
    list.style.cssText = 'color:#888;font-size:13px;margin-bottom:24px;text-align:left;max-width:600px;line-height:1.9;';
    list.innerHTML = steps.map(s => `<div>${isWSL2Ip && s.startsWith('5.') ? `<span style="color:#fa0">${s}</span>` : s}</div>`).join('');
    if (isHttps) {
      list.querySelector('div:last-child')!.setAttribute('style', 'color:#fa0;');
    }
    errPanel.appendChild(list);

    // Diagnostic link
    const diagLink = document.createElement('a');
    diagLink.href = '/lan-test.html';
    diagLink.textContent = '🔍 Run LAN Diagnostics';
    diagLink.style.cssText =
      'color:#0af;font-size:14px;margin-bottom:20px;letter-spacing:1px;';
    errPanel.appendChild(diagLink);

    // Retry + back buttons
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:16px;margin-top:8px;';

    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'RETRY CONNECTION';
    retryBtn.style.cssText =
      'padding:12px 28px;font:bold 16px monospace;background:#060;color:#0f0;' +
      'border:2px solid #0f0;cursor:pointer;letter-spacing:2px;';
    retryBtn.onclick = () => window.location.reload();
    btns.appendChild(retryBtn);

    const backBtnInPanel = document.createElement('button');
    backBtnInPanel.textContent = '◀ MAIN MENU';
    backBtnInPanel.style.cssText =
      'padding:12px 28px;font:bold 16px monospace;background:#110;color:#888;' +
      'border:2px solid #446;cursor:pointer;letter-spacing:2px;';
    backBtnInPanel.onclick = () => { window.location.href = window.location.pathname; };
    btns.appendChild(backBtnInPanel);

    errPanel.appendChild(btns);
    document.body.appendChild(errPanel);

    // Also log detailed info for DevTools users
    console.error('[NetworkMain] === CONNECTION FAILED ===');
    console.error(`[NetworkMain] Server URL: ${serverUrl}`);
    console.error(`[NetworkMain] Error: ${msg}`);
    console.error('[NetworkMain] --- TROUBLESHOOTING CHECKLIST ---');
    console.error('[NetworkMain] 1. Is the "Geometry Wars Server" window open and running?');
    console.error(`[NetworkMain] 2. Can you reach ${healthUrl}/health in a browser tab?`);
    console.error('[NetworkMain] 3. If connecting from another PC:');
    console.error('[NetworkMain]    - Use the HOST PC LAN IP (e.g. 192.168.x.x:3000), NOT localhost');
    console.error('[NetworkMain]    - Check Windows Firewall is allowing port 2567');
    console.error('[NetworkMain]    - Both PCs must be on the same WiFi/LAN');
    if (isHttps) {
      console.error('[NetworkMain] 4. *** HTTPS DETECTED *** — ws:// WebSocket blocked by mixed-content policy');
      console.error(`[NetworkMain]    Access the game via http:// instead of https://`);
    }
    console.error('[NetworkMain] Full error:', err);
    console.error(`[NetworkMain] Run LAN diagnostics: ${window.location.origin}/lan-test.html`);
  });

  // -----------------------------------------------------------------------
  // Game loop (same structure as co-op)
  // -----------------------------------------------------------------------

  // Cached dt from onFixedUpdate for use in onRender (which has no dt param).
  // Default to 1/60 so camera orbit reset works correctly on first frame.
  let lastFixedDt = 1 / 60;

  game.onFixedUpdate = (dt: number) => {
    if (!surfaceReady || !surface) return;
    lastFixedDt = dt;

    // Update adaptive quality system (FPS monitoring + quality level adjustment).
    // Runs even when paused so the monitor stays warm and doesn't misfire on resume.
    adaptiveQuality.update(dt);

    // Don't process input or game logic while paused
    // (server already stops its tick, but we also skip client-side updates)
    if (isPaused) return;

    // -- Send input to server --
    const inputState = input.getState();
    const mouseX = inputState.aimX;
    const mouseY = inputState.aimY;
    const aimAngle = Math.atan2(-mouseY, mouseX);

    lastInputSendTime += dt;
    // Skip input sending and client-side prediction while local menu is open.
    // The server was already sent zero-input when the menu opened, so the player
    // stays frozen on the server. Visual systems (particles, etc.) still update.
    if (!localMenuOpen && network.isConnected() && lastInputSendTime >= INPUT_SEND_INTERVAL) {
      // Negate moveY (same fix as before: W = screen up = -moveY, but
      // server expects +moveY = move up on surface)
      const currentInput = {
        moveX: inputState.moveX,
        moveY: -inputState.moveY,
        aimAngle,
        shooting: inputState.shooting,
        bomb: inputState.bomb,
      };

      const changed = !lastSentInput
        || currentInput.moveX !== lastSentInput.moveX
        || currentInput.moveY !== lastSentInput.moveY
        || Math.abs(currentInput.aimAngle - lastSentInput.aimAngle) > 0.02
        || currentInput.shooting !== lastSentInput.shooting
        || currentInput.bomb !== lastSentInput.bomb;

      if (changed) {
        network.sendInput(currentInput);
        lastSentInput = { ...currentInput };
        lastInputSendTime = 0;
      }

      // Client-side prediction: apply local player movement AND aim immediately
      // so it feels responsive. The server position will override on next
      // onStateChange, but the visual lag between input and response is
      // eliminated. Uses the same PLAYER_SPEED (0.095 UV/s) as the server.
      // MUST match server physics (including sin(phi) correction) to avoid
      // rubber-banding.
      //
      // CRITICAL FIX (audit #1): Previously prediction ONLY ran when
      // moveX/moveY were non-zero. This meant aim angle updates (turning
      // while standing still) waited for server response = 16-33ms lag.
      // Now prediction ALWAYS runs for the local player, applying:
      // - Movement (when WASD is held)
      // - Aim orientation (always, even when stationary)
      // This matches co-op where aim updates INSTANTLY every frame.
      const localPlayer = networkPlayers.get(localPlayerId);
      if (localPlayer && surface) {
        const isMoving = currentInput.moveX !== 0 || currentInput.moveY !== 0;

        if (isMoving) {
          const predSpeed = 0.095; // Must match server PLAYER_SPEED
          let predDx = currentInput.moveX * predSpeed * dt;
          const predDy = currentInput.moveY * predSpeed * dt;

          // Apply sin(phi) correction for sphere-like surfaces (matches server)
          const surfType = lastCreatedSurfaceType;
          const isSphereLike = surfType === 'sphere' || surfType === 'sphere-tunnel'
            || surfType === 'icosahedron' || surfType === 'capsule'
            || surfType === 'peanut';
          if (isSphereLike) {
            const phi = localPlayer.surfaceV * Math.PI;
            const sinPhi = Math.sin(phi);
            const clampedSinPhi = Math.max(sinPhi, 0.3);
            predDx = predDx / clampedSinPhi;
          }

          let newU = localPlayer.surfaceU + predDx;
          let newV = localPlayer.surfaceV + predDy;

          // Wrap U, clamp/wrap V (matches server logic exactly).
          const wrapsInV = surfType === 'torus' || surfType === 'pipe'
            || surfType === 'mobius' || surfType === 'cube-ring'
            || surfType === 'cube-tunnel';
          newU = ((newU % 1) + 1) % 1;
          if (wrapsInV) {
            newV = ((newV % 1) + 1) % 1;
          } else if (surfType === 'sphere') {
            // Sphere pole traversal: reflect V through north/south pole (matches server).
            if (newV < 0) {
              newV = -newV;
              newU = ((newU + 0.5) % 1 + 1) % 1;
            } else if (newV > 1) {
              newV = 2 - newV;
              newU = ((newU + 0.5) % 1 + 1) % 1;
            }
            newV = Math.max(0.001, Math.min(0.999, newV));
          } else {
            const vMin = surfType === 'cube' ? 0.003 : 0.05;
            const vMax = surfType === 'cube' ? 0.997 : 0.95;
            newV = Math.max(vMin, Math.min(vMax, newV));
          }

          localPlayer.surfaceU = newU;
          localPlayer.surfaceV = newV;
        }

        // ALWAYS update visual position + aim orientation (even when stationary).
        // This ensures aim direction updates instantly without waiting for server.
        const sp = surface.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
        localPlayer.mesh.position.copy(sp.position).multiplyScalar(currentMapSizeScaleFactor);
        localPlayer.mesh.position.addScaledVector(sp.normal, 0.15);
        orientPlayerOnSurface(localPlayer, sp.normal, aimAngle, sp.tangentU);

        // Update glow trail (only meaningful when moving, but cheap to call always)
        if (isMoving) {
          const trail = playerGlowTrails.get(localPlayerId);
          if (trail) trail.addPoint(localPlayer.mesh.position.clone());
        }
      }

      // Play shoot sound locally for responsiveness
      if (currentInput.shooting) {
        shootSoundTimer -= dt;
        if (shootSoundTimer <= 0) {
          sound.play('shoot', { pitch: 0.9 + Math.random() * 0.2 });
          shootSoundTimer = 0.1;
        }
      } else {
        shootSoundTimer = 0;
      }
    }

    // -- Fire special weapon visuals for local player --
    // Only for instant/field weapons not represented in server bullet state.
    // Called here (after input is read) so visuals appear immediately on key-hold.
    // Uses inputState.shooting (available at outer scope) instead of currentInput
    // (which is only defined inside the network send block).
    if (inputState.shooting && !localMenuOpen && network.isConnected()
        && SPECIAL_VISUAL_WEAPONS.has(localPlayerWeaponType)) {
      const localPlayer = networkPlayers.get(localPlayerId);
      if (localPlayer && surface) {
        const sp = surface.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
        const origin = sp.position.clone().multiplyScalar(currentMapSizeScaleFactor).addScaledVector(sp.normal, 0.2);
        // Compute world-space aim direction from aimAngle + surface tangent frame
        const aimDir = new THREE.Vector3()
          .addScaledVector(sp.tangentU, Math.cos(aimAngle))
          .addScaledVector(sp.tangentV, Math.sin(aimAngle))
          .normalize();
        localWeaponManager.playerPositionRef = origin;
        localWeaponManager.fire(origin, aimDir, game.clock.totalTime, sp.normal);
      }
    }
    localWeaponManager.update(dt);

    // -- Update visual systems (same as co-op) --
    particles.update(dt);
    scorePopups.update(dt);
    screenShake.update(dt);
    shockwaveEffect.update(dt, game.clock.totalTime);
    surface.updateGrid(dt);
    killLog.update(dt);
    allyGlowManager.update(dt);
    glowManager.update(dt);

    // NOTE: We do NOT call enemySpawner.update() here. That method runs full
    // enemy AI (movement toward player, separation, spawn warnings) which is
    // wasted work because the server is authoritative and onStateChange
    // overrides all positions. On same-PC with two tabs, the CPU was running:
    // server game logic + tab 1 enemy AI + tab 2 enemy AI, all redundantly.
    // Spawn warnings are also unnecessary since network enemies appear instantly.

    // Update glow trails
    playerGlowTrails.forEach((trail) => trail.update(dt));
    enemyGlowTrails.forEach((trail) => trail.update(dt));

    // Update geom pool (magnetic pull animation toward local player)
    const localPlayer = networkPlayers.get(localPlayerId);
    if (localPlayer) {
      // Use surfaceU/V directly (avoids worldToSurface which assumes unscaled world coords)
      geomPool.update(dt, localPlayer.surfaceU, localPlayer.surfaceV, game.clock.totalTime);

      // Update PlayerLevel aura ring (position + pulse animation each frame)
      const auraPoint = surface.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
      const auraPos = auraPoint.position.clone().multiplyScalar(currentMapSizeScaleFactor);
      playerLevel.update(dt, auraPos, auraPoint.normal);

      // Tick buff proc effects (ShockAura arcs, Burning DOT visuals).
      // Server is authoritative for enemy HP; local damage from ShockAura is a visual-side
      // effect accepted here (same precedent as companion bullet hits in MP).
      const enemiesForBuff = Array.from(networkEnemies.values());
      buffManager.update(dt, localPlayer.mesh.position, enemiesForBuff);

      // Update buff aura visuals
      const activeBuffs = buffManager.getActiveBuffs().map(b => ({ type: b.type, stacks: b.stacks }));

      // Enemy aura dimming: reduce aura opacity when enemies enter the aura zone
      // to keep enemies clearly visible even when buff stacks are high.
      if (activeBuffs.length > 0) {
        const DIM_THRESHOLD = 2.0;  // world units: start dimming
        const DIM_FULL = 0.5;       // world units: maximum dimming
        const pPos = localPlayer.mesh.position;
        let nearestDistSq = DIM_THRESHOLD * DIM_THRESHOLD;
        networkEnemies.forEach((e) => {
          if (!e.alive || !e.mesh) return;
          const dSq = pPos.distanceToSquared(e.mesh.position);
          if (dSq < nearestDistSq) nearestDistSq = dSq;
        });
        const nearestDist = Math.sqrt(nearestDistSq);
        const dimFactor = nearestDist <= DIM_FULL ? 1.0
          : 1.0 - (nearestDist - DIM_FULL) / (DIM_THRESHOLD - DIM_FULL);
        buffAuraRenderer.setDimmingFactor(dimFactor);
        buffParticleAura.setDimmingFactor(dimFactor);
      } else {
        buffAuraRenderer.setDimmingFactor(0);
        buffParticleAura.setDimmingFactor(0);
      }

      buffAuraRenderer.update(dt, game.clock.totalTime, localPlayer.mesh.position, auraPoint.normal, activeBuffs);
      buffParticleAura.update(dt, game.clock.totalTime, localPlayer.mesh.position, auraPoint.normal, activeBuffs);

      // Update companion + buff pickups, check collection
      if (getTransform) {
        for (let i = localCompanionPickups.length - 1; i >= 0; i--) {
          const cp = localCompanionPickups[i];
          if (!cp.active) {
            scene.remove(cp.mesh);
            cp.dispose();
            localCompanionPickups.splice(i, 1);
            continue;
          }
          cp.update(dt, game.clock.totalTime);
          cp.applySurfaceTransform(getTransform);
          if (cp.checkPlayerCollision(localPlayer.surfaceU, localPlayer.surfaceV)) {
            companionManager.addCompanion(cp.companionType);
            sound.play('weaponPickup', { volume: 0.5, pitch: 1.8 });
            cp.active = false;
          }
        }
        for (let i = localBuffPickups.length - 1; i >= 0; i--) {
          const bp = localBuffPickups[i];
          if (!bp.active) {
            scene.remove(bp.mesh);
            bp.dispose();
            localBuffPickups.splice(i, 1);
            continue;
          }
          bp.update(dt, game.clock.totalTime);
          bp.applySurfaceTransform(getTransform);
          if (bp.checkPlayerCollision(localPlayer.surfaceU, localPlayer.surfaceV)) {
            buffManager.addBuff(bp.buffType);
            sound.play('weaponPickup', { volume: 0.4, pitch: 1.2 });
            bp.active = false;
          }
        }
      }

      // Update companions (orbit player, shoot enemies)
      if (getTransform) {
        const aimDir = new THREE.Vector3()
          .addScaledVector(auraPoint.tangentU, Math.cos(aimAngle))
          .addScaledVector(auraPoint.tangentV, Math.sin(aimAngle))
          .normalize();
        const enemiesArray = Array.from(networkEnemies.values());
        companionManager.update(
          dt,
          localPlayer.surfaceU,
          localPlayer.surfaceV,
          localPlayer.mesh.position,
          aimDir,
          enemiesArray,
          companionBulletPool,
          0,
          auraPoint.normal,
          getTransform,
        );
      }
      companionBulletPool.update(dt);
      companionHUD.update(companionManager.getCompanionCounts());
    }

    shockArcRenderer.update(buffManager.shockArcs);
    buffHUD.update(buffManager.getActiveBuffs());

    // -----------------------------------------------------------------------
    // DDA system update (runs on all clients for metric tracking;
    // host can use DDA levels for future server-side spawn modification)
    // -----------------------------------------------------------------------
    {
      // Build ordered array of trackers for the engine
      const trackersArray: DDAPerformanceTracker[] = [];
      networkPlayers.forEach((player, id) => {
        const tracker = getOrCreateDDATracker(id);
        const alive = playerAliveState.get(id) ?? true;
        if (alive && surface) {
          // Compute nearest enemy distance in UV space for this player
          let nearestEnemyDist = 1.0;
          networkEnemies.forEach((enemy) => {
            if (!enemy.alive) return;
            const du = player.surfaceU - enemy.surfacePosition.u;
            const dv = player.surfaceV - enemy.surfacePosition.v;
            const dist = Math.sqrt(du * du + dv * dv);
            if (dist < nearestEnemyDist) nearestEnemyDist = dist;
          });

          // Player.lives is synced from server state in onStateChange
          tracker.update(dt, nearestEnemyDist, player.lives / 3);
        }

        // Sync player position for DDA zone detection
        const ddaIdx = tracker.playerIndex;
        if (ddaIdx < ddaPlayers.length) {
          ddaPlayers[ddaIdx].u = player.surfaceU;
          ddaPlayers[ddaIdx].v = player.surfaceV;
        }

        trackersArray.push(tracker);
      });

      // Update engine with all trackers (percentile ranking for multiplayer)
      if (trackersArray.length > 0) {
        ddaEngine.update(dt, trackersArray);
      }
    }

    // Scale music intensity by enemy count (same as co-op)
    bgMusic.setIntensity(Math.min(networkEnemies.size / 30, 1.0));

    // Update performance tracker for DebugOverlay (F3)
    perfTracker.setEntityCount(networkEnemies.size);
    perfTracker.setBulletCount(bulletIdToIndex.size);
    perfTracker.recordFrame(dt);

    // Send metrics to server every 500ms during active gameplay
    metricsAccumulator += dt;
    if (metricsAccumulator >= METRICS_SEND_INTERVAL && network.isConnected() && currentRoomPhase === 'playing') {
      metricsAccumulator -= METRICS_SEND_INTERVAL;
      const localPlayerState = networkPlayers.get(localPlayerId);
      const ddaTracker = ddaTrackerMap.get(localPlayerId);
      const ddaLevel = ddaTracker ? ddaEngine.getDDALevelSmooth(ddaTracker.playerIndex) : 0;
      const metrics: ClientMetricsPayload = {
        time: latestGameTime,
        fps: Math.round(perfTracker.fps),
        enemyCount: networkEnemies.size,
        bulletCount: bulletIdToIndex.size,
        score: localPlayerState?.score ?? 0,
        lives: localPlayerState?.lives ?? 0,
        waveNumber: latestWaveNumber,
        ddaLevel: Math.round(ddaLevel * 100) / 100,
        playerPowerLevel: playerLevel.level,
        activeWeapon: localPlayerWeaponType,
      };
      network.sendMetrics(metrics);
    }

    // Clear per-frame input
    input.endFrame();
  };

  game.onRender = () => {
    if (!surfaceReady || !surface || !getTransform) return;
    if (!surfaceConfirmedFromServer) return; // Wait for server-confirmed surface type before rendering entities

    const surf = surface;
    const transform = getTransform;

    // Skip all entity interpolation and game-state rendering while paused.
    // The scene still renders (via Game.ts EffectComposer) so the pause
    // overlay looks correct, but entities freeze in place.
    if (isPaused) {
      // Still update camera (so orbit controls work in pause) and debug overlay
      const localPlayer = networkPlayers.get(localPlayerId);
      if (localPlayer) {
        const sp = surf.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
        const cameraPos = sp.position.clone().multiplyScalar(currentMapSizeScaleFactor);
        cameraController.updateFromFrame(
          cameraPos,
          sp.normal,
          { tangent: sp.tangentU, bitangent: sp.tangentV },
          lastFixedDt,
        );
      }
      debugOverlay.update();
      return;
    }

    // -----------------------------------------------------------------------
    // Per-frame interpolation for enemies (60Hz lerp toward 30Hz targets)
    // THIS IS THE KEY FIX: previously enemies only moved on onStateChange
    // (30Hz), causing visible stutter. Now they smoothly interpolate every
    // render frame, matching how co-op updates enemies every frame.
    // -----------------------------------------------------------------------
    // LERP TUNING (Phase 3 — eliminate per-client render desync):
    // At 60fps, two clients rendering at different times will diverge by
    // up to LERP * remaining_delta per frame-time difference. A higher
    // lerp factor means faster convergence → smaller window of divergence.
    //   0.15 → ~30 frames (500ms) to reach 99% of target  [too slow]
    //   0.35 → ~12 frames (200ms) to reach 99% of target  ← chosen
    // At 0.35, max UV divergence between clients ≈ 0.35 * delta per 1-frame
    // timing skew. Empirically this keeps 3D separation < 0.5 world units.
    // NOTE: Newly spawned enemies are SNAPPED (not lerped) in onStateChange,
    // so there is no visible rubber-band on first appearance.
    const ENEMY_LERP = 0.35; // Phase 3: was 0.15; 12-frame convergence at 60fps
    networkEnemies.forEach((enemy, id) => {
      const target = enemyTargetUV.get(id);
      if (!target) return;

      // Lerp UV position toward server target each render frame
      enemy.surfacePosition.u += (target.u - enemy.surfacePosition.u) * ENEMY_LERP;
      enemy.surfacePosition.v += (target.v - enemy.surfacePosition.v) * ENEMY_LERP;

      // Apply surface transform to update 3D position from UV
      enemy.applySurfaceTransform(transform);

      // Add glow trail point for fast enemies (after position is updated)
      const enemyTrail = enemyGlowTrails.get(id);
      if (enemyTrail && enemy.mesh?.visible) {
        enemyTrail.addPoint(enemy.position.clone());
      }
    });

    // -----------------------------------------------------------------------
    // Update instanced enemy rendering with LOD support.
    // LODManager assigns HIGH/MEDIUM/LOW detail per enemy based on camera
    // distance. updateInstancesWithLOD() uses those assignments to select
    // simplified geometry for distant enemies, reducing GPU triangle load.
    // -----------------------------------------------------------------------
    const enemyArray = Array.from(networkEnemies.values());
    const lodAssignments = lodManager.update(camera, enemyArray);
    enemyInstanceManager.updateInstancesWithLOD(enemyArray, lodAssignments, camera);

    // -----------------------------------------------------------------------
    // View-based depth occlusion (S27b): dim enemies behind the surface.
    // Raycasts from camera to each enemy — counts surface intersections.
    // 0 intersections = fully visible, 1 = dimmed, 2+ = nearly invisible.
    // Uses EnemyInstanceManager (GPU-instanced color buffer) for zero per-enemy
    // material state flushes — avoids the performance problem of the old approach.
    // -----------------------------------------------------------------------
    const netRenderNow = performance.now();
    const netRenderDt = Math.min((netRenderNow - _lastNetRenderTime) / 1000, 0.1);
    _lastNetRenderTime = netRenderNow;

    depthOcclusion.update(enemyArray, camera.position, netRenderDt);
    for (const enemy of enemyArray) {
      if (!enemy.alive || !enemy.mesh) continue;
      const vis = depthOcclusion.getOpacity(enemy);
      if (enemyInstanceManager.isInLODBatch(enemy)) {
        enemyInstanceManager.setLODInstanceVisibility(enemy, vis);
      } else {
        enemyInstanceManager.setInstanceVisibility(enemy, vis);
      }
    }

    enemyInstanceManager.flushColors();

    // -----------------------------------------------------------------------
    // Per-frame interpolation for remote players (60Hz lerp toward 30Hz targets)
    // Same principle as enemies. Co-op moves players every frame via MeshWalker;
    // LAN must interpolate between 30Hz state changes for equivalent smoothness.
    // -----------------------------------------------------------------------
    const PLAYER_LERP = 0.2; // Slightly faster than enemies for responsiveness
    remotePlayerTargetUV.forEach((target, id) => {
      const player = networkPlayers.get(id);
      if (!player || id === localPlayerId) return;

      // Lerp internal UV toward target
      const currentU = player.surfaceU;
      const currentV = player.surfaceV;
      const newU = currentU + (target.u - currentU) * PLAYER_LERP;
      const newV = currentV + (target.v - currentV) * PLAYER_LERP;
      player.surfaceU = newU;
      player.surfaceV = newV;

      // Update 3D position from interpolated UV
      const sp: SurfacePoint = surf.getPoint(newU, newV);
      player.mesh.position.copy(sp.position).multiplyScalar(currentMapSizeScaleFactor).addScaledVector(sp.normal, 0.15);
      orientPlayerOnSurface(player, sp.normal, target.aimAngle, sp.tangentU);

      // Update glow trail with interpolated position
      const trail = playerGlowTrails.get(id);
      if (trail) trail.addPoint(player.mesh.position.clone());

      // Update ally glow position
      allyGlowManager.setPosition(id, player.mesh.position);
    });

    // -----------------------------------------------------------------------
    // Per-frame interpolation for bullets (same pattern as enemies/players).
    // Previously bullets were positioned directly in onStateChange, causing
    // stutter at the patch rate. Now we lerp UV toward server targets every
    // render frame for smooth bullet movement.
    // See decisions/lan-deep-audit-2026-02-11.md #3.
    // BulletInstanceManager provides GPU-instanced rendering (replaces flat lines).
    // -----------------------------------------------------------------------
    const BULLET_LERP = 0.5; // Phase 3: was 0.3; bullets move fast → snap quickly (7 frames to 99%)
    bulletTargetUV.forEach((target, id) => {
      const idx = bulletIdToIndex.get(id);
      if (idx === undefined) return;
      const b = bulletPool.getBulletData(idx);
      if (!b || !b.alive) return;

      // Lerp UV toward server target
      b.surfaceU += (target.u - b.surfaceU) * BULLET_LERP;
      b.surfaceV += (target.v - b.surfaceV) * BULLET_LERP;

      // Update 3D position from interpolated UV.
      // Use transform() (= getTransform) instead of surf.getPoint() directly so the
      // mapSizeScaleFactor is applied. surf.getPoint() returns unscaled local-space
      // positions; transform() multiplies by scaleFactor, matching the visible surface
      // geometry (surface.group.scale). Without this, bullets on SMALL/LARGE surfaces
      // (e.g. cube = 0.75x) appear offset from the actual visible surface.
      const bpt = transform(b.surfaceU, b.surfaceV);
      _netTempPos.copy(bpt.position).addScaledVector(bpt.normal, 0.02);

      // Compute world-space direction from UV-space direction components.
      // bullet.dirX/dirY = cos/sin of aim angle (UV-space).
      // Convert to world-space: dir = tangentU * dirX + tangentV * dirY.
      // transform().tangent = tangentU, bitangent = tangentV.
      _netTempDir.set(0, 0, 0)
        .addScaledVector(bpt.tangent, target.dirX)
        .addScaledVector(bpt.bitangent, target.dirY)
        .normalize();

      // Register or update with BulletInstanceManager for GPU-instanced rendering.
      // Use the stored bulletWeaponType (populated from ownerId → player.weaponType
      // in onStateChange) for exact visual attribution, covering all players.
      if (!bulletInstanceIds.has(id)) {
        const weapType = bulletWeaponType.get(id) ?? WeaponType.Standard;
        const bulletVisual = weaponToBulletVisual(weapType);
        const weapColor = WEAPON_CONFIGS[weapType]?.color;
        const color = weapColor !== undefined ? _bulletTmpColor.setHex(weapColor) : undefined;
        bulletInstanceManager.addBullet(id, bulletVisual, _netTempPos, _netTempDir, color);
        bulletInstanceIds.add(id);
      } else {
        bulletInstanceManager.updateBullet(id, _netTempPos, _netTempDir);
      }
    });
    // Flush bullet instance transforms to GPU
    bulletInstanceManager.update();

    // -----------------------------------------------------------------------
    // Per-frame interpolation for geoms (same pattern).
    // Geoms don't move much after spawning, but smooth lerp prevents any
    // visible snap when the server adjusts their position.
    // -----------------------------------------------------------------------
    const GEOM_LERP = 0.3; // Phase 3: was 0.2; geoms rarely move but faster convergence reduces divergence
    geomTargetUV.forEach((target, id) => {
      const idx = geomIdToIndex.get(id);
      if (idx === undefined) return;
      const g = geomPool.getGeomData(idx);
      if (!g || !g.alive) return;

      g.surfaceU += (target.u - g.surfaceU) * GEOM_LERP;
      g.surfaceV += (target.v - g.surfaceV) * GEOM_LERP;
    });

    // -----------------------------------------------------------------------
    // Spawn warning rings (LAN visual parity with single-player)
    // Created by onPreSpawn 1.5s before enemy appears. Animated here and
    // cleaned up when they expire. Enemy appearance also cleans them up
    // (in onStateChange via isNewEnemy check).
    // -----------------------------------------------------------------------
    const nowMs = performance.now();
    for (let i = spawnWarningRings.length - 1; i >= 0; i--) {
      const w = spawnWarningRings[i];
      const ageSec = (nowMs - w.spawnedAt) / 1000;
      const progress = Math.min(1, ageSec / PRE_SPAWN_DURATION);

      // Pulse: expand ring and fade it out as the enemy approaches
      const pulse = 1 + Math.sin(progress * Math.PI * 6) * 0.25;
      const scale = (0.5 + progress) * pulse;
      w.mesh.scale.setScalar(scale);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress * 0.75) * 0.9;

      // Reposition on surface in case getTransform changes (animated surfaces)
      if (getTransform) {
        const t = getTransform(w.u, w.v);
        w.mesh.position.copy(t.position).addScaledVector(t.normal, 0.05);
        w.mesh.lookAt(w.mesh.position.clone().add(t.normal));
      }

      // Remove after duration + small buffer (enemy should have appeared by now)
      if (ageSec >= PRE_SPAWN_DURATION + 0.5) {
        scene.remove(w.mesh);
        (w.mesh.material as THREE.MeshBasicMaterial).dispose();
        spawnWarningRings.splice(i, 1);
      }
    }

    // Camera follows local player: orbit, zoom, and smooth follow via CameraController.
    // Replaces the old manual lerp — now identical feature set to single-player.
    // When the local player is dead (spectating), camera follows the first alive
    // remote player instead of staying frozen at the death position.
    const localPlayer = networkPlayers.get(localPlayerId);
    if (localPlayer) {
      const isLocalAlive = playerAliveState.get(localPlayerId) ?? true;
      let cameraSourceU = localPlayer.surfaceU;
      let cameraSourceV = localPlayer.surfaceV;

      if (!isLocalAlive) {
        // Spectating: find the first alive remote player to follow
        networkPlayers.forEach((player, id) => {
          if (id !== localPlayerId && (playerAliveState.get(id) ?? true)) {
            cameraSourceU = player.surfaceU;
            cameraSourceV = player.surfaceV;
          }
        });
      }

      const sp = surf.getPoint(cameraSourceU, cameraSourceV);
      const cameraPos = sp.position.clone().multiplyScalar(currentMapSizeScaleFactor);
      cameraController.updateFromFrame(
        cameraPos,
        sp.normal,
        { tangent: sp.tangentU, bitangent: sp.tangentV },
        lastFixedDt,
      );
    }

    // Apply surface projection for geoms and bullets (same as co-op)
    bulletPool.applySurfaceProjection(transform);
    geomPool.applySurfaceProjection(transform);

    // -----------------------------------------------------------------------
    // Tunnel transparency + dynamic grid opacity (same as SP's RenderLoop.ts).
    // When the surface blocks the camera-to-player view, fade the surface
    // and grid so the player remains visible inside tunnels/tubes.
    // -----------------------------------------------------------------------
    {
      const localPlayer = networkPlayers.get(localPlayerId);
      if (localPlayer) {
        const camPos = camera.position;
        const playerPos = localPlayer.mesh.position;
        _tunnelToPlayer.copy(playerPos).sub(camPos);
        const distToPlayer = _tunnelToPlayer.length();
        _tunnelToPlayerDir.copy(_tunnelToPlayer).normalize();
        _tunnelRaycaster.set(camPos, _tunnelToPlayerDir);
        _tunnelRaycaster.far = distToPlayer;
        const hits = _tunnelRaycaster.intersectObject(surf.mesh, false);
        const isBlocked = hits.length > 0;

        // Grid opacity: fade when blocked (matches SP behavior)
        const baseGridOpacity = (savedStyle?.gridOpacity ?? 0.3);
        const targetGridOpacity = isBlocked ? baseGridOpacity * 0.08 : baseGridOpacity;
        _currentGridOpacity += (targetGridOpacity - _currentGridOpacity) * Math.min(1, _gridFadeSpeed * netRenderDt);
        const gridMat = surf.gridMesh?.material as THREE.LineBasicMaterial | undefined;
        if (gridMat) {
          gridMat.opacity = _currentGridOpacity;
        }

        // Surface occlusion shader: fade surface between camera and player
        if (surf.mesh.material instanceof OcclusionSurfaceMaterial) {
          surf.mesh.material.setOcclusionParams(camPos, playerPos, true);
        }
      }
    }

    // Screen shake (same as co-op)
    if (screenShake.offset.lengthSq() > 0.0001) {
      camera.position.add(screenShake.offset);
    }

    // Dynamic particle budget scaling based on active entity count
    // Reduces particle emission when many entities are on screen to maintain FPS
    const activeEnemyCount = networkEnemies.size;
    const activeBulletCount = bulletPool.activeCount;
    const totalEntityCount = activeEnemyCount + activeBulletCount;

    // Scale factor calculation:
    //   < 100 entities: 100% budget (1.0x)
    //   100-300 entities: linear scale from 100% to 50% (1.0x to 0.5x)
    //   300-500 entities: linear scale from 50% to 30% (0.5x to 0.3x)
    //   > 500 entities: 30% minimum budget (0.3x)
    let entityScaleFactor = 1.0;
    if (totalEntityCount > 100) {
      entityScaleFactor = Math.max(0.3, 1.0 - ((totalEntityCount - 100) / 400));
    }
    particles.setEntityScaleFactor(entityScaleFactor);

    // Update floating name labels (project 3D -> screen)
    const labelPositions = new Map<string, { worldPos: THREE.Vector3; alive: boolean }>();
    networkPlayers.forEach((player, id) => {
      const alive = playerAliveState.get(id) ?? true;
      labelPositions.set(id, { worldPos: player.mesh.position, alive });
    });
    nameLabels.update(camera, labelPositions);

    // Update minimap (same pattern as RenderLoop.ts in single-player).
    // Remote players are included in the geoms layer (green dots) since
    // the Minimap API only accepts a single local player UV position.
    const minimapLocalPlayer = networkPlayers.get(localPlayerId);
    if (minimapLocalPlayer) {
      const minimapEnemies = Array.from(networkEnemies.values())
        .filter(e => e.mesh)
        .map(e => ({ u: e.surfacePosition.u, v: e.surfacePosition.v, alive: e.alive }));
      const minimapGeoms: Array<{ u: number; v: number }> = [];
      geomPool.forEachActive((_i: number, u: number, v: number) => { minimapGeoms.push({ u, v }); });
      // Add remote players as green dots
      networkPlayers.forEach((player, id) => {
        if (id !== localPlayerId && (playerAliveState.get(id) ?? true)) {
          minimapGeoms.push({ u: player.surfaceU, v: player.surfaceV });
        }
      });
      minimap.update(minimapLocalPlayer.surfaceU, minimapLocalPlayer.surfaceV, minimapEnemies, minimapGeoms);
    }

    // Update debug overlay HUD (throttled internally — no perf cost when F3 is hidden)
    debugOverlay.update();
  };

  // Start the game loop
  game.start();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    network.disconnect();
    bgMusic.stop();
    allyGlowManager.dispose();
    nameLabels.dispose();
    weaponHUD.dispose();
    minimap.dispose();
    meshSurface?.dispose();
    lodManager.dispose();
    levelUpNotification.dispose();
    playerLevel.dispose();
    buffManager.dispose();
    buffHUD.dispose();
    buffAuraRenderer.dispose();
    buffParticleAura.dispose();
    shockArcRenderer.dispose();
    companionHUD.dispose();
    companionManager.dispose();
    debugOverlay.dispose();
  });

  // Debug hook: read-only access to game state for automated testing.
  // Only active when ?debug=true is in the URL. No behavior changes.
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__gameDebug = {
      getPlayerPosition: () => {
        const lp = networkPlayers.get(localPlayerId);
        return lp ? { u: lp.surfaceU, v: lp.surfaceV } : null;
      },
      getEnemyCount: () => networkEnemies.size,
      getEnemies: () => {
        const result: { id: string; type: string; u: number; v: number; hp: number }[] = [];
        networkEnemies.forEach((enemy, id) => {
          result.push({
            id,
            type: enemy.baseTypeName || 'unknown',
            u: enemy.surfacePosition.u,
            v: enemy.surfacePosition.v,
            hp: 1,
          });
        });
        return result;
      },
      getBulletCount: () => bulletIdToIndex.size,
      getScore: () => {
        const lp = networkPlayers.get(localPlayerId);
        return lp ? lp.score : 0;
      },
      isConnected: () => network.isConnected(),
      getPlayerCount: () => networkPlayers.size,
      getLocalPlayerId: () => localPlayerId,
      getSurfaceType: () => lastCreatedSurfaceType,
      isGameStarted: () => {
        // Check via status text as a proxy for game state
        return statusEl.textContent?.includes('Wave') || false;
      },
      getWaveText: () => statusEl.textContent || '',
    };
  }

  // -----------------------------------------------------------------------
  // LAN Diagnostic API — gated behind ?debug URL parameter.
  // Previously always-on, but the 200ms polling interval and entity iteration
  // added overhead even when the overlay was hidden. Now only activates when
  // explicitly requested via ?debug=true in the URL.
  // See decisions/lan-deep-audit-2026-02-11.md #7.
  // -----------------------------------------------------------------------

  let diagOverlayEl: HTMLDivElement | null = null;
  let diagOverlayInterval: ReturnType<typeof setInterval> | null = null;
  const debugEnabled = new URLSearchParams(window.location.search).has('debug');

  if (debugEnabled) {
  window.__lanDebug = {
    status: () => {
      const lp = networkPlayers.get(localPlayerId);
      return {
        connected: network.isConnected(),
        localPlayerId,
        isHost,
        isPaused,
        surfaceType: lastCreatedSurfaceType,
        surfaceReady,
        gameStatus: statusEl.textContent,
        playerCount: networkPlayers.size,
        localPlayerPos: lp ? { u: lp.surfaceU, v: lp.surfaceV } : null,
        localPlayerAlive: lp ? (playerAliveState.get(localPlayerId) ?? true) : false,
        serverUrl: getServerUrl(),
        timestamp: new Date().toISOString(),
      };
    },

    entities: () => {
      return {
        players: networkPlayers.size,
        enemies: networkEnemies.size,
        bullets: bulletIdToIndex.size,
        geoms: geomIdToIndex.size,
        weaponPickups: networkWeaponPickups.size,
        enemyDetails: Array.from(networkEnemies.entries()).slice(0, 10).map(([id, e]) => ({
          id,
          type: e.baseTypeName || 'unknown',
          u: e.surfacePosition.u.toFixed(3),
          v: e.surfacePosition.v.toFixed(3),
          visible: e.mesh?.visible ?? false,
        })),
      };
    },

    latency: async () => {
      const serverUrl = getServerUrl().replace('ws://', 'http://').replace('wss://', 'https://');
      const pings: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        try {
          await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(2000) });
          pings.push(performance.now() - start);
        } catch {
          pings.push(-1);
        }
      }
      const validPings = pings.filter(p => p >= 0);
      return {
        pings: pings.map(p => p >= 0 ? `${p.toFixed(1)}ms` : 'TIMEOUT'),
        avg: validPings.length > 0
          ? `${(validPings.reduce((a, b) => a + b, 0) / validPings.length).toFixed(1)}ms`
          : 'ALL FAILED',
        min: validPings.length > 0 ? `${Math.min(...validPings).toFixed(1)}ms` : 'N/A',
        max: validPings.length > 0 ? `${Math.max(...validPings).toFixed(1)}ms` : 'N/A',
        serverReachable: validPings.length > 0,
      };
    },

    report: async () => {
      const status = window.__lanDebug!.status();
      const entities = window.__lanDebug!.entities();
      const latency = await window.__lanDebug!.latency();
      const report = [
        '=== LAN DIAGNOSTIC REPORT ===',
        `Time: ${new Date().toISOString()}`,
        `Browser: ${navigator.userAgent}`,
        '',
        '--- Connection ---',
        JSON.stringify(status, null, 2),
        '',
        '--- Entities ---',
        JSON.stringify(entities, null, 2),
        '',
        '--- Latency ---',
        JSON.stringify(latency, null, 2),
      ].join('\n');

      try {
        await navigator.clipboard.writeText(report);
        console.log('Diagnostic report copied to clipboard!');
      } catch {
        console.log('Could not copy to clipboard. Report:');
        console.log(report);
      }
      return report;
    },

    overlay: (show?: boolean) => {
      const shouldShow = show ?? !diagOverlayEl;

      if (!shouldShow && diagOverlayEl) {
        diagOverlayEl.remove();
        diagOverlayEl = null;
        if (diagOverlayInterval) {
          clearInterval(diagOverlayInterval);
          diagOverlayInterval = null;
        }
        return;
      }

      if (shouldShow && !diagOverlayEl) {
        diagOverlayEl = document.createElement('div');
        diagOverlayEl.style.cssText =
          'position:fixed;bottom:10px;left:10px;background:rgba(0,0,0,0.85);' +
          'color:#0f0;font:11px monospace;padding:8px 12px;z-index:9999;' +
          'border:1px solid #0f0;max-width:400px;white-space:pre;pointer-events:none;';
        document.body.appendChild(diagOverlayEl);

        const updateOverlay = () => {
          if (!diagOverlayEl) return;
          const lp = networkPlayers.get(localPlayerId);
          const lines = [
            `Connected: ${network.isConnected()} | Host: ${isHost}`,
            `Players: ${networkPlayers.size} | Enemies: ${networkEnemies.size}`,
            `Bullets: ${bulletIdToIndex.size} | Geoms: ${geomIdToIndex.size}`,
            `Surface: ${lastCreatedSurfaceType} (ready: ${surfaceReady})`,
            `Player UV: ${lp ? `${lp.surfaceU.toFixed(3)}, ${lp.surfaceV.toFixed(3)}` : 'N/A'}`,
            `Status: ${statusEl.textContent}`,
          ];
          diagOverlayEl.textContent = lines.join('\n');
        };
        updateOverlay();
        diagOverlayInterval = setInterval(updateOverlay, 200);
      }
    },
  };
  // Log diagnostic availability to console
  console.log(
    '%c[LAN Debug] Diagnostic commands available:%c\n' +
    '  __lanDebug.status()   — Connection & game state\n' +
    '  __lanDebug.entities() — Entity counts & details\n' +
    '  __lanDebug.latency()  — Ping test (5 samples)\n' +
    '  __lanDebug.report()   — Full report (copies to clipboard)\n' +
    '  __lanDebug.overlay()  — Toggle real-time overlay',
    'color:#0ff;font-weight:bold', 'color:#0ff',
  );
  } // end if (debugEnabled)
}

main();
