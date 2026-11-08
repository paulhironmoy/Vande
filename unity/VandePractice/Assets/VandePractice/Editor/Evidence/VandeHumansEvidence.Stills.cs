using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// UNITY-5 (editor only, builder evidence): close-up stills of one human at a chosen instant of a golden delivery, and the
    /// survey that says where the instants are. The humans are the production world's own (the same poses the bridge plays at
    /// 60 Hz), so a before and an after taken from two trees show the same instant. The camera is a plain extra camera of the
    /// world's (built-in pipeline), on a circle round the human's root; nothing here is in the Runtime assembly.
    ///
    /// ClipSurvey      : per case and human, the spans of the planned fielding clip and of the root-speed classes -> clip-survey.txt
    /// Stills          : VANDE_STILLS_PLAN (a file of "case|human|t|view|label" lines) -> label.png per line
    /// ArmRound        : the arm rest probe, the survey, the two humans runs (the hero joint-limit tally) and the stills, one launch
    /// </summary>
    public static partial class VandeHumansEvidence
    {
        private const float StillDistanceMetres = 3.3f;
        private const int StillWidth = 480;
        private const int StillHeight = 720;

        /// <summary>
        /// Views on a circle round the human: the yaw (degrees about +Y, from the rig root's forward) of the camera's place. Every
        /// production rig's face looks along its root's BACK (measured on the first stills: the chest chevron and the face show from
        /// the root's -forward side, for the fielders, keeper, bowler and both batters), so "front" is 180 degrees round from it.
        /// </summary>
        private static bool StillView(string view, out float yaw, out float distance, out float height, out float focusHeight, out float fov)
        {
            distance = StillDistanceMetres;
            height = 1.25f;
            focusHeight = 0.95f;
            fov = 32f;
            switch (view)
            {
                case "front": yaw = 160f; return true;
                case "rear": yaw = -20f; return true;
                case "side": yaw = 90f; return true;
                case "sideR": yaw = -90f; return true;
                case "armsFront":
                    yaw = 160f; distance = 2.6f; height = 1.15f; focusHeight = 0.95f; fov = 36f; return true;
                case "armsRear":
                    yaw = -20f; distance = 2.6f; height = 1.15f; focusHeight = 0.95f; fov = 36f; return true;
                default: yaw = 0f; return false;
            }
        }

        private static ProceduralPracticeWorld OpenStillsWorld(GoldenCase item, string hand, out GameObject root,
            out PracticePresentationResultBox result, out bool[] completedFlag)
        {
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var accepted = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = hand;
            root = new GameObject("VANDE stills " + item.id);
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = hand,
                Locale = "en-IN",
                Quality = PracticePresentationQuality.High
            }, new NullSink());
            world.ConfigureScene(scene);
            var flag = new bool[1];
            world.DeliveryCompleted += (_, __) => flag[0] = true;
            world.BeginDelivery(delivery);
            result = new PracticePresentationResultBox { Value = accepted, Duration = accepted.Trace.durationSeconds };
            completedFlag = flag;
            return world;
        }

        private sealed class PracticePresentationResultBox
        {
            public PracticeResultPresentation Value;
            public double Duration;
        }

        /// <summary>VANDE_LEGACY_ARMS=1 poses every hero with the retarget as it was before UNITY-5 (the Editor-only A/B seam).</summary>
        private static void ApplyArmSeams(ProceduralPracticeWorld world)
        {
            if (Environment.GetEnvironmentVariable("VANDE_LEGACY_ARMS") != "1") return;
            foreach (var human in world.PresentedHumansForEvidence())
            {
                var skeleton = human.Value.VisibleHeroSkeleton;
                if (skeleton != null) skeleton.LegacyArmRetarget = true;
            }
        }

        private static void RenderStill(Camera template, ProductionCharacterRig rig, string view, string path)
        {
            // A skinned mesh that was off screen (updateWhenOffscreen is false in production) keeps the skin of the last frame it
            // was visible in; a close-up of a human the world camera is not looking at must skin it from the bones as they are now.
            foreach (var skinned in rig.Root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                skinned.updateWhenOffscreen = true;
                skinned.forceMatrixRecalculationPerRender = true;
            }
            float yawDegrees, distance, height, focusHeight, fov;
            if (!StillView(view, out yawDegrees, out distance, out height, out focusHeight, out fov))
                throw new ArgumentException("Unknown still view " + view);
            var rootPosition = rig.Root.position;
            var facing = rig.Root.forward;
            facing.y = 0f;
            if (facing.sqrMagnitude < 1e-6f) facing = Vector3.forward;
            facing.Normalize();
            var offset = Quaternion.AngleAxis(yawDegrees, Vector3.up) * facing * distance;
            var cameraObject = new GameObject("VANDE still camera");
            try
            {
                cameraObject.transform.SetParent(template.transform.parent, true);
                var camera = cameraObject.AddComponent<Camera>();
                camera.CopyFrom(template);
                camera.enabled = false;
                camera.fieldOfView = fov;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 400f;
                var focus = rootPosition + Vector3.up * focusHeight;
                var position = new Vector3(rootPosition.x + offset.x, height, rootPosition.z + offset.z);
                camera.transform.SetPositionAndRotation(position, Quaternion.LookRotation(focus - position, Vector3.up));
                RenderPng(camera, StillWidth, StillHeight, path);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        private static void RenderPng(Camera camera, int width, int height, string path)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var previousAspect = camera.aspect;
            try
            {
                camera.targetTexture = target;
                camera.aspect = width / (float)height;
                camera.Render();
                RenderTexture.active = target;
                var pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
                pixels.Apply();
                File.WriteAllBytes(path, pixels.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(pixels);
            }
            finally
            {
                camera.targetTexture = previousTarget;
                camera.aspect = previousAspect;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        /// <summary>
        /// Where the instants are: for every golden case, per human, the spans of the planned fielding clip and of the root-speed
        /// classes (idle under 0.3 m/s, walk, run over 2.2 m/s), plus the world state spans. Writes clip-survey.txt.
        /// VANDE_HUMANS_CASES (default: every golden case) selects cases; VANDE_HUMANS_HAND the striker's hand.
        /// </summary>
        public static void ClipSurvey()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var fixture = LoadFixture();
            var wanted = Environment.GetEnvironmentVariable("VANDE_HUMANS_CASES");
            var ids = string.IsNullOrEmpty(wanted)
                ? fixture.cases.Select(c => c.id).ToArray()
                : wanted.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var lines = new List<string>();
            foreach (var id in ids)
            {
                var item = fixture.cases.Single(c => c.id == id);
                GameObject root = null;
                try
                {
                    PracticePresentationResultBox box;
                    bool[] completed;
                    var world = OpenStillsWorld(item, HumansHand, out root, out box, out completed);
                    lines.Add("== " + id + " (result duration " + F(box.Duration) + " s, hand " + HumansHand + ")");
                    var spans = new Dictionary<string, List<string[]>>(StringComparer.Ordinal);
                    var previousRoot = new Dictionary<string, Vector3>(StringComparer.Ordinal);
                    var accepted = false;
                    var frames = 0;
                    var maxFrames = (int)((-world.TimelineForEvidence + box.Duration + 6.0) / Step);
                    var lastState = "";
                    var stateStart = world.TimelineForEvidence;
                    while (!completed[0] && frames < maxFrames)
                    {
                        if (!accepted && world.TimelineForEvidence >= AcceptAfterRelease)
                        {
                            world.AcceptResult(box.Value);
                            accepted = true;
                        }
                        world.Tick(Step);
                        frames++;
                        var t = world.TimelineForEvidence;
                        if (world.StateForEvidence != lastState)
                        {
                            if (lastState != "") lines.Add("   state " + lastState + " " + F(stateStart) + " .. " + F(t));
                            lastState = world.StateForEvidence;
                            stateStart = t;
                        }
                        foreach (var human in world.PresentedHumansForEvidence())
                        {
                            var key = human.Key;
                            var clip = "";
                            if (key.StartsWith("fielder:", StringComparison.Ordinal) || key == "keeper" || key == "bowler")
                            {
                                var track = key.StartsWith("fielder:", StringComparison.Ordinal)
                                    ? world.FieldingTrackForTesting(key.Substring("fielder:".Length))
                                    : world.FieldingTrackForRoleForEvidence(key);
                                if (track != null && track.Moves.Count > 0) clip = track.Evaluate(t).Clip.ToString();
                            }
                            var hips = human.Value.VisibleJointWorldPosition(ProductionCharacterJoint.Hips);
                            var speed = 0.0;
                            Vector3 before;
                            if (previousRoot.TryGetValue(key, out before)) speed = Horizontal(hips - before) / Step;
                            previousRoot[key] = hips;
                            var speedClass = speed < 0.3 ? "idle" : speed < 2.2 ? "walk" : "run";
                            var label = (clip.Length > 0 ? clip : "-") + "/" + speedClass;
                            List<string[]> list;
                            if (!spans.TryGetValue(key, out list)) spans[key] = list = new List<string[]>();
                            if (list.Count == 0 || list[list.Count - 1][0] != label)
                                list.Add(new[] { label, F(t), F(t), "0" });
                            var span = list[list.Count - 1];
                            span[2] = F(t);
                            span[3] = (int.Parse(span[3], CultureInfo.InvariantCulture) + 1).ToString(CultureInfo.InvariantCulture);
                        }
                    }
                    lines.Add("   state " + lastState + " " + F(stateStart) + " .. " + F(world.TimelineForEvidence));
                    foreach (var pair in spans)
                    {
                        lines.Add("  " + pair.Key);
                        foreach (var span in pair.Value)
                            if (int.Parse(span[3], CultureInfo.InvariantCulture) >= 3)
                                lines.Add("      " + span[0].PadRight(26) + " " + span[1].PadLeft(9) + " .. " + span[2].PadLeft(9) + "  frames " + span[3]);
                    }
                }
                finally
                {
                    if (root != null) UnityEngine.Object.DestroyImmediate(root);
                }
            }
            File.WriteAllLines(Path.Combine(output, "clip-survey.txt"), lines);
        }

        /// <summary>
        /// The stills of VANDE_STILLS_PLAN: lines "case|human|t|view|label" (human as PresentedHumansForEvidence keys it; t the world's
        /// timeline, release at 0; view front, rear, side, sideR, armsFront, armsRear, bat). Each is rendered the first frame the
        /// timeline reaches t and written to VANDE_EVIDENCE_OUT/label.png; stills.txt says the instant it was taken at.
        /// </summary>
        public static void Stills()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            var planPath = Environment.GetEnvironmentVariable("VANDE_STILLS_PLAN");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            if (string.IsNullOrEmpty(planPath) || !File.Exists(planPath)) throw new InvalidOperationException("Set VANDE_STILLS_PLAN.");
            Directory.CreateDirectory(output);
            var plan = File.ReadAllLines(planPath)
                .Where(line => line.Trim().Length > 0 && !line.StartsWith("#", StringComparison.Ordinal))
                .Select(line => line.Split('|'))
                .Select(parts => new
                {
                    Case = parts[0].Trim(),
                    Human = parts[1].Trim(),
                    T = double.Parse(parts[2], CultureInfo.InvariantCulture),
                    View = parts[3].Trim(),
                    Label = parts[4].Trim()
                })
                .ToList();
            var fixture = LoadFixture();
            var log = new List<string>();
            foreach (var group in plan.GroupBy(entry => entry.Case))
            {
                var item = fixture.cases.Single(c => c.id == group.Key);
                var pending = group.OrderBy(entry => entry.T).ToList();
                GameObject root = null;
                try
                {
                    PracticePresentationResultBox box;
                    bool[] completed;
                    var world = OpenStillsWorld(item, HumansHand, out root, out box, out completed);
                    var accepted = false;
                    var frames = 0;
                    var maxFrames = (int)((-world.TimelineForEvidence + box.Duration + 6.0) / Step);
                    while (!completed[0] && frames < maxFrames && pending.Count > 0)
                    {
                        if (!accepted && world.TimelineForEvidence >= AcceptAfterRelease)
                        {
                            world.AcceptResult(box.Value);
                            accepted = true;
                        }
                        ApplyArmSeams(world);
                        world.Tick(Step);
                        frames++;
                        var t = world.TimelineForEvidence;
                        while (pending.Count > 0 && t >= pending[0].T - 1e-9)
                        {
                            var entry = pending[0];
                            pending.RemoveAt(0);
                            var human = world.PresentedHumansForEvidence().FirstOrDefault(pair => pair.Key == entry.Human);
                            if (human.Value == null)
                            {
                                log.Add(entry.Label + ": no human " + entry.Human);
                                continue;
                            }
                            RenderStill(world.BatterCameraForEvidence, human.Value, entry.View, Path.Combine(output, entry.Label + ".png"));
                            var fade = entry.Human == "keeper" && world.KeeperOcclusionFade != null
                                ? " keeperFade=" + F(world.KeeperOcclusionFade.Fade)
                                : "";
                            log.Add(entry.Label + ": " + entry.Case + " " + entry.Human + " " + entry.View + " asked t=" + F(entry.T) +
                                    " taken t=" + F(t) + " state=" + world.StateForEvidence + fade);
                        }
                    }
                    foreach (var entry in pending) log.Add(entry.Label + ": not reached (t=" + F(entry.T) + ")");
                }
                finally
                {
                    if (root != null) UnityEngine.Object.DestroyImmediate(root);
                }
            }
            File.WriteAllLines(Path.Combine(output, "stills.txt"), log);
        }

        /// <summary>
        /// UNITY-5 F3 (builder measurement, this Mac's Editor on Mono: an indication, not an Android figure): what Unity spends on a
        /// result once its packet is in hand: the packet's size, decoding it (JsonUtility, the codec's checks), adapting it, and
        /// AcceptResult (validation, the fielding choreography, the carry), per golden case, the median of five runs after one warm-up.
        /// Writes accept-cost.txt.
        /// </summary>
        public static void AcceptCostProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var fixture = LoadFixture();
            var lines = new List<string>
            {
                "case, result packet bytes (as JsonUtility writes it), decode ms (codec), adapt ms, AcceptResult ms; median of 5 after a warm-up",
                "uptime: " + System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/usr/bin/uptime") { RedirectStandardOutput = true, UseShellExecute = false }).StandardOutput.ReadToEnd().Trim()
            };
            Func<List<double>, double> median = values => { values.Sort(); return values[values.Count / 2]; };
            foreach (var item in fixture.cases)
            {
                var decode = new List<double>();
                var adapt = new List<double>();
                var accept = new List<double>();
                var bytes = 0;
                for (var run = 0; run < 6; run++)
                {
                    GameObject root = null;
                    try
                    {
                        PracticePresentationResultBox box;
                        bool[] completed;
                        var world = OpenStillsWorld(item, HumansHand, out root, out box, out completed);
                        while (world.TimelineForEvidence < 0.10) world.Tick(Step);
                        var json = JsonUtility.ToJson(item.wire.packets.result);
                        bytes = Encoding.UTF8.GetByteCount(json);
                        var watch = System.Diagnostics.Stopwatch.StartNew();
                        var envelope = UnityPracticePacketCodec.Decode(json).Envelope;
                        var decodeMs = watch.Elapsed.TotalMilliseconds;
                        var result = PracticePresentationContractAdapter.Result(envelope);
                        var adaptMs = watch.Elapsed.TotalMilliseconds - decodeMs;
                        watch.Restart();
                        world.AcceptResult(result);
                        var acceptMs = watch.Elapsed.TotalMilliseconds;
                        if (run == 0) continue;
                        decode.Add(decodeMs);
                        adapt.Add(adaptMs);
                        accept.Add(acceptMs);
                    }
                    finally
                    {
                        if (root != null) UnityEngine.Object.DestroyImmediate(root);
                    }
                }
                lines.Add(item.id.PadRight(18) + " " + bytes.ToString(CultureInfo.InvariantCulture).PadLeft(7) + " B  decode " +
                          F(median(decode)).PadLeft(7) + " ms  adapt " + F(median(adapt)).PadLeft(7) + " ms  AcceptResult " +
                          F(median(accept)).PadLeft(7) + " ms");
            }
            File.WriteAllLines(Path.Combine(output, "accept-cost.txt"), lines);
        }

        /// <summary>
        /// One launch of UNITY-5's arm round: the arm rest probe (hero-arm-rest.txt), the survey (when VANDE_ROUND_SURVEY=1), the humans run
        /// for both striker hands (the hero joint-limit tally, humans-metrics.json in evidence and evidence-left) and the stills of
        /// VANDE_STILLS_PLAN (when set). Every step has its own sub-directory of VANDE_EVIDENCE_OUT.
        /// </summary>
        public static void ArmRound()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Action<string, Action> step = (sub, body) =>
            {
                Environment.SetEnvironmentVariable("VANDE_EVIDENCE_OUT", Path.Combine(output, sub));
                try
                {
                    body();
                }
                catch (Exception error)
                {
                    Debug.LogError("VANDE_ARM_ROUND_STEP_FAILED " + sub + ": " + error);
                }
                finally
                {
                    Environment.SetEnvironmentVariable("VANDE_EVIDENCE_OUT", output);
                }
            };
            step("rest", HeroArmRestProbe);
            if (Environment.GetEnvironmentVariable("VANDE_ROUND_SURVEY") == "1") step("survey", ClipSurvey);
            if (Environment.GetEnvironmentVariable("VANDE_ROUND_TALLY") != "0")
            {
                Environment.SetEnvironmentVariable("VANDE_HUMANS_HAND", "right");
                step("evidence", Run);
                Environment.SetEnvironmentVariable("VANDE_HUMANS_HAND", "left");
                step("evidence-left", Run);
                Environment.SetEnvironmentVariable("VANDE_HUMANS_HAND", null);
            }
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VANDE_STILLS_PLAN"))) step("stills", Stills);
        }
    }
}
