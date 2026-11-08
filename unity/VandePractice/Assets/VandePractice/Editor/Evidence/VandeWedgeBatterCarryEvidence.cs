using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Input;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// Builder evidence for the batter's continuity (UNITY phase 2, from TRACKB's P1 report): the result-acceptance
    /// jump, the follow-through hold and the dead-ball recovery step, measured on TRACKB's own scenario packets at
    /// 60 Hz, both as the host sends them (no touch) and on the live touch path (Unity's local bat preview during the
    /// gesture, as VandePracticeRuntimeController drives it). Builder observation only; it certifies nothing.
    /// Inputs: VANDE_TRACKB_SCENARIO (scenario.json), VANDE_EVIDENCE_OUT, optional VANDE_CARRY_CASES (comma list).
    /// </summary>
    public static class VandeWedgeBatterCarryEvidence
    {
        private const double FrameHz = 60.0;
        private const double GestureSeconds = 0.095;
        private const double GesturePixels = 120.0;
        private const double GestureDegrees = 55.0;
        private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        public static void CheckBatterCarry()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            var scenarioPath = Environment.GetEnvironmentVariable("VANDE_TRACKB_SCENARIO");
            if (string.IsNullOrEmpty(output) || string.IsNullOrEmpty(scenarioPath))
                throw new InvalidOperationException("VANDE_EVIDENCE_OUT and VANDE_TRACKB_SCENARIO are required.");
            Directory.CreateDirectory(output);
            var wanted = (Environment.GetEnvironmentVariable("VANDE_CARRY_CASES") ?? "ideal,early-30,late-30,leave,speed-150")
                .Split(',').Select(value => value.Trim()).Where(value => value.Length > 0).ToArray();
            var scenario = JsonUtility.FromJson<ScenarioFile>(File.ReadAllText(scenarioPath));
            var json = new StringBuilder();
            json.Append("{\"what\":\"Builder observation: batter continuity at 60 Hz on TRACKB's P1 scenario packets, ")
                .Append("production world, Standard tier, EditMode. host = the packets at hostSendT with no touch; touch = ")
                .Append("Unity's local bat preview over the 95 ms gesture first. Speeds are per-frame displacement x 60.\",")
                .Append("\"scenario\":\"").Append(Escape(scenarioPath)).Append("\",\"cases\":[");
            var first = true;
            foreach (var id in wanted)
            {
                var entry = scenario.cases.FirstOrDefault(value => value.caseId == id);
                if (entry == null) continue;
                foreach (var touch in new[] { false, true })
                {
                    if (!first) json.Append(',');
                    first = false;
                    json.Append(RunCase(entry, touch));
                }
            }
            json.Append("]}");
            File.WriteAllText(Path.Combine(output, "batter-carry.json"), json.ToString());
            Debug.Log("VANDE_EVIDENCE batter carry written");
        }

        private static string RunCase(ScenarioCase entry, bool touch)
        {
            var scene = PracticePresentationContractAdapter.Scene(Decode(entry.packets.scene).Envelope);
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(entry.packets.delivery).Envelope);
            var result = PracticePresentationContractAdapter.Result(Decode(entry.packets.result).Envelope);
            var provisional = entry.packets.provisionalSwing != null && !string.IsNullOrEmpty(entry.packets.provisionalSwing.body)
                ? PracticePresentationContractAdapter.ProvisionalSwing(Decode(entry.packets.provisionalSwing).Envelope)
                : null;
            var root = new GameObject("VANDE batter carry " + entry.caseId) { hideFlags = HideFlags.DontSave };
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Locale = "en-IN", Quality = PracticePresentationQuality.Standard, Assistance = "real",
                    Handedness = scene.Handedness, ReducedMotion = false, Captions = false, Audio = false, Haptics = false
                }, new SilentSink());
                world.ConfigureScene(scene);
                var type = typeof(ProceduralPracticeWorld);
                var rig = (ProductionCharacterRig)type.GetField("batterRig", Private).GetValue(world);
                var body = (GameObject)type.GetField("batterBody", Private).GetValue(world);
                var completed = false;
                world.DeliveryCompleted += (deadT, digest) => completed = true;
                world.BeginDelivery(delivery);

                var trace = result.Trace;
                var motion = trace.batterMotion;
                var contactT = motion != null ? motion.contactT : double.NaN;
                var endT = motion != null ? motion.endT : double.NaN;
                var touchStart = entry.hostSendT - GestureSeconds;
                var accepted = false;
                var touched = false;
                var frames = new List<Frame>();
                var trail = new StringBuilder();
                var k = (long)Math.Ceiling(world.Timeline * FrameHz - 1e-9);
                double? completedAt = null;
                var contactGripError = double.NaN;
                var contactGripGap = double.NaN;
                var contactRootError = double.NaN;
                var contactChecked = false;
                var afterCompletion = 0;
                while (true)
                {
                    var target = k / FrameHz;
                    if (touch && !accepted && target >= touchStart)
                    {
                        if (!touched)
                        {
                            world.Tick(Math.Max(0.0, touchStart - world.Timeline));
                            world.BeginLocalPreparation();
                            touched = true;
                        }
                        var share = Math.Min(1.0, (Math.Min(target, entry.hostSendT) - touchStart) / GestureSeconds);
                        var radians = GestureDegrees * Math.PI / 180.0;
                        world.ApplyLocalBatPreview(PracticeLocalBatPreview.FromRawDisplacement(
                            GesturePixels * share * Math.Cos(radians), -GesturePixels * share * Math.Sin(radians),
                            915.0, 412.0, "auto"));
                    }
                    if (!accepted && target >= entry.hostSendT)
                    {
                        world.Tick(Math.Max(0.0, entry.hostSendT - world.Timeline));
                        if (provisional != null) world.ApplyProvisionalSwing(provisional);
                        world.AcceptResult(result);
                        world.Tick(0.0);
                        accepted = true;
                    }
                    if (accepted && !contactChecked && !double.IsNaN(contactT) && target >= contactT &&
                        world.Timeline <= contactT + 1e-9)
                    {
                        // One exact tick to the authored contact anchor: the bat must be the physics bat there.
                        world.Tick(Math.Max(0.0, contactT - world.Timeline));
                        var knot = trace.bat.OrderBy(value => Math.Abs(value.t - contactT)).First();
                        // Option A world reflection (owner/lead ruling 2026-11-04): -1 for a right-hander, +1 for a
                        // left-hander. This used +1 for a right-hander, the pre-ruling mirror image.
                        var mirror = ProceduralPracticeWorld.WorldReflectionFor(scene.Handedness);
                        var canonicalGrip = new Vector3(mirror * (float)knot.grip.x, (float)knot.grip.y, (float)knot.grip.z);
                        contactGripError = Math.Abs(knot.t - contactT) < 1e-6
                            ? Vector3.Distance(rig.Bat.position, canonicalGrip)
                            : double.NaN;
                        contactGripGap = Math.Max(
                            Vector3.Distance(rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true)),
                            Vector3.Distance(rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false)));
                        var planted = (Vector3)type.GetField("nominalBatterWorldPosition", Private).GetValue(world) +
                                      new Vector3(mirror * (float)trace.batterRootOffset.x, 0f, (float)trace.batterRootOffset.z);
                        contactRootError = Vector3.Distance(body.transform.position, planted);
                        contactChecked = true;
                    }
                    world.Tick(Math.Max(0.0, target - world.Timeline));
                    if (completed && completedAt == null) completedAt = target;
                    if (Environment.GetEnvironmentVariable("VANDE_CARRY_TRAIL") == "1" && accepted &&
                        Math.Abs(target * 10.0 - Math.Round(target * 10.0)) < 1e-6)
                        trail.Append(trail.Length == 0 ? "" : ",").Append("[").Append(F(target)).Append(",\"")
                            .Append(type.GetField("state", Private).GetValue(world)).Append("\",")
                            .Append(type.GetField("earlyRecoveryBegun", Private).GetValue(world).ToString().ToLowerInvariant())
                            .Append(',').Append(F(rig.HeroHandWorldPosition(false).y)).Append(',').Append(F(rig.Bat.position.y))
                            .Append(',').Append(F(rig.HeroJointWorldPosition(ProductionCharacterJoint.Head).y)).Append(']');
                    frames.Add(new Frame
                    {
                        T = target,
                        Accepted = accepted,
                        Root = body.transform.position,
                        Hips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips),
                        FootLeft = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft),
                        FootRight = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight),
                        HandLeft = rig.HeroHandWorldPosition(true),
                        HandRight = rig.HeroHandWorldPosition(false),
                        Grip = rig.Bat.position,
                        GripGap = Math.Max(
                            Vector3.Distance(rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true)),
                            Vector3.Distance(rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false)))
                    });
                    k++;
                    if (completed && ++afterCompletion > 90) break;
                    if (frames.Count > 20000) throw new InvalidOperationException("Case did not complete: " + entry.caseId);
                }

                // Per-frame speeds.
                var sb = new StringBuilder();
                sb.Append("{\"caseId\":\"").Append(Escape(entry.caseId)).Append("\",\"mode\":\"").Append(touch ? "touch" : "host")
                    .Append("\",\"hostSendT\":").Append(F(entry.hostSendT))
                    .Append(",\"contactT\":").Append(F(contactT)).Append(",\"endT\":").Append(F(endT))
                    .Append(",\"batterRootOffset\":[").Append(F(trace.batterRootOffset.x)).Append(',').Append(F(trace.batterRootOffset.z))
                    .Append("],\"deadT\":").Append(F(trace.durationSeconds))
                    .Append(",\"completedAtT\":").Append(completedAt.HasValue ? F(completedAt.Value) : "null");
                // Acceptance window: from the last frame before acceptance to 0.25 s after it.
                var acceptIndex = frames.FindIndex(value => value.Accepted);
                sb.Append(",\"acceptance\":").Append(Window(frames, Math.Max(1, acceptIndex), entry.hostSendT + 0.25));
                // Whole delivery after acceptance (the bat is reported separately: a swing is legitimately fast).
                sb.Append(",\"afterAcceptance\":").Append(Window(frames, Math.Max(1, acceptIndex), double.PositiveInfinity));
                // After the dead ball: the recovery step.
                var deadIndex = completedAt.HasValue
                    ? frames.FindIndex(value => value.T >= trace.durationSeconds - 1e-9)
                    : -1;
                sb.Append(",\"afterDead\":").Append(deadIndex > 0 ? Window(frames, deadIndex, double.PositiveInfinity) : "null");
                // After the canonical bat ends, up to 0.6 s past the dead ball: the follow-through hold and recovery.
                var holdFrom = double.IsNaN(endT) ? entry.hostSendT : endT;
                var endIndex = frames.FindIndex(value => value.T > holdFrom);
                sb.Append(",\"afterEndThroughDead\":").Append(endIndex > 0
                    ? Window(frames, endIndex, trace.durationSeconds + 0.6)
                    : "null");
                // Holds before the dead ball: the first still run after endT (the held finish) and the longest one.
                sb.Append(",\"firstHandHoldAfterEndS\":").Append(F(Holds(frames, holdFrom, trace.durationSeconds, true)))
                    .Append(",\"longestHandHoldBeforeDeadS\":").Append(F(Holds(frames, holdFrom, trace.durationSeconds, false)));
                sb.Append(",\"contact\":{\"gripErrorM\":").Append(F(contactGripError))
                    .Append(",\"handGripGapM\":").Append(F(contactGripGap))
                    .Append(",\"rootFromPlantedM\":").Append(F(contactRootError)).Append('}');
                if (trail.Length > 0) sb.Append(",\"trail\":[").Append(trail).Append(']');
                sb.Append('}');
                return sb.ToString();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static string Window(List<Frame> frames, int from, double untilT)
        {
            double root = 0, hips = 0, feet = 0, hands = 0, grip = 0, gap = 0;
            double rootT = double.NaN, hipsT = double.NaN, feetT = double.NaN;
            for (var index = from; index < frames.Count && frames[index].T <= untilT + 1e-9; index++)
            {
                var a = frames[index - 1];
                var b = frames[index];
                var r = Vector3.Distance(a.Root, b.Root);
                var h = Vector3.Distance(a.Hips, b.Hips);
                var f = Math.Max(Vector3.Distance(a.FootLeft, b.FootLeft), Vector3.Distance(a.FootRight, b.FootRight));
                var n = Math.Max(Vector3.Distance(a.HandLeft, b.HandLeft), Vector3.Distance(a.HandRight, b.HandRight));
                if (r > root) { root = r; rootT = b.T; }
                if (h > hips) { hips = h; hipsT = b.T; }
                if (f > feet) { feet = f; feetT = b.T; }
                hands = Math.Max(hands, n);
                grip = Math.Max(grip, Vector3.Distance(a.Grip, b.Grip));
                if (b.Accepted) gap = Math.Max(gap, b.GripGap);
            }
            return "{\"maxFrameStepM\":{\"root\":" + F(root) + ",\"hips\":" + F(hips) + ",\"feet\":" + F(feet) +
                   ",\"hands\":" + F(hands) + ",\"batGrip\":" + F(grip) + "},\"peakSpeedMps\":{\"root\":" + F(root * FrameHz) +
                   ",\"hips\":" + F(hips * FrameHz) + ",\"feet\":" + F(feet * FrameHz) + ",\"hands\":" + F(hands * FrameHz) +
                   ",\"batGrip\":" + F(grip * FrameHz) + "},\"at\":{\"root\":" + F(rootT) + ",\"hips\":" + F(hipsT) +
                   ",\"feet\":" + F(feetT) + "},\"maxHandGripGapM\":" + F(gap) + "}";
        }

        /// <summary>Still runs (no hand faster than 2 cm/s) between fromT and untilT: the first one, or the longest.</summary>
        private static double Holds(List<Frame> frames, double fromT, double untilT, bool firstOnly)
        {
            double longest = 0, start = double.NaN;
            for (var index = 1; index < frames.Count; index++)
            {
                if (frames[index].T < fromT) continue;
                if (frames[index].T > untilT + 1e-9) break;
                var a = frames[index - 1];
                var b = frames[index];
                var speed = Math.Max(Vector3.Distance(a.HandLeft, b.HandLeft), Vector3.Distance(a.HandRight, b.HandRight)) * FrameHz;
                if (speed < 0.02)
                {
                    if (double.IsNaN(start)) start = a.T;
                    longest = Math.Max(longest, b.T - start);
                }
                else
                {
                    if (firstOnly && !double.IsNaN(start)) return longest;
                    start = double.NaN;
                }
            }
            return longest;
        }

        private static DecodedUnityPracticePacket Decode(UnityPracticePacket packet)
        {
            if (packet == null) throw new InvalidDataException("The scenario contains a null packet.");
            return UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet));
        }

        private static string F(double value) =>
            double.IsNaN(value) || double.IsInfinity(value) ? "null" : value.ToString("R", CultureInfo.InvariantCulture);

        private static string Escape(string value) => (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");

        private struct Frame
        {
            public double T;
            public bool Accepted;
            public Vector3 Root;
            public Vector3 Hips;
            public Vector3 FootLeft;
            public Vector3 FootRight;
            public Vector3 HandLeft;
            public Vector3 HandRight;
            public Vector3 Grip;
            public double GripGap;
        }

        private sealed class SilentSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }

        [Serializable]
        private sealed class ScenarioFile
        {
            public ScenarioCase[] cases;
        }

        [Serializable]
        private sealed class ScenarioCase
        {
            public string caseId;
            public double hostSendT;
            public ScenarioPackets packets;
        }

        [Serializable]
        private sealed class ScenarioPackets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket provisionalSwing;
            public UnityPracticePacket result;
        }
    }
}
