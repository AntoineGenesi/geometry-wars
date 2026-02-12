/**
 * GameDebugAPI — Programmatic access to the running game for automated testing.
 *
 * Exposes on `window.__gameDebug` when URL has `?debug=true`.
 * Allows test scripts to read game state and control the game programmatically.
 *
 * All return values are JSON-serializable (no THREE.Vector3 objects).
 *
 * Usage:
 *   - Open game with ?debug=true
 *   - Run commands via console: window.__gameDebug.getEnemyStates()
 *   - Automate tests: window.__gameDebug.setSeed(123); window.__gameDebug.quickStart('sphere', 123);
 */

import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { EnemySpawner, EnemyType } from '../entities/enemies/EnemySpawner';
import type { GameLoop } from '../core/GameLoop';
import type { InputManager } from '../input/InputManager';
import type { MeshWalker } from '../experimental/mesh-movement/MeshWalker';
import type { Surface } from '../surfaces/Surface';
import { setGameSeed, clearGameSeed } from '../core/SeededRandom';

// ---------------------------------------------------------------------------
// Serializable types (JSON-safe, no THREE objects)
// ---------------------------------------------------------------------------

export interface SerializedVector3 {
  x: number;
  y: number;
  z: number;
}

export interface SerializedQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface EnemyState {
  type: string;
  position: SerializedVector3;
  surfaceUV: { u: number; v: number };
  health: number;
  alive: boolean;
  faceIndex: number | null;
}

export interface PlayerState {
  position: SerializedVector3;
  surfaceUV: { u: number; v: number };
  health: number;
  alive: boolean;
  score: number;
  velocity: { u: number; v: number };
  lives: number;
  bombs: number;
}

export interface BulletState {
  position: SerializedVector3;
  direction: SerializedVector3;
  alive: boolean;
}

export interface GameState {
  frameCount: number;
  dt: number;
  enemyCount: number;
  bulletCount: number;
  score: number;
  gameTime: number;
  fps: number;
  surface: string;
}

export interface CameraState {
  position: SerializedVector3;
  quaternion: SerializedQuaternion;
  fov: number;
}

// ---------------------------------------------------------------------------
// GameDebugAPI
// ---------------------------------------------------------------------------

export class GameDebugAPI {
  private game: Game;
  private player: Player;
  private enemySpawner: EnemySpawner;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private gameLoop: GameLoop;
  private input: InputManager;
  private playerWalker: MeshWalker;
  private surface: Surface;

  // Internal state for tick() in paused mode
  private isPaused = false;

  constructor(
    game: Game,
    player: Player,
    enemySpawner: EnemySpawner,
    scene: THREE.Scene,
    camera: THREE.Camera,
    gameLoop: GameLoop,
    input: InputManager,
    playerWalker: MeshWalker,
    surface: Surface,
  ) {
    this.game = game;
    this.player = player;
    this.enemySpawner = enemySpawner;
    this.scene = scene;
    this.camera = camera;
    this.gameLoop = gameLoop;
    this.input = input;
    this.playerWalker = playerWalker;
    this.surface = surface;
  }

  // -------------------------------------------------------------------------
  // State getters (JSON-serializable)
  // -------------------------------------------------------------------------

  getEnemyStates(): EnemyState[] {
    const enemies = this.enemySpawner.getEnemies();
    return enemies.map(e => {
      // For walker mode enemies, BaseEnemy already syncs surfacePosition from walker.position
      // Just use the synced UV coordinates directly
      const surfaceUV = { u: e.surfacePosition.u, v: e.surfacePosition.v };

      return {
        type: e.constructor.name.toLowerCase(),
        position: this.vec3ToJSON(e.position),
        surfaceUV,
        health: e.health,
        alive: e.alive,
        faceIndex: (e as any).faceIndex ?? null,
      };
    });
  }

  getPlayerState(): PlayerState {
    return {
      position: this.vec3ToJSON(this.player.mesh.position),
      surfaceUV: { u: this.player.surfaceU, v: this.player.surfaceV },
      health: this.player.lives, // Player doesn't have HP, use lives
      alive: this.player.alive,
      score: this.player.score,
      velocity: { u: this.player.velocityU, v: this.player.velocityV },
      lives: this.player.lives,
      bombs: this.player.bombs,
    };
  }

  getBulletStates(): BulletState[] {
    const bullets: BulletState[] = [];
    const bulletPool = (this.player as any).bulletPool;
    if (!bulletPool) return bullets;

    bulletPool.forEachActive((index: number, position: THREE.Vector3, data: any) => {
      bullets.push({
        position: this.vec3ToJSON(position),
        direction: { x: data.dirX, y: data.dirY, z: data.dirZ },
        alive: true,
      });
    });

    return bullets;
  }

  getGameState(): GameState {
    return {
      frameCount: Math.floor(this.game.clock.totalTime * 60), // Approximate frame count from totalTime
      dt: this.game.clock.fixedDeltaTime,
      enemyCount: this.enemySpawner.getActiveCount(),
      bulletCount: (this.player as any).bulletPool?.activeCount ?? 0,
      score: this.player.score,
      gameTime: this.game.clock.totalTime,
      fps: 1 / this.game.clock.fixedDeltaTime, // 60 fps fixed timestep
      surface: 'unknown', // Would need to pass surfaceType to constructor
    };
  }

  getCameraState(): CameraState {
    return {
      position: this.vec3ToJSON(this.camera.position),
      quaternion: this.quatToJSON((this.camera as any).quaternion),
      fov: (this.camera as THREE.PerspectiveCamera).fov ?? 75,
    };
  }

  // -------------------------------------------------------------------------
  // Input simulation
  // -------------------------------------------------------------------------

  /**
   * Simulate keyboard input.
   * @param key - Key name (e.g., 'w', 'a', 's', 'd', ' ')
   * @param pressed - True to press, false to release
   */
  sendInput(key: string, pressed: boolean): void {
    const keysDown = (this.input as any).keysDown as Set<string>;
    if (pressed) {
      keysDown.add(key.toLowerCase());
    } else {
      keysDown.delete(key.toLowerCase());
    }
  }

  /**
   * Simulate mouse position.
   * @param x - Mouse X in pixels (screen space)
   * @param y - Mouse Y in pixels (screen space)
   */
  setMousePosition(x: number, y: number): void {
    (this.input as any).mouseX = x;
    (this.input as any).mouseY = y;
  }

  /**
   * Simulate mouse button state.
   * @param down - True to press left mouse button, false to release
   */
  setMouseDown(down: boolean): void {
    (this.input as any).mouseLeftDown = down;
  }

  // -------------------------------------------------------------------------
  // Game control
  // -------------------------------------------------------------------------

  /**
   * Spawn an enemy at a specific UV position.
   * @param type - Enemy type (e.g., 'grunt', 'wanderer')
   * @param u - Surface U coordinate (0-1)
   * @param v - Surface V coordinate (0-1)
   */
  spawnEnemy(type: EnemyType, u: number, v: number): void {
    this.enemySpawner.spawn(type, u, v);
  }

  /**
   * Set deterministic random seed for reproducible gameplay.
   * @param seed - Integer seed value
   */
  setSeed(seed: number): void {
    setGameSeed(seed);
  }

  /**
   * Clear the seed and restore Math.random().
   */
  clearSeed(): void {
    clearGameSeed();
  }

  /**
   * Pause the game loop.
   */
  pause(): void {
    this.isPaused = true;
    this.game.pause();
  }

  /**
   * Resume the game loop.
   */
  resume(): void {
    this.isPaused = false;
    this.game.resume();
  }

  /**
   * Advance N frames while paused (manual stepping).
   * @param n - Number of frames to advance
   */
  tick(n = 1): void {
    if (!this.isPaused) {
      console.warn('[GameDebugAPI] tick() only works when paused');
      return;
    }
    // Manual frame stepping not implemented in current Game architecture
    // Would require exposing onFixedUpdate externally
    console.warn('[GameDebugAPI] tick() not yet implemented');
  }

  /**
   * Quick start: skip menu, start game on specific surface with seed.
   * This is the most important method for automated testing.
   *
   * @param surface - Surface type (e.g., 'sphere', 'torus')
   * @param seed - Random seed for deterministic gameplay
   */
  quickStart(surface: string, seed: number): void {
    // This would need to be implemented at the main.ts level
    // by checking for ?quickStart URL param and calling main() directly
    console.warn('[GameDebugAPI] quickStart() requires URL param ?quickStart=true&surface=X&seed=Y');
    console.warn('[GameDebugAPI] Use: window.location.href = "?quickStart=true&surface=' + surface + '&seed=' + seed + '"');
  }

  /**
   * Clear all enemies from the game.
   * Useful for testing specific enemy behaviors in isolation.
   */
  clearEnemies(): void {
    const enemies = this.enemySpawner.getEnemies().slice();
    enemies.forEach(e => e.destroy());
  }

  /**
   * Teleport player to a specific UV position.
   * Syncs both UV coordinates AND MeshWalker position to prevent desync.
   * @param u - Surface U coordinate (0-1)
   * @param v - Surface V coordinate (0-1)
   */
  teleportPlayer(u: number, v: number): void {
    // Set UV coordinates
    this.player.surfaceU = u;
    this.player.surfaceV = v;

    // Sync walker position: convert UV to world position and move walker there
    const surfacePoint = this.surface.getPoint(u, v);

    // Apply surface rotation to get actual world position
    const rotatedPos = surfacePoint.position.clone().applyQuaternion(this.surface.worldRotation);

    // Update walker position directly (MeshWalker.position is a public field)
    this.playerWalker.position.copy(rotatedPos);

    // Sync player mesh position from walker
    this.player.mesh.position.copy(this.playerWalker.position);
  }

  // -------------------------------------------------------------------------
  // Helper methods (internal)
  // -------------------------------------------------------------------------

  private vec3ToJSON(v: THREE.Vector3): SerializedVector3 {
    return { x: v.x, y: v.y, z: v.z };
  }

  private quatToJSON(q: THREE.Quaternion): SerializedQuaternion {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }
}
