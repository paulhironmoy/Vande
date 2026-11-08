using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>A real wire message from the shared TS golden fixture: its canonical body and the claimed SHA-256.</summary>
    public sealed class OracleBase
    {
        public string Name;
        public string Body;
        public string Sha256;
    }

    /// <summary>One bridge input. The packet text is made on demand so a 400 KB case is never held longer than its run.</summary>
    public sealed class OracleCase
    {
        public string Id;
        public Func<string> Make;
    }

    /// <summary>
    /// The bridge equivalence corpus (UNITY-6). It is the input half of a decision recording: every case is run through the
    /// bridge, and its accept/reject decision, reject reason and parsed-model digest are compared with what the pre-change
    /// bridge recorded. The corpus never touches the code under test (see WireKit), is fully deterministic, and covers
    /// truncation at many offsets, bad digests, wrong versions, missing/extra/duplicate keys, key order, number and
    /// string edge cases, nesting depth, size ceilings and wrong envelope kinds, on the real golden result, replay,
    /// delivery and scene packets and on small synthetic packets of every message type.
    /// </summary>
    public static class BridgeEquivalenceCorpus
    {
        // ---------------------------------------------------------------- synthetic payloads (all contract v6, canonical)

        private const string Plan = "{\"lengthM\":6,\"lineM\":0,\"speedKph\":130,\"variation\":\"stock\"}";
        private const string Bowler = "{\"arm\":\"right\",\"family\":\"pace\",\"lookSeed\":\"look\",\"paceBand\":\"fast\"}";
        private const string Ball = "{\"age\":\"new\",\"colour\":\"red\"}";
        private const string Digest64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        private static readonly string[] Roles =
        {
            "keeper", "bowler", "slip", "point", "cover", "mid_off",
            "mid_on", "midwicket", "square_leg", "fine_leg", "third_man"
        };

        private const string Flight =
            "{\"bounce\":null,\"idealContactT\":0.45,\"plan\":" + Plan + "," +
            "\"release\":{\"p\":{\"x\":0,\"y\":2,\"z\":-8.69},\"seamDeg\":0," +
            "\"speedKph\":130,\"spinRps\":10,\"v\":{\"x\":0,\"y\":-1,\"z\":35}}," +
            "\"samples\":[{\"p\":{\"x\":0,\"y\":2,\"z\":-8.69},\"t\":0," +
            "\"v\":{\"x\":0,\"y\":-1,\"z\":35}},{\"p\":{\"x\":0,\"y\":0.5,\"z\":9}," +
            "\"t\":0.5,\"v\":{\"x\":0,\"y\":0,\"z\":35}}]," +
            "\"seam\":{\"axis\":{\"x\":0,\"y\":1,\"z\":0},\"shine\":{\"x\":1,\"y\":0,\"z\":0}," +
            "\"wobble\":0},\"seed\":\"seed\"," +
            "\"spin\":{\"afterBounce\":null,\"release\":{\"x\":0,\"y\":1,\"z\":0}}," +
            "\"stumpsT\":0.5,\"version\":3,\"wouldHitStumps\":true}";

        private const string InitializePayload =
            "{\"assistance\":\"learn\",\"audio\":true,\"captions\":true," +
            "\"coordinateSystem\":\"vande-striker-frame-v1\",\"deviceTier\":\"full\"," +
            "\"handedness\":\"right\",\"handednessPolicy\":" +
            "\"physics-right-handed-presentation-mirrors-once\",\"haptics\":true," +
            "\"highContrast\":false,\"locale\":\"en-IN\",\"pixelsPerDp\":1,\"quality\":\"standard\"," +
            "\"reducedMotion\":false,\"textScale\":1}";

        private static string FieldPayload()
        {
            var fielders = new StringBuilder("[");
            for (var index = 0; index < Roles.Length; index++)
            {
                if (index > 0) fielders.Append(',');
                fielders.Append("{\"id\":\"fielder-").Append(index)
                    .Append("\",\"role\":\"").Append(Roles[index])
                    .Append("\",\"x\":").Append(index - 5)
                    .Append(",\"z\":").Append(index * 2).Append('}');
            }
            fielders.Append(']');
            return "{\"fielders\":" + fielders + ",\"id\":\"test-field\"}";
        }

        private static string FielderPaths()
        {
            var paths = new StringBuilder("[");
            for (var index = 0; index < Roles.Length; index++)
            {
                if (index > 0) paths.Append(',');
                paths.Append("{\"fielderId\":\"fielder-").Append(index)
                    .Append("\",\"samples\":[{\"action\":\"idle\",\"t\":0,\"x\":")
                    .Append(index - 5).Append(",\"z\":").Append(index * 2)
                    .Append("},{\"action\":\"idle\",\"t\":0.1,\"x\":")
                    .Append(index - 5).Append(",\"z\":").Append(index * 2).Append("}]}");
            }
            return paths.Append(']').ToString();
        }

        private static string ScenePayload(string lookSeed = "look")
        {
            return "{\"ball\":" + Ball + ",\"batterPosition\":{\"creaseOffsetM\":0,\"guard\":\"middle\",\"lateralM\":0}," +
                   "\"bowler\":" + Bowler.Replace("\"look\"", WireKit.Q(lookSeed)) + ",\"conditions\":\"balanced\",\"field\":" + FieldPayload() +
                   ",\"fieldIntent\":\"attack_the_stumps\",\"handedness\":\"right\",\"trainingObjective\":\"random\"}";
        }

        private static string DeliveryPayload()
        {
            return "{\"ballIndex\":0,\"flight\":" + Flight + ",\"overIndex\":0,\"plan\":" + Plan +
                   ",\"presentation\":{\"coach\":null,\"learnCue\":false},\"seed\":\"seed\"}";
        }

        private const string SwingPayload =
            "{\"directionDeg\":10,\"elevation\":0.1,\"footwork\":\"auto\",\"kind\":\"attack\",\"power\":0.5,\"startT\":0.3}";

        private static string ResultResolution(bool withBat = false)
        {
            const string ballTrace =
                "[{\"p\":{\"x\":0,\"y\":2,\"z\":-8},\"t\":0,\"v\":{\"x\":0,\"y\":-1,\"z\":35}}," +
                "{\"p\":{\"x\":0,\"y\":0.4,\"z\":9},\"t\":0.1,\"v\":{\"x\":0,\"y\":0,\"z\":20}}]";
            const string contact =
                "{\"batSpeedKph\":null,\"bladeU\":null,\"exitBearingDeg\":null," +
                "\"exitElevationDeg\":null,\"exitSpeedKph\":null,\"faceBearingDeg\":null," +
                "\"intendedBearingDeg\":null,\"kind\":\"leave\",\"point\":null,\"t\":null," +
                "\"timing\":\"none\",\"timingErrorMs\":null}";
            const string coaching =
                "{\"fielderRole\":null,\"lbw\":null,\"reason\":\"left_well\",\"timing\":null,\"zone\":null}";
            const string outcome =
                "{\"boundary\":null,\"dismissal\":null,\"endBearingDeg\":null,\"endDistanceM\":null," +
                "\"fielderId\":null,\"region\":null,\"runs\":0}";
            var record = "{\"assist\":\"learn\",\"ball\":" + Ball + ",\"ballIndex\":0,\"bowler\":" + Bowler +
                         ",\"conditions\":\"balanced\",\"dismissal\":null,\"field\":" + FieldPayload() +
                         ",\"handedness\":\"right\",\"overIndex\":0,\"plan\":" + Plan + ",\"runs\":0," +
                         "\"seed\":\"seed\",\"swing\":null,\"tierToleranceMs\":0,\"version\":3}";
            var bat = withBat
                ? "[{\"face\":{\"x\":0,\"y\":0,\"z\":1},\"grip\":{\"x\":0,\"y\":1,\"z\":9.1},\"t\":0,\"toe\":{\"x\":0,\"y\":0.14,\"z\":9.1}}," +
                  "{\"face\":{\"x\":0,\"y\":0,\"z\":1},\"grip\":{\"x\":0.1,\"y\":1,\"z\":9.1},\"t\":0.025,\"toe\":{\"x\":0.1,\"y\":0.14,\"z\":9.1}}," +
                  "{\"face\":{\"x\":0,\"y\":0,\"z\":1},\"grip\":{\"x\":0.2,\"y\":1,\"z\":9.1},\"t\":0.05,\"toe\":{\"x\":0.2,\"y\":0.14,\"z\":9.1}}," +
                  "{\"face\":{\"x\":0,\"y\":0,\"z\":1},\"grip\":{\"x\":0.2,\"y\":1,\"z\":9.1},\"t\":0.1,\"toe\":{\"x\":0.2,\"y\":0.14,\"z\":9.1}}]"
                : "[]";
            var motion = withBat ? "{\"contactT\":0.025,\"endT\":0.05,\"startT\":0}" : "null";
            var result = "{\"ball\":" + ballTrace + ",\"bat\":" + bat +
                         ",\"batterBodyFrame\":{\"headCentre\":{\"x\":-0.2,\"y\":1.62,\"z\":8.86}," +
                         "\"stance\":{\"x\":-0.15,\"z\":8.96},\"torsoTop\":{\"x\":-0.3,\"y\":1.42,\"z\":8.94}}," +
                         "\"batterMotion\":" + motion + ",\"batterPosture\":{\"crouchM\":0},\"batterRootOffset\":{\"x\":0,\"z\":0}," +
                         "\"coaching\":" + coaching + ",\"contact\":" + contact + ",\"deadT\":0.1," +
                         "\"events\":[{\"kind\":\"release\",\"t\":0},{\"kind\":\"dead\",\"t\":0.1}]," +
                         "\"fielders\":" + FielderPaths() + ",\"flight\":" + Flight + ",\"footwork\":\"forward\"," +
                         "\"lbw\":null,\"outcome\":" + outcome + ",\"swing\":null,\"version\":3}";
            const string score = "{\"balls\":1,\"maxOvers\":10,\"runs\":0,\"wickets\":0}";
            var digest = WireKit.ReplayDigest(record, result);
            return "{\"record\":" + record + ",\"replayDigest\":\"" + digest + "\",\"result\":" + result + ",\"score\":" + score + "}";
        }

        private static string DeadBallUi(bool coach)
        {
            return coach
                ? "{\"primaryAction\":\"practice_ball\",\"primaryLabel\":\"Practice this ball\",\"reason\":\"Reading the ball\"," +
                  "\"recommendation\":\"Watch the seam\",\"replayDigest\":\"" + Digest64 + "\",\"secondaryAction\":\"next_ball\"," +
                  "\"secondaryLabel\":\"Next ball\"}"
                : "{\"primaryAction\":\"next_ball\",\"primaryLabel\":\"Next ball\",\"reason\":\"Reading the ball\"," +
                  "\"recommendation\":\"\",\"replayDigest\":\"" + Digest64 + "\",\"secondaryAction\":null,\"secondaryLabel\":null}";
        }

        /// <summary>Every message type the contract carries, each with a small valid payload (name, type, sender, deliveryId, payload).</summary>
        private static List<string[]> SyntheticMessages()
        {
            var list = new List<string[]>();
            Action<string, string, string, string> host = (name, type, delivery, payload) =>
                list.Add(new[] { name, type, "host", delivery, payload });
            Action<string, string, string, string> unity = (name, type, delivery, payload) =>
                list.Add(new[] { name, type, "unity", delivery, payload });
            host("host-initialize", "host.initialize", null, InitializePayload);
            host("host-scene", "host.scene", null, ScenePayload());
            host("host-delivery", "host.delivery", "delivery-1", DeliveryPayload());
            host("host-provisional-swing", "host.provisional_swing", "delivery-1",
                "{\"atPerfMs\":1000.5,\"calibrationMs\":2,\"swing\":" + SwingPayload + "}");
            host("host-result", "host.result", "delivery-1", ResultResolution());
            host("host-result-bat", "host.result", "delivery-1", ResultResolution(true));
            host("host-dead-ball-ui-coach", "host.dead_ball_ui", "delivery-1", DeadBallUi(true));
            host("host-dead-ball-ui-next", "host.dead_ball_ui", "delivery-1", DeadBallUi(false));
            host("host-replay", "host.replay", "delivery-1", "{\"diagnostics\":false,\"resolution\":" + ResultResolution() + ",\"speed\":1}");
            host("host-replay-bat", "host.replay", "delivery-1", "{\"diagnostics\":true,\"resolution\":" + ResultResolution(true) + ",\"speed\":0.5}");
            host("host-demonstration", "host.demonstration", "demo-1",
                "{\"delivery\":" + DeliveryPayload() + ",\"resolution\":" + ResultResolution() + ",\"speed\":1}");
            host("host-demonstration-cancel", "host.demonstration_cancel", "demo-1", "{}");
            host("host-profile", "host.profile", null, "{\"quality\":\"high\"}");
            host("host-locale", "host.locale", null, "{\"locale\":\"en-IN\"}");
            host("host-benchmark", "host.benchmark", null,
                "{\"benchmarkId\":\"bench-1\",\"durationMs\":2000,\"quality\":\"standard\",\"sampleCap\":600,\"warmupFrames\":30}");
            host("host-clock-sync", "host.clock_sync", null, "{\"hostSendPerfMs\":12.5,\"sampleId\":\"s1\"}");
            host("host-clock-selected", "host.clock_selected", null, "{\"sampleId\":\"s1\"}");
            host("host-pause", "host.pause", null, "{\"reason\":\"player\"}");
            host("host-resume", "host.resume", null, "{\"reason\":\"foreground\"}");
            host("host-dispose", "host.dispose", null, "{\"reason\":\"complete\"}");
            host("bridge-ack-host", "bridge.ack", null, "{\"acknowledgedMessageId\":\"m-1\"}");
            unity("unity-ready", "unity.ready", null, "{\"renderer\":\"unity-practice-foundation\",\"unityVersion\":\"6000.3.27f1\"}");
            unity("unity-clock-sync", "unity.clock_sync", null,
                "{\"hostSendPerfMs\":12.5,\"sampleId\":\"s1\",\"unityReceiveMs\":100,\"unitySendMs\":101}");
            unity("unity-release", "unity.release", "delivery-1", "{\"clockSampleId\":\"s1\",\"releaseUnityMs\":123.5}");
            unity("unity-pointer", "unity.pointer", "delivery-1",
                "{\"atUnityMs\":123.5,\"clockSampleId\":\"s1\",\"phase\":\"down\",\"pointer\":\"touch\"}");
            unity("unity-gesture", "unity.gesture", "delivery-1",
                "{\"clockSampleId\":\"s1\",\"input\":{\"pointer\":\"touch\",\"samples\":[{\"t\":0,\"x\":10,\"y\":20},{\"t\":16,\"x\":12,\"y\":30}]," +
                "\"surface\":{\"height\":800,\"width\":400}},\"retention\":\"memory-until-resolution\"}");
            unity("unity-dead", "unity.dead", "delivery-1", "{\"deadT\":1.115,\"replayDigest\":\"" + Digest64 + "\"}");
            unity("unity-stats", "unity.stats", null,
                "{\"avgFrameMs\":16.6,\"fps\":60,\"inputToVisibleBatMs\":null,\"memoryMb\":null,\"p95FrameMs\":17,\"p99FrameMs\":18," +
                "\"quality\":\"standard\",\"sampleCount\":100,\"spikes\":2,\"thermalState\":\"nominal\",\"worstFrameMs\":30}");
            unity("unity-benchmark", "unity.benchmark", null,
                "{\"benchmarkId\":\"bench-1\",\"frameIntervalsMs\":[16.6,16.7,33.4],\"graphics\":{\"api\":\"Metal\",\"contextGeneration\":null," +
                "\"contextLosses\":null,\"device\":\"Apple M1\"},\"memoryMb\":null,\"quality\":\"standard\",\"thermalState\":\"nominal\"," +
                "\"warmup\":{\"durationMs\":100,\"frames\":30,\"shaderWarmupCompleted\":true,\"shaderWarmupMs\":null}}");
            unity("unity-pause-request", "unity.pause_request", null, "{\"reason\":\"player\"}");
            unity("unity-dead-ball-action", "unity.dead_ball_action", "delivery-1",
                "{\"action\":\"next_ball\",\"replayDigest\":\"" + Digest64 + "\"}");
            unity("unity-protected-regions", "unity.protected_regions", "delivery-1",
                "{\"regions\":[{\"height\":50,\"kind\":\"pitch\",\"width\":100,\"x\":10,\"y\":20}],\"viewportHeight\":800,\"viewportWidth\":400}");
            unity("unity-quiet", "unity.quiet", null, "{\"quiet\":true}");
            unity("unity-unloaded", "unity.unloaded", null, "{\"retainedMemoryMb\":null}");
            unity("unity-error", "unity.error", null,
                "{\"code\":\"integrity\",\"detail\":\"bad\",\"fallback\":\"classic\",\"recoverable\":false}");
            unity("bridge-ack-unity", "bridge.ack", null, "{\"acknowledgedMessageId\":\"m-1\"}");
            return list;
        }

        private static string MessageBody(string[] message, long sequence = 7)
        {
            return WireKit.Body(message[1], sequence, message[3], message[4], message[2]);
        }

        // ---------------------------------------------------------------- the corpus

        public static List<OracleCase> BuildPacketCases(IList<OracleBase> real)
        {
            var cases = new List<OracleCase>();
            var byName = new Dictionary<string, OracleBase>();
            foreach (var item in real) byName[item.Name] = item;
            Action<string, Func<string>> add = (id, make) => cases.Add(new OracleCase { Id = id, Make = make });

            // ---- 1. Valid baselines: the 28 real golden packets as JsonUtility writes them, and the 36 synthetic messages.
            foreach (var item in real)
            {
                var captured = item;
                add("real/" + captured.Name, () => WireKit.SealWithSha(captured.Body, captured.Sha256));
            }
            var synthetic = SyntheticMessages();
            foreach (var message in synthetic)
            {
                var captured = message;
                add("synthetic/" + captured[0], () => WireKit.Seal(MessageBody(captured)));
            }
            foreach (var message in synthetic)
            {
                var captured = message;
                add("synthetic-bodyfirst/" + captured[0], () => WireKit.SealBodyFirst(MessageBody(captured)));
            }

            // ---- 2. Outer packet shape: whitespace, key order, member set, member types, non-objects, trailing data.
            var pause = SyntheticMessages().Find(m => m[0] == "host-pause");
            Func<string> pauseBody = () => MessageBody(pause);
            Func<string> pausePacket = () => WireKit.Seal(pauseBody());
            Action<string, Func<string, string>> outer = (id, edit) => add("outer/" + id, () => edit(pausePacket()));
            outer("ws-leading", p => " " + p);
            outer("newline-leading", p => "\n" + p);
            outer("tab-trailing", p => p + "\t");
            outer("cr-trailing", p => p + "\r");
            outer("bom-leading", p => "\uFEFF" + p);
            outer("nul-leading", p => "\0" + p);
            outer("ws-inside-after-brace", p => p.Replace("{\"sha256\"", "{ \"sha256\""));
            outer("ws-around-colons", p => p.Replace("\":\"", "\" : \""));
            outer("ws-around-comma", p => p.Replace("\",\"body\"", "\" ,\n\t\"body\""));
            outer("ws-before-close", p => p.Substring(0, p.Length - 1) + " \r\n}");
            outer("key-order-swapped", p => WireKit.SealBodyFirst(pauseBody()));
            outer("missing-sha256", p => "{\"body\":\"" + WireKit.Escape(pauseBody()) + "\"}");
            outer("missing-body", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\"}");
            outer("extra-member-end", p => p.Substring(0, p.Length - 1) + ",\"x\":1}");
            outer("extra-member-start", p => "{\"a\":1," + p.Substring(1));
            outer("extra-member-null", p => p.Substring(0, p.Length - 1) + ",\"nonce\":null}");
            outer("duplicate-sha256", p => p.Substring(0, p.Length - 1) + ",\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\"}");
            outer("duplicate-body", p => p.Substring(0, p.Length - 1) + ",\"body\":\"{}\"}");
            outer("body-number", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":5}");
            outer("body-null", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":null}");
            outer("body-true", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":true}");
            outer("body-array", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":[]}");
            outer("body-object", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":" + pauseBody() + "}");
            outer("body-empty-string", p => "{\"sha256\":\"" + WireKit.Sha256Hex("") + "\",\"body\":\"\"}");
            outer("sha-number", p => "{\"sha256\":5,\"body\":\"" + WireKit.Escape(pauseBody()) + "\"}");
            outer("sha-null", p => "{\"sha256\":null,\"body\":\"" + WireKit.Escape(pauseBody()) + "\"}");
            outer("sha-empty", p => WireKit.SealWithSha(pauseBody(), ""));
            outer("sha-uppercase", p => WireKit.SealWithSha(pauseBody(), WireKit.Sha256Hex(pauseBody()).ToUpperInvariant()));
            outer("sha-63", p => WireKit.SealWithSha(pauseBody(), WireKit.Sha256Hex(pauseBody()).Substring(1)));
            outer("sha-65", p => WireKit.SealWithSha(pauseBody(), WireKit.Sha256Hex(pauseBody()) + "0"));
            outer("sha-nonhex", p => WireKit.SealWithSha(pauseBody(), "g" + WireKit.Sha256Hex(pauseBody()).Substring(1)));
            outer("sha-wrong-body-tamper", p => WireKit.SealWithSha(pauseBody(), WireKit.Sha256Hex(pauseBody() + " ")));
            outer("sha-zeros", p => WireKit.SealWithSha(pauseBody(), new string('0', 64)));
            outer("sha-escaped-hex", p => p.Replace("\"sha256\":\"0", "\"sha256\":\"\\u0030").Replace("\"sha256\":\"1", "\"sha256\":\"\\u0031"));
            outer("empty-object", p => "{}");
            outer("empty-array", p => "[]");
            outer("null-literal", p => "null");
            outer("string-literal", p => "\"{}\"");
            outer("number-literal", p => "123");
            outer("empty-text", p => string.Empty);
            outer("space-only", p => "   ");
            outer("open-brace-only", p => "{");
            outer("close-brace-only", p => "}");
            outer("trailing-garbage", p => p + "x");
            outer("trailing-second-object", p => p + p);
            outer("trailing-comma", p => p.Substring(0, p.Length - 1) + ",}");
            outer("leading-comma", p => "{," + p.Substring(1));
            outer("unquoted-key", p => p.Replace("\"body\"", "body"));
            outer("single-quoted", p => p.Replace('"', '\''));
            outer("key-escaped-body", p => p.Replace("\"body\"", "\"\\u0062ody\""));
            outer("key-escaped-sha", p => p.Replace("\"sha256\"", "\"sha\\u0032\\u0035\\u0036\""));
            outer("key-case", p => p.Replace("\"body\"", "\"Body\""));
            outer("body-escapes-unicode-quote", p => p.Replace("\\\"", "\\u0022"));
            outer("body-escapes-uppercase-hex", p => p.Replace("\\\"", "\\u0022").Replace("\\u0022p", "\\u0022\\u0050"));
            outer("body-escape-solidus", p => p.Replace("host-7", "host\\/7"));
            outer("body-escape-letter", p => p.Replace("host-7", "h\\u006fst-7"));
            outer("body-escape-bad-x", p => p.Replace("host-7", "host\\x7"));
            outer("body-escape-bad-u-short", p => p.Replace("host-7", "host\\u12"));
            outer("body-escape-bad-u-hex", p => p.Replace("host-7", "host\\u12G4"));
            outer("body-escape-eof", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":\"abc\\");
            outer("body-unterminated", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":\"abc");
            outer("body-raw-newline", p => p.Replace("host-7", "host\n7"));
            outer("body-raw-tab", p => p.Replace("host-7", "host\t7"));
            outer("body-raw-nul", p => p.Replace("host-7", "host\u00007"));
            outer("body-raw-del", p => p.Replace("host-7", "host\u007f7"));
            outer("body-raw-unicode", p => p.Replace("host-7", "host-\u00e9"));
            outer("body-lone-surrogate-escape", p => p.Replace("host-7", "host-\\ud800"));
            outer("body-pair-escape", p => p.Replace("host-7", "host-\\ud83d\\ude00"));
            outer("body-literal-emoji", p => p.Replace("host-7", "host-\ud83d\ude00"));
            outer("body-literal-lone-high", p => p.Replace("host-7", "host-\ud800"));
            outer("body-literal-lone-low", p => p.Replace("host-7", "host-\udc00"));
            outer("body-line-separator", p => p.Replace("host-7", "host-\u2028"));
            outer("nesting-brackets-in-sha", p => p.Replace("\"sha256\":\"", "\"sha256\":[\""));
            outer("nested-object-member", p => "{\"sha256\":\"" + WireKit.Sha256Hex(pauseBody()) + "\",\"body\":{\"a\":{\"b\":[1,2,{}]}}}");
            outer("deep-nesting-64", p => "{\"sha256\":\"x\",\"body\":" + new string('[', 63) + new string(']', 63) + "}");
            outer("deep-nesting-65", p => "{\"sha256\":\"x\",\"body\":" + new string('[', 64) + new string(']', 64) + "}");
            outer("deep-nesting-66", p => "{\"sha256\":\"x\",\"body\":" + new string('[', 65) + new string(']', 65) + "}");
            outer("deep-nesting-objects", p => "{\"sha256\":\"x\",\"body\":" + Repeat("{\"a\":", 70) + "1" + new string('}', 70) + "}");

            // ---- 3. Truncation at many offsets: a small packet at 64 offsets, the biggest real packets at a dozen each.
            var smallPacket = WireKit.Seal(MessageBody(synthetic.Find(m => m[0] == "host-initialize")));
            for (var step = 0; step < 64; step++)
            {
                var offset = (int)((long)smallPacket.Length * step / 64);
                var cut = offset;
                add("truncate/small-" + cut, () => WireKit.Seal(MessageBody(synthetic.Find(m => m[0] == "host-initialize"))).Substring(0, cut));
            }
            foreach (var name in new[] { "thin-edge.result", "defensive-tap.replay", "early-attack.delivery" })
            {
                var captured = byName[name];
                var length = WireKit.SealWithSha(captured.Body, captured.Sha256).Length;
                foreach (var cut in new[] { 0, 1, 11, 12, 40, 75, 76, 77, 150, length / 4, length / 2, length - 100, length - 3, length - 2, length - 1 })
                {
                    var at = cut;
                    add("truncate/" + name + "-" + at, () => WireKit.SealWithSha(captured.Body, captured.Sha256).Substring(0, at));
                }
            }
            // The body cut at many offsets and re-sealed: the integrity check passes, so the canonical parse sees the cut.
            var smallBody = MessageBody(synthetic.Find(m => m[0] == "host-scene"));
            for (var step = 1; step < 48; step++)
            {
                var cut = (int)((long)smallBody.Length * step / 48);
                add("truncate-body/scene-" + cut, () => WireKit.Seal(MessageBody(synthetic.Find(m => m[0] == "host-scene")).Substring(0, cut)));
            }
            foreach (var name in new[] { "thin-edge.result", "grounded-attack.delivery" })
            {
                var captured = byName[name];
                foreach (var fraction in new[] { 0.01, 0.1, 0.33, 0.5, 0.75, 0.9, 0.99, 0.9999 })
                {
                    var cut = (int)(captured.Body.Length * fraction);
                    add("truncate-body/" + name + "-" + cut, () => WireKit.Seal(captured.Body.Substring(0, cut)));
                }
            }

            // ---- 4. Envelope fields: removed, duplicated, retyped, reordered, extra, and edge values (all re-sealed).
            var envelopeFields = new[]
            {
                "buildId", "contractVersion", "deliveryId", "messageId", "payload", "sender", "sequence", "sessionId", "simVersion", "type"
            };
            var sceneMessage = synthetic.Find(m => m[0] == "host-profile");
            Func<string> profileBody = () => MessageBody(sceneMessage);
            foreach (var field in envelopeFields)
            {
                var name = field;
                add("envelope/remove-" + name, () => WireKit.Seal(WireKit.RemoveMember(profileBody(), name)));
                add("envelope/duplicate-" + name, () =>
                {
                    var body = profileBody();
                    int start, end;
                    WireKit.Span(body, out start, out end, name);
                    var keyStart = body.LastIndexOf("\"" + name + "\":", start, StringComparison.Ordinal);
                    var member = body.Substring(keyStart, end - keyStart);
                    return WireKit.Seal(WireKit.Replace(body, end, end, "," + member));
                });
                foreach (var replacement in new[] { "null", "5", "\"x\"", "true", "[]", "{}", "1.5", "-1", "\"\"" })
                {
                    var value = replacement;
                    add("envelope/" + name + "=" + value, () => WireKit.Seal(WireKit.SetValue(profileBody(), value, name)));
                }
            }
            for (var index = 0; index + 1 < envelopeFields.Length; index++)
            {
                var first = envelopeFields[index];
                var second = envelopeFields[index + 1];
                add("envelope/swap-" + first + "-" + second, () =>
                {
                    var body = profileBody();
                    int s1, e1, s2, e2;
                    WireKit.Span(body, out s1, out e1, first);
                    WireKit.Span(body, out s2, out e2, second);
                    var k1 = body.LastIndexOf("\"" + first + "\":", s1, StringComparison.Ordinal);
                    var k2 = body.LastIndexOf("\"" + second + "\":", s2, StringComparison.Ordinal);
                    return WireKit.Seal(body.Substring(0, k1) + body.Substring(k2, e2 - k2) + "," + body.Substring(k1, e1 - k1) + body.Substring(e2));
                });
            }
            foreach (var extra in new[] { "\"aa\":1,", "\"payload0\":1,", "\"zz\":1," })
            {
                var member = extra;
                add("envelope/extra-" + member.Trim(',', '"', ':', '1'), () =>
                {
                    var body = profileBody();
                    if (member.StartsWith("\"zz", StringComparison.Ordinal)) return WireKit.Seal(body.Substring(0, body.Length - 1) + ",\"zz\":1}");
                    if (member.StartsWith("\"payload0", StringComparison.Ordinal)) return WireKit.Seal(body.Replace("\"payload\":", member + "\"payload\":"));
                    return WireKit.Seal("{" + member + body.Substring(1));
                });
            }
            foreach (var spelling in new[]
            {
                "5", "7", "6.0", "6.5", "\"6\"", "-6", "0", "2147483648", "4294967302", "1e0", "9007199254740991", "6e0", "06"
            })
            {
                var value = spelling;
                add("envelope/contractVersion~" + value, () => WireKit.Seal(WireKit.SetValue(profileBody(), value, "contractVersion")));
                add("envelope/simVersion~" + value, () => WireKit.Seal(WireKit.SetValue(profileBody(), value, "simVersion")));
            }
            foreach (var spelling in new[]
            {
                "0", "1", "-1", "9007199254740991", "9007199254740992", "9007199254740993", "1.5", "1e3", "1.0", "-0", "\"7\"", "99999999999999999999", "01"
            })
            {
                var value = spelling;
                add("envelope/sequence~" + value, () => WireKit.Seal(WireKit.SetValue(profileBody(), value, "sequence")));
            }
            foreach (var field in new[] { "buildId", "sessionId", "messageId", "deliveryId" })
            {
                var name = field;
                foreach (var text in new[]
                {
                    "", new string('a', 256), new string('a', 257), "a\\u0001b", "a\\u007fb", "caf\u00e9", "\u65e5\u672c", "e\ud83d\ude00", "a\ud800b", "a\\\"b", "a\\\\b", " ", "a b", "\u2028", "tab\\tinside"
                })
                {
                    var literal = "\"" + text + "\"";
                    add("envelope/" + name + "~" + (text.Length > 12 ? text.Length + "chars" : Printable(text)), () => WireKit.Seal(WireKit.SetValue(profileBody(), literal, name)));
                }
            }
            foreach (var sender in new[] { "host", "unity", "", "Host", "server", "hos" })
            {
                var value = sender;
                add("envelope/sender~" + value, () => WireKit.Seal(WireKit.SetValue(profileBody(), "\"" + value + "\"", "sender")));
            }
            foreach (var type in new[] { "host.profile", "host.unknown", "", "unity.quiet", "bridge.ack", "host.pause", "Host.profile", "host.profile ", "unity.profile" })
            {
                var value = type;
                add("envelope/type~" + value, () => WireKit.Seal(WireKit.SetValue(profileBody(), "\"" + value + "\"", "type")));
            }
            foreach (var message in synthetic)
            {
                var captured = message;
                add("envelope/deliveryId-null/" + captured[0], () => WireKit.Seal(WireKit.SetValue(MessageBody(captured), "null", "deliveryId")));
                add("envelope/deliveryId-set/" + captured[0], () => WireKit.Seal(WireKit.SetValue(MessageBody(captured), "\"d-1\"", "deliveryId")));
                add("envelope/wrong-sender/" + captured[0], () => WireKit.Seal(WireKit.SetValue(MessageBody(captured), captured[2] == "host" ? "\"unity\"" : "\"host\"", "sender")));
                add("envelope/empty-payload/" + captured[0], () => WireKit.Seal(WireKit.SetValue(MessageBody(captured), "{}", "payload")));
                add("envelope/null-payload/" + captured[0], () => WireKit.Seal(WireKit.SetValue(MessageBody(captured), "null", "payload")));
            }
            // A payload that belongs to a different type.
            for (var index = 0; index < synthetic.Count; index += 3)
            {
                var a = synthetic[index];
                var b = synthetic[(index + 7) % synthetic.Count];
                if (a[2] != b[2]) continue;
                add("envelope/payload-of/" + a[0] + "-as-" + b[0], () => WireKit.Seal(WireKit.Body(b[1], 7, b[3], a[4], b[2])));
            }

            // ---- 4b. Whitespace between the envelope's own tokens (the canonical scan lets it through; the body comparison must not), and
            // type confusion at the top-level members of every synthetic payload.
            foreach (var source in new[] { "synthetic", "real-scene" })
            {
                var origin = source;
                Func<string> envelopeBody = () => origin == "synthetic"
                    ? MessageBody(synthetic.Find(m => m[0] == "host-profile"))
                    : byName["defensive-tap.scene"].Body;
                var offsets = WireKit.EnvelopeStructure(envelopeBody());
                for (var index = 0; index < offsets.Count; index++)
                {
                    var at = offsets[index];
                    foreach (var gap in new[] { " ", "\t", "\n" })
                    {
                        var text = gap;
                        add("envelope-ws/" + origin + "-before-" + index + "-" + Printable(text), () => WireKit.Seal(envelopeBody().Substring(0, at) + text + envelopeBody().Substring(at)));
                        add("envelope-ws/" + origin + "-after-" + index + "-" + Printable(text), () => WireKit.Seal(envelopeBody().Substring(0, at + 1) + text + envelopeBody().Substring(at + 1)));
                    }
                }
            }

            foreach (var message in synthetic)
            {
                var captured = message;
                foreach (var member in WireKit.MemberNames(captured[4]))
                {
                    var name = member;
                    foreach (var confusion in new[] { "null", "5", "\"x\"" })
                    {
                        var value = confusion;
                        add("payload-member/" + captured[0] + "/" + name + "=" + value, () => WireKit.Seal(
                            WireKit.Body(captured[1], 7, captured[3], WireKit.SetValue(captured[4], value, name), captured[2])));
                    }
                }
            }

            // ---- 5. Canonical-form violations inside payloads (re-sealed so the integrity check passes).
            var delivery = synthetic.Find(m => m[0] == "host-delivery");
            Func<string> deliveryBody = () => MessageBody(delivery);
            Action<string, Func<string, string>> canon = (id, edit) => add("canonical/" + id, () => WireKit.Seal(edit(deliveryBody())));
            canon("space-after-colon", b => b.Replace("\"ballIndex\":0", "\"ballIndex\": 0"));
            canon("space-after-comma", b => b.Replace("\"ballIndex\":0,", "\"ballIndex\":0, "));
            canon("space-before-brace", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"seed\" }"));
            canon("newline-in-payload", b => b.Replace("\"overIndex\":0,", "\"overIndex\":0,\n"));
            canon("space-in-array", b => b.Replace("\"samples\":[{", "\"samples\":[ {"));
            canon("space-in-nested", b => b.Replace("\"p\":{\"x\":0,", "\"p\":{ \"x\":0,"));
            canon("trailing-space-body", b => b + " ");
            canon("leading-space-body", b => " " + b);
            canon("swap-plan-members", b => b.Replace("\"lengthM\":6,\"lineM\":0", "\"lineM\":0,\"lengthM\":6"));
            canon("swap-top-level", b => b.Replace("\"ballIndex\":0,\"flight\"", "\"flight\"").Replace("\"overIndex\":0,", "\"overIndex\":0,\"ballIndex\":0,"));
            canon("duplicate-nested-key", b => b.Replace("\"lineM\":0,", "\"lineM\":0,\"lineM\":0,"));
            canon("duplicate-nested-key-reversed", b => b.Replace("\"speedKph\":130,", "\"speedKph\":130,\"speedKph\":131,"));
            canon("unsorted-case", b => b.Replace("\"ballIndex\":0,\"flight\":", "\"flight\":").Replace(",\"overIndex\":0,", ",\"BallIndex\":0,\"overIndex\":0,"));
            canon("string-escape-solidus", b => b.Replace("\"variation\":\"stock\"", "\"variation\":\"sto\\/ck\""));
            canon("string-escape-unicode-letter", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"s\\u0065ed\"}"));
            canon("string-escape-control-upper", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u001Fed\"}"));
            canon("string-escape-control-lower", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u001fed\"}"));
            canon("string-escape-backspace-long", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u0008ed\"}"));
            canon("string-escape-backspace-short", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\bed\"}"));
            canon("string-escape-nul", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u0000ed\"}"));
            canon("string-escape-del", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u007fed\"}"));
            canon("string-del-literal", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\u007fed\"}"));
            canon("string-quote-escaped", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\\"ed\"}"));
            canon("string-quote-unicode", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u0022ed\"}"));
            canon("string-backslash", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\\\ed\"}"));
            canon("string-surrogate-pair-escaped", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\ud83d\\ude00\"}"));
            canon("string-surrogate-pair-literal", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\ud83d\ude00\"}"));
            canon("string-lone-surrogate-escaped", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\ud800\"}"));
            canon("string-lone-surrogate-literal", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\ud800\"}"));
            canon("string-raw-control", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\u0001ed\"}"));
            canon("string-raw-newline", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\ned\"}"));
            canon("string-unterminated", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"seed}"));
            canon("string-incomplete-escape", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"seed\\\"}"));
            canon("string-bad-escape", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\qed\"}"));
            canon("string-bad-unicode", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u00zzed\"}"));
            canon("string-short-unicode", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"se\\u00\"}"));
            canon("string-key-escaped", b => b.Replace("\"seed\":", "\"s\\u0065ed\":"));
            canon("literal-case-true", b => b.Replace("\"wouldHitStumps\":true", "\"wouldHitStumps\":True"));
            canon("literal-bad-null", b => b.Replace("\"bounce\":null", "\"bounce\":nul"));
            canon("literal-bad-false", b => b.Replace("\"wouldHitStumps\":true", "\"wouldHitStumps\":fals"));
            canon("array-trailing-comma", b => b.Replace("\"v\":{\"x\":0,\"y\":0,\"z\":35}}]", "\"v\":{\"x\":0,\"y\":0,\"z\":35}},]"));
            canon("array-leading-comma", b => b.Replace("\"samples\":[{", "\"samples\":[,{"));
            canon("object-trailing-comma", b => b.Replace("\"seed\":\"seed\"}", "\"seed\":\"seed\",}"));
            canon("object-missing-colon", b => b.Replace("\"ballIndex\":0", "\"ballIndex\"0"));
            canon("object-missing-value", b => b.Replace("\"ballIndex\":0,", "\"ballIndex\":,"));
            canon("object-key-not-string", b => b.Replace("\"ballIndex\":0", "ballIndex:0"));
            canon("object-bare-comma", b => b.Replace("\"ballIndex\":0,", "\"ballIndex\":0,,"));
            canon("array-unclosed", b => b.Replace("\"v\":{\"x\":0,\"y\":0,\"z\":35}}]", "\"v\":{\"x\":0,\"y\":0,\"z\":35}}"));
            canon("object-unclosed", b => b.Substring(0, b.Length - 2));
            canon("extra-closing", b => b.Substring(0, b.Length - 1) + "}}");
            // Nesting depth around the 64-level limit: a payload member nested n arrays deep.
            foreach (var depth in new[] { 40, 60, 61, 62, 63, 64, 65, 66, 80, 200 })
            {
                var levels = depth;
                canon("depth-array-" + levels, b => b.Replace("\"seed\":\"seed\"}", "\"seed\":" + new string('[', levels) + new string(']', levels) + "}"));
                canon("depth-object-" + levels, b => b.Replace("\"seed\":\"seed\"}", "\"seed\":" + Repeat("{\"a\":", levels) + "1" + new string('}', levels) + "}"));
            }

            // ---- 6. Number tokens at a place the contract leaves free (flight.release.seamDeg), accepted or rejected.
            foreach (var token in NumberTokens())
            {
                var literal = token;
                add("number/seamDeg=" + literal, () => WireKit.Seal(WireKit.SetValue(deliveryBody(), literal, "payload", "flight", "release", "seamDeg")));
            }
            foreach (var token in new[]
            {
                "1000000", "999999.9999999999", "1000000.0000000001", "-1000000", "-1000001", "1e+21", "1.7976931348623157e+308", "5e-324", "0.000001", "0.0000011"
            })
            {
                var literal = token;
                add("number/x-domain=" + literal, () => WireKit.Seal(WireKit.SetValue(deliveryBody(), literal, "payload", "flight", "release", "p", "x")));
            }
            foreach (var token in new[] { "0", "30", "30.0000000000000001", "0.1", "-0", "1e1", "30.000000000000004", "30.00000000000001", "-1", "1.0" })
            {
                var literal = token;
                add("number/traceTime=" + literal, () => WireKit.Seal(WireKit.SetValue(deliveryBody(), literal, "payload", "flight", "idealContactT")));
            }
            // String values at a free spot (bowler.lookSeed of a scene), canonical or not.
            foreach (var text in new[]
            {
                "x", "caf\u00e9", "\u65e5\u672c\u8a9e", "e\ud83d\ude00", "\ud800", "\udc00", "\u2028\u2029", "\ufeff", "\u007f", "a\\\"b", "a\\\\b", "a\\n", "a\\u0001",
                "a\\u001f", "\\u0000", "tab\\t", "a/b", "{}[],:", "\\\"\\\"\\\"", new string('x', 5000), new string('\u00e9', 5000)
            })
            {
                var value = text;
                add("string/lookSeed=" + (value.Length > 10 ? "len" + value.Length : Printable(value)), () => WireKit.Seal(
                    WireKit.Body("host.scene", 7, null, ScenePayload(UnescapeForLookSeed(value)))));
            }

            // ---- 7. Real result packets: semantic mutations, each with the replay digest recomputed so the claim is valid.
            Action<string, string, Func<string, string>> resolution = (name, id, edit) =>
            {
                var captured = byName[name];
                var replay = name.EndsWith(".replay", StringComparison.Ordinal);
                add("real-mutation/" + name + "/" + id, () =>
                {
                    var edited = edit(captured.Body);
                    return WireKit.Seal(WireKit.ResealResolution(edited, replay ? new[] { "resolution" } : new string[0]));
                });
            };
            foreach (var name in new[] { "defensive-tap.result", "thin-edge.result", "grounded-attack.replay" })
            {
                var replay = name.EndsWith(".replay", StringComparison.Ordinal);
                var prefix = replay ? new[] { "payload", "resolution" } : new[] { "payload" };
                Func<string[], string[]> at = tail => Concat(prefix, tail);
                resolution(name, "untouched-resealed", b => b);
                resolution(name, "record.runs=6", b => WireKit.SetValue(b, "6", at(new[] { "record", "runs" })));
                resolution(name, "record.runs=5", b => WireKit.SetValue(b, "5", at(new[] { "record", "runs" })));
                resolution(name, "outcome.runs=3", b => WireKit.SetValue(b, "3", at(new[] { "result", "outcome", "runs" })));
                resolution(name, "outcome.runs=5", b => WireKit.SetValue(b, "5", at(new[] { "result", "outcome", "runs" })));
                resolution(name, "score.balls=0", b => WireKit.SetValue(b, "0", at(new[] { "score", "balls" })));
                resolution(name, "score.balls=61", b => WireKit.SetValue(b, "61", at(new[] { "score", "balls" })));
                resolution(name, "score.wickets=1", b => WireKit.SetValue(b, "1", at(new[] { "score", "wickets" })));
                resolution(name, "score.maxOvers=9", b => WireKit.SetValue(b, "9", at(new[] { "score", "maxOvers" })));
                resolution(name, "result.deadT=0", b => WireKit.SetValue(b, "0", at(new[] { "result", "deadT" })));
                resolution(name, "result.deadT=31", b => WireKit.SetValue(b, "31", at(new[] { "result", "deadT" })));
                resolution(name, "result.footwork=sideways", b => WireKit.SetValue(b, "\"sideways\"", at(new[] { "result", "footwork" })));
                resolution(name, "contact.kind=teleport", b => WireKit.SetValue(b, "\"teleport\"", at(new[] { "result", "contact", "kind" })));
                resolution(name, "contact.timing=never", b => WireKit.SetValue(b, "\"never\"", at(new[] { "result", "contact", "timing" })));
                resolution(name, "coaching.reason=nope", b => WireKit.SetValue(b, "\"nope\"", at(new[] { "result", "coaching", "reason" })));
                resolution(name, "batterRootOffset.x=0.2", b => WireKit.SetValue(b, "0.2", at(new[] { "result", "batterRootOffset", "x" })));
                resolution(name, "batterPosture.crouchM=-0.01", b => WireKit.SetValue(b, "-0.01", at(new[] { "result", "batterPosture", "crouchM" })));
                resolution(name, "batterBodyFrame.head.y=5", b => WireKit.SetValue(b, "5", at(new[] { "result", "batterBodyFrame", "headCentre", "y" })));
                resolution(name, "batterBodyFrame.stance.z=4", b => WireKit.SetValue(b, "4", at(new[] { "result", "batterBodyFrame", "stance", "z" })));
                resolution(name, "batterMotion=null", b => WireKit.SetValue(b, "null", at(new[] { "result", "batterMotion" })));
                resolution(name, "batterMotion.endT=9", b => WireKit.SetValue(b, "9", at(new[] { "result", "batterMotion", "endT" })));
                resolution(name, "events=[]", b => WireKit.SetValue(b, "[]", at(new[] { "result", "events" })));
                resolution(name, "events-first-kind", b => SetNth(b, at(new[] { "result", "events" }), "\"kind\":\"release\"", 0, "\"kind\":\"warp\""));
                resolution(name, "events-first-t=1", b => SetNth(b, at(new[] { "result", "events" }), "\"t\":0}", 0, "\"t\":1}"));
                resolution(name, "bat=[]", b => WireKit.SetValue(b, "[]", at(new[] { "result", "bat" })));
                resolution(name, "bat-first-t-equal", b => SetNth(b, at(new[] { "result", "bat" }), "\"t\":", 1, "\"t\":0.0"));
                resolution(name, "bat-grip-x-shift", b => SetNth(b, at(new[] { "result", "bat" }), "\"grip\":{\"x\":", 2, "\"grip\":{\"x\":9"));
                resolution(name, "bat-face-nonunit", b => SetNth(b, at(new[] { "result", "bat" }), "\"face\":{\"x\":", 3, "\"face\":{\"x\":7"));
                resolution(name, "ball-t-regress", b => SetNth(b, at(new[] { "result", "ball" }), "\"t\":", 40, "\"t\":0"));
                resolution(name, "ball-p-domain", b => SetNth(b, at(new[] { "result", "ball" }), "\"p\":{\"x\":", 10, "\"p\":{\"x\":2000000"));
                resolution(name, "ball-empty", b => WireKit.SetValue(b, "[]", at(new[] { "result", "ball" })));
                resolution(name, "fielders-first-empty", b => SetNth(b, at(new[] { "result", "fielders" }), "\"samples\":[", 0, "\"samples\":[],\"x\":["));
                resolution(name, "fielders-action", b => SetNthString(b, at(new[] { "result", "fielders" }), "\"action\":\"", 3, "fly"));
                resolution(name, "fielders-drop-last", b => DropLastFielder(b, at(new[] { "result", "fielders" })));
                resolution(name, "flight.version=2", b => WireKit.SetValue(b, "2", at(new[] { "result", "flight", "version" })));
                resolution(name, "flight.samples=[]", b => WireKit.SetValue(b, "[]", at(new[] { "result", "flight", "samples" })));
                resolution(name, "flight.seed-other", b => WireKit.SetValue(b, "\"other\"", at(new[] { "result", "flight", "seed" })));
                resolution(name, "record.seed-other", b => WireKit.SetValue(b, "\"other\"", at(new[] { "record", "seed" })));
                resolution(name, "record.version=2", b => WireKit.SetValue(b, "2", at(new[] { "record", "version" })));
                resolution(name, "record.assist=cheat", b => WireKit.SetValue(b, "\"cheat\"", at(new[] { "record", "assist" })));
                resolution(name, "record.field-drop-fielder", b => WireKit.SetValue(b, "{\"fielders\":[],\"id\":\"f\"}", at(new[] { "record", "field" })));
                resolution(name, "record.plan.speed=300", b => WireKit.SetValue(b, "300", at(new[] { "record", "plan", "speedKph" })));
                resolution(name, "record.tierToleranceMs=0.5", b => WireKit.SetValue(b, "0.5", at(new[] { "record", "tierToleranceMs" })));
                resolution(name, "result.swing-power", b => WireKit.SetValue(b, "0.5", at(new[] { "result", "swing", "power" })));
                resolution(name, "record.swing-power", b => WireKit.SetValue(b, "0.5", at(new[] { "record", "swing", "power" })));
                resolution(name, "extra-top-member", b => WireKit.Replace(b, b.IndexOf("\"record\":", StringComparison.Ordinal), b.IndexOf("\"record\":", StringComparison.Ordinal), "\"extra\":1,"));
                resolution(name, "benign-seamDeg-17digits", b => WireKit.SetValue(b, "1.2345678901234567", at(new[] { "result", "flight", "release", "seamDeg" })));
                resolution(name, "benign-seamDeg-exp", b => WireKit.SetValue(b, "1.2345678901234567e-9", at(new[] { "result", "flight", "release", "seamDeg" })));
            }
            // A tampered replay digest on real packets (no reseal).
            foreach (var name in new[] { "defensive-tap.result", "early-attack.replay" })
            {
                var captured = byName[name];
                var replay = name.EndsWith(".replay", StringComparison.Ordinal);
                var path = replay ? new[] { "payload", "resolution", "replayDigest" } : new[] { "payload", "replayDigest" };
                var original = WireKit.Slice(captured.Body, path);
                foreach (var variant in new[]
                {
                    "flip-last", "uppercase", "short", "long", "null", "number", "zeros", "other-valid"
                })
                {
                    var kind = variant;
                    add("real-digest/" + name + "/" + kind, () =>
                    {
                        string value;
                        switch (kind)
                        {
                            case "flip-last": value = original.Substring(0, original.Length - 2) + (original[original.Length - 2] == '0' ? "1" : "0") + "\""; break;
                            case "uppercase": value = original.ToUpperInvariant(); break;
                            case "short": value = original.Substring(0, original.Length - 2) + "\""; break;
                            case "long": value = original.Substring(0, original.Length - 1) + "0\""; break;
                            case "null": value = "null"; break;
                            case "number": value = "5"; break;
                            case "zeros": value = "\"" + new string('0', 64) + "\""; break;
                            default: value = "\"" + Digest64 + "\""; break;
                        }
                        return WireKit.Seal(WireKit.SetValue(captured.Body, value, path));
                    });
                }
            }
            // Canonical-form damage deep inside the real packets (re-sealed), at the start, the middle and the end.
            foreach (var name in new[] { "early-attack.result", "thin-edge.delivery" })
            {
                var captured = byName[name];
                foreach (var damage in new[] { "space", "swap-keys", "number-1.0", "number-leading-zero", "number-exp", "number-neg-zero", "escape", "dup-key", "bad-literal" })
                {
                    foreach (var fraction in new[] { 0.05, 0.5, 0.95 })
                    {
                        var kind = damage;
                        var where = fraction;
                        add("real-canonical/" + name + "/" + kind + "@" + where.ToString("0.00", CultureInfo.InvariantCulture), () => WireKit.Seal(Damage(captured.Body, kind, where)));
                    }
                }
            }
            // Wrong envelope kind on the real packets: a result under another type, a replay under result, etc.
            foreach (var pair in new[]
            {
                new[] { "defensive-tap.result", "host.replay" }, new[] { "defensive-tap.result", "host.demonstration" },
                new[] { "defensive-tap.replay", "host.result" }, new[] { "defensive-tap.delivery", "host.result" },
                new[] { "defensive-tap.scene", "host.delivery" }, new[] { "defensive-tap.result", "host.dead_ball_ui" },
                new[] { "defensive-tap.result", "unity.dead" }, new[] { "defensive-tap.result", "host.pause" }
            })
            {
                var captured = byName[pair[0]];
                var type = pair[1];
                add("real-kind/" + pair[0] + "-as-" + type, () => WireKit.Seal(WireKit.SetValue(captured.Body, "\"" + type + "\"", "type")));
            }

            // ---- 8. Size ceilings: the 1 MiB body boundary and the outer packet limit.
            add("limit/body-exactly-1MiB-delivery", () => WireKit.Seal(DeliveryOfLength(BridgeBodyLimit())));
            add("limit/body-1MiB-plus-1-delivery", () => WireKit.Seal(DeliveryOfLength(BridgeBodyLimit() + 1)));
            add("limit/body-1MiB-minus-1-delivery", () => WireKit.Seal(DeliveryOfLength(BridgeBodyLimit() - 1)));
            add("limit/body-1MiB-plus-1-garbage", () => "{\"sha256\":\"" + new string('0', 64) + "\",\"body\":\"" + new string('a', BridgeBodyLimit() + 1) + "\"}");
            add("limit/body-1MiB-garbage-valid-hash", () => WireKit.Seal(new string('a', BridgeBodyLimit())));
            add("limit/body-multibyte-over", () => WireKit.Seal(new string('\u00e9', BridgeBodyLimit() / 2 + 1)));
            add("limit/body-multibyte-exact", () => WireKit.Seal(new string('\u00e9', BridgeBodyLimit() / 2)));
            add("limit/outer-over-2MiB", () => "{\"sha256\":\"" + new string('0', 64) + "\",\"body\":\"" + new string('a', 2 * 1024 * 1024 + 4 * 1024) + "\"}");
            add("limit/outer-spaces-over-2MiB", () => new string(' ', 2 * 1024 * 1024 + 4 * 1024 + 1) + "{}");
            add("limit/outer-escapes-near-limit", () => "{\"sha256\":\"" + Digest64 + "\",\"body\":\"" + Repeat("\\\"", 1024 * 1024) + "\"}");
            add("limit/many-keys-100001", () => "{\"sha256\":\"x\",\"body\":\"y\",\"z\":{" + ManyKeys(100001) + "}}");
            add("limit/many-keys-body-100001", () => WireKit.Seal(Padded("host.profile", "{\"quality\":\"high\"}", ManyKeys(100001))));

            return cases;
        }

        // ---------------------------------------------------------------- helpers for the families above

        private static int BridgeBodyLimit() { return 1 * 1024 * 1024; }

        internal static string Repeat(string text, int count)
        {
            var builder = new StringBuilder(text.Length * count);
            for (var index = 0; index < count; index++) builder.Append(text);
            return builder.ToString();
        }

        private static string[] Concat(string[] first, string[] second)
        {
            var result = new string[first.Length + second.Length];
            Array.Copy(first, result, first.Length);
            Array.Copy(second, 0, result, first.Length, second.Length);
            return result;
        }

        internal static string Printable(string text)
        {
            var builder = new StringBuilder();
            for (var index = 0; index < text.Length; index++)
            {
                var c = text[index];
                if (c > 0x20 && c < 0x7f && c != '/' && c != '\\' && c != '"') builder.Append(c);
                else builder.Append('%').Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
            }
            return builder.ToString();
        }

        internal static string ManyKeys(int count)
        {
            var builder = new StringBuilder(count * 12);
            for (var index = 0; index < count; index++)
            {
                if (index > 0) builder.Append(',');
                var key = new char[4];
                var rest = index;
                for (var digit = 3; digit >= 0; digit--) { key[digit] = (char)('a' + rest % 26); rest /= 26; }
                builder.Append('"').Append(key).Append("\":0");
            }
            return builder.ToString();
        }

        private static string Padded(string type, string payload, string extraMembers)
        {
            return WireKit.Body(type, 7, null, payload.Substring(0, payload.Length - 1) + ",\"zz\":{" + extraMembers + "}}");
        }

        /// <summary>The synthetic delivery body padded (through the free-form seed) to exactly <paramref name="bytes"/> UTF-8 bytes.</summary>
        private static string DeliveryOfLength(int bytes)
        {
            var payload = DeliveryPayload();
            var baseBody = WireKit.Body("host.delivery", 7, "delivery-1", payload);
            // The seed appears twice (payload.seed and flight.seed): two bytes per padding character, so odd remainders
            // are taken up by the buildId (one byte per character).
            var missing = bytes - Encoding.UTF8.GetByteCount(baseBody);
            var seedPad = missing / 2;
            var idPad = missing - seedPad * 2;
            if (missing < 0) throw new InvalidOperationException("base delivery is larger than the target");
            var padded = payload.Replace("\"seed\":\"seed\"", "\"seed\":\"seed" + new string('s', seedPad) + "\"");
            return WireKit.Body("host.delivery", 7, "delivery-1", padded, "host", "build-1" + new string('b', idPad));
        }

        private static string UnescapeForLookSeed(string text)
        {
            // Entries written with JSON escapes are used as the JSON text of the literal (Q() would double-escape them).
            return text.Replace("\\\"", "\"").Replace("\\\\", "\\").Replace("\\n", "\n").Replace("\\t", "\t")
                .Replace("\\u0001", "\u0001").Replace("\\u001f", "\u001f").Replace("\\u0000", "\u0000");
        }

        private static string SetNth(string body, string[] path, string needle, int nth, string with)
        {
            int start, end;
            WireKit.Span(body, out start, out end, path);
            var index = WireKit.NthIndexOf(body, needle, nth, start, end);
            if (index < 0) return body;
            return WireKit.Replace(body, index, index + needle.Length, with);
        }

        /// <summary>Replaces the string value that follows the nth occurrence of <paramref name="prefix"/> (which ends in an opening quote).</summary>
        private static string SetNthString(string body, string[] path, string prefix, int nth, string text)
        {
            int start, end;
            WireKit.Span(body, out start, out end, path);
            var index = WireKit.NthIndexOf(body, prefix, nth, start, end);
            if (index < 0) return body;
            var valueStart = index + prefix.Length;
            var valueEnd = body.IndexOf('"', valueStart);
            return WireKit.Replace(body, valueStart, valueEnd, text);
        }

        private static string DropLastFielder(string body, string[] path)
        {
            int start, end;
            WireKit.Span(body, out start, out end, path);
            var array = body.Substring(start, end - start);
            var last = array.LastIndexOf(",{\"fielderId\":", StringComparison.Ordinal);
            if (last < 0) return body;
            return WireKit.Replace(body, start, end, array.Substring(0, last) + "]");
        }

        private static string Damage(string body, string kind, double fraction)
        {
            var at = (int)(body.Length * fraction);
            switch (kind)
            {
                case "space":
                {
                    var comma = body.IndexOf(',', at);
                    return body.Substring(0, comma + 1) + " " + body.Substring(comma + 1);
                }
                case "swap-keys":
                {
                    var y = body.IndexOf(",\"y\":", at, StringComparison.Ordinal);
                    if (y < 0) return body + " ";
                    var x = body.LastIndexOf("\"x\":", y, StringComparison.Ordinal);
                    var yEnd = WireKit.EndOfValue(body, y + 5);
                    return body.Substring(0, x) + body.Substring(y + 1, yEnd - y - 1) + "," + body.Substring(x, y - x) + body.Substring(yEnd);
                }
                case "number-1.0":
                    return ReplaceNumberAfter(body, at, "1.0");
                case "number-leading-zero":
                    return ReplaceNumberAfter(body, at, "01");
                case "number-exp":
                    return ReplaceNumberAfter(body, at, "1e5");
                case "number-neg-zero":
                    return ReplaceNumberAfter(body, at, "-0");
                case "escape":
                {
                    var quote = body.IndexOf("\":\"", at, StringComparison.Ordinal);
                    if (quote < 0) return body + " ";
                    return body.Substring(0, quote + 3) + "\\u0041" + body.Substring(quote + 3);
                }
                case "dup-key":
                {
                    var comma = body.IndexOf(",\"", at, StringComparison.Ordinal);
                    var end = body.IndexOf(':', comma);
                    var key = body.Substring(comma + 1, end - comma - 1);
                    return body.Substring(0, comma + 1) + key + ":0," + body.Substring(comma + 1);
                }
                default:
                {
                    var literal = body.IndexOf("null", at, StringComparison.Ordinal);
                    if (literal < 0) literal = body.IndexOf("true", at, StringComparison.Ordinal);
                    if (literal < 0) return body + " ";
                    return body.Substring(0, literal) + "nulll" + body.Substring(literal + 4);
                }
            }
        }

        private static string ReplaceNumberAfter(string body, int at, string token)
        {
            // The next numeric member value after 'at': ":<digits>" up to a delimiter.
            for (var index = at; index < body.Length - 2; index++)
            {
                if (body[index] != ':' || !(char.IsDigit(body[index + 1]) || body[index + 1] == '-')) continue;
                var end = index + 1;
                while (end < body.Length && body[end] != ',' && body[end] != '}' && body[end] != ']') end++;
                return body.Substring(0, index + 1) + token + body.Substring(end);
            }
            return body + " ";
        }

        internal static IEnumerable<string> NumberTokens()
        {
            return new[]
            {
                // canonical, accepted
                "0", "1", "-1", "0.5", "-0.5", "0.1", "0.2", "0.30000000000000004", "123456.789", "100", "1000000", "-123.456",
                "4.35", "3.141592653589793", "2.718281828459045", "1e-7", "1.5e-7", "-2.5e-9", "5e-324", "2.2250738585072014e-308",
                "9.999999999999999e-7", "0.000001", "0.0000011", "0.000123", "1e+21", "1.5e+21", "1.7976931348623157e+308",
                "123456789012345680000", "1e+300", "9007199254740991", "9007199254740992", "4503599627370497.5",
                "0.9999999999999999", "0.1234567890123456", "0.12345678901234568", "12.345678901234567", "1234567.1234567891",
                "-0.0001", "0.00001", "7.0000000000000001e-7", "4.9406564584124654e-324", "1.2345678901234567e-300",
                "35.833333333333336", "-8.690000000000001", "9.8", "137.5", "8.59", "10.06", "0.4", "0.0015", "0.016",
                // non-canonical spelling, rejected
                "1.0", "1.50", "-0", "0.0", "0.00", "1E5", "1e5", "1e+5", "1e-5", "1e5000", "100000e-5", "01", "00", "001.5", "+1", ".5", "5.", "-.5", "1e", "1e+", "1e-",
                "--1", "1.2.3", "0x10", "0b1", "NaN", "Infinity", "-Infinity", "infinity", "nan", "1_000", "1,5", "\u0661\u0662\u0663", "١٢٣",
                "1e400", "-1e400", "1e-400", "-1e-400", "1e-401", "1e401", "12345678901234567890", "1234567890123456789012345",
                "0.12345678901234567890123", "0.000000000000000000000012", "0.00000000000000000000001", "1.00000000000000000000001",
                "123456789012345678901234", "1234567890123456789012345", "1.23456789012345678901234e-7", "9.9999999999999999999e-7",
                "1.0000000000000001e-6", "9.999999999999999e-7", "1.7976931348623159e+308", "1.7976931348623158e+308", "5e-325", "1e-323",
                "2e-324", "2.4703282292062327e-324", "2.4703282292062328e-324", "1e+22", "1e+23", "123456789012345678", "0.000001e0",
                "1e0", "1e00", "1e-0", "1e+0", "1.5e", "1.5e+", "0e0", "0e5", "-0e5", "0.0e0", "0.1e1", "10e-1", "1e1", "5E-324", "1e-6",
                "1e-07", "1e+07", "1e+007", "1.5e-07", "9.007199254740993e+15", "9007199254740993", "9007199254740995", "18014398509481985",
                "4.35e0", "435e-2", "0.435e1", "0.4350", "0435", "-01", "- 1", "1 ", " 1", "1\t", "\"1\"", "true", "null", "[1]", "{}", "[]",
                "-", "e5", "E5", ".", "..", ",", "1,", "1;", "1/", "1\\", "1\"", "1'", "1x", "x1", "1e5x", "1.5.", "0.5e1.5"
            };
        }
    }
}
