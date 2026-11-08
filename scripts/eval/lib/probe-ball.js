/*
 * Evaluation probe, ball pixels (installed with context.addInitScript; never shipped). window.__eval gains:
 *   ballPixels(on)  while on, every rendered frame of the stage reads a small patch of the canvas around the
 *                   projected ball, right after the stage's own render (3D: the WebGL renderer's render is wrapped
 *                   on this page instance only; Classic: the 2D canvas is read each animation frame), and records the
 *                   ball's mean luminance against a ring of local background (contrast for READ2).
 *   ballStyle()     the ball as drawn: world scale of the ball mesh and which aids (outline, glow, trail) are visible.
 */
(() => {
  if (window.__eval && window.__eval.ballProbe) return;
  const E = (window.__eval = window.__eval || {});
  E.ballProbe = true;
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const samples = [];
  let active = false;
  let restore = null;
  let scratch = null;

  function measure(read) {
    const reg = E.regions && E.regions();
    if (!reg || !reg.ball) return;
    const canvas = document.querySelector('[data-testid="practice-canvas"]') || document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (reg.ball.x - rect.left) * sx;
    const cy = (reg.ball.y - rect.top) * sy;
    const rpx = Math.max(0.5, reg.ball.r * sx);
    const half = Math.ceil(rpx + 10 * sx);
    const x0 = Math.round(cx - half);
    const y0 = Math.round(cy - half);
    const w = half * 2;
    if (x0 < 0 || y0 < 0 || x0 + w > canvas.width || y0 + w > canvas.height) return;
    const px = read(x0, y0, w, w);
    if (!px) return;
    let inner = 0;
    let innerMax = 0;
    let nIn = 0;
    let ring = 0;
    let nRing = 0;
    for (let j = 0; j < w; j++)
      for (let i = 0; i < w; i++) {
        const d = Math.hypot(x0 + i + 0.5 - cx, y0 + j + 0.5 - cy);
        const k = (j * w + i) * 4;
        const l = L(px[k], px[k + 1], px[k + 2]);
        if (d <= Math.max(0.75, rpx * 0.7)) {
          inner += l;
          nIn++;
          if (l > innerMax) innerMax = l;
        } else if (d >= rpx + 4 * sx && d <= rpx + 9 * sx) {
          ring += l;
          nRing++;
        }
      }
    if (!nIn || !nRing) return;
    const a = inner / nIn;
    const b = ring / nRing;
    samples.push({ t: reg.t, x: reg.ball.x, y: reg.ball.y, diameterCss: reg.ball.r * 2, ballLum: a, peakLum: innerMax, bgLum: b, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), peakContrast: (Math.max(innerMax, b) + 0.05) / (Math.min(innerMax, b) + 0.05), stage: reg.stage });
  }

  E.ballPixels = (on) => {
    if (!on) {
      active = false;
      restore?.();
      restore = null;
      return samples.splice(0);
    }
    samples.splice(0);
    active = true;
    const stage = E.stage && E.stage();
    if (!stage) return 'no stage';
    const s3 = stage.kind === '3d' ? (stage.stage?.renderer ? stage.stage : Object.values(stage).find((v) => v && v.renderer && v.camera)) : null;
    if (s3) {
      const r = s3.renderer;
      const gl = r.getContext();
      const orig = r.render;
      r.render = function (...a) {
        orig.apply(this, a);
        if (active && E.flight && E.flight())
          measure((x, y, w, h) => {
            const buf = new Uint8Array(w * h * 4);
            // WebGL rows run bottom-up.
            gl.readPixels(x, gl.drawingBufferHeight - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            const out = new Uint8Array(w * h * 4);
            for (let j = 0; j < h; j++) out.set(buf.subarray((h - 1 - j) * w * 4, (h - j) * w * 4), j * w * 4);
            return out;
          });
      };
      restore = () => (r.render = orig);
      return '3d';
    }
    const canvas = document.querySelector('[data-testid="practice-canvas"]');
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return 'no context';
    scratch = ctx;
    const tick = () => {
      if (!active) return;
      measure((x, y, w, h) => scratch.getImageData(x, y, w, h).data);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    restore = () => (active = false);
    return '2d';
  };

  E.ballStyle = () => {
    const stage = E.stage && E.stage();
    if (!stage) return null;
    if (stage.kind !== '3d') return { stage: '2d', profile: stage.stats?.().profile ?? null };
    const s3 = stage.stage;
    const fx = s3 && s3.ballFx;
    let mesh = null;
    (fx ? fx.group : s3.scene).traverse((o) => {
      if (!mesh && o.isMesh && o.geometry?.type === 'SphereGeometry' && o.geometry.parameters?.radius > 0.03 && o.geometry.parameters.radius < 0.045) mesh = o;
    });
    if (!mesh) return { stage: '3d', mesh: false };
    const e = mesh.matrixWorld.elements;
    const scale = Math.hypot(e[0], e[1], e[2]);
    const vis = [];
    (fx ? fx.group : mesh.parent).traverse((o) => o.isMesh && vis.push({ geo: o.geometry?.type, visible: o.visible, scale: Math.round(o.scale.x * 1000) / 1000 }));
    return { stage: '3d', profile: stage.stats?.().profile ?? null, radius: mesh.geometry.parameters.radius, worldScale: Math.round(scale * 1000) / 1000, parts: vis };
  };
})();
