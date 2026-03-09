import * as THREE from 'three';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';

// Pre-allocated temp color to avoid GC pressure in onFixedUpdate
const _tempColor = new THREE.Color();

/**
 * Rainbow mode — Enemies glow with distinct rainbow colors. Your player glows with the
 * current "hot" color. Killing a matching-color enemy gives 3x score; wrong color = 0.5x.
 * Color cycles every 3 seconds, creating urgency to target the right enemies.
 *
 * Visual overhaul vs original: enemy meshes now actually glow their assigned color,
 * player is tinted to show the active target color, and the scene ambient light shifts
 * to match the current active color.
 */
export class RainbowMode implements IGameMode {
  readonly name = 'Rainbow';
  readonly description = 'Enemies glow in rainbow colors. Match your color for 3x score. Wrong color = 0.5x.';
  readonly icon = '🌈';

  private readonly colors = [
    { name: 'RED',     value: new THREE.Color(0xff2200) },
    { name: 'ORANGE',  value: new THREE.Color(0xff8800) },
    { name: 'YELLOW',  value: new THREE.Color(0xffee00) },
    { name: 'GREEN',   value: new THREE.Color(0x00ff44) },
    { name: 'CYAN',    value: new THREE.Color(0x00ffee) },
    { name: 'BLUE',    value: new THREE.Color(0x4488ff) },
    { name: 'MAGENTA', value: new THREE.Color(0xff00cc) },
  ];

  private currentColorIndex = 0;
  private colorTimer = 3.0;
  private readonly colorDuration = 3.0;

  // Enemy color assignments (enemy → color index)
  private enemyColors = new WeakMap<BaseEnemy, number>();

  // Ambient light we add to the scene for rainbow tinting
  private rainbowAmbient: THREE.AmbientLight | null = null;

  // Flash state: brief intensity boost on color transition
  private flashTimer = 0;
  private readonly flashDuration = 0.3;

  onStart(context: GameModeContext): void {
    // Add a controllable ambient light for scene-wide color tinting
    this.rainbowAmbient = new THREE.AmbientLight(
      this.colors[this.currentColorIndex].value,
      0.5,
    );
    context.scene.add(this.rainbowAmbient);

    // Assign and apply colors to any enemies already present
    const enemies = context.enemySpawner.getEnemies();
    for (const enemy of enemies) {
      const colorIndex = Math.floor(Math.random() * this.colors.length);
      this.enemyColors.set(enemy, colorIndex);
      this._applyEnemyColor(enemy, this.colors[colorIndex].value);
    }

    // Tint the player with the current active color
    if (context.player.setColor) {
      context.player.setColor(this.colors[this.currentColorIndex].value.getHex());
    }
  }

  onFixedUpdate(dt: number, context: GameModeContext): void {
    // Advance flash timer
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
    }

    // Advance color timer
    this.colorTimer -= dt;
    if (this.colorTimer <= 0) {
      this.currentColorIndex = (this.currentColorIndex + 1) % this.colors.length;
      this.colorTimer = this.colorDuration;
      this.flashTimer = this.flashDuration;

      // Tint player to new color
      if (context.player.setColor) {
        context.player.setColor(this.colors[this.currentColorIndex].value.getHex());
      }
    }

    // Update ambient light color + flash intensity
    if (this.rainbowAmbient) {
      this.rainbowAmbient.color.copy(this.colors[this.currentColorIndex].value);
      const flashBoost = this.flashTimer > 0
        ? (this.flashTimer / this.flashDuration) * 1.2
        : 0;
      this.rainbowAmbient.intensity = 0.5 + flashBoost;
    }

    // Assign colors to new enemies and apply to all enemies every frame
    const enemies = context.enemySpawner.getEnemies();
    const instanceManager = context.enemySpawner.getInstanceManager?.();

    for (const enemy of enemies) {
      if (!this.enemyColors.has(enemy)) {
        const colorIndex = Math.floor(Math.random() * this.colors.length);
        this.enemyColors.set(enemy, colorIndex);
      }

      const colorIndex = this.enemyColors.get(enemy)!;
      const colorValue = this.colors[colorIndex].value;

      if (enemy.isInstanced && instanceManager) {
        // Instanced enemy: set color through instance manager
        instanceManager.setEnemyColor(enemy, colorValue);
      } else {
        // Non-instanced: apply emissive color directly to mesh materials
        this._applyEnemyColor(enemy, colorValue);
      }
    }

    // Flush instanced color changes once per frame
    if (instanceManager) {
      instanceManager.flushColors();
    }

    // Keep player colored with current active color (re-apply in case other systems reset it)
    if (context.player.setColor && this.flashTimer <= 0) {
      context.player.setColor(this.colors[this.currentColorIndex].value.getHex());
    }
  }

  onRender(_dt: number, _context: GameModeContext): void {
    // Visual updates handled in onFixedUpdate and HUD overlay
  }

  onEnemyKilled(enemy: BaseEnemy, _context: GameModeContext): number {
    const enemyColorIndex = this.enemyColors.get(enemy);
    if (enemyColorIndex === undefined) {
      return 1.0;
    }
    return enemyColorIndex === this.currentColorIndex ? 3.0 : 0.5;
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

  dispose(context: GameModeContext): void {
    // Remove our ambient light from the scene
    if (this.rainbowAmbient) {
      context.scene.remove(this.rainbowAmbient);
      this.rainbowAmbient = null;
    }

    // Restore enemy emissive to neutral (best effort)
    const enemies = context.enemySpawner.getEnemies();
    for (const enemy of enemies) {
      if (enemy.mesh && !enemy.isInstanced) {
        this._resetEnemyColor(enemy);
      }
    }

    // Restore player color to default cyan
    if (context.player.setColor) {
      context.player.setColor(0x00ffff);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply a strong emissive color to a non-instanced enemy mesh.
   * Only sets emissive (glow) so the enemy's diffuse/shape stays readable.
   */
  private _applyEnemyColor(enemy: BaseEnemy, color: THREE.Color): void {
    if (!enemy.mesh) return;

    _tempColor.copy(color);
    enemy.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive !== undefined) {
          mat.emissive.copy(_tempColor);
          mat.emissiveIntensity = 1.8;
        }
      }
    });
  }

  /**
   * Reset enemy emissive to neutral on dispose.
   */
  private _resetEnemyColor(enemy: BaseEnemy): void {
    if (!enemy.mesh) return;
    enemy.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive !== undefined) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0.4;
        }
      }
    });
  }
}
