/**
 * Debug performance overlay HUD.
 *
 * DOM-based overlay sitting on top of the WebGL canvas.  Shows live
 * FPS, entity count, and bullet count.  Expandable top-10 table
 * with highest/lowest FPS and peak entity/bullet moments.
 * Also shows a CPU function profiler with rolling-average CPU%.
 *
 * Toggle with F4.  ON by default for development/testing.
 */

import { PerformanceTracker, PerfMoment } from '../core/PerformanceTracker';
import type { RendererBackend } from '../rendering/RendererFactory';
import type { PerformanceLogger, PerformanceDataPoint } from '../core/PerformanceLogger';
import { ENEMY_COLORS } from './PerformanceGraphs';
import { profiler, ScopeData } from '../core/PerformanceProfiler';

// ---------------------------------------------------------------------------
// Rolling average for CPU profiler
// ---------------------------------------------------------------------------

/** Tracks a rolling average of scope times over a fixed window of frames. */
interface RollingScope {
  label: string;
  /** Ring buffer of recent totalMs samples. */
  samples: Float64Array;
  sampleIndex: number;
  sampleCount: number;
  /** Cached rolling average (ms). */
  avgMs: number;
  /** Cached CPU% (avgMs / frameWindowMs * 100). */
  cpuPct: number;
}

const ROLLING_WINDOW = 120; // frames (~2s at 60fps)

// ---------------------------------------------------------------------------
// DebugOverlay
// ---------------------------------------------------------------------------

export class DebugOverlay {
  private readonly container: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;

  // Live stat elements
  private readonly fpsEl: HTMLSpanElement;
  private readonly entitiesEl: HTMLSpanElement;
  private readonly bulletsEl: HTMLSpanElement;
  private readonly rendererEl: HTMLSpanElement;
  private readonly speedEl: HTMLSpanElement;
  private readonly geoEl: HTMLSpanElement;
  private readonly texEl: HTMLSpanElement;

  // Latest renderer memory counts (set each frame via setMemoryInfo)
  private memGeo = 0;
  private memTex = 0;

  // Game speed ratio (1.0 = normal, <1.0 = slow)
  private _speedRatio = 1.0;

  // Top-10 panel (expandable)
  private readonly topPanel: HTMLDivElement;
  private readonly topContent: HTMLDivElement;
  private topPanelExpanded = false;

  // Graphs panel (expandable mini-graphs)
  private readonly graphsPanel: HTMLDivElement;
  private readonly unifiedCanvas: HTMLCanvasElement;
  private readonly stackedCanvas: HTMLCanvasElement;
  private graphsPanelExpanded = false;
  private perfLogger: PerformanceLogger | null = null;

  // CPU profiler panel (always-visible, below live stats)
  private readonly profilerPanel: HTMLDivElement;
  private readonly profilerContent: HTMLDivElement;

  // Rolling average state for CPU profiler
  private readonly rollingScopes = new Map<string, RollingScope>();
  private rollingFrameWindowMs = 16.67; // updated each frame from actual dt
  private lastPeriodicLogTime = 0; // performance.now() timestamp of last 8s log
  private static readonly PERIODIC_LOG_INTERVAL_MS = 8000;
  private static readonly PROFILER_LOG_KEY = 'gw_cpu_profiler_log';

  // State
  private visible = true;
  private readonly tracker: PerformanceTracker;
  private readonly keyHandler: (e: KeyboardEvent) => void;

  // Throttle DOM writes (update every 4 frames ~= 15 Hz at 60fps)
  private frameCounter = 0;
  private static readonly UPDATE_EVERY_N_FRAMES = 4;

  constructor(tracker: PerformanceTracker) {
    this.tracker = tracker;

    // -- Style --
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = DebugOverlay.CSS;
    document.head.appendChild(this.styleEl);

    // -- Container --
    this.container = document.createElement('div');
    this.container.id = 'debug-overlay';
    this.container.innerHTML = `
      <div class="debug-live">
        <div class="debug-row">
          <span class="debug-label">REN</span>
          <span class="debug-value" id="debug-renderer" style="color:#8888ff">WebGL2</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">FPS</span>
          <span class="debug-value" id="debug-fps">--</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">ENT</span>
          <span class="debug-value" id="debug-entities">--</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">BUL</span>
          <span class="debug-value" id="debug-bullets">--</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">SPD</span>
          <span class="debug-value" id="debug-speed" style="color:#ffcc00">--</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">GEO</span>
          <span class="debug-value" id="debug-geo" style="color:#aaccff">--</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">TEX</span>
          <span class="debug-value" id="debug-tex" style="color:#aaccff">--</span>
        </div>
        <button class="debug-toggle-graphs" id="debug-toggle-graphs" title="Toggle live performance graphs">GRAPHS</button>
      </div>
      <div class="debug-profiler-panel" id="debug-profiler-panel">
        <div class="debug-profiler-title">CPU PROFILE</div>
        <div class="debug-profiler-content" id="debug-profiler-content">–</div>
      </div>
      <div class="debug-top-panel hidden" id="debug-top-panel">
        <div class="debug-top-content" id="debug-top-content"></div>
      </div>
      <div class="debug-graphs-panel hidden" id="debug-graphs-panel">
        <div class="debug-graphs-subtitle">UNIFIED (FPS / ENT / BUL)</div>
        <canvas id="debug-unified-canvas" width="280" height="100"></canvas>
        <div class="debug-graphs-subtitle">ENEMY COMPOSITION</div>
        <canvas id="debug-stacked-canvas" width="280" height="90"></canvas>
      </div>
    `;
    document.body.appendChild(this.container);

    // Cache element refs
    this.fpsEl = document.getElementById('debug-fps') as HTMLSpanElement;
    this.entitiesEl = document.getElementById('debug-entities') as HTMLSpanElement;
    this.bulletsEl = document.getElementById('debug-bullets') as HTMLSpanElement;
    this.rendererEl = document.getElementById('debug-renderer') as HTMLSpanElement;
    this.speedEl = document.getElementById('debug-speed') as HTMLSpanElement;
    this.geoEl = document.getElementById('debug-geo') as HTMLSpanElement;
    this.texEl = document.getElementById('debug-tex') as HTMLSpanElement;
    this.topPanel = document.getElementById('debug-top-panel') as HTMLDivElement;
    this.topContent = document.getElementById('debug-top-content') as HTMLDivElement;
    this.graphsPanel = document.getElementById('debug-graphs-panel') as HTMLDivElement;
    this.unifiedCanvas = document.getElementById('debug-unified-canvas') as HTMLCanvasElement;
    this.stackedCanvas = document.getElementById('debug-stacked-canvas') as HTMLCanvasElement;
    this.profilerPanel = document.getElementById('debug-profiler-panel') as HTMLDivElement;
    this.profilerContent = document.getElementById('debug-profiler-content') as HTMLDivElement;

    // Graphs toggle button
    const graphsBtn = document.getElementById('debug-toggle-graphs');
    graphsBtn?.addEventListener('click', () => {
      this.graphsPanelExpanded = !this.graphsPanelExpanded;
      if (this.graphsPanelExpanded) {
        this.graphsPanel.classList.remove('hidden');
        this.renderMiniGraphs();
      } else {
        this.graphsPanel.classList.add('hidden');
      }
    });

    // F4 toggle (moved from F3 to avoid Windows Quick Search hotkey conflict on Windows)
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'F4') {
        e.preventDefault();
        this.toggle();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  /**
   * Feed the latest renderer memory counts (call once per frame before update()).
   * Counts come from renderer.info.memory.geometries / .textures.
   */
  setMemoryInfo(geometries: number, textures: number): void {
    this.memGeo = geometries;
    this.memTex = textures;
  }

  /** Set the game speed ratio from GameClock (1.0 = normal, <1.0 = slow). */
  setSpeedRatio(ratio: number): void {
    this._speedRatio = ratio;
  }

  /** Set the renderer backend label (e.g. 'webgpu' or 'webgl2'). */
  setRendererBackend(backend: RendererBackend): void {
    const label = backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
    const color = backend === 'webgpu' ? '#44ff88' : '#8888ff';
    this.rendererEl.textContent = label;
    this.rendererEl.style.color = color;
  }

  /** Provide access to the PerformanceLogger for live mini-graphs. */
  setPerformanceLogger(logger: PerformanceLogger): void {
    this.perfLogger = logger;
  }

  // -- Per-frame update (call from render loop) ----------------------------

  /**
   * Update the overlay. Must be called every frame.
   * @param dtSeconds - frame delta time in seconds (used for rolling CPU% calculation)
   */
  update(dtSeconds?: number): void {
    if (!this.visible) return;

    this.frameCounter++;

    // Update rolling profiler averages every frame (before throttle check)
    const dt = dtSeconds ?? (1 / 60);
    this.updateRollingProfiler(dt);

    // Check periodic profiler logging (every 8 seconds, regardless of frame counter)
    const now = performance.now();
    if (now - this.lastPeriodicLogTime >= DebugOverlay.PERIODIC_LOG_INTERVAL_MS) {
      this.lastPeriodicLogTime = now;
      this.logProfilerSnapshot();
    }

    if (this.frameCounter % DebugOverlay.UPDATE_EVERY_N_FRAMES !== 0) return;

    const fps = this.tracker.fps;
    const entities = this.tracker.entityCount;
    const bullets = this.tracker.bulletCount;

    // Update live stats
    this.fpsEl.textContent = String(Math.round(fps));
    this.entitiesEl.textContent = String(entities);
    this.bulletsEl.textContent = String(bullets);
    this.geoEl.textContent = String(this.memGeo);
    this.texEl.textContent = String(this.memTex);

    // Speed ratio display
    const speedPct = Math.round(this._speedRatio * 100);
    this.speedEl.textContent = `${speedPct}%`;
    if (this._speedRatio >= 0.95) {
      this.speedEl.style.color = '#00ff88';
    } else if (this._speedRatio >= 0.80) {
      this.speedEl.style.color = '#ffaa00';
    } else {
      this.speedEl.style.color = '#ff4444';
    }

    // Color-code FPS
    if (fps >= 55) {
      this.fpsEl.style.color = '#00ff88';
    } else if (fps >= 30) {
      this.fpsEl.style.color = '#ffaa00';
    } else {
      this.fpsEl.style.color = '#ff4444';
    }

    // Update CPU profiler panel (every update cycle ~15Hz)
    this.renderProfilerPanel();

    // Update top panel if expanded (less frequently -- every 2nd update)
    if (this.topPanelExpanded && this.frameCounter % (DebugOverlay.UPDATE_EVERY_N_FRAMES * 8) === 0) {
      this.renderTopPanel();
    }

    // Update mini graphs if expanded (every ~4 seconds at 15Hz update rate)
    if (this.graphsPanelExpanded && this.frameCounter % (DebugOverlay.UPDATE_EVERY_N_FRAMES * 60) === 0) {
      this.renderMiniGraphs();
    }
  }

  // -- Rolling profiler helpers --------------------------------------------

  /**
   * Update rolling averages for all active scopes this frame.
   * Must be called every frame AFTER profiler.getFrameData() has been called
   * by the game loop (and before profiler.reset()).
   */
  private updateRollingProfiler(dtSeconds: number): void {
    // Use exponential moving average on the frame window duration
    const frameMs = dtSeconds * 1000;
    this.rollingFrameWindowMs = this.rollingFrameWindowMs * 0.95 + frameMs * 0.05;

    const frameData = profiler.getFrameData();
    const totalTrackedMs = this.rollingFrameWindowMs;

    for (const scope of frameData) {
      let rs = this.rollingScopes.get(scope.label);
      if (!rs) {
        rs = {
          label: scope.label,
          samples: new Float64Array(ROLLING_WINDOW),
          sampleIndex: 0,
          sampleCount: 0,
          avgMs: 0,
          cpuPct: 0,
        };
        this.rollingScopes.set(scope.label, rs);
      }

      // Write new sample into ring buffer
      rs.samples[rs.sampleIndex] = scope.totalMs;
      rs.sampleIndex = (rs.sampleIndex + 1) % ROLLING_WINDOW;
      if (rs.sampleCount < ROLLING_WINDOW) rs.sampleCount++;

      // Compute rolling average
      let sum = 0;
      for (let i = 0; i < rs.sampleCount; i++) {
        sum += rs.samples[i];
      }
      rs.avgMs = sum / rs.sampleCount;
      rs.cpuPct = totalTrackedMs > 0 ? (rs.avgMs / totalTrackedMs) * 100 : 0;
    }

    // Zero-out scopes that got no data this frame (they're still in map but inactive)
    for (const [label, rs] of this.rollingScopes) {
      const hasFrameData = frameData.some(s => s.label === label);
      if (!hasFrameData) {
        // Push a zero sample so average decays toward 0 over time
        rs.samples[rs.sampleIndex] = 0;
        rs.sampleIndex = (rs.sampleIndex + 1) % ROLLING_WINDOW;
        if (rs.sampleCount < ROLLING_WINDOW) rs.sampleCount++;
        let sum = 0;
        for (let i = 0; i < rs.sampleCount; i++) sum += rs.samples[i];
        rs.avgMs = sum / rs.sampleCount;
        rs.cpuPct = totalTrackedMs > 0 ? (rs.avgMs / totalTrackedMs) * 100 : 0;
      }
    }
  }

  /**
   * Render the always-visible CPU profiler panel with rolling averages.
   */
  private renderProfilerPanel(): void {
    if (this.rollingScopes.size === 0) {
      this.profilerContent.textContent = 'No data';
      return;
    }

    // Sort by rolling avgMs descending, take top 8
    const sorted = Array.from(this.rollingScopes.values())
      .filter(rs => rs.avgMs > 0.01)
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 8);

    if (sorted.length === 0) {
      this.profilerContent.textContent = 'No data';
      return;
    }

    let html = '<table class="debug-profiler-table">';
    for (const rs of sorted) {
      const pct = rs.cpuPct.toFixed(1);
      const ms = rs.avgMs.toFixed(2);
      const barWidth = Math.min(100, rs.cpuPct).toFixed(1);
      const color = rs.cpuPct > 20 ? '#ff4444' : rs.cpuPct > 10 ? '#ffaa00' : '#44aaff';
      const shortLabel = rs.label.length > 22 ? rs.label.slice(0, 20) + '…' : rs.label;
      html += `<tr title="${rs.label}">` +
        `<td class="debug-pf-name">${shortLabel}</td>` +
        `<td class="debug-pf-bar"><div class="debug-pf-bar-fill" style="width:${barWidth}%;background:${color}"></div></td>` +
        `<td class="debug-pf-pct" style="color:${color}">${pct}%</td>` +
        `<td class="debug-pf-ms">${ms}ms</td>` +
        '</tr>';
    }
    html += '</table>';
    this.profilerContent.innerHTML = html;
  }

  /**
   * Log a profiler snapshot to localStorage every 8 seconds.
   * Captures: timestamp, entity count, function CPU% and ms.
   * Useful for correlating "at X entities, function Y takes Z% CPU".
   */
  private logProfilerSnapshot(): void {
    const sorted = Array.from(this.rollingScopes.values())
      .filter(rs => rs.avgMs > 0.01)
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 15);

    if (sorted.length === 0) return;

    const snapshot = {
      ts: Date.now(),
      fps: Math.round(this.tracker.fps),
      entities: this.tracker.entityCount,
      bullets: this.tracker.bulletCount,
      frameMs: Math.round(this.rollingFrameWindowMs * 10) / 10,
      scopes: sorted.map(rs => ({
        fn: rs.label,
        pct: Math.round(rs.cpuPct * 10) / 10,
        ms: Math.round(rs.avgMs * 100) / 100,
      })),
    };

    try {
      const raw = localStorage.getItem(DebugOverlay.PROFILER_LOG_KEY);
      const log: typeof snapshot[] = raw ? JSON.parse(raw) : [];
      log.push(snapshot);
      // Keep last 500 snapshots (~66 minutes at 8s intervals)
      if (log.length > 500) log.splice(0, log.length - 500);
      localStorage.setItem(DebugOverlay.PROFILER_LOG_KEY, JSON.stringify(log));
    } catch {
      // localStorage full or unavailable — silently ignore
    }
  }

  // -- Visibility ----------------------------------------------------------

  toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
  }

  show(): void {
    this.visible = true;
    this.container.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  // -- Summary for external consumers (pause menu, end screen) -------------

  /** Returns an HTML string summarizing performance for embedding in other UI. */
  getSummaryHTML(): string {
    const s = this.tracker.getSummary();
    return `
      <div style="text-align:left;font-family:monospace;font-size:13px;color:#aaccff;line-height:1.6;">
        <div><span style="color:#668899;">Map:</span> <span style="color:#00ffff;">${s.mapType}</span></div>
        <div><span style="color:#668899;">Duration:</span> ${this.formatDuration(s.durationSeconds)}</div>
        <div><span style="color:#668899;">Avg FPS:</span> <span style="${this.fpsColorStyle(s.avgFps)}">${s.avgFps.toFixed(1)}</span></div>
        <div><span style="color:#668899;">Min FPS:</span> <span style="${this.fpsColorStyle(s.minFps)}">${s.minFps.toFixed(1)}</span></div>
        <div><span style="color:#668899;">Max FPS:</span> <span style="${this.fpsColorStyle(s.maxFps)}">${s.maxFps.toFixed(1)}</span></div>
        <div><span style="color:#668899;">Peak Enemies:</span> <span style="color:#ff8844;">${s.peakEntities}</span></div>
        <div><span style="color:#668899;">Peak Bullets:</span> <span style="color:#44aaff;">${s.peakBullets}</span></div>
      </div>
    `;
  }

  // -- Cleanup -------------------------------------------------------------

  dispose(): void {
    document.removeEventListener('keydown', this.keyHandler);
    this.container.remove();
    this.styleEl.remove();
  }

  // -- Internal rendering --------------------------------------------------

  private renderMiniGraphs(): void {
    const data = this.perfLogger ? this.perfLogger.getDataPoints() : [];

    // -- Unified canvas (FPS / ENT / BUL normalized) --
    {
      const canvas = this.unifiedCanvas;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const W = canvas.width;
        const H = canvas.height;
        const pad = { top: 8, right: 6, bottom: 18, left: 28 };
        const pw = W - pad.left - pad.right;
        const ph = H - pad.top - pad.bottom;

        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, W, H);

        if (data.length < 2) {
          ctx.fillStyle = '#445566';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('No data', W / 2, H / 2);
        } else {
          // Compute maxes for normalization
          let maxFps = 1, maxEnemies = 1, maxBullets = 1;
          for (const p of data) {
            if (p.fps > maxFps) maxFps = p.fps;
            if (p.enemyCount > maxEnemies) maxEnemies = p.enemyCount;
            if (p.bulletCount > maxBullets) maxBullets = p.bulletCount;
          }

          const minTime = data[0].time;
          const maxTime = data[data.length - 1].time;
          const timeRange = Math.max(maxTime - minTime, 0.001);

          const tx = (t: number) => pad.left + ((t - minTime) / timeRange) * pw;
          const ty = (v: number) => pad.top + ph * (1 - Math.min(1, Math.max(0, v)));

          // Grid line at 50%
          ctx.strokeStyle = '#1a1a2e';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pad.left, pad.top + ph / 2);
          ctx.lineTo(pad.left + pw, pad.top + ph / 2);
          ctx.stroke();

          // Axes
          ctx.strokeStyle = '#3a3a5e';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pad.left, pad.top);
          ctx.lineTo(pad.left, pad.top + ph);
          ctx.lineTo(pad.left + pw, pad.top + ph);
          ctx.stroke();

          // Y labels
          ctx.fillStyle = '#556677';
          ctx.font = '8px monospace';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText('100%', pad.left - 2, pad.top);
          ctx.fillText('0%', pad.left - 2, pad.top + ph);

          // Draw lines (FPS=green, ENT=orange, BUL=blue)
          const lines: Array<{ color: string; getValue: (p: { fps: number; enemyCount: number; bulletCount: number }) => number; max: number }> = [
            { color: '#00ff88', getValue: p => p.fps, max: maxFps },
            { color: '#ff6644', getValue: p => p.enemyCount, max: maxEnemies },
            { color: '#44aaff', getValue: p => p.bulletCount, max: maxBullets },
          ];

          for (const line of lines) {
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
              const x = tx(data[i].time);
              const y = ty(line.getValue(data[i]) / line.max);
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }

          // Legend (bottom row)
          const legendItems = [
            { color: '#00ff88', label: 'FPS' },
            { color: '#ff6644', label: 'ENT' },
            { color: '#44aaff', label: 'BUL' },
          ];
          ctx.font = '8px monospace';
          ctx.textBaseline = 'bottom';
          let lx = pad.left;
          for (const item of legendItems) {
            ctx.fillStyle = item.color;
            ctx.fillRect(lx, H - 1, 6, -6);
            ctx.fillStyle = '#88aacc';
            ctx.textAlign = 'left';
            ctx.fillText(item.label, lx + 8, H - 1);
            lx += 36;
          }
        }
      }
    }

    // -- Stacked canvas (enemy composition) --
    {
      const canvas = this.stackedCanvas;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const W = canvas.width;
        const H = canvas.height;
        const pad = { top: 6, right: 6, bottom: 14, left: 28 };
        const pw = W - pad.left - pad.right;
        const ph = H - pad.top - pad.bottom;

        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, W, H);

        if (data.length < 2) {
          ctx.fillStyle = '#445566';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('No data', W / 2, H / 2);
        } else {
          // Collect enemy types
          const typeTotals = new Map<string, number>();
          for (const point of data) {
            point.enemyTypes.forEach((count, type) => {
              typeTotals.set(type, (typeTotals.get(type) || 0) + count);
            });
          }

          const sortedTypes = Array.from(typeTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([type]) => type);

          // Max cumulative enemy count
          let maxTotal = 1;
          for (const point of data) {
            let total = 0;
            point.enemyTypes.forEach(c => { total += c; });
            if (total > maxTotal) maxTotal = total;
          }
          if (maxTotal < 1) maxTotal = 1;

          const minTime = data[0].time;
          const maxTime = data[data.length - 1].time;
          const timeRange = Math.max(maxTime - minTime, 0.001);

          const tx = (t: number) => pad.left + ((t - minTime) / timeRange) * pw;
          const ty = (v: number) => pad.top + ph * (1 - Math.min(1, Math.max(0, v / maxTotal)));

          // Axes
          ctx.strokeStyle = '#3a3a5e';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pad.left, pad.top);
          ctx.lineTo(pad.left, pad.top + ph);
          ctx.lineTo(pad.left + pw, pad.top + ph);
          ctx.stroke();

          if (sortedTypes.length === 0) {
            // No type data — draw total enemy line
            ctx.strokeStyle = '#ff6644';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
              const x = tx(data[i].time);
              const y = ty(data[i].enemyCount);
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          } else {
            // Draw stacked bands
            for (let ti = 0; ti < sortedTypes.length; ti++) {
              const type = sortedTypes[ti];
              const color = ENEMY_COLORS[type] || '#888888';

              ctx.beginPath();
              // Forward: top edge
              for (let i = 0; i < data.length; i++) {
                const point = data[i];
                const x = tx(point.time);
                let cumTop = 0;
                for (let k = 0; k <= ti; k++) {
                  cumTop += point.enemyTypes.get(sortedTypes[k] as any) || 0;
                }
                const y = ty(cumTop);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
              }
              // Backward: bottom edge
              for (let i = data.length - 1; i >= 0; i--) {
                const point = data[i];
                const x = tx(point.time);
                let cumBottom = 0;
                for (let k = 0; k < ti; k++) {
                  cumBottom += point.enemyTypes.get(sortedTypes[k] as any) || 0;
                }
                ctx.lineTo(x, ty(cumBottom));
              }
              ctx.closePath();
              ctx.fillStyle = color + 'aa';
              ctx.fill();
            }
          }

          // Y label
          ctx.fillStyle = '#556677';
          ctx.font = '8px monospace';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText(String(maxTotal), pad.left - 2, pad.top);
          ctx.textBaseline = 'bottom';
          ctx.fillText('0', pad.left - 2, pad.top + ph);
        }
      }
    }
  }

  private renderTopPanel(): void {
    const sections = [
      { title: 'HIGHEST FPS', data: this.tracker.highestFps, highlight: 'fps' },
      { title: 'LOWEST FPS', data: this.tracker.lowestFps, highlight: 'fps' },
      { title: 'MOST ENEMIES', data: this.tracker.highestEntities, highlight: 'entities' },
      { title: 'MOST BULLETS', data: this.tracker.highestBullets, highlight: 'bullets' },
    ];

    let html = '';
    for (const section of sections) {
      html += `<div class="debug-top-section">`;
      html += `<div class="debug-top-title">${section.title}</div>`;
      if (section.data.length === 0) {
        html += `<div class="debug-top-empty">No data yet</div>`;
      } else {
        html += `<table class="debug-top-table"><thead><tr>`;
        html += `<th>#</th><th>Time</th><th>FPS</th><th>ENT</th><th>BUL</th>`;
        html += `</tr></thead><tbody>`;
        for (let i = 0; i < section.data.length; i++) {
          const m = section.data[i];
          html += this.renderMomentRow(i + 1, m, section.highlight);
        }
        html += `</tbody></table>`;
      }
      html += `</div>`;
    }

    // Add TOP FUNCTIONS section
    html += this.renderTopFunctionsSection();

    this.topContent.innerHTML = html;
  }

  private renderTopFunctionsSection(): string {
    const topScopes = profiler.getTopScopes(10);
    let html = `<div class="debug-top-section">`;
    html += `<div class="debug-top-title">TOP 10 FUNCTIONS</div>`;

    if (topScopes.length === 0) {
      html += `<div class="debug-top-empty">No profiling data yet</div>`;
    } else {
      html += `<table class="debug-top-table"><thead><tr>`;
      html += `<th>#</th><th>Function</th><th>Time (ms)</th><th>Calls</th><th>Avg (ms)</th>`;
      html += `</tr></thead><tbody>`;

      for (let i = 0; i < topScopes.length; i++) {
        const scope = topScopes[i];
        html += `<tr>`;
        html += `<td class="debug-rank">${i + 1}</td>`;
        html += `<td class="debug-function-name" title="${scope.label}">${scope.label}</td>`;
        html += `<td class="debug-function-time">${scope.totalMs.toFixed(2)}</td>`;
        html += `<td class="debug-function-calls">${scope.callCount}</td>`;
        html += `<td class="debug-function-avg">${scope.avgMs.toFixed(2)}</td>`;
        html += `</tr>`;
      }

      html += `</tbody></table>`;
    }

    html += `</div>`;
    return html;
  }

  private renderMomentRow(rank: number, m: PerfMoment, highlight: string): string {
    const fpsClass = highlight === 'fps' ? ' debug-highlight' : '';
    const entClass = highlight === 'enemies' ? ' debug-highlight' : '';
    const bulClass = highlight === 'bullets' ? ' debug-highlight' : '';

    // Build enemy type breakdown tooltip
    let enemyBreakdown = '';
    if (m.enemyTypes && m.enemyTypes.size > 0) {
      const types = Array.from(m.enemyTypes.entries())
        .sort((a, b) => b[1] - a[1]) // Sort by count descending
        .slice(0, 5) // Top 5 enemy types
        .map(([type, count]) => `${type}: ${count}`)
        .join(', ');
      enemyBreakdown = ` title="${types}"`;
    }

    return `<tr>
      <td class="debug-rank">${rank}</td>
      <td class="debug-time">${m.timeLabel}</td>
      <td class="debug-fps-cell${fpsClass}">${m.fps.toFixed(1)}</td>
      <td class="debug-ent-cell${entClass}"${enemyBreakdown}>${m.entityCount}</td>
      <td class="debug-bul-cell${bulClass}">${m.bulletCount}</td>
    </tr>`;
  }

  private fpsColorStyle(fps: number): string {
    if (fps >= 55) return 'color:#00ff88;';
    if (fps >= 30) return 'color:#ffaa00;';
    return 'color:#ff4444;';
  }

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // -- CSS -----------------------------------------------------------------

  private static readonly CSS = `
    #debug-overlay {
      position: fixed;
      top: 120px;
      left: 10px;
      z-index: 900;
      pointer-events: none;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.4;
      user-select: none;
    }

    #debug-overlay .debug-live {
      background: rgba(0, 0, 15, 0.7);
      border: 1px solid rgba(60, 80, 120, 0.5);
      border-radius: 4px;
      padding: 6px 10px;
      pointer-events: auto;
    }

    #debug-overlay .debug-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    #debug-overlay .debug-label {
      color: #668899;
      font-weight: bold;
      letter-spacing: 1px;
    }

    #debug-overlay .debug-value {
      color: #00ff88;
      font-weight: bold;
      min-width: 40px;
      text-align: right;
    }

    #debug-overlay .debug-toggle-graphs {
      display: block;
      width: 100%;
      margin-top: 4px;
      padding: 3px 0;
      background: rgba(40, 60, 100, 0.5);
      border: 1px solid rgba(60, 100, 160, 0.4);
      border-radius: 3px;
      color: #6688aa;
      font-family: inherit;
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 2px;
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.15s;
    }

    #debug-overlay .debug-toggle-graphs:hover {
      background: rgba(40, 60, 100, 0.8);
      color: #88aacc;
    }

    /* CPU Profiler panel (always-visible, below live stats) */
    #debug-overlay .debug-profiler-panel {
      margin-top: 4px;
      background: rgba(0, 0, 20, 0.75);
      border: 1px solid rgba(40, 60, 100, 0.5);
      border-radius: 4px;
      padding: 5px 8px;
      pointer-events: none;
      min-width: 200px;
    }

    #debug-overlay .debug-profiler-title {
      color: #4466aa;
      font-size: 9px;
      font-weight: bold;
      letter-spacing: 2px;
      margin-bottom: 3px;
    }

    #debug-overlay .debug-profiler-content {
      color: #556677;
      font-size: 10px;
    }

    #debug-overlay .debug-profiler-table {
      width: 100%;
      border-collapse: collapse;
    }

    #debug-overlay .debug-pf-name {
      color: #7799bb;
      font-size: 9px;
      text-align: left;
      padding: 1px 2px 1px 0;
      max-width: 110px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #debug-overlay .debug-pf-bar {
      width: 60px;
      background: rgba(255,255,255,0.05);
      height: 5px;
      border-radius: 2px;
      overflow: hidden;
      vertical-align: middle;
      padding: 0 3px;
    }

    #debug-overlay .debug-pf-bar-fill {
      height: 5px;
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    #debug-overlay .debug-pf-pct {
      font-size: 9px;
      text-align: right;
      padding: 1px 3px;
      font-weight: bold;
      min-width: 34px;
    }

    #debug-overlay .debug-pf-ms {
      font-size: 9px;
      color: #556677;
      text-align: right;
      padding: 1px 0;
      min-width: 38px;
    }

    #debug-overlay .debug-top-panel {
      margin-top: 4px;
      background: rgba(0, 0, 15, 0.85);
      border: 1px solid rgba(60, 80, 120, 0.5);
      border-radius: 4px;
      padding: 8px 10px;
      max-height: 420px;
      overflow-y: auto;
      pointer-events: auto;
    }

    #debug-overlay .debug-top-panel.hidden {
      display: none;
    }

    #debug-overlay .debug-top-section {
      margin-bottom: 10px;
    }

    #debug-overlay .debug-top-section:last-child {
      margin-bottom: 0;
    }

    #debug-overlay .debug-top-title {
      color: #88aacc;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 2px;
      margin-bottom: 3px;
      border-bottom: 1px solid rgba(60, 80, 120, 0.3);
      padding-bottom: 2px;
    }

    #debug-overlay .debug-top-empty {
      color: #445566;
      font-size: 11px;
      font-style: italic;
    }

    #debug-overlay .debug-top-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    #debug-overlay .debug-top-table th {
      color: #556677;
      font-weight: bold;
      text-align: right;
      padding: 1px 4px;
      font-size: 10px;
    }

    #debug-overlay .debug-top-table th:first-child {
      text-align: left;
    }

    #debug-overlay .debug-top-table td {
      color: #88aaaa;
      text-align: right;
      padding: 1px 4px;
    }

    #debug-overlay .debug-rank {
      color: #445566;
      text-align: left !important;
    }

    #debug-overlay .debug-time {
      color: #668888;
    }

    #debug-overlay .debug-highlight {
      color: #ffdd44 !important;
      font-weight: bold;
    }

    #debug-overlay .debug-fps-cell {
      color: #00cc66;
    }

    #debug-overlay .debug-ent-cell {
      color: #ff8844;
    }

    #debug-overlay .debug-bul-cell {
      color: #44aaff;
    }

    /* Function profiling styles */
    #debug-overlay .debug-function-name {
      color: #88ccff;
      text-align: left !important;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #debug-overlay .debug-function-time {
      color: #ffaa44;
    }

    #debug-overlay .debug-function-calls {
      color: #88ff88;
    }

    #debug-overlay .debug-function-avg {
      color: #ffaa88;
    }

    /* Scrollbar styling for top panel */
    #debug-overlay .debug-top-panel::-webkit-scrollbar {
      width: 4px;
    }
    #debug-overlay .debug-top-panel::-webkit-scrollbar-track {
      background: transparent;
    }
    #debug-overlay .debug-top-panel::-webkit-scrollbar-thumb {
      background: rgba(60, 80, 120, 0.5);
      border-radius: 2px;
    }

    /* --- Mobile compact mode (≤ 500px wide) --- */
    @media (max-width: 500px) {
      #debug-overlay {
        top: 4px;
        left: auto;
        right: 4px;
        font-size: 10px;
        line-height: 1.3;
      }

      #debug-overlay .debug-live {
        display: flex;
        flex-direction: row;
        gap: 6px;
        align-items: center;
        padding: 3px 6px;
      }

      /* Layout each row inline instead of stacked */
      #debug-overlay .debug-row {
        display: flex;
        gap: 3px;
        align-items: center;
      }

      /* Hide BUL (4th), GEO (5th), TEX (6th) rows — keep only REN, FPS, ENT */
      #debug-overlay .debug-live .debug-row:nth-child(n+4) {
        display: none;
      }

      /* Hide the expanded top panel and profiler on mobile */
      #debug-overlay .debug-top-panel,
      #debug-overlay .debug-profiler-panel {
        display: none !important;
      }

      #debug-overlay .debug-label {
        font-size: 9px;
        letter-spacing: 0;
      }

      #debug-overlay .debug-value {
        min-width: 24px;
        font-size: 10px;
      }
    }
  `;
}
