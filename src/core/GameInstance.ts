/**
 * GameInstance — Universal game orchestrator for all game modes.
 *
 * Consolidates PlaygroundGame.ts + GameLoop.ts into a single reusable class.
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
 * Previously, main.ts and PlaygroundGame.ts had separate implementations of
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
import { GeomPool } from '../entities/Geom';
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

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export type GameMode = 'demo' | 'single-player' | 'split-screen' | 'lan' | 'adventure';

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
  readonly geomPool: GeomPool;
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

  private config: Required<Omit<GameInstanceConfig, 'features' | 'lockedWeapon' | 'enemyTypes' | 'enemyCount' | 'onGameOver' | 'onEnemyKill'>> & {
    features: GameInstanceFeatures;
    lockedWeapon: WeaponType | null;
    enemyTypes: EnemyType[];
    enemyCount: number;
    onGameOver: () => void;
    onEnemyKill: (enemyType: string) => void;
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
    this._surface.mesh.updateMatrixWorld(true);
    this._meshSurface = new MeshSurface(this._surface.mesh);

    // -- Input (container-aware for correct mouse aim in embedded playgrounds) --
    this.input = new InputManager();
    this.input.setContainer(cfg.container);

    // -- Bullet pool (real BulletPool, same projectile physics) --
    this.bulletPool = new BulletPool();
    this.game.scene.add(this.bulletPool.root);
    this.bulletPool.setMeshSurface(this._meshSurface);
    this.wireBulletPool();

    // -- Geom pool --
    this.geomPool = new GeomPool();
    this.game.scene.add(this.geomPool.root);

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
          .filter(e => e.alive && e.mesh)
          .map((e, i) => ({
            position: e.mesh!.position.clone(),
            index: i,
            alive: e.alive,
          }));
      },
      onEnemyDamage: (index: number, damage: number) => {
        const enemies = this.enemySpawner.getEnemies().filter(e => e.alive && e.mesh);
        const enemy = enemies[index];
        if (enemy) {
          enemy.takeDamage(damage);
          if (!enemy.alive) {
            this.particles.enemyDeath(enemy.mesh!.position, new THREE.Color(0xff4444));
            this.config.onEnemyKill(enemy.baseTypeName || 'unknown');
            // Spawn geoms
            const { u, v } = this._surface.worldToSurface(enemy.mesh!.position);
            for (let g = 0; g < enemy.geomCount; g++) {
              this.geomPool.spawn(u, v, Math.random() * Math.PI * 2);
            }
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
          const inverseRot = this._surface.worldRotation.clone().invert();
          const localPos = enemy.position.clone().applyQuaternion(inverseRot);
          const { u, v } = this._surface.worldToSurface(localPos);
          for (let g = 0; g < enemy.geomCount; g++) {
            this.geomPool.spawn(u, v, Math.random() * Math.PI * 2);
          }
        }
      }
    };
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

    // Handle respawn or game over
    if (!this.player.alive) {
      if (this.player.lives > 0) {
        this.respawnTimer += dt;
        if (this.respawnTimer >= RESPAWN_DELAY) {
          this.respawnTimer = 0;
          this.player.respawn(0.5, 0.5);
          const respawnPoint = this._surface.getPoint(0.5, 0.5);
          const projected = this._meshSurface.closestPointOnSurface(respawnPoint.position);
          if (projected) {
            this._walker.position.copy(projected.point);
            this._walker.normal.copy(projected.normal);
            this._walker.faceIndex = projected.faceIndex;
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
      // REGRESSION GUARD: cross(playerNormal, playerRight) = +aimDirection (correct).
      // cross(playerRight, playerNormal) = -aimDirection (mirrors the gun).
      if (aimDirection.lengthSq() > 0.001) {
        const playerRight = new THREE.Vector3().crossVectors(aimDirection, playerNormal).normalize();
        const playerForward = new THREE.Vector3().crossVectors(playerNormal, playerRight).normalize();
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

    // Update weapons (homing projectiles, etc.)
    this.weaponManager.update(dt);

    // Update geoms (multiplier pickups)
    this.geomPool.update(dt, this.player.surfaceU, this.player.surfaceV, this.game.clock.totalTime);

    // Update particles
    this.particles.update(dt);

    // Update surface springs (grid deformation)
    this._surface.updateGrid(dt);

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

    this.game.stop();
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
    // Cycle through weapons until we get to the desired one
    // (WeaponManager doesn't have setWeapon, only cycleWeapon)
    let current = this.weaponManager.getCurrentWeapon();
    while (current !== weapon) {
      this.weaponManager.cycleWeapon();
      current = this.weaponManager.getCurrentWeapon();
    }
  }

  /** Change surface (for demos) */
  setSurface(type: SurfaceType, scale?: number): void {
    // Remove old surface
    this.game.scene.remove(this._surface.group);

    // Create new surface
    this._surfaceType = type;
    this._surface = this.createSurface(type, scale ?? this.config.surfaceScale);
    this.game.scene.add(this._surface.group);
    this._surface.mesh.updateMatrixWorld(true);
    this._meshSurface = new MeshSurface(this._surface.mesh);

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
