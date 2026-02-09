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
import { ScoreManager } from './core/ScoreManager';
import type { LevelDefinition } from './core/LevelData';
import { ADVENTURE_LEVELS } from './core/LevelData';
import { MeshSurface } from './experimental/mesh-movement/MeshSurface';
import { MeshWalker } from './experimental/mesh-movement/MeshWalker';
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

function main(): void {
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

  // Hide default single-player HUD
  const defaultHUD = document.getElementById('game-hud');
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

  // -- Split-screen renderer --
  const splitRenderer = new SplitScreenRenderer(game.renderer, game.scene);
  splitRenderer.setLayout(playerCount);

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

  // Initial viewport sizing
  function updateViewportSizes(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    splitRenderer.resize(w, h);
    for (let i = 0; i < playerCount; i++) {
      const pv = splitRenderer.getPixelViewport(i);
      hud.setViewportBounds(i, pv.x, pv.y, pv.w, pv.h);
      killTally.setViewportBounds(i, pv.x, pv.y, pv.w, pv.h);
      input.setViewportBounds(i, pv.x, pv.y, pv.w, pv.h);
      // Position weapon HUD at bottom-left of each viewport
      if (weaponHUDs[i]) {
        weaponHUDs[i].setPosition(pv.x + 8, pv.y + pv.h / 2 - 40);
      }
    }
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
  const geomPool = new GeomPool();
  game.scene.add(geomPool.root);
  const particles = new ParticleSystem(5000);
  game.scene.add(particles.root);
  const scorePopups = new ScorePopupManager();
  game.scene.add(scorePopups.root);
  scorePopups.setCamera(game.camera);
  const screenShake = new ScreenShake();
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

  // Add ally glow to every player (each player's glow is visible to all viewports)
  for (let i = 0; i < playerCount; i++) {
    allyGlowManager.addGlow(i, PLAYER_COLORS[i], 0.9);
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
          surface.applyForce(position, 0.25, 1.0);
          screenShake.shake(0.15, 0.15);
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
      const fired = wm.fire(origin, direction, gameTime);
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
    };
  }

  // -- Wave system --
  let waveTimer = 3;
  let waveCount = 0;

  // -- Pause & Game Over --
  let isPaused = false;
  let isGameOver = false;

  const pauseMenu = new PauseMenu();
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
    game.stop();
    bgMusic.stop();
    window.location.href = window.location.pathname;
  });

  /** Build current game data snapshot for pause menu stats panel (P1 weapon + total kills) */
  function updatePauseMenuData(): void {
    const wm = weaponManagers[0];
    const currentWeapon = wm ? wm.getCurrentWeapon() : WeaponType.Standard;
    const weaponConfig = WEAPON_CONFIGS[currentWeapon];

    pauseMenu.setGameData({
      buffs: [],
      totalKills: totalKillCounter.getTotalKills(),
      weapon: {
        name: weaponConfig.name,
        baseDamage: weaponConfig.damage,
        fireRate: weaponConfig.fireRate,
      },
    });
  }

  const gameOverScreen = new GameOverScreen();
  gameOverScreen.onContinue(() => {
    game.stop();
    bgMusic.stop();
    window.location.href = window.location.pathname;
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
            walker.position.copy(projected.point);
            walker.normal.copy(projected.normal);
            walker.faceIndex = projected.faceIndex;
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

      // Movement
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

      // Bridge to UV
      const uv = surface.worldToSurface(walker.position);
      player.surfaceU = uv.u;
      player.surfaceV = uv.v;

      // Aim direction
      let aimDir: THREE.Vector3;
      if (bindings.aimMode === 'mouse') {
        // Mouse aim using tangent frame
        const frame = walker.getTangentFrame();
        const aimLen = Math.sqrt(pInput.aimX * pInput.aimX + pInput.aimY * pInput.aimY);
        if (aimLen > 0.1) {
          aimDir = new THREE.Vector3()
            .addScaledVector(frame.tangent, pInput.aimX)
            .addScaledVector(frame.bitangent, -pInput.aimY)
            .normalize();
        } else {
          aimDir = frame.bitangent.clone();
        }
      } else {
        // Auto-aim: face movement direction
        aimDir = faceDirs[i].clone();
      }

      orientPlayerOnSurface(player, walker.normal, aimDir);

      // Compute aim angle for bullets
      const frame = walker.getTangentFrame();
      if (bindings.aimMode === 'mouse') {
        player.aimAngle = Math.atan2(pInput.aimX, -pInput.aimY);
      } else {
        const faceAimX = aimDir.dot(frame.tangent);
        const faceAimY = -aimDir.dot(frame.bitangent);
        player.aimAngle = Math.atan2(faceAimX, -faceAimY);
      }

      player.mesh.updateMatrixWorld(true);
      player.update(dt, {
        moveX: pInput.moveX,
        moveY: pInput.moveY,
        aimX: bindings.aimMode === 'mouse' ? pInput.aimX : aimDir.dot(frame.tangent),
        aimY: bindings.aimMode === 'mouse' ? pInput.aimY : -aimDir.dot(frame.bitangent),
        shooting: pInput.shooting,
        bomb: pInput.bomb,
        boost: false,
        weaponSwap: false,
      });
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
        cam.lookAt(walker.position);

        const upTarget = walker.getTangentFrame().bitangent;
        cam.up.lerp(upTarget, CAMERA_LERP).normalize();
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
    }
    enemySpawner.update(dt, trackU, trackV);

    // -----------------------------------------------------------------------
    // Update shared systems
    // -----------------------------------------------------------------------
    bulletPool.update(dt);
    geomPool.update(dt, trackU, trackV, game.clock.totalTime);
    particles.update(dt);
    scorePopups.update(dt);
    screenShake.update(dt);
    killLog.update(dt);
    surface.updateGrid(dt);

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
        const dist = bulletPos.distanceTo(enemy.position);
        if (dist < enemy.radius + 0.15) {
          bulletPool.kill(bulletIdx);
          const auraBuff = auraManager.getBuffForPlayer(bulletData.ownerId);
          const scorePower = scoreManager.getScorePowerMultiplier();
          const damage = 1 * auraBuff.damageMultiplier * scorePower;
          enemy.takeDamage(damage, bulletData.ownerId);

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
        if (!enemy.active) continue;
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

    // Scale music intensity
    bgMusic.setIntensity(Math.min(enemySpawner.getActiveCount() / 30, 1.0));

    // Clear input flags
    input.endFrame();
  };

  // -- Render callback --
  game.onRender = (_alpha: number) => {
    bulletPool.applySurfaceProjection(getTransform);
    geomPool.applySurfaceProjection(getTransform);

    if (screenShake.offset.lengthSq() > 0.0001) {
      for (const cam of cameras) {
        cam.position.add(screenShake.offset);
      }
    }
  };

  // -- Per-viewport pre-render: depth-based opacity --
  splitRenderer.preRender = (playerIndex: number, camera: THREE.PerspectiveCamera) => {
    const camPos = camera.position;
    const meshCenter = meshSurface.getCenter();
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.alive || !enemy.mesh) continue;
      const approxNormal = enemy.position.clone().sub(meshCenter).normalize();
      const visibility = meshSurface.getVisibility(enemy.position, approxNormal, camPos);
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
    hud.update(playerIndex, {
      score: player.score,
      multiplier: player.multiplier,
      lives: player.lives,
      bombs: player.bombs,
      weaponName: currentWeapon === WeaponType.Standard ? 'Standard' : WEAPON_CONFIGS[currentWeapon].name,
      ammo: currentWeapon === WeaponType.Standard ? -1 : wm.getCurrentAmmo(),
      kills: stats.kills,
      assists: stats.assists,
    });

    // Update per-player weapon inventory HUD
    const whud = weaponHUDs[playerIndex];
    if (whud) {
      whud.update(wm.getInventory(), wm.getCurrentWeapon());
    }
  };

  // -- Start background music --
  const audioCtx = sound.getAudioContext();
  if (audioCtx) {
    bgMusic.start(audioCtx);
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
