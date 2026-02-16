import type { Game } from '../core/Game';

/**
 * BloomEffectManager
 *
 * Manages dynamic bloom intensity pulses for boss explosions.
 * Scales bloom intensity based on number of simultaneous boss deaths
 * to maintain performance while preserving dramatic visual impact.
 *
 * Performance characteristics:
 * - 1 boss death: full bloom intensity (1.5x default)
 * - 2-3 simultaneous: reduced intensity (1.2x default)
 * - 4-5 simultaneous: minimal intensity (0.9x default)
 * - 6+ simultaneous: no bloom burst (particles only)
 *
 * Design rationale:
 * - Bloom post-processing is expensive (entire screen pass)
 * - Multiple simultaneous bloom bursts compound the cost
 * - Scaling intensity maintains visual feedback while preserving FPS
 * - Regular enemies never trigger bloom (particles only)
 */

interface BloomPulse {
  /** Unique ID for this pulse */
  id: number;
  /** Time remaining (seconds) */
  remaining: number;
  /** Target intensity for this pulse */
  targetIntensity: number;
}

export class BloomEffectManager {
  private game: Game;
  private activePulses: BloomPulse[] = [];
  private nextPulseId = 0;

  // Default bloom settings (restored when no pulses active)
  private readonly defaultStrength: number;
  private readonly defaultThreshold: number;

  // Pulse configuration
  private readonly pulseDuration = 0.4; // seconds
  private readonly baseBoostStrength = 1.5; // 1.5x default for single boss
  private readonly maxSimultaneousPulses = 5; // beyond this, no bloom boost

  constructor(game: Game, defaultStrength: number = 1.0, defaultThreshold: number = 0.3) {
    this.game = game;
    this.defaultStrength = defaultStrength;
    this.defaultThreshold = defaultThreshold;
  }

  /**
   * Trigger a bloom pulse for a boss explosion.
   * Intensity is automatically scaled based on number of active pulses.
   *
   * @returns true if pulse was triggered, false if too many pulses active
   */
  triggerBossPulse(): boolean {
    // If too many simultaneous pulses, skip this one for performance
    if (this.activePulses.length >= this.maxSimultaneousPulses) {
      return false;
    }

    // Calculate scaled intensity based on current pulse count
    // More pulses = lower intensity per pulse
    const scaleFactor = this.calculateScaleFactor(this.activePulses.length + 1);
    const targetIntensity = this.defaultStrength * scaleFactor;

    const pulse: BloomPulse = {
      id: this.nextPulseId++,
      remaining: this.pulseDuration,
      targetIntensity,
    };

    this.activePulses.push(pulse);
    this.updateBloomSettings();
    return true;
  }

  /**
   * Update active pulses and bloom settings.
   * Call this every frame from the game loop.
   */
  update(dt: number): void {
    if (this.activePulses.length === 0) return;

    // Update pulse timers
    for (let i = this.activePulses.length - 1; i >= 0; i--) {
      this.activePulses[i].remaining -= dt;
      if (this.activePulses[i].remaining <= 0) {
        this.activePulses.splice(i, 1);
      }
    }

    // Update bloom settings based on active pulses
    this.updateBloomSettings();
  }

  /**
   * Calculate the bloom intensity scale factor based on number of active pulses.
   * More pulses = lower intensity per pulse to maintain performance.
   */
  private calculateScaleFactor(pulseCount: number): number {
    if (pulseCount <= 0) return 1.0;
    if (pulseCount === 1) return this.baseBoostStrength; // 1.5x for single boss
    if (pulseCount === 2) return 1.3; // Slightly reduced
    if (pulseCount === 3) return 1.2; // More reduced
    if (pulseCount === 4) return 1.0; // Default strength
    if (pulseCount === 5) return 0.9; // Below default
    return 0.8; // Minimal (shouldn't reach here due to max check)
  }

  /**
   * Apply bloom settings based on currently active pulses.
   * If no pulses active, restore default settings.
   */
  private updateBloomSettings(): void {
    if (this.activePulses.length === 0) {
      // No active pulses — restore default bloom
      this.game.setBloomSettings(this.defaultStrength, this.defaultThreshold);
      return;
    }

    // Calculate average intensity across all active pulses
    // Use max instead of sum to avoid bloom becoming too strong
    let maxIntensity = this.defaultStrength;
    for (const pulse of this.activePulses) {
      // Fade out intensity as pulse nears completion
      const fadeProgress = pulse.remaining / this.pulseDuration;
      const fadedIntensity = pulse.targetIntensity * fadeProgress;
      maxIntensity = Math.max(maxIntensity, fadedIntensity);
    }

    this.game.setBloomSettings(maxIntensity, this.defaultThreshold);
  }

  /**
   * Get current number of active bloom pulses.
   * Useful for debugging and performance monitoring.
   */
  getActivePulseCount(): number {
    return this.activePulses.length;
  }

  /**
   * Force clear all active pulses and restore default bloom.
   * Useful for scene transitions or resets.
   */
  reset(): void {
    this.activePulses.length = 0;
    this.game.setBloomSettings(this.defaultStrength, this.defaultThreshold);
  }
}
