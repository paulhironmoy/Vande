using System;
using UnityEngine;
using UnityEngine.Audio;

namespace Vande.Practice.Audio.Production
{
    /// <summary>
    /// Stable mix destinations. Physical/crowd voice allocation remains a
    /// separate concern; these buses only route an already-authoritative cue.
    /// </summary>
    public enum ProductionFeedbackMixerBus
    {
        None = 0,
        Ball,
        Bat,
        Field,
        Players,
        Crowd,
        Commentary,
        Interface,
        Count
    }

    /// <summary>
    /// Loads and resolves the optional production mixer once during Prepare.
    /// The live Handle path performs an array lookup only. An absent mixer or
    /// incomplete group topology deliberately returns null so AudioSource uses
    /// Unity's current direct output rather than dropping causal feedback.
    /// </summary>
    public sealed class ProductionFeedbackMixerRouting
    {
        public const string ResourcePath = "Audio/Production/VandePracticeFeedback";
        public const int RequiredChildGroupCount = 7;

        private readonly Func<string, AudioMixer> resourceLoader;
        private readonly AudioMixerGroup[] groups =
            new AudioMixerGroup[(int)ProductionFeedbackMixerBus.Count];
        private AudioMixer mixer;
        private AudioMixerGroup master;
        private bool configured;
        private int resolvedChildGroupCount;
        private int resourceSearchCount;

        public ProductionFeedbackMixerRouting()
            : this(LoadMixer)
        {
        }

        public ProductionFeedbackMixerRouting(Func<string, AudioMixer> resourceLoader)
        {
            this.resourceLoader = resourceLoader ?? throw new ArgumentNullException(nameof(resourceLoader));
        }

        public bool IsConfigured => configured;
        public bool AssetAvailable => mixer != null;
        public bool MasterGroupResolved => master != null;
        public bool HasCompleteTopology =>
            MasterGroupResolved && resolvedChildGroupCount == RequiredChildGroupCount;
        public int ResolvedChildGroupCount => resolvedChildGroupCount;
        public int ResourceSearchCount => resourceSearchCount;

        public void Configure()
        {
            if (configured) return;
            resourceSearchCount++;
            mixer = resourceLoader(ResourcePath);
            if (mixer != null)
            {
                master = FindExactGroup(mixer, "Master");
                for (var index = (int)ProductionFeedbackMixerBus.Ball;
                     index < (int)ProductionFeedbackMixerBus.Count;
                     index++)
                {
                    var bus = (ProductionFeedbackMixerBus)index;
                    var group = FindExactGroup(mixer, GroupName(bus));
                    groups[index] = group;
                    if (group != null) resolvedChildGroupCount++;
                }
            }
            configured = true;
        }

        public AudioMixerGroup GroupFor(ProductionFeedbackCue cue)
        {
            if (!configured) return null;
            return GroupFor(BusForCue(cue));
        }

        public AudioMixerGroup GroupFor(ProductionFeedbackMixerBus bus)
        {
            if (!configured || bus <= ProductionFeedbackMixerBus.None ||
                bus >= ProductionFeedbackMixerBus.Count)
                return null;
            return groups[(int)bus];
        }

        public void ReleasePreparedResources()
        {
            Array.Clear(groups, 0, groups.Length);
            mixer = null;
            master = null;
            resolvedChildGroupCount = 0;
            configured = false;
        }

        public static ProductionFeedbackMixerBus BusForCue(ProductionFeedbackCue cue)
        {
            switch (cue)
            {
                case ProductionFeedbackCue.Release:
                case ProductionFeedbackCue.Pitch:
                case ProductionFeedbackCue.BallGround:
                    return ProductionFeedbackMixerBus.Ball;

                case ProductionFeedbackCue.BatMiddle:
                case ProductionFeedbackCue.BatBlock:
                case ProductionFeedbackCue.Edge:
                case ProductionFeedbackCue.Nick:
                    return ProductionFeedbackMixerBus.Bat;

                case ProductionFeedbackCue.KeeperTake:
                case ProductionFeedbackCue.FieldPickup:
                case ProductionFeedbackCue.Catch:
                case ProductionFeedbackCue.Throw:
                case ProductionFeedbackCue.BoundaryFour:
                case ProductionFeedbackCue.StumpImpact:
                case ProductionFeedbackCue.BailFall:
                    return ProductionFeedbackMixerBus.Field;

                case ProductionFeedbackCue.Pad:
                case ProductionFeedbackCue.Miss:
                case ProductionFeedbackCue.Leave:
                case ProductionFeedbackCue.BoundarySix:
                case ProductionFeedbackCue.Run:
                case ProductionFeedbackCue.Lbw:
                    return ProductionFeedbackMixerBus.Players;

                case ProductionFeedbackCue.CrowdTension:
                case ProductionFeedbackCue.CrowdNearMiss:
                case ProductionFeedbackCue.CrowdRun:
                case ProductionFeedbackCue.CrowdBoundary:
                case ProductionFeedbackCue.CrowdSix:
                case ProductionFeedbackCue.CrowdWicket:
                case ProductionFeedbackCue.CrowdDot:
                    return ProductionFeedbackMixerBus.Crowd;

                default:
                    return ProductionFeedbackMixerBus.None;
            }
        }

        public static string GroupName(ProductionFeedbackMixerBus bus)
        {
            switch (bus)
            {
                case ProductionFeedbackMixerBus.Ball: return "Ball";
                case ProductionFeedbackMixerBus.Bat: return "Bat";
                case ProductionFeedbackMixerBus.Field: return "Field";
                case ProductionFeedbackMixerBus.Players: return "Players";
                case ProductionFeedbackMixerBus.Crowd: return "Crowd";
                case ProductionFeedbackMixerBus.Commentary: return "Commentary";
                case ProductionFeedbackMixerBus.Interface: return "Interface";
                default: return string.Empty;
            }
        }

        private static AudioMixer LoadMixer(string path)
        {
            return Resources.Load<AudioMixer>(path);
        }

        private static AudioMixerGroup FindExactGroup(AudioMixer value, string expectedName)
        {
            var matches = value.FindMatchingGroups(expectedName);
            AudioMixerGroup exact = null;
            for (var index = 0; index < matches.Length; index++)
            {
                var candidate = matches[index];
                if (candidate == null ||
                    !string.Equals(candidate.name, expectedName, StringComparison.Ordinal))
                    continue;
                if (exact != null) return null;
                exact = candidate;
            }
            return exact;
        }
    }
}
