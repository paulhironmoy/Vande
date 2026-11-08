/**
 * Minimal deterministic PNG writer and reader (8-bit RGB / RGBA, non-interlaced). The writer always emits the same
 * chunks in the same order with no timestamp, gamma or text chunk, and picks each row filter by a fixed heuristic, so
 * the same pixels give the same bytes with the same zlib.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffers) {
  let c = 0xffffffff;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([typeBuf, data]));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Encode width x height RGB8 pixels (Uint8Array, row-major, top row first) as PNG bytes. */
export function encodePng(width, height, rgb) {
  if (rgb.length !== width * height * 3) throw new Error('encodePng: pixel buffer has the wrong length');
  const bpp = 3;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const prev = y > 0 ? row - stride : -1;
    let bestFilter = 0;
    let bestScore = Infinity;
    let best = null;
    for (let f = 0; f <= 4; f += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const x = rgb[row + i];
        const a = i >= bpp ? rgb[row + i - bpp] : 0;
        const b = prev >= 0 ? rgb[prev + i] : 0;
        const c = prev >= 0 && i >= bpp ? rgb[prev + i - bpp] : 0;
        let v;
        if (f === 0) v = x;
        else if (f === 1) v = x - a;
        else if (f === 2) v = x - b;
        else if (f === 3) v = x - ((a + b) >> 1);
        else v = x - paeth(a, b, c);
        v &= 0xff;
        candidate[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        best = Buffer.from(candidate);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    best.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9, memLevel: 9, strategy: 0 });
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Decode an 8-bit RGB or RGBA non-interlaced PNG into { width, height, rgb } (alpha dropped). */
export function decodePng(bytes) {
  const buf = Buffer.from(bytes);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePng: not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('decodePng: only 8-bit non-interlaced images');
      colourType = data[9];
      if (colourType !== 2 && colourType !== 6) throw new Error('decodePng: only RGB or RGBA');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i];
      const a = i >= bpp ? out[row + i - bpp] : 0;
      const b = y > 0 ? out[row - stride + i] : 0;
      const c = y > 0 && i >= bpp ? out[row - stride + i - bpp] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`decodePng: bad filter ${filter}`);
      out[row + i] = v & 0xff;
    }
  }
  if (bpp === 3) return { width, height, rgb: out };
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0, q = 0; p < out.length; p += 4, q += 3) {
    rgb[q] = out[p];
    rgb[q + 1] = out[p + 1];
    rgb[q + 2] = out[p + 2];
  }
  return { width, height, rgb };
}
