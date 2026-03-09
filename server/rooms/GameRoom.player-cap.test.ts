/**
 * Regression tests for s44r6-19: Remove 4-player hard cap, default 10, host-configurable.
 *
 * Tests:
 * 1. validateSettings accepts maxPlayers 2-20 and clamps outside values
 * 2. DEFAULT_GAME_SETTINGS has maxPlayers = 10
 * 3. Enemy scaling formula for >4 players
 * 4. Player color generation for >4 players (no crash, distinct colors)
 * 5. Spawn offset computation for N players
 *
 * All tests run in pure JS — no Colyseus, no Three.js.
 */

import { describe, it, expect } from 'vitest';
import { validateSettings, DEFAULT_GAME_SETTINGS } from '../shared/GameSettings';

// ---------------------------------------------------------------------------
// Mirror the helper functions from GameRoom.ts for testing
// ---------------------------------------------------------------------------

function getMaxEnemiesForPlayerCount(playerCount: number): number {
  return Math.min(30 + (playerCount - 1) * 20, 150);
}

const PLAYER_COLORS_BASE = [
  0x00ffff, 0xff00ff, 0x00ff00, 0xffff00, 0xff6600,
  0xff0066, 0x6600ff, 0x00ccff, 0x99ff00, 0xff99cc,
];

function getPlayerColor(index: number): number {
  if (index < PLAYER_COLORS_BASE.length) return PLAYER_COLORS_BASE[index];
  const hue = (index * 137.508) % 360;
  const h = hue / 360;
  const s = 0.8;
  const l = 0.6;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const r = Math.round(hue2rgb(h + 1/3) * 255);
  const g = Math.round(hue2rgb(h) * 255);
  const b = Math.round(hue2rgb(h - 1/3) * 255);
  return (r << 16) | (g << 8) | b;
}

function computeSpawnOffsets(count: number): Array<{ u: number; v: number }> {
  if (count <= 0) return [];
  const offsets: Array<{ u: number; v: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    const radius = 0.12;
    offsets.push({
      u: Math.round((0.5 + radius * Math.cos(angle)) * 1000) / 1000,
      v: Math.round((0.5 + radius * Math.sin(angle)) * 1000) / 1000,
    });
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Player cap — s44r6-19 regression', () => {
  describe('GameSettings.maxPlayers', () => {
    it('DEFAULT_GAME_SETTINGS has maxPlayers = 10', () => {
      expect(DEFAULT_GAME_SETTINGS.maxPlayers).toBe(10);
    });

    it('validateSettings accepts maxPlayers in range 2-20', () => {
      expect(validateSettings({ maxPlayers: 2 }).maxPlayers).toBe(2);
      expect(validateSettings({ maxPlayers: 10 }).maxPlayers).toBe(10);
      expect(validateSettings({ maxPlayers: 20 }).maxPlayers).toBe(20);
    });

    it('validateSettings clamps maxPlayers below 2 to 2', () => {
      expect(validateSettings({ maxPlayers: 1 }).maxPlayers).toBe(2);
      expect(validateSettings({ maxPlayers: 0 }).maxPlayers).toBe(2);
      expect(validateSettings({ maxPlayers: -5 }).maxPlayers).toBe(2);
    });

    it('validateSettings clamps maxPlayers above 20 to 20', () => {
      expect(validateSettings({ maxPlayers: 21 }).maxPlayers).toBe(20);
      expect(validateSettings({ maxPlayers: 100 }).maxPlayers).toBe(20);
    });

    it('validateSettings rounds fractional maxPlayers', () => {
      expect(validateSettings({ maxPlayers: 5.7 }).maxPlayers).toBe(6);
      expect(validateSettings({ maxPlayers: 3.2 }).maxPlayers).toBe(3);
    });

    it('validateSettings falls back to default when maxPlayers is not a number', () => {
      expect(validateSettings({ maxPlayers: NaN }).maxPlayers).toBe(DEFAULT_GAME_SETTINGS.maxPlayers);
      expect(validateSettings({ maxPlayers: Infinity }).maxPlayers).toBe(DEFAULT_GAME_SETTINGS.maxPlayers);
      expect(validateSettings({ maxPlayers: undefined }).maxPlayers).toBe(DEFAULT_GAME_SETTINGS.maxPlayers);
    });
  });

  describe('getMaxEnemiesForPlayerCount', () => {
    it('1 player → 30 enemies (base)', () => {
      expect(getMaxEnemiesForPlayerCount(1)).toBe(30);
    });

    it('2 players → 50 enemies', () => {
      expect(getMaxEnemiesForPlayerCount(2)).toBe(50);
    });

    it('3 players → 70 enemies', () => {
      expect(getMaxEnemiesForPlayerCount(3)).toBe(70);
    });

    it('4 players → 90 enemies (original cap)', () => {
      expect(getMaxEnemiesForPlayerCount(4)).toBe(90);
    });

    it('5 players → 110 enemies (beyond old cap)', () => {
      expect(getMaxEnemiesForPlayerCount(5)).toBe(110);
    });

    it('8 players → 170 → capped at 150', () => {
      // 30 + 7*20 = 170, capped at 150
      expect(getMaxEnemiesForPlayerCount(8)).toBe(150);
    });

    it('10 players → capped at 150', () => {
      expect(getMaxEnemiesForPlayerCount(10)).toBe(150);
    });

    it('20 players → capped at 150', () => {
      expect(getMaxEnemiesForPlayerCount(20)).toBe(150);
    });
  });

  describe('getPlayerColor', () => {
    it('players 0-3 return legacy colors (no regression)', () => {
      expect(getPlayerColor(0)).toBe(0x00ffff);
      expect(getPlayerColor(1)).toBe(0xff00ff);
      expect(getPlayerColor(2)).toBe(0x00ff00);
      expect(getPlayerColor(3)).toBe(0xffff00);
    });

    it('players 0-9 all return distinct colors', () => {
      const colors = Array.from({ length: 10 }, (_, i) => getPlayerColor(i));
      const unique = new Set(colors);
      expect(unique.size).toBe(10);
    });

    it('players 10-19 return valid hex colors (not crashing)', () => {
      for (let i = 10; i < 20; i++) {
        const color = getPlayerColor(i);
        expect(typeof color).toBe('number');
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
    });

    it('players 0-19 all have distinct colors', () => {
      const colors = Array.from({ length: 20 }, (_, i) => getPlayerColor(i));
      const unique = new Set(colors);
      // All 20 should be distinct
      expect(unique.size).toBe(20);
    });
  });

  describe('computeSpawnOffsets', () => {
    it('returns correct count for any N', () => {
      expect(computeSpawnOffsets(1)).toHaveLength(1);
      expect(computeSpawnOffsets(4)).toHaveLength(4);
      expect(computeSpawnOffsets(10)).toHaveLength(10);
      expect(computeSpawnOffsets(20)).toHaveLength(20);
    });

    it('returns empty array for 0', () => {
      expect(computeSpawnOffsets(0)).toHaveLength(0);
    });

    it('all positions are in [0.3, 0.7] UV range (near centre)', () => {
      const offsets = computeSpawnOffsets(10);
      for (const { u, v } of offsets) {
        expect(u).toBeGreaterThanOrEqual(0.3);
        expect(u).toBeLessThanOrEqual(0.7);
        expect(v).toBeGreaterThanOrEqual(0.3);
        expect(v).toBeLessThanOrEqual(0.7);
      }
    });

    it('all positions are distinct for 10 players', () => {
      const offsets = computeSpawnOffsets(10);
      const keys = offsets.map(o => `${o.u},${o.v}`);
      const unique = new Set(keys);
      expect(unique.size).toBe(10);
    });
  });
});
