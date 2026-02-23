/**
 * VotingScreen — Full implementation (Phase 3).
 *
 * Full-screen overlay shown when roomPhase === 'voting'.
 * Shows map/mode/size options with live vote counts.
 * Host gets extra controls: toggle voting/pick mode and launch immediately.
 *
 * Style matches GameOverScreen: neon/dark aesthetic.
 * DOM is built once in show(); update() only mutates text/classes (no re-renders).
 */

import type { NetworkGameState } from '../network/NetworkClient';

export interface VotingScreenCallbacks {
  /** Called when local player votes for a choice */
  onVote?: (choice: string) => void;
  /** Called when host toggles voting vs pick mode (host only) */
  onHostSetPickMode?: (pickMode: boolean) => void;
  /** Called when host clicks LAUNCH NOW (host only) */
  onHostLaunch?: (choice: string) => void;
  /** Called when player clicks RETURN TO MENU */
  onReturnToMenu?: () => void;
}

export const SURFACES = [
  { id: 'sphere',       icon: '🔵', label: 'SPHERE' },
  { id: 'torus',        icon: '🍩', label: 'TORUS' },
  { id: 'cube',         icon: '📦', label: 'CUBE' },
  { id: 'pill',         icon: '💊', label: 'PILL' },
  { id: 'capsule',      icon: '💉', label: 'CAPSULE' },
  { id: 'icosahedron',  icon: '🔷', label: 'ICOSAHEDRON' },
  { id: 'peanut',       icon: '🥜', label: 'PEANUT' },
  { id: 'cube-tunnel',  icon: '⬡',  label: 'CUBE-TUNNEL' },
];

export const MODES = [
  { id: 'waves', label: 'WAVES' },
];

const SIZES = [
  { id: 'small',  label: 'SMALL' },
  { id: 'medium', label: 'MEDIUM' },
  { id: 'large',  label: 'LARGE' },
];

export class VotingScreen {
  private container: HTMLDivElement;
  private callbacks: VotingScreenCallbacks = {};

  // Local player selections (updated on click, triggers sendVote)
  private selectedSurface = 'sphere';
  private selectedMode = 'waves';
  private selectedSize = 'medium';

  // DOM refs for efficient updates (built once, mutated in update())
  private surfaceCards = new Map<string, HTMLElement>();
  private surfaceBadges = new Map<string, HTMLElement>();
  private modeButtons = new Map<string, HTMLElement>();
  private modeCounts = new Map<string, HTMLElement>();
  private sizeButtons = new Map<string, HTMLElement>();
  private sizeCounts = new Map<string, HTMLElement>();
  private countdownArea: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private hostControls: HTMLElement | null = null;
  private pickModeToggle: HTMLInputElement | null = null;
  private launchBtn: HTMLElement | null = null;

  private isBuilt = false;
  private isHost = false;
  private localPlayerId = '';

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'voting-screen';
    this.applyStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setCallbacks(callbacks: VotingScreenCallbacks): void {
    this.callbacks = callbacks;
  }

  show(state: NetworkGameState, isHost: boolean, localPlayerId: string): void {
    this.isHost = isHost;
    this.localPlayerId = localPlayerId;

    // Pre-select the current game's surface (default to sphere if not in list)
    const validSurface = SURFACES.some(s => s.id === state.surfaceType);
    this.selectedSurface = validSurface ? state.surfaceType : 'sphere';

    // Pre-select current mode/size from server state
    if (state.gameMode && MODES.some(m => m.id === state.gameMode)) {
      this.selectedMode = state.gameMode;
    }
    if (state.mapSize && SIZES.some(s => s.id === state.mapSize)) {
      this.selectedSize = state.mapSize;
    }

    if (!this.isBuilt) {
      this.buildDOM();
    }

    this.container.classList.remove('hidden');
    this.update(state, isHost, localPlayerId);
  }

  /**
   * Update displayed vote counts and state. Called on every Colyseus state patch.
   * Efficient: only mutates text content and CSS classes, no DOM rebuilds.
   */
  update(state: NetworkGameState, isHost: boolean, localPlayerId: string): void {
    if (!this.isBuilt) return;

    this.isHost = isHost;
    this.localPlayerId = localPlayerId;

    // Tally votes per surface / mode / size independently
    const surfaceVotes = new Map<string, number>();
    const modeVotes = new Map<string, number>();
    const sizeVotes = new Map<string, number>();

    state.voteMap.forEach((choice: string) => {
      const parts = choice.split(':');
      const surf = parts[0];
      const mode = parts[1];
      const sz   = parts[2];
      if (surf) surfaceVotes.set(surf, (surfaceVotes.get(surf) ?? 0) + 1);
      if (mode) modeVotes.set(mode, (modeVotes.get(mode) ?? 0) + 1);
      if (sz)   sizeVotes.set(sz,   (sizeVotes.get(sz)   ?? 0) + 1);
    });

    // Surface cards: update badge counts and selected highlight
    this.surfaceCards.forEach((card, id) => {
      card.classList.toggle('vs-selected', id === this.selectedSurface);
    });
    this.surfaceBadges.forEach((badge, id) => {
      badge.textContent = String(surfaceVotes.get(id) ?? 0);
      // In host pick mode, hide vote counts (host is just picking, not voting)
      badge.style.visibility = state.hostPickMode ? 'hidden' : 'visible';
    });

    // Mode buttons: update vote counts and selected state
    this.modeButtons.forEach((btn, id) => {
      btn.classList.toggle('vs-selected', id === this.selectedMode);
    });
    this.modeCounts.forEach((el, id) => {
      el.textContent = String(modeVotes.get(id) ?? 0);
      el.style.visibility = state.hostPickMode ? 'hidden' : 'visible';
    });

    // Size buttons: update vote counts and selected state
    this.sizeButtons.forEach((btn, id) => {
      btn.classList.toggle('vs-selected', id === this.selectedSize);
    });
    this.sizeCounts.forEach((el, id) => {
      el.textContent = String(sizeVotes.get(id) ?? 0);
      el.style.visibility = state.hostPickMode ? 'hidden' : 'visible';
    });

    // Countdown: hide when countdown <= 0 or in host pick mode
    if (this.countdownArea && this.countdownEl) {
      const hideCountdown = state.hostPickMode || state.votingCountdown <= 0;
      this.countdownArea.style.display = hideCountdown ? 'none' : 'flex';
      if (!hideCountdown) {
        this.countdownEl.textContent = String(Math.ceil(state.votingCountdown));
      }
    }

    // Host controls: visible only to host
    if (this.hostControls) {
      this.hostControls.style.display = isHost ? 'flex' : 'none';
    }

    // Sync toggle state without firing change event
    if (this.pickModeToggle && this.pickModeToggle.checked !== state.hostPickMode) {
      this.pickModeToggle.checked = state.hostPickMode;
    }
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  dispose(): void {
    this.container.remove();
  }

  // ---------------------------------------------------------------------------
  // Internal: DOM construction (called once from show())
  // ---------------------------------------------------------------------------

  private buildDOM(): void {
    this.isBuilt = true;
    this.container.innerHTML = '';

    // ---- Layout wrapper ----
    const wrap = document.createElement('div');
    wrap.className = 'vs-wrap';
    this.container.appendChild(wrap);

    // ---- Title ----
    const title = document.createElement('h1');
    title.className = 'vs-title';
    title.textContent = 'CHOOSE YOUR BATTLEFIELD';
    wrap.appendChild(title);

    // ---- Surfaces grid ----
    const grid = document.createElement('div');
    grid.className = 'vs-grid';
    wrap.appendChild(grid);

    for (const surf of SURFACES) {
      const card = document.createElement('div');
      card.className = 'vs-card';
      card.setAttribute('data-surface', surf.id);
      card.innerHTML = `
        <div class="vs-card-icon">${surf.icon}</div>
        <div class="vs-card-label">${surf.label}</div>
        <div class="vs-vote-badge">0</div>
      `;
      card.addEventListener('click', () => {
        this.selectedSurface = surf.id;
        // Refresh selected highlight immediately
        this.surfaceCards.forEach((c, id) => {
          c.classList.toggle('vs-selected', id === this.selectedSurface);
        });
        this.sendVote();
      });
      grid.appendChild(card);

      this.surfaceCards.set(surf.id, card);
      const badge = card.querySelector('.vs-vote-badge') as HTMLElement;
      this.surfaceBadges.set(surf.id, badge);
    }

    // ---- Mode row ----
    const modeRow = this.buildOptionRow('MODE', MODES, this.selectedMode,
      (id) => {
        this.selectedMode = id;
        this.modeButtons.forEach((btn, bid) => btn.classList.toggle('vs-selected', bid === id));
        this.sendVote();
      },
      this.modeButtons, this.modeCounts
    );
    wrap.appendChild(modeRow);

    // ---- Size row ----
    const sizeRow = this.buildOptionRow('SIZE', SIZES, this.selectedSize,
      (id) => {
        this.selectedSize = id;
        this.sizeButtons.forEach((btn, bid) => btn.classList.toggle('vs-selected', bid === id));
        this.sendVote();
      },
      this.sizeButtons, this.sizeCounts
    );
    wrap.appendChild(sizeRow);

    // ---- Countdown ----
    const cdArea = document.createElement('div');
    cdArea.className = 'vs-countdown-area';
    cdArea.style.display = 'flex';
    const cdEl = document.createElement('div');
    cdEl.className = 'vs-countdown';
    cdEl.textContent = '–';
    cdArea.appendChild(cdEl);
    wrap.appendChild(cdArea);
    this.countdownArea = cdArea;
    this.countdownEl = cdEl;

    // ---- Host controls (initially hidden; update() shows/hides) ----
    const hostCtrl = document.createElement('div');
    hostCtrl.className = 'vs-host-controls';
    hostCtrl.style.display = 'none';

    // Pill toggle: VOTING MODE vs HOST PICKS
    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'vs-toggle-wrap';
    toggleWrap.innerHTML = `
      <span class="vs-toggle-label">VOTING</span>
      <div class="vs-toggle-pill">
        <input type="checkbox" class="vs-toggle-checkbox">
        <span class="vs-toggle-knob"></span>
      </div>
      <span class="vs-toggle-label">HOST PICKS</span>
    `;
    const checkbox = toggleWrap.querySelector('.vs-toggle-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', () => {
      this.callbacks.onHostSetPickMode?.(checkbox.checked);
    });
    this.pickModeToggle = checkbox;
    hostCtrl.appendChild(toggleWrap);

    // LAUNCH NOW button
    const launchBtn = document.createElement('button');
    launchBtn.className = 'vs-launch-btn';
    launchBtn.textContent = 'LAUNCH NOW';
    launchBtn.addEventListener('click', () => {
      this.callbacks.onHostLaunch?.(this.currentChoice());
    });
    hostCtrl.appendChild(launchBtn);
    this.launchBtn = launchBtn;
    this.hostControls = hostCtrl;
    wrap.appendChild(hostCtrl);

    // ---- Return to menu ----
    const returnBtn = document.createElement('button');
    returnBtn.className = 'vs-return-btn';
    returnBtn.textContent = 'RETURN TO MENU';
    returnBtn.addEventListener('click', () => {
      this.callbacks.onReturnToMenu?.();
    });
    wrap.appendChild(returnBtn);
  }

  private buildOptionRow(
    label: string,
    options: Array<{ id: string; label: string }>,
    _initialSelected: string,
    onSelect: (id: string) => void,
    buttonMap: Map<string, HTMLElement>,
    countMap: Map<string, HTMLElement>,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vs-option-row';

    const lbl = document.createElement('span');
    lbl.className = 'vs-option-label';
    lbl.textContent = label + ':';
    row.appendChild(lbl);

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'vs-option-btn';
      btn.setAttribute('data-id', opt.id);
      btn.innerHTML = `${opt.label} <span class="vs-opt-count">0</span>`;
      btn.addEventListener('click', () => onSelect(opt.id));
      row.appendChild(btn);

      buttonMap.set(opt.id, btn);
      const countEl = btn.querySelector('.vs-opt-count') as HTMLElement;
      countMap.set(opt.id, countEl);
    }

    return row;
  }

  private currentChoice(): string {
    return `${this.selectedSurface}:${this.selectedMode}:${this.selectedSize}`;
  }

  private sendVote(): void {
    this.callbacks.onVote?.(this.currentChoice());
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #voting-screen {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0, 0, 20, 0.93);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        overflow-y: auto;
        z-index: 3100;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(8px);
        box-sizing: border-box;
        padding: 20px 0 32px;
      }
      #voting-screen.hidden { display: none; }

      /* ---- Layout wrapper ---- */
      #voting-screen .vs-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        max-width: 900px;
        padding: 0 24px;
        box-sizing: border-box;
      }

      /* ---- Title ---- */
      #voting-screen .vs-title {
        font-size: 42px;
        font-weight: bold;
        color: #00ffff;
        text-shadow: 0 0 10px #00ffff, 0 0 30px #00aaff;
        letter-spacing: 6px;
        margin: 0 0 24px;
        text-align: center;
      }

      /* ---- Surface grid ---- */
      #voting-screen .vs-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        width: 100%;
        margin-bottom: 20px;
      }

      #voting-screen .vs-card {
        position: relative;
        background: rgba(0, 20, 40, 0.7);
        border: 2px solid #004466;
        border-radius: 8px;
        padding: 16px 8px 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        cursor: pointer;
        transition: border-color 0.15s, box-shadow 0.15s;
        user-select: none;
      }
      #voting-screen .vs-card:hover {
        border-color: #00aacc;
        box-shadow: 0 0 12px rgba(0, 170, 204, 0.4);
      }
      #voting-screen .vs-card.vs-selected {
        border-color: #00ffff;
        box-shadow: 0 0 20px rgba(0, 255, 255, 0.6), inset 0 0 10px rgba(0, 255, 255, 0.1);
      }

      #voting-screen .vs-card-icon {
        font-size: 32px;
        line-height: 1;
        margin-bottom: 8px;
      }

      #voting-screen .vs-card-label {
        font-size: 10px;
        color: #88ccdd;
        letter-spacing: 2px;
        text-align: center;
      }

      #voting-screen .vs-vote-badge {
        position: absolute;
        top: 6px;
        right: 8px;
        background: #00ffff;
        color: #000020;
        border-radius: 50%;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        box-shadow: 0 0 8px #00ffff;
        transition: transform 0.1s;
      }
      #voting-screen .vs-card.vs-selected .vs-vote-badge {
        background: #ffff00;
        box-shadow: 0 0 10px #ffff00;
        color: #000020;
      }

      /* ---- Option rows (mode / size) ---- */
      #voting-screen .vs-option-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        width: 100%;
        justify-content: center;
      }

      #voting-screen .vs-option-label {
        color: #668888;
        font-size: 13px;
        letter-spacing: 2px;
        min-width: 60px;
        text-align: right;
      }

      #voting-screen .vs-option-btn {
        background: rgba(0, 20, 40, 0.7);
        border: 2px solid #004466;
        color: #88ccdd;
        padding: 10px 24px;
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 2px;
        cursor: pointer;
        border-radius: 4px;
        transition: border-color 0.15s, box-shadow 0.15s, color 0.15s;
        font-family: inherit;
      }
      #voting-screen .vs-option-btn:hover {
        border-color: #00aacc;
        color: #00ffff;
      }
      #voting-screen .vs-option-btn.vs-selected {
        border-color: #00ffff;
        color: #00ffff;
        box-shadow: 0 0 12px rgba(0, 255, 255, 0.5);
        background: rgba(0, 60, 80, 0.5);
      }

      #voting-screen .vs-opt-count {
        display: inline-block;
        background: rgba(0, 255, 255, 0.15);
        border-radius: 10px;
        padding: 1px 7px;
        font-size: 11px;
        margin-left: 6px;
        color: #00ffff;
        font-weight: bold;
        min-width: 20px;
        text-align: center;
      }
      #voting-screen .vs-option-btn.vs-selected .vs-opt-count {
        background: rgba(255, 255, 0, 0.2);
        color: #ffff00;
      }

      /* ---- Countdown ---- */
      #voting-screen .vs-countdown-area {
        justify-content: center;
        align-items: center;
        margin: 12px 0;
        min-height: 80px;
      }
      #voting-screen .vs-countdown {
        font-size: 72px;
        font-weight: bold;
        color: #ffff00;
        text-shadow: 0 0 20px #ffff00, 0 0 40px #aaaa00;
        line-height: 1;
        animation: vs-pulse 1s ease-in-out infinite alternate;
      }
      @keyframes vs-pulse {
        from { opacity: 0.8; transform: scale(1); }
        to   { opacity: 1;   transform: scale(1.05); }
      }

      /* ---- Host controls ---- */
      #voting-screen .vs-host-controls {
        align-items: center;
        gap: 20px;
        margin: 12px 0;
        padding: 14px 24px;
        background: rgba(60, 0, 60, 0.3);
        border: 1px solid #660066;
        border-radius: 8px;
      }

      /* Pill toggle */
      #voting-screen .vs-toggle-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        user-select: none;
      }
      #voting-screen .vs-toggle-label {
        font-size: 12px;
        color: #cc88cc;
        letter-spacing: 2px;
        font-weight: bold;
      }
      #voting-screen .vs-toggle-pill {
        position: relative;
        width: 48px;
        height: 24px;
        background: rgba(80, 0, 80, 0.6);
        border: 2px solid #880088;
        border-radius: 12px;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      #voting-screen .vs-toggle-checkbox {
        opacity: 0;
        position: absolute;
        width: 0; height: 0;
      }
      #voting-screen .vs-toggle-checkbox:checked + .vs-toggle-knob {
        transform: translateX(24px);
        background: #ff88ff;
        box-shadow: 0 0 8px #ff88ff;
      }
      #voting-screen .vs-toggle-checkbox:checked ~ .vs-toggle-pill,
      #voting-screen .vs-toggle-pill:has(.vs-toggle-checkbox:checked) {
        background: rgba(120, 0, 120, 0.6);
        border-color: #ff88ff;
      }
      #voting-screen .vs-toggle-knob {
        position: absolute;
        top: 2px; left: 2px;
        width: 16px; height: 16px;
        border-radius: 50%;
        background: #880088;
        transition: transform 0.2s, background 0.2s;
      }

      #voting-screen .vs-launch-btn {
        background: linear-gradient(180deg, #008800 0%, #005500 100%);
        border: 2px solid #00ff00;
        color: #ffffff;
        padding: 12px 32px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 3px;
        transition: all 0.2s;
        font-family: inherit;
        border-radius: 4px;
      }
      #voting-screen .vs-launch-btn:hover {
        background: linear-gradient(180deg, #00bb00 0%, #007700 100%);
        box-shadow: 0 0 24px #00ff00;
        transform: scale(1.05);
      }

      /* ---- Return to menu ---- */
      #voting-screen .vs-return-btn {
        position: fixed;
        bottom: 20px;
        right: 24px;
        background: rgba(0, 0, 40, 0.8);
        border: 2px solid #ff4444;
        color: #ff4444;
        padding: 10px 24px;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 2px;
        transition: all 0.2s;
        font-family: inherit;
        border-radius: 4px;
      }
      #voting-screen .vs-return-btn:hover {
        background: rgba(80, 0, 0, 0.8);
        box-shadow: 0 0 20px #ff4444;
      }
    `;
    document.head.appendChild(style);
  }
}
