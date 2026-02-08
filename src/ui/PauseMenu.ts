import { ConfigurableInput } from '../input/ConfigurableInput';
import { ControlsMenu } from './ControlsMenu';
import { WeaponWiki } from './WeaponWiki';
import { BackgroundMusic } from '../audio/BackgroundMusic';

/**
 * Pause menu overlay.
 * Shows when Escape is pressed, allows resuming or returning to main menu.
 */

export class PauseMenu {
  private container: HTMLDivElement;
  private onResumeCallback: (() => void) | null = null;
  private onExitCallback: (() => void) | null = null;
  private isPaused: boolean = false;
  private bgMusic: BackgroundMusic | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'pause-menu';
    this.container.innerHTML = this.createMenuHTML();
    this.applyStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
    this.attachEventListeners();
  }

  private createMenuHTML(): string {
    return `
      <div class="pause-content">
        <h1 class="pause-title">PAUSED</h1>

        <div class="pause-buttons">
          <button class="pause-btn resume-btn" data-action="resume">
            <span class="btn-icon">▶</span>
            <span>RESUME</span>
          </button>
          <button class="pause-btn controls-btn" data-action="controls">
            <span class="btn-icon">⌨</span>
            <span>CONTROLS</span>
          </button>
          <button class="pause-btn weapons-btn" data-action="weapons">
            <span class="btn-icon">⚡</span>
            <span>WEAPONS</span>
          </button>
          <button class="pause-btn music-btn" data-action="music">
            <span class="btn-icon">♪</span>
            <span class="music-label">MUSIC: ELECTRONIC</span>
          </button>
          <button class="pause-btn exit-btn" data-action="exit">
            <span class="btn-icon">◀</span>
            <span>EXIT TO MENU</span>
          </button>
        </div>

        <div class="pause-hint">
          <p>Press ESC to resume | M to mute | N to cycle music</p>
        </div>
      </div>
    `;
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #pause-menu {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 20, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2000;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(5px);
      }

      #pause-menu.hidden {
        display: none;
      }

      #pause-menu .pause-content {
        text-align: center;
        padding: 40px;
      }

      #pause-menu .pause-title {
        font-size: 72px;
        font-weight: bold;
        color: #ffff00;
        text-shadow:
          0 0 10px #ffff00,
          0 0 20px #ffaa00,
          0 0 40px #ff8800;
        margin: 0 0 50px;
        letter-spacing: 12px;
      }

      #pause-menu .pause-buttons {
        display: flex;
        flex-direction: column;
        gap: 20px;
        align-items: center;
      }

      #pause-menu .pause-btn {
        background: linear-gradient(180deg, #333366 0%, #222244 100%);
        border: 2px solid #6666aa;
        color: #ffffff;
        padding: 20px 50px;
        font-size: 20px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 15px;
        letter-spacing: 3px;
        min-width: 280px;
        justify-content: center;
      }

      #pause-menu .pause-btn:hover {
        transform: scale(1.05);
      }

      #pause-menu .resume-btn {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border-color: #00ff00;
      }

      #pause-menu .resume-btn:hover {
        background: linear-gradient(180deg, #00cc00 0%, #008800 100%);
        box-shadow: 0 0 25px #00ff00;
      }

      #pause-menu .controls-btn {
        background: linear-gradient(180deg, #336688 0%, #224466 100%);
        border-color: #44aaff;
      }

      #pause-menu .controls-btn:hover {
        background: linear-gradient(180deg, #4488aa 0%, #336688 100%);
        box-shadow: 0 0 20px #44aaff;
      }

      #pause-menu .weapons-btn {
        background: linear-gradient(180deg, #886633 0%, #664422 100%);
        border-color: #ffaa44;
      }

      #pause-menu .weapons-btn:hover {
        background: linear-gradient(180deg, #aa8844 0%, #886633 100%);
        box-shadow: 0 0 20px #ffaa44;
      }

      #pause-menu .music-btn {
        background: linear-gradient(180deg, #663366 0%, #442244 100%);
        border-color: #cc44ff;
      }

      #pause-menu .music-btn:hover {
        background: linear-gradient(180deg, #884488 0%, #663366 100%);
        box-shadow: 0 0 20px #cc44ff;
      }

      #pause-menu .exit-btn:hover {
        background: linear-gradient(180deg, #444488 0%, #333366 100%);
        box-shadow: 0 0 20px #8888ff;
      }

      #pause-menu .btn-icon {
        font-size: 24px;
      }

      #pause-menu .pause-hint {
        margin-top: 40px;
        color: #666688;
        font-size: 14px;
        letter-spacing: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  private attachEventListeners(): void {
    // Button clicks
    const resumeBtn = this.container.querySelector('[data-action="resume"]');
    const exitBtn = this.container.querySelector('[data-action="exit"]');

    const controlsBtn = this.container.querySelector('[data-action="controls"]');

    resumeBtn?.addEventListener('click', () => {
      this.resume();
    });

    controlsBtn?.addEventListener('click', () => {
      const tempInput = new ConfigurableInput(4);
      const controlsMenu = new ControlsMenu();
      controlsMenu.setInput(tempInput);
      controlsMenu.show();
      controlsMenu.onClose(() => {
        tempInput.dispose();
      });
    });

    const weaponsBtn = this.container.querySelector('[data-action="weapons"]');
    weaponsBtn?.addEventListener('click', () => {
      const wiki = new WeaponWiki();
      wiki.show();
      wiki.onClose(() => {
        wiki.dispose();
      });
    });

    const musicBtn = this.container.querySelector('[data-action="music"]');
    musicBtn?.addEventListener('click', () => {
      if (this.bgMusic) {
        const preset = this.bgMusic.cyclePreset();
        const name = this.bgMusic.getPresetDisplayName(preset);
        const label = this.container.querySelector('.music-label');
        if (label) label.textContent = `MUSIC: ${name.toUpperCase()}`;
      }
    });

    exitBtn?.addEventListener('click', () => {
      this.hide();
      this.onExitCallback?.();
    });

    // Escape key to toggle
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.isPaused) {
          this.resume();
        }
        // Note: showing pause is handled externally
      }
    });
  }

  /**
   * Show the pause menu and pause the game.
   */
  show(): void {
    this.isPaused = true;
    this.updateMusicLabel();
    this.container.classList.remove('hidden');
  }

  /**
   * Hide the pause menu and resume the game.
   */
  hide(): void {
    this.isPaused = false;
    this.container.classList.add('hidden');
  }

  /**
   * Resume the game.
   */
  resume(): void {
    this.hide();
    this.onResumeCallback?.();
  }

  /**
   * Check if game is paused.
   */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * Set the BackgroundMusic instance for preset cycling in the pause menu.
   */
  setMusic(music: BackgroundMusic): void {
    this.bgMusic = music;
    this.updateMusicLabel();
  }

  private updateMusicLabel(): void {
    if (!this.bgMusic) return;
    const label = this.container.querySelector('.music-label');
    if (label) {
      const name = this.bgMusic.getPresetDisplayName();
      label.textContent = `MUSIC: ${name.toUpperCase()}`;
    }
  }

  /**
   * Set callback for when resume is clicked.
   */
  onResume(callback: () => void): void {
    this.onResumeCallback = callback;
  }

  /**
   * Set callback for when exit to menu is clicked.
   */
  onExit(callback: () => void): void {
    this.onExitCallback = callback;
  }

  /**
   * Remove from DOM.
   */
  dispose(): void {
    this.container.remove();
  }
}
