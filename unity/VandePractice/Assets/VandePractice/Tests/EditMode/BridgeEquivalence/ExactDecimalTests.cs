using System;
using System.Collections.Generic;
using System.Globalization;
using System.Numerics;
using NUnit.Framework;
using Vande.Practice.Bridge;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// ExactDecimal (the allocation-free number reader of the trust boundary) must give, for every JSON number token, exactly the
    /// answer of CanonicalJson.TryParseNumberExact, the BigInteger routine it replaced on the hot path: same accept or reject, same bits.
    /// </summary>
    public sealed class ExactDecimalTests
    {
        [Test]
        public void PowerTable_IsTheTruncated128BitMantissaOfEveryPowerOfTen()
        {
            var first = ExactDecimal.FirstExponent;
            for (var offset = 0; offset < ExactDecimal.TableLength; offset++)
            {
                var q = first + offset;
                // floor(log2(10^q)) from the integers, and the constant the algorithm uses for it.
                int exponent2;
                BigInteger mantissa;
                if (q >= 0)
                {
                    var power = BigInteger.Pow(10, q);
                    exponent2 = BitLength(power) - 1;
                    mantissa = exponent2 >= 127 ? power >> (exponent2 - 127) : power << (127 - exponent2);
                }
                else
                {
                    var reciprocal = BigInteger.Pow(10, -q);
                    exponent2 = -BitLength(reciprocal);
                    mantissa = (BigInteger.One << (127 - exponent2)) / reciprocal;
                }

                Assert.That(exponent2, Is.EqualTo((int)((217706L * q) >> 16)), "the exponent constant for 10^" + q);
                Assert.That(mantissa >= (BigInteger.One << 127) && mantissa < (BigInteger.One << 128), Is.True, "10^" + q);
                var high = (ulong)(mantissa >> 64);
                var low = (ulong)(mantissa & ulong.MaxValue);
                Assert.That(ExactDecimal.PowersOfTen[offset * 2], Is.EqualTo(high), "high word of 10^" + q);
                Assert.That(ExactDecimal.PowersOfTen[offset * 2 + 1], Is.EqualTo(low), "low word of 10^" + q);
            }
        }

        private static int BitLength(BigInteger value)
        {
            var bits = 0;
            while (value > 0)
            {
                value >>= 1;
                bits++;
            }

            return bits;
        }

        private static void AssertSame(string token)
        {
            double expected, actual;
            var expectedOk = CanonicalJson.TryParseNumberExact(token, out expected);
            var actualOk = ExactDecimal.TryParse(token, 0, token.Length, out actual);
            Assert.That(actualOk, Is.EqualTo(expectedOk), token);
            if (expectedOk)
                Assert.That(BitConverter.DoubleToInt64Bits(actual), Is.EqualTo(BitConverter.DoubleToInt64Bits(expected)), token);
        }

        [Test]
        public void EdgeTokens_AnswerLikeTheReference()
        {
            var tokens = new List<string>();
            foreach (var token in BridgeEquivalenceCorpus.NumberTokens())
            {
                // The corpus also holds tokens that are not JSON numbers at all; the reader is only handed grammar-valid ones.
                if (IsJsonNumber(token)) tokens.Add(token);
            }

            tokens.AddRange(new[]
            {
                "9007199254740993", "9007199254740995", "9007199254740992", "18014398509481985", "4503599627370496.5", "4503599627370497.5",
                "0.1", "0.2", "0.3", "1e22", "1e23", "1e-22", "1e-23", "123456789012345678", "1234567890123456789", "12345678901234567890",
                "0.000000000000000000000001", "-0", "-0.0", "-0e5", "0e0", "0e400", "0e401", "5e-324", "4.9e-324", "2.5e-324", "1e-400", "1e-401",
                "1.7976931348623157e308", "1.7976931348623158e308", "1.7976931348623159e308", "2e308", "1e999", "9.999999999999999e22",
                "8.41e21", "2.2250738585072014e-308", "2.2250738585072011e-308", "1e0000000000000000000005", "1e+0005", "1E5", "123e-2", "0.5e1"
            });
            foreach (var token in tokens) AssertSame(token);
        }

        [Test]
        public void RandomTokens_AnswerLikeTheReference()
        {
            var random = new WireKit.Rng(0xE15E1);
            for (var count = 0; count < 12000; count++)
            {
                var kind = random.Below(6);
                string token;
                switch (kind)
                {
                    case 0: token = RandomDigits(random, 1 + random.Below(19), false) + "." + RandomDigits(random, 1 + random.Below(10), true); break;
                    case 1: token = "0." + new string('0', random.Below(10)) + RandomDigits(random, 1 + random.Below(18), true); break;
                    case 2: token = RandomDigits(random, 1 + random.Below(19), false) + "e" + (random.Below(2) == 0 ? "-" : "+") + random.Below(330); break;
                    case 3: token = RandomDigits(random, 1, false) + "." + RandomDigits(random, 1 + random.Below(17), true) + "e-" + random.Below(40); break;
                    case 4: token = RandomDigits(random, 15 + random.Below(10), false); break;
                    default:
                        token = ((long)(random.Next() >> 11) * (1.0 / 9007199254740992.0) * Math.Pow(10, random.Below(9) - 4)).ToString("R", CultureInfo.InvariantCulture);
                        break;
                }

                if (random.Below(4) == 0) token = "-" + token;
                if (!IsJsonNumber(token)) continue;
                AssertSame(token);
            }
        }

        [Test]
        public void EveryNumberOfTheGoldenResults_AnswersLikeTheReference()
        {
            var checkedTokens = new HashSet<string>();
            foreach (var item in BridgeEquivalenceTests.LoadBases())
            {
                if (!item.Name.EndsWith(".result", StringComparison.Ordinal)) continue;
                var body = item.Body;
                for (var index = 0; index < body.Length; index++)
                {
                    var c = body[index];
                    if (!(c == '-' || (c >= '0' && c <= '9')) || (index > 0 && !(body[index - 1] == ':' || body[index - 1] == ',' || body[index - 1] == '[')))
                        continue;
                    var end = index;
                    while (end < body.Length && body[end] != ',' && body[end] != '}' && body[end] != ']') end++;
                    var token = body.Substring(index, end - index);
                    index = end;
                    if (IsJsonNumber(token) && checkedTokens.Add(token)) AssertSame(token);
                }
            }

            Assert.That(checkedTokens.Count, Is.GreaterThan(20000));
        }

        [Test]
        public void ScannerAgreesWithTheReferenceOnCanonicalSpellings()
        {
            // The whole point of the exact value in canonical mode: the spelling rules key off value == 0 and the 1e-6 / 1e21 thresholds.
            foreach (var token in new[] { "1e21", "1e+21", "999999999999999900000", "0.000001", "9.999999999999999e-7", "1e-7", "0.0000011" })
            {
                var accepted = AcceptedByCanonicalScan(token);
                double value;
                var parsed = CanonicalJson.TryParseNumberExact(token, out value);
                var spelling = parsed && ReferenceSpelling(token, value);
                Assert.That(accepted, Is.EqualTo(spelling), token);
            }
        }

        private static bool AcceptedByCanonicalScan(string token)
        {
            try
            {
                StrictJsonObject.ParseCanonical("{\"a\":" + token + "}");
                return true;
            }
            catch (BridgeValidationException)
            {
                return false;
            }
        }

        // The spelling rules, restated (CanonicalJson.Number's JSON.stringify shape): exponent form exactly outside [1e-6, 1e21).
        private static bool ReferenceSpelling(string token, double value)
        {
            if (value == 0) return token == "0";
            var magnitude = Math.Abs(value);
            var exponential = magnitude < 0.000001 || magnitude >= 1e21;
            if (exponential != token.Contains("e")) return false;
            if (token.Contains("E")) return false;
            var coefficient = token.Contains("e") ? token.Substring(0, token.IndexOf('e')) : token;
            if (coefficient.Contains(".") && coefficient.EndsWith("0", StringComparison.Ordinal)) return false;
            if (!token.Contains("e")) return true;
            var exponent = token.Substring(token.IndexOf('e') + 1);
            if (exponent.Length < 2 || (exponent[0] != '+' && exponent[0] != '-')) return false;
            if (exponent.Length > 2 && exponent[1] == '0') return false;
            var unsigned = coefficient.StartsWith("-", StringComparison.Ordinal) ? coefficient.Substring(1) : coefficient;
            return unsigned.Length == 1 || (unsigned.Length > 2 && unsigned[1] == '.');
        }

        private static string RandomDigits(WireKit.Rng random, int count, bool leadingZeroAllowed)
        {
            var digits = new char[count];
            for (var index = 0; index < count; index++)
            {
                var digit = random.Below(10);
                if (index == 0 && !leadingZeroAllowed && digit == 0) digit = 1 + random.Below(9);
                digits[index] = (char)('0' + digit);
            }

            return new string(digits);
        }

        private static bool IsJsonNumber(string t)
        {
            var i = 0;
            if (i < t.Length && t[i] == '-') i++;
            if (i >= t.Length) return false;
            if (t[i] == '0') i++;
            else if (t[i] >= '1' && t[i] <= '9') { while (i < t.Length && t[i] >= '0' && t[i] <= '9') i++; }
            else return false;
            if (i < t.Length && t[i] == '.')
            {
                i++;
                var start = i;
                while (i < t.Length && t[i] >= '0' && t[i] <= '9') i++;
                if (i == start) return false;
            }

            if (i < t.Length && (t[i] == 'e' || t[i] == 'E'))
            {
                i++;
                if (i < t.Length && (t[i] == '+' || t[i] == '-')) i++;
                var start = i;
                while (i < t.Length && t[i] >= '0' && t[i] <= '9') i++;
                if (i == start) return false;
            }

            return i == t.Length;
        }
    }

    /// <summary>The streamed digest must be the digest of the whole text's UTF-8 bytes, wherever the chunk boundaries fall.</summary>
    public sealed class Sha256StreamTests
    {
        private static string Reference(string text)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                var hash = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(text));
                var builder = new System.Text.StringBuilder();
                foreach (var b in hash) builder.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return builder.ToString();
            }
        }

        [Test]
        public void OfUtf8_MatchesTheFrameworkDigest_AcrossChunkBoundariesAndSurrogates()
        {
            Assert.That(Sha256Digest.OfUtf8(string.Empty), Is.EqualTo("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
            Assert.That(Sha256Digest.OfUtf8("abc"), Is.EqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
            var random = new WireKit.Rng(99);
            foreach (var length in new[] { 1, 63, 64, 65, 16383, 16384, 16385, 16386, 32767, 32768, 32769, 40000, 100001 })
            {
                foreach (var surrogates in new[] { 0, 1, 5 })
                {
                    var characters = new char[length];
                    for (var index = 0; index < length; index++)
                    {
                        var pick = random.Below(40);
                        characters[index] = pick == 0 ? 'é' : pick == 1 ? '日' : (char)('a' + pick % 26);
                    }

                    for (var round = 0; round < surrogates * 3; round++)
                    {
                        // A pair, or a lone half, at and around the 16,384-character chunk boundary.
                        var at = round % 3 == 0 ? 16383 : round % 3 == 1 ? 16384 : random.Below(Math.Max(1, length));
                        if (at + 1 >= length) continue;
                        if (round % 2 == 0) { characters[at] = '\ud83d'; characters[at + 1] = '\ude00'; }
                        else characters[at] = (round % 4 == 1) ? '\ud800' : '\udc00';
                    }

                    var text = new string(characters);
                    Assert.That(Sha256Digest.OfUtf8(text), Is.EqualTo(Reference(text)), length + " characters, " + surrogates);
                }
            }
        }

        [Test]
        public void Pieces_HashLikeTheirConcatenation()
        {
            var text = "{\"record\":" + new string('x', 20000) + ",\"result\":😀" + new string('y', 20000) + "}";
            using (var stream = new Sha256Stream())
            {
                stream.Append(text, 0, 10);
                stream.Append(text, 10, 20000);
                stream.Append(text, 20010, text.Length - 20010);
                Assert.That(stream.Finish(), Is.EqualTo(Reference(text)));
            }
        }
    }
}
