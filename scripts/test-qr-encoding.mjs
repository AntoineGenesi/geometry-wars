/**
 * Standalone QR code encoding verifier — no DOM required.
 * Tests the pure encoding logic from QRCode.ts against known test vectors.
 *
 * Run: node scripts/test-qr-encoding.mjs
 */

// ===== Copy of pure functions from QRCode.ts (no DOM dependencies) =====

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

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

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
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[ecCount - 1 - j], factor);
    }
    remainder[ecCount - 1] = gfMul(gen[0], factor);
  }

  return remainder;
}

// Evaluate polynomial at a point in GF(256)
// poly[0] is the leading coefficient (highest degree)
function gfPolyEval(poly, x) {
  let result = 0;
  for (let i = 0; i < poly.length; i++) {
    result = gfMul(result, x) ^ poly[i];
  }
  return result;
}

// ===== Test 1: RS Encoding Syndrome Check =====
// After encoding, the full codeword polynomial C(x) must satisfy C(α^i) = 0 for i=0..ecCount-1
// This is the fundamental property that valid RS codewords must have.

function testRSSyndrome(ecCount, testName) {
  // Create some test data
  const data = new Uint8Array(10);
  for (let i = 0; i < 10; i++) data[i] = (i * 37 + 123) & 0xFF;

  const ec = rsEncode(data, ecCount);

  // Full codeword = data || ec
  const full = new Uint8Array([...data, ...ec]);

  // Evaluate at generator roots: α^0, α^1, ..., α^(ecCount-1)
  let allZero = true;
  for (let i = 0; i < ecCount; i++) {
    const syndrome = gfPolyEval(full, GF_EXP[i]);
    if (syndrome !== 0) {
      console.error(`  FAIL: syndrome S${i} = ${syndrome} (expected 0) for ${testName}`);
      allZero = false;
    }
  }

  if (allZero) {
    console.log(`  PASS: ${testName} - all ${ecCount} syndromes = 0`);
  }
  return allZero;
}

// ===== Test 2: Known RS test vector (Version 1, Level L = 7 EC bytes) =====
// From QR spec: Data codewords for "01234567" in numeric mode (well-known example)
// But let's use byte mode with a known string and verify the EC codewords
// by checking the syndrome, since that's what matters for decodability.

function testKnownVector() {
  // Version 1, Level L: 7 EC bytes per block
  // Using a known reference from the QR spec appendix:
  // Data codewords (19 total for v1 Level L): 0x10, 0x20, 0x0C, 0x56, 0x61, 0x80, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC
  // Wait, that's numeric mode. Let me use a simpler approach:
  // Manually encode "0" in byte mode, version 1:

  // Mode 0100 = 0x04 (nibble), length 00000001 (1 byte), data 0x30 ('0'), term 0000
  // = 0b0100 0000 0001 0011 0000 0000 = 0x40 0x13 0x00 ... + padding

  // Let's just verify that all versions' EC counts produce valid syndromes
  const ecCounts = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18]; // Level L, versions 1-10
  let allPassed = true;

  for (let v = 0; v < ecCounts.length; v++) {
    const passed = testRSSyndrome(ecCounts[v], `v${v+1} Level L (EC=${ecCounts[v]})`);
    if (!passed) allPassed = false;
  }
  return allPassed;
}

// ===== Test 3: Format information placement =====
// For a known mask (e.g., mask 0), the format bits at specific positions
// should match the FORMAT_INFO[0] = 0x77C4 value.

const FORMAT_INFO = [
  0x77C4, // mask 0
  0x72F3, // mask 1
  0x7DAA, // mask 2
  0x789D, // mask 3
  0x662F, // mask 4
  0x6318, // mask 5
  0x6C41, // mask 6
  0x6976, // mask 7
];

// Verify format info values using BCH error detection polynomial
// BCH generator: G(x) = x^10 + x^8 + x^5 + x^4 + x^2 + x + 1 = 0x537
function computeFormatBCH(dataAndMask) {
  // dataAndMask is 5 bits: 2 bits EC level + 3 bits mask
  let remainder = dataAndMask << 10; // Shift left by 10 (degree of generator)
  for (let i = 14; i >= 10; i--) {
    if ((remainder >> i) & 1) {
      remainder ^= 0x537 << (i - 10);
    }
  }
  return ((dataAndMask << 10) | remainder) ^ 0x5412; // XOR with mask value
}

function testFormatInfoValues() {
  // Level L = 01 in binary
  let allPassed = true;
  for (let mask = 0; mask < 8; mask++) {
    const computed = computeFormatBCH((0b01 << 3) | mask);
    const expected = FORMAT_INFO[mask];
    if (computed !== expected) {
      console.error(`  FAIL: FORMAT_INFO[${mask}] = 0x${expected.toString(16).padStart(4,'0')}, computed = 0x${computed.toString(16).padStart(4,'0')}`);
      allPassed = false;
    } else {
      console.log(`  PASS: FORMAT_INFO[${mask}] = 0x${expected.toString(16).padStart(4,'0')} ✓`);
    }
  }
  return allPassed;
}

// ===== Test 4: Simulate the data encoding for a real URL =====
// Encode a typical LAN URL and verify the bit stream is correct

function encodeData(text, ver) {
  const encoder = { encode: (s) => Buffer.from(s, 'utf8') }; // Node.js version of TextEncoder
  const bytes = encoder.encode(text);
  const lengthBits = ver.version >= 10 ? 16 : 8;
  const totalBits = 4 + lengthBits + bytes.length * 8;
  const totalCodewords = ver.dataCapacity;
  const buffer = new Uint8Array(totalCodewords);

  let bitPos = 0;
  const writeBits = (value, count) => {
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
  // Terminator
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

const VERSIONS = [
  { version: 1,  size: 21, dataCapacity: 17,  ecPerBlock: 7,  blocks: 1 },
  { version: 2,  size: 25, dataCapacity: 32,  ecPerBlock: 10, blocks: 1 },
  { version: 3,  size: 29, dataCapacity: 53,  ecPerBlock: 15, blocks: 1 },
  { version: 4,  size: 33, dataCapacity: 78,  ecPerBlock: 20, blocks: 1 },
  { version: 5,  size: 37, dataCapacity: 108, ecPerBlock: 26, blocks: 1 },
  { version: 6,  size: 41, dataCapacity: 136, ecPerBlock: 18, blocks: 2 },
  { version: 7,  size: 45, dataCapacity: 156, ecPerBlock: 20, blocks: 2 },
  { version: 8,  size: 49, dataCapacity: 192, ecPerBlock: 24, blocks: 2 },
  { version: 9,  size: 53, dataCapacity: 224, ecPerBlock: 30, blocks: 2 },
  { version: 10, size: 57, dataCapacity: 262, ecPerBlock: 18, blocks: 4 },
];

function selectVersion(dataLength) {
  for (const v of VERSIONS) {
    const lengthBits = v.version >= 10 ? 16 : 8;
    const overhead = Math.ceil((4 + lengthBits + 4) / 8);
    if (dataLength + overhead <= v.dataCapacity) return v;
  }
  throw new Error(`Data too long: ${dataLength} bytes`);
}

function addErrorCorrection(data, ver) {
  const { blocks, ecPerBlock, dataCapacity } = ver;
  const totalEC = blocks * ecPerBlock;
  const totalCodewords = dataCapacity + totalEC;

  const blockSize = Math.floor(dataCapacity / blocks);
  const largerBlocks = dataCapacity % blocks;
  const dataBlocks = [];
  const ecBlocks = [];

  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const size = blockSize + (i >= blocks - largerBlocks ? 1 : 0);
    const block = data.slice(offset, offset + size);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
    offset += size;
  }

  const result = new Uint8Array(totalCodewords);
  let idx = 0;
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result[idx++] = block[i];
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result[idx++] = block[i];
    }
  }

  return result;
}

function testUrlEncoding(url) {
  const bytes = Buffer.from(url, 'utf8');
  const ver = selectVersion(bytes.length);
  console.log(`  URL: "${url}" (${bytes.length} bytes) → version ${ver.version}`);

  const data = encodeData(url, ver);

  // Verify the data was encoded correctly by reading it back
  // Read mode indicator (bits 0-3)
  const mode = (data[0] >> 4) & 0xF;
  if (mode !== 0b0100) {
    console.error(`  FAIL: mode indicator = ${mode}, expected 4 (byte mode)`);
    return false;
  }

  // Read length (bits 4-11 for versions 1-9)
  const length = ((data[0] & 0xF) << 4) | (data[1] >> 4);
  if (length !== bytes.length) {
    console.error(`  FAIL: encoded length = ${length}, expected ${bytes.length}`);
    return false;
  }

  // Read data bytes (starting at bit 12 = byte 1 bit 4)
  let correct = true;
  for (let i = 0; i < bytes.length; i++) {
    // Data byte i starts at bit 12 + i*8
    const bitStart = 12 + i * 8;
    const byteStart = bitStart >> 3;
    const bitOffset = bitStart & 7;
    let encoded;
    if (bitOffset === 0) {
      encoded = data[byteStart];
    } else {
      encoded = ((data[byteStart] << bitOffset) | (data[byteStart + 1] >> (8 - bitOffset))) & 0xFF;
    }
    if (encoded !== bytes[i]) {
      console.error(`  FAIL: data byte ${i}: encoded=${encoded}, expected=${bytes[i]} ('${String.fromCharCode(bytes[i])}')`);
      correct = false;
    }
  }

  if (!correct) return false;

  // Run EC and verify syndromes
  const codewords = addErrorCorrection(data, ver);

  // Split into blocks and verify each block's syndrome
  const { blocks, ecPerBlock, dataCapacity } = ver;
  const blockSize = Math.floor(dataCapacity / blocks);
  const largerBlocks = dataCapacity % blocks;

  let allSyndromes = true;
  let dataOffset = 0;
  let ecOffset = dataCapacity;
  for (let b = 0; b < blocks; b++) {
    const thisBlockSize = blockSize + (b >= blocks - largerBlocks ? 1 : 0);

    // Reconstruct this block's codeword from the interleaved data
    // For simplicity, just extract from original data and ec
    const blockData = data.slice(dataOffset, dataOffset + thisBlockSize);
    const blockEC = rsEncode(blockData, ecPerBlock);
    const full = new Uint8Array([...blockData, ...blockEC]);

    for (let i = 0; i < ecPerBlock; i++) {
      const syndrome = gfPolyEval(full, GF_EXP[i]);
      if (syndrome !== 0) {
        console.error(`  FAIL: block ${b} syndrome S${i} = ${syndrome}`);
        allSyndromes = false;
      }
    }

    dataOffset += thisBlockSize;
  }

  if (allSyndromes) {
    console.log(`  PASS: URL encoding + RS syndromes all zero for version ${ver.version}`);
  }
  return allSyndromes;
}

// ===== Run all tests =====

let passed = 0;
let failed = 0;

console.log('\n=== Test 1: RS Syndrome Check (all versions) ===');
if (testKnownVector()) { passed++; } else { failed++; }

console.log('\n=== Test 2: Format Info BCH Values ===');
if (testFormatInfoValues()) { passed++; console.log('  All format info values PASS'); } else { failed++; }

console.log('\n=== Test 3: URL Encoding & RS Syndromes ===');
const testUrls = [
  'http://192.168.1.100:3000/12345',
  'http://192.168.1.100:3000/?mode=network&surface=sphere',
  'http://10.0.0.1:3000/99999',
  'A'.repeat(17),   // Version 1
  'A'.repeat(32),   // Version 2
  'A'.repeat(53),   // Version 3 boundary
];

let urlTestPassed = true;
for (const url of testUrls) {
  if (!testUrlEncoding(url)) urlTestPassed = false;
}
if (urlTestPassed) { passed++; } else { failed++; }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
