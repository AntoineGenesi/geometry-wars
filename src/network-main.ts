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
import { InputManager } from './input/InputManager';
import { MeshSurface } from './surfaces/MeshSurface';
import { getSoundEngine } from './audio/SoundEngine';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { KillLog } from './ui/KillLog';
import { TotalKillCounter } from './ui/TotalKillCounter';
import { WeaponPickup } from './weapons/WeaponPickup';
import { WeaponType } from './weapons/WeaponTypes';
import { WeaponHUD } from './ui/WeaponHUD';
import type { WeaponInventoryEntry } from './weapons/WeaponManager';
import { AllyGlowManager } from './effects/AllyGlow';
import { ShockwaveEffect } from './effects/ShockwaveEffect';
import { EnemyInstanceManager } from './rendering/EnemyInstanceManager';
import { BulletInstanceManager, BulletVisualType } from './rendering/BulletInstanceManager';
import {
  NetworkClient,
  NetworkPlayerState,
  NetworkEnemyState,
  NetworkBulletState,
  NetworkGeomState,
  NetworkWeaponPickupState,
  NetworkGameState,
} from './network/NetworkClient';
import { PlayerNameLabels } from './ui/PlayerNameLabel';
import { Minimap } from './ui/Minimap';
import { DDAPerformanceTracker } from './difficulty/DDAPerformanceTracker';
import { DDADecisionEngine } from './difficulty/DDADecisionEngine';
import { DDASpawnModifier } from './difficulty/DDASpawnModifier';
import { loadDDASettings } from './difficulty/DDASettings';
import type { PlayerPosition } from './difficulty/DDASpawnModifier';

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
// Surface transform helper (same as co-op / single player)
// ---------------------------------------------------------------------------

function makeSurfaceTransformFn(surface: Surface) {
  return (u: number, v: number): {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  } => {
    const pt: SurfacePoint = surface.getPoint(u, v);
    return {
      position: pt.position,
      normal: pt.normal,
      tangent: pt.tangentU,
      bitangent: pt.tangentV,
    };
  };
}

// ---------------------------------------------------------------------------
// Orient player on surface (same function as co-op)
// ---------------------------------------------------------------------------

function orientPlayerOnSurface(
  player: Player,
  surfaceNormal: THREE.Vector3,
  aimAngle: number,
  tangentU: THREE.Vector3,
): void {
  const normal = surfaceNormal.clone().normalize();
  const forward = tangentU.clone().normalize();
  const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
  const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();
  const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
  player.mesh.quaternion.setFromRotationMatrix(rotMatrix);
  player.mesh.rotateOnAxis(new THREE.Vector3(0, 1, 0), aimAngle);
}

// ---------------------------------------------------------------------------
// Player colors (same as co-op)
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [0x00ffff, 0xff00ff, 0x00ff00, 0xffaa00];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
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

  // -- Game engine (same config as co-op) --
  const game = new Game({
    bloom: { strength: 1.0, radius: 0.4, threshold: 0.85 },
    cameraDistance: 15,
    cameraSmoothing: 0.05,
  });
  game.disableBuiltInCameraUpdate = true;

  const scene = game.scene;
  const camera = game.camera;

  // -- ShockwaveEffect: post-processing for enemy death distortion, chromatic aberration, flash --
  // Replaces the vignette pass in the EffectComposer with a combined pass (same as main.ts).
  const shockwaveEffect = new ShockwaveEffect();
  shockwaveEffect.setCamera(camera as THREE.PerspectiveCamera);
  if (game.composer) {
    const passes = game.composer.passes;
    // The vignette pass is a ShaderPass with 'offset' and 'darkness' uniforms.
    // Chain is: RenderPass -> BloomPass -> VignettePass -> OutputPass
    // We replace VignettePass with ShockwavePass (which also includes vignette).
    for (let i = passes.length - 1; i >= 0; i--) {
      const pass = passes[i];
      if ((pass as any).uniforms?.offset && (pass as any).uniforms?.darkness && !(pass as any).uniforms?.uShockCount) {
        passes.splice(i, 1, shockwaveEffect.shaderPass);
        break;
      }
    }
  }

  // Hide default single-player HUD (same as co-op)
  const defaultHUD = document.getElementById('game-hud');
  if (defaultHUD) defaultHUD.style.display = 'none';

  // -- Lighting (identical to co-op) --
  const ambient = new THREE.AmbientLight(0x404080, 0.6);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  scene.add(directional);
  const fillLight = new THREE.DirectionalLight(0x4488ff, 0.4);
  fillLight.position.set(-5, -5, -5);
  scene.add(fillLight);

  // -- Surface (created after connecting, using server's authoritative type) --
  let surface: Surface | null = null;
  let meshSurface: MeshSurface | null = null;
  let surfaceReady = false;
  let getTransform: ReturnType<typeof makeSurfaceTransformFn> | null = null;
  let lastCreatedSurfaceType: string = '';

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
    });
    networkEnemies.clear();
    enemyTargetUV.clear();
    remotePlayerTargetUV.clear();
    bulletTargetUV.clear();
    geomTargetUV.clear();
    surface = null;
    meshSurface = null;
    getTransform = null;
    enemySpawner = null;
    surfaceReady = false;
    lastCreatedSurfaceType = '';
  }

  function initSurface(serverSurfaceType: string, confirmedFromServer: boolean = false): void {
    // Allow re-initialization if the surface type differs from what was created,
    // OR if this is the first confirmed-from-server call and the previous init
    // was just a guess from connect-time (which may have had stale defaults).
    if (surfaceReady) {
      const currentType = isValidSurfaceType(serverSurfaceType) ? serverSurfaceType : null;
      if (!currentType) return; // Still no valid type, skip

      // If the type matches AND we already had a confirmed server type, skip
      if (lastCreatedSurfaceType === currentType && surfaceConfirmedFromServer) return;

      // If the type matches but was NOT confirmed from server, and this IS
      // a confirmed call, we can skip the rebuild but mark as confirmed.
      if (lastCreatedSurfaceType === currentType && confirmedFromServer) {
        surfaceConfirmedFromServer = true;
        return;
      }

      // Type differs - tear down and recreate
      if (lastCreatedSurfaceType !== currentType) {
        console.warn(`[NetworkMain] Surface type mismatch corrected: ${lastCreatedSurfaceType} → ${currentType}`);
        netMainLog(`[NetworkMain] Surface type changed: ${lastCreatedSurfaceType} -> ${currentType}, rebuilding`);
        cleanupSurface();
      } else {
        return; // Same type, not a confirmed upgrade, skip
      }
    }

    if (confirmedFromServer) {
      surfaceConfirmedFromServer = true;
    }

    const surfaceType: SurfaceType = isValidSurfaceType(serverSurfaceType)
      ? serverSurfaceType
      : getUrlSurfaceType();

    // Surface config matches co-op EXACTLY
    const surfaceConfig = {
      gridColor: 0x006666,
      surfaceColor: 0x0a0020,
      surfaceOpacity: 0.35,
      gridOpacity: 0.5,
      radius: 5,
      size: 5,
      height: 10,
      bevelRadius: 0.6,
      majorRadius: 4,
      minorRadius: 1.5,
      gridSegmentsU: 24,
      gridSegmentsV: 18,
    };
    surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);
    scene.add(surface.group);

    // Dark transparent surface material (matches co-op)
    surface.mesh.material = new THREE.MeshBasicMaterial({
      color: 0x0a0020,
      transparent: true,
      opacity: 0.35,
      side: THREE.FrontSide,
      depthWrite: true,
    });

    meshSurface = new MeshSurface(surface.mesh);
    bulletPool.setMeshSurface(meshSurface);

    getTransform = makeSurfaceTransformFn(surface);

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
    netMainLog(`[NetworkMain] Surface initialized: ${surfaceType}`);
  }

  // -- Camera constants (match co-op) --
  const CAMERA_DISTANCE = 20; // Was 15 — match single-player (main.ts passes cameraDistance: 20)
  const CAMERA_LERP = 0.12; // Was 0.08 — match CameraController.CAMERA_LERP_FACTOR (restored from bffc333)

  // -- Shared visual systems (same as co-op) --
  const bulletPool = new BulletPool();
  scene.add(bulletPool.root);

  // -- GPU instanced enemy rendering (reduces draw calls from ~2000 to ~15) --
  // Created before initSurface() so it can be wired into the enemySpawner.
  const enemyInstanceManager = new EnemyInstanceManager(scene);

  // -- GPU instanced bullet rendering (replaces flat line-based visuals) --
  const bulletInstanceManager = new BulletInstanceManager(scene, 200);
  // Track which bullet IDs have been registered with the instance manager
  const bulletInstanceIds = new Set<string>();
  // Hide the original line-based bullet visuals (BulletInstanceManager takes over)
  bulletPool.root.visible = false;

  const geomPool = new GeomPool();
  scene.add(geomPool.root);

  const particles = new ParticleSystem(5000);
  scene.add(particles.root);

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

  // -- Enemy tracking --
  // Maps server enemy ID -> real BaseEnemy instance (created via EnemySpawner)
  const networkEnemies = new Map<string, BaseEnemy>();

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

  // -- Local input --
  const input = new InputManager();

  // -- Network client --
  const network = new NetworkClient(getServerUrl());
  let localPlayerId = '';
  let isHost = false;
  let isPaused = false;
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
    if (network.isConnected()) {
      network.startGame();
      startBtn.style.display = 'none';
      statusEl.textContent = 'Starting...';
    } else {
      statusEl.textContent = 'Not connected to server!';
      statusEl.style.color = '#f44';
    }
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

  // Pause overlay (shown when game is paused)
  const pauseOverlay = document.createElement('div');
  pauseOverlay.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'background:rgba(0,0,0,0.6);z-index:200;' +
    'display:none;justify-content:center;align-items:center;' +
    'flex-direction:column;';
  const pauseTitle = document.createElement('div');
  pauseTitle.style.cssText =
    'color:#0ff;font:bold 48px monospace;text-shadow:0 0 20px #0ff;margin-bottom:20px;';
  pauseTitle.textContent = 'PAUSED';
  pauseOverlay.appendChild(pauseTitle);
  const pauseHint = document.createElement('div');
  pauseHint.style.cssText = 'color:#888;font:16px monospace;';
  pauseOverlay.appendChild(pauseHint);
  const resumeBtn = document.createElement('button');
  resumeBtn.textContent = 'RESUME';
  resumeBtn.style.cssText =
    'margin-top:20px;padding:12px 30px;font:bold 18px monospace;' +
    'background:#060;color:#0f0;border:2px solid #0f0;cursor:pointer;display:none;';
  resumeBtn.onclick = () => {
    if (isHost) {
      isPaused = false;
      network.sendPause(false);
      showPauseOverlay(false);
    }
  };
  pauseOverlay.appendChild(resumeBtn);

  // Stop Server button in pause menu (host only)
  const pauseStopServerBtn = document.createElement('button');
  pauseStopServerBtn.textContent = 'STOP SERVER';
  pauseStopServerBtn.style.cssText =
    'margin-top:10px;padding:12px 30px;font:bold 18px monospace;' +
    'background:#800;color:#fff;border:2px solid #f44;cursor:pointer;display:none;' +
    'text-shadow:0 0 5px #f44;';
  pauseStopServerBtn.onclick = async () => {
    // Same as top-right stop button: end game, stop server, return to menu
    network.sendEndGame();
    try {
      await fetch('/__lan/stop', { method: 'POST' });
    } catch {
      // Ignore — server may not be managed by this Vite instance
    }
    window.location.href = window.location.pathname;
  };
  pauseOverlay.appendChild(pauseStopServerBtn);

  document.body.appendChild(pauseOverlay);

  function showPauseOverlay(paused: boolean): void {
    isPaused = paused;
    if (paused) {
      pauseOverlay.style.display = 'flex';
      pauseHint.textContent = isHost ? 'Press ESC to resume' : 'Host has paused the game';
      resumeBtn.style.display = isHost ? 'block' : 'none';
      pauseStopServerBtn.style.display = isHost ? 'block' : 'none';
      game.pause(); // Sync game clock to prevent dt accumulation during pause
    } else {
      pauseOverlay.style.display = 'none';
      game.resume(); // Resync game clock to avoid massive dt spike on first frame after resume
    }
  }

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
  localMenuWarning.textContent = '⚠  Game continues — you can still be hit by enemies';
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

  // Escape key handler: open/close local player menu for ALL players.
  // Opening the menu does NOT pause the server — other players keep playing.
  // (Host can still pause the server via the existing server-pause overlay's
  //  Resume button, which sends sendPause(false) via the resumeBtn click.)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && network.isConnected()) {
      if (localMenuOpen) {
        // Close the local menu
        hideLocalMenu();
      } else if (!isPaused) {
        // Server is not paused — open local menu for this player
        // Re-check host status in case it changed since connect
        if (!isHost) {
          const serverHostId = network.getServerHostId();
          if (serverHostId && serverHostId === localPlayerId) {
            isHost = true;
            netMainLog('[NetworkMain] Host status confirmed on ESC press');
          }
        }
        showLocalMenu();
      } else if (isHost) {
        // Server is paused (by host) — host can resume with Escape
        isPaused = false;
        network.sendPause(false);
        showPauseOverlay(false);
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
    return enemy;
  }

  // -----------------------------------------------------------------------
  // State change callback: sync server state to local visual entities
  // -----------------------------------------------------------------------

  function onStateChange(state: NetworkGameState) {
    // Always try to init/update surface from authoritative server state.
    // This handles both initial creation AND correcting a wrong initial guess.
    if (state.surfaceType) {
      initSurface(state.surfaceType, true);
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
        player.mesh.position.copy(sp.position).addScaledVector(sp.normal, 0.15);
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
          scene.remove(player.mesh);
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
        shockwaveEffect.spawnShockwave(enemy.position, 0.05, 0.9, 0.5, 0.07);
        shockwaveEffect.triggerWhiteFlash(0.15);
        if (surface) surface.applyForce(enemy.position, 0.2, 1.0);
        sound.play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });

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
        }

        // Clean up: unregister from instance manager before removing from scene
        enemyInstanceManager.unregister(enemy);
        if (enemy.mesh) {
          scene.remove(enemy.mesh);
        }
        networkEnemies.delete(id);
        enemyTargetUV.delete(id);
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
        }
      }
    });

    // Remove bullets no longer in server state
    bulletIdToIndex.forEach((idx, id) => {
      if (!activeBulletIds.has(id)) {
        bulletPool.kill(idx);
        bulletIdToIndex.delete(id);
        bulletTargetUV.delete(id);
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
    }

    // Player list
    let playerList = '<b>Players:</b><br>';
    state.players.forEach((p: NetworkPlayerState) => {
      const you = p.id === localPlayerId ? ' (YOU)' : '';
      const status = p.alive ? '' : ' [DEAD]';
      playerList += `${p.name}${you}: ${p.score.toLocaleString()}${status}<br>`;
    });
    playersEl.innerHTML = playerList;

    // Sync pause state from server
    if (state.isPaused !== isPaused) {
      showPauseOverlay(state.isPaused);
    }

    // Game state
    if (state.gameStarted) {
      statusEl.textContent = state.isPaused ? 'PAUSED' : `Wave ${state.waveNumber}`;
      startBtn.style.display = 'none';
    } else if (state.gameOver) {
      statusEl.textContent = 'GAME OVER';
      startBtn.style.display = 'block';
      startBtn.textContent = 'PLAY AGAIN';
    } else {
      statusEl.textContent = 'Waiting for players...';
      startBtn.style.display = 'block';
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

  network.connect({
    name: playerName,
    surfaceType: urlSurfaceType,
  }).then(() => {
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

    statusEl.textContent = 'Connected! Waiting for game start...';
    startBtn.style.display = 'block';

    network.setCallbacks({
      onStateChange,
      onGameStart: () => {
        statusEl.textContent = 'Game starting...';
        startBtn.style.display = 'none';
        // Start background music (route through compressor to prevent clipping)
        const audioCtx = sound.getAudioContext();
        if (audioCtx) {
          const compressor = sound.getCompressor();
          bgMusic.start(audioCtx, compressor ?? undefined);
        }
      },
      onGameOver: () => {
        statusEl.textContent = 'GAME OVER';
        bgMusic.stop();
      },
      onError: (err) => {
        statusEl.textContent = `Error: ${err.message}`;
      },
      onHostLeft: () => {
        statusEl.textContent = 'Host disconnected';
        statusEl.style.color = '#f44';
        bgMusic.stop();
        backBtn.style.display = 'block';
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
        statusEl.textContent = 'Host ended the game';
        bgMusic.stop();
        backBtn.style.display = 'block';
      },
    });
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const isServerDown = msg.includes('Cannot reach') || msg.includes('ERR_EMPTY_RESPONSE')
      || msg.includes('ProgressEvent') || msg.includes('ECONNREFUSED');
    statusEl.textContent = isServerDown
      ? 'Server not responding. Is the game server running?'
      : `Connection failed: ${msg.slice(0, 80)}`;
    statusEl.style.color = '#f44';
    backBtn.style.display = 'block';

    // Show a retry button for transient failures (stale server, timing issue)
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'RETRY CONNECTION';
    retryBtn.style.cssText =
      'position:fixed;top:55%;left:50%;transform:translate(-50%,-50%);' +
      'padding:15px 30px;font:bold 18px monospace;background:#060;color:#0f0;' +
      'border:2px solid #0f0;cursor:pointer;z-index:100;';
    retryBtn.onclick = () => window.location.reload();
    document.body.appendChild(retryBtn);

    // Always log detailed error info for LAN debugging
    console.error('[NetworkMain] === CONNECTION FAILED ===');
    console.error(`[NetworkMain] Server URL: ${serverUrl}`);
    console.error(`[NetworkMain] Error: ${msg}`);
    console.error('[NetworkMain] --- TROUBLESHOOTING CHECKLIST ---');
    console.error('[NetworkMain] 1. Is the "Geometry Wars Server" window open and running?');
    const healthUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    console.error(`[NetworkMain] 2. Can you reach ${healthUrl}/health in a browser tab?`);
    console.error('[NetworkMain] 3. If connecting from another PC:');
    console.error('[NetworkMain]    - Use the HOST PC LAN IP (e.g. 192.168.x.x:3000), NOT localhost');
    console.error('[NetworkMain]    - Check Windows Firewall is allowing port 2567');
    console.error('[NetworkMain]    - Both PCs must be on the same WiFi/LAN');
    console.error('[NetworkMain] Full error:', err);
  });

  // -----------------------------------------------------------------------
  // Game loop (same structure as co-op)
  // -----------------------------------------------------------------------

  game.onFixedUpdate = (dt: number) => {
    if (!surfaceReady || !surface) return;
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
      // eliminated. Uses the same PLAYER_SPEED (0.19 UV/s) as the server.
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
          const predSpeed = 0.19; // Must match server PLAYER_SPEED
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
        localPlayer.mesh.position.copy(sp.position);
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

    // -- Update visual systems (same as co-op) --
    particles.update(dt);
    scorePopups.update(dt);
    screenShake.update(dt);
    shockwaveEffect.update(dt, game.clock.totalTime);
    surface.updateGrid(dt);
    killLog.update(dt);
    allyGlowManager.update(dt);

    // NOTE: We do NOT call enemySpawner.update() here. That method runs full
    // enemy AI (movement toward player, separation, spawn warnings) which is
    // wasted work because the server is authoritative and onStateChange
    // overrides all positions. On same-PC with two tabs, the CPU was running:
    // server game logic + tab 1 enemy AI + tab 2 enemy AI, all redundantly.
    // Spawn warnings are also unnecessary since network enemies appear instantly.

    // Update glow trails
    playerGlowTrails.forEach((trail) => trail.update(dt));

    // Update geom pool (magnetic pull animation toward local player)
    const localPlayer = networkPlayers.get(localPlayerId);
    if (localPlayer) {
      const pt = surface.worldToSurface(localPlayer.mesh.position);
      geomPool.update(dt, pt.u, pt.v, game.clock.totalTime);
    }

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

    // Clear per-frame input
    input.endFrame();
  };

  game.onRender = () => {
    if (!surfaceReady || !surface || !getTransform) return;
    if (!surfaceConfirmedFromServer) return; // Wait for server-confirmed surface type before rendering entities

    const surf = surface;
    const transform = getTransform;

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
    });

    // -----------------------------------------------------------------------
    // Update instanced enemy rendering (syncs world matrices from enemy.mesh positions).
    // enemySpawner.setInstanceManager() wires registration; updateInstances() flushes
    // transforms to the GPU. No LOD (LODManager not used in network mode).
    // -----------------------------------------------------------------------
    const enemyArray = Array.from(networkEnemies.values());
    enemyInstanceManager.updateInstances(enemyArray);
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
      player.mesh.position.copy(sp.position).addScaledVector(sp.normal, 0.15);
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

      // Update 3D position from interpolated UV
      const sp: SurfacePoint = surf.getPoint(b.surfaceU, b.surfaceV);
      _netTempPos.copy(sp.position).addScaledVector(sp.normal, 0.02);

      // Compute world-space direction from UV-space direction components
      _netTempDir.set(0, 0, 0)
        .addScaledVector(sp.tangentU, target.dirX)
        .addScaledVector(sp.tangentV, target.dirY)
        .normalize();

      // Register or update with BulletInstanceManager for GPU-instanced rendering.
      // All network bullets use Standard visual type (no weapon type in bullet state).
      if (!bulletInstanceIds.has(id)) {
        bulletInstanceManager.addBullet(id, BulletVisualType.Standard, _netTempPos, _netTempDir);
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

    // Camera follows local player along surface normal (same as co-op).
    // Use the player's mesh position directly instead of worldToSurface
    // round-trip, which adds jitter from floating-point imprecision.
    const localPlayer = networkPlayers.get(localPlayerId);
    if (localPlayer) {
      const sp = surf.getPoint(localPlayer.surfaceU, localPlayer.surfaceV);

      const targetCamPos = sp.position.clone().addScaledVector(sp.normal, CAMERA_DISTANCE);
      camera.position.lerp(targetCamPos, CAMERA_LERP);

      // lookAt FIRST, then lerp up-vector AFTER — matches bffc333 working pattern.
      // In Three.js, lookAt() uses camera.up to orient. Doing up.lerp() before lookAt()
      // causes the stale up to feed into lookAt(), amplifying jitter on curved surfaces.
      camera.lookAt(sp.position);
      const upTarget = sp.tangentV;
      camera.up.lerp(upTarget, CAMERA_LERP).normalize();
    }

    // Apply surface projection for geoms and bullets (same as co-op)
    bulletPool.applySurfaceProjection(transform);
    geomPool.applySurfaceProjection(transform);

    // Depth-based opacity DISABLED in network mode.
    // This was computing getVisibility() + setting material.opacity on EVERY enemy
    // mesh EVERY frame (250+ material updates/frame for 50 enemies with 5 children
    // each). Material property changes force GPU state flushes = massive FPS hit.
    // Co-op mode doesn't use depth opacity and feels smooth. Enemies behind the
    // surface are clipped by the depth buffer or frustum culled naturally.
    // See decisions/lan-deep-audit-2026-02-11.md #6.

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
