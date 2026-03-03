import * as THREE from 'three';

/**
 * Manages floating player name labels above ships using HTML overlay.
 * Labels are CSS-positioned divs that track 3D world positions via projection.
 * More performant than CSS2DRenderer for a small number of labels (1-4 players).
 *
 * Each label optionally shows a health bar above the player name (PvP mode only).
 * Health bar color: green (100%) → yellow (50%) → red (0%).
 */

// Reusable projection vector (zero per-frame allocation)
const _projVec = new THREE.Vector3();

// Lerp factor for screen-space label position smoothing.
// At 60fps this damps 20Hz network corrections (client-prediction snaps)
// while adding only ~2 frames (~33ms) of steady-state lag during smooth motion.
const LABEL_SCREEN_LERP = 0.3;

interface NameLabel {
  element: HTMLDivElement;
  healthBarEl: HTMLDivElement;
  color: number;
  // Smoothed screen position — lerped toward projected position each frame
  // to eliminate visual jitter from network corrections. Initialized on first
  // visible frame to avoid lerping in from an off-screen position.
  smoothX: number;
  smoothY: number;
  hasPosition: boolean;
}

/** Player data passed to update() each frame. */
export interface PlayerLabelData {
  worldPos: THREE.Vector3;
  alive: boolean;
  health?: number;
  maxHealth?: number;
}

export class PlayerNameLabels {
  private container: HTMLDivElement;
  private styleElement: HTMLStyleElement;
  private labels: Map<string, NameLabel> = new Map();
  /** When true, health bars are rendered above name labels. */
  private showHealthBars = false;

  constructor() {
    // Create overlay container
    this.container = document.createElement('div');
    this.container.id = 'player-name-labels';
    this.container.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:50;overflow:hidden;';
    document.body.appendChild(this.container);

    // Create styles
    this.styleElement = document.createElement('style');
    this.styleElement.textContent = `
      .player-name-label {
        position: absolute;
        font: bold 13px monospace;
        text-align: center;
        white-space: nowrap;
        padding: 2px 8px;
        border-radius: 3px;
        background: rgba(0, 0, 0, 0.45);
        text-shadow: 0 0 6px currentColor;
        transform: translate(-50%, -100%);
        pointer-events: none;
        transition: opacity 0.15s;
      }
      .player-name-label .pnl-health-bar-wrap {
        width: 100%;
        height: 4px;
        background: rgba(255,255,255,0.15);
        border-radius: 2px;
        margin-bottom: 2px;
        overflow: hidden;
      }
      .player-name-label .pnl-health-bar {
        height: 100%;
        border-radius: 2px;
        transition: width 0.1s, background-color 0.3s;
      }
      @media (max-width: 900px) and (pointer: coarse) {
        .player-name-label {
          font: bold 9px monospace;
          padding: 1px 5px;
        }
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  /**
   * Enable or disable health bar rendering above name labels.
   * Call this when PvP mode starts/ends.
   */
  setShowHealthBars(show: boolean): void {
    if (this.showHealthBars === show) return;
    this.showHealthBars = show;
    // Show/hide all existing health bar wrappers immediately
    this.labels.forEach((label) => {
      const wrap = label.healthBarEl.parentElement;
      if (wrap) wrap.style.display = show ? 'block' : 'none';
    });
  }

  /**
   * Get or create a label for a player.
   * @param id Player session ID
   * @param name Display name
   * @param color Player color as hex number (e.g. 0x00ffff)
   */
  setLabel(id: string, name: string, color: number): void {
    let label = this.labels.get(id);
    if (!label) {
      const element = document.createElement('div');
      element.className = 'player-name-label';

      // Health bar wrapper (only visible when showHealthBars is true)
      const healthBarWrap = document.createElement('div');
      healthBarWrap.className = 'pnl-health-bar-wrap';
      healthBarWrap.style.display = this.showHealthBars ? 'block' : 'none';
      const healthBarEl = document.createElement('div');
      healthBarEl.className = 'pnl-health-bar';
      healthBarEl.style.width = '100%';
      healthBarEl.style.backgroundColor = '#00ff44';
      healthBarWrap.appendChild(healthBarEl);
      element.appendChild(healthBarWrap);

      // Name text node
      const nameSpan = document.createElement('span');
      element.appendChild(nameSpan);

      this.container.appendChild(element);
      label = { element, healthBarEl, color, smoothX: 0, smoothY: 0, hasPosition: false };
      this.labels.set(id, label);
    }

    // Update name text and color
    const nameSpan = label.element.querySelector('span');
    if (nameSpan) nameSpan.textContent = name;
    label.color = color;
    const cssColor = '#' + color.toString(16).padStart(6, '0');
    label.element.style.color = cssColor;
  }

  /**
   * Remove a player's label.
   */
  removeLabel(id: string): void {
    const label = this.labels.get(id);
    if (label) {
      label.element.remove();
      this.labels.delete(id);
    }
  }

  /**
   * Update all label positions by projecting 3D world positions to screen space.
   * Call this once per frame after camera is updated.
   *
   * @param camera The active camera
   * @param playerPositions Map of player ID -> PlayerLabelData
   */
  update(
    camera: THREE.Camera,
    playerPositions: Map<string, PlayerLabelData>,
  ): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.labels.forEach((label, id) => {
      const playerInfo = playerPositions.get(id);
      if (!playerInfo || !playerInfo.alive) {
        label.element.style.opacity = '0';
        label.hasPosition = false;
        return;
      }

      // Project world position to normalized device coordinates
      _projVec.copy(playerInfo.worldPos);
      _projVec.project(camera);

      // Check if behind camera
      if (_projVec.z > 1) {
        label.element.style.opacity = '0';
        label.hasPosition = false;
        return;
      }

      // Convert to screen coordinates
      const x = ((_projVec.x + 1) / 2) * width;
      // Apply screen-space Y offset (40px above ship center) instead of a
      // world-space camera.up offset. camera.up is lerped at 0.12/frame and
      // lags behind the camera, which caused the label to jitter whenever the
      // player moved on a curved surface (sphere, torus).
      const y = ((-_projVec.y + 1) / 2) * height - 40;

      // Check if off-screen
      if (x < -100 || x > width + 100 || y < -50 || y > height + 50) {
        label.element.style.opacity = '0';
        label.hasPosition = false;
        return;
      }

      // Smooth the screen-space position to eliminate jitter from network
      // corrections (client-prediction snaps). Snap on first visible frame so
      // the label doesn't lerp in from a stale off-screen position.
      if (!label.hasPosition) {
        label.smoothX = x;
        label.smoothY = y;
        label.hasPosition = true;
      } else {
        label.smoothX += (x - label.smoothX) * LABEL_SCREEN_LERP;
        label.smoothY += (y - label.smoothY) * LABEL_SCREEN_LERP;
      }

      label.element.style.opacity = '1';
      label.element.style.left = `${label.smoothX}px`;
      label.element.style.top = `${label.smoothY}px`;

      // Update health bar if PvP mode is active
      if (this.showHealthBars) {
        const health = playerInfo.health ?? 100;
        const maxHealth = playerInfo.maxHealth ?? 100;
        const pct = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 1;
        label.healthBarEl.style.width = `${pct * 100}%`;
        label.healthBarEl.style.backgroundColor = healthBarColor(pct);
      }
    });
  }

  /**
   * Clean up all DOM elements.
   */
  dispose(): void {
    this.labels.forEach((label) => label.element.remove());
    this.labels.clear();
    this.container.remove();
    this.styleElement.remove();
  }
}

/**
 * Returns a CSS color string for a health percentage.
 * green (1.0) → yellow (0.5) → red (0.0)
 */
function healthBarColor(pct: number): string {
  if (pct >= 0.5) {
    // green → yellow: pct 1.0→0.5
    const t = (pct - 0.5) * 2; // 1→0
    const r = Math.round((1 - t) * 255);
    return `rgb(${r},255,0)`;
  } else {
    // yellow → red: pct 0.5→0.0
    const t = pct * 2; // 1→0
    const g = Math.round(t * 255);
    return `rgb(255,${g},0)`;
  }
}
