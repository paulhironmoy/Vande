using System;
using System.Collections.Generic;
using System.Text;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// Inputs for the StrictJsonObject-level recording: value tokens and document shapes that probe the grammar, the
    /// canonical-form rules, every accessor and its failure messages, in both the plain and the canonical mode.
    /// </summary>
    public static class BridgeEquivalenceJsonCorpus
    {
        public static List<KeyValuePair<string, string>> Build()
        {
            var cases = new List<KeyValuePair<string, string>>();
            Action<string, string> add = (id, json) => cases.Add(new KeyValuePair<string, string>(id, json));

            // A member value in every position a validator reads: strings, numbers, literals, arrays, objects.
            var values = new List<string>();
            foreach (var token in BridgeEquivalenceCorpus.NumberTokens()) values.Add(token);
            values.AddRange(new[]
            {
                "\"\"", "\"x\"", "\"a b\"", "\"\\u0041\"", "\"\\u0041\\u0042\"", "\"\\ud83d\\ude00\"", "\"\\ud800\"", "\"\\udc00x\"", "\"\u00e9\"", "\"\u65e5\u672c\"",
                "\"\ud83d\ude00\"", "\"\ud800\"", "\"a\\/b\"", "\"a\\\\b\"", "\"a\\\"b\"", "\"\\b\\f\\n\\r\\t\"", "\"\\u0000\"", "\"\\u0001\"", "\"\\u001f\"", "\"\\u001F\"",
                "\"\\u0008\"", "\"\\u0009\"", "\"\\u000a\"", "\"\\u000c\"", "\"\\u000d\"", "\"\\u0020\"", "\"\\u007f\"", "\"\u007f\"", "\"\\u2028\"", "\"\u2028\"", "\"\\x\"", "\"\\u12\"",
                "\"\\u12G4\"", "\"\\u+123\"", "\"\\", "\"unterminated", "\"line\nbreak\"", "\"tab\there\"", "\"nul\0here\"", "\"\u001f\"", "\"\\U0041\"", "\"\\'\"", "\"\\0\"",
                "'single'", "unquoted", "\"" + new string('s', 4000) + "\"", "\"" + new string('\u00e9', 1500) + "\"", "\"" + BridgeEquivalenceCorpus.Repeat("\\u0041", 300) + "\"",
                "true", "false", "null", "True", "NULL", "nul", "tru", "falsee", "nulll", "truefalse", "undefined", "NaN",
                "[]", "[ ]", "[1]", "[1,2,3]", "[1,2,3,4]", "[ 1 , 2 ]", "[1.0]", "[1e400]", "[\"1\"]", "[null]", "[true]", "[-0]", "[1,]", "[,1]", "[1 2]", "[1,,2]",
                "[0.1,0.2,0.30000000000000004]", "[12345678901234567890]", "[1e-400,1e400]", "[1,2,3,4,5,6,7,8,9,10]", "[[1],[2]]", "[1,[2]]", "[1]x",
                "[{}]", "[{},{}]", "[{\"x\":1}]", "[{\"x\":1},{\"x\":2}]", "[{\"x\":1},{\"x\":2},{\"x\":3}]", "[{\"x\":1},{\"x\":2},{\"x\":3},{\"x\":4}]",
                "[{\"x\":1},{\"y\":2},{\"x\":3}]", "[ {\"x\":1}]", "[{\"x\":1} ]", "[{\"x\":1} ,{\"x\":2}]", "[{\"x\":1}, {\"x\":2}]", "[{\"x\": 1}]", "[{\"x\":1},2]",
                "[{\"x\":1},null]", "[[]]", "[{\"b\":1,\"a\":2}]", "[{\"a\":1,\"a\":2}]", "[{\"a\":\"\u00e9\"}]", "[{\"a\":\"\\u0041\"}]", "[{\"a\":1.0}]", "[{\"a\":01}]",
                "[{\"a\":1},]", "[{\"a\":{\"b\":[1,{\"c\":null}]}}]", "[{\"t\":0.1,\"p\":{\"x\":1}}]", "[{\"p\":{\"x\":0.1,\"y\":0.2,\"z\":0.3},\"t\":0.016,\"v\":{\"x\":1,\"y\":2,\"z\":3}}]",
                "{}", "{ }", "{\"x\":1}", "{\"x\":1,\"y\":2}", "{\"y\":1,\"x\":2}", "{\"x\":1,\"x\":2}", "{ \"x\" : 1 }", "{\"x\":{\"y\":{\"z\":1}}}", "{\"x\":null}",
                "{\"x\":[1,2]}", "{\"x\":\"s\"}", "{\"x\":1,}", "{,}", "{\"x\"}", "{\"x\":}", "{x:1}", "{\"x\":1 \"y\":2}", "{\"x\":1}x", "{\"\":1}",
                "-", "--", "+", "~", "\u00e9", "\u0000"
            });
            var index = 0;
            foreach (var value in values)
            {
                var id = (index++).ToString("D3") + "/" + BridgeEquivalenceCorpus.Printable(value.Length > 30 ? value.Substring(0, 30) + "~" + value.Length : value);
                add("v/" + id, "{\"a\":" + value + "}");
                add("w/" + id, "{\"a\":" + value + ",\"b\":1}");
            }

            // Document shapes.
            foreach (var shape in new[]
            {
                "", " ", "{", "}", "{}", " {}", "{} ", "\n{}\n", "\t{}", "{}x", "{}{}", "[]", "1", "\"x\"", "null", "true", "\u00ef\u00bb\u00bf{}", "\ufeff{}",
                "{\"a\":1}", " {\"a\":1}", "{\"a\":1} ", "{ \"a\" : 1 }", "{\n\"a\":1\n}", "{\"a\":1,\"b\":2}", "{\"a\":1 ,\"b\":2}", "{\"a\":1, \"b\":2}", "{\"a\": 1,\"b\":2}", "{\"a\" :1}",
                "{\"b\":1,\"a\":2}", "{\"a\":1,\"a\":2}", "{\"a\":1,\"b\":2,\"a\":3}", "{\"a\":1,\"b\":2,\"b\":3}", "{\"a\":{\"b\":1,\"b\":2}}", "{\"a\":{\"b\":2,\"a\":1}}",
                "{\"a\":[{\"b\":2,\"a\":1}]}", "{\"a\":[{\"b\":1,\"b\":2}]}", "{\"\\u0061\":1}", "{\"a\":1,\"\\u0061\":2}", "{\"\\u0062\":1,\"a\":2}", "{\"\":1}", "{\"\":1,\"\":2}", "{\"a\\\"b\":1}",
                "{\"a\\\\b\":1}", "{\"\u00e9\":1}", "{\"\u00e9\":1,\"z\":2}", "{\"z\":1,\"\u00e9\":2}", "{\"ab\":1,\"a\":2}", "{\"a\":1,\"ab\":2}", "{\"A\":1,\"a\":2}", "{\"a\":1,\"A\":2}",
                "{\"a\":1,\"B\":2}", "{\"B\":1,\"a\":2}", "{\"a\\u0000\":1}", "{\"a\\u001f\":1}", "{\"a\\u001F\":1}", "{\"a\\/\":1}", "{\"\\ud83d\\ude00\":1}", "{\"\ud83d\ude00\":1}",
                "{\"a\":1,\"b\":{\"c\":[1,2,{\"d\":null}],\"e\":\"f\"},\"g\":true}", "{\"a\":[1,2,3],\"b\":[{\"c\":1},{\"c\":2}],\"c\":[]}",
                "{\"count\":3,\"items\":[{\"k\":1},{\"k\":2},{\"k\":3}],\"name\":\"n\",\"ok\":true,\"pi\":3.141592653589793,\"zero\":0}",
                "{\"b\":[],\"a\":[{\"z\":1}]}", "{\"a\":[1,2,3],\"b\":\"x\",\"c\":{\"d\":1}}",
            })
            {
                add("shape/" + BridgeEquivalenceCorpus.Printable(shape.Length > 40 ? shape.Substring(0, 40) + "~" + shape.Length : shape), shape);
            }

            // Nesting depth around the limit of 64 levels, arrays and objects, as a member and as the root's descendant.
            foreach (var depth in new[] { 1, 31, 32, 60, 62, 63, 64, 65, 66, 67, 100, 500 })
            {
                add("depth/array-member-" + depth, "{\"a\":" + new string('[', depth) + new string(']', depth) + "}");
                add("depth/array-1-" + depth, "{\"a\":" + new string('[', depth) + "1" + new string(']', depth) + "}");
                add("depth/object-member-" + depth, "{\"a\":" + BridgeEquivalenceCorpus.Repeat("{\"a\":", depth) + "1" + new string('}', depth) + "}");
                add("depth/mixed-" + depth, "{\"a\":" + BridgeEquivalenceCorpus.Repeat("[{\"a\":", depth / 2 + 1) + "1" + BridgeEquivalenceCorpus.Repeat("}]", depth / 2 + 1) + "}");
                add("depth/array-of-objects-" + depth, "{\"a\":[" + BridgeEquivalenceCorpus.Repeat("{\"a\":", depth) + "1" + new string('}', depth) + "]}");
            }

            // Many members: the 100,000 property ceiling, in the root object and counting nested ones.
            foreach (var count in new[] { 50, 99999, 100000, 100001 })
                add("many/root-" + count, "{" + BridgeEquivalenceCorpus.ManyKeys(count) + "}");
            add("many/nested-split", "{\"a\":{" + BridgeEquivalenceCorpus.ManyKeys(60000) + "},\"b\":{" + BridgeEquivalenceCorpus.ManyKeys(60000) + "}}");
            add("many/array-of-objects", "{\"a\":[" + BridgeEquivalenceCorpus.Repeat("{\"k\":1},", 5000) + "{\"k\":1}]}");
            add("many/array-over-limit", "{\"a\":[" + BridgeEquivalenceCorpus.Repeat("{\"k\":1},", 40000) + "{\"k\":1}]}");
            add("many/numbers", "{\"a\":[" + BridgeEquivalenceCorpus.Repeat("0.5,", 2000) + "1]}");
            add("many/long-string", "{\"a\":\"" + new string('z', 200000) + "\"}");
            add("many/long-key", "{\"" + new string('k', 70000) + "\":1}");
            return cases;
        }
    }
}
