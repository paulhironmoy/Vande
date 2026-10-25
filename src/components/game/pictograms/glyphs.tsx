/**
 * Pictogram glyphs, one component per vocabulary id (src/content/lite/visualVocabulary.ts).
 *
 * People, places and things are drawn on a 64-unit grid (content inside x 6–58, standing on y 60). Actions are
 * drawn on a 24-unit grid and shown inside the round action badge. One style throughout: rounded strokes in
 * currentColor, one shared neutral accent tint, solid "surface" fills only to hide what is behind. Heads have no
 * faces, nothing is coloured by meaning, and nothing shows equipment, injury or force.
 */
import type { ReactElement } from 'react';
import s from './Pictogram.module.css';

type Glyph = () => ReactElement;

/** Head and shoulders shared by single-person glyphs. */
const TORSO = 'M14 60v-6.5c0-9.4 8.1-17.5 18-17.5s18 8.1 18 17.5V60';
function Person({ headY = 19 }: { headY?: number }) {
  return (
    <>
      <path className={s.accent} d={TORSO} />
      <path d={TORSO} />
      <circle className={s.occlude} cx="32" cy={headY} r="8" />
      <circle cx="32" cy={headY} r="8" />
    </>
  );
}

const official: Glyph = () => (
  <g>
    <Person />
    <path d="M26.5 37.6 32 46l5.5-8.4" />
    <rect className={s.occlude} x="28.4" y="45.6" width="7.2" height="8.8" rx="1.6" />
    <rect x="28.4" y="45.6" width="7.2" height="8.8" rx="1.6" />
  </g>
);

const police: Glyph = () => (
  <g>
    <Person headY={21} />
    <path className={s.solid} d="M20.4 11.6c-.4-3.3 5-5.6 11.6-5.6s12 2.3 11.6 5.6c-.2 1.4-2.2 2.4-5 2.9H25.4c-2.8-.5-4.8-1.5-5-2.9z" />
    <rect className={s.solid} x="24.2" y="13.2" width="15.6" height="3" rx="1" />
    <path d="M25 16.9c2.1 1 4.4 1.5 7 1.5s4.9-.5 7-1.5" />
    <path className={s.occlude} d="M32 44.2l5 1.8v3.7c0 3.1-2.2 5.2-5 6.2-2.8-1-5-3.1-5-6.2V46z" />
    <path d="M32 44.2l5 1.8v3.7c0 3.1-2.2 5.2-5 6.2-2.8-1-5-3.1-5-6.2V46z" />
  </g>
);

const students: Glyph = () => (
  <g>
    {[15.5, 48.5].map((x) => (
      <g key={x}>
        <path className={s.accent} d={`M${x - 11.5} 60v-5.5c0-6.9 5.1-12 11.5-12s11.5 5.1 11.5 12V60z`} />
        <circle className={s.occlude} cx={x} cy="24" r="5.6" />
        <circle cx={x} cy="24" r="5.6" />
      </g>
    ))}
    {/* Back shoulders: the inner sides stop above the ground so their round caps stay hidden behind the front student. */}
    <path d="M4 60v-5.5c0-6.9 5.1-12 11.5-12s11.5 5.1 11.5 12V58M37 58v-3.5c0-6.9 5.1-12 11.5-12s11.5 5.1 11.5 12V60" />
    <path className={s.occlude} d="M17 60v-6.2c0-8.3 6.7-15 15-15s15 6.7 15 15V60z" />
    <path className={s.accent} d="M17 60v-6.2c0-8.3 6.7-15 15-15s15 6.7 15 15V60z" />
    <path d="M17 60v-6.2c0-8.3 6.7-15 15-15s15 6.7 15 15V60" />
    <circle className={s.occlude} cx="32" cy="27" r="7.2" />
    <circle cx="32" cy="27" r="7.2" />
  </g>
);

const office: Glyph = () => (
  <g>
    <path className={s.accent} d="M8.5 25.5 32 11.5l23.5 14z" />
    <path d="M8.5 25.5 32 11.5l23.5 14z" />
    <circle cx="32" cy="20" r="2.4" />
    <path d="M11 29.5h42M17 29.5V52M27 29.5V52M37 29.5V52M47 29.5V52M10 52h44M7 57h50" />
  </g>
);

const gate: Glyph = () => (
  <g>
    {[8, 49].map((x) => (
      <g key={x}>
        <rect className={s.accent} x={x} y="21" width="7" height="39" rx="1.6" />
        <rect x={x} y="21" width="7" height="39" rx="1.6" />
        <circle cx={x + 3.5} cy="16.4" r="2.3" />
      </g>
    ))}
    <path d="M15 27q17-12 34 0M15 42h34M23.2 22.8V60M32 21.2V60M40.8 22.8V60" />
  </g>
);

const bus: Glyph = () => (
  <g>
    <rect className={s.accent} x="5" y="22" width="54" height="32" rx="6.5" />
    <rect x="5" y="22" width="54" height="32" rx="6.5" />
    {[10, 23.5, 37].map((x) => (
      <rect key={x} className={s.occlude} x={x} y="27" width="10.5" height="9" rx="1.8" />
    ))}
    {[10, 23.5, 37].map((x) => (
      <rect key={`o${x}`} x={x} y="27" width="10.5" height="9" rx="1.8" />
    ))}
    <path d="M51 27h3.2a1.8 1.8 0 0 1 1.8 1.8V49M5 43h46" />
    {[17, 46].map((x) => (
      <g key={x}>
        <circle className={s.occlude} cx={x} cy="54.5" r="5.6" />
        <circle cx={x} cy="54.5" r="5.6" />
        <circle cx={x} cy="54.5" r="1.4" />
      </g>
    ))}
  </g>
);

const road: Glyph = () => (
  <g>
    <path className={s.accent} d="M16 60 28.4 14h7.2L48 60z" />
    <path d="M16 60 28.4 14M48 60 35.6 14M32 56.5v-6.5M32 44v-5.2M32 33.4v-4.2M32 24.8v-3.2M32 18v-2" />
  </g>
);

// ---------------------------------------------------------------- actions (24-unit grid)

const meet: Glyph = () => (
  <g>
    <path className={s.accent} d="M16 9h4.6a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2H20v2.6l-3.3-2.6H12a2 2 0 0 1-2-2v-.8z" />
    <path d="M16 9h4.6a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2H20v2.6l-3.3-2.6H12a2 2 0 0 1-2-2v-.8" />
    <path className={s.occlude} d="M3.4 4.5h9.6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.4L5 16.2v-2.7H3.4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z" />
    <path d="M3.4 4.5h9.6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.4L5 16.2v-2.7H3.4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z" />
  </g>
);

const announce: Glyph = () => (
  <g>
    <path className={s.accent} d="M3.5 10v4c0 .6.4 1 1 1H7l6.3 4.3V4.7L7 9H4.5c-.6 0-1 .4-1 1z" />
    <path d="M3.5 10v4c0 .6.4 1 1 1H7l6.3 4.3V4.7L7 9H4.5c-.6 0-1 .4-1 1zM7.6 15.2l1 4.3M16.4 9.4a3.6 3.6 0 0 1 0 5.2M19 6.8a7.3 7.3 0 0 1 0 10.4" />
  </g>
);

const lock: Glyph = () => (
  <g>
    <path d="M8 11.2V8.4a4 4 0 0 1 8 0v2.8" />
    <rect className={s.accent} x="5.2" y="11.2" width="13.6" height="9.6" rx="2.3" />
    <rect x="5.2" y="11.2" width="13.6" height="9.6" rx="2.3" />
    <path d="M12 14.6v2.8" />
  </g>
);

const wait: Glyph = () => (
  <g>
    <path className={s.accent} d="M9.2 19.6c.6-2.4 2.8-3.3 2.8-3.3s2.2.9 2.8 3.3z" />
    <path d="M6.4 3.6h11.2M6.4 20.4h11.2M8 3.6c0 4.3 4 5.3 4 8.4s-4 4.1-4 8.4M16 3.6c0 4.3-4 5.3-4 8.4s4 4.1 4 8.4" />
  </g>
);

const guide: Glyph = () => (
  <g>
    <path className={s.dots} d="M3.4 19c2.6-4.6 5.6-7.4 10.2-7.4h3" />
    <path d="M15.6 7.6 19.8 11.6l-4.2 4" />
  </g>
);

const reroute: Glyph = () => (
  <g>
    <path d="M5 20v-6.2a5.2 5.2 0 0 1 5.2-5.2h8.6M15.2 5l3.6 3.6-3.6 3.6" />
  </g>
);

const stop: Glyph = () => (
  <g>
    <rect className={s.solid} x="6.8" y="5.4" width="3.8" height="13.2" rx="1.5" />
    <rect className={s.solid} x="13.4" y="5.4" width="3.8" height="13.2" rx="1.5" />
  </g>
);

/** Every glyph by vocabulary id. Figures and objects use the 64-unit grid; actions use the 24-unit grid. */
export const GLYPHS: Readonly<Record<string, Glyph>> = {
  official,
  police,
  students,
  office,
  gate,
  bus,
  road,
  meet,
  announce,
  lock,
  wait,
  guide,
  reroute,
  stop,
};
