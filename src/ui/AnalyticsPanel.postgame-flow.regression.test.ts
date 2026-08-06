/**
 * Regression tests for s44r20-05: post-game freeze frame / no menu return.
 *
 * Root cause: AnalyticsPanel.show() set up a 400ms setTimeout that added a keydown
 * listener AFTER the button-click close handler had already run. This orphaned listener
 * fired the onCloseCallback a second time on the next keypress, stacking a duplicate
 * MasteryProgressScreen + WeaponMasteryScreen on top of the current ones and causing
 * the page to appear frozen (no redirect ever reached).
 *
 * These tests verify the fix: the close callback fires EXACTLY once regardless of
 * which dismiss path (button vs keyboard) is used, and the pending timer is cancelled
 * when the button is clicked before 400ms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ENEMY_DISPLAY, ENEMY_TYPE_COLORS, AnalyticsPanel } from './AnalyticsPanel';
import { ENEMY_TYPES } from '../entities/enemies/EnemySpawner';

const describeWithDom = typeof document === 'undefined' ? describe.skip : describe;

describe('AnalyticsPanel enemy roster mapping', () => {
  it('has display names and colors for every current enemy type', () => {
    const missingDisplay = ENEMY_TYPES.filter(type => !ENEMY_DISPLAY[type]);
    const missingColor = ENEMY_TYPES.filter(type => !ENEMY_TYPE_COLORS[type]);

    expect(missingDisplay).toEqual([]);
    expect(missingColor).toEqual([]);
  });
});

// Minimal PerformanceLogger stub that satisfies getWeaponAnalytics()
const makeLogger = () => ({
  getWeaponAnalytics: () => ({
    weaponTimeline: [],
    killsByWeapon: [],
    buffKillContrib: [],
  }),
  getDataPoints: () => [],
  getEvents: () => [],
  getSessionSummary: () => ({
    avgFps: 0,
    minFps: 0,
    maxFps: 0,
    peakEnemies: 0,
    peakBullets: 0,
    peakDrawCalls: 0,
    totalSpikes: 0,
    finalScore: 0,
    totalKills: 0,
    totalDeaths: 0,
  }),
  getKillTimelineByEnemyType: () => ({
    times: [],
    types: [],
    series: [],
  }),
  getKillsByEnemyType: () => [],
});

describeWithDom('AnalyticsPanel — post-game flow regression (s44r20-05)', () => {
  let panel: AnalyticsPanel;

  beforeEach(() => {
    vi.useFakeTimers();
    panel = new AnalyticsPanel();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up panel container from document body
    document.getElementById('analytics-panel')?.remove();
  });

  it('onCloseCallback fires exactly once when close button is clicked (no orphaned key listener)', () => {
    const cb = vi.fn();
    panel.onClose(cb);
    panel.show(makeLogger() as any);

    // Click the close button before 400ms timer fires
    const closeBtn = document.querySelector<HTMLButtonElement>('.ap-close-btn');
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();

    expect(cb).toHaveBeenCalledTimes(1);

    // Advance past the 400ms timer — it should have been cancelled
    vi.advanceTimersByTime(500);

    // Simulate a keypress that would have triggered the orphaned handler
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Must still be exactly 1 — NOT 2
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onCloseCallback fires exactly once when Escape key is pressed', () => {
    const cb = vi.fn();
    panel.onClose(cb);
    panel.show(makeLogger() as any);

    // Advance past 400ms so key listener is active
    vi.advanceTimersByTime(400);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(cb).toHaveBeenCalledTimes(1);

    // A second keypress must NOT fire again
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onCloseCallback fires exactly once when Enter key is pressed', () => {
    const cb = vi.fn();
    panel.onClose(cb);
    panel.show(makeLogger() as any);

    vi.advanceTimersByTime(400);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);

    // Second keypress must not fire
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onCloseCallback fires exactly once when Space key is pressed', () => {
    const cb = vi.fn();
    panel.onClose(cb);
    panel.show(makeLogger() as any);

    vi.advanceTimersByTime(400);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('renders fixed enemy preview cells in the KILLS tab sorted by kill count', () => {
    const logger = {
      ...makeLogger(),
      getKillsByEnemyType: () => [
        { enemyType: 'wanderer', kills: 9 },
        { enemyType: 'prism_lancer', kills: 7 },
        { enemyType: 'sentinel_orb', kills: 5 },
        { enemyType: 'shatter_bloom', kills: 4 },
        { enemyType: 'grunt', kills: 3 },
        { enemyType: 'rocket', kills: 2 },
      ],
    };

    panel.show(logger as any);
    document.querySelector<HTMLButtonElement>('.ap-tab:nth-child(2)')!.click();

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.ap-kill-row'));
    expect(rows).toHaveLength(6);
    expect(rows[0].querySelector('.ap-kill-name')?.textContent).toBe('Wanderer');
    expect(rows[1].querySelector('.ap-kill-name')?.textContent).toBe('Prism Lancer');
    expect(rows[1].querySelector('[data-enemy-preview="prism_lancer"]')).not.toBeNull();
    expect(rows[2].querySelector('[data-enemy-preview="sentinel_orb"]')).not.toBeNull();
    expect(rows[3].querySelector('[data-enemy-preview="shatter_bloom"]')).not.toBeNull();
    expect(document.querySelector('.ap-kills-list')).not.toBeNull();
  });

});
