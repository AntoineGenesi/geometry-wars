import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AdaptiveQuality,
  AdaptiveQualityConfig,
  QualityLevel,
  QUALITY_LEVELS,
  TrailDetail,
  EnemyDetail,
} from './AdaptiveQuality';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Feed N frames at a given FPS to the adaptive quality system.
 * @param aq The AdaptiveQuality instance.
 * @param fps Target FPS to simulate.
 * @param count Number of frames to feed.
 */
function feedFrames(aq: AdaptiveQuality, fps: number, count: number): void {
  const dt = 1 / fps;
  for (let i = 0; i < count; i++) {
    aq.update(dt);
  }
}

/**
 * Create an AdaptiveQuality with fast settings for testing:
 * small monitor window (10 frames) and low hysteresis (5 frames).
 */
function createTestAQ(overrides: AdaptiveQualityConfig = {}): AdaptiveQuality {
  return new AdaptiveQuality({
    monitorWindowSize: 10,
    hysteresisFrames: 5,
    cooldownSeconds: 0.5,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdaptiveQuality', () => {
  // -----------------------------------------------------------------------
  // Construction and defaults
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('starts at ULTRA by default', () => {
      const aq = new AdaptiveQuality();
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);
    });

    it('respects custom initial level', () => {
      const aq = new AdaptiveQuality({ initialLevel: QualityLevel.MEDIUM });
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);
    });

    it('starts enabled by default', () => {
      const aq = new AdaptiveQuality();
      expect(aq.enabled).toBe(true);
    });

    it('is not in manual override by default', () => {
      const aq = new AdaptiveQuality();
      expect(aq.isManualOverride).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Quality settings retrieval
  // -----------------------------------------------------------------------

  describe('getSettings', () => {
    it('returns ULTRA settings by default', () => {
      const aq = new AdaptiveQuality();
      const settings = aq.getSettings();
      expect(settings.particleCount).toBe(5000);
      expect(settings.bloomResolutionScale).toBe(1.0);
      expect(settings.bloomEnabled).toBe(true);
      expect(settings.trailDetail).toBe(TrailDetail.FULL);
      expect(settings.enemyDetail).toBe(EnemyDetail.FULL);
      expect(settings.maxVisibleEnemies).toBe(0); // no limit
      expect(settings.shadowsEnabled).toBe(true);
      expect(settings.postProcessingEnabled).toBe(true);
    });

    it('returns a copy (no mutation leaks)', () => {
      const aq = new AdaptiveQuality();
      const a = aq.getSettings();
      const b = aq.getSettings();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('static getSettingsForLevel returns correct presets', () => {
      const low = AdaptiveQuality.getSettingsForLevel(QualityLevel.LOW);
      expect(low.particleCount).toBe(100);
      expect(low.bloomEnabled).toBe(false);
      expect(low.trailDetail).toBe(TrailDetail.DISABLED);
      expect(low.enemyDetail).toBe(EnemyDetail.BILLBOARD);
    });
  });

  // -----------------------------------------------------------------------
  // Quality level ordering and preset values
  // -----------------------------------------------------------------------

  describe('quality level presets', () => {
    it('QUALITY_LEVELS array is ordered from ULTRA to MINIMAL', () => {
      expect(QUALITY_LEVELS[0]).toBe(QualityLevel.ULTRA);
      expect(QUALITY_LEVELS[4]).toBe(QualityLevel.MINIMAL);
      expect(QUALITY_LEVELS.length).toBe(5);
    });

    it('particle count decreases with lower quality', () => {
      const particles = QUALITY_LEVELS.map(
        (lvl) => AdaptiveQuality.getSettingsForLevel(lvl).particleCount,
      );
      for (let i = 1; i < particles.length; i++) {
        expect(particles[i]).toBeLessThanOrEqual(particles[i - 1]);
      }
    });

    it('bloom resolution scale decreases with lower quality', () => {
      const scales = QUALITY_LEVELS.map(
        (lvl) => AdaptiveQuality.getSettingsForLevel(lvl).bloomResolutionScale,
      );
      for (let i = 1; i < scales.length; i++) {
        expect(scales[i]).toBeLessThanOrEqual(scales[i - 1]);
      }
    });

    it('HIGH level has 2000 particles, 0.5 bloom scale, 500 max enemies', () => {
      const s = AdaptiveQuality.getSettingsForLevel(QualityLevel.HIGH);
      expect(s.particleCount).toBe(2000);
      expect(s.bloomResolutionScale).toBe(0.5);
      expect(s.maxVisibleEnemies).toBe(500);
    });

    it('MEDIUM level has 500 particles, LOD enemies, simplified trails', () => {
      const s = AdaptiveQuality.getSettingsForLevel(QualityLevel.MEDIUM);
      expect(s.particleCount).toBe(500);
      expect(s.enemyDetail).toBe(EnemyDetail.LOD);
      expect(s.trailDetail).toBe(TrailDetail.SIMPLIFIED);
    });

    it('LOW level disables bloom and trails', () => {
      const s = AdaptiveQuality.getSettingsForLevel(QualityLevel.LOW);
      expect(s.bloomEnabled).toBe(false);
      expect(s.trailDetail).toBe(TrailDetail.DISABLED);
      expect(s.postProcessingEnabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // FPS monitoring and rolling average
  // -----------------------------------------------------------------------

  describe('FPS monitoring', () => {
    it('monitor tracks frames fed via update()', () => {
      const aq = createTestAQ();
      feedFrames(aq, 60, 5);
      expect(aq.monitor.filledFrames).toBe(5);
    });

    it('performance snapshot reflects fed frame rate', () => {
      const aq = createTestAQ();
      feedFrames(aq, 60, 10);
      const snap = aq.getPerformanceSnapshot();
      expect(snap.fps).toBeCloseTo(60, 0);
    });

    it('does not adjust quality before monitor is warmed up', () => {
      const aq = createTestAQ({ monitorWindowSize: 20, hysteresisFrames: 1 });
      // Feed 10 frames at 30fps (below threshold) but monitor needs 20
      feedFrames(aq, 30, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA); // unchanged
    });
  });

  // -----------------------------------------------------------------------
  // Quality transitions - stepping down
  // -----------------------------------------------------------------------

  describe('stepping down quality', () => {
    it('decreases quality after sustained low FPS', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      // Warm up the monitor at 60fps (10 frames for window)
      feedFrames(aq, 60, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // Now feed 30fps frames (well below 55fps threshold)
      // Need hysteresisFrames (5) frames below threshold
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });

    it('steps down multiple levels with continued low FPS', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      // Each batch of 5 low-FPS frames triggers a step down
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);

      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);

      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.LOW);

      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.MINIMAL);
    });

    it('does not step below MINIMAL', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.MINIMAL,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 60, 10); // warm up
      feedFrames(aq, 30, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.MINIMAL);
    });
  });

  // -----------------------------------------------------------------------
  // Quality transitions - stepping up
  // -----------------------------------------------------------------------

  describe('stepping up quality', () => {
    it('increases quality after sustained high FPS', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.LOW,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 60, 10); // warm up (60 > 58 threshold)
      feedFrames(aq, 60, 5);  // 5 frames above threshold
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);
    });

    it('does not step above ULTRA', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.ULTRA,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 120, 10); // warm up
      feedFrames(aq, 120, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);
    });

    it('steps up multiple levels with continued high FPS', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.MINIMAL,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 120, 10); // warm up

      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.LOW);

      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);

      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);

      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);
    });
  });

  // -----------------------------------------------------------------------
  // Hysteresis - prevents oscillation
  // -----------------------------------------------------------------------

  describe('hysteresis', () => {
    it('does not change quality before hysteresis threshold', () => {
      const aq = createTestAQ({ hysteresisFrames: 10, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      // Feed 9 frames below threshold (need 10)
      feedFrames(aq, 30, 9);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // 10th frame triggers the change
      feedFrames(aq, 30, 1);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });

    it('resets down-counter when FPS recovers', () => {
      // Use a large hysteresis so we can accumulate some low frames,
      // recover, and verify the counter resets. Window=5 so the rolling
      // average reflects recent frames quickly.
      const aq = createTestAQ({
        monitorWindowSize: 5,
        hysteresisFrames: 15,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 60, 5); // warm up (window filled at 60fps)

      // 8 frames below threshold. Window transitions to all-30fps after
      // 5 frames, so all 8 see avg < 55. Counter = 8.
      feedFrames(aq, 30, 8);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // Recover: flush window with dead-zone frames (57fps).
      // After 5 frames the window is all-57fps -> avg ~57 -> dead zone.
      // The first few 57fps frames still see avg < 55 (window has 30fps),
      // so counter keeps rising. After window flushes, dead zone resets it.
      feedFrames(aq, 57, 10);
      // Counter was reset when avg entered the 55-58 dead zone.
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // Now feed 14 frames below threshold (need 15 for hysteresis)
      feedFrames(aq, 30, 14);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // 15th frame triggers the change
      feedFrames(aq, 30, 1);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });

    it('resets up-counter when FPS drops', () => {
      // Mirror of the down-counter test but for upward transitions.
      // Window=5, hysteresis=15.
      const aq = createTestAQ({
        monitorWindowSize: 5,
        initialLevel: QualityLevel.LOW,
        hysteresisFrames: 15,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 120, 5); // warm up (window filled at 120fps)

      // 8 frames above threshold. Counter accumulates.
      feedFrames(aq, 120, 8);
      expect(aq.getQualityLevel()).toBe(QualityLevel.LOW);

      // Recover into dead zone: flush window with 57fps frames.
      // After 5 frames the window is all-57fps -> dead zone resets counter.
      // During transition, avg is still > 58 for the first few frames
      // (mixing 120fps and 57fps), so counter rises a bit more before reset.
      feedFrames(aq, 57, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.LOW);

      // Now feed 14 frames above threshold (need 15)
      feedFrames(aq, 120, 14);
      expect(aq.getQualityLevel()).toBe(QualityLevel.LOW);

      // 15th frame triggers
      feedFrames(aq, 120, 1);
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);
    });

    it('FPS in the dead zone (55-58) prevents both up and down', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      // Feed many frames at exactly 56fps (in the dead zone)
      feedFrames(aq, 56, 50);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA); // unchanged
    });
  });

  // -----------------------------------------------------------------------
  // Cooldown enforcement
  // -----------------------------------------------------------------------

  describe('cooldown', () => {
    it('blocks quality change during cooldown period', () => {
      const aq = createTestAQ({
        hysteresisFrames: 5,
        cooldownSeconds: 2.0,
      });
      feedFrames(aq, 60, 10); // warm up

      // Trigger first step down (cooldown starts from constructor elapsed)
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);

      // Immediately feed more low-FPS frames -- should be blocked by cooldown
      // At 30fps, dt=1/30=0.033s, 5 frames = 0.167s < 2.0s cooldown
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH); // still HIGH
    });

    it('allows quality change after cooldown expires', () => {
      const aq = createTestAQ({
        hysteresisFrames: 5,
        cooldownSeconds: 0.1,
      });
      feedFrames(aq, 60, 10); // warm up

      // Trigger first step down
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);

      // At 30fps, each frame is 33ms. Need 100ms cooldown.
      // Feed 4 frames = 133ms > 100ms cooldown, plus 5 more for hysteresis
      feedFrames(aq, 30, 4); // pass cooldown
      feedFrames(aq, 30, 5); // hysteresis
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);
    });

    it('cooldown resets after each quality change', () => {
      const aq = createTestAQ({
        hysteresisFrames: 1,
        cooldownSeconds: 1.0,
      });
      feedFrames(aq, 60, 10); // warm up

      // First step down
      feedFrames(aq, 30, 1);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);

      // Try immediate second step (blocked by cooldown)
      feedFrames(aq, 30, 1);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });
  });

  // -----------------------------------------------------------------------
  // Enable / disable
  // -----------------------------------------------------------------------

  describe('setEnabled', () => {
    it('disabling prevents quality changes', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      aq.setEnabled(false);
      feedFrames(aq, 30, 20);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA); // unchanged
    });

    it('re-enabling allows changes again', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      aq.setEnabled(false);
      feedFrames(aq, 30, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      aq.setEnabled(true);
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });
  });

  // -----------------------------------------------------------------------
  // Manual override
  // -----------------------------------------------------------------------

  describe('forceQuality', () => {
    it('sets quality to the specified level', () => {
      const aq = new AdaptiveQuality();
      aq.forceQuality(QualityLevel.LOW);
      expect(aq.getQualityLevel()).toBe(QualityLevel.LOW);
    });

    it('disables automatic adjustment', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      aq.forceQuality(QualityLevel.ULTRA);
      expect(aq.enabled).toBe(false);
      expect(aq.isManualOverride).toBe(true);

      // Low FPS should not change quality
      feedFrames(aq, 30, 20);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);
    });

    it('fires onQualityChange callback', () => {
      const aq = new AdaptiveQuality();
      const cb = vi.fn();
      aq.onQualityChange = cb;

      aq.forceQuality(QualityLevel.MEDIUM);
      expect(cb).toHaveBeenCalledWith(QualityLevel.ULTRA, QualityLevel.MEDIUM);
    });

    it('does not fire callback when forcing same level', () => {
      const aq = new AdaptiveQuality();
      const cb = vi.fn();
      aq.onQualityChange = cb;

      aq.forceQuality(QualityLevel.ULTRA); // same as current
      expect(cb).not.toHaveBeenCalled();
    });

    it('getSettings returns forced level settings', () => {
      const aq = new AdaptiveQuality();
      aq.forceQuality(QualityLevel.LOW);
      const s = aq.getSettings();
      expect(s.particleCount).toBe(100);
      expect(s.bloomEnabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // clearOverride
  // -----------------------------------------------------------------------

  describe('clearOverride', () => {
    it('re-enables automatic adjustment', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up

      aq.forceQuality(QualityLevel.ULTRA);
      expect(aq.enabled).toBe(false);

      aq.clearOverride();
      expect(aq.enabled).toBe(true);
      expect(aq.isManualOverride).toBe(false);

      // Now low FPS should trigger adjustment
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });
  });

  // -----------------------------------------------------------------------
  // onQualityChange callback
  // -----------------------------------------------------------------------

  describe('onQualityChange callback', () => {
    it('fires when quality steps down', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      const cb = vi.fn();
      aq.onQualityChange = cb;

      feedFrames(aq, 60, 10); // warm up
      feedFrames(aq, 30, 5);  // trigger step down

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(QualityLevel.ULTRA, QualityLevel.HIGH);
    });

    it('fires when quality steps up', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.LOW,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });
      const cb = vi.fn();
      aq.onQualityChange = cb;

      feedFrames(aq, 120, 10); // warm up
      feedFrames(aq, 120, 5);  // trigger step up

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(QualityLevel.LOW, QualityLevel.MEDIUM);
    });

    it('fires for each successive quality change', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      const cb = vi.fn();
      aq.onQualityChange = cb;

      feedFrames(aq, 60, 10); // warm up
      feedFrames(aq, 30, 5);  // ULTRA -> HIGH
      feedFrames(aq, 30, 5);  // HIGH -> MEDIUM

      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenNthCalledWith(1, QualityLevel.ULTRA, QualityLevel.HIGH);
      expect(cb).toHaveBeenNthCalledWith(2, QualityLevel.HIGH, QualityLevel.MEDIUM);
    });

    it('does not fire when quality stays the same', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      const cb = vi.fn();
      aq.onQualityChange = cb;

      // Feed frames in the dead zone
      feedFrames(aq, 56, 50);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Knob adjustment order
  // -----------------------------------------------------------------------

  describe('knob adjustment order', () => {
    it('particles decrease before bloom is disabled', () => {
      // ULTRA: particles=5000, bloom=true
      // HIGH: particles=2000, bloom=true (particles reduced first)
      const ultra = AdaptiveQuality.getSettingsForLevel(QualityLevel.ULTRA);
      const high = AdaptiveQuality.getSettingsForLevel(QualityLevel.HIGH);

      expect(high.particleCount).toBeLessThan(ultra.particleCount);
      expect(high.bloomEnabled).toBe(true); // bloom still on
    });

    it('bloom resolution reduces before bloom is disabled', () => {
      const high = AdaptiveQuality.getSettingsForLevel(QualityLevel.HIGH);
      const medium = AdaptiveQuality.getSettingsForLevel(QualityLevel.MEDIUM);

      expect(medium.bloomResolutionScale).toBeLessThan(high.bloomResolutionScale);
      expect(medium.bloomEnabled).toBe(true); // still on, just lower res
    });

    it('trails simplify before being disabled', () => {
      const medium = AdaptiveQuality.getSettingsForLevel(QualityLevel.MEDIUM);
      const low = AdaptiveQuality.getSettingsForLevel(QualityLevel.LOW);

      expect(medium.trailDetail).toBe(TrailDetail.SIMPLIFIED);
      expect(low.trailDetail).toBe(TrailDetail.DISABLED);
    });

    it('enemy detail reduces before max enemies are capped low', () => {
      const high = AdaptiveQuality.getSettingsForLevel(QualityLevel.HIGH);
      const medium = AdaptiveQuality.getSettingsForLevel(QualityLevel.MEDIUM);

      expect(high.enemyDetail).toBe(EnemyDetail.FULL);
      expect(medium.enemyDetail).toBe(EnemyDetail.LOD);
      expect(medium.maxVisibleEnemies).toBeLessThan(high.maxVisibleEnemies);
    });

    it('post-processing disabled at LOW', () => {
      const medium = AdaptiveQuality.getSettingsForLevel(QualityLevel.MEDIUM);
      const low = AdaptiveQuality.getSettingsForLevel(QualityLevel.LOW);

      expect(medium.postProcessingEnabled).toBe(true);
      expect(low.postProcessingEnabled).toBe(false);
    });

    it('shadows disabled at MEDIUM', () => {
      const high = AdaptiveQuality.getSettingsForLevel(QualityLevel.HIGH);
      const medium = AdaptiveQuality.getSettingsForLevel(QualityLevel.MEDIUM);

      expect(high.shadowsEnabled).toBe(true);
      expect(medium.shadowsEnabled).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  describe('reset', () => {
    it('clears monitor and hysteresis but preserves quality level', () => {
      const aq = createTestAQ({ hysteresisFrames: 5, cooldownSeconds: 0 });
      feedFrames(aq, 60, 10); // warm up
      feedFrames(aq, 30, 5);  // step down to HIGH
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);

      aq.reset();
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH); // preserved
      expect(aq.monitor.filledFrames).toBe(0); // monitor cleared
    });

    it('requires re-warming the monitor after reset', () => {
      const aq = createTestAQ({
        monitorWindowSize: 10,
        hysteresisFrames: 1,
        cooldownSeconds: 0,
      });
      feedFrames(aq, 60, 10); // warm up
      aq.reset();

      // Feed low FPS but not enough to warm up monitor
      feedFrames(aq, 30, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA); // no change yet
    });
  });

  // -----------------------------------------------------------------------
  // Integration scenario
  // -----------------------------------------------------------------------

  describe('integration scenario', () => {
    it('handles realistic FPS fluctuation without oscillating', () => {
      const aq = createTestAQ({
        hysteresisFrames: 10,
        cooldownSeconds: 0.5,
      });

      // Start at steady 60fps
      feedFrames(aq, 60, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // Brief dip to 50fps (3 frames) -- should NOT trigger change
      feedFrames(aq, 50, 3);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // Recovery to 60fps
      feedFrames(aq, 60, 10);
      expect(aq.getQualityLevel()).toBe(QualityLevel.ULTRA);

      // Sustained drop to 40fps (well past hysteresis)
      feedFrames(aq, 40, 15);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });

    it('recovers quality when performance improves', () => {
      const aq = createTestAQ({
        initialLevel: QualityLevel.LOW,
        hysteresisFrames: 5,
        cooldownSeconds: 0,
      });

      // Steady high FPS
      feedFrames(aq, 120, 10); // warm up
      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.MEDIUM);

      feedFrames(aq, 120, 5);
      expect(aq.getQualityLevel()).toBe(QualityLevel.HIGH);
    });
  });

  // -----------------------------------------------------------------------
  // Performance snapshot access
  // -----------------------------------------------------------------------

  describe('getPerformanceSnapshot', () => {
    it('returns current snapshot without recording a frame', () => {
      const aq = createTestAQ();
      feedFrames(aq, 60, 10);

      const filledBefore = aq.monitor.filledFrames;
      const snap = aq.getPerformanceSnapshot();
      const filledAfter = aq.monitor.filledFrames;

      expect(filledBefore).toBe(filledAfter); // no new frame recorded
      expect(snap.fps).toBeCloseTo(60, 0);
    });
  });
});
