/**
 * Per-viewport HUD overlay for split-screen co-op.
 *
 * Each player gets a positioned <div> within their viewport region showing:
 * - Player label + color (e.g. "P1" in cyan)
 * - Score
 * - Lives and bombs
 * - Current weapon + ammo
 */

const PLAYER_COLORS = ['#00ffff', '#ff00ff', '#00ff00', '#ffaa00'];

export interface PlayerHUDData {
  score: number;
  multiplier: number;
  lives: number;
  bombs: number;
  weaponName: string;
  ammo: number;       // -1 = infinite (Standard)
  kills: number;
  assists: number;
}

export class SplitScreenHUD {
  private container: HTMLDivElement;
  private playerElements: HTMLDivElement[] = [];
  private readonly playerCount: number;

  constructor(playerCount: 2 | 3 | 4) {
    this.playerCount = playerCount;
    this.container = document.createElement('div');
    this.container.id = 'splitscreen-hud';
    this.applyStyles();

    for (let i = 0; i < playerCount; i++) {
      const el = document.createElement('div');
      el.className = 'viewport-hud';
      el.dataset.player = String(i);
      this.container.appendChild(el);
      this.playerElements.push(el);
    }

    document.body.appendChild(this.container);
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #splitscreen-hud {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: 100;
        font-family: 'Segoe UI', Arial, sans-serif;
      }
      #splitscreen-hud .viewport-hud {
        position: absolute;
        padding: 8px 12px;
        pointer-events: none;
      }
      #splitscreen-hud .hud-label {
        font-size: 14px;
        font-weight: bold;
        letter-spacing: 2px;
        text-shadow: 0 0 8px currentColor;
      }
      #splitscreen-hud .hud-score {
        font-size: 18px;
        color: #ffffff;
        text-shadow: 0 0 5px #ffffff;
        margin-top: 2px;
      }
      #splitscreen-hud .hud-stats {
        font-size: 11px;
        color: #aaaacc;
        margin-top: 2px;
      }
      #splitscreen-hud .hud-weapon {
        position: absolute;
        bottom: 8px;
        left: 12px;
        font-size: 11px;
        color: #88aaff;
        letter-spacing: 1px;
      }
      #splitscreen-hud .hud-lives {
        position: absolute;
        top: 8px;
        right: 12px;
        font-size: 14px;
        text-align: right;
      }
      #splitscreen-hud .hud-lives .hearts {
        color: #ff4444;
      }
      #splitscreen-hud .hud-lives .bombs-display {
        color: #ffaa00;
        font-size: 12px;
        display: block;
      }
      @media (max-width: 900px) and (pointer: coarse) {
        #splitscreen-hud .hud-label {
          font-size: 10px;
        }
        #splitscreen-hud .hud-score {
          font-size: 12px;
        }
        #splitscreen-hud .hud-stats {
          font-size: 9px;
        }
        #splitscreen-hud .hud-lives {
          font-size: 10px;
        }
        #splitscreen-hud .hud-weapon {
          font-size: 9px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /** Set the pixel-space position/size for a player's HUD overlay. */
  setViewportBounds(playerIndex: number, x: number, y: number, w: number, h: number): void {
    const el = this.playerElements[playerIndex];
    if (!el) return;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  }

  update(playerIndex: number, data: PlayerHUDData): void {
    const el = this.playerElements[playerIndex];
    if (!el) return;
    const color = PLAYER_COLORS[playerIndex];
    const hearts = data.lives <= 5
      ? '\u2665'.repeat(Math.max(0, data.lives))
      : `\u2665 x${data.lives}`;
    const bombs = data.bombs <= 5
      ? '\u25cf'.repeat(Math.max(0, data.bombs))
      : `\u25cf x${data.bombs}`;
    const weaponStr = data.ammo >= 0
      ? `${data.weaponName} [${data.ammo}]`
      : data.weaponName;

    el.innerHTML = `
      <div class="hud-label" style="color:${color}">P${playerIndex + 1}</div>
      <div class="hud-score">${data.score.toLocaleString()} <span style="color:${color};font-size:12px">x${data.multiplier}</span></div>
      <div class="hud-stats">${data.kills}K / ${data.assists}A</div>
      <div class="hud-lives">
        <span class="hearts">${hearts}</span>
        <span class="bombs-display">${bombs}</span>
      </div>
      <div class="hud-weapon">${weaponStr}</div>
    `;
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  show(): void {
    this.container.style.display = '';
  }

  dispose(): void {
    this.container.remove();
  }
}
