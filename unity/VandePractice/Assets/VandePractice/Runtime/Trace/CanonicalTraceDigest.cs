using System;
using System.Globalization;
using System.Text;
using Vande.Practice.Bridge;

namespace Vande.Practice.Trace
{
    /// <summary>
    /// Stable v2 canonical form. Floating-point values use their IEEE-754 bits,
    /// so formatting and locale cannot change the digest. TypeScript should use
    /// DataView.setFloat64(..., false) and lowercase 16-digit hex for parity.
    /// Strings are UTF-8 bytes percent-encoded in uppercase.
    /// </summary>
    public static class CanonicalTraceDigest
    {
        public static string Compute(CanonicalDeliveryTrace trace)
        {
            return Sha256Digest.OfUtf8(Canonicalize(trace));
        }

        public static string Canonicalize(CanonicalDeliveryTrace trace)
        {
            CanonicalTraceValidator.Validate(trace);
            var value = new StringBuilder(1024);
            Append(value, "format", "vande-canonical-trace-v2");
            Append(value, "traceVersion", trace.traceVersion.ToString(CultureInfo.InvariantCulture));
            Append(value, "deliveryId", Escape(trace.deliveryId));
            Append(value, "simulationVersion", trace.simulationVersion.ToString(CultureInfo.InvariantCulture));
            Append(value, "duration", DoubleBits(trace.durationSeconds));
            Append(value, "batterRootOffset",
                Join(DoubleBits(trace.batterRootOffset.x), DoubleBits(trace.batterRootOffset.z)));
            Append(value, "batterPosture", DoubleBits(trace.batterPosture.crouchM));
            Append(value, "batterMotion", trace.batterMotion == null
                ? "null"
                : Join(DoubleBits(trace.batterMotion.startT),
                    DoubleBits(trace.batterMotion.contactT),
                    DoubleBits(trace.batterMotion.endT)));
            Append(value, "ball.count", trace.ball.Length.ToString(CultureInfo.InvariantCulture));

            for (var index = 0; index < trace.ball.Length; index++)
            {
                var sample = trace.ball[index];
                Append(value, "ball." + index.ToString(CultureInfo.InvariantCulture),
                    Join(DoubleBits(sample.t), Vector(sample.p), Vector(sample.v)));
            }

            Append(value, "bat.count", trace.bat.Length.ToString(CultureInfo.InvariantCulture));
            for (var index = 0; index < trace.bat.Length; index++)
            {
                var sample = trace.bat[index];
                Append(value, "bat." + index.ToString(CultureInfo.InvariantCulture),
                    Join(DoubleBits(sample.t), Vector(sample.grip), Vector(sample.toe), Vector(sample.face)));
            }

            Append(value, "fielder.count", trace.fielders.Length.ToString(CultureInfo.InvariantCulture));
            for (var pathIndex = 0; pathIndex < trace.fielders.Length; pathIndex++)
            {
                var path = trace.fielders[pathIndex];
                Append(value, "fielder." + pathIndex.ToString(CultureInfo.InvariantCulture) + ".id",
                    Escape(path.fielderId));
                Append(value, "fielder." + pathIndex.ToString(CultureInfo.InvariantCulture) + ".count",
                    path.samples.Length.ToString(CultureInfo.InvariantCulture));
                for (var sampleIndex = 0; sampleIndex < path.samples.Length; sampleIndex++)
                {
                    var sample = path.samples[sampleIndex];
                    Append(value,
                        "fielder." + pathIndex.ToString(CultureInfo.InvariantCulture) + "." +
                        sampleIndex.ToString(CultureInfo.InvariantCulture),
                        Join(DoubleBits(sample.t), DoubleBits(sample.x), DoubleBits(sample.z),
                            Escape(sample.action)));
                }
            }

            Append(value, "event.count", trace.events.Length.ToString(CultureInfo.InvariantCulture));
            for (var index = 0; index < trace.events.Length; index++)
            {
                var traceEvent = trace.events[index];
                Append(value, "event." + index.ToString(CultureInfo.InvariantCulture),
                    Join(DoubleBits(traceEvent.t), Escape(traceEvent.kind),
                        Escape(traceEvent.fielderId ?? string.Empty), Escape(traceEvent.contact ?? string.Empty),
                        traceEvent.runs.ToString(CultureInfo.InvariantCulture),
                        traceEvent.completed.ToString(CultureInfo.InvariantCulture),
                        OptionalVector(traceEvent.p)));
            }

            return value.ToString();
        }

        private static string Vector(TraceVector3 value)
        {
            return Join(DoubleBits(value.x), DoubleBits(value.y), DoubleBits(value.z));
        }

        private static string OptionalVector(TraceVector3 value)
        {
            return value == null ? "null" : "vector:" + Vector(value);
        }

        private static string DoubleBits(double value)
        {
            return unchecked((ulong)BitConverter.DoubleToInt64Bits(value)).ToString("x16", CultureInfo.InvariantCulture);
        }

        private static string Escape(string value)
        {
            var bytes = Encoding.UTF8.GetBytes(value);
            var escaped = new StringBuilder(bytes.Length * 3);
            for (var index = 0; index < bytes.Length; index++)
            {
                var character = bytes[index];
                var unreserved = (character >= (byte)'a' && character <= (byte)'z') ||
                                 (character >= (byte)'A' && character <= (byte)'Z') ||
                                 (character >= (byte)'0' && character <= (byte)'9') ||
                                 character == (byte)'-' || character == (byte)'_' ||
                                 character == (byte)'.' || character == (byte)'~';
                if (unreserved)
                {
                    escaped.Append((char)character);
                }
                else
                {
                    escaped.Append('%');
                    escaped.Append(character.ToString("X2", CultureInfo.InvariantCulture));
                }
            }

            return escaped.ToString();
        }

        private static string Join(params string[] values)
        {
            return string.Join("|", values);
        }

        private static void Append(StringBuilder builder, string key, string value)
        {
            builder.Append(key).Append('=').Append(value).Append('\n');
        }
    }
}
