using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Bridge contract v7, the Unity side of the Target Chase HUD. (1) The words: every string Unity prints for the chase equals the
    /// string the web prints from the same COPY sheet (tests/fixtures/unity-practice/chase-copy.json is written by the web's own
    /// formatter). (2) The rail: the line "Need 14 off 9 balls" sits in the existing conditions rail, inside its rect, at 100% and
    /// 200% text in English, Hindi and Hinglish, with the same size floors as the Practice copy, in the same place (no rect moves,
    /// so nothing enters the delivery corridor). Geometry and state only: not a human readability or device result.
    /// </summary>
    public sealed class ChaseHudTests
    {
        private GameObject owner;
        private ProductionHudView view;

        [TearDown]
        public void TearDown()
        {
            if (owner != null) UnityEngine.Object.DestroyImmediate(owner);
        }

        // ---- the words ---------------------------------------------------------------------------------------------------

        private static CopyFixture copy;

        private static CopyFixture Copy()
        {
            if (copy != null) return copy;
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "chase-copy.json"));
            copy = JsonUtility.FromJson<CopyFixture>(File.ReadAllText(path));
            return copy;
        }

        private static string LocaleOf(string id)
        {
            return id == "en" ? "en-IN" : id;
        }

        [Test]
        public void GeneratedData_AndFixture_ComeFromTheSameCopySheet()
        {
            Assert.That(ProductionHudChaseCopyData.SourceSha256, Is.EqualTo(Copy().sourceSha256),
                "ProductionHudChaseCopy.Generated.cs and chase-copy.json were generated from different COPY sheets: regenerate both");
            Assert.That(Copy().languages, Has.Length.EqualTo(3));
        }

        [Test]
        public void EveryChaseString_EqualsWhatTheWebPrints_InEnglishHindiAndHinglish()
        {
            var compared = 0;
            foreach (var language in Copy().languages)
            {
                var locale = LocaleOf(language.id);
                Assert.That(ProductionHudChaseCopy.Status(locale), Is.EqualTo(language.status), language.id + " status");
                foreach (var item in language.need)
                {
                    Assert.That(ProductionHudChaseCopy.Need(item.runs, item.balls, locale), Is.EqualTo(item.text),
                        language.id + " need " + item.runs + " off " + item.balls);
                    compared++;
                }

                foreach (var item in language.rate)
                {
                    Assert.That(ProductionHudChaseCopy.Rate(item.x100, locale), Is.EqualTo(item.text), language.id + " rate " + item.x100);
                    compared++;
                }

                Assert.That(ProductionHudChaseCopy.WonTitle(locale), Is.EqualTo(language.wonTitle), language.id + " won title");
                foreach (var item in language.wonSpare)
                {
                    Assert.That(ProductionHudChaseCopy.WonSpare(item.left, locale), Is.EqualTo(item.text), language.id + " spare " + item.left);
                    compared++;
                }

                foreach (var item in language.lostTitle)
                {
                    Assert.That(ProductionHudChaseCopy.LostTitle(item.@short, locale), Is.EqualTo(item.text), language.id + " short " + item.@short);
                    compared++;
                }
            }

            Assert.That(compared, Is.GreaterThan(150));
        }

        [Test]
        public void RateDigits_EqualTheWebsOneDecimal_ForEveryRateOfATwelveBallChase()
        {
            var fixture = Copy();
            Assert.That(fixture.rateX100, Has.Length.EqualTo(fixture.rateText.Length));
            Assert.That(fixture.rateX100.Length, Is.GreaterThan(500));
            for (var index = 0; index < fixture.rateX100.Length; index++)
                Assert.That(ProductionHudChaseCopy.RateDigits(fixture.rateX100[index]), Is.EqualTo(fixture.rateText[index]), "rate " + fixture.rateX100[index]);
        }

        [Test]
        public void Headline_AndDetail_FollowTheVerdict()
        {
            var locale = "en-IN";
            var inProgress = Chase(PracticeChaseOutcome.InProgress, 14, 9, 933);
            Assert.That(ProductionHudChaseCopy.Headline(inProgress, locale), Is.EqualTo(ProductionHudChaseCopy.Need(14, 9, locale)));
            Assert.That(ProductionHudChaseCopy.Detail(inProgress, locale), Is.EqualTo(ProductionHudChaseCopy.Rate(933, locale)));
            var won = Chase(PracticeChaseOutcome.Won, 0, 3, null);
            Assert.That(ProductionHudChaseCopy.Headline(won, locale), Is.EqualTo(ProductionHudChaseCopy.WonTitle(locale)));
            Assert.That(ProductionHudChaseCopy.Detail(won, locale), Is.EqualTo(ProductionHudChaseCopy.WonSpare(3, locale)));
            var lost = Chase(PracticeChaseOutcome.LostWicket, 6, 7, null);
            Assert.That(ProductionHudChaseCopy.Headline(lost, locale), Is.EqualTo(ProductionHudChaseCopy.LostTitle(6, locale)));
            Assert.That(ProductionHudChaseCopy.Detail(lost, locale), Is.Empty, "a lost chase has no second line");
            Assert.That(ProductionHudChaseCopy.Headline(Chase(PracticeChaseOutcome.LostBalls, 5, 0, null), locale),
                Is.EqualTo(ProductionHudChaseCopy.LostTitle(5, locale)), "balls out reads like a wicket: the runs still short");
        }

        // ---- the rail ----------------------------------------------------------------------------------------------------

        [Test]
        public void Rail_SpeaksTheChase_InsideTheSameRect_AtOneAndTwoHundredPercent_InEveryLocale(
            [Values("en-IN", "hi", "hi-Latn", "bn")] string locale,
            [Values(1f, 2f)] float textScale,
            [Values(0, 1, 2)] int viewportCase)
        {
            var (width, height, safe) = Viewport(viewportCase);
            Build(locale, width, height, safe, textScale, null);
            view.SetDelivery(0, 3);
            var practiceRail = view.ConditionsRailPixels;
            var practiceText = view.ConditionsText;
            var practiceSize = HudLabelProbe.FontSize(HudLabelProbe.Label(owner, "Conditions Text"));

            foreach (var chase in new[]
                     {
                         Chase(PracticeChaseOutcome.InProgress, 14, 9, 933),
                         Chase(PracticeChaseOutcome.InProgress, 72, 12, 3600),
                         Chase(PracticeChaseOutcome.Won, 0, 11, null),
                         Chase(PracticeChaseOutcome.LostWicket, 22, 10, null),
                     })
            {
                view.SetChase(chase);
                var text = view.ConditionsText;
                Assert.That(text, Does.StartWith(ProductionHudChaseCopy.Headline(chase, locale)), "the first line says it");
                Assert.That(text, Does.Contain("\n"), "two explicit lines, as in Practice");
                Assert.That(view.ConditionsRailPixels, Is.EqualTo(practiceRail), "no rect moves: the rail stays where Practice puts it");
                var label = HudLabelProbe.Label(owner, "Conditions Text");
                var textRect = HudLabelProbe.TextRect(label);
                Assert.That(HudLabelProbe.Visible(label), Is.True);
                AssertInside(textRect, view.CurrentLayout.Conditions, chase.Outcome + " " + chase.RunsNeeded, locale, textScale, viewportCase);
                // The same floors the Practice copy meets (HudUiToolkitRailTests): at 100% the copy keeps its requested size; at 200% it is
                // never below the rail's own growth, 1.35x the 100% size.
                var requested = ProductionHudLayout.ConditionsFontDp * view.CurrentLayout.DpScale * textScale;
                var size = HudLabelProbe.FontSize(label);
                var detail = "chase copy size " + size + " requested " + requested + " (Practice copy " + practiceSize + "; " + locale + " " +
                             textScale + "x, viewport " + viewportCase + "): " + text;
                if (textScale <= 1f) Assert.That(size, Is.EqualTo(requested).Within(0.01f), detail);
                else Assert.That(size, Is.GreaterThanOrEqualTo(requested * 1.35f / textScale - 0.01f), detail);
            }

            view.SetChase(null);
            Assert.That(view.ConditionsText, Is.EqualTo(practiceText), "clearing the chase restores the Practice rail exactly");
        }

        [Test]
        public void Rail_InDeliveryQuietMode_KeepsOnlyTheFirstLine()
        {
            Build("en-IN", 844, 390, new Rect(0f, 0f, 844f, 390f), 1f, Chase(PracticeChaseOutcome.InProgress, 14, 9, 933));
            view.SetDelivery(0, 3);
            view.SetQuiet(true);
            Assert.That(view.ConditionsRailText, Is.EqualTo("Need 14 off 9 balls"));
            view.SetQuiet(false);
            Assert.That(view.ConditionsText, Does.StartWith("Need 14 off 9 balls\n9.3 an over"));
        }

        [Test]
        public void SceneWithAChase_ShowsItAtOnce_AndAResultAtTheDeadBallUpdatesIt()
        {
            Build("en-IN", 844, 390, new Rect(0f, 0f, 844f, 390f), 1f, Chase(PracticeChaseOutcome.InProgress, 22, 12, 1100));
            Assert.That(view.Chase, Is.Not.Null, "the scene carried the start of the chase");
            Assert.That(view.ConditionsText, Does.StartWith("Need 22 off 12 balls\n11.0 an over"));
            view.SetChase(Chase(PracticeChaseOutcome.InProgress, 18, 11, 982));
            Assert.That(view.ConditionsText, Does.StartWith("Need 18 off 11 balls\n9.8 an over"));
            view.SetChase(Chase(PracticeChaseOutcome.Won, 0, 2, null));
            // The setup affordance joins whichever line stays narrower, so the verdict line may carry it: assert the words, not the join.
            Assert.That(view.ConditionsText, Does.StartWith("Target reached"));
            Assert.That(view.ConditionsText, Does.Contain("\n2 balls to spare."));
            view.SetChase(Chase(PracticeChaseOutcome.LostBalls, 4, 0, null));
            Assert.That(view.ConditionsText, Does.StartWith("4 runs short"));
            Assert.That(view.ConditionsText, Does.Contain("\n"), "still two lines: the second holds the setup affordance");
        }

        [Test]
        public void SetupBrief_NamesTheChase_AndAPracticeBriefIsUnchanged()
        {
            Build("en-IN", 844, 390, new Rect(0f, 0f, 844f, 390f), 1f, null);
            var practice = view.SetupBriefText;
            Assert.That(practice, Does.StartWith("Practice"));
            view.SetChase(Chase(PracticeChaseOutcome.InProgress, 22, 12, 1100));
            Assert.That(view.SetupBriefText, Does.StartWith("Chase"));
            view.SetChase(null);
            Assert.That(view.SetupBriefText, Is.EqualTo(practice));
        }

        // ---- helpers -----------------------------------------------------------------------------------------------------

        private static PracticeChasePresentation Chase(PracticeChaseOutcome outcome, int runsNeeded, int ballsLeft, int? rate)
        {
            return new PracticeChasePresentation
            {
                Target = 22,
                MaxBalls = 12,
                RunsNeeded = runsNeeded,
                BallsLeft = ballsLeft,
                Outcome = outcome,
                RequiredRateX100 = rate
            };
        }

        private void Build(string locale, int width, int height, Rect safe, float textScale, PracticeChasePresentation chase)
        {
            owner = new GameObject("Chase HUD");
            view = owner.AddComponent<ProductionHudView>();
            view.SetViewportForTesting(width, height, safe, 160f);
            view.Configure(new PracticePresentationSettings
            {
                Locale = locale,
                Quality = PracticePresentationQuality.Standard,
                Assistance = "play",
                Handedness = "right",
                ReducedMotion = false,
                Captions = true,
                Audio = true,
                Haptics = true
            });
            var scene = Scene();
            scene.Chase = chase;
            view.SetScene(scene);
            view.SetTextScale(textScale);
        }

        private static (int width, int height, Rect safe) Viewport(int index)
        {
            switch (index)
            {
                case 0: return (844, 390, new Rect(0f, 0f, 844f, 390f));
                case 1: return (915, 412, new Rect(44f, 20f, 847f, 372f));
                default: return (640, 360, new Rect(0f, 0f, 640f, 360f));
            }
        }

        private static void AssertInside(Rect value, Rect container, string what, string locale, float scale, int viewport)
        {
            const float tolerance = 1f;
            var label = what + " (" + locale + ", " + (scale * 100f) + "%, viewport " + viewport + "): " + value + " in " + container;
            Assert.That(value.xMin, Is.GreaterThanOrEqualTo(container.xMin - tolerance), label);
            Assert.That(value.yMin, Is.GreaterThanOrEqualTo(container.yMin - tolerance), label);
            Assert.That(value.xMax, Is.LessThanOrEqualTo(container.xMax + tolerance), label);
            Assert.That(value.yMax, Is.LessThanOrEqualTo(container.yMax + tolerance), label);
        }

        private static PracticeScenePresentation Scene()
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
            {
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder-" + index,
                    Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder",
                    X = -45d + index * 9d,
                    Z = -38d + index * 7d
                };
            }

            return new PracticeScenePresentation
            {
                Conditions = "green",
                BowlerFamily = "pace",
                BowlerArm = "right",
                BowlerPaceBand = "fast",
                BallColour = "white",
                BallAge = "new",
                FieldIntent = "attack_the_stumps",
                TrainingObjective = "random",
                Handedness = "right",
                BatterLateralM = 0.2d,
                BatterCreaseOffsetM = 0.1d,
                Fielders = fielders
            };
        }

        // ---- fixture shape (JsonUtility) ----------------------------------------------------------------------------------

        [Serializable] private sealed class CopyFixture
        {
            public string sourceSha256;
            public CopyLanguage[] languages;
            public int[] rateX100;
            public string[] rateText;
        }

        [Serializable] private sealed class CopyLanguage
        {
            public string id;
            public string status;
            public NeedRow[] need;
            public RateRow[] rate;
            public string wonTitle;
            public SpareRow[] wonSpare;
            public ShortRow[] lostTitle;
        }

        [Serializable] private sealed class NeedRow
        {
            public int runs;
            public int balls;
            public string text;
        }

        [Serializable] private sealed class RateRow
        {
            public int x100;
            public string text;
        }

        [Serializable] private sealed class SpareRow
        {
            public int left;
            public string text;
        }

        [Serializable] private sealed class ShortRow
        {
            public int @short;
            public string text;
        }
    }
}
