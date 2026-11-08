using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// UNITY-9: the whole-delivery pop scanner (builder evidence only: no player, no device, nothing here is a human result).
    /// Plays deliveries through the production world at 60 Hz (the host flow: 180 frames of the scene between balls, BeginDelivery, the
    /// press at the recorded swing start, the commitment `VANDE_POP_COMMIT` s later, the result `late` frames after the commitment)
    /// and steps every frame of the striker and the bowler from the first delivery frame to the end of the ball (a window from 2 s before the
    /// release to 4.5 s after it is the brief's; the rest is tagged `tail`/`lead`). Writes pops.tsv, runs.tsv and scan-summary.txt to VANDE_EVIDENCE_OUT.
    ///
    /// POP DEFINITION (every term is a constant below; all angles are the VC17 driver bones as drawn on the visible hero, local to the parent, hips world):
    ///   SPIKE     a bone's rotation step in ONE frame at or above its floor (the smaller of 25 deg and its MOTION-SPEC section 9 cap per frame:
    ///             arms 30 -> 25, other limbs 20, hips/spine/chest 10, neck/head 12) AND at least 3 x its quiet neighbours (the second smallest of the
    ///             steps two frames either side), so a fast stroke that is fast in every frame is not a spike but a one-frame jump in it is.
    ///   HUGE      any bone step of 60 deg or more in one frame, whatever its neighbours.
    ///   HIPSJUMP / ROOTJUMP  the change of the per-frame displacement of the hips joint or the actor root over 5 cm (a teleport or a step in speed; a steady run is 0).
    ///   FAST      a run of frames whose step is at least 1.25 x its cap (a turn too fast for a person without being a one-frame jump: the hips 20 deg in
    ///             three frames), reported once with its peak and length; it is skipped when a SPIKE or HUGE frame is inside it (those rows say it).
    ///   HEADWORLD the head's world rotation speed over 720 deg/s (section 9 cap for neck/head, taken in the world, which adds the body's turn): an episode, peak and length.
    ///   GLOVE     a striker glove more than 2 cm from its ordered grip target on the bat: an episode, peak and length.
    ///   WRIST     a striker hand (wrist) swing over the section 9 limit of 85 deg against the forearm: an episode, peak and length.
    /// Frames 0 and 1 of the delivery (window `switch`) carry the harness's own relocation of a fresh world's bowler to his mark and are not counted.
    /// Each hit carries the world state, the time against the release, the frames from the accept, whether the striker was in his stroke, and its size
    /// against the cap (xcap). The planted-foot slide, the prop gaps and the hand-over gates are the existing probes' (GATE-TABLE.md) and stay theirs.
    ///
    /// Env: VANDE_POP_CASES (regex over the case ids; the golden ids plus `leave` and the corpus ids), VANDE_POP_HANDS (right,left), VANDE_POP_DIRECTOR (on,off),
    /// VANDE_POP_LATE (frames after the commitment: 0,6,10,14,30,60; for a leave: after the flight data is used up), VANDE_POP_COMMIT (0.05),
    /// VANDE_POP_CORPUS (a corpus json of the golden wire schema; VANDE_POP_CORPUS_CASES lists its ids), VANDE_POP_LEAVE=0 drops the leave,
    /// VANDE_POP_SEAMS (name=value,... : internal seams of the world switched for a before/after run, see PopApplySeams),
    /// VANDE_POP_DUMP (regex on the run key `case|hand|on|late`: those runs also write dump-*.tsv with every bone's step per frame),
    /// VANDE_POP_STILLS (comma list of `key@frame@label`: stills of the rear-shoulder camera and the side view).
    /// UNI-07 (the Target Chase result moments): VANDE_POP_CHASE_MAP (`case:outcome,...`, outcome won | lost_wicket | lost_balls: only those cases are played, each with that
    /// verdict on its deciding ball and the scan window carried to VANDE_POP_TAIL s after the release, default 10, so the whole clip and its held end are inside it),
    /// VANDE_POP_RM=1 (Reduced Motion: the clips hold their marker frame), VANDE_POP_DISMISSAL=bowled|caught|caught_behind|lbw (set on the result of every chase run).
    /// </summary>
    public static partial class VandeHumansEvidence
    {
        private const double PopSpikeFloorDeg = 25.0;
        private const double PopSpikeRatio = 3.0;
        private const double PopHugeDeg = 60.0;
        private const double PopJumpMetres = 0.05;
        private const double PopHeadWorldDegPerSecond = 720.0;
        private const double PopGloveMetres = 0.02;
        private const double PopFastRatio = 1.25;
        private const double PopWristSwingDeg = 85.0;
        private const int PopIdleFrames = 180;
        private const double PopWindowFrom = -2.0;
        private const double PopWindowTo = 4.5;

        /// <summary>The parent of each VC17 driver joint (the enum order): hips none, spine on hips, chest on spine, neck, head, arms on the chest, legs on the hips.</summary>
        private static readonly int[] PopParent = { -1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15 };

        private sealed class PopCase
        {
            public string Id;
            public string Kind;
            public GoldenCase Item;
            public bool Leave;
            /// <summary>UNI-07: the host's verdict on the deciding ball (won, lost_wicket, lost_balls) the run plays out; null: ordinary Practice.</summary>
            public string Chase;
        }

        private sealed class PopRun
        {
            public string Key;
            public string Case, Hand, Kind;
            public bool Director;
            public int Late;
            public readonly List<float[]>[] Pose = { new List<float[]>(), new List<float[]>() };
            public readonly List<string> State = new List<string>();
            public readonly List<double> Timeline = new List<double>();
            public readonly List<float> Glove = new List<float>();
            public readonly List<float> WristL = new List<float>();
            public readonly List<float> WristR = new List<float>();
            public int BeginFrame = -1, PressFrame = -1, CommitFrame = -1, AcceptFrame = -1, ReleaseFrame = -1, IdleAgainFrame = -1;
            public double StrokeEndT = double.NaN;
            public double SwingStart = double.NaN;
            /// <summary>The end of the scan window against the release (s): 4.5 for a Practice ball, longer for a chase's result moment (VANDE_POP_TAIL).</summary>
            public double WindowTo = PopWindowTo;
        }

        private sealed class PopHit
        {
            public PopRun Run;
            public string Role, Kind, Bone, State, Window;
            public int Frame, Length = 1;
            public double TRelMs;
            public int FromAccept;
            public bool InStroke;
            public double Size, Reference, XCap;
            public string Unit;
        }

        private static string PopEnv(string name, string fallback) => Environment.GetEnvironmentVariable(name) ?? fallback;

        private static string[] PopList(string name, string fallback) =>
            PopEnv(name, fallback).Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);

        private static double PopCapDegPerFrame(int joint) => AngularCap((ProductionCharacterJoint)joint) / 60.0;

        private static double PopFloorDeg(int joint) => Math.Min(PopSpikeFloorDeg, PopCapDegPerFrame(joint));

        private static Quaternion PopLocal(float[] pose, int joint) =>
            PopParent[joint] < 0 ? DirRot(pose, joint) : Quaternion.Inverse(DirRot(pose, PopParent[joint])) * DirRot(pose, joint);

        private static Vector3 PopRoot(float[] pose) => new Vector3(pose[pose.Length - 3], pose[pose.Length - 2], pose[pose.Length - 1]);

        private static Vector3 PopHips(float[] pose) => new Vector3(pose[0], pose[1], pose[2]);

        /// <summary>The leave of the golden complete-miss (what the host sends for a ball the player let go), as LeaveLookProbe makes it.</summary>
        private static void PopMakeLeave(PracticeResultPresentation result)
        {
            result.ShotIntent = "leave";
            result.SwingStartT = null;
            result.SwingDirectionDeg = 0.0;
            result.Footwork = null;
            result.ContactKind = "leave";
            result.ContactTiming = "none";
            result.Trace.bat = new Vande.Practice.Trace.BatTraceSample[0];
            result.Trace.batterMotion = null;
            result.Trace.batterRootOffset = new Vande.Practice.Trace.TraceVector2 { x = 0.0, z = 0.0 };
            result.Trace.batterPosture = new Vande.Practice.Trace.TraceBatterPosture { crouchM = 0.0 };
        }

        /// <summary>UNI-07: the host's verdict on the deciding ball of a Target Chase (what chase.outcome carries on the wire).</summary>
        private static void PopMakeChase(PracticeResultPresentation result, string outcome)
        {
            var won = outcome == "won";
            result.Chase = new PracticeChasePresentation
            {
                Target = 20,
                MaxBalls = 12,
                RunsNeeded = won ? 0 : 6,
                BallsLeft = 0,
                Outcome = won ? PracticeChaseOutcome.Won : outcome == "lost_wicket" ? PracticeChaseOutcome.LostWicket : PracticeChaseOutcome.LostBalls
            };
        }

        private static bool PopReduced() => PopEnv("VANDE_POP_RM", "0") == "1";

        /// <summary>The baked venue add-on (VANDE_POP_VENUE=1): the ring is built from the project's own venue files for the whole Editor run, as an export that carries it would.</summary>
        private static void PopVenue()
        {
            Vande.Practice.Presentation.Production.Environment.ProductionVenueRing.AddonOverride =
                PopEnv("VANDE_POP_VENUE", "0") == "1" ? VandeVenueAddonTool.BuildInMemory() : null;
        }

        private static List<PopCase> PopCases()
        {
            var regex = new Regex(PopEnv("VANDE_POP_CASES", ".*"));
            var list = new List<PopCase>();
            var golden = LoadFixture().cases;
            foreach (var item in golden)
                if (regex.IsMatch(item.id)) list.Add(new PopCase { Id = item.id, Kind = "golden", Item = item });
            if (PopEnv("VANDE_POP_LEAVE", "1") != "0" && regex.IsMatch("leave"))
            {
                var miss = golden.Single(c => c.id == "complete-miss");
                list.Add(new PopCase { Id = "leave", Kind = "leave", Item = miss, Leave = true });
            }

            var corpusPath = Environment.GetEnvironmentVariable("VANDE_POP_CORPUS");
            if (!string.IsNullOrEmpty(corpusPath))
            {
                var wanted = new HashSet<string>(PopList("VANDE_POP_CORPUS_CASES", string.Empty));
                var corpus = JsonUtility.FromJson<GovernedCorpus>(File.ReadAllText(corpusPath));
                foreach (var gc in corpus.cases)
                    if (wanted.Contains(gc.id) && regex.IsMatch(gc.id))
                        list.Add(new PopCase { Id = gc.id, Kind = "corpus-" + (gc.dismissal ?? "none"), Item = new GoldenCase { id = gc.id, wire = gc.wire } });
            }

            var chaseMap = PopEnv("VANDE_POP_CHASE_MAP", string.Empty);
            if (chaseMap.Length > 0)
            {
                // Only the named cases, each with the verdict named for it (a result moment is the deciding ball's).
                var chased = new List<PopCase>();
                foreach (var pair in chaseMap.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var parts = pair.Split(':');
                    var found = list.FirstOrDefault(c => c.Id == parts[0]);
                    if (found == null || parts.Length < 2) continue;
                    chased.Add(new PopCase { Id = found.Id + "+" + parts[1], Kind = found.Kind, Item = found.Item, Leave = found.Leave, Chase = parts[1] });
                }

                return chased;
            }

            return list;
        }

        private static string PopKey(string id, string hand, bool director, int late) =>
            id + "|" + hand + "|" + (director ? "on" : "off") + "|" + late.ToString(CultureInfo.InvariantCulture);

        /// <summary>
        /// Applies the world seams named in VANDE_POP_SEAMS (`name=legacy,...`) so a before/after scan runs from one tree. Every seam is an internal
        /// property of the world whose default is the new behaviour; "legacy" switches it to the old one. Unknown names fail loudly.
        /// </summary>
        private static void PopApplySeams(ProceduralPracticeWorld world)
        {
            var text = Environment.GetEnvironmentVariable("VANDE_POP_SEAMS");
            if (string.IsNullOrEmpty(text)) return;
            foreach (var pair in text.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = pair.Split('=');
                var legacy = parts.Length > 1 && parts[1] == "legacy";
                switch (parts[0])
                {
                    case "ThrowReach":
                        world.ThrowReachEnabled = !legacy;
                        break;
                    case "ThrowReachFollowsThrough":
                        world.ThrowReachFollowsThrough = !legacy;
                        break;
                    case "DirectorHeadWorldCap":
                        world.DirectorHeadWorldCapEnabled = !legacy;
                        break;
                    case "IdleHandOverBat":
                        world.IdleHandOverMovesBat = !legacy;
                        break;
                    case "LateResultSettle":
                        world.LateResultSettleEnabled = !legacy;
                        break;
                    case "LateSettleBatRestore":
                        world.LateSettleBatRestore = !legacy;
                        break;
                    case "LateSettleCarry":
                        world.LateSettleCarry = !legacy;
                        break;
                    case "LateSettleRecovery":
                        world.LateSettleRecovery = !legacy;
                        break;
                    case "BowlerHeadingFollower":
                        world.BowlerHeadingFollowerEnabled = !legacy;
                        break;
                    case "MomentPlacedPose":
                        world.ResultMomentPlacedPose = !legacy;
                        break;
                    case "MomentBat":
                        world.ResultMomentBatFromKeys = parts.Length > 1 && parts[1] == "keys";
                        break;
                    case "MomentReach":
                        world.ResultMomentReachFraction = parts.Length > 1 && !legacy ? float.Parse(parts[1], CultureInfo.InvariantCulture) : 0f;
                        break;
                    case "ThrowReachStablePole":
                        world.ThrowReachStablePole = !legacy;
                        break;
                    default:
                        throw new InvalidOperationException("Unknown VANDE_POP_SEAMS entry: " + pair);
                }
            }
        }

        private static PopRun PopPlay(PopCase pc, string hand, bool director, int late, double commitDelay, Action<DirWorld, PopRun> onEnd = null, Action<DirWorld, PopRun, int> onFrame = null)
        {
            var run = new PopRun { Key = PopKey(pc.Id, hand, director, late), Case = pc.Id, Hand = hand, Director = director, Late = late, Kind = pc.Kind };
            using (var w = new DirWorld(pc.Item, hand, director, PopReduced()))
            {
                if (pc.Leave) PopMakeLeave(w.Result);
                if (pc.Chase != null)
                {
                    // "none" is the control: the same ball, the same long window, no verdict on it.
                    if (pc.Chase != "none") PopMakeChase(w.Result, pc.Chase);
                    // the dismissal the verdict would carry (bowled, caught, caught_behind, lbw), for the control as well
                    var dismissal = PopEnv("VANDE_POP_DISMISSAL", string.Empty);
                    if (dismissal.Length > 0) w.Result.Dismissal = dismissal;
                    run.WindowTo = double.Parse(PopEnv("VANDE_POP_TAIL", "10"), CultureInfo.InvariantCulture);
                }

                PopApplySeams(w.World);
                var flightEnd = w.Delivery.Flight != null && w.Delivery.Flight.Length > 0 ? w.Delivery.Flight[w.Delivery.Flight.Length - 1].t : 0.0;
                var swingStart = pc.Leave ? 0.15 : (w.Result.SwingStartT ?? 0.15);
                run.SwingStart = swingStart;
                var bat = w.Result.Trace != null ? w.Result.Trace.bat : null;
                run.StrokeEndT = (bat != null && bat.Length > 0 ? bat[bat.Length - 1].t : swingStart + 0.8) + ProceduralPracticeWorld.FollowThroughHoldSeconds;
                Action tick = () =>
                {
                    w.World.Tick(DirStep);
                    run.Pose[0].Add(DirPose(w.Bowler));
                    run.Pose[1].Add(DirPose(w.Striker));
                    run.State.Add(w.World.StateForEvidence);
                    run.Timeline.Add(w.World.TimelineForEvidence);
                    float glove = 0f;
                    if (w.Striker.VisibleHeroSkeletonActive && w.Striker.Bat != null && !w.Striker.BatterOneHandCarry)
                        glove = Math.Max(Vector3.Distance(w.Striker.HeroHandWorldPosition(true), w.Striker.HeroBatterGripTargetWorld(true)),
                            Vector3.Distance(w.Striker.HeroHandWorldPosition(false), w.Striker.HeroBatterGripTargetWorld(false)));
                    run.Glove.Add(glove);
                    run.WristL.Add(PopWristSwing(w.Striker, true));
                    run.WristR.Add(PopWristSwing(w.Striker, false));
                    var index = run.State.Count - 1;
                    if (onFrame != null) onFrame(w, run, index);
                    if (run.ReleaseFrame < 0 && run.BeginFrame >= 0 && w.World.TimelineForEvidence >= -1e-9) run.ReleaseFrame = index;
                    if (run.AcceptFrame >= 0 && run.IdleAgainFrame < 0 && run.State[index] == "Idle") run.IdleAgainFrame = index;
                };
                for (var k = 0; k < PopIdleFrames; k++) tick();
                w.World.BeginDelivery(w.Delivery);
                run.BeginFrame = run.State.Count;
                while (w.World.TimelineForEvidence < swingStart - 1e-9) tick();
                if (!pc.Leave)
                {
                    w.World.BeginLocalPreparation();
                    run.PressFrame = run.State.Count;
                }

                var committed = false;
                var accepted = false;
                var countdown = late;
                var commitAt = swingStart + commitDelay;
                for (var guard = 0; guard < 1500; guard++)
                {
                    if (!pc.Leave && !committed && w.World.TimelineForEvidence >= commitAt - 1e-9)
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
                        run.CommitFrame = run.State.Count;
                    }

                    var ready = pc.Leave ? w.World.TimelineForEvidence >= flightEnd - 1e-9 : committed;
                    if (!accepted && ready)
                    {
                        if (countdown <= 0)
                        {
                            w.World.AcceptResult(w.Result);
                            accepted = true;
                            run.AcceptFrame = run.State.Count;
                        }
                        else countdown--;
                    }

                    tick();
                    if (accepted && run.ReleaseFrame >= 0 && run.State.Count > run.ReleaseFrame + (int)(run.WindowTo * 60.0) + 12 &&
                        (run.IdleAgainFrame >= 0 && run.State.Count > run.IdleAgainFrame + 30 || run.State.Count > run.ReleaseFrame + (int)(run.WindowTo * 60.0) + 900)) break;
                }

                if (onEnd != null) onEnd(w, run);
            }

            return run;
        }

        private static string PopBone(int joint) => ((ProductionCharacterJoint)joint).ToString();

        private static string PopWindow(PopRun run, int frame)
        {
            if (run.ReleaseFrame < 0) return "?";
            if (run.BeginFrame >= 0 && frame >= run.BeginFrame && frame <= run.BeginFrame + 1) return "switch";
            var t = (frame - run.ReleaseFrame) / 60.0;
            if (t < PopWindowFrom) return "lead";
            return t > run.WindowTo ? "tail" : "scan";
        }

        private static void PopAdd(List<PopHit> hits, PopRun run, string role, string kind, string bone, int frame, double size, string unit, double reference, double xcap)
        {
            var strikerRole = role == "striker";
            hits.Add(new PopHit
            {
                Run = run,
                Role = role,
                Kind = kind,
                Bone = bone,
                Frame = frame,
                State = run.State[frame],
                Window = PopWindow(run, frame),
                TRelMs = (frame - run.ReleaseFrame) * 1000.0 / 60.0,
                FromAccept = run.AcceptFrame >= 0 ? frame - run.AcceptFrame : int.MinValue,
                InStroke = strikerRole && run.PressFrame >= 0 && frame >= run.PressFrame && run.Timeline[frame] <= run.StrokeEndT &&
                           (run.State[frame] == "Flight" || run.State[frame] == "Resolved"),
                Size = size,
                Unit = unit,
                Reference = reference,
                XCap = xcap
            });
        }

        /// <summary>Per bone and per frame: the local rotation step (degrees) against the previous frame.</summary>
        private static float[][] PopSteps(PopRun run, int role)
        {
            var count = (int)ProductionCharacterJoint.Count;
            var n = run.Pose[role].Count;
            var steps = new float[count][];
            for (var j = 0; j < count; j++)
            {
                steps[j] = new float[n];
                var previous = PopLocal(run.Pose[role][0], j);
                for (var i = 1; i < n; i++)
                {
                    var current = PopLocal(run.Pose[role][i], j);
                    steps[j][i] = Quaternion.Angle(previous, current);
                    previous = current;
                }
            }

            return steps;
        }

        private static double PopQuietReference(float[] steps, int i)
        {
            var neighbours = new List<float>(4);
            foreach (var d in new[] { -2, -1, 1, 2 })
            {
                var k = i + d;
                if (k >= 1 && k < steps.Length) neighbours.Add(steps[k]);
            }

            if (neighbours.Count == 0) return 0.0;
            neighbours.Sort();
            return neighbours[Math.Min(1, neighbours.Count - 1)];
        }

        /// <summary>The wrist's bend of a striker hand against the forearm (degrees, the section 9 "wrist swing"), read back from the visible hero.</summary>
        private static float PopWristSwing(ProductionCharacterRig rig, bool left)
        {
            var skeleton = rig.VisibleHeroSkeleton;
            if (skeleton == null) return 0f;
            double swing, twist;
            SwingTwist(ProductionHeroArm.Read(skeleton, left).Hand, out swing, out twist);
            return (float)swing;
        }

        /// <summary>Consecutive frames over a threshold become one hit: its peak frame and size, and its length.</summary>
        private static void PopEpisodes(List<PopHit> hits, PopRun run, string role, string kind, string bone, int from, int to, Func<int, double> value, double threshold,
            string unit, double cap, Func<int, bool> skip = null)
        {
            var i = from;
            while (i <= to)
            {
                if (value(i) < threshold) { i++; continue; }
                var first = i;
                var peak = i;
                var skipIt = false;
                while (i <= to && value(i) >= threshold)
                {
                    if (value(i) > value(peak)) peak = i;
                    if (skip != null && skip(i)) skipIt = true;
                    i++;
                }

                if (!skipIt)
                {
                    PopAdd(hits, run, role, kind, bone, peak, value(peak), unit, 0.0, value(peak) / cap);
                    hits[hits.Count - 1].Length = i - first;
                }
            }
        }

        private static void PopDetect(PopRun run, List<PopHit> hits)
        {
            var roles = new[] { "bowler", "striker" };
            var from = Math.Max(1, run.BeginFrame);
            var to = run.State.Count - 1;
            for (var role = 0; role < 2; role++)
            {
                var steps = PopSteps(run, role);
                for (var j = 0; j < steps.Length; j++)
                {
                    var floor = PopFloorDeg(j);
                    var cap = PopCapDegPerFrame(j);
                    var flagged = new bool[steps[j].Length];
                    for (var i = from; i <= to; i++)
                    {
                        var s = steps[j][i];
                        if (s >= PopHugeDeg)
                        {
                            PopAdd(hits, run, roles[role], "HUGE", PopBone(j), i, s, "deg", PopQuietReference(steps[j], i), s / cap);
                            flagged[i] = true;
                        }
                        else if (s >= floor)
                        {
                            var reference = PopQuietReference(steps[j], i);
                            if (s >= PopSpikeRatio * reference)
                            {
                                PopAdd(hits, run, roles[role], "SPIKE", PopBone(j), i, s, "deg", reference, s / cap);
                                flagged[i] = true;
                            }
                        }
                    }

                    var local = steps[j];
                    PopEpisodes(hits, run, roles[role], "FAST", PopBone(j), from, to, i => local[i] / cap, PopFastRatio, "xcap", 1.0, i => flagged[i]);
                }

                // the hips joint and the actor root: the change of the per-frame displacement
                foreach (var kind in new[] { "HIPSJUMP", "ROOTJUMP" })
                {
                    var which = kind;
                    var r = role;
                    Func<int, Vector3> at = i => which == "HIPSJUMP" ? PopHips(run.Pose[r][i]) : PopRoot(run.Pose[r][i]);
                    for (var i = Math.Max(2, from); i <= to; i++)
                    {
                        var d0 = at(i - 1) - at(i - 2);
                        var d1 = at(i) - at(i - 1);
                        var jump = (d1 - d0).magnitude;
                        if (jump > PopJumpMetres) PopAdd(hits, run, roles[role], kind, kind == "HIPSJUMP" ? "Hips" : "Root", i, jump * 100.0, "cm", d0.magnitude * 100.0, jump / PopJumpMetres);
                    }
                }

                // the head in the world
                var head = (int)ProductionCharacterJoint.Head;
                var rr = role;
                PopEpisodes(hits, run, roles[role], "HEADWORLD", "Head", from, to,
                    i => Quaternion.Angle(DirRot(run.Pose[rr][i - 1], head), DirRot(run.Pose[rr][i], head)) * 60.0, PopHeadWorldDegPerSecond, "deg/s", PopHeadWorldDegPerSecond);
            }

            PopEpisodes(hits, run, "striker", "GLOVE", "Gloves", from, to, i => run.Glove[i] * 100.0, PopGloveMetres * 100.0, "cm", PopGloveMetres * 100.0);
            PopEpisodes(hits, run, "striker", "WRIST", "HandLeft", from, to, i => run.WristL[i], PopWristSwingDeg, "deg", PopWristSwingDeg);
            PopEpisodes(hits, run, "striker", "WRIST", "HandRight", from, to, i => run.WristR[i], PopWristSwingDeg, "deg", PopWristSwingDeg);
        }

        /// <summary>
        /// Long-format per-run measures of the scan window (release -2 s .. +4.5 s, the first two delivery frames left out): per role the largest local step of every bone
        /// (deg, with its time against the release and the world state), the largest hips displacement jump (cm), the head's largest world speed (deg/s) and, for the striker,
        /// the largest glove gap (cm) and the frames with the wrist bent past 85 deg. Rows: case, hand, director, late, role, metric, value, tRelMs, state.
        /// </summary>
        private static void PopStats(PopRun run, StringBuilder sb)
        {
            var roles = new[] { "bowler", "striker" };
            var from = Math.Max(Math.Max(2, run.BeginFrame + 2), run.ReleaseFrame + (int)(PopWindowFrom * 60.0));
            var to = Math.Min(run.State.Count - 1, run.ReleaseFrame + (int)(run.WindowTo * 60.0));
            Action<string, string, string, double, int> row = (role, metric, unit, value, frame) =>
                sb.Append(run.Case).Append('\t').Append(run.Hand).Append('\t').Append(run.Director ? "on" : "off").Append('\t').Append(run.Late).Append('\t').Append(role).Append('\t')
                    .Append(metric).Append('\t').Append(F(value)).Append('\t').Append(unit).Append('\t').Append(frame < 0 ? "" : F((frame - run.ReleaseFrame) * 1000.0 / 60.0)).Append('\t')
                    .Append(frame < 0 ? "" : run.State[frame]).Append('\n');
            for (var role = 0; role < 2; role++)
            {
                var steps = PopSteps(run, role);
                for (var j = 0; j < steps.Length; j++)
                {
                    var best = 0.0;
                    var at = -1;
                    for (var i = from; i <= to; i++)
                        if (steps[j][i] > best) { best = steps[j][i]; at = i; }
                    row(roles[role], "step." + PopBone(j), "deg", best, at);
                }

                var r = role;
                var jump = 0.0;
                var jumpAt = -1;
                var rootJump = 0.0;
                var rootAt = -1;
                for (var i = Math.Max(2, from); i <= to; i++)
                {
                    var d0 = PopHips(run.Pose[r][i - 1]) - PopHips(run.Pose[r][i - 2]);
                    var d1 = PopHips(run.Pose[r][i]) - PopHips(run.Pose[r][i - 1]);
                    var m = (d1 - d0).magnitude * 100.0;
                    if (m > jump) { jump = m; jumpAt = i; }
                    var e0 = PopRoot(run.Pose[r][i - 1]) - PopRoot(run.Pose[r][i - 2]);
                    var e1 = PopRoot(run.Pose[r][i]) - PopRoot(run.Pose[r][i - 1]);
                    var n = (e1 - e0).magnitude * 100.0;
                    if (n > rootJump) { rootJump = n; rootAt = i; }
                }

                row(roles[role], "hipsJump", "cm", jump, jumpAt);
                row(roles[role], "rootJump", "cm", rootJump, rootAt);
                var head = (int)ProductionCharacterJoint.Head;
                var speed = 0.0;
                var speedAt = -1;
                for (var i = from; i <= to; i++)
                {
                    var v = Quaternion.Angle(DirRot(run.Pose[r][i - 1], head), DirRot(run.Pose[r][i], head)) * 60.0;
                    if (v > speed) { speed = v; speedAt = i; }
                }

                row(roles[role], "headWorld", "deg/s", speed, speedAt);
            }

            var glove = 0.0;
            var gloveAt = -1;
            var wrist = 0;
            for (var i = from; i <= to; i++)
            {
                if (run.Glove[i] * 100.0 > glove) { glove = run.Glove[i] * 100.0; gloveAt = i; }
                if (run.WristL[i] > PopWristSwingDeg) wrist++;
                if (run.WristR[i] > PopWristSwingDeg) wrist++;
            }

            row("striker", "gloveGap", "cm", glove, gloveAt);
            row("striker", "wristFramesOver85", "frames", wrist, -1);
        }

        private static string PopRow(PopHit h) => string.Join("\t", new[]
        {
            h.Run.Case, h.Run.Hand, h.Run.Director ? "on" : "off", h.Run.Late.ToString(CultureInfo.InvariantCulture), h.Role, h.Kind, h.Bone,
            h.Frame.ToString(CultureInfo.InvariantCulture), F(h.TRelMs), h.FromAccept == int.MinValue ? "" : h.FromAccept.ToString(CultureInfo.InvariantCulture),
            F(h.Size), h.Unit, F(h.Reference), F(h.XCap), h.Length.ToString(CultureInfo.InvariantCulture), h.State, h.Window, h.InStroke ? "stroke" : "-", h.Run.Kind
        });

        private const string PopHeader = "case\thand\tdirector\tlate\trole\tkind\tbone\tframe\ttRelMs\tframesFromAccept\tsize\tunit\tquietRef\txcap\tlength\tstate\twindow\tstroke\tcaseKind";

        private static void PopDump(PopRun run, string output)
        {
            var path = Path.Combine(output, "dump-" + run.Key.Replace('|', '_') + ".tsv");
            var sb = new StringBuilder();
            sb.Append("frame\ttRelMs\tstate\ttimeline\tglove_cm");
            foreach (var role in new[] { "bowler", "striker" })
            {
                for (var j = 0; j < (int)ProductionCharacterJoint.Count; j++) sb.Append('\t').Append(role).Append('.').Append(PopBone(j));
                sb.Append('\t').Append(role).Append(".hips_x\t").Append(role).Append(".hips_y\t").Append(role).Append(".hips_z\t").Append(role).Append(".root_x\t").Append(role).Append(".root_z\t").Append(role).Append(".headWorld");
            }

            sb.Append('\n');
            var steps = new[] { PopSteps(run, 0), PopSteps(run, 1) };
            for (var i = 1; i < run.State.Count; i++)
            {
                sb.Append(i).Append('\t').Append(F((i - run.ReleaseFrame) * 1000.0 / 60.0)).Append('\t').Append(run.State[i]).Append('\t').Append(F(run.Timeline[i])).Append('\t').Append(F(run.Glove[i] * 100.0));
                for (var role = 0; role < 2; role++)
                {
                    for (var j = 0; j < (int)ProductionCharacterJoint.Count; j++) sb.Append('\t').Append(F(steps[role][j][i]));
                    var hips = PopHips(run.Pose[role][i]);
                    var root = PopRoot(run.Pose[role][i]);
                    var head = (int)ProductionCharacterJoint.Head;
                    sb.Append('\t').Append(F(hips.x)).Append('\t').Append(F(hips.y)).Append('\t').Append(F(hips.z)).Append('\t').Append(F(root.x)).Append('\t').Append(F(root.z))
                        .Append('\t').Append(F(Quaternion.Angle(DirRot(run.Pose[role][i - 1], head), DirRot(run.Pose[role][i], head)) * 60.0));
                }

                sb.Append('\n');
            }

            File.WriteAllText(path, sb.ToString());
        }

        public static void PopScan()
        {
            PopVenue();
            var output = DirOut();
            var hands = PopList("VANDE_POP_HANDS", "right,left");
            var directors = PopList("VANDE_POP_DIRECTOR", "on,off").Select(v => v == "on").ToArray();
            var lates = PopList("VANDE_POP_LATE", "0,6,10,14,30,60").Select(v => int.Parse(v, CultureInfo.InvariantCulture)).ToArray();
            var commit = double.Parse(PopEnv("VANDE_POP_COMMIT", "0.05"), CultureInfo.InvariantCulture);
            var dump = string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VANDE_POP_DUMP")) ? null : new Regex(Environment.GetEnvironmentVariable("VANDE_POP_DUMP"));
            var cases = PopCases();
            var started = DateTime.UtcNow;
            var pops = new StringBuilder(PopHeader).Append('\n');
            var runsTsv = new StringBuilder("case\thand\tdirector\tlate\tcaseKind\tframes\tbeginFrame\tpressFrame\tcommitFrame\tacceptFrame\treleaseFrame\tidleAgainFrame\tacceptAfterReleaseMs\tpops\n");
            var statsTsv = new StringBuilder("case\thand\tdirector\tlate\trole\tmetric\tvalue\tunit\ttRelMs\tstate\n");
            var summary = new StringBuilder();
            summary.Append("UNITY-9 pop scan (Unity Editor, production world, 60 Hz steps, builder evidence; no human result, no device).\n");
            summary.Append("build ").Append(PopEnv("VANDE_BUILD_ID", "(see timing.txt)")).Append("; ").Append(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)).Append("; uptime ").Append(DirUptime()).Append('\n');
            summary.Append("definition: SPIKE step >= min(25 deg, cap/frame) and >= 3 x quiet neighbours; HUGE >= 60 deg; HIPSJUMP/ROOTJUMP change of displacement > 5 cm; HEADWORLD > 720 deg/s; GLOVE > 2 cm. window scan = release -2 s .. +4.5 s.\n");
            summary.Append("seams: ").Append(PopEnv("VANDE_POP_SEAMS", "(none: the default behaviour)")).Append("\n\n");
            summary.Append("run key | frames | accept after release (ms) | pops by role/kind in the scan window (bowler B / striker S)\n");
            var runCount = 0;
            var stills = PopList("VANDE_POP_STILLS", string.Empty);
            foreach (var pc in cases)
                foreach (var hand in hands)
                    foreach (var director in directors)
                        foreach (var late in lates)
                        {
                            try
                            {
                                var run = PopPlay(pc, hand, director, late, commit);
                                var hits = new List<PopHit>();
                                PopDetect(run, hits);
                                PopStats(run, statsTsv);
                                foreach (var h in hits) pops.Append(PopRow(h)).Append('\n');
                                var inWindow = hits.Where(h => h.Window == "scan").ToList();
                                var counts = string.Join(" ", inWindow.GroupBy(h => h.Role[0] + ":" + h.Kind).OrderBy(g => g.Key).Select(g => g.Key + "=" + g.Count()));
                                summary.Append(run.Key).Append(" | ").Append(run.State.Count).Append(" | ")
                                    .Append(F((run.AcceptFrame - run.ReleaseFrame) * 1000.0 / 60.0)).Append(" | ").Append(counts).Append('\n');
                                runsTsv.Append(string.Join("\t", new[]
                                {
                                    run.Case, run.Hand, director ? "on" : "off", late.ToString(CultureInfo.InvariantCulture), run.Kind, run.State.Count.ToString(CultureInfo.InvariantCulture),
                                    run.BeginFrame.ToString(CultureInfo.InvariantCulture), run.PressFrame.ToString(CultureInfo.InvariantCulture), run.CommitFrame.ToString(CultureInfo.InvariantCulture),
                                    run.AcceptFrame.ToString(CultureInfo.InvariantCulture), run.ReleaseFrame.ToString(CultureInfo.InvariantCulture), run.IdleAgainFrame.ToString(CultureInfo.InvariantCulture),
                                    F((run.AcceptFrame - run.ReleaseFrame) * 1000.0 / 60.0), hits.Count.ToString(CultureInfo.InvariantCulture)
                                })).Append('\n');
                                if (dump != null && dump.IsMatch(run.Key)) PopDump(run, output);
                                runCount++;
                            }
                            catch (Exception error)
                            {
                                UnityEngine.Debug.LogError("VANDE_POP_FAILED " + PopKey(pc.Id, hand, director, late) + ": " + error);
                                summary.Append(PopKey(pc.Id, hand, director, late)).Append(" | FAILED ").Append(error.Message.Replace('\n', ' ')).Append('\n');
                            }
                        }

            File.WriteAllText(Path.Combine(output, "pops.tsv"), pops.ToString());
            File.WriteAllText(Path.Combine(output, "runs.tsv"), runsTsv.ToString());
            File.WriteAllText(Path.Combine(output, "runstats.tsv"), statsTsv.ToString());
            summary.Append("\nruns ").Append(runCount).Append(" in ").Append(F((DateTime.UtcNow - started).TotalSeconds)).Append(" s\n");
            File.WriteAllText(Path.Combine(output, "scan-summary.txt"), summary.ToString());
            UnityEngine.Debug.Log("VANDE pop scan: " + runCount + " runs in " + F((DateTime.UtcNow - started).TotalSeconds) + " s");
            if (stills.Length > 0) UnityEngine.Debug.Log("VANDE_POP_STILLS is handled by PopStills");
        }

        /// <summary>
        /// Builder diagnostic: the bowler's planned moves (the fielding track) for one case and what the track says at the instants VANDE_POP_TRACK_AT (ms against the release,
        /// comma list): move index, clip, clip time, crossfade weight and source. Writes pop-track-{case}.txt. Env: VANDE_POP_CASES (one id), VANDE_POP_HANDS, VANDE_POP_LATE.
        /// </summary>
        public static void PopTrack()
        {
            var output = DirOut();
            var hand = PopList("VANDE_POP_HANDS", "right")[0];
            var late = int.Parse(PopList("VANDE_POP_LATE", "6")[0], CultureInfo.InvariantCulture);
            var at = PopList("VANDE_POP_TRACK_AT", "3500,3516,3533").Select(v => double.Parse(v, CultureInfo.InvariantCulture)).ToArray();
            var role = PopEnv("VANDE_POP_TRACK_ROLE", "bowler");
            foreach (var pc in PopCases())
            {
                var sb = new StringBuilder();
                PopPlay(pc, hand, false, late, 0.05, (w, run) =>
                {
                    var track = w.World.FieldingTrackForRoleForEvidence(role);
                    sb.Append("case ").Append(pc.Id).Append(' ').Append(hand).Append(" late ").Append(late).Append(" role ").Append(role).Append(" accept at ").Append(F((run.AcceptFrame - run.ReleaseFrame) * 1000.0 / 60.0)).Append(" ms\n");
                    if (track == null) { sb.Append("(no track)\n"); return; }
                    var index = 0;
                    foreach (var m in track.Moves)
                    {
                        sb.Append(index++).Append(": t ").Append(F(m.T0)).Append("..").Append(F(m.T1)).Append(' ').Append(m.Clip).Append(" clipStart ").Append(F(m.ClipStart)).Append(" rate ").Append(F(m.Rate))
                            .Append(m.HasLower ? " lower " + m.Lower + " lowerStart " + F(m.LowerStart) : "").Append(" heading ").Append(F(m.Heading * 57.29578)).Append("->").Append(F(m.HeadingTo * 57.29578))
                            .Append(" blend ").Append(F(m.BlendSeconds)).Append(" from ").Append(m.BlendFrom).Append(" blendStart ").Append(F(m.BlendStart))
                            .Append(" pos (").Append(F(m.From.x)).Append(',').Append(F(m.From.z)).Append(")->(").Append(F(m.To.x)).Append(',').Append(F(m.To.z)).Append(")\n");
                    }

                    foreach (var ms in at)
                    {
                        var state = track.Evaluate(ms / 1000.0);
                        sb.Append("at ").Append(F(ms)).Append(" ms: move ").Append(state.MoveIndex).Append(' ').Append(state.Clip).Append(" clipTime ").Append(F(state.ClipTime)).Append(" weight ").Append(F(state.Weight))
                            .Append(state.HasPrevious ? " previous " + state.PreviousClip + " (move " + state.PreviousIndex + ")" : "").Append(" heading ").Append(F(state.Heading * 57.29578)).Append('\n');
                    }
                });
                File.WriteAllText(Path.Combine(output, "pop-track-" + pc.Id + "-" + role + ".txt"), sb.ToString());
            }
        }

        /// <summary>
        /// Builder diagnostic: one actor's driver joints (what the rig was given: local rotations) against the visible hero's (what is drawn), per frame in a window, to tell a clip or planner
        /// jump from a hero synchronisation or arm solve. Env: VANDE_POP_CASES (one id), VANDE_POP_HANDS, VANDE_POP_LATE, VANDE_POP_DIRECTOR, VANDE_POP_TRACK_ROLE, VANDE_POP_FROM_MS, VANDE_POP_TO_MS,
        /// VANDE_POP_JOINTS (comma list of joint names). Writes pop-drivers-{case}-{role}.tsv: frame, tRel, state, then per joint the driver step, the visible step and the driver's local euler.
        /// </summary>
        public static void PopDrivers()
        {
            var output = DirOut();
            var hand = PopList("VANDE_POP_HANDS", "right")[0];
            var late = int.Parse(PopList("VANDE_POP_LATE", "6")[0], CultureInfo.InvariantCulture);
            var director = PopList("VANDE_POP_DIRECTOR", "off")[0] == "on";
            var role = PopEnv("VANDE_POP_TRACK_ROLE", "bowler");
            var fromMs = double.Parse(PopEnv("VANDE_POP_FROM_MS", "3300"), CultureInfo.InvariantCulture);
            var toMs = double.Parse(PopEnv("VANDE_POP_TO_MS", "3700"), CultureInfo.InvariantCulture);
            var names = PopList("VANDE_POP_JOINTS", "UpperArmLeft,ForearmLeft,HandLeft,Hips,Chest").Select(n => (ProductionCharacterJoint)Enum.Parse(typeof(ProductionCharacterJoint), n)).ToArray();
            foreach (var pc in PopCases())
            {
                var sb = new StringBuilder("frame\ttRelMs\tstate\ttimeline\tbatStepCm\tbatTurnDeg\tgloveCm");
                var previousBat = Vector3.zero;
                var previousBatRotation = Quaternion.identity;
                foreach (var j in names) sb.Append('\t').Append(j).Append(".driverStep\t").Append(j).Append(".visibleStep\t").Append(j).Append(".driverEuler\t").Append(j).Append(".visibleLocalEuler");
                sb.Append('\n');
                var previousDriver = new Quaternion[names.Length];
                var previousVisible = new Quaternion[names.Length];
                var have = false;
                PopPlay(pc, hand, director, late, 0.05, null, (w, run, index) =>
                {
                    var rig = role == "bowler" ? w.Bowler : w.Striker;
                    var t = run.ReleaseFrame < 0 ? double.NaN : (index - run.ReleaseFrame) * 1000.0 / 60.0;
                    var driver = new Quaternion[names.Length];
                    var visible = new Quaternion[names.Length];
                    for (var k = 0; k < names.Length; k++)
                    {
                        driver[k] = rig.Joint(names[k]).localRotation;
                        var parent = PopParent[(int)names[k]];
                        visible[k] = parent < 0 ? rig.VisibleJointWorldRotation(names[k])
                            : Quaternion.Inverse(rig.VisibleJointWorldRotation((ProductionCharacterJoint)parent)) * rig.VisibleJointWorldRotation(names[k]);
                    }

                    if (have && !double.IsNaN(t) && t >= fromMs && t <= toMs)
                    {
                        sb.Append(index).Append('\t').Append(F(t)).Append('\t').Append(run.State[index]).Append('\t').Append(F(run.Timeline[index]))
                            .Append('\t').Append(rig.Bat != null ? F(Vector3.Distance(previousBat, rig.Bat.position) * 100f) : "").Append('\t').Append(rig.Bat != null ? F(Quaternion.Angle(previousBatRotation, rig.Bat.rotation)) : "")
                            .Append('\t').Append(F(run.Glove[index] * 100f));
                        for (var k = 0; k < names.Length; k++)
                            sb.Append('\t').Append(F(Quaternion.Angle(previousDriver[k], driver[k]))).Append('\t').Append(F(Quaternion.Angle(previousVisible[k], visible[k])))
                                .Append('\t').Append(PopEuler(driver[k])).Append('\t').Append(PopEuler(visible[k]));
                        sb.Append('\n');
                    }

                    previousDriver = driver;
                    previousVisible = visible;
                    if (rig.Bat != null) { previousBat = rig.Bat.position; previousBatRotation = rig.Bat.rotation; }
                    have = true;
                });
                File.WriteAllText(Path.Combine(output, "pop-drivers-" + pc.Id + "-" + role + ".tsv"), sb.ToString());
            }
        }

        private static string PopEuler(Quaternion q)
        {
            var e = q.eulerAngles;
            Func<float, float> wrap = a => a > 180f ? a - 360f : a;
            return F(wrap(e.x)) + "," + F(wrap(e.y)) + "," + F(wrap(e.z));
        }

        /// <summary>
        /// Builder diagnostic: the fielding clips themselves, sampled at 60 Hz of clip time (rate 1) and at VANDE_POP_CLIP_RATE (a planner rate, default 1.186): the largest local step of
        /// every bone (deg per frame), with the clip time and the bone, for every clip of the library. Writes pop-clips.txt.
        /// </summary>
        public static void PopClips()
        {
            var output = DirOut();
            var rate = double.Parse(PopEnv("VANDE_POP_CLIP_RATE", "1.186"), CultureInfo.InvariantCulture);
            var sb = new StringBuilder("clip | pack | duration | rate | worst bone steps (deg/frame): bone@clipTime=step ...\n");
            var pose = new ProductionCharacterPose();
            var pose2 = new ProductionCharacterPose();
            foreach (ProductionFieldingClip clip in Enum.GetValues(typeof(ProductionFieldingClip)))
            {
                var duration = ProductionFieldingClips.Duration(clip);
                foreach (var r in new[] { 1.0, rate })
                {
                    var worst = new List<KeyValuePair<double, string>>();
                    var step = r / 60.0;
                    ProductionFieldingClips.Sample(clip, 0.0, pose);
                    for (var t = step; t <= duration + 1e-9; t += step)
                    {
                        ProductionFieldingClips.Sample(clip, t, pose2);
                        for (var j = 0; j < (int)ProductionCharacterJoint.Count; j++)
                        {
                            var a = Quaternion.Angle(pose.Rotations[j], pose2.Rotations[j]);
                            if (a > 8.0) worst.Add(new KeyValuePair<double, string>(a, ((ProductionCharacterJoint)j) + "@" + F(t) + "=" + F(a)));
                        }

                        var tmp = pose; pose = pose2; pose2 = tmp;
                    }

                    worst.Sort((x, y) => y.Key.CompareTo(x.Key));
                    sb.Append(clip).Append(" | ").Append(ProductionFieldingClips.FromPack(clip) ? "pack" : "code").Append(" | ").Append(F(duration)).Append(" | ").Append(F(r)).Append(" | ")
                        .Append(string.Join(" ", worst.Take(8).Select(x => x.Value))).Append('\n');
                }
            }

            File.WriteAllText(Path.Combine(output, "pop-clips.txt"), sb.ToString());
        }

        /// <summary>
        /// Builder evidence: stills of one actor through one ball from a camera that is fixed in the WORLD (it follows the actor's position, never his heading, so a turn shows as a turn).
        /// Env: VANDE_POP_CASES (one id), VANDE_POP_HANDS, VANDE_POP_LATE, VANDE_POP_DIRECTOR, VANDE_POP_SEAMS (the before/after switch), VANDE_POP_TRACK_ROLE (bowler|striker),
        /// VANDE_POP_STILL_MS (comma list of times against the release, ms), VANDE_POP_STILL_OFFSET (x,y,z metres of the camera from the actor's root, default 3.2,2.2,-1.0),
        /// VANDE_POP_STILL_FOCUS (height of the look-at point, default 0.95), VANDE_POP_STILL_FOV (default 38), VANDE_POP_STILL_SIZE (WxH, default 480x640).
        /// Writes still-{case}-{hand}-{role}-{ms}.png.
        /// </summary>
        public static void PopStills()
        {
            PopVenue();
            var output = DirOut();
            var hand = PopList("VANDE_POP_HANDS", "right")[0];
            var late = int.Parse(PopList("VANDE_POP_LATE", "6")[0], CultureInfo.InvariantCulture);
            var director = PopList("VANDE_POP_DIRECTOR", "off")[0] == "on";
            var role = PopEnv("VANDE_POP_TRACK_ROLE", "bowler");
            var wanted = PopList("VANDE_POP_STILL_MS", "1000,1067,1117,1167,1217,1267").Select(v => double.Parse(v, CultureInfo.InvariantCulture)).ToArray();
            var offsetParts = PopList("VANDE_POP_STILL_OFFSET", "3.2,2.2,-1.0").Select(v => float.Parse(v, CultureInfo.InvariantCulture)).ToArray();
            var focusHeight = float.Parse(PopEnv("VANDE_POP_STILL_FOCUS", "0.95"), CultureInfo.InvariantCulture);
            var fov = float.Parse(PopEnv("VANDE_POP_STILL_FOV", "38"), CultureInfo.InvariantCulture);
            var size = PopEnv("VANDE_POP_STILL_SIZE", "480x640").Split('x').Select(int.Parse).ToArray();
            var tag = PopEnv("VANDE_POP_STILL_TAG", "");
            foreach (var pc in PopCases())
            {
                var written = new HashSet<int>();
                PopPlay(pc, hand, director, late, 0.05, null, (w, run, index) =>
                {
                    if (run.ReleaseFrame < 0) return;
                    var ms = (index - run.ReleaseFrame) * 1000.0 / 60.0;
                    foreach (var target in wanted)
                    {
                        var frame = run.ReleaseFrame + (int)Math.Round(target * 60.0 / 1000.0);
                        if (index != frame || !written.Add(frame)) continue;
                        var rig = role == "bowler" ? w.Bowler : w.Striker;
                        foreach (var skinned in rig.Root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                        {
                            skinned.updateWhenOffscreen = true;
                            skinned.forceMatrixRecalculationPerRender = true;
                        }

                        var template = w.World.BatterCameraForEvidence;
                        var cameraObject = new GameObject("VANDE pop still camera");
                        try
                        {
                            cameraObject.transform.SetParent(template.transform.parent, true);
                            var camera = cameraObject.AddComponent<Camera>();
                            camera.CopyFrom(template);
                            camera.enabled = false;
                            camera.fieldOfView = fov;
                            camera.nearClipPlane = 0.1f;
                            camera.farClipPlane = 400f;
                            var rootPosition = rig.Root.position;
                            var position = rootPosition + new Vector3(offsetParts[0], offsetParts[1], offsetParts[2]);
                            camera.transform.SetPositionAndRotation(position, Quaternion.LookRotation(rootPosition + Vector3.up * focusHeight - position, Vector3.up));
                            RenderPng(camera, size[0], size[1], Path.Combine(output, "still-" + pc.Id + "-" + hand + "-" + role + tag + "-" + ((int)Math.Round(ms)).ToString("D5", CultureInfo.InvariantCulture) + ".png"));
                        }
                        finally
                        {
                            UnityEngine.Object.DestroyImmediate(cameraObject);
                        }
                    }
                });
            }
        }

        private static string DirUptime()
        {
            try
            {
                var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/usr/bin/uptime") { RedirectStandardOutput = true, UseShellExecute = false });
                return p.StandardOutput.ReadToEnd().Trim();
            }
            catch (Exception)
            {
                return "(uptime unavailable)";
            }
        }
    }
}
