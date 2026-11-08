using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;

namespace Vande.Practice.Tests
{
    public sealed class UnityPracticePacketTests
    {
        private const string InitializeBody =
            "{\"buildId\":\"build-1\",\"contractVersion\":7,\"deliveryId\":null," +
            "\"messageId\":\"host-0\",\"payload\":{\"assistance\":\"learn\",\"audio\":true," +
            "\"captions\":true,\"coordinateSystem\":\"vande-striker-frame-v1\",\"deviceTier\":\"full\"," +
            "\"handedness\":\"right\",\"handednessPolicy\":\"physics-right-handed-presentation-mirrors-once\"," +
            "\"haptics\":true,\"highContrast\":false,\"locale\":\"en-IN\",\"pixelsPerDp\":1," +
            "\"quality\":\"standard\"," +
            "\"reducedMotion\":false,\"textScale\":1}," +
            "\"sender\":\"host\",\"sequence\":0," +
            "\"sessionId\":\"session-1\",\"simVersion\":3,\"type\":\"host.initialize\"}";

        [Test]
        public void Decode_AcceptsExactTypescriptV5Envelope()
        {
            var decoded = UnityPracticePacketCodec.Decode(Packet(InitializeBody));

            Assert.That(decoded.Envelope.contractVersion, Is.EqualTo(BridgeConstants.ContractVersion));
            Assert.That(decoded.Envelope.simVersion, Is.EqualTo(BridgeConstants.SimulationVersion));
            Assert.That(decoded.Envelope.sender, Is.EqualTo("host"));
            Assert.That(decoded.Envelope.type, Is.EqualTo("host.initialize"));
            Assert.That(decoded.Envelope.deliveryId, Is.Null);
            var settings = PracticePresentationContractAdapter.Initialize(decoded.Envelope);
            Assert.That(settings.TextScale, Is.EqualTo(1f));
            Assert.That(settings.HighContrast, Is.False);
            Assert.That(settings.PixelsPerDp, Is.EqualTo(1f));
        }

        [TestCase("\"textScale\":1", "\"textScale\":0")]
        [TestCase("\"textScale\":1", "\"textScale\":2.01")]
        [TestCase("\"pixelsPerDp\":1", "\"pixelsPerDp\":0")]
        [TestCase("\"pixelsPerDp\":1", "\"pixelsPerDp\":8.01")]
        public void Initialize_RejectsAccessibilityOrDensityOutsideStrictBounds(
            string before,
            string after)
        {
            var body = InitializeBody.Replace(before, after);
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Packet(body)));
        }

        [Test]
        public void DeadBallUi_EnforcesBoundedCopyAndActionHierarchy()
        {
            var result = UnityPracticeContractTestFixture.ResultPayload();
            var digest = ReplayDigestFromPayload(result);
            var valid = UnityPracticeContractTestFixture.HostPacket(
                "host.dead_ball_ui", 10, "delivery-1",
                UnityPracticeContractTestFixture.DeadBallUiPayload(digest));

            var decoded = UnityPracticePacketCodec.Decode(valid).Envelope;
            Assert.That(decoded.type, Is.EqualTo("host.dead_ball_ui"));
            StringAssert.Contains("\"recommendation\":\"\"", decoded.payloadJson,
                "the asynchronous first frame may truthfully leave recommendation empty");

            var packet = JsonUtility.FromJson<UnityPracticePacket>(valid);
            packet.body = packet.body.Replace(
                "\"primaryAction\":\"practice_ball\"",
                "\"primaryAction\":\"next_ball\"");
            packet.sha256 = Sha256Digest.OfUtf8(packet.body);
            Assert.Throws<BridgeValidationException>(() =>
                UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)),
                "next_ball cannot retain a competing secondary action");

            packet = JsonUtility.FromJson<UnityPracticePacket>(valid);
            packet.body = packet.body.Replace(
                "\"recommendation\":\"\"",
                "\"recommendation\":\"bad\\ncopy\"");
            packet.sha256 = Sha256Digest.OfUtf8(packet.body);
            Assert.Throws<BridgeValidationException>(() =>
                UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)),
                "localized dead-ball copy cannot contain control characters");
        }

        [Test]
        public void Decode_RejectsIntegrityMismatch()
        {
            var packet = new UnityPracticePacket { body = InitializeBody, sha256 = new string('0', 64) };

            Assert.Throws<BridgeValidationException>(() =>
                UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)));
        }

        [Test]
        public void Decode_RejectsSenderTypeMismatch()
        {
            var body = InitializeBody.Replace("\"sender\":\"host\"", "\"sender\":\"unity\"");

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Packet(body)));
        }

        [Test]
        public void Decode_RejectsDuplicateJsonField()
        {
            var body = InitializeBody.Replace("{\"buildId\":", "{\"buildId\":\"other\",\"buildId\":");

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Packet(body)));
        }

        [Test]
        public void Decode_RejectsChecksummedButNoncanonicalBody()
        {
            var body = InitializeBody.Replace("\"contractVersion\":7", "\"contractVersion\": 7");

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Packet(body)));
        }

        [TestCase("0", "-0")]
        [TestCase("0", "0.0")]
        [TestCase("0", "0e0")]
        public void Decode_RejectsNoncanonicalNumbersInsideNestedPayload(string canonical, string mutation)
        {
            var original = UnityPracticeContractTestFixture.HostPacket(
                "host.scene", 0, null, UnityPracticeContractTestFixture.ScenePayload());
            var packet = JsonUtility.FromJson<UnityPracticePacket>(original);
            packet.body = packet.body.Replace("\"lateralM\":" + canonical,
                "\"lateralM\":" + mutation);
            packet.sha256 = Sha256Digest.OfUtf8(packet.body);

            Assert.Throws<BridgeValidationException>(() =>
                UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)));
        }

        [Test]
        public void Decode_RejectsUnsupportedTopLevelPayloadField()
        {
            var body = InitializeBody.Replace(
                "\"textScale\":1}",
                "\"textScale\":1,\"unsupported\":true}");

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Packet(body)));
        }

        [Test]
        public void Decode_AcceptsBoundedLocaleUpdateAndRejectsEmbellishment()
        {
            var decoded = UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.locale", 1, null, "{\"locale\":\"hi-Latn\"}"));
            Assert.That(decoded.Envelope.type, Is.EqualTo("host.locale"));
            Assert.That(PracticePresentationContractAdapter.Locale(decoded.Envelope), Is.EqualTo("hi-Latn"));

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.locale", 1, null,
                    "{\"locale\":\"hi\",\"unsupported\":true}")));
        }

        [TestCase("\"id\":\"fielder-1\"", "\"id\":\"fielder-0\"")]
        [TestCase("\"role\":\"keeper\"", "\"role\":\"astronaut\"")]
        public void Decode_RejectsInvalidSceneFielderIdentityOrRole(string before, string after)
        {
            var payload = UnityPracticeContractTestFixture.ScenePayload().Replace(before, after);
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.scene", 0, null, payload)));
        }

        [TestCase("\"fieldIntent\":\"attack_the_stumps\",", "\"fieldIntent\":\"unknown\",")]
        [TestCase("\"trainingObjective\":\"random\"", "\"trainingObjective\":\"daily\"")]
        public void Decode_RejectsUnsupportedSceneSetupMetadata(string before, string after)
        {
            var payload = UnityPracticeContractTestFixture.ScenePayload().Replace(before, after);
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.scene", 0, null, payload)));
        }

        [TestCase("\"fieldIntent\":\"attack_the_stumps\",")]
        [TestCase(",\"trainingObjective\":\"random\"")]
        public void Decode_RejectsMissingSceneSetupMetadata(string field)
        {
            var payload = UnityPracticeContractTestFixture.ScenePayload().Replace(field, string.Empty);
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.scene", 0, null, payload)));
        }

        [Test]
        public void Decode_RejectsEmptyOrNonmonotonicAuthoritativeFlightSamples()
        {
            var delivery = UnityPracticeContractTestFixture.DeliveryPayload;
            var samplesStart = delivery.IndexOf("\"samples\":[", System.StringComparison.Ordinal);
            var samplesEnd = delivery.IndexOf("],\"seam\":", samplesStart, System.StringComparison.Ordinal);
            Assert.That(samplesStart, Is.GreaterThanOrEqualTo(0));
            Assert.That(samplesEnd, Is.GreaterThan(samplesStart));
            var empty = delivery.Substring(0, samplesStart) + "\"samples\":[]" +
                        delivery.Substring(samplesEnd + 1);
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.delivery", 0, "delivery-1", empty)));

            var nonmonotonic = delivery.Replace("\"t\":0.5", "\"t\":-0.1");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.delivery", 0, "delivery-1", nonmonotonic)));
        }

        [Test]
        public void DeliveryGuidance_IsStrictMutuallyExclusiveAndProjectedFromAuthoritativeData()
        {
            var coached = UnityPracticeContractTestFixture.DeliveryPayload.Replace(
                "{\"coach\":null,\"learnCue\":false}",
                "{\"coach\":{\"contactPoint\":{\"x\":0.2,\"y\":0.8,\"z\":9}," +
                "\"contactT\":0.45,\"stage\":3},\"learnCue\":false}");
            var decoded = UnityPracticePacketCodec.Decode(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 0, "delivery-1", coached));
            var projected = PracticePresentationContractAdapter.Delivery(decoded.Envelope);
            Assert.That(projected.LearnCue, Is.False);
            Assert.That(projected.CoachGuide.Stage, Is.EqualTo(3));
            Assert.That(projected.CoachGuide.ContactT, Is.EqualTo(0.45));
            Assert.That(projected.CoachGuide.ContactPoint.x, Is.EqualTo(0.2));

            var learnAndCoach = coached.Replace("\"learnCue\":false", "\"learnCue\":true");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.delivery", 0, "delivery-1", learnAndCoach)));

            var incomplete = coached.Replace("\"contactT\":0.45", "\"contactT\":null");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.delivery", 0, "delivery-1", incomplete)));
        }

        [Test]
        public void DeliveryProjection_CarriesAuthoritativeBowlerReadInputsWithoutReinterpretation()
        {
            var payload = UnityPracticeContractTestFixture.DeliveryPayload
                .Replace("\"variation\":\"stock\"", "\"variation\":\"cutter\"")
                .Replace("\"lengthM\":6", "\"lengthM\":5.4")
                .Replace("\"lineM\":0", "\"lineM\":0.18")
                .Replace("\"speedKph\":130", "\"speedKph\":126")
                .Replace("\"seamDeg\":0", "\"seamDeg\":25")
                .Replace("\"wobble\":0", "\"wobble\":-0.35")
                .Replace("\"bounce\":null",
                    "\"bounce\":{\"p\":{\"x\":0.04,\"y\":0,\"z\":1.2},\"t\":0.25}")
                .Replace("\"afterBounce\":null",
                    "\"afterBounce\":{\"x\":3,\"y\":4,\"z\":5}");
            var decoded = UnityPracticePacketCodec.Decode(UnityPracticeContractTestFixture.HostPacket(
                "host.delivery", 0, "delivery-1", payload));

            var projected = PracticePresentationContractAdapter.Delivery(decoded.Envelope);

            Assert.That(projected.Variation, Is.EqualTo("cutter"));
            Assert.That(projected.PlannedLengthM, Is.EqualTo(5.4));
            Assert.That(projected.PlannedLineM, Is.EqualTo(0.18));
            Assert.That(projected.PlannedSpeedKph, Is.EqualTo(126));
            Assert.That(projected.ReleaseSpeedKph, Is.EqualTo(126));
            Assert.That(projected.ReleaseSeamDeg, Is.EqualTo(25));
            Assert.That(projected.SeamWobble, Is.EqualTo(-0.35));
            Assert.That(projected.SpinRps, Is.EqualTo(10));
            Assert.That(projected.BounceT, Is.EqualTo(0.25));
            Assert.That(projected.AfterBounceSpinAxis.x, Is.EqualTo(3));
            Assert.That(projected.AfterBounceSpinAxis.y, Is.EqualTo(4));
            Assert.That(projected.AfterBounceSpinAxis.z, Is.EqualTo(5));
            Assert.That(projected.SeamAxis.y, Is.EqualTo(1));
            Assert.That(projected.ShineDirection.x, Is.EqualTo(1));
        }

        [Test]
        public void Decode_RejectsValuesOutsideUnityFloatAndTraceTimeDomains()
        {
            var scene = UnityPracticeContractTestFixture.ScenePayload()
                .Replace("\"x\":-5,\"z\":0", "\"x\":1000001,\"z\":0");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.scene", 0, null, scene)));

            var oversizedSpin = UnityPracticeContractTestFixture.DeliveryPayload
                .Replace("\"spinRps\":10", "\"spinRps\":1000001");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.delivery", 0, "delivery-1", oversizedSpin)));

            var oversizedVector = UnityPracticeContractTestFixture.DeliveryPayload
                .Replace("\"p\":{\"x\":0,\"y\":2,\"z\":-8.69}",
                    "\"p\":{\"x\":1000001,\"y\":2,\"z\":-8.69}");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.delivery", 0, "delivery-1", oversizedVector)));

            var oversizedTime = UnityPracticeContractTestFixture.DeliveryPayload
                .Replace("\"t\":0.5", "\"t\":31");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.delivery", 0, "delivery-1", oversizedTime)));

            const string oversizedSwing =
                "{\"atPerfMs\":1000,\"calibrationMs\":0,\"swing\":{" +
                "\"directionDeg\":1000001,\"elevation\":0,\"footwork\":\"auto\"," +
                "\"kind\":\"attack\",\"power\":0.7,\"startT\":0.25}}";
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.provisional_swing", 0, "delivery-1", oversizedSwing)));

            const string oversizedSwingTime =
                "{\"atPerfMs\":1000,\"calibrationMs\":0,\"swing\":{" +
                "\"directionDeg\":10,\"elevation\":0,\"footwork\":\"auto\"," +
                "\"kind\":\"attack\",\"power\":0.7,\"startT\":31}}";
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.provisional_swing", 0, "delivery-1", oversizedSwingTime)));

            var oversizedResultFielder = UnityPracticeContractTestFixture.ResultPayload()
                .Replace("\"action\":\"idle\",\"t\":0,\"x\":-5,\"z\":0",
                    "\"action\":\"idle\",\"t\":0,\"x\":1000001,\"z\":0");
            oversizedResultFielder = WithRecomputedReplayDigest(oversizedResultFielder);
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.result", 0, "delivery-1", oversizedResultFielder)));
        }

        [Test]
        public void Decode_AcceptsV6ResultWithThePlayedOnCoachingReason()
        {
            // Contract v6 amendment (lead): `played_on`, bowled off the bat (the batter played the ball onto the
            // stumps), joins the closed CoachingReason list of src/contracts/practice.ts and unityPractice.ts.
            Assert.That(BridgeConstants.ContractVersion, Is.EqualTo(7));
            var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "..", "..", ".."));
            var typescript = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "src/contracts/unityPractice.ts"));
            Assert.That(System.Text.RegularExpressions.Regex.IsMatch(typescript, @"'left_and_bowled',\s*'played_on',\s*'pad_in_line'"), Is.True,
                "the TypeScript validator lists played_on in the same place");

            var playedOn = WithRecomputedReplayDigest(UnityPracticeContractTestFixture.ResultPayload()
                .Replace("\"reason\":\"left_well\"", "\"reason\":\"played_on\""));
            Assert.That(playedOn, Does.Contain("\"reason\":\"played_on\""));
            var decoded = UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", playedOn));
            Assert.That(decoded.Envelope.type, Is.EqualTo("host.result"));

            var unknown = WithRecomputedReplayDigest(UnityPracticeContractTestFixture.ResultPayload()
                .Replace("\"reason\":\"left_well\"", "\"reason\":\"played_onto_the_stumps\""));
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", unknown)),
                "the list stays closed");
        }

        [TestCase("\"runs\":0,\"wickets\":0}", "\"runs\":999,\"wickets\":0}")]
        [TestCase("\"runs\":0,\"wickets\":0}", "\"runs\":0,\"wickets\":2}")]
        [TestCase("\"balls\":1,\"maxOvers\":10", "\"balls\":0,\"maxOvers\":10")]
        [TestCase("\"balls\":1,\"maxOvers\":10", "\"balls\":1,\"maxOvers\":9")]
        public void Decode_RejectsInvalidResolutionScoreWithValidPacketChecksum(string before, string after)
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload().Replace(before, after);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [TestCase("\"kind\":\"leave\"", "\"kind\":\"teleport\"")]
        [TestCase("\"action\":\"idle\"", "\"action\":\"teleport\"")]
        [TestCase("\"reason\":\"left_well\"", "\"reason\":\"unknown\"")]
        public void Decode_RejectsInvalidNestedResolutionWithRecomputedReplayDigest(
            string before,
            string after)
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload().Replace(before, after);
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [TestCase("\"batterRootOffset\":{\"x\":0,\"z\":0},", "")]
        [TestCase("\"batterRootOffset\":{\"x\":0,\"z\":0}",
            "\"batterRootOffset\":{\"extra\":0,\"x\":0,\"z\":0}")]
        [TestCase("\"batterRootOffset\":{\"x\":0,\"z\":0}",
            "\"batterRootOffset\":{\"x\":0.180001,\"z\":0}")]
        [TestCase("\"batterRootOffset\":{\"x\":0,\"z\":0}",
            "\"batterRootOffset\":{\"x\":0.0000011,\"z\":0}")]
        public void Decode_RejectsMissingMalformedOverCapOrNonNominalEmptyBatRootWithValidDigests(
            string before,
            string after)
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload().Replace(before, after);
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_RejectsMissingMalformedOrIncoherentBatterBodyFrameWithValidDigests()
        {
            const string frame =
                "\"batterBodyFrame\":{\"headCentre\":{\"x\":-0.2,\"y\":1.62,\"z\":8.86}," +
                "\"stance\":{\"x\":-0.15,\"z\":8.96}," +
                "\"torsoTop\":{\"x\":-0.3,\"y\":1.42,\"z\":8.94}},";
            var original = UnityPracticeContractTestFixture.ResultPayload();
            var malformed = new[]
            {
                original.Replace(frame, string.Empty),
                original.Replace("\"stance\":{\"x\":-0.15,\"z\":8.96}",
                    "\"stance\":{\"extra\":0,\"x\":-0.15,\"z\":8.96}"),
                original.Replace("\"stance\":{\"x\":-0.15,\"z\":8.96}",
                    "\"stance\":{\"x\":3.000001,\"z\":8.96}"),
                original.Replace("\"headCentre\":{\"x\":-0.2,\"y\":1.62,\"z\":8.86}",
                    "\"headCentre\":{\"x\":-0.2,\"y\":1.419,\"z\":8.86}")
            };

            foreach (var candidate in malformed)
            {
                var payload = WithRecomputedReplayDigest(candidate);
                Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                    UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
            }
        }

        [TestCase("\"batterPosture\":{\"crouchM\":0},", "")]
        [TestCase("\"batterPosture\":{\"crouchM\":0}",
            "\"batterPosture\":{\"crouchM\":0,\"extra\":0}")]
        [TestCase("\"batterPosture\":{\"crouchM\":0}",
            "\"batterPosture\":{\"crouchM\":-0.000001}")]
        [TestCase("\"batterPosture\":{\"crouchM\":0}",
            "\"batterPosture\":{\"crouchM\":0.180001}")]
        [TestCase("\"batterPosture\":{\"crouchM\":0}",
            "\"batterPosture\":{\"crouchM\":0.0000011}")]
        public void Decode_RejectsMissingMalformedOutOfRangeOrNonNominalEmptyBatPostureWithValidDigests(
            string before,
            string after)
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload().Replace(before, after);
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [TestCase("\"contactT\":0.05", "\"contactT\":0.050001")]
        [TestCase("\"endT\":0.1", "\"endT\":0.099999")]
        [TestCase("\"startT\":0", "\"startT\":1e-12")]
        public void Decode_RejectsBatterMotionOutsideOrNotExactlyBoundToBatWithValidDigests(
            string before,
            string after)
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload()
                .Replace(
                    "\"bat\":[]",
                    "\"bat\":[{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.05," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.1," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}]")
                .Replace(
                    "\"batterMotion\":null",
                    "\"batterMotion\":{\"contactT\":0.05,\"endT\":0.1,\"startT\":0}")
                .Replace(before, after);
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_RejectsNonNullBatterMotionForEmptyBatWithValidDigests()
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload().Replace(
                "\"batterMotion\":null",
                "\"batterMotion\":{\"contactT\":0.05,\"endT\":0.1,\"startT\":0}");
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_AllowsDistinctExactVelocityPeakAndBladeImpulseWithValidDigests()
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload()
                .Replace(
                    "\"bat\":[]",
                    "\"bat\":[{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.04," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.06," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.1," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}]")
                .Replace(
                    "\"batterMotion\":null",
                    "\"batterMotion\":{\"contactT\":0.06,\"endT\":0.1,\"startT\":0}")
                .Replace(
                    "{\"kind\":\"release\",\"t\":0},{\"kind\":\"dead\",\"t\":0.1}",
                    "{\"kind\":\"release\",\"t\":0}," +
                    "{\"contact\":\"middle\",\"kind\":\"contact\"," +
                    "\"p\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.04}," +
                    "{\"kind\":\"dead\",\"t\":0.1}");
            payload = WithRecomputedReplayDigest(payload);

            Assert.DoesNotThrow(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_RejectsBladeImpulseWithoutExactBatKnotWithValidDigests()
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload()
                .Replace(
                    "\"bat\":[]",
                    "\"bat\":[{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.06," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.1," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}]")
                .Replace(
                    "\"batterMotion\":null",
                    "\"batterMotion\":{\"contactT\":0.06,\"endT\":0.1,\"startT\":0}")
                .Replace(
                    "{\"kind\":\"release\",\"t\":0},{\"kind\":\"dead\",\"t\":0.1}",
                    "{\"kind\":\"release\",\"t\":0}," +
                    "{\"contact\":\"middle\",\"kind\":\"contact\"," +
                    "\"p\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.04}," +
                    "{\"kind\":\"dead\",\"t\":0.1}");
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_AllowsMotionEndBeforeHeldTerminalKnotAndRejectsChangedHoldPose()
        {
            var held = HeldBatResolutionPayload(false);
            Assert.DoesNotThrow(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", held)));

            var changed = HeldBatResolutionPayload(true);
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", changed)));
        }

        [TestCase("\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}",
            "\"toe\":{\"x\":0,\"y\":0.13,\"z\":9.1}")]
        [TestCase("\"face\":{\"x\":0,\"y\":0,\"z\":1}",
            "\"face\":{\"x\":0,\"y\":0,\"z\":0.9}")]
        [TestCase("\"face\":{\"x\":0,\"y\":0,\"z\":1}",
            "\"face\":{\"x\":0,\"y\":1,\"z\":0}")]
        public void Decode_RejectsNonRigidBatKnotsWithValidDigests(string before, string after)
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload().Replace(
                "\"bat\":[]",
                "\"bat\":[{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0," +
                "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.05," +
                "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.1," +
                "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}]")
                .Replace(
                    "\"batterMotion\":null",
                    "\"batterMotion\":{\"contactT\":0.05,\"endT\":0.1,\"startT\":0}");
            payload = payload.Replace(before, after);
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_RejectsAmbiguousBladeImpulseKnotWithValidDigests()
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload()
                .Replace(
                    "\"bat\":[]",
                    "\"bat\":[{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.0499999999995," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.001,\"y\":1,\"z\":9.1},\"t\":0.0500000000005," +
                    "\"toe\":{\"x\":0.001,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.001,\"y\":1,\"z\":9.1},\"t\":0.075," +
                    "\"toe\":{\"x\":0.001,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.001,\"y\":1,\"z\":9.1},\"t\":0.1," +
                    "\"toe\":{\"x\":0.001,\"y\":0.14,\"z\":9.1}}]")
                .Replace(
                    "\"batterMotion\":null",
                    "\"batterMotion\":{\"contactT\":0.075,\"endT\":0.1,\"startT\":0}")
                .Replace(
                    "{\"kind\":\"release\",\"t\":0},{\"kind\":\"dead\",\"t\":0.1}",
                    "{\"kind\":\"release\",\"t\":0}," +
                    "{\"contact\":\"middle\",\"kind\":\"contact\"," +
                    "\"p\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.05}," +
                    "{\"kind\":\"dead\",\"t\":0.1}");
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_RejectsAmbiguousVelocityPeakKnotWithValidDigests()
        {
            var payload = UnityPracticeContractTestFixture.ResultPayload()
                .Replace(
                    "\"bat\":[]",
                    "\"bat\":[{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.025," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.001,\"y\":1,\"z\":9.1},\"t\":0.0499999999995," +
                    "\"toe\":{\"x\":0.001,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.002,\"y\":1,\"z\":9.1},\"t\":0.0500000000005," +
                    "\"toe\":{\"x\":0.002,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.002,\"y\":1,\"z\":9.1},\"t\":0.1," +
                    "\"toe\":{\"x\":0.002,\"y\":0.14,\"z\":9.1}}]")
                .Replace(
                    "\"batterMotion\":null",
                    "\"batterMotion\":{\"contactT\":0.05,\"endT\":0.1,\"startT\":0}")
                .Replace(
                    "{\"kind\":\"release\",\"t\":0},{\"kind\":\"dead\",\"t\":0.1}",
                    "{\"kind\":\"release\",\"t\":0}," +
                    "{\"contact\":\"middle\",\"kind\":\"contact\"," +
                    "\"p\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0.025}," +
                    "{\"kind\":\"dead\",\"t\":0.1}");
            payload = WithRecomputedReplayDigest(payload);

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.result", 0, "delivery-1", payload)));
        }

        [Test]
        public void Decode_RejectsInvalidNestedReplayResolution()
        {
            var resolution = UnityPracticeContractTestFixture.ResultPayload()
                .Replace("\"balls\":1,\"maxOvers\":10", "\"balls\":61,\"maxOvers\":10");
            var replay = "{\"diagnostics\":false,\"resolution\":" + resolution + ",\"speed\":1}";

            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket("host.replay", 0, "delivery-1", replay)));
        }

        [Test]
        public void DemonstrationPacket_ValidatesExactDeliveryResolutionSpeedAndCancelShape()
        {
            var decoded = UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.demonstration", 0, "demo-1",
                    UnityPracticeContractTestFixture.DemonstrationPayload()));
            Assert.That(decoded.Envelope.type, Is.EqualTo("host.demonstration"));

            var invalidSpeed = UnityPracticeContractTestFixture.DemonstrationPayload()
                .Replace("\"speed\":1", "\"speed\":0");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.demonstration", 0, "demo-1", invalidSpeed)));

            var invalidResolution = UnityPracticeContractTestFixture.DemonstrationPayload()
                .Replace("\"balls\":1,\"maxOvers\":10", "\"balls\":61,\"maxOvers\":10");
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.demonstration", 0, "demo-1", invalidResolution)));

            Assert.DoesNotThrow(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.demonstration_cancel", 1, "demo-1", "{}")));
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(
                UnityPracticeContractTestFixture.HostPacket(
                    "host.demonstration_cancel", 1, "demo-1", "{\"unexpected\":true}")));
        }

        [Test]
        public void Decode_RejectsBodyOverOneMebibyteBeforeHashing()
        {
            var packet = new UnityPracticePacket
            {
                body = new string('a', BridgeConstants.MaxPacketBytes + 1),
                sha256 = new string('0', 64)
            };

            Assert.Throws<BridgeValidationException>(() =>
                UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)));
        }

        [Test]
        public void EncodeUnityPacket_MatchesGoldenCanonicalPacket()
        {
            var packet = UnityPracticePacketCodec.EncodeUnityPacket(
                "build-1", "session-1", null, "session-1.unity.0", 0, "unity.ready",
                UnityPracticePacketCodec.ReadyPayload("unity-practice-foundation", "6000.3.0f1"));

            Assert.That(packet, Is.EqualTo(GoldenReadyPacket));
            var decoded = UnityPracticePacketCodec.Decode(packet);
            Assert.That(decoded.Envelope.type, Is.EqualTo("unity.ready"));
        }

        [Test]
        public void SequenceGuard_RejectsDuplicateAndOutOfOrderMessages()
        {
            var guard = new UnityPracticeSequenceGuard(2);
            var first = Envelope("message-1", 1);
            var second = Envelope("message-2", 2);
            var old = Envelope("message-old", 0);

            Assert.That(guard.Accept(first), Is.EqualTo(SequenceAcceptResult.Accept));
            Assert.That(guard.Accept(first), Is.EqualTo(SequenceAcceptResult.Duplicate));
            Assert.That(guard.Accept(second), Is.EqualTo(SequenceAcceptResult.Accept));
            Assert.That(guard.Accept(old), Is.EqualTo(SequenceAcceptResult.OutOfOrder));
        }

        [Test]
        public void OptionalFileStore_RejectsChangedBytes()
        {
            var bytes = System.Text.Encoding.UTF8.GetBytes("authoritative payload");
            var reference = new LargePayloadReference
            {
                fileName = "trace-1.json",
                byteLength = bytes.Length,
                sha256 = Sha256Digest.OfBytes(bytes)
            };
            var store = new MemoryStore(reference.fileName,
                System.Text.Encoding.UTF8.GetBytes("tampered payload data"));

            Assert.Throws<BridgeValidationException>(() =>
                OptionalLargePayloadStore.ReadVerified(reference, store));
        }

        [Test]
        public void ReplayDigest_MatchesTypescriptCanonicalFramingAndRejectsTampering()
        {
            const string digest = "7aac7a80522eb5240c99d9c4106abb7863987955efdaa29f97ebc5df4f63a26d";
            var resolution = "{\"record\":{},\"replayDigest\":\"" + digest +
                             "\",\"result\":{},\"score\":{}}";
            Assert.That(UnityPracticeReplayDigest.ComputeFromResolutionPayload(resolution), Is.EqualTo(digest));
            Assert.DoesNotThrow(() => UnityPracticeReplayDigest.VerifyResolutionPayload(resolution));

            var changed = resolution.Replace("\"result\":{}", "\"result\":{\"changed\":true}");
            Assert.Throws<BridgeValidationException>(() =>
                UnityPracticeReplayDigest.VerifyResolutionPayload(changed));
        }

        [Test]
        public void BenchmarkPacket_UsesExactBoundedContractAndCorrelationId()
        {
            var payload = UnityPracticePacketCodec.BenchmarkPayload(
                "bench-1", "standard", new[] { 16.6, 17.2 }, 300, 5100,
                false, null, "Vulkan", "GPU", null, null, 256, "unknown");
            var packet = UnityPracticePacketCodec.EncodeUnityPacket(
                "build-1", "session-1", null, "session-1.unity.4", 4,
                "unity.benchmark", payload);

            var decoded = UnityPracticePacketCodec.Decode(packet).Envelope;
            Assert.That(decoded.type, Is.EqualTo("unity.benchmark"));
            Assert.That(decoded.payloadJson, Does.Contain("\"benchmarkId\":\"bench-1\""));
            Assert.That(decoded.payloadJson, Does.Contain("\"shaderWarmupMs\":null"));
            Assert.That(decoded.payloadJson, Does.Contain("\"contextGeneration\":null"));
        }

        [Test]
        public void BenchmarkPacket_RejectsUnknownFieldsAndInvalidIntervals()
        {
            Assert.Throws<BridgeValidationException>(() =>
                UnityPracticePacketCodec.BenchmarkPayload(
                    "bench-1", "standard", new[] { double.NaN }, 0, 0,
                    false, null, "Vulkan", "GPU", null, null, null, "unknown"));

            const string body =
                "{\"buildId\":\"build-1\",\"contractVersion\":7,\"deliveryId\":null," +
                "\"messageId\":\"host-5\",\"payload\":{\"benchmarkId\":\"bench-1\"," +
                "\"durationMs\":1000,\"extra\":true,\"quality\":\"standard\",\"sampleCap\":2," +
                "\"warmupFrames\":0},\"sender\":\"host\",\"sequence\":5," +
                "\"sessionId\":\"session-1\",\"simVersion\":3,\"type\":\"host.benchmark\"}";
            Assert.Throws<BridgeValidationException>(() => UnityPracticePacketCodec.Decode(Packet(body)));
        }

        [Test]
        public void NumericPayloads_UseJavascriptStringifyExponentThresholdsAndSpelling()
        {
            var payload = UnityPracticePacketCodec.ClockSyncPayload(
                "clock-edge", 0.000001, 0.0000001, 1e21);

            Assert.That(payload, Is.EqualTo(
                "{\"hostSendPerfMs\":0.000001,\"sampleId\":\"clock-edge\"," +
                "\"unityReceiveMs\":1e-7,\"unitySendMs\":1e+21}"));
        }

        private static string Packet(string body)
        {
            return JsonUtility.ToJson(new UnityPracticePacket
            {
                body = body,
                sha256 = Sha256Digest.OfUtf8(body)
            });
        }

        private static string WithRecomputedReplayDigest(string resolution)
        {
            const string marker = "\"replayDigest\":\"";
            var start = resolution.IndexOf(marker, System.StringComparison.Ordinal);
            Assert.That(start, Is.GreaterThanOrEqualTo(0));
            start += marker.Length;
            var end = resolution.IndexOf('"', start);
            Assert.That(end - start, Is.EqualTo(64));
            var digest = UnityPracticeReplayDigest.ComputeFromResolutionPayload(resolution);
            return resolution.Substring(0, start) + digest + resolution.Substring(end);
        }

        private static UnityPracticeEnvelope Envelope(string messageId, long sequence)
        {
            return new UnityPracticeEnvelope
            {
                contractVersion = BridgeConstants.ContractVersion,
                simVersion = BridgeConstants.SimulationVersion,
                buildId = "build-1",
                sessionId = "session-1",
                deliveryId = null,
                messageId = messageId,
                sequence = sequence,
                sender = "host",
                type = "host.pause",
                payloadJson = "{\"reason\":\"player\"}"
            };
        }

        private sealed class MemoryStore : IPrivateLargePayloadStore
        {
            private readonly Dictionary<string, byte[]> values = new Dictionary<string, byte[]>();

            public MemoryStore(string name, byte[] value)
            {
                values[name] = value;
            }

            public bool TryRead(string baseFileName, out byte[] contents)
            {
                return values.TryGetValue(baseFileName, out contents);
            }

            public bool TryWriteAtomic(string baseFileName, byte[] contents)
            {
                values[baseFileName] = contents;
                return true;
            }
        }

        private static string ReplayDigestFromPayload(string payload)
        {
            const string marker = "\"replayDigest\":\"";
            var start = payload.IndexOf(marker, System.StringComparison.Ordinal);
            Assert.That(start, Is.GreaterThanOrEqualTo(0));
            return payload.Substring(start + marker.Length, 64);
        }

        private static string HeldBatResolutionPayload(bool changeTerminalPose)
        {
            var finalX = changeTerminalPose ? "0.20001" : "0.2";
            var payload = UnityPracticeContractTestFixture.ResultPayload()
                .Replace(
                    "\"bat\":[]",
                    "\"bat\":[{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0," +
                    "\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.1,\"y\":1,\"z\":9.1},\"t\":0.025," +
                    "\"toe\":{\"x\":0.1,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":0.2,\"y\":1,\"z\":9.1},\"t\":0.05," +
                    "\"toe\":{\"x\":0.2,\"y\":0.14,\"z\":9.1}}," +
                    "{\"face\":{\"x\":0,\"y\":0,\"z\":1}," +
                    "\"grip\":{\"x\":" + finalX + ",\"y\":1,\"z\":9.1},\"t\":0.1," +
                    "\"toe\":{\"x\":" + finalX + ",\"y\":0.14,\"z\":9.1}}]")
                .Replace(
                    "\"batterMotion\":null",
                    "\"batterMotion\":{\"contactT\":0.025,\"endT\":0.05,\"startT\":0}");
            return WithRecomputedReplayDigest(payload);
        }

        private const string GoldenReadyPacket =
            "{\"body\":\"{\\\"buildId\\\":\\\"build-1\\\",\\\"contractVersion\\\":7," +
            "\\\"deliveryId\\\":null,\\\"messageId\\\":\\\"session-1.unity.0\\\"," +
            "\\\"payload\\\":{\\\"renderer\\\":\\\"unity-practice-foundation\\\"," +
            "\\\"unityVersion\\\":\\\"6000.3.0f1\\\"},\\\"sender\\\":\\\"unity\\\"," +
            "\\\"sequence\\\":0,\\\"sessionId\\\":\\\"session-1\\\",\\\"simVersion\\\":3," +
            "\\\"type\\\":\\\"unity.ready\\\"}\",\"sha256\":" +
            "\"87020b2bcc5159c2f4f90233b1b835604c8071ac1bf966ec7793871cc41dd017\"}";
    }
}
