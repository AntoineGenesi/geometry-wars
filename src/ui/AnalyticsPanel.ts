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

import type { PerformanceLogger, GameEvent } from '../core/PerformanceLogger';
import { ScoreGraphPanel, injectScoreGraphStyles } from './ScoreGraphPanel';
import { createEnemyModelPreviewElement } from './EnemyModelPreview';

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

// Enemy type display names (keys match EnemyType from EnemySpawner)
export const ENEMY_DISPLAY: Record<string, string> = {
  wanderer: 'Wanderer',
  grunt: 'Grunt',
  duck: 'Duck',
  mayfly: 'Mayfly',
  rocket: 'Rocket',
  neutron: 'Neutron',
  weaver: 'Weaver',
  spinner: 'Spinner',
  snake: 'Snake',
  repulsor: 'Repulsor',
  gravity_well: 'Gravity Well',
  gravity_well_red: 'Red Gravity Well',
  gate: 'Gate',
  painter: 'Painter',
  virus: 'Virus',
  spawner: 'Spawner',
  titan_grunt: 'Titan Grunt',
  titan_spinner: 'Titan Spinner',
  titan_weaver: 'Titan Weaver',
  giant_wanderer: 'Giant Wanderer',
  giant_rocket: 'Giant Rocket',
  giant_snake: 'Giant Snake',
  giant_neutron: 'Giant Neutron',
  cluster: 'Cluster',
  helix: 'Helix',
  fractal: 'Fractal',
  swarm: 'Swarm',
  lurker: 'Lurker',
  orbiter: 'Orbiter',
  splitter: 'Splitter',
  phaser: 'Phaser',
  approach_glow: 'Approach Glow',
  stealth_stalker: 'Stealth Stalker',
  prism_lancer: 'Prism Lancer',
  sentinel_orb: 'Sentinel Orb',
  shatter_bloom: 'Shatter Bloom',
  fractal_snake: 'Fractal Snake',
  boss_sapphire: 'Sapphire Boss',
  boss_ruby: 'Ruby Boss',
  boss_emerald: 'Emerald Boss',
  boss_topaz: 'Topaz Boss',
  boss_amethyst: 'Amethyst Boss',
  boss_opal: 'Opal Boss',
};

// Enemy type colors (from ENEMY_VISUAL_DEFS in MenuBackground.ts + extended)
export const ENEMY_TYPE_COLORS: Record<string, string> = {
  wanderer: '#aa44ff',
  grunt: '#4444ff',
  duck: '#ff44aa',
  mayfly: '#aaff00',
  rocket: '#ff8800',
  neutron: '#44dddd',
  weaver: '#00ff44',
  spinner: '#ff44ff',
  snake: '#4488ff',
  repulsor: '#ff6644',
  gravity_well: '#4488ff',
  gravity_well_red: '#ff4444',
  gate: '#ffcc00',
  painter: '#ffaa00',
  virus: '#00cc00',
  spawner: '#ff2222',
  titan_grunt: '#6666ff',
  titan_spinner: '#ff66ff',
  titan_weaver: '#44ff88',
  giant_wanderer: '#cc66ff',
  giant_rocket: '#ffaa44',
  giant_snake: '#66aaff',
  giant_neutron: '#66eeee',
  cluster: '#ffdd44',
  helix: '#ff66aa',
  fractal: '#88ff88',
  swarm: '#ddff44',
  lurker: '#886644',
  orbiter: '#44ccff',
  splitter: '#ff8866',
  phaser: '#aaaaff',
  approach_glow: '#ffff88',
  stealth_stalker: '#666688',
  prism_lancer: '#00e5ff',
  sentinel_orb: '#ffd34d',
  shatter_bloom: '#ff5df7',
  fractal_snake: '#66ff66',
  boss_sapphire: '#4488ff',
  boss_ruby: '#ff2244',
  boss_emerald: '#22ff44',
  boss_topaz: '#ffcc22',
  boss_amethyst: '#aa44ff',
  boss_opal: '#ffffff',
  other: '#666688',
};

// Kill streak tier definitions (ascending order)
const STREAK_TIERS: Array<{ min: number; name: string; color: string }> = [
  { min: 5,  name: 'Killing Spree',  color: '#44ff44' },
  { min: 8,  name: 'Rampage',        color: '#ffff44' },
  { min: 12, name: 'Unstoppable',    color: '#ff8844' },
  { min: 16, name: 'God-like',       color: '#ff4444' },
  { min: 20, name: 'Beyond God-like', color: '#cc44ff' },
];

export class AnalyticsPanel {
  private container: HTMLDivElement;
  private onCloseCallback: (() => void) | null = null;
  private scoreGraphPanel: ScoreGraphPanel | null = null;

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
      #analytics-panel .ap-kills-section {
        margin-bottom: 22px;
      }
      #analytics-panel .ap-kills-list {
        max-height: min(430px, 48vh);
        overflow-y: auto;
        padding-right: 4px;
      }
      #analytics-panel .ap-kill-row {
        display: grid;
        grid-template-columns: 48px minmax(96px, 150px) minmax(96px, 1fr) 76px;
        align-items: center;
        min-height: 54px;
        gap: 10px;
        margin-bottom: 7px;
      }
      #analytics-panel .ap-enemy-preview {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      #analytics-panel .ap-enemy-preview-rotating {
        overflow: hidden;
      }
      #analytics-panel .ap-enemy-preview-img {
        width: 44px;
        height: 44px;
        object-fit: contain;
        filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.45));
      }
      #analytics-panel .ap-enemy-preview-frame {
        position: absolute;
        inset: 0;
        opacity: 0;
        animation: ap-enemy-rotate 2.4s steps(1, end) infinite;
      }
      #analytics-panel .ap-enemy-preview-fallback {
        width: 26px;
        height: 26px;
        border: 2px solid;
        transform: rotate(45deg);
      }
      @keyframes ap-enemy-rotate {
        0%, 12.49% { opacity: 1; transform: translateY(1px); }
        12.5%, 100% { opacity: 0; transform: translateY(-1px); }
      }
      #analytics-panel .ap-kill-name {
        min-width: 0;
        color: #aacccc;
        font-size: 13px;
        font-weight: bold;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #analytics-panel .ap-kill-value {
        color: #88aacc;
        font-size: 13px;
        text-align: right;
        white-space: nowrap;
      }
      @media (max-width: 520px) {
        #analytics-panel .ap-kill-row {
          grid-template-columns: 38px minmax(74px, 112px) minmax(72px, 1fr) 62px;
          min-height: 46px;
          gap: 6px;
        }
        #analytics-panel .ap-enemy-preview,
        #analytics-panel .ap-enemy-preview-img {
          width: 34px;
          height: 34px;
        }
        #analytics-panel .ap-kill-name,
        #analytics-panel .ap-kill-value {
          font-size: 11px;
        }
      }
      #analytics-panel .ap-empty {
        color: #334455;
        font-size: 13px;
        text-align: center;
        padding: 12px 0;
        font-style: italic;
      }
      #analytics-panel .ap-streak-best {
        text-align: center;
        margin-bottom: 20px;
        padding: 16px;
        background: rgba(0, 40, 60, 0.4);
        border: 1px solid #223344;
        border-radius: 4px;
      }
      #analytics-panel .ap-streak-best-label {
        font-size: 11px;
        color: #446688;
        letter-spacing: 2px;
        margin-bottom: 6px;
      }
      #analytics-panel .ap-streak-best-value {
        font-size: 24px;
        font-weight: bold;
        letter-spacing: 2px;
      }
      #analytics-panel .ap-streak-best-name {
        font-size: 13px;
        margin-top: 4px;
        letter-spacing: 1px;
      }
      #analytics-panel .ap-streak-tier-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        margin-bottom: 4px;
        background: rgba(0, 20, 40, 0.3);
        border-radius: 3px;
      }
      #analytics-panel .ap-streak-tier-name {
        font-size: 13px;
        font-weight: bold;
      }
      #analytics-panel .ap-streak-tier-count {
        font-size: 13px;
        color: #88aacc;
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
      #analytics-panel .ap-tab-bar {
        display: flex;
        gap: 2px;
        margin-bottom: 24px;
        border-bottom: 2px solid #112233;
      }
      #analytics-panel .ap-tab {
        padding: 10px 24px;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 2px;
        color: #446688;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        margin-bottom: -2px;
      }
      #analytics-panel .ap-tab:hover {
        color: #88aacc;
      }
      #analytics-panel .ap-tab.active {
        color: #00ffff;
        border-bottom: 2px solid #00ffff;
        text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
      }
      #analytics-panel .ap-tab-panel {
        display: none;
      }
      #analytics-panel .ap-tab-panel.active {
        display: block;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Show the analytics panel populated from the given PerformanceLogger.
   */
  show(perfLogger: PerformanceLogger): void {
    const analytics = perfLogger.getWeaponAnalytics();
    injectScoreGraphStyles();

    // Dispose previous score graph if any
    this.scoreGraphPanel?.dispose();
    this.scoreGraphPanel = new ScoreGraphPanel();

    this.container.innerHTML = '';
    this.container.appendChild(this.buildTabContent(analytics, perfLogger));
    this.container.classList.remove('hidden');

    // keyHandler declared first so doClose can reference it (avoids TDZ issue)
    let keyHandler: (e: KeyboardEvent) => void;
    let keyHandlerTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Unified close: cancels pending timer, removes key listener, fires callback once
    const doClose = () => {
      if (keyHandlerTimeoutId !== null) {
        clearTimeout(keyHandlerTimeoutId);
        keyHandlerTimeoutId = null;
      }
      document.removeEventListener('keydown', keyHandler);
      this.hide();
      const cb = this.onCloseCallback;
      this.onCloseCallback = null; // prevent double-fire if called again
      cb?.();
    };

    keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        doClose();
      }
    };

    const closeBtn = this.container.querySelector('.ap-close-btn');
    closeBtn?.addEventListener('click', doClose);

    // Delay key listener to avoid capturing the Enter/Space that opened the previous screen
    keyHandlerTimeoutId = setTimeout(() => document.addEventListener('keydown', keyHandler), 400);
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  dispose(): void {
    this.scoreGraphPanel?.dispose();
    this.scoreGraphPanel = null;
    this.container.remove();
  }

  private buildTabContent(
    analytics: ReturnType<PerformanceLogger['getWeaponAnalytics']>,
    perfLogger: PerformanceLogger,
  ): HTMLElement {
    const content = document.createElement('div');
    content.className = 'ap-content';

    content.innerHTML = `
      <h1>SESSION REVIEW</h1>
      <div class="ap-subtitle">POST-GAME ANALYTICS</div>
    `;

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'ap-tab-bar';

    const tabs: Array<{ btn: HTMLButtonElement; panel: HTMLDivElement }> = [];

    const addTab = (label: string, panelContent: HTMLElement, active = false): void => {
      const btn = document.createElement('button');
      btn.className = active ? 'ap-tab active' : 'ap-tab';
      btn.textContent = label;
      tabBar.appendChild(btn);

      const panel = document.createElement('div');
      panel.className = active ? 'ap-tab-panel active' : 'ap-tab-panel';
      panel.appendChild(panelContent);

      tabs.push({ btn, panel });

      btn.addEventListener('click', () => {
        for (const t of tabs) {
          t.btn.classList.remove('active');
          t.panel.classList.remove('active');
        }
        btn.classList.add('active');
        panel.classList.add('active');
      });
    };

    // Score Graph tab (default active)
    addTab('SCORE GRAPH', this.scoreGraphPanel!.show(perfLogger), true);
    // Kills tab
    addTab('KILLS', this.buildKillsContent(perfLogger));
    // Weapons tab
    addTab('WEAPONS', this.buildWeaponsContent(analytics));
    // Streaks tab
    addTab('STREAKS', this.buildStreaksContent(perfLogger));

    content.appendChild(tabBar);
    for (const t of tabs) {
      content.appendChild(t.panel);
    }

    // CLOSE button (appended after tabs)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ap-close-btn';
    closeBtn.textContent = 'CLOSE';
    content.appendChild(closeBtn);

    return content;
  }

  private buildWeaponsContent(analytics: ReturnType<PerformanceLogger['getWeaponAnalytics']>): HTMLElement {
    const content = document.createElement('div');

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

    return content;
  }

  private buildKillsContent(perfLogger: PerformanceLogger): HTMLElement {
    const content = document.createElement('div');
    const killsByType = perfLogger.getKillsByEnemyType();
    const totalKills = killsByType.reduce((sum, t) => sum + t.kills, 0);

    if (killsByType.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ap-empty';
      empty.textContent = 'No kills recorded this session';
      content.appendChild(empty);
      return content;
    }

    // Summary header
    const summary = document.createElement('div');
    summary.className = 'ap-streak-best';
    summary.innerHTML = `
      <div class="ap-streak-best-label">TOTAL KILLS</div>
      <div class="ap-streak-best-value" style="color: #ff44aa; text-shadow: 0 0 12px #ff44aa;">${totalKills.toLocaleString()}</div>
      <div class="ap-streak-best-name" style="color: #88aacc;">${killsByType.length} enemy type${killsByType.length !== 1 ? 's' : ''} encountered</div>
    `;
    content.appendChild(summary);

    // Per-type breakdown with model previews and bars
    const maxKills = killsByType[0].kills;
    const section = document.createElement('div');
    section.className = 'ap-kills-section';

    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'ap-section-title';
    sectionTitle.textContent = 'KILLS BY ENEMY TYPE';
    section.appendChild(sectionTitle);

    const list = document.createElement('div');
    list.className = 'ap-kills-list';

    for (const { enemyType, kills } of killsByType) {
      const label = ENEMY_DISPLAY[enemyType] ?? enemyType;
      const color = ENEMY_TYPE_COLORS[enemyType] ?? '#666688';
      const pct = totalKills > 0 ? (kills / totalKills) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'ap-kill-row';

      const name = document.createElement('div');
      name.className = 'ap-kill-name';
      name.textContent = label;
      name.title = label;

      const track = document.createElement('div');
      track.className = 'ap-bar-track';
      const fill = document.createElement('div');
      fill.className = 'ap-bar-fill';
      fill.style.width = `${Math.min(100, (kills / maxKills) * 100).toFixed(1)}%`;
      fill.style.background = color;
      fill.style.opacity = '0.75';
      track.appendChild(fill);

      const value = document.createElement('div');
      value.className = 'ap-kill-value';
      value.textContent = `${kills} (${pct.toFixed(1)}%)`;

      row.appendChild(createEnemyModelPreviewElement(enemyType, label, color));
      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(value);
      list.appendChild(row);
    }

    section.appendChild(list);
    content.appendChild(section);

    // Smart summary text
    if (killsByType.length >= 2) {
      const top = killsByType[0];
      const topPct = totalKills > 0 ? ((top.kills / totalKills) * 100).toFixed(0) : '0';
      const summaryText = document.createElement('div');
      summaryText.style.cssText = 'color: #446688; font-size: 12px; text-align: center; padding: 8px 0; font-style: italic;';
      if (parseInt(topPct) >= 50) {
        summaryText.textContent = `${ENEMY_DISPLAY[top.enemyType] ?? top.enemyType}s dominated your kills at ${topPct}% of all enemies defeated.`;
      } else {
        summaryText.textContent = `Kill distribution was balanced — ${ENEMY_DISPLAY[top.enemyType] ?? top.enemyType}s led with ${topPct}%.`;
      }
      content.appendChild(summaryText);
    }

    return content;
  }

  private buildStreaksContent(perfLogger: PerformanceLogger): HTMLElement {
    const content = document.createElement('div');
    const events = perfLogger.getEvents();
    const streakEvents = events.filter(
      (e: GameEvent) => e.type === 'kill_streak' && e.value != null,
    );

    if (streakEvents.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ap-empty';
      empty.textContent = 'No kill streaks achieved this session';
      content.appendChild(empty);
      return content;
    }

    // Find best streak
    let bestStreak: GameEvent = streakEvents[0];
    for (const e of streakEvents) {
      if ((e.value ?? 0) > (bestStreak.value ?? 0)) bestStreak = e;
    }
    const bestCount = bestStreak.value ?? 0;

    // Determine tier name and color for the best streak
    let bestTierName = `${bestCount}-kill streak`;
    let bestTierColor = '#44ff44';
    for (const tier of STREAK_TIERS) {
      if (bestCount >= tier.min) {
        bestTierName = tier.name;
        bestTierColor = tier.color;
      }
    }

    // Best streak hero section
    const heroEl = document.createElement('div');
    heroEl.className = 'ap-streak-best';
    heroEl.innerHTML = `
      <div class="ap-streak-best-label">BEST STREAK</div>
      <div class="ap-streak-best-value" style="color: ${bestTierColor}; text-shadow: 0 0 12px ${bestTierColor};">${bestCount} KILLS</div>
      <div class="ap-streak-best-name" style="color: ${bestTierColor};">${bestTierName}</div>
    `;
    content.appendChild(heroEl);

    // Tier breakdown section
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'ap-section-title';
    sectionTitle.textContent = 'STREAK BREAKDOWN';
    content.appendChild(sectionTitle);

    // Count streaks per tier (reverse order — highest tier first)
    const tierCounts: Array<{ name: string; color: string; count: number }> = [];
    for (let i = STREAK_TIERS.length - 1; i >= 0; i--) {
      const tier = STREAK_TIERS[i];
      const nextMin = i < STREAK_TIERS.length - 1 ? STREAK_TIERS[i + 1].min : Infinity;
      const count = streakEvents.filter(
        (e: GameEvent) => (e.value ?? 0) >= tier.min && (e.value ?? 0) < nextMin,
      ).length;
      if (count > 0) {
        tierCounts.push({ name: tier.name, color: tier.color, count });
      }
    }

    if (tierCounts.length === 0) {
      // All streaks below named tiers — show raw count
      const row = document.createElement('div');
      row.className = 'ap-streak-tier-row';
      row.innerHTML = `
        <span class="ap-streak-tier-name" style="color: #44ff44;">Kill Streaks</span>
        <span class="ap-streak-tier-count">${streakEvents.length}×</span>
      `;
      content.appendChild(row);
    } else {
      for (const tc of tierCounts) {
        const row = document.createElement('div');
        row.className = 'ap-streak-tier-row';
        row.innerHTML = `
          <span class="ap-streak-tier-name" style="color: ${tc.color};">${tc.name}</span>
          <span class="ap-streak-tier-count">${tc.count}×</span>
        `;
        content.appendChild(row);
      }
    }

    // Total streaks summary
    const totalRow = document.createElement('div');
    totalRow.className = 'ap-streak-tier-row';
    totalRow.style.marginTop = '12px';
    totalRow.style.borderTop = '1px solid #223344';
    totalRow.style.paddingTop = '10px';
    totalRow.innerHTML = `
      <span class="ap-streak-tier-name" style="color: #88aacc;">Total Streaks</span>
      <span class="ap-streak-tier-count">${streakEvents.length}</span>
    `;
    content.appendChild(totalRow);

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
