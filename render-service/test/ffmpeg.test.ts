import { describe, expect, it } from 'vitest';
import { ffmpegArgs } from '../src/ffmpeg.ts';

describe('ffmpeg arguments', () => {
  it('encodes piped JPEG frames to a silent, fast-start H.264 yuv420p Short at 30 fps', () => {
    const args = ffmpegArgs({ output: '/tmp/j1.mp4', durationMs: 42_000, capture: 'jpeg' });
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args.slice(0, 4)).toEqual(['-hide_banner', '-loglevel', 'error', '-y']);
    expect(at('-f')).toBe('image2pipe');
    expect(at('-framerate')).toBe('30');
    expect(args.indexOf('-c:v')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-c:v')]).toBe('-c:v');
    expect(at('-i')).toBe('pipe:0');
    expect(args).toContain('mjpeg');
    expect(args.join(' ')).toContain('-c:v libx264');
    expect(at('-pix_fmt')).toBe('yuv420p');
    expect(at('-vf')).toBe('scale=1080:1920:flags=lanczos,format=yuv420p');
    expect(at('-r')).toBe('30');
    expect(at('-movflags')).toBe('+faststart');
    expect(at('-t')).toBe('42.000');
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(args[args.length - 1]).toBe('/tmp/j1.mp4');
  });

  it('muxes the composer audio when the page provides it, and supports PNG frames', () => {
    const args = ffmpegArgs({ output: 'o.mp4', durationMs: 30_000, capture: 'png', audio: '/tmp/j1.wav', crf: 18, preset: 'slow' });
    expect(args).toContain('png');
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args[args.lastIndexOf('-i') + 1]).toBe('/tmp/j1.wav');
    expect(args.join(' ')).toContain('-c:a aac -b:a 128k -shortest');
    expect(args).not.toContain('-an');
    expect(args[args.indexOf('-crf') + 1]).toBe('18');
    expect(args[args.indexOf('-preset') + 1]).toBe('slow');
  });
});
