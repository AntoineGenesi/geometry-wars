import { describe, expect, it } from 'vitest';
import { GameState } from './GameState';

describe('GameState pause defaults', () => {
  it('defaults allowAllPlayersPause on while starting unpaused', () => {
    const state = new GameState();

    expect(state.isPaused).toBe(false);
    expect(state.pauseRevision).toBe(0);
    expect(state.pausedById).toBe('');
    expect(state.allowAllPlayersPause).toBe(true);
  });
});
