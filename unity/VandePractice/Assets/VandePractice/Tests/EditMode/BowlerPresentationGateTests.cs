using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Motion;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The bowler as drawn, sampled at 60 Hz through the real world (ProceduralPracticeWorld.Tick), against the gates
    /// the web bowler met (docs/PRACTICE_PRESENTATION.md "Bowler", release/.../humans/bowler/GATES-after.md; MOTION-SPEC
    /// section 9). Builder measurement, not a certification: the bowling arm around the release (a stress case forces
    /// a 9 cm residual by putting the physics release outside the body-scale clamp), the run-up's start and cadence,
    /// and the idle-to-delivery hand-over. Set VANDE_BOWLER_GATES_OUT to a directory to also write bowler-gates.json;
    /// VANDE_BOWLER_GATES_REPORT_ONLY=1 reports without asserting (to measure a tree that does not meet the gates).
    /// </summary>
    public sealed class BowlerPresentationGateTests
    {
        private const double Dt = 1.0 / 60.0;
        private const int IdleFrames = 30;
        private const int WindowBefore = 36;
        private const int WindowAfter = 18;
        private const int JointCount = (int)ProductionCharacterJoint.Count;

        private sealed class Case
        {
            public string Name;
            public string Family;
            public string Arm;
            public double ReleaseY;
            public string Note;
            /// <summary>none: the physics release geometry (no residual); small: about 2 cm and large: about 9 cm, both left by the body-scale clamp.</summary>
            public string Residual = "none";
        }

        private sealed class Frame
        {
            public Vector3 Root, Hips, Shoulder, Elbow, Wrist, Palm, FootL, FootR, Ball;
            public Quaternion RootRotation;
            public float Scale;
            public float RootYaw;
            public readonly Quaternion[] Q = new Quaternion[JointCount];
        }

        private sealed class Run
        {
            public Case Case;
            public bool Reach;
            public int ReleaseFrame = -1;
            public double Approach;
            public Frame Idle;
            public Vector3 Target;
            public readonly List<Frame> Frames = new List<Frame>();
        }

        // Pace releases 0.42 m from the stumps' line and 1.4 m in from the crease; spin 0.30 m and 1.28 m (src/physics
        // constants RELEASE_GEOMETRY). Nominal heights are inside the physics geometry (pace 2.05-2.30 m, spin
        // 1.80-2.00 m), where the per-delivery body scale fits the release exactly and the residual is zero. The other
        // heights are outside the body-scale clamp [0.95, 1.12] (the ball in the hand is 2.133 m high on the reference
        // pace body, 1.865 m on the off-spin one, 1.859 m on the leg-spin one), leaving about 2 cm or 9 cm of vertical
        // residual for the release reach: a radial residual for a straight vertical arm, which a rigid shoulder turn
        // cannot take up and the trunk's 6 degrees only partly.
        private static readonly Case[] Cases =
        {
            new Case { Name = "pace-right", Family = "pace", Arm = "right", ReleaseY = 2.15, Note = "nominal" },
            new Case { Name = "pace-left", Family = "pace", Arm = "left", ReleaseY = 2.30, Note = "nominal" },
            new Case { Name = "off-right", Family = "spin", Arm = "right", ReleaseY = 1.90, Note = "nominal, finger spin" },
            new Case { Name = "leg-left", Family = "spin", Arm = "left", ReleaseY = 1.90, Note = "nominal, wrist spin" },
            new Case { Name = "pace-right-high2", Family = "pace", Arm = "right", ReleaseY = 2.4087, Note = "+2 cm residual", Residual = "small" },
            new Case { Name = "pace-left-low2", Family = "pace", Arm = "left", ReleaseY = 2.0062, Note = "-2 cm residual", Residual = "small" },
            new Case { Name = "off-right-low2", Family = "spin", Arm = "right", ReleaseY = 1.7516, Note = "-2 cm residual", Residual = "small" },
            new Case { Name = "leg-left-high2", Family = "spin", Arm = "left", ReleaseY = 2.1015, Note = "+2 cm residual", Residual = "small" },
            new Case { Name = "pace-right-high9", Family = "pace", Arm = "right", ReleaseY = 2.479, Note = "+9 cm residual", Residual = "large" },
            new Case { Name = "pace-left-low9", Family = "pace", Arm = "left", ReleaseY = 1.937, Note = "-9 cm residual", Residual = "large" },
            new Case { Name = "off-right-low9", Family = "spin", Arm = "right", ReleaseY = 1.682, Note = "-9 cm residual", Residual = "large" },
            new Case { Name = "leg-left-high9", Family = "spin", Arm = "left", ReleaseY = 2.179, Note = "+9 cm residual", Residual = "large" }
        };

        [Test]
        public void TheDrawnBowler_MeetsTheReleaseAndRunUpGates()
        {
            var failures = new List<string>();
            var json = new StringBuilder("{\"rule\":\"bowler gates, drawn rig at 60 Hz\",\"cases\":[");
            var first = true;
            foreach (var item in Cases)
            {
                var drawn = Execute(item, true);
                var bare = Execute(item, false);
                var report = Measure(drawn, bare, failures);
                if (!first) json.Append(',');
                first = false;
                json.Append(report);
            }
            json.Append("]}");
            var output = Environment.GetEnvironmentVariable("VANDE_BOWLER_GATES_OUT");
            if (!string.IsNullOrEmpty(output))
            {
                Directory.CreateDirectory(output);
                File.WriteAllText(Path.Combine(output, "bowler-gates.json"), json.ToString());
            }
            if (Environment.GetEnvironmentVariable("VANDE_BOWLER_GATES_REPORT_ONLY") == "1")
            {
                Debug.Log("VANDE bowler gates (report only): " + failures.Count + " failing\n" + string.Join("\n", failures));
                return;
            }
            Assert.That(failures, Is.Empty, string.Join("\n", failures));
        }

        // The release reach on one posed rig, in every direction. The pipeline itself only meets a vertical residual
        // (the body-scale clamp); the reach has to be safe for any (the web's wrist cues move the ball sideways too).
        private static readonly Vector3[] ReachDirections =
        {
            Vector3.up, Vector3.down, Vector3.right, Vector3.left, Vector3.forward, Vector3.back,
            new Vector3(0.6f, 0.8f, 0f), new Vector3(-0.6f, -0.8f, 0f)
        };

        [TestCase(false)]
        [TestCase(true)]
        public void ReleaseReach_MovesTheBallByTheTrunkAndShoulderAndNeverBendsTheElbow(bool leftArm)
        {
            var host = new GameObject("VANDE release reach host");
            ProductionCharacterRig rig = null;
            var lines = new StringBuilder();
            var failures = new List<string>();
            try
            {
                var spec = ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler, ProductionCharacterDetail.Medium);
                spec.Handedness = ProceduralPracticeWorld.RigHandednessFor(leftArm);
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var runUp = ProductionBowlerRunUp.TryCreate("pace", 2.40, leftArm);
                Assert.That(runUp, Is.Not.Null, "the bowler pack is shipped");
                var pose = new ProductionCharacterPose();
                runUp.Sample(runUp.TRelease, pose);
                var deliveryIsLeft = rig.Handedness == ProductionCharacterHandedness.Left;
                var shoulderJoint = deliveryIsLeft ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight;
                var elbowJoint = deliveryIsLeft ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight;
                var wristJoint = deliveryIsLeft ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight;
                Func<double> bend = () => Vector3.Angle(
                    rig.VisibleJointWorldPosition(elbowJoint) - rig.VisibleJointWorldPosition(shoulderJoint),
                    rig.VisibleJointWorldPosition(wristJoint) - rig.VisibleJointWorldPosition(elbowJoint));
                rig.ApplyPose(pose);
                var palm0 = rig.ReleaseHandAnchor.position;
                var bend0 = bend();
                var chest0 = rig.Joint(ProductionCharacterJoint.Chest).rotation;
                var hips0 = rig.VisibleJointWorldPosition(ProductionCharacterJoint.Hips);
                var footL0 = rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootLeft);
                var footR0 = rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootRight);
                var elbowWorld0 = rig.Joint(elbowJoint).localRotation;
                lines.Append("arm ").Append(leftArm ? "left" : "right").Append(": elbow bend at the release ")
                     .Append(Num(bend0)).Append(" deg\n");
                foreach (var magnitude in new[] { 0.01f, 0.02f, 0.05f, 0.09f })
                    foreach (var direction in ReachDirections)
                    {
                        var delta = direction.normalized * magnitude;
                        rig.ApplyPose(pose);
                        var miss = rig.ReachReleaseWithTrunkAndShoulder(delta, 1f);
                        var palm = rig.ReleaseHandAnchor.position;
                        var gap = Vector3.Distance(palm, palm0 + delta);
                        var elbowChange = Math.Abs(bend() - bend0);
                        var lean = Quaternion.Angle(chest0, rig.Joint(ProductionCharacterJoint.Chest).rotation);
                        var hipsMoved = Vector3.Distance(hips0, rig.VisibleJointWorldPosition(ProductionCharacterJoint.Hips));
                        var feetMoved = Math.Max(Vector3.Distance(footL0, rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootLeft)),
                            Vector3.Distance(footR0, rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootRight)));
                        var forearmTurned = Quaternion.Angle(elbowWorld0, rig.Joint(elbowJoint).localRotation);
                        lines.Append("  ").Append(Num(magnitude * 100)).Append(" cm ").Append(direction.ToString("0.0"))
                             .Append(": gap ").Append(Num(gap * 100)).Append(" cm, reported miss ").Append(Num(miss * 100))
                             .Append(" cm, elbow change ").Append(Num(elbowChange)).Append(" deg, forearm local turn ")
                             .Append(Num(forearmTurned)).Append(" deg, trunk lean ").Append(Num(lean))
                             .Append(" deg, hips moved ").Append(Num(hipsMoved * 1000)).Append(" mm, feet moved ")
                             .Append(Num(feetMoved * 1000)).Append(" mm\n");
                        var where = "arm " + (leftArm ? "left" : "right") + ", " + Num(magnitude * 100) + " cm " + direction.ToString("0.0");
                        if (elbowChange > 0.5) failures.Add(where + ": the elbow bent by " + Num(elbowChange) + " deg");
                        if (forearmTurned > 0.05) failures.Add(where + ": the forearm turned at the elbow by " + Num(forearmTurned) + " deg");
                        if (lean > ProductionCharacterRig.ReleaseReachTrunkMaxDegrees + 0.01) failures.Add(where + ": the trunk leaned " + Num(lean) + " deg");
                        if (hipsMoved > 0.001 || feetMoved > 0.001) failures.Add(where + ": the hips or feet moved");
                    }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                UnityEngine.Object.DestroyImmediate(host);
            }
            var output = Environment.GetEnvironmentVariable("VANDE_BOWLER_GATES_OUT");
            if (!string.IsNullOrEmpty(output))
            {
                Directory.CreateDirectory(output);
                File.WriteAllText(Path.Combine(output, "release-reach-" + (leftArm ? "left" : "right") + ".txt"), lines.ToString());
            }
            if (Environment.GetEnvironmentVariable("VANDE_BOWLER_GATES_REPORT_ONLY") == "1")
            {
                Debug.Log("VANDE release reach (report only): " + failures.Count + " failing\n" + lines + string.Join("\n", failures));
                return;
            }
            Assert.That(failures, Is.Empty, string.Join("\n", failures));
        }

        // ---------------------------------------------------------------------------------------------------------
        // Driving the world
        // ---------------------------------------------------------------------------------------------------------

        private static Run Execute(Case item, bool reach)
        {
            var run = new Run { Case = item, Reach = reach };
            var host = new GameObject("VANDE bowler gates " + item.Name);
            try
            {
                var world = host.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = "right",
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.High
                }, new NullSink());
                world.ConfigureScene(Scene(item));
                world.BowlerReleaseReachEnabledForTesting = reach;
                // Between balls he idles on the mark (PresentBowlerWalkBack), as in the app.
                for (var index = 0; index < IdleFrames; index++) world.Tick(Dt);
                var rig = BowlerRig(world);
                run.Idle = Read(world, rig);
                run.Approach = ProductionBowlingPresentation.ForSceneFamily(item.Family).ApproachSeconds;
                world.BeginDelivery(Delivery(item));
                run.Frames.Add(Read(world, rig));
                for (var guard = 0; guard < 600; guard++)
                {
                    world.Tick(Dt);
                    run.Frames.Add(Read(world, rig));
                    if (run.ReleaseFrame < 0 && world.StateForEvidence == "Flight")
                    {
                        run.ReleaseFrame = run.Frames.Count - 1;
                        run.Target = run.Frames[run.ReleaseFrame].Ball;
                    }
                    if (run.ReleaseFrame >= 0 && run.Frames.Count > run.ReleaseFrame + WindowAfter + 1) break;
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
            Assert.That(run.ReleaseFrame, Is.GreaterThan(WindowBefore + 1), item.Name + " reached its release");
            return run;
        }

        private static ProductionCharacterRig BowlerRig(ProceduralPracticeWorld world)
        {
            foreach (var pair in world.PresentedHumansForEvidence())
                if (pair.Key == "bowler") return pair.Value;
            Assert.Fail("The world presents a bowler.");
            return null;
        }

        private static Frame Read(ProceduralPracticeWorld world, ProductionCharacterRig rig)
        {
            var left = rig.Handedness == ProductionCharacterHandedness.Left;
            var frame = new Frame
            {
                Root = rig.Root.position,
                RootRotation = rig.Root.rotation,
                Scale = rig.Root.localScale.x,
                RootYaw = rig.Root.eulerAngles.y,
                Hips = rig.VisibleJointWorldPosition(ProductionCharacterJoint.Hips),
                Shoulder = rig.VisibleJointWorldPosition(left
                    ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight),
                Elbow = rig.VisibleJointWorldPosition(left
                    ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight),
                Wrist = rig.VisibleJointWorldPosition(left
                    ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight),
                Palm = rig.ReleaseHandAnchor.position,
                FootL = rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootLeft),
                FootR = rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootRight),
                Ball = world.BallForEvidence != null ? world.BallForEvidence.position : Vector3.zero
            };
            for (var joint = 0; joint < JointCount; joint++)
                frame.Q[joint] = rig.Joint((ProductionCharacterJoint)joint).localRotation;
            return frame;
        }

        private static PracticeScenePresentation Scene(Case item)
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
                BowlerArm = item.Arm,
                BowlerFamily = item.Family,
                BowlerSpinType = item.Family == "spin" ? (item.Name.StartsWith("leg", StringComparison.Ordinal) ? "wrist" : "finger") : null,
                Conditions = "balanced",
                Fielders = fielders,
                Handedness = "right"
            };
        }

        private static PracticeDeliveryPresentation Delivery(Case item)
        {
            var armSign = item.Arm == "right" ? 1.0 : -1.0;
            var pace = item.Family == "pace";
            var release = new TraceVector3
            {
                x = armSign * (pace ? 0.42 : 0.30),
                y = item.ReleaseY,
                z = -10.06 + (pace ? 1.4 : 1.28)
            };
            return new PracticeDeliveryPresentation
            {
                Flight = new[]
                {
                    new BallTraceSample { t = 0, p = release, v = new TraceVector3 { x = 0, y = -1, z = 35 } },
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

        // ---------------------------------------------------------------------------------------------------------
        // Measures (ported from the web's BOWLER-1 probes: G6 the bowling arm, G5 the run-up, G12 the planted feet)
        // ---------------------------------------------------------------------------------------------------------

        private static double Deg(double radians) => radians * 180.0 / Math.PI;

        private static double BoneAngle(Quaternion a, Quaternion b) =>
            2.0 * Deg(Math.Acos(Math.Min(1.0, Math.Abs((double)Quaternion.Dot(a, b)))));

        private static double Bend(Frame f) => Vector3.Angle(f.Elbow - f.Shoulder, f.Wrist - f.Elbow);

        private static double Elevation(Frame f)
        {
            var a = f.Elbow - f.Shoulder;
            return Deg(Math.Asin(Math.Max(-1.0, Math.Min(1.0, a.y / a.magnitude))));
        }

        private static int ArmJoint(Run run, int bone)
        {
            // bone 0 upper arm, 1 forearm, 2 hand of the delivery arm
            var left = run.Frames.Count > 0 && DeliveryArmIsLeft(run);
            var baseIndex = left ? (int)ProductionCharacterJoint.UpperArmLeft : (int)ProductionCharacterJoint.UpperArmRight;
            return baseIndex + bone;
        }

        private static bool DeliveryArmIsLeft(Run run)
        {
            // RigHandednessFor: a canonical right arm is a rig labelled Left, whose release hand is its HandLeft.
            return run.Case.Arm == "right";
        }

        private static string Measure(Run drawn, Run bare, List<string> failures)
        {
            var name = drawn.Case.Name;
            var r = drawn.ReleaseFrame;
            var f = drawn.Frames;
            var sb = new StringBuilder();
            sb.Append("{\"case\":\"").Append(name).Append("\",\"note\":\"").Append(drawn.Case.Note)
              .Append("\",\"releaseFrame\":").Append(r).Append(",\"approachS\":").Append(Num(drawn.Approach))
              .Append(",\"scale\":").Append(Num(f[0].Scale)).Append(",\"residual\":\"").Append(drawn.Case.Residual).Append("\"");

            // ---- G6: the bowling arm around the release -----------------------------------------------------
            int n = WindowBefore + WindowAfter + 1;
            var bend = new double[n];
            var elev = new double[n];
            for (var i = 0; i < n; i++)
            {
                var frame = f[r - WindowBefore + i];
                bend[i] = Bend(frame);
                elev[i] = Elevation(frame);
            }
            int At(int j) => j + WindowBefore;
            var horizontal = -1000;
            for (var j = -24; j <= 0; j++)
                if (elev[At(j) - 1] < 0 && elev[At(j)] >= 0) { horizontal = j; break; }
            var from = horizontal > -1000 ? horizontal : -6;
            double maxBend = double.MinValue;
            var maxAt = from;
            for (var j = from; j <= 0; j++)
                if (bend[At(j)] > maxBend) { maxBend = bend[At(j)]; maxAt = j; }
            var minAfter = double.MaxValue;
            for (var j = maxAt; j <= 0; j++) minAfter = Math.Min(minAfter, bend[At(j)]);
            var peakToRelease = maxBend - bend[At(0)];
            var extension = maxBend - minAfter;
            double rate150 = 0;
            for (var j = -9; j <= 0; j++) rate150 = Math.Max(rate150, Math.Abs(bend[At(j)] - bend[At(j - 1)]) / Dt);
            double Armw(int bone, int a, int b)
            {
                var joint = ArmJoint(drawn, bone);
                double m = 0;
                for (var j = a; j <= b; j++)
                    m = Math.Max(m, BoneAngle(f[r + j].Q[joint], f[r + j - 1].Q[joint]) / Dt);
                return m;
            }
            var upper = Armw(0, -WindowBefore + 1, WindowAfter);
            var fore = Armw(1, -WindowBefore + 1, WindowAfter);
            var hand = Armw(2, -WindowBefore + 1, WindowAfter);
            double PalmSpeed(Run x, int j) => Vector3.Distance(x.Frames[x.ReleaseFrame + j].Palm, x.Frames[x.ReleaseFrame + j - 1].Palm) / Dt;
            var palmLast = PalmSpeed(drawn, 0);
            var palmBare = PalmSpeed(bare, 0);
            var ratio = palmBare > 1e-6 ? palmLast / palmBare : 1.0;
            var gap0 = Vector3.Distance(f[r].Palm, drawn.Target);
            var gap1 = Vector3.Distance(f[r - 1].Palm, drawn.Target);
            var gapBare = Vector3.Distance(bare.Frames[bare.ReleaseFrame].Palm, bare.Target);
            // Hero (rendered) wrist against the driver's ball point: the 2 cm agreement of the hero release hand.
            var heroGap = Vector3.Distance(f[r].Wrist, f[r].Palm);
            sb.Append(",\"g6\":{")
              .Append("\"peakToRelease\":").Append(Num(peakToRelease))
              .Append(",\"extension\":").Append(Num(extension))
              .Append(",\"bendAtRelease\":").Append(Num(bend[At(0)]))
              .Append(",\"maxBend120\":").Append(Num(Enumerable.Range(-6, 7).Max(j => bend[At(j)])))
              .Append(",\"rate150\":").Append(Num(rate150))
              .Append(",\"upperArm\":").Append(Num(upper)).Append(",\"forearm\":").Append(Num(fore))
              .Append(",\"hand\":").Append(Num(hand))
              .Append(",\"palmLast\":").Append(Num(palmLast)).Append(",\"palmLastBare\":").Append(Num(palmBare))
              .Append(",\"palmRatio\":").Append(Num(ratio))
              .Append(",\"gapCm\":").Append(Num(gap0 * 100)).Append(",\"gapHalfFrameEarlierCm\":").Append(Num(gap1 * 100))
              .Append(",\"gapBareCm\":").Append(Num(gapBare * 100))
              .Append(",\"wristToBallPointCm\":").Append(Num(heroGap * 100))
              .Append(",\"horizontalAtFrame\":").Append(horizontal).Append("}");
            Gate(failures, name, "elbow peak-to-release (deg) <= 10", peakToRelease, 10.0);
            Gate(failures, name, "elbow extension (deg) <= 10", extension, 10.0);
            Gate(failures, name, "elbow rate last 150 ms (deg/s) <= 1200", rate150, 1200.0);
            Gate(failures, name, "upper arm (deg/s) <= 1800", upper, 1800.0);
            Gate(failures, name, "forearm (deg/s) <= 1800", fore, 1800.0);
            Gate(failures, name, "hand (deg/s) <= 1800", hand, 1800.0);
            if (drawn.Case.Residual == "large")
            {
                // The trunk (6 degrees) and a rigid shoulder turn cannot take up a 9 cm radial residual: what they can,
                // they do (never worse than the bare clip, never the elbow); the rest is the named limitation.
                Gate(failures, name, "palm gap at release no worse than the bare clip's, less 1 cm (cm)", gap0 * 100, gapBare * 100 - 1.0);
            }
            else
                Gate(failures, name, "palm gap at release (cm) <= 1 (the lead's 3, aim 1)", gap0 * 100, 1.0);
            GateMin(failures, name, "palm speed ratio >= 0.8", ratio, 0.8);

            // ---- G12: the planted feet around the release ---------------------------------------------------
            var restY = Math.Min(f.Min(x => x.FootL.y), f.Min(x => x.FootR.y));
            double Slide(Func<Frame, Vector3> foot)
            {
                Vector3? anchor = null;
                double m = 0;
                for (var j = -15; j <= 6; j++)
                {
                    var p = foot(f[r + j]);
                    if (p.y <= restY + 0.01)
                    {
                        if (!anchor.HasValue) anchor = p;
                        m = Math.Max(m, Math.Sqrt((p.x - anchor.Value.x) * (p.x - anchor.Value.x) + (p.z - anchor.Value.z) * (p.z - anchor.Value.z)));
                    }
                    else anchor = null;
                }
                return m;
            }
            var slide = Math.Max(Slide(x => x.FootL), Slide(x => x.FootR));
            sb.Append(",\"g12\":{\"plantedSlideCm\":").Append(Num(slide * 100)).Append(",\"restAnkleY\":").Append(Num(restY)).Append("}");

            // ---- G5: the run-up -------------------------------------------------------------------------------
            var count = f.Count;
            double HipSpeed(int k, int w)
            {
                var a = Math.Max(0, k - w);
                var c = Math.Min(count - 1, k + w);
                return Horizontal(f[c].Hips - f[a].Hips) / ((c - a) * Dt);
            }
            double RootSpeed(int k, int w)
            {
                var a = Math.Max(0, k - w);
                var c = Math.Min(count - 1, k + w);
                return Horizontal(f[c].Root - f[a].Root) / ((c - a) * Dt);
            }
            var lastApproach = r - 27;
            double hipsPeak = double.MinValue, hipsPeak1 = double.MinValue, rootPeak = double.MinValue, rootPeak1 = double.MinValue;
            for (var k = 6; k < Math.Min(count - 6, lastApproach); k++)
            {
                var ah = (HipSpeed(k + 6, 2) - HipSpeed(k - 6, 2)) / (12 * Dt);
                var ar = (RootSpeed(k + 6, 2) - RootSpeed(k - 6, 2)) / (12 * Dt);
                hipsPeak = Math.Max(hipsPeak, ah);
                rootPeak = Math.Max(rootPeak, ar);
                if (k * Dt <= 1.0) { hipsPeak1 = Math.Max(hipsPeak1, ah); rootPeak1 = Math.Max(rootPeak1, ar); }
            }
            double rootStep = 0, previousSpeed = 0;
            for (var k = 1; k * Dt < 0.6; k++)
            {
                var v = Horizontal(f[k].Root - f[k - 1].Root) / Dt;
                rootStep = Math.Max(rootStep, Math.Abs(v - previousSpeed));
                previousSpeed = v;
            }
            // Strikes: an ankle below 10.5 cm at the reference body (the web's gate, scaled by the body scale: the
            // hero's planted ankle is 7 to 9 cm up); steps and cadence against the MOTION-SPEC 9 band.
            var contactHeight = 0.105 * f[0].Scale;
            var strikes = new List<KeyValuePair<int, int>>();
            for (var foot = 0; foot < 2; foot++)
            {
                var on = false;
                for (var k = 0; k < count; k++)
                {
                    var low = (foot == 0 ? f[k].FootL.y : f[k].FootR.y) < contactHeight;
                    if (low && !on) { on = true; strikes.Add(new KeyValuePair<int, int>(k, foot)); }
                    if (!low && on) on = false;
                }
            }
            strikes.Sort((a, b) => a.Key.CompareTo(b.Key));
            var releaseMs = r * Dt * 1000.0;
            var approach = strikes.Where(s => s.Key * Dt * 1000.0 > 150 && s.Key * Dt * 1000.0 < releaseMs - 400).ToList();
            var over = new List<double>();
            var intervals = new List<double>();
            for (var i = 1; i < approach.Count; i++)
            {
                var interval = (approach[i].Key - approach[i - 1].Key) * Dt * 1000.0;
                var cadence = 60000.0 / interval;
                double lo, hi;
                Band(HipSpeed(approach[i].Key, 2), out lo, out hi);
                over.Add(cadence / hi);
                intervals.Add(interval);
            }
            var worst3 = over.Count > 0 ? over.Take(3).Max() : double.NaN;
            sb.Append(",\"g5\":{\"hipsPeakAccelApproach\":").Append(Num(hipsPeak))
              .Append(",\"hipsPeakAccelFirstSecond\":").Append(Num(hipsPeak1))
              .Append(",\"rootPeakAccelApproach\":").Append(Num(rootPeak))
              .Append(",\"rootPeakAccelFirstSecond\":").Append(Num(rootPeak1))
              .Append(",\"rootSpeedStepPerFrameFirst600ms\":").Append(Num(rootStep))
              .Append(",\"rootSpeedAtFrame1\":").Append(Num(Horizontal(f[1].Root - f[0].Root) / Dt))
              .Append(",\"stepsOverBand\":[").Append(string.Join(",", over.Take(4).Select(Num))).Append("]")
              .Append(",\"stepsMs\":[").Append(string.Join(",", intervals.Take(4).Select(Num))).Append("]")
              .Append(",\"worstOfSteps1to3\":").Append(Num(worst3))
              .Append(",\"strikesMs\":[").Append(string.Join(",", approach.Take(6).Select(s => Num(s.Key * Dt * 1000.0)))).Append("]")
              .Append(",\"hipsSpeeds\":[").Append(string.Join(",", new[] { 0, 12, 24, 36, 48, 60 }.Select(k => Num(HipSpeed(Math.Min(k, count - 1), 3))))).Append("]")
              .Append(",\"rootSpeeds\":[").Append(string.Join(",", new[] { 0, 12, 24, 36, 48, 60 }.Select(k => Num(RootSpeed(Math.Min(k, count - 1), 3))))).Append("]")
              .Append(",\"rootSpeedSeries\":[").Append(string.Join(",", Enumerable.Range(1, Math.Min(60, count - 1)).Select(k => Num(Horizontal(f[k].Root - f[k - 1].Root) / Dt)))).Append("]")
              .Append(",\"ankleHeightsMmL\":[").Append(string.Join(",", Enumerable.Range(0, r + 1).Select(k => Math.Round(f[k].FootL.y * 1000).ToString("0", CultureInfo.InvariantCulture)))).Append("]")
              .Append(",\"ankleHeightsMmR\":[").Append(string.Join(",", Enumerable.Range(0, r + 1).Select(k => Math.Round(f[k].FootR.y * 1000).ToString("0", CultureInfo.InvariantCulture)))).Append("]")
              .Append(",\"startRootXZ\":[").Append(Num(f[0].Root.x)).Append(",").Append(Num(f[0].Root.z)).Append("]")
              .Append(",\"releaseRootXZ\":[").Append(Num(f[r].Root.x)).Append(",").Append(Num(f[r].Root.z)).Append("]")
              .Append("}");
            if (!double.IsNaN(worst3)) Gate(failures, name, "cadence of steps 1-3 over the band <= 1.10", worst3, 1.10);
            else failures.Add(name + ": fewer than two approach strikes were found to measure the cadence");
            Gate(failures, name, "root peak 0.2 s acceleration, approach (m/s^2) <= 6", rootPeak, 6.0);
            Gate(failures, name, "root speed step per frame, first 0.6 s (m/s) < 0.3", rootStep, 0.3);

            // ---- Pose pops: per-bone angular speed against the MOTION-SPEC 9 caps ------------------------------
            var firstOver = new List<string>();
            var allOver = new List<string>();
            double legStep = 0, shinStep = 0;
            for (var k = 1; k < count; k++)
                for (var joint = 0; joint < JointCount; joint++)
                {
                    var speed = BoneAngle(f[k].Q[joint], f[k - 1].Q[joint]) / Dt;
                    var cap = Cap((ProductionCharacterJoint)joint);
                    if (speed > cap)
                    {
                        var text = (ProductionCharacterJoint)joint + ":" + Num(speed) + "@" + (k * Dt * 1000.0).ToString("0", CultureInfo.InvariantCulture);
                        if (k * Dt <= 0.6) firstOver.Add(text);
                        allOver.Add(text);
                    }
                    if (k <= 12 && IsLeg((ProductionCharacterJoint)joint))
                    {
                        legStep = Math.Max(legStep, speed);
                        if ((ProductionCharacterJoint)joint == ProductionCharacterJoint.ShinLeft ||
                            (ProductionCharacterJoint)joint == ProductionCharacterJoint.ShinRight) shinStep = Math.Max(shinStep, speed);
                    }
                }
            sb.Append(",\"pops\":{\"legsFirst12FramesMax\":").Append(Num(legStep))
              .Append(",\"shinsFirst12FramesMax\":").Append(Num(shinStep))
              .Append(",\"over9CapFirst600ms\":[").Append(string.Join(",", firstOver.Select(Quote))).Append("]")
              .Append(",\"over9CapWholeWindow\":[").Append(string.Join(",", allOver.Distinct().Take(24).Select(Quote))).Append("]}");
            Gate(failures, name, "legs in the first 12 frames (deg/s) <= 1200", legStep, 1200.0);
            if (firstOver.Count > 0)
                failures.Add(name + ": bones over their MOTION-SPEC 9 angular-speed cap in the first 0.6 s: " + string.Join(" ", firstOver.Take(8)));

            // ---- Idle to delivery frame 0 (the hand-over) ------------------------------------------------------------
            double boneJump = 0;
            var jumpBone = ProductionCharacterJoint.Hips;
            for (var joint = 0; joint < JointCount; joint++)
            {
                var jump = BoneAngle(drawn.Idle.Q[joint], f[0].Q[joint]);
                if (jump > boneJump) { boneJump = jump; jumpBone = (ProductionCharacterJoint)joint; }
            }
            // The pose alone, in the rig's own frame: the root itself relocates to the run-up's mark at BeginDelivery
            // (this harness idles at the default mark, not at the previous ball's), nor is the body-scale fit of the delivery.
            Vector3 Local(Frame x, Vector3 p) => Quaternion.Inverse(x.RootRotation) * (p - x.Root) / x.Scale;
            var landmark = Math.Max(Vector3.Distance(Local(drawn.Idle, drawn.Idle.Hips), Local(f[0], f[0].Hips)),
                Math.Max(Vector3.Distance(Local(drawn.Idle, drawn.Idle.FootL), Local(f[0], f[0].FootL)),
                    Vector3.Distance(Local(drawn.Idle, drawn.Idle.FootR), Local(f[0], f[0].FootR))));
            sb.Append(",\"handOver\":{\"worstBoneJumpDeg\":").Append(Num(boneJump))
              .Append(",\"worstBone\":\"").Append(jumpBone).Append("\"")
              .Append(",\"idleYawDeg\":").Append(Num(drawn.Idle.RootYaw)).Append(",\"startYawDeg\":").Append(Num(f[0].RootYaw))
              .Append(",\"worstLandmarkJumpCm\":").Append(Num(landmark * 100)).Append("}");
            Gate(failures, name, "idle to delivery frame 0, worst bone (deg) <= 5", boneJump, 5.0);
            Gate(failures, name, "idle to delivery frame 0, worst hips or foot landmark in the rig's frame (cm) <= 3", landmark * 100, 3.0);

            // ---- Release time: the frame the world reports the release is the plan's release frame ----------------
            var expected = (int)Math.Round(drawn.Approach / Dt);
            sb.Append(",\"releaseTimeErrorMs\":").Append(Num((r - expected) * Dt * 1000.0)).Append("}");
            if (r != expected) failures.Add(name + ": the release landed on frame " + r + ", expected " + expected);
            return sb.ToString();
        }

        private static void Band(double speed, out double lo, out double hi)
        {
            var pts = new[,] { { 1.5, 100.0, 125.0 }, { 3.3, 150.0, 175.0 }, { 5.75, 165.0, 190.0 } };
            if (speed <= pts[0, 0]) { lo = pts[0, 1]; hi = pts[0, 2]; return; }
            for (var i = 0; i < 2; i++)
                if (speed <= pts[i + 1, 0])
                {
                    var u = (speed - pts[i, 0]) / (pts[i + 1, 0] - pts[i, 0]);
                    lo = pts[i, 1] + u * (pts[i + 1, 1] - pts[i, 1]);
                    hi = pts[i, 2] + u * (pts[i + 1, 2] - pts[i, 2]);
                    return;
                }
            lo = pts[2, 1];
            hi = pts[2, 2] + 20.0;
        }

        private static double Cap(ProductionCharacterJoint joint)
        {
            switch (joint)
            {
                case ProductionCharacterJoint.UpperArmLeft: case ProductionCharacterJoint.UpperArmRight:
                case ProductionCharacterJoint.ForearmLeft: case ProductionCharacterJoint.ForearmRight:
                case ProductionCharacterJoint.HandLeft: case ProductionCharacterJoint.HandRight:
                    return 1800.0;
                case ProductionCharacterJoint.Hips: case ProductionCharacterJoint.Spine: case ProductionCharacterJoint.Chest:
                    return 600.0;
                case ProductionCharacterJoint.Neck: case ProductionCharacterJoint.Head:
                    return 720.0;
                default:
                    return 1200.0;
            }
        }

        private static bool IsLeg(ProductionCharacterJoint joint) =>
            joint == ProductionCharacterJoint.ThighLeft || joint == ProductionCharacterJoint.ShinLeft ||
            joint == ProductionCharacterJoint.FootLeft || joint == ProductionCharacterJoint.ThighRight ||
            joint == ProductionCharacterJoint.ShinRight || joint == ProductionCharacterJoint.FootRight;

        private static double Horizontal(Vector3 v) => Math.Sqrt(v.x * v.x + v.z * v.z);

        private static void Gate(List<string> failures, string name, string rule, double value, double limit)
        {
            if (!(value <= limit)) failures.Add(name + ": " + rule + ", observed " + Num(value));
        }

        private static void GateMin(List<string> failures, string name, string rule, double value, double limit)
        {
            if (!(value >= limit)) failures.Add(name + ": " + rule + ", observed " + Num(value));
        }

        private static string Num(double value) =>
            double.IsNaN(value) || double.IsInfinity(value) ? "null" : value.ToString("0.####", CultureInfo.InvariantCulture);

        private static string Quote(string value) => "\"" + value + "\"";

        private sealed class NullSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
