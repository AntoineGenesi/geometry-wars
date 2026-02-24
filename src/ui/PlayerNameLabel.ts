import * as THREE from 'three';

/**
 * Manages floating player name labels above ships using HTML overlay.
 * Labels are CSS-positioned divs that track 3D world positions via projection.
 * More performant than CSS2DRenderer for a small number of labels (1-4 players).
 */

// Reusable projection vector (zero per-frame allocation)
const _projVec = new THREE.Vector3();

interface NameLabel {
  element: HTMLDivElement;
  color: number;
}

export class PlayerNameLabels {
  private container: HTMLDivElement;
  private styleElement: HTMLStyleElement;
  private labels: Map<string, NameLabel> = new Map();

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
    `;
    document.head.appendChild(this.styleElement);
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
      this.container.appendChild(element);
      label = { element, color };
      this.labels.set(id, label);
    }

    // Update name text and color
    label.element.textContent = name;
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
   * @param playerPositions Map of player ID -> { worldPos, alive }
   */
  update(
    camera: THREE.Camera,
    playerPositions: Map<string, { worldPos: THREE.Vector3; alive: boolean }>,
  ): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.labels.forEach((label, id) => {
      const playerInfo = playerPositions.get(id);
      if (!playerInfo || !playerInfo.alive) {
        label.element.style.opacity = '0';
        return;
      }

      // Project world position to normalized device coordinates
      _projVec.copy(playerInfo.worldPos);
      _projVec.project(camera);

      // Check if behind camera
      if (_projVec.z > 1) {
        label.element.style.opacity = '0';
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
        return;
      }

      label.element.style.opacity = '1';
      label.element.style.left = `${x}px`;
      label.element.style.top = `${y}px`;
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
