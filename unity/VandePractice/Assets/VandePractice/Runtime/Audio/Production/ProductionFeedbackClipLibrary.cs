using System;
using System.Collections.Generic;
using UnityEngine;

namespace Vande.Practice.Audio.Production
{
    /// <summary>
    /// Loads already-approved VANDE recordings once from Resources/Audio/Production.
    /// Every accepted clip name must be vande_{cue-token}_{variant}. This class
    /// never downloads or sources recordings and does not establish provenance;
    /// an authored file is eligible only after the repository asset register has
    /// recorded its source and licence.
    ///
    /// Missing cues receive clearly named runtime-synthesized fallbacks. Those
    /// fallbacks are causal engineering audio, never authentic match recordings.
    /// </summary>
    public sealed class ProductionFeedbackClipLibrary
    {
        public const string ResourceFolder = "Audio/Production";
        private const int SampleRate = 24_000;

        private readonly List<AudioClip>[] variants =
            new List<AudioClip>[(int)ProductionFeedbackCue.Count];
        private readonly List<AudioClip> synthesized = new List<AudioClip>();
        private bool configured;
        private int authoredCount;

        public bool IsConfigured => configured;
        public int AuthoredClipCount => authoredCount;
        public int SynthesizedClipCount => synthesized.Count;

        public ProductionFeedbackAssetMode AssetMode
        {
            get
            {
                if (authoredCount > 0 && synthesized.Count > 0) return ProductionFeedbackAssetMode.Mixed;
                if (authoredCount > 0) return ProductionFeedbackAssetMode.AuthoredResources;
                if (synthesized.Count > 0) return ProductionFeedbackAssetMode.SynthesizedFallback;
                return ProductionFeedbackAssetMode.None;
            }
        }

        public void Configure()
        {
            if (configured) return;
            for (var index = 0; index < variants.Length; index++)
                variants[index] = new List<AudioClip>(2);

            var loaded = Resources.LoadAll<AudioClip>(ResourceFolder);
            Array.Sort(loaded, CompareClips);
            for (var index = 0; index < loaded.Length; index++)
            {
                var clip = loaded[index];
                if (clip == null) continue;
                var cue = CueFromApprovedName(clip.name);
                if (cue == ProductionFeedbackCue.None) continue;
                variants[(int)cue].Add(clip);
                authoredCount++;
            }

            for (var index = (int)ProductionFeedbackCue.Release;
                 index < (int)ProductionFeedbackCue.Count;
                 index++)
            {
                var cue = (ProductionFeedbackCue)index;
                if (!HasAudibleFallback(cue) || variants[index].Count > 0) continue;
                var clip = Synthesize(cue);
                variants[index].Add(clip);
                synthesized.Add(clip);
            }
            configured = true;
        }

        public int VariantCount(ProductionFeedbackCue cue)
        {
            EnsureConfigured();
            if (cue <= ProductionFeedbackCue.None || cue >= ProductionFeedbackCue.Count) return 0;
            return variants[(int)cue].Count;
        }

        public bool TryGet(ProductionFeedbackCue cue, int variantIndex, out AudioClip clip)
        {
            EnsureConfigured();
            clip = null;
            if (cue <= ProductionFeedbackCue.None || cue >= ProductionFeedbackCue.Count) return false;
            var values = variants[(int)cue];
            if (values.Count == 0) return false;
            if (variantIndex < 0) variantIndex = 0;
            clip = values[variantIndex % values.Count];
            return clip != null;
        }

        public void ReleasePreparedResources()
        {
            if (!configured) return;
            for (var index = 0; index < synthesized.Count; index++)
            {
                var clip = synthesized[index];
                if (clip == null) continue;
#if UNITY_EDITOR
                if (!Application.isPlaying) UnityEngine.Object.DestroyImmediate(clip);
                else UnityEngine.Object.Destroy(clip);
#else
                UnityEngine.Object.Destroy(clip);
#endif
            }
            synthesized.Clear();
            for (var index = 0; index < variants.Length; index++)
                variants[index]?.Clear();
            authoredCount = 0;
            configured = false;
        }

        public static string CueToken(ProductionFeedbackCue cue)
        {
            switch (cue)
            {
                case ProductionFeedbackCue.Release: return "release";
                case ProductionFeedbackCue.Pitch: return "pitch";
                case ProductionFeedbackCue.BallGround: return "ball_ground";
                case ProductionFeedbackCue.BatMiddle: return "bat_middle";
                case ProductionFeedbackCue.BatBlock: return "bat_block";
                case ProductionFeedbackCue.Edge: return "edge";
                case ProductionFeedbackCue.Nick: return "nick";
                case ProductionFeedbackCue.Pad: return "pad";
                case ProductionFeedbackCue.KeeperTake: return "keeper_take";
                case ProductionFeedbackCue.FieldPickup: return "field_pickup";
                case ProductionFeedbackCue.Catch: return "catch";
                case ProductionFeedbackCue.Throw: return "throw";
                case ProductionFeedbackCue.BoundaryFour: return "boundary_four";
                case ProductionFeedbackCue.StumpImpact: return "stump_impact";
                case ProductionFeedbackCue.BailFall: return "bail_fall";
                case ProductionFeedbackCue.CrowdTension: return "crowd_tension";
                case ProductionFeedbackCue.CrowdNearMiss: return "crowd_near_miss";
                case ProductionFeedbackCue.CrowdRun: return "crowd_run";
                case ProductionFeedbackCue.CrowdBoundary: return "crowd_boundary";
                case ProductionFeedbackCue.CrowdSix: return "crowd_six";
                case ProductionFeedbackCue.CrowdWicket: return "crowd_wicket";
                case ProductionFeedbackCue.CrowdDot: return "crowd_dot";
                default: return string.Empty;
            }
        }

        private void EnsureConfigured()
        {
            if (!configured) throw new InvalidOperationException("Production feedback clips are not prepared.");
        }

        private static int CompareClips(AudioClip left, AudioClip right)
        {
            if (ReferenceEquals(left, right)) return 0;
            if (left == null) return 1;
            if (right == null) return -1;
            return string.Compare(left.name, right.name, StringComparison.Ordinal);
        }

        private static ProductionFeedbackCue CueFromApprovedName(string name)
        {
            if (string.IsNullOrEmpty(name) || !name.StartsWith("vande_", StringComparison.Ordinal))
                return ProductionFeedbackCue.None;

            for (var index = (int)ProductionFeedbackCue.Release;
                 index < (int)ProductionFeedbackCue.Count;
                 index++)
            {
                var cue = (ProductionFeedbackCue)index;
                var token = CueToken(cue);
                if (token.Length == 0) continue;
                var prefix = "vande_" + token + "_";
                if (name.StartsWith(prefix, StringComparison.Ordinal)) return cue;
            }
            return ProductionFeedbackCue.None;
        }

        private static bool HasAudibleFallback(ProductionFeedbackCue cue)
        {
            switch (cue)
            {
                case ProductionFeedbackCue.Miss:
                case ProductionFeedbackCue.Leave:
                case ProductionFeedbackCue.Lbw:
                case ProductionFeedbackCue.BoundarySix:
                case ProductionFeedbackCue.Run:
                case ProductionFeedbackCue.None:
                case ProductionFeedbackCue.Count:
                    return false;
                default:
                    return true;
            }
        }

        private static AudioClip Synthesize(ProductionFeedbackCue cue)
        {
            var shape = ShapeFor(cue);
            var length = Math.Max(1, (int)Math.Round(shape.Duration * SampleRate));
            var samples = new float[length];
            var noise = unchecked(0x51f15e5du + (uint)cue * 2654435761u);
            for (var index = 0; index < length; index++)
            {
                var t = index / (double)SampleRate;
                noise = noise * 1664525u + 1013904223u;
                var white = ((noise >> 8) / 16777215.0) * 2.0 - 1.0;
                var tone = Math.Sin(Math.PI * 2.0 * shape.PrimaryHz * t) * 0.68 +
                           Math.Sin(Math.PI * 2.0 * shape.SecondaryHz * t) * 0.32;
                var attack = Math.Min(1.0, t / Math.Max(0.001, shape.Attack));
                var decay = Math.Exp(-t / Math.Max(0.008, shape.Decay));
                var body = tone * (1.0 - shape.NoiseMix) + white * shape.NoiseMix;
                samples[index] = (float)(Math.Tanh(body * 1.55) * attack * decay * shape.Gain);
            }

            var clip = AudioClip.Create(
                "VANDE SYNTHESIZED FALLBACK - " + CueToken(cue),
                length,
                1,
                SampleRate,
                false);
            clip.SetData(samples, 0);
            Array.Clear(samples, 0, samples.Length);
            return clip;
        }

        private static SynthesisShape ShapeFor(ProductionFeedbackCue cue)
        {
            switch (cue)
            {
                case ProductionFeedbackCue.Release: return Shape(0.09, 620, 91, 0.72, 0.004, 0.027, 0.42);
                case ProductionFeedbackCue.Pitch: return Shape(0.085, 142, 37, 0.8, 0.001, 0.022, 0.72);
                case ProductionFeedbackCue.BallGround: return Shape(0.06, 98, 31, 0.84, 0.001, 0.018, 0.4);
                case ProductionFeedbackCue.BatMiddle: return Shape(0.085, 910, 205, 0.26, 0.001, 0.025, 0.88);
                case ProductionFeedbackCue.BatBlock: return Shape(0.11, 136, 57, 0.68, 0.001, 0.034, 0.65);
                case ProductionFeedbackCue.Edge: return Shape(0.06, 2250, 610, 0.2, 0.001, 0.018, 0.68);
                case ProductionFeedbackCue.Nick: return Shape(0.045, 3120, 740, 0.17, 0.001, 0.013, 0.58);
                case ProductionFeedbackCue.Pad: return Shape(0.12, 109, 24, 0.9, 0.001, 0.035, 0.68);
                case ProductionFeedbackCue.KeeperTake: return Shape(0.1, 176, 51, 0.83, 0.001, 0.03, 0.61);
                case ProductionFeedbackCue.FieldPickup: return Shape(0.09, 146, 43, 0.86, 0.001, 0.027, 0.54);
                case ProductionFeedbackCue.Catch: return Shape(0.12, 184, 58, 0.78, 0.001, 0.036, 0.74);
                case ProductionFeedbackCue.Throw: return Shape(0.08, 510, 72, 0.74, 0.003, 0.025, 0.48);
                case ProductionFeedbackCue.BoundaryFour: return Shape(0.15, 116, 34, 0.9, 0.001, 0.05, 0.54);
                case ProductionFeedbackCue.StumpImpact: return Shape(0.18, 1110, 485, 0.44, 0.001, 0.052, 0.86);
                case ProductionFeedbackCue.BailFall: return Shape(0.17, 1730, 720, 0.28, 0.001, 0.06, 0.55);
                case ProductionFeedbackCue.CrowdTension: return CrowdShape(0.34, 178, 0.69);
                case ProductionFeedbackCue.CrowdNearMiss: return CrowdShape(0.32, 143, 0.54);
                case ProductionFeedbackCue.CrowdRun: return CrowdShape(0.27, 207, 0.44);
                case ProductionFeedbackCue.CrowdBoundary: return CrowdShape(0.52, 246, 0.73);
                case ProductionFeedbackCue.CrowdSix: return CrowdShape(0.62, 286, 0.82);
                case ProductionFeedbackCue.CrowdWicket: return CrowdShape(0.58, 222, 0.78);
                case ProductionFeedbackCue.CrowdDot: return CrowdShape(0.22, 116, 0.34);
                default: return Shape(0.06, 180, 60, 0.75, 0.001, 0.02, 0.42);
            }
        }

        private static SynthesisShape CrowdShape(double duration, double primary, double gain)
        {
            return Shape(duration, primary, primary * 0.47, 0.82, 0.025, duration * 0.58, gain);
        }

        private static SynthesisShape Shape(
            double duration,
            double primary,
            double secondary,
            double noise,
            double attack,
            double decay,
            double gain)
        {
            return new SynthesisShape(duration, primary, secondary, noise, attack, decay, gain);
        }

        private readonly struct SynthesisShape
        {
            public SynthesisShape(
                double duration,
                double primaryHz,
                double secondaryHz,
                double noiseMix,
                double attack,
                double decay,
                double gain)
            {
                Duration = duration;
                PrimaryHz = primaryHz;
                SecondaryHz = secondaryHz;
                NoiseMix = noiseMix;
                Attack = attack;
                Decay = decay;
                Gain = gain;
            }

            public double Duration { get; }
            public double PrimaryHz { get; }
            public double SecondaryHz { get; }
            public double NoiseMix { get; }
            public double Attack { get; }
            public double Decay { get; }
            public double Gain { get; }
        }
    }
}
