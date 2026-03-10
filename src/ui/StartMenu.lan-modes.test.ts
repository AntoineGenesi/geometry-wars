/**
 * Regression test: LAN lobby must show all 7 game modes including PvP and PvPvE.
 *
 * Bug (s44r7-03): LAN_GAME_MODES was missing pvp and pvpve — only 5 modes shown
 * in the MP host lobby. QUICK_GAME_MODES (SP-only) was used instead.
 *
 * Fix: createLanGameModeSelectorHTML() now uses LAN_GAME_MODES which includes
 * all 7 modes (waves, king, sniper, rainbow, claustrophobia, pvp, pvpve).
 */

import { describe, it, expect } from 'vitest';
import { LAN_GAME_MODES, type LanGameMode } from './StartMenu';

describe('LAN_GAME_MODES — s44r7-03 regression', () => {
  it('includes pvp mode', () => {
    const ids = LAN_GAME_MODES.map(m => m.type);
    expect(ids).toContain('pvp');
  });

  it('includes pvpve mode', () => {
    const ids = LAN_GAME_MODES.map(m => m.type);
    expect(ids).toContain('pvpve');
  });

  it('includes all 7 game modes', () => {
    const ids = LAN_GAME_MODES.map(m => m.type);
    expect(ids).toContain('waves');
    expect(ids).toContain('king');
    expect(ids).toContain('sniper');
    expect(ids).toContain('rainbow');
    expect(ids).toContain('claustrophobia');
    expect(ids).toContain('pvp');
    expect(ids).toContain('pvpve');
    expect(LAN_GAME_MODES).toHaveLength(7);
  });

  it('each mode has required fields: type, name, icon', () => {
    for (const mode of LAN_GAME_MODES) {
      expect(mode.type).toBeTruthy();
      expect(mode.name).toBeTruthy();
      expect(mode.icon).toBeTruthy();
    }
  });

  it('pvp and pvpve have distinct icons from the SP-only modes', () => {
    const pvp = LAN_GAME_MODES.find(m => m.type === 'pvp');
    const pvpve = LAN_GAME_MODES.find(m => m.type === 'pvpve');
    expect(pvp?.icon).toBeTruthy();
    expect(pvpve?.icon).toBeTruthy();
    expect(pvp?.icon).not.toEqual(pvpve?.icon);
  });
});
