using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Vande.Practice.Presentation.Production.Environment
{
    /// <summary>
    /// One presentation-only atmosphere. Values mirror the retained renderer's
    /// day/late-afternoon/evening intent without creating another gameplay input.
    /// </summary>
    internal readonly struct ProductionEnvironmentLook
    {
        internal ProductionEnvironmentLook(
            Color zenith,
            Color middle,
            Color horizon,
            Color fog,
            Color ambientSky,
            Color ambientEquator,
            Color ambientGround,
            float ambientIntensity,
            float fogStart,
            float fogEnd,
            Color keyColour,
            float keyIntensity,
            Quaternion keyRotation,
            float floodlightStrength,
            bool useLateAfternoonPanorama)
        {
            Zenith = zenith;
            Middle = middle;
            Horizon = horizon;
            Fog = fog;
            AmbientSky = ambientSky;
            AmbientEquator = ambientEquator;
            AmbientGround = ambientGround;
            AmbientIntensity = ambientIntensity;
            FogStart = fogStart;
            FogEnd = fogEnd;
            KeyColour = keyColour;
            KeyIntensity = keyIntensity;
            KeyRotation = keyRotation;
            FloodlightStrength = floodlightStrength;
            UseLateAfternoonPanorama = useLateAfternoonPanorama;
        }

        internal Color Zenith { get; }
        internal Color Middle { get; }
        internal Color Horizon { get; }
        internal Color Fog { get; }
        internal Color AmbientSky { get; }
        internal Color AmbientEquator { get; }
        internal Color AmbientGround { get; }
        internal float AmbientIntensity { get; }
        internal float FogStart { get; }
        internal float FogEnd { get; }
        internal Color KeyColour { get; }
        internal float KeyIntensity { get; }
        internal Quaternion KeyRotation { get; }
        internal float FloodlightStrength { get; }
        internal bool UseLateAfternoonPanorama { get; }

        /// <summary>
        /// The reference stage's day sun (src/render3d/three/stadium.ts LOOKS.day: azimuth 58 deg, elevation 54 deg),
        /// in the striker's frame shared by the physics, the web stage and this world: the batter looks down -z, so
        /// this sun is high, off side and behind the batter, and the batter sees the lit face of the ball. The previous
        /// Euler(42, -58, 0) put the sun behind the bowler (mirrored in z), so the batter saw the ball's unlit side and
        /// a white ball read at about 1.5-2.2:1 against the sunlit pitch (T1, READ2).
        /// </summary>
        internal const float DaySunAzimuthDegrees = 58f;
        internal const float DaySunElevationDegrees = 54f;

        /// <summary>
        /// The reference stage's late-afternoon sun (stadium.ts LOOKS.late_afternoon: azimuth 104 deg, elevation 15 deg):
        /// low, off side and a little towards the bowler's end. The previous Euler(22, -104, 0) was mirrored in z
        /// (azimuth 76 deg, elevation 22 deg). TEXTURES' sky-late-afternoon-panorama glow is painted at this same
        /// direction (scripts/unity-textures/textures/sky.mjs SUN_AZ/SUN_EL), so the two must change together.
        /// </summary>
        internal const float LateAfternoonSunAzimuthDegrees = 104f;
        internal const float LateAfternoonSunElevationDegrees = 15f;

        /// <summary>
        /// A directional key for a sun at the web stage's azimuth (from +z towards +x) and elevation. The web places
        /// the light at sunDir = (sin az cos el, sin el, cos az cos el); a Unity directional light shines along its
        /// forward, away from the sun.
        /// </summary>
        internal static Quaternion SunKey(float azimuthDegrees, float elevationDegrees)
        {
            var azimuth = azimuthDegrees * Mathf.Deg2Rad;
            var elevation = elevationDegrees * Mathf.Deg2Rad;
            var towardSun = new Vector3(
                Mathf.Sin(azimuth) * Mathf.Cos(elevation),
                Mathf.Sin(elevation),
                Mathf.Cos(azimuth) * Mathf.Cos(elevation));
            return Quaternion.LookRotation(-towardSun, Vector3.up);
        }

        internal static ProductionEnvironmentLook For(ProductionEnvironmentSpec spec)
        {
            if (spec == null) throw new ArgumentNullException(nameof(spec));
            ProductionEnvironmentLook clear;
            switch (spec.Light)
            {
                case ProductionLight.Day:
                    clear = new ProductionEnvironmentLook(
                        new Color(0.18f, 0.43f, 0.78f),
                        new Color(0.43f, 0.65f, 0.86f),
                        new Color(0.76f, 0.86f, 0.94f),
                        new Color(0.66f, 0.77f, 0.86f),
                        new Color(0.72f, 0.83f, 0.95f),
                        new Color(0.45f, 0.57f, 0.66f),
                        new Color(0.20f, 0.31f, 0.17f),
                        1.0f, 145f, 178f,
                        new Color(1f, 0.94f, 0.84f), 1.18f,
                        SunKey(DaySunAzimuthDegrees, DaySunElevationDegrees), 0f, false);
                    break;
                case ProductionLight.LateAfternoon:
                    clear = new ProductionEnvironmentLook(
                        new Color(0.16f, 0.39f, 0.69f),
                        new Color(0.49f, 0.63f, 0.78f),
                        new Color(0.90f, 0.67f, 0.40f),
                        new Color(0.66f, 0.55f, 0.42f),
                        new Color(0.60f, 0.70f, 0.84f),
                        new Color(0.48f, 0.43f, 0.38f),
                        new Color(0.18f, 0.25f, 0.12f),
                        0.86f, 122f, 176f,
                        new Color(1f, 0.76f, 0.52f), 1.02f,
                        SunKey(LateAfternoonSunAzimuthDegrees, LateAfternoonSunElevationDegrees), 0.35f, true);
                    break;
                default:
                    clear = new ProductionEnvironmentLook(
                        new Color(0.016f, 0.012f, 0.09f),
                        new Color(0.065f, 0.052f, 0.21f),
                        new Color(0.24f, 0.11f, 0.20f),
                        new Color(0.10f, 0.075f, 0.20f),
                        new Color(0.37f, 0.37f, 0.62f),
                        new Color(0.18f, 0.16f, 0.29f),
                        new Color(0.045f, 0.13f, 0.07f),
                        0.82f, 105f, 176f,
                        new Color(1f, 0.91f, 0.78f), 1.12f,
                        Quaternion.Euler(52f, -30f, 0f), 1f, false);
                    break;
            }

            if (spec.Sky == ProductionSky.Clear) return clear;
            var overcast = new Color(0.55f, 0.58f, 0.63f);
            return new ProductionEnvironmentLook(
                Color.Lerp(clear.Zenith, overcast, 0.62f),
                Color.Lerp(clear.Middle, overcast, 0.68f),
                Color.Lerp(clear.Horizon, new Color(0.72f, 0.70f, 0.68f), 0.58f),
                Color.Lerp(clear.Fog, overcast, 0.48f),
                Color.Lerp(clear.AmbientSky, overcast, 0.45f),
                Color.Lerp(clear.AmbientEquator, overcast, 0.42f),
                Color.Lerp(clear.AmbientGround, new Color(0.24f, 0.29f, 0.22f), 0.40f),
                clear.AmbientIntensity * 1.08f,
                clear.FogStart - 18f,
                clear.FogEnd - 12f,
                Color.Lerp(clear.KeyColour, Color.white, 0.46f),
                clear.KeyIntensity * 0.76f,
                clear.KeyRotation,
                Mathf.Max(clear.FloodlightStrength, spec.Light == ProductionLight.Day ? 0f : 0.55f),
                false);
        }
    }

    internal readonly struct ProductionRenderSettingsSnapshot
    {
        private ProductionRenderSettingsSnapshot(
            AmbientMode ambientMode,
            Color ambientSky,
            Color ambientEquator,
            Color ambientGround,
            float ambientIntensity,
            bool fog,
            FogMode fogMode,
            Color fogColour,
            float fogStart,
            float fogEnd)
        {
            this.ambientMode = ambientMode;
            this.ambientSky = ambientSky;
            this.ambientEquator = ambientEquator;
            this.ambientGround = ambientGround;
            this.ambientIntensity = ambientIntensity;
            this.fog = fog;
            this.fogMode = fogMode;
            this.fogColour = fogColour;
            this.fogStart = fogStart;
            this.fogEnd = fogEnd;
        }

        private readonly AmbientMode ambientMode;
        private readonly Color ambientSky;
        private readonly Color ambientEquator;
        private readonly Color ambientGround;
        private readonly float ambientIntensity;
        private readonly bool fog;
        private readonly FogMode fogMode;
        private readonly Color fogColour;
        private readonly float fogStart;
        private readonly float fogEnd;

        internal static ProductionRenderSettingsSnapshot Capture()
        {
            return new ProductionRenderSettingsSnapshot(
                RenderSettings.ambientMode,
                RenderSettings.ambientSkyColor,
                RenderSettings.ambientEquatorColor,
                RenderSettings.ambientGroundColor,
                RenderSettings.ambientIntensity,
                RenderSettings.fog,
                RenderSettings.fogMode,
                RenderSettings.fogColor,
                RenderSettings.fogStartDistance,
                RenderSettings.fogEndDistance);
        }

        internal void Restore()
        {
            RenderSettings.ambientMode = ambientMode;
            RenderSettings.ambientSkyColor = ambientSky;
            RenderSettings.ambientEquatorColor = ambientEquator;
            RenderSettings.ambientGroundColor = ambientGround;
            RenderSettings.ambientIntensity = ambientIntensity;
            RenderSettings.fog = fog;
            RenderSettings.fogMode = fogMode;
            RenderSettings.fogColor = fogColour;
            RenderSettings.fogStartDistance = fogStart;
            RenderSettings.fogEndDistance = fogEnd;
        }
    }

    internal static class ProductionEnvironmentAtmosphere
    {
        private static readonly float[] SkyElevations = { -8f, 10f, 30f, 52f, 72f, 86f };

        internal static void ApplyRenderSettings(ProductionEnvironmentLook look)
        {
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = look.AmbientSky;
            RenderSettings.ambientEquatorColor = look.AmbientEquator;
            RenderSettings.ambientGroundColor = look.AmbientGround;
            RenderSettings.ambientIntensity = look.AmbientIntensity;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = look.Fog;
            RenderSettings.fogStartDistance = look.FogStart;
            RenderSettings.fogEndDistance = look.FogEnd;
        }

        internal static Mesh BuildSkyDome(
            int segments,
            float radius,
            ProductionEnvironmentLook look)
        {
            if (segments < 16) throw new ArgumentOutOfRangeException(nameof(segments));
            if (radius <= 0f) throw new ArgumentOutOfRangeException(nameof(radius));
            var vertices = new List<Vector3>(SkyElevations.Length * (segments + 1) + segments);
            var normals = new List<Vector3>(vertices.Capacity);
            var colours = new List<Color>(vertices.Capacity);
            var uv = new List<Vector2>(vertices.Capacity);
            var triangles = new List<int>(SkyElevations.Length * segments * 6);

            for (var ring = 0; ring < SkyElevations.Length; ring++)
            {
                var elevation01 = Mathf.InverseLerp(SkyElevations[0], 90f, SkyElevations[ring]);
                var elevation = SkyElevations[ring] * Mathf.Deg2Rad;
                var ringRadius = Mathf.Cos(elevation) * radius;
                var y = Mathf.Sin(elevation) * radius;
                var tint = SkyColour(look, elevation01);
                if (look.UseLateAfternoonPanorama) tint = Color.white;
                for (var segment = 0; segment <= segments; segment++)
                {
                    var u = segment / (float)segments;
                    var angle = u * Mathf.PI * 2f;
                    var vertex = new Vector3(
                        Mathf.Sin(angle) * ringRadius,
                        y,
                        Mathf.Cos(angle) * ringRadius);
                    vertices.Add(vertex);
                    normals.Add(-vertex.normalized);
                    colours.Add(tint);
                    uv.Add(new Vector2(u, Mathf.Lerp(0.02f, 0.92f, elevation01)));
                }
            }

            var stride = segments + 1;
            for (var ring = 0; ring < SkyElevations.Length - 1; ring++)
            {
                for (var segment = 0; segment < segments; segment++)
                {
                    var lower = ring * stride + segment;
                    var nextLower = lower + 1;
                    var upper = lower + stride;
                    var nextUpper = upper + 1;
                    // Reverse the conventional sphere winding: this dome is
                    // intentionally viewed from the playing field inside it.
                    triangles.Add(lower); triangles.Add(upper); triangles.Add(nextUpper);
                    triangles.Add(lower); triangles.Add(nextUpper); triangles.Add(nextLower);
                }
            }

            var topRing = (SkyElevations.Length - 1) * stride;
            for (var segment = 0; segment < segments; segment++)
            {
                var apex = vertices.Count;
                vertices.Add(Vector3.up * radius);
                normals.Add(Vector3.down);
                colours.Add(look.UseLateAfternoonPanorama ? Color.white : look.Zenith);
                uv.Add(new Vector2((segment + 0.5f) / segments, 0.99f));
                triangles.Add(topRing + segment);
                triangles.Add(apex);
                triangles.Add(topRing + segment + 1);
            }

            var mesh = new Mesh { name = "VANDE inward atmospheric sky dome" };
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetColors(colours);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Color SkyColour(ProductionEnvironmentLook look, float elevation01)
        {
            if (elevation01 < 0.48f)
                return Color.Lerp(look.Horizon, look.Middle,
                    Mathf.SmoothStep(0f, 1f, elevation01 / 0.48f));
            return Color.Lerp(look.Middle, look.Zenith,
                Mathf.SmoothStep(0f, 1f, (elevation01 - 0.48f) / 0.52f));
        }
    }
}
