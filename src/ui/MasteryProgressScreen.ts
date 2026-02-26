/**
 * Between-game Mastery Progress Screen.
 *
 * Shown after the analytics panel closes, before the page reloads.
 * Displays per-weapon XP earned this game, level-ups with celebrations,
 * and passive bonuses unlocked. Skippable with Enter/Space/click.
 */

import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import type { MasteryXPResult } from '../systems/MasteryStore';
import { XP_THRESHOLDS } from '../systems/MasteryStore';
import { getSoundEngine } from '../audio/SoundEngine';
import { t } from '../i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MasteryScreenData {
  results: MasteryXPResult[];
  allLevels: Map<WeaponType, number>;
  /** Optional: used to generate bonus descriptions (injected from MasteryStore) */
  getBonusDescription?: (weapon: WeaponType, level: number) => string;
}

// ── Weapon symbols (matches WeaponHUD) ────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute 0–100 progress percentage within a mastery level range. */
function levelProgress(xp: number, level: number): number {
  const lo = XP_THRESHOLDS[level] ?? 0;
  const hi = level < 5 ? XP_THRESHOLDS[level + 1] : lo;
  if (hi === lo) return 100; // max level
  return Math.min(100, Math.max(0, ((xp - lo) / (hi - lo)) * 100));
}

/** Convert a hex number colour to a CSS hex string. */
function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    #mastery-progress-screen {
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(5, 0, 25, 0.95);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 4000;
      font-family: 'Segoe UI', Arial, sans-serif;
      opacity: 0;
      transition: opacity 0.3s ease;
      backdrop-filter: blur(8px);
      overflow-y: auto;
    }

    #mastery-progress-screen.visible {
      opacity: 1;
    }

    #mastery-progress-screen.hidden {
      display: none !important;
    }

    .mastery-content {
      text-align: center;
      width: min(560px, 90vw);
      padding: 32px 0 24px;
    }

    .mastery-title {
      font-size: 42px;
      font-weight: 900;
      letter-spacing: 6px;
      text-transform: uppercase;
      color: #cc88ff;
      text-shadow:
        0 0 10px #aa44ff,
        0 0 30px #8800ff,
        0 0 60px #6600cc;
      margin: 0 0 4px;
    }

    .mastery-subtitle {
      font-size: 14px;
      letter-spacing: 4px;
      color: #7755aa;
      margin: 0 0 32px;
    }

    .mastery-weapons {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-bottom: 32px;
    }

    .mastery-weapon-row {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      padding: 10px 14px;
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }

    .mastery-weapon-row.appeared {
      opacity: 1;
      transform: translateY(0);
    }

    .mastery-weapon-row.levelup {
      background: rgba(255, 200, 0, 0.07);
      border: 1px solid rgba(255, 200, 0, 0.2);
      animation: masteryGoldShimmer 1.5s ease infinite;
    }

    @keyframes masteryGoldShimmer {
      0%, 100% { box-shadow: 0 0 6px rgba(255,200,0,0.2); }
      50%       { box-shadow: 0 0 18px rgba(255,200,0,0.5); }
    }

    .mastery-weapon-icon {
      width: 32px;
      height: 32px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      color: #000;
      flex-shrink: 0;
    }

    .mastery-weapon-info {
      flex: 1;
      min-width: 0;
    }

    .mastery-weapon-name-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 5px;
    }

    .mastery-weapon-name {
      font-size: 13px;
      font-weight: 600;
      color: #ddd;
      letter-spacing: 1px;
    }

    .mastery-level-badge {
      font-size: 11px;
      font-weight: 700;
      color: #888;
      letter-spacing: 1px;
    }

    .mastery-level-badge.levelup {
      color: #ffcc00;
      text-shadow: 0 0 8px #ffaa00;
      animation: masteryLevelPulse 0.6s ease;
    }

    @keyframes masteryLevelPulse {
      0%   { transform: scale(1.0); }
      40%  { transform: scale(1.5); color: #fff; }
      100% { transform: scale(1.0); }
    }

    .mastery-xp-bar-bg {
      height: 8px;
      border-radius: 4px;
      background: rgba(255,255,255,0.08);
      overflow: hidden;
      position: relative;
    }

    .mastery-xp-bar-fill {
      height: 100%;
      border-radius: 4px;
      width: 0%;
      transition: width 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .mastery-unlock-row {
      margin-top: 5px;
      font-size: 11px;
      color: #ffcc00;
      letter-spacing: 1px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .mastery-unlock-row.visible {
      opacity: 1;
    }

    .mastery-unlock-label {
      font-weight: 700;
      color: #ffaa33;
      text-transform: uppercase;
    }

    .mastery-continue-btn {
      background: transparent;
      border: 2px solid #8844cc;
      color: #cc88ff;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 4px;
      text-transform: uppercase;
      padding: 12px 40px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
      opacity: 0;
      transition: opacity 0.3s ease, background 0.2s, border-color 0.2s, box-shadow 0.2s;
    }

    .mastery-continue-btn.visible {
      opacity: 1;
    }

    .mastery-continue-btn:hover {
      background: rgba(136, 68, 204, 0.25);
      border-color: #cc88ff;
      box-shadow: 0 0 16px rgba(170, 68, 255, 0.4);
    }

    .mastery-continue-hint {
      font-size: 11px;
      color: #443366;
      letter-spacing: 2px;
      margin-top: 8px;
    }
  `;
  document.head.appendChild(style);
}

// ── MasteryProgressScreen ─────────────────────────────────────────────────────

export class MasteryProgressScreen {
  private container: HTMLDivElement;
  private onContinueCallback: (() => void) | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private animationTimers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    injectStyles();
    this.container = document.createElement('div');
    this.container.id = 'mastery-progress-screen';
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
  }

  show(data: MasteryScreenData, onContinue: () => void): void {
    this.onContinueCallback = onContinue;

    // Filter to weapons that earned any XP this game
    const activeResults = data.results.filter(r => r.xpAfter > r.xpBefore);

    // Level-up weapons first, then sorted by xp gained descending
    const sorted = [...activeResults].sort((a, b) => {
      if (a.leveledUp && !b.leveledUp) return -1;
      if (!a.leveledUp && b.leveledUp) return 1;
      return (b.xpAfter - b.xpBefore) - (a.xpAfter - a.xpBefore);
    });

    const hasLevelUp = sorted.some(r => r.leveledUp);

    this.container.innerHTML = '';
    this.container.classList.remove('hidden');

    // Build DOM
    const content = document.createElement('div');
    content.className = 'mastery-content';

    const title = document.createElement('h1');
    title.className = 'mastery-title';
    title.textContent = t('mastery.title');
    content.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'mastery-subtitle';
    subtitle.textContent = t('mastery.subtitle');
    content.appendChild(subtitle);

    const weaponList = document.createElement('div');
    weaponList.className = 'mastery-weapons';

    // Build weapon rows (hidden initially for stagger animation)
    const rows: Array<{
      row: HTMLDivElement;
      fillEl: HTMLDivElement;
      badgeEl: HTMLSpanElement;
      unlockEl: HTMLDivElement;
      result: MasteryXPResult;
    }> = [];

    for (const result of sorted) {
      const cfg = WEAPON_CONFIGS[result.weaponType];
      const cssColor = hexToCss(cfg.color);

      const row = document.createElement('div');
      row.className = `mastery-weapon-row${result.leveledUp ? ' levelup' : ''}`;

      // Icon
      const icon = document.createElement('div');
      icon.className = 'mastery-weapon-icon';
      icon.style.background = cssColor;
      icon.style.boxShadow = `0 0 8px ${cssColor}66`;
      icon.textContent = WEAPON_SYMBOLS[result.weaponType];
      row.appendChild(icon);

      // Info block
      const info = document.createElement('div');
      info.className = 'mastery-weapon-info';

      // Name row
      const nameRow = document.createElement('div');
      nameRow.className = 'mastery-weapon-name-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'mastery-weapon-name';
      nameEl.textContent = cfg.name;
      nameRow.appendChild(nameEl);

      const badgeEl = document.createElement('span');
      badgeEl.className = `mastery-level-badge${result.leveledUp ? ' levelup' : ''}`;
      const currentLevel = data.allLevels.get(result.weaponType) ?? result.levelAfter;
      badgeEl.textContent = t('mastery.levelBadge', { level: currentLevel });
      nameRow.appendChild(badgeEl);

      info.appendChild(nameRow);

      // XP bar
      const barBg = document.createElement('div');
      barBg.className = 'mastery-xp-bar-bg';

      const fillEl = document.createElement('div');
      fillEl.className = 'mastery-xp-bar-fill';
      fillEl.style.background = result.leveledUp
        ? 'linear-gradient(90deg, #cc8800, #ffcc00)'
        : `linear-gradient(90deg, ${cssColor}99, ${cssColor})`;

      // Start fill at xpBefore position
      const startPct = levelProgress(result.xpBefore, result.levelBefore);
      fillEl.style.width = `${startPct}%`;

      barBg.appendChild(fillEl);
      info.appendChild(barBg);

      // Unlock text (shown after bar fills if leveled up)
      const unlockEl = document.createElement('div');
      unlockEl.className = 'mastery-unlock-row';
      if (result.leveledUp && data.getBonusDescription) {
        const desc = data.getBonusDescription(result.weaponType, result.levelAfter);
        if (desc) {
          unlockEl.innerHTML = `<span class="mastery-unlock-label">${t('mastery.newPassiveUnlocked')}</span> — ${desc}`;
        }
      }
      info.appendChild(unlockEl);

      row.appendChild(info);
      weaponList.appendChild(row);

      rows.push({ row, fillEl, badgeEl, unlockEl, result });
    }

    content.appendChild(weaponList);

    // Continue button
    const btnWrap = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'mastery-continue-btn';
    btn.textContent = t('mastery.continueBtn');
    btn.addEventListener('click', () => this._continue());
    btnWrap.appendChild(btn);

    const hint = document.createElement('div');
    hint.className = 'mastery-continue-hint';
    hint.textContent = t('mastery.continueHint');
    btnWrap.appendChild(hint);

    content.appendChild(btnWrap);
    this.container.appendChild(content);

    // Keyboard handler (active immediately so impatient players can skip)
    this.keyListener = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._continue();
      }
    };
    window.addEventListener('keydown', this.keyListener);

    // Click on overlay = continue
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container || e.target === content) {
        this._continue();
      }
    });

    // Fade in
    requestAnimationFrame(() => {
      this.container.classList.add('visible');
    });

    // Play level-up sound if any weapon leveled up
    if (hasLevelUp) {
      const t = this._schedule(() => {
        try { getSoundEngine().play('weaponPickup', { pitch: 1.8 }); } catch { /* ok */ }
      }, 400);
      this.animationTimers.push(t);
    }

    // Stagger weapon rows appearing
    rows.forEach(({ row, fillEl, unlockEl, result }, i) => {
      const appearDelay = 150 + i * 150;
      const barDelay = appearDelay + 100;
      const unlockDelay = barDelay + 550; // after bar fills

      this.animationTimers.push(this._schedule(() => {
        row.classList.add('appeared');
      }, appearDelay));

      this.animationTimers.push(this._schedule(() => {
        const endPct = levelProgress(result.xpAfter, result.levelAfter);
        fillEl.style.width = `${endPct}%`;
      }, barDelay));

      if (result.leveledUp && unlockEl.textContent) {
        this.animationTimers.push(this._schedule(() => {
          unlockEl.classList.add('visible');
        }, unlockDelay));
      }
    });

    // Show continue button after all animations
    const totalAnimTime = rows.length > 0
      ? 150 + (rows.length - 1) * 150 + 100 + 600
      : 0;
    const btnDelay = Math.max(300, totalAnimTime + 200);

    this.animationTimers.push(this._schedule(() => {
      btn.classList.add('visible');
    }, btnDelay));
  }

  hide(): void {
    this.container.classList.remove('visible');
    this.container.classList.add('hidden');
    this._cleanup();
  }

  dispose(): void {
    this._cleanup();
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _continue(): void {
    if (!this.onContinueCallback) return;
    const cb = this.onContinueCallback;
    this.onContinueCallback = null; // prevent double-fire
    this._cleanup();
    this.container.classList.remove('visible');
    cb();
  }

  private _cleanup(): void {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
    for (const t of this.animationTimers) clearTimeout(t);
    this.animationTimers.length = 0;
  }

  private _schedule(fn: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(fn, delayMs);
  }
}
