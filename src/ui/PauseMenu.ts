import { ConfigurableInput } from '../input/ConfigurableInput';
import { ControlsMenu } from './ControlsMenu';
import { WeaponWiki } from './WeaponWiki';
import { SettingsMenu } from './SettingsMenu';
import { BackgroundMusic } from '../audio/BackgroundMusic';
import { PerformanceLogger } from '../core/PerformanceLogger';
import { createQRCodeDisplay } from './QRCode';

/**
 * Pause menu overlay.
 * Shows when Escape is pressed, allows resuming or returning to main menu.
 * Displays active buffs with descriptions, total kills, and weapon stats.
 */

/** Callbacks for host network actions */
export interface PauseMenuNetworkCallbacks {
  onPause: (paused: boolean) => void;
  onEndGame: () => void;
  onStopServer?: () => void;
}

/** Data passed to the pause menu for the stats info panel */
export interface PauseMenuGameData {
  /** Active buffs with stack counts and descriptions */
  buffs: Array<{
    name: string;
    stacks: number;
    description: string;
    /** Current computed value string, e.g. "+45% damage" */
    currentValue: string;
    /** CSS-compatible hex color for the icon */
    color: string;
  }>;
  /** Total kills across all enemy types */
  totalKills: number;
  /** Current weapon info */
  weapon: {
    name: string;
    baseDamage: number;
    fireRate: number;
    /** Effective damage after buff multipliers */
    effectiveDamage?: number;
    /** Effective fire rate after buff multipliers */
    effectiveFireRate?: number;
  };
}

export class PauseMenu {
  private container: HTMLDivElement;
  private onResumeCallback: (() => void) | null = null;
  private onExitCallback: (() => void) | null = null;
  private onVisualModeChangeCallback: ((mode: 'pixelated' | 'modern') => void) | null = null;
  private isPaused: boolean = false;
  private bgMusic: BackgroundMusic | null = null;
  private isHost: boolean = false;
  private networkCallbacks: PauseMenuNetworkCallbacks | null = null;
  private perfLogger: PerformanceLogger | null = null;
  private visualMode: 'pixelated' | 'modern' = 'pixelated';
  private joinUrl: string | null = null;

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

        <div class="pause-layout">
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
            <button class="pause-btn settings-btn" data-action="settings">
              <span class="btn-icon">⚙</span>
              <span>SETTINGS</span>
            </button>
            <button class="pause-btn visual-mode-btn" data-action="visual-mode">
              <span class="btn-icon">🎨</span>
              <span class="visual-mode-label">STYLE: PIXELATED</span>
            </button>
            <button class="pause-btn perf-graphs-btn" data-action="perf-graphs">
              <span class="btn-icon">📊</span>
              <span>PERFORMANCE GRAPHS</span>
            </button>
            <button class="pause-btn music-btn" data-action="music">
              <span class="btn-icon">♪</span>
              <span class="music-label">MUSIC: ELECTRONIC</span>
            </button>
            <button class="pause-btn exit-btn" data-action="exit">
              <span class="btn-icon">◀</span>
              <span>EXIT TO MENU</span>
            </button>
            <button class="pause-btn end-game-btn hidden" data-action="end-game">
              <span class="btn-icon">&#x2716;</span>
              <span>END GAME FOR ALL</span>
            </button>
            <button class="pause-btn stop-server-btn hidden" data-action="stop-server">
              <span class="btn-icon">&#x23F9;</span>
              <span>STOP SERVER</span>
            </button>
          </div>

          <div class="pause-stats-panel">
            <div class="stats-qr-section hidden">
              <div class="stats-section-title">JOIN THIS GAME</div>
              <div class="stats-qr-content"></div>
            </div>
            <div class="stats-weapon-section">
              <div class="stats-section-title">WEAPON</div>
              <div class="stats-weapon-info"></div>
            </div>
            <div class="stats-kills-section">
              <div class="stats-section-title">TOTAL KILLS</div>
              <div class="stats-kills-count">0</div>
            </div>
            <div class="stats-buffs-section">
              <div class="stats-section-title">ACTIVE BUFFS</div>
              <div class="stats-buffs-list"></div>
              <div class="stats-no-buffs">No active buffs</div>
            </div>
            <div class="stats-perf-section">
              <div class="stats-section-title">PERFORMANCE</div>
              <div class="stats-perf-content"></div>
            </div>
          </div>
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
        max-height: 90vh;
        overflow-y: auto;
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

      #pause-menu .settings-btn {
        background: linear-gradient(180deg, #335566 0%, #223344 100%);
        border-color: #44aacc;
      }

      #pause-menu .settings-btn:hover {
        background: linear-gradient(180deg, #447788 0%, #335566 100%);
        box-shadow: 0 0 20px #44aacc;
      }

      #pause-menu .visual-mode-btn {
        background: linear-gradient(180deg, #336655 0%, #224433 100%);
        border-color: #44ffaa;
      }

      #pause-menu .visual-mode-btn:hover {
        background: linear-gradient(180deg, #448866 0%, #336644 100%);
        box-shadow: 0 0 20px #44ffaa;
      }

      #pause-menu .perf-graphs-btn {
        background: linear-gradient(180deg, #556633 0%, #443322 100%);
        border-color: #ccaa44;
      }

      #pause-menu .perf-graphs-btn:hover {
        background: linear-gradient(180deg, #778844 0%, #665533 100%);
        box-shadow: 0 0 20px #ccaa44;
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

      #pause-menu .end-game-btn {
        background: linear-gradient(180deg, #aa2222 0%, #661111 100%);
        border-color: #ff4444;
      }

      #pause-menu .end-game-btn:hover {
        background: linear-gradient(180deg, #cc3333 0%, #882222 100%);
        box-shadow: 0 0 25px #ff4444;
      }

      #pause-menu .end-game-btn.hidden {
        display: none;
      }

      #pause-menu .stop-server-btn {
        background: linear-gradient(180deg, #884422 0%, #662211 100%);
        border-color: #ff6633;
      }

      #pause-menu .stop-server-btn:hover {
        background: linear-gradient(180deg, #aa5533 0%, #883322 100%);
        box-shadow: 0 0 25px #ff6633;
      }

      #pause-menu .stop-server-btn.hidden {
        display: none;
      }

      #pause-menu .btn-icon {
        font-size: 24px;
      }

      #pause-menu .pause-layout {
        display: flex;
        gap: 40px;
        align-items: flex-start;
        justify-content: center;
      }

      #pause-menu .pause-stats-panel {
        width: 300px;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-height: 60vh;
        overflow-y: auto;
        padding-right: 4px;
      }

      #pause-menu .pause-stats-panel::-webkit-scrollbar {
        width: 4px;
      }

      #pause-menu .pause-stats-panel::-webkit-scrollbar-track {
        background: rgba(0, 0, 20, 0.3);
      }

      #pause-menu .pause-stats-panel::-webkit-scrollbar-thumb {
        background: #444466;
        border-radius: 2px;
      }

      #pause-menu .stats-qr-section.hidden {
        display: none;
      }

      #pause-menu .stats-qr-content {
        display: flex;
        justify-content: center;
      }

      #pause-menu .stats-section-title {
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 3px;
        color: #8888aa;
        border-bottom: 1px solid #333366;
        padding-bottom: 6px;
        margin-bottom: 8px;
      }

      #pause-menu .stats-weapon-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      #pause-menu .stats-weapon-name {
        font-size: 18px;
        font-weight: bold;
        letter-spacing: 2px;
      }

      #pause-menu .stats-weapon-stat {
        font-size: 13px;
        color: #aaaacc;
        display: flex;
        justify-content: space-between;
      }

      #pause-menu .stats-weapon-stat .stat-value {
        color: #ffffff;
        font-weight: bold;
      }

      #pause-menu .stats-weapon-stat .stat-effective {
        color: #44ff44;
        font-size: 11px;
        margin-left: 6px;
      }

      #pause-menu .stats-kills-count {
        font-size: 36px;
        font-weight: bold;
        color: #ff4444;
        text-shadow: 0 0 10px rgba(255, 68, 68, 0.6);
        letter-spacing: 2px;
      }

      #pause-menu .stats-buffs-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      #pause-menu .stats-buff-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 6px 8px;
        background: rgba(0, 0, 20, 0.4);
        border-left: 3px solid;
        border-radius: 2px;
      }

      #pause-menu .stats-buff-icon {
        width: 28px;
        height: 28px;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: bold;
        flex-shrink: 0;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      #pause-menu .stats-buff-info {
        flex: 1;
        min-width: 0;
      }

      #pause-menu .stats-buff-header {
        display: flex;
        align-items: baseline;
        gap: 6px;
        margin-bottom: 2px;
      }

      #pause-menu .stats-buff-name {
        font-size: 14px;
        font-weight: bold;
        color: #ffffff;
      }

      #pause-menu .stats-buff-stacks {
        font-size: 12px;
        font-weight: bold;
        opacity: 0.8;
      }

      #pause-menu .stats-buff-desc {
        font-size: 11px;
        color: #8888aa;
        line-height: 1.3;
      }

      #pause-menu .stats-buff-value {
        font-size: 11px;
        font-weight: bold;
        margin-top: 2px;
      }

      #pause-menu .stats-no-buffs {
        font-size: 13px;
        color: #555577;
        font-style: italic;
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

    const settingsBtn = this.container.querySelector('[data-action="settings"]');
    settingsBtn?.addEventListener('click', () => {
      const settings = new SettingsMenu();
      settings.show();
      settings.onClose(() => {
        settings.dispose();
      });
    });

    const visualModeBtn = this.container.querySelector('[data-action="visual-mode"]');
    visualModeBtn?.addEventListener('click', () => {
      this.visualMode = this.visualMode === 'pixelated' ? 'modern' : 'pixelated';
      this.updateVisualModeLabel();
      this.onVisualModeChangeCallback?.(this.visualMode);
    });

    const perfGraphsBtn = this.container.querySelector('[data-action="perf-graphs"]');
    perfGraphsBtn?.addEventListener('click', () => {
      this.showPerformanceGraphsModal();
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

    const endGameBtn = this.container.querySelector('[data-action="end-game"]');
    endGameBtn?.addEventListener('click', () => {
      this.hide();
      this.networkCallbacks?.onEndGame();
    });

    const stopServerBtn = this.container.querySelector('[data-action="stop-server"]');
    stopServerBtn?.addEventListener('click', () => {
      this.hide();
      this.networkCallbacks?.onStopServer?.();
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
    if (this.isHost) {
      this.networkCallbacks?.onPause(true);
    }
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
    if (this.isHost) {
      this.networkCallbacks?.onPause(false);
    }
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

  /**
   * Set the current visual mode. Updates the button label.
   * Call this on startup to sync with the saved mode.
   */
  setVisualMode(mode: 'pixelated' | 'modern'): void {
    this.visualMode = mode;
    this.updateVisualModeLabel();
  }

  /** Get the current visual mode. */
  getVisualMode(): 'pixelated' | 'modern' {
    return this.visualMode;
  }

  /** Register callback for when the user toggles the visual mode. */
  onVisualModeChange(callback: (mode: 'pixelated' | 'modern') => void): void {
    this.onVisualModeChangeCallback = callback;
  }

  private updateVisualModeLabel(): void {
    const label = this.container.querySelector('.visual-mode-label');
    if (label) {
      label.textContent = `STYLE: ${this.visualMode === 'pixelated' ? 'PIXELATED' : 'MODERN'}`;
    }
  }

  /**
   * Set whether this client is the host.
   * When true, shows the "END GAME FOR ALL" and "STOP SERVER" buttons.
   */
  setIsHost(isHost: boolean): void {
    this.isHost = isHost;
    const endGameBtn = this.container.querySelector('.end-game-btn');
    const stopServerBtn = this.container.querySelector('.stop-server-btn');

    if (endGameBtn) {
      if (isHost) {
        endGameBtn.classList.remove('hidden');
      } else {
        endGameBtn.classList.add('hidden');
      }
    }

    if (stopServerBtn) {
      if (isHost) {
        stopServerBtn.classList.remove('hidden');
      } else {
        stopServerBtn.classList.add('hidden');
      }
    }
  }

  /**
   * Set network callbacks for host actions (pause/resume, end game).
   */
  setNetworkCallbacks(callbacks: PauseMenuNetworkCallbacks): void {
    this.networkCallbacks = callbacks;
  }

  /**
   * Set the join URL for this multiplayer session.
   * When set, shows a QR code + URL in the stats panel so other players can join.
   * Pass null to hide the QR section.
   */
  setJoinUrl(url: string | null): void {
    this.joinUrl = url;
    const qrSection = this.container.querySelector('.stats-qr-section') as HTMLElement | null;
    const qrContent = this.container.querySelector('.stats-qr-content') as HTMLElement | null;
    if (!qrSection || !qrContent) return;

    if (!url) {
      qrSection.classList.add('hidden');
      qrContent.innerHTML = '';
      return;
    }

    qrSection.classList.remove('hidden');
    qrContent.innerHTML = '';
    try {
      const display = createQRCodeDisplay(url, url, 200);
      qrContent.appendChild(display);
    } catch {
      qrContent.innerHTML = `<div style="color:#ff8888;font-size:12px;word-break:break-all;">${url}</div>`;
    }
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
   * Update the stats info panel with current game data.
   * Call this before show() to display up-to-date buff, kill, and weapon info.
   */
  setGameData(data: PauseMenuGameData): void {
    this.updateWeaponInfo(data.weapon);
    this.updateKillCount(data.totalKills);
    this.updateBuffsList(data.buffs);
  }

  private updateWeaponInfo(weapon: PauseMenuGameData['weapon']): void {
    const weaponInfoEl = this.container.querySelector('.stats-weapon-info');
    if (!weaponInfoEl) return;

    const effectiveDmgHtml = weapon.effectiveDamage !== undefined && weapon.effectiveDamage !== weapon.baseDamage
      ? `<span class="stat-effective">(${weapon.effectiveDamage.toFixed(2)} effective)</span>`
      : '';

    const effectiveRateHtml = weapon.effectiveFireRate !== undefined && weapon.effectiveFireRate !== weapon.fireRate
      ? `<span class="stat-effective">(${weapon.effectiveFireRate.toFixed(1)} effective)</span>`
      : '';

    weaponInfoEl.innerHTML = `
      <div class="stats-weapon-name" style="color: #ffff44;">${weapon.name}</div>
      <div class="stats-weapon-stat">
        <span>Base Damage</span>
        <span><span class="stat-value">${weapon.baseDamage}</span>${effectiveDmgHtml}</span>
      </div>
      <div class="stats-weapon-stat">
        <span>Fire Rate</span>
        <span><span class="stat-value">${weapon.fireRate}/s</span>${effectiveRateHtml}</span>
      </div>
    `;
  }

  private updateKillCount(totalKills: number): void {
    const killsEl = this.container.querySelector('.stats-kills-count');
    if (killsEl) {
      killsEl.textContent = String(totalKills);
    }
  }

  private updateBuffsList(buffs: PauseMenuGameData['buffs']): void {
    const listEl = this.container.querySelector('.stats-buffs-list');
    const noBuffsEl = this.container.querySelector('.stats-no-buffs') as HTMLElement | null;
    if (!listEl) return;

    if (buffs.length === 0) {
      listEl.innerHTML = '';
      if (noBuffsEl) noBuffsEl.style.display = 'block';
      return;
    }

    if (noBuffsEl) noBuffsEl.style.display = 'none';

    listEl.innerHTML = buffs.map(buff => `
      <div class="stats-buff-row" style="border-color: ${buff.color};">
        <div class="stats-buff-icon" style="background: ${buff.color}22; color: ${buff.color}; text-shadow: 0 0 4px ${buff.color};">
          ${buff.stacks}
        </div>
        <div class="stats-buff-info">
          <div class="stats-buff-header">
            <span class="stats-buff-name">${buff.name}</span>
            <span class="stats-buff-stacks" style="color: ${buff.color};">x${buff.stacks}</span>
          </div>
          <div class="stats-buff-desc">${buff.description}</div>
          <div class="stats-buff-value" style="color: ${buff.color};">${buff.currentValue}</div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Set performance summary HTML for the stats panel.
   * Call before show() to display current performance data.
   */
  setPerformanceHTML(html: string): void {
    const perfEl = this.container.querySelector('.stats-perf-content');
    if (perfEl) {
      perfEl.innerHTML = html;
    }
  }

  /**
   * Set the performance logger for interactive graphs.
   */
  setPerformanceLogger(logger: PerformanceLogger): void {
    this.perfLogger = logger;
  }

  /**
   * Show the full-screen performance graphs modal.
   * Handles missing perfLogger, empty data, and import failures gracefully.
   */
  private showPerformanceGraphsModal(): void {
    // Remove any existing modal (prevents duplicate modals)
    const existing = document.getElementById('perf-graphs-modal');
    if (existing) existing.remove();

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'perf-graphs-modal';
    modal.innerHTML = `
      <div class="perf-graphs-content">
        <h2 class="perf-graphs-title">PERFORMANCE ANALYSIS</h2>
        <div class="perf-graphs-tabs">
          <button class="perf-tab active" data-tab="fps">FPS</button>
          <button class="perf-tab" data-tab="enemies">Enemies</button>
          <button class="perf-tab" data-tab="bullets">Bullets</button>
          <button class="perf-tab" data-tab="types">Enemy Types</button>
        </div>
        <div class="perf-graphs-canvas-container">
          <canvas id="perf-graph-canvas"></canvas>
        </div>
        <div class="perf-graphs-stats">
          <div class="perf-stat-box">
            <div class="perf-stat-label">Min FPS</div>
            <div class="perf-stat-value" id="perf-min-fps">--</div>
            <div class="perf-stat-detail" id="perf-min-fps-detail"></div>
          </div>
          <div class="perf-stat-box">
            <div class="perf-stat-label">Max FPS</div>
            <div class="perf-stat-value" id="perf-max-fps">--</div>
            <div class="perf-stat-detail" id="perf-max-fps-detail"></div>
          </div>
        </div>
        <div class="perf-graphs-hint">
          Mouse wheel to zoom | Drag to pan | Hover for details
        </div>
        <button class="perf-graphs-close">CLOSE</button>
      </div>
    `;

    // Style
    const style = document.createElement('style');
    style.textContent = `
      #perf-graphs-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 20, 0.95);
        z-index: 3000;
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: 'Segoe UI', Arial, sans-serif;
      }

      #perf-graphs-modal .perf-graphs-content {
        width: 90%;
        max-width: 1200px;
        background: #0a0a14;
        border: 2px solid #3a3a5e;
        border-radius: 8px;
        padding: 30px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      #perf-graphs-modal .perf-graphs-title {
        font-size: 36px;
        font-weight: bold;
        color: #ccaa44;
        text-align: center;
        margin: 0;
        letter-spacing: 4px;
      }

      #perf-graphs-modal .perf-graphs-tabs {
        display: flex;
        gap: 10px;
        justify-content: center;
      }

      #perf-graphs-modal .perf-tab {
        background: #1a1a2e;
        border: 1px solid #3a3a5e;
        color: #88aacc;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 1px;
      }

      #perf-graphs-modal .perf-tab:hover {
        background: #2a2a3e;
        border-color: #ccaa44;
      }

      #perf-graphs-modal .perf-tab.active {
        background: #ccaa44;
        border-color: #ccaa44;
        color: #0a0a14;
      }

      #perf-graphs-modal .perf-graphs-canvas-container {
        display: flex;
        justify-content: center;
        background: #0a0a14;
        border: 1px solid #1a1a2e;
        border-radius: 4px;
        padding: 10px;
        min-height: 200px;
        align-items: center;
      }

      #perf-graphs-modal .perf-graphs-error {
        color: #ff6644;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        letter-spacing: 1px;
      }

      #perf-graphs-modal canvas {
        cursor: grab;
        display: block;
      }

      #perf-graphs-modal canvas:active {
        cursor: grabbing;
      }

      #perf-graphs-modal .perf-graphs-stats {
        display: flex;
        gap: 20px;
        justify-content: center;
      }

      #perf-graphs-modal .perf-stat-box {
        flex: 1;
        max-width: 300px;
        background: #1a1a2e;
        border: 1px solid #3a3a5e;
        border-radius: 4px;
        padding: 15px;
      }

      #perf-graphs-modal .perf-stat-label {
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 2px;
        color: #668899;
        margin-bottom: 5px;
      }

      #perf-graphs-modal .perf-stat-value {
        font-size: 28px;
        font-weight: bold;
        color: #ccaa44;
        margin-bottom: 5px;
      }

      #perf-graphs-modal .perf-stat-detail {
        font-size: 11px;
        color: #88aacc;
        line-height: 1.4;
      }

      #perf-graphs-modal .perf-graphs-hint {
        text-align: center;
        color: #668899;
        font-size: 12px;
        letter-spacing: 1px;
      }

      #perf-graphs-modal .perf-graphs-close {
        background: linear-gradient(180deg, #aa2222 0%, #661111 100%);
        border: 2px solid #ff4444;
        color: #ffffff;
        padding: 12px 40px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 3px;
        align-self: center;
      }

      #perf-graphs-modal .perf-graphs-close:hover {
        background: linear-gradient(180deg, #cc3333 0%, #882222 100%);
        box-shadow: 0 0 25px #ff4444;
        transform: scale(1.05);
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);

    // Wire close button IMMEDIATELY (not inside .then()) so modal is always closeable
    const closeModal = () => {
      modal.remove();
      style.remove();
    };
    const closeBtn = modal.querySelector('.perf-graphs-close');
    closeBtn?.addEventListener('click', closeModal);
    // Also close on Escape key
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        closeModal();
      }
    };
    document.addEventListener('keydown', escHandler);

    // Show error if no performance logger
    if (!this.perfLogger) {
      const container = modal.querySelector('.perf-graphs-canvas-container');
      if (container) {
        const canvas = container.querySelector('canvas');
        if (canvas) canvas.remove();
        container.innerHTML = '<div class="perf-graphs-error">Performance logger not available.<br>Play for a few seconds and try again.</div>';
      }
      return;
    }

    const perfLogger = this.perfLogger;

    // Initialize graph (lazy import to avoid loading if not needed)
    import('./PerformanceGraphs').then(({ PerformanceGraph }) => {
      // Verify modal is still in the DOM (user might have closed it during import)
      if (!modal.parentElement) return;

      const canvas = modal.querySelector('#perf-graph-canvas') as HTMLCanvasElement;
      if (!canvas) return;

      const graph = new PerformanceGraph(canvas, { width: 1000, height: 500 });

      // Clean up graph when modal closes
      const origClose = closeModal;
      const closeWithGraph = () => {
        graph.dispose();
        origClose();
      };
      closeBtn?.removeEventListener('click', closeModal);
      closeBtn?.addEventListener('click', closeWithGraph);

      // Load data
      const data = perfLogger.getDataPoints();
      const minMoment = perfLogger.getMinFPSMoment();
      const maxMoment = perfLogger.getMaxFPSMoment();

      graph.setData(data);
      graph.setFPSMoments(minMoment, maxMoment);
      graph.renderFPSChart();

      // Update stats
      if (minMoment) {
        const minFpsEl = modal.querySelector('#perf-min-fps') as HTMLElement;
        const minFpsDetailEl = modal.querySelector('#perf-min-fps-detail') as HTMLElement;
        if (minFpsEl) minFpsEl.textContent = minMoment.fps.toFixed(1);

        // Enemy type breakdown
        const topTypes = Array.from(minMoment.enemyTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([type, count]) => `${count} ${type}`)
          .join(', ');
        if (minFpsDetailEl) {
          minFpsDetailEl.innerHTML = `
            ${minMoment.enemyCount} enemies, ${minMoment.bulletCount} bullets<br>
            Top: ${topTypes || 'none'}
          `;
        }
      }

      if (maxMoment) {
        const maxFpsEl = modal.querySelector('#perf-max-fps') as HTMLElement;
        const maxFpsDetailEl = modal.querySelector('#perf-max-fps-detail') as HTMLElement;
        if (maxFpsEl) maxFpsEl.textContent = maxMoment.fps.toFixed(1);

        const topTypes = Array.from(maxMoment.enemyTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([type, count]) => `${count} ${type}`)
          .join(', ');
        if (maxFpsDetailEl) {
          maxFpsDetailEl.innerHTML = `
            ${maxMoment.enemyCount} enemies, ${maxMoment.bulletCount} bullets<br>
            Top: ${topTypes || 'none'}
          `;
        }
      }

      // Tab switching
      const tabs = modal.querySelectorAll('.perf-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');

          const tabType = tab.getAttribute('data-tab');
          if (tabType === 'fps') {
            graph.renderFPSChart();
          } else if (tabType === 'enemies') {
            graph.renderEnemyChart();
          } else if (tabType === 'bullets') {
            graph.renderBulletChart();
          } else if (tabType === 'types') {
            graph.renderEnemyTypeChart();
          }
        });
      });
    }).catch((err) => {
      // Import failed — show error in the canvas container area
      const container = modal.querySelector('.perf-graphs-canvas-container');
      if (container) {
        const canvas = container.querySelector('canvas');
        if (canvas) canvas.remove();
        container.innerHTML = `<div class="perf-graphs-error">Failed to load performance graphs module.<br>${String(err)}</div>`;
      }
    });
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
