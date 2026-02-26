/**
 * Per-player kill tally UI for split-screen multiplayer.
 *
 * Shows a compact breakdown of kills by enemy type in the bottom-right
 * corner of each player's viewport. Displays the top N enemy types
 * (by kill count) with small SVG shape icons and running counts.
 *
 * Player accent color is used for the header and border styling.
 */

import { shapeIconSVG, getEnemyColor } from './KillIcons';
import { t } from '../i18n';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DISPLAYED_TYPES = 6;
const PLAYER_CSS_COLORS = ['#00ffff', '#ff00ff', '#00ff00', '#ffaa00'];

// ---------------------------------------------------------------------------
// Per-player tally data
// ---------------------------------------------------------------------------

interface EnemyTallyEntry {
  type: string;
  count: number;
}

interface PlayerTally {
  /** Enemy type -> kill count */
  kills: Map<string, number>;
  /** Total kills across all types */
  total: number;
  /** The container div positioned within the viewport */
  container: HTMLDivElement;
  /** Cached sorted entries for rendering (updated on addKill) */
  sortedEntries: EnemyTallyEntry[];
}

// ---------------------------------------------------------------------------
// KillTally
// ---------------------------------------------------------------------------

export class KillTally {
  private tallies: PlayerTally[] = [];
  private styleEl: HTMLStyleElement;
  private readonly playerCount: number;

  constructor(playerCount: number) {
    this.playerCount = playerCount;

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      .kill-tally {
        position: absolute;
        bottom: 8px;
        right: 8px;
        width: 130px;
        pointer-events: none;
        font-family: 'Segoe UI', Arial, sans-serif;
        z-index: 101;
      }

      .kill-tally-header {
        font-size: 9px;
        font-weight: bold;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        padding: 2px 6px;
        margin-bottom: 2px;
        border-bottom: 1px solid currentColor;
        opacity: 0.8;
      }

      .kill-tally-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 1px 6px;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.3px;
        white-space: nowrap;
        background: rgba(0, 0, 20, 0.45);
      }

      .kill-tally-row .tally-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        line-height: 0;
      }

      .kill-tally-row .tally-count {
        margin-left: auto;
        font-variant-numeric: tabular-nums;
        opacity: 0.9;
        font-size: 10px;
      }

      .kill-tally-total {
        font-size: 9px;
        text-align: right;
        padding: 2px 6px 0;
        opacity: 0.6;
        letter-spacing: 0.5px;
      }

      @keyframes tally-bump {
        0% { transform: scale(1.3); }
        100% { transform: scale(1); }
      }

      .kill-tally-row.bumped .tally-count {
        animation: tally-bump 0.15s ease-out;
      }
    `;
    document.head.appendChild(this.styleEl);

    for (let i = 0; i < playerCount; i++) {
      const container = document.createElement('div');
      container.className = 'kill-tally';
      container.dataset.player = String(i);
      document.body.appendChild(container);

      this.tallies.push({
        kills: new Map(),
        total: 0,
        container,
        sortedEntries: [],
      });
    }
  }

  /**
   * Set the pixel-space position and size for a player's tally overlay.
   * Called from the same viewport sizing logic as SplitScreenHUD.
   */
  setViewportBounds(
    playerIndex: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const tally = this.tallies[playerIndex];
    if (!tally) return;
    // Position the container absolutely within the viewport rectangle.
    // The tally uses bottom-right anchoring via CSS, so we set the
    // container to match the viewport bounds exactly.
    const el = tally.container;
    el.style.position = 'fixed';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    // The inner content uses absolute positioning via CSS bottom/right.
  }

  /**
   * Record a kill by a specific player of a specific enemy type.
   *
   * @param playerIndex  Index of the player who got the kill (0-based)
   * @param enemyType    Lowercase enemy type key (e.g. "grunt", "wanderer")
   */
  addKill(playerIndex: number, enemyType: string): void {
    const tally = this.tallies[playerIndex];
    if (!tally) return;

    const prev = tally.kills.get(enemyType) ?? 0;
    tally.kills.set(enemyType, prev + 1);
    tally.total++;

    // Rebuild sorted entries (descending by count)
    tally.sortedEntries = Array.from(tally.kills.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    this.renderTally(playerIndex);
  }

  /**
   * Render/re-render the tally display for a specific player.
   */
  private renderTally(playerIndex: number): void {
    const tally = this.tallies[playerIndex];
    if (!tally) return;

    const accentColor = PLAYER_CSS_COLORS[playerIndex] ?? '#ffffff';
    const entries = tally.sortedEntries.slice(0, MAX_DISPLAYED_TYPES);

    // Build HTML
    let html = `<div class="kill-tally-header" style="color:${accentColor}">${t('hud.kills')}</div>`;

    for (const entry of entries) {
      const enemyColor = getEnemyColor(entry.type);
      const icon = shapeIconSVG(entry.type, enemyColor, 12);
      html += `<div class="kill-tally-row bumped" style="color:${enemyColor}">`;
      html += `<span class="tally-icon">${icon}</span>`;
      html += `<span class="tally-count" style="color:${accentColor}">${entry.count}</span>`;
      html += `</div>`;
    }

    // Show total if there are more types than displayed
    if (tally.sortedEntries.length > MAX_DISPLAYED_TYPES) {
      const hiddenCount = tally.total - entries.reduce((s, e) => s + e.count, 0);
      html += `<div class="kill-tally-total" style="color:${accentColor}">+${hiddenCount} more</div>`;
    }

    // Always show total
    html += `<div class="kill-tally-total" style="color:${accentColor}">${tally.total} total</div>`;

    // We need an inner wrapper since the outer container fills the entire viewport
    tally.container.innerHTML = `<div style="position:absolute;bottom:8px;right:8px;width:130px;">${html}</div>`;
  }

  /**
   * Get the current kill count for a specific player and enemy type.
   */
  getKillCount(playerIndex: number, enemyType: string): number {
    const tally = this.tallies[playerIndex];
    if (!tally) return 0;
    return tally.kills.get(enemyType) ?? 0;
  }

  /**
   * Get the total kills for a player.
   */
  getTotalKills(playerIndex: number): number {
    return this.tallies[playerIndex]?.total ?? 0;
  }

  /**
   * Reset all tallies (e.g. on game restart).
   */
  reset(): void {
    for (const tally of this.tallies) {
      tally.kills.clear();
      tally.total = 0;
      tally.sortedEntries = [];
      tally.container.innerHTML = '';
    }
  }

  /**
   * Remove all DOM elements.
   */
  dispose(): void {
    for (const tally of this.tallies) {
      tally.container.remove();
    }
    this.tallies = [];
    this.styleEl.remove();
  }
}
