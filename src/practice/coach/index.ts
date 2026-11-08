/**
 * Exact-ball Coach Mode (docs/PRACTICE_COACH.md): the analysis of a delivery and the player's attempt, real
 * alternative responses simulated with the same physics, the dead-ball card's one insight, the comparison of repeated
 * attempts, mastery of the exact ball and the form report. Pure and deterministic; nothing here feeds the physics.
 */
export { analyzeBall, analyzeBallInSlices, clearCoachCache, coachTip, type SliceOptions } from './analyze';
export {
  faceOffLineDeg,
  praiseEarned,
  spokenAction,
  tipActionWords,
  tipFactWords,
  tipOf,
  tipSentence,
  tipWords,
  unwarnedRisks,
  whereOf,
  zonePhrases,
  type CoachTip,
  type TipAttempt,
  type TipFact,
  type TipMistake,
  type TipTranslator,
  type TipWhere,
} from './tip';
export { optionOf, PICK, worksAcrossSpread } from './options';
export { PRAISE_MIN_SPEED_SHARE, cleanByMeasure, requestedKph } from './quality';
export {
  AIM_CHANGE_DEG,
  IMPROVEMENTS,
  TIMING_CHANGE_MS,
  WELL_PLAYED_WITHIN_RUNS,
  attemptWorked,
  compareAttempts,
  metStandard,
  primaryInsight,
  recommendationFor,
  spreadValue,
  wellPlayed,
} from './insight';
export {
  MASTERY_RULE,
  MASTERY_SUCCESS_VERSION,
  isMastered,
  isMasteryState,
  masteryAttempt,
  masteryEvent,
  masteryKey,
  masteryProgress,
  nextStage,
  recordAttempt,
  startMastery,
  type MasteryProgress,
} from './mastery';
export {
  FORM_RULES,
  FORM_SAMPLE_VERSION,
  FORM_SKILLS,
  evidenceOf,
  formFromAttempts,
  formSample,
  isFormSample,
  type FormContext,
  type FormSample,
} from './form';
export { ATTACK_ARCS, ORTHODOXY } from './cricket';
export { GRID } from './candidates';
export { EXECUTION_SPREAD, FINALISTS } from './simulate';
export { FIELD_COVER } from './field';
export { READ_THRESHOLDS, type Mover } from './facts';
