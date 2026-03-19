/**
 * Tests for EnemyKillStreakAnnouncer — consecutive enemy kill streak overlay.
 *
 * Uses the same MockElement DOM mock pattern as KillStreakAnnouncer.test.ts.
 * requestAnimationFrame is stubbed because BrailleAnimator uses it internally.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal DOM mock
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

  // BrailleAnimator uses requestAnimationFrame — stub it to prevent errors
  vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => 1);
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
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
// EnemyKillStreakAnnouncer tests
// ---------------------------------------------------------------------------

describe('EnemyKillStreakAnnouncer', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let EnemyKillStreakAnnouncer: any;

  beforeEach(async () => {
    setupDOMMock();
    vi.resetModules();
    const mod = await import('./EnemyKillStreakAnnouncer');
    EnemyKillStreakAnnouncer = mod.EnemyKillStreakAnnouncer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates DOM elements on construction (style in head, container in body)', () => {
    const sound = makeSoundStub();
    new EnemyKillStreakAnnouncer(sound);
    expect(headChildren.length).toBeGreaterThanOrEqual(1);
    expect(bodyChildren.length).toBeGreaterThanOrEqual(1);
  });

  it('recordKill() × 1 shows announcement — 1 is a milestone', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);
    announcer.recordKill();
    expect(sound.calls).toHaveLength(1);
    expect(sound.calls[0].type).toBe('multiplierUp');
    expect(announcer.streakCount).toBe(1);
  });

  it('recordKill() × 5 shows announcement at each milestone (1, 2, 3, 4, 5)', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);
    for (let i = 0; i < 5; i++) {
      announcer.recordKill();
    }
    // All 5 of 1,2,3,4,5 are milestones
    expect(sound.calls).toHaveLength(5);
    expect(announcer.streakCount).toBe(5);
  });

  it('recordKill() at non-milestone (6) does NOT trigger announcement', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);
    // Advance to 5 (all milestones), clear calls, then record 6th
    for (let i = 0; i < 5; i++) announcer.recordKill();
    sound.calls.length = 0;

    announcer.recordKill(); // kill 6 — NOT a milestone (milestones: 1,2,3,4,5,7,10,...)
    expect(sound.calls).toHaveLength(0);
  });

  it('resetStreak() sets count to 0 without playing a sound', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);
    for (let i = 0; i < 50; i++) announcer.recordKill();
    sound.calls.length = 0;

    announcer.resetStreak();
    expect(announcer.streakCount).toBe(0);
    expect(sound.calls).toHaveLength(0);
  });

  it('next kill after resetStreak() triggers streak=1 announcement', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);

    // Build up a streak and reset
    for (let i = 0; i < 10; i++) announcer.recordKill();
    announcer.resetStreak();
    sound.calls.length = 0;

    // First kill after reset — streak=1, which is a milestone
    announcer.recordKill();
    expect(announcer.streakCount).toBe(1);
    expect(sound.calls).toHaveLength(1);
    expect(sound.calls[0].type).toBe('multiplierUp');
  });

  it('update(3.6) hides overlay after 3.5s total (2.5s visible + 1.0s fade)', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);

    announcer.recordKill(); // trigger announcement at streak=1
    // Advance past 3.5s total
    announcer.update(3.6);

    const container = bodyChildren[bodyChildren.length - 1];
    expect(container.style['display']).toBe('none');
  });

  it('update() sets opacity during the fade window', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);

    announcer.recordKill(); // trigger announcement at streak=1
    // Advance 2.5s (still fully visible — no fade yet)
    announcer.update(2.5);
    const container = bodyChildren[bodyChildren.length - 1];
    const opacityAfterVisible = parseFloat(container.style['opacity'] ?? '1');
    expect(opacityAfterVisible).toBeGreaterThanOrEqual(0.9);

    // Advance 0.5s into fade window (remaining = 0.5s / 1.0s fade = 0.5 opacity)
    announcer.update(0.5);
    const opacityFading = parseFloat(container.style['opacity'] ?? '1');
    expect(opacityFading).toBeLessThan(1.0);
    expect(opacityFading).toBeGreaterThan(0);
  });

  it('dispose() removes the container element from the DOM', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);

    const container = bodyChildren[bodyChildren.length - 1];
    expect(container).toBeDefined();
    expect(container.parentElement).not.toBeNull();

    announcer.dispose();

    expect(container.parentElement).toBeNull();
  });

  it('kill count 2000 does not crash (wrapping behavior)', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);
    expect(() => {
      for (let i = 0; i < 2000; i++) {
        announcer.recordKill();
      }
    }).not.toThrow();
    expect(announcer.streakCount).toBe(2000);
  });

  it('higher tier milestone plays at higher pitch than lower tier', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);

    announcer.recordKill(); // streak=1, tier 0, pitch 0.8
    const pitch1 = (sound.calls[sound.calls.length - 1].options as { pitch: number }).pitch;

    // Advance to streak=100 (milestone, tier 7)
    for (let i = 1; i < 100; i++) announcer.recordKill();
    const pitch100 = (sound.calls[sound.calls.length - 1].options as { pitch: number }).pitch;

    expect(pitch100).toBeGreaterThan(pitch1);
  });

  it('new announcement while one is visible replaces content immediately', () => {
    const sound = makeSoundStub();
    const announcer = new EnemyKillStreakAnnouncer(sound);

    announcer.recordKill(); // streak=1 announcement
    announcer.update(1.0); // advance 1s — still visible

    announcer.recordKill(); // streak=2 — another milestone announcement
    expect(sound.calls).toHaveLength(2);

    // Container should still be visible (timeRemaining reset)
    const container = bodyChildren[bodyChildren.length - 1];
    expect(container.style['display']).toBe('block');
  });
});
