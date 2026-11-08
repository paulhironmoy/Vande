#!/usr/bin/env node
/**
 * Cover-drive P1 analysis: joins the Unity per-frame telemetry with the TypeScript physics telemetry and writes
 * baseline-metrics.json (deterministic; no wall-clock content). Builder observations only — the evaluators own the
 * locked checks. Definitions are written next to each number so an evaluator can rerun or reject them.
 *
 *   node scripts/cover-drive/analyse.mjs --run <dir containing ts/ and unity/>
 *
 * Conventions: metres, seconds, y up, the bowler towards −z, the right-hander's off side +x. The front foot of a
 * right-hander is foot.L. "Foot" is the MakeHuman foot bone head (the ankle), so stance and base widths are
 * ankle-to-ankle, not foot-centre-to-foot-centre.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const runDir = path.resolve(args[args.indexOf('--run') + 1]);
const BALL_R = 0.0359;

const read = (rel) => readFileSync(path.join(runDir, rel), 'utf8');
const lines = (rel) => read(rel).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const summary = JSON.parse(read('ts/summary.json'));
const physicsFrames = lines('ts/physics-telemetry.jsonl');
const unityLines = lines('unity/telemetry.jsonl');

const v = (a) => ({ x: a[0], y: a[1], z: a[2] });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
const hlen = (a) => Math.hypot(a.x, a.z);
const deg = (r) => (r * 180) / Math.PI;
const angle = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b) || 1)))));
const r6 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
const segDist = (p, a, b) => {
  const ab = sub(b, a);
  const u = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-12)));
  return len(sub(p, add(a, mul(ab, u))));
};
const joint = (f, name) => (f.joints?.[name] ? v(f.joints[name]) : null);
const flexion = (f, side) => {
  const hip = joint(f, `upperleg01.${side}`);
  const knee = joint(f, `lowerleg01.${side}`);
  const ankle = joint(f, `foot.${side}`);
  if (!hip || !knee || !ankle) return null;
  return 180 - angle(sub(hip, knee), sub(ankle, knee));
};
const elbowFlex = (f, side) => {
  const sh = joint(f, `upperarm01.${side}`);
  const el = joint(f, `lowerarm01.${side}`);
  const wr = joint(f, `wrist.${side}`);
  if (!sh || !el || !wr) return null;
  return 180 - angle(sub(sh, el), sub(wr, el));
};

const byCase = new Map();
for (const l of unityLines) {
  if (l.type !== 'case' && l.type !== 'frame') continue;
  if (!byCase.has(l.caseId)) byCase.set(l.caseId, { header: null, frames: [], events: [] });
  const c = byCase.get(l.caseId);
  if (l.type === 'case') c.header = l;
  else c.frames.push(l);
}
// trace/feedback events carry no caseId; attach them to the case whose frames surround them (file order).
{
  let current = null;
  for (const l of unityLines) {
    if (l.type === 'case') current = l.caseId;
    else if (l.type !== 'frame' && current && !l.caseId) byCase.get(current).events.push(l);
  }
}
const physicsByCase = new Map();
for (const f of physicsFrames) {
  if (!physicsByCase.has(f.caseId)) physicsByCase.set(f.caseId, new Map());
  physicsByCase.get(f.caseId).set(f.frame, f);
}
const summaryByCase = new Map(summary.cases.map((c) => [c.caseId, c]));

function physicsAt(caseId, gridT) {
  const frames = physicsByCase.get(caseId);
  if (!frames || gridT < -1e-9) return null;
  return frames.get(Math.round(gridT * 60)) ?? null;
}

/** The presentation shows physics: a bat/pad contact must appear with the same kind; a miss or leave shows none. */
function presentedMatches(physicsKind, traceContacts) {
  const shown = traceContacts[0] ?? 'none';
  if (physicsKind === 'miss' || physicsKind === 'leave' || physicsKind === null) return shown === 'none' || shown === physicsKind;
  return shown === physicsKind && traceContacts.length === 1;
}

function caseMetrics(caseId) {
  const c = byCase.get(caseId);
  const s = summaryByCase.get(caseId);
  if (!c || !c.header || !s) return null;
  const H = c.header.heightMetres || 1.78;
  const frames = c.frames;
  const stance = frames[0];
  const contactT = c.header.physicsContact.t ?? s.batterMotion?.contactT ?? s.idealContactT;
  const nearest = (t) => frames.reduce((best, f) => (Math.abs(f.gridT - t) < Math.abs(best.gridT - t) ? f : best), frames[0]);
  const atContact = nearest(contactT);
  const physContact = physicsAt(caseId, atContact.gridT);
  const batLen = physContact?.bat ? len(sub(v([physContact.bat.toe.x, physContact.bat.toe.y, physContact.bat.toe.z]),
    v([physContact.bat.grip.x, physContact.bat.grip.y, physContact.bat.grip.z]))) : 0.86;
  const toeOf = (f) => (f.bat ? sub(v(f.bat.p), mul(v(f.bat.handleUp), batLen)) : null);

  // Presented contact class vs physics (D1 / C5 honesty: Unity must show what physics decided, never relabel).
  const traceContacts = c.events.filter((e) => e.type === 'trace_event' && e.kind === 'contact').map((e) => e.contact);
  const feedbackContacts = c.events.filter((e) => e.type === 'feedback' && e.kind === 'BatContact').map((e) => e.contact);
  const feedbackBat = c.events.find((e) => e.type === 'feedback' && e.kind === 'BatContact');

  // Rendered bat–ball separation (C4): min over the frames from release to contact + 0.1 s.
  let minBallBat = Infinity;
  let minAt = null;
  for (const f of frames) {
    if (f.gridT < 0 || f.gridT > contactT + 0.1 || !f.ball || !f.bat || !f.ball.visible) continue;
    const d = segDist(v(f.ball.p), v(f.bat.p), toeOf(f)) - BALL_R;
    if (d < minBallBat) { minBallBat = d; minAt = f.gridT; }
  }

  // Bat vs physics at the contact frame (C2).
  let batGripErr = null;
  let batFaceErr = null;
  if (physContact?.bat && atContact.bat) {
    const pg = v([physContact.bat.grip.x, physContact.bat.grip.y, physContact.bat.grip.z]);
    const pf = v([physContact.bat.face.x, physContact.bat.face.y, physContact.bat.face.z]);
    batGripErr = len(sub(v(atContact.bat.p), pg));
    batFaceErr = angle(v(atContact.bat.faceNormal), pf);
  }

  // Feet: front = foot.L for a right-hander. Plant = last crossing below 0.3 H/s before contact.
  const speed = (name) => frames.map((f, i) => {
    if (i === 0) return 0;
    const a = joint(frames[i - 1], name);
    const b = joint(f, name);
    return a && b ? hlen(sub(b, a)) * 60 : 0;
  });
  const frontSpeed = speed('foot.L');
  let liftIdx = null;
  let plantIdx = null;
  const contactIdx = frames.indexOf(atContact);
  for (let i = 1; i <= contactIdx; i++) {
    if (frontSpeed[i] >= 0.3 * H && liftIdx === null) liftIdx = i;
    if (liftIdx !== null && frontSpeed[i - 1] >= 0.3 * H && frontSpeed[i] < 0.3 * H) plantIdx = i;
  }
  const endIdx = frames.findIndex((f) => f.gridT >= contactT + 1.0);
  const recoveryIdx = endIdx < 0 ? frames.length - 1 : endIdx;
  let frontSlide = null;
  if (plantIdx !== null) {
    const p0 = joint(frames[plantIdx], 'foot.L');
    frontSlide = 0;
    for (let i = plantIdx; i <= recoveryIdx; i++) frontSlide = Math.max(frontSlide, hlen(sub(joint(frames[i], 'foot.L'), p0)));
  }
  const backStart = joint(stance, 'foot.R');
  let backTravel = 0;
  for (let i = 0; i <= recoveryIdx; i++) backTravel = Math.max(backTravel, hlen(sub(joint(frames[i], 'foot.R'), backStart)));
  let minFootY = Infinity;
  let maxFootLift = -Infinity;
  const stanceFootY = Math.min(joint(stance, 'foot.L').y, joint(stance, 'foot.R').y);
  for (const f of frames) {
    for (const side of ['L', 'R']) {
      const y = joint(f, `foot.${side}`).y;
      minFootY = Math.min(minFootY, y);
      maxFootLift = Math.max(maxFootLift, y - stanceFootY);
    }
  }

  // Bat path: toe height for backlift; toe speed for the peak.
  const toeY = frames.map((f) => toeOf(f)?.y ?? null);
  const toeSpeed = frames.map((f, i) => (i === 0 || !toeOf(f) || !toeOf(frames[i - 1]) ? 0 : len(sub(toeOf(f), toeOf(frames[i - 1]))) * 60));
  const stanceToeY = toeY[0];
  const backliftStartIdx = toeY.findIndex((y, i) => i <= contactIdx && y !== null && y - stanceToeY > 0.02);
  let topIdx = null;
  for (let i = 0; i <= contactIdx; i++) if (toeY[i] !== null && (topIdx === null || toeY[i] > toeY[topIdx])) topIdx = i;
  let peakIdx = null;
  for (let i = Math.max(0, contactIdx - 30); i <= Math.min(frames.length - 1, contactIdx + 6); i++) {
    if (peakIdx === null || toeSpeed[i] > toeSpeed[peakIdx]) peakIdx = i;
  }
  const rel = (i) => (i === null || i < 0 ? null : r6((frames[i].gridT - contactT) * 1000));

  // Head (B5, R-P6) and hands (B9, R-F1).
  const headAt = (f) => v(f.head);
  let headLat = null;
  if (topIdx !== null) {
    const xs = frames.slice(topIdx, contactIdx + 1).map((f) => headAt(f).x);
    headLat = Math.max(...xs) - Math.min(...xs);
  }
  const frontKneeZ = joint(atContact, 'lowerleg01.L')?.z;
  const headBehindKnee = frontKneeZ !== undefined ? headAt(atContact).z - frontKneeZ : null;
  let handsAboveHeadMs = null;
  for (const f of frames) {
    if (f.gridT < contactT || f.gridT > contactT + 0.6) continue;
    const top = Math.max(joint(f, 'wrist.L').y, joint(f, 'wrist.R').y);
    if (top >= headAt(f).y) { handsAboveHeadMs = r6((f.gridT - contactT) * 1000); break; }
  }
  const follow = nearest(contactT + 0.27);

  // Life (A5): the batter's hips during the run-up (before the trigger), and frozen stretches.
  const pre = frames.filter((f) => f.gridT < Math.min(-0.5, (s.batterMotion?.startT ?? 0) - 0.5));
  let lifeRange = null;
  let longestStillS = null;
  if (pre.length > 1) {
    const hs = pre.map((f) => v(f.hips));
    const span = (k) => Math.max(...hs.map((h) => h[k])) - Math.min(...hs.map((h) => h[k]));
    lifeRange = { x: span('x'), y: span('y'), z: span('z') };
    let run = 0;
    let best = 0;
    for (let i = 1; i < pre.length; i++) {
      const moved = Math.max(...Object.keys(pre[i].joints).map((n) => len(sub(v(pre[i].joints[n]), v(pre[i - 1].joints[n])))));
      run = moved < 0.0005 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    longestStillS = best / 60;
  }

  // Camera (E2): displacement between release and contact.
  const rel0 = frames.find((f) => f.gridT >= 0);
  let camMove = null;
  if (rel0?.camera && atContact.camera) {
    camMove = 0;
    for (const f of frames) if (f.gridT >= 0 && f.gridT <= contactT) camMove = Math.max(camMove, len(sub(v(f.camera.p), v(rel0.camera.p))));
  }

  const stanceWidth = hlen(sub(joint(stance, 'foot.L'), joint(stance, 'foot.R')));
  const baseAtContact = hlen(sub(joint(atContact, 'foot.L'), joint(atContact, 'foot.R')));
  return {
    caseId,
    physics: { contact: s.contact.kind, timing: s.contact.timing, timingErrorMs: r6(s.contact.timingErrorMs), exitBearingDeg: r6(s.contact.exitBearingDeg),
      exitElevationDeg: r6(s.contact.exitElevationDeg), batSpeedKph: r6(s.contact.batSpeedKph), runs: s.outcome.runs, dismissal: s.outcome.dismissal,
      footwork: s.footwork, contactT: r6(contactT) },
    presented: { traceContacts, feedbackContacts, matchesPhysics: presentedMatches(c.header.physicsContact.kind, traceContacts) },
    heroBundle: c.header.heroBundle, bones: c.header.bones, statureM: r6(H), frames: frames.length,
    stance: { widthAnkleM: r6(stanceWidth), widthOverStature: r6(stanceWidth / H), kneeFlexDeg: { front: r6(flexion(stance, 'L')), back: r6(flexion(stance, 'R')) },
      gripGapM: stance.gripGap ? { left: r6(stance.gripGap.left), right: r6(stance.gripGap.right) } : null,
      hipsYOverStature: r6(v(stance.hips).y / H), headY: r6(headAt(stance).y) },
    life: { hipsRangeM: lifeRange ? { x: r6(lifeRange.x), y: r6(lifeRange.y), z: r6(lifeRange.z) } : null, longestStillS: r6(longestStillS), framesConsidered: pre.length },
    contactFrame: { gridT: r6(atContact.gridT), offsetFromPhysicsMs: r6((atContact.gridT - contactT) * 1000),
      batGripErrorM: r6(batGripErr), batFaceErrorDeg: r6(batFaceErr), batFromVerticalDeg: atContact.bat ? r6(angle(v(atContact.bat.handleUp), { x: 0, y: 1, z: 0 })) : null,
      baseAnkleM: r6(baseAtContact), baseOverStature: r6(baseAtContact / H), kneeFlexDeg: { front: r6(flexion(atContact, 'L')), back: r6(flexion(atContact, 'R')) },
      elbowFlexDeg: { front: r6(elbowFlex(atContact, 'L')), back: r6(elbowFlex(atContact, 'R')) },
      headBehindFrontKneeM: r6(headBehindKnee), headY: r6(headAt(atContact).y) },
    batBall: { minClearanceM: Number.isFinite(minBallBat) ? r6(minBallBat) : null, atGridT: r6(minAt) },
    feedback: { batContactAtTimeline: feedbackBat ? r6(feedbackBat.atTimeline) : null, batContactSimTime: feedbackBat ? r6(feedbackBat.simulationTime) : null,
      deltaFromPhysicsMs: feedbackBat ? r6((feedbackBat.atTimeline - contactT) * 1000) : null },
    timeline: { backliftStartMs: rel(backliftStartIdx), topOfBackliftMs: rel(topIdx), frontFootLiftMs: rel(liftIdx), frontFootPlantMs: rel(plantIdx),
      batToePeakSpeedMs: rel(peakIdx), batToePeakSpeedMps: peakIdx !== null ? r6(toeSpeed[peakIdx]) : null, handsAtHeadHeightMs: handsAboveHeadMs },
    feet: { frontSlideAfterPlantM: r6(frontSlide), backFootTravelM: r6(backTravel), lowestFootJointY: r6(minFootY), maxFootLiftM: r6(maxFootLift) },
    head: { lateralInDownswingM: r6(headLat) },
    followThrough: { handsYMinusHeadY: r6(Math.max(joint(follow, 'wrist.L').y, joint(follow, 'wrist.R').y) - headAt(follow).y) },
    camera: { maxMoveReleaseToContactM: r6(camMove) },
  };
}

const named = [...byCase.keys()].filter((id) => !id.startsWith('sweep'));
const sweep = [...byCase.keys()].filter((id) => id.startsWith('sweep'));
const out = {
  schema: 'vande.cover-drive.p1.baseline-metrics.v1',
  classification: 'BUILDER_OBSERVATION_NON_HUMAN',
  scenarioId: summary.scenarioId,
  sourceCombinedSha256: summary.sourceCombinedSha256,
  cases: Object.fromEntries(named.map((id) => [id, caseMetrics(id)])),
  sweep: sweep.map((id) => {
    const m = caseMetrics(id);
    return m && { caseId: id, offsetMs: summaryByCase.get(id).offsetMs, physics: m.physics.contact, timing: m.physics.timing,
      presented: m.presented.traceContacts[0] ?? 'none', match: m.presented.matchesPhysics, minClearanceM: m.batBall.minClearanceM,
      exitBearingDeg: m.physics.exitBearingDeg, exitElevationDeg: m.physics.exitElevationDeg };
  }),
};
writeFileSync(path.join(runDir, 'baseline-metrics.json'), `${JSON.stringify(out, null, 1)}\n`);
process.stdout.write(`analysed ${named.length} named and ${sweep.length} sweep cases\n`);
