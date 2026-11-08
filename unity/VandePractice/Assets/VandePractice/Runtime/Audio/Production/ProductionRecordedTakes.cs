using System;
using System.Globalization;

namespace Vande.Practice.Audio.Production
{
    /// <summary>
    /// The C# port of src/audio/takes.ts (the pure part of the web's recorded takes). It must stay identical to the
    /// TypeScript, so the same delivery record picks the same take on every renderer:
    ///
    ///   DeliveryTakeKey  the record's identity: its seed and its over and ball index (stable on the exact-ball retry)
    ///   TakeIndex        FNV-1a 32 of "{deliveryKey}|{sound}|{occurrence}", modulo the takes
    ///   TakeUnit         the same hash as a number in [0, 1) (a deterministic variation, e.g. a reaction's rate)
    ///   FindOnset        the transient's first sample: the first |x| at or above OnsetRatio of the buffer's peak
    ///   AlignedStart     where to start a buffer so its onset is heard exactly at `when` (and as close as possible
    ///                    when that start is already past)
    ///
    /// Nothing here reads a clock or a random source. The player's own contact decides which kind of sound plays; the
    /// take within the kind follows the ball. Parity is pinned by ProductionRecordedTakesTests against vectors
    /// generated from the TypeScript (tests/unit/audio/recorded.test.ts carries the same FNV-1a vectors).
    /// </summary>
    public static class ProductionRecordedTakes
    {
        /// <summary>A transient starts at the first sample at or above this fraction of the peak (-20 dB).</summary>
        public const double OnsetRatio = 0.1;

        /// <summary>Material kept before a contact take's onset (s); the web's prerollMs 3.</summary>
        public const double ContactPrerollSeconds = 0.003;

        public const string UnseededKey = "unseeded";

        private const uint FnvOffset = 0x811c9dc5u;
        private const uint FnvPrime = 0x01000193u;

        /// <summary>
        /// The key every take choice of one delivery hashes: "{seed}#{over}.{ball}", identical for the exact-ball
        /// retry of the same record. A missing seed is "unseeded"; a missing index is "-" (deliveryTakeKey()).
        /// </summary>
        public static string DeliveryTakeKey(string seed, int? overIndex, int? ballIndex)
        {
            if (string.IsNullOrEmpty(seed)) return UnseededKey;
            var over = overIndex.HasValue ? overIndex.Value.ToString(CultureInfo.InvariantCulture) : "-";
            var ball = ballIndex.HasValue ? ballIndex.Value.ToString(CultureInfo.InvariantCulture) : "-";
            return seed + "#" + over + "." + ball;
        }

        /// <summary>FNV-1a, 32 bits, over the UTF-16 code units of the string (JavaScript's charCodeAt).</summary>
        public static uint Fnv1a32(string value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            var hash = FnvOffset;
            unchecked
            {
                for (var index = 0; index < value.Length; index++)
                {
                    hash ^= value[index];
                    hash *= FnvPrime;
                }
            }
            return hash;
        }

        /// <summary>The take (0 … count − 1) for the occurrence-th use of `sound` in the delivery `deliveryKey`.</summary>
        public static int TakeIndex(string deliveryKey, string sound, int occurrence, int count)
        {
            if (count <= 1) return 0;
            return (int)(Fnv1a32(Compose(deliveryKey, sound, occurrence)) % (uint)count);
        }

        /// <summary>A deterministic number in [0, 1) for the same inputs.</summary>
        public static double TakeUnit(string deliveryKey, string sound, int occurrence)
        {
            return Fnv1a32(Compose(deliveryKey, sound, occurrence) + "|u") / 4294967296.0;
        }

        /// <summary>The index of the first sample whose magnitude reaches `ratio` of the peak (0 for silence).</summary>
        public static int FindOnset(float[] data, double ratio = OnsetRatio)
        {
            if (data == null) throw new ArgumentNullException(nameof(data));
            return FindOnset(data, data.Length, 1, 0, ratio);
        }

        /// <summary>
        /// FindOnset over one channel of interleaved samples (channel `channel` of `channels`), `frames` frames long.
        /// </summary>
        public static int FindOnset(float[] interleaved, int frames, int channels, int channel, double ratio = OnsetRatio)
        {
            if (interleaved == null) throw new ArgumentNullException(nameof(interleaved));
            if (channels < 1 || channel < 0 || channel >= channels) throw new ArgumentOutOfRangeException(nameof(channel));
            if (frames < 0 || (long)frames * channels > interleaved.Length) throw new ArgumentOutOfRangeException(nameof(frames));
            double peak = 0.0;
            for (var frame = 0; frame < frames; frame++)
            {
                var magnitude = Math.Abs((double)interleaved[frame * channels + channel]);
                if (magnitude > peak) peak = magnitude;
            }
            if (peak <= 0.0) return 0;
            var threshold = peak * ratio;
            for (var frame = 0; frame < frames; frame++)
                if (Math.Abs((double)interleaved[frame * channels + channel]) >= threshold) return frame;
            return 0;
        }

        /// <summary>
        /// Start a buffer whose onset is at `onsetSeconds` (buffer seconds) so the onset is heard at clock time `when`,
        /// keeping up to `prerollSeconds` of the material before it. When that start is already past (`now`), the
        /// buffer starts now and skips ahead by the same amount, so the onset still lands at `when`.
        /// </summary>
        public static AlignedTakeStart AlignedStart(
            double when,
            double onsetSeconds,
            double prerollSeconds,
            double now,
            double rate = 1.0)
        {
            var r = rate > 0.0 ? rate : 1.0;
            var pre = Math.Max(0.0, Math.Min(onsetSeconds, prerollSeconds));
            var start = when - pre / r;
            var offset = onsetSeconds - pre;
            if (start < now)
            {
                offset += (now - start) * r;
                start = now;
            }
            return new AlignedTakeStart(start, offset);
        }

        private static string Compose(string deliveryKey, string sound, int occurrence)
        {
            if (deliveryKey == null) throw new ArgumentNullException(nameof(deliveryKey));
            if (sound == null) throw new ArgumentNullException(nameof(sound));
            return deliveryKey + "|" + sound + "|" + occurrence.ToString(CultureInfo.InvariantCulture);
        }
    }

    public readonly struct AlignedTakeStart
    {
        public AlignedTakeStart(double start, double offset)
        {
            Start = start;
            Offset = offset;
        }

        /// <summary>Clock time the buffer starts.</summary>
        public double Start { get; }

        /// <summary>Buffer seconds skipped at the start.</summary>
        public double Offset { get; }
    }
}

namespace Vande.Practice.Audio.Production
{
    /// <summary>
    /// One scheduled sound, for diagnostics and tests (the web's timing log): what played ("rec:{take}" or the
    /// synthesised voice), and when on the DSP clock its onset is heard against when the physics event asked for it.
    /// </summary>
    public readonly struct ProductionScheduledSound
    {
        public ProductionScheduledSound(
            ProductionFeedbackCue cue,
            string soundKey,
            string takeId,
            int occurrence,
            double simulationTime,
            double dspAtSchedule,
            double intendedOnsetDsp,
            double startDsp,
            double offsetSeconds,
            double heardOnsetDsp,
            double outputLatencySeconds,
            double rate,
            int voice)
        {
            Cue = cue;
            SoundKey = soundKey;
            TakeId = takeId;
            Occurrence = occurrence;
            SimulationTime = simulationTime;
            DspAtSchedule = dspAtSchedule;
            IntendedOnsetDsp = intendedOnsetDsp;
            StartDsp = startDsp;
            OffsetSeconds = offsetSeconds;
            HeardOnsetDsp = heardOnsetDsp;
            OutputLatencySeconds = outputLatencySeconds;
            Rate = rate;
            Voice = voice;
        }

        public ProductionFeedbackCue Cue { get; }
        public string SoundKey { get; }
        /// <summary>The recorded take's id, or null when the synthesised voice played.</summary>
        public string TakeId { get; }
        public string Detail => TakeId == null ? "synth" : "rec:" + TakeId;
        public int Occurrence { get; }
        public double SimulationTime { get; }
        public double DspAtSchedule { get; }
        /// <summary>The DSP time the physics event asked for (already compensated for output latency).</summary>
        public double IntendedOnsetDsp { get; }
        public double StartDsp { get; }
        public double OffsetSeconds { get; }
        /// <summary>The DSP time the onset is rendered; heard OutputLatencySeconds later.</summary>
        public double HeardOnsetDsp { get; }
        /// <summary>How late the onset is against the physics event (s); 0 when scheduled ahead.</summary>
        public double LateSeconds => Math.Max(0.0, HeardOnsetDsp - IntendedOnsetDsp);
        public double OutputLatencySeconds { get; }
        public double Rate { get; }
        public int Voice { get; }
    }
}
