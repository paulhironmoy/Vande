/*
 * Evaluation probe, stage half (installed with context.addInitScript; never shipped). window.__eval gains:
 *   flow(), stage()   the Practice controller and its stage, found through React's fiber (read-only use)
 *   regions()         the protected regions on screen now: ball, bowler, pitch, hitting area (CSS px)
 *   track(opts)       samples every animation frame of the next delivery: regions, UI boxes, running animations
 *   flightHash()      a hash of the current/last delivery's flight (release, bounce, every sample)
 *   sceneAudit()      sizes of the cricket objects in the 3D scene (stumps, pitch, ball, players' heights)
 * World frame (src/render3d/core/ground.ts): z along the pitch, striker's stumps at +10.06, +x the off side.
 */
(() => {
  if (window.__eval && window.__eval.stageProbe) return;
  const E = (window.__eval = window.__eval || {});
  E.stageProbe = true;
  const HALF = 10.06; // half the 20.12 m between the stumps (Law 6)
  const PITCH_W = 3.05; // Law 6: 3.05 m wide
  const BALL_R = 0.036;

  const fiberOf = (el) => {
    const k = el && Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  };
  E.flow = () => {
    const starts = [document.querySelector('[data-testid="practice-canvas"]'), document.querySelector('[data-testid="practice-play"]'), ...document.querySelectorAll('canvas'), ...document.querySelectorAll('[data-testid]')];
    for (const el of starts) {
      let f = fiberOf(el);
      for (let i = 0; f && i < 80; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && p.flow && typeof p.flow === 'object' && typeof p.flow.getState === 'function') return p.flow;
      }
    }
    return null;
  };
  E.stage = () => {
    const flow = E.flow();
    if (!flow) return null;
    const ok = (v) => v && typeof v === 'object' && (v.kind === '3d' || v.kind === '2d') && typeof v.bowl === 'function';
    if (ok(flow.stage)) return flow.stage;
    // Breadth-first through the controller's own objects (the rebuilt flow keeps the stage in a stage host).
    const seen = new Set();
    let level = [flow];
    for (let depth = 0; depth < 3 && level.length; depth++) {
      const next = [];
      for (const o of level) {
        if (!o || typeof o !== 'object' || seen.has(o) || o instanceof Node) continue;
        seen.add(o);
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (ok(v)) return v;
          if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node) && !(v instanceof Map) && !(v instanceof Set)) next.push(v);
        }
      }
      level = next;
    }
    return null;
  };
  const three = (stage) => {
    if (!stage || stage.kind !== '3d') return null;
    const okS = (v) => v && typeof v === 'object' && v.camera && v.camera.isPerspectiveCamera && v.scene;
    if (okS(stage.stage)) return stage.stage;
    for (const k of Object.keys(stage)) if (okS(stage[k])) return stage[k];
    return null;
  };
  const painter = (stage) => {
    if (!stage || stage.kind !== '2d') return null;
    if (stage.eye && typeof stage.eye.project === 'function') return stage.eye;
    for (const k of Object.keys(stage)) if (stage[k] && typeof stage[k].project === 'function' && 'focal' in stage[k]) return stage[k];
    return null;
  };
  const canvasRect = () => (document.querySelector('[data-testid="practice-canvas"]') || document.querySelector('canvas'))?.getBoundingClientRect() || null;

  /** A projector for this frame: world point → { x, y } CSS px in the viewport (null behind the eye). */
  E.projector = () => {
    const stage = E.stage();
    const rect = canvasRect();
    if (!stage || !rect) return null;
    const s3 = three(stage);
    if (s3) {
      const cam = s3.camera;
      const v = cam.position.clone();
      const near = cam.near || 0.1;
      return {
        kind: '3d',
        rect,
        at(p) {
          v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
          if (v.z > -near) return null;
          v.set(p.x, p.y, p.z).project(cam);
          return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
        },
      };
    }
    const eye = painter(stage);
    if (eye)
      return {
        kind: '2d',
        rect,
        at(p) {
          const q = eye.project(p);
          return q ? { x: rect.left + q.x, y: rect.top + q.y } : null;
        },
      };
    return null;
  };

  const live = (stage) => stage && (stage.live || Object.values(stage).find((v) => v && typeof v === 'object' && v.flight && v.tb && v.script)) || null;
  E.flight = () => {
    const st = E.stage();
    const l = live(st);
    if (l && l.flight) return l.flight;
    const rep = st && (st.rep || null);
    return rep && rep.script && rep.script.practice ? rep.script.practice.flight : (st && st.__evalLastFlight) || null;
  };

  const ballAt = (samples, t) => {
    if (!samples || !samples.length || t < samples[0].t) return null;
    let lo = 0;
    let hi = samples.length - 1;
    if (t >= samples[hi].t) return null;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (samples[m].t <= t) lo = m;
      else hi = m;
    }
    const a = samples[lo];
    const b = samples[hi];
    const u = (t - a.t) / (b.t - a.t || 1);
    return { x: a.p.x + (b.p.x - a.p.x) * u, y: a.p.y + (b.p.y - a.p.y) * u, z: a.p.z + (b.p.z - a.p.z) * u };
  };

  const bbox = (pts) => {
    const ok = pts.filter(Boolean);
    if (!ok.length) return null;
    const xs = ok.map((p) => p.x);
    const ys = ok.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const clipRect = (b, r) => {
    if (!b) return null;
    const x0 = Math.max(b.x, r.left);
    const y0 = Math.max(b.y, r.top);
    const x1 = Math.min(b.x + b.w, r.right);
    const y1 = Math.min(b.y + b.h, r.bottom);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };

  /** Bowler: the rig's bones in 3D (padded by 0.15 m at its depth); a body envelope round the release in 2D. */
  const bowlerBox = (P, stage, flight) => {
    const s3 = three(stage);
    if (s3 && s3.rigs && typeof s3.rigs.get === 'function') {
      const key = [...s3.rigs.keys()].find((k) => k === 'bowler') || [...s3.rigs.keys()].find((k) => /bowl/i.test(k));
      const rig = key && s3.rigs.get(key);
      if (rig && rig.bones && rig.root && rig.root.visible !== false) {
        const pts = [];
        for (const b of rig.bones) {
          const e = b.matrixWorld.elements;
          for (const [dx, dy] of [[0.15, 0.15], [-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15]]) pts.push(P.at({ x: e[12] + dx, y: e[13] + dy, z: e[14] }));
        }
        const b = bbox(pts);
        if (b) return { ...b, source: 'bones' };
      }
    }
    const rel = flight?.release?.p;
    if (!rel) return null;
    const pts = [];
    for (const z of [rel.z - 6, rel.z - 3, rel.z, rel.z + 1.5])
      for (const x of [rel.x - 0.9, rel.x + 0.5]) for (const y of [0, rel.y + 0.3]) pts.push(P.at({ x, y, z }));
    const b = bbox(pts);
    return b ? { ...b, source: 'envelope' } : null;
  };

  /** The pitch (Law 6, 20.12 m × 3.05 m) as a polygon, cut where it passes behind the eye. */
  const pitchPoly = (P) => {
    const left = [];
    const right = [];
    for (let z = -HALF; z <= HALF + 1e-6; z += 0.25) {
      left.push(P.at({ x: -PITCH_W / 2, y: 0, z }));
      right.push(P.at({ x: PITCH_W / 2, y: 0, z }));
    }
    const poly = [...left.filter(Boolean), ...right.filter(Boolean).reverse()];
    return poly.length >= 3 ? poly : null;
  };

  /** The batter's hitting area: 0.9–3.0 m in front of the stumps, ±0.9 m of middle, up to 1.4 m (CSS px box). */
  const hittingBox = (P) => {
    const pts = [];
    for (const z of [HALF - 3.0, HALF - 2.0, HALF - 1.4, HALF - 0.9]) for (const x of [-0.9, 0, 0.9]) for (const y of [0, 0.7, 1.4]) pts.push(P.at({ x, y, z }));
    return bbox(pts);
  };

  E.regions = () => {
    const stage = E.stage();
    const P = E.projector();
    if (!stage || !P) return null;
    const flight = E.flight();
    const t = typeof stage.perfToSim === 'function' && live(stage) ? stage.perfToSim(performance.now()) : null;
    const ballW = t !== null && flight ? ballAt(flight.samples, t) : null;
    let ball = null;
    if (ballW) {
      const c = P.at(ballW);
      const e = P.at({ x: ballW.x + BALL_R * 1.22, y: ballW.y, z: ballW.z });
      const e2 = P.at({ x: ballW.x, y: ballW.y + BALL_R * 1.22, z: ballW.z });
      if (c) ball = { x: c.x, y: c.y, r: Math.max(e ? Math.hypot(e.x - c.x, e.y - c.y) : 0, e2 ? Math.hypot(e2.x - c.x, e2.y - c.y) : 0), t, depth: Math.hypot(ballW.x, ballW.z - (HALF - 1.2)) };
    }
    const r = P.rect;
    return {
      stage: stage.kind,
      canvas: { x: r.left, y: r.top, w: r.width, h: r.height },
      t,
      ball,
      bowler: clipRect(bowlerBox(P, stage, flight), r),
      pitch: pitchPoly(P),
      hitting: clipRect(hittingBox(P), r),
    };
  };

  /** Every frame from now until `untilPhase` (or timeout): regions, UI boxes, running animations, the phase. */
  E.track = ({ timeoutMs = 20000, rootSel = '[data-testid="practice-play"]', stopPhases = ['playing', 'coaching', 'warmup_explain', 'paused', 'idle', 'dead', 'replay'] } = {}) =>
    new Promise((resolve) => {
      const frames = [];
      const t0 = performance.now();
      let sawLive = false;
      const phaseOf = () => document.querySelector('[data-testid="practice-play"]')?.getAttribute('data-phase') || null;
      const tick = () => {
        const phase = phaseOf();
        const fl = E.flow();
        const st = fl && fl.getState ? fl.getState() : null;
        const ph = (st && st.phase) || phase;
        if (ph === 'live') sawLive = true;
        if (ph === 'runup' || ph === 'live') {
          const reg = E.regions();
          const modal = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]'))
            .filter((m) => m.getBoundingClientRect().width > 0 && E.opacity(m) > 0.05 && !m.closest('[data-testid="launch-choice"]'))
            .map((m) => m.getAttribute('data-testid') || m.getAttribute('aria-label') || m.tagName);
          frames.push({ ms: Math.round(performance.now() - t0), phase: ph, reg, ui: E.uiBoxes(rootSel), anim: E.animations(), modal });
        }
        if ((sawLive && stopPhases.includes(ph)) || performance.now() - t0 > timeoutMs) {
          const f = E.flight();
          resolve({ frames, flight: f ? { idealContactT: f.idealContactT, stumpsT: f.stumpsT, bounce: f.bounce, speedKph: f.release?.speedKph } : null, viewport: { w: innerWidth, h: innerHeight } });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  /**
   * A timeline of the controller's state (FAIR4, FAIR5): every change of phase, the shown score (board and the score
   * text on screen) and the quality/assistance in force, with performance timestamps.
   */
  E.timeline = (on = true) => {
    if (!on) return E.__timeline || [];
    if (E.__timelineOff) return 'already';
    const log = (E.__timeline = []);
    let prev = '';
    const tick = () => {
      const f = E.flow();
      const st = f && f.getState ? f.getState() : null;
      if (st) {
        const scoreText = document.querySelector('[data-testid="practice-score"]')?.textContent?.trim() ?? null;
        const q = st.quality ? `${st.quality.stage}/${st.quality.profile}/${st.quality.tier}/${st.quality.toleranceMs ?? ''}` : null;
        const key = `${st.screen}|${st.phase}|${st.board?.runs}|${st.board?.wickets}|${scoreText}|${q}|${st.innings?.assist ?? ''}`;
        if (key !== prev) {
          prev = key;
          log.push({ t: Math.round(performance.now()), screen: st.screen, phase: st.phase, runs: st.board?.runs ?? null, wickets: st.board?.wickets ?? null, scoreText, quality: q, assist: st.innings?.assist ?? null, recorded: st.innings?.runs ?? null, family: st.ball?.bowler?.family ?? null });
        }
      }
      E.__timelineRaf = requestAnimationFrame(tick);
    };
    E.__timelineOff = () => cancelAnimationFrame(E.__timelineRaf);
    tick();
    return 'on';
  };

  const hashStr = (s) => {
    let h1 = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    return h1.toString(16).padStart(8, '0');
  };
  E.flightHash = (f = E.flight()) => {
    if (!f) return null;
    const r = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
    const pts = f.samples.map((s) => [r(s.t), r(s.p.x), r(s.p.y), r(s.p.z)].join(',')).join(';');
    return { hash: hashStr(JSON.stringify([f.seed, f.plan, f.release, f.bounce, f.idealContactT, f.stumpsT, f.wouldHitStumps]) + pts), seed: f.seed, samples: f.samples.length, speedKph: f.release?.speedKph, bounce: f.bounce, idealContactT: f.idealContactT };
  };

  /** Measured sizes of cricket objects in the 3D scene (metres), from their geometry and world matrices. */
  E.sceneAudit = () => {
    const s3 = three(E.stage());
    if (!s3) return null;
    const out = { meshes: 0, triangles: 0, materials: new Set(), textures: new Set(), named: {}, rigs: {} };
    s3.scene.traverse((o) => {
      if (!o.isMesh) return;
      out.meshes++;
      const g = o.geometry;
      if (g) out.triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        out.materials.add(m.uuid);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap']) if (m[k]) out.textures.add(m[k].uuid + ':' + (m[k].image?.width || 0) + 'x' + (m[k].image?.height || 0));
      }
      if (g && g.type && /Sphere/.test(g.type) && g.parameters) (out.named.spheres ||= []).push({ r: g.parameters.radius, name: o.name || null });
      if (g && g.type && /Cylinder/.test(g.type) && g.parameters) (out.named.cylinders ||= []).push({ rt: g.parameters.radiusTop, h: g.parameters.height, name: o.name || null, y: Math.round(o.getWorldPosition(o.position.clone()).y * 1000) / 1000 });
    });
    if (s3.rigs && typeof s3.rigs.forEach === 'function')
      s3.rigs.forEach((rig, id) => {
        if (!rig.bones) return;
        const ys = rig.bones.map((b) => b.matrixWorld.elements[13]);
        out.rigs[id] = { bones: rig.bones.length, scale: rig.scale ?? rig.root?.scale?.x ?? null, minY: Math.min(...ys), maxY: Math.max(...ys) };
      });
    return { ...out, materials: out.materials.size, textures: [...out.textures], spheres: (out.named.spheres || []).slice(0, 30), cylinders: (out.named.cylinders || []).slice(0, 40) };
  };
})();
