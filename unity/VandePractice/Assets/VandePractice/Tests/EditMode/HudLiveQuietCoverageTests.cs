using NUnit.Framework;
using UnityEngine;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// EVAL-WORLD M5 (U-H4): the live Delivery Quiet Mode rail (score, compact one-line conditions indicator, field
    /// radar and pause) covers at most 8% of the screen at 100% text on every required viewport, measured the way
    /// EVAL-WORLD measured it (ProductionHudLayout.Calculate at 160 dpi x DPR, full-screen safe area).
    /// </summary>
    public sealed class HudLiveQuietCoverageTests
    {
        [TestCase(640, 360, 2f)]
        [TestCase(844, 390, 2f)]
        [TestCase(844, 390, 3f)]
        [TestCase(915, 412, 2f)]
        [TestCase(1280, 800, 1f)]
        [TestCase(1920, 1080, 1f)]
        public void LiveQuietRail_StaysWithinEightPercentAtFullTextSize(int cssWidth, int cssHeight, float dpr)
        {
            var width = Mathf.RoundToInt(cssWidth * dpr);
            var height = Mathf.RoundToInt(cssHeight * dpr);
            var layout = ProductionHudLayout.Calculate(width, height, new Rect(0, 0, width, height), 160f * dpr, 1f);
            var coverage = layout.LiveQuietRailCoverage(width, height);
            TestContext.Out.WriteLine("VANDE_HUD_M5 " + cssWidth + "x" + cssHeight + "@" + dpr + " coverage=" +
                                      coverage.ToString("0.0000"));
            Assert.That(coverage, Is.LessThanOrEqualTo(0.08f), cssWidth + "x" + cssHeight + "@" + dpr);
            Assert.That(layout.ConditionsQuiet.height, Is.LessThan(layout.Conditions.height));
            Assert.That(layout.ConditionsQuiet.yMax, Is.EqualTo(layout.Conditions.yMax).Within(0.001f),
                "the compact indicator stays docked under the score");
            Assert.That(layout.ConditionsQuiet.xMin, Is.EqualTo(layout.Conditions.xMin).Within(0.001f));
        }

        [TestCase(640, 360, 2f)]
        [TestCase(844, 390, 3f)]
        [TestCase(915, 412, 2f)]
        public void LiveQuietRail_AtDoubleTextKeepsTheOneLineFloorAndReportsCoverage(int cssWidth, int cssHeight, float dpr)
        {
            var width = Mathf.RoundToInt(cssWidth * dpr);
            var height = Mathf.RoundToInt(cssHeight * dpr);
            var full = ProductionHudLayout.Calculate(width, height, new Rect(0, 0, width, height), 160f * dpr, 1f);
            var doubled = ProductionHudLayout.Calculate(width, height, new Rect(0, 0, width, height), 160f * dpr, 2f);
            var coverage = doubled.LiveQuietRailCoverage(width, height);
            TestContext.Out.WriteLine("VANDE_HUD_M5_200 " + cssWidth + "x" + cssHeight + "@" + dpr + " coverage=" +
                                      coverage.ToString("0.0000"));
            // At 200% text the one line must be at least as tall as at 100% (text floors are never traded away).
            Assert.That(doubled.ConditionsQuiet.height, Is.GreaterThanOrEqualTo(full.ConditionsQuiet.height - 0.001f));
        }
    }
}
