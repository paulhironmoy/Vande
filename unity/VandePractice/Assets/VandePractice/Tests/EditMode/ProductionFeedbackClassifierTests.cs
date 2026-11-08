using System;
using NUnit.Framework;
using Vande.Practice.Audio;
using Vande.Practice.Audio.Production;

namespace Vande.Practice.Tests
{
    public sealed class ProductionFeedbackClassifierTests
    {
        private ProductionFeedbackClassifier classifier;
        private ProductionFeedbackInstruction[] output;

        [SetUp]
        public void SetUp()
        {
            classifier = new ProductionFeedbackClassifier();
            output = new ProductionFeedbackInstruction[ProductionFeedbackClassifier.RequiredInstructionCapacity];
        }

        [Test]
        public void AuthoritativeEvents_MapToDistinctCausalCategories()
        {
            AssertSingle(Feedback(PracticeFeedbackKind.Release, 0.0), ProductionFeedbackCue.Release);
            AssertSingle(Feedback(PracticeFeedbackKind.PitchBounce, 0.42), ProductionFeedbackCue.Pitch);
            AssertSingle(Feedback(PracticeFeedbackKind.BatContact, 0.71, "middle"), ProductionFeedbackCue.BatMiddle);
            AssertSingle(Feedback(PracticeFeedbackKind.BallBounce, 1.02), ProductionFeedbackCue.BallGround);
            AssertSingle(Feedback(PracticeFeedbackKind.Field, 1.31), ProductionFeedbackCue.FieldPickup);
            AssertSingle(Feedback(PracticeFeedbackKind.Throw, 1.62), ProductionFeedbackCue.Throw);
        }

        [Test]
        public void DefendedMiddle_UsesBlockSignatureWithoutChangingContactAuthority()
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            classifier.SetShotIntent("defend");
            var count = classifier.Classify(
                Feedback(PracticeFeedbackKind.BatContact, 0.7, "middle"), output);

            Assert.That(count, Is.EqualTo(1));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.BatBlock));
            Assert.That(output[0].Haptic, Is.EqualTo(ProductionHapticKind.Block));
            Assert.That(classifier.PhysicalContactOccurred, Is.True);
        }

        [TestCase("outside_edge", ProductionFeedbackCue.Nick)]
        [TestCase("nick", ProductionFeedbackCue.Nick)]
        [TestCase("inside_edge", ProductionFeedbackCue.Edge)]
        [TestCase("top_edge", ProductionFeedbackCue.Edge)]
        [TestCase("leading_edge", ProductionFeedbackCue.Edge)]
        public void EdgeFamilies_AreDistinctAndCreateOnlyProportionalTension(
            string contact,
            ProductionFeedbackCue expected)
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            var count = classifier.Classify(
                Feedback(PracticeFeedbackKind.BatContact, 0.72, contact), output);

            Assert.That(count, Is.EqualTo(2));
            Assert.That(output[0].Cue, Is.EqualTo(expected));
            Assert.That(output[1].Cue, Is.EqualTo(ProductionFeedbackCue.CrowdTension));
            Assert.That(output[1].CrowdEmotion, Is.EqualTo(ProductionCrowdEmotion.Tension));
        }

        [Test]
        public void Miss_IsExplicitButNeverCreatesContactAudioOrHaptic()
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            var count = classifier.Classify(
                Feedback(PracticeFeedbackKind.BatContact, 0.69, "miss"), output);

            Assert.That(count, Is.EqualTo(1));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.Miss));
            Assert.That(output[0].Audible, Is.False, "a miss must not manufacture contact sound");
            Assert.That(output[0].Haptic, Is.EqualTo(ProductionHapticKind.None),
                "a miss must not manufacture contact haptic");
            Assert.That(classifier.PhysicalContactOccurred, Is.False);

            count = classifier.Classify(Feedback(PracticeFeedbackKind.KeeperTake, 0.98), output);
            Assert.That(count, Is.EqualTo(2));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.KeeperTake),
                "the later glove contact remains physically audible");
            Assert.That(output[1].Cue, Is.EqualTo(ProductionFeedbackCue.CrowdNearMiss));
        }

        [Test]
        public void NoContactWicket_OrdersMissStumpBailThenCrowdShift()
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            var count = classifier.Classify(Feedback(PracticeFeedbackKind.Stumps, 0.91), output);

            Assert.That(count, Is.EqualTo(4));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.Miss));
            Assert.That(output[0].Audible, Is.False);
            Assert.That(output[1].Cue, Is.EqualTo(ProductionFeedbackCue.StumpImpact));
            Assert.That(output[2].Cue, Is.EqualTo(ProductionFeedbackCue.BailFall));
            Assert.That(output[2].DelaySeconds, Is.GreaterThan(output[1].DelaySeconds));
            Assert.That(output[3].Cue, Is.EqualTo(ProductionFeedbackCue.CrowdWicket));
            Assert.That(output[3].DelaySeconds, Is.GreaterThan(output[2].DelaySeconds));
            Assert.That(classifier.WicketConfirmed, Is.True);
        }

        [Test]
        public void AuthoritativeLeave_UsesLeaveAndNeverNearMissOrDot()
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            classifier.SetAuthoritativeOutcome("leave", null);

            var count = classifier.Classify(
                Feedback(PracticeFeedbackKind.KeeperTake, 0.98), output);

            Assert.That(count, Is.EqualTo(2));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.Leave));
            Assert.That(output[0].Audible, Is.False);
            Assert.That(output[0].Haptic, Is.EqualTo(ProductionHapticKind.None));
            Assert.That(output[1].Cue, Is.EqualTo(ProductionFeedbackCue.KeeperTake));
            Assert.That(output[1].Caption, Is.EqualTo(ProductionCaptionId.None),
                "keeper sound must not immediately overwrite the leave caption");
            Assert.That(classifier.Classify(
                Feedback(PracticeFeedbackKind.Dead, 1.04), output), Is.EqualTo(0),
                "an intentional leave must not become a near-miss or dot at dead");
        }

        [Test]
        public void ReplayRelease_PreservesAuthoritativeLeave()
        {
            classifier.SetAuthoritativeOutcome("leave", null);
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);

            var count = classifier.Classify(
                Feedback(PracticeFeedbackKind.BatContact, 0.7, "miss"), output);

            Assert.That(count, Is.EqualTo(1));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.Leave));
            Assert.That(classifier.ShotIntent, Is.EqualTo(ProductionShotIntent.Leave));
        }

        [Test]
        public void ReplayRelease_PreservesAuthoritativeDefendForBlockSignature()
        {
            classifier.SetAuthoritativeOutcome("defend", null);
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);

            var count = classifier.Classify(
                Feedback(PracticeFeedbackKind.BatContact, 0.7, "middle"), output);

            Assert.That(count, Is.EqualTo(1));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.BatBlock));
        }

        [TestCase(false)]
        [TestCase(true)]
        public void AuthoritativeLbw_PadThenDeadYieldsVerdictHapticAndWicketCrowd(
            bool replayOrder)
        {
            if (replayOrder) classifier.SetAuthoritativeOutcome("defend", "lbw");
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            if (!replayOrder) classifier.SetAuthoritativeOutcome("defend", "lbw");
            classifier.Classify(Feedback(PracticeFeedbackKind.Pad, 0.72), output);

            var count = classifier.Classify(Feedback(PracticeFeedbackKind.Dead, 1.2), output);

            Assert.That(count, Is.EqualTo(2));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.Lbw));
            Assert.That(output[0].Caption, Is.EqualTo(ProductionCaptionId.Lbw));
            Assert.That(output[0].Haptic, Is.EqualTo(ProductionHapticKind.Wicket));
            Assert.That(output[0].Audible, Is.False,
                "the pad event already supplied the physical impact sound");
            Assert.That(output[1].Cue, Is.EqualTo(ProductionFeedbackCue.CrowdWicket));
            Assert.That(output[1].Caption, Is.EqualTo(ProductionCaptionId.None),
                "the crowd must not immediately overwrite the LBW verdict caption");
            Assert.That(output[1].CrowdEmotion,
                Is.EqualTo(ProductionCrowdEmotion.WicketShift));
            Assert.That(classifier.WicketConfirmed, Is.True);
        }

        [Test]
        public void NextLiveRelease_ClearsPriorAuthoritativeLeave()
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            classifier.SetAuthoritativeOutcome("leave", null);
            classifier.Classify(Feedback(PracticeFeedbackKind.Dead, 1.0), output);

            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            var count = classifier.Classify(
                Feedback(PracticeFeedbackKind.KeeperTake, 0.9), output);

            Assert.That(count, Is.EqualTo(3));
            Assert.That(output[0].Cue, Is.EqualTo(ProductionFeedbackCue.Miss));
            Assert.That(output[2].Cue, Is.EqualTo(ProductionFeedbackCue.CrowdNearMiss));
        }

        [TestCase(4, ProductionFeedbackCue.BoundaryFour, ProductionFeedbackCue.CrowdBoundary)]
        [TestCase(6, ProductionFeedbackCue.BoundarySix, ProductionFeedbackCue.CrowdSix)]
        public void BoundaryCelebration_FollowsOnlyConfirmedBoundary(
            int runs,
            ProductionFeedbackCue physical,
            ProductionFeedbackCue crowd)
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            classifier.Classify(Feedback(PracticeFeedbackKind.BatContact, 0.7, "middle"), output);
            var count = classifier.Classify(Feedback(PracticeFeedbackKind.Boundary, 2.4, null, runs), output);

            Assert.That(count, Is.EqualTo(2));
            Assert.That(output[0].Cue, Is.EqualTo(physical));
            Assert.That(output[1].Cue, Is.EqualTo(crowd));
            Assert.That(classifier.BoundaryConfirmed, Is.True);
        }

        [Test]
        public void ExactDuplicateTraceEvent_DoesNotReplayFeedback()
        {
            classifier.Classify(Feedback(PracticeFeedbackKind.Release, 0.0), output);
            var value = Feedback(PracticeFeedbackKind.PitchBounce, 0.42);
            Assert.That(classifier.Classify(value, output), Is.EqualTo(1));
            Assert.That(classifier.Classify(value, output), Is.EqualTo(0));
        }

        [Test]
        public void Classification_IsDeterministicForTheSameEventSequence()
        {
            var second = new ProductionFeedbackClassifier();
            var secondOutput = new ProductionFeedbackInstruction[ProductionFeedbackClassifier.RequiredInstructionCapacity];
            var sequence = new[]
            {
                Feedback(PracticeFeedbackKind.Release, 0.0),
                Feedback(PracticeFeedbackKind.PitchBounce, 0.44),
                Feedback(PracticeFeedbackKind.BatContact, 0.72, "outside_edge"),
                Feedback(PracticeFeedbackKind.Catch, 1.41),
                Feedback(PracticeFeedbackKind.Dead, 1.41)
            };

            for (var eventIndex = 0; eventIndex < sequence.Length; eventIndex++)
            {
                var firstCount = classifier.Classify(sequence[eventIndex], output);
                var secondCount = second.Classify(sequence[eventIndex], secondOutput);
                Assert.That(secondCount, Is.EqualTo(firstCount));
                for (var instruction = 0; instruction < firstCount; instruction++)
                {
                    Assert.That(secondOutput[instruction].Cue, Is.EqualTo(output[instruction].Cue));
                    Assert.That(secondOutput[instruction].Priority, Is.EqualTo(output[instruction].Priority));
                    Assert.That(secondOutput[instruction].DelaySeconds,
                        Is.EqualTo(output[instruction].DelaySeconds));
                    Assert.That(secondOutput[instruction].Haptic, Is.EqualTo(output[instruction].Haptic));
                }
            }
        }

        [Test]
        public void HotClassificationPath_ReusesCallerBufferWithoutManagedAllocation()
        {
            var release = Feedback(PracticeFeedbackKind.Release, 0.0);
            var pitch = Feedback(PracticeFeedbackKind.PitchBounce, 0.42);
            var middle = Feedback(PracticeFeedbackKind.BatContact, 0.7, "middle");
            var dead = Feedback(PracticeFeedbackKind.Dead, 1.2);

            // Warm JIT/static paths before measuring the repeated live path.
            classifier.Classify(release, output);
            classifier.SetAuthoritativeOutcome("attack", null);
            classifier.Classify(pitch, output);
            classifier.Classify(middle, output);
            classifier.Classify(dead, output);

            var before = GC.GetAllocatedBytesForCurrentThread();
            for (var index = 0; index < 128; index++)
            {
                classifier.Classify(release, output);
                classifier.SetAuthoritativeOutcome("attack", null);
                classifier.Classify(pitch, output);
                classifier.Classify(middle, output);
                classifier.Classify(dead, output);
            }
            var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

            Assert.That(allocated, Is.EqualTo(0),
                "classification must not allocate after Configure supplied its reusable buffer");
        }

        private void AssertSingle(PracticeFeedbackEvent value, ProductionFeedbackCue expected)
        {
            var count = classifier.Classify(value, output);
            Assert.That(count, Is.EqualTo(1));
            Assert.That(output[0].Cue, Is.EqualTo(expected));
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
