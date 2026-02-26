/**
 * Local Split-Screen Multiplayer Mode (2-4 players)
 *
 * Each player gets their own viewport with their own camera.
 * Configurable key bindings (saved to localStorage).
 * Player 1 uses mouse aim; others auto-aim in movement direction.
 *
 * URL params:
 *   ?mode=multiplayer&surface=sphere&players=3
 */

import * as THREE from 'three';

import { Game } from './core/Game';
import { Surface, SurfacePoint } from './surfaces/Surface';
import { SurfaceFactory, SurfaceType } from './surfaces/SurfaceFactory';
import { ConfigurableInput } from './input/ConfigurableInput';
import { Player } from './entities/Player';
import { BulletPool } from './entities/Bullet';
import { GeomPool } from './entities/Geom';
import { EnemySpawner } from './entities/enemies/EnemySpawner';
import { BaseEnemy } from './entities/enemies/BaseEnemy';
import { ParticleSystem } from './effects/ParticleSystem';
import { ScreenShake } from './effects/ScreenShake';
import { SurfaceShockwave } from './effects/SurfaceShockwave';
import { ScoreManager } from './core/ScoreManager';
import type { LevelDefinition } from './core/LevelData';
import { ADVENTURE_LEVELS } from './core/LevelData';
import { MeshSurface } from './surfaces/MeshSurface';
import { MeshWalker } from './movement/MeshWalker';
import { getSoundEngine } from './audio/SoundEngine';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { PauseMenu } from './ui/PauseMenu';
import { GameOverScreen } from './ui/GameOverScreen';
import { ControlsMenu } from './ui/ControlsMenu';
import { WeaponManager } from './weapons/WeaponManager';
import { WeaponType, WEAPON_CONFIGS } from './weapons/WeaponTypes';
import { WeaponPickup, getRandomWeaponType } from './weapons/WeaponPickup';
import { SuperStateManager, SuperStateType } from './weapons/SuperState';
import { SuperStatePickup } from './weapons/SuperStatePickup';
import { ScorePopupManager } from './effects/ScorePopup';
import { Gate } from './entities/enemies/Gate';
import { Virus } from './entities/enemies/Virus';
import { Painter } from './entities/enemies/Painter';
import { Spawner } from './entities/enemies/Spawner';
import { TitanGrunt } from './entities/enemies/TitanGrunt';
import { TitanSpinner } from './entities/enemies/TitanSpinner';
import { TitanWeaver } from './entities/enemies/TitanWeaver';
import { Boss } from './entities/enemies/Boss';
import { KillTracker } from './multiplayer/KillTracker';
import { AuraManager } from './multiplayer/AuraSystem';
import { SplitScreenRenderer } from './rendering/SplitScreenRenderer';
import { SplitScreenHUD, type PlayerHUDData } from './ui/SplitScreenHUD';
import { AllyGlowManager } from './effects/AllyGlow';
import { KillLog } from './ui/KillLog';
import { KillTally } from './ui/KillTally';
import { TotalKillCounter } from './ui/TotalKillCounter';
import { WeaponHUD } from './ui/WeaponHUD';
import { DDAPerformanceTracker } from './difficulty/DDAPerformanceTracker';
import { DDADecisionEngine } from './difficulty/DDADecisionEngine';
import { DDASpawnModifier } from './difficulty/DDASpawnModifier';
import { loadDDASettings } from './difficulty/DDASettings';
import { SettingsMenu, loadDebugSettings } from './ui/SettingsMenu';
import type { PlayerPosition } from './difficulty/DDASpawnModifier';
import { PerformanceTracker } from './core/PerformanceTracker';
import { PerformanceLogger } from './core/PerformanceLogger';
import { DebugOverlay } from './ui/DebugOverlay';
import { SplitScreenPerfOverlay } from './ui/SplitScreenPerfOverlay';
import { EnemyInstanceManager } from './rendering/EnemyInstanceManager';
import { BulletInstanceManager, BulletVisualType } from './rendering/BulletInstanceManager';
import { GlowTrail } from './effects/GlowTrail';
import { MapSize, getDefaultMapSizeForSurface, getMaxActiveEnemies, getMapSizeScaleFactor } from './core/MapSize';
import { WeaponMasteryManager } from './buffs/WeaponMasteryManager';
import { MasteryStore } from './systems/MasteryStore';
import { MasteryProgressScreen } from './ui/MasteryProgressScreen';
import { initI18n } from './i18n';

// ---------------------------------------------------------------------------
// URL Parameters
// ---------------------------------------------------------------------------

function getSurfaceTypeFromURL(): SurfaceType {
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  const validTypes = SurfaceFactory.getAvailableTypes();
  if (surfaceParam && validTypes.includes(surfaceParam as SurfaceType)) {
    return surfaceParam as SurfaceType;
  }
  return 'sphere';
}

function getPlayerCountFromURL(): 2 | 3 | 4 {
  const params = new URLSearchParams(window.location.search);
  const p = parseInt(params.get('players') ?? '2', 10);
  if (p === 3 || p === 4) return p;
  return 2;
}

function getMapSizeFromURL(surfaceType: SurfaceType): MapSize {
  const params = new URLSearchParams(window.location.search);
  const sizeParam = params.get('mapSize');
  const validSizes: MapSize[] = [MapSize.SMALL, MapSize.MEDIUM, MapSize.LARGE, MapSize.EPIC];
  if (sizeParam && validSizes.includes(sizeParam as MapSize)) {
    return sizeParam as MapSize;
  }
  return getDefaultMapSizeForSurface(surfaceType);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_MOVE_SPEED = 3.0;
const CAMERA_DISTANCE = 15;
const CAMERA_LERP = 0.08;

const PLAYER_COLORS = [0x00ffff, 0xff00ff, 0x00ff00, 0xffaa00];
const SPAWN_UVS: Array<[number, number]> = [
  [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75],
];

// ---------------------------------------------------------------------------
// Enemy colors for death effects
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
  snake: new THREE.Color(0x4488ff),
  repulsor: new THREE.Color(0xff4400),
  gravity_well: new THREE.Color(0x4488ff),
  gate: new THREE.Color(0xffffff),
  painter: new THREE.Color(0xff44aa),
  virus: new THREE.Color(0x88ff44),
  spawner: new THREE.Color(0x440066),
  titangrunt: new THREE.Color(0x2244cc),
  titanspinner: new THREE.Color(0xff22ff),
  titanweaver: new THREE.Color(0x22ff44),
  boss: new THREE.Color(0xffcc00),
};

// ---------------------------------------------------------------------------
// Weapon type -> bullet visual type mapping (for BulletInstanceManager)
// ---------------------------------------------------------------------------

function weaponToBulletVisual(weapon: WeaponType): BulletVisualType {
  switch (weapon) {
    case WeaponType.Spread: return BulletVisualType.Spread;
    case WeaponType.Piercing: return BulletVisualType.Piercing;
    case WeaponType.Homing: return BulletVisualType.Homing;
    default: return BulletVisualType.Standard;
  }
}

// Pre-allocated temp vector for bullet instance sync (zero per-frame allocation)
const _bulletSyncDir = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Surface transform helper (for enemies/geoms that still use UV)
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
// Orient player on surface
// ---------------------------------------------------------------------------

function orientPlayerOnSurface(
  player: Player,
  surfaceNormal: THREE.Vector3,
  faceDir: THREE.Vector3,
): void {
  const normal = surfaceNormal.clone().normalize();
  const forward = faceDir.clone();
  forward.sub(normal.clone().multiplyScalar(forward.dot(normal))).normalize();
  if (forward.lengthSq() < 0.001) return;
  const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
  const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();
  const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
  player.mesh.quaternion.setFromRotationMatrix(rotMatrix);
}

// ---------------------------------------------------------------------------
// Main multiplayer game
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await initI18n();
  const sound = getSoundEngine();
  sound.init();
  sound.resume();
  const bgMusic = new BackgroundMusic();

  const playerCount = getPlayerCountFromURL();
  const level: LevelDefinition = ADVENTURE_LEVELS[0];
  const surfaceType = getSurfaceTypeFromURL();

  // -- Game engine --
  const game = new Game({
    bloom: { strength: 1.0, radius: 0.4, threshold: 0.85 },
    cameraDistance: CAMERA_DISTANCE,
    cameraSmoothing: 0.05,
  });
  game.disableBuiltInCameraUpdate = true;
  game.disableBuiltInResize = true;  // Let SplitScreenRenderer handle resizing

  // Dismiss loading screen (normally dismissed by StartMenu, but when navigating
  // directly to ?mode=multiplayer the start menu is skipped so we must do it here)
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('fade-out');
    loadingScreen.addEventListener('transitionend', () => loadingScreen.remove());
  }

  // Hide default single-player HUD (it's in #ui-overlay, not #game-hud)
  const defaultHUD = document.getElementById('ui-overlay');
  if (defaultHUD) defaultHUD.style.display = 'none';

  // -- Lighting --
  const ambient = new THREE.AmbientLight(0x404080, 0.6);
  game.scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  game.scene.add(directional);
  const fillLight = new THREE.DirectionalLight(0x4488ff, 0.4);
  fillLight.position.set(-5, -5, -5);
  game.scene.add(fillLight);

  // -- Surface --
  const surfaceConfig = {
    gridColor: 0x006666,
    surfaceColor: 0x0a0020,
    surfaceOpacity: 0.35,
    gridOpacity: 0.5,
    radius: level.surfaceScale,
    size: level.surfaceScale,
    height: level.surfaceScale * 2,
    bevelRadius: 0.6,
    majorRadius: level.surfaceScale * 0.8,
    minorRadius: level.surfaceScale * 0.3,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
  };

  // Apply S37 size reduction for cube-tunnel (downsize for more claustrophobic gameplay)
  if (surfaceType === 'cube-tunnel') {
    surfaceConfig.size = 67;
    surfaceConfig.bevelRadius = 8.3;
  }

  const surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);
  game.scene.add(surface.group);

  surface.mesh.material = new THREE.MeshBasicMaterial({
    color: 0x0a0020,
    transparent: true,
    opacity: 0.35,
    side: THREE.FrontSide,
    depthWrite: true,
  });

  // -- MeshSurface (BVH) --
  const meshSurface = new MeshSurface(surface.mesh);

  // -- Input --
  const input = new ConfigurableInput(playerCount);

  // -- Split-screen renderer (with bloom!) --
  const splitRenderer = new SplitScreenRenderer(game.renderer, game.scene, game.isWebGPU);
  splitRenderer.setLayout(playerCount);
  splitRenderer.enableBloom({ strength: 1.0, radius: 0.4, threshold: 0.85 });

  // -- Per-player cameras --
  const cameras: THREE.PerspectiveCamera[] = [];
  for (let i = 0; i < playerCount; i++) {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 15, 25);
    cameras.push(cam);
    splitRenderer.setCamera(i, cam);
  }

  // -- Split-screen HUD --
  const hud = new SplitScreenHUD(playerCount);
  const killTally = new KillTally(playerCount);

  // -- Per-player weapon HUDs (declared here so updateViewportSizes can access them) --
  const weaponHUDs: WeaponHUD[] = [];

  // -- Performance tracking --
  const perfTracker = new PerformanceTracker(surfaceType);
  const perfLogger = new PerformanceLogger(surfaceType);
  const debugOverlay = new DebugOverlay(perfTracker);
  debugOverlay.setRendererBackend(game.backend);
  // Apply saved debug setting (hide if disabled; F4 still toggles it)
  const initialDebugSettings = loadDebugSettings();
  if (!initialDebugSettings.showDebugStatistics) {
    debugOverlay.hide();
  }

  // Wire the global debug change callback so the Settings toggle updates the overlay
  SettingsMenu.setGlobalDebugChangeCallback((debugSettings) => {
    if (debugSettings.showDebugStatistics) {
      debugOverlay.show();
    } else {
      debugOverlay.hide();
    }
  });

  // Small FPS overlay for Player 1's viewport (always visible)
  const perfOverlay = new SplitScreenPerfOverlay(perfTracker);

  // Initial viewport sizing
  function updateViewportSizes(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    splitRenderer.resize(w, h);
    for (let i = 0; i < playerCount; i++) {
      const pv = splitRenderer.getPixelViewport(i);
      // Convert WebGL viewport coords (y-up) to DOM coords (y-down) for all DOM elements.
      // WebGL y=0 is screen bottom; DOM y=0 is screen top.
      // DOM_y = totalHeight - webgl_y - viewport_height
      const domY = h - pv.y - pv.h;

      // HUD and KillTally are DOM elements, so they need DOM coordinates
      hud.setViewportBounds(i, pv.x, domY, pv.w, pv.h);
      killTally.setViewportBounds(i, pv.x, domY, pv.w, pv.h);

      // Input also uses DOM coordinates for mouse aim
      input.setViewportBounds(i, pv.x, domY, pv.w, pv.h);

      // Position weapon HUD near top-left of each viewport (DOM coords)
      if (weaponHUDs[i]) {
        // Weapon HUD uses fixed positioning, so it also needs DOM coordinates
        weaponHUDs[i].setPosition(pv.x + 8, domY + 50);
      }
    }
    // Position perf overlay in Player 1's viewport (DOM coords)
    const p1vp = splitRenderer.getPixelViewport(0);
    const p1domY = h - p1vp.y - p1vp.h;
    perfOverlay.setViewportBounds(p1vp.x, p1domY, p1vp.w, p1vp.h);
  }
  updateViewportSizes();
  window.addEventListener('resize', updateViewportSizes);

  // Set render override so Game uses split-screen
  game.renderOverride = () => splitRenderer.render();

  // -- Shared systems --
  const getTransform = makeSurfaceTransformFn(surface);
  const bulletPool = new BulletPool();
  bulletPool.setMeshSurface(meshSurface);
  game.scene.add(bulletPool.root);

  // -- GPU instanced bullet rendering (reduces draw calls from 1-per-bullet to 1-per-type) --
  const bulletInstanceManager = new BulletInstanceManager(game.scene, 400); // 400 for 4 players
  // Hide the original line-based bullet visuals since instanced rendering takes over
  bulletPool.root.visible = false;
  // Track which pool indices are registered with the instance manager
  const bulletInstanceIds = new Set<string>();

  const geomPool = new GeomPool();
  game.scene.add(geomPool.root);
  const particles = new ParticleSystem(5000);
  game.scene.add(particles.root);
  const scorePopups = new ScorePopupManager();
  game.scene.add(scorePopups.root);
  scorePopups.setCamera(game.camera);
  const screenShake = new ScreenShake();
  const surfaceShockwave = new SurfaceShockwave(surface);
  const scoreManager = new ScoreManager();
  const killTracker = new KillTracker();
  const killLog = new KillLog();
  const totalKillCounter = new TotalKillCounter();
  killLog.onKill = (type, color) => totalKillCounter.addKill(type, color);
  const auraManager = new AuraManager();
  auraManager.setMeshSurface(meshSurface);
  game.scene.add(auraManager.root);

  // -- Create players --
  const players: Player[] = [];
  const walkers: MeshWalker[] = [];
  const faceDirs: THREE.Vector3[] = [];
  const respawnTimers: number[] = [];
  const RESPAWN_DELAY = 1.5;

  // -- Ally glow manager (visible-through-surface indicators for other players) --
  const allyGlowManager = new AllyGlowManager(game.scene);

  for (let i = 0; i < playerCount; i++) {
    const player = new Player(bulletPool);
    const [su, sv] = SPAWN_UVS[i];
    player.respawn(su, sv);
    player.lives = 3;
    player.bombs = 3;

    // Color ALL players with their assigned color
    player.setColor(PLAYER_COLORS[i]);

    game.scene.add(player.mesh);
    players.push(player);

    // MeshWalker
    const startPt = surface.getPoint(su, sv);
    const walker = new MeshWalker(meshSurface, startPt.position, PLAYER_MOVE_SPEED);
    player.mesh.position.copy(walker.position);
    walkers.push(walker);

    faceDirs.push(new THREE.Vector3(0, 0, 1));
    respawnTimers.push(0);

    // Register with aura system
    auraManager.registerPlayer(i);
  }

  // Initialize cameras at correct position/orientation so matrixWorld is valid
  // from the first frame (needed for camera-relative mouse aim).
  for (let i = 0; i < playerCount; i++) {
    const walker = walkers[i];
    const cam = cameras[i];
    const camPos = walker.position.clone().addScaledVector(walker.normal, CAMERA_DISTANCE);
    cam.position.copy(camPos);
    cam.up.copy(walker.getTangentFrame().bitangent);
    cam.lookAt(walker.position);
    cam.updateMatrixWorld(true);
  }

  // Add ally glow to every player (each player's glow is visible to all viewports)
  for (let i = 0; i < playerCount; i++) {
    allyGlowManager.addGlow(i, PLAYER_COLORS[i], 0.9);
  }

  // -- Per-player glow trails (follow player movement, different color per player) --
  const glowTrails: GlowTrail[] = [];
  for (let i = 0; i < playerCount; i++) {
    const trail = new GlowTrail(new THREE.Color(PLAYER_COLORS[i]), 60, 0.4);
    game.scene.add(trail.root);
    glowTrails.push(trail);
  }

  scoreManager.setPlayer(players[0]);

  // Aura callbacks
  auraManager.onHeal = (playerId: number) => {
    const p = players[playerId];
    if (p && p.lives < 9) {
      p.lives++;
      scorePopups.spawn(p.mesh.position, '+HEAL', '#00ff88', 2.0);
      sound.play('geomPickup', { pitch: 1.4 });
    }
  };
  auraManager.onTierChange = (playerId: number, newTier: number) => {
    const p = players[playerId];
    if (p) {
      scorePopups.spawn(p.mesh.position, `AURA LV.${newTier}!`, '#ffff00', 2.2);
      sound.play('weaponPickup', { pitch: 0.8 + newTier * 0.1 });
    }
  };

  // -- Enemy spawner --
  const enemySpawner = new EnemySpawner(game.scene, getTransform);
  enemySpawner.setSurfaceSpeedScale(surface.speedScale);
  enemySpawner.setSurface(surface);
  enemySpawner.setMeshSurface(meshSurface);

  // -- GPU instanced rendering for enemies (reduces draw calls from ~2000 to ~15) --
  const enemyInstanceManager = new EnemyInstanceManager(game.scene);
  enemySpawner.setInstanceManager(enemyInstanceManager);

  // -- Dynamic Difficulty Adjustment (DDA) system --
  const ddaSettings = loadDDASettings();
  const ddaTrackers: DDAPerformanceTracker[] = [];
  for (let i = 0; i < playerCount; i++) {
    ddaTrackers.push(new DDAPerformanceTracker(i));
  }
  const ddaEngine = new DDADecisionEngine();
  ddaEngine.setEnabled(ddaSettings.enabled);
  const ddaSpawnModifier = new DDASpawnModifier(ddaEngine);
  enemySpawner.setDDAModifier(ddaSpawnModifier);
  // Pre-allocate player positions for DDA zone detection (one per player)
  const ddaPlayers: PlayerPosition[] = [];
  for (let i = 0; i < playerCount; i++) {
    ddaPlayers.push({ index: i, u: 0.5, v: 0.5 });
  }
  enemySpawner.setDDAPlayers(ddaPlayers);

  // -- Wire enemy type callbacks --
  Spawner.onSpawnEnemy = (u: number, v: number) => {
    enemySpawner.spawn('wanderer', u, v);
  };
  TitanGrunt.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const ou = (Math.random() - 0.5) * 0.06;
      const ov = (Math.random() - 0.5) * 0.06;
      enemySpawner.spawn('grunt', Math.max(0, Math.min(1, u + ou)), Math.max(0, Math.min(1, v + ov)));
    }
  };
  TitanSpinner.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const ou = (Math.random() - 0.5) * 0.06;
      const ov = (Math.random() - 0.5) * 0.06;
      enemySpawner.spawn('spinner', Math.max(0, Math.min(1, u + ou)), Math.max(0, Math.min(1, v + ov)));
    }
  };
  TitanWeaver.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const ou = (Math.random() - 0.5) * 0.06;
      const ov = (Math.random() - 0.5) * 0.06;
      enemySpawner.spawn('weaver', Math.max(0, Math.min(1, u + ou)), Math.max(0, Math.min(1, v + ov)));
    }
  };
  Boss.onShieldSpawn = (types: string[], count: number, u: number, v: number) => {
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const ou = (Math.random() - 0.5) * 0.3;
      const ov = (Math.random() - 0.5) * 0.3;
      enemySpawner.spawn(type as any, Math.max(0, Math.min(1, u + ou)), Math.max(0, Math.min(1, v + ov)));
    }
  };
  Virus.onInfectKill = (u: number, v: number) => {
    if (Math.random() < 0.2) {
      enemySpawner.spawn('virus', u, v);
    }
  };
  Gate.onDetonate = (position: THREE.Vector3, score: number) => {
    const blastRadius = 3.0;
    const gateColor = new THREE.Color(0xff8800);
    for (const enemy of enemySpawner.getEnemies()) {
      if (enemy.position.distanceTo(position) < blastRadius) {
        enemy.takeDamage(999);
        particles.enemyDeath(enemy.position, gateColor);
      }
    }
    scoreManager.awardKill(score, 'Gate');
    particles.enemyDeath(position, gateColor);
    screenShake.shake(0.4, 0.3);
    sound.play('bomb', { volume: 0.6, pitch: 1.2 });
    scorePopups.spawnScore(position, score, players[0].multiplier);
  };

  // -- Weapon pickups --
  const weaponPickups: WeaponPickup[] = [];
  const superPickups: SuperStatePickup[] = [];
  const SUPER_STATE_TYPES = [
    SuperStateType.QuadFire, SuperStateType.SplitFire,
    SuperStateType.ReverseFire, SuperStateType.Missile,
    SuperStateType.Magnet, SuperStateType.TrailBomb,
    SuperStateType.Shield,
  ];

  // -- Per-player weapon managers --
  const weaponManagers: WeaponManager[] = [];
  const superStateManagers: SuperStateManager[] = [];

  // -- Cross-game mastery (player 1 only — device-wide persistence) --
  const weaponMasteryP1 = new WeaponMasteryManager();
  const masteryStore = MasteryStore.load();
  /** Shared enemy death handler */
  function handleEnemyDeath(enemy: BaseEnemy, killerPlayerId: number, weaponType?: WeaponType): void {
    const enemyType = enemy.constructor.name.toLowerCase();
    const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xffffff);
    // Use lightweight death effect for AoE weapon kills to avoid screen-blocking
    if (weaponType === WeaponType.Homing || weaponType === WeaponType.PlasmaMortar) {
      particles.aoeDeath(enemy.position, color);
    } else {
      particles.enemyDeath(enemy.position, color);
    }
    screenShake.shake(0.15, 0.15);
    sound.play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });
    surface.applyForce(enemy.position, 0.2, 1.0);
    killLog.addKill(enemyType, color.getHex());

    const result = killTracker.processKill(enemy, killerPlayerId);
    if (killerPlayerId >= 0) {
      killTally.addKill(killerPlayerId, enemyType);
      // DDA: track kill event for the player who got the kill
      if (ddaTrackers[killerPlayerId]) {
        ddaTrackers[killerPlayerId].recordKill(enemy.scoreValue);
      }
      // Weapon analytics: record weapon kill for player 0 (primary telemetry player)
      if (killerPlayerId === 0 && weaponType) {
        perfLogger.recordWeaponKill(weaponType, '');
        weaponMasteryP1.recordKill(weaponType);
      }
    }
    const killerPlayer = players[killerPlayerId];
    if (killerPlayer) {
      scoreManager.setPlayer(killerPlayer);
      scoreManager.awardKill(enemy.scoreValue, enemy.constructor.name.toLowerCase());
      scorePopups.spawnScore(enemy.position, enemy.scoreValue, killerPlayer.multiplier);
    }

    for (const assistId of result.assistIds) {
      const assistPlayer = players[assistId];
      if (assistPlayer) {
        assistPlayer.addScore(result.assistScore);
        const offsetPos = enemy.position.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.3, (Math.random() - 0.5) * 0.3),
        );
        scorePopups.spawn(offsetPos, `+${result.assistScore} ASSIST`, '#44aaff', 1.8);
      }
    }

    const { u, v } = surface.worldToSurface(enemy.position);
    for (let g = 0; g < enemy.geomCount; g++) {
      geomPool.spawn(u, v);
    }

    if (Math.random() < 0.08) {
      const wpnType = getRandomWeaponType();
      const wpnPickup = new WeaponPickup(wpnType, u, v);
      game.scene.add(wpnPickup.mesh);
      weaponPickups.push(wpnPickup);
    }
    if (Math.random() < 0.05) {
      const ssType = SUPER_STATE_TYPES[Math.floor(Math.random() * SUPER_STATE_TYPES.length)];
      const ssPickup = new SuperStatePickup(ssType, u, v);
      game.scene.add(ssPickup.mesh);
      superPickups.push(ssPickup);
    }
  }

  function createWeaponManager(ownerId: number): WeaponManager {
    const wm = new WeaponManager();
    wm.setMeshSurface(meshSurface);
    game.scene.add(wm.getVisualRoot());
    wm.setCallbacks({
      getEnemies: () => {
        return enemySpawner.getEnemies()
          .filter(e => e.alive && e.mesh)
          .map((e, i) => ({ position: e.position.clone(), index: i, alive: e.alive }));
      },
      onEnemyDamage: (index: number, damage: number, weaponType: WeaponType) => {
        const aliveEnemies = enemySpawner.getEnemies().filter(e => e.alive && e.mesh);
        const enemy = aliveEnemies[index];
        if (!enemy) return;
        const auraBuff = auraManager.getBuffForPlayer(ownerId);
        const scorePower = scoreManager.getScorePowerMultiplier();
        const actualDamage = damage * auraBuff.damageMultiplier * scorePower;
        enemy.takeDamage(actualDamage, ownerId);
        if (enemy.alive) {
          scorePopups.spawnDamage(enemy.position, actualDamage);
        }
        if (enemy.alive && enemy.mesh) {
          enemy.mesh.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh && child.material) {
              const mat = child.material as THREE.MeshStandardMaterial;
              if (mat.emissive) {
                const origEmissive = mat.emissive.getHex();
                mat.emissive.setHex(0xffffff);
                mat.emissiveIntensity = 2.0;
                setTimeout(() => { mat.emissive.setHex(origEmissive); mat.emissiveIntensity = 0.5; }, 80);
              }
            }
          });
        }
        if (!enemy.alive) {
          handleEnemyDeath(enemy, ownerId, weaponType);
        }
      },
      spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => {
        const { u, v } = surface.worldToSurface(origin);
        const aimAngle = Math.atan2(direction.x, direction.z);
        bulletPool.spawn(origin, direction, u, v, aimAngle, ownerId);
      },
      onProjectileExplosion: (position: THREE.Vector3, wType: WeaponType) => {
        if (wType === WeaponType.Homing) {
          particles.homingExplosion(position);
          surface.applyForce(position, 0.1, 0.4);
          screenShake.shake(0.1, 0.1);
        } else if (wType === WeaponType.PlasmaMortar) {
          particles.mortarExplosion(position);
          surfaceShockwave.spawn(position, 3.0, 8.0, 0.4);
          screenShake.shake(0.5, 0.35);
          // Knock back enemies within blast radius
          const KNOCKBACK_RADIUS = 3.0;
          const KNOCKBACK_SPEED = 0.15;
          for (const enemy of enemySpawner.getEnemies()) {
            if (!enemy.alive) continue;
            const dx = enemy.position.x - position.x;
            const dz = enemy.position.z - position.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < KNOCKBACK_RADIUS * KNOCKBACK_RADIUS && distSq > 0.0001) {
              const dist = Math.sqrt(distSq);
              const strength = KNOCKBACK_SPEED * (1.0 - dist / KNOCKBACK_RADIUS);
              enemy.applyKnockback(dx / dist * strength, dz / dist * strength);
            }
          }
        }
      },
    });
    return wm;
  }

  for (let i = 0; i < playerCount; i++) {
    weaponManagers.push(createWeaponManager(i));
    superStateManagers.push(new SuperStateManager());
    weaponHUDs.push(new WeaponHUD());
  }

  // -- Player callbacks --
  for (let i = 0; i < playerCount; i++) {
    const player = players[i];
    const wm = weaponManagers[i];

    player.weaponFireHandler = (origin: THREE.Vector3, direction: THREE.Vector3) => {
      const gameTime = game.clock.totalTime;
      const fired = wm.fire(origin, direction, gameTime, walkers[i].normal);
      if (fired) {
        surface.applyForce(origin, 0.1, 0.3);
        sound.play('shoot', { pitch: 0.9 + Math.random() * 0.2 });
      }
    };

    player.onBomb = () => {
      const pos = player.mesh.position;
      surface.applyForce(pos, 0.5, 3.0);
      particles.bombExplosion(pos);
      screenShake.shake(0.3, 0.3);
      sound.play('bomb');

      for (const enemy of enemySpawner.getEnemies()) {
        if (enemy.active) {
          const enemyType = enemy.constructor.name.toLowerCase();
          const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xffffff);
          particles.enemyDeath(enemy.position, color);
          killLog.addKill(enemyType, color.getHex());
          killTally.addKill(i, enemyType);
          ddaTrackers[i].recordKill(enemy.scoreValue); // DDA: bomb kill
          const { u, v } = surface.worldToSurface(enemy.position);
          for (let g = 0; g < enemy.geomCount; g++) {
            geomPool.spawn(u, v);
          }
          enemy.die();
        }
      }
    };

    player.onDeath = (position: THREE.Vector3) => {
      particles.playerDeath(position);
      screenShake.shake(0.5, 0.4);
      // DDA: track death event for this player
      ddaTrackers[i].recordDeath();
    };
  }

  // -- Wave system --
  let waveTimer = 3;
  let waveCount = 0;

  // -- Pause & Game Over --
  let isPaused = false;
  let isGameOver = false;

  const pauseMenu = new PauseMenu();
  pauseMenu.setMusic(bgMusic);
  pauseMenu.setPerformanceLogger(perfLogger);
  pauseMenu.onResume(() => {
    isPaused = false;
    game.resume(); // resync clock to avoid massive dt after long pause
    // Force respawn for any players who died during pause
    for (let i = 0; i < playerCount; i++) {
      if (!players[i].alive && players[i].lives > 0) {
        respawnTimers[i] = RESPAWN_DELAY;
      }
    }
  });
  pauseMenu.onExit(() => {
    perfTracker.saveSession();
    perfLogger.saveSession();
    game.stop();
    bgMusic.stop();
    window.location.href = window.location.pathname;
  });

  /** Build current game data snapshot for pause menu stats panel (P1 weapon + total kills) */
  function updatePauseMenuData(): void {
    const wm = weaponManagers[0];
    const currentWeapon = wm ? wm.getCurrentWeapon() : WeaponType.Standard;
    const weaponConfig = WEAPON_CONFIGS[currentWeapon];

    // Gather aura buff data for all players
    const auraBuffs: Array<{
      name: string;
      stacks: number;
      description: string;
      currentValue: string;
      color: string;
    }> = [];

    for (let i = 0; i < playerCount; i++) {
      const tier = auraManager.getTier(i);
      if (tier > 0) {
        const buff = auraManager.getBuffForPlayer(i);
        const dmgBonus = ((buff.damageMultiplier - 1) * 100).toFixed(0);
        const healRate = buff.healRate.toFixed(1);
        const hasActiveBuff = buff.damageMultiplier > 1.0 || buff.healRate > 0;
        const valueStr = hasActiveBuff
          ? `+${dmgBonus}% dmg, ${healRate} HP/s`
          : 'No allies in range';

        auraBuffs.push({
          name: `P${i + 1} Aura`,
          stacks: tier,
          description: `Kill-streak aura (Tier ${tier})`,
          currentValue: valueStr,
          color: '#00ffff',
        });
      }
    }

    // P1's received aura buff (from allies' auras affecting P1)
    const p1Buff = auraManager.getBuffForPlayer(0);
    if (p1Buff.damageMultiplier > 1.0 || p1Buff.healRate > 0) {
      const dmgBonus = ((p1Buff.damageMultiplier - 1) * 100).toFixed(0);
      const healRate = p1Buff.healRate.toFixed(1);
      auraBuffs.push({
        name: 'Ally Aura Buff',
        stacks: 1,
        description: 'Buff received from nearby allies',
        currentValue: `+${dmgBonus}% damage, +${healRate} HP/s`,
        color: '#ff00ff',
      });
    }

    pauseMenu.setGameData({
      buffs: auraBuffs,
      totalKills: totalKillCounter.getTotalKills(),
      weapon: {
        name: weaponConfig.name,
        baseDamage: weaponConfig.damage,
        fireRate: weaponConfig.fireRate,
        effectiveDamage: p1Buff.damageMultiplier !== 1
          ? weaponConfig.damage * p1Buff.damageMultiplier
          : undefined,
      },
    });

    // Set performance summary for the pause menu stats panel
    pauseMenu.setPerformanceHTML(buildPerfSummaryHTML());
  }

  /** Build an HTML string summarizing current performance for the pause menu. */
  function buildPerfSummaryHTML(): string {
    const summary = perfTracker.getSummary();
    const loggerSummary = perfLogger.getSessionSummary();
    const spikes = perfLogger.getSpikeEvents();
    const qualityLevel = perfLogger.getDataPoints().length > 0
      ? perfLogger.getDataPoints()[perfLogger.getDataPoints().length - 1].qualityLevel
      : 'N/A';

    // Count spikes in the last 30 seconds
    const now = (Date.now() - (performance as any).__startTime) / 1000; // fallback
    const sessionElapsed = summary.durationSeconds;
    const recentSpikes = spikes.filter(s => s.time > sessionElapsed - 30).length;

    const fpsColor = (fps: number): string => {
      if (fps >= 55) return '#00ff88';
      if (fps >= 30) return '#ffaa00';
      return '#ff4444';
    };

    const formatDuration = (s: number): string => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${String(sec).padStart(2, '0')}`;
    };

    return `
      <div style="text-align:left;font-family:monospace;font-size:13px;color:#aaccff;line-height:1.6;">
        <div><span style="color:#668899;">Avg FPS:</span> <span style="color:${fpsColor(summary.avgFps)}">${summary.avgFps.toFixed(1)}</span></div>
        <div><span style="color:#668899;">Min/Max FPS:</span> <span style="color:${fpsColor(summary.minFps)}">${summary.minFps.toFixed(1)}</span> / <span style="color:${fpsColor(summary.maxFps)}">${summary.maxFps.toFixed(1)}</span></div>
        <div><span style="color:#668899;">Enemies:</span> <span style="color:#ff8844;">${enemySpawner.getActiveCount()}</span> (peak ${loggerSummary?.peakEnemies ?? 0})</div>
        <div><span style="color:#668899;">Bullets:</span> <span style="color:#44aaff;">${bulletPool.activeCount}</span> (peak ${loggerSummary?.peakBullets ?? 0})</div>
        <div><span style="color:#668899;">Quality:</span> <span style="color:#ccaa44;">${qualityLevel}</span></div>
        <div><span style="color:#668899;">Spikes (30s):</span> <span style="color:${recentSpikes > 5 ? '#ff4444' : recentSpikes > 0 ? '#ffaa00' : '#00ff88'};">${recentSpikes}</span></div>
        <div><span style="color:#668899;">Session:</span> ${formatDuration(summary.durationSeconds)}</div>
        <div><span style="color:#668899;">Players:</span> ${playerCount}</div>
      </div>
    `;
  }

  const gameOverScreen = new GameOverScreen();
  gameOverScreen.onContinue(() => {
    perfTracker.saveSession();
    perfLogger.saveSession();

    // Award XP to mastery store based on player 1's kills this game
    const killsByWeapon = weaponMasteryP1.getKillsByWeapon();
    const xpResults = masteryStore.awardGameXP(killsByWeapon);
    masteryStore.save();

    const anyXP = xpResults.some(r => r.xpAfter > r.xpBefore);
    if (anyXP) {
      const masteryScreen = new MasteryProgressScreen();
      masteryScreen.show(
        {
          results: xpResults,
          allLevels: masteryStore.getAllLevels(),
          getBonusDescription: (w, lv) => masteryStore.getBonusDescription(w, lv),
        },
        () => {
          masteryScreen.dispose();
          game.stop();
          bgMusic.stop();
          window.location.href = window.location.pathname;
        },
      );
    } else {
      game.stop();
      bgMusic.stop();
      window.location.href = window.location.pathname;
    }
  });

  // Controls menu (accessible via pause menu or C key)
  const controlsMenu = new ControlsMenu();
  controlsMenu.setInput(input);
  controlsMenu.onClose(() => {
    // Return to pause or game
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !isGameOver) {
      if (isPaused) {
        isPaused = false;
        game.resume(); // resync clock to avoid massive dt after long pause
        pauseMenu.hide();
      } else {
        isPaused = true;
        game.pause(); // stop clock ticking while paused
        updatePauseMenuData();
        pauseMenu.show();
      }
    }
  });

  // -- Auto-pause when tab is hidden (sync with Game.onVisibilityChange) --
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !isPaused && !isGameOver) {
      isPaused = true;
      game.pause(); // stop clock ticking while tab is hidden
      updatePauseMenuData();
      pauseMenu.show();
    }
  });

  // Pre-allocated Set for bullet instance sync (reused each frame, avoids per-frame allocation)
  const _seenBulletIds = new Set<string>();

  // -- Fixed update loop --
  game.onFixedUpdate = (dt: number) => {
    if (isPaused || isGameOver) return;

    // -----------------------------------------------------------------------
    // Game over check: all players out of lives
    // -----------------------------------------------------------------------
    const allDead = players.every(p => !p.alive && p.lives <= 0);
    if (allDead && !isGameOver) {
      isGameOver = true;
      bgMusic.stop();
      const totalScore = players.reduce((sum, p) => sum + p.score, 0);
      setTimeout(() => {
        gameOverScreen.show(totalScore, surfaceType);
      }, 1000);
      return;
    }

    // -----------------------------------------------------------------------
    // Per-player: respawn, input, movement, aim
    // -----------------------------------------------------------------------
    for (let i = 0; i < playerCount; i++) {
      const player = players[i];
      const walker = walkers[i];
      const pInput = input.getPlayerState(i);
      const bindings = input.getBindings(i);

      // Handle respawn
      if (!player.alive && player.lives > 0) {
        respawnTimers[i] += dt;
        if (respawnTimers[i] >= RESPAWN_DELAY) {
          respawnTimers[i] = 0;
          const [su, sv] = SPAWN_UVS[i];
          player.respawn(su, sv);
          const respawnPt = surface.getPoint(su, sv);
          const projected = meshSurface.closestPointOnSurface(respawnPt.position);
          if (projected) {
            // MUST use teleportTo() to reinit _facePos — direct assignment leaves stale
            // geodesic state that causes snap-back to death location on first movement input.
            // Same bug fixed in GameLoop.ts (SP path) in task s27g.
            walker.teleportTo(projected.point, projected.faceIndex, projected.normal);
          }
          player.mesh.position.copy(walker.position);
        }
        continue;
      }

      if (!player.alive) continue;

      // Weapon swap
      if (pInput.weaponSwap) {
        weaponManagers[i].cycleWeapon();
        sound.play('weaponPickup', { volume: 0.4, pitch: 1.2 });
      }

      // Movement (apply DDA speed multiplier if active)
      const ddaSpeed = ddaEngine.getSpeedMultiplier(i);
      const baseSpeed = walker.speed;
      walker.speed = baseSpeed * ddaSpeed;
      const moving = Math.abs(pInput.moveX) > 0.01 || Math.abs(pInput.moveY) > 0.01;
      if (moving) {
        const prevPos = walker.position.clone();
        walker.moveFromInput(pInput.moveX, -pInput.moveY, cameras[i], dt);

        // Track facing direction from movement delta (for auto-aim players)
        if (bindings.aimMode === 'movement') {
          const moveDelta = walker.position.clone().sub(prevPos);
          if (moveDelta.lengthSq() > 0.0001) {
            const dot = moveDelta.dot(walker.normal);
            const tangentDelta = moveDelta.sub(walker.normal.clone().multiplyScalar(dot));
            if (tangentDelta.lengthSq() > 0.0001) {
              faceDirs[i].copy(tangentDelta).normalize();
            }
          }
        }
      }
      player.mesh.position.copy(walker.position);
      walker.speed = baseSpeed; // Restore base speed after DDA-boosted movement

      // Bridge to UV
      const uv = surface.worldToSurface(walker.position);
      player.surfaceU = uv.u;
      player.surfaceV = uv.v;

      // Aim direction
      let aimDir: THREE.Vector3;
      const frame = walker.getTangentFrame();
      if (bindings.aimMode === 'mouse') {
        // Mouse aim using the camera's actual screen axes.
        // This correctly handles any camera orientation, viewport offset,
        // and aspect ratio — the camera's right/up vectors ARE screen right/up.
        const cam = cameras[i];
        const aimLen = Math.sqrt(pInput.aimX * pInput.aimX + pInput.aimY * pInput.aimY);
        if (aimLen > 0.1) {
          // Extract the camera's world-space right and up vectors
          const camRight = new THREE.Vector3();
          const camUp = new THREE.Vector3();
          cam.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());
          // Map screen-space aim to world space:
          //   aimX > 0 = screen right = camera right
          //   aimY > 0 = screen down  = -camera up
          const worldAim = new THREE.Vector3()
            .addScaledVector(camRight, pInput.aimX)
            .addScaledVector(camUp, -pInput.aimY);
          // Project onto the surface tangent plane so aiming stays on the surface
          const normalDot = worldAim.dot(walker.normal);
          worldAim.addScaledVector(walker.normal, -normalDot);
          if (worldAim.lengthSq() > 0.0001) {
            aimDir = worldAim.normalize();
          } else {
            aimDir = frame.bitangent.clone();
          }
        } else {
          aimDir = frame.bitangent.clone();
        }
      } else {
        // Auto-aim: face movement direction
        aimDir = faceDirs[i].clone();
      }

      orientPlayerOnSurface(player, walker.normal, aimDir);

      // Compute aim angle for bullets (relative to tangent frame)
      const aimTangentX = aimDir.dot(frame.tangent);
      const aimTangentY = -aimDir.dot(frame.bitangent);
      player.aimAngle = Math.atan2(aimTangentX, -aimTangentY);

      player.mesh.updateMatrixWorld(true);
      player.update(dt, {
        moveX: pInput.moveX,
        moveY: pInput.moveY,
        aimX: aimTangentX,
        aimY: aimTangentY,
        shooting: pInput.shooting,
        bomb: pInput.bomb,
        boost: false,
        weaponSwap: false,
      });

      // Add point to glow trail (player is alive at this point in the loop)
      glowTrails[i].addPoint(player.mesh.position.clone());
    }

    // Update all glow trails (fade out points, even for dead players)
    for (let i = 0; i < playerCount; i++) {
      glowTrails[i].update(dt);
    }

    // -----------------------------------------------------------------------
    // Per-player camera updates
    // -----------------------------------------------------------------------
    for (let i = 0; i < playerCount; i++) {
      const player = players[i];
      const walker = walkers[i];
      const cam = cameras[i];

      if (player.alive) {
        const targetCamPos = walker.position.clone().addScaledVector(walker.normal, CAMERA_DISTANCE);
        cam.position.lerp(targetCamPos, CAMERA_LERP);

        // Lerp up vector BEFORE lookAt so the resulting matrixWorld reflects
        // the current up direction (used by camera-relative mouse aim next frame).
        const upTarget = walker.getTangentFrame().bitangent;
        // Sign-flip protection: prevent 180° camera flip when crossing cube face edges.
        // Without this, the bitangent from the fallback in _updateTangentFrame can be
        // opposite to cam.up, causing the view to rotate 180° and invert controls.
        if (cam.up.dot(upTarget) < 0) {
          upTarget.negate();
        }
        cam.up.lerp(upTarget, CAMERA_LERP).normalize();

        cam.lookAt(walker.position);
      }
      // If dead, camera stays at last position
    }

    // -----------------------------------------------------------------------
    // Spawn enemy waves
    // -----------------------------------------------------------------------
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveTimer = 8;
      waveCount++;
      // Scale enemy count with player count
      const baseCount = Math.min(5 + waveCount * 2, 25);
      const enemyCount = Math.floor(baseCount * (1 + (playerCount - 1) * 0.3));

      const wave: Array<{ type: any; count: number }> = [
        { type: 'grunt', count: Math.floor(enemyCount * 0.3) },
        { type: 'wanderer', count: Math.floor(enemyCount * 0.2) },
      ];

      if (waveCount >= 2) wave.push({ type: 'mayfly', count: Math.floor(enemyCount * 0.2) });
      if (waveCount >= 3) wave.push({ type: 'duck', count: Math.max(2, Math.floor(enemyCount * 0.1)) });
      if (waveCount >= 4) wave.push({ type: 'rocket', count: Math.max(2, Math.floor(enemyCount * 0.1)) });
      if (waveCount >= 5) wave.push({ type: 'weaver', count: Math.max(2, Math.floor(enemyCount * 0.1)) });
      if (waveCount >= 7) wave.push({ type: 'spinner', count: Math.max(1, Math.floor(enemyCount * 0.08)) });
      if (waveCount >= 9) wave.push({ type: 'snake', count: 1 });
      if (waveCount >= 10) wave.push({ type: 'spawner', count: 1 });
      if (waveCount >= 12) wave.push({ type: 'titan_grunt', count: 1 });
      if (waveCount >= 15 && waveCount % 5 === 0) wave.push({ type: 'boss_sapphire', count: 1 });

      enemySpawner.spawnWave(wave);
    }

    // -----------------------------------------------------------------------
    // Update enemies (track average position of alive players)
    // -----------------------------------------------------------------------
    let trackU = 0.5;
    let trackV = 0.5;
    const alivePlayers = players.filter(p => p.alive);
    if (alivePlayers.length > 0) {
      trackU = alivePlayers.reduce((sum, p) => sum + p.surfaceU, 0) / alivePlayers.length;
      trackV = alivePlayers.reduce((sum, p) => sum + p.surfaceV, 0) / alivePlayers.length;
      // Average world position for mesh-walker enemies
      const avgWorldPos = new THREE.Vector3();
      const aliveIndices = players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0);
      for (const idx of aliveIndices) {
        avgWorldPos.add(walkers[idx].position);
      }
      avgWorldPos.divideScalar(aliveIndices.length);
      enemySpawner.setPlayerWorldPosition(avgWorldPos);
    }
    enemySpawner.update(dt, trackU, trackV);

    // -----------------------------------------------------------------------
    // Update shared systems
    // -----------------------------------------------------------------------
    bulletPool.update(dt);

    // Sync bullet positions to GPU-instanced rendering
    // Register new bullets, update existing, remove killed ones
    _seenBulletIds.clear();
    bulletPool.forEachActive((index: number, position: THREE.Vector3, data: any) => {
      const id = `b${index}`;
      _seenBulletIds.add(id);
      _bulletSyncDir.set(data.dirX, data.dirY, data.dirZ);
      if (!bulletInstanceIds.has(id)) {
        // New bullet: determine visual type from the owner's current weapon
        const ownerId = (data.ownerId as number) ?? 0;
        const wmIdx = Math.max(0, Math.min(ownerId, weaponManagers.length - 1));
        const wm = weaponManagers[wmIdx];
        const visualType = wm ? weaponToBulletVisual(wm.getCurrentWeapon()) : BulletVisualType.Standard;
        bulletInstanceManager.addBullet(id, visualType, position, _bulletSyncDir);
        bulletInstanceIds.add(id);
      } else {
        bulletInstanceManager.updateBullet(id, position, _bulletSyncDir);
      }
    });
    // Remove bullets that were killed this frame
    for (const id of bulletInstanceIds) {
      if (!_seenBulletIds.has(id)) {
        bulletInstanceManager.removeBullet(id);
        bulletInstanceIds.delete(id);
      }
    }
    // Flush instance transforms to GPU
    bulletInstanceManager.update();

    geomPool.update(dt, trackU, trackV, game.clock.totalTime);
    particles.update(dt);
    scorePopups.update(dt);
    screenShake.update(dt);
    killLog.update(dt);
    surface.updateGrid(dt);
    surface.updateMeshDeformation(dt);
    surfaceShockwave.update(dt);

    // Update aura system
    const walkerMap = new Map<number, MeshWalker>();
    const livesMap = new Map<number, number>();
    for (let i = 0; i < playerCount; i++) {
      if (players[i].alive) walkerMap.set(i, walkers[i]);
      livesMap.set(i, players[i].lives);
    }
    auraManager.update(dt, walkerMap, killTracker, livesMap);

    // Update ally glows (position + pulse animation)
    allyGlowManager.update(dt);
    for (let i = 0; i < playerCount; i++) {
      if (players[i].alive) {
        allyGlowManager.setPosition(i, players[i].mesh.position);
      }
    }

    // Update super state managers
    for (const ssm of superStateManagers) {
      ssm.update(dt);
    }

    // Update super state pickups
    for (let idx = superPickups.length - 1; idx >= 0; idx--) {
      const pickup = superPickups[idx];
      if (!pickup.active) {
        game.scene.remove(pickup.mesh);
        pickup.dispose();
        superPickups.splice(idx, 1);
        continue;
      }
      pickup.update(dt);
      pickup.applySurfaceTransform(getTransform);

      for (let i = 0; i < playerCount; i++) {
        const player = players[i];
        const ssm = superStateManagers[i];
        if (player.alive && pickup.active && pickup.checkPlayerCollision(player.surfaceU, player.surfaceV)) {
          const allDotsGone = pickup.removeClosestDot(player.surfaceU, player.surfaceV);
          if (allDotsGone) {
            ssm.activate(pickup.type);
            pickup.active = false;
            sound.play('weaponPickup');
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------

    const enemies = enemySpawner.getEnemies();

    // Bullet-enemy
    bulletPool.forEachActive((bulletIdx, bulletPos, bulletData) => {
      for (const enemy of enemies) {
        if (!enemy.active || !enemy.alive) continue;
        if (enemy.isMaterializing) continue; // GHOST FIX: can't shoot materializing enemies
        const dist = bulletPos.distanceTo(enemy.position);
        if (dist < enemy.radius + 0.15) {
          bulletPool.kill(bulletIdx);
          const auraBuff = auraManager.getBuffForPlayer(bulletData.ownerId);
          const scorePower = scoreManager.getScorePowerMultiplier();
          const damage = 1 * auraBuff.damageMultiplier * scorePower;
          enemy.takeDamage(damage, bulletData.ownerId);

          if (enemy.alive) {
            scorePopups.spawnDamage(bulletPos, damage);
          }

          particles.bulletImpact(bulletPos);
          surface.applyForce(bulletPos, 0.08, 0.3);

          if (enemy.alive && enemy.mesh) {
            enemy.mesh.traverse((child: THREE.Object3D) => {
              if (child instanceof THREE.Mesh && child.material) {
                const mat = child.material as THREE.MeshStandardMaterial;
                if (mat.emissive) {
                  const origEmissive = mat.emissive.getHex();
                  mat.emissive.setHex(0xffffff);
                  mat.emissiveIntensity = 2.0;
                  setTimeout(() => { mat.emissive.setHex(origEmissive); mat.emissiveIntensity = 0.5; }, 80);
                }
              }
            });
          }

          if (!enemy.alive) {
            handleEnemyDeath(enemy, bulletData.ownerId);
          }
          break;
        }
      }
    });

    // Player-enemy (all players)
    const allEnemies = enemySpawner.getEnemies();
    for (let i = 0; i < playerCount; i++) {
      const player = players[i];
      const ssm = superStateManagers[i];
      if (!player.canTakeDamage) continue;
      const mods = ssm.getFireModifiers();
      if (mods.isShielded) continue;
      for (const enemy of allEnemies) {
        if (!enemy.active || !enemy.alive) continue;
        if (enemy.isMaterializing) continue; // GHOST FIX: materializing enemies can't harm player
        const dist = player.mesh.position.distanceTo(enemy.position);
        if (dist < player.mesh.scale.x * 0.3 + enemy.radius) {
          player.die();
          particles.playerDeath(player.mesh.position);
          screenShake.shake(0.5, 0.4);
          sound.play('playerDeath');
          break;
        }
      }
    }

    // Geom pickups (all players)
    for (const player of players) {
      if (!player.alive) continue;
      geomPool.forEachActive((index, _su, _sv, position) => {
        const dist = player.mesh.position.distanceTo(position);
        if (dist < 0.3) {
          geomPool.kill(index);
          scoreManager.collectGeom();
          sound.play('geomPickup', { pitch: 0.9 + Math.random() * 0.2 });
        }
      });
    }

    // Update weapon managers
    for (const wm of weaponManagers) {
      wm.update(dt);
    }

    // Update weapon pickups
    for (let idx = weaponPickups.length - 1; idx >= 0; idx--) {
      const wp = weaponPickups[idx];
      if (!wp.active) {
        game.scene.remove(wp.mesh);
        wp.dispose();
        weaponPickups.splice(idx, 1);
        continue;
      }
      wp.update(dt, game.clock.totalTime);
      wp.applySurfaceTransform(getTransform);

      for (let i = 0; i < playerCount; i++) {
        const player = players[i];
        const wm = weaponManagers[i];
        if (player.alive && wp.active && wp.checkPlayerCollision(player.surfaceU, player.surfaceV)) {
          wm.equipWeapon(wp.type);
          sound.play('weaponPickup');
          wp.active = false;
        }
      }
    }

    // -----------------------------------------------------------------------
    // DDA system update (after all kills/deaths processed this frame)
    // -----------------------------------------------------------------------
    {
      const enemies = enemySpawner.getEnemies();
      for (let i = 0; i < playerCount; i++) {
        const player = players[i];
        if (!player.alive) continue;

        // Compute nearest enemy distance in UV space for this player
        let nearestEnemyDist = 1.0;
        for (const enemy of enemies) {
          if (!enemy.active || enemy.isMaterializing) continue;
          const du = player.surfaceU - enemy.surfacePosition.u;
          const dv = player.surfaceV - enemy.surfacePosition.v;
          const dist = Math.sqrt(du * du + dv * dv);
          if (dist < nearestEnemyDist) nearestEnemyDist = dist;
        }

        // Update tracker with per-player metrics
        ddaTrackers[i].update(dt, nearestEnemyDist, player.lives / 3);

        // Sync player position for DDA zone detection
        ddaPlayers[i].u = player.surfaceU;
        ddaPlayers[i].v = player.surfaceV;
      }
      // Update engine with all trackers (percentile ranking for multiplayer)
      ddaEngine.update(dt, ddaTrackers);
    }

    // Scale music intensity
    bgMusic.setIntensity(Math.min(enemySpawner.getActiveCount() / 30, 1.0));

    // Clear input flags
    input.endFrame();
  };

  // -- Pre-allocated map for perf enemy type tracking (zero-alloc per frame) --
  const perfEnemyTypeMap = new Map<string, number>();
  let perfEnemyTypeFrameCounter = 0;
  let lastRenderTime = performance.now();

  // -- Render callback --
  game.onRender = (_alpha: number) => {
    bulletPool.applySurfaceProjection(getTransform);
    geomPool.applySurfaceProjection(getTransform);

    if (screenShake.offset.lengthSq() > 0.0001) {
      for (const cam of cameras) {
        cam.position.add(screenShake.offset);
      }
    }

    // -- Performance tracking (per-frame) --
    const now = performance.now();
    const rawFrameDt = (now - lastRenderTime) / 1000;
    const frameDt = Math.min(rawFrameDt, 0.1); // clamped for non-perf uses
    lastRenderTime = now;
    perfTracker.setEntityCount(enemySpawner.getActiveCount());
    perfTracker.setBulletCount(bulletPool.activeCount);
    perfTracker.recordFrame(rawFrameDt);

    // Feed data to the performance logger
    perfLogger.setFrameData(perfTracker.fps, enemySpawner.getActiveCount(), bulletPool.activeCount);
    const renderInfo = game.renderer.info;
    perfLogger.setRendererStats(
      renderInfo.render.calls,
      renderInfo.render.triangles,
      (renderInfo.memory.geometries + renderInfo.memory.textures) * 0.01,
    );
    perfLogger.setDDALevel(ddaEngine.getDDALevelSmooth(0));
    perfLogger.setQualityLevel('N/A'); // Split-screen doesn't use AdaptiveQuality yet

    // Update enemy type breakdown every 30 frames (~2Hz at 60fps)
    perfEnemyTypeFrameCounter++;
    if (perfEnemyTypeFrameCounter >= 30) {
      perfEnemyTypeFrameCounter = 0;
      perfEnemyTypeMap.clear();
      for (const enemy of enemySpawner.getEnemies()) {
        if (!enemy.active) continue;
        const t = (enemy.baseTypeName || 'unknown');
        perfEnemyTypeMap.set(t, (perfEnemyTypeMap.get(t) ?? 0) + 1);
      }
      perfTracker.setEnemyTypes(perfEnemyTypeMap as Map<any, number>);
      perfLogger.setEnemyTypes(perfEnemyTypeMap as Map<any, number>);
    }
    perfLogger.recordFrame(rawFrameDt);

    // Dynamic particle budget scaling based on active entity count
    // Reduces particle emission when many entities are on screen to maintain FPS
    const activeEnemyCount = enemySpawner.getActiveCount();
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

    // Update overlays
    debugOverlay.setMemoryInfo(
      game.renderer.info.memory.geometries,
      game.renderer.info.memory.textures,
    );
    debugOverlay.update();
    perfOverlay.update();
  };

  // -- Per-viewport pre-render: surface UV-distance opacity --
  // Uses UV-space distance from the active player to each enemy so that enemies far
  // away on the surface are dimmed regardless of 3D Euclidean proximity.
  // This correctly handles torus/cube-ring/sphere-tunnel surfaces where raycasts
  // pass through holes and the dot-product approx-normal approach breaks.
  const _mpSurfaceNearUV = 0.15;
  const _mpSurfaceFarUV  = 0.45;
  const _mpSurfaceDimOp  = 0.08;
  const _mpWrapsV = surface.wrapsV;
  splitRenderer.preRender = (playerIndex: number, _camera: THREE.PerspectiveCamera) => {
    const activePlayer = players[playerIndex];
    const playerU = activePlayer.surfaceU;
    const playerV = activePlayer.surfaceV;
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.alive || !enemy.mesh) continue;
      const euRaw = Math.abs(enemy.surfacePosition.u - playerU);
      const evRaw = Math.abs(enemy.surfacePosition.v - playerV);
      const eu = Math.min(euRaw, 1.0 - euRaw);
      const ev = _mpWrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw;
      const uvDist = Math.sqrt(eu * eu + ev * ev);
      let visibility: number;
      if (uvDist <= _mpSurfaceNearUV) {
        visibility = 1.0;
      } else if (uvDist >= _mpSurfaceFarUV) {
        visibility = _mpSurfaceDimOp;
      } else {
        const uvT = (uvDist - _mpSurfaceNearUV) / (_mpSurfaceFarUV - _mpSurfaceNearUV);
        const uvSt = uvT * uvT * (3.0 - 2.0 * uvT);
        visibility = 1.0 - uvSt * (1.0 - _mpSurfaceDimOp);
      }
      enemy.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshBasicMaterial;
          if (mat.transparent !== undefined) {
            mat.transparent = true;
            mat.opacity = visibility;
          }
        }
      });
    }

    // Update per-viewport HUD
    const player = players[playerIndex];
    const wm = weaponManagers[playerIndex];
    const stats = killTracker.getPlayerStats(playerIndex);
    const currentWeapon = wm.getCurrentWeapon();

    // Calculate total kills across all players
    let totalKills = 0;
    for (let i = 0; i < players.length; i++) {
      totalKills += killTracker.getPlayerStats(i).kills;
    }

    hud.update(playerIndex, {
      score: player.score,
      multiplier: player.multiplier,
      lives: player.lives,
      bombs: player.bombs,
      weaponName: currentWeapon === WeaponType.Standard ? 'Standard' : WEAPON_CONFIGS[currentWeapon].name,
      ammo: currentWeapon === WeaponType.Standard ? -1 : wm.getCurrentAmmo(),
      kills: stats.kills,
      assists: stats.assists,
      totalKills,
    });

    // Update per-player weapon inventory HUD
    const whud = weaponHUDs[playerIndex];
    if (whud) {
      whud.update(wm.getInventory(), wm.getCurrentWeapon());
    }
  };

  // -- Start background music (route through compressor to prevent clipping) --
  const audioCtx = sound.getAudioContext();
  if (audioCtx) {
    const compressor = sound.getCompressor();
    bgMusic.start(audioCtx, compressor ?? undefined);
  }

  // -- Start --
  game.start();

  const bindingsInfo = [];
  for (let i = 0; i < playerCount; i++) {
    const b = input.getBindings(i);
    const aimStr = b.aimMode === 'mouse' ? 'Mouse aim' : 'Auto-aim';
    bindingsInfo.push(`P${i + 1}: ${b.up}/${b.left}/${b.down}/${b.right} + ${aimStr} + ${b.shoot} shoot + ${b.bomb} bomb`);
  }
  console.log(`[Local Co-Op] ${playerCount} players, split-screen`);
  for (const info of bindingsInfo) {
    console.log(info);
  }
}

main();
