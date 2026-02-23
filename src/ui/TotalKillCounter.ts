/**
 * Persistent total kill counter UI.
 *
 * Displays cumulative kills of each enemy type with their shape icons,
 * positioned on the opposite side of the screen from the kill log (right side).
 *
 * Features:
 * - Shows all enemy types killed in the current session
 * - Sorted by kill count (highest first)
 * - Compact rows with icon + count
 * - Neon glow aesthetic matching the game's visual style
 * - DOM element reuse (zero per-frame creation)
 * - Works in single player, split-screen, and LAN modes
 * - Optional viewport bounds for split-screen positioning
 */

import { shapeIconSVG, getEnemyColor } from './KillIcons';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DISPLAYED_TYPES = 8;

// ---------------------------------------------------------------------------
// Row cache for DOM reuse
// ---------------------------------------------------------------------------

interface RowCache {
  el: HTMLDivElement;
  iconEl: HTMLSpanElement;
  countEl: HTMLSpanElement;
  /** The enemy type currently rendered in this row (empty if unused). */
  currentType: string;
  /** The count currently shown (avoids unnecessary DOM writes). */
  currentCount: number;
}

// ---------------------------------------------------------------------------
// TotalKillCounter
// ---------------------------------------------------------------------------

export class TotalKillCounter {
  private kills: Map<string, number> = new Map();
  private total = 0;

  private container: HTMLDivElement;
  private innerWrap: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private totalEl: HTMLDivElement;
  private rows: RowCache[] = [];
  private styleEl: HTMLStyleElement;

  /** Cached sorted entries, rebuilt on addKill. */
  private sortedEntries: Array<{ type: string; count: number }> = [];
  /** Flag to avoid redundant renders when nothing changed. */
  private dirty = false;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      .total-kill-counter {
        position: fixed;
        bottom: 16px;
        right: 16px;
        width: 140px;
        pointer-events: none;
        font-family: 'Segoe UI', Arial, sans-serif;
        z-index: 100;
      }

      .total-kill-counter .tkc-inner {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .total-kill-counter .tkc-header {
        font-size: 9px;
        font-weight: bold;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        padding: 2px 6px;
        margin-bottom: 2px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.3);
        color: #ffffff;
        text-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
        opacity: 0.85;
      }

      .total-kill-counter .tkc-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 1px 6px;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.3px;
        white-space: nowrap;
        background: rgba(0, 0, 20, 0.45);
        transition: opacity 0.2s;
      }

      .total-kill-counter .tkc-row.hidden {
        display: none;
      }

      .total-kill-counter .tkc-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        line-height: 0;
      }

      .total-kill-counter .tkc-count {
        margin-left: auto;
        font-variant-numeric: tabular-nums;
        opacity: 0.9;
        font-size: 11px;
        color: #ffffff;
        text-shadow: 0 0 4px rgba(255, 255, 255, 0.4);
      }

      .total-kill-counter .tkc-total {
        font-size: 9px;
        text-align: right;
        padding: 2px 6px 0;
        color: #ffffff;
        opacity: 0.6;
        letter-spacing: 0.5px;
      }

      @keyframes tkc-bump {
        0% { transform: scale(1.2); }
        100% { transform: scale(1); }
      }

      .total-kill-counter .tkc-count.bumped {
        animation: tkc-bump 0.15s ease-out;
      }
    `;
    document.head.appendChild(this.styleEl);

    // Outer container (for viewport positioning)
    this.container = document.createElement('div');
    this.container.className = 'total-kill-counter';

    // Inner wrapper
    this.innerWrap = document.createElement('div');
    this.innerWrap.className = 'tkc-inner';
    this.container.appendChild(this.innerWrap);

    // Header
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'tkc-header';
    this.headerEl.textContent = 'TOTAL KILLS';
    this.innerWrap.appendChild(this.headerEl);

    // Pre-create row elements for reuse
    for (let i = 0; i < MAX_DISPLAYED_TYPES; i++) {
      const row = this.createRow();
      this.rows.push(row);
      this.innerWrap.appendChild(row.el);
    }

    // Total line
    this.totalEl = document.createElement('div');
    this.totalEl.className = 'tkc-total';
    this.totalEl.textContent = '';
    this.innerWrap.appendChild(this.totalEl);

    document.body.appendChild(this.container);
  }

  /**
   * Record a kill of the given enemy type.
   *
   * @param enemyType  Lowercase enemy type key.
   * @param _color     Colour (unused -- looked up from ENEMY_HEX_COLORS).
   */
  addKill(enemyType: string, _color?: number): void {
    const prev = this.kills.get(enemyType) ?? 0;
    this.kills.set(enemyType, prev + 1);
    this.total++;

    // Rebuild sorted entries (descending by count)
    this.sortedEntries = Array.from(this.kills.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    this.dirty = true;
    this.render();
  }

  /**
   * Set the pixel-space position for split-screen viewport bounds.
   * The counter will be positioned at the bottom-right within the given rect.
   */
  setViewportBounds(x: number, y: number, w: number, h: number): void {
    const el = this.container;
    el.style.position = 'fixed';
    el.style.bottom = '';
    el.style.right = '';
    el.style.left = `${x + w - 148}px`;
    el.style.top = `${y + h - 16 - this.innerWrap.offsetHeight}px`;
    el.style.width = '140px';
  }

  /**
   * Reset to default fixed positioning (bottom-right of full screen).
   */
  resetPosition(): void {
    const el = this.container;
    el.style.position = 'fixed';
    el.style.left = '';
    el.style.top = '';
    el.style.bottom = '16px';
    el.style.right = '16px';
    el.style.width = '140px';
  }

  /**
   * Get the current kill count for a specific enemy type.
   */
  getKillCount(enemyType: string): number {
    return this.kills.get(enemyType) ?? 0;
  }

  /**
   * Get the total kills across all types.
   */
  getTotalKills(): number {
    return this.total;
  }

  /**
   * Get all kill data for testing/inspection.
   */
  getAllKills(): ReadonlyArray<{ type: string; count: number }> {
    return [...this.sortedEntries];
  }

  /**
   * Reset all counters.
   */
  reset(): void {
    this.kills.clear();
    this.total = 0;
    this.sortedEntries = [];
    this.dirty = true;
    this.render();
  }

  /**
   * Hide the counter (e.g. on mobile where screen space is limited).
   */
  hide(): void {
    this.container.style.display = 'none';
  }

  /**
   * Remove all DOM elements.
   */
  dispose(): void {
    this.container.remove();
    this.styleEl.remove();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private createRow(): RowCache {
    const el = document.createElement('div');
    el.className = 'tkc-row hidden';

    const iconEl = document.createElement('span');
    iconEl.className = 'tkc-icon';

    const countEl = document.createElement('span');
    countEl.className = 'tkc-count';

    el.appendChild(iconEl);
    el.appendChild(countEl);

    return { el, iconEl, countEl, currentType: '', currentCount: 0 };
  }

  private render(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const entries = this.sortedEntries.slice(0, MAX_DISPLAYED_TYPES);

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];

      if (i < entries.length) {
        const entry = entries[i];
        row.el.classList.remove('hidden');

        // Only update icon if the type changed
        if (row.currentType !== entry.type) {
          const enemyColor = getEnemyColor(entry.type);
          row.iconEl.innerHTML = shapeIconSVG(entry.type, enemyColor, 12);
          row.el.style.color = enemyColor;
          row.currentType = entry.type;
          row.currentCount = -1; // Force count update
        }

        // Only update count text if it changed
        if (row.currentCount !== entry.count) {
          row.countEl.textContent = String(entry.count);
          row.currentCount = entry.count;

          // Bump animation
          row.countEl.classList.remove('bumped');
          void row.countEl.offsetWidth;
          row.countEl.classList.add('bumped');
        }
      } else {
        // Hide unused rows
        row.el.classList.add('hidden');
        row.currentType = '';
        row.currentCount = 0;
      }
    }

    // Total line
    if (this.total > 0) {
      const hiddenCount = this.sortedEntries.length > MAX_DISPLAYED_TYPES
        ? this.total - entries.reduce((s, e) => s + e.count, 0)
        : 0;
      let totalText = `${this.total} total`;
      if (hiddenCount > 0) {
        totalText = `+${hiddenCount} more | ${totalText}`;
      }
      this.totalEl.textContent = totalText;
    } else {
      this.totalEl.textContent = '';
    }
  }
}
