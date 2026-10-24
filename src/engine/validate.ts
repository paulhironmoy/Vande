import {
  CONFIDENCE_STATES,
  DIMENSIONS,
  OPPONENT_IDS,
  SCENARIO_IDS,
  type Condition,
  type MapEffect,
} from './types';

type Obj = Record<string, unknown>;

const ACTION_TAGS = [
  'proportionate', 'disproportionate', 'suppressive', 'force', 'detention', 'accusation', 'transparent', 'investigative',
  'dialogue', 'service', 'communication', 'legal-process', 'protect-press', 'protect-assembly', 'wait', 'censorship', 'relief',
];
const TRUTHS = ['true', 'false', 'misleading', 'unknowable'];
const SOURCE_TYPES = ['official', 'institution', 'press', 'organizer', 'citizen', 'anonymous', 'leak', 'business', 'emergency'];
const VISUALS = ['photo', 'document', 'recording', 'message', 'chart', 'map', 'ledger', 'video'];
const DISTRICT_KINDS = ['campus', 'civic', 'market', 'transit', 'media', 'records', 'residential', 'industrial', 'hospital'];
const EVENT_KINDS = ['crowd', 'rumor', 'service', 'road', 'institution', 'news', 'incident', 'relief'];
const PLAY_KINDS = ['inject-evidence', 'event', 'decision', 'destroy-evidence'];
const URGENCIES = ['low', 'medium', 'high'];
const DIFFS = ['measured', 'standard', 'severe'];
const MAP_KINDS = ['crowd', 'mood', 'road', 'institution', 'service', 'signal', 'incident', 'trust', 'action'];
const MOODS = ['calm', 'tense', 'volatile', 'hopeful'];
const ROAD_STATUS = ['open', 'congested', 'closed'];
const INCIDENTS = ['vandalism', 'clash', 'fire', 'outage', 'intimidation'];
const SIGNALS = ['rumor', 'manipulated', 'verified', 'official'];
const ACTIONS = ['deploy', 'dialogue', 'announce', 'investigate', 'restore', 'protect', 'relief', 'legal'];

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Structural + referential validation of a scenario JSON document.
 * Returns readable error strings such as "decisions[3].defaultOption 'x' not found".
 */
export function validateScenario(json: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  if (!isObj(json)) return { ok: false, errors: ['scenario: not an object'] };
  const s = json;

  const str = (o: Obj, key: string, path: string, optional = false) => {
    if (o[key] === undefined) {
      if (!optional) err(`${path}.${key}`, 'missing');
      return;
    }
    if (!isStr(o[key])) err(`${path}.${key}`, 'must be a non-empty string');
  };
  const num = (o: Obj, key: string, path: string, lo: number, hi: number, optional = false) => {
    const v = o[key];
    if (v === undefined) {
      if (!optional) err(`${path}.${key}`, 'missing');
      return;
    }
    if (!isNum(v)) err(`${path}.${key}`, 'must be a number');
    else if (v < lo || v > hi) err(`${path}.${key}`, `must be between ${lo} and ${hi}`);
  };
  const oneOf = (o: Obj, key: string, path: string, list: readonly string[], optional = false) => {
    const v = o[key];
    if (v === undefined) {
      if (!optional) err(`${path}.${key}`, 'missing');
      return;
    }
    if (typeof v !== 'string' || !list.includes(v)) err(`${path}.${key}`, `must be one of ${list.join('|')}`);
  };
  const strArr = (o: Obj, key: string, path: string, optional = false, min = 0) => {
    const v = o[key];
    if (v === undefined) {
      if (!optional) err(`${path}.${key}`, 'missing');
      return;
    }
    if (!Array.isArray(v) || !v.every(isStr)) err(`${path}.${key}`, 'must be an array of non-empty strings');
    else if (v.length < min) err(`${path}.${key}`, `needs at least ${min} entries`);
  };
  const arr = (o: Obj, key: string, path: string, min = 0): Obj[] => {
    const v = o[key];
    if (!Array.isArray(v)) {
      err(`${path}.${key}`, 'must be an array');
      return [];
    }
    if (v.length < min) err(`${path}.${key}`, `needs at least ${min} entries`);
    return v.filter((x, i) => {
      if (!isObj(x)) {
        err(`${path}.${key}[${i}]`, 'must be an object');
        return false;
      }
      return true;
    }) as Obj[];
  };
  const idsOf = (items: Obj[]) => items.map((x) => (isStr(x.id) ? x.id : '')).filter(Boolean);
  const uniqueIds = (items: Obj[], path: string) => {
    const seen = new Set<string>();
    items.forEach((x, i) => {
      if (!isStr(x.id)) return err(`${path}[${i}].id`, 'missing');
      if (seen.has(x.id)) err(`${path}[${i}].id`, `duplicate id '${x.id}'`);
      seen.add(x.id);
    });
  };
  const scoreDelta = (v: unknown, path: string, optional: boolean) => {
    if (v === undefined) return void (optional || err(path, 'missing'));
    if (!isObj(v)) return err(path, 'must be an object of dimension deltas');
    for (const [k, val] of Object.entries(v)) {
      if (!(DIMENSIONS as readonly string[]).includes(k)) err(`${path}.${k}`, 'unknown dimension');
      else if (!isNum(val)) err(`${path}.${k}`, 'must be a number');
    }
  };

  oneOf(s, 'id', 'scenario', SCENARIO_IDS);
  num(s, 'chapter', 'scenario', 1, 3);
  str(s, 'title', 'scenario');
  str(s, 'subtitle', 'scenario');
  num(s, 'duration', 'scenario', 60, 600);
  const duration = isNum(s.duration) ? s.duration : 180;

  if (!isObj(s.briefing)) err('scenario.briefing', 'missing');
  else {
    const b = s.briefing;
    str(b, 'grievance', 'briefing');
    strArr(b, 'knownFacts', 'briefing', false, 1);
    strArr(b, 'unverifiedClaims', 'briefing', false, 1);
    str(b, 'responsibility', 'briefing');
    str(b, 'objective', 'briefing');
    strArr(b, 'lines', 'briefing', false, 2);
  }

  if (!isObj(s.startingScores)) err('scenario.startingScores', 'missing');
  else for (const d of DIMENSIONS) num(s.startingScores, d, 'startingScores', 0, 100);

  // Districts & roads
  const districts = arr(s, 'districts', 'scenario', 3);
  uniqueIds(districts, 'districts');
  const districtIds = new Set(idsOf(districts));
  districts.forEach((d, i) => {
    const p = `districts[${i}]`;
    str(d, 'name', p);
    oneOf(d, 'kind', p, DISTRICT_KINDS);
    num(d, 'x', p, 0, 1);
    num(d, 'y', p, 0, 1);
    str(d, 'institution', p, true);
    if (!isObj(d.baseline)) err(`${p}.baseline`, 'missing');
    else {
      num(d.baseline, 'crowd', `${p}.baseline`, 0, 1);
      num(d.baseline, 'trust', `${p}.baseline`, 0, 1);
      num(d.baseline, 'services', `${p}.baseline`, 0, 1);
    }
  });
  const roads = arr(s, 'roads', 'scenario', 1);
  uniqueIds(roads, 'roads');
  const roadIds = new Set(idsOf(roads));
  roads.forEach((r, i) => {
    for (const k of ['from', 'to']) {
      if (!isStr(r[k])) err(`roads[${i}].${k}`, 'missing');
      else if (!districtIds.has(r[k] as string)) err(`roads[${i}].${k}`, `district '${r[k]}' not found`);
    }
  });

  const checkDistrict = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!isStr(v) || !districtIds.has(v)) err(path, `district '${String(v)}' not found`);
  };

  // Evidence
  const evidence = arr(s, 'evidence', 'scenario', 1);
  uniqueIds(evidence, 'evidence');
  const evidenceIds = new Set(idsOf(evidence));
  const evidenceById = new Map(evidence.map((e) => [e.id as string, e]));
  const checkEvidenceRef = (v: unknown, path: string) => {
    if (!isStr(v) || !evidenceIds.has(v)) err(path, `evidence '${String(v)}' not found`);
  };

  const checkCondition = (c: unknown, path: string) => {
    if (c === undefined) return;
    if (!isObj(c)) return err(path, 'condition must be an object');
    const cond = c as Partial<Condition> & Obj;
    for (const k of Object.keys(cond)) {
      if (!['flag', 'notFlag', 'anyFlag', 'minScore', 'maxScore', 'opponent', 'notOpponent', 'evidence'].includes(k)) err(`${path}.${k}`, 'unknown condition key');
    }
    if (cond.flag !== undefined && !isStr(cond.flag)) err(`${path}.flag`, 'must be a string');
    if (cond.notFlag !== undefined && !isStr(cond.notFlag)) err(`${path}.notFlag`, 'must be a string');
    if (cond.anyFlag !== undefined) strArr(cond, 'anyFlag', path, true, 1);
    scoreDelta(cond.minScore, `${path}.minScore`, true);
    scoreDelta(cond.maxScore, `${path}.maxScore`, true);
    oneOf(cond, 'opponent', path, OPPONENT_IDS, true);
    oneOf(cond, 'notOpponent', path, OPPONENT_IDS, true);
    if (cond.evidence !== undefined) {
      if (!isObj(cond.evidence)) err(`${path}.evidence`, 'must be an object');
      else {
        checkEvidenceRef(cond.evidence.id, `${path}.evidence.id`);
        const states = cond.evidence.states;
        if (!Array.isArray(states) || !states.every((x) => (CONFIDENCE_STATES as readonly string[]).includes(x as string))) err(`${path}.evidence.states`, 'must be an array of confidence states');
      }
    }
  };

  const checkMapEffects = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) return err(path, 'must be an array');
    v.forEach((m, i) => {
      const p = `${path}[${i}]`;
      if (!isObj(m)) return err(p, 'must be an object');
      const me = m as Partial<MapEffect> & Obj;
      oneOf(me, 'kind', p, MAP_KINDS);
      checkDistrict(me.district, `${p}.district`);
      checkDistrict(me.from, `${p}.from`);
      checkDistrict(me.to, `${p}.to`);
      if (me.road !== undefined && (!isStr(me.road) || !roadIds.has(me.road))) err(`${p}.road`, `road '${String(me.road)}' not found`);
      if (me.magnitude !== undefined && !isNum(me.magnitude)) err(`${p}.magnitude`, 'must be a number');
      oneOf(me, 'mood', p, MOODS, true);
      oneOf(me, 'status', p, ROAD_STATUS, true);
      oneOf(me, 'signal', p, SIGNALS, true);
      if (me.incident !== undefined && me.incident !== null) oneOf(me, 'incident', p, INCIDENTS, true);
      oneOf(me, 'action', p, ACTIONS, true);
      switch (me.kind) {
        case 'crowd':
        case 'service':
        case 'trust':
          if (!isStr(me.district)) err(p, `${me.kind} needs district`);
          if (!isNum(me.magnitude)) err(p, `${me.kind} needs magnitude`);
          break;
        case 'mood':
          if (!isStr(me.district) || !isStr(me.mood)) err(p, 'mood needs district and mood');
          break;
        case 'road':
          if (!isStr(me.road) || !isStr(me.status)) err(p, 'road needs road and status');
          break;
        case 'institution':
          if (!isStr(me.district)) err(p, 'institution needs district');
          break;
        case 'signal':
          if (!isStr(me.from) || !isStr(me.to) || !isStr(me.signal)) err(p, 'signal needs from, to and signal');
          break;
        case 'incident':
          if (!isStr(me.district) || me.incident === undefined) err(p, 'incident needs district and incident (or null)');
          break;
        case 'action':
          if (!isStr(me.district) || !isStr(me.action)) err(p, 'action needs district and action');
          break;
        default:
          break;
      }
    });
  };

  evidence.forEach((e, i) => {
    const p = `evidence[${i}]`;
    str(e, 'title', p);
    str(e, 'source', p);
    oneOf(e, 'sourceType', p, SOURCE_TYPES);
    str(e, 'time', p);
    str(e, 'claim', p);
    oneOf(e, 'initialState', p, CONFIDENCE_STATES);
    oneOf(e, 'truth', p, TRUTHS);
    oneOf(e, 'resolvedState', p, CONFIDENCE_STATES);
    oneOf(e, 'injectedBy', p, OPPONENT_IDS, true);
    num(e, 'availableAt', p, 0, duration, true);
    if (!Array.isArray(e.metadata)) err(`${p}.metadata`, 'must be an array');
    else e.metadata.forEach((m, j) => {
      if (!isObj(m) || !isStr(m.label) || typeof m.value !== 'string') err(`${p}.metadata[${j}]`, 'needs label and value strings');
      else if (m.anomaly !== undefined && typeof m.anomaly !== 'boolean') err(`${p}.metadata[${j}].anomaly`, 'must be boolean');
    });
    for (const key of ['corroboratedBy', 'contradictedBy']) {
      const v = e[key];
      if (v === undefined) continue;
      if (!Array.isArray(v)) err(`${p}.${key}`, 'must be an array');
      else v.forEach((id, j) => {
        checkEvidenceRef(id, `${p}.${key}[${j}]`);
        if (id === e.id) err(`${p}.${key}[${j}]`, 'cannot reference itself');
      });
    }
    if (!isObj(e.visual)) err(`${p}.visual`, 'missing');
    else {
      oneOf(e.visual, 'type', `${p}.visual`, VISUALS);
      str(e.visual, 'caption', `${p}.visual`);
    }
    checkDistrict(e.district, `${p}.district`);
    strArr(e, 'setsFlagsOnResolve', p, true);
    if (e.perishable !== undefined && typeof e.perishable !== 'boolean') err(`${p}.perishable`, 'must be boolean');
    str(e, 'resolutionNote', p);
    const truth = e.truth;
    if ((truth === 'false' || truth === 'misleading') && isStr(e.resolvedState) && e.resolvedState !== 'manipulated') {
      err(`${p}.resolvedState`, `truth '${truth}' should resolve to 'manipulated'`);
    }
    if ((truth === 'false' || truth === 'misleading')) {
      const hasAnomaly = Array.isArray(e.metadata) && e.metadata.some((m) => isObj(m) && m.anomaly === true);
      const hasContra = Array.isArray(e.contradictedBy) && e.contradictedBy.length > 0;
      if (!hasAnomaly && !hasContra) err(p, `false/misleading evidence needs an anomaly or a contradictedBy source so it can be exposed`);
    }
  });

  // Rights moments
  const rights = arr(s, 'rightsMoments', 'scenario');
  uniqueIds(rights, 'rightsMoments');
  const rightsIds = new Set(idsOf(rights));
  rights.forEach((r, i) => {
    const p = `rightsMoments[${i}]`;
    str(r, 'question', p);
    str(r, 'principle', p);
    str(r, 'why', p);
    str(r, 'contentDate', p);
    if (isStr(r.contentDate) && !/^\d{4}-\d{2}-\d{2}$/.test(r.contentDate)) err(`${p}.contentDate`, 'must be YYYY-MM-DD');
    if (r.source !== undefined) {
      if (!isObj(r.source) || !isStr(r.source.label) || !isStr(r.source.url)) err(`${p}.source`, 'needs label and url');
      else if (!/^https:\/\//.test(r.source.url)) err(`${p}.source.url`, 'must be an https URL');
    }
    const opts = arr(r, 'options', p, 2);
    uniqueIds(opts, `${p}.options`);
    let correct = 0;
    opts.forEach((o, j) => {
      str(o, 'text', `${p}.options[${j}]`);
      str(o, 'feedback', `${p}.options[${j}]`);
      if (typeof o.correct !== 'boolean') err(`${p}.options[${j}].correct`, 'must be boolean');
      else if (o.correct) correct++;
    });
    if (correct !== 1) err(`${p}.options`, 'exactly one option must be correct');
  });

  // Decisions
  const decisions = arr(s, 'decisions', 'scenario', 1);
  uniqueIds(decisions, 'decisions');
  const decisionIds = new Set(idsOf(decisions));
  const decisionById = new Map(decisions.map((d) => [d.id as string, d]));
  decisions.forEach((d, i) => {
    const p = `decisions[${i}]`;
    str(d, 'title', p);
    str(d, 'situation', p);
    checkDistrict(d.district, `${p}.district`);
    num(d, 'triggerAt', p, 0, duration, true);
    str(d, 'triggerFlag', p, true);
    checkCondition(d.condition, `${p}.condition`);
    num(d, 'expiresAfter', p, 5, 120);
    oneOf(d, 'urgency', p, URGENCIES);
    if (d.rightsMomentId !== undefined && (!isStr(d.rightsMomentId) || !rightsIds.has(d.rightsMomentId))) err(`${p}.rightsMomentId`, `rights moment '${String(d.rightsMomentId)}' not found`);
    const opts = arr(d, 'options', p, 2);
    if (opts.length > 4) err(`${p}.options`, 'at most 4 options');
    uniqueIds(opts, `${p}.options`);
    const optIds = new Set(idsOf(opts));
    if (!isStr(d.defaultOption)) err(`${p}.defaultOption`, 'missing');
    else if (!optIds.has(d.defaultOption)) err(`${p}.defaultOption`, `'${d.defaultOption}' not found`);
    opts.forEach((o, j) => {
      const q = `${p}.options[${j}]`;
      str(o, 'title', q);
      str(o, 'preview', q);
      str(o, 'authority', q);
      str(o, 'consequence', q);
      if (!Array.isArray(o.tags) || o.tags.length === 0) err(`${q}.tags`, 'needs at least one tag');
      else o.tags.forEach((t, k) => { if (!ACTION_TAGS.includes(t as string)) err(`${q}.tags[${k}]`, `unknown tag '${String(t)}'`); });
      scoreDelta(o.effects, `${q}.effects`, false);
      scoreDelta(o.falseAccusationEffects, `${q}.falseAccusationEffects`, true);
      scoreDelta(o.disproportionateEffects, `${q}.disproportionateEffects`, true);
      checkCondition(o.proportionateIf, `${q}.proportionateIf`);
      if (o.requiresEvidence !== undefined) {
        if (!Array.isArray(o.requiresEvidence)) err(`${q}.requiresEvidence`, 'must be an array');
        else o.requiresEvidence.forEach((id, k) => checkEvidenceRef(id, `${q}.requiresEvidence[${k}]`));
      }
      if (o.unlocksEvidence !== undefined) {
        if (!Array.isArray(o.unlocksEvidence)) err(`${q}.unlocksEvidence`, 'must be an array');
        else o.unlocksEvidence.forEach((id, k) => checkEvidenceRef(id, `${q}.unlocksEvidence[${k}]`));
      }
      if (o.delayed !== undefined) {
        if (!Array.isArray(o.delayed)) err(`${q}.delayed`, 'must be an array');
        else o.delayed.forEach((de, k) => {
          const r = `${q}.delayed[${k}]`;
          if (!isObj(de)) return err(r, 'must be an object');
          num(de, 'afterTicks', r, 1, duration);
          scoreDelta(de.effects, `${r}.effects`, false);
          str(de, 'message', r);
          checkCondition(de.condition, `${r}.condition`);
          checkMapEffects(de.mapEffects, `${r}.mapEffects`);
          strArr(de, 'setsFlags', r, true);
        });
      }
      checkMapEffects(o.mapEffects, `${q}.mapEffects`);
      num(o, 'undoTicks', q, 1, 30, true);
      strArr(o, 'setsFlags', q, true);
      strArr(o, 'clearsFlags', q, true);
      const tags = Array.isArray(o.tags) ? (o.tags as string[]) : [];
      if (o.undoTicks !== undefined && tags.some((t) => ['force', 'detention', 'accusation', 'suppressive', 'censorship', 'disproportionate'].includes(t))) {
        err(`${q}.undoTicks`, 'coercive or accusatory options cannot be undone');
      }
      if (tags.includes('accusation') && (!Array.isArray(o.requiresEvidence) || o.requiresEvidence.length === 0)) {
        err(`${q}.requiresEvidence`, 'accusation options must name the evidence they rely on');
      }
    });
  });

  // Events
  const events = arr(s, 'events', 'scenario', 1);
  uniqueIds(events, 'events');
  const eventById = new Map(events.map((e) => [e.id as string, e]));
  events.forEach((e, i) => {
    const p = `events[${i}]`;
    // `at` beyond the duration (e.g. 999) marks an event that only fires through an opponent play.
    num(e, 'at', p, -1, Number.MAX_SAFE_INTEGER);
    oneOf(e, 'kind', p, EVENT_KINDS);
    str(e, 'message', p);
    checkCondition(e.condition, `${p}.condition`);
    scoreDelta(e.effects, `${p}.effects`, true);
    checkMapEffects(e.mapEffects, `${p}.mapEffects`);
    strArr(e, 'setsFlags', p, true);
    strArr(e, 'clearsFlags', p, true);
  });

  // Opponent plays
  const plays = arr(s, 'opponentPlays', 'scenario');
  uniqueIds(plays, 'opponentPlays');
  const playTargets = { decision: new Set<string>(), event: new Set<string>() };
  plays.forEach((pl, i) => {
    const p = `opponentPlays[${i}]`;
    oneOf(pl, 'opponent', p, OPPONENT_IDS);
    oneOf(pl, 'kind', p, PLAY_KINDS);
    num(pl, 'earliest', p, 0, duration);
    num(pl, 'latest', p, 0, duration);
    if (isNum(pl.earliest) && isNum(pl.latest) && pl.earliest > pl.latest) err(p, 'earliest must be <= latest');
    num(pl, 'weight', p, 0.01, 10, true);
    strArr(pl, 'respondsTo', p, true);
    if (Array.isArray(pl.respondsTo)) pl.respondsTo.forEach((t, k) => { if (!ACTION_TAGS.includes(t as string)) err(`${p}.respondsTo[${k}]`, `unknown tag '${String(t)}'`); });
    oneOf(pl, 'minDifficulty', p, DIFFS, true);
    checkCondition(pl.condition, `${p}.condition`);
    str(pl, 'message', p, true);
    const target = pl.target;
    if (!isStr(target)) return err(`${p}.target`, 'missing');
    switch (pl.kind) {
      case 'inject-evidence': {
        const ev = evidenceById.get(target);
        if (!ev) err(`${p}.target`, `evidence '${target}' not found`);
        else if (ev.injectedBy !== pl.opponent) err(`${p}.target`, `evidence '${target}' must have injectedBy '${String(pl.opponent)}'`);
        break;
      }
      case 'destroy-evidence': {
        const ev = evidenceById.get(target);
        if (!ev) err(`${p}.target`, `evidence '${target}' not found`);
        else if (ev.perishable !== true) err(`${p}.target`, `evidence '${target}' must be perishable to be destroyed`);
        break;
      }
      case 'event':
        if (!eventById.has(target)) err(`${p}.target`, `event '${target}' not found`);
        else playTargets.event.add(target);
        break;
      case 'decision':
        if (!decisionById.has(target)) err(`${p}.target`, `decision '${target}' not found`);
        else playTargets.decision.add(target);
        break;
      default:
        break;
    }
  });
  // Every decision must be reachable.
  decisions.forEach((d, i) => {
    if (d.triggerAt === undefined && d.triggerFlag === undefined && !playTargets.decision.has(d.id as string)) {
      err(`decisions[${i}]`, `'${String(d.id)}' is never triggered (needs triggerAt, triggerFlag or an opponent play)`);
    }
  });
  // Every evidence item must be reachable: a timeline arrival, an injecting play or an unlocking option.
  const injectTargets = new Set(plays.filter((p) => p.kind === 'inject-evidence').map((p) => p.target as string));
  const unlockTargets = new Set<string>();
  for (const d of decisions) {
    const opts = Array.isArray(d.options) ? (d.options as unknown[]) : [];
    for (const o of opts) if (isObj(o) && Array.isArray(o.unlocksEvidence)) for (const id of o.unlocksEvidence) if (isStr(id)) unlockTargets.add(id);
  }
  evidence.forEach((e, i) => {
    const id = e.id as string;
    if (e.injectedBy !== undefined && !injectTargets.has(id)) err(`evidence[${i}]`, `'${id}' is injectedBy but no play injects it`);
    if (e.injectedBy === undefined && e.availableAt === undefined && !unlockTargets.has(id)) {
      err(`evidence[${i}]`, `'${id}' is unreachable (needs availableAt, injectedBy with a play, or an option that unlocks it)`);
    }
  });
  // Opponent presence: each opponent should have >= 1 play.
  for (const id of OPPONENT_IDS) {
    if (!plays.some((p) => p.opponent === id)) err('opponentPlays', `no plays for opponent '${id}'`);
  }

  // Resolution
  if (!isObj(s.resolution)) err('scenario.resolution', 'missing');
  else {
    const r = s.resolution;
    for (const key of ['resolved', 'unresolved', 'rightsProtected', 'rightsHarmed', 'improvements']) {
      const rules = arr(r, key, 'resolution', 1);
      rules.forEach((rule, i) => {
        checkCondition(rule.condition, `resolution.${key}[${i}].condition`);
        if (rule.condition === undefined) err(`resolution.${key}[${i}].condition`, 'missing');
        str(rule, 'text', `resolution.${key}[${i}]`);
      });
    }
    if (!isObj(r.closing)) err('resolution.closing', 'missing');
    else for (const k of ['good', 'mixed', 'poor']) str(r.closing, k, 'resolution.closing');
  }

  void decisionIds;
    // Simple-language layer (optional): plain-words copy must reference real option ids.
  const simpleObj = (v: unknown): v is Obj => isObj(v);
  if (s.simple !== undefined && !simpleObj(s.simple)) err('simple', 'must be an object');
  if (Array.isArray(s.decisions)) {
    s.decisions.forEach((d: unknown, i: number) => {
      if (!isObj(d) || d.simple === undefined) return;
      const path = `decisions[${i}].simple`;
      if (!simpleObj(d.simple)) return err(path, 'must be an object');
      str(d.simple, 'title', path);
      str(d.simple, 'situation', path);
      const ids = new Set(Array.isArray(d.options) ? d.options.map((o: unknown) => (isObj(o) ? String(o.id) : '')) : []);
      const so = d.simple.options;
      if (!simpleObj(so)) return err(`${path}.options`, 'missing');
      for (const id of ids) if (!(id in so)) err(`${path}.options.${id}`, 'missing simple copy');
      for (const [id, o] of Object.entries(so)) {
        if (!ids.has(id)) err(`${path}.options.${id}`, 'unknown option id');
        if (!simpleObj(o)) {
          err(`${path}.options.${id}`, 'must be an object');
          continue;
        }
        str(o, 'title', `${path}.options.${id}`);
        str(o, 'preview', `${path}.options.${id}`);
      }
    });
  }
  if (Array.isArray(s.rightsMoments)) {
    s.rightsMoments.forEach((r: unknown, i: number) => {
      if (!isObj(r) || r.simple === undefined) return;
      const path = `rightsMoments[${i}].simple`;
      if (!simpleObj(r.simple)) return err(path, 'must be an object');
      str(r.simple, 'question', path);
      str(r.simple, 'principle', path);
      str(r.simple, 'why', path);
      const ids = new Set(Array.isArray(r.options) ? r.options.map((o: unknown) => (isObj(o) ? String(o.id) : '')) : []);
      const so = r.simple.options;
      if (!simpleObj(so)) return err(`${path}.options`, 'missing');
      for (const id of ids) if (!(id in so)) err(`${path}.options.${id}`, 'missing simple copy');
      for (const id of Object.keys(so)) if (!ids.has(id)) err(`${path}.options.${id}`, 'unknown option id');
    });
  }
  if (Array.isArray(s.evidence)) {
    s.evidence.forEach((e: unknown, i: number) => {
      if (!isObj(e) || e.simple === undefined) return;
      const path = `evidence[${i}].simple`;
      if (!simpleObj(e.simple)) return err(path, 'must be an object');
      str(e.simple, 'title', path);
      str(e.simple, 'claim', path);
    });
  }
  return { ok: errors.length === 0, errors };
}
