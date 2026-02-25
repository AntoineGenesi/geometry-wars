import * as THREE from 'three';
import type { Player } from '../../entities/Player';
import type { EnemySpawner } from '../../entities/enemies/EnemySpawner';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { Surface } from '../../surfaces/Surface';
import type { WeaponManager } from '../../weapons/WeaponManager';
import type { BuffManager } from '../../buffs/BuffManager';
import type { Game } from '../Game';

/**
 * Context passed to game mode hooks.
 * Contains references to all major game systems.
 */
export interface GameModeContext {
  player: Player;
  enemySpawner: EnemySpawner;
  surface: Surface;
  weaponManager: WeaponManager;
  buffManager: BuffManager;
  game: Game;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/**
 * HUD overlay data for mode-specific UI elements.
 */
export interface ModeHUDData {
  /** Primary metric (e.g., "Ammo: 30", "Zone Bonus: 3x") */
  primary?: string;
  /** Secondary metric */
  secondary?: string;
  /** Warning message (e.g., "OUT OF AMMO!") */
  warning?: string;
  /** Color for primary text */
  primaryColor?: string;
  /** Color for warning text */
  warningColor?: string;
}

/**
 * Interactive Game Mode interface.
 * Each mode implements unique gameplay mechanics and scoring rules.
 */
export interface IGameMode {
  /** Display name */
  readonly name: string;

  /** Brief description for UI */
  readonly description: string;

  /** Icon/emoji for menu (optional) */
  readonly icon?: string;

  /**
   * Called once when the mode starts (after countdown).
   */
  onStart(context: GameModeContext): void;

  /**
   * Called every fixed update (before physics).
   */
  onFixedUpdate(dt: number, context: GameModeContext): void;

  /**
   * Called every render frame (after fixed update).
   */
  onRender(dt: number, context: GameModeContext): void;

  /**
   * Called when an enemy is killed.
   * @returns Score multiplier for this kill (1.0 = normal, 2.0 = double, etc.)
   */
  onEnemyKilled(enemy: BaseEnemy, context: GameModeContext): number;

  /**
   * Get current score (may be different from player.score for mode-specific scoring).
   * KotH: returns zone time in centiseconds. Others: returns player.score.
   */
  getScore(context: GameModeContext): number;

  /**
   * Optional label for the game over screen score display.
   * If omitted, defaults to "SCORE".
   */
  getScoreLabel?(): string;

  /**
   * Check if game over condition is met.
   */
  isGameOver(context: GameModeContext): boolean;

  /**
   * Get HUD overlay data for mode-specific UI.
   */
  getHUDOverlay(context: GameModeContext): ModeHUDData | null;

  /**
   * Cleanup mode resources.
   */
  dispose(context: GameModeContext): void;
}

/**
 * Default/Waves mode that matches current standard behavior.
 * No special mechanics, just standard wave-based gameplay.
 */
export class WavesMode implements IGameMode {
  readonly name = 'Waves';
  readonly description = 'Standard endless waves. Survive as long as possible.';
  readonly icon = '〰️';

  onStart(_context: GameModeContext): void {
    // No special setup
  }

  onFixedUpdate(_dt: number, _context: GameModeContext): void {
    // No special per-frame logic
  }

  onRender(_dt: number, _context: GameModeContext): void {
    // No special rendering
  }

  onEnemyKilled(_enemy: BaseEnemy, _context: GameModeContext): number {
    return 1.0; // Normal score
  }

  getScore(context: GameModeContext): number {
    return context.player.score;
  }

  isGameOver(context: GameModeContext): boolean {
    return context.player.lives <= 0;
  }

  getHUDOverlay(_context: GameModeContext): ModeHUDData | null {
    return null; // No special HUD
  }

  dispose(_context: GameModeContext): void {
    // No cleanup needed
  }
}
