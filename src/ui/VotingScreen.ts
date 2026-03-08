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
import { t, onLanguageChange } from '../i18n';

export interface VotingScreenCallbacks {
  /** Called when local player votes for a choice */
  onVote?: (choice: string) => void;
  /** Called when host toggles voting vs pick mode (host only) */
  onHostSetPickMode?: (pickMode: boolean) => void;
  /** Called when host clicks LAUNCH NOW (host only) */
  onHostLaunch?: (choice: string) => void;
  /** Called when player clicks RETURN TO MENU */
  onReturnToMenu?: () => void;
  /** Called when player clicks WEAPON MASTERY button */
  onOpenMastery?: () => void;
  /** Called when player clicks READY UP button */
  onReadyUp?: () => void;
  /** Called when host pauses or resumes the countdown (host only) */
  onHostPauseCountdown?: (paused: boolean) => void;
  /** Called when host clicks GAME SETTINGS (host only, s44j-settings-16c) */
  onOpenSettings?: () => void;
}

export const SURFACES = [
  { id: 'sphere',       icon: '🔵', label: 'SPHERE' },
  { id: 'torus',        icon: '🍩', label: 'TORUS' },
  { id: 'cube',         icon: '📦', label: 'CUBE' },
  { id: 'pill',         icon: '💊', label: 'PILL' },
  { id: 'capsule',      icon: '💉', label: 'CAPSULE' },
  { id: 'icosahedron',  icon: '🔷', label: 'ICOSAHEDRON' },
  { id: 'peanut',       icon: '🥜', label: 'PEANUT' },
  { id: 'mobius',       icon: '♾',  label: 'MOBIUS' },
  { id: 'mobius-bevel', icon: '⟲',  label: 'MOBIUS-BEVEL' },
  { id: 'cube-tunnel',  icon: '⬡',  label: 'CUBE-TUNNEL' },
];

/** Surfaces allowed in Claustrophobia mode (small, enclosed). Matches server CLAUSTROPHOBIA_ALLOWED_SURFACES. */
export const CLAUSTROPHOBIA_SURFACES = new Set(['sphere', 'torus', 'capsule', 'icosahedron']);

/**
 * Map of mode ID → set of surface IDs where that mode is available.
 * Modes NOT in this map are available on ALL surfaces.
 */
export const MODE_SURFACE_RESTRICTIONS = new Map<string, Set<string>>([
  ['claustrophobia', CLAUSTROPHOBIA_SURFACES],
]);

/**
 * Returns the set of mode IDs that are NOT available on the given surface.
 * Used to dim/disable mode buttons when an incompatible map is selected.
 */
export function getUnavailableModesForSurface(surfaceId: string): Set<string> {
  const unavailable = new Set<string>();
  for (const [modeId, allowedSurfaces] of MODE_SURFACE_RESTRICTIONS) {
    if (!allowedSurfaces.has(surfaceId)) {
      unavailable.add(modeId);
    }
  }
  return unavailable;
}

export const MODES = [
  { id: 'waves',          label: 'WAVES',          icon: '〰' },
  { id: 'king',           label: 'KING',           icon: '👑' },
  { id: 'sniper',         label: 'SNIPER',         icon: '🎯' },
  { id: 'rainbow',        label: 'RAINBOW',        icon: '🌈' },
  { id: 'claustrophobia', label: 'CLAUSTROPHOBIA', icon: '🔴' },
  { id: 'pvp',            label: 'PvP',            icon: '🗡' },
  { id: 'pvpve',          label: 'PvPvE',          icon: '⚔' },
];

const SIZES = [
  { id: 'small',  label: 'SMALL' },
  { id: 'medium', label: 'MEDIUM' },
  { id: 'large',  label: 'LARGE' },
  { id: 'epic',   label: 'EPIC' },
];

/** Sizes allowed in Claustrophobia mode (small/enclosed feel only). */
export const CLAUSTROPHOBIA_ALLOWED_SIZES = new Set(['small', 'medium']);

/**
 * Returns the set of size IDs that are NOT available for the given mode.
 * Currently: Claustrophobia blocks large/epic (defeats the enclosed feel).
 */
export function getUnavailableSizesForMode(modeId: string): Set<string> {
  if (modeId === 'claustrophobia') {
    return new Set(SIZES.map(s => s.id).filter(id => !CLAUSTROPHOBIA_ALLOWED_SIZES.has(id)));
  }
  return new Set();
}

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
  private countdownPausedEl: HTMLElement | null = null;
  private voteDivergenceArea: HTMLElement | null = null;
  private voteDivergenceEl: HTMLElement | null = null;
  private hostControls: HTMLElement | null = null;
  private pickModeToggle: HTMLInputElement | null = null;
  private launchBtn: HTMLElement | null = null;
  private pauseCountdownBtn: HTMLElement | null = null;
  private readyUpBtn: HTMLElement | null = null;
  private readyStatusEl: HTMLElement | null = null;
  private localIsReady = false;

  private isBuilt = false;
  private isHost = false;
  private localPlayerId = '';
  private _langUnsub: (() => void) | null = null;

  // Win condition state (for PvP / PvPvE modes)
  private selectedWinCondition: 'none' | 'time' | 'kills' = 'none';
  private timeLimitMinutes = 5;
  private timeLimitSeconds = 0;
  private killGoal = 10;
  private winCondPanel: HTMLElement | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'voting-screen';
    this.applyStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);

    this._langUnsub = onLanguageChange(() => {
      this.isBuilt = false;
      if (!this.container.classList.contains('hidden')) {
        this.buildDOM();
      }
    });
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

    // Reset ready state for new voting round
    this.localIsReady = false;
    if (this.readyUpBtn) {
      this.readyUpBtn.textContent = 'READY UP';
      this.readyUpBtn.classList.remove('vs-ready-btn--active');
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

    // Surface cards: update badge counts, selected highlight, and Claustrophobia restriction
    const isClaustrophobiaMode = this.selectedMode === 'claustrophobia';
    this.surfaceCards.forEach((card, id) => {
      card.classList.toggle('vs-selected', id === this.selectedSurface);
      // Dim surfaces not allowed in Claustrophobia when that mode is selected
      const isRestricted = isClaustrophobiaMode && !CLAUSTROPHOBIA_SURFACES.has(id);
      card.style.opacity = isRestricted ? '0.35' : '';
      card.style.pointerEvents = isRestricted ? 'none' : '';
      (card as HTMLElement).title = isRestricted ? 'Not available in Claustrophobia mode' : '';
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
    // Dim mode buttons that are unavailable on the currently selected surface
    this.applyModeDimming(this.selectedSurface);

    // Size buttons: update vote counts and selected state
    this.sizeButtons.forEach((btn, id) => {
      btn.classList.toggle('vs-selected', id === this.selectedSize);
    });
    this.sizeCounts.forEach((el, id) => {
      el.textContent = String(sizeVotes.get(id) ?? 0);
      el.style.visibility = state.hostPickMode ? 'hidden' : 'visible';
    });
    // Dim size buttons that are unavailable for the currently selected mode
    this.applySizeDimming(this.selectedMode);

    // Countdown: hide when countdown <= 0 or in host pick mode
    if (this.countdownArea && this.countdownEl && this.countdownPausedEl) {
      const hideCountdown = state.hostPickMode || state.votingCountdown <= 0;
      this.countdownArea.style.display = hideCountdown ? 'none' : 'flex';
      if (!hideCountdown) {
        const isPaused = (state as { countdownPaused?: boolean }).countdownPaused ?? false;
        this.countdownEl.style.display = isPaused ? 'none' : 'block';
        this.countdownPausedEl.style.display = isPaused ? 'block' : 'none';
        if (!isPaused) {
          this.countdownEl.textContent = String(Math.ceil(state.votingCountdown));
        }
        // Update pause button label (host only)
        if (this.pauseCountdownBtn) {
          this.pauseCountdownBtn.textContent = isPaused ? '▶ RESUME TIMER' : '⏸ PAUSE TIMER';
        }
      }
    }

    // Vote Divergence Countdown: show when votes are split (more than 1 unique vote)
    if (this.voteDivergenceArea && this.voteDivergenceEl) {
      const voteDivergenceCountdown = (state as { voteDivergenceCountdown?: number }).voteDivergenceCountdown ?? 0;
      const showDivergence = voteDivergenceCountdown > 0 && !state.hostPickMode;
      this.voteDivergenceArea.style.display = showDivergence ? 'block' : 'none';
      if (showDivergence) {
        this.voteDivergenceEl.textContent = String(Math.ceil(voteDivergenceCountdown));
      }
    }

    // Ready status: show which players are ready
    const readyMap = (state as { readyMap?: Map<string, boolean> }).readyMap;
    if (this.readyStatusEl && readyMap) {
      const totalPlayers = state.players ? state.players.size : 0;
      let readyCount = 0;
      readyMap.forEach((val) => { if (val) readyCount++; });
      this.readyStatusEl.textContent = totalPlayers > 0
        ? `${readyCount}/${totalPlayers} ready`
        : '';
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
    this._langUnsub?.();
    this.container.remove();
  }

  // ---------------------------------------------------------------------------
  // Internal: DOM construction (called once from show())
  // ---------------------------------------------------------------------------

  private buildDOM(): void {
    this.isBuilt = true;
    this.container.innerHTML = '';
    this.surfaceCards.clear();
    this.surfaceBadges.clear();
    this.modeButtons.clear();
    this.modeCounts.clear();
    this.sizeButtons.clear();
    this.sizeCounts.clear();
    this.localIsReady = false;
    this.winCondPanel = null;

    // ---- Layout wrapper ----
    const wrap = document.createElement('div');
    wrap.className = 'vs-wrap';
    this.container.appendChild(wrap);

    // ---- Title ----
    const title = document.createElement('h1');
    title.className = 'vs-title';
    title.textContent = t('voting.title');
    wrap.appendChild(title);

    // ---- Surfaces grid ----
    const grid = document.createElement('div');
    grid.className = 'vs-grid';
    wrap.appendChild(grid);

    for (const surf of SURFACES) {
      const surfKey = surf.id.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
      const card = document.createElement('div');
      card.className = 'vs-card';
      card.setAttribute('data-surface', surf.id);
      card.innerHTML = `
        <div class="vs-card-icon">${surf.icon}</div>
        <div class="vs-card-label">${t('voting.surfaces.' + surfKey)}</div>
        <div class="vs-vote-badge">0</div>
      `;
      card.addEventListener('click', () => {
        this.selectedSurface = surf.id;
        // Refresh selected highlight immediately
        this.surfaceCards.forEach((c, id) => {
          c.classList.toggle('vs-selected', id === this.selectedSurface);
        });
        // If selected mode is no longer available on this surface, switch to waves
        const unavailableModes = getUnavailableModesForSurface(surf.id);
        if (unavailableModes.has(this.selectedMode)) {
          this.selectedMode = 'waves';
          this.modeButtons.forEach((btn, bid) => btn.classList.toggle('vs-selected', bid === this.selectedMode));
        }
        this.applyModeDimming(surf.id);
        this.sendVote();
      });
      grid.appendChild(card);

      this.surfaceCards.set(surf.id, card);
      const badge = card.querySelector('.vs-vote-badge') as HTMLElement;
      this.surfaceBadges.set(surf.id, badge);
    }

    // ---- Mode row ----
    const modeRow = this.buildOptionRow(
      t('voting.mode'),
      MODES.map(m => ({ id: m.id, label: t(`voting.modes.${m.id}`), icon: m.icon })),
      this.selectedMode,
      (id) => {
        this.selectedMode = id;
        this.modeButtons.forEach((btn, bid) => btn.classList.toggle('vs-selected', bid === id));
        // Immediately refresh surface restrictions when mode changes
        const isClaustr = id === 'claustrophobia';
        this.surfaceCards.forEach((card, surfId) => {
          const restricted = isClaustr && !CLAUSTROPHOBIA_SURFACES.has(surfId);
          card.style.opacity = restricted ? '0.35' : '';
          card.style.pointerEvents = restricted ? 'none' : '';
          (card as HTMLElement).title = restricted ? 'Not available in Claustrophobia mode' : '';
        });
        // Auto-switch size if it's no longer valid for the new mode
        const unavailableSizes = getUnavailableSizesForMode(id);
        if (unavailableSizes.has(this.selectedSize)) {
          this.selectedSize = 'medium';
          this.sizeButtons.forEach((btn, bid) => btn.classList.toggle('vs-selected', bid === this.selectedSize));
        }
        this.applySizeDimming(id);
        this.updateWinCondPanelVisibility();
        this.sendVote();
      },
      this.modeButtons, this.modeCounts
    );
    wrap.appendChild(modeRow);

    // ---- Win Condition panel (PvP / PvPvE only) ----
    const winCondPanel = this.buildWinCondPanel();
    wrap.appendChild(winCondPanel);
    this.winCondPanel = winCondPanel;
    this.updateWinCondPanelVisibility();

    // ---- Size row ----
    const sizeRow = this.buildOptionRow(
      t('voting.size'),
      SIZES.map(s => ({ id: s.id, label: t(`voting.sizes.${s.id}`) })),
      this.selectedSize,
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
    const cdPausedEl = document.createElement('div');
    cdPausedEl.className = 'vs-countdown-paused';
    cdPausedEl.textContent = 'PAUSED';
    cdPausedEl.style.display = 'none';
    cdArea.appendChild(cdPausedEl);
    wrap.appendChild(cdArea);
    this.countdownArea = cdArea;
    this.countdownEl = cdEl;
    this.countdownPausedEl = cdPausedEl;

    // ---- Vote Divergence Countdown (3-sec auto-select timer when votes split) ----
    const voteDivArea = document.createElement('div');
    voteDivArea.className = 'vs-vote-divergence-area';
    voteDivArea.style.display = 'none';
    voteDivArea.style.fontSize = '1.2em';
    voteDivArea.style.color = '#ffcc00';
    voteDivArea.style.fontWeight = 'bold';
    voteDivArea.style.marginTop = '8px';
    voteDivArea.style.textAlign = 'center';
    const voteDivMsg = document.createElement('div');
    voteDivMsg.textContent = 'Vote split — auto-selecting in:';
    voteDivMsg.style.fontSize = '0.9em';
    voteDivMsg.style.marginBottom = '4px';
    voteDivArea.appendChild(voteDivMsg);
    const voteDivEl = document.createElement('div');
    voteDivEl.className = 'vs-vote-divergence';
    voteDivEl.textContent = '3';
    voteDivEl.style.fontSize = '1.6em';
    voteDivArea.appendChild(voteDivEl);
    wrap.appendChild(voteDivArea);
    this.voteDivergenceArea = voteDivArea;
    this.voteDivergenceEl = voteDivEl;

    // ---- Ready status row ----
    const readyRow = document.createElement('div');
    readyRow.className = 'vs-ready-status';
    wrap.appendChild(readyRow);
    this.readyStatusEl = readyRow;

    // ---- Ready Up button ----
    const readyBtn = document.createElement('button');
    readyBtn.className = 'vs-ready-btn';
    readyBtn.textContent = 'READY UP';
    readyBtn.addEventListener('click', () => {
      if (!this.localIsReady) {
        this.localIsReady = true;
        readyBtn.textContent = '✓ READY';
        readyBtn.classList.add('vs-ready-btn--active');
        this.callbacks.onReadyUp?.();
      }
    });
    wrap.appendChild(readyBtn);
    this.readyUpBtn = readyBtn;

    // ---- Weapon Mastery button ----
    const masteryBtn = document.createElement('button');
    masteryBtn.className = 'vs-mastery-btn';
    masteryBtn.textContent = '✦ WEAPON MASTERY';
    masteryBtn.addEventListener('click', () => {
      this.callbacks.onOpenMastery?.();
    });
    wrap.appendChild(masteryBtn);

    // ---- Host controls (initially hidden; update() shows/hides) ----
    const hostCtrl = document.createElement('div');
    hostCtrl.className = 'vs-host-controls';
    hostCtrl.style.display = 'none';

    // Pill toggle: VOTING MODE vs HOST PICKS
    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'vs-toggle-wrap';
    toggleWrap.innerHTML = `
      <span class="vs-toggle-label">${t('voting.voting')}</span>
      <div class="vs-toggle-pill">
        <input type="checkbox" class="vs-toggle-checkbox">
        <span class="vs-toggle-knob"></span>
      </div>
      <span class="vs-toggle-label">${t('voting.hostPicks')}</span>
    `;
    const checkbox = toggleWrap.querySelector('.vs-toggle-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', () => {
      this.callbacks.onHostSetPickMode?.(checkbox.checked);
    });
    this.pickModeToggle = checkbox;
    hostCtrl.appendChild(toggleWrap);

    // GAME SETTINGS button (host only, s44j-settings-16c)
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'vs-settings-btn';
    settingsBtn.textContent = '⚙ GAME SETTINGS';
    settingsBtn.addEventListener('click', () => {
      this.callbacks.onOpenSettings?.();
    });
    hostCtrl.appendChild(settingsBtn);

    // LAUNCH NOW button
    const launchBtn = document.createElement('button');
    launchBtn.className = 'vs-launch-btn';
    launchBtn.textContent = t('voting.launchNow');
    launchBtn.addEventListener('click', () => {
      this.callbacks.onHostLaunch?.(this.currentChoice());
    });
    hostCtrl.appendChild(launchBtn);
    this.launchBtn = launchBtn;

    // PAUSE/RESUME countdown button (host only)
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'vs-pause-countdown-btn';
    pauseBtn.textContent = '⏸ PAUSE TIMER';
    pauseBtn.addEventListener('click', () => {
      const willPause = pauseBtn.textContent?.startsWith('⏸');
      this.callbacks.onHostPauseCountdown?.(!!willPause);
    });
    hostCtrl.appendChild(pauseBtn);
    this.pauseCountdownBtn = pauseBtn;

    this.hostControls = hostCtrl;
    wrap.appendChild(hostCtrl);

    // ---- Return to menu ----
    const returnBtn = document.createElement('button');
    returnBtn.className = 'vs-return-btn';
    returnBtn.textContent = t('voting.returnToMenu');
    returnBtn.addEventListener('click', () => {
      this.callbacks.onReturnToMenu?.();
    });
    wrap.appendChild(returnBtn);

    // Apply initial mode dimming based on pre-selected surface
    this.applyModeDimming(this.selectedSurface);
    // Apply initial size dimming based on pre-selected mode
    this.applySizeDimming(this.selectedMode);
  }

  private buildOptionRow(
    label: string,
    options: Array<{ id: string; label: string; icon?: string }>,
    _initialSelected: string,
    onSelect: (id: string) => void,
    buttonMap: Map<string, HTMLElement>,
    countMap: Map<string, HTMLElement>,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'vs-option-row';

    const lbl = document.createElement('span');
    lbl.className = 'vs-option-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'vs-option-btn';
      btn.setAttribute('data-id', opt.id);
      const iconHtml = opt.icon ? `<span class="vs-opt-icon">${opt.icon}</span>` : '';
      btn.innerHTML = `${iconHtml}${opt.label} <span class="vs-opt-count">0</span>`;
      btn.addEventListener('click', () => onSelect(opt.id));
      row.appendChild(btn);

      buttonMap.set(opt.id, btn);
      const countEl = btn.querySelector('.vs-opt-count') as HTMLElement;
      countMap.set(opt.id, countEl);
    }

    return row;
  }

  /** Apply or remove the disabled style on mode buttons based on surface compatibility. */
  private applyModeDimming(surfaceId: string): void {
    const unavailable = getUnavailableModesForSurface(surfaceId);
    this.modeButtons.forEach((btn, id) => {
      const isUnavailable = unavailable.has(id);
      btn.classList.toggle('vs-mode-disabled', isUnavailable);
      btn.style.pointerEvents = isUnavailable ? 'none' : '';
      (btn as HTMLElement).title = isUnavailable ? 'Not available on this map' : '';
    });
  }

  /** Apply or remove the disabled style on size buttons based on mode compatibility. */
  private applySizeDimming(modeId: string): void {
    const unavailable = getUnavailableSizesForMode(modeId);
    this.sizeButtons.forEach((btn, id) => {
      const isUnavailable = unavailable.has(id);
      btn.classList.toggle('vs-mode-disabled', isUnavailable);
      btn.style.pointerEvents = isUnavailable ? 'none' : '';
      (btn as HTMLElement).title = isUnavailable ? 'Not available in this mode' : '';
    });
  }

  private currentChoice(): string {
    const base = `${this.selectedSurface}:${this.selectedMode}:${this.selectedSize}`;
    // Only append win condition for pvp/pvpve modes
    if ((this.selectedMode === 'pvp' || this.selectedMode === 'pvpve') && this.selectedWinCondition !== 'none') {
      const limitVal = this.selectedWinCondition === 'time'
        ? (this.timeLimitMinutes * 60 + this.timeLimitSeconds)
        : this.killGoal;
      return `${base}:${this.selectedWinCondition}:${limitVal}`;
    }
    return base;
  }

  private updateWinCondPanelVisibility(): void {
    if (!this.winCondPanel) return;
    const isPvp = this.selectedMode === 'pvp' || this.selectedMode === 'pvpve';
    this.winCondPanel.style.display = isPvp ? 'flex' : 'none';
  }

  private buildWinCondPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'vs-wincond-panel';

    const title = document.createElement('div');
    title.className = 'vs-wincond-title';
    title.textContent = 'WIN CONDITION';
    panel.appendChild(title);

    // Win condition type selector row
    const typeRow = document.createElement('div');
    typeRow.className = 'vs-wincond-type-row';

    const condTypes: Array<{ id: 'none' | 'time' | 'kills'; label: string }> = [
      { id: 'none', label: 'NONE' },
      { id: 'time', label: 'TIME LIMIT' },
      { id: 'kills', label: 'KILL GOAL' },
    ];

    const condBtns = new Map<string, HTMLElement>();
    for (const cond of condTypes) {
      const btn = document.createElement('button');
      btn.className = 'vs-option-btn' + (cond.id === this.selectedWinCondition ? ' vs-selected' : '');
      btn.textContent = cond.label;
      btn.setAttribute('data-cond', cond.id);
      btn.addEventListener('click', () => {
        this.selectedWinCondition = cond.id;
        condBtns.forEach((b, bid) => b.classList.toggle('vs-selected', bid === cond.id));
        timeInputRow.style.display = cond.id === 'time' ? 'flex' : 'none';
        killInputRow.style.display = cond.id === 'kills' ? 'flex' : 'none';
        this.sendVote();
      });
      typeRow.appendChild(btn);
      condBtns.set(cond.id, btn);
    }
    panel.appendChild(typeRow);

    // Time limit inputs (minutes + seconds)
    const timeInputRow = document.createElement('div');
    timeInputRow.className = 'vs-wincond-input-row';
    timeInputRow.style.display = this.selectedWinCondition === 'time' ? 'flex' : 'none';

    const timeLabel = document.createElement('span');
    timeLabel.className = 'vs-wincond-input-label';
    timeLabel.textContent = 'Duration:';
    timeInputRow.appendChild(timeLabel);

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.className = 'vs-wincond-num-input';
    minInput.min = '0'; minInput.max = '59'; minInput.step = '1';
    minInput.value = String(this.timeLimitMinutes);
    minInput.title = 'Minutes';
    const minLabel = document.createElement('span');
    minLabel.className = 'vs-wincond-unit';
    minLabel.textContent = 'min';

    const secInput = document.createElement('input');
    secInput.type = 'number';
    secInput.className = 'vs-wincond-num-input';
    secInput.min = '0'; secInput.max = '59'; secInput.step = '1';
    secInput.value = String(this.timeLimitSeconds);
    secInput.title = 'Seconds';
    const secLabel = document.createElement('span');
    secLabel.className = 'vs-wincond-unit';
    secLabel.textContent = 'sec';

    const onTimeChange = () => {
      this.timeLimitMinutes = Math.max(0, Math.min(59, parseInt(minInput.value, 10) || 0));
      this.timeLimitSeconds = Math.max(0, Math.min(59, parseInt(secInput.value, 10) || 0));
      minInput.value = String(this.timeLimitMinutes);
      secInput.value = String(this.timeLimitSeconds);
      this.sendVote();
    };
    minInput.addEventListener('change', onTimeChange);
    secInput.addEventListener('change', onTimeChange);

    timeInputRow.appendChild(minInput);
    timeInputRow.appendChild(minLabel);
    timeInputRow.appendChild(secInput);
    timeInputRow.appendChild(secLabel);
    panel.appendChild(timeInputRow);

    // Kill goal input
    const killInputRow = document.createElement('div');
    killInputRow.className = 'vs-wincond-input-row';
    killInputRow.style.display = this.selectedWinCondition === 'kills' ? 'flex' : 'none';

    const killLabel = document.createElement('span');
    killLabel.className = 'vs-wincond-input-label';
    killLabel.textContent = 'Kill goal:';
    killInputRow.appendChild(killLabel);

    const killInput = document.createElement('input');
    killInput.type = 'number';
    killInput.className = 'vs-wincond-num-input';
    killInput.min = '1'; killInput.max = '999'; killInput.step = '1';
    killInput.value = String(this.killGoal);
    killInput.addEventListener('change', () => {
      this.killGoal = Math.max(1, Math.min(999, parseInt(killInput.value, 10) || 10));
      killInput.value = String(this.killGoal);
      this.sendVote();
    });
    const killsLabel = document.createElement('span');
    killsLabel.className = 'vs-wincond-unit';
    killsLabel.textContent = 'kills';

    killInputRow.appendChild(killInput);
    killInputRow.appendChild(killsLabel);
    panel.appendChild(killInputRow);

    return panel;
  }

  private sendVote(): void {
    if (this.localIsReady) return; // vote locked after ready-up
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
        color: #bbddff;
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
        color: #aadddd;
        font-size: 13px;
        letter-spacing: 2px;
        min-width: 60px;
        text-align: right;
      }

      #voting-screen .vs-option-btn {
        background: rgba(0, 20, 40, 0.7);
        border: 2px solid #004466;
        color: #bbddff;
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

      #voting-screen .vs-opt-icon {
        margin-right: 4px;
        font-size: 15px;
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
      #voting-screen .vs-option-btn.vs-mode-disabled {
        opacity: 0.35;
        cursor: not-allowed;
        border-color: #222244;
        color: #445566;
      }
      #voting-screen .vs-option-btn.vs-mode-disabled:hover {
        border-color: #222244;
        box-shadow: none;
        color: #445566;
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

      /* ---- Countdown paused indicator ---- */
      #voting-screen .vs-countdown-paused {
        font-size: 36px;
        font-weight: bold;
        color: #ff8800;
        text-shadow: 0 0 20px #ff8800, 0 0 40px #ff4400;
        letter-spacing: 6px;
        line-height: 1;
        animation: vs-pulse 1s ease-in-out infinite alternate;
      }

      /* ---- Ready Up button ---- */
      #voting-screen .vs-ready-btn {
        background: rgba(0, 20, 40, 0.7);
        border: 2px solid #0066aa;
        color: #bbddff;
        padding: 14px 40px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 3px;
        transition: all 0.2s;
        font-family: inherit;
        border-radius: 4px;
        margin: 8px 0;
      }
      #voting-screen .vs-ready-btn:hover {
        border-color: #00aaff;
        color: #00ffff;
        box-shadow: 0 0 16px rgba(0, 170, 255, 0.5);
      }
      #voting-screen .vs-ready-btn.vs-ready-btn--active {
        background: rgba(0, 60, 20, 0.7);
        border-color: #00ff88;
        color: #00ff88;
        box-shadow: 0 0 20px rgba(0, 255, 136, 0.6);
        cursor: default;
      }

      /* ---- Ready status display ---- */
      #voting-screen .vs-ready-status {
        font-size: 13px;
        color: #aadddd;
        letter-spacing: 2px;
        margin: 4px 0 8px;
        min-height: 20px;
        text-align: center;
      }

      /* ---- Weapon Mastery button ---- */
      #voting-screen .vs-mastery-btn {
        background: rgba(20, 0, 40, 0.7);
        border: 2px solid #440066;
        color: #aa66ff;
        padding: 10px 28px;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 3px;
        transition: all 0.2s;
        font-family: inherit;
        border-radius: 4px;
        margin: 4px 0;
      }
      #voting-screen .vs-mastery-btn:hover {
        border-color: #aa44ff;
        color: #cc88ff;
        box-shadow: 0 0 16px rgba(170, 68, 255, 0.5);
      }

      /* ---- Game Settings button (in host controls) ---- */
      #voting-screen .vs-settings-btn {
        background: rgba(0, 20, 60, 0.7);
        border: 2px solid #0066cc;
        color: #44aaff;
        padding: 10px 20px;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 2px;
        transition: all 0.2s;
        font-family: inherit;
        border-radius: 4px;
      }
      #voting-screen .vs-settings-btn:hover {
        border-color: #00aaff;
        color: #00ccff;
        box-shadow: 0 0 16px rgba(0, 170, 255, 0.5);
      }

      /* ---- Pause countdown button (in host controls) ---- */
      #voting-screen .vs-pause-countdown-btn {
        background: rgba(40, 20, 0, 0.7);
        border: 2px solid #885500;
        color: #ffaa44;
        padding: 10px 20px;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 2px;
        transition: all 0.2s;
        font-family: inherit;
        border-radius: 4px;
      }
      #voting-screen .vs-pause-countdown-btn:hover {
        border-color: #ffaa00;
        color: #ffcc44;
        box-shadow: 0 0 16px rgba(255, 170, 0, 0.5);
      }

      /* ---- Win Condition panel ---- */
      #voting-screen .vs-wincond-panel {
        flex-direction: column;
        align-items: center;
        gap: 10px;
        background: rgba(0, 20, 40, 0.7);
        border: 1px solid #00aaff44;
        border-radius: 6px;
        padding: 12px 20px;
        margin: 4px 0 8px;
        width: 100%;
        box-sizing: border-box;
      }
      #voting-screen .vs-wincond-title {
        color: #88ccff;
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 3px;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      #voting-screen .vs-wincond-type-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      #voting-screen .vs-wincond-input-row {
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
        margin-top: 4px;
      }
      #voting-screen .vs-wincond-input-label {
        color: #aaa;
        font-size: 13px;
        letter-spacing: 1px;
      }
      #voting-screen .vs-wincond-num-input {
        background: rgba(0, 30, 60, 0.9);
        border: 1px solid #0066aa;
        color: #00ccff;
        font-family: inherit;
        font-size: 15px;
        font-weight: bold;
        width: 60px;
        padding: 6px 8px;
        text-align: center;
        border-radius: 4px;
        outline: none;
      }
      #voting-screen .vs-wincond-num-input:focus {
        border-color: #00aaff;
        box-shadow: 0 0 8px rgba(0, 170, 255, 0.4);
      }
      #voting-screen .vs-wincond-unit {
        color: #aaa;
        font-size: 12px;
        letter-spacing: 1px;
      }
    `;
    document.head.appendChild(style);
  }
}
