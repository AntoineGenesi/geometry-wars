import { SurfaceType } from '../surfaces/SurfaceFactory';
import { ADVENTURE_LEVELS } from '../core/LevelData';
import { LevelCompleteScreen, type LevelProgress } from './LevelCompleteScreen';
import { LANClient } from '../network/LANClient';
import { ConfigurableInput } from '../input/ConfigurableInput';
import { ControlsMenu } from './ControlsMenu';
import { WeaponWiki } from './WeaponWiki';
import { SettingsMenu } from './SettingsMenu';
import { VisualPlayground } from './VisualPlayground';
import { MenuBackground } from './MenuBackground';
import { createQRCodeDisplay } from './QRCode';

/**
 * Start menu UI for Geometry Wars.
 * Allows selecting game mode and surface type before starting.
 *
 * Layout: oval-curved buttons on LEFT, 3D surface preview on CENTER-RIGHT.
 */

export interface MenuSelection {
  surfaceType: SurfaceType;
  gameMode: 'single' | 'multiplayer' | 'network';
  levelIndex?: number;
  playerCount?: 2 | 3 | 4;
  serverUrl?: string;
  playerName?: string;
}

// ---------------------------------------------------------------------------
// Ellipse layout helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// StartMenu
// ---------------------------------------------------------------------------

export class StartMenu {
  private container: HTMLDivElement;
  private onStartCallback: ((selection: MenuSelection) => void) | null = null;
  private selectedSurface: SurfaceType = 'sphere';
  private coopSelectedSurface: SurfaceType = 'sphere';
  private lanSelectedSurface: SurfaceType = 'sphere';
  private coopPlayerCount: 2 | 3 | 4 = 2;
  private progress: LevelProgress;
  private lanClient: LANClient = new LANClient();
  private menuBackground: MenuBackground;
  private styleElement: HTMLStyleElement | null = null;
  private pendingMode: 'single' | 'network' = 'single';
  private lanAutoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private lanAutoRefreshEnabled = true;
  private lanScanning = false;

  // LAN name dialog state
  private pendingLanJoin: { surfaceType: SurfaceType; serverUrl: string } | null = null;

  // Available surfaces with display names
  private readonly surfaces: { type: SurfaceType; name: string; icon: string }[] = [
    { type: 'sphere', name: 'Sphere', icon: '\u25EF' },
    { type: 'cube', name: 'Cube', icon: '\u25FB' },
    { type: 'torus', name: 'Torus', icon: '\u25CE' },
    { type: 'pill', name: 'Pill', icon: '\u2B2D' },
    { type: 'pipe', name: 'Pipe', icon: '\u2393' },
    { type: 'peanut', name: 'Peanut', icon: '\u221E' },
    { type: 'capsule', name: 'Capsule', icon: '\u2B2C' },
    { type: 'icosahedron', name: 'Icosahedron', icon: '\u2B21' },
    { type: 'mobius', name: 'M\u00F6bius', icon: '\u223F' },
    { type: 'sphere-tunnel', name: 'Sphere Tunnel', icon: '\u2295' },
    { type: 'cube-ring', name: 'Cube Ring', icon: '\u25A3' },
    { type: 'cube-tunnel', name: 'Cube Tunnel', icon: '\u25A7' },
  ];

  constructor() {
    this.progress = LevelCompleteScreen.loadProgress();
    this.container = document.createElement('div');
    this.container.id = 'start-menu';
    this.container.innerHTML = this.createMenuHTML();
    this.applyStyles();
    document.body.appendChild(this.container);
    this.attachEventListeners();

    // Animated 3D background behind the menu overlay
    this.menuBackground = new MenuBackground();
    this.menuBackground.start();
  }

  // -----------------------------------------------------------------------
  // Surface grid HTML (reused for Quick Game, Co-op, LAN)
  // -----------------------------------------------------------------------

  private createSurfaceGridHTML(gridClass: string, selectedSurface: SurfaceType): string {
    const buttons = this.surfaces
      .map(
        (s) => `
        <button class="surface-btn${s.type === selectedSurface ? ' selected' : ''}"
                data-surface="${s.type}">
          <span class="icon">${s.icon}</span>
          <span class="name">${s.name}</span>
        </button>
      `
      )
      .join('');
    return `<div class="surface-grid ${gridClass}">${buttons}</div>`;
  }

  // -----------------------------------------------------------------------
  // Main menu HTML
  // -----------------------------------------------------------------------

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

    // Group adventure levels by section
    const sections = new Map<string, typeof ADVENTURE_LEVELS>();
    for (const level of ADVENTURE_LEVELS) {
      const existing = sections.get(level.section) ?? [];
      existing.push(level);
      sections.set(level.section, existing);
    }

    const levelGridHTML = Array.from(sections.entries())
      .map(([sectionName, levels]) => {
        const levelBtns = levels.map((lev, _i) => {
          const idx = ADVENTURE_LEVELS.indexOf(lev);
          const unlocked = idx <= this.progress.unlockedLevel;
          const stars = this.progress.stars[idx] ?? 0;
          const starStr = '\u2605'.repeat(stars) + '\u2606'.repeat(3 - stars);
          return `
            <button class="level-btn ${unlocked ? '' : 'locked'}"
                    data-level="${idx}" ${unlocked ? '' : 'disabled'}>
              <span class="level-num">${lev.id}</span>
              <span class="level-name">${lev.name}</span>
              <span class="level-stars">${unlocked ? starStr : '\uD83D\uDD12'}</span>
            </button>
          `;
        }).join('');

        return `
          <div class="level-section">
            <h4>${sectionName}</h4>
            <div class="level-row">${levelBtns}</div>
          </div>
        `;
      }).join('');

    // Main menu button definitions for the oval layout
    const mainButtons = [
      { mode: 'adventure', label: 'ADVENTURE', primary: true },
      { mode: 'single', label: 'QUICK GAME', primary: false },
      { mode: 'multiplayer', label: 'LOCAL CO-OP', primary: false },
      { mode: 'lan', label: 'LAN', primary: false },
      { mode: 'network', label: 'ONLINE', primary: false },
    ];

    // Generate menu buttons (flex column, no absolute positioning)
    const ovalButtonsHTML = mainButtons.map((btn) => {
      const cls = btn.primary ? 'oval-btn oval-btn-primary' : 'oval-btn';
      return `
        <button class="${cls}" data-mode="${btn.mode}">
          <span class="oval-btn-icon">\u25B6</span>
          <span class="oval-btn-label">${btn.label}</span>
        </button>
      `;
    }).join('');

    return `
      <div class="menu-overlay">
        <!-- Title at top center -->
        <div class="menu-title-container">
          <h1 class="title">GEOMETRY WARS 3D</h1>
        </div>

        <!-- Oval-layout buttons on the left -->
        <div class="oval-buttons-container" id="main-buttons">
          ${ovalButtonsHTML}
        </div>

        <!-- Sub-panels (hidden by default, shown when button clicked) -->
        <div class="sub-panel adventure-section hidden" id="adventure-levels">
          <h3>ADVENTURE LEVELS</h3>
          <div class="level-grid">
            ${levelGridHTML}
          </div>
          <button class="back-btn" id="adventure-back">BACK</button>
        </div>

        <div class="sub-panel coop-section hidden" id="coop-section">
          <h3>LOCAL CO-OP</h3>
          <div class="coop-buttons">
            <button class="coop-btn" data-players="2">2 PLAYERS</button>
            <button class="coop-btn" data-players="3">3 PLAYERS</button>
            <button class="coop-btn" data-players="4">4 PLAYERS</button>
          </div>
          <div class="coop-surface-pick hidden" id="coop-surface-pick">
            <h3>SELECT MAP</h3>
            ${this.createSurfaceGridHTML('coop-surface-grid', this.coopSelectedSurface)}
            <button class="start-btn coop-start-btn" id="coop-start-btn">
              <span class="btn-icon">\u25B6</span>
              <span>START</span>
            </button>
          </div>
          <button class="controls-btn" id="configure-controls">CONFIGURE CONTROLS</button>
          <button class="back-btn" id="coop-back">BACK</button>
        </div>

        <div class="sub-panel lan-section hidden" id="lan-section">
          <h3>LAN GAME</h3>
          <div id="lan-host-panel">
            <button class="lan-btn lan-host" id="lan-host-btn">HOST GAME</button>
            <div id="lan-host-surface-pick" class="hidden">
              <h3>SELECT MAP</h3>
              ${this.createSurfaceGridHTML('lan-surface-grid', this.lanSelectedSurface)}
              <div class="lan-timeout-row">
                <label class="lan-timeout-label" for="lan-timeout-input">Idle shutdown delay</label>
                <div class="lan-timeout-input-wrap">
                  <input type="number" id="lan-timeout-input" min="0" max="3600" value="180" step="30" />
                  <span class="lan-timeout-unit">sec</span>
                </div>
                <span class="lan-timeout-hint">Server auto-closes when all players leave (0 = never)</span>
              </div>
              <button class="lan-btn lan-host" id="lan-start-host-btn">START HOSTING</button>
            </div>
            <div id="lan-host-info" class="hidden">
              <p id="lan-host-status" class="lan-status">Starting server...</p>
              <p id="lan-host-url" class="lan-url"></p>
              <div id="lan-qr-container"></div>
              <button class="lan-btn lan-enter hidden" id="lan-enter-btn">ENTER GAME</button>
              <button class="lan-btn lan-stop hidden" id="lan-stop-btn">STOP SERVER</button>
            </div>
          </div>
          <div class="lan-divider-line"></div>
          <h3 class="lan-lobby-title">AVAILABLE GAMES</h3>
          <div class="lan-lobby-list" id="lan-lobby-list">
            <div class="lan-lobby-empty" id="lan-lobby-empty">
              <p>Scanning for games...</p>
            </div>
          </div>
          <div class="lan-refresh-bar">
            <button class="lan-btn lan-refresh" id="lan-refresh-btn">REFRESH</button>
            <button class="lan-btn lan-auto-toggle active" id="lan-auto-refresh-btn">AUTO-REFRESH: ON</button>
          </div>
          <div class="lan-divider-line"></div>
          <h3 class="lan-manual-title">MANUAL CONNECT</h3>
          <div class="lan-input-row">
            <input type="text" id="lan-ip-input" placeholder="Host IP (e.g. 192.168.1.15)" />
            <button class="lan-btn lan-connect" id="lan-connect-btn">CONNECT</button>
          </div>
          <button class="back-btn" id="lan-back">BACK</button>
        </div>

        <div class="sub-panel surface-section hidden" id="surface-section">
          <h3>SELECT SURFACE</h3>
          <div class="surface-grid">
            ${surfaceButtons}
          </div>
          <button class="start-btn" id="surface-start-btn">
            <span class="btn-icon">\u25B6</span>
            <span>START</span>
          </button>
          <button class="back-btn" id="surface-back">BACK</button>
        </div>

        <!-- Name input dialog (shown before joining LAN) -->
        <div class="sub-panel lan-name-dialog hidden" id="lan-name-dialog">
          <h3>ENTER YOUR NAME</h3>
          <div class="lan-name-input-wrap">
            <input type="text" id="lan-name-input" placeholder="Enter your name..." maxlength="20" />
          </div>
          <p class="lan-name-error hidden" id="lan-name-error"></p>
          <div class="lan-name-buttons">
            <button class="lan-btn lan-name-join" id="lan-name-join-btn">JOIN</button>
            <button class="back-btn" id="lan-name-cancel-btn">CANCEL</button>
          </div>
        </div>

        <div class="controls-hint">
          <p>WASD - Move | Mouse - Aim | Click - Shoot | Space - Bomb | M - Mute</p>
          <button class="weapon-info-btn" id="weapon-info-btn">WEAPON DATABASE</button>
          <button class="weapon-info-btn" id="visual-styles-btn">VISUAL STYLES</button>
          <button class="weapon-info-btn" id="settings-btn">SETTINGS</button>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  private applyStyles(): void {
    const style = document.createElement('style');
    this.styleElement = style;
    style.textContent = `
      /* ------------------------------------------------------------------- */
      /* Main overlay                                                         */
      /* ------------------------------------------------------------------- */
      #start-menu {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, rgba(10,0,32,0.75) 0%, rgba(26,0,64,0.55) 50%, rgba(10,0,32,0.70) 100%);
        z-index: 1000;
        font-family: 'Segoe UI', Arial, sans-serif;
        overflow: hidden;
      }

      #start-menu .menu-overlay {
        position: relative;
        width: 100%;
        height: 100%;
      }

      /* ------------------------------------------------------------------- */
      /* Title                                                                */
      /* ------------------------------------------------------------------- */
      #start-menu .menu-title-container {
        position: absolute;
        top: 4%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        z-index: 10;
      }

      #start-menu .title {
        font-size: clamp(32px, 5vw, 72px);
        font-weight: bold;
        color: #00ffff;
        text-shadow:
          0 0 10px #00ffff,
          0 0 20px #00ffff,
          0 0 40px #0088ff;
        margin: 0;
        letter-spacing: 8px;
        white-space: nowrap;
      }

      /* ------------------------------------------------------------------- */
      /* Oval button layout (left side)                                       */
      /* ------------------------------------------------------------------- */
      #start-menu .oval-buttons-container {
        position: absolute;
        top: 50%;
        left: 15%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        gap: 16px;
        z-index: 10;
      }

      #start-menu .oval-btn {
        background: linear-gradient(180deg, rgba(40,40,90,0.85) 0%, rgba(20,20,50,0.9) 100%);
        border: 2px solid rgba(136,136,255,0.6);
        color: #ccccff;
        padding: 14px 32px;
        font-size: 15px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 10px;
        letter-spacing: 3px;
        white-space: nowrap;
        min-width: 200px;
        justify-content: center;
        border-radius: 4px;
        box-shadow: 0 0 8px rgba(136,136,255,0.15);
      }

      #start-menu .oval-btn:hover {
        background: linear-gradient(180deg, rgba(60,60,140,0.95) 0%, rgba(30,30,80,0.95) 100%);
        border-color: #aaaaff;
        color: #ffffff;
        transform: scale(1.05);
        box-shadow:
          0 0 20px rgba(136,136,255,0.4),
          0 0 40px rgba(136,136,255,0.15);
      }

      #start-menu .oval-btn-primary {
        background: linear-gradient(180deg, rgba(0,140,0,0.85) 0%, rgba(0,80,0,0.9) 100%);
        border-color: rgba(0,255,0,0.6);
        color: #ffffff;
        padding: 16px 40px;
        font-size: 17px;
        box-shadow: 0 0 12px rgba(0,255,0,0.2);
      }

      #start-menu .oval-btn-primary:hover {
        background: linear-gradient(180deg, rgba(0,180,0,0.95) 0%, rgba(0,100,0,0.95) 100%);
        border-color: #00ff00;
        box-shadow:
          0 0 25px rgba(0,255,0,0.5),
          0 0 50px rgba(0,255,0,0.2);
      }

      #start-menu .oval-btn-icon {
        font-size: 16px;
        opacity: 0.7;
        transition: opacity 0.3s;
      }
      #start-menu .oval-btn:hover .oval-btn-icon {
        opacity: 1;
      }

      /* Glow pulse animation on buttons */
      @keyframes menuGlowPulse {
        0%, 100% { box-shadow: 0 0 8px rgba(136,136,255,0.15); }
        50% { box-shadow: 0 0 16px rgba(136,136,255,0.3); }
      }
      @keyframes menuGlowPulsePrimary {
        0%, 100% { box-shadow: 0 0 12px rgba(0,255,0,0.2); }
        50% { box-shadow: 0 0 24px rgba(0,255,0,0.4); }
      }

      #start-menu .oval-btn {
        animation: menuGlowPulse 3s ease-in-out infinite;
      }
      #start-menu .oval-btn-primary {
        animation: menuGlowPulsePrimary 2.5s ease-in-out infinite;
      }
      #start-menu .oval-btn:hover,
      #start-menu .oval-btn-primary:hover {
        animation: none;
      }

      /* ------------------------------------------------------------------- */
      /* Sub-panels (adventure, coop, lan, surface selection)                 */
      /* ------------------------------------------------------------------- */
      #start-menu .sub-panel {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 52%;
        max-width: 700px;
        max-height: 75%;
        overflow-y: auto;
        z-index: 20;
        background: rgba(8,4,24,0.92);
        border: 1px solid rgba(0,255,255,0.15);
        border-radius: 6px;
        padding: 24px;
        box-shadow: 0 0 30px rgba(0,0,0,0.6);
      }

      #start-menu h3 {
        color: #88ffff;
        font-size: 16px;
        letter-spacing: 4px;
        margin-bottom: 15px;
        text-align: center;
      }

      /* ------------------------------------------------------------------- */
      /* Surface grid                                                         */
      /* ------------------------------------------------------------------- */
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

      /* ------------------------------------------------------------------- */
      /* Start button (inside sub-panels)                                     */
      /* ------------------------------------------------------------------- */
      #start-menu .start-btn {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border: 2px solid #00ff00;
        color: #ffffff;
        padding: 16px 36px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 10px;
        letter-spacing: 2px;
        justify-content: center;
      }

      #start-menu .start-btn:hover {
        background: linear-gradient(180deg, #00cc00 0%, #008800 100%);
        transform: scale(1.05);
        box-shadow: 0 0 20px #00ff00;
      }

      #start-menu .btn-icon {
        font-size: 20px;
      }

      /* ------------------------------------------------------------------- */
      /* Controls hint (bottom center)                                        */
      /* ------------------------------------------------------------------- */
      #start-menu .controls-hint {
        position: absolute;
        bottom: 3%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        color: #666688;
        font-size: 12px;
        letter-spacing: 2px;
        z-index: 10;
      }

      #start-menu .weapon-info-btn {
        background: none;
        border: 1px solid #666644;
        color: #aaaa66;
        padding: 6px 18px;
        font-size: 11px;
        cursor: pointer;
        letter-spacing: 2px;
        margin-top: 12px;
        transition: all 0.2s;
      }
      #start-menu .weapon-info-btn:hover {
        border-color: #ffaa44;
        color: #ffcc66;
        box-shadow: 0 0 10px rgba(255, 170, 68, 0.4);
      }

      /* ------------------------------------------------------------------- */
      /* Co-op buttons                                                        */
      /* ------------------------------------------------------------------- */
      #start-menu .coop-buttons {
        display: flex;
        gap: 15px;
        justify-content: center;
        margin: 20px 0;
      }

      #start-menu .coop-btn {
        background: linear-gradient(180deg, #664488 0%, #442266 100%);
        border: 2px solid #aa66ff;
        color: #ffffff;
        padding: 20px 35px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
      }

      #start-menu .coop-btn:hover {
        background: linear-gradient(180deg, #8866aa 0%, #553388 100%);
        transform: scale(1.05);
        box-shadow: 0 0 20px #aa66ff;
      }

      #start-menu .coop-btn.active {
        background: linear-gradient(180deg, #8866aa 0%, #553388 100%);
        box-shadow: 0 0 20px #aa66ff;
        border-color: #cc88ff;
      }

      #start-menu .coop-start-btn {
        margin-top: 15px;
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border: 2px solid #00ff00;
      }
      #start-menu .coop-start-btn:hover {
        background: linear-gradient(180deg, #00cc00 0%, #008800 100%);
        box-shadow: 0 0 20px #00ff00;
      }

      #start-menu .coop-surface-pick,
      #start-menu #lan-host-surface-pick {
        margin-top: 15px;
      }

      #start-menu .lan-timeout-row {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin: 12px 0;
        padding: 10px;
        background: rgba(0, 40, 40, 0.3);
        border: 1px solid rgba(0, 100, 100, 0.3);
        border-radius: 4px;
      }
      #start-menu .lan-timeout-label {
        color: #88cccc;
        font: 13px monospace;
        letter-spacing: 1px;
      }
      #start-menu .lan-timeout-input-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #start-menu #lan-timeout-input {
        background: rgba(0, 40, 40, 0.6);
        border: 1px solid #006666;
        color: #00ffff;
        padding: 6px 10px;
        font: 14px monospace;
        width: 80px;
        outline: none;
        text-align: center;
      }
      #start-menu #lan-timeout-input:focus {
        border-color: #00ffff;
        box-shadow: 0 0 8px #00ffff;
      }
      #start-menu .lan-timeout-unit {
        color: #668888;
        font: 12px monospace;
      }
      #start-menu .lan-timeout-hint {
        color: #557777;
        font: 11px monospace;
        text-align: center;
      }

      /* ------------------------------------------------------------------- */
      /* Controls config button                                               */
      /* ------------------------------------------------------------------- */
      #start-menu .controls-btn {
        background: rgba(40, 40, 80, 0.6);
        border: 1px solid #6666aa;
        color: #aaaaff;
        padding: 10px 30px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
        margin-top: 10px;
        display: block;
        margin-left: auto;
        margin-right: auto;
      }
      #start-menu .controls-btn:hover {
        background: rgba(60, 60, 120, 0.8);
        color: #ffffff;
        box-shadow: 0 0 10px #6666aa;
      }

      /* ------------------------------------------------------------------- */
      /* Back button                                                          */
      /* ------------------------------------------------------------------- */
      #start-menu .back-btn {
        background: rgba(80, 40, 0, 0.4);
        border: 1px solid #884400;
        color: #ff8800;
        padding: 10px 30px;
        font-size: 14px;
        cursor: pointer;
        margin-top: 15px;
        letter-spacing: 3px;
        transition: all 0.2s;
        display: block;
        margin-left: auto;
        margin-right: auto;
      }
      #start-menu .back-btn:hover {
        background: rgba(120, 60, 0, 0.5);
        box-shadow: 0 0 15px #ff8800;
      }

      /* ------------------------------------------------------------------- */
      /* Adventure levels                                                     */
      /* ------------------------------------------------------------------- */
      #start-menu .adventure-section {
        max-height: 70vh;
        overflow-y: auto;
      }

      #start-menu .level-section h4 {
        color: #ff88ff;
        font-size: 14px;
        letter-spacing: 3px;
        margin: 15px 0 8px;
        text-align: left;
      }

      #start-menu .level-row {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 8px;
        margin-bottom: 5px;
      }

      #start-menu .level-btn {
        background: rgba(0, 80, 80, 0.3);
        border: 1px solid #005555;
        color: #00cccc;
        padding: 8px 6px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        font-size: 10px;
      }
      #start-menu .level-btn:hover:not(.locked) {
        background: rgba(0, 150, 150, 0.4);
        border-color: #00ffff;
        transform: scale(1.05);
      }
      #start-menu .level-btn.locked {
        opacity: 0.4;
        cursor: not-allowed;
      }
      #start-menu .level-btn .level-num {
        font-size: 16px;
        font-weight: bold;
      }
      #start-menu .level-btn .level-name {
        font-size: 9px;
        color: #88aaaa;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      #start-menu .level-btn .level-stars {
        font-size: 12px;
        color: #ffdd00;
      }

      /* ------------------------------------------------------------------- */
      /* LAN section                                                          */
      /* ------------------------------------------------------------------- */
      #start-menu .lan-section { text-align: center; }

      #start-menu .lan-btn {
        background: linear-gradient(180deg, #336644 0%, #224422 100%);
        border: 2px solid #44ff66;
        color: #ffffff;
        padding: 14px 30px;
        font-size: 15px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
        margin: 5px;
      }
      #start-menu .lan-btn:hover {
        background: linear-gradient(180deg, #448855 0%, #336633 100%);
        transform: scale(1.05);
        box-shadow: 0 0 15px #44ff66;
      }
      #start-menu .lan-btn.lan-enter {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border-color: #00ff00;
      }
      #start-menu .lan-btn.lan-stop {
        background: linear-gradient(180deg, #884422 0%, #662211 100%);
        border-color: #ff6633;
      }
      #start-menu .lan-divider {
        color: #556666;
        font-size: 12px;
        letter-spacing: 4px;
        margin: 12px 0;
      }
      #start-menu .lan-input-row {
        display: flex;
        gap: 10px;
        justify-content: center;
        align-items: center;
        margin: 10px 0;
      }
      #start-menu #lan-ip-input {
        background: rgba(0, 40, 40, 0.6);
        border: 1px solid #006666;
        color: #00ffff;
        padding: 10px 14px;
        font: 14px monospace;
        width: 240px;
        outline: none;
      }
      #start-menu #lan-ip-input:focus {
        border-color: #00ffff;
        box-shadow: 0 0 8px #00ffff;
      }
      #start-menu .lan-status {
        color: #88ffaa;
        font: 13px monospace;
        margin: 8px 0;
      }
      #start-menu .lan-url {
        color: #00ffff;
        font: 12px monospace;
        word-break: break-all;
        margin: 6px 0;
        user-select: all;
      }
      #start-menu .lan-url-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 6px auto;
        max-width: 550px;
        justify-content: center;
      }
      #start-menu .lan-url-label {
        color: #88aacc;
        font: 11px monospace;
        min-width: 55px;
        text-align: right;
      }
      #start-menu .lan-url-text {
        color: #00ffff;
        font: 12px monospace;
        word-break: break-all;
        user-select: all;
        flex: 1;
        text-align: left;
      }
      #start-menu .lan-copy-btn {
        background: rgba(0, 100, 100, 0.4);
        border: 1px solid #006666;
        color: #00ffff;
        padding: 4px 10px;
        font: 11px monospace;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      #start-menu .lan-copy-btn:hover {
        background: rgba(0, 150, 150, 0.6);
        border-color: #00ffff;
        box-shadow: 0 0 8px #00ffff;
      }
      #start-menu .lan-copy-btn.copied {
        background: rgba(0, 150, 50, 0.5);
        border-color: #00ff66;
        color: #00ff66;
      }
      #start-menu .lan-scan-item {
        background: rgba(0, 60, 60, 0.4);
        border: 1px solid #006666;
        color: #00ffff;
        padding: 10px 20px;
        margin: 5px auto;
        max-width: 350px;
        cursor: pointer;
        font: 13px monospace;
        transition: all 0.2s;
      }
      #start-menu .lan-scan-item:hover {
        background: rgba(0, 100, 100, 0.5);
        border-color: #00ffff;
        box-shadow: 0 0 10px #00ffff;
      }
      #start-menu .lan-scan-msg {
        color: #668888;
        font: 12px monospace;
        margin: 8px 0;
      }

      /* ------------------------------------------------------------------- */
      /* LAN lobby browser                                                    */
      /* ------------------------------------------------------------------- */
      #start-menu .lan-divider-line {
        border: none;
        border-top: 1px solid rgba(0, 255, 255, 0.15);
        margin: 16px 0 8px;
        height: 0;
      }
      #start-menu .lan-lobby-title,
      #start-menu .lan-manual-title {
        color: #66aaaa;
        font-size: 12px;
        letter-spacing: 3px;
        margin: 8px 0 10px;
        text-align: center;
      }
      #start-menu .lan-lobby-list {
        max-height: 220px;
        overflow-y: auto;
        margin: 0 0 10px;
        scrollbar-width: thin;
        scrollbar-color: #006666 rgba(0,40,40,0.3);
      }
      #start-menu .lan-lobby-list::-webkit-scrollbar {
        width: 6px;
      }
      #start-menu .lan-lobby-list::-webkit-scrollbar-track {
        background: rgba(0,40,40,0.3);
      }
      #start-menu .lan-lobby-list::-webkit-scrollbar-thumb {
        background: #006666;
        border-radius: 3px;
      }
      #start-menu .lan-lobby-entry {
        background: rgba(0, 60, 60, 0.35);
        border: 1px solid #005555;
        padding: 10px 14px;
        margin: 0 0 6px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #start-menu .lan-lobby-entry:hover {
        background: rgba(0, 100, 100, 0.45);
        border-color: #00ffff;
        box-shadow: 0 0 12px rgba(0, 255, 255, 0.25);
      }
      #start-menu .lan-lobby-entry.self-server {
        border-color: #44ff66;
      }
      #start-menu .lan-lobby-entry.self-server:hover {
        border-color: #66ff88;
        box-shadow: 0 0 12px rgba(68, 255, 102, 0.25);
      }
      #start-menu .lan-lobby-info {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      #start-menu .lan-lobby-host {
        color: #00ffff;
        font: bold 13px monospace;
      }
      #start-menu .lan-lobby-surface {
        color: #88cccc;
        font: 11px monospace;
      }
      #start-menu .lan-lobby-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 3px;
      }
      #start-menu .lan-lobby-players {
        color: #aaffaa;
        font: bold 13px monospace;
      }
      #start-menu .lan-lobby-status {
        font: 11px monospace;
        padding: 2px 8px;
        border-radius: 3px;
      }
      #start-menu .lan-lobby-status.waiting {
        color: #ffdd44;
        background: rgba(255, 221, 68, 0.1);
      }
      #start-menu .lan-lobby-status.playing {
        color: #44ff66;
        background: rgba(68, 255, 102, 0.1);
      }
      #start-menu .lan-lobby-status.game_over {
        color: #ff6644;
        background: rgba(255, 102, 68, 0.1);
      }
      #start-menu .lan-lobby-status.unknown {
        color: #888888;
        background: rgba(136, 136, 136, 0.1);
      }
      #start-menu .lan-lobby-empty {
        text-align: center;
        padding: 20px;
        color: #557777;
        font: 13px monospace;
      }
      #start-menu .lan-lobby-empty p {
        margin: 4px 0;
      }
      @keyframes lanScanPulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 1; }
      }
      #start-menu .lan-lobby-scanning {
        animation: lanScanPulse 1.2s ease-in-out infinite;
        color: #44dddd;
      }
      #start-menu .lan-refresh-bar {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin: 6px 0 10px;
      }
      #start-menu .lan-btn.lan-refresh {
        padding: 8px 20px;
        font-size: 12px;
      }
      #start-menu .lan-btn.lan-auto-toggle {
        padding: 8px 16px;
        font-size: 11px;
        background: linear-gradient(180deg, #224433 0%, #112222 100%);
        border-color: #338844;
      }
      #start-menu .lan-btn.lan-auto-toggle:hover {
        background: linear-gradient(180deg, #336644 0%, #223333 100%);
      }
      #start-menu .lan-btn.lan-auto-toggle.active {
        border-color: #44ff66;
        color: #aaffaa;
      }
      #start-menu .lan-btn.lan-auto-toggle:not(.active) {
        border-color: #666666;
        color: #888888;
      }

      /* ------------------------------------------------------------------- */
      /* LAN name input dialog                                                */
      /* ------------------------------------------------------------------- */
      #start-menu .lan-name-dialog {
        text-align: center;
        z-index: 30;
      }
      #start-menu .lan-name-input-wrap {
        display: flex;
        justify-content: center;
        margin: 20px 0 10px;
      }
      #start-menu #lan-name-input {
        background: rgba(0, 40, 40, 0.6);
        border: 2px solid #006666;
        color: #00ffff;
        padding: 14px 20px;
        font: 18px monospace;
        width: 300px;
        outline: none;
        text-align: center;
        letter-spacing: 2px;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      #start-menu #lan-name-input:focus {
        border-color: #00ffff;
        box-shadow: 0 0 15px rgba(0, 255, 255, 0.4);
      }
      #start-menu .lan-name-error {
        color: #ff4444;
        font: 13px monospace;
        margin: 8px 0;
        text-shadow: 0 0 8px rgba(255, 68, 68, 0.5);
      }
      #start-menu .lan-name-buttons {
        display: flex;
        gap: 15px;
        justify-content: center;
        margin-top: 15px;
      }
      #start-menu .lan-btn.lan-name-join {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border-color: #00ff00;
        padding: 14px 40px;
        font-size: 16px;
      }
      #start-menu .lan-btn.lan-name-join:hover {
        background: linear-gradient(180deg, #00cc00 0%, #008800 100%);
        box-shadow: 0 0 20px #00ff00;
      }

      /* ------------------------------------------------------------------- */
      /* Hidden utility                                                       */
      /* ------------------------------------------------------------------- */
      #start-menu .hidden { display: none !important; }

      #start-menu.hidden {
        display: none;
      }

      /* ------------------------------------------------------------------- */
      /* Mobile-responsive layout                                             */
      /* ------------------------------------------------------------------- */
      @media (max-width: 900px) and (pointer: coarse) {
        #start-menu .oval-buttons-container {
          position: static;
          transform: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 0 20px;
          margin-top: 15vh;
        }
        #start-menu .oval-btn {
          min-width: 260px;
          min-height: 48px;
          padding: 16px 28px;
          font-size: 16px;
          touch-action: manipulation;
        }
        #start-menu .oval-btn-primary {
          min-height: 52px;
          padding: 18px 36px;
          font-size: 18px;
        }
        #start-menu .sub-panel {
          width: 92%;
          max-width: none;
          padding: 16px;
        }
        #start-menu .surface-grid {
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        #start-menu .surface-btn {
          padding: 12px 8px;
          min-height: 48px;
        }
        #start-menu .start-btn {
          min-height: 52px;
          padding: 16px 28px;
          font-size: 17px;
        }
        #start-menu .controls-hint {
          display: none;
        }
        #start-menu .title {
          font-size: clamp(24px, 6vw, 40px);
          letter-spacing: 4px;
        }
        #start-menu .coop-btn {
          padding: 16px 24px;
          min-height: 48px;
        }
        #start-menu .lan-btn {
          min-height: 48px;
          padding: 12px 20px;
        }
        #start-menu .level-btn {
          min-height: 48px;
          padding: 10px 8px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // Event listeners
  // -----------------------------------------------------------------------

  private attachEventListeners(): void {
    const mainButtonsContainer = this.container.querySelector('#main-buttons') as HTMLElement;
    const adventureSection = this.container.querySelector('#adventure-levels') as HTMLElement;
    const surfaceSection = this.container.querySelector('#surface-section') as HTMLElement;
    const coopSection = this.container.querySelector('#coop-section') as HTMLElement;
    const lanSection = this.container.querySelector('#lan-section') as HTMLElement;

    // Surface selection buttons (Quick Game only - scoped to #surface-section)
    const surfaceBtns = surfaceSection.querySelectorAll('.surface-btn');
    surfaceBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        surfaceBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedSurface = (btn as HTMLElement).dataset.surface as SurfaceType;
      });
    });

    // Oval buttons (main menu mode selectors)
    const ovalBtns = mainButtonsContainer.querySelectorAll('.oval-btn');
    ovalBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as string;

        if (mode === 'adventure') {
          adventureSection.classList.remove('hidden');
          surfaceSection.classList.add('hidden');
          mainButtonsContainer.classList.add('hidden');
          coopSection.classList.add('hidden');
          lanSection.classList.add('hidden');
          return;
        }

        if (mode === 'multiplayer') {
          coopSection.classList.remove('hidden');
          surfaceSection.classList.add('hidden');
          mainButtonsContainer.classList.add('hidden');
          adventureSection.classList.add('hidden');
          lanSection.classList.add('hidden');
          return;
        }

        if (mode === 'lan') {
          lanSection.classList.remove('hidden');
          surfaceSection.classList.add('hidden');
          mainButtonsContainer.classList.add('hidden');
          adventureSection.classList.add('hidden');
          coopSection.classList.add('hidden');
          // Auto-scan when LAN panel opens
          this.performLobbyRefresh();
          this.startAutoRefresh();
          return;
        }

        // Quick Game / Online: show surface selection first
        this.pendingMode = mode as 'single' | 'network';
        surfaceSection.classList.remove('hidden');
        mainButtonsContainer.classList.add('hidden');
        adventureSection.classList.add('hidden');
        coopSection.classList.add('hidden');
        lanSection.classList.add('hidden');
      });
    });

    // Co-op player count buttons - show surface selection after picking count
    const coopBtns = this.container.querySelectorAll('.coop-btn');
    const coopSurfacePick = this.container.querySelector('#coop-surface-pick') as HTMLElement;
    const coopStartBtn = this.container.querySelector('#coop-start-btn') as HTMLElement;

    coopBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.coopPlayerCount = parseInt((btn as HTMLElement).dataset.players ?? '2', 10) as 2 | 3 | 4;
        coopBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        coopSurfacePick.classList.remove('hidden');
      });
    });

    // Co-op surface selection buttons
    const coopSurfaceBtns = this.container.querySelectorAll('.coop-surface-grid .surface-btn');
    coopSurfaceBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        coopSurfaceBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.coopSelectedSurface = (btn as HTMLElement).dataset.surface as SurfaceType;
      });
    });

    // Co-op START button
    coopStartBtn?.addEventListener('click', () => {
      this.onStartCallback?.({
        surfaceType: this.coopSelectedSurface,
        gameMode: 'multiplayer',
        playerCount: this.coopPlayerCount,
      });
    });

    // Configure controls button
    const configControlsBtn = this.container.querySelector('#configure-controls');
    configControlsBtn?.addEventListener('click', () => {
      const tempInput = new ConfigurableInput(4);
      const controlsMenu = new ControlsMenu();
      controlsMenu.setInput(tempInput);
      controlsMenu.onClose(() => {
        controlsMenu.dispose();
        tempInput.dispose();
      });
      controlsMenu.show();
    });

    // Back button from co-op
    const coopBackBtn = this.container.querySelector('#coop-back');
    coopBackBtn?.addEventListener('click', () => {
      coopSection.classList.add('hidden');
      coopSurfacePick.classList.add('hidden');
      coopBtns.forEach((b) => b.classList.remove('active'));
      mainButtonsContainer.classList.remove('hidden');
    });

    // Adventure level selection
    const levelBtns = this.container.querySelectorAll('.level-btn:not(.locked)');
    levelBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const levelIdx = parseInt((btn as HTMLElement).dataset.level ?? '0', 10);
        const level = ADVENTURE_LEVELS[levelIdx];
        this.onStartCallback?.({
          surfaceType: level.surface as SurfaceType,
          gameMode: 'single',
          levelIndex: levelIdx,
        });
      });
    });

    // Surface section START button (Quick Game / Online)
    const surfaceStartBtn = this.container.querySelector('#surface-start-btn');
    surfaceStartBtn?.addEventListener('click', () => {
      this.onStartCallback?.({
        surfaceType: this.selectedSurface,
        gameMode: this.pendingMode,
      });
    });

    // Back button from surface selection
    const surfaceBackBtn = this.container.querySelector('#surface-back');
    surfaceBackBtn?.addEventListener('click', () => {
      surfaceSection.classList.add('hidden');
      mainButtonsContainer.classList.remove('hidden');
    });

    // Back button from adventure
    const backBtn = this.container.querySelector('#adventure-back');
    backBtn?.addEventListener('click', () => {
      adventureSection.classList.add('hidden');
      mainButtonsContainer.classList.remove('hidden');
    });

    // ---- LAN section handlers ----
    const lanHostBtn = this.container.querySelector('#lan-host-btn') as HTMLElement;
    const lanHostInfo = this.container.querySelector('#lan-host-info') as HTMLElement;
    const lanHostStatus = this.container.querySelector('#lan-host-status') as HTMLElement;
    const lanHostUrl = this.container.querySelector('#lan-host-url') as HTMLElement;
    const lanEnterBtn = this.container.querySelector('#lan-enter-btn') as HTMLElement;
    const lanStopBtn = this.container.querySelector('#lan-stop-btn') as HTMLElement;
    const lanConnectBtn = this.container.querySelector('#lan-connect-btn') as HTMLElement;
    const lanIpInput = this.container.querySelector('#lan-ip-input') as HTMLInputElement;
    const lanRefreshBtn = this.container.querySelector('#lan-refresh-btn') as HTMLElement;
    const lanAutoRefreshBtn = this.container.querySelector('#lan-auto-refresh-btn') as HTMLElement;

    let hostedServerUrl = '';
    const lanHostSurfacePick = this.container.querySelector('#lan-host-surface-pick') as HTMLElement;
    const lanStartHostBtn = this.container.querySelector('#lan-start-host-btn') as HTMLElement;
    const lanQRContainer = this.container.querySelector('#lan-qr-container') as HTMLElement;

    // LAN surface selection buttons
    const lanSurfaceBtns = this.container.querySelectorAll('.lan-surface-grid .surface-btn');
    lanSurfaceBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        lanSurfaceBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.lanSelectedSurface = (btn as HTMLElement).dataset.surface as SurfaceType;
      });
    });

    // HOST GAME - show surface selection first
    lanHostBtn?.addEventListener('click', () => {
      lanHostSurfacePick.classList.remove('hidden');
      lanHostBtn.style.display = 'none';
    });

    // START HOSTING - actually start the server with selected surface
    lanStartHostBtn?.addEventListener('click', async () => {
      lanHostSurfacePick.classList.add('hidden');
      lanHostInfo.classList.remove('hidden');
      lanHostStatus.textContent = 'Starting server...';
      lanHostUrl.textContent = '';
      lanQRContainer.innerHTML = '';
      lanEnterBtn.classList.add('hidden');
      lanStopBtn.classList.add('hidden');

      try {
        const timeoutInput = this.container.querySelector('#lan-timeout-input') as HTMLInputElement | null;
        const shutdownTimeout = timeoutInput ? parseInt(timeoutInput.value, 10) || 180 : 180;
        const result = await this.lanClient.startHost({ shutdownTimeout });
        if (result.ok) {
          hostedServerUrl = this.lanClient.getServerWsUrl('localhost', result.port);
          const vitePort = parseInt(window.location.port, 10) || 3000;
          const localhostUrl = this.lanClient.getJoinUrl('localhost', result.port, this.lanSelectedSurface, vitePort);

          lanHostStatus.textContent = 'Server running!';
          lanHostUrl.innerHTML = '';

          const makeCopyRow = (label: string, url: string) => {
            const row = document.createElement('div');
            row.className = 'lan-url-row';
            row.innerHTML = `
              <span class="lan-url-label">${label}:</span>
              <span class="lan-url-text">${url}</span>
            `;
            const copyBtn = document.createElement('button');
            copyBtn.className = 'lan-copy-btn';
            copyBtn.textContent = 'COPY';
            copyBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(url).then(() => {
                copyBtn.textContent = 'COPIED';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                  copyBtn.textContent = 'COPY';
                  copyBtn.classList.remove('copied');
                }, 1500);
              });
            });
            row.appendChild(copyBtn);
            return row;
          };

          lanHostUrl.appendChild(makeCopyRow('Same PC', localhostUrl));
          if (result.addresses.length > 0) {
            const lanUrl = this.lanClient.getJoinUrl(result.addresses[0], result.port, this.lanSelectedSurface, vitePort);
            lanHostUrl.appendChild(makeCopyRow('LAN', lanUrl));

            // Generate QR code with mobile-optimized join URL
            const mobileUrl = this.lanClient.getMobileJoinUrl(result.addresses[0], result.port, this.lanSelectedSurface, vitePort);
            const qrDisplay = createQRCodeDisplay(mobileUrl, mobileUrl, 220);
            lanQRContainer.innerHTML = '';
            lanQRContainer.appendChild(qrDisplay);
          }
          lanEnterBtn.classList.remove('hidden');
          lanStopBtn.classList.remove('hidden');
          // Refresh lobby list to show the new server
          this.performLobbyRefresh();
        } else {
          lanHostStatus.textContent = `Failed: ${result.error ?? 'Unknown error'}`;
          lanHostBtn.style.display = '';
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isNetworkError = err instanceof TypeError || msg.includes('fetch');
        lanHostStatus.textContent = isNetworkError
          ? 'LAN hosting requires dev mode (npm run dev)'
          : `Failed to start: ${msg}`;
        lanHostBtn.style.display = '';
      }
    });

    // ENTER GAME (after hosting) - show name dialog first
    lanEnterBtn?.addEventListener('click', () => {
      if (hostedServerUrl) {
        this.showNameDialog(this.lanSelectedSurface, hostedServerUrl);
      }
    });

    // STOP SERVER
    lanStopBtn?.addEventListener('click', async () => {
      await this.lanClient.stopHost();
      // CRITICAL: Reset ALL hosted state to prevent stale UI
      lanHostInfo.classList.add('hidden');
      lanHostSurfacePick.classList.add('hidden');
      lanHostStatus.textContent = 'Starting server...';
      lanHostUrl.textContent = '';
      lanQRContainer.innerHTML = '';
      lanEnterBtn.classList.add('hidden');
      lanStopBtn.classList.add('hidden');
      lanHostBtn.style.display = '';
      hostedServerUrl = '';
      // Refresh lobby list after stopping
      this.performLobbyRefresh();
    });

    // CONNECT (manual IP) - show name dialog first
    lanConnectBtn?.addEventListener('click', () => {
      const ip = lanIpInput.value.trim();
      if (!ip) return;
      const serverUrl = this.lanClient.getServerWsUrl(ip, 2567);
      this.showNameDialog(this.lanSelectedSurface, serverUrl);
    });

    // Also connect on Enter key in IP input
    lanIpInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        lanConnectBtn?.click();
      }
    });

    // REFRESH button
    lanRefreshBtn?.addEventListener('click', () => {
      this.performLobbyRefresh();
    });

    // AUTO-REFRESH toggle
    lanAutoRefreshBtn?.addEventListener('click', () => {
      this.lanAutoRefreshEnabled = !this.lanAutoRefreshEnabled;
      if (this.lanAutoRefreshEnabled) {
        lanAutoRefreshBtn.textContent = 'AUTO-REFRESH: ON';
        lanAutoRefreshBtn.classList.add('active');
        this.startAutoRefresh();
      } else {
        lanAutoRefreshBtn.textContent = 'AUTO-REFRESH: OFF';
        lanAutoRefreshBtn.classList.remove('active');
        this.stopAutoRefresh();
      }
    });

    // Back from LAN
    const lanBackBtn = this.container.querySelector('#lan-back');
    lanBackBtn?.addEventListener('click', () => {
      this.stopAutoRefresh();
      lanSection.classList.add('hidden');
      lanHostSurfacePick.classList.add('hidden');
      lanHostBtn.style.display = '';
      mainButtonsContainer.classList.remove('hidden');
    });

    // Weapon database
    const weaponInfoBtn = this.container.querySelector('#weapon-info-btn');
    weaponInfoBtn?.addEventListener('click', () => {
      const wiki = new WeaponWiki();
      wiki.show();
      wiki.onClose(() => {
        wiki.dispose();
      });
    });

    // Visual styles playground
    const visualStylesBtn = this.container.querySelector('#visual-styles-btn');
    visualStylesBtn?.addEventListener('click', () => {
      const playground = new VisualPlayground();
      playground.show();
      playground.onClose(() => {
        playground.dispose();
      });
    });

    // Settings menu
    const settingsBtn = this.container.querySelector('#settings-btn');
    settingsBtn?.addEventListener('click', () => {
      const settings = new SettingsMenu();
      settings.show();
      settings.onClose(() => {
        settings.dispose();
      });
    });

    // ---- LAN name dialog handlers ----
    const lanNameJoinBtn = this.container.querySelector('#lan-name-join-btn');
    const lanNameCancelBtn = this.container.querySelector('#lan-name-cancel-btn');
    const lanNameInput = this.container.querySelector('#lan-name-input') as HTMLInputElement;

    lanNameJoinBtn?.addEventListener('click', () => {
      this.submitNameAndJoin();
    });

    lanNameCancelBtn?.addEventListener('click', () => {
      this.cancelNameDialog();
    });

    lanNameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.submitNameAndJoin();
      }
      if (e.key === 'Escape') {
        this.cancelNameDialog();
      }
    });
  }

  // -----------------------------------------------------------------------
  // LAN lobby browser helpers
  // -----------------------------------------------------------------------

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (!this.lanAutoRefreshEnabled) return;
    this.lanAutoRefreshTimer = setInterval(() => {
      this.performLobbyRefresh();
    }, 5000);
  }

  private stopAutoRefresh(): void {
    if (this.lanAutoRefreshTimer !== null) {
      clearInterval(this.lanAutoRefreshTimer);
      this.lanAutoRefreshTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // LAN name dialog helpers
  // -----------------------------------------------------------------------

  /**
   * Show the name dialog before joining a LAN game.
   * Stores the pending join info and shows the dialog overlay.
   */
  private showNameDialog(surfaceType: SurfaceType, serverUrl: string): void {
    this.pendingLanJoin = { surfaceType, serverUrl };

    const lanSection = this.container.querySelector('#lan-section') as HTMLElement;
    const nameDialog = this.container.querySelector('#lan-name-dialog') as HTMLElement;
    const nameInput = this.container.querySelector('#lan-name-input') as HTMLInputElement;
    const errorEl = this.container.querySelector('#lan-name-error') as HTMLElement;

    lanSection.classList.add('hidden');
    nameDialog.classList.remove('hidden');
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    // Pre-fill from localStorage
    const savedName = localStorage.getItem('gw3d_player_name') || '';
    nameInput.value = savedName;

    // Focus the input after a short delay (DOM needs to render)
    setTimeout(() => nameInput.focus(), 50);
  }

  /**
   * Attempt to join with the entered name. Validates locally, then proceeds.
   */
  private submitNameAndJoin(): void {
    if (!this.pendingLanJoin) return;

    const nameInput = this.container.querySelector('#lan-name-input') as HTMLInputElement;
    const errorEl = this.container.querySelector('#lan-name-error') as HTMLElement;

    // Sanitize: trim, strip HTML tags, limit to 20 chars
    let name = nameInput.value.trim().replace(/<[^>]*>/g, '').slice(0, 20);

    // If empty, use default
    if (!name) {
      name = `Player ${Math.floor(Math.random() * 9000) + 1000}`;
    }

    // Save to localStorage
    localStorage.setItem('gw3d_player_name', name);

    // Clear error
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    // Hide dialog and proceed with join
    const nameDialog = this.container.querySelector('#lan-name-dialog') as HTMLElement;
    nameDialog.classList.add('hidden');

    this.stopAutoRefresh();
    this.onStartCallback?.({
      surfaceType: this.pendingLanJoin.surfaceType,
      gameMode: 'network',
      serverUrl: this.pendingLanJoin.serverUrl,
      playerName: name,
    });

    this.pendingLanJoin = null;
  }

  /**
   * Cancel the name dialog and go back to LAN section.
   */
  private cancelNameDialog(): void {
    this.pendingLanJoin = null;
    const nameDialog = this.container.querySelector('#lan-name-dialog') as HTMLElement;
    const lanSection = this.container.querySelector('#lan-section') as HTMLElement;
    nameDialog.classList.add('hidden');
    lanSection.classList.remove('hidden');
  }

  private async performLobbyRefresh(): Promise<void> {
    if (this.lanScanning) return;
    this.lanScanning = true;

    const lobbyList = this.container.querySelector('#lan-lobby-list') as HTMLElement;
    const refreshBtn = this.container.querySelector('#lan-refresh-btn') as HTMLButtonElement | null;

    if (refreshBtn) {
      refreshBtn.textContent = 'SCANNING...';
      refreshBtn.disabled = true;
    }

    // Show scanning state only if list is empty
    const emptyEl = this.container.querySelector('#lan-lobby-empty') as HTMLElement | null;
    if (emptyEl && lobbyList.children.length <= 1) {
      emptyEl.innerHTML = '<p class="lan-lobby-scanning">Scanning local network...</p>';
      emptyEl.style.display = '';
    }

    try {
      const result = await this.lanClient.scan();
      this.renderLobbyEntries(lobbyList, result.found);
    } catch {
      const empty = this.container.querySelector('#lan-lobby-empty') as HTMLElement | null;
      if (empty) {
        empty.innerHTML = '<p>Scan requires dev mode (npm run dev)</p>';
        empty.style.display = '';
      }
    }

    if (refreshBtn) {
      refreshBtn.textContent = 'REFRESH';
      refreshBtn.disabled = false;
    }

    this.lanScanning = false;
  }

  private renderLobbyEntries(
    container: HTMLElement,
    servers: Array<{ ip: string; port: number; info?: { game?: string; self?: boolean }; rooms?: Array<{ roomId: string; name: string; clients: number; maxClients: number; metadata: Record<string, unknown> }> }>,
  ): void {
    container.innerHTML = '';

    if (servers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lan-lobby-empty';
      empty.id = 'lan-lobby-empty';
      empty.innerHTML = `
        <p>No games found on LAN</p>
        <p style="font-size: 11px; color: #445555;">Make sure a server is running and you are on the same network</p>
      `;
      container.appendChild(empty);
      return;
    }

    for (const server of servers) {
      const isSelf = !!(server.info && 'self' in server.info && server.info.self);
      const rooms = server.rooms ?? [];

      if (rooms.length === 0) {
        // Server found but no rooms - show a single entry for the server
        const entry = this.createLobbyEntry(server.ip, server.port, isSelf, {
          surface: 'Unknown',
          players: '0/?',
          status: 'waiting',
          statusLabel: 'No active rooms',
        });
        container.appendChild(entry);
      } else {
        for (const room of rooms) {
          const surface = typeof room.metadata.surface === 'string'
            ? room.metadata.surface.charAt(0).toUpperCase() + room.metadata.surface.slice(1)
            : 'Unknown';
          const status = typeof room.metadata.status === 'string' ? room.metadata.status : 'unknown';
          const wave = typeof room.metadata.wave === 'number' ? room.metadata.wave : 0;

          let statusLabel = 'Waiting for players';
          if (status === 'playing') {
            statusLabel = wave > 0 ? `In Progress - Wave ${wave}` : 'In Progress';
          } else if (status === 'game_over') {
            statusLabel = 'Game Over';
          } else if (status === 'empty') {
            statusLabel = 'Empty';
          }

          const rawSurface = typeof room.metadata.surface === 'string' ? room.metadata.surface : 'sphere';
          const entry = this.createLobbyEntry(server.ip, server.port, isSelf, {
            surface,
            players: `${room.clients}/${room.maxClients}`,
            status,
            statusLabel,
            rawSurface,
          });
          container.appendChild(entry);
        }
      }
    }
  }

  private createLobbyEntry(
    ip: string,
    port: number,
    isSelf: boolean,
    details: { surface: string; players: string; status: string; statusLabel: string; rawSurface?: string },
  ): HTMLElement {
    const entry = document.createElement('div');
    entry.className = `lan-lobby-entry${isSelf ? ' self-server' : ''}`;

    const selfTag = isSelf ? ' (you)' : '';
    const statusClass = ['waiting', 'playing', 'game_over'].includes(details.status)
      ? details.status
      : 'unknown';

    entry.innerHTML = `
      <div class="lan-lobby-info">
        <span class="lan-lobby-host">${ip}${selfTag}</span>
        <span class="lan-lobby-surface">${details.surface}</span>
      </div>
      <div class="lan-lobby-meta">
        <span class="lan-lobby-players">${details.players}</span>
        <span class="lan-lobby-status ${statusClass}">${details.statusLabel}</span>
      </div>
    `;

    entry.addEventListener('click', () => {
      const serverUrl = this.lanClient.getServerWsUrl(ip, port);
      // Use the server's actual surface type, not the local Quick Game selection
      const serverSurface = (details.rawSurface || details.surface.toLowerCase()) as SurfaceType;
      this.showNameDialog(serverSurface, serverUrl);
    });

    return entry;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Set callback for when game starts.
   */
  onStart(callback: (selection: MenuSelection) => void): void {
    this.onStartCallback = callback;
  }

  /**
   * Hide the menu and stop the 3D background.
   */
  hide(): void {
    this.stopAutoRefresh();
    this.container.classList.add('hidden');
    this.menuBackground.stop();
  }

  /**
   * Show the menu and resume the 3D background.
   */
  show(): void {
    this.container.classList.remove('hidden');
    this.menuBackground.start();
  }

  /**
   * Remove menu from DOM and dispose of the 3D background.
   */
  dispose(): void {
    this.stopAutoRefresh();
    // Remove DOM elements FIRST so UI unblocks even if cleanup throws
    this.container.remove();
    if (this.styleElement) {
      this.styleElement.remove();
    }
    this.menuBackground.dispose();
  }
}
