/**
 * Game Over screen.
 * Shows final score, saves to local storage, displays high scores.
 */

interface HighScoreEntry {
  score: number;
  surface: string;
  date: string;
}

const STORAGE_KEY = 'geometry_wars_high_scores';
const MAX_HIGH_SCORES = 10;

export class GameOverScreen {
  private container: HTMLDivElement;
  private onContinueCallback: (() => void) | null = null;
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
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid rgba(0, 100, 136, 0.3);
        color: #aaffff;
        font-size: 16px;
      }

      #game-over-screen .score-list li:last-child {
        border-bottom: none;
      }

      #game-over-screen .score-list li.current {
        color: #ffff00;
        font-weight: bold;
      }

      #game-over-screen .score-list .rank {
        width: 30px;
        text-align: left;
        color: #668888;
      }

      #game-over-screen .score-list .score-value {
        flex: 1;
        text-align: right;
      }

      #game-over-screen .score-list .surface-name {
        width: 100px;
        text-align: center;
        color: #88aaaa;
        font-size: 12px;
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
    `;
    document.head.appendChild(style);
  }

  /**
   * Show the game over screen with final score.
   */
  show(score: number, surfaceType: string): void {
    this.finalScore = score;
    this.surfaceType = surfaceType;

    // Save score and get ranking
    const { isNewHighScore, rank } = this.saveScore(score, surfaceType);
    const highScores = this.getHighScores();

    this.container.innerHTML = this.createContentHTML(score, isNewHighScore, rank, highScores);
    this.container.classList.remove('hidden');

    // Attach button listener
    const continueBtn = this.container.querySelector('.continue-btn');
    continueBtn?.addEventListener('click', () => {
      this.hide();
      this.onContinueCallback?.();
    });

    // Also allow Enter/Space to continue
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        document.removeEventListener('keydown', keyHandler);
        this.hide();
        this.onContinueCallback?.();
      }
    };
    setTimeout(() => {
      document.addEventListener('keydown', keyHandler);
    }, 500); // Small delay to prevent accidental skip
  }

  private createContentHTML(
    score: number,
    isNewHighScore: boolean,
    rank: number,
    highScores: HighScoreEntry[]
  ): string {
    const newHighScoreHTML = isNewHighScore
      ? `<div class="new-high-score">NEW HIGH SCORE!</div>`
      : '';

    const scoreListHTML = highScores
      .slice(0, MAX_HIGH_SCORES)
      .map((entry, i) => {
        const isCurrent = i === rank - 1;
        return `
          <li class="${isCurrent ? 'current' : ''}">
            <span class="rank">${i + 1}.</span>
            <span class="score-value">${entry.score.toLocaleString()}</span>
            <span class="surface-name">${entry.surface}</span>
          </li>
        `;
      })
      .join('');

    return `
      <div class="content">
        <h1 class="title">GAME OVER</h1>

        <div class="final-score">
          SCORE: <span>${score.toLocaleString()}</span>
        </div>

        ${newHighScoreHTML}

        <div class="high-scores">
          <h2>HIGH SCORES</h2>
          <ul class="score-list">
            ${scoreListHTML || '<li>No scores yet</li>'}
          </ul>
        </div>

        <button class="continue-btn">CONTINUE</button>

        <div class="hint">Press ENTER or click to continue</div>
      </div>
    `;
  }

  /**
   * Hide the game over screen.
   */
  hide(): void {
    this.container.classList.add('hidden');
  }

  /**
   * Set callback for when continue is clicked.
   */
  onContinue(callback: () => void): void {
    this.onContinueCallback = callback;
  }

  /**
   * Save score to local storage.
   * Returns whether it's a new high score and its rank.
   */
  private saveScore(score: number, surface: string): { isNewHighScore: boolean; rank: number } {
    const highScores = this.getHighScores();

    const newEntry: HighScoreEntry = {
      score,
      surface,
      date: new Date().toISOString().split('T')[0],
    };

    // Find where this score ranks
    let rank = highScores.findIndex((entry) => score > entry.score);
    if (rank === -1) {
      rank = highScores.length;
    }

    // Insert at correct position
    highScores.splice(rank, 0, newEntry);

    // Keep only top scores
    const trimmed = highScores.slice(0, MAX_HIGH_SCORES);

    // Save to local storage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Could not save high scores:', e);
    }

    const isNewHighScore = rank === 0 && score > 0;
    return { isNewHighScore, rank: rank + 1 };
  }

  /**
   * Get high scores from local storage.
   */
  private getHighScores(): HighScoreEntry[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Could not load high scores:', e);
    }
    return [];
  }

  /**
   * Remove from DOM.
   */
  dispose(): void {
    this.container.remove();
  }
}
