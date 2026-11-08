using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Runtime;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    public sealed class VandePracticeRuntimeIntegrationTests
    {
        private GameObject root;

        [TearDown]
        public void TearDown()
        {
            if (root != null) Object.DestroyImmediate(root);
        }

        [Test]
        public void LiveConsumer_DeliveryReleaseInputResultAndDead_StayOnOneValidatedSession()
        {
            var emitted = new List<string>();
            var ready = new List<string>();
            var clock = 1000.0;
            root = new GameObject("VandeBridge-IntegrationTest");
            var runtime = root.AddComponent<VandePracticeRuntimeController>();
            UnityPracticeBridgeSession session = null;
            session = new UnityPracticeBridgeSession(
                emitted.Add,
                ready.Add,
                () => clock++,
                "6000.3.0f1",
                runtime.AcceptHostMessage);
            runtime.Bind(session);

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null, UnityPracticeContractTestFixture.InitializePayload));
            Assert.That(runtime.ConsumerReady, Is.True, "ready must have a live presentation/input consumer");
            Assert.That(ready.Count, Is.EqualTo(1));
            var initializedHud = root.GetComponent<ProductionHudView>();
            Assert.That(initializedHud, Is.Not.Null);
            Assert.That(initializedHud.ExternalOverlayPresentation, Is.False,
                "WebGL and Android must keep the same Unity-owned visible HUD");
            Assert.That(initializedHud.PresentationVisible, Is.True);
            Assert.That(initializedHud.enabled, Is.True,
                "the visible HUD must continue polling its native pause target");
            Assert.That(initializedHud.PauseVisible, Is.False,
                "unsupported Ready/SceneReady presentation must not expose a live pause request");

            SynchronizeClock(session);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));
            Assert.That(initializedHud.SetupBriefAvailable, Is.True,
                "the native surface must expose complete setup in safe scene-ready state");
            Assert.That(initializedHud.ConditionsText, Does.Contain("Setup ›"));
            Assert.That(initializedHud.TryToggleSetupBriefAt(
                initializedHud.SetupBriefTargetPixels.center), Is.True);
            Assert.That(initializedHud.SetupBriefText, Does.Contain("Stumps field"));
            Assert.That(initializedHud.SetupBriefText,
                Does.Contain("Read an unknown over ball by ball"));
            Assert.That(initializedHud.TryToggleSetupBriefAt(
                initializedHud.SetupBriefCloseTargetPixels.center), Is.True);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 8, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Delivery));
            Assert.That(initializedHud.PauseVisible, Is.True);
            Assert.That(initializedHud.SetupBriefAvailable, Is.False,
                "setup disclosure must leave the live delivery corridor clear");
            Rendered(runtime, 1000);

            runtime.Tick(2.4);
            Rendered(runtime, 1016);
            Assert.That(OutboundTypes(emitted), Does.Contain("unity.release"));

            runtime.InputCapture.CaptureDown("touch", 7, 1100, 20, 700, 400, 800);
            runtime.InputCapture.CaptureMove(7, 1110, 30, 680);
            runtime.InputCapture.CaptureUp(7, 1120, 60, 650);
            runtime.Tick(0.0);
            Assert.That(OutboundTypes(emitted), Does.Contain("unity.pointer"));
            Assert.That(OutboundTypes(emitted), Does.Contain("unity.gesture"));

            var resultPayload = UnityPracticeContractTestFixture.ResultPayload();
            var hud = root.GetComponent<ProductionHudView>();
            Assert.That(hud, Is.Not.Null);
            Assert.That(hud.OverText, Is.EqualTo("0.0"));
            Assert.That(hud.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Current));
            Assert.That(hud.OutcomeText, Is.Empty);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.result", 9, "delivery-1", resultPayload));

            Assert.That(hud.PauseVisible, Is.False,
                "Pause is unsupported while authoritative consequence playback is in flight");
            Assert.That(hud.TryRequestPauseAt(hud.PauseTargetPixels.center), Is.False);
            Assert.That(session.TryReportPauseRequest(), Is.False);

            var world = root.GetComponent<ProceduralPracticeWorld>();
            var blendOrigin = typeof(ProceduralPracticeWorld).GetField(
                "canonicalBlendFromPhase", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(blendOrigin, Is.Not.Null);
            Assert.That((float)blendOrigin.GetValue(world), Is.GreaterThan(0.01f),
                "result reconciliation must start from the last visible local/provisional pose");

            Assert.That(hud.OverText, Is.EqualTo("0.0"),
                "host.result must not reveal the legal-ball score before physical playback");
            Assert.That(hud.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Current),
                "host.result must not resolve the six-ball marker before physical playback");
            Assert.That(hud.OutcomeText, Is.Empty,
                "host.result must not expose outcome copy before physical playback");

            runtime.Tick(0.1);
            Rendered(runtime, 1066);
            Assert.That(hud.OverText, Is.EqualTo("0.0"),
                "trace completion alone must not beat the authoritative dead-ball commit");
            Assert.That(hud.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Current));
            Assert.That(hud.OutcomeText, Is.Empty);

            runtime.Tick(0.45);
            Assert.That(hud.OverText, Is.EqualTo("0.0"),
                "the completion callback has not reached the display until OnPostRender");
            Rendered(runtime, 1132);

            Assert.That(hud.OverText, Is.EqualTo("0.1"));
            Assert.That(hud.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Dot));
            Assert.That(hud.BallMarkerLabel(0), Is.EqualTo("0"));
            Assert.That(hud.OutcomeText, Is.EqualTo("DOT"));
            Assert.That(hud.OutcomeVisible, Is.True);

            var outbound = OutboundTypes(emitted);
            Assert.That(outbound, Does.Contain("unity.dead"));
            var deadIndex = outbound.LastIndexOf("unity.dead");
            Assert.That(deadIndex, Is.GreaterThan(0));
            Assert.That(outbound[deadIndex - 1], Is.EqualTo("unity.stats"),
                "delivery-local Unity stats must immediately precede dead ball");
            var stats = UnityPracticePacketCodec.Decode(emitted[deadIndex - 1]).Envelope.payloadJson;
            StringAssert.Contains("\"sampleCount\":3", stats);
            StringAssert.Contains("\"spikes\":1", stats);
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));

            var replayDigest = ReplayDigestFromPayload(resultPayload);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(
                    replayDigest, true, "Wait for the bounce")));
            Assert.That(hud.SetupBriefAvailable, Is.True,
                "the exact retained dead ball restores one-tap setup access");
            Assert.That(hud.PauseVisible, Is.True,
                "the exact retained actionable dead ball supports authoritative Pause");
            Assert.That(hud.TryRequestPauseAt(hud.PauseTargetPixels.center), Is.True,
                "the visible retained-dead-ball Pause must reach bridge authority synchronously");
            Assert.That(OutboundTypes(emitted)[OutboundTypes(emitted).Count - 1],
                Is.EqualTo("unity.pause_request"));
            // The insight update was queued against this exact retained ball,
            // then the host paused before delivery. It must still ACK and
            // refresh the one retained surface without rearming either action.
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.pause", 11, null, "{\"reason\":\"player\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 12, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(
                    replayDigest, true, "Play beneath your eyes")));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(hud.Paused, Is.True);
            Assert.That(hud.DeadBallRecommendationText, Is.EqualTo("Play beneath your eyes"));
            Assert.That(CountLabels(root, "Dead Ball Recommendation Text"), Is.EqualTo(1),
                "a repeated insight updates the retained label rather than duplicating presentation");
            Assert.That(hud.DeadBallActionsEnabled, Is.False);
            Assert.That(hud.TryRequestDeadBallActionAt(
                hud.DeadBallPrimaryActionTargetPixels.center), Is.False);
            Assert.That(session.TryReportDeadBallPauseRequest(), Is.False);
            Assert.That(OutboundTypes(emitted).FindAll(value => value == "unity.dead_ball_action"),
                Is.Empty);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.resume", 13, null, "{\"reason\":\"player\"}"));
            Assert.That(hud.DeadBallActionsEnabled, Is.True);
            var primaryTarget = hud.DeadBallPrimaryActionTargetPixels;
            Assert.That(primaryTarget.width, Is.GreaterThanOrEqualTo(48f));
            Assert.That(primaryTarget.height, Is.GreaterThanOrEqualTo(48f));
            Assert.That(hud.TryRequestDeadBallActionAt(primaryTarget.center), Is.True);
            Assert.That(hud.TryRequestDeadBallActionAt(hud.DeadBallSecondaryActionTargetPixels.center), Is.False,
                "one accepted action must consume both dead-ball controls");
            var actionPacket = emitted.ConvertAll(UnityPracticePacketCodec.Decode)
                .Find(value => value.Envelope.type == "unity.dead_ball_action");
            Assert.That(actionPacket, Is.Not.Null);
            Assert.That(actionPacket.Envelope.deliveryId, Is.EqualTo("delivery-1"));
            StringAssert.Contains("\"action\":\"practice_ball\"", actionPacket.Envelope.payloadJson);
            StringAssert.Contains("\"replayDigest\":\"" + replayDigest + "\"",
                actionPacket.Envelope.payloadJson);

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.replay", 14, "delivery-1",
                "{\"diagnostics\":true,\"resolution\":" + resultPayload + ",\"speed\":1}"));
            runtime.Tick(0.1);
            Rendered(runtime, 1148);
            runtime.Tick(0.45);
            Rendered(runtime, 1164);

            outbound = OutboundTypes(emitted);
            Assert.That(outbound.FindAll(value => value == "unity.dead"), Has.Count.EqualTo(2),
                "live delivery and replay must each complete exactly once");
            Assert.That(outbound.FindAll(value => value == "unity.stats"), Has.Count.EqualTo(1),
                "delivery-window frame stats belong only to live play");
            Assert.That(outbound[outbound.Count - 1], Is.EqualTo("unity.dead"));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
        }

        [Test]
        public void Demonstration_UsesSameWorldRunUpAndHudWithoutInputScoreOrIdentityMutation()
        {
            var emitted = new List<string>();
            root = new GameObject("VandeBridge-DemonstrationIntegrationTest");
            var runtime = root.AddComponent<VandePracticeRuntimeController>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add,
                _ => { },
                () => 1000.0,
                "6000.3.0f1",
                runtime.AcceptHostMessage);
            runtime.Bind(session);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null, UnityPracticeContractTestFixture.InitializePayload));
            SynchronizeClock(session);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));

            var world = root.GetComponent<ProceduralPracticeWorld>();
            var hud = root.GetComponent<ProductionHudView>();
            var childCount = root.transform.childCount;
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration", 8, "demo-1",
                UnityPracticeContractTestFixture.DemonstrationPayload()));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Demonstrating));
            Assert.That(root.GetComponent<ProceduralPracticeWorld>(), Is.SameAs(world));
            Assert.That(root.GetComponent<ProductionHudView>(), Is.SameAs(hud));
            Assert.That(root.transform.childCount, Is.EqualTo(childCount),
                "demo must reuse the mounted world rather than construct another surface");
            Assert.That(world.DeliveryActive, Is.True);
            Assert.That(hud.ReplayPresentation, Is.True);
            Assert.That(hud.OverText, Is.EqualTo("0.0"));

            runtime.Tick(2.4);
            Rendered(runtime, 1016);
            runtime.InputCapture.CaptureDown("touch", 7, 1100, 20, 700, 400, 800);
            runtime.InputCapture.CaptureMove(7, 1110, 30, 680);
            runtime.InputCapture.CaptureUp(7, 1120, 60, 650);
            runtime.Tick(0.1);
            Rendered(runtime, 1066);
            runtime.Tick(0.45);
            Rendered(runtime, 1132);

            var types = OutboundTypes(emitted);
            Assert.That(types, Does.Not.Contain("unity.release"),
                "automated demo run-up must not open a live input/release transaction");
            Assert.That(types, Does.Not.Contain("unity.pointer"));
            Assert.That(types, Does.Not.Contain("unity.gesture"));
            Assert.That(types.FindAll(value => value == "unity.dead"), Has.Count.EqualTo(1));
            Assert.That(types, Does.Not.Contain("unity.stats"),
                "demo playback must not contaminate live delivery performance evidence");
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(hud.OverText, Is.EqualTo("0.0"),
                "the demonstration's authoritative shot must never score in the innings HUD");
            Assert.That(root.GetComponent<ProceduralPracticeWorld>(), Is.SameAs(world));
            Assert.That(root.GetComponent<ProductionHudView>(), Is.SameAs(hud));

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration", 9, "demo-2",
                UnityPracticeContractTestFixture.DemonstrationPayload()));
            runtime.Tick(0.25);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration_cancel", 10, "demo-2", "{}"));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(world.DeliveryActive, Is.False);
            Assert.That(root.GetComponent<ProceduralPracticeWorld>(), Is.SameAs(world));
            Assert.That(root.GetComponent<ProductionHudView>(), Is.SameAs(hud));
            Assert.That(root.transform.childCount, Is.EqualTo(childCount));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 11, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Delivery),
                "accepted Skip must leave the same Unity surface immediately ready for the first live ball");
        }

        [Test]
        public void LocalePacket_RelocalizesMountedHudWithoutRebuildingTheSession()
        {
            var emitted = new List<string>();
            root = new GameObject("VandeBridge-LocaleIntegrationTest");
            var runtime = root.AddComponent<VandePracticeRuntimeController>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add,
                _ => { },
                () => 1000.0,
                "6000.3.0f1",
                runtime.AcceptHostMessage);
            runtime.Bind(session);

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null,
                UnityPracticeContractTestFixture.InitializePayload.Replace("en-IN", "hi")));
            SynchronizeClock(session);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()
                    .Replace("\"balanced\"", "\"green\"")));
            var hud = root.GetComponent<ProductionHudView>();
            Assert.That(hud.ConditionsText, Does.Contain("हरी"));
            Assert.That(hud.ConditionsText, Does.Contain("सीखें"));

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.locale", 8, null, "{\"locale\":\"hi-Latn\"}"));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(hud.ConditionsText, Does.Contain("Hari"));
            Assert.That(hud.ConditionsText, Does.Contain("Seekho"));

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.locale", 9, null, "{\"locale\":\"bn\"}"));
            Assert.That(hud.ConditionsText, Does.Contain("Green"),
                "a Practice locale without Unity copy must fall back to English, never a raw key");
            Assert.That(OutboundTypes(emitted).FindAll(value => value == "bridge.ack").Count,
                Is.GreaterThanOrEqualTo(9));
        }

        [Test]
        public void Initialize_AppliesHostAccessibilityAndAndroidDensityToVisibleHud()
        {
            root = new GameObject("VandeBridge-AccessibilityIntegrationTest");
            var runtime = root.AddComponent<VandePracticeRuntimeController>();
            var session = new UnityPracticeBridgeSession(
                _ => { }, _ => { }, () => 1000.0, "6000.3.0f1", runtime.AcceptHostMessage);
            runtime.Bind(session);
            var initialize = UnityPracticeContractTestFixture.InitializePayload
                .Replace("\"highContrast\":false", "\"highContrast\":true")
                .Replace("\"pixelsPerDp\":1", "\"pixelsPerDp\":3")
                .Replace("\"textScale\":1", "\"textScale\":2");

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null, initialize));

            var hud = root.GetComponent<ProductionHudView>();
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Ready));
            Assert.That(hud.TextScale, Is.EqualTo(2f));
            Assert.That(hud.HighContrast, Is.True);
            Assert.That(hud.CurrentLayout.TouchDpScale, Is.EqualTo(3f));
            var textLayers = root.GetComponentsInChildren<ProductionHudAdvancedTextLayer>(true);
            Label score = null;
            foreach (var textLayer in textLayers)
            {
                score = textLayer.RootForTesting.Q<Label>("Score Text");
                if (score != null) break;
            }
            Assert.That(score, Is.Not.Null);
            Assert.That(score.resolvedStyle.color, Is.EqualTo(Color.white));
        }

        [Test]
        public void InitializeConsumerFailure_EmitsNoReadyAndFailsClosed()
        {
            var emitted = new List<string>();
            var ready = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, ready.Add, () => 100, "6000.3.0f1",
                _ => throw new System.InvalidOperationException("presentation failed"));

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null, UnityPracticeContractTestFixture.InitializePayload));

            Assert.That(ready, Is.Empty);
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(OutboundTypes(emitted), Does.Contain("unity.error"));
        }

        [Test]
        public void ResultConsumerFailure_EmitsNoAckAndOneFatalError()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100, "6000.3.0f1",
                envelope =>
                {
                    if (envelope.type == "host.result")
                        throw new System.InvalidOperationException("presentation failed");
                });
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null, UnityPracticeContractTestFixture.InitializePayload));
            SynchronizeClock(session);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 8, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            emitted.Clear();

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.result", 9, "delivery-1", UnityPracticeContractTestFixture.ResultPayload()));

            var outbound = OutboundTypes(emitted);
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(outbound, Is.EqualTo(new[] { "unity.error" }),
                "a failed presentation consumer must never acknowledge unaccepted result work");
        }

        [Test]
        public void LiveConsumer_BenchmarkEchoesCorrelationAndRawUnityIntervals()
        {
            var emitted = new List<string>();
            root = new GameObject("VandeBridge-BenchmarkTest");
            var runtime = root.AddComponent<VandePracticeRuntimeController>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 1000, "6000.3.0f1", runtime.AcceptHostMessage);
            runtime.Bind(session);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null, UnityPracticeContractTestFixture.InitializePayload));
            SynchronizeClock(session);

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.benchmark", 7, null,
                "{\"benchmarkId\":\"bench-1\",\"durationMs\":1000,\"quality\":\"standard\"," +
                "\"sampleCap\":2,\"warmupFrames\":1}"));
            Rendered(runtime, 1000);
            runtime.Tick(0.016);
            Rendered(runtime, 1016);
            runtime.Tick(0.5);
            Rendered(runtime, 1516);
            runtime.Tick(0.5);
            Rendered(runtime, 2016);

            var packets = emitted.ConvertAll(UnityPracticePacketCodec.Decode);
            var benchmark = packets.Find(value => value.Envelope.type == "unity.benchmark");
            Assert.That(benchmark, Is.Not.Null);
            StringAssert.Contains("\"benchmarkId\":\"bench-1\"", benchmark.Envelope.payloadJson);
            StringAssert.Contains("\"frameIntervalsMs\":[500,500]", benchmark.Envelope.payloadJson);
            StringAssert.Contains("\"shaderWarmupCompleted\":false", benchmark.Envelope.payloadJson);
            StringAssert.Contains("\"shaderWarmupMs\":null", benchmark.Envelope.payloadJson);
            StringAssert.Contains("\"contextLosses\":null", benchmark.Envelope.payloadJson);
        }

        private static void Rendered(VandePracticeRuntimeController runtime, double unityMs)
        {
            var method = typeof(VandePracticeRuntimeController).GetMethod(
                "OnFrameRendered", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(method, Is.Not.Null);
            method.Invoke(runtime, new object[] { unityMs });
        }

        private static void SynchronizeClock(UnityPracticeBridgeSession session)
        {
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket("host.clock_sync", 1, null,
                "{\"hostSendPerfMs\":1,\"sampleId\":\"clock-1\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket("host.clock_sync", 2, null,
                "{\"hostSendPerfMs\":2,\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket("host.clock_sync", 3, null,
                "{\"hostSendPerfMs\":3,\"sampleId\":\"clock-3\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket("host.clock_sync", 4, null,
                "{\"hostSendPerfMs\":4,\"sampleId\":\"clock-4\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket("host.clock_sync", 5, null,
                "{\"hostSendPerfMs\":5,\"sampleId\":\"clock-5\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket("host.clock_selected", 6, null,
                "{\"sampleId\":\"clock-2\"}"));
        }

        private static List<string> OutboundTypes(List<string> packets)
        {
            var values = new List<string>(packets.Count);
            foreach (var packet in packets) values.Add(UnityPracticePacketCodec.Decode(packet).Envelope.type);
            return values;
        }

        private static string ReplayDigestFromPayload(string payload)
        {
            const string marker = "\"replayDigest\":\"";
            var start = payload.IndexOf(marker, System.StringComparison.Ordinal);
            Assert.That(start, Is.GreaterThanOrEqualTo(0));
            return payload.Substring(start + marker.Length, 64);
        }

        private static GameObject Find(GameObject owner, string objectName)
        {
            var transforms = owner.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < transforms.Length; index++)
                if (transforms[index].gameObject.name == objectName)
                    return transforms[index].gameObject;
            Assert.Fail("Missing runtime object: " + objectName);
            return null;
        }

        // Wedge phase 3: HUD text is UI Toolkit labels, so text is counted among the labels, not GameObjects.
        private static int CountLabels(GameObject owner, string labelName)
        {
            var count = 0;
            foreach (var layer in owner.GetComponentsInChildren<ProductionHudAdvancedTextLayer>(true))
                count += layer.RootForTesting.Query<UnityEngine.UIElements.Label>(labelName).ToList().Count;
            return count;
        }

        private static int Count(GameObject owner, string objectName)
        {
            var count = 0;
            var transforms = owner.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < transforms.Length; index++)
                if (transforms[index].gameObject.name == objectName) count++;
            return count;
        }
    }
}
