/**
 * Game Over screen.
 * Phase 1: Name + optional note entry.
 * Phase 2: Shows final score, leaderboard with names, continue button.
 */

import { t } from '../i18n';

interface HighScoreEntry {
  score: number;
  surface: string;
  date: string;
  name?: string;
  note?: string;
}

/** Per-player data for the PvP end-of-match statistics screen. */
export interface PvpPlayerStat {
  id: string;
  name: string;
  /** Player colour as an RGB hex number (e.g. 0x00ffff). */
  color: number;
  kills: number;
  deaths: number;
  totalDamageDealt: number;
}

/** Options for showPvP(). */
export interface PvpStatsOptions {
  /** Whether the local player is the host (can advance to lobby immediately). */
  isHost?: boolean;
  /**
   * MVP selection criterion.
   * 'kills' = most kills wins MVP; 'kd' = highest K/D ratio wins MVP.
   * Defaults to 'kills'.
   */
  mvpCriteria?: 'kills' | 'kd';
}

/** Per-player data for the PvPvE end-of-match statistics screen. */
export interface PvpvePlayerStat {
  id: string;
  name: string;
  /** Player colour as an RGB hex number (e.g. 0x00ffff). */
  color: number;
  /** PvP kills: times this player killed another player. */
  kills: number;
  /** Enemy kills: times this player killed an enemy. */
  enemyKills: number;
  deaths: number;
  totalDamageDealt: number;
  /** Game score (points from killing enemies with multiplier). */
  score?: number;
}

/** Options for showPvPvE(). */
export interface PvpveStatsOptions {
  /** Whether the local player is the host (can advance to lobby immediately). */
  isHost?: boolean;
  /**
   * MVP selection criterion.
   * 'total_kills' = most combined kills wins MVP; 'kd' = highest K/D wins MVP.
   * Defaults to 'total_kills'.
   */
  mvpCriteria?: 'total_kills' | 'kd';
  /**
   * Score weight for enemy kills (default 1).
   * Final Score = enemyKills * enemyKillWeight + kills * playerKillWeight.
   */
  enemyKillWeight?: number;
  /**
   * Score weight for player kills (default 1).
   */
  playerKillWeight?: number;
}

const STORAGE_KEY = 'geometry_wars_high_scores';
const LAST_NAME_KEY = 'geometry_wars_last_name';
const MAX_HIGH_SCORES = 10;

export class GameOverScreen {
  private container: HTMLDivElement;
  private onContinueCallback: (() => void) | null = null;
  private onReturnToMenuCallback: (() => void) | null = null;
  private autoTransitionTimeout: ReturnType<typeof setTimeout> | null = null;
  private finalScore: number = 0;
  private surfaceType: string = 'sphere';

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'game-over-screen';
    this.applyStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #game-over-screen {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 20, 0.9);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 3000;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(8px);
      }

      #game-over-screen.hidden {
        display: none;
      }

      #game-over-screen .content {
        text-align: center;
        padding: 40px;
        max-width: 600px;
        width: 100%;
      }

      #game-over-screen .title {
        font-size: 64px;
        font-weight: bold;
        color: #ff4444;
        text-shadow:
          0 0 10px #ff4444,
          0 0 20px #ff0000,
          0 0 40px #aa0000;
        margin: 0 0 30px;
        letter-spacing: 8px;
      }

      #game-over-screen .final-score {
        font-size: 48px;
        color: #00ffff;
        text-shadow: 0 0 15px #00ffff;
        margin: 20px 0;
      }

      #game-over-screen .final-score span {
        font-size: 72px;
        font-weight: bold;
      }

      #game-over-screen .new-high-score {
        font-size: 28px;
        color: #ffff00;
        text-shadow: 0 0 10px #ffff00;
        margin: 10px 0 30px;
        animation: pulse 0.5s ease-in-out infinite alternate;
      }

      @keyframes pulse {
        from { opacity: 0.7; transform: scale(1); }
        to { opacity: 1; transform: scale(1.05); }
      }

      /* ── Name entry phase ─────────────────────────────────────────────── */

      #game-over-screen .name-entry {
        margin: 24px 0;
        padding: 24px;
        background: rgba(0, 50, 80, 0.4);
        border: 1px solid #006688;
        border-radius: 8px;
        text-align: left;
      }

      #game-over-screen .name-entry h2 {
        font-size: 16px;
        color: #88ffff;
        margin: 0 0 16px;
        letter-spacing: 4px;
        text-align: center;
      }

      #game-over-screen .name-entry label {
        display: block;
        font-size: 12px;
        color: #88aaaa;
        letter-spacing: 2px;
        margin-bottom: 6px;
        margin-top: 12px;
      }

      #game-over-screen .name-entry label:first-of-type {
        margin-top: 0;
      }

      #game-over-screen .name-input,
      #game-over-screen .note-input {
        width: 100%;
        box-sizing: border-box;
        background: rgba(0, 20, 40, 0.8);
        border: 1px solid #006688;
        border-radius: 4px;
        color: #ffffff;
        font-size: 18px;
        font-family: 'Segoe UI', Arial, sans-serif;
        padding: 10px 14px;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
      }

      #game-over-screen .name-input:focus,
      #game-over-screen .note-input:focus {
        border-color: #00ccff;
        box-shadow: 0 0 8px rgba(0, 204, 255, 0.4);
      }

      #game-over-screen .note-input {
        font-size: 14px;
        color: #aabbcc;
      }

      #game-over-screen .name-entry-hint {
        font-size: 11px;
        color: #446677;
        margin-top: 8px;
        letter-spacing: 1px;
        text-align: center;
      }

      #game-over-screen .submit-score-btn {
        background: linear-gradient(180deg, #0066aa 0%, #004477 100%);
        border: 2px solid #00aaff;
        color: #ffffff;
        padding: 16px 48px;
        font-size: 20px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 4px;
        margin-top: 20px;
        width: 100%;
        display: block;
      }

      #game-over-screen .submit-score-btn:hover {
        background: linear-gradient(180deg, #0088cc 0%, #005599 100%);
        transform: scale(1.03);
        box-shadow: 0 0 24px #00aaff;
      }

      /* ── Results / leaderboard phase ─────────────────────────────────── */

      #game-over-screen .high-scores {
        margin: 30px 0;
        padding: 20px;
        background: rgba(0, 50, 80, 0.3);
        border: 1px solid #006688;
        border-radius: 8px;
      }

      #game-over-screen .high-scores h2 {
        font-size: 20px;
        color: #88ffff;
        margin: 0 0 15px;
        letter-spacing: 4px;
      }

      #game-over-screen .score-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      #game-over-screen .score-list li {
        display: flex;
        align-items: flex-start;
        padding: 8px 0;
        border-bottom: 1px solid rgba(0, 100, 136, 0.3);
        color: #aaffff;
        font-size: 15px;
        gap: 6px;
      }

      #game-over-screen .score-list li:last-child {
        border-bottom: none;
      }

      #game-over-screen .score-list li.current {
        color: #ffff00;
        font-weight: bold;
      }

      #game-over-screen .score-list .rank {
        width: 28px;
        flex-shrink: 0;
        text-align: left;
        color: #668888;
        padding-top: 2px;
      }

      #game-over-screen .score-list li.current .rank {
        color: #aaaa44;
      }

      #game-over-screen .score-list .player-info {
        flex: 1;
        min-width: 0;
        text-align: left;
      }

      #game-over-screen .score-list .player-name {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #game-over-screen .score-list .player-note {
        display: block;
        font-size: 11px;
        color: #557788;
        font-style: italic;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }

      #game-over-screen .score-list li.current .player-note {
        color: #888833;
      }

      #game-over-screen .score-list .score-value {
        flex-shrink: 0;
        text-align: right;
        min-width: 90px;
      }

      #game-over-screen .score-list .surface-name {
        flex-shrink: 0;
        width: 80px;
        text-align: right;
        color: #88aaaa;
        font-size: 12px;
        padding-top: 2px;
      }

      #game-over-screen .score-list li.current .surface-name {
        color: #aaaa66;
      }

      #game-over-screen .continue-btn {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border: 2px solid #00ff00;
        color: #ffffff;
        padding: 20px 60px;
        font-size: 24px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 4px;
        margin-top: 30px;
      }

      #game-over-screen .continue-btn:hover {
        background: linear-gradient(180deg, #00cc00 0%, #008800 100%);
        transform: scale(1.05);
        box-shadow: 0 0 30px #00ff00;
      }

      #game-over-screen .hint {
        margin-top: 20px;
        color: #666688;
        font-size: 12px;
        letter-spacing: 2px;
      }

      #game-over-screen .return-to-menu-btn {
        background: linear-gradient(180deg, #880000 0%, #550000 100%);
        border: 2px solid #ff4444;
        color: #ffffff;
        padding: 14px 40px;
        font-size: 18px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 3px;
        margin-top: 12px;
        display: block;
        width: 100%;
      }

      #game-over-screen .return-to-menu-btn:hover {
        background: linear-gradient(180deg, #aa0000 0%, #770000 100%);
        transform: scale(1.03);
        box-shadow: 0 0 20px #ff4444;
      }

      #game-over-screen .auto-transition-countdown {
        margin-top: 16px;
        color: #8888aa;
        font-size: 13px;
        letter-spacing: 1px;
      }

      /* ── PvP Stats Screen ────────────────────────────────────────────── */

      #game-over-screen .pvp-stats {
        width: 100%;
        max-width: 700px;
        margin: 0 auto;
      }

      #game-over-screen .pvp-title {
        font-size: 52px;
        font-weight: bold;
        color: #ff4444;
        text-shadow:
          0 0 10px #ff4444,
          0 0 20px #ff0000,
          0 0 40px #aa0000;
        margin: 0 0 6px;
        letter-spacing: 6px;
      }

      #game-over-screen .pvp-subtitle {
        font-size: 13px;
        color: #ff8844;
        letter-spacing: 4px;
        margin: 0 0 24px;
        text-shadow: 0 0 6px #ff4422;
      }

      #game-over-screen .pvp-player-row {
        display: grid;
        grid-template-columns: 14px 1fr 56px 56px 56px 80px;
        align-items: center;
        gap: 0 12px;
        padding: 10px 14px;
        margin-bottom: 6px;
        background: rgba(0, 30, 60, 0.5);
        border: 1px solid rgba(0, 80, 120, 0.5);
        border-radius: 6px;
        transition: background 0.2s;
      }

      #game-over-screen .pvp-player-row.mvp {
        background: rgba(30, 20, 0, 0.7);
        border-color: #ffaa00;
        box-shadow: 0 0 12px rgba(255, 170, 0, 0.3);
      }

      #game-over-screen .pvp-color-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      #game-over-screen .pvp-player-name {
        font-size: 15px;
        font-weight: bold;
        color: #eef6ff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
      }

      #game-over-screen .pvp-player-row.mvp .pvp-player-name::before {
        content: '★ ';
        color: #ffcc00;
      }

      #game-over-screen .pvp-stat-col {
        text-align: right;
        font-size: 14px;
        color: #aaccee;
      }

      #game-over-screen .pvp-stat-col.highlight {
        color: #00ffcc;
        font-weight: bold;
      }

      #game-over-screen .pvp-stat-headers {
        display: grid;
        grid-template-columns: 14px 1fr 56px 56px 56px 80px;
        gap: 0 12px;
        padding: 0 14px 6px;
        color: #445566;
        font-size: 10px;
        letter-spacing: 2px;
        text-align: right;
      }

      #game-over-screen .pvp-stat-headers > :nth-child(2) {
        text-align: left;
      }

      #game-over-screen .pvp-bar-section {
        margin-top: 20px;
        padding: 16px;
        background: rgba(0, 20, 40, 0.4);
        border: 1px solid rgba(0, 80, 120, 0.4);
        border-radius: 6px;
      }

      #game-over-screen .pvp-bar-section h3 {
        font-size: 11px;
        color: #446688;
        letter-spacing: 3px;
        margin: 0 0 10px;
        text-align: left;
      }

      #game-over-screen .pvp-bar-row {
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        gap: 8px;
      }

      #game-over-screen .pvp-bar-label {
        width: 100px;
        font-size: 13px;
        color: #aabbcc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
        text-align: right;
      }

      #game-over-screen .pvp-bar-track {
        flex: 1;
        height: 14px;
        background: rgba(0, 20, 40, 0.8);
        border-radius: 3px;
        overflow: hidden;
      }

      #game-over-screen .pvp-bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s ease-out;
        min-width: 2px;
      }

      #game-over-screen .pvp-bar-value {
        width: 50px;
        font-size: 12px;
        color: #88aacc;
        text-align: left;
        flex-shrink: 0;
      }

      #game-over-screen .pvp-mvp-badge {
        text-align: center;
        padding: 8px 0 4px;
        font-size: 11px;
        color: #ffaa00;
        letter-spacing: 3px;
      }

      #game-over-screen .pvp-continue-btn {
        background: linear-gradient(180deg, #005588 0%, #003355 100%);
        border: 2px solid #0088cc;
        color: #ffffff;
        padding: 18px 48px;
        font-size: 20px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 4px;
        margin-top: 24px;
        width: 100%;
        display: block;
      }

      #game-over-screen .pvp-continue-btn:hover {
        background: linear-gradient(180deg, #0077bb 0%, #004477 100%);
        transform: scale(1.02);
        box-shadow: 0 0 24px #0088cc;
      }

      #game-over-screen .pvp-ready-hint {
        margin-top: 12px;
        color: #446688;
        font-size: 11px;
        letter-spacing: 2px;
      }

      /* ── PvPvE Stats Screen ──────────────────────────────────────────── */

      #game-over-screen .pvpve-stats {
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
      }

      #game-over-screen .pvpve-subtitle {
        font-size: 13px;
        color: #88ff66;
        letter-spacing: 4px;
        margin: 0 0 24px;
        text-shadow: 0 0 6px #44bb22;
      }

      /* PvPvE table uses 6 columns: color dot | name | PVP | ENEMY | K/D | SCORE */
      #game-over-screen .pvpve-player-row {
        display: grid;
        grid-template-columns: 14px 1fr 56px 76px 56px 80px;
        align-items: center;
        gap: 0 12px;
        padding: 10px 14px;
        margin-bottom: 6px;
        background: rgba(0, 30, 60, 0.5);
        border: 1px solid rgba(0, 80, 120, 0.5);
        border-radius: 6px;
        transition: background 0.2s;
      }

      #game-over-screen .pvpve-player-row.mvp {
        background: rgba(20, 30, 0, 0.7);
        border-color: #88ff44;
        box-shadow: 0 0 12px rgba(136, 255, 68, 0.3);
      }

      #game-over-screen .pvpve-player-row.mvp .pvp-player-name::before {
        content: '★ ';
        color: #88ff44;
      }

      #game-over-screen .pvpve-stat-headers {
        display: grid;
        grid-template-columns: 14px 1fr 56px 76px 56px 80px;
        gap: 0 12px;
        padding: 0 14px 6px;
        color: #445566;
        font-size: 10px;
        letter-spacing: 2px;
        text-align: right;
      }

      #game-over-screen .pvpve-stat-headers > :nth-child(2) {
        text-align: left;
      }

      #game-over-screen .pvpve-score-note {
        text-align: center;
        font-size: 10px;
        color: #336655;
        letter-spacing: 1px;
        margin: 6px 0 16px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Show the game over screen with final score.
   * Phase 1: name/note entry. Phase 2: leaderboard results.
   * @param mode 'solo' (default) = single-player; 'network' = auto-transition to voting after 4s.
   * @param scoreLabel Optional label override (e.g. "ZONE TIME" for KotH). Defaults to "SCORE".
   * @param gameModeName Optional game mode name to display in the header (e.g. "CLAUSTROPHOBIA").
   */
  show(score: number, surfaceType: string, mode: 'solo' | 'network' = 'solo', scoreLabel?: string, gameModeName?: string): void {
    this.finalScore = score;
    this.surfaceType = surfaceType;
    this.clearAutoTransition();

    this.renderNameEntry(score, surfaceType, mode, scoreLabel ?? 'SCORE', gameModeName);
    this.container.classList.remove('hidden');
  }

  // ── Phase 1: name entry ──────────────────────────────────────────────────

  private renderNameEntry(score: number, surfaceType: string, mode: 'solo' | 'network', scoreLabel: string, gameModeName?: string): void {
    const lastName = this.getLastName();
    this.container.innerHTML = this.createNameEntryHTML(score, mode, scoreLabel, lastName, gameModeName);

    const nameInput = this.container.querySelector<HTMLInputElement>('.name-input');
    const noteInput = this.container.querySelector<HTMLInputElement>('.note-input');
    const submitBtn = this.container.querySelector<HTMLButtonElement>('.submit-score-btn');

    const doSubmit = () => {
      const name = nameInput?.value.trim() || t('gameOver.namePlaceholder');
      const note = noteInput?.value.trim() || '';
      this.saveLastName(name);
      const { isNewHighScore, rank } = this.saveScore(score, surfaceType, name, note);
      const highScores = this.getHighScores();
      this.renderResults(score, isNewHighScore, rank, highScores, mode, scoreLabel);
    };

    submitBtn?.addEventListener('click', doSubmit);

    // Enter in name input focuses note; Enter in note input (or Tab sequence) submits
    nameInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        noteInput?.focus();
      }
    });
    noteInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSubmit();
      }
    });

    if (mode === 'network') {
      const AUTO_TRANSITION_MS = 4000;
      let remaining = Math.round(AUTO_TRANSITION_MS / 1000);
      const countdownEl = this.container.querySelector('.auto-transition-countdown');

      const tick = () => {
        if (countdownEl) countdownEl.textContent = t('gameOver.autoSubmitting', { count: remaining });
        remaining--;
      };
      tick();
      const tickInterval = setInterval(tick, 1000);

      this.autoTransitionTimeout = setTimeout(() => {
        clearInterval(tickInterval);
        this.autoTransitionTimeout = null;
        // Auto-submit with whatever is in the input (or default)
        const name = nameInput?.value.trim() || t('gameOver.namePlaceholder');
        const note = noteInput?.value.trim() || '';
        this.saveLastName(name);
        const { isNewHighScore, rank } = this.saveScore(score, surfaceType, name, note);
        const highScores = this.getHighScores();
        this.renderResults(score, isNewHighScore, rank, highScores, mode, scoreLabel);
        // Immediately trigger the network transition from results
        this.hide();
        this.onContinueCallback?.();
      }, AUTO_TRANSITION_MS);
    } else {
      // Focus name input so user can type immediately
      setTimeout(() => nameInput?.focus(), 100);
    }
  }

  private createNameEntryHTML(score: number, mode: 'solo' | 'network', scoreLabel: string, lastName: string, gameModeName?: string): string {
    const countdownHTML = mode === 'network'
      ? `<div class="auto-transition-countdown"></div>`
      : '';

    const modeSubtitleHTML = gameModeName
      ? `<div class="mode-subtitle" style="color:#ff4444;font:bold 13px monospace;letter-spacing:3px;margin-top:-4px;margin-bottom:8px;text-shadow:0 0 8px #ff4444;">${gameModeName}</div>`
      : '';

    return `
      <div class="content">
        <h1 class="title">${t('gameOver.title')}</h1>
        ${modeSubtitleHTML}

        <div class="final-score">
          ${scoreLabel}: <span>${score.toLocaleString()}</span>
        </div>

        <div class="name-entry">
          <h2>${t('gameOver.recordScore')}</h2>
          <label for="gw-name-input">${t('gameOver.nameLabelField')}</label>
          <input
            id="gw-name-input"
            class="name-input"
            type="text"
            maxlength="24"
            placeholder="${t('gameOver.namePlaceholder')}"
            value="${this.escapeHTML(lastName)}"
            autocomplete="off"
            spellcheck="false"
          />
          <label for="gw-note-input">${t('gameOver.noteLabelField')} <span style="color:#446677">${t('gameOver.noteOptional')}</span></label>
          <input
            id="gw-note-input"
            class="note-input"
            type="text"
            maxlength="60"
            placeholder="${t('gameOver.notePlaceholder')}"
            autocomplete="off"
            spellcheck="false"
          />
          <div class="name-entry-hint">${t('gameOver.nameHint')}</div>
        </div>

        ${countdownHTML}

        <button class="submit-score-btn">${t('gameOver.recordScoreBtn')}</button>
      </div>
    `;
  }

  // ── Phase 2: results + leaderboard ──────────────────────────────────────

  private renderResults(
    score: number,
    isNewHighScore: boolean,
    rank: number,
    highScores: HighScoreEntry[],
    mode: 'solo' | 'network',
    scoreLabel: string,
  ): void {
    this.container.innerHTML = this.createResultsHTML(score, isNewHighScore, rank, highScores, mode, scoreLabel);

    const continueBtn = this.container.querySelector('.continue-btn');
    continueBtn?.addEventListener('click', () => {
      this.clearAutoTransition();
      this.hide();
      if (mode === 'network') {
        this.onReturnToMenuCallback?.();
      } else {
        this.onContinueCallback?.();
      }
    });

    if (mode === 'network') {
      const AUTO_TRANSITION_MS = 4000;
      const countdownEl = this.container.querySelector('.auto-transition-countdown');
      let remaining = Math.round(AUTO_TRANSITION_MS / 1000);

      const tick = () => {
        if (countdownEl) countdownEl.textContent = t('gameOver.votingCountdown', { count: remaining });
        remaining--;
      };
      tick();
      const tickInterval = setInterval(tick, 1000);

      this.autoTransitionTimeout = setTimeout(() => {
        clearInterval(tickInterval);
        this.autoTransitionTimeout = null;
        this.hide();
        this.onContinueCallback?.();
      }, AUTO_TRANSITION_MS);

      const keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          document.removeEventListener('keydown', keyHandler);
          clearInterval(tickInterval);
          this.clearAutoTransition();
          this.hide();
          this.onContinueCallback?.();
        }
      };
      setTimeout(() => document.addEventListener('keydown', keyHandler), 500);
    } else {
      const keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          document.removeEventListener('keydown', keyHandler);
          this.hide();
          this.onContinueCallback?.();
        }
      };
      setTimeout(() => document.addEventListener('keydown', keyHandler), 500);
    }
  }

  private createResultsHTML(
    score: number,
    isNewHighScore: boolean,
    rank: number,
    highScores: HighScoreEntry[],
    mode: 'solo' | 'network' = 'solo',
    scoreLabel: string = 'SCORE',
  ): string {
    const newHighScoreHTML = isNewHighScore
      ? `<div class="new-high-score">${t('gameOver.newHighScore')}</div>`
      : '';

    const scoreListHTML = highScores
      .slice(0, MAX_HIGH_SCORES)
      .map((entry, i) => {
        const isCurrent = i === rank - 1;
        const displayName = entry.name || t('gameOver.namePlaceholder');
        const noteHTML = entry.note
          ? `<span class="player-note">${this.escapeHTML(entry.note)}</span>`
          : '';
        return `
          <li class="${isCurrent ? 'current' : ''}">
            <span class="rank">${i + 1}.</span>
            <span class="player-info">
              <span class="player-name">${this.escapeHTML(displayName)}</span>
              ${noteHTML}
            </span>
            <span class="score-value">${entry.score.toLocaleString()}</span>
            <span class="surface-name">${entry.surface}</span>
          </li>
        `;
      })
      .join('');

    const buttonsHTML = mode === 'network'
      ? `
        <button class="continue-btn return-to-menu-btn">${t('gameOver.returnToMenu')}</button>
        <div class="auto-transition-countdown"></div>
        <div class="hint">${t('gameOver.hintVote')}</div>
      `
      : `
        <button class="continue-btn">${t('gameOver.continueBtn')}</button>
        <div class="hint">${t('gameOver.hintContinue')}</div>
      `;

    return `
      <div class="content">
        <h1 class="title">${t('gameOver.title')}</h1>

        <div class="final-score">
          ${scoreLabel}: <span>${score.toLocaleString()}</span>
        </div>

        ${newHighScoreHTML}

        <div class="high-scores">
          <h2>${t('gameOver.highScores')}</h2>
          <ul class="score-list">
            ${scoreListHTML || `<li>${t('gameOver.noScores')}</li>`}
          </ul>
        </div>

        ${buttonsHTML}
      </div>
    `;
  }

  // ── PvP Stats Screen ─────────────────────────────────────────────────────

  /**
   * Show the PvP end-of-match statistics screen.
   * Displays per-player kills / deaths / K/D / damage with bar graphs and MVP.
   * @param players  Array of player stats from the server.
   * @param options  Optional configuration (isHost, mvpCriteria).
   */
  showPvP(players: PvpPlayerStat[], options: PvpStatsOptions = {}): void {
    this.clearAutoTransition();
    const { isHost = false, mvpCriteria = 'kills' } = options;

    this.container.innerHTML = this.createPvpStatsHTML(players, mvpCriteria, isHost);
    this.container.classList.remove('hidden');

    const continueBtn = this.container.querySelector<HTMLButtonElement>('.pvp-continue-btn');
    continueBtn?.addEventListener('click', () => {
      this.clearAutoTransition();
      this.hide();
      this.onContinueCallback?.();
    });

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        document.removeEventListener('keydown', keyHandler);
        this.clearAutoTransition();
        this.hide();
        this.onContinueCallback?.();
      }
    };
    setTimeout(() => document.addEventListener('keydown', keyHandler), 500);
  }

  private selectMvp(players: PvpPlayerStat[], criteria: 'kills' | 'kd'): string | null {
    if (players.length === 0) return null;
    if (criteria === 'kills') {
      const maxKills = Math.max(...players.map(p => p.kills));
      if (maxKills === 0) return null;
      return players.find(p => p.kills === maxKills)?.id ?? null;
    }
    // K/D: kills / max(deaths, 1)
    const kdOf = (p: PvpPlayerStat) => p.kills / Math.max(p.deaths, 1);
    const maxKd = Math.max(...players.map(kdOf));
    if (maxKd === 0) return null;
    return players.find(p => kdOf(p) === maxKd)?.id ?? null;
  }

  private colorToCSS(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  private createPvpStatsHTML(players: PvpPlayerStat[], mvpCriteria: 'kills' | 'kd', isHost: boolean): string {
    const mvpId = this.selectMvp(players, mvpCriteria);
    const maxKills = Math.max(1, ...players.map(p => p.kills));
    const maxDamage = Math.max(1, ...players.map(p => p.totalDamageDealt));

    const rowsHTML = players.map(p => {
      const isMvp = p.id === mvpId;
      const kd = p.deaths === 0 ? (p.kills > 0 ? '∞' : '—') : (p.kills / p.deaths).toFixed(2);
      const colorCSS = this.colorToCSS(p.color);
      return `
        <div class="pvp-player-row${isMvp ? ' mvp' : ''}">
          <div class="pvp-color-dot" style="background:${colorCSS};box-shadow:0 0 6px ${colorCSS}"></div>
          <div class="pvp-player-name">${this.escapeHTML(p.name)}</div>
          <div class="pvp-stat-col">${p.kills.toFixed(2)}</div>
          <div class="pvp-stat-col">${p.deaths}</div>
          <div class="pvp-stat-col${mvpCriteria === 'kd' ? ' highlight' : ''}">${kd}</div>
          <div class="pvp-stat-col${mvpCriteria !== 'kd' ? ' highlight' : ''}">${Math.round(p.totalDamageDealt)}</div>
        </div>
      `;
    }).join('');

    const killBarsHTML = players.map(p => {
      const pct = maxKills > 0 ? (p.kills / maxKills) * 100 : 0;
      const colorCSS = this.colorToCSS(p.color);
      return `
        <div class="pvp-bar-row">
          <div class="pvp-bar-label">${this.escapeHTML(p.name)}</div>
          <div class="pvp-bar-track">
            <div class="pvp-bar-fill" style="width:${pct}%;background:${colorCSS}"></div>
          </div>
          <div class="pvp-bar-value">${p.kills.toFixed(2)} kills</div>
        </div>
      `;
    }).join('');

    const damageBarsHTML = players.map(p => {
      const pct = maxDamage > 0 ? (p.totalDamageDealt / maxDamage) * 100 : 0;
      const colorCSS = this.colorToCSS(p.color);
      return `
        <div class="pvp-bar-row">
          <div class="pvp-bar-label">${this.escapeHTML(p.name)}</div>
          <div class="pvp-bar-track">
            <div class="pvp-bar-fill" style="width:${pct}%;background:${colorCSS};opacity:0.75"></div>
          </div>
          <div class="pvp-bar-value">${Math.round(p.totalDamageDealt)} dmg</div>
        </div>
      `;
    }).join('');

    const mvpBadgeHTML = mvpId
      ? `<div class="pvp-mvp-badge">★ MVP: ${this.escapeHTML(players.find(p => p.id === mvpId)?.name ?? '')} (${mvpCriteria === 'kd' ? 'K/D' : 'KILLS'})</div>`
      : '';

    const btnLabel = isHost ? 'BACK TO LOBBY' : 'CONTINUE TO LOBBY';

    return `
      <div class="content pvp-stats">
        <h1 class="pvp-title">MATCH OVER</h1>
        <div class="pvp-subtitle">PvP RESULTS</div>

        <div class="pvp-stat-headers">
          <div></div>
          <div>PLAYER</div>
          <div>KILLS</div>
          <div>DEATHS</div>
          <div>K/D</div>
          <div>DAMAGE</div>
        </div>

        ${rowsHTML}

        ${mvpBadgeHTML}

        <div class="pvp-bar-section">
          <h3>KILLS</h3>
          ${killBarsHTML}
        </div>

        <div class="pvp-bar-section" style="margin-top:10px">
          <h3>DAMAGE DEALT</h3>
          ${damageBarsHTML}
        </div>

        <button class="pvp-continue-btn">${btnLabel}</button>
        <div class="pvp-ready-hint">Press ENTER or click to continue</div>
      </div>
    `;
  }

  // ── PvPvE Stats Screen ───────────────────────────────────────────────────

  /**
   * Show the PvPvE end-of-match statistics screen.
   * Displays combined player kills + enemy kills, K/D, and Final Score.
   * @param players  Array of player stats from the server.
   * @param options  Optional configuration (isHost, mvpCriteria, weights).
   */
  showPvPvE(players: PvpvePlayerStat[], options: PvpveStatsOptions = {}): void {
    this.clearAutoTransition();
    const { isHost = false, mvpCriteria = 'total_kills', enemyKillWeight = 1, playerKillWeight = 1 } = options;

    this.container.innerHTML = this.createPvpveStatsHTML(players, mvpCriteria, isHost, enemyKillWeight, playerKillWeight);
    this.container.classList.remove('hidden');

    const continueBtn = this.container.querySelector<HTMLButtonElement>('.pvp-continue-btn');
    continueBtn?.addEventListener('click', () => {
      this.clearAutoTransition();
      this.hide();
      this.onContinueCallback?.();
    });

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        document.removeEventListener('keydown', keyHandler);
        this.clearAutoTransition();
        this.hide();
        this.onContinueCallback?.();
      }
    };
    setTimeout(() => document.addEventListener('keydown', keyHandler), 500);
  }

  private selectPvpveMvp(
    players: PvpvePlayerStat[],
    criteria: 'total_kills' | 'kd',
    enemyKillWeight: number,
    playerKillWeight: number,
  ): string | null {
    if (players.length === 0) return null;
    if (criteria === 'total_kills') {
      const scoreOf = (p: PvpvePlayerStat) => p.enemyKills * enemyKillWeight + p.kills * playerKillWeight;
      const maxScore = Math.max(...players.map(scoreOf));
      if (maxScore === 0) return null;
      return players.find(p => scoreOf(p) === maxScore)?.id ?? null;
    }
    // K/D: (enemyKills + kills) / max(deaths, 1)
    const kdOf = (p: PvpvePlayerStat) => (p.enemyKills + p.kills) / Math.max(p.deaths, 1);
    const maxKd = Math.max(...players.map(kdOf));
    if (maxKd === 0) return null;
    return players.find(p => kdOf(p) === maxKd)?.id ?? null;
  }

  private createPvpveStatsHTML(
    players: PvpvePlayerStat[],
    mvpCriteria: 'total_kills' | 'kd',
    isHost: boolean,
    enemyKillWeight: number,
    playerKillWeight: number,
  ): string {
    // Sort by total kills desc (primary), then game score desc (secondary)
    const sorted = [...players].sort((a, b) => {
      const totalA = a.kills + a.enemyKills;
      const totalB = b.kills + b.enemyKills;
      if (totalB !== totalA) return totalB - totalA;
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.name.localeCompare(b.name);
    });

    const mvpId = this.selectPvpveMvp(sorted, mvpCriteria, enemyKillWeight, playerKillWeight);
    const maxTotal = Math.max(1, ...sorted.map(p => p.enemyKills + p.kills));
    const scoreOf = (p: PvpvePlayerStat) => p.score ?? Math.round(p.enemyKills * enemyKillWeight + p.kills * playerKillWeight);
    const kdOf = (p: PvpvePlayerStat) => {
      const total = p.enemyKills + p.kills;
      return p.deaths === 0 ? (total > 0 ? '∞' : '—') : (total / p.deaths).toFixed(2);
    };

    const rowsHTML = sorted.map(p => {
      const isMvp = p.id === mvpId;
      const colorCSS = this.colorToCSS(p.color);
      const kd = kdOf(p);
      const score = scoreOf(p);
      const isScoreHighlight = mvpCriteria === 'total_kills';
      const isKdHighlight = mvpCriteria === 'kd';
      return `
        <div class="pvpve-player-row${isMvp ? ' mvp' : ''}">
          <div class="pvp-color-dot" style="background:${colorCSS};box-shadow:0 0 6px ${colorCSS}"></div>
          <div class="pvp-player-name">${this.escapeHTML(p.name)}</div>
          <div class="pvp-stat-col">${p.kills}</div>
          <div class="pvp-stat-col">${p.enemyKills}</div>
          <div class="pvp-stat-col${isKdHighlight ? ' highlight' : ''}">${kd}</div>
          <div class="pvp-stat-col${isScoreHighlight ? ' highlight' : ''}">${score}</div>
        </div>
      `;
    }).join('');

    const totalBarsHTML = sorted.map(p => {
      const total = p.enemyKills + p.kills;
      const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
      const colorCSS = this.colorToCSS(p.color);
      return `
        <div class="pvp-bar-row">
          <div class="pvp-bar-label">${this.escapeHTML(p.name)}</div>
          <div class="pvp-bar-track">
            <div class="pvp-bar-fill" style="width:${pct}%;background:${colorCSS}"></div>
          </div>
          <div class="pvp-bar-value">${total} kills</div>
        </div>
      `;
    }).join('');

    const mvpBadgeHTML = mvpId
      ? `<div class="pvp-mvp-badge">★ MVP: ${this.escapeHTML(sorted.find(p => p.id === mvpId)?.name ?? '')} (${mvpCriteria === 'kd' ? 'K/D' : 'KILLS'})</div>`
      : '';

    const btnLabel = isHost ? 'BACK TO LOBBY' : 'CONTINUE TO LOBBY';
    const weightsNote = 'Ranked by kills (primary) · points (tiebreaker)';

    return `
      <div class="content pvpve-stats">
        <h1 class="pvp-title">MATCH OVER</h1>
        <div class="pvpve-subtitle">PvPvE RESULTS</div>

        <div class="pvpve-stat-headers">
          <div></div>
          <div>PLAYER</div>
          <div>PVP</div>
          <div>ENEMY</div>
          <div>K/D</div>
          <div>POINTS</div>
        </div>

        ${rowsHTML}

        <div class="pvpve-score-note">${weightsNote}</div>

        ${mvpBadgeHTML}

        <div class="pvp-bar-section">
          <h3>TOTAL KILLS</h3>
          ${totalBarsHTML}
        </div>

        <button class="pvp-continue-btn">${btnLabel}</button>
        <div class="pvp-ready-hint">Press ENTER or click to continue</div>
      </div>
    `;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Hide the game over screen. Cancels any pending auto-transition.
   */
  hide(): void {
    this.clearAutoTransition();
    this.container.classList.add('hidden');
  }

  /**
   * Set callback for when continue is clicked (solo) or auto-transition fires (network).
   */
  onContinue(callback: () => void): void {
    this.onContinueCallback = callback;
  }

  /**
   * Set callback for when "RETURN TO MENU" is clicked in network mode.
   * Should disconnect from the server and reload the page.
   */
  onReturnToMenu(callback: () => void): void {
    this.onReturnToMenuCallback = callback;
  }

  /**
   * Remove from DOM.
   */
  dispose(): void {
    this.container.remove();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private clearAutoTransition(): void {
    if (this.autoTransitionTimeout !== null) {
      clearTimeout(this.autoTransitionTimeout);
      this.autoTransitionTimeout = null;
    }
  }

  /**
   * Save score to localStorage with name and note.
   * Returns whether it's a new high score and its rank.
   */
  private saveScore(
    score: number,
    surface: string,
    name: string,
    note: string,
  ): { isNewHighScore: boolean; rank: number } {
    const highScores = this.getHighScores();

    const newEntry: HighScoreEntry = {
      score,
      surface,
      date: new Date().toISOString().split('T')[0],
      name: name || t('gameOver.namePlaceholder'),
      ...(note ? { note } : {}),
    };

    let rank = highScores.findIndex((entry) => score > entry.score);
    if (rank === -1) rank = highScores.length;

    highScores.splice(rank, 0, newEntry);
    const trimmed = highScores.slice(0, MAX_HIGH_SCORES);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Could not save high scores:', e);
    }

    const isNewHighScore = rank === 0 && score > 0;
    return { isNewHighScore, rank: rank + 1 };
  }

  private getHighScores(): HighScoreEntry[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Could not load high scores:', e);
    }
    return [];
  }

  private getLastName(): string {
    try {
      return localStorage.getItem(LAST_NAME_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private saveLastName(name: string): void {
    try {
      localStorage.setItem(LAST_NAME_KEY, name);
    } catch {
      // ignore
    }
  }

  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
