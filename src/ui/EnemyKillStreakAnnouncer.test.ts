/**
 * Tests for EnemyKillStreakAnnouncer — streak tracking and announcement logic.
 *
 * Uses a minimal DOM mock (same pattern as KillStreakAnnouncer.test.ts) and
 * a stub SoundEngine. BrailleAnimator is mocked to avoid requestAnimationFrame.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock BrailleAnimator (avoids requestAnimationFrame)
// ---------------------------------------------------------------------------

vi.mock('./BrailleAnimator', () => {
  class BrailleAnimator {
    start = vi.fn();
    stop = vi.fn();
    dispose = vi.fn();
    setPattern = vi.fn();
    constructor(_container: unknown, _opts?: unknown) {}
  }
  return { BrailleAnimator, ALL_PATTERNS: [] };
});

import { EnemyKillStreakAnnouncer } from './EnemyKillStreakAnnouncer';

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

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }
}

/** Registry of elements by id — lets getElementById work. */
const elementRegistry: Map<string, MockElement> = new Map();

let headChildren: MockElement[] = [];
let bodyChildren: MockElement[] = [];

function setupDOMMock(): void {
  headChildren = [];
  bodyChildren = [];
  elementRegistry.clear();

  const mockHead = new MockElement();
  mockHead.appendChild = (child: MockElement) => {
    headChildren.push(child);
    child.parentElement = mockHead;
    if (child.id) elementRegistry.set(child.id, child);
    return child;
  };

  const mockBody = new MockElement();
  mockBody.appendChild = (child: MockElement) => {
    bodyChildren.push(child);
    child.parentElement = mockBody;
    if (child.id) elementRegistry.set(child.id, child);
    return child;
  };

  vi.stubGlobal('document', {
    createElement: (tag: string): MockElement => {
      const el = new MockElement();
      (el as any).tagName = tag.toUpperCase();
      // Override appendChild to register by id after id is set
      const origAppendChild = el.appendChild.bind(el);
      el.appendChild = (child: MockElement) => {
        const result = origAppendChild(child);
        if (child.id) elementRegistry.set(child.id, child);
        return result;
      };
      return el;
    },
    getElementById: (id: string) => elementRegistry.get(id) ?? null,
    head: mockHead,
    body: mockBody,
  });
}

function makeSoundStub() {
  return { play: vi.fn() } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnemyKillStreakAnnouncer', () => {
  let sound: ReturnType<typeof makeSoundStub>;
  let announcer: EnemyKillStreakAnnouncer;

  beforeEach(() => {
    setupDOMMock();
    sound = makeSoundStub();
    announcer = new EnemyKillStreakAnnouncer(sound);
    // Register the container by id (it's appended to body in constructor)
    const container = bodyChildren.find(el => el.id === 'enemy-kill-streak-announcer');
    if (container) elementRegistry.set(container.id, container);
    const styleEl = headChildren.find(el => el.id === 'enemy-kill-streak-announcer-style');
    if (styleEl) elementRegistry.set(styleEl.id, styleEl);
  });

  // ── streakCount tracking ─────────────────────────────────────────────────

  it('starts with streakCount 0', () => {
    expect(announcer.streakCount).toBe(0);
  });

  it('increments streakCount on each recordKill()', () => {
    announcer.recordKill();
    announcer.recordKill();
    announcer.recordKill();
    expect(announcer.streakCount).toBe(3);
  });

  it('resetStreak() sets streakCount back to 0', () => {
    for (let i = 0; i < 50; i++) announcer.recordKill();
    expect(announcer.streakCount).toBe(50);
    announcer.resetStreak();
    expect(announcer.streakCount).toBe(0);
  });

  // ── Announcement at kill 1 (first milestone) ────────────────────────────

  it('shows announcement at kill 1 (first STREAK_MILESTONE)', () => {
    announcer.recordKill();
    const container = bodyChildren.find(el => el.id === 'enemy-kill-streak-announcer');
    expect(container?.style['display']).toBe('block');
  });

  it('plays a sound at kill 1', () => {
    announcer.recordKill();
    expect(sound.play).toHaveBeenCalledWith('multiplierUp', expect.any(Object));
  });

  // ── Milestones 1–5 all trigger announcements ─────────────────────────────

  it.each([1, 2, 3, 4, 5])('shows announcement at milestone kill %i', (n) => {
    for (let i = 0; i < n; i++) announcer.recordKill();
    const container = bodyChildren.find(el => el.id === 'enemy-kill-streak-announcer');
    expect(container?.style['display']).toBe('block');
    expect(announcer.streakCount).toBe(n);
  });

  // ── No announcement on non-milestone kills ───────────────────────────────

  it('does NOT play sound for kill 6 (gap between 5 and 7)', () => {
    for (let i = 0; i < 5; i++) announcer.recordKill();
    sound.play.mockClear();
    announcer.recordKill(); // kill 6 — not a milestone
    expect(sound.play).not.toHaveBeenCalled();
  });

  // ── Kill 7 IS a milestone ─────────────────────────────────────────────────

  it('plays sound at kill 7 (next milestone after 5)', () => {
    for (let i = 0; i < 7; i++) announcer.recordKill();
    // Milestones hit: 1, 2, 3, 4, 5, 7 → 6 calls
    expect(sound.play).toHaveBeenCalledTimes(6);
  });

  // ── resetStreak after 50 kills → next kill triggers streak=1 ─────────────

  it('next kill after resetStreak() triggers streak=1 announcement', () => {
    for (let i = 0; i < 50; i++) announcer.recordKill();
    announcer.resetStreak();
    sound.play.mockClear();

    announcer.recordKill();
    expect(announcer.streakCount).toBe(1);
    expect(sound.play).toHaveBeenCalledWith('multiplierUp', expect.any(Object));
  });

  // ── update() hides overlay after total duration ───────────────────────────

  it('update() hides overlay after 3.6s (past 2.5s visible + 1.0s fade)', () => {
    announcer.recordKill();
    const container = bodyChildren.find(el => el.id === 'enemy-kill-streak-announcer')!;
    expect(container.style['display']).toBe('block');

    announcer.update(3.6);
    expect(container.style['display']).toBe('none');
  });

  it('overlay is still visible at 2.0s (within VISIBLE_DURATION)', () => {
    announcer.recordKill();
    announcer.update(2.0);
    const container = bodyChildren.find(el => el.id === 'enemy-kill-streak-announcer')!;
    expect(container.style['display']).toBe('block');
  });

  it('update() does not throw when no announcement is active', () => {
    expect(() => announcer.update(10)).not.toThrow();
  });

  // ── dispose() removes DOM elements ───────────────────────────────────────

  it('dispose() removes container from body', () => {
    const container = bodyChildren.find(el => el.id === 'enemy-kill-streak-announcer');
    expect(container).toBeDefined();

    announcer.dispose();
    expect(container?.parentElement).toBeNull();
  });

  it('dispose() removes style from head', () => {
    const styleEl = headChildren.find(el => el.id === 'enemy-kill-streak-announcer-style');
    expect(styleEl).toBeDefined();

    announcer.dispose();
    expect(styleEl?.parentElement).toBeNull();
  });

  // ── pointer-events: none ─────────────────────────────────────────────────

  it('style sheet includes pointer-events: none', () => {
    const styleEl = headChildren.find(el => el.id === 'enemy-kill-streak-announcer-style');
    expect(styleEl?.textContent).toContain('pointer-events: none');
  });

  // ── Streak count > 200 does not crash ─────────────────────────────────────

  it('kill count 200 does not crash', () => {
    expect(() => {
      for (let i = 0; i < 200; i++) announcer.recordKill();
    }).not.toThrow();
    expect(announcer.streakCount).toBe(200);
  });

  it('kill count 2000 does not crash', () => {
    expect(() => {
      for (let i = 0; i < 2000; i++) announcer.recordKill();
    }).not.toThrow();
    expect(announcer.streakCount).toBe(2000);
  });
});
