/**
 * GameInstance — Universal game orchestrator for all game modes.
 *
 * Consolidates the old PlaygroundGame (removed) + GameLoop.ts into a single reusable class.
 * Prevents the "invisible fixes" problem where changes to one code path don't
 * apply to another (Session 19 failure).
 *
 * Usage:
 *   // Simple demo
 *   const game = new GameInstance({
 *     container: myDiv,
 *     surface: 'sphere',
 *     mode: 'demo'
 *   });
 *
 *   // Full game
 *   const game = new GameInstance({
 *     container: document.body,
 *     surface: 'pill',
 *     mode: 'adventure',
 *     features: { dda: true, buffs: true, companions: true }
 *   });
 *
 * WHY THIS EXISTS:
 * Previously, main.ts and the old PlaygroundGame (removed) had separate implementations of
 * player movement, camera control, and game loop logic. Fixes to one didn't
 * apply to the other. GameInstance consolidates both into a single source of truth.
 *
 * ARCHITECTURE:
 * - Core engine: Game (Three.js scene/camera/renderer)
 * - Core systems: Player, enemies, bullets, weapons (always present)
 * - Optional systems: DDA, buffs, companions (config-driven)
 * - UI systems: Menus, HUD (created externally, wire to GameInstance subsystems)
 */

import * as THREE from 'three';
import { Game } from './Game';
import { Player } from '../entities/Player';
import { BulletPool } from '../entities/Bullet';
import { EnemySpawner, EnemyType } from '../entities/enemies/EnemySpawner';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';
import { WeaponManager } from '../weapons/WeaponManager';
import { WeaponType } from '../weapons/WeaponTypes';
import { ParticleSystem } from '../effects/ParticleSystem';
import { InputManager, InputState } from '../input/InputManager';
import { DepthOcclusionSystem } from '../rendering/DepthOpacity';
import { CameraController } from './CameraController';
import { MapSize, getMapSizeScaleFactor } from './MapSize';
import { loadGraphicsSettings } from '../ui/SettingsMenu';

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export type GameMode = 'demo' | 'single-player' | 'lan' | 'adventure';

export interface GameInstanceFeatures {
  /** Dynamic Difficulty Adjustment system */
  dda?: boolean;
  /** Stackable buff system */
  buffs?: boolean;
  /** Surface companion agents */
  companions?: boolean;
  /** Level-of-detail rendering */
  lod?: boolean;
  /** Adaptive quality management */
  adaptiveQuality?: boolean;
  /** Performance tracking */
  perfTracking?: boolean;
}

export interface GameInstanceConfig {
  /** DOM element to render into */
  container: HTMLElement;
  /** Width in pixels (defaults to container clientWidth or 400) */
  width?: number;
  /** Height in pixels (defaults to container clientHeight or 300) */
  height?: number;
  /** Surface type to play on */
  surface?: SurfaceType;
  /** Game mode (determines which systems are active) */
  mode?: GameMode;
  /** Optional feature flags */
  features?: GameInstanceFeatures;
  /** Surface scale (radius/size) */
  surfaceScale?: number;
  /** Bloom config overrides */
  bloom?: Partial<{ strength: number; radius: number; threshold: number }>;
  /** Camera distance from player */
  cameraDistance?: number;
  /** Player lives (0 = infinite) */
  lives?: number;
  /** Lock the player to this weapon (null = free weapon swaps) */
  lockedWeapon?: WeaponType | null;
  /** Enemy types to use (demo mode only, defaults to basic mix) */
  enemyTypes?: EnemyType[];
  /** Number of enemies to maintain on-screen (demo mode only) */
  enemyCount?: number;
  /** Callback when player dies (all lives lost) */
  onGameOver?: () => void;
  /** Callback when enemy is killed */
  onEnemyKill?: (enemyType: string) => void;
  /** Grid segment counts for surface appearance (demo mode) */
  gridSegmentsU?: number;
  /** Grid segment counts for surface appearance (demo mode) */
  gridSegmentsV?: number;
  /** Map size tier — scales bullet range proportionally (SMALL < MEDIUM < LARGE < EPIC). */
  mapSize?: MapSize;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_MOVE_SPEED = 3.0;
const RESPAWN_DELAY = 1.5;
const DEFAULT_ENEMY_TYPES: EnemyType[] = ['grunt', 'wanderer', 'duck', 'weaver', 'spinner', 'rocket'];

// ---------------------------------------------------------------------------
// GameInstance
// ---------------------------------------------------------------------------

export class GameInstance {
  // Core engine
  readonly game: Game;

  // Core game systems (always present)
  readonly player: Player;
  readonly bulletPool: BulletPool;
  readonly enemySpawner: EnemySpawner;
  readonly weaponManager: WeaponManager;
  readonly particles: ParticleSystem;
  readonly input: InputManager;
  readonly depthOcclusion: DepthOcclusionSystem;
  readonly cameraController: CameraController;

  // Surface state (can change with setSurface)
  private _surface: Surface;
  private _meshSurface: MeshSurface;
  private _walker: MeshWalker;
  private _surfaceType: SurfaceType;

  get surface(): Surface { return this._surface; }
  get meshSurface(): MeshSurface { return this._meshSurface; }

  private config: Required<Omit<GameInstanceConfig, 'features' | 'lockedWeapon' | 'enemyTypes' | 'enemyCount' | 'onGameOver' | 'onEnemyKill' | 'gridSegmentsU' | 'gridSegmentsV' | 'mapSize'>> & {
    features: GameInstanceFeatures;
    lockedWeapon: WeaponType | null;
    enemyTypes: EnemyType[];
    enemyCount: number;
    onGameOver: () => void;
    onEnemyKill: (enemyType: string) => void;
    gridSegmentsU: number | undefined;
    gridSegmentsV: number | undefined;
  };

  private respawnTimer = 0;
  private disposed = false;
  private started = false;

  // Pre-allocated temp vectors (zero-GC pattern from main game)
  private readonly _tmpVec = new THREE.Vector3();
  private readonly _tmpDir = new THREE.Vector3();
  private readonly _tmpRight = new THREE.Vector3();
  private readonly _tmpQuat = new THREE.Quaternion();
  private readonly _tmpCamRight = new THREE.Vector3();
  private readonly _tmpCamUp = new THREE.Vector3();

  constructor(userConfig: GameInstanceConfig) {
    // Normalize config with defaults
    this.config = {
      container: userConfig.container,
      width: userConfig.width ?? (userConfig.container.clientWidth || 400),
      height: userConfig.height ?? (userConfig.container.clientHeight || 300),
      surface: userConfig.surface ?? 'sphere',
      mode: userConfig.mode ?? 'demo',
      features: userConfig.features ?? {},
      surfaceScale: userConfig.surfaceScale ?? 10,
      bloom: userConfig.bloom ?? { strength: 0.7, radius: 0.5, threshold: 0.6 },
      cameraDistance: userConfig.cameraDistance ?? 20,
      lives: userConfig.lives ?? 3,
      lockedWeapon: userConfig.lockedWeapon ?? null,
      enemyTypes: userConfig.enemyTypes ?? DEFAULT_ENEMY_TYPES,
      enemyCount: userConfig.enemyCount ?? 8,
      onGameOver: userConfig.onGameOver ?? (() => {}),
      onEnemyKill: userConfig.onEnemyKill ?? (() => {}),
      gridSegmentsU: userConfig.gridSegmentsU,
      gridSegmentsV: userConfig.gridSegmentsV,
    };

    const cfg = this.config;

    // -- Game engine (real Game class, same as single-player) --
    this.game = new Game({
      container: cfg.container,
      bloom: cfg.bloom,
      cameraDistance: cfg.cameraDistance,
      cameraSmoothing: 0.05,
    });
    this.game.renderer.setSize(cfg.width, cfg.height);
    this.game.camera.aspect = cfg.width / cfg.height;
    this.game.camera.updateProjectionMatrix();
    this.game.disableBuiltInCameraUpdate = true;
    this.game.disableBuiltInResize = true;

    // -- Lighting (same as main game) --
    this.game.scene.add(new THREE.AmbientLight(0x404080, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    this.game.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x4488ff, 0.4);
    fill.position.set(-5, -5, -5);
    this.game.scene.add(fill);

    // -- Surface --
    this._surfaceType = cfg.surface;
    this._surface = this.createSurface(cfg.surface, cfg.surfaceScale);
    this.game.scene.add(this._surface.group);
    this._surface.group.updateMatrixWorld(true);
    this._meshSurface = new MeshSurface(this._surface.walkableMesh);

    // Apply surface opacity setting from user preferences
    const graphicsSettings = loadGraphicsSettings();
    const surfaceOpacity = graphicsSettings.surfaceOpaque ? 1.0 : 0.18;
    this._surface.setSurfaceOpacity(surfaceOpacity);

    // -- Input (container-aware for correct mouse aim in embedded playgrounds) --
    this.input = new InputManager();
    this.input.setContainer(cfg.container);

    // -- Bullet pool (real BulletPool, same projectile physics) --
    this.bulletPool = new BulletPool();
    this.game.scene.add(this.bulletPool.root);
    this.bulletPool.setMeshSurface(this._meshSurface);
    if (userConfig.mapSize) {
      this.bulletPool.lifetimeMultiplier = getMapSizeScaleFactor(userConfig.mapSize);
    }
    this.wireBulletPool();

    // -- Player (real Player class, same ship, same fire rate) --
    this.player = new Player(this.bulletPool);
    this.player.respawn(0.5, 0.5);
    this.player.lives = cfg.lives || 99;
    this.game.scene.add(this.player.mesh);
    this.game.cameraTarget = this.player.mesh;

    // -- MeshWalker (real geodesic movement, same as single-player) --
    const startPoint = this._surface.getPoint(0.5, 0.5);
    this._walker = new MeshWalker(this._meshSurface, startPoint.position, PLAYER_MOVE_SPEED);
    this.player.mesh.position.copy(this._walker.position);

    // -- Camera Controller (handles orbit, zoom, positioning) --
    this.cameraController = new CameraController(this.game.camera);

    // -- Immediately position camera above player (avoid slow lerp convergence) --
    // REGRESSION GUARD: camera.up MUST be bitangent, NOT normal.
    // Normal is parallel to the look direction (camera looks down at player along normal),
    // which causes degenerate lookAt() and spinning. See decisions/playground-spinning-fix.md.
    {
      const startNormal = this._walker.normal;
      const startPos = this._walker.position;
      const startFrame = this._walker.getTangentFrame();
      const idealCamPos = startNormal.clone().multiplyScalar(cfg.cameraDistance).add(startPos);
      this.game.camera.position.copy(idealCamPos);
      this.game.camera.up.copy(startFrame.bitangent);
      this.game.camera.lookAt(startPos);
    }

    // -- Weapon manager (wired to player + bulletPool like main.ts) --
    this.weaponManager = new WeaponManager();
    this.weaponManager.setMeshSurface(this._meshSurface);
    this.weaponManager.playerPositionRef = this._walker.position;
    this.game.scene.add(this.weaponManager.getVisualRoot());
    this.wireWeaponManager();

    // -- Enemy spawner --
    const surfaceTransform = (u: number, v: number) => {
      const pt = this._surface.getPoint(u, v);
      return {
        position: pt.position,
        normal: pt.normal,
        tangent: pt.tangentU,
        bitangent: pt.tangentV,
      };
    };
    this.enemySpawner = new EnemySpawner(this.game.scene, surfaceTransform);
    this.enemySpawner.setMeshSurface(this._meshSurface);
    this.enemySpawner.setSurface(this._surface);

    // -- Particle system --
    this.particles = new ParticleSystem(5000);
    this.game.scene.add(this.particles.root);

    // -- Depth occlusion (raycast-based opacity for enemies behind walls) --
    this.depthOcclusion = new DepthOcclusionSystem({
      opacity0: 1.0,
      opacity1: 0.12,
      opacity2Plus: 0.04,
      lerpSpeed: 10.0,
    });
    this.depthOcclusion.setSurfaceMesh(this._surface.mesh);

    // -- Wire player callbacks --
    this.wirePlayerCallbacks();

    // -- Demo mode: spawn initial enemies --
    if (cfg.mode === 'demo') {
      this.spawnDemoEnemies();
    }
  }

  private createSurface(type: SurfaceType, scale: number): Surface {
    const cfg = this.config;
    return SurfaceFactory.create(type, {
      gridColor: 0x2a2aaa,
      surfaceColor: 0x141440,
      surfaceOpacity: 0.18,
      gridOpacity: 0.3,
      radius: scale,
      size: scale,
      height: scale * 2,
      majorRadius: scale * 0.8,
      minorRadius: scale * 0.3,
      ...(cfg.gridSegmentsU !== undefined ? { gridSegmentsU: cfg.gridSegmentsU } : {}),
      ...(cfg.gridSegmentsV !== undefined ? { gridSegmentsV: cfg.gridSegmentsV } : {}),
    } as any);
  }

  private wireBulletPool(): void {
    this.bulletPool.setSurfaceFunctions(
      (u: number, v: number) => {
        const pt = this._surface.getPoint(u, v);
        return {
          position: pt.position,
          normal: pt.normal,
          tangent: pt.tangentU,
          bitangent: pt.tangentV,
        };
      },
      (u: number, v: number, du: number, dv: number) => this._surface.moveOnSurface(u, v, du, dv)
    );
  }

  private wireWeaponManager(): void {
    this.weaponManager.setCallbacks({
      getEnemies: () => {
        return this.enemySpawner.getEnemies()
          .filter(e => e.alive && e.mesh && !e.isMaterializing)
          .map((e, i) => ({
            // Use e.position (surface center, world space) not e.mesh.position (above surface).
            // WeaponManager projectiles are projected onto the surface, so comparing against
            // mesh.position (offset by enemy.radius above surface) causes misses.
            position: e.position.clone(),
            index: i,
            alive: e.alive,
          }));
      },
      onEnemyDamage: (index: number, damage: number) => {
        // Must use same filter as getEnemies so indices match.
        const enemies = this.enemySpawner.getEnemies().filter(e => e.alive && e.mesh && !e.isMaterializing);
        const enemy = enemies[index];
        if (enemy) {
          enemy.takeDamage(damage);
          if (!enemy.alive) {
            this.particles.enemyDeath(enemy.mesh!.position, new THREE.Color(0xff4444));
            this.config.onEnemyKill(enemy.baseTypeName || 'unknown');
          }
        }
      },
      spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => {
        const inverseRot = this._surface.worldRotation.clone().invert();
        const localPos = origin.clone().applyQuaternion(inverseRot);
        const { u, v } = this._surface.worldToSurface(localPos);
        const aimAngle = Math.atan2(direction.x, direction.z);
        this.bulletPool.spawn(origin, direction, u, v, aimAngle);
      },
      onProjectileExplosion: (position: THREE.Vector3, weaponType: WeaponType) => {
        // Placeholder for explosion effects
      },
    });
  }

  private wirePlayerCallbacks(): void {
    // Wire player fire handler to weapon manager
    this.player.weaponFireHandler = (origin: THREE.Vector3, direction: THREE.Vector3) => {
      const gameTime = this.game.clock.totalTime;
      const fired = this.weaponManager.fire(origin, direction, gameTime, this._walker.normal);
      if (fired) {
        this._surface.applyForce(origin, 0.1, 0.3);
        // Sound effects would go here if we had access to SoundEngine
      }
    };

    // Wire player death callback
    this.player.onDeath = (_position: THREE.Vector3) => {
      // Particles handled by main.ts if needed
      // Screen shake would go here if we had access to ScreenShake
    };

    // Wire player bomb callback
    this.player.onBomb = () => {
      const pos = this.player.mesh.position;
      this._surface.applyForce(pos, 0.5, 3.0);
      this.particles.bombExplosion(pos);

      // Kill all enemies (bombs award no points)
      const enemies = this.enemySpawner.getEnemies();
      for (const enemy of enemies) {
        if (enemy.alive) {
          enemy.takeDamage(999); // Instant kill
        }
      }
    };
  }

  /** Check collisions between regular bullets (bulletPool) and enemies. */
  private _checkBulletEnemyCollisions(): void {
    // Filter out materializing enemies (invisible during spawn warning — same as CollisionSystem).
    // Without this, invisible enemies silently absorb bullets during the 0.8s spawn warning,
    // making it appear as if the first 1-2 shots "miss" before the enemy visually appears.
    const enemies = this.enemySpawner.getEnemies().filter(e => e.alive && e.mesh && !e.isMaterializing);
    this.bulletPool.forEachActive((index, bulletPos, _data) => {
      const mutableBullet = this.bulletPool.getBulletData(index);
      if (mutableBullet.remainingDamage < 0) {
        mutableBullet.remainingDamage = 1; // GameInstance uses fixed damage=1
      }
      for (const enemy of enemies) {
        // s44r3-09: Use enemy.mesh.position (visual position above surface) for collision.
        // Inflated hit radius accounts for bullet-on-surface to elevated-enemy offset.
        const visualPos = enemy.mesh ? enemy.mesh.position : enemy.position;
        const distSq = bulletPos.distanceToSquared(visualPos);
        if (distSq < 2 * enemy.radius * enemy.radius) {
          const actualDamage = Math.min(mutableBullet.remainingDamage, enemy.health);
          enemy.takeDamage(actualDamage);
          mutableBullet.remainingDamage -= actualDamage;
          if (!enemy.alive) {
            this.particles.enemyDeath(enemy.mesh!.position, new THREE.Color(0xff4444));
            this.config.onEnemyKill(enemy.baseTypeName || 'unknown');
          }
          if (mutableBullet.remainingDamage <= 0) {
            this.bulletPool.kill(index);
            break; // bullet budget exhausted
          }
        }
      }
    });
  }

  /** Check enemy-player collisions (simple version for demo mode). */
  private _checkEnemyPlayerCollisions(): void {
    const enemies = this.enemySpawner.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.alive || !enemy.mesh) continue;
      // Skip enemies still spawning/materializing
      if (enemy.isMaterializing) continue;
      // Skip phased/invisible enemies (e.g. Phaser cycling through invisible state)
      if (enemy.isGhostForPlayer) continue;

      // s44r4-02: Compare on-surface positions directly (same as CollisionSystem fix).
      // player.mesh.position = walker position (on surface); enemy.position = on surface.
      // s44r12-01: Keep in sync with CollisionSystem.ts playerRadius (0.06)
      const playerRadius = this.player.mesh.scale.x * 0.06;
      const hitRadiusSq = (playerRadius + enemy.radius) * (playerRadius + enemy.radius);
      const distSq = this.player.mesh.position.distanceToSquared(enemy.position);
      if (distSq < hitRadiusSq) {
        this.player.die(); // player.die() checks canTakeDamage internally
        if (!this.player.alive) {
          this.particles.playerDeath(this.player.mesh.position);
        }
        break;
      }
    }
  }

  private spawnDemoEnemies(): void {
    // In demo mode, continuously maintain enemy count
    const targetCount = this.config.enemyCount;
    const currentCount = this.enemySpawner.getEnemies().filter(e => e.alive).length;
    const toSpawn = targetCount - currentCount;

    if (toSpawn > 0) {
      const types = this.config.enemyTypes;
      for (let i = 0; i < toSpawn; i++) {
        const type = types[Math.floor(Math.random() * types.length)];
        this.enemySpawner.spawnWave([{ type: type as any, count: 1, tier: 0 }]);
      }
    }
  }

  /**
   * Stop the game loop (non-destructive; game can be restarted with start()).
   * Resets the started flag so start() works again after stop().
   */
  stop(): void {
    this.game.stop();
    this.started = false;
  }

  /** Get current camera distance */
  getCameraDistance(): number {
    return this.cameraController.getCameraDistance();
  }

  /** Set camera distance (clamped to min/max) */
  setCameraDistance(distance: number): void {
    this.cameraController.setCameraDistance(distance);
  }

  /** Set orbit yaw and pitch for the camera. */
  setOrbitAngles(yaw: number, pitch: number): void {
    this.cameraController.setOrbitAngles(yaw, pitch);
  }

  /** Get current orbit angles. */
  getOrbitAngles(): { yaw: number; pitch: number } {
    return this.cameraController.getOrbitAngles();
  }

  /** Get current game stats */
  getStats(): { lives: number } {
    return { lives: this.player.lives };
  }

  /** Start the game loop */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Wire game loop callbacks
    this.game.onFixedUpdate = (dt: number) => this.update(dt);
    this.game.onRender = (alpha: number) => this.render(alpha);

    this.game.start();
  }

  /** Update game logic (called at fixed timestep) */
  update(dt: number): void {
    if (this.disposed) return;

    const inputState = this.input.getState();

    // Handle respawn or game over.
    // lives === 0 in config means infinite respawns (demo/playground mode).
    if (!this.player.alive) {
      const infiniteLives = this.config.lives === 0;
      if (this.player.lives > 0 || infiniteLives) {
        // In infinite lives mode, reset counter so next die() still triggers respawn
        if (infiniteLives && this.player.lives <= 0) {
          this.player.lives = 99;
        }
        this.respawnTimer += dt;
        if (this.respawnTimer >= RESPAWN_DELAY) {
          this.respawnTimer = 0;
          // Respawn at safe location (opposite side of surface from death location)
          const safePos = this.player.getSafeRespawnPosition();
          this.player.respawn(safePos.u, safePos.v);
          const respawnPoint = this._surface.getPoint(safePos.u, safePos.v);
          const projected = this._meshSurface.closestPointOnSurface(respawnPoint.position);
          if (projected) {
            this._walker.teleportTo(projected.point, projected.faceIndex, projected.normal);
          }
          this.player.mesh.position.copy(this._walker.position);
        }
      } else {
        // Game over
        this.config.onGameOver();
      }
    }

    // Update player movement and shooting
    if (this.player.alive) {
      // Weapon swap (E key)
      if (inputState.weaponSwap && !this.config.lockedWeapon) {
        this.weaponManager.cycleWeapon();
      }

      // Move player on surface via MeshWalker (using camera controller's targetUp for stability)
      if (Math.abs(inputState.moveX) > 0.01 || Math.abs(inputState.moveY) > 0.01) {
        this._walker.moveFromInput(
          inputState.moveX,
          -inputState.moveY,
          this.game.camera,
          dt,
          this.cameraController.targetUp
        );
      }

      // Sync player mesh position from walker
      this.player.mesh.position.copy(this._walker.position);

      // Bridge: convert world position to UV for systems that still use UV
      const inverseRot = this._surface.worldRotation.clone().invert();
      const localPos = this._walker.position.clone().applyQuaternion(inverseRot);
      const playerUV = this._surface.worldToSurface(localPos);
      this.player.surfaceU = playerUV.u;
      this.player.surfaceV = playerUV.v;

      // Update camera (CameraController handles orbit, zoom, positioning)
      this.cameraController.update(this._walker, dt);

      const playerNormal = this._walker.normal;

      // Calculate aim direction using camera-relative axes (targetUp for stability)
      const aimDirection = this._walker.getAimDirection(
        inputState.aimX,
        inputState.aimY,
        this.game.camera,
        this.cameraController.targetUp
      );

      // Orient player to face aim direction
      // REGRESSION GUARD (matches GameLoop.ts): playerRight = cross(playerNormal, aimDirection)
      // gives a right-handed basis. playerForward = cross(playerRight, playerNormal) ≈ aimDirection.
      // DO NOT reverse line 1 to cross(aimDirection, playerNormal) — that negates playerRight,
      // producing a left-handed (mirrored) basis which makes aiming wrong axis.
      if (aimDirection.lengthSq() > 0.001) {
        const playerRight = new THREE.Vector3().crossVectors(playerNormal, aimDirection).normalize();
        const playerForward = new THREE.Vector3().crossVectors(playerRight, playerNormal).normalize();
        const orientMat = new THREE.Matrix4().makeBasis(playerRight, playerNormal, playerForward);
        this.player.mesh.quaternion.setFromRotationMatrix(orientMat);
      }

      // Store aim angle for bullets
      this.player.aimAngle = Math.atan2(inputState.aimX, -inputState.aimY);

      // Update matrix for bullet spawning
      this.player.mesh.updateMatrixWorld(true);

      // Player update (shooting, bombs, etc.)
      this.player.update(dt, inputState);
    }

    // Update enemies
    this.enemySpawner.update(dt, this.player.surfaceU, this.player.surfaceV);

    // Update bullets
    this.bulletPool.update(dt);
    this._checkBulletEnemyCollisions();
    this._checkEnemyPlayerCollisions();

    // Update weapons (homing projectiles, etc.)
    this.weaponManager.update(dt);

    // Update particles
    this.particles.update(dt);

    // Update surface springs (grid deformation)
    this._surface.updateGrid(dt);
    this._surface.updateMeshDeformation(dt);

    // Demo mode: maintain enemy count
    if (this.config.mode === 'demo') {
      this.spawnDemoEnemies();
    }

    // End frame (clear input state)
    this.input.endFrame();
  }

  /** Render frame (called with interpolation alpha) */
  render(alpha: number): void {
    if (this.disposed) return;

    // Depth occlusion updates (visual only, doesn't affect gameplay)
    const enemies = this.enemySpawner.getEnemies().filter(e => e.alive && e.mesh);
    this.depthOcclusion.update(enemies, this.game.camera.position, alpha);
  }

  /** Clean up resources */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // game.dispose() calls stop() AND removes the canvas from the DOM.
    // This is critical for embedded playgrounds: without it, the old canvas
    // remains in the container and the next playground instance adds a second
    // canvas, creating duplicate/linked instances (the "Try It" duplicate bug).
    this.game.dispose();
    this.input.dispose();
    this.weaponManager.dispose();
    this.particles.dispose();
    this.depthOcclusion.dispose();
    // Free geometry, BVH, and surface structures to prevent memory accumulation
    // in test environments where many instances are created and disposed.
    this._meshSurface.dispose();
    this._surface.dispose();
  }

  /** Set a different weapon (for demos) */
  setWeapon(weapon: WeaponType): void {
    // Use equipWeapon to directly set the weapon — this avoids an infinite loop
    // that occurred when cycling through weapons that aren't in the inventory.
    // equipWeapon adds the weapon to inventory (if not present) and switches to it.
    this.weaponManager.equipWeapon(weapon);
  }

  /** Change surface (for demos) */
  setSurface(type: SurfaceType, scale?: number): void {
    // Remove old surface
    this.game.scene.remove(this._surface.group);

    // Create new surface
    this._surfaceType = type;
    this._surface = this.createSurface(type, scale ?? this.config.surfaceScale);
    this.game.scene.add(this._surface.group);
    this._surface.group.updateMatrixWorld(true);
    this._meshSurface = new MeshSurface(this._surface.walkableMesh);

    // Apply surface opacity setting from user preferences
    const graphicsSettings = loadGraphicsSettings();
    const surfaceOpacity = graphicsSettings.surfaceOpaque ? 1.0 : 0.18;
    this._surface.setSurfaceOpacity(surfaceOpacity);

    // Update subsystems
    this.bulletPool.setMeshSurface(this._meshSurface);
    this.wireBulletPool();
    this.weaponManager.setMeshSurface(this._meshSurface);
    this.enemySpawner.setMeshSurface(this._meshSurface);
    this.enemySpawner.setSurface(this._surface);
    this.depthOcclusion.setSurfaceMesh(this._surface.mesh);

    // Respawn player at center
    const startPoint = this._surface.getPoint(0.5, 0.5);
    this._walker = new MeshWalker(this._meshSurface, startPoint.position, PLAYER_MOVE_SPEED);
    this.player.mesh.position.copy(this._walker.position);
    this.player.respawn(0.5, 0.5);

    // Reposition camera
    const startFrame = this._walker.getTangentFrame();
    const idealCamPos = this._walker.normal.clone()
      .multiplyScalar(this.config.cameraDistance)
      .add(this._walker.position);
    this.game.camera.position.copy(idealCamPos);
    this.game.camera.up.copy(startFrame.bitangent);
    this.game.camera.lookAt(this._walker.position);
  }

  /** Resize canvas (for responsive demos) */
  resize(width: number, height: number): void {
    this.game.renderer.setSize(width, height);
    this.game.camera.aspect = width / height;
    this.game.camera.updateProjectionMatrix();
  }
}
