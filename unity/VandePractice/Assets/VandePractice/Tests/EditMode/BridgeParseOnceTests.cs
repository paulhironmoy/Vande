using System;
using System.Collections.Generic;
using System.Globalization;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Wedge phase 3, decode stall: the trust boundary parses each number token and each nested value once and
    /// reuses them. These tests prove the reuse changes nothing: every value is bit-identical to a fresh, exact parse.
    /// </summary>
    public sealed class BridgeParseOnceTests
    {
        [TearDown]
        public void TearDown()
        {
            CanonicalJson.ClearNumberMemo();
        }

        [Test]
        public void MemoizedNumbers_AreBitIdenticalToTheExactParse_AndTheMemoStaysBounded()
        {
            var tokens = new List<string>
            {
                "0", "-0", "0.1", "-0.1", "1e-7", "-1e-7", "5e-324", "1.7976931348623157e+308",
                "123456789.12345678", "0.30000000000000004", "9007199254740993", "2.2250738585072014e-308",
                "35.833333333333336", "-160", "0.4", "137.5", "8.59", "10.06"
            };
            var random = new System.Random(7);
            for (var index = 0; index < 2000; index++)
                tokens.Add((random.NextDouble() * 200.0 - 100.0).ToString("R", CultureInfo.InvariantCulture));

            CanonicalJson.ClearNumberMemo();
            foreach (var token in tokens)
            {
                Assert.That(CanonicalJson.TryParseNumberExact(token, out var exact), Is.True, token);
                Assert.That(CanonicalJson.TryParseNumber(token, out var first), Is.True, token);
                Assert.That(CanonicalJson.TryParseNumber(token, out var reused), Is.True, token);
                Assert.That(BitConverter.DoubleToInt64Bits(first), Is.EqualTo(BitConverter.DoubleToInt64Bits(exact)), token);
                Assert.That(BitConverter.DoubleToInt64Bits(reused), Is.EqualTo(BitConverter.DoubleToInt64Bits(exact)), token);
            }
            Assert.That(CanonicalJson.TryParseNumber("NaN", out _), Is.False);
            Assert.That(CanonicalJson.TryParseNumber("1e400", out _), Is.False, "non-finite stays rejected");
            Assert.That(CanonicalJson.TryParseNumber(null, out _), Is.False);

            for (var index = 0; index < CanonicalJson.MaxMemoizedNumbers + 10; index++)
                CanonicalJson.TryParseNumber(index.ToString(CultureInfo.InvariantCulture), out _);
            Assert.That(CanonicalJson.NumberMemoCount, Is.LessThanOrEqualTo(CanonicalJson.MaxMemoizedNumbers));
        }

        [Test]
        public void CachedObjectArray_KeepsItsItemLimit_AndHandsOutCopies()
        {
            var source = StrictJsonObject.ParseCanonical("{\"items\":[{\"a\":1},{\"a\":2},{\"a\":3}]}");
            var first = source.ObjectArray("items", 5);
            Assert.That(first.Length, Is.EqualTo(3));
            first[0] = null;
            var second = source.ObjectArray("items", 3);
            Assert.That(second[0], Is.Not.Null, "a caller cannot change what the next reader sees");
            Assert.That(second[2].Number("a"), Is.EqualTo(3.0));

            var cachedFailure = Assert.Throws<BridgeValidationException>(() => source.ObjectArray("items", 2));
            var freshFailure = Assert.Throws<BridgeValidationException>(() =>
                StrictJsonObject.ParseCanonical("{\"items\":[{\"a\":1},{\"a\":2},{\"a\":3}]}").ObjectArray("items", 2));
            Assert.That(cachedFailure.Message, Is.EqualTo(freshFailure.Message));

            Assert.Throws<BridgeValidationException>(() => source.Object("items"));
            Assert.Throws<BridgeValidationException>(() => source.Object("items"), "a failed parse is never cached");
        }

        [Test]
        public void DecodedResult_IsIdentical_WhetherItsPayloadIsReusedOrParsedAfresh()
        {
            var decoded = UnityPracticePacketCodec.Decode(UnityPracticeContractTestFixture.HostPacket(
                "host.result", 0, "delivery-1", UnityPracticeContractTestFixture.ResultPayload()));
            var envelope = decoded.Envelope;
            Assert.That(envelope.ParsedPayload(), Is.SameAs(envelope.ParsedPayload()),
                "validation's parse is the one the adapter reuses");

            var validatedParse = envelope.ParsedPayload();
            var reused = PracticePresentationContractAdapter.Result(envelope);
            Assert.That(envelope.ParsedPayload(), Is.SameAs(validatedParse), "re-validation reuses it too");

            // A fresh path: a new payload string instance (so nothing is reused) and an empty number memo.
            CanonicalJson.ClearNumberMemo();
            var fresh = new UnityPracticeEnvelope
            {
                contractVersion = envelope.contractVersion,
                simVersion = envelope.simVersion,
                buildId = envelope.buildId,
                sessionId = envelope.sessionId,
                deliveryId = envelope.deliveryId,
                messageId = envelope.messageId,
                sequence = envelope.sequence,
                sender = envelope.sender,
                type = envelope.type,
                payloadJson = new string(envelope.payloadJson.ToCharArray())
            };
            var freshParse = fresh.ParsedPayload();
            Assert.That(freshParse, Is.Not.SameAs(envelope.ParsedPayload()));
            var parsedAfresh = PracticePresentationContractAdapter.Result(fresh);

            AssertSame(reused, parsedAfresh);

            // A changed payload string is never served from the earlier parse.
            envelope.payloadJson = new string(fresh.payloadJson.ToCharArray());
            Assert.That(envelope.ParsedPayload(), Is.Not.SameAs(validatedParse));
        }

        private static void AssertSame(PracticeResultPresentation expected, PracticeResultPresentation actual)
        {
            Assert.That(JsonUtility.ToJson(actual.Trace), Is.EqualTo(JsonUtility.ToJson(expected.Trace)), "trace");
            foreach (var property in typeof(PracticeResultPresentation).GetProperties())
            {
                if (property.Name == nameof(PracticeResultPresentation.Trace) ||
                    property.Name == nameof(PracticeResultPresentation.BatterBodyFrame))
                    continue;
                Assert.That(property.GetValue(actual), Is.EqualTo(property.GetValue(expected)), property.Name);
            }
            var a = expected.BatterBodyFrame;
            var b = actual.BatterBodyFrame;
            Assert.That(JsonUtility.ToJson(b.Stance), Is.EqualTo(JsonUtility.ToJson(a.Stance)));
            Assert.That(JsonUtility.ToJson(b.TorsoTop), Is.EqualTo(JsonUtility.ToJson(a.TorsoTop)));
            Assert.That(JsonUtility.ToJson(b.HeadCentre), Is.EqualTo(JsonUtility.ToJson(a.HeadCentre)));
        }
    }
}
