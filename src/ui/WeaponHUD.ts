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

const TIER_ROMAN = ['', 'I', 'II', 'III'] as const;

/** Mastery progress data shape (matches WeaponMasteryManager.getProgress() return) */
export interface MasteryProgressEntry {
  kills: number;
  tier: number;
  nextThreshold: number | null;
}

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
      flex-direction: column;
      gap: 1px;
      opacity: 0.5;
      transition: opacity 0.15s;
    }
    .weapon-hud-item.active {
      opacity: 1.0;
    }
    .weapon-hud-main-row {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 22px;
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
    .weapon-hud-mastery {
      display: none;
      align-items: center;
      gap: 3px;
      padding-left: 2px;
      height: 9px;
    }
    .weapon-hud-item.active .weapon-hud-mastery.visible {
      display: flex;
    }
    .weapon-hud-mastery-bar-bg {
      width: 60px;
      height: 3px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .weapon-hud-mastery-bar-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .weapon-hud-mastery-tier {
      font-size: 8px;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-weight: bold;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .weapon-hud-mastered {
      font-size: 8px;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-weight: bold;
      letter-spacing: 1.5px;
      text-shadow: 0 0 6px currentColor;
      white-space: nowrap;
    }
    .weapon-hud-session-level {
      display: none;
      font-size: 9px;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-weight: bold;
      letter-spacing: 0.5px;
      white-space: nowrap;
      opacity: 0.7;
    }
    .weapon-hud-item.active .weapon-hud-session-level.visible {
      display: inline;
    }
    .weapon-hud-persistent-stars {
      display: none;
      font-size: 9px;
      letter-spacing: 1px;
      color: #ffd700;
      text-shadow: 0 0 4px #ffd700;
      white-space: nowrap;
    }
    .weapon-hud-item.active .weapon-hud-persistent-stars.visible {
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
   *
   * @param masteryProgress Optional per-weapon mastery progress map.
   *   Key is WeaponType; value comes from WeaponMasteryManager.getProgress().
   *   Only the active weapon's mastery bar is rendered.
   * @param sessionLevels Optional per-weapon session pickup counts.
   *   Shows a compact "Lv.N" badge for the active weapon at level ≥ 2.
   * @param persistentLevels Optional per-weapon cross-game mastery levels (0-5).
   *   Shows gold stars (★) for weapons with persistent mastery.
   */
  update(
    inventory: WeaponInventoryEntry[],
    activeWeapon: WeaponType,
    masteryProgress?: Map<WeaponType, MasteryProgressEntry>,
    sessionLevels?: Map<WeaponType, number>,
    persistentLevels?: Map<WeaponType, number>,
  ): void {
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
        const stackEl = iconEl.querySelector('.icon-stacks') as HTMLElement;
        if (stackEl) {
          stackEl.textContent = '\u2022'.repeat(Math.min(entry.stacks, 5));
        }
      }

      // Mastery bar — only update for active weapon
      if (isActive && masteryProgress) {
        this.updateMasteryBar(item, entry.type, masteryProgress.get(entry.type));
      } else if (!isActive) {
        // Ensure mastery row is hidden for inactive weapons
        const masteryRow = item.querySelector('.weapon-hud-mastery') as HTMLElement;
        if (masteryRow) masteryRow.classList.remove('visible');
      }

      // Session level badge — only show for active weapon at level ≥ 2
      const sessionBadge = item.querySelector('.weapon-hud-session-level') as HTMLElement;
      if (sessionBadge) {
        if (isActive && sessionLevels) {
          const level = sessionLevels.get(entry.type) ?? 0;
          if (level >= 2) {
            sessionBadge.textContent = `Lv.${level}`;
            sessionBadge.classList.add('visible');
          } else {
            sessionBadge.classList.remove('visible');
          }
        } else if (!isActive) {
          sessionBadge.classList.remove('visible');
        }
      }

      // Persistent mastery stars — gold stars for cross-game mastery level ≥ 1
      const starsEl = item.querySelector('.weapon-hud-persistent-stars') as HTMLElement;
      if (starsEl) {
        if (isActive && persistentLevels) {
          const mastLevel = persistentLevels.get(entry.type) ?? 0;
          if (mastLevel >= 1) {
            const filled = '★'.repeat(mastLevel);
            const empty = '☆'.repeat(5 - mastLevel);
            starsEl.textContent = filled + empty;
            starsEl.classList.add('visible');
          } else {
            starsEl.classList.remove('visible');
          }
        } else if (!isActive) {
          starsEl.classList.remove('visible');
        }
      }
    }

    this.lastActiveType = activeWeapon;
  }

  private updateMasteryBar(
    item: HTMLElement,
    weaponType: WeaponType,
    progress: MasteryProgressEntry | undefined,
  ): void {
    const masteryRow = item.querySelector('.weapon-hud-mastery') as HTMLElement;
    if (!masteryRow) return;

    // No progress data or zero kills at tier 0 → hide
    if (!progress || (progress.kills === 0 && progress.tier === 0)) {
      masteryRow.classList.remove('visible');
      return;
    }

    const config = WEAPON_CONFIGS[weaponType];
    const colorHex = `#${config.color.toString(16).padStart(6, '0')}`;
    masteryRow.classList.add('visible');

    if (progress.tier >= 3) {
      // Mastered — show "MASTERED" text, hide bar
      const barBg = masteryRow.querySelector('.weapon-hud-mastery-bar-bg') as HTMLElement;
      const masteredEl = masteryRow.querySelector('.weapon-hud-mastered') as HTMLElement;
      const tierLabel = masteryRow.querySelector('.weapon-hud-mastery-tier') as HTMLElement;
      if (barBg) barBg.style.display = 'none';
      if (tierLabel) tierLabel.style.display = 'none';
      if (masteredEl) {
        masteredEl.style.display = 'inline';
        masteredEl.style.color = colorHex;
      }
    } else {
      // Normal progress — fill bar and update tier label
      const barBg = masteryRow.querySelector('.weapon-hud-mastery-bar-bg') as HTMLElement;
      const barFill = masteryRow.querySelector('.weapon-hud-mastery-bar-fill') as HTMLElement;
      const tierLabel = masteryRow.querySelector('.weapon-hud-mastery-tier') as HTMLElement;
      const masteredEl = masteryRow.querySelector('.weapon-hud-mastered') as HTMLElement;

      if (barBg) barBg.style.display = '';
      if (masteredEl) masteredEl.style.display = 'none';

      if (barFill) {
        const pct =
          progress.nextThreshold && progress.nextThreshold > 0
            ? Math.min((progress.kills / progress.nextThreshold) * 100, 100)
            : 0;
        barFill.style.width = `${pct}%`;
        barFill.style.backgroundColor = colorHex;
      }

      if (tierLabel) {
        tierLabel.style.color = colorHex;
        tierLabel.textContent = TIER_ROMAN[progress.tier] ?? '';
      }
    }
  }

  private rebuild(inventory: WeaponInventoryEntry[]): void {
    this.container.innerHTML = '';
    this.items.clear();

    for (const entry of inventory) {
      const config = WEAPON_CONFIGS[entry.type];
      const colorHex = `#${config.color.toString(16).padStart(6, '0')}`;

      const item = document.createElement('div');
      item.className = 'weapon-hud-item';

      // -- Main row: icon + ammo + name --
      const mainRow = document.createElement('div');
      mainRow.className = 'weapon-hud-main-row';

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

      const sessionLevel = document.createElement('span');
      sessionLevel.className = 'weapon-hud-session-level';
      sessionLevel.style.color = colorHex;

      const persistentStars = document.createElement('span');
      persistentStars.className = 'weapon-hud-persistent-stars';

      mainRow.appendChild(icon);
      mainRow.appendChild(ammo);
      mainRow.appendChild(name);
      mainRow.appendChild(sessionLevel);
      mainRow.appendChild(persistentStars);

      // -- Mastery row: bar + tier label (hidden until mastery data available) --
      const masteryRow = document.createElement('div');
      masteryRow.className = 'weapon-hud-mastery';

      const barBg = document.createElement('div');
      barBg.className = 'weapon-hud-mastery-bar-bg';
      const barFill = document.createElement('div');
      barFill.className = 'weapon-hud-mastery-bar-fill';
      barFill.style.width = '0%';
      barFill.style.backgroundColor = colorHex;
      barBg.appendChild(barFill);

      const tierLabel = document.createElement('span');
      tierLabel.className = 'weapon-hud-mastery-tier';
      tierLabel.style.color = colorHex;

      const masteredEl = document.createElement('span');
      masteredEl.className = 'weapon-hud-mastered';
      masteredEl.textContent = 'MASTERED';
      masteredEl.style.color = colorHex;
      masteredEl.style.display = 'none';

      masteryRow.appendChild(barBg);
      masteryRow.appendChild(tierLabel);
      masteryRow.appendChild(masteredEl);

      item.appendChild(mainRow);
      item.appendChild(masteryRow);
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
   * Show a brief banner notification.
   * Used for: weapon added to inventory, and session level-up toasts.
   * The message is displayed as-is. The banner fades out automatically after 2.5 seconds.
   */
  showPickupNotification(message: string): void {
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
    banner.textContent = message;
    document.body.appendChild(banner);

    // Fade out after 2 s, remove after 0.8 s fade
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 800);
    }, 2000);
  }

  /**
   * Show a dramatic tier-up toast when weapon mastery advances.
   * Called from Phase 3 integration when WeaponMasteryManager fires onMasteryTierUp.
   *
   * @param weaponName  Display name of the weapon (e.g. "Blaster")
   * @param tier        New mastery tier (1, 2, or 3)
   * @param buffName    Name of the buff unlocked at this tier
   */
  showMasteryTierUp(weaponName: string, tier: number, buffName: string): void {
    // Look up weapon color by name for the glow effect
    const weaponColor = this.findWeaponColor(weaponName);
    const tierLabel = tier >= 3 ? 'MAX' : TIER_ROMAN[tier] ?? String(tier);
    const titleText = `${weaponName.toUpperCase()} MASTERY ${tierLabel}`;
    const subText = `${buffName} unlocked!`;

    const toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:30%',
      'transform:translateX(-50%) scale(0.8)',
      'background:rgba(0,0,0,0.88)',
      `border:1px solid ${weaponColor}`,
      `box-shadow:0 0 20px ${weaponColor}, 0 0 40px rgba(0,0,0,0.6)`,
      'color:#fff',
      "font-family:'Segoe UI',Arial,sans-serif",
      'padding:12px 28px',
      'border-radius:6px',
      'pointer-events:none',
      'z-index:600',
      'text-align:center',
      'transition:transform 0.2s ease, opacity 0.5s ease',
      'opacity:0',
      'white-space:nowrap',
    ].join(';');

    const titleEl = document.createElement('div');
    titleEl.style.cssText = [
      'font-size:16px',
      'font-weight:bold',
      'letter-spacing:2px',
      `color:${weaponColor}`,
      `text-shadow:0 0 10px ${weaponColor}`,
    ].join(';');
    titleEl.textContent = titleText;

    const subEl = document.createElement('div');
    subEl.style.cssText = [
      'font-size:11px',
      'letter-spacing:1px',
      'color:#cccccc',
      'margin-top:4px',
    ].join(';');
    subEl.textContent = subText;

    toast.appendChild(titleEl);
    toast.appendChild(subEl);
    document.body.appendChild(toast);

    // Animate in: scale 0.8→1.0, opacity 0→1
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) scale(1)';
      toast.style.opacity = '1';
    });

    // Fade out after 2.5 s, remove after 0.5 s fade
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) scale(0.95)';
      setTimeout(() => toast.remove(), 500);
    }, 2500);
  }

  /** Look up a weapon's color hex string by display name. Falls back to white. */
  private findWeaponColor(weaponName: string): string {
    const lower = weaponName.toLowerCase();
    for (const config of Object.values(WEAPON_CONFIGS)) {
      if (config.name.toLowerCase() === lower) {
        return `#${config.color.toString(16).padStart(6, '0')}`;
      }
    }
    return '#ffffff';
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
