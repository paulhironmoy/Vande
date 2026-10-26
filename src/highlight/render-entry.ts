/**
 * render.html entry: exposes the HighlightRenderHost as `window.__vcHighlight` for the platform's render service,
 * which loads a validated replay, then draws and captures every frame (1080x1920, 30 fps). Web builds only.
 */
import '@fontsource-variable/manrope';
import './fonts.css';
import { createHighlightHost } from './host';

declare global {
  interface Window {
    __vcHighlight?: ReturnType<typeof createHighlightHost>;
  }
}

const canvas = document.getElementById('highlight') as HTMLCanvasElement | null;
if (canvas) window.__vcHighlight = createHighlightHost({ canvas });
