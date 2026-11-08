using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// The golden fixture of contract director/3 (tests/unit/render3d/director/fixtures/golden.json, frozen on the web by
    /// golden.test.ts) replayed through the C# port: five cases (a striker six with the extrapolated pursuit, a striker wicket in
    /// Reduced Motion, a bowler, two scenes between balls with the seam, one with a 20 px head), each with the key, the person, the
    /// anchors, the test world, the plan's events and 14 to 30 exact trace frames. A port matches the keys exactly, the events
    /// within 1e-3 and the trace samples within 2 Int16 steps; the hash of the whole trace is only comparable inside one engine,
    /// so it is reported here and never asserted. Builder measurement, not a player or evaluator result.
    /// </summary>
    public sealed class DirectorGoldenTests
    {
        private static List<object> Cases()
        {
            return DirectorGoldenCheck.Cases(DirectorFixtures.Read("golden.json"));
        }

        [TestCase(0)]
        [TestCase(1)]
        [TestCase(2)]
        [TestCase(3)]
        [TestCase(4)]
        public void GoldenCase_IsReproducedByTheCSharpPort(int index)
        {
            List<object> cases = Cases();
            Assert.That(cases.Count, Is.EqualTo(5));
            GoldenCaseResult r = DirectorGoldenCheck.Check((Dictionary<string, object>)cases[index]);
            Assert.That(r.Failures, Is.Empty, DirectorGoldenCheck.Report(new List<GoldenCaseResult> { r }));
            Assert.That(r.WorstStepDiff, Is.LessThanOrEqualTo(DirectorGoldenCheck.StepTolerance));
        }

        [Test]
        public void TheFixtureNamesTheContract_TheParameterFile_AndTheChannelCount()
        {
            Dictionary<string, object> doc = TinyJson.Obj(TinyJson.Parse(DirectorFixtures.Read("golden.json")));
            Assert.That((string)doc["contract"], Is.EqualTo(DirectorCore.Contract));
            Assert.That((int)TinyJson.Num(doc["channels"]), Is.EqualTo(DirectorChannels.Count));
            Assert.That((int)TinyJson.Num(doc["paramsBytes"]), Is.EqualTo(DirectorParams.MinifiedChars), "the generated constants come from the params.json the golden fixture was recorded with");
        }

        [Test]
        public void TheCases_CoverWhatAPortMustGetRight()
        {
            var moved = new HashSet<int>();
            bool fidgets = false;
            bool reaction = false;
            bool sideGlance = false;
            foreach (object o in Cases())
            {
                Dictionary<string, object> c = TinyJson.Obj(o);
                foreach (object row in TinyJson.Arr(TinyJson.Obj(c["trace"])["values"]))
                {
                    double[] v = TinyJson.Doubles(row);
                    for (int ch = 0; ch < v.Length; ch++) if (v[ch] != 0) moved.Add(ch);
                }
                Dictionary<string, object> plan = TinyJson.Obj(c["plan"]);
                fidgets |= TinyJson.Arr(plan["fidget"]).Count > 0;
                reaction |= TinyJson.Arr(plan["react"]).Count > 0;
                List<object> fix = TinyJson.Arr(plan["fix"]);
                for (int i = 1; i < fix.Count; i += 5) sideGlance |= (double)fix[i] == 4;
            }
            // 'space' mode writes no eye channels (3-6, 9), and the effort (18) is the runtime's own, from the swing: never in a plan
            foreach (int ch in new[] { 0, 1, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23 }) Assert.That(moved.Contains(ch), Is.True, "channel " + ch + " moves in some case");
            Assert.That(moved.Contains(18), Is.False);
            Assert.That(fidgets && reaction && sideGlance, Is.True);
        }

        [Test]
        public void TheParityTable_IsWrittenWhenAsked()
        {
            var results = new List<GoldenCaseResult>();
            foreach (object c in Cases()) results.Add(DirectorGoldenCheck.Check((Dictionary<string, object>)c));
            string text = DirectorGoldenCheck.Report(results);
            string dir = Environment.GetEnvironmentVariable("VANDE_DIRECTOR_OUT");
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
                var sb = new StringBuilder();
                sb.Append("golden.json (contract director/3) replayed through the C# port\n").Append(text);
                sb.Append("per channel, largest |C# - web| in Int16 steps over all picked frames of all cases:\n");
                for (int ch = 0; ch < DirectorChannels.Count; ch++)
                {
                    int m = 0;
                    foreach (GoldenCaseResult r in results) m = Math.Max(m, r.MaxStepDiff[ch]);
                    sb.Append("  channel ").Append(ch).Append(": ").Append(m).Append('\n');
                }
                File.WriteAllText(Path.Combine(dir, "golden-parity.txt"), sb.ToString());
            }
            foreach (GoldenCaseResult r in results) Assert.That(r.Failures, Is.Empty, text);
        }
    }

    /// <summary>
    /// The Unity copies of the web's files (like VandeMotionPackVendoredTests): params.json, golden.json and bowler-clip-head.json
    /// live in the Unity project because Unity cannot read outside Assets/. Each copy must stay byte-identical to the web file
    /// (the web test tests/unit/render3d/director/unityVendored.test.ts asserts the same), and DirectorParams.Generated.cs must
    /// come from the copy: change params.json, run scripts/director-unity-params.mjs, never edit a copy by hand.
    /// </summary>
    public sealed class DirectorVendoredTests
    {
        private static string RepoRoot
        {
            get { return DirectorFixtures.RepoRoot; }
        }

        [Test]
        public void TheGeneratedConstants_AreMadeFromTheVendoredParameterFile()
        {
            byte[] bytes = File.ReadAllBytes(Path.Combine(DirectorFixtures.Dir, "params.json"));
            uint h = 0x811c9dc5u;
            unchecked
            {
                foreach (byte b in bytes)
                {
                    h ^= b;
                    h *= 0x01000193u;
                }
            }
            Assert.That(bytes.Length, Is.EqualTo(DirectorParams.SourceBytes), "run: node scripts/director-unity-params.mjs");
            Assert.That(h, Is.EqualTo(DirectorParams.SourceFnv1a32), "run: node scripts/director-unity-params.mjs");
        }

        [TestCase("src/render3d/core/motion/director/params.json", "params.json")]
        [TestCase("tests/unit/render3d/director/fixtures/golden.json", "golden.json")]
        [TestCase("tests/unit/render3d/director/fixtures/bowler-clip-head.json", "bowler-clip-head.json")]
        public void VendoredCopy_EqualsTheWebFile(string web, string copy)
        {
            string webPath = Path.Combine(RepoRoot, web);
            if (!File.Exists(webPath)) Assert.Ignore("The web file is not in this checkout: " + web);
            Assert.That(File.ReadAllText(Path.Combine(DirectorFixtures.Dir, copy)).Replace("\r\n", "\n"), Is.EqualTo(File.ReadAllText(webPath).Replace("\r\n", "\n")), copy + " must be an exact copy of " + web + "; change the web file, then copy it.");
        }
    }
}
