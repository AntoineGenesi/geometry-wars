/**
 * Deep QR matrix verification — simulates what a real QR decoder does.
 * Reads bits from the matrix in zigzag order, deinterleaves, RS-decodes,
 * and verifies the original text is recovered.
 *
 * Run: node scripts/test-qr-matrix.mjs
 */

// ===== Core GF(256) arithmetic =====
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x; GF_LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }
function gfPolyEval(poly, x) { let r = 0; for (const c of poly) r = gfMul(r, x) ^ c; return r; }

// ===== QR Encoder (from QRCode.ts) =====
function rsGeneratorPoly(degree) {
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

function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++)
      remainder[j] = remainder[j + 1] ^ gfMul(gen[ecCount - 1 - j], factor);
    remainder[ecCount - 1] = gfMul(gen[0], factor);
  }
  return remainder;
}

const VERSIONS = [
  { version: 1,  size: 21, dataCapacity: 17,  ecPerBlock: 7,  blocks: 1, alignmentPatterns: [] },
  { version: 2,  size: 25, dataCapacity: 32,  ecPerBlock: 10, blocks: 1, alignmentPatterns: [18] },
  { version: 3,  size: 29, dataCapacity: 53,  ecPerBlock: 15, blocks: 1, alignmentPatterns: [22] },
  { version: 4,  size: 33, dataCapacity: 78,  ecPerBlock: 20, blocks: 1, alignmentPatterns: [26] },
  { version: 5,  size: 37, dataCapacity: 108, ecPerBlock: 26, blocks: 1, alignmentPatterns: [30] },
];

function selectVersion(dataLength) {
  for (const v of VERSIONS) {
    const lengthBits = v.version >= 10 ? 16 : 8;
    const overhead = Math.ceil((4 + lengthBits + 4) / 8);
    if (dataLength + overhead <= v.dataCapacity) return v;
  }
  throw new Error(`Too long: ${dataLength}`);
}

function encodeData(text, ver) {
  const bytes = Buffer.from(text, 'utf8');
  const lengthBits = ver.version >= 10 ? 16 : 8;
  const buffer = new Uint8Array(ver.dataCapacity);
  let bitPos = 0;
  const writeBits = (value, count) => {
    for (let i = count - 1; i >= 0; i--) {
      if ((value >> i) & 1) buffer[bitPos >> 3] |= 1 << (7 - (bitPos & 7));
      bitPos++;
    }
  };
  writeBits(0b0100, 4);
  writeBits(bytes.length, lengthBits);
  for (const b of bytes) writeBits(b, 8);
  const totalBits = 4 + lengthBits + bytes.length * 8;
  writeBits(0, Math.min(4, ver.dataCapacity * 8 - totalBits));
  bitPos = Math.ceil(bitPos / 8) * 8;
  let padIdx = 0;
  while (bitPos < ver.dataCapacity * 8) { writeBits([0xEC, 0x11][padIdx++ & 1], 8); }
  return buffer;
}

function addErrorCorrection(data, ver) {
  const { blocks, ecPerBlock, dataCapacity } = ver;
  const blockSize = Math.floor(dataCapacity / blocks);
  const largerBlocks = dataCapacity % blocks;
  const dataBlocks = [], ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const size = blockSize + (i >= blocks - largerBlocks ? 1 : 0);
    const block = data.slice(offset, offset + size);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
    offset += size;
  }
  const total = dataCapacity + blocks * ecPerBlock;
  const result = new Uint8Array(total);
  let idx = 0;
  const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxDataLen; i++)
    for (const block of dataBlocks) if (i < block.length) result[idx++] = block[i];
  for (let i = 0; i < ecPerBlock; i++)
    for (const block of ecBlocks) if (i < block.length) result[idx++] = block[i];
  return result;
}

// ===== Matrix generation =====
function createMatrix(size) { return Array.from({ length: size }, () => new Array(size).fill(-1)); }
function placeFinderPattern(matrix, row, col) {
  for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
    const rr = row + r, cc = col + c;
    if (rr < 0 || rr >= matrix.length || cc < 0 || cc >= matrix.length) continue;
    matrix[rr][cc] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
      (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4) ? 1 : 0;
  }
}
function placeAlignmentPattern(matrix, row, col) {
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++)
    matrix[row + r][col + c] = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0) ? 1 : 0;
}
function placeTimingPatterns(matrix) {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === -1) matrix[6][i] = i % 2 === 0 ? 1 : 0;
    if (matrix[i][6] === -1) matrix[i][6] = i % 2 === 0 ? 1 : 0;
  }
}
function reserveFormatBits(matrix) {
  const size = matrix.length;
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0;
    if (matrix[i][8] === -1) matrix[i][8] = 0;
  }
  for (let i = 0; i <= 7; i++) {
    if (matrix[8][size - 1 - i] === -1) matrix[8][size - 1 - i] = 0;
    if (matrix[size - 1 - i][8] === -1) matrix[size - 1 - i][8] = 0;
  }
  matrix[size - 8][8] = 1;
}

function getAlignmentPositions(version, patterns) {
  if (patterns.length === 0) return [];
  if (version <= 6) return [[patterns[0], patterns[0]]];
  const positions = [];
  for (const r of patterns) for (const c of patterns) {
    if (r <= 8 && c <= 8) continue;
    if (r <= 8 && c >= patterns[patterns.length - 1] - 2) continue;
    if (r >= patterns[patterns.length - 1] - 2 && c <= 8) continue;
    positions.push([r, c]);
  }
  return positions;
}

function placeDataBits(matrix, data) {
  const size = matrix.length;
  let bitIdx = 0, col = size - 1;
  let upward = true;
  const totalBits = data.length * 8;
  while (col >= 0) {
    if (col === 6) { col--; continue; }
    const rowRange = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);
    for (const row of rowRange) for (let dc = 0; dc <= 1; dc++) {
      const c = col - dc;
      if (c < 0 || matrix[row][c] !== -1) continue;
      if (bitIdx < totalBits)
        matrix[row][c] = (data[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
      else
        matrix[row][c] = 0;
      bitIdx++;
    }
    col -= 2; upward = !upward;
  }
}

const MASK_FUNCTIONS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function createReservedMask(size, version, alignments) {
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let r = 0; r <= 8; r++) for (let c = 0; c <= 8; c++) {
    reserved[r][c] = true;
    if (c < 8) reserved[r][size - 1 - c] = true;   // top-right: only 8 cols (c=0..7)
    if (r < 8) reserved[size - 1 - r][c] = true;   // bottom-left: only 8 rows (r=0..7)
  }
  for (let i = 8; i < size - 8; i++) { reserved[6][i] = true; reserved[i][6] = true; }
  if (alignments.length > 0) {
    for (const [ar, ac] of getAlignmentPositions(version, alignments))
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) reserved[ar + r][ac + c] = true;
  }
  for (let i = 0; i <= 8; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i <= 7; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = size - 11; j < size - 8; j++) {
    reserved[i][j] = true; reserved[j][i] = true;
  }
  reserved[size - 8][8] = true;
  return reserved;
}

function applyMask(matrix, reserved, maskIdx) {
  const size = matrix.length;
  const masked = matrix.map(row => [...row]);
  const fn = MASK_FUNCTIONS[maskIdx];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
    if (!reserved[r][c] && fn(r, c)) masked[r][c] ^= 1;
  return masked;
}

const FORMAT_INFO = [0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976];
function placeFormatBits(matrix, maskIdx) {
  const size = matrix.length, bits = FORMAT_INFO[maskIdx];
  const col8Positions = [0, 1, 2, 3, 4, 5, 7, 8];
  for (let i = 0; i < 8; i++) matrix[8][col8Positions[i]] = (bits >> i) & 1;
  const row8Positions = [7, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < 7; i++) matrix[row8Positions[i]][8] = (bits >> (8 + i)) & 1;
  for (let i = 0; i < 7; i++) matrix[size - 7 + i][8] = (bits >> (8 + i)) & 1;
  for (let i = 0; i < 8; i++) matrix[8][size - 8 + i] = (bits >> (7 - i)) & 1;
}

function penaltyScore(matrix) {
  const size = matrix.length; let score = 0;
  for (let r = 0; r < size; r++) {
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) { runLen++; if (runLen === 5) score += 3; else if (runLen > 5) score += 1; }
      else runLen = 1;
    }
  }
  return score;
}

function generateQRMatrix(text) {
  const bytes = Buffer.from(text, 'utf8');
  const ver = selectVersion(bytes.length);
  const { size, alignmentPatterns, version } = ver;
  const data = encodeData(text, ver);
  const codewords = addErrorCorrection(data, ver);
  const matrix = createMatrix(size);
  placeFinderPattern(matrix, 0, 0);
  placeFinderPattern(matrix, 0, size - 7);
  placeFinderPattern(matrix, size - 7, 0);
  placeTimingPatterns(matrix);
  for (const [ar, ac] of getAlignmentPositions(version, alignmentPatterns))
    placeAlignmentPattern(matrix, ar, ac);
  reserveFormatBits(matrix);
  placeDataBits(matrix, codewords);
  const reserved = createReservedMask(size, version, alignmentPatterns);
  let bestMask = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const masked = applyMask(matrix, reserved, m);
    placeFormatBits(masked, m);
    const s = penaltyScore(masked);
    if (s < bestScore) { bestScore = s; bestMask = m; }
  }
  const final = applyMask(matrix, reserved, bestMask);
  placeFormatBits(final, bestMask);
  return { matrix: final, version: ver, maskIdx: bestMask };
}

// ===== QR Decoder (minimal — reads data from matrix) =====
function readFormatInfo(matrix) {
  const size = matrix.length;
  // Read copy 1: row 8 and col 8
  let bits = 0;
  const col8Positions = [0, 1, 2, 3, 4, 5, 7, 8];
  for (let i = 0; i < 8; i++) bits |= matrix[8][col8Positions[i]] << i;
  const row8Positions = [7, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < 7; i++) bits |= matrix[row8Positions[i]][8] << (8 + i);
  return bits;
}

function readDataBits(matrix, reserved) {
  const size = matrix.length;
  const bits = [];
  let col = size - 1, upward = true;
  while (col >= 0) {
    if (col === 6) { col--; continue; }
    const rowRange = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);
    for (const row of rowRange) for (let dc = 0; dc <= 1; dc++) {
      const c = col - dc;
      if (c < 0 || reserved[row][c]) continue;
      bits.push(matrix[row][c]);
    }
    col -= 2; upward = !upward;
  }
  return bits;
}

function bitsToBytes(bits) {
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < 8; j++) bytes[i] |= bits[i * 8 + j] << (7 - j);
  }
  return bytes;
}

function unmaskData(matrix, reserved, maskIdx) {
  const size = matrix.length, fn = MASK_FUNCTIONS[maskIdx];
  const unmasked = matrix.map(row => [...row]);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
    if (!reserved[r][c] && fn(r, c)) unmasked[r][c] ^= 1;
  return unmasked;
}

// ===== Verification =====
function testRoundTrip(text) {
  const { matrix, version: ver, maskIdx } = generateQRMatrix(text);
  const { size, alignmentPatterns, version } = ver;

  // Step 1: Verify format info is correctly placed
  const formatBits = readFormatInfo(matrix);
  if (formatBits !== FORMAT_INFO[maskIdx]) {
    console.error(`  FAIL: format info mismatch: got 0x${formatBits.toString(16)}, expected 0x${FORMAT_INFO[maskIdx].toString(16)}`);
    return false;
  }

  // Step 2: Verify copy 2 of format info matches copy 1
  const size2 = matrix.length;
  let copy2bits = 0;
  for (let i = 0; i < 7; i++) copy2bits |= matrix[size2 - 7 + i][8] << (8 + i);
  for (let i = 0; i < 8; i++) copy2bits |= matrix[8][size2 - 8 + i] << (7 - i);
  if (copy2bits !== FORMAT_INFO[maskIdx]) {
    console.error(`  FAIL: format info copy 2 mismatch: got 0x${copy2bits.toString(16)}, expected 0x${FORMAT_INFO[maskIdx].toString(16)}`);
    return false;
  }

  // Step 3: Unmask the matrix and read data bits
  const reserved = createReservedMask(size, version, alignmentPatterns);
  const unmasked = unmaskData(matrix, reserved, maskIdx);
  const dataBits = readDataBits(unmasked, reserved);
  const allCodewords = bitsToBytes(dataBits);

  // Step 4: De-interleave codewords
  const { dataCapacity, ecPerBlock, blocks } = ver;
  const blockSize = Math.floor(dataCapacity / blocks);
  const largerBlocks = dataCapacity % blocks;
  const blockSizes = Array.from({ length: blocks }, (_, i) =>
    blockSize + (i >= blocks - largerBlocks ? 1 : 0));

  // Reconstruct data blocks from interleaved stream
  const maxDataLen = Math.max(...blockSizes);
  const dataBlocks = Array.from({ length: blocks }, () => []);
  let idx = 0;
  for (let i = 0; i < maxDataLen; i++)
    for (let b = 0; b < blocks; b++)
      if (i < blockSizes[b]) dataBlocks[b].push(allCodewords[idx++]);

  // Reconstruct EC blocks from interleaved stream
  const ecBlocks = Array.from({ length: blocks }, () => []);
  for (let i = 0; i < ecPerBlock; i++)
    for (let b = 0; b < blocks; b++) ecBlocks[b].push(allCodewords[idx++]);

  // Step 5: Verify syndromes for each block
  for (let b = 0; b < blocks; b++) {
    const full = new Uint8Array([...dataBlocks[b], ...ecBlocks[b]]);
    for (let i = 0; i < ecPerBlock; i++) {
      const syndrome = gfPolyEval(full, GF_EXP[i]);
      if (syndrome !== 0) {
        console.error(`  FAIL: block ${b} syndrome S${i} = ${syndrome} for text "${text.substring(0, 30)}..."`);
        return false;
      }
    }
  }

  // Step 6: Decode the byte mode message from block 0 data
  const dataCW = dataBlocks[0]; // For single-block codes
  // Read mode indicator (4 bits)
  const modeIndicator = (dataCW[0] >> 4) & 0xF;
  if (modeIndicator !== 4) {
    console.error(`  FAIL: mode indicator = ${modeIndicator} (expected 4 = byte mode)`);
    return false;
  }
  // Read character count (8 bits for v1-9)
  const charCount = ((dataCW[0] & 0xF) << 4) | (dataCW[1] >> 4);
  const originalBytes = Buffer.from(text, 'utf8');
  if (charCount !== originalBytes.length) {
    console.error(`  FAIL: char count = ${charCount} (expected ${originalBytes.length})`);
    return false;
  }
  // Read data bytes
  for (let i = 0; i < charCount; i++) {
    const bitStart = 12 + i * 8;
    const byteStart = bitStart >> 3;
    const bitOffset = bitStart & 7;
    const encoded = bitOffset === 0 ? dataCW[byteStart]
      : ((dataCW[byteStart] << bitOffset) | (dataCW[byteStart + 1] >> (8 - bitOffset))) & 0xFF;
    if (encoded !== originalBytes[i]) {
      console.error(`  FAIL: byte[${i}]='${String.fromCharCode(originalBytes[i])}' (${originalBytes[i]}) encoded as ${encoded}`);
      return false;
    }
  }

  console.log(`  PASS: "${text.substring(0, 50)}" v${version} mask${maskIdx} → round-trip OK (${allCodewords.length} CWs read)`);
  return true;
}

// ===== Run tests =====
console.log('\n=== QR Matrix Round-Trip Tests ===');
const tests = [
  'http://192.168.1.100:3000/12345',
  'http://192.168.1.100:3000/?mode=network&surface=sphere',
  'http://10.0.0.1:3000/99999',
  'Hello World',
  'HELLO WORLD',
  'A',
  'A'.repeat(15),
  'A'.repeat(17),
];

let failed = 0;
for (const t of tests) {
  if (!testRoundTrip(t)) failed++;
}

if (failed === 0) {
  console.log('\n=== ALL TESTS PASSED ===');
} else {
  console.log(`\n=== ${failed} TEST(S) FAILED ===`);
  process.exit(1);
}
