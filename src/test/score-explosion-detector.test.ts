/**
 * ScoreExplosionDetector — Unit Tests
 *
 * Verifies that the score explosion detector correctly identifies when a player
 * is steamrolling and triggers the difficulty surge bonus.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ScoreExplosionDetector } from '../core/DifficultyScaling';

// Helper: advance detector by N seconds in 5s increments with constant score
function advanceTime(
  det: ScoreExplosionDetector,
  fromTime: number,
  toTime: number,
  score: number,
): number {
  let bonus = 0;
  for (let t = fromTime; t <= toTime; t += 5) {
    bonus = det.update(score, t);
  }
  return bonus;
}

describe('ScoreExplosionDetector', () => {
  let detector: ScoreExplosionDetector;

  beforeEach(() => {
    // Default: 5x in 60s → +2.0 bonus for 45s
    detector = new ScoreExplosionDetector(60, 5, 2.0, 45);
  });

  it('returns 0 with no score history (no false positive at start)', () => {
    const bonus = detector.update(0, 0);
    expect(bonus).toBe(0);
    expect(detector.isInSurge()).toBe(false);
  });

  it('returns 0 when score barely doubled (below 5x threshold)', () => {
    // 10K → 20K (2x) over 60 seconds — should NOT trigger
    detector.update(10_000, 0);
    detector.update(12_000, 5);
    detector.update(15_000, 10);
    detector.update(18_000, 15);
    const bonus = detector.update(20_000, 20);
    expect(bonus).toBe(0);
    expect(detector.isInSurge()).toBe(false);
  });

  it('triggers surge when score grows >= 5x within 60 seconds', () => {
    // 10K at t=0, 60K (6x) at t=10 — within 60s window, above 5x threshold
    detector.update(10_000, 0);
    detector.update(10_000, 5);
    const bonus = detector.update(60_000, 10); // 60K >= 10K * 5 → surge!
    expect(bonus).toBeGreaterThan(0);
    expect(detector.isInSurge()).toBe(true);
  });

  it('surge bonus equals the configured surgeBonus value', () => {
    const custom = new ScoreExplosionDetector(60, 5, 1.5, 45);
    custom.update(10_000, 0);
    custom.update(10_000, 5);
    const bonus = custom.update(60_000, 10); // 6x → surge with bonus=1.5
    expect(bonus).toBe(1.5);
  });

  it('does NOT trigger on tiny starting score (ref score < 5000)', () => {
    // From 0 → 5000 is technically 5x but ref.score (0) is < 5000 threshold
    detector.update(0, 0);
    detector.update(100, 5);
    const bonus = detector.update(1_000, 10); // 10x from 100, but 100 < 5000
    expect(bonus).toBe(0);
  });

  it('does NOT trigger when score multiplier equals threshold (needs strict >=)', () => {
    // Exactly 5x: should trigger (threshold is >=)
    detector.update(10_000, 0);
    detector.update(10_000, 5);
    const bonus = detector.update(50_000, 10); // exactly 5x
    expect(bonus).toBeGreaterThan(0);
  });

  it('surge expires after surgeDuration when score does not sustain the explosion', () => {
    // Surge triggers at t=10 → expires at t=55 (10 + 45)
    detector.update(10_000, 0);
    detector.update(10_000, 5);
    detector.update(60_000, 10); // surge triggered, expire = 10 + 45 = 55

    // Score drops back — no re-trigger possible (10K < 60K*5)
    // Advance time: surge still active through t=54
    const bonusAt54 = detector.update(10_000, 54);
    expect(bonusAt54).toBeGreaterThan(0);

    // At t=56: expiry check fires (56 >= 55)
    const bonusAt56 = detector.update(10_000, 56);
    expect(bonusAt56).toBe(0);
    expect(detector.isInSurge()).toBe(false);
  });

  it('surge stays active as long as the explosion continues to re-trigger', () => {
    // Player keeps their score 6x above where they were 10s ago
    detector.update(10_000, 0);
    detector.update(10_000, 5);
    detector.update(60_000, 10); // surge triggered, expire=55

    // Each sample at 5s intervals with score 60K re-triggers (ref is 10K at t=0)
    // until t=65 when {0,10K} is pruned from the window
    const bonusAt50 = detector.update(60_000, 50); // surge re-triggered multiple times
    expect(bonusAt50).toBeGreaterThan(0);
  });

  it('reset() clears all state including active surge', () => {
    // Trigger surge
    detector.update(10_000, 0);
    detector.update(10_000, 5);
    detector.update(60_000, 10); // surge active
    expect(detector.isInSurge()).toBe(true);

    detector.reset();

    // After reset, no surge
    expect(detector.isInSurge()).toBe(false);
    const bonus = detector.update(60_000, 15);
    expect(bonus).toBe(0); // only 1 sample in window — can't detect explosion
  });

  it('uses configurable window and threshold', () => {
    // Short window (30s), low threshold (3x)
    const strict = new ScoreExplosionDetector(30, 3, 1.0, 20);
    strict.update(10_000, 0);
    strict.update(10_000, 5);
    const bonus = strict.update(35_000, 10); // 3.5x in 10s → surge
    expect(bonus).toBeGreaterThan(0);
  });
});
