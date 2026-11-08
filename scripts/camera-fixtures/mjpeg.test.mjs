/** Tests of the motion-JPEG helpers. They build real JPEG files with ffmpeg only if it is installed; otherwise a hand-made file. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeMjpeg, jpegInfo, splitMjpeg } from './mjpeg.mjs';

/** A tiny well-formed baseline JPEG header with a 640x480 4:2:0 frame segment, a scan and an end marker. */
function fakeJpeg(payloadLength) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const data = Buffer.alloc(payloadLength, 0x41);
  data[3] = 0xff; // a stuffed byte: FF 00 is data, not a marker
  data[4] = 0x00;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, data, Buffer.from([0xff, 0xd9])]);
}

test('splits pictures and reads their size and chroma sampling', () => {
  const file = Buffer.concat([fakeJpeg(50), fakeJpeg(80), fakeJpeg(10)]);
  const frames = splitMjpeg(file);
  assert.equal(frames.length, 3);
  assert.equal(frames[1][1] - frames[1][0], fakeJpeg(80).length);
  const info = jpegInfo(file, frames[0][0]);
  assert.deepEqual([info.width, info.height, info.chroma, info.progressive], [640, 480, '4:2:0', false]);
  const d = describeMjpeg(file);
  assert.equal(d.frames, 3);
  assert.equal(d.width, 640);
  assert.equal(d.bytes, file.length);
});

test('an empty or damaged file has no pictures', () => {
  assert.equal(splitMjpeg(Buffer.alloc(0)).length, 0);
  assert.equal(splitMjpeg(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00])).length, 0);
});

// The check against real ffmpeg output only exists on a machine that has ffmpeg (the fixtures cannot be generated without it).
if (spawnSync('ffmpeg', ['-version']).status === 0) {
  test('reads what ffmpeg writes: 30 pictures of 640x480, baseline 4:2:0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mj-'));
    const out = join(dir, 'a.mjpeg');
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:r=30:d=1', '-c:v', 'mjpeg', '-q:v', '3', '-pix_fmt', 'yuvj420p', '-f', 'mjpeg', out]);
    assert.equal(r.status, 0, String(r.stderr));
    const d = describeMjpeg(readFileSync(out));
    assert.deepEqual([d.frames, d.width, d.height, d.chroma, d.progressive], [30, 640, 480, '4:2:0', false]);
  });
}
