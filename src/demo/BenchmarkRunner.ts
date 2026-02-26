/**
 * BenchmarkRunner — Performance measurement for animated GLB characters.
 *
 * Spawns N animated characters on a sphere surface, runs them for a fixed
 * duration, and collects FPS + renderer stats. Designed to be driven by
 * OBJDebugPanel's render loop via update().
 *
 * Debug-only — not in any production code path.
 */

import * as THREE from 'three';
import { SphereSurface } from '../surfaces/SphereSurface';
import { AnimatedCharacter } from './AnimatedCharacter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  characterCount: number;
  avgFps: number;
  minFps: number;
  drawCalls: number;
  triangles: number;
  animCpuMs: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Three character types to cycle through */
const CHAR_PATHS = [
  '/characters/knight.glb',
  '/characters/mage.glb',
  '/characters/warrior.glb',
];

const SPHERE_RADIUS = 2;
const CHAR_SCALE = 0.45;
const WALK_SPEED = 0.08;

/** Wait up to this many ms for GLBs to load before starting measurement */
const MAX_LOAD_WAIT_MS = 3000;

/** Minimum FPS samples needed for a valid result */
const MIN_SAMPLES = 10;

// ---------------------------------------------------------------------------
// BenchmarkRunner
// ---------------------------------------------------------------------------

export class BenchmarkRunner {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;

  private surface: SphereSurface | null = null;
  private characters: AnimatedCharacter[] = [];

  // Running state
  private running = false;
  private waitingForLoad = false;
  private loadStartTime = 0;
  private startTime = 0;
  private durationMs = 0;
  private targetCount = 0;

  // Metric accumulation
  private samples: number[] = [];
  private animCpuSamples: number[] = [];
  private lastDrawCalls = 0;
  private lastTriangles = 0;

  // Promise resolution
  private resolveCallback: ((result: BenchmarkResult) => void) | null = null;
  private rejectCallback: ((err: Error) => void) | null = null;

  /** Called each frame with the current benchmark status (for UI updates) */
  onProgress: ((fractionDone: number, sampleCount: number) => void) | null = null;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Spawn `count` animated characters on the sphere, wait for them to load,
   * then collect FPS + renderer metrics for `durationMs` milliseconds.
   *
   * Called from OBJDebugPanel — the update() method must be called each frame
   * while the promise is pending.
   */
  async runBenchmark(count: number, durationMs = 5000): Promise<BenchmarkResult> {
    this.clear();

    // Create sphere surface
    this.surface = new SphereSurface({
      radius: SPHERE_RADIUS,
      gridSegmentsU: 12,
      gridSegmentsV: 12,
      surfaceOpacity: 0.6,
    });
    const gridMat = this.surface.gridMesh.material as THREE.LineBasicMaterial;
    gridMat.opacity = 0.2;
    this.scene.add(this.surface.group);

    // Spawn N characters, cycling through three GLB types
    for (let i = 0; i < count; i++) {
      const u = 0.05 + Math.random() * 0.9;
      const v = 0.05 + Math.random() * 0.9;
      const char = new AnimatedCharacter({
        glbPath: CHAR_PATHS[i % CHAR_PATHS.length],
        surface: this.surface,
        startU: u,
        startV: v,
        walkSpeed: WALK_SPEED * (0.7 + Math.random() * 0.6),
        scale: CHAR_SCALE,
        headingWanderRate: 0.6,
        scene: this.scene,
      });
      this.characters.push(char);
    }

    // Reset metrics
    this.samples = [];
    this.animCpuSamples = [];
    this.lastDrawCalls = 0;
    this.lastTriangles = 0;
    this.targetCount = count;
    this.durationMs = durationMs;

    // Enter waiting-for-load phase
    this.waitingForLoad = true;
    this.running = false;
    this.loadStartTime = performance.now();

    return new Promise((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });
  }

  /**
   * Must be called every frame from the render loop while a benchmark is running.
   * Returns true while active (loading or collecting).
   */
  update(dt: number): boolean {
    if (!this.waitingForLoad && !this.running) return false;

    // --- Load wait phase ---
    if (this.waitingForLoad) {
      const elapsed = performance.now() - this.loadStartTime;
      const allLoaded = this.characters.length > 0 &&
        this.characters.every((c) => c.isLoaded);

      if (allLoaded || elapsed >= MAX_LOAD_WAIT_MS) {
        // Transition to collection phase — advance characters to spread them out first
        this.waitingForLoad = false;
        this.running = true;
        this.startTime = performance.now();
        this.samples = [];
        this.animCpuSamples = [];
      } else {
        // Still loading — advance characters anyway (some may already be loaded)
        for (const char of this.characters) {
          char.update(Math.min(dt, 0.05));
        }
        return true;
      }
    }

    // --- Collection phase ---
    if (this.running) {
      // Measure animation CPU time
      performance.mark('bench-anim-start');
      for (const char of this.characters) {
        char.update(Math.min(dt, 0.05));
      }
      performance.mark('bench-anim-end');

      let animMs = 0;
      try {
        const measure = performance.measure('bench-anim', 'bench-anim-start', 'bench-anim-end');
        animMs = measure.duration;
        // Clean up to avoid memory buildup
        performance.clearMarks('bench-anim-start');
        performance.clearMarks('bench-anim-end');
        performance.clearMeasures('bench-anim');
      } catch {
        // performance.measure may throw if marks are missing; ignore
      }

      // Record FPS (filter out spikes from tab switching, etc.)
      const fps = dt > 0 ? 1 / dt : 0;
      if (fps >= 1 && fps <= 300) {
        this.samples.push(fps);
      }
      this.animCpuSamples.push(animMs);

      // Capture renderer stats after render (called after previewRenderer.render)
      this.lastDrawCalls = this.renderer.info.render.calls;
      this.lastTriangles = this.renderer.info.render.triangles;

      const elapsed = performance.now() - this.startTime;
      this.onProgress?.(elapsed / this.durationMs, this.samples.length);

      if (elapsed >= this.durationMs) {
        this.running = false;

        if (this.samples.length < MIN_SAMPLES) {
          this.rejectCallback?.(new Error(
            `Benchmark failed: only ${this.samples.length} FPS samples collected (need ${MIN_SAMPLES}). ` +
            `Characters may not have loaded properly.`,
          ));
        } else {
          this.resolveCallback?.(this.buildResult());
        }

        this.resolveCallback = null;
        this.rejectCallback = null;
      }

      return true;
    }

    return false;
  }

  /** Is the benchmark currently collecting (not just waiting for load)? */
  get isCollecting(): boolean {
    return this.running;
  }

  /** Is anything active (load wait or collecting)? */
  get isActive(): boolean {
    return this.waitingForLoad || this.running;
  }

  /**
   * Remove all characters and surface from the scene.
   */
  clear(): void {
    this.running = false;
    this.waitingForLoad = false;
    this.resolveCallback = null;
    this.rejectCallback = null;

    for (const char of this.characters) {
      this.scene.remove(char.root);
      char.dispose();
    }
    this.characters = [];

    if (this.surface) {
      this.scene.remove(this.surface.group);
      this.surface.dispose();
      this.surface = null;
    }
  }

  dispose(): void {
    this.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private buildResult(): BenchmarkResult {
    const { samples, animCpuSamples } = this;
    const sum = samples.reduce((a, b) => a + b, 0);
    const avgFps = sum / samples.length;
    const minFps = Math.min(...samples);
    const avgAnimMs = animCpuSamples.length > 0
      ? animCpuSamples.reduce((a, b) => a + b, 0) / animCpuSamples.length
      : 0;

    return {
      characterCount: this.targetCount,
      avgFps: Math.round(avgFps * 10) / 10,
      minFps: Math.round(minFps * 10) / 10,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      animCpuMs: Math.round(avgAnimMs * 100) / 100,
      timestamp: Date.now(),
    };
  }
}
