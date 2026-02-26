/**
 * WeaponMasteryScreen unit tests — constellation UI.
 *
 * Runs in Node (no jsdom) — uses minimal DOM mock + vi.stubGlobal.
 * DOM-rendering tests verify innerHTML string content.
 * Interaction-logic tests go through MasteryPointStore directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UPGRADE_TREES, getBranchNodes, getAllNodes } from '../systems/UpgradeTreeData';
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
    // Damage and Rate are branch names for Standard weapon
    expect(html).toContain('Damage');
    expect(html).toContain('Rate');
  });

  it('show() HTML contains available points display', () => {
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-points-available');
    expect(html).toContain('Available Points');
  });

  it('show() with 5 available points shows 5 in points display', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 5; i++) ps.earnPoint();
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
    ps.earnPoint();
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('wms-node--affordable');
  });

  it('show() HTML contains unlocked node state when node is unlocked', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint();
    ps.earnPoint();
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

  it('each weapon has exactly 10 nodes in UPGRADE_TREES', () => {
    for (const wt of Object.values(WT)) {
      expect(UPGRADE_TREES[wt].nodes).toHaveLength(10);
    }
  });

  it('each weapon has branch a and branch b nodes (5 each)', () => {
    for (const wt of Object.values(WT)) {
      expect(getBranchNodes(wt, 'a')).toHaveLength(5);
      expect(getBranchNodes(wt, 'b')).toHaveLength(5);
    }
  });

  it('node IDs follow weaponType_branch_index pattern', () => {
    const nodes = getAllNodes();
    for (const n of nodes) {
      expect(n.id).toMatch(/^[a-zA-Z_]+_[ab]_[12345]$/);
    }
  });

  // ── MasteryPointStore logic ────────────────────────────────────────────────

  it('setPointStore() lets the screen use the provided store', () => {
    const ps = new MasteryPointStore();
    for (let i = 0; i < 3; i++) ps.earnPoint();
    screen.setPointStore(ps);
    screen.show();
    const html = mockBody.children[0].innerHTML;
    expect(html).toContain('>3<');
  });

  it('spendPoint correctly reduces availablePoints', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint();
    ps.earnPoint();
    ps.spendPoint(`${WT.Standard}_a_1`);
    expect(ps.availablePoints).toBe(1);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(true);
  });

  it('refundPoint correctly restores availablePoints', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint();
    ps.spendPoint(`${WT.Standard}_a_1`);
    ps.refundPoint(`${WT.Standard}_a_1`);
    expect(ps.availablePoints).toBe(1);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(false);
  });

  it('spending on already-unlocked node returns false', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint();
    ps.spendPoint(`${WT.Standard}_a_1`);
    const result = ps.spendPoint(`${WT.Standard}_a_1`);
    expect(result).toBe(false);
    expect(ps.getSpentPoints()).toBe(1);
  });

  // ── Right-click refund tests ────────────────────────────────────────────────

  it('right-click on unlocked node triggers refund directly (no pending state)', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint();
    ps.spendPoint(`${WT.Standard}_a_1`);
    expect(ps.availablePoints).toBe(0);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(true);

    // Simulate right-click by calling refundPoint directly
    ps.refundPoint(`${WT.Standard}_a_1`);
    expect(ps.availablePoints).toBe(1);
    expect(ps.isUnlocked(`${WT.Standard}_a_1`)).toBe(false);
  });

  it('right-click on locked node does nothing', () => {
    const ps = new MasteryPointStore(); // No points
    expect(ps.availablePoints).toBe(0);
    // Cannot refund a locked node
    const result = ps.refundPoint(`${WT.Standard}_a_1`);
    expect(result).toBe(false);
  });

  it('right-click on affordable node does nothing', () => {
    const ps = new MasteryPointStore();
    ps.earnPoint(); // 1 point available
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
});
