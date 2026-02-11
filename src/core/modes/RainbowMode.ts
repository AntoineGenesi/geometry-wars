import * as THREE from 'three';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';

/**
 * Rainbow mode.
 * Player cycles through colors every 5 seconds.
 * Enemies have assigned colors.
 * Matching color kills give 3x score, wrong color gives 0.5x.
 */
export class RainbowMode implements IGameMode {
  readonly name = 'Rainbow';
  readonly description = 'Match enemy colors for 3x score. Wrong color = 0.5x.';
  readonly icon = '🌈';

  // Color cycling
  private readonly colors = [
    { name: 'RED', value: new THREE.Color(0xff0000) },
    { name: 'YELLOW', value: new THREE.Color(0xffff00) },
    { name: 'GREEN', value: new THREE.Color(0x00ff00) },
    { name: 'CYAN', value: new THREE.Color(0x00ffff) },
    { name: 'BLUE', value: new THREE.Color(0x0000ff) },
    { name: 'MAGENTA', value: new THREE.Color(0xff00ff) },
  ];

  private currentColorIndex = 0;
  private colorTimer = 5.0; // seconds per color
  private readonly colorDuration = 5.0;

  // Enemy color assignments (WeakMap keyed by enemy object)
  private enemyColors = new WeakMap<BaseEnemy, number>();

  onStart(_context: GameModeContext): void {
    // Assign colors to existing enemies
  }

  onFixedUpdate(dt: number, context: GameModeContext): void {
    // Update color timer
    this.colorTimer -= dt;
    if (this.colorTimer <= 0) {
      this.currentColorIndex = (this.currentColorIndex + 1) % this.colors.length;
      this.colorTimer = this.colorDuration;
    }

    // Assign colors to new enemies
    const enemies = context.enemySpawner.getEnemies();
    for (const enemy of enemies) {
      if (!this.enemyColors.has(enemy)) {
        // Assign random color to new enemy
        const colorIndex = Math.floor(Math.random() * this.colors.length);
        this.enemyColors.set(enemy, colorIndex);
      }
    }
  }

  onRender(_dt: number, _context: GameModeContext): void {
    // Visual updates handled by HUD overlay
  }

  onEnemyKilled(enemy: BaseEnemy, _context: GameModeContext): number {
    const enemyColorIndex = this.enemyColors.get(enemy);
    if (enemyColorIndex === undefined) {
      return 1.0;
    }

    // Check if colors match
    if (enemyColorIndex === this.currentColorIndex) {
      return 3.0; // Matching color: 3x score
    } else {
      return 0.5; // Wrong color: 0.5x score
    }
  }

  getScore(context: GameModeContext): number {
    return context.player.score;
  }

  isGameOver(context: GameModeContext): boolean {
    return context.player.lives <= 0;
  }

  getHUDOverlay(_context: GameModeContext): ModeHUDData | null {
    const currentColor = this.colors[this.currentColorIndex];
    const timeLeft = Math.ceil(this.colorTimer);
    const colorHex = `#${currentColor.value.getHexString()}`;

    return {
      primary: `COLOR: ${currentColor.name}`,
      primaryColor: colorHex,
      secondary: `Next color in: ${timeLeft}s`,
    };
  }

  dispose(_context: GameModeContext): void {
    // WeakMap cleans itself up
  }
}
