/**
 * Tests for InputManager.blockInput()
 * Regression test for s44r22-03: player must not have control during death/game-over screens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InputManager } from './InputManager';

// Mock window event listener infrastructure for jsdom
const listeners: Record<string, ((e: Event) => void)[]> = {};
const originalAddEventListener = window.addEventListener.bind(window);
const originalRemoveEventListener = window.removeEventListener.bind(window);

describe('InputManager.blockInput()', () => {
  let input: InputManager;

  beforeEach(() => {
    // InputManager constructor registers listeners on window; jsdom supports this
    input = new InputManager();
  });

  afterEach(() => {
    input.dispose();
  });

  it('clears all movement input when blockInput() is called', () => {
    // Simulate WASD keys held down by dispatching keydown events
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));

    // Input should be non-zero before blocking
    const stateBefore = input.getState();
    expect(stateBefore.moveX).toBeLessThan(0); // 'a' = left
    expect(stateBefore.moveY).toBeLessThan(0); // 'w' = up (negative)

    // Block input
    input.blockInput();

    // Input should be zeroed after blocking
    const stateAfter = input.getState();
    expect(stateAfter.moveX).toBe(0);
    expect(stateAfter.moveY).toBe(0);
    expect(stateAfter.shooting).toBe(false);
    expect(stateAfter.bomb).toBe(false);
    expect(stateAfter.boost).toBe(false);
    expect(stateAfter.weaponSwap).toBe(false);
  });

  it('clears mouse shooting state when blockInput() is called', () => {
    // Simulate mouse left button held
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));

    const stateBefore = input.getState();
    expect(stateBefore.shooting).toBe(true);

    input.blockInput();

    const stateAfter = input.getState();
    expect(stateAfter.shooting).toBe(false);
  });

  it('clears boost (shift) when blockInput() is called', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'shift' }));

    const stateBefore = input.getState();
    expect(stateBefore.boost).toBe(true);

    input.blockInput();

    const stateAfter = input.getState();
    expect(stateBefore.boost).toBe(true); // was true before
    expect(stateAfter.boost).toBe(false); // zeroed after
  });

  it('allows input again after blockInput() if keys are re-pressed', () => {
    // Block input first
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    input.blockInput();
    expect(input.getState().moveX).toBe(0);

    // Press key again — should work normally
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(input.getState().moveX).toBeGreaterThan(0);
  });

  it('blockInput() is idempotent — calling twice is safe', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    input.blockInput();
    input.blockInput(); // Should not throw
    expect(input.getState().moveY).toBe(0);
  });
});
