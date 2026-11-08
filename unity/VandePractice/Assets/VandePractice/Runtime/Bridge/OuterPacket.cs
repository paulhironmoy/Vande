using System;

namespace Vande.Practice.Bridge
{
    /// <summary>
    /// Splits the outer packet {"sha256":"...","body":"..."} (either member order, JSON whitespace allowed) into its two
    /// strings in one pass. It accepts only the plain shape; anything else (another member, an escaped key, a non-string
    /// value, a malformed string, trailing data) returns false and the caller runs the general reader, which produces the
    /// exact original error. So an accepted packet decodes to the same two strings, and a rejected one fails as it always did.
    /// </summary>
    internal static class OuterPacket
    {
        [ThreadStatic] private static char[] scratch;

        public static bool TryParse(string text, out string sha256, out string body)
        {
            sha256 = null;
            body = null;
            var length = text.Length;
            var index = SkipWhitespace(text, 0);
            if (index >= length || text[index] != '{') return false;
            index = SkipWhitespace(text, index + 1);

            string first, second;
            bool firstIsSha;
            if (!ReadMember(text, ref index, out first, out firstIsSha)) return false;
            index = SkipWhitespace(text, index);
            if (index >= length || text[index] != ',') return false;
            index = SkipWhitespace(text, index + 1);
            bool secondIsSha;
            if (!ReadMember(text, ref index, out second, out secondIsSha)) return false;
            if (firstIsSha == secondIsSha) return false;
            index = SkipWhitespace(text, index);
            if (index >= length || text[index] != '}') return false;
            index = SkipWhitespace(text, index + 1);
            if (index != length) return false;

            sha256 = firstIsSha ? first : second;
            body = firstIsSha ? second : first;
            return true;
        }

        private static int SkipWhitespace(string text, int index)
        {
            while (index < text.Length)
            {
                var c = text[index];
                if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
                index++;
            }

            return index;
        }

        private static bool ReadMember(string text, ref int index, out string value, out bool isSha)
        {
            value = null;
            isSha = false;
            if (string.CompareOrdinal(text, index, "\"sha256\"", 0, 8) == 0) { isSha = true; index += 8; }
            else if (string.CompareOrdinal(text, index, "\"body\"", 0, 6) == 0) index += 6;
            else return false;
            index = SkipWhitespace(text, index);
            if (index >= text.Length || text[index] != ':') return false;
            index = SkipWhitespace(text, index + 1);
            return ReadString(text, ref index, out value);
        }

        /// <summary>A JSON string token from the opening quote: false on anything the general reader would reject.</summary>
        private static bool ReadString(string text, ref int index, out string value)
        {
            value = null;
            var length = text.Length;
            if (index >= length || text[index] != '"') return false;
            index++;
            var buffer = scratch;
            if (buffer == null || buffer.Length < length - index)
            {
                buffer = new char[Math.Max(length - index, 256)];
                // Keep the buffer for the next packet unless it is unusually large (more than a MiB of characters).
                scratch = buffer.Length <= 1 << 20 ? buffer : null;
            }

            var count = 0;
            while (index < length)
            {
                var c = text[index++];
                if (c == '"')
                {
                    value = new string(buffer, 0, count);
                    return true;
                }

                if (c < 0x20) return false;
                if (c != '\\')
                {
                    buffer[count++] = c;
                    continue;
                }

                if (index >= length) return false;
                switch (text[index++])
                {
                    case '"': buffer[count++] = '"'; break;
                    case '\\': buffer[count++] = '\\'; break;
                    case '/': buffer[count++] = '/'; break;
                    case 'b': buffer[count++] = '\b'; break;
                    case 'f': buffer[count++] = '\f'; break;
                    case 'n': buffer[count++] = '\n'; break;
                    case 'r': buffer[count++] = '\r'; break;
                    case 't': buffer[count++] = '\t'; break;
                    case 'u':
                    {
                        if (index + 4 > length) return false;
                        var code = 0;
                        for (var digit = 0; digit < 4; digit++)
                        {
                            var h = text[index++];
                            code <<= 4;
                            if (h >= '0' && h <= '9') code += h - '0';
                            else if (h >= 'a' && h <= 'f') code += h - 'a' + 10;
                            else if (h >= 'A' && h <= 'F') code += h - 'A' + 10;
                            else return false;
                        }

                        buffer[count++] = (char)code;
                        break;
                    }
                    default: return false;
                }
            }

            return false;
        }
    }
}
