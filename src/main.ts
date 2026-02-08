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
import { GameMode, GameModeType, ModePhase, MODE_DEFAULTS } from './core/GameMode';
import type { WaveDefinition, LevelDefinition } from './core/LevelData';
import { ADVENTURE_LEVELS } from './core/LevelData';
import { BaseDrone, DroneType } from './weapons/BaseDrone';
import { createDrone } from './weapons/DroneFactory';
import { SuperStateManager, SuperStateType } from './weapons/SuperState';
import { SuperStatePickup } from './weapons/SuperStatePickup';
import { WeaponManager } from './weapons/WeaponManager';
import { WeaponType, WEAPON_CONFIGS } from './weapons/WeaponTypes';
import { WeaponPickup, getRandomWeaponType } from './weapons/WeaponPickup';
import { BuffPickup, getRandomBuffType } from './weapons/BuffPickup';
import { Spawner } from './entities/enemies/Spawner';
import { TitanGrunt } from './entities/enemies/TitanGrunt';
import { TitanSpinner } from './entities/enemies/TitanSpinner';
import { TitanWeaver } from './entities/enemies/TitanWeaver';
import { GiantWanderer } from './entities/enemies/GiantWanderer';
import { GiantRocket } from './entities/enemies/GiantRocket';
import { GiantSnake } from './entities/enemies/GiantSnake';
import { GiantNeutron } from './entities/enemies/GiantNeutron';
import { Boss } from './entities/enemies/Boss';
import { Gate } from './entities/enemies/Gate';
import { Virus } from './entities/enemies/Virus';
import { Painter } from './entities/enemies/Painter';
import { ScorePopupManager } from './effects/ScorePopup';
import { StartMenu, MenuSelection } from './ui/StartMenu';
import { PauseMenu } from './ui/PauseMenu';
import { EffectsPanel } from './ui/EffectsPanel';
import { GameOverScreen } from './ui/GameOverScreen';
import { LevelCompleteScreen } from './ui/LevelCompleteScreen';
import { Minimap } from './ui/Minimap';
import { KillLog } from './ui/KillLog';
import { TotalKillCounter } from './ui/TotalKillCounter';
import { WeaponHUD } from './ui/WeaponHUD';
import { MeshSurface } from './experimental/mesh-movement/MeshSurface';
import { MeshWalker } from './experimental/mesh-movement/MeshWalker';
import { PlayerLevel, LevelUpNotification } from './core/PlayerLevel';
import { getSoundEngine } from './audio/SoundEngine';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { SpatialHash } from './core/SpatialHash';
import { CompanionManager, CompanionPickup, CompanionHUD, CompanionType, getRandomCompanionType } from './entities/Companion';
import { BuffManager, StackBuffType, BUFF_DEFINITIONS } from './buffs/BuffManager';
import { BuffHUD } from './buffs/BuffHUD';
import { BuffPickupNew } from './buffs/BuffPickupNew';
import { ShockArcRenderer } from './buffs/ShockArcRenderer';
import { EnemyInstanceManager } from './rendering/EnemyInstanceManager';

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
const flashEl = document.getElementById('screen-flash')!;
const playerLevelEl = document.getElementById('player-level-display')!;

/** Flash the screen with a color for visual impact */
function screenFlash(color: string, duration = 150): void {
  if (!flashEl) return;
  flashEl.style.background = color;
  flashEl.classList.add('active');
  setTimeout(() => {
    flashEl.classList.remove('active');
  }, duration);
}

function updateUI(player: Player, weaponManager?: WeaponManager): void {
  scoreEl.textContent = player.score.toLocaleString();
  multiplierEl.textContent = `x${player.multiplier}`;

  // Multiplier color scales with value
  const m = player.multiplier;
  if (m >= 100) {
    multiplierEl.style.color = '#ff00ff';
    multiplierEl.style.textShadow = '0 0 12px #ff00ff';
  } else if (m >= 50) {
    multiplierEl.style.color = '#ff8800';
    multiplierEl.style.textShadow = '0 0 10px #ff8800';
  } else if (m >= 20) {
    multiplierEl.style.color = '#ffff00';
    multiplierEl.style.textShadow = '0 0 8px #ffff00';
  } else if (m >= 5) {
    multiplierEl.style.color = '#00ff88';
    multiplierEl.style.textShadow = '0 0 8px #00ff88';
  } else {
    multiplierEl.style.color = '#0f0';
    multiplierEl.style.textShadow = '0 0 8px #0f0';
  }

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
  mayfly: new THREE.Color(0xaaff00),
  rocket: new THREE.Color(0xff8800),
  neutron: new THREE.Color(0x44dddd),
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
  private endless: boolean;
  private endlessWave = 0;
  private endlessNextSpawn = 5; // first endless wave at 5 seconds
  private endlessInterval = 8; // seconds between endless waves

  constructor(waves: WaveDefinition[], endless = false) {
    this.waves = waves;
    this.waveTimers = waves.map(w => w.delay);
    this.waveSpawned = waves.map(() => false);
    this.endless = endless;
  }

  update(dt: number, spawner: EnemySpawner): void {
    this.elapsed += dt;

    // Scripted waves
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

    // Endless scaling waves
    if (this.endless && this.elapsed >= this.endlessNextSpawn) {
      this.endlessWave++;
      this.endlessNextSpawn += Math.max(3, this.endlessInterval - this.endlessWave * 0.3);
      const wave = this.generateEndlessWave(this.endlessWave);
      spawner.spawnWave(wave as any);
    }
  }

  private generateEndlessWave(waveNum: number): Array<{ type: string; count: number }> {
    const basicTypes = ['grunt', 'wanderer', 'duck'];
    const midTypes = ['weaver', 'spinner', 'rocket', 'neutron'];
    const hardTypes = ['snake', 'repulsor', 'gravity_well', 'spawner'];
    const giantTypes = ['giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron', 'titan_grunt', 'titan_spinner', 'titan_weaver'];
    const eliteTypes = ['mayfly', 'gate', 'virus', 'painter'];

    const enemies: Array<{ type: string; count: number }> = [];
    const baseCount = 3 + Math.floor(waveNum * 0.8);

    // Always some basic enemies
    const basicType = basicTypes[waveNum % basicTypes.length];
    enemies.push({ type: basicType, count: Math.min(baseCount, 12) });

    // Add mid-tier from wave 3+
    if (waveNum >= 3) {
      const midType = midTypes[(waveNum - 3) % midTypes.length];
      enemies.push({ type: midType, count: Math.min(Math.floor(baseCount * 0.6), 8) });
    }

    // Add hard enemies from wave 6+
    if (waveNum >= 6) {
      const hardType = hardTypes[(waveNum - 6) % hardTypes.length];
      enemies.push({ type: hardType, count: Math.min(Math.floor(baseCount * 0.4), 5) });
    }

    // Add giant/titan break-apart enemies from wave 8+
    if (waveNum >= 8) {
      const giantType = giantTypes[(waveNum - 8) % giantTypes.length];
      enemies.push({ type: giantType, count: Math.min(Math.floor(baseCount * 0.25), 3) });
    }

    // Add elite enemies from wave 10+
    if (waveNum >= 10) {
      const eliteType = eliteTypes[(waveNum - 10) % eliteTypes.length];
      enemies.push({ type: eliteType, count: Math.min(Math.floor(baseCount * 0.3), 4) });
    }

    return enemies;
  }

  get allSpawned(): boolean {
    if (this.endless) return false; // endless never finishes
    return this.waveSpawned.every(s => s);
  }

  getElapsed(): number {
    return this.elapsed;
  }
}

// ---------------------------------------------------------------------------
// Spatial hash for broad-phase collision (shared between collision checks)
// ---------------------------------------------------------------------------

const enemySpatialHash = new SpatialHash<BaseEnemy>(2.5);

// ---------------------------------------------------------------------------
// Bullet-enemy collision checker (optimized: squared distance + spatial hash + cached materials)
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
  scorePopups?: ScorePopupManager,
  bulletDamage: number = 1,
  onKillLog?: (type: string, color: number) => void,
  showDamageNumbers = true,
  onBulletHit?: (enemy: BaseEnemy) => void,
  onEnemyDied?: (enemy: BaseEnemy, allEnemies: BaseEnemy[]) => void,
  instanceManager?: EnemyInstanceManager | null,
): void {
  // Rebuild spatial hash each frame
  enemySpatialHash.clear();
  for (const enemy of enemies) {
    if (!enemy.active || !enemy.alive) continue;
    if (enemy.isMaterializing) continue;
    enemySpatialHash.insert(enemy.position.x, enemy.position.y, enemy.position.z, enemy);
  }

  bulletPool.forEachActive((bulletIdx, bulletPos) => {
    // Use spatial hash for broad-phase: only check nearby enemies
    const nearby = enemySpatialHash.getNearby(bulletPos.x, bulletPos.y, bulletPos.z);
    for (let n = 0; n < nearby.length; n++) {
      const enemy = nearby[n];
      if (!enemy.active || !enemy.alive) continue;

      // Use distanceToSquared to avoid sqrt
      const hitRadiusSq = (enemy.radius + 0.15) * (enemy.radius + 0.15);
      const distSq = bulletPos.distanceToSquared(enemy.position);
      if (distSq < hitRadiusSq) {
        // Hit!
        bulletPool.kill(bulletIdx);
        enemy.takeDamage(bulletDamage);

        // Trigger on-hit procs (incendiary rounds, etc.)
        if (enemy.alive) {
          onBulletHit?.(enemy);
        }

        // Damage number popup (skip on killing blow - score popup covers it)
        if (showDamageNumbers && scorePopups && enemy.alive) {
          scorePopups.spawnDamage(enemy.position, bulletDamage);
        }

        // Bullet impact particles
        particles.bulletImpact(bulletPos);

        // Grid deformation at impact point
        surface.applyForce(bulletPos, 0.08, 0.3);

        // Hit flash: instanced enemies use instanceColor, others use cached materials
        if (enemy.alive) {
          if (enemy.isInstanced && instanceManager) {
            instanceManager.hitFlash(enemy, 80);
          } else if (enemy.cachedMaterials) {
            for (const mat of enemy.cachedMaterials) {
              const origEmissive = mat.emissive.getHex();
              mat.emissive.setHex(0xffffff);
              mat.emissiveIntensity = 1.0;
              setTimeout(() => {
                mat.emissive.setHex(origEmissive);
                mat.emissiveIntensity = 0.4;
              }, 80);
            }
          }
        }

        if (!enemy.alive) {
          // Enemy died
          const enemyType = enemy.constructor.name.toLowerCase();
          const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xffffff);
          particles.enemyDeath(enemy.position, color);
          scoreManager.awardKill(enemy.scoreValue, enemyType);
          scorePopups?.spawnScore(enemy.position.clone(), enemy.scoreValue);
          screenShake.shake(0.15, 0.15);
          getSoundEngine().play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });
          onKillLog?.(enemyType, color.getHex());

          // Grid deformation at death position
          surface.applyForce(enemy.position, 0.2, 1.0);

          // Spawn geoms at death position (burst velocity handles scatter)
          const { u, v } = surface.worldToSurface(enemy.position);
          for (let g = 0; g < enemy.geomCount; g++) {
            geomPool.spawn(u, v);
          }

          // Trigger on-death procs (volatile explosions, etc.)
          onEnemyDied?.(enemy, enemies);

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
  bonusRadius = 0,
): void {
  const baseRadius = 0.5 + bonusRadius;
  const pickupRadiusSq = baseRadius * baseRadius; // Squared radius avoids sqrt
  geomPool.forEachActive((index, surfaceU, surfaceV, position) => {
    const distSq = player.mesh.position.distanceToSquared(position);
    if (distSq < pickupRadiusSq) {
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
  onPlayerHit?: () => boolean,
): void {
  if (!player.canTakeDamage) return;

  for (const enemy of enemies) {
    if (!enemy.active) continue;
    // Skip enemies still spawning
    if (enemy.isMaterializing) continue;

    // Use distanceToSquared to avoid sqrt
    const hitRadius = player.mesh.scale.x * 0.3 + enemy.radius;
    const distSq = player.mesh.position.distanceToSquared(enemy.position);
    if (distSq < hitRadius * hitRadius) {
      if (isShielded) {
        // Shield absorbs the hit and kills the enemy
        enemy.takeDamage(999);
        particles.bulletImpact(enemy.position);
        screenShake.shake(0.2, 0.15);
        getSoundEngine().play('shieldHit');
      } else {
        // Try companion shield (protector) before dying
        const saved = onPlayerHit?.() ?? false;
        if (saved) {
          // Companion protector activated - kill the enemy, player survives
          enemy.takeDamage(999);
          particles.bulletImpact(enemy.position);
          screenShake.shake(0.3, 0.2);
          screenFlash('rgba(68, 255, 68, 0.3)', 150);
          break;
        }
        player.die();
        particles.playerDeath(player.mesh.position);
        screenShake.shake(0.5, 0.4);
        getSoundEngine().play('playerDeath');
        screenFlash('rgba(255, 60, 60, 0.4)', 200);
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

  // Load level (-1 = endless Quick Game mode)
  const isEndless = startLevelIndex < 0;
  const levelIndex = isEndless ? -1 : Math.min(startLevelIndex, ADVENTURE_LEVELS.length - 1);
  const level: LevelDefinition = isEndless
    ? {
        id: -1,
        name: 'ENDLESS',
        section: 'quick',
        mode: 'survival' as GameModeType,
        surface: (selectedSurface || 'sphere') as any,
        surfaceScale: 10,
        timeLimit: 0,
        lives: 3,
        bombs: 3,
        supers: 0,
        starThresholds: [0, 0, 0] as [number, number, number],
        waves: [
          { delay: 2, enemies: [{ type: 'grunt', count: 4 }] },
          { delay: 6, enemies: [{ type: 'wanderer', count: 3 }] },
          { delay: 12, enemies: [{ type: 'duck', count: 3 }, { type: 'grunt', count: 4 }] },
        ],
      }
    : ADVENTURE_LEVELS[levelIndex];

  // -- Game engine --
  // Bloom: high threshold so only bright entities glow, not the grid
  const game = new Game({
    bloom: {
      strength: 0.7,
      radius: 0.5,
      threshold: 0.6,
    },
    cameraDistance: 20,
    cameraSmoothing: 0.05,
  });

  // Disable built-in camera - we control camera to follow player
  game.disableBuiltInCameraUpdate = true;

  // Effects demo panel (press G to toggle)
  new EffectsPanel(game);

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
    gridColor: 0x2a2aaa,
    surfaceColor: 0x141440,
    surfaceOpacity: 0.35,
    gridOpacity: 0.4,
    // Type-specific configs
    radius: level.surfaceScale,           // For sphere, icosahedron, dented-sphere, sphere-tunnel
    size: level.surfaceScale,             // For cube
    bevelRadius: 0.6,                      // For cylinder bevel edges
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

  // -- GPU instanced rendering for enemies (reduces draw calls from ~2000 to ~15) --
  const enemyInstanceManager = new EnemyInstanceManager(game.scene);
  enemySpawner.setInstanceManager(enemyInstanceManager);

  // -- Enemy glow trails (for fast-moving enemies) --
  // Track which enemies have trails and their trail objects
  const enemyGlowTrails = new Map<BaseEnemy, GlowTrail>();

  // Fast enemy types that get glow trails
  const FAST_ENEMY_TYPES = ['Mayfly', 'Rocket', 'Duck'];

  // Colors for different enemy types
  const ENEMY_TRAIL_COLORS: Record<string, number> = {
    Mayfly: 0xddddff,
    Rocket: 0xff8800,
    Duck: 0xff44aa,
  };

  // -- Particle system --
  const particles = new ParticleSystem(5000);
  game.scene.add(particles.root);

  // -- Score popups --
  const scorePopups = new ScorePopupManager();
  game.scene.add(scorePopups.root);
  scorePopups.setCamera(game.camera);

  // -- Minimap --
  const minimap = new Minimap();

  // -- Kill log (bottom-left) + total kill counter (bottom-right) --
  const killLog = new KillLog();
  const totalKillCounter = new TotalKillCounter();
  killLog.onKill = (type, color) => totalKillCounter.addKill(type, color);

  // -- Player leveling system (kill-based progression) --
  const playerLevel = new PlayerLevel();
  game.scene.add(playerLevel.auraRing);
  const levelUpNotification = new LevelUpNotification();

  // -- Buff system (stackable Risk-of-Rain-style buffs) --
  const buffManager = new BuffManager();
  const buffHUD = new BuffHUD();
  const shockArcRenderer = new ShockArcRenderer();
  game.scene.add(shockArcRenderer.root);

  // Wire buff callbacks
  buffManager.onBuffGained = (type, _newStacks) => {
    buffHUD.highlightBuff(type);
  };

  buffManager.onVolatileExplosion = (position, radius, _damage) => {
    particles.bombExplosion(position);
    surface.applyForce(position, 0.3, radius * 0.5);
    screenShake.shake(0.2, 0.15);
  };

  /** Recompute combined multipliers from PlayerLevel + BuffManager */
  function applyStatMultipliers(): void {
    const perk = playerLevel.perk;
    playerWalker.speed = PLAYER_MOVE_SPEED * perk.moveSpeedMultiplier * buffManager.getMoveSpeedMultiplier();
    player.fireRateMultiplier = perk.fireRateMultiplier * buffManager.getFireRateMultiplier();
    bulletPool.speedMultiplier = perk.bulletSpeedMultiplier;
  }

  playerLevel.onLevelUp = (level, perk) => {
    levelUpNotification.show(level, perk);
    getSoundEngine().play('multiplierUp', { pitch: 1.2 + level * 0.05 });
    if (perk.bonusBombs > 0) {
      player.bombs += perk.bonusBombs;
    }
    // Update stat multipliers immediately (combines PlayerLevel + BuffManager)
    applyStatMultipliers();
  };

  // -- Screen shake --
  const screenShake = new ScreenShake();

  // -- Score manager --
  const scoreManager = new ScoreManager();
  scoreManager.setPlayer(player);

  // Combo display
  const comboEl = document.getElementById('combo-display')!;
  scoreManager.onComboChange = (combo: number) => {
    if (combo >= 3) {
      comboEl.textContent = `${combo} COMBO`;
      // Color scales with combo level
      if (combo >= 20) {
        comboEl.style.color = '#ff00ff';
        comboEl.style.textShadow = '0 0 12px #ff00ff';
      } else if (combo >= 10) {
        comboEl.style.color = '#ff4400';
        comboEl.style.textShadow = '0 0 10px #ff4400';
      } else {
        comboEl.style.color = '#ff8800';
        comboEl.style.textShadow = '0 0 8px #ff8800';
      }
      // Pop animation
      comboEl.style.transform = 'scale(1.3)';
      setTimeout(() => { comboEl.style.transform = 'scale(1)'; }, 100);
    } else {
      comboEl.textContent = '';
    }
  };

  // -- Wave scheduler --
  const waveScheduler = new WaveScheduler(level.waves, isEndless);

  // -- Game mode --
  const modeType = level.mode as GameModeType;
  const modeDefaults = MODE_DEFAULTS[modeType] || {};
  const gameMode = new GameMode({
    type: modeType,
    timeLimit: level.timeLimit,
    lives: level.lives,
    bombs: level.bombs,
    supers: level.supers,
    canShoot: modeDefaults.canShoot !== undefined ? modeDefaults.canShoot : true,
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
    }, 200);
  };

  gameMode.onFailed = () => {
    // Failed is handled by the game over flow (lives depleted)
  };

  gameMode.onTimeBonus = (seconds: number) => {
    // Show time bonus popup at player position
    scorePopups.spawn(player.mesh.position.clone(), `+${seconds}s`, '#00ffff', 2.0);
    sound.play('multiplierUp');
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
  weaponManager.setMeshSurface(meshSurface);
  weaponManager.playerPositionRef = playerWalker.position;
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
      const scorePower = scoreManager.getScorePowerMultiplier() * playerLevel.damageMultiplier * buffManager.getDamageMultiplier();
      enemy.takeDamage(damage * scorePower);
      // Trigger on-hit procs (incendiary etc.) with reduced proc coefficient for weapon damage
      if (enemy.alive) {
        buffManager.onBulletHit(enemy, 0.3);
        scorePopups.spawnDamage(enemy.position, damage * scorePower);
      }
      if (!enemy.alive) {
        const enemyType = enemy.constructor.name.toLowerCase();
        const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xffffff);
        particles.enemyDeath(enemy.position, color);
        scoreManager.awardKill(enemy.scoreValue, enemyType);
        screenShake.shake(0.15, 0.15);
        getSoundEngine().play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });
        killLog.addKill(enemyType, color.getHex());
        playerLevel.addKill();

        // Trigger on-death procs (volatile explosions)
        buffManager.onEnemyDeath(enemy, enemySpawner.getEnemies());

        const { u, v } = surface.worldToSurface(enemy.position);
        for (let g = 0; g < enemy.geomCount; g++) {
          geomPool.spawn(u, v);
        }
      }
    },
    spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => {
      const { u, v } = surface.worldToSurface(origin);
      const aimAngle = Math.atan2(direction.x, direction.z);
      bulletPool.spawn(origin, direction, u, v, aimAngle);
    },
  });

  // -- Weapon HUD (inventory display) --
  const weaponHUD = new WeaponHUD();
  weaponHUD.setPosition(10, window.innerHeight / 2 - 60);

  // -- Companion system --
  const companionManager = new CompanionManager();
  game.scene.add(companionManager.root);
  const companionPickups: CompanionPickup[] = [];
  const companionHUD = new CompanionHUD();

  // -- Weapon pickups on the field --
  const weaponPickups: WeaponPickup[] = [];
  const buffPickups: BuffPickup[] = [];
  const newBuffPickups: BuffPickupNew[] = [];

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

  // -- Giant enemy death spawns: break apart into smaller versions --
  GiantWanderer.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const offsetU = (Math.random() - 0.5) * 0.08;
      const offsetV = (Math.random() - 0.5) * 0.08;
      enemySpawner.spawn('wanderer', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };
  GiantRocket.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const offsetU = (Math.random() - 0.5) * 0.08;
      const offsetV = (Math.random() - 0.5) * 0.08;
      enemySpawner.spawn('rocket', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };
  GiantSnake.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const offsetU = (Math.random() - 0.5) * 0.1;
      const offsetV = (Math.random() - 0.5) * 0.1;
      enemySpawner.spawn('snake', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };
  GiantNeutron.onDeathSpawn = (u: number, v: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const offsetU = (Math.random() - 0.5) * 0.08;
      const offsetV = (Math.random() - 0.5) * 0.08;
      enemySpawner.spawn('neutron', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };

  // -- Boss system callbacks --
  Boss.onShieldSpawn = (types: string[], count: number, u: number, v: number) => {
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const offsetU = (Math.random() - 0.5) * 0.3;
      const offsetV = (Math.random() - 0.5) * 0.3;
      enemySpawner.spawn(type as any, Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    }
  };

  const bossBarEl = document.getElementById('boss-health-bar') as HTMLElement | null;
  const bossBarFill = document.getElementById('boss-health-fill') as HTMLElement | null;
  const bossPhaseEl = document.getElementById('boss-phase-text') as HTMLElement | null;

  Boss.onHealthUpdate = (currentHP: number, maxHP: number, phase: number, totalPhases: number) => {
    if (bossBarEl && bossBarFill && bossPhaseEl) {
      if (maxHP <= 0) {
        bossBarEl.style.display = 'none';
        return;
      }
      bossBarEl.style.display = 'block';
      const pct = Math.max(0, Math.min(100, (currentHP / maxHP) * 100));
      bossBarFill.style.width = `${pct}%`;
      bossPhaseEl.textContent = `PHASE ${phase + 1}/${totalPhases}`;
    }
  };

  Boss.onPhaseChange = (_phase: number) => {
    // Add time on phase change for timed levels
    if (level.timeLimit > 0) {
      gameMode.awardTimeBonus(10); // 10 seconds extra per phase
    }
    sound.play('bomb', { volume: 0.8, pitch: 0.5 });
  };

  // -- Virus: spawn new virus at killed enemy position (20% chance) --
  Virus.onInfectKill = (u: number, v: number) => {
    if (Math.random() < 0.2) {
      enemySpawner.spawn('virus', u, v);
    }
  };

  // -- Gate: detonation effect (kills nearby enemies, awards score) --
  Gate.onDetonate = (position: THREE.Vector3, score: number) => {
    // Kill all enemies within blast radius
    const blastRadius = 3.0;
    const gateColor = new THREE.Color(0xff8800);
    const allEnemies = enemySpawner.getEnemies();
    for (const enemy of allEnemies) {
      if (enemy.position.distanceTo(position) < blastRadius) {
        enemy.takeDamage(999);
        particles.enemyDeath(enemy.position, gateColor);
      }
    }
    scoreManager.awardKill(score, 'Gate');
    particles.enemyDeath(position, gateColor);
    screenShake.shake(0.4, 0.3);
    sound.play('bomb', { volume: 0.6, pitch: 1.2 });
    scorePopups.spawnScore(position, score, player.multiplier);
  };

  // -- Respawn timer --
  let respawnTimer = 0;
  const RESPAWN_DELAY = 1.5;

  // -- Player previous UV (for gate pass-through detection) --
  let prevPlayerU = player.surfaceU;
  let prevPlayerV = player.surfaceV;

  // -- Painter trail damage cooldown --
  let painterDamageCooldown = 0;

  // -- Checkpoint wave-clear tracking --
  let lastEnemyCount = 0;
  let hadEnemies = false;

  // -- Camera zoom --
  let cameraDistance = 15;
  const CAMERA_DIST_MIN = 6;
  const CAMERA_DIST_MAX = 35;

  document.addEventListener('wheel', (e) => {
    if (isPaused || isGameOver) return;
    const delta = e.deltaY > 0 ? 1.5 : -1.5;
    cameraDistance = Math.max(CAMERA_DIST_MIN, Math.min(CAMERA_DIST_MAX, cameraDistance + delta));
  }, { passive: true });

  // -- Camera orbit (middle mouse) --
  let orbitYaw = 0;   // radians around surface normal (left/right)
  let orbitPitch = 0;  // radians around tangent (up/down tilt)
  let isOrbitDragging = false;
  let lastOrbitX = 0;
  let lastOrbitY = 0;
  let orbitResetSpeed = 0; // >0 means actively resetting to default
  let lastMiddleClickTime = 0;
  const ORBIT_SENSITIVITY = 0.005;
  const ORBIT_PITCH_MAX = Math.PI * 0.4; // don't go past 72 degrees

  document.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // middle mouse
      e.preventDefault();
      const now = Date.now();
      if (now - lastMiddleClickTime < 350) {
        // Double-click: reset orbit
        orbitResetSpeed = 4.0; // will lerp back to 0,0
      } else {
        isOrbitDragging = true;
        lastOrbitX = e.clientX;
        lastOrbitY = e.clientY;
      }
      lastMiddleClickTime = now;
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
      isOrbitDragging = false;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isOrbitDragging) return;
    const dx = e.clientX - lastOrbitX;
    const dy = e.clientY - lastOrbitY;
    lastOrbitX = e.clientX;
    lastOrbitY = e.clientY;
    orbitYaw += dx * ORBIT_SENSITIVITY;
    orbitPitch = Math.max(-ORBIT_PITCH_MAX, Math.min(ORBIT_PITCH_MAX, orbitPitch - dy * ORBIT_SENSITIVITY));
    orbitResetSpeed = 0; // cancel any active reset if user drags again
  });

  // Prevent middle-click scroll/auto-scroll
  document.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  // -- Game state --
  let isPaused = false;
  let isGameOver = false;

  // -- Pause menu --
  const pauseMenu = new PauseMenu();
  pauseMenu.setMusic(bgMusic);
  pauseMenu.onResume(() => {
    isPaused = false;
    // Force respawn if player died during pause
    if (!player.alive && player.lives > 0) {
      respawnTimer = RESPAWN_DELAY;
    }
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
  const hasNextLevel = !isEndless && levelIndex + 1 < ADVENTURE_LEVELS.length;

  levelCompleteScreen.onNext(() => {
    game.stop();
    bgMusic.stop();
    weaponManager.dispose();
    weaponHUD.dispose();
    companionManager.dispose();
    companionHUD.dispose();
    buffManager.dispose();
    buffHUD.dispose();
    shockArcRenderer.dispose();
    levelCompleteScreen.dispose();
    gameOverScreen.dispose();
    main(selectedSurface, levelIndex + 1);
  });
  levelCompleteScreen.onReplay(() => {
    game.stop();
    bgMusic.stop();
    weaponManager.dispose();
    weaponHUD.dispose();
    companionManager.dispose();
    companionHUD.dispose();
    buffManager.dispose();
    buffHUD.dispose();
    shockArcRenderer.dispose();
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
    // N = cycle music preset
    if (e.key === 'n' || e.key === 'N') {
      const preset = bgMusic.cyclePreset();
      const name = bgMusic.getPresetDisplayName(preset);
      // Brief on-screen notification
      let notify = document.getElementById('music-preset-notify');
      if (!notify) {
        notify = document.createElement('div');
        notify.id = 'music-preset-notify';
        notify.style.cssText =
          'position:fixed;top:80px;left:50%;transform:translateX(-50%);' +
          'color:#00ffff;font-family:"Segoe UI",Arial,sans-serif;font-size:18px;' +
          'letter-spacing:3px;text-shadow:0 0 8px #00ffff;z-index:3000;' +
          'pointer-events:none;transition:opacity 0.5s;';
        document.body.appendChild(notify);
      }
      notify.textContent = `MUSIC: ${name.toUpperCase()}`;
      notify.style.opacity = '1';
      setTimeout(() => { if (notify) notify.style.opacity = '0'; }, 1500);
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

    // Update timer display for timed modes / elapsed time for endless
    if (level.timeLimit > 0) {
      const secs = Math.ceil(Math.max(0, gameMode.timeRemaining));
      const mins = Math.floor(secs / 60);
      const remainingSecs = secs % 60;
      timerEl.textContent = `${mins}:${String(remainingSecs).padStart(2, '0')}`;
      timerEl.classList.toggle('urgent', secs <= 10);
    } else if (isEndless) {
      const elapsed = Math.floor(waveScheduler.getElapsed());
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
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
      // Weapon swap (E key)
      if (inputState.weaponSwap) {
        weaponManager.cycleWeapon();
        sound.play('weaponPickup', { volume: 0.4, pitch: 1.2 });
      }

      // Store previous UV for gate pass-through detection
      prevPlayerU = player.surfaceU;
      prevPlayerV = player.surfaceV;

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
      const frame = playerWalker.getTangentFrame();

      // Orbit reset: lerp yaw/pitch back to 0 when double-click triggered
      if (orbitResetSpeed > 0) {
        const resetRate = orbitResetSpeed * dt;
        orbitYaw *= Math.max(0, 1 - resetRate * 3);
        orbitPitch *= Math.max(0, 1 - resetRate * 3);
        if (Math.abs(orbitYaw) < 0.005 && Math.abs(orbitPitch) < 0.005) {
          orbitYaw = 0;
          orbitPitch = 0;
          orbitResetSpeed = 0;
        }
      }

      // Camera follows player along surface normal with orbit rotation
      const CAMERA_LERP_FACTOR = 0.12;

      // Build camera offset: start with surface normal, rotate by orbit angles
      // Rotation is relative to the tangent frame (tangent, bitangent, normal)
      let camOffset = playerNormal.clone().multiplyScalar(cameraDistance);
      let camUp = frame.bitangent.clone();

      if (Math.abs(orbitYaw) > 0.001 || Math.abs(orbitPitch) > 0.001) {
        // Rotate around normal (yaw - left/right swing)
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(playerNormal, orbitYaw);
        camOffset.applyQuaternion(yawQuat);
        camUp.applyQuaternion(yawQuat);

        // Rotate around the rotated tangent (pitch - tilt up/down)
        const rotatedTangent = frame.tangent.clone().applyQuaternion(yawQuat);
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(rotatedTangent, orbitPitch);
        camOffset.applyQuaternion(pitchQuat);
        camUp.applyQuaternion(pitchQuat);
      }

      const targetCamPos = playerWalker.position.clone().add(camOffset);
      game.camera.position.lerp(targetCamPos, CAMERA_LERP_FACTOR);
      game.camera.lookAt(playerWalker.position);

      // Smooth camera up (orbited up vector)
      game.camera.up.lerp(camUp, CAMERA_LERP_FACTOR).normalize();

      // Calculate aim from mouse in screen space using tangent frame.
      // The camera looks along the surface normal with up = bitangent,
      // so screen right = tangent, screen up = bitangent.
      // Mouse aimX: -1 left, +1 right.  aimY: -1 top, +1 bottom (screen coords).
      const aimX = inputState.aimX;
      const aimY = inputState.aimY;
      const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);

      let aimDirection: THREE.Vector3;
      if (aimLen > 0.1) {
        // Map screen aim to tangent frame
        // tangent = screen right, bitangent = screen up
        // Negate aimY because mouse Y increases downward but bitangent points up
        aimDirection = new THREE.Vector3()
          .addScaledVector(frame.tangent, aimX)
          .addScaledVector(frame.bitangent, -aimY)
          .normalize();
      } else {
        // Default: face along bitangent (screen up direction)
        aimDirection = frame.bitangent.clone();
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
      // Pacifism mode: no shooting allowed
      const effectiveInput = !gameMode.config.canShoot
        ? { ...inputState, shooting: false }
        : inputState;
      player.update(dt, effectiveInput);
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

    // Update GPU-instanced enemy rendering (reads mesh matrices from updated enemies)
    enemyInstanceManager.updateInstances(enemySpawner.getEnemies());

    // Update bullets
    bulletPool.update(dt);

    // Update geoms
    geomPool.update(dt, player.surfaceU, player.surfaceV, game.clock.totalTime);

    // Update particles and score popups
    particles.update(dt);
    scorePopups.update(dt);
    scoreManager.updateCombo(dt);
    killLog.update(dt);

    // Update player glow trail (add point at player position)
    if (player.alive) {
      playerGlowTrail.addPoint(player.mesh.position.clone());
    }
    playerGlowTrail.update(dt);

    // Update entity glows
    glowManager.update(dt);
    playerGlow.update(dt);

    // Update player level aura ring
    if (player.alive) {
      playerLevel.update(dt, playerWalker.position, playerWalker.normal);
    }

    // Update buff system (shock aura, burning DOT, stat refresh)
    if (player.alive) {
      buffManager.update(dt, playerWalker.position, enemySpawner.getEnemies());
      shockArcRenderer.update(buffManager.shockArcs);
      // Refresh stat multipliers each frame (buffs can change any time)
      applyStatMultipliers();
    }

    // Update new buff pickups
    for (let i = newBuffPickups.length - 1; i >= 0; i--) {
      const nbp = newBuffPickups[i];
      if (!nbp.active) {
        game.scene.remove(nbp.mesh);
        nbp.dispose();
        newBuffPickups.splice(i, 1);
        continue;
      }
      nbp.update(dt, game.clock.totalTime);
      nbp.applySurfaceTransform(getTransform);

      // Check player collision with new buff pickup
      if (player.alive && nbp.checkPlayerCollision(player.surfaceU, player.surfaceV)) {
        buffManager.addBuff(nbp.buffType);
        scorePopups.spawn(
          player.mesh.position.clone(),
          `+${BUFF_DEFINITIONS[nbp.buffType].name}`,
          '#' + BUFF_DEFINITIONS[nbp.buffType].iconColor.toString(16).padStart(6, '0'),
          1.5,
        );
        nbp.active = false;
      }
    }

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

    // Update companions
    if (player.alive) {
      const aimDir = player.getAimDirection();
      companionManager.update(
        dt,
        player.surfaceU,
        player.surfaceV,
        playerWalker.position,
        aimDir,
        enemySpawner.getEnemies().filter(e => e.alive),
        bulletPool,
        0, // ownerId = P1
        playerWalker.normal,
        getTransform,
      );
    }

    // Update companion pickups
    for (let i = companionPickups.length - 1; i >= 0; i--) {
      const cp = companionPickups[i];
      if (!cp.active) {
        game.scene.remove(cp.mesh);
        cp.dispose();
        companionPickups.splice(i, 1);
        continue;
      }
      cp.update(dt, game.clock.totalTime);
      cp.applySurfaceTransform(getTransform);

      // Check player collision with companion pickup
      if (player.alive && cp.checkPlayerCollision(player.surfaceU, player.surfaceV)) {
        companionManager.addCompanion(cp.companionType);
        sound.play('weaponPickup', { volume: 0.5, pitch: 1.8 });
        cp.active = false;
      }
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
        // ~5% chance to spawn a buff pickup on enemy death (old weapon-buff system)
        if (Math.random() < 0.05) {
          const bType = getRandomBuffType();
          const bPickup = new BuffPickup(bType, u, v);
          game.scene.add(bPickup.mesh);
          buffPickups.push(bPickup);
        }
        // Roll for new stackable buff pickup drop
        const droppedBuff = BuffManager.rollBuffDrop();
        if (droppedBuff) {
          const nbPickup = new BuffPickupNew(droppedBuff, u, v);
          game.scene.add(nbPickup.mesh);
          newBuffPickups.push(nbPickup);
        }
        // ~5% chance to spawn a companion pickup on enemy death
        if (Math.random() < 0.05) {
          const cType = getRandomCompanionType();
          const cPickup = new CompanionPickup(cType, u, v);
          game.scene.add(cPickup.mesh);
          companionPickups.push(cPickup);
        }
      },
      scorePopups,
      scoreManager.getScorePowerMultiplier() * playerLevel.damageMultiplier * buffManager.getDamageMultiplier(),
      (type: string, color: number) => { killLog.addKill(type, color); playerLevel.addKill(); },
      true, // showDamageNumbers
      (enemy: BaseEnemy) => { buffManager.onBulletHit(enemy); },
      (enemy: BaseEnemy, allEnemies: BaseEnemy[]) => { buffManager.onEnemyDeath(enemy, allEnemies); },
      enemyInstanceManager,
    );

    // Player vs geoms (magnetism buff expands pickup radius)
    checkGeomPickups(player, geomPool, scoreManager, particles, buffManager.getCollectionRadiusBonus());

    // Player vs enemies (immune if shielded OR tesla coil active OR companion shield active)
    const fireModifiers = superStateManager.getFireModifiers();
    const isImmune = fireModifiers.isShielded || weaponManager.isTeslaActive() || companionManager.isShieldActive();
    checkPlayerEnemyCollisions(
      player, enemies, particles, screenShake, isImmune,
      () => {
        // Try Tough Times block first
        if (buffManager.onPlayerHit()) {
          screenFlash('rgba(68, 136, 255, 0.3)', 100);
          return true; // Blocked by Tough Times
        }
        // Then try companion protector
        return companionManager.onPlayerHit();
      },
    );

    // Gate pass-through detection (Pacifism mode mechanic)
    if (player.alive && player.canTakeDamage) {
      for (const enemy of enemies) {
        if (enemy instanceof Gate && enemy.active) {
          enemy.checkPlayerPassThrough(
            player.surfaceU, player.surfaceV,
            prevPlayerU, prevPlayerV
          );
        }
      }
    }

    // Painter trail damage (hazard zones)
    if (painterDamageCooldown > 0) painterDamageCooldown -= dt;
    if (player.alive && player.canTakeDamage && painterDamageCooldown <= 0) {
      for (const enemy of enemies) {
        if (enemy instanceof Painter && enemy.active) {
          if (enemy.isOnTrail(player.surfaceU, player.surfaceV)) {
            if (!fireModifiers.isShielded && !companionManager.isShieldActive()) {
              // Try companion protector shield before dying
              const saved = companionManager.onPlayerHit();
              if (!saved) {
                player.die();
                particles.playerDeath(player.mesh.position);
                screenShake.shake(0.5, 0.4);
                getSoundEngine().play('playerDeath');
                screenFlash('rgba(255, 60, 60, 0.4)', 200);
              } else {
                screenFlash('rgba(68, 255, 68, 0.3)', 150);
              }
            }
            painterDamageCooldown = 0.5; // brief cooldown
            break;
          }
        }
      }
    }

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

    // Update buff pickups
    for (let i = buffPickups.length - 1; i >= 0; i--) {
      const bp = buffPickups[i];
      if (!bp.active) {
        game.scene.remove(bp.mesh);
        bp.dispose();
        buffPickups.splice(i, 1);
        continue;
      }
      bp.update(dt, game.clock.totalTime);
      bp.applySurfaceTransform(getTransform);

      // Check player collision with buff pickup
      if (player.alive && bp.checkPlayerCollision(player.surfaceU, player.surfaceV)) {
        weaponManager.applyBuff(bp.buffType);
        sound.play('weaponPickup', { volume: 0.3, pitch: 1.5 });
        bp.active = false;
      }
    }

    // Update grid deformation springs
    surface.updateGrid(dt);

    // Scale music intensity with enemy count
    const enemyCount = enemySpawner.getActiveCount();
    bgMusic.setIntensity(Math.min(enemyCount / 30, 1.0));

    // Checkpoint mode: detect wave clears (enemies went from >0 to 0)
    if (modeType === GameModeType.Checkpoint && gameMode.phase === ModePhase.Playing) {
      if (hadEnemies && enemyCount === 0 && lastEnemyCount > 0) {
        gameMode.waveClear();
      }
      if (enemyCount > 0) hadEnemies = true;
    }
    lastEnemyCount = enemyCount;

    // Check level completion: all waves spawned + no enemies alive (works for timed and non-timed)
    if (!isLevelComplete && !isGameOver
        && waveScheduler.allSpawned
        && enemyCount === 0
        && gameMode.phase === ModePhase.Playing) {
      gameMode.completeLevel(player.score);
    }

    // Clear per-frame input flags
    input.endFrame();
  };

  // -- Tunnel transparency: fade surface when it blocks camera-to-player view --
  const tunnelRaycaster = new THREE.Raycaster();
  let currentSurfaceOpacity = surfaceConfig.surfaceOpacity;
  let currentGridOpacity = surfaceConfig.gridOpacity;
  const baseSurfaceOpacity = surfaceConfig.surfaceOpacity;
  const baseGridOpacity = surfaceConfig.gridOpacity;
  const fadeSpeed = 8.0; // opacity change per second (smooth fade, not too fast)
  let isCurrentlyBlocked = false; // track blocking state for enemy fade
  let lastRenderTime = performance.now();

  // Pre-allocated temp vectors for render loop (avoids ~5 clone() per enemy per frame)
  const _renderTempToPlayer = new THREE.Vector3();
  const _renderTempToPlayerDir = new THREE.Vector3();
  const _renderTempApproxNormal = new THREE.Vector3();
  const _renderTempToEnemy = new THREE.Vector3();

  // -- Render callback --
  game.onRender = (_alpha: number) => {
    // Project bullets and geoms onto surface
    bulletPool.applySurfaceProjection(getTransform);
    geomPool.applySurfaceProjection(getTransform);

    // Tunnel transparency: check if surface blocks camera-to-player view
    // Uses pre-allocated vectors instead of clone()
    const camPos = game.camera.position;
    const playerPos = player.mesh.position;
    _renderTempToPlayer.copy(playerPos).sub(camPos);
    const distToPlayer = _renderTempToPlayer.length();
    _renderTempToPlayerDir.copy(_renderTempToPlayer).normalize();
    tunnelRaycaster.set(camPos, _renderTempToPlayerDir);
    tunnelRaycaster.far = distToPlayer;
    const hits = tunnelRaycaster.intersectObject(surface.mesh, false);
    // If there are intersections between camera and player, fade surface
    isCurrentlyBlocked = hits.length > 0;
    const targetSurfaceOpacity = isCurrentlyBlocked ? baseSurfaceOpacity * 0.05 : baseSurfaceOpacity;
    const targetGridOpacity = isCurrentlyBlocked ? baseGridOpacity * 0.08 : baseGridOpacity;
    // Use actual frame delta for smooth opacity transitions on all refresh rates
    const now = performance.now();
    const frameDt = Math.min((now - lastRenderTime) / 1000, 0.1); // cap at 100ms to avoid huge jumps
    lastRenderTime = now;
    currentSurfaceOpacity += (targetSurfaceOpacity - currentSurfaceOpacity) * Math.min(1, fadeSpeed * frameDt);
    currentGridOpacity += (targetGridOpacity - currentGridOpacity) * Math.min(1, fadeSpeed * frameDt);
    const surfMat = surface.mesh.material as THREE.MeshBasicMaterial;
    surfMat.opacity = currentSurfaceOpacity;
    const gridMat = surface.gridMesh.material as THREE.LineBasicMaterial;
    gridMat.opacity = currentGridOpacity;

    // Depth-based opacity + tunnel-blocking opacity for enemies
    // Cache meshCenter per frame (doesn't change within a frame)
    const meshCenter = meshSurface.getCenter();
    for (const enemy of enemySpawner.getEnemies()) {
      if (!enemy.alive || !enemy.mesh) continue;
      // Approximate outward normal using pre-allocated vector
      _renderTempApproxNormal.copy(enemy.position).sub(meshCenter).normalize();
      let visibility = meshSurface.getVisibility(enemy.position, _renderTempApproxNormal, camPos);

      // When surface is blocking camera-to-player, also fade enemies between camera and player
      if (isCurrentlyBlocked) {
        _renderTempToEnemy.copy(enemy.position).sub(camPos);
        const enemyDist = _renderTempToEnemy.length();
        // Check if enemy is between camera and player (closer than player)
        if (enemyDist < distToPlayer) {
          // Check if enemy is roughly along the camera-to-player line
          _renderTempToEnemy.normalize();
          const alignment = _renderTempToPlayerDir.dot(_renderTempToEnemy);
          // If enemy is within ~45 degrees of the camera-to-player line, fade it
          if (alignment > 0.7) {
            const fadeFactor = (alignment - 0.7) / 0.3;
            const tunnelEnemyOpacity = 0.12;
            const tunnelVisibility = 1.0 - fadeFactor * (1.0 - tunnelEnemyOpacity);
            visibility = Math.min(visibility, tunnelVisibility);
          }
        }
      }

      // Instanced enemies: use instanceColor for visibility (tint modulation)
      if (enemy.isInstanced) {
        enemyInstanceManager.setInstanceVisibility(enemy, visibility);
        continue;
      }

      // Non-instanced: use cached materials instead of traverse()
      if (enemy.cachedMaterials) {
        for (const mat of enemy.cachedMaterials) {
          (mat as any).transparent = true;
          (mat as any).opacity = visibility;
        }
      } else {
        // Fallback for enemies without cached materials yet
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
    }
    // Flush all instanced color changes for this frame
    enemyInstanceManager.flushColors();

    // Apply screen shake to camera
    if (screenShake.offset.lengthSq() > 0.0001) {
      game.camera.position.add(screenShake.offset);
    }

    // Update HUD
    updateUI(player, weaponManager);

    // Update weapon inventory HUD
    weaponHUD.update(weaponManager.getInventory(), weaponManager.getCurrentWeapon());

    // Update companion HUD
    companionHUD.update(companionManager.getCompanionCounts());

    // Update buff HUD
    buffHUD.update(buffManager.getActiveBuffs());

    // Update level display in HUD
    if (playerLevel.level > 0) {
      const perk = playerLevel.perk;
      const hexColor = perk.auraColor.toString(16).padStart(6, '0');
      playerLevelEl.textContent = `LV${playerLevel.level} ${perk.name}`;
      playerLevelEl.style.color = `#${hexColor}`;
      playerLevelEl.style.textShadow = `0 0 8px #${hexColor}`;
    } else {
      const killsNeeded = playerLevel.killsToNextLevel;
      playerLevelEl.textContent = killsNeeded > 0 ? `${killsNeeded} kills to LV1` : '';
    }

    // Update minimap
    const minimapEnemies = enemySpawner.getEnemies()
      .filter(e => e.mesh && !e.isMaterializing)
      .map(e => ({ u: e.surfacePosition.u, v: e.surfacePosition.v, alive: e.alive }));
    const minimapGeoms: Array<{ u: number; v: number }> = [];
    geomPool.forEachActive((_i, u, v) => { minimapGeoms.push({ u, v }); });
    minimap.update(player.surfaceU, player.surfaceV, minimapEnemies, minimapGeoms);
  };

  // -- Weapon fire handler: delegates all firing to WeaponManager --
  player.weaponFireHandler = (origin: THREE.Vector3, direction: THREE.Vector3) => {
    const gameTime = game.clock.totalTime;
    const fired = weaponManager.fire(origin, direction, gameTime, playerWalker.normal);
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
    screenFlash('rgba(255, 255, 255, 0.6)', 120);

    // Kill all enemies on screen (bombs award no points)
    const enemies = enemySpawner.getEnemies();
    for (const enemy of enemies) {
      if (enemy.active) {
        const enemyType = enemy.constructor.name.toLowerCase();
        const color = ENEMY_COLORS[enemyType] ?? new THREE.Color(0xffffff);
        particles.enemyDeath(enemy.position, color);
        killLog.addKill(enemyType, color.getHex());
        playerLevel.addKill();

        // Spawn geoms (bombs still drop geoms)
        const { u, v } = surface.worldToSurface(enemy.position);
        for (let g = 0; g < enemy.geomCount; g++) {
          geomPool.spawn(u, v);
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
function isBenchmarkMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'benchmark';
}

if (isBenchmarkMode()) {
  import('./benchmark').then(({ runBenchmark }) => {
    console.log('[Main] Running performance benchmark');
    runBenchmark();
  });
} else if (isMultiplayerMode()) {
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
    startMenu.dispose();

    // Handle game mode selection
    if (selection.gameMode === 'multiplayer') {
      // Local co-op - update URL and load multiplayer module
      const pc = selection.playerCount ?? 2;
      window.history.replaceState({}, '', `?mode=multiplayer&surface=${selection.surfaceType}&players=${pc}`);
      import('./multiplayer-main').then(() => {
        console.log('[Main] Loaded local multiplayer mode');
      });
    } else if (selection.gameMode === 'network') {
      // Online/LAN multiplayer - update URL and load network module
      const serverParam = selection.serverUrl ? `&server=${encodeURIComponent(selection.serverUrl)}` : '';
      window.history.replaceState({}, '', `?mode=network&surface=${selection.surfaceType}${serverParam}`);
      import('./network-main').then(() => {
        console.log('[Main] Loaded network multiplayer mode');
      });
    } else {
      // Single player - Quick Game (endless) or Adventure level
      const levelIdx = selection.levelIndex ?? -1; // -1 = endless Quick Game
      window.history.replaceState({}, '', `?surface=${selection.surfaceType}&level=${levelIdx}`);
      main(selection.surfaceType, levelIdx);
    }
  });
}
