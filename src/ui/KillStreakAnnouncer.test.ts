/**
 * Tests for KillStreakAnnouncer — threshold mapping and update logic.
 *
 * The `streakLabel` export is pure (no DOM), so threshold tests need no mock.
 * The `KillStreakAnnouncer` class uses the DOM; we provide a minimal mock for
 * the update/announce/dispose integration tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { streakLabel } from './KillStreakAnnouncer';

// ---------------------------------------------------------------------------
// Threshold mapping tests (pure — no DOM required)
// ---------------------------------------------------------------------------

describe('streakLabel — threshold mapping', () => {
  it('returns null for a single kill (streak = 1)', () => {
    expect(streakLabel(1)).toBeNull();
  });

  it('returns null for streak = 0', () => {
    expect(streakLabel(0)).toBeNull();
  });

  it('streak 2 → "DOUBLE KILL"', () => {
    expect(streakLabel(2)).toBe('DOUBLE KILL');
  });

  it('streak 3 → "TRIPLE KILL"', () => {
    expect(streakLabel(3)).toBe('TRIPLE KILL');
  });

  it('streak 4 → "OVERKILL"', () => {
    expect(streakLabel(4)).toBe('OVERKILL');
  });

  it('streak 5 → "KILLTACULAR"', () => {
    expect(streakLabel(5)).toBe('KILLTACULAR');
  });

  it('streak 6 → "LEGENDARY"', () => {
    expect(streakLabel(6)).toBe('LEGENDARY');
  });

  it('streak 10 → "LEGENDARY" (6+ all map to Legendary)', () => {
    expect(streakLabel(10)).toBe('LEGENDARY');
  });

  it('streak 100 → "LEGENDARY"', () => {
    expect(streakLabel(100)).toBe('LEGENDARY');
  });

  it('all thresholds 2-6 map to distinct labels', () => {
    const labels = [2, 3, 4, 5, 6].map(streakLabel);
    const unique = new Set(labels);
    expect(unique.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Minimal DOM mock for KillStreakAnnouncer class tests
// ---------------------------------------------------------------------------

class MockElement {
  id = '';
  className = '';
  textContent = '';
  innerHTML = '';
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;

  private _classList = new Set<string>();
  readonly classList = {
    add: (cls: string) => { this._classList.add(cls); },
    remove: (cls: string) => { this._classList.delete(cls); },
    contains: (cls: string) => this._classList.has(cls),
    has: (cls: string) => this._classList.has(cls),
  };

  get offsetWidth(): number { return 100; }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  querySelector<T = MockElement>(selector: string): T | null {
    // Return a child stub matching a class selector
    const cls = selector.replace(/^\./, '');
    for (const child of this.children) {
      if (child.className.includes(cls)) return child as unknown as T;
    }
    // Recursive depth-1 search in grandchildren
    for (const child of this.children) {
      for (const gc of child.children) {
        if (gc.className.includes(cls)) return gc as unknown as T;
      }
    }
    // Fallback: return a dummy element so callers don't crash
    const dummy = new MockElement();
    dummy.className = cls;
    return dummy as unknown as T;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }
}

const headChildren: MockElement[] = [];
const bodyChildren: MockElement[] = [];

function setupDOMMock(): void {
  headChildren.length = 0;
  bodyChildren.length = 0;

  const mockHead = new MockElement();
  mockHead.appendChild = (child: MockElement) => {
    headChildren.push(child);
    child.parentElement = mockHead;
    return child;
  };

  const mockBody = new MockElement();
  mockBody.appendChild = (child: MockElement) => {
    bodyChildren.push(child);
    child.parentElement = mockBody;
    return child;
  };

  vi.stubGlobal('document', {
    createElement: (tag: string): MockElement => {
      const el = new MockElement();
      (el as unknown as { tagName: string }).tagName = tag.toUpperCase();
      return el;
    },
    getElementById: (_id: string) => null,
    head: mockHead,
    body: mockBody,
  });
}

/** Build a minimal SoundEngine stub that records play() calls. */
function makeSoundStub() {
  const calls: Array<{ type: string; options: unknown }> = [];
  return {
    play(type: string, options: unknown = {}) { calls.push({ type, options }); return true; },
    calls,
  };
}

// ---------------------------------------------------------------------------
// KillStreakAnnouncer class tests
// ---------------------------------------------------------------------------

describe('KillStreakAnnouncer', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let KillStreakAnnouncer: any;

  beforeEach(async () => {
    setupDOMMock();
    vi.resetModules();
    const mod = await import('./KillStreakAnnouncer');
    KillStreakAnnouncer = mod.KillStreakAnnouncer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates DOM elements and appends to body on construction', () => {
    const sound = makeSoundStub();
    new KillStreakAnnouncer(sound);
    // Should have appended at least one element to body (the container)
    expect(bodyChildren.length).toBeGreaterThanOrEqual(1);
    // Should have appended a style element to head
    expect(headChildren.length).toBeGreaterThanOrEqual(1);
  });

  it('announce() with streak < 2 does NOT play a sound', () => {
    const sound = makeSoundStub();
    const announcer = new KillStreakAnnouncer(sound);
    announcer.announce('Player1', 1);
    expect(sound.calls).toHaveLength(0);
  });

  it('announce() with streak = 2 plays a sound', () => {
    const sound = makeSoundStub();
    const announcer = new KillStreakAnnouncer(sound);
    announcer.announce('Player1', 2);
    expect(sound.calls).toHaveLength(1);
    expect(sound.calls[0].type).toBe('multiplierUp');
  });

  it('announce() with streak = 6 plays a sound at higher pitch than streak = 2', () => {
    const sound = makeSoundStub();
    const announcer = new KillStreakAnnouncer(sound);

    announcer.announce('Player1', 2);
    const pitch2 = (sound.calls[0].options as { pitch: number }).pitch;

    sound.calls.length = 0;
    announcer.announce('Player1', 6);
    const pitch6 = (sound.calls[0].options as { pitch: number }).pitch;

    expect(pitch6).toBeGreaterThan(pitch2);
  });

  it('update() hides the container after total lifetime expires (3s)', () => {
    const sound = makeSoundStub();
    const announcer = new KillStreakAnnouncer(sound);

    announcer.announce('Player1', 3);
    // Advance past 3s total (2s visible + 1s fade)
    announcer.update(3.1);

    // Container should be hidden
    const container = bodyChildren[bodyChildren.length - 1];
    expect(container.style['display']).toBe('none');
  });

  it('update() sets opacity during the fade window', () => {
    const sound = makeSoundStub();
    const announcer = new KillStreakAnnouncer(sound);

    announcer.announce('Player1', 3);
    // Advance 2s (still fully visible)
    announcer.update(2.0);
    const container = bodyChildren[bodyChildren.length - 1];
    // Opacity should be 1 (or not set yet to a fractional value)
    const opacity = parseFloat(container.style['opacity'] ?? '1');
    expect(opacity).toBeGreaterThanOrEqual(0.9);

    // Advance 0.5s into the fade window (0.5/1.0 = 0.5 opacity)
    announcer.update(0.5);
    const opacityFading = parseFloat(container.style['opacity'] ?? '1');
    expect(opacityFading).toBeLessThan(1.0);
    expect(opacityFading).toBeGreaterThan(0);
  });

  it('dispose() removes the container element from the DOM', () => {
    const sound = makeSoundStub();
    const announcer = new KillStreakAnnouncer(sound);

    // The container is the last element appended to body
    const container = bodyChildren[bodyChildren.length - 1];
    expect(container).toBeDefined();
    expect(container.parentElement).not.toBeNull();

    announcer.dispose();

    // After dispose, parentElement should be null (element removed)
    expect(container.parentElement).toBeNull();
  });
});
