using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.Audio;

namespace Vande.Practice.Audio.Production
{
    /// <summary>
    /// Causal Practice feedback prepared before the first live delivery.
    /// Authored clips are optional; absent assets use explicitly named
    /// synthesized fallbacks which are not represented as authentic recordings.
    ///
    /// Takes and timing follow the web sink (src/audio/practice.ts, recorded.ts, takes.ts):
    ///  - every sound's take is chosen from the delivery record (seed#over.ball|sound|occurrence), so the exact-ball
    ///    retry and its replay hear the same takes; uses are counted per delivery even while muted or paused;
    ///  - licensed recordings (ProductionRecordedManifest) play first; the synthesised voice is the fallback;
    ///  - physical sounds are scheduled on the DSP clock at the physics event's own time: the world hands each
    ///    upcoming trace event over ahead of its crossing frame (HandleAhead), and the onset of a contact take is
    ///    aligned (0.1 × peak, 3 ms pre-roll) to that time, compensated for the estimated output latency. Captions
    ///    and haptics stay on the crossing frame. An event that arrives late plays as soon as possible, never early.
    /// </summary>
    public sealed class ProductionPracticeFeedbackSink : MonoBehaviour, IPracticeFeedbackSink,
        IPracticeFeedbackLookahead, IPracticeFeedbackTakeContext
    {
        private const int PhysicalVoiceCount = 6;
        private const int CrowdVoiceCount = 3;
        private const float QuietCrowdGain = 0.42f;
        private const float DuckedCrowdGain = 0.18f;
        private const float CrowdDuckSeconds = 0.2f;
        /// <summary>A scheduled start is never earlier than this after the DSP clock (perfToCtx's 2 ms).</summary>
        public const double SoonestSeconds = 0.002;
        /// <summary>The synthesised reaction's rate varies by ±3 % from the delivery record (web parity).</summary>
        public const double CrowdSynthRateSpread = 0.03;
        private const int PendingCapacity = 16;
        private const int TimingLogCapacity = 64;
        private const double MaximumOutputLatencySeconds = 0.2;

        private readonly ProductionFeedbackClassifier classifier = new ProductionFeedbackClassifier();
        private readonly ProductionFeedbackVariantSelector variants = new ProductionFeedbackVariantSelector();
        private readonly ProductionFeedbackClipLibrary clips = new ProductionFeedbackClipLibrary();
        private readonly ProductionRecordedTakeBank recorded = new ProductionRecordedTakeBank();
        private readonly ProductionFeedbackMixerRouting mixerRouting =
            new ProductionFeedbackMixerRouting();
        private readonly ProductionFeedbackInstruction[] instructions =
            new ProductionFeedbackInstruction[ProductionFeedbackClassifier.RequiredInstructionCapacity];
        private readonly double[] lastScheduledAt =
            new double[(int)ProductionFeedbackCue.Count];
        private readonly Dictionary<string, int> uses = new Dictionary<string, int>(StringComparer.Ordinal);
        private readonly PendingEvent[] pending = CreatePending();
        private readonly ProductionScheduledSound[] timingLog = new ProductionScheduledSound[TimingLogCapacity];

        private ProductionFeedbackVoiceAllocator allocator;
        private AudioSource[] sources;
        private GameObject[] voiceObjects;
        private float[] baseGains;
        private IProductionHapticOutput hapticOutput = NullProductionHapticOutput.Instance;
        private IProductionCaptionOutput captionOutput = NullProductionCaptionOutput.Instance;
        private bool prepared;
        private bool audioEnabled;
        private bool hapticsEnabled;
        private bool captionsEnabled;
        private bool paused;
        private bool quiet;
        private double pauseStarted;
        private double duckUntil;
        private float currentCrowdGain = 1f;
        private int scheduledAudioCues;
        private int scheduledPhysicalAudioCues;
        private int scheduledCrowdAudioCues;
        private int emittedHaptics;
        private int emittedCaptions;
        private string takeKey = ProductionRecordedTakes.UnseededKey;
        private string pitchCondition = "balanced";
        private string contactTiming;
        private int timingLogCount;
        private int timingLogNext;
        private Func<double> dspClock;
        private Func<double> wallClock;
        private double? outputLatencyOverride;

        public bool IsPrepared => prepared;
        /// <summary>The delivery record's take key ("seed#over.ball"), as the web's deliveryTakeKey().</summary>
        public string TakeKey => takeKey;
        public bool RecordedSoundsEnabled => recorded.Enabled;
        public int LoadedRecordedTakeCount => recorded.LoadedTakeCount;
        public int FailedRecordedTakeCount => recorded.FailedTakeCount;
        public int PendingAheadCount
        {
            get
            {
                var count = 0;
                for (var index = 0; index < pending.Length; index++) if (pending[index].Active) count++;
                return count;
            }
        }

        /// <summary>
        /// Estimated device output latency (s): DSP buffer length × buffer count / output rate. The web's perfToCtx
        /// subtracts the AudioContext's base and output latency the same way. An estimate, not a device measurement.
        /// </summary>
        public double OutputLatencySeconds
        {
            get
            {
                if (outputLatencyOverride.HasValue) return outputLatencyOverride.Value;
                int length, buffers;
                AudioSettings.GetDSPBufferSize(out length, out buffers);
                var rate = AudioSettings.outputSampleRate;
                if (length <= 0 || rate <= 0) return 0.0;
                return Math.Min(MaximumOutputLatencySeconds, length * (double)Math.Max(1, buffers) / rate);
            }
        }

        /// <summary>
        /// How far ahead of an event's crossing frame the world must hand it over so its sound can be heard at the
        /// physics time: the output latency plus two 30 fps frames, bounded.
        /// </summary>
        public double LookaheadSeconds => Math.Max(0.1, Math.Min(0.3, OutputLatencySeconds + 0.067));

        /// <summary>Recorded takes on or off (the owner's A/B; the synthesised voices play while off).</summary>
        public void SetRecordedSounds(bool value)
        {
            recorded.Enabled = value;
        }

        /// <summary>
        /// A new delivery (the web's `approach` plus context()): its record identity keys every take choice and the
        /// per-sound use counts restart. The same record (the exact-ball retry, or a replay of it) gives the same key.
        /// </summary>
        public void BeginTakeDelivery(string seed, int overIndex, int ballIndex, string pitch)
        {
            takeKey = ProductionRecordedTakes.DeliveryTakeKey(seed, overIndex, ballIndex);
            if (!string.IsNullOrEmpty(pitch)) pitchCondition = pitch;
            contactTiming = null;
            uses.Clear();
            ClearPending();
        }

        /// <summary>The authoritative contact timing (perfect, solid, mistimed …): picks the middled sound.</summary>
        public void SetContactTiming(string timing)
        {
            contactTiming = timing;
        }

        internal void SetClocksForTesting(Func<double> dsp, double? outputLatency, Func<double> wall = null)
        {
            dspClock = dsp;
            wallClock = wall;
            outputLatencyOverride = outputLatency;
        }

        internal int ScheduledSoundCount => timingLogCount;

        /// <summary>The n-th most recent scheduled sound (0 = the latest).</summary>
        internal ProductionScheduledSound RecentScheduledSound(int fromLatest)
        {
            if (fromLatest < 0 || fromLatest >= timingLogCount) throw new ArgumentOutOfRangeException(nameof(fromLatest));
            var index = (timingLogNext - 1 - fromLatest + TimingLogCapacity * 2) % TimingLogCapacity;
            return timingLog[index];
        }
        public bool AudioEnabled => audioEnabled;
        public bool HapticsEnabled => hapticsEnabled;
        public bool CaptionsEnabled => captionsEnabled;
        public bool IsQuiet => quiet;
        public bool IsPaused => paused;
        public float CurrentCrowdGain => currentCrowdGain;
        public int ScheduledAudioCueCount => scheduledAudioCues;
        public int ScheduledPhysicalAudioCueCount => scheduledPhysicalAudioCues;
        public int ScheduledCrowdAudioCueCount => scheduledCrowdAudioCues;
        public int EmittedHapticCount => emittedHaptics;
        public int EmittedCaptionCount => emittedCaptions;
        public int PreparedVoiceCount => sources == null ? 0 : sources.Length;
        public int PreparedSynthesizedClipCount => clips.SynthesizedClipCount;
        public ProductionFeedbackAssetMode AssetMode => clips.AssetMode;
        public bool MixerRoutingPrepared => mixerRouting.IsConfigured;
        public bool MixerAssetAvailable => mixerRouting.AssetAvailable;
        public bool MixerTopologyComplete => mixerRouting.HasCompleteTopology;
        public int ResolvedMixerChildGroupCount => mixerRouting.ResolvedChildGroupCount;
        public int MixerResourceSearchCount => mixerRouting.ResourceSearchCount;

        /// <summary>
        /// Bind prepared, allocation-free platform/HUD outputs. Null restores
        /// the silent output for that modality without changing other toggles.
        /// </summary>
        public void SetOutputs(
            IProductionHapticOutput haptics,
            IProductionCaptionOutput captions)
        {
            hapticOutput = haptics ?? NullProductionHapticOutput.Instance;
            captionOutput = captions ?? NullProductionCaptionOutput.Instance;
        }

        public void Configure(bool enableAudio, bool enableHaptics, bool enableCaptions)
        {
            audioEnabled = enableAudio;
            hapticsEnabled = enableHaptics;
            captionsEnabled = enableCaptions;
            if (!prepared) Prepare();
            ApplyCrowdMix(Time.unscaledTimeAsDouble);
        }

        /// <summary>
        /// The runtime can provide provisional shot intent before contact so a
        /// defended middle uses the damped block signature. It never affects
        /// the authoritative result.
        /// </summary>
        public void SetShotIntent(string value)
        {
            classifier.SetShotIntent(value);
        }

        public void SetShotIntent(ProductionShotIntent value)
        {
            classifier.SetShotIntent(value);
        }

        /// <summary>
        /// Supplies already-validated host outcome facts for causal result
        /// presentation. No cue is emitted until its physical trace event.
        /// </summary>
        public void SetAuthoritativeOutcome(string shotIntent, string dismissal)
        {
            classifier.SetAuthoritativeOutcome(shotIntent, dismissal);
        }

        /// <summary>
        /// Quiet mode retains causal ball/bat/wicket feedback and reduces crowd
        /// prominence; it never suppresses accessibility captions.
        /// </summary>
        public void SetQuiet(bool value)
        {
            quiet = value;
            if (prepared) ApplyCrowdMix(Time.unscaledTimeAsDouble);
        }

        /// <summary>
        /// The event on its crossing frame. If the world already handed it over ahead (HandleAhead), its sound is
        /// already scheduled at the physics time and only its captions and haptics are emitted now. Otherwise it is
        /// classified now and its sound plays as soon as possible.
        /// </summary>
        public void Handle(PracticeFeedbackEvent feedback)
        {
            if (!prepared) return;
            var slot = FindPending(feedback);
            if (slot >= 0)
            {
                var entry = pending[slot];
                pending[slot] = default;
                for (var index = 0; index < entry.Count; index++)
                {
                    var instruction = entry.Instruction(index);
                    if (paused) continue;
                    EmitAccessible(instruction, feedback);
                    if (entry.AudioDeferred(index) && audioEnabled && instruction.Audible)
                        Schedule(instruction, feedback, entry.SoundKey(index), entry.Occurrence(index), 0.0);
                }
                return;
            }

            var count = classifier.Classify(feedback, instructions);
            for (var index = 0; index < count; index++)
            {
                var instruction = instructions[index];
                // Counted whether or not it is heard, so muting or a pause never shifts a later take.
                string soundKey = null;
                var occurrence = 0;
                if (instruction.Audible) occurrence = Use(instruction, feedback, out soundKey);
                if (paused) continue;
                EmitAccessible(instruction, feedback);
                if (audioEnabled && instruction.Audible)
                    Schedule(instruction, feedback, soundKey, occurrence, 0.0);
            }
        }

        /// <summary>
        /// The world hands over an event `leadSeconds` (wall seconds) before its physics time. It is classified now,
        /// in trace order, its sound is scheduled so its onset is heard at the physics time, and its captions and
        /// haptics wait for the crossing frame (Handle). Returns false when nothing was taken over.
        /// </summary>
        public bool HandleAhead(PracticeFeedbackEvent feedback, double leadSeconds)
        {
            if (!prepared || paused) return false;
            if (double.IsNaN(leadSeconds) || double.IsInfinity(leadSeconds))
                throw new ArgumentOutOfRangeException(nameof(leadSeconds));
            if (FindPending(feedback) >= 0) return true;
            var slot = FreePending();
            if (slot < 0) return false;

            var count = classifier.Classify(feedback, instructions);
            var entry = new PendingEvent(feedback.Kind, feedback.SimulationTime);
            for (var index = 0; index < count; index++)
            {
                var instruction = instructions[index];
                string soundKey = null;
                var occurrence = 0;
                if (instruction.Audible) occurrence = Use(instruction, feedback, out soundKey);
                var voice = -1;
                if (audioEnabled && instruction.Audible)
                    voice = Schedule(instruction, feedback, soundKey, occurrence, Math.Max(0.0, leadSeconds));
                entry.Add(instruction, soundKey, occurrence, voice);
            }
            pending[slot] = entry;
            return true;
        }

        private void EmitAccessible(ProductionFeedbackInstruction instruction, PracticeFeedbackEvent feedback)
        {
            if (captionsEnabled && instruction.Caption != ProductionCaptionId.None)
            {
                captionOutput.Present(new ProductionCaptionCue(
                    instruction.Caption,
                    ProductionCaptionText.For(instruction.Caption),
                    feedback.SimulationTime + instruction.DelaySeconds,
                    instruction.CrowdEmotion));
                emittedCaptions++;
            }

            if (hapticsEnabled && instruction.Haptic != ProductionHapticKind.None)
            {
                hapticOutput.Emit(new ProductionHapticCue(
                    instruction.Haptic,
                    instruction.HapticStrength,
                    feedback.SimulationTime + instruction.DelaySeconds));
                emittedHaptics++;
            }
        }

        private int Use(ProductionFeedbackInstruction instruction, PracticeFeedbackEvent feedback, out string soundKey)
        {
            soundKey = ProductionRecordedManifest.SoundKey(
                instruction.Cue, feedback.Contact, contactTiming, pitchCondition);
            int occurrence;
            uses.TryGetValue(soundKey, out occurrence);
            uses[soundKey] = occurrence + 1;
            return occurrence;
        }

        public void SetPaused(bool value)
        {
            if (!prepared || paused == value) return;
            var now = Time.unscaledTimeAsDouble;
            paused = value;
            if (value)
            {
                pauseStarted = now;
                DeferPendingAudio();
                for (var index = 0; index < sources.Length; index++) sources[index].Pause();
                hapticOutput.CancelAll();
                captionOutput.Clear();
            }
            else
            {
                var pauseDuration = Math.Max(0.0, now - pauseStarted);
                allocator.ShiftBusyTimes(pauseDuration);
                if (duckUntil > pauseStarted) duckUntil += pauseDuration;
                for (var index = 0; index < sources.Length; index++) sources[index].UnPause();
                ApplyCrowdMix(now);
            }
        }

        public void StopAll()
        {
            if (sources != null)
            {
                for (var index = 0; index < sources.Length; index++)
                {
                    sources[index].Stop();
                    sources[index].clip = null;
                    baseGains[index] = 0f;
                }
            }
            allocator?.Reset();
            variants.Reset();
            classifier.Reset();
            ClearPending();
            uses.Clear();
            for (var index = 0; index < lastScheduledAt.Length; index++)
                lastScheduledAt[index] = double.NegativeInfinity;
            paused = false;
            quiet = false;
            duckUntil = double.NegativeInfinity;
            currentCrowdGain = 1f;
            hapticOutput.CancelAll();
            captionOutput.Clear();
        }

        /// <summary>
        /// Explicit teardown for Unity-as-a-Library unload and EditMode tests.
        /// Configure may prepare a new fixed pool later if the surface reloads.
        /// </summary>
        public void ReleasePreparedResources()
        {
            if (!prepared) return;
            StopAll();
            clips.ReleasePreparedResources();
            recorded.ReleasePreparedResources();
            mixerRouting.ReleasePreparedResources();
            if (voiceObjects != null)
            {
                for (var index = 0; index < voiceObjects.Length; index++)
                {
                    var voice = voiceObjects[index];
                    if (voice == null) continue;
#if UNITY_EDITOR
                    if (!Application.isPlaying) DestroyImmediate(voice);
                    else Destroy(voice);
#else
                    Destroy(voice);
#endif
                }
            }
            sources = null;
            voiceObjects = null;
            baseGains = null;
            allocator = null;
            prepared = false;
        }

        private void Prepare()
        {
            clips.Configure();
            recorded.Configure();
            mixerRouting.Configure();
            allocator = new ProductionFeedbackVoiceAllocator(PhysicalVoiceCount, CrowdVoiceCount);
            sources = new AudioSource[allocator.VoiceCount];
            voiceObjects = new GameObject[allocator.VoiceCount];
            baseGains = new float[allocator.VoiceCount];
            for (var index = 0; index < allocator.VoiceCount; index++)
            {
                var voice = new GameObject(index < PhysicalVoiceCount
                    ? "VANDE Physical Feedback Voice " + (index + 1)
                    : "VANDE Crowd Feedback Voice " + (index - PhysicalVoiceCount + 1));
                voice.transform.SetParent(transform, false);
                var source = voice.AddComponent<AudioSource>();
                source.playOnAwake = false;
                source.loop = false;
                source.dopplerLevel = 0f;
                var physical = index < PhysicalVoiceCount;
                // Ball, bat and wicket cues carry canonical event positions.
                // Preserve enough direct signal for phone speakers while making
                // pitch location and the restrained stadium tail perceptible.
                source.spatialBlend = physical ? 0.68f : 0f;
                source.reverbZoneMix = physical ? 0.36f : 0.18f;
                source.rolloffMode = AudioRolloffMode.Linear;
                source.minDistance = physical ? 0.65f : 1f;
                source.maxDistance = physical ? 82f : 55f;
                source.priority = physical ? 64 : 192;
                source.volume = 0f;
                sources[index] = source;
                voiceObjects[index] = voice;
            }
            for (var index = 0; index < lastScheduledAt.Length; index++)
                lastScheduledAt[index] = double.NegativeInfinity;
            duckUntil = double.NegativeInfinity;
            prepared = true;
        }

        /// <summary>
        /// Schedules one sound so its onset is heard `leadSeconds` after now (0: as soon as possible): a recorded take
        /// chosen from the delivery record when one is loaded, else the synthesised voice. Returns the voice used, or
        /// -1 when nothing was scheduled.
        /// </summary>
        private int Schedule(
            ProductionFeedbackInstruction instruction,
            PracticeFeedbackEvent feedback,
            string soundKey,
            int occurrence,
            double leadSeconds)
        {
            var cueIndex = (int)instruction.Cue;
            var now = wallClock != null ? wallClock() : Time.unscaledTimeAsDouble;
            if (now - lastScheduledAt[cueIndex] < MinimumRepeatSpacing(instruction.Cue)) return -1;
            if (soundKey == null)
                soundKey = ProductionRecordedManifest.SoundKey(instruction.Cue, feedback.Contact, contactTiming,
                    pitchCondition);

            AudioClip clip;
            double onset;
            double preroll;
            double rate;
            string detail;
            var take = recorded.Pick(soundKey, takeKey, occurrence);
            if (take != null)
            {
                clip = take.Clip;
                onset = take.OnsetSeconds;
                preroll = take.Kind.PrerollSeconds;
                rate = 1.0;
                detail = take.Take.Id;
            }
            else
            {
                var variantCount = clips.VariantCount(instruction.Cue);
                if (variantCount == 0) return -1;
                var variant = ProductionRecordedTakes.TakeIndex(takeKey, soundKey, occurrence, variantCount);
                if (!clips.TryGet(instruction.Cue, variant, out clip) || clip == null) return -1;
                // The synthesised voice starts on the event's time (its attack is the onset), as the web's sprite.
                onset = 0.0;
                preroll = 0.0;
                rate = instruction.Channel == ProductionFeedbackChannel.Crowd
                    ? 1.0 + CrowdSynthRateSpread *
                    (2.0 * ProductionRecordedTakes.TakeUnit(takeKey, soundKey, occurrence) - 1.0)
                    : 1.0;
                detail = null;
            }

            var dspNow = DspNow();
            var latency = OutputLatencySeconds;
            var intended = dspNow + leadSeconds + instruction.DelaySeconds - latency;
            var soonest = dspNow + SoonestSeconds;
            var when = intended < soonest ? soonest : intended;
            var aligned = ProductionRecordedTakes.AlignedStart(when, onset, preroll, dspNow, rate);
            var startOffsetSamples = (int)Math.Round(aligned.Offset * clip.frequency);
            if (startOffsetSamples >= clip.samples) return -1;
            if (startOffsetSamples < 0) startOffsetSamples = 0;

            var startsAtWall = now + (aligned.Start - dspNow);
            var duration = (clip.length - aligned.Offset) / Math.Max(0.1, rate) + 0.02;
            var voice = allocator.Reserve(
                instruction.Channel,
                instruction.Priority,
                startsAtWall,
                duration);
            if (voice < 0) return -1;

            var source = sources[voice];
            source.Stop();
            source.clip = clip;
            source.outputAudioMixerGroup = mixerRouting.GroupFor(instruction.Cue);
            source.pitch = (float)rate;
            source.priority = Mathf.Clamp(256 - instruction.Priority * 2, 0, 256);
            baseGains[voice] = instruction.Gain;
            if (instruction.Channel == ProductionFeedbackChannel.Physical && feedback.Position != null)
            {
                source.transform.localPosition = new Vector3(
                    (float)feedback.Position.x,
                    (float)feedback.Position.y,
                    (float)feedback.Position.z);
            }
            else
            {
                source.transform.localPosition = Vector3.zero;
            }

            if (instruction.DucksCrowd)
                duckUntil = Math.Max(duckUntil, startsAtWall + CrowdDuckSeconds);
            ApplyVoiceGain(voice, now);
            source.timeSamples = startOffsetSamples;
            source.PlayScheduled(aligned.Start);
            lastScheduledAt[cueIndex] = now;
            scheduledAudioCues++;
            if (instruction.Channel == ProductionFeedbackChannel.Physical)
                scheduledPhysicalAudioCues++;
            else
                scheduledCrowdAudioCues++;

            var heardOnset = aligned.Start + (onset - aligned.Offset) / rate;
            Log(new ProductionScheduledSound(
                instruction.Cue,
                soundKey,
                detail,
                occurrence,
                feedback.SimulationTime,
                dspNow,
                intended,
                aligned.Start,
                aligned.Offset,
                heardOnset,
                latency,
                rate,
                voice));
            return voice;
        }

        private double DspNow()
        {
            return dspClock != null ? dspClock() : AudioSettings.dspTime;
        }

        private void Log(ProductionScheduledSound value)
        {
            timingLog[timingLogNext] = value;
            timingLogNext = (timingLogNext + 1) % TimingLogCapacity;
            if (timingLogCount < TimingLogCapacity) timingLogCount++;
        }

        private int FindPending(PracticeFeedbackEvent feedback)
        {
            for (var index = 0; index < pending.Length; index++)
            {
                if (pending[index].Active && pending[index].Kind == feedback.Kind &&
                    pending[index].Time.Equals(feedback.SimulationTime))
                    return index;
            }
            return -1;
        }

        private int FreePending()
        {
            for (var index = 0; index < pending.Length; index++) if (!pending[index].Active) return index;
            return -1;
        }

        private void ClearPending()
        {
            for (var index = 0; index < pending.Length; index++) pending[index] = default;
        }

        /// <summary>
        /// A pause before a pre-scheduled sound has started cancels it; the sound is then played on its crossing frame
        /// after the resume, like any late event.
        /// </summary>
        private void DeferPendingAudio()
        {
            if (sources == null) return;
            var dspNow = DspNow();
            for (var index = 0; index < pending.Length; index++)
            {
                if (!pending[index].Active) continue;
                var entry = pending[index];
                for (var instruction = 0; instruction < entry.Count; instruction++)
                {
                    var voice = entry.Voice(instruction);
                    if (voice < 0) continue;
                    var started = false;
                    for (var log = 0; log < timingLogCount; log++)
                    {
                        var sound = RecentScheduledSound(log);
                        if (sound.Voice == voice && sound.SimulationTime.Equals(entry.Time))
                        {
                            started = sound.StartDsp <= dspNow;
                            break;
                        }
                    }
                    if (started) continue;
                    sources[voice].Stop();
                    entry.DeferAudio(instruction);
                }
                pending[index] = entry;
            }
        }

        private static PendingEvent[] CreatePending()
        {
            return new PendingEvent[PendingCapacity];
        }

        /// <summary>One event classified ahead of its crossing frame, waiting to emit captions and haptics.</summary>
        private struct PendingEvent
        {
            private ProductionFeedbackInstruction i0, i1, i2, i3;
            private string k0, k1, k2, k3;
            private int o0, o1, o2, o3;
            private int v0, v1, v2, v3;
            private int deferred;

            public PendingEvent(PracticeFeedbackKind kind, double time)
            {
                Active = true;
                Kind = kind;
                Time = time;
                Count = 0;
                i0 = i1 = i2 = i3 = default;
                k0 = k1 = k2 = k3 = null;
                o0 = o1 = o2 = o3 = 0;
                v0 = v1 = v2 = v3 = -1;
                deferred = 0;
            }

            public bool Active { get; }
            public PracticeFeedbackKind Kind { get; }
            public double Time { get; }
            public int Count { get; private set; }

            public void Add(ProductionFeedbackInstruction instruction, string soundKey, int occurrence, int voice)
            {
                switch (Count)
                {
                    case 0: i0 = instruction; k0 = soundKey; o0 = occurrence; v0 = voice; break;
                    case 1: i1 = instruction; k1 = soundKey; o1 = occurrence; v1 = voice; break;
                    case 2: i2 = instruction; k2 = soundKey; o2 = occurrence; v2 = voice; break;
                    case 3: i3 = instruction; k3 = soundKey; o3 = occurrence; v3 = voice; break;
                    default: throw new InvalidOperationException("At most four instructions per event.");
                }
                Count++;
            }

            public ProductionFeedbackInstruction Instruction(int index)
            {
                return index == 0 ? i0 : index == 1 ? i1 : index == 2 ? i2 : i3;
            }

            public string SoundKey(int index) => index == 0 ? k0 : index == 1 ? k1 : index == 2 ? k2 : k3;
            public int Occurrence(int index) => index == 0 ? o0 : index == 1 ? o1 : index == 2 ? o2 : o3;
            public int Voice(int index) => index == 0 ? v0 : index == 1 ? v1 : index == 2 ? v2 : v3;
            public bool AudioDeferred(int index) => (deferred & (1 << index)) != 0;
            public void DeferAudio(int index) => deferred |= 1 << index;
        }

        private void ApplyCrowdMix(double now)
        {
            var quietGain = quiet ? QuietCrowdGain : 1f;
            var duckGain = now < duckUntil ? DuckedCrowdGain : 1f;
            currentCrowdGain = Mathf.Min(quietGain, duckGain);
            if (sources == null) return;
            for (var index = PhysicalVoiceCount; index < sources.Length; index++)
                sources[index].volume = baseGains[index] * currentCrowdGain;
        }

        private void ApplyVoiceGain(int voice, double now)
        {
            if (voice < PhysicalVoiceCount)
                sources[voice].volume = baseGains[voice];
            else
            {
                ApplyCrowdMix(now);
                sources[voice].volume = baseGains[voice] * currentCrowdGain;
            }
        }

        private static double MinimumRepeatSpacing(ProductionFeedbackCue cue)
        {
            switch (cue)
            {
                case ProductionFeedbackCue.CrowdTension:
                case ProductionFeedbackCue.CrowdNearMiss:
                case ProductionFeedbackCue.CrowdRun:
                case ProductionFeedbackCue.CrowdDot:
                    return 0.12;
                case ProductionFeedbackCue.BallGround:
                    return 0.035;
                default:
                    return 0.0;
            }
        }

        private void Update()
        {
            if (prepared && audioEnabled && !paused)
                ApplyCrowdMix(Time.unscaledTimeAsDouble);
        }

        private void OnDestroy()
        {
            ReleasePreparedResources();
        }
    }
}
