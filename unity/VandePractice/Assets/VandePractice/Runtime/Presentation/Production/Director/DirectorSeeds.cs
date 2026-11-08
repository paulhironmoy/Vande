using System;
using System.Globalization;

namespace Vande.Practice.Presentation.Production.Director
{
    /// <summary>Which of the two actors a plan is for. The role frame, the parameters and the draws differ by role.</summary>
    public enum DirectorRole
    {
        Bowler = 0,
        Striker = 1,
    }

    /// <summary>
    /// Keys and draws of the Director: a C# port of src/render3d/core/motion/director/seeds.ts (contract director/3).
    /// Pure: no clock, no random source, no state. The keys are the ones the sound takes use (src/audio/takes.ts,
    /// ProductionRecordedTakes): <see cref="Fnv1a32"/> hashes UTF-16 code units and <see cref="DeliveryTakeKey"/> names a
    /// delivery. The draws are splitmix32 in its stateless form: <see cref="Mix"/>(seed, k) is output k (from 0) of the
    /// sequential generator, so any draw is reachable without running the ones before it and a draw never depends on how
    /// many others a plan took. Integer arithmetic only, so every value equals the web's bit for bit.
    /// </summary>
    public static class DirectorSeeds
    {
        /// <summary>The web's role string: part of the person key.</summary>
        public static string RoleName(DirectorRole role)
        {
            return role == DirectorRole.Bowler ? "bowler" : "striker";
        }

        /// <summary>FNV-1a, 32 bits, over the UTF-16 code units of the string (JavaScript's charCodeAt).</summary>
        public static uint Fnv1a32(string s)
        {
            if (s == null) throw new ArgumentNullException(nameof(s));
            uint h = 0x811c9dc5u;
            unchecked
            {
                for (int i = 0; i < s.Length; i++)
                {
                    h ^= s[i];
                    h *= 0x01000193u;
                }
            }
            return h;
        }

        /// <summary>
        /// The key every draw of one delivery hashes: "{seed}#{over|-}.{ball|-}", or "unseeded" for an empty seed
        /// (deliveryTakeKey()). The web's Practice stage passes no indices, so its key is "{seed}#-.-".
        /// </summary>
        public static string DeliveryTakeKey(string seed, int? overIndex, int? ballIndex)
        {
            if (string.IsNullOrEmpty(seed)) return "unseeded";
            string o = overIndex.HasValue ? overIndex.Value.ToString(CultureInfo.InvariantCulture) : "-";
            string b = ballIndex.HasValue ? ballIndex.Value.ToString(CultureInfo.InvariantCulture) : "-";
            return seed + "#" + o + "." + b;
        }

        /// <summary>Output k of splitmix32 seeded with <paramref name="seed"/> (the web's mix): a uint32.</summary>
        public static uint Mix(uint seed, int k)
        {
            unchecked
            {
                uint z = seed + (uint)(k + 1) * 0x9e3779b9u;
                z = (z ^ (z >> 16)) * 0x85ebca6bu;
                z = (z ^ (z >> 13)) * 0xc2b2ae35u;
                return z ^ (z >> 16);
            }
        }

        /// <summary>Draw k of the seed as a number in [0, 1).</summary>
        public static double U01(uint seed, int k)
        {
            return Mix(seed, k) / 4294967296.0;
        }

        /// <summary>Draw k of the seed in [lo, hi).</summary>
        public static double Range(uint seed, int k, double lo, double hi)
        {
            return lo + (hi - lo) * U01(seed, k);
        }

        /// <summary>An approximately normal draw (Irwin-Hall of three, unit variance, bounded to +-3): uses draws 3k .. 3k + 2.</summary>
        public static double Gauss(uint seed, int k)
        {
            return (U01(seed, 3 * k) + U01(seed, 3 * k + 1) + U01(seed, 3 * k + 2) - 1.5) * 2;
        }

        /// <summary>A log-normal draw with the given mean and coefficient of variation (z is a unit-normal draw).</summary>
        public static double LogNorm(double mean, double cv, double z)
        {
            double s2 = Math.Log(1 + cv * cv);
            return Math.Exp(Math.Log(mean) - s2 / 2 + Math.Sqrt(s2) * z);
        }

        /// <summary>The person's key: constant for the over (the actor's look seed) and the role.</summary>
        public static uint PersonKey(string lookSeed, DirectorRole role)
        {
            return Fnv1a32("life|person|" + lookSeed + "|" + RoleName(role));
        }

        /// <summary>The key of one person in one delivery: a replay of the same delivery gives the same key.</summary>
        public static uint BallKey(string deliveryKey, uint personKey)
        {
            return Fnv1a32(deliveryKey + "|life|" + personKey.ToString(CultureInfo.InvariantCulture));
        }
    }
}
