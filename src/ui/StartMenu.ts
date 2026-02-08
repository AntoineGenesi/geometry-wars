import { SurfaceType } from '../surfaces/SurfaceFactory';
import { ADVENTURE_LEVELS } from '../core/LevelData';
import { LevelCompleteScreen, type LevelProgress } from './LevelCompleteScreen';
import { LANClient } from '../network/LANClient';
import { ConfigurableInput } from '../input/ConfigurableInput';
import { ControlsMenu } from './ControlsMenu';
import { WeaponWiki } from './WeaponWiki';
import { MenuBackground } from './MenuBackground';

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
}

// ---------------------------------------------------------------------------
// Ellipse layout helpers
// ---------------------------------------------------------------------------

/** Ellipse parameters for the oval button curve */
const ELLIPSE_CENTER_X = 30; // % of viewport width
const ELLIPSE_CENTER_Y = 50; // % of viewport height
const ELLIPSE_RX = 25; // semi-major axis (horizontal), % of vw
const ELLIPSE_RY = 35; // semi-minor axis (vertical), % of vh

/**
 * Calculate (x%, y%) along the LEFT half of an ellipse.
 * angle=0 is top-center, distributed from about -60deg to +60deg.
 *
 * We distribute N buttons evenly across the LEFT arc of the ellipse,
 * spanning from -PI/3 (top) to +PI/3 (bottom) in parametric angle.
 */
function ellipsePosition(index: number, total: number): { left: string; top: string } {
  // Parametric angle range: -60deg to +60deg from top (mapped to left arc)
  const startAngle = -Math.PI / 3;
  const endAngle = Math.PI / 3;
  const t = total > 1 ? index / (total - 1) : 0.5;
  const angle = startAngle + t * (endAngle - startAngle);

  // On the LEFT side of the ellipse: x decreases from center
  const x = ELLIPSE_CENTER_X - ELLIPSE_RX * Math.sin(angle);
  const y = ELLIPSE_CENTER_Y + ELLIPSE_RY * Math.sin(angle) * 0.6 - ELLIPSE_RY * Math.cos(angle) * 0.5;

  // Clamp to reasonable bounds
  const clampedX = Math.max(2, Math.min(50, x));
  const clampedY = Math.max(5, Math.min(95, y));

  return { left: `${clampedX}%`, top: `${clampedY}%` };
}

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

  // Available surfaces with display names
  private readonly surfaces: { type: SurfaceType; name: string; icon: string }[] = [
    { type: 'sphere', name: 'Sphere', icon: '\u25EF' },
    { type: 'cube', name: 'Cube', icon: '\u25FB' },
    { type: 'torus', name: 'Torus', icon: '\u25CE' },
    { type: 'cylinder', name: 'Cylinder', icon: '\u2B2D' },
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

    // Generate oval-positioned buttons
    const totalButtons = mainButtons.length;
    const ovalButtonsHTML = mainButtons.map((btn, i) => {
      const pos = ellipsePosition(i, totalButtons);
      const cls = btn.primary ? 'oval-btn oval-btn-primary' : 'oval-btn';
      return `
        <button class="${cls}" data-mode="${btn.mode}"
                style="left: ${pos.left}; top: ${pos.top};">
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
              <button class="lan-btn lan-host" id="lan-start-host-btn">START HOSTING</button>
            </div>
            <div id="lan-host-info" class="hidden">
              <p id="lan-host-status" class="lan-status">Starting server...</p>
              <p id="lan-host-url" class="lan-url"></p>
              <button class="lan-btn lan-enter hidden" id="lan-enter-btn">ENTER GAME</button>
              <button class="lan-btn lan-stop hidden" id="lan-stop-btn">STOP SERVER</button>
            </div>
          </div>
          <div class="lan-divider">or</div>
          <div id="lan-join-panel">
            <div class="lan-input-row">
              <input type="text" id="lan-ip-input" placeholder="Host IP (e.g. 192.168.1.15)" />
              <button class="lan-btn lan-connect" id="lan-connect-btn">CONNECT</button>
            </div>
            <button class="lan-btn lan-scan" id="lan-scan-btn">SCAN LAN</button>
            <div id="lan-scan-results"></div>
          </div>
          <button class="back-btn" id="lan-back">BACK</button>
        </div>

        <div class="sub-panel surface-section" id="surface-section">
          <h3>SELECT SURFACE</h3>
          <div class="surface-grid">
            ${surfaceButtons}
          </div>
        </div>

        <div class="controls-hint">
          <p>WASD - Move | Mouse - Aim | Click - Shoot | Space - Bomb | M - Mute</p>
          <button class="weapon-info-btn" id="weapon-info-btn">WEAPON DATABASE</button>
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
        top: 0;
        left: 0;
        width: 55%;
        height: 100%;
        z-index: 10;
      }

      #start-menu .oval-btn {
        position: absolute;
        transform: translate(-50%, -50%);
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
        min-width: 180px;
        justify-content: center;
        border-radius: 4px;
        box-shadow: 0 0 8px rgba(136,136,255,0.15);
      }

      #start-menu .oval-btn:hover {
        background: linear-gradient(180deg, rgba(60,60,140,0.95) 0%, rgba(30,30,80,0.95) 100%);
        border-color: #aaaaff;
        color: #ffffff;
        transform: translate(-50%, -50%) scale(1.08);
        box-shadow:
          0 0 20px rgba(136,136,255,0.4),
          0 0 40px rgba(136,136,255,0.15);
      }

      #start-menu .oval-btn-primary {
        background: linear-gradient(180deg, rgba(0,140,0,0.85) 0%, rgba(0,80,0,0.9) 100%);
        border-color: rgba(0,255,0,0.6);
        color: #ffffff;
        padding: 18px 40px;
        font-size: 18px;
        min-width: 220px;
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
        left: 5%;
        top: 15%;
        width: 48%;
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
      /* Hidden utility                                                       */
      /* ------------------------------------------------------------------- */
      #start-menu .hidden { display: none !important; }

      #start-menu.hidden {
        display: none;
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
          return;
        }

        // Other modes (single, network): use selected surface
        this.onStartCallback?.({
          surfaceType: this.selectedSurface,
          gameMode: mode as 'single' | 'multiplayer' | 'network',
        });
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
      surfaceSection.classList.remove('hidden');
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

    // Back button from adventure
    const backBtn = this.container.querySelector('#adventure-back');
    backBtn?.addEventListener('click', () => {
      adventureSection.classList.add('hidden');
      surfaceSection.classList.remove('hidden');
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
    const lanScanBtn = this.container.querySelector('#lan-scan-btn') as HTMLElement;
    const lanScanResults = this.container.querySelector('#lan-scan-results') as HTMLElement;

    let hostedServerUrl = '';
    const lanHostSurfacePick = this.container.querySelector('#lan-host-surface-pick') as HTMLElement;
    const lanStartHostBtn = this.container.querySelector('#lan-start-host-btn') as HTMLElement;

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
      lanEnterBtn.classList.add('hidden');
      lanStopBtn.classList.add('hidden');

      try {
        const result = await this.lanClient.startHost();
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
          }
          lanEnterBtn.classList.remove('hidden');
          lanStopBtn.classList.remove('hidden');
        } else {
          lanHostStatus.textContent = `Failed: ${result.error ?? 'Unknown error'}`;
          lanHostBtn.style.display = '';
        }
      } catch (err) {
        lanHostStatus.textContent = 'LAN hosting requires dev mode (npm run dev)';
        lanHostBtn.style.display = '';
      }
    });

    // ENTER GAME (after hosting)
    lanEnterBtn?.addEventListener('click', () => {
      if (hostedServerUrl) {
        this.onStartCallback?.({
          surfaceType: this.lanSelectedSurface,
          gameMode: 'network',
          serverUrl: hostedServerUrl,
        });
      }
    });

    // STOP SERVER
    lanStopBtn?.addEventListener('click', async () => {
      await this.lanClient.stopHost();
      lanHostInfo.classList.add('hidden');
      lanHostSurfacePick.classList.add('hidden');
      lanHostBtn.style.display = '';
      hostedServerUrl = '';
    });

    // CONNECT (manual IP)
    lanConnectBtn?.addEventListener('click', () => {
      const ip = lanIpInput.value.trim();
      if (!ip) return;
      const serverUrl = this.lanClient.getServerWsUrl(ip, 2567);
      this.onStartCallback?.({
        surfaceType: this.selectedSurface,
        gameMode: 'network',
        serverUrl,
      });
    });

    // Also connect on Enter key in IP input
    lanIpInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        lanConnectBtn?.click();
      }
    });

    // SCAN LAN
    lanScanBtn?.addEventListener('click', async () => {
      lanScanResults.innerHTML = '<p class="lan-scan-msg">Scanning local network...</p>';
      lanScanBtn.textContent = 'SCANNING...';
      (lanScanBtn as HTMLButtonElement).disabled = true;

      try {
        const result = await this.lanClient.scan();
        lanScanResults.innerHTML = '';

        if (result.found.length === 0) {
          lanScanResults.innerHTML = '<p class="lan-scan-msg">No games found on LAN</p>';
        } else {
          for (const server of result.found) {
            const selfTag = server.info?.self ? ' (you)' : '';
            const item = document.createElement('div');
            item.className = 'lan-scan-item';
            item.textContent = `${server.ip}:${server.port}${selfTag}`;
            item.addEventListener('click', () => {
              const serverUrl = this.lanClient.getServerWsUrl(server.ip, server.port);
              this.onStartCallback?.({
                surfaceType: this.selectedSurface,
                gameMode: 'network',
                serverUrl,
              });
            });
            lanScanResults.appendChild(item);
          }
        }
      } catch {
        lanScanResults.innerHTML = '<p class="lan-scan-msg">Scan requires dev mode (npm run dev)</p>';
      }

      lanScanBtn.textContent = 'SCAN LAN';
      (lanScanBtn as HTMLButtonElement).disabled = false;
    });

    // Back from LAN
    const lanBackBtn = this.container.querySelector('#lan-back');
    lanBackBtn?.addEventListener('click', () => {
      lanSection.classList.add('hidden');
      lanHostSurfacePick.classList.add('hidden');
      lanHostBtn.style.display = '';
      surfaceSection.classList.remove('hidden');
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
    // Remove DOM elements FIRST so UI unblocks even if cleanup throws
    this.container.remove();
    if (this.styleElement) {
      this.styleElement.remove();
    }
    this.menuBackground.dispose();
  }
}
