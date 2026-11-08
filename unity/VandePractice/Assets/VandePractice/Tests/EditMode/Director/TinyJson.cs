using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// A minimal JSON reader for the Director's fixtures (golden.json, params.json, the parity corpus): objects become
    /// Dictionary&lt;string, object&gt;, arrays List&lt;object&gt;, numbers double, strings string, true/false bool, null null.
    /// Numbers are parsed with the invariant culture, so a double printed by JavaScript's JSON.stringify (the shortest text that
    /// round-trips) comes back as the same double. Test code only.
    /// </summary>
    internal static class TinyJson
    {
        public static object Parse(string text)
        {
            int i = 0;
            object v = Value(text, ref i);
            Skip(text, ref i);
            if (i != text.Length) throw new FormatException("trailing characters at " + i);
            return v;
        }

        private static void Skip(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
        }

        private static object Value(string s, ref int i)
        {
            Skip(s, ref i);
            if (i >= s.Length) throw new FormatException("unexpected end");
            char c = s[i];
            if (c == '{')
            {
                var o = new Dictionary<string, object>();
                i++;
                Skip(s, ref i);
                if (s[i] == '}') { i++; return o; }
                for (; ; )
                {
                    Skip(s, ref i);
                    string key = Str(s, ref i);
                    Skip(s, ref i);
                    if (s[i++] != ':') throw new FormatException("expected : at " + (i - 1));
                    o[key] = Value(s, ref i);
                    Skip(s, ref i);
                    char d = s[i++];
                    if (d == '}') return o;
                    if (d != ',') throw new FormatException("expected , or } at " + (i - 1));
                }
            }
            if (c == '[')
            {
                var a = new List<object>();
                i++;
                Skip(s, ref i);
                if (s[i] == ']') { i++; return a; }
                for (; ; )
                {
                    a.Add(Value(s, ref i));
                    Skip(s, ref i);
                    char d = s[i++];
                    if (d == ']') return a;
                    if (d != ',') throw new FormatException("expected , or ] at " + (i - 1));
                }
            }
            if (c == '"') return Str(s, ref i);
            if (string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int start = i;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++;
            if (i == start) throw new FormatException("unexpected character '" + c + "' at " + i);
            return double.Parse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        private static string Str(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("expected string at " + i);
            i++;
            var sb = new StringBuilder();
            while (s[i] != '"')
            {
                char c = s[i++];
                if (c != '\\') { sb.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u': sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                    default: throw new FormatException("bad escape \\" + e);
                }
            }
            i++;
            return sb.ToString();
        }

        public static Dictionary<string, object> Obj(object o)
        {
            return (Dictionary<string, object>)o;
        }

        public static List<object> Arr(object o)
        {
            return (List<object>)o;
        }

        public static double Num(object o)
        {
            return (double)o;
        }

        public static double? NumOrNull(object o)
        {
            return o == null ? (double?)null : (double)o;
        }

        public static string StrOrNull(object o)
        {
            return o == null ? null : (string)o;
        }

        public static double[] Doubles(object o)
        {
            List<object> l = Arr(o);
            var r = new double[l.Count];
            for (int k = 0; k < r.Length; k++) r[k] = (double)l[k];
            return r;
        }
    }
}
