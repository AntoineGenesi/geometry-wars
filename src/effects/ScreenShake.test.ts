import { describe, expect, it } from 'vitest';
import { ScreenShake } from './ScreenShake';

describe('ScreenShake', () => {
  it('caps rapid kill shake so it cannot accumulate into continuous high jitter', () => {
    const shake = new ScreenShake();

    for (let i = 0; i < 20; i++) {
      shake.shakeKill(0.35, 0.15);
    }

    let state = shake.getDebugState();
    expect(state.acceptedKillShakes).toBe(1);
    expect(state.suppressedKillShakes).toBe(19);
    expect(state.activeKillCount).toBe(1);

    shake.update(0.07);
    shake.shakeKill(0.35, 0.15);
    state = shake.getDebugState();
    expect(state.acceptedKillShakes).toBe(2);
    expect(state.activeKillCount).toBeLessThanOrEqual(2);

    for (let i = 0; i < 20; i++) {
      shake.update(1 / 60);
      shake.shakeKill(0.35, 0.15);
      expect(shake.getDebugState().activeKillCount).toBeLessThanOrEqual(2);
    }
  });

  it('preserves larger non-kill event shakes under the normal event cap', () => {
    const shake = new ScreenShake();

    for (let i = 0; i < 8; i++) {
      shake.shake(0.5, 0.4);
    }

    const state = shake.getDebugState();
    expect(state.activeCount).toBe(4);
    expect(state.activeKillCount).toBe(0);
  });
});
