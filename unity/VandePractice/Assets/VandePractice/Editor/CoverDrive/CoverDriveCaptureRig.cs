using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;
using UnityEngine.Profiling;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.CoverDrive
{
    /// <summary>
    /// Cover-drive P1 telemetry and capture rig (docs/prompts/VANDE-COVER-DRIVE-PROMPT.md §8 and Appendix B).
    /// Builder evidence only: batchmode -executeMethod, never part of the player build (Editor folder).
    ///
    /// It reads scripts/cover-drive/scenario.mjs output (the exact TypeScript wire packets), drives a fresh production
    /// ProceduralPracticeWorld per case on an exact 60 Hz grid of the trace clock and records per-frame telemetry. It
    /// contains no physics, contact, scoring or outcome selection, and changes no runtime file: private presentation
    /// state is read by reflection. The world receives host.provisional_swing and host.result when the live host
    /// would send them (the scenario's hostSendT); Unity's own touch-driven local bat preview is not reproduced.
    ///
    /// Environment:
    ///   VANDE_COVER_DRIVE_SCENARIO  scenario.json from scripts/cover-drive/scenario.mjs (required)
    ///   VANDE_EVIDENCE_OUT          output directory (required)
    ///   VANDE_COVER_DRIVE_CASES     comma list of case ids for telemetry (default: all)
    ///   VANDE_COVER_DRIVE_FULL      comma list of case ids that record all 75 joints (default: every non-sweep case)
    ///   VANDE_COVER_DRIVE_CAPTURE   none | stills | video | all (default none)
    ///   VANDE_COVER_DRIVE_QUALITY   Lite | Standard | High (default High)
    ///   VANDE_BUILD_ID              build id written into every telemetry line (default NOT_AVAILABLE)
    ///
    /// Outputs: telemetry.jsonl (deterministic body; build id prefix), perf.jsonl (wall clock, never digested),
    /// unity-digests.json (SHA-256 of the telemetry bodies with the build-id prefix removed), unity-meta.json, and
    /// captures/ and frames/ when requested.
    /// </summary>
    public static class CoverDriveCaptureRig
    {
        private const double FrameHz = 60.0;
        private const int RecoveryFrames = 90;
        private static readonly string[] KeyBones =
        {
            "root", "pelvis.L", "pelvis.R", "spine03", "spine01", "neck01", "head",
            "upperarm01.L", "lowerarm01.L", "wrist.L", "upperarm01.R", "lowerarm01.R", "wrist.R",
            "upperleg01.L", "lowerleg01.L", "foot.L", "upperleg01.R", "lowerleg01.R", "foot.R"
        };

        /// <summary>
        /// The VSK1 hero skeleton order: V3_BONE_NAMES in scripts/export-unity-production-character-v3.mjs ("stable
        /// semantic order shared with the Unity decoder"). The decoder names its transforms "HeroBone-index".
        /// </summary>
        private static readonly string[] HeroBoneNames =
        {
            "root", "pelvis.L", "pelvis.R", "spine05", "spine04", "spine03", "spine02", "spine01", "neck01", "neck02",
            "neck03", "head", "jaw", "clavicle.L", "shoulder01.L", "upperarm01.L", "upperarm02.L", "lowerarm01.L",
            "lowerarm02.L", "wrist.L", "clavicle.R", "shoulder01.R", "upperarm01.R", "upperarm02.R", "lowerarm01.R",
            "lowerarm02.R", "wrist.R", "metacarpal1.L", "metacarpal2.L", "metacarpal3.L", "metacarpal4.L",
            "finger1-1.L", "finger1-2.L", "finger1-3.L", "finger2-1.L", "finger2-2.L", "finger2-3.L", "finger3-1.L",
            "finger3-2.L", "finger3-3.L", "finger4-1.L", "finger4-2.L", "finger4-3.L", "finger5-1.L", "finger5-2.L",
            "finger5-3.L", "metacarpal1.R", "metacarpal2.R", "metacarpal3.R", "metacarpal4.R", "finger1-1.R",
            "finger1-2.R", "finger1-3.R", "finger2-1.R", "finger2-2.R", "finger2-3.R", "finger3-1.R", "finger3-2.R",
            "finger3-3.R", "finger4-1.R", "finger4-2.R", "finger4-3.R", "finger5-1.R", "finger5-2.R", "finger5-3.R",
            "upperleg01.L", "upperleg02.L", "lowerleg01.L", "lowerleg02.L", "foot.L", "upperleg01.R", "upperleg02.R",
            "lowerleg01.R", "lowerleg02.R", "foot.R"
        };

        private static string BoneName(Transform bone)
        {
            const string prefix = "HeroBone-";
            if (bone.name.StartsWith(prefix, StringComparison.Ordinal) &&
                int.TryParse(bone.name.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var index) &&
                index >= 0 && index < HeroBoneNames.Length)
                return HeroBoneNames[index];
            return bone.name;
        }

        private static readonly BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        public static void Run()
        {
            var scenarioPath = Require("VANDE_COVER_DRIVE_SCENARIO");
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var buildId = Optional("VANDE_BUILD_ID", "NOT_AVAILABLE");
            var capture = Optional("VANDE_COVER_DRIVE_CAPTURE", "none");
            var quality = (PracticePresentationQuality)Enum.Parse(
                typeof(PracticePresentationQuality), Optional("VANDE_COVER_DRIVE_QUALITY", "High"));
            var started = DateTime.UtcNow;
            var scenario = JsonUtility.FromJson<ScenarioFile>(File.ReadAllText(scenarioPath, Encoding.UTF8));
            if (scenario == null || scenario.cases == null || scenario.cases.Length == 0)
                throw new InvalidDataException("The cover-drive scenario has no cases.");
            var only = SetOf(Optional("VANDE_COVER_DRIVE_CASES", string.Empty));
            var fullJoints = SetOf(Optional("VANDE_COVER_DRIVE_FULL", string.Empty));

            var bodyHash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var perCase = new SortedDictionary<string, string>(StringComparer.Ordinal);
            var lineCount = 0;
            using (var telemetry = new StreamWriter(Path.Combine(output, "telemetry.jsonl"), false, new UTF8Encoding(false)))
            using (var perf = new StreamWriter(Path.Combine(output, "perf.jsonl"), false, new UTF8Encoding(false)))
            {
                telemetry.NewLine = "\n";
                perf.NewLine = "\n";
                foreach (var entry in scenario.cases)
                {
                    if (only.Count > 0 && !only.Contains(entry.caseId)) continue;
                    var full = fullJoints.Count > 0 ? fullJoints.Contains(entry.caseId) : !entry.caseId.StartsWith("sweep", StringComparison.Ordinal);
                    var caseHash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                    foreach (var body in RecordCase(scenario, entry, quality, full, perf))
                    {
                        var bytes = Encoding.UTF8.GetBytes(body + "\n");
                        bodyHash.AppendData(bytes);
                        caseHash.AppendData(bytes);
                        telemetry.WriteLine("{\"buildId\":\"" + Escape(buildId) + "\"," + body.Substring(1));
                        lineCount++;
                    }
                    perCase[entry.caseId] = Hex(caseHash.GetHashAndReset());
                }
            }

            var digests = new StringBuilder();
            digests.Append("{\n \"method\": \"SHA-256 over telemetry.jsonl lines with the leading buildId field removed (UTF-8, LF)\",\n");
            digests.Append(" \"telemetryBodySha256\": \"").Append(Hex(bodyHash.GetHashAndReset())).Append("\",\n");
            digests.Append(" \"lines\": ").Append(lineCount).Append(",\n \"cases\": {");
            var first = true;
            foreach (var pair in perCase)
            {
                digests.Append(first ? "\n" : ",\n").Append("  \"").Append(pair.Key).Append("\": \"").Append(pair.Value).Append('"');
                first = false;
            }
            digests.Append("\n }\n}\n");
            File.WriteAllText(Path.Combine(output, "unity-digests.json"), digests.ToString(), new UTF8Encoding(false));

            if (capture == "stills" || capture == "all") CaptureStills(scenario, output, quality);
            if (capture == "video" || capture == "all") CaptureVideoFrames(scenario, output, quality);

            File.WriteAllText(Path.Combine(output, "unity-meta.json"),
                "{\n \"buildId\": \"" + Escape(buildId) + "\",\n \"unityVersion\": \"" + Application.unityVersion +
                "\",\n \"startedUtc\": \"" + started.ToString("O", CultureInfo.InvariantCulture) +
                "\",\n \"finishedUtc\": \"" + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture) +
                "\",\n \"graphicsDevice\": \"" + Escape(SystemInfo.graphicsDeviceType + " " + SystemInfo.graphicsDeviceName) +
                "\",\n \"quality\": \"" + quality + "\",\n \"capture\": \"" + Escape(capture) +
                "\",\n \"classification\": \"BUILDER_OBSERVATION_NON_HUMAN\"\n}\n", new UTF8Encoding(false));
            UnityEngine.Debug.Log("VANDE_COVER_DRIVE_RIG lines=" + lineCount + " out=" + output);
        }

        /// <summary>
        /// P2 / D3 evidence: bakes the current production batter (High detail, explicit close-up LOD0 and the live
        /// LOD1) in its code-sampled stance into OBJ files, one object per renderer, so Blender can render the
        /// current hero and a candidate under identical lighting. Writes VANDE_EVIDENCE_OUT/current-hero-*.obj.
        /// </summary>
        public static void ExportCurrentHeroAtRest()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            foreach (var closeUp in new[] { true, false })
            {
                var root = new GameObject("VANDE current hero export") { hideFlags = HideFlags.DontSave };
                try
                {
                    var rig = ProductionCharacterFactory.Create(root.transform,
                        ProductionCharacterSpec.For(ProductionCharacterRole.Batter, ProductionCharacterDetail.High));
                    rig.SetHeroCloseUp(closeUp);
                    rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
                    var obj = new StringBuilder();
                    obj.Append("# VANDE current production batter, ").Append(closeUp ? "close-up LOD0" : "live LOD1")
                        .Append(", code-sampled BatterStance(0). Builder evidence only; never shipped.\n");
                    var offset = 1;
                    var stats = new StringBuilder();
                    foreach (var renderer in root.GetComponentsInChildren<Renderer>(false))
                    {
                        if (!renderer.enabled) continue;
                        Mesh mesh;
                        var bakedMesh = false;
                        if (renderer is SkinnedMeshRenderer skinned)
                        {
                            mesh = new Mesh();
                            skinned.BakeMesh(mesh, true);
                            bakedMesh = true;
                        }
                        else
                        {
                            var filter = renderer.GetComponent<MeshFilter>();
                            if (filter == null || filter.sharedMesh == null) continue;
                            mesh = filter.sharedMesh;
                        }
                        var m = renderer.transform.localToWorldMatrix;
                        if (bakedMesh) m = Matrix4x4.TRS(renderer.transform.position, renderer.transform.rotation, Vector3.one);
                        var vertices = mesh.vertices;
                        var normals = mesh.normals;
                        var uvs = mesh.uv;
                        obj.Append("o ").Append(renderer.name.Replace(' ', '_')).Append('\n');
                        foreach (var vertex in vertices)
                        {
                            var w = m.MultiplyPoint3x4(vertex);
                            obj.Append("v ").Append(F(-w.x)).Append(' ').Append(F(w.y)).Append(' ').Append(F(w.z)).Append('\n');
                        }
                        var hasUv = uvs != null && uvs.Length == vertices.Length;
                        if (hasUv) foreach (var uv in uvs) obj.Append("vt ").Append(F(uv.x)).Append(' ').Append(F(uv.y)).Append('\n');
                        var hasN = normals != null && normals.Length == vertices.Length;
                        if (hasN)
                            foreach (var n in normals)
                            {
                                var w = m.MultiplyVector(n).normalized;
                                obj.Append("vn ").Append(F(-w.x)).Append(' ').Append(F(w.y)).Append(' ').Append(F(w.z)).Append('\n');
                            }
                        var triangles = mesh.triangles;
                        for (var i = 0; i < triangles.Length; i += 3)
                        {
                            obj.Append('f');
                            // Mirror X (Unity left-handed → OBJ right-handed) and reverse winding.
                            foreach (var corner in new[] { triangles[i], triangles[i + 2], triangles[i + 1] })
                            {
                                var idx = corner + offset;
                                obj.Append(' ').Append(idx);
                                if (hasUv || hasN) obj.Append('/').Append(hasUv ? idx.ToString(CultureInfo.InvariantCulture) : string.Empty);
                                if (hasN) obj.Append('/').Append(idx);
                            }
                            obj.Append('\n');
                        }
                        stats.Append(renderer.name).Append(": ").Append(vertices.Length).Append(" vertices, ")
                            .Append(triangles.Length / 3).Append(" triangles\n");
                        offset += vertices.Length;
                        if (bakedMesh) UnityEngine.Object.DestroyImmediate(mesh);
                    }
                    var label = closeUp ? "lod0" : "lod1";
                    File.WriteAllText(Path.Combine(output, "current-hero-" + label + ".obj"), obj.ToString(), new UTF8Encoding(false));
                    File.WriteAllText(Path.Combine(output, "current-hero-" + label + ".txt"),
                        "heightMetres " + F(rig.HeightMetres) + "\nheroBones " + rig.HeroBoneCount + "\n" + stats, new UTF8Encoding(false));
                    rig.Dispose();
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
            UnityEngine.Debug.Log("VANDE_COVER_DRIVE current hero OBJ written to " + output);
        }

        // ------------------------------------------------------------------------------------------------------
        // Telemetry
        // ------------------------------------------------------------------------------------------------------

        private static IEnumerable<string> RecordCase(ScenarioFile scenario, ScenarioCase entry,
            PracticePresentationQuality quality, bool fullJoints, StreamWriter perf)
        {
            var lines = new List<string>();
            using (var session = new WorldSession(entry, quality))
            {
                var world = session.World;
                var result = session.Result;
                var contact = FirstBatContact(result.Trace);
                var traceEvents = new List<string>();
                world.TraceEvent += value => traceEvents.Add(
                    "{\"type\":\"trace_event\",\"kind\":\"" + Escape(value.kind) + "\",\"t\":" + D(value.t) +
                    ",\"atTimeline\":" + D(world.Timeline) + ",\"contact\":" + S(value.contact) + "}");
                session.Sink.Recorded = value => traceEvents.Add(
                    "{\"type\":\"feedback\",\"kind\":\"" + value.Kind + "\",\"simulationTime\":" + D(value.SimulationTime) +
                    ",\"atTimeline\":" + D(world.Timeline) + ",\"contact\":" + S(value.Contact) + "}");

                var header = new StringBuilder();
                header.Append("{\"type\":\"case\",\"scenarioId\":\"").Append(Escape(scenario.scenarioId))
                    .Append("\",\"caseId\":\"").Append(Escape(entry.caseId))
                    .Append("\",\"deliveryId\":\"").Append(Escape(entry.deliveryId))
                    .Append("\",\"quality\":\"").Append(quality)
                    .Append("\",\"heroBundle\":").Append(session.HeroBones != null ? "true" : "false")
                    .Append(",\"bones\":").Append(session.HeroBones != null ? session.HeroBones.Length : 0)
                    .Append(",\"heightMetres\":").Append(F(session.Rig != null ? session.Rig.HeightMetres : 0f))
                    .Append(",\"physicsContact\":{\"kind\":").Append(S(result.ContactKind))
                    .Append(",\"timing\":").Append(S(result.ContactTiming))
                    .Append(",\"t\":").Append(contact != null ? D(contact.t) : "null")
                    .Append(",\"p\":").Append(contact != null && contact.p != null ? TV(contact.p) : "null")
                    .Append("},\"batterMotion\":")
                    .Append(result.Trace.batterMotion != null
                        ? "{\"startT\":" + D(result.Trace.batterMotion.startT) + ",\"contactT\":" +
                          D(result.Trace.batterMotion.contactT) + ",\"endT\":" + D(result.Trace.batterMotion.endT) + "}"
                        : "null")
                    .Append(",\"durationSeconds\":").Append(D(result.Trace.durationSeconds))
                    .Append(",\"footwork\":").Append(S(result.Footwork))
                    .Append(",\"ikCorrection\":\"NOT_AVAILABLE: the current runtime has no separable authored clip, so ")
                    .Append("the hand/joint correction against a clip cannot be measured; gripGap is reported as a proxy\"}");
                lines.Add(header.ToString());

                var frame = 0;
                var completed = false;
                var framesAfterCompletion = 0;
                world.DeliveryCompleted += (deadT, digest) => completed = true;
                var startTimeline = world.Timeline;
                var k = (long)Math.Ceiling(startTimeline * FrameHz - 1e-9);
                Vector3? previousBall = null;
                var stopwatch = new Stopwatch();
                while (true)
                {
                    var target = k / FrameHz;
                    stopwatch.Restart();
                    if (!session.Accepted)
                    {
                        if (target >= entry.hostSendT)
                        {
                            world.Tick(Math.Max(0.0, entry.hostSendT - world.Timeline));
                            session.AcceptFromHost();
                        }
                        world.Tick(Math.Max(0.0, target - world.Timeline));
                    }
                    else if (!completed)
                    {
                        world.Tick(Math.Max(0.0, target - world.Timeline));
                    }
                    else
                    {
                        world.Tick(1.0 / FrameHz);
                        framesAfterCompletion++;
                    }
                    stopwatch.Stop();
                    foreach (var line in traceEvents) lines.Add(line);
                    traceEvents.Clear();
                    lines.Add(FrameLine(session, entry, frame, frame / FrameHz, target, fullJoints, ref previousBall));
                    perf.WriteLine("{\"caseId\":\"" + Escape(entry.caseId) + "\",\"frame\":" + frame + ",\"tickMs\":" +
                                   D(stopwatch.Elapsed.TotalMilliseconds) + ",\"allocatedBytes\":" +
                                   Profiler.GetTotalAllocatedMemoryLong() + ",\"monoUsedBytes\":" +
                                   Profiler.GetMonoUsedSizeLong() + "}");
                    frame++;
                    k++;
                    if (completed && framesAfterCompletion >= RecoveryFrames) break;
                    if (frame > 20000) throw new InvalidOperationException("Case did not complete: " + entry.caseId);
                }
            }
            return lines;
        }

        private static string FrameLine(WorldSession session, ScenarioCase entry, int frame, double frameClock,
            double gridT, bool fullJoints, ref Vector3? previousBall)
        {
            var world = session.World;
            var sb = new StringBuilder(fullJoints ? 9000 : 2600);
            sb.Append("{\"type\":\"frame\",\"caseId\":\"").Append(Escape(entry.caseId)).Append("\",\"frame\":").Append(frame)
                .Append(",\"frameClock\":").Append(D(frameClock))
                .Append(",\"gridT\":").Append(D(gridT))
                .Append(",\"traceT\":").Append(D(world.Timeline))
                .Append(",\"state\":\"").Append(session.State()).Append('"')
                .Append(",\"inputTimestampMs\":").Append(entry.gestureInputTimestampMs > 0 ? D(entry.gestureInputTimestampMs) : "null")
                .Append(",\"swingIntent\":").Append(S(session.Result.ShotIntent))
                .Append(",\"clip\":{\"name\":\"BatterStroke(code-sampled ProductionCharacterMotion)\",\"phase\":")
                .Append(session.StrokePhase()).Append(",\"blend\":").Append(session.BodyBlend()).Append('}');

            var bones = session.HeroBones;
            sb.Append(",\"joints\":{");
            var firstJoint = true;
            if (bones != null)
            {
                foreach (var bone in bones)
                {
                    if (bone == null) continue;
                    var boneName = BoneName(bone);
                    if (!fullJoints && Array.IndexOf(KeyBones, boneName) < 0) continue;
                    if (!firstJoint) sb.Append(',');
                    firstJoint = false;
                    sb.Append('"').Append(Escape(boneName)).Append("\":[").Append(V3(bone.position)).Append(',')
                        .Append(Q(bone.rotation)).Append(']');
                }
            }
            else if (session.Rig != null)
            {
                for (var index = 0; index < (int)ProductionCharacterJoint.Count; index++)
                {
                    var joint = session.Rig.Joint((ProductionCharacterJoint)index);
                    if (joint == null) continue;
                    if (!firstJoint) sb.Append(',');
                    firstJoint = false;
                    sb.Append('"').Append((ProductionCharacterJoint)index).Append("\":[").Append(V3(joint.position))
                        .Append(',').Append(Q(joint.rotation)).Append(']');
                }
            }
            sb.Append('}');

            if (session.Rig != null)
            {
                var leftFoot = session.Rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                var rightFoot = session.Rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
                sb.Append(",\"feet\":{\"left\":[").Append(V3(leftFoot)).Append("],\"right\":[").Append(V3(rightFoot))
                    .Append("]}");
                var bat = session.Rig.Bat;
                if (bat != null)
                {
                    sb.Append(",\"bat\":{\"p\":[").Append(V3(bat.position)).Append("],\"q\":[").Append(Q(bat.rotation))
                        .Append("],\"faceNormal\":[").Append(V3(bat.forward)).Append("],\"handleUp\":[")
                        .Append(V3(bat.up)).Append("]}");
                    var leftHand = session.Rig.HeroJointWorldPosition(ProductionCharacterJoint.HandLeft);
                    var rightHand = session.Rig.HeroJointWorldPosition(ProductionCharacterJoint.HandRight);
                    sb.Append(",\"gripGap\":{\"left\":").Append(F(SegmentDistance(leftHand, bat.position, bat.position - bat.up * 0.30f)))
                        .Append(",\"right\":").Append(F(SegmentDistance(rightHand, bat.position, bat.position - bat.up * 0.30f)))
                        .Append('}');
                }
                var hips = session.Rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                var head = session.Rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                sb.Append(",\"hips\":[").Append(V3(hips)).Append("],\"head\":[").Append(V3(head)).Append(']');
            }

            if (session.Ball != null)
            {
                var p = session.Ball.position;
                var v = previousBall.HasValue ? (p - previousBall.Value) * (float)FrameHz : Vector3.zero;
                previousBall = p;
                var renderer = session.Ball.GetComponentInChildren<Renderer>();
                sb.Append(",\"ball\":{\"p\":[").Append(V3(p)).Append("],\"vFiniteDiff\":[").Append(V3(v))
                    .Append("],\"visible\":").Append(renderer != null && renderer.enabled && session.Ball.gameObject.activeInHierarchy ? "true" : "false")
                    .Append('}');
            }
            if (session.Camera != null)
            {
                var c = session.Camera.transform;
                sb.Append(",\"camera\":{\"p\":[").Append(V3(c.position)).Append("],\"q\":[").Append(Q(c.rotation))
                    .Append("],\"vfovDeg\":").Append(F(session.Camera.fieldOfView)).Append('}');
            }
            sb.Append('}');
            return sb.ToString();
        }

        // ------------------------------------------------------------------------------------------------------
        // Captures (Appendix B): stills and 60 fps frame sequences. Encoding is done by scripts/cover-drive/p1.mjs.
        // ------------------------------------------------------------------------------------------------------

        private static readonly (string Name, int W, int H)[] StillSizes = { ("1920x1080", 1920, 1080), ("915x412", 915, 412) };

        private static void CaptureStills(ScenarioFile scenario, string output, PracticePresentationQuality quality)
        {
            var dir = Path.Combine(output, "captures");
            Directory.CreateDirectory(dir);
            var ideal = Find(scenario, "ideal");
            var leave = Find(scenario, "leave") ?? ideal;
            // Stance: the leave case before the run-up gather (the batter at rest in the production world).
            using (var session = new WorldSession(leave, quality))
            {
                StepTo(session, session.World.Timeline + 0.25);
                RenderViews(session, dir, "stance", true);
            }
            if (ideal == null) return;
            using (var session = new WorldSession(ideal, quality))
            {
                var contact = FirstBatContact(session.Result.Trace);
                var contactT = contact != null ? contact.t : session.Result.Trace.batterMotion?.contactT ?? 0.47;
                StepTo(session, contactT);
                RenderViews(session, dir, "contact", false);
                StepTo(session, contactT + 0.27);
                RenderViews(session, dir, "follow-through", false);
            }
        }

        private static void CaptureVideoFrames(ScenarioFile scenario, string output, PracticePresentationQuality quality)
        {
            var ideal = Find(scenario, "ideal");
            if (ideal == null) return;
            foreach (var (label, hz, hideBall) in new[] { ("1x", 60.0, false), ("0.25x", 240.0, false), ("1x-noball", 60.0, true) })
            {
                using (var session = new WorldSession(ideal, quality))
                {
                    var motion = session.Result.Trace.batterMotion;
                    var startT = motion != null ? motion.startT - 0.60 : -0.3;
                    var endT = motion != null ? motion.contactT + 1.20 : 1.6;
                    StepTo(session, startT);
                    var dir = Path.Combine(output, "frames", "ideal-" + label);
                    Directory.CreateDirectory(Path.Combine(dir, "side-on"));
                    Directory.CreateDirectory(Path.Combine(dir, "live"));
                    var index = 0;
                    for (var t = startT; t <= endT + 1e-9; t = startT + (index) / hz)
                    {
                        StepTo(session, t);
                        if (hideBall && session.Ball != null) session.Ball.gameObject.SetActive(false);
                        var name = index.ToString("D5", CultureInfo.InvariantCulture) + ".jpg";
                        session.Inspection(InspectionView.SideOn);
                        RenderPosed(session.InspectionCamera, session.Root.transform, 1280, 720, Path.Combine(dir, "side-on", name));
                        if (label != "0.25x")
                            RenderPosed(session.Camera, session.Root.transform, 1280, 576, Path.Combine(dir, "live", name));
                        index++;
                    }
                }
            }
        }

        private static void RenderViews(WorldSession session, string dir, string pose, bool face)
        {
            foreach (var (name, w, h) in StillSizes)
            {
                foreach (var view in new[] { InspectionView.SideOn, InspectionView.FrontOn, InspectionView.Behind })
                {
                    session.Inspection(view);
                    RenderPosed(session.InspectionCamera, session.Root.transform, w, h,
                        Path.Combine(dir, pose + "-" + view.ToString().ToLowerInvariant() + "-" + name + ".jpg"));
                }
                if (face)
                {
                    session.Inspection(InspectionView.Face);
                    RenderPosed(session.InspectionCamera, session.Root.transform, w, h, Path.Combine(dir, pose + "-face-" + name + ".jpg"));
                }
                if (session.Camera != null)
                    RenderPosed(session.Camera, session.Root.transform, w, h, Path.Combine(dir, pose + "-live-" + name + ".jpg"));
            }
        }

        private static void StepTo(WorldSession session, double t)
        {
            var world = session.World;
            var guard = 0;
            while (world.Timeline < t - 1e-9 && guard++ < 100000)
            {
                var before = world.Timeline;
                var next = Math.Min(t, (Math.Floor(world.Timeline * FrameHz + 1e-9) + 1.0) / FrameHz);
                if (!session.Accepted && next >= session.HostSendT && world.Timeline < session.HostSendT)
                {
                    world.Tick(Math.Max(0.0, session.HostSendT - world.Timeline));
                    session.AcceptFromHost();
                }
                world.Tick(Math.Max(0.0, next - world.Timeline));
                if (world.Timeline <= before && session.Accepted) world.Tick(1.0 / FrameHz);
                if (world.Timeline <= before) break;
            }
        }

        /// <summary>Same as VandeWedgeUnityEvidence.RenderPosed: bake every skinned mesh first (batchmode has no player loop).</summary>
        private static void RenderPosed(Camera camera, Transform root, int width, int height, string path)
        {
            var baked = new List<GameObject>();
            var hidden = new List<SkinnedMeshRenderer>();
            try
            {
                foreach (var skinned in root.GetComponentsInChildren<SkinnedMeshRenderer>(false))
                {
                    if (!skinned.enabled) continue;
                    var mesh = new Mesh { name = "baked " + skinned.name };
                    skinned.BakeMesh(mesh, true);
                    var copy = new GameObject("baked " + skinned.name);
                    copy.transform.SetPositionAndRotation(skinned.transform.position, skinned.transform.rotation);
                    copy.AddComponent<MeshFilter>().sharedMesh = mesh;
                    copy.AddComponent<MeshRenderer>().sharedMaterials = skinned.sharedMaterials;
                    baked.Add(copy);
                    skinned.enabled = false;
                    hidden.Add(skinned);
                }
                var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
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
                    File.WriteAllBytes(path, pixels.EncodeToJPG(92));
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
            finally
            {
                foreach (var skinned in hidden) skinned.enabled = true;
                foreach (var copy in baked)
                {
                    UnityEngine.Object.DestroyImmediate(copy.GetComponent<MeshFilter>().sharedMesh);
                    UnityEngine.Object.DestroyImmediate(copy);
                }
            }
        }

        // ------------------------------------------------------------------------------------------------------
        // One production world per case
        // ------------------------------------------------------------------------------------------------------

        private enum InspectionView { SideOn, FrontOn, Behind, Face }

        private sealed class WorldSession : IDisposable
        {
            private readonly PracticeDeliveryPresentation delivery;
            private readonly PracticeSwingPresentation provisionalSwing;
            private readonly FieldInfo stateField;
            private readonly FieldInfo strokeAvailableField;
            private readonly FieldInfo blendElapsedField;
            private readonly MethodInfo phaseMethod;
            private readonly float blendSeconds;
            private Vector3 stanceHips;
            private Vector3 stanceHead;

            public WorldSession(ScenarioCase entry, PracticePresentationQuality quality)
            {
                var scene = PracticePresentationContractAdapter.Scene(Decode(entry.packets.scene).Envelope);
                delivery = PracticePresentationContractAdapter.Delivery(Decode(entry.packets.delivery).Envelope);
                Result = PracticePresentationContractAdapter.Result(Decode(entry.packets.result).Envelope);
                provisionalSwing = entry.packets.provisionalSwing != null && !string.IsNullOrEmpty(entry.packets.provisionalSwing.body)
                    ? PracticePresentationContractAdapter.ProvisionalSwing(Decode(entry.packets.provisionalSwing).Envelope)
                    : null;
                HostSendT = entry.hostSendT;
                Root = new GameObject("VANDE cover-drive rig " + entry.caseId) { hideFlags = HideFlags.DontSave };
                Sink = new RecordingSink();
                World = Root.AddComponent<ProceduralPracticeWorld>();
                World.Configure(new PracticePresentationSettings
                {
                    Locale = "en-IN", Quality = quality, Assistance = "real", Handedness = scene.Handedness,
                    ReducedMotion = false, Captions = true, Audio = false, Haptics = false
                }, Sink);
                World.ConfigureScene(scene);
                var type = typeof(ProceduralPracticeWorld);
                Rig = type.GetField("batterRig", Private)?.GetValue(World) as ProductionCharacterRig;
                Camera = type.GetField("batterCamera", Private)?.GetValue(World) as Camera;
                stateField = type.GetField("state", Private);
                strokeAvailableField = type.GetField("canonicalStrokeAvailable", Private);
                blendElapsedField = type.GetField("canonicalBodyBlendElapsed", Private);
                phaseMethod = type.GetMethod("CanonicalBatterPhase", Private, null, new[] { typeof(double) }, null);
                var blendConst = type.GetField("CanonicalBodyBlendSeconds", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
                blendSeconds = blendConst != null ? Convert.ToSingle(blendConst.GetValue(null), CultureInfo.InvariantCulture) : 0.08f;
                if (Rig != null)
                {
                    var renderer = typeof(ProductionCharacterRig).GetProperty("HeroSkinnedRenderer", Private)?.GetValue(Rig) as SkinnedMeshRenderer;
                    HeroBones = renderer != null ? renderer.bones : null;
                }
                World.BeginDelivery(delivery);
                Ball = FindDescendant(Root.transform, "ProductionCricketBall");
                if (Rig != null)
                {
                    stanceHips = Rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                    stanceHead = Rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                }
                var cameraObject = new GameObject("CoverDriveInspectionCamera");
                cameraObject.transform.SetParent(Root.transform, false);
                InspectionCamera = cameraObject.AddComponent<Camera>();
                InspectionCamera.enabled = false;
                InspectionCamera.nearClipPlane = 0.05f;
                InspectionCamera.farClipPlane = 250f;
                if (Camera != null)
                {
                    InspectionCamera.clearFlags = Camera.clearFlags;
                    InspectionCamera.backgroundColor = Camera.backgroundColor;
                    InspectionCamera.cullingMask = Camera.cullingMask;
                }
            }

            public GameObject Root { get; }
            public ProceduralPracticeWorld World { get; }
            public PracticeResultPresentation Result { get; }
            public RecordingSink Sink { get; }
            public ProductionCharacterRig Rig { get; }
            public Transform[] HeroBones { get; }
            public Camera Camera { get; }
            public Camera InspectionCamera { get; }
            public Transform Ball { get; }
            public bool Accepted { get; private set; }
            public double HostSendT { get; }

            /// <summary>
            /// What the live host sends once the gesture is read (src/practice/unity/stage.ts): host.provisional_swing,
            /// then host.result, at HostSendT on the trace clock with zero bridge latency. Unity's own touch-driven
            /// local bat preview before that moment is not reproduced (no synthetic touch).
            /// </summary>
            public void AcceptFromHost()
            {
                if (Accepted) return;
                Accepted = true;
                if (provisionalSwing != null) World.ApplyProvisionalSwing(provisionalSwing);
                World.AcceptResult(Result);
                World.Tick(0.0);
            }

            public string State() => stateField != null ? Convert.ToString(stateField.GetValue(World), CultureInfo.InvariantCulture) : "unknown";

            public string StrokePhase()
            {
                if (phaseMethod == null || strokeAvailableField == null) return "null";
                if (!(bool)strokeAvailableField.GetValue(World) || !Accepted) return "null";
                return F((float)phaseMethod.Invoke(World, new object[] { World.Timeline }));
            }

            public string BodyBlend()
            {
                if (blendElapsedField == null || !Accepted) return "null";
                var elapsed = Convert.ToDouble(blendElapsedField.GetValue(World), CultureInfo.InvariantCulture);
                return D(Math.Min(1.0, elapsed / blendSeconds));
            }

            /// <summary>Fixed inspection cameras around the batter's stance (they do not follow the stroke).</summary>
            public void Inspection(InspectionView view)
            {
                var hips = stanceHips;
                var t = InspectionCamera.transform;
                switch (view)
                {
                    case InspectionView.SideOn: // square on the off side (point): sees the chest of a right-hander
                        t.position = hips + new Vector3(4.4f, 0.10f, 0.35f);
                        t.LookAt(hips + new Vector3(0f, -0.05f, 0.35f));
                        InspectionCamera.fieldOfView = 34f;
                        break;
                    case InspectionView.FrontOn: // from the bowler's end
                        t.position = hips + new Vector3(0.15f, 0.15f, -4.6f);
                        t.LookAt(hips + new Vector3(0.15f, -0.05f, 0f));
                        InspectionCamera.fieldOfView = 34f;
                        break;
                    case InspectionView.Behind: // from behind the stumps, slightly raised
                        t.position = hips + new Vector3(-0.2f, 0.45f, 4.8f);
                        t.LookAt(hips + new Vector3(0.1f, -0.1f, 0f));
                        InspectionCamera.fieldOfView = 34f;
                        break;
                    default: // face close-up from the off side and the bowler's end
                        t.position = stanceHead + new Vector3(0.75f, 0.02f, -0.55f);
                        t.LookAt(stanceHead);
                        InspectionCamera.fieldOfView = 26f;
                        break;
                }
            }

            public void Dispose()
            {
                try { World.Stop(); } catch (Exception) { /* evidence teardown */ }
                UnityEngine.Object.DestroyImmediate(Root);
            }
        }

        private sealed class RecordingSink : IPracticeFeedbackSink
        {
            public Action<PracticeFeedbackEvent> Recorded;
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) => Recorded?.Invoke(feedback);
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }

        // ------------------------------------------------------------------------------------------------------
        // Helpers
        // ------------------------------------------------------------------------------------------------------

        private static CanonicalTraceEvent FirstBatContact(CanonicalDeliveryTrace trace)
        {
            if (trace?.events == null) return null;
            foreach (var e in trace.events)
            {
                if (e.kind != "contact") continue;
                switch (e.contact)
                {
                    case "middle": case "inside_edge": case "outside_edge": case "top_edge": case "leading_edge":
                    case "toe": case "shoulder":
                        return e;
                }
            }
            return null;
        }

        private static ScenarioCase Find(ScenarioFile scenario, string id)
        {
            foreach (var c in scenario.cases) if (c.caseId == id) return c;
            return null;
        }

        private static DecodedUnityPracticePacket Decode(UnityPracticePacket packet)
        {
            if (packet == null) throw new InvalidDataException("The scenario contains a null packet.");
            return UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet));
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root.name == name) return root;
            for (var index = 0; index < root.childCount; index++)
            {
                var found = FindDescendant(root.GetChild(index), name);
                if (found != null) return found;
            }
            return null;
        }

        private static float SegmentDistance(Vector3 p, Vector3 a, Vector3 b)
        {
            var ab = b - a;
            var u = Mathf.Clamp01(Vector3.Dot(p - a, ab) / Mathf.Max(1e-9f, ab.sqrMagnitude));
            return Vector3.Distance(p, a + ab * u);
        }

        private static HashSet<string> SetOf(string list)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            foreach (var part in list.Split(',')) if (part.Trim().Length > 0) set.Add(part.Trim());
            return set;
        }

        private static string Require(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("Set " + name + ".");
            return value;
        }

        private static string Optional(string name, string fallback)
        {
            var value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        }

        private static string Hex(byte[] bytes)
        {
            var sb = new StringBuilder(bytes.Length * 2);
            foreach (var b in bytes) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
            return sb.ToString();
        }

        private static string F(float value) => value.ToString("R", CultureInfo.InvariantCulture);
        private static string D(double value) => value.ToString("R", CultureInfo.InvariantCulture);
        private static string V3(Vector3 v) => F(v.x) + "," + F(v.y) + "," + F(v.z);
        private static string Q(Quaternion q) => F(q.x) + "," + F(q.y) + "," + F(q.z) + "," + F(q.w);
        private static string TV(TraceVector3 v) => "[" + D(v.x) + "," + D(v.y) + "," + D(v.z) + "]";
        private static string S(string value) => value == null ? "null" : "\"" + Escape(value) + "\"";

        private static string Escape(string value)
        {
            if (value == null) return string.Empty;
            var sb = new StringBuilder(value.Length);
            foreach (var c in value)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        [Serializable]
        private sealed class ScenarioFile
        {
            public string scenarioId;
            public int frameHz;
            public ScenarioCase[] cases;
        }

        [Serializable]
        private sealed class ScenarioCase
        {
            public string caseId;
            public string deliveryId;
            public double gestureInputTimestampMs;
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
