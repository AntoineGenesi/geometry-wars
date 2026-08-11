import { describe, expect, it } from 'vitest';
import { planMatchBoundaryPauseUiClear } from './mpPauseBoundary';

describe('planMatchBoundaryPauseUiClear', () => {
  it('clears stale local pause and local menu state for a playing match boundary', () => {
    expect(planMatchBoundaryPauseUiClear('playing', 4, 6)).toEqual({
      isPaused: false,
      lastAuthoritativePaused: false,
      pausedByName: '',
      isInLookMode: false,
      localMenuOpen: false,
      lastPauseRevision: 6,
      touchGamePaused: false,
    });
  });

  it('keeps touch input pass-through while entering voting', () => {
    const plan = planMatchBoundaryPauseUiClear('voting', 4, 5);

    expect(plan.touchGamePaused).toBe(true);
    expect(plan.lastPauseRevision).toBe(5);
  });

  it('does not move pause revision backwards when a stale phase packet arrives', () => {
    const plan = planMatchBoundaryPauseUiClear('playing', 9, 2);

    expect(plan.lastPauseRevision).toBe(9);
    expect(plan.touchGamePaused).toBe(false);
  });

  it('preserves last revision when no authoritative boundary revision is supplied', () => {
    expect(planMatchBoundaryPauseUiClear('playing', 3).lastPauseRevision).toBe(3);
  });
});
