import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BloomEffectManager } from './BloomEffectManager';
import type { Game } from '../core/Game';

describe('BloomEffectManager', () => {
  let mockGame: Game;
  let manager: BloomEffectManager;

  beforeEach(() => {
    // Mock Game instance with setBloomSettings method
    mockGame = {
      setBloomSettings: vi.fn(),
    } as any;

    manager = new BloomEffectManager(mockGame, 1.0, 0.3);
  });

  it('should initialize with zero active pulses', () => {
    expect(manager.getActivePulseCount()).toBe(0);
  });

  it('should trigger a boss pulse and increase active count', () => {
    const triggered = manager.triggerBossPulse();
    expect(triggered).toBe(true);
    expect(manager.getActivePulseCount()).toBe(1);
  });

  it('should scale bloom strength for single boss death', () => {
    manager.triggerBossPulse();
    manager.update(0.016); // ~1 frame at 60 FPS

    // Should set bloom to ~1.5x default (scaled by fade)
    expect(mockGame.setBloomSettings).toHaveBeenCalled();
    const calls = (mockGame.setBloomSettings as any).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBeGreaterThan(1.0); // Bloom strength boosted
  });

  it('should scale down bloom strength for multiple simultaneous pulses', () => {
    // Trigger 3 pulses
    manager.triggerBossPulse();
    manager.triggerBossPulse();
    manager.triggerBossPulse();

    manager.update(0.016);

    expect(manager.getActivePulseCount()).toBe(3);
    expect(mockGame.setBloomSettings).toHaveBeenCalled();
    // With 3 pulses, intensity should be scaled down from single-pulse value
  });

  it('should not trigger pulse if too many active (performance limit)', () => {
    // Trigger 5 pulses (the max)
    for (let i = 0; i < 5; i++) {
      const triggered = manager.triggerBossPulse();
      expect(triggered).toBe(true);
    }

    // 6th pulse should be rejected
    const triggered = manager.triggerBossPulse();
    expect(triggered).toBe(false);
    expect(manager.getActivePulseCount()).toBe(5);
  });

  it('should fade out pulses over time', () => {
    manager.triggerBossPulse();
    expect(manager.getActivePulseCount()).toBe(1);

    // Pulse duration is 0.4s, so 0.5s should clear it
    manager.update(0.5);
    expect(manager.getActivePulseCount()).toBe(0);
  });

  it('should restore default bloom when all pulses fade out', () => {
    manager.triggerBossPulse();
    manager.update(0.016);

    // Clear all pulses
    manager.update(0.5);

    expect(manager.getActivePulseCount()).toBe(0);
    expect(mockGame.setBloomSettings).toHaveBeenLastCalledWith(1.0, 0.3);
  });

  it('should reset all pulses immediately', () => {
    manager.triggerBossPulse();
    manager.triggerBossPulse();
    manager.update(0.016);

    expect(manager.getActivePulseCount()).toBe(2);

    manager.reset();

    expect(manager.getActivePulseCount()).toBe(0);
    expect(mockGame.setBloomSettings).toHaveBeenLastCalledWith(1.0, 0.3);
  });

  it('should handle multiple pulses at different lifecycle stages', () => {
    // Pulse 1 at t=0
    manager.triggerBossPulse();
    manager.update(0.2); // Half-faded

    // Pulse 2 at t=0.2
    manager.triggerBossPulse();
    manager.update(0.1); // Pulse 1 mostly faded, pulse 2 fresh

    expect(manager.getActivePulseCount()).toBe(2);

    // Another 0.2s — pulse 1 should expire (0.5s total), pulse 2 still alive
    manager.update(0.2);
    expect(manager.getActivePulseCount()).toBe(1);
  });

  it('should call setBloomSettings on every update when pulses are active', () => {
    manager.triggerBossPulse();

    const initialCalls = (mockGame.setBloomSettings as any).mock.calls.length;

    manager.update(0.016);
    manager.update(0.016);
    manager.update(0.016);

    const finalCalls = (mockGame.setBloomSettings as any).mock.calls.length;
    expect(finalCalls).toBeGreaterThan(initialCalls);
  });

  it('should not call setBloomSettings when no pulses are active', () => {
    const initialCalls = (mockGame.setBloomSettings as any).mock.calls.length;

    manager.update(0.016);
    manager.update(0.016);

    const finalCalls = (mockGame.setBloomSettings as any).mock.calls.length;
    expect(finalCalls).toBe(initialCalls); // No change
  });
});
