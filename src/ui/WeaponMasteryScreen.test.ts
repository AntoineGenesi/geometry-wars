/**
 * WeaponMasteryScreen unit tests — constellation UI.
 *
 * Runs in Node (no jsdom) — uses minimal DOM mock + vi.stubGlobal.
 * DOM-rendering tests verify innerHTML string content.
 * Interaction-logic tests go through MasteryPointStore directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UPGRADE_TREES, getBranchNodes, getAllNodes, getImplicitParent, isPrerequisiteMet } from '../systems/UpgradeTreeData';
import { WeaponType as WT } from '../weapons/WeaponTypes';

// ── Minimal DOM mock ──────────────────────────────────────────────────────────

type EventCallback = (e?: Event) => void;

class MockClassList {
  private _c = new Set<string>();
  add(cls: string) { for (const c of cls.split(' ')) this._c.add(c); }
  remove(cls: string) { for (const c of cls.split(' ')) this._c.delete(c); }
  contains(cls: string) { return this._c.has(cls); }
  toggle(cls: string) {
    if (this._c.has(cls)) this._c.delete(cls); else this._c.add(cls);
  }
}

class MockStyle {
  private _props: Record<string, string> = {};
  setProperty(p: string, v: string) { this._props[p] = v; }
  getPropertyValue(p: string) { return this._props[p] ?? ''; }
  [key: string]: unknown;
}

class MockElement {
  id = '';
  innerHTML = '';
  textContent = '';
  className = '';
  style = new MockStyle();
  dataset: Record<string, string> = {};
  classList = new MockClassList();
  parentElement: MockElement | null = null;
  children: MockElement[] = [];
  private _listeners = new Map<string, EventCallback[]>();
  get offsetWidth() { return 100; }
  get offsetHeight() { return 50; }

  getAttribute(_a: string): string | null { return null; }
  setAttribute(_a: string, _v: string): void { /* noop */ }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    }
  }

  addEventListener(event: string, cb: EventCallback, _opts?: unknown): void {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(cb);
  }

  removeEventListener(event: string, cb: EventCallback, _opts?: unknown): void {
    const arr = this._listeners.get(event);
    if (arr) this._listeners.set(event, arr.filter(h => h !== cb));
  }

  dispatchEvent(event: string, e?: Event): void {
    for (const h of (this._listeners.get(event) ?? [])) h(e);
  }

  click(): void { this.dispatchEvent('click'); }

  // Return null for all queries — tests use innerHTML string matching instead
  querySelector(_sel: string): MockElement | null { return null; }
  querySelectorAll(_sel: string): MockElement[] { return []; }
  closest(_sel: string): MockElement | null { return null; }
}

// ── Document + window mock ────────────────────────────────────────────────────

const mockBody = new MockElement();
const mockHead = new MockElement();
let _lastBodyChild: MockElement | null = null;
let _lastHeadChild: MockElement | null = null;
let _globalListeners = new Map<string, EventCallback[]>();

function setupDOMMock(): void {
  mockBody.children.length = 0;
  mockHead.children.length = 0;
  _lastBodyChild = null;
  _lastHeadChild = null;
  _globalListeners = new Map();

  const createdIds = new Map<string, MockElement>();

  const mockDocument = {
    createElement: (tag: string): MockElement => {
      const el = new MockElement();
      (el as unknown as { tagName: string }).tagName = tag.toUpperCase();
      // Intercept id set
      Object.defineProperty(el, 'id', {
        get() { return (this as { _id: string })._id ?? ''; },
        set(v: string) {
          (this as { _id: string })._id = v;
          createdIds.set(v, el);
        },
        configurable: true,
      });
      return el;
    },
    head: mockHead,
    body: {
      appendChild: (child: MockElement): MockElement => {
        _lastBodyChild = child;
        mockBody.children.push(child);
        child.parentElement = mockBody;
        return child;
      },
    },
    getElementById: (id: string): MockElement | null => createdIds.get(id) ?? null,
    addEventListener: (event: string, cb: EventCallback, _opts?: unknown) => {
      if (!_globalListeners.has(event)) _globalListeners.set(event, []);
      _globalListeners.get(event)!.push(cb);
    },
    removeEventListener: (event: string, cb: EventCallback, _opts?: unknown) => {
      const arr = _globalListeners.get(event);
      if (arr) _globalListeners.set(event, arr.filter(h => h !== cb));
    },
  };

  vi.stubGlobal('document', mockDocument);
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
  vi.stubGlobal('requestAnimationFrame', (_cb: () => void) => {
    // Don't auto-call — keeps tests synchronous
  });
}

// ── localStorage stub ─────────────────────────────────────────────────────────

let _lsStore: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => _lsStore[key] ?? null,
  setItem: (key: string, v: string) => { _lsStore[key] = v; },
  removeItem: (key: string) => { delete _lsStore[key]; },
  clear: () => { _lsStore = {}; },
};

vi.mock('../i18n', () => ({
  t: (key: string, opts?: Record<string, unknown>) => {
    if (key === 'mastery.levelBadge' && opts?.level !== undefined) return `Lv.${opts.level}`;
    return key;
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seed XP mastery data into localStorage. */
function seedMastery(xpMap: Partial<Record<string, number>>): void {
  const weapons: Record<string, { xp: number; gamesPlayed: number }> = {};
  for (const [type, xp] of Object.entries(xpMap)) {
    weapons[type] = { xp: xp as number, gamesPlayed: 1 };
  }
  _lsStore['gw_weapon_mastery'] = JSON.stringify({ version: 1, weapons });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WeaponMasteryScreen — constellation UI', () => {
  let WeaponMasteryScreen: typeof import('./WeaponMasteryScreen').WeaponMasteryScreen;
  let MasteryPointStore: typeof import('../systems/MasteryPointStore').MasteryPointStore;
  let screen: InstanceType<typeof WeaponMasteryScreen>;

  beforeEach(async () => {
    _lsStore = {};
    setupDOMMock();
    vi.stubGlobal('localStorage', localStorageMock);

    // Dynamic import so module init picks up the mocked DOM
    const mod = await import('./WeaponMasteryScreen');
    const psMod = await import('../systems/MasteryPointStore');
    WeaponMasteryScreen = mod.WeaponMasteryScreen;
    MasteryPointStore = psMod.MasteryPointStore;
    screen = new WeaponMasteryScreen();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  it('constructor creates a container element', () => {
    // Constructor should have appended two elements to body (container + tooltip)
    expect(mockBody.children.length).toBeGreaterThanOrEqual(1);
  });

  it('container starts with hidden class', () => {
    const container = mockBody.children[0];
    expect(container.classList.contains('hidden')).toBe(true);
  });

  it('show() removes hidden class from container', () => {
    screen.show();
    const container = mockBody.children[0];
    expect(container.classList.contains('hidden')).toBe(false);
  });

  it('show() sets non-empty innerHTML on container', () => {
    screen.show();
    const container = mockBody.children[0];
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it('hide() adds hidden class back', () => {
    screen.show();
    screen.hide();
    const container = mockBody.children[0];
    expect(container.classList.contains('hidden')).toBe(true);
  });

  it('dispose() removes container from DOM', () => {
    screen.show();
    const container = mockBody.children[0];
    screen.dispose();
    expect(mockBody.children.includes(container)).toBe(false);
  });

  it('onClose() callback fires when hide() is called', () => {
    const cb = vi.fn();
    screen.onClose(cb);
    screen.show();
    screen.hide();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('onClose() callback does NOT fire before hide()', () => {
    const cb = vi.fn();
    screen.onClose(cb);
    screen.show();
    expect(cb).not.toHaveBeenCalled();
  });

  // ── HTML output ────────────────────────────────────────────────────────────

  it('show() renders all 10 weapon cards (data-weapon-type in HTML)', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    for (const wt of Object.values(WT)) {
      expect(html).toContain(`data-weapon-type="${wt}"`);
    }
  });

  it('show() HTML contains level badges', () => {
    seedMastery({ [WT.Standard]: 100 });
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-level-badge');
    expect(html).toContain('Lv.1');
  });

  it('show() HTML contains XP fill bars with data-target-width', () => {
    seedMastery({ [WT.Standard]: 200 });
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('data-target-width');
    expect(html).toContain('wms-xp-fill');
  });

  it('show() HTML contains branch labels for each weapon', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // Standard uses 4-endpoint branching: sub-branch labels instead of trunk names
    expect(html).toContain('Scatter');   // Standard branchALName
    expect(html).toContain('Seeking');   // Standard branchBLName
    expect(html).toContain('DPS');       // TeslaCoil branchBName
  });

  it('show() HTML contains available points display', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-points-available');
    expect(html).toContain('Total Points Earned');
  });

  it('show() with 5 available points shows 5 in points display', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 5; i++) ps.earnPoint(WT.Standard);
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // Points display element should contain '5'
    expect(html).toContain('>5<');
  });

  it('show() HTML contains constellation node elements', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-node');
    expect(html).toContain('data-node-id');
  });

  it('show() HTML contains locked nodes when no points available', () => {
    const ps = new MasteryPointStore(); // 0 points
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-node--locked');
    expect(html).not.toContain('wms-node--affordable');
  });

  it('show() HTML contains affordable nodes when points available', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard);
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-node--affordable');
  });

  it('show() HTML contains unlocked node state when node is unlocked', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard);
    ps.earnPoint(WT.Standard);
    ps.spendPoint(`${WT.Standard}_a_1`);
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-node--unlocked');
  });

  it('show() HTML contains --wc CSS variable for weapon color', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('--wc:');
  });

  // ── UpgradeTreeData integration ────────────────────────────────────────────

  it('each weapon has at least 10 nodes in UPGRADE_TREES', () => {
    for (const wt of Object.values(WT)) {
      expect(UPGRADE_TREES[wt].nodes.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('Standard has 4-endpoint branching tree (32 nodes)', () => {
    expect(UPGRADE_TREES[WT.Standard].nodes).toHaveLength(32);
    // Trunk branches have 4 nodes each (split at level 4)
    expect(getBranchNodes(WT.Standard, 'a')).toHaveLength(4);
    expect(getBranchNodes(WT.Standard, 'b')).toHaveLength(4);
    // Sub-branches have 6 nodes each (levels 5-10)
    expect(getBranchNodes(WT.Standard, 'al')).toHaveLength(6);
    expect(getBranchNodes(WT.Standard, 'ar')).toHaveLength(6);
    expect(getBranchNodes(WT.Standard, 'bl')).toHaveLength(6);
    expect(getBranchNodes(WT.Standard, 'br')).toHaveLength(6);
  });

  it('Homing has 10-level branches (20 nodes)', () => {
    expect(UPGRADE_TREES[WT.Homing].nodes).toHaveLength(20);
    expect(getBranchNodes(WT.Homing, 'a')).toHaveLength(10);
    expect(getBranchNodes(WT.Homing, 'b')).toHaveLength(10);
  });

  it('non-extended weapons have 5-level branches (10 nodes each)', () => {
    const fiveLevel = [WT.Spread, WT.Piercing, WT.ChainLightning, WT.PlasmaMortar,
                       WT.GravityGun, WT.LaserBeam, WT.BlackHole, WT.TeslaCoil];
    for (const wt of fiveLevel) {
      expect(getBranchNodes(wt, 'a')).toHaveLength(5);
      expect(getBranchNodes(wt, 'b')).toHaveLength(5);
    }
  });

  it('node IDs follow weaponType_branch_index pattern (index 1-10)', () => {
    const nodes = getAllNodes();
    for (const n of nodes) {
      // branch may be a, b, al, ar, bl, br (Standard 4-endpoint tree)
      expect(n.id).toMatch(/^[a-zA-Z_]+_(a|b|al|ar|bl|br)_([1-9]|10)$/);
    }
  });

  // ── MasteryPointStore logic ────────────────────────────────────────────────

  it('setPointStore() lets the screen use the provided store', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 3; i++) ps.earnPoint(WT.Standard);
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('>3<');
  });

  it('spendPoint correctly reduces availablePoints', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard);
    ps.earnPoint(WT.Standard);
    ps.spendPoint(`${WT.Standard}_a_1`);
    expect(ps.getAvailablePoints(WT.Standard)).toBe(1);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(true);
  });

  it('refundPoint correctly restores availablePoints', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard);
    ps.spendPoint(`${WT.Standard}_a_1`);
    ps.refundPoint(`${WT.Standard}_a_1`);
    expect(ps.getAvailablePoints(WT.Standard)).toBe(1);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(false);
  });

  it('spending on already-unlocked node returns false', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard);
    ps.spendPoint(`${WT.Standard}_a_1`);
    const result = ps.spendPoint(`${WT.Standard}_a_1`);
    expect(result).toBe(false);
    expect(ps.getSpentPoints()).toBe(1);
  });

  // ── Right-click refund tests ────────────────────────────────────────────────

  it('right-click on unlocked node triggers refund directly (no pending state)', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard);
    ps.spendPoint(`${WT.Standard}_a_1`);
    expect(ps.getAvailablePoints(WT.Standard)).toBe(0);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(true);

    // Simulate right-click by calling refundPoint directly
    ps.refundPoint(`${WT.Standard}_a_1`);
    expect(ps.getAvailablePoints(WT.Standard)).toBe(1);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(false);
  });

  it('right-click on locked node does nothing', () => {
    const ps = new MasteryPointStore(); // No points
    expect(ps.getAvailablePoints(WT.Standard)).toBe(0);
    // Cannot refund a locked node
    const result = ps.refundPoint(`${WT.Standard}_a_1`);
    expect(result).toBe(false);
  });

  it('right-click on affordable node does nothing', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard); // 1 point available
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(false);
    // Cannot refund an unspent node
    const result = ps.refundPoint(`${WT.Standard}_a_1`);
    expect(result).toBe(false);
  });

  it('hint text mentions right-click refund option', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('Right-click to refund');
  });

  // ── Prerequisite enforcement tests ─────────────────────────────────────────

  it('tier-1 root nodes are affordable when player has points (no prereq)', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Standard);
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // Root nodes (a_1, b_1) should be affordable since they have no prerequisite
    expect(html).toContain('wms-node--affordable');
  });

  it('tier-2 nodes are prereq-locked when tier-1 is not unlocked', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 5; i++) ps.earnPoint(WT.Standard); // Plenty of points but nothing unlocked
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // Tier-2 nodes should be prereq-locked since tier-1 not unlocked
    expect(html).toContain('wms-node--prereq-locked');
    // Root tier-1 nodes should still be affordable
    expect(html).toContain('wms-node--affordable');
  });

  it('tier-2 node becomes affordable after tier-1 is fully unlocked', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 5; i++) ps.earnPoint(WT.Spread);
    // Unlock Spread weapon tier 1 on branch A
    ps.spendPoint(`${WT.Spread}_a_1`);
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // spread_a_2 should now be affordable (parent spread_a_1 is unlocked)
    // Its state should appear in the HTML
    expect(html).toContain(`data-node-id="${WT.Spread}_a_2"`);
    // With tier-1 unlocked and 4 remaining points, tier-2 should NOT be prereq-locked
    expect(html).not.toContain(`data-node-id="${WT.Spread}_a_2" `);  // ensure it's present
    // Verify via getImplicitParent / isPrerequisiteMet logic
    const tree = UPGRADE_TREES[WT.Spread];
    const a2 = tree.nodes.find(n => n.id === `${WT.Spread}_a_2`)!;
    expect(isPrerequisiteMet(a2, tree, ps)).toBe(true);
  });

  it('isPrerequisiteMet: root nodes always pass', () => {
    const ps = new MasteryPointStore(); // 0 points
    const tree = UPGRADE_TREES[WT.Spread];
    const a1 = tree.nodes.find(n => n.id === `${WT.Spread}_a_1`)!;
    expect(isPrerequisiteMet(a1, tree, ps)).toBe(true);
  });

  it('isPrerequisiteMet: tier-2 node fails when tier-1 not unlocked', () => {
    const ps = new MasteryPointStore();
    const tree = UPGRADE_TREES[WT.Spread];
    const a2 = tree.nodes.find(n => n.id === `${WT.Spread}_a_2`)!;
    expect(isPrerequisiteMet(a2, tree, ps)).toBe(false);
  });

  it('isPrerequisiteMet: tier-2 node passes when tier-1 is unlocked', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(WT.Spread);
    ps.spendPoint(`${WT.Spread}_a_1`);
    const tree = UPGRADE_TREES[WT.Spread];
    const a2 = tree.nodes.find(n => n.id === `${WT.Spread}_a_2`)!;
    expect(isPrerequisiteMet(a2, tree, ps)).toBe(true);
  });

  it('isPrerequisiteMet: multi-point parent must be FULLY unlocked (all points spent)', () => {
    const ps = new MasteryPointStore();
    // BlackHole a_1 has maxPoints=3 — spending only 1 is not enough for a_2
    for (let i = 0; i < 3; i++) ps.earnPoint(WT.BlackHole);
    ps.spendPoint(`${WT.BlackHole}_a_1`, 3); // Spend 1 of 3
    const tree = UPGRADE_TREES[WT.BlackHole];
    const a2 = tree.nodes.find(n => n.id === `${WT.BlackHole}_a_2`)!;
    // After 1 spend, parent has 1/3 points — prereq NOT met
    expect(isPrerequisiteMet(a2, tree, ps)).toBe(false);
    // After 2 more spends (3 total), prereq IS met
    ps.spendPoint(`${WT.BlackHole}_a_1`, 3, 1);
    ps.spendPoint(`${WT.BlackHole}_a_1`, 3, 1);
    expect(isPrerequisiteMet(a2, tree, ps)).toBe(true);
  });

  // ── getImplicitParent tests ────────────────────────────────────────────────

  it('getImplicitParent: root nodes return null', () => {
    const tree = UPGRADE_TREES[WT.Spread];
    const a1 = tree.nodes.find(n => n.id === `${WT.Spread}_a_1`)!;
    expect(getImplicitParent(a1, tree)).toBeNull();
  });

  it('getImplicitParent: non-root no-parentId nodes return previous same-branch node', () => {
    const tree = UPGRADE_TREES[WT.Spread];
    const a2 = tree.nodes.find(n => n.id === `${WT.Spread}_a_2`)!;
    const parent = getImplicitParent(a2, tree);
    expect(parent?.id).toBe(`${WT.Spread}_a_1`);
  });

  it('getImplicitParent: nodes with explicit parentId return that parent', () => {
    const tree = UPGRADE_TREES[WT.Standard];
    // al_5 has explicit parentId: standard_a_4
    const al5 = tree.nodes.find(n => n.id === 'standard_al_5')!;
    const parent = getImplicitParent(al5, tree);
    expect(parent?.id).toBe('standard_a_4');
  });

  // ── Skip connections tests ─────────────────────────────────────────────────

  it('Standard weapon has skip connections defined', () => {
    const tree = UPGRADE_TREES[WT.Standard];
    expect(tree.skipConnections).toBeDefined();
    expect(tree.skipConnections!.length).toBeGreaterThan(0);
  });

  it('skip connection allows accessing tier-3 from opposite branch tier-2', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 5; i++) ps.earnPoint(WT.Standard);
    // Unlock Standard trunk A tier 1 and tier 2 (skip source)
    ps.spendPoint('standard_a_1');
    ps.spendPoint('standard_a_2');
    const tree = UPGRADE_TREES[WT.Standard];
    // standard_b_3 normally requires standard_b_2 (which requires standard_b_1)
    // But standard_a_2 → standard_b_3 is a skip connection
    const b3 = tree.nodes.find(n => n.id === 'standard_b_3')!;
    // Without skip: b_1 and b_2 not unlocked, so prereq would fail normally
    // With skip from a_2 (unlocked): prereq IS met
    expect(isPrerequisiteMet(b3, tree, ps)).toBe(true);
  });

  it('skip connection does NOT help if skip source is NOT unlocked', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 5; i++) ps.earnPoint(WT.Standard);
    // Only unlock standard_a_1, NOT standard_a_2 (the skip source)
    ps.spendPoint('standard_a_1');
    const tree = UPGRADE_TREES[WT.Standard];
    const b3 = tree.nodes.find(n => n.id === 'standard_b_3')!;
    // standard_b_3 requires either standard_b_2 (not unlocked) OR standard_a_2 (not unlocked)
    expect(isPrerequisiteMet(b3, tree, ps)).toBe(false);
  });

  it('skip connection HTML contains dashed golden line markup', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // Skip lines should have data-skip attribute and dashed stroke
    expect(html).toContain('data-skip="true"');
    expect(html).toContain('stroke-dasharray');
    expect(html).toContain('#d4aa40'); // golden color
  });

  // ── Path visualization tests ───────────────────────────────────────────────

  it('SVG uses preserveAspectRatio="none" for accurate node-line alignment', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).not.toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('activated paths (unlocked nodes) use high opacity colored stroke', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 3; i++) ps.earnPoint(WT.Spread);
    ps.spendPoint(`${WT.Spread}_a_1`);
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // Activated lines should have stroke-opacity="0.85"
    expect(html).toContain('stroke-opacity="0.85"');
  });

  it('possible paths (prereq met, not yet unlocked) use low opacity colored stroke', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 3; i++) ps.earnPoint(WT.Spread);
    ps.spendPoint(`${WT.Spread}_a_1`); // Now a_2 is possible
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    // Possible lines (faint colored) should have stroke-opacity="0.22"
    expect(html).toContain('stroke-opacity="0.22"');
  });
});
