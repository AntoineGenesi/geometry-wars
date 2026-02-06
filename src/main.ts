import * as THREE from 'three';

import { Game } from './core/Game';
import { Surface, SurfacePoint } from './surfaces/Surface';
import { SurfaceFactory, SurfaceType } from './surfaces/SurfaceFactory';
import { InputManager } from './input/InputManager';
import { Player } from './entities/Player';
import { BulletPool } from './entities/Bullet';
import { GeomPool } from './entities/Geom';
import { EnemySpawner } from './entities/enemies/EnemySpawner';
import { BaseEnemy } from './entities/enemies/BaseEnemy';
import { ParticleSystem } from './effects/ParticleSystem';
import { ScreenShake } from './effects/ScreenShake';
import { GlowTrail } from './effects/GlowTrail';
import { EntityGlow, EntityGlowManager, GlowPresets } from './effects/EntityGlow';
import { ScoreManager } from './core/ScoreManager';
import { GameMode, ModePhase } from './core/GameMode';
import type { WaveDefinition, LevelDefinition } from './core/LevelData';
import { ADVENTURE_LEVELS } from './core/LevelData';
import { BaseDrone, DroneType } from './weapons/BaseDrone';
import { createDrone } from './weapons/DroneFactory';
import { SuperStateManager, SuperStateType } from './weapons/SuperState';
import { SuperStatePickup } from './weapons/SuperStatePickup';
import { WeaponManager } from './weapons/WeaponManager';
import { WeaponType, WEAPON_CONFIGS } from './weapons/WeaponTypes';
import { WeaponPickup, getRandomWeaponType } from './weapons/WeaponPickup';
import { Spawner } from './entities/enemies/Spawner';
import { TitanGrunt } from './entities/enemies/TitanGrunt';
import { TitanSpinner } from './entities/enemies/TitanSpinner';
import { TitanWeaver } from './entities/enemies/TitanWeaver';
import { StartMenu, MenuSelection } from './ui/StartMenu';
import { PauseMenu } from './ui/PauseMenu';
import { GameOverScreen } from './ui/GameOverScreen';
import { LevelCompleteScreen } from './ui/LevelCompleteScreen';
import { MeshSurface } from './experimental/mesh-movement/MeshSurface';
import { MeshWalker } from './experimental/mesh-movement/MeshWalker';
import { getSoundEngine } from './audio/SoundEngine';
import { BackgroundMusic } from './audio/BackgroundMusic';

// ---------------------------------------------------------------------------
// URL Parameters
// Usage: ?surface=torus, ?mode=multiplayer
// ---------------------------------------------------------------------------

function getSurfaceTypeFromURL(): SurfaceType {
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  const validTypes = SurfaceFactory.getAvailableTypes();
  if (surfaceParam && validTypes.includes(surfaceParam as SurfaceType)) {
    return surfaceParam as SurfaceType;
  }
  return 'sphere'; // Default
}

function isMultiplayerMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'multiplayer';
}

function isNetworkMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'network';
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const scoreEl = document.getElementById('score-display')!;
const multiplierEl = document.getElementById('multiplier-display')!;
const livesEl = document.getElementById('lives-display')!;
const bombsEl = document.getElementById('bombs-display')!;
const weaponEl = document.getElementById('weapon-display')!;
const timerEl = document.getElementById('timer-display')!;
const levelNameEl = document.getElementById('level-name-display')!;
const countdownEl = document.getElementById('countdown-overlay')!;

function updateUI(player: Player, weaponManager?: WeaponManager): void {
  scoreEl.textContent = player.score.toLocaleString();
  multiplierEl.textContent = `x${player.multiplier}`;

  // Show hearts up to 5, then show number
  const lives = Math.max(0, player.lives);
  if (lives <= 5) {
    livesEl.textContent = '\u2665'.repeat(lives);
  } else {
    livesEl.textContent = `\u2665 x${lives}`;
  }

  // Show bombs up to 5, then show number
  const bombs = Math.max(0, player.bombs);
  if (bombs <= 5) {
    bombsEl.textContent = '\u25cf'.repeat(bombs);
  } else {
    bombsEl.textContent = `\u25cf x${bombs}`;
  }

  // Show current weapon + ammo
  if (weaponManager) {
    const weapon = weaponManager.getCurrentWeapon();
    const config = WEAPON_CONFIGS[weapon];
    const ammo = weaponManager.getCurrentAmmo();
    if (weapon === WeaponType.Standard) {
      weaponEl.textContent = '';
    } else {
      weaponEl.textContent = `${config.name} [${ammo}]`;
      weaponEl.style.color = `#${config.color.toString(16).padStart(6, '0')}`;
      weaponEl.style.textShadow = `0 0 8px #${config.color.toString(16).padStart(6, '0')}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Enemy color map (for particle death effects)
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
};

// ---------------------------------------------------------------------------
// Surface transform helper
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
// Player movement speed (for sphere rotation)
// ---------------------------------------------------------------------------

// Player movement speed in world units per second (mesh-based movement)
// Constant everywhere on any shape - no pole distortion
const PLAYER_MOVE_SPEED = 3.0;

// ---------------------------------------------------------------------------
// Wave scheduler
// ---------------------------------------------------------------------------

class WaveScheduler {
  private waves: WaveDefinition[];
  private waveTimers: number[];
  private waveSpawned: boolean[];
  private elapsed = 0;

  constructor(waves: WaveDefinition[]) {
    this.waves = waves;
    this.waveTimers = waves.map(w => w.delay);
    this.waveSpawned = waves.map(() => false);
  }

  update(dt: number, spawner: EnemySpawner): void {
    this.elapsed += dt;

    for (let i = 0; i < this.waves.length; i++) {
      if (this.waveSpawned[i]) continue;
      if (this.elapsed >= this.waveTimers[i]) {
        this.waveSpawned[i] = true;
        const wave = this.waves[i];
        spawner.spawnWave(
          wave.enemies.map(e => ({
            type: e.type as any,
            count: e.count,
          })),
        );
      }
    }
  }

  get allSpawned(): boolean {
    return this.waveSpawned.every(s => s);
  }
}

// ---------------------------------------------------------------------------
// Bullet-enemy collision checker
// ---------------------------------------------------------------------------

function checkBulletEnemyCollisions(
  bulletPool: BulletPool,
  enemies: BaseEnemy[],
  particles: ParticleSystem,
  scoreManager: ScoreManager,
  geomPool: GeomPool,
  surface: Surface,
  screenShake: ScreenShake,
  onEnemyKilled?: (u: number, v: number) => void,
): void {
  bulletPool.forEachActive((bulletIdx, bulletPos) => {
    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;

      const dist = bulletPos.distanceTo(enemy.position);
      if (dist < enemy.radius + 0.15) {
        // Hit!
        bulletPool.kill(bulletIdx);
        enemy.takeDamage(1);

        // Bullet impact particles
        particles.bulletImpact(bulletPos);

        // Grid deformation at impact point
        surface.applyForce(bulletPos, 0.08, 0.3);

        if (!enemy.alive) {
          // Enemy died
          const enemyType = enemy.constructor.name.toLowerCase();
          const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xffffff);
          particles.enemyDeath(enemy.position, color);
          scoreManager.awardKill(enemy.scoreValue, enemyType);
          screenShake.shake(0.15, 0.15);
          getSoundEngine().play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });

          // Spawn geoms at death position
          const { u, v } = surface.worldToSurface(enemy.position);
          for (let g = 0; g < enemy.geomCount; g++) {
            const offsetU = (Math.random() - 0.5) * 0.03;
            const offsetV = (Math.random() - 0.5) * 0.03;
            geomPool.spawn(u + offsetU, v + offsetV);
          }

          onEnemyKilled?.(u, v);
        }

        break; // Each bullet hits one enemy
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Geom pickup checker
// ---------------------------------------------------------------------------

function checkGeomPickups(
  player: Player,
  geomPool: GeomPool,
  scoreManager: ScoreManager,
  particles: ParticleSystem,
): void {
  const pickupRadius = 0.5; // Slightly larger pickup radius
  geomPool.forEachActive((index, surfaceU, surfaceV, position) => {
    const dist = player.mesh.position.distanceTo(position);
    if (dist < pickupRadius) {
      geomPool.kill(index);
      scoreManager.collectGeom();
      // Green sparkle effect on collection
      particles.geomCollect(position);
      getSoundEngine().play('geomPickup', { pitch: 0.9 + Math.random() * 0.2 });
    }
  });
}

// ---------------------------------------------------------------------------
// Player-enemy collision checker
// ---------------------------------------------------------------------------

function checkPlayerEnemyCollisions(
  player: Player,
  enemies: BaseEnemy[],
  particles: ParticleSystem,
  screenShake: ScreenShake,
  isShielded: boolean,
): void {
  if (!player.canTakeDamage) return;

  for (const enemy of enemies) {
    if (!enemy.active) continue;

    const dist = player.mesh.position.distanceTo(enemy.position);
    if (dist < player.mesh.scale.x * 0.3 + enemy.radius) {
      if (isShielded) {
        // Shield absorbs the hit and kills the enemy
        enemy.takeDamage(999);
        particles.bulletImpact(enemy.position);
        screenShake.shake(0.2, 0.15);
        getSoundEngine().play('shieldHit');
      } else {
        player.die();
        particles.playerDeath(player.mesh.position);
        screenShake.shake(0.5, 0.4);
        getSoundEngine().play('playerDeath');
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function main(selectedSurface?: SurfaceType, startLevelIndex = 0): void {
  // Initialize sound engine (user already clicked start menu, so audio context is allowed)
  const sound = getSoundEngine();
  sound.init();
  sound.resume();

  const bgMusic = new BackgroundMusic();

  // Load level
  const levelIndex = Math.min(startLevelIndex, ADVENTURE_LEVELS.length - 1);
  const level: LevelDefinition = ADVENTURE_LEVELS[levelIndex];

  // -- Game engine --
  // Bloom: high threshold so only bright entities glow, not the grid
  const game = new Game({
    bloom: {
      strength: 1.0,
      radius: 0.4,
      threshold: 0.85,
    },
    cameraDistance: 20,
    cameraSmoothing: 0.05,
  });

  // Disable built-in camera - we control camera to follow player
  game.disableBuiltInCameraUpdate = true;

  // -- Lighting --
  // Ambient light for base illumination
  const ambient = new THREE.AmbientLight(0x404080, 0.6);
  game.scene.add(ambient);

  // Directional light for 3D shading on prism enemies
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  game.scene.add(directional);

  // Add a second directional from opposite side for fill
  const fillLight = new THREE.DirectionalLight(0x4488ff, 0.4);
  fillLight.position.set(-5, -5, -5);
  game.scene.add(fillLight);

  // -- Surface: use level's surface (adventure mode), or menu selection, or URL param --
  const surfaceType = selectedSurface || level.surface || getSurfaceTypeFromURL();
  const surfaceConfig = {
    gridColor: 0x006666,
    surfaceColor: 0x0a0020,
    surfaceOpacity: 0.35,
    gridOpacity: 0.5,
    // Type-specific configs
    radius: level.surfaceScale,           // For sphere, icosahedron, dented-sphere, sphere-tunnel
    size: level.surfaceScale,             // For cube
    radiusTop: level.surfaceScale * 0.8,  // For cylinder
    height: level.surfaceScale * 2,       // For cylinder, capsule
    majorRadius: level.surfaceScale * 0.8,// For torus
    minorRadius: level.surfaceScale * 0.3,// For torus
    cylinderRadius: level.surfaceScale * 0.4, // For peanut
    sphereRadius: level.surfaceScale * 0.6,   // For peanut, capsule
    subdivisions: 2,                      // For icosahedron
    width: level.surfaceScale,            // For mobius
    numDents: 8,                          // For dented-sphere
    dentDepth: level.surfaceScale * 0.15, // For dented-sphere
    tunnelRadius: level.surfaceScale * 0.3,// For sphere-tunnel
    gridSegmentsU: 24,
    gridSegmentsV: 18,
  };
  const surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);
  game.scene.add(surface.group);

  // Log which surface/level is being used
  console.log(`[Geometry Wars] Level ${levelIndex + 1}: ${level.name} (${surfaceType})`);

  // -- Mesh-based movement system (BVH) --
  // Wraps the surface mesh for shape-agnostic movement queries.
  // Replaces UV-based movement for player; enemies/geoms still use UV as bridge.
  surface.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surface.mesh);

  // -- Input --
  const input = new InputManager();

  // Surface transform callback shared by subsystems still using UV (enemies, geoms, drones)
  const getTransform = makeSurfaceTransformFn(surface);

  // -- Bullet pool --
  const bulletPool = new BulletPool();
  game.scene.add(bulletPool.root);

  // Set mesh surface for shape-agnostic bullet projection (replaces sphere-only projection)
  bulletPool.setMeshSurface(meshSurface);
  bulletPool.setSurfaceFunctions(
    getTransform,
    (u: number, v: number, du: number, dv: number) => surface.moveOnSurface(u, v, du, dv)
  );

  // -- Geom pool --
  const geomPool = new GeomPool();
  game.scene.add(geomPool.root);

  // -- Player --
  const player = new Player(bulletPool);
  player.respawn(0.5, 0.5);
  player.lives = level.lives > 0 ? level.lives : 3; // Default to 3 lives, not 99
  player.bombs = level.bombs;
  game.scene.add(player.mesh);
  game.cameraTarget = player.mesh;

  // Create MeshWalker for player (mesh-based movement, no UV pole singularity)
  const initialPoint = surface.getPoint(0.5, 0.5);
  const playerWalker = new MeshWalker(meshSurface, initialPoint.position, PLAYER_MOVE_SPEED);

  // Sync player position from walker
  player.mesh.position.copy(playerWalker.position);
  // Bridge: set initial UV from world position for enemies/geoms that still use UV
  const initialUV = surface.worldToSurface(playerWalker.position);
  player.surfaceU = initialUV.u;
  player.surfaceV = initialUV.v;

  // -- Player glow trail (follows player movement) --
  const playerGlowTrail = new GlowTrail(
    new THREE.Color(GlowPresets.player.color),
    60,
    0.4
  );
  game.scene.add(playerGlowTrail.root);

  // -- Entity glow manager (subtle glow halos) --
  const glowManager = new EntityGlowManager();

  // Add glow to player
  const playerGlow = new EntityGlow(
    GlowPresets.player.color,
    GlowPresets.player.size,
    GlowPresets.player.opacity,
    GlowPresets.player.pulseSpeed,
    GlowPresets.player.pulseAmount
  );
  playerGlow.attachTo(player.mesh);

  // -- Enemy spawner --
  const enemySpawner = new EnemySpawner(game.scene, getTransform);

  // -- Enemy glow trails (for fast-moving enemies) --
  // Track which enemies have trails and their trail objects
  const enemyGlowTrails = new Map<BaseEnemy, GlowTrail>();

  // Fast enemy types that get glow trails
  const FAST_ENEMY_TYPES = ['Mayfly', 'Rocket', 'Duck', 'Arrow'];

  // Colors for different enemy types
  const ENEMY_TRAIL_COLORS: Record<string, number> = {
    Mayfly: 0xddddff,
    Rocket: 0xff8800,
    Duck: 0xff44aa,
    Arrow: 0xffff00,
  };

  // -- Particle system --
  const particles = new ParticleSystem(5000);
  game.scene.add(particles.root);

  // -- Screen shake --
  const screenShake = new ScreenShake();

  // -- Score manager --
  const scoreManager = new ScoreManager();
  scoreManager.setPlayer(player);

  // -- Wave scheduler --
  const waveScheduler = new WaveScheduler(level.waves);

  // -- Game mode --
  const gameMode = new GameMode({
    type: level.mode as any,
    timeLimit: level.timeLimit,
    lives: level.lives,
    bombs: level.bombs,
    supers: level.supers,
    canShoot: true,
    starThresholds: level.starThresholds,
  });

  let isLevelComplete = false;

  gameMode.onComplete = (stars: number) => {
    if (isLevelComplete) return;
    isLevelComplete = true;
    bgMusic.stop();
    sound.play('multiplierUp');
    setTimeout(() => {
      levelCompleteScreen.show(
        levelIndex,
        level.name,
        player.score,
        stars,
        level.starThresholds,
        hasNextLevel,
      );
    }, 500);
  };

  gameMode.onFailed = () => {
    // Failed is handled by the game over flow (lives depleted)
  };

  // -- Drone system --
  const drones: BaseDrone[] = [];

  if (level.drone) {
    const droneType = level.drone as DroneType;
    const drone = createDrone(droneType, 0, {
      onShoot: (origin, direction) => {
        // Drone bullet spawning
        const transform = getTransform(origin.u, origin.v);
        const dir = new THREE.Vector3(
          Math.cos(direction), 0, Math.sin(direction),
        ).applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            transform.normal,
          ),
        );
        bulletPool.spawn(transform.position, dir, origin.u, origin.v, direction);
      },
      onCollectGeom: (u, v) => {
        // Collect drone picks up nearby geoms
        geomPool.forEachActive((index, _su, _sv, position) => {
          const transform = getTransform(u, v);
          if (transform.position.distanceTo(position) < 0.5) {
            geomPool.kill(index);
            scoreManager.collectGeom();
          }
        });
      },
    });
    game.scene.add(drone.mesh);
    drones.push(drone);
  }

  // -- Super state manager --
  const superStateManager = new SuperStateManager();

  // -- Super state pickups on the field --
  const superPickups: SuperStatePickup[] = [];

  // -- Weapon manager --
  const weaponManager = new WeaponManager();
  game.scene.add(weaponManager.getVisualRoot());

  // Wire weapon callbacks
  weaponManager.setCallbacks({
    getEnemies: () => {
      return enemySpawner.getEnemies()
        .filter(e => e.alive && e.mesh)
        .map((e, i) => ({
          position: e.position.clone(),
          index: i,
          alive: e.alive,
        }));
    },
    onEnemyDamage: (index: number, damage: number, _weaponType: WeaponType) => {
      const enemies = enemySpawner.getEnemies().filter(e => e.alive && e.mesh);
      const enemy = enemies[index];
      if (!enemy) return;
      enemy.takeDamage(damage);
      if (!enemy.alive) {
        const enemyType = enemy.constructor.name.toLowerCase();
        const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xffffff);
        particles.enemyDeath(enemy.position, color);
        scoreManager.awardKill(enemy.scoreValue, enemyType);
        screenShake.shake(0.15, 0.15);
        getSoundEngine().play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });

        const { u, v } = surface.worldToSurface(enemy.position);
        for (let g = 0; g < enemy.geomCount; g++) {
          geomPool.spawn(
            u + (Math.random() - 0.5) * 0.03,
            v + (Math.random() - 0.5) * 0.03,
          );
        }
      }
    },
    spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => {
      const { u, v } = surface.worldToSurface(origin);
      const aimAngle = Math.atan2(direction.x, direction.z);
      bulletPool.spawn(origin, direction, u, v, aimAngle);
    },
  });

  // -- Weapon pickups on the field --
  const weaponPickups: WeaponPickup[] = [];

  // -- Wire up enemy death handler --
  BaseEnemy.onDeath = (_position: THREE.Vector3, _score: number, _geoms: number) => {
    // Handled in checkBulletEnemyCollisions above
  };

  // -- Spawner: periodically spawns wanderers --
  Spawner.onSpawnEnemy = (u: number, v: number) => {
    enemySpawner.spawn('wanderer', u, v);
  };

  // -- Titan death spawns: spawn smaller versions on death --
  TitanGrunt.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const offsetU = (Math.random() - 0.5) * 0.06;
      const offsetV = (Math.random() - 0.5) * 0.06;
      enemySpawner.spawn('grunt', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };
  TitanSpinner.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const offsetU = (Math.random() - 0.5) * 0.06;
      const offsetV = (Math.random() - 0.5) * 0.06;
      enemySpawner.spawn('spinner', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };
  TitanWeaver.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const offsetU = (Math.random() - 0.5) * 0.06;
      const offsetV = (Math.random() - 0.5) * 0.06;
      enemySpawner.spawn('weaver', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };

  // -- Respawn timer --
  let respawnTimer = 0;
  const RESPAWN_DELAY = 1.5;

  // -- Game state --
  let isPaused = false;
  let isGameOver = false;

  // -- Pause menu --
  const pauseMenu = new PauseMenu();
  pauseMenu.onResume(() => {
    isPaused = false;
  });
  pauseMenu.onExit(() => {
    // Clean up and reload page to go back to menu
    game.stop();
    window.location.href = window.location.pathname;
  });

  // -- Game over screen --
  const gameOverScreen = new GameOverScreen();
  gameOverScreen.onContinue(() => {
    game.stop();
    window.location.href = window.location.pathname;
  });

  // -- Level complete screen --
  const levelCompleteScreen = new LevelCompleteScreen();
  const hasNextLevel = levelIndex + 1 < ADVENTURE_LEVELS.length;

  levelCompleteScreen.onNext(() => {
    game.stop();
    bgMusic.stop();
    weaponManager.dispose();
    levelCompleteScreen.dispose();
    gameOverScreen.dispose();
    main(selectedSurface, levelIndex + 1);
  });
  levelCompleteScreen.onReplay(() => {
    game.stop();
    bgMusic.stop();
    weaponManager.dispose();
    levelCompleteScreen.dispose();
    gameOverScreen.dispose();
    main(selectedSurface, levelIndex);
  });
  levelCompleteScreen.onMenu(() => {
    game.stop();
    window.location.href = window.location.pathname;
  });

  // -- Keyboard handlers (pause, mute) --
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !isGameOver) {
      if (isPaused) {
        isPaused = false;
        pauseMenu.hide();
      } else {
        isPaused = true;
        pauseMenu.show();
      }
    }
    // M = toggle mute
    if (e.key === 'm' || e.key === 'M') {
      sound.muted = !sound.muted;
      if (sound.muted) {
        bgMusic.volume = 0;
      } else {
        bgMusic.volume = 0.3;
      }
    }
  });

  // Set level name in HUD
  levelNameEl.textContent = `${level.name}`;

  // -- Fixed timestep game logic --
  game.onFixedUpdate = (dt: number) => {
    // Skip update if paused or game over
    if (isPaused || isGameOver || isLevelComplete) return;

    // Update game mode (handles countdown timer, time limits)
    gameMode.update(dt, player.score, player.lives);

    // Show countdown overlay
    if (gameMode.phase === ModePhase.Countdown) {
      const countVal = Math.ceil(gameMode.countdownTimer);
      countdownEl.textContent = countVal > 0 ? String(countVal) : 'GO!';
      countdownEl.classList.add('visible');
      // During countdown: update grid springs but skip gameplay
      surface.updateGrid(dt);
      input.endFrame();
      return;
    }
    // Hide countdown once playing starts (one-time)
    if (countdownEl.classList.contains('visible')) {
      countdownEl.textContent = 'GO!';
      countdownEl.classList.remove('visible');
    }

    // Update timer display for timed modes
    if (level.timeLimit > 0) {
      const secs = Math.ceil(Math.max(0, gameMode.timeRemaining));
      const mins = Math.floor(secs / 60);
      const remainingSecs = secs % 60;
      timerEl.textContent = `${mins}:${String(remainingSecs).padStart(2, '0')}`;
      timerEl.classList.toggle('urgent', secs <= 10);
    }

    const inputState = input.getState();

    // Handle respawn or game over
    if (!player.alive) {
      if (player.lives > 0) {
        respawnTimer += dt;
        if (respawnTimer >= RESPAWN_DELAY) {
          respawnTimer = 0;
          // Respawn at center of surface
          player.respawn(0.5, 0.5);
          const respawnPoint = surface.getPoint(0.5, 0.5);
          // Reset walker to respawn position
          const projected = meshSurface.closestPointOnSurface(respawnPoint.position);
          if (projected) {
            playerWalker.position.copy(projected.point);
            playerWalker.normal.copy(projected.normal);
            playerWalker.faceIndex = projected.faceIndex;
          }
          player.mesh.position.copy(playerWalker.position);
        }
      } else if (!isGameOver) {
        // Game over - no lives left
        isGameOver = true;
        // Short delay before showing game over screen
        setTimeout(() => {
          gameOverScreen.show(player.score, surfaceType);
        }, 1000);
      }
    }

    // Update player movement and shooting
    if (player.alive) {
      // MESH-BASED SURFACE MOVEMENT (BVH)
      // Player moves on mesh surface using world-space tangent projection.
      // No UV coordinates, no pole singularity, constant speed everywhere.

      // Move player on surface via MeshWalker
      if (Math.abs(inputState.moveX) > 0.01 || Math.abs(inputState.moveY) > 0.01) {
        playerWalker.moveFromInput(inputState.moveX, -inputState.moveY, game.camera, dt);
      }

      // Sync player mesh position from walker
      player.mesh.position.copy(playerWalker.position);

      // Bridge: convert world position to UV for enemies/geoms that still use UV
      const playerUV = surface.worldToSurface(playerWalker.position);
      player.surfaceU = playerUV.u;
      player.surfaceV = playerUV.v;

      const playerNormal = playerWalker.normal;

      // Camera follows player along surface normal
      const cameraDistance = 15;
      game.camera.position.copy(playerWalker.position)
        .addScaledVector(playerNormal, cameraDistance);
      game.camera.lookAt(playerWalker.position);

      // Set camera up to surface tangent (prevents flipping)
      const frame = playerWalker.getTangentFrame();
      game.camera.up.copy(frame.bitangent);

      // Calculate aim from mouse in screen space
      const camRight = new THREE.Vector3();
      const camUp = new THREE.Vector3();
      game.camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

      const aimX = inputState.aimX;
      const aimY = inputState.aimY;
      const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);

      let aimDirection: THREE.Vector3;
      if (aimLen > 0.1) {
        // Project screen aim onto surface tangent plane
        const screenAim = camRight.multiplyScalar(aimX)
          .add(camUp.multiplyScalar(-aimY));
        // Project onto surface (remove normal component)
        const dot = screenAim.dot(playerNormal);
        aimDirection = screenAim.sub(playerNormal.clone().multiplyScalar(dot)).normalize();
      } else {
        // Default: face camera up direction projected onto surface
        const dot = camUp.clone().negate().dot(playerNormal);
        aimDirection = camUp.clone().negate().sub(playerNormal.clone().multiplyScalar(dot)).normalize();
      }

      // Orient player to face aim direction
      if (aimDirection.lengthSq() > 0.001) {
        const playerRight = new THREE.Vector3().crossVectors(playerNormal, aimDirection).normalize();
        const playerForward = new THREE.Vector3().crossVectors(playerRight, playerNormal).normalize();
        const orientMat = new THREE.Matrix4().makeBasis(playerRight, playerNormal, playerForward);
        player.mesh.quaternion.setFromRotationMatrix(orientMat);
      }

      // Store aim angle for bullets
      player.aimAngle = Math.atan2(aimX, -aimY);

      // Update matrix for bullet spawning
      player.mesh.updateMatrixWorld(true);

      // Player update (shooting, bombs, etc.)
      player.update(dt, inputState);
    }

    // Spawn enemy waves
    waveScheduler.update(dt, enemySpawner);

    // Update enemies - use player's actual UV position
    if (player.canBeTracked) {
      enemySpawner.update(dt, player.surfaceU, player.surfaceV);
    } else {
      // Player is invincible/blinking - give enemies a fake position so they don't track
      const fakeU = 0.5 + Math.sin(game.clock.totalTime * 0.5) * 0.3;
      const fakeV = 0.5 + Math.cos(game.clock.totalTime * 0.7) * 0.3;
      enemySpawner.update(dt, fakeU, fakeV);
    }

    // Update bullets
    bulletPool.update(dt);

    // Update geoms
    geomPool.update(dt, player.surfaceU, player.surfaceV, game.clock.totalTime);

    // Update particles
    particles.update(dt);

    // Update player glow trail (add point at player position)
    if (player.alive) {
      playerGlowTrail.addPoint(player.mesh.position.clone());
    }
    playerGlowTrail.update(dt);

    // Update entity glows
    glowManager.update(dt);
    playerGlow.update(dt);

    // Update enemy glow trails (for fast-moving enemies)
    const currentEnemies = enemySpawner.getEnemies();
    const activeEnemySet = new Set(currentEnemies);

    // Remove trails for dead/removed enemies
    enemyGlowTrails.forEach((trail, enemy) => {
      if (!activeEnemySet.has(enemy) || !enemy.alive) {
        trail.dispose();
        game.scene.remove(trail.root);
        enemyGlowTrails.delete(enemy);
      }
    });

    // Update existing trails and add new ones for fast enemies
    for (const enemy of currentEnemies) {
      if (!enemy.alive) continue;

      const enemyTypeName = enemy.constructor.name;

      // Check if this is a fast enemy type
      if (FAST_ENEMY_TYPES.includes(enemyTypeName)) {
        let trail = enemyGlowTrails.get(enemy);

        // Create trail if doesn't exist
        if (!trail) {
          const color = ENEMY_TRAIL_COLORS[enemyTypeName] || 0xff0000;
          trail = new GlowTrail(new THREE.Color(color), 40, 0.3);
          game.scene.add(trail.root);
          enemyGlowTrails.set(enemy, trail);
        }

        // Add point at enemy position
        if (enemy.mesh) {
          trail.addPoint(enemy.mesh.position.clone());
        }
        trail.update(dt);
      }
    }

    // Update screen shake
    screenShake.update(dt);

    // Update drones
    const enemies = enemySpawner.getEnemies();
    for (const drone of drones) {
      drone.update(dt, player.surfaceU, player.surfaceV, player.aimAngle, enemies);
      drone.applySurfaceTransform(getTransform);
    }

    // Update super state manager
    superStateManager.update(dt);

    // Update super state pickups
    for (let i = superPickups.length - 1; i >= 0; i--) {
      const pickup = superPickups[i];
      if (!pickup.active) {
        game.scene.remove(pickup.mesh);
        pickup.dispose();
        superPickups.splice(i, 1);
        continue;
      }
      pickup.update(dt);
      pickup.applySurfaceTransform(getTransform);

      // Check player collision with pickup
      if (player.alive && pickup.checkPlayerCollision(player.surfaceU, player.surfaceV)) {
        const allDotsGone = pickup.removeClosestDot(player.surfaceU, player.surfaceV);
        if (allDotsGone) {
          superStateManager.activate(pickup.type);
          pickup.active = false;
        }
      }
    }

    // -- Collision checks --

    // Bullets vs enemies
    const SUPER_STATE_TYPES = [
      SuperStateType.QuadFire, SuperStateType.SplitFire,
      SuperStateType.ReverseFire, SuperStateType.Missile,
      SuperStateType.Magnet, SuperStateType.TrailBomb,
      SuperStateType.Shield,
    ];

    checkBulletEnemyCollisions(
      bulletPool,
      enemies,
      particles,
      scoreManager,
      geomPool,
      surface,
      screenShake,
      (u: number, v: number) => {
        // ~5% chance to spawn a super state pickup on enemy death
        if (Math.random() < 0.05) {
          const type = SUPER_STATE_TYPES[
            Math.floor(Math.random() * SUPER_STATE_TYPES.length)
          ];
          const pickup = new SuperStatePickup(type, u, v);
          game.scene.add(pickup.mesh);
          superPickups.push(pickup);
        }
        // ~8% chance to spawn a weapon pickup on enemy death
        if (Math.random() < 0.08) {
          const wpnType = getRandomWeaponType();
          const wpnPickup = new WeaponPickup(wpnType, u, v);
          game.scene.add(wpnPickup.mesh);
          weaponPickups.push(wpnPickup);
        }
      },
    );

    // Player vs geoms
    checkGeomPickups(player, geomPool, scoreManager, particles);

    // Player vs enemies
    const fireModifiers = superStateManager.getFireModifiers();
    checkPlayerEnemyCollisions(player, enemies, particles, screenShake, fireModifiers.isShielded);

    // Update weapon manager (projectiles, effects)
    weaponManager.update(dt);

    // Update weapon pickups
    for (let i = weaponPickups.length - 1; i >= 0; i--) {
      const wp = weaponPickups[i];
      if (!wp.active) {
        game.scene.remove(wp.mesh);
        wp.dispose();
        weaponPickups.splice(i, 1);
        continue;
      }
      wp.update(dt, game.clock.totalTime);
      wp.applySurfaceTransform(getTransform);

      // Check player collision with weapon pickup
      if (player.alive && wp.checkPlayerCollision(player.surfaceU, player.surfaceV)) {
        weaponManager.equipWeapon(wp.type);
        sound.play('weaponPickup');
        wp.active = false;
      }
    }

    // Update grid deformation springs
    surface.updateGrid(dt);

    // Scale music intensity with enemy count
    const enemyCount = enemySpawner.getActiveCount();
    bgMusic.setIntensity(Math.min(enemyCount / 30, 1.0));

    // Check level completion for non-timed modes (all waves spawned + no enemies alive)
    if (!isLevelComplete && !isGameOver
        && level.timeLimit === 0
        && waveScheduler.allSpawned
        && enemyCount === 0
        && gameMode.phase === ModePhase.Playing) {
      gameMode.completeLevel(player.score);
    }

    // Clear per-frame input flags
    input.endFrame();
  };

  // -- Render callback --
  game.onRender = (_alpha: number) => {
    // Project bullets and geoms onto surface
    bulletPool.applySurfaceProjection(getTransform);
    geomPool.applySurfaceProjection(getTransform);

    // Depth-based opacity: fade enemies on the far side of the surface
    const camPos = game.camera.position;
    const meshCenter = meshSurface.getCenter();
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.alive || !enemy.mesh) continue;
      // Approximate outward normal as direction from mesh center to enemy
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

    // Apply screen shake to camera
    if (screenShake.offset.lengthSq() > 0.0001) {
      game.camera.position.add(screenShake.offset);
    }

    // Update HUD
    updateUI(player, weaponManager);
  };

  // -- Weapon fire handler: delegates all firing to WeaponManager --
  player.weaponFireHandler = (origin: THREE.Vector3, direction: THREE.Vector3) => {
    const gameTime = game.clock.totalTime;
    const fired = weaponManager.fire(origin, direction, gameTime);
    if (fired) {
      surface.applyForce(origin, 0.1, 0.3);
      sound.play('shoot', { pitch: 0.9 + Math.random() * 0.2 });
      if (weaponManager.getCurrentWeapon() !== WeaponType.Standard) {
        sound.play('weaponPickup', { volume: 0.3, pitch: 1.5 });
      }
    }
  };

  // -- Bomb: massive effects + clear screen --
  player.onBomb = () => {
    const pos = player.mesh.position;
    surface.applyForce(pos, 0.5, 3.0);
    particles.bombExplosion(pos);
    screenShake.shake(0.3, 0.3);
    sound.play('bomb');

    // Kill all enemies on screen (bombs award no points)
    const enemies = enemySpawner.getEnemies();
    for (const enemy of enemies) {
      if (enemy.active) {
        const color = ENEMY_COLORS[enemy.constructor.name.toLowerCase()] ?? new THREE.Color(0xffffff);
        particles.enemyDeath(enemy.position, color);

        // Spawn geoms (bombs still drop geoms)
        const { u, v } = surface.worldToSurface(enemy.position);
        for (let g = 0; g < enemy.geomCount; g++) {
          geomPool.spawn(
            u + (Math.random() - 0.5) * 0.03,
            v + (Math.random() - 0.5) * 0.03,
          );
        }

        enemy.die();
      }
    }
  };

  // -- Player death callback --
  player.onDeath = (position: THREE.Vector3) => {
    particles.playerDeath(position);
    screenShake.shake(0.5, 0.4);
    scoreManager.onPlayerDeath();
  };

  // -- Start background music --
  const audioCtx = sound.getAudioContext();
  if (audioCtx) {
    bgMusic.start(audioCtx);
  }

  // -- Start --
  game.start();
}

// ---------------------------------------------------------------------------
// Start menu flow
// ---------------------------------------------------------------------------

// Check for direct URL mode params (skip menu)
if (isMultiplayerMode()) {
  import('./multiplayer-main').then(() => {
    console.log('[Main] Loaded local multiplayer mode');
  });
} else if (isNetworkMode()) {
  import('./network-main').then(() => {
    console.log('[Main] Loaded network multiplayer mode');
  });
} else {
  // Show start menu
  const startMenu = new StartMenu();

  startMenu.onStart((selection: MenuSelection) => {
    console.log(`[Main] Starting game: ${selection.gameMode} on ${selection.surfaceType}`);
    startMenu.hide();

    // Handle game mode selection
    if (selection.gameMode === 'multiplayer') {
      // Local co-op - update URL and load multiplayer module
      window.history.replaceState({}, '', `?mode=multiplayer&surface=${selection.surfaceType}`);
      import('./multiplayer-main').then(() => {
        console.log('[Main] Loaded local multiplayer mode');
      });
    } else if (selection.gameMode === 'network') {
      // Online multiplayer - update URL and load network module
      window.history.replaceState({}, '', `?mode=network&surface=${selection.surfaceType}`);
      import('./network-main').then(() => {
        console.log('[Main] Loaded network multiplayer mode');
      });
    } else {
      // Single player - start the game with selected surface and optional level
      const levelIdx = selection.levelIndex ?? 0;
      window.history.replaceState({}, '', `?surface=${selection.surfaceType}&level=${levelIdx}`);
      startMenu.dispose();
      main(selection.surfaceType, levelIdx);
    }
  });
}
