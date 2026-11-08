using System;
using System.Collections.Generic;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;
using Ch = Vande.Practice.Presentation.Production.Director.DirectorChannels;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// Fidgets, reactions and the bake's own cost, ported from the web tests (fidget.test.ts, the reaction tests, cost.test.ts) with
    /// their thresholds: the people shift their weight, adjust their stance, roll their shoulders, sigh and glance to the side between
    /// balls; the batter reacts to the outcome in proportion and with the sign of the news, no sooner than outcomeAt + a seeded
    /// 180 to 380 ms; and a slice of the bake allocates nothing. Builder measurements, never a player's or an evaluator's result.
    /// </summary>
    public sealed class DirectorLifeTests
    {
        private static readonly int[] Body = { Ch.SwayX, Ch.SwayZ, Ch.SwayRoll, Ch.Posture, Ch.Twist, Ch.Breath };

        private static DirectorPlan IdlePlan(DirectorRole role, string key, double ms, string person = "look-1", bool reducedMotion = false)
        {
            DirectorAnchors a = TestAnchors.Idle(role, key, ms, person, reducedMotion);
            a.HeadMode = DirectorHeadMode.Space;
            return DirectorCore.Prepare(a, 60);
        }

        private static double Quantile(List<double> xs, double q)
        {
            double[] a = xs.ToArray();
            Array.Sort(a);
            double p = (a.Length - 1) * q;
            int lo = (int)Math.Floor(p);
            return a[lo] + (a[Math.Min(a.Length - 1, lo + 1)] - a[lo]) * (p - lo);
        }

        [TestCase(true)]
        [TestCase(false)]
        public void Fidgets_AFewAMinute_OfEveryKind_Small_DifferentEveryBall_AndTheSameOnAReplay(bool striker)
        {
            DirectorRole role = striker ? DirectorRole.Striker : DirectorRole.Bowler;
            var perMin = new List<double>();
            var kinds = new int[4];
            var first = new HashSet<int>();
            double swayX = 0, swayZ = 0, roll = 0, posture = 0, twist = 0;
            for (int s = 0; s < 120; s++)
            {
                DirectorPlan p = IdlePlan(role, "fid#" + s, 60000, "look-" + (s % 9));
                int n = p.Fidget.Length / DirectorPlanBuilder.FidgetN;
                perMin.Add(n);
                if (n > 0) first.Add((int)Math.Round(p.Fidget[0] / 10.0, MidpointRounding.AwayFromZero));
                for (int m = 0; m < n; m++) kinds[(int)p.Fidget[m * DirectorPlanBuilder.FidgetN + 1]]++;
                // events are in time order and finish before the loop's seam
                for (int m = 1; m < n; m++) Assert.That(p.Fidget[m * 8], Is.GreaterThan(p.Fidget[(m - 1) * 8] + p.Fidget[(m - 1) * 8 + 2]));
                if (n > 0) Assert.That(p.Fidget[(n - 1) * 8] + p.Fidget[(n - 1) * 8 + 2], Is.LessThan(60000 - 4000));
                for (int i = 0; i < p.N; i++)
                {
                    swayX = Math.Max(swayX, Math.Abs(DirectorTestKit.Val(p, i, Ch.SwayX)));
                    swayZ = Math.Max(swayZ, Math.Abs(DirectorTestKit.Val(p, i, Ch.SwayZ)));
                    roll = Math.Max(roll, Math.Abs(DirectorTestKit.Val(p, i, Ch.SwayRoll)));
                    posture = Math.Max(posture, Math.Abs(DirectorTestKit.Val(p, i, Ch.Posture)));
                    twist = Math.Max(twist, Math.Abs(DirectorTestKit.Val(p, i, Ch.Twist)));
                }
                if (s < 10)
                {
                    DirectorPlan again = IdlePlan(role, "fid#" + s, 60000, "look-" + (s % 9));
                    Assert.That(DirectorTestKit.FloatsEqual(again.Fidget, p.Fidget), Is.True);
                    Assert.That(DirectorTestKit.TraceEquals(again, p), Is.True);
                }
            }
            Assert.That(Quantile(perMin, 0.05), Is.GreaterThanOrEqualTo(4));
            Assert.That(Quantile(perMin, 0.95), Is.LessThanOrEqualTo(16));
            foreach (int k in kinds) Assert.That(k, Is.GreaterThan(40), "every kind turns up");
            Assert.That(first.Count, Is.GreaterThan(100), "different balls give different first fidgets");
            Assert.That(swayX, Is.LessThanOrEqualTo(34), "a weight shift is centimetres at most");
            Assert.That(swayZ, Is.LessThanOrEqualTo(20));
            Assert.That(roll, Is.LessThanOrEqualTo(5));
            Assert.That(posture, Is.LessThanOrEqualTo(5));
            Assert.That(twist, Is.LessThanOrEqualTo(6));
        }

        [Test]
        public void Fidgets_TheBowlerFidgetsOnlyBetweenBalls_TheStrikerWaitsWithAFewUntilOneSecondBeforeTheRelease()
        {
            var r = new TestRng(11);
            int strikerFidgets = 0;
            for (int k = 0; k < 100; k++)
            {
                var d = new TestDelivery(r.RandomSpec(), 7000);
                foreach (DirectorRole role in new[] { DirectorRole.Striker, DirectorRole.Bowler })
                {
                    DirectorAnchors a = TestAnchors.For(d, role, DirectorSeeds.DeliveryTakeKey("fid-del", 0, k));
                    DirectorPlan p = DirectorCore.Prepare(a, 60);
                    if (role == DirectorRole.Bowler) Assert.That(p.Fidget.Length, Is.EqualTo(0));
                    else
                    {
                        for (int m = 0; m < p.Fidget.Length / 8; m++)
                        {
                            strikerFidgets++;
                            Assert.That(p.Fidget[m * 8] + p.Fidget[m * 8 + 2], Is.LessThanOrEqualTo(d.Timeline.Release - 1000));
                        }
                    }
                }
            }
            Assert.That(strikerFidgets, Is.GreaterThan(0));
        }

        [Test]
        public void Fidgets_InReducedMotionEveryBodyChannelIsExactlyZero_AndNothingGlancesToTheSide()
        {
            foreach (DirectorRole role in new[] { DirectorRole.Striker, DirectorRole.Bowler })
            {
                int sides = 0, sidesNormal = 0;
                for (int s = 0; s < 40; s++)
                {
                    DirectorPlan rm = IdlePlan(role, "rm#" + s, 60000, "look-1", true);
                    DirectorPlan norm = IdlePlan(role, "rm#" + s, 60000);
                    for (int i = 0; i < rm.N; i++) foreach (int c in Body) Assert.That(rm.Trace[i * Ch.Count + c], Is.EqualTo(0));
                    for (int m = 0; m < rm.Fix.Length / 5; m++) if (rm.Fix[m * 5 + 1] == DirectorPlanBuilder.TargetSide) sides++;
                    for (int m = 0; m < norm.Fix.Length / 5; m++) if (norm.Fix[m * 5 + 1] == DirectorPlanBuilder.TargetSide) sidesNormal++;
                }
                Assert.That(sides, Is.EqualTo(0));
                Assert.That(sidesNormal, Is.GreaterThan(10), "and in normal motion they do happen");
            }
        }

        [Test]
        public void Fidgets_AFidgetIsABell_NoChannelMovesMoreInOne60HzFrameThanAQuickHumanMoveWould()
        {
            double swayX = 0, swayZ = 0, roll = 0, posture = 0, twist = 0;
            for (int s = 0; s < 30; s++)
            {
                DirectorPlan p = IdlePlan(DirectorRole.Striker, "bell#" + s, 60000);
                for (int i = 1; i < p.N; i++)
                {
                    swayX = Math.Max(swayX, Math.Abs(DirectorTestKit.Val(p, i, Ch.SwayX) - DirectorTestKit.Val(p, i - 1, Ch.SwayX)));
                    swayZ = Math.Max(swayZ, Math.Abs(DirectorTestKit.Val(p, i, Ch.SwayZ) - DirectorTestKit.Val(p, i - 1, Ch.SwayZ)));
                    roll = Math.Max(roll, Math.Abs(DirectorTestKit.Val(p, i, Ch.SwayRoll) - DirectorTestKit.Val(p, i - 1, Ch.SwayRoll)));
                    posture = Math.Max(posture, Math.Abs(DirectorTestKit.Val(p, i, Ch.Posture) - DirectorTestKit.Val(p, i - 1, Ch.Posture)));
                    twist = Math.Max(twist, Math.Abs(DirectorTestKit.Val(p, i, Ch.Twist) - DirectorTestKit.Val(p, i - 1, Ch.Twist)));
                }
            }
            Assert.That(swayX, Is.LessThan(3.5), "mm a frame: 210 mm/s");
            Assert.That(swayZ, Is.LessThan(2.5));
            Assert.That(roll, Is.LessThan(0.3), "deg a frame: 18 deg/s");
            Assert.That(posture, Is.LessThan(0.4));
            Assert.That(twist, Is.LessThan(0.7));
        }

        // ------------------------------------------------------------------------------------------------ the reaction

        private static readonly string[] Categories = { "six", "four", "runs", "dot", "leave", "close_call", "wicket" };

        private static DirectorAnchors WithOutcome(DirectorAnchors a, string outcome, double? outcomeAt)
        {
            DirectorAnchors b = a.Clone();
            b.Outcome = outcome;
            b.OutcomeAt = outcomeAt;
            return b;
        }

        private static double FirstDiff(DirectorPlan a, DirectorPlan b)
        {
            for (int i = 0; i < Math.Min(a.N, b.N); i++)
                for (int c = 0; c < Ch.Count; c++)
                    if (a.Trace[i * Ch.Count + c] != b.Trace[i * Ch.Count + c]) return DirectorTestKit.TimeOf(a, i);
            return double.PositiveInfinity;
        }

        [Test]
        public void Reaction_BeginsAtOutcomeAtPlusTheSeeded180To380Ms_ForEveryOutcome_AndNotAFrameSooner()
        {
            var r = new TestRng(41);
            double minOnset = double.MaxValue, maxOnset = double.MinValue;
            for (int k = 0; k < 120; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                DirectorAnchors baseA = TestAnchors.For(d, DirectorRole.Striker, DirectorSeeds.DeliveryTakeKey("react", 0, k));
                double at = d.Timeline.OutcomeAt;
                DirectorPlan reference = DirectorCore.Prepare(WithOutcome(baseA, "dot", at), 60);
                foreach (string o in Categories)
                {
                    if (o == "dot") continue;
                    DirectorPlan plan = DirectorCore.Prepare(WithOutcome(baseA, o, at), 60);
                    double t = FirstDiff(reference, plan);
                    double lag = reference.Draw[DirectorDraw.ReactionMs];
                    Assert.That(lag, Is.InRange(180.0, 380.0));
                    Assert.That(t, Is.GreaterThanOrEqualTo(at + 180), o + " #" + k);
                    Assert.That(t, Is.LessThanOrEqualTo(at + lag + 1000.0 / 60 * 3), o + " #" + k);
                    minOnset = Math.Min(minOnset, t - at);
                    maxOnset = Math.Max(maxOnset, t - at);
                }
            }
            Assert.That(minOnset, Is.GreaterThanOrEqualTo(180));
            Assert.That(maxOnset, Is.LessThanOrEqualTo(380 + 60));
        }

        [Test]
        public void Reaction_ALivePlanWithNoOutcomeAndOneWithAnOutcomeAgreeUntilTheReactionStarts()
        {
            var r = new TestRng(43);
            for (int k = 0; k < 40; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                DirectorAnchors baseA = TestAnchors.For(d, DirectorRole.Striker, "react-live#" + k);
                DirectorPlan live = DirectorCore.Prepare(WithOutcome(baseA, null, null), 60);
                DirectorPlan done = DirectorCore.Prepare(WithOutcome(baseA, "wicket", d.Timeline.OutcomeAt), 60);
                Assert.That(live.React.Length, Is.EqualTo(0));
                Assert.That(done.React.Length, Is.GreaterThan(0));
                Assert.That(FirstDiff(live, done), Is.GreaterThanOrEqualTo(d.Timeline.OutcomeAt + 180));
            }
        }

        [Test]
        public void Reaction_IsProportionalToTheResult_AndHasTheSignOfTheNews()
        {
            var peakPosture = new Dictionary<string, double>();
            var peakHead = new Dictionary<string, double>();
            var peakShake = new Dictionary<string, double>();
            foreach (string o in Categories)
            {
                peakPosture[o] = 0;
                peakHead[o] = 0;
                peakShake[o] = 0;
            }
            var r = new TestRng(47);
            for (int k = 0; k < 60; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                DirectorAnchors baseA = TestAnchors.For(d, DirectorRole.Striker, "react-size#" + k);
                double at = d.Timeline.OutcomeAt;
                foreach (string o in Categories)
                {
                    DirectorPlan plan = DirectorCore.Prepare(WithOutcome(baseA, o, at), 60);
                    double post = 0;
                    for (int i = DirectorTestKit.FrameOf(plan, at + 150); i < Math.Min(plan.N, DirectorTestKit.FrameOf(plan, at + 6000)); i++)
                        if (Math.Abs(DirectorTestKit.Val(plan, i, Ch.Posture)) > Math.Abs(post)) post = DirectorTestKit.Val(plan, i, Ch.Posture);
                    if (Math.Abs(post) > Math.Abs(peakPosture[o])) peakPosture[o] = post;
                    if (Math.Abs(plan.React[8]) > Math.Abs(peakHead[o])) peakHead[o] = plan.React[8];
                    peakShake[o] = Math.Max(peakShake[o], Math.Abs(plan.React[6]));
                }
            }
            Assert.That(peakPosture["six"], Is.GreaterThan(2));
            Assert.That(peakPosture["four"], Is.GreaterThan(1));
            Assert.That(peakPosture["wicket"], Is.LessThan(-2.5));
            Assert.That(peakHead["six"], Is.LessThan(0), "head up for a six");
            Assert.That(peakHead["wicket"], Is.GreaterThan(0), "head down for a wicket");
            Assert.That(Math.Abs(peakPosture["six"]), Is.GreaterThan(Math.Abs(peakPosture["four"])));
            Assert.That(Math.Abs(peakPosture["four"]), Is.GreaterThan(Math.Abs(peakPosture["runs"])));
            Assert.That(Math.Abs(peakPosture["wicket"]), Is.GreaterThan(Math.Abs(peakPosture["close_call"])));
            Assert.That(Math.Abs(peakPosture["dot"]), Is.LessThan(Math.Abs(peakPosture["four"]) / 2));
            Assert.That(Math.Abs(peakPosture["leave"]), Is.LessThan(1));
            Assert.That(Math.Abs(peakHead["six"]), Is.GreaterThan(Math.Abs(peakHead["four"])));
            Assert.That(Math.Abs(peakHead["wicket"]), Is.GreaterThan(Math.Abs(peakHead["close_call"])));
            Assert.That(peakShake["wicket"], Is.GreaterThan(4), "only a bad result shakes the head, a wicket most");
            Assert.That(peakShake["six"], Is.EqualTo(0));
            Assert.That(peakShake["four"], Is.EqualTo(0));
            Assert.That(peakShake["wicket"], Is.GreaterThan(peakShake["close_call"]));
        }

        [Test]
        public void Reaction_InReducedMotionHasNoPostureNoTwistAndNoHeadShake_WhereNormalMotionShakesTheHeadAfterAWicket()
        {
            var r = new TestRng(53);
            Func<DirectorPlan, double, double, int> swings = (p, from, to) =>
            {
                int n = 0;
                double prev = 0;
                for (int i = DirectorTestKit.FrameOf(p, from) + 1; i < Math.Min(p.N, DirectorTestKit.FrameOf(p, to)); i++)
                {
                    double v = DirectorTestKit.Val(p, i, Ch.HeadYaw) - DirectorTestKit.Val(p, i - 1, Ch.HeadYaw);
                    if (Math.Abs(v) > 0.02 && Math.Sign(v) != Math.Sign(prev) && prev != 0) n++;
                    if (Math.Abs(v) > 0.02) prev = v;
                }
                return n;
            };
            int normal = 0;
            for (int k = 0; k < 20; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                double at = d.Timeline.OutcomeAt;
                DirectorAnchors baseA = TestAnchors.For(d, DirectorRole.Striker, "react-rm#" + k, "look-1", true);
                DirectorPlan rm = DirectorCore.Prepare(WithOutcome(baseA, "wicket", at), 60);
                for (int i = 0; i < rm.N; i++)
                {
                    Assert.That(rm.Trace[i * Ch.Count + Ch.Posture], Is.EqualTo(0));
                    Assert.That(rm.Trace[i * Ch.Count + Ch.Twist], Is.EqualTo(0));
                }
                Assert.That(swings(rm, at + 150, at + 1800), Is.LessThanOrEqualTo(1));
                DirectorAnchors n = WithOutcome(baseA, "wicket", at);
                n.ReducedMotion = false;
                normal += swings(DirectorCore.Prepare(n, 60), at + 150, at + 1800);
            }
            Assert.That(normal, Is.GreaterThan(20 * 2));
        }

        [Test]
        public void Reaction_TheBowlerGetsNoReactionFromTheStagesAnchors_AndAGivenOutcomeMakesHisOpposite_Weaker()
        {
            var d = new TestDelivery(new TestRng(5).RandomSpec());
            Assert.That(DirectorCore.Prepare(TestAnchors.For(d, DirectorRole.Bowler, "react-bowler"), 60).React.Length, Is.EqualTo(0));
            DirectorAnchors given = WithOutcome(TestAnchors.For(d, DirectorRole.Bowler, "react-bowler"), "six", d.Timeline.OutcomeAt);
            DirectorAnchors batter = WithOutcome(TestAnchors.For(d, DirectorRole.Striker, "react-bowler"), "six", d.Timeline.OutcomeAt);
            DirectorEvents b = DirectorPlanBuilder.Build(given);
            DirectorEvents s = DirectorPlanBuilder.Build(batter);
            Assert.That(b.React.Length, Is.EqualTo(12));
            Assert.That(b.React[1], Is.LessThan(0), "the bowler's valence is the opposite of the batter's");
            Assert.That(s.React[1], Is.GreaterThan(0));
            Assert.That(Math.Abs(b.React[1]), Is.LessThan(Math.Abs(s.React[1])), "and weaker");
        }

        // ------------------------------------------------------------------------------------------------ the bake allocates nothing

        [Test]
        public void Cost_TheSlicesOfTheBakeAllocateNothing_ByConstructionAndAtRunTime()
        {
            // by construction: no instruction of RunSlice, or of anything in the Director that it calls, creates an object, an array or a box
            var found = new List<string>();
            var seen = new HashSet<System.Reflection.MethodBase>();
            System.Reflection.MethodInfo run = typeof(DirectorBake).GetMethod("RunSlice");
            DirectorSamplerTests.CollectAllocations(run, seen, found);
            Assert.That(seen.Count, Is.GreaterThan(15), "the scan reached the integration step, the frame, the targets, the noise and the seeds");
            Assert.That(found, Is.Empty);

            // at run time: the exact counter where it works, the generation-0 collection count otherwise
            var d = new TestDelivery(new TestBallSpec { Outcome = "six" });
            DirectorAnchors a = TestAnchors.AsStage(TestAnchors.For(d, DirectorRole.Striker, "bake-alloc#0", "look-1", false, 40, false, true), "six", true);
            long bytes = 0;
            int collections = 0;
            DirectorCore.Prepare(a, 60); // warm: the JIT and the lazy static arrays of the parameter classes allocate once
            for (int rep = 0; rep < 200; rep++)
            {
                PlanJob job = DirectorCore.StartPrepare(a, 60);
                long b0 = DirectorSamplerTests.TryAllocatedBytes();
                int g0 = GC.CollectionCount(0);
                while (!job.Advance(1))
                {
                }
                bytes += DirectorSamplerTests.TryAllocatedBytes() - b0;
                collections += GC.CollectionCount(0) - g0;
            }
            if (DirectorSamplerTests.ExactCounterAvailable) Assert.That(bytes, Is.EqualTo(0), "bytes allocated by the slices of 200 bakes");
            Assert.That(collections, Is.EqualTo(0), "generation-0 collections during the slices of 200 bakes");
        }
    }
}
