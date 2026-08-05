/**
 * ScoreGraphPanel — AoE2-style post-game score/kill timeline graph.
 *
 * Renders to a <canvas> element using Canvas 2D (NO Three.js).
 * Shows score-over-time (or kills-over-time) as a gradient area chart with event markers.
 *
 * Features:
 * - Smooth Catmull-Rom spline through score/kills data points (sampled every 500ms)
 * - Gradient area fill: neon cyan at curve → dark navy at bottom
 * - Event markers: wave starts, player deaths, kill streaks, pickups
 * - Draw-in animation (~1.2s left-to-right reveal)
 * - Summary stats row below graph
 * - Toggle between score view and kills view
 * - Scroll wheel zoom on X axis (zoom in/out centered on cursor)
 * - Mouse hover: vertical crosshair + tooltip with score, kills, wave, nearby events
 */

import type { PerformanceLogger, GameEvent } from '../core/PerformanceLogger';
import type { PerformanceDataPoint } from '../core/PerformanceLogger';
import { ENEMY_DISPLAY, ENEMY_TYPE_COLORS } from './AnalyticsPanel';
import { createEnemyModelPreviewElement } from './EnemyModelPreview';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPH_HEIGHT = 280; // canvas height in px (before DPR scaling)
const GRAPH_PADDING = { top: 20, right: 20, bottom: 48, left: 56 };
const DRAW_ANIMATION_DURATION = 1200; // ms for left-to-right reveal
const MIN_DATA_POINTS = 3;

// Zoom constraints
const MIN_ZOOM_FRACTION = 0.05; // can zoom to as little as 5% of total time
const ZOOM_FACTOR = 0.85;       // each wheel step zooms by this factor

// Neon palette (matches existing GW UI)
const COLOR_SCORE_LINE = '#00ffff';
const COLOR_SCORE_GLOW = 'rgba(0, 255, 255, 0.5)';
const COLOR_KILLS_LINE = '#ff44aa';
const COLOR_KILLS_GLOW = 'rgba(255, 68, 170, 0.5)';
const COLOR_GRID = 'rgba(0, 60, 80, 0.4)';
const COLOR_AXIS = 'rgba(0, 150, 180, 0.6)';
const COLOR_AXIS_LABEL = '#446688';
const COLOR_CROSSHAIR = 'rgba(255, 255, 255, 0.4)';
const COLOR_CROSSHAIR_DOT = '#ffffff';

// Event marker colors
const EVENT_COLORS: Record<string, string> = {
  combo: '#44ff88',          // green
  pvp_kill: '#ff8844',       // orange
  kill_streak: '#ffff44',    // gold
  wave_start:  '#ffffff',    // white
  player_death: '#ff4444',   // red
  buff_pickup: '#00ffff',    // cyan
  weapon_pickup: '#cc44ff',  // purple
  kill: 'rgba(0, 255, 128, 0.3)', // dim green (not shown individually, just streaks)
};

const EVENT_ICONS: Record<string, string> = {
  combo: 'C',
  pvp_kill: 'P',
  kill_streak:  '⚡',
  wave_start:   'W',
  player_death: '☠',
  buff_pickup:  '★',
  weapon_pickup: '⬡',
};

// ---------------------------------------------------------------------------
// Catmull-Rom spline helper
// ---------------------------------------------------------------------------

/**
 * Compute a Catmull-Rom spline path for a canvas 2D context.
 * pts: array of {x, y} control points.
 */
function catmullRomPath(ctx: CanvasRenderingContext2D, pts: Array<{x: number; y: number}>): void {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

// ---------------------------------------------------------------------------
// ScoreGraphPanel
// ---------------------------------------------------------------------------

export class ScoreGraphPanel {
  private animFrameId: number | null = null;
  private animStart: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private wrapper: HTMLElement | null = null;

  private dataPoints: PerformanceDataPoint[] = [];
  private events: ReadonlyArray<GameEvent> = [];

  private summary: {
    peakScore: number;
    totalKills: number;
    totalDeaths: number;
    peakWave: number;
    duration: number;
  } | null = null;

  // View state
  private viewMode: 'score' | 'kills' = 'score';
  private killsSubMode: 'total' | 'byType' = 'total';
  private perfLoggerRef: PerformanceLogger | null = null;

  // Cached kill timeline data (computed once per show())
  private killTimeline: {
    times: number[];
    types: string[];
    series: number[][];
  } | null = null;

  // Zoom state (normalized fractions of total time, 0..1)
  private zoomStart = 0;
  private zoomEnd   = 1;

  // Hover state
  private hoverFraction: number | null = null; // fraction of visible range
  private dragStartFraction: number | null = null;
  private dragEndFraction: number | null = null;
  private isDraggingRange = false;

  // Bound event handlers (for cleanup)
  private _onWheel: ((e: WheelEvent) => void) | null = null;
  private _onMouseMove: ((e: MouseEvent) => void) | null = null;
  private _onMouseLeave: (() => void) | null = null;
  private _onMouseDown: ((e: MouseEvent) => void) | null = null;
  private _onWindowMouseUp: ((e: MouseEvent) => void) | null = null;

  // Legend element ref for dynamic updates
  private legendEl: HTMLElement | null = null;

  /**
   * Build and return an HTMLElement containing the score graph canvas + stats.
   * Begins the draw-in animation immediately.
   */
  show(perfLogger: PerformanceLogger): HTMLElement {
    this.cancelAnimation();

    this.dataPoints = perfLogger.getDataPoints();
    this.events = perfLogger.getEvents();

    const sessionSummary = perfLogger.getSessionSummary();
    const waveEvents = this.events.filter(e => e.type === 'wave_start');
    const peakWave = waveEvents.length > 0
      ? Math.max(...waveEvents.map(e => e.value ?? 0))
      : 0;

    this.summary = {
      peakScore: sessionSummary?.finalScore ?? 0,
      totalKills: sessionSummary?.totalKills ?? 0,
      totalDeaths: sessionSummary?.totalDeaths ?? 0,
      peakWave,
      duration: this.dataPoints.length > 0
        ? this.dataPoints[this.dataPoints.length - 1].time
        : 0,
    };

    // Store reference for kill timeline computation
    this.perfLoggerRef = perfLogger;
    this.killTimeline = perfLogger.getKillTimelineByEnemyType(6);

    // Reset zoom/hover
    this.zoomStart = 0;
    this.zoomEnd   = 1;
    this.hoverFraction = null;
    this.dragStartFraction = null;
    this.dragEndFraction = null;
    this.isDraggingRange = false;
    this.viewMode = 'score';
    this.killsSubMode = 'total';

    const container = this.buildContainer();
    return container;
  }

  dispose(): void {
    this.cancelAnimation();
    this.detachCanvasListeners();
  }

  // ---------------------------------------------------------------------------
  // Private: build DOM
  // ---------------------------------------------------------------------------

  private buildContainer(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'sgp-wrapper';
    this.wrapper = wrapper;
    this.updateZoomStateAttrs();

    if (this.dataPoints.length < MIN_DATA_POINTS) {
      const msg = document.createElement('div');
      msg.className = 'sgp-insufficient';
      msg.textContent = 'Not enough data — play longer to see your score graph.';
      wrapper.appendChild(msg);
      return wrapper;
    }

    // Controls row: toggle + zoom reset
    wrapper.appendChild(this.buildControlsRow());

    // Canvas container (position: relative for tooltip overlay)
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'sgp-canvas-container';
    canvasContainer.style.position = 'relative';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sgp-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = `${GRAPH_HEIGHT}px`;
    canvasContainer.appendChild(this.canvas);

    // Tooltip
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'sgp-tooltip';
    this.tooltipEl.style.display = 'none';
    canvasContainer.appendChild(this.tooltipEl);

    wrapper.appendChild(canvasContainer);

    // Stats row
    wrapper.appendChild(this.buildStatsRow());

    // Legend
    this.legendEl = this.buildLegend();
    wrapper.appendChild(this.legendEl);

    // Start draw animation once the canvas is in DOM
    requestAnimationFrame(() => this.initCanvas());

    return wrapper;
  }

  private buildControlsRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sgp-controls-row';

    // View toggle
    const toggleGroup = document.createElement('div');
    toggleGroup.className = 'sgp-toggle-group';

    const scoreBtn = document.createElement('button');
    scoreBtn.className = 'sgp-toggle-btn sgp-toggle-active';
    scoreBtn.textContent = 'SCORE';
    scoreBtn.dataset.mode = 'score';

    const killsBtn = document.createElement('button');
    killsBtn.className = 'sgp-toggle-btn';
    killsBtn.textContent = 'KILLS';
    killsBtn.dataset.mode = 'kills';

    // Kills sub-toggle group (TOTAL / BY TYPE)
    const killsSubGroup = document.createElement('div');
    killsSubGroup.className = 'sgp-toggle-group';
    killsSubGroup.style.display = 'none';  // hidden until kills mode active

    const totalBtn = document.createElement('button');
    totalBtn.className = 'sgp-toggle-btn sgp-toggle-active';
    totalBtn.textContent = 'TOTAL';
    totalBtn.dataset.mode = 'total';

    const byTypeBtn = document.createElement('button');
    byTypeBtn.className = 'sgp-toggle-btn';
    byTypeBtn.textContent = 'BY TYPE';
    byTypeBtn.dataset.mode = 'byType';

    const setKillsSub = (sub: 'total' | 'byType') => {
      this.killsSubMode = sub;
      totalBtn.classList.toggle('sgp-toggle-active', sub === 'total');
      byTypeBtn.classList.toggle('sgp-toggle-active', sub === 'byType');
      this.redraw();
      // Update legend
      this.updateByTypeLegend();
    };

    totalBtn.addEventListener('click', () => setKillsSub('total'));
    byTypeBtn.addEventListener('click', () => setKillsSub('byType'));

    killsSubGroup.appendChild(totalBtn);
    killsSubGroup.appendChild(byTypeBtn);

    const setMode = (mode: 'score' | 'kills') => {
      this.viewMode = mode;
      scoreBtn.classList.toggle('sgp-toggle-active', mode === 'score');
      killsBtn.classList.toggle('sgp-toggle-active', mode === 'kills');
      killsSubGroup.style.display = mode === 'kills' ? 'flex' : 'none';
      if (mode === 'score') this.killsSubMode = 'total';
      this.redraw();
      this.updateByTypeLegend();
    };

    scoreBtn.addEventListener('click', () => setMode('score'));
    killsBtn.addEventListener('click', () => setMode('kills'));

    toggleGroup.appendChild(scoreBtn);
    toggleGroup.appendChild(killsBtn);
    row.appendChild(toggleGroup);
    row.appendChild(killsSubGroup);

    // Zoom reset button (shown only when zoomed)
    const resetBtn = document.createElement('button');
    resetBtn.className = 'sgp-zoom-reset';
    resetBtn.textContent = '⟳ RESET ZOOM';
    resetBtn.style.display = 'none';
    resetBtn.addEventListener('click', () => {
      this.zoomStart = 0;
      this.zoomEnd   = 1;
      this.updateZoomStateAttrs();
      this.updateZoomResetVisibility(resetBtn);
      this.redraw();
    });
    row.appendChild(resetBtn);

    // Store ref to reset button so we can show/hide it on zoom events
    (row as HTMLElement & { _zoomResetBtn?: HTMLButtonElement })._zoomResetBtn = resetBtn;

    return row;
  }

  private updateZoomResetVisibility(btn: HTMLElement): void {
    const isZoomed = this.zoomStart > 0.001 || this.zoomEnd < 0.999;
    btn.style.display = isZoomed ? 'inline-flex' : 'none';
  }

  private initCanvas(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width || this.canvas.offsetWidth || 600;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(GRAPH_HEIGHT * dpr);
    this.attachCanvasListeners();
    this.startAnimation();
  }

  private buildStatsRow(): HTMLElement {
    const s = this.summary!;
    const row = document.createElement('div');
    row.className = 'sgp-stats-row';
    const items = [
      { label: 'PEAK SCORE', value: s.peakScore.toLocaleString() },
      { label: 'TOTAL KILLS', value: s.totalKills.toLocaleString() },
      { label: 'DEATHS', value: String(s.totalDeaths) },
      { label: 'PEAK WAVE', value: s.peakWave > 0 ? String(s.peakWave) : '—' },
      { label: 'DURATION', value: formatDuration(s.duration) },
    ];
    for (const item of items) {
      const cell = document.createElement('div');
      cell.className = 'sgp-stat-cell';
      cell.innerHTML = `<span class="sgp-stat-value">${item.value}</span><span class="sgp-stat-label">${item.label}</span>`;
      row.appendChild(cell);
    }
    return row;
  }

  private buildLegend(): HTMLElement {
    const legend = document.createElement('div');
    legend.className = 'sgp-legend';
    const shown: Array<{ type: string; icon: string; label: string }> = [
      { type: 'combo',       icon: EVENT_ICONS.combo,       label: 'PvE Combo' },
      { type: 'pvp_kill',    icon: EVENT_ICONS.pvp_kill,    label: 'PvP Kill' },
      { type: 'wave_start',   icon: EVENT_ICONS.wave_start,   label: 'Wave' },
      { type: 'player_death', icon: EVENT_ICONS.player_death, label: 'Death' },
      { type: 'kill_streak',  icon: EVENT_ICONS.kill_streak,  label: 'Kill Streak (5+)' },
      { type: 'buff_pickup',  icon: EVENT_ICONS.buff_pickup,  label: 'Buff Pickup' },
      { type: 'weapon_pickup',icon: EVENT_ICONS.weapon_pickup,label: 'Weapon Pickup' },
    ];
    for (const item of shown) {
      const entry = document.createElement('div');
      entry.className = 'sgp-legend-entry';
      entry.innerHTML = `<span class="sgp-legend-icon" style="color: ${EVENT_COLORS[item.type]}">${item.icon}</span><span class="sgp-legend-text">${item.label}</span>`;
      legend.appendChild(entry);
    }
    return legend;
  }

  /**
   * Update legend to show enemy type colors when in "BY TYPE" kills sub-mode,
   * or revert to event legend otherwise.
   */
  private updateByTypeLegend(): void {
    if (!this.legendEl) return;
    this.legendEl.innerHTML = '';

    if (this.viewMode === 'kills' && this.killsSubMode === 'byType' && this.killTimeline) {
      for (const typeName of this.killTimeline.types) {
        const color = ENEMY_TYPE_COLORS[typeName] ?? '#666688';
        const displayName = typeName === 'other'
          ? 'Other'
          : (ENEMY_DISPLAY[typeName] ?? (typeName.charAt(0).toUpperCase() + typeName.slice(1).replace(/_/g, ' ')));
        const entry = document.createElement('div');
        entry.className = 'sgp-legend-entry sgp-legend-entry-by-type';
        if (typeName !== 'other') {
          entry.appendChild(createEnemyModelPreviewElement(typeName, displayName, color));
        }
        const swatch = document.createElement('span');
        swatch.className = 'sgp-legend-swatch';
        swatch.style.background = color;
        swatch.style.boxShadow = `0 0 8px ${color}`;
        entry.appendChild(swatch);
        const text = document.createElement('span');
        text.className = 'sgp-legend-text';
        text.textContent = displayName;
        entry.appendChild(text);
        this.legendEl.appendChild(entry);
      }
    } else {
      // Default event legend
      const shown: Array<{ type: string; icon: string; label: string }> = [
        { type: 'combo',       icon: EVENT_ICONS.combo,       label: 'PvE Combo' },
        { type: 'pvp_kill',    icon: EVENT_ICONS.pvp_kill,    label: 'PvP Kill' },
        { type: 'wave_start',   icon: EVENT_ICONS.wave_start,   label: 'Wave' },
        { type: 'player_death', icon: EVENT_ICONS.player_death, label: 'Death' },
        { type: 'kill_streak',  icon: EVENT_ICONS.kill_streak,  label: 'Kill Streak (5+)' },
        { type: 'buff_pickup',  icon: EVENT_ICONS.buff_pickup,  label: 'Buff Pickup' },
        { type: 'weapon_pickup',icon: EVENT_ICONS.weapon_pickup,label: 'Weapon Pickup' },
      ];
      for (const item of shown) {
        const entry = document.createElement('div');
        entry.className = 'sgp-legend-entry';
        entry.innerHTML = `<span class="sgp-legend-icon" style="color: ${EVENT_COLORS[item.type]}">${item.icon}</span><span class="sgp-legend-text">${item.label}</span>`;
        this.legendEl.appendChild(entry);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: canvas event listeners
  // ---------------------------------------------------------------------------

  private attachCanvasListeners(): void {
    if (!this.canvas) return;

    this._onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.canvas!.getBoundingClientRect();
      const mouseXFraction = (e.clientX - rect.left) / rect.width;
      this.handleZoom(e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR, mouseXFraction);
    };

    this._onMouseMove = (e: MouseEvent) => {
      const rect = this.canvas!.getBoundingClientRect();
      const plotFraction = this.getPlotFractionFromMouse(e, rect);
      this.hoverFraction = plotFraction;
      if (this.isDraggingRange) {
        this.dragEndFraction = plotFraction;
      }
      this.redraw();
      this.updateTooltip(e.clientX - rect.left, e.clientY - rect.top, plotFraction, rect);
    };

    this._onMouseLeave = () => {
      this.hoverFraction = null;
      if (this.tooltipEl) this.tooltipEl.style.display = 'none';
      this.redraw();
    };

    this._onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = this.canvas!.getBoundingClientRect();
      const plotFraction = this.getPlotFractionFromMouse(e, rect);
      this.isDraggingRange = true;
      this.wrapper?.classList.add('sgp-range-selecting');
      this.dragStartFraction = plotFraction;
      this.dragEndFraction = plotFraction;
      this.hoverFraction = plotFraction;
      if (this.tooltipEl) this.tooltipEl.style.display = 'none';
      this.redraw();
    };

    this._onWindowMouseUp = (e: MouseEvent) => {
      if (!this.isDraggingRange || !this.canvas || this.dragStartFraction === null) return;
      const rect = this.canvas.getBoundingClientRect();
      this.dragEndFraction = this.getPlotFractionFromMouse(e, rect);
      this.applyDragSelection();
    };

    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseleave', this._onMouseLeave);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onWindowMouseUp);
  }

  private detachCanvasListeners(): void {
    if (!this.canvas) return;
    if (this._onWheel) this.canvas.removeEventListener('wheel', this._onWheel);
    if (this._onMouseMove) this.canvas.removeEventListener('mousemove', this._onMouseMove);
    if (this._onMouseLeave) this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
    if (this._onMouseDown) this.canvas.removeEventListener('mousedown', this._onMouseDown);
    if (this._onWindowMouseUp) window.removeEventListener('mouseup', this._onWindowMouseUp);
  }

  private getPlotFractionFromMouse(e: MouseEvent, rect: DOMRect): number {
    const plotX = GRAPH_PADDING.left;
    const plotW = rect.width - GRAPH_PADDING.left - GRAPH_PADDING.right;
    const relX = e.clientX - rect.left - plotX;
    return Math.max(0, Math.min(1, relX / plotW));
  }

  private applyDragSelection(): void {
    const start = this.dragStartFraction;
    const end = this.dragEndFraction;
    this.isDraggingRange = false;
    this.wrapper?.classList.remove('sgp-range-selecting');
    this.dragStartFraction = null;
    this.dragEndFraction = null;

    if (start === null || end === null || Math.abs(end - start) < MIN_ZOOM_FRACTION) {
      this.redraw();
      return;
    }

    const range = this.zoomEnd - this.zoomStart;
    const nextStart = this.zoomStart + Math.min(start, end) * range;
    const nextEnd = this.zoomStart + Math.max(start, end) * range;
    this.zoomStart = Math.max(0, Math.min(0.999, nextStart));
    this.zoomEnd = Math.min(1, Math.max(this.zoomStart + MIN_ZOOM_FRACTION, nextEnd));
    this.updateZoomStateAttrs();

    const controlsRow = this.wrapper?.querySelector('.sgp-controls-row') as (HTMLElement & { _zoomResetBtn?: HTMLButtonElement }) | null;
    if (controlsRow?._zoomResetBtn) {
      this.updateZoomResetVisibility(controlsRow._zoomResetBtn);
    }
    this.redraw();
  }

  private updateZoomStateAttrs(): void {
    if (!this.wrapper) return;
    this.wrapper.dataset.zoomStart = this.zoomStart.toFixed(4);
    this.wrapper.dataset.zoomEnd = this.zoomEnd.toFixed(4);
  }

  private handleZoom(factor: number, centerFraction: number): void {
    const range = this.zoomEnd - this.zoomStart;
    const newRange = Math.max(MIN_ZOOM_FRACTION, Math.min(1, range * factor));
    const center = this.zoomStart + centerFraction * range;
    let newStart = center - centerFraction * newRange;
    let newEnd   = center + (1 - centerFraction) * newRange;

    // Clamp to [0, 1]
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > 1)   { newStart -= (newEnd - 1); newEnd = 1; }
    newStart = Math.max(0, newStart);
    newEnd   = Math.min(1, newEnd);

    this.zoomStart = newStart;
    this.zoomEnd   = newEnd;
    this.updateZoomStateAttrs();

    // Update reset button visibility
    const controlsRow = this.wrapper?.querySelector('.sgp-controls-row') as (HTMLElement & { _zoomResetBtn?: HTMLButtonElement }) | null;
    if (controlsRow?._zoomResetBtn) {
      this.updateZoomResetVisibility(controlsRow._zoomResetBtn);
    }

    this.redraw();
  }

  private updateTooltip(mouseX: number, mouseY: number, plotFraction: number, rect: DOMRect): void {
    if (!this.tooltipEl) return;
    const pts = this.dataPoints;
    if (pts.length < MIN_DATA_POINTS) return;

    const maxTime = pts[pts.length - 1].time;
    const visibleStart = this.zoomStart * maxTime;
    const visibleEnd   = this.zoomEnd   * maxTime;
    const hoveredTime  = visibleStart + plotFraction * (visibleEnd - visibleStart);

    // Interpolate score and kills at hovered time
    const score = interpolateAtTime(pts, hoveredTime, 'score');
    const kills = interpolateAtTime(pts, hoveredTime, 'kills');

    // Current wave at this time
    const waveAtTime = getWaveAtTime(this.events, hoveredTime);

    // Nearby events (within ±3s)
    const nearbyEvents = filterScoreGraphEvents(this.events, maxTime)
      .filter(e => Math.abs(e.time - hoveredTime) < 3)
      .slice(0, 3);

    // Format tooltip HTML
    let html = `
      <div class="sgp-tt-time">${formatDuration(hoveredTime)}</div>
      <div class="sgp-tt-row"><span class="sgp-tt-label">SCORE</span><span class="sgp-tt-val">${Math.round(score).toLocaleString()}</span></div>
      <div class="sgp-tt-row"><span class="sgp-tt-label">KILLS</span><span class="sgp-tt-val">${Math.round(kills)}</span></div>
    `;
    if (waveAtTime > 0) {
      html += `<div class="sgp-tt-row"><span class="sgp-tt-label">WAVE</span><span class="sgp-tt-val">${waveAtTime}</span></div>`;
    }
    if (nearbyEvents.length > 0) {
      html += `<div class="sgp-tt-divider"></div>`;
      for (const ev of nearbyEvents) {
        const icon = EVENT_ICONS[ev.type] ?? '•';
        const color = EVENT_COLORS[ev.type] ?? '#ffffff';
        const label = getScoreGraphEventLabel(ev);
        html += `<div class="sgp-tt-event" style="color:${color}">${icon} ${label}</div>`;
      }
    }
    this.tooltipEl.innerHTML = html;

    // Position tooltip: right of cursor when space available, else left
    const tooltipW = 160;
    const tooltipX = mouseX + 12 + tooltipW > rect.width ? mouseX - tooltipW - 12 : mouseX + 12;
    const tooltipY = Math.max(4, mouseY - 40);

    this.tooltipEl.style.left = `${tooltipX}px`;
    this.tooltipEl.style.top  = `${tooltipY}px`;
    this.tooltipEl.style.display = 'block';
  }

  // ---------------------------------------------------------------------------
  // Private: animation + drawing
  // ---------------------------------------------------------------------------

  private startAnimation(): void {
    this.animStart = null;
    this.animFrameId = requestAnimationFrame((ts) => this.drawFrame(ts));
  }

  private cancelAnimation(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** Called each frame during draw-in animation */
  private drawFrame(timestamp: number): void {
    if (this.animStart === null) this.animStart = timestamp;
    const elapsed = timestamp - this.animStart;
    const progress = Math.min(1, elapsed / DRAW_ANIMATION_DURATION);

    this.renderWithProgress(progress);

    if (progress < 1) {
      this.animFrameId = requestAnimationFrame((ts) => this.drawFrame(ts));
    } else {
      this.animFrameId = null;
    }
  }

  /** Re-render at full progress (for interaction updates) */
  private redraw(): void {
    if (this.animFrameId !== null) return; // still animating — will pick up changes
    this.renderWithProgress(1);
  }

  private renderWithProgress(progress: number): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Clear
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(dpr, dpr);

    const logW = W / dpr;
    const logH = H / dpr;

    const plotX = GRAPH_PADDING.left;
    const plotY = GRAPH_PADDING.top;
    const plotW = logW - GRAPH_PADDING.left - GRAPH_PADDING.right;
    const plotH = logH - GRAPH_PADDING.top - GRAPH_PADDING.bottom;

    const pts = this.dataPoints;
    if (pts.length < MIN_DATA_POINTS) {
      ctx.restore();
      return;
    }

    // --- Compute domain (full) ---
    const maxTime = pts[pts.length - 1].time;

    // Zoom window (in time units)
    const visibleStart = this.zoomStart * maxTime;
    const visibleEnd   = this.zoomEnd   * maxTime;
    const visibleRange = visibleEnd - visibleStart;

    // Choose data series
    const isKills = this.viewMode === 'kills';
    // Use kills or score from data points directly
    const seriesValues: number[] = isKills
      ? pts.map(p => p.kills ?? 0)
      : pts.map(p => p.score);

    // Compute max within visible window for Y scaling
    const inRangeValues = pts
      .map((p, i) => ({ time: p.time, val: seriesValues[i] ?? 0 }))
      .filter(pv => pv.time >= visibleStart && pv.time <= visibleEnd)
      .map(pv => pv.val);
    const maxVal = Math.max(1, ...inRangeValues);

    // Map helpers
    const toX = (t: number) => plotX + ((t - visibleStart) / visibleRange) * plotW;
    const toY = (v: number) => plotY + plotH - (v / maxVal) * plotH;

    // Clip to animated progress (left-to-right reveal during draw-in)
    const clipRight = plotX + plotW * progress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, clipRight, logH);
    ctx.clip();

    // --- Grid lines ---
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = plotY + (plotH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
    }

    // --- Build spline control points (only points in visible window + 1 outside each side) ---
    const maxPoints = 200;
    const step = pts.length > maxPoints ? Math.ceil(pts.length / maxPoints) : 1;

    // Include one point before and one after the visible range for smooth edge splines
    const firstIdx = Math.max(0, pts.findIndex((p: PerformanceDataPoint) => p.time >= visibleStart) - 1);
    // findLastIndex is ES2023+; use a manual reverse search for compatibility
    let lastRawIdx = pts.length - 1;
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].time <= visibleEnd) { lastRawIdx = i; break; }
    }
    const lastIdx = Math.min(pts.length - 1, lastRawIdx + 1);

    const sampled: Array<{x: number; y: number}> = [];
    for (let i = firstIdx; i <= lastIdx; i += step) {
      sampled.push({ x: toX(pts[i].time), y: toY(seriesValues[i] ?? 0) });
    }
    // Always include last visible point
    const lastP = pts[lastIdx];
    if (sampled.length > 0 && sampled[sampled.length - 1].x !== toX(lastP.time)) {
      sampled.push({ x: toX(lastP.time), y: toY(seriesValues[lastIdx] ?? 0) });
    }

    if (sampled.length < 2) {
      ctx.restore();
      ctx.restore();
      return;
    }

    // --- Stacked area chart for kills BY TYPE mode ---
    if (isKills && this.killsSubMode === 'byType' && this.killTimeline && this.killTimeline.types.length > 0) {
      this.renderStackedArea(ctx, plotX, plotY, plotW, plotH, visibleStart, visibleEnd, visibleRange, progress, maxTime);
    } else {
      // --- Single-line mode (score or total kills) ---
      const lineColor = isKills ? COLOR_KILLS_LINE : COLOR_SCORE_LINE;
      const glowColor = isKills ? COLOR_KILLS_GLOW : COLOR_SCORE_GLOW;
      const gradTop   = isKills ? 'rgba(255, 68, 170, 0.35)' : 'rgba(0, 255, 255, 0.35)';
      const gradMid   = isKills ? 'rgba(80, 0, 60, 0.2)'     : 'rgba(0, 80, 120, 0.2)';
      const gradBot   = 'rgba(0, 0, 30, 0.05)';

      // Area fill (gradient)
      const grad = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
      grad.addColorStop(0, gradTop);
      grad.addColorStop(0.6, gradMid);
      grad.addColorStop(1, gradBot);

      ctx.beginPath();
      catmullRomPath(ctx, sampled);
      ctx.lineTo(sampled[sampled.length - 1].x, plotY + plotH);
      ctx.lineTo(Math.max(plotX, sampled[0].x), plotY + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line (glow + solid)
      ctx.beginPath();
      catmullRomPath(ctx, sampled);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      catmullRomPath(ctx, sampled);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // --- Event markers (only within visible window) ---
    const animatedTime = maxTime * progress;
    const visibleEvents = filterScoreGraphEvents(this.events, maxTime)
      .filter(e => e.time >= visibleStart && e.time <= visibleEnd);

    for (const ev of visibleEvents) {
      if (ev.time > animatedTime) continue;
      const x = toX(ev.time);
      const color = EVENT_COLORS[ev.type] ?? '#ffffff';
      const icon = EVENT_ICONS[ev.type] ?? '•';
      const isDeath = ev.type === 'player_death';
      const tickH = isDeath ? plotH + 8 : plotH * 0.5;
      const tickTop = plotY + (isDeath ? 0 : plotH * 0.5);

      // Vertical tick
      ctx.beginPath();
      ctx.moveTo(x, tickTop);
      ctx.lineTo(x, tickTop + tickH);
      ctx.strokeStyle = color;
      ctx.lineWidth = isDeath ? 2 : 1.5;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Icon above tick
      ctx.font = `${isDeath ? 14 : 12}px 'Segoe UI', Arial`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(icon, x, tickTop - 2);

      // Wave label below x-axis
      if (ev.type === 'wave_start' && ev.value) {
        ctx.font = '9px Arial';
        ctx.fillStyle = 'rgba(200,200,200,0.6)';
        ctx.textBaseline = 'top';
        ctx.fillText(`W${ev.value}`, x, plotY + plotH + 4);
      }
    }

    // --- Drag selection preview ---
    if (this.isDraggingRange && this.dragStartFraction !== null && this.dragEndFraction !== null && progress >= 1) {
      const startX = plotX + Math.min(this.dragStartFraction, this.dragEndFraction) * plotW;
      const endX = plotX + Math.max(this.dragStartFraction, this.dragEndFraction) * plotW;
      ctx.save();
      ctx.fillStyle = 'rgba(0, 255, 255, 0.12)';
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.75)';
      ctx.lineWidth = 1;
      ctx.fillRect(startX, plotY, Math.max(1, endX - startX), plotH);
      ctx.strokeRect(startX, plotY, Math.max(1, endX - startX), plotH);
      ctx.restore();
    }

    // --- Hover crosshair ---
    if (this.hoverFraction !== null && progress >= 1) {
      const hoverX = plotX + this.hoverFraction * plotW;
      const hoveredTime = visibleStart + this.hoverFraction * visibleRange;

      // Vertical crosshair line
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hoverX, plotY);
      ctx.lineTo(hoverX, plotY + plotH);
      ctx.strokeStyle = COLOR_CROSSHAIR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Dot on the curve at hover position (skip for byType stacked mode)
      if (!(isKills && this.killsSubMode === 'byType')) {
        const hoveredVal = isKills
          ? interpolateAtTime(pts, hoveredTime, 'kills')
          : interpolateAtTime(pts, hoveredTime, 'score');
        const dotY = toY(hoveredVal);
        const dotLineColor = isKills ? COLOR_KILLS_LINE : COLOR_SCORE_LINE;

        ctx.beginPath();
        ctx.arc(hoverX, dotY, 5, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_CROSSHAIR_DOT;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hoverX, dotY, 5, 0, Math.PI * 2);
        ctx.strokeStyle = dotLineColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore(); // pop clip

    // --- Axes ---
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, plotY);
    ctx.lineTo(plotX, plotY + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(plotX, plotY + plotH);
    ctx.lineTo(plotX + plotW, plotY + plotH);
    ctx.stroke();

    // --- Y axis labels ---
    ctx.fillStyle = COLOR_AXIS_LABEL;
    ctx.font = '10px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridLines; i++) {
      const y = plotY + (plotH / gridLines) * i;
      const val = maxVal - (maxVal / gridLines) * i;
      const label = isKills ? String(Math.round(val)) : formatScore(val);
      ctx.fillText(label, plotX - 6, y);
    }

    // --- X axis time labels (based on visible window) ---
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const timeLabels = 5;
    for (let i = 0; i <= timeLabels; i++) {
      const t = visibleStart + (visibleRange / timeLabels) * i;
      const x = toX(t);
      ctx.fillStyle = COLOR_AXIS_LABEL;
      ctx.fillText(formatDuration(t), x, plotY + plotH + 16);
    }

    ctx.restore();
  }

  /**
   * Render stacked area chart for kills-by-enemy-type mode.
   * Each enemy type gets its own colored band, stacked from bottom to top.
   */
  private renderStackedArea(
    ctx: CanvasRenderingContext2D,
    plotX: number, plotY: number, plotW: number, plotH: number,
    visibleStart: number, visibleEnd: number, visibleRange: number,
    progress: number, _maxTime: number,
  ): void {
    const kt = this.killTimeline!;
    if (kt.times.length < 2 || kt.types.length === 0) return;

    const toX = (t: number) => plotX + ((t - visibleStart) / visibleRange) * plotW;

    // Compute total (sum of all types) at each time point
    const totals = new Array(kt.times.length).fill(0);
    for (let ti = 0; ti < kt.times.length; ti++) {
      for (let si = 0; si < kt.types.length; si++) {
        totals[ti] += kt.series[si][ti];
      }
    }

    // Max total in visible range for Y scaling
    let maxTotal = 1;
    for (let ti = 0; ti < kt.times.length; ti++) {
      if (kt.times[ti] >= visibleStart && kt.times[ti] <= visibleEnd) {
        if (totals[ti] > maxTotal) maxTotal = totals[ti];
      }
    }

    const toY = (v: number) => plotY + plotH - (v / maxTotal) * plotH;

    // Sample points in visible range
    const maxPoints = 200;
    const step = kt.times.length > maxPoints ? Math.ceil(kt.times.length / maxPoints) : 1;

    const firstIdx = Math.max(0, kt.times.findIndex(t => t >= visibleStart) - 1);
    let lastRawIdx = kt.times.length - 1;
    for (let i = kt.times.length - 1; i >= 0; i--) {
      if (kt.times[i] <= visibleEnd) { lastRawIdx = i; break; }
    }
    const lastIdx = Math.min(kt.times.length - 1, lastRawIdx + 1);

    // Build sampled indices
    const indices: number[] = [];
    for (let i = firstIdx; i <= lastIdx; i += step) {
      indices.push(i);
    }
    if (indices.length > 0 && indices[indices.length - 1] !== lastIdx) {
      indices.push(lastIdx);
    }
    if (indices.length < 2) return;

    // Draw stacked areas bottom-to-top (reverse type order so first type is on top visually)
    // Compute cumulative baselines
    const baselineBelow = new Array(indices.length).fill(0);

    for (let si = kt.types.length - 1; si >= 0; si--) {
      const typeName = kt.types[si];
      const color = ENEMY_TYPE_COLORS[typeName] ?? '#666688';

      // Build top points (baseline + this type's value)
      const topPts: Array<{x: number; y: number}> = [];
      const botPts: Array<{x: number; y: number}> = [];

      for (let ii = 0; ii < indices.length; ii++) {
        const ti = indices[ii];
        const x = toX(kt.times[ti]);
        const val = kt.series[si][ti];
        const topVal = baselineBelow[ii] + val;
        topPts.push({ x, y: toY(topVal) });
        botPts.push({ x, y: toY(baselineBelow[ii]) });
      }

      // Fill the band between top and bottom
      ctx.beginPath();
      // Top edge (left to right)
      ctx.moveTo(topPts[0].x, topPts[0].y);
      for (let i = 1; i < topPts.length; i++) {
        ctx.lineTo(topPts[i].x, topPts[i].y);
      }
      // Bottom edge (right to left)
      for (let i = botPts.length - 1; i >= 0; i--) {
        ctx.lineTo(botPts[i].x, botPts[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Thin line on top edge
      ctx.beginPath();
      ctx.moveTo(topPts[0].x, topPts[0].y);
      for (let i = 1; i < topPts.length; i++) {
        ctx.lineTo(topPts[i].x, topPts[i].y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Update baseline for next layer
      for (let ii = 0; ii < indices.length; ii++) {
        baselineBelow[ii] += kt.series[si][indices[ii]];
      }
    }
  }

}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function interpolateAtTime(pts: ReadonlyArray<PerformanceDataPoint>, time: number, field: 'score' | 'kills'): number {
  if (pts.length === 0) return 0;
  if (time <= pts[0].time) return pts[0][field];
  if (time >= pts[pts.length - 1].time) return pts[pts.length - 1][field];

  // Binary search for surrounding points
  let lo = 0, hi = pts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].time <= time) lo = mid; else hi = mid;
  }
  const t0 = pts[lo].time, t1 = pts[hi].time;
  const v0 = pts[lo][field], v1 = pts[hi][field];
  const alpha = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
  return v0 + alpha * (v1 - v0);
}

function getWaveAtTime(events: ReadonlyArray<GameEvent>, time: number): number {
  let wave = 0;
  for (const ev of events) {
    if (ev.type === 'wave_start' && ev.time <= time && ev.value) {
      wave = Math.max(wave, ev.value);
    }
  }
  return wave;
}

export function filterScoreGraphEvents(
  events: ReadonlyArray<GameEvent>,
  maxTime: number,
): ReadonlyArray<GameEvent> {
  const shown: GameEvent[] = [];
  const DEDUPE_WAVE_GAP = 2.0;
  let lastWaveTime = -Infinity;

  for (const ev of events) {
    if (ev.type === 'kill') continue;
    if (ev.time > maxTime) continue;

    if (ev.type === 'wave_start') {
      if (ev.time - lastWaveTime < DEDUPE_WAVE_GAP) continue;
      lastWaveTime = ev.time;
    }

    shown.push(ev);
  }
  return shown;
}

export function getScoreGraphEventLabel(ev: GameEvent): string {
  switch (ev.type) {
    case 'combo': {
      const duration = ev.metadata && 'duration' in ev.metadata
        ? ` over ${ev.metadata.duration.toFixed(1)}s`
        : '';
      return `${ev.value ?? 0}x PvE combo${duration}`;
    }
    case 'pvp_kill':
      return ev.metadata && 'killerName' in ev.metadata
        ? `${ev.metadata.killerName} defeated ${ev.metadata.victimName}`
        : ev.label;
    case 'wave_start':   return `Wave ${ev.value ?? '?'} started`;
    case 'player_death': return 'Player died';
    case 'kill_streak':  return `Kill streak ×${ev.value ?? ''}`;
    case 'buff_pickup':  return 'Buff picked up';
    case 'weapon_pickup':return 'Weapon picked up';
    default:             return ev.type;
  }
}

function formatScore(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return String(Math.round(val));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// CSS injection (called once on module load)
// ---------------------------------------------------------------------------

let stylesInjected = false;

export function injectScoreGraphStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .sgp-wrapper {
      width: 100%;
      box-sizing: border-box;
    }
    .sgp-canvas-container {
      width: 100%;
      position: relative;
    }
    .sgp-canvas {
      display: block;
      width: 100%;
      height: ${GRAPH_HEIGHT}px;
      background: rgba(0, 5, 20, 0.6);
      border-radius: 4px;
      border: 1px solid rgba(0, 80, 100, 0.4);
      cursor: crosshair;
    }
    .sgp-wrapper.sgp-range-selecting .sgp-canvas {
      cursor: ew-resize;
    }
    .sgp-insufficient {
      text-align: center;
      color: #334455;
      font-size: 14px;
      font-style: italic;
      padding: 40px 20px;
    }

    /* Controls row */
    .sgp-controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      gap: 8px;
    }
    .sgp-toggle-group {
      display: flex;
      gap: 2px;
      background: rgba(0, 20, 40, 0.6);
      border: 1px solid rgba(0, 80, 100, 0.4);
      border-radius: 4px;
      padding: 2px;
    }
    .sgp-toggle-btn {
      padding: 4px 14px;
      font-size: 11px;
      font-family: 'Courier New', monospace;
      letter-spacing: 2px;
      font-weight: bold;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      background: transparent;
      color: #446688;
      transition: background 150ms ease-out, color 150ms ease-out;
    }
    .sgp-toggle-btn.sgp-toggle-active {
      background: rgba(0, 180, 220, 0.15);
      color: #00ffff;
      text-shadow: 0 0 8px rgba(0, 255, 255, 0.4);
    }
    .sgp-toggle-btn:hover:not(.sgp-toggle-active) {
      color: #88aacc;
      background: rgba(0, 80, 120, 0.2);
    }
    .sgp-zoom-reset {
      padding: 4px 10px;
      font-size: 10px;
      font-family: 'Courier New', monospace;
      letter-spacing: 1px;
      border: 1px solid rgba(0, 180, 220, 0.3);
      border-radius: 3px;
      cursor: pointer;
      background: rgba(0, 40, 60, 0.5);
      color: #00aacc;
      transition: background 150ms ease-out, color 150ms ease-out;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .sgp-zoom-reset:hover {
      background: rgba(0, 80, 120, 0.4);
      color: #00ffff;
    }

    /* Tooltip */
    .sgp-tooltip {
      position: absolute;
      pointer-events: none;
      background: rgba(0, 8, 24, 0.92);
      border: 1px solid rgba(0, 140, 180, 0.5);
      border-radius: 4px;
      padding: 8px 10px;
      min-width: 140px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #aaccdd;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
      z-index: 10;
    }
    .sgp-tt-time {
      font-size: 13px;
      font-weight: bold;
      color: #00ffff;
      margin-bottom: 6px;
      letter-spacing: 1px;
    }
    .sgp-tt-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 2px;
    }
    .sgp-tt-label {
      color: #446688;
      font-size: 10px;
      letter-spacing: 1px;
    }
    .sgp-tt-val {
      color: #88ccee;
      font-weight: bold;
    }
    .sgp-tt-divider {
      border-top: 1px solid rgba(0, 80, 100, 0.4);
      margin: 5px 0;
    }
    .sgp-tt-event {
      font-size: 10px;
      margin-bottom: 2px;
      white-space: nowrap;
    }

    /* Stats row */
    .sgp-stats-row {
      display: flex;
      justify-content: space-around;
      margin-top: 16px;
      gap: 8px;
      flex-wrap: wrap;
    }
    .sgp-stat-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .sgp-stat-value {
      font-size: 20px;
      font-weight: bold;
      color: #00ffff;
      text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
      letter-spacing: 1px;
    }
    .sgp-stat-label {
      font-size: 10px;
      color: #446688;
      letter-spacing: 2px;
    }

    /* Legend */
    .sgp-legend {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 12px;
      padding-bottom: 4px;
    }
    .sgp-legend-entry {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .sgp-legend-entry-by-type {
      gap: 7px;
      min-height: 34px;
    }
    .sgp-legend-entry-by-type .ap-enemy-preview,
    .sgp-legend-entry-by-type .ap-enemy-preview-img {
      width: 30px;
      height: 30px;
    }
    .sgp-legend-entry-by-type .ap-enemy-preview-fallback {
      width: 18px;
      height: 18px;
    }
    .sgp-legend-swatch {
      width: 9px;
      height: 9px;
      border-radius: 2px;
      flex: 0 0 auto;
    }
    .sgp-legend-icon {
      font-size: 13px;
      line-height: 1;
    }
    .sgp-legend-text {
      font-size: 10px;
      color: #446688;
      letter-spacing: 1px;
    }
  `;
  document.head.appendChild(style);
}
