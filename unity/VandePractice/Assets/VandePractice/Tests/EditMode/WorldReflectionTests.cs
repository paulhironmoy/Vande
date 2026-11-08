using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Presentation;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Owner ruling 2026-11-04 (option A, MOTION-SPEC section 3): the physics frame is right-handed with +x towards the
    /// striker's off side; Unity is left-handed and its rear camera looks down -z, so screen right is world -x. A
    /// right-hander's world is reflected (x -> -x) so his off side is on screen right; a left-hander keeps x. The
    /// rear camera stays physically on the striker's off side. The view used to be a mirror image (the owner's "bat
    /// held the wrong way").
    /// </summary>
    public sealed class WorldReflectionTests
    {
        private GameObject root;

        [TearDown]
        public void TearDown()
        {
            if (root != null) Object.DestroyImmediate(root);
        }

        [Test]
        public void ReflectionSign_IsMinusOneForRightHandersAndOneForLeftHanders()
        {
            Assert.That(ProceduralPracticeWorld.WorldReflectionFor("right"), Is.EqualTo(-1f));
            Assert.That(ProceduralPracticeWorld.WorldReflectionFor("left"), Is.EqualTo(1f));
        }

        [TestCase("right")]
        [TestCase("left")]
        public void OffSideFieldAndRearCamera_AreOnTheStrikersOffSideOfTheScreen(string handedness)
        {
            root = new GameObject("WorldReflection-" + handedness);
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = handedness,
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new Silent());
            world.ConfigureScene(Scene(handedness));
            var camera = world.BatterCameraForEvidence;
            var midOff = root.GetComponentsInChildren<Transform>(true)
                .First(t => t.name == "FielderProxy-mid_off").position;
            var midOn = root.GetComponentsInChildren<Transform>(true)
                .First(t => t.name == "FielderProxy-mid_on").position;
            var offScreenX = camera.WorldToViewportPoint(midOff).x;
            var onScreenX = camera.WorldToViewportPoint(midOn).x;
            var expectedSign = handedness == "right" ? -1f : 1f;
            Assert.That(Mathf.Sign(midOff.x), Is.EqualTo(expectedSign), "physics +x mid-off in world x");
            Assert.That(Mathf.Sign(camera.transform.position.x), Is.EqualTo(expectedSign),
                "the rear camera stays on the striker's off side");
            if (handedness == "right")
                Assert.That(offScreenX, Is.GreaterThan(onScreenX), "a right-hander's off side is on screen right");
            else
                Assert.That(offScreenX, Is.LessThan(onScreenX), "a left-hander's off side is on screen left");
        }

        private static PracticeScenePresentation Scene(string handedness)
        {
            PracticeFielderPresentation F(string id, string role, double x, double z) =>
                new PracticeFielderPresentation { Id = id, Role = role, X = x, Z = z };
            return new PracticeScenePresentation
            {
                Conditions = "balanced",
                FieldId = "test",
                FieldIntent = "balanced",
                TrainingObjective = "none",
                BowlerFamily = "pace",
                BowlerArm = "right",
                BowlerLookSeed = "reflection-test",
                BowlerPaceBand = "fast",
                BallColour = "white",
                BallAge = "new",
                Handedness = handedness,
                BatterLateralM = 0.0,
                BatterCreaseOffsetM = 0.0,
                Fielders = new[]
                {
                    F("keeper", "keeper", 0.35, 22.06), F("bowler", "bowler", 0.9, -5.46),
                    F("point", "point", 20.8, 11.51), F("cover", "cover", 20.31, -2.21),
                    F("mid_off", "mid_off", 8.55, -14.9), F("mid_on", "mid_on", -8.55, -14.9),
                    F("midwicket", "midwicket", -19.92, -2.91), F("deep_cover", "deep_cover", 45.0, -20.0),
                    F("deep_point", "deep_point", 55.0, 15.0), F("third_man", "third_man", 30.0, 55.0),
                    F("fine_leg", "fine_leg", -25.0, 58.0)
                }
            };
        }

        private sealed class Silent : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
