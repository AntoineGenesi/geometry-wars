/**
 * PvPvE in-game kill leaderboard HUD.
 *
 * Displays a real-time table showing each player's kills broken down by:
 *   P  — Player kills (PvP)
 *   E  — Enemy kills
 *   Total — P + E
 *
 * Positioned in the top-right corner, away from the kill log (bottom-left)
 * and total kill counter (bottom-right).
 *
 * Only shown during PvPvE mode. Call show()/hide() to toggle visibility.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  id: string;
  name: string;
  /** PvP kills (player killed another player). */
  kills: number;
  /** Enemy kills. */
  enemyKills: number;
  /** Game score (points from killing enemies with multiplier). */
  score: number;
}

// ---------------------------------------------------------------------------
// PvPvELeaderboard
// ---------------------------------------------------------------------------

interface RowCache {
  el: HTMLTableRowElement;
  nameEl: HTMLTableCellElement;
  pvpKillsEl: HTMLTableCellElement;
  enemyKillsEl: HTMLTableCellElement;
  totalEl: HTMLTableCellElement;
  scoreEl: HTMLTableCellElement;
}

export class PvPvELeaderboard {
  private container: HTMLDivElement;
  private tableBody: HTMLTableSectionElement;
  private styleEl: HTMLStyleElement;
  /** Cached rows keyed by player id. */
  private rowCache: Map<string, RowCache> = new Map();

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      #pvpve-leaderboard {
        position: fixed;
        top: 12px;
        right: 16px;
        min-width: 180px;
        pointer-events: none;
        z-index: 100;
        font-family: 'Segoe UI', Arial, sans-serif;
      }

      #pvpve-leaderboard table {
        border-collapse: collapse;
        width: 100%;
      }

      #pvpve-leaderboard .lb-title {
        font-size: 8px;
        font-weight: 800;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: #ffffff;
        text-shadow: 0 0 6px rgba(255,255,255,0.6);
        opacity: 0.8;
        padding: 0 4px 3px 4px;
        border-bottom: 1px solid rgba(255,255,255,0.25);
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 2px;
      }

      #pvpve-leaderboard .lb-title-label {
        flex: 1;
      }

      #pvpve-leaderboard .lb-col-header {
        font-size: 8px;
        color: rgba(255,255,255,0.55);
        letter-spacing: 1px;
        text-align: center;
        width: 28px;
      }

      #pvpve-leaderboard th {
        font-size: 8px;
        letter-spacing: 1px;
        color: rgba(255,255,255,0.55);
        text-transform: uppercase;
        padding: 1px 4px;
        text-align: right;
        font-weight: 600;
        white-space: nowrap;
      }

      #pvpve-leaderboard th:first-child {
        text-align: left;
      }

      #pvpve-leaderboard td {
        font-size: 11px;
        font-weight: 500;
        color: #ffffff;
        padding: 2px 4px;
        background: rgba(0,0,20,0.5);
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      #pvpve-leaderboard td:first-child {
        text-align: left;
        max-width: 90px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
        font-weight: 600;
      }

      #pvpve-leaderboard .lb-total-col {
        color: #00ffcc;
        text-shadow: 0 0 4px rgba(0,255,200,0.5);
        font-weight: 700;
      }

      #pvpve-leaderboard .lb-pvp-col {
        color: #ff6688;
      }

      #pvpve-leaderboard .lb-enemy-col {
        color: #88bbff;
      }

      #pvpve-leaderboard .lb-score-col {
        color: #ffdd88;
        font-size: 9px;
        opacity: 0.8;
      }

      #pvpve-leaderboard .lb-local {
        color: #00ffcc;
        text-shadow: 0 0 5px rgba(0,255,200,0.5);
      }

      #pvpve-leaderboard tr:nth-child(odd) td {
        background: rgba(0,0,20,0.45);
      }
      #pvpve-leaderboard tr:nth-child(even) td {
        background: rgba(0,0,30,0.35);
      }
    `;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.id = 'pvpve-leaderboard';
    this.container.style.display = 'none';

    const table = document.createElement('table');

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const cols = ['Player', 'P', 'E', 'Total', 'Score'];
    for (const col of cols) {
      const th = document.createElement('th');
      th.textContent = col;
      if (col === 'Total') th.style.color = '#00ffcc';
      if (col === 'P') th.style.color = '#ff6688';
      if (col === 'E') th.style.color = '#88bbff';
      if (col === 'Score') th.style.color = '#ffdd88';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    this.tableBody = document.createElement('tbody');
    table.appendChild(this.tableBody);

    this.container.appendChild(table);
    document.body.appendChild(this.container);
  }

  /**
   * Update the leaderboard with current player data.
   * @param entries  Array of player kill stats.
   * @param localPlayerId  Session ID of the local player (highlighted).
   */
  update(entries: LeaderboardEntry[], localPlayerId: string): void {
    // Sort by total kills desc (primary), then score desc (secondary), then name asc
    const sorted = [...entries].sort((a, b) => {
      const totalA = a.kills + a.enemyKills;
      const totalB = b.kills + b.enemyKills;
      if (totalB !== totalA) return totalB - totalA;
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });

    // Remove rows for players no longer in the list
    const activeIds = new Set(sorted.map(e => e.id));
    for (const [id, row] of this.rowCache) {
      if (!activeIds.has(id)) {
        row.el.remove();
        this.rowCache.delete(id);
      }
    }

    // Update/create rows in sorted order
    let insertBefore: HTMLTableRowElement | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const entry = sorted[i];
      let row = this.rowCache.get(entry.id);
      if (!row) {
        row = this.createRow(entry.id === localPlayerId);
        this.rowCache.set(entry.id, row);
      }
      // Keep sorted order by re-inserting at the front each iteration
      this.tableBody.insertBefore(row.el, insertBefore);
      insertBefore = row.el;

      const isLocal = entry.id === localPlayerId;
      const total = entry.kills + entry.enemyKills;

      row.nameEl.textContent = isLocal ? `▶ ${entry.name}` : entry.name;
      row.nameEl.className = isLocal ? 'lb-local' : '';
      row.pvpKillsEl.textContent = String(entry.kills);
      row.enemyKillsEl.textContent = String(entry.enemyKills);
      row.totalEl.textContent = String(total);
      row.scoreEl.textContent = entry.score >= 1000 ? `${Math.round(entry.score / 1000)}k` : String(entry.score);
    }
  }

  show(): void {
    this.container.style.display = '';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.container.remove();
    this.styleEl.remove();
  }

  // ---------------------------------------------------------------------------

  private createRow(isLocal: boolean): RowCache {
    const el = document.createElement('tr');

    const nameEl = document.createElement('td');
    nameEl.className = isLocal ? 'lb-local' : '';

    const pvpKillsEl = document.createElement('td');
    pvpKillsEl.className = 'lb-pvp-col';
    pvpKillsEl.textContent = '0';

    const enemyKillsEl = document.createElement('td');
    enemyKillsEl.className = 'lb-enemy-col';
    enemyKillsEl.textContent = '0';

    const totalEl = document.createElement('td');
    totalEl.className = 'lb-total-col';
    totalEl.textContent = '0';

    const scoreEl = document.createElement('td');
    scoreEl.className = 'lb-score-col';
    scoreEl.textContent = '0';

    el.appendChild(nameEl);
    el.appendChild(pvpKillsEl);
    el.appendChild(enemyKillsEl);
    el.appendChild(totalEl);
    el.appendChild(scoreEl);

    return { el, nameEl, pvpKillsEl, enemyKillsEl, totalEl, scoreEl };
  }
}
