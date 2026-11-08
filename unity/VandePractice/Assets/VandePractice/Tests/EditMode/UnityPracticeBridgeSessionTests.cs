using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;

namespace Vande.Practice.Tests
{
    public sealed class UnityPracticeBridgeSessionTests
    {
        [Test]
        public void Initialize_EmitsAckThenReadyOnlyAfterValidation()
        {
            var emitted = new List<string>();
            var ready = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, ready.Add, () => 100.0, "6000.3.0f1", _ => { });

            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Ready));
            Assert.That(emitted.Count, Is.EqualTo(1));
            Assert.That(ready.Count, Is.EqualTo(1));
            Assert.That(UnityPracticePacketCodec.Decode(emitted[0]).Envelope.type, Is.EqualTo("bridge.ack"));
            Assert.That(UnityPracticePacketCodec.Decode(ready[0]).Envelope.type, Is.EqualTo("unity.ready"));
            StringAssert.Contains("\"unityVersion\":\"6000.3.0f1\"",
                UnityPracticePacketCodec.Decode(ready[0]).Envelope.payloadJson);
        }

        [Test]
        public void InvalidInitialPacket_EmitsNothingAndFailsClosed()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });

            session.ReceivePacket("{\"body\":\"{}\",\"sha256\":\"bad\"}");

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(emitted, Is.Empty);
        }

        [Test]
        public void InvalidPacket_ReportsOneBoundedDiagnosticWithoutPacketContents()
        {
            var emitted = new List<string>();
            var diagnostics = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { }, diagnostics.Add);

            session.ReceivePacket("{\"body\":\"secret-packet-value\",\"sha256\":\"bad\"}");

            Assert.That(diagnostics, Has.Count.EqualTo(1));
            StringAssert.StartsWith("bridge_validation|", diagnostics[0]);
            Assert.That(diagnostics[0].Length, Is.LessThanOrEqualTo(200));
            StringAssert.DoesNotContain("secret-packet-value", diagnostics[0]);
        }

        [Test]
        public void ClockSync_UsesUnityRealtimeAndUnlocksDelivery()
        {
            var emitted = new List<string>();
            var clock = 100.0;
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => clock++, "6000.3.0f1", _ => { });
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));

            session.ReceivePacket(HostPacket("host.clock_sync", 1, null,
                "{\"hostSendPerfMs\":42.5,\"sampleId\":\"clock-1\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 2, null,
                "{\"hostSendPerfMs\":43.5,\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 3, null,
                "{\"hostSendPerfMs\":44.5,\"sampleId\":\"clock-3\"}"));

            Assert.That(session.ClockSynchronized, Is.False);
            var response = UnityPracticePacketCodec.Decode(emitted[emitted.Count - 1]);
            Assert.That(response.Envelope.type, Is.EqualTo("unity.clock_sync"));
            StringAssert.Contains("\"unityReceiveMs\":105", response.Envelope.payloadJson);
            StringAssert.Contains("\"unitySendMs\":106", response.Envelope.payloadJson);

            session.ReceivePacket(HostPacket("host.clock_sync", 4, null,
                "{\"hostSendPerfMs\":45.5,\"sampleId\":\"clock-4\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 5, null,
                "{\"hostSendPerfMs\":46.5,\"sampleId\":\"clock-5\"}"));
            session.ReceivePacket(HostPacket("host.clock_selected", 6, null,
                "{\"sampleId\":\"clock-2\"}"));
            Assert.That(session.ClockSynchronized, Is.True);

            session.ReceivePacket(HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));
            session.ReceivePacket(HostPacket(
                "host.delivery", 8, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Delivery));

            session.ReportPointer("down", "touch");
            var pointer = UnityPracticePacketCodec.Decode(emitted[emitted.Count - 1]).Envelope;
            Assert.That(pointer.type, Is.EqualTo("unity.pointer"));
            StringAssert.Contains("\"atUnityMs\":114", pointer.payloadJson);
            StringAssert.Contains("\"clockSampleId\":\"clock-2\"", pointer.payloadJson);
        }

        [Test]
        public void DeliveryBeforeClockSync_IsRejected()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));

            session.ReceivePacket(HostPacket("host.delivery", 1, "delivery-1",
                "{\"ballIndex\":0,\"flight\":{},\"overIndex\":0,\"plan\":{},\"seed\":\"seed\"}"));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(UnityPracticePacketCodec.Decode(emitted[emitted.Count - 1]).Envelope.type,
                Is.EqualTo("unity.error"));
        }

        [Test]
        public void RejectedLifecycle_ReportsBoundedReasonWithoutEnvelopeValues()
        {
            var emitted = new List<string>();
            var diagnostics = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { }, diagnostics.Add);
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));

            session.ReceivePacket(HostPacket("host.delivery", 1, "secret-delivery-id",
                UnityPracticeContractTestFixture.DeliveryPayload));

            Assert.That(diagnostics, Has.Count.EqualTo(1));
            StringAssert.StartsWith("bridge_rejected|", diagnostics[0]);
            StringAssert.DoesNotContain("secret-delivery-id", diagnostics[0]);
            StringAssert.DoesNotContain("seed", diagnostics[0]);
        }

        [Test]
        public void NativeUnload_EmitsTerminalPacketEvenWhenSurfaceCleanupThrows()
        {
            var method = typeof(VandeBridgeBehaviour).GetMethod(
                "CompleteNativeUnload",
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            Assert.That(method, Is.Not.Null);
            var emitted = false;
            var thrown = Assert.Throws<System.Reflection.TargetInvocationException>(() => method.Invoke(
                null,
                new object[]
                {
                    (System.Action)(() => throw new System.InvalidOperationException("surface cleanup failed")),
                    (System.Action)(() => emitted = true)
                }));

            Assert.That(thrown.InnerException, Is.TypeOf<System.InvalidOperationException>());
            Assert.That(emitted, Is.True);
        }

        [Test]
        public void Dispose_AcksWithoutAnInvalidQuietPacket_ThenUnloads()
        {
            var emitted = new List<string>();
            var ready = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, ready.Add, () => 100.0, "6000.3.0f1", _ => { });
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));
            emitted.Clear();

            session.ReceivePacket(HostPacket(
                "host.dispose", 1, null, "{\"reason\":\"complete\"}"));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Disposing));
            Assert.That(emitted.Count, Is.EqualTo(1));
            Assert.That(UnityPracticePacketCodec.Decode(emitted[0]).Envelope.type, Is.EqualTo("bridge.ack"));

            session.PrepareForUnload(null);
            Assert.That(UnityPracticePacketCodec.Decode(emitted[1]).Envelope.type, Is.EqualTo("unity.unloaded"));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Unloaded));
        }

        [Test]
        public void FatalRuntimeFailure_AllowsNativeForcedUnloadToReachTerminalState()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));
            emitted.Clear();

            session.ReportRuntimeFailure();
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(UnityPracticePacketCodec.Decode(emitted[0]).Envelope.type, Is.EqualTo("unity.error"));

            session.PrepareForUnload(null);
            Assert.That(UnityPracticePacketCodec.Decode(emitted[1]).Envelope.type, Is.EqualTo("unity.unloaded"));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Unloaded));
        }

        [TestCase("seed")]
        [TestCase("plan")]
        [TestCase("flight")]
        [TestCase("scene")]
        public void Result_CannotChangeTheAcceptedDeliveryOrScene(string mutation)
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));
            session.ReceivePacket(HostPacket("host.clock_sync", 1, null,
                "{\"hostSendPerfMs\":1,\"sampleId\":\"clock-1\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 2, null,
                "{\"hostSendPerfMs\":2,\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 3, null,
                "{\"hostSendPerfMs\":3,\"sampleId\":\"clock-3\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 4, null,
                "{\"hostSendPerfMs\":4,\"sampleId\":\"clock-4\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 5, null,
                "{\"hostSendPerfMs\":5,\"sampleId\":\"clock-5\"}"));
            session.ReceivePacket(HostPacket("host.clock_selected", 6, null,
                "{\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));
            session.ReceivePacket(HostPacket(
                "host.delivery", 8, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));

            var payload = UnityPracticeContractTestFixture.ResultPayload();
            switch (mutation)
            {
                case "seed":
                    payload = ReplaceFirst(payload, "\"seed\":\"seed\"", "\"seed\":\"changed\"");
                    break;
                case "plan":
                    payload = ReplaceFirst(payload, "\"speedKph\":130", "\"speedKph\":129");
                    break;
                case "scene":
                    payload = ReplaceFirst(payload, "\"age\":\"new\"", "\"age\":\"worn\"");
                    break;
                case "flight":
                    payload = ReplaceFirst(payload,
                        "\"flight\":{\"bounce\":null,\"idealContactT\":0.45",
                        "\"flight\":{\"bounce\":null,\"idealContactT\":0.44");
                    break;
                default:
                    Assert.Fail("Unknown mutation.");
                    break;
            }
            payload = ReplaceClaimedDigest(payload, UnityPracticeReplayDigest.ComputeFromResolutionPayload(payload));

            session.ReceivePacket(HostPacket("host.result", 9, "delivery-1", payload));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(UnityPracticePacketCodec.Decode(emitted[emitted.Count - 1]).Envelope.type,
                Is.EqualTo("unity.error"));
        }

        [Test]
        public void Result_CannotChangeTheAcceptedProvisionalSwing()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));
            session.ReceivePacket(HostPacket("host.clock_sync", 1, null,
                "{\"hostSendPerfMs\":1,\"sampleId\":\"clock-1\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 2, null,
                "{\"hostSendPerfMs\":2,\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 3, null,
                "{\"hostSendPerfMs\":3,\"sampleId\":\"clock-3\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 4, null,
                "{\"hostSendPerfMs\":4,\"sampleId\":\"clock-4\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 5, null,
                "{\"hostSendPerfMs\":5,\"sampleId\":\"clock-5\"}"));
            session.ReceivePacket(HostPacket("host.clock_selected", 6, null,
                "{\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));
            session.ReceivePacket(HostPacket(
                "host.delivery", 8, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            const string swing =
                "{\"directionDeg\":10,\"elevation\":0,\"footwork\":\"auto\"," +
                "\"kind\":\"attack\",\"power\":0.7,\"startT\":0.3}";
            session.ReceivePacket(HostPacket("host.provisional_swing", 9, "delivery-1",
                "{\"atPerfMs\":1,\"calibrationMs\":0,\"swing\":" + swing + "}"));
            var payload = UnityPracticeContractTestFixture.ResultPayload();
            payload = ReplaceFirst(payload, "\"swing\":null", "\"swing\":" + swing);
            payload = ReplaceFirst(payload, "\"swing\":null", "\"swing\":" + swing);
            payload = ReplaceFirst(payload, "\"directionDeg\":10", "\"directionDeg\":11");
            payload = ReplaceClaimedDigest(payload, UnityPracticeReplayDigest.ComputeFromResolutionPayload(payload));

            session.ReceivePacket(HostPacket("host.result", 10, "delivery-1", payload));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
        }

        [Test]
        public void WrongDeadTime_FailsBeforeAnyDeadPacketCanEscape()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            session.ReceivePacket(HostPacket("host.initialize", 0, null, InitializePayload));
            session.ReceivePacket(HostPacket("host.clock_sync", 1, null,
                "{\"hostSendPerfMs\":1,\"sampleId\":\"clock-1\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 2, null,
                "{\"hostSendPerfMs\":2,\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 3, null,
                "{\"hostSendPerfMs\":3,\"sampleId\":\"clock-3\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 4, null,
                "{\"hostSendPerfMs\":4,\"sampleId\":\"clock-4\"}"));
            session.ReceivePacket(HostPacket("host.clock_sync", 5, null,
                "{\"hostSendPerfMs\":5,\"sampleId\":\"clock-5\"}"));
            session.ReceivePacket(HostPacket("host.clock_selected", 6, null,
                "{\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));
            session.ReceivePacket(HostPacket(
                "host.delivery", 8, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            var resolution = UnityPracticeContractTestFixture.ResultPayload();
            session.ReceivePacket(HostPacket("host.result", 9, "delivery-1", resolution));
            emitted.Clear();

            Assert.Throws<BridgeValidationException>(() =>
                session.ReportDeliveryDead(0.2, ReplayDigestFromPayload(resolution)));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(OutboundTypes(emitted), Does.Not.Contain("unity.dead"));
            Assert.That(OutboundTypes(emitted), Does.Contain("unity.error"));
        }

        [Test]
        public void DeadBallUi_CanUpdateUntilOneExactActionConsumesTheWholeSurface()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            var resolution = UnityPracticeContractTestFixture.ResultPayload();
            var digest = ReplayDigestFromPayload(resolution);
            AdvanceToDead(session, resolution);
            emitted.Clear();

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest)));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 11, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest, true, "Wait for the bounce")));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(OutboundTypes(emitted).FindAll(value => value == "bridge.ack"), Has.Count.EqualTo(2));
            Assert.That(session.TryReportDeadBallAction("stale-delivery", digest, "practice_ball"), Is.False);
            Assert.That(session.TryReportDeadBallAction("delivery-1", new string('0', 64), "practice_ball"), Is.False);
            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "unsupported"), Is.False);

            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "practice_ball"), Is.True);
            var action = UnityPracticePacketCodec.Decode(emitted[emitted.Count - 1]).Envelope;
            Assert.That(action.type, Is.EqualTo("unity.dead_ball_action"));
            Assert.That(action.deliveryId, Is.EqualTo("delivery-1"));
            StringAssert.Contains("\"action\":\"practice_ball\"", action.payloadJson);
            StringAssert.Contains("\"replayDigest\":\"" + digest + "\"", action.payloadJson);
            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "next_ball"), Is.False,
                "the secondary action must not race after the primary action was accepted");
        }

        [Test]
        public void DeadBallAction_IsRejectedBeforeUiWhilePausedAndAfterReplayStarts()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            var resolution = UnityPracticeContractTestFixture.ResultPayload();
            var digest = ReplayDigestFromPayload(resolution);
            AdvanceToDead(session, resolution);

            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "next_ball"), Is.False);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest, false)));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.pause", 11, null, "{\"reason\":\"player\"}"));
            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "next_ball"), Is.False);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.resume", 12, null, "{\"reason\":\"player\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.replay", 13, "delivery-1",
                "{\"diagnostics\":true,\"resolution\":" + resolution + ",\"speed\":1}"));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Replaying));
            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "next_ball"), Is.False);
        }

        [Test]
        public void NativeBackPause_AcceptsOnlyExactRetainedDeadBallAndRejectsEveryRace()
        {
            var emitted = new List<string>();
            var resolution = UnityPracticeContractTestFixture.ResultPayload();
            var digest = ReplayDigestFromPayload(resolution);
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            AdvanceToDead(session, resolution);

            Assert.That(session.TryReportDeadBallPauseRequest(), Is.False,
                "dead ball without its exact retained UI is not pauseable from native Back");
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest, false)));
            emitted.Clear();

            Assert.That(session.TryReportDeadBallPauseRequest(), Is.True);
            Assert.That(OutboundTypes(emitted), Is.EqualTo(new[] { "unity.pause_request" }));
            Assert.That(session.TryReportDeadBallPauseRequest(), Is.False,
                "a pending pause request cannot race a duplicate native callback");
            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "next_ball"), Is.False,
                "a pending pause request and a dead-ball action are mutually exclusive");

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.pause", 11, null, "{\"reason\":\"player\"}"));
            Assert.That(session.TryReportDeadBallPauseRequest(), Is.False);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.resume", 12, null, "{\"reason\":\"foreground\"}"));
            Assert.That(session.TryReportDeadBallPauseRequest(), Is.False,
                "foreground resumes the engine but deliberately keeps retained presentation controls held");
            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "next_ball"), Is.False);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.resume", 13, null, "{\"reason\":\"player\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 14, "delivery-2", UnityPracticeContractTestFixture.DeliveryPayload));
            Assert.That(session.TryReportDeadBallPauseRequest(), Is.False,
                "a new delivery makes the prior dead-ball UI stale");
            Assert.That(session.TryReportPauseRequest(), Is.True,
                "the ordinary on-screen pause remains valid during a live delivery");

            emitted.Clear();
            var consumed = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            AdvanceToDead(consumed, resolution);
            consumed.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest, false)));
            Assert.That(consumed.TryReportDeadBallAction("delivery-1", digest, "next_ball"), Is.True);
            Assert.That(consumed.TryReportDeadBallPauseRequest(), Is.False,
                "either accepted dead-ball action consumes native Back authority");

            var replaying = new UnityPracticeBridgeSession(
                _ => { }, _ => { }, () => 100.0, "6000.3.0f1", _ => { });
            AdvanceToDead(replaying, resolution);
            replaying.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest, false)));
            replaying.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.replay", 11, "delivery-1",
                "{\"diagnostics\":true,\"resolution\":" + resolution + ",\"speed\":1}"));
            Assert.That(replaying.TryReportDeadBallPauseRequest(), Is.False);
            Assert.That(replaying.TryReportPauseRequest(), Is.False);
        }

        [Test]
        public void QueuedSameBallInsight_AfterActionConsumptionIsAckedWithoutResurrectionOrFatalError()
        {
            var emitted = new List<string>();
            var accepted = new List<string>();
            var resolution = UnityPracticeContractTestFixture.ResultPayload();
            var digest = ReplayDigestFromPayload(resolution);
            var session = new UnityPracticeBridgeSession(
                emitted.Add,
                emitted.Add,
                () => 100.0,
                "6000.3.0f1",
                envelope => accepted.Add(envelope.type));
            AdvanceToDead(session, resolution);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest)));
            Assert.That(session.TryReportDeadBallAction("delivery-1", digest, "practice_ball"), Is.True);
            emitted.Clear();
            accepted.Clear();

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 11, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(
                    digest, true, "Wait for the bounce")));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(OutboundTypes(emitted), Is.EqualTo(new[] { "bridge.ack" }));
            Assert.That(accepted, Is.Empty,
                "a superseded insight must not reach presentation and resurrect consumed controls");

            var wrongDigest = UnityPracticeContractTestFixture.DeadBallUiPayload(
                new string('0', 64), true, "Wrong ball");
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 12, "delivery-1", wrongDigest));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(OutboundTypes(emitted), Does.Contain("unity.error"));
        }

        [Test]
        public void Demonstration_CompletesOnItsOwnIdentityWithoutEnablingInput()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            AdvanceToSceneReady(session);
            var demonstration = UnityPracticeContractTestFixture.DemonstrationPayload();
            var digest = ReplayDigestFromPayload(demonstration);

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration", 8, "demo-1", demonstration));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Demonstrating));
            Assert.Throws<BridgeValidationException>(() => session.ReportPointer("down", "touch"),
                "a demonstration must never arm live batting input");
            session.ReportDeliveryDead(0.1, digest);
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            var dead = UnityPracticePacketCodec.Decode(emitted[emitted.Count - 1]).Envelope;
            Assert.That(dead.type, Is.EqualTo("unity.dead"));
            Assert.That(dead.deliveryId, Is.EqualTo("demo-1"));

            emitted.Clear();
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration_cancel", 9, "demo-1", "{}"));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(OutboundTypes(emitted), Is.EqualTo(new[] { "bridge.ack" }),
                "a Skip crossing the exact completion boundary must settle idempotently");
        }

        [Test]
        public void Demonstration_PreservesLastRealDeadBallIdentityForExactRebind()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            var resolution = UnityPracticeContractTestFixture.ResultPayload();
            var realDigest = ReplayDigestFromPayload(resolution);
            AdvanceToDead(session, resolution);

            var demonstration = UnityPracticeContractTestFixture.DemonstrationPayload();
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration", 10, "demo-1", demonstration));
            session.ReportDeliveryDead(0.1, ReplayDigestFromPayload(demonstration));

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 11, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(realDigest, false)));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(session.TryReportDeadBallAction("delivery-1", realDigest, "next_ball"), Is.True,
                "demo completion must not replace the last scored ball or its digest");
        }

        [Test]
        public void DemonstrationCancel_IsExactImmediateAndLeavesSceneReadyForLivePlay()
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 100.0, "6000.3.0f1", _ => { });
            AdvanceToSceneReady(session);
            var demonstration = UnityPracticeContractTestFixture.DemonstrationPayload();
            var digest = ReplayDigestFromPayload(demonstration);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration", 8, "demo-1", demonstration));

            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.demonstration_cancel", 9, "demo-1", "{}"));

            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.Throws<BridgeValidationException>(() => session.ReportDeliveryDead(0.1, digest),
                "a late completion after accepted cancel must not mutate the scene-ready lifecycle");
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 10, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Delivery));
        }

        [Test]
        public void NativeBackUnitySendMessageTarget_HasStablePublicSignature()
        {
            var method = typeof(VandeBridgeBehaviour).GetMethod(
                "RequestDeadBallPauseFromNativeBack",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public);

            Assert.That(method, Is.Not.Null);
            Assert.That(method.ReturnType, Is.EqualTo(typeof(void)));
            Assert.That(method.GetParameters(), Has.Length.EqualTo(1));
            Assert.That(method.GetParameters()[0].ParameterType, Is.EqualTo(typeof(string)));
        }

        private static void AdvanceToDead(UnityPracticeBridgeSession session, string resolution)
        {
            AdvanceToSceneReady(session);
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 8, "delivery-1", UnityPracticeContractTestFixture.DeliveryPayload));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.result", 9, "delivery-1", resolution));
            session.ReportDeliveryDead(0.1, ReplayDigestFromPayload(resolution));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
        }

        private static void AdvanceToSceneReady(UnityPracticeBridgeSession session)
        {
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.initialize", 0, null, UnityPracticeContractTestFixture.InitializePayload));
            for (var index = 1; index <= 5; index++)
                session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                    "host.clock_sync", index, null,
                    "{\"hostSendPerfMs\":" + index + ",\"sampleId\":\"clock-" + index + "\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.clock_selected", 6, null, "{\"sampleId\":\"clock-2\"}"));
            session.ReceivePacket(UnityPracticeContractTestFixture.HostPacket(
                "host.scene", 7, null, UnityPracticeContractTestFixture.ScenePayload()));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
        }

        private static string ReplaceFirst(string value, string before, string after)
        {
            var at = value.IndexOf(before, System.StringComparison.Ordinal);
            Assert.That(at, Is.GreaterThanOrEqualTo(0));
            return value.Substring(0, at) + after + value.Substring(at + before.Length);
        }

        private static string ReplaceClaimedDigest(string payload, string replacement)
        {
            const string marker = "\"replayDigest\":\"";
            var start = payload.IndexOf(marker, System.StringComparison.Ordinal);
            Assert.That(start, Is.GreaterThanOrEqualTo(0));
            start += marker.Length;
            return payload.Substring(0, start) + replacement + payload.Substring(start + 64);
        }

        private static string ReplayDigestFromPayload(string payload)
        {
            const string marker = "\"replayDigest\":\"";
            var start = payload.IndexOf(marker, System.StringComparison.Ordinal);
            Assert.That(start, Is.GreaterThanOrEqualTo(0));
            return payload.Substring(start + marker.Length, 64);
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
    }
}
