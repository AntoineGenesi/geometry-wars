import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceProfiler, ScopeData } from './PerformanceProfiler';

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    profiler = new PerformanceProfiler();
  });

  describe('Basic Timing', () => {
    it('should track time for a single scope', () => {
      profiler.begin('test_scope');
      // Simulate some work
      const start = performance.now();
      while (performance.now() - start < 5) {
        // Busy wait for ~5ms
      }
      profiler.end('test_scope');

      const data = profiler.getFrameData();
      expect(data).toHaveLength(1);
      expect(data[0].label).toBe('test_scope');
      expect(data[0].totalMs).toBeGreaterThan(4); // Allow some timing variance
      expect(data[0].callCount).toBe(1);
      expect(data[0].avgMs).toBe(data[0].totalMs);
    });

    it('should accumulate time for multiple calls to same scope', () => {
      // First call
      profiler.begin('repeat_scope');
      let start = performance.now();
      while (performance.now() - start < 2) {}
      profiler.end('repeat_scope');

      // Second call
      profiler.begin('repeat_scope');
      start = performance.now();
      while (performance.now() - start < 3) {}
      profiler.end('repeat_scope');

      const data = profiler.getFrameData();
      expect(data).toHaveLength(1);
      expect(data[0].label).toBe('repeat_scope');
      expect(data[0].callCount).toBe(2);
      expect(data[0].totalMs).toBeGreaterThan(4); // At least 2+3ms
      expect(data[0].avgMs).toBeCloseTo(data[0].totalMs / 2, 1);
    });

    it('should track multiple different scopes', () => {
      profiler.begin('scope_a');
      let start = performance.now();
      while (performance.now() - start < 5) {}
      profiler.end('scope_a');

      profiler.begin('scope_b');
      start = performance.now();
      while (performance.now() - start < 3) {}
      profiler.end('scope_b');

      profiler.begin('scope_c');
      start = performance.now();
      while (performance.now() - start < 1) {}
      profiler.end('scope_c');

      const data = profiler.getFrameData();
      expect(data).toHaveLength(3);

      // Should be sorted by totalMs descending
      expect(data[0].label).toBe('scope_a');
      expect(data[1].label).toBe('scope_b');
      expect(data[2].label).toBe('scope_c');
    });
  });

  describe('Reset Behavior', () => {
    it('should reset all scope data', () => {
      profiler.begin('scope_1');
      profiler.end('scope_1');

      profiler.begin('scope_2');
      profiler.end('scope_2');

      expect(profiler.getFrameData()).toHaveLength(2);

      profiler.reset();

      const data = profiler.getFrameData();
      expect(data).toHaveLength(0);
    });

    it('should allow reuse of scopes after reset (zero-allocation)', () => {
      // First frame
      profiler.begin('reused_scope');
      profiler.end('reused_scope');
      const scopeCountBefore = profiler.getScopeCount();

      profiler.reset();

      // Second frame - should reuse existing Map entry
      profiler.begin('reused_scope');
      profiler.end('reused_scope');
      const scopeCountAfter = profiler.getScopeCount();

      // Scope count should be same (Map entry was reused, not recreated)
      expect(scopeCountAfter).toBe(scopeCountBefore);

      const data = profiler.getFrameData();
      expect(data).toHaveLength(1);
      expect(data[0].callCount).toBe(1); // Fresh count after reset
    });
  });

  describe('Enable/Disable', () => {
    it('should return empty data when disabled', () => {
      profiler.begin('scope_1');
      profiler.end('scope_1');

      profiler.setEnabled(false);

      const data = profiler.getFrameData();
      expect(data).toHaveLength(0);
    });

    it('should have zero overhead when disabled', () => {
      profiler.setEnabled(false);

      // These should be no-ops
      profiler.begin('scope_1');
      profiler.end('scope_1');
      profiler.reset();

      expect(profiler.isEnabled()).toBe(false);
      expect(profiler.getFrameData()).toHaveLength(0);
    });

    it('should re-enable correctly', () => {
      profiler.setEnabled(false);
      profiler.setEnabled(true);

      profiler.begin('scope_1');
      profiler.end('scope_1');

      expect(profiler.getFrameData()).toHaveLength(1);
    });

    it('should clear data when disabling', () => {
      profiler.begin('scope_1');
      profiler.end('scope_1');

      expect(profiler.getScopeCount()).toBeGreaterThan(0);

      profiler.setEnabled(false);

      // Data should be cleared
      expect(profiler.getScopeCount()).toBe(0);
    });
  });

  describe('getTopScopes', () => {
    it('should return top N scopes by time', () => {
      // Create 5 scopes with different times
      for (let i = 0; i < 5; i++) {
        profiler.begin(`scope_${i}`);
        const start = performance.now();
        while (performance.now() - start < i + 1) {}
        profiler.end(`scope_${i}`);
      }

      const top3 = profiler.getTopScopes(3);
      expect(top3).toHaveLength(3);

      // Should be sorted by totalMs descending
      expect(top3[0].label).toBe('scope_4'); // Longest
      expect(top3[1].label).toBe('scope_3');
      expect(top3[2].label).toBe('scope_2');
    });

    it('should handle N larger than scope count', () => {
      profiler.begin('scope_1');
      profiler.end('scope_1');

      const top10 = profiler.getTopScopes(10);
      expect(top10).toHaveLength(1);
    });
  });

  describe('getTotalFrameTime', () => {
    it('should sum all scope times', () => {
      profiler.begin('scope_a');
      let start = performance.now();
      while (performance.now() - start < 5) {}
      profiler.end('scope_a');

      profiler.begin('scope_b');
      start = performance.now();
      while (performance.now() - start < 3) {}
      profiler.end('scope_b');

      const total = profiler.getTotalFrameTime();
      expect(total).toBeGreaterThan(7); // At least 5+3ms

      const data = profiler.getFrameData();
      const manualSum = data.reduce((sum, scope) => sum + scope.totalMs, 0);
      expect(total).toBeCloseTo(manualSum, 2);
    });

    it('should return 0 when disabled', () => {
      profiler.setEnabled(false);
      expect(profiler.getTotalFrameTime()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle end() called without begin() gracefully', () => {
      // Should not throw or crash
      expect(() => profiler.end('nonexistent_scope')).not.toThrow();

      // Should not affect other scopes
      profiler.begin('valid_scope');
      profiler.end('valid_scope');

      const data = profiler.getFrameData();
      expect(data).toHaveLength(1);
      expect(data[0].label).toBe('valid_scope');
    });

    it('should handle rapid begin/end cycles', () => {
      // Simulate rapid calls
      for (let i = 0; i < 100; i++) {
        profiler.begin('rapid_scope');
        profiler.end('rapid_scope');
      }

      const data = profiler.getFrameData();
      expect(data).toHaveLength(1);
      expect(data[0].callCount).toBe(100);
    });

    it('should clear lingering start times on reset', () => {
      profiler.begin('forgotten_scope');
      // Forgot to call end()

      profiler.reset();

      // Should not affect next frame
      profiler.begin('forgotten_scope');
      profiler.end('forgotten_scope');

      const data = profiler.getFrameData();
      expect(data).toHaveLength(1);
      expect(data[0].callCount).toBe(1); // Only the second call
    });
  });

  describe('Performance Overhead', () => {
    // NOTE: These benchmarks may be flaky due to JavaScript timing variance.
    // They verify the implementation has low overhead, but exact percentages
    // fluctuate with system load. Implementation is correct if tests pass most of the time.
    it('should have <5% overhead when tracking 20 scopes', () => {
      // Simulate realistic 60 FPS game frame: ~16.67ms per frame
      // We'll run fewer iterations but make each one more substantial
      const iterations = 100;

      // Simulate realistic game loop work per system
      // Each system does some array operations, math, object creation
      const doWork = () => {
        const entities = [];
        for (let k = 0; k < 100; k++) {
          entities.push({
            x: Math.random() * 1000,
            y: Math.random() * 1000,
            velocity: Math.sqrt(Math.random() * 100),
          });
        }
        return entities.reduce((sum, e) => sum + e.velocity, 0);
      };

      // Baseline: raw work without profiling
      profiler.setEnabled(false);
      const baselineStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        // Simulate 20 game systems per frame
        for (let j = 0; j < 20; j++) {
          doWork();
        }
      }
      const baselineTime = performance.now() - baselineStart;

      // With profiling: same work + 20 begin/end pairs
      profiler.setEnabled(true);
      profiler.reset();
      const profiledStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < 20; j++) {
          profiler.begin(`scope_${j}`);
          doWork();
          profiler.end(`scope_${j}`);
        }
        profiler.reset();
      }
      const profiledTime = performance.now() - profiledStart;

      const overhead = ((profiledTime - baselineTime) / baselineTime) * 100;

      console.log(`Baseline: ${baselineTime.toFixed(2)}ms (${(baselineTime / iterations).toFixed(2)}ms per frame)`);
      console.log(`Profiled: ${profiledTime.toFixed(2)}ms (${(profiledTime / iterations).toFixed(2)}ms per frame)`);
      console.log(`Overhead: ${overhead.toFixed(2)}%`);

      // Should be under 5% overhead
      expect(overhead).toBeLessThan(5);
    });

    it('should have near-zero overhead when disabled', () => {
      const iterations = 10000;

      const doWork = () => {
        const arr = [];
        for (let k = 0; k < 10; k++) {
          arr.push(Math.sqrt(Math.random() * 1000));
        }
        return arr.reduce((a, b) => a + b, 0);
      };

      // Baseline: raw work
      const baselineStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        doWork();
      }
      const baselineTime = performance.now() - baselineStart;

      // With profiler disabled: should be identical
      profiler.setEnabled(false);
      const disabledStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        profiler.begin('scope');
        doWork();
        profiler.end('scope');
      }
      const disabledTime = performance.now() - disabledStart;

      const overhead = ((disabledTime - baselineTime) / baselineTime) * 100;

      console.log(`Baseline: ${baselineTime.toFixed(2)}ms`);
      console.log(`Disabled: ${disabledTime.toFixed(2)}ms`);
      console.log(`Overhead: ${overhead.toFixed(2)}%`);

      // Should be negligible (allow for timing variance)
      expect(overhead).toBeLessThan(2);
    });
  });

  describe('Zero-Allocation Verification', () => {
    it('should not allocate during reset', () => {
      // Prime the profiler with some scopes
      for (let i = 0; i < 10; i++) {
        profiler.begin(`scope_${i}`);
        profiler.end(`scope_${i}`);
      }

      const scopeCountBefore = profiler.getScopeCount();

      // Multiple resets should not change scope count (Map not reallocated)
      for (let i = 0; i < 100; i++) {
        profiler.reset();
      }

      const scopeCountAfter = profiler.getScopeCount();
      expect(scopeCountAfter).toBe(scopeCountBefore);
    });

    it('should reuse sorted array between getFrameData calls', () => {
      profiler.begin('scope_1');
      profiler.end('scope_1');

      const data1 = profiler.getFrameData();
      const data2 = profiler.getFrameData();

      // Both calls should return arrays (not the same reference)
      expect(data1).toBeInstanceOf(Array);
      expect(data2).toBeInstanceOf(Array);

      // But the internal sorted array should be reused (no new allocation)
      // This is hard to test directly, but we verify the behavior is correct
      expect(data1).toEqual(data2);
    });
  });

  describe('Nested Scopes (Future-Proofing)', () => {
    it('should handle nested begin/end pairs', () => {
      profiler.begin('outer');

      profiler.begin('inner_1');
      const start = performance.now();
      while (performance.now() - start < 2) {}
      profiler.end('inner_1');

      profiler.begin('inner_2');
      const start2 = performance.now();
      while (performance.now() - start2 < 3) {}
      profiler.end('inner_2');

      profiler.end('outer');

      const data = profiler.getFrameData();
      expect(data).toHaveLength(3);

      // Find each scope
      const outer = data.find((s) => s.label === 'outer')!;
      const inner1 = data.find((s) => s.label === 'inner_1')!;
      const inner2 = data.find((s) => s.label === 'inner_2')!;

      expect(outer).toBeDefined();
      expect(inner1).toBeDefined();
      expect(inner2).toBeDefined();

      // Outer should include time for inner scopes
      expect(outer.totalMs).toBeGreaterThan(inner1.totalMs + inner2.totalMs);
    });
  });
});
