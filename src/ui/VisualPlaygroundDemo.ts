/**
 * Playable visual style demo for the Visual Playground.
 *
 * When a user clicks a visual style thumbnail, this class creates a full-screen
 * playable mini-game with that visual style applied.
 *
 * DESIGN: Uses GameInstance for the core game engine (scene, camera, player,
 * enemies, collision, game loop). This class adds:
 * - Full-screen overlay container
 * - Visual preset application (grid material, surface material, bloom, Sektori shader)
 * - Focus/pause/game-over state management
 * - Stats overlay + hint overlay
 * - Close/back button
 */

import * as THREE from 'three';
import { GameInstance } from '../core/GameInstance';
import { SurfaceType } from '../surfaces/SurfaceFactory';
import {
  createSektoriGridMaterial,
  updateSektoriUniforms,
  SektoriTrailManager,
} from '../rendering/SektoriGridMaterial';
import type { VisualPreset } from './VisualPlayground';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEMO_WIDTH = 800;
const DEMO_HEIGHT = 600;
const ENEMY_COUNT = 8;
// Lives: 0 = infinite respawns (demo/playground mode). The player never sees game over.
const STARTING_LIVES = 0;

// ---------------------------------------------------------------------------
// VisualPlaygroundDemo
// ---------------------------------------------------------------------------

export class VisualPlaygroundDemo {
  private gameInstance: GameInstance;
  private overlay: HTMLDivElement;
  private canvasContainer: HTMLDivElement;

  // Focus & pause state
  private focused = false;
  private paused = false;
  private gameOver = false;

  // Stats
  private kills = 0;
  private elapsed = 0;
  private lives = STARTING_LIVES;

  // Sektori state
  private sektoriMaterial: THREE.ShaderMaterial | null = null;
  private sektoriTrail: SektoriTrailManager | null = null;
  private elapsedTime = 0;

  // DOM
  private statsOverlay: HTMLDivElement;
  private hintOverlay: HTMLDivElement;

  // Background color (stored for flash reset)
  private bgColor: THREE.Color;

  // Loop supplement
  private rafId = 0;
  private lastTime = 0;
  private disposed = false;

  private closeCallback: (() => void) | null = null;
  private preset: VisualPreset;
  private surfaceType: SurfaceType;

  // Bound handlers (stored for cleanup)
  private readonly onKeyDownHandler: (e: KeyboardEvent) => void;
  private readonly onCanvasClickHandler: (e: MouseEvent) => void;
  private readonly onDocumentClickHandler: (e: MouseEvent) => void;
  private readonly onWheelHandler: (e: WheelEvent) => void;

  constructor(preset: VisualPreset, surfaceType: SurfaceType) {
    this.preset = preset;
    this.surfaceType = surfaceType;

    // Background color based on preset
    this.bgColor = new THREE.Color(preset.surfaceColor || 0x050510);
    this.bgColor.multiplyScalar(0.5);
    if (this.bgColor.r < 0.02 && this.bgColor.g < 0.02 && this.bgColor.b < 0.06) {
      this.bgColor.setHex(0x050510);
    }

    // -- Create overlay --
    this.overlay = document.createElement('div');
    this.overlay.className = 'vp-demo-overlay';
    this.overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(5,2,15,0.98);z-index:2100;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:12px;font-family:"Segoe UI",monospace;';

    // -- Title bar --
    const titleBar = document.createElement('div');
    titleBar.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;' +
      `width:${DEMO_WIDTH}px;`;

    const title = document.createElement('div');
    title.style.cssText =
      'color:#00ffff;font:bold 18px monospace;letter-spacing:3px;' +
      'text-shadow:0 0 10px #00ffff;';
    title.textContent = preset.name;

    const backBtn = document.createElement('button');
    backBtn.style.cssText =
      'background:rgba(80,30,0,0.5);border:1px solid #884400;' +
      'color:#ff8800;padding:8px 24px;font:bold 13px monospace;' +
      'letter-spacing:2px;cursor:pointer;transition:all 0.2s;';
    backBtn.textContent = 'BACK';
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.background = 'rgba(120,50,0,0.6)';
      backBtn.style.boxShadow = '0 0 12px #ff8800';
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.background = 'rgba(80,30,0,0.5)';
      backBtn.style.boxShadow = 'none';
    });
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    titleBar.appendChild(title);
    titleBar.appendChild(backBtn);
    this.overlay.appendChild(titleBar);

    // -- Canvas container (GameInstance renders into this) --
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.style.cssText =
      `position:relative;display:inline-block;width:${DEMO_WIDTH}px;height:${DEMO_HEIGHT}px;`;

    // -- Hint overlay (click to play) --
    this.hintOverlay = document.createElement('div');
    this.hintOverlay.style.cssText =
      `position:absolute;top:0;left:0;width:${DEMO_WIDTH}px;height:${DEMO_HEIGHT}px;` +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(5,5,16,0.7);border-radius:4px;cursor:pointer;z-index:10;' +
      'pointer-events:auto;';
    this.hintOverlay.innerHTML =
      '<div style="color:#00ffff;font:16px monospace;letter-spacing:2px;' +
      'text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">CLICK TO PLAY</div>' +
      '<div style="color:#88aacc;font:11px monospace;letter-spacing:1px;">' +
      'WASD: Move | Mouse: Aim | Click: Shoot | Scroll: Zoom | ESC: Back</div>';
    this.canvasContainer.appendChild(this.hintOverlay);

    this.overlay.appendChild(this.canvasContainer);

    // -- Stats overlay --
    this.statsOverlay = document.createElement('div');
    this.statsOverlay.style.cssText =
      `display:flex;justify-content:space-between;width:${DEMO_WIDTH}px;` +
      'padding:6px 12px;color:#88aacc;font:11px monospace;letter-spacing:1px;';
    this.statsOverlay.innerHTML =
      `<span style="color:#00ffcc;text-transform:uppercase;">${surfaceType} | ${preset.name}</span>` +
      '<span id="vpd-lives">LIVES: ∞</span>' +
      '<span id="vpd-kills">KILLS: 0</span>' +
      '<span id="vpd-time">0.0s</span>';
    this.overlay.appendChild(this.statsOverlay);

    // -- Description --
    const desc = document.createElement('div');
    desc.style.cssText =
      `color:#668888;font:12px monospace;text-align:center;max-width:${DEMO_WIDTH}px;letter-spacing:1px;`;
    desc.textContent = preset.description;
    this.overlay.appendChild(desc);

    // -- Add overlay to DOM BEFORE creating GameInstance --
    // CRITICAL: GameInstance constructor calls input.setContainer(container),
    // which calls getBoundingClientRect(). The container MUST be in the DOM
    // for getBoundingClientRect() to return correct dimensions. Without this,
    // viewport width/height are 0, causing division-by-zero in aim calculation
    // (mouseX - cx) / halfMin = NaN, making mouse aim completely broken.
    document.body.appendChild(this.overlay);

    // -- Create GameInstance (container is now in the DOM) --
    this.gameInstance = new GameInstance({
      container: this.canvasContainer,
      width: DEMO_WIDTH,
      height: DEMO_HEIGHT,
      surface: surfaceType,
      lockedWeapon: null, mode: 'demo' as any, // free weapon swaps
      enemyCount: ENEMY_COUNT,
      lives: STARTING_LIVES,
      surfaceScale: 10,
      cameraDistance: 20,
      bloom: {
        strength: preset.bloomStrength,
        radius: preset.bloomRadius ?? 0.4,
        threshold: preset.bloomThreshold ?? 0.85,
      },
      // Pass preset grid density so the demo surface matches the thumbnail exactly
      gridSegmentsU: preset.gridSegmentsU,
      gridSegmentsV: preset.gridSegmentsV,
      onGameOver: () => this.handleGameOver(),
      onEnemyKill: () => this.handleEnemyKill(),
    });

    // Style the canvas
    const canvas = this.canvasContainer.querySelector('canvas');
    if (canvas) {
      canvas.style.cssText =
        'display:block;border:1px solid rgba(0,255,255,0.2);border-radius:4px;cursor:crosshair;';
    }

    // -- Apply visual preset to surface and scene --
    this.applyVisualPreset();

    // -- Input handlers --
    this.onKeyDownHandler = (e: KeyboardEvent) => {
      if (!this.focused || this.disposed) return;
      const key = e.key.toLowerCase();

      if (key === 'escape') {
        if (this.paused) {
          this.paused = false;
          this.gameInstance.start();
          this.hintOverlay.style.display = 'none';
        } else {
          this.close();
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (['w', 'a', 's', 'd'].includes(key)) {
        e.preventDefault();
      }
    };

    this.onCanvasClickHandler = (_e: MouseEvent) => {
      if (this.disposed) return;

      if (this.gameOver) {
        this.restartGame();
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now();
        return;
      }

      if (this.paused) {
        this.paused = false;
        this.gameInstance.start();
        this.hintOverlay.style.display = 'none';
        this.lastTime = performance.now();
        return;
      }

      if (!this.focused) {
        this.focused = true;
        this.hintOverlay.style.display = 'none';
        this.gameInstance.start();
        this.lastTime = performance.now();
      }
    };

    this.onDocumentClickHandler = (e: MouseEvent) => {
      if (this.disposed) return;
      if (!this.overlay.contains(e.target as Node)) return;
      if (!this.canvasContainer.contains(e.target as Node) && this.focused && !this.paused) {
        this.releaseFocus();
      }
    };

    this.onWheelHandler = (e: WheelEvent) => {
      if (this.disposed || !this.focused || this.paused) return;
      e.preventDefault();
      const currentDist = this.gameInstance.getCameraDistance();
      const zoomSpeed = 1.5;
      const delta = e.deltaY > 0 ? zoomSpeed : -zoomSpeed;
      this.gameInstance.setCameraDistance(currentDist + delta);
    };

    window.addEventListener('keydown', this.onKeyDownHandler);
    this.canvasContainer.addEventListener('click', this.onCanvasClickHandler);
    this.canvasContainer.addEventListener('wheel', this.onWheelHandler, { passive: false });
    document.addEventListener('click', this.onDocumentClickHandler);

    // NOTE: Sektori glow is updated in uiLoop (not game.onRender) because
    // GameInstance.start() overwrites game.onRender, making any pre-start
    // override a no-op. The uiLoop runs at RAF rate and is sufficient.

    // Wire UI loop for stats + Sektori updates when paused
    this.lastTime = performance.now();
    this.uiLoop(this.lastTime);
  }

  // -----------------------------------------------------------------------
  // Visual preset application
  // -----------------------------------------------------------------------

  private applyVisualPreset(): void {
    const preset = this.preset;
    const surface = this.gameInstance.surface;
    const scene = this.gameInstance.game.scene;

    // Set scene background
    scene.background = this.bgColor.clone();

    // Apply surface material from preset.
    // Use MeshBasicMaterial (unlit) so colors match the thumbnails exactly —
    // MeshStandardMaterial (PBR) darkens under scene lighting, causing the
    // "grey/muted" appearance the user reported.
    if (preset.wireframeOnly) {
      surface.mesh.visible = false;
    } else {
      if (surface.mesh.material instanceof THREE.Material) {
        surface.mesh.material.dispose();
      }
      surface.mesh.material = new THREE.MeshBasicMaterial({
        color: preset.surfaceColor,
        transparent: true,
        opacity: preset.surfaceOpacity,
        side: THREE.DoubleSide,
      });
    }

    // Apply grid material (Sektori shader or standard LineBasicMaterial)
    if (preset.sektoriConfig) {
      // Scale the Sektori glow radius for the demo's larger surface.
      // Thumbnails are scaled to fit radius ~3 (VisualPlayground.createCell scaleFactor).
      // The demo uses surfaceScale:10, giving a surface with bounding sphere radius ~10-11.
      // Without scaling, the same glowRadius covers a much smaller fraction of the demo surface,
      // making most of the grid appear dark/grey (only ~36% coverage vs ~133% in the thumbnail).
      surface.mesh.geometry.computeBoundingSphere();
      const surfaceRadius = surface.mesh.geometry.boundingSphere?.radius ?? 10;
      const THUMBNAIL_SURFACE_RADIUS = 3.0;
      const glowScale = surfaceRadius / THUMBNAIL_SURFACE_RADIUS;
      const scaledSektoriConfig = {
        ...preset.sektoriConfig,
        glowRadius: (preset.sektoriConfig.glowRadius ?? 4.0) * glowScale,
      };
      this.sektoriMaterial = createSektoriGridMaterial(scaledSektoriConfig);
      this.sektoriTrail = new SektoriTrailManager(scaledSektoriConfig);
      if (surface.gridMesh.material instanceof THREE.Material) {
        surface.gridMesh.material.dispose();
      }
      surface.gridMesh.material = this.sektoriMaterial;
    } else {
      if (surface.gridMesh.material instanceof THREE.Material) {
        surface.gridMesh.material.dispose();
      }
      surface.gridMesh.material = new THREE.LineBasicMaterial({
        color: preset.gridColor,
        transparent: true,
        opacity: preset.gridOpacity,
      });
    }

    // Apply bloom settings (works for both WebGL2 and WebGPU)
    this.gameInstance.game.setBloomSettings(
      preset.bloomStrength,
      preset.bloomThreshold ?? 0.85
    );
    // Radius is WebGL2-only
    if (this.gameInstance.game.bloomPass && preset.bloomRadius !== undefined) {
      this.gameInstance.game.bloomPass.radius = preset.bloomRadius;
    }
  }

  // -----------------------------------------------------------------------
  // Sektori glow update
  // -----------------------------------------------------------------------

  private updateSektoriGlow(_dt?: number): void {
    if (!this.sektoriMaterial || !this.sektoriTrail) return;
    const playerPos = this.gameInstance.player.mesh.position;
    // elapsedTime is already incremented by the caller (uiLoop)
    updateSektoriUniforms(this.sektoriMaterial, playerPos, this.elapsedTime);
    this.sektoriTrail.recordPosition(playerPos);
    this.sektoriTrail.updateMaterial(this.sektoriMaterial);
  }

  // -----------------------------------------------------------------------
  // Game event handlers
  // -----------------------------------------------------------------------

  private handleGameOver(): void {
    this.gameOver = true;
    this.gameInstance.stop();
    this.showOverlay(
      'GAME OVER',
      `Kills: ${this.kills} | Time: ${this.elapsed.toFixed(1)}s<br>` +
      '<span style="margin-top:8px;display:inline-block;">Click to restart</span>',
    );
  }

  private handleEnemyKill(): void {
    this.kills++;
  }

  private restartGame(): void {
    this.gameOver = false;
    this.kills = 0;
    this.elapsed = 0;
    this.lives = STARTING_LIVES;

    // Free old WebGL context explicitly before creating new one
    const gl = this.gameInstance.game.renderer.getContext();
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (loseExt) loseExt.loseContext();

    // Dispose and recreate GameInstance for clean state
    this.gameInstance.dispose();

    this.gameInstance = new GameInstance({
      container: this.canvasContainer,
      width: DEMO_WIDTH,
      height: DEMO_HEIGHT,
      surface: this.surfaceType,
      lockedWeapon: null, mode: 'demo' as any,
      enemyCount: ENEMY_COUNT,
      lives: STARTING_LIVES,
      surfaceScale: 10,
      cameraDistance: 20,
      bloom: {
        strength: this.preset.bloomStrength,
        radius: this.preset.bloomRadius ?? 0.4,
        threshold: this.preset.bloomThreshold ?? 0.85,
      },
      gridSegmentsU: this.preset.gridSegmentsU,
      gridSegmentsV: this.preset.gridSegmentsV,
      onGameOver: () => this.handleGameOver(),
      onEnemyKill: () => this.handleEnemyKill(),
    });

    // Style the new canvas
    const canvas = this.canvasContainer.querySelector('canvas');
    if (canvas) {
      canvas.style.cssText =
        'display:block;border:1px solid rgba(0,255,255,0.2);border-radius:4px;cursor:crosshair;';
    }

    // Re-apply visual preset
    this.applyVisualPreset();

    // Sektori glow is handled by uiLoop (no game.onRender override needed)
    this.gameInstance.start();
  }

  // -----------------------------------------------------------------------
  // UI helpers
  // -----------------------------------------------------------------------

  private showOverlay(titleText: string, subtitle: string): void {
    this.hintOverlay.innerHTML =
      `<div style="color:#00ffff;font:16px monospace;letter-spacing:2px;` +
      `text-shadow:0 0 10px #00ffff,0 0 20px #0088aa;margin-bottom:8px;">${titleText}</div>` +
      `<div style="color:#88aacc;font:11px monospace;letter-spacing:1px;">${subtitle}</div>`;
    this.hintOverlay.style.display = 'flex';
  }

  private releaseFocus(): void {
    this.focused = false;
    this.gameInstance.stop();
    this.showOverlay('CLICK TO PLAY', 'WASD: Move | Mouse: Aim | Click: Shoot | Scroll: Zoom | ESC: Back');
  }

  // -----------------------------------------------------------------------
  // UI loop (stats update + Sektori glow when paused)
  // -----------------------------------------------------------------------

  private uiLoop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.uiLoop);

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.max(1 / 120, Math.min(rawDt, 1 / 30));

    // Update Sektori glow every frame (works when paused or playing)
    if (this.sektoriMaterial && this.sektoriTrail) {
      this.elapsedTime += dt;
      this.updateSektoriGlow(dt);
    }

    if (!this.focused || this.paused || this.gameOver) return;

    this.elapsed += dt;
    this.updateStats();
  };

  private updateStats(): void {
    const livesEl = this.statsOverlay.querySelector('#vpd-lives');
    const killsEl = this.statsOverlay.querySelector('#vpd-kills');
    const timeEl = this.statsOverlay.querySelector('#vpd-time');
    // STARTING_LIVES === 0 means infinite respawns; always show ∞
    if (livesEl) livesEl.textContent = STARTING_LIVES === 0 ? 'LIVES: ∞' : `LIVES: ${this.gameInstance.getStats().lives}`;
    if (killsEl) killsEl.textContent = `KILLS: ${this.kills}`;
    if (timeEl) timeEl.textContent = `${this.elapsed.toFixed(1)}s`;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  close(): void {
    this.dispose();
    this.closeCallback?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    // Remove event listeners
    window.removeEventListener('keydown', this.onKeyDownHandler);
    this.canvasContainer.removeEventListener('click', this.onCanvasClickHandler);
    this.canvasContainer.removeEventListener('wheel', this.onWheelHandler);
    document.removeEventListener('click', this.onDocumentClickHandler);

    // Dispose Sektori material
    if (this.sektoriMaterial) this.sektoriMaterial.dispose();
    this.sektoriMaterial = null;
    this.sektoriTrail = null;

    // Explicitly lose WebGL context to free GPU resources immediately.
    // Without this, the browser may keep stale contexts alive until GC,
    // causing new demos to fail silently when the context limit is reached.
    const gl = this.gameInstance.game.renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();

    // Dispose game engine
    this.gameInstance.dispose();

    // Remove DOM
    this.overlay.remove();
  }
}
