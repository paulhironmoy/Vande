/**
 * Helpers for the .mjpeg files the fake camera plays: a motion-JPEG file is the JPEG pictures one after the other.
 * Pure functions on a Buffer (no browser, no ffmpeg), used by generate.mjs, the verifier and the detection harness.
 */

/** The [start, end) byte ranges of every JPEG picture in the file (start of image FFD8 to the matching end of image FFD9). */
export function splitMjpeg(buf) {
  const frames = [];
  let i = 0;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff || buf[i + 1] !== 0xd8) {
      i++;
      continue;
    }
    // Walk the segments so an FFD9 inside entropy-coded data (impossible: it is stuffed) or an APP payload cannot end a picture early.
    let p = i + 2;
    let end = -1;
    while (p + 1 < buf.length) {
      if (buf[p] !== 0xff) {
        p++;
        continue;
      }
      const m = buf[p + 1];
      if (m === 0xd9) {
        end = p + 2;
        break;
      }
      if (m === 0x00 || m === 0xff || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        p += m === 0xff ? 1 : 2;
        continue;
      }
      if (p + 3 >= buf.length) break;
      if (m === 0xda) {
        // Start of scan: skip its header, then the entropy-coded data up to the next real marker.
        p += 2 + buf.readUInt16BE(p + 2);
        while (p + 1 < buf.length && !(buf[p] === 0xff && buf[p + 1] !== 0x00 && !(buf[p + 1] >= 0xd0 && buf[p + 1] <= 0xd7))) p++;
        continue;
      }
      p += 2 + buf.readUInt16BE(p + 2);
    }
    if (end < 0) break;
    frames.push([i, end]);
    i = end;
  }
  return frames;
}

/** Width, height and the chroma sampling of the first picture (from its start-of-frame segment), or null. */
export function jpegInfo(buf, start = 0) {
  let p = start + 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) {
      p++;
      continue;
    }
    const m = buf[p + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const components = buf[p + 9];
      const sampling = [];
      for (let c = 0; c < components; c++) sampling.push(buf[p + 11 + c * 3]);
      return {
        progressive: m === 0xc2,
        height: buf.readUInt16BE(p + 5),
        width: buf.readUInt16BE(p + 7),
        components,
        // 0x22 for the first component with two others at 0x11 is 4:2:0.
        chroma: components === 3 ? (sampling[0] === 0x22 ? '4:2:0' : sampling[0] === 0x21 ? '4:2:2' : sampling[0] === 0x11 ? '4:4:4' : 'other') : 'grey',
      };
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0x00) {
      p += 2;
      continue;
    }
    p += 2 + buf.readUInt16BE(p + 2);
  }
  return null;
}

/** Summary of a whole file: frame count, picture size, mean and largest picture in bytes. */
export function describeMjpeg(buf) {
  const frames = splitMjpeg(buf);
  const info = frames.length ? jpegInfo(buf, frames[0][0]) : null;
  const sizes = frames.map(([a, b]) => b - a);
  return {
    frames: frames.length,
    width: info?.width ?? null,
    height: info?.height ?? null,
    chroma: info?.chroma ?? null,
    progressive: info?.progressive ?? null,
    bytes: buf.length,
    meanFrameBytes: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0,
    maxFrameBytes: sizes.length ? Math.max(...sizes) : 0,
  };
}
