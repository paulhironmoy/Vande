using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// Latency of the result-packet arrival chain (UNITY-6). With VANDE_BRIDGE_PROFILE_OUT set to a directory these tests write the
    /// per-leg tables (bridge legs, then the world's AcceptResult) there; without it they only prove the harness runs once.
    /// The allocation budget is a real assertion on every run (it is exact, unlike a timing).
    /// </summary>
    public sealed class BridgeLatencyTests
    {
        private const double Step = 1.0 / 60.0;
        private GameObject root;

        private static readonly string[] ProfiledPackets = { "early-attack", "grounded-attack", "thin-edge" };

        [TearDown]
        public void TearDown()
        {
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
        }

        private static string OutDir()
        {
            var path = Environment.GetEnvironmentVariable("VANDE_BRIDGE_PROFILE_OUT");
            return string.IsNullOrEmpty(path) ? null : path;
        }

        private static string FixturePacket(IList<OracleBase> bases, string name, string kind)
        {
            var item = bases.First(b => b.Name == name + "." + kind);
            return WireKit.SealWithSha(item.Body, item.Sha256);
        }

        [Test]
        public void ProfileHarness_ProfilesTheGoldenResultPackets_AndWritesTheTableWhenAsked()
        {
            var bases = BridgeEquivalenceTests.LoadBases();
            var directory = OutDir();
            var lines = new List<string>
            {
                "UNITY-6 per-leg profile of the result-packet arrival chain (Unity Editor, Mono " + Environment.Version + ")",
                "uptime: " + BridgeLatencyProfile.Uptime(),
                "legs are cold (number memo cleared, a collection forced before) unless named warm; median of the timed runs after 2 warm-ups; bytes = " + BridgeLatencyProfile.AllocationMethod()
            };
            foreach (var name in directory == null ? new[] { "early-attack" } : ProfiledPackets)
            {
                var packet = FixturePacket(bases, name, "result");
                var flow = BridgeEquivalenceScenarios.StandardFlow(bases, name);
                var prefix = flow.GetRange(0, BridgeEquivalenceScenarios.StandardResultStep);
                var sessionResult = flow[BridgeEquivalenceScenarios.StandardResultStep];
                lines.Add(string.Empty);
                lines.Add("== " + name + ".result  packet " + packet.Length.ToString(CultureInfo.InvariantCulture) + " chars");
                var runs = directory == null ? 1 : 7;
                lines.AddRange(BridgeLatencyProfile.Run(name, packet, prefix, sessionResult, runs));
            }
            Assert.That(lines.Count, Is.GreaterThan(10));
            if (directory == null) return;
            Directory.CreateDirectory(directory);
            File.WriteAllLines(Path.Combine(directory, "bridge-legs.txt"), lines);
            Debug.Log("VANDE bridge profile written to " + directory);
        }

        [Serializable] private sealed class Fixture { public Case[] cases; }
        [Serializable] private sealed class Case { public string id; public Wire wire; }
        [Serializable] private sealed class Wire { public Packets packets; }
        [Serializable] private sealed class Packets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket result;
        }

        private sealed class NullSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        /// <summary>
        /// The chain as the editor runs it for each golden case: decode, the adapter both ways, and the world's AcceptResult at 0.10 s
        /// of the delivery (what UNITY-5's AcceptCostProbe measured). Median of 5 after a warm-up run per case.
        /// </summary>
        [Test]
        public void AcceptChain_PerGoldenCase_WritesTheTableWhenAsked()
        {
            var directory = OutDir();
            if (directory == null) return; // the world leg is slow and only wanted as evidence
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            var fixture = JsonUtility.FromJson<Fixture>(File.ReadAllText(path));
            var lines = new List<string>
            {
                "case, result packet chars (as JsonUtility writes it), then medians of 5 after a warm-up: Decode ms (alloc KB) | ResultFromValidated ms (KB) | Result (UNITY-5 'adapt') ms | AcceptResult ms (KB)",
                "uptime: " + BridgeLatencyProfile.Uptime()
            };
            var stageNames = AcceptResultTimings.Stages;
            var stageColumns = new List<double[]>();
            var stageHeaders = new List<string>();
            foreach (var item in fixture.cases)
            {
                var stageRuns = new List<double[]>();
                var decode = new List<double>(); var adaptRuntime = new List<double>(); var adaptPublic = new List<double>(); var accept = new List<double>();
                var decodeKb = new List<long>(); var adaptKb = new List<long>(); var acceptKb = new List<long>();
                var chars = 0;
                for (var run = 0; run < 6; run++)
                {
                    var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
                    var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
                    if (root != null) UnityEngine.Object.DestroyImmediate(root);
                    root = new GameObject("bridge latency " + item.id);
                    var world = root.AddComponent<ProceduralPracticeWorld>();
                    world.Configure(new PracticePresentationSettings
                    {
                        Assistance = "play", Handedness = "right", Locale = "en-IN", Quality = PracticePresentationQuality.High
                    }, new NullSink());
                    world.ConfigureScene(scene);
                    world.BeginDelivery(delivery);
                    while (world.TimelineForEvidence < 0.10) world.Tick(Step);
                    var json = JsonUtility.ToJson(item.wire.packets.result);
                    chars = json.Length;
                    CanonicalJson.ClearNumberMemo();
                    GC.Collect();
                    var a0 = BridgeLatencyProfile.AllocatedBytes();
                    var watch = System.Diagnostics.Stopwatch.StartNew();
                    var envelope = UnityPracticePacketCodec.Decode(json).Envelope;
                    var decodeMs = watch.Elapsed.TotalMilliseconds;
                    var a1 = BridgeLatencyProfile.AllocatedBytes();
                    watch.Restart();
                    var result = PracticePresentationContractAdapter.ResultFromValidated(envelope);
                    var adaptRuntimeMs = watch.Elapsed.TotalMilliseconds;
                    var a2 = BridgeLatencyProfile.AllocatedBytes();
                    watch.Restart();
                    PracticePresentationContractAdapter.Result(envelope);
                    var adaptPublicMs = watch.Elapsed.TotalMilliseconds;
                    var a3 = BridgeLatencyProfile.AllocatedBytes();
                    watch.Restart();
                    world.AcceptResult(result);
                    var acceptMs = watch.Elapsed.TotalMilliseconds;
                    var a4 = BridgeLatencyProfile.AllocatedBytes();
                    if (run == 0) continue;
                    stageRuns.Add((double[])AcceptResultTimings.Milliseconds.Clone());
                    decode.Add(decodeMs); adaptRuntime.Add(adaptRuntimeMs); adaptPublic.Add(adaptPublicMs); accept.Add(acceptMs);
                    decodeKb.Add(a0 < 0 ? -1 : (a1 - a0) / 1024); adaptKb.Add(a0 < 0 ? -1 : (a2 - a1) / 1024); acceptKb.Add(a0 < 0 ? -1 : (a4 - a3) / 1024);
                }
                Func<List<long>, string> mid = values => { var m = values.OrderBy(x => x).ToList()[values.Count / 2]; return m < 0 ? "n/a" : m.ToString(CultureInfo.InvariantCulture); };
                Func<double, string> f = value => value.ToString("F2", CultureInfo.InvariantCulture);
                var medians = new double[stageNames.Length];
                for (var stage = 0; stage < stageNames.Length; stage++)
                    medians[stage] = BridgeLatencyProfile.Median(stageRuns.Select(r => r[stage]).ToList());
                stageColumns.Add(medians);
                stageHeaders.Add(item.id);
                lines.Add(item.id.PadRight(17) + " " + chars.ToString(CultureInfo.InvariantCulture).PadLeft(7) + " | decode " + f(BridgeLatencyProfile.Median(decode)).PadLeft(7) + " (" + mid(decodeKb) + " KB) | adapt(runtime) " +
                          f(BridgeLatencyProfile.Median(adaptRuntime)).PadLeft(6) + " (" + mid(adaptKb) + " KB) | Result() " + f(BridgeLatencyProfile.Median(adaptPublic)).PadLeft(6) +
                          " | AcceptResult " + f(BridgeLatencyProfile.Median(accept)).PadLeft(6) + " (" + mid(acceptKb) + " KB)");
            }
            lines.Add(string.Empty);
            lines.Add("AcceptResult by stage, ms (median of 5 per case; ProceduralPracticeWorld.AcceptResult, Editor-only marks)");
            lines.Add("stage".PadRight(46) + string.Join(" ", stageHeaders.Select(h => h.Length > 11 ? h.Substring(0, 11).PadLeft(11) : h.PadLeft(11))));
            for (var stage = 0; stage < stageNames.Length; stage++)
            {
                lines.Add(stageNames[stage].PadRight(46) + string.Join(" ", stageColumns.Select(c => c[stage].ToString("F3", CultureInfo.InvariantCulture).PadLeft(11))));
            }

            lines.Add("TOTAL".PadRight(46) + string.Join(" ", stageColumns.Select(c => c.Sum().ToString("F3", CultureInfo.InvariantCulture).PadLeft(11))));
            Directory.CreateDirectory(directory);
            File.WriteAllLines(Path.Combine(directory, "accept-chain.txt"), lines);
            Debug.Log("VANDE accept chain table written to " + directory);
        }
    }
}
