using System;

namespace Vande.Practice.Audio.Production
{
    public readonly struct ProductionFeedbackVariant
    {
        public ProductionFeedbackVariant(int clipIndex, int pitchStep)
        {
            ClipIndex = clipIndex;
            PitchStep = pitchStep;
        }

        public int ClipIndex { get; }
        public int PitchStep { get; }
    }

    /// <summary>
    /// A deterministic non-random variant chooser. Repeated cues cannot select
    /// the same authored clip and pitch step twice in a row when alternatives
    /// exist.
    /// </summary>
    public sealed class ProductionFeedbackVariantSelector
    {
        private readonly int[] sequence = new int[(int)ProductionFeedbackCue.Count];
        private readonly int[] lastClip = new int[(int)ProductionFeedbackCue.Count];
        private readonly int[] lastPitch = new int[(int)ProductionFeedbackCue.Count];

        public ProductionFeedbackVariantSelector()
        {
            Reset();
        }

        public ProductionFeedbackVariant Select(
            ProductionFeedbackCue cue,
            int variantCount,
            double simulationTime)
        {
            if (cue <= ProductionFeedbackCue.None || cue >= ProductionFeedbackCue.Count)
                throw new ArgumentOutOfRangeException(nameof(cue));
            if (variantCount < 1) throw new ArgumentOutOfRangeException(nameof(variantCount));

            var index = (int)cue;
            var ordinal = sequence[index]++;
            var quantized = (int)Math.Round(simulationTime * 1000.0);
            var hash = StableHash(index, ordinal, quantized);
            var clip = Positive(hash) % variantCount;
            if (variantCount > 1 && clip == lastClip[index]) clip = (clip + 1) % variantCount;

            var pitch = Positive(hash / 7 + ordinal * 11 + index * 3) % 5 - 2;
            if (pitch == lastPitch[index]) pitch = pitch == 2 ? -2 : pitch + 1;
            lastClip[index] = clip;
            lastPitch[index] = pitch;
            return new ProductionFeedbackVariant(clip, pitch);
        }

        public void Reset()
        {
            Array.Clear(sequence, 0, sequence.Length);
            for (var index = 0; index < lastClip.Length; index++)
            {
                lastClip[index] = -1;
                lastPitch[index] = int.MinValue;
            }
        }

        private static int StableHash(int cue, int ordinal, int quantizedTime)
        {
            unchecked
            {
                var value = 17;
                value = value * 31 + cue;
                value = value * 31 + ordinal;
                value = value * 31 + quantizedTime;
                value ^= value << 13;
                value ^= value >> 17;
                value ^= value << 5;
                return value;
            }
        }

        private static int Positive(int value)
        {
            return value == int.MinValue ? int.MaxValue : Math.Abs(value);
        }
    }

    /// <summary>
    /// Bounded priority allocator. Crowd and physical pools are isolated so a
    /// celebration can never steal the contact/stump voice.
    /// </summary>
    public sealed class ProductionFeedbackVoiceAllocator
    {
        private readonly int physicalVoices;
        private readonly double[] busyUntil;
        private readonly int[] priorities;

        public ProductionFeedbackVoiceAllocator(int physicalVoiceCount, int crowdVoiceCount)
        {
            if (physicalVoiceCount < 1) throw new ArgumentOutOfRangeException(nameof(physicalVoiceCount));
            if (crowdVoiceCount < 1) throw new ArgumentOutOfRangeException(nameof(crowdVoiceCount));
            physicalVoices = physicalVoiceCount;
            busyUntil = new double[physicalVoiceCount + crowdVoiceCount];
            priorities = new int[busyUntil.Length];
            Reset();
        }

        public int VoiceCount => busyUntil.Length;
        public int PhysicalVoiceCount => physicalVoices;

        public int Reserve(
            ProductionFeedbackChannel channel,
            int priority,
            double startsAt,
            double durationSeconds)
        {
            if (priority < 0 || priority > 127) throw new ArgumentOutOfRangeException(nameof(priority));
            if (double.IsNaN(startsAt) || double.IsInfinity(startsAt))
                throw new ArgumentOutOfRangeException(nameof(startsAt));
            if (durationSeconds < 0.0 || double.IsNaN(durationSeconds) || double.IsInfinity(durationSeconds))
                throw new ArgumentOutOfRangeException(nameof(durationSeconds));

            var first = channel == ProductionFeedbackChannel.Physical ? 0 : physicalVoices;
            var end = channel == ProductionFeedbackChannel.Physical ? physicalVoices : busyUntil.Length;
            var available = -1;
            var candidate = -1;
            for (var index = first; index < end; index++)
            {
                if (busyUntil[index] <= startsAt)
                {
                    if (available < 0 || busyUntil[index] < busyUntil[available]) available = index;
                    continue;
                }

                if (candidate < 0 || priorities[index] < priorities[candidate] ||
                    priorities[index] == priorities[candidate] && busyUntil[index] > busyUntil[candidate])
                    candidate = index;
            }

            var selected = available;
            if (selected < 0 && candidate >= 0 && priority > priorities[candidate]) selected = candidate;
            if (selected < 0) return -1;

            priorities[selected] = priority;
            busyUntil[selected] = startsAt + durationSeconds;
            return selected;
        }

        public void ShiftBusyTimes(double seconds)
        {
            if (seconds <= 0.0) return;
            for (var index = 0; index < busyUntil.Length; index++)
                if (busyUntil[index] > double.NegativeInfinity) busyUntil[index] += seconds;
        }

        public void Reset()
        {
            for (var index = 0; index < busyUntil.Length; index++)
            {
                busyUntil[index] = double.NegativeInfinity;
                priorities[index] = 0;
            }
        }

        public double BusyUntil(int voice)
        {
            if (voice < 0 || voice >= busyUntil.Length) throw new ArgumentOutOfRangeException(nameof(voice));
            return busyUntil[voice];
        }

        public int Priority(int voice)
        {
            if (voice < 0 || voice >= priorities.Length) throw new ArgumentOutOfRangeException(nameof(voice));
            return priorities[voice];
        }
    }
}
