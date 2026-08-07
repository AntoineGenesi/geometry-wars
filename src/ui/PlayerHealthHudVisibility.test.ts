import { describe, expect, it } from 'vitest';
import { shouldShowBottomPlayerHealthHud } from './PlayerHealthHudVisibility';

describe('shouldShowBottomPlayerHealthHud', () => {
  it('hides bottom health before a match starts', () => {
    expect(shouldShowBottomPlayerHealthHud({ gameStarted: false, pvpEnabled: true })).toBe(false);
  });

  it('hides bottom health for co-op Waves where PvP health is disabled', () => {
    expect(shouldShowBottomPlayerHealthHud({ gameStarted: true, pvpEnabled: false })).toBe(false);
  });

  it('keeps bottom health visible for PvP and PvPvE server states', () => {
    expect(shouldShowBottomPlayerHealthHud({ gameStarted: true, pvpEnabled: true })).toBe(true);
  });
});
