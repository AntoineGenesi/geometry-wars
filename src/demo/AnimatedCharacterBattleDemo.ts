/**
 * AnimatedCharacterBattleDemo — Full-screen interactive demo: move, shoot, kill.
 *
 * Opens a full-screen overlay on top of the game that:
 *  - Runs a PlaygroundGame instance (player WASD movement, shooting, camera)
 *  - Spawns 4 GLBCharacterEnemy instances on the same sphere surface
 *  - Checks bullet ↔ character collisions each frame
 *  - Plays hit flashes, damage, death animations, and respawns enemies
 *  - Each enemy has a distinct attack behavior (Melee, Slam, SlowArrow, FastArrow)
 *  - Enemy attacks deal damage visible as a screen flash + HUD indicator
 *
 * Triggered by the "LIVE MODE" button in OBJDebugPanel.
 * Debug-only — not in the main game code path.
 */

import * as THREE from 'three';
import { PlaygroundGame } from '../core/PlaygroundGame';
import { GLBCharacterEnemy } from './GLBCharacterEnemy';
import { CharacterBehaviorSystem } from './CharacterBehaviorSystem';
import { MeleeBehavior } from './behaviors/MeleeBehavior';
import { RadiusSlamBehavior } from './behaviors/RadiusSlamBehavior';
import { SlowArrowBehavior } from './behaviors/SlowArrowBehavior';
import { FastArrowBehavior } from './behaviors/FastArrowBehavior';
import type { AttackType } from './behaviors/AttackBehavior';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Character scale for the default sphere surface (surfaceScale=1 → radius ~8). */
const CHAR_SCALE = 0.35;

/** Health per enemy. */
const ENEMY_HEALTH = 3;

/** Respawn delay in milliseconds. */
const RESPAWN_DELAY_MS = 3000;

/** Starting UV positions (spread around the sphere). */
const SPAWN_POINTS: Array<{ u: number; v: number }> = [
  { u: 0.15, v: 0.35 }, // Melee
  { u: 0.55, v: 0.45 }, // RadiusSlam
  { u: 0.35, v: 0.65 }, // SlowArrow
  { u: 0.75, v: 0.25 }, // FastArrow
];

/** GLB character paths (cycled for respawn). */
const CHAR_PATHS = [
  '/characters/knight.glb',
  '/characters/mage.glb',
  '/characters/warrior.glb',
  '/characters/warrior.glb', // FastArrow uses same model
];

/** Screen flash background colors per attack type. */
const HIT_FLASH_COLORS: Record<AttackType, string> = {
  'melee': 'rgba(255, 30, 30, 0.35)',
  'slam': 'rgba(255, 100, 0, 0.35)',
  'slow-arrow': 'rgba(140, 0, 255, 0.35)',
  'fast-arrow': 'rgba(255, 180, 0, 0.35)',
};

/** Solid text colors per attack type (for indicator label). */
const HIT_TEXT_COLORS: Record<AttackType, string> = {
  'melee': '#ff2222',
  'slam': '#ff6600',
  'slow-arrow': '#9922ff',
  'fast-arrow': '#ffbb00',
};

/** Flash duration in milliseconds. */
const SCREEN_FLASH_DURATION = 350;

// ---------------------------------------------------------------------------
// AnimatedCharacterBattleDemo
// ---------------------------------------------------------------------------

export class AnimatedCharacterBattleDemo {
  private readonly overlay: HTMLDivElement;
  private readonly pg: PlaygroundGame;
  private readonly behaviorSystem: CharacterBehaviorSystem;
  private enemies: GLBCharacterEnemy[] = [];
  private rafId: number | null = null;
  private readonly clock = new THREE.Clock();
  private disposed = false;

  // HUD elements
  private readonly screenFlash: HTMLDivElement;
  private readonly hitIndicator: HTMLDivElement;
  private screenFlashTimer = 0;

  /** Called when the demo closes (e.g. to restore the OBJDebugPanel). */
  onClose?: () => void;

  constructor() {
    this.overlay = this._buildOverlay();
    this.screenFlash = this._buildScreenFlash();
    this.hitIndicator = this._buildHitIndicator();
    this.pg = this._createPlayground();
    this.pg.start();

    // Set up behavior system with player hit callback
    this.behaviorSystem = new CharacterBehaviorSystem(
      this.pg.game.scene,
      (damage, type) => this._onPlayerHit(damage, type),
    );

    // Spawn enemies onto the same surface PlaygroundGame uses
    this._spawnAllEnemies();

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

    // Enemy legend
    const legend = document.createElement('div');
    legend.innerHTML = [
      '<span style="color:#ff2200">■</span> MELEE',
      '<span style="color:#ff6600">■</span> SLAM',
      '<span style="color:#8800ff">■</span> SLOW ARROW',
      '<span style="color:#ffaa00">■</span> FAST ARROW',
    ].join('  ');
    legend.style.cssText = `
      position: absolute;
      top: 16px;
      left: 16px;
      color: rgba(255,255,255,0.5);
      font: 11px monospace;
      letter-spacing: 1px;
      pointer-events: none;
    `;
    el.appendChild(legend);

    document.body.appendChild(el);
    return el;
  }

  private _buildScreenFlash(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.05s;
      z-index: 2;
    `;
    this.overlay?.appendChild(el);
    return el;
  }

  private _buildHitIndicator(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #ff4444;
      font: bold 24px monospace;
      letter-spacing: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.1s;
      z-index: 3;
      text-shadow: 0 0 10px currentColor;
    `;
    this.overlay?.appendChild(el);
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

  private _spawnAllEnemies(): void {
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      this._spawnEnemy(i, SPAWN_POINTS[i].u, SPAWN_POINTS[i].v);
    }
  }

  private _spawnEnemy(slot: number, u: number, v: number): void {
    const surface = this.pg.surface;
    const scene = this.pg.game.scene;

    const enemy = new GLBCharacterEnemy(
      {
        glbPath: CHAR_PATHS[slot % CHAR_PATHS.length],
        surface,
        startU: u,
        startV: v,
        walkSpeed: 0,
        headingWanderRate: 0,
        scale: CHAR_SCALE,
        scene,
      },
      ENEMY_HEALTH,
    );

    // Assign behavior based on slot index
    const behavior = this._createBehaviorForSlot(slot);
    this.behaviorSystem.register(enemy, behavior);

    enemy.onDead = (dead) => {
      if (this.disposed) return;
      this.behaviorSystem.unregister(dead);
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
        );
      }, RESPAWN_DELAY_MS);
    };

    this.enemies.push(enemy);
  }

  private _createBehaviorForSlot(slot: number) {
    switch (slot % 4) {
      case 0: return new MeleeBehavior();
      case 1: return new RadiusSlamBehavior();
      case 2: return new SlowArrowBehavior();
      case 3: return new FastArrowBehavior();
      default: return new MeleeBehavior();
    }
  }

  // -------------------------------------------------------------------------
  // Player hit handling
  // -------------------------------------------------------------------------

  private _onPlayerHit(damage: number, type: AttackType): void {
    if (this.disposed) return;

    // Screen color flash
    const color = HIT_FLASH_COLORS[type];
    this.screenFlash.style.background = color;
    this.screenFlash.style.opacity = '1';
    this.screenFlashTimer = SCREEN_FLASH_DURATION;

    // Center text indicator
    const labels: Record<AttackType, string> = {
      'melee': 'MELEE HIT',
      'slam': 'SLAM HIT',
      'slow-arrow': 'SLOWED',
      'fast-arrow': 'ARROW HIT',
    };
    this.hitIndicator.textContent = labels[type];
    this.hitIndicator.style.color = HIT_TEXT_COLORS[type];
    this.hitIndicator.style.opacity = '1';

    setTimeout(() => {
      if (this.disposed) return;
      this.hitIndicator.style.opacity = '0';
    }, 600);
  }

  // -------------------------------------------------------------------------
  // Per-frame update loop
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
    const playerPos = player.mesh.position;
    const surface = this.pg.surface;

    // Update enemy AI + animation
    for (const enemy of this.enemies) {
      enemy.update(dt, playerU, playerV, surface);
    }

    // Update behavior system (projectiles, cooldowns, attack execution)
    this.behaviorSystem.update(dt, playerPos, playerU, playerV);

    // Bullet → enemy collision
    const enemies = this.enemies;
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

    // Fade out screen flash
    if (this.screenFlashTimer > 0) {
      this.screenFlashTimer -= dt * 1000;
      if (this.screenFlashTimer <= 0) {
        this.screenFlash.style.opacity = '0';
        this.screenFlashTimer = 0;
      }
    }
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

    this.behaviorSystem.dispose();
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
