/**
 * ProfilingOverlay — Real-time performance profiling HUD.
 *
 * DOM-based overlay showing top CPU consumers sorted by time.
 * Displays frame time, percentage of frame budget, and visual bars.
 *
 * Toggle with F5.
 */

import { profiler, ScopeData } from '../core/PerformanceProfiler';

// ---------------------------------------------------------------------------
// ProfilingOverlay
// ---------------------------------------------------------------------------

export class ProfilingOverlay {
  private readonly container: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;

  // UI elements
  private readonly headerEl: HTMLDivElement;
  private readonly frameBudgetEl: HTMLDivElement;
  private readonly scopeListEl: HTMLDivElement;
  private readonly toggleProfilingBtn: HTMLButtonElement;

  // State
  private visible = false;
  private readonly keyHandler: (e: KeyboardEvent) => void;

  // Throttle DOM updates (every 5 frames ~= 12 Hz at 60fps)
  private frameCounter = 0;
  private static readonly UPDATE_EVERY_N_FRAMES = 5;

  // Frame budget for 60fps (ms)
  private static readonly FRAME_BUDGET_60FPS = 16.67;

  constructor() {
    // -- Style --
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = ProfilingOverlay.CSS;
    document.head.appendChild(this.styleEl);

    // -- Container --
    this.container = document.createElement('div');
    this.container.id = 'profiling-overlay';
    this.container.innerHTML = `
      <div class="profiling-header">
        <span class="profiling-title">PERFORMANCE PROFILER</span>
        <span class="profiling-hotkey">[F5]</span>
      </div>
      <div class="profiling-frame-budget" id="profiling-frame-budget">
        Frame: <span class="profiling-frame-time">--</span> / 16.67ms
        (<span class="profiling-frame-percent">--</span>)
      </div>
      <div class="profiling-divider"></div>
      <div class="profiling-scope-list" id="profiling-scope-list">
        <div class="profiling-empty">No profiling data yet</div>
      </div>
      <button class="profiling-toggle-btn" id="profiling-toggle-btn">
        Profiling: <span id="profiling-status">ON</span>
      </button>
    `;
    document.body.appendChild(this.container);

    // Cache element refs
    this.headerEl = this.container.querySelector('.profiling-header') as HTMLDivElement;
    this.frameBudgetEl = document.getElementById('profiling-frame-budget') as HTMLDivElement;
    this.scopeListEl = document.getElementById('profiling-scope-list') as HTMLDivElement;
    this.toggleProfilingBtn = document.getElementById('profiling-toggle-btn') as HTMLButtonElement;

    // Toggle profiling ON/OFF button
    this.toggleProfilingBtn.addEventListener('click', () => {
      const currentState = profiler.isEnabled();
      profiler.setEnabled(!currentState);
      this.updateProfilingStatus();
    });

    // F5 toggle (moved from F4 to avoid conflict with debug menu)
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        this.toggle();
      }
    };
    document.addEventListener('keydown', this.keyHandler);

    // Start hidden
    this.hide();
  }

  // -- Per-frame update (call from render loop) ----------------------------

  update(): void {
    if (!this.visible) return;

    this.frameCounter++;
    if (this.frameCounter % ProfilingOverlay.UPDATE_EVERY_N_FRAMES !== 0) return;

    // Get profiling data
    const topScopes = profiler.getTopScopes(8);
    const totalFrameTime = profiler.getTotalFrameTime();

    // Update frame budget display
    this.updateFrameBudget(totalFrameTime);

    // Update scope list
    this.updateScopeList(topScopes, totalFrameTime);

    // Update profiling status
    this.updateProfilingStatus();
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

  setVisible(visible: boolean): void {
    if (visible) {
      this.show();
    } else {
      this.hide();
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  // -- Cleanup -------------------------------------------------------------

  dispose(): void {
    document.removeEventListener('keydown', this.keyHandler);
    this.container.remove();
    this.styleEl.remove();
  }

  // -- Internal rendering --------------------------------------------------

  private updateFrameBudget(totalFrameTime: number): void {
    const frameTimeEl = this.frameBudgetEl.querySelector('.profiling-frame-time') as HTMLSpanElement;
    const framePercentEl = this.frameBudgetEl.querySelector('.profiling-frame-percent') as HTMLSpanElement;

    if (!frameTimeEl || !framePercentEl) return;

    const framePercent = (totalFrameTime / ProfilingOverlay.FRAME_BUDGET_60FPS) * 100;

    frameTimeEl.textContent = totalFrameTime.toFixed(2) + 'ms';
    framePercentEl.textContent = framePercent.toFixed(0) + '% budget';

    // Color-code based on budget usage
    if (framePercent <= 80) {
      frameTimeEl.style.color = '#00ff88'; // Green
    } else if (framePercent <= 100) {
      frameTimeEl.style.color = '#ffaa00'; // Orange
    } else {
      frameTimeEl.style.color = '#ff4444'; // Red
    }
  }

  private updateScopeList(scopes: ReadonlyArray<ScopeData>, totalFrameTime: number): void {
    if (scopes.length === 0) {
      this.scopeListEl.innerHTML = '<div class="profiling-empty">No profiling data yet</div>';
      return;
    }

    let html = '';
    for (const scope of scopes) {
      const percent = totalFrameTime > 0 ? (scope.totalMs / totalFrameTime) * 100 : 0;
      const barWidth = Math.min(percent, 100); // Cap at 100%
      const bar = this.renderBar(barWidth);

      html += `
        <div class="profiling-scope-row">
          <span class="profiling-scope-label">${scope.label}</span>
          <span class="profiling-scope-time">${scope.totalMs.toFixed(2)}ms</span>
          <span class="profiling-scope-percent">${percent.toFixed(0)}%</span>
          <span class="profiling-scope-bar">${bar}</span>
        </div>
      `;
    }

    this.scopeListEl.innerHTML = html;
  }

  private updateProfilingStatus(): void {
    const statusEl = document.getElementById('profiling-status');
    if (!statusEl) return;

    const enabled = profiler.isEnabled();
    statusEl.textContent = enabled ? 'ON' : 'OFF';
    statusEl.style.color = enabled ? '#00ff88' : '#ff4444';
  }

  /**
   * Render a visual bar using Unicode block characters.
   * Width is a percentage (0-100).
   */
  private renderBar(widthPercent: number): string {
    const maxBlocks = 20; // Max bar width in characters
    const blocks = Math.floor((widthPercent / 100) * maxBlocks);
    const fraction = ((widthPercent / 100) * maxBlocks) % 1;

    // Unicode block characters (eighths)
    const fullBlock = '█';
    const partialBlocks = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
    const partialIndex = Math.floor(fraction * 8);

    let bar = fullBlock.repeat(blocks);
    if (partialIndex > 0 && blocks < maxBlocks) {
      bar += partialBlocks[partialIndex];
    }

    return bar;
  }

  // -- CSS -----------------------------------------------------------------

  private static readonly CSS = `
    #profiling-overlay {
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 900;
      pointer-events: none;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.4;
      user-select: none;
      width: 420px;
    }

    #profiling-overlay > * {
      pointer-events: auto;
    }

    #profiling-overlay .profiling-header {
      background: rgba(0, 0, 15, 0.85);
      border: 1px solid rgba(60, 80, 120, 0.5);
      border-radius: 4px 4px 0 0;
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    #profiling-overlay .profiling-title {
      color: #88aacc;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 2px;
    }

    #profiling-overlay .profiling-hotkey {
      color: #668899;
      font-size: 10px;
      font-weight: normal;
    }

    #profiling-overlay .profiling-frame-budget {
      background: rgba(0, 0, 15, 0.85);
      border-left: 1px solid rgba(60, 80, 120, 0.5);
      border-right: 1px solid rgba(60, 80, 120, 0.5);
      padding: 6px 10px;
      color: #88aaaa;
      font-size: 12px;
    }

    #profiling-overlay .profiling-frame-time {
      color: #00ff88;
      font-weight: bold;
    }

    #profiling-overlay .profiling-frame-percent {
      color: #88aaaa;
    }

    #profiling-overlay .profiling-divider {
      background: rgba(60, 80, 120, 0.3);
      height: 1px;
      margin: 0;
    }

    #profiling-overlay .profiling-scope-list {
      background: rgba(0, 0, 15, 0.85);
      border-left: 1px solid rgba(60, 80, 120, 0.5);
      border-right: 1px solid rgba(60, 80, 120, 0.5);
      padding: 6px 10px;
      max-height: 320px;
      overflow-y: auto;
    }

    #profiling-overlay .profiling-empty {
      color: #445566;
      font-size: 11px;
      font-style: italic;
      text-align: center;
      padding: 10px 0;
    }

    #profiling-overlay .profiling-scope-row {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 8px;
      align-items: center;
      padding: 2px 0;
      font-size: 11px;
    }

    #profiling-overlay .profiling-scope-label {
      color: #88aacc;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #profiling-overlay .profiling-scope-time {
      color: #ffaa44;
      text-align: right;
      min-width: 45px;
      font-weight: bold;
    }

    #profiling-overlay .profiling-scope-percent {
      color: #668899;
      text-align: right;
      min-width: 30px;
    }

    #profiling-overlay .profiling-scope-bar {
      color: #4488ff;
      font-size: 10px;
      min-width: 100px;
      white-space: nowrap;
    }

    #profiling-overlay .profiling-toggle-btn {
      display: block;
      width: 100%;
      padding: 6px 10px;
      background: rgba(40, 60, 100, 0.6);
      border: 1px solid rgba(60, 80, 120, 0.5);
      border-radius: 0 0 4px 4px;
      color: #88aacc;
      font-family: inherit;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 1px;
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.15s;
      text-align: center;
    }

    #profiling-overlay .profiling-toggle-btn:hover {
      background: rgba(40, 60, 100, 0.9);
      color: #aaccee;
    }

    #profiling-overlay #profiling-status {
      color: #00ff88;
      font-weight: bold;
    }

    /* Scrollbar styling */
    #profiling-overlay .profiling-scope-list::-webkit-scrollbar {
      width: 4px;
    }
    #profiling-overlay .profiling-scope-list::-webkit-scrollbar-track {
      background: transparent;
    }
    #profiling-overlay .profiling-scope-list::-webkit-scrollbar-thumb {
      background: rgba(60, 80, 120, 0.5);
      border-radius: 2px;
    }
  `;
}
