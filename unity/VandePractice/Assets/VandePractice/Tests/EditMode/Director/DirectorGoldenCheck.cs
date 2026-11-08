using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Vande.Practice.Presentation.Production.Director;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>The outcome of replaying one golden case through the C# port.</summary>
    internal sealed class GoldenCaseResult
    {
        public string Name;
        public readonly List<string> Failures = new List<string>();
        /// <summary>Largest |C# - web| over the picked trace frames, per channel, in Int16 steps.</summary>
        public readonly int[] MaxStepDiff = new int[DirectorChannels.Count];
        public int Frames;
        public int StepValues;
        public int StepValuesEqual;
        /// <summary>Largest |C# - web| over the plan's events, amplitudes and draws.</summary>
        public double MaxEventDiff;
        public int EventValues;
        /// <summary>Event values equal to the web's as float32.</summary>
        public int EventValuesExact;
        public uint TraceHash;
        public uint GoldenHash;

        public int WorstStepDiff
        {
            get
            {
                int m = 0;
                for (int c = 0; c < MaxStepDiff.Length; c++) m = Math.Max(m, MaxStepDiff[c]);
                return m;
            }
        }
    }

    /// <summary>
    /// Replays tests/unit/render3d/director/fixtures/golden.json (contract director/3) through the C# port and compares: keys
    /// exactly, the plan header exactly, events within 1e-3 (a port can differ in the last bit of a double, and a double that
    /// straddles a float32 rounding point moves by one float32 step, which is above 1e-3 only for values over 16,384 ms), trace
    /// samples within 2 Int16 steps. The trace hash is only comparable inside one engine, so it is reported, never asserted.
    /// </summary>
    internal static class DirectorGoldenCheck
    {
        public const int StepTolerance = 2;
        public const double EventTolerance = 1e-3;

        public static List<object> Cases(string goldenJson)
        {
            return TinyJson.Arr(TinyJson.Obj(TinyJson.Parse(goldenJson))["cases"]);
        }

        /// <summary>The anchors of a golden case (the numbers from the fixture) with the test world's callbacks.</summary>
        public static DirectorAnchors AnchorsOf(Dictionary<string, object> c, out TestDelivery delivery)
        {
            Dictionary<string, object> an = TinyJson.Obj(c["anchors"]);
            Dictionary<string, object> opt = TinyJson.Obj(c["options"]);
            Dictionary<string, object> world = TinyJson.Obj(c["world"]);
            DirectorRole role = (string)c["role"] == "bowler" ? DirectorRole.Bowler : DirectorRole.Striker;
            var tw = new TestWorld { Role = role, Lead = (bool)opt["lead"] };
            delivery = null;
            if (!world.ContainsKey("idleMs"))
            {
                var spec = new TestBallSpec
                {
                    SpeedKph = TinyJson.Num(world["speedKph"]),
                    LengthM = TinyJson.Num(world["lengthM"]),
                    LineM = TinyJson.Num(world["lineM"]),
                    Variation = TinyJson.Num(world["variation"]),
                    Outcome = (string)world["outcome"],
                };
                delivery = new TestDelivery(spec, TinyJson.Num(world["release"]));
                tw.Delivery = delivery;
            }
            return new DirectorAnchors
            {
                Role = role,
                Person = (string)c["person"],
                Key = (string)c["key"],
                Start = TinyJson.Num(an["start"]),
                End = TinyJson.Num(an["end"]),
                Gather = TinyJson.NumOrNull(an["gather"]),
                Release = TinyJson.NumOrNull(an["release"]),
                Swing = TinyJson.NumOrNull(an["swing"]),
                Contact = TinyJson.NumOrNull(an["contact"]),
                TaskEnd = TinyJson.NumOrNull(an["taskEnd"]),
                OutcomeAt = TinyJson.NumOrNull(an["outcomeAt"]),
                Outcome = TinyJson.StrOrNull(an["outcome"]),
                Dead = TinyJson.NumOrNull(an["dead"]),
                StrokeEnd = TinyJson.NumOrNull(an["strokeEnd"]),
                Runs = TinyJson.Num(an["runs"]),
                RunStart = TinyJson.NumOrNull(an["runStart"]),
                FollowEnd = TinyJson.NumOrNull(an["followEnd"]),
                SeamMs = TinyJson.NumOrNull(an["seamMs"]),
                HeadMode = (string)an["headMode"] == "space" ? DirectorHeadMode.Space : DirectorHeadMode.Overlay,
                ReducedMotion = (bool)an["reducedMotion"],
                HeadPx = TinyJson.Num(an["headPx"]),
                World = tw,
            };
        }

        private static void CompareFloats(GoldenCaseResult r, string label, float[] ours, List<object> want, int limit)
        {
            int n = limit >= 0 ? Math.Min(limit, want.Count) : want.Count;
            if (limit < 0 && ours.Length != want.Count)
            {
                r.Failures.Add(label + ": length " + ours.Length + " != " + want.Count);
                return;
            }
            if (limit >= 0 && ours.Length < n)
            {
                r.Failures.Add(label + ": length " + ours.Length + " < " + n);
                return;
            }
            for (int i = 0; i < n; i++)
            {
                double w = (double)want[i];
                double diff = Math.Abs((double)ours[i] - w);
                r.EventValues++;
                if (ours[i] == (float)w) r.EventValuesExact++;
                if (diff > r.MaxEventDiff) r.MaxEventDiff = diff;
                // one float32 step is allowed where a float32 step is itself above the tolerance (|v| > 16,384)
                double allowed = Math.Max(EventTolerance, Math.Abs(w) * 1.2e-7);
                if (!(diff <= allowed)) r.Failures.Add(label + "[" + i + "]: " + ours[i].ToString("R", CultureInfo.InvariantCulture) + " vs " + w.ToString("R", CultureInfo.InvariantCulture));
            }
        }

        /// <summary>FNV-1a 32 over the little-endian bytes of the trace (what golden.test.ts hashes).</summary>
        public static uint TraceHash(short[] trace)
        {
            uint h = 0x811c9dc5u;
            unchecked
            {
                for (int i = 0; i < trace.Length; i++)
                {
                    h ^= (byte)(trace[i] & 0xff);
                    h *= 0x01000193u;
                    h ^= (byte)((trace[i] >> 8) & 0xff);
                    h *= 0x01000193u;
                }
            }
            return h;
        }

        public static GoldenCaseResult Check(Dictionary<string, object> c)
        {
            var r = new GoldenCaseResult { Name = (string)c["name"] };
            TestDelivery delivery;
            DirectorAnchors a = AnchorsOf(c, out delivery);
            Dictionary<string, object> an = TinyJson.Obj(c["anchors"]);

            // The ported world reproduces the anchors the web's world gave (a check on the port of world.ts itself).
            if (delivery != null)
            {
                TestTimeline t = delivery.Timeline;
                CheckAnchor(r, "release", t.Release, an["release"]);
                CheckAnchor(r, "end", t.End, an["end"]);
                CheckAnchor(r, "outcomeAt", t.OutcomeAt, an["outcomeAt"]);
                CheckAnchor(r, "dead", t.Dead, an["dead"]);
                CheckAnchor(r, "taskEnd", t.Contact ?? t.PassAt, an["taskEnd"]);
                if (a.Role == DirectorRole.Bowler) CheckAnchor(r, "gather", t.Gather, an["gather"]);
                else
                {
                    CheckAnchor(r, "swing", t.Swing, an["swing"]);
                    CheckAnchor(r, "contact", t.Contact, an["contact"]);
                    CheckAnchor(r, "strokeEnd", t.StrokeEnd, an["strokeEnd"]);
                    CheckAnchor(r, "runs", t.Runs, an["runs"]);
                }
            }

            DirectorPlan plan = DirectorCore.Prepare(a, 60);
            Dictionary<string, object> keys = TinyJson.Obj(c["keys"]);
            uint pk = DirectorSeeds.PersonKey(a.Person, a.Role);
            if (pk != (uint)TinyJson.Num(keys["person"])) r.Failures.Add("person key " + pk + " != " + keys["person"]);
            if (plan.Key != (uint)TinyJson.Num(keys["ball"])) r.Failures.Add("ball key " + plan.Key + " != " + keys["ball"]);

            Dictionary<string, object> want = TinyJson.Obj(c["plan"]);
            if (plan.T0 != TinyJson.Num(want["t0"])) r.Failures.Add("t0 " + plan.T0);
            if (plan.Hz != (int)TinyJson.Num(want["hz"])) r.Failures.Add("hz " + plan.Hz);
            if (plan.N != (int)TinyJson.Num(want["n"])) r.Failures.Add("n " + plan.N + " != " + want["n"]);
            if (plan.Detail != (int)TinyJson.Num(want["detail"])) r.Failures.Add("detail " + plan.Detail + " != " + want["detail"]);
            CompareFloats(r, "amp", plan.Amp, TinyJson.Arr(want["amp"]), -1);
            CompareFloats(r, "draw", plan.Draw, TinyJson.Arr(want["draw"]), -1);
            CompareFloats(r, "fix", plan.Fix, TinyJson.Arr(want["fix"]), -1);
            CompareFloats(r, "blink", plan.Blink, TinyJson.Arr(want["blink"]), -1);
            CompareFloats(r, "micro", plan.Micro, TinyJson.Arr(want["micro"]), TinyJson.Arr(want["micro"]).Count);
            CompareFloats(r, "fidget", plan.Fidget, TinyJson.Arr(want["fidget"]), -1);
            CompareFloats(r, "react", plan.React, TinyJson.Arr(want["react"]), -1);

            Dictionary<string, object> tr = TinyJson.Obj(c["trace"]);
            if ((int)TinyJson.Num(tr["channels"]) != DirectorChannels.Count) r.Failures.Add("channels");
            List<object> frames = TinyJson.Arr(tr["frames"]);
            List<object> values = TinyJson.Arr(tr["values"]);
            for (int f = 0; f < frames.Count; f++)
            {
                int frame = (int)TinyJson.Num(frames[f]);
                double[] row = TinyJson.Doubles(values[f]);
                r.Frames++;
                for (int ch = 0; ch < DirectorChannels.Count; ch++)
                {
                    int diff = Math.Abs(plan.Trace[frame * DirectorChannels.Count + ch] - (int)row[ch]);
                    r.StepValues++;
                    if (diff == 0) r.StepValuesEqual++;
                    if (diff > r.MaxStepDiff[ch]) r.MaxStepDiff[ch] = diff;
                    if (diff > StepTolerance) r.Failures.Add("trace frame " + frame + " channel " + ch + ": " + plan.Trace[frame * DirectorChannels.Count + ch] + " vs " + (int)row[ch]);
                }
            }
            r.TraceHash = TraceHash(plan.Trace);
            r.GoldenHash = (uint)TinyJson.Num(tr["hash"]);
            return r;
        }

        private static void CheckAnchor(GoldenCaseResult r, string name, double? ours, object want)
        {
            double? w = TinyJson.NumOrNull(want);
            if (ours.HasValue != w.HasValue || (ours.HasValue && Math.Abs(ours.Value - w.Value) > 1e-9)) r.Failures.Add("world anchor " + name + ": " + ours + " vs " + w);
        }

        /// <summary>A text table of the results (the evidence file).</summary>
        public static string Report(List<GoldenCaseResult> results)
        {
            var sb = new StringBuilder();
            foreach (GoldenCaseResult r in results)
            {
                sb.Append(r.Name).Append(": failures ").Append(r.Failures.Count).Append(", worst trace step diff ").Append(r.WorstStepDiff)
                    .Append(" (").Append(r.StepValuesEqual).Append('/').Append(r.StepValues).Append(" values exact), max event diff ")
                    .Append(r.MaxEventDiff.ToString("0.#########", CultureInfo.InvariantCulture)).Append(" (").Append(r.EventValuesExact).Append('/').Append(r.EventValues)
                    .Append(" exact as float32), trace hash ").Append(r.TraceHash == r.GoldenHash ? "EQUAL" : "differs").Append(" (").Append(r.TraceHash).Append(" vs ").Append(r.GoldenHash).Append(")\n");
                foreach (string f in r.Failures) sb.Append("  FAIL ").Append(f).Append('\n');
            }
            return sb.ToString();
        }
    }
}
