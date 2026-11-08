package in.vande.cricket.plugins;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class BattingExclusionTest {
    @Test
    public void aPhoneInLandscapeGetsTwoEdgeStripsOverTheLowerBandCappedAt200Dp() {
        // 2400 x 1080 px at 2.625 density (420 dpi): 46% of the height is 497 px, below the 525 px (200 dp) cap.
        int[][] rects = BattingExclusion.rectangles(2400, 1080, 2.625f, 0.46);
        assertEquals(2, rects.length);
        assertArrayEquals(new int[] { 0, 583, 252, 1080 }, rects[0]);
        assertArrayEquals(new int[] { 2148, 583, 2400, 1080 }, rects[1]);
    }

    @Test
    public void theBandNeverExceeds200DpWhateverTheFraction() {
        int[][] rects = BattingExclusion.rectangles(2400, 1080, 2.625f, 1.0);
        assertEquals(1080 - 525, rects[0][1]);
        assertEquals(525, rects[0][3] - rects[0][1]);
        assertEquals(525, rects[1][3] - rects[1][1]);
    }

    @Test
    public void aTallScreenKeepsTheFractionWhenItIsBelowTheCap() {
        // 1080 x 2400 px at 2.625: 20% of 2400 is 480 px, below 525.
        int[][] rects = BattingExclusion.rectangles(1080, 2400, 2.625f, 0.2);
        assertEquals(2400 - 480, rects[0][1]);
        assertEquals(2400, rects[0][3]);
    }

    @Test
    public void stripsAreNeverWiderThanAThirdOfTheScreen() {
        int[][] rects = BattingExclusion.rectangles(240, 400, 3f, 0.5);
        assertEquals(80, rects[0][2]);
        assertEquals(160, rects[1][0]);
        assertEquals(240, rects[1][2]);
    }

    @Test
    public void theTwoStripsAreMirrorImagesAndShareTheSameBand() {
        int[][] rects = BattingExclusion.rectangles(2340, 1080, 2.75f, 0.46);
        assertEquals(rects[0][2] - rects[0][0], rects[1][2] - rects[1][0]);
        assertEquals(rects[0][1], rects[1][1]);
        assertEquals(rects[0][3], rects[1][3]);
        assertEquals(2340, rects[1][2]);
    }

    @Test
    public void anUnusableFractionSizeOrDensityExcludesNothing() {
        assertEquals(0, BattingExclusion.rectangles(2400, 1080, 2.625f, 0.19).length);
        assertEquals(0, BattingExclusion.rectangles(2400, 1080, 2.625f, 1.01).length);
        assertEquals(0, BattingExclusion.rectangles(2400, 1080, 2.625f, Double.NaN).length);
        assertEquals(0, BattingExclusion.rectangles(0, 1080, 2.625f, 0.46).length);
        assertEquals(0, BattingExclusion.rectangles(2400, -1, 2.625f, 0.46).length);
        assertEquals(0, BattingExclusion.rectangles(2400, 1080, 0f, 0.46).length);
    }

    @Test
    public void acceptsExactlyTheFractionsFromAFifthToWholeScreen() {
        assertTrue(BattingExclusion.validHeightFraction(0.2));
        assertTrue(BattingExclusion.validHeightFraction(0.46));
        assertTrue(BattingExclusion.validHeightFraction(1.0));
        assertFalse(BattingExclusion.validHeightFraction(0.199));
        assertFalse(BattingExclusion.validHeightFraction(1.001));
        assertFalse(BattingExclusion.validHeightFraction(Double.NaN));
    }
}
