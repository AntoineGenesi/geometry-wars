// BrailleAnimator.ts — text-mode animation engine using Unicode Braille characters.
// Each character U+2800–U+28FF encodes an 8-dot grid:
//   Bits 0-2: left column (top→bottom)
//   Bits 3-5: right column (top→bottom)
//   Bits 6-7: bottom row (left, right)
//   String.fromCharCode(0x2800 | dotMask)
// No Three.js. No setInterval. Uses requestAnimationFrame only.

// ── Types ────────────────────────────────────────────────────────────────────

export type BraillePattern =
  | 'orbit' | 'breathing' | 'snake' | 'fillSweep' | 'pulse'
  | 'columns' | 'checkerboard' | 'scan' | 'rain' | 'cascade'
  | 'sparkle' | 'wave' | 'rose' | 'helix' | 'diagonalSwipe'
  | 'vortex' | 'bouncing' | 'ripple' | 'fireworks' | 'crosshatch'
  | 'diamonds' | 'zigzag' | 'spiral' | 'binary' | 'static';

export const ALL_PATTERNS: BraillePattern[] = [
  'orbit', 'breathing', 'snake', 'fillSweep', 'pulse',
  'columns', 'checkerboard', 'scan', 'rain', 'cascade',
  'sparkle', 'wave', 'rose', 'helix', 'diagonalSwipe',
  'vortex', 'bouncing', 'ripple', 'fireworks', 'crosshatch',
  'diamonds', 'zigzag', 'spiral', 'binary', 'static',
];

type PatternFn = (frame: number, cols: number, rows: number, intensity: number) => number[][];

export interface BrailleAnimatorOptions {
  cols?: number;      // default 20
  rows?: number;      // default 6
  pattern?: BraillePattern; // default 'pulse'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGrid(rows: number, cols: number, fill = 0): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

// ── Pattern implementations ───────────────────────────────────────────────────

function patternOrbit(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const angle = frame * 0.08;
  const radius = (Math.min(cols, rows) / 2) * (0.3 + intensity * 0.5);
  const cx = cols / 2, cy = rows / 2;
  const x = Math.round(cx + Math.cos(angle) * radius);
  const y = Math.round(cy + Math.sin(angle) * radius);
  if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  return grid;
}

function patternBreathing(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const t = (Math.sin(frame * 0.05) + 1) / 2; // 0..1
  const bits = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
  const count = Math.round(t * intensity * 8);
  const mask = bits.slice(0, count).reduce((a, b) => a | b, 0);
  return Array.from({ length: rows }, () => new Array(cols).fill(mask));
}

function patternSnake(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const step = Math.floor(frame * 0.3 * (0.5 + intensity));
  const total = rows * cols;
  const pos = step % total;
  const r = Math.floor(pos / cols);
  const c = r % 2 === 0 ? pos % cols : cols - 1 - (pos % cols);
  if (r >= 0 && r < rows) grid[r][c] = 0xFF;
  return grid;
}

function patternFillSweep(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const phase = (frame * 0.02 * (0.5 + intensity)) % 1;
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (_, c) => (c / cols) < phase ? 0xFF : 0x00)
  );
}

function patternPulse(frame: number, _cols: number, rows: number, intensity: number): number[][] {
  const phase = Math.sin(frame * 0.1 * (0.5 + intensity));
  const mask = phase > 0 ? 0xFF : 0x00;
  const cols = _cols;
  return Array.from({ length: rows }, () => new Array(cols).fill(mask));
}

function patternColumns(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const col = Math.floor(frame * 0.15 * (0.5 + intensity)) % cols;
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (_, c) => c === col ? 0xFF : 0x00)
  );
}

function patternCheckerboard(frame: number, cols: number, rows: number, _intensity: number): number[][] {
  const flip = (frame >> 2) & 1;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      ((r + c + flip) & 1) ? 0xFF : 0x00
    )
  );
}

function patternScan(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const row = Math.floor(frame * 0.2 * (0.5 + intensity)) % rows;
  grid[row].fill(0xFF);
  return grid;
}

function patternRain(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  for (let c = 0; c < cols; c++) {
    const hash = Math.sin(c * 127.1 + frame * 0.05) * 43758.5453;
    const frac = hash - Math.floor(hash);
    if (frac < intensity * 0.4) {
      const r = Math.floor((frac * 100 + frame * 0.3) % rows);
      if (r >= 0 && r < rows) grid[r][c] = 0xFF;
    }
  }
  return grid;
}

function patternCascade(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const total = rows * cols;
  const filled = Math.round((frame * 0.5 * intensity) % (total * 2));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r * cols + c) < filled % total ? 0xFF : 0x00)
  );
}

function patternSparkle(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const h = Math.sin(r * 7.7 + c * 31.3 + frame * 0.7) * 0.5 + 0.5;
      return h < intensity * 0.15 ? 0xFF : 0x00;
    })
  );
}

function patternWave(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  for (let c = 0; c < cols; c++) {
    const y = Math.round((rows / 2) + Math.sin((c * 0.5) + frame * 0.1) * (rows / 2 - 1) * intensity);
    const row = Math.max(0, Math.min(rows - 1, y));
    grid[row][c] = 0xFF;
  }
  return grid;
}

function patternRose(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const angle = frame * 0.03;
  const cx = cols / 2, cy = rows / 2;
  for (let i = 0; i < 200; i++) {
    const theta = (i / 200) * Math.PI * 4;
    const r = Math.cos(3 * theta + angle) * intensity;
    const x = Math.round(cx + r * cols * 0.4 * Math.cos(theta));
    const y = Math.round(cy + r * rows * 0.4 * Math.sin(theta));
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternHelix(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  for (let c = 0; c < cols; c++) {
    const phase = c * 0.4 + frame * 0.08;
    const y1 = Math.round((rows / 2) + Math.sin(phase) * (rows / 2 - 1) * intensity);
    const y2 = Math.round((rows / 2) + Math.sin(phase + Math.PI) * (rows / 2 - 1) * intensity);
    if (y1 >= 0 && y1 < rows) grid[y1][c] = 0xFF;
    if (y2 >= 0 && y2 < rows) grid[y2][c] = 0xFF;
  }
  return grid;
}

function patternDiagonalSwipe(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const sweep = (frame * 0.3 * (0.5 + intensity)) % (cols + rows);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => Math.abs((r + c) - sweep) < 1.5 ? 0xFF : 0x00)
  );
}

function patternVortex(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const cx = cols / 2, cy = rows / 2;
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const angle = t * Math.PI * 4 + frame * 0.1;
    const r = (1 - t) * Math.min(cols, rows) * 0.45 * intensity;
    const x = Math.round(cx + Math.cos(angle) * r);
    const y = Math.round(cy + Math.sin(angle) * r);
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternBouncing(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const x = Math.round(Math.abs(Math.sin(frame * 0.07 * (0.5 + intensity))) * (cols - 1));
  const y = Math.round(Math.abs(Math.cos(frame * 0.05 * (0.5 + intensity))) * (rows - 1));
  grid[y][x] = 0xFF;
  return grid;
}

function patternRipple(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2);
      const wave = Math.sin(dist * 1.2 - frame * 0.15 * (0.5 + intensity));
      return wave > 0.5 ? 0xFF : 0x00;
    })
  );
}

function patternFireworks(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const burst = frame % 40;
  const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
  for (let a = 0; a < 8; a++) {
    const angle = (a / 8) * Math.PI * 2;
    const r = burst * 0.25 * intensity;
    const x = Math.round(cx + Math.cos(angle) * r);
    const y = Math.round(cy + Math.sin(angle) * r);
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternCrosshatch(_frame: number, cols: number, rows: number, intensity: number): number[][] {
  const spacing = Math.max(2, Math.round(4 / Math.max(intensity, 0.01)));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      (r % spacing === 0 || c % spacing === 0) ? 0xFF : 0x00
    )
  );
}

function patternDiamonds(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  const size = ((frame * 0.2 * intensity) % Math.max(cols, rows));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const dist = Math.abs(c - cx) + Math.abs(r - cy);
      return Math.abs(dist - size) < 1.0 ? 0xFF : 0x00;
    })
  );
}

function patternZigzag(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const offset = Math.floor(frame * 0.2 * (0.5 + intensity));
  for (let c = 0; c < cols; c++) {
    const r = ((c + offset) % (rows * 2));
    const row = r < rows ? r : rows * 2 - r - 1;
    if (row >= 0 && row < rows) grid[row][c] = 0xFF;
  }
  return grid;
}

function patternSpiral(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const cx = cols / 2, cy = rows / 2;
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const angle = t * Math.PI * 6 + frame * 0.05;
    const r = t * Math.min(cols, rows) * 0.45 * intensity;
    const x = Math.round(cx + Math.cos(angle) * r);
    const y = Math.round(cy + Math.sin(angle) * r);
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternBinary(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const val = Math.floor((c + frame * 0.3 * intensity) % 256);
      return (val >> r) & 1 ? 0xFF : 0x00;
    })
  );
}

function patternStatic(_frame: number, cols: number, rows: number, intensity: number): number[][] {
  const threshold = intensity * 0.8;
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () =>
      Math.random() < threshold ? (Math.random() * 255 | 0) : 0
    )
  );
}

// ── Pattern registry ──────────────────────────────────────────────────────────

const PATTERN_REGISTRY: Record<BraillePattern, PatternFn> = {
  orbit: patternOrbit,
  breathing: patternBreathing,
  snake: patternSnake,
  fillSweep: patternFillSweep,
  pulse: patternPulse,
  columns: patternColumns,
  checkerboard: patternCheckerboard,
  scan: patternScan,
  rain: patternRain,
  cascade: patternCascade,
  sparkle: patternSparkle,
  wave: patternWave,
  rose: patternRose,
  helix: patternHelix,
  diagonalSwipe: patternDiagonalSwipe,
  vortex: patternVortex,
  bouncing: patternBouncing,
  ripple: patternRipple,
  fireworks: patternFireworks,
  crosshatch: patternCrosshatch,
  diamonds: patternDiamonds,
  zigzag: patternZigzag,
  spiral: patternSpiral,
  binary: patternBinary,
  static: patternStatic,
};

// ── BrailleAnimator class ─────────────────────────────────────────────────────

export class BrailleAnimator {
  private readonly container: HTMLElement;
  private readonly cols: number;
  private readonly rows: number;
  private pattern: BraillePattern;
  private intensity: number = 0.7;
  private frame: number = 0;
  private rafHandle: number | null = null;
  private disposed: boolean = false;

  constructor(container: HTMLElement, options: BrailleAnimatorOptions = {}) {
    this.container = container;
    this.cols = options.cols ?? 20;
    this.rows = options.rows ?? 6;
    this.pattern = options.pattern ?? 'pulse';
  }

  setPattern(pattern: BraillePattern): void {
    this.pattern = pattern;
  }

  setIntensity(level: number): void {
    this.intensity = Math.max(0, Math.min(1, level));
  }

  start(): void {
    if (this.disposed || this.rafHandle !== null) return;
    const tick = () => {
      this.render();
      this.frame++;
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  dispose(): void {
    this.stop();
    this.container.textContent = '';
    this.disposed = true;
  }

  private render(): void {
    const fn = PATTERN_REGISTRY[this.pattern];
    const matrix = fn(this.frame, this.cols, this.rows, this.intensity);
    const lines = matrix.map(row =>
      row.map(mask => String.fromCharCode(0x2800 | (mask & 0xFF))).join('')
    );
    this.container.textContent = lines.join('\n');
  }
}
