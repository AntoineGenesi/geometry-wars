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
import { MeshSurface } from './experimental/mesh-movement/MeshSurface';
import { getSoundEngine } from './audio/SoundEngine';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { KillLog } from './ui/KillLog';
import { TotalKillCounter } from './ui/TotalKillCounter';
import { WeaponPickup } from './weapons/WeaponPickup';
import { WeaponType } from './weapons/WeaponTypes';
import { AllyGlowManager } from './effects/AllyGlow';
import {
  NetworkClient,
  NetworkPlayerState,
  NetworkEnemyState,
  NetworkBulletState,
  NetworkGeomState,
  NetworkWeaponPickupState,
  NetworkGameState,
} from './network/NetworkClient';

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
  return params.get('server') || `ws://${window.location.hostname}:2567`;
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
  // Initialize audio (same as co-op)
  const sound = getSoundEngine();
  sound.init();
  sound.resume();
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

  // -- Enemy spawner (created after surface, used to create real enemy meshes) --
  let enemySpawner: EnemySpawner | null = null;

  function initSurface(serverSurfaceType: string): void {
    if (surfaceReady) return;

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

    surfaceReady = true;
  }

  // -- Camera constants (match co-op) --
  const CAMERA_DISTANCE = 15;
  const CAMERA_LERP = 0.08;

  // -- Shared visual systems (same as co-op) --
  const bulletPool = new BulletPool();
  scene.add(bulletPool.root);

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

  // Ally glow manager for remote player indicators
  const allyGlowManager = new AllyGlowManager(scene);

  // -- Player tracking --
  // Maps server player ID -> real Player instance (same class as single player)
  const networkPlayers = new Map<string, Player>();
  const playerGlowTrails = new Map<string, GlowTrail>();
  const playerAliveState = new Map<string, boolean>();

  // -- Enemy tracking --
  // Maps server enemy ID -> real BaseEnemy instance (created via EnemySpawner)
  const networkEnemies = new Map<string, BaseEnemy>();

  // -- Bullet tracking --
  const bulletIdToIndex = new Map<string, number>();

  // -- Geom tracking --
  const geomIdToIndex = new Map<string, number>();

  // -- Weapon pickup tracking --
  // Uses real WeaponPickup instances (same as co-op)
  const networkWeaponPickups = new Map<string, WeaponPickup>();

  // -- Local input --
  const input = new InputManager();

  // -- Network client --
  const network = new NetworkClient(getServerUrl());
  let localPlayerId = '';

  // Input throttle: send at 30Hz max, only when input changes
  const INPUT_SEND_INTERVAL = 0.033;
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

    // Use real EnemySpawner to create the enemy with proper mesh
    enemy = enemySpawner.spawn(spawnerType, netEnemy.surfaceU, netEnemy.surfaceV);

    // For network mode, immediately materialize (skip spawn warning)
    enemy.isMaterializing = false;
    if (enemy.mesh) {
      enemy.mesh.visible = true;
      enemy.mesh.scale.setScalar(1);
    }

    networkEnemies.set(id, enemy);
    return enemy;
  }

  // -----------------------------------------------------------------------
  // State change callback: sync server state to local visual entities
  // -----------------------------------------------------------------------

  function onStateChange(state: NetworkGameState) {
    // Initialize surface on first state change
    if (!surfaceReady) {
      initSurface(state.surfaceType);
    }
    if (!surface || !meshSurface || !getTransform) return;

    const surf = surface;

    // ----- Sync players -----
    state.players.forEach((netPlayer: NetworkPlayerState, id: string) => {
      const player = getOrCreatePlayer(id, netPlayer);

      // Sync state from server
      player.lives = netPlayer.lives;
      player.bombs = netPlayer.bombs;
      player.score = netPlayer.score;
      player.multiplier = netPlayer.multiplier;

      // Position on surface using real surface transform (same as co-op)
      const sp: SurfacePoint = surf.getPoint(netPlayer.surfaceU, netPlayer.surfaceV);
      player.mesh.position.copy(sp.position);
      player.mesh.position.addScaledVector(sp.normal, 0.15);
      player.surfaceU = netPlayer.surfaceU;
      player.surfaceV = netPlayer.surfaceV;

      // Orient on surface with aim angle (same math as co-op)
      orientPlayerOnSurface(player, sp.normal, netPlayer.aimAngle, sp.tangentU);

      // Detect death transition -> trigger effects
      const wasAlive = playerAliveState.get(id) ?? true;
      if (wasAlive && !netPlayer.alive) {
        particles.playerDeath(player.mesh.position);
        screenShake.shake(0.5, 0.4);
        sound.play('playerDeath');
      }
      playerAliveState.set(id, netPlayer.alive);

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
      }
    });

    // ----- Sync enemies -----
    const activeEnemyIds = new Set<string>();
    state.enemies.forEach((netEnemy: NetworkEnemyState) => {
      activeEnemyIds.add(netEnemy.id);

      const enemy = getOrCreateEnemy(netEnemy.id, netEnemy);
      if (!enemy) return;

      // Update position from server (override local AI)
      enemy.surfacePosition.u = netEnemy.surfaceU;
      enemy.surfacePosition.v = netEnemy.surfaceV;

      // Apply surface transform (same function as co-op enemy update)
      if (getTransform) {
        enemy.applySurfaceTransform(getTransform);
      }

      // Depth-based opacity (same as co-op's preRender)
      if (enemy.mesh && meshSurface) {
        const approxNormal = enemy.position.clone().sub(meshSurface.getCenter()).normalize();
        const visibility = meshSurface.getVisibility(enemy.position, approxNormal, camera.position);
        enemy.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshBasicMaterial;
            if (mat.transparent !== undefined) {
              mat.transparent = true;
              mat.opacity = visibility;
            }
          }
        });
        enemy.mesh.visible = netEnemy.alive && visibility > 0.05;
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
        if (surface) surface.applyForce(enemy.position, 0.2, 1.0);
        sound.play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });

        // Score popup at death position
        scorePopups.spawnScore(enemy.position.clone(), enemy.scoreValue);

        // Kill log entry (same as co-op)
        killLog.addKill(enemyType, color.getHex());

        // Clean up
        if (enemy.mesh) {
          scene.remove(enemy.mesh);
        }
        networkEnemies.delete(id);
      }
    });

    // ----- Sync bullets -----
    const activeBulletIds = new Set<string>();
    const trackedBulletIndices = new Set(bulletIdToIndex.values());

    state.bullets.forEach((bullet: NetworkBulletState) => {
      activeBulletIds.add(bullet.id);
      const existingIdx = bulletIdToIndex.get(bullet.id);

      if (existingIdx !== undefined) {
        // Update existing bullet position
        const sp: SurfacePoint = surf.getPoint(bullet.x, bullet.y);
        const targetPos = sp.position.clone().addScaledVector(sp.normal, 0.02);
        const line = (bulletPool as unknown as { lines: THREE.Line[] }).lines[existingIdx];
        if (line && line.visible) {
          line.position.lerp(targetPos, 0.4);
        }
      } else {
        // New bullet: spawn in pool
        const sp: SurfacePoint = surf.getPoint(bullet.x, bullet.y);
        const dir = new THREE.Vector3(bullet.dirX, bullet.dirY, bullet.dirZ);
        bulletPool.spawn(
          sp.position.clone().addScaledVector(sp.normal, 0.02),
          dir, bullet.x, bullet.y,
          Math.atan2(bullet.dirY, bullet.dirX),
        );
        // Track the newly spawned index
        bulletPool.forEachActive((idx) => {
          if (!trackedBulletIndices.has(idx)) {
            bulletIdToIndex.set(bullet.id, idx);
            trackedBulletIndices.add(idx);
          }
        });
      }
    });

    // Remove bullets no longer in server state
    bulletIdToIndex.forEach((idx, id) => {
      if (!activeBulletIds.has(id)) {
        bulletPool.kill(idx);
        bulletIdToIndex.delete(id);
      }
    });

    // ----- Sync geoms -----
    const activeGeomIds = new Set<string>();
    const trackedGeomIndices = new Set(geomIdToIndex.values());

    state.geoms.forEach((geom: NetworkGeomState) => {
      if (!geom.active) return;
      activeGeomIds.add(geom.id);

      if (geomIdToIndex.has(geom.id)) {
        // Existing geom - update UV
        const idx = geomIdToIndex.get(geom.id)!;
        const geomData = (geomPool as unknown as {
          geoms: { surfaceU: number; surfaceV: number }[]
        }).geoms[idx];
        if (geomData) {
          geomData.surfaceU = geom.surfaceU;
          geomData.surfaceV = geom.surfaceV;
        }
      } else {
        // New geom: spawn and track
        geomPool.spawn(geom.surfaceU, geom.surfaceV);
        geomPool.forEachActive((idx) => {
          if (!trackedGeomIndices.has(idx)) {
            geomIdToIndex.set(geom.id, idx);
            trackedGeomIndices.add(idx);
          }
        });
      }
    });

    // Remove geoms no longer in server state
    geomIdToIndex.forEach((idx, id) => {
      if (!activeGeomIds.has(id)) {
        geomPool.kill(idx);
        geomIdToIndex.delete(id);
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

      // Weapon display
      const wName = localPlayer.weaponType.replace(/_/g, ' ').toUpperCase();
      const ammoStr = localPlayer.weaponAmmo < 0 ? '' : ` [${localPlayer.weaponAmmo}]`;
      weaponEl.textContent = wName === 'STANDARD' ? '' : `${wName}${ammoStr}`;
    }

    // Player list
    let playerList = '<b>Players:</b><br>';
    state.players.forEach((p: NetworkPlayerState) => {
      const you = p.id === localPlayerId ? ' (YOU)' : '';
      const status = p.alive ? '' : ' [DEAD]';
      playerList += `${p.name}${you}: ${p.score.toLocaleString()}${status}<br>`;
    });
    playersEl.innerHTML = playerList;

    // Game state
    if (state.gameStarted) {
      statusEl.textContent = `Wave ${state.waveNumber}`;
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
  network.connect({
    name: `Player ${Math.floor(Math.random() * 1000)}`,
    surfaceType: urlSurfaceType,
  }).then(() => {
    localPlayerId = network.getLocalPlayerId();

    // Read the server's authoritative surface type
    const serverSurface = network.getServerSurfaceType();
    if (serverSurface && serverSurface !== urlSurfaceType) {
      // Server surface differs from URL -- use server's
    }
    initSurface(serverSurface);

    statusEl.textContent = 'Connected! Waiting for game start...';
    startBtn.style.display = 'block';

    network.setCallbacks({
      onStateChange,
      onGameStart: () => {
        statusEl.textContent = 'Game starting...';
        startBtn.style.display = 'none';
        // Start background music (same as co-op)
        const audioCtx = sound.getAudioContext();
        if (audioCtx) bgMusic.start(audioCtx);
      },
      onGameOver: () => {
        statusEl.textContent = 'GAME OVER';
        bgMusic.stop();
      },
      onError: (err) => {
        statusEl.textContent = `Error: ${err.message}`;
      },
    });
  }).catch((err) => {
    statusEl.textContent = 'Failed to connect to server!';
    statusEl.style.color = '#f44';
    backBtn.style.display = 'block';
    console.error('[NetworkMain] Connection failed:', err);
  });

  // -----------------------------------------------------------------------
  // Game loop (same structure as co-op)
  // -----------------------------------------------------------------------

  game.onFixedUpdate = (dt: number) => {
    if (!surfaceReady || !surface) return;

    // -- Send input to server --
    const inputState = input.getState();
    const mouseX = inputState.aimX;
    const mouseY = inputState.aimY;
    const aimAngle = Math.atan2(-mouseY, mouseX);

    lastInputSendTime += dt;
    if (network.isConnected() && lastInputSendTime >= INPUT_SEND_INTERVAL) {
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
    surface.updateGrid(dt);
    killLog.update(dt);
    allyGlowManager.update(dt);

    // Update enemy spawner to clean up spawn warning indicators.
    // The spawner also runs enemy AI (movement toward player), but that's
    // harmless since server positions override everything in onStateChange.
    if (enemySpawner) {
      const lp = networkPlayers.get(localPlayerId);
      const trackU = lp ? lp.surfaceU : 0.5;
      const trackV = lp ? lp.surfaceV : 0.5;
      enemySpawner.update(dt, trackU, trackV);
    }

    // Update glow trails
    playerGlowTrails.forEach((trail) => trail.update(dt));

    // Update geom pool (magnetic pull animation toward local player)
    const localPlayer = networkPlayers.get(localPlayerId);
    if (localPlayer) {
      const pt = surface.worldToSurface(localPlayer.mesh.position);
      geomPool.update(dt, pt.u, pt.v, game.clock.totalTime);
    }

    // Scale music intensity by enemy count (same as co-op)
    bgMusic.setIntensity(Math.min(networkEnemies.size / 30, 1.0));

    // Clear per-frame input
    input.endFrame();
  };

  game.onRender = () => {
    if (!surfaceReady || !surface || !getTransform) return;

    // Camera follows local player along surface normal (same as co-op)
    const localPlayer = networkPlayers.get(localPlayerId);
    if (localPlayer) {
      const uv = surface.worldToSurface(localPlayer.mesh.position);
      const sp = surface.getPoint(uv.u, uv.v);

      const targetCamPos = sp.position.clone().addScaledVector(sp.normal, CAMERA_DISTANCE);
      camera.position.lerp(targetCamPos, CAMERA_LERP);
      camera.lookAt(sp.position);

      // Smooth camera up vector (same as co-op)
      const upTarget = sp.tangentV;
      camera.up.lerp(upTarget, CAMERA_LERP).normalize();
    }

    // Apply surface projection for geoms and bullets (same as co-op)
    bulletPool.applySurfaceProjection(getTransform);
    geomPool.applySurfaceProjection(getTransform);

    // Screen shake (same as co-op)
    if (screenShake.offset.lengthSq() > 0.0001) {
      camera.position.add(screenShake.offset);
    }
  };

  // Start the game loop
  game.start();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    network.disconnect();
    bgMusic.stop();
    allyGlowManager.dispose();
    meshSurface?.dispose();
  });
}

main();
