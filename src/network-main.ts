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
import { waveComposer } from './entities/enemies/WaveComposer';
import { BaseEnemy } from './entities/enemies/BaseEnemy';
import { ParticleSystem } from './effects/ParticleSystem';
import { ScreenShake } from './effects/ScreenShake';
import { PlasmaExplosionEffect } from './effects/PlasmaExplosionEffect';
import { ScorePopupManager } from './effects/ScorePopup';
import { GlowTrail } from './effects/GlowTrail';
import { EntityGlow, EntityGlowManager, GlowPresets } from './effects/EntityGlow';
import { InputManager } from './input/InputManager';
import { isMobile } from './core/MobileDetector';
import { TouchInput } from './input/TouchInput';
import { MeshSurface, FacePosition } from './surfaces/MeshSurface';
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
import { PlayerLevel, LevelUpNotification, getLevelPerk } from './core/PlayerLevel';
import { WeaponMasteryManager } from './buffs/WeaponMasteryManager';
import { MasteryStore } from './systems/MasteryStore';
import { MasteryPointStore } from './systems/MasteryPointStore';
import { MatchUpgradeTracker } from './systems/MatchUpgradeTracker';
import { UpgradeNotification } from './ui/UpgradeNotification';
import { WeaponMasteryScreen } from './ui/WeaponMasteryScreen';
import { MasteryProgressScreen } from './ui/MasteryProgressScreen';
import { BuffManager, StackBuffType } from './buffs/BuffManager';
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
  NetworkSuperPickupState,
  NetworkBuffPickupState,
  NetworkGameState,
  ClientMetricsPayload,
} from './network/NetworkClient';
import { PlayerNameLabels } from './ui/PlayerNameLabel';
import { Minimap } from './ui/Minimap';
import { GameOverScreen } from './ui/GameOverScreen';
import { VotingScreen } from './ui/VotingScreen';
import { PauseMenu, PauseMenuGameData } from './ui/PauseMenu';
import { UIHelpers } from './ui/UIHelpers';
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
import { LANClient } from './network/LANClient';
import { initI18n } from './i18n';
import { computeCameraRelativeAimAngle } from './utils/aimAngle';
import { createGameMode, type IGameMode, type QuickGameModeType } from './core/modes';
import { showGameLoading, hideGameLoading } from './ui/GameLoadingOverlay';
import { runMobileOnboarding } from './ui/MobileOnboarding';

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
const _netTempTangent = new THREE.Vector3();
const _bulletTmpColor = new THREE.Color();

// Pre-allocated temp vectors for camera-frame aim-angle correction (s40-03)
const _aimCamRight = new THREE.Vector3();
const _aimCamUp = new THREE.Vector3();

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

function getUrlMapSize(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const mapSize = params.get('mapSize');
  const validSizes = ['small', 'medium', 'large', 'epic'];
  return (mapSize && validSizes.includes(mapSize)) ? mapSize : undefined;
}

function isValidSurfaceType(s: string): s is SurfaceType {
  return SurfaceFactory.getAvailableTypes().includes(s as SurfaceType);
}

/**
 * Returns { primary, fallback } server URLs for the Colyseus connection.
 * Primary: Vite proxy path (ws://host:3000/ws) — only needs port 3000 on LAN.
 * Fallback: direct Colyseus (ws://host:2567) — in case proxy fails (browser
 * cache, proxy misconfiguration, etc.).
 */
function getServerUrls(): { primary: string; fallback: string | null } {
  const params = new URLSearchParams(window.location.search);
  const explicitServer = params.get('server');
  if (explicitServer) {
    // If an explicit server URL is provided, also compute a fallback.
    // If it goes through the proxy (/ws path), fallback is direct port 2567.
    // If it's already direct (port 2567), no fallback needed.
    let fallback: string | null = null;
    try {
      const url = new URL(explicitServer);
      if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
        // Proxy URL → fallback to direct port 2567
        fallback = `${url.protocol}//${url.hostname}:2567`;
      }
    } catch { /* not a valid URL, no fallback */ }
    return { primary: explicitServer, fallback };
  }
  // Route through Vite dev server proxy (/ws → localhost:2567).
  // LAN clients only need port 3000 (the Vite port) to be accessible.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const primary = `${protocol}//${window.location.host}/ws`;
  // Fallback: try direct Colyseus port in case proxy is broken
  const fallback = `${protocol}//${window.location.hostname}:2567`;
  return { primary, fallback };
}

function getPlayerName(): string {
  const params = new URLSearchParams(window.location.search);
  const urlName = params.get('name');
  if (urlName) return urlName;
  const savedName = localStorage.getItem('gw3d_player_name');
  if (savedName) return savedName;
  return `Player ${Math.floor(Math.random() * 9000) + 1000}`;
}

/**
 * Returns true when this player navigated here via the start menu's "Create Network Game" button.
 * The start menu sets creator=1 in the URL to signal creator intent so the server can assign host.
 * QR code joiners and direct URL users do NOT have this param and become non-host.
 */
function isGameCreator(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('creator') === '1';
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
  giant_snake: 'giant_snake',
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

async function main() {
  await initI18n();
  // Show loading overlay during game initialization (covers both direct URL and StartMenu paths).
  // We dismiss it just before network.connect() so the lobby UI is visible while connecting.
  showGameLoading('CONNECTING TO SERVER...');

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

  // Ensure camera aspect ratio matches current viewport dimensions
  // (fixes horizontal stretch on game start, especially on mobile where window
  // dimensions may not be stable at Game construction time)
  game.ensureCameraAspectRatio();

  // Resize handler: iOS Safari changes innerHeight when URL bar shows/hides.
  // Without this, canvas stays at initial size and appears cropped/zoomed on mobile.
  if (mobile) {
    window.addEventListener('resize', () => {
      game.renderer.setSize(window.innerWidth, window.innerHeight);
      game.ensureCameraAspectRatio();
    }, { passive: true });
  }

  // Set global renderer info so all SettingsMenu instances show it
  SettingsMenu.setGlobalRendererInfo(game.backend, game.isWebGPU);

  // Debug performance overlay — F4 key (same as single-player)
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
  // Separate tracker for camera lerp — ensures framerate-independent camera feel.
  // Camera updateFromFrame() is called from onRender (display refresh rate, not fixed 60Hz).
  // Using actual render-frame dt makes the lerp converge at the same wall-clock rate
  // at any display framerate, matching SP's behaviour (fixed-update at 60Hz).
  let _lastCameraRenderTime = performance.now();

  // Tunnel transparency: dynamic grid opacity when surface blocks camera-to-player view.
  // Same logic as SP's RenderLoop.ts — fades grid when player is behind the surface.
  const _tunnelRaycaster = new THREE.Raycaster();
  const _tunnelToPlayer = new THREE.Vector3();
  const _tunnelToPlayerDir = new THREE.Vector3();
  let _currentGridOpacity = 0.10; // matches default gridOpacity
  const _gridFadeSpeed = 3.0; // opacity per second convergence rate

  // -- CameraController: orbit (middle mouse), zoom (scroll wheel), follow (same as single-player) --
  const cameraController = new CameraController(camera);
  cameraController.setCameraDistance(20); // Match existing LAN camera distance

  // -- ShockwaveEffect (shared with single-player via SharedGameSetup) --
  const shockwaveEffect = setupShockwaveEffect(game, camera);

  // Hide single-player HUD elements that conflict with LAN-specific UI.
  // Note: #score-display is intentionally kept (reused for team score below).
  // Note: #multiplier-display is hidden separately below.
  ['lives-display', 'bombs-display', 'weapon-display', 'combo-display',
   'boost-display', 'timer-display', 'level-name-display', 'player-level-display',
   'boss-health-bar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

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
      // Dispose geometry and materials to free GPU memory (prevents accumulation
      // across map changes). surface.group children (mesh + gridMesh) are disposed here.
      surface.dispose();
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
    enemyPrevHealth.clear();
    enemyGlowTrails.forEach((trail) => {
      scene.remove(trail.root);
      trail.dispose();
    });
    enemyGlowTrails.clear();
    remotePlayerTargetUV.clear();
    remotePlayerTargetWorldPos.clear();
    _localServerFrameValid = false;
    _localPlayerWorldTarget.valid = false;
    _localPlayerQuatInitialized = false; // s44f-06: reset smoothed orientation on surface change
    _predictedPlayerVisualValid = false; // s44h-08: reset predicted position on surface change
    bulletTargetUV.clear();
    bulletGeodesicState.clear();
    geomTargetUV.clear();
    surface = null;
    meshSurface = null;
    getTransform = null;
    enemySpawner = null;
    surfaceReady = false;
    surfaceConfirmedFromServer = false;
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

    // Reset camera frame so the sign-flip continuity check doesn't fire on the
    // first frame and invert controls (see CameraController.resetFrameForNewSurface).
    cameraController.resetFrameForNewSurface();
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
  // Track owner ID per bullet — used to skip special-weapon server bullets for local player
  // (whose visuals are handled by localWeaponManager instead)
  const bulletOwnerIds = new Map<string, string>();
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
    onEnemyPull: (index: number, strength: number, center: THREE.Vector3) => {
      // Client-side visual pull — server is authoritative but this gives immediate feedback
      const enemyList: BaseEnemy[] = [];
      networkEnemies.forEach((enemy) => enemyList.push(enemy));
      const enemy = enemyList[index];
      if (!enemy || !enemy.alive) return;
      const dx = center.x - enemy.position.x;
      const dz = center.z - enemy.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < 0.0001) return;
      const dist = Math.sqrt(distSq);
      const GRAVITY_PULL_FORCE = 0.8;
      enemy.applyKnockback(
        (dx / dist) * GRAVITY_PULL_FORCE * strength,
        (dz / dist) * GRAVITY_PULL_FORCE * strength,
      );
      // Visual: purple streaks from enemy toward pull center
      particles.gravityPullTrail(enemy.position, center);
    },
    onProjectileExplosion: (position: THREE.Vector3, wType: WeaponType) => {
      if (wType === WeaponType.GravityGun) {
        if (surface) {
          surface.applyMeshForce(position, -2.5, 1.5);
          surface.applyForce(position, -0.15, 1.5);
        }
        // Gravity implosion particles (replaces generic bulletImpact)
        particles.gravityExplosion(position);
        screenShake.shake(0.08, 0.3);
      } else if (wType === WeaponType.PlasmaMortar) {
        particles.mortarExplosion(position);
        screenShake.shake(0.5, 0.35);
        // Visual shockwave ring (no gameplay damage — MP is server authoritative)
        plasmaExplosionEffect.spawn(position);
      }
    },
    onGravityGunMove: (position: THREE.Vector3) => {
      // Continuous surface suction as the projectile travels
      if (surface) surface.applyForce(position, -0.02, 0.6);
    },
  });

  // Special weapons that produce visual effects NOT represented in server bullet state.
  // Projectile weapons (Spread, Homing, Mortar, etc.) are already rendered by
  // BulletInstanceManager from server-sent bullet state — don't double-render them.
  // GravityGun is included here: its purple gravity-well projectile is managed entirely
  // by WeaponManager (with pull effect). Server also spawns a bullet for GravityGun,
  // but we skip BulletInstanceManager for it to avoid a miscolored duplicate visual.
  const SPECIAL_VISUAL_WEAPONS = new Set<WeaponType>([
    WeaponType.LaserBeam,
    WeaponType.ChainLightning,
    WeaponType.TeslaCoil,
    WeaponType.GravityGun,
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

  // -- Plasma explosion effect (visual-only in MP — damage is server authoritative) --
  const plasmaExplosionEffect = new PlasmaExplosionEffect();
  scene.add(plasmaExplosionEffect.root);

  // Kill log + total kill counter (same as co-op / single player)
  const killLog = new KillLog();
  const totalKillCounter = new TotalKillCounter();
  killLog.onKill = (type, color) => totalKillCounter.addKill(type, color);

  // Weapon HUD — same graphical inventory panel as single-player
  // s44g-04: Position at mid-left (50% height) so weapon icons appear at screen center,
  // matching gameplay area and making equipped weapons easy to read during action.
  const weaponHUD = new WeaponHUD();
  const weaponHUDY = Math.max(100, Math.round(window.innerHeight * 0.50));
  weaponHUD.setPosition(10, weaponHUDY);

  // Ally glow manager for remote player indicators
  const allyGlowManager = new AllyGlowManager(scene);

  // Floating name labels above player ships
  const nameLabels = new PlayerNameLabels();

  // Minimap (same as single-player — shows local player, enemies, geoms)
  const minimap = new Minimap();
  if (mobile) {
    minimap.setVisible(false);
  }

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

  // -- Weapon mastery tracking + persistent XP store --
  // Tracks kills per weapon type for the local player (same as SP/co-op).
  // Shown on game end via MasteryProgressScreen before VotingScreen.
  const weaponMastery = new WeaponMasteryManager();
  const masteryStore = MasteryStore.load();

  // -- Per-match upgrade tracker (reset each round in MP) --
  // Activates permanently-unlocked mastery nodes via kill thresholds (same as SP).
  // In MP, we create a fresh tracker each time a new round begins.
  const masteryPointStore = MasteryPointStore.load();
  let matchUpgradeTracker = new MatchUpgradeTracker(masteryPointStore.getUnlockedNodes());
  const upgradeNotification = new UpgradeNotification();
  matchUpgradeTracker.onUpgradeActivated = (nodeId, weaponType) => {
    upgradeNotification.show(nodeId, weaponType);
  };
  localWeaponManager.setUpgradeTracker(matchUpgradeTracker);

  // -- Buff system: server-authoritative collection + client visual effects (Phase D) --
  // Phase D: Server spawns buff pickups on enemy death and tracks buffStacks per player.
  // Buff damage multipliers (HotHands, IncendiaryRounds, Volatile) are applied server-side.
  // Client syncs buffStacks from player state → buffManager for HUD and visual effects.
  // Visual effects (ShockAura arcs, aura glow, particle cloud) run via buffManager.update().
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

  // -- World-space targets for remote players (s44-epic-06) --
  // When the server sends wx/wy/wz + tangent frame, store here for direct world-space lerp.
  // This avoids UV→world conversion via surface.getPoint() which can be unstable at poles.
  interface RemotePlayerWorldTarget {
    x: number; y: number; z: number;   // surface position (unscaled, add normal offset when rendering)
    nx: number; ny: number; nz: number; // surface normal
    tx: number; ty: number; tz: number; // surface tangent (for orientPlayerOnSurface)
    aimAngle: number;
  }
  const remotePlayerTargetWorldPos = new Map<string, RemotePlayerWorldTarget>();

  // -- Server tangent frame for local player camera (s44-epic-06) --
  // The server's MeshWalker provides a stable continuous bitangent that doesn't
  // flip sign at poles (unlike UV-derived tangentV from surface.getPoint()).
  // Updated in onStateChange, consumed in onRender for camera upHint.
  const _localServerTangent  = new THREE.Vector3(1, 0, 0);
  const _localServerBitangent = new THREE.Vector3(0, 0, 1);
  const _localServerNormal   = new THREE.Vector3(0, 1, 0);
  let _localServerFrameValid = false; // false until first server frame arrives

  // -- Server world-space position target for local player (s44-epic-08) --
  // The server's ServerMeshWalker walks on actual mesh faces (geodesic), giving a
  // different world position than the client's UV→surface.getPoint() conversion.
  // This mismatch caused the "two versions of him" glitch — client UV prediction
  // positioned the mesh at one place, server corrections snapped it to another.
  // Fix: always store server wx/wy/wz here and use it for mesh placement in onFixedUpdate.
  const _localPlayerWorldTarget = {
    x: 0, y: 0, z: 0,
    nx: 0, ny: 1, nz: 0,
    tx: 1, ty: 0, tz: 0,
    valid: false,
  };
  // Track previous health per enemy to detect damage and spawn damage number popups
  const enemyPrevHealth = new Map<string, number>();

  // -- Bullet tracking --
  const bulletIdToIndex = new Map<string, number>();
  // Interpolation targets for bullets: lerp toward server UV in onRender (60Hz)
  // instead of snapping in onStateChange (was 30Hz, now 60Hz but still benefits
  // from smooth lerp). Same pattern as enemyTargetUV.
  const bulletTargetUV = new Map<string, { u: number; v: number; dirX: number; dirY: number }>();
  // Client-side geodesic state for visual bullet rendering.
  // Server uses UV-based movement (Christoffel stepping) for authoritative hit detection.
  // Client uses FaceWalker geodesics so bullets visually follow great circles on every surface.
  const bulletGeodesicState = new Map<string, { facePos: FacePosition, dirWorld: THREE.Vector3 }>();

  // -- Geom tracking --
  const geomIdToIndex = new Map<string, number>();
  // Interpolation targets for geoms (same pattern)
  const geomTargetUV = new Map<string, { u: number; v: number }>();

  // -- Weapon pickup tracking --
  // Uses real WeaponPickup instances (same as co-op)
  const networkWeaponPickups = new Map<string, WeaponPickup>();

  // -- Super pickup tracking (bomb resupply, multiplier boost) --
  // Each entry stores { mesh, surfaceU, surfaceV, pickupType, spawnTime }
  interface SuperPickupVisual {
    mesh: THREE.Group;
    surfaceU: number;
    surfaceV: number;
    pickupType: string;
    spawnTime: number; // game clock time when spawned (for pulse animation)
  }
  const networkSuperPickups = new Map<string, SuperPickupVisual>();

  // -- Server-synced buff pickup tracking (Phase D) --
  // Each entry is a real BuffPickupNew instance (same as co-op), positioned from server state.
  const networkBuffPickups = new Map<string, BuffPickupNew>();
  // Track local player's buff stacks from last state update to detect new collections
  const prevLocalBuffStacks = new Map<string, number>();

  // Shared geometries for super pickups (created once, never disposed)
  const superPickupGeometry = new THREE.SphereGeometry(0.25, 12, 8);

  // Pre-allocated temps for super pickup animation (zero per-frame allocations)
  const _spMat4 = new THREE.Matrix4();
  const _spQSurface = new THREE.Quaternion();
  const _spQSpin = new THREE.Quaternion();
  const _spSpinAxis = new THREE.Vector3(0, 1, 0);

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
  // In lobby phase (before game starts), don't intercept touch events so that
  // DOM buttons (Start Game, Stop Server, Back to Menu) receive click events.
  if (input instanceof TouchInput) input.setGamePaused(true);

  // -- Network client --
  const { primary: primaryUrl, fallback: fallbackServerUrl } = getServerUrls();
  const network = new NetworkClient(primaryUrl, fallbackServerUrl);
  let localPlayerId = '';
  let isHost = false;
  // Track per-player lives from previous state update to detect life losses.
  // Key: player server ID, Value: lives count from last onStateChange call.
  const prevLivesMap = new Map<string, number>();
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

  // Metrics logging: send perf/DDA data to server every ~10s for persistent logging.
  // Server saves to logs/mp-perf-{sessionId}-{date}.jsonl for post-match analysis.
  // ~10s interval keeps log size manageable while providing enough data points per session.
  const METRICS_SEND_INTERVAL = 10.0;
  let metricsAccumulator = 0;
  let latestGameTime = 0;
  let latestWaveNumber = 0;
  let latestMapSize = 'medium';
  let latestGameMode = 'waves';
  // Active client-side game mode instance (KingMode, SniperMode, etc.)
  let activeGameMode: IGameMode | null = null;
  let localPlayerDeaths = 0;
  let lastSentInput: {
    moveX: number; moveY: number; aimAngle: number;
    shooting: boolean; bomb: boolean; boost: boolean;
  } | null = null;

  // Client-side boost state for prediction (mirrors server logic in GameRoom.ts).
  // Leading-edge detection ensures boost only triggers once per Shift press.
  let localBoostActive = false;
  let localBoostTimer = 0;
  let localBoostCooldown = 0;
  let localPrevBoostHeld = false;
  const LOCAL_BOOST_DURATION = 0.5;

  // Client-side V-direction flip state for pole traversal prediction.
  // Mirrors server-side playerVFlip in GameRoom.ts.
  // Toggles each time the local player crosses a sphere-like pole, so the
  // prediction applies the same effective direction as the server.
  let localPlayerVFlip = false;
  const LOCAL_BOOST_COOLDOWN = 5.0;
  const LOCAL_BOOST_SPEED_MULTIPLIER = 3.0;
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
    `position:fixed;top:10px;right:10px;color:#0f0;font:${mobile ? '14px' : '24px'} monospace;` +
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
    `position:fixed;top:10px;left:10px;color:#ff0;font:${mobile ? '11px' : '16px'} monospace;` +
    'text-shadow:0 0 10px #ff0;z-index:100;';
  document.body.appendChild(playersEl);

  // Life-loss notification: briefly shows which player lost a life.
  // Helps distinguish per-player life changes from shared lives.
  const lifeLostEl = document.createElement('div');
  lifeLostEl.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'color:#ff4444;font:22px monospace;text-shadow:0 0 12px #ff4444;' +
    'z-index:200;pointer-events:none;opacity:0;transition:opacity 0.3s;' +
    'text-align:center;';
  document.body.appendChild(lifeLostEl);
  let lifeLostTimer: ReturnType<typeof setTimeout> | null = null;

  function showLifeLostNotification(playerName: string, remainingLives: number, isLocal: boolean): void {
    if (lifeLostTimer) clearTimeout(lifeLostTimer);
    const hearts = remainingLives > 0
      ? '\u2665'.repeat(Math.min(remainingLives, 5))
      : '\u2665 x0';
    const who = isLocal ? 'You lost a life!' : `${playerName} lost a life!`;
    lifeLostEl.innerHTML = `${who}<br>${hearts}`;
    lifeLostEl.style.color = isLocal ? '#ff4444' : '#ffaa44';
    lifeLostEl.style.textShadow = isLocal ? '0 0 12px #ff4444' : '0 0 12px #ffaa44';
    lifeLostEl.style.opacity = '1';
    lifeLostTimer = setTimeout(() => {
      lifeLostEl.style.opacity = '0';
      lifeLostTimer = null;
    }, 2000);
  }

  const weaponEl = document.createElement('div');
  weaponEl.style.cssText =
    'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);' +
    'color:#ff0;font:16px monospace;text-shadow:0 0 8px #ff0;z-index:100;';
  document.body.appendChild(weaponEl);

  // ---- Game mode selector (host only, shown in lobby) ----
  const LOBBY_MODES: Array<{ id: string; label: string; icon: string }> = [
    { id: 'waves',          label: 'WAVES',          icon: '〰' },
    { id: 'king',           label: 'KING',           icon: '👑' },
    { id: 'sniper',         label: 'SNIPER',         icon: '🎯' },
    { id: 'rainbow',        label: 'RAINBOW',        icon: '🌈' },
    { id: 'claustrophobia', label: 'CLAUSTROPHOBIA', icon: '🔴' },
  ];

  let selectedLobbyMode = 'waves';

  const modeSelectorDiv = document.createElement('div');
  modeSelectorDiv.id = 'lobby-mode-selector';
  modeSelectorDiv.style.cssText =
    'position:fixed;top:38%;left:50%;transform:translateX(-50%);' +
    'display:none;z-index:100;text-align:center;';

  const modeLabelEl = document.createElement('div');
  modeLabelEl.textContent = 'GAME MODE';
  modeLabelEl.style.cssText =
    'color:#0ff;font:12px monospace;letter-spacing:3px;margin-bottom:8px;' +
    'text-shadow:0 0 8px #0ff;';
  modeSelectorDiv.appendChild(modeLabelEl);

  const modeBtnsRow = document.createElement('div');
  modeBtnsRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;';

  // Claustrophobia mode note (created early so onclick handlers can reference it)
  const claustrophobiaNoteEl = document.createElement('div');
  claustrophobiaNoteEl.id = 'claustrophobia-note';
  claustrophobiaNoteEl.style.cssText =
    'display:none;margin-top:8px;color:#ff4444;font:11px monospace;letter-spacing:1px;' +
    'text-shadow:0 0 6px #ff4444;';
  claustrophobiaNoteEl.textContent = '🔴 Small surfaces only (sphere/torus/capsule/icosahedron)';

  const modeBtnEls = new Map<string, HTMLButtonElement>();
  for (const m of LOBBY_MODES) {
    const btn = document.createElement('button');
    btn.textContent = `${m.icon} ${m.label}`;
    btn.style.cssText =
      'padding:8px 14px;font:bold 12px monospace;cursor:pointer;' +
      'border:2px solid #444;background:#111;color:#aaa;letter-spacing:1px;';
    btn.onclick = () => {
      selectedLobbyMode = m.id;
      modeBtnEls.forEach((b, id) => {
        b.style.background = id === selectedLobbyMode ? '#050' : '#111';
        b.style.color = id === selectedLobbyMode ? '#0f0' : '#aaa';
        b.style.borderColor = id === selectedLobbyMode ? '#0f0' : '#444';
        b.style.textShadow = id === selectedLobbyMode ? '0 0 8px #0f0' : 'none';
      });
      // Show surface restriction note when Claustrophobia is selected
      claustrophobiaNoteEl.style.display = selectedLobbyMode === 'claustrophobia' ? 'block' : 'none';
    };
    if (m.id === 'waves') {
      btn.style.background = '#050';
      btn.style.color = '#0f0';
      btn.style.borderColor = '#0f0';
      btn.style.textShadow = '0 0 8px #0f0';
    }
    modeBtnEls.set(m.id, btn);
    modeBtnsRow.appendChild(btn);
  }
  modeSelectorDiv.appendChild(modeBtnsRow);
  modeSelectorDiv.appendChild(claustrophobiaNoteEl);

  // ---- Lives selector (host only, shown in lobby) ----
  let selectedLives = 3;          // 1-999
  let selectedInfiniteLives = false;
  let livesFromButton = true;     // false when user typed a custom value directly

  const livesRow = document.createElement('div');
  livesRow.style.cssText = 'margin-top:14px;display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap;';

  const livesLabelEl = document.createElement('div');
  livesLabelEl.textContent = 'LIVES';
  livesLabelEl.style.cssText = 'color:#0ff;font:12px monospace;letter-spacing:3px;text-shadow:0 0 8px #0ff;';
  livesRow.appendChild(livesLabelEl);

  const livesBtnsRow = document.createElement('div');
  livesBtnsRow.style.cssText = 'display:flex;gap:4px;align-items:center;';

  const livesBtnEls: HTMLButtonElement[] = [];
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.textContent = String(n);
    btn.dataset.lives = String(n);
    btn.style.cssText =
      'width:30px;height:30px;font:bold 14px monospace;cursor:pointer;' +
      'border:2px solid #444;background:#111;color:#aaa;';
    btn.onclick = () => {
      selectedLives = n;
      selectedInfiniteLives = false;
      livesFromButton = true;
      livesInputEl.value = String(n);
      updateLivesUI();
    };
    livesBtnEls.push(btn);
    livesBtnsRow.appendChild(btn);
  }

  const infiniteBtn = document.createElement('button');
  infiniteBtn.textContent = '∞';
  infiniteBtn.style.cssText =
    'padding:4px 10px;font:bold 16px monospace;cursor:pointer;' +
    'border:2px solid #444;background:#111;color:#aaa;';
  infiniteBtn.onclick = () => {
    selectedInfiniteLives = true;
    livesFromButton = true;
    livesInputEl.value = '∞';
    updateLivesUI();
  };
  livesBtnsRow.appendChild(infiniteBtn);

  // Custom number input — for values beyond 9 (e.g. 12, 20)
  const livesInputEl = document.createElement('input');
  livesInputEl.type = 'text';
  livesInputEl.value = '3';
  livesInputEl.maxLength = 3;
  livesInputEl.style.cssText =
    'width:44px;height:30px;font:bold 14px monospace;text-align:center;' +
    'border:2px solid #444;background:#111;color:#aaa;outline:none;';
  livesInputEl.addEventListener('input', () => {
    // Typing in the input deselects all buttons
    livesFromButton = false;
    selectedInfiniteLives = false;
    const val = parseInt(livesInputEl.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 999) {
      selectedLives = val;
    }
    updateLivesUI();
  });
  livesInputEl.addEventListener('blur', () => {
    // On blur, sanitise: clamp to valid range, fall back to last valid value
    const val = parseInt(livesInputEl.value, 10);
    if (isNaN(val) || val < 1) {
      livesInputEl.value = String(selectedLives);
    } else if (val > 999) {
      selectedLives = 999;
      livesInputEl.value = '999';
    }
  });
  livesBtnsRow.appendChild(livesInputEl);

  livesRow.appendChild(livesBtnsRow);

  function updateLivesUI(): void {
    livesBtnEls.forEach((b, idx) => {
      const active = livesFromButton && !selectedInfiniteLives && idx + 1 === selectedLives;
      b.style.background = active ? '#050' : '#111';
      b.style.color = active ? '#0f0' : '#aaa';
      b.style.borderColor = active ? '#0f0' : '#444';
    });
    const infActive = livesFromButton && selectedInfiniteLives;
    infiniteBtn.style.background = infActive ? '#050' : '#111';
    infiniteBtn.style.color = infActive ? '#0f0' : '#aaa';
    infiniteBtn.style.borderColor = infActive ? '#0f0' : '#444';
    // Highlight input border when it's driving the selection
    livesInputEl.style.borderColor = !livesFromButton ? '#0f0' : '#444';
    livesInputEl.style.color = !livesFromButton ? '#0f0' : '#aaa';
  }

  // Initialise with default (3 lives, button 3 highlighted)
  updateLivesUI();

  modeSelectorDiv.appendChild(livesRow);
  document.body.appendChild(modeSelectorDiv);

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
    // Build choice string: surface:mode:size:lives
    // Claustrophobia: force a small surface if current surface is not in the allowed list
    const CLAUSTROPHOBIA_ALLOWED = ['sphere', 'torus', 'capsule', 'icosahedron'];
    let surfaceForChoice = lastCreatedSurfaceType || 'sphere';
    if (selectedLobbyMode === 'claustrophobia' && !CLAUSTROPHOBIA_ALLOWED.includes(surfaceForChoice)) {
      surfaceForChoice = 'sphere';
    }
    // lives param: number (1-9) or 'infinite'
    const livesParam = selectedInfiniteLives ? 'infinite' : String(selectedLives);
    const choice = `${surfaceForChoice}:${selectedLobbyMode}:medium:${livesParam}`;
    network.startGame(choice);
    startBtn.style.display = 'none';
    modeSelectorDiv.style.display = 'none';
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
  pauseMenu.setIsMultiplayer(true); // we're in multiplayer mode
  pauseMenu.setNetworkCallbacks({
    onPause: (paused: boolean) => {
      // Only send to server when state actually changes (prevents circular trigger
      // when showPauseOverlay() calls pauseMenu.show() in response to server state).
      if (isPaused !== paused) {
        isPaused = paused;
        network.sendPause(paused);
      }
    },
    onExitToVoting: () => {
      network.sendExitToVoting();
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
    // Fix: re-enable joystick + clear localMenuOpen so mobile can move after resuming.
    // Without this, gamePaused stays true (joystick disabled) after clicking Resume,
    // because showPauseOverlay(false) is skipped when isPaused was already updated
    // inside networkCallbacks.onPause(). localMenuOpen must also be cleared for
    // non-host players whose local menu path bypasses hideLocalMenu().
    localMenuOpen = false;
    if (input instanceof TouchInput && currentRoomPhase === 'playing') {
      input.setGamePaused(false);
    }
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
  pauseMenu.setMasteryPointStore(masteryPointStore);
  pauseMenu.setMatchUpgradeTracker(matchUpgradeTracker);

  // Sync pause menu with saved visual mode; wire the toggle
  pauseMenu.setVisualMode(savedVisualMode);
  pauseMenu.onVisualModeChange((mode) => {
    saveVisualMode(mode);
    game.setVisualMode(mode);
  });

  // Show short code QR in pause menu — 5-digit code is smaller and more reliable than full URL.
  // Registers the short code with the Vite LAN plugin so scanning redirects to the right surface.
  {
    const vitePort = parseInt(window.location.port, 10) || 3000;
    const surfaceParam = new URLSearchParams(window.location.search).get('surface') || 'sphere';
    const lanClient = new LANClient();

    (async () => {
      try {
        const status = await fetch('/__lan/status').then(r => r.json()) as {
          addresses: string[];
          windowsAddresses?: string[];
          isWSL2?: boolean;
        };
        // Prefer Windows LAN IP in WSL2 (172.x IPs are unreachable from other devices)
        const lanIp = (status.isWSL2 && status.windowsAddresses?.length)
          ? status.windowsAddresses[0]
          : status.addresses?.[0];
        if (lanIp) {
          // Register short code — returns http://{lanIp}:{vitePort}/{code} (tiny QR)
          const shortUrl = await lanClient.registerShortCode(lanIp, surfaceParam, 2567, vitePort);
          pauseMenu.setJoinUrl(shortUrl);
        } else {
          // No LAN IP available — fall back to full URL (localhost, not scannable but visible)
          pauseMenu.setJoinUrl(lanClient.getJoinUrl('localhost', 2567, surfaceParam, vitePort));
        }
      } catch {
        // LAN plugin unavailable (production build or no dev server) — hide QR
        pauseMenu.setJoinUrl(null);
      }
    })();
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

    // Lives info from latest server state
    const localPlayerState = latestGameState?.players.get(localPlayerId);
    const livesInfo = localPlayerState
      ? { count: Math.max(0, localPlayerState.lives), infinite: latestGameState?.infiniteLives === true }
      : undefined;

    return {
      livesInfo,
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
    // Only toggle joystick when actually in the playing phase — never re-enable
    // joystick input while in lobby/voting phases even if the game is "unpaused".
    if (input instanceof TouchInput) {
      if (currentRoomPhase === 'playing') {
        input.setGamePaused(paused);
      } else {
        input.setGamePaused(true); // lobby/voting: always keep buttons accessible
      }
    }
    if (paused) {
      game.pause(); // Sync game clock to prevent dt accumulation during pause
      // Both host and non-host see the full PauseMenu.
      // Host gets END GAME / STOP SERVER buttons; non-host does not.
      pauseMenu.setServerPaused(true); // Server-paused: resume → look mode for non-host
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
    'background:rgba(0,0,20,0.88);z-index:3200;' +
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
  localMenuHint.textContent = mobile ? 'Tap ⏸ to resume' : 'Press ESC to resume';
  localMenuHint.style.cssText = 'color:#555566;font-size:13px;margin-top:28px;letter-spacing:2px;';
  localMenuEl.appendChild(localMenuHint);

  document.body.appendChild(localMenuEl);

  function showLocalMenu(): void {
    localMenuOpen = true;
    // Allow touch events to reach menu buttons while local menu is open.
    if (input instanceof TouchInput) input.setGamePaused(true);
    // Send zero input immediately so the server stops moving this player
    if (network.isConnected()) {
      const zeroInput = {
        moveX: 0,
        moveY: 0,
        aimAngle: lastSentInput?.aimAngle ?? 0,
        shooting: false,
        bomb: false,
        boost: false,
      };
      network.sendInput(zeroInput);
      lastSentInput = { ...zeroInput };
    }
    // Show the full PauseMenu (game still running — server not paused).
    // Resume button closes the menu without entering look mode.
    pauseMenu.setServerPaused(false);
    pauseMenu.setIsHost(isHost);
    pauseMenu.setGameData(buildPauseMenuGameData());
    pauseMenu.setPerformanceHTML(debugOverlay.getSummaryHTML());
    pauseMenu.show();
  }

  function hideLocalMenu(): void {
    localMenuOpen = false;
    pauseMenu.hide();
    localMenuEl.style.display = 'none'; // hide voting-phase localMenuEl if it was shown
    // Re-enable joystick touch capture when menu is dismissed —
    // but only during active gameplay; not in lobby/voting where buttons must work.
    if (input instanceof TouchInput && currentRoomPhase === 'playing') {
      input.setGamePaused(false);
    }
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

      // During voting phase: ESC opens localMenuEl (z-index 3200, above VotingScreen)
      // instead of pausing the server. Pausing server during voting is wrong — the
      // voting countdown keeps running regardless of isPaused on the server.
      if (currentRoomPhase === 'voting') {
        if (localMenuOpen) {
          hideLocalMenu();
        } else {
          localMenuOpen = true;
          localMenuEl.style.display = 'flex';
        }
        return;
      }

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

  // -- Mobile: wire pause button in TouchInput (mirrors Escape key handler above) --
  // The TouchInput pause button fires input.onPause but it was never set in network-main,
  // making the mobile pause button a no-op. Wire it here to match Escape key behavior.
  if (mobile && input instanceof TouchInput) {
    input.onPause = () => {
      if (connectionLost) {
        window.location.href = window.location.pathname;
        return;
      }
      if (!network.isConnected()) return;

      // During voting phase: pause button opens localMenuEl (z-index 3200, above VotingScreen)
      // instead of pausing the server.
      if (currentRoomPhase === 'voting') {
        if (localMenuOpen) {
          hideLocalMenu();
        } else {
          localMenuOpen = true;
          localMenuEl.style.display = 'flex';
        }
        return;
      }

      if (localMenuOpen) {
        hideLocalMenu();
      } else if (!isPaused) {
        // Re-check host status in case it changed since connect (same as Escape handler)
        if (!isHost) {
          const serverHostId = network.getServerHostId();
          if (serverHostId && serverHostId === localPlayerId) {
            isHost = true;
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
        // Server is paused by host — tap pause again to resume
        isPaused = false;
        network.sendPause(false);
        showPauseOverlay(false);
      } else if (isInLookMode) {
        // Non-host in look mode — return to pause menu
        isInLookMode = false;
        pauseMenu.exitLookMode();
      } else {
        // Non-host: server is paused — enter look mode (look around while frozen)
        isInLookMode = true;
        pauseMenu.enterLookMode();
      }
    };
  }

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
        boost: false,
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
        boost: false,
      };
      network.sendInput(zeroInput);
      lastSentInput = { ...zeroInput };
    } else if (!document.hidden) {
      // Tab became visible again — always resume the game clock.
      // Game.ts pauses the physics loop (onFixedUpdate) when the tab hides but
      // has no resume handler for when visibility returns. This leaves the game
      // clock stuck in Paused state, causing the joining player to be unable to
      // move (no input sent) while the camera still updates from server state —
      // the exact "player stuck but camera follows host" bug reported in S35/S36.
      //
      // S35 fix had a `!isPaused` guard that prevented resume when the server
      // happened to be paused at the same time the tab became visible (e.g. host
      // paused right while mobile was in the background). This left the game
      // clock permanently stuck even after the server unpaused — because
      // showPauseOverlay(false) calls game.resume() which is a no-op when
      // game._state is already Paused and isPaused was never true-then-false
      // from network-main.ts's perspective.
      //
      // Fix: resume unconditionally. The isPaused check in onFixedUpdate still
      // prevents input from being sent while the server is paused, so gameplay
      // stays correctly frozen. We just keep the clock alive.
      game.resume();
      // Also resync clock to avoid a dt spike if the clock was already running
      // during a server-paused period (game.resume() only resyncs on Paused→Playing
      // transitions; if clock was running, resync here prevents accumulated dt).
      game.clock.resync();
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
  let activeVotingMasteryScreen: WeaponMasteryScreen | null = null;

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
    onReadyUp: () => {
      network.sendReadyUp();
    },
    onHostPauseCountdown: (paused: boolean) => {
      network.sendPauseCountdown(paused);
    },
    onOpenMastery: () => {
      if (activeVotingMasteryScreen) return; // already open
      const masteryPointStore = MasteryPointStore.load();
      const screen = new WeaponMasteryScreen();
      screen.setPointStore(masteryPointStore);
      activeVotingMasteryScreen = screen;
      screen.onClose(() => {
        screen.dispose();
        activeVotingMasteryScreen = null;
      });
      screen.show(MasteryStore.load());
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

  // Latest state received during voting phase — used to pass fresh state to
  // votingScreen.show() from the mastery callback (the closure-captured `state`
  // at transition time is stale by the time the player dismisses mastery).
  let latestVotingState: NetworkGameState | null = null;

  // Latest full game state — used by buildPauseMenuGameData() for live state access.
  let latestGameState: NetworkGameState | null = null;

  // Active mastery screen reference — allows the voting→playing transition to
  // forcefully dismiss it when the countdown expires while mastery is showing.
  let activeMasteryScreen: MasteryProgressScreen | null = null;

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

    // For snakes, derive max segments from wave number so late-game MP snakes
    // scale to 50 segments just like single-player (no schema changes required).
    let snakeMaxSegments: number | undefined;
    if (spawnerType === 'snake' || spawnerType === 'giant_snake') {
      snakeMaxSegments = waveComposer.getMaxSegmentsForWave(
        latestWaveNumber,
        spawnerType as 'snake' | 'giant_snake',
      );
    }

    // Use real EnemySpawner to create the enemy with proper mesh.
    // Pass skipSpawnWarning=true to avoid creating red ring indicators that
    // would never be cleaned up (enemySpawner.update() is not called in
    // network mode because the server is authoritative for enemy positions).
    enemy = enemySpawner.spawn(spawnerType, netEnemy.surfaceU, netEnemy.surfaceV, 0, true, undefined, snakeMaxSegments);

    networkEnemies.set(id, enemy);
    enemyPrevHealth.set(id, netEnemy.health);

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
      bulletInstanceManager.removeBullet(id + '_l');
      bulletInstanceManager.removeBullet(id + '_r');
      bulletInstanceManager.removeBullet(id);
    });
    bulletIdToIndex.clear();
    bulletTargetUV.clear();
    bulletGeodesicState.clear();
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
    enemyPrevHealth.clear();

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

    // Clear super pickups
    networkSuperPickups.forEach((visual) => {
      scene.remove(visual.mesh);
      visual.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material instanceof THREE.Material && child.material.dispose();
        }
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
    });
    networkSuperPickups.clear();

    // Clear local companion pickups
    for (const cp of localCompanionPickups) { scene.remove(cp.mesh); cp.dispose(); }
    localCompanionPickups.length = 0;
    for (const bp of localBuffPickups) { scene.remove(bp.mesh); bp.dispose(); }
    localBuffPickups.length = 0;

    // Clear server-synced buff pickups
    networkBuffPickups.forEach((bp) => { scene.remove(bp.mesh); bp.dispose(); });
    networkBuffPickups.clear();
    prevLocalBuffStacks.clear();

    // Reset buff stacks so new game starts from scratch
    buffManager.reset();

    // Reset weapon mastery kill counters (XP already awarded at game end)
    weaponMastery.reset();

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

    // Reset companions — drones must NOT carry over between rounds
    companionManager.reset();

    // Reset player level — each round starts at level 0 with no aura stacks
    playerLevel.reset();

    // Reset local weapon type display so HUD shows the correct weapon next round
    localPlayerWeaponType = WeaponType.Standard;

    // Clear all active weapon visuals and projectiles from the previous round.
    // Without this, active effects (laser beams, tesla coil aura, black holes) and
    // queued projectiles from the old round persist into the new round's update loop.
    localWeaponManager.clear();

    // Clean up enemy glow trails from the previous round
    enemyGlowTrails.forEach((trail) => {
      scene.remove(trail.root);
      trail.dispose();
    });
    enemyGlowTrails.clear();

    // Reset per-round counters for telemetry
    localPlayerDeaths = 0;

    // Reset camera frame so controls aren't inverted after round reset.
    // Without this, targetUp may still hold the last surface's tangentV, which
    // can mismatch the new spawn orientation and trigger the sign-flip protection.
    cameraController.resetFrameForNewSurface();

    netMainLog('[NetworkMain] Game entities reset for new round');
  }

  // -----------------------------------------------------------------------
  // Client-side game mode lifecycle
  // -----------------------------------------------------------------------

  /** Whether onStart() has been called for the current activeGameMode. */
  let gameModeStarted = false;

  /**
   * Build a GameModeContext using the local player and current scene objects.
   * Returns null if the local player isn't ready yet.
   */
  function buildGameModeContext() {
    const localPlayer = networkPlayers.get(localPlayerId);
    if (!localPlayer || !surface || !enemySpawner) return null;
    return {
      player: localPlayer,
      enemySpawner,
      surface,
      weaponManager: localWeaponManager,
      buffManager,
      game,
      scene: game.scene,
      camera: game.camera,
      // Network mode: spawn warning rings are never cleaned up (enemySpawner.update is not
      // called client-side since server is authoritative). Game modes must skip spawn warnings.
      isNetworkMode: true,
    };
  }

  /**
   * Instantiate and store the game mode from the current latestGameMode string.
   * Called at the lobby → playing transition.
   */
  function startActiveGameMode(): void {
    if (activeGameMode) {
      const ctx = buildGameModeContext();
      if (ctx) activeGameMode.dispose(ctx);
      activeGameMode = null;
    }
    gameModeStarted = false;
    const modeType = latestGameMode as QuickGameModeType;
    if (modeType && modeType !== 'waves') {
      activeGameMode = createGameMode(modeType);
      // onStart() is deferred to the first onFixedUpdate tick where the local
      // player exists — avoids a race with the initial state sync that creates
      // the Player instance for localPlayerId.
    }
  }

  /**
   * Dispose the active game mode and clear state.
   * Called when returning to lobby or voting.
   */
  function disposeActiveGameMode(): void {
    if (activeGameMode) {
      const ctx = buildGameModeContext();
      if (ctx) activeGameMode.dispose(ctx);
      activeGameMode = null;
    }
    gameModeStarted = false;
  }

  // -----------------------------------------------------------------------
  // State change callback: sync server state to local visual entities
  // -----------------------------------------------------------------------

  function onStateChange(state: NetworkGameState) {
    // Track latest full state for pause menu and other callbacks
    latestGameState = state;

    // Track latest server state values for metrics logging
    latestGameTime = state.gameTime;
    latestWaveNumber = state.waveNumber;
    latestMapSize = state.mapSize || 'medium';
    if (state.gameMode) latestGameMode = state.gameMode;

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
        // Stop server is only accessible from the pause menu, never the main HUD.
        stopServerBtn.style.display = 'none';
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

      // Detect life loss and show notification so players can see WHICH player
      // lost a life (proving lives are per-player, not shared).
      // Only fire during active gameplay (gameStarted avoids false positives at round reset).
      if (state.gameStarted) {
        const prev = prevLivesMap.get(id);
        if (prev !== undefined && netPlayer.lives < prev && netPlayer.lives >= 0) {
          showLifeLostNotification(netPlayer.name, netPlayer.lives, id === localPlayerId);
          // Visual feedback: screen shake when a player loses a life but survives
          // (e.g. invincibility granted — alive stays true, lives decrements).
          // Death-based life loss already triggers shake via the wasAlive→!alive block.
          if (netPlayer.alive) {
            screenShake.shake(0.3, 0.3);
          }
          // Track deaths for local player telemetry
          if (id === localPlayerId) {
            localPlayerDeaths++;
          }
        }
      }
      prevLivesMap.set(id, netPlayer.lives);

      // Position on surface using real surface transform (same as co-op).
      // For LOCAL player: reconcile client prediction with server-authoritative position.
      //   Hard-snap was replaced with threshold+blend to eliminate rubber-banding and
      //   "direction inversion" bugs (S34b). The server position is RTT-delayed (~50ms
      //   behind client), so hard-snapping moved the player backward on every state update.
      //   - Large error (>10% UV = respawn / round-start / genuine desync): hard snap
      //   - Small error (normal RTT drift): gentle 10% blend per state update
      //   Mesh position is NOT updated here; the render loop (onRender) handles it at 60Hz
      //   from the corrected surfaceU/V values.
      // For REMOTE players: store target UV for per-frame interpolation in onRender.
      //   The interpolation is done in the render loop at 60Hz instead of here at
      //   30Hz, which is the #1 fix for making LAN feel as smooth as co-op.
      //
      // Threshold: 0.1 UV ≈ 1 second of movement at PLAYER_SPEED (0.105 UV/s, updated S44b-09).
      // Normal RTT drift ≈ 0.005 UV (50ms * 0.105). Snap threshold is 20x RTT drift.
      const SERVER_SNAP_THRESHOLD_SQ = 0.1 * 0.1; // squared for cheap distance check
      const SERVER_CORRECTION_BLEND = 0.1;         // 10% blend per 30Hz state update
      if (id === localPlayerId) {
        const prevAlive = playerAliveState.get(id) ?? true;
        const justRespawned = !prevAlive && netPlayer.alive;
        const isDeadNow = !netPlayer.alive;

        // Store server's tangent frame for stable camera upHint (s44-epic-06).
        // The server's MeshWalker provides a continuous bitangent that doesn't
        // flip sign at UV poles (unlike tangentV from surface.getPoint()).
        const hasServerFrame = netPlayer.bx !== undefined
          && (netPlayer.bx !== 0 || netPlayer.by !== 0 || netPlayer.bz !== 0);
        if (hasServerFrame) {
          _localServerTangent.set(netPlayer.tx!, netPlayer.ty!, netPlayer.tz!);
          _localServerBitangent.set(netPlayer.bx!, netPlayer.by!, netPlayer.bz!);
          _localServerNormal.set(netPlayer.nx!, netPlayer.ny!, netPlayer.nz!);
          _localServerFrameValid = true;
        }

        // s44-epic-08: Always store server world-space position for local player.
        // Previously only used for hard snaps; now stored every frame so onFixedUpdate
        // can use server wx/wy/wz for mesh placement instead of surface.getPoint().
        // This eliminates the "two versions of him" glitch where UV→world conversion
        // disagreed with the server's ServerMeshWalker geodesic position.
        const hasWorldPos08 = netPlayer.wx !== undefined
          && (netPlayer.wx !== 0 || netPlayer.wy !== 0 || netPlayer.wz !== 0);
        if (hasWorldPos08) {
          _localPlayerWorldTarget.x  = netPlayer.wx!;
          _localPlayerWorldTarget.y  = netPlayer.wy!;
          _localPlayerWorldTarget.z  = netPlayer.wz!;
          _localPlayerWorldTarget.nx = netPlayer.nx ?? 0;
          _localPlayerWorldTarget.ny = netPlayer.ny ?? 1;
          _localPlayerWorldTarget.nz = netPlayer.nz ?? 0;
          _localPlayerWorldTarget.tx = netPlayer.tx ?? 1;
          _localPlayerWorldTarget.ty = netPlayer.ty ?? 0;
          _localPlayerWorldTarget.tz = netPlayer.tz ?? 0;
          _localPlayerWorldTarget.valid = true;
        }

        // s44b-01: Snap camera to player position on first server frame.
        // Without this, the camera stays at its initial position (0,15,25) for
        // ~20 frames (CAMERA_LERP_FACTOR=0.12), causing computeCameraRelativeAimAngle
        // to use wrong camera axes and produce ~130° aim error on first spawn.
        // After respawn the camera is already positioned, so it's correct — this
        // snap only fires when hasBeenPositioned=false (i.e., after resetFrameForNewSurface).
        if (!cameraController.hasBeenPositioned && _localServerFrameValid && _localPlayerWorldTarget.valid) {
          const tgt = _localPlayerWorldTarget;
          const snapPos = new THREE.Vector3(
            // s44g-05: Server wx/wy/wz are already in scaled world space (server mesh has
            // scale baked into vertex positions via SurfaceGeometryBuilder). Don't multiply
            // by currentMapSizeScaleFactor — that would double-scale positions on EPIC maps.
            tgt.x + _localServerNormal.x * 0.15,
            tgt.y + _localServerNormal.y * 0.15,
            tgt.z + _localServerNormal.z * 0.15,
          );
          cameraController.snapToFrame(
            snapPos,
            _localServerNormal,
            { tangent: _localServerTangent, bitangent: _localServerBitangent },
          );
        }

        const du = netPlayer.surfaceU - player.surfaceU;
        const dv = netPlayer.surfaceV - player.surfaceV;
        const errSq = du * du + dv * dv;

        if (justRespawned || isDeadNow || errSq > SERVER_SNAP_THRESHOLD_SQ) {
          // Hard snap on: respawn (always snap to spawn location), death/dead state
          // (client prediction may have drifted the UV while dead), large discrepancy
          // (round-start reset or genuine multi-second desync).
          // s44f-06: Reset smoothed orientation so next frame snaps to new facing direction
          // instead of slurring from the pre-respawn orientation.
          _localPlayerQuatInitialized = false;
          player.surfaceU = netPlayer.surfaceU;
          player.surfaceV = netPlayer.surfaceV;
          // Also update mesh position immediately for hard snaps so the mesh appears
          // at the correct location before the render loop runs (avoids 1-frame flash
          // at wrong position on respawn, especially visible when mesh becomes visible).
          // Use server world-space position when available (s44-epic-06) — avoids getPoint().
          const hasWorldPos = netPlayer.wx !== undefined
            && (netPlayer.wx !== 0 || netPlayer.wy !== 0 || netPlayer.wz !== 0);
          if (hasWorldPos) {
            const nx = netPlayer.nx ?? 0; const ny = netPlayer.ny ?? 1; const nz = netPlayer.nz ?? 0;
            player.mesh.position.set(
              // s44g-05: server positions already in scaled world space, no extra multiply
              netPlayer.wx! + nx * 0.15,
              netPlayer.wy! + ny * 0.15,
              netPlayer.wz! + nz * 0.15,
            );
          } else {
            const snapSp: SurfacePoint = surf.getPoint(netPlayer.surfaceU, netPlayer.surfaceV);
            player.mesh.position.copy(snapSp.position).multiplyScalar(currentMapSizeScaleFactor).addScaledVector(snapSp.normal, 0.15);
          }
        } else {
          // Small RTT-induced drift: gentle blend toward server position.
          // This corrects accumulated float error without reversing movement direction.
          player.surfaceU += du * SERVER_CORRECTION_BLEND;
          player.surfaceV += dv * SERVER_CORRECTION_BLEND;
          // Mesh position updated by render loop (onRender) at 60Hz — no update needed here.
        }
      } else {
        // Remote player: store target UV for smooth per-frame interpolation (HUD/DDA/minimap)
        remotePlayerTargetUV.set(id, {
          u: netPlayer.surfaceU,
          v: netPlayer.surfaceV,
          aimAngle: netPlayer.aimAngle,
        });
        // Also update the Player object's UV (used for HUD, DDA, etc.)
        player.surfaceU = netPlayer.surfaceU;
        player.surfaceV = netPlayer.surfaceV;
        // Store world-space target for direct position lerp (s44-epic-06).
        // Avoids UV→world conversion via surface.getPoint() which can be unstable at poles.
        const hasWorldPos = netPlayer.wx !== undefined
          && (netPlayer.wx !== 0 || netPlayer.wy !== 0 || netPlayer.wz !== 0);
        if (hasWorldPos) {
          remotePlayerTargetWorldPos.set(id, {
            x: netPlayer.wx!, y: netPlayer.wy!, z: netPlayer.wz!,
            nx: netPlayer.nx ?? 0, ny: netPlayer.ny ?? 1, nz: netPlayer.nz ?? 0,
            tx: netPlayer.tx ?? 1, ty: netPlayer.ty ?? 0, tz: netPlayer.tz ?? 0,
            aimAngle: netPlayer.aimAngle,
          });
        }
      }

      // Detect alive state transitions -> trigger effects
      const wasAlive = playerAliveState.get(id) ?? true;
      if (wasAlive && !netPlayer.alive) {
        // Player just died: trigger death effects
        // CRITICAL: For remote players, snap mesh to server-authoritative death position
        // before spawning explosion particles. The interpolated mesh position may be
        // lagging behind the actual death UV (onRender hasn't run yet for this frame).
        if (id !== localPlayerId) {
          // Snap to death position — prefer world-space from server (s44-epic-06)
          const deathWorldPos = remotePlayerTargetWorldPos.get(id);
          if (deathWorldPos) {
            player.mesh.position.set(
              // s44g-05: server positions already in scaled world space
              deathWorldPos.x + deathWorldPos.nx * 0.15,
              deathWorldPos.y + deathWorldPos.ny * 0.15,
              deathWorldPos.z + deathWorldPos.nz * 0.15,
            );
          } else {
            const deathSp: SurfacePoint = surf.getPoint(netPlayer.surfaceU, netPlayer.surfaceV);
            player.mesh.position.copy(deathSp.position).multiplyScalar(currentMapSizeScaleFactor).addScaledVector(deathSp.normal, 0.15);
          }
        }
        particles.playerDeath(player.mesh.position);
        screenShake.shake(0.5, 0.4);
        sound.play('playerDeath');
        // DDA: track death event for this player
        const tracker = getOrCreateDDATracker(id);
        tracker.recordDeath();
        // Show spectating overlay for the local player only if there are
        // alive remote players to spectate. For solo games (or last survivor),
        // skip the overlay — voting screen will appear instead (s44d-03 fix).
        if (id === localPlayerId) {
          let hasAliveSpectateTarget = false;
          state.players.forEach((p, pid) => {
            if (pid !== id && p.alive) hasAliveSpectateTarget = true;
          });
          if (hasAliveSpectateTarget) {
            deadOverlay.style.display = 'flex';
          }
          // Death cam: grayscale + darken canvas while player is dead
          UIHelpers.showDeathCamEffect();
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
          // Death cam end: restore normal colors on respawn
          UIHelpers.hideDeathCamEffect();
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

      // Update floating name label — show "(You)" for local player, actual name for remote
      const displayName = id === localPlayerId ? '(You)' : netPlayer.name;
      nameLabels.setLabel(id, displayName, netPlayer.color);
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
        remotePlayerTargetWorldPos.delete(id);
        playerAliveState.delete(id);
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

      // Damage number popup: detect health decrease from server state updates.
      // Server is authoritative for HP; we compare against previous known health
      // to show numbers whenever any source deals damage (bullets, ShockAura, etc.).
      const prevHealth = enemyPrevHealth.get(netEnemy.id);
      if (prevHealth !== undefined && netEnemy.health < prevHealth) {
        const damageDealt = prevHealth - netEnemy.health;
        scorePopups.spawnDamage(enemy.position.clone(), damageDealt);
      }
      enemyPrevHealth.set(netEnemy.id, netEnemy.health);
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

        // Client-side companion pickup drops (~5% chance per kill — stays client-side)
        // NOTE: Buff pickups are now server-authoritative (Phase D) and rendered via
        // networkBuffPickups in onStateChange. Do NOT spawn localBuffPickups here.
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
          }
        }

        // Damage number for killing blow: server removes enemies immediately when they die,
        // so the client never sees health < prevHealth for lethal hits (enemy goes straight
        // from last-known-health to "removed from state"). Spawn the killing-blow damage
        // number here using the last stored health value.
        const killingBlow = enemyPrevHealth.get(id);
        if (killingBlow !== undefined && killingBlow > 0) {
          scorePopups.spawnDamage(enemy.position.clone(), killingBlow);
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

          // PlayerLevel + weapon mastery kill attribution for local player
          if (nearestId === localPlayerId) {
            playerLevel.addKill();
            const killedWithWeapon = localWeaponManager.getCurrentWeapon();
            weaponMastery.recordKill(killedWithWeapon);
            matchUpgradeTracker.recordKill(killedWithWeapon);
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
        enemyPrevHealth.delete(id);

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
        // Store target UV for fallback rendering (not normally used).
        bulletTargetUV.set(bullet.id, {
          u: bullet.x, v: bullet.y,
          dirX: bullet.dirX, dirY: bullet.dirY,
        });
        // s40-08: Hard-resync bullet UV from server state every patch.
        // This prevents client-side prediction drift: after s40-04, the client used
        // FaceWalker which diverges from the server's Christoffel UV path (different
        // world speeds per direction). By resyncing to server UV each patch (~20Hz),
        // the client UV stays within one patch interval of the server position.
        // Bullet then advances using server-mirrored Christoffel equations in onRender.
        const bExisting = bulletPool.getBulletData(existingIdx);
        if (bExisting && bExisting.alive) {
          bExisting.surfaceU = bullet.x;
          bExisting.surfaceV = bullet.y;
          bExisting.dirX = bullet.dirX;
          bExisting.dirY = bullet.dirY;
        }
      } else {
        // New bullet: find an inactive pool slot and activate it directly.
        // We CANNOT call bulletPool.spawn() because it internally calls
        // findInactive() which may find a DIFFERENT slot than newIdx,
        // causing bulletIdToIndex to point to the wrong bullet (race condition).
        // Instead, set the pool data at the found index directly via public API.
        const newIdx = bulletPool.findInactiveSlot();
        if (newIdx >= 0) {
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
          // Keep the legacy bulletPool line HIDDEN — bulletInstanceManager handles
          // all bullet rendering in MP via GPU instancing. Setting line.visible=true
          // here creates ghost bullets at the UNSCALED position (surf.getPoint()
          // returns 1x local-space coords). On EPIC surfaces like peanut (2x scale),
          // these ghost lines appear inside the visible geometry, making bullets look
          // like they originate from the center/origin. The render loop uses
          // transform() which correctly applies mapSizeScaleFactor.
          const line = bulletPool.getLine(newIdx);
          line.visible = false;
          bulletIdToIndex.set(bullet.id, newIdx);
          // Store initial target for interpolation
          bulletTargetUV.set(bullet.id, {
            u: bullet.x, v: bullet.y,
            dirX: bullet.dirX, dirY: bullet.dirY,
          });
          // Store weapon type for visual assignment in the render loop.
          // s44f-03: Use bullet.weaponType (server-set per-bullet field) when available.
          // This enables dual-fire: blaster bullets are 'standard', secondary bullets carry
          // their own type — both can coexist from the same owner in the same state delta.
          // Falls back to ownerPlayer.weaponType for older server versions.
          const ownerPlayer = state.players.get(bullet.ownerId);
          const bulletWType = bullet.weaponType ?? ownerPlayer?.weaponType ?? 'standard';
          const ownerWeapon = SERVER_TO_WEAPON_TYPE[bulletWType] ?? WeaponType.Standard;
          bulletWeaponType.set(bullet.id, ownerWeapon);
          // Track owner ID so we can skip special-weapon server bullets for the local player
          // (whose visuals are handled by localWeaponManager — no flying bullet needed)
          bulletOwnerIds.set(bullet.id, bullet.ownerId);

          // Initialize geodesic face position for client-side geodesic rendering.
          // Server uses UV Christoffel stepping; client uses FaceWalker for true geodesics.
          //
          // s44c-09 FIX: Use owner's server world position (wx/wy/wz) instead of
          // surface.getPoint(bullet.x, bullet.y). The server stores player.surfaceU/V via
          // sphere parameterization (_worldPosToApproxUV), which is WRONG for torus (swaps
          // u and v completely) and approximate for peanut. Using bullet.x/y → getPoint()
          // placed bullets at a completely different location on the torus, creating the
          // "ghost player" effect. Owner's wx/wy/wz is the geodesic world position (correct
          // on all surfaces) and matches the player's visual position from s44-epic-08.
          if (meshSurface && surface) {
            let bulletWorldPos: THREE.Vector3;
            let bulletTangentU: THREE.Vector3;
            let bulletTangentV: THREE.Vector3;

            const hasOwnerWorldPos = ownerPlayer
              && ownerPlayer.wx !== undefined
              && (ownerPlayer.wx !== 0 || ownerPlayer.wy !== 0 || ownerPlayer.wz !== 0);

            if (hasOwnerWorldPos) {
              // s44h-01 FIX: Use owner world position DIRECTLY as bullet spawn position.
              // Previous approach (s44f-08/s44g-05) round-tripped through worldToSurface()
              // → getPoint() to "correct" the UV, but PeanutSurface's worldToSurface had
              // a broken scale estimation that caused bullet positions to drift away from
              // the player — especially near the waist/poles. The server's wx/wy/wz IS the
              // correct world position (computed via geodesic stepping). No UV round-trip needed.
              //
              // s44g-05: server mesh has scale baked into vertex positions, so wx/wy/wz are
              // already in scaled world space. Do NOT multiply by currentMapSizeScaleFactor
              // (that would double-scale). This matches how player.mesh.position is set at
              // line ~2271 (netPlayer.wx directly, no scale multiply).
              const ownerWorldPos = new THREE.Vector3(
                ownerPlayer!.wx!,
                ownerPlayer!.wy!,
                ownerPlayer!.wz!,
              );

              // s44j-10 FIX: For torus, sphere-approx surfaceU/V (server's _worldPosToApproxUV)
              // has swapped axes: u_sphere ≈ ring angle but torus.getPoint uses u=tube, v=ring.
              // This gives completely wrong tangent vectors — for the far half (ring angle ≈ 0),
              // sphere-approx maps to spawn-side (ring angle π), so tangentV points toward spawn
              // instead of away, sending bullets in the wrong direction.
              // Use worldToSurface() to recover correct torus UV for tangent vector calculation.
              // worldToSurface() divides by group.scale.x internally, so ownerWorldPos (already
              // in scaled world space = wx/wy/wz) round-trips correctly.
              // Other surfaces: keep sphere-approx (peanut worldToSurface waist issues, s44h-01).
              const ownerSurfaceUV = lastCreatedSurfaceType === 'torus'
                ? surface.worldToSurface(ownerWorldPos)
                : { u: ownerPlayer!.surfaceU, v: ownerPlayer!.surfaceV };
              const ownerSp = surface.getPoint(ownerSurfaceUV.u, ownerSurfaceUV.v);

              // s44e-01 FIX: For dual-barrel bullets (Standard/Blaster), both bullets share
              // the same owner world position but have slightly different UV spawn coords
              // (perpendicular barrel offset ±0.003). Apply that UV delta as a small
              // world-space offset using tangent vectors.
              const du = bullet.x - ownerPlayer!.surfaceU;
              const dv = bullet.y - ownerPlayer!.surfaceV;
              if (Math.abs(du) > 0.0001 || Math.abs(dv) > 0.0001) {
                // Compute world-space offset from UV delta using tangent vectors.
                // tangentU/V from getPoint() are NORMALIZED unit vectors (not scaled by sphere
                // radius), so we must multiply by DEFAULT_SURFACE_SCALE (sphere radius = 10)
                // in addition to currentMapSizeScaleFactor. Without this, the offset is 10x
                // too small, making both bullets appear as a single bullet (s44j-02 fix).
                const offsetWorld = ownerSp.tangentU.clone().multiplyScalar(du * Math.PI * 2)
                  .addScaledVector(ownerSp.tangentV, dv * Math.PI);
                offsetWorld.multiplyScalar(currentMapSizeScaleFactor * DEFAULT_SURFACE_SCALE);
                bulletWorldPos = ownerWorldPos.clone().add(offsetWorld);
              } else {
                bulletWorldPos = ownerWorldPos;
              }
              bulletTangentU = ownerSp.tangentU;
              bulletTangentV = ownerSp.tangentV;
            } else {
              // Fallback until first server world-pos frame arrives (sphere approx — inaccurate on torus)
              const sp = surface.getPoint(bullet.x, bullet.y);
              bulletWorldPos = sp.position.clone().multiplyScalar(currentMapSizeScaleFactor);
              bulletTangentU = sp.tangentU;
              bulletTangentV = sp.tangentV;
            }

            const closest = meshSurface.closestPointOnSurface(bulletWorldPos);
            if (closest) {
              const facePos = meshSurface.initGeodesicPosition(closest.point, closest.faceIndex);
              // Convert UV-space direction to world-space using surface tangent frame.
              // Apply same torus dirX negation as rendering for consistency.
              const bDirX = lastCreatedSurfaceType === 'torus' ? -bullet.dirX : bullet.dirX;
              const dirWorld = new THREE.Vector3()
                .addScaledVector(bulletTangentU, bDirX)
                .addScaledVector(bulletTangentV, bullet.dirY)
                .normalize();
              bulletGeodesicState.set(bullet.id, { facePos, dirWorld });
            }
          }
        }
      }
    });

    // Remove bullets no longer in server state
    bulletIdToIndex.forEach((idx, id) => {
      if (!activeBulletIds.has(id)) {
        bulletPool.kill(idx);
        bulletIdToIndex.delete(id);
        bulletTargetUV.delete(id);
        bulletGeodesicState.delete(id);
        bulletWeaponType.delete(id);
        bulletOwnerIds.delete(id);
        // Remove from instanced rendering (standard weapon renders 2 visual bullets: _l and _r)
        bulletInstanceManager.removeBullet(id + '_l');
        bulletInstanceManager.removeBullet(id + '_r');
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

    // ----- Sync super pickups (bomb resupply / multiplier boost) -----
    const activeSuperPickupIds = new Set<string>();
    state.superPickups.forEach((netPickup: NetworkSuperPickupState) => {
      if (!netPickup.active) return;
      activeSuperPickupIds.add(netPickup.id);

      if (!networkSuperPickups.has(netPickup.id)) {
        // Create gold pulsing sphere visual
        const group = new THREE.Group();
        group.name = `SuperPickup_${netPickup.pickupType}_${netPickup.id}`;

        const color = netPickup.pickupType === 'bomb_resupply'
          ? new THREE.Color(0xffd700) // gold for bomb resupply
          : new THREE.Color(0xff8800); // orange for multiplier boost

        // Outer sphere (wireframe)
        const outerMat = new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.7,
        });
        outerMat.userData.baseOpacity = 0.7;
        const outerMesh = new THREE.Mesh(superPickupGeometry, outerMat);
        outerMesh.scale.setScalar(1.4);
        group.add(outerMesh);

        // Inner solid sphere
        const innerMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
        });
        innerMat.userData.baseOpacity = 0.9;
        const innerMesh = new THREE.Mesh(superPickupGeometry, innerMat);
        innerMesh.name = 'core';
        group.add(innerMesh);

        // Glow sprite
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = 64; glowCanvas.height = 64;
        const glowCtx = glowCanvas.getContext('2d')!;
        const r = Math.floor(color.r * 255), g = Math.floor(color.g * 255), b = Math.floor(color.b * 255);
        const grad = glowCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
        grad.addColorStop(0.4, `rgba(${r},${g},${b},0.4)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        glowCtx.fillStyle = grad;
        glowCtx.fillRect(0, 0, 64, 64);
        const glowMat = new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(glowCanvas),
          transparent: true,
          opacity: 0.5,
          blending: THREE.NormalBlending,
          depthWrite: false,
        });
        glowMat.userData.baseOpacity = 0.5;
        const glowSprite = new THREE.Sprite(glowMat);
        glowSprite.scale.setScalar(2.0);
        group.add(glowSprite);

        scene.add(group);
        networkSuperPickups.set(netPickup.id, {
          mesh: group,
          surfaceU: netPickup.surfaceU,
          surfaceV: netPickup.surfaceV,
          pickupType: netPickup.pickupType,
          spawnTime: game.clock.totalTime,
        });
      } else {
        // Update position from server
        const visual = networkSuperPickups.get(netPickup.id)!;
        visual.surfaceU = netPickup.surfaceU;
        visual.surfaceV = netPickup.surfaceV;
        if (getTransform) {
          const { position, normal } = getTransform(visual.surfaceU, visual.surfaceV);
          visual.mesh.position.copy(position).addScaledVector(normal, 0.5);
        }
      }
    });
    // Remove collected/expired super pickups (with particle burst effect)
    networkSuperPickups.forEach((visual, id) => {
      if (!activeSuperPickupIds.has(id)) {
        // Fire collection burst at pickup position
        const burstColor = visual.pickupType === 'bomb_resupply'
          ? new THREE.Color(0xffd700)  // gold
          : new THREE.Color(0xff8800); // orange
        particles.enemyDeath(visual.mesh.position, burstColor);
        sound.play('multiplierUp', { volume: 0.6, pitch: 1.5 });

        scene.remove(visual.mesh);
        visual.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material instanceof THREE.Material && child.material.dispose();
          }
          if (child instanceof THREE.Sprite) {
            child.material.map?.dispose();
            child.material.dispose();
          }
        });
        networkSuperPickups.delete(id);
      }
    });

    // ----- Sync weapon pickups (using real WeaponPickup class) -----
    const activePickupIds = new Set<string>();
    state.weaponPickups.forEach((netPickup: NetworkWeaponPickupState) => {
      if (!netPickup.active) return;
      activePickupIds.add(netPickup.id);

      let pickup = networkWeaponPickups.get(netPickup.id);
      if (!pickup) {
        // Create a real WeaponPickup (same as co-op), passing the current map scale
        // so the bob animation and collision radius scale proportionally with the surface.
        const weaponType = SERVER_TO_WEAPON_TYPE[netPickup.weaponType] ?? WeaponType.Spread;
        pickup = new WeaponPickup(weaponType, netPickup.surfaceU, netPickup.surfaceV, currentMapSizeScaleFactor);
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

    // ----- Sync server-authoritative buff pickups (Phase D) -----
    // Server spawns buff pickups on enemy death; client renders them using BuffPickupNew.
    // Collection is server-authoritative — pickups disappear from state when collected.
    const activeBuffPickupIds = new Set<string>();
    state.buffPickups.forEach((netPickup: NetworkBuffPickupState) => {
      if (!netPickup.active) return;
      activeBuffPickupIds.add(netPickup.id);

      let bp = networkBuffPickups.get(netPickup.id);
      if (!bp) {
        // Create visual using existing BuffPickupNew (same as co-op)
        // StackBuffType enum values ARE the string values (e.g. StackBuffType.HotHands === 'hot_hands')
        bp = new BuffPickupNew(netPickup.buffType as StackBuffType, netPickup.surfaceU, netPickup.surfaceV, currentMapSizeScaleFactor);
        scene.add(bp.mesh);
        networkBuffPickups.set(netPickup.id, bp);
      }

      // Update position from server
      bp.surfaceU = netPickup.surfaceU;
      bp.surfaceV = netPickup.surfaceV;
      if (getTransform) {
        bp.applySurfaceTransform(getTransform);
      }
    });
    // Remove collected/expired buff pickups
    networkBuffPickups.forEach((bp, id) => {
      if (!activeBuffPickupIds.has(id)) {
        scene.remove(bp.mesh);
        bp.dispose();
        networkBuffPickups.delete(id);
      }
    });

    // ----- Sync local player buff stacks from server (Phase D) -----
    // When server confirms a buff collection, reflect it in local buffManager
    // so HUD and visual effects (ShockAura, aura glow) stay in sync.
    const localPlayerForBuffs = state.players.get(localPlayerId);
    if (localPlayerForBuffs?.buffStacks) {
      localPlayerForBuffs.buffStacks.forEach((serverCount: number, buffType: string) => {
        const prevCount = prevLocalBuffStacks.get(buffType) ?? 0;
        if (serverCount > prevCount) {
          // Server confirmed new stacks — add them to local buffManager
          for (let i = prevCount; i < serverCount; i++) {
            buffManager.addBuff(buffType as StackBuffType);
          }
          sound.play('weaponPickup', { volume: 0.4, pitch: 1.2 });
        }
        prevLocalBuffStacks.set(buffType, serverCount);
      });
    }

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

      // Lives display (hearts, same as single player; ∞ when infinite lives enabled)
      const isInfiniteLives = state.infiniteLives === true;
      const lives = Math.max(0, localPlayer.lives);
      const livesStr = isInfiniteLives
        ? '\u2665 \u221e'
        : (lives <= 5 ? '\u2665'.repeat(lives) : `\u2665 x${lives}`);

      // Bombs display
      const bombs = Math.max(0, localPlayer.bombs);
      const bombsStr = bombs <= 5
        ? '\u25cf'.repeat(bombs)
        : `\u25cf x${bombs}`;

      const isZoneTimeMode = latestGameMode === 'king' || latestGameMode === 'claustrophobia';
      if (isZoneTimeMode) {
        // Primary score = zone time (seconds inside zone/boundary)
        const zt = localPlayer.zoneTime ?? 0;
        const ztMins = Math.floor(zt / 60);
        const ztSecs = Math.floor(zt % 60);
        const ztTenths = Math.floor((zt % 1) * 10);
        const ztStr = ztMins > 0
          ? `${ztMins}:${String(ztSecs).padStart(2, '0')}.${ztTenths}`
          : `${ztSecs}.${ztTenths}s`;
        const modeLabel = latestGameMode === 'king' ? '👑 ZONE' : '🔴 ZONE';
        let primaryHtml = `${modeLabel}: ${ztStr}`;
        if (latestGameMode === 'claustrophobia' || latestGameMode === 'king') {
          // Secondary: kill points (zone time is primary; kills shown below)
          primaryHtml += `<br><span style="font-size:0.75em;color:#aaa">PTS: ${localPlayer.score.toLocaleString()}</span>`;
        }
        scoreEl.innerHTML =
          `${primaryHtml}<br>` +
          `<span style="color:${mColor}">x${localPlayer.multiplier}</span><br>` +
          `${livesStr}<br>` +
          `${bombsStr}`;
      } else {
        scoreEl.innerHTML =
          `Score: ${localPlayer.score.toLocaleString()}<br>` +
          `<span style="color:${mColor}">x${localPlayer.multiplier}</span><br>` +
          `${livesStr}<br>` +
          `${bombsStr}`;
      }

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
    // Combined team score — sum of all player scores (or zone time for KotH/Claustrophobia)
    const isZoneTimeModeList = latestGameMode === 'king' || latestGameMode === 'claustrophobia';
    let combinedScore = 0;
    let playerList = '<b>Players:</b><br>';
    state.players.forEach((p: NetworkPlayerState) => {
      const you = p.id === localPlayerId ? ' (YOU)' : '';
      const lives = Math.max(0, p.lives);
      const livesHtml = p.alive
        ? (state.infiniteLives ? '\u2665 \u221e' : (lives <= 5 ? '\u2665'.repeat(lives) : `\u2665 x${lives}`))
        : '<span style="color:#ff5555">[DEAD]</span>';
      if (isZoneTimeModeList) {
        const zt = p.zoneTime ?? 0;
        combinedScore += zt;
        const ztMins = Math.floor(zt / 60);
        const ztStr = ztMins > 0
          ? `${ztMins}:${(zt % 60).toFixed(1).padStart(4, '0')}s`
          : `${zt.toFixed(1)}s`;
        playerList += `${p.name}${you}: ${livesHtml} ${ztStr}<br>`;
      } else {
        combinedScore += p.score;
        playerList += `${p.name}${you}: ${livesHtml} ${p.score.toLocaleString()}<br>`;
      }
    });
    playersEl.innerHTML = playerList;
    if (teamScoreEl) {
      if (isZoneTimeModeList) {
        const ztMins = Math.floor(combinedScore / 60);
        teamScoreEl.textContent = ztMins > 0 ? `${ztMins}:${(combinedScore % 60).toFixed(1).padStart(4, '0')}` : `${combinedScore.toFixed(1)}s`;
      } else {
        teamScoreEl.textContent = combinedScore.toLocaleString();
      }
    }

    // Sync pause state from server
    if (state.isPaused !== isPaused) {
      showPauseOverlay(state.isPaused);
    }

    // ---- Room phase handling (voting lobby state machine) ----
    const newPhase = state.roomPhase || 'lobby';
    if (newPhase !== currentRoomPhase) {
      netMainLog(`[NetworkMain] roomPhase: ${currentRoomPhase} → ${newPhase}`);
      // Save old phase for else-if condition checks, then update immediately.
      // CRITICAL: currentRoomPhase must be updated BEFORE any synchronous callbacks
      // (e.g. proceedToVoting) that check it — otherwise the guard fires too early
      // and the voting screen never shows when anyXP=false (s44d-03 fix).
      const prevRoomPhase = currentRoomPhase;
      currentRoomPhase = newPhase;

      if (newPhase === 'voting') {
        // Game ended — transition to voting screen.
        // Hide spectating overlay — no longer relevant when voting starts.
        deadOverlay.style.display = 'none';
        // Hide GameOverScreen if it snuck in (from the old gameOver bool path).
        gameOverScreen.hide();
        // Re-enable pass-through so mastery/voting screen buttons work on mobile.
        if (input instanceof TouchInput) input.setGamePaused(true);
        // Show MasteryProgressScreen first (if any XP was earned), then VotingScreen.
        const killsByWeapon = weaponMastery.getKillsByWeapon();
        const xpResults = masteryStore.awardGameXP(killsByWeapon);
        masteryStore.save();
        latestVotingState = state; // seed with transition-time state; updated every onStateChange
        const anyXP = xpResults.some(r => r.xpAfter > r.xpBefore);
        const anyLevelUp = xpResults.some(r => r.leveledUp);

        const proceedToVoting = () => {
          // Only show voting if still in voting phase
          if (currentRoomPhase === 'voting') {
            votingScreen.show(latestVotingState ?? state, isHost, localPlayerId);
          }
        };

        const proceedAfterMastery = () => {
          // If any weapon leveled up, show the upgrade tree before voting
          if (anyLevelUp) {
            const upgradeScreen = new WeaponMasteryScreen();
            upgradeScreen.setPointStore(masteryPointStore);
            upgradeScreen.show(MasteryStore.load());
            const cleanup = () => {
              upgradeScreen.dispose();
              proceedToVoting();
            };
            upgradeScreen.onClose(cleanup);
          } else {
            proceedToVoting();
          }
        };

        if (anyXP) {
          const masteryScreen = new MasteryProgressScreen();
          activeMasteryScreen = masteryScreen;
          masteryScreen.show(
            {
              results: xpResults,
              allLevels: masteryStore.getAllLevels(),
              getBonusDescription: (w, lv) => masteryStore.getBonusDescription(w, lv),
            },
            () => {
              activeMasteryScreen = null;
              masteryScreen.dispose();
              proceedAfterMastery();
            },
          );
        } else {
          proceedAfterMastery();
        }
      } else if (newPhase === 'playing' && prevRoomPhase === 'voting') {
        // New game starting after vote — reset and launch.
        startActiveGameMode();
        votingScreen.hide();
        // Dismiss any open mastery overlay from the voting screen.
        if (activeVotingMasteryScreen) {
          activeVotingMasteryScreen.dispose();
          activeVotingMasteryScreen = null;
        }
        // If the voting countdown expired while the mastery progress screen was still showing,
        // dismiss it now so the player doesn't get stuck on a stale screen.
        if (activeMasteryScreen) {
          activeMasteryScreen.dispose();
          activeMasteryScreen = null;
        }
        // Reset per-match upgrade tracker for the new round.
        matchUpgradeTracker = new MatchUpgradeTracker(masteryPointStore.getUnlockedNodes());
        matchUpgradeTracker.onUpgradeActivated = (nodeId, weaponType) => {
          upgradeNotification.show(nodeId, weaponType);
        };
        localWeaponManager.setUpgradeTracker(matchUpgradeTracker);
        pauseMenu.setMatchUpgradeTracker(matchUpgradeTracker);
        resetGameEntities();
        // Force-cleanup and rebuild the surface for the new game round.
        // initSurface() at the top of onStateChange may have returned early if the
        // surface type didn't change (same map type played twice), leaving the old
        // surface in the scene with stale objects floating at previous-map coordinates.
        // Calling cleanupSurface() here guarantees the old surface is removed, then
        // initSurface() recreates it fresh regardless of whether the type changed.
        cleanupSurface();
        if (state.surfaceType) {
          initSurface(state.surfaceType, true, state.mapSize || undefined);
        }
        // Fix: respect isPaused so joining mid-paused-game doesn't enable joystick
        // while pause menu is shown (which blocks scroll via preventDefault).
        if (input instanceof TouchInput) input.setGamePaused(isPaused);
      } else if (newPhase === 'playing' && prevRoomPhase === 'lobby') {
        // Initial game start: lobby → playing.
        startActiveGameMode();
        // Reset entities (safe to call even when empty — clears any stale state).
        // Reset per-match upgrade tracker for the first round.
        matchUpgradeTracker = new MatchUpgradeTracker(masteryPointStore.getUnlockedNodes());
        matchUpgradeTracker.onUpgradeActivated = (nodeId, weaponType) => {
          upgradeNotification.show(nodeId, weaponType);
        };
        localWeaponManager.setUpgradeTracker(matchUpgradeTracker);
        pauseMenu.setMatchUpgradeTracker(matchUpgradeTracker);
        resetGameEntities();
        gameOverScreen.hide();
        votingScreen.hide();
        // Fix: respect isPaused so joining mid-paused-game doesn't enable joystick
        // while pause menu is shown (which blocks scroll via preventDefault).
        if (input instanceof TouchInput) input.setGamePaused(isPaused);
      } else if (newPhase === 'lobby') {
        disposeActiveGameMode();
        votingScreen.hide();
        gameOverScreen.hide();
        // Back to lobby — re-enable pass-through for lobby buttons.
        if (input instanceof TouchInput) input.setGamePaused(true);
      }
    }

    // If currently in voting phase, keep VotingScreen updated with latest state.
    // Also track the latest state so the mastery→voting handoff uses fresh countdown.
    if (currentRoomPhase === 'voting') {
      latestVotingState = state;
      votingScreen.update(state, isHost, localPlayerId);
    }

    // Game state — derive status text from roomPhase + legacy flags
    if (currentRoomPhase === 'voting') {
      statusEl.textContent = 'VOTING';
      startBtn.style.display = 'none';
      modeSelectorDiv.style.display = 'none';
    } else if (state.gameStarted && currentRoomPhase === 'playing') {
      statusEl.textContent = state.isPaused ? 'PAUSED' : `Wave ${state.waveNumber}`;
      startBtn.style.display = 'none';
      modeSelectorDiv.style.display = 'none';
    } else if (state.gameOver && currentRoomPhase !== 'voting') {
      // Legacy path: gameOver flag (pre-voting-state-machine servers or initial game)
      statusEl.textContent = 'GAME OVER';
      startBtn.style.display = 'none';
      modeSelectorDiv.style.display = 'none';
      if (!gameOverShown) {
        gameOverShown = true;
        const localPlayer = state.players.get(localPlayerId);
        const isZoneTimeMode = latestGameMode === 'king' || latestGameMode === 'claustrophobia';
        const score = isZoneTimeMode
          ? Math.round((localPlayer?.zoneTime ?? 0) * 100) // centiseconds, matches KingMode.getScore()
          : (localPlayer?.score ?? 0);
        const modeDisplayName = latestGameMode ? latestGameMode.toUpperCase() : undefined;
        gameOverScreen.show(score, lastCreatedSurfaceType || 'sphere', 'network', undefined, modeDisplayName);
      }
    } else if (currentRoomPhase === 'lobby' || (!state.gameStarted && !state.gameOver)) {
      if (isHost) {
        // Host sees the Start Game button and mode selector.
        statusEl.textContent = 'Waiting for players... (Host: select mode + press START GAME)';
        startBtn.style.display = 'block';
        modeSelectorDiv.style.display = 'block';
      } else {
        // Non-host: show waiting message with current selected mode.
        const modeLabel = LOBBY_MODES.find(m => m.id === state.gameMode)?.label ?? state.gameMode?.toUpperCase() ?? 'WAVES';
        statusEl.textContent = `Waiting for host to start... Mode: ${modeLabel}`;
        startBtn.style.display = 'none';
        modeSelectorDiv.style.display = 'none';
      }
    }

    // Safety guard: ensure joystick input is disabled whenever we're NOT in active gameplay.
    // This fires on every state update (~30Hz) and corrects any stale gamePaused=false
    // that may have slipped through from showPauseOverlay/hideLocalMenu/onGameStart race conditions.
    if (input instanceof TouchInput && currentRoomPhase !== 'playing') {
      input.setGamePaused(true);
    }
  }

  // -----------------------------------------------------------------------
  // Connect to server
  // -----------------------------------------------------------------------

  const urlSurfaceType = getUrlSurfaceType();
  const playerName = getPlayerName();
  const { primary: serverUrl, fallback: fallbackUrl } = getServerUrls();

  // Always log connection details — essential for LAN debugging
  const serverHostname = (() => { try { return new URL(serverUrl.replace(/^ws/, 'http')).hostname; } catch { return '(parse error)'; } })();
  const isCrossOrigin = serverHostname !== window.location.hostname;
  console.log('[NetworkMain] === LAN CONNECTION INFO ===');
  console.log(`[NetworkMain] Primary URL: ${serverUrl}`);
  console.log(`[NetworkMain] Fallback URL: ${fallbackUrl ?? '(none)'}`);
  console.log(`[NetworkMain] Page origin:  ${window.location.origin}`);
  console.log(`[NetworkMain] Page URL:     ${window.location.href}`);
  console.log(`[NetworkMain] Server host:  ${serverHostname}`);
  console.log(`[NetworkMain] Cross-origin: ${isCrossOrigin ? 'YES ⚠ (CORS required)' : 'no (same-origin ✓)'}`);
  console.log(`[NetworkMain] Player name:  ${playerName}`);
  console.log(`[NetworkMain] Surface:      ${urlSurfaceType}`);
  console.log('[NetworkMain] Connecting...');

  // Pre-connection diagnostic: check if the server is reachable via HTTP.
  // This helps diagnose proxy vs direct port issues without waiting for
  // the full Colyseus timeout. Runs asynchronously — doesn't block connect.
  // Results are stored so the error panel can display them.
  const diagnosticResults: Record<string, string> = {};
  {
    const proxyHealthUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://') + '/health';
    const directHealthUrl = `http://${window.location.hostname}:2567/health`;
    const checkHealth = async (label: string, url: string) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const status = res.ok ? 'OK' : `HTTP ${res.status}`;
        diagnosticResults[label] = status;
        console.log(`[NetworkMain] ${label} health check: ${status} (${url})`);
      } catch (e) {
        const msg = (e as Error).message;
        diagnosticResults[label] = `FAILED: ${msg}`;
        console.warn(`[NetworkMain] ${label} health check FAILED: ${msg} (${url})`);
      }
    };
    // Also test the matchmake endpoint specifically (Colyseus handles this
    // separately from Express, with its own CORS headers)
    const matchmakeTestUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://') + '/matchmake/game';
    const checkMatchmake = async () => {
      try {
        const res = await fetch(matchmakeTestUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
          credentials: 'include',
        });
        const status = res.ok ? 'OK' : `HTTP ${res.status}`;
        diagnosticResults['Matchmake'] = status;
        console.log(`[NetworkMain] Matchmake endpoint: ${status} (${matchmakeTestUrl})`);
      } catch (e) {
        const msg = (e as Error).message;
        diagnosticResults['Matchmake'] = `FAILED: ${msg}`;
        console.warn(`[NetworkMain] Matchmake check FAILED: ${msg} (${matchmakeTestUrl})`);
      }
    };
    checkHealth('Proxy', proxyHealthUrl);
    checkHealth('Direct', directHealthUrl);
    checkMatchmake();
  }

  // Game engine and lobby UI are fully initialized — dismiss loading overlay so the
  // lobby (statusEl, player list, mode selector) is visible during connection.
  hideGameLoading();

  // Mobile-only: show orientation prompt (portrait → landscape) and pinch-to-zoom hint.
  if (mobile) {
    runMobileOnboarding();
  }

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
    requestHost: isGameCreator(),
    mapSize: getUrlMapSize(),
    onRetrying: () => {
      // First attempt failed — show reconnecting status while auto-retry is in progress.
      // This fires on mobile when the network is still stabilizing after screen-on.
      statusEl.textContent = 'Connection failed — reconnecting...';
      console.log('[NetworkMain] Auto-retrying connection after initial failure...');
    },
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
      // Stop server is only in the pause menu — never shown in the HUD.
      stopServerBtn.style.display = 'none';
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
        // Game is now active — enable joystick touch capture.
        if (input instanceof TouchInput) input.setGamePaused(false);
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
          const localPlayerState = latestGameState?.players.get(localPlayerId);
          const isZoneTimeMode = latestGameMode === 'king' || latestGameMode === 'claustrophobia';
          const score = isZoneTimeMode
            ? Math.round((localPlayerState?.zoneTime ?? 0) * 100)
            : (localPlayerState?.score ?? networkPlayers.get(localPlayerId)?.score ?? 0);
          const modeDisplayName = latestGameMode ? latestGameMode.toUpperCase() : undefined;
          gameOverScreen.show(score, lastCreatedSurfaceType || 'sphere', 'network', undefined, modeDisplayName);
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
      onPlayerLeave: (id: string) => {
        // Immediately remove the entity when the server removes this player from
        // state.players (fires from Colyseus onRemove, before the debounced
        // onStateChange reconciliation runs). This prevents a 1-frame ghost.
        const player = networkPlayers.get(id);
        if (player) {
          glowManager.removeGlow(player.mesh);
          scene.remove(player.mesh);
        }
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
        remotePlayerTargetWorldPos.delete(id);
        playerAliveState.delete(id);
        netMainLog(`[NetworkMain] Player ${id} entity removed immediately on disconnect`);
      },
      onHostLeft: () => {
        handleConnectionLost('Host disconnected from the game.');
      },
      onHostChanged: (newHostId: string) => {
        // isHost is updated via onStateChange (state.hostId sync), but give
        // immediate visual feedback here before the next state patch arrives.
        if (newHostId === localPlayerId) {
          isHost = true;
          // Stop server is only in the pause menu — never shown in the HUD.
          stopServerBtn.style.display = 'none';
          statusEl.textContent = 'You are now the host!';
          statusEl.style.color = '#0ff';
          netMainLog('[NetworkMain] Host role transferred to this client');
        }
      },
      onGameEnded: () => {
        handleConnectionLost('The host has ended the game.');
      },
      onPlayerLevelUp: (data: { playerId: string; newLevel: number; playerName: string }) => {
        if (data.playerId === localPlayerId) {
          // Server confirms local player leveled up — show notification with perk data
          const perk = getLevelPerk(data.newLevel);
          levelUpNotification.show(data.newLevel, perk);
          sound.play('multiplierUp', { pitch: 1.2 + data.newLevel * 0.05 });
        }
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
      onPhaseSync: (data: { phase: string; isPaused: boolean }) => {
        // Server told us the current game phase on join. Hide lobby UI immediately
        // and let onStateChange (triggered by the phase_sync handler) show the
        // correct screen. Without this, lobby buttons flash briefly before voting
        // screen appears via the 100ms polling interval. (s44j-14)
        if (data.phase === 'voting') {
          startBtn.style.display = 'none';
          modeSelectorDiv.style.display = 'none';
          statusEl.textContent = 'VOTING';
        } else if (data.phase === 'playing') {
          startBtn.style.display = 'none';
          modeSelectorDiv.style.display = 'none';
          // If the game is currently paused, show the pause overlay immediately so the
          // joining client sees the pause screen instead of a blank canvas. (s44j-21)
          if (data.isPaused && !isPaused) {
            showPauseOverlay(true);
          }
        }
      },
    });

    // Immediately sync state so the correct screen (lobby/voting/playing) is shown
    // without waiting for the 100ms polling interval. This prevents the flash of
    // lobby UI when rejoining during voting or mid-game. (s44j-14)
    network.triggerInitialSync();
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
    reason.style.cssText = 'color:#faa;font-size:14px;margin-bottom:12px;max-width:600px;text-align:center;word-break:break-word;white-space:pre-wrap;';
    reason.textContent = isServerDown
      ? `Could not reach game server at ${serverUrl}`
      : `Error: ${msg}`;
    errPanel.appendChild(reason);

    // Session-expiry hint — shown when the server is reachable but the session failed.
    // This is the typical mobile screen-off scenario: screen off → WiFi drops →
    // server cleans up the session → screen on → reconnect still fails after auto-retry.
    const sessionHint = document.createElement('div');
    sessionHint.style.cssText = 'color:#888;font-size:13px;margin-bottom:16px;max-width:520px;text-align:center;line-height:1.6;border:1px solid #333;padding:10px 16px;border-radius:4px;';
    sessionHint.textContent = isServerDown
      ? 'Your phone may have lost Wi-Fi when the screen turned off. Retrying once automatically — if it still fails, check the connection and try again.'
      : 'If your screen turned off while in a game, your session may have expired. Tap RETRY — you will rejoin as a new player.';
    errPanel.appendChild(sessionHint);

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
      `2. Firewall: Windows must allow inbound TCP on port 3000 (the Vite dev server port)`,
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

    // Show pre-connection diagnostic results (if available)
    const diagEntries = Object.entries(diagnosticResults);
    if (diagEntries.length > 0) {
      const diagSection = document.createElement('div');
      diagSection.style.cssText = 'color:#666;font-size:12px;margin-bottom:16px;max-width:600px;text-align:left;border:1px solid #333;padding:10px;border-radius:4px;';
      diagSection.innerHTML = '<div style="color:#888;margin-bottom:6px;font-weight:bold;">Connection Diagnostics:</div>' +
        `<div>Server URL: <span style="color:#0af">${serverUrl}</span></div>` +
        `<div>Fallback URL: <span style="color:#0af">${fallbackUrl ?? '(none)'}</span></div>` +
        `<div>Cross-origin: <span style="color:${isCrossOrigin ? '#f44' : '#0f0'}">${isCrossOrigin ? 'YES' : 'no (same-origin)'}</span></div>` +
        diagEntries.map(([label, status]) =>
          `<div>${label}: <span style="color:${status.startsWith('OK') ? '#0f0' : '#f44'}">${status}</span></div>`
        ).join('');
      errPanel.appendChild(diagSection);
    }

    // Diagnostic link
    const diagLink = document.createElement('a');
    diagLink.href = '/lan-test.html';
    diagLink.textContent = 'Run LAN Diagnostics';
    diagLink.style.cssText =
      'color:#0af;font-size:14px;margin-bottom:20px;letter-spacing:1px;';
    errPanel.appendChild(diagLink);

    // Portproxy detection placeholder — async-populated after panel mounts
    const portproxyHint = document.createElement('div');
    portproxyHint.style.cssText = 'display:none;';
    errPanel.appendChild(portproxyHint);

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

    // Copy Debug Info button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 COPY DEBUG INFO';
    copyBtn.style.cssText =
      'margin-top:12px;padding:8px 20px;font:bold 13px monospace;background:#001133;color:#06f;' +
      'border:1px solid #06f;cursor:pointer;letter-spacing:1px;';
    copyBtn.onclick = () => {
      const info = [
        `=== LAN DEBUG INFO ===`,
        `Date: ${new Date().toISOString()}`,
        `Page: ${window.location.href}`,
        `Server URL: ${serverUrl}`,
        `Fallback URL: ${fallbackUrl ?? '(none)'}`,
        `Cross-origin: ${isCrossOrigin}`,
        `Error: ${msg}`,
        `--- Diagnostics ---`,
        ...Object.entries(diagnosticResults).map(([k, v]) => `${k}: ${v}`),
      ].join('\n');
      navigator.clipboard.writeText(info).then(
        () => { copyBtn.textContent = '✓ COPIED'; setTimeout(() => { copyBtn.textContent = '📋 COPY DEBUG INFO'; }, 2000); },
        () => { copyBtn.textContent = 'COPY FAILED — SEE CONSOLE'; }
      );
    };
    errPanel.appendChild(copyBtn);

    // Direct connect input — bypass lobby, type host IP manually
    const directDiv = document.createElement('div');
    directDiv.style.cssText = 'margin-top:20px;max-width:600px;width:100%;border-top:1px solid #333;padding-top:16px;';
    directDiv.innerHTML = '<div style="color:#666;font-size:12px;margin-bottom:8px;letter-spacing:1px;">DIRECT CONNECT (bypass lobby — type host IP)</div>';
    const directRow = document.createElement('div');
    directRow.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const directInput = document.createElement('input');
    directInput.type = 'text';
    directInput.placeholder = '192.168.1.100';
    directInput.value = window.location.hostname !== 'localhost' ? window.location.hostname : '';
    directInput.style.cssText =
      'flex:1;padding:8px 12px;font:14px monospace;background:#001;color:#0af;' +
      'border:1px solid #06f;outline:none;';
    const directBtn = document.createElement('button');
    directBtn.textContent = 'CONNECT';
    directBtn.style.cssText =
      'padding:8px 16px;font:bold 13px monospace;background:#003;color:#06f;' +
      'border:1px solid #06f;cursor:pointer;white-space:nowrap;';
    directBtn.onclick = () => {
      const ip = directInput.value.trim();
      if (!ip) return;
      const params = new URLSearchParams(window.location.search);
      const surface = params.get('surface') || urlSurfaceType || 'sphere';
      const name = params.get('name') || playerName;
      window.location.href = `http://${ip}:3000/?mode=network&surface=${surface}&name=${encodeURIComponent(name)}`;
    };
    directInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') directBtn.click(); });
    directRow.appendChild(directInput);
    directRow.appendChild(directBtn);
    directDiv.appendChild(directRow);
    errPanel.appendChild(directDiv);

    document.body.appendChild(errPanel);

    // Async portproxy check — runs after panel is in DOM so we can update it.
    // If the host PC has stale WSL2 portproxy rules, this is the most likely
    // cause of laptop connection failures (portproxy intercepts LAN traffic
    // on port 3000 and routes it to WSL2 which has no server).
    fetch('/__lan/status', { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : null)
      .then((status: { portproxyConflict?: boolean; isWSL2?: boolean } | null) => {
        if (status?.portproxyConflict && !status?.isWSL2) {
          portproxyHint.style.cssText =
            'margin:12px 0;padding:12px 16px;background:#330000;border:2px solid #f44;' +
            'max-width:600px;font-size:13px;line-height:1.8;text-align:left;color:#faa;';
          portproxyHint.innerHTML =
            '<b style="color:#f44">⚠ PORTPROXY CONFLICT DETECTED</b><br>' +
            'Windows WSL2 port forwarding rules are intercepting laptop connections.<br>' +
            'Laptop traffic on port 3000 is being redirected to WSL2 (which has no server).<br>' +
            '<b>Fix:</b> Run <code style="background:#222;padding:2px 4px">CLEANUP-PORTPROXY.bat</code> ' +
            'as Administrator, then retry.';
          portproxyHint.style.display = '';
          console.error('[NetworkMain] PORTPROXY CONFLICT: WSL2 port forwarding rules are intercepting LAN traffic. Run CLEANUP-PORTPROXY.bat as Administrator.');
        }
      })
      .catch(() => { /* /__lan/status unavailable in production — ignore */ });

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

  // -- Smoothed orientation for local player (s44f-06) --
  // sharedOrientPlayerOnSurface sets mesh.quaternion directly with no slerp,
  // causing visual jitter from frame-to-frame variation in tangent/aimAngle.
  // SP uses Player.applySurfaceTransform which has ROTATION_SMOOTHING=0.4 slerp.
  // We mirror that smoothing here for the local player in LAN mode.
  const _localPlayerSmoothedQuat = new THREE.Quaternion();
  let _localPlayerQuatInitialized = false;
  // Smoothing factor — matches Player.ts ROTATION_SMOOTHING (0.4)
  const LOCAL_PLAYER_ROTATION_SMOOTHING = 0.4;
  // s44h-08: Predicted world position for local player visual + camera.
  // Updated in onFixedUpdate when client prediction moves the player.
  // Used so the camera target (and mesh when moving) responds immediately to input,
  // matching SP where MeshWalker updates position from input on the same tick (0 lag).
  const _predictedPlayerVisualPos = new THREE.Vector3();
  const _predictedPlayerVisualNormal = new THREE.Vector3(0, 1, 0);
  let _predictedPlayerVisualValid = false;
  // Actual wall-clock time of last render call (ms). Used for bullet UV stepping
  // so bullets advance at the correct rate regardless of display refresh rate.
  let lastRenderTimestampMs = 0;

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

    // Compute aim angle in surface UV space, corrected for camera-frame misalignment.
    // The naive formula atan2(-mouseY, mouseX) assumes camera.right == tangentU, which
    // breaks when the camera is orbited (middle mouse) or lags due to lerp.
    // Fix: use camera's actual world-space axes projected onto the surface tangent plane.
    // This matches GameLoop.ts SP (lines 233-251). See src/utils/aimAngle.ts for details.
    let aimAngle = Math.atan2(-mouseY, mouseX); // fallback if no player/camera data
    {
      const _aimPlayer = networkPlayers.get(localPlayerId);
      if (_aimPlayer) {
        camera.updateMatrixWorld();
        _aimCamRight.setFromMatrixColumn(camera.matrixWorld, 0);
        _aimCamUp.setFromMatrixColumn(camera.matrixWorld, 1);
        // s44c-08 FIX: Always use UV frame (surface.getPoint tangentU/V) for aimAngle.
        // The server's bullet physics interprets dirX/Y as UV-space components (tangentU=East,
        // tangentV=South on sphere). The server MeshWalker tangent frame is rotated 90° from
        // the UV frame on the sphere (MeshWalker tangent=North, UV tangentU=East), causing
        // a systematic 90° aim error. Using UV frame makes aimAngle consistent with server
        // bullet physics AND client bullet reconstruction (both use sp.tangentU/V).
        // The s44-epic-08 server-frame switch was the source of this 90° mismatch.
        {
          const _aimSp = surface.getPoint(_aimPlayer.surfaceU, _aimPlayer.surfaceV);
          // Use server normal when available (more stable), but UV tangentU/V for angle
          const _aimNormal = _localServerFrameValid ? _localServerNormal : _aimSp.normal;
          aimAngle = computeCameraRelativeAimAngle(
            mouseX, mouseY,
            _aimCamRight, _aimCamUp,
            _aimNormal, _aimSp.tangentU, _aimSp.tangentV,
          );
        }
      }
    }

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
        boost: inputState.boost,
        weaponSwap: inputState.weaponSwap,
        // Camera world-space axes (pre-allocated vectors, computed above from camera.matrixWorld)
        camRightX: _aimCamRight.x, camRightY: _aimCamRight.y, camRightZ: _aimCamRight.z,
        camUpX: _aimCamUp.x, camUpY: _aimCamUp.y, camUpZ: _aimCamUp.z,
      };

      const changed = !lastSentInput
        || currentInput.moveX !== lastSentInput.moveX
        || currentInput.moveY !== lastSentInput.moveY
        || Math.abs(currentInput.aimAngle - lastSentInput.aimAngle) > 0.02
        || currentInput.shooting !== lastSentInput.shooting
        || currentInput.bomb !== lastSentInput.bomb
        || currentInput.boost !== lastSentInput.boost
        || currentInput.weaponSwap;

      if (changed) {
        network.sendInput(currentInput);
        lastSentInput = { ...currentInput };
        lastInputSendTime = 0;
      }

      // Client-side prediction: apply local player movement AND aim immediately
      // so it feels responsive. The server position will override on next
      // onStateChange, but the visual lag between input and response is
      // eliminated. Uses the same PLAYER_SPEED (0.105 UV/s, updated S44b-09) as the server.
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
      // Tick local boost state for client-side prediction (mirrors server GameRoom.ts).
      const boostHeld = inputState.boost;
      const boostJustPressed = boostHeld && !localPrevBoostHeld;
      localPrevBoostHeld = boostHeld;
      if (boostJustPressed && localBoostCooldown <= 0) {
        localBoostActive = true;
        localBoostTimer = LOCAL_BOOST_DURATION;
        localBoostCooldown = LOCAL_BOOST_COOLDOWN;
      }
      if (localBoostActive) {
        localBoostTimer -= dt;
        if (localBoostTimer <= 0) {
          localBoostActive = false;
          localBoostTimer = 0;
        }
      }
      if (localBoostCooldown > 0) {
        localBoostCooldown -= dt;
        if (localBoostCooldown < 0) localBoostCooldown = 0;
      }

      const localPlayer = networkPlayers.get(localPlayerId);
      if (localPlayer && surface) {
        const isMoving = currentInput.moveX !== 0 || currentInput.moveY !== 0;

        if (isMoving) {
          const predSpeed = 0.105; // Must match server PLAYER_SPEED (updated S44b-09: 0.095→0.105)
          const predSpeedMultiplier = localBoostActive ? LOCAL_BOOST_SPEED_MULTIPLIER : 1.0;
          let predDx = currentInput.moveX * predSpeed * predSpeedMultiplier * dt;
          let predDy = currentInput.moveY * predSpeed * predSpeedMultiplier * dt;

          // Apply metric corrections for sphere-like and peanut surfaces (matches server)
          const surfType = lastCreatedSurfaceType;
          const isSphereLike = surfType === 'sphere' || surfType === 'sphere-tunnel'
            || surfType === 'icosahedron' || surfType === 'capsule';
          if (isSphereLike) {
            const phi = localPlayer.surfaceV * Math.PI;
            const sinPhi = Math.sin(phi);
            const clampedSinPhi = Math.max(sinPhi, 0.3);
            predDx = predDx / clampedSinPhi;
          } else if (surfType === 'peanut') {
            // Peanut: surface of revolution with r(phi) = R*(1 + waistDepth*cos(2*phi)).
            // Both U and V need metric corrections to maintain constant world-space speed.
            const PEANUT_WAIST_DEPTH = 0.4;
            const phi = localPlayer.surfaceV * Math.PI;
            const rNorm = 1 + PEANUT_WAIST_DEPTH * Math.cos(2 * phi);
            const drNorm = -2 * PEANUT_WAIST_DEPTH * Math.sin(2 * phi);
            const sinPhi = Math.sin(phi);
            predDx = predDx / Math.max(rNorm * sinPhi, 0.3);  // matches sphere clamp — prevents pole oscillation
            predDy = predDy / Math.max(Math.sqrt(rNorm * rNorm + drNorm * drNorm), 0.1);
          }
          // Torus: negate U-delta to match server-side fix (see GameRoom.ts + TorusSurface.ts).
          if (surfType === 'torus') {
            predDx = -predDx;
          }

          // Apply vFlip for sphere-like pole traversal (mirrors server GameRoom.ts logic)
          const isSphereLikePred = surfType === 'sphere' || surfType === 'sphere-tunnel'
            || surfType === 'icosahedron' || surfType === 'capsule';
          const effectiveDy = (isSphereLikePred || surfType === 'peanut')
            ? predDy * (localPlayerVFlip ? -1 : 1)
            : predDy;

          let newU = localPlayer.surfaceU + predDx;
          let newV = localPlayer.surfaceV + effectiveDy;

          // Wrap U, clamp/wrap V (matches server logic exactly).
          const wrapsInV = surfType === 'torus' || surfType === 'pipe'
            || surfType === 'mobius' || surfType === 'cube-ring'
            || surfType === 'cube-tunnel';
          newU = ((newU % 1) + 1) % 1;
          if (wrapsInV) {
            newV = ((newV % 1) + 1) % 1;
          } else if (isSphereLikePred || surfType === 'peanut') {
            // Pole traversal: reflect V through north/south pole (matches server).
            // vFlip toggles so forward direction continues past the pole.
            if (newV < 0) {
              newV = -newV;
              newU = ((newU + 0.5) % 1 + 1) % 1;
              localPlayerVFlip = !localPlayerVFlip;
            } else if (newV > 1) {
              newV = 2 - newV;
              newU = ((newU + 0.5) % 1 + 1) % 1;
              localPlayerVFlip = !localPlayerVFlip;
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
        //
        // s44j-16 FIX: Client-side prediction for responsive MP movement.
        // When MOVING: use client-predicted UV → world position (0-lag visual response).
        // When STATIONARY: use server authoritative world-space position.
        //
        // REGRESSION GUARD (s44h-08 lesson): getPoint() returns pre-scaled surface-local
        // coords (worldRotation=identity in MP; no updateSurfaceRotation() called).
        // Convert to world space: position * currentMapSizeScaleFactor (= applyMatrix4(group.matrixWorld)).
        // s44h-08 bug: used getPoint() output WITHOUT scaling → unit-sphere coords vs scaled server
        // positions → teleport snap at moving/stationary boundary. This implementation scales correctly.
        //
        // Compute surface point once from client-predicted UV; reuse in all branches.
        const _predSp = surface.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
        const _predTangentU = _predSp.tangentU.lengthSq() > 0.001 ? _predSp.tangentU : _predSp.tangentV;
        if (isMoving) {
          // 0-lag visual: client-predicted UV → scaled world position.
          // getPoint().position * mapSizeScaleFactor matches server wx/wy/wz scale.
          localPlayer.mesh.position.copy(_predSp.position).multiplyScalar(currentMapSizeScaleFactor);
          localPlayer.mesh.position.addScaledVector(_predSp.normal, 0.15);
          _netTempNormal.copy(_predSp.normal);
          // s44c-08 FIX preserved: UV frame tangentU for orientation (server tangent is 90° off on sphere).
          orientPlayerOnSurface(localPlayer, _netTempNormal, aimAngle, _predTangentU);
          _predictedPlayerVisualPos.copy(localPlayer.mesh.position);
          _predictedPlayerVisualNormal.copy(_netTempNormal);
          _predictedPlayerVisualValid = true;
        } else if (_localPlayerWorldTarget.valid) {
          // Stationary: use server authoritative world-space position.
          // s44g-05: server positions already in scaled world space, no extra multiply.
          const tgt = _localPlayerWorldTarget;
          _netTempPos.set(
            tgt.x + tgt.nx * 0.15,
            tgt.y + tgt.ny * 0.15,
            tgt.z + tgt.nz * 0.15,
          );
          localPlayer.mesh.position.copy(_netTempPos);
          _netTempNormal.set(tgt.nx, tgt.ny, tgt.nz);
          _netTempTangent.set(tgt.tx, tgt.ty, tgt.tz);
          // s44c-08 FIX: Use UV frame tangentU so player visual orientation matches
          // bullet direction (both now use UV frame). Server tangent (_netTempTangent)
          // is 90° off from UV tangentU on sphere.
          {
            const _orientTangentU = _predSp.tangentU.lengthSq() > 0.001
              ? _predSp.tangentU : _netTempTangent;
            orientPlayerOnSurface(localPlayer, _netTempNormal, aimAngle, _orientTangentU);
          }
          // Update predicted pos cache from server pos
          _predictedPlayerVisualPos.copy(_netTempPos);
          _predictedPlayerVisualNormal.copy(_netTempNormal);
          _predictedPlayerVisualValid = true;
        } else {
          // Fallback until first server world-space frame arrives.
          localPlayer.mesh.position.copy(_predSp.position).multiplyScalar(currentMapSizeScaleFactor);
          localPlayer.mesh.position.addScaledVector(_predSp.normal, 0.15);
          orientPlayerOnSurface(localPlayer, _predSp.normal, aimAngle, _predTangentU);
          _predictedPlayerVisualPos.copy(localPlayer.mesh.position);
          _predictedPlayerVisualNormal.copy(_predSp.normal);
          _predictedPlayerVisualValid = true;
        }

        // s44f-06 FIX: Apply slerp smoothing to local player orientation.
        // orientPlayerOnSurface (→ sharedOrientPlayerOnSurface) sets mesh.quaternion
        // directly with no smoothing, causing visible jitter from frame-to-frame
        // variation in tangent frame and aimAngle. SP uses Player.applySurfaceTransform
        // which has ROTATION_SMOOTHING=0.4 slerp — mirror that here.
        if (!_localPlayerQuatInitialized) {
          _localPlayerSmoothedQuat.copy(localPlayer.mesh.quaternion);
          _localPlayerQuatInitialized = true;
        } else {
          _localPlayerSmoothedQuat.slerp(localPlayer.mesh.quaternion, LOCAL_PLAYER_ROTATION_SMOOTHING);
        }
        localPlayer.mesh.quaternion.copy(_localPlayerSmoothedQuat);

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

    // Tesla coil: when not shooting, keep playerPositionRef live so the aura follows the player.
    // Without this, playerPositionRef holds a stale clone from the last shot → sphere freezes.
    if (!inputState.shooting && localPlayerWeaponType === WeaponType.TeslaCoil) {
      const _teslaLocalPlayer = networkPlayers.get(localPlayerId);
      if (_teslaLocalPlayer) {
        localWeaponManager.playerPositionRef = _teslaLocalPlayer.mesh.position;
      }
    }

    if (inputState.shooting && !localMenuOpen && network.isConnected()
        && SPECIAL_VISUAL_WEAPONS.has(localPlayerWeaponType)) {
      const localPlayer = networkPlayers.get(localPlayerId);
      if (localPlayer && surface) {
        // s44c-08 FIX: Use UV frame (sp.tangentU/V) for special weapon aim direction,
        // consistent with aimAngle which is now also in UV frame.
        let wpNormal: THREE.Vector3;
        let wpTangentU: THREE.Vector3;
        let wpTangentV: THREE.Vector3;
        {
          const sp = surface.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
          wpNormal   = _localServerFrameValid ? _localServerNormal : sp.normal;
          wpTangentU = sp.tangentU;
          wpTangentV = sp.tangentV;
        }
        // Use the already-computed mesh position (set from server world pos above)
        const origin = localPlayer.mesh.position.clone().addScaledVector(wpNormal, 0.05);
        const aimDir = new THREE.Vector3()
          .addScaledVector(wpTangentU, Math.cos(aimAngle))
          .addScaledVector(wpTangentV, Math.sin(aimAngle))
          .normalize();
        localWeaponManager.playerPositionRef = origin;
        localWeaponManager.fire(origin, aimDir, game.clock.totalTime, wpNormal);
      }
    }
    localWeaponManager.update(dt);

    // -- Update visual systems (same as co-op) --
    particles.update(dt);
    scorePopups.update(dt);
    screenShake.update(dt);
    shockwaveEffect.update(dt, game.clock.totalTime);
    // Visual-only ring update in MP (no damage callback — server is authoritative)
    plasmaExplosionEffect.update(dt, [], () => {});
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
      // auraPoint used by buffAura + companionManager below — keep it computed.
      // s44-epic-08: Use mesh position (set from server world pos) for auraPos
      // instead of auraPoint.position to avoid double UV→world conversion.
      const auraPoint = surface.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
      const auraPos = localPlayer.mesh.position; // already positioned from server world pos
      const auraNormal = _localServerFrameValid ? _localServerNormal : auraPoint.normal;
      playerLevel.update(dt, auraPos, auraNormal);

      // Tick buff proc effects (ShockAura arcs, Burning DOT visuals).
      // Server is authoritative for enemy HP; local damage from ShockAura is a visual-side
      // effect accepted here (same precedent as companion bullet hits in MP).
      const enemiesForBuff = Array.from(networkEnemies.values());
      buffManager.update(dt, localPlayer.mesh.position, enemiesForBuff, scorePopups);

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

      buffAuraRenderer.update(dt, game.clock.totalTime, localPlayer.mesh.position, auraNormal, activeBuffs);
      buffParticleAura.update(dt, game.clock.totalTime, localPlayer.mesh.position, auraNormal, activeBuffs);

      // Update companion + buff pickups, check collection
      if (getTransform) {
        // Compute player's analytical surface position for world-space pickup collision.
        // SP (GameLoop.ts) passes this to checkPlayerCollision() so it uses the 0.3 world-unit
        // radius instead of the UV fallback (0.01/scaleFactor). Without this, peanut (2x scale)
        // uses a UV threshold of 0.005 ≈ 0.11 world units — much too small to feel responsive.
        const playerAnalyticalPos = getTransform(localPlayer.surfaceU, localPlayer.surfaceV).position;

        for (let i = localCompanionPickups.length - 1; i >= 0; i--) {
          const cp = localCompanionPickups[i];
          if (!cp.active) {
            scene.remove(cp.mesh);
            cp.dispose();
            localCompanionPickups.splice(i, 1);
            continue;
          }
          cp.update(dt, game.clock.totalTime, camera.up);
          cp.applySurfaceTransform(getTransform);
          if (cp.checkPlayerCollision(localPlayer.surfaceU, localPlayer.surfaceV, playerAnalyticalPos)) {
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
          bp.update(dt, game.clock.totalTime, camera.up);
          bp.applySurfaceTransform(getTransform);
          if (bp.checkPlayerCollision(localPlayer.surfaceU, localPlayer.surfaceV, playerAnalyticalPos)) {
            buffManager.addBuff(bp.buffType);
            sound.play('weaponPickup', { volume: 0.4, pitch: 1.2 });
            bp.active = false;
          }
        }
      }

      // Update companions (orbit player, shoot enemies)
      if (getTransform) {
        // s44c-08 FIX: Use UV frame (auraPoint.tangentU/V) so companion aim direction
        // matches aimAngle (now in UV frame). auraPoint is already from surface.getPoint().
        const cmpTangentU = auraPoint.tangentU;
        const cmpTangentV = auraPoint.tangentV;
        const aimDir = new THREE.Vector3()
          .addScaledVector(cmpTangentU, Math.cos(aimAngle))
          .addScaledVector(cmpTangentV, Math.sin(aimAngle))
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
          auraNormal,
          getTransform,
        );
      }
      companionBulletPool.update(dt);

      // Companion bullet → enemy collision detection.
      // Companion bullets live only in the client-side companionBulletPool (never server-synced),
      // so we detect hits here and send a companion_hit message for server-authoritative damage.
      const COMPANION_HIT_RADIUS_SQ = 0.09; // 0.3 world units squared (matches SP CollisionSystem)
      companionBulletPool.forEachActive((bulletIdx, bulletPos) => {
        let bulletConsumed = false;
        networkEnemies.forEach((enemy, enemyId) => {
          if (bulletConsumed || !enemy.alive || !enemy.mesh) return;
          if (bulletPos.distanceToSquared(enemy.position) < COMPANION_HIT_RADIUS_SQ) {
            bulletConsumed = true;
            companionBulletPool.kill(bulletIdx);
            particles.bulletImpact(bulletPos);
            network.sendCompanionHit(enemyId);
          }
        });
      });

      companionHUD.update(companionManager.getCompanionCounts());
    }

    // Animate server-synced weapon pickups (spin, bob, spawn indicator).
    // Position is set by onStateChange (server-authoritative); animation runs here at fixed dt.
    if (getTransform && networkWeaponPickups.size > 0) {
      const transform = getTransform; // capture for closure (TS narrows out in forEach callback)
      networkWeaponPickups.forEach((pickup) => {
        if (!pickup.active) return;
        pickup.update(dt, game.clock.totalTime, camera.up);
        pickup.applySurfaceTransform(transform);
      });
    }

    // Animate server-synced buff pickups (Phase D).
    if (getTransform && networkBuffPickups.size > 0) {
      const transform = getTransform;
      networkBuffPickups.forEach((bp) => {
        bp.update(dt, game.clock.totalTime, camera.up);
        bp.applySurfaceTransform(transform);
      });
    }

    // Animate super pickups (pulse + bob along surface normal).
    if (getTransform && networkSuperPickups.size > 0) {
      const transform = getTransform;
      const totalTime = game.clock.totalTime;
      networkSuperPickups.forEach((visual) => {
        const { position, normal, tangent, bitangent } = transform(visual.surfaceU, visual.surfaceV);

        // Bob above surface
        const bob = Math.sin(totalTime * 3 + visual.spawnTime) * 0.08;
        visual.mesh.position.copy(position).addScaledVector(normal, 0.5 + bob);

        // Orient to surface + slow spin
        _spMat4.makeBasis(tangent, normal, bitangent);
        _spQSurface.setFromRotationMatrix(_spMat4);
        _spQSpin.setFromAxisAngle(_spSpinAxis, totalTime * 1.2);
        visual.mesh.quaternion.copy(_spQSurface).multiply(_spQSpin);

        // Pulse core scale
        const core = visual.mesh.getObjectByName('core');
        if (core) {
          const pulse = 1.0 + Math.sin(totalTime * 5) * 0.2;
          core.scale.setScalar(pulse);
        }

        // Track age factor for dimming
        visual.mesh.userData.ageFactor = 1.0;
        visual.mesh.userData.surfaceU = visual.surfaceU;
        visual.mesh.userData.surfaceV = visual.surfaceV;
      });
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

    // Update performance tracker for DebugOverlay (F4)
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
      // Format active buffs as compact string (mirrors SP PerformanceLogger format)
      const activeBuffsList = buffManager.getActiveBuffs();
      const activeBuffsStr = activeBuffsList.length > 0
        ? activeBuffsList.map(b => `${b.type}:${b.stacks}`).join(',')
        : undefined;
      const currentFps = Math.round(perfTracker.fps);
      const metrics: ClientMetricsPayload = {
        time: latestGameTime,
        fps: currentFps,
        frameTime: currentFps > 0 ? Math.round(1000 / currentFps * 100) / 100 : undefined,
        enemyCount: networkEnemies.size,
        bulletCount: bulletIdToIndex.size,
        score: localPlayerState?.score ?? 0,
        lives: localPlayerState?.lives ?? 0,
        waveNumber: latestWaveNumber,
        ddaLevel: Math.round(ddaLevel * 100) / 100,
        playerPowerLevel: playerLevel.level,
        activeWeapon: localPlayerWeaponType,
        kills: totalKillCounter.getTotalKills(),
        deaths: localPlayerDeaths,
        activeBuffs: activeBuffsStr,
        surfaceName: lastCreatedSurfaceType || undefined,
        gameMode: latestGameMode || undefined,
      };
      network.sendMetrics(metrics);
    }

    // -- Client-side game mode tick --
    if (activeGameMode && currentRoomPhase === 'playing' && !isPaused) {
      const ctx = buildGameModeContext();
      if (ctx) {
        if (!gameModeStarted) {
          activeGameMode.onStart(ctx);
          gameModeStarted = true;
        }
        activeGameMode.onFixedUpdate(dt, ctx);
      }
    }

    // Clear per-frame input
    input.endFrame();
  };

  game.onRender = () => {
    if (!surfaceReady || !surface || !getTransform) return;
    if (!surfaceConfirmedFromServer) return; // Wait for server-confirmed surface type before rendering entities

    // Actual render-frame delta for framerate-independent camera lerp.
    // Clamped to avoid huge jumps after tab-hide/unhide (same cap as netRenderDt).
    const _cameraRenderNow = performance.now();
    const _cameraRenderDt = Math.min((_cameraRenderNow - _lastCameraRenderTime) / 1000, 0.1);
    _lastCameraRenderTime = _cameraRenderNow;

    const surf = surface;
    const transform = getTransform;

    // Skip all entity interpolation and game-state rendering while paused.
    // The scene still renders (via Game.ts EffectComposer) so the pause
    // overlay looks correct, but entities freeze in place.
    if (isPaused) {
      // Still update camera (so orbit controls work in pause) and debug overlay
      const localPlayer = networkPlayers.get(localPlayerId);
      if (localPlayer) {
        // Use server's stable tangent frame when available (s44-epic-06).
        // Avoids UV-derived tangentV which can flip sign at poles, causing camera inversion.
        if (_localServerFrameValid) {
          cameraController.updateFromFrame(
            localPlayer.mesh.position,
            _localServerNormal,
            { tangent: _localServerTangent, bitangent: _localServerBitangent },
            _cameraRenderDt,
          );
        } else {
          const sp = surf.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
          const cameraPos = sp.position.clone().multiplyScalar(currentMapSizeScaleFactor);
          cameraController.updateFromFrame(
            cameraPos,
            sp.normal,
            { tangent: sp.tangentU, bitangent: sp.tangentV },
            _cameraRenderDt,
          );
        }
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

    // UV-distance surface dimming constants (SP parity — RenderLoop.ts SURFACE_* consts).
    // Dims enemies far from the local player on the surface. This handles flat/open
    // surfaces (e.g. cylinder, cube faces) where raycasts may count 0 intersections
    // for enemies on the far side, leaving them fully bright without UV-distance clamping.
    const NET_SURFACE_NEAR_UV  = 0.15;   // fully bright within 15% surface distance
    const NET_SURFACE_FAR_UV   = 0.45;   // fully dim beyond 45% surface distance
    const NET_SURFACE_DIM_OPC  = 0.08;   // minimum opacity for far-away enemies
    // World-space proximity override constants (SP parity — RenderLoop.ts PROXIMITY_*).
    const NET_PROXIMITY_NEAR_WORLD    = 2.0;
    const NET_PROXIMITY_NEAR_WORLD_SQ = NET_PROXIMITY_NEAR_WORLD * NET_PROXIMITY_NEAR_WORLD;
    const NET_PROXIMITY_FADE_WORLD    = 5.0;
    const NET_PROXIMITY_FADE_WORLD_SQ = NET_PROXIMITY_FADE_WORLD * NET_PROXIMITY_FADE_WORLD;

    const _lpForDim = networkPlayers.get(localPlayerId);
    const _lpU = _lpForDim?.surfaceU ?? 0;
    const _lpV = _lpForDim?.surfaceV ?? 0;
    const _netWrapsV = surf.wrapsV;

    depthOcclusion.update(enemyArray, camera.position, netRenderDt);
    for (const enemy of enemyArray) {
      if (!enemy.alive || !enemy.mesh) continue;
      let vis = depthOcclusion.getOpacity(enemy);

      // UV-distance surface dimming (LAN parity with SP RenderLoop.ts).
      // Catches flat/open-surface cases where raycasts register 0 intersections.
      if (_lpForDim) {
        const euRaw = Math.abs(enemy.surfacePosition.u - _lpU);
        const evRaw = Math.abs(enemy.surfacePosition.v - _lpV);
        const eu = Math.min(euRaw, 1.0 - euRaw);
        const ev = _netWrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw;
        const uvDist = Math.sqrt(eu * eu + ev * ev);
        let surfaceVis: number;
        if (uvDist <= NET_SURFACE_NEAR_UV) {
          surfaceVis = 1.0;
        } else if (uvDist >= NET_SURFACE_FAR_UV) {
          surfaceVis = NET_SURFACE_DIM_OPC;
        } else {
          const uvT = (uvDist - NET_SURFACE_NEAR_UV) / (NET_SURFACE_FAR_UV - NET_SURFACE_NEAR_UV);
          const uvSt = uvT * uvT * (3.0 - 2.0 * uvT);
          surfaceVis = 1.0 - uvSt * (1.0 - NET_SURFACE_DIM_OPC);
        }
        vis = Math.min(vis, surfaceVis);

        // World-space proximity override (SP parity — pole-distortion fix).
        // Near poles, UV distance is warped so UV-far enemies may be world-close.
        // World distance correctly identifies enemies that are physically adjacent.
        if (_lpForDim.mesh) {
          const oppositeWalls = surf.areOnOppositeWallSides(_lpV, enemy.surfacePosition.v);
          if (!oppositeWalls) {
            const worldDistSq = enemy.position.distanceToSquared(_lpForDim.mesh.position);
            if (worldDistSq <= NET_PROXIMITY_NEAR_WORLD_SQ) {
              vis = Math.max(vis, 1.0);
            } else if (worldDistSq <= NET_PROXIMITY_FADE_WORLD_SQ) {
              const worldDist = Math.sqrt(worldDistSq);
              const t = (worldDist - NET_PROXIMITY_NEAR_WORLD) / (NET_PROXIMITY_FADE_WORLD - NET_PROXIMITY_NEAR_WORLD);
              vis = Math.max(vis, 1.0 - t);
            }
          }
        }
      }

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
    //
    // s44-epic-06: When the server sends world-space position (wx/wy/wz + normal +
    // tangent), lerp the mesh position directly in world space — no getPoint() call.
    // This avoids UV→world conversion which can be unstable at poles.
    // UV is still lerped for HUD, DDA, minimap, and dimming calculations.
    // -----------------------------------------------------------------------
    const PLAYER_LERP = 0.2; // Slightly faster than enemies for responsiveness
    remotePlayerTargetUV.forEach((target, id) => {
      const player = networkPlayers.get(id);
      if (!player || id === localPlayerId) return;

      // Always lerp UV (used by HUD, DDA, dimming, minimap)
      const currentU = player.surfaceU;
      const currentV = player.surfaceV;
      const newU = currentU + (target.u - currentU) * PLAYER_LERP;
      const newV = currentV + (target.v - currentV) * PLAYER_LERP;
      player.surfaceU = newU;
      player.surfaceV = newV;

      // Update 3D position — use world-space target if available (s44-epic-06)
      const worldTarget = remotePlayerTargetWorldPos.get(id);
      if (worldTarget) {
        // Lerp directly toward server world position (no getPoint() needed)
        _netTempPos.set(
          // s44g-05: server positions already in scaled world space, no extra multiply
          worldTarget.x + worldTarget.nx * 0.15,
          worldTarget.y + worldTarget.ny * 0.15,
          worldTarget.z + worldTarget.nz * 0.15,
        );
        player.mesh.position.lerp(_netTempPos, PLAYER_LERP);
        _netTempNormal.set(worldTarget.nx, worldTarget.ny, worldTarget.nz);
        _netTempTangent.set(worldTarget.tx, worldTarget.ty, worldTarget.tz);
        orientPlayerOnSurface(player, _netTempNormal, target.aimAngle, _netTempTangent);
      } else {
        // Fallback: UV-based positioning (legacy server or before first world-pos arrives)
        const sp: SurfacePoint = surf.getPoint(newU, newV);
        player.mesh.position.copy(sp.position).multiplyScalar(currentMapSizeScaleFactor).addScaledVector(sp.normal, 0.15);
        orientPlayerOnSurface(player, sp.normal, target.aimAngle, sp.tangentU);
      }

      // Update glow trail with interpolated position
      const trail = playerGlowTrails.get(id);
      if (trail) trail.addPoint(player.mesh.position.clone());

      // Update ally glow position
      allyGlowManager.setPosition(id, player.mesh.position);
    });

    // -----------------------------------------------------------------------
    // Per-frame bullet rendering via client-side FaceWalker geodesics.
    // s41-01 fix: restored FaceWalker (s40-04) after s40-08 regression.
    //
    // Architecture: visual rendering (client) and hit detection (server) are separate:
    //   Visual: client uses FaceWalker.moveGeodesic() — true great-circle paths on all surfaces
    //   Hit detection: server uses Christoffel UV-based collision (unchanged, server-authoritative)
    //
    // Server sends b.surfaceU/V/dirX/dirY on each state patch (~20Hz) used for spawn init.
    // Client FaceWalker advances independently between patches for smooth geodesic rendering.
    // BulletInstanceManager provides GPU-instanced rendering.
    // Server fires 2 separate bullets for Standard (dual-barrel) and 5 for Spread.
    // Each server bullet renders as one visual bullet here.
    // -----------------------------------------------------------------------
    const BULLET_SPEED_WORLD = 4.0; // world units/sec — matches SP Bullet.ts speed
    const nowRenderMs = performance.now();
    // Use actual frame time so bullet speed is correct at any display refresh rate.
    const renderDt = lastRenderTimestampMs > 0
      ? Math.min((nowRenderMs - lastRenderTimestampMs) / 1000, 0.05)
      : lastFixedDt;
    lastRenderTimestampMs = nowRenderMs;

    bulletIdToIndex.forEach((idx, id) => {
      const b = bulletPool.getBulletData(idx);
      if (!b || !b.alive) return;

      const geoState = bulletGeodesicState.get(id);
      if (meshSurface && geoState) {
        // Advance bullet along geodesic (true great-circle path on any surface)
        const dist = BULLET_SPEED_WORLD * renderDt;
        const result = meshSurface.moveGeodesic(geoState.facePos, geoState.dirWorld, dist);
        geoState.facePos = result.facePosition;
        geoState.dirWorld.copy(result.direction);
        _netTempPos.copy(result.position).addScaledVector(result.normal, 0.02);
        _netTempDir.copy(result.direction);

        const weapType = bulletWeaponType.get(id) ?? WeaponType.Standard;

        // s44g-04: Skip server bullets for the local player whose weapon visuals are handled
        // by localWeaponManager (SPECIAL_VISUAL_WEAPONS). Without this skip, these weapons
        // render a plain Standard-looking flying capsule alongside the proper effect, making
        // all secondary weapons appear as "worse blaster" variants.
        // - GravityGun: purple gravity-well projectile handled by WeaponManager
        // - ChainLightning: instant arc effect — server bullet is a damage hitbox only
        // - TeslaCoil: area aura effect — server bullet is a damage hitbox only
        // Other players' special weapon bullets still render (no localWeaponManager for them).
        const bulletOwner = bulletOwnerIds.get(id);
        if (bulletOwner === localPlayerId && SPECIAL_VISUAL_WEAPONS.has(weapType)) return;

        const bulletVisual = weaponToBulletVisual(weapType);
        const weapColor = WEAPON_CONFIGS[weapType]?.color;
        const color = weapColor !== undefined ? _bulletTmpColor.setHex(weapColor) : undefined;

        // Server now fires 2 separate bullets for Standard (Blaster) and 5 for Spread,
        // so each server bullet renders as a single visual (no client-side dual-barrel trick).
        if (!bulletInstanceIds.has(id)) {
          bulletInstanceManager.addBullet(id, bulletVisual, _netTempPos, _netTempDir, color);
        } else {
          bulletInstanceManager.updateBullet(id, _netTempPos, _netTempDir);
        }
        bulletInstanceIds.add(id);
      } else {
        // Fallback: UV lerp (for bullets without geodesic state — should not normally occur)
        const target = bulletTargetUV.get(id);
        if (!target) return;

        const BULLET_LERP = 0.5;
        let du = target.u - b.surfaceU;
        if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
        const vWraps = lastCreatedSurfaceType === 'torus' || lastCreatedSurfaceType === 'pipe'
          || lastCreatedSurfaceType === 'mobius' || lastCreatedSurfaceType === 'cube-ring'
          || lastCreatedSurfaceType === 'cube-tunnel';
        let dv = target.v - b.surfaceV;
        if (vWraps) { if (dv > 0.5) dv -= 1; else if (dv < -0.5) dv += 1; }
        b.surfaceU = ((b.surfaceU + du * BULLET_LERP) % 1 + 1) % 1;
        b.surfaceV += dv * BULLET_LERP;
        if (vWraps) b.surfaceV = ((b.surfaceV % 1) + 1) % 1;

        const bpt = transform(b.surfaceU, b.surfaceV);
        _netTempPos.copy(bpt.position).addScaledVector(bpt.normal, 0.02);
        const bulletDirX = lastCreatedSurfaceType === 'torus' ? -target.dirX : target.dirX;
        _netTempDir.set(0, 0, 0)
          .addScaledVector(bpt.tangent, bulletDirX)
          .addScaledVector(bpt.bitangent, target.dirY)
          .normalize();

        const fallbackWeapType = bulletWeaponType.get(id) ?? WeaponType.Standard;
        // Skip server bullets for local player's SPECIAL_VISUAL_WEAPONS — their visuals are
        // handled by localWeaponManager. Other players' bullets still render (no localWeaponManager).
        const fallbackOwner = bulletOwnerIds.get(id);
        const skipFallback = fallbackOwner === localPlayerId && SPECIAL_VISUAL_WEAPONS.has(fallbackWeapType);
        if (!skipFallback) {
          if (!bulletInstanceIds.has(id)) {
            const bulletVisual = weaponToBulletVisual(fallbackWeapType);
            const weapColor = WEAPON_CONFIGS[fallbackWeapType]?.color;
            const color = weapColor !== undefined ? _bulletTmpColor.setHex(weapColor) : undefined;
            bulletInstanceManager.addBullet(id, bulletVisual, _netTempPos, _netTempDir, color);
            bulletInstanceIds.add(id);
          } else {
            bulletInstanceManager.updateBullet(id, _netTempPos, _netTempDir);
          }
        }
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

      if (!isLocalAlive) {
        // Spectating: find the first alive remote player to follow.
        // Use their world-space data if available; otherwise fall back to UV.
        let spectateId = '';
        networkPlayers.forEach((player, id) => {
          if (id !== localPlayerId && (playerAliveState.get(id) ?? true)) {
            spectateId = id;
          }
        });
        if (spectateId) {
          const spectateWorldPos = remotePlayerTargetWorldPos.get(spectateId);
          if (spectateWorldPos) {
            _netTempPos.set(
              // s44g-05: server positions already in scaled world space, no extra multiply
              spectateWorldPos.x + spectateWorldPos.nx * 0.15,
              spectateWorldPos.y + spectateWorldPos.ny * 0.15,
              spectateWorldPos.z + spectateWorldPos.nz * 0.15,
            );
            _netTempNormal.set(spectateWorldPos.nx, spectateWorldPos.ny, spectateWorldPos.nz);
            _netTempTangent.set(spectateWorldPos.tx, spectateWorldPos.ty, spectateWorldPos.tz);
            cameraController.updateFromFrame(
              _netTempPos,
              _netTempNormal,
              { tangent: _netTempTangent, bitangent: _netTempNormal }, // use normal as fallback bitangent
              _cameraRenderDt,
            );
          } else {
            const spectatePlayer = networkPlayers.get(spectateId)!;
            const sp = surf.getPoint(spectatePlayer.surfaceU, spectatePlayer.surfaceV);
            const cameraPos = sp.position.clone().multiplyScalar(currentMapSizeScaleFactor);
            cameraController.updateFromFrame(
              cameraPos, sp.normal, { tangent: sp.tangentU, bitangent: sp.tangentV }, _cameraRenderDt,
            );
          }
        }
      } else if (_localServerFrameValid) {
        // Normal case: follow local player with server's stable tangent frame (s44-epic-06).
        // Using _localServerBitangent avoids UV-derived tangentV which flips sign at poles.
        // s44i-01: Use server world-space position for camera target (via
        // _predictedPlayerVisualPos which now always holds server pos after s44h-08 revert).
        // Server tangent frame is still used for stability (no UV-pole flipping).
        if (_predictedPlayerVisualValid) {
          cameraController.updateFromFrame(
            _predictedPlayerVisualPos,
            _localServerNormal,
            { tangent: _localServerTangent, bitangent: _localServerBitangent },
            _cameraRenderDt,
          );
        } else if (_localPlayerWorldTarget.valid) {
          _netTempPos.set(
            // s44g-05: server positions already in scaled world space, no extra multiply
            _localPlayerWorldTarget.x + _localServerNormal.x * 0.15,
            _localPlayerWorldTarget.y + _localServerNormal.y * 0.15,
            _localPlayerWorldTarget.z + _localServerNormal.z * 0.15,
          );
          cameraController.updateFromFrame(
            _netTempPos,
            _localServerNormal,
            { tangent: _localServerTangent, bitangent: _localServerBitangent },
            _cameraRenderDt,
          );
        } else {
          cameraController.updateFromFrame(
            localPlayer.mesh.position,
            _localServerNormal,
            { tangent: _localServerTangent, bitangent: _localServerBitangent },
            _cameraRenderDt,
          );
        }
      } else {
        // Fallback: UV-based frame (legacy server or no server frame yet)
        const sp = surf.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);
        const cameraPos = sp.position.clone().multiplyScalar(currentMapSizeScaleFactor);
        cameraController.updateFromFrame(
          cameraPos,
          sp.normal,
          { tangent: sp.tangentU, bitangent: sp.tangentV },
          _cameraRenderDt,
        );
      }
    }

    // Apply surface projection for geoms and bullets (same as co-op)
    bulletPool.applySurfaceProjection(transform);
    geomPool.applySurfaceProjection(transform);

    // -----------------------------------------------------------------------
    // Pickup dimming (LAN parity with SP's RenderLoop.ts pickup_dimming).
    // Dims ALL pickup types on the far side of the surface so players know
    // they are not immediately reachable. Uses UV distance from local player
    // — same thresholds as single-player (NEAR=0.20, FAR=0.45, min=0.35).
    // The spawn-indicator ring is kept at full brightness.
    // Covers: networkWeaponPickups, networkBuffPickups, localCompanionPickups, localBuffPickups.
    // -----------------------------------------------------------------------
    {
      const lpPickup = networkPlayers.get(localPlayerId);
      const hasAnyPickup = networkWeaponPickups.size > 0 || networkBuffPickups.size > 0 || localCompanionPickups.length > 0 || localBuffPickups.length > 0;
      if (lpPickup && hasAnyPickup) {
        const PICKUP_NEAR_UV   = 0.20;
        const PICKUP_FAR_UV    = 0.45;
        const PICKUP_MIN_SCALE = 0.35;
        const puPlayerU = lpPickup.surfaceU;
        const puPlayerV = lpPickup.surfaceV;
        const puWrapsV  = surf.wrapsV;

        const computeDimFactor = (pickupU: number, pickupV: number): number => {
          const euRaw = Math.abs(pickupU - puPlayerU);
          const evRaw = Math.abs(pickupV - puPlayerV);
          const eu = Math.min(euRaw, 1.0 - euRaw);
          const ev = puWrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw;
          const uvDist = Math.sqrt(eu * eu + ev * ev);
          if (uvDist <= PICKUP_NEAR_UV) return 1.0;
          if (uvDist >= PICKUP_FAR_UV) return PICKUP_MIN_SCALE;
          const t = (uvDist - PICKUP_NEAR_UV) / (PICKUP_FAR_UV - PICKUP_NEAR_UV);
          const smooth = t * t * (3.0 - 2.0 * t);
          return 1.0 - smooth * (1.0 - PICKUP_MIN_SCALE);
        };

        const applyDimming = (mesh: THREE.Group, pickupU: number, pickupV: number): void => {
          const dimFactor = computeDimFactor(pickupU, pickupV);
          const ageFactor = (mesh.userData.ageFactor as number) ?? 1.0;
          mesh.traverse((child) => {
            if (child.name === 'spawn-indicator') return;
            if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
              const mat = child.material as THREE.MeshBasicMaterial;
              if ('opacity' in mat) {
                if (mat.userData.baseOpacity === undefined) {
                  mat.userData.baseOpacity = mat.opacity;
                }
                mat.opacity = (mat.userData.baseOpacity as number) * ageFactor * dimFactor;
              }
            } else if (child instanceof THREE.Sprite) {
              if (child.material.userData.baseOpacity !== undefined) {
                child.material.opacity = (child.material.userData.baseOpacity as number) * ageFactor * dimFactor;
              }
            }
          });
        };

        networkWeaponPickups.forEach((pickup) => applyDimming(pickup.mesh, pickup.surfaceU, pickup.surfaceV));
        networkSuperPickups.forEach((visual) => applyDimming(visual.mesh, visual.surfaceU, visual.surfaceV));
        networkBuffPickups.forEach((bp) => applyDimming(bp.mesh, bp.surfaceU, bp.surfaceV));
        for (const cp of localCompanionPickups) { if (cp.active) applyDimming(cp.mesh, cp.surfaceU, cp.surfaceV); }
        for (const bp of localBuffPickups)      { if (bp.active) applyDimming(bp.mesh, bp.surfaceU, bp.surfaceV); }
      }
    }

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
        const baseGridOpacity = (savedStyle?.gridOpacity ?? 0.10);
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

    // Update debug overlay HUD (throttled internally — no perf cost when F4 is hidden)
    debugOverlay.update();

    // -- Client-side game mode render tick --
    if (activeGameMode && gameModeStarted && currentRoomPhase === 'playing') {
      const ctx = buildGameModeContext();
      if (ctx) activeGameMode.onRender(_cameraRenderDt, ctx);
    }
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
        serverUrl: primaryUrl,
        pageOrigin: window.location.origin,
        crossOrigin: (() => { try { return new URL(primaryUrl.replace(/^ws/, 'http')).hostname !== window.location.hostname; } catch { return 'unknown'; } })(),
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
        superPickups: networkSuperPickups.size,
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
      const serverUrl = primaryUrl.replace('ws://', 'http://').replace('wss://', 'https://');
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
        // Don't show diagnostic overlay on mobile screens (max-width: 600px)
        if (window.innerWidth <= 600) {
          return;
        }

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
