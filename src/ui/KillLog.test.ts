/**
 * Tests for KillLog streak logic and TotalKillCounter.
 *
 * Since vitest runs in Node (no jsdom), we mock the minimal DOM API
 * surface used by KillLog and TotalKillCounter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal DOM mock
// ---------------------------------------------------------------------------

class MockElement {
  className = '';
  id = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  readonly classList = {
    _classes: new Set<string>(),
    add(cls: string) { this._classes.add(cls); },
    remove(cls: string) { this._classes.delete(cls); },
    contains(cls: string) { return this._classes.has(cls); },
  };

  // Used for forced reflow
  get offsetWidth() { return 100; }
  get offsetHeight() { return 50; }
  get scrollHeight() { return 200; }
  set scrollTop(_v: number) { /* noop */ }

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

  addEventListener(_event: string, _handler: () => void, _opts?: unknown): void {
    // noop for tests
  }
}

const createdElements: MockElement[] = [];
const headChildren: MockElement[] = [];
const bodyChildren: MockElement[] = [];

function setupDOMMock(): void {
  createdElements.length = 0;
  headChildren.length = 0;
  bodyChildren.length = 0;

  const mockHead = new MockElement();
  mockHead.appendChild = (child: MockElement) => {
    headChildren.push(child);
    return child;
  };

  const mockBody = new MockElement();
  mockBody.appendChild = (child: MockElement) => {
    bodyChildren.push(child);
    return child;
  };

  vi.stubGlobal('document', {
    createElement: (tag: string): MockElement => {
      const el = new MockElement();
      (el as unknown as { tagName: string }).tagName = tag.toUpperCase();
      createdElements.push(el);
      return el;
    },
    head: mockHead,
    body: mockBody,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KillLog', () => {
  let KillLog: typeof import('./KillLog').KillLog;

  beforeEach(async () => {
    setupDOMMock();
    // Dynamic import so the module initialisation picks up the mocked DOM
    const mod = await import('./KillLog');
    KillLog = mod.KillLog;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('streak tracking', () => {
    it('first kill of a type starts at count 1', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      const entries = log.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('grunt');
      expect(entries[0].count).toBe(1);
    });

    it('repeated kills of same type increment the streak counter', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      log.addKill('grunt', 0x4444ff);
      log.addKill('grunt', 0x4444ff);
      const entries = log.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].count).toBe(3);
    });

    it('killing same type resets the age timer (keeps streak alive)', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      // Advance time by 8 seconds (close to fade threshold)
      log.update(8);
      expect(log.getEntries()[0].age).toBeCloseTo(8, 1);

      // Kill again -- should reset age to 0
      log.addKill('grunt', 0x4444ff);
      expect(log.getEntries()[0].age).toBe(0);
      expect(log.getEntries()[0].count).toBe(2);
    });

    it('different enemy types create separate entries', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      log.addKill('wanderer', 0xaa44ff);
      log.addKill('grunt', 0x4444ff);
      const entries = log.getEntries();
      expect(entries).toHaveLength(2);
      // grunt should be at the end (most recent, reordered)
      const gruntEntry = entries.find(e => e.type === 'grunt');
      const wandererEntry = entries.find(e => e.type === 'wanderer');
      expect(gruntEntry?.count).toBe(2);
      expect(wandererEntry?.count).toBe(1);
    });

    it('entry fades out after timeout and is removed', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      // Advance past FADE_AFTER_SECONDS (10) + FADE_DURATION_SECONDS (2)
      log.update(13);
      expect(log.getEntries()).toHaveLength(0);
    });

    it('streak survives if kill happens before timeout', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      log.update(9); // 9s, close to 10s fade threshold
      log.addKill('grunt', 0x4444ff); // reset timer
      log.update(9); // 9 more seconds, but age reset to 0
      // Should still be alive (age = 9, not past 10)
      expect(log.getEntries()).toHaveLength(1);
      expect(log.getEntries()[0].count).toBe(2);
    });

    it('streak ends when entry fully fades (removed from DOM)', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      log.addKill('grunt', 0x4444ff);
      log.addKill('grunt', 0x4444ff);
      expect(log.getStreakCount('grunt')).toBe(3);

      // Let it fully fade
      log.update(13);
      expect(log.getStreakCount('grunt')).toBe(0);

      // New kill starts fresh streak at 1
      log.addKill('grunt', 0x4444ff);
      expect(log.getStreakCount('grunt')).toBe(1);
    });

    it('getStreakCount returns 0 for unknown type', () => {
      const log = new KillLog();
      expect(log.getStreakCount('nonexistent')).toBe(0);
    });

    it('max visible entries prunes oldest when exceeded', () => {
      const log = new KillLog();
      // Add 11 different types (max is 10)
      const types = [
        'grunt', 'wanderer', 'duck', 'neutron', 'rocket',
        'spinner', 'weaver', 'mayfly', 'painter', 'snake', 'repulsor',
      ];
      for (const t of types) {
        log.addKill(t, 0xffffff);
      }
      // Should have at most 10 entries
      expect(log.getEntries().length).toBeLessThanOrEqual(10);
    });
  });

  describe('onKill callback', () => {
    it('fires for every addKill call', () => {
      const log = new KillLog();
      const calls: Array<[string, number]> = [];
      log.onKill = (type, color) => calls.push([type, color]);

      log.addKill('grunt', 0x4444ff);
      log.addKill('grunt', 0x4444ff);
      log.addKill('wanderer', 0xaa44ff);

      expect(calls).toHaveLength(3);
      expect(calls[0]).toEqual(['grunt', 0x4444ff]);
      expect(calls[1]).toEqual(['grunt', 0x4444ff]);
      expect(calls[2]).toEqual(['wanderer', 0xaa44ff]);
    });
  });

  describe('dispose', () => {
    it('clears all entries', () => {
      const log = new KillLog();
      log.addKill('grunt', 0x4444ff);
      log.addKill('wanderer', 0xaa44ff);
      log.dispose();
      expect(log.getEntries()).toHaveLength(0);
    });
  });
});

describe('TotalKillCounter', () => {
  let TotalKillCounter: typeof import('./TotalKillCounter').TotalKillCounter;

  beforeEach(async () => {
    setupDOMMock();
    const mod = await import('./TotalKillCounter');
    TotalKillCounter = mod.TotalKillCounter;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with zero kills', () => {
    const counter = new TotalKillCounter();
    expect(counter.getTotalKills()).toBe(0);
    expect(counter.getKillCount('grunt')).toBe(0);
    expect(counter.getAllKills()).toHaveLength(0);
  });

  it('tracks cumulative kills per enemy type', () => {
    const counter = new TotalKillCounter();
    counter.addKill('grunt');
    counter.addKill('grunt');
    counter.addKill('wanderer');
    expect(counter.getKillCount('grunt')).toBe(2);
    expect(counter.getKillCount('wanderer')).toBe(1);
    expect(counter.getTotalKills()).toBe(3);
  });

  it('getAllKills returns sorted by count descending', () => {
    const counter = new TotalKillCounter();
    counter.addKill('wanderer');
    counter.addKill('grunt');
    counter.addKill('grunt');
    counter.addKill('grunt');
    counter.addKill('wanderer');

    const all = counter.getAllKills();
    expect(all[0].type).toBe('grunt');
    expect(all[0].count).toBe(3);
    expect(all[1].type).toBe('wanderer');
    expect(all[1].count).toBe(2);
  });

  it('kills persist (never fade like KillLog)', () => {
    const counter = new TotalKillCounter();
    counter.addKill('grunt');
    counter.addKill('grunt');
    // No update() call needed -- TotalKillCounter has no aging
    expect(counter.getKillCount('grunt')).toBe(2);
    expect(counter.getTotalKills()).toBe(2);
  });

  it('reset clears all data', () => {
    const counter = new TotalKillCounter();
    counter.addKill('grunt');
    counter.addKill('wanderer');
    counter.reset();
    expect(counter.getTotalKills()).toBe(0);
    expect(counter.getKillCount('grunt')).toBe(0);
    expect(counter.getAllKills()).toHaveLength(0);
  });

  it('handles many different enemy types', () => {
    const counter = new TotalKillCounter();
    const types = [
      'grunt', 'wanderer', 'duck', 'neutron', 'rocket',
      'spinner', 'weaver', 'mayfly', 'painter', 'snake',
      'repulsor', 'gravitywell', 'spawner', 'virus', 'gate',
    ];
    for (const t of types) {
      counter.addKill(t);
      counter.addKill(t);
    }
    expect(counter.getTotalKills()).toBe(30);
    expect(counter.getAllKills()).toHaveLength(15);
    for (const entry of counter.getAllKills()) {
      expect(entry.count).toBe(2);
    }
  });

  it('getKillCount returns 0 for unknown type', () => {
    const counter = new TotalKillCounter();
    expect(counter.getKillCount('nonexistent')).toBe(0);
  });
});

describe('KillIcons', () => {
  it('shapeIconSVG returns SVG string for known types', async () => {
    const { shapeIconSVG } = await import('./KillIcons');
    const svg = shapeIconSVG('grunt', '#4444ff');
    expect(svg).toContain('<svg');
    expect(svg).toContain('#4444ff');
    expect(svg).toContain('width="14"');
  });

  it('shapeIconSVG respects size parameter', async () => {
    const { shapeIconSVG } = await import('./KillIcons');
    const svg = shapeIconSVG('grunt', '#ff0000', 20);
    expect(svg).toContain('width="20"');
    expect(svg).toContain('height="20"');
  });

  it('shapeIconSVG returns fallback hexagon for unknown type', async () => {
    const { shapeIconSVG } = await import('./KillIcons');
    const svg = shapeIconSVG('unknowntype', '#aaaaaa');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polygon');
  });

  it('colorToHex converts numbers to hex strings', async () => {
    const { colorToHex } = await import('./KillIcons');
    expect(colorToHex(0xff0000)).toBe('#ff0000');
    expect(colorToHex(0x000000)).toBe('#000000');
    expect(colorToHex(0x4444ff)).toBe('#4444ff');
  });

  it('getEnemyColor returns known colours', async () => {
    const { getEnemyColor } = await import('./KillIcons');
    expect(getEnemyColor('grunt')).toBe('#4444ff');
    expect(getEnemyColor('boss')).toBe('#ffcc00');
  });

  it('getEnemyColor returns grey fallback for unknown type', async () => {
    const { getEnemyColor } = await import('./KillIcons');
    expect(getEnemyColor('unknowntype')).toBe('#aaaaaa');
  });

  it('DISPLAY_NAMES has entries for all standard enemy types', async () => {
    const { DISPLAY_NAMES } = await import('./KillIcons');
    const expectedTypes = [
      'grunt', 'wanderer', 'duck', 'neutron', 'rocket',
      'spinner', 'weaver', 'mayfly', 'painter', 'snake',
      'repulsor', 'gravitywell', 'spawner', 'virus', 'gate',
      'titangrunt', 'titanspinner', 'titanweaver', 'boss',
    ];
    for (const type of expectedTypes) {
      expect(DISPLAY_NAMES[type]).toBeDefined();
    }
  });
});

describe('KillLog + TotalKillCounter integration', () => {
  beforeEach(() => {
    setupDOMMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TotalKillCounter receives all kills via onKill callback', async () => {
    const { KillLog } = await import('./KillLog');
    const { TotalKillCounter } = await import('./TotalKillCounter');

    const log = new KillLog();
    const counter = new TotalKillCounter();
    log.onKill = (type, color) => counter.addKill(type, color);

    log.addKill('grunt', 0x4444ff);
    log.addKill('grunt', 0x4444ff);
    log.addKill('wanderer', 0xaa44ff);

    // KillLog has streaks (grunt x2 is one entry)
    expect(log.getEntries()).toHaveLength(2);
    expect(log.getStreakCount('grunt')).toBe(2);

    // TotalKillCounter has cumulative counts
    expect(counter.getTotalKills()).toBe(3);
    expect(counter.getKillCount('grunt')).toBe(2);
    expect(counter.getKillCount('wanderer')).toBe(1);
  });

  it('total counter persists after kill log entries fade', async () => {
    const { KillLog } = await import('./KillLog');
    const { TotalKillCounter } = await import('./TotalKillCounter');

    const log = new KillLog();
    const counter = new TotalKillCounter();
    log.onKill = (type, color) => counter.addKill(type, color);

    log.addKill('grunt', 0x4444ff);
    log.addKill('grunt', 0x4444ff);
    log.addKill('grunt', 0x4444ff);

    // Fade out the log entry completely
    log.update(13);
    expect(log.getEntries()).toHaveLength(0);

    // Total counter still has all 3 kills
    expect(counter.getTotalKills()).toBe(3);
    expect(counter.getKillCount('grunt')).toBe(3);
  });
});
