using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The fielder body rules ported from src/render3d/practice/fielding.ts (wedge item 18; rule 11). The physics
    /// path and event times are inputs only: every check below derives its expectation from the path and the trace,
    /// never from copied physics numbers, so FIELD's path changes are followed. Builder checks, not a credibility
    /// verdict: whether fielders look like they are trying is for evaluators and people.
    /// </summary>
    public sealed class ProductionFieldingChoreographyTests
    {
        private static readonly Vector3 Striker = new Vector3(0f, 0f, 9.25f);

        [Test]
        public void StopAndThrow_RootIsThePathAndTheClipsLandOnThePhysicsEvents()
        {
            var path = RunPickupThrow(out var pickupT, out var throwT);
            var track = ProductionFieldingPlanner.Plan(path, false, Context(BallTo(new Vector3(12f, 0.1f, 20f), 1.4)));

            AssertRootIsPath(track, path, false);
            AssertClipAt(track, pickupT, ProductionFieldingClip.FieldPickup, "collect");
            AssertClipAt(track, throwT, ProductionFieldingClip.FieldThrow, "release");
            AssertNoRunOnTheSpot(track);
            AssertTurnRate(track);

            // Acceleration: the first strides are the leaning, quickening drive; the throw faces where the ball goes.
            var runStart = path.First(sample => sample.action == "run").t;
            Assert.That(track.Evaluate(runStart + 0.2).Clip, Is.EqualTo(ProductionFieldingClip.RunDrive));
            Assert.That(track.Evaluate(0.2).Clip, Is.EqualTo(ProductionFieldingClip.Ready), "set: the ready stance");
        }

        [Test]
        public void SnapThrow_AfterALateGather_PlaysTheWindUpFasterButStillReleasesOnTheEvent()
        {
            var samples = new List<FielderTraceSample>
            {
                S(0.0, 10f, 20f, "set"), S(1.0, 10f, 20f, "pickup"), S(1.15, 10f, 20f, "throw"), S(1.8, 10f, 20f, "idle")
            };
            var track = ProductionFieldingPlanner.Plan(samples.ToArray(), false, Context(BallTo(new Vector3(10f, 0.1f, 20f), 1.0)));
            var move = MoveAt(track, 1.15 + 1e-4);
            Assert.That(move.Clip, Is.EqualTo(ProductionFieldingClip.FieldThrow));
            Assert.That(move.Rate, Is.GreaterThan(1.0).And.LessThanOrEqualTo(ProductionFieldingPlanner.SnapThrowRate));
            Assert.That(move.ClipTimeAt(1.15),
                Is.EqualTo(ProductionFieldingClips.Marker(ProductionFieldingClip.FieldThrow, "release")).Within(1e-6));
        }

        [Test]
        public void Fumble_HandsMeetTheBallAtTheDrop_AndThereIsNoStillStandBeforeTheThrow()
        {
            var samples = new List<FielderTraceSample> { S(0.0, 14f, 22f, "set"), S(0.5, 14f, 22f, "set") };
            for (var step = 1; step <= 6; step++) samples.Add(S(0.5 + step * 0.1, 14f - step * 0.5f, 22f - step * 0.6f, "run"));
            samples.Add(S(1.2, 11f, 18.4f, "drop"));
            samples.Add(S(2.0, 11.2f, 18.0f, "pickup"));
            samples.Add(S(2.3, 11.2f, 18.0f, "throw"));
            samples.Add(S(3.0, 11.2f, 18.0f, "idle"));
            var track = ProductionFieldingPlanner.Plan(samples.ToArray(), false,
                Context(BallTo(new Vector3(11f, 0.2f, 18.4f), 1.2)));

            AssertRootIsPath(track, samples.ToArray(), false);
            AssertClipAt(track, 1.2, ProductionFieldingClip.FieldFumble, "touch");
            AssertClipAt(track, 2.0, ProductionFieldingClip.FieldPickup, "collect");
            AssertClipAt(track, 2.3, ProductionFieldingClip.FieldThrow, "release");
            for (var t = 1.2001; t < 2.3; t += 0.005)
            {
                var clip = track.Evaluate(t).Clip;
                Assert.That(clip, Is.Not.EqualTo(ProductionFieldingClip.Ready).And.Not.EqualTo(ProductionFieldingClip.Idle),
                    "a fumble is followed by the scramble, never by a still stand (t=" + t + ")");
            }
        }

        [TestCase(1.3f, ProductionFieldingClip.KeepDiveRight)]
        [TestCase(-1.3f, ProductionFieldingClip.KeepDiveLeft)]
        public void KeeperDive_CrouchedAndSquare_DivesToTheBallsSideWithGlovesOutAtTheTake(
            float side, ProductionFieldingClip expected)
        {
            var samples = new[]
            {
                S(0.0, 0f, 11.6f, "set"), S(0.45, 0f, 11.6f, "dive"), S(0.62, side * 0.6f, 11.6f, "catch"),
                S(1.4, side * 0.6f, 11.6f, "celebrate")
            };
            var ballAtTake = new Vector3(side * 1.5f, 0.6f, 11.6f);
            var context = Context(BallTo(ballAtTake, 0.62));
            context.Keeper = true;
            context.Heading = ProductionFieldingPlanner.KeeperHeading;
            context.EndTime = 3.0;
            var track = ProductionFieldingPlanner.Plan(samples, false, context);

            var set = track.Evaluate(0.2);
            Assert.That(set.Clip, Is.EqualTo(ProductionFieldingClip.KeepCrouch), "crouched before the release");
            Assert.That(Mathf.Abs(ProductionFieldingPlanner.AngleDelta(set.Heading, Mathf.PI)), Is.LessThan(1e-4f),
                "square to the bowler");
            AssertClipAt(track, 0.62, expected, "reach");
            AssertRootIsPath(track, samples, false);
            foreach (var move in track.Moves)
            {
                Assert.That(move.BodyFrom.magnitude, Is.LessThanOrEqualTo(ProductionFieldingPlanner.DiveBodyMaxMetres + 1e-4f));
                Assert.That(move.BodyTo.magnitude, Is.LessThanOrEqualTo(ProductionFieldingPlanner.DiveBodyMaxMetres + 1e-4f));
            }
            // The physics marks the celebration; he gets up from the dive first.
            var celebrate = track.Moves.First(move => move.Clip == ProductionFieldingClip.CelebrateJump);
            var diveStart = 0.62 - ProductionFieldingClips.Marker(expected, "reach");
            Assert.That(celebrate.T0, Is.GreaterThanOrEqualTo(diveStart + ProductionFieldingClips.Duration(expected) - 0.15 - 1e-6));
        }

        [Test]
        public void Dive_ExtendsTheDrawnBodyTowardsTheBall_OnlyDuringTheDive_AtMostTheCap()
        {
            var samples = new[]
            {
                S(0.0, 20f, 15f, "set"), S(0.5, 20f, 15f, "set"), S(0.6, 20f, 15f, "run"), S(1.0, 18.5f, 15f, "dive"),
                S(1.2, 18f, 15f, "pickup"), S(1.6, 18f, 15f, "throw"), S(2.2, 18f, 15f, "idle")
            };
            var ball = new Vector3(16f, 0.05f, 15f); // 2 m beyond the physics position at the reach
            var track = ProductionFieldingPlanner.Plan(samples, false, Context(BallTo(ball, 1.2)));
            AssertRootIsPath(track, samples, false);
            var reach = track.Evaluate(1.2);
            Assert.That(ProductionFieldingClips.IsDive(reach.Clip), Is.True);
            Assert.That(reach.Body.magnitude, Is.EqualTo(Mathf.Clamp(2f - ProductionFieldingPlanner.DiveHandReachMetres,
                -0.5f, ProductionFieldingPlanner.DiveBodyMaxMetres)).Within(0.02f), "out to the ball by the reach");
            Assert.That(Vector3.Dot(reach.Body.normalized, Vector3.left), Is.GreaterThan(0.99f), "towards the ball");
            Assert.That(track.Evaluate(0.3).Body, Is.EqualTo(Vector3.zero), "no extension outside the dive");
            Assert.That(track.Evaluate(2.1).Body, Is.EqualTo(Vector3.zero), "back over the get-up");
        }

        [Test]
        public void CatchTakenOnTheMove_KeepsTheLegsRunningUnderTheArms()
        {
            var samples = new List<FielderTraceSample> { S(0.0, 0f, 40f, "set"), S(0.4, 0f, 40f, "set") };
            for (var step = 1; step <= 10; step++) samples.Add(S(0.4 + step * 0.1, step * 0.65f, 40f, "run"));
            samples.Add(S(1.45, 6.825f, 40f, "catch"));
            samples.Add(S(1.6, 7.6f, 40f, "run"));
            samples.Add(S(2.4, 8f, 40f, "celebrate"));
            var track = ProductionFieldingPlanner.Plan(samples.ToArray(), false,
                Context(BallTo(new Vector3(6.825f, 1.2f, 40f), 1.45)));
            var move = MoveAt(track, 1.47);
            Assert.That(move.Clip, Is.EqualTo(ProductionFieldingClip.CatchChest));
            Assert.That(move.HasLower, Is.True, "taken at a run: the legs keep running");
            Assert.That(move.Lower, Is.EqualTo(ProductionFieldingClip.Run));
            AssertClipAt(track, 1.45, ProductionFieldingClip.CatchChest, "catch");
        }

        [Test]
        public void Reactions_StartOnlyAfterTheEarningEvent_AndNeverOverARunThrowOrDive()
        {
            var trace = CanonicalTraceTestFixture.Create();
            trace.events = trace.events.Concat(new[]
            {
                new CanonicalTraceEvent { t = 0.8, kind = "catch", fielderId = "fielder-3", p = new TraceVector3 { x = 1, y = 1, z = 1 } },
                new CanonicalTraceEvent { t = 1.0, kind = "dead" }
            }).ToArray();
            var roster = new List<(string, string, double, double)>
            {
                ("fielder-0", "keeper", 0.0, 11.0), ("fielder-1", "bowler", 0.9, -5.5), ("fielder-2", "slip", 2.0, 12.0),
                ("fielder-3", "point", 20.8, 11.5), ("fielder-4", "cover", 20.3, -2.2)
            };
            var reactions = ProductionFieldingPlanner.Reactions(trace, roster, "caught", "fielder-3", true, "outside_edge", false);
            Assert.That(reactions.ContainsKey("fielder-0"), Is.False, "the keeper moves on his own path");
            Assert.That(reactions.ContainsKey("fielder-1"), Is.False, "the bowler moves on his own path");
            Assert.That(reactions.ContainsKey("fielder-3"), Is.False, "the catcher celebrates on his own path");
            Assert.That(reactions["fielder-2"].clip, Is.EqualTo(ProductionFieldingClip.CelebrateJump), "close catchers jump");
            Assert.That(reactions["fielder-2"].time, Is.GreaterThanOrEqualTo(0.8 + 0.2));
            Assert.That(reactions["fielder-4"].clip, Is.EqualTo(ProductionFieldingClip.Clap), "others clap");
            Assert.That(reactions["fielder-4"].time, Is.GreaterThanOrEqualTo(0.8 + 0.45));

            // A fielder still running when his reaction is due waits until the run has finished.
            var samples = new[] { S(0.0, 5f, 30f, "set"), S(0.5, 5f, 30f, "run"), S(1.8, 9f, 34f, "idle") };
            var context = Context(BallTo(new Vector3(0f, 0f, 0f), 1.0));
            context.ReactionTime = 1.2;
            context.ReactionClip = ProductionFieldingClip.Clap;
            context.EndTime = 3.0;
            var track = ProductionFieldingPlanner.Plan(samples, false, context);
            var clap = track.Moves.First(move => move.Clip == ProductionFieldingClip.Clap);
            Assert.That(clap.T0, Is.GreaterThanOrEqualTo(1.8 + 0.1 - 1e-9), "never over a run");
            Assert.That(track.Moves.All(move => move.Clip != ProductionFieldingClip.Clap || move.T0 >= 1.2), Is.True);
        }

        [TestCase(0.40, ProductionFieldingClip.FieldDiveRight)]
        [TestCase(0.10, ProductionFieldingClip.FieldDiveRight)]
        public void Dive_LaunchIsTimedToThePhysicsDive_FromTakeOff_HandsOutAtTheReach(
            double diveSeconds, ProductionFieldingClip _)
        {
            // fielding.ts:309-325: the launch plays slower for a long physics dive and quicker for a short one.
            var takeOff = 1.0;
            var reach = takeOff + diveSeconds;
            var samples = new[]
            {
                S(0.0, 20f, 15f, "set"), S(0.5, 20f, 15f, "set"), S(0.6, 20f, 15f, "run"), S(takeOff, 18.5f, 15f, "dive"),
                S(reach, 17.6f, 15f, "pickup"), S(reach + 0.5, 17.6f, 15f, "throw"), S(reach + 1.1, 17.6f, 15f, "idle")
            };
            var track = ProductionFieldingPlanner.Plan(samples, false, Context(BallTo(new Vector3(16.2f, 0.05f, 15f), reach)));
            AssertRootIsPath(track, samples, false);
            var launch = MoveAt(track, takeOff + 1e-4);
            Assert.That(ProductionFieldingClips.IsDive(launch.Clip), Is.True, "the dive starts at the physics take-off");
            var mark = ProductionFieldingClips.Marker(launch.Clip, "reach");
            Assert.That(launch.Rate, Is.EqualTo(mark / diveSeconds).Within(1e-6), "launch timed to the physics dive");
            Assert.That(launch.ClipTimeAt(takeOff), Is.EqualTo(0.0).Within(1e-6));
            AssertClipAt(track, reach, launch.Clip, "reach");
            Assert.That(MoveAt(track, reach + 0.05).Rate, Is.EqualTo(1.0), "the rest of the clip at its own pace");
            Assert.That(ProductionFieldingClips.IsDive(MoveAt(track, takeOff - 0.01).Clip), Is.False,
                "never during the run");
        }

        [Test]
        public void HandsOnHipsAfterABoundary_ChasersOnly()
        {
            // A rope crossing at (0, -60): one ring fielder sprints at it, one jogs, one sprints away, plus the keeper.
            var trace = CanonicalTraceTestFixture.Create();
            trace.durationSeconds = 4.0;
            var sprint = Line(10f, -30f, 4f, -44f, 0.5, 2.5, 20, "run");   // 14.8 m in 2.0 s = 7.4 m/s
            var jog = Line(-10f, -30f, -8f, -34f, 0.5, 2.5, 20, "run");    // 4.5 m in 2.0 s
            var away = Line(20f, -30f, 31f, -21f, 0.5, 2.5, 20, "run");    // fast, but further from the crossing
            var keeper = Line(0f, 11f, 2f, 0f, 0.5, 2.5, 20, "run");
            trace.fielders = new[]
            {
                new FielderTracePath { fielderId = "sprint", samples = sprint },
                new FielderTracePath { fielderId = "jog", samples = jog },
                new FielderTracePath { fielderId = "away", samples = away },
                new FielderTracePath { fielderId = "keeper", samples = keeper }
            };
            trace.events = new[]
            {
                new CanonicalTraceEvent { t = 0.0, kind = "release" },
                new CanonicalTraceEvent { t = 2.4, kind = "boundary", runs = 4, p = new TraceVector3 { x = 0, y = 0, z = -60 } },
                new CanonicalTraceEvent { t = 3.0, kind = "dead" }
            };
            var roster = new List<(string, string, double, double)>
            {
                ("sprint", "mid_off", 10.0, -30.0), ("jog", "mid_on", -10.0, -30.0), ("away", "cover", 20.0, -30.0),
                ("keeper", "keeper", 0.0, 11.0)
            };
            var reactions = ProductionFieldingPlanner.Reactions(trace, roster, null, null, true, "middle", false);
            Assert.That(reactions.Keys, Is.EquivalentTo(new[] { "sprint" }), "only the chaser puts his hands on his hips");
            Assert.That(reactions["sprint"].clip, Is.EqualTo(ProductionFieldingClip.HandsOnHips));
            Assert.That(reactions["sprint"].time, Is.GreaterThanOrEqualTo(2.4 + 0.35));
        }

        [Test]
        public void CopiedPhysicsFieldingNumbers_MatchTheTypeScriptSource()
        {
            var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "..", "..", ".."));
            var physics = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "src/physics/fielding.ts"));
            foreach (var (name, value) in new[]
                     {
                         ("keeper", ProductionFielding.KeeperTopSpeed), ("bowler", ProductionFielding.BowlerTopSpeed),
                         ("close", ProductionFielding.CloseTopSpeed), ("ring", ProductionFielding.RingTopSpeed),
                         ("deep", ProductionFielding.DeepTopSpeed)
                     })
            {
                var match = System.Text.RegularExpressions.Regex.Match(physics,
                    @"\n\s*" + name + @": \{[^}]*topSpeed: ([0-9.]+)");
                Assert.That(match.Success, Is.True, name);
                Assert.That(double.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture),
                    Is.EqualTo(value), name + " top speed");
            }
            Assert.That(physics, Does.Contain("export const DEEP_FROM_M = " +
                ProductionFielding.DeepFromMetres.ToString(System.Globalization.CultureInfo.InvariantCulture) + ";"));
            Assert.That(physics, Does.Contain(
                "new Set<FielderRole>(['slip', 'gully', 'leg_slip', 'short_leg', 'silly_point'])"));
            var geometry = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "src/physics/geometry.ts"));
            Assert.That(geometry, Does.Contain("export const CONTACT_Z = PITCH_HALF - POPPING - 0.25;"));
            Assert.That(geometry, Does.Contain("export const STRIKER_REF = { x: 0, z: CONTACT_Z }"));
            var presentation = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "src/render3d/practice/fielding.ts"));
            Assert.That(presentation, Does.Contain("export const CHASE_SPEED_SHARE = 0.7;"));
            Assert.That(presentation, Does.Contain("export const CHASE_GAIN_M = 2;"));
        }

        [Test]
        public void World_DrivesEveryFielderFromTheTrace_RootOnThePath_AndRestoresTheSetFieldNextBall()
        {
            var root = new GameObject("ProceduralPracticeWorld-FieldingTest");
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = "left",
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.Standard
                }, new SilentSink());
                world.ConfigureScene(Scene("left"));
                world.BeginDelivery(Delivery());
                world.Tick(3.0);
                var trace = CanonicalTraceTestFixture.Create();
                trace.fielders[5].samples = new[]
                {
                    S(0.0, 0f, 10f, "set"), S(0.3, 0.2f, 10.4f, "run"), S(0.6, 1.0f, 11.2f, "pickup"),
                    S(0.8, 1.0f, 11.2f, "throw"), S(1.0, 1.0f, 11.2f, "idle")
                };
                world.AcceptResult(new PracticeResultPresentation
                {
                    Trace = trace,
                    BatterBodyFrame = new PracticeBatterBodyFramePresentation
                    {
                        Stance = new TraceVector2 { x = -0.15, z = 8.96 },
                        TorsoTop = new TraceVector3 { x = -0.3, y = 1.42, z = 8.94 },
                        HeadCentre = new TraceVector3 { x = -0.2, y = 1.62, z = 8.86 }
                    },
                    ReplayDigest = new string('c', 64),
                    PlaybackSpeed = 1,
                    IsReplay = true
                });
                Assert.That(world.FieldingTrackForTesting("fielder-5"), Is.Not.Null);
                // HUM U5 (2026-11-04): the bowler gets the same planner choreography, but only from his first
                // non-"set" physics sample; until then his delivery follow-through converges onto that spot.
                Assert.That(world.FieldingTrackForTesting("fielder-1"), Is.Not.Null,
                    "the bowler fields like everyone else once his physics path acts");
                var fielder = root.GetComponentsInChildren<Transform>(true).First(value => value.name == "FielderProxy-fielder-5");
                for (var step = 0; step < 50; step++)
                {
                    world.Tick(0.02);
                    // Lead ruling (HUM-AUDIT U1, 2026-11-04: no statues between balls): after the dead ball the fielders walk
                    // back towards their set spots, presentation only. The physics path stays authoritative through the
                    // trace, which is what this asserts. Before the ruling it also asserted the last path sample after
                    // the dead ball, when fielders used to stand frozen.
                    if (world.Timeline > trace.durationSeconds + 1e-9) break;
                    var t = world.Timeline;
                    // A left-hander's world keeps physics x (owner ruling 2026-11-04: only a right-hander reflects).
                    var expected = PathAt(trace.fielders[5].samples, t, false);
                    Assert.That(Vector3.Distance(fielder.position, expected), Is.LessThan(1e-4f),
                        "the root is the physics path at t=" + t);
                }

                world.Stop();
                world.BeginDelivery(Delivery());
                // HUM U2: no snap at BeginDelivery; the fielder walks in and stands exactly on the set field at
                // release, the physics start.
                for (var step = 0; step < 400 && world.Timeline < 0.0; step++) world.Tick(1.0 / 60.0);
                Assert.That(world.Timeline, Is.GreaterThanOrEqualTo(0.0));
                Assert.That(Vector3.Distance(fielder.position, new Vector3(0f, 0f, 10f)), Is.LessThan(1e-4f),
                    "the ball is released with the field set (fielder-5 at x 0, z 10)");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        // ---- helpers --------------------------------------------------------------------------------------------

        private static FielderTraceSample[] RunPickupThrow(out double pickupT, out double throwT)
        {
            var samples = new List<FielderTraceSample> { S(0.0, 15f, 25f, "set"), S(0.6, 15f, 25f, "set") };
            for (var step = 1; step <= 7; step++)
                samples.Add(S(0.6 + step * 0.1, 15f - step * 0.375f, 25f - step * 0.625f, "run"));
            pickupT = 1.4;
            throwT = 1.9;
            samples.Add(S(pickupT, 12f, 20f, "pickup"));
            samples.Add(S(throwT, 12f, 20f, "throw"));
            samples.Add(S(2.4, 12f, 20f, "idle"));
            return samples.ToArray();
        }

        private static ProductionFieldingContext Context(Func<double, Vector3?> ball)
        {
            return new ProductionFieldingContext
            {
                Ball = ball,
                BallVelocity = t => new Vector3(0f, 0f, -20f),
                Striker = Striker,
                Heading = 0f,
                Phase = 0.3f
            };
        }

        /// <summary>A ball travelling from the striker to `at` by `t`, then to the keeper's end.</summary>
        private static Func<double, Vector3?> BallTo(Vector3 at, double t)
        {
            var keeper = new Vector3(0f, 1f, 10.5f);
            return time =>
            {
                if (double.IsPositiveInfinity(time)) return keeper;
                if (time <= t) return Vector3.Lerp(Striker, at, (float)Math.Max(0.0, time / t));
                return Vector3.Lerp(at, keeper, (float)Math.Min(1.0, (time - t) / 0.8));
            };
        }

        private static FielderTraceSample[] Line(float x0, float z0, float x1, float z1, double t0, double t1, int steps,
            string action)
        {
            var samples = new List<FielderTraceSample> { S(0.0, x0, z0, "set") };
            for (var step = 0; step <= steps; step++)
            {
                var u = step / (float)steps;
                samples.Add(S(t0 + (t1 - t0) * u, x0 + (x1 - x0) * u, z0 + (z1 - z0) * u, action));
            }
            samples.Add(S(t1 + 1.0, x1, z1, "idle"));
            return samples.ToArray();
        }

        private static FielderTraceSample S(double t, float x, float z, string action)
        {
            return new FielderTraceSample { t = t, x = x, z = z, action = action };
        }

        private static Vector3 PathAt(FielderTraceSample[] samples, double t, bool mirror)
        {
            var sorted = samples.OrderBy(sample => sample.t).ToArray();
            var sign = mirror ? -1f : 1f;
            if (t <= sorted[0].t) return new Vector3(sign * (float)sorted[0].x, 0f, (float)sorted[0].z);
            for (var index = 0; index + 1 < sorted.Length; index++)
            {
                if (t > sorted[index + 1].t) continue;
                var u = (float)((t - sorted[index].t) / (sorted[index + 1].t - sorted[index].t));
                return new Vector3(sign * (float)(sorted[index].x + (sorted[index + 1].x - sorted[index].x) * u), 0f,
                    (float)(sorted[index].z + (sorted[index + 1].z - sorted[index].z) * u));
            }
            var last = sorted[sorted.Length - 1];
            return new Vector3(sign * (float)last.x, 0f, (float)last.z);
        }

        private static void AssertRootIsPath(ProductionFieldingTrack track, FielderTraceSample[] path, bool mirror)
        {
            var end = path.Max(sample => sample.t);
            for (var t = path.Min(sample => sample.t); t <= end; t += 0.005)
            {
                var drawn = track.Evaluate(t).Position;
                Assert.That(Vector3.Distance(drawn, PathAt(path, t, mirror)), Is.LessThan(1e-4f),
                    "the drawn root is the physics path at t=" + t);
            }
        }

        private static ProductionFieldingMove MoveAt(ProductionFieldingTrack track, double t)
        {
            return track.Moves[track.Evaluate(t).MoveIndex];
        }

        private static void AssertClipAt(ProductionFieldingTrack track, double eventT, ProductionFieldingClip clip,
            string marker)
        {
            var move = MoveAt(track, eventT + 1e-4);
            Assert.That(move.Clip, Is.EqualTo(clip), "the clip on the physics event at t=" + eventT);
            Assert.That(move.ClipTimeAt(eventT), Is.EqualTo(ProductionFieldingClips.Marker(clip, marker)).Within(1e-4),
                "the '" + marker + "' marker lands on the physics time " + eventT);
        }

        private static void AssertNoRunOnTheSpot(ProductionFieldingTrack track)
        {
            foreach (var move in track.Moves)
            {
                var dt = move.T1 - move.T0;
                var speed = Vector3.Distance(move.From, move.To) / dt;
                if (speed <= ProductionFieldingPlanner.StillMetresPerSecond)
                {
                    Assert.That(ProductionFieldingClips.IsRun(move.Clip), Is.False,
                        "no running on the spot (" + move.T0 + "–" + move.T1 + ")");
                    Assert.That(move.HasLower, Is.False);
                }
            }
        }

        private static void AssertTurnRate(ProductionFieldingTrack track)
        {
            foreach (var move in track.Moves)
            {
                var dt = move.T1 - move.T0;
                var turn = Mathf.Abs(ProductionFieldingPlanner.AngleDelta(move.Heading, move.HeadingTo)) / dt;
                Assert.That(turn, Is.LessThanOrEqualTo(ProductionFieldingPlanner.MaximumTurnRadiansPerSecond + 1e-3),
                    "turns are rate-limited");
            }
        }

        private static PracticeScenePresentation Scene(string handedness)
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = "fielder-" + index,
                    Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "point",
                    X = index - 5,
                    Z = index * 2
                };
            return new PracticeScenePresentation
            {
                BallAge = "new",
                BallColour = "red",
                BatterCreaseOffsetM = 0,
                BatterLateralM = 0,
                BowlerArm = "right",
                BowlerFamily = "pace",
                Conditions = "balanced",
                Fielders = fielders,
                Handedness = handedness
            };
        }

        private static PracticeDeliveryPresentation Delivery()
        {
            return new PracticeDeliveryPresentation
            {
                Flight = new[]
                {
                    new BallTraceSample
                    {
                        t = 0, p = new TraceVector3 { x = 0, y = 2, z = -8 }, v = new TraceVector3 { x = 0, y = -1, z = 35 }
                    },
                    new BallTraceSample
                    {
                        t = 1, p = new TraceVector3 { x = 0, y = 0.4, z = 9 }, v = new TraceVector3 { x = 0, y = 0, z = 20 }
                    }
                },
                SeamAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                ShineDirection = new TraceVector3 { x = 1, y = 0, z = 0 },
                SpinAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                SpinRps = 10
            };
        }

        private sealed class SilentSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
