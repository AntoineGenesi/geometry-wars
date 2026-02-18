/**
 * PlaygroundGame — DEPRECATED: Use GameInstance directly instead.
 *
 * This is now a thin compatibility wrapper around GameInstance.
 * Existing code using PlaygroundGame will continue to work, but new code
 * should use GameInstance directly.
 *
 * WHY THIS EXISTS:
 * Previously, PlaygroundGame was a separate implementation with its own
 * player movement, camera, and game loop logic. This caused the "invisible
 * fixes" problem (Session 19) where changes to PlaygroundGame didn't apply
 * to the main game.
 *
 * Now PlaygroundGame delegates to GameInstance, ensuring all game code paths
 * use the same logic.
 *
 * MIGRATION GUIDE:
 * ```typescript
 * // Old (still works):
 * const pg = new PlaygroundGame({ container, surface: 'sphere' });
 * pg.start();
 *
 * // New (recommended):
 * import { GameInstance } from './core/GameInstance';
 * const game = new GameInstance({ container, surface: 'sphere', mode: 'demo' });
 * game.start();
 * ```
 */

import { GameInstance, GameInstanceConfig, GameMode } from './GameInstance';
import { Game } from './Game';
import { Player } from '../entities/Player';
import { BulletPool } from '../entities/Bullet';
import { GeomPool } from '../entities/Geom';
import { EnemySpawner, EnemyType } from '../entities/enemies/EnemySpawner';
import { SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface } from '../surfaces/Surface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { WeaponManager } from '../weapons/WeaponManager';
import { WeaponType } from '../weapons/WeaponTypes';
import { ParticleSystem } from '../effects/ParticleSystem';
import { InputManager } from '../input/InputManager';
import { DepthOcclusionSystem } from '../rendering/DepthOpacity';

// ---------------------------------------------------------------------------
// Legacy Config (backward compatibility)
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
// PlaygroundGame (Compatibility Wrapper)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use GameInstance directly instead. This wrapper exists for
 * backward compatibility only.
 */
export class PlaygroundGame {
  // Delegate to GameInstance
  private instance: GameInstance;

  // Expose subsystems for backward compatibility
  readonly game: Game;
  readonly player: Player;
  readonly bulletPool: BulletPool;
  readonly geomPool: GeomPool;
  readonly enemySpawner: EnemySpawner;
  readonly weaponManager: WeaponManager;
  readonly particles: ParticleSystem;
  readonly input: InputManager;
  readonly depthOcclusion: DepthOcclusionSystem;

  get surface(): Surface { return this.instance.surface; }
  get meshSurface(): MeshSurface { return this.instance.meshSurface; }

  constructor(config: PlaygroundConfig) {
    // Convert legacy PlaygroundConfig to GameInstanceConfig
    const instanceConfig: GameInstanceConfig = {
      container: config.container,
      width: config.width,
      height: config.height,
      surface: config.surface,
      mode: 'demo' as GameMode,
      surfaceScale: config.surfaceScale,
      bloom: config.bloom,
      cameraDistance: config.cameraDistance,
      lives: config.lives,
      lockedWeapon: config.weapon ?? null,
      enemyTypes: config.enemyTypes,
      enemyCount: config.enemyCount,
      onGameOver: config.onGameOver,
      onEnemyKill: config.onEnemyKill,
    };

    // Create GameInstance
    this.instance = new GameInstance(instanceConfig);

    // Expose subsystems for backward compatibility
    this.game = this.instance.game;
    this.player = this.instance.player;
    this.bulletPool = this.instance.bulletPool;
    this.geomPool = this.instance.geomPool;
    this.enemySpawner = this.instance.enemySpawner;
    this.weaponManager = this.instance.weaponManager;
    this.particles = this.instance.particles;
    this.input = this.instance.input;
    this.depthOcclusion = this.instance.depthOcclusion;
  }

  /** Start the game loop */
  start(): void {
    this.instance.start();
  }

  /** Stop the game loop (non-destructive; game can be restarted with start()) */
  stop(): void {
    this.instance.stop();
  }

  /** Get current camera distance */
  getCameraDistance(): number {
    return this.instance.getCameraDistance();
  }

  /** Set camera distance */
  setCameraDistance(distance: number): void {
    this.instance.setCameraDistance(distance);
  }

  /** Get game stats (lives, etc.) */
  getStats(): { lives: number } {
    return this.instance.getStats();
  }

  /** Set a different weapon (for demos) */
  setWeapon(weapon: WeaponType): void {
    this.instance.setWeapon(weapon);
  }

  /** Change surface (for demos) */
  setSurface(type: SurfaceType, scale?: number): void {
    this.instance.setSurface(type, scale);
  }

  /** Resize canvas (for responsive demos) */
  resize(width: number, height: number): void {
    this.instance.resize(width, height);
  }

  /** Clean up resources */
  dispose(): void {
    this.instance.dispose();
  }

  /**
   * Manual render update (for tests only).
   * In normal operation, this is called automatically by the game loop.
   * @private
   */
  renderUpdate(): void {
    // Call the instance's render method with alpha=1 (no interpolation)
    this.instance.render(1.0);
  }
}
