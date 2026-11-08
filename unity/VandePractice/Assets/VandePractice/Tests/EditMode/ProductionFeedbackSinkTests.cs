using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Audio.Production;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    public sealed class ProductionFeedbackSinkTests
    {
        private GameObject root;
        private ProductionPracticeFeedbackSink sink;
        private RecordingHaptics haptics;
        private RecordingCaptions captions;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("ProductionPracticeFeedbackSinkTests");
            sink = root.AddComponent<ProductionPracticeFeedbackSink>();
            haptics = new RecordingHaptics();
            captions = new RecordingCaptions();
            sink.SetOutputs(haptics, captions);
        }

        [TearDown]
        public void TearDown()
        {
            if (root != null) Object.DestroyImmediate(root);
        }

        [Test]
        public void Modalities_AreIndependentlyToggleable()
        {
            sink.Configure(false, true, true);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));

            Assert.That(sink.ScheduledAudioCueCount, Is.EqualTo(0));
            Assert.That(haptics.EmitCount, Is.EqualTo(1));
            Assert.That(captions.PresentCount, Is.EqualTo(1));

            sink.Configure(false, false, true);
            sink.Handle(Feedback(PracticeFeedbackKind.PitchBounce, 0.42));
            Assert.That(haptics.EmitCount, Is.EqualTo(1));
            Assert.That(captions.PresentCount, Is.EqualTo(2));

            sink.Configure(false, true, false);
            sink.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.7, "middle"));
            Assert.That(haptics.EmitCount, Is.EqualTo(2));
            Assert.That(captions.PresentCount, Is.EqualTo(2));

            sink.Configure(true, false, false);
            Assert.That(sink.AudioEnabled, Is.True);
            Assert.That(sink.HapticsEnabled, Is.False);
            Assert.That(sink.CaptionsEnabled, Is.False);
        }

        [Test]
        public void PausedEvents_UpdateCausalityButAreNeverReplayedOnResume()
        {
            sink.Configure(false, true, true);
            sink.SetPaused(true);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            Assert.That(haptics.EmitCount, Is.EqualTo(0));
            Assert.That(captions.PresentCount, Is.EqualTo(0));

            sink.SetPaused(false);
            sink.Handle(Feedback(PracticeFeedbackKind.PitchBounce, 0.44));
            Assert.That(haptics.EmitCount, Is.EqualTo(0), "pitch has no haptic");
            Assert.That(captions.PresentCount, Is.EqualTo(1));
            Assert.That(captions.Last.Id, Is.EqualTo(ProductionCaptionId.Pitch));
        }

        [Test]
        public void QuietMode_ReducesOnlyCrowdMixAndLeavesAccessibilityEnabled()
        {
            sink.Configure(false, true, true);
            sink.SetQuiet(true);

            Assert.That(sink.IsQuiet, Is.True);
            Assert.That(sink.CurrentCrowdGain, Is.LessThan(0.5f));
            Assert.That(sink.HapticsEnabled, Is.True);
            Assert.That(sink.CaptionsEnabled, Is.True);

            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            Assert.That(haptics.EmitCount, Is.EqualTo(1));
            Assert.That(captions.PresentCount, Is.EqualTo(1));
        }

        [Test]
        public void Configure_PreparesFixedPoolAndExplicitSynthesizedFallbackThenCleanupReleasesIt()
        {
            sink.Configure(false, false, false);

            Assert.That(sink.IsPrepared, Is.True);
            Assert.That(sink.PreparedVoiceCount, Is.EqualTo(9));
            Assert.That(sink.AssetMode, Is.Not.EqualTo(ProductionFeedbackAssetMode.None));
            Assert.That(sink.PreparedSynthesizedClipCount, Is.GreaterThan(0),
                "the repository currently has no approved recorded Practice clips");

            sink.ReleasePreparedResources();
            Assert.That(sink.IsPrepared, Is.False);
            Assert.That(sink.PreparedVoiceCount, Is.EqualTo(0));
            Assert.That(sink.PreparedSynthesizedClipCount, Is.EqualTo(0));
            Assert.That(sink.AssetMode, Is.EqualTo(ProductionFeedbackAssetMode.None));
        }

        [Test]
        public void PreparedVoices_KeepPhysicalEventsDirectionalAndCrowdBroad()
        {
            sink.Configure(false, false, false);

            var physical = root.transform.Find("VANDE Physical Feedback Voice 1")
                .GetComponent<AudioSource>();
            var crowd = root.transform.Find("VANDE Crowd Feedback Voice 1")
                .GetComponent<AudioSource>();
            Assert.That(physical.spatialBlend, Is.EqualTo(0.68f).Within(0.001f));
            Assert.That(physical.reverbZoneMix, Is.EqualTo(0.36f).Within(0.001f));
            Assert.That(physical.minDistance, Is.EqualTo(0.65f).Within(0.001f));
            Assert.That(physical.maxDistance, Is.GreaterThan(75f));
            Assert.That(crowd.spatialBlend, Is.Zero,
                "crowd is a broad bed and must not imply a false event location");
            Assert.That(crowd.reverbZoneMix, Is.LessThan(physical.reverbZoneMix));
        }

        [Test]
        public void MissingContactData_RemainsSilentAcrossEveryEnabledModality()
        {
            sink.Configure(false, true, true);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            var hapticBefore = haptics.EmitCount;
            var captionBefore = captions.PresentCount;

            sink.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.7, "unknown_contact"));
            Assert.That(haptics.EmitCount, Is.EqualTo(hapticBefore));
            Assert.That(captions.PresentCount, Is.EqualTo(captionBefore));
            Assert.That(sink.ScheduledAudioCueCount, Is.EqualTo(0));
        }

        [Test]
        public void AuthoritativeLbw_KeepsVerdictCaptionAndEmitsDecisiveHaptic()
        {
            sink.Configure(false, true, true);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            sink.SetAuthoritativeOutcome("defend", "lbw");
            sink.Handle(Feedback(PracticeFeedbackKind.Pad, 0.72));

            sink.Handle(Feedback(PracticeFeedbackKind.Dead, 1.2));

            Assert.That(captions.Last.Id, Is.EqualTo(ProductionCaptionId.Lbw));
            Assert.That(captions.Last.Text, Is.EqualTo("Out - LBW"));
            Assert.That(haptics.Last.Kind, Is.EqualTo(ProductionHapticKind.Wicket));
            Assert.That(haptics.Last.Strength, Is.EqualTo(1f));
        }

        [Test]
        public void AuthoritativeLeave_KeepsLeaveCaptionAcrossKeeperTake()
        {
            sink.Configure(false, false, true);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            sink.SetAuthoritativeOutcome("leave", null);

            sink.Handle(Feedback(PracticeFeedbackKind.KeeperTake, 0.98));

            Assert.That(captions.Last.Id, Is.EqualTo(ProductionCaptionId.Leave));
            Assert.That(captions.Last.Text, Is.EqualTo("Left alone"));
        }

        [Test]
        public void FeedbackRouter_MirrorsPhysicalEventPositionWithThePresentedHandedness()
        {
            var recording = new RecordingFeedbackSink();
            var router = new PracticeFeedbackRouter(recording, -1.0);
            router.Route(new CanonicalTraceEvent
            {
                kind = "contact",
                t = 0.72,
                contact = "middle",
                p = new TraceVector3 { x = 0.42, y = 0.73, z = 8.9 }
            });

            Assert.That(recording.Last.Position.x, Is.EqualTo(-0.42).Within(0.000001));
            Assert.That(recording.Last.Position.y, Is.EqualTo(0.73).Within(0.000001));
            Assert.That(recording.Last.Position.z, Is.EqualTo(8.9).Within(0.000001));
        }

        private static PracticeFeedbackEvent Feedback(
            PracticeFeedbackKind kind,
            double time,
            string contact = null)
        {
            return new PracticeFeedbackEvent(kind, time, contact, 0, null);
        }

        private sealed class RecordingHaptics : IProductionHapticOutput
        {
            public int EmitCount { get; private set; }
            public int CancelCount { get; private set; }
            public ProductionHapticCue Last { get; private set; }

            public void Emit(ProductionHapticCue cue)
            {
                Last = cue;
                EmitCount++;
            }

            public void CancelAll()
            {
                CancelCount++;
            }
        }

        private sealed class RecordingCaptions : IProductionCaptionOutput
        {
            public int PresentCount { get; private set; }
            public int ClearCount { get; private set; }
            public ProductionCaptionCue Last { get; private set; }

            public void Present(ProductionCaptionCue cue)
            {
                Last = cue;
                PresentCount++;
            }

            public void Clear()
            {
                ClearCount++;
            }
        }

        private sealed class RecordingFeedbackSink : IPracticeFeedbackSink
        {
            public PracticeFeedbackEvent Last { get; private set; }

            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { Last = feedback; }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
