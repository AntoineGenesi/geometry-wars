/**
 * Compact weapon inventory HUD overlay.
 *
 * Shows a vertical strip of small colored icons representing each weapon
 * in the player's inventory. The active weapon is highlighted with a
 * bright border. Ammo count shown next to each.
 *
 * For split-screen, each player gets their own WeaponHUD positioned
 * within their viewport region.
 */

import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import type { WeaponInventoryEntry } from '../weapons/WeaponManager';

/** Short symbol/letter for each weapon type (displayed inside the icon) */
const WEAPON_SYMBOLS: Record<WeaponType, string> = {
  [WeaponType.Standard]: 'S',
  [WeaponType.Spread]: 'W',
  [WeaponType.Piercing]: 'P',
  [WeaponType.ChainLightning]: 'Z',
  [WeaponType.Homing]: 'H',
  [WeaponType.PlasmaMortar]: 'M',
  [WeaponType.GravityGun]: 'G',
  [WeaponType.LaserBeam]: 'L',
  [WeaponType.BlackHole]: 'B',
  [WeaponType.TeslaCoil]: 'T',
};

let styleInjected = false;

function injectStyles(): void {
  if (styleInjected) return;
  styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .weapon-hud {
      position: absolute;
      display: flex;
      flex-direction: column;
      gap: 3px;
      pointer-events: none;
      z-index: 110;
    }
    .weapon-hud-item {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 22px;
      opacity: 0.5;
      transition: opacity 0.15s;
    }
    .weapon-hud-item.active {
      opacity: 1.0;
    }
    .weapon-hud-icon {
      width: 20px;
      height: 20px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #000;
      border: 1px solid transparent;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .weapon-hud-item.active .weapon-hud-icon {
      border-color: #ffffff;
      box-shadow: 0 0 6px currentColor;
    }
    .weapon-hud-ammo {
      font-size: 10px;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #aaaacc;
      min-width: 24px;
      text-shadow: 0 0 4px rgba(100, 100, 200, 0.5);
    }
    .weapon-hud-name {
      font-size: 9px;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #888888;
      letter-spacing: 0.5px;
      white-space: nowrap;
      display: none;
    }
    .weapon-hud-item.active .weapon-hud-name {
      display: inline;
    }
  `;
  document.head.appendChild(style);
}

export class WeaponHUD {
  private container: HTMLDivElement;
  private items: Map<WeaponType, HTMLDivElement> = new Map();
  private lastActiveType: WeaponType = WeaponType.Standard;

  constructor() {
    injectStyles();

    this.container = document.createElement('div');
    this.container.className = 'weapon-hud';
    document.body.appendChild(this.container);
  }

  /**
   * Set the position of the HUD within the viewport.
   * Called once for single-player, or per-viewport for split-screen.
   */
  setPosition(x: number, y: number): void {
    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
  }

  /**
   * Update the HUD to reflect the current inventory.
   * Rebuilds DOM only when inventory composition changes.
   */
  update(inventory: WeaponInventoryEntry[], activeWeapon: WeaponType): void {
    // Check if inventory composition changed (types added/removed)
    const currentTypes = new Set(this.items.keys());
    const newTypes = new Set(inventory.map(e => e.type));
    const needsRebuild =
      currentTypes.size !== newTypes.size ||
      [...newTypes].some(t => !currentTypes.has(t));

    if (needsRebuild) {
      this.rebuild(inventory);
    }

    // Update each item's state
    for (const entry of inventory) {
      const item = this.items.get(entry.type);
      if (!item) continue;

      // Active state
      const isActive = entry.type === activeWeapon;
      item.classList.toggle('active', isActive);

      // Ammo text
      const ammoEl = item.querySelector('.weapon-hud-ammo') as HTMLElement;
      if (ammoEl) {
        if (entry.ammo < 0) {
          ammoEl.textContent = 'INF';
        } else {
          ammoEl.textContent = String(entry.ammo);
          // Flash red when low ammo
          if (entry.ammo <= 10 && entry.ammo > 0) {
            ammoEl.style.color = '#ff4444';
          } else {
            ammoEl.style.color = '#aaaacc';
          }
        }
      }

      // Stack indicator (show dots for stacks > 1)
      const iconEl = item.querySelector('.weapon-hud-icon') as HTMLElement;
      if (iconEl && entry.stacks > 1) {
        const stackDots = '\u2022'.repeat(Math.min(entry.stacks, 5));
        const symbolEl = iconEl.querySelector('.icon-symbol') as HTMLElement;
        const stackEl = iconEl.querySelector('.icon-stacks') as HTMLElement;
        if (stackEl) {
          stackEl.textContent = stackDots;
        }
      }
    }

    this.lastActiveType = activeWeapon;
  }

  private rebuild(inventory: WeaponInventoryEntry[]): void {
    this.container.innerHTML = '';
    this.items.clear();

    for (const entry of inventory) {
      const config = WEAPON_CONFIGS[entry.type];
      const colorHex = `#${config.color.toString(16).padStart(6, '0')}`;

      const item = document.createElement('div');
      item.className = 'weapon-hud-item';

      const icon = document.createElement('div');
      icon.className = 'weapon-hud-icon';
      icon.style.backgroundColor = colorHex;
      icon.style.color = this.getContrastColor(config.color);
      icon.innerHTML = `<span class="icon-symbol">${WEAPON_SYMBOLS[entry.type]}</span><span class="icon-stacks" style="font-size:6px;position:absolute;bottom:-1px;right:0px;color:${colorHex}"></span>`;
      icon.style.position = 'relative';

      const ammo = document.createElement('span');
      ammo.className = 'weapon-hud-ammo';

      const name = document.createElement('span');
      name.className = 'weapon-hud-name';
      name.textContent = config.name;

      item.appendChild(icon);
      item.appendChild(ammo);
      item.appendChild(name);
      this.container.appendChild(item);
      this.items.set(entry.type, item);
    }
  }

  /** Pick black or white text based on background brightness */
  private getContrastColor(hexColor: number): string {
    const r = (hexColor >> 16) & 0xff;
    const g = (hexColor >> 8) & 0xff;
    const b = hexColor & 0xff;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  /**
   * Show a brief banner notifying the player that a weapon was added to inventory
   * without switching to it (because they already have a special weapon active).
   * The banner fades out automatically after 2.5 seconds.
   */
  showPickupNotification(weaponName: string): void {
    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:18%',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.82)',
      'border:1px solid #555',
      'color:#eee',
      "font-family:'Segoe UI',Arial,sans-serif",
      'font-size:13px',
      'padding:6px 16px',
      'border-radius:4px',
      'pointer-events:none',
      'z-index:500',
      'transition:opacity 0.8s',
      'opacity:1',
      'white-space:nowrap',
      'letter-spacing:0.5px',
    ].join(';');
    banner.textContent = `${weaponName} added to inventory  \u2022  [E] to cycle`;
    document.body.appendChild(banner);

    // Fade out after 2 s, remove after 0.8 s fade
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 800);
    }, 2000);
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
