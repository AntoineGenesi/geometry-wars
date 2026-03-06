/**
 * PvP Kill Feed — CS:GO style, top-right corner.
 *
 * Shows "PlayerA → PlayerB" entries that fade out after 5 seconds.
 * Max 5 visible entries. Semi-transparent dark background, white text.
 *
 * Also tracks multi-kill streaks for each player and fires onMultiKill
 * callback when a player achieves a streak (double, triple, etc.).
 */

export interface KillEvent {
  killerName: string;
  victimName: string;
  /** Whether the local player was the killer */
  isLocalKill: boolean;
  /** Whether the local player was the victim */
  isLocalDeath: boolean;
}

export interface MultiKillEvent {
  playerName: string;
  count: number; // 2 = double, 3 = triple, 4 = multi, 5+ = killing spree
  isLocal: boolean;
}

interface FeedEntry {
  el: HTMLDivElement;
  age: number;
}

interface KillStreak {
  count: number;
  timer: number;
}

const MAX_ENTRIES = 5;
const FADE_AFTER = 5.0;      // seconds before fade starts
const FADE_DURATION = 1.0;   // seconds to fully fade
const MULTI_KILL_WINDOW = 4.0; // seconds window for multi-kill tracking

const MULTI_KILL_LABELS: Record<number, string> = {
  2: 'DOUBLE KILL!',
  3: 'TRIPLE KILL!',
  4: 'MULTI KILL!',
};

function getMultiKillLabel(count: number): string {
  if (count >= 5) return 'KILLING SPREE!';
  return MULTI_KILL_LABELS[count] ?? `${count}x KILL!`;
}

export class KillFeed {
  private container: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private entries: FeedEntry[] = [];
  private streaks = new Map<string, KillStreak>();

  /** Called when a player achieves a multi-kill streak */
  onMultiKill: ((event: MultiKillEvent) => void) | null = null;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      #pvp-kill-feed {
        position: fixed;
        top: 16px;
        right: 16px;
        width: 260px;
        pointer-events: none;
        z-index: 110;
        font-family: 'Segoe UI', Arial, sans-serif;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .pvp-feed-entry {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: rgba(0, 0, 10, 0.72);
        border-radius: 3px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.3px;
        white-space: nowrap;
        overflow: hidden;
        transition: opacity 0.3s;
        border-left: 2px solid rgba(255,255,255,0.15);
      }

      .pvp-feed-entry.local-kill {
        border-left-color: #00ff88;
        background: rgba(0, 30, 10, 0.78);
      }

      .pvp-feed-entry.local-death {
        border-left-color: #ff4444;
        background: rgba(30, 0, 0, 0.78);
      }

      .pvp-feed-entry .feed-killer {
        color: #ffffff;
        font-weight: 700;
        flex-shrink: 0;
        max-width: 90px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .pvp-feed-entry.local-kill .feed-killer {
        color: #00ff88;
        text-shadow: 0 0 6px #00ff88;
      }

      .pvp-feed-entry .feed-arrow {
        color: rgba(255, 255, 255, 0.5);
        font-size: 10px;
        flex-shrink: 0;
      }

      .pvp-feed-entry .feed-victim {
        color: rgba(255, 255, 255, 0.75);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .pvp-feed-entry.local-death .feed-victim {
        color: #ff6666;
        text-shadow: 0 0 6px #ff4444;
      }

      @keyframes pvp-slide-in {
        0% {
          transform: translateX(20px);
          opacity: 0;
        }
        100% {
          transform: translateX(0);
          opacity: 1;
        }
      }

      .pvp-feed-entry.new-entry {
        animation: pvp-slide-in 0.2s ease-out;
      }

      /* Multi-kill flash banner */
      #pvp-multi-kill-banner {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 200;
        text-align: center;
        font-family: 'Segoe UI', Arial, sans-serif;
      }

      .multi-kill-text {
        font-size: 38px;
        font-weight: 900;
        letter-spacing: 3px;
        color: #ffdd00;
        text-shadow:
          0 0 10px #ffaa00,
          0 0 30px #ff8800,
          0 0 60px rgba(255, 120, 0, 0.5);
        text-transform: uppercase;
      }

      @keyframes multi-kill-pop {
        0% {
          transform: scale(0.5);
          opacity: 0;
        }
        15% {
          transform: scale(1.2);
          opacity: 1;
        }
        25% {
          transform: scale(1.0);
          opacity: 1;
        }
        70% {
          transform: scale(1.0);
          opacity: 1;
        }
        100% {
          transform: scale(0.9);
          opacity: 0;
        }
      }

      .multi-kill-text.animating {
        animation: multi-kill-pop 2.0s ease-out forwards;
      }
    `;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.id = 'pvp-kill-feed';
    document.body.appendChild(this.container);

    // Create multi-kill banner element (reused)
    const banner = document.createElement('div');
    banner.id = 'pvp-multi-kill-banner';
    banner.style.display = 'none';
    document.body.appendChild(banner);
  }

  /**
   * Add a PvP kill event to the feed.
   * Also tracks multi-kill streaks.
   */
  addKill(event: KillEvent): void {
    // Create feed entry DOM element
    const el = document.createElement('div');
    el.className = 'pvp-feed-entry new-entry';
    if (event.isLocalKill) el.classList.add('local-kill');
    if (event.isLocalDeath) el.classList.add('local-death');

    const killerSpan = document.createElement('span');
    killerSpan.className = 'feed-killer';
    killerSpan.textContent = event.killerName;

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'feed-arrow';
    arrowSpan.textContent = '→';

    const victimSpan = document.createElement('span');
    victimSpan.className = 'feed-victim';
    victimSpan.textContent = event.victimName;

    el.appendChild(killerSpan);
    el.appendChild(arrowSpan);
    el.appendChild(victimSpan);

    // Remove animation class after it plays
    el.addEventListener('animationend', () => {
      el.classList.remove('new-entry');
    }, { once: true });

    // Enforce max entries — remove oldest if over limit
    while (this.entries.length >= MAX_ENTRIES) {
      const oldest = this.entries.shift();
      if (oldest) oldest.el.remove();
    }

    this.container.appendChild(el);
    this.entries.push({ el, age: 0 });

    // Track multi-kill streak for the killer
    this.trackStreak(event.killerName, event.isLocalKill);
  }

  /**
   * Update timers and fade old entries. Call once per frame with dt in seconds.
   */
  update(dt: number): void {
    // Update entry ages + fade
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      entry.age += dt;

      if (entry.age > FADE_AFTER) {
        const fadeProgress = (entry.age - FADE_AFTER) / FADE_DURATION;
        if (fadeProgress >= 1) {
          entry.el.remove();
          this.entries.splice(i, 1);
        } else {
          entry.el.style.opacity = String(Math.max(0, 1 - fadeProgress));
        }
      }
    }

    // Decay multi-kill streak timers
    for (const [name, streak] of this.streaks) {
      streak.timer -= dt;
      if (streak.timer <= 0) {
        this.streaks.delete(name);
      }
    }
  }

  /**
   * Remove all entries and detach from DOM.
   */
  dispose(): void {
    for (const entry of this.entries) {
      entry.el.remove();
    }
    this.entries = [];
    this.container.remove();
    this.styleEl.remove();
    document.getElementById('pvp-multi-kill-banner')?.remove();
  }

  // ---------------------------------------------------------------------------
  // Multi-kill tracking
  // ---------------------------------------------------------------------------

  private trackStreak(playerName: string, isLocal: boolean): void {
    let streak = this.streaks.get(playerName);

    if (streak) {
      streak.count++;
      streak.timer = MULTI_KILL_WINDOW; // reset window
    } else {
      streak = { count: 1, timer: MULTI_KILL_WINDOW };
      this.streaks.set(playerName, streak);
    }

    // Fire multi-kill event when count reaches 2+
    if (streak.count >= 2) {
      const multiEvent: MultiKillEvent = {
        playerName,
        count: streak.count,
        isLocal,
      };
      this.onMultiKill?.(multiEvent);

      if (isLocal) {
        this.showMultiKillBanner(getMultiKillLabel(streak.count));
      }
    }
  }

  private showMultiKillBanner(label: string): void {
    const banner = document.getElementById('pvp-multi-kill-banner');
    if (!banner) return;

    // Reset and re-trigger animation
    banner.innerHTML = '';
    const textEl = document.createElement('div');
    textEl.className = 'multi-kill-text';
    textEl.textContent = label;
    banner.appendChild(textEl);
    banner.style.display = 'block';

    // Force reflow to restart animation
    void textEl.offsetWidth;
    textEl.classList.add('animating');

    textEl.addEventListener('animationend', () => {
      banner.style.display = 'none';
    }, { once: true });
  }
}
