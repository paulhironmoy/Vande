using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Vande.Practice.Bridge
{
    /// <summary>
    /// Small dependency-free JSON object reader used only at the native trust boundary. It validates the complete JSON
    /// grammar before any bridge action occurs, rejects duplicate keys, and answers typed field reads.
    ///
    /// UNITY-6 (decode latency): the text is scanned ONCE into a flat, immutable node table (<see cref="JsonDocument"/>:
    /// kind, token span, member key span, subtree end, child count, exact number values), and every
    /// <see cref="StrictJsonObject"/> is a view of one object node in that table. Reading a nested object or array is an
    /// index step, not a second parse of the substring, and the typed accessors read the table. The grammar, the limits, the
    /// canonical-form rules (including the long-standing quirk that <c>SkipWhitespace</c> only objects to whitespace that
    /// runs to the end of the text), the order in which the checks fire, and every exception message and "At character"
    /// position are those of the previous nested-parse implementation; BridgeEquivalenceTests holds the recording of it.
    /// </summary>
    internal sealed class StrictJsonObject
    {
        private readonly JsonDocument document;
        private readonly int node;

        internal StrictJsonObject(JsonDocument document, int node)
        {
            this.document = document;
            this.node = node;
        }

        public int Count => document.ChildCount[node];

        public static StrictJsonObject Parse(string json)
        {
            if (json == null)
            {
                throw new BridgeValidationException("JSON object is required.");
            }

            return new JsonScanner(json, false).ParseRootObject();
        }

        public static StrictJsonObject ParseCanonical(string json)
        {
            if (json == null)
            {
                throw new BridgeValidationException("JSON object is required.");
            }

            return new JsonScanner(json, true).ParseRootObject();
        }

        public bool Contains(string name)
        {
            return Find(name) >= 0;
        }

        public string Raw(string name)
        {
            var member = Require(name);
            return document.Source.Substring(document.Start[member], document.End[member] - document.Start[member]);
        }

        public string RawObject()
        {
            var count = document.ChildCount[node];
            var ordered = new List<KeyValuePair<string, string>>(count);
            var member = node + 1;
            for (var index = 0; index < count; index++)
            {
                ordered.Add(new KeyValuePair<string, string>(document.KeyText(member),
                    document.Source.Substring(document.Start[member], document.End[member] - document.Start[member])));
                member = document.Subtree[member];
            }

            ordered.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
            var values = new string[ordered.Count * 2];
            for (var index = 0; index < ordered.Count; index++)
            {
                values[index * 2] = ordered[index].Key;
                values[index * 2 + 1] = ordered[index].Value;
            }

            return CanonicalJson.Object(values);
        }

        public string String(string name, bool allowNull = false)
        {
            var member = Require(name);
            var kind = document.Kind[member];
            if (allowNull && kind == JsonDocument.KindNull) return null;
            if (kind != JsonDocument.KindString)
                throw new BridgeValidationException(name + " must be a JSON string.");
            return document.DecodeValue(member);
        }

        public long Integer(string name)
        {
            var member = Require(name);
            long value;
            if (!document.IsNumber(member) || !document.TryParseInteger(member, out value))
            {
                throw new BridgeValidationException(name + " must be an integer.");
            }

            return value;
        }

        public double Number(string name)
        {
            var member = Require(name);
            double value;
            if (!document.TryGetNumber(member, out value))
            {
                throw new BridgeValidationException(name + " must be a finite number.");
            }

            return value;
        }

        public bool Boolean(string name)
        {
            var kind = document.Kind[Require(name)];
            if (kind == JsonDocument.KindTrue) return true;
            if (kind == JsonDocument.KindFalse) return false;
            throw new BridgeValidationException(name + " must be a boolean.");
        }

        public StrictJsonObject Object(string name)
        {
            var member = Require(name);
            if (document.Kind[member] != JsonDocument.KindObject)
            {
                // What the nested parse of a token that is not an object said.
                throw new BridgeValidationException("Expected '{'. At character 0.");
            }

            return document.ViewOf(member);
        }

        /// <summary>The member as an object view, or false when it is missing or not an object (no exception).</summary>
        internal bool TryObject(string name, out StrictJsonObject value)
        {
            var member = document.FindMember(node, name);
            if (member < 0 || document.Kind[member] != JsonDocument.KindObject)
            {
                value = null;
                return false;
            }

            value = document.ViewOf(member);
            return true;
        }

        public bool IsNull(string name)
        {
            return document.Kind[Require(name)] == JsonDocument.KindNull;
        }

        public double[] NumberArray(string name, int maximumItems)
        {
            var member = Require(name);
            if (maximumItems < 1) throw new ArgumentOutOfRangeException(nameof(maximumItems));
            if (document.Kind[member] != JsonDocument.KindArray)
                throw new BridgeValidationException(name + " must be a bounded finite-number array.");
            var count = document.ChildCount[member];
            var values = new List<double>(Math.Min(count, maximumItems + 1));
            var child = member + 1;
            for (var index = 0; index < count; index++)
            {
                double value;
                if (!document.IsNumber(child) || !document.TryGetNumber(child, out value))
                    throw new BridgeValidationException(name + " must be a bounded finite-number array.");
                values.Add(value);
                if (values.Count > maximumItems)
                    throw new BridgeValidationException(name + " must be a bounded finite-number array.");
                child = document.Subtree[child];
            }

            return values.ToArray();
        }

        public StrictJsonObject[] ObjectArray(string name, int maximumItems)
        {
            if (maximumItems < 1) throw new ArgumentOutOfRangeException(nameof(maximumItems));
            var member = Require(name);
            var failure = name + " must be a bounded canonical object array.";
            if (document.Kind[member] != JsonDocument.KindArray) throw new BridgeValidationException(failure);

            if (!document.Canonical)
            {
                // The array is re-read by the strict parser (no whitespace between array tokens, canonical strings, numbers and key
                // order), exactly as before, and its items are views of that second document.
                return document.StrictObjectArray(member, maximumItems, failure);
            }

            // A canonical document was scanned with those same rules inside the items, so only the array's own framing is left.
            if ((document.Flags[member] & JsonDocument.FlagLooseArray) != 0) throw new BridgeValidationException(failure);
            var count = document.ChildCount[member];
            if (count > maximumItems) throw new BridgeValidationException(failure);
            var items = new StrictJsonObject[count];
            var child = member + 1;
            for (var index = 0; index < count; index++)
            {
                if (document.Kind[child] != JsonDocument.KindObject) throw new BridgeValidationException(failure);
                items[index] = document.ViewOf(child);
                child = document.Subtree[child];
            }

            return items;
        }

        /// <summary>The span of a member's raw token, for callers that hash or compare it without a substring.</summary>
        internal void RawSpan(string name, out string source, out int start, out int end)
        {
            var member = Require(name);
            source = document.Source;
            start = document.Start[member];
            end = document.End[member];
        }

        /// <summary>Whether the raw token of a member equals the raw token of a member of another object (ordinal).</summary>
        internal bool RawEquals(string name, StrictJsonObject other, string otherName)
        {
            string a, b;
            int aStart, aEnd, bStart, bEnd;
            RawSpan(name, out a, out aStart, out aEnd);
            other.RawSpan(otherName, out b, out bStart, out bEnd);
            return aEnd - aStart == bEnd - bStart && string.CompareOrdinal(a, aStart, b, bStart, aEnd - aStart) == 0;
        }

        private int Find(string name)
        {
            return document.FindMember(node, name);
        }

        private int Require(string name)
        {
            var member = document.FindMember(node, name);
            if (member < 0) throw new BridgeValidationException("Missing JSON field: " + name + ".");
            return member;
        }
    }

    /// <summary>
    /// The immutable node table of one scanned text. Nodes are in document order; the children of a container are the
    /// nodes that follow it, each followed by its own subtree (<see cref="Subtree"/> is the first index after a node's subtree).
    /// </summary>
    internal sealed class JsonDocument
    {
        internal const byte KindObject = 0;
        internal const byte KindArray = 1;
        internal const byte KindString = 2;
        internal const byte KindNumber = 3;       // grammar-valid, value not read yet (plain mode)
        internal const byte KindTrue = 4;
        internal const byte KindFalse = 5;
        internal const byte KindNull = 6;
        internal const byte KindNumberOk = 7;     // value read, finite
        internal const byte KindNumberBad = 8;    // not representable as a finite number

        internal const byte FlagValueEscapes = 1; // a string value whose token contains an escape
        internal const byte FlagKeyEscapes = 2;   // a member whose key token contains an escape
        internal const byte FlagLooseArray = 4;   // an array whose own framing contains whitespace (not a strict object array)

        internal readonly string Source;
        internal readonly bool Canonical;
        internal readonly byte[] Kind;
        internal readonly byte[] Flags;
        internal readonly int[] Start;
        internal readonly int[] End;
        internal readonly int[] KeyStart;
        internal readonly int[] KeyEnd;
        internal readonly int[] Subtree;
        internal readonly int[] ChildCount;   // containers: number of children; numbers: index into Numbers
        internal readonly double[] Numbers;
        internal readonly int NodeCount;
        private StrictJsonObject[] views;
        private Dictionary<int, StrictJsonObject[]> strictArrays;

        internal JsonDocument(
            string source, bool canonical, int nodeCount, byte[] kind, byte[] flags, int[] start, int[] end,
            int[] keyStart, int[] keyEnd, int[] subtree, int[] childCount, double[] numbers)
        {
            Source = source;
            Canonical = canonical;
            NodeCount = nodeCount;
            Kind = kind;
            Flags = flags;
            Start = start;
            End = end;
            KeyStart = keyStart;
            KeyEnd = keyEnd;
            Subtree = subtree;
            ChildCount = childCount;
            Numbers = numbers;
        }

        internal StrictJsonObject ViewOf(int node)
        {
            if (views == null) views = new StrictJsonObject[NodeCount];
            var view = views[node];
            if (view == null)
            {
                view = new StrictJsonObject(this, node);
                views[node] = view;
            }

            return view;
        }

        internal int FindMember(int objectNode, string name)
        {
            var count = ChildCount[objectNode];
            var child = objectNode + 1;
            for (var index = 0; index < count; index++)
            {
                if (KeyEquals(child, name)) return child;
                child = Subtree[child];
            }

            return -1;
        }

        private bool KeyEquals(int member, string name)
        {
            var length = KeyEnd[member] - KeyStart[member] - 2;
            if ((Flags[member] & FlagKeyEscapes) == 0)
            {
                return length == name.Length && string.CompareOrdinal(Source, KeyStart[member] + 1, name, 0, length) == 0;
            }

            return string.Equals(KeyText(member), name, StringComparison.Ordinal);
        }

        internal string KeyText(int member)
        {
            return Decode(Source, KeyStart[member], KeyEnd[member], (Flags[member] & FlagKeyEscapes) != 0);
        }

        internal string DecodeValue(int member)
        {
            return Decode(Source, Start[member], End[member], (Flags[member] & FlagValueEscapes) != 0);
        }

        /// <summary>The characters of a string token [start, end) (quotes included), escapes resolved. The token was validated by the scan.</summary>
        internal static string Decode(string source, int start, int end, bool hasEscapes)
        {
            if (!hasEscapes) return source.Substring(start + 1, end - start - 2);
            var value = new StringBuilder(end - start);
            for (var index = start + 1; index < end - 1; index++)
            {
                var character = source[index];
                if (character != '\\')
                {
                    value.Append(character);
                    continue;
                }

                var escaped = source[++index];
                switch (escaped)
                {
                    case 'b': value.Append('\b'); break;
                    case 'f': value.Append('\f'); break;
                    case 'n': value.Append('\n'); break;
                    case 'r': value.Append('\r'); break;
                    case 't': value.Append('\t'); break;
                    case 'u':
                    {
                        var code = 0;
                        for (var digit = 0; digit < 4; digit++)
                        {
                            var h = source[++index];
                            code <<= 4;
                            if (h >= '0' && h <= '9') code += h - '0';
                            else if (h >= 'a' && h <= 'f') code += h - 'a' + 10;
                            else code += h - 'A' + 10;
                        }

                        value.Append((char)code);
                        break;
                    }
                    default: value.Append(escaped); break; // '"', '\\' and '/'
                }
            }

            return value.ToString();
        }

        internal bool IsNumber(int member)
        {
            var kind = Kind[member];
            return kind == KindNumber || kind == KindNumberOk || kind == KindNumberBad;
        }

        /// <summary>The finite value of a number node (read on first use in plain mode); false for any other kind or a number that is not finite.</summary>
        internal bool TryGetNumber(int member, out double value)
        {
            switch (Kind[member])
            {
                case KindNumberOk:
                    value = Numbers[ChildCount[member]];
                    return true;
                case KindNumber:
                    if (ExactDecimal.TryParse(Source, Start[member], End[member], out value))
                    {
                        Numbers[ChildCount[member]] = value;
                        Kind[member] = KindNumberOk;
                        return true;
                    }

                    Kind[member] = KindNumberBad;
                    return false;
                default:
                    value = 0.0;
                    return false;
            }
        }

        /// <summary>long.TryParse(token, AllowLeadingSign, InvariantCulture) for a grammar-valid number token.</summary>
        internal bool TryParseInteger(int member, out long value)
        {
            value = 0;
            var index = Start[member];
            var end = End[member];
            var negative = false;
            if (index < end && Source[index] == '-') { negative = true; index++; }
            if (index >= end) return false;
            ulong magnitude = 0;
            for (; index < end; index++)
            {
                var digit = Source[index] - '0';
                if (digit < 0 || digit > 9) return false;
                if (magnitude > (ulong.MaxValue - (ulong)digit) / 10UL) return false;
                magnitude = magnitude * 10UL + (ulong)digit;
            }

            if (negative)
            {
                if (magnitude > 9223372036854775808UL) return false;
                value = magnitude == 9223372036854775808UL ? long.MinValue : -(long)magnitude;
                return true;
            }

            if (magnitude > (ulong)long.MaxValue) return false;
            value = (long)magnitude;
            return true;
        }

        /// <summary>
        /// The items of an array of objects as the strict parser reads them: an array token with no whitespace of its own,
        /// canonical item contents. Used when this document was scanned in plain mode, so those rules were not yet applied.
        /// </summary>
        internal StrictJsonObject[] StrictObjectArray(int arrayNode, int maximumItems, string failure)
        {
            StrictJsonObject[] cached;
            if (strictArrays != null && strictArrays.TryGetValue(arrayNode, out cached))
            {
                if (cached.Length > maximumItems) throw new BridgeValidationException(failure);
                return (StrictJsonObject[])cached.Clone();
            }

            StrictJsonObject[] items;
            try
            {
                items = new JsonScanner(Source.Substring(Start[arrayNode], End[arrayNode] - Start[arrayNode]), true).ParseObjectArray(maximumItems);
            }
            catch (BridgeValidationException)
            {
                throw new BridgeValidationException(failure);
            }

            if (strictArrays == null) strictArrays = new Dictionary<int, StrictJsonObject[]>();
            strictArrays[arrayNode] = items;
            return (StrictJsonObject[])items.Clone();
        }
    }

    /// <summary>Builds a <see cref="JsonDocument"/>: the former recursive-descent parser, check for check, recording the nodes as it goes.</summary>
    internal sealed class JsonScanner
    {
        private const int MaxDepth = 64;
        private const int MaxProperties = 100_000;
        private const int ManyKeys = 16;

        private readonly string source;
        private readonly bool canonical;
        private int position;
        private int propertyCount;

        private byte[] kind;
        private byte[] flags;
        private int[] start;
        private int[] end;
        private int[] keyStart;
        private int[] keyEnd;
        private int[] subtree;
        private int[] childCount;
        private double[] numbers;
        private int nodeCount;
        private int numberCount;

        // The member keys of the objects being read (start, end, flags), innermost object last: duplicate detection in plain mode.
        private int[] frame = new int[48];
        private int frameLength;

        public JsonScanner(string source, bool canonical)
        {
            this.source = source;
            this.canonical = canonical;
            var capacity = Math.Max(16, source.Length / 12 + 8);
            kind = new byte[capacity];
            flags = new byte[capacity];
            start = new int[capacity];
            end = new int[capacity];
            keyStart = new int[capacity];
            keyEnd = new int[capacity];
            subtree = new int[capacity];
            childCount = new int[capacity];
            numbers = new double[Math.Max(8, capacity / 2)];
        }

        public StrictJsonObject ParseRootObject()
        {
            SkipWhitespace();
            ReadObject(0, -1, -1, 0);
            SkipWhitespace();
            if (position != source.Length)
            {
                throw Error("Unexpected data after JSON object.");
            }

            return Finish().ViewOf(0);
        }

        /// <summary>The strict reader of an array of objects (UnityPracticeBridge's canonical item arrays): [ { }, { } ] with no framing whitespace.</summary>
        public StrictJsonObject[] ParseObjectArray(int maximumItems)
        {
            var array = NewNode(JsonDocument.KindArray, position, -1, -1, 0);
            Expect('[');
            var items = 0;
            if (!Take(']'))
            {
                while (true)
                {
                    ReadObject(1, -1, -1, 0);
                    items++;
                    if (items > maximumItems)
                        throw Error("Array exceeds its item limit.");
                    if (Take(']')) break;
                    Expect(',');
                }
            }

            if (position != source.Length)
                throw Error("Unexpected data after object array.");
            FinishContainer(array, items);
            var document = Finish();
            var result = new StrictJsonObject[items];
            var child = 1;
            for (var index = 0; index < items; index++)
            {
                result[index] = document.ViewOf(child);
                child = document.Subtree[child];
            }

            return result;
        }

        private JsonDocument Finish()
        {
            return new JsonDocument(source, canonical, nodeCount, kind, flags, start, end, keyStart, keyEnd, subtree, childCount, numbers);
        }

        // ---------------------------------------------------------------- node table

        private int NewNode(byte nodeKind, int tokenStart, int memberKeyStart, int memberKeyEnd, byte memberFlags)
        {
            if (nodeCount == kind.Length) Grow();
            var node = nodeCount++;
            kind[node] = nodeKind;
            flags[node] = memberFlags;
            start[node] = tokenStart;
            keyStart[node] = memberKeyStart;
            keyEnd[node] = memberKeyEnd;
            childCount[node] = 0;
            return node;
        }

        private void Grow()
        {
            var capacity = kind.Length * 2;
            Array.Resize(ref kind, capacity);
            Array.Resize(ref flags, capacity);
            Array.Resize(ref start, capacity);
            Array.Resize(ref end, capacity);
            Array.Resize(ref keyStart, capacity);
            Array.Resize(ref keyEnd, capacity);
            Array.Resize(ref subtree, capacity);
            Array.Resize(ref childCount, capacity);
        }

        private void FinishLeaf(int node)
        {
            end[node] = position;
            subtree[node] = nodeCount;
        }

        private void FinishContainer(int node, int children)
        {
            end[node] = position;
            subtree[node] = nodeCount;
            childCount[node] = children;
        }

        // ---------------------------------------------------------------- the grammar (the former Parser, check for check)

        private int ReadObject(int depth, int memberKeyStart, int memberKeyEnd, byte memberFlags)
        {
            RequireDepth(depth);
            var openAt = position;
            Expect('{');
            var self = NewNode(JsonDocument.KindObject, openAt, memberKeyStart, memberKeyEnd, memberFlags);
            SkipWhitespace();
            if (Take('}'))
            {
                FinishContainer(self, 0);
                return self;
            }

            var children = 0;
            var frameBase = frameLength;
            HashSet<string> seen = null;
            var previousStart = -1;
            var previousEnd = -1;
            byte previousFlags = 0;
            while (true)
            {
                SkipWhitespace();
                var keyAt = position;
                var keyHasEscapes = ScanString();
                var keyTo = position;
                var keyFlags = keyHasEscapes ? JsonDocument.FlagKeyEscapes : (byte)0;
                if (canonical && previousStart >= 0 && CompareKeys(previousStart, previousEnd, previousFlags, keyAt, keyTo, keyFlags) >= 0)
                    throw Error("Canonical JSON object keys are not sorted.");
                if (!canonical) CheckNewKey(frameBase, ref seen, keyAt, keyTo, keyFlags);

                propertyCount++;
                previousStart = keyAt;
                previousEnd = keyTo;
                previousFlags = keyFlags;
                if (propertyCount > MaxProperties)
                {
                    throw Error("JSON object contains too many fields.");
                }

                SkipWhitespace();
                Expect(':');
                SkipWhitespace();
                ReadValue(depth + 1, keyAt, keyTo, keyFlags);
                children++;

                SkipWhitespace();
                if (Take('}')) break;
                Expect(',');
            }

            frameLength = frameBase;
            FinishContainer(self, children);
            return self;
        }

        /// <summary>Plain mode: the key just read must not repeat a key of the same object ("Duplicate JSON field").</summary>
        private void CheckNewKey(int frameBase, ref HashSet<string> seen, int keyAt, int keyTo, byte keyFlags)
        {
            if (seen != null)
            {
                var text = JsonDocument.Decode(source, keyAt, keyTo, (keyFlags & JsonDocument.FlagKeyEscapes) != 0);
                if (!seen.Add(text)) throw Error("Duplicate JSON field: " + text + ".");
                return;
            }

            for (var index = frameBase; index < frameLength; index += 3)
            {
                if (CompareKeys(frame[index], frame[index + 1], (byte)frame[index + 2], keyAt, keyTo, keyFlags) == 0)
                {
                    throw Error("Duplicate JSON field: " +
                                JsonDocument.Decode(source, keyAt, keyTo, (keyFlags & JsonDocument.FlagKeyEscapes) != 0) + ".");
                }
            }

            if ((frameLength - frameBase) / 3 >= ManyKeys)
            {
                // A wide object: from here on use a set (this key is not a duplicate, so it joins the earlier ones).
                seen = new HashSet<string>(StringComparer.Ordinal);
                for (var index = frameBase; index < frameLength; index += 3)
                {
                    seen.Add(JsonDocument.Decode(source, frame[index], frame[index + 1], ((byte)frame[index + 2] & JsonDocument.FlagKeyEscapes) != 0));
                }
                seen.Add(JsonDocument.Decode(source, keyAt, keyTo, (keyFlags & JsonDocument.FlagKeyEscapes) != 0));
                return;
            }

            if (frameLength + 3 > frame.Length) Array.Resize(ref frame, frame.Length * 2);
            frame[frameLength] = keyAt;
            frame[frameLength + 1] = keyTo;
            frame[frameLength + 2] = keyFlags;
            frameLength += 3;
        }

        /// <summary>string.CompareOrdinal of two key tokens' decoded text.</summary>
        private int CompareKeys(int aStart, int aEnd, byte aFlags, int bStart, int bEnd, byte bFlags)
        {
            if (((aFlags | bFlags) & JsonDocument.FlagKeyEscapes) == 0)
            {
                var aLength = aEnd - aStart - 2;
                var bLength = bEnd - bStart - 2;
                var common = aLength < bLength ? aLength : bLength;
                var s = source;
                for (var index = 0; index < common; index++)
                {
                    var difference = s[aStart + 1 + index] - s[bStart + 1 + index];
                    if (difference != 0) return difference;
                }

                return aLength - bLength;
            }

            return string.CompareOrdinal(
                JsonDocument.Decode(source, aStart, aEnd, (aFlags & JsonDocument.FlagKeyEscapes) != 0),
                JsonDocument.Decode(source, bStart, bEnd, (bFlags & JsonDocument.FlagKeyEscapes) != 0));
        }

        private int ReadValue(int depth, int memberKeyStart, int memberKeyEnd, byte memberFlags)
        {
            RequireDepth(depth);
            if (position >= source.Length) throw Error("JSON value is missing.");
            switch (source[position])
            {
                case '"':
                {
                    var at = position;
                    var hasEscapes = ScanString();
                    var node = NewNode(JsonDocument.KindString, at, memberKeyStart, memberKeyEnd,
                        (byte)(memberFlags | (hasEscapes ? JsonDocument.FlagValueEscapes : 0)));
                    FinishLeaf(node);
                    return node;
                }
                case '{': return ReadObject(depth, memberKeyStart, memberKeyEnd, memberFlags);
                case '[': return ReadArray(depth, memberKeyStart, memberKeyEnd, memberFlags);
                case 't': return ReadToken("true", JsonDocument.KindTrue, memberKeyStart, memberKeyEnd, memberFlags);
                case 'f': return ReadToken("false", JsonDocument.KindFalse, memberKeyStart, memberKeyEnd, memberFlags);
                case 'n': return ReadToken("null", JsonDocument.KindNull, memberKeyStart, memberKeyEnd, memberFlags);
                default: return ReadNumber(memberKeyStart, memberKeyEnd, memberFlags);
            }
        }

        private int ReadToken(string token, byte tokenKind, int memberKeyStart, int memberKeyEnd, byte memberFlags)
        {
            var at = position;
            ExpectToken(token);
            var node = NewNode(tokenKind, at, memberKeyStart, memberKeyEnd, memberFlags);
            FinishLeaf(node);
            return node;
        }

        private int ReadArray(int depth, int memberKeyStart, int memberKeyEnd, byte memberFlags)
        {
            RequireDepth(depth);
            var openAt = position;
            Expect('[');
            var self = NewNode(JsonDocument.KindArray, openAt, memberKeyStart, memberKeyEnd, memberFlags);
            var loose = SkipWhitespace();
            var children = 0;
            if (!Take(']'))
            {
                while (true)
                {
                    loose |= SkipWhitespace();
                    ReadValue(depth + 1, -1, -1, 0);
                    children++;
                    loose |= SkipWhitespace();
                    if (Take(']')) break;
                    Expect(',');
                }
            }

            if (loose) flags[self] |= JsonDocument.FlagLooseArray;
            FinishContainer(self, children);
            return self;
        }

        private int ReadNumber(int memberKeyStart, int memberKeyEnd, byte memberFlags)
        {
            var at = position;
            Take('-');
            if (Take('0'))
            {
                if (position < source.Length && IsDigit(source[position]))
                    throw Error("JSON number has a leading zero.");
            }
            else
            {
                RequireDigits();
            }

            if (Take('.')) RequireDigits();
            if (Take('e') || Take('E'))
            {
                if (!Take('+')) Take('-');
                RequireDigits();
            }

            if (position == at || (position == at + 1 && source[at] == '-'))
                throw Error("Invalid JSON value.");

            var node = NewNode(JsonDocument.KindNumber, at, memberKeyStart, memberKeyEnd, memberFlags);
            if (numberCount == numbers.Length) Array.Resize(ref numbers, numbers.Length * 2);
            childCount[node] = numberCount;
            if (canonical)
            {
                double number;
                if (!ExactDecimal.TryParse(source, at, position, out number))
                {
                    throw Error("JSON number is not canonically encoded.");
                }
                if (!HasCanonicalNumberSpelling(at, position, number))
                {
                    throw Error("JSON number '" + source.Substring(at, position - at) + "' is not canonically encoded.");
                }

                numbers[numberCount] = number;
                kind[node] = JsonDocument.KindNumberOk;
            }

            numberCount++;
            FinishLeaf(node);
            return node;
        }

        private bool HasCanonicalNumberSpelling(int tokenStart, int tokenEnd, double number)
        {
            var s = source;
            if (number == 0) return tokenEnd - tokenStart == 1 && s[tokenStart] == '0';
            var exponentAt = -1;
            for (var index = tokenStart; index < tokenEnd; index++)
            {
                var c = s[index];
                if (c == 'E') return false;
                if (c == 'e' && exponentAt < 0) exponentAt = index;
            }

            var magnitude = Math.Abs(number);
            var requiresExponent = magnitude < 0.000001 || magnitude >= 1e21;
            if (requiresExponent != (exponentAt >= 0)) return false;
            var coefficientEnd = exponentAt < 0 ? tokenEnd : exponentAt;
            var hasPoint = false;
            for (var index = tokenStart; index < coefficientEnd; index++)
            {
                if (s[index] == '.') { hasPoint = true; break; }
            }

            if (hasPoint && s[coefficientEnd - 1] == '0') return false;
            if (exponentAt < 0) return true;
            var exponentStart = exponentAt + 1;
            var exponentLength = tokenEnd - exponentStart;
            if (exponentLength < 2 || (s[exponentStart] != '+' && s[exponentStart] != '-')) return false;
            if (exponentLength > 2 && s[exponentStart + 1] == '0') return false;
            var unsignedStart = s[tokenStart] == '-' ? tokenStart + 1 : tokenStart;
            var unsignedLength = coefficientEnd - unsignedStart;
            return unsignedLength == 1 || (unsignedLength > 2 && s[unsignedStart + 1] == '.');
        }

        private void RequireDigits()
        {
            var at = position;
            while (position < source.Length && IsDigit(source[position])) position++;
            if (position == at) throw Error("JSON number requires a digit.");
        }

        /// <summary>
        /// Reads a string token starting at the opening quote and leaves the position after the closing one. In canonical mode
        /// it also requires the token to be the canonical encoding of its characters (CanonicalJson.String): only the escapes
        /// \" \\ \b \f \n \r \t and lowercase \u00xx for the other control characters; everything else literal.
        /// </summary>
        private bool ScanString()
        {
            Expect('"');
            var s = source;
            var length = s.Length;
            var escapes = false;
            var canonicalForm = true;
            while (position < length)
            {
                var character = s[position++];
                if (character == '"')
                {
                    if (canonical && !canonicalForm)
                        throw Error("JSON string is not canonically encoded.");
                    return escapes;
                }

                if (character < 0x20) throw Error("Control character in JSON string.");
                if (character != '\\') continue;

                escapes = true;
                if (position >= length) throw Error("Incomplete JSON escape.");
                var escaped = s[position++];
                switch (escaped)
                {
                    case '"':
                    case '\\':
                    case 'b':
                    case 'f':
                    case 'n':
                    case 'r':
                    case 't':
                        break;
                    case '/':
                        canonicalForm = false;
                        break;
                    case 'u':
                    {
                        if (position + 4 > length) throw Error("Incomplete Unicode escape.");
                        var value = 0;
                        var first = position;
                        for (var index = 0; index < 4; index++)
                        {
                            var digit = s[position++];
                            value <<= 4;
                            if (digit >= '0' && digit <= '9') value += digit - '0';
                            else if (digit >= 'a' && digit <= 'f') value += digit - 'a' + 10;
                            else if (digit >= 'A' && digit <= 'F') value += digit - 'A' + 10;
                            else throw Error("Invalid Unicode escape.");
                        }

                        // Canonical only for the control characters that have no short escape, as \u00 and two lowercase hex digits.
                        var low = s[first + 3];
                        if (!(s[first] == '0' && s[first + 1] == '0' && (s[first + 2] == '0' || s[first + 2] == '1') &&
                              ((low >= '0' && low <= '9') || (low >= 'a' && low <= 'f')) &&
                              value != 8 && value != 9 && value != 10 && value != 12 && value != 13))
                            canonicalForm = false;
                        break;
                    }
                    default: throw Error("Unsupported JSON escape.");
                }
            }

            throw Error("Unterminated JSON string.");
        }

        private void ExpectToken(string token)
        {
            if (position + token.Length > source.Length ||
                string.CompareOrdinal(source, position, token, 0, token.Length) != 0)
            {
                throw Error("Invalid JSON token.");
            }

            position += token.Length;
        }

        /// <summary>
        /// Skips JSON whitespace. In canonical mode whitespace is an error only when it runs to the end of the text: a run that
        /// is followed by another character returns early, as it always did. Returns whether anything was skipped.
        /// </summary>
        private bool SkipWhitespace()
        {
            var from = position;
            var s = source;
            var length = s.Length;
            while (position < length)
            {
                var value = s[position];
                if (value != ' ' && value != '\t' && value != '\n' && value != '\r') return position != from;
                position++;
            }
            if (canonical && position != from)
                throw Error("Canonical JSON cannot contain insignificant whitespace.");
            return position != from;
        }

        private void Expect(char value)
        {
            if (!Take(value)) throw Error("Expected '" + value + "'.");
        }

        private bool Take(char value)
        {
            if (position >= source.Length || source[position] != value) return false;
            position++;
            return true;
        }

        private void RequireDepth(int depth)
        {
            if (depth > MaxDepth) throw Error("JSON nesting is too deep.");
        }

        private BridgeValidationException Error(string message)
        {
            return new BridgeValidationException(message + " At character " + position + ".");
        }

        private static bool IsDigit(char value)
        {
            return value >= '0' && value <= '9';
        }
    }
}
