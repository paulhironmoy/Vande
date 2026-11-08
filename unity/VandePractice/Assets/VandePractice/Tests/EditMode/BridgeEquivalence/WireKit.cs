using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// Test-side wire helpers for the bridge equivalence corpus. They are written independently of the Bridge sources
    /// (no StrictJsonObject, no CanonicalJson, no Sha256Digest): a corpus built by the code under test could not
    /// prove that code unchanged. Everything here is deterministic and works on plain canonical JSON text.
    /// </summary>
    /// <summary>Public door to the SHA helper for the standalone harness (WireKit itself is internal to the test assembly).</summary>
    public static class WireKitAccess
    {
        public static string Sha(string text) { return WireKit.Sha256Hex(text); }
    }

    internal static class WireKit
    {
        public static string Sha256Hex(string text)
        {
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                var builder = new StringBuilder(64);
                for (var index = 0; index < hash.Length; index++)
                    builder.Append(hash[index].ToString("x2", CultureInfo.InvariantCulture));
                return builder.ToString();
            }
        }

        /// <summary>Canonical JSON string literal (ECMAScript JSON.stringify rules for the characters the contract uses).</summary>
        public static string Q(string value)
        {
            if (value == null) return "null";
            var result = new StringBuilder(value.Length + 2).Append('"');
            for (var index = 0; index < value.Length; index++)
            {
                var c = value[index];
                switch (c)
                {
                    case '"': result.Append("\\\""); break;
                    case '\\': result.Append("\\\\"); break;
                    case '\b': result.Append("\\b"); break;
                    case '\f': result.Append("\\f"); break;
                    case '\n': result.Append("\\n"); break;
                    case '\r': result.Append("\\r"); break;
                    case '\t': result.Append("\\t"); break;
                    default:
                        if (c < 0x20) result.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else result.Append(c);
                        break;
                }
            }
            return result.Append('"').ToString();
        }

        /// <summary>How JsonUtility.ToJson (and the host's JSON.stringify) writes the packet's body string.</summary>
        public static string Escape(string value)
        {
            var result = new StringBuilder(value.Length + value.Length / 8 + 8);
            for (var index = 0; index < value.Length; index++)
            {
                var c = value[index];
                if (c == '"') result.Append("\\\"");
                else if (c == '\\') result.Append("\\\\");
                else if (c < 0x20) result.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else result.Append(c);
            }
            return result.ToString();
        }

        /// <summary>The packet as JsonUtility writes it: sha256 first, then body.</summary>
        public static string Seal(string body)
        {
            return "{\"sha256\":\"" + Sha256Hex(body) + "\",\"body\":\"" + Escape(body) + "\"}";
        }

        /// <summary>The packet as the host's JSON.stringify writes it: body first, then sha256.</summary>
        public static string SealBodyFirst(string body)
        {
            return "{\"body\":\"" + Escape(body) + "\",\"sha256\":\"" + Sha256Hex(body) + "\"}";
        }

        public static string SealWithSha(string body, string sha)
        {
            return "{\"sha256\":\"" + sha + "\",\"body\":\"" + Escape(body) + "\"}";
        }

        public static string Body(
            string type,
            long sequence,
            string deliveryId,
            string payload,
            string sender = "host",
            string buildId = "build-1",
            string sessionId = "session-1",
            string messageId = null,
            string contractVersion = "7",
            string simVersion = "3")
        {
            if (messageId == null) messageId = sender + "-" + sequence.ToString(CultureInfo.InvariantCulture);
            return "{\"buildId\":" + Q(buildId) + ",\"contractVersion\":" + contractVersion +
                   ",\"deliveryId\":" + (deliveryId == null ? "null" : Q(deliveryId)) +
                   ",\"messageId\":" + Q(messageId) + ",\"payload\":" + payload +
                   ",\"sender\":" + Q(sender) + ",\"sequence\":" + sequence.ToString(CultureInfo.InvariantCulture) +
                   ",\"sessionId\":" + Q(sessionId) + ",\"simVersion\":" + simVersion + ",\"type\":" + Q(type) + "}";
        }

        // ---- Minimal navigation over well-formed canonical JSON text (spans, never a parse tree) ----

        public static int EndOfString(string json, int start)
        {
            var index = start + 1;
            while (json[index] != '"') index += json[index] == '\\' ? 2 : 1;
            return index + 1;
        }

        public static int EndOfValue(string json, int start)
        {
            var c = json[start];
            if (c == '"') return EndOfString(json, start);
            if (c == '{' || c == '[')
            {
                var depth = 0;
                for (var index = start; index < json.Length; index++)
                {
                    var d = json[index];
                    if (d == '"') { index = EndOfString(json, index) - 1; continue; }
                    if (d == '{' || d == '[') depth++;
                    else if (d == '}' || d == ']')
                    {
                        depth--;
                        if (depth == 0) return index + 1;
                    }
                }
                throw new InvalidOperationException("unterminated container");
            }
            var end = start;
            while (end < json.Length && json[end] != ',' && json[end] != '}' && json[end] != ']') end++;
            return end;
        }

        public static bool TryMember(string json, int objectStart, string key, out int valueStart, out int valueEnd)
        {
            var index = objectStart + 1;
            while (index < json.Length && json[index] != '}')
            {
                var keyEnd = EndOfString(json, index);
                var name = json.Substring(index + 1, keyEnd - index - 2);
                var start = keyEnd + 1;
                var end = EndOfValue(json, start);
                if (name == key) { valueStart = start; valueEnd = end; return true; }
                index = end;
                if (json[index] == ',') index++;
            }
            valueStart = valueEnd = -1;
            return false;
        }

        public static void Span(string json, out int start, out int end, params string[] path)
        {
            start = 0;
            end = EndOfValue(json, 0);
            for (var level = 0; level < path.Length; level++)
            {
                int next, nextEnd;
                if (!TryMember(json, start, path[level], out next, out nextEnd))
                    throw new InvalidOperationException("no member " + path[level]);
                start = next;
                end = nextEnd;
            }
        }

        public static string Slice(string json, params string[] path)
        {
            int start, end;
            Span(json, out start, out end, path);
            return json.Substring(start, end - start);
        }

        public static string Replace(string text, int start, int end, string with)
        {
            return text.Substring(0, start) + with + text.Substring(end);
        }

        /// <summary>Replaces the whole value found at <paramref name="path"/>.</summary>
        public static string SetValue(string json, string with, params string[] path)
        {
            int start, end;
            Span(json, out start, out end, path);
            return Replace(json, start, end, with);
        }

        public static string RemoveMember(string json, params string[] path)
        {
            int start, end;
            Span(json, out start, out end, path);
            // Member key token ends at start - 1 ('"' then ':'); walk back to its opening quote.
            var keyEnd = start - 1; // ':'
            var keyStart = keyEnd - 1; // closing quote
            keyStart--;
            while (json[keyStart] != '"') keyStart--;
            var removeStart = keyStart;
            var removeEnd = end;
            if (removeEnd < json.Length && json[removeEnd] == ',') removeEnd++;
            else if (json[removeStart - 1] == ',') removeStart--;
            return Replace(json, removeStart, removeEnd, string.Empty);
        }

        /// <summary>Index of the nth (0-based) occurrence of <paramref name="needle"/> inside [start, end), or -1.</summary>
        public static int NthIndexOf(string text, string needle, int nth, int start, int end)
        {
            var index = start;
            for (var seen = 0; ; seen++)
            {
                index = text.IndexOf(needle, index, StringComparison.Ordinal);
                if (index < 0 || index + needle.Length > end) return -1;
                if (seen == nth) return index;
                index += needle.Length;
            }
        }

        /// <summary>Offsets of the structural characters of the envelope object itself (its braces, colons and commas), not of anything inside a value.</summary>
        public static List<int> EnvelopeStructure(string body)
        {
            var offsets = new List<int> { 0 };
            var index = 1;
            while (index < body.Length && body[index] != '}')
            {
                var keyEnd = EndOfString(body, index);
                offsets.Add(keyEnd); // the colon
                var valueEnd = EndOfValue(body, keyEnd + 1);
                index = valueEnd;
                if (body[index] == ',')
                {
                    offsets.Add(index);
                    index++;
                }
            }

            offsets.Add(index); // the closing brace
            return offsets;
        }

        /// <summary>The member names of a JSON object text's top level (raw, no escapes expected).</summary>
        public static List<string> MemberNames(string json)
        {
            var names = new List<string>();
            var index = 1;
            while (index < json.Length && json[index] != '}')
            {
                var keyEnd = EndOfString(json, index);
                names.Add(json.Substring(index + 1, keyEnd - index - 2));
                index = EndOfValue(json, keyEnd + 1);
                if (json[index] == ',') index++;
            }

            return names;
        }

        // ---- replay identity (framing: {"record":R,"result":S,"simVersion":3}) ----

        public static string ReplayDigest(string recordRaw, string resultRaw)
        {
            return Sha256Hex("{\"record\":" + recordRaw + ",\"result\":" + resultRaw + ",\"simVersion\":3}");
        }

        /// <summary>
        /// Recomputes the claimed replayDigest of the resolution found at <paramref name="resolutionPath"/>
        /// (empty path: the envelope's payload itself; "resolution": a replay or demonstration).
        /// </summary>
        public static string ResealResolution(string body, string[] resolutionPath)
        {
            var path = new List<string> { "payload" };
            path.AddRange(resolutionPath);
            var resolution = Slice(body, path.ToArray());
            var record = Slice(resolution, "record");
            var result = Slice(resolution, "result");
            var digestPath = new List<string>(path) { "replayDigest" };
            return SetValue(body, Q(ReplayDigest(record, result)), digestPath.ToArray());
        }

        // ---- deterministic pseudo-random (xorshift; independent of System.Random) ----

        public sealed class Rng
        {
            private ulong state;
            public Rng(ulong seed) { state = seed == 0 ? 0x9E3779B97F4A7C15UL : seed; }
            public ulong Next()
            {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                return state;
            }
            public int Below(int bound) { return (int)(Next() % (ulong)bound); }
        }
    }
}
