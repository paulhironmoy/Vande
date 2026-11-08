using System;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace Vande.Practice.Tests
{
    public sealed class CanonicalPresentationAgreementEvidenceTests
    {
        private const string EvidenceTypeName =
            "Vande.Practice.Editor.Evidence.CanonicalPresentationAgreementEvidence, Assembly-CSharp-Editor";
        // Canonical grounded-attack/ref-3 event order in the practice-v3 golden regenerated on the phase-5b freeze
        // (payload a1f79a09…): the fielder now gathers and the ball is dead without a throw.
        private static readonly string[] GroundedAttackExpectedEventKinds =
        {
            "release",
            "bounce",
            "contact",
            "ball_bounce",
            "field",
            "dead"
        };

        [OneTimeSetUp]
        public void RequireAdvancedTextProjectSetting()
        {
            const string qualifiedName =
                "UnityEditor.UIElements.UIToolkitProjectSettings, UnityEditor.UIElementsModule";
            var settingsType = Type.GetType(qualifiedName, false);
            var property = settingsType?.GetProperty(
                "enableAdvancedText",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);

            Assert.That(property, Is.Not.Null,
                "The evidence fixture constructs the production HUD, which requires Unity 6 " +
                "Advanced Text to be configured explicitly in the test project.");
            Assert.That(property.PropertyType, Is.EqualTo(typeof(bool)));

            if (!(bool)property.GetValue(null)) property.SetValue(null, true);

            Assert.That((bool)property.GetValue(null), Is.True,
                "Unity 6 Advanced Text must be enabled before production HUD evidence is generated.");
        }

        [Test]
        public void FrozenGroundedAttack_ReportIsDeterministicAndBoundToExactIdentities()
        {
            RequireFrozenPracticeV3Fixture();
            var first = Generate();
            var second = Generate();

            Assert.That(second, Is.EqualTo(first));
            StringAssert.Contains("\"classification\": \"DIAGNOSTIC_NON_HUMAN\"", first);
            StringAssert.Contains("\"certification\": \"NOT_PERFORMED\"", first);
            StringAssert.Contains("\"fixtureCaseId\": \"grounded-attack\"", first);
            StringAssert.Contains("\"referenceBallId\": \"ref-3\"", first);
            StringAssert.Contains("\"deliveryId\": \"golden-grounded-attack\"", first);
            StringAssert.Contains("\"sessionId\": \"golden-session-grounded-attack\"", first);
            StringAssert.DoesNotContain("PENDING_PRACTICE_V3_REGENERATION", first);
        }

        [Test]
        public void FrozenGroundedAttack_ReportMeasuresPresentationAndMarksLiveFrameGapsUnavailable()
        {
            RequireFrozenPracticeV3Fixture();
            var json = Generate();
            var report = JsonUtility.FromJson<ReportProbe>(json);

            Assert.That(report, Is.Not.Null);
            Assert.That(report.release.distanceMetres, Is.LessThanOrEqualTo(0.05));
            Assert.That(report.batContact.gripErrorMetres, Is.LessThanOrEqualTo(0.03));
            Assert.That(report.batContact.toeErrorMetres, Is.LessThanOrEqualTo(0.03));
            Assert.That(report.batContact.faceErrorDegrees, Is.LessThanOrEqualTo(5.0));
            Assert.That(report.result.applyCount, Is.EqualTo(1));
            Assert.That(report.result.appliedAfterDead, Is.True);
            Assert.That(report.result.outcomeText, Is.EqualTo("DOT"));
            Assert.That(report.eventsArray,
                Has.Length.EqualTo(GroundedAttackExpectedEventKinds.Length));
            for (var index = 0; index < GroundedAttackExpectedEventKinds.Length; index++)
            {
                Assert.That(report.eventsArray[index].kind,
                    Is.EqualTo(GroundedAttackExpectedEventKinds[index]),
                    "Canonical grounded-attack event kind at index " + index);
            }
            Assert.That(report.fieldArray, Has.Length.EqualTo(11));
            Assert.That(report.ballSamplesArray, Has.Length.EqualTo(5));
            Assert.That(Status(report, "event_order_once"), Is.EqualTo("PASS"));
            Assert.That(Status(report, "field_and_pip_canonical_agreement"), Is.EqualTo("PASS"));
            Assert.That(Status(report, "world_completion_to_hud_result_once"), Is.EqualTo("PASS"));
            Assert.That(Status(report, "flight_screen_space_tolerance"), Is.EqualTo("NOT_AVAILABLE"));
            Assert.That(Status(report, "bounce_rendered_frame_delta"), Is.EqualTo("NOT_AVAILABLE"));
            Assert.That(Status(report, "runtime_score_commit_after_presented_frame"),
                Is.EqualTo("NOT_AVAILABLE"));
            Assert.That(Status(report, "audio_haptic_schedule_delta_ms"), Is.EqualTo("NOT_AVAILABLE"));
        }

        private static string Generate()
        {
            var type = Type.GetType(EvidenceTypeName, true);
            var method = type.GetMethod(
                "GenerateForTests",
                BindingFlags.Public | BindingFlags.Static);
            Assert.That(method, Is.Not.Null);
            return (string)method.Invoke(null, new object[]
            {
                "test-build-id",
                "2026-10-30T00:00:00.0000000Z",
                "test uptime; load averages: 1.00 1.00 1.00"
            });
        }

        private static void RequireFrozenPracticeV3Fixture()
        {
            var type = Type.GetType(EvidenceTypeName, true);
            var property = type.GetProperty(
                "FixtureIdentityFrozen",
                BindingFlags.Public | BindingFlags.Static);
            Assert.That(property, Is.Not.Null);
            if (!(bool)property.GetValue(null))
            {
                Assert.Ignore(
                    "Shared practice-v3 fixture identities are pending physics/generator freeze; " +
                    "the evidence harness must not reuse practice-v2 hashes.");
            }
        }

        private static string Status(ReportProbe report, string id)
        {
            foreach (var metric in report.metricsArray)
            {
                if (metric.id == id) return metric.status;
            }
            Assert.Fail("Missing metric: " + id);
            return null;
        }

        [Serializable]
        private sealed class ReportProbe
        {
            public ReleaseProbe release;
            public BatProbe batContact;
            public ResultProbe result;
            public MetricProbe[] metricsArray;
            public EventProbe[] eventsArray;
            public FieldProbe[] fieldArray;
            public BallProbe[] ballSamplesArray;
        }

        [Serializable] private sealed class ReleaseProbe { public double distanceMetres; }
        [Serializable] private sealed class BatProbe
        {
            public double gripErrorMetres;
            public double toeErrorMetres;
            public double faceErrorDegrees;
        }
        [Serializable] private sealed class ResultProbe
        {
            public int applyCount;
            public bool appliedAfterDead;
            public string outcomeText;
        }
        [Serializable] private sealed class MetricProbe { public string id; public string status; }
        [Serializable] private sealed class EventProbe { public string kind; }
        [Serializable] private sealed class FieldProbe { public string id; }
        [Serializable] private sealed class BallProbe { public string name; }
    }
}
