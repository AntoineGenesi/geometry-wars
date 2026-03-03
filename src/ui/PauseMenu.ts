import { ConfigurableInput } from '../input/ConfigurableInput';
import { ControlsMenu } from './ControlsMenu';
import { WeaponWiki } from './WeaponWiki';
import { WeaponMasteryScreen } from './WeaponMasteryScreen';
import { SettingsMenu, type GraphicsSettings } from './SettingsMenu';
import { BackgroundMusic } from '../audio/BackgroundMusic';
import { PerformanceLogger } from '../core/PerformanceLogger';
import { createQRCodeDisplay } from './QRCode';
import { t, onLanguageChange } from '../i18n';
import { LanguageSelector } from './LanguageSelector';
import { MasteryPointStore } from '../systems/MasteryPointStore';
import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';
import { GameSettingsPanel } from './GameSettingsPanel';
import type { GameSettings } from '../../server/shared/GameSettings';

/**
 * Pause menu overlay.
 * Shows when Escape is pressed, allows resuming or returning to main menu.
 * Displays active buffs with descriptions, total kills, and weapon stats.
 */

/** Callbacks for host network actions */
export interface PauseMenuNetworkCallbacks {
  onPause: (paused: boolean) => void;
  onExitToVoting?: () => void;
  onEndGame: () => void;
  onStopServer?: () => void;
  /** Queue settings to apply at the next wave boundary (host only). */
  onApplySettings?: (settings: GameSettings) => void;
  /** Restart the round with new settings — server will broadcast a 5s countdown (host only). */
  onRestartRound?: (settings: GameSettings) => void;
}

/** Data passed to the pause menu for the stats info panel */
export interface PauseMenuGameData {
  /** Player level progression info */
  playerLevel?: {
    level: number;
    name: string;
    description: string;
    color: string;
  };
  /** Active companions (protector drones, guardians, hunters) */
  companions?: {
    guardian: number;
    hunter: number;
    protector: number;
  };
  /** Cumulative stat bonuses combined from level + buffs */
  cumulativeBonuses?: {
    /** e.g. 45 means +45% damage total */
    damageBonus: number;
    fireRateBonus: number;
    speedBonus: number;
  };
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
  /** Lives remaining info */
  livesInfo?: {
    /** Current lives count (ignored when infinite) */
    count: number;
    /** When true, show "Infinite" instead of count */
    infinite: boolean;
  };
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
  private onGraphicsChangeCallback: ((settings: GraphicsSettings) => void) | null = null;
  private onLookModeCallback: (() => void) | null = null;
  private isPaused: boolean = false;
  private bgMusic: BackgroundMusic | null = null;
  private isHost: boolean = false;
  private isMultiplayer: boolean = false;
  private serverPaused: boolean = true;
  private networkCallbacks: PauseMenuNetworkCallbacks | null = null;
  private perfLogger: PerformanceLogger | null = null;
  private visualMode: 'pixelated' | 'modern' = 'pixelated';
  private joinUrl: string | null = null;
  private isInLookMode: boolean = false;
  private _langUnsub: (() => void) | null = null;
  private _languageSelector: LanguageSelector | null = null;
  private masteryPointStore: MasteryPointStore | null = null;
  private matchUpgradeTracker: MatchUpgradeTracker | null = null;
  private onMasteryScreenCloseCallback: (() => void) | null = null;
  // Server settings panel (host-only mid-game settings)
  private settingsPanel: GameSettingsPanel | null = null;
  private settingsPanelActions: HTMLElement | null = null;
  // Non-host read-only settings display (s44j-settings-16f)
  private gameSettingsDisplay: GameSettings | null = null;
  private hasPendingSettingsDisplay: boolean = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'pause-menu';
    this.container.innerHTML = this.createMenuHTML();
    this.applyStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
    this.attachEventListeners();

    this._langUnsub = onLanguageChange(() => {
      this.container.innerHTML = this.createMenuHTML();
      this.attachEventListeners();
      this.updateVisualModeLabel();
      this.updateMusicLabel();
      if (this.isHost) this.setIsHost(this.isHost);
      if (this.joinUrl) this.setJoinUrl(this.joinUrl);
    });
  }

  private createMenuHTML(): string {
    return `
      <div class="pause-content">
        <h1 class="pause-title">${t('pauseMenu.title')}</h1>

        <div class="pause-layout">
          <div class="pause-buttons">
            <button class="pause-btn resume-btn" data-action="resume">
              <span class="btn-icon">▶</span>
              <span>${t('pauseMenu.resume')}</span>
            </button>
            <button class="pause-btn controls-btn" data-action="controls">
              <span class="btn-icon">⌨</span>
              <span>${t('pauseMenu.controls')}</span>
            </button>
            <button class="pause-btn weapons-btn" data-action="weapons">
              <span class="btn-icon">⚡</span>
              <span>${t('pauseMenu.weapons')}</span>
            </button>
            <button class="pause-btn mastery-btn" data-action="mastery">
              <span class="btn-icon">⭐</span>
              <span>WEAPON MASTERY</span>
            </button>
            <button class="pause-btn settings-btn" data-action="settings">
              <span class="btn-icon">⚙</span>
              <span>${t('pauseMenu.settings')}</span>
            </button>
            <button class="pause-btn visual-mode-btn" data-action="visual-mode">
              <span class="btn-icon">🎨</span>
              <span class="visual-mode-label">${t('pauseMenu.stylePixelated')}</span>
            </button>
            <button class="pause-btn perf-graphs-btn" data-action="perf-graphs">
              <span class="btn-icon">📊</span>
              <span>${t('pauseMenu.performanceGraphs')}</span>
            </button>
            <button class="pause-btn music-btn" data-action="music">
              <span class="btn-icon">♪</span>
              <span class="music-label">${t('pauseMenu.music', { name: 'ELECTRONIC' })}</span>
            </button>
            <button class="pause-btn exit-btn" data-action="exit">
              <span class="btn-icon">◀</span>
              <span>${t('pauseMenu.exitToMenu')}</span>
            </button>
            <button class="pause-btn exit-to-voting-btn hidden" data-action="exit-to-voting">
              <span class="btn-icon">&#x21BA;</span>
              <span>${t('pauseMenu.exitToVoting')}</span>
            </button>
            <button class="pause-btn end-game-btn hidden" data-action="end-game">
              <span class="btn-icon">&#x2716;</span>
              <span>${t('pauseMenu.endGameForAll')}</span>
            </button>
            <button class="pause-btn stop-server-btn hidden" data-action="stop-server">
              <span class="btn-icon">&#x23F9;</span>
              <span>${t('pauseMenu.stopServer')}</span>
            </button>
            <button class="pause-btn server-settings-btn hidden" data-action="server-settings">
              <span class="btn-icon">&#x2699;</span>
              <span>SERVER SETTINGS</span>
            </button>
          </div>

          <div class="pause-stats-panel">
            <div class="stats-qr-section hidden">
              <div class="stats-section-title">${t('pauseMenu.stats.joinThisGame')}</div>
              <div class="stats-qr-content"></div>
            </div>
            <div class="stats-lives-section hidden">
              <div class="stats-section-title">LIVES</div>
              <div class="stats-lives-display"></div>
            </div>
            <div class="stats-level-section hidden">
              <div class="stats-section-title">${t('pauseMenu.stats.playerLevel')}</div>
              <div class="stats-level-info"></div>
            </div>
            <div class="stats-companions-section hidden">
              <div class="stats-section-title">${t('pauseMenu.stats.companions')}</div>
              <div class="stats-companions-list"></div>
            </div>
            <div class="stats-cumulative-section hidden">
              <div class="stats-section-title">${t('pauseMenu.stats.cumulativeBonuses')}</div>
              <div class="stats-cumulative-list"></div>
            </div>
            <div class="stats-weapon-section">
              <div class="stats-section-title">${t('pauseMenu.stats.weapon')}</div>
              <div class="stats-weapon-info"></div>
            </div>
            <div class="stats-kills-section">
              <div class="stats-section-title">${t('pauseMenu.stats.totalKills')}</div>
              <div class="stats-kills-count">0</div>
            </div>
            <div class="stats-buffs-section">
              <div class="stats-section-title">${t('pauseMenu.stats.activeBuffs')}</div>
              <div class="stats-buffs-list"></div>
              <div class="stats-no-buffs">${t('pauseMenu.stats.noActiveBuffs')}</div>
            </div>
            <div class="stats-perf-section">
              <div class="stats-section-title">${t('pauseMenu.stats.performance')}</div>
              <div class="stats-perf-content"></div>
            </div>
            <div class="stats-game-settings-section hidden">
              <div class="stats-section-title">GAME SETTINGS</div>
              <div class="stats-game-settings-content"></div>
              <div class="stats-pending-settings hidden" style="color:#ffaa44;margin-top:4px;font-size:10px;">⚡ New settings apply next wave</div>
            </div>
          </div>
        </div>

        <div id="pause-lang-selector"></div>

        <div class="pause-hint">
          <p>${t('pauseMenu.hint')}</p>
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
        align-items: flex-start;
        overflow-y: auto;
        overflow-x: hidden;
        z-index: 2000;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(5px);
        -webkit-overflow-scrolling: touch;
      }

      #pause-menu.hidden {
        display: none;
      }

      #pause-menu .pause-content {
        text-align: center;
        padding: 40px;
        margin: auto;
        width: 100%;
        box-sizing: border-box;
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

      #pause-menu .mastery-btn {
        background: linear-gradient(180deg, #336644 0%, #224433 100%);
        border-color: #44cc66;
      }

      #pause-menu .mastery-btn:hover {
        background: linear-gradient(180deg, #448855 0%, #336644 100%);
        box-shadow: 0 0 20px #44cc66;
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

      #pause-menu .exit-to-voting-btn {
        background: linear-gradient(180deg, #226622 0%, #114411 100%);
        border-color: #44ff44;
      }

      #pause-menu .exit-to-voting-btn:hover {
        background: linear-gradient(180deg, #338833 0%, #225522 100%);
        box-shadow: 0 0 25px #44ff44;
      }

      #pause-menu .exit-to-voting-btn.hidden {
        display: none;
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

      #pause-menu .server-settings-btn {
        background: linear-gradient(180deg, #224466 0%, #112233 100%);
        border-color: #4499cc;
      }

      #pause-menu .server-settings-btn:hover {
        background: linear-gradient(180deg, #336688 0%, #224455 100%);
        box-shadow: 0 0 25px #4499cc;
      }

      #pause-menu .server-settings-btn.hidden {
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

      #pause-menu .stats-level-section.hidden,
      #pause-menu .stats-companions-section.hidden,
      #pause-menu .stats-cumulative-section.hidden {
        display: none;
      }

      #pause-menu .stats-level-badge {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 4px;
        border-left: 3px solid;
      }

      #pause-menu .stats-level-number {
        font-size: 28px;
        font-weight: bold;
        line-height: 1;
      }

      #pause-menu .stats-level-details {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      #pause-menu .stats-level-name {
        font-size: 15px;
        font-weight: bold;
        letter-spacing: 1px;
        color: #ffffff;
      }

      #pause-menu .stats-level-desc {
        font-size: 11px;
        color: #8888aa;
      }

      #pause-menu .stats-companion-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0;
        font-size: 13px;
        color: #aaaacc;
      }

      #pause-menu .stats-companion-count {
        font-weight: bold;
        color: #ffffff;
      }

      #pause-menu .stats-cumulative-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
        font-size: 13px;
        color: #aaaacc;
      }

      #pause-menu .stats-cumulative-value {
        font-weight: bold;
        color: #44ff88;
      }

      #pause-menu .pause-hint {
        margin-top: 40px;
        color: #666688;
        font-size: 14px;
        letter-spacing: 2px;
      }

      /* Language selector */
      #pause-menu .lang-selector-section {
        margin-top: 32px;
        text-align: center;
      }

      #pause-menu .lang-selector-title {
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 3px;
        color: #8888aa;
        margin-bottom: 12px;
      }

      #pause-menu .lang-selector-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: center;
      }

      #pause-menu .lang-btn {
        border: 2px solid rgba(255,255,255,0.3);
        cursor: pointer;
        transition: all 0.2s;
        border-radius: 2px;
        font-family: Arial, sans-serif;
        /* Flag background with text overlay */
        width: 56px;
        height: 56px;
        font-size: 14px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        color: white;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8), -2px -2px 4px rgba(0, 0, 0, 0.8);
      }

      #pause-menu .lang-btn:hover {
        border-color: rgba(255,255,255,0.6);
        filter: brightness(1.1);
      }

      #pause-menu .lang-btn.selected {
        border-color: #4488ff;
        box-shadow: 0 0 12px rgba(68, 136, 255, 0.5);
      }

      /* Mobile landscape: compact layout to fit small viewport height */
      @media (max-height: 500px) {
        #pause-menu .pause-content {
          padding: 12px 16px;
        }

        #pause-menu .pause-title {
          font-size: 28px;
          margin: 0 0 12px;
          letter-spacing: 6px;
        }

        #pause-menu .pause-layout {
          gap: 16px;
          align-items: flex-start;
        }

        #pause-menu .pause-buttons {
          gap: 8px;
        }

        #pause-menu .pause-btn {
          padding: 8px 16px;
          font-size: 13px;
          min-width: 180px;
          gap: 8px;
          letter-spacing: 1px;
        }

        #pause-menu .btn-icon {
          font-size: 16px;
        }

        #pause-menu .pause-stats-panel {
          width: 220px;
          max-height: none;
          gap: 10px;
        }

        #pause-menu .pause-hint {
          margin-top: 12px;
          font-size: 11px;
        }

        #pause-menu .stats-kills-count {
          font-size: 24px;
        }
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
      if (!this.isHost) {
        if (this.serverPaused) {
          // Server is paused: enter look mode (camera can move, game stays frozen globally)
          this.enterLookMode();
        } else {
          // Local menu only (game still running): just close the menu
          this.hide();
          this.onResumeCallback?.();
        }
      } else {
        // Host: fully resume the game (notifies server)
        this.resume();
      }
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

    const masteryBtn = this.container.querySelector('[data-action="mastery"]');
    masteryBtn?.addEventListener('click', () => {
      if (!this.masteryPointStore) return;
      // Hide pause menu without resuming the game
      this.container.classList.add('hidden');
      const masteryScreen = new WeaponMasteryScreen();
      masteryScreen.setPointStore(this.masteryPointStore);
      masteryScreen.setMatchUpgradeTracker(this.matchUpgradeTracker);
      masteryScreen.show();
      masteryScreen.onClose(() => {
        masteryScreen.dispose();
        this.onMasteryScreenCloseCallback?.();
        // Return to pause menu — game stays paused
        this.container.classList.remove('hidden');
      });
    });

    const settingsBtn = this.container.querySelector('[data-action="settings"]');
    settingsBtn?.addEventListener('click', () => {
      const settings = new SettingsMenu();
      settings.show();
      settings.onGraphicsChange((graphicsSettings) => {
        this.onGraphicsChangeCallback?.(graphicsSettings);
      });
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
        if (label) label.textContent = t('pauseMenu.music', { name: name.toUpperCase() });
      }
    });

    exitBtn?.addEventListener('click', () => {
      this.hide();
      this.onExitCallback?.();
    });

    const exitToVotingBtn = this.container.querySelector('[data-action="exit-to-voting"]');
    exitToVotingBtn?.addEventListener('click', () => {
      this.hide();
      this.networkCallbacks?.onExitToVoting?.();
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

    const serverSettingsBtn = this.container.querySelector('[data-action="server-settings"]');
    serverSettingsBtn?.addEventListener('click', () => {
      this.openServerSettings();
    });

    // Mount language selector
    if (this._languageSelector) {
      this._languageSelector.dispose();
    }
    const langMount = this.container.querySelector<HTMLElement>('#pause-lang-selector');
    if (langMount) {
      this._languageSelector = new LanguageSelector(langMount);
      this._languageSelector.render();
    }

    // Escape key to toggle pause is handled externally (in main.ts/network-main.ts)
    // This allows the caller to manage state properly and support look mode for non-host players
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
   * Enter look mode (non-host only): close the pause menu and let the player
   * look around with the camera while the game stays paused globally.
   * Does NOT resume the game or notify the network.
   */
  enterLookMode(): void {
    this.isInLookMode = true;
    this.hide();
    this.onLookModeCallback?.();
  }

  /**
   * Exit look mode and return to the pause menu.
   */
  exitLookMode(): void {
    this.isInLookMode = false;
    this.isPaused = true;
    this.container.classList.remove('hidden');
  }

  /**
   * Check if in look mode.
   */
  get inLookMode(): boolean {
    return this.isInLookMode;
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
   * Set the MasteryPointStore so the "WEAPON MASTERY" button can open the
   * constellation upgrade screen during a paused game.
   */
  setMasteryPointStore(store: MasteryPointStore): void {
    this.masteryPointStore = store;
  }

  /**
   * Set the per-match upgrade tracker so the weapon mastery screen opened from
   * the pause menu can show which upgrades are "earned this match" vs permanently
   * unlocked but not yet activated.
   */
  setMatchUpgradeTracker(tracker: MatchUpgradeTracker | null): void {
    this.matchUpgradeTracker = tracker;
  }

  /**
   * Register a callback fired after the player closes the Weapon Mastery
   * screen from within the pause menu (e.g. to refresh MatchUpgradeTracker).
   */
  onMasteryScreenClose(callback: () => void): void {
    this.onMasteryScreenCloseCallback = callback;
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
      label.textContent = this.visualMode === 'pixelated'
        ? t('pauseMenu.stylePixelated')
        : t('pauseMenu.styleModern');
    }
  }

  /**
   * Set whether this client is the host.
   * When true, shows the "EXIT TO VOTING SCREEN", "END GAME FOR ALL" and "STOP SERVER" buttons.
   * (only if also in multiplayer mode)
   */
  setIsHost(isHost: boolean): void {
    this.isHost = isHost;
    this.updateNetworkButtonsVisibility();
  }

  /**
   * Set whether we're in a multiplayer game.
   * Network buttons are only shown if isHost && isMultiplayer.
   */
  setIsMultiplayer(isMultiplayer: boolean): void {
    this.isMultiplayer = isMultiplayer;
    this.updateNetworkButtonsVisibility();
  }

  /**
   * Update the read-only game settings display for non-host multiplayer clients (s44j-settings-16f).
   * Pass null to hide the section.
   */
  setGameSettingsDisplay(settings: GameSettings | null, hasPending: boolean): void {
    this.gameSettingsDisplay = settings;
    this.hasPendingSettingsDisplay = hasPending;
    const section = this.container.querySelector('.stats-game-settings-section');
    if (!section) return;
    if (!settings || this.isHost) {
      // Hide for hosts (they have the full settings panel) and when no settings
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    const content = section.querySelector('.stats-game-settings-content');
    if (content) {
      const lines: string[] = [
        `Mode: <b>${settings.mode.toUpperCase()}</b>`,
        `Lives: <b>${settings.infiniteLives ? '∞' : settings.lives}</b>`,
        `Difficulty: <b>${settings.difficultyMultiplier.toFixed(1)}x</b>`,
        `Spawn Rate: <b>${settings.enemySpawnRateMultiplier.toFixed(1)}x</b>`,
        `Enemy Cap: <b>${settings.enemyCountCap}</b>`,
      ];
      if (settings.pvpEnabled) {
        lines.push(`PvP: <b>ON</b>  (${settings.pvpWinCondition})`);
        if (settings.friendlyFire) lines.push(`Friendly Fire: <b>ON</b>`);
      }
      if (settings.startingWeapon !== 'standard') {
        lines.push(`Starting Weapon: <b>${settings.startingWeapon.replace(/_/g, ' ')}</b>`);
      }
      if (settings.timeLimit > 0) {
        lines.push(`Time Limit: <b>${Math.round(settings.timeLimit / 60)}min</b>`);
      }
      content.innerHTML = lines.join('<br>');
    }
    const pendingEl = section.querySelector('.stats-pending-settings');
    if (pendingEl) {
      if (hasPending) {
        pendingEl.classList.remove('hidden');
      } else {
        pendingEl.classList.add('hidden');
      }
    }
  }

  /**
   * Update visibility of multiplayer-specific buttons based on host status and multiplayer mode.
   */
  private updateNetworkButtonsVisibility(): void {
    const shouldShowNetworkButtons = this.isHost && this.isMultiplayer;
    const exitToVotingBtn = this.container.querySelector('.exit-to-voting-btn');
    const endGameBtn = this.container.querySelector('.end-game-btn');
    const stopServerBtn = this.container.querySelector('.stop-server-btn');
    const serverSettingsBtn = this.container.querySelector('.server-settings-btn');

    if (exitToVotingBtn) {
      if (shouldShowNetworkButtons) {
        exitToVotingBtn.classList.remove('hidden');
      } else {
        exitToVotingBtn.classList.add('hidden');
      }
    }

    if (endGameBtn) {
      if (shouldShowNetworkButtons) {
        endGameBtn.classList.remove('hidden');
      } else {
        endGameBtn.classList.add('hidden');
      }
    }

    if (stopServerBtn) {
      if (shouldShowNetworkButtons) {
        stopServerBtn.classList.remove('hidden');
      } else {
        stopServerBtn.classList.add('hidden');
      }
    }

    if (serverSettingsBtn) {
      if (shouldShowNetworkButtons) {
        serverSettingsBtn.classList.remove('hidden');
      } else {
        serverSettingsBtn.classList.add('hidden');
      }
    }
  }

  /**
   * Set whether the server is currently paused.
   * When false (game still running), the resume button simply closes the menu
   * instead of entering look mode — used when non-host opens their local menu
   * during active gameplay.
   * Defaults to true so the existing server-pause behavior is unchanged.
   */
  setServerPaused(paused: boolean): void {
    this.serverPaused = paused;
  }

  /**
   * Set network callbacks for host actions (pause/resume, end game).
   */
  setNetworkCallbacks(callbacks: PauseMenuNetworkCallbacks): void {
    this.networkCallbacks = callbacks;
  }

  /**
   * Open the server settings panel (host-only).
   * Hides the pause menu and shows the GameSettingsPanel with action buttons.
   */
  private openServerSettings(): void {
    if (!this.settingsPanel) {
      this.settingsPanel = new GameSettingsPanel({ showCloseButton: false });
      this.settingsPanel.mount();
      this.settingsPanelActions = this.createSettingsActionBar();
      document.body.appendChild(this.settingsPanelActions);
    }
    // Hide pause menu while settings panel is open
    this.container.classList.add('hidden');
    this.settingsPanel.show();
    this.settingsPanelActions!.style.display = 'flex';
  }

  private closeServerSettings(): void {
    this.settingsPanel?.hide();
    if (this.settingsPanelActions) this.settingsPanelActions.style.display = 'none';
    this.container.classList.remove('hidden');
  }

  private createSettingsActionBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed',
      'bottom:0',
      'left:0',
      'right:0',
      'z-index:5000',
      'display:none',
      'gap:12px',
      'justify-content:center',
      'align-items:center',
      'padding:14px 22px',
      'background:rgba(0,0,20,0.97)',
      'border-top:1px solid rgba(0,255,255,0.2)',
    ].join(';');

    const btnBase = [
      'padding:12px 28px',
      'font-size:14px',
      'font-weight:bold',
      'letter-spacing:2px',
      'cursor:pointer',
      'font-family:inherit',
      'border-radius:3px',
      'transition:all 0.2s',
    ].join(';');

    // BACK button
    const backBtn = document.createElement('button');
    backBtn.textContent = '◀ BACK';
    backBtn.style.cssText = `${btnBase};background:rgba(40,40,80,0.5);border:1px solid rgba(120,120,200,0.4);color:#aaaacc;`;
    backBtn.addEventListener('mouseover', () => { backBtn.style.background = 'rgba(60,60,120,0.7)'; });
    backBtn.addEventListener('mouseout', () => { backBtn.style.background = 'rgba(40,40,80,0.5)'; });
    backBtn.addEventListener('click', () => { this.closeServerSettings(); });

    // APPLY NEXT ROUND button
    const applyBtn = document.createElement('button');
    applyBtn.textContent = '✓ APPLY NEXT ROUND';
    applyBtn.style.cssText = `${btnBase};background:rgba(0,80,0,0.4);border:1px solid rgba(0,200,0,0.5);color:#00ff88;`;
    applyBtn.title = 'Settings will take effect at the start of the next wave';
    applyBtn.addEventListener('mouseover', () => { applyBtn.style.background = 'rgba(0,120,0,0.5)'; });
    applyBtn.addEventListener('mouseout', () => { applyBtn.style.background = 'rgba(0,80,0,0.4)'; });
    applyBtn.addEventListener('click', () => {
      if (!this.settingsPanel) return;
      const settings = this.settingsPanel.getSettings();
      this.networkCallbacks?.onApplySettings?.(settings);
      this.closeServerSettings();
    });

    // RESTART ROUND button
    const restartBtn = document.createElement('button');
    restartBtn.textContent = '⟳ RESTART ROUND';
    restartBtn.style.cssText = `${btnBase};background:rgba(100,0,0,0.4);border:1px solid rgba(255,80,0,0.5);color:#ff8844;`;
    restartBtn.title = 'Restart round immediately — all players see a 5s countdown';
    restartBtn.addEventListener('mouseover', () => { restartBtn.style.background = 'rgba(140,0,0,0.5)'; });
    restartBtn.addEventListener('mouseout', () => { restartBtn.style.background = 'rgba(100,0,0,0.4)'; });
    restartBtn.addEventListener('click', () => {
      if (!this.settingsPanel) return;
      const settings = this.settingsPanel.getSettings();
      this.networkCallbacks?.onRestartRound?.(settings);
      this.closeServerSettings();
      this.hide(); // Hide pause menu — round restart is in progress
    });

    bar.appendChild(backBtn);
    bar.appendChild(applyBtn);
    bar.appendChild(restartBtn);
    return bar;
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
      // Extract 5-digit short code from URL for a readable label (e.g. http://host:3000/12345)
      let label = url;
      try {
        const pathname = new URL(url).pathname;
        if (/^\/\d{5}$/.test(pathname)) {
          label = `Join Code: ${pathname.slice(1)}`;
        }
      } catch { /* keep label as url */ }
      const display = createQRCodeDisplay(url, label, 160);
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
      label.textContent = t('pauseMenu.music', { name: name.toUpperCase() });
    }
  }

  /**
   * Update the stats info panel with current game data.
   * Call this before show() to display up-to-date buff, kill, and weapon info.
   */
  setGameData(data: PauseMenuGameData): void {
    this.updateLivesInfo(data.livesInfo);
    this.updateLevelInfo(data.playerLevel);
    this.updateCompanionsList(data.companions);
    this.updateCumulativeBonuses(data.cumulativeBonuses);
    this.updateWeaponInfo(data.weapon);
    this.updateKillCount(data.totalKills);
    this.updateBuffsList(data.buffs);
  }

  private updateLivesInfo(livesInfo?: PauseMenuGameData['livesInfo']): void {
    const section = this.container.querySelector('.stats-lives-section') as HTMLElement | null;
    const displayEl = this.container.querySelector('.stats-lives-display');
    if (!section || !displayEl) return;

    if (!livesInfo) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    if (livesInfo.infinite) {
      displayEl.innerHTML = '<span style="color:#0ff;font-size:18px;text-shadow:0 0 8px #0ff;">\u2665 \u221e INFINITE</span>';
    } else {
      const hearts = livesInfo.count <= 5
        ? '\u2665'.repeat(Math.max(0, livesInfo.count))
        : `\u2665 x${livesInfo.count}`;
      displayEl.innerHTML = `<span style="color:#f55;font-size:16px;">${hearts}</span>`;
    }
  }

  private updateLevelInfo(playerLevel?: PauseMenuGameData['playerLevel']): void {
    const section = this.container.querySelector('.stats-level-section') as HTMLElement | null;
    const infoEl = this.container.querySelector('.stats-level-info');
    if (!section || !infoEl) return;

    if (!playerLevel) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    const color = playerLevel.color || '#8888cc';
    infoEl.innerHTML = `
      <div class="stats-level-badge" style="border-color: ${color}; background: ${color}18;">
        <div class="stats-level-number" style="color: ${color}; text-shadow: 0 0 8px ${color};">${playerLevel.level}</div>
        <div class="stats-level-details">
          <div class="stats-level-name" style="color: ${color};">${playerLevel.name}</div>
          <div class="stats-level-desc">${playerLevel.description || ''}</div>
        </div>
      </div>
    `;
  }

  private updateCompanionsList(companions?: PauseMenuGameData['companions']): void {
    const section = this.container.querySelector('.stats-companions-section') as HTMLElement | null;
    const listEl = this.container.querySelector('.stats-companions-list');
    if (!section || !listEl) return;

    const total = companions ? (companions.guardian + companions.hunter + companions.protector) : 0;
    if (!companions || total === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    const rows: string[] = [];
    if (companions.protector > 0) {
      rows.push(`<div class="stats-companion-row"><span>🛡 Protector Drones</span><span class="stats-companion-count">${companions.protector}</span></div>`);
    }
    if (companions.guardian > 0) {
      rows.push(`<div class="stats-companion-row"><span>⚡ Guardians</span><span class="stats-companion-count">${companions.guardian}</span></div>`);
    }
    if (companions.hunter > 0) {
      rows.push(`<div class="stats-companion-row"><span>🎯 Hunters</span><span class="stats-companion-count">${companions.hunter}</span></div>`);
    }
    listEl.innerHTML = rows.join('');
  }

  private updateCumulativeBonuses(bonuses?: PauseMenuGameData['cumulativeBonuses']): void {
    const section = this.container.querySelector('.stats-cumulative-section') as HTMLElement | null;
    const listEl = this.container.querySelector('.stats-cumulative-list');
    if (!section || !listEl) return;

    if (!bonuses || (bonuses.damageBonus === 0 && bonuses.fireRateBonus === 0 && bonuses.speedBonus === 0)) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    const rows: string[] = [];
    if (bonuses.damageBonus !== 0) {
      rows.push(`<div class="stats-cumulative-row"><span>Damage</span><span class="stats-cumulative-value">+${bonuses.damageBonus}%</span></div>`);
    }
    if (bonuses.fireRateBonus !== 0) {
      rows.push(`<div class="stats-cumulative-row"><span>Fire Rate</span><span class="stats-cumulative-value">+${bonuses.fireRateBonus}%</span></div>`);
    }
    if (bonuses.speedBonus !== 0) {
      rows.push(`<div class="stats-cumulative-row"><span>Move Speed</span><span class="stats-cumulative-value">+${bonuses.speedBonus}%</span></div>`);
    }
    listEl.innerHTML = rows.join('');
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
          <button class="perf-tab active" data-tab="unified">Unified</button>
          <button class="perf-tab" data-tab="stacked">Enemy Composition</button>
          <button class="perf-tab" data-tab="fps">FPS</button>
          <button class="perf-tab" data-tab="enemies">Enemies</button>
          <button class="perf-tab" data-tab="bullets">Bullets</button>
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
      graph.renderUnifiedChart();

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
          if (tabType === 'unified') {
            graph.renderUnifiedChart();
          } else if (tabType === 'stacked') {
            graph.renderStackedAreaChart();
          } else if (tabType === 'fps') {
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
   * Set callback for when non-host player enters look mode (clicks resume button).
   */
  onLookMode(callback: () => void): void {
    this.onLookModeCallback = callback;
  }

  /**
   * Set callback for when exit to menu is clicked.
   */
  onExit(callback: () => void): void {
    this.onExitCallback = callback;
  }

  /** Register callback for graphics settings changes. */
  onGraphicsChange(callback: (settings: GraphicsSettings) => void): void {
    this.onGraphicsChangeCallback = callback;
  }

  /**
   * Remove from DOM.
   */
  dispose(): void {
    this._langUnsub?.();
    this.container.remove();
  }
}
