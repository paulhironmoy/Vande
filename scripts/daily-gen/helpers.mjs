// Authoring helpers for VANDE daily crises. Emits DailyCrisis JSON.
export const ARCH = {
  dialogue: { tags: ['dialogue', 'communication'], effects: { grievance: 7, trust: 5, freedom: 2 }, authority: 'Duty to hear grievances; Article 19(1)(a) free expression' },
  transparent: { tags: ['transparent', 'communication'], effects: { trust: 6, evidence: 3, grievance: 5 }, authority: 'Duty of candour: say what is known and what is not' },
  investigate: { tags: ['investigative', 'legal-process'], effects: { evidence: 7, trust: 2, grievance: 2 }, authority: 'Due process: establish the facts before acting on them' },
  service: { tags: ['service', 'relief'], effects: { safety: 5, economy: 5, grievance: 3 }, authority: 'Duty to keep essential services running' },
  protect: { tags: ['protect-assembly', 'proportionate'], effects: { freedom: 5, safety: 3, trust: 2, grievance: 1 }, authority: 'Article 19(1)(b): peaceful assembly, policed in proportion' },
  press: { tags: ['protect-press', 'transparent'], effects: { freedom: 5, trust: 3, evidence: 2 }, authority: 'Article 19(1)(a): freedom of the press' },
  targeted: { tags: ['force', 'proportionate', 'legal-process'], effects: { safety: 6, freedom: -2, trust: 1 }, disproportionateEffects: { freedom: -8, trust: -7 }, authority: 'Proportionality: act against the few causing harm, not the many' },
  accuse: { tags: ['accusation', 'legal-process'], effects: { evidence: 5, trust: 4, safety: 3, grievance: 2 }, falseAccusationEffects: { freedom: -14, trust: -12, evidence: -9 }, authority: 'Due process: a public charge needs verified evidence' },
  suppress: { tags: ['suppressive', 'disproportionate'], effects: { freedom: -12, trust: -9, safety: 4, grievance: -4 }, authority: 'Article 19(2)–(3): restrictions must be reasonable and specific' },
  detain: { tags: ['detention', 'force', 'disproportionate'], effects: { freedom: -13, trust: -10, safety: 3, grievance: -5 }, authority: 'Articles 21 and 22: liberty and safeguards on arrest' },
  censor: { tags: ['censorship', 'suppressive'], effects: { freedom: -13, trust: -8, evidence: -3, safety: 2 }, authority: 'Article 19(1)(a): speech cannot be silenced wholesale' },
  wait: { tags: ['wait'], effects: { grievance: -4, trust: -3, safety: -2, economy: -1 }, authority: 'No action taken' },
};

const BACKLASH = { afterTicks: 18, effects: { safety: -4, trust: -3 }, message: 'The crackdown hardens people who had stayed out of it. More arrive, angrier.' };

export function O(id, arch, title, preview, consequence, extra = {}, simple) {
  const base = ARCH[arch];
  if (!base) throw new Error(`unknown archetype ${arch}`);
  const o = {
    id,
    title,
    preview,
    authority: extra.authority ?? base.authority,
    tags: extra.tags ?? base.tags,
    effects: { ...base.effects, ...(extra.effects ?? {}) },
    consequence,
  };
  if (base.falseAccusationEffects || extra.falseAccusationEffects) o.falseAccusationEffects = extra.falseAccusationEffects ?? base.falseAccusationEffects;
  if (base.disproportionateEffects || extra.disproportionateEffects) o.disproportionateEffects = extra.disproportionateEffects ?? base.disproportionateEffects;
  if (extra.prop) o.proportionateIf = extra.prop;
  if (extra.req) o.requiresEvidence = extra.req;
  if (extra.flags) o.setsFlags = extra.flags;
  if (extra.clears) o.clearsFlags = extra.clears;
  if (extra.unlocks) o.unlocksEvidence = extra.unlocks;
  if (extra.map) o.mapEffects = extra.map;
  if (extra.undo) o.undoTicks = extra.undo;
  const delayed = extra.delayed ?? ((arch === 'suppress' || arch === 'detain' || arch === 'censor') && !extra.noBacklash ? [BACKLASH] : undefined);
  if (delayed) o.delayed = delayed;
  o.__simple = simple;
  return o;
}

export function D(id, title, situation, meta, options, simple) {
  const def = meta.def ?? options.find((o) => o.tags.includes('wait'))?.id;
  if (!def) throw new Error(`decision ${id} has no default`);
  const d = {
    id,
    title,
    situation,
    district: meta.district,
    expiresAfter: meta.exp ?? 22,
    defaultOption: def,
    urgency: meta.urg ?? 'medium',
    options: options.map(({ __simple, ...o }) => o),
  };
  if (meta.at !== undefined) d.triggerAt = meta.at;
  if (meta.flag) d.triggerFlag = meta.flag;
  if (meta.rights) d.rightsMomentId = meta.rights;
  if (meta.cond) d.condition = meta.cond;
  const sopts = {};
  options.forEach((o) => {
    const s = o.__simple;
    if (!s) throw new Error(`option ${o.id} of ${id} lacks simple copy`);
    sopts[o.id] = { title: s[0], preview: s[1], ...(s[2] ? { consequence: s[2] } : {}) };
  });
  d.simple = { title: simple[0], situation: simple[1], options: sopts };
  return d;
}

export function E(id, title, source, sourceType, time, claim, m, simple) {
  const truth = m.truth ?? 'true';
  const official = sourceType === 'official' || sourceType === 'institution';
  let initialState = 'unverified';
  let resolvedState;
  if (truth === 'true') {
    if (official) initialState = 'verified';
    resolvedState = official || m.verifiedBy ? 'verified' : 'corroborated';
  } else if (truth === 'unknowable') resolvedState = 'unknown';
  else resolvedState = 'manipulated';
  const e = {
    id,
    title,
    source,
    sourceType,
    time,
    claim,
    initialState,
    truth,
    resolvedState,
    metadata: (m.meta ?? []).map(([label, value, anomaly]) => (anomaly ? { label, value, anomaly: true } : { label, value })),
    visual: { type: m.vis[0], caption: m.vis[1] },
    resolutionNote: m.note,
  };
  if (m.at !== undefined) e.availableAt = m.at;
  if (m.by) e.injectedBy = m.by;
  if (m.corr) e.corroboratedBy = m.corr;
  if (m.contra) e.contradictedBy = m.contra;
  if (m.district) e.district = m.district;
  if (m.perish) e.perishable = true;
  if (m.flags) e.setsFlagsOnResolve = m.flags;
  e.simple = { title: simple[0], claim: simple[1], resolutionNote: simple[2], caption: simple[3] };
  return e;
}

export function R(id, question, options, principle, why, source, simple) {
  return {
    id,
    question,
    options: options.map(([oid, text, correct, feedback]) => ({ id: oid, text, correct, feedback })),
    principle,
    why,
    source: { label: source[0], url: source[1] },
    contentDate: '2026-10-24',
    simple: {
      question: simple.question,
      options: Object.fromEntries(options.map(([oid], i) => [oid, simple.options[i]])),
      feedback: Object.fromEntries(options.map(([oid], i) => [oid, simple.feedback[i]])),
      principle: simple.principle,
      why: simple.why,
    },
  };
}

export function EV(id, at, kind, message, extra, smessage) {
  const e = { id, at, kind, message, simple: smessage };
  if (extra.effects) e.effects = extra.effects;
  if (extra.map) e.mapEffects = extra.map;
  if (extra.flags) e.setsFlags = extra.flags;
  if (extra.clears) e.clearsFlags = extra.clears;
  if (extra.cond) e.condition = extra.cond;
  return e;
}

export function rules(list) {
  return list.map(([condition, text, simple]) => ({ condition, text, simple }));
}

export const SRC = {
  constitution: ['Constitution of India, Article 19 (India Code)', 'https://www.indiacode.nic.in/'],
  liberty: ['Constitution of India, Articles 21 and 22 (India Code)', 'https://www.indiacode.nic.in/'],
  equality: ['Constitution of India, Article 14 (India Code)', 'https://www.indiacode.nic.in/'],
  court: ['Supreme Court of India — judgments', 'https://main.sci.gov.in/'],
  election: ['Election Commission of India — procedures', 'https://www.eci.gov.in/'],
  press: ['Press Council of India — norms', 'https://presscouncil.nic.in/'],
};

export function day(spec) {
  const {
    id, title, subtitle, key, tags, focus, institution, mood, scores, opponents, open, sopen,
    brief, sbrief, evidence, decisions, rights, events, complication, resolution, sresolution, closing, sclosing, duration,
  } = spec;
  const out = {
    id,
    version: 1,
    title,
    subtitle,
    dilemmaKey: key,
    themeTags: tags,
    focus,
    institution,
    mood,
    opponents,
    coldOpen: open,
    briefing: brief,
    evidence,
    decisions,
    rightsMoments: rights,
    events,
    complication,
    resolution: {
      resolved: rules(resolution.resolved),
      unresolved: rules(resolution.unresolved),
      rightsProtected: rules(resolution.protected),
      rightsHarmed: rules(resolution.harmed),
      improvements: rules(resolution.improve),
      closing,
    },
    simple: { title: spec.stitle, subtitle: spec.ssubtitle, briefing: sbrief, closing: sclosing, coldOpen: sopen },
  };
  if (scores) out.startingScores = scores;
  if (duration) out.duration = duration;
  void sresolution;
  return out;
}

/** Common complication events keyed by opponent; message/simple can be overridden. */
export function complicationEvent(opponent, focus, id, custom = {}) {
  const base = {
    provocateur: { kind: 'incident', message: `A knot of people at the front start pushing officers and throwing bottles. Most of the crowd backs away.`, simple: `A few people at the front start throwing things.`, effects: { safety: -5, trust: -1 }, map: [{ kind: 'incident', district: focus, incident: 'clash' }] },
    exploiter: { kind: 'rumor', message: `A speaker tells the crowd the city has already decided against them. Chants change tone.`, simple: `Someone tells the crowd the city is against them.`, effects: { grievance: -4, trust: -2 }, map: [{ kind: 'crowd', district: focus, magnitude: 0.2 }, { kind: 'mood', district: focus, mood: 'volatile' }] },
    disinfo: { kind: 'rumor', message: `A doctored clip with a fake official quote goes viral across the city's groups.`, simple: `A fake clip with a made-up quote spreads.`, effects: { trust: -3, evidence: -2 }, map: [{ kind: 'signal', from: focus, to: 'market', signal: 'manipulated' }] },
    sabotage: { kind: 'service', message: `Someone cuts power to the area. Screens, lights and the loudspeakers die at once.`, simple: `Someone cuts the power. Lights go out.`, effects: { economy: -3, safety: -3 }, map: [{ kind: 'incident', district: focus, incident: 'outage' }, { kind: 'service', district: focus, magnitude: -0.3 }] },
    overreaction: { kind: 'news', message: `Senior voices demand a sweeping response within the hour: clear everyone, ban everything.`, simple: `Loud voices demand a harsh crackdown now.`, effects: { trust: -1 }, map: [{ kind: 'mood', district: focus, mood: 'tense' }] },
  }[opponent];
  const merged = { ...base, ...custom };
  return EV(id, -1, merged.kind, merged.message, { effects: merged.effects, map: merged.map, flags: merged.flags }, merged.simple);
}
