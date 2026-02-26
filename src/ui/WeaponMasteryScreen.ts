/**
 * Weapon Mastery Screen — full-screen constellation/space-themed upgrade tree.
 *
 * Each weapon is a "constellation" cluster: 2 branches × 3 nodes, connected by
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
import { MasteryPointStore } from '../systems/MasteryPointStore';
import { UPGRADE_TREES, UpgradeNode } from '../systems/UpgradeTreeData';

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
    #weapon-mastery-screen .wms-branch-label {
      font-size: 9px;
      letter-spacing: 2px;
      color: color-mix(in srgb, var(--wc, #888) 70%, white);
      text-transform: uppercase;
      opacity: 0.7;
    }

    /* ── Constellation area ── */
    #weapon-mastery-screen .wms-constellation-area {
      position: relative;
      width: 100%;
      height: 155px;
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

    /* locked — very dim */
    #weapon-mastery-screen .wms-node--locked {
      background: rgba(255,255,255,0.04);
      border: 2px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.2);
    }

    /* affordable — dim with gold ring */
    #weapon-mastery-screen .wms-node--affordable {
      background: rgba(255,200,0,0.06);
      border: 2px solid #ffcc00;
      color: #ffaa00;
      box-shadow: 0 0 8px rgba(255,200,0,0.5);
      animation: wms-gold-shimmer 2.5s ease-in-out infinite;
    }

    /* unlocked — bright weapon color glow */
    #weapon-mastery-screen .wms-node--unlocked {
      background: color-mix(in srgb, var(--wc, #888) 20%, rgba(0,0,0,0.5));
      border: 2px solid var(--wc, #888);
      color: var(--wc, #888);
      box-shadow: 0 0 10px var(--wc, #888), 0 0 22px color-mix(in srgb, var(--wc, #888) 50%, transparent);
      animation: wms-node-pulse 2.2s ease-in-out infinite;
    }

    /* pending refund — gold outline, "?" text */
    #weapon-mastery-screen .wms-node--refund-pending {
      background: rgba(255,80,80,0.12);
      border: 2px solid #ff6644;
      color: #ff8866;
      box-shadow: 0 0 10px #ff6644;
      animation: none;
    }

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

// ── Node layout constants (SVG viewBox 280×155) ───────────────────────────────

interface NodePos { x: number; y: number; }

const NODE_POSITIONS: Record<string, NodePos> = {
  // Branch A: down-left
  'a_1': { x: 95,  y: 52  },
  'a_2': { x: 57,  y: 95  },
  'a_3': { x: 20,  y: 138 },
  // Branch B: down-right
  'b_1': { x: 185, y: 52  },
  'b_2': { x: 223, y: 95  },
  'b_3': { x: 260, y: 138 },
};

const SVG_W = 280;
const SVG_H = 155;
// Center junction point (where the two branches split)
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
  private _pendingRefundNodeId: string | null = null;

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
   * Show the screen. Pass a MasteryStore to load XP data; if omitted loads fresh.
   * MasteryPointStore must be set via setPointStore() beforehand (or a fresh one is loaded).
   */
  show(store?: MasteryStore): void {
    this._masteryStore = store ?? MasteryStore.load();
    if (!this._pointStore) {
      this._pointStore = MasteryPointStore.load();
    }
    this._pendingRefundNodeId = null;

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
          <span class="wms-points-available" id="wms-points-display">${ps.availablePoints}</span>
          <span class="wms-points-label">Available Points</span>
          <span class="wms-points-secondary">Earned: ${ps.getTotalPoints()} &nbsp;|&nbsp; Spent: ${ps.getSpentPoints()}</span>
        </div>
        <div class="wms-grid">
          ${cards}
        </div>
        <div class="wms-hint">Hover node for details &middot; Click to unlock &middot; Right-click to refund &middot; ESC to close</div>
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
        </div>
        <div class="wms-xp-row">
          <span class="wms-xp-label">XP</span>
          <div class="wms-xp-bg">
            <div class="wms-xp-fill" data-target-width="${pct.toFixed(1)}" style="background: ${color};"></div>
          </div>
          <span class="wms-xp-val">${xpLabel}</span>
        </div>
        <div class="wms-branch-labels">
          <span class="wms-branch-label">${tree.branchAName}</span>
          <span class="wms-branch-label">${tree.branchBName}</span>
        </div>
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
    const hasPoints = ps.availablePoints > 0;

    // Build SVG lines
    const lines: string[] = [];
    const lineStyle = (unlocked: boolean) =>
      unlocked
        ? `stroke="${color}" stroke-opacity="0.5" filter="url(#glow-${weaponType})"`
        : 'stroke="rgba(255,255,255,0.08)"';

    // Center → A1
    const a1 = NODE_POSITIONS['a_1'];
    const b1 = NODE_POSITIONS['b_1'];
    const a1Unlocked = ps.isUnlocked(`${weaponType}_a_1`);
    const b1Unlocked = ps.isUnlocked(`${weaponType}_b_1`);

    lines.push(`<line x1="${CENTER_X}" y1="${CENTER_Y}" x2="${a1.x}" y2="${a1.y}" stroke-width="1.5" ${lineStyle(a1Unlocked)}/>`);
    lines.push(`<line x1="${CENTER_X}" y1="${CENTER_Y}" x2="${b1.x}" y2="${b1.y}" stroke-width="1.5" ${lineStyle(b1Unlocked)}/>`);

    // Chain lines within each branch
    for (const branch of ['a', 'b'] as const) {
      for (let i = 1; i <= 2; i++) {
        const from = NODE_POSITIONS[`${branch}_${i}`];
        const to = NODE_POSITIONS[`${branch}_${i + 1}`];
        const toUnlocked = ps.isUnlocked(`${weaponType}_${branch}_${i + 1}`);
        lines.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke-width="1.5" ${lineStyle(toUnlocked)}/>`);
      }
    }

    // Center dot (weapon icon)
    const centerUnlocked = a1Unlocked || b1Unlocked;
    const centerGlow = centerUnlocked
      ? `fill="${color}" fill-opacity="0.8" filter="url(#glow-${weaponType})"`
      : 'fill="rgba(255,255,255,0.2)"';
    const centerDot = `<circle cx="${CENTER_X}" cy="${CENTER_Y}" r="5" ${centerGlow}/>`;

    // Build node divs
    const nodes: string[] = [];
    for (const n of tree.nodes) {
      const pos = NODE_POSITIONS[`${n.branch}_${n.nodeIndex}`];
      const leftPct = ((pos.x / SVG_W) * 100).toFixed(2);
      const topPct = ((pos.y / SVG_H) * 100).toFixed(2);
      const state = this._nodeState(n.id, ps, hasPoints);
      const isPendingRefund = this._pendingRefundNodeId === n.id;
      const stateClass = isPendingRefund ? 'wms-node--refund-pending' : `wms-node--${state}`;
      const label = isPendingRefund ? '↩' : String(n.nodeIndex);

      nodes.push(`
        <div class="wms-node ${stateClass}"
          style="left: ${leftPct}%; top: ${topPct}%; --wc: ${color}"
          data-node-id="${n.id}"
          data-node-name="${this._esc(n.description)}"
          data-node-effect="${this._esc(n.effect)}"
          data-node-state="${state}"
          data-kill-threshold="${n.killThreshold}"
        >${label}</div>
      `);
    }

    return `
      <div class="wms-constellation-area" data-weapon-type="${weaponType}">
        <svg class="wms-constellation-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="glow-${weaponType}" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          ${lines.join('\n          ')}
          ${centerDot}
        </svg>
        ${nodes.join('\n        ')}
      </div>
    `;
  }

  /** Determine visual state of a node. */
  private _nodeState(
    nodeId: string,
    ps: MasteryPointStore,
    hasPoints: boolean,
  ): 'unlocked' | 'affordable' | 'locked' {
    if (ps.isUnlocked(nodeId)) return 'unlocked';
    if (hasPoints) return 'affordable';
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
    const el = document.getElementById('wms-points-display');
    if (el) {
      el.textContent = String(ps.availablePoints);
      el.classList.remove('bump');
      // Force reflow then add class for animation
      void el.offsetWidth;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 200);
    }
    // Update secondary counters
    const bar = this.container.querySelector('.wms-points-secondary');
    if (bar) {
      bar.innerHTML = `Earned: ${ps.getTotalPoints()} &nbsp;|&nbsp; Spent: ${ps.getSpentPoints()}`;
    }
  }

  /** Re-render a single node's class/label without full re-render. */
  private _updateNodeEl(nodeEl: HTMLElement): void {
    const ps = this._pointStore!;
    const nodeId = nodeEl.dataset.nodeId!;
    const hasPoints = ps.availablePoints > 0;
    const state = this._nodeState(nodeId, ps, hasPoints);
    const isPendingRefund = this._pendingRefundNodeId === nodeId;

    nodeEl.className = `wms-node ${isPendingRefund ? 'wms-node--refund-pending' : `wms-node--${state}`}`;
    nodeEl.dataset.nodeState = state;

    const nodeIndex = nodeId.split('_').pop() ?? '?';
    nodeEl.textContent = isPendingRefund ? '↩' : nodeIndex;
  }

  /** Re-render all SVG lines for a given weapon card after state change. */
  private _updateConstellationLines(weaponType: WeaponType, color: string): void {
    const ps = this._pointStore!;
    const area = this.container.querySelector(`.wms-constellation-area[data-weapon-type="${weaponType}"]`);
    const svg = area?.querySelector('svg');
    if (!svg) return;

    const updateLine = (nodeId: string, lineEl: SVGLineElement | null) => {
      if (!lineEl) return;
      const unlocked = ps.isUnlocked(nodeId);
      lineEl.setAttribute('stroke', unlocked ? color : 'rgba(255,255,255,0.08)');
      lineEl.setAttribute('stroke-opacity', unlocked ? '0.5' : '1');
    };

    const lines = svg.querySelectorAll<SVGLineElement>('line');
    // Lines order: center→A1, center→B1, A1→A2, A2→A3, B1→B2, B2→B3
    const nodeIds = [
      `${weaponType}_a_1`,
      `${weaponType}_b_1`,
      `${weaponType}_a_2`,
      `${weaponType}_a_3`,
      `${weaponType}_b_2`,
      `${weaponType}_b_3`,
    ];
    lines.forEach((line, i) => updateLine(nodeIds[i], line));
  }

  // ── Event Listeners ─────────────────────────────────────────────────────────

  private _attachListeners(): void {
    // Delegated click on container
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Close button
      if (target.closest('[data-action="close"]')) {
        this.hide();
        return;
      }

      // Node click
      const nodeEl = target.closest<HTMLElement>('.wms-node');
      if (nodeEl) {
        this._handleNodeClick(nodeEl);
        return;
      }

      // Click elsewhere → cancel pending refund
      if (this._pendingRefundNodeId) {
        const pendingEl = this.container.querySelector<HTMLElement>(
          `[data-node-id="${this._pendingRefundNodeId}"]`
        );
        this._pendingRefundNodeId = null;
        if (pendingEl) this._updateNodeEl(pendingEl);
      }
    });

    // Right-click to refund (direct refund, no confirmation)
    this.container.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      const nodeEl = target.closest<HTMLElement>('.wms-node');
      if (nodeEl) {
        e.preventDefault(); // Prevent browser context menu
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
    const state = nodeEl.dataset.nodeState as 'unlocked' | 'affordable' | 'locked';

    if (state === 'affordable') {
      const spent = ps.spendPoint(nodeId);
      if (spent) {
        this._pendingRefundNodeId = null;
        this._updateNodeEl(nodeEl);
        // Update sibling nodes (affordability may have changed)
        this._refreshAllNodeStates();
        // Update SVG lines for the weapon
        const weaponType = nodeEl.closest<HTMLElement>('.wms-card')?.dataset.weaponType as WeaponType;
        const color = nodeEl.style.getPropertyValue('--wc');
        if (weaponType) this._updateConstellationLines(weaponType, color);
        this._updatePointsDisplay();
      }
    } else if (state === 'unlocked') {
      if (this._pendingRefundNodeId === nodeId) {
        // Confirmed refund
        const refunded = ps.refundPoint(nodeId);
        if (refunded) {
          this._pendingRefundNodeId = null;
          this._updateNodeEl(nodeEl);
          this._refreshAllNodeStates();
          const weaponType = nodeEl.closest<HTMLElement>('.wms-card')?.dataset.weaponType as WeaponType;
          const color = nodeEl.style.getPropertyValue('--wc');
          if (weaponType) this._updateConstellationLines(weaponType, color);
          this._updatePointsDisplay();
        }
      } else {
        // First click: enter refund-pending state
        // Clear any previously pending refund
        if (this._pendingRefundNodeId) {
          const prev = this.container.querySelector<HTMLElement>(
            `[data-node-id="${this._pendingRefundNodeId}"]`
          );
          if (prev) this._updateNodeEl(prev);
        }
        this._pendingRefundNodeId = nodeId;
        this._updateNodeEl(nodeEl);
      }
    }
    // locked nodes: no action
  }

  private _handleNodeRightClick(nodeEl: HTMLElement): void {
    const ps = this._pointStore!;
    const nodeId = nodeEl.dataset.nodeId!;
    const state = nodeEl.dataset.nodeState as 'unlocked' | 'affordable' | 'locked';

    // Right-click refund: only works on unlocked nodes, refund immediately (no pending state)
    if (state === 'unlocked') {
      const refunded = ps.refundPoint(nodeId);
      if (refunded) {
        this._pendingRefundNodeId = null;
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
    const hasPoints = ps.availablePoints > 0;
    this.container.querySelectorAll<HTMLElement>('.wms-node').forEach(nodeEl => {
      const nodeId = nodeEl.dataset.nodeId!;
      if (this._pendingRefundNodeId !== nodeId) {
        const state = this._nodeState(nodeId, ps, hasPoints);
        nodeEl.className = `wms-node wms-node--${state}`;
        nodeEl.dataset.nodeState = state;
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
    const state = nodeEl.dataset.nodeState as 'unlocked' | 'affordable' | 'locked';
    const isPendingRefund = this._pendingRefundNodeId === nodeId;

    let costHtml = '';
    if (isPendingRefund) {
      costHtml = '<div class="wms-tt-cost">Click again to confirm refund</div>';
    } else if (state === 'affordable') {
      costHtml = '<div class="wms-tt-cost">Cost: 1 point &nbsp;·&nbsp; Click to unlock</div>';
    } else if (state === 'unlocked') {
      costHtml = '<div class="wms-tt-cost">Unlocked &nbsp;·&nbsp; Click to refund</div>';
    } else {
      costHtml = `<div class="wms-tt-cost">Need points to unlock &nbsp;(have: ${ps.availablePoints})</div>`;
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
