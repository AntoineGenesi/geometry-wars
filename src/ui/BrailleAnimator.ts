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
  | 'diamonds' | 'zigzag' | 'spiral' | 'binary' | 'static'
  | 'clockwise' | 'counterClockwise' | 'hourglass' | 'pendulum' | 'meteor'
  | 'lightning' | 'aurora' | 'matrix' | 'heartbeat' | 'explosion'
  | 'shatter' | 'wormhole' | 'nebula' | 'blackhole' | 'quantumFlux'
  | 'pixelSort' | 'scanlines' | 'dataStream' | 'glitch' | 'neon'
  | 'tide' | 'constellation' | 'tornado' | 'earthquake' | 'supernova';

export const ALL_PATTERNS: BraillePattern[] = [
  'orbit', 'breathing', 'snake', 'fillSweep', 'pulse',
  'columns', 'checkerboard', 'scan', 'rain', 'cascade',
  'sparkle', 'wave', 'rose', 'helix', 'diagonalSwipe',
  'vortex', 'bouncing', 'ripple', 'fireworks', 'crosshatch',
  'diamonds', 'zigzag', 'spiral', 'binary', 'static',
  'clockwise', 'counterClockwise', 'hourglass', 'pendulum', 'meteor',
  'lightning', 'aurora', 'matrix', 'heartbeat', 'explosion',
  'shatter', 'wormhole', 'nebula', 'blackhole', 'quantumFlux',
  'pixelSort', 'scanlines', 'dataStream', 'glitch', 'neon',
  'tide', 'constellation', 'tornado', 'earthquake', 'supernova',
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

function patternClockwise(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const cx = cols / 2, cy = rows / 2;
  const radius = (Math.min(cols, rows) / 2) * (0.3 + intensity * 0.5);
  const count = Math.round(4 + intensity * 8);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - frame * 0.1;
    const x = Math.round(cx + Math.cos(angle) * radius);
    const y = Math.round(cy + Math.sin(angle) * radius);
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternCounterClockwise(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const cx = cols / 2, cy = rows / 2;
  const radius = (Math.min(cols, rows) / 2) * (0.3 + intensity * 0.5);
  const count = Math.round(4 + intensity * 8);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + frame * 0.1;
    const x = Math.round(cx + Math.cos(angle) * radius);
    const y = Math.round(cy + Math.sin(angle) * radius);
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternHourglass(_frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const dy = Math.abs(r - cy) / (rows / 2);
      const maxDx = (1 - dy) * cx * intensity;
      return Math.abs(c - cx) <= maxDx && Math.abs(c - cx) >= maxDx - 0.8 ? 0xFF : 0x00;
    })
  );
}

function patternPendulum(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const cx = cols / 2;
  const swing = Math.sin(frame * 0.07 * (0.5 + intensity));
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1 || 1);
    const px = Math.round(cx + swing * (cols / 2 - 1) * t);
    if (px >= 0 && px < cols) grid[r][px] = 0xFF;
  }
  return grid;
}

function patternMeteor(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const count = Math.round(2 + intensity * 4);
  for (let i = 0; i < count; i++) {
    const offset = (frame * 0.4 + i * 7) % (cols + rows);
    const tailLen = Math.round(2 + intensity * 3);
    for (let t = 0; t < tailLen; t++) {
      const x = Math.round(((cols - 1 - (offset - t * 0.7)) % cols + cols) % cols);
      const y = Math.round(((offset - t * 0.7) % rows + rows) % rows);
      if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = t === 0 ? 0xFF : 0x40;
    }
  }
  return grid;
}

function patternLightning(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const bolts = Math.round(1 + intensity * 3);
  for (let b = 0; b < bolts; b++) {
    const seed = Math.sin(b * 93.7 + frame * 0.03) * 43758;
    let c = Math.abs(Math.floor(seed)) % cols;
    for (let r = 0; r < rows; r++) {
      const jitter = Math.round((Math.sin(r * 17.3 + seed) * 0.5 + 0.5) * 3 - 1);
      c = Math.max(0, Math.min(cols - 1, c + jitter));
      grid[r][c] = 0xFF;
    }
  }
  return grid;
}

function patternAurora(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const wave1 = Math.sin(c * 0.3 + frame * 0.04) * 0.5 + 0.5;
      const wave2 = Math.sin(c * 0.15 - frame * 0.03 + r * 0.5) * 0.5 + 0.5;
      const combined = (wave1 + wave2) / 2;
      const rowFade = 1 - (r / rows) * 0.7;
      return combined * rowFade * intensity > 0.4 ? 0xFF : 0x00;
    })
  );
}

function patternMatrix(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const speed = 0.3 + Math.sin(c * 13.7) * 0.15;
      const drop = (frame * speed * intensity + c * 7.3) % (rows * 2);
      const dist = Math.abs(drop % rows - r);
      if (dist < 0.5) return 0xFF;
      if (dist < 2.5 && Math.random() > 0.5) return 0x40;
      return 0x00;
    })
  );
}

function patternHeartbeat(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  const phase = (frame * 0.08) % (Math.PI * 2);
  const beat = phase < 0.3 ? Math.sin(phase / 0.3 * Math.PI) :
               phase < 0.6 ? -Math.sin((phase - 0.3) / 0.3 * Math.PI) * 0.3 : 0;
  const radius = (Math.min(cols, rows) * 0.3 + beat * Math.min(cols, rows) * 0.2) * intensity;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2);
      return Math.abs(dist - radius) < 1.2 ? 0xFF : 0x00;
    })
  );
}

function patternExplosion(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  const burst = (frame * 0.15 * intensity) % (Math.max(cols, rows) * 0.7);
  const particles = Math.round(6 + intensity * 10);
  const grid = makeGrid(rows, cols);
  for (let i = 0; i < particles; i++) {
    const angle = (i / particles) * Math.PI * 2;
    const spread = Math.sin(i * 3.7 + frame * 0.1) * 0.3;
    const r = burst * (0.8 + spread * 0.4);
    const x = Math.round(cx + Math.cos(angle + spread) * r);
    const y = Math.round(cy + Math.sin(angle + spread) * r);
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternShatter(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  const t = (frame * 0.05 * intensity) % 2;
  const phase = t < 1 ? t : 2 - t;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2);
      const maxDist = Math.sqrt(cx ** 2 + cy ** 2);
      const threshold = phase * maxDist;
      const jitter = Math.sin(r * 17.3 + c * 31.7) * 0.5 + 0.5;
      return dist < threshold + jitter * 1.5 ? 0xFF : 0x00;
    })
  );
}

function patternWormhole(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  const maxR = Math.sqrt(cx ** 2 + cy ** 2);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2);
      const ring = (dist - frame * 0.2 * intensity) % (maxR * 0.3);
      return ring >= 0 && ring < 0.8 ? 0xFF : 0x00;
    })
  );
}

function patternNebula(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const n1 = Math.sin(c * 0.4 + frame * 0.02) * Math.cos(r * 0.6 - frame * 0.015);
      const n2 = Math.sin(c * 0.15 + r * 0.25 + frame * 0.01);
      const combined = (n1 + n2) * 0.5 + 0.5;
      return combined > (1 - intensity * 0.7) ? (Math.round(combined * 200)) : 0x00;
    })
  );
}

function patternBlackhole(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  const grid = makeGrid(rows, cols);
  const particles = 20;
  for (let i = 0; i < particles; i++) {
    const seed = i * 7.3;
    const initR = (Math.sin(seed * 0.3) * 0.5 + 0.5) * Math.min(cols, rows) * 0.5;
    const t = (frame * 0.05 * intensity + seed * 0.1) % 1;
    const r = initR * (1 - t);
    const angle = seed + t * Math.PI * 4;
    const x = Math.round(cx + Math.cos(angle) * r);
    const y = Math.round(cy + Math.sin(angle) * r);
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = 0xFF;
  }
  return grid;
}

function patternQuantumFlux(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const h1 = Math.sin(c * 3.7 + r * 5.3 + frame * 0.13) * 43758.5453;
      const frac = Math.abs(h1 - Math.floor(h1));
      return frac < intensity * 0.6 ? (Math.round(frac * 255)) : 0x00;
    })
  );
}

function patternPixelSort(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  for (let c = 0; c < cols; c++) {
    const colSeed = Math.abs(Math.sin(c * 127.1) * 43758.5453);
    const filled = Math.round(((colSeed * 0.1 + frame * 0.05 * intensity) % 1) * rows);
    for (let r = rows - 1; r >= rows - filled; r--) {
      if (r >= 0) grid[r][c] = 0xFF;
    }
  }
  return grid;
}

function patternScanlines(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const scroll = frame * 0.15 * intensity;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, () => {
      const band = (r + Math.floor(scroll)) % 3;
      return band === 0 ? 0xFF : band === 1 ? 0x20 : 0x00;
    })
  );
}

function patternDataStream(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const speed = 0.2 + Math.sin(c * 9.1) * 0.1;
      const pos = (frame * speed * intensity + c * 3.7) % (rows + 4);
      return Math.abs(pos - r) < 1 ? 0xFF : Math.abs(pos - r) < 2.5 ? 0x20 : 0x00;
    })
  );
}

function patternGlitch(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) => {
    const glitchSeed = Math.sin(r * 43.7 + Math.floor(frame * 0.2) * 7.3);
    const glitching = Math.abs(glitchSeed) < intensity * 0.4;
    const shift = glitching ? Math.round((glitchSeed * 100) % (cols / 2)) : 0;
    return Array.from({ length: cols }, (_, c) => {
      const sc = (c + shift + cols) % cols;
      const h = Math.sin(sc * 31.3 + frame * 0.5) * 0.5 + 0.5;
      return (glitching && h > 0.3) ? 0xFF : (!glitching && h > 0.85) ? 0x80 : 0x00;
    });
  });
}

function patternNeon(frame: number, cols: number, rows: number, intensity: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const flicker = Math.sin(r * 7.3 + c * 13.1 + frame * 1.7) * 0.5 + 0.5;
      return flicker > (1 - intensity * 0.9) ? 0xFF : flicker > 0.6 ? 0x80 : 0x00;
    })
  );
}

function patternTide(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const waterLevel = Math.round(rows * (0.3 + Math.sin(frame * 0.04) * 0.3 * intensity));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const wave = Math.sin(c * 0.4 + frame * 0.08) * 1.5;
      return r >= (rows - waterLevel + Math.round(wave)) ? 0xFF : 0x00;
    })
  );
}

function patternConstellation(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const grid = makeGrid(rows, cols);
  const stars = Math.round(4 + intensity * 8);
  const positions: [number, number][] = [];
  for (let i = 0; i < stars; i++) {
    const sx = Math.round(Math.abs(Math.sin(i * 73.1)) * (cols - 1));
    const sy = Math.round(Math.abs(Math.cos(i * 47.3)) * (rows - 1));
    positions.push([sx, sy]);
    grid[sy][sx] = 0xFF;
  }
  const linePhase = Math.floor(frame * 0.05) % stars;
  if (linePhase < stars - 1) {
    const [x1, y1] = positions[linePhase];
    const [x2, y2] = positions[linePhase + 1];
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let s = 0; s <= steps; s++) {
      const t = steps > 0 ? s / steps : 0;
      const lx = Math.round(x1 + (x2 - x1) * t);
      const ly = Math.round(y1 + (y2 - y1) * t);
      if (ly >= 0 && ly < rows && lx >= 0 && lx < cols) grid[ly][lx] = 0x40;
    }
  }
  return grid;
}

function patternTornado(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2;
  return Array.from({ length: rows }, (_, r) => {
    const t = r / (rows - 1 || 1);
    const width = t * (cols / 2) * intensity + 0.5;
    const spin = frame * 0.15 * (1 - t * 0.5);
    return Array.from({ length: cols }, (_, c) => {
      const dx = c - (cx + Math.sin(spin + t * Math.PI * 2) * t * 2);
      return Math.abs(dx) <= width ? (Math.abs(dx) < 0.5 ? 0xFF : 0x40) : 0x00;
    });
  });
}

function patternEarthquake(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const shakeX = Math.round(Math.sin(frame * 1.3) * intensity * 2);
  const shakeY = Math.round(Math.cos(frame * 1.7) * intensity * 1);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const sr = ((r - shakeY) % rows + rows) % rows;
      const sc = ((c - shakeX) % cols + cols) % cols;
      return ((sr + sc) & 1) ? 0xFF : 0x00;
    })
  );
}

function patternSupernova(frame: number, cols: number, rows: number, intensity: number): number[][] {
  const cx = cols / 2, cy = rows / 2;
  const maxR = Math.sqrt(cx ** 2 + cy ** 2);
  const phase = (frame * 0.04 * intensity) % 3;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2);
      if (phase < 1) {
        return dist < phase * maxR ? 0xFF : 0x00;
      } else if (phase < 2) {
        const ring = (phase - 1) * maxR;
        return Math.abs(dist - ring) < 1.5 ? 0xFF : dist < ring * 0.3 ? 0x20 : 0x00;
      } else {
        const scatter = Math.sin(r * 17.3 + c * 31.7 + frame * 0.5) * 0.5 + 0.5;
        return scatter > (1 - intensity * 0.3) ? 0xFF : 0x00;
      }
    })
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
  clockwise: patternClockwise,
  counterClockwise: patternCounterClockwise,
  hourglass: patternHourglass,
  pendulum: patternPendulum,
  meteor: patternMeteor,
  lightning: patternLightning,
  aurora: patternAurora,
  matrix: patternMatrix,
  heartbeat: patternHeartbeat,
  explosion: patternExplosion,
  shatter: patternShatter,
  wormhole: patternWormhole,
  nebula: patternNebula,
  blackhole: patternBlackhole,
  quantumFlux: patternQuantumFlux,
  pixelSort: patternPixelSort,
  scanlines: patternScanlines,
  dataStream: patternDataStream,
  glitch: patternGlitch,
  neon: patternNeon,
  tide: patternTide,
  constellation: patternConstellation,
  tornado: patternTornado,
  earthquake: patternEarthquake,
  supernova: patternSupernova,
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
