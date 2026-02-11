/**
 * PlaygroundGame — Plug-and-play embeddable game for playgrounds/demos.
 *
 * The "subtractive" approach: runs a REAL game with real enemies, real weapons,
 * real surfaces, real collision — in a contained DOM element with optional
 * constraints (locked weapon, specific surface, enemy count).
 *
 * Usage:
 *   const pg = new PlaygroundGame({
 *     container: myDiv,
 *     surface: 'sphere',
 *     weapon: 'spreadshot',
 *     enemyCount: 8,
 *   });
 *   pg.start();
 *   pg.setWeapon('tesla');
 *   pg.dispose();
 *
 * WHY THIS EXISTS:
 * Previously, WeaponPlayground (1,877 lines) and VisualPlaygroundDemo rebuilt
 * the entire game from scratch — custom rendering, collision, enemy AI. This
 * caused constant regressions because two implementations diverged.
 * PlaygroundGame uses the SAME classes as the real game so behavior matches.
 */

import * as THREE from 'three';
import { Game } from './Game';
import { Player } from '../entities/Player';
import { BulletPool } from '../entities/Bullet';
import { GeomPool } from '../entities/Geom';
import { EnemySpawner, EnemyType } from '../entities/enemies/EnemySpawner';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';
import { MeshSurface } from '../experimental/mesh-movement/MeshSurface';
import { MeshWalker } from '../experimental/mesh-movement/MeshWalker';
import { WeaponManager } from '../weapons/WeaponManager';
import { WeaponType } from '../weapons/WeaponTypes';
import { ParticleSystem } from '../effects/ParticleSystem';
import { InputManager, InputState } from '../input/InputManager';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PlaygroundConfig {
  /** DOM element to render into. */
  container: HTMLElement;
  /** Width in pixels (defaults to container clientWidth or 400). */
  width?: number;
  /** Height in pixels (defaults to container clientHeight or 300). */
  height?: number;
  /** Surface type to play on. */
  surface?: SurfaceType;
  /** Lock the player to this weapon (null = free weapon swaps). */
  weapon?: WeaponType | null;
  /** Number of enemies to maintain on-screen. */
  enemyCount?: number;
  /** Surface scale (radius/size). */
  surfaceScale?: number;
  /** Bloom config overrides. */
  bloom?: Partial<{ strength: number; radius: number; threshold: number }>;
  /** Camera distance from player. */
  cameraDistance?: number;
  /** Player lives (0 = infinite). */
  lives?: number;
  /** Enemy types to use (defaults to basic mix). */
  enemyTypes?: EnemyType[];
  /** Callback when player dies (all lives lost). */
  onGameOver?: () => void;
  /** Callback when enemy is killed. */
  onEnemyKill?: (enemyType: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_MOVE_SPEED = 3.0;
const RESPAWN_DELAY = 1.5;
const DEFAULT_ENEMY_TYPES: EnemyType[] = ['grunt', 'wanderer', 'duck', 'weaver', 'spinner', 'rocket'];

// ---------------------------------------------------------------------------
// PlaygroundGame
// ---------------------------------------------------------------------------

export class PlaygroundGame {
  readonly game: Game;
  readonly player: Player;
  readonly bulletPool: BulletPool;
  readonly geomPool: GeomPool;
  readonly enemySpawner: EnemySpawner;
  readonly weaponManager: WeaponManager;
  readonly particles: ParticleSystem;
  readonly input: InputManager;

  // These can change when setSurface() is called
  private _surface: Surface;
  private _meshSurface: MeshSurface;
  private _walker: MeshWalker;

  get surface(): Surface { return this._surface; }
  get meshSurface(): MeshSurface { return this._meshSurface; }

  private config: Required<PlaygroundConfig>;
  private respawnTimer = 0;
  private disposed = false;
  private started = false;

  // Pre-allocated temp vectors (zero-GC pattern from main game)
  private readonly _tmpVec = new THREE.Vector3();
  private readonly _tmpDir = new THREE.Vector3();
  private readonly _tmpRight = new THREE.Vector3();

  constructor(userConfig: PlaygroundConfig) {
    this.config = {
      container: userConfig.container,
      width: userConfig.width ?? (userConfig.container.clientWidth || 400),
      height: userConfig.height ?? (userConfig.container.clientHeight || 300),
      surface: userConfig.surface ?? 'sphere',
      weapon: userConfig.weapon ?? null,
      enemyCount: userConfig.enemyCount ?? 8,
      surfaceScale: userConfig.surfaceScale ?? 10,
      bloom: userConfig.bloom ?? { strength: 0.7, radius: 0.5, threshold: 0.6 },
      cameraDistance: userConfig.cameraDistance ?? 20,
      lives: userConfig.lives ?? 3,
      enemyTypes: userConfig.enemyTypes ?? DEFAULT_ENEMY_TYPES,
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

    // -- Immediately position camera above player (avoid slow lerp convergence) --
    // Game constructor sets camera to (0,15,25) with up=(0,1,0), which is wrong
    // for surface-following cameras. Without this, the camera spirals during the
    // first ~50 frames as lerp fights to converge from the wrong initial state.
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

    // Wire weapon callbacks so weapons can spawn bullets and damage enemies
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
            this.particles.emit({
              position: enemy.mesh!.position.clone(),
              count: 12,
              color: new THREE.Color(0xff4444),
              speed: 3,
              lifetime: 0.5,
              size: 0.15,
            });
            this.config.onEnemyKill(enemy.baseTypeName || 'unknown');
          }
        }
      },
      spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => {
        const { u, v } = this._surface.worldToSurface(origin);
        const aimAngle = Math.atan2(direction.x, direction.z);
        this.bulletPool.spawn(origin, direction, u, v, aimAngle);
      },
    });

    if (cfg.weapon) {
      this.weaponManager.equipWeapon(cfg.weapon);
    }

    // Delegate player firing to WeaponManager (not raw bulletPool)
    this.player.weaponFireHandler = (origin: THREE.Vector3, direction: THREE.Vector3) => {
      const gameTime = this.game.clock.totalTime;
      this.weaponManager.fire(origin, direction, gameTime, this._walker.normal);
    };

    // -- Enemy spawner (real EnemySpawner, real enemy AI) --
    this.enemySpawner = new EnemySpawner(this.game.scene, this.getTransformFn());
    this.enemySpawner.setSurfaceSpeedScale(this._surface.speedScale);
    this.enemySpawner.setSurface(this._surface);

    // -- Particles --
    this.particles = new ParticleSystem();
    this.game.scene.add(this.particles.root);

    // -- Wire game loop --
    this.game.onFixedUpdate = (dt: number) => this.fixedUpdate(dt);
    this.game.onRender = () => this.renderUpdate();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  start(): void {
    if (!this.started) {
      // First start: initialize clock, spawn enemies
      this.started = true;
      this.game.start();
      this.spawnEnemies(this.config.enemyCount);
    } else {
      // Resume: restart the RAF loop. Game.start() resets the clock,
      // which is acceptable for a playground resume — the alternative
      // (large dt spike) is worse.
      this.game.start();
    }
  }

  stop(): void {
    this.game.stop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.game.dispose();
    this.input.dispose();
  }

  /** Switch weapon (or null to unlock). */
  setWeapon(type: WeaponType | null): void {
    this.config.weapon = type;
    if (type) this.weaponManager.equipWeapon(type);
  }

  /** Adjust camera distance at runtime (for zoom). */
  setCameraDistance(distance: number): void {
    this.config.cameraDistance = Math.max(8, Math.min(60, distance));
  }

  /** Get current camera distance. */
  getCameraDistance(): number {
    return this.config.cameraDistance;
  }

  /** Rebuild with a different surface. */
  setSurface(type: SurfaceType): void {
    // Remove old
    this.game.scene.remove(this._surface.group);

    // Create new
    this._surface = this.createSurface(type, this.config.surfaceScale);
    this.game.scene.add(this._surface.group);
    this._surface.mesh.updateMatrixWorld(true);
    this._meshSurface = new MeshSurface(this._surface.mesh);

    // Re-wire systems
    this.bulletPool.setMeshSurface(this._meshSurface);
    this.wireBulletPool();
    this.weaponManager.setMeshSurface(this._meshSurface);

    // Reset player
    const startPoint = this._surface.getPoint(0.5, 0.5);
    this._walker = new MeshWalker(this._meshSurface, startPoint.position, PLAYER_MOVE_SPEED);
    this.player.respawn(0.5, 0.5);
    this.player.mesh.position.copy(this._walker.position);

    // Immediately reposition camera (avoid spiral convergence on new surface)
    // REGRESSION GUARD: camera.up = bitangent, NOT normal. See decisions/playground-spinning-fix.md.
    {
      const n = this._walker.normal;
      const p = this._walker.position;
      const surfFrame = this._walker.getTangentFrame();
      const idealCamPos = n.clone().multiplyScalar(this.config.cameraDistance).add(p);
      this.game.camera.position.copy(idealCamPos);
      this.game.camera.up.copy(surfFrame.bitangent);
      this.game.camera.lookAt(p);
    }

    // Reset enemies (spawner needs new transform fn — create a new one)
    this.enemySpawner.clear();
    // EnemySpawner doesn't have setTransformFn, so we create a new spawner
    (this as any).enemySpawner = new EnemySpawner(this.game.scene, this.getTransformFn());
    this.enemySpawner.setSurfaceSpeedScale(this._surface.speedScale);
    this.enemySpawner.setSurface(this._surface);
    this.spawnEnemies(this.config.enemyCount);

    this.config.surface = type;
  }

  /** Resize the canvas. */
  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;
    this.game.renderer.setSize(width, height);
    this.game.camera.aspect = width / height;
    this.game.camera.updateProjectionMatrix();
    if (this.game.composer) {
      this.game.composer.setSize(width, height);
    }
  }

  /** Current game stats. */
  getStats() {
    return {
      score: this.player.score,
      alive: this.player.alive,
      lives: this.player.lives,
      enemyCount: this.enemySpawner.getActiveCount(),
      bulletCount: this.bulletPool.activeCount,
    };
  }

  // -----------------------------------------------------------------------
  // Game loop (mirrors main.ts but minimal)
  // -----------------------------------------------------------------------

  private fixedUpdate(dt: number): void {
    if (this.disposed) return;

    const inputState = this.input.getState();

    if (this.player.alive) {
      // -- Movement via MeshWalker (same as main game) --
      // IMPORTANT: Uses walker.moveFromInput() which maps screen-space
      // input directly to the walker's persistent tangent frame.
      // Do NOT use camera-relative movement — it creates a feedback loop
      // between camera orientation and movement direction, causing spinning.
      this.movePlayer(inputState, dt);

      // -- Orient player using walker's tangent frame + aim --
      // (matches main.ts approach: tangent frame aim, not Player.update aim)
      this.orientPlayer(inputState);

      // -- Player update (handles firing, cooldowns, invincibility) --
      this.player.update(dt, inputState);

      // -- Weapon lock enforcement --
      if (this.config.weapon) {
        this.weaponManager.equipWeapon(this.config.weapon);
      }
    } else {
      // -- Respawn logic --
      this.respawnTimer += dt;
      if (this.respawnTimer >= RESPAWN_DELAY) {
        this.respawnTimer = 0;
        if (this.player.lives > 0) {
          this.respawnPlayer();
        } else {
          this.config.onGameOver();
        }
      }
    }

    // -- Update enemies (real AI, same behavior as main game) --
    this.enemySpawner.update(dt, this.player.surfaceU, this.player.surfaceV);

    // -- Update weapon manager (projectiles, effects, buffs) --
    this.weaponManager.update(dt);

    // -- Update bullets --
    this.bulletPool.update(dt);

    // -- Update particles --
    this.particles.update(dt);

    // -- Collision: bullets vs enemies --
    // Uses enemy.radius + 0.15, matching CollisionSystem.ts (main game)
    this.bulletPool.forEachActive((_idx, bulletPos, bulletData) => {
      const enemies = this.enemySpawner.getEnemies();
      for (const enemy of enemies) {
        if (!enemy.active || !enemy.alive || enemy.isMaterializing) continue;
        if (!enemy.mesh) continue;
        const hitRadius = enemy.radius + 0.15;
        const distSq = bulletPos.distanceToSquared(enemy.mesh.position);
        if (distSq < hitRadius * hitRadius) {
          enemy.takeDamage(1);
          this.bulletPool.kill(_idx);
          if (!enemy.alive) {
            this.particles.emit({ position: enemy.mesh.position, count: 12, color: new THREE.Color(0xff4444), speed: 3, lifetime: 0.5, size: 0.15 });
            this.config.onEnemyKill(enemy.baseTypeName || 'unknown');
          }
          return; // bullet consumed, stop checking enemies for this bullet
        }
      }
    });

    // -- Collision: enemies vs player --
    // Uses player.mesh.scale.x * 0.3 + enemy.radius, matching CollisionSystem.ts
    if (this.player.canTakeDamage) {
      for (const enemy of this.enemySpawner.getEnemies()) {
        if (!enemy.active || !enemy.alive || enemy.isMaterializing) continue;
        if (!enemy.mesh) continue;
        const hitRadius = this.player.mesh.scale.x * 0.3 + enemy.radius;
        const distSq = this.player.mesh.position.distanceToSquared(enemy.mesh.position);
        if (distSq < hitRadius * hitRadius) {
          this.player.lives -= 1;
          this.player.alive = false;
          this.player.mesh.visible = false;
          // Death particles
          this.particles.emit({ position: this.player.mesh.position, count: 20, color: new THREE.Color(0x00ffff), speed: 4, lifetime: 0.6, size: 0.2 });
          break;
        }
      }
    }

    // -- Replenish enemies to maintain target count --
    const activeCount = this.enemySpawner.getActiveCount();
    if (activeCount < Math.floor(this.config.enemyCount * 0.5)) {
      this.spawnEnemies(this.config.enemyCount - activeCount);
    }

    this.input.endFrame();
  }

  // REGRESSION GUARD: Camera up MUST be frame.bitangent, NOT walker.normal.
  // Since the camera sits along the surface normal looking down at the player,
  // setting up=normal makes it parallel to the look direction, which is a
  // degenerate case for lookAt() — it produces wild spinning because the
  // "up" axis is undefined when it's parallel to the view axis.
  // Using frame.bitangent gives a stable, perpendicular up vector.
  // See decisions/playground-spinning-fix.md.
  private renderUpdate(): void {
    if (this.disposed) return;

    // Camera follows player (same orbit pattern as main game)
    const target = this.player.mesh.position;
    const normal = this._walker.normal;
    const frame = this._walker.getTangentFrame();
    const camPos = this._tmpVec
      .copy(normal)
      .multiplyScalar(this.config.cameraDistance)
      .add(target);

    this.game.camera.position.lerp(camPos, 0.1);
    // Camera up = bitangent (perpendicular to both normal and tangent).
    // NEVER use normal here — it's parallel to the look direction and causes spinning.
    this.game.camera.up.lerp(frame.bitangent, 0.08).normalize();
    this.game.camera.lookAt(target);

    // Surface grid animation
    if (this._surface.updateGrid) {
      this._surface.updateGrid(1 / 60);
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  // REGRESSION GUARD: This method MUST use walker.moveFromInput() which maps
  // screen-space input to the walker's persistent tangent frame. Do NOT replace
  // with camera-relative movement (projecting camera axes onto tangent plane).
  // Camera-relative movement creates a feedback loop: camera orientation affects
  // movement direction, which affects position, which affects camera orientation,
  // causing the "spinning map" bug. See decisions/playground-spinning-fix.md.
  private movePlayer(input: InputState, dt: number): void {
    const moveX = input.moveX;
    const moveY = input.moveY;

    // Use MeshWalker.moveFromInput() — same as main.ts
    // This maps screen axes directly to the walker's persistent tangent frame:
    //   tangent  = screen right (D/A)
    //   bitangent = screen up   (W/S)
    // The -moveY negation is required because InputManager returns W=-1, S=+1
    // but moveFromInput expects positive = visual up on screen.
    if (Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01) {
      this._walker.moveFromInput(moveX, -moveY, this.game.camera, dt);
    }

    // Sync position from walker
    this.player.mesh.position.copy(this._walker.position);

    // Bridge UV for enemy spawner distance checks
    const uv = this._surface.worldToSurface(this._walker.position);
    this.player.surfaceU = uv.u;
    this.player.surfaceV = uv.v;
  }

  /**
   * Orient the player mesh using the walker's tangent frame + aim direction.
   * Matches main.ts approach exactly: tangent frame from walker, aim mapped
   * to tangent frame, orientation built from cross products.
   *
   * REGRESSION GUARD: Do NOT use Player.applySurfaceTransform() with a
   * movement-direction-derived tangent frame. The tangent frame MUST come
   * from the walker's persistent frame. See decisions/playground-spinning-fix.md.
   */
  private orientPlayer(input: InputState): void {
    const playerNormal = this._walker.normal;
    const frame = this._walker.getTangentFrame();

    // Calculate aim from mouse in screen space using tangent frame
    // (same logic as main.ts lines 1695-1726)
    const aimX = input.aimX;
    const aimY = input.aimY;
    const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);

    let aimDirection: THREE.Vector3;
    if (aimLen > 0.1) {
      // Map screen aim to tangent frame:
      // tangent = screen right, bitangent = screen up
      // Negate aimY because mouse Y increases downward but bitangent points up
      aimDirection = this._tmpDir
        .set(0, 0, 0)
        .addScaledVector(frame.tangent, aimX)
        .addScaledVector(frame.bitangent, -aimY)
        .normalize();
    } else {
      // Default: face along bitangent (screen up direction)
      aimDirection = this._tmpDir.copy(frame.bitangent);
    }

    // Orient player to face aim direction (same as main.ts lines 1718-1723)
    if (aimDirection.lengthSq() > 0.001) {
      const playerRight = this._tmpRight.crossVectors(playerNormal, aimDirection).normalize();
      const playerForward = this._tmpVec.crossVectors(playerRight, playerNormal).normalize();
      const orientMat = new THREE.Matrix4().makeBasis(playerRight, playerNormal, playerForward);
      this.player.mesh.quaternion.setFromRotationMatrix(orientMat);
    }

    // Store aim angle for bullets
    this.player.aimAngle = Math.atan2(aimX, -aimY);

    // Update matrix for bullet spawning
    this.player.mesh.updateMatrixWorld(true);
  }

  private respawnPlayer(): void {
    this.player.respawn(0.5, 0.5);
    const p = this._surface.getPoint(0.5, 0.5);
    const proj = this._meshSurface.closestPointOnSurface(p.position);
    if (proj) {
      this._walker.position.copy(proj.point);
      this._walker.normal.copy(proj.normal);
      this._walker.faceIndex = proj.faceIndex;
    }
    this.player.mesh.position.copy(this._walker.position);

    // Snap camera to avoid spiral after respawn
    // REGRESSION GUARD: camera.up = bitangent, NOT normal. See decisions/playground-spinning-fix.md.
    const n = this._walker.normal;
    const pos = this._walker.position;
    const respawnFrame = this._walker.getTangentFrame();
    const idealCamPos = n.clone().multiplyScalar(this.config.cameraDistance).add(pos);
    this.game.camera.position.copy(idealCamPos);
    this.game.camera.up.copy(respawnFrame.bitangent);
    this.game.camera.lookAt(pos);
  }

  private spawnEnemies(count: number): void {
    const types = this.config.enemyTypes;
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const u = 0.1 + Math.random() * 0.8;
      const v = 0.1 + Math.random() * 0.8;
      this.enemySpawner.spawn(type, u, v);
    }
  }

  private getTransformFn() {
    const surface = this._surface;
    return (u: number, v: number) => {
      const p = surface.getPoint(u, v);
      return { position: p.position, normal: p.normal, tangent: p.tangentU, bitangent: p.tangentV };
    };
  }

  private wireBulletPool(): void {
    const surface = this._surface;
    const getTransform = this.getTransformFn();
    this.bulletPool.setSurfaceFunctions(
      getTransform,
      (u: number, v: number, du: number, dv: number) =>
        surface.moveOnSurface(u, v, du, dv),
    );
  }

  private createSurface(type: SurfaceType, scale: number): Surface {
    const config: Record<string, unknown> = {
      radius: scale,
      size: scale,
      height: scale * 2,
      majorRadius: scale * 0.8,
      minorRadius: scale * 0.3,
      width: scale,
      gridColor: 0x2a2aaa,
      surfaceColor: 0x141440,
      surfaceOpacity: 0.35,
      gridOpacity: 0.4,
      gridSegmentsU: 24,
      gridSegmentsV: 18,
    };

    // Cube tunnel needs larger size than the generic scale parameter
    if (type === 'cube-tunnel') {
      config.size = 35;
      config.wallThickness = 2.0;
      config.bevelRadius = 4.5;
      config.gridSegments = 16;
    }

    // Cube-ring needs specific proportions
    if (type === 'cube-ring') {
      config.majorRadius = 4;
      config.crossSection = 2;
    }

    return SurfaceFactory.create(type, config as any);
  }
}
