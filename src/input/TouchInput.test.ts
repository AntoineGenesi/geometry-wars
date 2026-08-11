/**
 * Unit tests for TouchInput — dual virtual joystick mobile controller.
 *
 * Runs in Node (no jsdom). We mock the minimal DOM/window surface used by TouchInput:
 * - document.createElement / document.body.appendChild / element.remove
 * - window.addEventListener / removeEventListener / innerWidth / innerHeight
 * - performance.now
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TouchInput } from './TouchInput';

// ---------------------------------------------------------------------------
// Minimal DOM element mock
// ---------------------------------------------------------------------------

function createMockStyle(): Record<string, string> {
  const style: Record<string, string> = {};
  let cssText = '';
  Object.defineProperty(style, 'cssText', {
    get: () => cssText,
    set: (value: string) => {
      cssText = value;
      for (const rule of value.split(';')) {
        const [rawProp, ...rawValue] = rule.split(':');
        if (!rawProp || rawValue.length === 0) continue;
        const prop = rawProp.trim();
        const parsedValue = rawValue.join(':').trim();
        if (!prop || !parsedValue) continue;
        style[prop] = parsedValue;
      }
    },
    configurable: true,
  });
  return style;
}

class MockElement {
  id = '';
  style: Record<string, string> = createMockStyle();
  children: MockElement[] = [];
  textContent = '';
  title = '';
  private _listeners: Map<string, ((e: Event) => void)[]> = new Map();

  appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }
  remove(): void {
    // Remove self from parent - simplified (parent tracks removal separately)
    MockDocument.removeFromBody(this);
  }
  querySelector(): null { return null; }
  querySelectorAll(): MockElement[] { return []; }
  contains(): boolean { return false; }

  addEventListener(type: string, fn: (e: Event) => void, _opts?: unknown): void {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type)!.push(fn);
  }

  /** Fire an event on this element (for tests). */
  simulateEvent(type: string, event: object): void {
    for (const fn of (this._listeners.get(type) ?? [])) {
      fn(event as Event);
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal document mock
// ---------------------------------------------------------------------------

const _bodyChildren: MockElement[] = [];

const MockDocument = {
  body: {
    appendChild(child: MockElement): MockElement {
      _bodyChildren.push(child);
      return child;
    },
  },
  getElementById(id: string): MockElement | null {
    return _bodyChildren.find(el => el.id === id) ?? null;
  },
  createElement(_tag: string): MockElement {
    return new MockElement();
  },
  removeFromBody(el: MockElement): void {
    const i = _bodyChildren.indexOf(el);
    if (i !== -1) _bodyChildren.splice(i, 1);
  },
};

// ---------------------------------------------------------------------------
// Touch event simulation
// ---------------------------------------------------------------------------

const _windowListeners: Map<string, ((e: Event) => void)[]> = new Map();

function addWindowListener(type: string, fn: (e: Event) => void): void {
  if (!_windowListeners.has(type)) _windowListeners.set(type, []);
  _windowListeners.get(type)!.push(fn);
}

function removeWindowListener(type: string, fn: (e: Event) => void): void {
  const list = _windowListeners.get(type);
  if (list) {
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }
}

function fireWindowEvent(type: string, changedTouches: Array<{ identifier: number; clientX: number; clientY: number }>): void {
  const listeners = _windowListeners.get(type) ?? [];
  // Build an array-like object with numeric indexing + length (TouchInput uses changedTouches[i])
  const touchListLike: Record<number, typeof changedTouches[0]> & { length: number } = {
    length: changedTouches.length,
  };
  for (let i = 0; i < changedTouches.length; i++) {
    touchListLike[i] = changedTouches[i];
  }
  const event = {
    changedTouches: touchListLike,
    preventDefault: vi.fn(),
  } as unknown as TouchEvent;
  for (const fn of [...listeners]) {
    fn(event as unknown as Event);
  }
}

// ---------------------------------------------------------------------------
// Viewport dimensions
// ---------------------------------------------------------------------------

const W = 800;
const H = 400;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let savedDocument: typeof document;
let savedWindow: Partial<Window & typeof globalThis>;
let performanceNowMock: ReturnType<typeof vi.spyOn> | null = null;

// Minimal localStorage mock
const _localStorageData: Record<string, string> = {};
const MockLocalStorage = {
  getItem: (key: string): string | null => _localStorageData[key] ?? null,
  setItem: (key: string, value: string): void => { _localStorageData[key] = value; },
  removeItem: (key: string): void => { delete _localStorageData[key]; },
  clear: (): void => { Object.keys(_localStorageData).forEach(k => delete _localStorageData[k]); },
};

beforeEach(() => {
  // Clear state
  _bodyChildren.length = 0;
  _windowListeners.clear();
  MockLocalStorage.clear();

  // Stub globals
  vi.stubGlobal('document', MockDocument);
  vi.stubGlobal('window', {
    innerWidth: W,
    innerHeight: H,
    addEventListener: addWindowListener,
    removeEventListener: removeWindowListener,
  });
  vi.stubGlobal('performance', {
    now: () => Date.now(),
  });
  vi.stubGlobal('localStorage', MockLocalStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (performanceNowMock) {
    performanceNowMock.mockRestore();
    performanceNowMock = null;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function touch(id: number, x: number, y: number) {
  return { identifier: id, clientX: x, clientY: y };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TouchInput', () => {

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  it('appends an overlay element to document.body', () => {
    const input = new TouchInput();
    expect(_bodyChildren.length).toBeGreaterThanOrEqual(1);
    const overlay = _bodyChildren.find(el => el.id === 'touch-controls-overlay');
    expect(overlay).toBeDefined();
    input.dispose();
  });

  it('returns zero input state when no touches are active', () => {
    const input = new TouchInput();
    const state = input.getState();
    expect(state.moveX).toBe(0);
    expect(state.moveY).toBe(0);
    expect(state.aimX).toBe(0);
    expect(state.aimY).toBe(0);
    expect(state.shooting).toBe(false);
    expect(state.bomb).toBe(false);
    expect(state.boost).toBe(false);
    expect(state.weaponSwap).toBe(false);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // Left joystick (movement — left half, bottom 65%)
  // -------------------------------------------------------------------------

  it('left joystick: full rightward deflection produces moveX ≈ 1', () => {
    const input = new TouchInput();
    const cx = W * 0.25; // left half
    const cy = H * 0.75; // bottom half

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 60, cy)]); // JOYSTICK_RADIUS = 60

    const state = input.getState();
    expect(state.moveX).toBeCloseTo(1, 1);
    expect(state.moveY).toBeCloseTo(0, 1);
    expect(state.shooting).toBe(false); // left stick never fires
    input.dispose();
  });

  it('left joystick: upward deflection produces negative moveY', () => {
    const input = new TouchInput();
    const cx = W * 0.25;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx, cy - 60)]);

    expect(input.getState().moveY).toBeLessThan(-0.5);
    input.dispose();
  });

  it('left joystick: oversized deflection is clamped to ≤ 1', () => {
    const input = new TouchInput();
    const cx = W * 0.25;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 200, cy)]); // 200 > 60 radius

    const state = input.getState();
    expect(state.moveX).toBeLessThanOrEqual(1);
    expect(state.moveX).toBeGreaterThan(0.5);
    input.dispose();
  });

  it('left joystick: tiny deflection returns zero (dead zone)', () => {
    const input = new TouchInput();
    const cx = W * 0.25;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 4, cy)]); // < 15% × 60 = 9px

    expect(input.getState().moveX).toBe(0);
    input.dispose();
  });

  it('left joystick: touchend resets movement to zero', () => {
    const input = new TouchInput();
    const cx = W * 0.25;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 60, cy)]);
    expect(input.getState().moveX).toBeCloseTo(1, 1);

    fireWindowEvent('touchend', [touch(1, cx + 60, cy)]);
    expect(input.getState().moveX).toBe(0);
    expect(input.getState().moveY).toBe(0);
    input.dispose();
  });

  it('left joystick: touchcancel resets movement to zero', () => {
    const input = new TouchInput();
    const cx = W * 0.25;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 60, cy)]);
    fireWindowEvent('touchcancel', [touch(1, cx + 60, cy)]);

    expect(input.getState().moveX).toBe(0);
    input.dispose();
  });

  it('left joystick: suppresses small held-thumb tremor before it reaches movement', () => {
    const input = new TouchInput();
    const cx = W * 0.25;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 30, cy)]);
    const held = input.getState();

    fireWindowEvent('touchmove', [touch(1, cx + 35, cy)]);
    const tremorRight = input.getState();

    fireWindowEvent('touchmove', [touch(1, cx + 30, cy)]);
    const tremorLeft = input.getState();

    expect(Math.abs(tremorRight.moveX - held.moveX)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(tremorLeft.moveX - held.moveX)).toBeLessThanOrEqual(0.02);
    expect(held.moveX).toBeGreaterThan(0.3);
    input.dispose();
  });

  it('left joystick: repeated small same-direction refinements converge instead of sticking', () => {
    const input = new TouchInput();
    const cx = W * 0.25;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 30, cy)]);
    const held = input.getState();

    fireWindowEvent('touchmove', [touch(1, cx + 35, cy)]);
    let refined = input.getState();
    for (let i = 0; i < 7; i++) refined = input.getState();

    const unsmoothedTarget = ((35 / 60) - 0.15) / (1 - 0.15);
    expect(refined.moveX).toBeGreaterThan(held.moveX + 0.06);
    expect(refined.moveX).toBeLessThanOrEqual(unsmoothedTarget);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // Right joystick (aim + auto-fire — right half, bottom 65%)
  // -------------------------------------------------------------------------

  it('right joystick: deflection sets aimX and enables auto-fire', () => {
    const input = new TouchInput();
    const cx = W * 0.75; // right half
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(2, cx, cy)]);
    fireWindowEvent('touchmove', [touch(2, cx + 60, cy)]);

    const state = input.getState();
    expect(state.aimX).toBeCloseTo(1, 1);
    expect(state.shooting).toBe(true);
    input.dispose();
  });

  it('right joystick: touchend resets aim and stops shooting', () => {
    const input = new TouchInput();
    const cx = W * 0.75;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(2, cx, cy)]);
    fireWindowEvent('touchmove', [touch(2, cx + 60, cy)]);
    fireWindowEvent('touchend', [touch(2, cx + 60, cy)]);

    const state = input.getState();
    expect(state.aimX).toBe(0);
    expect(state.shooting).toBe(false);
    input.dispose();
  });

  it('right joystick: suppresses small held-thumb tremor before it reaches aim', () => {
    const input = new TouchInput();
    const cx = W * 0.75;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(2, cx, cy)]);
    fireWindowEvent('touchmove', [touch(2, cx + 30, cy)]);
    const held = input.getState();

    fireWindowEvent('touchmove', [touch(2, cx + 35, cy)]);
    const tremorRight = input.getState();

    fireWindowEvent('touchmove', [touch(2, cx + 30, cy)]);
    const tremorLeft = input.getState();

    expect(Math.abs(tremorRight.aimX - held.aimX)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(tremorLeft.aimX - held.aimX)).toBeLessThanOrEqual(0.02);
    expect(held.aimX).toBeGreaterThan(0.3);
    expect(tremorRight.shooting).toBe(true);
    input.dispose();
  });

  it('right joystick: repeated small same-direction aim refinements converge instead of sticking', () => {
    const input = new TouchInput();
    const cx = W * 0.75;
    const cy = H * 0.75;

    fireWindowEvent('touchstart', [touch(2, cx, cy)]);
    fireWindowEvent('touchmove', [touch(2, cx + 30, cy)]);
    const held = input.getState();

    fireWindowEvent('touchmove', [touch(2, cx + 35, cy)]);
    let refined = input.getState();
    for (let i = 0; i < 7; i++) refined = input.getState();

    const unsmoothedTarget = ((35 / 60) - 0.15) / (1 - 0.15);
    expect(refined.aimX).toBeGreaterThan(held.aimX + 0.06);
    expect(refined.aimX).toBeLessThanOrEqual(unsmoothedTarget);
    expect(refined.shooting).toBe(true);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // Bomb tap (top 20%, middle 60% of width)
  // -------------------------------------------------------------------------

  it('quick tap in bomb zone triggers bomb for one frame then clears', () => {
    const input = new TouchInput();
    const tapX = W * 0.5;
    const tapY = H * 0.05; // top 20%

    let t = 1000;
    vi.stubGlobal('performance', { now: () => t });

    fireWindowEvent('touchstart', [touch(3, tapX, tapY)]);
    t = 1100; // 100ms later — within 300ms BOMB_TAP_DURATION
    fireWindowEvent('touchend', [touch(3, tapX, tapY)]);

    expect(input.getState().bomb).toBe(true);
    input.endFrame();
    expect(input.getState().bomb).toBe(false);
    input.dispose();
  });

  it('long press in bomb zone does NOT trigger bomb', () => {
    const input = new TouchInput();
    const tapX = W * 0.5;
    const tapY = H * 0.05;

    let t = 1000;
    vi.stubGlobal('performance', { now: () => t });

    fireWindowEvent('touchstart', [touch(3, tapX, tapY)]);
    t = 1500; // 500ms — exceeds 300ms tap duration
    fireWindowEvent('touchend', [touch(3, tapX, tapY)]);

    expect(input.getState().bomb).toBe(false);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // Multi-touch: both joysticks simultaneously
  // -------------------------------------------------------------------------

  it('both joysticks work independently with simultaneous touches', () => {
    const input = new TouchInput();

    // Start both sticks
    fireWindowEvent('touchstart', [touch(1, W * 0.25, H * 0.75)]);
    fireWindowEvent('touchstart', [touch(2, W * 0.75, H * 0.75)]);

    // Move left up, right rightward
    fireWindowEvent('touchmove', [touch(1, W * 0.25, H * 0.75 - 60)]);
    fireWindowEvent('touchmove', [touch(2, W * 0.75 + 60, H * 0.75)]);

    const state = input.getState();
    expect(state.moveY).toBeLessThan(-0.5); // left stick: up = negative Y
    expect(state.aimX).toBeCloseTo(1, 1);   // right stick: right
    expect(state.shooting).toBe(true);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // Touch above joystick zone does not activate joystick
  // -------------------------------------------------------------------------

  it('touch above 35% y threshold does not activate left joystick', () => {
    const input = new TouchInput();
    const cx = W * 0.25; // left half
    const cy = H * 0.2;  // above 35% threshold, not in bomb zone either

    fireWindowEvent('touchstart', [touch(1, cx, cy)]);
    fireWindowEvent('touchmove', [touch(1, cx + 60, cy)]);

    expect(input.getState().moveX).toBe(0);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // setVisible / dispose
  // -------------------------------------------------------------------------

  it('setVisible(false) sets overlay display to none', () => {
    const input = new TouchInput();
    input.setVisible(false);
    const overlay = _bodyChildren.find(el => el.id === 'touch-controls-overlay');
    expect(overlay?.style.display).toBe('none');
    input.dispose();
  });

  it('setVisible(true) sets overlay display to block', () => {
    const input = new TouchInput();
    input.setVisible(false);
    input.setVisible(true);
    const overlay = _bodyChildren.find(el => el.id === 'touch-controls-overlay');
    expect(overlay?.style.display).toBe('block');
    input.dispose();
  });

  it('dispose removes the overlay element from body', () => {
    const input = new TouchInput();
    expect(_bodyChildren.find(el => el.id === 'touch-controls-overlay')).toBeDefined();
    input.dispose();
    expect(_bodyChildren.find(el => el.id === 'touch-controls-overlay')).toBeUndefined();
  });

  it('dispose removes all window event listeners', () => {
    const input = new TouchInput();
    const before = [...(_windowListeners.get('touchstart') ?? [])];
    input.dispose();
    const after = _windowListeners.get('touchstart') ?? [];
    // All listeners added by TouchInput should be removed
    expect(after.length).toBeLessThan(before.length);
  });

  // -------------------------------------------------------------------------
  // Interface contract
  // -------------------------------------------------------------------------

  it('getState returns the full InputState interface', () => {
    const input = new TouchInput();
    const state = input.getState();
    expect(typeof state.moveX).toBe('number');
    expect(typeof state.moveY).toBe('number');
    expect(typeof state.aimX).toBe('number');
    expect(typeof state.aimY).toBe('number');
    expect(typeof state.shooting).toBe('boolean');
    expect(typeof state.bomb).toBe('boolean');
    expect(typeof state.boost).toBe('boolean');
    expect(typeof state.weaponSwap).toBe('boolean');
    input.dispose();
  });

  it('boost is always false; weaponSwap is false initially (before button tap)', () => {
    const input = new TouchInput();
    const state = input.getState();
    expect(state.boost).toBe(false);
    expect(state.weaponSwap).toBe(false);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // setGamePaused — touch routing fix (regression guard: S31)
  // -------------------------------------------------------------------------
  // When the game is paused and the pause menu is visible, touch events must
  // NOT call e.preventDefault(). Without this, the browser cannot generate
  // synthetic click events on pause menu buttons. The joystick must also not
  // activate while the game is paused.

  it('setGamePaused(true) — touchstart does NOT call preventDefault (allows click events on menu buttons)', () => {
    const input = new TouchInput();
    input.setGamePaused(true);

    expect(input.pausedForGame).toBe(true);

    const listeners = _windowListeners.get('touchstart') ?? [];
    const event = {
      changedTouches: { length: 1, 0: touch(1, W * 0.25, H * 0.6) },
      preventDefault: vi.fn(),
    } as unknown as TouchEvent;
    for (const fn of [...listeners]) fn(event as unknown as Event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    input.dispose();
  });

  it('setGamePaused(true) — joystick does NOT activate (no movement output)', () => {
    const input = new TouchInput();
    input.setGamePaused(true);

    // Touch in left joystick zone
    fireWindowEvent('touchstart', [touch(1, W * 0.25, H * 0.6)]);
    fireWindowEvent('touchmove', [touch(1, W * 0.25 + 50, H * 0.6)]);

    const state = input.getState();
    expect(state.moveX).toBe(0);
    expect(state.moveY).toBe(0);
    input.dispose();
  });

  it('setGamePaused(false) — joystick activates normally after unpause', () => {
    const input = new TouchInput();
    input.setGamePaused(true);
    input.setGamePaused(false);

    expect(input.pausedForGame).toBe(false);

    // Touch in left joystick zone and drag right
    fireWindowEvent('touchstart', [touch(1, W * 0.25, H * 0.6)]);
    fireWindowEvent('touchmove', [touch(1, W * 0.25 + 70, H * 0.6)]);

    const state = input.getState();
    expect(state.moveX).toBeGreaterThan(0);
    input.dispose();
  });

  it('setGamePaused(true) — hides active joystick visuals immediately', () => {
    const input = new TouchInput();

    // Start a joystick touch while unpaused
    fireWindowEvent('touchstart', [touch(1, W * 0.25, H * 0.6)]);

    // Then pause — should hide joystick
    input.setGamePaused(true);

    // State should be reset to zero
    const state = input.getState();
    expect(state.moveX).toBe(0);
    expect(state.moveY).toBe(0);
    input.dispose();
  });

  // -------------------------------------------------------------------------
  // Weapon change button — tap, drag, localStorage
  // -------------------------------------------------------------------------

  function getWeaponBtn(): MockElement | undefined {
    return _bodyChildren.find(el => el.id === 'touch-weapon-btn') as MockElement | undefined;
  }

  function simulateWeaponBtnTouchStart(touchId: number, x: number, y: number): void {
    const btn = getWeaponBtn();
    if (!btn) return;
    const event = {
      changedTouches: { 0: touch(touchId, x, y), length: 1 },
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };
    btn.simulateEvent('touchstart', event);
  }

  it('weapon button appended to document body as direct child', () => {
    const input = new TouchInput();
    const btn = getWeaponBtn();
    expect(btn).toBeDefined();
    input.dispose();
  });

  it('weapon button tap: weaponSwap is true for one frame then cleared by endFrame', () => {
    const input = new TouchInput();
    const btn = getWeaponBtn();
    expect(btn).toBeDefined();

    const touchId = 42;
    const x = 28; // within button bounds
    const y = H / 2;

    // Simulate touchstart on the button
    simulateWeaponBtnTouchStart(touchId, x, y);

    // No movement — touchend without drag
    fireWindowEvent('touchend', [touch(touchId, x, y)]);

    expect(input.getState().weaponSwap).toBe(true);
    input.endFrame();
    expect(input.getState().weaponSwap).toBe(false);
    input.dispose();
  });

  it('weapon button drag: does NOT trigger weaponSwap when drag distance exceeds threshold', () => {
    const input = new TouchInput();
    const touchId = 43;
    const startX = 28;
    const startY = H / 2;

    simulateWeaponBtnTouchStart(touchId, startX, startY);

    // Drag 20px — exceeds WEAPON_BTN_DRAG_THRESHOLD (8px)
    fireWindowEvent('touchmove', [touch(touchId, startX + 20, startY)]);
    fireWindowEvent('touchend', [touch(touchId, startX + 20, startY)]);

    expect(input.getState().weaponSwap).toBe(false);
    input.dispose();
  });

  it('weapon button drag: repositions button element', () => {
    const input = new TouchInput();
    const btn = getWeaponBtn();
    const touchId = 44;
    const startX = 28;
    const startY = H / 2;

    simulateWeaponBtnTouchStart(touchId, startX, startY);

    // Drag 40px to the right
    fireWindowEvent('touchmove', [touch(touchId, startX + 40, startY)]);

    const newLeft = parseFloat(btn!.style.left ?? '0');
    expect(newLeft).toBeGreaterThan(startX); // button moved right
    input.dispose();
  });

  it('weapon button drag: saves position to localStorage on touchend', () => {
    const input = new TouchInput();
    const touchId = 45;
    const startX = 28;
    const startY = H / 2;

    simulateWeaponBtnTouchStart(touchId, startX, startY);
    fireWindowEvent('touchmove', [touch(touchId, startX + 40, startY)]);
    fireWindowEvent('touchend', [touch(touchId, startX + 40, startY)]);

    const stored = MockLocalStorage.getItem('gw-weapon-btn-pos');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(typeof parsed.pctX).toBe('number');
    expect(typeof parsed.pctY).toBe('number');
    input.dispose();
  });

  it('weapon button: loads position from localStorage on init', () => {
    // Pre-seed localStorage with a saved position (25% from left, 75% from top)
    MockLocalStorage.setItem('gw-weapon-btn-pos', JSON.stringify({ pctX: 0.25, pctY: 0.75 }));

    const input = new TouchInput();
    const btn = getWeaponBtn();
    const left = parseFloat(btn?.style.left ?? '0');
    const top = parseFloat(btn?.style.top ?? '0');

    // Expected: (0.25 * W) - WEAPON_BTN_SIZE/2 = 0.25*800 - 28 = 172
    expect(left).toBeCloseTo(0.25 * W - 28, 0);
    // Expected: (0.75 * H) - WEAPON_BTN_SIZE/2 = 0.75*400 - 28 = 272
    expect(top).toBeCloseTo(0.75 * H - 28, 0);
    input.dispose();
  });

  it('weapon button: defaults to left side center when no saved position', () => {
    const input = new TouchInput();
    const btn = getWeaponBtn();
    const left = parseFloat(btn?.style.left ?? '-1');
    const top = parseFloat(btn?.style.top ?? '-1');

    // Default left = 16px
    expect(left).toBe(16);
    // Default top = center: H/2 - WEAPON_BTN_SIZE/2 = 200 - 28 = 172
    expect(top).toBeCloseTo(H / 2 - 28, 0);
    input.dispose();
  });

  it('setVisible(false) hides weapon button', () => {
    const input = new TouchInput();
    input.setVisible(false);
    const btn = getWeaponBtn();
    expect(btn?.style.display).toBe('none');
    input.dispose();
  });

  it('setVisible(true) shows weapon button', () => {
    const input = new TouchInput();
    input.setVisible(false);
    input.setVisible(true);
    const btn = getWeaponBtn();
    expect(btn?.style.display).toBe('flex');
    input.dispose();
  });

  it('dispose removes weapon button from body', () => {
    const input = new TouchInput();
    expect(getWeaponBtn()).toBeDefined();
    input.dispose();
    expect(getWeaponBtn()).toBeUndefined();
  });
});
