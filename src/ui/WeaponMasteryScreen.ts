/**
 * Weapon Mastery Screen — full-screen overlay showing each weapon's
 * progression tree (Lv0→Lv5), passive bonuses, active effects, and
 * the player's current mastery progress loaded from MasteryStore.
 *
 * Accessible from the main menu via a "WEAPON MASTERY" button.
 */

import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import { MasteryStore, XP_THRESHOLDS } from '../systems/MasteryStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

// ── Weapon symbols ────────────────────────────────────────────────────────────

const WEAPON_SYMBOLS: Record<WeaponType, string> = {
  [WeaponType.Standard]: '\u2022\u2022\u2022',
  [WeaponType.Spread]: '\u2234',
  [WeaponType.Piercing]: '\u2501\u2501\u25B6',
  [WeaponType.ChainLightning]: '\u26A1',
  [WeaponType.Homing]: '\u2316',
  [WeaponType.PlasmaMortar]: '\u25C9',
  [WeaponType.GravityGun]: '\u2B59',
  [WeaponType.LaserBeam]: '\u2550\u2550\u2550',
  [WeaponType.BlackHole]: '\u25CF',
  [WeaponType.TeslaCoil]: '\u2607',
};

// ── Active effects (tactical descriptions from WeaponWiki) ────────────────────

const WEAPON_ACTIVE: Record<WeaponType, string> = {
  [WeaponType.Standard]:
    'Rapid-fire energy bolts. Unlimited ammo — your reliable fallback weapon.',
  [WeaponType.Spread]:
    'Fires 5 projectiles in a wide fan. Devastating against clustered enemies.',
  [WeaponType.Piercing]:
    'Instant geodesic ray that penetrates every enemy in its path.',
  [WeaponType.ChainLightning]:
    'Strikes nearest enemy then arcs to up to 5 additional targets (75% falloff).',
  [WeaponType.Homing]:
    'Lock-on missiles that pursue the nearest enemy across the surface.',
  [WeaponType.PlasmaMortar]:
    'Slow-moving orb with massive AoE explosion on impact. Highest single-hit damage.',
  [WeaponType.GravityGun]:
    'Vortex projectile that pulls nearby enemies toward its center.',
  [WeaponType.LaserBeam]:
    'Continuous sustained beam. Hold fire to sweep across enemy groups.',
  [WeaponType.BlackHole]:
    'Singularity that destroys everything on contact (999 dmg). Only 6 shots.',
  [WeaponType.TeslaCoil]:
    'Electromagnetic field that continuously damages all nearby enemies. No aiming needed.',
};

// ── Passive bonus labels per level ────────────────────────────────────────────

/**
 * Returns short passive bonus text for a given weapon at a given level (0–5).
 * Level 0 = no bonus. Level 5 = special bonus (pulled from BONUS_TABLE via store).
 */
function buildMilestoneLabel(store: MasteryStore, weapon: WeaponType, level: number): string {
  if (level === 0) return 'Base weapon — no mastery bonus';
  const desc = store.getBonusDescription(weapon, level);
  // getBonusDescription returns e.g. "Blaster: +20% damage always"
  // Strip the weapon name prefix for brevity
  const colon = desc.indexOf(': ');
  return colon >= 0 ? desc.slice(colon + 2) : desc;
}

// ── Style injection ───────────────────────────────────────────────────────────

let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'weapon-mastery-screen-styles';
  style.textContent = `
    /* ── Root overlay ── */
    #weapon-mastery-screen {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0, 0, 20, 0.92);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      z-index: 2500;
      font-family: 'Segoe UI', Arial, sans-serif;
      backdrop-filter: blur(8px);
      overflow-y: auto;
    }
    #weapon-mastery-screen.hidden { display: none; }

    /* ── Scroll container ── */
    #weapon-mastery-screen .wms-content {
      max-width: 900px;
      width: 100%;
      padding: 40px 30px 80px;
    }

    /* ── Header ── */
    #weapon-mastery-screen .wms-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    #weapon-mastery-screen .wms-title {
      color: #cc88ff;
      font-size: 36px;
      font-weight: bold;
      letter-spacing: 6px;
      text-shadow:
        0 0 10px #aa44ff,
        0 0 24px rgba(180, 100, 255, 0.5);
      margin: 0;
    }
    #weapon-mastery-screen .wms-subtitle {
      color: #8866aa;
      font-size: 12px;
      letter-spacing: 3px;
      margin-bottom: 30px;
    }
    #weapon-mastery-screen .wms-close {
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
      flex-shrink: 0;
    }
    #weapon-mastery-screen .wms-close:hover {
      border-color: #ff4444;
      color: #ff4444;
      box-shadow: 0 0 12px #ff4444;
    }

    /* ── Weapon grid ── */
    #weapon-mastery-screen .wms-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    @media (max-width: 680px) {
      #weapon-mastery-screen .wms-grid {
        grid-template-columns: 1fr;
      }
    }

    /* ── Weapon card ── */
    #weapon-mastery-screen .wms-card {
      background: rgba(10, 10, 30, 0.85);
      border: 1px solid var(--wc, #666);
      padding: 18px;
      cursor: pointer;
      transition: box-shadow 0.2s, border-color 0.2s;
      position: relative;
    }
    #weapon-mastery-screen .wms-card:hover {
      box-shadow: 0 0 18px var(--wc, #666);
      border-width: 2px;
      padding: 17px;
    }
    #weapon-mastery-screen .wms-card.expanded {
      border-width: 2px;
      padding: 17px;
      box-shadow: 0 0 22px var(--wc, #666), inset 0 0 30px rgba(0,0,0,0.3);
    }

    /* ── Card header row ── */
    #weapon-mastery-screen .wms-card-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    #weapon-mastery-screen .wms-swatch {
      width: 26px;
      height: 26px;
      border-radius: 4px;
      flex-shrink: 0;
      box-shadow: 0 0 8px var(--wc, #666);
    }
    #weapon-mastery-screen .wms-weapon-name {
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 2px;
      color: var(--wc, #fff);
      text-shadow: 0 0 8px var(--wc, #fff);
      flex: 1;
    }
    #weapon-mastery-screen .wms-level-badge {
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 1px;
      color: #ffdd88;
      background: rgba(255, 200, 50, 0.12);
      border: 1px solid rgba(255, 200, 50, 0.35);
      padding: 3px 8px;
      flex-shrink: 0;
    }

    /* ── XP bar ── */
    #weapon-mastery-screen .wms-xp-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    #weapon-mastery-screen .wms-xp-label {
      color: #777788;
      font-size: 10px;
      letter-spacing: 1px;
      width: 22px;
      flex-shrink: 0;
    }
    #weapon-mastery-screen .wms-xp-bg {
      flex: 1;
      height: 6px;
      background: rgba(40, 40, 60, 0.9);
      border-radius: 3px;
      overflow: hidden;
    }
    #weapon-mastery-screen .wms-xp-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--wc, #888);
      width: 0%;
      transition: width 0.5s ease-out;
    }
    #weapon-mastery-screen .wms-xp-val {
      color: #9999aa;
      font-size: 10px;
      width: 52px;
      text-align: right;
      flex-shrink: 0;
    }

    /* ── Active effect summary (always visible) ── */
    #weapon-mastery-screen .wms-active-desc {
      color: #8899aa;
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 8px;
    }

    /* ── Expand hint ── */
    #weapon-mastery-screen .wms-expand-hint {
      color: #555566;
      font-size: 10px;
      letter-spacing: 1px;
      text-align: right;
    }

    /* ── Expanded section ── */
    #weapon-mastery-screen .wms-expanded-section {
      margin-top: 14px;
      border-top: 1px solid rgba(255,255,255,0.06);
      padding-top: 14px;
      display: none;
    }
    #weapon-mastery-screen .wms-card.expanded .wms-expanded-section {
      display: block;
    }

    /* ── Milestone chain ── */
    #weapon-mastery-screen .wms-milestone-label {
      color: #9988bb;
      font-size: 10px;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    #weapon-mastery-screen .wms-milestones {
      display: flex;
      align-items: flex-start;
      gap: 0;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    /* ── Milestone node + connector ── */
    #weapon-mastery-screen .wms-ms-slot {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
    }
    #weapon-mastery-screen .wms-ms-node-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
    }
    #weapon-mastery-screen .wms-ms-node {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      border: 2px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.2);
      position: relative;
    }
    #weapon-mastery-screen .wms-ms-node.unlocked {
      border-color: var(--wc, #888);
      background: rgba(0,0,0,0.5);
      color: var(--wc, #888);
      box-shadow: 0 0 8px var(--wc, #888);
    }
    #weapon-mastery-screen .wms-ms-node.current {
      border-color: var(--wc, #888);
      background: rgba(0,0,0,0.5);
      color: var(--wc, #888);
      box-shadow: 0 0 12px var(--wc, #888), 0 0 24px var(--wc, #888);
      animation: wms-pulse 2s ease-in-out infinite;
    }
    #weapon-mastery-screen .wms-ms-node.gold {
      border-color: #ffdd44;
      background: rgba(255, 210, 20, 0.1);
      color: #ffdd44;
      box-shadow: 0 0 12px #ffcc00, 0 0 28px rgba(255,200,0,0.4);
    }
    @keyframes wms-pulse {
      0%, 100% { box-shadow: 0 0 10px var(--wc, #888), 0 0 22px var(--wc, #888); }
      50%       { box-shadow: 0 0 18px var(--wc, #888), 0 0 40px var(--wc, #888); }
    }
    @keyframes wms-gold-shimmer {
      0%, 100% { box-shadow: 0 0 12px #ffcc00, 0 0 28px rgba(255,200,0,0.4); }
      50%       { box-shadow: 0 0 22px #ffee44, 0 0 50px rgba(255,220,0,0.6); }
    }
    #weapon-mastery-screen .wms-ms-node.gold {
      animation: wms-gold-shimmer 2.5s ease-in-out infinite;
    }

    #weapon-mastery-screen .wms-ms-node-label {
      font-size: 9px;
      color: rgba(255,255,255,0.25);
      letter-spacing: 0.5px;
      margin-top: 3px;
      text-align: center;
      max-width: 56px;
      line-height: 1.3;
    }
    #weapon-mastery-screen .wms-ms-node-label.unlocked {
      color: rgba(255,255,255,0.55);
    }
    #weapon-mastery-screen .wms-ms-node-label.gold {
      color: #ffdd88;
    }

    /* ── Connector line between nodes ── */
    #weapon-mastery-screen .wms-ms-connector {
      flex: 1;
      height: 2px;
      background: rgba(255,255,255,0.08);
      margin-top: -20px; /* align with node center */
      min-width: 6px;
    }
    #weapon-mastery-screen .wms-ms-connector.unlocked {
      background: var(--wc, #888);
      opacity: 0.5;
    }

    /* ── Bottom hint ── */
    #weapon-mastery-screen .wms-hint {
      text-align: center;
      color: #444455;
      font-size: 12px;
      letter-spacing: 2px;
      margin-top: 40px;
    }
  `;
  document.head.appendChild(style);
}

// ── WeaponMasteryScreen ───────────────────────────────────────────────────────

export class WeaponMasteryScreen {
  private container: HTMLDivElement;
  private onCloseCallback: (() => void) | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    injectStyles();
    this.container = document.createElement('div');
    this.container.id = 'weapon-mastery-screen';
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
  }

  /**
   * Show the screen. Loads fresh data from MasteryStore if no store passed.
   */
  show(store?: MasteryStore): void {
    const ms = store ?? MasteryStore.load();
    const allProgress = ms.getAllProgress();

    this.container.innerHTML = this._buildHTML(ms, allProgress);
    this.container.classList.remove('hidden');

    this._attachListeners();

    // Animate XP bars in after a brief delay so CSS transition plays
    requestAnimationFrame(() => {
      this.container.querySelectorAll<HTMLElement>('.wms-xp-fill').forEach(bar => {
        const target = bar.dataset.targetWidth ?? '0';
        bar.style.width = target + '%';
      });
    });
  }

  hide(): void {
    this.container.classList.add('hidden');
    this.onCloseCallback?.();
  }

  dispose(): void {
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.container.remove();
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  // ── Build HTML ──────────────────────────────────────────────────────────────

  private _buildHTML(
    store: MasteryStore,
    allProgress: Map<WeaponType, import('../systems/MasteryStore').MasteryLevelProgress>,
  ): string {
    const weapons = Object.values(WEAPON_CONFIGS);
    const cards = weapons
      .map(w => this._buildCard(store, w, allProgress.get(w.type)!))
      .join('');

    return `
      <div class="wms-content">
        <div class="wms-header">
          <h1 class="wms-title">WEAPON MASTERY</h1>
          <button class="wms-close" data-action="close">&times;</button>
        </div>
        <div class="wms-subtitle">UNLOCK BONUSES · TRACK PROGRESSION · MASTER EVERY WEAPON</div>

        <div class="wms-grid">
          ${cards}
        </div>

        <div class="wms-hint">Click any weapon card to view the full progression tree &middot; Press ESC to close</div>
      </div>
    `;
  }

  private _buildCard(
    store: MasteryStore,
    w: import('../weapons/WeaponTypes').WeaponConfig,
    prog: import('../systems/MasteryStore').MasteryLevelProgress,
  ): string {
    const color = hexColor(w.color);
    const level = prog.level;
    const pct = prog.progressPct;
    const xpLabel = level >= 5
      ? `${prog.xp.toFixed(0)} XP (MAX)`
      : `${prog.xp.toFixed(0)} / ${prog.nextThreshold ?? 0} XP`;

    const milestonesHTML = this._buildMilestones(store, w.type, color, level);

    return `
      <div class="wms-card" style="--wc: ${color}" data-weapon-type="${w.type}">
        <div class="wms-card-head">
          <div class="wms-swatch" style="background: ${color}"></div>
          <span class="wms-weapon-name">${w.name}</span>
          <span class="wms-level-badge">Lv.${level} / 5</span>
        </div>

        <div class="wms-xp-row">
          <span class="wms-xp-label">XP</span>
          <div class="wms-xp-bg">
            <div class="wms-xp-fill" data-target-width="${pct.toFixed(1)}" style="background: ${color};"></div>
          </div>
          <span class="wms-xp-val">${xpLabel}</span>
        </div>

        <div class="wms-active-desc">${WEAPON_ACTIVE[w.type]}</div>

        <div class="wms-expand-hint">CLICK TO ${level > 0 ? 'VIEW' : 'SEE'} MASTERY TREE ▼</div>

        <div class="wms-expanded-section">
          <div class="wms-milestone-label">PROGRESSION TREE</div>
          <div class="wms-milestones">${milestonesHTML}</div>
        </div>
      </div>
    `;
  }

  private _buildMilestones(
    store: MasteryStore,
    weapon: WeaponType,
    color: string,
    currentLevel: number,
  ): string {
    const parts: string[] = [];
    const MAX = 5;

    for (let lvl = 0; lvl <= MAX; lvl++) {
      const isUnlocked = lvl <= currentLevel;
      const isCurrent = lvl === currentLevel;
      const isGold = lvl === 5 && isUnlocked;

      let nodeClass = 'wms-ms-node';
      let labelClass = 'wms-ms-node-label';

      if (isGold) {
        nodeClass += ' gold';
        labelClass += ' gold';
      } else if (isCurrent) {
        nodeClass += ' current';
        labelClass += ' unlocked';
      } else if (isUnlocked) {
        nodeClass += ' unlocked';
        labelClass += ' unlocked';
      }

      const milestoneLabel = buildMilestoneLabel(store, weapon, lvl);
      const levelText = lvl === 5 ? '★' : `${lvl}`;

      const nodeHTML = `
        <div class="wms-ms-node-wrap">
          <div class="${nodeClass}">${levelText}</div>
          <div class="${labelClass}">${milestoneLabel}</div>
        </div>
      `;

      // Connector before each node except the first
      if (lvl > 0) {
        const connClass = lvl <= currentLevel ? 'wms-ms-connector unlocked' : 'wms-ms-connector';
        parts.push(`<div class="wms-ms-slot">
          <div class="${connClass}"></div>
          ${nodeHTML}
        </div>`);
      } else {
        parts.push(`<div class="wms-ms-slot">${nodeHTML}</div>`);
      }
    }

    return parts.join('');
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  private _attachListeners(): void {
    // Close button
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-action="close"]')) {
        this.hide();
        return;
      }

      // Toggle card expansion
      const card = target.closest('.wms-card') as HTMLElement | null;
      if (card) {
        card.classList.toggle('expanded');
        const hint = card.querySelector<HTMLElement>('.wms-expand-hint');
        if (hint) {
          hint.textContent = card.classList.contains('expanded')
            ? 'CLICK TO COLLAPSE ▲'
            : 'CLICK TO VIEW MASTERY TREE ▼';
        }
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
}
