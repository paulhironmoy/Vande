using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Director;
using Vande.Practice.Presentation.Production.Director.Stage;
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// UNITY-E2: builder evidence for the face-and-life Director on the Unity world (no player, no device, nothing here is a human
    /// result). Every method plays golden deliveries (tests/fixtures/unity-practice/practice-v3.json) through the production world at 60 Hz in
    /// a fresh world, with the Director on and (for the comparisons) off, and writes its tables to VANDE_EVIDENCE_OUT.
    /// Env: VANDE_DIR_CASES (regex on the case id), VANDE_DIR_HANDS (right,left), VANDE_DIR_ACCEPT (frames after the commitment the result is accepted at).
    /// </summary>
    public static partial class VandeHumansEvidence
    {
        private const double DirStep = 1.0 / 60.0;

        private static string DirOut()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("VANDE_EVIDENCE_OUT is required.");
            Directory.CreateDirectory(output);
            return output;
        }

        private static string DirFmt(double value) => double.IsNaN(value) || double.IsInfinity(value)
            ? "null"
            : value.ToString("0.#####", CultureInfo.InvariantCulture);

        private static IEnumerable<GoldenCase> DirCases()
        {
            var pattern = Environment.GetEnvironmentVariable("VANDE_DIR_CASES");
            var regex = string.IsNullOrEmpty(pattern) ? null : new System.Text.RegularExpressions.Regex(pattern);
            return LoadFixture().cases.Where(item => regex == null || regex.IsMatch(item.id));
        }

        private static string[] DirHands()
        {
            var text = Environment.GetEnvironmentVariable("VANDE_DIR_HANDS");
            return string.IsNullOrEmpty(text) ? new[] { "right", "left" } : text.Split(',');
        }

        private static ProceduralPracticeWorld OpenDirectorWorld(GoldenCase item, string hand, bool director, bool reduced,
            out GameObject root, out PracticeDeliveryPresentation delivery, out PracticePresentationSettings settings)
        {
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            scene.Handedness = hand;
            root = new GameObject("VANDE director probe");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.DirectorEnabled = director;
            settings = new PracticePresentationSettings
            {
                Assistance = "play", Handedness = hand, Locale = "en-IN", Quality = PracticePresentationQuality.Standard, ReducedMotion = reduced
            };
            world.Configure(settings, new NullSink());
            world.ConfigureScene(scene);
            return world;
        }

        /// <summary>A world with a Director on or off, a delivery's golden packets decoded.</summary>
        private sealed class DirWorld : IDisposable
        {
            public GameObject Root;
            public ProceduralPracticeWorld World;
            public PracticeDeliveryPresentation Delivery;
            public PracticeResultPresentation Result;
            public PracticePresentationSettings Settings;
            public ProductionCharacterRig Striker;
            public ProductionCharacterRig Bowler;

            public DirWorld(GoldenCase item, string hand, bool director, bool reduced)
            {
                World = OpenDirectorWorld(item, hand, director, reduced, out Root, out Delivery, out Settings);
                Result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
                var humans = World.PresentedHumansForEvidence();
                Striker = humans.First(pair => pair.Key == "striker").Value;
                Bowler = humans.First(pair => pair.Key == "bowler").Value;
            }

            public void Dispose()
            {
                if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
            }
        }

        /// <summary>One frame of the Director as the world drew it.</summary>
        private sealed class DirFrame
        {
            public int Index;
            public string State;
            public double Timeline;
            public double SceneMs;
            public string Kind;
            public double TickUs;
            public bool[] On = new bool[2];
            public double[] W = new double[2];
            public float[][] Ch = { new float[DirectorChannels.Count], new float[DirectorChannels.Count] };
            public bool[] LifeActive = new bool[2];
            public double[] HeadYaw = new double[2];
            public double[] HeadPitch = new double[2];
            public double[] HeadRoll = new double[2];
            public double[] DYaw = new double[2];
            public double[] DPitch = new double[2];
            public double[] DRoll = new double[2];
            public bool[] Clamped = new bool[2];
            public bool[] Limited = new bool[2];
            public bool[] Holding = new bool[2];
            /// <summary>How many poses (and hero synchronizations) each rig applied in the frame's Tick.</summary>
            public int[] Poses = new int[2];
            /// <summary>The life each rig was given for the frame (breath deg, sway X mm, sway Z mm, roll deg, posture deg, twist deg): the plan's channels times the fade plus the seam.</summary>
            public float[][] Life = { new float[6], new float[6] };
            /// <summary>The pose of each rig: the 17 semantic joints (position, rotation), the bat and the root, flat.</summary>
            public float[][] Pose = new float[2][];
            /// <summary>The head as drawn after the pass (physics role frame, degrees) and the plan's head in space.</summary>
            public double[] AfterYaw = new double[2];
            public double[] AfterPitch = new double[2];
            public double[] AfterRoll = new double[2];
            public double ReleaseMs = double.NaN;
            public double GatherMs = double.NaN;
            public double StrokeEndMs = double.NaN;
            public double FollowEndMs = double.NaN;
            public double BeginUs, EndUs, WorkUs;
            public StrikerFrame Striker;
            public double BowlerAimYaw = double.NaN;
            public double BowlerAimPitch = double.NaN;
        }

        private static readonly ProductionCharacterJoint[] DirJoints =
            (ProductionCharacterJoint[])Enum.GetValues(typeof(ProductionCharacterJoint)).Cast<ProductionCharacterJoint>()
                .Where(j => j != ProductionCharacterJoint.Count).ToArray();

        private static float[] DirPose(ProductionCharacterRig rig)
        {
            var values = new List<float>(DirJoints.Length * 7 + 10);
            foreach (var joint in DirJoints)
            {
                var p = rig.VisibleJointWorldPosition(joint);
                var q = rig.VisibleJointWorldRotation(joint);
                values.Add(p.x); values.Add(p.y); values.Add(p.z);
                values.Add(q.x); values.Add(q.y); values.Add(q.z); values.Add(q.w);
            }
            var bat = rig.Bat;
            if (bat != null)
            {
                values.Add(bat.position.x); values.Add(bat.position.y); values.Add(bat.position.z);
                values.Add(bat.rotation.x); values.Add(bat.rotation.y); values.Add(bat.rotation.z); values.Add(bat.rotation.w);
            }
            var root = rig.Root.position;
            values.Add(root.x); values.Add(root.y); values.Add(root.z);
            return values.ToArray();
        }

        private static void DirRecord(DirWorld w, DirFrame f, int index, double tickUs)
        {
            f.Index = index;
            f.State = w.World.StateForEvidence;
            f.Timeline = w.World.TimelineForEvidence;
            f.TickUs = tickUs;
            f.SceneMs = w.World.DirectorSceneMsForEvidence;
            var script = w.World.DirectorScriptForEvidence;
            f.Kind = script == null ? "none" : script.ScriptKind.ToString();
            for (var r = 0; r < 2; r++)
            {
                var role = (DirectorRole)r;
                var frame = w.World.DirectedFrameForEvidence(role);
                f.On[r] = frame.On;
                f.W[r] = frame.W;
                if (frame.Ch != null) Array.Copy(frame.Ch, f.Ch[r], DirectorChannels.Count);
                var lifeNow = w.World.DirectedLifeForEvidence(role);
                f.LifeActive[r] = lifeNow.Active;
                f.Life[r][0] = lifeNow.BreathDeg; f.Life[r][1] = lifeNow.SwayXMetres * 1000f; f.Life[r][2] = lifeNow.SwayZMetres * 1000f;
                f.Life[r][3] = lifeNow.SwayRollDeg; f.Life[r][4] = lifeNow.PostureDeg; f.Life[r][5] = lifeNow.TwistDeg;
                var pass = w.World.DirectedHeadPassForEvidence(role);
                if (pass != null)
                {
                    f.HeadYaw[r] = pass.Yaw; f.HeadPitch[r] = pass.Pitch; f.HeadRoll[r] = pass.Roll;
                    f.DYaw[r] = pass.DYaw; f.DPitch[r] = pass.DPitch; f.DRoll[r] = pass.DRoll;
                    f.Clamped[r] = pass.Clamped; f.Limited[r] = pass.Limited; f.Holding[r] = pass.Holding;
                }
            }
            f.Pose[0] = DirPose(w.Bowler);
            f.Pose[1] = DirPose(w.Striker);
            var mirror = ProceduralPracticeWorld.WorldReflectionFor(w.Settings.Handedness);
            for (var r = 0; r < 2; r++)
            {
                var pass = w.World.DirectedHeadPassForEvidence((DirectorRole)r);
                if (pass == null) continue;
                double y, p, rl;
                pass.Measure(mirror, out y, out p, out rl);
                f.AfterYaw[r] = y; f.AfterPitch[r] = p; f.AfterRoll[r] = rl;
            }
            if (script != null && script.ScriptKind != StageKind.Idle)
            {
                var spec = script.ScriptSpec;
                f.ReleaseMs = spec.Bowler.Release ?? double.NaN;
                f.GatherMs = spec.Bowler.Gather ?? double.NaN;
                f.StrokeEndMs = spec.Striker.StrokeEnd ?? double.NaN;
                f.FollowEndMs = spec.Bowler.FollowEnd ?? double.NaN;
                // the direction from the bowler's eye to the striker's, as the plan is asked (physics role frame)
                var geometry = script.Geometry;
                if (geometry != null)
                {
                    var from = geometry.BowlerEye(f.SceneMs);
                    var to = geometry.StrikerEye();
                    var fwd = to.Z - from.Z;
                    var left = to.X - from.X;
                    f.BowlerAimYaw = Math.Atan2(left, fwd) * 180.0 / Math.PI;
                    f.BowlerAimPitch = Math.Atan2(from.Y - to.Y, Math.Sqrt(fwd * fwd + left * left)) * 180.0 / Math.PI;
                }
            }
            f.BeginUs = w.World.DirectorLastBeginMicroseconds;
            f.EndUs = w.World.DirectorLastEndMicroseconds;
            f.WorkUs = w.World.DirectorLastWorkMicroseconds;
            f.Striker = CaptureStriker(w.Striker, f.Timeline);
        }

        private static string DirCsvHeader()
        {
            var sb = new StringBuilder("frame,state,timeline,sceneMs,kind,tickUs");
            foreach (var role in new[] { "bowler", "striker" })
            {
                foreach (var c in new[] { "on", "w", "lifeOn", "breath", "swayX", "swayZ", "swayRoll", "posture", "twist", "exertion", "headYaw", "headPitch", "headRoll", "gazeYaw", "gazePitch",
                             "drawnYaw", "drawnPitch", "drawnRoll", "dYaw", "dPitch", "dRoll", "clamped", "limited", "afterYaw", "afterPitch", "afterRoll", "neckSpeed", "headSpeed", "holding", "lifeBreath", "lifeSwayX", "lifeSwayZ", "lifeRoll", "lifePosture", "lifeTwist" })
                    sb.Append(',').Append(role).Append('.').Append(c);
            }
            return sb.ToString();
        }

        private static string DirCsvRow(DirFrame f, DirFrame previous = null)
        {
            var sb = new StringBuilder();
            sb.Append(f.Index).Append(',').Append(f.State).Append(',').Append(DirFmt(f.Timeline)).Append(',').Append(DirFmt(f.SceneMs)).Append(',').Append(f.Kind).Append(',').Append(DirFmt(f.TickUs));
            for (var r = 0; r < 2; r++)
            {
                var c = f.Ch[r];
                sb.Append(',').Append(f.On[r] ? 1 : 0).Append(',').Append(DirFmt(f.W[r])).Append(',').Append(f.LifeActive[r] ? 1 : 0)
                    .Append(',').Append(DirFmt(c[DirectorChannels.Breath])).Append(',').Append(DirFmt(c[DirectorChannels.SwayX])).Append(',').Append(DirFmt(c[DirectorChannels.SwayZ]))
                    .Append(',').Append(DirFmt(c[DirectorChannels.SwayRoll])).Append(',').Append(DirFmt(c[DirectorChannels.Posture])).Append(',').Append(DirFmt(c[DirectorChannels.Twist]))
                    .Append(',').Append(DirFmt(c[DirectorChannels.Exertion])).Append(',').Append(DirFmt(c[DirectorChannels.HeadYaw])).Append(',').Append(DirFmt(c[DirectorChannels.HeadPitch]))
                    .Append(',').Append(DirFmt(c[DirectorChannels.HeadRoll])).Append(',').Append(DirFmt(c[DirectorChannels.GazeYaw])).Append(',').Append(DirFmt(c[DirectorChannels.GazePitch]))
                    .Append(',').Append(DirFmt(f.HeadYaw[r])).Append(',').Append(DirFmt(f.HeadPitch[r])).Append(',').Append(DirFmt(f.HeadRoll[r]))
                    .Append(',').Append(DirFmt(f.DYaw[r])).Append(',').Append(DirFmt(f.DPitch[r])).Append(',').Append(DirFmt(f.DRoll[r]))
                    .Append(',').Append(f.Clamped[r] ? 1 : 0).Append(',').Append(f.Limited[r] ? 1 : 0)
                    .Append(',').Append(DirFmt(f.AfterYaw[r])).Append(',').Append(DirFmt(f.AfterPitch[r])).Append(',').Append(DirFmt(f.AfterRoll[r]));
                if (previous != null)
                {
                    sb.Append(',').Append(DirFmt(Quaternion.Angle(DirLocal(previous.Pose[r], ProductionCharacterJoint.Neck), DirLocal(f.Pose[r], ProductionCharacterJoint.Neck)) / DirStep))
                        .Append(',').Append(DirFmt(Quaternion.Angle(DirLocal(previous.Pose[r], ProductionCharacterJoint.Head), DirLocal(f.Pose[r], ProductionCharacterJoint.Head)) / DirStep));
                }
                else sb.Append(",0,0");
                sb.Append(',').Append(f.Holding[r] ? 1 : 0);
                for (var i = 0; i < 6; i++) sb.Append(',').Append(DirFmt(f.Life[r][i]));
            }
            return sb.ToString();
        }

        /// <summary>
        /// A whole ball as the production world plays it: `idleFrames` of the scene between balls, then the delivery (the press at the swing
        /// start, the commitment `commitDelay` later, the result `acceptFrames` frames after that, or never), then `tailFrames` after the accept
        /// (or to the end of the ball), then `afterFrames` of the scene between balls again. The frames are returned in order.
        /// </summary>
        private static List<DirFrame> DirPlayBall(DirWorld w, int idleFrames, double commitDelay, int acceptFrames, bool accept, int tailFrames, int afterFrames,
            bool replayAfter = false, int replayFrames = 0, Action<int> afterFrame = null)
        {
            var frames = new List<DirFrame>();
            Action tick = () =>
            {
                var serialBowler = w.Bowler.PoseSerial;
                var serialStriker = w.Striker.PoseSerial;
                var t0 = Stopwatch.GetTimestamp();
                w.World.Tick(DirStep);
                var us = (Stopwatch.GetTimestamp() - t0) * 1e6 / Stopwatch.Frequency;
                var f = new DirFrame();
                DirRecord(w, f, frames.Count, us);
                f.Poses[0] = w.Bowler.PoseSerial - serialBowler;
                f.Poses[1] = w.Striker.PoseSerial - serialStriker;
                frames.Add(f);
                if (afterFrame != null) afterFrame(frames.Count - 1);
            };
            for (var k = 0; k < idleFrames; k++) tick();
            w.World.BeginDelivery(w.Delivery);
            var swingStart = w.Result.SwingStartT ?? 0.15;
            // run to the swing start
            while (w.World.TimelineForEvidence < swingStart - 1e-9) tick();
            var committed = false;
            var accepted = false;
            var countdown = acceptFrames;
            var commitAt = swingStart + commitDelay;
            var acceptedAt = -1;
            var guard = 0;
            if (w.Result.ShotIntent != "leave") w.World.BeginLocalPreparation();
            while (guard++ < 1200)
            {
                if (!committed && w.Result.ShotIntent != "leave" && w.World.TimelineForEvidence >= commitAt - 1e-9)
                {
                    w.World.ApplyProvisionalSwing(new PracticeSwingPresentation
                    {
                        Kind = "attack",
                        StartT = swingStart,
                        DirectionDeg = w.Result.SwingDirectionDeg,
                        Power = 0.7,
                        Elevation = 0.1,
                        Footwork = string.IsNullOrEmpty(w.Result.Footwork) ? "auto" : w.Result.Footwork
                    });
                    committed = true;
                }
                if (accept && !accepted && (committed || w.Result.ShotIntent == "leave" || w.World.TimelineForEvidence >= commitAt - 1e-9))
                {
                    if (countdown <= 0)
                    {
                        w.World.AcceptResult(w.Result);
                        accepted = true;
                        acceptedAt = frames.Count;
                    }
                    else countdown--;
                }
                tick();
                if (accepted && frames.Count > acceptedAt + tailFrames) break;
                if (!accept && frames.Count > idleFrames + 600) break;
            }
            for (var k = 0; k < afterFrames; k++) tick();
            AcceptIndexOfLastRun = acceptedAt;
            return frames;
        }

        private static int AcceptIndexOfLastRun = -1;

        /// <summary>
        /// Smoke and traces: plays one ball per (case, hand) with the Director on, writes director-smoke-{case}-{hand}.csv (per frame: the plan's
        /// channels, the head pass's measures, the cost of the Tick) and a summary line.
        /// </summary>
        public static void DirectorSmoke()
        {
            var output = DirOut();
            var summary = new StringBuilder();
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                {
                    using (var w = new DirWorld(item, hand, true, false))
                    {
                        List<DirFrame> frames;
                        string error = null;
                        try
                        {
                            frames = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                        }
                        catch (Exception exception)
                        {
                            error = exception.GetType().Name + ": " + exception.Message + "\n" + exception.StackTrace;
                            frames = new List<DirFrame>();
                        }
                        var csv = new StringBuilder(DirCsvHeader()).Append('\n');
                        for (var i = 0; i < frames.Count; i++) csv.Append(DirCsvRow(frames[i], i > 0 ? frames[i - 1] : null)).Append('\n');
                        File.WriteAllText(Path.Combine(output, "director-smoke-" + item.id + "-" + hand + ".csv"), csv.ToString());
                        var ticks = frames.Select(f => f.TickUs).OrderBy(x => x).ToList();
                        summary.Append(item.id).Append(' ').Append(hand).Append(" frames=").Append(frames.Count)
                            .Append(" accept@").Append(AcceptIndexOfLastRun)
                            .Append(" failure=").Append(w.World.DirectorFailureForEvidence ?? "none")
                            .Append(" tickUs p50=").Append(ticks.Count > 0 ? DirFmt(ticks[ticks.Count / 2]) : "-")
                            .Append(" p95=").Append(ticks.Count > 0 ? DirFmt(ticks[(int)(ticks.Count * 0.95)]) : "-")
                            .Append(" max=").Append(ticks.Count > 0 ? DirFmt(ticks[ticks.Count - 1]) : "-");
                        if (error != null) summary.Append("\nERROR ").Append(error);
                        summary.Append('\n');
                    }
                }
            File.WriteAllText(Path.Combine(output, "director-smoke.txt"), summary.ToString());
            UnityEngine.Debug.Log("DirectorSmoke\n" + summary);
        }

        // ---------------------------------------------------------------------------------------------------------------
        // The gates: the Director on against the Director off, in the same world, frame for frame
        // ---------------------------------------------------------------------------------------------------------------

        private static bool DirInBowlerQuiet(DirFrame f)
        {
            if (f.Kind != "Live" && f.Kind != "Result" && f.Kind != "Replay") return false;
            return f.SceneMs >= 0 && f.SceneMs <= f.ReleaseMs + 150;
        }

        private static bool DirInStrikerQuiet(DirFrame f)
        {
            if (f.Kind != "Live" && f.Kind != "Result" && f.Kind != "Replay") return false;
            var end = double.IsNaN(f.StrokeEndMs) ? double.PositiveInfinity : f.StrokeEndMs + 800;
            return f.SceneMs >= f.ReleaseMs - 600 && f.SceneMs <= end;
        }

        private sealed class DirDiff
        {
            public int Frames;
            public int Mismatching;
            public double Worst;
            public string Where = "";
        }

        /// <summary>
        /// Compares the pose of one rig in two runs frame by frame over the frames `include` selects: exact equality of every float of the 17
        /// joints (position, rotation), the bat and the root, except the neck and the head (the only bones the head pass turns).
        /// </summary>
        private static DirDiff DirCompare(List<DirFrame> a, List<DirFrame> b, int rig, Func<DirFrame, bool> include, bool excludeNeckHead = true)
        {
            var diff = new DirDiff();
            var n = Math.Min(a.Count, b.Count);
            for (var i = 0; i < n; i++)
            {
                if (!include(b[i])) continue;
                diff.Frames++;
                var pa = a[i].Pose[rig];
                var pb = b[i].Pose[rig];
                var bad = false;
                for (var k = 0; k < Math.Min(pa.Length, pb.Length); k++)
                {
                    var joint = k / 7;
                    if (excludeNeckHead && k < DirJoints.Length * 7 && (joint == (int)ProductionCharacterJoint.Neck || joint == (int)ProductionCharacterJoint.Head)) continue;
                    if (pa[k] == pb[k]) continue;
                    var d = Math.Abs((double)pa[k] - pb[k]);
                    if (d > diff.Worst)
                    {
                        diff.Worst = d;
                        diff.Where = "frame " + i + " float " + k + " (" + (k < DirJoints.Length * 7 ? DirJoints[joint].ToString() : k < DirJoints.Length * 7 + 7 ? "bat" : "root") + ")";
                    }
                    bad = true;
                }
                if (bad) diff.Mismatching++;
            }
            return diff;
        }

        private sealed class DirResidual
        {
            public int Frames;
            public int Differing;
            public double PosMm;
            public double RotDeg;
            public string Where = "";
        }

        /// <summary>The residual between two runs over the frames selected, for the joints of one class: the exact count of frames that differ, the largest position (mm) and rotation (deg) difference.</summary>
        private static DirResidual DirClass(List<DirFrame> a, List<DirFrame> b, int rig, Func<DirFrame, bool> include, Func<ProductionCharacterJoint, bool> joints, bool includeBatAndRoot)
        {
            var res = new DirResidual();
            var n = Math.Min(a.Count, b.Count);
            for (var i = 0; i < n; i++)
            {
                if (!include(b[i])) continue;
                res.Frames++;
                var pa = a[i].Pose[rig];
                var pb = b[i].Pose[rig];
                var differs = false;
                for (var j = 0; j < DirJoints.Length; j++)
                {
                    if (!joints(DirJoints[j])) continue;
                    var exact = true;
                    for (var k = 0; k < 7; k++) if (pa[j * 7 + k] != pb[j * 7 + k]) exact = false;
                    if (exact) continue;
                    differs = true;
                    var pd = Math.Sqrt(Math.Pow(pa[j * 7] - pb[j * 7], 2) + Math.Pow(pa[j * 7 + 1] - pb[j * 7 + 1], 2) + Math.Pow(pa[j * 7 + 2] - pb[j * 7 + 2], 2)) * 1000.0;
                    var rd = Quaternion.Angle(DirRot(pa, j), DirRot(pb, j));
                    if (pd > res.PosMm) { res.PosMm = pd; res.Where = DirJoints[j] + "@frame " + i + " pos"; }
                    if (rd > res.RotDeg) { res.RotDeg = rd; if (rd > 0.5) res.Where += " " + DirJoints[j] + "@frame " + i + " rot"; }
                }
                if (includeBatAndRoot)
                    for (var k = DirJoints.Length * 7; k < Math.Min(pa.Length, pb.Length); k++)
                        if (pa[k] != pb[k]) { differs = true; res.PosMm = Math.Max(res.PosMm, Math.Abs(pa[k] - pb[k]) * 1000.0); }
                if (differs) res.Differing++;
            }
            return res;
        }

        private static bool DirIsTorsoOrLeg(ProductionCharacterJoint j) =>
            j == ProductionCharacterJoint.Hips || j == ProductionCharacterJoint.Spine || j == ProductionCharacterJoint.Chest || (int)j >= (int)ProductionCharacterJoint.ThighLeft;

        private static bool DirIsArm(ProductionCharacterJoint j) =>
            j == ProductionCharacterJoint.UpperArmLeft || j == ProductionCharacterJoint.ForearmLeft || j == ProductionCharacterJoint.UpperArmRight || j == ProductionCharacterJoint.ForearmRight;

        private static bool DirIsHand(ProductionCharacterJoint j) => j == ProductionCharacterJoint.HandLeft || j == ProductionCharacterJoint.HandRight;

        /// <summary>The largest angular speed of any joint against its section 9 cap, over the frames selected: (ratio, joint, frame).</summary>
        private static double DirWorstCapRatio(List<DirFrame> frames, int rig, Func<DirFrame, bool> include, out string where)
        {
            var worst = 0.0;
            where = "";
            for (var i = 1; i < frames.Count; i++)
            {
                if (!include(frames[i]) || !include(frames[i - 1])) continue;
                foreach (var joint in PopJoints)
                {
                    var j = (int)joint;
                    var speed = Quaternion.Angle(DirRot(frames[i - 1].Pose[rig], j), DirRot(frames[i].Pose[rig], j)) / DirStep;
                    var ratio = speed / AngularCap(joint);
                    if (ratio > worst) { worst = ratio; where = joint + "@frame " + i + " " + DirFmt(speed) + " deg/s"; }
                }
            }
            return worst;
        }

        private static Quaternion DirRot(float[] pose, int joint)
        {
            var k = joint * 7 + 3;
            return new Quaternion(pose[k], pose[k + 1], pose[k + 2], pose[k + 3]);
        }

        /// <summary>The local rotation of a bone against its parent (neck against chest, head against neck), from a frame's pose.</summary>
        private static Quaternion DirLocal(float[] pose, ProductionCharacterJoint joint)
        {
            return joint == ProductionCharacterJoint.Neck
                ? Quaternion.Inverse(DirRot(pose, (int)ProductionCharacterJoint.Chest)) * DirRot(pose, (int)ProductionCharacterJoint.Neck)
                : Quaternion.Inverse(DirRot(pose, (int)ProductionCharacterJoint.Neck)) * DirRot(pose, (int)ProductionCharacterJoint.Head);
        }

        /// <summary>The largest speed (deg/s) and the largest change of speed from one frame to the next (deg/s) of a bone over the frames selected.</summary>
        private static void DirCaps(List<DirFrame> frames, int rig, ProductionCharacterJoint joint, Func<DirFrame, bool> include, out double maxSpeed, out double maxChange, out string where)
        {
            maxSpeed = 0;
            maxChange = 0;
            where = "";
            double previous = double.NaN;
            for (var i = 1; i < frames.Count; i++)
            {
                if (!include(frames[i]) || !include(frames[i - 1])) { previous = double.NaN; continue; }
                var speed = Quaternion.Angle(DirLocal(frames[i - 1].Pose[rig], joint), DirLocal(frames[i].Pose[rig], joint)) / DirStep;
                if (speed > maxSpeed) { maxSpeed = speed; where = "frame " + i; }
                if (!double.IsNaN(previous)) maxChange = Math.Max(maxChange, Math.Abs(speed - previous));
                previous = speed;
            }
        }

        private static string DirQ(List<double> xs, double q)
        {
            if (xs.Count == 0) return "-";
            var a = xs.OrderBy(x => x).ToList();
            return DirFmt(a[Math.Min(a.Count - 1, (int)(q * a.Count))]);
        }

        /// <summary>The angle between two directions given as role-frame yaw and pitch (degrees).</summary>
        private static double DirAngleBetween(double yawA, double pitchA, double yawB, double pitchB)
        {
            Func<double, double, double[]> v = (y, p) =>
            {
                var yy = y * Math.PI / 180.0;
                var pp = p * Math.PI / 180.0;
                return new[] { Math.Cos(pp) * Math.Sin(yy), -Math.Sin(pp), Math.Cos(pp) * Math.Cos(yy) };
            };
            var a = v(yawA, pitchA);
            var b = v(yawB, pitchB);
            var dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            return Math.Acos(Math.Max(-1, Math.Min(1, dot))) * 180.0 / Math.PI;
        }

        /// <summary>
        /// Diagnostic: the Director on (VANDE_DIR_REDUCED=1: in Reduced Motion, so that no life is applied and only the head pass acts) against
        /// the Director off, frame by frame: which bone of which rig differs first and by how much. Writes director-diff-{case}-{hand}.csv.
        /// </summary>
        public static void DirectorDiff()
        {
            var output = DirOut();
            var reduced = Environment.GetEnvironmentVariable("VANDE_DIR_REDUCED") == "1";
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                {
                    List<DirFrame> off, on;
                    using (var w = new DirWorld(item, hand, false, false)) off = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                    using (var w = new DirWorld(item, hand, true, reduced)) on = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                    var csv = new StringBuilder("frame,state,kind,sceneMs,rig,joint,posMm,rotDeg,floatsDiffering\n");
                    for (var i = 0; i < Math.Min(off.Count, on.Count); i++)
                        for (var r = 0; r < 2; r++)
                        {
                            var a = off[i].Pose[r];
                            var b = on[i].Pose[r];
                            var any = false;
                            var differing = 0;
                            for (var j = 0; j < DirJoints.Length; j++)
                            {
                                if (j == (int)ProductionCharacterJoint.Neck || j == (int)ProductionCharacterJoint.Head) continue;
                                var pd = Math.Sqrt(Math.Pow(a[j * 7] - b[j * 7], 2) + Math.Pow(a[j * 7 + 1] - b[j * 7 + 1], 2) + Math.Pow(a[j * 7 + 2] - b[j * 7 + 2], 2)) * 1000.0;
                                var rd = Quaternion.Angle(DirRot(a, j), DirRot(b, j));
                                var n = 0;
                                for (var k = 0; k < 7; k++) if (a[j * 7 + k] != b[j * 7 + k]) n++;
                                differing += n;
                                if (n == 0) continue;
                                any = true;
                                csv.Append(i).Append(',').Append(on[i].State).Append(',').Append(on[i].Kind).Append(',').Append(DirFmt(on[i].SceneMs)).Append(',').Append(r == 0 ? "bowler" : "striker")
                                    .Append(',').Append(DirJoints[j]).Append(',').Append(DirFmt(pd)).Append(',').Append(DirFmt(rd)).Append(',').Append(n).Append('\n');
                            }
                            if (!any && a.Length > DirJoints.Length * 7)
                            {
                                var batDiff = 0;
                                for (var k = DirJoints.Length * 7; k < a.Length; k++) if (a[k] != b[k]) batDiff++;
                                if (batDiff > 0) csv.Append(i).Append(',').Append(on[i].State).Append(',').Append(on[i].Kind).Append(',').Append(DirFmt(on[i].SceneMs)).Append(',').Append(r == 0 ? "bowler" : "striker").Append(",batOrRoot,0,0,").Append(batDiff).Append('\n');
                            }
                        }
                    File.WriteAllText(Path.Combine(output, "director-diff-" + item.id + "-" + hand + (reduced ? "-rm" : "") + ".csv"), csv.ToString());
                }
        }

        /// <summary>
        /// The builder gates of the Director on the Unity world: per (case, hand) one ball is played four times in fresh worlds (the Director
        /// off twice as the control, on, on in Reduced Motion). Writes director-gates.txt and director-gates.json.
        /// </summary>
        public static void DirectorGates()
        {
            var output = DirOut();
            var report = new StringBuilder();
            var rows = new List<string>();
            var started = DateTime.UtcNow;
            report.Append("UNITY-E2 Director gates (builder measurements; a fresh world per run; 60 Hz; the ball: 180 idle frames, the press at the swing start, the commitment 50 ms later, the result 3 frames after it, 420 frames after, 180 idle)\n");
            report.Append("case hand | control(off vs off) bodyFrames/mismatch | quiet bowler frames/mismatch | quiet striker frames/mismatch | outside-window frames that differ (the Director acts) | gloveOff max mm off/on | neck speed off/on | head speed off/on | neck dSpeed off/on | head dSpeed off/on | RM life frames / non-head mismatches | failures\n");
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                {
                    List<DirFrame> off1, off2, on, rm;
                    string failure;
                    using (var w = new DirWorld(item, hand, false, false)) off1 = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                    using (var w = new DirWorld(item, hand, false, false)) off2 = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                    using (var w = new DirWorld(item, hand, true, false))
                    {
                        on = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                        failure = w.World.DirectorFailureForEvidence ?? "none";
                    }
                    using (var w = new DirWorld(item, hand, true, true)) rm = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                    // the head pass alone (no bone caps, no world guard): what the pass itself asks of the neck and head (the web's F3 gate: no step over 40 degrees)
                    List<DirFrame> alone;
                    using (var w = new DirWorld(item, hand, true, false))
                    {
                        w.World.DirectorHeadLimiterEnabled = false;
                        alone = DirPlayBall(w, 180, 0.05, 3, true, 420, 180);
                    }

                    // the control: the off runs are bit-identical (the world is deterministic), every bone
                    var c0 = DirCompare(off1, off2, 0, f => true, false);
                    var c1 = DirCompare(off1, off2, 1, f => true, false);
                    // the quiet windows: every bone but the neck and the head, bit for bit
                    var qb = DirCompare(off1, on, 0, DirInBowlerQuiet);
                    var qs = DirCompare(off1, on, 1, DirInStrikerQuiet);
                    // outside the windows the Director acts (the bodies breathe): how many frames differ
                    var ob = DirCompare(off1, on, 0, f => !DirInBowlerQuiet(f));
                    var os = DirCompare(off1, on, 1, f => !DirInStrikerQuiet(f));
                    // Reduced Motion: zero life displacement in every frame (every bone but the neck and the head is the Director-off pose)
                    var rb = DirCompare(off1, rm, 0, f => true);
                    var rs = DirCompare(off1, rm, 1, f => true);
                    var rmLife = rm.Count(f => f.LifeActive[0] || f.LifeActive[1]);
                    // hands on the bat: the largest glove-to-grip gap while the delivery is live (mm)
                    Func<List<DirFrame>, double> gloves = frames => frames.Where(f => f.Kind != "Idle" && f.Kind != "none" && f.Striker != null && f.SceneMs >= f.ReleaseMs - 1500)
                        .Select(f => Math.Max(f.Striker.GloveOffLeft, f.Striker.GloveOffRight) * 1000.0).DefaultIfEmpty(0).Max();
                    // the section 9 caps of the neck and the head (local), over the whole ball
                    double nsOff, ncOff, hsOff, hcOff, nsOn, ncOn, hsOn, hcOn;
                    string w1, w2, w3, w4;
                    DirCaps(off1, 1, ProductionCharacterJoint.Neck, f => true, out nsOff, out ncOff, out w1);
                    DirCaps(off1, 1, ProductionCharacterJoint.Head, f => true, out hsOff, out hcOff, out w2);
                    DirCaps(on, 1, ProductionCharacterJoint.Neck, f => true, out nsOn, out ncOn, out w3);
                    DirCaps(on, 1, ProductionCharacterJoint.Head, f => true, out hsOn, out hcOn, out w4);
                    double bnsOff, bncOff, bhsOff, bhcOff, bnsOn, bncOn, bhsOn, bhcOn;
                    DirCaps(off1, 0, ProductionCharacterJoint.Neck, f => true, out bnsOff, out bncOff, out w1);
                    DirCaps(off1, 0, ProductionCharacterJoint.Head, f => true, out bhsOff, out bhcOff, out w2);
                    DirCaps(on, 0, ProductionCharacterJoint.Neck, f => true, out bnsOn, out bncOn, out w3);
                    DirCaps(on, 0, ProductionCharacterJoint.Head, f => true, out bhsOn, out bhcOn, out w4);
                    // the bowler's head against the batter from the gather to the release (the web gate: within 10 degrees)
                    var aimErr = on.Where(f => !double.IsNaN(f.GatherMs) && !double.IsNaN(f.BowlerAimYaw) && f.SceneMs >= f.GatherMs && f.SceneMs <= f.ReleaseMs && f.Kind == "Live")
                        .Select(f => DirAngleBetween(f.AfterYaw[0], f.AfterPitch[0], f.BowlerAimYaw, f.BowlerAimPitch)).ToList();
                    var ownBaseline = off1.Where(f => !double.IsNaN(f.GatherMs) && f.SceneMs >= f.GatherMs && f.SceneMs <= f.ReleaseMs && f.Kind == "None").Count();
                    // the quiet striker window by class of bone (the world's own arm solver keeps a memory of the pose before the window)
                    Func<DirFrame, bool> sq = DirInStrikerQuiet;
                    var rTorso = DirClass(off1, on, 1, sq, DirIsTorsoOrLeg, true);
                    var rArms = DirClass(off1, on, 1, sq, DirIsArm, false);
                    var rHands = DirClass(off1, on, 1, sq, DirIsHand, false);
                    string capWhereOff, capWhereOn, capWhereBOff, capWhereBOn;
                    var capOff = DirWorstCapRatio(off1, 1, f => true, out capWhereOff);
                    var capOn = DirWorstCapRatio(on, 1, f => true, out capWhereOn);
                    var capBOff = DirWorstCapRatio(off1, 0, f => true, out capWhereBOff);
                    var capBOn = DirWorstCapRatio(on, 0, f => true, out capWhereBOn);
                    // F3 (WEB-FIX-B): the largest step of the neck or head in a frame (degrees, local), with the caps and with the pass alone, and how far down the head looks after the release
                    Func<List<DirFrame>, int, double> maxStep = (frames, rig) =>
                    {
                        double m = 0;
                        for (var i = 1; i < frames.Count; i++)
                            foreach (var j in new[] { ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head })
                                m = Math.Max(m, Quaternion.Angle(DirLocal(frames[i - 1].Pose[rig], j), DirLocal(frames[i].Pose[rig], j)));
                        return m;
                    };
                    Func<List<DirFrame>, int, double> lowestLook = (frames, rig) =>
                        frames.Where(f => (f.Kind == "Live" || f.Kind == "Result" || f.Kind == "Replay") && f.SceneMs >= f.ReleaseMs + 1500).Select(f => f.AfterPitch[rig]).DefaultIfEmpty(-90).Max();
                    report.Append("  [").Append(item.id).Append(' ').Append(hand).Append("] F3 neck/head step per frame (deg): bowler caps ").Append(DirFmt(maxStep(on, 0))).Append(" / alone ").Append(DirFmt(maxStep(alone, 0)))
                        .Append(", striker caps ").Append(DirFmt(maxStep(on, 1))).Append(" / alone ").Append(DirFmt(maxStep(alone, 1))).Append("; lowest look from release+1.5 s (deg down) bowler ").Append(DirFmt(lowestLook(on, 0)))
                        .Append(" striker ").Append(DirFmt(lowestLook(on, 1))).Append(" (alone: ").Append(DirFmt(lowestLook(alone, 0))).Append(" / ").Append(DirFmt(lowestLook(alone, 1))).Append(")\n");
                    report.Append("  [").Append(item.id).Append(' ').Append(hand).Append("] striker quiet window by class (frames differing / frames): torso+legs+bat+root ").Append(rTorso.Differing).Append('/').Append(rTorso.Frames)
                        .Append(" (max ").Append(DirFmt(rTorso.PosMm)).Append(" mm, ").Append(DirFmt(rTorso.RotDeg)).Append(" deg); arms ").Append(rArms.Differing).Append('/').Append(rArms.Frames)
                        .Append(" (max ").Append(DirFmt(rArms.PosMm)).Append(" mm, ").Append(DirFmt(rArms.RotDeg)).Append(" deg ").Append(rArms.Where).Append("); hands ").Append(rHands.Differing).Append('/').Append(rHands.Frames)
                        .Append(" (max ").Append(DirFmt(rHands.PosMm)).Append(" mm, ").Append(DirFmt(rHands.RotDeg)).Append(" deg); worst joint speed against its section 9 cap, striker off/on ")
                        .Append(DirFmt(capOff)).Append('/').Append(DirFmt(capOn)).Append(" [").Append(capWhereOn).Append("], bowler off/on ").Append(DirFmt(capBOff)).Append('/').Append(DirFmt(capBOn)).Append(" [").Append(capWhereBOn).Append("]\n");
                    report.Append(item.id).Append(' ').Append(hand).Append(" | ")
                        .Append(c0.Frames).Append('/').Append(c0.Mismatching + c1.Mismatching).Append(" | ")
                        .Append(qb.Frames).Append('/').Append(qb.Mismatching).Append(qb.Mismatching > 0 ? " [" + qb.Where + " " + DirFmt(qb.Worst) + "]" : "").Append(" | ")
                        .Append(qs.Frames).Append('/').Append(qs.Mismatching).Append(qs.Mismatching > 0 ? " [" + qs.Where + " " + DirFmt(qs.Worst) + "]" : "").Append(" | ")
                        .Append(ob.Mismatching).Append('/').Append(ob.Frames).Append(" bowler, ").Append(os.Mismatching).Append('/').Append(os.Frames).Append(" striker | ")
                        .Append(DirFmt(gloves(off1))).Append('/').Append(DirFmt(gloves(on))).Append(" | ")
                        .Append("striker neck ").Append(DirFmt(nsOff)).Append('/').Append(DirFmt(nsOn)).Append(" head ").Append(DirFmt(hsOff)).Append('/').Append(DirFmt(hsOn))
                        .Append(" dN ").Append(DirFmt(ncOff)).Append('/').Append(DirFmt(ncOn)).Append(" dH ").Append(DirFmt(hcOff)).Append('/').Append(DirFmt(hcOn))
                        .Append("; bowler neck ").Append(DirFmt(bnsOff)).Append('/').Append(DirFmt(bnsOn)).Append(" head ").Append(DirFmt(bhsOff)).Append('/').Append(DirFmt(bhsOn))
                        .Append(" dN ").Append(DirFmt(bncOff)).Append('/').Append(DirFmt(bncOn)).Append(" dH ").Append(DirFmt(bhcOff)).Append('/').Append(DirFmt(bhcOn)).Append(" | ")
                        .Append("RM ").Append(rmLife).Append(" life frames, mismatches bowler ").Append(rb.Mismatching).Append('/').Append(rb.Frames).Append(" striker ").Append(rs.Mismatching).Append('/').Append(rs.Frames).Append(" | ")
                        .Append("bowler head vs batter gather..release n=").Append(aimErr.Count).Append(" p95 ").Append(DirQ(aimErr, 0.95)).Append(" max ").Append(aimErr.Count > 0 ? DirFmt(aimErr.Max()) : "-")
                        .Append(" within10 ").Append(aimErr.Count > 0 ? DirFmt(100.0 * aimErr.Count(e => e <= 10) / aimErr.Count) : "-").Append("% | ")
                        .Append(failure).Append('\n');
                    rows.Add("{\"case\":\"" + item.id + "\",\"hand\":\"" + hand + "\",\"controlFrames\":" + c0.Frames + ",\"controlMismatch\":" + (c0.Mismatching + c1.Mismatching) +
                             ",\"quietBowlerFrames\":" + qb.Frames + ",\"quietBowlerMismatch\":" + qb.Mismatching + ",\"quietStrikerFrames\":" + qs.Frames + ",\"quietStrikerMismatch\":" + qs.Mismatching +
                             ",\"outsideBowlerDiffer\":" + ob.Mismatching + ",\"outsideBowlerFrames\":" + ob.Frames + ",\"outsideStrikerDiffer\":" + os.Mismatching + ",\"outsideStrikerFrames\":" + os.Frames +
                             ",\"gloveOffMmOff\":" + DirFmt(gloves(off1)) + ",\"gloveOffMmOn\":" + DirFmt(gloves(on)) +
                             ",\"strikerNeckSpeedOff\":" + DirFmt(nsOff) + ",\"strikerNeckSpeedOn\":" + DirFmt(nsOn) + ",\"strikerHeadSpeedOff\":" + DirFmt(hsOff) + ",\"strikerHeadSpeedOn\":" + DirFmt(hsOn) +
                             ",\"strikerNeckDSpeedOff\":" + DirFmt(ncOff) + ",\"strikerNeckDSpeedOn\":" + DirFmt(ncOn) + ",\"strikerHeadDSpeedOff\":" + DirFmt(hcOff) + ",\"strikerHeadDSpeedOn\":" + DirFmt(hcOn) +
                             ",\"bowlerNeckSpeedOff\":" + DirFmt(bnsOff) + ",\"bowlerNeckSpeedOn\":" + DirFmt(bnsOn) + ",\"bowlerHeadSpeedOff\":" + DirFmt(bhsOff) + ",\"bowlerHeadSpeedOn\":" + DirFmt(bhsOn) +
                             ",\"bowlerNeckDSpeedOff\":" + DirFmt(bncOff) + ",\"bowlerNeckDSpeedOn\":" + DirFmt(bncOn) + ",\"bowlerHeadDSpeedOff\":" + DirFmt(bhcOff) + ",\"bowlerHeadDSpeedOn\":" + DirFmt(bhcOn) +
                             ",\"f3BowlerStepCaps\":" + DirFmt(maxStep(on, 0)) + ",\"f3BowlerStepAlone\":" + DirFmt(maxStep(alone, 0)) + ",\"f3StrikerStepCaps\":" + DirFmt(maxStep(on, 1)) + ",\"f3StrikerStepAlone\":" + DirFmt(maxStep(alone, 1)) +
                             ",\"f3BowlerLowestLook\":" + DirFmt(lowestLook(on, 0)) + ",\"f3StrikerLowestLook\":" + DirFmt(lowestLook(on, 1)) +
                             ",\"rmLifeFrames\":" + rmLife + ",\"rmBowlerMismatch\":" + rb.Mismatching + ",\"rmStrikerMismatch\":" + rs.Mismatching +
                             ",\"bowlerAimFrames\":" + aimErr.Count + ",\"bowlerAimP95\":" + DirQ(aimErr, 0.95) + ",\"bowlerAimMax\":" + (aimErr.Count > 0 ? DirFmt(aimErr.Max()) : "null") +
                             ",\"failure\":\"" + failure + "\"}");
                }
            report.Append("seconds ").Append(DirFmt((DateTime.UtcNow - started).TotalSeconds)).Append('\n');
            File.WriteAllText(Path.Combine(output, "director-gates.txt"), report.ToString());
            File.WriteAllText(Path.Combine(output, "director-gates.json"), "{\"rows\":[" + string.Join(",", rows) + "]}");
            UnityEngine.Debug.Log("DirectorGates\n" + report);
        }

        /// <summary>
        /// The pops: the scene between balls for 62 s (the loop wraps once), and for each ball the delivery's first 30 frames after the scene (the seam) and
        /// the frames around the accept (the hand-over), the Director on against off. Writes director-pops.txt.
        /// </summary>
        public static void DirectorPops()
        {
            var output = DirOut();
            var report = new StringBuilder();
            report.Append("UNITY-E2 Director pops (builder measurements): largest step of a bone between two 60 Hz frames, degrees (local rotation) and millimetres (root)\n");
            // (a) the scene between balls across the wrap of its loop
            var item0 = DirCases().First();
            using (var w = new DirWorld(item0, "right", true, false))
            {
                var frames = new List<DirFrame>();
                for (var i = 0; i < 62 * 60 + 120; i++)
                {
                    w.World.Tick(DirStep);
                    var f = new DirFrame();
                    DirRecord(w, f, i, 0);
                    frames.Add(f);
                }
                var wrapIndex = -1;
                for (var i = 1; i < frames.Count; i++)
                    if (frames[i].Kind == "Idle" && frames[i].SceneMs < frames[i - 1].SceneMs - 30000) { wrapIndex = i; break; }
                report.Append("scene between balls: ").Append(frames.Count).Append(" frames; the loop wrapped at frame ").Append(wrapIndex).Append(" (scene time ").Append(wrapIndex > 0 ? DirFmt(frames[wrapIndex - 1].SceneMs) : "-").Append(" -> ").Append(wrapIndex > 0 ? DirFmt(frames[wrapIndex].SceneMs) : "-").Append(" ms)\n");
                foreach (var r in new[] { 0, 1 })
                    foreach (var joint in new[] { ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest, ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head })
                    {
                        var steps = new List<double>();
                        double atWrap = 0;
                        for (var i = 130; i < frames.Count; i++)
                        {
                            var a = joint == ProductionCharacterJoint.Neck || joint == ProductionCharacterJoint.Head ? DirLocal(frames[i - 1].Pose[r], joint) : Quaternion.Inverse(DirRot(frames[i - 1].Pose[r], (int)joint - 1)) * DirRot(frames[i - 1].Pose[r], (int)joint);
                            var b = joint == ProductionCharacterJoint.Neck || joint == ProductionCharacterJoint.Head ? DirLocal(frames[i].Pose[r], joint) : Quaternion.Inverse(DirRot(frames[i].Pose[r], (int)joint - 1)) * DirRot(frames[i].Pose[r], (int)joint);
                            var step = Quaternion.Angle(a, b);
                            if (i == wrapIndex) atWrap = step;
                            else steps.Add(step);
                        }
                        report.Append("  ").Append(r == 0 ? "bowler " : "striker ").Append(joint).Append(": step at the wrap ").Append(DirFmt(atWrap)).Append(" deg; elsewhere p50 ").Append(DirQ(steps, 0.5)).Append(" p99.9 ").Append(DirQ(steps, 0.999)).Append(" max ").Append(DirFmt(steps.Max())).Append('\n');
                    }
                var rootStep = new List<double>();
                double rootWrap = 0;
                for (var i = 130; i < frames.Count; i++)
                {
                    var a = frames[i - 1].Pose[1];
                    var b = frames[i].Pose[1];
                    var k = a.Length - 3;
                    var d = Math.Sqrt(Math.Pow(a[k] - b[k], 2) + Math.Pow(a[k + 1] - b[k + 1], 2) + Math.Pow(a[k + 2] - b[k + 2], 2)) * 1000;
                    if (i == wrapIndex) rootWrap = d; else rootStep.Add(d);
                }
                report.Append("  striker root: step at the wrap ").Append(DirFmt(rootWrap)).Append(" mm; elsewhere p99.9 ").Append(DirQ(rootStep, 0.999)).Append(" max ").Append(DirFmt(rootStep.Max())).Append('\n');
            }
            // (b) the seam and (c) the hand-over, per ball
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                {
                    List<DirFrame> off, on;
                    using (var w = new DirWorld(item, hand, false, false)) off = DirPlayBall(w, 180, 0.05, 3, true, 420, 60);
                    var acceptOn = -1;
                    using (var w = new DirWorld(item, hand, true, false)) { on = DirPlayBall(w, 180, 0.05, 3, true, 420, 60); acceptOn = AcceptIndexOfLastRun; }
                    Func<List<DirFrame>, int, int, int, ProductionCharacterJoint, double> worst = (frames, from, to, rig, joint) =>
                    {
                        double m = 0;
                        for (var i = Math.Max(1, from); i <= Math.Min(frames.Count - 1, to); i++)
                        {
                            var a = joint == ProductionCharacterJoint.Neck || joint == ProductionCharacterJoint.Head ? DirLocal(frames[i - 1].Pose[rig], joint) : DirRot(frames[i - 1].Pose[rig], (int)joint);
                            var b = joint == ProductionCharacterJoint.Neck || joint == ProductionCharacterJoint.Head ? DirLocal(frames[i].Pose[rig], joint) : DirRot(frames[i].Pose[rig], (int)joint);
                            m = Math.Max(m, Quaternion.Angle(a, b));
                        }
                        return m;
                    };
                    report.Append(item.id).Append(' ').Append(hand).Append(": seam (frames 180..210, the delivery's first 500 ms after the scene) worst step deg/frame off/on: striker neck ")
                        .Append(DirFmt(worst(off, 180, 210, 1, ProductionCharacterJoint.Neck))).Append('/').Append(DirFmt(worst(on, 180, 210, 1, ProductionCharacterJoint.Neck)))
                        .Append(" head ").Append(DirFmt(worst(off, 180, 210, 1, ProductionCharacterJoint.Head))).Append('/').Append(DirFmt(worst(on, 180, 210, 1, ProductionCharacterJoint.Head)))
                        .Append("; bowler neck ").Append(DirFmt(worst(off, 180, 210, 0, ProductionCharacterJoint.Neck))).Append('/').Append(DirFmt(worst(on, 180, 210, 0, ProductionCharacterJoint.Neck)))
                        .Append(" head ").Append(DirFmt(worst(off, 180, 210, 0, ProductionCharacterJoint.Head))).Append('/').Append(DirFmt(worst(on, 180, 210, 0, ProductionCharacterJoint.Head)))
                        .Append(" | hand-over (accept at frame ").Append(acceptOn).Append(", frames -2..+6) striker neck ").Append(DirFmt(worst(off, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Neck))).Append('/').Append(DirFmt(worst(on, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Neck)))
                        .Append(" head ").Append(DirFmt(worst(off, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Head))).Append('/').Append(DirFmt(worst(on, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Head)))
                        .Append(" chest ").Append(DirFmt(worst(off, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Chest))).Append('/').Append(DirFmt(worst(on, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Chest)))
                        .Append(" hips ").Append(DirFmt(worst(off, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Hips))).Append('/').Append(DirFmt(worst(on, acceptOn - 2, acceptOn + 6, 1, ProductionCharacterJoint.Hips)))
                        .Append("; bowler neck ").Append(DirFmt(worst(off, acceptOn - 2, acceptOn + 6, 0, ProductionCharacterJoint.Neck))).Append('/').Append(DirFmt(worst(on, acceptOn - 2, acceptOn + 6, 0, ProductionCharacterJoint.Neck)))
                        .Append(" head ").Append(DirFmt(worst(off, acceptOn - 2, acceptOn + 6, 0, ProductionCharacterJoint.Head))).Append('/').Append(DirFmt(worst(on, acceptOn - 2, acceptOn + 6, 0, ProductionCharacterJoint.Head))).Append('\n');
                    // the life at the seam (the scene between balls -> the delivery): the trunk bones' step in the first delivery frame and the root's, off/on
                    Func<List<DirFrame>, int, int, ProductionCharacterJoint, double> stepAt = (frames, at, rig, joint) =>
                        Quaternion.Angle(DirLocalAny(frames[at - 1].Pose[rig], joint), DirLocalAny(frames[at].Pose[rig], joint));
                    Func<List<DirFrame>, int, int, double> rootAt = (frames, at, rig) =>
                    {
                        var a = frames[at - 1].Pose[rig];
                        var b = frames[at].Pose[rig];
                        var k = a.Length - 3;
                        return Math.Sqrt(Math.Pow(a[k] - b[k], 2) + Math.Pow(a[k + 1] - b[k + 1], 2) + Math.Pow(a[k + 2] - b[k + 2], 2)) * 1000;
                    };
                    var seamAt = on.FindIndex(1, f => f.State == "RunUp");
                    if (seamAt > 1)
                        report.Append("    life at the idle -> delivery switch (frame ").Append(seamAt).Append("), step in that frame off/on, deg: bowler hips ").Append(DirFmt(stepAt(off, seamAt, 0, ProductionCharacterJoint.Hips))).Append('/').Append(DirFmt(stepAt(on, seamAt, 0, ProductionCharacterJoint.Hips)))
                            .Append(" spine ").Append(DirFmt(stepAt(off, seamAt, 0, ProductionCharacterJoint.Spine))).Append('/').Append(DirFmt(stepAt(on, seamAt, 0, ProductionCharacterJoint.Spine)))
                            .Append(" chest ").Append(DirFmt(stepAt(off, seamAt, 0, ProductionCharacterJoint.Chest))).Append('/').Append(DirFmt(stepAt(on, seamAt, 0, ProductionCharacterJoint.Chest)))
                            .Append(" root mm ").Append(DirFmt(rootAt(off, seamAt, 0))).Append('/').Append(DirFmt(rootAt(on, seamAt, 0)))
                            .Append("; striker hips ").Append(DirFmt(stepAt(off, seamAt, 1, ProductionCharacterJoint.Hips))).Append('/').Append(DirFmt(stepAt(on, seamAt, 1, ProductionCharacterJoint.Hips)))
                            .Append(" spine ").Append(DirFmt(stepAt(off, seamAt, 1, ProductionCharacterJoint.Spine))).Append('/').Append(DirFmt(stepAt(on, seamAt, 1, ProductionCharacterJoint.Spine)))
                            .Append(" chest ").Append(DirFmt(stepAt(off, seamAt, 1, ProductionCharacterJoint.Chest))).Append('/').Append(DirFmt(stepAt(on, seamAt, 1, ProductionCharacterJoint.Chest)))
                            .Append(" root mm ").Append(DirFmt(rootAt(off, seamAt, 1))).Append('/').Append(DirFmt(rootAt(on, seamAt, 1))).Append('\n');
                    // the delivery -> scene between balls switch
                    var idleAt = on.FindIndex(acceptOn, f => f.Kind == "Idle");
                    if (idleAt > 0)
                        report.Append("    delivery -> scene between balls at frame ").Append(idleAt).Append(": striker neck ").Append(DirFmt(worst(off, idleAt - 1, idleAt + 20, 1, ProductionCharacterJoint.Neck))).Append('/').Append(DirFmt(worst(on, idleAt - 1, idleAt + 20, 1, ProductionCharacterJoint.Neck)))
                            .Append(" head ").Append(DirFmt(worst(off, idleAt - 1, idleAt + 20, 1, ProductionCharacterJoint.Head))).Append('/').Append(DirFmt(worst(on, idleAt - 1, idleAt + 20, 1, ProductionCharacterJoint.Head)))
                            .Append("; bowler neck ").Append(DirFmt(worst(off, idleAt - 1, idleAt + 20, 0, ProductionCharacterJoint.Neck))).Append('/').Append(DirFmt(worst(on, idleAt - 1, idleAt + 20, 0, ProductionCharacterJoint.Neck)))
                            .Append(" head ").Append(DirFmt(worst(off, idleAt - 1, idleAt + 20, 0, ProductionCharacterJoint.Head))).Append('/').Append(DirFmt(worst(on, idleAt - 1, idleAt + 20, 0, ProductionCharacterJoint.Head))).Append(" (deg per frame, off/on)\n");
                }
            File.WriteAllText(Path.Combine(output, "director-pops.txt"), report.ToString());
            UnityEngine.Debug.Log("DirectorPops\n" + report);
        }

        /// <summary>
        /// Replay identity: a live ball (handed over its result) and the replay of the same result, with the Director on. The two result plans are compared
        /// value for value, and two worlds with the same history are played through the replay and compared bone for bone. Writes director-replay.txt.
        /// </summary>
        public static void DirectorReplay()
        {
            var output = DirOut();
            var report = new StringBuilder();
            report.Append("UNITY-E2 Director replay identity (builder measurements)\n");
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                {
                    var replayResult = PracticePresentationContractAdapter.Result(Decode(DirReplayPacket(item.id)));
                    DirectorPlan[] livePlans = new DirectorPlan[2];
                    DirectorPlan[] replayPlans = new DirectorPlan[2];
                    List<DirFrame> framesA, framesB;
                    var liveKey = "";
                    var replayKey = "";
                    var replayKind = "";
                    var liveBeforeReplay = new List<DirFrame>();
                    for (var run = 0; run < 2; run++)
                        using (var w = new DirWorld(item, hand, true, false))
                        {
                            // the result's plans as the live ball drew them: taken frame by frame while the result script is the current one (the last whole plan is kept)
                            var thisRun = run;
                            var live = DirPlayBall(w, 120, 0.05, 3, true, 420, 0, false, 0, index =>
                            {
                                var current = w.World.DirectorScriptForEvidence;
                                if (thisRun != 0 || current == null || current.ScriptKind != StageKind.Result) return;
                                for (var r = 0; r < 2; r++)
                                {
                                    var plan = w.World.DirectorStageForEvidence.PlanOfScript(current, (DirectorRole)r);
                                    if (plan != null) livePlans[r] = plan;
                                }
                                liveKey = current.DeliveryKey;
                            });
                            if (run == 0) liveBeforeReplay = live;
                            // let the ball end and the scene return, then replay the result
                            var frames = new List<DirFrame>();
                            for (var i = 0; i < 700 && w.World.StateForEvidence != "Idle"; i++) w.World.Tick(DirStep);
                            for (var i = 0; i < 60; i++) w.World.Tick(DirStep);
                            w.World.AcceptResult(replayResult);
                            for (var i = 0; i < 360; i++)
                            {
                                w.World.Tick(DirStep);
                                var f = new DirFrame();
                                DirRecord(w, f, i, 0);
                                frames.Add(f);
                            }
                            var rs = w.World.DirectorScriptForEvidence;
                            if (run == 0)
                            {
                                framesA = frames;
                                if (rs != null)
                                {
                                    replayKind = rs.ScriptKind.ToString();
                                    replayKey = rs.DeliveryKey;
                                    for (var r = 0; r < 2; r++) replayPlans[r] = w.World.DirectorStageForEvidence.PlanOfScript(rs, (DirectorRole)r);
                                }
                            }
                            else
                            {
                                framesB = frames;
                                // compare the two replays bone for bone
                                int mismatching = 0, firstMismatch = -1;
                                for (var i = 0; i < Math.Min(replayFramesA.Count, frames.Count); i++)
                                    for (var r = 0; r < 2; r++)
                                        if (!replayFramesA[i].Pose[r].SequenceEqual(frames[i].Pose[r])) { mismatching++; if (firstMismatch < 0) firstMismatch = i; }
                                report.Append(item.id).Append(' ').Append(hand).Append(": ");
                                report.Append("live key ").Append(liveKey).Append(", replay key ").Append(replayKey).Append(" (").Append(replayKind).Append(")");
                                for (var r = 0; r < 2; r++)
                                {
                                    var lp = livePlans[r];
                                    var rp = replayPlans[r];
                                    if (lp == null || rp == null) { report.Append(" | ").Append(r == 0 ? "bowler" : "striker").Append(" plan missing"); continue; }
                                    var traceEqual = lp.Trace.Length == rp.Trace.Length;
                                    var firstDiff = -1;
                                    if (traceEqual) for (var k = 0; k < lp.Trace.Length; k++) if (lp.Trace[k] != rp.Trace[k]) { traceEqual = false; firstDiff = k / DirectorChannels.Count; break; }
                                    report.Append(" | ").Append(r == 0 ? "bowler" : "striker").Append(" plan frames ").Append(lp.N).Append('/').Append(rp.N).Append(traceEqual ? " trace bit-equal" : " TRACE DIFFERS from frame " + firstDiff + " (" + DirFmt(firstDiff * 1000.0 / 60) + " ms)");
                                }
                                report.Append(" | two replays in two fresh worlds with the same history: ").Append(mismatching).Append(" frame-rigs differ of ").Append(2 * Math.Min(replayFramesA.Count, frames.Count)).Append(firstMismatch >= 0 ? " (first at frame " + firstMismatch + ")" : "").Append('\n');
                            }
                            if (run == 0) replayFramesA = frames;
                        }
                }
            File.WriteAllText(Path.Combine(output, "director-replay.txt"), report.ToString());
            UnityEngine.Debug.Log("DirectorReplay\n" + report);
        }


        /// <summary>
        /// The live hand-over's head (ProductionLiveHandOverTests' scenario, frame for frame): the neck's and head's turn since the frame before the
        /// commitment (the test's measure, world rotations), with the Director off and on, and what the head pass decided each frame.
        /// Env: VANDE_DIR_COMMITS (default 0.05,0.12), VANDE_DIR_ACCEPTS (default 0,1,3), VANDE_DIR_PRESS=1 (host start time).
        /// </summary>
        public static void DirectorHandOverHead()
        {
            var output = DirOut();
            var commits = (Environment.GetEnvironmentVariable("VANDE_DIR_COMMITS") ?? "0.05,0.12").Split(',').Select(v => double.Parse(v, CultureInfo.InvariantCulture)).ToArray();
            var accepts = (Environment.GetEnvironmentVariable("VANDE_DIR_ACCEPTS") ?? "0,1,3").Split(',').Select(int.Parse).ToArray();
            var press = Environment.GetEnvironmentVariable("VANDE_DIR_PRESS") == "1";
            var sb = new StringBuilder("case,hand,director,commit,accept,k,t,kind,sceneMs,hipsDeg,spineDeg,chestDeg,neckDeg,headDeg,planYaw,planPitch,planRoll,w,drawnYaw,drawnPitch,dYaw,dPitch,limited,clamped,afterYaw,afterPitch,headWorldSpd,neckWorldSpd,chestWorldSpd,headLocalSpd,neckLocalSpd,holding\n");
            var worst = new StringBuilder();
            foreach (var item in DirCases())
            {
                if (item.id != "grounded-attack" && item.id != "thin-edge" && Environment.GetEnvironmentVariable("VANDE_DIR_CASES") == null) continue;
                foreach (var hand in DirHands())
                foreach (var director in new[] { false, true })
                foreach (var commit in commits)
                foreach (var accept in accepts)
                {
                    using (var w = new DirWorld(item, hand, director, false))
                    {
                        w.World.BeginDelivery(w.Delivery);
                        var swingStart = w.Result.SwingStartT ?? 0.15;
                        w.World.Tick(Math.Max(0.0, swingStart - w.World.TimelineForEvidence));
                        w.World.BeginLocalPreparation();
                        var joints = new[] { ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest, ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head };
                        var before = new Quaternion[joints.Length];
                        var committed = false;
                        var accepted = false;
                        var countdown = accept;
                        var commitAt = swingStart + commit;
                        var commitIndex = -1;
                        var acceptIndex = -1;
                        var frames = 0;
                        var prev = new Quaternion[joints.Length];
                        var prevLocal = new Quaternion[2];
                        var maxHead = 0.0;
                        var maxHeadK = -99;
                        for (var step = 0; step < 90; step++)
                        {
                            if (!committed && w.World.TimelineForEvidence >= commitAt - 1e-9)
                            {
                                for (var j = 0; j < joints.Length; j++) before[j] = prev[j];
                                w.World.ApplyProvisionalSwing(new PracticeSwingPresentation
                                {
                                    Kind = "attack",
                                    StartT = press ? swingStart : w.World.Timeline,
                                    DirectionDeg = w.Result.SwingDirectionDeg,
                                    Power = 0.7,
                                    Elevation = 0.1,
                                    Footwork = string.IsNullOrEmpty(w.Result.Footwork) ? "auto" : w.Result.Footwork
                                });
                                committed = true;
                                commitIndex = frames;
                            }
                            if (committed && !accepted)
                            {
                                if (countdown == 0) { w.World.AcceptResult(w.Result); accepted = true; acceptIndex = frames; }
                                else countdown--;
                            }
                            w.World.Tick(DirStep);
                            var f = new DirFrame();
                            DirRecord(w, f, frames, 0);
                            var now = joints.Select(j => w.Striker.VisibleJointWorldRotation(j)).ToArray();
                            if (committed)
                            {
                                var k = frames - commitIndex;
                                var deg = joints.Select((j, i) => (double)Quaternion.Angle(before[i], now[i])).ToArray();
                                var r = 1;
                                sb.Append(item.id).Append(',').Append(hand).Append(',').Append(director ? 1 : 0).Append(',').Append(DirFmt(commit)).Append(',').Append(accept).Append(',').Append(k).Append(',').Append(DirFmt(f.Timeline))
                                    .Append(',').Append(f.Kind).Append(',').Append(DirFmt(f.SceneMs));
                                foreach (var d in deg) sb.Append(',').Append(DirFmt(d));
                                sb.Append(',').Append(DirFmt(f.Ch[r][DirectorChannels.HeadYaw])).Append(',').Append(DirFmt(f.Ch[r][DirectorChannels.HeadPitch])).Append(',').Append(DirFmt(f.Ch[r][DirectorChannels.HeadRoll]))
                                    .Append(',').Append(DirFmt(f.W[r])).Append(',').Append(DirFmt(f.HeadYaw[r])).Append(',').Append(DirFmt(f.HeadPitch[r])).Append(',').Append(DirFmt(f.DYaw[r])).Append(',').Append(DirFmt(f.DPitch[r]))
                                    .Append(',').Append(f.Limited[r] ? 1 : 0).Append(',').Append(f.Clamped[r] ? 1 : 0).Append(',').Append(DirFmt(f.AfterYaw[r])).Append(',').Append(DirFmt(f.AfterPitch[r]));
                                var headWorldSpd = Quaternion.Angle(prev[4], now[4]) / DirStep;
                                var neckWorldSpd = Quaternion.Angle(prev[3], now[3]) / DirStep;
                                var chestWorldSpd = Quaternion.Angle(prev[2], now[2]) / DirStep;
                                var localNeck = DirLocal(f.Pose[1], ProductionCharacterJoint.Neck);
                                var localHead = DirLocal(f.Pose[1], ProductionCharacterJoint.Head);
                                var headLocalSpd = Quaternion.Angle(prevLocal[1], localHead) / DirStep;
                                var neckLocalSpd = Quaternion.Angle(prevLocal[0], localNeck) / DirStep;
                                sb.Append(',').Append(DirFmt(headWorldSpd)).Append(',').Append(DirFmt(neckWorldSpd)).Append(',').Append(DirFmt(chestWorldSpd))
                                    .Append(',').Append(DirFmt(headLocalSpd)).Append(',').Append(DirFmt(neckLocalSpd)).Append(',').Append(w.World.DirectedHeadPassForEvidence(DirectorRole.Striker) != null && w.World.DirectedHeadPassForEvidence(DirectorRole.Striker).Holding ? 1 : 0).Append('\n');
                                if (acceptIndex < 0 || frames < acceptIndex || true)
                                {
                                    var untilResult = Math.Max(commitIndex, acceptIndex < 0 ? int.MaxValue : acceptIndex - 1);
                                    if (frames <= untilResult && deg[4] > maxHead) { maxHead = deg[4]; maxHeadK = k; }
                                }
                            }
                            for (var j = 0; j < joints.Length; j++) prev[j] = now[j];
                            prevLocal[0] = DirLocal(f.Pose[1], ProductionCharacterJoint.Neck);
                            prevLocal[1] = DirLocal(f.Pose[1], ProductionCharacterJoint.Head);
                            frames++;
                            if (accepted && frames > acceptIndex + 4) break;
                        }
                        worst.Append(item.id).Append(' ').Append(hand).Append(" director=").Append(director ? "on" : "off").Append(" commit ").Append(DirFmt(commit)).Append(" accept+").Append(accept)
                            .Append(": max head turn since before-commit until the result ").Append(DirFmt(maxHead)).Append(" deg at k=").Append(maxHeadK).Append('\n');
                    }
                }
            }
            File.WriteAllText(Path.Combine(output, "director-handover-head.csv"), sb.ToString());
            File.WriteAllText(Path.Combine(output, "director-handover-head.txt"), worst.ToString());
            UnityEngine.Debug.Log("DirectorHandOverHead\n" + worst);
        }


        /// <summary>
        /// The bowler's head through his turn to walk back (builder diagnostic): per frame of the window VANDE_DIR_FROM..VANDE_DIR_TO (default 380..445), the plan's head,
        /// the neck's range target, where the chest and the base head face, what the pass decided and where the head ended up, with the speeds (world and local).
        /// </summary>
        public static void DirectorBowlerTurn()
        {
            var output = DirOut();
            var from = int.Parse(Environment.GetEnvironmentVariable("VANDE_DIR_FROM") ?? "380");
            var to = int.Parse(Environment.GetEnvironmentVariable("VANDE_DIR_TO") ?? "445");
            var sb = new StringBuilder("case,hand,frame,state,planYaw,planPitch,chestYaw,drawnYaw,reachYaw,dYaw,afterYaw,afterPitch,limited,clamped,headWorldSpd,headLocalSpd,neckLocalSpd,chestSpd,headWorldSpdOff,neckWorldSpd,neckWorldSpdOff,chestSpdOff,chestYawOffPose,headYawOffPose,sceneMs,releaseMs,followEndMs\n");
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                {
                    using (var w = new DirWorld(item, hand, true, false))
                    {
                        var mirror = ProceduralPracticeWorld.WorldReflectionFor(hand);
                        var chestYaw = new List<double>();
                        var reach = new List<double>();
                        var frames = DirPlayBall(w, 180, 0.05, 3, true, 420, 180, false, 0, index =>
                        {
                            var pass = w.World.DirectedHeadPassForEvidence(DirectorRole.Bowler);
                            chestYaw.Add(pass != null ? pass.ChestYaw(mirror) : double.NaN);
                            reach.Add(pass != null ? pass.ReachableYaw : double.NaN);
                        });
                        List<DirFrame> offFrames;
                        using (var wo = new DirWorld(item, hand, false, false)) offFrames = DirPlayBall(wo, 180, 0.05, 3, true, 420, 180);
                        for (var i = Math.Max(1, from); i <= Math.Min(to, chestYaw.Count - 1); i++)
                        {
                            var f = frames[i];
                            var p = frames[i - 1];
                            var fo = offFrames[i];
                            var po = offFrames[i - 1];
                            Func<ProductionCharacterJoint, double> world = j => Quaternion.Angle(DirRot(p.Pose[0], (int)j), DirRot(f.Pose[0], (int)j)) / DirStep;
                            sb.Append(item.id).Append(',').Append(hand).Append(',').Append(i).Append(',').Append(f.State).Append(',').Append(DirFmt(f.Ch[0][DirectorChannels.HeadYaw])).Append(',').Append(DirFmt(f.Ch[0][DirectorChannels.HeadPitch]))
                                .Append(',').Append(DirFmt(chestYaw[i])).Append(',').Append(DirFmt(f.HeadYaw[0])).Append(',').Append(DirFmt(reach[i])).Append(',').Append(DirFmt(f.DYaw[0])).Append(',').Append(DirFmt(f.AfterYaw[0])).Append(',').Append(DirFmt(f.AfterPitch[0]))
                                .Append(',').Append(f.Limited[0] ? 1 : 0).Append(',').Append(f.Clamped[0] ? 1 : 0).Append(',').Append(DirFmt(world(ProductionCharacterJoint.Head)))
                                .Append(',').Append(DirFmt(Quaternion.Angle(DirLocal(p.Pose[0], ProductionCharacterJoint.Head), DirLocal(f.Pose[0], ProductionCharacterJoint.Head)) / DirStep))
                                .Append(',').Append(DirFmt(Quaternion.Angle(DirLocal(p.Pose[0], ProductionCharacterJoint.Neck), DirLocal(f.Pose[0], ProductionCharacterJoint.Neck)) / DirStep))
                                .Append(',').Append(DirFmt(world(ProductionCharacterJoint.Chest)))
                                .Append(',').Append(DirFmt(Quaternion.Angle(DirRot(po.Pose[0], (int)ProductionCharacterJoint.Head), DirRot(fo.Pose[0], (int)ProductionCharacterJoint.Head)) / DirStep))
                                .Append(',').Append(DirFmt(world(ProductionCharacterJoint.Neck)))
                                .Append(',').Append(DirFmt(Quaternion.Angle(DirRot(po.Pose[0], (int)ProductionCharacterJoint.Neck), DirRot(fo.Pose[0], (int)ProductionCharacterJoint.Neck)) / DirStep))
                                .Append(',').Append(DirFmt(Quaternion.Angle(DirRot(po.Pose[0], (int)ProductionCharacterJoint.Chest), DirRot(fo.Pose[0], (int)ProductionCharacterJoint.Chest)) / DirStep))
                                .Append(',').Append(DirFmt(DirYawOf(fo.Pose[0], ProductionCharacterJoint.Chest, mirror)))
                                .Append(',').Append(DirFmt(DirYawOf(fo.Pose[0], ProductionCharacterJoint.Head, mirror)))
                                .Append(',').Append(DirFmt(f.SceneMs)).Append(',').Append(DirFmt(f.ReleaseMs)).Append(',').Append(DirFmt(f.FollowEndMs)).Append("\n");
                        }
                    }
                }
            File.WriteAllText(Path.Combine(output, "director-bowler-turn.csv"), sb.ToString());
        }


        /// <summary>The bowler-role yaw (physics frame, degrees) a joint of a recorded pose faces.</summary>
        private static double DirYawOf(float[] pose, ProductionCharacterJoint joint, float mirror)
        {
            var q = DirRot(pose, (int)joint);
            var d = new Quaternion(q.x, mirror * q.y, mirror * q.z, q.w) * Vector3.forward;
            return Math.Atan2(d.x, d.z) * 180.0 / Math.PI;
        }


        /// <summary>The local rotation of any trunk bone against its parent (the world rotation against the parent's) from a frame's pose.</summary>
        private static Quaternion DirLocalAny(float[] pose, ProductionCharacterJoint joint)
        {
            if (joint == ProductionCharacterJoint.Hips) return DirRot(pose, (int)joint);
            if (joint == ProductionCharacterJoint.Neck || joint == ProductionCharacterJoint.Head) return DirLocal(pose, joint);
            return Quaternion.Inverse(DirRot(pose, (int)joint - 1)) * DirRot(pose, (int)joint);
        }


        /// <summary>
        /// What the Director costs a frame (builder measurement; the Unity Editor's Mono, not IL2CPP, not a phone; indicative only above a load of 20): the same ball played
        /// with the Director off and on in one process, interleaved, VANDE_DIR_ROUNDS times (default 5): the world's Tick in microseconds per frame (median, p95, max and the
        /// mean difference), the Director's own parts (the begin: plans sampled and life set; the end: head passes; the spare-time bakes are separate), and how many poses a rig
        /// applies in a frame (the life is added to each). Writes director-cost.txt.
        /// </summary>
        public static void DirectorCost()
        {
            var output = DirOut();
            var rounds = int.Parse(Environment.GetEnvironmentVariable("VANDE_DIR_ROUNDS") ?? "5");
            var report = new StringBuilder();
            report.Append("UNITY-E2 Director cost (Unity Editor Mono, ").Append(rounds).Append(" interleaved rounds; uptime at the start: ").Append(UptimeLine()).Append(")\n");
            foreach (var item in DirCases())
            {
                var onFrames = new List<List<DirFrame>>();
                var offFrames = new List<List<DirFrame>>();
                for (var round = 0; round < rounds; round++)
                {
                    using (var w = new DirWorld(item, "right", false, false)) offFrames.Add(DirPlayBall(w, 180, 0.05, 3, true, 420, 180));
                    using (var w = new DirWorld(item, "right", true, false)) onFrames.Add(DirPlayBall(w, 180, 0.05, 3, true, 420, 180));
                }
                // frame k of the ball: the median over the rounds of each frame's Tick time, then the statistics over the frames
                Func<List<List<DirFrame>>, Func<DirFrame, double>, double[]> perFrame = (runs, pick) =>
                {
                    var n = runs.Min(r => r.Count);
                    var result = new double[n];
                    for (var k = 0; k < n; k++) result[k] = runs.Select(r => pick(r[k])).OrderBy(x => x).ElementAt(runs.Count / 2);
                    return result;
                };
                var off = perFrame(offFrames, f => f.TickUs);
                var on = perFrame(onFrames, f => f.TickUs);
                var begin = perFrame(onFrames, f => f.BeginUs);
                var end = perFrame(onFrames, f => f.EndUs);
                var work = perFrame(onFrames, f => f.WorkUs);
                Func<double[], string> stats = a => "median " + DirFmt(a.OrderBy(x => x).ElementAt(a.Length / 2)) + " p95 " + DirFmt(a.OrderBy(x => x).ElementAt((int)(a.Length * 0.95))) + " max " + DirFmt(a.Max());
                var diff = on.Zip(off, (a, b) => a - b).ToArray();
                // the frames of the live ball only (the scene between balls has the Director alone in a quiet world)
                var live = Enumerable.Range(180, Math.Min(on.Length, 700) - 180).ToArray();
                var poses = onFrames[0];
                var bakeFrames = onFrames.Select(run => run.Count(f => f.WorkUs > 0)).OrderBy(x => x).ElementAt(rounds / 2);
                var bakeMs = onFrames.Select(run => run.Sum(f => f.WorkUs) / 1000.0).OrderBy(x => x).ElementAt(rounds / 2);
                report.Append(item.id).Append(": Tick off ").Append(stats(off)).Append(" us; on ").Append(stats(on)).Append(" us; mean difference ").Append(DirFmt(diff.Average())).Append(" us a frame (live ball ").Append(DirFmt(live.Select(i => diff[i]).Average())).Append(")")
                    .Append("; the Director's begin (plans sampled, life set) ").Append(stats(begin)).Append(", end (head passes) ").Append(stats(end)).Append(", spare-time bakes ").Append(stats(work)).Append(" us; the ball (").Append(poses.Count).Append(" frames) had ").Append(bakeFrames).Append(" frames with a bake slice, ").Append(DirFmt(bakeMs)).Append(" ms of bakes in all")
                    .Append("; poses a frame, bowler max ").Append(poses.Max(f => f.Poses[0])).Append(" mean ").Append(DirFmt(poses.Average(f => (double)f.Poses[0]))).Append(", striker max ").Append(poses.Max(f => f.Poses[1])).Append(" mean ").Append(DirFmt(poses.Average(f => (double)f.Poses[1]))).Append('\n');
            }
            report.Append("uptime at the end: ").Append(UptimeLine()).Append('\n');
            File.WriteAllText(Path.Combine(output, "director-cost.txt"), report.ToString());
            UnityEngine.Debug.Log("DirectorCost\n" + report);
        }

        private static string UptimeLine()
        {
            try
            {
                var p = new System.Diagnostics.Process();
                p.StartInfo.FileName = "/usr/bin/uptime";
                p.StartInfo.UseShellExecute = false;
                p.StartInfo.RedirectStandardOutput = true;
                p.Start();
                var text = p.StandardOutput.ReadToEnd().Trim();
                p.WaitForExit();
                return text;
            }
            catch (Exception) { return "(uptime unavailable)"; }
        }


        /// <summary>
        /// The bowler after the ball has left his hand, as drawn (WEB-FIX-B asks whether the Unity bowler's follow-through into the walk-back and the scene between balls shows the
        /// pose jumps the web's legacy clips did): per golden and hand, the Director off and on, the largest one-frame turn of any of his arm, trunk, neck or head bones
        /// (against the parent, degrees) from 300 ms after the release until the scene between balls returns, and of his hips (the heading). Writes director-bowler-steps.txt.
        /// </summary>
        public static void DirectorBowlerSteps()
        {
            var output = DirOut();
            var report = new StringBuilder("UNITY-E2 the bowler after the release, largest one-frame turn of a bone against its parent (degrees), release + 300 ms to the scene between balls; off / on\n");
            var upper = new[]
            {
                ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest, ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head,
                ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmRight
            };
            Func<ProductionCharacterJoint, ProductionCharacterJoint> parent = j =>
                j == ProductionCharacterJoint.Spine ? ProductionCharacterJoint.Hips
                : j == ProductionCharacterJoint.Chest ? ProductionCharacterJoint.Spine
                : j == ProductionCharacterJoint.Neck ? ProductionCharacterJoint.Chest
                : j == ProductionCharacterJoint.Head ? ProductionCharacterJoint.Neck
                : j == ProductionCharacterJoint.UpperArmLeft || j == ProductionCharacterJoint.UpperArmRight ? ProductionCharacterJoint.Chest
                : j == ProductionCharacterJoint.ForearmLeft ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight;
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                {
                    var worst = new string[2];
                    var runs = new List<DirFrame>[2];
                    for (var run = 0; run < 2; run++)
                        using (var w = new DirWorld(item, hand, run == 1, false)) runs[run] = DirPlayBall(w, 180, 0.05, 3, true, 440, 0);
                    // the window from the directed run's anchors (the same frames for both worlds: they play the same ball)
                    var on = runs[1];
                    var firstIdleAfter = on.FindIndex(300, f => f.Kind == "Idle");
                    var end = firstIdleAfter > 0 ? firstIdleAfter : on.Count;
                    var begin = on.FindIndex(f => !double.IsNaN(f.ReleaseMs) && f.State != "Idle" && f.State != "RunUp" && f.SceneMs >= f.ReleaseMs + 300);
                    for (var run = 0; run < 2; run++)
                    {
                        var frames = runs[run];
                        double best = 0, bestHips = 0;
                        string where = "", whereHips = "";
                        for (var i = Math.Max(1, begin); i < Math.Min(end, frames.Count); i++)
                        {
                            foreach (var j in upper)
                            {
                                var a = Quaternion.Inverse(DirRot(frames[i - 1].Pose[0], (int)parent(j))) * DirRot(frames[i - 1].Pose[0], (int)j);
                                var b = Quaternion.Inverse(DirRot(frames[i].Pose[0], (int)parent(j))) * DirRot(frames[i].Pose[0], (int)j);
                                var step = Quaternion.Angle(a, b);
                                if (step > best) { best = step; where = j + " at release+" + DirFmt(on[i].SceneMs - on[i].ReleaseMs) + " ms"; }
                            }
                            var hips = Quaternion.Angle(DirRot(frames[i - 1].Pose[0], (int)ProductionCharacterJoint.Hips), DirRot(frames[i].Pose[0], (int)ProductionCharacterJoint.Hips));
                            if (hips > bestHips) { bestHips = hips; whereHips = "at release+" + DirFmt(on[i].SceneMs - on[i].ReleaseMs) + " ms"; }
                        }
                        worst[run] = DirFmt(best) + " (" + where + "), hips " + DirFmt(bestHips) + " (" + whereHips + ")";
                    }
                    report.Append(item.id).Append(' ').Append(hand).Append(": off ").Append(worst[0]).Append(" | on ").Append(worst[1]).Append('\n');
                }
            File.WriteAllText(Path.Combine(output, "director-bowler-steps.txt"), report.ToString());
            UnityEngine.Debug.Log("DirectorBowlerSteps\n" + report);
        }

        private static List<DirFrame> replayFramesA = new List<DirFrame>();

        [Serializable] private sealed class DirReplayPackets { public UnityPracticePacket replay; }
        [Serializable] private sealed class DirReplayWire { public DirReplayPackets packets; }
        [Serializable] private sealed class DirReplayCase { public string id; public DirReplayWire wire; }
        [Serializable] private sealed class DirReplayFixture { public DirReplayCase[] cases; }

        /// <summary>The golden case's replay packet (the shared fixture classes carry the scene, delivery and result only).</summary>
        private static UnityPracticePacket DirReplayPacket(string id)
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            return JsonUtility.FromJson<DirReplayFixture>(File.ReadAllText(path)).cases.Single(c => c.id == id).wire.packets.replay;
        }

        /// <summary>
        /// Stills: the same ball with the Director off and on from the locked rear-shoulder camera, at the same frames: director-stills/{case}-{hand}-{off|on}-f{frame}.jpg and
        /// the list. VANDE_DIR_FRAMES = comma-separated frame indices of DirPlayBall(w, 180, 0.05, 3, ...) (the scene between balls is frames 0..179, the delivery begins at 180,
        /// the release is about 324 and the result is accepted at about 353).
        /// </summary>
        public static void DirectorStills()
        {
            var output = DirOut();
            var dir = Path.Combine(output, "director-stills");
            Directory.CreateDirectory(dir);
            var frames = (Environment.GetEnvironmentVariable("VANDE_DIR_FRAMES") ?? "60,110,170,230,290,320,335,345,360,375,395,430,520").Split(',').Select(int.Parse).ToList();
            var list = new StringBuilder();
            foreach (var item in DirCases())
                foreach (var hand in DirHands())
                    foreach (var director in new[] { false, true })
                    {
                        using (var w = new DirWorld(item, hand, director, false))
                        {
                            var camera = w.World.BatterCameraForEvidence;
                            Action<int> hook = index =>
                            {
                                if (!frames.Contains(index)) return;
                                var name = item.id + "-" + hand + "-" + (director ? "on" : "off") + "-f" + index.ToString("000");
                                Render(camera, 1280, 585, Path.Combine(dir, name + ".jpg"));
                                list.Append(name).Append(' ').Append(w.World.StateForEvidence).Append(" timeline ").Append(DirFmt(w.World.TimelineForEvidence)).Append('\n');
                            };
                            DirPlayBall(w, 180, 0.05, 3, true, 440, 0, false, 0, hook);
                        }
                    }
            File.WriteAllText(Path.Combine(output, "director-stills.txt"), list.ToString());
        }
    }
}
