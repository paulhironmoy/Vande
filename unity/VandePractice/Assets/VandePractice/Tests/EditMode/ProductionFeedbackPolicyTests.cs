using NUnit.Framework;
using Vande.Practice.Audio.Production;

namespace Vande.Practice.Tests
{
    public sealed class ProductionFeedbackPolicyTests
    {
        [Test]
        public void VoiceAllocator_IsBoundedAndHigherPriorityPreemptsLowerPriority()
        {
            var allocator = new ProductionFeedbackVoiceAllocator(1, 1);
            var low = allocator.Reserve(ProductionFeedbackChannel.Physical, 40, 0.0, 1.0);
            var rejectedEqual = allocator.Reserve(ProductionFeedbackChannel.Physical, 40, 0.1, 1.0);
            var high = allocator.Reserve(ProductionFeedbackChannel.Physical, 100, 0.2, 0.2);

            Assert.That(low, Is.EqualTo(0));
            Assert.That(rejectedEqual, Is.EqualTo(-1));
            Assert.That(high, Is.EqualTo(0));
            Assert.That(allocator.Priority(0), Is.EqualTo(100));
            Assert.That(allocator.BusyUntil(0), Is.EqualTo(0.4).Within(0.000001));
        }

        [Test]
        public void CrowdVoices_CannotStealPhysicalContactVoice()
        {
            var allocator = new ProductionFeedbackVoiceAllocator(1, 1);
            var physical = allocator.Reserve(ProductionFeedbackChannel.Physical, 100, 0.0, 1.0);
            var crowd = allocator.Reserve(ProductionFeedbackChannel.Crowd, 127, 0.0, 1.0);
            var extraCrowd = allocator.Reserve(ProductionFeedbackChannel.Crowd, 20, 0.1, 1.0);

            Assert.That(physical, Is.EqualTo(0));
            Assert.That(crowd, Is.EqualTo(1));
            Assert.That(extraCrowd, Is.EqualTo(-1));
            Assert.That(allocator.Priority(0), Is.EqualTo(100));
        }

        [Test]
        public void PauseShift_ExtendsReservationsWithoutGrowingPool()
        {
            var allocator = new ProductionFeedbackVoiceAllocator(2, 1);
            allocator.Reserve(ProductionFeedbackChannel.Physical, 80, 1.0, 0.5);
            allocator.ShiftBusyTimes(2.0);

            Assert.That(allocator.VoiceCount, Is.EqualTo(3));
            Assert.That(allocator.BusyUntil(0), Is.EqualTo(3.5).Within(0.000001));
        }

        [Test]
        public void VariantSelection_IsRepeatSafeAndDeterministic()
        {
            var first = new ProductionFeedbackVariantSelector();
            var second = new ProductionFeedbackVariantSelector();
            var previousClip = -1;
            var previousPitch = int.MinValue;

            for (var index = 0; index < 12; index++)
            {
                var a = first.Select(ProductionFeedbackCue.Pitch, 3, 0.4 + index * 0.01);
                var b = second.Select(ProductionFeedbackCue.Pitch, 3, 0.4 + index * 0.01);
                Assert.That(a.ClipIndex, Is.EqualTo(b.ClipIndex));
                Assert.That(a.PitchStep, Is.EqualTo(b.PitchStep));
                Assert.That(a.ClipIndex, Is.Not.EqualTo(previousClip));
                Assert.That(a.PitchStep, Is.Not.EqualTo(previousPitch));
                previousClip = a.ClipIndex;
                previousPitch = a.PitchStep;
            }
        }

        [Test]
        public void SingleClipFallback_StillAvoidsIdenticalConsecutivePitchSignature()
        {
            var selector = new ProductionFeedbackVariantSelector();
            var first = selector.Select(ProductionFeedbackCue.BatMiddle, 1, 0.7);
            var second = selector.Select(ProductionFeedbackCue.BatMiddle, 1, 0.7);

            Assert.That(first.ClipIndex, Is.EqualTo(0));
            Assert.That(second.ClipIndex, Is.EqualTo(0));
            Assert.That(second.PitchStep, Is.Not.EqualTo(first.PitchStep));
        }
    }
}
