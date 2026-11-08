using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// UNITY-6 (editor only, builder evidence, read-only): what the player sees when the host's result arrives AFTER the contact.
    ///
    /// LateResultProbe plays a golden delivery through the production world exactly as the live flow does (press at the recorded
    /// swing start, commit = ApplyProvisionalSwing 50 or 120 ms later) and accepts the result 6, 10 and 14 frames after the commit
    /// (VANDE_HANDOVER_ACCEPTS overrides the list), recording every 1/60 s around the contact the ball the world draws, the ball
    /// the physics has (the result's trace), the ball the delivery's own flight would have (the pre-contact line), the bat and the
    /// player's camera. It reports where the drawn ball is between the contact and the accept (does it keep the pre-contact line,
    /// and how far past the bat), and the size of the snap at the accept in metres and in frames. Stills at +10 frames: the frame
    /// before the contact, the last frame before the accept, the accept frame.
    /// Output: late-result.txt (the findings), late-result-frames/*.csv (every recorded frame), late-result-stills/*.png.
    /// VANDE_LATE_CASES (default: grounded-attack, thin-edge, defensive-tap, early-attack, complete-miss), VANDE_LATE_STILLS (default
    /// grounded-attack, thin-edge).
    /// </summary>
    public static partial class VandeHumansEvidence
    {
        private sealed class LateFrame
        {
            public double T;
            public bool Accepted;
            public Vector3 Ball;
            public Vector3 Physics;
            public Vector3 Flight;
            public Vector3 Camera;
            public Vector3 BatCap;
            public Vector3 BatToe;
            // UNITY-7 task A: what is on screen of the ball, its readability rings and the inset marker in this frame.
            public bool BallDrawn;
            public bool EmphasisDrawn;
            public bool InsetBallDrawn;
        }

        private static bool InsetBallMarkerActive(ProceduralPracticeWorld world)
        {
            var pip = world.FieldPipForEvidence;
            if (pip == null || pip.Camera == null || pip.Camera.transform.parent == null) return false;
            var marker = pip.Camera.transform.parent.Find("Ball");
            return marker != null && marker.gameObject.activeSelf;
        }

        private static Vector3 TraceBallAt(BallTraceSample[] samples, double t, float mirror)
        {
            var upper = 0;
            while (upper < samples.Length && samples[upper].t < t) upper++;
            TraceVector3 p;
            if (upper == 0) p = samples[0].p;
            else if (upper >= samples.Length) p = samples[samples.Length - 1].p;
            else
            {
                var a = samples[upper - 1];
                var b = samples[upper];
                var u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0.0;
                p = new TraceVector3 { x = a.p.x + (b.p.x - a.p.x) * u, y = a.p.y + (b.p.y - a.p.y) * u, z = a.p.z + (b.p.z - a.p.z) * u };
            }

            return new Vector3(mirror * (float)p.x, (float)p.y, (float)p.z);
        }

        private static string V3(Vector3 v) => F(v.x) + "," + F(v.y) + "," + F(v.z);

        /// <summary>
        /// One deterministic pass of the live flow; with stillIndices it also photographs those frames from the player's camera.
        /// mode "commit": the press at the recorded swing start and the commitment `commitDelay` later (the result is accepted
        /// `acceptFrames` frames after the commitment). "none": nothing is touched; "cancel": a press at the swing start that is
        /// checked back (CancelLocalPreparation) 120 ms later and never commits. For "none" and "cancel" the accept is counted from
        /// the frame the delivery's flight data is used up.
        /// </summary>
        private static List<LateFrame> PlayLatePass(
            GoldenCase item, string mode, double commitDelay, int acceptFrames, PracticeResultPresentation result, PracticeDeliveryPresentation delivery,
            double contactT, IDictionary<int, string> stillIndices, string stillPrefix, out int contactIndex, out int acceptIndex)
        {
            GameObject root;
            var world = OpenTouchdownWorld(item, "right", 0.0, null, out root);
            contactIndex = -1;
            acceptIndex = -1;
            try
            {
                var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                var mirror = -1f; // right-hander: x reflected once
                var swingStart = mode == "commit" ? result.SwingStartT ?? 0.15 : delivery.IdealContactT - 0.14;
                var flightEnd = delivery.Flight[delivery.Flight.Length - 1].t;
                // A press that comes after the ball has already reached the bat (a late swing) is made inside the recorded frames, so the
                // frames around the ball's arrival are recorded too; any other press is made at once, as in UNITY-6's probe.
                var pressInLoop = mode != "none" && swingStart > delivery.IdealContactT - 0.02;
                if (mode == "none" || pressInLoop)
                    world.Tick(Math.Max(0.0, delivery.IdealContactT - 0.3 - world.TimelineForEvidence));
                else
                {
                    world.Tick(Math.Max(0.0, swingStart - world.TimelineForEvidence));
                    world.BeginLocalPreparation();
                }
                var pressed = mode != "none" && !pressInLoop;
                var frames = new List<LateFrame>();
                var committed = false;
                var accepted = false;
                var cancelled = false;
                var commitAt = mode == "commit" ? swingStart + commitDelay : flightEnd;
                var countdown = acceptFrames;
                for (var k = 0; k < 150; k++)
                {
                    if (!pressed && mode != "none" && world.TimelineForEvidence >= swingStart - 1e-9)
                    {
                        world.BeginLocalPreparation();
                        pressed = true;
                    }

                    if (mode == "cancel" && !cancelled && world.TimelineForEvidence >= swingStart + 0.12 - 1e-9)
                    {
                        world.CancelLocalPreparation();
                        cancelled = true;
                    }

                    if (!committed && world.TimelineForEvidence >= commitAt - 1e-9)
                    {
                        if (mode == "commit")
                            world.ApplyProvisionalSwing(new PracticeSwingPresentation
                            {
                                Kind = "attack",
                                StartT = world.Timeline,
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
                            acceptIndex = frames.Count;
                        }
                        else countdown--;
                    }

                    world.Tick(Step);
                    var t = world.TimelineForEvidence;
                    var capture = CaptureStriker(striker, t);
                    var camera = world.BatterCameraForEvidence;
                    var effects = world.DeliveryEffectsForEvidence;
                    frames.Add(new LateFrame
                    {
                        T = t,
                        Accepted = accepted,
                        Ball = world.BallForEvidence != null ? world.BallForEvidence.position : Vector3.zero,
                        Physics = TraceBallAt(result.Trace.ball, t, mirror),
                        Flight = TraceBallAt(delivery.Flight, t, mirror),
                        Camera = camera != null ? camera.transform.position : Vector3.zero,
                        BatCap = capture.BatCap,
                        BatToe = capture.BatToe,
                        BallDrawn = world.BallForEvidence != null && world.BallForEvidence.gameObject.activeSelf,
                        EmphasisDrawn = effects != null && (effects.ReadabilityVisible || effects.FocusVisible),
                        InsetBallDrawn = InsetBallMarkerActive(world)
                    });
                    if (contactIndex < 0 && t >= contactT - 1e-9) contactIndex = frames.Count - 1;
                    string role;
                    if (stillIndices != null && camera != null && stillIndices.TryGetValue(frames.Count - 1, out role))
                        RenderPng(camera, 960, 540, stillPrefix + "-" + role + "-t" + F(t) + ".png");
                    if (accepted && frames.Count > acceptIndex + 12) break;
                }

                return frames;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static float MedianOf(List<float> values)
        {
            if (values.Count == 0) return 0f;
            values.Sort();
            return values[values.Count / 2];
        }

        /// <summary>
        /// UNITY-7 C (editor only, builder evidence): what a LEAVE looks like. The golden complete-miss delivery is played with no
        /// input at all and its result is made a leave (no swing, no bat samples, nominal root: what the host sends for a ball the
        /// player let go) and accepted `VANDE_LEAVE_ACCEPT` frames (default 4) after the delivery's flight data is used up. Every frame
        /// from before the ball arrives to 80 frames after the accept the striker's visible joints are recorded: leave-frames.csv
        /// (the worst bone's turn against its section 9 cap per frame, the torso and head's turn from the frame before the accept),
        /// and stills of the front and rear views at the named instants. Writes leave-look.txt.
        /// </summary>
        public static void LeaveLookProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var acceptAfter = int.Parse(Environment.GetEnvironmentVariable("VANDE_LEAVE_ACCEPT") ?? "4", CultureInfo.InvariantCulture);
            var item = LoadFixture().cases.Single(c => c.id == (Environment.GetEnvironmentVariable("VANDE_LEAVE_CASE") ?? "complete-miss"));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
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
            GameObject root;
            var world = OpenTouchdownWorld(item, "right", 0.0, null, out root);
            var lines = new List<string>
            {
                "UNITY-7 C: what a leave looks like (production world, right-hander, golden " + item.id + " made a leave; no input; the result accepted " + acceptAfter + " frames after the flight data is used up).",
                "uptime: " + System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/usr/bin/uptime") { RedirectStandardOutput = true, UseShellExecute = false }).StandardOutput.ReadToEnd().Trim(),
                "frame k is counted from the accept (k = 0 is the first frame drawn from the accepted result). turn = degrees the joint turned in the frame; xcap = that rate against the section 9 cap."
            };
            try
            {
                var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                var flightEnd = delivery.Flight[delivery.Flight.Length - 1].t;
                world.Tick(Math.Max(0.0, delivery.IdealContactT - 0.6 - world.TimelineForEvidence));
                var frames = new List<StrikerFrame>();
                var acceptIndex = -1;
                var countdown = acceptAfter;
                var passedSeen = false;
                for (var k = 0; k < 400; k++)
                {
                    if (!passedSeen && world.TimelineForEvidence >= flightEnd - 1e-9) passedSeen = true;
                    if (passedSeen && acceptIndex < 0)
                    {
                        if (countdown == 0)
                        {
                            world.AcceptResult(result);
                            acceptIndex = frames.Count;
                        }
                        else countdown--;
                    }

                    world.Tick(Step);
                    frames.Add(CaptureStriker(striker, world.TimelineForEvidence));
                    if (acceptIndex >= 0 && frames.Count > acceptIndex + 80) break;
                }

                if (acceptIndex < 2) throw new InvalidOperationException("The leave was not accepted.");
                var csv = new List<string> { "k,t,worstJoint,worstTurnDeg,worstXCap,chestTurnDeg,headTurnDeg,hipsTurnDeg,batCapStepCm,palmStepCm" };
                var chest = Array.IndexOf(PopJoints, ProductionCharacterJoint.Chest);
                var head = Array.IndexOf(PopJoints, ProductionCharacterJoint.Head);
                var hips = Array.IndexOf(PopJoints, ProductionCharacterJoint.Hips);
                double worstAfterAccept = 0.0;
                for (var i = 1; i < frames.Count; i++)
                {
                    var dt = frames[i].T - frames[i - 1].T;
                    if (dt <= 0.0) continue;
                    var worstRatio = 0.0;
                    var worstName = "";
                    var worstDeg = 0.0;
                    for (var j = 0; j < PopJoints.Length; j++)
                    {
                        var deg = Quaternion.Angle(frames[i - 1].Visible[j], frames[i].Visible[j]);
                        var ratio = deg / dt / AngularCap(PopJoints[j]);
                        if (ratio > worstRatio)
                        {
                            worstRatio = ratio;
                            worstName = PopJoints[j].ToString();
                            worstDeg = deg;
                        }
                    }

                    if (i >= acceptIndex) worstAfterAccept = Math.Max(worstAfterAccept, worstRatio);
                    csv.Add(string.Join(",", new[]
                    {
                        (i - acceptIndex).ToString(CultureInfo.InvariantCulture), F(frames[i].T), worstName, F(worstDeg), F(worstRatio),
                        F(Quaternion.Angle(frames[i - 1].Visible[chest], frames[i].Visible[chest])),
                        F(Quaternion.Angle(frames[i - 1].Visible[head], frames[i].Visible[head])),
                        F(Quaternion.Angle(frames[i - 1].Visible[hips], frames[i].Visible[hips])),
                        F(Vector3.Distance(frames[i - 1].BatCap, frames[i].BatCap) * 100f),
                        F(Math.Max(Vector3.Distance(frames[i - 1].PalmL, frames[i].PalmL), Vector3.Distance(frames[i - 1].PalmR, frames[i].PalmR)) * 100f)
                    }));
                }

                File.WriteAllLines(Path.Combine(output, "leave-frames.csv"), csv);
                lines.Add("worst bone against its cap in any frame from the accept on: " + F(worstAfterAccept) + "x");
                // How far the body has moved from the frame before the accept, per instant (degrees, the shortest turn of the visible joint).
                var reference = frames[acceptIndex - 1];
                foreach (var after in new[] { 0, 3, 6, 10, 20, 40, 80 })
                {
                    var at = Math.Min(frames.Count - 1, acceptIndex + after);
                    Func<int, string> from = index => F(Quaternion.Angle(reference.Visible[index], frames[at].Visible[index]));
                    lines.Add("k=" + after + " (t=" + F(frames[at].T) + "): turned from the frame before the accept: hips " + from(hips) + " chest " + from(chest) + " head " + from(head) +
                              " deg; bat cap moved " + F(Vector3.Distance(reference.BatCap, frames[at].BatCap) * 100f) + " cm; root moved " + F(Vector3.Distance(reference.Root, frames[at].Root) * 100f) + " cm");
                }

                // Stills: the ready hold before the ball arrives, the frame before the accept, and after it.
                var instants = new Dictionary<string, int>
                {
                    { "1-ready-hold", Math.Max(1, acceptIndex - 12) }, { "2-before-accept", acceptIndex - 1 }, { "3-accept-plus-3", acceptIndex + 3 },
                    { "4-accept-plus-10", acceptIndex + 10 }, { "5-accept-plus-20", acceptIndex + 20 }, { "6-accept-plus-40", acceptIndex + 40 }
                };
                // The same pass again (the world is deterministic) with the photographs.
                UnityEngine.Object.DestroyImmediate(root);
                world = OpenTouchdownWorld(item, "right", 0.0, null, out root);
                striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                world.Tick(Math.Max(0.0, delivery.IdealContactT - 0.6 - world.TimelineForEvidence));
                var index2 = 0;
                var accepted = false;
                countdown = acceptAfter;
                passedSeen = false;
                var stillsDirectory = Path.Combine(output, "leave-stills");
                Directory.CreateDirectory(stillsDirectory);
                for (var k = 0; k < 400 && index2 <= acceptIndex + 41; k++)
                {
                    if (!passedSeen && world.TimelineForEvidence >= flightEnd - 1e-9) passedSeen = true;
                    if (passedSeen && !accepted)
                    {
                        if (countdown == 0)
                        {
                            world.AcceptResult(result);
                            accepted = true;
                        }
                        else countdown--;
                    }

                    world.Tick(Step);
                    foreach (var pair in instants)
                        if (pair.Value == index2)
                            foreach (var view in new[] { "front", "rear" })
                                RenderStill(world.BatterCameraForEvidence, striker, view, Path.Combine(stillsDirectory, pair.Key + "-t" + F(world.TimelineForEvidence) + "-" + view + ".png"));
                    index2++;
                }

                lines.Add("stills: leave-stills/ (" + string.Join(", ", instants.Select(pair => pair.Key + " = frame " + (pair.Value - acceptIndex) + " from the accept")) + ")");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            File.WriteAllLines(Path.Combine(output, "leave-look.txt"), lines);
        }

        /// <summary>
        /// UNITY-7 D (editor only, builder evidence): do the striker's and the bowler's props (helmet, pads, gloves, shoes, cap) sit on the
        /// hero they are drawn on? The procedural props are parented to the driver rig's joints; the visible hero has its own skeleton.
        /// For every visible prop renderer: the nearest driver joint J above it, the prop's centre as an offset r in J's frame, and the
        /// gap between where the prop is (J's driver pose carrying r) and where it would be on the hero (the hero bone's pose carrying
        /// the same r). Six instants for each human (the bowler's run-up, gather, release, follow-through and walk back; the striker's
        /// ready hold, backlift, stroke, contact, follow-through and recovery); writes props-gap.txt (VANDE_PROPS_CASE).
        /// </summary>
        public static void PropsGapProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var item = LoadFixture().cases.Single(c => c.id == (Environment.GetEnvironmentVariable("VANDE_PROPS_CASE") ?? "grounded-attack"));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            var lines = new List<string>
            {
                "UNITY-7 D: prop gaps to the hero (golden " + item.id + ", right-hander, production world, the result accepted at the start).",
                "uptime: " + System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/usr/bin/uptime") { RedirectStandardOutput = true, UseShellExecute = false }).StandardOutput.ReadToEnd().Trim(),
                "gap = distance (cm) between the prop's centre on its driver joint and the same offset carried by the hero bone (visible renderers only)."
            };
            // VANDE_PROPS_FLIGHT=<id> (with VANDE_TOUCHDOWN_FLIGHTS=<corpus json>) plays that corpus flight instead (a spin bowler has a cap).
            FlightEntry flight = null;
            var flightId = Environment.GetEnvironmentVariable("VANDE_PROPS_FLIGHT");
            var corpusPath = Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_FLIGHTS");
            if (!string.IsNullOrEmpty(flightId) && !string.IsNullOrEmpty(corpusPath))
            {
                flight = JsonUtility.FromJson<FlightCorpus>(File.ReadAllText(corpusPath)).flights.Single(f => f.id == flightId);
                lines.Add("flight " + flightId + " (" + flight.family + ", " + flight.arm + "-arm)");
            }

            GameObject root;
            var world = OpenTouchdownWorld(item, "right", 0.0, flight, out root);
            try
            {
                var humans = world.PresentedHumansForEvidence();
                if (Environment.GetEnvironmentVariable("VANDE_CAP_FOLLOWS_HERO") == "legacy")
                    foreach (var human in humans) human.Value.CapFollowsHeroEnabled = false;
                var striker = humans.First(pair => pair.Key == "striker").Value;
                var bowler = humans.First(pair => pair.Key.StartsWith("bowler")).Value;
                var joints = Enum.GetValues(typeof(ProductionCharacterJoint)).Cast<ProductionCharacterJoint>().ToArray();
                Func<ProductionCharacterRig, string, Dictionary<string, float[]>> measure = (rig, who) =>
                {
                    var table = new Dictionary<string, float[]>();
                    var byTransform = new Dictionary<Transform, ProductionCharacterJoint>();
                    foreach (var joint in joints)
                    {
                        Transform transform;
                        try { transform = rig.Joint(joint); }
                        catch (ArgumentOutOfRangeException) { continue; }
                        if (transform != null && !byTransform.ContainsKey(transform)) byTransform[transform] = joint;
                    }

                    foreach (var renderer in rig.Root.GetComponentsInChildren<Renderer>(false))
                    {
                        if (!renderer.enabled || !renderer.gameObject.activeInHierarchy || renderer is SkinnedMeshRenderer) continue;
                        var name = renderer.gameObject.name;
                        var prop = name.StartsWith("Helmet") ? "helmet" : name.Contains("Pad") ? "pad" : name.Contains("Glove") ? "glove" :
                            name.StartsWith("Shoe") ? "shoe" : name.Contains("Cap") ? "cap" : null;
                        if (prop == null) continue;
                        Transform walker = renderer.transform;
                        ProductionCharacterJoint joint = default(ProductionCharacterJoint);
                        var found = false;
                        Transform frame = null;
                        while (walker != null && walker != rig.Root)
                        {
                            if (byTransform.TryGetValue(walker, out joint)) { found = true; frame = walker; break; }
                            // UNITY-7 D: the spin bowler's cap hangs from a follower of the hero's head, not from the driver's.
                            if (walker.name == "SpinBowlerCapFollower") { found = true; joint = ProductionCharacterJoint.Head; frame = walker; break; }
                            walker = walker.parent;
                        }

                        if (!found) continue;
                        var driver = frame;
                        var offset = Quaternion.Inverse(driver.rotation) * (renderer.bounds.center - driver.position);
                        var hero = rig.VisibleJointWorldPosition(joint) + rig.VisibleJointWorldRotation(joint) * offset;
                        var gap = Vector3.Distance(renderer.bounds.center, hero) * 100f;
                        float[] cell;
                        if (!table.TryGetValue(who + " " + prop + " (" + joint + ")", out cell)) table[who + " " + prop + " (" + joint + ")"] = cell = new float[] { 0f, 0f };
                        cell[0] = Math.Max(cell[0], gap);
                        cell[1] += 1f;
                    }

                    return table;
                };
                var instants = new List<KeyValuePair<string, double>>
                {
                    new KeyValuePair<string, double>("bowler run-up t=-1.40 s", -1.40), new KeyValuePair<string, double>("bowler gather t=-0.45 s", -0.45),
                    new KeyValuePair<string, double>("bowler release t=0.00 s", 0.0), new KeyValuePair<string, double>("bowler follow-through t=+0.20 s", 0.20),
                    new KeyValuePair<string, double>("bowler follow-through t=+0.45 s", 0.45), new KeyValuePair<string, double>("bowler walk back t=+1.30 s", 1.30)
                };
                var contactT = result.Trace.batterMotion != null ? result.Trace.batterMotion.contactT : 0.5;
                var strikerInstants = new List<KeyValuePair<string, double>>
                {
                    new KeyValuePair<string, double>("striker ready hold t=-0.40 s", -0.40), new KeyValuePair<string, double>("striker backlift t=+0.10 s", 0.10),
                    new KeyValuePair<string, double>("striker stroke (contact-0.08 s)", contactT - 0.08), new KeyValuePair<string, double>("striker contact", contactT),
                    new KeyValuePair<string, double>("striker follow-through (contact+0.30 s)", contactT + 0.30), new KeyValuePair<string, double>("striker recovery (contact+0.90 s)", contactT + 0.90)
                };
                // What is under each human and whether it is drawn (the survey that says which props the hero path really shows).
                foreach (var entry in new[] { new KeyValuePair<string, ProductionCharacterRig>("striker", striker), new KeyValuePair<string, ProductionCharacterRig>("bowler", bowler) })
                {
                    var drawn = new List<string>();
                    var hidden = new List<string>();
                    foreach (var renderer in entry.Value.Root.GetComponentsInChildren<Renderer>(true))
                    {
                        var visible = renderer.enabled && renderer.gameObject.activeInHierarchy;
                        (visible ? drawn : hidden).Add(renderer.gameObject.name + (renderer is SkinnedMeshRenderer ? "[skinned]" : ""));
                    }

                    // Which skeleton does each drawn skinned mesh follow, the hero's or the driver's?
                    var heroSkeleton = entry.Value.VisibleHeroSkeleton;
                    var heroBones = new HashSet<Transform>();
                    var driverBones = new HashSet<Transform>();
                    foreach (var joint in joints)
                    {
                        try
                        {
                            if (heroSkeleton != null) heroBones.Add(heroSkeleton.BoneOf(joint));
                            driverBones.Add(entry.Value.Joint(joint));
                        }
                        catch (ArgumentOutOfRangeException) { }
                    }

                    foreach (var skinned in entry.Value.Root.GetComponentsInChildren<SkinnedMeshRenderer>(false))
                    {
                        if (!skinned.enabled) continue;
                        var bones = skinned.bones ?? new Transform[0];
                        lines.Add(entry.Key + " " + skinned.gameObject.name + ": " + bones.Length + " bones, " + bones.Count(b => heroBones.Contains(b)) +
                                  " of them the hero skeleton's mapped joints, " + bones.Count(b => driverBones.Contains(b)) + " the driver rig's");
                    }

                    lines.Add(entry.Key + " renderers drawn (" + drawn.Count + "): " + string.Join(", ", drawn.Take(40)));
                    lines.Add(entry.Key + " renderers not drawn (" + hidden.Count + "): " + string.Join(", ", hidden.Take(40)));
                }

                var all = instants.Concat(strikerInstants).OrderBy(pair => pair.Value).ToList();
                var accepted = false;
                var seen = new HashSet<string>();
                world.Tick(0.0);
                // One continuous pass through the delivery; the result is accepted after the first frame of the flight (a replay-like start).
                var resultTimeline = -2.4;
                var tableByInstant = new Dictionary<string, Dictionary<string, float[]>>();
                for (var k = 0; k < 600 && seen.Count < all.Count; k++)
                {
                    if (!accepted && world.TimelineForEvidence >= 0.0 - 1e-9)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                    }

                    world.Tick(Step);
                    var t = world.TimelineForEvidence;
                    foreach (var pair in all)
                    {
                        if (seen.Contains(pair.Key) || t + 1e-9 < pair.Value) continue;
                        seen.Add(pair.Key);
                        var human = pair.Key.StartsWith("bowler") ? bowler : striker;
                        tableByInstant[pair.Key] = measure(human, pair.Key.StartsWith("bowler") ? "bowler" : "striker");
                        if (Environment.GetEnvironmentVariable("VANDE_PROPS_STILLS") == "1" && pair.Key.StartsWith("bowler"))
                            foreach (var view in new[] { "front", "side" })
                                RenderStill(world.BatterCameraForEvidence, human, view, Path.Combine(output,
                                    pair.Key.Replace(' ', '-').Replace('=', '_').Replace('+', 'p').Replace('.', '_') + "-" + view + ".png"));
                    }
                    resultTimeline = t;
                }

                lines.Add("(last timeline " + F(resultTimeline) + " s; instants measured: " + seen.Count + " of " + all.Count + ")");
                foreach (var pair in all)
                {
                    Dictionary<string, float[]> table;
                    if (!tableByInstant.TryGetValue(pair.Key, out table)) { lines.Add(pair.Key + ": not reached"); continue; }
                    lines.Add(pair.Key + ": " + (table.Count == 0 ? "(no visible procedural props)" :
                        string.Join("; ", table.OrderBy(entry => entry.Key).Select(entry => entry.Key.Substring(entry.Key.IndexOf(' ') + 1) + " " + F(entry.Value[0]) + " cm (" + entry.Value[1] + " parts)"))));
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            File.WriteAllLines(Path.Combine(output, "props-gap.txt"), lines);
        }

        /// <summary>
        /// UNITY-7 B (editor only, builder evidence): close-up stills of the accept hand-over. The golden `VANDE_HO_CASE` is played as the
        /// host plays it (the press at the swing start, the commitment `VANDE_HO_COMMIT` s later with the normalized swing start, the
        /// result `VANDE_HO_ACCEPT` frames after that) and the striker is photographed (front, rear, arms) for the frames k = -2 .. +2 round
        /// the accept. Seams: VANDE_PREDICTED_BAT=legacy, VANDE_ELBOW_MEMORY=legacy. Writes hand-over-stills/ and hand-over-stills.txt.
        /// </summary>
        public static void HandOverStillsProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            var directory = Path.Combine(output, "hand-over-stills");
            Directory.CreateDirectory(directory);
            var item = LoadFixture().cases.Single(c => c.id == (Environment.GetEnvironmentVariable("VANDE_HO_CASE") ?? "grounded-attack"));
            var commitDelay = double.Parse(Environment.GetEnvironmentVariable("VANDE_HO_COMMIT") ?? "0.05", CultureInfo.InvariantCulture);
            var acceptFrames = int.Parse(Environment.GetEnvironmentVariable("VANDE_HO_ACCEPT") ?? "3", CultureInfo.InvariantCulture);
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            GameObject root;
            var world = OpenTouchdownWorld(item, "right", 0.0, null, out root);
            var lines = new List<string> { "hand-over stills: " + item.id + ", commit +" + F(commitDelay) + " s, accepted " + acceptFrames + " frames after the commitment (host StartT = the press)." };
            try
            {
                var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                var swingStart = result.SwingStartT ?? 0.15;
                world.Tick(Math.Max(0.0, swingStart - world.TimelineForEvidence));
                world.BeginLocalPreparation();
                var committed = false;
                var accepted = false;
                var countdown = acceptFrames;
                var frame = 0;
                var acceptFrame = int.MaxValue;
                for (var k = 0; k < 90 && (!accepted || frame <= acceptFrame + 2); k++)
                {
                    if (!committed && world.TimelineForEvidence >= swingStart + commitDelay - 1e-9)
                    {
                        world.ApplyProvisionalSwing(new PracticeSwingPresentation
                        {
                            Kind = "attack", StartT = swingStart, DirectionDeg = result.SwingDirectionDeg, Power = 0.7, Elevation = 0.1,
                            Footwork = string.IsNullOrEmpty(result.Footwork) ? "auto" : result.Footwork
                        });
                        committed = true;
                    }

                    // The frame this iteration draws is k frames from the accept: -countdown before it, then the count since.
                    var relative = accepted ? frame - acceptFrame : (committed ? -countdown : int.MinValue);
                    if (committed && !accepted)
                    {
                        if (countdown == 0)
                        {
                            world.AcceptResult(result);
                            accepted = true;
                            acceptFrame = frame;
                            relative = 0;
                        }
                        else countdown--;
                    }

                    world.Tick(Step);
                    if (committed && relative >= -2 && relative <= 2)
                    {
                        foreach (var view in new[] { "front", "rear", "armsFront" })
                            RenderStill(world.BatterCameraForEvidence, striker, view, Path.Combine(directory, "k" + (relative >= 0 ? "+" : "") + relative + "-" + view + ".png"));
                        lines.Add("k=" + relative + " t=" + F(world.TimelineForEvidence));
                    }

                    frame++;
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            File.WriteAllLines(Path.Combine(output, "hand-over-stills.txt"), lines);
        }

        private static string BitsDigest(IEnumerable<LateFrame> frames, Func<LateFrame, bool> keep)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                var bytes = new List<byte>();
                foreach (var f in frames)
                {
                    if (!keep(f)) continue;
                    foreach (var value in new[] { f.Ball.x, f.Ball.y, f.Ball.z, f.Physics.x, f.Physics.y, f.Physics.z }) bytes.AddRange(BitConverter.GetBytes(value));
                }

                return BitConverter.ToString(sha.ComputeHash(bytes.ToArray())).Replace("-", string.Empty).Substring(0, 12).ToLowerInvariant();
            }
        }

        public static void LateResultProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var framesDirectory = Path.Combine(output, "late-result-frames");
            var stillsDirectory = Path.Combine(output, "late-result-stills");
            Directory.CreateDirectory(framesDirectory);
            Directory.CreateDirectory(stillsDirectory);
            string[] Split(string variable, string fallback) =>
                (Environment.GetEnvironmentVariable(variable) ?? fallback).Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var caseIds = Split("VANDE_LATE_CASES", "grounded-attack,thin-edge,defensive-tap,deliberate-loft,early-attack,late-attack,complete-miss");
            var modes = Split("VANDE_LATE_MODES", "commit,none,cancel");
            var commits = Split("VANDE_LATE_COMMITS", "0.05,0.12").Select(value => double.Parse(value, CultureInfo.InvariantCulture)).ToArray();
            var stillIds = new HashSet<string>(Split("VANDE_LATE_STILLS", "grounded-attack,thin-edge"));
            var stillAccepts = new HashSet<int>(Split("VANDE_LATE_STILL_ACCEPTS", "6,10,14").Select(value => int.Parse(value, CultureInfo.InvariantCulture)));
            var accepts = Split("VANDE_HANDOVER_ACCEPTS", "0,1,3,5,6,7,10,14").Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
            var legacy = Environment.GetEnvironmentVariable("VANDE_PENDING_BALL") == "legacy";
            var fixture = LoadFixture();
            var report = new List<string>
            {
                "UNITY-7 A: what is drawn of the ball while the host result has not arrived (Unity Editor, production world, right-hander, 60 Hz steps). Seam: " +
                (legacy ? "VANDE_PENDING_BALL=legacy (the pre-UNITY-7 drawing)" : "the UNITY-7 drawing (PendingBallHidden)") + ".",
                "mode commit: the press at the recorded swing start, the commitment (provisional swing) 'commit' s after it, the result accepted 'accept' frames after the commitment.",
                "mode none: nothing touched; mode cancel: a press at the swing start checked back 120 ms later. For both the accept is 'accept' frames after the delivery's flight data is used up.",
                "uptime: " + System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/usr/bin/uptime") { RedirectStandardOutput = true, UseShellExecute = false }).StandardOutput.ReadToEnd().Trim(),
                "Positions are world metres (x mirrored once, as the presentation draws). 'contact' is the physics bat contact (commit mode) or the delivery's ideal contact (none/cancel).",
                string.Empty,
                "columns: mode/case/commit/accept | contact after press (ms) | accept after contact (ms, frames) | first frame the ball is not drawn, after the contact (frames from the contact; - if always drawn) | frames drawn between the contact and the accept (count) | farthest the drawn ball is past the contact point (m) | frames with the rings or inset marker drawn while the ball is not (rings, inset) | drawn ball vs physics ball at the accept frame (mm) and drawn at the accept frame | drawn ball position digest, frames before the accept (bits) | same, all frames"
            };
            foreach (var id in caseIds)
            foreach (var mode in modes)
            foreach (var commitDelay in mode == "commit" ? commits : new[] { 0.0 })
            foreach (var acceptFrames in accepts)
            {
                var item = fixture.cases.Single(c => c.id == id);
                var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
                var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
                const float mirror = -1f;
                var swingStart = result.SwingStartT ?? 0.15;
                // The instant the ball reaches the bat: the physics bat contact when the delivery has one, otherwise (a miss, a leave) the
                // ball's ideal arrival at the contact plane (delivery.IdealContactT); the point is where the physics ball is then.
                var contactEvent = mode == "commit"
                    ? result.Trace.events.FirstOrDefault(e => e.kind == "contact" && e.p != null && e.contact != null && e.contact != "miss" && e.contact != "leave")
                    : null;
                var contactT = contactEvent != null ? contactEvent.t : delivery.IdealContactT;
                var contactPoint = contactEvent != null
                    ? new Vector3(mirror * (float)contactEvent.p.x, (float)contactEvent.p.y, (float)contactEvent.p.z)
                    : TraceBallAt(delivery.Flight, contactT, mirror);
                int contactIndex, acceptIndex;
                var name = mode + "/" + id + "/" + F(commitDelay) + "/" + acceptFrames;
                var frames = PlayLatePass(item, mode, commitDelay, acceptFrames, result, delivery, contactT, null, null, out contactIndex, out acceptIndex);
                if (acceptIndex < 1 || contactIndex < 1)
                {
                    report.Add(name + " | not recorded (accept frame " + acceptIndex + ", contact frame " + contactIndex + ")");
                    continue;
                }

                if (mode == "commit" && Math.Abs(commitDelay - 0.05) < 1e-9 && stillIds.Contains(id) && stillAccepts.Contains(acceptFrames))
                {
                    // The same pass again (the world is deterministic) with the photographs: the frame before the contact, two frames after
                    // it, the last frame before the accept and the accept frame.
                    var prefix = Path.Combine(stillsDirectory, id + "-commit" + F(commitDelay) + "-accept" + acceptFrames);
                    var wanted = new Dictionary<int, string>();
                    Action<int, string> want = (index, role) => wanted[index] = wanted.ContainsKey(index) ? wanted[index] + "+" + role : role;
                    want(contactIndex - 1, "before-contact");
                    want(contactIndex + 2, "contact-plus-2");
                    want(acceptIndex - 1, "last-pending");
                    want(acceptIndex, "accept");
                    int c2, a2;
                    PlayLatePass(item, mode, commitDelay, acceptFrames, result, delivery, contactT, wanted, prefix, out c2, out a2);
                }

                var csv = new List<string> { "k_from_accept,t,accepted,ballX,ballY,ballZ,physX,physY,physZ,flightX,flightY,flightZ,ballVsFlightM,ballVsPhysicsM,toContactPointM,camX,camY,camZ,camStepM,batCapStepCm,batToeStepCm,ballDrawn,emphasisDrawn,insetBallDrawn" };
                for (var i = 0; i < frames.Count; i++)
                {
                    var f = frames[i];
                    var camStep = i > 0 ? Vector3.Distance(f.Camera, frames[i - 1].Camera) : 0f;
                    var capStep = i > 0 ? Vector3.Distance(f.BatCap, frames[i - 1].BatCap) * 100f : 0f;
                    var toeStep = i > 0 ? Vector3.Distance(f.BatToe, frames[i - 1].BatToe) * 100f : 0f;
                    csv.Add(string.Join(",", new[]
                    {
                        (i - acceptIndex).ToString(CultureInfo.InvariantCulture), F(f.T), f.Accepted ? "1" : "0", V3(f.Ball), V3(f.Physics), V3(f.Flight),
                        F(Vector3.Distance(f.Ball, f.Flight)), F(Vector3.Distance(f.Ball, f.Physics)), F(Vector3.Distance(f.Ball, contactPoint)),
                        V3(f.Camera), F(camStep), F(capStep), F(toeStep), f.BallDrawn ? "1" : "0", f.EmphasisDrawn ? "1" : "0", f.InsetBallDrawn ? "1" : "0"
                    }));
                }

                File.WriteAllLines(Path.Combine(framesDirectory, mode + "-" + id + "-commit" + F(commitDelay) + "-accept" + acceptFrames + ".csv"), csv);

                var at = frames[acceptIndex];
                var lateMs = (at.T - contactT) * 1000.0;
                var firstHidden = -1;
                for (var i = Math.Max(0, contactIndex - 6); i < acceptIndex; i++)
                    if (!frames[i].BallDrawn)
                    {
                        firstHidden = i;
                        break;
                    }

                var drawnAfterContact = 0;
                var farthestPast = 0f;
                var ringsWhileHidden = 0;
                var insetWhileHidden = 0;
                for (var i = 0; i < acceptIndex; i++)
                {
                    if (i > contactIndex && frames[i].BallDrawn)
                    {
                        drawnAfterContact++;
                        farthestPast = Math.Max(farthestPast, frames[i].Ball.z - contactPoint.z);
                    }

                    if (!frames[i].BallDrawn && frames[i].EmphasisDrawn) ringsWhileHidden++;
                    if (!frames[i].BallDrawn && frames[i].InsetBallDrawn) insetWhileHidden++;
                }

                report.Add(name + " | " + (contactEvent != null ? "contact" : "ideal arrival") + " " + F((contactT - (mode == "commit" ? swingStart : 0.0)) * 1000.0) + " ms | " +
                           F(lateMs) + " ms, " + F(lateMs / (1000.0 / 60.0)) + " frames | " +
                           (firstHidden < 0 ? "-" : (firstHidden - contactIndex).ToString(CultureInfo.InvariantCulture)) + " | " +
                           drawnAfterContact + " | " + F(farthestPast) + " | " + ringsWhileHidden + "," + insetWhileHidden + " | " +
                           F(Vector3.Distance(at.Ball, at.Physics) * 1000f) + " mm, " + (at.BallDrawn ? "drawn" : "NOT drawn") + " | " +
                           BitsDigest(frames.Take(acceptIndex), f => f.BallDrawn) + " | " + BitsDigest(frames, f => f.BallDrawn));
            }

            File.WriteAllLines(Path.Combine(output, "late-result.txt"), report);
        }
    }
}
