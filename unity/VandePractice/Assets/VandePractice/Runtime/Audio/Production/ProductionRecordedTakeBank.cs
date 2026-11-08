using System;
using System.Collections.Generic;
using UnityEngine;

namespace Vande.Practice.Audio.Production
{
    /// <summary>One loaded take: its clip, its kind and its onset (clip seconds; 0 for start-aligned kinds).</summary>
    public sealed class ProductionLoadedTake
    {
        internal ProductionLoadedTake(ProductionRecordedTake take, ProductionRecordedKind kind, AudioClip clip,
            double onsetSeconds, bool onsetMeasured)
        {
            Take = take;
            Kind = kind;
            Clip = clip;
            OnsetSeconds = onsetSeconds;
            OnsetMeasured = onsetMeasured;
        }

        public ProductionRecordedTake Take { get; }
        public ProductionRecordedKind Kind { get; }
        public AudioClip Clip { get; }
        public double OnsetSeconds { get; }
        /// <summary>False where the platform cannot read decoded samples (WebGL): the onset is then the clip start.</summary>
        public bool OnsetMeasured { get; }
    }

    /// <summary>
    /// Unity's half of src/audio/recorded.ts: every registered take is loaded once, before the first delivery, from
    /// Resources/Audio/Cricket (the same files as the web's public/audio/cricket/, byte for byte). A kind is used only
    /// when every one of its takes has settled, so a choice never depends on how far loading got; a take that failed
    /// to load plays the synthesised voice instead, on every run alike. Contact takes are aligned on their own
    /// transient, found in the decoded clip (the first sample at 0.1 × peak), so the onset is heard at the physics
    /// contact time.
    /// </summary>
    public sealed class ProductionRecordedTakeBank
    {
        private readonly Dictionary<string, ProductionLoadedTake[]> loaded =
            new Dictionary<string, ProductionLoadedTake[]>(StringComparer.Ordinal);
        private bool configured;
        private int loadedTakes;
        private int failedTakes;

        public bool IsConfigured => configured;
        public bool Enabled { get; set; } = true;
        public int LoadedTakeCount => loadedTakes;
        public int FailedTakeCount => failedTakes;

        public void Configure()
        {
            if (configured) return;
            var kinds = ProductionRecordedManifest.Kinds;
            for (var index = 0; index < kinds.Count; index++)
            {
                var kind = kinds[index];
                if (kind.Takes.Count == 0) continue;
                var slots = new ProductionLoadedTake[kind.Takes.Count];
                for (var takeIndex = 0; takeIndex < slots.Length; takeIndex++)
                {
                    slots[takeIndex] = Load(kind, kind.Takes[takeIndex]);
                    if (slots[takeIndex] == null) failedTakes++;
                    else loadedTakes++;
                }
                loaded.Add(kind.Key, slots);
            }
            configured = true;
        }

        /// <summary>
        /// The take for the occurrence-th use of `soundKey` in the delivery `deliveryKey`; null when the synthesised
        /// voice plays instead (no takes, that take failed, or recordings are switched off). pickTake() in TypeScript.
        /// </summary>
        public ProductionLoadedTake Pick(string soundKey, string deliveryKey, int occurrence)
        {
            if (!configured || !Enabled || soundKey == null) return null;
            ProductionLoadedTake[] slots;
            if (!loaded.TryGetValue(soundKey, out slots) || slots.Length == 0) return null;
            return slots[ProductionRecordedTakes.TakeIndex(deliveryKey, soundKey, occurrence, slots.Length)];
        }

        /// <summary>Which kinds are ready, and how many of their takes loaded (diagnostics and tests).</summary>
        public int LoadedFor(string soundKey)
        {
            ProductionLoadedTake[] slots;
            if (!loaded.TryGetValue(soundKey, out slots)) return 0;
            var count = 0;
            for (var index = 0; index < slots.Length; index++) if (slots[index] != null) count++;
            return count;
        }

        public void ReleasePreparedResources()
        {
            // Resources clips are Unity-owned: unloaded by Unity, never destroyed here.
            loaded.Clear();
            loadedTakes = 0;
            failedTakes = 0;
            configured = false;
        }

        private static ProductionLoadedTake Load(ProductionRecordedKind kind, ProductionRecordedTake take)
        {
            var clip = Resources.Load<AudioClip>(ProductionRecordedManifest.ResourceFolder + "/" + take.Id);
            if (clip == null || clip.samples <= 0) return null;
            if (clip.loadState != AudioDataLoadState.Loaded) clip.LoadAudioData();
            if (kind.Align != ProductionRecordedAlign.Onset)
                return new ProductionLoadedTake(take, kind, clip, 0.0, true);

            var frames = clip.samples;
            var channels = Math.Max(1, clip.channels);
            var data = new float[frames * channels];
            bool read;
            try
            {
                read = clip.GetData(data, 0);
            }
            catch (Exception)
            {
                read = false;
            }
            if (!read) return new ProductionLoadedTake(take, kind, clip, 0.0, false);
            var onset = ProductionRecordedTakes.FindOnset(data, frames, channels, 0);
            return new ProductionLoadedTake(take, kind, clip, onset / (double)clip.frequency, true);
        }
    }
}
