import { readFileSync, statSync } from 'fs';
import { inflateSync } from 'zlib';

const PNG_SIGNATURE = '89504e470d0a1a0a';

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function channelsForColorType(colorType) {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 4: return 2;
    case 6: return 4;
    default:
      throw new Error(`Unsupported PNG color type ${colorType}`);
  }
}

function readPng(path) {
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new Error(`${path} is not a PNG`);
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  if (bitDepth !== 8) throw new Error(`${path} uses unsupported PNG bit depth ${bitDepth}`);
  const channels = channelsForColorType(colorType);
  const bytesPerPixel = channels;
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);

  let sourceOffset = 0;
  let targetOffset = 0;
  let previousRow = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = inflated[sourceOffset++];
    const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + rowBytes));
    sourceOffset += rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previousRow[x] ?? 0;
      const upLeft = x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + up) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (row[x] + paethPredictor(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`${path} uses unsupported PNG filter ${filter}`);
    }

    row.copy(pixels, targetOffset);
    targetOffset += rowBytes;
    previousRow = row;
  }

  return { width, height, channels, pixels };
}

export function screenshotPixelStats(path, options = {}) {
  const { width, height, channels, pixels } = readPng(path);
  const maxSamples = options.maxSamples ?? 8192;
  const pixelCount = width * height;
  const stride = Math.max(1, Math.floor(pixelCount / maxSamples));
  const unique = new Set();
  let samples = 0;
  let nonDark = 0;
  let bright = 0;
  let alphaVisible = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += stride) {
    const offset = pixelIndex * channels;
    const r = pixels[offset] ?? 0;
    const g = channels === 1 ? r : pixels[offset + 1] ?? r;
    const b = channels === 1 ? r : pixels[offset + 2] ?? r;
    const a = channels === 4 ? pixels[offset + 3] ?? 255 : 255;
    const max = Math.max(r, g, b);
    if (a > 0) alphaVisible++;
    if (a > 0 && max >= 25) nonDark++;
    if (a > 0 && max >= 90) bright++;
    unique.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 4}`);
    samples++;
  }

  const stats = {
    path,
    bytes: statSync(path).size,
    width,
    height,
    samples,
    alphaVisible,
    nonDark,
    bright,
    uniqueBuckets: unique.size,
  };
  stats.nonblank = stats.bytes > 0
    && stats.width > 0
    && stats.height > 0
    && stats.alphaVisible !== 0
    && stats.nonDark >= Math.max(8, Math.floor(stats.samples * 0.005))
    && stats.uniqueBuckets >= 4;
  return stats;
}
