using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// Stage-1 roles only. These are presentation roles, never gameplay authorities.
    /// </summary>
    public enum ProductionCharacterRole
    {
        Batter,
        PaceBowler,
        SpinBowler,
        Wicketkeeper,
        Fielder,
        Umpire
    }

    public enum ProductionCharacterDetail
    {
        Low,
        Medium,
        High
    }

    public enum ProductionCharacterHandedness
    {
        Right,
        Left
    }

    public enum ProductionCharacterMotion
    {
        Stand,
        PaceBowling,
        SpinBowling,
        BatterStance,
        BatterStroke,
        KeeperCrouch,
        KeeperCollection,
        FielderRun,
        FielderDive,
        FielderThrow,
        UmpireStand,
        // Appended to preserve the serialized numeric values of the existing motion contract.
        FielderReady
    }

    public enum ProductionCharacterMarker
    {
        RunUpComplete,
        Gather,
        FrontFootPlant,
        Release,
        Backlift,
        FootPlant,
        Contact,
        FollowThrough,
        Collection,
        Land
    }

    /// <summary>
    /// Presentation-only foot placement selected from the existing host swing intent. Balanced is used when the
    /// host intent is automatic because the resolved result footwork is not currently carried by the C# projection.
    /// This enum never changes collision, timing or scoring.
    /// </summary>
    public enum ProductionBatterFootwork
    {
        Balanced,
        Forward,
        Back,
        Across,
        DownTrack
    }

    /// <summary>
    /// Compact authored motion timing for the family already validated by host.scene. The ball's authoritative
    /// release point still comes from the host flight trace; these values only control the approach animation.
    /// </summary>
    public readonly struct ProductionBowlingPresentation
    {
        public const float PaceApproachDistanceMetres = 14.0f;
        public const float SpinApproachDistanceMetres = 5.2f;
        public const float PaceFrontFootPlantRootTravelNormalized = 0.95f;
        public const float SpinFrontFootPlantRootTravelNormalized = 0.94f;

        private ProductionBowlingPresentation(
            ProductionCharacterRole role,
            ProductionCharacterMotion motion,
            float approachSeconds,
            float approachDistanceMetres,
            float frontFootPlantRootTravelNormalized,
            float followThroughSeconds,
            float releaseNormalized)
        {
            Role = role;
            Motion = motion;
            ApproachSeconds = approachSeconds;
            ApproachDistanceMetres = approachDistanceMetres;
            FrontFootPlantRootTravelNormalized = frontFootPlantRootTravelNormalized;
            FollowThroughSeconds = followThroughSeconds;
            ReleaseNormalized = releaseNormalized;
        }

        public ProductionCharacterRole Role { get; }
        public ProductionCharacterMotion Motion { get; }
        public float ApproachSeconds { get; }
        public float ApproachDistanceMetres { get; }
        /// <summary>
        /// Fraction of presentation-only world travel completed when the front foot plants. The complementary
        /// distance is countered locally until release so the braced foot does not skate toward the crease.
        /// </summary>
        public float FrontFootPlantRootTravelNormalized { get; }
        public float FollowThroughSeconds { get; }
        public float ReleaseNormalized { get; }

        public static ProductionBowlingPresentation ForSceneFamily(string family)
        {
            if (string.Equals(family, "pace", StringComparison.Ordinal))
            {
                return new ProductionBowlingPresentation(
                    ProductionCharacterRole.PaceBowler,
                    ProductionCharacterMotion.PaceBowling,
                    2.40f,
                    PaceApproachDistanceMetres,
                    PaceFrontFootPlantRootTravelNormalized,
                    0.80f,
                    ProductionCharacterMotionSampler.PaceRelease);
            }

            if (string.Equals(family, "spin", StringComparison.Ordinal))
            {
                return new ProductionBowlingPresentation(
                    ProductionCharacterRole.SpinBowler,
                    ProductionCharacterMotion.SpinBowling,
                    1.55f,
                    SpinApproachDistanceMetres,
                    SpinFrontFootPlantRootTravelNormalized,
                    0.72f,
                    ProductionCharacterMotionSampler.SpinRelease);
            }

            throw new ArgumentException("A supported host.scene bowler family is required.", nameof(family));
        }
    }

    /// <summary>
    /// A presentation-only read cue derived from an already-authoritative host
    /// delivery. The cue has no line or length input by design: it can express
    /// an honest action (rhythm, gather and wrist) but cannot expose the exact
    /// target or alter release time, release point, flight, contact or score.
    /// </summary>
    public enum ProductionBowlingCueKind
    {
        Stock,
        Outswing,
        Inswing,
        Seam,
        Cutter,
        Slower,
        Bouncer,
        Yorker,
        Flighted,
        Quicker,
        Topspinner,
        ArmBall,
        WrongUn
    }

    public readonly struct ProductionBowlingCueProfile
    {
        private ProductionBowlingCueProfile(
            ProductionBowlingCueKind kind,
            ProductionCharacterMotion motion,
            float cadenceWarp,
            float gatherHeightMetres,
            float gatherLeanDegrees,
            float gatherTurnDegrees,
            float wristCockDegrees,
            Vector3 releaseWristEuler)
        {
            Kind = kind;
            Motion = motion;
            CadenceWarp = cadenceWarp;
            GatherHeightMetres = gatherHeightMetres;
            GatherLeanDegrees = gatherLeanDegrees;
            GatherTurnDegrees = gatherTurnDegrees;
            WristCockDegrees = wristCockDegrees;
            ReleaseWristEuler = releaseWristEuler;
        }

        public ProductionBowlingCueKind Kind { get; }
        public ProductionCharacterMotion Motion { get; }
        public float CadenceWarp { get; }
        public float GatherHeightMetres { get; }
        public float GatherLeanDegrees { get; }
        public float GatherTurnDegrees { get; }
        public float WristCockDegrees { get; }
        public Vector3 ReleaseWristEuler { get; }

        public static ProductionBowlingCueProfile ForHostDelivery(
            ProductionCharacterRole role,
            string variation,
            double plannedSpeedKph,
            double releaseSpeedKph,
            double seamDeg,
            double seamWobble,
            double spinRps)
        {
            if (string.IsNullOrEmpty(variation))
                throw new ArgumentException("A host delivery variation is required.", nameof(variation));
            if (double.IsNaN(plannedSpeedKph) || double.IsInfinity(plannedSpeedKph) ||
                double.IsNaN(releaseSpeedKph) || double.IsInfinity(releaseSpeedKph) ||
                double.IsNaN(seamDeg) || double.IsInfinity(seamDeg) ||
                double.IsNaN(seamWobble) || double.IsInfinity(seamWobble) ||
                double.IsNaN(spinRps) || double.IsInfinity(spinRps))
                throw new ArgumentOutOfRangeException(nameof(releaseSpeedKph));

            var wobble = Mathf.Clamp((float)seamWobble, -1f, 1f);
            var seam = Mathf.Clamp((float)seamDeg, -45f, 45f);
            var side = seam < -0.5f ? -1f : seam > 0.5f ? 1f : wobble < 0f ? -1f : 1f;

            if (role == ProductionCharacterRole.PaceBowler)
            {
                var speedCadence = Mathf.Clamp(
                    ((float)((plannedSpeedKph + releaseSpeedKph) * 0.5) - 135f) / 1000f,
                    -0.008f,
                    0.008f);
                switch (variation)
                {
                    case "stock":
                        return Pace(ProductionBowlingCueKind.Stock, speedCadence,
                            0f, 0f, 0f, 1f,
                            new Vector3(
                                Mathf.Clamp(seam * 0.04f, -1f, 1f),
                                Mathf.Clamp(seam * 0.10f, -2f, 2f),
                                wobble * 1.5f));
                    case "outswing":
                        return Pace(ProductionBowlingCueKind.Outswing, 0.025f + speedCadence,
                            0.006f, -1f, -2f * side, 2f,
                            new Vector3(-1f, 5.2f * side, 2f * side));
                    case "inswing":
                        return Pace(ProductionBowlingCueKind.Inswing, 0.018f + speedCadence,
                            0.006f, -1f, 2f * side, 2.5f,
                            new Vector3(0.5f, 5.2f * side, -2f * side));
                    case "seam":
                        return Pace(ProductionBowlingCueKind.Seam, 0.012f + speedCadence,
                            0.004f, -1.5f, 0f, 1f,
                            new Vector3(-2f, Mathf.Clamp(seam * 0.04f, -1.2f, 1.2f), wobble * 2f));
                    case "cutter":
                        return Pace(ProductionBowlingCueKind.Cutter, -0.035f + speedCadence,
                            0.012f, 2f, 3f * side, 6f,
                            new Vector3(3f, 4.5f * side, 5.5f * side));
                    case "slower":
                        return Pace(ProductionBowlingCueKind.Slower, -0.09f + speedCadence,
                            0.026f, 4f, 2f * side, 7f,
                            new Vector3(5f, 3.2f * side, 6f * side));
                    case "bouncer":
                        return Pace(ProductionBowlingCueKind.Bouncer, 0.05f + speedCadence,
                            0.032f, -4.5f, 0f, 3f,
                            new Vector3(-2.5f, 2f * side, wobble));
                    case "yorker":
                        return Pace(ProductionBowlingCueKind.Yorker, 0.035f + speedCadence,
                            -0.008f, 3.5f, 0f, 2f,
                            new Vector3(2.5f, 2.2f * side, wobble));
                    default:
                        throw new ArgumentException(
                            "The host variation is not a pace-bowling action.", nameof(variation));
                }
            }

            if (role == ProductionCharacterRole.SpinBowler)
            {
                var speedCadence = Mathf.Clamp(
                    ((float)((plannedSpeedKph + releaseSpeedKph) * 0.5) - 85f) / 700f,
                    -0.012f,
                    0.012f);
                // Spin rate changes wrist energy very slightly without changing
                // the ball rotation, which remains entirely host-authored.
                var spinEnergy = Mathf.Clamp(((float)spinRps - 12f) * 0.08f, -1f, 1f);
                switch (variation)
                {
                    case "stock":
                        return Spin(ProductionBowlingCueKind.Stock, speedCadence,
                            0.008f, 1f, side, 4f + spinEnergy,
                            new Vector3(0f, 2.5f * side, 3f * side));
                    case "flighted":
                        return Spin(ProductionBowlingCueKind.Flighted, -0.075f + speedCadence,
                            0.034f, 3.5f, 2f * side, 6f + spinEnergy,
                            new Vector3(5f, 2.5f * side, 4f * side));
                    case "quicker":
                        return Spin(ProductionBowlingCueKind.Quicker, 0.07f + speedCadence,
                            -0.006f, -3f, 0.5f * side, 2f + spinEnergy,
                            new Vector3(-4f, 1.5f * side, 2f * side));
                    case "topspinner":
                        return Spin(ProductionBowlingCueKind.Topspinner, -0.015f + speedCadence,
                            0.018f, 2f, 0f, 5f + spinEnergy,
                            new Vector3(7f, 0f, 0f));
                    case "arm_ball":
                        return Spin(ProductionBowlingCueKind.ArmBall, 0.035f + speedCadence,
                            0f, -1f, -0.5f * side, 1f + spinEnergy,
                            new Vector3(-3f, side, 0f));
                    case "wrong_un":
                        return Spin(ProductionBowlingCueKind.WrongUn, -0.035f + speedCadence,
                            0.015f, 2.5f, -3f * side, 8f + spinEnergy,
                            new Vector3(4f, -5.5f * side, -6f * side));
                    default:
                        throw new ArgumentException(
                            "The host variation is not a spin-bowling action.", nameof(variation));
                }
            }

            throw new ArgumentException("A supported bowling role is required.", nameof(role));
        }

        private static ProductionBowlingCueProfile Pace(
            ProductionBowlingCueKind kind,
            float cadenceWarp,
            float gatherHeightMetres,
            float gatherLeanDegrees,
            float gatherTurnDegrees,
            float wristCockDegrees,
            Vector3 releaseWristEuler)
        {
            return new ProductionBowlingCueProfile(
                kind,
                ProductionCharacterMotion.PaceBowling,
                cadenceWarp,
                gatherHeightMetres,
                gatherLeanDegrees,
                gatherTurnDegrees,
                wristCockDegrees,
                releaseWristEuler);
        }

        private static ProductionBowlingCueProfile Spin(
            ProductionBowlingCueKind kind,
            float cadenceWarp,
            float gatherHeightMetres,
            float gatherLeanDegrees,
            float gatherTurnDegrees,
            float wristCockDegrees,
            Vector3 releaseWristEuler)
        {
            return new ProductionBowlingCueProfile(
                kind,
                ProductionCharacterMotion.SpinBowling,
                cadenceWarp,
                gatherHeightMetres,
                gatherLeanDegrees,
                gatherTurnDegrees,
                wristCockDegrees,
                releaseWristEuler);
        }
    }

    public static class ProductionBatterFootworkAdapter
    {
        public static ProductionBatterFootwork FromHostIntent(string value)
        {
            switch (value)
            {
                case "forward": return ProductionBatterFootwork.Forward;
                case "back": return ProductionBatterFootwork.Back;
                case "across": return ProductionBatterFootwork.Across;
                case "down_track": return ProductionBatterFootwork.DownTrack;
                case "auto":
                case null:
                case "":
                    return ProductionBatterFootwork.Balanced;
                default:
                    throw new ArgumentException("A supported host swing footwork intent is required.", nameof(value));
            }
        }
    }

    /// <summary>
    /// A compact humanoid hierarchy based on the useful proportions of the retained Three.js character rig.
    /// Character left is positive local X and forward is positive local Z.
    /// </summary>
    public enum ProductionCharacterJoint
    {
        Hips,
        Spine,
        Chest,
        Neck,
        Head,
        UpperArmLeft,
        ForearmLeft,
        HandLeft,
        UpperArmRight,
        ForearmRight,
        HandRight,
        ThighLeft,
        ShinLeft,
        FootLeft,
        ThighRight,
        ShinRight,
        FootRight,
        Count
    }

    /// <summary>
    /// Original, sponsor-free colours. A palette owns no Unity objects and can be reused freely.
    /// </summary>
    [Serializable]
    public struct ProductionCharacterPalette
    {
        public Color Skin;
        public Color SkinShade;
        public Color Hair;
        public Color Iris;
        public Color KitPrimary;
        public Color KitSecondary;
        public Color Trousers;
        public Color Helmet;
        public Color Pad;
        public Color Glove;
        public Color Shoe;
        public Color Sole;
        public Color Metal;

        public static ProductionCharacterPalette OriginalNightKit()
        {
            return new ProductionCharacterPalette
            {
                Skin = new Color(0.54f, 0.32f, 0.20f),
                SkinShade = new Color(0.36f, 0.19f, 0.12f),
                Hair = new Color(0.055f, 0.043f, 0.038f),
                Iris = new Color(0.16f, 0.09f, 0.045f),
                KitPrimary = new Color(0.055f, 0.19f, 0.34f),
                KitSecondary = new Color(0.93f, 0.52f, 0.12f),
                Trousers = new Color(0.035f, 0.11f, 0.20f),
                // A rear-shoulder camera sees the helmet's occipital shell for most of a delivery.  Preserve the
                // night-kit navy while lifting it far enough above the trousers to retain the nape, ear-guard and
                // crown silhouette after mobile/WebGL tone mapping.
                Helmet = new Color(0.035f, 0.106f, 0.188f),
                Pad = new Color(0.90f, 0.89f, 0.83f),
                // Warm off-white preserves protective-equipment identity without clipping the finger-channel
                // shading into the single white mass seen in the locked gameplay capture.
                Glove = new Color(0.84f, 0.82f, 0.76f),
                Shoe = new Color(0.11f, 0.12f, 0.13f),
                Sole = new Color(0.76f, 0.78f, 0.77f),
                // The live grille is only a few pixels wide in the locked rear-shoulder view. A neutral
                // equipment-steel value keeps the cage continuous against the navy shell without making it
                // emissive, chrome-like or brighter than the white ball.
                Metal = new Color(0.62f, 0.66f, 0.69f)
            };
        }

        public static ProductionCharacterPalette OriginalOfficialKit()
        {
            var value = OriginalNightKit();
            value.KitPrimary = new Color(0.10f, 0.13f, 0.18f);
            value.KitSecondary = new Color(0.75f, 0.78f, 0.80f);
            value.Trousers = new Color(0.12f, 0.13f, 0.15f);
            return value;
        }
    }

    [Serializable]
    public sealed class ProductionCharacterSpec
    {
        public ProductionCharacterRole Role = ProductionCharacterRole.Fielder;
        public ProductionCharacterDetail Detail = ProductionCharacterDetail.Medium;
        public ProductionCharacterHandedness Handedness = ProductionCharacterHandedness.Right;
        public float HeightMetres = 1.78f;
        public bool CastShadows = true;
        public bool KeeperStandingUpToStumps;
        public ProductionCharacterPalette Palette = ProductionCharacterPalette.OriginalNightKit();

        public void Validate()
        {
            if (!Enum.IsDefined(typeof(ProductionCharacterRole), Role))
                throw new ArgumentOutOfRangeException(nameof(Role));
            if (!Enum.IsDefined(typeof(ProductionCharacterDetail), Detail))
                throw new ArgumentOutOfRangeException(nameof(Detail));
            if (!Enum.IsDefined(typeof(ProductionCharacterHandedness), Handedness))
                throw new ArgumentOutOfRangeException(nameof(Handedness));
            if (float.IsNaN(HeightMetres) || float.IsInfinity(HeightMetres) ||
                HeightMetres < 1.52f || HeightMetres > 2.08f)
                throw new ArgumentOutOfRangeException(nameof(HeightMetres),
                    "A production character must use a credible adult cricket height.");
        }

        public static ProductionCharacterSpec For(ProductionCharacterRole role,
            ProductionCharacterDetail detail = ProductionCharacterDetail.Medium)
        {
            return new ProductionCharacterSpec
            {
                Role = role,
                Detail = detail,
                Palette = role == ProductionCharacterRole.Umpire
                    ? ProductionCharacterPalette.OriginalOfficialKit()
                    : ProductionCharacterPalette.OriginalNightKit()
            };
        }
    }

    /// <summary>
    /// Reusable pose storage. Sampling and applying this object performs no managed allocation.
    /// </summary>
    public sealed class ProductionCharacterPose
    {
        internal readonly Quaternion[] Rotations =
            new Quaternion[(int)ProductionCharacterJoint.Count];

        public Vector3 RootOffset { get; internal set; }
        public Quaternion BatRotation { get; internal set; }

        public ProductionCharacterPose()
        {
            Clear();
        }

        public Quaternion Rotation(ProductionCharacterJoint joint)
        {
            var index = (int)joint;
            if (index < 0 || index >= (int)ProductionCharacterJoint.Count)
                throw new ArgumentOutOfRangeException(nameof(joint));
            return Rotations[index];
        }

        internal void Clear()
        {
            RootOffset = Vector3.zero;
            BatRotation = Quaternion.identity;
            for (var index = 0; index < Rotations.Length; index++)
                Rotations[index] = Quaternion.identity;
        }
    }
}
