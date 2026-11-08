using System;
using System.Collections.Generic;
using System.Globalization;
using System.Numerics;
using System.Text;

namespace Vande.Practice.Bridge
{
    internal static class CanonicalJson
    {
        public static string String(string value)
        {
            if (value == null) return "null";
            var result = new StringBuilder(value.Length + 2);
            result.Append('"');
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                switch (character)
                {
                    case '"': result.Append("\\\""); break;
                    case '\\': result.Append("\\\\"); break;
                    case '\b': result.Append("\\b"); break;
                    case '\f': result.Append("\\f"); break;
                    case '\n': result.Append("\\n"); break;
                    case '\r': result.Append("\\r"); break;
                    case '\t': result.Append("\\t"); break;
                    default:
                        if (character < 0x20)
                        {
                            result.Append("\\u");
                            result.Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            result.Append(character);
                        }
                        break;
                }
            }

            return result.Append('"').ToString();
        }

        public static string Number(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
                throw new ArgumentOutOfRangeException(nameof(value));
            if (value == 0.0) return "0";
            var roundTrip = ShortestRoundTrip(value);
            var exponentAt = roundTrip.IndexOfAny(new[] { 'e', 'E' });
            if (exponentAt < 0) return roundTrip;

            var negative = roundTrip[0] == '-';
            var coefficientStart = negative ? 1 : 0;
            var coefficient = roundTrip.Substring(coefficientStart, exponentAt - coefficientStart);
            var exponent = int.Parse(roundTrip.Substring(exponentAt + 1),
                NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
            var digits = coefficient.Replace(".", string.Empty).TrimEnd('0');
            if (digits.Length == 0) return "0";

            // JSON.stringify uses fixed notation for [1e-6, 1e21), whereas
            // .NET's round-trip formatter selects scientific notation much
            // earlier and pads its exponent. Normalize only notation here;
            // the round-trip significand remains untouched.
            if (exponent >= -6 && exponent < 21)
            {
                var decimalAt = 1 + exponent;
                var fixedValue = new StringBuilder(digits.Length + Math.Abs(exponent) + 3);
                if (negative) fixedValue.Append('-');
                if (decimalAt <= 0)
                {
                    fixedValue.Append("0.");
                    fixedValue.Append('0', -decimalAt);
                    fixedValue.Append(digits);
                }
                else if (decimalAt >= digits.Length)
                {
                    fixedValue.Append(digits);
                    fixedValue.Append('0', decimalAt - digits.Length);
                }
                else
                {
                    fixedValue.Append(digits, 0, decimalAt);
                    fixedValue.Append('.');
                    fixedValue.Append(digits, decimalAt, digits.Length - decimalAt);
                }
                return fixedValue.ToString();
            }

            var scientific = new StringBuilder(digits.Length + 8);
            if (negative) scientific.Append('-');
            scientific.Append(digits[0]);
            if (digits.Length > 1) scientific.Append('.').Append(digits, 1, digits.Length - 1);
            scientific.Append('e');
            if (exponent >= 0) scientific.Append('+');
            scientific.Append(exponent.ToString(CultureInfo.InvariantCulture));
            return scientific.ToString();
        }

        // Parse-once (wedge phase 3, decode stall): the exact parse below is a pure function of the token, and one
        // result packet carries tens of thousands of numbers that the trust boundary used to re-parse in every
        // canonical pass (body, payload, nested arrays) and again when reading values. A bounded per-thread memo
        // keeps each distinct token's exact value; it is cleared, never evicted piecemeal, so results stay exact.
        internal const int MaxMemoizedNumbers = 65536;
        [ThreadStatic] private static Dictionary<string, double> memoizedNumbers;

        internal static bool TryParseNumber(string token, out double value)
        {
            if (token == null)
            {
                value = 0;
                return false;
            }
            var memo = memoizedNumbers;
            if (memo == null)
            {
                memo = new Dictionary<string, double>(StringComparer.Ordinal);
                memoizedNumbers = memo;
            }
            if (memo.TryGetValue(token, out value)) return true;
            if (!TryParseNumberExact(token, out value)) return false;
            if (memo.Count >= MaxMemoizedNumbers) memo.Clear();
            memo[token] = value;
            return true;
        }

        internal static void ClearNumberMemo()
        {
            memoizedNumbers?.Clear();
        }

        internal static int NumberMemoCount => memoizedNumbers?.Count ?? 0;

        /// <summary>The exact, unmemoized parse: JavaScript Number semantics, correcting Mono's one-ULP errors.</summary>
        internal static bool TryParseNumberExact(string token, out double value)
        {
            value = 0;
            double approximate;
            if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out approximate) ||
                double.IsNaN(approximate) || double.IsInfinity(approximate))
                return false;

            var negative = token.Length > 0 && token[0] == '-';
            var unsignedToken = negative ? token.Substring(1) : token;
            BigInteger decimalNumerator;
            BigInteger decimalDenominator;
            if (!TryParseDecimalRational(unsignedToken, out decimalNumerator, out decimalDenominator))
                return false;

            var approximateBits = unchecked((ulong)BitConverter.DoubleToInt64Bits(Math.Abs(approximate)));
            const ulong largestFiniteBits = 0x7fefffffffffffffUL;
            var bestBits = approximateBits;
            BigInteger approximateNumerator;
            BigInteger approximateDenominator;
            ExactBinaryRational(Math.Abs(approximate),
                out approximateNumerator, out approximateDenominator);
            var approximateEven = (approximateBits & 1UL) == 0;
            if (approximateBits > 0)
            {
                BigInteger previousNumerator;
                BigInteger previousDenominator;
                ExactBinaryRational(
                    BitConverter.Int64BitsToDouble(unchecked((long)(approximateBits - 1UL))),
                    out previousNumerator, out previousDenominator);
                var lowerNumerator = approximateNumerator * previousDenominator +
                                     previousNumerator * approximateDenominator;
                var lowerDenominator = 2 * approximateDenominator * previousDenominator;
                var lowerComparison = CompareRationals(
                    decimalNumerator, decimalDenominator, lowerNumerator, lowerDenominator);
                if (lowerComparison < 0 || (lowerComparison == 0 && !approximateEven))
                    bestBits = approximateBits - 1UL;
            }
            if (bestBits == approximateBits && approximateBits < largestFiniteBits)
            {
                BigInteger nextNumerator;
                BigInteger nextDenominator;
                ExactBinaryRational(
                    BitConverter.Int64BitsToDouble(unchecked((long)(approximateBits + 1UL))),
                    out nextNumerator, out nextDenominator);
                var upperNumerator = approximateNumerator * nextDenominator +
                                     nextNumerator * approximateDenominator;
                var upperDenominator = 2 * approximateDenominator * nextDenominator;
                var upperComparison = CompareRationals(
                    decimalNumerator, decimalDenominator, upperNumerator, upperDenominator);
                if (upperComparison > 0 || (upperComparison == 0 && !approximateEven))
                    bestBits = approximateBits + 1UL;
            }
            var signedBits = negative && bestBits != 0 ? bestBits | 0x8000000000000000UL : bestBits;
            value = BitConverter.Int64BitsToDouble(unchecked((long)signedBits));
            return true;
        }

        private static bool TryParseDecimalRational(
            string token,
            out BigInteger numerator,
            out BigInteger denominator)
        {
            numerator = BigInteger.Zero;
            denominator = BigInteger.One;
            var exponentAt = token.IndexOfAny(new[] { 'e', 'E' });
            var coefficient = exponentAt < 0 ? token : token.Substring(0, exponentAt);
            var exponent = 0;
            if (exponentAt >= 0 &&
                (!int.TryParse(token.Substring(exponentAt + 1), NumberStyles.AllowLeadingSign,
                     CultureInfo.InvariantCulture, out exponent) || exponent < -400 || exponent > 400))
                return false;
            var decimalAt = coefficient.IndexOf('.');
            var fractionalDigits = decimalAt < 0 ? 0 : coefficient.Length - decimalAt - 1;
            var digits = decimalAt < 0
                ? coefficient
                : coefficient.Remove(decimalAt, 1);
            // ECMAScript's shortest finite representation never needs more than
            // 21 fixed digits (or 17 significant scientific digits). This also
            // bounds work at the native trust boundary before BigInteger parsing.
            if (digits.Length == 0 || digits.Length > 24 ||
                !BigInteger.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out numerator))
                return false;
            var scaleExponent = exponent - fractionalDigits;
            if (scaleExponent >= 0) numerator *= BigInteger.Pow(10, scaleExponent);
            else denominator = BigInteger.Pow(10, -scaleExponent);
            return true;
        }

        private static string ShortestRoundTrip(double value)
        {
            // Unity's Mono formatter and ECMAScript may choose adjacent shortest
            // decimals for the same IEEE-754 value. JSON.stringify chooses the
            // closest shortest decimal (ties choose an even significand), so do
            // that choice against the exact binary rational instead of trusting
            // the runtime's legacy "R" formatter.
            var negative = value < 0;
            var magnitude = Math.Abs(value);
            BigInteger numerator;
            BigInteger denominator;
            ExactBinaryRational(magnitude, out numerator, out denominator);

            var decimalExponent = (int)Math.Floor(Math.Log10(magnitude));
            while (CompareToPowerOfTen(numerator, denominator, decimalExponent) < 0)
                decimalExponent--;
            while (CompareToPowerOfTen(numerator, denominator, decimalExponent + 1) >= 0)
                decimalExponent++;

            for (var precision = 1; precision <= 17; precision++)
            {
                var scaleExponent = decimalExponent - precision + 1;
                var scaledNumerator = numerator;
                var scaledDenominator = denominator;
                if (scaleExponent >= 0)
                    scaledDenominator *= BigInteger.Pow(10, scaleExponent);
                else
                    scaledNumerator *= BigInteger.Pow(10, -scaleExponent);

                BigInteger remainder;
                var floor = BigInteger.DivRem(scaledNumerator, scaledDenominator, out remainder);
                string bestText = null;
                BigInteger bestSignificand = BigInteger.Zero;
                BigInteger bestDifference = BigInteger.Zero;
                BigInteger bestDifferenceDenominator = BigInteger.One;

                for (var offset = 0; offset <= 1; offset++)
                {
                    var significand = floor + offset;
                    if (significand <= 0) continue;
                    var candidate = FormatDecimal(significand, scaleExponent, negative);
                    BigInteger candidateNumerator;
                    BigInteger candidateDenominator;
                    CandidateRational(significand, scaleExponent,
                        out candidateNumerator, out candidateDenominator);
                    if (!RoundsToExactDouble(
                            magnitude, candidateNumerator, candidateDenominator))
                        continue;
                    var difference = BigInteger.Abs(
                        numerator * candidateDenominator - candidateNumerator * denominator);
                    var differenceDenominator = denominator * candidateDenominator;
                    var isCloser = bestText == null ||
                                   difference * bestDifferenceDenominator <
                                   bestDifference * differenceDenominator;
                    var isTie = bestText != null &&
                                difference * bestDifferenceDenominator ==
                                bestDifference * differenceDenominator;
                    if (isCloser || (isTie && significand.IsEven && !bestSignificand.IsEven))
                    {
                        bestText = candidate;
                        bestSignificand = significand;
                        bestDifference = difference;
                        bestDifferenceDenominator = differenceDenominator;
                    }
                }

                if (bestText != null) return bestText;
            }

            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        private static bool RoundsToExactDouble(
            double value,
            BigInteger candidateNumerator,
            BigInteger candidateDenominator)
        {
            var bits = unchecked((ulong)BitConverter.DoubleToInt64Bits(value));
            BigInteger valueNumerator;
            BigInteger valueDenominator;
            ExactBinaryRational(value, out valueNumerator, out valueDenominator);
            var even = (bits & 1UL) == 0;

            BigInteger previousNumerator;
            BigInteger previousDenominator;
            ExactBinaryRational(
                BitConverter.Int64BitsToDouble(unchecked((long)(bits - 1UL))),
                out previousNumerator,
                out previousDenominator);
            var lowerNumerator = valueNumerator * previousDenominator +
                                 previousNumerator * valueDenominator;
            var lowerDenominator = 2 * valueDenominator * previousDenominator;
            var lowerComparison = CompareRationals(
                candidateNumerator, candidateDenominator,
                lowerNumerator, lowerDenominator);
            if (lowerComparison < 0 || (lowerComparison == 0 && !even)) return false;

            // The largest finite double has no finite successor; every bounded
            // candidate considered here is below its overflow boundary.
            if (bits == 0x7fefffffffffffffUL) return true;
            BigInteger nextNumerator;
            BigInteger nextDenominator;
            ExactBinaryRational(
                BitConverter.Int64BitsToDouble(unchecked((long)(bits + 1UL))),
                out nextNumerator,
                out nextDenominator);
            var upperNumerator = valueNumerator * nextDenominator +
                                 nextNumerator * valueDenominator;
            var upperDenominator = 2 * valueDenominator * nextDenominator;
            var upperComparison = CompareRationals(
                candidateNumerator, candidateDenominator,
                upperNumerator, upperDenominator);
            return upperComparison < 0 || (upperComparison == 0 && even);
        }

        private static int CompareRationals(
            BigInteger leftNumerator,
            BigInteger leftDenominator,
            BigInteger rightNumerator,
            BigInteger rightDenominator)
        {
            return (leftNumerator * rightDenominator)
                .CompareTo(rightNumerator * leftDenominator);
        }

        private static void ExactBinaryRational(
            double value,
            out BigInteger numerator,
            out BigInteger denominator)
        {
            var bits = unchecked((ulong)BitConverter.DoubleToInt64Bits(value));
            var encodedExponent = (int)((bits >> 52) & 0x7ffUL);
            var fraction = bits & 0x000fffffffffffffUL;
            ulong significand;
            int binaryExponent;
            if (encodedExponent == 0)
            {
                significand = fraction;
                binaryExponent = -1074;
            }
            else
            {
                significand = fraction | 0x0010000000000000UL;
                binaryExponent = encodedExponent - 1075;
            }

            numerator = new BigInteger(significand);
            denominator = BigInteger.One;
            if (binaryExponent >= 0) numerator <<= binaryExponent;
            else denominator <<= -binaryExponent;
        }

        private static int CompareToPowerOfTen(
            BigInteger numerator,
            BigInteger denominator,
            int exponent)
        {
            return exponent >= 0
                ? numerator.CompareTo(denominator * BigInteger.Pow(10, exponent))
                : (numerator * BigInteger.Pow(10, -exponent)).CompareTo(denominator);
        }

        private static void CandidateRational(
            BigInteger significand,
            int scaleExponent,
            out BigInteger numerator,
            out BigInteger denominator)
        {
            if (scaleExponent >= 0)
            {
                numerator = significand * BigInteger.Pow(10, scaleExponent);
                denominator = BigInteger.One;
            }
            else
            {
                numerator = significand;
                denominator = BigInteger.Pow(10, -scaleExponent);
            }
        }

        private static string FormatDecimal(BigInteger significand, int scaleExponent, bool negative)
        {
            while (significand % 10 == 0)
            {
                significand /= 10;
                scaleExponent++;
            }

            var digits = significand.ToString(CultureInfo.InvariantCulture);
            var decimalPosition = digits.Length + scaleExponent;
            var result = new StringBuilder(digits.Length + Math.Abs(scaleExponent) + 8);
            if (negative) result.Append('-');

            if (decimalPosition > 0 && decimalPosition <= 21)
            {
                if (decimalPosition >= digits.Length)
                {
                    result.Append(digits);
                    result.Append('0', decimalPosition - digits.Length);
                }
                else
                {
                    result.Append(digits, 0, decimalPosition);
                    result.Append('.');
                    result.Append(digits, decimalPosition, digits.Length - decimalPosition);
                }
                return result.ToString();
            }

            if (decimalPosition > -6 && decimalPosition <= 0)
            {
                result.Append("0.");
                result.Append('0', -decimalPosition);
                result.Append(digits);
                return result.ToString();
            }

            result.Append(digits[0]);
            if (digits.Length > 1)
            {
                result.Append('.');
                result.Append(digits, 1, digits.Length - 1);
            }
            result.Append('e');
            var exponent = decimalPosition - 1;
            if (exponent >= 0) result.Append('+');
            result.Append(exponent.ToString(CultureInfo.InvariantCulture));
            return result.ToString();
        }

        public static string Object(params string[] sortedKeyValuePairs)
        {
            if (sortedKeyValuePairs == null || sortedKeyValuePairs.Length % 2 != 0)
                throw new ArgumentException("Canonical JSON requires key/value pairs.", nameof(sortedKeyValuePairs));

            var output = new StringBuilder();
            output.Append('{');
            string previous = null;
            for (var index = 0; index < sortedKeyValuePairs.Length; index += 2)
            {
                var key = sortedKeyValuePairs[index];
                var rawValue = sortedKeyValuePairs[index + 1];
                if (key == null || rawValue == null) throw new ArgumentNullException(nameof(sortedKeyValuePairs));
                if (previous != null && string.CompareOrdinal(previous, key) >= 0)
                    throw new ArgumentException("Canonical JSON keys must be unique and ordinally sorted.");
                if (index > 0) output.Append(',');
                output.Append(String(key)).Append(':').Append(rawValue);
                previous = key;
            }

            return output.Append('}').ToString();
        }
    }
}
