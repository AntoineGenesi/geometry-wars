import { SurfaceType } from '../surfaces/SurfaceFactory';
import { t, onLanguageChange } from '../i18n';
import { LanguageSelector } from './LanguageSelector';
import { MapSize, getDefaultMapSizeForSurface, MAP_SIZE_LABELS } from '../core/MapSize';
import { ADVENTURE_LEVELS } from '../core/LevelData';
import { LevelCompleteScreen, type LevelProgress } from './LevelCompleteScreen';
import { LANClient } from '../network/LANClient';
import { WeaponWiki } from './WeaponWiki';
import { WeaponMasteryScreen } from './WeaponMasteryScreen';
import { SettingsMenu } from './SettingsMenu';
import { VisualPlayground } from './VisualPlayground';
import { MenuBackground } from './MenuBackground';
import { createQRCodeDisplay } from './QRCode';
import { QUICK_GAME_MODES, type QuickGameModeType } from '../core/modes';
import { OBJDebugPanel } from './OBJDebugPanel';

/**
 * Start menu UI for Geometry Wars.
 * Allows selecting game mode and surface type before starting.
 *
 * Layout: oval-curved buttons on LEFT, 3D surface preview on CENTER-RIGHT.
 */

export interface MenuSelection {
  surfaceType: SurfaceType;
  gameMode: 'single' | 'network';
  levelIndex?: number;
  serverUrl?: string;
  playerName?: string;
  quickGameMode?: QuickGameModeType; // For single player quick game
  customMeshFile?: File; // For custom mesh loading
  mapSize?: MapSize; // Map size tier for enemy count scaling
  /** True only when this player created/hosted the server (clicked HOST GAME → ENTER GAME).
   *  LAN lobby joiners and QR code scanners are NOT creators — they should not claim host. */
  isCreator?: boolean;
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
  private lanSelectedSurface: SurfaceType = 'sphere';
  private progress: LevelProgress;
  private lanClient: LANClient = new LANClient();
  private menuBackground: MenuBackground | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private pendingMode: 'single' | 'network' = 'single';
  private selectedQuickGameMode: QuickGameModeType = 'waves';
  private selectedMapSize: MapSize = MapSize.MEDIUM;
  private lanSelectedMapSize: MapSize = MapSize.MEDIUM;
  private lanAutoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private lanAutoRefreshEnabled = true;
  private lanScanning = false;

  // LAN name dialog state
  private pendingLanJoin: { surfaceType: SurfaceType; serverUrl: string; isCreator: boolean; mapSize: MapSize } | null = null;

  // Custom mesh support
  private customMeshFile: File | null = null;
  private customMeshFileQuickGame: File | null = null;
  private customMeshFileLAN: File | null = null;

  // Debug mode OBJ panel (only active when ?debug=true)
  private readonly isDebugMode: boolean;
  private objDebugPanel: OBJDebugPanel | null = null;

  // Language selector
  private _languageSelector: LanguageSelector | null = null;
  private _langUnsub: (() => void) | null = null;

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
    this.isDebugMode = new URLSearchParams(window.location.search).get('debug') === 'true';
    this.progress = LevelCompleteScreen.loadProgress();
    this.container = document.createElement('div');
    this.container.id = 'start-menu';
    this.container.innerHTML = this.createMenuHTML();
    this.applyStyles();
    document.body.appendChild(this.container);
    this.attachEventListeners();

    // Language selector — bottom-right corner
    const langMount = this.container.querySelector<HTMLElement>('#start-lang-selector');
    if (langMount) {
      this._languageSelector = new LanguageSelector(langMount);
      this._languageSelector.render();
    }

    // Re-render menu text when language changes (same pattern as PauseMenu)
    this._langUnsub = onLanguageChange(() => {
      this.container.innerHTML = this.createMenuHTML();
      this.attachEventListeners();
      // Re-mount LanguageSelector into the new DOM
      if (this._languageSelector) {
        this._languageSelector.dispose();
        this._languageSelector = null;
      }
      const mount = this.container.querySelector<HTMLElement>('#start-lang-selector');
      if (mount) {
        this._languageSelector = new LanguageSelector(mount);
        this._languageSelector.render();
      }
    });

    // Debug OBJ panel — instantiate on demand (F4 key)
    // Lazy-init: created when user presses F4, not at startup

    // Mark menu as open so rotate-overlay is suppressed
    document.body.classList.add('menu-open');

    // Dismiss loading screen now that menu is ready.
    // IMPORTANT: do this BEFORE creating MenuBackground (which initialises WebGL and
    // can throw on headless / no-GPU environments). If it ran after and MenuBackground
    // threw, the loading-screen would stay on top (z-index 2000) blocking all clicks,
    // including the WEAPON MASTERY button.
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.classList.add('fade-out');
      loadingScreen.addEventListener('transitionend', () => loadingScreen.remove());
    }

    // Animated 3D background behind the menu overlay
    try {
      this.menuBackground = new MenuBackground();
      this.menuBackground?.start();
    } catch (e) {
      console.warn('[StartMenu] MenuBackground could not start (WebGL unavailable?):', e);
    }

    // F4 key handler — toggle OBJ debug panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F4') {
        e.preventDefault();
        this.toggleDebugPanel();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Surface grid HTML (reused for Quick Game, Co-op, LAN)
  // -----------------------------------------------------------------------

  private createSurfaceGridHTML(gridClass: string, selectedSurface: SurfaceType): string {
    const buttons = this.surfaces
      .map(
        (s) => {
          const i18nKey = s.type.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
          return `
          <button class="surface-btn${s.type === selectedSurface ? ' selected' : ''}"
                  data-surface="${s.type}">
            <span class="icon">${s.icon}</span>
            <span class="name">${t('menu.surfaces.' + i18nKey)}</span>
          </button>
        `;
        }
      )
      .join('');

    // Add custom mesh button
    const customMeshBtn = `
      <button class="surface-btn custom-mesh-btn" data-grid-class="${gridClass}">
        <span class="icon">📁</span>
        <span class="name">Load Custom</span>
      </button>
    `;

    return `<div class="surface-grid ${gridClass}">${buttons}${customMeshBtn}</div>`;
  }

  private createMapSizeSelectorHTML(): string {
    const sizes: MapSize[] = [MapSize.SMALL, MapSize.MEDIUM, MapSize.LARGE, MapSize.EPIC];
    const buttons = sizes.map((size) => `
      <button class="map-size-btn${size === this.selectedMapSize ? ' selected' : ''}"
              data-map-size="${size}">
        <span class="map-size-label">${MAP_SIZE_LABELS[size]}</span>
      </button>
    `).join('');
    return `<div class="map-size-selector">${buttons}</div>`;
  }

  private createLanMapSizeSelectorHTML(): string {
    const sizes: MapSize[] = [MapSize.SMALL, MapSize.MEDIUM, MapSize.LARGE, MapSize.EPIC];
    const buttons = sizes.map((size) => `
      <button class="lan-map-size-btn${size === this.lanSelectedMapSize ? ' selected' : ''}"
              data-map-size="${size}">
        <span class="map-size-label">${MAP_SIZE_LABELS[size]}</span>
      </button>
    `).join('');
    return `<div class="map-size-selector">${buttons}</div>`;
  }

  private createModeGridHTML(): string {
    const buttons = QUICK_GAME_MODES
      .map(
        (mode) => `
        <button class="mode-btn${mode.type === this.selectedQuickGameMode ? ' selected' : ''}"
                data-mode-type="${mode.type}">
          <span class="mode-icon">${mode.icon}</span>
          <div class="mode-info">
            <span class="mode-name">${mode.name}</span>
            <span class="mode-desc">${mode.description}</span>
          </div>
        </button>
      `
      )
      .join('');
    return buttons;
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
          <div class="scrollable-content">
            <h3>ADVENTURE LEVELS</h3>
            <div class="level-grid">
              ${levelGridHTML}
            </div>
          </div>
          <button class="back-btn" id="adventure-back">BACK</button>
        </div>

        <div class="sub-panel lan-section hidden" id="lan-section">
          <div class="scrollable-content">
            <h3>LAN GAME</h3>
            <div id="lan-host-panel">
              <button class="lan-btn lan-host" id="lan-host-btn">HOST GAME</button>
              <div id="lan-host-surface-pick" class="hidden">
                <h3>SELECT MAP</h3>
                ${this.createSurfaceGridHTML('lan-surface-grid', this.lanSelectedSurface)}
                <h3>MAP SIZE</h3>
                ${this.createLanMapSizeSelectorHTML()}
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
          </div>
          <button class="back-btn" id="lan-back">BACK</button>
        </div>

        <div class="sub-panel surface-section hidden" id="surface-section">
          <div class="scrollable-content">
            <h3>SELECT GAME MODE</h3>
            <div class="mode-grid">
              ${this.createModeGridHTML()}
            </div>
            <h3>SELECT SURFACE</h3>
            <div class="surface-grid">
              ${surfaceButtons}
              <button class="surface-btn custom-mesh-btn" data-grid-class="quick-game-surface-grid">
                <span class="icon">📁</span>
                <span class="name">Load Custom</span>
              </button>
            </div>
            <h3>MAP SIZE</h3>
            ${this.createMapSizeSelectorHTML()}
            <input type="file" id="custom-mesh-file-input" accept=".obj,.glb,.gltf" style="display: none;" />
            <div id="custom-mesh-loading" class="custom-mesh-loading hidden">
              <p>Loading mesh...</p>
            </div>
            <button class="start-btn" id="surface-start-btn">
              <span class="btn-icon">\u25B6</span>
              <span>START</span>
            </button>
          </div>
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
          <button class="weapon-info-btn" id="weapon-mastery-btn">WEAPON MASTERY</button>
          <button class="weapon-info-btn" id="weapon-info-btn">WEAPON DATABASE</button>
          <button class="weapon-info-btn" id="visual-styles-btn">VISUAL STYLES</button>
          <button class="weapon-info-btn" id="settings-btn">SETTINGS</button>
          ${this.isDebugMode ? '<button class="weapon-info-btn debug-obj-btn" id="debug-obj-btn" style="border-color:#ff8800;color:#ff8800;">DEBUG: LOAD MODELS</button>' : ''}
        </div>

        <!-- Language selector — bottom-right corner -->
        <div id="start-lang-selector"></div>
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
      /* Sub-panels (adventure, lan, surface selection)                       */
      /* ------------------------------------------------------------------- */
      #start-menu .sub-panel {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 52%;
        max-width: 700px;
        max-height: 75%;
        z-index: 20;
        background: rgba(8,4,24,0.92);
        border: 1px solid rgba(0,255,255,0.15);
        border-radius: 6px;
        padding: 24px;
        box-shadow: 0 0 30px rgba(0,0,0,0.6);
        display: flex;
        flex-direction: column;
      }

      #start-menu .scrollable-content {
        overflow-y: auto;
        flex: 1;
        padding-right: 8px;
      }

      /* Scrollbar styling for scrollable content */
      #start-menu .scrollable-content::-webkit-scrollbar {
        width: 8px;
      }
      #start-menu .scrollable-content::-webkit-scrollbar-track {
        background: transparent;
      }
      #start-menu .scrollable-content::-webkit-scrollbar-thumb {
        background: rgba(0, 255, 255, 0.3);
        border-radius: 4px;
      }
      #start-menu .scrollable-content::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 255, 255, 0.5);
      }

      #start-menu h3 {
        color: #88ffff;
        font-size: 16px;
        letter-spacing: 4px;
        margin-bottom: 15px;
        text-align: center;
      }

      /* ------------------------------------------------------------------- */
      /* Game Mode grid                                                       */
      /* ------------------------------------------------------------------- */
      #start-menu .mode-grid {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 20px 0;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
      }

      #start-menu .mode-btn {
        background: rgba(100, 0, 100, 0.3);
        border: 2px solid #660066;
        color: #ff00ff;
        padding: 12px 16px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 12px;
        text-align: left;
      }

      #start-menu .mode-btn:hover {
        background: rgba(150, 0, 150, 0.4);
        border-color: #ff00ff;
        transform: translateX(5px);
      }

      #start-menu .mode-btn.selected {
        background: rgba(255, 0, 255, 0.2);
        border-color: #ff00ff;
        box-shadow: 0 0 15px #ff00ff;
      }

      #start-menu .mode-btn .mode-icon {
        font-size: 32px;
        min-width: 40px;
        text-align: center;
      }

      #start-menu .mode-btn .mode-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
      }

      #start-menu .mode-btn .mode-name {
        font-size: 14px;
        font-weight: bold;
        letter-spacing: 2px;
        color: #ff88ff;
      }

      #start-menu .mode-btn .mode-desc {
        font-size: 11px;
        color: #cc88cc;
        letter-spacing: 0.5px;
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

      #start-menu .custom-mesh-btn {
        background: rgba(100, 50, 100, 0.3);
        border-color: #aa66ff;
      }

      #start-menu .custom-mesh-btn:hover {
        background: rgba(150, 75, 150, 0.4);
        border-color: #cc88ff;
      }

      #start-menu .custom-mesh-btn.selected {
        background: rgba(170, 102, 255, 0.2);
        border-color: #cc88ff;
        box-shadow: 0 0 15px #aa66ff;
      }

      #start-menu .custom-mesh-loading {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        padding: 30px 50px;
        border: 2px solid #00ffff;
        border-radius: 10px;
        color: #00ffff;
        font-size: 18px;
        letter-spacing: 2px;
        z-index: 10000;
        box-shadow: 0 0 30px #00ffff;
      }

      #start-menu .custom-mesh-loading.hidden {
        display: none;
      }

      /* ------------------------------------------------------------------- */
      /* Map size selector                                                    */
      /* ------------------------------------------------------------------- */
      #start-menu .map-size-selector {
        display: flex;
        gap: 8px;
        justify-content: center;
        margin: 12px 0 16px;
      }

      #start-menu .map-size-btn {
        background: rgba(0, 100, 100, 0.3);
        border: 2px solid #006666;
        color: #00ffff;
        padding: 10px 18px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
        flex: 1;
        text-align: center;
      }

      #start-menu .map-size-btn:hover {
        background: rgba(0, 150, 150, 0.4);
        border-color: #00ffff;
        transform: scale(1.05);
      }

      #start-menu .map-size-btn.selected {
        background: rgba(0, 255, 255, 0.2);
        border-color: #00ffff;
        color: #00ffff;
        box-shadow: 0 0 15px #00ffff;
      }

      #start-menu .lan-map-size-btn {
        background: rgba(0, 100, 100, 0.3);
        border: 2px solid #006666;
        color: #00ffff;
        padding: 10px 18px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 2px;
        flex: 1;
        text-align: center;
      }

      #start-menu .lan-map-size-btn:hover {
        background: rgba(0, 150, 150, 0.4);
        border-color: #00ffff;
        transform: scale(1.05);
      }

      #start-menu .lan-map-size-btn.selected {
        background: rgba(0, 255, 255, 0.2);
        border-color: #00ffff;
        color: #00ffff;
        box-shadow: 0 0 15px #00ffff;
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
        margin-top: 12px;
        letter-spacing: 3px;
        transition: all 0.2s;
        display: block;
        margin-left: auto;
        margin-right: auto;
        flex-shrink: 0;
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
      #start-menu .lan-wsl2-note {
        background: rgba(80, 40, 0, 0.5);
        border: 1px solid #ff8800;
        color: #ffcc66;
        font: 11px monospace;
        padding: 8px 12px;
        margin: 8px auto;
        max-width: 520px;
        text-align: left;
        line-height: 1.6;
      }
      #start-menu .lan-wsl2-note code, #start-menu .lan-wsl2-cmd {
        display: block;
        color: #aaffff;
        background: rgba(0, 0, 0, 0.4);
        padding: 2px 6px;
        margin-top: 3px;
        font-size: 10px;
        user-select: all;
        word-break: break-all;
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
        flex-direction: row;
        gap: 15px;
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
      #start-menu .lan-lobby-stop-btn {
        background: rgba(255, 50, 50, 0.25);
        border: 1px solid #ff4444;
        color: #ff6666;
        font: bold 11px monospace;
        padding: 4px 10px;
        cursor: pointer;
        transition: all 0.2s;
        flex: 0 0 auto;
        align-self: center;
      }
      #start-menu .lan-lobby-stop-btn:hover {
        background: rgba(255, 50, 50, 0.5);
        border-color: #ff6666;
        color: #ffffff;
        box-shadow: 0 0 8px rgba(255, 50, 50, 0.4);
      }
      #start-menu .lan-lobby-info {
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 1;
        min-width: 0;
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
        align-items: flex-start;
        gap: 3px;
        flex: 1;
        min-width: 0;
      }
      #start-menu .lan-lobby-qr-container {
        flex: 0 0 auto;
        width: 150px;
        display: flex;
        justify-content: center;
        align-items: center;
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
      @media (max-width: 768px), (pointer: coarse) and (orientation: portrait) {
        #start-menu {
          overflow-y: auto;
        }

        /* Make the overlay a vertical scroll container */
        #start-menu .menu-overlay {
          position: relative;
          min-height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 16px 0 80px;
          overflow-y: auto;
        }

        /* Title: smaller, centered */
        #start-menu .menu-title-container {
          position: static;
          transform: none;
          text-align: center;
          margin-bottom: 24px;
        }
        #start-menu .title {
          font-size: clamp(18px, 5vw, 28px);
          letter-spacing: 4px;
        }

        /* Buttons: full column, not absolutely positioned */
        #start-menu .oval-buttons-container {
          position: static;
          transform: none;
          width: 100%;
          max-width: 320px;
          padding: 0 16px;
          gap: 10px;
        }
        #start-menu .oval-btn {
          width: 100%;
          min-width: unset;
          min-height: 44px;
          padding: 12px 20px;
          font-size: 14px;
          touch-action: manipulation;
        }
        #start-menu .oval-btn-primary {
          min-height: 48px;
          padding: 14px 20px;
          font-size: 15px;
        }

        /* Sub-panels: fixed overlay, scrollable */
        #start-menu .sub-panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 95vw;
          max-height: 85vh;
          overflow-y: auto;
          padding: 16px;
          z-index: 20;
        }

        /* Controls hint: hide keyboard text on mobile, but show action buttons */
        #start-menu .controls-hint p {
          display: none;
        }
        #start-menu .controls-hint {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          padding: 0 16px;
        }
        #start-menu .controls-hint .weapon-info-btn {
          width: 100%;
          max-width: 280px;
          min-height: 44px;
          font-size: 13px;
          padding: 12px 16px;
          touch-action: manipulation;
        }

        /* Surface grid: 3 columns */
        #start-menu .surface-grid {
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        #start-menu .surface-btn {
          padding: 10px 6px;
          min-height: 44px;
        }
        #start-menu .surface-btn .icon {
          font-size: 20px;
        }
        #start-menu .surface-btn .name {
          font-size: 10px;
        }

        /* Headings in sub-panels */
        #start-menu h3 {
          font-size: 13px;
          letter-spacing: 3px;
          margin-bottom: 10px;
        }

        /* Start / back buttons */
        #start-menu .start-btn {
          width: 100%;
          min-height: 48px;
          font-size: 15px;
          padding: 14px 20px;
          margin-top: 12px;
        }
        #start-menu .back-btn {
          width: 100%;
          min-height: 44px;
          font-size: 13px;
          padding: 10px 20px;
          margin-top: 10px;
        }

        /* Level buttons: 4 per row */
        #start-menu .level-row {
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }
        #start-menu .level-btn {
          min-height: 44px;
          padding: 8px 4px;
          font-size: 9px;
        }
        #start-menu .level-btn .level-num {
          font-size: 13px;
        }

        /* Mode buttons: compact */
        #start-menu .mode-btn .mode-icon {
          font-size: 24px;
          min-width: 30px;
        }
        #start-menu .mode-btn .mode-name {
          font-size: 13px;
        }
        #start-menu .mode-btn .mode-desc {
          font-size: 10px;
        }
      }

      /* ------------------------------------------------------------------- */
      /* Language selector — bottom-right corner                              */
      /* ------------------------------------------------------------------- */
      #start-menu #start-lang-selector {
        position: absolute;
        bottom: 12px;
        right: 16px;
        z-index: 10;
      }

      #start-menu #start-lang-selector .lang-selector-section {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
      }

      #start-menu #start-lang-selector .lang-selector-title {
        font-size: 10px;
        color: rgba(255,255,255,0.4);
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      #start-menu #start-lang-selector .lang-selector-grid {
        display: flex;
        flex-direction: row;
        gap: 4px;
      }

      #start-menu #start-lang-selector .lang-btn {
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        line-height: 1;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: opacity 0.2s, border-color 0.2s, filter 0.2s;
        user-select: none;
        color: white;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8), -2px -2px 4px rgba(0, 0, 0, 0.8);
        font-family: Arial, sans-serif;
      }

      #start-menu #start-lang-selector .lang-btn:hover {
        opacity: 0.9;
        border-color: rgba(255,255,255,0.6);
        filter: brightness(1.1);
      }

      #start-menu #start-lang-selector .lang-btn.selected {
        border-color: rgba(100,200,255,0.9);
        box-shadow: 0 0 8px rgba(100,200,255,0.5);
      }

      @media (max-width: 768px) {
        #start-menu #start-lang-selector .lang-btn {
          font-size: 16px;
          width: 48px;
          height: 48px;
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
    const lanSection = this.container.querySelector('#lan-section') as HTMLElement;

    // Mode selection buttons (Quick Game only - scoped to #surface-section)
    const modeBtns = surfaceSection.querySelectorAll('.mode-btn');
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        modeBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedQuickGameMode = (btn as HTMLElement).dataset.modeType as QuickGameModeType;
      });
    });

    // Map size buttons (Quick Game only)
    const mapSizeBtns = surfaceSection.querySelectorAll('.map-size-btn');
    mapSizeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        mapSizeBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedMapSize = (btn as HTMLElement).dataset.mapSize as MapSize;
      });
    });

    // Surface selection buttons (Quick Game only - scoped to #surface-section)
    const surfaceBtns = surfaceSection.querySelectorAll('.surface-btn:not(.custom-mesh-btn)');
    surfaceBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        surfaceBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedSurface = (btn as HTMLElement).dataset.surface as SurfaceType;
        this.customMeshFileQuickGame = null; // Clear custom mesh when selecting built-in
        // Auto-suggest the default map size for this surface
        const suggestedSize = getDefaultMapSizeForSurface(this.selectedSurface);
        this.selectedMapSize = suggestedSize;
        mapSizeBtns.forEach((b) => {
          const isMatch = (b as HTMLElement).dataset.mapSize === suggestedSize;
          b.classList.toggle('selected', isMatch);
        });
      });
    });

    // Custom mesh buttons (all sections)
    const customMeshBtns = this.container.querySelectorAll('.custom-mesh-btn');
    const customMeshFileInput = this.container.querySelector('#custom-mesh-file-input') as HTMLInputElement;

    customMeshBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const gridClass = (btn as HTMLElement).dataset.gridClass ?? 'quick-game-surface-grid';

        // Store which section this is for
        (customMeshFileInput as any).__gridClass = gridClass;

        // Trigger file picker
        customMeshFileInput.click();
      });
    });

    // File input change handler
    if (customMeshFileInput) {
      customMeshFileInput.addEventListener('change', async (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];

        if (!file) return;

        const gridClass = (input as any).__gridClass ?? 'quick-game-surface-grid';

        // Show loading indicator
        const loadingDiv = this.container.querySelector('#custom-mesh-loading') as HTMLElement;
        if (loadingDiv) {
          loadingDiv.classList.remove('hidden');
        }

        try {
          // Validate file type
          const fileName = file.name.toLowerCase();
          if (!fileName.endsWith('.obj') && !fileName.endsWith('.glb') && !fileName.endsWith('.gltf')) {
            alert('Unsupported file type. Please use .obj, .glb, or .gltf files.');
            return;
          }

          // Store the file based on which section
          if (gridClass === 'lan-surface-grid') {
            this.customMeshFileLAN = file;
            this.lanSelectedSurface = 'custom';

            const lanCustomBtn = this.container.querySelector('.lan-surface-grid .custom-mesh-btn') as HTMLElement;
            const lanBtns = this.container.querySelectorAll('.lan-surface-grid .surface-btn');
            lanBtns.forEach((b) => b.classList.remove('selected'));
            lanCustomBtn?.classList.add('selected');
          } else {
            // Quick game
            this.customMeshFileQuickGame = file;
            this.selectedSurface = 'custom';

            const quickCustomBtn = surfaceSection.querySelector('.custom-mesh-btn') as HTMLElement;
            surfaceBtns.forEach((b) => b.classList.remove('selected'));
            quickCustomBtn?.classList.add('selected');
          }

          // Clear the input so the same file can be selected again
          input.value = '';
        } catch (err) {
          alert(`Failed to select mesh: ${(err as Error).message}`);
        } finally {
          if (loadingDiv) {
            loadingDiv.classList.add('hidden');
          }
        }
      });
    }

    // Oval buttons (main menu mode selectors)
    const ovalBtns = mainButtonsContainer.querySelectorAll('.oval-btn');
    ovalBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as string;

        if (mode === 'adventure') {
          adventureSection.classList.remove('hidden');
          surfaceSection.classList.add('hidden');
          mainButtonsContainer.classList.add('hidden');
          lanSection.classList.add('hidden');
          return;
        }

        if (mode === 'lan') {
          lanSection.classList.remove('hidden');
          surfaceSection.classList.add('hidden');
          mainButtonsContainer.classList.add('hidden');
          adventureSection.classList.add('hidden');
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
        lanSection.classList.add('hidden');
      });
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
        quickGameMode: this.pendingMode === 'single' ? this.selectedQuickGameMode : undefined,
        customMeshFile: this.selectedSurface === 'custom' ? this.customMeshFileQuickGame ?? undefined : undefined,
        mapSize: this.selectedMapSize,
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
        // Auto-suggest map size based on surface
        const suggested = getDefaultMapSizeForSurface(this.lanSelectedSurface);
        this.lanSelectedMapSize = suggested;
        const lanMapSizeBtns = this.container.querySelectorAll('.lan-map-size-btn');
        lanMapSizeBtns.forEach((b) => {
          (b as HTMLElement).classList.toggle('selected', (b as HTMLElement).dataset.mapSize === suggested);
        });
      });
    });

    // LAN map size selection buttons
    const lanMapSizeBtns = this.container.querySelectorAll('.lan-map-size-btn');
    lanMapSizeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        lanMapSizeBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.lanSelectedMapSize = (btn as HTMLElement).dataset.mapSize as MapSize;
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
          const vitePort = parseInt(window.location.port, 10) || 3000;
          // Use Vite proxy path for host too — consistent with how LAN clients connect.
          // This also makes the host connection go through the same code path as clients,
          // reducing the chance of proxy-only bugs going undetected.
          hostedServerUrl = `ws://localhost:${vitePort}/ws`;
          
          // Register short code once for this surface/port combination
          const shortCodeUrl = await this.lanClient.registerShortCode('localhost', this.lanSelectedSurface, result.port, vitePort);
          const localhostUrl = shortCodeUrl;
          
          // Helper to replace localhost with actual IP in the short code URL
          const replaceIpInUrl = (baseUrl: string, newIp: string): string => {
            return baseUrl.replace('localhost', newIp);
          };

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

          // Pick the best IP for QR code — prefer Windows LAN IP in WSL2
          const bestLanIp = (result.isWSL2 && result.windowsAddresses?.length)
            ? result.windowsAddresses[0]
            : result.addresses[0];

          if (result.isWSL2) {
            // In WSL2: addresses are 172.x.x.x internal — unreachable from laptop
            if (result.addresses.length > 0) {
              const wsl2Url = replaceIpInUrl(shortCodeUrl, result.addresses[0]);
              lanHostUrl.appendChild(makeCopyRow('WSL2 (internal)', wsl2Url));
            }
            if (result.windowsAddresses && result.windowsAddresses.length > 0) {
              const winUrl = replaceIpInUrl(shortCodeUrl, result.windowsAddresses[0]);
              lanHostUrl.appendChild(makeCopyRow('LAN (Windows)', winUrl));
            }
            // WSL2 connectivity warning
            const wsl2Note = document.createElement('div');
            wsl2Note.className = 'lan-wsl2-note';
            const winIp = result.windowsAddresses?.[0] ?? '(unknown)';
            wsl2Note.innerHTML = `
              <b>&#9888; WSL2 detected</b> — Use <b>LAN (Windows)</b> address from other devices.<br>
              Requires port forwarding: run <code>Setup-WSL-LAN.bat</code> as Administrator.<br>
              <span class="lan-wsl2-cmd">netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectaddress=${result.addresses[0] ?? '?'} connectport=3000</span><br>
              <span class="lan-wsl2-cmd">netsh interface portproxy add v4tov4 listenport=2567 listenaddress=0.0.0.0 connectaddress=${result.addresses[0] ?? '?'} connectport=2567</span><br>
              <small>Then connect from laptop: <b>http://${winIp}:${vitePort}</b></small>
            `;
            lanHostUrl.appendChild(wsl2Note);
          } else if (result.addresses.length > 0) {
            const lanUrl = replaceIpInUrl(shortCodeUrl, result.addresses[0]);
            lanHostUrl.appendChild(makeCopyRow('LAN', lanUrl));
          }

          // Portproxy conflict warning — stale WSL2 port forwarding breaks LAN access
          if (result.portproxyConflict && !result.isWSL2) {
            const ppNote = document.createElement('div');
            ppNote.className = 'lan-wsl2-note';
            ppNote.innerHTML = `
              <b>&#9888; Port forwarding conflict detected!</b><br>
              Windows portproxy rules from a previous WSL2 session are active.<br>
              Laptop connections will be redirected to WSL2 (no server there) and <b>will fail</b>.<br>
              <b>Fix:</b> Right-click <code>Play Game.bat</code> → <b>Run as Administrator</b>.<br>
              This auto-cleans the stale portproxy rules.<br>
              <small>Or manually run as Administrator:<br>
              <code>netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0</code><br>
              <code>netsh interface portproxy delete v4tov4 listenport=2567 listenaddress=0.0.0.0</code></small>
            `;
            lanHostUrl.appendChild(ppNote);
          }

          // Generate QR code using best available IP (using short code URL)
          if (bestLanIp) {
            const qrUrl = replaceIpInUrl(shortCodeUrl, bestLanIp);
            const qrDisplay = createQRCodeDisplay(qrUrl, qrUrl, 220);
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

    // ENTER GAME (after hosting) - show name dialog first.
    // isCreator=true: this player started the server, so they should claim host status.
    lanEnterBtn?.addEventListener('click', () => {
      if (hostedServerUrl) {
        this.showNameDialog(this.lanSelectedSurface, hostedServerUrl, true, this.lanSelectedMapSize);
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
      // Use Vite proxy path (/ws) — only port 3000 needs to be accessible, not 2567 separately.
      const vitePort = parseInt(window.location.port, 10) || 3000;
      const serverUrl = `ws://${ip}:${vitePort}/ws`;
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
      // If we were hosting, stop the server on exit (fire-and-forget — don't block UI).
      // This prevents EADDRINUSE when the user tries to host again later.
      if (hostedServerUrl) {
        this.lanClient.stopHost().catch(() => {});
        hostedServerUrl = '';
        lanHostStatus.textContent = 'Starting server...';
        lanHostUrl.textContent = '';
        lanQRContainer.innerHTML = '';
      }
      lanSection.classList.add('hidden');
      lanHostSurfacePick.classList.add('hidden');
      lanHostInfo.classList.add('hidden');
      lanEnterBtn.classList.add('hidden');
      lanStopBtn.classList.add('hidden');
      lanHostBtn.style.display = '';
      mainButtonsContainer.classList.remove('hidden');
    });

    // Weapon mastery
    const weaponMasteryBtn = this.container.querySelector('#weapon-mastery-btn');
    weaponMasteryBtn?.addEventListener('click', () => {
      try {
        const masteryScreen = new WeaponMasteryScreen();
        masteryScreen.show();
        masteryScreen.onClose(() => masteryScreen.dispose());
      } catch (e) {
        console.error('[StartMenu] WeaponMasteryScreen failed to open:', e);
      }
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

    // Debug OBJ panel button (only present when ?debug=true)
    const debugObjBtn = this.container.querySelector('#debug-obj-btn');
    debugObjBtn?.addEventListener('click', () => {
      if (!this.objDebugPanel) {
        this.objDebugPanel = new OBJDebugPanel();
      }
      this.objDebugPanel.show();
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
  // Debug panel (F4 key)
  // -----------------------------------------------------------------------

  private toggleDebugPanel(): void {
    // Lazy-init: create panel on first F4 press
    if (!this.objDebugPanel) {
      this.objDebugPanel = new OBJDebugPanel();
    }

    // Toggle visibility
    if (this.objDebugPanel.isVisible()) {
      this.objDebugPanel.hide();
    } else {
      this.objDebugPanel.show();
    }
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
   * @param isCreator - true only when this player hosted the server (clicked ENTER GAME after HOST GAME).
   *   LAN lobby joiners, QR code scanners, and manual IP joiners are NOT creators.
   */
  private showNameDialog(surfaceType: SurfaceType, serverUrl: string, isCreator = false, mapSize?: MapSize): void {
    this.pendingLanJoin = { surfaceType, serverUrl, isCreator, mapSize: mapSize ?? MapSize.MEDIUM };

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
      isCreator: this.pendingLanJoin.isCreator,
      mapSize: this.pendingLanJoin.mapSize,
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
      <div class="lan-lobby-qr-container"></div>
      ${isSelf ? '<button class="lan-lobby-stop-btn">STOP</button>' : ''}
    `;

    // Generate QR code for this lobby entry
    const vitePort = parseInt(window.location.port, 10) || 3000;
    const serverSurface = (details.rawSurface || details.surface.toLowerCase()) as SurfaceType;
    const joinUrl = `http://${ip}:${vitePort}/?mode=network&surface=${encodeURIComponent(serverSurface)}`;

    const qrContainer = entry.querySelector('.lan-lobby-qr-container') as HTMLElement | null;
    if (qrContainer) {
      const qrDisplay = createQRCodeDisplay(joinUrl, 'Scan to join', 120);
      qrDisplay.style.margin = '8px 0';
      qrDisplay.style.padding = '8px';
      qrContainer.appendChild(qrDisplay);
    }

    // Stop button for self-hosted servers
    if (isSelf) {
      const stopBtn = entry.querySelector('.lan-lobby-stop-btn') as HTMLElement | null;
      stopBtn?.addEventListener('click', async (e) => {
        e.stopPropagation(); // Don't trigger join
        stopBtn.textContent = '...';
        await this.lanClient.stopHost();
        entry.remove();
        // Refresh lobby after a short delay for the port to free up
        setTimeout(() => this.performLobbyRefresh(), 1000);
      });
    }

    entry.addEventListener('click', () => {
      // ALWAYS use window.location.hostname for same-origin connections.
      // The lobby scan runs on the Vite server that served this page, so all
      // "self" entries are the same machine. Using window.location.hostname
      // guarantees same-origin (no CORS issues from withCredentials:true).
      //
      // For non-self entries (different server on LAN), we REDIRECT the browser
      // to that server's Vite URL. This avoids cross-origin issues entirely —
      // the page loads from the target server, making the connection same-origin.
      if (isSelf || ip === window.location.hostname) {
        const serverUrl = `ws://${window.location.hostname}:${vitePort}/ws`;
        this.showNameDialog(serverSurface, serverUrl);
      } else {
        // Different server: redirect to that server's page (same-origin there)
        window.location.href = joinUrl;
      }
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
    this.menuBackground?.stop();
    document.body.classList.remove('menu-open');
  }

  /**
   * Show the menu and resume the 3D background.
   */
  show(): void {
    this.container.classList.remove('hidden');
    this.menuBackground?.start();
    document.body.classList.add('menu-open');
  }

  /**
   * Remove menu from DOM and dispose of the 3D background.
   */
  dispose(): void {
    this.stopAutoRefresh();
    document.body.classList.remove('menu-open');
    // Remove DOM elements FIRST so UI unblocks even if cleanup throws
    this.container.remove();
    if (this.styleElement) {
      this.styleElement.remove();
    }
    // Clean up language change subscription
    if (this._langUnsub) {
      this._langUnsub();
      this._langUnsub = null;
    }
    // Clean up language selector
    if (this._languageSelector) {
      this._languageSelector.dispose();
      this._languageSelector = null;
    }
    // Clean up debug panel if it was created
    if (this.objDebugPanel) {
      this.objDebugPanel.dispose();
      this.objDebugPanel = null;
    }
    this.menuBackground?.dispose();
  }
}
