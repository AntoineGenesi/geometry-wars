/**
 * ScoreGraphPanel — AoE2-style post-game score/kill timeline graph.
 *
 * Renders to a <canvas> element using Canvas 2D (NO Three.js).
 * Shows score-over-time as a gradient area chart with event markers.
 *
 * Features:
 * - Smooth Catmull-Rom spline through score data points (sampled every 500ms)
 * - Gradient area fill: neon cyan at curve → dark navy at bottom
 * - Event markers: wave starts, player deaths, kill streaks, pickups
 * - Draw-in animation (~1.2s left-to-right reveal)
 * - Summary stats row below graph
 */

import type { PerformanceLogger, GameEvent } from '../core/PerformanceLogger';
import type { PerformanceDataPoint } from '../core/PerformanceLogger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPH_HEIGHT = 280; // canvas height in px (before DPR scaling)
const GRAPH_PADDING = { top: 20, right: 20, bottom: 48, left: 56 };
const DRAW_ANIMATION_DURATION = 1200; // ms for left-to-right reveal
const MIN_DATA_POINTS = 3;

// Neon palette (matches existing GW UI)
const COLOR_SCORE_LINE = '#00ffff';
const COLOR_SCORE_GLOW = 'rgba(0, 255, 255, 0.5)';
const COLOR_GRID = 'rgba(0, 60, 80, 0.4)';
const COLOR_AXIS = 'rgba(0, 150, 180, 0.6)';
const COLOR_AXIS_LABEL = '#446688';

// Event marker colors
const EVENT_COLORS: Record<string, string> = {
  kill_streak: '#ffff44',    // gold
  wave_start:  '#ffffff',    // white
  player_death: '#ff4444',   // red
  buff_pickup: '#00ffff',    // cyan
  weapon_pickup: '#cc44ff',  // purple
  kill: 'rgba(0, 255, 128, 0.3)', // dim green (not shown individually, just streaks)
};

const EVENT_ICONS: Record<string, string> = {
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
 * tension: 0 = standard CR, 0.5 = uniform
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
  private dataPoints: PerformanceDataPoint[] = [];
  private events: ReadonlyArray<GameEvent> = [];
  private summary: {
    peakScore: number;
    totalKills: number;
    totalDeaths: number;
    peakWave: number;
    duration: number;
  } | null = null;

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

    const container = this.buildContainer();
    return container;
  }

  dispose(): void {
    this.cancelAnimation();
  }

  // ---------------------------------------------------------------------------
  // Private: build DOM
  // ---------------------------------------------------------------------------

  private buildContainer(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'sgp-wrapper';

    if (this.dataPoints.length < MIN_DATA_POINTS) {
      const msg = document.createElement('div');
      msg.className = 'sgp-insufficient';
      msg.textContent = 'Not enough data — play longer to see your score graph.';
      wrapper.appendChild(msg);
      return wrapper;
    }

    // Canvas for the graph
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sgp-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = `${GRAPH_HEIGHT}px`;
    wrapper.appendChild(this.canvas);

    // Stats row
    wrapper.appendChild(this.buildStatsRow());

    // Legend
    wrapper.appendChild(this.buildLegend());

    // Start draw animation once the canvas is in DOM
    requestAnimationFrame(() => this.initCanvas());

    return wrapper;
  }

  private initCanvas(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width || this.canvas.offsetWidth || 600;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(GRAPH_HEIGHT * dpr);
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

  private drawFrame(timestamp: number): void {
    if (this.animStart === null) this.animStart = timestamp;
    const elapsed = timestamp - this.animStart;
    const progress = Math.min(1, elapsed / DRAW_ANIMATION_DURATION);

    this.render(progress);

    if (progress < 1) {
      this.animFrameId = requestAnimationFrame((ts) => this.drawFrame(ts));
    } else {
      this.animFrameId = null;
    }
  }

  private render(progress: number): void {
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

    // --- Compute domain ---
    const maxTime = pts[pts.length - 1].time;
    const maxScore = Math.max(1, ...pts.map(p => p.score));

    const toX = (t: number) => plotX + (t / maxTime) * plotW;
    const toY = (s: number) => plotY + plotH - (s / maxScore) * plotH;

    // Clip to animated progress (left-to-right reveal)
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

    // --- Build spline control points ---
    // Downsample if too many points (keep up to 200 for performance)
    const maxPoints = 200;
    const step = pts.length > maxPoints ? Math.ceil(pts.length / maxPoints) : 1;
    const sampled: Array<{x: number; y: number}> = [];
    for (let i = 0; i < pts.length; i += step) {
      sampled.push({ x: toX(pts[i].time), y: toY(pts[i].score) });
    }
    // Always include last point
    const last = pts[pts.length - 1];
    if (sampled[sampled.length - 1].x !== toX(last.time)) {
      sampled.push({ x: toX(last.time), y: toY(last.score) });
    }

    // --- Area fill (gradient) ---
    const grad = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
    grad.addColorStop(0, 'rgba(0, 255, 255, 0.35)');
    grad.addColorStop(0.6, 'rgba(0, 80, 120, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 30, 0.05)');

    ctx.beginPath();
    catmullRomPath(ctx, sampled);
    ctx.lineTo(sampled[sampled.length - 1].x, plotY + plotH);
    ctx.lineTo(plotX, plotY + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // --- Score line (glow + solid) ---
    // Glow pass
    ctx.beginPath();
    catmullRomPath(ctx, sampled);
    ctx.strokeStyle = COLOR_SCORE_GLOW;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Crisp line
    ctx.beginPath();
    catmullRomPath(ctx, sampled);
    ctx.strokeStyle = COLOR_SCORE_LINE;
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- Event markers (vertical ticks + icons) ---
    // Only show events that fall within the animated region
    const animatedTime = maxTime * progress;
    const visibleEvents = this.getFilteredEvents(maxTime);

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

    ctx.restore(); // pop clip

    // --- Axes ---
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 1;
    // Y axis
    ctx.beginPath();
    ctx.moveTo(plotX, plotY);
    ctx.lineTo(plotX, plotY + plotH);
    ctx.stroke();
    // X axis
    ctx.beginPath();
    ctx.moveTo(plotX, plotY + plotH);
    ctx.lineTo(plotX + plotW, plotY + plotH);
    ctx.stroke();

    // --- Axis labels ---
    ctx.fillStyle = COLOR_AXIS_LABEL;
    ctx.font = '10px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridLines; i++) {
      const y = plotY + (plotH / gridLines) * i;
      const val = maxScore - (maxScore / gridLines) * i;
      ctx.fillText(formatScore(val), plotX - 6, y);
    }

    // X axis time labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const timeLabels = 5;
    for (let i = 0; i <= timeLabels; i++) {
      const t = (maxTime / timeLabels) * i;
      const x = toX(t);
      ctx.fillText(formatDuration(t), x, plotY + plotH + 16);
    }

    ctx.restore();
  }

  /**
   * Filter events to show on graph — removes per-kill events (too noisy),
   * and deduplicates wave events that happen very close together.
   */
  private getFilteredEvents(maxTime: number): ReadonlyArray<GameEvent> {
    const shown: GameEvent[] = [];
    const DEDUPE_WAVE_GAP = 2.0; // don't show two wave markers < 2s apart
    let lastWaveTime = -Infinity;

    for (const ev of this.events) {
      if (ev.type === 'kill') continue; // too noisy — only show streaks
      if (ev.time > maxTime) continue;

      if (ev.type === 'wave_start') {
        if (ev.time - lastWaveTime < DEDUPE_WAVE_GAP) continue;
        lastWaveTime = ev.time;
      }

      shown.push(ev);
    }
    return shown;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    .sgp-canvas {
      display: block;
      width: 100%;
      height: ${GRAPH_HEIGHT}px;
      background: rgba(0, 5, 20, 0.6);
      border-radius: 4px;
      border: 1px solid rgba(0, 80, 100, 0.4);
    }
    .sgp-insufficient {
      text-align: center;
      color: #334455;
      font-size: 14px;
      font-style: italic;
      padding: 40px 20px;
    }
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
