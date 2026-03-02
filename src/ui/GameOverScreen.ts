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
