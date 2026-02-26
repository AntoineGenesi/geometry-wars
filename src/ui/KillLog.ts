/**
 * Kill log / event feed UI with kill-streak tracking.
 *
 * Displays a scrolling list of enemy kills in the bottom-left corner.
 * Each enemy type gets a single entry with a running streak counter that
 * increments on subsequent kills within the timeout window. When the same
 * enemy type is killed again, the timer resets (keeping the streak alive).
 *
 * Streaks are visually emphasised:
 * - x2+ shows a larger, glowing count
 * - x3+ adds a "STREAK" label with neon pulse
 * - x5+ upgrades to "RAMPAGE" with intensified glow
 * - x10+ shows "UNSTOPPABLE" with maximum glow
 *
 * An optional onKill callback fires on every kill so external systems
 * (e.g. TotalKillCounter) can observe without coupling.
 *
 * Shape icons are tiny inline SVGs coloured to match the enemy type.
 */

import { shapeIconSVG, colorToHex, DISPLAY_NAMES } from './KillIcons';
import { t } from '../i18n';

// ---------------------------------------------------------------------------
// KillLog entry data
// ---------------------------------------------------------------------------

interface KillEntry {
  type: string;
  color: number;
  count: number;
  /** Seconds since this entry was last updated (kill added). */
  age: number;
  /** The DOM element for this entry. */
  el: HTMLDivElement;
  /** The span holding the count number. */
  countEl: HTMLSpanElement;
  /** The span holding the streak label (hidden when count < STREAK_THRESHOLD). */
  streakEl: HTMLSpanElement;
}

// ---------------------------------------------------------------------------
// KillLog
// ---------------------------------------------------------------------------

const MAX_VISIBLE_ENTRIES = 10;
const FADE_AFTER_SECONDS = 10;
const FADE_DURATION_SECONDS = 2;
const STREAK_THRESHOLD = 3;
const RAMPAGE_THRESHOLD = 5;
const UNSTOPPABLE_THRESHOLD = 10;

export class KillLog {
  private container: HTMLDivElement;
  private entries: KillEntry[] = [];
  private styleEl: HTMLStyleElement;

  /** Optional callback fired on every kill (type, color). */
  onKill: ((enemyType: string, color: number) => void) | null = null;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      #kill-log {
        position: fixed;
        bottom: 16px;
        left: 16px;
        width: 220px;
        max-height: 320px;
        overflow-y: hidden;
        pointer-events: none;
        z-index: 100;
        font-family: 'Segoe UI', Arial, sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 2px;
      }

      .kill-entry {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        background: rgba(0, 0, 20, 0.55);
        border-left: 2px solid currentColor;
        border-radius: 2px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.5px;
        white-space: nowrap;
        transition: opacity 0.3s;
      }

      .kill-entry .kill-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }

      .kill-entry .kill-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .kill-entry .kill-count {
        font-variant-numeric: tabular-nums;
        opacity: 0.9;
        transition: font-size 0.15s ease-out;
      }

      .kill-entry .kill-count.streak-active {
        font-size: 13px;
        font-weight: 800;
        opacity: 1;
      }

      .kill-entry .kill-streak-label {
        font-size: 8px;
        font-weight: 800;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        padding: 0 3px;
        border-radius: 2px;
        display: none;
      }

      .kill-entry .kill-streak-label.visible {
        display: inline;
      }

      @keyframes kill-pop-in {
        0% {
          transform: translateX(-12px);
          opacity: 0;
        }
        100% {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes streak-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.15); }
        100% { transform: scale(1); }
      }

      .kill-entry.new-entry {
        animation: kill-pop-in 0.2s ease-out;
      }

      .kill-entry.count-bump .kill-count {
        animation: streak-pulse 0.2s ease-out;
      }

      .kill-entry.count-bump .kill-streak-label {
        animation: streak-pulse 0.2s ease-out;
      }
    `;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.id = 'kill-log';
    document.body.appendChild(this.container);
  }

  /**
   * Record a kill of the given enemy type.
   * If an entry for this type already exists and hasn't faded out, the streak
   * counter is incremented and its timer is reset. Otherwise a new streak
   * begins at x1.
   *
   * @param enemyType  Lowercase enemy type key (e.g. "grunt", "wanderer").
   * @param color      0xRRGGBB colour number for the enemy.
   */
  addKill(enemyType: string, color: number): void {
    this.onKill?.(enemyType, color);

    const existing = this.entries.find(e => e.type === enemyType);

    if (existing) {
      existing.count++;
      existing.age = 0;
      existing.countEl.textContent = `x${existing.count}`;
      existing.el.style.opacity = '1';

      // Update streak visual state
      this.updateStreakVisuals(existing);

      // Brief visual bump
      existing.el.classList.remove('count-bump');
      // Force reflow so re-adding the class restarts the animation
      void existing.el.offsetWidth;
      existing.el.classList.add('count-bump');

      // Move to bottom (most recent)
      this.container.appendChild(existing.el);
      this.reorderArray(existing);
    } else {
      // Create new entry (streak starts at x1)
      const entry = this.createEntry(enemyType, color);
      this.entries.push(entry);
      this.container.appendChild(entry.el);

      // Enforce max visible: remove oldest if over limit
      this.pruneOldest();
    }

    // Auto-scroll to bottom
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Advance timers and fade old entries.
   * Call once per frame with the delta time in seconds.
   */
  update(dt: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      entry.age += dt;

      if (entry.age > FADE_AFTER_SECONDS) {
        const fadeProgress = (entry.age - FADE_AFTER_SECONDS) / FADE_DURATION_SECONDS;
        if (fadeProgress >= 1) {
          // Fully faded -- remove (streak ends)
          entry.el.remove();
          this.entries.splice(i, 1);
        } else {
          entry.el.style.opacity = String(Math.max(0, 1 - fadeProgress));
        }
      }
    }
  }

  /**
   * Get the current streak count for a given enemy type.
   * Returns 0 if no active entry exists.
   */
  getStreakCount(enemyType: string): number {
    const entry = this.entries.find(e => e.type === enemyType);
    return entry ? entry.count : 0;
  }

  /**
   * Get all current active entries (for testing/inspection).
   */
  getEntries(): ReadonlyArray<{ type: string; count: number; age: number }> {
    return this.entries.map(e => ({ type: e.type, count: e.count, age: e.age }));
  }

  /**
   * Remove all entries and detach from the DOM.
   */
  dispose(): void {
    for (const entry of this.entries) {
      entry.el.remove();
    }
    this.entries = [];
    this.container.remove();
    this.styleEl.remove();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private createEntry(type: string, color: number): KillEntry {
    const hexColor = colorToHex(color);
    const displayName = DISPLAY_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1);

    const el = document.createElement('div');
    el.className = 'kill-entry new-entry';
    el.style.color = hexColor;
    el.style.textShadow = `0 0 6px ${hexColor}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'kill-icon';
    iconSpan.innerHTML = shapeIconSVG(type, hexColor);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'kill-name';
    nameSpan.textContent = displayName;

    const streakSpan = document.createElement('span');
    streakSpan.className = 'kill-streak-label';
    streakSpan.textContent = '';

    const countSpan = document.createElement('span');
    countSpan.className = 'kill-count';
    countSpan.textContent = 'x1';

    el.appendChild(iconSpan);
    el.appendChild(nameSpan);
    el.appendChild(streakSpan);
    el.appendChild(countSpan);

    // Remove the intro animation class after it plays
    el.addEventListener('animationend', () => {
      el.classList.remove('new-entry');
    }, { once: true });

    return { type, color, count: 1, age: 0, el, countEl: countSpan, streakEl: streakSpan };
  }

  /** Update the streak label and count styling based on current count. */
  private updateStreakVisuals(entry: KillEntry): void {
    const hexColor = colorToHex(entry.color);

    if (entry.count >= UNSTOPPABLE_THRESHOLD) {
      entry.streakEl.textContent = t('hud.killLog.unstoppable');
      entry.streakEl.classList.add('visible');
      entry.streakEl.style.color = '#ffffff';
      entry.streakEl.style.textShadow = `0 0 8px ${hexColor}, 0 0 16px ${hexColor}`;
      entry.countEl.classList.add('streak-active');
      entry.countEl.style.textShadow = `0 0 10px ${hexColor}, 0 0 20px ${hexColor}`;
      entry.el.style.borderLeftWidth = '3px';
      entry.el.style.background = `rgba(${this.hexToRgb(hexColor)}, 0.15)`;
    } else if (entry.count >= RAMPAGE_THRESHOLD) {
      entry.streakEl.textContent = t('hud.killLog.rampage');
      entry.streakEl.classList.add('visible');
      entry.streakEl.style.color = hexColor;
      entry.streakEl.style.textShadow = `0 0 6px ${hexColor}`;
      entry.countEl.classList.add('streak-active');
      entry.countEl.style.textShadow = `0 0 8px ${hexColor}`;
      entry.el.style.borderLeftWidth = '3px';
      entry.el.style.background = 'rgba(0, 0, 20, 0.65)';
    } else if (entry.count >= STREAK_THRESHOLD) {
      entry.streakEl.textContent = t('hud.killLog.streak');
      entry.streakEl.classList.add('visible');
      entry.streakEl.style.color = hexColor;
      entry.streakEl.style.textShadow = `0 0 4px ${hexColor}`;
      entry.countEl.classList.add('streak-active');
      entry.countEl.style.textShadow = '';
      entry.el.style.borderLeftWidth = '2px';
      entry.el.style.background = 'rgba(0, 0, 20, 0.55)';
    } else if (entry.count >= 2) {
      // x2: slightly emphasised count, no streak label yet
      entry.streakEl.classList.remove('visible');
      entry.countEl.classList.add('streak-active');
      entry.countEl.style.textShadow = '';
      entry.el.style.borderLeftWidth = '2px';
      entry.el.style.background = 'rgba(0, 0, 20, 0.55)';
    }
  }

  /** Extract "r, g, b" decimal values from "#rrggbb" for use in rgba(). */
  private hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  }

  /** Move an existing entry to the end of the internal array (most recent). */
  private reorderArray(entry: KillEntry): void {
    const idx = this.entries.indexOf(entry);
    if (idx >= 0 && idx < this.entries.length - 1) {
      this.entries.splice(idx, 1);
      this.entries.push(entry);
    }
  }

  /** Remove the oldest entries when over the max visible count. */
  private pruneOldest(): void {
    while (this.entries.length > MAX_VISIBLE_ENTRIES) {
      const oldest = this.entries.shift();
      if (oldest) {
        oldest.el.remove();
      }
    }
  }
}
