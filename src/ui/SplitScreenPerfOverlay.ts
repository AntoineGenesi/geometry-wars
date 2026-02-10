/**
 * Lightweight FPS / entity / quality overlay for split-screen mode.
 *
 * Displays in the bottom-left corner of Player 1's viewport.
 * Pre-allocates all DOM elements and throttles updates to ~15Hz
 * (every 4 frames at 60fps) to avoid per-frame DOM churn.
 */

import { PerformanceTracker } from '../core/PerformanceTracker';

// ---------------------------------------------------------------------------
// SplitScreenPerfOverlay
// ---------------------------------------------------------------------------

export class SplitScreenPerfOverlay {
  private readonly container: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;

  // Pre-allocated stat elements (never created/destroyed per frame)
  private readonly fpsEl: HTMLSpanElement;
  private readonly entitiesEl: HTMLSpanElement;
  private readonly qualityEl: HTMLSpanElement;

  private readonly tracker: PerformanceTracker;

  // Throttle DOM writes (every 4 frames ~= 15Hz at 60fps)
  private frameCounter = 0;
  private static readonly UPDATE_EVERY_N_FRAMES = 4;

  // Viewport positioning
  private vpX = 0;
  private vpY = 0;
  private vpW = 0;
  private vpH = 0;

  // Quality level (set externally)
  private currentQuality: string = 'HIGH';

  // Visibility state
  private visible = true;

  constructor(tracker: PerformanceTracker) {
    this.tracker = tracker;

    // -- Style --
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SplitScreenPerfOverlay.CSS;
    document.head.appendChild(this.styleEl);

    // -- Container --
    this.container = document.createElement('div');
    this.container.id = 'splitscreen-perf-overlay';
    this.container.innerHTML = `
      <span class="sp-label">FPS</span><span class="sp-value" id="sp-fps">--</span>
      <span class="sp-label">ENT</span><span class="sp-value" id="sp-ent">--</span>
      <span class="sp-label">Q</span><span class="sp-value" id="sp-quality">HIGH</span>
    `;
    document.body.appendChild(this.container);

    // Cache element refs
    this.fpsEl = this.container.querySelector('#sp-fps') as HTMLSpanElement;
    this.entitiesEl = this.container.querySelector('#sp-ent') as HTMLSpanElement;
    this.qualityEl = this.container.querySelector('#sp-quality') as HTMLSpanElement;
  }

  /**
   * Set the pixel-space viewport bounds of Player 1.
   * The overlay positions itself at the bottom-left of this region.
   */
  setViewportBounds(x: number, y: number, w: number, h: number): void {
    this.vpX = x;
    this.vpY = y;
    this.vpW = w;
    this.vpH = h;
    this.updatePosition();
  }

  /** Set the current quality level label. */
  setQualityLevel(level: string): void {
    this.currentQuality = level;
  }

  /** Per-frame update. Call from the render loop. */
  update(): void {
    if (!this.visible) return;

    this.frameCounter++;
    if (this.frameCounter % SplitScreenPerfOverlay.UPDATE_EVERY_N_FRAMES !== 0) return;

    const fps = Math.round(this.tracker.fps);
    const entities = this.tracker.entityCount;

    // Update text content (no innerHTML, no allocation)
    this.fpsEl.textContent = String(fps);
    this.entitiesEl.textContent = String(entities);
    this.qualityEl.textContent = this.currentQuality;

    // Color-code FPS
    if (fps >= 55) {
      this.fpsEl.style.color = '#00ff88';
    } else if (fps >= 30) {
      this.fpsEl.style.color = '#ffaa00';
    } else {
      this.fpsEl.style.color = '#ff4444';
    }
  }

  show(): void {
    this.visible = true;
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.container.remove();
    this.styleEl.remove();
  }

  // -- Internal ---------------------------------------------------------------

  private updatePosition(): void {
    // Position at bottom-left of Player 1's viewport
    // SplitScreenHUD uses WebGL coords (y-up), but the DOM viewport bounds
    // passed via setViewportBounds are already in DOM coords (y-down) from
    // the getPixelViewport call. However, getPixelViewport returns WebGL y-up.
    // We need to convert: DOM_top = totalHeight - webgl_y - viewport_height.
    const totalH = window.innerHeight;
    const domTop = totalH - this.vpY - this.vpH;

    this.container.style.left = `${this.vpX + 8}px`;
    this.container.style.top = `${domTop + this.vpH - 30}px`;
  }

  // -- CSS -------------------------------------------------------------------

  private static readonly CSS = `
    #splitscreen-perf-overlay {
      position: fixed;
      z-index: 150;
      pointer-events: none;
      display: flex;
      gap: 4px;
      align-items: center;
      background: rgba(0, 0, 15, 0.6);
      border: 1px solid rgba(60, 80, 120, 0.4);
      border-radius: 3px;
      padding: 2px 8px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11px;
      line-height: 1;
      user-select: none;
    }

    #splitscreen-perf-overlay .sp-label {
      color: #556677;
      font-weight: bold;
      letter-spacing: 1px;
      margin-left: 4px;
    }

    #splitscreen-perf-overlay .sp-label:first-child {
      margin-left: 0;
    }

    #splitscreen-perf-overlay .sp-value {
      color: #00ff88;
      font-weight: bold;
      min-width: 24px;
      text-align: right;
    }
  `;
}
