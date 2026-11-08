using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Vande.Practice.Presentation.Production.Director;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// Replays an extended parity corpus through the C# port. The corpus is made by the web Director itself (a node/vitest exporter,
    /// scripts/director-corpus-export.ts) and holds, one JSON object per line: the inputs (the test
    /// world's spec, the options, the anchors as plain numbers) and the web's outputs (the events as exact float32 and the whole Int16
    /// trace, both base64). The replay builds the same world and anchors, bakes the plan and reports the largest |C# - web| in Int16
    /// steps per channel over every frame of every case, the events' differences, the sliced bake's equality and the hand-over's.
    /// </summary>
    internal static class DirectorCorpusReplay
    {
        public sealed class Result
        {
            public int Cases;
            public long Frames;
            public long Values;
            public readonly int[] MaxStep = new int[DirectorChannels.Count];
            public readonly long[] Differing = new long[DirectorChannels.Count];
            public long EventValues;
            public long EventValuesExact;
            public double MaxEventDiff;
            public int KeysWrong;
            public int HeaderWrong;
            public int HashEqualCases;
            public int SlicedChecked;
            public int SlicedMismatch;
            public int ReuseChecked;
            public int ReuseMismatchWorst;
            public readonly List<string> Failures = new List<string>();
            public readonly Dictionary<string, int[]> ByTag = new Dictionary<string, int[]>();
            public double Seconds;

            public int Worst
            {
                get
                {
                    int m = 0;
                    for (int c = 0; c < MaxStep.Length; c++) m = Math.Max(m, MaxStep[c]);
                    return m;
                }
            }
        }

        private static float[] Floats(object b64)
        {
            byte[] bytes = Convert.FromBase64String((string)b64);
            var f = new float[bytes.Length / 4];
            Buffer.BlockCopy(bytes, 0, f, 0, bytes.Length);
            return f;
        }

        private static short[] Shorts(object b64)
        {
            byte[] bytes = Convert.FromBase64String((string)b64);
            var s = new short[bytes.Length / 2];
            Buffer.BlockCopy(bytes, 0, s, 0, bytes.Length);
            return s;
        }

        /// <summary>A world that fails now and then (deterministic functions of the time, the same as the exporter's): no ball, no aim, flaky answers, NaN and infinity.</summary>
        internal sealed class HostileWorld : IDirectorWorld
        {
            private readonly IDirectorWorld inner;
            private readonly string mode;

            public HostileWorld(IDirectorWorld inner, string mode)
            {
                this.inner = inner;
                this.mode = mode;
            }

            private static long Idx(double t, double p)
            {
                return (long)Math.Floor(t / p);
            }

            public bool Aim(DirectorAim target, double tMs, double[] output)
            {
                switch (mode)
                {
                    case "noaim": return false;
                    case "flaky": return Idx(tMs, 37) % 5 == 0 ? false : inner.Aim(target, tMs, output);
                    case "nan":
                    {
                        bool ok = inner.Aim(target, tMs, output);
                        if (Idx(tMs, 41) % 7 == 0) output[0] = double.NaN;
                        return ok;
                    }
                    default: return inner.Aim(target, tMs, output);
                }
            }

            public bool VisibleBall(double tMs, double[] output, double aheadMs)
            {
                switch (mode)
                {
                    case "noball": return false;
                    case "flaky": return Idx(tMs, 53) % 3 == 0 ? false : inner.VisibleBall(tMs, output, aheadMs);
                    case "nan":
                    {
                        bool ok = inner.VisibleBall(tMs, output, aheadMs);
                        if (Idx(tMs, 43) % 6 == 0) output[1] = double.PositiveInfinity;
                        return ok;
                    }
                    default: return inner.VisibleBall(tMs, output, aheadMs);
                }
            }

            public void ClipHead(double tMs, double[] output)
            {
                inner.ClipHead(tMs, output);
                if (mode == "nan" && Idx(tMs, 29) % 4 == 0) output[2] = double.NaN;
            }
        }

        internal static IDirectorWorld WorldOf(Dictionary<string, object> c, bool pre)
        {
            Dictionary<string, object> opt = TinyJson.Obj(c["options"]);
            Dictionary<string, object> world = TinyJson.Obj(c["world"]);
            var tw = new TestWorld
            {
                Role = (string)c["role"] == "bowler" ? DirectorRole.Bowler : DirectorRole.Striker,
                Lead = (bool)opt["lead"],
                Pre = pre,
                Clip = (string)opt["clip"],
            };
            if (opt["series"] != null) tw.Series = DirectorFixtures.Series[(string)opt["series"]];
            if (!world.ContainsKey("idleMs"))
            {
                tw.Delivery = new TestDelivery(new TestBallSpec
                {
                    SpeedKph = TinyJson.Num(world["speedKph"]),
                    LengthM = TinyJson.Num(world["lengthM"]),
                    LineM = TinyJson.Num(world["lineM"]),
                    Variation = TinyJson.Num(world["variation"]),
                    Outcome = (string)world["outcome"],
                }, TinyJson.Num(world["release"]));
            }
            if (opt.ContainsKey("hostile") && opt["hostile"] != null) return new HostileWorld(tw, (string)opt["hostile"]);
            return tw;
        }

        internal static DirectorAnchors AnchorsOf(Dictionary<string, object> c, Dictionary<string, object> an, IDirectorWorld world)
        {
            return new DirectorAnchors
            {
                Role = (string)c["role"] == "bowler" ? DirectorRole.Bowler : DirectorRole.Striker,
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
                World = world,
            };
        }

        private static void CompareEvents(Result r, string id, string name, float[] ours, float[] want)
        {
            if (ours.Length != want.Length)
            {
                r.Failures.Add(id + " " + name + ": length " + ours.Length + " != " + want.Length);
                return;
            }
            for (int i = 0; i < ours.Length; i++)
            {
                r.EventValues++;
                if (ours[i] == want[i]) r.EventValuesExact++;
                else
                {
                    double diff = Math.Abs((double)ours[i] - want[i]);
                    if (diff > r.MaxEventDiff) r.MaxEventDiff = diff;
                    if (!(diff <= Math.Max(DirectorGoldenCheck.EventTolerance, Math.Abs((double)want[i]) * 1.2e-7))) r.Failures.Add(id + " " + name + "[" + i + "]: " + ours[i].ToString("R", CultureInfo.InvariantCulture) + " vs " + want[i].ToString("R", CultureInfo.InvariantCulture));
                }
            }
        }

        private static void CompareTrace(Result r, string id, string tag, short[] ours, short[] want, int tolerance)
        {
            if (ours.Length != want.Length)
            {
                r.Failures.Add(id + " trace length " + ours.Length + " != " + want.Length);
                return;
            }
            int[] tagStats;
            if (!r.ByTag.TryGetValue(tag, out tagStats)) r.ByTag[tag] = tagStats = new int[3]; // cases, worst step diff, values differing
            tagStats[0]++;
            int worstHere = 0;
            for (int i = 0; i < ours.Length; i++)
            {
                int d = Math.Abs(ours[i] - want[i]);
                r.Values++;
                if (d == 0) continue;
                int ch = i % DirectorChannels.Count;
                r.Differing[ch]++;
                tagStats[2]++;
                if (d > r.MaxStep[ch]) r.MaxStep[ch] = d;
                if (d > worstHere) worstHere = d;
                if (d > tolerance && r.Failures.Count < 50) r.Failures.Add(id + " frame " + i / DirectorChannels.Count + " channel " + ch + ": " + ours[i] + " vs " + want[i]);
            }
            if (worstHere > tagStats[1]) tagStats[1] = worstHere;
            r.Frames += ours.Length / DirectorChannels.Count;
        }

        public static void ReplayCase(Result r, Dictionary<string, object> c, int tolerance, bool checkSliced)
        {
            string id = "case " + (int)TinyJson.Num(c["id"]) + " (" + (string)c["tag"] + ")";
            Dictionary<string, object> expected = TinyJson.Obj(c["expected"]);
            int hz = (int)TinyJson.Num(c["hz"]);
            Dictionary<string, object> opt = TinyJson.Obj(c["options"]);
            IDirectorWorld world = WorldOf(c, (bool)opt["pre"]);
            DirectorAnchors a = AnchorsOf(c, TinyJson.Obj(c["anchors"]), world);
            DirectorPlan plan = DirectorCore.Prepare(a, hz);
            r.Cases++;

            Dictionary<string, object> keys = TinyJson.Obj(expected["keys"]);
            if (DirectorSeeds.PersonKey(a.Person, a.Role) != (uint)TinyJson.Num(keys["person"]) || plan.Key != (uint)TinyJson.Num(keys["ball"]))
            {
                r.KeysWrong++;
                r.Failures.Add(id + ": keys");
            }
            Dictionary<string, object> hdr = TinyJson.Obj(expected["plan"]);
            if (plan.T0 != TinyJson.Num(hdr["t0"]) || plan.Hz != (int)TinyJson.Num(hdr["hz"]) || plan.N != (int)TinyJson.Num(hdr["n"]) || plan.Detail != (int)TinyJson.Num(hdr["detail"]))
            {
                r.HeaderWrong++;
                r.Failures.Add(id + ": header n=" + plan.N + " detail=" + plan.Detail);
            }
            CompareEvents(r, id, "amp", plan.Amp, Floats(expected["amp"]));
            CompareEvents(r, id, "draw", plan.Draw, Floats(expected["draw"]));
            CompareEvents(r, id, "fix", plan.Fix, Floats(expected["fix"]));
            CompareEvents(r, id, "blink", plan.Blink, Floats(expected["blink"]));
            CompareEvents(r, id, "micro", plan.Micro, Floats(expected["micro"]));
            CompareEvents(r, id, "fidget", plan.Fidget, Floats(expected["fidget"]));
            CompareEvents(r, id, "react", plan.React, Floats(expected["react"]));
            CompareTrace(r, id, (string)c["tag"] == null ? "?" : TagGroup((string)c["tag"]), plan.Trace, Shorts(expected["trace"]), tolerance);
            if (DirectorGoldenCheck.TraceHash(plan.Trace) == (uint)TinyJson.Num(expected["hash"])) r.HashEqualCases++;

            if (checkSliced)
            {
                r.SlicedChecked++;
                PlanJob job = DirectorCore.StartPrepare(a, hz);
                while (!job.Advance(1))
                {
                }
                if (!DirectorTestKit.TraceEquals(job.Plan, plan)) r.SlicedMismatch++;
            }

            if (c.ContainsKey("reuse"))
            {
                Dictionary<string, object> ru = TinyJson.Obj(c["reuse"]);
                IDirectorWorld liveWorld = WorldOf(c, true);
                DirectorAnchors liveA = AnchorsOf(c, TinyJson.Obj(ru["liveAnchors"]), liveWorld);
                DirectorPlan live = DirectorCore.Prepare(liveA, hz);
                DirectorPlan reused = DirectorCore.Prepare(a, hz, live, TinyJson.Num(ru["untilMs"]));
                short[] want = Shorts(TinyJson.Obj(ru["expected"])["trace"]);
                r.ReuseChecked++;
                int worst = 0;
                if (want.Length != reused.Trace.Length) worst = int.MaxValue;
                else for (int i = 0; i < want.Length; i++) worst = Math.Max(worst, Math.Abs(want[i] - reused.Trace[i]));
                r.ReuseMismatchWorst = Math.Max(r.ReuseMismatchWorst, worst);
                if (worst > tolerance) r.Failures.Add(id + ": reuse trace differs by " + worst);
            }
        }

        private static string TagGroup(string tag)
        {
            int i = tag.IndexOf('#');
            return i > 0 ? tag.Substring(0, i) : tag;
        }

        public static Result Run(string corpusPath, int tolerance = DirectorGoldenCheck.StepTolerance)
        {
            var r = new Result();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int n = 0;
            foreach (string line in File.ReadLines(corpusPath))
            {
                if (line.Length == 0) continue;
                ReplayCase(r, TinyJson.Obj(TinyJson.Parse(line)), tolerance, n % 5 == 0);
                n++;
            }
            r.Seconds = sw.Elapsed.TotalSeconds;
            return r;
        }

        public static string Report(Result r, string corpusPath, int tolerance)
        {
            var sb = new StringBuilder();
            sb.Append("extended parity corpus: ").Append(corpusPath).Append('\n');
            sb.Append("cases ").Append(r.Cases).Append(", frames compared ").Append(r.Frames).Append(", Int16 values compared ").Append(r.Values).Append(", replay time ").Append(r.Seconds.ToString("0.0", CultureInfo.InvariantCulture)).Append(" s\n");
            sb.Append("keys wrong ").Append(r.KeysWrong).Append(", plan headers wrong ").Append(r.HeaderWrong).Append(", whole-trace hash equal in ").Append(r.HashEqualCases).Append(" of ").Append(r.Cases).Append(" cases (informative: the hash is only comparable inside one engine)\n");
            sb.Append("events: ").Append(r.EventValuesExact).Append(" of ").Append(r.EventValues).Append(" values equal to the web's as float32, largest difference ").Append(r.MaxEventDiff.ToString("R", CultureInfo.InvariantCulture)).Append('\n');
            sb.Append("sliced bake (64 steps a slice) equals the one-go bake in ").Append(r.SlicedChecked - r.SlicedMismatch).Append(" of ").Append(r.SlicedChecked).Append(" checked cases\n");
            sb.Append("hand-over (reuse) cases: ").Append(r.ReuseChecked).Append(", worst difference ").Append(r.ReuseMismatchWorst).Append(" steps\n");
            sb.Append("largest |C# - web| in Int16 steps per channel (tolerance ").Append(tolerance).Append("), and how many of the compared values differ at all:\n");
            long values = r.Values / DirectorChannels.Count;
            for (int c = 0; c < DirectorChannels.Count; c++) sb.Append("  channel ").Append(c.ToString().PadLeft(2)).Append(": max ").Append(r.MaxStep[c]).Append("   differing ").Append(r.Differing[c]).Append(" of ").Append(values).Append('\n');
            sb.Append("worst over all channels: ").Append(r.Worst).Append(" steps\n");
            sb.Append("by case group (cases, worst step difference, differing values):\n");
            foreach (KeyValuePair<string, int[]> kv in r.ByTag) sb.Append("  ").Append(kv.Key.PadRight(10)).Append(' ').Append(kv.Value[0]).Append(" cases, worst ").Append(kv.Value[1]).Append(", differing ").Append(kv.Value[2]).Append('\n');
            sb.Append("failures: ").Append(r.Failures.Count).Append('\n');
            foreach (string f in r.Failures) sb.Append("  FAIL ").Append(f).Append('\n');
            return sb.ToString();
        }

#if !STANDALONE_HARNESS
        /// <summary>
        /// Unity: -executeMethod Vande.Practice.Tests.DirectorTests.DirectorCorpusReplay.RunFromCommandLine, with VANDE_DIRECTOR_CORPUS
        /// (the corpus file) and VANDE_DIRECTOR_OUT (the folder for corpus-parity.txt). Exits 0 when every difference is within 2 steps.
        /// </summary>
        public static void RunFromCommandLine()
        {
            int code = 1;
            try
            {
                string path = Environment.GetEnvironmentVariable("VANDE_DIRECTOR_CORPUS");
                string dir = Environment.GetEnvironmentVariable("VANDE_DIRECTOR_OUT");
                Result r = Run(path);
                string text = Report(r, path, DirectorGoldenCheck.StepTolerance);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                    File.WriteAllText(Path.Combine(dir, "corpus-parity.txt"), text);
                }
                UnityEngine.Debug.Log(text);
                code = r.Failures.Count == 0 ? 0 : 1;
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogError(e.ToString());
            }
            UnityEditor.EditorApplication.Exit(code);
        }
#endif
    }
}
