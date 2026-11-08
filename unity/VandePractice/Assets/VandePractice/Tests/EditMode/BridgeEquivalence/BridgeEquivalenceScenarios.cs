using System;
using System.Collections.Generic;
using System.Globalization;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>One scripted host conversation for the session-level recording.</summary>
    public sealed class ScenarioCase
    {
        public string Id;
        public Func<List<string>> Packets;
    }

    /// <summary>
    /// Session-level inputs (ordering, duplicates, replays, lifecycle): the real golden scene, delivery, result and replay of
    /// a case, re-enveloped into one coherent session, then perturbed. The payloads are untouched, so the replay digests hold.
    /// </summary>
    public static class BridgeEquivalenceScenarios
    {
        private const string BuildId = "unity-golden-v3";
        private const string Session = "equivalence-session";

        // Step indices of the standard flow. Steps starting with '!' are Unity-side actions (see BridgeEquivalenceOracle.RunScenario).
        private const int Init = 0, Clock1 = 1, Clock5 = 5, Select = 6, Scene = 7, Deliver = 8, Provisional = 9, Result = 10, Dead = 11, DeadBall = 12, Replay = 13, Dead2 = 14, DeadBall2 = 15;
        // Host sequence numbers of the same messages (actions consume none).
        private const int SeqScene = 7, SeqDeliver = 8, SeqProvisional = 9, SeqResult = 10, SeqDeadBall = 11, SeqReplay = 12, SeqDeadBall2 = 13;

        public static List<ScenarioCase> Build(IList<OracleBase> real)
        {
            var byName = new Dictionary<string, OracleBase>();
            foreach (var item in real) byName[item.Name] = item;
            var cases = new List<ScenarioCase>();
            Action<string, Func<List<string>>> add = (id, make) => cases.Add(new ScenarioCase { Id = id, Packets = make });

            foreach (var name in new[] { "grounded-attack", "defensive-tap", "complete-miss" })
            {
                var caseName = name;
                var prefix = "flow/" + caseName + "/";
                add(prefix + "full", () => Flow(byName, caseName, true));
                add(prefix + "no-provisional", () => Flow(byName, caseName, false));
                add(prefix + "duplicate-result", () => Insert(Flow(byName, caseName, true), Result + 1, Flow(byName, caseName, true)[Result]));
                add(prefix + "result-resent-after-dead-ball", () => Insert(Flow(byName, caseName, true), DeadBall + 1, Flow(byName, caseName, true)[Result]));
                add(prefix + "result-new-sequence-same-id", () => Append(Flow(byName, caseName, true), Env(byName[caseName + ".result"], 40, "golden-result-id", caseName)));
                add(prefix + "result-new-sequence-new-id", () => Append(Flow(byName, caseName, true), Env(byName[caseName + ".result"], 41, "other-id", caseName)));
                add(prefix + "result-sequence-regress", () => Replace(Flow(byName, caseName, true), Result, Env(byName[caseName + ".result"], 3, "r-low", caseName)));
                add(prefix + "result-sequence-gap", () => Replace(Flow(byName, caseName, true), Result, Env(byName[caseName + ".result"], 100, "r-gap", caseName)));
                add(prefix + "result-sequence-equal-delivery", () => Replace(Flow(byName, caseName, true), Result, Env(byName[caseName + ".result"], SeqProvisional, "r-eq", caseName)));
                add(prefix + "result-before-delivery", () => Remove(Remove(Flow(byName, caseName, true), Provisional), Deliver));
                add(prefix + "delivery-twice", () => Insert(Flow(byName, caseName, true), Deliver + 1, Env(byName[caseName + ".delivery"], 9, "d-2", caseName)));
                add(prefix + "result-wrong-delivery-id", () => Replace(Flow(byName, caseName, true), Result, Retarget(Flow(byName, caseName, true)[Result], "deliveryId", "\"golden-elsewhere\"")));
                add(prefix + "result-null-delivery-id", () => Replace(Flow(byName, caseName, true), Result, Retarget(Flow(byName, caseName, true)[Result], "deliveryId", "null")));
                add(prefix + "result-other-case", () => Replace(Flow(byName, caseName, true), Result, Env(byName["thin-edge.result"], SeqResult, "r-other", caseName, "golden-" + caseName)));
                add(prefix + "provisional-mismatch", () => Replace(Flow(byName, caseName, true), Provisional, Provisional2(byName, caseName, "power", "0.123")));
                add(prefix + "provisional-after-result", () => Insert(Remove(Flow(byName, caseName, true), Provisional), Result, Flow(byName, caseName, true)[Provisional]));
                add(prefix + "session-change", () => Replace(Flow(byName, caseName, true), Result, Retarget(Flow(byName, caseName, true)[Result], "sessionId", "\"other-session\"")));
                add(prefix + "build-change", () => Replace(Flow(byName, caseName, true), Result, Retarget(Flow(byName, caseName, true)[Result], "buildId", "\"other-build\"")));
                add(prefix + "replay-before-result", () => Insert(Remove(Flow(byName, caseName, true), Result), Result, Flow(byName, caseName, true)[Replay]));
                add(prefix + "replay-of-other-case", () => Replace(Flow(byName, caseName, true), Replay, Env(byName["thin-edge.replay"], SeqReplay, "rp-other", caseName, "golden-" + caseName)));
                add(prefix + "replay-twice", () => Append(Flow(byName, caseName, true), Env(byName[caseName + ".replay"], 13, "rp-2", caseName)));
                add(prefix + "dead-ball-wrong-digest", () => Replace(Flow(byName, caseName, true), DeadBall, DeadBallUi(caseName, SeqDeadBall, "dbu-bad", new string('1', 64))));
                add(prefix + "dead-ball-before-result", () => Insert(Remove(Flow(byName, caseName, true), DeadBall), Result, Flow(byName, caseName, true)[DeadBall]));
                add(prefix + "dead-wrong-digest", () => Replace(Flow(byName, caseName, true), Dead, "!dead|0.5|" + new string('3', 64)));
                add(prefix + "dead-wrong-time", () => Replace(Flow(byName, caseName, true), Dead, "!dead|0.5|" + WireKit.Slice(byName[caseName + ".result"].Body, "payload", "replayDigest").Trim('"')));
                add(prefix + "dead-twice", () => Insert(Flow(byName, caseName, true), Dead + 1, Flow(byName, caseName, true)[Dead]));
                add(prefix + "pause-request-after-dead-ball", () => Insert(Flow(byName, caseName, true), DeadBall + 1, "!pause"));
                add(prefix + "pause-request-during-delivery", () => Insert(Flow(byName, caseName, true), Result, "!pause"));
                add(prefix + "pause-around-result", () => Insert(Insert(Flow(byName, caseName, true), Result + 1, Pause(40, "host.resume", "foreground")), Result, Pause(39, "host.pause", "player")));
                add(prefix + "pause-with-delivery-id", () => Insert(Flow(byName, caseName, true), Result, WireKit.Seal(WireKit.Body("host.pause", 39, "golden-" + caseName, "{\"reason\":\"player\"}", "host", BuildId, Session))));
                add(prefix + "dispose-then-result", () => Insert(Flow(byName, caseName, true), Result, Pause(39, "host.dispose", "complete")));
                add(prefix + "dispose-with-delivery-id", () => Insert(Flow(byName, caseName, true), Result, WireKit.Seal(WireKit.Body("host.dispose", 39, "golden-" + caseName, "{\"reason\":\"complete\"}", "host", BuildId, Session))));
                add(prefix + "garbage-then-continue", () => Insert(Flow(byName, caseName, true), Scene, "{\"body\":\"{}\",\"sha256\":\"bad\"}"));
                add(prefix + "tampered-result", () => Replace(Flow(byName, caseName, true), Result, WireKit.SealWithSha(byName[caseName + ".result"].Body, new string('2', 64))));
                add(prefix + "ack-packets", () => Insert(Insert(Flow(byName, caseName, true), Scene, Ack(30, "m-1")), Result, Ack(31, "m-2")));
                add(prefix + "unity-sender", () => Insert(Flow(byName, caseName, true), Result, WireKit.Seal(WireKit.Body("unity.quiet", 39, null, "{\"quiet\":true}", "unity", BuildId, Session))));
            }
            add("flow/initialize-twice", () => Insert(Flow(byName, "grounded-attack", true), 1, Initialize(30, "right", "real", "init-2")));
            add("flow/initialize-with-delivery-id", () => Replace(Flow(byName, "grounded-attack", true), Init, WireKit.Seal(WireKit.Body("host.initialize", 0, "d-1", InitPayload("right", "real"), "host", BuildId, Session))));
            add("flow/clock-selected-unknown-sample", () => Replace(Flow(byName, "grounded-attack", true), Select, WireKit.Seal(WireKit.Body("host.clock_selected", Select, null, "{\"sampleId\":\"nope\"}", "host", BuildId, Session))));
            add("flow/scene-before-clock-selected", () => Remove(Flow(byName, "grounded-attack", true), Select));
            add("flow/scene-before-clock-sync", () => Remove(Remove(Remove(Remove(Remove(Flow(byName, "grounded-attack", true), 5), 4), 3), 2), 1));
            add("flow/scene-handedness-mismatch", () => Replace(Flow(byName, "grounded-attack", true), Init, Initialize(0, "left", "real", "init-left")));
            add("flow/assistance-mismatch", () => Replace(Flow(byName, "grounded-attack", true), Init, Initialize(0, "right", "learn", "init-learn")));
            add("flow/first-message-not-initialize", () => Remove(Flow(byName, "grounded-attack", true), Init));
            add("flow/profile-and-locale", () => Insert(Insert(Flow(byName, "grounded-attack", true), Scene, Profile(30)), Scene, Locale(31)));
            add("flow/benchmark", () => Insert(Flow(byName, "grounded-attack", true), Scene, WireKit.Seal(WireKit.Body("host.benchmark", 30, null,
                "{\"benchmarkId\":\"b\",\"durationMs\":2000,\"quality\":\"standard\",\"sampleCap\":600,\"warmupFrames\":30}", "host", BuildId, Session))));
            add("flow/demonstration", () =>
            {
                var list = Flow(byName, "grounded-attack", false);
                list = Truncate(list, Scene);
                list.Add(WireKit.Seal(WireKit.Body("host.demonstration", 20, "golden-grounded-attack", "{\"delivery\":" + WireKit.Slice(byName["grounded-attack.delivery"].Body, "payload") +
                    ",\"resolution\":" + WireKit.Slice(byName["grounded-attack.result"].Body, "payload") + ",\"speed\":1}", "host", BuildId, Session)));
                list.Add(WireKit.Seal(WireKit.Body("host.demonstration_cancel", 21, "golden-grounded-attack", "{}", "host", BuildId, Session)));
                return list;
            });
            add("flow/dead-ball-action-from-host", () => Insert(Flow(byName, "grounded-attack", true), DeadBall, WireKit.Seal(WireKit.Body("unity.dead_ball_action", 39, "golden-grounded-attack",
                "{\"action\":\"next_ball\",\"replayDigest\":\"" + new string('1', 64) + "\"}", "unity", BuildId, Session))));
            return cases;
        }

        /// <summary>The standard conversation of one golden case (initialize ... result ... replay), as a list of steps.</summary>
        public static List<string> StandardFlow(IList<OracleBase> real, string caseName, bool withProvisional = true)
        {
            var byName = new Dictionary<string, OracleBase>();
            foreach (var item in real) byName[item.Name] = item;
            return Flow(byName, caseName, withProvisional);
        }

        /// <summary>Index of the host.result step within <see cref="StandardFlow"/>.</summary>
        public const int StandardResultStep = Result;

        // ---------------------------------------------------------------- building blocks

        private static string InitPayload(string handedness, string assistance)
        {
            return "{\"assistance\":\"" + assistance + "\",\"audio\":true,\"captions\":true,\"coordinateSystem\":\"vande-striker-frame-v1\"," +
                   "\"deviceTier\":\"full\",\"handedness\":\"" + handedness + "\",\"handednessPolicy\":\"physics-right-handed-presentation-mirrors-once\"," +
                   "\"haptics\":true,\"highContrast\":false,\"locale\":\"en-IN\",\"pixelsPerDp\":1,\"quality\":\"standard\",\"reducedMotion\":false,\"textScale\":1}";
        }

        private static string Initialize(long sequence, string handedness, string assistance, string messageId)
        {
            return WireKit.Seal(WireKit.Body("host.initialize", sequence, null, InitPayload(handedness, assistance), "host", BuildId, Session, messageId));
        }

        private static string Pause(long sequence, string type, string reason)
        {
            return WireKit.Seal(WireKit.Body(type, sequence, null, "{\"reason\":\"" + reason + "\"}", "host", BuildId, Session));
        }

        private static string Profile(long sequence)
        {
            return WireKit.Seal(WireKit.Body("host.profile", sequence, null, "{\"quality\":\"high\"}", "host", BuildId, Session));
        }

        private static string Locale(long sequence)
        {
            return WireKit.Seal(WireKit.Body("host.locale", sequence, null, "{\"locale\":\"en-IN\"}", "host", BuildId, Session));
        }

        private static string Ack(long sequence, string acknowledged)
        {
            return WireKit.Seal(WireKit.Body("bridge.ack", sequence, null, "{\"acknowledgedMessageId\":\"" + acknowledged + "\"}", "host", BuildId, Session));
        }

        private static string DeadBallUi(string caseName, long sequence, string messageId, string digest)
        {
            return WireKit.Seal(WireKit.Body("host.dead_ball_ui", sequence, "golden-" + caseName,
                "{\"primaryAction\":\"practice_ball\",\"primaryLabel\":\"Practice this ball\",\"reason\":\"Reading the ball\"," +
                "\"recommendation\":\"\",\"replayDigest\":\"" + digest + "\",\"secondaryAction\":\"next_ball\",\"secondaryLabel\":\"Next ball\"}",
                "host", BuildId, Session, messageId));
        }

        /// <summary>A real golden message moved into the scenario session with a new sequence and message id (payload untouched).</summary>
        private static string Env(OracleBase item, long sequence, string messageId, string caseName, string deliveryId = null)
        {
            var body = item.Body;
            body = WireKit.SetValue(body, WireKit.Q(BuildId), "buildId");
            body = WireKit.SetValue(body, WireKit.Q(Session), "sessionId");
            body = WireKit.SetValue(body, sequence.ToString(CultureInfo.InvariantCulture), "sequence");
            body = WireKit.SetValue(body, WireKit.Q(messageId), "messageId");
            if (item.Name.EndsWith(".scene", StringComparison.Ordinal) == false)
                body = WireKit.SetValue(body, WireKit.Q(deliveryId ?? "golden-" + caseName), "deliveryId");
            return WireKit.Seal(body);
        }

        private static string Retarget(string packet, string member, string literal)
        {
            // Unwrap the sealed packet's body, edit one envelope member and seal it again.
            var bodyStart = packet.IndexOf("\"body\":\"", StringComparison.Ordinal) + 8;
            var body = Unescape(packet.Substring(bodyStart, packet.Length - bodyStart - 2));
            return WireKit.Seal(WireKit.SetValue(body, literal, member));
        }

        private static string Unescape(string escaped)
        {
            return escaped.Replace("\\\"", "\"").Replace("\\\\", "\\");
        }

        private static string Provisional2(IDictionary<string, OracleBase> byName, string caseName, string member, string value)
        {
            var swing = WireKit.Slice(byName[caseName + ".result"].Body, "payload", "record", "swing");
            if (member != null) swing = WireKit.SetValue(swing, value, member);
            return WireKit.Seal(WireKit.Body("host.provisional_swing", SeqProvisional, "golden-" + caseName,
                "{\"atPerfMs\":1000,\"calibrationMs\":2,\"swing\":" + swing + "}", "host", BuildId, Session, "provisional-" + caseName));
        }

        private static List<string> Flow(IDictionary<string, OracleBase> byName, string caseName, bool withProvisional)
        {
            var list = new List<string>();
            list.Add(Initialize(0, "right", "real", "init-1"));
            for (var index = 0; index < 5; index++)
            {
                list.Add(WireKit.Seal(WireKit.Body("host.clock_sync", 1 + index, null,
                    "{\"hostSendPerfMs\":" + (100 + index * 10) + ",\"sampleId\":\"c" + index + "\"}", "host", BuildId, Session)));
            }
            list.Add(WireKit.Seal(WireKit.Body("host.clock_selected", 6, null, "{\"sampleId\":\"c4\"}", "host", BuildId, Session)));
            list.Add(Env(byName[caseName + ".scene"], SeqScene, "scene-" + caseName, caseName));
            list.Add(Env(byName[caseName + ".delivery"], SeqDeliver, "delivery-" + caseName, caseName));
            // The no-provisional flow keeps the slot (and so every index) with a harmless locale message.
            list.Add(withProvisional ? Provisional2(byName, caseName, null, null) : Locale(SeqProvisional));
            list.Add(Env(byName[caseName + ".result"], SeqResult, "golden-result-id", caseName));
            var resolution = byName[caseName + ".result"].Body;
            var digest = WireKit.Slice(resolution, "payload", "replayDigest").Trim('"');
            var deadT = WireKit.Slice(resolution, "payload", "result", "deadT");
            list.Add("!dead|" + deadT + "|" + digest);
            list.Add(DeadBallUi(caseName, SeqDeadBall, "dbu-" + caseName, digest));
            list.Add(Env(byName[caseName + ".replay"], SeqReplay, "replay-" + caseName, caseName));
            list.Add("!dead|" + deadT + "|" + digest);
            list.Add(DeadBallUi(caseName, SeqDeadBall2, "dbu2-" + caseName, digest));
            return list;
        }

        private static List<string> Insert(List<string> list, int index, string packet)
        {
            list.Insert(Math.Min(index, list.Count), packet);
            return list;
        }

        private static List<string> Append(List<string> list, string packet)
        {
            list.Add(packet);
            return list;
        }

        private static List<string> Replace(List<string> list, int index, string packet)
        {
            list[index] = packet;
            return list;
        }

        private static List<string> Remove(List<string> list, int index)
        {
            list.RemoveAt(index);
            return list;
        }

        private static List<string> Truncate(List<string> list, int lastIndex)
        {
            list.RemoveRange(lastIndex + 1, list.Count - lastIndex - 1);
            return list;
        }
    }
}
