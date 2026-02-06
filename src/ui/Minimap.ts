/**
 * Minimap/radar overlay showing UV-space positions of entities.
 * Renders a small canvas in the corner showing:
 * - Player position (cyan dot)
 * - Enemy positions (red dots)
 * - Geom positions (green dots)
 * - Surface boundary outline
 */

interface MinimapEntity {
  u: number;
  v: number;
  color: string;
  size: number;
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly size = 120;
  private readonly padding = 8;
  private visible = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: ${this.size}px;
      height: ${this.size}px;
      border: 1px solid rgba(0, 255, 255, 0.3);
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.5);
      pointer-events: none;
      z-index: 100;
    `;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  update(
    playerU: number,
    playerV: number,
    enemies: Array<{ u: number; v: number; alive: boolean }>,
    geoms: Array<{ u: number; v: number }>,
  ): void {
    if (!this.visible) return;

    const ctx = this.ctx;
    const s = this.size;
    const p = this.padding;
    const inner = s - p * 2;

    // Clear
    ctx.clearRect(0, 0, s, s);

    // Draw surface boundary
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p, p, inner, inner);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const offset = p + (inner * i) / 4;
      ctx.beginPath();
      ctx.moveTo(offset, p);
      ctx.lineTo(offset, s - p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, offset);
      ctx.lineTo(s - p, offset);
      ctx.stroke();
    }

    // Helper to convert UV to canvas coords
    const toX = (u: number) => p + u * inner;
    const toY = (v: number) => p + v * inner;

    // Draw geoms (small green dots)
    ctx.fillStyle = '#00ff00';
    for (const geom of geoms) {
      ctx.beginPath();
      ctx.arc(toX(geom.u), toY(geom.v), 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw enemies (red dots)
    ctx.fillStyle = '#ff4444';
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      ctx.beginPath();
      ctx.arc(toX(enemy.u), toY(enemy.v), 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw player (cyan dot with glow)
    const px = toX(playerU);
    const py = toY(playerV);
    ctx.fillStyle = '#00ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  dispose(): void {
    document.body.removeChild(this.canvas);
  }
}
