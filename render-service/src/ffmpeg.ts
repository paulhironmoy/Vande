/**
 * ffmpeg command line: frames arrive on stdin as JPEG (or PNG) images, one per frame, and leave as an H.264 MP4
 * (yuv420p, high profile, +faststart so playback starts before the download ends) at exactly 30 fps and 1080×1920.
 * Silent unless the render page supplied its own generated audio (a WAV file next to the output).
 */
import { FPS, HEIGHT, WIDTH } from './schedule.ts';

export interface FfmpegOptions {
  output: string;
  durationMs: number;
  capture: 'jpeg' | 'png';
  fps?: number;
  audio?: string | null;
  crf?: number;
  preset?: 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
}

export function ffmpegArgs(o: FfmpegOptions): string[] {
  const fps = o.fps ?? FPS;
  const seconds = (o.durationMs / 1000).toFixed(3);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', o.capture === 'png' ? 'png' : 'mjpeg', '-i', 'pipe:0'];
  if (o.audio) args.push('-i', o.audio);
  args.push(
    '-vf',
    `scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    o.preset ?? 'medium',
    '-crf',
    String(o.crf ?? 20),
    '-profile:v',
    'high',
    '-level:v',
    '4.2',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-g',
    String(fps * 2),
  );
  if (o.audio) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  else args.push('-an');
  args.push('-t', seconds, '-movflags', '+faststart', o.output);
  return args;
}
