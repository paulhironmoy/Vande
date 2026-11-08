using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Reads the single TS-generated artifact in the repository. Nothing is
    /// copied into the Unity project, so a production contract change must pass
    /// both runtimes against the same exact packet bytes.
    /// </summary>
    public sealed class UnityPracticeSharedWireGoldenTests
    {
        // Contract v7 / simulation v3 corpus written by the supported TS generator
        // (scripts/practice-unity-goldens.mjs) on the phase-5f physics freeze (FROZEN-5f, 2026-11-04T06:30Z,
        // release/product-sequence/stage-1-practice/wedge/physics/phase5/FROZEN-5f.repo.sha256; re-pinned by
        // UNITY-2 on the lead's relay), with the outside-edge thin-edge case (ref-1, 8 ms late). Its bat
        // probes come from the 5b quintic batAt, which Unity's bat presenter mirrors.
        // Re-pinned 2026-11-08 for contract v7: the 28 packets differ from the v6 corpus (4f1e2bb5...) by the version
        // digit alone and the SHA-256s that cover it (proof: release/product-sequence/stage-3-chase/UNITY/proof/golden-v6-to-v7.txt).
        private const string ExpectedPayloadSha =
            "b3a1fa5560e306edeb84243818ce32397eab745e0f5e0dad50e82c0230b0433a";

        [Test]
        public void SevenTypeScriptGoldens_DecodeProjectAndReplayExactlyOnce()
        {
            var path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            if (!File.Exists(path) || ExpectedPayloadSha == "PENDING_PRACTICE_V3_REGENERATION")
                Assert.Ignore("practice-v3 shared golden and its locked payload SHA are pending TS regeneration.");
            Assert.That(File.Exists(path), Is.True,
                "shared TS Unity golden fixture must remain at its repository path");
            var fixture = JsonUtility.FromJson<SharedFixture>(File.ReadAllText(path));
            Assert.That(fixture, Is.Not.Null);
            Assert.That(fixture.fixtureVersion, Is.EqualTo(3));
            Assert.That(fixture.simulationVersion, Is.EqualTo(BridgeConstants.SimulationVersion));
            Assert.That(fixture.payloadSha256, Is.EqualTo(ExpectedPayloadSha));
            Assert.That(fixture.cases, Has.Length.EqualTo(7));

            foreach (var item in fixture.cases)
            {
                Assert.That(item, Is.Not.Null);
                Assert.That(item.wire, Is.Not.Null, item.id);
                Assert.That(item.wire.packets, Is.Not.Null, item.id);
                var scenePacket = DecodeExact(item.wire.packets.scene);
                var deliveryPacket = DecodeExact(item.wire.packets.delivery);
                var resultPacket = DecodeExact(item.wire.packets.result);
                var replayPacket = DecodeExact(item.wire.packets.replay);

                Assert.That(scenePacket.Envelope.type, Is.EqualTo("host.scene"), item.id);
                Assert.That(deliveryPacket.Envelope.type, Is.EqualTo("host.delivery"), item.id);
                Assert.That(resultPacket.Envelope.type, Is.EqualTo("host.result"), item.id);
                Assert.That(replayPacket.Envelope.type, Is.EqualTo("host.replay"), item.id);
                Assert.That(resultPacket.Envelope.deliveryId, Is.EqualTo(item.wire.deliveryId), item.id);
                Assert.That(replayPacket.Envelope.deliveryId, Is.EqualTo(item.wire.deliveryId), item.id);

                var scene = PracticePresentationContractAdapter.Scene(scenePacket.Envelope);
                var delivery = PracticePresentationContractAdapter.Delivery(deliveryPacket.Envelope);
                var result = PracticePresentationContractAdapter.Result(resultPacket.Envelope);
                var replay = PracticePresentationContractAdapter.Result(replayPacket.Envelope);
                Assert.That(scene.Fielders, Has.Length.EqualTo(11), item.id);
                Assert.That(scene.BowlerLookSeed, Is.Not.Null.And.Not.Empty, item.id);
                if (scene.BowlerFamily == "pace")
                {
                    Assert.That(scene.BowlerPaceBand,
                        Is.EqualTo("controlled").Or.EqualTo("fast").Or.EqualTo("express"), item.id);
                    Assert.That(scene.BowlerSpinType, Is.Null.Or.Empty, item.id);
                }
                else
                {
                    Assert.That(scene.BowlerSpinType,
                        Is.EqualTo("finger").Or.EqualTo("wrist"), item.id);
                    Assert.That(scene.BowlerPaceBand, Is.Null.Or.Empty, item.id);
                }
                Assert.That(delivery.Flight.Length, Is.GreaterThan(100), item.id);
                Assert.That(result.ReplayDigest, Is.EqualTo(item.wire.replayDigest), item.id);
                Assert.That(replay.ReplayDigest, Is.EqualTo(item.wire.replayDigest), item.id);
                Assert.That(result.ShotIntent,
                    Is.EqualTo("attack").Or.EqualTo("defend"), item.id);
                Assert.That(replay.ShotIntent, Is.EqualTo(result.ShotIntent), item.id);
                Assert.That(CanonicalTraceDigest.Compute(result.Trace),
                    Is.EqualTo(item.digests.canonicalTraceSha256), item.id);
                Assert.That(result.Trace.ball, Has.Length.EqualTo(item.result.ballSampleCount), item.id);
                Assert.That(result.Trace.bat, Has.Length.EqualTo(item.result.batSampleCount), item.id);
                Assert.That(result.Trace.fielders, Has.Length.EqualTo(11), item.id);
                Assert.That(result.Trace.durationSeconds,
                    Is.EqualTo(item.result.deadT).Within(0.000000001), item.id);
                Assert.That(result.Trace.ball[0].t, Is.EqualTo(0), item.id);
                Assert.That(result.Trace.ball[result.Trace.ball.Length - 1].t,
                    Is.LessThanOrEqualTo(result.Trace.durationSeconds + 0.000001), item.id);
                Assert.That(result.Trace.events[0].kind, Is.EqualTo("release"), item.id);
                Assert.That(result.Trace.events[result.Trace.events.Length - 1].kind,
                    Is.EqualTo("dead"), item.id);
                Assert.That(CanonicalTraceDigest.Compute(replay.Trace),
                    Is.EqualTo(CanonicalTraceDigest.Compute(result.Trace)), item.id);

                Assert.That(item.tracePlayback, Is.Not.Null, item.id);
                Assert.That(item.tracePlayback.batterRootOffset, Is.Not.Null, item.id);
                Assert.That(result.Trace.batterRootOffset.x,
                    Is.EqualTo(item.tracePlayback.batterRootOffset.x).Within(0.000000000001), item.id);
                Assert.That(result.Trace.batterRootOffset.z,
                    Is.EqualTo(item.tracePlayback.batterRootOffset.z).Within(0.000000000001), item.id);
                Assert.That(item.tracePlayback.batterPosture, Is.Not.Null, item.id);
                Assert.That(result.Trace.batterPosture.crouchM,
                    Is.EqualTo(item.tracePlayback.batterPosture.crouchM).Within(0.000000000001), item.id);
                Assert.That(result.Trace.batterMotion == null,
                    Is.EqualTo(item.tracePlayback.batterMotion == null), item.id);
                if (result.Trace.batterMotion != null)
                {
                    Assert.That(result.Trace.batterMotion.startT,
                        Is.EqualTo(item.tracePlayback.batterMotion.startT).Within(0.000000000001), item.id);
                    Assert.That(result.Trace.batterMotion.contactT,
                        Is.EqualTo(item.tracePlayback.batterMotion.contactT).Within(0.000000000001), item.id);
                    Assert.That(result.Trace.batterMotion.endT,
                        Is.EqualTo(item.tracePlayback.batterMotion.endT).Within(0.000000000001), item.id);
                }
                Assert.That(item.tracePlayback.batProbes, Is.Not.Null, item.id);
                if (result.Trace.bat.Length == 0)
                    Assert.That(item.tracePlayback.batProbes, Is.Empty, item.id);
                else
                    Assert.That(item.tracePlayback.batProbes, Is.Not.Empty, item.id);
                for (var probeIndex = 0;
                     probeIndex < item.tracePlayback.batProbes.Length;
                     probeIndex++)
                {
                    var probe = item.tracePlayback.batProbes[probeIndex];
                    Assert.That(probe, Is.Not.Null, item.id + " probe " + probeIndex);
                    var probeTarget = new CountingTarget();
                    var probePlayback = new CanonicalTracePlayback(result.Trace, probeTarget);
                    probePlayback.Seek(probe.t);
                    var probeLabel = item.id + " bat probe " + probeIndex + " at " + probe.t;
                    // JsonUtility materializes an explicit JSON null for this nested serializable class as a complete
                    // default object (including three zero vectors). A real canonical bat cannot be that shape: its
                    // grip/toe are 0.86 m apart and its face is unit length. Preserve null-vs-pose authority while
                    // still rejecting a partially decoded pose.
                    var hasAnyBatVector = probe.bat != null &&
                                          (probe.bat.grip != null || probe.bat.toe != null || probe.bat.face != null);
                    var hasAllBatVectors = probe.bat != null &&
                                           probe.bat.grip != null && probe.bat.toe != null && probe.bat.face != null;
                    Assert.That(hasAnyBatVector, Is.EqualTo(hasAllBatVectors),
                        probeLabel + " must be either explicit null or a complete rigid pose");
                    var materializedNull = hasAllBatVectors &&
                                           IsZeroVector(probe.bat.grip) &&
                                           IsZeroVector(probe.bat.toe) &&
                                           IsZeroVector(probe.bat.face);
                    var hasCompleteBat = hasAllBatVectors && !materializedNull;
                    if (!hasCompleteBat)
                    {
                        Assert.That(probeTarget.Bat, Is.Null, probeLabel);
                        Assert.That(probeTarget.BatUpdates, Is.Zero,
                            probeLabel + " must not synthesize a first-knot bat before its domain");
                    }
                    else
                    {
                        Assert.That(probeTarget.Bat, Is.Not.Null, probeLabel);
                        AssertVectorNear(probeTarget.Bat.grip, probe.bat.grip, probeLabel + " grip");
                        AssertVectorNear(probeTarget.Bat.toe, probe.bat.toe, probeLabel + " toe");
                        AssertVectorNear(probeTarget.Bat.face, probe.bat.face, probeLabel + " face");
                    }
                }

                ExerciseLifecycleOnce(scenePacket.Envelope, deliveryPacket.Envelope,
                    resultPacket.Envelope, result.Trace.durationSeconds, item.wire.replayDigest, item.id);

                var target = new CountingTarget();
                var playback = new CanonicalTracePlayback(result.Trace, target);
                playback.Advance(result.Trace.durationSeconds + 1.0);
                playback.Advance(1.0);
                Assert.That(playback.Completed, Is.True, item.id);
                Assert.That(target.Events, Is.EqualTo(result.Trace.events.Length), item.id);
                Assert.That(target.DeadEvents, Is.EqualTo(1), item.id);
                Assert.That(target.CompletionSignals, Is.EqualTo(1), item.id);
                CollectionAssert.AreEquivalent(SceneIds(scene), target.FielderIds, item.id);
            }
        }

        private static bool IsZeroVector(TraceVector3 value)
        {
            return value.x == 0.0 && value.y == 0.0 && value.z == 0.0;
        }

        private static void ExerciseLifecycleOnce(
            UnityPracticeEnvelope scene,
            UnityPracticeEnvelope delivery,
            UnityPracticeEnvelope result,
            double deadT,
            string replayDigest,
            string caseId)
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(
                emitted.Add, emitted.Add, () => 1000, "6000.3.0f1", _ => { });
            var initialize = UnityPracticeContractTestFixture.InitializePayload.Replace(
                "\"assistance\":\"learn\"", "\"assistance\":\"real\"");
            session.ReceivePacket(HostPacket(scene.buildId, scene.sessionId,
                "host.initialize", 0, null, initialize));
            for (var index = 1; index <= BridgeConstants.MinimumClockSamples; index++)
                session.ReceivePacket(HostPacket(scene.buildId, scene.sessionId,
                    "host.clock_sync", index, null,
                    "{\"hostSendPerfMs\":" + index + ",\"sampleId\":\"clock-" + index + "\"}"));
            var sequence = BridgeConstants.MinimumClockSamples + 1;
            session.ReceivePacket(HostPacket(scene.buildId, scene.sessionId,
                "host.clock_selected", sequence++, null, "{\"sampleId\":\"clock-3\"}"));
            session.ReceivePacket(HostPacket(scene.buildId, scene.sessionId,
                "host.scene", sequence++, null, scene.payloadJson));
            session.ReceivePacket(HostPacket(scene.buildId, scene.sessionId,
                "host.delivery", sequence++, delivery.deliveryId, delivery.payloadJson));
            session.ReceivePacket(HostPacket(scene.buildId, scene.sessionId,
                "host.result", sequence, result.deliveryId, result.payloadJson));
            Assert.That(session.State, Is.EqualTo(BridgeLifecycleState.Resolved), caseId);

            session.ReportDeliveryDead(deadT, replayDigest);
            var deadPackets = 0;
            UnityPracticeEnvelope dead = null;
            foreach (var packet in emitted)
            {
                var envelope = UnityPracticePacketCodec.Decode(packet).Envelope;
                if (envelope.type != "unity.dead") continue;
                deadPackets++;
                dead = envelope;
            }
            Assert.That(deadPackets, Is.EqualTo(1), caseId);
            Assert.That(dead, Is.Not.Null, caseId);
            StringAssert.Contains("\"replayDigest\":\"" + replayDigest + "\"", dead.payloadJson, caseId);
        }

        private static string HostPacket(
            string buildId,
            string sessionId,
            string type,
            long sequence,
            string deliveryId,
            string payload)
        {
            var integer = sequence.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var body = "{" +
                       "\"buildId\":\"" + buildId + "\"," +
                       "\"contractVersion\":" + BridgeConstants.ContractVersion + "," +
                       "\"deliveryId\":" + (deliveryId == null ? "null" : "\"" + deliveryId + "\"") + "," +
                       "\"messageId\":\"" + sessionId + ".golden-host-" + integer + "\"," +
                       "\"payload\":" + payload + "," +
                       "\"sender\":\"host\"," +
                       "\"sequence\":" + integer + "," +
                       "\"sessionId\":\"" + sessionId + "\"," +
                       "\"simVersion\":" + BridgeConstants.SimulationVersion + "," +
                       "\"type\":\"" + type + "\"}";
            return JsonUtility.ToJson(new UnityPracticePacket
            {
                body = body,
                sha256 = Sha256Digest.OfUtf8(body)
            });
        }

        private static DecodedUnityPracticePacket DecodeExact(UnityPracticePacket packet)
        {
            Assert.That(packet, Is.Not.Null);
            return UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet));
        }

        private static string[] SceneIds(PracticeScenePresentation scene)
        {
            var ids = new string[scene.Fielders.Length];
            for (var index = 0; index < ids.Length; index++) ids[index] = scene.Fielders[index].Id;
            return ids;
        }

        private static void AssertVectorNear(TraceVector3 actual, TraceVector3 expected, string label)
        {
            Assert.That(actual, Is.Not.Null, label);
            Assert.That(expected, Is.Not.Null, label);
            Assert.That(actual.x, Is.EqualTo(expected.x).Within(0.000000001), label + " x");
            Assert.That(actual.y, Is.EqualTo(expected.y).Within(0.000000001), label + " y");
            Assert.That(actual.z, Is.EqualTo(expected.z).Within(0.000000001), label + " z");
        }

        private sealed class CountingTarget : ICanonicalTraceTarget
        {
            public readonly HashSet<string> FielderIds = new HashSet<string>(StringComparer.Ordinal);
            public int Events;
            public int DeadEvents;
            public int CompletionSignals;
            public BatTraceSample Bat { get; private set; }
            public int BatUpdates { get; private set; }

            public void SetBall(BallTraceSample sample) { }
            public void SetBat(BatTraceSample sample)
            {
                Bat = sample;
                BatUpdates++;
            }
            public void SetFielder(string fielderId, FielderTraceSample sample)
            {
                FielderIds.Add(fielderId);
            }
            public void EmitEvent(CanonicalTraceEvent traceEvent)
            {
                Events++;
                if (traceEvent.kind == "dead") DeadEvents++;
            }
            public void SetPlaybackCompleted(bool completed)
            {
                if (completed) CompletionSignals++;
            }
        }

        [Serializable] private sealed class SharedFixture
        {
            public int fixtureVersion;
            public int simulationVersion;
            public string payloadSha256;
            public SharedCase[] cases;
        }

        [Serializable] private sealed class SharedCase
        {
            public string id;
            public SharedDigests digests;
            public SharedResultSummary result;
            public SharedTracePlayback tracePlayback;
            public SharedWire wire;
        }

        [Serializable] private sealed class SharedTracePlayback
        {
            public TraceVector2 batterRootOffset;
            public TraceBatterPosture batterPosture;
            public TraceBatterMotion batterMotion;
            public SharedBatProbe[] batProbes;
        }

        [Serializable] private sealed class SharedBatProbe
        {
            public double t;
            public SharedBatPose bat;
        }

        [Serializable] private sealed class SharedBatPose
        {
            public TraceVector3 grip;
            public TraceVector3 toe;
            public TraceVector3 face;
        }

        [Serializable] private sealed class SharedDigests
        {
            public string canonicalTraceSha256;
        }

        [Serializable] private sealed class SharedResultSummary
        {
            public int ballSampleCount;
            public int batSampleCount;
            public double deadT;
        }

        [Serializable] private sealed class SharedWire
        {
            public string deliveryId;
            public string replayDigest;
            public SharedPackets packets;
        }

        [Serializable] private sealed class SharedPackets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket result;
            public UnityPracticePacket replay;
        }
    }
}
