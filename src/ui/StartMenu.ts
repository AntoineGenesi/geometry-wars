import { SurfaceType } from '../surfaces/SurfaceFactory';

/**
 * Start menu UI for Geometry Wars.
 * Allows selecting game mode and surface type before starting.
 */

export interface MenuSelection {
  surfaceType: SurfaceType;
  gameMode: 'single' | 'multiplayer' | 'network';
}

export class StartMenu {
  private container: HTMLDivElement;
  private onStartCallback: ((selection: MenuSelection) => void) | null = null;
  private selectedSurface: SurfaceType = 'sphere';

  // Available surfaces with display names
  private readonly surfaces: { type: SurfaceType; name: string; icon: string }[] = [
    { type: 'sphere', name: 'Sphere', icon: '◯' },
    { type: 'cube', name: 'Cube', icon: '◻' },
    { type: 'torus', name: 'Torus', icon: '◎' },
    { type: 'cylinder', name: 'Cylinder', icon: '⬭' },
    { type: 'peanut', name: 'Peanut', icon: '∞' },
    { type: 'capsule', name: 'Capsule', icon: '⬬' },
    { type: 'icosahedron', name: 'Icosahedron', icon: '⬡' },
    { type: 'mobius', name: 'Möbius', icon: '∿' },
    { type: 'dented-sphere', name: 'Dented Sphere', icon: '◐' },
    { type: 'sphere-tunnel', name: 'Sphere Tunnel', icon: '⊕' },
  ];

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'start-menu';
    this.container.innerHTML = this.createMenuHTML();
    this.applyStyles();
    document.body.appendChild(this.container);
    this.attachEventListeners();
  }

  private createMenuHTML(): string {
    const surfaceButtons = this.surfaces
      .map(
        (s) => `
        <button class="surface-btn${s.type === this.selectedSurface ? ' selected' : ''}"
                data-surface="${s.type}">
          <span class="icon">${s.icon}</span>
          <span class="name">${s.name}</span>
        </button>
      `
      )
      .join('');

    return `
      <div class="menu-content">
        <h1 class="title">GEOMETRY WARS</h1>
        <h2 class="subtitle">3D DIMENSIONS</h2>

        <div class="section">
          <h3>SELECT SURFACE</h3>
          <div class="surface-grid">
            ${surfaceButtons}
          </div>
        </div>

        <div class="section game-modes">
          <button class="start-btn" data-mode="single">
            <span class="btn-icon">▶</span>
            <span>QUICK GAME</span>
          </button>
          <button class="start-btn secondary" data-mode="multiplayer">
            <span class="btn-icon">👥</span>
            <span>LOCAL CO-OP</span>
          </button>
          <button class="start-btn secondary" data-mode="network">
            <span class="btn-icon">🌐</span>
            <span>ONLINE</span>
          </button>
        </div>

        <div class="controls-hint">
          <p>WASD - Move | Mouse - Aim | Click - Shoot | Space - Bomb</p>
        </div>
      </div>
    `;
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #start-menu {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #0a0020 0%, #1a0040 50%, #0a0020 100%);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        font-family: 'Segoe UI', Arial, sans-serif;
      }

      #start-menu .menu-content {
        text-align: center;
        max-width: 800px;
        padding: 40px;
      }

      #start-menu .title {
        font-size: 64px;
        font-weight: bold;
        color: #00ffff;
        text-shadow:
          0 0 10px #00ffff,
          0 0 20px #00ffff,
          0 0 40px #0088ff;
        margin: 0;
        letter-spacing: 8px;
      }

      #start-menu .subtitle {
        font-size: 24px;
        color: #ff00ff;
        text-shadow: 0 0 10px #ff00ff;
        margin: 10px 0 40px;
        letter-spacing: 12px;
      }

      #start-menu .section {
        margin: 30px 0;
      }

      #start-menu h3 {
        color: #88ffff;
        font-size: 16px;
        letter-spacing: 4px;
        margin-bottom: 15px;
      }

      #start-menu .surface-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 10px;
        margin: 20px 0;
      }

      #start-menu .surface-btn {
        background: rgba(0, 100, 100, 0.3);
        border: 2px solid #006666;
        color: #00ffff;
        padding: 15px 10px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
      }

      #start-menu .surface-btn:hover {
        background: rgba(0, 150, 150, 0.4);
        border-color: #00ffff;
        transform: scale(1.05);
      }

      #start-menu .surface-btn.selected {
        background: rgba(0, 255, 255, 0.2);
        border-color: #00ffff;
        box-shadow: 0 0 15px #00ffff;
      }

      #start-menu .surface-btn .icon {
        font-size: 28px;
      }

      #start-menu .surface-btn .name {
        font-size: 11px;
        letter-spacing: 1px;
      }

      #start-menu .game-modes {
        display: flex;
        gap: 20px;
        justify-content: center;
        margin-top: 40px;
      }

      #start-menu .start-btn {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border: 2px solid #00ff00;
        color: #ffffff;
        padding: 20px 40px;
        font-size: 18px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 10px;
        letter-spacing: 2px;
      }

      #start-menu .start-btn:hover {
        background: linear-gradient(180deg, #00cc00 0%, #008800 100%);
        transform: scale(1.05);
        box-shadow: 0 0 20px #00ff00;
      }

      #start-menu .start-btn.secondary {
        background: linear-gradient(180deg, #444488 0%, #222244 100%);
        border-color: #8888ff;
        padding: 15px 25px;
        font-size: 14px;
      }

      #start-menu .start-btn.secondary:hover {
        background: linear-gradient(180deg, #5555aa 0%, #333366 100%);
        box-shadow: 0 0 20px #8888ff;
      }

      #start-menu .btn-icon {
        font-size: 20px;
      }

      #start-menu .controls-hint {
        margin-top: 40px;
        color: #666688;
        font-size: 12px;
        letter-spacing: 2px;
      }

      #start-menu.hidden {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  private attachEventListeners(): void {
    // Surface selection buttons
    const surfaceBtns = this.container.querySelectorAll('.surface-btn');
    surfaceBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        // Remove selected from all
        surfaceBtns.forEach((b) => b.classList.remove('selected'));
        // Add to clicked
        btn.classList.add('selected');
        this.selectedSurface = (btn as HTMLElement).dataset.surface as SurfaceType;
      });
    });

    // Start buttons
    const startBtns = this.container.querySelectorAll('.start-btn');
    startBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as 'single' | 'multiplayer' | 'network';
        this.onStartCallback?.({
          surfaceType: this.selectedSurface,
          gameMode: mode,
        });
      });
    });
  }

  /**
   * Set callback for when game starts.
   */
  onStart(callback: (selection: MenuSelection) => void): void {
    this.onStartCallback = callback;
  }

  /**
   * Hide the menu.
   */
  hide(): void {
    this.container.classList.add('hidden');
  }

  /**
   * Show the menu.
   */
  show(): void {
    this.container.classList.remove('hidden');
  }

  /**
   * Remove menu from DOM.
   */
  dispose(): void {
    this.container.remove();
  }
}
