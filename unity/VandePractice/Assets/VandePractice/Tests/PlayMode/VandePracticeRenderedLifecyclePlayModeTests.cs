using System.Collections;
using System.Collections.Generic;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Runtime;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Frame-driven integration checks for the actual Unity Practice surface.
    /// EditMode tests cover deterministic adapters in depth; these checks prove
    /// the camera's OnPostRender boundary, MonoBehaviour lifecycle and bridge
    /// commit ordering while the player loop is genuinely running.
    /// </summary>
    public sealed class VandePracticeRenderedLifecyclePlayModeTests
    {
        private GameObject root;

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            if (root != null) Object.Destroy(root);
            root = null;
            yield return null;
        }

        [UnityTest]
        public IEnumerator Delivery_CommitsScoreAndDeadBallOnlyAfterRenderedFrame()
        {
            var emitted = new List<string>();
            var ready = new List<string>();
            var runtime = CreateRuntime(emitted, ready, out var session);
            var world = root.GetComponent<ProceduralPracticeWorld>();
            var renderedFrames = 0;
            world.FrameRendered += _ => renderedFrames++;

            Assert.That(runtime.ConsumerReady, Is.True);
            Assert.That(ready, Has.Count.EqualTo(1));

            SynchronizeClock(session);
            session.ReceivePacket(HostPacket("host.scene", 7, null, ScenePayload()));
            session.ReceivePacket(HostPacket("host.delivery", 8, "delivery-1", DeliveryPayload));

            yield return null;
            RenderBatterCamera();
            Assert.That(renderedFrames, Is.GreaterThan(0),
                "the batter camera must complete a real rendered frame in PlayMode");

            runtime.Tick(2.4);
            yield return null;
            RenderBatterCamera();
            Assert.That(OutboundTypes(emitted), Does.Contain("unity.release"));

            var hud = root.GetComponent<ProductionHudView>();
            Assert.That(hud.OverText, Is.EqualTo("0.0"));
            session.ReceivePacket(HostPacket(
                "host.result", 9, "delivery-1", ResultPayload()));

            runtime.Tick(0.1);
            runtime.Tick(0.45);
            Assert.That(OutboundTypes(emitted), Does.Not.Contain("unity.dead"),
                "simulation completion is not display completion");
            Assert.That(hud.OverText, Is.EqualTo("0.0"),
                "score must remain hidden until the completed frame is presented");

            yield return null;
            RenderBatterCamera();

            var outbound = OutboundTypes(emitted);
            var deadIndex = outbound.LastIndexOf("unity.dead");
            Assert.That(deadIndex, Is.GreaterThan(0));
            Assert.That(outbound[deadIndex - 1], Is.EqualTo("unity.stats"),
                "render-window statistics must immediately precede dead ball");
            Assert.That(hud.OverText, Is.EqualTo("0.1"));
            Assert.That(hud.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Dot));
            Assert.That(hud.OutcomeText, Is.EqualTo("DOT"));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
        }

        [UnityTest]
        public IEnumerator PauseResumeAndDispose_ControlTheLivePlayerLoopSurface()
        {
            var emitted = new List<string>();
            var runtime = CreateRuntime(emitted, new List<string>(), out var session);
            SynchronizeClock(session);
            session.ReceivePacket(HostPacket("host.scene", 7, null, ScenePayload()));
            session.ReceivePacket(HostPacket("host.delivery", 8, "delivery-1", DeliveryPayload));
            var world = root.GetComponent<ProceduralPracticeWorld>();

            runtime.Tick(0.25);
            var beforePause = world.Timeline;
            session.ReceivePacket(HostPacket(
                "host.pause", 9, null, "{\"reason\":\"player\"}"));
            yield return null;
            var pausedAt = world.Timeline;
            yield return null;
            Assert.That(world.Timeline, Is.EqualTo(pausedAt).Within(0.000001),
                "the live MonoBehaviour Update loop must not advance a paused delivery");

            session.ReceivePacket(HostPacket(
                "host.resume", 10, null, "{\"reason\":\"player\"}"));
            runtime.Tick(0.25);
            yield return null;
            Assert.That(world.Timeline, Is.GreaterThan(beforePause));

            session.ReceivePacket(HostPacket(
                "host.dispose", 11, null, "{\"reason\":\"cancelled\"}"));
            yield return null;
            Assert.That(world.DeliveryActive, Is.False);
            Assert.That(runtime.InputCapture.DeliveryEnabled, Is.False);
        }

        private VandePracticeRuntimeController CreateRuntime(
            List<string> emitted,
            List<string> ready,
            out UnityPracticeBridgeSession session)
        {
            var clock = 1000.0;
            root = new GameObject("VandePractice-PlayModeTest");
            var runtime = root.AddComponent<VandePracticeRuntimeController>();
            session = new UnityPracticeBridgeSession(
                emitted.Add,
                ready.Add,
                () => clock++,
                "6000.3.27f1",
                runtime.AcceptHostMessage);
            runtime.Bind(session);
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));
            return runtime;
        }

        private void RenderBatterCamera()
        {
            var cameras = root.GetComponentsInChildren<Camera>(true);
            Camera batterCamera = null;
            foreach (var candidate in cameras)
            {
                if (candidate.gameObject.name != "BatterEyeCamera") continue;
                Assert.That(batterCamera, Is.Null,
                    "the test surface must not create duplicate batter cameras");
                batterCamera = candidate;
            }
            Assert.That(batterCamera, Is.Not.Null,
                "the production batter camera must exist");
            batterCamera.Render();
        }

        private static void SynchronizeClock(UnityPracticeBridgeSession session)
        {
            for (var sequence = 1; sequence <= 5; sequence++)
            {
                session.ReceivePacket(HostPacket(
                    "host.clock_sync",
                    sequence,
                    null,
                    "{\"hostSendPerfMs\":" + sequence + ",\"sampleId\":\"clock-" + sequence + "\"}"));
            }
            session.ReceivePacket(HostPacket(
                "host.clock_selected", 6, null, "{\"sampleId\":\"clock-2\"}"));
        }

        private static List<string> OutboundTypes(List<string> packets)
        {
            var values = new List<string>(packets.Count);
            foreach (var packet in packets)
                values.Add(UnityPracticePacketCodec.Decode(packet).Envelope.type);
            return values;
        }

        private static string HostPacket(string type, long sequence, string deliveryId, string payload)
        {
            var body = "{" +
                       "\"buildId\":\"build-1\"," +
                       "\"contractVersion\":" + BridgeConstants.ContractVersion + "," +
                       "\"deliveryId\":" + (deliveryId == null ? "null" : "\"" + deliveryId + "\"") + "," +
                       "\"messageId\":\"host-" + sequence + "\"," +
                       "\"payload\":" + payload + "," +
                       "\"sender\":\"host\"," +
                       "\"sequence\":" + sequence + "," +
                       "\"sessionId\":\"session-1\"," +
                       "\"simVersion\":" + BridgeConstants.SimulationVersion + "," +
                       "\"type\":\"" + type + "\"}";
            return JsonUtility.ToJson(new UnityPracticePacket
            {
                body = body,
                sha256 = Sha256Digest.OfUtf8(body)
            });
        }

        private const string InitializePayload =
            "{\"assistance\":\"learn\",\"audio\":true,\"captions\":true," +
            "\"coordinateSystem\":\"vande-striker-frame-v1\",\"deviceTier\":\"full\"," +
            "\"handedness\":\"right\",\"handednessPolicy\":" +
            "\"physics-right-handed-presentation-mirrors-once\",\"haptics\":true," +
            "\"highContrast\":false,\"locale\":\"en-IN\",\"pixelsPerDp\":1,\"quality\":\"standard\"," +
            "\"reducedMotion\":false,\"textScale\":1}";

        private const string Plan =
            "{\"lengthM\":6,\"lineM\":0,\"speedKph\":130,\"variation\":\"stock\"}";

        private const string Bowler =
            "{\"arm\":\"right\",\"family\":\"pace\",\"lookSeed\":\"look\",\"paceBand\":\"fast\"}";

        private const string Ball = "{\"age\":\"new\",\"colour\":\"red\"}";

        private const string Flight =
            "{\"bounce\":null,\"idealContactT\":0.45,\"plan\":" + Plan + "," +
            "\"release\":{\"p\":{\"x\":0,\"y\":2,\"z\":-8.69},\"seamDeg\":0," +
            "\"speedKph\":130,\"spinRps\":10,\"v\":{\"x\":0,\"y\":-1,\"z\":35}}," +
            "\"samples\":[{\"p\":{\"x\":0,\"y\":2,\"z\":-8.69},\"t\":0," +
            "\"v\":{\"x\":0,\"y\":-1,\"z\":35}},{\"p\":{\"x\":0,\"y\":0.5,\"z\":9}," +
            "\"t\":0.5,\"v\":{\"x\":0,\"y\":0,\"z\":35}}]," +
            "\"seam\":{\"axis\":{\"x\":0,\"y\":1,\"z\":0},\"shine\":{\"x\":1,\"y\":0,\"z\":0}," +
            "\"wobble\":0},\"seed\":\"seed\"," +
            "\"spin\":{\"afterBounce\":null,\"release\":{\"x\":0,\"y\":1,\"z\":0}}," +
            "\"stumpsT\":0.5,\"version\":3,\"wouldHitStumps\":true}";

        private static string DeliveryPayload =>
            "{\"ballIndex\":0,\"flight\":" + Flight + ",\"overIndex\":0,\"plan\":" + Plan +
            ",\"presentation\":{\"coach\":null,\"learnCue\":false},\"seed\":\"seed\"}";

        private static string ScenePayload()
        {
            return "{" +
                   "\"ball\":" + Ball + "," +
                   "\"batterPosition\":{\"creaseOffsetM\":0,\"guard\":\"middle\",\"lateralM\":0}," +
                   "\"bowler\":" + Bowler + "," +
                   "\"conditions\":\"balanced\"," +
                   "\"field\":" + FieldPayload() + "," +
                   "\"fieldIntent\":\"attack_the_stumps\"," +
                   "\"handedness\":\"right\"," +
                   "\"trainingObjective\":\"random\"}";
        }

        private static string ResultPayload()
        {
            const string ballTrace =
                "[{\"p\":{\"x\":0,\"y\":2,\"z\":-8},\"t\":0," +
                "\"v\":{\"x\":0,\"y\":-1,\"z\":35}},{\"p\":{\"x\":0,\"y\":0.4,\"z\":9}," +
                "\"t\":0.1,\"v\":{\"x\":0,\"y\":0,\"z\":20}}]";
            const string contact =
                "{\"batSpeedKph\":null,\"bladeU\":null,\"exitBearingDeg\":null," +
                "\"exitElevationDeg\":null,\"exitSpeedKph\":null,\"faceBearingDeg\":null," +
                "\"intendedBearingDeg\":null,\"kind\":\"leave\",\"point\":null,\"t\":null," +
                "\"timing\":\"none\",\"timingErrorMs\":null}";
            const string coaching =
                "{\"fielderRole\":null,\"lbw\":null,\"reason\":\"left_well\",\"timing\":null,\"zone\":null}";
            const string outcome =
                "{\"boundary\":null,\"dismissal\":null,\"endBearingDeg\":null,\"endDistanceM\":null," +
                "\"fielderId\":null,\"region\":null,\"runs\":0}";
            var record = "{" +
                         "\"assist\":\"learn\",\"ball\":" + Ball + ",\"ballIndex\":0," +
                         "\"bowler\":" + Bowler + ",\"conditions\":\"balanced\",\"dismissal\":null," +
                         "\"field\":" + FieldPayload() + ",\"handedness\":\"right\",\"overIndex\":0," +
                         "\"plan\":" + Plan + ",\"runs\":0,\"seed\":\"seed\",\"swing\":null," +
                         "\"tierToleranceMs\":0,\"version\":3}";
            var result = "{" +
                         "\"ball\":" + ballTrace + ",\"bat\":[]," +
                         "\"batterBodyFrame\":{\"headCentre\":{\"x\":-0.2,\"y\":1.62,\"z\":8.86}," +
                         "\"stance\":{\"x\":-0.15,\"z\":8.96}," +
                         "\"torsoTop\":{\"x\":-0.3,\"y\":1.42,\"z\":8.94}}," +
                         "\"batterMotion\":null," +
                         "\"batterPosture\":{\"crouchM\":0}," +
                         "\"batterRootOffset\":{\"x\":0,\"z\":0},\"coaching\":" + coaching + "," +
                         "\"contact\":" + contact + ",\"deadT\":0.1," +
                         "\"events\":[{\"kind\":\"release\",\"t\":0},{\"kind\":\"dead\",\"t\":0.1}]," +
                         "\"fielders\":" + FielderPaths() + ",\"flight\":" + Flight + "," +
                         "\"footwork\":\"forward\",\"lbw\":null,\"outcome\":" + outcome + "," +
                         "\"swing\":null,\"version\":3}";
            const string score = "{\"balls\":1,\"maxOvers\":10,\"runs\":0,\"wickets\":0}";
            var withoutDigest = "{\"record\":" + record + ",\"result\":" + result + ",\"score\":" + score + "}";
            var digest = UnityPracticeReplayDigest.ComputeFromResolutionPayload(withoutDigest);
            return "{\"record\":" + record + ",\"replayDigest\":\"" + digest + "\",\"result\":" +
                   result + ",\"score\":" + score + "}";
        }

        private static string FieldPayload()
        {
            var fielders = new StringBuilder("[");
            for (var index = 0; index < Roles.Length; index++)
            {
                if (index > 0) fielders.Append(',');
                fielders.Append("{\"id\":\"fielder-").Append(index)
                    .Append("\",\"role\":\"").Append(Roles[index])
                    .Append("\",\"x\":").Append(index - 5)
                    .Append(",\"z\":").Append(index * 2).Append('}');
            }
            return "{\"fielders\":" + fielders.Append(']') + ",\"id\":\"test-field\"}";
        }

        private static string FielderPaths()
        {
            var paths = new StringBuilder("[");
            for (var index = 0; index < Roles.Length; index++)
            {
                if (index > 0) paths.Append(',');
                paths.Append("{\"fielderId\":\"fielder-").Append(index)
                    .Append("\",\"samples\":[{\"action\":\"idle\",\"t\":0,\"x\":")
                    .Append(index - 5).Append(",\"z\":").Append(index * 2)
                    .Append("},{\"action\":\"idle\",\"t\":0.1,\"x\":")
                    .Append(index - 5).Append(",\"z\":").Append(index * 2).Append("}]}");
            }
            return paths.Append(']').ToString();
        }

        private static readonly string[] Roles =
        {
            "keeper", "bowler", "slip", "point", "cover", "mid_off",
            "mid_on", "midwicket", "square_leg", "fine_leg", "third_man"
        };
    }
}
