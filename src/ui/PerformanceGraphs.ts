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
export const ENEMY_COLORS: Record<string, string> = {
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
  private renderScheduled = false;

  // Min/max FPS moments for markers
  private minFpsMoment: PerformanceDataPoint | null = null;
  private maxFpsMoment: PerformanceDataPoint | null = null;

  // Active chart type
  private activeChart: 'fps' | 'enemies' | 'bullets' | 'types' | 'unified' | 'stacked' = 'unified';

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
    this.drawChartTitle();

    if (this.activeChart === 'unified') {
      this.drawUnifiedChart();
    } else if (this.activeChart === 'stacked') {
      this.drawStackedAreaChart();
    } else if (this.activeChart === 'types') {
      this.drawEnemyTypeBars();
    } else {
      if (this.activeChart === 'fps') {
        this.drawFPSMarkers();
      }
      this.drawDataLine();
    }

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
   * Render an enemy type breakdown bar chart.
   */
  renderEnemyTypeChart(): void {
    this.activeChart = 'types';
    this.resetViewport();
    this.render();
  }

  /**
   * Render unified performance chart: FPS, enemies, and bullets normalized to 0-100%
   * so correlations between them are visible on a single axis.
   */
  renderUnifiedChart(): void {
    this.activeChart = 'unified';
    this.resetViewport();
    this.render();
  }

  /**
   * Render stacked area chart showing enemy type composition over time.
   * Each type's area stacks cumulatively (waterfall style).
   */
  renderStackedAreaChart(): void {
    this.activeChart = 'stacked';
    this.resetViewport();
    this.render();
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

  private drawChartTitle(): void {
    const { ctx, config } = this;
    const { left, right } = config.padding;
    const plotWidth = config.width - left - right;
    const centerX = left + plotWidth / 2;

    let title = '';
    if (this.activeChart === 'unified') {
      title = 'Unified Performance (Normalized %)';
    } else if (this.activeChart === 'stacked') {
      title = 'Enemy Type Composition Over Time';
    } else if (this.activeChart === 'fps') {
      title = 'FPS Over Time';
    } else if (this.activeChart === 'enemies') {
      title = 'Enemy Count Over Time';
    } else if (this.activeChart === 'bullets') {
      title = 'Bullet Count Over Time';
    } else if (this.activeChart === 'types') {
      title = 'Enemy Types Breakdown';
    }

    ctx.fillStyle = config.colors.text;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(title, centerX, 5);
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
    const showPctSuffix = this.activeChart === 'unified';
    for (let i = 0; i <= 5; i++) {
      const value = viewport.minValue + ((viewport.maxValue - viewport.minValue) / 5) * (5 - i);
      const y = top + (plotHeight / 5) * i;
      ctx.fillText(Math.round(value).toString() + (showPctSuffix ? '%' : ''), left - 10, y);
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

  private drawEnemyTypeBars(): void {
    const { ctx, config, data } = this;
    const { left, top, right, bottom } = config.padding;
    const plotWidth = config.width - left - right;
    const plotHeight = config.height - top - bottom;

    // Collect all enemy types and their total counts
    const typeCounts = new Map<EnemyType, number>();
    for (const point of data) {
      point.enemyTypes.forEach((count, type) => {
        typeCounts.set(type, (typeCounts.get(type) || 0) + count);
      });
    }

    const types = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]); // Sort by count descending
    if (types.length === 0) return;

    const barWidth = plotWidth / types.length;
    const maxCount = Math.max(...types.map(([, count]) => count));

    // Draw bars
    types.forEach(([type, count], index) => {
      const x = left + index * barWidth;
      const barHeight = (count / maxCount) * plotHeight;
      const y = top + plotHeight - barHeight;

      ctx.fillStyle = ENEMY_COLORS[type] || '#666666';
      ctx.fillRect(x + 2, y, barWidth - 4, barHeight);

      // Draw type label (rotated)
      ctx.save();
      ctx.translate(x + barWidth / 2, top + plotHeight + 5);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = config.colors.text;
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(type, 0, 0);
      ctx.restore();

      // Draw count label on bar
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(count.toString(), x + barWidth / 2, y - 2);
    });
  }

  /**
   * Unified performance chart: FPS, enemy count, and bullet count normalized
   * to 0-100% on the same axis so correlations between them are visible.
   */
  private drawUnifiedChart(): void {
    const { ctx, config, data, viewport } = this;

    if (data.length === 0) return;

    // Compute global maxes from ALL data (not just viewport) so scale stays stable while panning
    let maxFps = 1, maxEnemies = 1, maxBullets = 1;
    for (const p of data) {
      if (p.fps > maxFps) maxFps = p.fps;
      if (p.enemyCount > maxEnemies) maxEnemies = p.enemyCount;
      if (p.bulletCount > maxBullets) maxBullets = p.bulletCount;
    }

    // Filter to viewport
    const visible = data.filter(p => p.time >= viewport.minTime && p.time <= viewport.maxTime);
    if (visible.length < 2) return;

    const { left, top, right, bottom } = config.padding;
    const plotHeight = config.height - top - bottom;

    // Draw transparent fill areas first
    const drawFill = (color: string, getValue: (p: PerformanceDataPoint) => number, maxVal: number) => {
      ctx.beginPath();
      ctx.moveTo(this.timeToPixel(visible[0].time), this.valueToPixel(getValue(visible[0]) / maxVal * 100));
      for (let i = 1; i < visible.length; i++) {
        ctx.lineTo(this.timeToPixel(visible[i].time), this.valueToPixel(getValue(visible[i]) / maxVal * 100));
      }
      ctx.lineTo(this.timeToPixel(visible[visible.length - 1].time), top + plotHeight);
      ctx.lineTo(this.timeToPixel(visible[0].time), top + plotHeight);
      ctx.closePath();
      ctx.fillStyle = color + '18';
      ctx.fill();
    };

    // Draw lines
    const drawLine = (color: string, getValue: (p: PerformanceDataPoint) => number, maxVal: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < visible.length; i++) {
        const x = this.timeToPixel(visible[i].time);
        const y = this.valueToPixel(getValue(visible[i]) / maxVal * 100);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawFill(config.colors.fps, p => p.fps, maxFps);
    drawFill(config.colors.enemies, p => p.enemyCount, maxEnemies);
    drawFill(config.colors.bullets, p => p.bulletCount, maxBullets);

    drawLine(config.colors.fps, p => p.fps, maxFps);
    drawLine(config.colors.enemies, p => p.enemyCount, maxEnemies);
    drawLine(config.colors.bullets, p => p.bulletCount, maxBullets);

    // Draw legend in top-right area
    const legendItems = [
      { color: config.colors.fps, label: `FPS  (max: ${Math.round(maxFps)})` },
      { color: config.colors.enemies, label: `Enemies (max: ${maxEnemies})` },
      { color: config.colors.bullets, label: `Bullets (max: ${maxBullets})` },
    ];
    const legendX = config.width - right - 175;
    const legendY = top + 5;
    ctx.fillStyle = 'rgba(0,0,20,0.75)';
    ctx.fillRect(legendX - 6, legendY - 4, 178, legendItems.length * 18 + 8);
    for (let i = 0; i < legendItems.length; i++) {
      const item = legendItems[i];
      const y = legendY + i * 18;
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, y, 12, 12);
      ctx.fillStyle = config.colors.text;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.label, legendX + 16, y);
    }
  }

  /**
   * Stacked area chart: shows enemy type composition over time.
   * Each type stacks cumulatively from the bottom (waterfall style).
   */
  private drawStackedAreaChart(): void {
    const { ctx, config, data, viewport } = this;

    const visible = data.filter(p => p.time >= viewport.minTime && p.time <= viewport.maxTime);
    if (visible.length < 2) return;

    // Collect all enemy types and sort by total count (most common → bottom of stack)
    const typeTotals = new Map<string, number>();
    for (const point of visible) {
      point.enemyTypes.forEach((count, type) => {
        typeTotals.set(type, (typeTotals.get(type) || 0) + count);
      });
    }

    const sortedTypes = Array.from(typeTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);

    if (sortedTypes.length === 0) {
      // No enemy type data — fall back to showing total enemy count
      const { left, top, right, bottom } = config.padding;
      const plotHeight = config.height - top - bottom;
      ctx.beginPath();
      for (let i = 0; i < visible.length; i++) {
        const x = this.timeToPixel(visible[i].time);
        const y = this.valueToPixel(visible[i].enemyCount);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(this.timeToPixel(visible[visible.length - 1].time), top + plotHeight);
      ctx.lineTo(this.timeToPixel(visible[0].time), top + plotHeight);
      ctx.closePath();
      ctx.fillStyle = config.colors.enemies + '88';
      ctx.fill();
      return;
    }

    // Draw each type's band (bottom to top)
    for (let ti = 0; ti < sortedTypes.length; ti++) {
      const type = sortedTypes[ti];
      const color = ENEMY_COLORS[type] || '#888888';

      ctx.beginPath();

      // Forward pass: top edge of this band
      for (let i = 0; i < visible.length; i++) {
        const point = visible[i];
        const x = this.timeToPixel(point.time);
        let cumTop = 0;
        for (let k = 0; k <= ti; k++) {
          cumTop += point.enemyTypes.get(sortedTypes[k] as EnemyType) || 0;
        }
        const y = this.valueToPixel(cumTop);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      // Backward pass: bottom edge of this band
      for (let i = visible.length - 1; i >= 0; i--) {
        const point = visible[i];
        const x = this.timeToPixel(point.time);
        let cumBottom = 0;
        for (let k = 0; k < ti; k++) {
          cumBottom += point.enemyTypes.get(sortedTypes[k] as EnemyType) || 0;
        }
        const y = this.valueToPixel(cumBottom);
        ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.fillStyle = color + 'bb';
      ctx.fill();

      // Top stroke for band boundary clarity
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < visible.length; i++) {
        const point = visible[i];
        const x = this.timeToPixel(point.time);
        let cumTop = 0;
        for (let k = 0; k <= ti; k++) {
          cumTop += point.enemyTypes.get(sortedTypes[k] as EnemyType) || 0;
        }
        const y = this.valueToPixel(cumTop);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Legend: top-right, up to 10 most common types
    const legendTypes = sortedTypes.slice(0, 10);
    const { right, top } = config.padding;
    const legendX = config.width - right - 175;
    const legendY = top + 5;
    ctx.fillStyle = 'rgba(0,0,20,0.75)';
    ctx.fillRect(legendX - 6, legendY - 4, 178, legendTypes.length * 16 + 8);
    for (let i = 0; i < legendTypes.length; i++) {
      const type = legendTypes[i];
      const color = ENEMY_COLORS[type] || '#888888';
      const y = legendY + i * 16;
      ctx.fillStyle = color;
      ctx.fillRect(legendX, y, 10, 10);
      ctx.fillStyle = config.colors.text;
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${type}: ${typeTotals.get(type)}`, legendX + 14, y);
    }
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

    let tooltipLines: string[];

    if (this.activeChart === 'types') {
      // For enemy types chart, show which bar is being hovered
      const typeCounts = new Map<EnemyType, number>();
      for (const point of this.data) {
        point.enemyTypes.forEach((count, type) => {
          typeCounts.set(type, (typeCounts.get(type) || 0) + count);
        });
      }

      const types = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
      if (types.length === 0) return;

      const barWidth = plotWidth / types.length;
      const barIndex = Math.floor((this.mouseX - left) / barWidth);

      if (barIndex < 0 || barIndex >= types.length) return;

      const [type, count] = types[barIndex];

      // Calculate average FPS contribution (approximate)
      let totalFps = 0;
      let dataPointsWithType = 0;
      for (const point of this.data) {
        if (point.enemyTypes.has(type)) {
          totalFps += point.fps;
          dataPointsWithType++;
        }
      }
      const avgFps = dataPointsWithType > 0 ? totalFps / dataPointsWithType : 0;

      tooltipLines = [
        `Type: ${type}`,
        `Total Killed: ${count}`,
        `Avg FPS: ${avgFps.toFixed(1)}`,
      ];
    } else if (this.activeChart === 'stacked') {
      // For stacked area chart, show enemy type breakdown at nearest time point
      const time = this.pixelToTime(this.mouseX);
      const nearest = this.findNearestPoint(time);
      if (!nearest) return;

      const topTypes = Array.from(nearest.enemyTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([type, count]) => `  ${type}: ${count}`);

      tooltipLines = [
        `Time: ${this.formatTime(nearest.time)}`,
        `Total: ${nearest.enemyCount}`,
        ...topTypes,
      ];
    } else {
      // For time-series charts (fps/enemies/bullets/unified), show nearest data point
      const time = this.pixelToTime(this.mouseX);
      const nearest = this.findNearestPoint(time);

      if (!nearest) return;

      tooltipLines = [
        `Time: ${this.formatTime(nearest.time)}`,
        `FPS: ${nearest.fps.toFixed(1)}`,
        `Enemies: ${nearest.enemyCount}`,
        `Bullets: ${nearest.bulletCount}`,
      ];
    }

    ctx.fillStyle = 'rgba(0, 0, 20, 0.9)';
    ctx.strokeStyle = config.colors.axis;
    ctx.lineWidth = 1;

    const tooltipPadding = 8;
    const lineHeight = 16;
    const tooltipWidth = this.activeChart === 'stacked' ? 190 : 150;
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

    // For unified chart: Y axis is always 0-100% (normalized), X is time range
    if (this.activeChart === 'unified') {
      let minTime = this.data[0].time;
      let maxTime = this.data[this.data.length - 1].time;
      if (maxTime - minTime < 0.001) { minTime -= 5; maxTime += 5; }
      const timePad = (maxTime - minTime) * 0.05;
      this.viewport = { minTime: minTime - timePad, maxTime: maxTime + timePad, minValue: 0, maxValue: 100 };
      return;
    }

    // For stacked area chart: Y axis is 0 to max cumulative enemy count
    if (this.activeChart === 'stacked') {
      let maxTotal = 1;
      let minTime = Infinity, maxTime = -Infinity;
      for (const point of this.data) {
        let total = 0;
        point.enemyTypes.forEach(count => { total += count; });
        maxTotal = Math.max(maxTotal, total);
        minTime = Math.min(minTime, point.time);
        maxTime = Math.max(maxTime, point.time);
      }
      if (minTime === Infinity) { minTime = 0; maxTime = 10; }
      if (maxTime - minTime < 0.001) { minTime -= 5; maxTime += 5; }
      const timePad = (maxTime - minTime) * 0.05;
      this.viewport = { minTime: minTime - timePad, maxTime: maxTime + timePad, minValue: 0, maxValue: maxTotal * 1.05 };
      return;
    }

    // For types chart, use special viewport (bar chart doesn't need time/value ranges)
    if (this.activeChart === 'types') {
      // Count total enemy types for bar chart
      const typeCounts = new Map<EnemyType, number>();
      for (const point of this.data) {
        point.enemyTypes.forEach((count, type) => {
          typeCounts.set(type, (typeCounts.get(type) || 0) + count);
        });
      }
      const maxCount = typeCounts.size > 0 ? Math.max(...Array.from(typeCounts.values())) : 100;
      this.viewport = { minTime: 0, maxTime: typeCounts.size, minValue: 0, maxValue: maxCount * 1.1 };
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
    this.canvas.addEventListener('click', this.onClick);
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

    // Throttle rendering using requestAnimationFrame to avoid excessive redraws
    if (!this.renderScheduled) {
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }
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

    // Throttle rendering using requestAnimationFrame to avoid excessive redraws
    if (!this.renderScheduled) {
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }
  };

  private onClick = (e: MouseEvent): void => {
    const { left, top, right, bottom } = this.config.padding;
    const plotWidth = this.config.width - left - right;
    const plotHeight = this.config.height - top - bottom;

    // Check if click is in plot area
    if (
      e.offsetX < left ||
      e.offsetX > left + plotWidth ||
      e.offsetY < top ||
      e.offsetY > top + plotHeight
    ) {
      return;
    }

    if (this.activeChart === 'types') {
      // For enemy types chart, log clicked bar
      const typeCounts = new Map<EnemyType, number>();
      for (const point of this.data) {
        point.enemyTypes.forEach((count, type) => {
          typeCounts.set(type, (typeCounts.get(type) || 0) + count);
        });
      }

      const types = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
      if (types.length === 0) return;

      const barWidth = plotWidth / types.length;
      const barIndex = Math.floor((e.offsetX - left) / barWidth);

      if (barIndex >= 0 && barIndex < types.length) {
        const [type, count] = types[barIndex];
        console.log(`[Performance Graph] Clicked enemy type: ${type}, Total Killed: ${count}`);
      }
    } else {
      // For time-series charts, log nearest data point
      const time = this.pixelToTime(e.offsetX);
      const nearest = this.findNearestPoint(time);

      if (nearest) {
        console.log(`[Performance Graph] Clicked data point:`, {
          time: this.formatTime(nearest.time),
          fps: nearest.fps.toFixed(1),
          enemies: nearest.enemyCount,
          bullets: nearest.bulletCount,
          enemyTypes: Array.from(nearest.enemyTypes.entries()),
        });
      }
    }
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
    this.canvas.removeEventListener('click', this.onClick);
  }
}
