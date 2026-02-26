/**
 * AnimatedCharacterBattleDemo — Full-screen interactive demo: move, shoot, kill.
 *
 * Opens a full-screen overlay on top of the game that:
 *  - Runs a PlaygroundGame instance (player WASD movement, shooting, camera)
 *  - Spawns 3 GLBCharacterEnemy instances on the same sphere surface
 *  - Checks bullet ↔ character collisions each frame
 *  - Plays hit flashes, damage, death animations, and respawns enemies
 *
 * Triggered by the "LIVE MODE" button in OBJDebugPanel.
 * Debug-only — not in the main game code path.
 */

import * as THREE from 'three';
import { PlaygroundGame } from '../core/PlaygroundGame';
import { GLBCharacterEnemy } from './GLBCharacterEnemy';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Character scale for the default sphere surface (surfaceScale=1 → radius ~8). */
const CHAR_SCALE = 0.35;

/** Health per enemy. */
const ENEMY_HEALTH = 3;

/** Respawn delay in milliseconds. */
const RESPAWN_DELAY_MS = 3000;

/** Starting UV positions (spread around the equator). */
const SPAWN_POINTS: Array<{ u: number; v: number }> = [
  { u: 0.15, v: 0.35 },
  { u: 0.55, v: 0.45 },
  { u: 0.35, v: 0.65 },
];

/** GLB character paths (cycled for respawn). */
const CHAR_PATHS = [
  '/characters/knight.glb',
  '/characters/mage.glb',
  '/characters/warrior.glb',
];

// ---------------------------------------------------------------------------
// AnimatedCharacterBattleDemo
// ---------------------------------------------------------------------------

export class AnimatedCharacterBattleDemo {
  private readonly overlay: HTMLDivElement;
  private readonly pg: PlaygroundGame;
  private enemies: GLBCharacterEnemy[] = [];
  private rafId: number | null = null;
  private readonly clock = new THREE.Clock();
  private disposed = false;

  /** Called when the demo closes (e.g. to restore the OBJDebugPanel). */
  onClose?: () => void;

  constructor() {
    this.overlay = this._buildOverlay();
    this.pg = this._createPlayground();
    this.pg.start();

    // Spawn enemies onto the same surface PlaygroundGame uses
    this._spawnEnemies();

    // Our collision + AI loop (separate from PlaygroundGame's internal loop)
    this.clock.start();
    this._tick();
  }

  // -------------------------------------------------------------------------
  // Build overlay DOM
  // -------------------------------------------------------------------------

  private _buildOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'gw-battle-demo-overlay';
    el.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: #000;
      overflow: hidden;
    `;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ EXIT LIVE MODE';
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 1;
      background: rgba(255, 20, 20, 0.2);
      border: 1px solid #ff4444;
      color: #ff6666;
      padding: 8px 16px;
      font: 12px/1 monospace;
      letter-spacing: 2px;
      cursor: pointer;
      transition: all 0.15s;
    `;
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'rgba(255, 20, 20, 0.5)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'rgba(255, 20, 20, 0.2)';
    });
    closeBtn.addEventListener('click', () => this.dispose());
    el.appendChild(closeBtn);

    // HUD hint
    const hint = document.createElement('div');
    hint.textContent = 'WASD: Move  |  Mouse: Aim  |  Click: Shoot';
    hint.style.cssText = `
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(0, 255, 200, 0.5);
      font: 11px monospace;
      letter-spacing: 2px;
      pointer-events: none;
    `;
    el.appendChild(hint);

    document.body.appendChild(el);
    return el;
  }

  // -------------------------------------------------------------------------
  // Create PlaygroundGame
  // -------------------------------------------------------------------------

  private _createPlayground(): PlaygroundGame {
    return new PlaygroundGame({
      container: this.overlay,
      width: window.innerWidth,
      height: window.innerHeight,
      surface: 'sphere',
      enemyCount: 0,   // we spawn our own enemies — no default enemy spawning
      lives: 0,        // infinite lives
    });
  }

  // -------------------------------------------------------------------------
  // Enemy spawning
  // -------------------------------------------------------------------------

  private _spawnEnemies(): void {
    const surface = this.pg.surface;
    const scene = this.pg.game.scene;

    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      this._spawnEnemy(i, SPAWN_POINTS[i].u, SPAWN_POINTS[i].v, scene, surface);
    }
  }

  private _spawnEnemy(
    slot: number,
    u: number,
    v: number,
    scene: THREE.Scene,
    surface: import('../surfaces/Surface').Surface,
  ): void {
    const enemy = new GLBCharacterEnemy(
      {
        glbPath: CHAR_PATHS[slot % CHAR_PATHS.length],
        surface,
        startU: u,
        startV: v,
        walkSpeed: 0,         // GLBCharacterEnemy controls movement
        headingWanderRate: 0, // no wander — faces player
        scale: CHAR_SCALE,
        scene,
      },
      ENEMY_HEALTH,
    );

    enemy.onDead = (dead) => {
      if (this.disposed) return;
      // Remove from scene and enemy list
      scene.remove(dead.char.root);
      dead.dispose();
      this.enemies = this.enemies.filter((e) => e !== dead);

      // Respawn at a random position after delay
      setTimeout(() => {
        if (this.disposed) return;
        this._spawnEnemy(
          slot,
          0.1 + Math.random() * 0.8,
          0.1 + Math.random() * 0.8,
          scene,
          surface,
        );
      }, RESPAWN_DELAY_MS);
    };

    this.enemies.push(enemy);
  }

  // -------------------------------------------------------------------------
  // Per-frame update loop (runs alongside PlaygroundGame's internal loop)
  // -------------------------------------------------------------------------

  private _tick(): void {
    const step = () => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(step);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this._update(dt);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private _update(dt: number): void {
    const player = this.pg.player;
    const playerU = player.surfaceU;
    const playerV = player.surfaceV;
    const surface = this.pg.surface;

    // Update enemy AI + animation
    for (const enemy of this.enemies) {
      enemy.update(dt, playerU, playerV, surface);
    }

    // Bullet → enemy collision
    const enemies = this.enemies; // capture ref to avoid closure issues
    this.pg.bulletPool.forEachActive((i, pos) => {
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (pos.distanceTo(enemy.worldPosition) < enemy.collisionRadius) {
          enemy.takeDamage(1);
          this.pg.bulletPool.kill(i);
          return; // bullet can only hit one enemy
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.pg.stop();

    const scene = this.pg.game.scene;
    for (const enemy of this.enemies) {
      scene.remove(enemy.char.root);
      enemy.dispose();
    }
    this.enemies = [];

    this.overlay.remove();
    this.onClose?.();
  }
}
