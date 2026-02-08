/**
 * Weapon database/wiki overlay.
 *
 * Full-screen DOM overlay showing all weapons with stats, visual previews,
 * and buff descriptions. Accessible from PauseMenu and StartMenu.
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

const STYLE_ID = 'weapon-wiki-styles';

export class WeaponWiki {
  private container: HTMLDivElement;
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

        <div class="wiki-hint">Press ESC to close</div>
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
      <div class="weapon-card" style="--weapon-color: ${color}">
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

  private attachListeners(): void {
    // Close button
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-action="close"]')) {
        this.hide();
      }
    });

    // ESC key
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !this.container.classList.contains('hidden')) {
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escHandler, true);
  }

  show(): void {
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.container.classList.add('hidden');
    this.onCloseCallback?.();
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  dispose(): void {
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.container.remove();
  }
}
