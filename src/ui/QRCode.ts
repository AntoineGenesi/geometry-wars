/**
 * Minimal QR Code generator — zero dependencies.
 * Supports byte-mode encoding for URLs up to ~270 characters (versions 1-10, ECC level L).
 * Renders to a <canvas> element.
 *
 * Based on the QR Code specification (ISO/IEC 18004).
 * Only implements what's needed: byte mode, error correction level L, mask selection.
 */

// ---------------------------------------------------------------------------
// Galois Field GF(256) arithmetic for Reed-Solomon
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(gen.length + 1);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gfMul(gen[j], GF_EXP[i]);
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }
  return gen;
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  // gen is LSB-first: gen[0]=constant, gen[ecCount]=1 (leading coefficient).
  // Use shift-register algorithm: for each data byte, update remainder using gen[ecCount-1..0]
  // (which maps to MSB-first coeff[1..ecCount] used in standard formulations).
  const gen = rsGeneratorPoly(ecCount);
  const remainder = new Uint8Array(ecCount);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[ecCount - 1 - j], factor);
    }
    remainder[ecCount - 1] = gfMul(gen[0], factor);
  }

  return remainder;
}

// ---------------------------------------------------------------------------
// QR Code version tables (versions 1-10, ECC level L only)
// ---------------------------------------------------------------------------

interface VersionInfo {
  version: number;
  size: number;       // modules per side
  dataCapacity: number; // total data codewords (byte mode)
  ecPerBlock: number;   // EC codewords per block
  blocks: number;       // number of blocks
  alignmentPatterns: number[];
}

// Data from QR spec — Level L (Low) error correction
const VERSIONS: VersionInfo[] = [
  { version: 1,  size: 21, dataCapacity: 17,  ecPerBlock: 7,  blocks: 1, alignmentPatterns: [] },
  { version: 2,  size: 25, dataCapacity: 32,  ecPerBlock: 10, blocks: 1, alignmentPatterns: [18] },
  { version: 3,  size: 29, dataCapacity: 53,  ecPerBlock: 15, blocks: 1, alignmentPatterns: [22] },
  { version: 4,  size: 33, dataCapacity: 78,  ecPerBlock: 20, blocks: 1, alignmentPatterns: [26] },
  { version: 5,  size: 37, dataCapacity: 108, ecPerBlock: 26, blocks: 1, alignmentPatterns: [30] },
  { version: 6,  size: 41, dataCapacity: 136, ecPerBlock: 18, blocks: 2, alignmentPatterns: [34] },
  { version: 7,  size: 45, dataCapacity: 156, ecPerBlock: 20, blocks: 2, alignmentPatterns: [6, 22, 38] },
  { version: 8,  size: 49, dataCapacity: 192, ecPerBlock: 24, blocks: 2, alignmentPatterns: [6, 24, 42] },
  { version: 9,  size: 53, dataCapacity: 224, ecPerBlock: 30, blocks: 2, alignmentPatterns: [6, 26, 46] },
  { version: 10, size: 57, dataCapacity: 262, ecPerBlock: 18, blocks: 4, alignmentPatterns: [6, 28, 50] },
];

function selectVersion(dataLength: number): VersionInfo {
  // Byte mode overhead: 4 bits mode + 8/16 bits length + data + 4 bits terminator
  for (const v of VERSIONS) {
    const lengthBits = v.version >= 10 ? 16 : 8;
    const overhead = Math.ceil((4 + lengthBits + 4) / 8); // mode + length + terminator in bytes
    if (dataLength + overhead <= v.dataCapacity) return v;
  }
  throw new Error(`QR: Data too long (${dataLength} bytes). Max supported: ~${VERSIONS[VERSIONS.length - 1].dataCapacity} bytes`);
}

// ---------------------------------------------------------------------------
// Data encoding (byte mode)
// ---------------------------------------------------------------------------

function encodeData(text: string, ver: VersionInfo): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const lengthBits = ver.version >= 10 ? 16 : 8;
  const totalBits = 4 + lengthBits + bytes.length * 8;
  const totalCodewords = ver.dataCapacity;
  const buffer = new Uint8Array(totalCodewords);

  // Write bits into buffer
  let bitPos = 0;
  const writeBits = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      const byteIdx = bitPos >> 3;
      const bitIdx = 7 - (bitPos & 7);
      if ((value >> i) & 1) {
        buffer[byteIdx] |= 1 << bitIdx;
      }
      bitPos++;
    }
  };

  // Mode indicator: 0100 = byte mode
  writeBits(0b0100, 4);
  // Character count
  writeBits(bytes.length, lengthBits);
  // Data bytes
  for (const b of bytes) {
    writeBits(b, 8);
  }
  // Terminator (up to 4 zero bits)
  const terminatorBits = Math.min(4, totalCodewords * 8 - totalBits);
  writeBits(0, terminatorBits);

  // Pad to byte boundary
  bitPos = Math.ceil(bitPos / 8) * 8;

  // Pad with alternating 0xEC, 0x11
  let padIdx = 0;
  const padBytes = [0xEC, 0x11];
  while (bitPos < totalCodewords * 8) {
    writeBits(padBytes[padIdx & 1], 8);
    padIdx++;
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// Error correction and interleaving
// ---------------------------------------------------------------------------

function addErrorCorrection(data: Uint8Array, ver: VersionInfo): Uint8Array {
  const { blocks, ecPerBlock, dataCapacity } = ver;
  const totalEC = blocks * ecPerBlock;
  const totalCodewords = dataCapacity + totalEC;

  // Split data into blocks
  const blockSize = Math.floor(dataCapacity / blocks);
  const largerBlocks = dataCapacity % blocks;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const size = blockSize + (i >= blocks - largerBlocks ? 1 : 0);
    const block = data.slice(offset, offset + size);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
    offset += size;
  }

  // Interleave data codewords
  const result = new Uint8Array(totalCodewords);
  let idx = 0;
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result[idx++] = block[i];
    }
  }
  // Interleave EC codewords
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result[idx++] = block[i];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Module placement
// ---------------------------------------------------------------------------

type Matrix = number[][]; // 0=white, 1=black, -1=unset

function createMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => new Array(size).fill(-1));
}

function placeFinderPattern(matrix: Matrix, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= matrix.length || cc < 0 || cc >= matrix.length) continue;
      const isBlack =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      matrix[rr][cc] = isBlack ? 1 : 0;
    }
  }
}

function placeAlignmentPattern(matrix: Matrix, row: number, col: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      matrix[row + r][col + c] = isBlack ? 1 : 0;
    }
  }
}

function placeTimingPatterns(matrix: Matrix): void {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    if (matrix[6][i] === -1) matrix[6][i] = bit;
    if (matrix[i][6] === -1) matrix[i][6] = bit;
  }
}

function reserveFormatBits(matrix: Matrix): void {
  const size = matrix.length;
  // Around top-left finder
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0;
    if (matrix[i][8] === -1) matrix[i][8] = 0;
  }
  // Around top-right finder
  for (let i = 0; i <= 7; i++) {
    if (matrix[8][size - 1 - i] === -1) matrix[8][size - 1 - i] = 0;
  }
  // Around bottom-left finder
  for (let i = 0; i <= 7; i++) {
    if (matrix[size - 1 - i][8] === -1) matrix[size - 1 - i][8] = 0;
  }
  // Dark module
  matrix[size - 8][8] = 1;
}

function reserveVersionBits(matrix: Matrix, version: number): void {
  if (version < 7) return;
  // Version info bits (18 bits) placed near bottom-left and top-right finder patterns
  // For versions 7-10, we need to place version information
  const versionBits = getVersionBits(version);
  const size = matrix.length;
  for (let i = 0; i < 18; i++) {
    const bit = (versionBits >> i) & 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    matrix[row][col] = bit;
    matrix[col][row] = bit;
  }
}

function getVersionBits(version: number): number {
  // Version information bit strings from QR spec
  const versionStrings: Record<number, number> = {
    7: 0x07C94,
    8: 0x085BC,
    9: 0x09A99,
    10: 0x0A4D3,
  };
  return versionStrings[version] ?? 0;
}

function isReserved(matrix: Matrix, row: number, col: number): boolean {
  return matrix[row][col] !== -1;
}

function placeDataBits(matrix: Matrix, data: Uint8Array): void {
  const size = matrix.length;
  let bitIdx = 0;
  const totalBits = data.length * 8;

  // Traverse the matrix in the zigzag pattern specified by QR
  let col = size - 1;
  let upward = true;

  while (col >= 0) {
    // Skip the vertical timing pattern column
    if (col === 6) {
      col--;
      continue;
    }

    const rowRange = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rowRange) {
      for (let dc = 0; dc <= 1; dc++) {
        const c = col - dc;
        if (c < 0) continue;
        if (isReserved(matrix, row, c)) continue;
        if (bitIdx < totalBits) {
          const byteIdx = bitIdx >> 3;
          const bitOffset = 7 - (bitIdx & 7);
          matrix[row][c] = (data[byteIdx] >> bitOffset) & 1;
          bitIdx++;
        } else {
          matrix[row][c] = 0;
        }
      }
    }

    col -= 2;
    upward = !upward;
  }
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

type MaskFn = (row: number, col: number) => boolean;

const MASK_FUNCTIONS: MaskFn[] = [
  (r, c) => (r + c) % 2 === 0,
  (r, _c) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function createReservedMask(size: number, version: number, alignments: number[]): boolean[][] {
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  // Finder patterns + separators
  for (let r = 0; r <= 8; r++) {
    for (let c = 0; c <= 8; c++) {
      reserved[r][c] = true;
      if (r < size && size - 1 - c >= 0) reserved[r][size - 1 - c] = true;
      if (size - 1 - r >= 0 && c < size) reserved[size - 1 - r][c] = true;
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // Alignment patterns
  if (alignments.length > 0) {
    const positions = getAlignmentPositions(version, alignments);
    for (const [ar, ac] of positions) {
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          reserved[ar + r][ac + c] = true;
        }
      }
    }
  }

  // Format info
  for (let i = 0; i <= 8; i++) {
    if (i < size) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i <= 7; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // Version info (version >= 7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = size - 11; j < size - 8; j++) {
        reserved[i][j] = true;
        reserved[j][i] = true;
      }
    }
  }

  // Dark module
  reserved[size - 8][8] = true;

  return reserved;
}

function getAlignmentPositions(version: number, patterns: number[]): [number, number][] {
  if (patterns.length === 0) return [];

  // For version 2-6, there's a single alignment pattern
  if (version <= 6) {
    return [[patterns[0], patterns[0]]];
  }

  // For version 7+, alignment patterns form a grid
  // But must exclude positions that overlap with finder patterns
  const positions: [number, number][] = [];
  for (const r of patterns) {
    for (const c of patterns) {
      // Skip if overlapping with finder pattern areas
      if (r <= 8 && c <= 8) continue; // top-left
      if (r <= 8 && c >= patterns[patterns.length - 1] - 2) continue; // top-right area check
      if (r >= patterns[patterns.length - 1] - 2 && c <= 8) continue; // bottom-left area check
      positions.push([r, c]);
    }
  }
  return positions;
}

function applyMask(matrix: Matrix, reserved: boolean[][], maskIdx: number): Matrix {
  const size = matrix.length;
  const masked = matrix.map((row) => [...row]);
  const fn = MASK_FUNCTIONS[maskIdx];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) {
        masked[r][c] ^= 1;
      }
    }
  }

  return masked;
}

// ---------------------------------------------------------------------------
// Format information
// ---------------------------------------------------------------------------

// Format info for ECC level L (01) with each mask pattern (pre-computed with BCH)
const FORMAT_INFO: number[] = [
  0x77C4, // mask 0
  0x72F3, // mask 1
  0x7DAA, // mask 2
  0x789D, // mask 3
  0x662F, // mask 4
  0x6318, // mask 5
  0x6C41, // mask 6
  0x6976, // mask 7
];

function placeFormatBits(matrix: Matrix, maskIdx: number): void {
  const size = matrix.length;
  const bits = FORMAT_INFO[maskIdx];

  // Copy 1: around top-left finder pattern.
  // Per QR spec: F0 (LSB) goes at (row8, col0), F1 at (row8, col1), ..., F6 at (row8, col7),
  //              F7 at (row8, col8), F8 at (row7, col8), F9 at (row5, col8), ..., F14 at (row0, col8).

  // Row 8, cols 0-5 (skip col6=timing), 7, 8  →  F0..F7 (bits 0..7)
  const col8Positions = [0, 1, 2, 3, 4, 5, 7, 8];
  for (let i = 0; i < 8; i++) {
    matrix[8][col8Positions[i]] = (bits >> i) & 1;
  }

  // Col 8, rows 7 (skip row6=timing), 5, 4, 3, 2, 1, 0  →  F8..F14 (bits 8..14)
  const row8Positions = [7, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < 7; i++) {
    matrix[row8Positions[i]][8] = (bits >> (8 + i)) & 1;
  }

  // Copy 2: bottom-left strip (col 8, rows size-7 to size-1)  →  F8..F14 (bits 8..14)
  for (let i = 0; i < 7; i++) {
    matrix[size - 7 + i][8] = (bits >> (8 + i)) & 1;
  }

  // Copy 2: top-right strip (row 8, cols size-8 to size-1)  →  F7..F0 (bits 7..0)
  for (let i = 0; i < 8; i++) {
    matrix[8][size - 8 + i] = (bits >> (7 - i)) & 1;
  }
}

// ---------------------------------------------------------------------------
// Penalty scoring (simplified — pick lowest penalty mask)
// ---------------------------------------------------------------------------

function penaltyScore(matrix: Matrix): number {
  const size = matrix.length;
  let score = 0;

  // Rule 1: Runs of same color in row/col
  for (let r = 0; r < size; r++) {
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runLen = 1;
      }
    }
  }
  for (let c = 0; c < size; c++) {
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) {
        runLen++;
        if (runLen === 5) score += 3;
        else if (runLen > 5) score += 1;
      } else {
        runLen = 1;
      }
    }
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Main QR generation
// ---------------------------------------------------------------------------

function generateQRMatrix(text: string): Matrix {
  const bytes = new TextEncoder().encode(text);
  const ver = selectVersion(bytes.length);
  const { size, alignmentPatterns, version } = ver;

  // 1. Encode data
  const data = encodeData(text, ver);
  const codewords = addErrorCorrection(data, ver);

  // 2. Create matrix and place fixed patterns
  const matrix = createMatrix(size);
  placeFinderPattern(matrix, 0, 0);
  placeFinderPattern(matrix, 0, size - 7);
  placeFinderPattern(matrix, size - 7, 0);
  placeTimingPatterns(matrix);

  // Alignment patterns
  const alignPositions = getAlignmentPositions(version, alignmentPatterns);
  for (const [ar, ac] of alignPositions) {
    placeAlignmentPattern(matrix, ar, ac);
  }

  reserveFormatBits(matrix);
  reserveVersionBits(matrix, version);

  // 3. Place data bits
  placeDataBits(matrix, codewords);

  // 4. Try all 8 masks, pick best (lowest penalty)
  const reserved = createReservedMask(size, version, alignmentPatterns);
  let bestMask = 0;
  let bestScore = Infinity;

  for (let m = 0; m < 8; m++) {
    const masked = applyMask(matrix, reserved, m);
    placeFormatBits(masked, m);
    const s = penaltyScore(masked);
    if (s < bestScore) {
      bestScore = s;
      bestMask = m;
    }
  }

  // 5. Apply best mask and format bits
  const final = applyMask(matrix, reserved, bestMask);
  placeFormatBits(final, bestMask);
  reserveVersionBits(final, version);

  return final;
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

export interface QRCodeOptions {
  /** Pixels per QR module (default 8) */
  scale?: number;
  /** Quiet zone in modules (default 4, per QR spec) */
  quietZone?: number;
  /** Foreground color (default '#000000') */
  foreground?: string;
  /** Background color (default '#ffffff') */
  background?: string;
}

/**
 * Generate a QR code canvas element for the given text.
 * Returns an HTMLCanvasElement ready to insert into the DOM.
 */
export function generateQRCode(text: string, options: QRCodeOptions = {}): HTMLCanvasElement {
  const {
    scale = 8,
    quietZone = 4,
    foreground = '#000000',
    background = '#ffffff',
  } = options;

  const matrix = generateQRMatrix(text);
  const size = matrix.length;
  const canvasSize = (size + quietZone * 2) * scale;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('QR: Cannot get canvas 2d context');

  // Background
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // Modules
  ctx.fillStyle = foreground;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) {
        ctx.fillRect(
          (c + quietZone) * scale,
          (r + quietZone) * scale,
          scale,
          scale,
        );
      }
    }
  }

  return canvas;
}

/**
 * Create a styled QR code container with the QR code and a URL label below it.
 * Returns a div element containing the canvas and label.
 */
export function createQRCodeDisplay(
  url: string,
  label?: string,
  canvasSize: number = 220,
): HTMLDivElement {
  // Generate matrix first to get exact module count, then compute pixel-perfect scale.
  // quietZone = 4 on each side (spec minimum). totalModules = QR size + 2*quietZone.
  const quietZone = 4;
  const matrix = generateQRMatrix(url);
  const totalModules = matrix.length + quietZone * 2;
  const scale = Math.max(2, Math.floor(canvasSize / totalModules));

  const canvas = generateQRCode(url, {
    scale,
    quietZone,
    foreground: '#000000',
    background: '#ffffff',
  });

  // Set display size via CSS so it always fills the requested canvasSize.
  // imageRendering: pixelated keeps module edges crisp (no bilinear interpolation).
  canvas.style.width = `${canvasSize}px`;
  canvas.style.height = `${canvasSize}px`;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.borderRadius = '6px';

  const container = document.createElement('div');
  container.className = 'qr-code-display';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin: 12px 0;
    padding: 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-radius: 8px;
  `;

  const title = document.createElement('div');
  title.textContent = 'SCAN TO JOIN';
  title.style.cssText = `
    color: #88ffff;
    font: bold 12px monospace;
    letter-spacing: 3px;
  `;

  const urlLabel = document.createElement('div');
  urlLabel.textContent = label ?? url;
  urlLabel.style.cssText = `
    color: #00bbbb;
    font: 10px monospace;
    word-break: break-all;
    text-align: center;
    max-width: ${canvasSize}px;
    user-select: all;
    opacity: 0.8;
  `;

  const mobileHint = document.createElement('div');
  mobileHint.textContent = 'Mobile-optimized view';
  mobileHint.style.cssText = `
    color: #557777;
    font: 10px monospace;
    letter-spacing: 1px;
  `;

  container.appendChild(title);
  container.appendChild(canvas);
  container.appendChild(urlLabel);
  container.appendChild(mobileHint);

  return container;
}
