/**
 * Lite picture vocabulary: the permanent ids a content author may use in an answer's `visual`
 * ({ actor, action, object }) in a scenario's simple layer.
 *
 * Data only, no React: the validator (src/lite/visuals.ts) and the pictogram components
 * (src/components/game/pictograms) both import it, and a unit test checks that every id has exactly one component
 * and every component has an id.
 *
 * Rules for this list:
 * - Ids are permanent. Never rename or reuse one; add a new id instead.
 * - Keep it as small as the content needs. Add a glyph only when a whole question can pass the four tests in
 *   docs/LITE-VISUALS.md.
 * - Only neutral glyphs may be used. A glyph that signals good or bad (weapons, handcuffs, injuries, fire, ticks,
 *   crosses, warning marks, smiling or angry faces) must never be added; if one is ever listed for documentation,
 *   mark it `neutral: false` and validation rejects every answer that uses it.
 */
export type VisualRole = 'actor' | 'action' | 'object';

export interface VisualGlyph {
  /** Permanent id used in content. Lowercase letters, digits and hyphens. */
  id: string;
  /** Roles the glyph may fill. People and buildings can act in one answer and be acted on in another. */
  roles: readonly VisualRole[];
  /** What the picture shows, for authors and reviewers. */
  shows: string;
  /** True when the glyph signals nothing good or bad. Non-neutral glyphs fail validation. */
  neutral: boolean;
}

export const VISUAL_VOCABULARY: readonly VisualGlyph[] = [
  // People and places: actors or objects
  { id: 'official', roles: ['actor', 'object'], shows: 'A city official wearing an ID badge on a lanyard', neutral: true },
  { id: 'police', roles: ['actor', 'object'], shows: 'A police officer in a peaked cap with a small badge; no equipment', neutral: true },
  { id: 'students', roles: ['actor', 'object'], shows: 'Three students standing together, one in front', neutral: true },
  { id: 'office', roles: ['actor', 'object'], shows: 'The exam office: a public building with columns and steps', neutral: true },
  // Things: objects
  { id: 'gate', roles: ['object'], shows: 'A campus gate: two posts, an arch and a few bars', neutral: true },
  { id: 'bus', roles: ['object'], shows: 'A city bus seen from the side', neutral: true },
  { id: 'road', roles: ['object'], shows: 'A road with a dashed centre line', neutral: true },
  // Actions
  { id: 'meet', roles: ['action'], shows: 'Two speech bubbles: talking together', neutral: true },
  { id: 'announce', roles: ['action'], shows: 'A megaphone with two sound waves: telling everyone', neutral: true },
  { id: 'lock', roles: ['action'], shows: 'A closed padlock', neutral: true },
  { id: 'wait', roles: ['action'], shows: 'An hourglass: waiting', neutral: true },
  { id: 'guide', roles: ['action'], shows: 'A dotted path ending in an arrow: making a way through', neutral: true },
  { id: 'reroute', roles: ['action'], shows: 'An arrow that turns: sending traffic another way', neutral: true },
  { id: 'stop', roles: ['action'], shows: 'A pause sign, two upright bars: stopping', neutral: true },
] as const;

const BY_ID: ReadonlyMap<string, VisualGlyph> = new Map(VISUAL_VOCABULARY.map((g) => [g.id, g]));

/** The glyph for an id, or undefined when the id is not in the vocabulary. */
export function glyphById(id: string): VisualGlyph | undefined {
  return BY_ID.get(id);
}

/** Every vocabulary id, in list order. */
export const VISUAL_IDS: readonly string[] = VISUAL_VOCABULARY.map((g) => g.id);
