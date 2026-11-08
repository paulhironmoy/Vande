using System;
using UnityEngine;
using Vande.Practice.Presentation;

namespace Vande.Practice.Presentation.Production.Environment
{
    public enum ProductionLight
    {
        Day,
        LateAfternoon,
        Evening
    }

    public enum ProductionSky
    {
        Clear,
        LightOvercast
    }

    public sealed class ProductionEnvironmentSpec
    {
        public ProductionEnvironmentSpec(
            PracticePresentationQuality quality,
            string pitchCondition,
            string ballColour,
            ProductionLight light = ProductionLight.Evening,
            ProductionSky sky = ProductionSky.Clear,
            bool reducedMotion = false)
        {
            Quality = quality;
            PitchCondition = ProductionPitchLooks.For(pitchCondition).Key;
            BallColour = string.Equals(ballColour, "red", StringComparison.Ordinal) ? "red" : "white";
            Light = light;
            Sky = sky;
            ReducedMotion = reducedMotion;
        }

        public PracticePresentationQuality Quality { get; }
        public string PitchCondition { get; }
        public string BallColour { get; }
        public ProductionLight Light { get; }
        public ProductionSky Sky { get; }
        public bool ReducedMotion { get; }

        public int CrowdCount
        {
            get
            {
                switch (Quality)
                {
                    // Eight shared section meshes keep draw calls fixed while
                    // providing the occupied stadium inherited from the
                    // retained renderer. Detail tiers vary geometry density,
                    // not gameplay or crowd foreknowledge.
                    case PracticePresentationQuality.Lite: return 192;
                    case PracticePresentationQuality.Standard: return 768;
                    case PracticePresentationQuality.High: return 1536;
                    default: throw new ArgumentOutOfRangeException();
                }
            }
        }
    }

    /// <summary>
    /// A visual look anchored to the exact Stage 1 physics parameters. Unity
    /// consumes the look only; TypeScript remains authoritative for bounce,
    /// friction, seam, turn and swing.
    /// </summary>
    public readonly struct ProductionPitchLook
    {
        public ProductionPitchLook(
            string key,
            string label,
            float restitution,
            float friction,
            float seamGrip,
            float turnGrip,
            float swingFactor,
            Color soil,
            Color detail,
            Color grass,
            float grassCover,
            float cracks,
            float dust,
            float sheen)
        {
            Key = key;
            Label = label;
            Restitution = restitution;
            Friction = friction;
            SeamGrip = seamGrip;
            TurnGrip = turnGrip;
            SwingFactor = swingFactor;
            Soil = soil;
            Detail = detail;
            Grass = grass;
            GrassCover = Mathf.Clamp01(grassCover);
            Cracks = Mathf.Clamp01(cracks);
            Dust = Mathf.Clamp01(dust);
            Sheen = Mathf.Clamp01(sheen);
        }

        public string Key { get; }
        public string Label { get; }
        public float Restitution { get; }
        public float Friction { get; }
        public float SeamGrip { get; }
        public float TurnGrip { get; }
        public float SwingFactor { get; }
        public Color Soil { get; }
        public Color Detail { get; }
        public Color Grass { get; }
        public float GrassCover { get; }
        public float Cracks { get; }
        public float Dust { get; }
        public float Sheen { get; }
    }

    public static class ProductionPitchLooks
    {
        // Keep these five physical values byte-for-byte aligned with
        // src/physics/constants.ts PITCHES. They are presentation metadata,
        // never a second simulation table.
        private static readonly ProductionPitchLook Balanced = new ProductionPitchLook(
            "balanced", "Balanced", 0.60f, 0.30f, 0.014f, 0.55f, 1.00f,
            // Soil is a near-neutral albedo multiplier because the registered
            // pitch texture already carries the loam colour. The former blue
            // counter-tint turned the strip grey in WebGL and made untextured
            // detail patches read as pale paint fragments.
            new Color(0.82f, 0.84f, 0.92f), new Color(0.46f, 0.35f, 0.24f),
            new Color(0.30f, 0.39f, 0.22f), 0.20f, 0.12f, 0.08f, 0.30f);

        private static readonly ProductionPitchLook Green = new ProductionPitchLook(
            "green", "Green", 0.58f, 0.27f, 0.026f, 0.45f, 1.45f,
            new Color(0.72f, 0.84f, 0.70f), new Color(0.37f, 0.42f, 0.28f),
            new Color(0.25f, 0.47f, 0.24f), 0.92f, 0.03f, 0.02f, 0.18f);

        private static readonly ProductionPitchLook Hard = new ProductionPitchLook(
            "hard", "Hard & Bouncy", 0.67f, 0.25f, 0.012f, 0.50f, 0.85f,
            new Color(0.90f, 0.88f, 0.82f), new Color(0.54f, 0.41f, 0.28f),
            new Color(0.34f, 0.39f, 0.23f), 0.12f, 0.08f, 0.03f, 0.88f);

        private static readonly ProductionPitchLook Turning = new ProductionPitchLook(
            "turning", "Turning", 0.55f, 0.40f, 0.012f, 0.95f, 0.80f,
            new Color(0.82f, 0.74f, 0.68f), new Color(0.40f, 0.29f, 0.20f),
            new Color(0.27f, 0.31f, 0.19f), 0.08f, 0.95f, 0.92f, 0.04f);

        public static ProductionPitchLook For(string condition)
        {
            switch (condition)
            {
                case "green": return Green;
                case "hard": return Hard;
                case "turning": return Turning;
                default: return Balanced;
            }
        }
    }
}
