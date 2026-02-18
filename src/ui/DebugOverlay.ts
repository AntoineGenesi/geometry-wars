/**
 * Debug performance overlay HUD.
 *
 * DOM-based overlay sitting on top of the WebGL canvas.  Shows live
 * FPS, entity count, and bullet count.  Expandable top-10 table
 * with highest/lowest FPS and peak entity/bullet moments.
 *
 * Toggle with F3.  ON by default for development/testing.
 */

import { PerformanceTracker, PerfMoment } from '../core/PerformanceTracker';
import type { RendererBackend } from '../rendering/RendererFactory';

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
  private readonly geoEl: HTMLSpanElement;
  private readonly texEl: HTMLSpanElement;

  // Latest renderer memory counts (set each frame via setMemoryInfo)
  private memGeo = 0;
  private memTex = 0;

  // Top-10 panel (expandable)
  private readonly topPanel: HTMLDivElement;
  private readonly topContent: HTMLDivElement;
  private topPanelExpanded = false;

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
          <span class="debug-label">GEO</span>
          <span class="debug-value" id="debug-geo" style="color:#aaccff">--</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">TEX</span>
          <span class="debug-value" id="debug-tex" style="color:#aaccff">--</span>
        </div>
        <button class="debug-toggle-top" id="debug-toggle-top" title="Toggle top-10 moments">TOP 10</button>
        <button class="debug-export-logs" id="debug-export-logs" title="Export performance logs to disk">EXPORT</button>
      </div>
      <div class="debug-top-panel hidden" id="debug-top-panel">
        <div class="debug-top-content" id="debug-top-content"></div>
      </div>
    `;
    document.body.appendChild(this.container);

    // Cache element refs
    this.fpsEl = document.getElementById('debug-fps') as HTMLSpanElement;
    this.entitiesEl = document.getElementById('debug-entities') as HTMLSpanElement;
    this.bulletsEl = document.getElementById('debug-bullets') as HTMLSpanElement;
    this.rendererEl = document.getElementById('debug-renderer') as HTMLSpanElement;
    this.geoEl = document.getElementById('debug-geo') as HTMLSpanElement;
    this.texEl = document.getElementById('debug-tex') as HTMLSpanElement;
    this.topPanel = document.getElementById('debug-top-panel') as HTMLDivElement;
    this.topContent = document.getElementById('debug-top-content') as HTMLDivElement;

    // Top-10 toggle button
    const toggleBtn = document.getElementById('debug-toggle-top');
    toggleBtn?.addEventListener('click', () => {
      this.topPanelExpanded = !this.topPanelExpanded;
      if (this.topPanelExpanded) {
        this.topPanel.classList.remove('hidden');
        this.renderTopPanel();
      } else {
        this.topPanel.classList.add('hidden');
      }
    });

    // Export logs button
    const exportBtn = document.getElementById('debug-export-logs');
    exportBtn?.addEventListener('click', async () => {
      try {
        // Dynamic import to avoid bundling in production if not needed
        const { exportLogsToServer, downloadLogsAsFiles } = await import('../utils/PerformanceExporter');

        // Try server export first
        const serverUrl = process.env.NODE_ENV === 'production'
          ? window.location.origin
          : 'http://localhost:2567';

        exportBtn.textContent = 'EXPORTING...';
        exportBtn.setAttribute('disabled', 'true');

        const result = await exportLogsToServer(serverUrl, true, true);

        if (result.success) {
          exportBtn.textContent = 'EXPORTED ✓';
          console.log('[DebugOverlay] Logs exported to disk:', result.results);
        } else {
          // Fallback to browser download
          console.warn('[DebugOverlay] Server export failed, downloading files instead');
          downloadLogsAsFiles(true, true);
          exportBtn.textContent = 'DOWNLOADED ✓';
        }

        // Reset button after 2 seconds
        setTimeout(() => {
          exportBtn.textContent = 'EXPORT';
          exportBtn.removeAttribute('disabled');
        }, 2000);
      } catch (err) {
        console.error('[DebugOverlay] Export error:', err);
        exportBtn.textContent = 'ERROR';
        setTimeout(() => {
          exportBtn.textContent = 'EXPORT';
          exportBtn.removeAttribute('disabled');
        }, 2000);
      }
    });

    // F3 toggle
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
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

  /** Set the renderer backend label (e.g. 'webgpu' or 'webgl2'). */
  setRendererBackend(backend: RendererBackend): void {
    const label = backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
    const color = backend === 'webgpu' ? '#44ff88' : '#8888ff';
    this.rendererEl.textContent = label;
    this.rendererEl.style.color = color;
  }

  // -- Per-frame update (call from render loop) ----------------------------

  update(): void {
    if (!this.visible) return;

    this.frameCounter++;
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

    // Color-code FPS
    if (fps >= 55) {
      this.fpsEl.style.color = '#00ff88';
    } else if (fps >= 30) {
      this.fpsEl.style.color = '#ffaa00';
    } else {
      this.fpsEl.style.color = '#ff4444';
    }

    // Update top panel if expanded (less frequently -- every 2nd update)
    if (this.topPanelExpanded && this.frameCounter % (DebugOverlay.UPDATE_EVERY_N_FRAMES * 8) === 0) {
      this.renderTopPanel();
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

    this.topContent.innerHTML = html;
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

    #debug-overlay .debug-toggle-top {
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

    #debug-overlay .debug-toggle-top:hover {
      background: rgba(40, 60, 100, 0.8);
      color: #88aacc;
    }

    #debug-overlay .debug-export-logs {
      display: block;
      width: 100%;
      margin-top: 4px;
      padding: 3px 0;
      background: rgba(40, 100, 60, 0.5);
      border: 1px solid rgba(60, 120, 80, 0.5);
      border-radius: 3px;
      color: #aaccaa;
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 1px;
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.15s;
    }

    #debug-overlay .debug-export-logs:hover {
      background: rgba(40, 100, 60, 0.8);
      color: #88cc88;
    }

    #debug-overlay .debug-export-logs:disabled {
      cursor: not-allowed;
      opacity: 0.6;
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
  `;
}
