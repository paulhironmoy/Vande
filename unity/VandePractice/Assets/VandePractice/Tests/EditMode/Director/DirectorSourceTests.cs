using System;
using System.IO;
using System.Text.RegularExpressions;
using NUnit.Framework;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// The Director's runtime sources: pure (no Unity types, no clock, no random source, no platform-dependent function) and
    /// blind (the plan and the bake never name a flight, speed, length, line, variation or result; the one thing about the result
    /// the plan may read is the outcome's category, in the plan builder alone). The C# twin of the web's seeds.test.ts and
    /// honesty.test.ts source scans. Test code, reads the sources from the checkout.
    /// </summary>
    public sealed class DirectorSourceTests
    {
        private static readonly string[] Files =
        {
            "DirectorSeeds.cs", "DirectorNoise.cs", "DirectorChannels.cs", "DirectorTypes.cs", "DirectorPlanBuilder.cs", "DirectorBake.cs", "DirectorCore.cs", "DirectorParams.Generated.cs",
        };

        /// <summary>Source text with block and line comments (and so the XML documentation) removed: the comments say what is not used.</summary>
        private static string Code(string file)
        {
            string text = File.ReadAllText(Path.Combine(DirectorFixtures.RuntimeDir, file));
            text = Regex.Replace(text, @"/\*[\s\S]*?\*/", "");
            return Regex.Replace(text, @"(^|[^:])//.*$", "$1", RegexOptions.Multiline);
        }

        [Test]
        public void TheSourcesAreFound()
        {
            foreach (string f in Files) Assert.That(File.Exists(Path.Combine(DirectorFixtures.RuntimeDir, f)), Is.True, f);
        }

        [Test]
        public void NoUnityTypeNoClockNoRandomSourceNoWallClockNoFrameCount()
        {
            foreach (string f in Files)
            {
                string src = Code(f);
                Assert.That(src, Does.Not.Contain("UnityEngine"), f);
                Assert.That(Regex.IsMatch(src, @"\bRandom\b|\bDateTime\b|\bStopwatch\b|TickCount|\bTime\.|\bTimeSpan\b|\bGuid\b|\bThread\b|\bTask\b|Environment\.|\bFile\.|Application\.|Screen\.|Camera\.|Profiler"), Is.False, f);
                Assert.That(Regex.IsMatch(src, @"\bframeCount\b|\bFrameCount\b|\bdeltaTime\b|\bunscaledTime\b|\brealtimeSinceStartup\b"), Is.False, f);
            }
        }

        [Test]
        public void OnlyArithmeticSinCosExpLogSqrtPowAndRoundingAreUsed_TheSetAPortReproduces()
        {
            string[] allowed = { "Sin", "Cos", "Exp", "Log", "Sqrt", "Pow", "Abs", "Min", "Max", "Floor", "PI" };
            foreach (string f in Files)
                foreach (Match m in Regex.Matches(Code(f), @"(?<![A-Za-z])Math\.(\w+)"))
                    Assert.That(Array.IndexOf(allowed, m.Groups[1].Value), Is.GreaterThanOrEqualTo(0), f + ": Math." + m.Groups[1].Value);
        }

        [Test]
        public void ThePlanAndTheBakeNeverNameTheBall_AndOnlyThePlanBuilderReadsTheOutcomeCategory()
        {
            Regex ball = new Regex(@"\b(flight|speedKph|lengthM|lineM|variation|DeliveryResult|BallFlight|result)\b|\boutcome(?!at)\b", RegexOptions.IgnoreCase);
            foreach (string f in Files)
            {
                string src = Code(f);
                if (f == "DirectorPlanBuilder.cs") src = Regex.Replace(src, @"\ba\.Outcome\b", "");
                if (f == "DirectorTypes.cs") src = src.Replace("public string Outcome;", "");
                Assert.That(ball.IsMatch(src), Is.False, f + ": " + ball.Match(src).Value);
            }
            Assert.That(Regex.IsMatch(Code("DirectorBake.cs"), @"\boutcome\b(?!at)", RegexOptions.IgnoreCase), Is.False);
            // fixations() and reaction() (twice each), nothing else
            Assert.That(Regex.Matches(Code("DirectorPlanBuilder.cs"), @"\ba\.Outcome\b").Count, Is.EqualTo(4));
        }

        [Test]
        public void NoTunableNumberIsHandTyped_TheParametersComeFromTheGeneratedConstants()
        {
            // the bake and the plan builder read their parameters as DirectorParams.* (aliased P.*); this guards the two spots a number
            // could creep in: a second copy of the parameter class, and a parameter-file path in the runtime
            foreach (string f in Files)
            {
                string src = Code(f);
                if (f != "DirectorParams.Generated.cs") Assert.That(src, Does.Not.Contain("class DirectorParams"), f);
                Assert.That(src, Does.Not.Contain("params.json"), f);
            }
        }
    }
}
