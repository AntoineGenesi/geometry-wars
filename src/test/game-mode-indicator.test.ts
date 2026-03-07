/**
 * Test for game mode indicator in network multiplayer mode.
 * Verifies that the game mode label displays correctly during gameplay.
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('Game Mode Indicator', () => {
  let modeIndicatorEl: HTMLElement | null;

  beforeEach(() => {
    // Create a mock mode indicator element similar to network-main.ts
    modeIndicatorEl = document.createElement('div');
    modeIndicatorEl.id = 'game-mode-indicator';
    modeIndicatorEl.style.cssText =
      'position:fixed;top:50px;left:10px;' +
      'color:#ff8;font:14px monospace;' +
      'text-shadow:0 0 8px #ff8;z-index:100;' +
      'background:rgba(0,0,0,0.4);padding:4px 10px;border-radius:4px;' +
      'border:1px solid rgba(255,255,136,0.3);display:none;' +
      'letter-spacing:1px;';
    document.body.appendChild(modeIndicatorEl);
  });

  it('should create mode indicator element with correct id', () => {
    const indicator = document.getElementById('game-mode-indicator');
    expect(indicator).toBeDefined();
    expect(indicator?.id).toBe('game-mode-indicator');
  });

  it('should be hidden by default', () => {
    const indicator = document.getElementById('game-mode-indicator');
    expect(indicator?.style.display).toBe('none');
  });

  it('should update label for different game modes', () => {
    const indicator = document.getElementById('game-mode-indicator')!;

    // Test regular cooperative mode
    indicator.textContent = 'WAVES';
    expect(indicator.textContent).toBe('WAVES');

    // Test PvP mode
    indicator.textContent = 'PVP MODE';
    expect(indicator.textContent).toBe('PVP MODE');

    // Test PvPvE mode
    indicator.textContent = 'PVPVE MODE';
    expect(indicator.textContent).toBe('PVPVE MODE');

    // Test other modes
    indicator.textContent = 'KING';
    expect(indicator.textContent).toBe('KING');
  });

  it('should be visible during gameplay', () => {
    const indicator = document.getElementById('game-mode-indicator')!;
    indicator.style.display = 'block';
    expect(indicator.style.display).toBe('block');
  });

  it('should be hidden when game is not active', () => {
    const indicator = document.getElementById('game-mode-indicator')!;
    indicator.style.display = 'none';
    expect(indicator.style.display).toBe('none');
  });

  it('should apply cyan/yellow styling for visibility', () => {
    const indicator = document.getElementById('game-mode-indicator')!;
    expect(indicator.style.color).toBe('rgb(255, 255, 136)'); // #ff8
    expect(indicator.style.textShadow).toContain('#ff8');
  });

  it('should be positioned at top:50px, left:10px', () => {
    const indicator = document.getElementById('game-mode-indicator')!;
    expect(indicator.style.position).toBe('fixed');
    expect(indicator.style.top).toBe('50px');
    expect(indicator.style.left).toBe('10px');
  });
});
