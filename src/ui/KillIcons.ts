/**
 * Shared shape icon SVGs, colour utilities, and display names for enemy types.
 *
 * Used by KillLog, KillTally, and TotalKillCounter to avoid duplicating
 * the icon definitions across multiple files.
 */

// ---------------------------------------------------------------------------
// Shape icon definitions (inline SVG paths per enemy type)
// ---------------------------------------------------------------------------

/**
 * Returns a small inline SVG string for the given enemy type.
 *
 * @param type     Lowercase enemy type key (e.g. "grunt", "wanderer").
 * @param hexColor CSS hex colour string (e.g. "#ff4444").
 * @param size     Pixel size of the SVG element (default 14).
 */
export function shapeIconSVG(type: string, hexColor: string, size = 14): string {
  const fill = hexColor;
  const s = size;
  switch (type) {
    case 'grunt':
    case 'titangrunt':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="8,1 15,8 8,15 1,8" fill="${fill}"/></svg>`;
    case 'wanderer':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="8,0 10,6 16,8 10,10 8,16 6,10 0,8 6,6" fill="${fill}"/></svg>`;
    case 'duck':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="8,1 15,14 1,14" fill="${fill}"/></svg>`;
    case 'neutron':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="8,1 13,3 15,8 13,13 8,15 3,13 1,8 3,3" fill="${fill}"/></svg>`;
    case 'rocket':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="8,0 13,10 10,9 10,16 6,16 6,9 3,10" fill="${fill}"/></svg>`;
    case 'spinner':
    case 'titanspinner':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5" fill="${fill}"/></svg>`;
    case 'weaver':
    case 'titanweaver':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="8,0 12,8 8,16 4,8" fill="${fill}"/></svg>`;
    case 'mayfly':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="6,0 10,0 10,6 16,6 16,10 10,10 10,16 6,16 6,10 0,10 0,6 6,6" fill="${fill}"/></svg>`;
    case 'painter':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="${fill}"/></svg>`;
    case 'snake':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${fill}"/></svg>`;
    case 'repulsor':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="3,1 8,8 3,15 6,15 11,8 6,1" fill="${fill}"/><polygon points="7,1 12,8 7,15 10,15 15,8 10,1" fill="${fill}" opacity="0.6"/></svg>`;
    case 'gravitywell':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="${fill}" stroke-width="1.5"/><circle cx="8" cy="8" r="4" fill="${fill}" opacity="0.7"/></svg>`;
    case 'spawner':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" fill="${fill}" opacity="0.5"/><rect x="4" y="4" width="8" height="8" fill="${fill}"/></svg>`;
    case 'virus':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="${fill}"/></svg>`;
    case 'gate':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><rect x="2" y="1" width="4" height="14" fill="${fill}"/><rect x="10" y="1" width="4" height="14" fill="${fill}"/></svg>`;
    case 'boss':
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="8,1 15,6 13,15 3,15 1,6" fill="${fill}"/></svg>`;
    default:
      return `<svg width="${s}" height="${s}" viewBox="0 0 16 16"><polygon points="4,1 12,1 16,8 12,15 4,15 0,8" fill="${fill}"/></svg>`;
  }
}

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------

/** Convert a 0xRRGGBB number to a CSS hex string. */
export function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** Known enemy colours (matches ENEMY_COLORS used in main game loops). */
export const ENEMY_HEX_COLORS: Record<string, string> = {
  grunt: '#4444ff',
  wanderer: '#aa44ff',
  duck: '#ff44aa',
  mayfly: '#ddddff',
  rocket: '#ff8800',
  neutron: '#ccff00',
  weaver: '#00ff44',
  spinner: '#ff44ff',
  snake: '#4488ff',
  repulsor: '#ff4400',
  gravitywell: '#4488ff',
  gate: '#ffffff',
  painter: '#ff44aa',
  virus: '#88ff44',
  spawner: '#440066',
  titangrunt: '#2244cc',
  titanspinner: '#ff22ff',
  titanweaver: '#22ff44',
  boss: '#ffcc00',
};

/** Get the hex colour for an enemy type, with a grey fallback. */
export function getEnemyColor(type: string): string {
  return ENEMY_HEX_COLORS[type] ?? '#aaaaaa';
}

// ---------------------------------------------------------------------------
// Pretty display names
// ---------------------------------------------------------------------------

export const DISPLAY_NAMES: Record<string, string> = {
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
