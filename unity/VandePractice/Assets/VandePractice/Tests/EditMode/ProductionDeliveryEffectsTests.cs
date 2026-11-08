using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Effects;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    public sealed class ProductionDeliveryEffectsTests
    {
        private GameObject host;
        private ProductionDeliveryEffects effects;

        [SetUp]
        public void SetUp()
        {
            host = new GameObject("ProductionDeliveryEffects-TestHost");
            effects = ProductionDeliveryEffects.Create(
                host.transform, PracticePresentationQuality.Standard, false);
        }

        [TearDown]
        public void TearDown()
        {
            if (effects != null && !effects.IsDisposed) effects.Dispose();
            if (host != null) UnityEngine.Object.DestroyImmediate(host);
        }

        [Test]
        public void Policy_SeparatesPredictionLandingAndFocus_WithReleaseAndResetGates()
        {
            effects.BeginDelivery(
                Flight(30),
                ProductionDeliveryEffectsPolicy.LearnLandingOnly);
            SetBallPose(new Vector3(0f, 1f, -2f));

            Assert.That(effects.GuidanceVisible, Is.False);
            Assert.That(effects.LandingVisible, Is.False);
            Assert.That(effects.FocusVisible, Is.False);
            Assert.That(effects.ReadabilityVisible, Is.False,
                "the intrinsic outline may not pre-reveal before the release latch");

            effects.MarkReleased();
            Assert.That(effects.GuidanceVisible, Is.False,
                "ordinary Learn may not reveal a predicted trajectory");
            Assert.That(effects.LandingVisible, Is.True);
            Assert.That(effects.FocusVisible, Is.False,
                "focus remains off without a truthful host setting");
            Assert.That(effects.ReadabilityVisible, Is.True,
                "intrinsic ball readability is independent of optional coaching focus");

            Assert.That(effects.HandleEvent(Event(0.3, "bounce", null)), Is.True);
            Assert.That(effects.LandingVisible, Is.False,
                "the landing cue leaves once the authoritative pitch event occurs");

            effects.ResetDelivery();
            effects.BeginDelivery(
                Flight(30),
                new ProductionDeliveryEffectsPolicy(true, false, true));
            SetBallPose(Vector3.one);
            Assert.That(effects.GuidanceVisible, Is.False);
            Assert.That(effects.LandingVisible, Is.False);
            Assert.That(effects.FocusVisible, Is.False,
                "every independently permitted aid remains release-gated");
            effects.MarkReleased();
            Assert.That(effects.GuidanceVisible, Is.True);
            Assert.That(effects.LandingVisible, Is.False);
            Assert.That(effects.FocusVisible, Is.True);

            effects.ResetDelivery();
            effects.BeginDelivery(Flight(30), ProductionDeliveryEffectsPolicy.None);
            SetBallPose(Vector3.one);
            effects.MarkReleased();
            Assert.That(effects.GuidanceVisible, Is.False);
            Assert.That(effects.LandingVisible, Is.False);
            Assert.That(effects.FocusVisible, Is.False);
        }

        [Test]
        public void CompatibilityGuidanceOverload_DoesNotInventFocusPermission()
        {
            effects.BeginDelivery(Flight(30), true);
            SetBallPose(Vector3.one);
            effects.MarkReleased();

            Assert.That(effects.GuidanceVisible, Is.True);
            Assert.That(effects.LandingVisible, Is.True);
            Assert.That(effects.FocusVisible, Is.False,
                "the old combined guide switch must not silently opt into focus");
        }

        [Test]
        public void Quality_CapsPreparedPathsAndResponses_AndCannotChangeInFlight()
        {
            effects.ApplyProfile(PracticePresentationQuality.Lite, false);
            effects.BeginDelivery(Flight(100), true);
            effects.SetResolvedPath(Flight(100), false);

            Assert.That(effects.PredictedPointCap, Is.EqualTo(12));
            Assert.That(effects.ActualPointCap, Is.EqualTo(24));
            Assert.That(effects.ResponseCapacity, Is.EqualTo(2));
            Assert.That(effects.PredictedPreparedPointCount, Is.EqualTo(12));
            Assert.That(effects.ActualPreparedPointCount, Is.EqualTo(24));
            Assert.Throws<InvalidOperationException>(() => effects.BeginDelivery(Flight(2), false));
            Assert.Throws<InvalidOperationException>(() =>
                effects.ApplyProfile(PracticePresentationQuality.High, false));

            effects.MarkDead();
            effects.ApplyProfile(PracticePresentationQuality.High, true);
            Assert.That(effects.PredictedPointCap, Is.EqualTo(28));
            Assert.That(effects.ActualPointCap, Is.EqualTo(72));
            Assert.That(effects.ResponseCapacity, Is.EqualTo(6));
            Assert.That(effects.ResponseMotionEnabled, Is.False);
        }

        [Test]
        public void ResolvedPath_RevealsOnlyTravelledSamplesAfterContact_OrDuringReplay()
        {
            var flight = Flight(10);
            effects.BeginDelivery(flight, false);
            effects.SetResolvedPath(flight, false);
            effects.MarkReleased();
            effects.SetPlaybackTime(0.7);

            Assert.That(effects.ActualTrailVisible, Is.False,
                "a resolved packet must not leak future consequence before contact");

            Assert.That(effects.HandleEvent(Event(0.4, "contact", "middle")), Is.True);
            var actual = effects.Root.transform.Find("ResolvedActualPath").GetComponent<LineRenderer>();
            Assert.That(effects.ActualTrailVisible, Is.True);
            Assert.That(actual.positionCount, Is.EqualTo(4));
            Assert.That(actual.GetPosition(actual.positionCount - 1).z, Is.EqualTo(-7f).Within(0.001f),
                "only samples through the current playback time are visible");

            effects.SetPlaybackTime(0.5);
            Assert.That(actual.positionCount, Is.EqualTo(2),
                "backward replay seeks deterministically retract the trail");

            effects.ResetDelivery();
            effects.BeginDelivery(
                flight,
                new ProductionDeliveryEffectsPolicy(true, true, true));
            SetBallPose(Vector3.one);
            effects.MarkReleased();
            Assert.That(effects.GuidanceVisible, Is.True);
            Assert.That(effects.LandingVisible, Is.True);
            Assert.That(effects.FocusVisible, Is.True);
            effects.SetResolvedPath(flight, true);
            Assert.That(effects.ReadabilityVisible, Is.False,
                "replay waits for its first current authoritative pose instead of showing stale live state");
            SetBallPose(new Vector3(0f, 1f, -1f));
            effects.SetPlaybackTime(0.31);
            Assert.That(effects.ActualTrailVisible, Is.True);
            Assert.That(effects.ActualVisiblePointCount, Is.EqualTo(4));
            Assert.That(effects.GuidanceVisible, Is.False);
            Assert.That(effects.LandingVisible, Is.False);
            Assert.That(effects.FocusVisible, Is.False,
                "replay suppresses every live-delivery guidance channel");
            Assert.That(effects.ReadabilityVisible, Is.True,
                "authoritative replay retains the same intrinsic ball readability");
        }

        [TestCaseSource(nameof(ReadabilityMatrixCases))]
        public void IntrinsicReadability_MeetsProjectionFloorAcrossViewportHandAndTierMatrix(
            int width,
            int height,
            float mirror,
            PracticePresentationQuality quality)
        {
            effects.ApplyProfile(quality, false);
            var flight = ReadabilityReferenceFlight();
            var retainedFutureX = flight[flight.Length - 1].p.x;
            var retainedFutureY = flight[flight.Length - 1].p.y;
            var retainedFutureZ = flight[flight.Length - 1].p.z;
            effects.BeginDelivery(
                flight,
                ProductionDeliveryEffectsPolicy.None,
                mirror);

            var cameraPosition = ProceduralPracticeWorld.BatterCameraPosition(0f, 0f, mirror);
            var cameraTarget = ProceduralPracticeWorld.BatterCameraTarget(0f);
            var cameraRotation = Quaternion.LookRotation(
                cameraTarget - cameraPosition,
                Vector3.up);
            var aspect = width / (float)height;
            var verticalFov = ProceduralPracticeWorld.VerticalFovForHorizontal(
                ProceduralPracticeWorld.TargetHorizontalFovDegrees,
                aspect);
            var samples = RequiredReadabilitySamples(flight, mirror);
            var readability = effects.Root.transform.Find(
                "AuthoritativeBallReadabilitySilhouette");
            var outer = readability.Find("DarkOuterEdge").GetComponent<LineRenderer>();
            var inner = readability.Find("IvoryInnerEdge").GetComponent<LineRenderer>();

            Assert.That(readability.gameObject.activeSelf, Is.False,
                "accepting a complete future flight must not pre-position or reveal the silhouette");
            Assert.That(readability.position, Is.EqualTo(Vector3.zero),
                "future trace samples may not move the current-ball silhouette");
            effects.SetBallPose(
                samples[0], cameraPosition, cameraRotation, verticalFov, height);
            Assert.That(effects.ReadabilityVisible, Is.False,
                "supplying a pose before the explicit release latch must remain invisible");

            effects.MarkReleased();
            for (var index = 0; index < samples.Length; index++)
            {
                effects.SetBallPose(
                    samples[index], cameraPosition, cameraRotation, verticalFov, height);
                Assert.That(effects.ReadabilityVisible, Is.True, "sample " + index);
                Assert.That(readability.position, Is.EqualTo(samples[index]),
                    "the outline may follow only the current authoritative pose");
                var depth = Vector3.Dot(
                    samples[index] - cameraPosition,
                    cameraRotation * Vector3.forward);
                var worldUnitsPerPixel = 2f * depth * Mathf.Tan(
                    verticalFov * Mathf.Deg2Rad * 0.5f) / height;
                var outerGeometryPixels =
                    (2f * outer.GetPosition(0).magnitude + outer.startWidth) /
                    worldUnitsPerPixel;
                var innerGeometryPixels =
                    (2f * inner.GetPosition(0).magnitude + inner.startWidth) /
                    worldUnitsPerPixel;
                Assert.That(
                    outerGeometryPixels,
                    Is.GreaterThanOrEqualTo(
                        ProductionDeliveryEffects.MinimumReadabilityDiameterPixels - 0.001f),
                    "dark geometry sample " + index + " at " + width + "x" + height);
                Assert.That(
                    innerGeometryPixels,
                    Is.GreaterThanOrEqualTo(
                        ProductionDeliveryEffects.MinimumReadabilityDiameterPixels - 0.001f),
                    "light geometry sample " + index + " at " + width + "x" + height);
                Assert.That(
                    effects.ReadabilityProjectedDiameterPixels,
                    Is.EqualTo(outerGeometryPixels).Within(0.001f),
                    "the diagnostic projection must report the independently inspected outer geometry");
            }

            Assert.That(effects.GuidanceVisible, Is.False,
                "intrinsic readability must not expose a predicted path");
            Assert.That(effects.LandingVisible, Is.False,
                "intrinsic readability must not invent a landing aid");
            Assert.That(effects.FocusVisible, Is.False,
                "intrinsic readability must not opt into coaching focus");
            Assert.That(effects.Root.GetComponentsInChildren<Collider>(true), Is.Empty);
            Assert.That(flight[flight.Length - 1].p.x, Is.EqualTo(retainedFutureX));
            Assert.That(flight[flight.Length - 1].p.y, Is.EqualTo(retainedFutureY));
            Assert.That(flight[flight.Length - 1].p.z, Is.EqualTo(retainedFutureZ));
        }

        [Test]
        public void IntrinsicReadability_IsTierInvariantAndUnaffectedByReducedMotion()
        {
            float expectedRadius = -1f;
            float expectedDiameter = -1f;
            float expectedOuterWidth = -1f;
            float expectedInnerWidth = -1f;
            Color expectedOuterColour = default;
            Color expectedInnerColour = default;

            foreach (var quality in new[]
                     {
                         PracticePresentationQuality.Lite,
                         PracticePresentationQuality.Standard,
                         PracticePresentationQuality.High
                     })
            {
                effects.ApplyProfile(quality, quality == PracticePresentationQuality.Standard);
                effects.BeginDelivery(Flight(12), ProductionDeliveryEffectsPolicy.None);
                SetBallPose(Vector3.one);
                effects.MarkReleased();

                var readability = effects.Root.transform.Find(
                    "AuthoritativeBallReadabilitySilhouette");
                var outer = readability.Find("DarkOuterEdge").GetComponent<LineRenderer>();
                var inner = readability.Find("IvoryInnerEdge").GetComponent<LineRenderer>();
                Assert.That(outer.positionCount, Is.EqualTo(24));
                Assert.That(inner.positionCount, Is.EqualTo(24));
                Assert.That(outer.startColor.grayscale, Is.LessThan(0.05f));
                Assert.That(inner.startColor.grayscale, Is.GreaterThan(0.8f));
                Assert.That(outer.startColor.a, Is.InRange(0.6f, 0.85f));
                Assert.That(inner.startColor.a, Is.InRange(0.5f, 0.75f));
                Assert.That(inner.sortingOrder, Is.GreaterThan(outer.sortingOrder));

                if (expectedRadius < 0f)
                {
                    expectedRadius = effects.ReadabilityWorldRadius;
                    expectedDiameter = effects.ReadabilityProjectedDiameterPixels;
                    expectedOuterWidth = outer.startWidth;
                    expectedInnerWidth = inner.startWidth;
                    expectedOuterColour = outer.startColor;
                    expectedInnerColour = inner.startColor;
                }
                else
                {
                    Assert.That(effects.ReadabilityWorldRadius,
                        Is.EqualTo(expectedRadius).Within(0.000001f));
                    Assert.That(effects.ReadabilityProjectedDiameterPixels,
                        Is.EqualTo(expectedDiameter).Within(0.000001f));
                    Assert.That(outer.startWidth,
                        Is.EqualTo(expectedOuterWidth).Within(0.000001f));
                    Assert.That(inner.startWidth,
                        Is.EqualTo(expectedInnerWidth).Within(0.000001f));
                    Assert.That(outer.startColor, Is.EqualTo(expectedOuterColour));
                    Assert.That(inner.startColor, Is.EqualTo(expectedInnerColour));
                }

                effects.MarkDead();
                Assert.That(effects.ReadabilityVisible, Is.False);
                effects.ResetDelivery();
            }
        }

        [Test]
        public void IntrinsicReadability_DoesNotMutateLawScaleBallPhysicsOrColliders()
        {
            var ball = ProductionCricketProps.CreateBall(
                host.transform,
                "ReadabilityAuthorityBall",
                ProductionPropQuality.Standard,
                false);
            try
            {
                var body = ball.Root.transform.Find("ShineOrientation/LawScaleBallBody");
                var originalScale = ball.Root.transform.localScale;
                var originalBounds = body.GetComponent<MeshFilter>().sharedMesh.bounds;
                var position = new Vector3(0.12f, 2.05f, -8.69f);
                ball.Root.transform.position = position;

                effects.BeginDelivery(Flight(12), ProductionDeliveryEffectsPolicy.None);
                effects.SetBallPose(
                    position,
                    new Vector3(1.25f, 1.66f, 14.4f),
                    Quaternion.LookRotation(
                        new Vector3(0f, 1.10f, -8.69f) -
                        new Vector3(1.25f, 1.66f, 14.4f),
                        Vector3.up),
                    ProceduralPracticeWorld.VerticalFovForHorizontal(
                        ProceduralPracticeWorld.TargetHorizontalFovDegrees,
                        16f / 9f),
                    360);
                effects.MarkReleased();

                Assert.That(ball.Radius,
                    Is.EqualTo(CricketPropDimensions.BallRadius).Within(0.000001f));
                Assert.That(ball.Root.transform.localScale, Is.EqualTo(originalScale));
                Assert.That(body.GetComponent<MeshFilter>().sharedMesh.bounds, Is.EqualTo(originalBounds));
                Assert.That(ball.Root.GetComponentsInChildren<Collider>(true), Is.Empty);
                Assert.That(effects.Root.GetComponentsInChildren<Collider>(true), Is.Empty);
                Assert.That(effects.Root.transform.Find(
                    "AuthoritativeBallReadabilitySilhouette").position,
                    Is.EqualTo(position));
            }
            finally
            {
                ball.Dispose();
            }
        }

        [Test]
        public void CausalEvents_AreDeduplicatedAndBoundedWithoutInventingMissFeedback()
        {
            effects.ApplyProfile(PracticePresentationQuality.Lite, false);
            effects.BeginDelivery(Flight(10), false);

            var first = Event(0.2, "bounce", null);
            Assert.That(effects.HandleEvent(first), Is.True);
            Assert.That(effects.HandleEvent(first), Is.False);
            Assert.That(effects.EventResponseCount, Is.EqualTo(1));

            Assert.That(effects.HandleEvent(Event(0.3, "field", null, "fielder-2")), Is.True);
            Assert.That(effects.HandleEvent(Event(0.4, "stumps", null)), Is.True);
            Assert.That(effects.ActiveResponseCount, Is.EqualTo(2),
                "the lite tier deterministically reuses its bounded two-response pool");
            Assert.That(effects.EventResponseCount, Is.EqualTo(3));
            Assert.That(effects.LastResponseKind, Is.EqualTo(ProductionDeliveryResponseKind.Wicket));

            Assert.That(effects.HandleEvent(Event(0.5, "contact", "leave")), Is.False);
            Assert.That(effects.HandleEvent(new CanonicalTraceEvent
            {
                t = 0.6,
                kind = "run",
                completed = 1
            }), Is.False);
            Assert.That(effects.EventResponseCount, Is.EqualTo(3));
        }

        [Test]
        public void ReducedMotion_KeepsCausalMarkStaticThenCleansItUp()
        {
            effects.ApplyProfile(PracticePresentationQuality.Standard, true);
            effects.BeginDelivery(
                Flight(10),
                ProductionDeliveryEffectsPolicy.LearnLandingOnly);
            SetBallPose(Vector3.one);
            effects.MarkReleased();
            Assert.That(effects.GuidanceVisible, Is.False);
            Assert.That(effects.LandingVisible, Is.True,
                "Reduced Motion preserves the explicitly permitted static landing cue");
            Assert.That(effects.FocusVisible, Is.False);
            Assert.That(effects.HandleEvent(Event(0.2, "bounce", null)), Is.True);

            var response = effects.Root.transform.Find("CausalResponses/CausalResponse-0");
            var before = response.localScale;
            effects.Tick(0.08f);
            Assert.That(response.localScale, Is.EqualTo(before),
                "Reduced Motion keeps the causal marker static");
            effects.Tick(0.12f);
            Assert.That(response.gameObject.activeSelf, Is.False);
        }

        [Test]
        public void ResetAndDispose_RemoveEveryDynamicStateAndOwnedObject()
        {
            var source = Flight(20);
            var sourceLastX = source[source.Length - 1].p.x;
            effects.BeginDelivery(source, true, -1f);
            effects.SetResolvedPath(Flight(20), false);
            SetBallPose(new Vector3(2f, 1f, 0f));
            effects.MarkReleased();
            effects.SetPlaybackTime(1.2);
            effects.HandleEvent(Event(0.5, "contact", "outside_edge"));

            var predicted = effects.Root.transform.Find("AllowedPostReleaseGuidance")
                .GetComponent<LineRenderer>();
            Assert.That(predicted.GetPosition(predicted.positionCount - 1).x,
                Is.EqualTo((float)-sourceLastX).Within(0.0001f),
                "handedness mirrors the host coordinate exactly once");
            Assert.That(source[source.Length - 1].p.x, Is.EqualTo(sourceLastX),
                "drawing must never mutate the authoritative trace");
            Assert.That(effects.ActiveResponseCount, Is.GreaterThan(0));
            Assert.That(effects.Root.GetComponentsInChildren<Collider>(true), Is.Empty,
                "visual effects never introduce a collision authority");

            effects.ResetDelivery();
            Assert.That(effects.IsDeliveryActive, Is.False);
            Assert.That(effects.GuidanceVisible, Is.False);
            Assert.That(effects.LandingVisible, Is.False);
            Assert.That(effects.FocusVisible, Is.False);
            Assert.That(effects.ReadabilityVisible, Is.False);
            Assert.That(effects.ActualTrailVisible, Is.False);
            Assert.That(effects.ActiveResponseCount, Is.Zero);
            Assert.That(effects.PredictedPreparedPointCount, Is.Zero);
            Assert.That(effects.ActualPreparedPointCount, Is.Zero);
            Assert.That(effects.EventResponseCount, Is.Zero);

            effects.Dispose();
            Assert.That(effects.IsDisposed, Is.True);
            Assert.That(host.transform.childCount, Is.Zero);
            Assert.Throws<ObjectDisposedException>(() => effects.Tick(0.01f));
        }

        private static IEnumerable<TestCaseData> ReadabilityMatrixCases()
        {
            var viewports = new[]
            {
                new Vector2Int(640, 360),
                new Vector2Int(844, 390),
                new Vector2Int(915, 412),
                new Vector2Int(1280, 800),
                new Vector2Int(1920, 1080)
            };
            var qualities = new[]
            {
                PracticePresentationQuality.Lite,
                PracticePresentationQuality.Standard,
                PracticePresentationQuality.High
            };
            foreach (var viewport in viewports)
            foreach (var mirror in new[] { 1f, -1f })
            foreach (var quality in qualities)
                yield return new TestCaseData(
                        viewport.x,
                        viewport.y,
                        mirror,
                        quality)
                    .SetName(
                        "IntrinsicReadability_" + viewport.x + "x" + viewport.y + "_" +
                        (mirror > 0f ? "Right" : "Left") + "_" + quality);
        }

        private static BallTraceSample[] ReadabilityReferenceFlight()
        {
            return new[]
            {
                new BallTraceSample
                {
                    t = 0.0,
                    p = Vector(0.0, 2.05, -8.69),
                    v = Vector(0.08, -3.8, 38.3)
                },
                new BallTraceSample
                {
                    t = 0.44,
                    p = Vector(0.03, 0.55, 4.25),
                    v = Vector(0.09, -2.5, 31.5)
                },
                new BallTraceSample
                {
                    t = 0.50,
                    p = Vector(0.04, 0.18, 5.40),
                    v = Vector(0.10, 2.2, 31.0)
                },
                new BallTraceSample
                {
                    t = 0.66,
                    p = Vector(0.08, 0.73, 9.10),
                    v = Vector(0.20, 1.4, 25.0)
                }
            };
        }

        private static Vector3[] RequiredReadabilitySamples(
            BallTraceSample[] flight,
            float mirror)
        {
            return new[]
            {
                ToPresentation(flight[0].p, mirror),
                ToPresentation(flight[2].p, mirror),
                ToPresentation(flight[1].p, mirror)
            };
        }

        private static Vector3 ToPresentation(TraceVector3 value, float mirror)
        {
            return new Vector3(
                mirror * (float)value.x,
                (float)value.y,
                (float)value.z);
        }

        private static BallTraceSample[] Flight(int count)
        {
            var samples = new BallTraceSample[count];
            for (var index = 0; index < count; index++)
            {
                var time = index * 0.1;
                var descending = index < count / 2;
                samples[index] = new BallTraceSample
                {
                    t = time,
                    p = Vector(index * 0.05, 1.4 - index * 0.04, -index),
                    v = Vector(0.5, descending ? -2.0 : 1.0, -10.0)
                };
            }
            return samples;
        }

        private void SetBallPose(Vector3 position)
        {
            effects.SetBallPose(
                position,
                new Vector3(0f, 1f, -10f),
                Quaternion.identity,
                60f,
                360);
        }

        private static CanonicalTraceEvent Event(
            double time,
            string kind,
            string contact,
            string fielderId = null)
        {
            return new CanonicalTraceEvent
            {
                t = time,
                kind = kind,
                contact = contact,
                fielderId = fielderId,
                p = Vector(0.25, 0.1, -3.0),
                runs = kind == "boundary" ? 4 : 0
            };
        }

        private static TraceVector3 Vector(double x, double y, double z)
        {
            return new TraceVector3 { x = x, y = y, z = z };
        }
    }
}
