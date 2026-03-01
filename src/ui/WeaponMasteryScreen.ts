/**
 * Weapon Mastery Screen — full-screen constellation/space-themed upgrade tree.
 *
 * Each weapon is a "constellation" cluster: 2 branches × 5 nodes, connected by
 * glowing SVG lines. Players spend/refund mastery points to permanently unlock nodes.
 *
 * Public API (unchanged from previous version):
 *   show(store?: MasteryStore): void
 *   hide(): void
 *   dispose(): void
 *   onClose(callback: () => void): void
 *
 * New method (call before show()):
 *   setPointStore(store: MasteryPointStore): void
 */

import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import { MasteryStore } from '../systems/MasteryStore';
import { MasteryPointStore, weaponTypeFromNodeId } from '../systems/MasteryPointStore';
import {
  UPGRADE_TREES,
  UpgradeNode,
  UpgradeTree,
  getNodeMaxPoints,
  getNodeById,
  getImplicitParent,
  isPrerequisiteMet,
} from '../systems/UpgradeTreeData';
import { MatchUpgradeTracker } from '../systems/MatchUpgradeTracker';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** Deterministic pseudo-random number [0,1) from a mutable seed object. */
function seededRand(state: { v: number }): number {
  state.v = (state.v * 1664525 + 1013904223) & 0xffffffff;
  return ((state.v >>> 0) / 0xffffffff);
}

/** Generate CSS box-shadow string for ~60 star particles. */
function buildStarBoxShadow(): string {
  const rng = { v: 42317 };
  const stars: string[] = [];
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(seededRand(rng) * 100);
    const y = Math.floor(seededRand(rng) * 100);
    const size = seededRand(rng) < 0.85 ? 1 : 2;
    const opacity = (0.25 + seededRand(rng) * 0.55).toFixed(2);
    stars.push(`${x}vw ${y}vh 0 ${size}px rgba(255,255,255,${opacity})`);
  }
  return stars.join(',\n');
}

// ── Style injection ───────────────────────────────────────────────────────────

let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const starShadow = buildStarBoxShadow();

  const style = document.createElement('style');
  style.id = 'weapon-mastery-screen-styles';
  style.textContent = `
    /* ── Root overlay — space background ── */
    #weapon-mastery-screen {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: radial-gradient(ellipse at center, #080818 0%, #000005 100%);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      z-index: 2500;
      font-family: 'Segoe UI', Arial, sans-serif;
      overflow-y: auto;
    }
    #weapon-mastery-screen.hidden { display: none; }

    /* ── Star particles ── */
    #weapon-mastery-screen::before {
      content: '';
      position: fixed;
      top: 0; left: 0;
      width: 1px; height: 1px;
      box-shadow: ${starShadow};
      pointer-events: none;
      z-index: 0;
    }

    /* ── Scroll container ── */
    #weapon-mastery-screen .wms-content {
      position: relative;
      z-index: 1;
      max-width: 960px;
      width: 100%;
      padding: 40px 24px 80px;
    }

    /* ── Header ── */
    #weapon-mastery-screen .wms-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    #weapon-mastery-screen .wms-title {
      color: #eef;
      font-size: 34px;
      font-weight: bold;
      letter-spacing: 8px;
      text-shadow:
        0 0 12px rgba(220,220,255,0.9),
        0 0 30px rgba(180,160,255,0.5);
      margin: 0;
    }
    #weapon-mastery-screen .wms-close {
      background: none;
      border: 2px solid #445;
      color: #aac;
      font-size: 22px;
      width: 44px;
      height: 44px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: border-color 0.2s, color 0.2s, box-shadow 0.2s;
    }
    #weapon-mastery-screen .wms-close:hover {
      border-color: #f44;
      color: #f44;
      box-shadow: 0 0 10px #f44;
    }

    /* ── Points counter bar ── */
    #weapon-mastery-screen .wms-points-bar {
      display: flex;
      align-items: baseline;
      gap: 24px;
      margin-bottom: 28px;
    }
    #weapon-mastery-screen .wms-points-available {
      font-size: 28px;
      font-weight: bold;
      color: #ffcc00;
      letter-spacing: 2px;
      text-shadow: 0 0 12px #ffcc00, 0 0 28px rgba(255,200,0,0.5);
      transition: transform 0.15s ease-out;
    }
    #weapon-mastery-screen .wms-points-available.bump {
      transform: scale(1.3);
    }
    #weapon-mastery-screen .wms-points-label {
      font-size: 13px;
      color: #cc9900;
      letter-spacing: 3px;
      text-transform: uppercase;
    }
    #weapon-mastery-screen .wms-points-secondary {
      font-size: 11px;
      color: #556;
      letter-spacing: 2px;
      margin-left: auto;
    }

    /* ── Weapon grid ── */
    #weapon-mastery-screen .wms-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    @media (max-width: 680px) {
      #weapon-mastery-screen .wms-grid { grid-template-columns: 1fr; }
    }

    /* ── Weapon card ── */
    #weapon-mastery-screen .wms-card {
      background: rgba(6, 6, 22, 0.88);
      border: 1px solid color-mix(in srgb, var(--wc, #666) 30%, transparent);
      padding: 14px;
      position: relative;
      transition: box-shadow 0.25s, border-color 0.25s;
    }
    #weapon-mastery-screen .wms-card:hover {
      border-color: color-mix(in srgb, var(--wc, #666) 60%, transparent);
      box-shadow: 0 0 16px color-mix(in srgb, var(--wc, #666) 25%, transparent);
    }

    /* ── Card header ── */
    #weapon-mastery-screen .wms-card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    #weapon-mastery-screen .wms-swatch {
      width: 22px;
      height: 22px;
      border-radius: 3px;
      flex-shrink: 0;
      box-shadow: 0 0 6px var(--wc, #666);
    }
    #weapon-mastery-screen .wms-weapon-name {
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 2px;
      color: var(--wc, #fff);
      text-shadow: 0 0 6px var(--wc, #fff);
      flex: 1;
    }
    #weapon-mastery-screen .wms-level-badge {
      font-size: 10px;
      font-weight: bold;
      color: #ffdd88;
      background: rgba(255,200,50,0.1);
      border: 1px solid rgba(255,200,50,0.3);
      padding: 2px 7px;
      flex-shrink: 0;
    }

    #weapon-mastery-screen .wms-pts-badge {
      font-size: 10px;
      font-weight: bold;
      color: #88ffcc;
      background: rgba(50,255,150,0.1);
      border: 1px solid rgba(50,255,150,0.3);
      padding: 2px 7px;
      border-radius: 4px;
      flex-shrink: 0;
      margin-left: auto;
    }

    /* ── XP bar ── */
    #weapon-mastery-screen .wms-xp-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    #weapon-mastery-screen .wms-xp-label {
      color: #556;
      font-size: 9px;
      letter-spacing: 1px;
      width: 18px;
      flex-shrink: 0;
    }
    #weapon-mastery-screen .wms-xp-bg {
      flex: 1;
      height: 4px;
      background: rgba(30, 30, 60, 0.9);
      border-radius: 2px;
      overflow: hidden;
    }
    #weapon-mastery-screen .wms-xp-fill {
      height: 100%;
      background: var(--wc, #888);
      width: 0%;
      transition: width 0.5s ease-out;
    }
    #weapon-mastery-screen .wms-xp-val {
      color: #778;
      font-size: 9px;
      width: 50px;
      text-align: right;
      flex-shrink: 0;
    }

    /* ── Branch labels row ── */
    #weapon-mastery-screen .wms-branch-labels {
      display: flex;
      justify-content: space-between;
      margin-bottom: 2px;
      padding: 0 8px;
    }
    /* 4-endpoint branching weapons: labels across full width */
    #weapon-mastery-screen .wms-branch-labels--4 {
      justify-content: space-around;
    }
    #weapon-mastery-screen .wms-branch-label {
      font-size: 9px;
      letter-spacing: 2px;
      color: color-mix(in srgb, var(--wc, #888) 70%, white);
      text-transform: uppercase;
      opacity: 0.7;
    }
    /* Premium-cost node indicator — slightly brighter border */
    #weapon-mastery-screen .wms-node--premium {
      border-style: double;
    }

    /* ── Constellation area ── */
    #weapon-mastery-screen .wms-constellation-area {
      position: relative;
      width: 100%;
      /* height is set inline per-card based on branch depth (240px for 5-level, 380px for 10-level) */
      min-height: 240px;
    }
    #weapon-mastery-screen .wms-constellation-svg {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      overflow: visible;
    }

    /* ── Upgrade nodes ── */
    #weapon-mastery-screen .wms-node {
      position: absolute;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      cursor: pointer;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: bold;
      letter-spacing: 0;
      transition: box-shadow 0.2s, border-color 0.2s, background 0.2s, transform 0.15s;
      z-index: 2;
      user-select: none;
    }
    #weapon-mastery-screen .wms-node:hover { transform: translate(-50%, -50%) scale(1.2); }

    /* locked — very dim (no points or prereq not met) */
    #weapon-mastery-screen .wms-node--locked {
      background: rgba(255,255,255,0.04);
      border: 2px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.2);
    }

    /* prereq-locked — prerequisite not met; slightly warmer tint to distinguish */
    #weapon-mastery-screen .wms-node--prereq-locked {
      background: rgba(255,100,50,0.04);
      border: 2px solid rgba(255,100,50,0.15);
      color: rgba(255,150,100,0.25);
      cursor: not-allowed;
    }

    /* affordable — bright weapon-color glow: this is what you SHOULD click next */
    #weapon-mastery-screen .wms-node--affordable {
      background: color-mix(in srgb, var(--wc, #888) 18%, rgba(0,0,0,0.5));
      border: 2px solid var(--wc, #888);
      color: var(--wc, #888);
      box-shadow: 0 0 14px var(--wc, #888), 0 0 30px color-mix(in srgb, var(--wc, #888) 55%, transparent);
      animation: wms-node-pulse 2.0s ease-in-out infinite;
    }

    /* partial — multi-level node with some but not all points spent; still actionable */
    #weapon-mastery-screen .wms-node--partial {
      background: color-mix(in srgb, var(--wc, #888) 15%, rgba(0,0,0,0.5));
      border: 2px dashed var(--wc, #888);
      color: var(--wc, #888);
      box-shadow: 0 0 10px color-mix(in srgb, var(--wc, #888) 55%, transparent);
      animation: wms-node-pulse 2.2s ease-in-out infinite;
    }

    /* unlocked — dim steady glow: acquired, not the current focus */
    #weapon-mastery-screen .wms-node--unlocked {
      background: color-mix(in srgb, var(--wc, #888) 12%, rgba(0,0,0,0.6));
      border: 2px solid color-mix(in srgb, var(--wc, #888) 65%, transparent);
      color: color-mix(in srgb, var(--wc, #888) 75%, white);
      box-shadow: 0 0 6px color-mix(in srgb, var(--wc, #888) 40%, transparent);
    }

    /* permanently unlocked but NOT yet earned this match — dim glow (visible but subtle) */
    #weapon-mastery-screen .wms-node--unlocked-inactive {
      background: color-mix(in srgb, var(--wc, #888) 10%, rgba(0,0,0,0.6));
      border: 2px dashed color-mix(in srgb, var(--wc, #888) 55%, transparent);
      color: color-mix(in srgb, var(--wc, #888) 65%, white);
      box-shadow: 0 0 5px color-mix(in srgb, var(--wc, #888) 28%, transparent);
      opacity: 0.75;
    }

    /* active this match — bright glow + green "ACTIVE" badge */
    #weapon-mastery-screen .wms-node--active-this-match {
      background: color-mix(in srgb, var(--wc, #888) 20%, rgba(0,0,0,0.5));
      border: 2px solid var(--wc, #888);
      color: var(--wc, #888);
      box-shadow: 0 0 10px var(--wc, #888), 0 0 22px color-mix(in srgb, var(--wc, #888) 50%, transparent),
                  0 0 4px #44ff88, 0 0 12px rgba(68,255,136,0.4);
      animation: wms-node-active 1.8s ease-in-out infinite;
    }

    @keyframes wms-node-active {
      0%, 100% { box-shadow: 0 0 8px var(--wc, #888),  0 0 18px color-mix(in srgb, var(--wc, #888) 40%, transparent), 0 0 4px #44ff88; }
      50%       { box-shadow: 0 0 16px var(--wc, #888), 0 0 36px color-mix(in srgb, var(--wc, #888) 60%, transparent), 0 0 10px rgba(68,255,136,0.7); }
    }

    /* Match mode legend bar */
    #weapon-mastery-screen .wms-match-legend {
      display: flex;
      gap: 16px;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: rgba(255,255,255,0.6);
      padding: 4px 0 0;
      letter-spacing: 0.05em;
    }
    #weapon-mastery-screen .wms-legend-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }
    .wms-legend-dot--active { background: #44ff88; box-shadow: 0 0 6px #44ff88; }
    .wms-legend-dot--inactive { background: rgba(255,255,255,0.2); border: 1px dashed rgba(255,255,255,0.3); }

    @keyframes wms-node-pulse {
      0%, 100% { box-shadow: 0 0 8px var(--wc, #888),  0 0 18px color-mix(in srgb, var(--wc, #888) 40%, transparent); }
      50%       { box-shadow: 0 0 16px var(--wc, #888), 0 0 36px color-mix(in srgb, var(--wc, #888) 60%, transparent); }
    }
    @keyframes wms-gold-shimmer {
      0%, 100% { box-shadow: 0 0 6px rgba(255,200,0,0.5); }
      50%       { box-shadow: 0 0 14px rgba(255,220,0,0.8), 0 0 28px rgba(255,200,0,0.4); }
    }

    /* ── Tooltip ── */
    #wms-tooltip {
      position: fixed;
      z-index: 3000;
      background: rgba(5, 5, 20, 0.95);
      border: 1px solid #334;
      padding: 10px 14px;
      max-width: 220px;
      pointer-events: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.8);
      display: none;
    }
    #wms-tooltip.visible { display: block; }
    #wms-tooltip .wms-tt-name {
      font-size: 13px;
      font-weight: bold;
      color: #dde;
      letter-spacing: 1px;
      margin-bottom: 5px;
    }
    #wms-tooltip .wms-tt-desc {
      font-size: 11px;
      color: #778;
      line-height: 1.4;
      margin-bottom: 4px;
    }
    #wms-tooltip .wms-tt-effect {
      font-size: 11px;
      color: #aacc88;
      font-style: italic;
      line-height: 1.4;
    }
    #wms-tooltip .wms-tt-cost {
      font-size: 10px;
      color: #ffcc00;
      margin-top: 6px;
      letter-spacing: 1px;
    }
    #wms-tooltip .wms-tt-prereq {
      font-size: 10px;
      color: #ff8855;
      margin-top: 6px;
      letter-spacing: 1px;
    }

    /* ── Bottom hint ── */
    #weapon-mastery-screen .wms-hint {
      text-align: center;
      color: #334;
      font-size: 11px;
      letter-spacing: 2px;
      margin-top: 36px;
    }
  `;
  document.head.appendChild(style);
}

// ── Node layout constants ─────────────────────────────────────────────────────
// Fallback positions for weapons that do NOT specify explicit x/y on their nodes.
// Branching weapons (e.g. Standard) use explicit x/y per node instead.

interface NodePos { x: number; y: number; }

/** Fallback positions for legacy linear-branch nodes (branch 'a' or 'b', depth 1-10). */
const NODE_POSITIONS: Record<string, NodePos> = {
  // Branch A: down-left diagonal (10 positions)
  'a_1':  { x: 103, y:  46 },
  'a_2':  { x:  82, y:  78 },
  'a_3':  { x:  60, y: 110 },
  'a_4':  { x:  38, y: 142 },
  'a_5':  { x:  18, y: 174 },
  'a_6':  { x:  10, y: 208 },
  'a_7':  { x:   8, y: 243 },
  'a_8':  { x:  14, y: 278 },
  'a_9':  { x:  24, y: 312 },
  'a_10': { x:  38, y: 344 },
  // Branch B: down-right diagonal (10 positions)
  'b_1':  { x: 177, y:  46 },
  'b_2':  { x: 198, y:  78 },
  'b_3':  { x: 220, y: 110 },
  'b_4':  { x: 242, y: 142 },
  'b_5':  { x: 262, y: 174 },
  'b_6':  { x: 270, y: 208 },
  'b_7':  { x: 272, y: 243 },
  'b_8':  { x: 266, y: 278 },
  'b_9':  { x: 256, y: 312 },
  'b_10': { x: 242, y: 344 },
};

const SVG_W = 280;
// Center junction point (where the two branches split from the weapon hub)
const CENTER_X = 140;
const CENTER_Y = 18;

// ── WeaponMasteryScreen ───────────────────────────────────────────────────────

export class WeaponMasteryScreen {
  private container: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private onCloseCallback: (() => void) | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  private _masteryStore: MasteryStore | null = null;
  private _pointStore: MasteryPointStore | null = null;
  private _matchUpgradeTracker: MatchUpgradeTracker | null = null;

  constructor() {
    injectStyles();

    this.container = document.createElement('div');
    this.container.id = 'weapon-mastery-screen';
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);

    this.tooltip = document.createElement('div');
    this.tooltip.id = 'wms-tooltip';
    document.body.appendChild(this.tooltip);
  }

  /** Set the point store before calling show(). */
  setPointStore(store: MasteryPointStore): void {
    this._pointStore = store;
  }

  /**
   * Optionally set the per-match upgrade tracker (LAN mode only).
   * When set, the screen shows which permanently unlocked nodes have been
   * "earned this match" (kill threshold crossed) vs just permanently unlocked.
   */
  setMatchUpgradeTracker(tracker: MatchUpgradeTracker | null): void {
    this._matchUpgradeTracker = tracker;
  }

  /**
   * Show the screen. Pass a MasteryStore to load XP data; if omitted loads fresh.
   * MasteryPointStore must be set via setPointStore() beforehand (or a fresh one is loaded).
   */
  show(store?: MasteryStore): void {
    this._masteryStore = store ?? MasteryStore.load();
    if (!this._pointStore) {
      this._pointStore = MasteryPointStore.load();
    }

    this._render();
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
    this._hideTooltip();
    this.container.classList.add('hidden');
    this.onCloseCallback?.();
  }

  dispose(): void {
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.container.remove();
    this.tooltip.remove();
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _render(): void {
    const ms = this._masteryStore!;
    const ps = this._pointStore!;
    const allProgress = ms.getAllProgress();
    const weapons = Object.values(WEAPON_CONFIGS);

    const cards = weapons
      .map(w => this._buildCard(w, allProgress.get(w.type)!, ps))
      .join('');

    this.container.innerHTML = `
      <div class="wms-content">
        <div class="wms-header">
          <h1 class="wms-title">WEAPON MASTERY</h1>
          <button class="wms-close" data-action="close">&times;</button>
        </div>
        <div class="wms-points-bar">
          <span class="wms-points-available" id="wms-points-display">${ps.getTotalPoints()}</span>
          <span class="wms-points-label">Total Points Earned</span>
          <span class="wms-points-secondary">Points are per-weapon &mdash; spend in each weapon's tree</span>
        </div>
        <div class="wms-grid">
          ${cards}
        </div>
        ${this._matchUpgradeTracker ? `
        <div class="wms-match-legend">
          <span><span class="wms-legend-dot wms-legend-dot--active"></span>Earned this match</span>
          <span><span class="wms-legend-dot wms-legend-dot--inactive"></span>Permanently unlocked (earn by killing with this weapon)</span>
        </div>` : ''}
        <div class="wms-hint">Hover for details &middot; Left-click to spend point &middot; Right-click to refund &middot; ESC to close</div>
      </div>
    `;
  }

  private _buildCard(
    w: import('../weapons/WeaponTypes').WeaponConfig,
    prog: import('../systems/MasteryStore').MasteryLevelProgress,
    ps: MasteryPointStore,
  ): string {
    const color = hexColor(w.color);
    const tree = UPGRADE_TREES[w.type];
    const level = prog.level;
    const pct = prog.progressPct;
    const xpLabel = level >= 5
      ? `${prog.xp.toFixed(0)} XP (MAX)`
      : `${prog.xp.toFixed(0)} / ${prog.nextThreshold ?? 0} XP`;

    const constellationHTML = this._buildConstellation(w.type, ps, color);

    return `
      <div class="wms-card" style="--wc: ${color}" data-weapon-type="${w.type}">
        <div class="wms-card-head">
          <div class="wms-swatch" style="background: ${color}"></div>
          <span class="wms-weapon-name">${w.name}</span>
          <span class="wms-level-badge">Lv.${level} / 5</span>
          <span class="wms-pts-badge" data-weapon-pts="${w.type}">${ps.getAvailablePoints(w.type)} pts</span>
        </div>
        <div class="wms-xp-row">
          <span class="wms-xp-label">XP</span>
          <div class="wms-xp-bg">
            <div class="wms-xp-fill" data-target-width="${pct.toFixed(1)}" style="background: ${color};"></div>
          </div>
          <span class="wms-xp-val">${xpLabel}</span>
        </div>
        ${tree.branchALName ? `
        <div class="wms-branch-labels wms-branch-labels--4">
          <span class="wms-branch-label">${tree.branchALName}</span>
          <span class="wms-branch-label">${tree.branchARName ?? ''}</span>
          <span class="wms-branch-label">${tree.branchBLName ?? ''}</span>
          <span class="wms-branch-label">${tree.branchBRName ?? ''}</span>
        </div>` : `
        <div class="wms-branch-labels">
          <span class="wms-branch-label">${tree.branchAName}</span>
          <span class="wms-branch-label">${tree.branchBName}</span>
        </div>`}
        ${constellationHTML}
      </div>
    `;
  }

  private _buildConstellation(
    weaponType: WeaponType,
    ps: MasteryPointStore,
    color: string,
  ): string {
    const tree = UPGRADE_TREES[weaponType];
    const hasPoints = ps.getAvailablePoints(weaponType) > 0;

    // Determine SVG height from tree config or infer from max nodeIndex
    const SVG_H = this._svgHeight(tree);
    const areaHeight = SVG_H;

    // Build position map for all nodes
    const posMap = new Map<string, NodePos>();
    for (const n of tree.nodes) {
      posMap.set(n.id, this._getNodePos(n));
    }

    /**
     * 3-state line style:
     *  activated — child node is fully unlocked → bright glow
     *  possible  — prerequisite met but child not yet unlocked → visible colored
     *  locked    — prerequisite not met → faint white
     */
    const lineStyle = (childUnlocked: boolean, prereqMet: boolean): string => {
      if (childUnlocked) return `stroke="${color}" stroke-opacity="0.90" filter="url(#glow-${weaponType})"`;
      if (prereqMet)     return `stroke="${color}" stroke-opacity="0.42"`;
      return 'stroke="rgba(255,255,255,0.14)"';
    };

    // Build SVG lines: each node connects to its parent (or to center if no parentId)
    const lines: string[] = [];
    for (const n of tree.nodes) {
      const pos = posMap.get(n.id)!;
      const childUnlocked = ps.isUnlocked(n.id);
      // A line is "possible" if the prerequisite for the child is met
      const prereqMet = isPrerequisiteMet(n, tree, ps);
      const attribs = lineStyle(childUnlocked, prereqMet);
      if (n.parentId) {
        const parentPos = posMap.get(n.parentId);
        if (parentPos) {
          lines.push(`<line x1="${parentPos.x}" y1="${parentPos.y}" x2="${pos.x}" y2="${pos.y}" stroke-width="2" ${attribs}/>`);
        }
      } else {
        // Root node → connect to center
        lines.push(`<line x1="${CENTER_X}" y1="${CENTER_Y}" x2="${pos.x}" y2="${pos.y}" stroke-width="2" ${attribs}/>`);
      }
    }

    // Skip connection lines — dashed golden lines for cross-branch shortcuts
    const skipLines: string[] = [];
    if (tree.skipConnections) {
      for (const skip of tree.skipConnections) {
        const fromPos = posMap.get(skip.fromId);
        const toPos = posMap.get(skip.toId);
        if (!fromPos || !toPos) continue;
        const fromUnlocked = ps.isUnlocked(skip.fromId);
        const toUnlocked = ps.isUnlocked(skip.toId);
        const skipOpacity = fromUnlocked && toUnlocked ? '0.85' : fromUnlocked ? '0.45' : '0.12';
        const skipFilter = fromUnlocked && toUnlocked ? ` filter="url(#glow-${weaponType})"` : '';
        skipLines.push(
          `<line data-skip="true" x1="${fromPos.x}" y1="${fromPos.y}" x2="${toPos.x}" y2="${toPos.y}"` +
          ` stroke-width="1" stroke-dasharray="5,3" stroke="#d4aa40" stroke-opacity="${skipOpacity}"${skipFilter}/>`
        );
      }
    }

    // Center dot (weapon icon) — glows if any root node is unlocked
    const rootsUnlocked = tree.nodes.filter(n => !n.parentId).some(n => ps.isUnlocked(n.id));
    const centerGlow = rootsUnlocked
      ? `fill="${color}" fill-opacity="0.8" filter="url(#glow-${weaponType})"`
      : 'fill="rgba(255,255,255,0.2)"';
    const centerDot = `<circle cx="${CENTER_X}" cy="${CENTER_Y}" r="5" ${centerGlow}/>`;

    // Build node divs
    const nodes: string[] = [];
    for (const n of tree.nodes) {
      const pos = posMap.get(n.id)!;
      const leftPct = ((pos.x / SVG_W) * 100).toFixed(2);
      const topPct = ((pos.y / SVG_H) * 100).toFixed(2);
      const state = this._nodeState(n, ps, hasPoints, weaponType, tree);
      const stateClass = `wms-node--${state}`;
      const label = this._nodeLabel(n, ps);
      const maxPts = getNodeMaxPoints(n);
      const cost = n.cost ?? 1;

      // Prereq info for tooltip
      const implicitParent = getImplicitParent(n, tree);
      const prereqName = implicitParent ? this._esc(implicitParent.description) : '';

      nodes.push(`
        <div class="wms-node ${stateClass}"
          style="left: ${leftPct}%; top: ${topPct}%; --wc: ${color}"
          data-node-id="${n.id}"
          data-node-name="${this._esc(n.description)}"
          data-node-effect="${this._esc(n.effect)}"
          data-node-state="${state}"
          data-kill-threshold="${n.killThreshold}"
          data-max-points="${maxPts}"
          data-cost="${cost}"
          data-prereq-name="${prereqName}"
        >${label}</div>
      `);
    }

    return `
      <div class="wms-constellation-area" data-weapon-type="${weaponType}" style="height: ${areaHeight}px">
        <svg class="wms-constellation-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="none">
          <defs>
            <filter id="glow-${weaponType}" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          ${lines.join('\n          ')}
          ${skipLines.join('\n          ')}
          ${centerDot}
        </svg>
        ${nodes.join('\n        ')}
      </div>
    `;
  }

  /** Returns explicit position if the node has one; falls back to NODE_POSITIONS for legacy linear-branch nodes. */
  private _getNodePos(n: UpgradeNode): NodePos {
    if (n.x !== undefined && n.y !== undefined) {
      return { x: n.x, y: n.y };
    }
    // Legacy fallback: branch must be 'a' or 'b' for NODE_POSITIONS lookup
    const key = `${n.branch}_${n.nodeIndex}`;
    return NODE_POSITIONS[key] ?? { x: CENTER_X, y: CENTER_Y + n.nodeIndex * 30 };
  }

  /** Computes SVG viewBox height for a weapon tree. */
  private _svgHeight(tree: import('../systems/UpgradeTreeData').UpgradeTree): number {
    if (tree.svgHeight !== undefined) return tree.svgHeight;
    const maxIdx = tree.nodes.reduce((m, n) => Math.max(m, n.nodeIndex), 0);
    return maxIdx > 5 ? 380 : 240;
  }

  /** Generate the visible label for a node div. */
  private _nodeLabel(n: UpgradeNode, ps: MasteryPointStore): string {
    const maxPts = getNodeMaxPoints(n);
    if (maxPts <= 1) return String(n.nodeIndex);
    const current = ps.getNodePoints(n.id);
    return `${current}/${maxPts}`;
  }

  /** Determine visual state of a node. */
  private _nodeState(
    node: UpgradeNode,
    ps: MasteryPointStore,
    hasPoints: boolean,
    weaponType?: WeaponType,
    tree?: UpgradeTree | null,
  ): 'active-this-match' | 'unlocked-inactive' | 'unlocked' | 'partial' | 'affordable' | 'prereq-locked' | 'locked' {
    const nodeId = node.id;
    const maxPts = getNodeMaxPoints(node);
    const current = ps.getNodePoints(nodeId);

    if (current > 0) {
      // At least 1 point spent
      if (current < maxPts) {
        // Multi-level node, not yet at max — show as "partial" (can still accept points)
        return 'partial';
      }
      // Fully spent (or single-point node that's unlocked)
      if (this._matchUpgradeTracker && weaponType !== undefined) {
        const activeSet = this._matchUpgradeTracker.getActiveUpgrades(weaponType);
        return activeSet.has(nodeId) ? 'active-this-match' : 'unlocked-inactive';
      }
      return 'unlocked';
    }

    // Not yet unlocked — check prerequisites first
    if (tree && !isPrerequisiteMet(node, tree, ps)) return 'prereq-locked';

    // Prerequisite met — check if player can afford this node's cost
    const cost = node.cost ?? 1;
    // Per-weapon affordability check
    const nodeWeapon = weaponType ?? weaponTypeFromNodeId(node.id);
    if (nodeWeapon !== null && ps.getAvailablePoints(nodeWeapon as WeaponType) >= cost) return 'affordable';
    return 'locked';
  }

  /** Escape string for HTML attribute. */
  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ── Incremental DOM updates ─────────────────────────────────────────────────

  /** Update the points counter in the header. */
  private _updatePointsDisplay(): void {
    const ps = this._pointStore!;
    // Update global total points earned display
    const el = document.getElementById('wms-points-display');
    if (el) {
      el.textContent = String(ps.getTotalPoints());
      el.classList.remove('bump');
      // Force reflow then add class for animation
      void el.offsetWidth;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 200);
    }
    // Update per-weapon available-points badges
    this.container.querySelectorAll<HTMLElement>('[data-weapon-pts]').forEach(badge => {
      const wt = badge.dataset.weaponPts as WeaponType;
      badge.textContent = `${ps.getAvailablePoints(wt)} pts`;
    });
  }

  /** Re-render a single node's class/label without full re-render. */
  private _updateNodeEl(nodeEl: HTMLElement): void {
    const ps = this._pointStore!;
    const nodeId = nodeEl.dataset.nodeId!;
    // Extract weapon type from node id (format: "${weaponType}_${branch}_${index}")
    const weaponType = weaponTypeFromNodeId(nodeId) ?? undefined;
    const hasPoints = weaponType ? ps.getAvailablePoints(weaponType) > 0 : false;
    const maxPoints = parseInt(nodeEl.dataset.maxPoints ?? '1', 10);
    const cost = parseInt(nodeEl.dataset.cost ?? '1', 10);

    // Look up full node for prerequisite checks; fall back to minimal node
    const fullNode = getNodeById(nodeId) ?? ({ id: nodeId, maxPoints, cost } as UpgradeNode);
    const tree = weaponType ? (UPGRADE_TREES[weaponType] ?? null) : null;
    const state = this._nodeState(fullNode, ps, hasPoints, weaponType, tree);

    nodeEl.className = `wms-node wms-node--${state}`;
    nodeEl.dataset.nodeState = state;

    // Update label: N/Max for multi-level, else just the index
    if (maxPoints > 1) {
      const current = ps.getNodePoints(nodeId);
      nodeEl.textContent = `${current}/${maxPoints}`;
    } else {
      const nodeIndex = nodeId.split('_').pop() ?? '?';
      nodeEl.textContent = nodeIndex;
    }
  }

  /** Re-render all SVG lines for a given weapon card after state change. */
  private _updateConstellationLines(weaponType: WeaponType, color: string): void {
    const ps = this._pointStore!;
    const area = this.container.querySelector(`.wms-constellation-area[data-weapon-type="${weaponType}"]`);
    const svg = area?.querySelector('svg');
    if (!svg) return;

    const tree = UPGRADE_TREES[weaponType];

    // Regular lines (no data-skip attribute), indexed by tree.nodes order
    const regularLines = Array.from(svg.querySelectorAll<SVGLineElement>('line:not([data-skip])'));
    tree.nodes.forEach((n, i) => {
      const lineEl = regularLines[i];
      if (!lineEl) return;
      const childUnlocked = ps.isUnlocked(n.id);
      const prereqMet = isPrerequisiteMet(n, tree, ps);
      if (childUnlocked) {
        lineEl.setAttribute('stroke', color);
        lineEl.setAttribute('stroke-opacity', '0.90');
        lineEl.setAttribute('filter', `url(#glow-${weaponType})`);
      } else if (prereqMet) {
        lineEl.setAttribute('stroke', color);
        lineEl.setAttribute('stroke-opacity', '0.42');
        lineEl.removeAttribute('filter');
      } else {
        lineEl.setAttribute('stroke', 'rgba(255,255,255,0.14)');
        lineEl.setAttribute('stroke-opacity', '1');
        lineEl.removeAttribute('filter');
      }
    });

    // Skip connection lines
    if (tree.skipConnections) {
      const skipLines = Array.from(svg.querySelectorAll<SVGLineElement>('line[data-skip]'));
      tree.skipConnections.forEach((skip, i) => {
        const lineEl = skipLines[i];
        if (!lineEl) return;
        const fromUnlocked = ps.isUnlocked(skip.fromId);
        const toUnlocked = ps.isUnlocked(skip.toId);
        const opacity = fromUnlocked && toUnlocked ? '0.85' : fromUnlocked ? '0.45' : '0.12';
        lineEl.setAttribute('stroke-opacity', opacity);
        if (fromUnlocked && toUnlocked) {
          lineEl.setAttribute('filter', `url(#glow-${weaponType})`);
        } else {
          lineEl.removeAttribute('filter');
        }
      });
    }
  }

  // ── Event Listeners ─────────────────────────────────────────────────────────

  private _attachListeners(): void {
    // Delegated click on container
    // stopPropagation prevents clicks from reaching the game layer behind the overlay
    this.container.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;

      // Close button
      if (target.closest('[data-action="close"]')) {
        this.hide();
        return;
      }

      // Node click — left-click only adds points
      const nodeEl = target.closest<HTMLElement>('.wms-node');
      if (nodeEl) {
        this._handleNodeClick(nodeEl);
      }
    });

    // Right-click to refund (direct refund, no confirmation)
    // stopPropagation + preventDefault prevents game-layer context-menu and game interactions
    this.container.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const target = e.target as HTMLElement;
      const nodeEl = target.closest<HTMLElement>('.wms-node');
      if (nodeEl) {
        this._handleNodeRightClick(nodeEl);
      }
    });

    // Tooltip: mouseover
    this.container.addEventListener('mouseover', (e) => {
      const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.wms-node');
      if (nodeEl) {
        this._showTooltip(nodeEl);
      }
    });

    // Tooltip: mousemove (follow cursor)
    this.container.addEventListener('mousemove', (e) => {
      if (this.tooltip.classList.contains('visible')) {
        this._positionTooltip(e.clientX, e.clientY);
      }
    });

    // Tooltip: mouseout
    this.container.addEventListener('mouseout', (e) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.closest?.('.wms-node')) {
        this._hideTooltip();
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

  private _handleNodeClick(nodeEl: HTMLElement): void {
    const ps = this._pointStore!;
    const nodeId = nodeEl.dataset.nodeId!;
    const rawState = nodeEl.dataset.nodeState as string;
    const maxPoints = parseInt(nodeEl.dataset.maxPoints ?? '1', 10);
    const cost = parseInt(nodeEl.dataset.cost ?? '1', 10);

    // Left-click ONLY adds points — never refunds (right-click is for refunds)
    // States that allow spending: affordable, partial (multi-level, not yet at max)
    // prereq-locked and locked do NOT allow spending
    const canSpend = rawState === 'affordable' || rawState === 'partial';

    if (canSpend) {
      // For first-time unlock use cost; subsequent ranks on multi-level nodes still cost 1 each
      const pointsToSpend = rawState === 'affordable' ? cost : 1;
      const spent = ps.spendPoint(nodeId, maxPoints, pointsToSpend);
      if (spent) {
        this._updateNodeEl(nodeEl);
        this._refreshAllNodeStates();
        const weaponType = nodeEl.closest<HTMLElement>('.wms-card')?.dataset.weaponType as WeaponType;
        const color = nodeEl.style.getPropertyValue('--wc');
        if (weaponType) this._updateConstellationLines(weaponType, color);
        this._updatePointsDisplay();
      }
    }
    // unlocked, locked, active-this-match, unlocked-inactive: left-click does nothing
  }

  private _handleNodeRightClick(nodeEl: HTMLElement): void {
    const ps = this._pointStore!;
    const nodeId = nodeEl.dataset.nodeId!;
    const rawState = nodeEl.dataset.nodeState as string;

    // Right-click refunds 1 point from any node that has at least 1 point spent
    const canRefund =
      rawState === 'unlocked' ||
      rawState === 'partial' ||
      rawState === 'active-this-match' ||
      rawState === 'unlocked-inactive';

    if (canRefund) {
      const refunded = ps.refundPoint(nodeId);
      if (refunded) {
        this._updateNodeEl(nodeEl);
        this._refreshAllNodeStates();
        const weaponType = nodeEl.closest<HTMLElement>('.wms-card')?.dataset.weaponType as WeaponType;
        const color = nodeEl.style.getPropertyValue('--wc');
        if (weaponType) this._updateConstellationLines(weaponType, color);
        this._updatePointsDisplay();
      }
    }
    // locked or affordable nodes: no action on right-click
  }

  /** Refresh all nodes' visual state (e.g. after points change). */
  private _refreshAllNodeStates(): void {
    const ps = this._pointStore!;
    this.container.querySelectorAll<HTMLElement>('.wms-node').forEach(nodeEl => {
      const nodeId = nodeEl.dataset.nodeId!;
      // Use proper weapon extraction (supports multi-word types like chain_lightning)
      const weaponType = weaponTypeFromNodeId(nodeId) ?? undefined;
      const hasPoints = weaponType ? ps.getAvailablePoints(weaponType) > 0 : false;
      const maxPoints = parseInt(nodeEl.dataset.maxPoints ?? '1', 10);
      const cost = parseInt(nodeEl.dataset.cost ?? '1', 10);
      const fullNode = getNodeById(nodeId) ?? ({ id: nodeId, maxPoints, cost } as UpgradeNode);
      const tree = weaponType ? (UPGRADE_TREES[weaponType] ?? null) : null;
      const state = this._nodeState(fullNode, ps, hasPoints, weaponType, tree);
      nodeEl.className = `wms-node wms-node--${state}`;
      nodeEl.dataset.nodeState = state;
      if (maxPoints > 1) {
        const current = ps.getNodePoints(nodeId);
        nodeEl.textContent = `${current}/${maxPoints}`;
      } else {
        const nodeIndex = nodeId.split('_').pop() ?? '?';
        nodeEl.textContent = nodeIndex;
      }
    });
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────────

  private _showTooltip(nodeEl: HTMLElement): void {
    const ps = this._pointStore!;
    const nodeId = nodeEl.dataset.nodeId!;
    const name = nodeEl.dataset.nodeName ?? '';
    const effect = nodeEl.dataset.nodeEffect ?? '';
    const state = nodeEl.dataset.nodeState as string;
    const maxPoints = parseInt(nodeEl.dataset.maxPoints ?? '1', 10);
    const currentPoints = ps.getNodePoints(nodeId);

    const cost = parseInt(nodeEl.dataset.cost ?? '1', 10);
    let costHtml = '';
    if (state === 'affordable') {
      const costStr = cost > 1 ? `${cost} points (premium)` : '1 point';
      costHtml = `<div class="wms-tt-cost">Cost: ${costStr} &nbsp;·&nbsp; Left-click to unlock</div>`;
    } else if (state === 'partial') {
      const remaining = maxPoints - currentPoints;
      costHtml = `<div class="wms-tt-cost">Rank ${currentPoints}/${maxPoints} &nbsp;·&nbsp; Left-click to upgrade (+${remaining} point${remaining !== 1 ? 's' : ''} to max) &nbsp;·&nbsp; Right-click to refund 1 rank</div>`;
    } else if (state === 'active-this-match') {
      const rankStr = maxPoints > 1 ? ` (Rank ${currentPoints}/${maxPoints})` : '';
      costHtml = `<div class="wms-tt-cost">&#x2713; Active this match${rankStr} &nbsp;·&nbsp; Right-click to refund</div>`;
    } else if (state === 'unlocked-inactive') {
      const threshold = nodeEl.dataset.killThreshold ?? '?';
      const rankStr = maxPoints > 1 ? ` (Rank ${currentPoints}/${maxPoints})` : '';
      costHtml = `<div class="wms-tt-cost">Permanently unlocked${rankStr} &nbsp;·&nbsp; Get ${threshold} kills with this weapon to activate &nbsp;·&nbsp; Right-click to refund</div>`;
    } else if (state === 'unlocked') {
      const rankStr = maxPoints > 1 ? ` (Rank ${currentPoints}/${maxPoints})` : '';
      costHtml = `<div class="wms-tt-cost">Unlocked${rankStr} &nbsp;·&nbsp; Right-click to refund</div>`;
    } else if (state === 'prereq-locked') {
      const prereqName = nodeEl.dataset.prereqName ?? '';
      const prereqText = prereqName ? `Unlock <em>${prereqName}</em> first` : 'Unlock the previous node first';
      costHtml = `<div class="wms-tt-prereq">&#x26A0; ${prereqText}</div>`;
    } else {
      const costStr = cost > 1 ? `${cost} points` : '1 point';
      const nodeWeapon = weaponTypeFromNodeId(nodeId);
      const havePoints = nodeWeapon ? ps.getAvailablePoints(nodeWeapon) : 0;
      costHtml = `<div class="wms-tt-cost">Need ${costStr} to unlock &nbsp;(have: ${havePoints})</div>`;
    }

    this.tooltip.innerHTML = `
      <div class="wms-tt-name">${name}</div>
      <div class="wms-tt-effect">${effect}</div>
      ${costHtml}
    `;
    this.tooltip.classList.add('visible');
  }

  private _positionTooltip(mx: number, my: number): void {
    const offset = 16;
    let left = mx + offset;
    let top = my + offset;
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    if (left + tw > window.innerWidth - 8) left = mx - tw - offset;
    if (top + th > window.innerHeight - 8) top = my - th - offset;
    this.tooltip.style.left = left + 'px';
    this.tooltip.style.top = top + 'px';
  }

  private _hideTooltip(): void {
    this.tooltip.classList.remove('visible');
  }
}
