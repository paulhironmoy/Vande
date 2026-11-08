using System;
using System.Collections.Generic;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;
using Ch = Vande.Practice.Presentation.Production.Director.DirectorChannels;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// The Director's builder gates ported from the web tests (tests/unit/render3d/director/*.test.ts) with the same thresholds:
    /// replay identity and determinism (H4), the quiet windows (H3), Reduced Motion (H5), what the plan may know and when
    /// (H1, H2, the hand-over), the sliced bake, and the edge cases. They run in the web's test world (DirectorTestWorld) in
    /// the stage's 'space' mode and, where the web runs them, in 'overlay' mode. Builder measurements, never a player's or an
    /// evaluator's result.
    /// </summary>
    public sealed class DirectorGateTests
    {
        private static DirectorAnchors Delivery(DirectorRole role, TestDelivery d, string key, string person = "look-1", bool space = true, bool pre = false, bool lead = true, bool reducedMotion = false, bool bowlerRunAnchors = true)
        {
            DirectorAnchors a = TestAnchors.For(d, role, key, person, reducedMotion, 40, pre, lead, "real", DirectorFixtures.Series["pace"]);
            if (!space) return a;
            DirectorAnchors s = TestAnchors.AsStage(a, a.Outcome, bowlerRunAnchors);
            return s;
        }

        private static DirectorPlan Prepare(DirectorAnchors a, int hz = 60)
        {
            return DirectorCore.Prepare(a, hz);
        }

        // ------------------------------------------------------------------------------------------------ replay and determinism

        private static DirectorPlan Build(DirectorRole role, int k, string outcome, bool reducedMotion = false, bool space = true)
        {
            TestBallSpec spec = new TestBallSpec { Outcome = outcome, LengthM = 3 + (k % 7), SpeedKph = 100 + 5 * (k % 9) };
            var d = new TestDelivery(spec);
            return Prepare(Delivery(role, d, DirectorSeeds.DeliveryTakeKey("replay", k / 6, k % 6), "look-1", space, false, true, reducedMotion));
        }

        private static bool SamePlan(DirectorPlan a, DirectorPlan b)
        {
            return a.Key == b.Key && a.N == b.N && DirectorTestKit.TraceEquals(a, b) && DirectorTestKit.EventsEqual(a, b);
        }

        [Test]
        public void Replay_RebuildingTheSameDeliveryGivesIdenticalPlansAndTraces_ForBothActorsAndEveryOutcome()
        {
            for (int k = 0; k < TestDelivery.Outcomes.Length; k++)
            {
                foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
                {
                    foreach (bool space in new[] { true, false })
                    {
                        DirectorPlan a = Build(role, k, TestDelivery.Outcomes[k], false, space);
                        DirectorPlan b = Build(role, k, TestDelivery.Outcomes[k], false, space);
                        Assert.That(SamePlan(a, b), Is.True, role + " " + TestDelivery.Outcomes[k] + (space ? " space" : " overlay"));
                        Assert.That(DirectorTestKit.MaxDiff(a, b, 0, a.N), Is.EqualTo(0));
                    }
                }
            }
        }

        [Test]
        public void Replay_IsNotChangedByWhatWasBuiltInBetween_NoHiddenState()
        {
            DirectorPlan first = Build(DirectorRole.Striker, 4, "four");
            Build(DirectorRole.Bowler, 9, "caught", true);
            Prepare(TestAnchors.Idle(DirectorRole.Striker, "idle#9", 20000));
            DirectorPlan again = Build(DirectorRole.Striker, 4, "four");
            Assert.That(SamePlan(first, again), Is.True);
        }

        [Test]
        public void Replay_ReadsTheSameValueAtTheSameTime_WhateverOrderTheFramesAreReadIn()
        {
            DirectorPlan plan = Build(DirectorRole.Bowler, 2, "six");
            const int n = 2000;
            var times = new double[n];
            for (int i = 0; i < n; i++) times[i] = -50 + (i * 9137) % 9000 + (i % 7) * 0.1371;
            var forward = new float[n][];
            var backward = new float[n][];
            var o = new float[Ch.Count];
            for (int i = 0; i < n; i++)
            {
                DirectorCore.Sample(plan, times[i], o);
                forward[i] = (float[])o.Clone();
            }
            for (int i = n - 1; i >= 0; i--)
            {
                DirectorCore.Sample(plan, times[i], o);
                backward[i] = (float[])o.Clone();
            }
            for (int i = 0; i < n; i++) Assert.That(DirectorTestKit.FloatsEqual(forward[i], backward[i]), Is.True, "t=" + times[i]);
        }

        [Test]
        public void Determinism_DifferentDeliveryKeysPeopleAndRoles_GiveDifferentDraws()
        {
            DirectorPlan baseline = Build(DirectorRole.Striker, 1, "four");
            Assert.That(DirectorTestKit.TraceEquals(Build(DirectorRole.Striker, 2, "four"), baseline), Is.False, "a different delivery key");
            var d = new TestDelivery(new TestBallSpec());
            string key = DirectorSeeds.DeliveryTakeKey("replay", 0, 1);
            DirectorPlan p1 = Prepare(Delivery(DirectorRole.Striker, d, key, "look-1"));
            DirectorPlan p2 = Prepare(Delivery(DirectorRole.Striker, d, key, "look-2"));
            Assert.That(DirectorTestKit.TraceEquals(p1, p2), Is.False, "a different person");
            Assert.That(DirectorTestKit.FloatsEqual(p1.Draw, p2.Draw), Is.False);
            Assert.That(DirectorTestKit.FloatsEqual(p1.Amp, p2.Amp), Is.False);
            DirectorPlan b = Prepare(Delivery(DirectorRole.Bowler, d, "replay#0.1"));
            DirectorPlan s = Prepare(Delivery(DirectorRole.Striker, d, "replay#0.1"));
            Assert.That(DirectorTestKit.TraceEquals(b, s), Is.False, "a different role");
            Assert.That(b.Key, Is.Not.EqualTo(s.Key));
        }

        [Test]
        public void Determinism_TheSixtyHertzTraceEqualsTheTwoFortyHertzTraceAtEveryFourthFrame()
        {
            foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
            {
                var d = new TestDelivery(new TestBallSpec { Outcome = "caught" });
                DirectorAnchors a = Delivery(role, d, "rate#0.3");
                DirectorPlan lo = Prepare(a, 60);
                DirectorPlan hi = Prepare(a, 240);
                for (int i = 0; i < lo.N; i++)
                    for (int c = 0; c < Ch.Count; c++)
                        Assert.That(lo.Trace[i * Ch.Count + c], Is.EqualTo(hi.Trace[4 * i * Ch.Count + c]), role + " frame " + i + " channel " + c);
            }
        }

        [Test]
        public void SlicedBake_GivesTheSamePlanBitForBit_HoweverManySlicesItTakes()
        {
            var r = new TestRng(7);
            for (int k = 0; k < 12; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                DirectorRole role = k % 2 == 1 ? DirectorRole.Bowler : DirectorRole.Striker;
                foreach (bool space in new[] { false, true })
                {
                    DirectorAnchors b = Delivery(role, d, "slice#0." + k, "look-1", space);
                    DirectorPlan whole = Prepare(b);
                    PlanJob job = DirectorCore.StartPrepare(b);
                    int slices = 0;
                    while (!job.Advance(1)) slices++;
                    Assert.That(slices, Is.GreaterThan(4), "it took more than one slice");
                    Assert.That(DirectorTestKit.TraceEquals(job.Plan, whole), Is.True);
                    PlanJob j2 = DirectorCore.StartPrepare(b);
                    while (!j2.Advance(10))
                    {
                    }
                    Assert.That(DirectorTestKit.TraceEquals(j2.Plan, whole), Is.True);
                    double until = b.Release.Value + 300;
                    DirectorPlan reused = DirectorCore.Prepare(b, 60, whole, until);
                    PlanJob j3 = DirectorCore.StartPrepare(b, 60, whole, until);
                    while (!j3.Advance(3))
                    {
                    }
                    Assert.That(DirectorTestKit.TraceEquals(j3.Plan, reused), Is.True);
                }
            }
        }

        [Test]
        public void SlicedBake_AJobIsNotDoneBeforeItsFirstSlice_HasNoPlanUntilDone_AndDoesNothingOnceDone()
        {
            var d = new TestDelivery(new TestBallSpec());
            PlanJob job = DirectorCore.StartPrepare(Delivery(DirectorRole.Striker, d, "job#0.0"));
            Assert.That(job.Done, Is.False);
            Assert.That(job.Plan, Is.Null);
            while (!job.Advance(5))
            {
            }
            DirectorPlan plan = job.Plan;
            Assert.That(plan, Is.Not.Null);
            Assert.That(job.Advance(5), Is.True);
            Assert.That(job.Plan, Is.SameAs(plan));
            Assert.That(job.HorizonMs, Is.EqualTo(double.PositiveInfinity));
        }

        [Test]
        public void SlicedBake_ThePartialTraceIsExactBeforeTheHorizon_AndASliceIsAbout267MsOfScript()
        {
            var d = new TestDelivery(new TestBallSpec { Outcome = "six" });
            DirectorAnchors a = Delivery(DirectorRole.Striker, d, "horizon#0.1");
            DirectorPlan whole = Prepare(a);
            PlanJob job = DirectorCore.StartPrepare(a);
            var got = new float[Ch.Count];
            var want = new float[Ch.Count];
            double lastHorizon = job.HorizonMs;
            int slices = 0;
            while (!job.Done)
            {
                job.Advance(1);
                slices++;
                double h = job.HorizonMs;
                Assert.That(h, Is.GreaterThanOrEqualTo(lastHorizon), "the horizon never goes back");
                // every sample strictly before the horizon is bit-equal to the finished plan's
                for (double t = job.Partial.T0; t < Math.Min(h, job.Partial.T0 + 20000); t += 37.3)
                {
                    DirectorCore.Sample(job.Partial, t, got, 2);
                    DirectorCore.Sample(whole, t, want, 2);
                    Assert.That(DirectorTestKit.FloatsEqual(got, want), Is.True, "t=" + t + " horizon=" + h + " slice " + slices);
                }
                lastHorizon = h;
            }
            // 64 integration steps = 267 ms of script a slice: a 9 s script is about 34 slices
            Assert.That(slices, Is.InRange(25, 45));
        }

        [Test]
        public void SlicedBake_TheCallersOwnTraceArrayIsClearedAndUsedWhenItIsTheRightLength_AndIgnoredOtherwise()
        {
            var d = new TestDelivery(new TestBallSpec { Outcome = "six" });
            DirectorAnchors a = Delivery(DirectorRole.Striker, d, "into#0.1");
            DirectorPlan fresh = Prepare(a);
            var dirty = new short[fresh.Trace.Length];
            for (int i = 0; i < dirty.Length; i++) dirty[i] = 12345;
            PlanJob job = DirectorCore.StartPrepare(a, 60, null, 0, dirty);
            Assert.That(job.Partial.Trace, Is.SameAs(dirty), "the plan fills the caller's array");
            for (int i = 0; i < dirty.Length; i++) Assert.That(dirty[i], Is.EqualTo(0), "cleared before the bake starts");
            while (!job.Advance(7))
            {
            }
            Assert.That(DirectorTestKit.TraceEquals(job.Plan, fresh), Is.True);
            var small = new short[10];
            PlanJob other = DirectorCore.StartPrepare(a, 60, null, 0, small);
            Assert.That(other.Partial.Trace, Is.Not.SameAs(small), "an array of the wrong length is not used");
            while (!other.Advance(100))
            {
            }
            Assert.That(DirectorTestKit.TraceEquals(other.Plan, fresh), Is.True);
            Assert.That(small, Is.All.EqualTo((short)0), "and not written");
        }

        [Test]
        public void SlicedBake_AdvanceToRunsOnlyTheSlicesTheTimeNeeds_AndThePartialPlanIsExactUpToTheHorizon()
        {
            var d = new TestDelivery(new TestBallSpec { Outcome = "four" });
            DirectorAnchors a = Delivery(DirectorRole.Bowler, d, "advance#0.1");
            DirectorPlan whole = Prepare(a);
            PlanJob job = DirectorCore.StartPrepare(a);
            int ran = job.AdvanceTo(2000);
            Assert.That(ran, Is.InRange(1, 40));
            Assert.That(job.Done, Is.False);
            Assert.That(job.HorizonMs, Is.GreaterThan(2000));
            Assert.That(job.AdvanceTo(2000), Is.EqualTo(0), "the plan is already final before that time");
            var got = new float[Ch.Count];
            var want = new float[Ch.Count];
            for (double t = job.Partial.T0; t < job.HorizonMs; t += 11.7)
            {
                DirectorCore.Sample(job.Partial, t, got, 2);
                DirectorCore.Sample(whole, t, want, 2);
                Assert.That(DirectorTestKit.FloatsEqual(got, want), Is.True, "t=" + t);
            }
            job.AdvanceTo(1e9);
            Assert.That(job.Done, Is.True);
            Assert.That(DirectorTestKit.TraceEquals(job.Plan, whole), Is.True);
        }

        // ------------------------------------------------------------------------------------------------ H3 the quiet windows

        [Test]
        public void QuietWindow_Striker_BreathSwayRollPostureAndTwistAreExactlyZeroFromReleaseMinus600ToStrokeEndPlus800_AndAliveBeforeAndAfter()
        {
            foreach (bool space in new[] { true, false })
            {
                var r = new TestRng(91);
                int inside = 0, before = 0, beforeAlive = 0, after = 0, afterAlive = 0;
                for (int k = 0; k < 200; k++)
                {
                    var d = new TestDelivery(r.RandomSpec());
                    DirectorAnchors a = Delivery(DirectorRole.Striker, d, DirectorSeeds.DeliveryTakeKey("h3", 0, k), "look-" + (k % 4), space);
                    DirectorPlan p = Prepare(a);
                    TestTimeline t = d.Timeline;
                    double from = t.Release - 600;
                    double to = (t.StrokeEnd ?? t.End) + 800;
                    for (int i = 0; i < p.N; i++)
                    {
                        double tm = DirectorTestKit.TimeOf(p, i);
                        bool any = false;
                        foreach (int c in DirectorTestKit.LifeChannels) any |= p.Trace[i * Ch.Count + c] != 0;
                        if (tm >= from && tm <= to)
                        {
                            Assert.That(any, Is.False, "ball " + k + " t=" + tm);
                            inside++;
                        }
                        else if (tm < from - 900 && tm > 800)
                        {
                            before++;
                            if (any) beforeAlive++;
                        }
                        else if (tm > to + 600 && tm < t.End)
                        {
                            after++;
                            if (any) afterAlive++;
                        }
                    }
                }
                Assert.That(inside, Is.GreaterThan(10000));
                Assert.That(beforeAlive / (double)before, Is.GreaterThan(0.99), "alive before");
                Assert.That(afterAlive / (double)after, Is.GreaterThan(0.99), "alive after");
            }
        }

        [Test]
        public void QuietWindow_Bowler_LifeChannelsAreExactlyZeroFromTheGatherToReleasePlus150_AndFromTheRunStart()
        {
            var r = new TestRng(93);
            int inside = 0;
            for (int k = 0; k < 200; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                // P1 anchors (no run start): off from the gather
                DirectorPlan p = Prepare(Delivery(DirectorRole.Bowler, d, DirectorSeeds.DeliveryTakeKey("h3b", 0, k), "look-1", false));
                TestTimeline t = d.Timeline;
                for (int i = 0; i < p.N; i++)
                {
                    double tm = DirectorTestKit.TimeOf(p, i);
                    if (tm < t.Gather || tm > t.Release + 150) continue;
                    foreach (int c in DirectorTestKit.LifeChannels) Assert.That(p.Trace[i * Ch.Count + c], Is.EqualTo(0), "ball " + k + " t=" + tm + " channel " + c);
                    inside++;
                }
            }
            Assert.That(inside, Is.GreaterThan(4000));
            // the stage's anchors: off for the whole run-up, from the run start (here 900 ms) to release + 150 ms; alive before and after
            for (int k = 0; k < 30; k++)
            {
                var d = new TestDelivery(new TestBallSpec { Outcome = "dot" });
                d.Timeline.End = d.Timeline.Release + 14000;
                DirectorAnchors a = Delivery(DirectorRole.Bowler, d, "run#0." + k, "look-" + k, true);
                a.RunStart = 900;
                DirectorPlan p = Prepare(a);
                int insideRun = 0, aliveBefore = 0, aliveAfter = 0;
                for (int i = 0; i < p.N; i++)
                {
                    double tm = DirectorTestKit.TimeOf(p, i);
                    bool any = false;
                    foreach (int c in DirectorTestKit.LifeChannels) any |= p.Trace[i * Ch.Count + c] != 0;
                    if (tm >= 900 && tm <= d.Timeline.Release + 150)
                    {
                        Assert.That(any, Is.False, "run-up t=" + tm);
                        insideRun++;
                    }
                    else if (tm > 600 && tm < 849) aliveBefore += any ? 1 : 0;
                    else if (tm > d.Timeline.Release + 1500) aliveAfter += any ? 1 : 0;
                }
                Assert.That(insideRun, Is.GreaterThan(100));
                Assert.That(aliveBefore, Is.GreaterThan(0), "alive in the second before the run");
                Assert.That(aliveAfter, Is.GreaterThan(100), "alive again after the delivery");
            }
        }

        [Test]
        public void QuietWindow_HeadRotationIsAllowedThere_AndTheLifeChannelsReturnSmoothly()
        {
            var d = new TestDelivery(new TestBallSpec { SpeedKph = 130, LengthM = 6, LineM = 0, Outcome = "four" });
            DirectorPlan p = Prepare(Delivery(DirectorRole.Striker, d, "h3#0.1"));
            TestTimeline t = d.Timeline;
            bool headMoves = false;
            for (int i = DirectorTestKit.FrameOf(p, t.Release - 600); i < DirectorTestKit.FrameOf(p, t.Release + 600); i++)
                if (Math.Abs(DirectorTestKit.Val(p, i, Ch.HeadPitch) - DirectorTestKit.Val(p, i - 1, Ch.HeadPitch)) > 0.2) headMoves = true;
            Assert.That(headMoves, Is.True);
            double worstSway = 0, worstBreath = 0;
            for (int i = 1; i < p.N; i++)
            {
                worstSway = Math.Max(worstSway, Math.Abs(DirectorTestKit.Val(p, i, Ch.SwayX) - DirectorTestKit.Val(p, i - 1, Ch.SwayX)));
                worstBreath = Math.Max(worstBreath, Math.Abs(DirectorTestKit.Val(p, i, Ch.Breath) - DirectorTestKit.Val(p, i - 1, Ch.Breath)));
            }
            Assert.That(worstSway, Is.LessThan(0.5));
            Assert.That(worstBreath, Is.LessThan(0.15));
        }

        // ------------------------------------------------------------------------------------------------ H5 Reduced Motion

        [Test]
        public void ReducedMotion_LifeDisplacementIsExactlyZeroInEveryFrame_AndNotZeroInNormalMotion()
        {
            var r = new TestRng(101);
            int frames = 0;
            for (int k = 0; k < 30; k++)
            {
                foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
                {
                    var d = new TestDelivery(r.RandomSpec());
                    string key = DirectorSeeds.DeliveryTakeKey("rm", 0, k);
                    foreach (bool space in new[] { true, false })
                    {
                        DirectorPlan rm = Prepare(Delivery(role, d, key, "look-1", space, false, true, true), 240);
                        DirectorPlan normal = Prepare(Delivery(role, d, key, "look-1", space, false, true, false), 240);
                        bool alive = false;
                        for (int i = 0; i < rm.N; i++)
                        {
                            foreach (int c in DirectorTestKit.LifeChannels)
                            {
                                Assert.That(rm.Trace[i * Ch.Count + c], Is.EqualTo(0), "Reduced Motion, " + role + " ball " + k + " frame " + i + " channel " + c);
                                if (normal.Trace[i * Ch.Count + c] != 0) alive = true;
                            }
                            frames++;
                        }
                        Assert.That(alive, Is.True, "normal motion is alive");
                    }
                }
            }
            foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
            {
                DirectorAnchors idle = TestAnchors.Idle(role, "rm#idle", 20000, "look-1", true);
                DirectorPlan rm = Prepare(idle, 240);
                for (int i = 0; i < rm.N; i++) foreach (int c in DirectorTestKit.LifeChannels) Assert.That(rm.Trace[i * Ch.Count + c], Is.EqualTo(0));
            }
            Assert.That(frames, Is.GreaterThan(10000));
        }

        [Test]
        public void ReducedMotion_BlinksAreKeptExactly_AndThereAreNoMicrosaccadesOrSideGlances()
        {
            var r = new TestRng(103);
            for (int k = 0; k < 20; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
                {
                    string key = DirectorSeeds.DeliveryTakeKey("rmb", 0, k);
                    DirectorPlan rm = Prepare(Delivery(role, d, key, "look-1", true, false, true, true), 240);
                    DirectorPlan normal = Prepare(Delivery(role, d, key, "look-1", true, false, true, false), 240);
                    // the lids differ only through blinks that ride on gaze shifts (the gaze differs); the planned blinks are the same
                    Assert.That(DirectorTestKit.FloatsEqual(rm.Blink, normal.Blink), Is.True, "the planned blinks are bit-equal");
                }
            }
            DirectorPlan idle = Prepare(TestAnchors.Idle(DirectorRole.Striker, "rmi#0", 60000, "look-1", true));
            for (int i = 1; i < idle.Fix.Length; i += DirectorPlanBuilder.FixN) Assert.That(idle.Fix[i], Is.Not.EqualTo((float)DirectorPlanBuilder.TargetSide), "no side glance in Reduced Motion");
            DirectorPlan idleNormal = Prepare(TestAnchors.Idle(DirectorRole.Striker, "rmi#0", 60000, "look-1", false));
            bool glances = false;
            for (int i = 1; i < idleNormal.Fix.Length; i += DirectorPlanBuilder.FixN) glances |= idleNormal.Fix[i] == DirectorPlanBuilder.TargetSide;
            Assert.That(glances, Is.True, "normal motion glances to the side now and then");
        }

        [Test]
        public void ReducedMotion_HasNoHeadShake_NoPostureNoTwist_AndTheEyesNeverLeaveTheHeadByMoreThanTenDegrees()
        {
            var d = new TestDelivery(new TestBallSpec { Outcome = "bowled", SpeedKph = 128, LengthM = 4, LineM = -0.1 });
            DirectorAnchors a = Delivery(DirectorRole.Striker, d, "rm#wicket", "look-2", false, false, true, true);
            DirectorPlan rm = Prepare(a, 240);
            for (int i = 0; i < rm.N; i++)
            {
                Assert.That(rm.Trace[i * Ch.Count + Ch.Posture], Is.EqualTo(0));
                Assert.That(rm.Trace[i * Ch.Count + Ch.Twist], Is.EqualTo(0));
                Assert.That(Math.Abs(DirectorTestKit.Val(rm, i, Ch.EyeYawL)), Is.LessThanOrEqualTo(10 + DirectorParams.Gaze.VergenceDeg / 2 + 0.01));
                Assert.That(Math.Abs(DirectorTestKit.Val(rm, i, Ch.EyePitchL)), Is.LessThanOrEqualTo(10 + 0.01));
            }
        }

        // ------------------------------------------------------------------------------------------------ H1, H2, the hand-over

        private sealed class PerturbedWorld : IDirectorWorld
        {
            public IDirectorWorld Inner;
            public double From;
            public bool Gone;

            public bool Aim(DirectorAim target, double tMs, double[] output)
            {
                return Inner.Aim(target, tMs, output);
            }

            public bool VisibleBall(double tMs, double[] output, double aheadMs)
            {
                bool ok = Inner.VisibleBall(tMs, output, aheadMs);
                if (tMs <= From) return ok;
                if (Gone) return false;
                output[0] += 31;
                output[1] -= 17;
                return ok;
            }

            public void ClipHead(double tMs, double[] output)
            {
                Inner.ClipHead(tMs, output);
            }
        }

        private static DirectorAnchors Perturb(DirectorAnchors a, double from, bool gone)
        {
            DirectorAnchors p = a.Clone();
            p.World = new PerturbedWorld { Inner = a.World, From = from, Gone = gone };
            return p;
        }

        private const double FrameMs = 1000.0 / 240;

        private static bool EqualBefore(DirectorPlan a, DirectorPlan b, double tMs)
        {
            return DirectorTestKit.MaxDiff(a, b, 0, DirectorTestKit.FrameOf(a, tMs) - 1) == 0;
        }

        private static bool DiffersAfter(DirectorPlan a, DirectorPlan b, double tMs)
        {
            return DirectorTestKit.MaxDiff(a, b, DirectorTestKit.FrameOf(a, tMs), a.N) > 0;
        }

        [TestCase(true, false)]
        [TestCase(false, false)]
        [TestCase(true, true)]
        [TestCase(false, true)]
        public void H1_ChangingTheVisibleBallAfterT_ChangesNothingBeforeTPlus125Ms_AndDoesChangeWhatFollows(bool striker, bool lead)
        {
            DirectorRole role = striker ? DirectorRole.Striker : DirectorRole.Bowler;
            var r = new TestRng((uint)(5 + (striker ? 2 : 1)));
            int compared = 0, changed = 0;
            for (int k = 0; k < 120; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                DirectorAnchors a = Delivery(role, d, DirectorSeeds.DeliveryTakeKey("h1", 0, k), "look-1", false, false, lead);
                double T = d.Timeline.Release + 120 + (k % 7) * 40;
                DirectorPlan baseline = Prepare(a, 240);
                foreach (bool gone in new[] { false, true })
                {
                    DirectorPlan alt = Prepare(Perturb(a, T, gone), 240);
                    Assert.That(EqualBefore(baseline, alt, T + 125), Is.True, role + " #" + k + (gone ? " gone" : " shift"));
                    compared++;
                    if (DiffersAfter(baseline, alt, T + 200 + FrameMs * 4)) changed++;
                }
            }
            Assert.That(compared, Is.EqualTo(240));
            Assert.That(changed / (double)compared, Is.GreaterThan(striker ? 0.7 : 0.15), "the ball does matter after the lag, so the test is not vacuous");
        }

        [Test]
        public void H1_ThePursuitLagThePlanDrawsIsNeverUnder125Ms()
        {
            double lo = double.MaxValue;
            for (int k = 0; k < 2000; k++)
            {
                DirectorEvents ev = DirectorPlanBuilder.Build(Delivery(DirectorRole.Striker, new TestDelivery(new TestRng((uint)(k + 1)).RandomSpec()), "lag#" + k));
                lo = Math.Min(lo, ev.Draw[DirectorDraw.LagMs]);
            }
            Assert.That(lo, Is.GreaterThanOrEqualTo(125));
        }

        [Test]
        public void H2_Striker_TwoOutcomesOfTheSameShotAreBitEqualUntilOutcomeAtPlus180Ms_AndDifferAfterwards()
        {
            var r = new TestRng(17);
            int pairs = 0, differ = 0;
            double minFirst = double.MaxValue;
            for (int k = 0; k < 150; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                DirectorAnchors a = Delivery(DirectorRole.Striker, d, DirectorSeeds.DeliveryTakeKey("h2", 0, k), "look-1", false);
                DirectorAnchors b = a.Clone();
                b.OutcomeAt = a.OutcomeAt.Value + 400 + (k % 5) * 100;
                b.Dead = a.Dead.Value + 900;
                b.Runs = a.Runs == 0 ? 2 : 0;
                DirectorPlan pa = Prepare(a, 240);
                DirectorPlan pb = Prepare(b, 240);
                double t = Math.Min(a.OutcomeAt.Value, b.OutcomeAt.Value) + 180;
                Assert.That(EqualBefore(pa, pb, t), Is.True, "ball " + k + " " + d.Spec.Outcome);
                pairs++;
                int first = -1;
                for (int i = DirectorTestKit.FrameOf(pa, t); i < pa.N && first < 0; i++)
                    for (int c = 0; c < Ch.Count; c++)
                        if (pa.Trace[i * Ch.Count + c] != pb.Trace[i * Ch.Count + c])
                        {
                            first = i;
                            break;
                        }
                if (first >= 0)
                {
                    differ++;
                    minFirst = Math.Min(minFirst, DirectorTestKit.TimeOf(pa, first) - a.OutcomeAt.Value);
                }
            }
            Assert.That(differ / (double)pairs, Is.GreaterThan(0.9), "after the latency the outcome does show");
            Assert.That(minFirst, Is.GreaterThanOrEqualTo(180 - FrameMs));
        }

        [Test]
        public void H2_Bowler_TheOutcomeNeverChangesAnything()
        {
            var r = new TestRng(19);
            for (int k = 0; k < 100; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                DirectorAnchors a = Delivery(DirectorRole.Bowler, d, DirectorSeeds.DeliveryTakeKey("h2b", 0, k), "look-1", false);
                DirectorAnchors b = a.Clone();
                b.OutcomeAt = a.OutcomeAt.Value + 1500;
                b.Dead = a.Dead.Value + 2000;
                b.Runs = 3;
                DirectorPlan pa = Prepare(a, 240);
                DirectorPlan pb = Prepare(b, 240);
                Assert.That(DirectorTestKit.MaxDiff(pa, pb, 0, pa.N), Is.EqualTo(0));
            }
        }

        [TestCase(true)]
        [TestCase(false)]
        public void HandOver_TheLivePlanAndThePlanBuiltFromTheResultAgreeUpToTheFirstMomentTheResultMatters(bool striker)
        {
            DirectorRole role = striker ? DirectorRole.Striker : DirectorRole.Bowler;
            var r = new TestRng(23);
            int compared = 0, differ = 0;
            for (int k = 0; k < 200; k++)
            {
                var d = new TestDelivery(r.RandomSpec());
                string key = DirectorSeeds.DeliveryTakeKey("ho", 0, k);
                DirectorPlan live = Prepare(Delivery(role, d, key, "look-1", false, true), 240);
                DirectorPlan full = Prepare(Delivery(role, d, key, "look-1", false, false), 240);
                TestTimeline t = d.Timeline;
                double safe = Math.Min(Math.Min(t.Contact.HasValue ? t.Contact.Value + 125 : double.PositiveInfinity, t.OutcomeAt + 180), Math.Min(striker ? t.StrokeEnd ?? double.PositiveInfinity : double.PositiveInfinity, t.Dead + 125));
                Assert.That(EqualBefore(live, full, safe), Is.True, role + " #" + k);
                compared++;
                if (DiffersAfter(live, full, safe)) differ++;
            }
            Assert.That(compared, Is.EqualTo(200));
            if (striker) Assert.That(differ / (double)compared, Is.GreaterThan(0.9));
        }

        private sealed class CountingWorld : IDirectorWorld
        {
            public IDirectorWorld Inner;
            public int ClipCalls;

            public bool Aim(DirectorAim target, double tMs, double[] output)
            {
                return Inner.Aim(target, tMs, output);
            }

            public bool VisibleBall(double tMs, double[] output, double aheadMs)
            {
                return Inner.VisibleBall(tMs, output, aheadMs);
            }

            public void ClipHead(double tMs, double[] output)
            {
                ClipCalls++;
                Inner.ClipHead(tMs, output);
            }
        }

        [Test]
        public void HandOver_APlanBuiltWithReuseIsBitIdenticalToOneBuiltFromScratch_AndAsksTheClipForFewerFrames_ReusingTooMuchIsCaught()
        {
            var r = new TestRng(37);
            long saved = 0, total = 0;
            int wrongWhenTooMuch = 0, n = 0;
            for (int k = 0; k < 100; k++)
            {
                foreach (DirectorRole role in new[] { DirectorRole.Striker, DirectorRole.Bowler })
                {
                    var d = new TestDelivery(r.RandomSpec());
                    string key = DirectorSeeds.DeliveryTakeKey("reuse", 0, k);
                    DirectorAnchors liveA = Delivery(role, d, key, "look-1", false, true);
                    DirectorAnchors fullA = Delivery(role, d, key, "look-1", false, false);
                    DirectorPlan live = Prepare(liveA);
                    TestTimeline t = d.Timeline;
                    double safe = Math.Min(Math.Min(t.Contact.HasValue ? t.Contact.Value + 125 : double.PositiveInfinity, t.OutcomeAt + 180), Math.Min(role == DirectorRole.Striker ? t.StrokeEnd ?? double.PositiveInfinity : double.PositiveInfinity, t.Dead + 125));
                    var counting = new CountingWorld { Inner = fullA.World };
                    DirectorAnchors countedA = fullA.Clone();
                    countedA.World = counting;
                    DirectorPlan fresh = Prepare(fullA);
                    DirectorPlan reused = DirectorCore.Prepare(countedA, 60, live, safe);
                    Assert.That(DirectorTestKit.TraceEquals(reused, fresh), Is.True, role + " #" + k);
                    Assert.That(DirectorTestKit.FloatsEqual(reused.Fix, fresh.Fix) && DirectorTestKit.FloatsEqual(reused.Blink, fresh.Blink), Is.True);
                    saved += fresh.N - counting.ClipCalls;
                    total += fresh.N;
                    DirectorPlan tooMuch = DirectorCore.Prepare(fullA, 60, live, safe + 2000);
                    n++;
                    if (!DirectorTestKit.TraceEquals(tooMuch, fresh)) wrongWhenTooMuch++;
                }
            }
            Assert.That(saved / (double)total, Is.GreaterThan(0.2));
            Assert.That(wrongWhenTooMuch / (double)n, Is.GreaterThan(0.4));
        }

        [Test]
        public void HandOver_ReuseIsIgnoredWhenTheEarlierPlanHasAnotherRateOrAnotherStart()
        {
            var d = new TestDelivery(new TestBallSpec());
            DirectorAnchors a = Delivery(DirectorRole.Striker, d, "reuse#1", "look-1", false);
            DirectorPlan fresh = Prepare(a);
            DirectorPlan other = Prepare(a, 120);
            Assert.That(DirectorTestKit.TraceEquals(DirectorCore.Prepare(a, 60, other, 3000), fresh), Is.True);
            DirectorAnchors shifted = a.Clone();
            shifted.Start = 500;
            Assert.That(DirectorTestKit.TraceEquals(DirectorCore.Prepare(a, 60, Prepare(shifted), 3000), fresh), Is.True);
        }

        [Test]
        public void EachAnchorMattersOnlyFromItsOwnTime()
        {
            var r = new TestRng(29);
            for (int k = 0; k < 60; k++)
            {
                TestBallSpec spec = r.RandomSpec();
                spec.Outcome = TestDelivery.Outcomes[k % 4];
                var d = new TestDelivery(spec);
                TestTimeline t = d.Timeline;
                DirectorAnchors a = Delivery(DirectorRole.Striker, d, DirectorSeeds.DeliveryTakeKey("anc", 0, k), "look-1", false);
                DirectorPlan pa = Prepare(a, 240);
                var cases = new List<KeyValuePair<DirectorAnchors, double>>();
                DirectorAnchors c1 = a.Clone(); c1.StrokeEnd = null; cases.Add(new KeyValuePair<DirectorAnchors, double>(c1, t.StrokeEnd.Value));
                DirectorAnchors c2 = a.Clone(); c2.OutcomeAt = null; cases.Add(new KeyValuePair<DirectorAnchors, double>(c2, t.OutcomeAt + 180));
                DirectorAnchors c3 = a.Clone(); c3.OutcomeAt = null; c3.Dead = null; cases.Add(new KeyValuePair<DirectorAnchors, double>(c3, Math.Min(t.OutcomeAt + 180, t.Dead + 300)));
                DirectorAnchors c4 = a.Clone(); c4.Runs = a.Runs + 3; cases.Add(new KeyValuePair<DirectorAnchors, double>(c4, t.OutcomeAt + 180));
                DirectorAnchors c5 = a.Clone(); c5.Swing = null; cases.Add(new KeyValuePair<DirectorAnchors, double>(c5, double.PositiveInfinity));
                DirectorAnchors c6 = a.Clone(); c6.Contact = null; cases.Add(new KeyValuePair<DirectorAnchors, double>(c6, double.PositiveInfinity));
                DirectorAnchors c7 = a.Clone(); c7.TaskEnd = a.TaskEnd.Value + 700; cases.Add(new KeyValuePair<DirectorAnchors, double>(c7, (t.Contact ?? t.PassAt) + 150));
                for (int i = 0; i < cases.Count; i++)
                {
                    DirectorPlan pb = Prepare(cases[i].Key, 240);
                    double before = cases[i].Value;
                    bool equal = double.IsInfinity(before) ? DirectorTestKit.MaxDiff(pa, pb, 0, pa.N) == 0 : EqualBefore(pa, pb, before);
                    Assert.That(equal, Is.True, "case " + i + " #" + k);
                }
            }
        }

        // ------------------------------------------------------------------------------------------------ draws and the ball

        [TestCase(true)]
        [TestCase(false)]
        public void Honesty_TheDrawsAreUncorrelatedWithLengthLineSpeedVariationAndOutcome_AndTheMachineryFindsARealDependence(bool striker)
        {
            DirectorRole role = striker ? DirectorRole.Striker : DirectorRole.Bowler;
            const int N = 10000;
            var r = new TestRng(striker ? 4321u : 1234u);
            var specs = new List<TestBallSpec>(N);
            var rows = new List<double[]>(N);
            var gazePitch = new double[N];
            var gazeYaw = new double[N];
            var o = new float[Ch.Count];
            int summaries = 0;
            for (int k = 0; k < N; k++)
            {
                TestBallSpec spec = r.RandomSpec();
                var d = new TestDelivery(spec);
                d.Timeline.End = d.Timeline.Release + 3000;
                string key = DirectorSeeds.DeliveryTakeKey("hon-" + (striker ? "striker" : "bowler"), k / 6, k % 6);
                DirectorAnchors a = Delivery(role, d, key, "look-" + (k % 11), false);
                DirectorPlan p = Prepare(a);
                specs.Add(spec);
                double[] row = DrawSummaries(p, role, d.Timeline.Release, o);
                summaries = row.Length;
                rows.Add(row);
                DirectorCore.Sample(p, d.Timeline.Release + 450, o, 2);
                gazePitch[k] = o[Ch.GazePitch];
                gazeYaw[k] = o[Ch.GazeYaw];
            }
            var props = new double[5][];
            for (int q = 0; q < 5; q++) props[q] = new double[N];
            for (int k = 0; k < N; k++)
            {
                props[0][k] = specs[k].LengthM;
                props[1][k] = specs[k].LineM;
                props[2][k] = specs[k].SpeedKph;
                props[3][k] = specs[k].Variation;
                props[4][k] = Array.IndexOf(TestDelivery.Outcomes, specs[k].Outcome);
            }
            double worst = 0;
            string worstName = "";
            for (int s = 0; s < summaries; s++)
            {
                var col = new double[N];
                for (int k = 0; k < N; k++) col[k] = rows[k][s];
                for (int q = 0; q < 5; q++)
                {
                    double rho = DirectorTestKit.Spearman(col, props[q]);
                    if (Math.Abs(rho) > worst)
                    {
                        worst = Math.Abs(rho);
                        worstName = "summary " + s + " ~ property " + q;
                    }
                }
            }
            Assert.That(summaries, Is.GreaterThanOrEqualTo(40));
            // 10,000 balls, as the web's test: the sampling noise of a Spearman rho is about 1/sqrt(10000) = 0.01 per correlation
            Assert.That(worst, Is.LessThanOrEqualTo(0.04), worstName);
            if (striker)
            {
                Assert.That(Math.Abs(DirectorTestKit.Spearman(gazePitch, props[0])), Is.GreaterThan(0.3), "positive control: where the striker looks 450 ms after the release follows the visible ball");
                Assert.That(Math.Abs(DirectorTestKit.Spearman(gazeYaw, props[1])), Is.GreaterThan(0.1));
            }
        }

        /// <summary>Scalars that must not depend on the ball: the plan's draws and the channels at instants before the ball matters (honesty.test.ts drawSummaries).</summary>
        private static double[] DrawSummaries(DirectorPlan p, DirectorRole role, double release, float[] o)
        {
            var s = new List<double>();
            for (int k = 0; k < DirectorDraw.Count; k++) s.Add(p.Draw[k]);
            foreach (int k in new[] { DirectorAmp.BreathHz, DirectorAmp.SwayRootMm, DirectorAmp.BlinkMeanS }) s.Add(p.Amp[k]);
            uint bk = p.Key;
            s.Add(DirectorSeeds.Gauss(DirectorSeeds.Mix(bk, 11), 0));
            s.Add(DirectorSeeds.Gauss(DirectorSeeds.Mix(DirectorSeeds.Mix(bk, 12), 0), 0));
            s.Add(p.Micro.Length > 0 ? p.Micro[0] : -1);
            int nFix = p.Fix.Length / DirectorPlanBuilder.FixN;
            int before = 0, glances = 0;
            for (int i = 0; i < nFix; i++)
            {
                if (p.Fix[i * 5] < release - 300)
                {
                    before++;
                    if (p.Fix[i * 5 + 1] == DirectorPlanBuilder.TargetSide) glances++;
                }
            }
            s.Add(before);
            s.Add(p.Fix.Length > 5 ? p.Fix[5] : -1);
            s.Add(p.Fidget.Length / DirectorPlanBuilder.FidgetN);
            s.Add(p.Fidget.Length > 0 ? p.Fidget[0] : -1);
            s.Add(p.Fidget.Length > 0 ? p.Fidget[1] : -1);
            s.Add(p.Fidget.Length > 0 ? p.Fidget[3] : 0);
            s.Add(glances);
            DirectorCore.Sample(p, release - 1500, o, 2);
            s.Add(o[Ch.Posture]);
            s.Add(o[Ch.Twist]);
            s.Add(o[Ch.Breath]);
            s.Add(o[Ch.SwayX]);
            s.Add(o[Ch.SwayRoll]);
            DirectorCore.Sample(p, release - 1200, o, 2);
            s.Add(o[Ch.HeadYaw]);
            s.Add(o[Ch.HeadPitch]);
            s.Add(o[Ch.EyeYawL]);
            s.Add(o[Ch.EyePitchL]);
            DirectorCore.Sample(p, release - 300, o, 2);
            s.Add(o[Ch.GazeYaw]);
            s.Add(o[Ch.GazePitch]);
            s.Add(o[Ch.BlinkL]);
            if (role == DirectorRole.Bowler)
            {
                DirectorCore.Sample(p, release + 2500, o, 2);
                s.Add(o[Ch.Breath]);
                s.Add(o[Ch.SwayX]);
                s.Add(o[Ch.Exertion]);
            }
            return s.ToArray();
        }

        [Test]
        public void Honesty_TheDrawsAreAFunctionOfTheKeyAlone_TheSameKeyWithADifferentBallGivesIdenticalDraws()
        {
            var r = new TestRng(77);
            for (int k = 0; k < 50; k++)
            {
                string key = DirectorSeeds.DeliveryTakeKey("same-key", 1, k % 6);
                DirectorEvents a = DirectorPlanBuilder.Build(Delivery(DirectorRole.Striker, new TestDelivery(r.RandomSpec()), key, "look-1", false));
                DirectorEvents b = DirectorPlanBuilder.Build(Delivery(DirectorRole.Striker, new TestDelivery(r.RandomSpec()), key, "look-1", false));
                Assert.That(DirectorTestKit.FloatsEqual(a.Draw, b.Draw), Is.True);
                Assert.That(DirectorTestKit.FloatsEqual(a.Amp, b.Amp), Is.True);
                int m = Math.Min(Math.Min(a.Micro.Length, b.Micro.Length), 30);
                Assert.That(m, Is.GreaterThan(20));
                for (int i = 0; i < m; i++) Assert.That(a.Micro[i], Is.EqualTo(b.Micro[i]));
                if (a.Blink[0] < 1500 && b.Blink[0] < 1500) Assert.That(a.Blink[0], Is.EqualTo(b.Blink[0]));
            }
        }

        // ------------------------------------------------------------------------------------------------ edge cases

        private sealed class ScriptedWorld : IDirectorWorld
        {
            public Func<double, double[], bool> Aimer = (t, o) => false;
            public Func<double, double[], bool> Ball = (t, o) => false;
            public Action<double, double[]> Clip = (t, o) => { };

            public bool Aim(DirectorAim target, double tMs, double[] output)
            {
                return Aimer(tMs, output);
            }

            public bool VisibleBall(double tMs, double[] output, double aheadMs)
            {
                return Ball(tMs, output);
            }

            public void ClipHead(double tMs, double[] output)
            {
                Clip(tMs, output);
            }
        }

        private static void AssertFinite(DirectorPlan p)
        {
            var o = new float[Ch.Count];
            for (double t = p.T0 - 100; t < p.T0 + p.N * 1000.0 / p.Hz + 100; t += 37)
            {
                DirectorCore.Sample(p, t, o, 2);
                foreach (float v in o) Assert.That(float.IsNaN(v) || float.IsInfinity(v), Is.False, "t=" + t);
            }
        }

        [Test]
        public void Edge_NoTargetIsEverAvailable_TheGazeStaysCentredAndEveryValueIsFinite()
        {
            foreach (bool space in new[] { true, false })
            {
                DirectorAnchors a = TestAnchors.Idle(DirectorRole.Striker, "edge#0", 6000);
                a.HeadMode = space ? DirectorHeadMode.Space : DirectorHeadMode.Overlay;
                a.World = new ScriptedWorld();
                DirectorPlan p = Prepare(a);
                AssertFinite(p);
                var o = new float[Ch.Count];
                DirectorCore.Sample(p, 3000, o, 2);
                Assert.That(Math.Abs(o[Ch.GazeYaw]), Is.LessThan(1));
                Assert.That(Math.Abs(o[Ch.GazePitch]) < 1 || (o[Ch.GazePitch] > 25 && o[Ch.GazePitch] < 32), Is.True);
            }
            DirectorAnchors none = TestAnchors.Idle(DirectorRole.Striker, "edge#0", 6000);
            none.World = null;
            AssertFinite(Prepare(none));
        }

        [Test]
        public void Edge_TargetsThatReturnNaNOrInfinityAreIgnored_NotFollowed()
        {
            DirectorAnchors a = TestAnchors.Idle(DirectorRole.Striker, "edge#0", 6000);
            a.World = new ScriptedWorld
            {
                Aimer = (t, o) => { o[0] = double.NaN; o[1] = double.PositiveInfinity; return true; },
                Clip = (t, o) => { o[0] = double.NaN; o[1] = double.NegativeInfinity; o[2] = double.NaN; },
            };
            AssertFinite(Prepare(a));
        }

        [Test]
        public void Edge_AOneFrameAndAZeroLengthScript()
        {
            foreach (double end in new double[] { 0, 5, 16, 17 })
            {
                DirectorAnchors a = TestAnchors.Idle(DirectorRole.Striker, "edge#0", end);
                DirectorPlan p = Prepare(a);
                Assert.That(p.N, Is.GreaterThanOrEqualTo(1));
                AssertFinite(p);
            }
            DirectorPlan neg = Prepare(TestAnchors.Idle(DirectorRole.Striker, "edge#0", -50));
            Assert.That(neg.N, Is.EqualTo(1));
            AssertFinite(neg);
        }

        [Test]
        public void Edge_ADeliveryWhoseAnchorsAreAllMissingExceptTheRelease_AndOneWithTheReleaseBeforeTheStart()
        {
            var d = new TestDelivery(new TestBallSpec());
            DirectorAnchors a = Delivery(DirectorRole.Striker, d, "edge#1", "look-1", false);
            DirectorAnchors bare = a.Clone();
            bare.Gather = bare.Swing = bare.Contact = bare.TaskEnd = bare.OutcomeAt = bare.Dead = bare.StrokeEnd = null;
            AssertFinite(Prepare(bare));
            DirectorAnchors early = a.Clone();
            early.Start = 3000;
            early.Release = 2000;
            AssertFinite(Prepare(early));
            DirectorAnchors bowler = Delivery(DirectorRole.Bowler, d, "edge#2", "look-1", false);
            bowler.Gather = null;
            AssertFinite(Prepare(bowler));
        }

        [Test]
        public void Edge_EveryFrameRateGivesFiniteOutput()
        {
            var d = new TestDelivery(new TestBallSpec());
            DirectorAnchors a = Delivery(DirectorRole.Bowler, d, "edge#3", "look-1", false);
            foreach (int hz in new[] { 60, 120, 240 }) AssertFinite(Prepare(a, hz));
        }

        [Test]
        public void Edge_AVeryLongScript_TenMinutes_IsBuiltAndReadWithoutTrouble()
        {
            DirectorPlan p = Prepare(TestAnchors.Idle(DirectorRole.Bowler, "edge#long", 600000));
            Assert.That(p.N, Is.EqualTo(36001));
            AssertFinite(p);
        }
    }
}
