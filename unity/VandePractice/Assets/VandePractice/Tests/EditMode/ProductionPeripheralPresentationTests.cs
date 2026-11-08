using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Presentation;
using Vande.Practice.Trace;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Deterministic checks for the stable batting camera and peripheral live
    /// presentation. These tests verify retained geometry and state only; they
    /// do not certify human feel, accessibility or visual quality.
    /// </summary>
    public sealed class ProductionPeripheralPresentationTests
    {
        private GameObject owner;
        private ProductionHudView view;

        [SetUp]
        public void SetUp()
        {
            owner = new GameObject("Peripheral presentation test");
            view = owner.AddComponent<ProductionHudView>();
            view.SetViewportForTesting(844, 390, new Rect(0f, 0f, 844f, 390f), 160f);
            view.Configure(Settings());
            view.SetScene(Scene());
        }

        [TearDown]
        public void TearDown()
        {
            if (owner != null) Object.DestroyImmediate(owner);
        }

        [Test]
        public void DeliveryQuietMode_RetainsMandatoryRailAndDefersOutcome()
        {
            view.SetDelivery(0, 0);
            view.SetQuiet(true);
            view.SetOutcome(4, null);

            Assert.That(view.OutcomeVisible, Is.False);
            Assert.That(view.ScoreVisible, Is.True);
            Assert.That(view.FieldPipVisible, Is.True);
            Assert.That(view.PauseVisible, Is.True);

            view.SetQuiet(false);

            Assert.That(view.OutcomeVisible, Is.True);
            Assert.That(Find("Dead Ball Outcome").activeSelf, Is.True);
        }

        [Test]
        public void CausalCaption_TemporarilyOwnsThePeripheralOutcomeLane()
        {
            view.SetDelivery(0, 0);
            view.SetQuiet(true);
            view.SetOutcome(4, null);
            view.PresentCaption("Clean bat contact");

            view.SetQuiet(false);

            Assert.That(view.OutcomeVisible, Is.True);
            Assert.That(Find("Dead Ball Outcome").activeSelf, Is.False);
            Assert.That(Find("Accessibility Caption").activeSelf, Is.True);

            view.ClearCaption();

            Assert.That(Find("Accessibility Caption").activeSelf, Is.False);
            Assert.That(Find("Dead Ball Outcome").activeSelf, Is.True);
        }

        [TestCase(640, 360, 160f)]
        [TestCase(844, 390, 160f)]
        [TestCase(915, 412, 420f)]
        [TestCase(2400, 1080, 420f)]
        public void DeadBallAcknowledgement_StaysInSafeLowerLeftPeripheralLane(
            int width,
            int height,
            float dpi)
        {
            var safe = new Rect(0f, 0f, width, height);
            var layout = ProductionHudLayout.Calculate(width, height, safe, dpi, 2f);

            AssertInside(layout.Outcome, safe);
            Assert.That(layout.Outcome.xMax, Is.LessThanOrEqualTo(safe.center.x));
            Assert.That(layout.Outcome.yMax,
                Is.LessThanOrEqualTo(safe.yMin + safe.height * 0.22f + 0.001f),
                "dead-ball acknowledgement must stay below the live-ball reading corridor");
            Assert.That(layout.Outcome.Contains(safe.center), Is.False);
            Assert.That(layout.Outcome.Overlaps(layout.FieldPip), Is.False);
        }

        [Test]
        public void EveryDelivery_RestoresTheLearnedRearShoulderComposition()
        {
            var worldOwner = new GameObject("Rear shoulder stability test");
            try
            {
                var world = worldOwner.AddComponent<ProceduralPracticeWorld>();
                world.Configure(Settings(), new NullPracticeFeedbackSink());
                world.ConfigureScene(Scene());
                var camera = FindIn(worldOwner, "BatterEyeCamera").GetComponent<Camera>();
                var expectedPosition = camera.transform.position;
                var expectedRotation = camera.transform.rotation;

                camera.transform.SetPositionAndRotation(
                    expectedPosition + new Vector3(3f, 1f, -2f),
                    Quaternion.Euler(18f, 62f, 9f));
                world.BeginDelivery(Delivery());

                Assert.That(Vector3.Distance(camera.transform.position, expectedPosition),
                    Is.LessThan(0.0001f));
                Assert.That(Quaternion.Angle(camera.transform.rotation, expectedRotation),
                    Is.LessThan(0.001f));
            }
            finally
            {
                Object.DestroyImmediate(worldOwner);
            }
        }

        private GameObject Find(string name)
        {
            var transforms = owner.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < transforms.Length; index++)
                if (transforms[index].name == name) return transforms[index].gameObject;
            Assert.Fail("Missing retained HUD object: " + name);
            return null;
        }

        private static GameObject FindIn(GameObject root, string name)
        {
            var transforms = root.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < transforms.Length; index++)
                if (transforms[index].name == name) return transforms[index].gameObject;
            Assert.Fail("Missing presentation object: " + name);
            return null;
        }

        private static void AssertInside(Rect value, Rect container)
        {
            Assert.That(value.xMin, Is.GreaterThanOrEqualTo(container.xMin));
            Assert.That(value.yMin, Is.GreaterThanOrEqualTo(container.yMin));
            Assert.That(value.xMax, Is.LessThanOrEqualTo(container.xMax));
            Assert.That(value.yMax, Is.LessThanOrEqualTo(container.yMax));
        }

        private static PracticePresentationSettings Settings()
        {
            return new PracticePresentationSettings
            {
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard,
                Assistance = "play",
                Handedness = "right",
                ReducedMotion = false,
                Captions = true,
                Audio = true,
                Haptics = true
            };
        }

        private static PracticeScenePresentation Scene()
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
            {
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = "fielder-" + index,
                    Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder",
                    X = index - 5,
                    Z = index * 2
                };
            }

            return new PracticeScenePresentation
            {
                BallAge = "new",
                BallColour = "white",
                BatterCreaseOffsetM = 0,
                BatterLateralM = 0,
                BowlerArm = "right",
                BowlerFamily = "pace",
                BowlerPaceBand = "fast",
                Conditions = "balanced",
                Fielders = fielders,
                Handedness = "right"
            };
        }

        private static PracticeDeliveryPresentation Delivery()
        {
            return new PracticeDeliveryPresentation
            {
                Flight = new[]
                {
                    new BallTraceSample
                    {
                        t = 0,
                        p = Vector(0, 2, -8),
                        v = Vector(0, -1, 35)
                    },
                    new BallTraceSample
                    {
                        t = 1,
                        p = Vector(0, 0.4, 9),
                        v = Vector(0, 0, 20)
                    }
                },
                SeamAxis = Vector(0, 1, 0),
                ShineDirection = Vector(1, 0, 0),
                SpinAxis = Vector(0, 1, 0),
                SpinRps = 10
            };
        }

        private static TraceVector3 Vector(double x, double y, double z)
        {
            return new TraceVector3 { x = x, y = y, z = z };
        }

        private sealed class NullPracticeFeedbackSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
