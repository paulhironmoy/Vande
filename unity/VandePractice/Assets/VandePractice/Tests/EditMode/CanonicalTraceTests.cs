using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    public sealed class CanonicalTraceTests
    {
        // Cross-runtime golden value for CanonicalTraceTestFixture.Create().
        private const string ExpectedDigest = "bc4b6c39168065daf38799dd66ed92f450f28eb72601f7b17bf04227c3edabbd";

        [Test]
        public void Digest_IsStableForCanonicalFixture()
        {
            var original = CanonicalTraceTestFixture.Create();

            Assert.That(CanonicalTraceDigest.Compute(original), Is.EqualTo(ExpectedDigest));
        }

        [Test]
        public void Digest_ChangesWhenAuthoritativeSampleChanges()
        {
            var trace = CanonicalTraceTestFixture.Create();
            var before = CanonicalTraceDigest.Compute(trace);
            trace.ball[1].p.x += 0.001;

            Assert.That(CanonicalTraceDigest.Compute(trace), Is.Not.EqualTo(before));
        }

        [Test]
        public void Digest_ChangesWhenAuthoritativeBatterRootChanges()
        {
            var trace = CanonicalTraceTestFixture.Create();
            var before = CanonicalTraceDigest.Compute(trace);
            trace.batterRootOffset.x += 0.001;

            Assert.That(CanonicalTraceDigest.Compute(trace), Is.Not.EqualTo(before));
        }

        [Test]
        public void Digest_ChangesWhenAuthoritativeBatterPostureChanges()
        {
            var trace = CanonicalTraceTestFixture.Create();
            var before = CanonicalTraceDigest.Compute(trace);
            trace.batterPosture.crouchM += 0.001;

            Assert.That(CanonicalTraceDigest.Compute(trace), Is.Not.EqualTo(before));
        }

        [Test]
        public void Digest_ChangesWhenAuthoritativeBatterMotionChanges()
        {
            var trace = CanonicalTraceTestFixture.Create();
            var heldEnd = trace.bat[trace.bat.Length - 1];
            trace.bat = new[]
            {
                trace.bat[0],
                trace.bat[1],
                CloneBatAt(heldEnd, 0.75),
                heldEnd
            };
            var before = CanonicalTraceDigest.Compute(trace);
            trace.batterMotion.endT = 0.75;

            Assert.That(CanonicalTraceDigest.Compute(trace), Is.Not.EqualTo(before));
        }

        [Test]
        public void Validation_RejectsUnorderedSamples()
        {
            var trace = CanonicalTraceTestFixture.Create();
            trace.ball[1].t = -0.1;

            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(trace));
        }

        [Test]
        public void Validation_RejectsDuplicateBatSampleTimes()
        {
            var trace = RigidTrace(new[]
            {
                RigidBat(0.20, 0.0, 1.1, 9.1, 0.0),
                RigidBat(0.20, 0.1, 1.2, 9.0, 10.0)
            });

            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(trace));
        }

        [Test]
        public void Validation_AllowsDistinctExactVelocityPeakAndBladeImpulseKnots()
        {
            var trace = RigidTrace(new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            }, 0.35, 0.50);

            Assert.DoesNotThrow(() => CanonicalTraceValidator.Validate(trace));
            Assert.DoesNotThrow(() => new CanonicalTracePlayback(trace, new RecordingTarget()));
        }

        [Test]
        public void Validation_RejectsMissingOrAmbiguousVelocityPeakAndBladeImpulseKnots()
        {
            var tolerance = BridgeConstants.ExactTraceTimeToleranceSeconds;
            var ordinary = new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            };
            var missingPeak = RigidTrace(ordinary, 0.35, 0.50 + tolerance * 2.0);
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(missingPeak));

            var missingImpulse = RigidTrace(ordinary, 0.35 + tolerance * 2.0, 0.50);
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(missingImpulse));

            var ambiguousPeak = RigidTrace(new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50 - tolerance * 0.5, 0.29, 1.10, 9.10, 29.0),
                RigidBat(0.50 + tolerance * 0.5, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            }, 0.35, 0.50);
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(ambiguousPeak));

            var ambiguousImpulse = RigidTrace(new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35 - tolerance * 0.5, 0.14, 1.10, 9.10, 14.0),
                RigidBat(0.35 + tolerance * 0.5, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            }, 0.35, 0.50);
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(ambiguousImpulse));
        }

        [Test]
        public void Validation_RejectsValuesOutsideUnityFloatDomain()
        {
            var vectorTrace = CanonicalTraceTestFixture.Create();
            vectorTrace.ball[1].p.x = BridgeConstants.MaxPresentationMagnitude + 1.0;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(vectorTrace));

            var fielderTrace = CanonicalTraceTestFixture.Create();
            fielderTrace.fielders[0].samples[0].x = BridgeConstants.MaxPresentationMagnitude + 1.0;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(fielderTrace));
        }

        [Test]
        public void Validation_RejectsMissingNonFiniteOrOverCapBatterRoot()
        {
            var missing = CanonicalTraceTestFixture.Create();
            missing.batterRootOffset = null;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(missing));

            var nonFinite = CanonicalTraceTestFixture.Create();
            nonFinite.batterRootOffset.z = double.NaN;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(nonFinite));

            var overCap = CanonicalTraceTestFixture.Create();
            overCap.batterRootOffset.x = BridgeConstants.MaxBatterRootOffsetMetres + 0.000001;
            overCap.batterRootOffset.z = 0.0;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(overCap));
        }

        [Test]
        public void Validation_RejectsMissingNonFiniteOrOutOfRangeBatterPosture()
        {
            var missing = CanonicalTraceTestFixture.Create();
            missing.batterPosture = null;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(missing));

            var nonFinite = CanonicalTraceTestFixture.Create();
            nonFinite.batterPosture.crouchM = double.NaN;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(nonFinite));

            var negative = CanonicalTraceTestFixture.Create();
            negative.batterPosture.crouchM = -0.000001;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(negative));

            var overCap = CanonicalTraceTestFixture.Create();
            overCap.batterPosture.crouchM = BridgeConstants.MaxBatterCrouchMetres + 0.000001;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(overCap));
        }

        [Test]
        public void Validation_RequiresExactFiniteBatterMotionForNonEmptyBatOnly()
        {
            var missing = CanonicalTraceTestFixture.Create();
            missing.batterMotion = null;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(missing));

            var nonFinite = CanonicalTraceTestFixture.Create();
            nonFinite.batterMotion.contactT = double.NaN;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(nonFinite));

            var wrongStart = CanonicalTraceTestFixture.Create();
            wrongStart.batterMotion.startT += 0.000000000001;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(wrongStart));

            var wrongEnd = CanonicalTraceTestFixture.Create();
            wrongEnd.batterMotion.endT -= 0.000001;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(wrongEnd));

            var outside = CanonicalTraceTestFixture.Create();
            outside.batterMotion.contactT = outside.batterMotion.endT + 0.000001;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(outside));

            var emptyWithMotion = CanonicalTraceTestFixture.Create();
            emptyWithMotion.bat = Array.Empty<BatTraceSample>();
            emptyWithMotion.events = new[] { new CanonicalTraceEvent { t = 0.0, kind = "release" } };
            emptyWithMotion.batterRootOffset = new TraceVector2 { x = 0.0, z = 0.0 };
            emptyWithMotion.batterPosture = new TraceBatterPosture { crouchM = 0.0 };
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(emptyWithMotion));
        }

        [Test]
        public void Validation_AllowsTerminalHoldOnlyWhenEveryLaterKnotEqualsMotionEndPose()
        {
            var heldPose = RigidBat(0.50, 0.20, 1.20, 8.90, 70.0);
            var trace = RigidTrace(new[]
            {
                RigidBat(0.00, -0.10, 1.05, 9.15, -10.0),
                RigidBat(0.25, 0.05, 1.12, 9.02, 30.0),
                heldPose,
                new BatTraceSample
                {
                    t = 1.0,
                    grip = Vector(heldPose.grip.x, heldPose.grip.y, heldPose.grip.z),
                    toe = Vector(heldPose.toe.x, heldPose.toe.y, heldPose.toe.z),
                    face = Vector(heldPose.face.x, heldPose.face.y, heldPose.face.z)
                }
            });
            trace.batterMotion = new TraceBatterMotion
            {
                startT = 0.0,
                contactT = 0.25,
                endT = 0.50
            };
            Assert.DoesNotThrow(() => CanonicalTraceValidator.Validate(trace));

            trace.bat[3].grip.x += BridgeConstants.HeldBatPoseToleranceMetres * 2.0;
            trace.bat[3].toe.x += BridgeConstants.HeldBatPoseToleranceMetres * 2.0;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(trace));
        }

        [Test]
        public void Validation_EmptyBatRequiresNominalRootAndPostureWithinOneMicrometre()
        {
            var accepted = CanonicalTraceTestFixture.Create();
            accepted.bat = Array.Empty<BatTraceSample>();
            accepted.batterMotion = null;
            accepted.events = new[] { new CanonicalTraceEvent { t = 0.0, kind = "release" } };
            accepted.batterRootOffset = new TraceVector2 { x = 0.000001, z = -0.000001 };
            accepted.batterPosture = new TraceBatterPosture { crouchM = 0.000001 };
            Assert.DoesNotThrow(() => CanonicalTraceValidator.Validate(accepted));

            var moved = CanonicalTraceTestFixture.Create();
            moved.bat = Array.Empty<BatTraceSample>();
            moved.batterMotion = null;
            moved.events = new[] { new CanonicalTraceEvent { t = 0.0, kind = "release" } };
            moved.batterRootOffset = new TraceVector2 { x = 0.0000011, z = 0.0 };
            moved.batterPosture = new TraceBatterPosture { crouchM = 0.0 };
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(moved));

            var crouched = CanonicalTraceTestFixture.Create();
            crouched.bat = Array.Empty<BatTraceSample>();
            crouched.batterMotion = null;
            crouched.events = new[] { new CanonicalTraceEvent { t = 0.0, kind = "release" } };
            crouched.batterRootOffset = new TraceVector2 { x = 0.0, z = 0.0 };
            crouched.batterPosture = new TraceBatterPosture { crouchM = 0.0000011 };
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(crouched));
        }

        [Test]
        public void Validation_RejectsMalformedRigidBatKnots()
        {
            var badLength = CanonicalTraceTestFixture.Create();
            badLength.bat[0].toe.y -= 0.01;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(badLength));

            var badFaceLength = CanonicalTraceTestFixture.Create();
            badFaceLength.bat[0].face.z = 0.9;
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(badFaceLength));

            var badOrthogonality = CanonicalTraceTestFixture.Create();
            badOrthogonality.bat[0].face = Vector(0.0, 0.1, Math.Sqrt(0.99));
            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(badOrthogonality));
        }

        [Test]
        public void Playback_InterpolatesAndEmitsEachEventOnce()
        {
            var target = new RecordingTarget();
            var playback = new CanonicalTracePlayback(CanonicalTraceTestFixture.Create(), target);

            playback.Advance(0.5);
            Assert.That(target.Ball.p.x, Is.EqualTo(0.5).Within(0.000001));
            Assert.That(target.Events.Count, Is.EqualTo(2));

            playback.Advance(0.5);
            playback.Advance(0.5);
            Assert.That(playback.Completed, Is.True);
            Assert.That(target.Completed, Is.True);
            Assert.That(target.Events.Count, Is.EqualTo(2));
        }

        [Test]
        public void Seek_DoesNotReplayHistoricalEvents()
        {
            var target = new RecordingTarget();
            var playback = new CanonicalTracePlayback(CanonicalTraceTestFixture.Create(), target);

            playback.Seek(0.75);
            playback.Advance(0.1);

            Assert.That(target.Events, Is.Empty);
        }

        [Test]
        public void RigidBatInterpolation_IsAbsentBeforeDomainThenHoldsEndpointAndPreservesExactContactKnot()
        {
            var bat = new[]
            {
                RigidBat(0.20, -0.18, 1.12, 9.18, -24.0),
                RigidBat(0.35, -0.08, 1.28, 9.12, 8.0),
                RigidBat(0.50, 0.14, 1.08, 8.92, 61.0),
                RigidBat(0.68, 0.28, 1.34, 8.80, 108.0),
                RigidBat(0.82, 0.24, 1.48, 8.74, 132.0)
            };
            var trace = RigidTrace(bat, 0.50);
            var target = new RecordingTarget();
            var playback = new CanonicalTracePlayback(trace, target);

            playback.Seek(0.0);
            Assert.That(target.Bat, Is.Null);
            Assert.That(target.BatUpdates, Is.Zero);
            playback.Seek(0.12);
            Assert.That(target.Bat, Is.Null);
            Assert.That(target.BatUpdates, Is.Zero,
                "pre-domain playback must not emit a cloned first bat knot");
            playback.Seek(0.20);
            AssertBatExactly(target.Bat, bat[0]);
            Assert.That(target.BatUpdates, Is.EqualTo(1));
            playback.Seek(0.40);
            var updatesInsideDomain = target.BatUpdates;
            playback.Seek(0.12);
            Assert.That(target.BatUpdates, Is.EqualTo(updatesInsideDomain),
                "a backward pre-domain seek must not emit or clone a bat sample");

            for (var step = 0; step <= 620; step++)
            {
                playback.Seek(0.20 + step * 0.001);
                AssertRigidBat(target.Bat, "dense rigid sample " + step);
            }

            playback.Seek(0.50);
            AssertBatExactly(target.Bat, bat[2]);
            playback.Seek(0.95);
            AssertBatExactly(target.Bat, bat[bat.Length - 1]);
        }

        [Test]
        public void RigidBatInterpolation_DirectSeekMatchesAdvanceAndFrameClocks()
        {
            var trace = RigidTrace(new[]
            {
                RigidBat(0.0, -0.20, 1.10, 9.20, -30.0),
                RigidBat(0.2, -0.08, 1.32, 9.08, 5.0),
                RigidBat(0.4, 0.12, 1.12, 8.94, 55.0),
                RigidBat(0.6, 0.28, 1.30, 8.82, 104.0),
                RigidBat(0.8, 0.24, 1.46, 8.76, 130.0),
                RigidBat(1.0, 0.18, 1.50, 8.78, 138.0)
            }, 0.4);

            var direct = BatAt(trace, 0.6);
            var thirty = AdvanceAtClock(trace, 0.6, 1.0 / 30.0);
            var sixty = AdvanceAtClock(trace, 0.6, 1.0 / 60.0);
            var random = AdvanceAtRandomClock(trace, 0.6, 1701);
            AssertBatNear(thirty, direct, 0.000000001, "30 Hz");
            AssertBatNear(sixty, direct, 0.000000001, "60 Hz");
            AssertBatNear(random, direct, 0.000000001, "seeded random clock");

            var target = new RecordingTarget();
            var playback = new CanonicalTracePlayback(trace, target);
            playback.Advance(0.437125);
            var advanced = target.Bat;
            playback.Seek(0.113);
            playback.Seek(0.437125);
            AssertBatNear(target.Bat, advanced, 0.000000000001, "seek after unrelated seek");
        }

        [Test]
        public void RigidBatInterpolation_IsC1ExceptAtExactContactImpulse()
        {
            var trace = RigidTrace(new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.65, 0.00, 1.10, 9.10, 5.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            }, 0.50);
            const double epsilon = 0.00001;

            var beforeOrdinary = BatAt(trace, 0.35 - epsilon);
            var ordinary = BatAt(trace, 0.35);
            var afterOrdinary = BatAt(trace, 0.35 + epsilon);
            var ordinaryLeftVelocity = (ordinary.grip.x - beforeOrdinary.grip.x) / epsilon;
            var ordinaryRightVelocity = (afterOrdinary.grip.x - ordinary.grip.x) / epsilon;
            Assert.That(ordinaryRightVelocity, Is.EqualTo(ordinaryLeftVelocity).Within(0.001));
            var ordinaryLeftAngularVelocity =
                (AxisAngle(ordinary) - AxisAngle(beforeOrdinary)) / epsilon;
            var ordinaryRightAngularVelocity =
                (AxisAngle(afterOrdinary) - AxisAngle(ordinary)) / epsilon;
            Assert.That(
                ordinaryRightAngularVelocity,
                Is.EqualTo(ordinaryLeftAngularVelocity).Within(0.001));

            var beforeContact = BatAt(trace, 0.50 - epsilon);
            var contact = BatAt(trace, 0.50);
            var afterContact = BatAt(trace, 0.50 + epsilon);
            var incomingVelocity = (contact.grip.x - beforeContact.grip.x) / epsilon;
            var outgoingVelocity = (afterContact.grip.x - contact.grip.x) / epsilon;
            Assert.That(incomingVelocity, Is.GreaterThan(0.9));
            Assert.That(outgoingVelocity, Is.LessThan(-1.9));
            var incomingAngularVelocity = (AxisAngle(contact) - AxisAngle(beforeContact)) / epsilon;
            var outgoingAngularVelocity = (AxisAngle(afterContact) - AxisAngle(contact)) / epsilon;
            Assert.That(incomingAngularVelocity, Is.GreaterThan(1.7));
            Assert.That(outgoingAngularVelocity, Is.LessThan(-2.8));
        }

        [Test]
        public void RigidBatInterpolation_ReconstructsNonuniformVelocityPeakBeforeALaterImpulse()
        {
            const double velocityPeakT = 0.011;
            const double finishT = velocityPeakT * 2.0;
            const double gripAcceleration = 180.0;
            const double angularAcceleration = 220.0;
            Func<double, double, double> progress = (time, acceleration) =>
            {
                var clamped = Math.Min(time, finishT);
                if (clamped <= velocityPeakT) return 0.5 * acceleration * clamped * clamped;
                var after = clamped - velocityPeakT;
                return 0.5 * acceleration * velocityPeakT * velocityPeakT +
                       acceleration * velocityPeakT * after -
                       0.5 * acceleration * after * after;
            };
            var times = new[] { 0.0, 0.004, 0.008, velocityPeakT, 0.012, 0.016, 0.020, finishT, 0.026 };
            var samples = new BatTraceSample[times.Length];
            for (var index = 0; index < times.Length; index++)
            {
                var time = times[index];
                samples[index] = RigidBat(
                    time,
                    -0.25 + progress(time, gripAcceleration),
                    1.12,
                    9.08,
                    5.0 + progress(time, angularAcceleration) * 180.0 / Math.PI);
            }

            var noImpulse = RigidTrace(samples, null, velocityPeakT);
            var laterImpulse = RigidTrace(samples, 0.020, velocityPeakT);
            const double epsilon = 0.000001;
            var before = BatAt(noImpulse, velocityPeakT - epsilon);
            var at = BatAt(noImpulse, velocityPeakT);
            var after = BatAt(noImpulse, velocityPeakT + epsilon);
            var expectedGripSpeed = gripAcceleration * velocityPeakT;
            var expectedAngularSpeed = angularAcceleration * velocityPeakT;
            Assert.That((at.grip.x - before.grip.x) / epsilon,
                Is.EqualTo(expectedGripSpeed).Within(0.001));
            Assert.That((after.grip.x - at.grip.x) / epsilon,
                Is.EqualTo(expectedGripSpeed).Within(0.001));
            Assert.That((AxisAngle(at) - AxisAngle(before)) / epsilon,
                Is.EqualTo(expectedAngularSpeed).Within(0.001));
            Assert.That((AxisAngle(after) - AxisAngle(at)) / epsilon,
                Is.EqualTo(expectedAngularSpeed).Within(0.001));

            // The later impulse must leave the velocity peak's tangents unchanged on both sides.
            var laterBefore = BatAt(laterImpulse, velocityPeakT - epsilon);
            var laterAt = BatAt(laterImpulse, velocityPeakT);
            var laterAfter = BatAt(laterImpulse, velocityPeakT + epsilon);
            Assert.That((laterAt.grip.x - laterBefore.grip.x) / epsilon,
                Is.EqualTo(expectedGripSpeed).Within(0.001), "later impulse incoming grip tangent");
            Assert.That((laterAfter.grip.x - laterAt.grip.x) / epsilon,
                Is.EqualTo(expectedGripSpeed).Within(0.001), "later impulse outgoing grip tangent");
            Assert.That((AxisAngle(laterAt) - AxisAngle(laterBefore)) / epsilon,
                Is.EqualTo(expectedAngularSpeed).Within(0.001), "later impulse incoming angular tangent");
            Assert.That((AxisAngle(laterAfter) - AxisAngle(laterAt)) / epsilon,
                Is.EqualTo(expectedAngularSpeed).Within(0.001), "later impulse outgoing angular tangent");

            foreach (var time in new[] { 0.00637, velocityPeakT - epsilon, velocityPeakT, velocityPeakT + epsilon, 0.01373 })
            {
                var actual = BatAt(noImpulse, time);
                var withLaterImpulse = BatAt(laterImpulse, time);
                foreach (var pose in new[] { actual, withLaterImpulse })
                {
                    Assert.That(pose.grip.x,
                        Is.EqualTo(-0.25 + progress(time, gripAcceleration)).Within(0.000000001),
                        "nonuniform quadratic grip at " + time);
                    Assert.That(AxisAngle(pose),
                        Is.EqualTo(5.0 * Math.PI / 180.0 + progress(time, angularAcceleration))
                            .Within(0.000000001),
                        "nonuniform quadratic angle at " + time);
                }
                // Phase-5b batAt (frame.ts): an impulse ends its knot run, so the 0.012 knot's Fornberg window is
                // truncated before the 0.020 impulse. Everything up to and including the peak is unchanged
                // bit-for-bit; the one segment after it moves by the window change, which the frozen TS batAt also
                // shows (grip.x at 0.011001: -0.23910802008999998 without, -0.23910801991053943 with the impulse).
                if (time <= velocityPeakT)
                    AssertBatNear(withLaterImpulse, actual, 0.000000000001,
                        "later impulse must preserve the incoming side of the earlier velocity peak at " + time);
            }
            Assert.That(BatAt(noImpulse, velocityPeakT + epsilon).grip.x,
                Is.EqualTo(-0.23910802008999998).Within(0.000000000001), "TS batAt reference without the impulse");
            Assert.That(BatAt(laterImpulse, velocityPeakT + epsilon).grip.x,
                Is.EqualTo(-0.23910801991053943).Within(0.000000000001), "TS batAt reference with the later impulse");
        }

        [Test]
        public void RigidBatInterpolation_SubPointOneMillisecondLaterImpulseDoesNotContaminateVelocityPeakTangent()
        {
            const double velocityPeakT = 0.011;
            const double impulseT = velocityPeakT + 0.000075;
            const double finishT = 0.022;
            const double gripAcceleration = 180.0;
            const double angularAcceleration = 220.0;
            Func<double, double, double> canonicalProgress = (time, acceleration) =>
            {
                if (time <= velocityPeakT) return 0.5 * acceleration * time * time;
                var after = time - velocityPeakT;
                return 0.5 * acceleration * velocityPeakT * velocityPeakT +
                       acceleration * velocityPeakT * after -
                       0.5 * acceleration * after * after;
            };
            Func<double, double> postProgress = time =>
            {
                var value = (time - impulseT) / (finishT - impulseT);
                var amount = Math.Max(0.0, Math.Min(1.0, value));
                return amount * amount * (3.0 - 2.0 * amount);
            };
            var gripAtImpulse = canonicalProgress(impulseT, gripAcceleration);
            var angleAtImpulse = canonicalProgress(impulseT, angularAcceleration);
            var times = new[]
            {
                0.0, 0.004, 0.008, velocityPeakT, impulseT, 0.012, 0.016, 0.020, finishT, 0.026
            };
            var samples = new BatTraceSample[times.Length];
            for (var index = 0; index < times.Length; index++)
            {
                var time = times[index];
                var afterImpulse = time > impulseT;
                var gripProgress = afterImpulse
                    ? gripAtImpulse + 0.003 * postProgress(time)
                    : canonicalProgress(time, gripAcceleration);
                var angle = afterImpulse
                    ? angleAtImpulse + 0.0035 * postProgress(time)
                    : canonicalProgress(time, angularAcceleration);
                samples[index] = RigidBat(
                    time,
                    -0.25 + gripProgress,
                    1.12,
                    9.08,
                    5.0 + angle * 180.0 / Math.PI);
            }

            var trace = RigidTrace(samples, impulseT, velocityPeakT);
            var metrics = DenseMotionMetrics(trace, impulseT);
            Assert.That(metrics.GripSpeed, Is.LessThanOrEqualTo(18.0));
            Assert.That(metrics.ToeSpeed, Is.LessThanOrEqualTo(30.0));
            Assert.That(metrics.AngularSpeed, Is.LessThanOrEqualTo(25.0));
            Assert.That(metrics.GripAcceleration, Is.LessThanOrEqualTo(200.0));
            Assert.That(metrics.ToeAcceleration, Is.LessThanOrEqualTo(400.0));
            Assert.That(metrics.AngularAcceleration, Is.LessThanOrEqualTo(250.0));
            foreach (var sample in samples)
            {
                AssertBatExactly(BatAt(trace, sample.t), sample);
            }
        }

        [Test]
        public void RigidBatInterpolation_KeepsOneSidedImpulseAndIgnoresLaterPlannedPeak()
        {
            const double impulseT = 0.010;
            const double laterPlannedT = 0.014;
            const double finishT = 0.020;
            var gripAtImpulse = 0.5 * 100.0 * impulseT * impulseT;
            var angleAtImpulse = 0.5 * 120.0 * impulseT * impulseT;
            var times = new[] { 0.0, 0.004, 0.008, impulseT, 0.012, laterPlannedT, 0.016, finishT, 0.024 };
            var samples = new BatTraceSample[times.Length];
            for (var index = 0; index < times.Length; index++)
            {
                var time = times[index];
                if (time <= impulseT)
                {
                    samples[index] = RigidBat(
                        time,
                        -0.2 + 0.5 * 100.0 * time * time,
                        1.1,
                        9.1,
                        0.5 * 120.0 * time * time * 180.0 / Math.PI);
                    continue;
                }

                var afterImpulse = Math.Min(time, finishT) - impulseT;
                var gripProgress = gripAtImpulse - 0.4 * afterImpulse +
                                   0.5 * 40.0 * afterImpulse * afterImpulse;
                var angle = angleAtImpulse - 0.6 * afterImpulse +
                            0.5 * 60.0 * afterImpulse * afterImpulse;
                samples[index] = RigidBat(
                    time,
                    -0.2 + gripProgress,
                    1.1,
                    9.1,
                    angle * 180.0 / Math.PI);
            }

            var trace = RigidTrace(samples, impulseT, laterPlannedT);
            var suppressedPeak = RigidTrace(samples, impulseT, impulseT);
            const double epsilon = 0.000001;
            var before = BatAt(trace, impulseT - epsilon);
            var at = BatAt(trace, impulseT);
            var after = BatAt(trace, impulseT + epsilon);
            Assert.That((at.grip.x - before.grip.x) / epsilon, Is.EqualTo(1.0).Within(0.001));
            Assert.That((after.grip.x - at.grip.x) / epsilon, Is.EqualTo(-0.4).Within(0.001));
            Assert.That((AxisAngle(at) - AxisAngle(before)) / epsilon, Is.EqualTo(1.2).Within(0.001));
            Assert.That((AxisAngle(after) - AxisAngle(at)) / epsilon, Is.EqualTo(-0.6).Within(0.001));

            for (var time = impulseT; time <= finishT + 0.000000000001; time += 0.0005)
            {
                AssertBatNear(BatAt(trace, time), BatAt(suppressedPeak, time), 0.000000000001,
                    "later planned peak must not create a second authority at " + time);
            }
        }

        [Test]
        public void RigidBatInterpolation_ComesToRestAtFirstHeldTailKnotWithoutOvershoot()
        {
            var finish = RigidBat(0.60, 0.28, 1.30, 8.82, 104.0);
            var trace = RigidTrace(new[]
            {
                RigidBat(0.00, -0.20, 1.10, 9.20, -30.0),
                RigidBat(0.20, -0.08, 1.32, 9.08, 5.0),
                RigidBat(0.40, 0.12, 1.12, 8.94, 55.0),
                finish,
                CloneBatAt(finish, 0.80),
                CloneBatAt(finish, 1.00)
            });
            trace.batterMotion.contactT = 0.40;
            trace.batterMotion.endT = 0.60;
            Assert.DoesNotThrow(() => CanonicalTraceValidator.Validate(trace));

            const double epsilon = 0.00001;
            var before = BatAt(trace, finish.t - epsilon);
            var atFinish = BatAt(trace, finish.t);
            var after = BatAt(trace, finish.t + epsilon);
            var translationSpeed = Distance(atFinish.grip, before.grip) / epsilon;
            var angularSpeed = Math.Abs(AxisAngle(atFinish) - AxisAngle(before)) / epsilon;
            Assert.That(translationSpeed, Is.LessThan(0.01), "translation must settle at motion.endT");
            Assert.That(angularSpeed, Is.LessThan(0.01), "rotation must settle at motion.endT");
            AssertBatExactly(atFinish, finish);
            AssertBatNear(after, atFinish, 0.000000000001, "first held interval");

            for (var step = 0; step <= 400; step++)
            {
                var sample = BatAt(trace, finish.t + step * 0.001);
                AssertBatNear(sample, atFinish, 0.00000000001, "held tail " + step);
            }
        }

        [Test]
        public void RigidBatInterpolation_RecognizesContactKnotWithinOnePicosecondTolerance()
        {
            var trace = RigidTrace(new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.65, 0.00, 1.10, 9.10, 5.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            }, 0.50 + BridgeConstants.ExactTraceTimeToleranceSeconds * 0.5);
            const double epsilon = 0.00001;

            var before = BatAt(trace, 0.50 - epsilon);
            var at = BatAt(trace, 0.50);
            var after = BatAt(trace, 0.50 + epsilon);
            var incoming = (at.grip.x - before.grip.x) / epsilon;
            var outgoing = (after.grip.x - at.grip.x) / epsilon;
            Assert.That(incoming, Is.GreaterThan(0.9));
            Assert.That(outgoing, Is.LessThan(-1.9));
        }

        [Test]
        public void Validation_RejectsAuthorityWithoutAKnotInsideOnePicosecondTolerance()
        {
            var trace = RigidTrace(new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.65, 0.00, 1.10, 9.10, 5.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            }, 0.35, 0.50 + BridgeConstants.ExactTraceTimeToleranceSeconds * 2.0);

            Assert.Throws<BridgeValidationException>(() => CanonicalTraceValidator.Validate(trace));
        }

        [Test]
        public void RigidBatInterpolation_DoesNotTreatBodyContactAsABatImpulse()
        {
            var trace = RigidTrace(new[]
            {
                RigidBat(0.20, 0.00, 1.10, 9.10, 0.0),
                RigidBat(0.35, 0.15, 1.10, 9.10, 15.0),
                RigidBat(0.50, 0.30, 1.10, 9.10, 30.0),
                RigidBat(0.65, 0.00, 1.10, 9.10, 5.0),
                RigidBat(0.80, -0.15, 1.10, 9.10, -10.0)
            }, 0.50);
            trace.events[1].contact = "body";
            const double epsilon = 0.00001;

            var before = BatAt(trace, 0.50 - epsilon);
            var at = BatAt(trace, 0.50);
            var after = BatAt(trace, 0.50 + epsilon);
            var incoming = (at.grip.x - before.grip.x) / epsilon;
            var outgoing = (after.grip.x - at.grip.x) / epsilon;
            Assert.That(outgoing, Is.EqualTo(incoming).Within(0.001));
        }

        [Test]
        public void RigidBatInterpolation_UsesDeterministicShortestArcAcrossQuaternionSigns()
        {
            var signEnd = RigidBat(0.8, 0.0, 1.1, 9.0, -170.0);
            var signCrossing = RigidTrace(new[]
            {
                RigidBat(0.2, 0.0, 1.1, 9.0, 170.0),
                signEnd,
                CloneBatAt(signEnd, 0.9),
                CloneBatAt(signEnd, 1.0)
            }, 0.9);
            var halfway = BatAt(signCrossing, 0.5);
            var signAxis = Axis(halfway);
            Assert.That(signAxis.x, Is.LessThan(-0.999999));
            Assert.That(Math.Abs(signAxis.y), Is.LessThan(0.000001));

            var tieEnd = RigidBat(0.8, 0.0, 1.1, 9.0, 180.0);
            var piTie = RigidTrace(new[]
            {
                RigidBat(0.2, 0.0, 1.1, 9.0, 0.0),
                tieEnd,
                CloneBatAt(tieEnd, 0.9),
                CloneBatAt(tieEnd, 1.0)
            }, 0.9);
            halfway = BatAt(piTie, 0.5);
            var tieAxis = Axis(halfway);
            Assert.That(Math.Abs(tieAxis.x), Is.LessThan(0.000001));
            Assert.That(tieAxis.y, Is.GreaterThan(0.999999));
        }

        [Test]
        public void HostResultAdapter_ProjectsAuthoritativeTraceWithoutScoring()
        {
            var envelope = new UnityPracticeEnvelope
            {
                contractVersion = BridgeConstants.ContractVersion,
                simVersion = BridgeConstants.SimulationVersion,
                buildId = "build-1",
                sessionId = "session-1",
                deliveryId = "delivery-1",
                messageId = "host-result-1",
                sequence = 7,
                sender = "host",
                type = "host.result",
                payloadJson = UnityPracticeContractTestFixture.ResultPayload()
            };

            var trace = UnityPracticeResultTraceAdapter.FromHostResult(envelope);

            Assert.That(trace.deliveryId, Is.EqualTo("delivery-1"));
            Assert.That(trace.ball.Length, Is.EqualTo(2));
            Assert.That(trace.ball[0].p.z, Is.EqualTo(-8));
            Assert.That(trace.batterRootOffset.x, Is.Zero);
            Assert.That(trace.batterRootOffset.z, Is.Zero);
            Assert.That(trace.batterPosture.crouchM, Is.Zero);
            Assert.That(trace.batterMotion, Is.Null);
            Assert.That(trace.bat, Is.Empty);
            Assert.That(trace.fielders.Length, Is.EqualTo(11));
            Assert.That(trace.events[1].kind, Is.EqualTo("dead"));
        }

        [TestCase(true)]
        [TestCase(false)]
        public void KeeperTakeShortM_IsParsedWhenPresentAndZeroWhenAbsent(bool present)
        {
            // Contract v6, additive (2026-11-04): keeper_take may carry shortM, only when the ball passed beyond his reach.
            var events = "[{\"kind\":\"release\",\"t\":0},{\"kind\":\"keeper_take\",\"p\":{\"x\":0.1,\"y\":0.6,\"z\":11}," +
                         (present ? "\"shortM\":0.42," : "") + "\"t\":0.05},{\"kind\":\"dead\",\"t\":0.1}]";
            var envelope = new UnityPracticeEnvelope
            {
                contractVersion = BridgeConstants.ContractVersion,
                simVersion = BridgeConstants.SimulationVersion,
                buildId = "build-1",
                sessionId = "session-1",
                deliveryId = "delivery-1",
                messageId = "host-result-1",
                sequence = 7,
                sender = "host",
                type = "host.result",
                payloadJson = UnityPracticeContractTestFixture.ResultPayload(events)
            };

            var trace = UnityPracticeResultTraceAdapter.FromHostResult(envelope);

            Assert.That(trace.events[1].kind, Is.EqualTo("keeper_take"));
            Assert.That(trace.events[1].shortM, Is.EqualTo(present ? 0.42 : 0.0).Within(1e-12));
        }

        private static CanonicalDeliveryTrace RigidTrace(
            BatTraceSample[] bat,
            double? impulseTime = null,
            double? velocityPeakTime = null)
        {
            var trace = CanonicalTraceTestFixture.Create();
            trace.bat = bat;
            trace.batterMotion = bat.Length == 0
                ? null
                : new TraceBatterMotion
                {
                    startT = bat[0].t,
                    contactT = velocityPeakTime ?? impulseTime ?? (bat.Length >= 3
                        ? bat[bat.Length / 2].t
                        : (bat[0].t + bat[bat.Length - 1].t) * 0.5),
                    endT = bat[bat.Length - 1].t
                };
            trace.events = impulseTime.HasValue
                ? new[]
                {
                    new CanonicalTraceEvent { t = 0.0, kind = "release" },
                    new CanonicalTraceEvent
                    {
                        t = impulseTime.Value,
                        kind = "contact",
                        contact = "middle",
                        p = Vector(0.1, 0.8, 9.0)
                    }
                }
                : new[] { new CanonicalTraceEvent { t = 0.0, kind = "release" } };
            return trace;
        }

        private static BatTraceSample RigidBat(
            double time,
            double gripX,
            double gripY,
            double gripZ,
            double angleDegrees)
        {
            const double length = 0.86;
            var angle = angleDegrees * Math.PI / 180.0;
            var axisX = Math.Cos(angle);
            var axisY = Math.Sin(angle);
            return new BatTraceSample
            {
                t = time,
                grip = Vector(gripX, gripY, gripZ),
                toe = Vector(gripX - axisX * length, gripY - axisY * length, gripZ),
                face = Vector(-axisY, axisX, 0.0)
            };
        }

        private static BatTraceSample CloneBatAt(BatTraceSample value, double time)
        {
            return new BatTraceSample
            {
                t = time,
                grip = Vector(value.grip.x, value.grip.y, value.grip.z),
                toe = Vector(value.toe.x, value.toe.y, value.toe.z),
                face = Vector(value.face.x, value.face.y, value.face.z)
            };
        }

        private static double Distance(TraceVector3 left, TraceVector3 right)
        {
            var x = left.x - right.x;
            var y = left.y - right.y;
            var z = left.z - right.z;
            return Math.Sqrt(x * x + y * y + z * z);
        }

        private static DenseBatMotionMetrics DenseMotionMetrics(
            CanonicalDeliveryTrace trace,
            double? impulseTime,
            double step = 0.00025)
        {
            var samples = trace.bat;
            var candidates = new List<double>();
            for (var index = 0; index < samples.Length; index++) candidates.Add(samples[index].t);
            var start = samples[0].t;
            var end = samples[samples.Length - 1].t;
            for (var time = start; time <= end + 0.000000000001; time += step)
                candidates.Add(Math.Min(time, end));
            candidates.Sort();

            var times = new List<double>();
            for (var index = 0; index < candidates.Count; index++)
            {
                var time = candidates[index];
                if (times.Count == 0 || time - times[times.Count - 1] > 0.0000000001)
                    times.Add(time);
            }

            var poses = new List<TimedBatPose>();
            for (var index = 0; index < times.Count; index++)
            {
                var time = times[index];
                poses.Add(new TimedBatPose { Time = time, Pose = BatAt(trace, time) });
            }

            var metrics = new DenseBatMotionMetrics();
            var intervals = new List<BatMotionInterval>();
            for (var index = 1; index < poses.Count; index++)
            {
                var before = poses[index - 1];
                var after = poses[index];
                var duration = after.Time - before.Time;
                var gripVelocity = Velocity(before.Pose.grip, after.Pose.grip, duration);
                var toeVelocity = Velocity(before.Pose.toe, after.Pose.toe, duration);
                var angleDelta = AxisAngle(after.Pose) - AxisAngle(before.Pose);
                var angularVelocity = Math.Atan2(Math.Sin(angleDelta), Math.Cos(angleDelta)) / duration;
                intervals.Add(new BatMotionInterval
                {
                    Start = before.Time,
                    End = after.Time,
                    GripVelocity = gripVelocity,
                    ToeVelocity = toeVelocity,
                    AngularVelocity = angularVelocity
                });
                metrics.GripSpeed = Math.Max(metrics.GripSpeed, Distance(gripVelocity, Vector(0.0, 0.0, 0.0)));
                metrics.ToeSpeed = Math.Max(metrics.ToeSpeed, Distance(toeVelocity, Vector(0.0, 0.0, 0.0)));
                metrics.AngularSpeed = Math.Max(metrics.AngularSpeed, Math.Abs(angularVelocity));
            }

            for (var index = 1; index < intervals.Count; index++)
            {
                var before = intervals[index - 1];
                var after = intervals[index];
                if (impulseTime.HasValue &&
                    before.End <= impulseTime.Value && after.Start >= impulseTime.Value)
                    continue;
                var duration = ((before.End - before.Start) + (after.End - after.Start)) * 0.5;
                metrics.GripAcceleration = Math.Max(
                    metrics.GripAcceleration,
                    Distance(after.GripVelocity, before.GripVelocity) / duration);
                metrics.ToeAcceleration = Math.Max(
                    metrics.ToeAcceleration,
                    Distance(after.ToeVelocity, before.ToeVelocity) / duration);
                metrics.AngularAcceleration = Math.Max(
                    metrics.AngularAcceleration,
                    Math.Abs(after.AngularVelocity - before.AngularVelocity) / duration);
            }

            return metrics;
        }

        private static TraceVector3 Velocity(TraceVector3 before, TraceVector3 after, double duration)
        {
            return Vector(
                (after.x - before.x) / duration,
                (after.y - before.y) / duration,
                (after.z - before.z) / duration);
        }

        private static BatTraceSample BatAt(CanonicalDeliveryTrace trace, double time)
        {
            var target = new RecordingTarget();
            var playback = new CanonicalTracePlayback(trace, target);
            playback.Seek(time);
            return target.Bat;
        }

        private static BatTraceSample AdvanceAtClock(CanonicalDeliveryTrace trace, double targetTime, double step)
        {
            var target = new RecordingTarget();
            var playback = new CanonicalTracePlayback(trace, target);
            var elapsed = 0.0;
            while (elapsed < targetTime)
            {
                var delta = Math.Min(step, targetTime - elapsed);
                playback.Advance(delta);
                elapsed += delta;
            }

            return target.Bat;
        }

        private static BatTraceSample AdvanceAtRandomClock(CanonicalDeliveryTrace trace, double targetTime, int seed)
        {
            var target = new RecordingTarget();
            var playback = new CanonicalTracePlayback(trace, target);
            var random = new System.Random(seed);
            var elapsed = 0.0;
            while (elapsed < targetTime)
            {
                var step = 0.001 + random.NextDouble() * 0.047;
                var delta = Math.Min(step, targetTime - elapsed);
                playback.Advance(delta);
                elapsed += delta;
            }

            return target.Bat;
        }

        private static TraceVector3 Axis(BatTraceSample value)
        {
            var x = value.grip.x - value.toe.x;
            var y = value.grip.y - value.toe.y;
            var z = value.grip.z - value.toe.z;
            var magnitude = Math.Sqrt(x * x + y * y + z * z);
            return Vector(x / magnitude, y / magnitude, z / magnitude);
        }

        private static double AxisAngle(BatTraceSample value)
        {
            var axis = Axis(value);
            return Math.Atan2(axis.y, axis.x);
        }

        private static void AssertRigidBat(BatTraceSample value, string context)
        {
            var axis = Axis(value);
            var spanX = value.grip.x - value.toe.x;
            var spanY = value.grip.y - value.toe.y;
            var spanZ = value.grip.z - value.toe.z;
            var length = Math.Sqrt(spanX * spanX + spanY * spanY + spanZ * spanZ);
            var faceLength = Math.Sqrt(
                value.face.x * value.face.x + value.face.y * value.face.y + value.face.z * value.face.z);
            var orthogonal = axis.x * value.face.x + axis.y * value.face.y + axis.z * value.face.z;
            Assert.That(length, Is.EqualTo(0.86).Within(0.000000000001), context + " length");
            Assert.That(faceLength, Is.EqualTo(1.0).Within(0.000000000001), context + " face norm");
            Assert.That(Math.Abs(orthogonal), Is.LessThan(0.000000000001), context + " orthogonal frame");
        }

        private static void AssertBatExactly(BatTraceSample actual, BatTraceSample expected)
        {
            Assert.That(actual.grip.x, Is.EqualTo(expected.grip.x));
            Assert.That(actual.grip.y, Is.EqualTo(expected.grip.y));
            Assert.That(actual.grip.z, Is.EqualTo(expected.grip.z));
            Assert.That(actual.toe.x, Is.EqualTo(expected.toe.x));
            Assert.That(actual.toe.y, Is.EqualTo(expected.toe.y));
            Assert.That(actual.toe.z, Is.EqualTo(expected.toe.z));
            Assert.That(actual.face.x, Is.EqualTo(expected.face.x));
            Assert.That(actual.face.y, Is.EqualTo(expected.face.y));
            Assert.That(actual.face.z, Is.EqualTo(expected.face.z));
        }

        private static void AssertBatNear(BatTraceSample actual, BatTraceSample expected, double tolerance, string context)
        {
            Assert.That(actual.grip.x, Is.EqualTo(expected.grip.x).Within(tolerance), context + " grip x");
            Assert.That(actual.grip.y, Is.EqualTo(expected.grip.y).Within(tolerance), context + " grip y");
            Assert.That(actual.grip.z, Is.EqualTo(expected.grip.z).Within(tolerance), context + " grip z");
            Assert.That(actual.toe.x, Is.EqualTo(expected.toe.x).Within(tolerance), context + " toe x");
            Assert.That(actual.toe.y, Is.EqualTo(expected.toe.y).Within(tolerance), context + " toe y");
            Assert.That(actual.toe.z, Is.EqualTo(expected.toe.z).Within(tolerance), context + " toe z");
            Assert.That(actual.face.x, Is.EqualTo(expected.face.x).Within(tolerance), context + " face x");
            Assert.That(actual.face.y, Is.EqualTo(expected.face.y).Within(tolerance), context + " face y");
            Assert.That(actual.face.z, Is.EqualTo(expected.face.z).Within(tolerance), context + " face z");
        }

        private static TraceVector3 Vector(double x, double y, double z)
        {
            return new TraceVector3 { x = x, y = y, z = z };
        }

        private sealed class TimedBatPose
        {
            public double Time;
            public BatTraceSample Pose;
        }

        private sealed class BatMotionInterval
        {
            public double Start;
            public double End;
            public TraceVector3 GripVelocity;
            public TraceVector3 ToeVelocity;
            public double AngularVelocity;
        }

        private sealed class DenseBatMotionMetrics
        {
            public double GripSpeed;
            public double ToeSpeed;
            public double AngularSpeed;
            public double GripAcceleration;
            public double ToeAcceleration;
            public double AngularAcceleration;
        }

        private sealed class RecordingTarget : ICanonicalTraceTarget
        {
            public readonly List<CanonicalTraceEvent> Events = new List<CanonicalTraceEvent>();
            public BallTraceSample Ball { get; private set; }
            public BatTraceSample Bat { get; private set; }
            public int BatUpdates { get; private set; }
            public bool Completed { get; private set; }

            public void SetBall(BallTraceSample sample)
            {
                Ball = sample;
            }

            public void SetBat(BatTraceSample sample)
            {
                Bat = sample;
                BatUpdates++;
            }

            public void SetFielder(string fielderId, FielderTraceSample sample)
            {
            }

            public void EmitEvent(CanonicalTraceEvent traceEvent)
            {
                Events.Add(traceEvent);
            }

            public void SetPlaybackCompleted(bool completed)
            {
                Completed = completed;
            }
        }
    }
}
