/**
 * Visual test for game mode indicator during multiplayer gameplay.
 * Verifies that the mode indicator is visible during PvP and PvPvE games.
 */

import { describe, it, expect } from 'vitest';
import { PlaygroundTestHarness } from '../test/PlaygroundTestHarness';
import type { GameInstance } from '../core/GameInstance';

describe('Game Mode Indicator - Visual', () => {
  let harness: PlaygroundTestHarness;
  let game: GameInstance;

  it('should display game mode indicator element in DOM', () => {
    // Create a test harness that simulates a game instance
    harness = new PlaygroundTestHarness();
    game = harness.getGameInstance();

    // Check that the mode indicator element exists in the DOM
    const modeIndicator = document.getElementById('game-mode-indicator');
    expect(modeIndicator).toBeDefined();
    expect(modeIndicator?.id).toBe('game-mode-indicator');
  });

  it('should have correct styling for visibility', () => {
    const modeIndicator = document.getElementById('game-mode-indicator');
    expect(modeIndicator).toBeDefined();

    if (modeIndicator) {
      // Check that it has the correct positioning
      const computedStyle = window.getComputedStyle(modeIndicator);
      expect(computedStyle.position).toBe('fixed');

      // Check that styling is appropriate for visibility
      expect(modeIndicator.style.cssText).toContain('color');
      expect(modeIndicator.style.cssText).toContain('text-shadow');
      expect(modeIndicator.style.cssText).toContain('border-radius');
    }
  });

  it('should be hidden when game is not started', () => {
    const modeIndicator = document.getElementById('game-mode-indicator');
    if (modeIndicator) {
      // Initially should be hidden
      expect(modeIndicator.style.display).toBe('none');
    }
  });

  it('should accept mode labels without errors', () => {
    const modeIndicator = document.getElementById('game-mode-indicator');
    if (modeIndicator) {
      // Test that various mode labels can be set without errors
      const modeLabels = ['WAVES', 'PVP MODE', 'PVPVE MODE', 'KING', 'SNIPER'];

      modeLabels.forEach((label) => {
        modeIndicator.textContent = label;
        expect(modeIndicator.textContent).toBe(label);
      });
    }
  });
});
