using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// Builder evidence for the wedge Unity track (batchmode -executeMethod). Nothing here changes the runtime; every
    /// output goes to the folder named by VANDE_EVIDENCE_OUT. Builder observations only, never a gate decision.
    /// </summary>
    public static class VandeWedgeUnityEvidence
    {
        private static readonly int[][] Views =
        {
            new[] { 915, 412 }, new[] { 844, 390 }, new[] { 640, 360 }, new[] { 1280, 720 }
        };

        /// <summary>
        /// F-012 for the rear camera, by the world REPORT's method (Track D f012.spec.ts): each reference-over flight
        /// (VANDE_F012_FLIGHTS, exported from the TypeScript physics) is projected through the Unity batting camera as
        /// the world composes it (BatterCameraPosition/Target, 58° horizontal FOV held as the aspect changes, near
        /// 0.08 m) from release to ideal contact; "out of view before contact" is ideal contact minus the last instant
        /// the ball's whole disc is inside the viewport. The camera is static until contact (Delivery Quiet Mode).
        /// Frustum only, like the web method: occlusion by the batter's body is not measured here.
        /// </summary>
        public static void MeasureF012()
        {
            var input = Require("VANDE_F012_FLIGHTS");
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var flights = JsonUtility.FromJson<FlightSet>(File.ReadAllText(input));
            var cameraObject = new GameObject("F012 camera");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.nearClipPlane = 0.08f;
                camera.farClipPlane = 180f;
                var position = ProceduralPracticeWorld.BatterCameraPosition(0f, 0f, 1f);
                var target = ProceduralPracticeWorld.BatterCameraTarget(0f);
                camera.transform.SetPositionAndRotation(position,
                    Quaternion.LookRotation((target - position).normalized, Vector3.up));
                var json = new StringBuilder();
                json.Append("{\"what\":\"F-012 for the Unity rear-shoulder camera (builder observation). Method: world REPORT ")
                    .Append("§1.5 / Track D f012.spec.ts (ball disc fully inside the viewport, release to ideal contact), ")
                    .Append("projected through a Unity Camera composed exactly as ProceduralPracticeWorld composes it. ")
                    .Append("Frustum only; occlusion by the batter is not measured. Right-handed batter, lateral 0, crease 0.\",");
                json.Append("\"camera\":{\"position\":").Append(V(position)).Append(",\"target\":").Append(V(target))
                    .Append(",\"horizontalFovDeg\":").Append(F(ProceduralPracticeWorld.TargetHorizontalFovDegrees))
                    .Append(",\"near\":0.08,\"staticUntilContact\":true},");
                json.Append("\"ballRadiusM\":").Append(F(CricketPropDimensions.BallRadius))
                    .Append(",\"minimumReadabilityDiameterPx\":3.5,\"rows\":[");
                var first = true;
                foreach (var ball in flights.balls)
                {
                    foreach (var view in Views)
                    {
                        var width = view[0];
                        var height = view[1];
                        camera.aspect = width / (float)height;
                        camera.fieldOfView = ProceduralPracticeWorld.VerticalFovForHorizontal(
                            ProceduralPracticeWorld.TargetHorizontalFovDegrees, camera.aspect);
                        var focal = height / 2.0 / Math.Tan(camera.fieldOfView * Math.PI / 360.0);
                        double? lastIn = null;
                        var marks = new Dictionary<string, string>();
                        var minDiameter = double.PositiveInfinity;
                        foreach (var sample in ball.samples)
                        {
                            if (sample.t < 0 || sample.t > ball.idealContactT) continue;
                            var world = new Vector3((float)sample.x, (float)sample.y, (float)sample.z);
                            var viewport = camera.WorldToViewportPoint(world);
                            var depth = viewport.z;
                            var sx = viewport.x * width;
                            var sy = (1.0 - viewport.y) * height;
                            var radius = depth > 0 ? CricketPropDimensions.BallRadius * focal / depth : 0.0;
                            var inside = depth > camera.nearClipPlane && sx - radius >= 0 && sy - radius >= 0 &&
                                         sx + radius <= width && sy + radius <= height;
                            if (inside) lastIn = sample.t;
                            if (inside) minDiameter = Math.Min(minDiameter, 2 * radius);
                            Mark(marks, "release", 0.0, sample.t, sx, sy, radius, width, height);
                            Mark(marks, "bounce", ball.bounceT, sample.t, sx, sy, radius, width, height);
                            Mark(marks, "near5", ball.near5T, sample.t, sx, sy, radius, width, height);
                        }
                        var outBefore = lastIn.HasValue ? (ball.idealContactT - lastIn.Value) * 1000.0 : double.PositiveInfinity;
                        if (!first) json.Append(',');
                        first = false;
                        json.Append("{\"ball\":").Append(ball.ball).Append(",\"view\":\"").Append(width).Append('x')
                            .Append(height).Append("\",\"vfovDeg\":").Append(F(camera.fieldOfView))
                            .Append(",\"idealContactT\":").Append(F(ball.idealContactT))
                            .Append(",\"outBeforeContactMs\":").Append(F(outBefore))
                            .Append(",\"minInViewDiameterPx\":").Append(F(minDiameter))
                            .Append(",\"at\":{").Append(string.Join(",", marks.Select(pair => "\"" + pair.Key + "\":" + pair.Value)))
                            .Append("}}");
                    }
                }
                json.Append("]}");
                File.WriteAllText(Path.Combine(output, "f012-rear-camera.json"), json.ToString());
                Debug.Log("VANDE_EVIDENCE F-012 rear camera written to " + output);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        /// <summary>
        /// Board audit captures: the painted neutral strip itself, the live batting view on a reference delivery, and a
        /// close view of the boundary boards, all rendered by the production world (High profile, 915×412 × 2).
        /// </summary>
        public static void CaptureBoards()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var strip = ProductionPracticeBoards.PaintCanvas(1f, out var stripWidth, out var stripHeight);
            var stripTexture = new Texture2D(stripWidth, stripHeight, TextureFormat.RGBA32, false);
            var rows = new Color[strip.Length];
            for (var y = 0; y < stripHeight; y++)
                for (var x = 0; x < stripWidth; x++)
                    rows[(stripHeight - 1 - y) * stripWidth + x] = strip[y * stripWidth + x];
            stripTexture.SetPixels(rows);
            stripTexture.Apply();
            File.WriteAllBytes(Path.Combine(output, "boards-strip-2048x64.png"), stripTexture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(stripTexture);

            var root = new GameObject("VANDE board audit");
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = "right",
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.High
                }, new SilentSink());
                world.ConfigureScene(Scene());
                world.BeginDelivery(Delivery());
                var camera = root.GetComponentsInChildren<Camera>(true).First();
                Render(camera, 1830, 824, Path.Combine(output, "batting-view-runup-915x412@2x.png"));
                world.Tick(2.6);
                Render(camera, 1830, 824, Path.Combine(output, "batting-view-flight-915x412@2x.png"));

                var position = camera.transform.position;
                var rotation = camera.transform.rotation;
                var fov = camera.fieldOfView;
                camera.transform.SetPositionAndRotation(new Vector3(-30f, 1.2f, 30f),
                    Quaternion.LookRotation(new Vector3(-0.55f, -0.05f, 0.83f), Vector3.up));
                camera.fieldOfView = 24f;
                Render(camera, 1830, 824, Path.Combine(output, "boards-close-915x412@2x.png"));
                camera.transform.SetPositionAndRotation(new Vector3(0f, 1.6f, 20f),
                    Quaternion.LookRotation(new Vector3(0f, -0.02f, -1f), Vector3.up));
                camera.fieldOfView = 40f;
                Render(camera, 1830, 824, Path.Combine(output, "behind-bowler-boards-plate-915x412@2x.png"));
                camera.transform.SetPositionAndRotation(position, rotation);
                camera.fieldOfView = fov;
                Debug.Log("VANDE_EVIDENCE board captures written to " + output);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>
        /// Builds the macOS standalone theme probe (VANDE_THEME_PROBE) into VANDE_EVIDENCE_OUT and records the build
        /// report's packed entries for the theme. A temporary empty scene is created and removed again.
        /// </summary>
        public static void BuildThemeProbe()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            const string scenePath = "Assets/VandeThemeProbeTemporary.unity";
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.SaveScene(scene, scenePath);
            try
            {
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { scenePath },
                    locationPathName = Path.Combine(output, "VandeThemeProbe.app"),
                    target = BuildTarget.StandaloneOSX,
                    targetGroup = BuildTargetGroup.Standalone,
                    options = BuildOptions.None,
                    extraScriptingDefines = new[] { "VANDE_THEME_PROBE" }
                });
                var summary = new StringBuilder();
                summary.Append("{\"result\":\"").Append(report.summary.result).Append("\",\"totalSize\":")
                    .Append(report.summary.totalSize).Append(",\"packed\":[");
                var first = true;
                foreach (var file in report.packedAssets)
                {
                    foreach (var content in file.contents)
                    {
                        var path = content.sourceAssetPath ?? string.Empty;
                        if (!(path.Contains("VandeProductionHudTheme") || path.Contains("UnityThemes") ||
                              path.Contains("UIToolkit") || path.Contains("UIElements") ||
                              path.Contains("Audio/Cricket") || path.Contains("unity default resources") ||
                              path.Contains("unity_builtin_extra")))
                            continue;
                        if (!first) summary.Append(',');
                        first = false;
                        summary.Append("{\"file\":\"").Append(Escape(file.shortPath)).Append("\",\"source\":\"")
                            .Append(Escape(path)).Append("\",\"type\":\"").Append(content.type?.Name)
                            .Append("\",\"bytes\":").Append(content.packedSize).Append('}');
                    }
                }
                summary.Append("]}");
                File.WriteAllText(Path.Combine(output, "theme-probe-build.json"), summary.ToString());
                Debug.Log("VANDE_EVIDENCE theme probe build " + report.summary.result + " " + report.summary.totalSize);
                if (report.summary.result != BuildResult.Succeeded) EditorApplication.Exit(3);
            }
            finally
            {
                AssetDatabase.DeleteAsset(scenePath);
            }
        }

        /// <summary>
        /// Fielder body captures: a production fielder and keeper rig posed by the ported choreography at the physics
        /// instants it aligns to (a synthetic path: run, pickup, throw; keeper set, dive, catch). Side views.
        /// </summary>
        public static void CaptureFielding()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var root = new GameObject("VANDE fielding captures");
            try
            {
                var sun = new GameObject("sun").AddComponent<Light>();
                sun.transform.SetParent(root.transform, false);
                sun.type = LightType.Directional;
                sun.intensity = 1.1f;
                sun.transform.rotation = Quaternion.Euler(48f, -30f, 0f);
                RenderSettings.ambientLight = new Color(0.55f, 0.58f, 0.62f);
                var cameraObject = new GameObject("camera");
                cameraObject.transform.SetParent(root.transform, false);
                var camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.36f, 0.45f, 0.30f);
                camera.fieldOfView = 30f;

                var fielder = Vande.Practice.Presentation.Production.Characters.ProductionCharacterFactory.Create(
                    root.transform, Vande.Practice.Presentation.Production.Characters.ProductionCharacterSpec.For(
                        Vande.Practice.Presentation.Production.Characters.ProductionCharacterRole.Fielder,
                        Vande.Practice.Presentation.Production.Characters.ProductionCharacterDetail.High));
                var path = new List<FielderTraceSample> { Sample(0, 15, 25, "set"), Sample(0.6, 15, 25, "set") };
                for (var step = 1; step <= 7; step++)
                    path.Add(Sample(0.6 + step * 0.1, 15 - step * 0.375, 25 - step * 0.625, "run"));
                path.Add(Sample(1.4, 12, 20, "pickup"));
                path.Add(Sample(1.9, 12, 20, "throw"));
                path.Add(Sample(2.4, 12, 20, "idle"));
                var track = Vande.Practice.Presentation.Production.Characters.ProductionFieldingPlanner.Plan(
                    path.ToArray(), false, new Vande.Practice.Presentation.Production.Characters.ProductionFieldingContext
                    {
                        Ball = t => double.IsPositiveInfinity(t) ? new Vector3(0f, 1f, 10.5f) :
                            t <= 1.4 ? Vector3.Lerp(new Vector3(0f, 0.3f, 9.25f), new Vector3(12f, 0.1f, 20f), (float)(t / 1.4)) :
                            Vector3.Lerp(new Vector3(12f, 1f, 20f), new Vector3(0f, 1f, 10.5f), (float)((t - 1.4) / 0.8)),
                        BallVelocity = t => new Vector3(8f, 0f, 7f),
                        Striker = new Vector3(0f, 0f, 9.25f),
                        Heading = Mathf.Atan2(-15f, -15.75f),
                        EndTime = 2.4
                    });
                var pose = new Vande.Practice.Presentation.Production.Characters.ProductionCharacterPose();
                foreach (var (name, t) in new[] { ("ready", 0.3), ("drive", 0.85), ("pickup-collect", 1.4),
                             ("throw-windup", 1.75), ("throw-release", 1.9), ("throw-follow", 2.1) })
                {
                    var state = track.Evaluate(t);
                    fielder.Root.position = state.Position;
                    track.Apply(fielder, fielder.Root, t, pose);
                    var side = fielder.Root.rotation * Vector3.right;
                    cameraObject.transform.position = state.Position + side * 5.5f + Vector3.up * 1.1f;
                    cameraObject.transform.LookAt(state.Position + Vector3.up * 0.9f);
                    RenderPosed(camera, fielder.Root, 800, 800, Path.Combine(output, "fielder-" + name + ".jpg"));
                }
                fielder.Dispose();

                var keeper = Vande.Practice.Presentation.Production.Characters.ProductionCharacterFactory.Create(
                    root.transform, Vande.Practice.Presentation.Production.Characters.ProductionCharacterSpec.For(
                        Vande.Practice.Presentation.Production.Characters.ProductionCharacterRole.Wicketkeeper,
                        Vande.Practice.Presentation.Production.Characters.ProductionCharacterDetail.High));
                var keeperTrack = Vande.Practice.Presentation.Production.Characters.ProductionFieldingPlanner.Plan(
                    new[]
                    {
                        Sample(0, 0, 11.6, "set"), Sample(0.45, 0, 11.6, "dive"), Sample(0.62, 0.78, 11.6, "catch"),
                        Sample(1.4, 0.78, 11.6, "celebrate")
                    }, false, new Vande.Practice.Presentation.Production.Characters.ProductionFieldingContext
                    {
                        Ball = t => new Vector3(1.95f, 0.6f, 11.6f),
                        BallVelocity = t => new Vector3(0f, 0f, 30f),
                        Keeper = true,
                        Heading = Mathf.PI,
                        Striker = new Vector3(0f, 0f, 9.25f),
                        EndTime = 3.0
                    });
                foreach (var (name, t) in new[] { ("keeper-crouch", 0.2), ("keeper-dive-reach", 0.62),
                             ("keeper-dive-land", 0.85), ("keeper-get-up", 1.4) })
                {
                    var state = keeperTrack.Evaluate(t);
                    keeper.Root.position = state.Position;
                    keeperTrack.Apply(keeper, keeper.Root, t, pose);
                    cameraObject.transform.position = new Vector3(state.Position.x, 1.0f, state.Position.z - 6.5f);
                    cameraObject.transform.LookAt(state.Position + Vector3.up * 0.6f + Vector3.right * 0.6f);
                    RenderPosed(camera, keeper.Root, 800, 800, Path.Combine(output, name + ".jpg"));
                }
                keeper.Dispose();
                Debug.Log("VANDE_EVIDENCE fielding captures written to " + output);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>
        /// Renders with every skinned mesh under `root` baked from its current bones first: batchmode -executeMethod
        /// runs no player loop, so skinning would otherwise show the previous pose. Evidence only.
        /// </summary>
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
                Render(camera, width, height, path);
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

        /// <summary>
        /// The fielder choreography on a real, dense physics trace (VANDE_DENSE_TRACE: the largest host.result of a
        /// 192-swing sweep on the current physics, exported by the builder tool). Plans every fielder as the world does
        /// and checks the body rules on it: root on the path (5 ms grid), clip markers on the physics events, no
        /// running on the spot, the turn limit and the dive cap. Also times planning and per-frame posing (desktop,
        /// indicative only).
        /// </summary>
        public static void CheckDenseFielding()
        {
            var input = Require("VANDE_DENSE_TRACE");
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var dense = JsonUtility.FromJson<DenseTrace>(File.ReadAllText(input));
            var trace = new CanonicalDeliveryTrace
            {
                durationSeconds = dense.deadT,
                ball = dense.ball.Select(b => new BallTraceSample { t = b.t, p = b.p, v = b.v }).ToArray(),
                fielders = dense.fielders.Select(f => new FielderTracePath
                {
                    fielderId = f.fielderId,
                    samples = f.samples.Select(s => new FielderTraceSample { t = s.t, x = s.x, z = s.z, action = s.action })
                        .ToArray()
                }).ToArray(),
                events = dense.events.Select(e => new CanonicalTraceEvent
                {
                    t = e.t, kind = e.kind, fielderId = string.IsNullOrEmpty(e.fielderId) ? null : e.fielderId,
                    contact = e.contact, runs = e.runs, p = e.p
                }).ToArray()
            };
            var roles = dense.field.fielders.ToDictionary(f => f.id, f => f.role);
            var roster = dense.field.fielders.Select(f => (f.id, f.role, f.x, f.z)).ToList();
            var reactions = Vande.Practice.Presentation.Production.Characters.ProductionFieldingPlanner.Reactions(
                trace, roster, null, null, true, "middle", false);
            Func<double, Vector3?> ball = t => BallAt(trace.ball, t, false);
            Func<double, Vector3?> velocity = t => BallAt(trace.ball, t, true);
            var striker = new Vector3(0f, 0f, 9.25f);

            Vande.Practice.Presentation.Production.Characters.ProductionFieldingContext Context(string id)
            {
                var spot = dense.field.fielders.First(f => f.id == id);
                return new Vande.Practice.Presentation.Production.Characters.ProductionFieldingContext
                {
                    Ball = ball, BallVelocity = velocity, Keeper = roles[id] == "keeper",
                    Heading = roles[id] == "keeper" ? Mathf.PI : Mathf.Atan2(striker.x - (float)spot.x, striker.z - (float)spot.z),
                    Striker = striker, EndTime = trace.durationSeconds,
                    Phase = Vande.Practice.Presentation.Production.Characters.ProductionFielding.PhaseFor(id),
                    ReactionTime = reactions.ContainsKey(id) ? reactions[id].time : (double?)null,
                    ReactionClip = reactions.ContainsKey(id) ? reactions[id].clip : default
                };
            }

            var paths = trace.fielders.Where(f => roles.ContainsKey(f.fielderId) && roles[f.fielderId] != "bowler").ToArray();
            var tracks = new Dictionary<string, Vande.Practice.Presentation.Production.Characters.ProductionFieldingTrack>();
            var watch = System.Diagnostics.Stopwatch.StartNew();
            const int planRepeats = 20;
            for (var repeat = 0; repeat < planRepeats; repeat++)
                foreach (var path in paths)
                    tracks[path.fielderId] = Vande.Practice.Presentation.Production.Characters.ProductionFieldingPlanner.Plan(
                        path.samples, false, Context(path.fielderId));
            var planMs = watch.Elapsed.TotalMilliseconds / planRepeats;

            var json = new StringBuilder();
            json.Append("{\"what\":\"Builder observation: the ported fielder choreography on the densest host.result of the sweep (see packet-sizes.json), planned as the world plans it. Timings are a desktop editor in batchmode, indicative only.\",");
            json.Append("\"planAllFieldersMs\":").Append(F(planMs)).Append(",\"fielders\":[");
            var pose = new Vande.Practice.Presentation.Production.Characters.ProductionCharacterPose();
            var first = true;
            var totalViolations = 0;
            double poseSeconds = 0;
            var poseCount = 0;
            foreach (var path in paths)
            {
                var track = tracks[path.fielderId];
                var samples = path.samples.OrderBy(s => s.t).ToArray();
                double maxRootError = 0;
                for (var time = samples[0].t; time <= samples[samples.Length - 1].t; time += 0.005)
                    maxRootError = Math.Max(maxRootError, Vector3.Distance(track.Evaluate(time).Position, PathAt(samples, time)));
                var markers = new List<string>();
                var violations = new List<string>();
                for (var index = 0; index < samples.Length; index++)
                {
                    if (index > 0 && samples[index].action == samples[index - 1].action) continue;
                    var action = samples[index].action;
                    var eventT = samples[index].t;
                    string marker = action == "pickup" ? "collect" : action == "throw" ? "release" : action == "catch" ? "catch" :
                        action == "drop" ? null : null;
                    var state = track.Evaluate(eventT + 1e-4);
                    if (state.MoveIndex < 0) continue;
                    var move = track.Moves[state.MoveIndex];
                    var previous = index > 0 ? samples[index - 1].action : null;
                    if (previous == "dive" && (action == "pickup" || action == "catch" || action == "drop")) marker = "reach";
                    if (marker == null) continue;
                    var expected = Vande.Practice.Presentation.Production.Characters.ProductionFieldingClips.Marker(move.Clip, marker, float.NaN);
                    var actual = move.ClipTimeAt(eventT);
                    var ok = !float.IsNaN(expected) && Math.Abs(actual - expected) < 1e-3;
                    markers.Add(action + "@" + F(eventT) + ":" + move.Clip + ":" + marker + (ok ? ":ok" : ":MISS " + F(actual) + " vs " + F(expected)));
                    if (!ok) violations.Add("marker " + action + "@" + F(eventT));
                }
                double maxTurn = 0;
                double maxBody = 0;
                var runOnSpot = 0;
                foreach (var move in track.Moves)
                {
                    var dt = move.T1 - move.T0;
                    maxTurn = Math.Max(maxTurn, Math.Abs(Vande.Practice.Presentation.Production.Characters.ProductionFieldingPlanner
                        .AngleDelta(move.Heading, move.HeadingTo)) / dt);
                    maxBody = Math.Max(maxBody, Math.Max(move.BodyFrom.magnitude, move.BodyTo.magnitude));
                    var speed = Vector3.Distance(move.From, move.To) / dt;
                    if (speed <= 0.3 && Vande.Practice.Presentation.Production.Characters.ProductionFieldingClips.IsRun(move.Clip)) runOnSpot++;
                }
                if (maxRootError > 1e-4) violations.Add("root");
                if (maxTurn > 14.001) violations.Add("turn");
                if (maxBody > 1.3501) violations.Add("body");
                if (runOnSpot > 0) violations.Add("run on the spot");
                totalViolations += violations.Count;
                var poseWatch = System.Diagnostics.Stopwatch.StartNew();
                for (var time = 0.0; time <= trace.durationSeconds; time += 1.0 / 60.0) { track.SamplePose(time, pose); poseCount++; }
                poseSeconds += poseWatch.Elapsed.TotalSeconds;
                if (!first) json.Append(',');
                first = false;
                json.Append("{\"id\":\"").Append(path.fielderId).Append("\",\"role\":\"").Append(roles[path.fielderId])
                    .Append("\",\"samples\":").Append(samples.Length).Append(",\"moves\":").Append(track.Moves.Count)
                    .Append(",\"actions\":\"").Append(string.Join(" ", samples.Select(s => s.action).Distinct()))
                    .Append("\",\"maxRootErrorM\":").Append(F(maxRootError)).Append(",\"maxTurnRadS\":").Append(F(maxTurn))
                    .Append(",\"maxBodyM\":").Append(F(maxBody)).Append(",\"runOnSpotMoves\":").Append(runOnSpot)
                    .Append(",\"markers\":[").Append(string.Join(",", markers.Select(m => "\"" + m + "\"")))
                    .Append("],\"violations\":[").Append(string.Join(",", violations.Select(v => "\"" + v + "\""))).Append("]}");
            }
            json.Append("],\"samplePoseMicroseconds\":").Append(F(poseSeconds / Math.Max(1, poseCount) * 1e6))
                .Append(",\"totalViolations\":").Append(totalViolations).Append('}');
            File.WriteAllText(Path.Combine(output, "dense-fielding-check.json"), json.ToString());
            Debug.Log("VANDE_EVIDENCE dense fielding check: violations " + totalViolations + ", plan " + F(planMs) + " ms");
        }

        /// <summary>
        /// Real host.result packets on the current physics (VANDE_RESULT_PACKETS: the largest and the fastest-bat of
        /// a 192-swing sweep, packed by the TypeScript contract). Each is decoded and validated by the Unity bridge
        /// (UnityPracticePacketCodec, PracticePresentationContractAdapter.Result), its canonical bat trace is played
        /// at 1 ms (rotation per step, rigid length, finiteness), and every non-bowler fielder is planned and audited
        /// as in CheckDenseFielding. Timings are indicative only (desktop editor, batchmode).
        /// </summary>
        public static void CheckResultPackets()
        {
            var input = Require("VANDE_RESULT_PACKETS");
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var set = JsonUtility.FromJson<PacketSet>(File.ReadAllText(input));
            var json = new StringBuilder("{\"what\":\"Builder observation: real host.result packets of the current physics decoded, validated and played by the Unity runtime; bat at 1 ms; fielders planned and audited. Desktop editor timings, indicative only.\",\"entries\":[");
            var first = true;
            foreach (var entry in set.entries)
            {
                var watch = System.Diagnostics.Stopwatch.StartNew();
                string error = null;
                Vande.Practice.Presentation.PracticeResultPresentation result = null;
                double codecMs = 0, projectMs = 0, revalidatingMs = 0;
                try
                {
                    // The runtime path: the codec decodes and validates once; the controller then projects the
                    // already-validated envelope (ResultFromValidated, internal: called by reflection here).
                    var decoded = Vande.Practice.Bridge.UnityPracticePacketCodec.Decode(entry.packetJson);
                    codecMs = watch.Elapsed.TotalMilliseconds;
                    var fromValidated = typeof(Vande.Practice.Presentation.PracticePresentationContractAdapter).GetMethod(
                        "ResultFromValidated", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                    watch.Restart();
                    result = (Vande.Practice.Presentation.PracticeResultPresentation)fromValidated.Invoke(null,
                        new object[] { decoded.Envelope });
                    projectMs = watch.Elapsed.TotalMilliseconds;
                    watch.Restart();
                    Vande.Practice.Presentation.PracticePresentationContractAdapter.Result(decoded.Envelope);
                    revalidatingMs = watch.Elapsed.TotalMilliseconds;
                }
                catch (Exception exception)
                {
                    error = exception.GetType().Name + ": " + (exception.InnerException ?? exception).Message;
                }
                var decodeMs = codecMs + projectMs;
                if (!first) json.Append(',');
                first = false;
                json.Append("{\"label\":\"").Append(Escape(entry.label)).Append("\",\"packetChars\":")
                    .Append(entry.packetJson.Length).Append(",\"runtimePathMs\":").Append(F(decodeMs))
                    .Append(",\"codecDecodeValidateMs\":").Append(F(codecMs)).Append(",\"projectFromValidatedMs\":")
                    .Append(F(projectMs)).Append(",\"publicResultRevalidatingMs\":").Append(F(revalidatingMs))
                    .Append(",\"codeOptimization\":\"").Append(UnityEditor.Compilation.CompilationPipeline.codeOptimization)
                    .Append('"');
                if (result == null)
                {
                    json.Append(",\"error\":\"").Append(Escape(error)).Append("\"}");
                    continue;
                }
                var recorder = new BatRecorder();
                var playback = new CanonicalTracePlayback(result.Trace, recorder);
                while (!playback.Completed) playback.Advance(0.001);
                json.Append(",\"batSteps\":").Append(recorder.Steps).Append(",\"batMaxRateRadS\":")
                    .Append(F(recorder.MaxRate)).Append(",\"batMaxStepDeg\":").Append(F(recorder.MaxStepDegrees))
                    .Append(",\"batLengthMinM\":").Append(F(recorder.MinLength)).Append(",\"batLengthMaxM\":")
                    .Append(F(recorder.MaxLength)).Append(",\"batNonFinite\":").Append(recorder.NonFinite)
                    .Append(",\"fielderPaths\":").Append(result.Trace.fielders.Length)
                    .Append(",\"fielderSamples\":").Append(result.Trace.fielders.Sum(f => f.samples.Length));
                var roles = entry.roles.ToDictionary(r => r.id, r => r.role);
                var spots = entry.roles.ToDictionary(r => r.id, r => (r.x, r.z));
                json.Append(",\"fielding\":");
                AuditFielding(result.Trace, roles, spots, result.Dismissal, result.OutcomeFielderId,
                    result.ShotIntent != "leave", result.ContactKind, json);
                json.Append('}');
            }
            json.Append("]}");
            File.WriteAllText(Path.Combine(output, "result-packets-check.json"), json.ToString());
            Debug.Log("VANDE_EVIDENCE result packets checked: " + set.entries.Length);
        }

        private static void AuditFielding(CanonicalDeliveryTrace trace, Dictionary<string, string> roles,
            Dictionary<string, (double x, double z)> spots, string dismissal, string outcomeFielderId, bool swung,
            string contactKind, StringBuilder json)
        {
            var roster = roles.Select(pair => (pair.Key, pair.Value, spots[pair.Key].x, spots[pair.Key].z)).ToList();
            var reactions = Vande.Practice.Presentation.Production.Characters.ProductionFieldingPlanner.Reactions(
                trace, roster, dismissal, outcomeFielderId, swung, contactKind, false);
            Func<double, Vector3?> ball = t => BallAt(trace.ball, t, false);
            Func<double, Vector3?> velocity = t => BallAt(trace.ball, t, true);
            var striker = new Vector3(0f, 0f, 9.25f);
            var paths = trace.fielders.Where(f => roles.ContainsKey(f.fielderId) && roles[f.fielderId] != "bowler").ToArray();
            var tracks = new Dictionary<string, Vande.Practice.Presentation.Production.Characters.ProductionFieldingTrack>();
            var watch = System.Diagnostics.Stopwatch.StartNew();
            const int repeats = 10;
            for (var repeat = 0; repeat < repeats; repeat++)
            {
                foreach (var path in paths)
                {
                    var id = path.fielderId;
                    var spot = spots[id];
                    var context = new Vande.Practice.Presentation.Production.Characters.ProductionFieldingContext
                    {
                        Ball = ball, BallVelocity = velocity, Keeper = roles[id] == "keeper",
                        Heading = roles[id] == "keeper" ? Mathf.PI
                            : Mathf.Atan2(striker.x - (float)spot.x, striker.z - (float)spot.z),
                        Striker = striker, EndTime = trace.durationSeconds,
                        Phase = Vande.Practice.Presentation.Production.Characters.ProductionFielding.PhaseFor(id),
                        ReactionTime = reactions.ContainsKey(id) ? reactions[id].time : (double?)null,
                        ReactionClip = reactions.ContainsKey(id) ? reactions[id].clip : default
                    };
                    tracks[id] = Vande.Practice.Presentation.Production.Characters.ProductionFieldingPlanner.Plan(
                        path.samples, false, context);
                }
            }
            var planMs = watch.Elapsed.TotalMilliseconds / repeats;
            var pose = new Vande.Practice.Presentation.Production.Characters.ProductionCharacterPose();
            var violations = 0;
            double poseSeconds = 0;
            var poseCount = 0;
            json.Append("{\"planAllFieldersMs\":").Append(F(planMs)).Append(",\"reactions\":")
                .Append(reactions.Count).Append(",\"fielders\":[");
            var firstFielder = true;
            foreach (var path in paths)
            {
                var track = tracks[path.fielderId];
                var samples = path.samples.OrderBy(s => s.t).ToArray();
                double maxRootError = 0;
                for (var time = samples[0].t; time <= samples[samples.Length - 1].t; time += 0.005)
                    maxRootError = Math.Max(maxRootError, Vector3.Distance(track.Evaluate(time).Position, PathAt(samples, time)));
                var issues = new List<string>();
                var markers = 0;
                for (var index = 0; index < samples.Length; index++)
                {
                    if (index > 0 && samples[index].action == samples[index - 1].action) continue;
                    var action = samples[index].action;
                    var eventT = samples[index].t;
                    var previous = index > 0 ? samples[index - 1].action : null;
                    string marker = action == "pickup" ? "collect" : action == "throw" ? "release" :
                        action == "catch" ? "catch" : null;
                    if (previous == "dive" && (action == "pickup" || action == "catch" || action == "drop")) marker = "reach";
                    if (marker == null) continue;
                    var state = track.Evaluate(eventT + 1e-4);
                    if (state.MoveIndex < 0) continue;
                    var move = track.Moves[state.MoveIndex];
                    var expected = Vande.Practice.Presentation.Production.Characters.ProductionFieldingClips.Marker(
                        move.Clip, marker, float.NaN);
                    markers++;
                    if (float.IsNaN(expected) || Math.Abs(move.ClipTimeAt(eventT) - expected) > 1e-3)
                        issues.Add("marker " + action + "@" + F(eventT) + " on " + move.Clip);
                }
                double maxTurn = 0, maxBody = 0;
                var runOnSpot = 0;
                foreach (var move in track.Moves)
                {
                    var dt = move.T1 - move.T0;
                    maxTurn = Math.Max(maxTurn, Math.Abs(Vande.Practice.Presentation.Production.Characters
                        .ProductionFieldingPlanner.AngleDelta(move.Heading, move.HeadingTo)) / dt);
                    maxBody = Math.Max(maxBody, Math.Max(move.BodyFrom.magnitude, move.BodyTo.magnitude));
                    if (Vector3.Distance(move.From, move.To) / dt <= 0.3 &&
                        Vande.Practice.Presentation.Production.Characters.ProductionFieldingClips.IsRun(move.Clip))
                        runOnSpot++;
                }
                if (maxRootError > 1e-4) issues.Add("root " + F(maxRootError));
                if (maxTurn > 14.001) issues.Add("turn " + F(maxTurn));
                if (maxBody > 1.3501) issues.Add("body " + F(maxBody));
                if (runOnSpot > 0) issues.Add("run on the spot x" + runOnSpot);
                violations += issues.Count;
                var poseWatch = System.Diagnostics.Stopwatch.StartNew();
                for (var time = 0.0; time <= trace.durationSeconds; time += 1.0 / 60.0) { track.SamplePose(time, pose); poseCount++; }
                poseSeconds += poseWatch.Elapsed.TotalSeconds;
                if (!firstFielder) json.Append(',');
                firstFielder = false;
                json.Append("{\"id\":\"").Append(path.fielderId).Append("\",\"role\":\"").Append(roles[path.fielderId])
                    .Append("\",\"samples\":").Append(samples.Length).Append(",\"moves\":").Append(track.Moves.Count)
                    .Append(",\"actions\":\"").Append(string.Join(" ", samples.Select(s => s.action).Distinct()))
                    .Append("\",\"markersChecked\":").Append(markers).Append(",\"maxRootErrorM\":").Append(F(maxRootError))
                    .Append(",\"maxTurnRadS\":").Append(F(maxTurn)).Append(",\"maxBodyM\":").Append(F(maxBody))
                    .Append(",\"issues\":[").Append(string.Join(",", issues.Select(i => "\"" + Escape(i) + "\""))).Append("]}");
            }
            json.Append("],\"samplePoseMicroseconds\":").Append(F(poseSeconds / Math.Max(1, poseCount) * 1e6))
                .Append(",\"violations\":").Append(violations).Append('}');
        }

        /// <summary>
        /// T1 (ball readability) diagnosis and measurement. Production world on each tier, reference flights
        /// (VANDE_F012_FLIGHTS), reference field (VANDE_FIELD), white ball, Day, 1830x824 (915x412 CSS px x2), at
        /// release, bounce, 5 m before contact and ideal contact. Two measures of the ball's inner luminance and its
        /// WCAG contrast against a ring 4-9 CSS px outside it (READ2):
        ///  mask: TEXTURES' method, pixels that differ between frames with and without the ball's renderers (which
        ///        also removes the ball's own cast shadow, so the mask can include that shadow);
        ///  disc: only pixels inside the ball's projected disc (camera projection of its centre and 36 mm radius).
        /// Each is taken with the ball's renderers as built and, as a diagnosis, with receiving shadows off.
        /// </summary>
        public static void MeasureBallReadability()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var flights = JsonUtility.FromJson<FlightSet>(File.ReadAllText(Require("VANDE_F012_FLIGHTS")));
            var diagnose = Environment.GetEnvironmentVariable("VANDE_BALL_DIAGNOSE") == "1";
            var variants = Environment.GetEnvironmentVariable("VANDE_BALL_VARIANTS") == "1"
                ? new[] { "built", "noShade", "oldSun", "oldSunShade" }
                : new[] { "built" };
            // VANDE_BALL_LIGHT=LateAfternoon measures that light (the game always plays Day). The "oldSun" variants
            // restore that light's previous, z-mirrored key.
            var lightName = Environment.GetEnvironmentVariable("VANDE_BALL_LIGHT");
            var light = string.IsNullOrEmpty(lightName)
                ? ProductionLight.Day
                : (ProductionLight)Enum.Parse(typeof(ProductionLight), lightName);
            var oldKey = light == ProductionLight.LateAfternoon
                ? Quaternion.Euler(22f, -104f, 0f)
                : Quaternion.Euler(42f, -58f, 0f);
            var lightField = typeof(ProceduralPracticeWorld).GetField("practiceLight",
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            var previousLight = lightField.GetValue(null);
            lightField.SetValue(null, light);
            const int width = 1830, height = 824;
            var json = new StringBuilder("{\"what\":\"Builder observation: ball inner luminance and WCAG contrast against a ring 4-9 CSS px outside it, production world, 1830x824 (915x412 CSS px x2), live 58 deg horizontal FOV, white ball, the light named below, reference field. mask = TEXTURES' with/without-ball difference; disc = the ball's projected disc only.\",\"rows\":[");
            var first = true;
            try
            {
            foreach (var quality in new[] { PracticePresentationQuality.Lite, PracticePresentationQuality.Standard, PracticePresentationQuality.High })
            {
                foreach (var flight in flights.balls)
                {
                    foreach (var (moment, at) in new[] { ("release", 0.0), ("bounce", flight.bounceT), ("near5", flight.near5T), ("contact", flight.idealContactT) })
                    {
                        if (at > flight.idealContactT + 1e-9) continue;
                        var root = new GameObject("VANDE ball readability");
                        var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
                        try
                        {
                            var world = root.AddComponent<ProceduralPracticeWorld>();
                            world.Configure(new PracticePresentationSettings
                            {
                                Assistance = "play", Handedness = "right", Locale = "en-IN", Quality = quality
                            }, new SilentSink());
                            world.ConfigureScene(Scene());
                            var camera = root.GetComponentsInChildren<Camera>(true).First();
                            camera.targetTexture = target;
                            camera.ResetAspect();
                            world.BeginDelivery(BallDelivery(flight));
                            var timeline = world.Timeline;
                            world.Tick(-timeline + at);
                            var ballVisual = (ProductionBallVisual)typeof(ProceduralPracticeWorld)
                                .GetField("ball", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                                .GetValue(world);
                            var renderers = ballVisual.GameObject.GetComponentsInChildren<Renderer>(true);
                            var built = renderers.Select(r => r.receiveShadows).ToArray();
                            var key = root.GetComponentsInChildren<Light>(true).First(l => l.name == "ProductionEnvironmentKeyLight");
                            var builtSun = key.transform.rotation;
                            var shade = root.GetComponentsInChildren<MeshRenderer>(true).FirstOrDefault(r => r.name == "DarkSurroundShade");
                            foreach (var variant in variants)
                            {
                                // built = this build; noShade = the sun fix alone; oldSun = the previous Euler(42,-58,0)
                                // key without the shade (the before state); oldSunShade = the shade alone.
                                key.transform.rotation = variant.StartsWith("oldSun") ? oldKey : builtSun;
                                if (shade != null) shade.enabled = variant == "built" || variant == "oldSunShade";
                                foreach (var receive in diagnose ? new bool?[] { null, false } : new bool?[] { null })
                                {
                                    if (receive.HasValue) foreach (var r in renderers) r.receiveShadows = receive.Value;
                                    else for (var i = 0; i < renderers.Length; i++) renderers[i].receiveShadows = built[i];
                                    var withBall = ReadFrame(camera, target);
                                    var enabled = renderers.Select(r => r.enabled).ToArray();
                                    foreach (var r in renderers) r.enabled = false;
                                    var withoutBall = ReadFrame(camera, target);
                                    for (var i = 0; i < renderers.Length; i++) renderers[i].enabled = enabled[i];
                                    // Projected disc.
                                    var centre = ballVisual.GameObject.transform.position;
                                    var screen = camera.WorldToScreenPoint(centre);
                                    var focal = height / 2.0 / Math.Tan(camera.fieldOfView * Math.PI / 360.0);
                                    var radius = screen.z > 0 ? CricketPropDimensions.BallRadius * focal / screen.z : 0.0;
                                    var disc = Contrast(withBall, withoutBall, width, height, screen.x, screen.y, radius, null);
                                    // TEXTURES' mask.
                                    var mask = new List<int>();
                                    for (var i = 0; i < withBall.Length; i++)
                                    {
                                        var a = withBall[i];
                                        var b = withoutBall[i];
                                        if (Mathf.Max(Mathf.Abs(a.r - b.r), Mathf.Abs(a.g - b.g), Mathf.Abs(a.b - b.b)) > 6f / 255f) mask.Add(i);
                                    }
                                    var outside = mask.Count(i => Math.Sqrt(Math.Pow(i % width + 0.5 - screen.x, 2) + Math.Pow(i / width + 0.5 - screen.y, 2)) > radius + 2.0);
                                    double mx = 0, my = 0;
                                    foreach (var i in mask) { mx += i % width + 0.5; my += i / width + 0.5; }
                                    string maskJson;
                                    if (mask.Count == 0) maskJson = "null";
                                    else
                                    {
                                        mx /= mask.Count; my /= mask.Count;
                                        var maskRadius = Math.Sqrt(mask.Count / Math.PI);
                                        maskJson = Contrast(withBall, withoutBall, width, height, mx, my, maskRadius, mask);
                                    }
                                    if (!first) json.Append(',');
                                    first = false;
                                    json.Append("{\"tier\":\"").Append(quality).Append("\",\"ball\":").Append(flight.ball)
                                        .Append(",\"moment\":\"").Append(moment).Append("\",\"t\":").Append(F(at))
                                        .Append(",\"variant\":\"").Append(variant)
                                        .Append("\",\"receiveShadows\":\"").Append(receive.HasValue ? receive.Value.ToString() : "as built (" + string.Join("/", built) + ")")
                                        .Append("\",\"castShadows\":\"").Append(string.Join("/", renderers.Select(r => r.shadowCastingMode)))
                                        .Append("\",\"discRadiusPx\":").Append(F(radius)).Append(",\"disc\":").Append(disc)
                                        .Append(",\"maskPx\":").Append(mask.Count).Append(",\"maskPxOutsideDisc\":").Append(outside)
                                        .Append(",\"mask\":").Append(maskJson).Append('}');
                                    if (!receive.HasValue && (moment == "bounce" && flight.ball == 2 || moment == "near5" && flight.ball == 5))
                                        SaveFrame(withBall, width, height, Path.Combine(output,
                                            "ball-" + quality.ToString().ToLowerInvariant() + "-ref" + flight.ball + "-" + moment + "-" + variant + ".jpg"));
                                }
                            }
                        }
                        finally
                        {
                            UnityEngine.Object.DestroyImmediate(root);
                            UnityEngine.Object.DestroyImmediate(target);
                        }
                    }
                }
            }
            }
            finally
            {
                lightField.SetValue(null, previousLight);
            }
            json.Append("],\"light\":\"").Append(light).Append("\"}");
            var suffix = light == ProductionLight.Day ? "" : "-" + light.ToString().ToLowerInvariant();
            File.WriteAllText(Path.Combine(output, (diagnose ? "ball-readability-diagnosis" : "ball-readability") + suffix + ".json"), json.ToString());
            Debug.Log("VANDE_EVIDENCE ball readability written");
        }

        /// <summary>Inner disc (0.7 r) luminance of `withBall` and the ring 8-18 device px outside r in `withoutBall`.</summary>
        private static string Contrast(Color[] withBall, Color[] withoutBall, int width, int height, double cx, double cy,
            double radius, List<int> only)
        {
            if (!(radius > 0)) return "null";
            double inner = 0;
            var innerCount = 0;
            double peak = 0;
            var candidates = only ?? Enumerable.Range(0, 0).ToList();
            if (only == null)
            {
                for (var y = (int)Math.Floor(cy - radius); y <= (int)Math.Ceiling(cy + radius); y++)
                    for (var x = (int)Math.Floor(cx - radius); x <= (int)Math.Ceiling(cx + radius); x++)
                        if (x >= 0 && y >= 0 && x < width && y < height &&
                            Math.Sqrt(Math.Pow(x + 0.5 - cx, 2) + Math.Pow(y + 0.5 - cy, 2)) <= radius)
                            candidates.Add(y * width + x);
            }
            foreach (var i in candidates)
            {
                var d = Math.Sqrt(Math.Pow(i % width + 0.5 - cx, 2) + Math.Pow(i / width + 0.5 - cy, 2));
                var l = Luma(withBall[i]);
                peak = Math.Max(peak, l);
                if (d > Math.Max(0.75, 0.7 * radius)) continue;
                inner += l;
                innerCount++;
            }
            inner = innerCount == 0 ? peak : inner / innerCount;
            double ring = 0;
            var ringCount = 0;
            for (var y = (int)Math.Floor(cy - radius - 18); y <= (int)Math.Ceiling(cy + radius + 18); y++)
                for (var x = (int)Math.Floor(cx - radius - 18); x <= (int)Math.Ceiling(cx + radius + 18); x++)
                {
                    if (x < 0 || y < 0 || x >= width || y >= height) continue;
                    var d = Math.Sqrt(Math.Pow(x + 0.5 - cx, 2) + Math.Pow(y + 0.5 - cy, 2));
                    if (d < radius + 8 || d > radius + 18) continue;
                    ring += Luma(withoutBall[y * width + x]);
                    ringCount++;
                }
            ring /= Math.Max(1, ringCount);
            var contrast = (Math.Max(inner, ring) + 0.05) / (Math.Min(inner, ring) + 0.05);
            return "{\"inner\":" + F(inner) + ",\"peak\":" + F(peak) + ",\"ring\":" + F(ring) + ",\"contrast\":" + F(contrast) +
                   ",\"centre\":[" + F(cx) + "," + F(height - cy) + "]}";
        }

        private static double Luma(Color c)
        {
            double Lin(float v) => v <= 0.04045 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
            return 0.2126 * Lin(c.r) + 0.7152 * Lin(c.g) + 0.0722 * Lin(c.b);
        }

        private static Color[] ReadFrame(Camera camera, RenderTexture target)
        {
            var previous = RenderTexture.active;
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                var pixels = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0, false);
                pixels.Apply();
                var colours = pixels.GetPixels();
                UnityEngine.Object.DestroyImmediate(pixels);
                return colours;
            }
            finally
            {
                RenderTexture.active = previous;
            }
        }

        private static void SaveFrame(Color[] colours, int width, int height, string path)
        {
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false);
            texture.SetPixels(colours);
            texture.Apply();
            File.WriteAllBytes(path, texture.EncodeToJPG(90));
            UnityEngine.Object.DestroyImmediate(texture);
        }

        private static PracticeDeliveryPresentation BallDelivery(FlightBall ball)
        {
            var flight = new List<BallTraceSample>();
            var samples = ball.samples;
            for (var i = 0; i < samples.Length; i += 2)
            {
                var a = samples[Math.Max(0, i - 1)];
                var b = samples[Math.Min(samples.Length - 1, i + 1)];
                var dt = Math.Max(1e-6, b.t - a.t);
                flight.Add(new BallTraceSample
                {
                    t = samples[i].t,
                    p = new TraceVector3 { x = samples[i].x, y = samples[i].y, z = samples[i].z },
                    v = new TraceVector3 { x = (b.x - a.x) / dt, y = (b.y - a.y) / dt, z = (b.z - a.z) / dt }
                });
            }
            return new PracticeDeliveryPresentation
            {
                Seed = ball.seed, Flight = flight.ToArray(), BounceT = ball.bounceT, IdealContactT = ball.idealContactT,
                StumpsT = ball.stumpsT, SeamAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                ShineDirection = new TraceVector3 { x = 1, y = 0, z = 0 }, SpinAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                SpinRps = 10, PlannedSpeedKph = ball.speedKph, ReleaseSpeedKph = ball.speedKph
            };
        }

        /// <summary>
        /// Writes the Unity default runtime theme (everything VandeProductionHudTheme.tss imported) as USS text to
        /// VANDE_EVIDENCE_OUT, through the editor's own StyleSheetToUss exporter (reflection; editor only), so the
        /// lean HUD theme can keep exactly the rules the HUD's elements use.
        /// </summary>
        public static void DumpDefaultTheme()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var themePath = Environment.GetEnvironmentVariable("VANDE_THEME_PATH") ??
                            "Assets/UI Toolkit/UnityThemes/UnityDefaultRuntimeTheme.tss";
            var theme = AssetDatabase.LoadAssetAtPath<UnityEngine.UIElements.ThemeStyleSheet>(themePath);
            if (theme == null) throw new InvalidOperationException("Theme not found: " + themePath);
            const System.Reflection.BindingFlags any = System.Reflection.BindingFlags.Instance |
                                                       System.Reflection.BindingFlags.Static |
                                                       System.Reflection.BindingFlags.Public |
                                                       System.Reflection.BindingFlags.NonPublic;
            var sheets = new List<UnityEngine.UIElements.StyleSheet>();
            var log = new StringBuilder();
            void Walk(UnityEngine.UIElements.StyleSheet sheet, int depth)
            {
                if (sheet == null || sheets.Contains(sheet) || depth > 8) return;
                sheets.Add(sheet);
                var importsMember = (object)typeof(UnityEngine.UIElements.StyleSheet).GetProperty("imports", any) ??
                                    typeof(UnityEngine.UIElements.StyleSheet).GetField("imports", any);
                object value = importsMember is System.Reflection.PropertyInfo property ? property.GetValue(sheet)
                    : importsMember is System.Reflection.FieldInfo field ? field.GetValue(sheet) : null;
                if (value is Array imports)
                {
                    foreach (var import in imports)
                    {
                        var child = import.GetType().GetField("styleSheet", any)?.GetValue(import) as UnityEngine.UIElements.StyleSheet;
                        log.AppendLine(new string(' ', depth * 2) + sheet.name + " imports " + (child != null ? child.name : "null"));
                        Walk(child, depth + 1);
                    }
                }
            }
            Walk(theme, 0);
            var index = 0;
            foreach (var sheet in sheets)
            {
                // Selectors and property names with raw value text, read through the sheet's own readers.
                var text = new StringBuilder();
                var selectors = typeof(UnityEngine.UIElements.StyleSheet).GetField("m_ComplexSelectors", any)?.GetValue(sheet) as Array
                                ?? typeof(UnityEngine.UIElements.StyleSheet).GetProperty("complexSelectors", any)?.GetValue(sheet) as Array;
                var readAsString = typeof(UnityEngine.UIElements.StyleSheet).GetMethods(any)
                    .FirstOrDefault(method => method.Name == "ReadAsString" && method.GetParameters().Length == 1);
                if (selectors == null) { log.AppendLine(sheet.name + ": no selectors"); continue; }
                foreach (var selector in selectors)
                {
                    var rule = selector.GetType().GetProperty("rule", any)?.GetValue(selector);
                    var properties = rule?.GetType().GetProperty("properties", any)?.GetValue(rule) as Array;
                    text.Append(selector).Append(" {");
                    if (properties != null)
                    {
                        foreach (var property in properties)
                        {
                            var name = property.GetType().GetProperty("name", any)?.GetValue(property);
                            var values = property.GetType().GetProperty("values", any)?.GetValue(property) as Array;
                            text.Append(' ').Append(name).Append(':');
                            if (values != null)
                                foreach (var value in values)
                                {
                                    string rendered;
                                    try { rendered = readAsString != null ? (string)readAsString.Invoke(sheet, new[] { value }) : value.ToString(); }
                                    catch (Exception) { rendered = value.ToString(); }
                                    text.Append(' ').Append(rendered);
                                }
                            text.Append(';');
                        }
                    }
                    text.AppendLine(" }");
                }
                File.WriteAllText(Path.Combine(output, (index++).ToString("00") + "-" + sheet.name + ".uss.txt"), text.ToString());
                log.AppendLine(sheet.name + ": " + selectors.Length + " selectors");
            }
            File.WriteAllText(Path.Combine(output, "index.txt"), log.ToString());
            Debug.Log("VANDE_EVIDENCE default theme sheets written: " + sheets.Count);
        }

        /// <summary>
        /// Item 1 (rig reach): plays each real host.result of the current physics (VANDE_RESULT_PACKETS) through the
        /// production world as a replay at 60 Hz and measures, on every frame with a canonical bat, the gap between
        /// each visible hero hand and its grip target on the bat, and the shoulder-to-target reach against the rig's
        /// usable reach. The world, its hero batter and the trace are the shipped ones; only the clock is the test's.
        /// </summary>
        public static void CheckBatterHands()
        {
            var input = Require("VANDE_RESULT_PACKETS");
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var set = JsonUtility.FromJson<PacketSet>(File.ReadAllText(input));
            var json = new StringBuilder("{\"what\":\"Builder observation: hero batter hands against their grip targets on the canonical bat, every 60 Hz frame of real current-physics results played through the production world (replay path).\",\"entries\":[");
            var first = true;
            foreach (var entry in set.entries)
            {
                var decoded = Vande.Practice.Bridge.UnityPracticePacketCodec.Decode(entry.packetJson);
                var result = Vande.Practice.Presentation.PracticePresentationContractAdapter.Result(decoded.Envelope);
                result.IsReplay = true;
                result.PlaybackSpeed = 1.0;
                var root = new GameObject("VANDE batter hands check");
                try
                {
                    var world = root.AddComponent<ProceduralPracticeWorld>();
                    world.Configure(new PracticePresentationSettings
                    {
                        Assistance = "play", Handedness = "right", Locale = "en-IN",
                        Quality = PracticePresentationQuality.High
                    }, new SilentSink());
                    world.ConfigureScene(new PracticeScenePresentation
                    {
                        BallAge = "new", BallColour = "white", BatterCreaseOffsetM = 0, BatterLateralM = 0,
                        BowlerArm = "right", BowlerFamily = "pace", Conditions = "balanced", Handedness = "right",
                        Fielders = entry.roles.Select(r => new PracticeFielderPresentation { Id = r.id, Role = r.role, X = r.x, Z = r.z })
                            .ToArray()
                    });
                    world.BeginDelivery(new PracticeDeliveryPresentation
                    {
                        Flight = result.Trace.ball.Where(sample => sample.t <= 0.7).ToArray(),
                        SeamAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                        ShineDirection = new TraceVector3 { x = 1, y = 0, z = 0 },
                        SpinAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                        SpinRps = 10, PlannedSpeedKph = 137.5, ReleaseSpeedKph = 137.5
                    });
                    world.Tick(3.0);
                    world.AcceptResult(result);
                    var rig = (Vande.Practice.Presentation.Production.Characters.ProductionCharacterRig)typeof(ProceduralPracticeWorld)
                        .GetField("batterRig", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                        .GetValue(world);
                    var batStart = result.Trace.bat.Length > 0 ? result.Trace.bat[0].t : double.PositiveInfinity;
                    var batEnd = result.Trace.bat.Length > 0 ? result.Trace.bat[result.Trace.bat.Length - 1].t : double.NegativeInfinity;
                    var usable = rig.GetType().GetMethod("HeroBatterArmUsableReach",
                        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                    var usableLeft = (float)usable.Invoke(rig, new object[] { true });
                    var usableRight = (float)usable.Invoke(rig, new object[] { false });
                    double maxGap = 0, maxGapT = 0, maxReach = 0;
                    var frames = 0;
                    var over2mm = 0;
                    for (var step = 0; step < 60 * 12 && world.Timeline < result.Trace.durationSeconds - 1e-9; step++)
                    {
                        world.Tick(1.0 / 60.0);
                        var t = world.Timeline;
                        if (t < batStart || t > batEnd) continue;
                        frames++;
                        var gapLeft = Vector3.Distance(rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true));
                        var gapRight = Vector3.Distance(rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false));
                        var gap = Math.Max(gapLeft, gapRight);
                        if (gap > 0.002) over2mm++;
                        if (gap > maxGap) { maxGap = gap; maxGapT = t; }
                        maxReach = Math.Max(maxReach, Math.Max(
                            Vector3.Distance(rig.HeroJointWorldPosition(Vande.Practice.Presentation.Production.Characters.ProductionCharacterJoint.UpperArmLeft), rig.HeroBatterGripTargetWorld(true)),
                            Vector3.Distance(rig.HeroJointWorldPosition(Vande.Practice.Presentation.Production.Characters.ProductionCharacterJoint.UpperArmRight), rig.HeroBatterGripTargetWorld(false))));
                    }
                    if (!first) json.Append(',');
                    first = false;
                    json.Append("{\"label\":\"").Append(Escape(entry.label)).Append("\",\"framesWithBat\":").Append(frames)
                        .Append(",\"maxHandGapM\":").Append(F(maxGap)).Append(",\"maxHandGapAtT\":").Append(F(maxGapT))
                        .Append(",\"framesOver2mm\":").Append(over2mm).Append(",\"maxShoulderToTargetM\":").Append(F(maxReach))
                        .Append(",\"usableReachM\":[").Append(F(usableLeft)).Append(',').Append(F(usableRight)).Append("]}");
                }
                catch (Exception exception)
                {
                    if (!first) json.Append(',');
                    first = false;
                    json.Append("{\"label\":\"").Append(Escape(entry.label)).Append("\",\"error\":\"")
                        .Append(Escape(exception.GetType().Name + ": " + exception.Message)).Append("\"}");
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
            json.Append("]}");
            File.WriteAllText(Path.Combine(output, "batter-hands-check.json"), json.ToString());
            Debug.Log("VANDE_EVIDENCE batter hands checked");
        }

        private sealed class BatRecorder : ICanonicalTraceTarget
        {
            private BatTraceSample last;
            public int Steps;
            public double MaxRate;
            public double MaxStepDegrees;
            public double MinLength = double.PositiveInfinity;
            public double MaxLength;
            public int NonFinite;

            public void SetBall(BallTraceSample sample) { }
            public void SetFielder(string fielderId, FielderTraceSample sample) { }
            public void EmitEvent(CanonicalTraceEvent traceEvent) { }
            public void SetPlaybackCompleted(bool completed) { }

            public void SetBat(BatTraceSample sample)
            {
                var axis = new Vector3((float)(sample.toe.x - sample.grip.x), (float)(sample.toe.y - sample.grip.y),
                    (float)(sample.toe.z - sample.grip.z));
                var face = new Vector3((float)sample.face.x, (float)sample.face.y, (float)sample.face.z);
                if (float.IsNaN(axis.x + axis.y + axis.z + face.x + face.y + face.z)) { NonFinite++; return; }
                MinLength = Math.Min(MinLength, axis.magnitude);
                MaxLength = Math.Max(MaxLength, axis.magnitude);
                if (last != null && sample.t > last.t)
                {
                    var previousAxis = new Vector3((float)(last.toe.x - last.grip.x), (float)(last.toe.y - last.grip.y),
                        (float)(last.toe.z - last.grip.z));
                    var previousFace = new Vector3((float)last.face.x, (float)last.face.y, (float)last.face.z);
                    var a = Quaternion.LookRotation(previousAxis.normalized, previousFace.normalized);
                    var b = Quaternion.LookRotation(axis.normalized, face.normalized);
                    var step = Quaternion.Angle(a, b);
                    MaxStepDegrees = Math.Max(MaxStepDegrees, step);
                    MaxRate = Math.Max(MaxRate, step * Mathf.Deg2Rad / (sample.t - last.t));
                }
                last = sample;
                Steps++;
            }
        }

        [Serializable] private sealed class PacketSet { public PacketEntry[] entries; }
        [Serializable] private sealed class PacketEntry { public string label; public string packetJson; public PacketRole[] roles; }
        [Serializable] private sealed class PacketRole { public string id; public string role; public double x; public double z; }

        private static Vector3? BallAt(BallTraceSample[] samples, double t, bool velocity)
        {
            if (samples.Length == 0) return null;
            if (double.IsPositiveInfinity(t) || t >= samples[samples.Length - 1].t)
            {
                var last = velocity ? samples[samples.Length - 1].v : samples[samples.Length - 1].p;
                return new Vector3((float)last.x, (float)last.y, (float)last.z);
            }
            var index = 0;
            while (index + 1 < samples.Length && samples[index + 1].t <= t) index++;
            var a = samples[index];
            var b = samples[Math.Min(index + 1, samples.Length - 1)];
            var u = b.t > a.t ? (float)((t - a.t) / (b.t - a.t)) : 0f;
            var pa = velocity ? a.v : a.p;
            var pb = velocity ? b.v : b.p;
            return Vector3.Lerp(new Vector3((float)pa.x, (float)pa.y, (float)pa.z), new Vector3((float)pb.x, (float)pb.y, (float)pb.z), u);
        }

        private static Vector3 PathAt(FielderTraceSample[] sorted, double t)
        {
            if (t <= sorted[0].t) return new Vector3((float)sorted[0].x, 0f, (float)sorted[0].z);
            for (var index = 0; index + 1 < sorted.Length; index++)
            {
                if (t > sorted[index + 1].t) continue;
                var u = (float)((t - sorted[index].t) / (sorted[index + 1].t - sorted[index].t));
                return new Vector3((float)(sorted[index].x + (sorted[index + 1].x - sorted[index].x) * u), 0f,
                    (float)(sorted[index].z + (sorted[index + 1].z - sorted[index].z) * u));
            }
            var last = sorted[sorted.Length - 1];
            return new Vector3((float)last.x, 0f, (float)last.z);
        }

        [Serializable] private sealed class DenseTrace
        {
            public double deadT;
            public DenseFielder[] fielders;
            public DenseEvent[] events;
            public DenseBall[] ball;
            public FieldLayout field;
        }
        [Serializable] private sealed class DenseFielder { public string fielderId; public DenseSample[] samples; }
        [Serializable] private sealed class DenseSample { public double t; public double x; public double z; public string action; }
        [Serializable] private sealed class DenseEvent
        {
            public double t; public string kind; public string fielderId; public string contact; public int runs;
            public TraceVector3 p;
        }
        [Serializable] private sealed class DenseBall { public double t; public TraceVector3 p; public TraceVector3 v; }

        private static FielderTraceSample Sample(double t, double x, double z, string action) =>
            new FielderTraceSample { t = t, x = x, z = z, action = action };

        /// <summary>
        /// The C# side of the takes.ts parity table: evaluates ProductionRecordedTakes on the TypeScript vector inputs
        /// (VANDE_TAKE_VECTORS, one tab-separated case per line) and writes one output line per case.
        /// </summary>
        public static void WriteTakeVectors()
        {
            var input = Require("VANDE_TAKE_VECTORS");
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var lines = new List<string>();
            foreach (var line in File.ReadAllLines(input, Encoding.UTF8))
            {
                if (line.Length == 0) continue;
                var part = line.Split('\t');
                switch (part[0])
                {
                    case "fnv":
                        lines.Add(global::Vande.Practice.Audio.Production.ProductionRecordedTakes.Fnv1a32(part.Length > 1 ? part[1] : string.Empty)
                            .ToString(CultureInfo.InvariantCulture));
                        break;
                    case "key":
                        lines.Add(global::Vande.Practice.Audio.Production.ProductionRecordedTakes.DeliveryTakeKey(part[1],
                            part[2] == "-" ? (int?)null : int.Parse(part[2], CultureInfo.InvariantCulture),
                            part[3] == "-" ? (int?)null : int.Parse(part[3], CultureInfo.InvariantCulture)));
                        break;
                    case "index":
                        lines.Add(global::Vande.Practice.Audio.Production.ProductionRecordedTakes.TakeIndex(part[1], part[2],
                                int.Parse(part[3], CultureInfo.InvariantCulture),
                                int.Parse(part[4], CultureInfo.InvariantCulture))
                            .ToString(CultureInfo.InvariantCulture));
                        break;
                    case "unit":
                        lines.Add(F(global::Vande.Practice.Audio.Production.ProductionRecordedTakes.TakeUnit(part[1], part[2],
                            int.Parse(part[3], CultureInfo.InvariantCulture))));
                        break;
                    case "aligned":
                        var aligned = global::Vande.Practice.Audio.Production.ProductionRecordedTakes.AlignedStart(
                            double.Parse(part[1], CultureInfo.InvariantCulture),
                            double.Parse(part[2], CultureInfo.InvariantCulture),
                            double.Parse(part[3], CultureInfo.InvariantCulture),
                            double.Parse(part[4], CultureInfo.InvariantCulture),
                            double.Parse(part[5], CultureInfo.InvariantCulture));
                        lines.Add(F(aligned.Start) + "\t" + F(aligned.Offset));
                        break;
                    default:
                        throw new InvalidOperationException("Unknown vector " + part[0]);
                }
            }
            var data = new float[4800];
            for (var index = 0; index < 300; index++) data[index] = (float)(0.004 * Math.Sin(index));
            data[336] = 0.05f;
            data[337] = -0.9f;
            data[338] = 0.7f;
            lines.Add("onset\t" + global::Vande.Practice.Audio.Production.ProductionRecordedTakes.FindOnset(data) + "\t" +
                      global::Vande.Practice.Audio.Production.ProductionRecordedTakes.FindOnset(new float[10]));
            File.WriteAllLines(Path.Combine(output, "takes-csharp-output.tsv"), lines, new UTF8Encoding(false));
            Debug.Log("VANDE_EVIDENCE take vectors written: " + lines.Count);
        }

        private static void Mark(Dictionary<string, string> marks, string name, double? at, double t, double sx,
            double sy, double radius, int width, int height)
        {
            if (!at.HasValue || marks.ContainsKey(name) || t < at.Value) return;
            marks[name] = "{\"t\":" + F(t) + ",\"xFrac\":" + F(sx / width) + ",\"yFrac\":" + F(sy / height) +
                          ",\"diameterPx\":" + F(2 * radius) + ",\"readabilityDiameterPx\":" +
                          F(Math.Max(2 * radius, 3.5)) + "}";
        }

        private static void Render(Camera camera, int width, int height, string path)
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
                File.WriteAllBytes(Path.ChangeExtension(path, ".jpg"), pixels.EncodeToJPG(90));
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

        private static PracticeScenePresentation Scene()
        {
            var fieldPath = Environment.GetEnvironmentVariable("VANDE_FIELD");
            if (!string.IsNullOrEmpty(fieldPath) && File.Exists(fieldPath))
            {
                // The reference over's own field, exported from the TypeScript physics.
                var field = JsonUtility.FromJson<FieldLayout>(File.ReadAllText(fieldPath));
                return new PracticeScenePresentation
                {
                    BallAge = "new", BallColour = "white", BatterCreaseOffsetM = 0, BatterLateralM = 0,
                    BowlerArm = "right", BowlerFamily = "pace", Conditions = "balanced", Handedness = "right",
                    Fielders = field.fielders.Select(f => new PracticeFielderPresentation
                    {
                        Id = f.id, Role = f.role, X = f.x, Z = f.z
                    }).ToArray()
                };
            }
            // A plausible white-ball ring (keeper, bowler, slip, point, cover, mid-off, mid-on, midwicket, square leg,
            // fine leg, third man), positions in the striker's frame. Presentation evidence only.
            var spots = new (string id, string role, double x, double z)[]
            {
                ("keeper", "keeper", 0, 12.6), ("bowler", "bowler", 0, -12), ("slip", "slip", 1.6, 13.4),
                ("point", "point", 18, 8), ("cover", "cover", 20, -2), ("mid_off", "mid_off", 8, -18),
                ("mid_on", "mid_on", -8, -18), ("midwicket", "midwicket", -22, -2), ("square_leg", "square_leg", -24, 9),
                ("fine_leg", "fine_leg", -40, 52), ("third_man", "third_man", 40, 52)
            };
            return new PracticeScenePresentation
            {
                BallAge = "new",
                BallColour = "white",
                BatterCreaseOffsetM = 0,
                BatterLateralM = 0,
                BowlerArm = "right",
                BowlerFamily = "pace",
                Conditions = "balanced",
                Handedness = "right",
                Fielders = spots.Select(spot => new PracticeFielderPresentation
                {
                    Id = spot.id, Role = spot.role, X = spot.x, Z = spot.z
                }).ToArray()
            };
        }

        private static PracticeDeliveryPresentation Delivery()
        {
            var flight = new List<BallTraceSample>();
            var flightsPath = Environment.GetEnvironmentVariable("VANDE_F012_FLIGHTS");
            if (!string.IsNullOrEmpty(flightsPath) && File.Exists(flightsPath))
            {
                var ball = JsonUtility.FromJson<FlightSet>(File.ReadAllText(flightsPath)).balls[0];
                for (var index = 0; index < ball.samples.Length; index += 10)
                {
                    var sample = ball.samples[index];
                    flight.Add(new BallTraceSample
                    {
                        t = sample.t,
                        p = new TraceVector3 { x = sample.x, y = sample.y, z = sample.z },
                        v = new TraceVector3 { x = 0, y = 0, z = 38 }
                    });
                }
            }
            else
            {
                flight.Add(new BallTraceSample { t = 0, p = new TraceVector3 { x = 0.4, y = 2.3, z = -8.66 }, v = new TraceVector3 { z = 38 } });
                flight.Add(new BallTraceSample { t = 0.47, p = new TraceVector3 { x = 0.3, y = 0.5, z = 9 }, v = new TraceVector3 { z = 30 } });
            }
            return new PracticeDeliveryPresentation
            {
                Flight = flight.ToArray(),
                SeamAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                ShineDirection = new TraceVector3 { x = 1, y = 0, z = 0 },
                SpinAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                SpinRps = 10,
                PlannedSpeedKph = 137.5,
                ReleaseSpeedKph = 137.5
            };
        }

        private static string Require(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (string.IsNullOrEmpty(value)) throw new InvalidOperationException(name + " is required.");
            return value;
        }

        private static string V(Vector3 value) => "[" + F(value.x) + "," + F(value.y) + "," + F(value.z) + "]";

        private static string F(double value) =>
            double.IsInfinity(value) ? "null" : value.ToString("R", CultureInfo.InvariantCulture);

        private static string Escape(string value) => (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");

        [Serializable]
        private sealed class FieldLayout
        {
            public string id;
            public FieldSpot[] fielders;
        }

        [Serializable]
        private sealed class FieldSpot
        {
            public string id;
            public string role;
            public double x;
            public double z;
        }

        [Serializable]
        private sealed class FlightSet
        {
            public string handedness;
            public FlightBall[] balls;
        }

        [Serializable]
        private sealed class FlightBall
        {
            public int ball;
            public string seed;
            public double idealContactT;
            public double stumpsT;
            public double bounceT;
            public double near5T;
            public double speedKph;
            public FlightSample[] samples;
        }

        [Serializable]
        private sealed class FlightSample
        {
            public double t;
            public double x;
            public double y;
            public double z;
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
