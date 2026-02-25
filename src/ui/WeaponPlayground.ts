/**
 * Interactive weapon demo/playground that runs inside the WeaponWiki modal.
 *
 * Uses PlaygroundGame for the core game engine (scene, camera, player movement,
 * enemy spawning, collision, game loop) and adds playground-specific UI on top:
 * - Focus/pause management (click to play, ESC to pause)
 * - Stats overlay (DPS, kills, lives, time, surface name)
 * - Damage popups
 * - Hint overlay
 *
 * DESIGN: Uses the REAL game engine via PlaygroundGame, so weapon behavior,
 * enemy AI, collision, and fire rates match the actual game exactly.
 */

import * as THREE from 'three';
import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import { PlaygroundGame } from '../core/PlaygroundGame';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 300;
const ENEMY_COUNT = 8;
const STARTING_LIVES = 3;

// Temp vector for screen projection
const _v1 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Damage popup data
// ---------------------------------------------------------------------------

interface DamagePopup {
  element: HTMLDivElement;
  age: number;
}

// ---------------------------------------------------------------------------
// WeaponPlayground
// ---------------------------------------------------------------------------

export class WeaponPlayground {
  private playgroundGame: PlaygroundGame;
  private container: HTMLElement;
  private surfaceType: SurfaceType;

  private activeWeapon: WeaponType = WeaponType.Standard;

  // Focus & pause state
  private focused = false;
  private paused = false;
  private gameOver = false;

  // Stats
  private dps = 0;
  private kills = 0;
  private elapsed = 0;
  private damageAccum = 0;
  private dpsTimer = 0;

  // Popups
  private popups: DamagePopup[] = [];

  // DOM
  private statsOverlay: HTMLDivElement;
  private popupContainer: HTMLDivElement;
  private hintOverlay: HTMLDivElement;

  // Loop supplement (stats/popup updates run on rAF since PlaygroundGame
  // drives the core game loop internally)
  private rafId = 0;
  private lastTime = 0;
  private disposed = false;

  // Bound handlers (stored for cleanup)
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onCanvasClick: (e: MouseEvent) => void;
  private readonly onDocumentClick: (e: MouseEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onTouchStart: (e: TouchEvent) => void;
  private readonly onTouchMove: (e: TouchEvent) => void;
  private readonly onTouchEnd: (e: TouchEvent) => void;

  // Touch state for drag-to-orbit and pinch-to-zoom
  private touchOrbitActive = false;
  private touchOrbitId: number | null = null;
  private touchOrbitLastX = 0;
  private touchOrbitLastY = 0;
  private touchPinchLastDist = 0;
  private readonly TOUCH_ORBIT_SENSITIVITY = 0.005;

  constructor(container: HTMLElement) {
    this.container = container;

    // Pick a random surface type
    const types = SurfaceFactory.getAvailableTypes();
    this.surfaceType = types[Math.floor(Math.random() * types.length)];

    // Create the real game engine via PlaygroundGame
    this.playgroundGame = new PlaygroundGame({
      container,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      surface: this.surfaceType,
      weapon: this.activeWeapon,
      enemyCount: ENEMY_COUNT,
      lives: STARTING_LIVES,
      surfaceScale: 10,
      cameraDistance: 20,
      bloom: { strength: 0.7, radius: 0.5, threshold: 0.6 },
      onGameOver: () => this.handleGameOver(),
      onEnemyKill: () => this.handleEnemyKill(),
    });

    // Style the canvas
    const canvas = container.querySelector('canvas');
    if (canvas) {
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      canvas.style.borderRadius = '4px';
      canvas.style.border = '1px solid rgba(255,255,255,0.1)';
    }

    // -- Surface name label --
    const surfaceLabel = this.surfaceType.toUpperCase().replace('-', ' ');

    // -- Stats overlay (includes lives + surface name) --
    this.statsOverlay = document.createElement('div');
    this.statsOverlay.style.cssText =
      'display:flex;justify-content:space-between;padding:6px 12px;color:#88aacc;' +
      'font-size:11px;font-family:monospace;letter-spacing:1px;';
    this.statsOverlay.innerHTML =
      `<span id="pg-surface" style="color:#00ffcc;text-transform:uppercase;">${surfaceLabel}</span>` +
      `<span id="pg-lives">LIVES: ${STARTING_LIVES}</span>` +
      '<span id="pg-dps">DPS: 0</span><span id="pg-kills">KILLS: 0</span><span id="pg-time">0.0s</span>';
    container.appendChild(this.statsOverlay);

    // -- Popup container (overlaid on canvas) --
    this.popupContainer = document.createElement('div');
    this.popupContainer.style.cssText =
      'position:relative;width:0;height:0;pointer-events:none;overflow:visible;';
    container.style.position = 'relative';
    container.appendChild(this.popupContainer);

    // -- Hint overlay (click to play / ESC to pause) --
    this.hintOverlay = document.createElement('div');
    this.hintOverlay.style.cssText =
      'position:absolute;top:0;left:50%;transform:translateX(-50%);' +
      `width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;` +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(5,5,16,0.7);border-radius:4px;cursor:pointer;z-index:10;';
    const isTouchDevice = 'ontouchstart' in window;
    this.hintOverlay.innerHTML =
      '<div style="color:#00ffff;font-family:monospace;font-size:16px;letter-spacing:2px;' +
      `text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">${isTouchDevice ? 'TAP TO VIEW' : 'CLICK TO PLAY'}</div>` +
      '<div style="color:#88aacc;font-family:monospace;font-size:11px;letter-spacing:1px;">' +
      (isTouchDevice
        ? 'Drag: Orbit Camera | Pinch: Zoom'
        : 'WASD: Move | Mouse: Aim | Click: Shoot | Scroll: Zoom | ESC: Pause') +
      '</div>';
    container.appendChild(this.hintOverlay);

    // -- Input handlers for focus/pause management --
    // PlaygroundGame's InputManager handles WASD/mouse. We add our own
    // handlers ONLY for focus/pause gating and ESC.
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.focused || this.disposed) return;
      const key = e.key.toLowerCase();

      if (key === 'escape') {
        this.paused = !this.paused;
        if (this.paused) {
          this.playgroundGame.stop();
          this.showOverlay('PAUSED', 'Press ESC to resume or click outside to exit');
        } else {
          this.playgroundGame.start();
          this.hintOverlay.style.display = 'none';
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    this.onKeyUp = () => {
      // No-op; PlaygroundGame's InputManager handles key state
    };

    this.onCanvasClick = (e: MouseEvent) => {
      if (this.disposed) return;

      if (this.gameOver) {
        this.restartGame();
        this.hintOverlay.style.display = 'none';
        return;
      }

      if (this.paused) {
        this.paused = false;
        this.playgroundGame.start();
        this.hintOverlay.style.display = 'none';
        return;
      }

      if (!this.focused) {
        this.focused = true;
        this.hintOverlay.style.display = 'none';
        this.playgroundGame.start();
        this.lastTime = performance.now();
      }
    };

    this.onDocumentClick = (e: MouseEvent) => {
      if (this.disposed) return;
      if (!container.contains(e.target as Node)) {
        if (this.focused && !this.paused) {
          this.releaseFocus();
        }
      }
    };

    this.onWheel = (e: WheelEvent) => {
      if (this.disposed || !this.focused || this.paused) return;
      e.preventDefault();
      const currentDist = this.playgroundGame.getCameraDistance();
      const zoomSpeed = 1.5;
      const delta = e.deltaY > 0 ? zoomSpeed : -zoomSpeed;
      this.playgroundGame.setCameraDistance(currentDist + delta);
    };

    // Touch handlers for drag-to-orbit and pinch-to-zoom in WeaponDB
    this.onTouchStart = (e: TouchEvent) => {
      if (this.disposed || this.paused || this.gameOver) return;
      e.preventDefault();

      if (e.touches.length === 1 && !this.touchOrbitActive) {
        // Single finger drag = orbit camera
        const t = e.touches[0];
        this.touchOrbitActive = true;
        this.touchOrbitId = t.identifier;
        this.touchOrbitLastX = t.clientX;
        this.touchOrbitLastY = t.clientY;
        this.touchPinchLastDist = 0;

        // Focus playground on first touch
        if (!this.focused) {
          this.focused = true;
          this.hintOverlay.style.display = 'none';
          this.playgroundGame.start();
          this.lastTime = performance.now();
        }
      } else if (e.touches.length === 2) {
        // Two fingers = pinch to zoom
        this.touchOrbitActive = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.touchPinchLastDist = Math.sqrt(dx * dx + dy * dy);
      }
    };

    this.onTouchMove = (e: TouchEvent) => {
      if (this.disposed || this.paused || this.gameOver) return;
      e.preventDefault();

      if (e.touches.length === 1 && this.touchOrbitActive) {
        // Single finger drag = orbit
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier !== this.touchOrbitId) continue;
          const dx = t.clientX - this.touchOrbitLastX;
          const dy = t.clientY - this.touchOrbitLastY;
          this.touchOrbitLastX = t.clientX;
          this.touchOrbitLastY = t.clientY;
          const { yaw, pitch } = this.playgroundGame.getOrbitAngles();
          const PITCH_MAX = Math.PI * 0.4;
          this.playgroundGame.setOrbitAngles(
            yaw + dx * this.TOUCH_ORBIT_SENSITIVITY,
            Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch - dy * this.TOUCH_ORBIT_SENSITIVITY)),
          );
        }
      } else if (e.touches.length === 2) {
        // Two fingers = pinch to zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (this.touchPinchLastDist > 0) {
          const delta = (this.touchPinchLastDist - dist) * 0.05;
          this.playgroundGame.setCameraDistance(this.playgroundGame.getCameraDistance() + delta);
        }
        this.touchPinchLastDist = dist;
      }
    };

    this.onTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.touchOrbitId) {
          this.touchOrbitActive = false;
          this.touchOrbitId = null;
        }
      }
      if (e.touches.length < 2) this.touchPinchLastDist = 0;
    };

    window.addEventListener('keydown', this.onKeyDown);
    container.addEventListener('click', this.onCanvasClick);
    container.addEventListener('wheel', this.onWheel, { passive: false });
    container.addEventListener('touchstart', this.onTouchStart, { passive: false });
    container.addEventListener('touchmove', this.onTouchMove, { passive: false });
    container.addEventListener('touchend', this.onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    document.addEventListener('click', this.onDocumentClick);

    // Don't auto-start; wait for user click
    this.lastTime = performance.now();
    this.uiLoop(this.lastTime);
  }

  // -----------------------------------------------------------------------
  // Overlay helpers
  // -----------------------------------------------------------------------

  private showOverlay(title: string, subtitle: string): void {
    this.hintOverlay.innerHTML =
      `<div style="color:#00ffff;font-family:monospace;font-size:16px;letter-spacing:2px;` +
      `text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">${title}</div>` +
      `<div style="color:#88aacc;font-family:monospace;font-size:11px;letter-spacing:1px;">${subtitle}</div>`;
    this.hintOverlay.style.display = 'flex';
  }

  private releaseFocus(): void {
    this.focused = false;
    this.playgroundGame.stop();
    this.showOverlay('CLICK TO PLAY', 'WASD: Move | Mouse: Aim | Click: Shoot | Scroll: Zoom | ESC: Pause');
  }

  // -----------------------------------------------------------------------
  // Game event handlers
  // -----------------------------------------------------------------------

  private handleGameOver(): void {
    this.gameOver = true;
    this.playgroundGame.stop();
    this.showOverlay(
      'GAME OVER',
      `Kills: ${this.kills} | Time: ${this.elapsed.toFixed(1)}s<br>` +
      '<span style="margin-top:8px;display:inline-block;">Click to restart</span>',
    );
  }

  private handleEnemyKill(): void {
    this.kills++;
    this.damageAccum += 1;

    // Spawn damage popup at the most recently killed enemy position
    // (approximate: use player position as fallback)
    const stats = this.playgroundGame.getStats();
    const playerPos = this.playgroundGame.player.mesh.position;
    this.spawnPopup(playerPos, 1);
  }

  private restartGame(): void {
    this.gameOver = false;
    this.kills = 0;
    this.dps = 0;
    this.elapsed = 0;
    this.damageAccum = 0;
    this.dpsTimer = 0;

    // Dispose and recreate PlaygroundGame for clean state
    this.playgroundGame.dispose();

    this.playgroundGame = new PlaygroundGame({
      container: this.container,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      surface: this.surfaceType,
      weapon: this.activeWeapon,
      enemyCount: ENEMY_COUNT,
      lives: STARTING_LIVES,
      surfaceScale: 10,
      cameraDistance: 20,
      bloom: { strength: 0.7, radius: 0.5, threshold: 0.6 },
      onGameOver: () => this.handleGameOver(),
      onEnemyKill: () => this.handleEnemyKill(),
    });

    // Style the new canvas
    const canvas = this.container.querySelector('canvas');
    if (canvas) {
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      canvas.style.borderRadius = '4px';
      canvas.style.border = '1px solid rgba(255,255,255,0.1)';
    }

    this.playgroundGame.start();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  setWeapon(weaponType: string): void {
    const wt = weaponType as WeaponType;
    if (!WEAPON_CONFIGS[wt]) return;
    if (wt === this.activeWeapon) return;

    this.activeWeapon = wt;

    // Reset stats
    this.dps = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.damageAccum = 0;
    this.dpsTimer = 0;
    this.gameOver = false;
    this.hintOverlay.style.display = this.focused ? 'none' : 'flex';

    // Switch weapon in the real game engine
    this.playgroundGame.setWeapon(wt);
  }

  dispose(): void {
    this.disposed = true;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    // Remove event listeners
    window.removeEventListener('keydown', this.onKeyDown);
    this.container.removeEventListener('click', this.onCanvasClick);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('touchstart', this.onTouchStart);
    this.container.removeEventListener('touchmove', this.onTouchMove);
    this.container.removeEventListener('touchend', this.onTouchEnd);
    this.container.removeEventListener('touchcancel', this.onTouchEnd);
    document.removeEventListener('click', this.onDocumentClick);

    // Dispose popups
    for (const p of this.popups) {
      p.element.remove();
    }
    this.popups = [];

    // Dispose game engine
    this.playgroundGame.dispose();

    // Remove DOM elements
    this.statsOverlay.remove();
    this.popupContainer.remove();
    this.hintOverlay.remove();
  }

  // -----------------------------------------------------------------------
  // UI loop (updates stats + popups; game loop is driven by PlaygroundGame)
  // -----------------------------------------------------------------------

  private uiLoop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.uiLoop);

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.max(1 / 120, Math.min(rawDt, 1 / 30));

    if (!this.focused || this.paused || this.gameOver) return;

    this.elapsed += dt;
    this.dpsTimer += dt;

    // DPS calculation (1-second rolling window)
    if (this.dpsTimer >= 1.0) {
      this.dps = Math.round(this.damageAccum / this.dpsTimer);
      this.damageAccum = 0;
      this.dpsTimer = 0;
    }

    this.updatePopups(dt);
    this.updateStats();
  };

  // -----------------------------------------------------------------------
  // Damage popups
  // -----------------------------------------------------------------------

  private spawnPopup(worldPos: THREE.Vector3, damage: number): void {
    _v1.copy(worldPos);
    _v1.project(this.playgroundGame.game.camera);
    const screenX = ((_v1.x + 1) / 2) * CANVAS_WIDTH;
    const screenY = ((1 - _v1.y) / 2) * CANVAS_HEIGHT;

    // If behind camera, skip
    if (_v1.z > 1) return;

    const el = document.createElement('div');
    el.textContent = damage >= 1 ? Math.round(damage).toString() : damage.toFixed(1);
    el.style.cssText =
      `position:absolute;color:#ffff44;font-size:12px;font-weight:bold;font-family:monospace;` +
      `pointer-events:none;text-shadow:0 0 4px #ff8800;white-space:nowrap;z-index:10;` +
      `left:${screenX}px;top:${screenY - CANVAS_HEIGHT - 40}px;transition:all 0.6s ease-out;opacity:1;`;
    this.popupContainer.appendChild(el);

    // Animate up + fade
    requestAnimationFrame(() => {
      el.style.transform = 'translateY(-20px)';
      el.style.opacity = '0';
    });

    this.popups.push({ element: el, age: 0 });
  }

  private updatePopups(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].age += dt;
      if (this.popups[i].age > 0.7) {
        this.popups[i].element.remove();
        this.popups.splice(i, 1);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Stats overlay
  // -----------------------------------------------------------------------

  private updateStats(): void {
    const stats = this.playgroundGame.getStats();

    const livesEl = this.statsOverlay.querySelector('#pg-lives');
    const dpsEl = this.statsOverlay.querySelector('#pg-dps');
    const killsEl = this.statsOverlay.querySelector('#pg-kills');
    const timeEl = this.statsOverlay.querySelector('#pg-time');
    if (livesEl) livesEl.textContent = `LIVES: ${stats.lives}`;
    if (dpsEl) dpsEl.textContent = `DPS: ${this.dps}`;
    if (killsEl) killsEl.textContent = `KILLS: ${this.kills}`;
    if (timeEl) timeEl.textContent = `${this.elapsed.toFixed(1)}s`;
  }
}
