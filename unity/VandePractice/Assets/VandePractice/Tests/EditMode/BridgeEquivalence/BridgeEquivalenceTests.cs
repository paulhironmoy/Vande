using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// Decision recording of the bridge (UNITY-6). The recording file next to this class was written by the bridge as it
    /// stood BEFORE the decode-latency work (the strict JSON parse, canonical form, SHA-256, schema validation, replay
    /// digest and session lifecycle): for each corpus case it holds accept or reject, the exact reject reason, and a digest
    /// of the parsed model. These tests replay the same corpus and require every line to match.
    /// Re-record only on purpose: set VANDE_BRIDGE_RECORD_OUT to a file path and run these tests; they then write that file
    /// and skip the comparison.
    /// </summary>
    public sealed class BridgeEquivalenceTests
    {
        private const string RecordingName = "BridgeEquivalence.recording.txt";
        private static List<OracleBase> bases;
        private static Dictionary<char, List<string>> expected;

        [Serializable] private sealed class FixtureFile { public FixtureCase[] cases; }
        [Serializable] private sealed class FixtureCase { public string id; public FixtureWire wire; }
        [Serializable] private sealed class FixtureWire { public FixturePackets packets; }
        [Serializable] private sealed class FixturePackets { public FixturePacket scene; public FixturePacket delivery; public FixturePacket result; public FixturePacket replay; }
        [Serializable] private sealed class FixturePacket { public string body; public string sha256; }

        private static string RepositoryPath(params string[] parts)
        {
            var path = Application.dataPath + "/../../..";
            foreach (var part in parts) path += "/" + part;
            return Path.GetFullPath(path);
        }

        private static string RecordingPath()
        {
            return Path.Combine(Application.dataPath, "VandePractice", "Tests", "EditMode", "BridgeEquivalence", RecordingName);
        }

        internal static List<OracleBase> LoadBases()
        {
            if (bases != null) return bases;
            var path = RepositoryPath("tests", "fixtures", "unity-practice", "practice-v3.json");
            Assert.That(File.Exists(path), Is.True, "the shared TS golden fixture must stay at " + path);
            var fixture = JsonUtility.FromJson<FixtureFile>(File.ReadAllText(path));
            var list = new List<OracleBase>();
            foreach (var item in fixture.cases)
            {
                list.Add(new OracleBase { Name = item.id + ".delivery", Body = item.wire.packets.delivery.body, Sha256 = item.wire.packets.delivery.sha256 });
                list.Add(new OracleBase { Name = item.id + ".replay", Body = item.wire.packets.replay.body, Sha256 = item.wire.packets.replay.sha256 });
                list.Add(new OracleBase { Name = item.id + ".result", Body = item.wire.packets.result.body, Sha256 = item.wire.packets.result.sha256 });
                list.Add(new OracleBase { Name = item.id + ".scene", Body = item.wire.packets.scene.body, Sha256 = item.wire.packets.scene.sha256 });
            }
            bases = list;
            return list;
        }

        internal static string BasesDigest(IList<OracleBase> list)
        {
            var text = new StringBuilder();
            foreach (var item in list) text.Append(item.Name).Append(':').Append(item.Sha256).Append('\n');
            return WireKitAccess.Sha(text.ToString()).Substring(0, 16);
        }

        private static string RecordOutPath()
        {
            var path = Environment.GetEnvironmentVariable("VANDE_BRIDGE_RECORD_OUT");
            return string.IsNullOrEmpty(path) ? null : path;
        }

        private static Dictionary<char, List<string>> LoadExpected()
        {
            if (expected != null) return expected;
            var path = RecordingPath();
            Assert.That(File.Exists(path), Is.True, "the decision recording must be next to the tests: " + path);
            var sections = new Dictionary<char, List<string>> { { 'P', new List<string>() }, { 'J', new List<string>() }, { 'S', new List<string>() }, { '#', new List<string>() } };
            foreach (var line in File.ReadAllLines(path))
            {
                if (line.Length == 0) continue;
                List<string> section;
                if (sections.TryGetValue(line[0], out section)) section.Add(line);
            }
            expected = sections;
            return sections;
        }

        // Rows may legitimately carry a trailing "adapter=" digest only when produced under Unity; compare everything else exactly.
        private static void AssertSection(char kind, List<string> actual)
        {
            if (RecordOutPath() != null) return; // recording mode: RecordAll writes the file; comparing it with itself proves nothing
            var wanted = LoadExpected()[kind];
            var failures = new List<string>();
            if (wanted.Count != actual.Count) failures.Add("line count " + actual.Count + " != recorded " + wanted.Count);
            for (var index = 0; index < Math.Min(wanted.Count, actual.Count); index++)
            {
                if (SameLine(wanted[index], actual[index])) continue;
                if (failures.Count < 12) failures.Add("line " + index + "\n  recorded: " + wanted[index] + "\n  actual:   " + actual[index]);
            }
            Assert.That(failures, Is.Empty, kind + " decisions differ from the pre-change recording:\n" + string.Join("\n", failures));
        }

        // A few accepted packets added to the corpus after the first recording have no Editor adapter digest from the pre-change bridge
        // (it could only be recorded outside the Editor): their line ends with "|adapter=?" and that one digest is not compared.
        private static bool SameLine(string recorded, string actual)
        {
            if (string.Equals(recorded, actual, StringComparison.Ordinal)) return true;
            const string unknown = "|adapter=?";
            if (!recorded.EndsWith(unknown, StringComparison.Ordinal)) return false;
            var cut = actual.LastIndexOf("|adapter=", StringComparison.Ordinal);
            var core = cut < 0 ? actual : actual.Substring(0, cut);
            return string.Equals(recorded.Substring(0, recorded.Length - unknown.Length), core, StringComparison.Ordinal);
        }

        private static List<string> PacketLines()
        {
            var lines = new List<string>();
            foreach (var item in BridgeEquivalenceCorpus.BuildPacketCases(LoadBases())) lines.Add(BridgeEquivalenceOracle.RunPacket(item));
            return lines;
        }

        private static List<string> JsonLines()
        {
            var lines = new List<string>();
            foreach (var item in BridgeEquivalenceJsonCorpus.Build())
            {
                lines.Add(BridgeEquivalenceOracle.RunJson(item.Key, item.Value, false));
                lines.Add(BridgeEquivalenceOracle.RunJson(item.Key, item.Value, true));
            }
            return lines;
        }

        private static List<string> ScenarioLines()
        {
            var lines = new List<string>();
            foreach (var scenario in BridgeEquivalenceScenarios.Build(LoadBases()))
                lines.AddRange(BridgeEquivalenceOracle.RunScenario(scenario.Id, scenario.Packets()));
            return lines;
        }

        [Test]
        public void RecordAll_WritesTheRecordingWhenAsked_OtherwiseChecksItIsPresent()
        {
            var path = RecordOutPath();
            if (path == null)
            {
                // Not recording: prove the stored recording is there and says what it is.
                Assert.That(File.Exists(RecordingPath()), Is.True, "the pre-change recording must stay next to these tests");
                Assert.That(LoadExpected()['#'][0], Is.EqualTo("# bridge equivalence recording v1"));
                return;
            }
            var lines = new List<string>
            {
                "# bridge equivalence recording v1",
                "# bases " + LoadBases().Count + " sha16 " + BasesDigest(LoadBases())
            };
            lines.AddRange(PacketLines());
            lines.AddRange(JsonLines());
            lines.AddRange(ScenarioLines());
            File.WriteAllLines(path, lines);
            Debug.Log("VANDE bridge equivalence recording written: " + path + " lines=" + lines.Count);
        }

        [Test]
        public void CorpusInputs_AreThePinnedFixtureAndAreTheSizeTheRecordingWasMadeFrom()
        {
            if (RecordOutPath() != null) return; // recording mode: the next lines would compare the recording with itself
            var header = LoadExpected()['#'];
            Assert.That(header, Has.Count.GreaterThanOrEqualTo(2));
            Assert.That(header[1], Is.EqualTo("# bases " + LoadBases().Count + " sha16 " + BasesDigest(LoadBases())),
                "the shared golden fixture changed since the recording was made");
        }

        [Test]
        public void PacketDecisions_MatchTheRecording()
        {
            AssertSection('P', PacketLines());
        }

        [Test]
        public void StrictJsonObjectAnswers_MatchTheRecording()
        {
            AssertSection('J', JsonLines());
        }

        [Test]
        public void SessionLifecycleDecisions_MatchTheRecording()
        {
            AssertSection('S', ScenarioLines());
        }
    }
}
