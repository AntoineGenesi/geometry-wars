/**
 * Level Complete screen.
 * Shows star rating, score, and next level / replay options.
 */

const PROGRESS_KEY = 'geometry_wars_level_progress';

export interface LevelProgress {
  /** Highest unlocked level index. */
  unlockedLevel: number;
  /** Star ratings per level (0-3). */
  stars: Record<number, number>;
}

export class LevelCompleteScreen {
  private container: HTMLDivElement;
  private onNextCallback: (() => void) | null = null;
  private onReplayCallback: (() => void) | null = null;
  private onMenuCallback: (() => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'level-complete-screen';
    this.applyStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #level-complete-screen {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0, 0, 20, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 3000;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(6px);
      }
      #level-complete-screen.hidden { display: none; }

      #level-complete-screen .content {
        text-align: center;
        padding: 40px;
        max-width: 500px;
      }
      #level-complete-screen .title {
        font-size: 48px;
        font-weight: bold;
        color: #00ff88;
        text-shadow: 0 0 10px #00ff88, 0 0 30px #00aa44;
        margin: 0 0 10px;
        letter-spacing: 6px;
      }
      #level-complete-screen .level-name {
        font-size: 20px;
        color: #88ffcc;
        margin: 0 0 30px;
        letter-spacing: 3px;
      }
      #level-complete-screen .stars {
        font-size: 64px;
        margin: 20px 0;
        letter-spacing: 12px;
      }
      #level-complete-screen .stars .earned {
        color: #ffdd00;
        text-shadow: 0 0 15px #ffdd00, 0 0 30px #ff8800;
      }
      #level-complete-screen .stars .empty {
        color: #333355;
      }
      #level-complete-screen .score-info {
        font-size: 28px;
        color: #00ffff;
        text-shadow: 0 0 10px #00ffff;
        margin: 15px 0;
      }
      #level-complete-screen .next-threshold {
        font-size: 14px;
        color: #888899;
        margin: 5px 0 25px;
      }
      #level-complete-screen .buttons {
        display: flex;
        gap: 15px;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 30px;
      }
      #level-complete-screen .btn {
        border: 2px solid;
        color: #fff;
        padding: 14px 40px;
        font-size: 18px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 3px;
        transition: all 0.2s;
        pointer-events: auto;
      }
      #level-complete-screen .btn:hover {
        transform: scale(1.05);
      }
      #level-complete-screen .btn-next {
        background: linear-gradient(180deg, #00aa00 0%, #006600 100%);
        border-color: #00ff00;
      }
      #level-complete-screen .btn-next:hover {
        box-shadow: 0 0 25px #00ff00;
      }
      #level-complete-screen .btn-replay {
        background: linear-gradient(180deg, #0066aa 0%, #003366 100%);
        border-color: #0088ff;
      }
      #level-complete-screen .btn-replay:hover {
        box-shadow: 0 0 25px #0088ff;
      }
      #level-complete-screen .btn-menu {
        background: linear-gradient(180deg, #664400 0%, #332200 100%);
        border-color: #ff8800;
      }
      #level-complete-screen .btn-menu:hover {
        box-shadow: 0 0 25px #ff8800;
      }
    `;
    document.head.appendChild(style);
  }

  show(
    levelIndex: number,
    levelName: string,
    score: number,
    stars: number,
    starThresholds: [number, number, number],
    hasNextLevel: boolean,
  ): void {
    // Save progress
    this.saveProgress(levelIndex, stars);

    const starHTML = Array.from({ length: 3 }, (_, i) =>
      `<span class="${i < stars ? 'earned' : 'empty'}">\u2605</span>`
    ).join('');

    const nextThreshold = stars < 3
      ? `Next star at ${starThresholds[Math.min(stars, 2)].toLocaleString()}`
      : 'Maximum stars earned!';

    const nextBtnHTML = hasNextLevel
      ? `<button class="btn btn-next" data-action="next">NEXT LEVEL</button>`
      : '';

    this.container.innerHTML = `
      <div class="content">
        <h1 class="title">COMPLETE</h1>
        <div class="level-name">${levelName}</div>
        <div class="stars">${starHTML}</div>
        <div class="score-info">${score.toLocaleString()}</div>
        <div class="next-threshold">${nextThreshold}</div>
        <div class="buttons">
          ${nextBtnHTML}
          <button class="btn btn-replay" data-action="replay">REPLAY</button>
          <button class="btn btn-menu" data-action="menu">MENU</button>
        </div>
      </div>
    `;

    this.container.classList.remove('hidden');

    // Attach button listeners
    this.container.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        this.hide();
        if (action === 'next') this.onNextCallback?.();
        else if (action === 'replay') this.onReplayCallback?.();
        else if (action === 'menu') this.onMenuCallback?.();
      });
    });
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  onNext(callback: () => void): void {
    this.onNextCallback = callback;
  }

  onReplay(callback: () => void): void {
    this.onReplayCallback = callback;
  }

  onMenu(callback: () => void): void {
    this.onMenuCallback = callback;
  }

  // -- Progress persistence --

  private saveProgress(levelIndex: number, stars: number): void {
    const progress = this.loadProgress();
    // Unlock next level
    progress.unlockedLevel = Math.max(progress.unlockedLevel, levelIndex + 1);
    // Save best star rating
    const existing = progress.stars[levelIndex] ?? 0;
    progress.stars[levelIndex] = Math.max(existing, stars);

    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (e) {
      // Storage unavailable
    }
  }

  static loadProgress(): LevelProgress {
    try {
      const data = localStorage.getItem(PROGRESS_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      // Storage unavailable
    }
    return { unlockedLevel: 0, stars: {} };
  }

  private loadProgress(): LevelProgress {
    return LevelCompleteScreen.loadProgress();
  }

  dispose(): void {
    this.container.remove();
  }
}
