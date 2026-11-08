using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// Runs corpus cases through the bridge and writes one line per case: the decision (A accepted, R rejected with the
    /// reason, X any other exception), and for an accepted packet a digest of the parsed model. A line recorded from the
    /// pre-change bridge is the oracle; the changed bridge must reproduce every line byte for byte.
    /// </summary>
    public static class BridgeEquivalenceOracle
    {
        // ---------------------------------------------------------------- packet level

        /// <summary>Recording line: P, id, a digest of the input packet (so the corpus itself is pinned), the decision.</summary>
        public static string RunPacket(OracleCase item)
        {
            string packet;
            try { packet = item.Make(); }
            catch (Exception error) { return "P\t" + SafeId(item.Id) + "\t-\tG|corpus generation failed: " + error.GetType().Name + " " + Clean(error.Message); }
            return "P\t" + SafeId(item.Id) + "\t" + Short(packet) + "\t" + Decide(packet);
        }

        public static string SafeId(string id)
        {
            return id.Replace("\t", "%09").Replace("\n", "%0a").Replace("\r", "%0d").Replace("\0", "%00");
        }

        public static string Decide(string packet)
        {
            try
            {
                var decoded = UnityPracticePacketCodec.Decode(packet);
                var extras = AdapterExtras(decoded.Envelope);
                return "A|" + Short(ModelDump(decoded)) + (extras == null ? string.Empty : "|" + extras);
            }
            catch (BridgeValidationException error)
            {
                return "R|" + Clean(error.Message);
            }
            catch (Exception error)
            {
                return "X|" + error.GetType().Name + ":" + Clean(error.Message);
            }
        }

        private static string Clean(string text)
        {
            if (text == null) return "~";
            return text.Replace("\r", "\\r").Replace("\n", "\\n").Replace("|", "\\p");
        }

        private static string Short(string text)
        {
            return WireKit.Sha256Hex(text).Substring(0, 16);
        }

        /// <summary>Everything the bridge hands on for an accepted packet: packet, envelope, the parsed payload and the projections.</summary>
        public static string ModelDump(DecodedUnityPracticePacket decoded)
        {
            var builder = new StringBuilder(4096);
            var packet = decoded.Packet;
            var envelope = decoded.Envelope;
            builder.Append("packet.sha256=").Append(packet.sha256).Append('\n');
            builder.Append("packet.body=").Append(packet.body.Length).Append(':').Append(WireKit.Sha256Hex(packet.body)).Append('\n');
            builder.Append("envelope=").Append(envelope.contractVersion).Append('|').Append(envelope.simVersion).Append('|')
                .Append(envelope.buildId).Append('|').Append(envelope.sessionId).Append('|').Append(envelope.deliveryId ?? "~")
                .Append('|').Append(envelope.messageId).Append('|').Append(envelope.sequence).Append('|').Append(envelope.sender)
                .Append('|').Append(envelope.type).Append('\n');
            builder.Append("payload=").Append(envelope.payloadJson.Length).Append(':').Append(WireKit.Sha256Hex(envelope.payloadJson)).Append('\n');
            var parsed = envelope.ParsedPayload();
            builder.Append("parsed.count=").Append(parsed.Count).Append('\n');
            builder.Append("parsed.rawObject=").Append(WireKit.Sha256Hex(parsed.RawObject())).Append('\n');
            if (envelope.type == "host.result" || envelope.type == "host.replay" || envelope.type == "host.demonstration")
            {
                var presentation = PracticePresentationContractAdapter.Result(envelope);
                Dump(builder, presentation, "result", 0);
            }
            return builder.ToString();
        }

        private static string AdapterExtras(UnityPracticeEnvelope envelope)
        {
#if STANDALONE_HARNESS
            return null;
#else
            try
            {
                var builder = new StringBuilder();
                switch (envelope.type)
                {
                    case "host.initialize": Dump(builder, PracticePresentationContractAdapter.Initialize(envelope), "initialize", 0); break;
                    case "host.scene": Dump(builder, PracticePresentationContractAdapter.Scene(envelope), "scene", 0); break;
                    case "host.delivery": Dump(builder, PracticePresentationContractAdapter.Delivery(envelope), "delivery", 0); break;
                    case "host.provisional_swing": Dump(builder, PracticePresentationContractAdapter.ProvisionalSwing(envelope), "swing", 0); break;
                    case "host.profile": Dump(builder, PracticePresentationContractAdapter.Profile(envelope), "profile", 0); break;
                    case "host.locale": Dump(builder, PracticePresentationContractAdapter.Locale(envelope), "locale", 0); break;
                    case "host.benchmark": Dump(builder, PracticePresentationContractAdapter.Benchmark(envelope), "benchmark", 0); break;
                    default: return null;
                }
                return "adapter=" + Short(builder.ToString());
            }
            catch (Exception error)
            {
                return "adapter!" + error.GetType().Name + ":" + Clean(error.Message);
            }
#endif
        }

        private static readonly Dictionary<Type, MemberInfo[]> MemberCache = new Dictionary<Type, MemberInfo[]>();

        private static MemberInfo[] MembersOf(Type type)
        {
            MemberInfo[] members;
            if (MemberCache.TryGetValue(type, out members)) return members;
            var list = new List<MemberInfo>();
            foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.Instance)) list.Add(field);
            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                if (property.CanRead && property.GetIndexParameters().Length == 0) list.Add(property);
            list.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
            members = list.ToArray();
            MemberCache[type] = members;
            return members;
        }

        /// <summary>A stable dump of a presentation object graph: doubles as IEEE bit patterns, strings quoted, members by name.</summary>
        public static void Dump(StringBuilder builder, object value, string path, int depth)
        {
            if (value == null) { builder.Append(path).Append("=~\n"); return; }
            if (depth > 12) { builder.Append(path).Append("=<deep>\n"); return; }
            var text = value as string;
            if (text != null) { builder.Append(path).Append("=s").Append(text.Length).Append(':').Append(WireKit.Q(text)).Append('\n'); return; }
            if (value is double) { builder.Append(path).Append("=d").Append(BitConverter.DoubleToInt64Bits((double)value).ToString("x16", CultureInfo.InvariantCulture)).Append('\n'); return; }
            if (value is float) { builder.Append(path).Append("=f").Append(BitConverter.ToInt32(BitConverter.GetBytes((float)value), 0).ToString("x8", CultureInfo.InvariantCulture)).Append('\n'); return; }
            var type = value.GetType();
            if (type.IsPrimitive || type.IsEnum || value is decimal)
            {
                builder.Append(path).Append('=').Append(Convert.ToString(value, CultureInfo.InvariantCulture)).Append('\n');
                return;
            }
            var array = value as Array;
            if (array != null)
            {
                builder.Append(path).Append(".len=").Append(array.Length).Append('\n');
                for (var index = 0; index < array.Length; index++)
                    Dump(builder, array.GetValue(index), path + "[" + index + "]", depth + 1);
                return;
            }
            builder.Append(path).Append("={}\n");
            foreach (var member in MembersOf(type))
            {
                object child;
                var field = member as FieldInfo;
                if (field != null) child = field.GetValue(value);
                else child = ((PropertyInfo)member).GetValue(value, null);
                Dump(builder, child, path + "." + member.Name, depth + 1);
            }
        }

        // ---------------------------------------------------------------- StrictJsonObject level

        /// <summary>Recording line: J, id, mode (P plain, C canonical), a digest of the input, the decision and a digest of every accessor's answer.</summary>
        public static string RunJson(string id, string json, bool canonical)
        {
            var head = "J\t" + SafeId(id) + "\t" + (canonical ? "C" : "P") + "\t" + Short(json) + "\t";
            try
            {
                var parsed = canonical ? StrictJsonObject.ParseCanonical(json) : StrictJsonObject.Parse(json);
                var builder = new StringBuilder();
                ProbeObject(builder, parsed, json, "$", 0);
                return head + "A|" + Short(builder.ToString());
            }
            catch (BridgeValidationException error)
            {
                return head + "R|" + Clean(error.Message);
            }
            catch (Exception error)
            {
                return head + "X|" + error.GetType().Name + ":" + Clean(error.Message);
            }
        }

        /// <summary>The same probe with the full text, for diffing two builds by eye.</summary>
        public static string ProbeText(string json, bool canonical)
        {
            var builder = new StringBuilder();
            try
            {
                var parsed = canonical ? StrictJsonObject.ParseCanonical(json) : StrictJsonObject.Parse(json);
                ProbeObject(builder, parsed, json, "$", 0);
            }
            catch (Exception error) { builder.Append("EXC ").Append(error.GetType().Name).Append(' ').Append(error.Message); }
            return builder.ToString();
        }

        private static string Try(Func<object> action)
        {
            try
            {
                var value = action();
                var text = value as string;
                if (text != null) return text.Length > 60 ? "s" + text.Length + ":" + Short(text) : "s:" + WireKit.Q(text);
                if (value is double) return "d" + BitConverter.DoubleToInt64Bits((double)value).ToString("x16", CultureInfo.InvariantCulture);
                if (value == null) return "~";
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            }
            catch (Exception error)
            {
                return "!" + error.GetType().Name + ":" + Clean(error.Message);
            }
        }

        private static void ProbeObject(StringBuilder builder, StrictJsonObject obj, string text, string path, int depth)
        {
            builder.Append(path).Append(".count=").Append(obj.Count).Append(" raw=").Append(Try(() => obj.RawObject())).Append('\n');
            var keys = TopLevelKeys(text);
            if (keys == null) { builder.Append(path).Append(".keys=<unreadable>\n"); return; }
            if (keys.Count > 24)
            {
                // A very wide object: probe its first and last dozen members (every accessor on 100,000 members would take minutes).
                var narrowed = new List<string>(keys.GetRange(0, 12));
                narrowed.AddRange(keys.GetRange(keys.Count - 12, 12));
                keys = narrowed;
            }
            keys.Add("\u0001missing");
            foreach (var key in keys)
            {
                var prefix = path + "/" + key + " ";
                builder.Append(prefix).Append("has=").Append(obj.Contains(key))
                    .Append(" raw=").Append(Try(() => obj.Raw(key)))
                    .Append(" null=").Append(Try(() => obj.IsNull(key)))
                    .Append(" str=").Append(Try(() => obj.String(key)))
                    .Append(" strN=").Append(Try(() => obj.String(key, true)))
                    .Append(" int=").Append(Try(() => obj.Integer(key)))
                    .Append(" num=").Append(Try(() => obj.Number(key)))
                    .Append(" bool=").Append(Try(() => obj.Boolean(key)))
                    .Append('\n');
                builder.Append(prefix).Append("numArr3=").Append(Try(() => DumpDoubles(obj.NumberArray(key, 3))))
                    .Append(" numArr1k=").Append(Try(() => DumpDoubles(obj.NumberArray(key, 1000)))).Append('\n');
                StrictJsonObject child = null;
                string childText = null;
                var childResult = Try(() => { child = obj.Object(key); childText = obj.Raw(key); return child.Count; });
                builder.Append(prefix).Append("obj=").Append(childResult).Append('\n');
                var again = Try(() => { var second = obj.Object(key); return second.Count; });
                builder.Append(prefix).Append("objAgain=").Append(again).Append('\n');
                if (child != null && depth < 3) ProbeObject(builder, child, childText, path + "/" + key, depth + 1);
                foreach (var limit in new[] { 3, 1000, 2 })
                {
                    StrictJsonObject[] items = null;
                    var result = Try(() => { items = obj.ObjectArray(key, limit); return items.Length; });
                    builder.Append(prefix).Append("objArr").Append(limit).Append('=').Append(result).Append('\n');
                    if (items != null && limit == 1000 && depth < 2)
                    {
                        for (var index = 0; index < items.Length && index < 6; index++)
                            ProbeObject(builder, items[index], items[index].RawObject(), path + "/" + key + "[" + index + "]", depth + 1);
                    }
                }
            }
        }

        private static string DumpDoubles(double[] values)
        {
            var builder = new StringBuilder("[");
            for (var index = 0; index < values.Length; index++)
            {
                if (index > 0) builder.Append(',');
                builder.Append(BitConverter.DoubleToInt64Bits(values[index]).ToString("x16", CultureInfo.InvariantCulture));
            }
            return builder.Append(']').ToString();
        }

        /// <summary>
        /// Decoded top-level member names of an object text, read by a minimal independent scanner;
        /// null when the text is not a plain object this scanner understands.
        /// </summary>
        private static List<string> TopLevelKeys(string text)
        {
            try
            {
                var keys = new List<string>();
                var distinct = new HashSet<string>(StringComparer.Ordinal);
                var index = 0;
                while (index < text.Length && char.IsWhiteSpace(text[index])) index++;
                if (index >= text.Length || text[index] != '{') return null;
                index++;
                while (true)
                {
                    while (index < text.Length && char.IsWhiteSpace(text[index])) index++;
                    if (index >= text.Length) return null;
                    if (text[index] == '}') return keys;
                    if (text[index] == ',') { index++; continue; }
                    if (text[index] != '"') return null;
                    var end = WireKit.EndOfString(text, index);
                    var name = DecodeKey(text.Substring(index + 1, end - index - 2));
                    if (name == null) return null;
                    if (distinct.Add(name)) keys.Add(name);
                    index = end;
                    while (index < text.Length && char.IsWhiteSpace(text[index])) index++;
                    if (index >= text.Length || text[index] != ':') return null;
                    index++;
                    while (index < text.Length && char.IsWhiteSpace(text[index])) index++;
                    index = WireKit.EndOfValue(text, index);
                }
            }
            catch (Exception) { return null; }
        }

        private static string DecodeKey(string raw)
        {
            var builder = new StringBuilder();
            for (var index = 0; index < raw.Length; index++)
            {
                var c = raw[index];
                if (c != '\\') { builder.Append(c); continue; }
                index++;
                switch (raw[index])
                {
                    case '"': builder.Append('"'); break;
                    case '\\': builder.Append('\\'); break;
                    case '/': builder.Append('/'); break;
                    case 'b': builder.Append('\b'); break;
                    case 'f': builder.Append('\f'); break;
                    case 'n': builder.Append('\n'); break;
                    case 'r': builder.Append('\r'); break;
                    case 't': builder.Append('\t'); break;
                    case 'u':
                        builder.Append((char)int.Parse(raw.Substring(index + 1, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
                        index += 4;
                        break;
                    default: return null;
                }
            }
            return builder.ToString();
        }

        // ---------------------------------------------------------------- session level

        /// <summary>Feeds the packets to a fresh session one by one; one line per step: state, accepted types, emitted packets, diagnostics.</summary>
        public static List<string> RunScenario(string id, IList<string> packets, int mode = 0)
        {
            var lines = new List<string>();
            var inputs = new StringBuilder();
            foreach (var packet in packets) inputs.Append(packet ?? "~").Append('\n');
            lines.Add("S\t" + SafeId(id) + "\tinput\t" + Short(inputs.ToString()));
            var emitted = new List<string>();
            var accepted = new List<string>();
            var diagnostics = new List<string>();
            var clock = 1000.0;
            var session = new UnityPracticeBridgeSession(
                packet => emitted.Add("E:" + packet),
                packet => emitted.Add("R:" + packet),
                () => { clock += 1.0; return clock; },
                "6000.3.27f1",
                envelope => accepted.Add(envelope.type + "#" + envelope.messageId + "@" + envelope.sequence),
                diagnostic => diagnostics.Add(diagnostic));
#if HAS_BACKGROUND_DECODE
            // mode 1: the background-decode machinery with every decode run at once; mode 2: a real worker thread, flushed after each step.
            if (mode == 1) session.EnableBackgroundDecode(new ImmediateScheduler());
            else if (mode == 2) session.EnableBackgroundDecode();
#endif
            var seenEmitted = 0;
            var seenAccepted = 0;
            var seenDiagnostics = 0;
            for (var step = 0; step < packets.Count; step++)
            {
                string failure = null;
                try
                {
                    var text = packets[step];
                    if (text.StartsWith("!dead|", StringComparison.Ordinal))
                    {
                        // Unity reports the delivery complete: !dead|<deadT token>|<replay digest>
                        var parts = text.Split('|');
                        double deadT;
                        if (!CanonicalJson.TryParseNumberExact(parts[1], out deadT)) throw new InvalidOperationException("bad deadT token");
                        session.ReportDeliveryDead(deadT, parts[2]);
                    }
                    else if (text == "!pause") failure = "pause=" + session.TryReportPauseRequest();
                    else session.ReceivePacket(text);
                }
                catch (Exception error) { failure = error.GetType().Name + ":" + Clean(error.Message); }
#if HAS_BACKGROUND_DECODE
                if (mode != 0) session.Flush();
#endif
                var line = new StringBuilder("S\t").Append(SafeId(id)).Append('#').Append(step.ToString("D2", CultureInfo.InvariantCulture))
                    .Append('\t').Append(session.State).Append('|').Append(session.ClockSynchronized ? "clk" : "noclk");
                line.Append("|acc=");
                for (var index = seenAccepted; index < accepted.Count; index++) line.Append(accepted[index]).Append(';');
                line.Append("|emit=");
                for (var index = seenEmitted; index < emitted.Count; index++) line.Append(Short(emitted[index])).Append(';');
                line.Append("|diag=");
                for (var index = seenDiagnostics; index < diagnostics.Count; index++) line.Append(Clean(diagnostics[index])).Append(';');
                if (failure != null) line.Append("|throw=").Append(failure);
                seenEmitted = emitted.Count;
                seenAccepted = accepted.Count;
                seenDiagnostics = diagnostics.Count;
                lines.Add(line.ToString());
            }
            return lines;
        }
    }
}
