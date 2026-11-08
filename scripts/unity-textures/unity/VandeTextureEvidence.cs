// TEXTURES-track builder evidence for Unity batchmode (-executeMethod). Builder observations only, never a gate.
//
// This file is NOT part of the repository's Unity project. scripts/unity-textures/unity-evidence.sh copies the Unity
// project into a scratch folder and drops this file into the copy's Assets/VandePractice/Editor/Evidence/, so the
// textures can be compared before and after on identical source without touching files other owners hold.
//
// Outputs go to VANDE_EVIDENCE_OUT:
//   readability.json   per tier (Lite, Standard, High), per reference ball (VANDE_F012_FLIGHTS, ref-1..ref-6) and per
//                      moment (release, bounce, 5 m before contact, ideal contact): the ball's on-screen diameter and the
//                      WCAG contrast of its inner disc against a ring 4-9 CSS px outside it (docs/EVALUATION.md READ2),
//                      rendered by the production world at 915x412 CSS px x2 with the live 58-degree horizontal FOV.
//   textures.json      import facts for the five textures: imported size and format, and storage bytes per platform.
//   *.jpg              the live rear view, the Appendix B batter views, a behind-bowler view, taller-aspect live views
//                      and the LateAfternoon sky.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using Vande.Practice.Audio;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.Evidence
{
    public static class VandeTextureEvidence
    {
        private const int Width = 1830;
        private const int Height = 824;
        private const float CssScale = 2f;

        private static readonly string[] TextureNames =
        {
            "pitch-balanced-albedo", "outfield-grass-albedo", "bat-willow-albedo",
            "sky-late-afternoon-panorama", "stadium-day-background-v2"
        };

        public static void Run()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            var flights = JsonUtility.FromJson<FlightSet>(File.ReadAllText(Require("VANDE_F012_FLIGHTS")));
            File.WriteAllText(Path.Combine(output, "textures.json"), TextureFacts());

            var json = new StringBuilder();
            json.Append("{\"what\":\"Ball readability per tier, reference ball and moment (builder observation). Production ")
                .Append("world, Day light, white ball, balanced pitch, right-handed, no swing; 1830x824 render (915x412 CSS ")
                .Append("px x2), live horizontal FOV 58 deg. Ball pixels = |with ball - without ball| > 6/255; inner disc = ")
                .Append("mask within 0.7 r of its centroid; ring = 8-18 device px (4-9 CSS px) outside r, from the frame ")
                .Append("without the ball. WCAG relative luminance.\",\"rows\":[");
            var first = true;
            foreach (var quality in new[]
                     {
                         PracticePresentationQuality.Lite, PracticePresentationQuality.Standard,
                         PracticePresentationQuality.High
                     })
            {
                for (var index = 0; index < flights.balls.Length; index++)
                {
                    var ball = flights.balls[index];
                    var moments = new List<(string name, double t)>
                    {
                        ("release", 0.0), ("bounce", ball.bounceT), ("near5", ball.near5T),
                        ("contact", ball.idealContactT)
                    };
                    foreach (var moment in moments)
                    {
                        var row = MeasureBall(quality, ball, moment.name, moment.t, output,
                            index == 0 && quality == PracticePresentationQuality.High);
                        if (!first) json.Append(',');
                        first = false;
                        json.Append(row);
                    }
                }
            }
            json.Append("]}");
            File.WriteAllText(Path.Combine(output, "readability.json"), json.ToString());

            CaptureViews(output, flights.balls[0]);
            CaptureLateAfternoonSky(output);
            Debug.Log("VANDE_TEXTURE_EVIDENCE written to " + output);
        }

        /// <summary>Import facts only (textures.json) for the active build target: use with -buildTarget.</summary>
        public static void Facts()
        {
            var output = Require("VANDE_EVIDENCE_OUT");
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "textures-" + EditorUserBuildSettings.activeBuildTarget + ".json"),
                TextureFacts());
            Debug.Log("VANDE_TEXTURE_FACTS written to " + output);
        }

        private static string MeasureBall(PracticePresentationQuality quality, FlightBall ball, string moment, double t,
            string output, bool saveFrames)
        {
            var root = new GameObject("VANDE texture evidence");
            var target = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
            try
            {
                var world = CreateWorld(root, quality);
                var camera = root.GetComponentsInChildren<Camera>(true).First();
                camera.targetTexture = target;
                camera.ResetAspect();
                world.BeginDelivery(Delivery(ball));
                var timeline = (double)typeof(ProceduralPracticeWorld)
                    .GetField("timeline", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(world);
                world.Tick(-timeline + t);
                var withBall = Read(camera, target);
                var ballVisual = (ProductionBallVisual)typeof(ProceduralPracticeWorld)
                    .GetField("ball", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(world);
                var renderers = ballVisual.GameObject.GetComponentsInChildren<Renderer>(true);
                var enabled = renderers.Select(r => r.enabled).ToArray();
                foreach (var r in renderers) r.enabled = false;
                var withoutBall = Read(camera, target);
                for (var i = 0; i < renderers.Length; i++) renderers[i].enabled = enabled[i];
                if (saveFrames)
                    Save(withBall, Path.Combine(output, $"live-{quality.ToString().ToLowerInvariant()}-ref{ball.ball}-{moment}.jpg"));

                var mask = new List<int>();
                for (var i = 0; i < withBall.Length; i++)
                {
                    var a = withBall[i];
                    var b = withoutBall[i];
                    if (Mathf.Max(Mathf.Abs(a.r - b.r), Mathf.Abs(a.g - b.g), Mathf.Abs(a.b - b.b)) > 6f / 255f)
                        mask.Add(i);
                }
                var sb = new StringBuilder();
                sb.Append("{\"tier\":\"").Append(quality).Append("\",\"ball\":").Append(ball.ball)
                    .Append(",\"moment\":\"").Append(moment).Append("\",\"t\":").Append(F(t))
                    .Append(",\"vfovDeg\":").Append(F(camera.fieldOfView))
                    .Append(",\"cameraAspect\":").Append(F(camera.aspect));
                if (mask.Count == 0)
                {
                    sb.Append(",\"visible\":false}");
                    return sb.ToString();
                }
                double cx = 0, cy = 0;
                foreach (var i in mask)
                {
                    cx += i % Width + 0.5;
                    cy += i / Width + 0.5;
                }
                cx /= mask.Count;
                cy /= mask.Count;
                var radius = Math.Sqrt(mask.Count / Math.PI);
                double inner = 0;
                var innerCount = 0;
                double peak = 0;
                foreach (var i in mask)
                {
                    var dx = i % Width + 0.5 - cx;
                    var dy = i / Width + 0.5 - cy;
                    var l = Luminance(withBall[i]);
                    peak = Math.Max(peak, l);
                    if (Math.Sqrt(dx * dx + dy * dy) > Math.Max(0.75, 0.7 * radius)) continue;
                    inner += l;
                    innerCount++;
                }
                if (innerCount == 0) inner = peak;
                else inner /= innerCount;
                double ring = 0;
                var ringCount = 0;
                double rr = 0, rg = 0, rb = 0;
                var r0 = radius + 4 * CssScale;
                var r1 = radius + 9 * CssScale;
                for (var y = (int)Math.Floor(cy - r1); y <= (int)Math.Ceiling(cy + r1); y++)
                {
                    if (y < 0 || y >= Height) continue;
                    for (var x = (int)Math.Floor(cx - r1); x <= (int)Math.Ceiling(cx + r1); x++)
                    {
                        if (x < 0 || x >= Width) continue;
                        var d = Math.Sqrt(Math.Pow(x + 0.5 - cx, 2) + Math.Pow(y + 0.5 - cy, 2));
                        if (d < r0 || d > r1) continue;
                        var c = withoutBall[y * Width + x];
                        ring += Luminance(c);
                        rr += c.r;
                        rg += c.g;
                        rb += c.b;
                        ringCount++;
                    }
                }
                ring /= Math.Max(1, ringCount);
                var contrast = (Math.Max(inner, ring) + 0.05) / (Math.Min(inner, ring) + 0.05);
                // Unity reads pixels bottom-up; report y from the top like the web method.
                sb.Append(",\"visible\":true,\"centrePx\":[").Append(F(cx)).Append(',').Append(F(Height - cy))
                    .Append("],\"diameterCssPx\":").Append(F(2 * radius / CssScale))
                    .Append(",\"maskPx\":").Append(mask.Count)
                    .Append(",\"innerLuminance\":").Append(F(inner))
                    .Append(",\"peakLuminance\":").Append(F(peak))
                    .Append(",\"ringLuminance\":").Append(F(ring))
                    .Append(",\"ringMeanSrgb\":[").Append(F(rr / Math.Max(1, ringCount))).Append(',')
                    .Append(F(rg / Math.Max(1, ringCount))).Append(',').Append(F(rb / Math.Max(1, ringCount)))
                    .Append("],\"contrast\":").Append(F(contrast)).Append('}');
                return sb.ToString();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static void CaptureViews(string output, FlightBall ball)
        {
            foreach (var quality in new[]
                     {
                         PracticePresentationQuality.Lite, PracticePresentationQuality.Standard,
                         PracticePresentationQuality.High
                     })
            {
                var root = new GameObject("VANDE texture views");
                try
                {
                    var world = CreateWorld(root, quality);
                    var camera = root.GetComponentsInChildren<Camera>(true).First();
                    var tier = quality.ToString().ToLowerInvariant();
                    world.BeginDelivery(Delivery(ball));
                    var timeline = (double)typeof(ProceduralPracticeWorld)
                        .GetField("timeline", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(world);
                    // Run-up, 0.8 s before release: the live rear view as the player first sees each ball.
                    LiveRender(world, camera, -timeline - 0.8, Width, Height, Path.Combine(output, $"live-{tier}-runup-915x412@2x.jpg"));
                    if (quality != PracticePresentationQuality.High) continue;
                    // Taller phone and tablet aspects show more of the plate above the lower tier.
                    LiveRender(world, camera, 0, 1600, 900, Path.Combine(output, $"live-{tier}-runup-16x9.jpg"));
                    LiveRender(world, camera, 0, 1600, 1200, Path.Combine(output, $"live-{tier}-runup-4x3.jpg"));

                    var position = camera.transform.position;
                    var rotation = camera.transform.rotation;
                    var fov = camera.fieldOfView;
                    // Appendix B 1/2/4: the batter (and the willow) front and side, at the stance.
                    Posed(camera, new Vector3(0.2f, 1.05f, 5.2f), new Vector3(0f, 0.85f, 9.25f), 30f, 1920, 1080,
                        Path.Combine(output, "appendixB-batter-front-1920x1080.jpg"));
                    Posed(camera, new Vector3(3.6f, 1.05f, 9.25f), new Vector3(0f, 0.85f, 9.25f), 30f, 1920, 1080,
                        Path.Combine(output, "appendixB-batter-side-1920x1080.jpg"));
                    Posed(camera, new Vector3(0.9f, 1.0f, 7.9f), new Vector3(0.1f, 0.6f, 9.2f), 22f, 1920, 1080,
                        Path.Combine(output, "appendixB-bat-closeup-1920x1080.jpg"));
                    // The plate and boards from behind the bowler's run-up, and the pitch from the bowler's end.
                    Posed(camera, new Vector3(0f, 1.6f, 20f), new Vector3(0f, 1.2f, -60f), 40f, Width, Height,
                        Path.Combine(output, "behind-batter-plate-915x412@2x.jpg"));
                    Posed(camera, new Vector3(0.6f, 1.7f, -14f), new Vector3(0f, 0f, 6f), 40f, Width, Height,
                        Path.Combine(output, "pitch-from-bowler-end-915x412@2x.jpg"));
                    camera.transform.SetPositionAndRotation(position, rotation);
                    camera.fieldOfView = fov;
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        private static void CaptureLateAfternoonSky(string output)
        {
            var host = new GameObject("VANDE sky evidence");
            ProductionCricketEnvironment environment = null;
            try
            {
                environment = ProductionCricketEnvironment.Create(host.transform, new ProductionEnvironmentSpec(
                    PracticePresentationQuality.High, "balanced", "white", ProductionLight.LateAfternoon,
                    ProductionSky.Clear));
                var cameraObject = new GameObject("Sky camera");
                cameraObject.transform.SetParent(host.transform, false);
                var camera = cameraObject.AddComponent<Camera>();
                camera.nearClipPlane = 0.08f;
                camera.farClipPlane = 400f;
                environment.ConfigureCamera(camera);
                Posed(camera, new Vector3(1.7f, 1.68f, 13.35f), new Vector3(0f, 14f, -60f), 62f, Width, Height,
                    Path.Combine(output, "late-afternoon-towards-bowler-915x412@2x.jpg"));
                // Towards the web stage's late-afternoon sun (azimuth 104 deg from +z towards +x, elevation 15 deg).
                Posed(camera, new Vector3(0f, 1.68f, 0f), new Vector3(58.2f, 17.8f, -14.5f), 62f, Width, Height,
                    Path.Combine(output, "late-afternoon-towards-sun-104-915x412@2x.jpg"));
                Posed(camera, new Vector3(0f, 1.68f, 0f), new Vector3(-60f, 25f, -15f), 62f, Width, Height,
                    Path.Combine(output, "late-afternoon-away-from-sun-915x412@2x.jpg"));
                Posed(camera, new Vector3(0f, 1.68f, 0f), new Vector3(0.01f, 60f, 0f), 90f, 1200, 1200,
                    Path.Combine(output, "late-afternoon-zenith-1200.jpg"));
            }
            finally
            {
                environment?.Dispose();
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static ProceduralPracticeWorld CreateWorld(GameObject root, PracticePresentationQuality quality)
        {
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = quality
            }, new SilentSink());
            world.ConfigureScene(Scene());
            return world;
        }

        private static void LiveRender(ProceduralPracticeWorld world, Camera camera, double tick, int width, int height,
            string path)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            try
            {
                camera.targetTexture = target;
                camera.ResetAspect();
                world.Tick(Math.Max(0.0, tick));
                Save(Read(camera, target), path, width, height);
            }
            finally
            {
                camera.targetTexture = null;
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static void Posed(Camera camera, Vector3 position, Vector3 lookAt, float verticalFov, int width,
            int height, string path)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var previous = camera.targetTexture;
            try
            {
                camera.transform.SetPositionAndRotation(position,
                    Quaternion.LookRotation((lookAt - position).normalized, Vector3.up));
                camera.fieldOfView = verticalFov;
                camera.targetTexture = target;
                camera.aspect = width / (float)height;
                Save(Read(camera, target), path, width, height);
            }
            finally
            {
                camera.targetTexture = previous;
                camera.ResetAspect();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static Color[] Read(Camera camera, RenderTexture target)
        {
            var previousActive = RenderTexture.active;
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
                RenderTexture.active = previousActive;
            }
        }

        private static void Save(Color[] colours, string path, int width = Width, int height = Height)
        {
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false);
            texture.SetPixels(colours);
            texture.Apply();
            File.WriteAllBytes(path, texture.EncodeToJPG(92));
            UnityEngine.Object.DestroyImmediate(texture);
        }

        private static double Luminance(Color c)
        {
            double Lin(float v) => v <= 0.04045 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
            return 0.2126 * Lin(c.r) + 0.7152 * Lin(c.g) + 0.0722 * Lin(c.b);
        }

        private static string TextureFacts()
        {
            var sb = new StringBuilder();
            sb.Append("{\"what\":\"Import facts for the five procedural textures (builder observation). Storage bytes per ")
                .Append("platform are computed from the importer's automatic format and the capped size, with the full ")
                .Append("mip chain; they are not APK or installed bytes.\",\"activeBuildTarget\":\"")
                .Append(EditorUserBuildSettings.activeBuildTarget).Append("\",\"textures\":[");
            var first = true;
            foreach (var name in TextureNames)
            {
                var path = "Assets/VandePractice/Runtime/Presentation/Resources/Textures/" + name + ".png";
                var importer = (TextureImporter)AssetImporter.GetAtPath(path);
                var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                if (!first) sb.Append(',');
                first = false;
                var fileBytes = new FileInfo(path).Length;
                importer.GetSourceTextureWidthAndHeight(out var sourceWidth, out var sourceHeight);
                sb.Append("{\"name\":\"").Append(name).Append("\",\"sourceBytes\":").Append(fileBytes)
                    .Append(",\"source\":[").Append(sourceWidth).Append(',').Append(sourceHeight).Append(']')
                    .Append(",\"imported\":[").Append(texture.width).Append(',').Append(texture.height).Append(']')
                    .Append(",\"importedFormat\":\"").Append(texture.format).Append("\",\"mipmaps\":")
                    .Append(texture.mipmapCount).Append(",\"npotScale\":\"").Append(importer.npotScale)
                    .Append("\",\"wrap\":\"").Append(texture.wrapModeU).Append('/')
                    .Append(texture.wrapModeV).Append("\",\"editorStorageBytes\":").Append(StorageBytes(texture))
                    .Append(",\"platforms\":{");
                var firstPlatform = true;
                foreach (var platform in new[] { "Android", "WebGL", "Standalone" })
                {
                    var settings = importer.GetPlatformTextureSettings(platform);
                    var maxSize = settings.overridden ? settings.maxTextureSize : importer.maxTextureSize;
                    var format = importer.GetAutomaticFormat(platform);
                    var scale = Math.Min(1.0, maxSize / (double)Math.Max(sourceWidth, sourceHeight));
                    var w = Math.Max(1, (int)Math.Round(sourceWidth * scale));
                    var h = Math.Max(1, (int)Math.Round(sourceHeight * scale));
                    long bytes = -1;
                    try
                    {
                        var graphics = GraphicsFormatUtility.GetGraphicsFormat((TextureFormat)(int)format, true);
                        bytes = 0;
                        var mw = w;
                        var mh = h;
                        while (true)
                        {
                            bytes += GraphicsFormatUtility.ComputeMipmapSize(mw, mh, graphics);
                            if (mw == 1 && mh == 1) break;
                            mw = Math.Max(1, mw / 2);
                            mh = Math.Max(1, mh / 2);
                        }
                    }
                    catch (Exception)
                    {
                        bytes = -1;
                    }
                    if (!firstPlatform) sb.Append(',');
                    firstPlatform = false;
                    sb.Append('"').Append(platform).Append("\":{\"maxSize\":").Append(maxSize)
                        .Append(",\"size\":[").Append(w).Append(',').Append(h).Append("],\"format\":\"").Append(format)
                        .Append("\",\"storageBytes\":").Append(bytes).Append('}');
                }
                sb.Append("}}");
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static long StorageBytes(Texture texture)
        {
            var util = typeof(EditorUtility).Assembly.GetType("UnityEditor.TextureUtil");
            var method = util?.GetMethod("GetStorageMemorySizeLong", BindingFlags.Static | BindingFlags.Public |
                                                                      BindingFlags.NonPublic);
            return method == null ? -1 : Convert.ToInt64(method.Invoke(null, new object[] { texture }));
        }

        private static PracticeScenePresentation Scene()
        {
            var spots = new (string id, string role, double x, double z)[]
            {
                ("keeper", "keeper", 0, 12.6), ("bowler", "bowler", 0, -12), ("slip", "slip", 1.6, 13.4),
                ("point", "point", 18, 8), ("cover", "cover", 20, -2), ("mid_off", "mid_off", 8, -18),
                ("mid_on", "mid_on", -8, -18), ("midwicket", "midwicket", -22, -2), ("square_leg", "square_leg", -24, 9),
                ("fine_leg", "fine_leg", -40, 52), ("third_man", "third_man", 40, 52)
            };
            return new PracticeScenePresentation
            {
                BallAge = "new", BallColour = "white", BatterCreaseOffsetM = 0, BatterLateralM = 0,
                BowlerArm = "right", BowlerFamily = "pace", Conditions = "balanced", Handedness = "right",
                Fielders = spots.Select(s => new PracticeFielderPresentation { Id = s.id, Role = s.role, X = s.x, Z = s.z })
                    .ToArray()
            };
        }

        private static PracticeDeliveryPresentation Delivery(FlightBall ball)
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
                Seed = ball.seed,
                Flight = flight.ToArray(),
                BounceT = ball.bounceT,
                IdealContactT = ball.idealContactT,
                StumpsT = ball.stumpsT,
                SeamAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                ShineDirection = new TraceVector3 { x = 1, y = 0, z = 0 },
                SpinAxis = new TraceVector3 { x = 0, y = 1, z = 0 },
                SpinRps = 10,
                PlannedSpeedKph = ball.speedKph,
                ReleaseSpeedKph = ball.speedKph
            };
        }

        private static string Require(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (string.IsNullOrEmpty(value)) throw new InvalidOperationException(name + " is required.");
            return value;
        }

        private static string F(double value) =>
            double.IsInfinity(value) || double.IsNaN(value) ? "null" : value.ToString("R", CultureInfo.InvariantCulture);

        [Serializable]
        private sealed class FlightSet
        {
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
