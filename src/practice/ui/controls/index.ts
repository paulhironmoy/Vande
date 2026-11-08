/**
 * src/practice/ui/controls: "How do you want to bat?" (the owner's second brief, section 4). The compact row on the
 * setup screen until a device has answered (never a screen of its own, R-20), the quiet places to change it between
 * balls, the rules behind them and the seam to the camera's screens. See state.ts for what depends on the choice.
 * Other modules that only need the choice itself (the camera's screens) import from ./state and ./model directly.
 */
export { ControlRow } from './ControlRow';
export { ControlChip, ControlSetting } from './ControlSection';
export { setBattingGestureExclusion } from './gestureExclusion';
export { acceptDefaultControl, startControls, subscribeControl } from './state';
