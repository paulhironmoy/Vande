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
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// UNITY-8: the governed-stride probe (builder observation only; no player, no device). Plays a corpus of deliveries the
    /// physics pads govern (yorkers, low full tosses, pad and body hits: scratch generator S/humans/unity8/gen/corpus.mjs, the
    /// golden fixture's wire schema plus classification fields) through the production world at 60 Hz, one striker run per
    /// (case, hand, mode), and writes governed.json and governed-table.txt to VANDE_EVIDENCE_OUT.
    /// Modes: replay (the result accepted 0.10 s after the release, as the humans evidence) and live (the press at the swing start,
    /// the commitment VANDE_GOV_COMMIT s later, the result VANDE_GOV_ACCEPT frames after that; the host's start time, the press).
    /// Env: VANDE_GOV_CORPUS (path, required), VANDE_GOV_CASES (regex on the case id), VANDE_GOV_HANDS (right,left),
    /// VANDE_GOV_MODES (replay,live), VANDE_GOV_STILLS (regex: those cases are photographed, right hand, replay),
    /// VANDE_GOV_DUMP=1 (per-frame csv), VANDE_GOVERNED_PACK=legacy (the code-authored stride, the pre-UNITY-8 drawing).
    /// </summary>
    public static partial class VandeHumansEvidence
    {
        [Serializable]
        private sealed class GovernedCase
        {
            public string id;
            public string kind;
            public string shape;
            public int offsetMs;
            public string footwork;
            public string family;
            public string clip;
            public string contact;
            public string mustPlantNode;
            public bool pad;
            public bool body;
            public double windowMs;
            public double minMs;
            public string dismissal;
            public double swingStartT;
            public GoldenWire wire;
        }

        [Serializable]
        private sealed class GovernedCorpus
        {
            public GovernedCase[] cases;
        }

        private sealed class GovernedRun
        {
            public readonly List<StrikerFrame> Frames = new List<StrikerFrame>();
            public readonly List<Vector3> BallUnity = new List<Vector3>();
            public readonly List<Vector3> PadFront = new List<Vector3>();
            public readonly List<Vector3> PadBack = new List<Vector3>();
            public readonly List<Vector3> KneeL = new List<Vector3>();
            public readonly List<Vector3> KneeR = new List<Vector3>();
            public readonly List<string> States = new List<string>();
            public readonly HumanTrack Track = new HumanTrack();
            public bool Governed;
            public bool PackValid;
            public string PackClip;
            public double PackPlantMarker, PackPlantWindow, InputT, DueT, PlantT;
            public int AcceptFrame = -1;
            public int AcceptIndex = -1;
            public int GovernorEngagements;
            public float ReachLeanCm;
            public double PackEndT, EarlyRecoveryT;
            public bool EarlyBegun;
            public PracticeResultPresentation Result;
            public double SwingStart;
            public float Mirror;
        }

        private static string GovEnv(string name, string fallback) => Environment.GetEnvironmentVariable(name) ?? fallback;

        public static void GovernedStrideProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var corpusPath = Environment.GetEnvironmentVariable("VANDE_GOV_CORPUS");
            if (string.IsNullOrEmpty(corpusPath)) throw new InvalidOperationException("Set VANDE_GOV_CORPUS.");
            var corpus = JsonUtility.FromJson<GovernedCorpus>(File.ReadAllText(corpusPath));
            var filter = new Regex(GovEnv("VANDE_GOV_CASES", ".*"));
            var hands = GovEnv("VANDE_GOV_HANDS", "right,left").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var modes = GovEnv("VANDE_GOV_MODES", "replay,live").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var commitDelay = double.Parse(GovEnv("VANDE_GOV_COMMIT", "0.05"), CultureInfo.InvariantCulture);
            var acceptFrames = int.Parse(GovEnv("VANDE_GOV_ACCEPT", "8"), CultureInfo.InvariantCulture);
            var stills = string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VANDE_GOV_STILLS"))
                ? null
                : new Regex(Environment.GetEnvironmentVariable("VANDE_GOV_STILLS"));
            var dump = Environment.GetEnvironmentVariable("VANDE_GOV_DUMP") == "1";
            var started = DateTime.UtcNow;
            var rows = new List<string>();
            var table = new List<string>
            {
                "case | hand | mode | governed | pack clip | W/P ms | window ms | slide cm (delivery/stroke) | worst bone x cap (joint) | chest x | hips x | spine x | arms x | legs x | hands mm | foot-to-pad cm | pad gap cm | ball-to-shin cm | digest",
            };
            foreach (var gc in corpus.cases)
            {
                if (!filter.IsMatch(gc.id)) continue;
                foreach (var hand in hands)
                foreach (var mode in modes)
                {
                    try
                    {
                        var photograph = stills != null && stills.IsMatch(gc.id) && hand == "right" && mode == "replay";
                        var run = PlayGoverned(gc, hand, mode, commitDelay, acceptFrames, photograph, output);
                        rows.Add(GovernedRow(gc, hand, mode, run, table, dump, output));
                    }
                    catch (Exception error)
                    {
                        Debug.LogError("VANDE_GOVERNED_FAILED " + gc.id + " " + hand + " " + mode + ": " + error);
                        rows.Add("{\"case\":\"" + gc.id + "\",\"hand\":\"" + hand + "\",\"mode\":\"" + mode + "\",\"error\":\"" + error.Message.Replace('"', '\'').Replace('\n', ' ') + "\"}");
                    }
                }
            }
            File.WriteAllText(Path.Combine(output, "governed.json"),
                "{\"corpus\":\"" + Path.GetFileName(corpusPath) + "\",\"commitDelayS\":" + F(commitDelay) + ",\"acceptFrames\":" + acceptFrames +
                ",\"seam\":\"" + (Environment.GetEnvironmentVariable("VANDE_GOVERNED_PACK") ?? "new") + "\",\"seconds\":" + F((DateTime.UtcNow - started).TotalSeconds) +
                ",\"rows\":[" + string.Join(",", rows) + "]}");
            File.WriteAllLines(Path.Combine(output, "governed-table.txt"), table);
            Debug.Log("VANDE governed stride probe: " + rows.Count + " runs in " + F((DateTime.UtcNow - started).TotalSeconds) + " s");
        }

        private static GovernedRun PlayGoverned(GovernedCase gc, string hand, string mode, double commitDelay, int acceptFrames,
            bool photograph, string output)
        {
            // "live:N" is a live stroke whose result arrives N frames after the commitment.
            if (mode.StartsWith("live:", StringComparison.Ordinal))
            {
                acceptFrames = int.Parse(mode.Substring(5), CultureInfo.InvariantCulture);
                mode = "live";
            }
            var item = new GoldenCase { id = gc.id, wire = gc.wire };
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            var run = new GovernedRun();
            GameObject root;
            var world = OpenTouchdownWorld(item, hand, 0.0, null, out root);
            var completed = false;
            world.DeliveryCompleted += (_, __) => completed = true;
            var mirror = ProceduralPracticeWorld.WorldReflectionFor(hand);
            try
            {
                var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                var swingStart = result.SwingStartT ?? 0.15;
                var live = mode == "live";
                var committed = false;
                var accepted = false;
                var localPrepared = false;
                var countdown = acceptFrames;
                var frames = 0;
                var maxFrames = (int)((-world.TimelineForEvidence + result.Trace.durationSeconds + 8.0) / Step);
                var photographed = new HashSet<string>();
                while (!completed && frames < maxFrames)
                {
                    var t0 = world.TimelineForEvidence;
                    if (live)
                    {
                        if (!localPrepared && t0 >= swingStart - 1e-9)
                        {
                            world.BeginLocalPreparation();
                            localPrepared = true;
                        }
                        if (!committed && localPrepared && t0 >= swingStart + commitDelay - 1e-9)
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
                        if (committed && !accepted)
                        {
                            if (countdown == 0)
                            {
                                world.AcceptResult(result);
                                accepted = true;
                                run.AcceptFrame = frames;
                                run.AcceptIndex = run.Frames.Count;
                            }
                            else countdown--;
                        }
                    }
                    else if (!accepted && t0 >= AcceptAfterRelease)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                        run.AcceptFrame = frames;
                    }
                    world.Tick(Step);
                    frames++;
                    var t = world.TimelineForEvidence;
                    var capturing = t >= swingStart - 0.4;
                    run.Track.Record(striker, frames * Step, t, world.StateForEvidence, !world.StrikerRunningForTesting);
                    if (capturing)
                    {
                        run.Frames.Add(CaptureStriker(striker, t));
                        var front = Vector3.zero;
                        var back = Vector3.zero;
                        world.StrikerPadsForEvidence(out front, out back);
                        run.PadFront.Add(front);
                        run.PadBack.Add(back);
                        run.KneeL.Add(striker.VisibleJointWorldPosition(ProductionCharacterJoint.ShinLeft));
                        run.KneeR.Add(striker.VisibleJointWorldPosition(ProductionCharacterJoint.ShinRight));
                        run.States.Add(world.StateForEvidence);
                        var b = BallPhysicsUnity(result.Trace.ball, t, mirror);
                        run.BallUnity.Add(b);
                        if (photograph && accepted) Photograph(world, striker, gc, hand, mode, t, run, photographed, output);
                    }
                }
                run.Governed = world.StrikerStrideGovernedForEvidence;
                string clip;
                double startT, marker, window;
                run.PackValid = world.PackStrokeForEvidence(out clip, out startT, out marker, out window);
                run.PackClip = clip;
                run.PackPlantMarker = marker;
                run.PackPlantWindow = window;
                world.StrikerStrideTimesForEvidence(out run.InputT, out run.DueT, out run.PlantT);
                world.StrokeEndTimesForEvidence(out run.PackEndT, out run.EarlyRecoveryT, out run.EarlyBegun);
                run.GovernorEngagements = striker.TorsoGovernorEngagementsForEvidence;
                run.ReachLeanCm = world.StrikerReachLeanForEvidence * 100f;
                // The result must also be in the run (the trace for the pad events).
                run.Result = result;
                run.SwingStart = swingStart;
                run.Mirror = mirror;
                return run;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static Vector3 BallPhysicsUnity(BallTraceSample[] samples, double t, float mirror)
        {
            if (samples == null || samples.Length == 0) return Vector3.zero;
            TraceVector3 p;
            if (t <= samples[0].t) p = samples[0].p;
            else if (t >= samples[samples.Length - 1].t) p = samples[samples.Length - 1].p;
            else
            {
                var lo = 0;
                var hi = samples.Length - 1;
                while (hi - lo > 1)
                {
                    var mid = (lo + hi) / 2;
                    if (samples[mid].t <= t) lo = mid;
                    else hi = mid;
                }
                var span = samples[hi].t - samples[lo].t;
                var g = span > 0.0 ? (t - samples[lo].t) / span : 0.0;
                var a = samples[lo].p;
                var c = samples[hi].p;
                p = new TraceVector3 { x = a.x + (c.x - a.x) * g, y = a.y + (c.y - a.y) * g, z = a.z + (c.z - a.z) * g };
            }
            return new Vector3(mirror * (float)p.x, (float)p.y, (float)p.z);
        }

        /// <summary>The instants a governed case is photographed at (seconds from the input), once each.</summary>
        private static readonly double[] GovernedStillOffsets = { 0.06, 0.12, 0.18, 0.24, 0.30, 0.40, 0.55 };

        private static void Photograph(ProceduralPracticeWorld world, ProductionCharacterRig striker, GovernedCase gc, string hand,
            string mode, double t, GovernedRun run, HashSet<string> done, string output)
        {
            double input, due, plant;
            world.StrikerStrideTimesForEvidence(out input, out due, out plant);
            if (double.IsInfinity(input)) return;
            foreach (var offset in GovernedStillOffsets)
            {
                var key = offset.ToString("0.00", CultureInfo.InvariantCulture);
                if (done.Contains(key) || t < input + offset - 1e-9) continue;
                done.Add(key);
                var directory = Path.Combine(output, "stills");
                Directory.CreateDirectory(directory);
                foreach (var view in new[] { "rear", "front", "side" })
                    RenderStill(world.BatterCameraForEvidence, striker, view,
                        Path.Combine(directory, gc.id + "-" + hand + "-" + mode + "-in+" + key + "-" + view + ".png"));
            }
        }

        private static string GovernedRow(GovernedCase gc, string hand, string mode, GovernedRun run, List<string> table, bool dump, string output)
        {
            var frames = run.Frames;
            // Section 9 angular speed against each bone's cap, frame to frame, from the input on (the stance before it is not the stroke).
            var groups = new Dictionary<string, double>
            {
                { "chest", 0 }, { "hips", 0 }, { "spine", 0 }, { "arms", 0 }, { "legs", 0 }, { "neckhead", 0 }
            };
            double worst = 0.0, worstAt = 0.0;
            var worstJoint = "";
            var inputT = run.InputT;
            // Every recorded frame is one 60 Hz tick after the one before it (the simulation clock itself stalls at the trace's end).
            var windowEnd = run.DueT + StrokeWindowAfterDueSeconds;
            for (var i = 1; i < frames.Count; i++)
            {
                if (frames[i].T < inputT - 1e-9 || frames[i].T > windowEnd) continue;
                var dt = Step;
                for (var j = 0; j < PopJoints.Length; j++)
                {
                    var joint = PopJoints[j];
                    var ratio = Quaternion.Angle(frames[i - 1].Visible[j], frames[i].Visible[j]) / dt / AngularCap(joint);
                    if (ratio > worst) { worst = ratio; worstJoint = joint.ToString(); worstAt = frames[i].T; }
                    string group;
                    switch (joint)
                    {
                        case ProductionCharacterJoint.Chest: group = "chest"; break;
                        case ProductionCharacterJoint.Hips: group = "hips"; break;
                        case ProductionCharacterJoint.Spine: group = "spine"; break;
                        case ProductionCharacterJoint.Neck:
                        case ProductionCharacterJoint.Head: group = "neckhead"; break;
                        case ProductionCharacterJoint.UpperArmLeft:
                        case ProductionCharacterJoint.UpperArmRight:
                        case ProductionCharacterJoint.ForearmLeft:
                        case ProductionCharacterJoint.ForearmRight: group = "arms"; break;
                        default: group = "legs"; break;
                    }
                    if (ratio > groups[group]) groups[group] = ratio;
                }
            }

            // The largest one-frame step of the hips, the feet, the palms and the bat (cm) in the stroke window, and where it was.
            double hipsStepCm = 0.0, footStepCm = 0.0, batStepCm = 0.0;
            var hipsStepState = "";
            double hipsStepT = 0.0;
            for (var i = 1; i < frames.Count; i++)
            {
                if (frames[i].T < inputT - 1e-9 || frames[i].T > windowEnd) continue;
                var hips = Vector3.Distance(frames[i].Hips, frames[i - 1].Hips) * 100.0;
                if (hips > hipsStepCm) { hipsStepCm = hips; hipsStepT = frames[i].T; hipsStepState = run.States[i]; }
                footStepCm = Math.Max(footStepCm, Math.Max(Vector3.Distance(frames[i].FootL, frames[i - 1].FootL), Vector3.Distance(frames[i].FootR, frames[i - 1].FootR)) * 100.0);
                batStepCm = Math.Max(batStepCm, Math.Max(Vector3.Distance(frames[i].BatCap, frames[i - 1].BatCap), Vector3.Distance(frames[i].BatToe, frames[i - 1].BatToe)) * 100.0);
            }

            // The drawn feet against the pads they are planted on, in the 0.2 s after the later of the plant and the due.
            double footToPadCm = 0.0;
            var plantFrom = Math.Max(run.PlantT, run.DueT) + 1.0 / 60.0;
            var plantEnd = plantFrom + 0.2;
            for (var i = 0; i < frames.Count; i++)
            {
                var t = frames[i].T;
                if (!run.Governed || t < plantFrom || t > plantEnd) continue;
                var a = Horizontal(frames[i].FootL - run.PadFront[i]) + Horizontal(frames[i].FootR - run.PadBack[i]);
                var b = Horizontal(frames[i].FootL - run.PadBack[i]) + Horizontal(frames[i].FootR - run.PadFront[i]);
                var matched = a <= b
                    ? Math.Max(Horizontal(frames[i].FootL - run.PadFront[i]), Horizontal(frames[i].FootR - run.PadBack[i]))
                    : Math.Max(Horizontal(frames[i].FootL - run.PadBack[i]), Horizontal(frames[i].FootR - run.PadFront[i]));
                footToPadCm = Math.Max(footToPadCm, matched * 100.0);
            }

            // The pad gap: at the physics pad contact (else at the ball's nearest pass to the pads) the drawn shin's axis at the ball's
            // height against the physics pad's axis (horizontal, cm); and the ball's nearest pass to either drawn lower leg's axis.
            double padEventT = double.NaN;
            if (run.Result.Trace.events != null)
                foreach (var ev in run.Result.Trace.events)
                    if (ev != null && ev.kind == "pad") { padEventT = ev.t; break; }
            var gapCm = double.NaN;
            var gapAt = double.NaN;
            var minShinM = double.MaxValue;
            double minShinAt = double.NaN;
            double nearestPassT = double.NaN, nearestPass = double.MaxValue;
            for (var i = 0; i < frames.Count; i++)
            {
                var t = frames[i].T;
                if (t < inputT - 1e-9 || t > run.DueT + 0.6) continue;
                var ball = run.BallUnity[i];
                // The nearest pad to the ball (horizontal), and the physics gap from its axis.
                var toFront = Horizontal(ball - run.PadFront[i]);
                var toBack = Horizontal(ball - run.PadBack[i]);
                var near = Math.Min(toFront, toBack);
                if (ball.y < 0.7f && near < nearestPass) { nearestPass = near; nearestPassT = t; }
                // Drawn lower legs: ankle (foot) to knee (shin joint).
                var shinL = SegmentDistanceToBall(ball, frames[i].FootL, run.KneeL[i]);
                var shinR = SegmentDistanceToBall(ball, frames[i].FootR, run.KneeR[i]);
                var shin = Math.Min(shinL, shinR);
                if (ball.y < 0.7f && shin < minShinM) { minShinM = shin; minShinAt = t; }
            }
            var eventT = !double.IsNaN(padEventT) ? padEventT : nearestPassT;
            if (!double.IsNaN(eventT))
            {
                // Over +-2 frames of the event, the largest gap of the pad the ball is nearest to.
                for (var i = 0; i < frames.Count; i++)
                {
                    if (Math.Abs(frames[i].T - eventT) > 2.5 / 60.0) continue;
                    var ball = run.BallUnity[i];
                    var useFront = Horizontal(ball - run.PadFront[i]) <= Horizontal(ball - run.PadBack[i]);
                    var pad = useFront ? run.PadFront[i] : run.PadBack[i];
                    // The drawn leg standing on that pad: the foot (L or R) nearer to its ground point.
                    var leftNearer = Horizontal(frames[i].FootL - pad) <= Horizontal(frames[i].FootR - pad);
                    var ankle = leftNearer ? frames[i].FootL : frames[i].FootR;
                    var knee = leftNearer ? run.KneeL[i] : run.KneeR[i];
                    var u = Mathf.Clamp((ball.y - ankle.y) / Mathf.Max(1e-3f, knee.y - ankle.y), 0f, 1.4f);
                    var axis = ankle + (knee - ankle) * u;
                    var gap = Horizontal(new Vector3(axis.x - pad.x, 0f, axis.z - pad.z)) * 100.0;
                    if (double.IsNaN(gapCm) || gap > gapCm) { gapCm = gap; gapAt = frames[i].T; }
                }
            }

            // The live accept (the result arriving after the commitment): the steps at that frame and the six after it.
            double acceptForearmDeg = double.NaN, acceptBoneVsCap = double.NaN, acceptArmsVsCap = double.NaN, acceptChestVsCap = double.NaN;
            double acceptHipsCm = double.NaN, acceptFootCm = double.NaN, acceptPalmCm = double.NaN, acceptBatCm = double.NaN, acceptGloveMm = double.NaN;
            if (run.AcceptIndex >= 1 && run.AcceptIndex < frames.Count)
            {
                acceptForearmDeg = acceptBoneVsCap = acceptArmsVsCap = acceptChestVsCap = 0.0;
                acceptHipsCm = acceptFootCm = acceptPalmCm = acceptBatCm = acceptGloveMm = 0.0;
                var last = Math.Min(frames.Count - 1, run.AcceptIndex + 6);
                for (var i = run.AcceptIndex; i <= last; i++)
                {
                    for (var j = 0; j < PopJoints.Length; j++)
                    {
                        var joint = PopJoints[j];
                        var deg = Quaternion.Angle(frames[i - 1].Visible[j], frames[i].Visible[j]);
                        var ratio = deg / Step / AngularCap(joint);
                        acceptBoneVsCap = Math.Max(acceptBoneVsCap, ratio);
                        if (joint == ProductionCharacterJoint.Chest) acceptChestVsCap = Math.Max(acceptChestVsCap, ratio);
                        if (joint == ProductionCharacterJoint.UpperArmLeft || joint == ProductionCharacterJoint.UpperArmRight ||
                            joint == ProductionCharacterJoint.ForearmLeft || joint == ProductionCharacterJoint.ForearmRight)
                            acceptArmsVsCap = Math.Max(acceptArmsVsCap, ratio);
                        if (joint == ProductionCharacterJoint.ForearmLeft || joint == ProductionCharacterJoint.ForearmRight)
                            acceptForearmDeg = Math.Max(acceptForearmDeg, deg);
                    }
                    acceptHipsCm = Math.Max(acceptHipsCm, Vector3.Distance(frames[i].Hips, frames[i - 1].Hips) * 100.0);
                    acceptFootCm = Math.Max(acceptFootCm, Math.Max(Vector3.Distance(frames[i].FootL, frames[i - 1].FootL), Vector3.Distance(frames[i].FootR, frames[i - 1].FootR)) * 100.0);
                    acceptPalmCm = Math.Max(acceptPalmCm, Math.Max(Vector3.Distance(frames[i].PalmL, frames[i - 1].PalmL), Vector3.Distance(frames[i].PalmR, frames[i - 1].PalmR)) * 100.0);
                    acceptBatCm = Math.Max(acceptBatCm, Math.Max(Vector3.Distance(frames[i].BatCap, frames[i - 1].BatCap), Vector3.Distance(frames[i].BatToe, frames[i - 1].BatToe)) * 100.0);
                    acceptGloveMm = Math.Max(acceptGloveMm, Math.Max(frames[i].GloveOffLeft, frames[i].GloveOffRight) * 1000.0);
                }
            }

            // A digest of the striker's drawn frames (every visible joint, feet, palms, bat) for the A/B equality of the fallback cases.
            string digest;
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                var bytes = new List<byte>();
                foreach (var f in frames)
                {
                    foreach (var q in f.Visible) foreach (var c in new[] { q.x, q.y, q.z, q.w }) bytes.AddRange(BitConverter.GetBytes(c));
                    foreach (var v in new[] { f.FootL, f.FootR, f.PalmL, f.PalmR, f.BatCap, f.BatToe, f.Hips }) foreach (var c in new[] { v.x, v.y, v.z }) bytes.AddRange(BitConverter.GetBytes(c));
                }
                digest = BitConverter.ToString(sha.ComputeHash(bytes.ToArray())).Replace("-", string.Empty).Substring(0, 12).ToLowerInvariant();
            }

            // The same digest over the frames before the player's input only: the striker before the input must be the same drawing
            // whatever the stroke or the stride (nothing moves before the input, nothing leads it).
            string preDigest;
            var preFrames = 0;
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                var bytes = new List<byte>();
                foreach (var f in frames)
                {
                    if (f.T >= inputT - 1e-9) break;
                    preFrames++;
                    foreach (var q in f.Visible) foreach (var c in new[] { q.x, q.y, q.z, q.w }) bytes.AddRange(BitConverter.GetBytes(c));
                    foreach (var v in new[] { f.FootL, f.FootR, f.PalmL, f.PalmR, f.BatCap, f.BatToe, f.Hips }) foreach (var c in new[] { v.x, v.y, v.z }) bytes.AddRange(BitConverter.GetBytes(c));
                }
                preDigest = BitConverter.ToString(sha.ComputeHash(bytes.ToArray())).Replace("-", string.Empty).Substring(0, 12).ToLowerInvariant();
            }

            var summary = run.Track.Summary();
            double slide = ExtractNumber(summary, "maxPlantedFootSlideCm");
            double slideAt = ExtractNumber(summary, "maxSlideAtT");
            // The gloves against their grip targets on the bat, over the stroke (from the input until StrokeWindowAfterDueSeconds past the due).
            double handsMm = 0.0;
            for (var i = 0; i < frames.Count; i++)
                if (frames[i].T >= inputT - 1e-9 && frames[i].T <= windowEnd)
                    handsMm = Math.Max(handsMm, Math.Max(frames[i].GloveOffLeft, frames[i].GloveOffRight) * 1000.0);
            double strokeSlide = StrokeWindowSlide(frames, inputT, windowEnd);
            double rootStep = ExtractNumber(summary, "maxRootSpeedStepMpsPerFrame");
            var windowMs = (run.DueT - run.InputT) * 1000.0;
            var wms = run.PackPlantWindow > 0.0 ? F(run.PackPlantWindow * 1000.0) + "/" + F(run.PackPlantMarker * 1000.0) : "-";
            table.Add(string.Join(" | ", new[]
            {
                gc.id, hand, mode, run.Governed ? "yes" : "no", run.PackValid ? run.PackClip : "-", wms, F(Math.Round(windowMs, 1)),
                F(Math.Round(slide, 3)) + "/" + F(Math.Round(strokeSlide, 3)), F(Math.Round(worst, 2)) + " (" + worstJoint + ")",
                F(Math.Round(groups["chest"], 2)), F(Math.Round(groups["hips"], 2)), F(Math.Round(groups["spine"], 2)),
                F(Math.Round(groups["arms"], 2)), F(Math.Round(groups["legs"], 2)), F(Math.Round(handsMm, 4)),
                F(Math.Round(footToPadCm, 2)), double.IsNaN(gapCm) ? "-" : F(Math.Round(gapCm, 2)),
                minShinM == double.MaxValue ? "-" : F(Math.Round(minShinM * 100.0, 1)), digest
            }));
            if (dump)
            {
                var lines = new List<string> { "t,state,gloveLmm,gloveRmm,hipsX,hipsY,hipsZ,footLX,footLY,footLZ,footRX,footRY,footRZ,padFX,padFZ,padBX,padBZ,ballX,ballY,ballZ,capX,capY,capZ,toeX,toeY,toeZ" };
                for (var i = 0; i < frames.Count; i++)
                {
                    var f = frames[i];
                    lines.Add(string.Join(",", new[]
                    {
                        F(f.T), run.States[i], F(f.GloveOffLeft * 1000.0), F(f.GloveOffRight * 1000.0), F(f.Hips.x), F(f.Hips.y), F(f.Hips.z), F(f.FootL.x), F(f.FootL.y), F(f.FootL.z), F(f.FootR.x), F(f.FootR.y), F(f.FootR.z),
                        F(run.PadFront[i].x), F(run.PadFront[i].z), F(run.PadBack[i].x), F(run.PadBack[i].z),
                        F(run.BallUnity[i].x), F(run.BallUnity[i].y), F(run.BallUnity[i].z), F(f.BatCap.x), F(f.BatCap.y), F(f.BatCap.z), F(f.BatToe.x), F(f.BatToe.y), F(f.BatToe.z)
                    }));
                }
                File.WriteAllLines(Path.Combine(output, "frames-" + gc.id + "-" + hand + "-" + mode + ".csv"), lines);
            }

            return "{\"case\":\"" + gc.id + "\",\"hand\":\"" + hand + "\",\"mode\":\"" + mode + "\",\"kind\":\"" + gc.kind + "\",\"shape\":\"" + gc.shape +
                   "\",\"offsetMs\":" + gc.offsetMs + ",\"footwork\":\"" + gc.footwork + "\",\"family\":\"" + gc.family + "\",\"contact\":\"" + gc.contact +
                   "\",\"padEvent\":" + (gc.pad ? "true" : "false") + ",\"bodyEvent\":" + (gc.body ? "true" : "false") + ",\"dismissal\":\"" + gc.dismissal +
                   "\",\"governed\":" + (run.Governed ? "true" : "false") + ",\"packValid\":" + (run.PackValid ? "true" : "false") +
                   ",\"packClip\":\"" + run.PackClip + "\",\"plantMarkerMs\":" + F(run.PackPlantMarker * 1000.0) + ",\"plantWindowMs\":" + F(run.PackPlantWindow * 1000.0) +
                   ",\"packEndT\":" + F(run.PackEndT) + ",\"earlyRecoveryT\":" + F(run.EarlyRecoveryT) + ",\"inputT\":" + F(run.InputT) + ",\"dueT\":" + F(run.DueT) + ",\"plantT\":" + F(run.PlantT) + ",\"windowMs\":" + F(windowMs) +
                   ",\"acceptFrame\":" + run.AcceptFrame + ",\"slideCm\":" + F(slide) + ",\"slideAtT\":" + F(slideAt) + ",\"hipsStepMaxCm\":" + F(hipsStepCm) + ",\"hipsStepAtT\":" + F(hipsStepT) + ",\"hipsStepState\":\"" + hipsStepState + "\",\"footStepMaxCm\":" + F(footStepCm) + ",\"batStepMaxCm\":" + F(batStepCm) + ",\"accept\":{\"forearmDeg\":" + F(acceptForearmDeg) + ",\"boneVsCap\":" + F(acceptBoneVsCap) + ",\"armsVsCap\":" + F(acceptArmsVsCap) +
                   ",\"chestVsCap\":" + F(acceptChestVsCap) + ",\"hipsCm\":" + F(acceptHipsCm) + ",\"footCm\":" + F(acceptFootCm) + ",\"palmCm\":" + F(acceptPalmCm) +
                   ",\"batCm\":" + F(acceptBatCm) + ",\"gloveMm\":" + F(acceptGloveMm) + "},\"strokeSlideCm\":" + F(strokeSlide) + ",\"handsMaxMm\":" + F(handsMm) +
                   ",\"rootSpeedStep\":" + F(rootStep) + ",\"worstBoneVsCap\":" + F(worst) + ",\"worstBone\":\"" + worstJoint + "\",\"worstBoneAtT\":" + F(worstAt) +
                   ",\"chestVsCap\":" + F(groups["chest"]) + ",\"hipsVsCap\":" + F(groups["hips"]) + ",\"spineVsCap\":" + F(groups["spine"]) +
                   ",\"armsVsCap\":" + F(groups["arms"]) + ",\"legsVsCap\":" + F(groups["legs"]) + ",\"neckHeadVsCap\":" + F(groups["neckhead"]) +
                   ",\"footToPadCm\":" + F(footToPadCm) + ",\"padGapCm\":" + F(gapCm) + ",\"padGapAtT\":" + F(gapAt) + ",\"padEventT\":" + F(padEventT) +
                   ",\"nearestPassT\":" + F(nearestPassT) + ",\"ballToShinMinCm\":" + F(minShinM == double.MaxValue ? double.NaN : minShinM * 100.0) +
                   ",\"ballToShinAtT\":" + F(minShinAt) + ",\"governorEngagements\":" + run.GovernorEngagements + ",\"reachLeanCm\":" + F(run.ReachLeanCm) +
                   ",\"preInputFrames\":" + preFrames + ",\"preInputDigest\":\"" + preDigest + "\",\"digest\":\"" + digest + "\",\"striker\":" + summary + "}";
        }

        /// <summary>The stroke window the angular speeds, the gloves and the stroke slide are read over ends this long after the due time (s).</summary>
        private const double StrokeWindowAfterDueSeconds = 1.0;

        /// <summary>HumanTrack's planted-foot slide (a foot within the height band of the lowest, slower than the speed gate; its drift from where the planted run began), over a window of frames.</summary>
        private static double StrokeWindowSlide(List<StrikerFrame> frames, double from, double to)
        {
            var indices = new List<int>();
            for (var i = 0; i < frames.Count; i++)
                if (frames[i].T >= from - 1e-9 && frames[i].T <= to) indices.Add(i);
            if (indices.Count < 2) return 0.0;
            double best = 0.0;
            foreach (var left in new[] { true, false })
            {
                var floor = float.MaxValue;
                foreach (var i in indices) floor = Mathf.Min(floor, left ? frames[i].FootL.y : frames[i].FootR.y);
                var anchor = -1;
                for (var k = 1; k < indices.Count; k++)
                {
                    var a = left ? frames[indices[k - 1]].FootL : frames[indices[k - 1]].FootR;
                    var b = left ? frames[indices[k]].FootL : frames[indices[k]].FootR;
                    var planted = b.y <= floor + PlantedHeightBand && Horizontal(b - a) / Step <= PlantedSpeed;
                    if (!planted) { anchor = -1; continue; }
                    if (anchor < 0) anchor = k;
                    var origin = left ? frames[indices[anchor]].FootL : frames[indices[anchor]].FootR;
                    best = Math.Max(best, Horizontal(b - origin));
                }
            }
            return best * 100.0;
        }

        private static double ExtractNumber(string json, string key)
        {
            var match = Regex.Match(json, "\"" + key + "\":(-?[0-9.eE+-]+)");
            return match.Success ? double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) : double.NaN;
        }
    }
}
