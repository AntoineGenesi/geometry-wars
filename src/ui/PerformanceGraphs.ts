/**
 * Interactive performance graphs using Canvas API.
 *
 * Renders Plotly-style time-series charts with zoom, pan, and hover.
 * No external dependencies - pure Canvas 2D rendering.
 *
 * Features:
 * - FPS over time line chart
 * - Enemy count over time line chart
 * - Bullet count over time line chart
 * - Enemy type breakdown stacked area chart
 * - Interactive: mouse wheel zoom, drag pan, hover tooltips
 * - Min/max FPS markers with vertical lines
 */

import { PerformanceDataPoint } from '../core/PerformanceLogger';
import { EnemyType } from '../entities/enemies/EnemySpawner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphConfig {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  colors: {
    background: string;
    grid: string;
    axis: string;
    text: string;
    fps: string;
    enemies: string;
    bullets: string;
    minFpsMarker: string;
    maxFpsMarker: string;
  };
}

interface ViewPort {
  /** Minimum time (seconds) visible in the viewport. */
  minTime: number;
  /** Maximum time (seconds) visible in the viewport. */
  maxTime: number;
  /** Minimum value visible in the viewport. */
  minValue: number;
  /** Maximum value visible in the viewport. */
  maxValue: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: GraphConfig = {
  width: 800,
  height: 400,
  padding: { top: 20, right: 20, bottom: 40, left: 60 },
  colors: {
    background: '#0a0a14',
    grid: '#1a1a2e',
    axis: '#3a3a5e',
    text: '#88aacc',
    fps: '#00ff88',
    enemies: '#ff6644',
    bullets: '#44aaff',
    minFpsMarker: '#ff4444',
    maxFpsMarker: '#44ff44',
  },
};

// Enemy type colors for stacked area chart
const ENEMY_COLORS: Record<string, string> = {
  wanderer: '#ff6644',
  grunt: '#ff8844',
  duck: '#ffaa44',
  mayfly: '#ffcc44',
  rocket: '#ffee44',
  neutron: '#eeff44',
  weaver: '#ccff44',
  spinner: '#aaff44',
  snake: '#88ff44',
  repulsor: '#66ff44',
  gravity_well: '#44ff44',
  gate: '#44ff66',
  painter: '#44ff88',
  virus: '#44ffaa',
  spawner: '#44ffcc',
  titan_grunt: '#44ffee',
  titan_spinner: '#44eeff',
  titan_weaver: '#44ccff',
  giant_wanderer: '#44aaff',
  giant_rocket: '#4488ff',
  giant_snake: '#4466ff',
  giant_neutron: '#4444ff',
  cluster: '#6644ff',
  helix: '#8844ff',
  fractal: '#aa44ff',
  swarm: '#cc44ff',
  lurker: '#ee44ff',
  orbiter: '#ff44ff',
  splitter: '#ff44ee',
  phaser: '#ff44cc',
};

// ---------------------------------------------------------------------------
// PerformanceGraph
// ---------------------------------------------------------------------------

export class PerformanceGraph {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly config: GraphConfig;

  private data: PerformanceDataPoint[] = [];
  private viewport: ViewPort;

  // Mouse interaction state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartViewport: ViewPort | null = null;
  private mouseX = -1;
  private mouseY = -1;

  // Min/max FPS moments for markers
  private minFpsMoment: PerformanceDataPoint | null = null;
  private maxFpsMoment: PerformanceDataPoint | null = null;

  // Active chart type ('fps' | 'enemies' | 'bullets')
  private activeChart: 'fps' | 'enemies' | 'bullets' = 'fps';

  constructor(canvas: HTMLCanvasElement, config: Partial<GraphConfig> = {}) {
    this.canvas = canvas;
    this.config = { ...DEFAULT_CONFIG, ...config };

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;

    // Set canvas size
    canvas.width = this.config.width;
    canvas.height = this.config.height;
    canvas.style.width = `${this.config.width}px`;
    canvas.style.height = `${this.config.height}px`;

    // Initialize viewport (will be updated when data is set)
    this.viewport = { minTime: 0, maxTime: 10, minValue: 0, maxValue: 100 };

    this.attachEventListeners();
  }

  // -- Data API -------------------------------------------------------------

  /**
   * Set the data to display.
   */
  setData(data: PerformanceDataPoint[]): void {
    this.data = data;
    this.resetViewport();
    this.render();
  }

  /**
   * Set min/max FPS moments for marker display.
   */
  setFPSMoments(minFps: PerformanceDataPoint | null, maxFps: PerformanceDataPoint | null): void {
    this.minFpsMoment = minFps;
    this.maxFpsMoment = maxFps;
    this.render();
  }

  // -- Rendering ------------------------------------------------------------

  render(): void {
    const { ctx, config } = this;

    // Clear
    ctx.fillStyle = config.colors.background;
    ctx.fillRect(0, 0, config.width, config.height);

    if (this.data.length === 0) {
      this.drawNoData();
      return;
    }

    // Draw components
    this.drawGrid();
    this.drawAxes();
    if (this.activeChart === 'fps') {
      this.drawFPSMarkers();
    }
    this.drawDataLine();
    this.drawHoverTooltip();
  }

  /**
   * Render an FPS line chart.
   */
  renderFPSChart(): void {
    this.activeChart = 'fps';
    this.resetViewport();
    this.render();
  }

  /**
   * Render an enemy count line chart.
   */
  renderEnemyChart(): void {
    this.activeChart = 'enemies';
    this.resetViewport();
    this.render();
  }

  /**
   * Render a bullet count line chart.
   */
  renderBulletChart(): void {
    this.activeChart = 'bullets';
    this.resetViewport();
    this.render();
  }

  /**
   * Render an enemy type breakdown stacked area chart.
   */
  renderEnemyTypeChart(): void {
    const { ctx, config, data, viewport } = this;

    ctx.fillStyle = config.colors.background;
    ctx.fillRect(0, 0, config.width, config.height);

    if (data.length === 0) {
      this.drawNoData();
      return;
    }

    this.drawGrid();
    this.drawAxes();

    // Collect all enemy types
    const allTypes = new Set<EnemyType>();
    for (const point of data) {
      point.enemyTypes.forEach((_count, type) => {
        allTypes.add(type);
      });
    }
    const types = Array.from(allTypes);

    // Draw stacked areas
    const { left, top, right, bottom } = config.padding;
    const plotWidth = config.width - left - right;
    const plotHeight = config.height - top - bottom;

    // Filter data to viewport
    const visibleData = data.filter(
      p => p.time >= viewport.minTime && p.time <= viewport.maxTime
    );

    if (visibleData.length === 0) return;

    // For each enemy type, draw a filled area
    let prevY: number[] = new Array(visibleData.length).fill(plotHeight + top);

    for (const type of types) {
      ctx.beginPath();
      ctx.fillStyle = ENEMY_COLORS[type] || '#666666';

      const yValues: number[] = [];

      for (let i = 0; i < visibleData.length; i++) {
        const point = visibleData[i];
        const x = this.timeToPixel(point.time);
        const count = point.enemyTypes.get(type) || 0;
        const y = prevY[i] - this.valueToPixelHeight(count);
        yValues.push(y);

        if (i === 0) {
          ctx.moveTo(x, prevY[i]);
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Close path
      for (let i = visibleData.length - 1; i >= 0; i--) {
        const point = visibleData[i];
        const x = this.timeToPixel(point.time);
        ctx.lineTo(x, prevY[i]);
      }
      ctx.closePath();
      ctx.fill();

      prevY = yValues;
    }
  }

  // -- Internal rendering ---------------------------------------------------

  private drawNoData(): void {
    const { ctx, config } = this;
    ctx.fillStyle = config.colors.text;
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No performance data yet', config.width / 2, config.height / 2 - 15);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#556677';
    ctx.fillText('Play for a few seconds, then pause to see graphs.', config.width / 2, config.height / 2 + 15);
  }

  private drawGrid(): void {
    const { ctx, config, viewport } = this;
    const { left, top, right, bottom } = config.padding;
    const plotWidth = config.width - left - right;
    const plotHeight = config.height - top - bottom;

    ctx.strokeStyle = config.colors.grid;
    ctx.lineWidth = 1;

    // Horizontal grid lines (5 lines)
    for (let i = 0; i <= 5; i++) {
      const y = top + (plotHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
    }

    // Vertical grid lines (10 lines)
    for (let i = 0; i <= 10; i++) {
      const x = left + (plotWidth / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotHeight);
      ctx.stroke();
    }
  }

  private drawAxes(): void {
    const { ctx, config, viewport } = this;
    const { left, top, right, bottom } = config.padding;
    const plotWidth = config.width - left - right;
    const plotHeight = config.height - top - bottom;

    ctx.strokeStyle = config.colors.axis;
    ctx.lineWidth = 2;

    // Y axis
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + plotHeight);
    ctx.stroke();

    // X axis
    ctx.beginPath();
    ctx.moveTo(left, top + plotHeight);
    ctx.lineTo(left + plotWidth, top + plotHeight);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = config.colors.text;
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Y axis labels
    for (let i = 0; i <= 5; i++) {
      const value = viewport.minValue + ((viewport.maxValue - viewport.minValue) / 5) * (5 - i);
      const y = top + (plotHeight / 5) * i;
      ctx.fillText(Math.round(value).toString(), left - 10, y);
    }

    // X axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 10; i++) {
      const time = viewport.minTime + ((viewport.maxTime - viewport.minTime) / 10) * i;
      const x = left + (plotWidth / 10) * i;
      ctx.fillText(this.formatTime(time), x, top + plotHeight + 5);
    }
  }

  private drawFPSMarkers(): void {
    if (!this.minFpsMoment && !this.maxFpsMoment) return;

    const { ctx, config } = this;
    const { left, top, right, bottom } = config.padding;
    const plotHeight = config.height - top - bottom;

    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    if (this.minFpsMoment) {
      const x = this.timeToPixel(this.minFpsMoment.time);
      ctx.strokeStyle = config.colors.minFpsMarker;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotHeight);
      ctx.stroke();
    }

    if (this.maxFpsMoment) {
      const x = this.timeToPixel(this.maxFpsMoment.time);
      ctx.strokeStyle = config.colors.maxFpsMarker;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotHeight);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  private drawDataLine(): void {
    const { ctx, config, data, viewport } = this;

    // Filter data to viewport
    const visibleData = data.filter(
      p => p.time >= viewport.minTime && p.time <= viewport.maxTime
    );

    if (visibleData.length === 0) return;

    // Pick color and value accessor based on active chart type
    let color: string;
    let getValue: (p: PerformanceDataPoint) => number;

    if (this.activeChart === 'enemies') {
      color = config.colors.enemies;
      getValue = (p) => p.enemyCount;
    } else if (this.activeChart === 'bullets') {
      color = config.colors.bullets;
      getValue = (p) => p.bulletCount;
    } else {
      color = config.colors.fps;
      getValue = (p) => p.fps;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < visibleData.length; i++) {
      const point = visibleData[i];
      const x = this.timeToPixel(point.time);
      const y = this.valueToPixel(getValue(point));

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }

  private drawHoverTooltip(): void {
    if (this.mouseX < 0 || this.mouseY < 0) return;

    const { ctx, config } = this;
    const { left, top, right, bottom } = config.padding;
    const plotWidth = config.width - left - right;
    const plotHeight = config.height - top - bottom;

    // Check if mouse is in plot area
    if (
      this.mouseX < left ||
      this.mouseX > left + plotWidth ||
      this.mouseY < top ||
      this.mouseY > top + plotHeight
    ) {
      return;
    }

    // Find nearest data point
    const time = this.pixelToTime(this.mouseX);
    const nearest = this.findNearestPoint(time);

    if (!nearest) return;

    // Draw tooltip
    const tooltipLines = [
      `Time: ${this.formatTime(nearest.time)}`,
      `FPS: ${nearest.fps.toFixed(1)}`,
      `Enemies: ${nearest.enemyCount}`,
      `Bullets: ${nearest.bulletCount}`,
    ];

    ctx.fillStyle = 'rgba(0, 0, 20, 0.9)';
    ctx.strokeStyle = config.colors.axis;
    ctx.lineWidth = 1;

    const tooltipPadding = 8;
    const lineHeight = 16;
    const tooltipWidth = 150;
    const tooltipHeight = tooltipLines.length * lineHeight + tooltipPadding * 2;

    let tooltipX = this.mouseX + 10;
    let tooltipY = this.mouseY + 10;

    // Keep tooltip in bounds
    if (tooltipX + tooltipWidth > config.width) {
      tooltipX = this.mouseX - tooltipWidth - 10;
    }
    if (tooltipY + tooltipHeight > config.height) {
      tooltipY = this.mouseY - tooltipHeight - 10;
    }

    ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

    ctx.fillStyle = config.colors.text;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let i = 0; i < tooltipLines.length; i++) {
      ctx.fillText(
        tooltipLines[i],
        tooltipX + tooltipPadding,
        tooltipY + tooltipPadding + i * lineHeight
      );
    }
  }

  // -- Coordinate transformations -------------------------------------------

  private timeToPixel(time: number): number {
    const { config, viewport } = this;
    const { left, right } = config.padding;
    const plotWidth = config.width - left - right;
    const t = (time - viewport.minTime) / (viewport.maxTime - viewport.minTime);
    return left + t * plotWidth;
  }

  private pixelToTime(x: number): number {
    const { config, viewport } = this;
    const { left, right } = config.padding;
    const plotWidth = config.width - left - right;
    const t = (x - left) / plotWidth;
    return viewport.minTime + t * (viewport.maxTime - viewport.minTime);
  }

  private valueToPixel(value: number): number {
    const { config, viewport } = this;
    const { top, bottom } = config.padding;
    const plotHeight = config.height - top - bottom;
    const t = (value - viewport.minValue) / (viewport.maxValue - viewport.minValue);
    return top + plotHeight * (1 - t);
  }

  private valueToPixelHeight(value: number): number {
    const { config, viewport } = this;
    const { top, bottom } = config.padding;
    const plotHeight = config.height - top - bottom;
    const t = value / (viewport.maxValue - viewport.minValue);
    return plotHeight * t;
  }

  private findNearestPoint(time: number): PerformanceDataPoint | null {
    if (this.data.length === 0) return null;

    let nearest = this.data[0];
    let minDist = Math.abs(time - nearest.time);

    for (const point of this.data) {
      const dist = Math.abs(time - point.time);
      if (dist < minDist) {
        minDist = dist;
        nearest = point;
      }
    }

    return nearest;
  }

  // -- Viewport management --------------------------------------------------

  private resetViewport(): void {
    if (this.data.length === 0) {
      this.viewport = { minTime: 0, maxTime: 10, minValue: 0, maxValue: 100 };
      return;
    }

    // Pick value accessor based on active chart type
    let getValue: (p: PerformanceDataPoint) => number;
    if (this.activeChart === 'enemies') {
      getValue = (p) => p.enemyCount;
    } else if (this.activeChart === 'bullets') {
      getValue = (p) => p.bulletCount;
    } else {
      getValue = (p) => p.fps;
    }

    let minTime = Infinity;
    let maxTime = -Infinity;
    let minValue = Infinity;
    let maxValue = -Infinity;

    for (const point of this.data) {
      const value = getValue(point);
      minTime = Math.min(minTime, point.time);
      maxTime = Math.max(maxTime, point.time);
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    }

    // Guard against degenerate cases (single data point or all same values)
    // which cause division by zero in coordinate transforms
    if (maxTime - minTime < 0.001) {
      // Single data point or all at the same time
      minTime = minTime - 5;
      maxTime = maxTime + 5;
    }
    if (maxValue - minValue < 0.001) {
      // All values identical — show range around the value
      const center = (minValue + maxValue) / 2;
      minValue = Math.max(0, center - 10);
      maxValue = center + 10;
    }

    // Add padding
    const timePadding = (maxTime - minTime) * 0.05;
    const valuePadding = (maxValue - minValue) * 0.1;

    this.viewport = {
      minTime: minTime - timePadding,
      maxTime: maxTime + timePadding,
      minValue: Math.max(0, minValue - valuePadding),
      maxValue: maxValue + valuePadding,
    };
  }

  // -- Event handlers -------------------------------------------------------

  private attachEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    this.canvas.addEventListener('wheel', this.onWheel);
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.isDragging = true;
    this.dragStartX = e.offsetX;
    this.dragStartViewport = { ...this.viewport };
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.offsetX;
    this.mouseY = e.offsetY;

    if (this.isDragging && this.dragStartViewport) {
      const dx = e.offsetX - this.dragStartX;
      const { config, dragStartViewport: start } = this;
      const { left, right } = config.padding;
      const plotWidth = config.width - left - right;

      const timeRange = start.maxTime - start.minTime;
      const dt = (-dx / plotWidth) * timeRange;

      this.viewport.minTime = start.minTime + dt;
      this.viewport.maxTime = start.maxTime + dt;
    }

    this.render();
  };

  private onMouseUp = (): void => {
    this.isDragging = false;
    this.dragStartViewport = null;
  };

  private onMouseLeave = (): void => {
    this.isDragging = false;
    this.dragStartViewport = null;
    this.mouseX = -1;
    this.mouseY = -1;
    this.render();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const timeRange = this.viewport.maxTime - this.viewport.minTime;
    const newRange = timeRange * zoomFactor;
    const center = (this.viewport.minTime + this.viewport.maxTime) / 2;

    this.viewport.minTime = center - newRange / 2;
    this.viewport.maxTime = center + newRange / 2;

    this.render();
  };

  // -- Utilities ------------------------------------------------------------

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  // -- Cleanup --------------------------------------------------------------

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
