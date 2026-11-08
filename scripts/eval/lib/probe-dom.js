/*
 * Evaluation probe, DOM half (installed with context.addInitScript; never shipped). window.__eval gains:
 *   controls()     every visible, reachable interactive control with its name, size and visual weight
 *   uiBoxes(root)  the painted UI boxes over the play area (text runs, filled or bordered boxes, images, svg)
 *   textIssues()   truncated, clipped, off-screen or overlapping text
 *   textStats()    font sizes and the number of text blocks and words on screen
 *   animations()   running CSS/Web animations with their targets
 * Read-only: it never changes the page.
 */
(() => {
  if (window.__eval && window.__eval.dom) return;
  const E = (window.__eval = window.__eval || {});
  E.dom = true;

  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  E.contrast = ratio;
  E.parseColor = parse;

  /** Effective opacity along the ancestor chain (0 if any ancestor is hidden). */
  const opacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return 0;
      // Visually hidden (screen-reader-only) content paints nothing: clipped away, or a 1 px box that hides overflow.
      if (cs.clip && cs.clip !== 'auto' && /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip.replace(/\s+/g, ' '))) return 0;
      if (cs.clipPath && /inset\(50%\)|circle\(0/.test(cs.clipPath)) return 0;
      if (cs.position === 'absolute' && cs.overflow === 'hidden') {
        const r = n.getBoundingClientRect();
        if (r.width <= 1.5 && r.height <= 1.5) return 0;
      }
      o *= parseFloat(cs.opacity || '1');
    }
    return o;
  };
  E.opacity = opacity;

  /** The first opaque-ish background behind an element (walking up), or null over a canvas/the page. */
  const behind = (el) => {
    for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  };

  const name = (el) =>
    (
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) ||
      (el.labels && el.labels[0] && el.labels[0].textContent) ||
      el.textContent ||
      el.getAttribute('title') ||
      el.getAttribute('value') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const onScreen = (r) => r.width >= 1 && r.height >= 1 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;

  const CONTROL =
    'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=radio], [role=tab], [role=switch], [role=slider], [role=checkbox], [role=menuitem], [role=option], [role=spinbutton]';

  E.controls = () => {
    const out = [];
    for (const el of document.querySelectorAll(CONTROL)) {
      const r = el.getBoundingClientRect();
      if (!onScreen(r)) continue;
      if (el.closest('[inert]')) continue;
      const op = opacity(el);
      if (op < 0.05) continue;
      // A control inside another counted control (a radio inside a labelled button) counts once.
      const parentControl = el.parentElement && el.parentElement.closest(CONTROL);
      if (parentControl && parentControl !== el) continue;
      const pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + Math.min(6, r.width / 2), r.top + Math.min(6, r.height / 2)],
        [r.right - Math.min(6, r.width / 2), r.bottom - Math.min(6, r.height / 2)],
      ];
      const reachable = pts.some(([x, y]) => {
        const h = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, x)), Math.max(0, Math.min(innerHeight - 1, y)));
        return h && (h === el || el.contains(h) || h.contains(el));
      });
      const cs = getComputedStyle(el);
      const bg = parse(cs.backgroundColor);
      const under = behind(el);
      const filled = bg && bg.a > 0.35 ? ratio(bg, under) : 1;
      const border = parseFloat(cs.borderTopWidth) > 0 && parse(cs.borderTopColor)?.a > 0.3 ? ratio(parse(cs.borderTopColor), under) : 1;
      const area = r.width * r.height;
      // Visual weight: size times how strongly the control stands off its surroundings (fill, then outline).
      const weight = Math.round(area * Math.max(filled - 1, (border - 1) * 0.35, 0.05) * op);
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        testid: el.getAttribute('data-testid') || null,
        name: name(el),
        disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
        reachable,
        rect: box(r),
        fill: Math.round(filled * 100) / 100,
        weight,
        fontSize: parseFloat(cs.fontSize),
        target44: r.width >= 44 && r.height >= 44,
        target48: r.width >= 48 && r.height >= 48,
      });
    }
    // Rank by weight: the top one is the dominant action; "competing" ones carry at least 60% of its weight.
    const ranked = out.filter((c) => c.reachable && !c.disabled).sort((a, b) => b.weight - a.weight);
    const top = ranked[0]?.weight || 0;
    for (const c of out) c.competing = top > 0 && c !== ranked[0] && c.reachable && !c.disabled && c.weight >= 0.6 * top;
    return out;
  };

  /** Painted UI boxes inside `root` (default: the play screen or the body), excluding the stage canvas. */
  E.uiBoxes = (rootSel) => {
    const root = (rootSel && document.querySelector(rootSel)) || document.querySelector('[data-testid="practice-play"]') || document.body;
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el || el.closest('canvas, [aria-hidden="true"] canvas')) continue;
        const op = opacity(el);
        if (op < 0.05) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (onScreen(r)) out.push({ kind: 'text', testid: el.closest('[data-testid]')?.getAttribute('data-testid') || null, op: Math.round(op * 100) / 100, ...box(r) });
        continue;
      }
      const el = n;
      if (el.tagName === 'CANVAS') continue;
      const r = el.getBoundingClientRect();
      if (!onScreen(r)) continue;
      const cs = getComputedStyle(el);
      const bg = parse(cs.backgroundColor);
      const painted =
        (bg && bg.a > 0.04) ||
        cs.backgroundImage !== 'none' ||
        (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth) > 0 && (parse(cs.borderTopColor)?.a || 0) > 0.1) ||
        cs.boxShadow !== 'none' ||
        (cs.backdropFilter && cs.backdropFilter !== 'none') ||
        el.tagName === 'IMG' ||
        el.tagName === 'svg' ||
        el.tagName === 'VIDEO';
      if (!painted) continue;
      const op = opacity(el);
      if (op < 0.05) continue;
      out.push({ kind: el.tagName === 'svg' || el.tagName === 'IMG' ? 'graphic' : 'box', testid: el.closest('[data-testid]')?.getAttribute('data-testid') || null, op: Math.round(op * 100) / 100, ...box(r) });
    }
    return out;
  };

  const directText = (el) => Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim());
  const scrollable = (el) => {
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) return n;
    }
    const d = document.scrollingElement;
    return d && d.scrollHeight > innerHeight + 1 ? d : null;
  };

  E.textIssues = () => {
    const issues = [];
    const runs = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!directText(el) || el.closest('script, style, noscript')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (opacity(el) < 0.05 || el.closest('[aria-hidden="true"]')) continue;
      const cs = getComputedStyle(el);
      const id = el.closest('[data-testid]')?.getAttribute('data-testid') || null;
      const text = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
      const add = (type) => issues.push({ type, testid: id, text, rect: box(r) });
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) add('ellipsis');
      else if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !/(auto|scroll)/.test(cs.overflowX)) add('clipped-x');
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) add('line-clamp');
      else if (cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 1) add('clipped-y');
      const sc = scrollable(el);
      if (r.right > innerWidth + 1 || r.left < -1) add('offscreen-x');
      if ((r.bottom > innerHeight + 1 || r.top < -1) && !sc) add('offscreen-y');
      // Clipped by an ancestor that hides overflow (and does not scroll).
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
        if (/(auto|scroll)/.test(acs.overflowX + acs.overflowY)) break;
        const ar = a.getBoundingClientRect();
        if (r.left < ar.left - 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.bottom > ar.bottom + 1) add('ancestor-clip');
        break;
      }
      const range = document.createRange();
      for (const c of el.childNodes) {
        if (c.nodeType !== 3 || !c.textContent.trim()) continue;
        range.selectNodeContents(c);
        for (const rr of range.getClientRects()) if (rr.width > 1) runs.push({ el, r: rr, id, text });
      }
    }
    // Text runs from unrelated elements that overlap (more than 4 px²).
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i];
        const b = runs[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2 && w * h > 4) issues.push({ type: 'overlap', testid: a.id, text: `${a.text} ⟂ ${b.text}`, rect: box(a.r) });
      }
    return issues;
  };

  E.textStats = () => {
    const sizes = [];
    let words = 0;
    let blocks = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!directText(el) || el.closest('script, style, noscript, [aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (!onScreen(r) || opacity(el) < 0.05) continue;
      blocks++;
      const t = Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ').trim();
      words += t.split(/\s+/).filter(Boolean).length;
      sizes.push(parseFloat(getComputedStyle(el).fontSize));
    }
    sizes.sort((a, b) => a - b);
    return { blocks, words, minFontPx: sizes[0] ?? null, medianFontPx: sizes[Math.floor(sizes.length / 2)] ?? null, under12: sizes.filter((s) => s < 12).length, under14: sizes.filter((s) => s < 14).length };
  };

  /**
   * Records every change of the text of elements with these test ids (time, id, text), from now on, so a result
   * layer that shows for a second is never missed. read(since) returns the entries after `since` (performance ms).
   */
  E.recordTexts = (ids) => {
    if (E.__textLog) return 'already';
    const log = (E.__textLog = []);
    const last = new Map();
    const scan = () => {
      for (const id of ids)
        for (const el of document.querySelectorAll(`[data-testid="${id}"]`)) {
          const r = el.getBoundingClientRect();
          const text = r.width > 0 && opacity(el) > 0.05 ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
          if (last.get(id) !== text) {
            last.set(id, text);
            if (text) log.push({ t: performance.now(), id, text: text.slice(0, 400) });
          }
        }
    };
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    return 'on';
  };
  E.readTexts = (since = 0) => (E.__textLog || []).filter((e) => e.t >= since);

  /** U6 constitution checks: type scale, spacing grid, radii and palette of what is visible now. */
  E.styleStats = () => {
    const sizes = new Map();
    const weights = new Set();
    const spacing = [];
    const radii = new Set();
    const colors = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!onScreen(r) || opacity(el) < 0.05 || el.closest('canvas')) continue;
      const cs = getComputedStyle(el);
      if (directText(el)) {
        const k = Math.round(parseFloat(cs.fontSize) * 2) / 2;
        sizes.set(k, (sizes.get(k) || 0) + 1);
        weights.add(cs.fontWeight);
        colors.add(cs.color);
      }
      for (const prop of ['paddingTop', 'paddingLeft', 'marginTop', 'marginLeft', 'rowGap', 'columnGap']) {
        const v = parseFloat(cs[prop]);
        if (v > 0.5) spacing.push(v);
      }
      const rad = parseFloat(cs.borderTopLeftRadius);
      if (rad > 0.5 && rad < 999) radii.add(Math.round(rad));
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0.1) colors.add(cs.backgroundColor);
    }
    const on8 = spacing.filter((v) => Math.abs(v / 8 - Math.round(v / 8)) < 0.02).length;
    const on4 = spacing.filter((v) => Math.abs(v / 4 - Math.round(v / 4)) < 0.02).length;
    return { typeSizes: [...sizes.entries()].sort((a, b) => a[0] - b[0]), weights: [...weights], spacingValues: spacing.length, on8pt: spacing.length ? Math.round((on8 / spacing.length) * 100) : null, on4pt: spacing.length ? Math.round((on4 / spacing.length) * 100) : null, radii: [...radii].sort((a, b) => a - b), colors: colors.size };
  };

  E.animations = () =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => {
        const t = a.effect && a.effect.target;
        return { name: a.animationName || a.transitionProperty || a.id || 'animation', testid: t && t.closest ? t.closest('[data-testid]')?.getAttribute('data-testid') || null : null, cls: t && typeof t.className === 'string' ? t.className.slice(0, 60) : null };
      });
})();
