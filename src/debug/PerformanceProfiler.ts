/**
 * PerformanceProfiler — Game loop section timing + allocation tracking.
 *
 * Used ONLY when ?testMode=true — zero overhead when inactive.
 * Uses performance.mark() / performance.measure() for accurate browser timing.
 *
 * Sections: physics, enemyUpdate, bulletUpdate, rendering, stateSync,
 *           playerInput, spawning, telemetryExport
 *
 * GC tracking: counts allocation-site calls in hot paths (no heap measurement,
 * just frequency tracking as a proxy for GC pressure).
 */

// ---------------------------------------------------------------------------
// Serializable types
// ---------------------------------------------------------------------------

export interface SectionStats {
  name: string;
  avgMs: number;
  maxMs: number;
  callsPerFrame: number;
  totalMs: number;
  calls: number;
}

export interface AllocStats {
  name: string;
  allocsPerFrame: number;
  totalAllocs: number;
  estimatedBytes: number;
}

export interface FrameTiming {
  frame: number;
  totalMs: number;
  sections: Record<string, number>;
}

export interface GCPressureSummary {
  totalAllocsPerFrame: number;
  avgFrameTime: number;
  p99FrameTime: number;
  spikes: number;  // frames > 100ms
}

export interface PerformanceProfile {
  topCPU: SectionStats[];
  topGC: AllocStats[];
  frameTimings: FrameTiming[];
  gcPressure: GCPressureSummary;
}

// ---------------------------------------------------------------------------
// PerformanceProfiler
// ---------------------------------------------------------------------------

const MAX_FRAME_TIMINGS = 600;  // ~10s at 60fps
const SPIKE_THRESHOLD_MS = 100;

export class PerformanceProfiler {
  private sections = new Map<string, { totalMs: number; maxMs: number; calls: number; startMark: string; measureName: string }>();
  private allocTrackers = new Map<string, { count: number; bytesEstimate: number }>();
  private frameTimings: FrameTiming[] = [];
  private currentFrameSections: Record<string, number> = {};
  private frameCount = 0;
  private frameStartMark = '';

  // Active section stack for nested calls (rare but safe)
  private activeSections = new Map<string, number>();  // name → start time

  constructor() {
    this.reset();
  }

  // -------------------------------------------------------------------------
  // Frame lifecycle
  // -------------------------------------------------------------------------

  /** Call at the very start of each fixed-update frame. */
  beginFrame(): void {
    this.frameStartMark = `perf_frame_${this.frameCount}`;
    this.currentFrameSections = {};
    performance.mark(this.frameStartMark);
  }

  /** Call at the very end of each fixed-update frame. Commits frame record. */
  endFrame(): void {
    const endMark = `perf_frame_end_${this.frameCount}`;
    performance.mark(endMark);

    let frameMs = 0;
    try {
      const measure = performance.measure(`frame_${this.frameCount}`, this.frameStartMark, endMark);
      frameMs = measure.duration;
    } catch {
      // measure may fail if marks were cleared
    }

    const timing: FrameTiming = {
      frame: this.frameCount,
      totalMs: frameMs,
      sections: { ...this.currentFrameSections },
    };

    this.frameTimings.push(timing);
    if (this.frameTimings.length > MAX_FRAME_TIMINGS) {
      this.frameTimings.shift();
    }

    this.frameCount++;

    // Clean up performance marks to avoid memory buildup
    try {
      performance.clearMarks(this.frameStartMark);
      performance.clearMarks(endMark);
    } catch { /* best effort */ }
  }

  // -------------------------------------------------------------------------
  // Section timing
  // -------------------------------------------------------------------------

  /** Begin timing a named section. */
  beginSection(name: string): void {
    const now = performance.now();
    this.activeSections.set(name, now);
  }

  /**
   * Directly record a section's timing without begin/end.
   * Used to feed data from the core profiler singleton which already wraps GameLoop sections.
   */
  recordSection(name: string, ms: number): void {
    let stats = this.sections.get(name);
    if (!stats) {
      stats = { totalMs: 0, maxMs: 0, calls: 0, startMark: '', measureName: '' };
      this.sections.set(name, stats);
    }
    stats.totalMs += ms;
    stats.calls++;
    if (ms > stats.maxMs) stats.maxMs = ms;
    this.currentFrameSections[name] = (this.currentFrameSections[name] ?? 0) + ms;
  }

  /** End timing a named section. Records the duration. */
  endSection(name: string): void {
    const start = this.activeSections.get(name);
    if (start === undefined) return;

    const ms = performance.now() - start;
    this.activeSections.delete(name);

    // Accumulate in section stats
    let stats = this.sections.get(name);
    if (!stats) {
      stats = { totalMs: 0, maxMs: 0, calls: 0, startMark: '', measureName: '' };
      this.sections.set(name, stats);
    }
    stats.totalMs += ms;
    stats.calls++;
    if (ms > stats.maxMs) stats.maxMs = ms;

    // Accumulate in current frame
    this.currentFrameSections[name] = (this.currentFrameSections[name] ?? 0) + ms;
  }

  // -------------------------------------------------------------------------
  // Allocation tracking (call at hot allocation sites)
  // -------------------------------------------------------------------------

  /**
   * Track an allocation site. Call this inline at allocation-heavy spots.
   * @param label  Short descriptor, e.g. "BulletPool.spawn"
   * @param estimatedBytes  Optional rough estimate (default 64 bytes)
   */
  trackAlloc(label: string, estimatedBytes = 64): void {
    let tracker = this.allocTrackers.get(label);
    if (!tracker) {
      tracker = { count: 0, bytesEstimate: 0 };
      this.allocTrackers.set(label, tracker);
    }
    tracker.count++;
    tracker.bytesEstimate += estimatedBytes;
  }

  // -------------------------------------------------------------------------
  // Profile extraction
  // -------------------------------------------------------------------------

  getProfile(): PerformanceProfile {
    const frameCount = Math.max(this.frameCount, 1);

    // Top CPU sections
    const cpuStats: SectionStats[] = [];
    for (const [name, stats] of this.sections) {
      cpuStats.push({
        name,
        avgMs: stats.totalMs / Math.max(stats.calls, 1),
        maxMs: stats.maxMs,
        callsPerFrame: stats.calls / frameCount,
        totalMs: stats.totalMs,
        calls: stats.calls,
      });
    }
    cpuStats.sort((a, b) => b.avgMs - a.avgMs);
    const topCPU = cpuStats.slice(0, 10);

    // Top GC sections
    const gcStats: AllocStats[] = [];
    for (const [name, tracker] of this.allocTrackers) {
      gcStats.push({
        name,
        allocsPerFrame: tracker.count / frameCount,
        totalAllocs: tracker.count,
        estimatedBytes: tracker.bytesEstimate,
      });
    }
    gcStats.sort((a, b) => b.allocsPerFrame - a.allocsPerFrame);
    const topGC = gcStats.slice(0, 10);

    // GC pressure summary
    const timings = this.frameTimings;
    let totalMs = 0;
    let spikes = 0;
    const sortedMs: number[] = [];
    for (const t of timings) {
      totalMs += t.totalMs;
      if (t.totalMs > SPIKE_THRESHOLD_MS) spikes++;
      sortedMs.push(t.totalMs);
    }
    sortedMs.sort((a, b) => a - b);
    const p99idx = Math.floor(sortedMs.length * 0.99);
    const p99FrameTime = sortedMs[p99idx] ?? 0;

    const totalAllocsPerFrame = gcStats.reduce((s, g) => s + g.allocsPerFrame, 0);

    return {
      topCPU,
      topGC,
      frameTimings: [...timings],
      gcPressure: {
        totalAllocsPerFrame,
        avgFrameTime: timings.length > 0 ? totalMs / timings.length : 0,
        p99FrameTime,
        spikes,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  reset(): void {
    this.sections.clear();
    this.allocTrackers.clear();
    this.frameTimings = [];
    this.currentFrameSections = {};
    this.frameCount = 0;
    this.activeSections.clear();
  }
}
