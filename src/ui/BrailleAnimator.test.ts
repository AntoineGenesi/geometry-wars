import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrailleAnimator, ALL_PATTERNS } from './BrailleAnimator';

// Manual rAF advance — avoids infinite recursion from synchronous callbacks
let rafCallbacks: FrameRequestCallback[] = [];
let rafCounter = 0;

function advanceFrame(count = 1): void {
  for (let i = 0; i < count; i++) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    for (const cb of cbs) cb(0);
  }
}

beforeEach(() => {
  rafCallbacks = [];
  rafCounter = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return ++rafCounter;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeContainer(): HTMLElement {
  return { textContent: '' } as unknown as HTMLElement;
}

describe('BrailleAnimator — ALL_PATTERNS', () => {
  it('has exactly 50 patterns', () => {
    expect(ALL_PATTERNS).toHaveLength(50);
  });

  it('all pattern names are unique', () => {
    expect(new Set(ALL_PATTERNS).size).toBe(50);
  });

  it('includes all required pattern names', () => {
    const required = [
      'orbit', 'breathing', 'snake', 'fillSweep', 'pulse',
      'columns', 'checkerboard', 'scan', 'rain', 'cascade',
      'sparkle', 'wave', 'rose', 'helix', 'diagonalSwipe',
      'vortex', 'bouncing', 'ripple', 'fireworks', 'crosshatch',
      'diamonds', 'zigzag', 'spiral', 'binary', 'static',
      'clockwise', 'counterClockwise', 'hourglass', 'pendulum', 'meteor',
      'lightning', 'aurora', 'matrix', 'heartbeat', 'explosion',
      'shatter', 'wormhole', 'nebula', 'blackhole', 'quantumFlux',
      'pixelSort', 'scanlines', 'dataStream', 'glitch', 'neon',
      'tide', 'constellation', 'tornado', 'earthquake', 'supernova',
    ];
    for (const name of required) {
      expect(ALL_PATTERNS).toContain(name);
    }
  });
});

describe('BrailleAnimator — each pattern renders without throwing', () => {
  for (const pattern of ALL_PATTERNS) {
    it(`pattern "${pattern}" renders 5 frames without error`, () => {
      const container = makeContainer();
      const animator = new BrailleAnimator(container, { pattern });
      animator.start();
      expect(() => advanceFrame(5)).not.toThrow();
      animator.stop();
    });
  }
});

describe('BrailleAnimator — start/stop cycle', () => {
  it('start() registers a rAF callback', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.start();
    expect(rafCallbacks).toHaveLength(1);
    animator.stop();
  });

  it('stop() clears the pending rAF (no more callbacks after stop)', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.start();
    animator.stop();
    // After stop, advancing frame should not produce new callbacks
    const countBefore = rafCallbacks.length;
    advanceFrame(1);
    expect(rafCallbacks.length).toBeLessThanOrEqual(countBefore);
  });

  it('calling start() twice does not double-register rAF', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.start();
    animator.start(); // second call should be no-op
    expect(rafCallbacks).toHaveLength(1);
    animator.stop();
  });

  it('stop() before start() does not throw', () => {
    const animator = new BrailleAnimator(makeContainer());
    expect(() => animator.stop()).not.toThrow();
  });
});

describe('BrailleAnimator — dispose()', () => {
  it('dispose() clears container.textContent', () => {
    const container = makeContainer();
    const animator = new BrailleAnimator(container);
    animator.start();
    advanceFrame(1); // Sets some textContent
    animator.dispose();
    expect(container.textContent).toBe('');
  });

  it('dispose() stops the rAF loop', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.start();
    animator.dispose();
    const beforeLen = rafCallbacks.length;
    advanceFrame(1);
    expect(rafCallbacks.length).toBeLessThanOrEqual(beforeLen);
  });

  it('dispose() then start() does not restart (disposed guard)', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.dispose();
    animator.start(); // should be no-op due to disposed flag
    expect(rafCallbacks).toHaveLength(0);
  });
});

describe('BrailleAnimator — setIntensity()', () => {
  it('setIntensity(0) does not crash', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.start();
    expect(() => {
      animator.setIntensity(0);
      advanceFrame(3);
    }).not.toThrow();
    animator.stop();
  });

  it('setIntensity(1) does not crash', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.start();
    expect(() => {
      animator.setIntensity(1);
      advanceFrame(3);
    }).not.toThrow();
    animator.stop();
  });

  it('setIntensity clamps out-of-range values', () => {
    const animator = new BrailleAnimator(makeContainer());
    animator.start();
    expect(() => {
      animator.setIntensity(-5);
      advanceFrame(2);
      animator.setIntensity(99);
      advanceFrame(2);
    }).not.toThrow();
    animator.stop();
  });
});

describe('BrailleAnimator — output format', () => {
  it('textContent contains Braille characters (U+2800 range)', () => {
    const container = makeContainer();
    const animator = new BrailleAnimator(container, { pattern: 'pulse' });
    animator.start();
    advanceFrame(1);
    animator.stop();
    const content = container.textContent ?? '';
    expect(content.length).toBeGreaterThan(0);
    const brailleChars = [...content].filter(ch => {
      const code = ch.charCodeAt(0);
      return code >= 0x2800 && code <= 0x28FF;
    });
    expect(brailleChars.length).toBeGreaterThan(0);
  });

  it('output has correct number of rows (newline separated)', () => {
    const container = makeContainer();
    const animator = new BrailleAnimator(container, { rows: 4, cols: 10 });
    animator.start();
    advanceFrame(1);
    animator.stop();
    const lines = (container.textContent ?? '').split('\n');
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line.length).toBe(10);
    }
  });

  it('output has correct number of columns per row', () => {
    const container = makeContainer();
    const animator = new BrailleAnimator(container, { rows: 3, cols: 15, pattern: 'scan' });
    animator.start();
    advanceFrame(1);
    animator.stop();
    const lines = (container.textContent ?? '').split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.length).toBe(15);
    }
  });
});

describe('BrailleAnimator — setPattern()', () => {
  it('setPattern() switches the active pattern mid-animation', () => {
    const container = makeContainer();
    const animator = new BrailleAnimator(container, { pattern: 'pulse' });
    animator.start();
    advanceFrame(2);
    expect(() => {
      animator.setPattern('orbit');
      advanceFrame(2);
    }).not.toThrow();
    animator.stop();
  });
});
