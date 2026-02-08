/**
 * Weapon database/wiki overlay.
 *
 * Full-screen DOM overlay showing all weapons with stats, visual previews,
 * and buff descriptions. Accessible from PauseMenu and StartMenu.
 *
 * Clicking a weapon card opens a detailed modal with:
 * - Large weapon name + icon
 * - Full stat table
 * - Tactical description and tips
 * - In-game screenshot (from public/weapon-screenshots/)
 */

import { WeaponType, WEAPON_CONFIGS, type WeaponConfig } from '../weapons/WeaponTypes';
import { BuffType, BUFF_CONFIGS, type BuffConfig } from '../weapons/BuffPickup';

/** Convert a numeric hex color (0xRRGGBB) to a CSS hex string */
function hexColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** Normalize a stat value to 0..1 range for bar display */
function normalizeBar(value: number, max: number): number {
  return Math.min(value / max, 1);
}

/**
 * Format fire rate for display.
 * Continuous weapons (fireRate >= 30) show "Continuous".
 * Others show "X/s".
 */
function formatFireRate(fireRate: number): string {
  if (fireRate >= 30) return 'Continuous';
  return `${fireRate}/s`;
}

/**
 * Format ammo for display.
 * -1 means unlimited (standard weapon).
 * High values (200+) for sustained weapons show as duration.
 */
function formatAmmo(ammo: number, fireRate: number): string {
  if (ammo === -1) return 'Unlimited';
  if (fireRate >= 30) return `${(ammo / fireRate).toFixed(1)}s`;
  return `${ammo}`;
}

/**
 * Format speed for display.
 * 0 means instant (beams, area effects).
 */
function formatSpeed(speed: number): string {
  if (speed === 0) return 'Instant';
  return speed.toFixed(1);
}

/** Weapon symbol icons for the modal header */
const WEAPON_SYMBOLS: Record<WeaponType, string> = {
  [WeaponType.Standard]: '\u2022\u2022\u2022',    // bullets
  [WeaponType.Spread]: '\u2234',                   // fan pattern
  [WeaponType.Piercing]: '\u2501\u2501\u25B6',     // beam arrow
  [WeaponType.ChainLightning]: '\u26A1',           // lightning
  [WeaponType.Homing]: '\u2316',                   // crosshair
  [WeaponType.PlasmaMortar]: '\u25C9',             // explosion
  [WeaponType.GravityGun]: '\u2B59',               // spiral/gravity
  [WeaponType.LaserBeam]: '\u2550\u2550\u2550',    // sustained beam
  [WeaponType.BlackHole]: '\u25CF',                // black dot
  [WeaponType.TeslaCoil]: '\u2607',                // lightning area
};

/** Extended descriptions with tactical tips for the modal */
const WEAPON_TACTICS: Record<WeaponType, { detail: string; tips: string[] }> = {
  [WeaponType.Standard]: {
    detail: 'The default Blaster fires rapid energy bolts in the direction you aim. It has unlimited ammo and a consistent fire rate, making it the reliable fallback weapon you always return to when pickups run dry.',
    tips: [
      'Never runs out - your safety net between weapon pickups',
      'High fire rate compensates for lower per-shot damage',
      'Good for kiting large groups at medium range',
      'Pair with Rapid Fire buff for devastating DPS',
    ],
  },
  [WeaponType.Spread]: {
    detail: 'Spread Shot fires 5 projectiles in a wide fan pattern, covering a large arc in front of you. Each bolt deals full damage, making it devastating against clustered enemies. Limited ammo means you should save it for swarm encounters.',
    tips: [
      'Best against tightly packed enemy groups and swarms',
      'Each of the 5 bullets deals full damage independently',
      'Effective at close to medium range where all bolts connect',
      'Save ammo for wave spawns rather than single targets',
    ],
  },
  [WeaponType.Piercing]: {
    detail: 'The Piercing Beam fires an instant geodesic ray that passes through every enemy in its path. It follows the surface curvature, hitting targets even around bends. High damage per shot but slow fire rate demands precise aim.',
    tips: [
      'Line up enemies for maximum penetration value',
      'Instant hit - no travel time, no dodging',
      'Follows surface curvature on torus and complex shapes',
      'Best on tube-like surfaces where enemies line up naturally',
    ],
  },
  [WeaponType.ChainLightning]: {
    detail: 'Chain Lightning strikes the nearest enemy and then arcs to up to 5 additional targets within range. Each arc deals 75% of the previous hit\'s damage. Instant activation makes it excellent against scattered groups.',
    tips: [
      'Automatically finds targets - no precise aim needed',
      'Arcs chain between up to 6 total enemies',
      'Damage falls off with each chain (75% per arc)',
      'Deadly in dense enemy clusters where chains overlap',
    ],
  },
  [WeaponType.Homing]: {
    detail: 'Homing Missiles lock onto the nearest enemy and pursue them across the surface. High damage per missile but slow fire rate and limited ammo. The missiles are slower than standard bullets but guarantee hits on mobile targets.',
    tips: [
      'Fire and forget - missiles track enemies automatically',
      'Ideal against fast-moving enemies like Rockets and Weavers',
      'Slow projectile speed means missiles take time to reach distant targets',
      'Save for dangerous single targets rather than crowds',
    ],
  },
  [WeaponType.PlasmaMortar]: {
    detail: 'The Plasma Mortar launches a slow-moving orb that detonates on impact with massive area-of-effect damage. The highest single-hit damage in the game, capable of wiping entire enemy clusters in one blast.',
    tips: [
      'Highest damage per shot of any weapon (20 per hit)',
      'AoE explosion clears entire groups on impact',
      'Slow projectile - lead your targets',
      'Devastating against Spawners and tight enemy clusters',
    ],
  },
  [WeaponType.GravityGun]: {
    detail: 'The Gravity Gun fires a vortex projectile that pulls nearby enemies toward its center as it travels. Low direct damage but creates crowd control by clustering enemies together, setting up devastating combo opportunities.',
    tips: [
      'Pull enemies together, then switch to Spread or Mortar',
      'Excellent crowd control even with low direct damage',
      'Combine with bombs for maximum area damage',
      'Forces Repulsors and evasive enemies out of position',
    ],
  },
  [WeaponType.LaserBeam]: {
    detail: 'The Laser Beam projects a continuous high-energy ray that deals sustained damage to anything in its path. Hold fire to maintain the beam. Duration-based ammo drains while firing. Instant hit with no travel time.',
    tips: [
      'Sustained DPS - hold fire to sweep across enemy groups',
      'Instant beam with no projectile travel time',
      'Duration: ~3.3 seconds of continuous fire',
      'Sweep across groups for efficient ammo usage',
    ],
  },
  [WeaponType.BlackHole]: {
    detail: 'The Black Hole launcher creates a slow-moving singularity that destroys everything it touches. With 999 damage, nothing survives contact. Extremely limited ammo (6 shots) and slow fire rate demand strategic deployment.',
    tips: [
      'One-hit kills everything including Titans and Bosses',
      'Only 6 shots - use them wisely on the biggest threats',
      'Slow projectile acts as area denial while traveling',
      'Save for Boss phases or overwhelming wave spawns',
    ],
  },
  [WeaponType.TeslaCoil]: {
    detail: 'The Tesla Coil generates an electromagnetic field around the player that continuously damages all nearby enemies. No aiming required - just move through enemy groups. Lasts approximately 10 seconds of constant area damage.',
    tips: [
      'Passive area damage - just stay near enemies',
      'No aiming needed, frees you to focus on movement',
      'Best on smaller surfaces where enemies are naturally close',
      'Combine with aggressive movement to sweep through groups',
    ],
  },
};

/** Map weapon type enum to filename-safe slug */
function weaponSlug(type: WeaponType): string {
  return type.replace(/_/g, '-');
}

/** Classify a weapon for the "Special" row */
function getSpecialProperty(w: WeaponConfig): string {
  switch (w.type) {
    case WeaponType.Standard: return 'None';
    case WeaponType.Spread: return '5-way fan pattern';
    case WeaponType.Piercing: return 'Penetrates all enemies';
    case WeaponType.ChainLightning: return 'Chains to 6 targets (75% falloff)';
    case WeaponType.Homing: return 'Auto-targeting missiles';
    case WeaponType.PlasmaMortar: return 'Area-of-effect explosion';
    case WeaponType.GravityGun: return 'Pulls enemies to center';
    case WeaponType.LaserBeam: return 'Sustained continuous beam';
    case WeaponType.BlackHole: return 'Destroys everything on contact';
    case WeaponType.TeslaCoil: return 'Passive area damage';
    default: return 'None';
  }
}

/** Classify weapon range */
function getRange(w: WeaponConfig): string {
  if (w.projectileSpeed === 0) {
    if (w.type === WeaponType.TeslaCoil) return 'Close';
    return 'Infinite (instant)';
  }
  if (w.projectileSpeed <= 0.8) return 'Medium';
  if (w.projectileSpeed <= 1.2) return 'Medium-Long';
  return 'Long';
}

const STYLE_ID = 'weapon-wiki-styles';

export class WeaponWiki {
  private container: HTMLDivElement;
  private modalOverlay: HTMLDivElement | null = null;
  private onCloseCallback: (() => void) | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'weapon-wiki';
    this.container.classList.add('hidden');
    this.applyStyles();
    this.buildContent();
    document.body.appendChild(this.container);
    this.attachListeners();
  }

  private applyStyles(): void {
    // Avoid duplicate style injection
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #weapon-wiki {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0, 0, 20, 0.92);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        z-index: 2500;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(6px);
        overflow-y: auto;
      }
      #weapon-wiki.hidden { display: none; }

      #weapon-wiki .wiki-content {
        max-width: 820px;
        width: 100%;
        padding: 40px 30px 60px;
      }

      /* Header */
      #weapon-wiki .wiki-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
      }
      #weapon-wiki .wiki-title {
        color: #ffff00;
        font-size: 36px;
        font-weight: bold;
        letter-spacing: 6px;
        text-shadow: 0 0 10px #ffff00, 0 0 20px #ffaa00;
        margin: 0;
      }
      #weapon-wiki .wiki-close {
        background: none;
        border: 2px solid #666688;
        color: #aaaacc;
        font-size: 22px;
        width: 44px;
        height: 44px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }
      #weapon-wiki .wiki-close:hover {
        border-color: #ff4444;
        color: #ff4444;
        box-shadow: 0 0 12px #ff4444;
      }

      /* Weapon grid */
      #weapon-wiki .weapon-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-bottom: 40px;
      }
      @media (max-width: 640px) {
        #weapon-wiki .weapon-grid {
          grid-template-columns: 1fr;
        }
      }

      /* Weapon card */
      #weapon-wiki .weapon-card {
        background: rgba(10, 10, 30, 0.8);
        border: 1px solid var(--weapon-color, #666);
        padding: 18px;
        transition: all 0.2s;
        cursor: pointer;
      }
      #weapon-wiki .weapon-card:hover {
        box-shadow: 0 0 18px var(--weapon-color, #666);
        border-width: 2px;
        padding: 17px;
      }

      /* Card header */
      #weapon-wiki .card-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      #weapon-wiki .weapon-swatch {
        width: 28px;
        height: 28px;
        border-radius: 4px;
        flex-shrink: 0;
        box-shadow: 0 0 8px var(--weapon-color, #666);
      }
      #weapon-wiki .weapon-name {
        font-size: 18px;
        font-weight: bold;
        letter-spacing: 2px;
        color: var(--weapon-color, #fff);
        text-shadow: 0 0 8px var(--weapon-color, #fff);
      }
      #weapon-wiki .weapon-tag {
        font-size: 10px;
        color: #88ff88;
        letter-spacing: 1px;
        margin-left: auto;
        opacity: 0.8;
      }

      /* Description */
      #weapon-wiki .weapon-desc {
        color: #aaaacc;
        font-size: 13px;
        margin-bottom: 14px;
        line-height: 1.4;
      }

      /* Stats */
      #weapon-wiki .stat-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      #weapon-wiki .stat-label {
        color: #888899;
        font-size: 11px;
        letter-spacing: 1px;
        width: 60px;
        text-align: right;
        flex-shrink: 0;
      }
      #weapon-wiki .stat-bar-bg {
        flex: 1;
        height: 8px;
        background: rgba(40, 40, 60, 0.8);
        border-radius: 4px;
        overflow: hidden;
      }
      #weapon-wiki .stat-bar-fill {
        height: 100%;
        border-radius: 4px;
        transition: width 0.3s;
      }
      #weapon-wiki .stat-value {
        color: #ccccdd;
        font-size: 11px;
        width: 55px;
        text-align: left;
        flex-shrink: 0;
      }

      /* Buffs section */
      #weapon-wiki .buffs-title {
        color: #88ffff;
        font-size: 20px;
        letter-spacing: 4px;
        margin-bottom: 16px;
        text-shadow: 0 0 8px #88ffff;
      }
      #weapon-wiki .buff-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 14px;
      }
      @media (max-width: 640px) {
        #weapon-wiki .buff-grid {
          grid-template-columns: 1fr;
        }
      }
      #weapon-wiki .buff-card {
        background: rgba(10, 10, 30, 0.8);
        border: 1px solid var(--buff-color, #666);
        padding: 16px;
        text-align: center;
        transition: all 0.2s;
      }
      #weapon-wiki .buff-card:hover {
        box-shadow: 0 0 14px var(--buff-color, #666);
      }
      #weapon-wiki .buff-name {
        font-size: 15px;
        font-weight: bold;
        letter-spacing: 2px;
        color: var(--buff-color, #fff);
        text-shadow: 0 0 6px var(--buff-color, #fff);
        margin-bottom: 8px;
      }
      #weapon-wiki .buff-desc {
        color: #aaaacc;
        font-size: 12px;
        line-height: 1.4;
        margin-bottom: 8px;
      }
      #weapon-wiki .buff-meta {
        color: #668888;
        font-size: 11px;
        letter-spacing: 1px;
      }

      /* Close hint */
      #weapon-wiki .wiki-hint {
        text-align: center;
        color: #555566;
        font-size: 12px;
        letter-spacing: 2px;
        margin-top: 30px;
      }

      /* Click hint on cards */
      #weapon-wiki .click-hint {
        color: #555566;
        font-size: 10px;
        letter-spacing: 1px;
        margin-top: 8px;
        text-align: right;
      }

      /* ===== Weapon Detail Modal ===== */
      .weapon-modal-overlay {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0, 0, 10, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 3000;
        backdrop-filter: blur(8px);
        animation: wm-fade-in 0.15s ease-out;
      }
      @keyframes wm-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .weapon-modal-overlay.closing {
        animation: wm-fade-out 0.12s ease-in forwards;
      }
      @keyframes wm-fade-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      .weapon-modal {
        background: rgba(8, 8, 28, 0.96);
        border: 2px solid var(--modal-color, #666);
        max-width: 640px;
        width: 92%;
        max-height: 90vh;
        overflow-y: auto;
        padding: 0;
        position: relative;
        box-shadow: 0 0 40px var(--modal-color, #666), 0 0 80px rgba(0,0,0,0.6);
        animation: wm-scale-in 0.15s ease-out;
      }
      @keyframes wm-scale-in {
        from { transform: scale(0.92); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }

      /* Modal close button */
      .weapon-modal .modal-close {
        position: absolute;
        top: 16px; right: 16px;
        background: none;
        border: 2px solid #555577;
        color: #8888aa;
        font-size: 20px;
        width: 36px; height: 36px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
        line-height: 1;
      }
      .weapon-modal .modal-close:hover {
        border-color: #ff4444;
        color: #ff4444;
        box-shadow: 0 0 10px #ff4444;
      }

      /* Modal header band */
      .weapon-modal .modal-header {
        padding: 28px 30px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        display: flex;
        align-items: center;
        gap: 18px;
      }
      .weapon-modal .modal-icon {
        font-size: 38px;
        color: var(--modal-color, #fff);
        text-shadow: 0 0 14px var(--modal-color, #fff);
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--modal-color, #fff);
        border-radius: 8px;
        background: rgba(0,0,0,0.4);
      }
      .weapon-modal .modal-title-block {
        flex: 1;
        min-width: 0;
      }
      .weapon-modal .modal-weapon-name {
        font-size: 26px;
        font-weight: bold;
        letter-spacing: 3px;
        color: var(--modal-color, #fff);
        text-shadow: 0 0 12px var(--modal-color, #fff);
        margin: 0;
      }
      .weapon-modal .modal-weapon-tagline {
        font-size: 13px;
        color: #aaaacc;
        letter-spacing: 1px;
        margin-top: 4px;
      }

      /* Modal screenshot area */
      .weapon-modal .modal-screenshot {
        padding: 0 30px;
        margin: 20px 0;
      }
      .weapon-modal .modal-screenshot img {
        width: 100%;
        height: auto;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        display: block;
      }
      .weapon-modal .screenshot-placeholder {
        width: 100%;
        height: 160px;
        background: rgba(20, 20, 40, 0.6);
        border: 1px dashed rgba(255,255,255,0.15);
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #444466;
        font-size: 12px;
        letter-spacing: 2px;
      }

      /* Modal stat table */
      .weapon-modal .modal-stats {
        padding: 0 30px;
        margin-bottom: 20px;
      }
      .weapon-modal .modal-stats table {
        width: 100%;
        border-collapse: collapse;
      }
      .weapon-modal .modal-stats th {
        text-align: left;
        color: #666688;
        font-size: 10px;
        font-weight: normal;
        letter-spacing: 2px;
        padding: 6px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        text-transform: uppercase;
      }
      .weapon-modal .modal-stats td {
        padding: 8px 0;
        border-bottom: 1px solid rgba(255,255,255,0.03);
        vertical-align: middle;
      }
      .weapon-modal .modal-stats .stat-name {
        color: #888899;
        font-size: 12px;
        letter-spacing: 1px;
        width: 110px;
      }
      .weapon-modal .modal-stats .stat-bar-cell {
        padding: 8px 12px;
      }
      .weapon-modal .modal-stats .stat-bar-outer {
        height: 6px;
        background: rgba(40, 40, 60, 0.8);
        border-radius: 3px;
        overflow: hidden;
      }
      .weapon-modal .modal-stats .stat-bar-inner {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s ease-out;
      }
      .weapon-modal .modal-stats .stat-val {
        color: #ccccdd;
        font-size: 12px;
        text-align: right;
        width: 80px;
      }

      /* Modal description */
      .weapon-modal .modal-desc {
        padding: 0 30px;
        margin-bottom: 20px;
      }
      .weapon-modal .modal-desc-title {
        color: var(--modal-color, #888);
        font-size: 11px;
        letter-spacing: 3px;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .weapon-modal .modal-desc-text {
        color: #bbbbcc;
        font-size: 13px;
        line-height: 1.6;
      }

      /* Modal tips */
      .weapon-modal .modal-tips {
        padding: 0 30px 28px;
      }
      .weapon-modal .modal-tips-title {
        color: #88ff88;
        font-size: 11px;
        letter-spacing: 3px;
        text-transform: uppercase;
        margin-bottom: 10px;
      }
      .weapon-modal .modal-tips ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .weapon-modal .modal-tips li {
        color: #99aaaa;
        font-size: 12px;
        line-height: 1.5;
        padding: 3px 0 3px 18px;
        position: relative;
      }
      .weapon-modal .modal-tips li::before {
        content: '>';
        position: absolute;
        left: 0;
        color: var(--modal-color, #888);
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
  }

  private buildContent(): void {
    const weapons = Object.values(WEAPON_CONFIGS);
    const buffs = Object.values(BUFF_CONFIGS);

    // Find max values for bar normalization
    const maxDamage = Math.max(...weapons.map(w => w.damage));
    const maxFireRate = Math.max(...weapons.filter(w => w.fireRate < 30).map(w => w.fireRate), 1);
    const maxAmmo = Math.max(...weapons.filter(w => w.ammo > 0 && w.fireRate < 30).map(w => w.ammo), 1);
    const maxSpeed = Math.max(...weapons.filter(w => w.projectileSpeed > 0).map(w => w.projectileSpeed), 1);

    const weaponCardsHTML = weapons.map(w => this.buildWeaponCard(w, maxDamage, maxFireRate, maxAmmo, maxSpeed)).join('');
    const buffCardsHTML = buffs.map(b => this.buildBuffCard(b)).join('');

    this.container.innerHTML = `
      <div class="wiki-content">
        <div class="wiki-header">
          <h1 class="wiki-title">WEAPON DATABASE</h1>
          <button class="wiki-close" data-action="close">&times;</button>
        </div>

        <div class="weapon-grid">
          ${weaponCardsHTML}
        </div>

        <h2 class="buffs-title">FIELD BUFFS</h2>
        <div class="buff-grid">
          ${buffCardsHTML}
        </div>

        <div class="wiki-hint">Click a weapon card for details &middot; Press ESC to close</div>
      </div>
    `;
  }

  private buildWeaponCard(
    w: WeaponConfig,
    maxDamage: number,
    maxFireRate: number,
    maxAmmo: number,
    maxSpeed: number,
  ): string {
    const color = hexColor(w.color);
    const isDefault = w.ammo === -1;
    const tagHTML = isDefault ? '<span class="weapon-tag">DEFAULT &middot; UNLIMITED</span>' : '';

    // For continuous/instant weapons, use special bar logic
    const dmgPct = normalizeBar(w.damage, maxDamage) * 100;
    const frPct = w.fireRate >= 30 ? 100 : normalizeBar(w.fireRate, maxFireRate) * 100;
    const ammoPct = w.ammo === -1 ? 100 : (w.fireRate >= 30 ? normalizeBar(w.ammo / w.fireRate, 10) * 100 : normalizeBar(w.ammo, maxAmmo) * 100);
    const spdPct = w.projectileSpeed === 0 ? 100 : normalizeBar(w.projectileSpeed, maxSpeed) * 100;

    return `
      <div class="weapon-card" style="--weapon-color: ${color}" data-weapon-type="${w.type}">
        <div class="card-header">
          <div class="weapon-swatch" style="background: ${color}"></div>
          <span class="weapon-name">${w.name}</span>
          ${tagHTML}
        </div>
        <div class="weapon-desc">${w.description}</div>
        ${this.statBar('DAMAGE', dmgPct, color, `${w.damage}`)}
        ${this.statBar('RATE', frPct, color, formatFireRate(w.fireRate))}
        ${this.statBar('AMMO', ammoPct, color, formatAmmo(w.ammo, w.fireRate))}
        ${this.statBar('SPEED', spdPct, color, formatSpeed(w.projectileSpeed))}
        <div class="click-hint">CLICK FOR DETAILS</div>
      </div>
    `;
  }

  private statBar(label: string, pct: number, color: string, valueText: string): string {
    return `
      <div class="stat-row">
        <span class="stat-label">${label}</span>
        <div class="stat-bar-bg">
          <div class="stat-bar-fill" style="width: ${pct}%; background: ${color}; opacity: 0.7;"></div>
        </div>
        <span class="stat-value">${valueText}</span>
      </div>
    `;
  }

  private buildBuffCard(b: BuffConfig): string {
    const color = hexColor(b.color);
    return `
      <div class="buff-card" style="--buff-color: ${color}">
        <div class="buff-name">${b.name}</div>
        <div class="buff-desc">${b.description}</div>
        <div class="buff-meta">${b.duration}s &middot; ${b.multiplier}x</div>
      </div>
    `;
  }

  /** Open the detail modal for a specific weapon type */
  private openModal(weaponType: WeaponType): void {
    // Close any existing modal first
    this.closeModal();

    const w = WEAPON_CONFIGS[weaponType];
    const color = hexColor(w.color);
    const symbol = WEAPON_SYMBOLS[weaponType] ?? '?';
    const tactics = WEAPON_TACTICS[weaponType];
    const slug = weaponSlug(weaponType);
    const screenshotPath = `/weapon-screenshots/${slug}.png`;

    // Normalization maxes (same logic as card grid)
    const weapons = Object.values(WEAPON_CONFIGS);
    const maxDamage = Math.max(...weapons.map(x => x.damage));
    const maxFireRate = Math.max(...weapons.filter(x => x.fireRate < 30).map(x => x.fireRate), 1);
    const maxAmmo = Math.max(...weapons.filter(x => x.ammo > 0 && x.fireRate < 30).map(x => x.ammo), 1);
    const maxSpeed = Math.max(...weapons.filter(x => x.projectileSpeed > 0).map(x => x.projectileSpeed), 1);

    const dmgPct = normalizeBar(w.damage, maxDamage) * 100;
    const frPct = w.fireRate >= 30 ? 100 : normalizeBar(w.fireRate, maxFireRate) * 100;
    const ammoPct = w.ammo === -1 ? 100 : (w.fireRate >= 30 ? normalizeBar(w.ammo / w.fireRate, 10) * 100 : normalizeBar(w.ammo, maxAmmo) * 100);
    const spdPct = w.projectileSpeed === 0 ? 100 : normalizeBar(w.projectileSpeed, maxSpeed) * 100;

    const statRows = [
      { name: 'Damage', pct: dmgPct, val: `${w.damage}` },
      { name: 'Fire Rate', pct: frPct, val: formatFireRate(w.fireRate) },
      { name: 'Ammo', pct: ammoPct, val: formatAmmo(w.ammo, w.fireRate) },
      { name: 'Proj. Speed', pct: spdPct, val: formatSpeed(w.projectileSpeed) },
      { name: 'Range', pct: -1, val: getRange(w) },
      { name: 'Special', pct: -1, val: getSpecialProperty(w) },
    ];

    const statsHTML = statRows.map(s => {
      const barCell = s.pct >= 0
        ? `<td class="stat-bar-cell">
             <div class="stat-bar-outer">
               <div class="stat-bar-inner" style="width:${s.pct}%; background:${color}; opacity:0.7;"></div>
             </div>
           </td>`
        : `<td class="stat-bar-cell"></td>`;

      return `<tr>
        <td class="stat-name">${s.name}</td>
        ${barCell}
        <td class="stat-val">${s.val}</td>
      </tr>`;
    }).join('');

    const tipsHTML = tactics
      ? tactics.tips.map(t => `<li>${t}</li>`).join('')
      : '';

    const overlay = document.createElement('div');
    overlay.className = 'weapon-modal-overlay';
    overlay.innerHTML = `
      <div class="weapon-modal" style="--modal-color: ${color}">
        <button class="modal-close" data-action="modal-close">&times;</button>

        <div class="modal-header">
          <div class="modal-icon">${symbol}</div>
          <div class="modal-title-block">
            <h2 class="modal-weapon-name">${w.name}</h2>
            <div class="modal-weapon-tagline">${w.description}</div>
          </div>
        </div>

        <div class="modal-screenshot">
          <img
            src="${screenshotPath}"
            alt="${w.name} in action"
            onerror="
              var svgPath = this.src.replace('.png', '.svg');
              if (!this.dataset.triedSvg) {
                this.dataset.triedSvg = '1';
                this.src = svgPath;
              } else {
                this.style.display='none';
                this.nextElementSibling.style.display='flex';
              }
            "
          />
          <div class="screenshot-placeholder" style="display:none;">
            SCREENSHOT NOT YET GENERATED
          </div>
        </div>

        <div class="modal-stats">
          <table>
            <tr>
              <th>Stat</th>
              <th></th>
              <th style="text-align:right;">Value</th>
            </tr>
            ${statsHTML}
          </table>
        </div>

        <div class="modal-desc">
          <div class="modal-desc-title">HOW IT WORKS</div>
          <div class="modal-desc-text">${tactics?.detail ?? w.description}</div>
        </div>

        ${tipsHTML ? `
        <div class="modal-tips">
          <div class="modal-tips-title">TACTICAL TIPS</div>
          <ul>${tipsHTML}</ul>
        </div>
        ` : ''}
      </div>
    `;

    this.modalOverlay = overlay;
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.closeModal();
      }
    });

    // Close on X button
    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-action="modal-close"]')) {
        this.closeModal();
      }
    });
  }

  /** Close the detail modal with a fade-out animation */
  private closeModal(): void {
    if (!this.modalOverlay) return;
    const overlay = this.modalOverlay;
    this.modalOverlay = null;
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
    }, 120);
  }

  private attachListeners(): void {
    // Close button + weapon card clicks
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-action="close"]')) {
        this.hide();
        return;
      }

      // Check if a weapon card was clicked
      const card = target.closest('.weapon-card') as HTMLElement | null;
      if (card) {
        const weaponType = card.dataset.weaponType as WeaponType | undefined;
        if (weaponType && WEAPON_CONFIGS[weaponType]) {
          this.openModal(weaponType);
        }
      }
    });

    // ESC key - close modal first, then wiki
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.modalOverlay) {
          e.stopPropagation();
          this.closeModal();
          return;
        }
        if (!this.container.classList.contains('hidden')) {
          e.stopPropagation();
          this.hide();
        }
      }
    };
    document.addEventListener('keydown', this.escHandler, true);
  }

  show(): void {
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.closeModal();
    this.container.classList.add('hidden');
    this.onCloseCallback?.();
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  dispose(): void {
    this.closeModal();
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.container.remove();
  }
}
