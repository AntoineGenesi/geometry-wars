/**
 * Kill log / event feed UI.
 *
 * Displays a scrolling list of enemy kills in the bottom-left corner.
 * Each enemy type gets a single entry with a running tally that increments
 * on subsequent kills.  Entries fade out after a configurable timeout and
 * are removed from the DOM once fully invisible.
 *
 * Shape icons are tiny inline SVGs coloured to match the enemy type.
 */

// ---------------------------------------------------------------------------
// Shape icon definitions (inline SVG paths per enemy type)
// ---------------------------------------------------------------------------

/** Returns a small (16x16) inline SVG string for the given enemy type. */
function shapeIconSVG(type: string, hexColor: string): string {
  const fill = hexColor;
  // Each icon is a 16x16 viewBox with a recognisable shape silhouette.
  switch (type) {
    case 'grunt':
    case 'titangrunt':
      // Diamond
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="8,1 15,8 8,15 1,8" fill="${fill}"/></svg>`;
    case 'wanderer':
      // Pinwheel (4-pointed star)
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="8,0 10,6 16,8 10,10 8,16 6,10 0,8 6,6" fill="${fill}"/></svg>`;
    case 'duck':
      // Triangle (arrow-like)
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="8,1 15,14 1,14" fill="${fill}"/></svg>`;
    case 'neutron':
      // Heptagon (approximated)
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="8,1 13,3 15,8 13,13 8,15 3,13 1,8 3,3" fill="${fill}"/></svg>`;
    case 'rocket':
      // Arrow pointing up
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="8,0 13,10 10,9 10,16 6,16 6,9 3,10" fill="${fill}"/></svg>`;
    case 'spinner':
    case 'titanspinner':
      // Octahedron (octagon)
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5" fill="${fill}"/></svg>`;
    case 'weaver':
    case 'titanweaver':
      // Thin diamond
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="8,0 12,8 8,16 4,8" fill="${fill}"/></svg>`;
    case 'mayfly':
      // Small plus / cross
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="6,0 10,0 10,6 16,6 16,10 10,10 10,16 6,16 6,10 0,10 0,6 6,6" fill="${fill}"/></svg>`;
    case 'painter':
      // Square
      return `<svg width="14" height="14" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="${fill}"/></svg>`;
    case 'snake':
      // Circle
      return `<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${fill}"/></svg>`;
    case 'repulsor':
      // Chevron / double arrow
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="3,1 8,8 3,15 6,15 11,8 6,1" fill="${fill}"/><polygon points="7,1 12,8 7,15 10,15 15,8 10,1" fill="${fill}" opacity="0.6"/></svg>`;
    case 'gravitywell':
      // Concentric circles
      return `<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="${fill}" stroke-width="1.5"/><circle cx="8" cy="8" r="4" fill="${fill}" opacity="0.7"/></svg>`;
    case 'spawner':
      // Cube (square with inset)
      return `<svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" fill="${fill}" opacity="0.5"/><rect x="4" y="4" width="8" height="8" fill="${fill}"/></svg>`;
    case 'virus':
      // Small circle
      return `<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="${fill}"/></svg>`;
    case 'gate':
      // Two vertical bars (gate shape)
      return `<svg width="14" height="14" viewBox="0 0 16 16"><rect x="2" y="1" width="4" height="14" fill="${fill}"/><rect x="10" y="1" width="4" height="14" fill="${fill}"/></svg>`;
    case 'boss':
      // Pentagon (boss-like)
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="8,1 15,6 13,15 3,15 1,6" fill="${fill}"/></svg>`;
    default:
      // Generic hexagon
      return `<svg width="14" height="14" viewBox="0 0 16 16"><polygon points="4,1 12,1 16,8 12,15 4,15 0,8" fill="${fill}"/></svg>`;
  }
}

/** Convert a 0xRRGGBB number to a CSS hex string. */
function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Pretty display names
// ---------------------------------------------------------------------------

const DISPLAY_NAMES: Record<string, string> = {
  grunt: 'Grunt',
  wanderer: 'Wanderer',
  duck: 'Duck',
  neutron: 'Neutron',
  rocket: 'Rocket',
  spinner: 'Spinner',
  weaver: 'Weaver',
  mayfly: 'Mayfly',
  painter: 'Painter',
  snake: 'Snake',
  repulsor: 'Repulsor',
  gravitywell: 'Gravity Well',
  spawner: 'Spawner',
  virus: 'Virus',
  gate: 'Gate',
  titangrunt: 'Titan Grunt',
  titanspinner: 'Titan Spinner',
  titanweaver: 'Titan Weaver',
  boss: 'Boss',
};

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
}

// ---------------------------------------------------------------------------
// KillLog
// ---------------------------------------------------------------------------

const MAX_VISIBLE_ENTRIES = 10;
const FADE_AFTER_SECONDS = 10;
const FADE_DURATION_SECONDS = 2;

export class KillLog {
  private container: HTMLDivElement;
  private entries: KillEntry[] = [];
  private styleEl: HTMLStyleElement;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      #kill-log {
        position: fixed;
        bottom: 16px;
        left: 16px;
        width: 200px;
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
        font-size: 13px;
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

      .kill-entry.new-entry {
        animation: kill-pop-in 0.2s ease-out;
      }

      .kill-entry.count-bump .kill-count {
        animation: kill-pop-in 0.15s ease-out;
      }
    `;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.id = 'kill-log';
    document.body.appendChild(this.container);
  }

  /**
   * Record a kill of the given enemy type.
   * If an entry for this type already exists, its tally is incremented.
   * Otherwise a new entry is created.
   *
   * @param enemyType  Lowercase enemy type key (e.g. "grunt", "wanderer").
   * @param color      0xRRGGBB colour number for the enemy.
   */
  addKill(enemyType: string, color: number): void {
    const existing = this.entries.find(e => e.type === enemyType);

    if (existing) {
      existing.count++;
      existing.age = 0;
      existing.countEl.textContent = `x${existing.count}`;
      existing.el.style.opacity = '1';

      // Brief visual bump
      existing.el.classList.remove('count-bump');
      // Force reflow so re-adding the class restarts the animation
      void existing.el.offsetWidth;
      existing.el.classList.add('count-bump');

      // Move to bottom (most recent)
      this.container.appendChild(existing.el);
      this.reorderArray(existing);
    } else {
      // Create new entry
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
          // Fully faded -- remove
          entry.el.remove();
          this.entries.splice(i, 1);
        } else {
          entry.el.style.opacity = String(Math.max(0, 1 - fadeProgress));
        }
      }
    }
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

    const countSpan = document.createElement('span');
    countSpan.className = 'kill-count';
    countSpan.textContent = 'x1';

    el.appendChild(iconSpan);
    el.appendChild(nameSpan);
    el.appendChild(countSpan);

    // Remove the intro animation class after it plays
    el.addEventListener('animationend', () => {
      el.classList.remove('new-entry');
    }, { once: true });

    return { type, color, count: 1, age: 0, el, countEl: countSpan };
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
