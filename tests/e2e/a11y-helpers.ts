/**
 * Accessibility audits for the Practice screens (a11y-practice-*.spec.ts, the `practice` project; docs/PERFORMANCE.md,
 * "Accessibility verification"). Each audit returns plain findings (screen, rule, element, detail) so a journey can
 * collect every screen before failing, and the report names the exact selector for the UX workstream.
 *
 *   axe          WCAG 2.x A/AA rules (serious and critical fail; the rest are reported)
 *   targets      every visible control's hit area is at least 48×48 CSS px, the rubric's 48 dp (A11Y7; the brief's floor
 *                is 44), probed with elementFromPoint so an enlarged invisible hit area counts
 *   truncation   no text clipped by its own box (ellipsis, hidden overflow, line clamps) or by the viewport's edges
 *   safe areas   with landscape insets emulated, no control or text sits inside the notch or navigation bands
 *   colour       status carried by data-tone also has words (text or an accessible name)
 *   motion       with reduced motion, no running CSS animation or transition longer than 0.2 s
 *   contrast     with high contrast, no translucent blurred surface remains
 */
import AxeBuilder from '@axe-core/playwright';
import type { CDPSession, ElementHandle, Locator, Page } from '@playwright/test';

export interface Finding {
  screen: string;
  rule: string;
  target: string;
  detail: string;
}

/** Landscape insets of a notched Android phone held with the camera on the left, with gesture navigation. */
export const INSETS = { top: 0, left: 44, bottom: 20, right: 24 };

const CONTROL_SELECTOR =
  'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=radio], [role=switch], [role=tab], [role=checkbox], [role=slider], [role=menuitem], [role=option], [tabindex]:not([tabindex="-1"])';

export async function emulateInsets(cdp: CDPSession, insets = INSETS): Promise<boolean> {
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets } as never);
    return true;
  } catch {
    return false;
  }
}

export async function axe(page: Page, screen: string): Promise<{ fail: Finding[]; note: Finding[] }> {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const fail: Finding[] = [];
  const note: Finding[] = [];
  for (const v of res.violations) {
    for (const n of v.nodes) {
      const f = {
        screen,
        rule: `axe:${v.id}`,
        target: n.target.join(' '),
        detail: `${v.impact}: ${v.help}${n.failureSummary ? ` (${n.failureSummary.replace(/\s+/g, ' ').slice(0, 160)})` : ''}`,
      };
      (v.impact === 'serious' || v.impact === 'critical' ? fail : note).push(f);
    }
  }
  return { fail, note };
}

interface InspectionOptions {
  insets?: typeof INSETS | null;
  reducedMotion?: boolean;
  highContrast?: boolean;
  /** A scrolled control census uses the same target checks without re-auditing unrelated text. */
  target?: ElementHandle<Element>;
}

/** One in-page pass for targets, truncation, safe areas, colour-only status, motion and translucent surfaces. */
export async function inspect(page: Page, screen: string, opts: InspectionOptions = {}): Promise<Finding[]> {
  const raw = await page.evaluate(
    ({ insets, reduced, contrast, selector, target }) => {
      const out: Array<[string, string, string]> = [];
      const W = innerWidth;
      const H = innerHeight;
      const sel = (el: Element) => {
        const id = el.getAttribute('data-testid');
        if (id) return `[data-testid="${id}"]`;
        const p = el.closest('[data-testid]');
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        return `${p ? `[data-testid="${p.getAttribute('data-testid')}"] ` : ''}${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}${label ? ` "${label}"` : ''}`;
      };
      // Rendered (has a box and nothing hides it), whether or not it is inside the viewport.
      const rendered = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        for (let e: Element | null = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (
            cs.display === 'none' ||
            cs.visibility === 'hidden' ||
            Number(cs.opacity) === 0 ||
            e.getAttribute('aria-hidden') === 'true' ||
            (e as HTMLElement).inert
          )
            return false;
        }
        return true;
      };
      const inView = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.right > 0 && r.top < H && r.left < W;
      };
      const shown = (el: Element) => rendered(el) && inView(el);
      // Screen-reader-only descriptions deliberately retain text in the accessibility
      // tree inside a clipped 1 px box. They are not visually truncated copy. Match
      // the actual hiding geometry, never a class name or arbitrary small element;
      // axe and the control/name checks still inspect their semantics normally.
      const visuallyHiddenText = (el: Element) => {
        for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          const zeroClip = /^rect\(0(?:px)?,\s*0(?:px)?,\s*0(?:px)?,\s*0(?:px)?\)$/.test(cs.clip);
          if (
            /^(absolute|fixed)$/.test(cs.position) &&
            r.width <= 1 &&
            r.height <= 1 &&
            cs.overflowX === 'hidden' &&
            cs.overflowY === 'hidden' &&
            zeroClip
          )
            return true;
        }
        return false;
      };
      // Content inside something that scrolls can be brought out of the inset bands: only fixed layouts are judged there.
      const scrollsIntoView = (el: Element) => {
        for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (
            (/auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) ||
            (/auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1)
          )
            return true;
        }
        const root = document.scrollingElement;
        return Boolean(root && (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1));
      };
      const all = (target ? [target] : Array.from(document.querySelectorAll(selector))).filter(rendered);
      // A rendered control wholly outside the viewport that nothing can scroll into view cannot be reached at all.
      for (const el of all)
        if (!inView(el) && !scrollsIntoView(el))
          out.push(['cut-off', sel(el), 'control wholly outside the view, which does not scroll']);
      const controls = all.filter(inView);
      for (const el of controls) {
        if (el.getAttribute('role') === 'application') continue;
        const r = el.getBoundingClientRect();
        // Inline links inside running text are exempt (WCAG 2.5.8).
        if (
          el.tagName === 'A' &&
          el.parentElement &&
          /^(P|LI|SPAN)$/.test(el.parentElement.tagName) &&
          (el.parentElement.textContent ?? '').length > (el.textContent ?? '').length + 20
        )
          continue;
        if (r.width < 47.5 || r.height < 47.5) {
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const probes: Array<[number, number]> = [
            [cx - 23.5, cy],
            [cx + 23.5, cy],
            [cx, cy - 23.5],
            [cx, cy + 23.5],
          ];
          const ok = probes.every(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            // A button's own pseudo-element or descendant can extend its hit area. An inert ancestor cannot:
            // hitting a wrapper does not dispatch a click to its child control (the former switch false positive).
            return hit !== null && (hit === el || el.contains(hit));
          });
          if (!ok) out.push(['target-size', sel(el), `${r.width.toFixed(0)}×${r.height.toFixed(0)} px`]);
        }
        // A control below or beside the viewport that nothing can scroll into view cannot be reached at all.
        if ((r.bottom > H + 1 || r.right > W + 1) && !scrollsIntoView(el))
          out.push([
            'cut-off',
            sel(el),
            `control at ${r.left.toFixed(0)},${r.top.toFixed(0)}–${r.right.toFixed(0)},${r.bottom.toFixed(0)} outside the ${W}×${H} view, which does not scroll`,
          ]);
        if (insets && !scrollsIntoView(el)) {
          const inBand =
            r.left < insets.left - 0.5 ||
            r.right > W - insets.right + 0.5 ||
            r.top < insets.top - 0.5 ||
            r.bottom > H - insets.bottom + 0.5;
          if (inBand)
            out.push([
              'safe-area',
              sel(el),
              `control at ${r.left.toFixed(0)},${r.top.toFixed(0)}–${r.right.toFixed(0)},${r.bottom.toFixed(0)} in a ${W}×${H} view with insets L${insets.left} R${insets.right} B${insets.bottom}`,
            ]);
        }
      }
      if (target) return out;
      // Text: clipped by its own box, cut by the viewport, or inside the insets.
      const texts = new Set<Element>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        if ((n.textContent ?? '').trim() && n.parentElement) texts.add(n.parentElement);
      for (const el of texts) {
        if (!shown(el) || visuallyHiddenText(el) || el.closest('script,style,[data-testid="practice-diagnostics"]'))
          continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const clipsX = /hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
        const clipsY = /hidden|clip/.test(cs.overflowY) || cs.webkitLineClamp !== 'none';
        if (clipsX && el.scrollWidth > el.clientWidth + 1)
          out.push(['truncation', sel(el), `text ${el.scrollWidth} px wide in a ${el.clientWidth} px box`]);
        if (clipsY && el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll')
          out.push(['truncation', sel(el), `text ${el.scrollHeight} px tall in a ${el.clientHeight} px box`]);
        const range = document.createRange();
        range.selectNodeContents(el);
        const tr = range.getBoundingClientRect();
        if (tr.width > 0 && (tr.right > W + 1 || tr.left < -1))
          out.push([
            'truncation',
            sel(el),
            `text runs past the viewport (${tr.left.toFixed(0)}–${tr.right.toFixed(0)} of ${W})`,
          ]);
        if (
          insets &&
          tr.width > 0 &&
          !scrollsIntoView(el) &&
          (tr.left < insets.left - 0.5 || tr.right > W - insets.right + 0.5 || tr.bottom > H - insets.bottom + 0.5)
        )
          out.push([
            'safe-area',
            sel(el),
            `text at ${tr.left.toFixed(0)}–${tr.right.toFixed(0)} × ${tr.top.toFixed(0)}–${tr.bottom.toFixed(0)}`,
          ]);
        void r;
      }
      for (const el of Array.from(document.querySelectorAll('[data-tone]')).filter(shown)) {
        const words = (el.textContent ?? '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!words) out.push(['colour-only', sel(el), `data-tone="${el.getAttribute('data-tone')}" with no words`]);
      }
      if (reduced)
        for (const a of document.getAnimations()) {
          const t = a.effect?.getTiming();
          const dur = typeof t?.duration === 'number' ? t.duration : 0;
          const target = (a.effect as KeyframeEffect | null)?.target;
          if (a.playState === 'running' && (dur > 200 || t?.iterations === Infinity) && target)
            out.push(['reduced-motion', sel(target), `${a.constructor.name} ${dur} ms × ${t?.iterations}`]);
        }
      if (contrast)
        for (const el of Array.from(document.querySelectorAll('body *')).filter(shown)) {
          const cs = getComputedStyle(el);
          const bf =
            cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || 'none';
          if (bf !== 'none') out.push(['high-contrast', sel(el), `backdrop-filter ${bf}`]);
        }
      return out;
    },
    {
      insets: opts.insets ?? null,
      reduced: Boolean(opts.reducedMotion),
      contrast: Boolean(opts.highContrast),
      selector: CONTROL_SELECTOR,
      target: opts.target ?? null,
    },
  );
  const seen = new Set<string>();
  return raw
    .map(([rule, target, detail]) => ({ screen, rule, target, detail }))
    .filter((f) => {
      const k = `${f.rule}|${f.target}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Inspect every rendered control in a scrollable panel, including controls initially below the fold and disabled
 * controls. Each target is brought to the centre of its scrollport before the same hit-area check is applied.
 * Separately prove that the centre and 48px cross can actually be hit, even for a large DOM box: clipping and overlays
 * must not make a nominally sufficient target unreachable. This does not activate disabled controls.
 * Return the census as well as failures so a caller can assert that the intended settings were actually visited. */
export async function scrollTargetCensus(
  page: Page,
  screen: string,
  root: Locator,
): Promise<{ targets: string[]; fail: Finding[] }> {
  const targets: string[] = [];
  const fail: Finding[] = [];
  for (const control of await root.locator(CONTROL_SELECTOR).all()) {
    if (!(await control.isVisible())) continue;
    const target = await control.elementHandle();
    if (!target) throw new Error(`${screen}: a control disappeared during the target census`);
    try {
      const reached = await target.evaluate((el) => {
        // isVisible includes opacity-zero and inert descendants; exclude these explicitly, as inspect does.
        for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0 ||
            ancestor.getAttribute('aria-hidden') === 'true' ||
            (ancestor as HTMLElement).inert
          )
            return null;
        }
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const id =
          el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const points = [
          [cx, cy],
          [cx - 23.5, cy],
          [cx + 23.5, cy],
          [cx, cy - 23.5],
          [cx, cy + 23.5],
        ];
        const missed = points.filter(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !hit || (hit !== el && !el.contains(hit));
        });
        return { id, missed: missed.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`) };
      });
      if (!reached) continue;
      targets.push(reached.id);
      if (reached.missed.length)
        fail.push({
          screen,
          rule: 'target-reach',
          target: reached.id,
          detail: `after scrolling, centre/48px target probes are clipped or intercepted at ${reached.missed.join('; ')}`,
        });
      fail.push(...(await inspect(page, screen, { target })));
    } finally {
      await target.dispose();
    }
  }
  return { targets, fail };
}

/** App and Practice settings before the page loads (text scale, contrast, motion, locale, captions). */
export async function settings(page: Page, app: Record<string, unknown>, practice: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([a, p]) => {
      if (sessionStorage.getItem('a11y-seeded')) return;
      sessionStorage.setItem('a11y-seeded', '1');
      localStorage.setItem(
        'vc:settings',
        JSON.stringify({
          locale: 'en',
          reducedMotion: 'off',
          sound: true,
          haptics: true,
          quality: 'auto',
          textScale: 1,
          highContrast: false,
          ...a,
        }),
      );
      localStorage.setItem('vc:practice:settings', JSON.stringify({ v: 1, teach: false, demoSeen: true, ...p }));
    },
    [app, practice] as const,
  );
}

export const describeFindings = (fs: Finding[]) =>
  fs.map((f) => `${f.screen} · ${f.rule} · ${f.target} · ${f.detail}`).join('\n');

/** 200% text (A11Y1): the app's own root scale (html font-size is 16px × --text-scale) at 2, past the settings' 1.3. */
export async function doubleText(page: Page) {
  await page.addStyleTag({ content: ':root { --text-scale: 2 !important; }' });
}

/**
 * Keyboard (A11Y2): Tab through the screen; every visible control must take focus, in document order (no positive
 * tabindex), with a visible focus indicator.
 */
export async function keyboard(page: Page, screen: string, maxTabs = 40): Promise<Finding[]> {
  const out: Finding[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const order: string[] = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      const id =
        el.getAttribute('data-testid') ??
        `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
      return { id, ring: Boolean(ring), positive: el.tabIndex > 0 };
    });
    if (!f) continue;
    if (order.includes(f.id)) break;
    order.push(f.id);
    if (!f.ring) out.push({ screen, rule: 'focus-visible', target: f.id, detail: 'no visible focus indicator' });
    if (f.positive) out.push({ screen, rule: 'focus-order', target: f.id, detail: 'positive tabindex' });
  }
  const controls = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=radio], [role=switch], [role=tab], [role=checkbox], [role=slider]',
      ),
    )
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          cs.visibility !== 'hidden' &&
          !(el as HTMLButtonElement).disabled &&
          !el.closest('[inert],[aria-hidden="true"]')
        );
      })
      .map(
        (el) =>
          el.getAttribute('data-testid') ??
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`,
      ),
  );
  // Radio groups take one Tab stop; their other options are reached with the arrow keys.
  const radios = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role=radio]')).map((el) => el.getAttribute('data-testid') ?? ''),
  );
  for (const c of controls)
    if (!order.includes(c) && !radios.includes(c))
      out.push({ screen, rule: 'keyboard-reach', target: c, detail: `never focused in ${order.length} Tab stops` });
  return out;
}
