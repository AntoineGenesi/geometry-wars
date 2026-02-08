import { describe, it, expect } from 'vitest';
import { PerformanceMonitor } from './PerformanceMonitor';

describe('PerformanceMonitor', () => {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates with default window size of 60', () => {
      const mon = new PerformanceMonitor();
      expect(mon.filledFrames).toBe(0);
      expect(mon.isWarmedUp).toBe(false);
    });

    it('creates with custom window size', () => {
      const mon = new PerformanceMonitor(10);
      // Fill 10 frames
      for (let i = 0; i < 10; i++) {
        mon.recordFrame(1 / 60);
      }
      expect(mon.isWarmedUp).toBe(true);
    });

    it('clamps window size to at least 1', () => {
      const mon = new PerformanceMonitor(0);
      mon.recordFrame(1 / 60);
      expect(mon.isWarmedUp).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Frame recording
  // -----------------------------------------------------------------------

  describe('recordFrame', () => {
    it('increments filled frames', () => {
      const mon = new PerformanceMonitor(10);
      mon.recordFrame(0.016);
      expect(mon.filledFrames).toBe(1);
      mon.recordFrame(0.016);
      expect(mon.filledFrames).toBe(2);
    });

    it('caps filled frames at window size', () => {
      const mon = new PerformanceMonitor(5);
      for (let i = 0; i < 20; i++) {
        mon.recordFrame(0.016);
      }
      expect(mon.filledFrames).toBe(5);
    });

    it('becomes warmed up after windowSize frames', () => {
      const mon = new PerformanceMonitor(3);
      expect(mon.isWarmedUp).toBe(false);
      mon.recordFrame(0.016);
      expect(mon.isWarmedUp).toBe(false);
      mon.recordFrame(0.016);
      expect(mon.isWarmedUp).toBe(false);
      mon.recordFrame(0.016);
      expect(mon.isWarmedUp).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Snapshot - FPS and frame times
  // -----------------------------------------------------------------------

  describe('getSnapshot - frame times', () => {
    it('returns zero FPS when no frames recorded', () => {
      const mon = new PerformanceMonitor(10);
      const snap = mon.getSnapshot();
      expect(snap.fps).toBe(0);
      expect(snap.avgFrameTimeMs).toBe(0);
      expect(snap.maxFrameTimeMs).toBe(0);
      expect(snap.minFrameTimeMs).toBe(0);
    });

    it('computes correct FPS for steady 60fps frames', () => {
      const mon = new PerformanceMonitor(10);
      const dt = 1 / 60; // ~16.67ms
      for (let i = 0; i < 10; i++) {
        mon.recordFrame(dt);
      }
      const snap = mon.getSnapshot();
      expect(snap.fps).toBeCloseTo(60, 0);
      expect(snap.avgFrameTimeMs).toBeCloseTo(16.667, 0);
    });

    it('computes correct FPS for steady 30fps frames', () => {
      const mon = new PerformanceMonitor(10);
      const dt = 1 / 30; // ~33.33ms
      for (let i = 0; i < 10; i++) {
        mon.recordFrame(dt);
      }
      const snap = mon.getSnapshot();
      expect(snap.fps).toBeCloseTo(30, 0);
    });

    it('tracks min and max frame times', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(0.010); // 10ms
      mon.recordFrame(0.020); // 20ms
      mon.recordFrame(0.015); // 15ms
      mon.recordFrame(0.030); // 30ms
      mon.recordFrame(0.005); // 5ms

      const snap = mon.getSnapshot();
      expect(snap.minFrameTimeMs).toBeCloseTo(5, 1);
      expect(snap.maxFrameTimeMs).toBeCloseTo(30, 1);
    });

    it('rolling window replaces oldest frames', () => {
      const mon = new PerformanceMonitor(3);
      // Fill with 30fps frames
      mon.recordFrame(1 / 30);
      mon.recordFrame(1 / 30);
      mon.recordFrame(1 / 30);
      expect(mon.getSnapshot().fps).toBeCloseTo(30, 0);

      // Replace all with 60fps frames
      mon.recordFrame(1 / 60);
      mon.recordFrame(1 / 60);
      mon.recordFrame(1 / 60);
      expect(mon.getSnapshot().fps).toBeCloseTo(60, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Snapshot - renderer info
  // -----------------------------------------------------------------------

  describe('getSnapshot - renderer info', () => {
    it('tracks draw calls and triangles', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(0.016);
      mon.setRendererInfo({
        render: { calls: 42, triangles: 12345 },
        memory: { geometries: 10, textures: 5 },
      });

      const snap = mon.getSnapshot();
      expect(snap.drawCalls).toBe(42);
      expect(snap.triangles).toBe(12345);
    });

    it('estimates memory from geometries and textures', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(0.016);
      mon.setRendererInfo({
        render: { calls: 0, triangles: 0 },
        memory: { geometries: 100, textures: 2 },
      });

      const snap = mon.getSnapshot();
      // 100 * 0.001 + 2 * 4 = 0.1 + 8 = 8.1
      expect(snap.memoryMB).toBeCloseTo(8.1, 1);
    });

    it('tracks entity count', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(0.016);
      mon.setEntityCount(350);

      const snap = mon.getSnapshot();
      expect(snap.entityCount).toBe(350);
    });

    it('tracks GPU time', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(0.016);
      mon.setGPUTime(8.5);

      const snap = mon.getSnapshot();
      expect(snap.gpuTimeMs).toBeCloseTo(8.5, 1);
    });

    it('GPU time defaults to -1 when unavailable', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(0.016);
      expect(mon.getSnapshot().gpuTimeMs).toBe(-1);
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  describe('reset', () => {
    it('clears all frame data', () => {
      const mon = new PerformanceMonitor(5);
      for (let i = 0; i < 5; i++) mon.recordFrame(0.016);
      mon.setRendererInfo({
        render: { calls: 10, triangles: 500 },
        memory: { geometries: 5, textures: 2 },
      });
      mon.setEntityCount(100);
      mon.setGPUTime(5.0);

      mon.reset();

      expect(mon.filledFrames).toBe(0);
      expect(mon.isWarmedUp).toBe(false);

      const snap = mon.getSnapshot();
      expect(snap.fps).toBe(0);
      expect(snap.drawCalls).toBe(0);
      expect(snap.triangles).toBe(0);
      expect(snap.entityCount).toBe(0);
      expect(snap.gpuTimeMs).toBe(-1);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles zero dt gracefully', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(0);
      mon.recordFrame(0);
      mon.recordFrame(0);
      mon.recordFrame(0);
      mon.recordFrame(0);

      const snap = mon.getSnapshot();
      // 0ms frame time -> avg is 0 -> fps guard returns 0
      expect(snap.fps).toBe(0);
      expect(snap.avgFrameTimeMs).toBe(0);
    });

    it('handles very large dt without crashing', () => {
      const mon = new PerformanceMonitor(5);
      mon.recordFrame(10); // 10 seconds
      const snap = mon.getSnapshot();
      expect(snap.fps).toBeCloseTo(0.1, 1);
      expect(snap.avgFrameTimeMs).toBeCloseTo(10000, 0);
    });

    it('partially filled window computes average over filled frames only', () => {
      const mon = new PerformanceMonitor(10);
      // Only fill 3 frames at 60fps
      mon.recordFrame(1 / 60);
      mon.recordFrame(1 / 60);
      mon.recordFrame(1 / 60);

      expect(mon.filledFrames).toBe(3);
      const snap = mon.getSnapshot();
      expect(snap.fps).toBeCloseTo(60, 0);
    });
  });
});
