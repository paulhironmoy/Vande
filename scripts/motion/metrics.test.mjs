/**
 * The naturalness metrics catch what they claim to (MOTION-SPEC §9): a pose pop, a joint beyond its limit and a
 * sliding planted foot each fail; a still, rested pose passes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePack, prepareClip } from './export.mjs';
import { EXPLOSIVE, GROUND_STEP_REPORT_ONLY, accelCap, jointViolation, measurePack } from './metrics.mjs';
import { BONE_COUNT, CONTACT } from './vmp.ts';

const ID = [0, 0, 0, 1];
function clip({ id = 'test_still', frames = 31, qAt = () => null, groundAt = () => [0, 0, 0], contacts = CONTACT.footL | CONTACT.footR } = {}) {
  const q = [];
  for (let f = 0; f < frames; f++) {
    const row = [];
    for (let b = 0; b < BONE_COUNT; b++) row.push(...(qAt(f, b) ?? ID));
    q.push(row);
  }
  return {
    format: 'VMS1', id, pack: 'test', role: 'any', skeleton: 'VC17', sampleRate: 30, loop: false, mirrorable: true, codec: 2,
    frames: { ground: Array.from({ length: frames }, (_, f) => groundAt(f)), hips: Array.from({ length: frames }, () => [0, 0, 0]), contacts: Array.from({ length: frames }, () => contacts), q },
  };
}
const measure = (src) => measurePack(encodePack([prepareClip(src)]))[0];
const axis = (x, y, z, deg) => {
  const h = (deg * Math.PI) / 360;
  const l = Math.hypot(x, y, z);
  return [(x / l) * Math.sin(h), (y / l) * Math.sin(h), (z / l) * Math.sin(h), Math.cos(h)];
};

test('a still rest pose with planted feet passes every gate', () => {
  const r = measure(clip());
  assert.equal(r.passAll, true, JSON.stringify(r.pass));
  assert.ok(r.footSlideM < 1e-6);
});

test('a pose pop (a 60-degree knee snap between two samples) fails the speed and acceleration gates', () => {
  const r = measure(clip({ id: 'test_pop', qAt: (f, b) => (b === 12 && f >= 15 ? axis(1, 0, 0, 60) : null) }));
  assert.equal(r.pass.angularSpeed, false);
  assert.equal(r.pass.angularAccel, false);
});

test('a knee bent backwards fails the joint limits', () => {
  assert.ok(jointViolation(12, axis(1, 0, 0, -20)));
  assert.equal(jointViolation(12, axis(1, 0, 0, 60)), null);
  const r = measure(clip({ id: 'test_hyper', qAt: (f, b) => (b === 12 ? axis(1, 0, 0, -20) : null) }));
  assert.equal(r.pass.joints, false);
});

test('a planted foot dragged 5 cm fails the foot-slide gate', () => {
  const r = measure(clip({ id: 'test_slide', groundAt: (f) => [0, (0.05 * f) / 30, 0] }));
  assert.equal(r.pass.slide, false);
  assert.ok(r.footSlideM > 0.04 && r.footSlideM < 0.06, `slide ${r.footSlideM}`);
});

test('the explosive class applies only to its listed clips and limbs', () => {
  assert.equal(accelCap(12, { name: 'loco_run' }), 650);
  assert.equal(accelCap(6, { name: 'loco_run' }), 300, 'arms of a run stay at 300');
  assert.equal(accelCap(6, { name: 'kp_dive_r' }), 650);
  assert.equal(accelCap(2, { name: 'kp_dive_r' }), 300, 'torso stays at 300');
  assert.equal(accelCap(12, { name: 'bowl_off' }), 300);
  assert.equal(accelCap(12, { name: 'fld_dive_stop_hypothetical' }), 300, 'no pattern matching');
  assert.ok(Object.keys(EXPLOSIVE).length >= 10);
});

test('the ground-step exemption applies only to its listed clips, and the step is still measured', () => {
  const fast = (id) => clip({ id, groundAt: (f) => [0, f < 15 ? 0 : ((f - 15) * 1.2) / 30, 0], contacts: 0 });
  const other = measure(fast('test_jump'));
  assert.equal(other.pass.groundSmooth, false);
  const src = fast('ns_turn');
  src.pack = 'test';
  const listed = measure(src);
  assert.equal(listed.pass.groundSmooth, true);
  assert.equal(listed.groundStepReportOnly, true);
  assert.ok(listed.groundSpeedStepMps > 0.15, 'still measured and reported');
  assert.ok('ns_turn_r' in GROUND_STEP_REPORT_ONLY);
});
