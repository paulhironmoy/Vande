/**
 * Browser side of scripts/camera-fixtures/measure-detection.mjs: runs the pinned pose engine on every picture of a clip.
 * The pictures are the very JPEG bytes of the fixture file (the same bytes Chromium decodes for the fake camera), shrunk the way the
 * camera input shrinks them, handed to the Pose Landmarker in VIDEO mode with strictly increasing timestamps (as a camera would).
 * Frames, landmarks and timings stay in memory and in the result of this call; nothing is sent anywhere.
 */
import { FilesetResolver, PoseLandmarker } from '/engine/vision_bundle.mjs';

let fileset = null;

window.detectClip = async function detectClip({ clip, ranges, fps, modelWidth, delegate, quality }) {
  fileset ??= await FilesetResolver.forVisionTasks('/engine/wasm');
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/model.task', delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
    outputSegmentationMasks: false,
  });
  const buf = await (await fetch(`/videos/${clip}.mjpeg`)).arrayBuffer();
  const landmarks = [];
  const ms = [];
  const decodeMs = [];
  for (let i = 0; i < ranges.length; i++) {
    const [s, e] = ranges[i];
    const t0 = performance.now();
    const blob = new Blob([buf.slice(s, e)], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob, modelWidth ? { resizeWidth: modelWidth, resizeQuality: quality } : undefined);
    const t1 = performance.now();
    const result = landmarker.detectForVideo(bitmap, Math.round((i * 1000) / fps));
    ms.push(performance.now() - t1);
    decodeMs.push(t1 - t0);
    bitmap.close();
    const pose = result.landmarks?.[0];
    landmarks.push(pose ? pose.flatMap((p) => [p.x, p.y, p.z, p.visibility ?? 0].map((v) => Math.round(v * 1e5) / 1e5)) : null);
  }
  landmarker.close();
  return { clip, delegate, modelWidth, quality, landmarks, ms, decodeMs };
};

window.__detectReady = true;
