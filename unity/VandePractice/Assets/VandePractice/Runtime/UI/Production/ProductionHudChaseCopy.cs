using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Vande.Practice.Presentation;

namespace Vande.Practice.UI.Production
{
    /// <summary>
    /// The Target Chase wording of the Unity HUD (bridge contract v7). The words are the web COPY sheet's: the patterns come from
    /// ProductionHudChaseCopy.Generated.cs, which is generated from src/i18n/practice/{en,hi,hi-Latn}/chase.ts, and a parity
    /// fixture (tests/fixtures/unity-practice/chase-copy.json, printed by the web's own formatter) pins every string Unity prints.
    /// No wording crosses the bridge: Unity composes these lines from the validated integers of the chase block.
    ///
    /// The evaluator is the strict subset of the web's ICU-lite that the chase sheet uses: {name}, and
    /// {name, plural, =N {..} one {..} other {..}} with #. The generator refuses any other construct. Plural rules: English and
    /// Hinglish (the web formats Hinglish as en-IN) have "one" for exactly 1; Hindi has "one" for 0 and 1.
    /// </summary>
    internal static class ProductionHudChaseCopy
    {
        private const int English = 0;
        private const int Hindi = 1;
        private const int Hinglish = 2;

        // Counts a chase can print stay below 1000 (a target is at most 360, a chase at most 60 balls), so no digit grouping applies.
        private const long LargestPrintable = 999;

        private static readonly Dictionary<string, Node[]> Parsed = new Dictionary<string, Node[]>(StringComparer.Ordinal);

        public static int LanguageOf(string locale)
        {
            if (string.IsNullOrWhiteSpace(locale)) return English;
            if (locale.StartsWith("hi-Latn", StringComparison.OrdinalIgnoreCase)) return Hinglish;
            if (locale.StartsWith("hi", StringComparison.OrdinalIgnoreCase)) return Hindi;
            return English;
        }

        /// <summary>The word for the mode ("Chase"), used where Practice shows "Practice".</summary>
        public static string Status(string locale)
        {
            return Text(ProductionHudChaseCopyData.Status, locale);
        }

        /// <summary>"Need 14 off 9 balls".</summary>
        public static string Need(int runsNeeded, int ballsLeft, string locale)
        {
            return Text(ProductionHudChaseCopyData.Need, locale, "runs", runsNeeded, "balls", ballsLeft);
        }

        /// <summary>"9.3 an over": the required rate, one decimal, half up on the hundredths.</summary>
        public static string Rate(int rateX100, string locale)
        {
            return Text(ProductionHudChaseCopyData.Rate, locale, "rate", RateDigits(rateX100));
        }

        /// <summary>One decimal from the integer hundredths, half up: the digits the web prints for the same rate.</summary>
        internal static string RateDigits(int rateX100)
        {
            if (rateX100 < 0) throw new ArgumentOutOfRangeException(nameof(rateX100));
            var tenths = (rateX100 + 5) / 10;
            return (tenths / 10).ToString(CultureInfo.InvariantCulture) + "." + (tenths % 10).ToString(CultureInfo.InvariantCulture);
        }

        public static string WonTitle(string locale)
        {
            return Text(ProductionHudChaseCopyData.WonTitle, locale);
        }

        /// <summary>"2 balls to spare." or "Won on the last ball." (none left).</summary>
        public static string WonSpare(int ballsLeft, string locale)
        {
            return Text(ProductionHudChaseCopyData.WonSpare, locale, "left", ballsLeft);
        }

        /// <summary>"6 runs short".</summary>
        public static string LostTitle(int runsShort, string locale)
        {
            return Text(ProductionHudChaseCopyData.LostTitle, locale, "short", runsShort);
        }

        /// <summary>The first line of the HUD rail: what is needed while the chase runs, the verdict once it is decided.</summary>
        public static string Headline(PracticeChasePresentation chase, string locale)
        {
            if (chase == null) throw new ArgumentNullException(nameof(chase));
            switch (chase.Outcome)
            {
                case PracticeChaseOutcome.InProgress: return Need(chase.RunsNeeded, chase.BallsLeft, locale);
                case PracticeChaseOutcome.Won: return WonTitle(locale);
                default: return LostTitle(chase.RunsNeeded, locale);
            }
        }

        /// <summary>The second line of the rail: the rate while it runs, the balls to spare after a win, nothing after a loss.</summary>
        public static string Detail(PracticeChasePresentation chase, string locale)
        {
            if (chase == null) throw new ArgumentNullException(nameof(chase));
            switch (chase.Outcome)
            {
                case PracticeChaseOutcome.InProgress: return Rate(chase.RequiredRateX100 ?? 0, locale);
                case PracticeChaseOutcome.Won: return WonSpare(chase.BallsLeft, locale);
                default: return string.Empty;
            }
        }

        private static string Text(int key, string locale, params object[] nameValuePairs)
        {
            var language = LanguageOf(locale);
            var args = new Dictionary<string, object>(StringComparer.Ordinal);
            for (var index = 0; index + 1 < nameValuePairs.Length; index += 2) args[(string)nameValuePairs[index]] = nameValuePairs[index + 1];
            return Format(ProductionHudChaseCopyData.Patterns[language][key], language, args);
        }

        // ---- the ICU-lite subset ------------------------------------------------------------------------------------------

        private enum Kind
        {
            Text,
            Argument,
            Plural,
            Hash
        }

        private sealed class Node
        {
            public Kind Kind;
            public string Text;
            public string Name;
            public Dictionary<string, Node[]> Options;
        }

        internal static string Format(string pattern, int language, Dictionary<string, object> args)
        {
            Node[] nodes;
            lock (Parsed)
            {
                if (!Parsed.TryGetValue(pattern, out nodes))
                {
                    nodes = new Parser(pattern).ParseSequence(false, false);
                    Parsed[pattern] = nodes;
                }
            }

            var builder = new StringBuilder(pattern.Length + 8);
            Render(nodes, language, args, null, builder);
            return builder.ToString();
        }

        private static bool IsOne(int language, long value)
        {
            return language == Hindi ? value == 0 || value == 1 : value == 1;
        }

        private static string Digits(long value)
        {
            if (value < 0 || value > LargestPrintable) throw new ArgumentOutOfRangeException(nameof(value), "A chase count is 0..999.");
            return value.ToString(CultureInfo.InvariantCulture);
        }

        private static void Render(Node[] nodes, int language, Dictionary<string, object> args, long? hash, StringBuilder builder)
        {
            foreach (var node in nodes)
            {
                switch (node.Kind)
                {
                    case Kind.Text:
                        builder.Append(node.Text);
                        break;
                    case Kind.Hash:
                        builder.Append(hash.HasValue ? Digits(hash.Value) : "#");
                        break;
                    case Kind.Argument:
                    {
                        object value;
                        if (!args.TryGetValue(node.Name, out value) || value == null)
                            builder.Append('{').Append(node.Name).Append('}');
                        else if (value is int || value is long)
                            builder.Append(Digits(Convert.ToInt64(value, CultureInfo.InvariantCulture)));
                        else
                            builder.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                        break;
                    }
                    case Kind.Plural:
                    {
                        object raw;
                        args.TryGetValue(node.Name, out raw);
                        var count = raw == null ? 0L : Convert.ToInt64(raw, CultureInfo.InvariantCulture);
                        Node[] branch;
                        if (!node.Options.TryGetValue("=" + count.ToString(CultureInfo.InvariantCulture), out branch) &&
                            !node.Options.TryGetValue(IsOne(language, count) ? "one" : "other", out branch))
                            branch = node.Options["other"];
                        Render(branch, language, args, count, builder);
                        break;
                    }
                }
            }
        }

        private sealed class Parser
        {
            private readonly string source;
            private int index;

            public Parser(string source)
            {
                this.source = source;
            }

            public Node[] ParseSequence(bool inPlural, bool untilBrace)
            {
                var nodes = new List<Node>();
                var text = new StringBuilder();
                while (index < source.Length)
                {
                    var current = source[index];
                    if (current == '}' && untilBrace) break;
                    if (current == '{')
                    {
                        Flush(nodes, text);
                        nodes.Add(ParseArgument());
                        continue;
                    }

                    if (current == '#' && inPlural)
                    {
                        Flush(nodes, text);
                        nodes.Add(new Node { Kind = Kind.Hash });
                        index++;
                        continue;
                    }

                    text.Append(current);
                    index++;
                }

                Flush(nodes, text);
                return nodes.ToArray();
            }

            private static void Flush(List<Node> nodes, StringBuilder text)
            {
                if (text.Length == 0) return;
                nodes.Add(new Node { Kind = Kind.Text, Text = text.ToString() });
                text.Length = 0;
            }

            private void SkipWhitespace()
            {
                while (index < source.Length && char.IsWhiteSpace(source[index])) index++;
            }

            private string Identifier()
            {
                SkipWhitespace();
                var start = index;
                while (index < source.Length)
                {
                    var c = source[index];
                    if (char.IsWhiteSpace(c) || c == ',' || c == '{' || c == '}') break;
                    index++;
                }

                return source.Substring(start, index - start);
            }

            private void Expect(char expected)
            {
                SkipWhitespace();
                if (index >= source.Length || source[index] != expected)
                    throw new FormatException("ICU-lite: expected '" + expected + "' at " + index + " in \"" + source + "\"");
                index++;
            }

            private Node ParseArgument()
            {
                Expect('{');
                var name = Identifier();
                SkipWhitespace();
                if (index < source.Length && source[index] == '}')
                {
                    index++;
                    return new Node { Kind = Kind.Argument, Name = name };
                }

                Expect(',');
                var type = Identifier();
                if (type != "plural") throw new FormatException("ICU-lite: only plural is supported, got '" + type + "' in \"" + source + "\"");
                Expect(',');
                var options = new Dictionary<string, Node[]>(StringComparer.Ordinal);
                for (;;)
                {
                    SkipWhitespace();
                    if (index < source.Length && source[index] == '}')
                    {
                        index++;
                        break;
                    }

                    var key = Identifier();
                    if (key.Length == 0) throw new FormatException("ICU-lite: empty plural option in \"" + source + "\"");
                    Expect('{');
                    options[key] = ParseSequence(true, true);
                    Expect('}');
                }

                if (!options.ContainsKey("other")) throw new FormatException("ICU-lite: '" + name + "' needs an 'other' option in \"" + source + "\"");
                return new Node { Kind = Kind.Plural, Name = name, Options = options };
            }
        }
    }
}
