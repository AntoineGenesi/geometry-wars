/**
 * BuildChoiceScreen — in-game overlay shown when a kill threshold is crossed.
 *
 * The game is already paused when this appears.  The player must click a card
 * (or press Enter on the highlighted one) to confirm a build choice and resume.
 * Pressing Escape is blocked — the player must choose.
 *
 * If only one node is available the screen auto-confirms after a short delay.
 */

import { WeaponType, WEAPON_CONFIGS } from '../weapons/WeaponTypes';
import { UPGRADE_TREES, getNodeById, getImplicitParent, UpgradeNode, UpgradeTree } from '../systems/UpgradeTreeData';
import { getMpUpgradeNodeSupport } from '../shared/WeaponUpgradeEffects';

export interface BuildChoiceScreenOptions {
  mode?: 'sp' | 'mp';
  unsupportedNodeIds?: readonly string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns true if `nodeId` is excluded by any of the currently active node IDs. */
function isExcludedByActive(
  nodeId: string,
  tree: UpgradeTree,
  activeIds: ReadonlySet<string>,
): boolean {
  // Bidirectional pairs from the tree
  if (tree.exclusionPairs) {
    for (const [a, b] of tree.exclusionPairs) {
      if ((a === nodeId && activeIds.has(b)) || (b === nodeId && activeIds.has(a))) {
        return true;
      }
    }
  }
  // One-directional node.excludes: any active node that lists this node as excluded
  for (const activeId of activeIds) {
    const activeNode = tree.nodes.find(n => n.id === activeId);
    if (activeNode?.excludes?.includes(nodeId)) return true;
  }
  // This node's own excludes list: if this node excludes an active node, it's blocked
  const thisNode = tree.nodes.find(n => n.id === nodeId);
  if (thisNode?.excludes) {
    for (const ex of thisNode.excludes) {
      if (activeIds.has(ex)) return true;
    }
  }
  return false;
}

/** Returns the name of the first active node that conflicts with `nodeId`, or null. */
function conflictingNodeName(
  nodeId: string,
  tree: UpgradeTree,
  activeIds: ReadonlySet<string>,
): string | null {
  if (tree.exclusionPairs) {
    for (const [a, b] of tree.exclusionPairs) {
      if (a === nodeId && activeIds.has(b)) return tree.nodes.find(n => n.id === b)?.description ?? b;
      if (b === nodeId && activeIds.has(a)) return tree.nodes.find(n => n.id === a)?.description ?? a;
    }
  }
  for (const activeId of activeIds) {
    const activeNode = tree.nodes.find(n => n.id === activeId);
    if (activeNode?.excludes?.includes(nodeId)) return activeNode.description;
  }
  const thisNode = tree.nodes.find(n => n.id === nodeId);
  if (thisNode?.excludes) {
    for (const ex of thisNode.excludes) {
      if (activeIds.has(ex)) return tree.nodes.find(n => n.id === ex)?.description ?? ex;
    }
  }
  return null;
}

// ── Main class ─────────────────────────────────────────────────────────────────

export class BuildChoiceScreen {
  private overlay: HTMLDivElement;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private cards: HTMLDivElement[] = [];
  private selectedIndex = 0;
  private selectableIndices: number[] = []; // indices of non-excluded cards

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'build-choice-screen';
    this._injectStyles();
    this.overlay.classList.add('hidden');
    document.body.appendChild(this.overlay);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Show the build-choice overlay.
   *
   * @param weaponType    - Which weapon triggered the threshold.
   * @param availableNodeIds - Node IDs offered by MatchUpgradeTracker.
   * @param activeIds     - Nodes already confirmed this match (for exclusion display).
   * @param killCount     - Current in-match kill count for this weapon.
   * @param onConfirm     - Called with the chosen nodeId when the player confirms.
   */
  show(
    weaponType: WeaponType,
    availableNodeIds: string[],
    activeIds: ReadonlySet<string>,
    killCount: number,
    onConfirm: (nodeId: string) => void,
    options: BuildChoiceScreenOptions = {},
  ): void {
    const tree = UPGRADE_TREES[weaponType];
    if (!tree) return;

    const weaponName = WEAPON_CONFIGS[weaponType]?.name ?? String(weaponType);
    this._render(weaponName, weaponType, availableNodeIds, tree, activeIds, killCount, onConfirm, options);

    this.overlay.classList.remove('hidden');

    // Auto-confirm if only one selectable option
    const onlyOne = this.selectableIndices.length === 1 && availableNodeIds.length <= 1;
    if (onlyOne) {
      const confirmIdx = this.selectableIndices[0];
      const nodeId = availableNodeIds[confirmIdx];
      if (nodeId) {
        this.autoTimer = setTimeout(() => {
          this.hide();
          onConfirm(nodeId);
        }, 1200);
      }
    }

    // Keyboard handler
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return; // blocked — must choose
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        this._moveSelection(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        this._moveSelection(-1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const nodeId = availableNodeIds[this.selectedIndex];
        if (nodeId && this.selectableIndices.includes(this.selectedIndex)) {
          this.hide();
          onConfirm(nodeId);
        }
      }
    };
    document.addEventListener('keydown', this.keyHandler, true);
  }

  hide(): void {
    if (this.autoTimer !== null) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.cards = [];
    this.selectableIndices = [];
    this.selectedIndex = 0;
  }

  dispose(): void {
    this.hide();
    this.overlay.remove();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _render(
    weaponName: string,
    weaponType: WeaponType,
    nodeIds: string[],
    tree: UpgradeTree,
    activeIds: ReadonlySet<string>,
    killCount: number,
    onConfirm: (nodeId: string) => void,
    options: BuildChoiceScreenOptions,
  ): void {
    const color = '#' + (WEAPON_CONFIGS[weaponType]?.color ?? 0xffffff).toString(16).padStart(6, '0');
    const explicitlyUnsupported = new Set(options.unsupportedNodeIds ?? []);
    const mpMode = options.mode === 'mp';

    this.cards = [];
    this.selectableIndices = [];
    this.selectedIndex = -1;

    const header = document.createElement('div');
    header.className = 'bcs-header';
    header.innerHTML = `
      <div class="bcs-title">UPGRADE AVAILABLE</div>
      <div class="bcs-weapon" style="color:${color}">${weaponName}</div>
      <div class="bcs-kills">${killCount} kills this match</div>
    `;

    const cardsRow = document.createElement('div');
    cardsRow.className = 'bcs-cards';

    nodeIds.forEach((nodeId, idx) => {
      const node: UpgradeNode | undefined = getNodeById(nodeId);
      if (!node) return;

      const excluded = isExcludedByActive(nodeId, tree, activeIds);
      const conflictName = excluded ? conflictingNodeName(nodeId, tree, activeIds) : null;
      const isPremium = (node.cost ?? 1) > 1;
      const support = mpMode ? getMpUpgradeNodeSupport(nodeId) : null;
      const mpUnsupported = explicitlyUnsupported.has(nodeId) || support?.status === 'unsupported';
      const isCapstone = !tree.nodes.some(candidate => getImplicitParent(candidate, tree)?.id === node.id);
      const selectable = !excluded && !mpUnsupported;

      if (selectable) {
        if (this.selectedIndex === -1) this.selectedIndex = idx;
        this.selectableIndices.push(idx);
      }

      const card = document.createElement('div');
      card.className = 'bcs-card' + (!selectable ? ' bcs-excluded' : '');
      card.dataset.idx = String(idx);

      card.innerHTML = `
        <div class="bcs-meta">
          ${isPremium ? '<span class="bcs-chip bcs-chip-premium">2pt path</span>' : '<span class="bcs-chip">1pt</span>'}
          ${isCapstone ? '<span class="bcs-chip bcs-chip-capstone">capstone</span>' : ''}
          ${mpMode && !mpUnsupported ? '<span class="bcs-chip bcs-chip-mp">MP proven</span>' : ''}
        </div>
        <div class="bcs-node-name">${node.description}</div>
        <div class="bcs-node-effect">${node.effect}</div>
        <div class="bcs-node-threshold">${node.killThreshold} kills required</div>
        ${excluded ? `<div class="bcs-conflict">✕ conflicts with: ${conflictName ?? 'another node'}</div>` : ''}
        ${mpUnsupported ? `<div class="bcs-conflict">✕ MP unsupported: ${support?.reason ?? 'not server-authoritative'}</div>` : ''}
      `;

      if (selectable) {
        card.addEventListener('click', () => {
          this.hide();
          onConfirm(nodeId);
        });
        card.addEventListener('mouseenter', () => {
          this.selectedIndex = idx;
          this._updateHighlight();
          // Highlight cards that would conflict if this card were chosen
          const hypotheticalActive = new Set([...activeIds, nodeId]);
          this.cards.forEach((otherCard, otherIdx) => {
            if (otherIdx === idx) return;
            const otherId = nodeIds[otherIdx];
            if (otherId && !otherCard.classList.contains('bcs-excluded')) {
              const willConflict = isExcludedByActive(otherId, tree, hypotheticalActive);
              otherCard.classList.toggle('bcs-will-conflict', willConflict);
            }
          });
        });
        card.addEventListener('mouseleave', () => {
          this.cards.forEach(c => c.classList.remove('bcs-will-conflict'));
        });
      }

      this.cards.push(card);
      cardsRow.appendChild(card);
    });

    // Default selection highlight
    if (this.selectedIndex === -1 && this.cards.length > 0) this.selectedIndex = 0;
    this._updateHighlight();

    const hint = document.createElement('div');
    hint.className = 'bcs-hint';
    hint.textContent = 'Click a card or use ← → + Enter to choose';

    this.overlay.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'bcs-panel';
    panel.append(header, cardsRow, hint);
    this.overlay.appendChild(panel);

    // Re-attach cards to DOM (they were appended to cardsRow before panel was built)
    // Actually cardsRow already has them — but we need the panel in the DOM first
    // so event listeners still work. They're already in cardsRow which is in panel.
  }

  private _moveSelection(delta: number): void {
    if (this.selectableIndices.length === 0) return;
    const pos = this.selectableIndices.indexOf(this.selectedIndex);
    const next = (pos + delta + this.selectableIndices.length) % this.selectableIndices.length;
    this.selectedIndex = this.selectableIndices[next];
    this._updateHighlight();
  }

  private _updateHighlight(): void {
    this.cards.forEach((card, idx) => {
      card.classList.toggle('bcs-selected', idx === this.selectedIndex);
    });
  }

  private _injectStyles(): void {
    if (document.getElementById('build-choice-screen-styles')) return;
    const style = document.createElement('style');
    style.id = 'build-choice-screen-styles';
    style.textContent = `
      #build-choice-screen {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 20, 0.88);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(8px);
      }
      #build-choice-screen.hidden { display: none; }

      .bcs-panel {
        max-width: 860px;
        width: 95%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 28px;
      }

      .bcs-header { text-align: center; }
      .bcs-title {
        font-size: 13px;
        letter-spacing: 5px;
        color: #556677;
        margin-bottom: 6px;
      }
      .bcs-weapon {
        font-size: 32px;
        font-weight: bold;
        letter-spacing: 3px;
        text-shadow: 0 0 12px currentColor;
        margin-bottom: 4px;
      }
      .bcs-kills {
        font-size: 14px;
        color: #6688aa;
        letter-spacing: 2px;
      }

      .bcs-cards {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .bcs-card {
        background: rgba(0, 10, 30, 0.9);
        border: 1px solid rgba(0, 120, 200, 0.4);
        border-radius: 8px;
        padding: 20px 22px;
        width: 180px;
        cursor: pointer;
        transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
        display: flex;
        flex-direction: column;
        gap: 10px;
        position: relative;
      }
      .bcs-card:not(.bcs-excluded):hover,
      .bcs-card.bcs-selected {
        border-color: rgba(0, 200, 255, 0.9);
        box-shadow: 0 0 20px rgba(0, 200, 255, 0.35), 0 0 6px rgba(0, 200, 255, 0.2) inset;
        transform: translateY(-2px);
      }
      .bcs-excluded {
        cursor: default;
        opacity: 0.35;
        border-color: rgba(80, 80, 100, 0.3);
      }
      .bcs-will-conflict {
        opacity: 0.4;
        border-color: rgba(255, 60, 60, 0.5);
        box-shadow: 0 0 12px rgba(255, 60, 60, 0.2) inset;
        transform: none !important;
      }

      .bcs-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        min-height: 18px;
      }
      .bcs-chip {
        border: 1px solid rgba(255,255,255,0.12);
        color: #778899;
        font-size: 10px;
        line-height: 1;
        padding: 3px 5px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .bcs-chip-premium {
        border-color: rgba(255, 204, 68, 0.38);
        color: #ffcc66;
      }
      .bcs-chip-capstone {
        border-color: rgba(136, 204, 255, 0.35);
        color: #aaddff;
      }
      .bcs-chip-mp {
        border-color: rgba(68, 255, 136, 0.28);
        color: #88ffbb;
      }

      .bcs-premium {
        font-size: 10px;
        letter-spacing: 2px;
        color: #ffcc44;
        text-shadow: 0 0 8px #ffcc44;
        font-weight: bold;
      }
      .bcs-node-name {
        font-size: 17px;
        font-weight: bold;
        color: #ddeeff;
        line-height: 1.2;
      }
      .bcs-node-effect {
        font-size: 13px;
        color: #7799bb;
        line-height: 1.4;
        flex: 1;
      }
      .bcs-node-threshold {
        font-size: 11px;
        color: #445566;
        letter-spacing: 1px;
      }
      .bcs-conflict {
        font-size: 11px;
        color: #cc4444;
        letter-spacing: 0.5px;
      }

      .bcs-hint {
        font-size: 12px;
        color: #334455;
        letter-spacing: 2px;
      }
    `;
    document.head.appendChild(style);
  }
}
