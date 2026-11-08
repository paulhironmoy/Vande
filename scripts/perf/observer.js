/*
 * Passive in-page recorder for the Practice performance harness (scripts/perf/practice-frames.mjs), added with
 * addInitScript before any page script. It never changes what the app renders: every WebGL wrapper calls the original
 * with the same arguments and returns its result, and the only extra work per frame is one rAF callback that stores a
 * timestamp and reads one data attribute.
 *
 * window.__perf holds:
 *   frames     rAF timestamps (ms, performance clock): the frame cadence the app's own monitor also samples
 *   phases     [t, screen, phase, stage, tier] each time the play screen's data attributes (or the test API state) change
 *   longTasks  [start, duration] from the Long Tasks API; loaf: long animation frames with their slowest scripts
 *   gl         program links and shader compiles (timestamped), slow status queries (where a parallel compile is
 *              waited for), and the bytes the app has allocated in textures, renderbuffers and buffers
 */
(() => {
  if (window.__perf) return;
  const now = () => performance.now();
  const MAX = 400000;
  const P = (window.__perf = {
    frames: [],
    phases: [],
    longTasks: [],
    loaf: [],
    gl: { links: [], compiles: [], waits: [], contexts: [], tex: 0, texPeak: 0, rb: 0, rbPeak: 0, buf: 0, bufPeak: 0, programs: 0 },
    marks: [],
  });
  P.mark = (name) => P.marks.push([now(), name]);

  // ---- phases ------------------------------------------------------------------------------------------------------
  let last = '';
  let playEl = null;
  const readPhase = () => {
    // The play screen's element is looked up again only when it has gone (one cheap check per frame otherwise).
    if (!playEl || !playEl.isConnected) playEl = document.querySelector('[data-testid=practice-play]');
    const el = playEl;
    let rec = null;
    if (el && el.dataset.phase) rec = [el.dataset.screen ?? '', el.dataset.phase ?? '', el.dataset.stage ?? '', el.dataset.tier ?? ''];
    else {
      try {
        const st = window.__vandePractice && window.__vandePractice.state();
        if (st) rec = [st.screen ?? '', st.phase ?? '', st.stage ?? '', st.tier ?? ''];
      } catch {
        /* not ready */
      }
    }
    if (!rec) return;
    const key = rec.join('|');
    if (key !== last) {
      last = key;
      P.phases.push([now(), ...rec]);
    }
  };
  new MutationObserver(readPhase).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase', 'data-screen', 'data-stage', 'data-tier'] });

  // ---- frames ------------------------------------------------------------------------------------------------------
  const raf = window.requestAnimationFrame.bind(window);
  // The live WebGL canvas's drawing-buffer size, logged when it changes (a profile change resizes it).
  P.buffers = [];
  let lastBuf = '';
  const readBuffer = () => {
    const c = P.gl.contexts.length ? P.gl.contexts[P.gl.contexts.length - 1] : null;
    const el = c && !c.lost ? c.ref.deref() : null;
    const key = el ? `${el.width}x${el.height}` : '';
    if (key !== lastBuf) {
      lastBuf = key;
      P.buffers.push([now(), key]);
    }
  };
  const tick = (t) => {
    if (P.frames.length < MAX) P.frames.push(t);
    readPhase();
    readBuffer();
    raf(tick);
  };
  raf(tick);

  // ---- long tasks and long animation frames ------------------------------------------------------------------------
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.longTasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* unsupported */
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const scripts = (e.scripts || [])
          .slice()
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map((s) => [Math.round(s.duration), String(s.invoker || '').slice(0, 80), String(s.sourceFunctionName || '').slice(0, 60)]);
        P.loaf.push([e.startTime, e.duration, e.blockingDuration || 0, Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), scripts]);
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    /* unsupported */
  }

  // Resource loads (any fetch of a script, style, font, image, audio or data file), for "nothing loads mid-delivery".
  P.resources = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.resources.push([e.startTime, e.initiatorType, String(e.name).slice(-80), Math.round(e.duration)]);
    }).observe({ type: 'resource', buffered: true });
  } catch {
    /* unsupported */
  }

  // Event Timing: each input's delay, handler time and the time to the next paint (durations of 16 ms or more).
  P.events = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.events.push([e.startTime, e.name, Math.round(e.processingStart - e.startTime), Math.round(e.processingEnd - e.processingStart), e.duration]);
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch {
    /* unsupported */
  }

  // ---- WebGL -------------------------------------------------------------------------------------------------------
  const G = P.gl;
  const safe = (f) => {
    try {
      f();
    } catch {
      /* the recorder never breaks the app */
    }
  };
  const wrap = (proto, name, after) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args) {
      const t0 = now();
      const r = orig.apply(this, args);
      const ms = now() - t0;
      safe(() => after.call(this, args, r, t0, ms));
      return r;
    };
  };
  // Hot calls (binds, many per frame): no clock reads, no allocation.
  const wrapFast = (proto, name, after) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (a, b) {
      const r = orig.apply(this, arguments);
      try {
        after.call(this, a, b);
      } catch {
        /* never breaks the app */
      }
      return r;
    };
  };
  // Bytes per texel for the internal formats three.js uses (unknown formats count as 4).
  const BPP = { 0x1906: 1, 0x1909: 1, 0x190a: 2, 0x1907: 3, 0x1908: 4, 0x8229: 1, 0x822b: 2, 0x8051: 3, 0x8058: 4, 0x8c43: 4, 0x881a: 8, 0x8814: 16, 0x822d: 2, 0x822e: 4, 0x8230: 8, 0x881b: 6, 0x8815: 12, 0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8d48: 1, 0x8c3a: 4, 0x8c3d: 4, 0x8d62: 2, 0x8056: 2, 0x8057: 2 };
  const bpp = (fmt, type) => BPP[fmt] ?? (type === 0x1406 ? 16 : type === 0x140b || type === 0x8d61 ? 8 : 4);
  const state = new WeakMap();
  const ctx = (gl) => {
    let s = state.get(gl);
    if (!s) {
      s = { unit: 0, tex: new Map(), rb: null, buf: new Map(), texSize: new Map(), rbSize: new Map(), bufSize: new Map(), totals: { tex: 0, rb: 0, buf: 0 } };
      state.set(gl, s);
    }
    return s;
  };
  // Bytes held, per context and in all; a lost context (dispose() forces the loss) frees everything it held.
  const add = (s, kind, delta) => {
    s.totals[kind] += delta;
    G[kind] += delta;
    G[`${kind}Peak`] = Math.max(G[`${kind}Peak`], G[kind]);
  };
  const release = (gl) => {
    const s = ctx(gl);
    for (const kind of ['tex', 'rb', 'buf']) add(s, kind, -s.totals[kind]);
    s.texSize = new Map();
    s.rbSize = new Map();
    s.bufSize = new Map();
  };
  const texTarget = (gl, target) => (target >= 0x8515 && target <= 0x851a ? 0x8513 : target); // cube faces → the cube
  const setTex = (gl, target, key, bytes) => {
    const s = ctx(gl);
    const t = s.tex.get(s.unit * 65536 + texTarget(gl, target));
    if (!t) return;
    let m = s.texSize.get(t);
    if (!m) s.texSize.set(t, (m = new Map()));
    add(s, 'tex', bytes - (m.get(key) || 0));
    m.set(key, bytes);
  };
  const imgSize = (src) => (src ? [src.videoWidth || src.naturalWidth || src.displayWidth || src.width || 0, src.videoHeight || src.naturalHeight || src.displayHeight || src.height || 0] : [0, 0]);
  // window.__perfNoGl (set by an earlier init script) leaves WebGL alone: the A/B check of this recorder's own cost.
  for (const C of window.__perfNoGl ? [] : [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const p = C.prototype;
    wrap(p, 'linkProgram', function (args, r, t0, ms) {
      G.links.push([t0, ms]);
      G.programs++;
    });
    wrap(p, 'deleteProgram', () => G.programs--);
    wrap(p, 'compileShader', (args, r, t0, ms) => G.compiles.push([t0, ms]));
    for (const q of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getActiveUniform', 'getUniformLocation', 'getAttribLocation']) wrap(p, q, (args, r, t0, ms) => ms > 1 && G.waits.push([t0, ms, q]));
    wrapFast(p, 'activeTexture', function (unit) {
      ctx(this).unit = unit;
    });
    wrapFast(p, 'bindTexture', function (target, tex) {
      const s = ctx(this);
      s.tex.set(s.unit * 65536 + target, tex);
    });
    wrap(p, 'texImage2D', function (args) {
      const [target, level, ifmt] = args;
      const [w, h, type] = args.length >= 8 ? [args[3], args[4], args[7]] : [...imgSize(args[5]), args[4]];
      setTex(this, target, `${target}:${level}`, w * h * bpp(ifmt, type));
    });
    wrap(p, 'texImage3D', function (args) {
      const [target, level, ifmt, w, h, d] = args;
      setTex(this, target, `${target}:${level}`, w * h * d * bpp(ifmt, args[8]));
    });
    wrap(p, 'texStorage2D', function (args) {
      const [target, levels, ifmt, w, h] = args;
      let b = 0;
      for (let l = 0, x = w, y = h; l < levels; l++, x = Math.max(1, x >> 1), y = Math.max(1, y >> 1)) b += x * y * bpp(ifmt);
      setTex(this, target, 'storage', b * (target === 0x8513 ? 6 : 1));
    });
    wrap(p, 'texStorage3D', function (args) {
      const [target, levels, ifmt, w, h, d] = args;
      setTex(this, target, 'storage', w * h * d * bpp(ifmt) * (levels > 1 ? 4 / 3 : 1));
    });
    wrap(p, 'compressedTexImage2D', function (args) {
      const data = args[6];
      setTex(this, args[0], `${args[0]}:${args[1]}`, data && data.byteLength ? data.byteLength : 0);
    });
    wrap(p, 'generateMipmap', function (args) {
      const s = ctx(this);
      const t = s.tex.get(s.unit * 65536 + args[0]);
      const m = t && s.texSize.get(t);
      if (!m) return;
      let base = 0;
      for (const [k, v] of m) if (k.endsWith(':0')) base += v;
      setTex(this, args[0], 'mips', Math.round(base / 3));
    });
    wrap(p, 'deleteTexture', function (args) {
      const m = ctx(this).texSize.get(args[0]);
      if (!m) return;
      for (const v of m.values()) add(ctx(this), 'tex', -v);
      ctx(this).texSize.delete(args[0]);
    });
    wrapFast(p, 'bindRenderbuffer', function (target, rb) {
      ctx(this).rb = rb;
    });
    const rbStore = function (gl, samples, ifmt, w, h) {
      const s = ctx(gl);
      if (!s.rb) return;
      const b = w * h * bpp(ifmt) * Math.max(1, samples);
      add(s, 'rb', b - (s.rbSize.get(s.rb) || 0));
      s.rbSize.set(s.rb, b);
    };
    wrap(p, 'renderbufferStorage', function (args) {
      rbStore(this, 1, args[1], args[2], args[3]);
    });
    wrap(p, 'renderbufferStorageMultisample', function (args) {
      rbStore(this, args[1], args[2], args[3], args[4]);
    });
    wrap(p, 'deleteRenderbuffer', function (args) {
      const s = ctx(this);
      add(s, 'rb', -(s.rbSize.get(args[0]) || 0));
      s.rbSize.delete(args[0]);
    });
    wrapFast(p, 'bindBuffer', function (target, buf) {
      ctx(this).buf.set(target, buf);
    });
    wrap(p, 'bufferData', function (args) {
      const s = ctx(this);
      const b = s.buf.get(args[0]);
      if (!b) return;
      const size = typeof args[1] === 'number' ? args[1] : args[1] && args[1].byteLength ? args[1].byteLength : 0;
      add(s, 'buf', size - (s.bufSize.get(b) || 0));
      s.bufSize.set(b, size);
    });
    wrap(p, 'deleteBuffer', function (args) {
      const s = ctx(this);
      add(s, 'buf', -(s.bufSize.get(args[0]) || 0));
      s.bufSize.delete(args[0]);
    });
  }
  // Every WebGL context the page creates, with its attributes; canvases are held weakly (never kept alive by this).
  const known = new WeakSet();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const c = getContext.call(this, type, attrs);
    if (c && /webgl/.test(String(type)) && !known.has(c))
      safe(() => {
        known.add(c);
        const rec = { t: now(), type, ref: new WeakRef(this), attrs: c.getContextAttributes && c.getContextAttributes(), lost: false, w: this.width, h: this.height };
        G.contexts.push(rec);
        this.addEventListener('webglcontextlost', () => {
          rec.lost = true;
          release(c);
        });
        this.addEventListener('webglcontextrestored', () => (rec.lost = false));
      });
    return c;
  };
  P.glSnapshot = () => ({
    tex: G.tex,
    texPeak: G.texPeak,
    rb: G.rb,
    rbPeak: G.rbPeak,
    buf: G.buf,
    bufPeak: G.bufPeak,
    programs: G.programs,
    links: G.links.length,
    contexts: G.contexts.map((c) => ({
      t: Math.round(c.t),
      type: c.type,
      live: Boolean(c.ref.deref() && c.ref.deref().isConnected) && !c.lost,
      lost: c.lost,
      collected: !c.ref.deref(),
      w: c.ref.deref() ? c.ref.deref().width : c.w,
      h: c.ref.deref() ? c.ref.deref().height : c.h,
      antialias: Boolean(c.attrs && c.attrs.antialias),
      depth: Boolean(c.attrs && c.attrs.depth),
      stencil: Boolean(c.attrs && c.attrs.stencil),
    })),
  });
})();
