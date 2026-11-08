using System;
using System.Collections.Generic;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;
using Vande.Practice.Presentation.Production.Director.Stage;
using Vande.Practice.Trace;
using Ch = Vande.Practice.Presentation.Production.Director.DirectorChannels;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>The stage's geometry made of the Director tests' small world (TestDelivery): the bowler's head and hand, the striker's eye, the ball as the script draws it.</summary>
    internal sealed class TestStageGeometry : IStageGeometry
    {
        public TestDelivery Delivery;
        public bool Pre;

        public StageVec StrikerEye()
        {
            return new StageVec(TestWorld.EyeS.X, TestWorld.EyeS.Y, TestWorld.EyeS.Z);
        }

        public StageVec BowlerEye(double sceneMs)
        {
            P3 p = TestDelivery.BowlerHead(sceneMs, Delivery.Timeline.Release);
            return new StageVec(p.X, p.Y, p.Z);
        }

        public StageVec BowlerHand(double sceneMs, double releaseMs)
        {
            P3 p = TestDelivery.BowlerHand(sceneMs, Delivery.Timeline.Release);
            return new StageVec(p.X, p.Y, p.Z);
        }

        public bool Ball(double sceneMs, out StageBall ball)
        {
            ball = new StageBall();
            P3 p;
            if (!Delivery.Ball(sceneMs, Pre, out p)) return false;
            ball.Pos = new StageVec(p.X, p.Y, p.Z);
            ball.Holder = sceneMs < Delivery.Timeline.Release ? 1 : 0;
            return true;
        }
    }

    internal static class StageTestKit
    {
        public static StageSpec Spec(TestDelivery d, bool pre, string seed = "stage-test", bool bowlerGather = true)
        {
            TestTimeline t = d.Timeline;
            return new StageSpec
            {
                Seed = seed,
                BowlerLook = "look-1",
                StrikerLook = "practice:batter",
                FlightEnd = t.PassAt + 400,
                Bowler = new StageActorSpec { Start = t.Start, End = t.End, RunStart = 300, Gather = bowlerGather ? t.Gather : (double?)null, Release = t.Release, FollowEnd = t.Release + 1500 },
                Striker = new StageActorSpec
                {
                    Start = t.Start,
                    End = t.End,
                    Release = t.Release,
                    Swing = pre ? null : t.Swing,
                    Contact = pre ? null : t.Contact,
                    TaskEnd = pre ? t.PassAt : t.Contact ?? t.PassAt,
                    OutcomeAt = pre ? (double?)null : t.OutcomeAt,
                    Outcome = pre ? null : TestDelivery.CategoryOf(d.Spec.Outcome),
                    Dead = pre ? (double?)null : t.Dead,
                    StrokeEnd = pre ? (double?)null : t.StrokeEnd,
                    Runs = pre ? 0 : t.Runs,
                },
            };
        }

        public static IStageGeometry Geometry(TestDelivery d, bool pre)
        {
            return new TestStageGeometry { Delivery = d, Pre = pre };
        }

        public static TestDelivery Delivery(string outcome, double speed = 136, double length = 6, double line = 0.05)
        {
            return new TestDelivery(new TestBallSpec { Outcome = outcome, SpeedKph = speed, LengthM = length, LineM = line });
        }

        /// <summary>The channels of a frame read at 60 Hz over [from, to] ms: the runtime's Frame output copied.</summary>
        public static List<float[]> Read(DirectorStageRuntime rt, DirectorStageRuntime.Script s, DirectorRole role, double from, double to)
        {
            var list = new List<float[]>();
            var f = new DirectedFrame();
            for (double t = from; t <= to; t += 1000.0 / 60)
            {
                rt.Frame(s, role, t, f);
                list.Add(f.HasChannels ? (float[])f.Ch.Clone() : null);
            }
            return list;
        }
    }

    /// <summary>
    /// The stage binding of the Director (a port of stage/runtime.ts): when plans are baked, how a result takes over a delivery, the honesty of the
    /// live plans, replay identity, the quiet windows through the fade, Reduced Motion, the scene between balls and its laps, the seam, and what a
    /// frame costs and allocates. The geometry is the Director tests' small cricket world. Builder measurements, never a player's or an evaluator's result.
    /// </summary>
    public sealed class DirectorStageRuntimeTests
    {
        private const double Frame60 = 1000.0 / 60;

        private static DirectorStageRuntime NewRuntime()
        {
            return new DirectorStageRuntime();
        }

        private static DirectorStageRuntime.Script Live(DirectorStageRuntime rt, TestDelivery d, string seed = "stage-test")
        {
            return rt.Register(StageTestKit.Spec(d, true, seed), StageKind.Live, StageTestKit.Geometry(d, true), null);
        }

        // ------------------------------------------------------------------------------------------------ when plans are baked

        [Test]
        public void Live_RegistersAndBakesNothing_ThePlansAreQueued()
        {
            DirectorStageRuntime rt = NewRuntime();
            var d = StageTestKit.Delivery("four");
            DirectorStageRuntime.Script s = Live(rt, d);
            Assert.That(s, Is.Not.Null);
            Assert.That(rt.Stats.Slices, Is.EqualTo(0), "no slice baked by the call that registers a delivery");
            Assert.That(rt.Stats.SyncBakes, Is.EqualTo(0));
            Assert.That(rt.PendingCount(s), Is.EqualTo(2), "one bake queued per actor");
            Assert.That(rt.PlanOfScript(s, DirectorRole.Bowler), Is.Null);
            var f = new DirectedFrame();
            Assert.That(rt.Frame(s, DirectorRole.Striker, 100, f), Is.False, "before the deadline and with no plan a frame has nothing, and bakes nothing");
            Assert.That(rt.Stats.Slices, Is.EqualTo(0));
        }

        [Test]
        public void Work_BakesInSlicesAndSwapsIn_AndTheSlicedPlanIsTheWholePlan()
        {
            var d = StageTestKit.Delivery("six");
            DirectorStageRuntime a = NewRuntime();
            DirectorStageRuntime.Script sa = Live(a, d);
            int calls = 0;
            // a clock that gives each call 0.2 ms: a budget of 0.5 ms takes about three slices a call
            double now = 0;
            a.Clock = () => now += 0.2;
            while (a.Work(0.5, sa)) calls++;
            Assert.That(calls, Is.GreaterThan(3), "the bake took several spare-time calls");
            Assert.That(a.Busy, Is.False);
            DirectorStageRuntime b = NewRuntime();
            DirectorStageRuntime.Script sb = Live(b, d);
            b.Finish(sb);
            foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
            {
                DirectorPlan pa = a.PlanOfScript(sa, role);
                DirectorPlan pb = b.PlanOfScript(sb, role);
                Assert.That(pa, Is.Not.Null);
                Assert.That(DirectorTestKit.TraceEquals(pa, pb), Is.True, role + ": the sliced plan is the plan baked in one go, bit for bit");
                Assert.That(DirectorTestKit.EventsEqual(pa, pb), Is.True, role + ": events");
            }
        }

        [Test]
        public void ADeadlineReachedBeforeTheSpareTime_BakesOnlyTheSlicesTheFrameNeeds_AndServesThePlanExactly()
        {
            var d = StageTestKit.Delivery("four");
            DirectorStageRuntime rt = NewRuntime();
            DirectorStageRuntime.Script s = Live(rt, d);
            DirectorStageRuntime whole = NewRuntime();
            DirectorStageRuntime.Script w = Live(whole, d);
            whole.Finish(w);
            var f = new DirectedFrame();
            var g = new DirectedFrame();
            var forcedAt = new List<int>();
            for (double t = 600; t < 2400; t += Frame60)
            {
                int before = rt.Stats.ForcedSlices;
                rt.Frame(s, DirectorRole.Striker, t, f);
                if (rt.Stats.ForcedSlices != before) forcedAt.Add(rt.Stats.ForcedSlices - before);
                if (t < DirectorStageRuntime.LiveDeadlineMs) Assert.That(f.On, Is.False, "no plan before the deadline (t=" + t + ")");
                else
                {
                    Assert.That(f.On, Is.True, "served from the deadline (t=" + t + ")");
                    whole.Frame(w, DirectorRole.Striker, t, g);
                    Assert.That(DirectorTestKit.FloatsEqual(f.Ch, g.Ch), Is.True, "the plan served while it is baked reads what the finished plan reads (t=" + t + ")");
                }
            }
            Assert.That(rt.Stats.ForcedMax, Is.LessThanOrEqualTo(5), "the first frame past the deadline bakes " + rt.Stats.ForcedMax + " slices at most (the trace up to the playhead and the lookahead)");
            foreach (int n in forcedAt.GetRange(1, forcedAt.Count - 1)) Assert.That(n, Is.LessThanOrEqualTo(1), "every later frame bakes at most one slice");
        }

        // ------------------------------------------------------------------------------------------------ the result takes over

        [TestCase("four")]
        [TestCase("six")]
        [TestCase("two")]
        [TestCase("caught")]
        [TestCase("dot")]
        [TestCase("missed")]
        [TestCase("leave")]
        [TestCase("bowled")]
        public void AResultHandedOverADelivery_GivesExactlyThePlanAReplayOfTheResultGives_AndTheLiveUntilTheResultMatters(string outcome)
        {
            var d = StageTestKit.Delivery(outcome);
            DirectorStageRuntime rt = NewRuntime();
            DirectorStageRuntime.Script live = Live(rt, d);
            rt.Finish(live);
            StageSpec rs = StageTestKit.Spec(d, false);
            DirectorStageRuntime.Script result = rt.Register(rs, StageKind.Result, StageTestKit.Geometry(d, false), live);
            Assert.That(result, Is.Not.Null);
            Assert.That(rt.PlanOfScript(result, DirectorRole.Striker), Is.SameAs(rt.PlanOfScript(live, DirectorRole.Striker)), "the live plans stand in");
            Assert.That(rt.PendingCount(result), Is.EqualTo(2));
            int slicesAtRegister = rt.Stats.Slices;
            rt.Finish(result);
            DirectorStageRuntime other = NewRuntime();
            DirectorStageRuntime.Script replay = other.Register(rs, StageKind.Replay, StageTestKit.Geometry(d, false), null);
            other.Finish(replay);
            DirectorStageRuntime lone = NewRuntime();
            DirectorStageRuntime.Script liveLone = Live(lone, d);
            lone.Finish(liveLone);
            foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
            {
                DirectorPlan handed = rt.PlanOfScript(result, role);
                DirectorPlan replayed = other.PlanOfScript(replay, role);
                Assert.That(handed, Is.Not.SameAs(rt.PlanOfScript(live, role)), role + ": the result's own plan replaced the stand-in");
                Assert.That(DirectorTestKit.TraceEquals(handed, replayed), Is.True, outcome + " " + role + ": a result handed over a live delivery gives the plan a replay of the result gives, bit for bit");
                Assert.That(DirectorTestKit.EventsEqual(handed, replayed), Is.True, outcome + " " + role + ": events");
                // live and result agree until the first moment the result matters
                DirectorPlan liveP = lone.PlanOfScript(liveLone, role);
                double until = Math.Min(Math.Min(rs.Striker.Contact.HasValue ? rs.Striker.Contact.Value + 125 : double.PositiveInfinity, rs.Striker.OutcomeAt.Value + 180), rs.Striker.Dead.Value + 125);
                until = Math.Min(until, rs.FlightEnd.Value + 125);
                until = Math.Min(until, StageTestKit.Spec(d, true).Striker.TaskEnd.Value + 150 - 12);
                if (role == DirectorRole.Striker) until = Math.Min(until, rs.Striker.StrokeEnd.Value);
                int upto = DirectorTestKit.FrameOf(handed, until) - 1;
                Assert.That(DirectorTestKit.MaxDiff(liveP, handed, 0, upto), Is.EqualTo(0), outcome + " " + role + ": live and result are bit-equal until the result matters (" + until + " ms)");
            }
            Assert.That(slicesAtRegister, Is.GreaterThanOrEqualTo(0));
        }

        [Test]
        public void ResultArrival_BakesNothingInTheCallThatRegistersIt_TheSpareTimeBakesItBeforeTheDeadline_AndWithNoSpareTimeADeadlineForcesTheReplayOnce()
        {
            var d = StageTestKit.Delivery("four");
            // (1) nothing is baked by the call that registers a result; the frames' spare time (one slice a frame here) has the plans in before the deadline
            DirectorStageRuntime rt = NewRuntime();
            DirectorStageRuntime.Script live = Live(rt, d);
            rt.Finish(live);
            int slices = rt.Stats.Slices;
            DirectorStageRuntime.Script result = rt.Register(StageTestKit.Spec(d, false), StageKind.Result, StageTestKit.Geometry(d, false), live);
            Assert.That(rt.Stats.Slices, Is.EqualTo(slices), "nothing baked by the call that registers a result");
            double now = 0;
            rt.Clock = () => now += 1.0; // every clock call is a millisecond: a budget of 2 ms takes exactly two slices
            DirectorStageRuntime other = NewRuntime();
            DirectorStageRuntime.Script replay = other.Register(StageTestKit.Spec(d, false), StageKind.Replay, StageTestKit.Geometry(d, false), null);
            other.Finish(replay);
            var f = new DirectedFrame();
            var g = new DirectedFrame();
            double contact = d.Timeline.Contact.Value;
            for (double t = contact - 200; t < contact + 1500; t += Frame60)
            {
                rt.Work(2.0, result); // two slices a frame (a phone's spare time is more than that), shared by the two actors
                rt.Frame(result, DirectorRole.Striker, t, f);
                other.Frame(replay, DirectorRole.Striker, t, g);
                Assert.That(DirectorTestKit.FloatsEqual(f.Ch, g.Ch), Is.True, "t=" + t + ": the frame draws what the replay draws");
            }
            Assert.That(rt.Stats.ForcedMax, Is.LessThanOrEqualTo(1), "with a slice of spare time a frame, a deadline forces at most one slice at a time");
            // (2) no spare time at all: the first frame that needs the result's own plan makes the job (the integrator is replayed to the first moment
            // the result matters, the copied frames are free) and serves it; every later frame bakes at most a slice
            DirectorStageRuntime lone = NewRuntime();
            DirectorStageRuntime.Script l2 = Live(lone, d);
            lone.Finish(l2);
            DirectorStageRuntime.Script r2 = lone.Register(StageTestKit.Spec(d, false), StageKind.Result, StageTestKit.Geometry(d, false), l2);
            int worst = 0;
            int previous = 0;
            for (double t = contact - 200; t < contact + 1500; t += Frame60)
            {
                lone.Frame(r2, DirectorRole.Striker, t, f);
                other.Frame(replay, DirectorRole.Striker, t, g);
                Assert.That(DirectorTestKit.FloatsEqual(f.Ch, g.Ch), Is.True, "no spare time, t=" + t);
                worst = Math.Max(worst, lone.Stats.ForcedSlices - previous);
                previous = lone.Stats.ForcedSlices;
            }
            Console.WriteLine("a result with no spare time at all: the worst frame bakes " + worst + " slices (64 integration steps = 267 ms of script each)");
            Assert.That(worst, Is.LessThanOrEqualTo(16), "the first frame replays the integrator to the first moment the result matters");
            Assert.That(lone.Stats.ForcedMax, Is.EqualTo(worst));
        }

        // ------------------------------------------------------------------------------------------------ honesty

        [Test]
        public void TheLiveSpec_KnowsNothingOfTheResult()
        {
            var d = StageTestKit.Delivery("six");
            StageSpec live = StageTestKit.Spec(d, true);
            Assert.That(live.Striker.Swing, Is.Null);
            Assert.That(live.Striker.Contact, Is.Null);
            Assert.That(live.Striker.OutcomeAt, Is.Null);
            Assert.That(live.Striker.Outcome, Is.Null);
            Assert.That(live.Striker.Dead, Is.Null);
            Assert.That(live.Striker.StrokeEnd, Is.Null);
            Assert.That(live.Bowler.OutcomeAt, Is.Null);
            Assert.That(live.Bowler.Outcome, Is.Null);
        }

        [Test]
        public void TwoResultsThatDifferOnlyAfterTheOutcome_GiveBitEqualFramesUntilTheOutcomePlus180ms_AndTheBowlerAlwaysBlind()
        {
            var d = StageTestKit.Delivery("four");
            StageSpec a = StageTestKit.Spec(d, false);
            StageSpec b = StageTestKit.Spec(d, false);
            b.Striker.Outcome = "wicket";
            b.Striker.OutcomeAt = a.Striker.OutcomeAt + 900;
            b.Striker.Dead = a.Striker.Dead + 900;
            DirectorStageRuntime ra = NewRuntime();
            DirectorStageRuntime rb = NewRuntime();
            DirectorStageRuntime.Script sa = ra.Register(a, StageKind.Replay, StageTestKit.Geometry(d, false), null);
            DirectorStageRuntime.Script sb = rb.Register(b, StageKind.Replay, StageTestKit.Geometry(d, false), null);
            ra.Finish(sa);
            rb.Finish(sb);
            double blindUntil = Math.Min(a.Striker.OutcomeAt.Value, b.Striker.OutcomeAt.Value) + 180;
            var fa = new DirectedFrame();
            var fb = new DirectedFrame();
            // striker: identical until the outcome plus the shortest reaction latency
            for (double t = 450; t < blindUntil - 20; t += Frame60)
            {
                ra.Frame(sa, DirectorRole.Striker, t, fa);
                rb.Frame(sb, DirectorRole.Striker, t, fb);
                Assert.That(DirectorTestKit.FloatsEqual(fa.Ch, fb.Ch), Is.True, "striker t=" + t + " before the outcome is known");
            }
            // the bowler never sees the outcome
            for (double t = 450; t < a.Bowler.End; t += Frame60)
            {
                ra.Frame(sa, DirectorRole.Bowler, t, fa);
                rb.Frame(sb, DirectorRole.Bowler, t, fb);
                if (!DirectorTestKit.FloatsEqual(fa.Ch, fb.Ch)) Assert.Fail("the bowler differs at t=" + t + ": he must be outcome-blind");
            }
        }

        [Test]
        public void ALiveBallAndItsReplay_DrawTheSameFrames_FromFourHundredMillisecondsOn()
        {
            foreach (string outcome in new[] { "four", "caught", "missed", "leave" })
            {
                var d = StageTestKit.Delivery(outcome);
                DirectorStageRuntime rt = NewRuntime();
                DirectorStageRuntime.Script live = Live(rt, d, "ball-" + outcome);
                // the delivery is drawn for a while, then the result arrives and its plans are baked in the spare time
                var f = new DirectedFrame();
                for (double t = 0; t < d.Timeline.Release + 100; t += Frame60)
                {
                    rt.Frame(live, DirectorRole.Striker, t, f);
                    rt.Frame(live, DirectorRole.Bowler, t, f);
                }
                DirectorStageRuntime.Script result = rt.Register(StageTestKit.Spec(d, false, "ball-" + outcome), StageKind.Result, StageTestKit.Geometry(d, false), live);
                DirectorStageRuntime other = NewRuntime();
                DirectorStageRuntime.Script replay = other.Register(StageTestKit.Spec(d, false, "ball-" + outcome), StageKind.Replay, StageTestKit.Geometry(d, false), null);
                var g = new DirectedFrame();
                foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
                    for (double t = 400; t < d.Timeline.End; t += Frame60)
                    {
                        rt.Frame(result, role, t, f);
                        other.Frame(replay, role, t, g);
                        if (f.On != g.On || (f.On && (!DirectorTestKit.FloatsEqual(f.Ch, g.Ch) || f.W != g.W)))
                            Assert.Fail(outcome + " " + role + " t=" + t + ": the live ball and its replay differ");
                    }
            }
        }

        [Test]
        public void TheQuietWindows_AreExactlyZero_ThroughTheFade_ForSixtyDeliveries()
        {
            var rng = new TestRng(2026);
            var life = DirectorTestKit.LifeChannels;
            for (int n = 0; n < 60; n++)
            {
                var d = new TestDelivery(rng.RandomSpec());
                StageSpec spec = StageTestKit.Spec(d, false, "quiet-" + n);
                DirectorStageRuntime rt = NewRuntime();
                DirectorStageRuntime.Script s = rt.Register(spec, StageKind.Replay, StageTestKit.Geometry(d, false), null);
                rt.Finish(s);
                var f = new DirectedFrame();
                double release = spec.Striker.Release.Value;
                // the plan is a trace at 60 Hz read linearly: the window is read where both frames of the interval are inside it (a read between the last zero
                // frame and the first non-zero one is a share of the second)
                for (int k = (int)Math.Ceiling((release - 600) / Frame60); (k + 1) * Frame60 <= spec.Striker.StrokeEnd.Value + 800; k++)
                {
                    double t = k * Frame60;
                    rt.Frame(s, DirectorRole.Striker, t, f);
                    foreach (int c in life) Assert.That(f.Ch[c], Is.EqualTo(0f), "delivery " + n + " striker channel " + c + " at " + t);
                }
                for (int k = (int)Math.Ceiling(spec.Bowler.RunStart.Value / Frame60); (k + 1) * Frame60 <= release + 150; k++)
                {
                    double t = k * Frame60;
                    rt.Frame(s, DirectorRole.Bowler, t, f);
                    foreach (int c in life) Assert.That(f.Ch[c], Is.EqualTo(0f), "delivery " + n + " bowler channel " + c + " at " + t);
                }
            }
        }

        // ------------------------------------------------------------------------------------------------ Reduced Motion

        [Test]
        public void ReducedMotion_HasNoLife_ChangesRebakeWhatIsOnScreen_AndTheLoudPlansDoNotServe()
        {
            var d = StageTestKit.Delivery("four");
            DirectorStageRuntime rt = NewRuntime();
            rt.SetReducedMotion(true);
            DirectorStageRuntime.Script s = rt.Register(StageTestKit.Spec(d, false), StageKind.Replay, StageTestKit.Geometry(d, false), null);
            rt.Finish(s);
            var f = new DirectedFrame();
            foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
                for (double t = 0; t < d.Timeline.End; t += Frame60)
                {
                    rt.Frame(s, role, t, f);
                    Assert.That(f.On && f.Reduced, Is.True, "a Reduced Motion plan serves");
                    foreach (int c in DirectorTestKit.LifeChannels) Assert.That(f.Ch[c], Is.EqualTo(0f), "no life in Reduced Motion (channel " + c + " at " + t + ")");
                }
            // loud plans on screen, then Reduced Motion on: the loud plans stop serving at once, the quiet ones are baked in the spare time and take over
            DirectorStageRuntime loud = NewRuntime();
            DirectorStageRuntime.Script ls = loud.Register(StageTestKit.Spec(d, false), StageKind.Replay, StageTestKit.Geometry(d, false), null);
            loud.Finish(ls);
            loud.Frame(ls, DirectorRole.Striker, 1000, f);
            Assert.That(f.On && !f.Reduced, Is.True);
            loud.SetReducedMotion(true);
            loud.Frame(ls, DirectorRole.Striker, 1000, f);
            Assert.That(f.On, Is.False, "a loud plan cannot serve under Reduced Motion");
            while (loud.Work(5, ls)) { }
            loud.Frame(ls, DirectorRole.Striker, 1000, f);
            Assert.That(f.On && f.Reduced, Is.True, "the quiet plan is in");
            loud.SetReducedMotion(false);
            loud.Frame(ls, DirectorRole.Striker, 1000, f);
            Assert.That(f.On && f.Reduced, Is.True, "a quiet plan serves after Reduced Motion is off (it is baked loud again in the spare time)");
            while (loud.Work(5, ls)) { }
            loud.Frame(ls, DirectorRole.Striker, 1000, f);
            Assert.That(f.On && !f.Reduced, Is.True, "and the loud plan takes over once it is baked");
        }

        // ------------------------------------------------------------------------------------------------ the scene between balls

        private static DirectorStageRuntime.Script Idle(DirectorStageRuntime rt, bool prefetch = false)
        {
            var geometry = new DirectorStageGeometry { Mirror = -1, StrikerEyePosition = new StageVec(-0.2, 1.68, 8.86), StandX = 0.2, StandZ = -24, NoBall = true };
            return rt.Register(StageSpecs.Idle("look-1", "practice:batter"), StageKind.Idle, geometry, null, prefetch);
        }

        [Test]
        public void TheSceneBetweenBalls_PlansFadeIn_TheLoopWrapsWithoutAStep_AndTheNextLapIsADifferentMinute()
        {
            DirectorStageRuntime rt = NewRuntime();
            DirectorStageRuntime.Script s = Idle(rt);
            var f = new DirectedFrame();
            Assert.That(rt.Frame(s, DirectorRole.Striker, 100, f), Is.False, "no plan yet");
            while (rt.Work(5, s)) { }
            // fades in over 500 ms from the first frame it is read in
            double w0 = 0;
            rt.Frame(s, DirectorRole.Striker, 2000, f);
            w0 = f.W;
            Assert.That(w0, Is.EqualTo(0).Within(1e-9), "the first frame of a plan that appears while the scene is showing starts at zero weight");
            rt.Frame(s, DirectorRole.Striker, 2250, f);
            Assert.That(f.W, Is.GreaterThan(0.3).And.LessThan(0.7));
            rt.Frame(s, DirectorRole.Striker, 2600, f);
            Assert.That(f.W, Is.EqualTo(1).Within(1e-9));
            // the wrap: step by step across the seam; the next lap is queued the first time the scene is read and baked in the spare time
            var steps = new List<double>();
            var a = new DirectedFrame();
            float[] prev = null;
            double maxElsewhere = 0;
            for (double t = 55000; t < DirectorStageRuntime.IdleLoopMs; t += Frame60) rt.Frame(s, DirectorRole.Striker, t, a);
            while (rt.Work(5, s)) { }
            bool wrapped = false;
            for (double t = 58000; t < DirectorStageRuntime.IdleLoopMs + 2000; t += Frame60)
            {
                bool wrapNow = !wrapped && t >= DirectorStageRuntime.IdleLoopMs;
                wrapped |= wrapNow;
                double tt = t >= DirectorStageRuntime.IdleLoopMs ? t - DirectorStageRuntime.IdleLoopMs : t;
                rt.Frame(s, DirectorRole.Striker, tt, a);
                if (prev != null)
                {
                    double m = 0;
                    foreach (int c in new[] { Ch.Breath, Ch.SwayX, Ch.SwayZ, Ch.SwayRoll, Ch.Posture, Ch.Twist, Ch.HeadYaw, Ch.HeadPitch, Ch.HeadRoll })
                        m = Math.Max(m, Math.Abs(a.Ch[c] - prev[c]) / Math.Max(0.01, Scale(c)));
                    if (wrapNow) steps.Add(m);
                    else maxElsewhere = Math.Max(maxElsewhere, m);
                }
                prev = (float[])a.Ch.Clone();
            }
            Assert.That(steps.Count, Is.GreaterThan(0));
            foreach (double st in steps) Assert.That(st, Is.LessThan(Math.Max(2.5 * maxElsewhere, 0.05)), "a step at the wrap against the largest step elsewhere");
            // lap 1 is another plan: its draws differ from lap 0's at the same time of the minute
            var l0 = new DirectedFrame();
            var l1 = new DirectedFrame();
            DirectorStageRuntime rt2 = NewRuntime();
            DirectorStageRuntime.Script s2 = Idle(rt2);
            while (rt2.Work(5, s2)) { }
            rt2.Frame(s2, DirectorRole.Striker, 3000, l0);
            var lap0 = (float[])l0.Ch.Clone(); // the frame's channels are the runtime's own cache: copy them before the next read
            for (double t = 3000; t < DirectorStageRuntime.IdleLoopMs; t += 100) rt2.Frame(s2, DirectorRole.Striker, t, l1);
            while (rt2.Work(5, s2)) { }
            rt2.Frame(s2, DirectorRole.Striker, DirectorStageRuntime.IdleLoopMs - 100, l1);
            rt2.Frame(s2, DirectorRole.Striker, 100, l1); // the wrap: the next lap takes over
            rt2.Frame(s2, DirectorRole.Striker, 3000, l1);
            Assert.That(DirectorTestKit.FloatsEqual(lap0, l1.Ch), Is.False, "the minute never repeats itself");
        }

        private static double Scale(int c)
        {
            switch (c)
            {
                case Ch.Breath: return 1;
                case Ch.SwayX:
                case Ch.SwayZ: return 1;
                case Ch.SwayRoll: return 1;
                case Ch.Posture: return 1;
                case Ch.Twist: return 1;
                default: return 3;
            }
        }

        [Test]
        public void AScenePrefetchedWhileABallIsOn_IsBakedInTheSpareSlices_AndIsThereWhenItIsShown()
        {
            DirectorStageRuntime rt = NewRuntime();
            var d = StageTestKit.Delivery("four");
            DirectorStageRuntime.Script live = Live(rt, d);
            DirectorStageRuntime.Script ahead = Idle(rt, true);
            var f = new DirectedFrame();
            // the delivery is shown: the prefetched scene is baked after the delivery's plans (not shown, yet baked)
            int guard = 0;
            while (rt.Busy && guard++ < 10000) rt.Work(5, live);
            Assert.That(rt.Busy, Is.False, "the delivery's and the prefetched plans are all baked");
            Assert.That(rt.PlanOfScript(ahead, DirectorRole.Striker), Is.Not.Null, "the scene between balls has its plans before it is shown");
        }

        // ------------------------------------------------------------------------------------------------ the seam

        [Test]
        public void TheSeam_ADeliveryAfterAnotherSceneContinuesFromTheHeadDrawn_AResultAReplayAndALateFirstFrameHaveNone()
        {
            DirectorStageRuntime rt = NewRuntime();
            DirectorStageRuntime.Script idle = Idle(rt);
            while (rt.Work(5, idle)) { }
            var f = new DirectedFrame();
            rt.Frame(idle, DirectorRole.Striker, 3000, f);
            StageDrawnHead drawn = rt.Drawn(DirectorRole.Striker);
            drawn.Ok = true;
            drawn.Yaw = 12;
            drawn.Pitch = 18;
            drawn.Roll = 1;
            var d = StageTestKit.Delivery("four");
            DirectorStageRuntime.Script live = Live(rt, d);
            Assert.That(rt.Frame(live, DirectorRole.Striker, Frame60, f), Is.True, "no plan yet, but the head still continues from the scene before");
            Assert.That(f.HasChannels, Is.False);
            Assert.That(f.Seam, Is.Not.Null);
            Assert.That(f.Seam.Pending, Is.True);
            Assert.That(f.Seam.H0Yaw, Is.EqualTo(12));
            Assert.That(f.Seam.K, Is.EqualTo(1).Within(0.01));
            f.Seam.Pending = false;
            rt.Frame(live, DirectorRole.Striker, 200, f);
            Assert.That(f.Seam.K, Is.EqualTo(0.5).Within(0.1), "half way through the seam");
            rt.Frame(live, DirectorRole.Striker, 420, f);
            Assert.That(f.Seam.K, Is.EqualTo(0).Within(1e-9), "given back");
            // a result of the same delivery has none, nor has a replay
            rt.Finish(live);
            DirectorStageRuntime.Script result = rt.Register(StageTestKit.Spec(d, false), StageKind.Result, StageTestKit.Geometry(d, false), live);
            rt.Frame(result, DirectorRole.Striker, 2500, f);
            Assert.That(f.Seam, Is.Null);
            DirectorStageRuntime.Script replay = rt.Register(StageTestKit.Spec(d, false), StageKind.Replay, StageTestKit.Geometry(d, false), null);
            rt.Frame(replay, DirectorRole.Striker, 20, f);
            Assert.That(f.Seam, Is.Null);
            // the scene between balls after a delivery continues from the head drawn too
            DirectorStageRuntime.Script idle2 = Idle(rt);
            rt.Frame(idle2, DirectorRole.Striker, Frame60, f);
            Assert.That(f.Seam, Is.Not.Null, "the scene between balls after a delivery continues from the head the delivery ended with");
        }

        [Test]
        public void TheLifeSeam_TheStrikersBreathGoesOnAcrossTheSwitchToADelivery_TheBowlersQuietWindowIsZeroFromHisFirstFrame_AndTheSceneBetweenBallsContinuesBoth()
        {
            DirectorStageRuntime rt = NewRuntime();
            DirectorStageRuntime.Script idle = Idle(rt);
            while (rt.Work(5, idle)) { }
            var f = new DirectedFrame();
            rt.Frame(idle, DirectorRole.Striker, 3000, f);
            rt.Frame(idle, DirectorRole.Bowler, 3000, f);
            foreach (DirectorRole role in new[] { DirectorRole.Striker, DirectorRole.Bowler }) rt.Drawn(role).Ok = true;
            // what the rigs were last given: a breath, a sway, a roll, a posture and a twist
            var ch = new float[DirectorChannels.Count];
            ch[DirectorChannels.Breath] = 1.2f;
            ch[DirectorChannels.SwayX] = 4f;
            ch[DirectorChannels.SwayZ] = -5f;
            ch[DirectorChannels.SwayRoll] = 0.6f;
            ch[DirectorChannels.Posture] = 0.8f;
            ch[DirectorChannels.Twist] = 1.1f;
            var last = new DirectorLife();
            last.Set(ch, 1.0);
            rt.NoteLife(DirectorRole.Striker, last);
            rt.NoteLife(DirectorRole.Bowler, last);
            var d = StageTestKit.Delivery("four");
            DirectorStageRuntime.Script live = Live(rt, d);
            var life = new DirectorLife();
            // the first frame of the delivery, no plan baked yet: the striker's life is the last one he was given, not zero
            rt.Frame(live, DirectorRole.Striker, Frame60, f);
            life.Set(f.On && f.HasChannels ? f.Ch : null, f.W, f.On ? f.Seam : null);
            Assert.That(life.Active, Is.True);
            Assert.That(life.BreathDeg, Is.EqualTo(1.2f).Within(1e-6f));
            Assert.That(life.SwayXMetres, Is.EqualTo(0.004f).Within(1e-7f));
            Assert.That(life.SwayZMetres, Is.EqualTo(-0.005f).Within(1e-7f));
            Assert.That(life.SwayRollDeg, Is.EqualTo(0.6f).Within(1e-6f));
            Assert.That(life.PostureDeg, Is.EqualTo(0.8f).Within(1e-6f));
            Assert.That(life.TwistDeg, Is.EqualTo(1.1f).Within(1e-6f));
            f.Seam.Pending = false;
            // half way through the seam half of it is left; given back by 400 ms: nothing is carried
            rt.Frame(live, DirectorRole.Striker, 200, f);
            life.Set(f.On && f.HasChannels ? f.Ch : null, f.W, f.On ? f.Seam : null);
            Assert.That(life.BreathDeg, Is.EqualTo(1.2f * 0.5f).Within(0.15f), "half way");
            rt.Frame(live, DirectorRole.Striker, 420, f);
            life.Set(f.On && f.HasChannels ? f.Ch : null, f.W, f.On ? f.Seam : null);
            Assert.That(life.Active, Is.False, "nothing is carried past the seam (and no plan is baked in this test)");
            // the bowler of a delivery is in his quiet window from his first frame: exactly nothing, whatever the scene before ended with
            rt.Frame(live, DirectorRole.Bowler, Frame60, f);
            life.Set(f.On && f.HasChannels ? f.Ch : null, f.W, f.On ? f.Seam : null);
            Assert.That(life.Active, Is.False, "the bowler's quiet window is exactly zero from his first frame");
            // the scene between balls after a delivery goes on from the life of both (it has no quiet window)
            rt.Finish(live);
            rt.NoteLife(DirectorRole.Bowler, last);
            rt.NoteLife(DirectorRole.Striker, last);
            DirectorStageRuntime.Script idle2 = Idle(rt);
            foreach (DirectorRole role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
            {
                rt.Frame(idle2, role, Frame60, f);
                life.Set(f.On && f.HasChannels ? f.Ch : null, f.W, f.On ? f.Seam : null);
                Assert.That(life.BreathDeg, Is.EqualTo(1.2f).Within(1e-6f), role + ": the scene between balls goes on from the life it was given");
            }
        }

        // ------------------------------------------------------------------------------------------------ the world's questions

        [Test]
        public void TheDirectorsQuestions_AreTheWebs_Aim_Hand_AndTheBallAsDrawn()
        {
            var d = StageTestKit.Delivery("four");
            IStageGeometry g = StageTestKit.Geometry(d, true);
            var world = new StageDirectorWorld(g, DirectorRole.Striker, d.Timeline.Release);
            var oracle = new TestWorld { Role = DirectorRole.Striker, Delivery = d, Pre = true, Lead = true };
            var a = new double[2];
            var b = new double[2];
            for (double t = 0; t < d.Timeline.End; t += 37)
            {
                world.Aim(DirectorAim.Opponent, t, a);
                oracle.Aim(DirectorAim.Opponent, t, b);
                Assert.That(a[0], Is.EqualTo(b[0]).Within(1e-9), "aim opponent yaw at " + t);
                Assert.That(a[1], Is.EqualTo(b[1]).Within(1e-9));
                world.Aim(DirectorAim.Hand, t, a);
                oracle.Aim(DirectorAim.Hand, t, b);
                Assert.That(a[0], Is.EqualTo(b[0]).Within(1e-9), "aim hand yaw at " + t);
                Assert.That(a[1], Is.EqualTo(b[1]).Within(1e-9));
                foreach (double ahead in new[] { 0.0, 150.0 })
                {
                    bool wa = world.VisibleBall(t, a, ahead);
                    bool wb = oracle.VisibleBall(t, b, ahead);
                    Assert.That(wa, Is.EqualTo(wb), "visible at " + t);
                    if (wa)
                    {
                        Assert.That(a[0], Is.EqualTo(b[0]).Within(1e-9), "ball yaw at " + t + " ahead " + ahead);
                        Assert.That(a[1], Is.EqualTo(b[1]).Within(1e-9), "ball pitch at " + t + " ahead " + ahead);
                    }
                }
            }
        }

        [Test]
        public void TheBallIsNotLookedAtAcrossAChangeOfHolder()
        {
            var d = StageTestKit.Delivery("four");
            var world = new StageDirectorWorld(StageTestKit.Geometry(d, true), DirectorRole.Striker, d.Timeline.Release);
            var withLead = new double[2];
            var noLead = new double[2];
            double release = d.Timeline.Release;
            // 5 ms after the release the ball 10 ms before was in the hand: no extrapolation (the hand to the air is not one motion)
            world.VisibleBall(release + 5, withLead, 150);
            world.VisibleBall(release + 5, noLead, 0);
            // the eye at t + ahead differs, so compare against the position, not the direction: ahead moves the eye only (the striker's is fixed)
            Assert.That(withLead[0], Is.EqualTo(noLead[0]).Within(1e-9), "no extrapolation across the release");
            Assert.That(withLead[1], Is.EqualTo(noLead[1]).Within(1e-9));
            world.VisibleBall(release + 60, withLead, 150);
            world.VisibleBall(release + 60, noLead, 0);
            Assert.That(Math.Abs(withLead[1] - noLead[1]) + Math.Abs(withLead[0] - noLead[0]), Is.GreaterThan(0.01), "in the air the extrapolation applies");
        }

        // ------------------------------------------------------------------------------------------------ cost and allocation

        [Test]
        public void AFrame_AllocatesNothingInTheSteadyState_AndCostsMicroseconds()
        {
            var d = StageTestKit.Delivery("six");
            DirectorStageRuntime rt = NewRuntime();
            DirectorStageRuntime.Script s = rt.Register(StageTestKit.Spec(d, false), StageKind.Replay, StageTestKit.Geometry(d, false), null);
            rt.Finish(s);
            var f = new DirectedFrame();
            var lives = new[] { new DirectorLife(), new DirectorLife() };
            for (int i = 0; i < 4000; i++)
            {
                double t = 600 + (i % 4000) * Frame60 / 4;
                rt.Frame(s, DirectorRole.Striker, t, f);
                lives[1].Set(f.Ch, f.W);
            }
            // IL: the methods of the steady state
            var found = new List<string>();
            var seen = new HashSet<System.Reflection.MethodBase>();
            foreach (string m in new[] { "Weight", "Read" })
            {
                var info = typeof(DirectorStageRuntime).GetMethod(m, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                Assert.That(info, Is.Not.Null, m);
                if (m == "Read") continue; // Read can queue the next lap of a scene between balls (once a minute): measured below instead
                StageAllocationScan.Scan(info, seen, found);
            }
            StageAllocationScan.Scan(typeof(DirectorStageRuntime).GetMethod("SeamOf", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance), seen, found);
            StageAllocationScan.Scan(typeof(DirectorLife).GetMethod("Set", new[] { typeof(float[]), typeof(double) }), seen, found);
            StageAllocationScan.Scan(typeof(DirectorLife).GetMethod("Set", new[] { typeof(float[]), typeof(double), typeof(StageSeam) }), seen, found);
            StageAllocationScan.Scan(typeof(DirectorStageRuntime).GetMethod("NoteLife"), seen, found);
            StageAllocationScan.Scan(typeof(DirectorLife).GetMethod("ApplyRotations"), seen, found);
            StageAllocationScan.Scan(typeof(DirectorLife).GetMethod("RootShift"), seen, found);
            Assert.That(found, Is.Empty, "allocating instructions in the steady-state frame: " + string.Join("; ", found));
            // run time
            const int n = 400000;
            int gen0 = GC.CollectionCount(0);
            long bytes0 = DirectorSamplerTests.TryAllocatedBytes();
            long watch = System.Diagnostics.Stopwatch.GetTimestamp();
            for (int i = 0; i < n; i++)
            {
                double t = 600 + (i % 4000) * Frame60 / 4;
                rt.Frame(s, DirectorRole.Striker, t, f);
                lives[1].Set(f.Ch, f.W);
            }
            double ns = (System.Diagnostics.Stopwatch.GetTimestamp() - watch) * 1e9 / System.Diagnostics.Stopwatch.Frequency / n;
            long bytes1 = DirectorSamplerTests.TryAllocatedBytes();
            Console.WriteLine("stage frame (plan sampled with the weight, the seam, the life set): " + ns.ToString("0") + " ns per actor per frame; allocation counter delta " + (bytes1 - bytes0) + " B, gen-0 collections " + (GC.CollectionCount(0) - gen0));
            Assert.That(GC.CollectionCount(0) - gen0, Is.EqualTo(0));
            if (DirectorSamplerTests.ExactCounterAvailable) Assert.That(bytes1 - bytes0, Is.EqualTo(0));
            Assert.That(ns, Is.LessThan(20000));
        }

        // ------------------------------------------------------------------------------------------------ the specs

        [Test]
        public void TheOutcomeCategory_IsTheCrowdsReading()
        {
            Assert.That(StageSpecs.OutcomeCategory("caught", 0, "middle", 0, 0, false), Is.EqualTo("wicket"));
            Assert.That(StageSpecs.OutcomeCategory(null, 6, "middle", 0, 6, false), Is.EqualTo("six"));
            Assert.That(StageSpecs.OutcomeCategory(null, 4, "middle", 0, 4, false), Is.EqualTo("four"));
            Assert.That(StageSpecs.OutcomeCategory(null, 0, "outside_edge", 0, 1, false), Is.EqualTo("close_call"));
            Assert.That(StageSpecs.OutcomeCategory(null, 0, "miss", 0, 0, false), Is.EqualTo("close_call"));
            Assert.That(StageSpecs.OutcomeCategory(null, 0, "pad", 0, 0, false), Is.EqualTo("close_call"));
            Assert.That(StageSpecs.OutcomeCategory(null, 0, "leave", 0.6, 0, true), Is.EqualTo("close_call"));
            Assert.That(StageSpecs.OutcomeCategory(null, 0, "leave", 0.1, 0, true), Is.EqualTo("leave"));
            Assert.That(StageSpecs.OutcomeCategory(null, 0, "middle", 0, 2, false), Is.EqualTo("runs"));
            Assert.That(StageSpecs.OutcomeCategory(null, 0, "middle", 0, 0, false), Is.EqualTo("dot"));
        }

        [Test]
        public void TheResultSpec_TakesTheContactTheOutcomeTheDeadBallAndTheStrokesEndFromTheTrace()
        {
            var flight = new List<BallTraceSample>();
            for (int i = 0; i <= 120; i++)
                flight.Add(new BallTraceSample { t = i / 240.0, p = new TraceVector3 { x = 0, y = 1.0, z = -9.0 + i * 0.18 }, v = new TraceVector3 { z = 43 } });
            var inputs = new StageDeliveryInputs { Seed = "s", BowlerLook = "b", StrikerLook = "practice:batter", ReleaseMs = 2400, Flight = flight.ToArray(), IdealContactT = 0.4 };
            StageSpec live = StageSpecs.Live(inputs);
            Assert.That(live.Striker.Contact, Is.Null);
            Assert.That(live.Striker.Outcome, Is.Null);
            Assert.That(live.Striker.TaskEnd, Is.GreaterThan(2400 + 400).And.LessThan(2400 + 600), "the unhit ball passing the crease plus the margin");
            Assert.That(live.FlightEnd, Is.LessThanOrEqualTo(2400 + 500), "the live ball is certainly drawn only until the earliest contact plane");
            var trace = new CanonicalDeliveryTrace
            {
                durationSeconds = 3.0,
                ball = flight.ToArray(),
                bat = new[] { new BatTraceSample { t = 0.3 }, new BatTraceSample { t = 0.5 } },
                batterMotion = new TraceBatterMotion { startT = 0.2, contactT = 0.4, endT = 0.7 },
                events = new[]
                {
                    new CanonicalTraceEvent { t = 0.4, kind = "contact", contact = "middle" },
                    new CanonicalTraceEvent { t = 1.9, kind = "boundary", runs = 4 },
                    new CanonicalTraceEvent { t = 2.2, kind = "dead" },
                },
            };
            StageSpec result = StageSpecs.Result(inputs, trace, null, "middle", 4, 0.2, 0.0, false);
            Assert.That(result.Striker.Contact, Is.EqualTo(2400 + 400).Within(1e-6));
            Assert.That(result.Striker.Swing, Is.EqualTo(2400 + 200).Within(1e-6));
            Assert.That(result.Striker.OutcomeAt, Is.EqualTo(2400 + 1900).Within(1e-6), "the boundary confirms the outcome");
            Assert.That(result.Striker.Outcome, Is.EqualTo("four"));
            Assert.That(result.Striker.Dead, Is.EqualTo(2400 + 2200).Within(1e-6));
            Assert.That(result.Striker.StrokeEnd, Is.EqualTo(2400 + (0.7 + 0.6 + 0.28) * 1000).Within(1e-6));
            Assert.That(result.Striker.TaskEnd, Is.EqualTo(result.Striker.Contact));
            Assert.That(result.Bowler.OutcomeAt, Is.Null, "the bowler is outcome-blind");
            Assert.That(result.Bowler.Outcome, Is.Null);
            Assert.That(result.Bowler.Contact, Is.Null);
        }

        [Test]
        public void TheGeometry_DrawsTheBallInTheHandThenTheFlight_AndTheResultTakesOverAfterTheContact()
        {
            var flight = new[]
            {
                new BallTraceSample { t = 0.0, p = new TraceVector3 { x = 0.1, y = 2.0, z = -9.0 }, v = new TraceVector3() },
                new BallTraceSample { t = 0.5, p = new TraceVector3 { x = 0.1, y = 1.0, z = 5.0 }, v = new TraceVector3() },
            };
            var traceBall = new[]
            {
                new BallTraceSample { t = 0.0, p = new TraceVector3 { x = 0.1, y = 2.0, z = -9.0 }, v = new TraceVector3() },
                new BallTraceSample { t = 0.4, p = new TraceVector3 { x = 0.1, y = 1.2, z = 3.0 }, v = new TraceVector3() },
                new BallTraceSample { t = 1.0, p = new TraceVector3 { x = 5.0, y = 1.2, z = -9.0 }, v = new TraceVector3() },
            };
            var g = new DirectorStageGeometry { Mirror = -1, Scale = 1, StrikerEyePosition = new StageVec(-0.2, 1.68, 8.86), StandX = 0.2, StandZ = -14, ReleaseMs = 2000, Flight = flight, LiveVisibleUntilMs = 2000 + 480 };
            StageBall b;
            Assert.That(g.Ball(1500, out b), Is.True);
            Assert.That(b.Holder, Is.EqualTo(1), "in the hand before the release");
            Assert.That(g.Ball(2250, out b), Is.True);
            Assert.That(b.Holder, Is.EqualTo(0));
            Assert.That(b.Pos.Z, Is.EqualTo(-2.0).Within(1e-9), "half way down the flight");
            Assert.That(g.Ball(2500, out b), Is.False, "the live ball is no longer drawn past the point the world may hide it");
            DirectorStageGeometry r = g.ForResult(traceBall, 0.4);
            Assert.That(r.Ball(2250, out b), Is.True);
            Assert.That(b.Pos.Z, Is.EqualTo(-2.0).Within(1e-9), "before the contact the result's ball is the delivery's own flight, bit for bit");
            Assert.That(r.Ball(2500, out b), Is.True, "after the contact the trace's ball is drawn");
            Assert.That(b.Pos.Z, Is.EqualTo(3.0 + (-9.0 - 3.0) * (0.1 / 0.6)).Within(1e-9), "linear between the trace's samples");
            Assert.That(r.Ball(3500, out b), Is.False, "past the trace's last sample nothing is drawn");
        }
    }
}
