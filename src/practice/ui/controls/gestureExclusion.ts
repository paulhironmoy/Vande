/**
 * The system back gesture must never steal a stroke (CTR-05). On Android 10 and later an inward swipe from the left or
 * right screen edge is "Back", and a batting stroke that starts near an edge would become one. Only native code can ask
 * the system to leave those edges to the app (View.setSystemGestureExclusionRects), and only while batting: Practice
 * tells the native side when a delivery is under way or about to be, and where the batting surface is (the lower part of
 * the screen), and the native side applies the rectangles. See S/chase/requests/CONTROLS-3-to-ANDROID.md for the exact
 * native behaviour. On the web, in a build without the plugin and on older Android versions this does nothing.
 *
 * The bottom edge cannot be excluded by any app (Android's home and quick-switch gestures); the app's immersive mode is
 * what keeps a swipe there from leaving the game at once (the first swipe only reveals the bars).
 */
import { nativePlugin } from '@/platform/capacitor';

/** Share of the screen's height the batting surface covers, measured up from the bottom (GestureSurface's default). */
export const BATTING_HEIGHT_FRACTION = 0.46;

interface SystemGesturesPlugin {
  setBattingExclusion(options: { active: boolean; heightFraction: number }): Promise<void>;
}

let last: boolean | null = null;

/** Tells the native side whether the batting surface is in use. Repeats are dropped; failures are ignored (no plugin, no gesture). */
export async function setBattingGestureExclusion(active: boolean): Promise<void> {
  if (last === active) return;
  last = active;
  try {
    const box = await nativePlugin<SystemGesturesPlugin>('VandeSystemGestures');
    await box?.plugin.setBattingExclusion({ active, heightFraction: BATTING_HEIGHT_FRACTION });
  } catch {
    // A shell without the plugin keeps the system's own edge gestures; that is a known limit, not an error.
  }
}

/** Tests: forget what was last sent. */
export function resetBattingGestureExclusion(): void {
  last = null;
}
