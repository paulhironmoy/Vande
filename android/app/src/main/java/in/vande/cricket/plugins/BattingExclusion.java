package in.vande.cricket.plugins;

/**
 * The arithmetic behind the batting gesture exclusion (docs/PRACTICE_INPUT.md, request CONTROLS-3), free of Android types so plain JUnit
 * can test it. While a ball is being played the two side edges of the lower part of the screen are left to the app, so the system's
 * inward "Back" swipe cannot steal a batting stroke that starts there.
 */
final class BattingExclusion {
    /** The batting surface is never reported smaller than a fifth of the screen's height, nor larger than all of it. */
    static final double MIN_HEIGHT_FRACTION = 0.2;
    static final double MAX_HEIGHT_FRACTION = 1.0;
    /** Android counts at most 200 dp of exclusion height per edge, so each band stays within it. */
    static final int BAND_CAP_DP = 200;
    /** Wider than the widest Back-sensitivity zone the system offers. */
    static final int STRIP_DP = 96;

    private BattingExclusion() {}

    static boolean validHeightFraction(double heightFraction) {
        return !Double.isNaN(heightFraction) && heightFraction >= MIN_HEIGHT_FRACTION && heightFraction <= MAX_HEIGHT_FRACTION;
    }

    /**
     * The rectangles in the view's own pixels, each as {left, top, right, bottom}: the left and right edge strips of the lower
     * part of the screen. Empty for a size, density or fraction that makes no sense, so nothing is excluded by mistake.
     */
    static int[][] rectangles(int widthPx, int heightPx, float density, double heightFraction) {
        if (widthPx <= 0 || heightPx <= 0 || !(density > 0f) || !validHeightFraction(heightFraction)) return new int[0][];
        int bandHeight = (int) Math.min(Math.round(heightPx * heightFraction), Math.round(BAND_CAP_DP * (double) density));
        int top = heightPx - bandHeight;
        int stripWidth = (int) Math.min(Math.round(STRIP_DP * (double) density), widthPx / 3);
        return new int[][] {
            { 0, top, stripWidth, heightPx },
            { widthPx - stripWidth, top, widthPx, heightPx },
        };
    }
}
