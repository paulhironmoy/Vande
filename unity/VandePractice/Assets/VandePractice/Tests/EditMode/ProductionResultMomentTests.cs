using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.MotionPacks;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Motion;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// UNI-07: the four Target Chase result-moment clips (bat_celebrate_win, bat_walk_off, bowl_celebrate_defend, bowl_disappointed) on the
    /// Unity world, through the C# VMP reader. The scheduling is pure (ProductionResultMoments) and checked line for line against the web's
    /// resultMoments.ts; the world is played at 60 Hz through the host flow (the press, the commitment, the result, the replay) on the golden
    /// deliveries, with the Director off where a run is compared bit for bit with a control, and on where only the pops are scanned.
    /// Builder evidence: no player, no device.
    /// </summary>
    public sealed class ProductionResultMomentTests
    {
        // ======================================================================== the pure part

        private static CanonicalDeliveryTrace Trace(double dead, params (string kind, double t)[] events)
        {
            var list = events.Select(e => new CanonicalTraceEvent { kind = e.kind, t = e.t }).ToList();
            list.Add(new CanonicalTraceEvent { kind = "dead", t = dead });
            return new CanonicalDeliveryTrace { durationSeconds = dead, events = list.OrderBy(e => e.t).ToArray() };
        }

        [Test]
        public void TheClipsLatenciesAndMarkersAreTheSpecsTable()
        {
            Assert.That(ProductionResultMoments.StrikerClipId(ResultMomentOutcome.Won), Is.EqualTo("bat_celebrate_win"));
            Assert.That(ProductionResultMoments.StrikerClipId(ResultMomentOutcome.LostWicket), Is.EqualTo("bat_walk_off"));
            Assert.That(ProductionResultMoments.StrikerClipId(ResultMomentOutcome.LostBalls), Is.EqualTo("bat_walk_off"));
            Assert.That(ProductionResultMoments.BowlerClipId(ResultMomentOutcome.Won), Is.EqualTo("bowl_disappointed"));
            Assert.That(ProductionResultMoments.BowlerClipId(ResultMomentOutcome.LostWicket), Is.EqualTo("bowl_celebrate_defend"));
            Assert.That(ProductionResultMoments.BowlerClipId(ResultMomentOutcome.LostBalls), Is.EqualTo("bowl_celebrate_defend"));
            Assert.That(ProductionResultMoments.StrikerClipId(ResultMomentOutcome.None), Is.Null);
            Assert.That(ProductionResultMoments.BowlerClipId(ResultMomentOutcome.None), Is.Null);
            Assert.That(ProductionResultMoments.ReducedMarker("bat_celebrate_win"), Is.EqualTo("peak"));
            Assert.That(ProductionResultMoments.ReducedMarker("bowl_celebrate_defend"), Is.EqualTo("peak"));
            Assert.That(ProductionResultMoments.ReducedMarker("bat_walk_off"), Is.EqualTo("slump"));
            Assert.That(ProductionResultMoments.ReducedMarker("bowl_disappointed"), Is.EqualTo("slump"));
            Assert.That(ProductionResultMoments.StrikerLatency(ResultMomentOutcome.Won, true), Is.EqualTo(0.20).Within(1e-12));
            Assert.That(ProductionResultMoments.StrikerLatency(ResultMomentOutcome.Won, false), Is.EqualTo(0.30).Within(1e-12));
            Assert.That(ProductionResultMoments.BowlerLatency(ResultMomentOutcome.Won), Is.EqualTo(0.45).Within(1e-12));
            Assert.That(ProductionResultMoments.StrikerLatency(ResultMomentOutcome.LostWicket, false), Is.EqualTo(0.25).Within(1e-12));
            Assert.That(ProductionResultMoments.BowlerLatency(ResultMomentOutcome.LostWicket), Is.EqualTo(0.40).Within(1e-12));
            Assert.That(ProductionResultMoments.StrikerLatency(ResultMomentOutcome.LostBalls, false), Is.EqualTo(0.40).Within(1e-12));
            Assert.That(ProductionResultMoments.BowlerLatency(ResultMomentOutcome.LostBalls), Is.EqualTo(0.60).Within(1e-12));
            // A reaction never starts sooner than 180 ms after the outcome (the Director's honesty rule).
            foreach (var outcome in new[] { ResultMomentOutcome.Won, ResultMomentOutcome.LostWicket, ResultMomentOutcome.LostBalls })
            {
                Assert.That(ProductionResultMoments.StrikerLatency(outcome, true), Is.GreaterThanOrEqualTo(0.18), outcome + " striker (boundary)");
                Assert.That(ProductionResultMoments.StrikerLatency(outcome, false), Is.GreaterThanOrEqualTo(0.18), outcome + " striker");
                Assert.That(ProductionResultMoments.BowlerLatency(outcome), Is.GreaterThanOrEqualTo(0.18), outcome + " bowler");
            }

            Assert.That(ProductionResultMoments.HoldsBatInOneHand("bat_celebrate_win"), Is.True);
            Assert.That(ProductionResultMoments.HoldsBatInOneHand("bat_walk_off"), Is.True);
            Assert.That(ProductionResultMoments.HoldsBatInOneHand("bowl_disappointed"), Is.False);
            Assert.That(ProductionResultMoments.HandOverSeconds, Is.EqualTo(0.26).Within(1e-12));
        }

        [Test]
        public void TheEventThatDecidesTheMoment_IsTheWebsMomentEventT()
        {
            bool boundary;
            // won by a boundary: the boundary; by runs: the last run (a boundary after runs does not move it); with neither: the dead ball.
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.Won, null, Trace(4.4, ("boundary", 4.0)), out boundary), Is.EqualTo(4.0));
            Assert.That(boundary, Is.True);
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.Won, null, Trace(4.0, ("run", 2.0), ("run", 3.0)), out boundary), Is.EqualTo(3.0));
            Assert.That(boundary, Is.False);
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.Won, null, Trace(4.0, ("run", 2.0), ("boundary", 3.5)), out boundary), Is.EqualTo(2.0));
            Assert.That(boundary, Is.False);
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.Won, null, Trace(1.5), out boundary), Is.EqualTo(1.5));
            Assert.That(boundary, Is.False);
            // lost by a wicket: bowled the stumps (else the dead ball), lbw the dead ball plus the umpire's 400 ms, caught the catch, else the keeper's take, else the dead ball.
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostWicket, "bowled", Trace(1.5, ("stumps", 0.9)), out boundary), Is.EqualTo(0.9));
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostWicket, "bowled", Trace(1.5), out boundary), Is.EqualTo(1.5));
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostWicket, "lbw", Trace(1.2, ("pad", 0.7)), out boundary), Is.EqualTo(1.6).Within(1e-12));
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostWicket, "caught", Trace(3.0, ("keeper_take", 1.0), ("catch", 2.0)), out boundary), Is.EqualTo(2.0));
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostWicket, "caught_behind", Trace(3.0, ("keeper_take", 1.0)), out boundary), Is.EqualTo(1.0));
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostWicket, "caught", Trace(3.0), out boundary), Is.EqualTo(3.0));
            // lost on balls: the dead ball, or the last run when that is later.
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostBalls, null, Trace(1.14, ("keeper_take", 0.94)), out boundary), Is.EqualTo(1.14));
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.LostBalls, null, Trace(3.0, ("run", 3.7)), out boundary), Is.EqualTo(3.7));
            Assert.That(boundary, Is.False);
            Assert.That(ProductionResultMoments.EventTime(ResultMomentOutcome.None, null, Trace(3.0), out boundary), Is.EqualTo(0.0));
        }

        [Test]
        public void TheStartIsNeverBeforeTheEvent_TheActorsOwnBusiness_OrTheAccept()
        {
            var rnd = new System.Random(7);
            foreach (var outcome in new[] { ResultMomentOutcome.Won, ResultMomentOutcome.LostWicket, ResultMomentOutcome.LostBalls })
                for (var i = 0; i < 200; i++)
                {
                    var eventT = rnd.NextDouble() * 6.0;
                    var own = rnd.NextDouble() * 8.0;
                    var accept = rnd.NextDouble() * 8.0;
                    var boundary = rnd.Next(2) == 0;
                    var striker = ProductionResultMoments.StrikerStart(outcome, boundary, eventT, own, accept);
                    var bowler = ProductionResultMoments.BowlerStart(outcome, eventT, own, accept);
                    Assert.That(striker, Is.GreaterThanOrEqualTo(eventT + 0.18));
                    Assert.That(striker, Is.GreaterThanOrEqualTo(own));
                    Assert.That(striker, Is.GreaterThanOrEqualTo(accept));
                    Assert.That(striker, Is.EqualTo(Math.Max(Math.Max(own, eventT + ProductionResultMoments.StrikerLatency(outcome, boundary)), accept)));
                    Assert.That(bowler, Is.GreaterThanOrEqualTo(eventT + 0.18));
                    Assert.That(bowler, Is.GreaterThanOrEqualTo(own));
                    Assert.That(bowler, Is.GreaterThanOrEqualTo(accept));
                    // the bowler reacts later than the striker does (he sees the batter react)
                    Assert.That(ProductionResultMoments.BowlerLatency(outcome), Is.GreaterThan(ProductionResultMoments.StrikerLatency(outcome, boundary)));
                }
        }

        [Test]
        public void TheHandOverIsSmooth_StartsAtTheActorAsHeWasAndEndsExactlyOnTheClip()
        {
            Assert.That(ProductionResultMoments.HandOverWeight(0.0, 0.26), Is.EqualTo(0f));
            Assert.That(ProductionResultMoments.HandOverWeight(-1.0, 0.26), Is.EqualTo(0f));
            Assert.That(ProductionResultMoments.HandOverWeight(0.26, 0.26), Is.EqualTo(1f));
            Assert.That(ProductionResultMoments.HandOverWeight(5.0, 0.26), Is.EqualTo(1f));
            Assert.That(ProductionResultMoments.HandOverWeight(0.259, 0.26), Is.GreaterThan(0.97f));
            var previous = 0f;
            var biggest = 0f;
            for (var step = 1; step <= 26; step++)
            {
                var w = ProductionResultMoments.HandOverWeight(step / 100.0, 0.26);
                Assert.That(w, Is.GreaterThanOrEqualTo(previous), "monotone at " + step);
                biggest = Math.Max(biggest, w - previous);
                previous = w;
            }

            // at 100 Hz the biggest step of the weight is under 14% of the whole distance: a bone 180 degrees away moves under 25 degrees a 60 Hz frame
            Assert.That(ProductionResultMoments.HandOverWeight(1.0 / 60.0, 0.26) - 0f, Is.LessThan(0.14f));
            Assert.That(ProductionResultMoments.HandOverWeight(1.0 / 60.0 * 3, 0.26) - ProductionResultMoments.HandOverWeight(1.0 / 60.0 * 2, 0.26), Is.LessThan(0.14f));
        }

        [Test]
        public void TheHandOverIsLongerForABoneWithFarToTurn_SoNoBoneStepsOverItsPopFloor()
        {
            // 110 degrees of hips (floor 10) need 0.48 s; a bone with little to turn needs less than the usual 0.26 s (the caller takes the larger)
            Assert.That(ProductionResultMoments.HandOverSecondsFor(110.0, 10.0), Is.EqualTo(0.484).Within(0.005));
            Assert.That(ProductionResultMoments.HandOverSecondsFor(30.0, 10.0), Is.LessThan(ProductionResultMoments.HandOverSeconds));
            Assert.That(ProductionResultMoments.HandOverSecondsFor(0.0, 10.0), Is.EqualTo(0.0));
            Assert.That(ProductionResultMoments.HandOverSecondsFor(400.0, 10.0), Is.EqualTo(ProductionResultMoments.MaxHandOverSeconds), "never longer than a second");
            Assert.That(ProductionResultMoments.PopFloorDegrees(0), Is.EqualTo(10.0), "hips");
            Assert.That(ProductionResultMoments.PopFloorDegrees(4), Is.EqualTo(12.0), "head");
            Assert.That(ProductionResultMoments.PopFloorDegrees(6), Is.EqualTo(25.0), "forearm");
            Assert.That(ProductionResultMoments.PopFloorDegrees(12), Is.EqualTo(20.0), "shin");
            foreach (var floor in new[] { 10.0, 12.0, 20.0, 25.0 })
                for (var angle = 10.0; angle <= 180.0; angle += 10.0)
                {
                    var seconds = Math.Max(ProductionResultMoments.HandOverSeconds, ProductionResultMoments.HandOverSecondsFor(angle, floor));
                    if (seconds >= ProductionResultMoments.MaxHandOverSeconds) continue;
                    var steepest = 0.0;
                    var previous = 0.0;
                    for (var frame = 1; frame <= (int)(seconds * 60) + 2; frame++)
                    {
                        var w = ProductionResultMoments.HandOverWeight(frame / 60.0, seconds);
                        steepest = Math.Max(steepest, w - previous);
                        previous = w;
                    }

                    Assert.That(steepest * angle, Is.LessThanOrEqualTo(0.9 * floor), angle + " degrees of a bone with a floor of " + floor + " over " + seconds.ToString("0.000") + " s");
                }
        }

        [Test]
        public void TheWalkOffTurnsTheShortWayToTheStanceHeadingAndNoFaster()
        {
            Assert.That(ProductionResultMoments.WalkOffYaw(10f, 10f, 0.3), Is.EqualTo(10f));
            Assert.That(ProductionResultMoments.WalkOffYaw(0f, 90f, 0.0), Is.EqualTo(0f).Within(1e-4));
            Assert.That(ProductionResultMoments.WalkOffYaw(0f, 90f, 0.9), Is.EqualTo(90f).Within(1e-4));
            Assert.That(ProductionResultMoments.WalkOffYaw(0f, 90f, 5.0), Is.EqualTo(90f).Within(1e-4));
            // from 170 to -170 the short way is +20 degrees through 180, not -340
            Assert.That(ProductionResultMoments.WalkOffYaw(170f, -170f, 0.45), Is.EqualTo(180f).Within(1e-3));
            Assert.That(ProductionResultMoments.WalkOffYaw(170f, -170f, 5.0), Is.EqualTo(190f).Within(1e-3));
            // no faster than a smooth 90 degree turn in 0.9 s: 1.5 times the average, 150 degrees a second
            var last = 0f;
            for (var frame = 1; frame <= 54; frame++)
            {
                var yaw = ProductionResultMoments.WalkOffYaw(0f, 90f, frame / 60.0);
                Assert.That((yaw - last) * 60f, Is.LessThanOrEqualTo(155f));
                last = yaw;
            }
        }

        [Test]
        public void TheFourClipsComeOutOfThePackAsTheWebBakedThem_OneShotsWithTheirMarkersAndTheBat()
        {
            var pack = ProductionMotionPacks.Get(ProductionResultMoments.Pack);
            Assert.That(pack, Is.Not.Null, "Resources/Motion/result_moments.bytes is shipped and parses");
            var expected = new[]
            {
                new object[] { "bat_celebrate_win", 3.6f, "peak", 0.95f, true },
                new object[] { "bat_walk_off", 5.4f, "slump", 0.90f, true },
                new object[] { "bowl_celebrate_defend", 3.4f, "peak", 0.85f, false },
                new object[] { "bowl_disappointed", 3.4f, "slump", 0.70f, false }
            };
            foreach (var row in expected)
            {
                var clip = ProductionMotionPacks.Clip(ProductionResultMoments.Pack, (string)row[0]);
                Assert.That(clip, Is.Not.Null, (string)row[0]);
                Assert.That(clip.Loop, Is.False, row[0] + " is a one-shot that holds its last frame");
                Assert.That(clip.Duration, Is.EqualTo((float)row[1]).Within(0.02f), row[0] + " duration");
                float marker;
                Assert.That(clip.TryGetMarker((string)row[2], out marker), Is.True, row[0] + " carries its Reduced Motion marker");
                Assert.That(marker, Is.EqualTo((float)row[3]).Within(0.02f), row[0] + " marker time");
                Assert.That(ProductionResultMoments.ReducedMarker((string)row[0]), Is.EqualTo((string)row[2]));
                var pose = new ProductionPackPose(pack.MaxTrackCount);
                pose.SampleInto(clip, 0.5, false);
                Vector3 cap, toe, face;
                Assert.That(pose.TryGetBatCapToe(0.86f, out cap, out toe, out face), Is.EqualTo((bool)row[4]),
                    row[0] + (ProductionResultMoments.HoldsBatInOneHand((string)row[0]) ? " carries the bat in the bottom hand" : " has no bat"));
                // reduced motion samples the marker; a normal sample clamps to the clip's end
                Assert.That(ProductionResultMoments.SampleTime(clip, 0.1, true, (string)row[2]), Is.EqualTo(marker).Within(1e-6));
                Assert.That(ProductionResultMoments.SampleTime(clip, 99.0, false, (string)row[2]), Is.EqualTo(clip.Duration).Within(1e-6));
                Assert.That(ProductionResultMoments.SampleTime(clip, -1.0, false, (string)row[2]), Is.EqualTo(0.0));
            }

            // the walk-off's ground track: 2.45 m straight ahead (+z), no turn
            var walk = ProductionMotionPacks.Clip(ProductionResultMoments.Pack, "bat_walk_off");
            var ground = new ProductionPackPose(pack.MaxTrackCount);
            ground.SampleInto(walk, 0.0, false);
            var start = ground.Ground;
            ground.SampleInto(walk, walk.Duration, false);
            var end = ground.Ground;
            Assert.That(end.z - start.z, Is.EqualTo(2.45f * 0.9836f).Within(0.03f));
            Assert.That(Math.Abs(end.x - start.x), Is.LessThan(0.03f));
            // a left-hander mirrors the clip's x, not its z
            ground.SampleInto(walk, walk.Duration, true);
            Assert.That(ground.Ground.z - start.z, Is.EqualTo(end.z - start.z).Within(1e-4f));
        }

        // ======================================================================== the world

        private const double Step = 1.0 / 60.0;
        private static readonly int JointCount = (int)ProductionCharacterJoint.Count;

        private enum Phase { Live, Replay }

        private sealed class Spec
        {
            public string Case = "complete-miss";
            public string Hand = "right";
            public string BowlerArm;
            public bool Leave = true;
            public PracticeChaseOutcome? Chase;
            public bool Reduced;
            public bool Director;
            public bool Enabled = true;
            public bool Replay;
            public int MinFramesAfterAccept = 420;
            /// <summary>A chase scenario of tests/fixtures/unity-practice/chase-v7.json (won, lost-balls, in-progress): the result is the real host.result packet of that scenario, parsed by the contract adapter, not a verdict set by hand.</summary>
            public string Wire;
            /// <summary>The dismissal the result carries (bowled, caught, caught_behind, lbw): the fielders' reactions and the moment's event time follow it.</summary>
            public string Dismissal;

            public string Key => string.Join("|", Case, Hand, BowlerArm ?? "-", Leave, Chase.HasValue ? Chase.Value.ToString() : "none",
                Reduced, Director, Enabled, Replay, Wire ?? "-", Dismissal ?? "-");
        }

        private sealed class Frame
        {
            public double Timeline;
            public double Clock;
            public string State;
            public Quaternion[] BowlerDriver, StrikerDriver, BowlerVisible, StrikerVisible;
            public Vector3 BowlerHips, StrikerHips, BowlerRoot, StrikerRoot, Bat;
            public bool OneHand;
            public float PalmGap;
            /// <summary>The holder arm of the striker (the bottom hand): its length, shoulder to the palm's grip target, shoulder to the wrist, and the elbow's bend (degrees from straight).</summary>
            public float ArmLength, ShoulderToTarget, ShoulderToWrist, ElbowBend;
            /// <summary>How far the bat stands from the clip's key (the grip in cm, the blade's direction in degrees).</summary>
            public float BatKeyGripCm, BatKeyAngle;
        }

        private sealed class Moment
        {
            public string Clip;
            public double StartT = double.NaN;
            public int BeganFrame = -1;
            public double BeganAt = double.NaN;
        }

        private sealed class Capture
        {
            public readonly List<Frame> Frames = new List<Frame>();
            public int AcceptFrame = -1;
            public int ReplayAcceptFrame = -1;
            public readonly Moment[] Striker = { new Moment(), new Moment() };
            public readonly Moment[] Bowler = { new Moment(), new Moment() };
            public double EventT;
            public bool Boundary;
            public double StrikerScale = 1.0;
            public ProductionCharacterHandedness StrikerHandedness;
            public bool StrikerPlanned(Phase phase) => Striker[(int)phase].Clip != null;
        }

        private static readonly Dictionary<string, Capture> Cache = new Dictionary<string, Capture>();
        private static Fixture fixtureCache;

        private static Fixture LoadFixture()
        {
            if (fixtureCache != null) return fixtureCache;
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            fixtureCache = JsonUtility.FromJson<Fixture>(File.ReadAllText(path));
            return fixtureCache;
        }

        // ---- the host.result of a chase scenario, as the wire carries it (the recipe of chase-v7.json: exact text edits of the Practice packet) ----

        private static ChaseFixture chaseFixtureCache;

        private static ChaseScenario ScenarioOf(string id)
        {
            if (chaseFixtureCache == null)
            {
                var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "chase-v7.json"));
                chaseFixtureCache = JsonUtility.FromJson<ChaseFixture>(File.ReadAllText(path));
            }

            return chaseFixtureCache.scenarios.Single(scenario => scenario.id == id);
        }

        private static string Once(string haystack, string needle, string replacement)
        {
            var at = haystack.IndexOf(needle, StringComparison.Ordinal);
            Assert.That(at, Is.GreaterThanOrEqualTo(0), needle);
            Assert.That(haystack.IndexOf(needle, at + 1, StringComparison.Ordinal), Is.EqualTo(-1), needle + " occurs twice");
            return haystack.Substring(0, at) + replacement + haystack.Substring(at + needle.Length);
        }

        private static string WireResultBody(ChaseScenario scenario, string baseBody)
        {
            var score = "{\"balls\":" + scenario.score.balls + ",\"maxOvers\":" + scenario.score.maxOvers + ",\"runs\":" + scenario.score.runs + ",\"wickets\":" + scenario.score.wickets + "}";
            var chase = scenario.after;
            var block = "{\"ballsLeft\":" + chase.ballsLeft + ",\"maxBalls\":" + chase.maxBalls + ",\"outcome\":\"" + chase.outcome + "\",\"requiredRateX100\":" +
                        (chase.outcome == "in_progress" ? chase.requiredRateX100.ToString() : "null") + ",\"runsNeeded\":" + chase.runsNeeded + ",\"target\":" + chase.target + "}";
            const string key = "\"score\":{";
            var start = baseBody.IndexOf(key, StringComparison.Ordinal);
            Assert.That(start, Is.GreaterThanOrEqualTo(0));
            var end = baseBody.IndexOf('}', start);
            var withScore = baseBody.Substring(0, start) + "\"score\":" + score + baseBody.Substring(end + 1);
            return Once(withScore, "\"payload\":{", "\"payload\":{\"chase\":" + block + ",");
        }

        private static PracticeResultPresentation WireResult(string scenarioId, Case item)
        {
            var scenario = ScenarioOf(scenarioId);
            Assert.That(item.id, Is.EqualTo(scenario.baseCase), "the scenario sits on its own base ball");
            var body = WireResultBody(scenario, item.wire.packets.result.body);
            var packet = new UnityPracticePacket { body = body, sha256 = Sha256Digest.OfUtf8(body) };
            return PracticePresentationContractAdapter.ResultFromValidated(UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope);
        }

        private static void MakeLeave(PracticeResultPresentation result)
        {
            result.ShotIntent = "leave";
            result.SwingStartT = null;
            result.SwingDirectionDeg = 0.0;
            result.Footwork = null;
            result.ContactKind = "leave";
            result.ContactTiming = "none";
            result.Trace.bat = new BatTraceSample[0];
            result.Trace.batterMotion = null;
            result.Trace.batterRootOffset = new TraceVector2 { x = 0.0, z = 0.0 };
            result.Trace.batterPosture = new TraceBatterPosture { crouchM = 0.0 };
        }

        private static Capture Play(Spec spec)
        {
            Capture cached;
            if (Cache.TryGetValue(spec.Key, out cached)) return cached;
            var capture = new Capture();
            var item = LoadFixture().cases.Single(c => c.id == spec.Case);
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = spec.Hand;
            if (spec.BowlerArm != null) scene.BowlerArm = spec.BowlerArm;
            if (spec.Wire != null) result = WireResult(spec.Wire, item);
            if (spec.Dismissal != null) result.Dismissal = spec.Dismissal;
            if (spec.Leave) MakeLeave(result);
            if (spec.Chase.HasValue)
            {
                var decided = spec.Chase.Value != PracticeChaseOutcome.InProgress;
                result.Chase = new PracticeChasePresentation
                {
                    Target = 20,
                    MaxBalls = 12,
                    RunsNeeded = decided ? (spec.Chase.Value == PracticeChaseOutcome.Won ? 0 : 6) : 6,
                    BallsLeft = decided ? 0 : 4,
                    Outcome = spec.Chase.Value
                };
            }

            var root = new GameObject("result moments test");
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = spec.Hand,
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.Standard,
                    ReducedMotion = spec.Reduced
                }, new NullSink());
                world.DirectorEnabled = spec.Director;
                world.ResultMomentsEnabled = spec.Enabled;
                world.ConfigureScene(scene);
                var humans = world.PresentedHumansForEvidence();
                var striker = humans.First(pair => pair.Key == "striker").Value;
                var bowler = humans.First(pair => pair.Key == "bowler").Value;
                capture.StrikerHandedness = striker.Handedness;
                Action tick = () =>
                {
                    world.Tick(Step);
                    capture.Frames.Add(Record(world, striker, bowler));
                    Watch(world, capture, capture.Frames.Count - 1);
                };
                for (var k = 0; k < 90; k++) tick();
                world.BeginDelivery(delivery);
                var flightEnd = delivery.Flight[delivery.Flight.Length - 1].t;
                var swingStart = spec.Leave ? 0.15 : (result.SwingStartT ?? 0.15);
                while (world.TimelineForEvidence < swingStart - 1e-9) tick();
                if (!spec.Leave) world.BeginLocalPreparation();
                var committed = false;
                var accepted = false;
                var countdown = 6;
                for (var guard = 0; guard < 3000; guard++)
                {
                    if (!spec.Leave && !committed && world.TimelineForEvidence >= swingStart + 0.05 - 1e-9)
                    {
                        world.ApplyProvisionalSwing(new PracticeSwingPresentation
                        {
                            Kind = "attack",
                            StartT = swingStart,
                            DirectionDeg = result.SwingDirectionDeg,
                            Power = 0.7,
                            Elevation = 0.1,
                            Footwork = string.IsNullOrEmpty(result.Footwork) ? "auto" : result.Footwork
                        });
                        committed = true;
                    }

                    var ready = spec.Leave ? world.TimelineForEvidence >= flightEnd - 1e-9 : committed;
                    if (!accepted && ready)
                    {
                        if (countdown <= 0)
                        {
                            world.AcceptResult(result);
                            accepted = true;
                            capture.AcceptFrame = capture.Frames.Count;
                            capture.StrikerScale = striker.Root.localScale.x;
                        }
                        else countdown--;
                    }

                    tick();
                    if (accepted && Finished(capture, capture.AcceptFrame, Phase.Live, spec.MinFramesAfterAccept)) break;
                }

                Assert.That(accepted, Is.True, spec.Key + ": the result was accepted");
                if (spec.Replay)
                {
                    result.IsReplay = true;
                    world.AcceptResult(result);
                    capture.ReplayAcceptFrame = capture.Frames.Count;
                    for (var guard = 0; guard < 2000; guard++)
                    {
                        tick();
                        if (Finished(capture, capture.ReplayAcceptFrame, Phase.Replay, spec.MinFramesAfterAccept)) break;
                    }
                }

                bool boundary;
                var chase = result.Chase;
                var outcome = chase == null || !chase.Decided
                    ? ResultMomentOutcome.None
                    : chase.Outcome == PracticeChaseOutcome.Won ? ResultMomentOutcome.Won
                    : chase.Outcome == PracticeChaseOutcome.LostWicket ? ResultMomentOutcome.LostWicket : ResultMomentOutcome.LostBalls;
                capture.EventT = ProductionResultMoments.EventTime(outcome, result.Dismissal, result.Trace, out boundary);
                capture.Boundary = boundary;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            foreach (var phase in new[] { Phase.Live, Phase.Replay })
            {
                if (phase == Phase.Replay && !spec.Replay) continue;
                var striker = capture.Striker[(int)phase];
                var bowler = capture.Bowler[(int)phase];
                if (striker.Clip == null && bowler.Clip == null) continue;
                Debug.Log("UC-TIMING " + spec.Key + " " + phase + ": event at " + capture.EventT.ToString("0.000") + " s" + (capture.Boundary ? " (boundary)" : "") +
                          "; striker " + striker.Clip + " earliest " + striker.StartT.ToString("0.000") + " s, began " + striker.BeganAt.ToString("0.000") + " s" +
                          "; bowler " + bowler.Clip + " earliest " + bowler.StartT.ToString("0.000") + " s, began " + bowler.BeganAt.ToString("0.000") + " s");
            }

            Cache[spec.Key] = capture;
            return capture;
        }

        /// <summary>Done when the ball is over and every planned moment has begun and played out (clip, hand-over and a second of hold).</summary>
        private static bool Finished(Capture capture, int acceptFrame, Phase phase, int minFrames)
        {
            if (capture.Frames.Count - acceptFrame < minFrames) return false;
            var planned = capture.Striker[(int)phase].Clip != null || capture.Bowler[(int)phase].Clip != null;
            if (!planned) return true;
            var last = capture.Frames[capture.Frames.Count - 1];
            foreach (var moment in new[] { capture.Striker[(int)phase], capture.Bowler[(int)phase] })
            {
                if (moment.Clip == null) continue;
                if (moment.BeganFrame < 0) return false;
                var duration = moment.Clip == "bat_walk_off" ? 5.4 : moment.Clip == "bat_celebrate_win" ? 3.6 : 3.4;
                if (last.Clock - moment.BeganAt < duration + 1.0) return false;
            }

            return true;
        }

        private static void Watch(ProceduralPracticeWorld world, Capture capture, int frame)
        {
            var phase = capture.ReplayAcceptFrame >= 0 ? Phase.Replay : Phase.Live;
            if (capture.AcceptFrame < 0) return;
            foreach (var role in new[] { "striker", "bowler" })
            {
                string clip;
                double startT, beganAt;
                bool started;
                var planned = world.ResultMomentForEvidence(role, out clip, out startT, out started, out beganAt);
                var moment = (role == "striker" ? capture.Striker : capture.Bowler)[(int)phase];
                if (!planned) continue;
                moment.Clip = clip;
                moment.StartT = startT;
                if (started && moment.BeganFrame < 0)
                {
                    moment.BeganFrame = frame;
                    moment.BeganAt = beganAt;
                }
            }
        }

        private static Frame Record(ProceduralPracticeWorld world, ProductionCharacterRig striker, ProductionCharacterRig bowler)
        {
            var frame = new Frame
            {
                Timeline = world.TimelineForEvidence,
                Clock = world.ResultMomentClockForEvidence,
                State = world.StateForEvidence,
                BowlerDriver = new Quaternion[JointCount],
                StrikerDriver = new Quaternion[JointCount],
                BowlerVisible = new Quaternion[JointCount],
                StrikerVisible = new Quaternion[JointCount],
                BowlerHips = bowler.VisibleJointWorldPosition(ProductionCharacterJoint.Hips),
                StrikerHips = striker.VisibleJointWorldPosition(ProductionCharacterJoint.Hips),
                BowlerRoot = bowler.Root.position,
                StrikerRoot = striker.Root.position,
                Bat = striker.Bat != null ? striker.Bat.position : Vector3.zero,
                OneHand = striker.BatterOneHandCarry,
                BatKeyGripCm = world.ResultMomentBatGripCentimetresForEvidence,
                BatKeyAngle = world.ResultMomentBatAngleForEvidence
            };
            for (var j = 0; j < JointCount; j++)
            {
                var joint = (ProductionCharacterJoint)j;
                frame.BowlerDriver[j] = bowler.Joint(joint).localRotation;
                frame.StrikerDriver[j] = striker.Joint(joint).localRotation;
                frame.BowlerVisible[j] = bowler.VisibleJointWorldRotation(joint);
                frame.StrikerVisible[j] = striker.VisibleJointWorldRotation(joint);
            }

            if (striker.VisibleHeroSkeletonActive && striker.Bat != null)
            {
                var bottomLeft = striker.Handedness != ProductionCharacterHandedness.Right;
                frame.PalmGap = Vector3.Distance(striker.HeroHandWorldPosition(bottomLeft), striker.HeroBatterGripTargetWorld(bottomLeft));
                var shoulder = striker.HeroJointWorldPosition(bottomLeft ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight);
                var elbow = striker.HeroJointWorldPosition(bottomLeft ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight);
                var wrist = striker.HeroJointWorldPosition(bottomLeft ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight);
                frame.ArmLength = Vector3.Distance(shoulder, elbow) + Vector3.Distance(elbow, wrist);
                frame.ShoulderToWrist = Vector3.Distance(shoulder, wrist);
                frame.ShoulderToTarget = Vector3.Distance(shoulder, striker.HeroBatterGripTargetWorld(bottomLeft));
                frame.ElbowBend = 180f - Vector3.Angle(shoulder - elbow, wrist - elbow);
            }

            return frame;
        }

        // ---------------------------------------------------------------------------------------- measures

        private static readonly int[] Parent = { -1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15 };

        private static double CapDegreesPerSecond(int joint)
        {
            switch ((ProductionCharacterJoint)joint)
            {
                case ProductionCharacterJoint.UpperArmLeft:
                case ProductionCharacterJoint.UpperArmRight:
                case ProductionCharacterJoint.ForearmLeft:
                case ProductionCharacterJoint.ForearmRight:
                case ProductionCharacterJoint.HandLeft:
                case ProductionCharacterJoint.HandRight:
                    return 1800.0;
                case ProductionCharacterJoint.Hips:
                case ProductionCharacterJoint.Spine:
                case ProductionCharacterJoint.Chest:
                    return 600.0;
                case ProductionCharacterJoint.Neck:
                case ProductionCharacterJoint.Head:
                    return 720.0;
                default:
                    return 1200.0;
            }
        }

        private static Quaternion Local(Quaternion[] world, int joint) =>
            Parent[joint] < 0 ? world[joint] : Quaternion.Inverse(world[Parent[joint]]) * world[joint];

        /// <summary>
        /// The pop definitions of MOTION-SPEC section 9 (the UNITY-9 scanner, CLP-04): a bone's rotation step in one frame at or above the smaller of
        /// 25 degrees and its cap a frame AND at least 3 times its quiet neighbours (the second smallest of the steps two frames either side), any
        /// step of 60 degrees, the hips jumping 5 cm in the change of their displacement, the head turning over 720 degrees a second in the world.
        /// </summary>
        private static List<string> Pops(Capture capture, bool striker, int from, int to)
        {
            var pops = new List<string>();
            from = Math.Max(2, from);
            to = Math.Min(capture.Frames.Count - 1, to);
            Func<int, Quaternion[]> visible = i => striker ? capture.Frames[i].StrikerVisible : capture.Frames[i].BowlerVisible;
            Func<int, Vector3> hips = i => striker ? capture.Frames[i].StrikerHips : capture.Frames[i].BowlerHips;
            var steps = new float[JointCount][];
            for (var j = 0; j < JointCount; j++)
            {
                steps[j] = new float[capture.Frames.Count];
                for (var i = 1; i < capture.Frames.Count; i++) steps[j][i] = Quaternion.Angle(Local(visible(i - 1), j), Local(visible(i), j));
            }

            for (var j = 0; j < JointCount; j++)
            {
                var floor = Math.Min(25.0, CapDegreesPerSecond(j) / 60.0);
                for (var i = from; i <= to; i++)
                {
                    var s = steps[j][i];
                    if (s >= 60f) pops.Add("HUGE " + (ProductionCharacterJoint)j + " frame " + i + " " + s.ToString("0.0") + " deg");
                    else if (s >= floor)
                    {
                        var neighbours = new List<float>();
                        foreach (var d in new[] { -2, -1, 1, 2 })
                            if (i + d >= 1 && i + d < capture.Frames.Count) neighbours.Add(steps[j][i + d]);
                        neighbours.Sort();
                        var reference = neighbours.Count == 0 ? 0f : neighbours[Math.Min(1, neighbours.Count - 1)];
                        if (s >= 3.0 * reference) pops.Add("SPIKE " + (ProductionCharacterJoint)j + " frame " + i + " " + s.ToString("0.0") + " deg (quiet " + reference.ToString("0.0") + ")");
                    }
                }
            }

            for (var i = Math.Max(2, from); i <= to; i++)
            {
                var jump = ((hips(i) - hips(i - 1)) - (hips(i - 1) - hips(i - 2))).magnitude;
                if (jump > 0.05) pops.Add("HIPSJUMP frame " + i + " " + (jump * 100.0).ToString("0.0") + " cm");
            }

            Func<int, Vector3> root = i => striker ? capture.Frames[i].StrikerRoot : capture.Frames[i].BowlerRoot;
            for (var i = Math.Max(2, from); i <= to; i++)
            {
                var jump = ((root(i) - root(i - 1)) - (root(i - 1) - root(i - 2))).magnitude;
                if (jump > 0.05) pops.Add("ROOTJUMP frame " + i + " " + (jump * 100.0).ToString("0.0") + " cm");
            }

            var head = (int)ProductionCharacterJoint.Head;
            for (var i = from; i <= to; i++)
            {
                var speed = Quaternion.Angle(visible(i - 1)[head], visible(i)[head]) * 60.0;
                if (speed > 720.0) pops.Add("HEADWORLD frame " + i + " " + speed.ToString("0") + " deg/s");
            }

            return pops;
        }

        /// <summary>The kind, bone and frame of a pop as <see cref="Pops"/> writes it ("SPIKE ShinLeft frame 346"), and its size (degrees, centimetres or degrees a second).</summary>
        private static bool PopParts(string pop, out string key, out double size)
        {
            key = pop;
            size = 0.0;
            var parts = pop.Split(' ');
            var at = Array.IndexOf(parts, "frame");
            if (at < 0 || at + 2 >= parts.Length) return false;
            key = string.Join(" ", parts, 0, at + 2);
            return double.TryParse(parts[at + 2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out size);
        }

        /// <summary>
        /// A pop of the chase run is the control's own when the control has one of the same kind at the same bone and frame that is no more than a degree smaller. The "quiet" figure a spike is compared
        /// with takes in the frames either side, which a clip changes once it begins, so the same step before the clip can carry another quiet figure in the two runs: the strings are not compared whole.
        /// </summary>
        private static bool IsTheControlsPop(string pop, List<string> control)
        {
            string key;
            double size;
            if (!PopParts(pop, out key, out size)) return control.Contains(pop);
            foreach (var other in control)
            {
                string otherKey;
                double otherSize;
                if (PopParts(other, out otherKey, out otherSize) && otherKey == key && size <= otherSize + 1.0) return true;
            }

            return false;
        }

        /// <summary>The striker's driver joints the grip solve never writes: the trunk and the legs (it solves the arm that holds the bat).</summary>
        private static readonly ProductionCharacterJoint[] TrunkAndLegs =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest,
            ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ShinLeft, ProductionCharacterJoint.FootLeft,
            ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.ShinRight, ProductionCharacterJoint.FootRight
        };

        /// <summary>Builder diagnosis: the striker's frames around a clip as a table (written to the temp folder; the path goes into the failure message).</summary>
        private static string Dump(Capture capture, string tag)
        {
            var folder = Path.Combine(Path.GetTempPath(), "vande-uc-dump");
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, tag.Replace('|', '_') + ".tsv");
            var arms = new[]
            {
                ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft,
                ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight
            };
            var sb = new StringBuilder("frame\tclock\tstate\toneHand\tpalmGap_cm\treach_to_target\treach_wrist\tbend_deg\tarmLen\t" +
                                       string.Join("\t", arms.Select(a => "v_" + a)) + "\t" + string.Join("\t", arms.Select(a => "d_" + a)) +
                                       "\trootX\trootZ\thipsX\thipsY\thipsZ\tbatX\tbatY\tbatZ\tbatKeyGap_cm\tbatKeyAngle_deg\n");
            for (var i = 1; i < capture.Frames.Count; i++)
            {
                var f = capture.Frames[i];
                var p = capture.Frames[i - 1];
                sb.Append(i).Append('\t').Append(f.Clock.ToString("0.0000")).Append('\t').Append(f.State).Append('\t').Append(f.OneHand ? 1 : 0).Append('\t')
                    .Append((f.PalmGap * 100f).ToString("0.00")).Append('\t')
                    .Append(f.ArmLength > 0f ? (f.ShoulderToTarget / f.ArmLength).ToString("0.000") : "-").Append('\t')
                    .Append(f.ArmLength > 0f ? (f.ShoulderToWrist / f.ArmLength).ToString("0.000") : "-").Append('\t')
                    .Append(f.ElbowBend.ToString("0.0")).Append('\t').Append(f.ArmLength.ToString("0.000"));
                foreach (var a in arms) sb.Append('\t').Append(Quaternion.Angle(Local(p.StrikerVisible, (int)a), Local(f.StrikerVisible, (int)a)).ToString("0.0"));
                foreach (var a in arms) sb.Append('\t').Append(Quaternion.Angle(p.StrikerDriver[(int)a], f.StrikerDriver[(int)a]).ToString("0.0"));
                sb.Append('\t').Append(f.StrikerRoot.x.ToString("0.000")).Append('\t').Append(f.StrikerRoot.z.ToString("0.000"))
                    .Append('\t').Append(f.StrikerHips.x.ToString("0.000")).Append('\t').Append(f.StrikerHips.y.ToString("0.000")).Append('\t').Append(f.StrikerHips.z.ToString("0.000"))
                    .Append('\t').Append(f.Bat.x.ToString("0.000")).Append('\t').Append(f.Bat.y.ToString("0.000")).Append('\t').Append(f.Bat.z.ToString("0.000"))
                    .Append('\t').Append(f.BatKeyGripCm.ToString("0.0")).Append('\t').Append(f.BatKeyAngle.ToString("0.0")).Append('\n');
            }

            File.WriteAllText(path, sb.ToString());
            return path;
        }

        private static float MaxAngle(Quaternion[] a, Quaternion[] b)
        {
            var most = 0f;
            for (var j = 0; j < a.Length; j++) most = Math.Max(most, Quaternion.Angle(a[j], b[j]));
            return most;
        }

        private static string Differs(Frame a, Frame b)
        {
            if (a.State != b.State) return "state " + a.State + " / " + b.State;
            if (MaxAngle(a.BowlerVisible, b.BowlerVisible) > 0.1f) return "bowler visible " + MaxAngle(a.BowlerVisible, b.BowlerVisible).ToString("0.000") + " deg";
            if (MaxAngle(a.StrikerVisible, b.StrikerVisible) > 0.1f) return "striker visible " + MaxAngle(a.StrikerVisible, b.StrikerVisible).ToString("0.000") + " deg";
            if (MaxAngle(a.BowlerDriver, b.BowlerDriver) > 0.1f) return "bowler driver " + MaxAngle(a.BowlerDriver, b.BowlerDriver).ToString("0.000") + " deg";
            if (MaxAngle(a.StrikerDriver, b.StrikerDriver) > 0.1f) return "striker driver " + MaxAngle(a.StrikerDriver, b.StrikerDriver).ToString("0.000") + " deg";
            if ((a.BowlerRoot - b.BowlerRoot).magnitude > 1e-4f) return "bowler root";
            if ((a.StrikerRoot - b.StrikerRoot).magnitude > 1e-4f) return "striker root";
            if ((a.Bat - b.Bat).magnitude > 1e-4f) return "bat " + (a.Bat - b.Bat).magnitude.ToString("0.0000");
            return null;
        }

        private static Spec Won() => new Spec { Case = "deliberate-loft", Leave = false, Chase = PracticeChaseOutcome.Won };
        private static Spec WonControl() => new Spec { Case = "deliberate-loft", Leave = false, Chase = null };
        private static Spec Lost(string hand = "right") => new Spec { Case = "complete-miss", Leave = true, Hand = hand, Chase = PracticeChaseOutcome.LostBalls };

        private static ProductionPackPose Clip(string id, out VmpClip clip)
        {
            clip = ProductionMotionPacks.Clip(ProductionResultMoments.Pack, id);
            return new ProductionPackPose(ProductionMotionPacks.Get(ProductionResultMoments.Pack).MaxTrackCount);
        }

        // ---------------------------------------------------------------------------------------- the tests

        [Test]
        public void TheWin_StrikerCelebratesAndBowlerIsBeaten_AfterTheBoundaryAndTheirOwnBusiness()
        {
            var capture = Play(Won());
            var striker = capture.Striker[(int)Phase.Live];
            var bowler = capture.Bowler[(int)Phase.Live];
            Assert.That(striker.Clip, Is.EqualTo("bat_celebrate_win"));
            Assert.That(bowler.Clip, Is.EqualTo("bowl_disappointed"));
            Assert.That(capture.Boundary, Is.True, "the golden six is won on a boundary");
            Assert.That(capture.EventT, Is.GreaterThan(2.0), "the boundary comes late in the ball's flight");
            Assert.That(striker.StartT, Is.GreaterThanOrEqualTo(capture.EventT + 0.2 - 1e-9), "not before the boundary and his 200 ms");
            Assert.That(bowler.StartT, Is.GreaterThanOrEqualTo(capture.EventT + 0.45 - 1e-9), "not before the boundary and his 450 ms");
            Assert.That(striker.BeganFrame, Is.GreaterThan(capture.AcceptFrame), "the striker's clip began");
            Assert.That(bowler.BeganFrame, Is.GreaterThan(capture.AcceptFrame), "the bowler's clip began");
            Assert.That(bowler.BeganAt - bowler.StartT, Is.InRange(-1e-9, 2.0 * Step + 1e-9), "the bowler begins on the first frame at or after his start");
            Assert.That(striker.BeganAt - striker.StartT, Is.InRange(-1e-9, 0.5), "the striker begins at his start, or a few frames later while another hand-over settles");
            Assert.That(striker.BeganAt, Is.GreaterThanOrEqualTo(capture.EventT + 0.18), "never sooner than 180 ms after the outcome");
            Assert.That(bowler.BeganAt, Is.GreaterThanOrEqualTo(capture.EventT + 0.18));
            Assert.That(capture.Frames[striker.BeganFrame].OneHand, Is.True, "the bat is carried in the bottom hand only");
        }

        [Test]
        public void NothingChangesBeforeTheirMoment_AndAChaseInProgressOrNoChaseDrawsTheSameFrames()
        {
            var moment = Play(Won());
            var control = Play(WonControl());
            var striker = moment.Striker[(int)Phase.Live];
            var bowler = moment.Bowler[(int)Phase.Live];
            var untilBowler = Math.Min(bowler.BeganFrame, control.Frames.Count);
            for (var i = 0; i < untilBowler; i++)
            {
                var a = moment.Frames[i];
                var b = control.Frames[i];
                Assert.That(MaxAngle(a.BowlerVisible, b.BowlerVisible), Is.LessThan(0.1f), "bowler visible, frame " + i + " of " + untilBowler);
                Assert.That(MaxAngle(a.BowlerDriver, b.BowlerDriver), Is.LessThan(0.1f), "bowler driver, frame " + i);
                Assert.That((a.BowlerRoot - b.BowlerRoot).magnitude, Is.LessThan(1e-4f), "bowler root, frame " + i);
            }

            var untilStriker = Math.Min(striker.BeganFrame, control.Frames.Count);
            for (var i = 0; i < untilStriker; i++)
                Assert.That(MaxAngle(moment.Frames[i].StrikerVisible, control.Frames[i].StrikerVisible), Is.LessThan(0.1f), "striker visible, frame " + i + " of " + untilStriker);
            Assert.That(Math.Min(untilBowler, untilStriker), Is.GreaterThan(moment.AcceptFrame + 100), "the comparison covers the whole ball");

            // a chase still in progress, and the seam switched off, both draw exactly the control
            var inProgress = Play(new Spec { Case = "complete-miss", Leave = true, Chase = PracticeChaseOutcome.InProgress });
            var none = Play(new Spec { Case = "complete-miss", Leave = true, Chase = null });
            var seamOff = Play(new Spec { Case = "complete-miss", Leave = true, Chase = PracticeChaseOutcome.LostBalls, Enabled = false });
            Assert.That(inProgress.Striker[0].Clip, Is.Null, "a chase in progress plays none");
            Assert.That(none.Striker[0].Clip, Is.Null, "ordinary Practice plays none");
            Assert.That(seamOff.Striker[0].Clip, Is.Null, "the A/B seam plays none");
            Assert.That(seamOff.Bowler[0].Clip, Is.Null);
            var n = Math.Min(inProgress.Frames.Count, Math.Min(none.Frames.Count, seamOff.Frames.Count));
            Assert.That(n, Is.GreaterThan(300));
            for (var i = 0; i < n; i++)
            {
                Assert.That(Differs(inProgress.Frames[i], none.Frames[i]), Is.Null, "in progress against none, frame " + i);
                Assert.That(Differs(seamOff.Frames[i], none.Frames[i]), Is.Null, "seam off against none, frame " + i);
            }
        }

        [Test]
        public void TheBowlersClipIsDrawn_ThroughTheMirror_AndHeldOnItsLastFrame()
        {
            var capture = Play(Won());
            var bowler = capture.Bowler[(int)Phase.Live];
            VmpClip clip;
            var pose = Clip("bowl_disappointed", out clip);
            var checkedFrames = 0;
            for (var i = bowler.BeganFrame; i < capture.Frames.Count; i++)
            {
                var playedFor = capture.Frames[i].Clock - bowler.BeganAt;
                if (playedFor < 0.1) continue;
                pose.SampleInto(clip, Math.Min(playedFor, clip.Duration), false);
                for (var j = 0; j < JointCount; j++)
                    Assert.That(Quaternion.Angle(pose.Pose.Rotations[j], capture.Frames[i].BowlerDriver[j]), Is.LessThan(0.5f),
                        (ProductionCharacterJoint)j + " at " + playedFor.ToString("0.000") + " s into bowl_disappointed");
                checkedFrames++;
            }

            Assert.That(checkedFrames, Is.GreaterThan(200));
            // the last frame is held: the final second moves nothing
            var end = capture.Frames.Count - 1;
            for (var i = end - 50; i < end; i++)
            {
                Assert.That(MaxAngle(capture.Frames[i].BowlerVisible, capture.Frames[i + 1].BowlerVisible), Is.LessThan(0.05f), "bowler held, frame " + i);
                Assert.That((capture.Frames[i].BowlerRoot - capture.Frames[i + 1].BowlerRoot).magnitude, Is.LessThan(1e-5f));
            }
        }

        [Test]
        public void TheStrikersCelebration_CarriesTheBatInTheBottomHand_AndHoldsTheLastFrame()
        {
            var capture = Play(Won());
            var striker = capture.Striker[(int)Phase.Live];
            VmpClip clip;
            var pose = Clip("bat_celebrate_win", out clip);
            var worstGap = 0f;
            var frames = 0;
            for (var i = striker.BeganFrame; i < capture.Frames.Count; i++)
            {
                var playedFor = capture.Frames[i].Clock - striker.BeganAt;
                Assert.That(capture.Frames[i].OneHand, Is.True, "one-hand carry, frame " + i);
                if (playedFor < 0.5) continue;
                pose.SampleInto(clip, Math.Min(playedFor, clip.Duration), false);
                foreach (var joint in TrunkAndLegs)
                    Assert.That(Quaternion.Angle(pose.Pose.Rotations[(int)joint], capture.Frames[i].StrikerDriver[(int)joint]), Is.LessThan(0.5f),
                        joint + " at " + playedFor.ToString("0.000") + " s into bat_celebrate_win");
                worstGap = Math.Max(worstGap, capture.Frames[i].PalmGap);
                frames++;
            }

            Assert.That(frames, Is.GreaterThan(150));
            Assert.That(worstGap, Is.LessThan(0.05f), "the bottom palm stays on the handle (the bat's grip), worst gap in metres");
            var end = capture.Frames.Count - 1;
            for (var i = end - 50; i < end; i++)
            {
                Assert.That(MaxAngle(capture.Frames[i].StrikerVisible, capture.Frames[i + 1].StrikerVisible), Is.LessThan(0.05f), "striker held, frame " + i);
                Assert.That((capture.Frames[i].Bat - capture.Frames[i + 1].Bat).magnitude, Is.LessThan(1e-4f), "the bat is held too, frame " + i);
            }

            // he celebrates where he stands: the root does not move once the clip has begun
            var root = capture.Frames[striker.BeganFrame].StrikerRoot;
            foreach (var frame in capture.Frames.Skip(striker.BeganFrame))
                Assert.That((frame.StrikerRoot - root).magnitude, Is.LessThan(1e-3f), "in place");
        }

        [Test]
        public void TheBatStandsWhereTheClipPutsIt_WithinAHandsBreadthAndATurn_BothClips()
        {
            foreach (var spec in new[] { Won(), Lost("right") })
            {
                var capture = Play(spec);
                var striker = capture.Striker[(int)Phase.Live];
                var worstGrip = 0f;
                var worstAngle = 0f;
                var at = 0.0;
                for (var i = striker.BeganFrame; i < capture.Frames.Count; i++)
                {
                    var playedFor = capture.Frames[i].Clock - striker.BeganAt;
                    if (playedFor < 0.6) continue;
                    if (capture.Frames[i].BatKeyGripCm > worstGrip) { worstGrip = capture.Frames[i].BatKeyGripCm; at = playedFor; }
                    worstAngle = Math.Max(worstAngle, capture.Frames[i].BatKeyAngle);
                }

                Debug.Log("UC-BAT " + spec.Key + " worst grip " + worstGrip.ToString("0.0") + " cm (at " + at.ToString("0.00") + " s into the clip), worst blade angle " + worstAngle.ToString("0.0") + " deg");
                Assert.That(worstGrip, Is.LessThan(12f), spec.Key + ": the grip's distance from the clip's key (cm), worst at " + at.ToString("0.00") + " s into the clip");
                Assert.That(worstAngle, Is.LessThan(35f), spec.Key + ": the blade's direction against the clip's key (degrees)");
            }
        }

        [Test]
        public void ALeftHandersClips_AreTheWholeActorMirrored_TheBatStaysInTheBottomHand()
        {
            foreach (var spec in new[] { new Spec { Case = "deliberate-loft", Leave = false, Hand = "left", Chase = PracticeChaseOutcome.Won }, Lost("left") })
            {
                var capture = Play(spec);
                var striker = capture.Striker[(int)Phase.Live];
                VmpClip clip;
                var pose = Clip(striker.Clip, out clip);
                var worstGap = 0f;
                var worstAngle = 0f;
                var frames = 0;
                for (var i = striker.BeganFrame; i < capture.Frames.Count; i++)
                {
                    var playedFor = capture.Frames[i].Clock - striker.BeganAt;
                    Assert.That(capture.Frames[i].OneHand, Is.True, spec.Key + ": one-hand carry, frame " + i);
                    if (playedFor < 0.6) continue;
                    pose.SampleInto(clip, Math.Min(playedFor, clip.Duration), true);
                    foreach (var joint in TrunkAndLegs)
                        Assert.That(Quaternion.Angle(pose.Pose.Rotations[(int)joint], capture.Frames[i].StrikerDriver[(int)joint]), Is.LessThan(0.5f),
                            spec.Key + ": " + joint + " at " + playedFor.ToString("0.000") + " s into " + striker.Clip + " for the left-hander (the clip through the canonical mirror)");
                    worstGap = Math.Max(worstGap, capture.Frames[i].PalmGap);
                    worstAngle = Math.Max(worstAngle, capture.Frames[i].BatKeyAngle);
                    frames++;
                }

                Assert.That(frames, Is.GreaterThan(150));
                Debug.Log("UC-LEFT " + spec.Key + " worst bottom-palm gap " + (worstGap * 100f).ToString("0.0") + " cm, worst blade angle against the key " + worstAngle.ToString("0.0") + " deg");
                Assert.That(worstGap, Is.LessThan(0.05f), spec.Key + ": the bottom palm stays on the handle (m)");
                Assert.That(worstAngle, Is.LessThan(35f), spec.Key + ": the blade against the clip's key (degrees)");
            }
        }

        [Test]
        public void TheWalkOff_FollowsTheClipsGroundTrack_AlongTheStanceHeading_ForBothHands()
        {
            var signs = new Dictionary<string, float>();
            foreach (var hand in new[] { "right", "left" })
            {
                var capture = Play(Lost(hand));
                var striker = capture.Striker[(int)Phase.Live];
                var bowler = capture.Bowler[(int)Phase.Live];
                Assert.That(striker.Clip, Is.EqualTo("bat_walk_off"), hand);
                Assert.That(bowler.Clip, Is.EqualTo("bowl_celebrate_defend"), hand);
                Assert.That(striker.StartT, Is.GreaterThanOrEqualTo(capture.EventT + 0.4 - 1e-9), hand + ": the dead ball and 400 ms");
                Assert.That(bowler.StartT, Is.GreaterThanOrEqualTo(capture.EventT + 0.6 - 1e-9), hand + ": the dead ball and 600 ms");
                var begin = capture.Frames[striker.BeganFrame].StrikerRoot;
                var end = capture.Frames[capture.Frames.Count - 1].StrikerRoot;
                var walked = end - begin;
                Assert.That(Math.Abs(walked.y), Is.LessThan(1e-3f), hand + ": on the ground");
                Assert.That(Math.Abs(walked.z), Is.LessThan(0.06f), hand + ": straight across, not along the pitch");
                Assert.That(Math.Abs(walked.x), Is.EqualTo(2.45f * 0.9836f * (float)capture.StrikerScale).Within(0.06f), hand + ": 2.45 m of the clip's ground track, scaled with his body");
                signs[hand] = Math.Sign(walked.x);
                // the speed of a walk, never a dash: about 1.0 m/s, 1.3 at most
                var fastest = 0f;
                for (var i = striker.BeganFrame + 1; i < capture.Frames.Count; i++)
                    fastest = Math.Max(fastest, (capture.Frames[i].StrikerRoot - capture.Frames[i - 1].StrikerRoot).magnitude * 60f);
                Assert.That(fastest, Is.LessThan(1.35f), hand + ": walking speed, m/s");
                Assert.That(fastest, Is.GreaterThan(0.6f), hand + ": he does walk");
                // and the root holds still before the first step (the clip stands for 1.55 s)
                for (var i = striker.BeganFrame + 1; i < striker.BeganFrame + (int)(1.3 * 60); i++)
                    Assert.That((capture.Frames[i].StrikerRoot - begin).magnitude, Is.LessThan(0.02f), hand + ": still at the slump, frame " + (i - striker.BeganFrame));
                // the clip, sampled for his hand, is what the rig is given
                VmpClip clip;
                var pose = Clip("bat_walk_off", out clip);
                var frame = capture.Frames[capture.Frames.Count - 1];
                pose.SampleInto(clip, clip.Duration, hand == "left");
                foreach (var joint in TrunkAndLegs)
                    Assert.That(Quaternion.Angle(pose.Pose.Rotations[(int)joint], frame.StrikerDriver[(int)joint]), Is.LessThan(0.5f), hand + ": " + joint + " at the end of the walk-off");
            }

            Assert.That(signs["right"], Is.EqualTo(-signs["left"]).And.Not.EqualTo(0f), "a left-hander walks off the other way: the whole actor is mirrored, ground x and yaw with it");
        }

        [Test]
        public void ReducedMotion_HoldsTheMarkerFrame_EasedInGently_AndWalksNowhere()
        {
            foreach (var spec in new[]
                     {
                         new Spec { Case = "complete-miss", Leave = true, Chase = PracticeChaseOutcome.LostBalls, Reduced = true },
                         new Spec { Case = "deliberate-loft", Leave = false, Chase = PracticeChaseOutcome.Won, Reduced = true }
                     })
            {
                var capture = Play(spec);
                var striker = capture.Striker[(int)Phase.Live];
                var bowler = capture.Bowler[(int)Phase.Live];
                VmpClip strikerClip, bowlerClip;
                var strikerPose = Clip(striker.Clip, out strikerClip);
                var bowlerPose = Clip(bowler.Clip, out bowlerClip);
                float strikerMarker, bowlerMarker;
                strikerClip.TryGetMarker(ProductionResultMoments.ReducedMarker(striker.Clip), out strikerMarker);
                bowlerClip.TryGetMarker(ProductionResultMoments.ReducedMarker(bowler.Clip), out bowlerMarker);
                strikerPose.SampleInto(strikerClip, strikerMarker, false);
                bowlerPose.SampleInto(bowlerClip, bowlerMarker, false);
                var last = capture.Frames[capture.Frames.Count - 1];
                foreach (var joint in TrunkAndLegs)
                    Assert.That(Quaternion.Angle(strikerPose.Pose.Rotations[(int)joint], last.StrikerDriver[(int)joint]), Is.LessThan(0.5f), spec.Case + " striker " + joint + " on " + striker.Clip + "'s marker frame");
                for (var j = 0; j < JointCount; j++)
                    Assert.That(Quaternion.Angle(bowlerPose.Pose.Rotations[j], last.BowlerDriver[j]), Is.LessThan(0.5f), spec.Case + " bowler " + (ProductionCharacterJoint)j + " on " + bowler.Clip + "'s marker frame");

                // held: the last second moves nothing (the hand-over is done by then)
                for (var i = capture.Frames.Count - 61; i < capture.Frames.Count - 1; i++)
                    Assert.That(MaxAngle(capture.Frames[i].StrikerVisible, capture.Frames[i + 1].StrikerVisible), Is.LessThan(0.05f), spec.Case + " striker held, frame " + i);
                // the walk-off stands where it is in the slump
                if (striker.Clip == "bat_walk_off")
                    Assert.That((last.StrikerRoot - capture.Frames[striker.BeganFrame].StrikerRoot).magnitude, Is.LessThan(0.01f), "no walk in Reduced Motion");
                // the ease into the held frame is gentle: no bone takes a pop-sized step
                Assert.That(Pops(capture, true, striker.BeganFrame - 2, striker.BeganFrame + 60), Is.Empty, spec.Case + " striker into the held frame");
                Assert.That(Pops(capture, false, bowler.BeganFrame - 2, bowler.BeganFrame + 60), Is.Empty, spec.Case + " bowler into the held frame");
            }
        }

        [Test]
        public void TheStrikerWaitsForHisRun_AndTheClipTakesHimOverWhereHeStands()
        {
            var capture = Play(new Spec { Case = "thin-edge", Leave = false, Chase = PracticeChaseOutcome.Won });
            var striker = capture.Striker[(int)Phase.Live];
            Assert.That(striker.Clip, Is.EqualTo("bat_celebrate_win"));
            Assert.That(capture.Boundary, Is.False, "won on a run");
            // the last run is the event; the clip starts after its pull-up (0.8 s), longer than the 300 ms of latency
            Assert.That(striker.StartT, Is.GreaterThanOrEqualTo(capture.EventT + ProductionResultMoments.RunPullUpSeconds - 1e-9));
            Assert.That(striker.BeganFrame, Is.GreaterThan(0));
            // no jump of the root as the clip takes him over: he is where the run left him
            var before = capture.Frames[striker.BeganFrame - 1].StrikerRoot;
            var at = capture.Frames[striker.BeganFrame].StrikerRoot;
            Assert.That(Vector3.Distance(before, at), Is.LessThan(0.05f), "the clip's anchor is the runner's place");
            Assert.That(Pops(capture, true, striker.BeganFrame - 3, striker.BeganFrame + 90), Is.Empty, "no pop into the celebration from the run");
        }

        [Test]
        public void TheDecidingBallsReplayPlaysTheMomentAgainFromTheStance()
        {
            var capture = Play(new Spec { Case = "early-attack", Leave = false, Chase = PracticeChaseOutcome.LostWicket, Replay = true });
            Assert.That(capture.ReplayAcceptFrame, Is.GreaterThan(capture.AcceptFrame));
            foreach (var phase in new[] { Phase.Live, Phase.Replay })
            {
                var striker = capture.Striker[(int)phase];
                var bowler = capture.Bowler[(int)phase];
                Assert.That(striker.Clip, Is.EqualTo("bat_walk_off"), phase.ToString());
                Assert.That(bowler.Clip, Is.EqualTo("bowl_celebrate_defend"), phase.ToString());
                Assert.That(striker.BeganFrame, Is.GreaterThan(phase == Phase.Live ? capture.AcceptFrame : capture.ReplayAcceptFrame), phase + ": the striker's clip began after its accept");
                Assert.That(bowler.BeganFrame, Is.GreaterThan(phase == Phase.Live ? capture.AcceptFrame : capture.ReplayAcceptFrame), phase + ": the bowler's clip began after its accept");
                Assert.That(striker.BeganAt, Is.GreaterThanOrEqualTo(capture.EventT + 0.25 - 1e-9), phase + ": not before the event and 250 ms");
            }

            // the replay starts from the stance: the root the live walk-off moved is back on it
            var live = capture.Frames[capture.ReplayAcceptFrame - 1].StrikerRoot;
            var replay = capture.Frames[capture.ReplayAcceptFrame + 5].StrikerRoot;
            Assert.That(Vector3.Distance(live, replay), Is.GreaterThan(1.5f), "the replay does not start where the walk-off ended");
            var liveStart = capture.Frames[capture.Striker[0].BeganFrame].StrikerRoot;
            var replayStart = capture.Frames[capture.Striker[1].BeganFrame].StrikerRoot;
            Assert.That(Vector3.Distance(liveStart, replayStart), Is.LessThan(0.1f), "the replay's moment begins from the same stance as the live ball's");
            Assert.That(capture.Striker[1].BeganAt - capture.Striker[1].StartT, Is.InRange(-1e-9, 0.5));
        }

        [Test]
        public void TheVerdictOnTheWire_PlaysTheMomentOnTheWorld_AndAChaseInProgressPlaysNone()
        {
            // the real host.result packets of chase-v7.json (a won chase on the golden six, a chase lost on balls on the golden complete miss, a chase in progress on the early attack),
            // parsed by the contract adapter and played through the host flow: the verdict Unity renders is the one the packet carries
            var won = Play(new Spec { Case = "deliberate-loft", Leave = false, Wire = "won" });
            Assert.That(won.Striker[0].Clip, Is.EqualTo("bat_celebrate_win"));
            Assert.That(won.Bowler[0].Clip, Is.EqualTo("bowl_disappointed"));
            Assert.That(won.Striker[0].BeganAt, Is.GreaterThanOrEqualTo(won.EventT + 0.2 - 1e-9));
            Assert.That(won.Bowler[0].BeganAt, Is.GreaterThanOrEqualTo(won.EventT + 0.45 - 1e-9));
            var lost = Play(new Spec { Case = "complete-miss", Leave = false, Wire = "lost-balls" });
            Assert.That(lost.Striker[0].Clip, Is.EqualTo("bat_walk_off"));
            Assert.That(lost.Bowler[0].Clip, Is.EqualTo("bowl_celebrate_defend"));
            Assert.That(lost.Striker[0].BeganAt, Is.GreaterThanOrEqualTo(lost.EventT + 0.4 - 1e-9), "after the miss, the dead ball and 400 ms");
            Assert.That(lost.Bowler[0].BeganAt, Is.GreaterThanOrEqualTo(lost.EventT + 0.6 - 1e-9));
            Assert.That(lost.Striker[0].BeganFrame, Is.GreaterThan(lost.AcceptFrame));
            var progress = Play(new Spec { Case = "early-attack", Leave = false, Wire = "in-progress" });
            Assert.That(progress.Striker[0].Clip, Is.Null, "a chase still in progress plays none of the four");
            Assert.That(progress.Bowler[0].Clip, Is.Null);
            Debug.Log("UC-WIRE won: striker " + won.Striker[0].Clip + " began " + won.Striker[0].BeganAt.ToString("0.000") + " s (event " + won.EventT.ToString("0.000") + "); lost-balls: striker " +
                      lost.Striker[0].Clip + " began " + lost.Striker[0].BeganAt.ToString("0.000") + " s (event " + lost.EventT.ToString("0.000") + "); in-progress: none");
        }

        [Test]
        public void ADismissalOnTheDecidingBall_DecidesTheEventTime_TheBowlersOwnCelebrationFinishesFirst_NoPops()
        {
            // the golden early attack (bowler's end keeper takes at 0.92 s, dead ball 1.11 s) with the dismissal the verdict would carry: caught behind (the keeper's take), bowled (no stumps event in this
            // trace: the dead ball) and lbw (the dead ball and the umpire's 400 ms); lost on a wicket: striker +250 ms, bowler +400 ms, and the bowler's built-in celebration is let finish
            var expected = new[] { ("caught_behind", 0.915), ("bowled", 1.11), ("lbw", 1.51) };
            foreach (var (dismissal, eventT) in expected)
            {
                var capture = Play(new Spec { Case = "early-attack", Leave = false, Chase = PracticeChaseOutcome.LostWicket, Dismissal = dismissal });
                var striker = capture.Striker[(int)Phase.Live];
                var bowler = capture.Bowler[(int)Phase.Live];
                Assert.That(capture.EventT, Is.EqualTo(eventT).Within(0.01), dismissal + ": the physics event");
                Assert.That(striker.Clip, Is.EqualTo("bat_walk_off"), dismissal);
                Assert.That(bowler.Clip, Is.EqualTo("bowl_celebrate_defend"), dismissal);
                Assert.That(striker.BeganAt, Is.GreaterThanOrEqualTo(capture.EventT + 0.25 - 1e-9), dismissal + ": the striker, 250 ms after the event");
                Assert.That(bowler.BeganAt, Is.GreaterThanOrEqualTo(capture.EventT + 0.40 - 1e-9), dismissal + ": the bowler, 400 ms after the event");
                Assert.That(striker.BeganFrame, Is.GreaterThan(capture.AcceptFrame), dismissal);
                Assert.That(bowler.BeganFrame, Is.GreaterThan(capture.AcceptFrame), dismissal);
                var strikerPops = Pops(capture, true, striker.BeganFrame - 3, striker.BeganFrame + (int)(5.9 * 60));
                var bowlerPops = Pops(capture, false, bowler.BeganFrame - 3, bowler.BeganFrame + (int)(3.9 * 60));
                // the clips add none; what the planner's own reactions did before them is the control's (the same ball with no verdict)
                var control = Play(new Spec { Case = "early-attack", Leave = false, Chase = null, Dismissal = dismissal, MinFramesAfterAccept = 720 });
                var controlStriker = Pops(control, true, striker.BeganFrame - 3, striker.BeganFrame + (int)(5.9 * 60));
                var controlBowler = Pops(control, false, bowler.BeganFrame - 3, bowler.BeganFrame + (int)(3.9 * 60));
                // new = a pop of the chase run that the control has not at the same bone and frame
                var newStriker = strikerPops.Where(pop => !IsTheControlsPop(pop, controlStriker)).ToList();
                var newBowler = bowlerPops.Where(pop => !IsTheControlsPop(pop, controlBowler)).ToList();
                Debug.Log("UC-DISMISSAL " + dismissal + ": event " + capture.EventT.ToString("0.000") + " s, striker began " + striker.BeganAt.ToString("0.000") + " s (frame " + striker.BeganFrame + "), bowler began " + bowler.BeganAt.ToString("0.000") +
                          " s (frame " + bowler.BeganFrame + "); pops in the clip windows: striker " + strikerPops.Count + " (control " + controlStriker.Count + ", new " + newStriker.Count + "), bowler " + bowlerPops.Count +
                          " (control " + controlBowler.Count + ", new " + newBowler.Count + "); striker: " + string.Join("; ", strikerPops) + " | bowler: " + string.Join("; ", bowlerPops));
                Assert.That(newStriker, Is.Empty, dismissal + " striker: pops the control does not have");
                Assert.That(newBowler, Is.Empty, dismissal + " bowler: pops the control does not have");
            }
        }

        [Test]
        public void AMissedSwingAndAnEdgesRuns_TakeTheClipInWithNoPopTheControlLacks_BothHands()
        {
            // The two hand-overs the golden deliveries strain most. A swing and a miss holds his arms still for a third of a second, so the grip solve has no memory of them when the clip
            // begins (the glove's turn about the handle took 30 degrees in that frame). A thin edge's runs end on a foot lock that moves his legs after the frame's hand-over source is taken
            // (the clip's first frame left the legs without it, 20 to 40 degrees). The same ball with no verdict is the control.
            var controls = new Dictionary<string, Capture>();
            foreach (var golden in new[] { "complete-miss", "thin-edge" })
            {
                foreach (var hand in new[] { "right", "left" })
                {
                    var control = Play(new Spec { Case = golden, Leave = false, Hand = hand, Chase = null, MinFramesAfterAccept = 900 });
                    controls[golden + "|" + hand] = control;
                    foreach (var outcome in new[] { PracticeChaseOutcome.LostBalls, PracticeChaseOutcome.LostWicket, PracticeChaseOutcome.Won })
                    {
                        if (golden == "complete-miss" && outcome == PracticeChaseOutcome.Won) continue;
                        var capture = Play(new Spec { Case = golden, Leave = false, Hand = hand, Chase = outcome });
                        var striker = capture.Striker[(int)Phase.Live];
                        var bowler = capture.Bowler[(int)Phase.Live];
                        Assert.That(striker.Clip, Is.Not.Null, golden + " " + hand + " " + outcome + ": his clip played");
                        Assert.That(bowler.Clip, Is.Not.Null, golden + " " + hand + " " + outcome + ": the bowler's clip played");
                        var strikerPops = Pops(capture, true, striker.BeganFrame - 3, striker.BeganFrame + (int)(5.9 * 60));
                        var bowlerPops = Pops(capture, false, bowler.BeganFrame - 3, bowler.BeganFrame + (int)(3.9 * 60));
                        var controlStriker = Pops(control, true, striker.BeganFrame - 3, striker.BeganFrame + (int)(5.9 * 60));
                        var controlBowler = Pops(control, false, bowler.BeganFrame - 3, bowler.BeganFrame + (int)(3.9 * 60));
                        var newStriker = strikerPops.Where(pop => !IsTheControlsPop(pop, controlStriker)).ToList();
                        var newBowler = bowlerPops.Where(pop => !IsTheControlsPop(pop, controlBowler)).ToList();
                        Debug.Log("UC-HANDOVER " + golden + " " + hand + " " + outcome + ": striker began frame " + striker.BeganFrame + " (" + striker.BeganAt.ToString("0.000") + " s), pops " + strikerPops.Count +
                                  " (control " + controlStriker.Count + ", new " + newStriker.Count + "), bowler " + bowlerPops.Count + " (control " + controlBowler.Count + ", new " + newBowler.Count + "); new: " +
                                  string.Join("; ", newStriker.Concat(newBowler)));
                        Assert.That(newStriker, Is.Empty, golden + " " + hand + " " + outcome + " striker: pops the control does not have");
                        Assert.That(newBowler, Is.Empty, golden + " " + hand + " " + outcome + " bowler: pops the control does not have");
                    }
                }
            }
        }

        [Test]
        public void ALeftArmBowlerRaisesHisOwnLeftArm_TheWholeActorMirrored()
        {
            var left = Play(new Spec { Case = "complete-miss", Leave = true, Chase = PracticeChaseOutcome.LostBalls, BowlerArm = "left" });
            var right = Play(Lost("right"));
            var bowler = left.Bowler[(int)Phase.Live];
            VmpClip clip;
            var pose = Clip("bowl_celebrate_defend", out clip);
            var rightPose = Clip("bowl_celebrate_defend", out clip);
            var inspected = 0;
            for (var i = bowler.BeganFrame; i < left.Frames.Count; i++)
            {
                var playedFor = left.Frames[i].Clock - bowler.BeganAt;
                if (playedFor < 0.8) continue;
                pose.SampleInto(clip, Math.Min(playedFor, clip.Duration), true);
                rightPose.SampleInto(clip, Math.Min(playedFor, clip.Duration), false);
                for (var j = 0; j < JointCount; j++)
                    Assert.That(Quaternion.Angle(pose.Pose.Rotations[j], left.Frames[i].BowlerDriver[j]), Is.LessThan(0.5f), "left arm: " + (ProductionCharacterJoint)j);
                inspected++;
            }

            Assert.That(inspected, Is.GreaterThan(100));
            // and it is a different pose from the right-armed bowler's (the mirror is real): one second into the clip, near its peak, the arms are not symmetric
            var a = left.Frames[left.Bowler[(int)Phase.Live].BeganFrame + 60].BowlerDriver;
            var b = right.Frames[right.Bowler[(int)Phase.Live].BeganFrame + 60].BowlerDriver;
            var arms = new[] { ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.ForearmRight };
            Assert.That(arms.Max(joint => Quaternion.Angle(a[(int)joint], b[(int)joint])), Is.GreaterThan(20f));
        }

        [Test]
        public void NoPops_InAnyHandOverIntoOrOutOfAClip_OrInTheClips_DirectorOffAndOn()
        {
            var specs = new List<Spec>
            {
                Won(),
                Lost("right"),
                Lost("left"),
                new Spec { Case = "complete-miss", Leave = true, Chase = PracticeChaseOutcome.LostBalls, Director = true },
                new Spec { Case = "deliberate-loft", Leave = false, Chase = PracticeChaseOutcome.Won, Director = true },
                new Spec { Case = "thin-edge", Leave = false, Chase = PracticeChaseOutcome.Won },
                new Spec { Case = "early-attack", Leave = false, Chase = PracticeChaseOutcome.LostWicket, Replay = true }
            };
            var report = new StringBuilder();
            foreach (var spec in specs)
            {
                var capture = Play(spec);
                foreach (var phase in new[] { Phase.Live, Phase.Replay })
                {
                    if (phase == Phase.Replay && !spec.Replay) continue;
                    foreach (var striker in new[] { true, false })
                    {
                        var moment = (striker ? capture.Striker : capture.Bowler)[(int)phase];
                        Assert.That(moment.BeganFrame, Is.GreaterThan(0), spec.Key + " " + phase + (striker ? " striker" : " bowler") + " began");
                        var duration = moment.Clip == "bat_walk_off" ? 5.4 : moment.Clip == "bat_celebrate_win" ? 3.6 : 3.4;
                        // from three frames before the clip to half a second after its last frame: the hand-over in, the clip and its held end
                        var pops = Pops(capture, striker, moment.BeganFrame - 3, moment.BeganFrame + (int)((duration + 0.5) * 60));
                        foreach (var pop in pops) report.Append(spec.Key).Append(' ').Append(phase).Append(striker ? " striker " : " bowler ").Append(moment.Clip).Append(": ").Append(pop).Append('\n');
                        if (pops.Count > 0 && striker) report.Append("  (began frame ").Append(moment.BeganFrame).Append(", table ").Append(Dump(capture, spec.Key)).Append(")\n");
                    }
                }
            }

            Debug.Log("UC-POPS " + specs.Count + " runs scanned from 3 frames before each clip to half a second after it: " + (report.Length == 0 ? "0 pops" : "see the failure"));
            Assert.That(report.ToString(), Is.Empty, "pops by the MOTION-SPEC section 9 definitions (CLP-04)");
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        [Serializable] private sealed class ChaseFixture { public ChaseScenario[] scenarios; }
        [Serializable] private sealed class ChaseScenario { public string id; public string baseCase; public ScoreBlock score; public ChaseBlock after; }
        [Serializable] private sealed class ScoreBlock { public int balls; public int maxOvers; public int runs; public int wickets; }
        [Serializable] private sealed class ChaseBlock { public int ballsLeft; public int maxBalls; public string outcome; public int requiredRateX100; public int runsNeeded; public int target; }
        [Serializable] private sealed class Fixture { public Case[] cases; }
        [Serializable] private sealed class Case { public string id; public Wire wire; }
        [Serializable] private sealed class Wire { public Packets packets; }
        [Serializable]
        private sealed class Packets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket result;
        }

        private sealed class NullSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
