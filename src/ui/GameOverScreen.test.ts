/**
 * Tests for GameOverScreen — name/note entry and leaderboard storage.
 *
 * Runs in Node (no jsdom) so we mock the minimal DOM + localStorage APIs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// i18n mock — return English translations so string-checking tests pass
// ---------------------------------------------------------------------------

vi.mock('../i18n', () => ({
  t: (key: string, opts?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      'gameOver.title': 'GAME OVER',
      'gameOver.recordScore': 'RECORD YOUR SCORE',
      'gameOver.recordScoreBtn': 'RECORD SCORE',
      'gameOver.namePlaceholder': 'Player',
      'gameOver.nameLabelField': 'NAME',
      'gameOver.noteLabelField': 'NOTE',
      'gameOver.noteOptional': '(optional)',
      'gameOver.notePlaceholder': 'e.g. first attempt, full combo...',
      'gameOver.nameHint': 'ENTER to move to note \u00b7 ENTER again to submit',
      'gameOver.newHighScore': 'NEW HIGH SCORE!',
      'gameOver.highScores': 'HIGH SCORES',
      'gameOver.noScores': 'No scores yet',
      'gameOver.continueBtn': 'CONTINUE',
      'gameOver.returnToMenu': 'RETURN TO MENU',
      'gameOver.hintContinue': 'Press ENTER or click to continue',
      'gameOver.hintVote': 'Press ENTER to go to vote now \u00b7 click RETURN TO MENU to disconnect',
      'gameOver.autoSubmitting': 'Auto-submitting in {{count}}s\u2026',
      'gameOver.votingCountdown': 'Voting screen in {{count}}s\u2026',
    };
    if (key in map) {
      let val = map[key];
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          val = val.replace(`{{${k}}}`, String(v));
        }
      }
      return val;
    }
    return key;
  },
}));

// ---------------------------------------------------------------------------
// Minimal DOM mock
// ---------------------------------------------------------------------------

type EventCallback = (e?: Event | KeyboardEvent) => void;

class MockElement {
  id = '';
  className = '';
  textContent = '';
  innerHTML = '';
  value = '';
  placeholder = '';
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  private _eventListeners: Map<string, EventCallback[]> = new Map();

  readonly classList = (() => {
    const classes = new Set<string>();
    return {
      add: (cls: string) => classes.add(cls),
      remove: (cls: string) => classes.delete(cls),
      contains: (cls: string) => classes.has(cls),
    };
  })();

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

  addEventListener(event: string, handler: EventCallback): void {
    if (!this._eventListeners.has(event)) this._eventListeners.set(event, []);
    this._eventListeners.get(event)!.push(handler);
  }

  dispatchEvent(event: string, eventObj?: Event): void {
    const handlers = this._eventListeners.get(event) ?? [];
    for (const h of handlers) h(eventObj);
  }

  /** Simulate user clicking this element */
  click(): void { this.dispatchEvent('click'); }

  /** Helper to find first descendant matching querySelector-style selector */
  querySelector<T extends MockElement>(selector: string): T | null {
    // Support: '.class-name' and '#id' selectors (simple — enough for tests)
    const byClass = selector.startsWith('.');
    const byId = selector.startsWith('#');
    const key = selector.slice(1);
    return this._find<T>((el) =>
      byId ? el.id === key :
      byClass ? el.className.split(' ').includes(key) :
      false
    );
  }

  querySelectorAll<T extends MockElement>(selector: string): T[] {
    const byClass = selector.startsWith('.');
    const key = selector.slice(1);
    const results: T[] = [];
    this._findAll<T>((el) => byClass && el.className.split(' ').includes(key), results);
    return results;
  }

  private _find<T extends MockElement>(pred: (el: MockElement) => boolean): T | null {
    for (const child of this.children) {
      if (pred(child)) return child as T;
      const found = child._find<T>(pred);
      if (found) return found;
    }
    return null;
  }

  private _findAll<T extends MockElement>(pred: (el: MockElement) => boolean, acc: T[]): void {
    for (const child of this.children) {
      if (pred(child)) acc.push(child as T);
      child._findAll<T>(pred, acc);
    }
  }
}

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let lsMock: ReturnType<typeof makeLocalStorageMock>;

function setupDOMMock() {
  lsMock = makeLocalStorageMock();

  const mockHead = new MockElement();
  const mockBody = new MockElement();

  vi.stubGlobal('document', {
    createElement: (tag: string): MockElement => {
      const el = new MockElement();
      (el as unknown as { tagName: string }).tagName = tag.toUpperCase();
      return el;
    },
    head: mockHead,
    body: mockBody,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  vi.stubGlobal('localStorage', lsMock);

  // setTimeout/clearTimeout are no-ops in unit tests
  vi.stubGlobal('setTimeout', (fn: () => void, _ms?: number) => {
    // Execute synchronously for predictable tests
    fn();
    return 0;
  });
  vi.stubGlobal('clearTimeout', vi.fn());
  vi.stubGlobal('setInterval', (_fn: () => void, _ms?: number) => 0);
  vi.stubGlobal('clearInterval', vi.fn());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameOverScreen', () => {
  let GameOverScreen: typeof import('./GameOverScreen').GameOverScreen;

  beforeEach(async () => {
    setupDOMMock();
    vi.resetModules();
    const mod = await import('./GameOverScreen');
    GameOverScreen = mod.GameOverScreen;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor & basic rendering ─────────────────────────────────────

  it('creates container appended to document.body', () => {
    const screen = new GameOverScreen();
    const bodyChildren = (document.body as unknown as MockElement).children;
    expect(bodyChildren.length).toBeGreaterThan(0);
    screen.dispose();
  });

  it('starts hidden', () => {
    const screen = new GameOverScreen();
    const container = (document.body as unknown as MockElement).children.at(-1)!;
    expect(container.classList.contains('hidden')).toBe(true);
    screen.dispose();
  });

  // ── show() renders name entry phase ──────────────────────────────────

  it('show() renders name-entry form', () => {
    const screen = new GameOverScreen();
    screen.show(1234, 'sphere');

    const container = (document.body as unknown as MockElement).children.at(-1)!;
    expect(container.classList.contains('hidden')).toBe(false);
    // innerHTML should contain RECORD YOUR SCORE heading
    expect(container.innerHTML).toContain('RECORD YOUR SCORE');
    // And the score
    expect(container.innerHTML).toContain('1,234');
    screen.dispose();
  });

  it('show() pre-fills last name from localStorage', () => {
    lsMock.setItem('geometry_wars_last_name', 'AcePlayer');
    const screen = new GameOverScreen();
    screen.show(500, 'torus');

    const container = (document.body as unknown as MockElement).children.at(-1)!;
    expect(container.innerHTML).toContain('AcePlayer');
    screen.dispose();
  });

  it('show() uses custom scoreLabel', () => {
    const screen = new GameOverScreen();
    screen.show(999, 'cube', 'solo', 'ZONE TIME');

    const container = (document.body as unknown as MockElement).children.at(-1)!;
    expect(container.innerHTML).toContain('ZONE TIME');
    screen.dispose();
  });

  // ── hide() ────────────────────────────────────────────────────────────

  it('hide() adds hidden class', () => {
    const screen = new GameOverScreen();
    screen.show(100, 'sphere');

    const container = (document.body as unknown as MockElement).children.at(-1)!;
    screen.hide();
    expect(container.classList.contains('hidden')).toBe(true);
    screen.dispose();
  });

  // ── localStorage — scores saved with name + note ──────────────────────

  it('saveScore stores name and note in localStorage', () => {
    // We need to simulate the submit button click to trigger save.
    // Since setTimeout is synchronous in our mock, show() → renderNameEntry()
    // will have the submit button in the innerHTML.
    const screen = new GameOverScreen();
    screen.show(5000, 'knot');

    // The innerHTML is a string; manually trigger save via the private method
    // by accessing it through the prototype (for unit testing purposes).
    // Instead, call the public API via "submit" simulation:
    // The submit-score-btn click handler was registered in renderNameEntry.
    // But MockElement.querySelector traverses children — since we set innerHTML
    // as a string, there are no real child elements in our mock.
    // We'll test storage by exercising the escapeHTML and saveScore methods
    // indirectly through the full flow with a proper querySelector mock.

    // Direct method test via prototype access:
    const proto = Object.getPrototypeOf(screen) as {
      saveScore: (score: number, surface: string, name: string, note: string) => { isNewHighScore: boolean; rank: number };
      getHighScores: () => Array<{ score: number; surface: string; name?: string; note?: string }>;
    };

    const { isNewHighScore, rank } = proto.saveScore.call(screen, 5000, 'knot', 'TestUser', 'great run');
    expect(rank).toBe(1);
    expect(isNewHighScore).toBe(true);

    const scores = proto.getHighScores.call(screen);
    expect(scores).toHaveLength(1);
    expect(scores[0].name).toBe('TestUser');
    expect(scores[0].note).toBe('great run');
    expect(scores[0].score).toBe(5000);
    expect(scores[0].surface).toBe('knot');

    screen.dispose();
  });

  it('saveScore uses "Player" when name is empty', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      saveScore: (score: number, surface: string, name: string, note: string) => { isNewHighScore: boolean; rank: number };
      getHighScores: () => Array<{ name?: string }>;
    };

    proto.saveScore.call(screen, 1000, 'sphere', '', '');
    const scores = proto.getHighScores.call(screen);
    expect(scores[0].name).toBe('Player');
    screen.dispose();
  });

  it('saveScore omits note key when note is empty', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      saveScore: (score: number, surface: string, name: string, note: string) => unknown;
      getHighScores: () => Array<{ note?: string }>;
    };

    proto.saveScore.call(screen, 1000, 'sphere', 'Alice', '');
    const scores = proto.getHighScores.call(screen);
    expect(scores[0].note).toBeUndefined();
    screen.dispose();
  });

  it('scores are ordered descending', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      saveScore: (score: number, surface: string, name: string, note: string) => { rank: number };
      getHighScores: () => Array<{ score: number; name?: string }>;
    };

    proto.saveScore.call(screen, 1000, 'sphere', 'Alice', '');
    proto.saveScore.call(screen, 5000, 'sphere', 'Bob', '');
    proto.saveScore.call(screen, 3000, 'sphere', 'Carol', '');

    const scores = proto.getHighScores.call(screen);
    expect(scores[0].score).toBe(5000);
    expect(scores[1].score).toBe(3000);
    expect(scores[2].score).toBe(1000);
    screen.dispose();
  });

  it('keeps only top MAX_HIGH_SCORES entries', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      saveScore: (score: number, surface: string, name: string, note: string) => unknown;
      getHighScores: () => Array<{ score: number }>;
    };

    for (let i = 1; i <= 12; i++) {
      proto.saveScore.call(screen, i * 100, 'sphere', `P${i}`, '');
    }

    const scores = proto.getHighScores.call(screen);
    expect(scores.length).toBe(10);
    expect(scores[0].score).toBe(1200);
    screen.dispose();
  });

  // ── Last name persistence ─────────────────────────────────────────────

  it('getLastName returns empty string when nothing stored', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      getLastName: () => string;
    };
    expect(proto.getLastName.call(screen)).toBe('');
    screen.dispose();
  });

  it('saveLastName persists to localStorage', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      saveLastName: (name: string) => void;
      getLastName: () => string;
    };
    proto.saveLastName.call(screen, 'SpeedRunner');
    expect(proto.getLastName.call(screen)).toBe('SpeedRunner');
    // Also confirm it's in actual mock store
    expect(lsMock.getItem('geometry_wars_last_name')).toBe('SpeedRunner');
    screen.dispose();
  });

  // ── Rank logic ────────────────────────────────────────────────────────

  it('isNewHighScore is true only for first place', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      saveScore: (score: number, surface: string, name: string, note: string) => { isNewHighScore: boolean; rank: number };
    };

    const r1 = proto.saveScore.call(screen, 9999, 'sphere', 'A', '');
    expect(r1.isNewHighScore).toBe(true);
    expect(r1.rank).toBe(1);

    const r2 = proto.saveScore.call(screen, 5000, 'sphere', 'B', '');
    expect(r2.isNewHighScore).toBe(false);
    expect(r2.rank).toBe(2);

    screen.dispose();
  });

  it('isNewHighScore is false for score of 0', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      saveScore: (score: number, surface: string, name: string, note: string) => { isNewHighScore: boolean };
    };
    const r = proto.saveScore.call(screen, 0, 'sphere', 'A', '');
    expect(r.isNewHighScore).toBe(false);
    screen.dispose();
  });

  // ── escapeHTML ────────────────────────────────────────────────────────

  it('escapeHTML neutralises XSS characters', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      escapeHTML: (s: string) => string;
    };
    expect(proto.escapeHTML.call(screen, '<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(proto.escapeHTML.call(screen, '"hello"')).toBe('&quot;hello&quot;');
    expect(proto.escapeHTML.call(screen, 'a&b')).toBe('a&amp;b');
    screen.dispose();
  });

  // ── onContinue / onReturnToMenu callbacks ─────────────────────────────

  it('onContinue callback is stored', () => {
    const screen = new GameOverScreen();
    const cb = vi.fn();
    screen.onContinue(cb);
    // Access private field via cast
    expect((screen as unknown as { onContinueCallback: () => void }).onContinueCallback).toBe(cb);
    screen.dispose();
  });

  it('onReturnToMenu callback is stored', () => {
    const screen = new GameOverScreen();
    const cb = vi.fn();
    screen.onReturnToMenu(cb);
    expect((screen as unknown as { onReturnToMenuCallback: () => void }).onReturnToMenuCallback).toBe(cb);
    screen.dispose();
  });

  // ── createResultsHTML ─────────────────────────────────────────────────

  it('createResultsHTML includes player names and notes in score list', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      createResultsHTML: (
        score: number,
        isNew: boolean,
        rank: number,
        scores: Array<{ score: number; surface: string; name?: string; note?: string }>,
        mode: 'solo' | 'network',
        label: string,
      ) => string;
    };

    const html = proto.createResultsHTML.call(
      screen,
      5000,
      true,
      1,
      [{ score: 5000, surface: 'sphere', name: 'Alice', note: 'my best' }],
      'solo',
      'SCORE',
    );

    expect(html).toContain('Alice');
    expect(html).toContain('my best');
    expect(html).toContain('NEW HIGH SCORE');
    expect(html).toContain('CONTINUE');

    screen.dispose();
  });

  it('createResultsHTML falls back to "Player" when name is undefined', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      createResultsHTML: (
        score: number,
        isNew: boolean,
        rank: number,
        scores: Array<{ score: number; surface: string }>,
        mode: 'solo' | 'network',
        label: string,
      ) => string;
    };

    const html = proto.createResultsHTML.call(
      screen,
      100,
      false,
      1,
      [{ score: 100, surface: 'torus' }],
      'solo',
      'SCORE',
    );

    expect(html).toContain('Player');
    screen.dispose();
  });

  it('createResultsHTML omits note span when note is absent', () => {
    const screen = new GameOverScreen();
    const proto = Object.getPrototypeOf(screen) as {
      createResultsHTML: (
        score: number,
        isNew: boolean,
        rank: number,
        scores: Array<{ score: number; surface: string; name?: string; note?: string }>,
        mode: 'solo' | 'network',
        label: string,
      ) => string;
    };

    const html = proto.createResultsHTML.call(
      screen,
      100,
      false,
      1,
      [{ score: 100, surface: 'torus', name: 'Bob' }],
      'solo',
      'SCORE',
    );

    expect(html).not.toContain('player-note');
    screen.dispose();
  });

  // ── dispose ───────────────────────────────────────────────────────────

  it('dispose removes container from body', () => {
    const screen = new GameOverScreen();
    const bodyEl = document.body as unknown as MockElement;
    const before = bodyEl.children.length;
    screen.dispose();
    expect(bodyEl.children.length).toBe(before - 1);
  });
});
