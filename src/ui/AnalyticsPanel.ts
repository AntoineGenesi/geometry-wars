/**
 * AnalyticsPanel — Post-game weapon usage and buff contribution display.
 *
 * Shows after game over:
 * - Weapon usage timeline (% time spent with each weapon)
 * - Per-weapon kill counts
 * - Buff kill contribution (kills while each buff was active)
 *
 * Reads data from PerformanceLogger after the session is saved.
 */

import type { PerformanceLogger } from '../core/PerformanceLogger';

// Weapon display names (matches WeaponType enum values)
const WEAPON_DISPLAY: Record<string, string> = {
  Standard: 'Blaster',
  spread: 'Spread Shot',
  piercing: 'Piercing Beam',
  chain_lightning: 'Chain Lightning',
  homing: 'Homing Missiles',
  plasma_mortar: 'Plasma Mortar',
  gravity_gun: 'Gravity Gun',
  laser_beam: 'Laser Beam',
  black_hole: 'Black Hole',
  tesla_coil: 'Tesla Coil',
};

// Weapon colors (matches WeaponTypes.ts)
const WEAPON_COLORS: Record<string, string> = {
  Standard: '#ffff44',
  spread: '#44ffff',
  piercing: '#ffffff',
  chain_lightning: '#aaffff',
  homing: '#ff4444',
  plasma_mortar: '#44ff44',
  gravity_gun: '#8844ff',
  laser_beam: '#ff0000',
  black_hole: '#cc44ff',
  tesla_coil: '#88aaff',
};

// Buff display names
const BUFF_DISPLAY: Record<string, string> = {
  hot_hands: 'Hot Hands',
  trigger_happy: 'Trigger Happy',
  afterburner: 'Afterburner',
  magnetism: 'Magnetism',
  tough_times: 'Tough Times',
  shock_aura: 'Shock Aura',
  incendiary_rounds: 'Incendiary Rounds',
  volatile: 'Volatile',
};

const BUFF_COLORS: Record<string, string> = {
  hot_hands: '#ff8844',
  trigger_happy: '#ff4444',
  afterburner: '#44aaff',
  magnetism: '#ffff44',
  tough_times: '#44ff88',
  shock_aura: '#aaffff',
  incendiary_rounds: '#ff6622',
  volatile: '#ff44ff',
};

export class AnalyticsPanel {
  private container: HTMLDivElement;
  private onCloseCallback: (() => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'analytics-panel';
    this.injectStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
  }

  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #analytics-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 20, 0.92);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        overflow-y: auto;
        z-index: 3100;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(8px);
      }
      #analytics-panel.hidden { display: none; }
      #analytics-panel .ap-content {
        width: 100%;
        max-width: 680px;
        padding: 32px 24px 40px;
        box-sizing: border-box;
      }
      #analytics-panel h1 {
        font-size: 28px;
        font-weight: bold;
        color: #00ffff;
        text-shadow: 0 0 12px #00ffff;
        margin: 0 0 8px;
        letter-spacing: 5px;
        text-align: center;
      }
      #analytics-panel .ap-subtitle {
        text-align: center;
        color: #446688;
        font-size: 12px;
        letter-spacing: 2px;
        margin-bottom: 28px;
      }
      #analytics-panel .ap-section {
        margin-bottom: 28px;
      }
      #analytics-panel .ap-section-title {
        font-size: 13px;
        font-weight: bold;
        color: #88aacc;
        letter-spacing: 3px;
        margin-bottom: 12px;
        border-bottom: 1px solid #223344;
        padding-bottom: 6px;
      }
      #analytics-panel .ap-bar-row {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
        gap: 8px;
      }
      #analytics-panel .ap-bar-label {
        width: 140px;
        min-width: 140px;
        font-size: 13px;
        color: #aacccc;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #analytics-panel .ap-bar-track {
        flex: 1;
        height: 18px;
        background: rgba(0, 30, 50, 0.6);
        border-radius: 3px;
        overflow: hidden;
        border: 1px solid #112233;
      }
      #analytics-panel .ap-bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s ease;
      }
      #analytics-panel .ap-bar-value {
        width: 60px;
        min-width: 60px;
        font-size: 13px;
        color: #88aacc;
        text-align: left;
      }
      #analytics-panel .ap-empty {
        color: #334455;
        font-size: 13px;
        text-align: center;
        padding: 12px 0;
        font-style: italic;
      }
      #analytics-panel .ap-close-btn {
        display: block;
        margin: 24px auto 0;
        background: linear-gradient(180deg, #004466 0%, #002233 100%);
        border: 2px solid #0088aa;
        color: #00ccff;
        padding: 14px 48px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 3px;
        transition: all 0.2s;
        border-radius: 3px;
      }
      #analytics-panel .ap-close-btn:hover {
        background: linear-gradient(180deg, #006688 0%, #003344 100%);
        box-shadow: 0 0 20px #0088aa;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Show the analytics panel populated from the given PerformanceLogger.
   */
  show(perfLogger: PerformanceLogger): void {
    const analytics = perfLogger.getWeaponAnalytics();
    this.container.innerHTML = '';
    this.container.appendChild(this.buildContent(analytics));
    this.container.classList.remove('hidden');

    const closeBtn = this.container.querySelector('.ap-close-btn');
    closeBtn?.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });

    // Keyboard close
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        document.removeEventListener('keydown', keyHandler);
        this.hide();
        this.onCloseCallback?.();
      }
    };
    setTimeout(() => document.addEventListener('keydown', keyHandler), 400);
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  dispose(): void {
    this.container.remove();
  }

  private buildContent(analytics: ReturnType<PerformanceLogger['getWeaponAnalytics']>): HTMLElement {
    const content = document.createElement('div');
    content.className = 'ap-content';

    content.innerHTML = `
      <h1>WEAPON ANALYTICS</h1>
      <div class="ap-subtitle">POST-GAME SESSION REVIEW</div>
    `;

    // --- Section 1: Weapon Usage Timeline ---
    content.appendChild(this.buildSection(
      'WEAPON USAGE (TIME %)',
      analytics.weaponTimeline,
      ({ weapon, pct }) => ({
        label: WEAPON_DISPLAY[weapon] ?? weapon,
        value: `${pct.toFixed(1)}%`,
        pct,
        color: WEAPON_COLORS[weapon] ?? '#aaaaaa',
      }),
    ));

    // --- Section 2: Kills by Weapon ---
    const maxKills = analytics.killsByWeapon.length > 0
      ? analytics.killsByWeapon[0].kills
      : 1;
    content.appendChild(this.buildSection(
      'KILLS BY WEAPON',
      analytics.killsByWeapon,
      ({ weapon, kills }) => ({
        label: WEAPON_DISPLAY[weapon] ?? weapon,
        value: `${kills} kills`,
        pct: (kills / maxKills) * 100,
        color: WEAPON_COLORS[weapon] ?? '#aaaaaa',
      }),
    ));

    // --- Section 3: Buff Kill Contribution ---
    const maxBuffKills = analytics.buffKillContrib.length > 0
      ? analytics.buffKillContrib[0].kills
      : 1;
    content.appendChild(this.buildSection(
      'KILLS WITH BUFF ACTIVE',
      analytics.buffKillContrib,
      ({ buff, kills }) => ({
        label: BUFF_DISPLAY[buff] ?? buff,
        value: `${kills} kills`,
        pct: (kills / maxBuffKills) * 100,
        color: BUFF_COLORS[buff] ?? '#88aacc',
      }),
    ));

    content.innerHTML += `<button class="ap-close-btn">CLOSE</button>`;

    return content;
  }

  private buildSection<T>(
    title: string,
    items: T[],
    map: (item: T) => { label: string; value: string; pct: number; color: string },
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'ap-section';

    const titleEl = document.createElement('div');
    titleEl.className = 'ap-section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ap-empty';
      empty.textContent = 'No data recorded';
      section.appendChild(empty);
      return section;
    }

    for (const item of items) {
      const { label, value, pct, color } = map(item);
      const row = document.createElement('div');
      row.className = 'ap-bar-row';
      row.innerHTML = `
        <div class="ap-bar-label">${label}</div>
        <div class="ap-bar-track">
          <div class="ap-bar-fill" style="width: ${Math.min(100, pct).toFixed(1)}%; background: ${color}; opacity: 0.75;"></div>
        </div>
        <div class="ap-bar-value">${value}</div>
      `;
      section.appendChild(row);
    }

    return section;
  }
}
