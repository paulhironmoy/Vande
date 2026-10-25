import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { GLYPHS, Pictogram } from '@/components/game/pictograms';
import { VISUAL_IDS, VISUAL_VOCABULARY } from '@/content/lite/visualVocabulary';

afterEach(cleanup);

describe('Pictograms', () => {
  it('have exactly one component for every vocabulary id, and an id for every component', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual([...VISUAL_IDS].sort());
    for (const id of VISUAL_IDS) expect(typeof GLYPHS[id]).toBe('function');
  });

  it('render every glyph in every role it allows: decorative, hidden from assistive tech and free of text', () => {
    const roleOf = (role: 'actor' | 'action' | 'object') => VISUAL_VOCABULARY.filter((g) => g.roles.includes(role)).map((g) => g.id);
    const actors = roleOf('actor');
    const actions = roleOf('action');
    const objects = roleOf('object');
    const combos = [
      ...actors.map((a, i) => ({ actor: a, action: actions[i % actions.length], object: objects[i % objects.length] })),
      ...actions.map((a, i) => ({ actor: actors[i % actors.length], action: a, object: objects[(i + 1) % objects.length] })),
      ...objects.map((o, i) => ({ actor: actors[(i + 2) % actors.length], action: actions[(i + 3) % actions.length], object: o })),
    ];
    for (const visual of combos) {
      for (const size of ['card', 'mini'] as const) {
        const { container, unmount } = render(<Pictogram visual={visual} size={size} />);
        const root = container.firstElementChild as HTMLElement;
        expect(root, JSON.stringify(visual)).not.toBeNull();
        expect(root.getAttribute('aria-hidden')).toBe('true');
        expect(root.getAttribute('data-pictogram')).toBe(`${visual.actor}.${visual.action}.${visual.object}`);
        const svg = root.querySelector('svg')!;
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('focusable')).toBe('false');
        expect(root.textContent).toBe('');
        expect(root.querySelectorAll('text, title, desc, foreignObject')).toHaveLength(0);
        expect(root.querySelectorAll('path, circle, rect').length).toBeGreaterThan(5);
        unmount();
      }
    }
  });

  it('never paints a meaning colour: shapes use currentColor or the shared tint classes, never literal colours', () => {
    const { container } = render(<Pictogram visual={{ actor: 'police', action: 'lock', object: 'gate' }} />);
    for (const el of container.querySelectorAll('svg *')) {
      for (const attr of ['fill', 'stroke', 'style', 'color', 'stop-color']) expect(el.getAttribute(attr), `${el.tagName} ${attr}`).toBeNull();
    }
  });

  it('renders nothing for an unknown id', () => {
    const { container } = render(<Pictogram visual={{ actor: 'official', action: 'juggle', object: 'bus' }} />);
    expect(container.innerHTML).toBe('');
  });
});
