/**
 * Real-time performance monitoring for the adaptive quality system.
 *
 * Tracks frame times via a rolling window, estimates GPU load when
 * EXT_disjoint_timer_query is available, and collects renderer stats
 * (draw calls, triangles, memory) from Three.js each frame.
 *
 * The monitor itself does no quality adjustments -- it produces a
 * PerformanceSnapshot consumed by AdaptiveQuality.
 */

export interface PerformanceSnapshot {
  /** Current FPS based on rolling average of frame times. */
  fps: number;
  /** Average frame time in milliseconds (rolling window). */
  avgFrameTimeMs: number;
  /** Maximum frame time in the rolling window (ms). */
  maxFrameTimeMs: number;
  /** Minimum frame time in the rolling window (ms). */
  minFrameTimeMs: number;
  /** Number of draw calls this frame (from renderer.info). */
  drawCalls: number;
  /** Number of triangles rendered this frame. */
  triangles: number;
  /** Number of active entities tracked by the caller. */
  entityCount: number;
  /** GPU memory usage estimate in MB (renderer.info.memory). */
  memoryMB: number;
  /** GPU time in ms if EXT_disjoint_timer_query is available, else -1. */
  gpuTimeMs: number;
}

/** Renderer info subset matching Three.js renderer.info shape. */
export interface RendererInfo {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

/**
 * Lightweight frame-time tracker and renderer stats collector.
 *
 * Usage:
 *   const monitor = new PerformanceMonitor(60);
 *   // Each frame:
 *   monitor.recordFrame(dt);
 *   monitor.setRendererInfo(renderer.info);
 *   monitor.setEntityCount(entityManager.count);
 *   const snap = monitor.getSnapshot();
 */
export class PerformanceMonitor {
  private readonly windowSize: number;
  private readonly frameTimes: number[];
  private frameIndex: number = 0;
  private frameCount: number = 0;

  private drawCalls: number = 0;
  private triangles: number = 0;
  private memoryGeometries: number = 0;
  private memoryTextures: number = 0;
  private entityCount: number = 0;
  private gpuTimeMs: number = -1;

  /**
   * @param windowSize Number of frames to keep in the rolling average.
   *                   Defaults to 60 (one second at 60fps).
   */
  constructor(windowSize: number = 60) {
    this.windowSize = Math.max(1, Math.floor(windowSize));
    this.frameTimes = new Array<number>(this.windowSize).fill(0);
  }

  /**
   * Record a frame's delta time.
   * @param dtSeconds Delta time in seconds (as provided by the game loop).
   */
  recordFrame(dtSeconds: number): void {
    const ms = dtSeconds * 1000;
    this.frameTimes[this.frameIndex] = ms;
    this.frameIndex = (this.frameIndex + 1) % this.windowSize;
    if (this.frameCount < this.windowSize) {
      this.frameCount++;
    }
  }

  /** Feed renderer.info stats from Three.js. */
  setRendererInfo(info: RendererInfo): void {
    this.drawCalls = info.render.calls;
    this.triangles = info.render.triangles;
    this.memoryGeometries = info.memory.geometries;
    this.memoryTextures = info.memory.textures;
  }

  /** Set the current entity count (enemies, bullets, particles, etc.). */
  setEntityCount(count: number): void {
    this.entityCount = count;
  }

  /** Set GPU time from EXT_disjoint_timer_query (ms). Pass -1 if unavailable. */
  setGPUTime(ms: number): void {
    this.gpuTimeMs = ms;
  }

  /** Number of frames recorded so far (up to windowSize). */
  get filledFrames(): number {
    return this.frameCount;
  }

  /** Whether the rolling window is fully populated. */
  get isWarmedUp(): boolean {
    return this.frameCount >= this.windowSize;
  }

  /** Compute and return the current performance snapshot. */
  getSnapshot(): PerformanceSnapshot {
    const count = this.frameCount;

    if (count === 0) {
      return {
        fps: 0,
        avgFrameTimeMs: 0,
        maxFrameTimeMs: 0,
        minFrameTimeMs: 0,
        drawCalls: this.drawCalls,
        triangles: this.triangles,
        entityCount: this.entityCount,
        memoryMB: this.estimateMemoryMB(),
        gpuTimeMs: this.gpuTimeMs,
      };
    }

    let sum = 0;
    let max = -Infinity;
    let min = Infinity;

    for (let i = 0; i < count; i++) {
      const t = this.frameTimes[i];
      sum += t;
      if (t > max) max = t;
      if (t < min) min = t;
    }

    const avg = sum / count;
    const fps = avg > 0 ? 1000 / avg : 0;

    return {
      fps,
      avgFrameTimeMs: avg,
      maxFrameTimeMs: max,
      minFrameTimeMs: min,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      entityCount: this.entityCount,
      memoryMB: this.estimateMemoryMB(),
      gpuTimeMs: this.gpuTimeMs,
    };
  }

  /** Reset all tracked data. */
  reset(): void {
    this.frameTimes.fill(0);
    this.frameIndex = 0;
    this.frameCount = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.memoryGeometries = 0;
    this.memoryTextures = 0;
    this.entityCount = 0;
    this.gpuTimeMs = -1;
  }

  /**
   * Rough memory estimate. Each geometry ~1KB base, each texture ~4MB avg.
   * This is intentionally coarse -- mainly useful for trend detection.
   */
  private estimateMemoryMB(): number {
    return this.memoryGeometries * 0.001 + this.memoryTextures * 4;
  }
}
