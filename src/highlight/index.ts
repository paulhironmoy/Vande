/**
 * Highlight composer: the official Short (render.html, `window.__vcHighlight`) and the in-app preview that plays the
 * same cut. Lazy-load this module; it pulls in the 3D renderer.
 */
export { HighlightPreview, type HighlightPreviewProps } from './HighlightPreview';
export { createHighlightHost, type HighlightHost, type HighlightHostOptions } from './host';
export { planHighlight, sceneAt, FPS, MIN_MS, MAX_MS, type HighlightPlan, type Scene } from './plan';
