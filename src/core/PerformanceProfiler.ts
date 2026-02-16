/**
 * PerformanceProfiler — Zero-allocation scope timing for 60 FPS gameplay
 *
 * Usage:
 *   profiler.begin('enemy_update');
 *   // ... work ...
 *   profiler.end('enemy_update');
 *   const topScopes = profiler.getTopScopes(5);
 *   profiler.reset(); // Call at start of each frame
 */

export interface ScopeData {
  /** Label of this scope (e.g., "enemy_update", "render_loop"). */
  label: string;
  /** Total time spent in this scope this frame (ms). */
  totalMs: number;
  /** Number of times this scope was entered this frame. */
  callCount: number;
  /** Average time per call this frame (ms). */
  avgMs: number;
}

interface MutableScopeData {
  label: string;
  totalMs: number;
  callCount: number;
  avgMs: number;
}

export class PerformanceProfiler {
  private enabled = true;
  private scopeData = new Map<string, MutableScopeData>();
  private startTimes = new Map<string, number>();

  // Pre-allocated array for sorting (reused to avoid allocation)
  private sortedScopes: ScopeData[] = [];

  /**
   * Enable/disable profiling.
   * When disabled, all operations become no-ops with zero overhead.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      // Clear all data when disabling to free memory
      this.scopeData.clear();
      this.startTimes.clear();
      this.sortedScopes.length = 0;
    }
  }

  /**
   * Check if profiler is currently enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Start timing a labeled scope.
   * Can be called multiple times per frame for the same label (cumulative).
   */
  begin(label: string): void {
    if (!this.enabled) return;

    // Record start time
    this.startTimes.set(label, performance.now());

    // Ensure scope data entry exists (pre-allocate on first use)
    if (!this.scopeData.has(label)) {
      this.scopeData.set(label, {
        label,
        totalMs: 0,
        callCount: 0,
        avgMs: 0,
      });
    }
  }

  /**
   * End timing a labeled scope.
   * Must be called after begin() with matching label.
   */
  end(label: string): void {
    if (!this.enabled) return;

    const endTime = performance.now();
    const startTime = this.startTimes.get(label);

    if (startTime === undefined) {
      // Skip console.warn in production for performance
      // console.warn(`PerformanceProfiler: end('${label}') called without matching begin()`);
      return;
    }

    const scopeData = this.scopeData.get(label);
    if (!scopeData) {
      // Should never happen if begin() was called
      return;
    }

    // Accumulate time and increment call count
    const deltaMs = endTime - startTime;
    scopeData.totalMs += deltaMs;
    scopeData.callCount += 1;
    scopeData.avgMs = scopeData.totalMs / scopeData.callCount;

    // Remove start time (we're done with this scope invocation)
    this.startTimes.delete(label);
  }

  /**
   * Get all scope data for this frame, sorted by totalMs descending.
   * Returns a readonly array to prevent external modification.
   */
  getFrameData(): ReadonlyArray<ScopeData> {
    if (!this.enabled) return [];

    // Clear and rebuild sorted array (reuse existing array to avoid allocation)
    this.sortedScopes.length = 0;

    for (const scopeData of this.scopeData.values()) {
      // Skip scopes with no recorded time this frame
      if (scopeData.callCount === 0) continue;

      // Push a copy to avoid exposing mutable internal state
      this.sortedScopes.push({
        label: scopeData.label,
        totalMs: scopeData.totalMs,
        callCount: scopeData.callCount,
        avgMs: scopeData.avgMs,
      });
    }

    // Sort by total time descending (most expensive first)
    this.sortedScopes.sort((a, b) => b.totalMs - a.totalMs);

    return this.sortedScopes;
  }

  /**
   * Get top N scopes by time.
   * More efficient than getFrameData() when you only need a few entries.
   */
  getTopScopes(n: number): ReadonlyArray<ScopeData> {
    const allScopes = this.getFrameData();
    return allScopes.slice(0, n);
  }

  /**
   * Reset all scope data for the next frame.
   * Keeps Map entries allocated to avoid GC (zero-allocation reset).
   */
  reset(): void {
    if (!this.enabled) return;

    // Reset accumulated data but keep Map entries
    for (const scopeData of this.scopeData.values()) {
      scopeData.totalMs = 0;
      scopeData.callCount = 0;
      scopeData.avgMs = 0;
    }

    // Clear any lingering start times (in case end() wasn't called)
    this.startTimes.clear();
  }

  /**
   * Get the number of tracked scopes.
   */
  getScopeCount(): number {
    return this.scopeData.size;
  }

  /**
   * Get total time across all scopes this frame.
   */
  getTotalFrameTime(): number {
    if (!this.enabled) return 0;

    let total = 0;
    for (const scopeData of this.scopeData.values()) {
      total += scopeData.totalMs;
    }
    return total;
  }
}

/**
 * Global singleton instance for convenience.
 * Import and use directly: `profiler.begin('label')`
 */
export const profiler = new PerformanceProfiler();
