using System;
using System.Collections.Generic;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// The machinery of the extended parity replay (DirectorCorpusReplay), proved on a corpus line made here from the golden fixture's
    /// own cases: an untouched line replays with no difference and a line whose expected trace is changed by 3 Int16 steps in one
    /// value is reported at exactly 3 steps on that channel and fails the 2-step tolerance. The real corpus (404 plans made by the web
    /// Director) is replayed with -executeMethod DirectorCorpusReplay.RunFromCommandLine; its numbers are in the evidence folder.
    /// </summary>
    public sealed class DirectorCorpusTests
    {
        private static string LineFor(DirectorPlan plan, DirectorAnchors a, Dictionary<string, object> golden, short tamper, int tamperIndex)
        {
            short[] trace = (short[])plan.Trace.Clone();
            if (tamper != 0) trace[tamperIndex] = (short)(trace[tamperIndex] + tamper);
            string B(Array arr, int size)
            {
                var bytes = new byte[arr.Length * size];
                Buffer.BlockCopy(arr, 0, bytes, 0, bytes.Length);
                return Convert.ToBase64String(bytes);
            }
            Dictionary<string, object> an = TinyJson.Obj(golden["anchors"]);
            string N(object o) => o == null ? "null" : ((double)o).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            string S(object o) => o == null ? "null" : "\"" + (string)o + "\"";
            return "{\"id\":1,\"tag\":\"self#1\",\"kind\":\"delivery\",\"role\":\"" + (string)golden["role"] + "\",\"person\":\"" + (string)golden["person"] + "\",\"key\":\"" + (string)golden["key"] + "\",\"hz\":60," +
                "\"world\":" + Json(golden["world"]) + ",\"options\":{\"reducedMotion\":" + (((bool)TinyJson.Obj(golden["options"])["reducedMotion"]) ? "true" : "false") + ",\"lead\":true,\"headPx\":40,\"pre\":false,\"clip\":\"real\",\"series\":null}," +
                "\"anchors\":{\"start\":" + N(an["start"]) + ",\"end\":" + N(an["end"]) + ",\"gather\":" + N(an["gather"]) + ",\"release\":" + N(an["release"]) + ",\"swing\":" + N(an["swing"]) + ",\"contact\":" + N(an["contact"]) +
                ",\"taskEnd\":" + N(an["taskEnd"]) + ",\"outcomeAt\":" + N(an["outcomeAt"]) + ",\"outcome\":" + S(an["outcome"]) + ",\"dead\":" + N(an["dead"]) + ",\"strokeEnd\":" + N(an["strokeEnd"]) + ",\"runs\":" + N(an["runs"]) +
                ",\"runStart\":" + N(an["runStart"]) + ",\"followEnd\":" + N(an["followEnd"]) + ",\"seamMs\":" + N(an["seamMs"]) + ",\"headMode\":\"" + (string)an["headMode"] + "\",\"reducedMotion\":" + (a.ReducedMotion ? "true" : "false") + ",\"headPx\":40}," +
                "\"expected\":{\"keys\":{\"person\":" + DirectorSeeds.PersonKey(a.Person, a.Role) + ",\"ball\":" + plan.Key + "},\"plan\":{\"t0\":" + N(plan.T0) + ",\"hz\":60,\"n\":" + plan.N + ",\"detail\":" + plan.Detail + "}," +
                "\"amp\":\"" + B(plan.Amp, 4) + "\",\"draw\":\"" + B(plan.Draw, 4) + "\",\"fix\":\"" + B(plan.Fix, 4) + "\",\"blink\":\"" + B(plan.Blink, 4) + "\",\"micro\":\"" + B(plan.Micro, 4) + "\",\"fidget\":\"" + B(plan.Fidget, 4) + "\",\"react\":\"" + B(plan.React, 4) + "\"," +
                "\"trace\":\"" + B(trace, 2) + "\",\"hash\":" + DirectorGoldenCheck.TraceHash(trace) + "}}";
        }

        private static string Json(object o)
        {
            var d = TinyJson.Obj(o);
            var parts = new List<string>();
            foreach (KeyValuePair<string, object> kv in d)
                parts.Add("\"" + kv.Key + "\":" + (kv.Value is string ? "\"" + kv.Value + "\"" : ((double)kv.Value).ToString("R", System.Globalization.CultureInfo.InvariantCulture)));
            return "{" + string.Join(",", parts.ToArray()) + "}";
        }

        [Test]
        public void TheReplayMachinery_ReportsNoDifferenceOnAnUntouchedLine_AndExactlyThreeStepsOnATamperedOne()
        {
            Dictionary<string, object> golden = TinyJson.Obj(DirectorGoldenCheck.Cases(DirectorFixtures.Read("golden.json"))[0]);
            TestDelivery d;
            DirectorAnchors a = DirectorGoldenCheck.AnchorsOf(golden, out d);
            DirectorPlan plan = DirectorCore.Prepare(a, 60);

            var clean = new DirectorCorpusReplay.Result();
            DirectorCorpusReplay.ReplayCase(clean, TinyJson.Obj(TinyJson.Parse(LineFor(plan, a, golden, 0, 0))), 2, true);
            Assert.That(clean.Failures, Is.Empty);
            Assert.That(clean.Worst, Is.EqualTo(0));
            Assert.That(clean.SlicedChecked, Is.EqualTo(1));
            Assert.That(clean.SlicedMismatch, Is.EqualTo(0));
            Assert.That(clean.Values, Is.EqualTo((long)plan.Trace.Length));
            Assert.That(clean.EventValuesExact, Is.EqualTo(clean.EventValues));

            int index = 100 * DirectorChannels.Count + DirectorChannels.GazePitch;
            var tampered = new DirectorCorpusReplay.Result();
            DirectorCorpusReplay.ReplayCase(tampered, TinyJson.Obj(TinyJson.Parse(LineFor(plan, a, golden, 3, index))), 2, false);
            Assert.That(tampered.MaxStep[DirectorChannels.GazePitch], Is.EqualTo(3));
            Assert.That(tampered.Worst, Is.EqualTo(3));
            Assert.That(tampered.Differing[DirectorChannels.GazePitch], Is.EqualTo(1));
            Assert.That(tampered.Failures.Count, Is.EqualTo(1), "a difference of 3 steps is over the tolerance of 2");

            var within = new DirectorCorpusReplay.Result();
            DirectorCorpusReplay.ReplayCase(within, TinyJson.Obj(TinyJson.Parse(LineFor(plan, a, golden, 2, index))), 2, false);
            Assert.That(within.MaxStep[DirectorChannels.GazePitch], Is.EqualTo(2));
            Assert.That(within.Failures, Is.Empty, "2 steps is within the tolerance");
        }
    }
}
