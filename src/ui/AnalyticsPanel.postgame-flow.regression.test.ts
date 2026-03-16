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
import { AnalyticsPanel } from './AnalyticsPanel';

// Minimal PerformanceLogger stub that satisfies getWeaponAnalytics()
const makeLogger = () => ({
  getWeaponAnalytics: () => ({
    weaponUsage: [],
    killsByWeapon: {},
    buffKills: {},
    totalKills: 0,
    sessionDurationMs: 1000,
  }),
});

describe('AnalyticsPanel — post-game flow regression (s44r20-05)', () => {
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
});
