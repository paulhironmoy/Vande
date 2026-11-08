/** The Director (P1: seeds, plan, trace, head-in-space and gaze, eyes, lids, breath and sway; P2: the stage binding). Import from here. */
export { CH, CHANNELS, SCALE, createOut } from './channels';
export { detailForPx, prepare, sample, sampleWrapped, startPrepare } from './director';
export type { PlanJob } from './director';
export { FACE, FRAME, frameBegin } from './stage/face';
export { AMP, DRAW } from './plan';
export { applyHead, applyLife, eyesFor, turnHead, EYEBALL_R } from './stage/pose';
export { DirectorRuntime } from './stage/runtime';
export type { DirectorScriptKind } from './stage/runtime';
export { ballKey, deliveryTakeKey, fnv1a32, mix, personKey, u01 } from './seeds';
export type { AimTarget, Detail, DirectorAnchors, DirectorEvents, DirectorPlan, Role } from './types';
