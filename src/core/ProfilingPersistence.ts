/**
 * ProfilingPersistence — Periodic sampling and persistence of profiling data.
 *
 * Samples profiler data every 5 seconds during gameplay and persists to disk
 * with git commit tagging for cross-commit trend analysis.
 *
 * Usage:
 *   const persistence = new ProfilingPersistence();
 *   persistence.start();
 *   // ... in render loop ...
 *   persistence.update(deltaTime);
 *   // ... on game end ...
 *   persistence.stop();
 *   await persistence.flush();
 */

import { profiler, type ScopeData } from './PerformanceProfiler';
import { getGitVersion, type GitVersionInfo } from '../utils/GitVersion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single profiling sample (top N scopes at a point in time). */
export interface ProfilingSample {
  /** Unix timestamp (ms). */
  timestamp: number;
  /** Elapsed game time (seconds) since session start. */
  gameTime: number;
  /** Top scopes sorted by total time. */
  scopes: Array<{
    label: string;
    totalMs: number;
    callCount: number;
    avgMs: number;
  }>;
  /** Total frame time (sum of all scopes). */
  totalFrameMs: number;
}

/** A profiling session containing multiple samples. */
export interface ProfilingSession {
  metadata: {
    timestamp: string; // ISO timestamp
    gitCommit: string;
    gitCommitShort: string;
    gitBranch: string;
    dirty: boolean;
    sessionDuration: number; // seconds
    sampleCount: number;
  };
  samples: ProfilingSample[];
}

// ---------------------------------------------------------------------------
// ProfilingPersistence
// ---------------------------------------------------------------------------

export class ProfilingPersistence {
  // Configuration
  private readonly sampleIntervalSeconds = 5.0;
  private readonly maxSamplesInMemory = 1000; // ~1.5 hours at 5s intervals
  private readonly topScopesPerSample = 100;

  // State
  private enabled = false;
  private sessionStartTime = 0;
  private elapsedGameTime = 0;
  private timeSinceLastSample = 0;
  private samples: ProfilingSample[] = [];
  private gitInfo: GitVersionInfo;

  constructor() {
    this.gitInfo = getGitVersion();
  }

  /**
   * Start recording profiling samples.
   * Call this when the game/session begins.
   */
  start(): void {
    this.enabled = true;
    this.sessionStartTime = Date.now();
    this.elapsedGameTime = 0;
    this.timeSinceLastSample = 0;
    this.samples = [];
    this.gitInfo = getGitVersion(); // Re-capture in case it changed
  }

  /**
   * Stop recording profiling samples.
   * Call this when the game/session ends.
   */
  stop(): void {
    this.enabled = false;
  }

  /**
   * Update the persistence system.
   * Call this every frame from the render loop.
   *
   * @param dt - Delta time in seconds
   */
  update(dt: number): void {
    if (!this.enabled) return;
    if (!profiler.isEnabled()) return;

    this.elapsedGameTime += dt;
    this.timeSinceLastSample += dt;

    // Sample every N seconds
    if (this.timeSinceLastSample >= this.sampleIntervalSeconds) {
      this.takeSample();
      this.timeSinceLastSample = 0;
    }
  }

  /**
   * Take a profiling sample right now.
   */
  private takeSample(): void {
    const topScopes = profiler.getTopScopes(this.topScopesPerSample);
    const totalFrameMs = profiler.getTotalFrameTime();

    const sample: ProfilingSample = {
      timestamp: Date.now(),
      gameTime: this.elapsedGameTime,
      scopes: topScopes.map((s) => ({
        label: s.label,
        totalMs: s.totalMs,
        callCount: s.callCount,
        avgMs: s.avgMs,
      })),
      totalFrameMs,
    };

    this.samples.push(sample);

    // Trim old samples if we exceed max buffer size (circular buffer behavior)
    if (this.samples.length > this.maxSamplesInMemory) {
      this.samples.shift();
    }
  }

  /**
   * Get the current session data.
   */
  getSession(): ProfilingSession {
    return {
      metadata: {
        timestamp: new Date(this.sessionStartTime).toISOString(),
        gitCommit: this.gitInfo.commit,
        gitCommitShort: this.gitInfo.commitShort,
        gitBranch: this.gitInfo.branch,
        dirty: this.gitInfo.dirty,
        sessionDuration: this.elapsedGameTime,
        sampleCount: this.samples.length,
      },
      samples: this.samples,
    };
  }

  /**
   * Export the current session to the server for disk persistence.
   * Returns true if export succeeded, false otherwise.
   *
   * @param serverUrl - Base URL of the game server (e.g., 'http://localhost:2567')
   */
  async flush(serverUrl = 'http://localhost:2567'): Promise<boolean> {
    if (this.samples.length === 0) {
      return true; // Nothing to export
    }

    try {
      const session = this.getSession();

      const response = await fetch(`${serverUrl}/api/profiling-snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(session),
      });

      if (!response.ok) {
        console.error(
          `[ProfilingPersistence] Server returned ${response.status}: ${response.statusText}`,
        );
        return false;
      }

      const result = await response.json();
      console.log(`[ProfilingPersistence] Exported ${this.samples.length} samples to ${result.filepath}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ProfilingPersistence] Failed to export samples:', message);
      return false;
    }
  }

  /**
   * Download samples as a JSON file (fallback if server unavailable).
   */
  downloadAsFile(): void {
    const session = this.getSession();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const commitSuffix = this.gitInfo.commitShort !== 'unknown' ? `-${this.gitInfo.commitShort}` : '';
    const dirtySuffix = this.gitInfo.dirty ? '-dirty' : '';
    const filename = `profiling-${timestamp}${commitSuffix}${dirtySuffix}.json`;

    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Get current sample count.
   */
  getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Get elapsed game time.
   */
  getElapsedTime(): number {
    return this.elapsedGameTime;
  }

  /**
   * Check if persistence is currently enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Global singleton instance for convenience.
 */
export const profilingPersistence = new ProfilingPersistence();
