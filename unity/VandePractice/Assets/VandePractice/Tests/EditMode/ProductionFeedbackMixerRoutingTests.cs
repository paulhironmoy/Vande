using System;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Audio;
using Vande.Practice.Audio;
using Vande.Practice.Audio.Production;

namespace Vande.Practice.Tests
{
    public sealed class ProductionFeedbackMixerRoutingTests
    {
        private GameObject root;
        private ProductionPracticeFeedbackSink sink;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("ProductionFeedbackMixerRoutingTests");
            sink = root.AddComponent<ProductionPracticeFeedbackSink>();
        }

        [TearDown]
        public void TearDown()
        {
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
        }

        [Test]
        public void MixerResource_HasExactCompleteTopology()
        {
            var routing = new ProductionFeedbackMixerRouting();
            routing.Configure();

            Assert.That(routing.AssetAvailable, Is.True,
                "the routing mixer must be generated before the production surface is built");
            Assert.That(routing.MasterGroupResolved, Is.True);
            Assert.That(routing.ResolvedChildGroupCount,
                Is.EqualTo(ProductionFeedbackMixerRouting.RequiredChildGroupCount));
            Assert.That(routing.HasCompleteTopology, Is.True);

            for (var index = (int)ProductionFeedbackMixerBus.Ball;
                 index < (int)ProductionFeedbackMixerBus.Count;
                 index++)
            {
                var bus = (ProductionFeedbackMixerBus)index;
                var group = routing.GroupFor(bus);
                Assert.That(group, Is.Not.Null, "missing mixer group for " + bus);
                Assert.That(group.name, Is.EqualTo(ProductionFeedbackMixerRouting.GroupName(bus)));
            }
        }

        [TestCase(ProductionFeedbackCue.Release, ProductionFeedbackMixerBus.Ball)]
        [TestCase(ProductionFeedbackCue.Pitch, ProductionFeedbackMixerBus.Ball)]
        [TestCase(ProductionFeedbackCue.BallGround, ProductionFeedbackMixerBus.Ball)]
        [TestCase(ProductionFeedbackCue.BatMiddle, ProductionFeedbackMixerBus.Bat)]
        [TestCase(ProductionFeedbackCue.BatBlock, ProductionFeedbackMixerBus.Bat)]
        [TestCase(ProductionFeedbackCue.Edge, ProductionFeedbackMixerBus.Bat)]
        [TestCase(ProductionFeedbackCue.Nick, ProductionFeedbackMixerBus.Bat)]
        [TestCase(ProductionFeedbackCue.KeeperTake, ProductionFeedbackMixerBus.Field)]
        [TestCase(ProductionFeedbackCue.FieldPickup, ProductionFeedbackMixerBus.Field)]
        [TestCase(ProductionFeedbackCue.Catch, ProductionFeedbackMixerBus.Field)]
        [TestCase(ProductionFeedbackCue.Throw, ProductionFeedbackMixerBus.Field)]
        [TestCase(ProductionFeedbackCue.BoundaryFour, ProductionFeedbackMixerBus.Field)]
        [TestCase(ProductionFeedbackCue.StumpImpact, ProductionFeedbackMixerBus.Field)]
        [TestCase(ProductionFeedbackCue.BailFall, ProductionFeedbackMixerBus.Field)]
        [TestCase(ProductionFeedbackCue.Pad, ProductionFeedbackMixerBus.Players)]
        [TestCase(ProductionFeedbackCue.Miss, ProductionFeedbackMixerBus.Players)]
        [TestCase(ProductionFeedbackCue.Leave, ProductionFeedbackMixerBus.Players)]
        [TestCase(ProductionFeedbackCue.BoundarySix, ProductionFeedbackMixerBus.Players)]
        [TestCase(ProductionFeedbackCue.Run, ProductionFeedbackMixerBus.Players)]
        [TestCase(ProductionFeedbackCue.Lbw, ProductionFeedbackMixerBus.Players)]
        [TestCase(ProductionFeedbackCue.CrowdTension, ProductionFeedbackMixerBus.Crowd)]
        [TestCase(ProductionFeedbackCue.CrowdNearMiss, ProductionFeedbackMixerBus.Crowd)]
        [TestCase(ProductionFeedbackCue.CrowdRun, ProductionFeedbackMixerBus.Crowd)]
        [TestCase(ProductionFeedbackCue.CrowdBoundary, ProductionFeedbackMixerBus.Crowd)]
        [TestCase(ProductionFeedbackCue.CrowdSix, ProductionFeedbackMixerBus.Crowd)]
        [TestCase(ProductionFeedbackCue.CrowdWicket, ProductionFeedbackMixerBus.Crowd)]
        [TestCase(ProductionFeedbackCue.CrowdDot, ProductionFeedbackMixerBus.Crowd)]
        public void ExistingCue_MapsDeterministicallyToOneSemanticBus(
            ProductionFeedbackCue cue,
            ProductionFeedbackMixerBus expected)
        {
            Assert.That(ProductionFeedbackMixerRouting.BusForCue(cue), Is.EqualTo(expected));
        }

        [Test]
        public void MissingMixer_FailsSafelyToDirectOutputAndSearchesOnlyDuringConfigure()
        {
            var loadCalls = 0;
            var routing = new ProductionFeedbackMixerRouting(path =>
            {
                loadCalls++;
                return null;
            });

            routing.Configure();
            routing.Configure();

            Assert.That(loadCalls, Is.EqualTo(1));
            Assert.That(routing.AssetAvailable, Is.False);
            Assert.That(routing.HasCompleteTopology, Is.False);
            Assert.That(routing.GroupFor(ProductionFeedbackCue.BatMiddle), Is.Null,
                "null keeps AudioSource on Unity's direct-output fallback");
        }

        [Test]
        public void Sink_RoutesBallBatFieldAndCrowdWithoutChangingVoicePools()
        {
            sink.Configure(true, false, false);
            Assert.That(sink.PreparedVoiceCount, Is.EqualTo(9));
            Assert.That(sink.MixerTopologyComplete, Is.True);

            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            AssertGroup("VANDE Physical Feedback Voice 1", "Ball");

            sink.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.7, "middle"));
            AssertGroup("VANDE Physical Feedback Voice 2", "Bat");
            Assert.That(sink.ScheduledCrowdAudioCueCount, Is.Zero,
                "a middle contact alone cannot reveal a later result through crowd audio");

            sink.Handle(Feedback(PracticeFeedbackKind.Boundary, 2.4, null, 4));
            AssertGroup("VANDE Physical Feedback Voice 3", "Field");
            AssertGroup("VANDE Crowd Feedback Voice 1", "Crowd");
            Assert.That(sink.ScheduledPhysicalAudioCueCount, Is.EqualTo(3));
            Assert.That(sink.ScheduledCrowdAudioCueCount, Is.EqualTo(1));
        }

        [Test]
        public void MissAndLeave_StaySilentAndNeverTriggerEarlyCrowd()
        {
            sink.Configure(true, false, false);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            var beforeMiss = sink.ScheduledAudioCueCount;

            sink.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.7, "miss"));

            Assert.That(sink.ScheduledAudioCueCount, Is.EqualTo(beforeMiss));
            Assert.That(sink.ScheduledCrowdAudioCueCount, Is.Zero);

            sink.StopAll();
            sink.SetAuthoritativeOutcome("leave", null);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            var beforeLeave = sink.ScheduledAudioCueCount;

            sink.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.7, "miss"));
            sink.Handle(Feedback(PracticeFeedbackKind.Dead, 1.0));

            Assert.That(sink.ScheduledAudioCueCount, Is.EqualTo(beforeLeave));
            Assert.That(sink.ScheduledCrowdAudioCueCount, Is.Zero,
                "an intentional leave is restrained and cannot become a dot or near-miss cue");
        }

        [Test]
        public void PauseAndUnload_DoNotReplayOrRetainPreparedMixerState()
        {
            sink.Configure(false, false, false);
            var resourceSearches = sink.MixerResourceSearchCount;
            Assert.That(resourceSearches, Is.EqualTo(1));

            sink.SetPaused(true);
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            Assert.That(sink.ScheduledAudioCueCount, Is.Zero);
            sink.SetPaused(false);
            Assert.That(sink.MixerResourceSearchCount, Is.EqualTo(resourceSearches));

            sink.ReleasePreparedResources();

            Assert.That(sink.IsPrepared, Is.False);
            Assert.That(sink.MixerRoutingPrepared, Is.False);
            Assert.That(sink.PreparedVoiceCount, Is.Zero);
            Assert.That(root.transform.childCount, Is.Zero);
        }

        [Test]
        public void HandleAndPreparedRouting_DoNotAllocateOrSearchForResources()
        {
            sink.Configure(false, false, false);
            var release = Feedback(PracticeFeedbackKind.Release, 0.0);
            var pitch = Feedback(PracticeFeedbackKind.PitchBounce, 0.42);
            var middle = Feedback(PracticeFeedbackKind.BatContact, 0.7, "middle");
            var dead = Feedback(PracticeFeedbackKind.Dead, 1.2);

            // Warm JIT/static paths before measuring the same live sequence.
            sink.Handle(release);
            sink.Handle(pitch);
            sink.Handle(middle);
            sink.Handle(dead);
            var resourceSearches = sink.MixerResourceSearchCount;
            var before = GC.GetAllocatedBytesForCurrentThread();
            for (var index = 0; index < 128; index++)
            {
                sink.Handle(release);
                sink.Handle(pitch);
                sink.Handle(middle);
                sink.Handle(dead);
            }
            var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

            Assert.That(allocated, Is.EqualTo(0),
                "Handle must reuse the classifier buffer and prepared routing state");
            Assert.That(sink.MixerResourceSearchCount, Is.EqualTo(resourceSearches),
                "Resources.Load/FindMatchingGroups belong to Configure, never Handle");

            var routing = new ProductionFeedbackMixerRouting();
            routing.Configure();
            routing.GroupFor(ProductionFeedbackCue.BatMiddle);
            before = GC.GetAllocatedBytesForCurrentThread();
            for (var index = 0; index < 256; index++)
                routing.GroupFor((ProductionFeedbackCue)(index % (int)ProductionFeedbackCue.Count));
            allocated = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.That(allocated, Is.EqualTo(0),
                "prepared cue-to-group routing must remain an array lookup");
            Assert.That(routing.ResourceSearchCount, Is.EqualTo(1));
        }

        private void AssertGroup(string voiceName, string expectedGroup)
        {
            var voice = root.transform.Find(voiceName);
            Assert.That(voice, Is.Not.Null, "missing prepared voice " + voiceName);
            var source = voice.GetComponent<AudioSource>();
            AudioMixerGroup group = source.outputAudioMixerGroup;
            Assert.That(group, Is.Not.Null, "voice remained on direct output: " + voiceName);
            Assert.That(group.name, Is.EqualTo(expectedGroup));
        }

        private static PracticeFeedbackEvent Feedback(
            PracticeFeedbackKind kind,
            double time,
            string contact = null,
            int runs = 0)
        {
            return new PracticeFeedbackEvent(kind, time, contact, runs, null);
        }
    }
}
