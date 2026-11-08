using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Bridge contract v7: the optional Target Chase block. Everything here reads the two TypeScript-written fixtures that sit
    /// in tests/fixtures/unity-practice/: practice-v3.json (the 28 Practice packets at v7) and chase-v7.json (a compact file of
    /// RECIPES on those packets plus a hand-written rule table). The recipe is applied here as text and must reproduce the
    /// length and SHA-256 that TypeScript recorded, so the canonical bytes are pinned across the two runtimes without a
    /// second 300 KB packet. Design: release/product-sequence/stage-3-chase/UNITY/BRIDGE-V7.md.
    /// </summary>
    public sealed class ChaseBridgeTests
    {
        // ---- fixtures ------------------------------------------------------------------------------------------------

        private static string FixturePath(string name)
        {
            return Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", name));
        }

        private static PracticeFixture practiceFixture;
        private static ChaseFixture chaseFixture;

        private static PracticeFixture Practice()
        {
            return practiceFixture ?? (practiceFixture = JsonUtility.FromJson<PracticeFixture>(File.ReadAllText(FixturePath("practice-v3.json"))));
        }

        private static ChaseFixture Chase()
        {
            return chaseFixture ?? (chaseFixture = JsonUtility.FromJson<ChaseFixture>(File.ReadAllText(FixturePath("chase-v7.json"))));
        }

        private static PracticeCase CaseOf(string id)
        {
            foreach (var item in Practice().cases) if (item.id == id) return item;
            throw new InvalidOperationException("no Practice case " + id);
        }

        private static string BodyOf(PracticeCase item, string kind)
        {
            switch (kind)
            {
                case "scene": return item.wire.packets.scene.body;
                case "delivery": return item.wire.packets.delivery.body;
                case "result": return item.wire.packets.result.body;
                case "replay": return item.wire.packets.replay.body;
                default: throw new ArgumentException(kind);
            }
        }

        // ---- the recipe of chase-v7.json, as exact text edits ---------------------------------------------------------

        private static string Once(string haystack, string needle, string replacement)
        {
            var at = haystack.IndexOf(needle, StringComparison.Ordinal);
            Assert.That(at, Is.GreaterThanOrEqualTo(0), needle);
            Assert.That(haystack.IndexOf(needle, at + 1, StringComparison.Ordinal), Is.EqualTo(-1), needle + " occurs twice");
            return haystack.Substring(0, at) + replacement + haystack.Substring(at + needle.Length);
        }

        private static string WithScore(string body, string score)
        {
            const string key = "\"score\":{";
            var start = body.IndexOf(key, StringComparison.Ordinal);
            Assert.That(start, Is.GreaterThanOrEqualTo(0));
            Assert.That(body.IndexOf(key, start + 1, StringComparison.Ordinal), Is.EqualTo(-1), "one score object");
            var end = body.IndexOf('}', start);
            return body.Substring(0, start) + "\"score\":" + score + body.Substring(end + 1);
        }

        private static string Derive(string baseBody, string kind, string score, string chase)
        {
            if (kind == "scene") return Once(baseBody, "\"conditions\":\"", "\"chase\":" + chase + ",\"conditions\":\"");
            if (kind == "result") return Once(WithScore(baseBody, score), "\"payload\":{", "\"payload\":{\"chase\":" + chase + ",");
            return Once(WithScore(baseBody, score), "\"resolution\":{", "\"resolution\":{\"chase\":" + chase + ",");
        }

        /// <summary>The canonical text of a chase block: sorted keys, no spaces; the rate is null unless the chase is in progress.</summary>
        private static string CanonicalChase(ChaseBlock block)
        {
            return "{\"ballsLeft\":" + block.ballsLeft + ",\"maxBalls\":" + block.maxBalls +
                   ",\"outcome\":\"" + block.outcome + "\",\"requiredRateX100\":" +
                   (block.outcome == "in_progress" ? block.requiredRateX100.ToString() : "null") +
                   ",\"runsNeeded\":" + block.runsNeeded + ",\"target\":" + block.target + "}";
        }

        private static string CanonicalScore(ScoreBlock score)
        {
            return "{\"balls\":" + score.balls + ",\"maxOvers\":" + score.maxOvers + ",\"runs\":" + score.runs +
                   ",\"wickets\":" + score.wickets + "}";
        }

        private static string DerivedBody(ChaseScenario scenario, string kind)
        {
            var baseCase = CaseOf(scenario.baseCase);
            return Derive(BodyOf(baseCase, kind), kind, CanonicalScore(scenario.score),
                CanonicalChase(kind == "scene" ? scenario.start : scenario.after));
        }

        private static string OuterJson(string body)
        {
            return JsonUtility.ToJson(new UnityPracticePacket { body = body, sha256 = Sha256Digest.OfUtf8(body) });
        }

        private static DecodedUnityPracticePacket Decode(string body)
        {
            return UnityPracticePacketCodec.Decode(OuterJson(body));
        }

        // ---- the fixtures ------------------------------------------------------------------------------------------------

        [Test]
        public void ChaseFixture_SitsOnThePracticeFixture_IsCurrent_AndStaysCompact()
        {
            var fixture = Chase();
            Assert.That(fixture.contractVersion, Is.EqualTo(BridgeConstants.ContractVersion));
            Assert.That(fixture.baseFixture.file, Is.EqualTo("practice-v3.json"));
            Assert.That(fixture.baseFixture.payloadSha256, Is.EqualTo(Practice().payloadSha256));
            Assert.That(new FileInfo(FixturePath("chase-v7.json")).Length, Is.LessThan(30000),
                "the chase fixture is a few KB of recipes and rules, never packets");
            Assert.That(fixture.scenarios, Has.Length.EqualTo(3));
            Assert.That(fixture.vectors.Length, Is.GreaterThanOrEqualTo(30));
        }

        [Test]
        public void EveryPracticePacket_DecodesAtV7_AndCarriesNoChase()
        {
            var count = 0;
            foreach (var item in Practice().cases)
            {
                foreach (var kind in new[] { "scene", "delivery", "result", "replay" })
                {
                    var body = BodyOf(item, kind);
                    var decoded = Decode(body);
                    Assert.That(decoded.Envelope.contractVersion, Is.EqualTo(7), item.id + "." + kind);
                    Assert.That(body, Does.Not.Contain("\"chase\""), item.id + "." + kind);
                    count++;
                }
            }

            Assert.That(count, Is.EqualTo(28));
        }

        [Test]
        public void ScenarioPackets_RederiveByteForByte_DecodeAndAreRefusedAtV6()
        {
            foreach (var scenario in Chase().scenarios)
            {
                var kinds = scenario.id == "won" ? new[] { "scene", "result", "replay" } : new[] { "scene", "result" };
                foreach (var kind in kinds)
                {
                    var seal = kind == "scene" ? scenario.scene : kind == "result" ? scenario.result : scenario.replay;
                    var label = scenario.id + "." + kind;
                    var body = DerivedBody(scenario, kind);
                    Assert.That(body.Length, Is.EqualTo(seal.bodyLength), label + " length");
                    Assert.That(Sha256Digest.OfUtf8(body), Is.EqualTo(seal.sha256), label + " sha256 (TypeScript wrote it)");
                    Assert.That(Decode(body).Envelope.type, Is.EqualTo("host." + kind), label);
                    var stale = body.Replace("\"contractVersion\":7", "\"contractVersion\":6");
                    var refused = Assert.Throws<BridgeValidationException>(() => Decode(stale), label + " at v6");
                    Assert.That(refused.Message, Is.EqualTo("Contract version is unsupported."));
                }
            }
        }

        [Test]
        public void Presentation_CarriesTheChaseOfTheSceneTheResultAndTheReplay_AndNothingForPractice()
        {
            foreach (var scenario in Chase().scenarios)
            {
                var scene = PracticePresentationContractAdapter.Scene(Decode(DerivedBody(scenario, "scene")).Envelope);
                AssertPresents(scenario.start, scene.Chase, scenario.id + " scene");
                var result = PracticePresentationContractAdapter.ResultFromValidated(Decode(DerivedBody(scenario, "result")).Envelope);
                AssertPresents(scenario.after, result.Chase, scenario.id + " result");
                Assert.That(result.TotalRuns, Is.EqualTo(scenario.score.runs), scenario.id);
                Assert.That(result.Balls, Is.EqualTo(scenario.score.balls), scenario.id);
                if (scenario.id == "won")
                {
                    var replay = PracticePresentationContractAdapter.ResultFromValidated(Decode(DerivedBody(scenario, "replay")).Envelope);
                    Assert.That(replay.IsReplay, Is.True);
                    AssertPresents(scenario.after, replay.Chase, "won replay");
                    Assert.That(replay.Chase.Decided && replay.Chase.Won, Is.True, "the replay of the deciding ball carries the verdict");
                }
            }

            foreach (var item in Practice().cases)
            {
                Assert.That(PracticePresentationContractAdapter.Scene(Decode(BodyOf(item, "scene")).Envelope).Chase, Is.Null, item.id);
                Assert.That(PracticePresentationContractAdapter.ResultFromValidated(Decode(BodyOf(item, "result")).Envelope).Chase,
                    Is.Null, item.id);
            }
        }

        private static void AssertPresents(ChaseBlock expected, PracticeChasePresentation actual, string label)
        {
            Assert.That(actual, Is.Not.Null, label);
            Assert.That(actual.Target, Is.EqualTo(expected.target), label);
            Assert.That(actual.MaxBalls, Is.EqualTo(expected.maxBalls), label);
            Assert.That(actual.RunsNeeded, Is.EqualTo(expected.runsNeeded), label);
            Assert.That(actual.BallsLeft, Is.EqualTo(expected.ballsLeft), label);
            var outcome = expected.outcome == "in_progress" ? PracticeChaseOutcome.InProgress
                : expected.outcome == "won" ? PracticeChaseOutcome.Won
                : expected.outcome == "lost_wicket" ? PracticeChaseOutcome.LostWicket
                : PracticeChaseOutcome.LostBalls;
            Assert.That(actual.Outcome, Is.EqualTo(outcome), label);
            if (expected.outcome == "in_progress") Assert.That(actual.RequiredRateX100, Is.EqualTo(expected.requiredRateX100), label);
            else Assert.That(actual.RequiredRateX100.HasValue, Is.False, label);
        }

        // ---- the shared rule table, and the rate -------------------------------------------------------------------------

        [Test]
        public void RuleTable_IsEvaluatedExactlyAsTheTableSays()
        {
            var accepted = 0;
            var rejected = 0;
            foreach (var row in Chase().vectors)
            {
                var verdict = true;
                try
                {
                    BridgeValidator.ValidateChase(
                        StrictJsonObject.Parse(row.chase),
                        string.IsNullOrEmpty(row.score) ? null : StrictJsonObject.Parse(row.score));
                }
                catch (BridgeValidationException)
                {
                    verdict = false;
                }

                Assert.That(verdict, Is.EqualTo(row.accept), row.id);
                if (verdict) accepted++; else rejected++;
            }

            Assert.That(accepted, Is.GreaterThan(0));
            Assert.That(rejected, Is.GreaterThan(0));
        }

        [Test]
        public void RequiredRate_IsTheExactHalfUpFigureForEveryPairTheContractAllows()
        {
            Assert.That(BridgeValidator.RequiredRateX100(14, 9), Is.EqualTo(933));
            Assert.That(BridgeValidator.RequiredRateX100(22, 12), Is.EqualTo(1100));
            Assert.That(BridgeValidator.RequiredRateX100(1, 12), Is.EqualTo(50));
            Assert.That(BridgeValidator.RequiredRateX100(360, 1), Is.EqualTo(216000));
            var different = 0;
            for (long needed = 1; needed <= 360; needed++)
            {
                for (long left = 1; left <= 60; left++)
                {
                    var exact = (decimal)needed * 600m / left;
                    if (BridgeValidator.RequiredRateX100(needed, left) != (long)decimal.Floor(exact + 0.5m)) different++;
                }
            }

            Assert.That(different, Is.EqualTo(0));
        }

        // ---- the session -------------------------------------------------------------------------------------------------

        private static string Quote(string text)
        {
            var builder = new StringBuilder("\"");
            foreach (var c in text)
            {
                if (c == '"' || c == '\\') builder.Append('\\');
                builder.Append(c);
            }

            return builder.Append('"').ToString();
        }

        private static string HostPacket(string sessionId, string type, long sequence, string deliveryId, string payload)
        {
            var body = "{\"buildId\":\"unity-golden-v3\",\"contractVersion\":" + BridgeConstants.ContractVersion +
                       ",\"deliveryId\":" + (deliveryId == null ? "null" : Quote(deliveryId)) +
                       ",\"messageId\":" + Quote(sessionId + ".chase-host-" + sequence) + ",\"payload\":" + payload +
                       ",\"sender\":\"host\",\"sequence\":" + sequence + ",\"sessionId\":" + Quote(sessionId) +
                       ",\"simVersion\":" + BridgeConstants.SimulationVersion + ",\"type\":" + Quote(type) + "}";
            return OuterJson(body);
        }

        private static string PayloadOf(string body)
        {
            var start = body.IndexOf("\"payload\":", StringComparison.Ordinal) + "\"payload\":".Length;
            var end = body.LastIndexOf(",\"sender\":", StringComparison.Ordinal);
            return body.Substring(start, end - start);
        }

        private sealed class SessionRun
        {
            public BridgeLifecycleState State;
            public bool UnityError;
        }

        private static SessionRun RunSession(string scenePayload, string deliveryId, string deliveryPayload, string resultPayload)
        {
            var emitted = new List<string>();
            var session = new UnityPracticeBridgeSession(emitted.Add, emitted.Add, () => 1000, "6000.3.0f1", _ => { });
            const string sessionId = "session-chase";
            var initialize = UnityPracticeContractTestFixture.InitializePayload.Replace("\"assistance\":\"learn\"", "\"assistance\":\"real\"");
            session.ReceivePacket(HostPacket(sessionId, "host.initialize", 0, null, initialize));
            for (var index = 1; index <= BridgeConstants.MinimumClockSamples; index++)
                session.ReceivePacket(HostPacket(sessionId, "host.clock_sync", index, null,
                    "{\"hostSendPerfMs\":" + index + ",\"sampleId\":\"clock-" + index + "\"}"));
            var sequence = BridgeConstants.MinimumClockSamples + 1;
            session.ReceivePacket(HostPacket(sessionId, "host.clock_selected", sequence++, null, "{\"sampleId\":\"clock-3\"}"));
            session.ReceivePacket(HostPacket(sessionId, "host.scene", sequence++, null, scenePayload));
            session.ReceivePacket(HostPacket(sessionId, "host.delivery", sequence++, deliveryId, deliveryPayload));
            session.ReceivePacket(HostPacket(sessionId, "host.result", sequence, deliveryId, resultPayload));
            var run = new SessionRun { State = session.State };
            foreach (var packet in emitted)
                if (UnityPracticePacketCodec.Decode(packet).Envelope.type == "unity.error") run.UnityError = true;
            return run;
        }

        [Test]
        public void Session_AcceptsAChaseResultOnlyForAChaseScene_WithTheSameTargetAndBalls()
        {
            foreach (var scenario in Chase().scenarios)
            {
                var baseCase = CaseOf(scenario.baseCase);
                var deliveryId = baseCase.wire.deliveryId;
                var delivery = PayloadOf(BodyOf(baseCase, "delivery"));
                var scene = PayloadOf(DerivedBody(scenario, "scene"));
                var result = PayloadOf(DerivedBody(scenario, "result"));
                var ok = RunSession(scene, deliveryId, delivery, result);
                Assert.That(ok.State, Is.EqualTo(BridgeLifecycleState.Resolved), scenario.id);
                Assert.That(ok.UnityError, Is.False, scenario.id);

                var startText = CanonicalChase(scenario.start);
                var afterText = CanonicalChase(scenario.after);
                var practiceScene = scene.Replace("\"chase\":" + startText + ",", string.Empty);
                Assert.That(practiceScene, Is.Not.EqualTo(scene));
                var refusedPractice = RunSession(practiceScene, deliveryId, delivery, result);
                Assert.That(refusedPractice.UnityError, Is.True, scenario.id + ": a Practice scene refuses a chase result");
                Assert.That(refusedPractice.State, Is.Not.EqualTo(BridgeLifecycleState.Resolved));

                var noChase = result.Replace("\"chase\":" + afterText + ",", string.Empty);
                Assert.That(noChase, Is.Not.EqualTo(result));
                var refusedMissing = RunSession(scene, deliveryId, delivery, noChase);
                Assert.That(refusedMissing.UnityError, Is.True, scenario.id + ": a chase scene refuses a result with no chase");

                // Another target that still agrees with the score (so the packet itself is valid): only the session rule can refuse it.
                var delta = scenario.after.outcome == "won" ? -1 : 1;
                var shifted = new ChaseBlock
                {
                    target = scenario.after.target + delta,
                    maxBalls = scenario.after.maxBalls,
                    ballsLeft = scenario.after.ballsLeft,
                    outcome = scenario.after.outcome,
                    runsNeeded = Math.Max(0, scenario.after.target + delta - scenario.score.runs)
                };
                shifted.requiredRateX100 = shifted.outcome == "in_progress"
                    ? (int)BridgeValidator.RequiredRateX100(shifted.runsNeeded, shifted.ballsLeft)
                    : 0;
                var otherTarget = result.Replace(afterText, CanonicalChase(shifted));
                Assert.That(otherTarget, Is.Not.EqualTo(result));
                Assert.That(Decode(DerivedBody(scenario, "result").Replace(afterText, CanonicalChase(shifted))).Envelope.type,
                    Is.EqualTo("host.result"), scenario.id + ": the shifted packet is valid on its own");
                var refusedTarget = RunSession(scene, deliveryId, delivery, otherTarget);
                Assert.That(refusedTarget.UnityError, Is.True, scenario.id + ": a result for another target");
            }
        }

        // ---- a camera swing and the bridge (owner brief 2 section 8, ruling R-9) -------------------------------------------

        private static string UnityPacket(string type, long sequence, string deliveryId, string payload)
        {
            var body = "{\"buildId\":\"unity-golden-v3\",\"contractVersion\":" + BridgeConstants.ContractVersion +
                       ",\"deliveryId\":" + (deliveryId == null ? "null" : Quote(deliveryId)) +
                       ",\"messageId\":\"camera-unity-" + sequence + "\",\"payload\":" + payload +
                       ",\"sender\":\"unity\",\"sequence\":" + sequence + ",\"sessionId\":\"session-camera\"" +
                       ",\"simVersion\":" + BridgeConstants.SimulationVersion + ",\"type\":" + Quote(type) + "}";
            return OuterJson(body);
        }

        [Test]
        public void UnityNeverSendsACamera_ItsPointerAndGestureMessagesRefuseOne()
        {
            foreach (var kind in new[] { "touch", "mouse", "pen", "keyboard" })
            {
                var pointer = UnityPacket("unity.pointer", 3, "d1",
                    "{\"atUnityMs\":10,\"clockSampleId\":\"clock-1\",\"phase\":\"down\",\"pointer\":\"" + kind + "\"}");
                Assert.That(UnityPracticePacketCodec.Decode(pointer).Envelope.type, Is.EqualTo("unity.pointer"), kind);
            }

            var camera = UnityPacket("unity.pointer", 3, "d1",
                "{\"atUnityMs\":10,\"clockSampleId\":\"clock-1\",\"phase\":\"down\",\"pointer\":\"camera\"}");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(camera));

            const string samples = "[{\"t\":10,\"x\":100,\"y\":500},{\"t\":20,\"x\":120,\"y\":420}]";
            string Gesture(string pointer) =>
                UnityPacket("unity.gesture", 4, "d1",
                    "{\"clockSampleId\":\"clock-1\",\"input\":{\"pointer\":\"" + pointer + "\",\"samples\":" + samples +
                    ",\"surface\":{\"height\":800,\"width\":400}},\"retention\":\"memory-until-resolution\"}");
            Assert.That(UnityPracticePacketCodec.Decode(Gesture("touch")).Envelope.type, Is.EqualTo("unity.gesture"));
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Gesture("camera")));
        }

        [Test]
        public void ACameraMadeSwing_IsAPlainNormalizedSwing_AndPassesAsProvisionalSwing()
        {
            // The camera is captured and normalized in the TypeScript/WebView layer. Across the bridge it is a NormalizedSwing,
            // which has no modality, so it is the same bytes as a touch swing.
            const string swing = "{\"directionDeg\":12,\"elevation\":0,\"footwork\":\"auto\",\"kind\":\"attack\",\"power\":0.64,\"startT\":0.31}";
            var body = "{\"buildId\":\"unity-golden-v3\",\"contractVersion\":" + BridgeConstants.ContractVersion +
                       ",\"deliveryId\":\"d1\",\"messageId\":\"camera-host-4\",\"payload\":{\"atPerfMs\":12345.5," +
                       "\"calibrationMs\":38,\"swing\":" + swing + "},\"sender\":\"host\",\"sequence\":4," +
                       "\"sessionId\":\"session-camera\",\"simVersion\":" + BridgeConstants.SimulationVersion +
                       ",\"type\":\"host.provisional_swing\"}";
            Assert.That(Decode(body).Envelope.type, Is.EqualTo("host.provisional_swing"));
        }

        // ---- a Coach demonstration never carries a chase ---------------------------------------------------------------------

        [Test]
        public void ACoachDemonstration_RefusesAChaseInItsResolution()
        {
            var item = CaseOf("early-attack");
            var delivery = PayloadOf(BodyOf(item, "delivery"));
            var resolution = PayloadOf(BodyOf(item, "result"));
            string Demonstration(string resolutionText) =>
                OuterJson("{\"buildId\":\"unity-golden-v3\",\"contractVersion\":" + BridgeConstants.ContractVersion +
                          ",\"deliveryId\":" + Quote(item.wire.deliveryId) + ",\"messageId\":\"demo-1\",\"payload\":{\"delivery\":" +
                          delivery + ",\"resolution\":" + resolutionText + ",\"speed\":1},\"sender\":\"host\",\"sequence\":3," +
                          "\"sessionId\":\"session-demo\",\"simVersion\":" + BridgeConstants.SimulationVersion +
                          ",\"type\":\"host.demonstration\"}");
            Assert.That(UnityPracticePacketCodec.Decode(Demonstration(resolution)).Envelope.type, Is.EqualTo("host.demonstration"));
            const string chase = "{\"ballsLeft\":11,\"maxBalls\":12,\"outcome\":\"in_progress\",\"requiredRateX100\":1200,\"runsNeeded\":22,\"target\":22}";
            var withChase = resolution.Insert(1, "\"chase\":" + chase + ",");
            var refused = Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Demonstration(withChase)));
            Assert.That(refused.Message, Is.EqualTo("A score-inert demonstration cannot carry a chase."));
        }

        // ---- fixture shapes (JsonUtility) -------------------------------------------------------------------------------------

        [Serializable] private sealed class PracticeFixture
        {
            public string payloadSha256;
            public PracticeCase[] cases;
        }

        [Serializable] private sealed class PracticeCase
        {
            public string id;
            public PracticeWire wire;
        }

        [Serializable] private sealed class PracticeWire
        {
            public string deliveryId;
            public PracticePackets packets;
        }

        [Serializable] private sealed class PracticePackets
        {
            public PacketText scene;
            public PacketText delivery;
            public PacketText result;
            public PacketText replay;
        }

        [Serializable] private sealed class PacketText
        {
            public string body;
            public string sha256;
        }

        [Serializable] private sealed class ChaseFixture
        {
            public int contractVersion;
            public BaseFixture baseFixture;
            public ChaseScenario[] scenarios;
            public RuleRow[] vectors;
        }

        [Serializable] private sealed class BaseFixture
        {
            public string file;
            public string payloadSha256;
        }

        [Serializable] private sealed class ChaseScenario
        {
            public string id;
            public string baseCase;
            public int target;
            public ScoreBlock score;
            public ChaseBlock start;
            public ChaseBlock after;
            public Seal scene;
            public Seal result;
            public Seal replay;
        }

        [Serializable] private sealed class Seal
        {
            public string sha256;
            public int bodyLength;
        }

        [Serializable] private sealed class ScoreBlock
        {
            public int balls;
            public int maxOvers;
            public int runs;
            public int wickets;
        }

        [Serializable] private sealed class ChaseBlock
        {
            public int ballsLeft;
            public int maxBalls;
            public string outcome;
            public int requiredRateX100;
            public int runsNeeded;
            public int target;
        }

        [Serializable] private sealed class RuleRow
        {
            public string id;
            public string chase;
            public string score;
            public bool accept;
        }
    }
}
