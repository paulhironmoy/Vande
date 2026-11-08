using System.Text;
using UnityEngine;
using Vande.Practice.Bridge;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Complete canonical contract-v6/sim-v3 messages shared by bridge tests. The shape
    /// mirrors the TypeScript contract rather than relying on shallow `{}` test data.
    /// </summary>
    internal static class UnityPracticeContractTestFixture
    {
        public const string InitializePayload =
            "{\"assistance\":\"learn\",\"audio\":true,\"captions\":true," +
            "\"coordinateSystem\":\"vande-striker-frame-v1\",\"deviceTier\":\"full\"," +
            "\"handedness\":\"right\",\"handednessPolicy\":" +
            "\"physics-right-handed-presentation-mirrors-once\",\"haptics\":true," +
            "\"highContrast\":false,\"locale\":\"en-IN\",\"pixelsPerDp\":1,\"quality\":\"standard\"," +
            "\"reducedMotion\":false,\"textScale\":1}";

        public const string Plan =
            "{\"lengthM\":6,\"lineM\":0,\"speedKph\":130,\"variation\":\"stock\"}";

        public const string Bowler =
            "{\"arm\":\"right\",\"family\":\"pace\",\"lookSeed\":\"look\",\"paceBand\":\"fast\"}";

        public const string Ball = "{\"age\":\"new\",\"colour\":\"red\"}";

        public const string Flight =
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

        public static string DeliveryPayload =>
            "{\"ballIndex\":0,\"flight\":" + Flight + ",\"overIndex\":0,\"plan\":" + Plan +
            ",\"presentation\":{\"coach\":null,\"learnCue\":false},\"seed\":\"seed\"}";

        public static string ScenePayload()
        {
            return "{" +
                   "\"ball\":" + Ball + "," +
                   "\"batterPosition\":{\"creaseOffsetM\":0,\"guard\":\"middle\",\"lateralM\":0}," +
                   "\"bowler\":" + Bowler + "," +
                   "\"conditions\":\"balanced\"," +
                   "\"field\":" + FieldPayload() + "," +
                   "\"fieldIntent\":\"attack_the_stumps\"," +
                   "\"handedness\":\"right\"," +
                   "\"trainingObjective\":\"random\"}";
        }

        public static string ResultPayload(string events = null)
        {
            const string ballTrace =
                "[{\"p\":{\"x\":0,\"y\":2,\"z\":-8},\"t\":0," +
                "\"v\":{\"x\":0,\"y\":-1,\"z\":35}},{\"p\":{\"x\":0,\"y\":0.4,\"z\":9}," +
                "\"t\":0.1,\"v\":{\"x\":0,\"y\":0,\"z\":20}}]";
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
            var record = "{" +
                         "\"assist\":\"learn\",\"ball\":" + Ball + ",\"ballIndex\":0," +
                         "\"bowler\":" + Bowler + ",\"conditions\":\"balanced\",\"dismissal\":null," +
                         "\"field\":" + FieldPayload() + ",\"handedness\":\"right\",\"overIndex\":0," +
                         "\"plan\":" + Plan + ",\"runs\":0,\"seed\":\"seed\",\"swing\":null," +
                         "\"tierToleranceMs\":0,\"version\":3}";
            var result = "{" +
                         "\"ball\":" + ballTrace + ",\"bat\":[]," +
                         "\"batterBodyFrame\":{\"headCentre\":{\"x\":-0.2,\"y\":1.62,\"z\":8.86}," +
                         "\"stance\":{\"x\":-0.15,\"z\":8.96}," +
                         "\"torsoTop\":{\"x\":-0.3,\"y\":1.42,\"z\":8.94}}," +
                         "\"batterMotion\":null," +
                         "\"batterPosture\":{\"crouchM\":0}," +
                         "\"batterRootOffset\":{\"x\":0,\"z\":0},\"coaching\":" + coaching + "," +
                         "\"contact\":" + contact + ",\"deadT\":0.1," +
                         "\"events\":" + (events ?? "[{\"kind\":\"release\",\"t\":0},{\"kind\":\"dead\",\"t\":0.1}]") + "," +
                         "\"fielders\":" + FielderPaths() + ",\"flight\":" + Flight + "," +
                         "\"footwork\":\"forward\",\"lbw\":null,\"outcome\":" + outcome + "," +
                         "\"swing\":null,\"version\":3}";
            const string score = "{\"balls\":1,\"maxOvers\":10,\"runs\":0,\"wickets\":0}";
            var withoutDigest = "{\"record\":" + record + ",\"result\":" + result + ",\"score\":" + score + "}";
            var digest = UnityPracticeReplayDigest.ComputeFromResolutionPayload(withoutDigest);
            return "{\"record\":" + record + ",\"replayDigest\":\"" + digest + "\",\"result\":" +
                   result + ",\"score\":" + score + "}";
        }

        public static string DemonstrationPayload(double speed = 1.0)
        {
            return "{\"delivery\":" + DeliveryPayload + ",\"resolution\":" + ResultPayload() +
                   ",\"speed\":" + speed.ToString("R", System.Globalization.CultureInfo.InvariantCulture) + "}";
        }

        public static string DeadBallUiPayload(string replayDigest, bool coach = true, string recommendation = "")
        {
            return coach
                ? "{\"primaryAction\":\"practice_ball\",\"primaryLabel\":\"Practice this ball\"," +
                  "\"reason\":\"Reading the ball\",\"recommendation\":" +
                  JsonString(recommendation) + ",\"replayDigest\":\"" + replayDigest + "\"," +
                  "\"secondaryAction\":\"next_ball\",\"secondaryLabel\":\"Next ball\"}"
                : "{\"primaryAction\":\"next_ball\",\"primaryLabel\":\"Next ball\"," +
                  "\"reason\":\"Reading the ball\",\"recommendation\":" +
                  JsonString(recommendation) + ",\"replayDigest\":\"" + replayDigest + "\"," +
                  "\"secondaryAction\":null,\"secondaryLabel\":null}";
        }

        public static string HostPacket(string type, long sequence, string deliveryId, string payload)
        {
            var body = "{" +
                       "\"buildId\":\"build-1\"," +
                       "\"contractVersion\":" + BridgeConstants.ContractVersion + "," +
                       "\"deliveryId\":" + (deliveryId == null ? "null" : "\"" + deliveryId + "\"") + "," +
                       "\"messageId\":\"host-" + sequence + "\"," +
                       "\"payload\":" + payload + "," +
                       "\"sender\":\"host\"," +
                       "\"sequence\":" + sequence + "," +
                       "\"sessionId\":\"session-1\"," +
                       "\"simVersion\":" + BridgeConstants.SimulationVersion + "," +
                       "\"type\":\"" + type + "\"}";
            return JsonUtility.ToJson(new UnityPracticePacket
            {
                body = body,
                sha256 = Sha256Digest.OfUtf8(body)
            });
        }

        private static string FieldPayload()
        {
            var roles = Roles;
            var fielders = new StringBuilder("[");
            for (var index = 0; index < roles.Length; index++)
            {
                if (index > 0) fielders.Append(',');
                fielders.Append("{\"id\":\"fielder-").Append(index)
                    .Append("\",\"role\":\"").Append(roles[index])
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

        private static string JsonString(string value)
        {
            if (value == null) return "null";
            var encoded = new StringBuilder(value.Length + 2).Append('"');
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                switch (character)
                {
                    case '"': encoded.Append("\\\""); break;
                    case '\\': encoded.Append("\\\\"); break;
                    case '\b': encoded.Append("\\b"); break;
                    case '\f': encoded.Append("\\f"); break;
                    case '\n': encoded.Append("\\n"); break;
                    case '\r': encoded.Append("\\r"); break;
                    case '\t': encoded.Append("\\t"); break;
                    default:
                        if (character < 0x20)
                            encoded.Append("\\u").Append(((int)character).ToString("x4"));
                        else encoded.Append(character);
                        break;
                }
            }
            return encoded.Append('"').ToString();
        }

        private static readonly string[] Roles =
        {
            "keeper", "bowler", "slip", "point", "cover", "mid_off",
            "mid_on", "midwicket", "square_leg", "fine_leg", "third_man"
        };
    }
}
