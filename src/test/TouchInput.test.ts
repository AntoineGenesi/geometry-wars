import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock minimal DOM APIs needed by TouchInput
const mockElements: Map<string, any> = new Map();

vi.stubGlobal('document', {
  createElement: (tag: string) => {
    const el: any = {
      id: '',
      style: {},
      children: [],
      appendChild: (child: any) => { el.children.push(child); },
      remove: () => { mockElements.delete(el.id); },
      get display() { return el.style.display; },
    };
    return el;
  },
  body: {
    appendChild: (el: any) => {
      if (el.id) mockElements.set(el.id, el);
    },
  },
  getElementById: (id: string) => mockElements.get(id) ?? null,
});

// Track event listeners for dispatch
const listeners: Map<string, Set<Function>> = new Map();
vi.stubGlobal('window', {
  innerWidth: 800,
  innerHeight: 600,
  addEventListener: (type: string, handler: Function, _opts?: any) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(handler);
  },
  removeEventListener: (type: string, handler: Function) => {
    listeners.get(type)?.delete(handler);
  },
});

vi.stubGlobal('performance', { now: () => Date.now() });

// Helper to dispatch touch events through the registered listeners
function dispatchTouch(type: string, touches: any[]): void {
  // Build array-like objects for changedTouches and touches
  const changedTouches: any = { length: touches.length };
  for (let i = 0; i < touches.length; i++) {
    changedTouches[i] = touches[i];
  }
  const activeTouches: any = type === 'touchend' || type === 'touchcancel'
    ? { length: 0 }
    : changedTouches;
  const event = {
    type,
    changedTouches,
    touches: activeTouches,
    preventDefault: () => {},
  };
  const handlers = listeners.get(type);
  if (handlers) {
    for (const handler of handlers) handler(event);
  }
}

function createTouch(id: number, clientX: number, clientY: number): any {
  return { identifier: id, clientX, clientY };
}

import { TouchInput } from '../input/TouchInput';

describe('TouchInput', () => {
  let touchInput: TouchInput;

  beforeEach(() => {
    mockElements.clear();
    listeners.clear();
    (window as any).innerWidth = 800;
    (window as any).innerHeight = 600;
    touchInput = new TouchInput();
  });

  afterEach(() => {
    if (touchInput) {
      touchInput.dispose();
    }
  });

  describe('getState', () => {
    it('returns neutral state when no touches are active', () => {
      const state = touchInput.getState();
      expect(state.moveX).toBe(0);
      expect(state.moveY).toBe(0);
      expect(state.aimX).toBe(0);
      expect(state.aimY).toBe(0);
      expect(state.shooting).toBe(false);
      expect(state.bomb).toBe(false);
      expect(state.boost).toBe(false);
      expect(state.weaponSwap).toBe(false);
    });

    it('returns InputState with all required fields', () => {
      const state = touchInput.getState();
      expect(state).toHaveProperty('moveX');
      expect(state).toHaveProperty('moveY');
      expect(state).toHaveProperty('aimX');
      expect(state).toHaveProperty('aimY');
      expect(state).toHaveProperty('shooting');
      expect(state).toHaveProperty('bomb');
      expect(state).toHaveProperty('boost');
      expect(state).toHaveProperty('weaponSwap');
    });

    it('boost is always false on mobile', () => {
      expect(touchInput.getState().boost).toBe(false);
    });

    it('weaponSwap is always false on mobile', () => {
      expect(touchInput.getState().weaponSwap).toBe(false);
    });
  });

  describe('endFrame', () => {
    it('clears bomb flag after frame', () => {
      // Tap bomb zone (top center)
      const touch = createTouch(0, 400, 50);
      dispatchTouch('touchstart', [touch]);
      dispatchTouch('touchend', [touch]);

      expect(touchInput.getState().bomb).toBe(true);
      touchInput.endFrame();
      expect(touchInput.getState().bomb).toBe(false);
    });
  });

  describe('left joystick (movement)', () => {
    it('activates on touch in bottom-left quadrant', () => {
      const start = createTouch(0, 100, 500);
      dispatchTouch('touchstart', [start]);

      // Move right
      const move = createTouch(0, 160, 500);
      dispatchTouch('touchmove', [move]);

      expect(touchInput.getState().moveX).toBeGreaterThan(0);
    });

    it('produces negative moveX when moving left', () => {
      const start = createTouch(0, 200, 500);
      dispatchTouch('touchstart', [start]);

      const move = createTouch(0, 140, 500);
      dispatchTouch('touchmove', [move]);

      expect(touchInput.getState().moveX).toBeLessThan(0);
    });

    it('produces positive moveY when moving down', () => {
      const start = createTouch(0, 100, 400);
      dispatchTouch('touchstart', [start]);

      const move = createTouch(0, 100, 460);
      dispatchTouch('touchmove', [move]);

      expect(touchInput.getState().moveY).toBeGreaterThan(0);
    });

    it('resets to zero on touch end', () => {
      const touch = createTouch(0, 100, 500);
      dispatchTouch('touchstart', [touch]);

      const move = createTouch(0, 160, 500);
      dispatchTouch('touchmove', [move]);
      dispatchTouch('touchend', [touch]);

      expect(touchInput.getState().moveX).toBe(0);
      expect(touchInput.getState().moveY).toBe(0);
    });

    it('clamps movement to -1..1 range', () => {
      const start = createTouch(0, 100, 500);
      dispatchTouch('touchstart', [start]);

      // Move far beyond joystick radius (400px)
      const move = createTouch(0, 500, 500);
      dispatchTouch('touchmove', [move]);

      const state = touchInput.getState();
      expect(state.moveX).toBeLessThanOrEqual(1);
      expect(state.moveX).toBeGreaterThanOrEqual(-1);
    });

    it('applies dead zone (tiny movements produce 0)', () => {
      const start = createTouch(0, 200, 500);
      dispatchTouch('touchstart', [start]);

      // Move 2px (well within dead zone of 15% of 60px = 9px)
      const move = createTouch(0, 202, 500);
      dispatchTouch('touchmove', [move]);

      expect(touchInput.getState().moveX).toBe(0);
    });
  });

  describe('right joystick (aim + auto-fire)', () => {
    it('produces aim values when touched in bottom-right', () => {
      const start = createTouch(1, 600, 500);
      dispatchTouch('touchstart', [start]);

      const move = createTouch(1, 660, 500);
      dispatchTouch('touchmove', [move]);

      expect(touchInput.getState().aimX).toBeGreaterThan(0);
    });

    it('auto-fires when right stick is active', () => {
      const start = createTouch(1, 600, 500);
      dispatchTouch('touchstart', [start]);

      const move = createTouch(1, 660, 500);
      dispatchTouch('touchmove', [move]);

      expect(touchInput.getState().shooting).toBe(true);
    });

    it('stops auto-fire when released', () => {
      const touch = createTouch(1, 600, 500);
      dispatchTouch('touchstart', [touch]);

      const move = createTouch(1, 660, 500);
      dispatchTouch('touchmove', [move]);
      dispatchTouch('touchend', [touch]);

      expect(touchInput.getState().shooting).toBe(false);
    });
  });

  describe('bomb tap', () => {
    it('triggers bomb on quick tap in top-center zone', () => {
      const touch = createTouch(2, 400, 50);
      dispatchTouch('touchstart', [touch]);
      dispatchTouch('touchend', [touch]);

      expect(touchInput.getState().bomb).toBe(true);
    });

    it('does not trigger bomb for bottom-of-screen touches', () => {
      const touch = createTouch(2, 400, 500);
      dispatchTouch('touchstart', [touch]);
      dispatchTouch('touchend', [touch]);

      expect(touchInput.getState().bomb).toBe(false);
    });

    it('does not trigger bomb for top-corner touches', () => {
      // Left edge (x=50 < 160) is outside center 60%
      const touch = createTouch(2, 50, 50);
      dispatchTouch('touchstart', [touch]);
      dispatchTouch('touchend', [touch]);

      expect(touchInput.getState().bomb).toBe(false);
    });
  });

  describe('dual joystick', () => {
    it('supports simultaneous left and right joysticks', () => {
      // Start left
      dispatchTouch('touchstart', [createTouch(0, 100, 500)]);
      // Start right
      dispatchTouch('touchstart', [createTouch(1, 600, 500)]);

      // Move both
      dispatchTouch('touchmove', [createTouch(0, 160, 500)]);
      dispatchTouch('touchmove', [createTouch(1, 660, 500)]);

      const state = touchInput.getState();
      expect(state.moveX).toBeGreaterThan(0);
      expect(state.aimX).toBeGreaterThan(0);
      expect(state.shooting).toBe(true);
    });

    it('releasing one joystick does not affect the other', () => {
      // Start both
      dispatchTouch('touchstart', [createTouch(0, 100, 500)]);
      dispatchTouch('touchstart', [createTouch(1, 600, 500)]);

      // Move both
      dispatchTouch('touchmove', [createTouch(0, 160, 500)]);
      dispatchTouch('touchmove', [createTouch(1, 660, 500)]);

      // Release left only
      dispatchTouch('touchend', [createTouch(0, 160, 500)]);

      const state = touchInput.getState();
      expect(state.moveX).toBe(0); // left released
      expect(state.aimX).toBeGreaterThan(0); // right still active
    });
  });

  describe('touch cancel', () => {
    it('resets joystick on touch cancel', () => {
      dispatchTouch('touchstart', [createTouch(0, 100, 500)]);
      dispatchTouch('touchmove', [createTouch(0, 160, 500)]);
      dispatchTouch('touchcancel', [createTouch(0, 160, 500)]);

      expect(touchInput.getState().moveX).toBe(0);
    });
  });

  describe('setVisible', () => {
    it('hides the overlay', () => {
      touchInput.setVisible(false);
      // Just verify it doesn't throw
    });

    it('shows the overlay', () => {
      touchInput.setVisible(false);
      touchInput.setVisible(true);
      // Just verify it doesn't throw
    });
  });
});
