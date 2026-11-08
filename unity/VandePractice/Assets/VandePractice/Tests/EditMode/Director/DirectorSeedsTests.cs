using System;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// Keys, draws and noise of the Director (contract director/3) against the web: the vectors below were produced by running the
    /// web's own seeds.ts / noise.ts / takes.ts (builder tool, the probe is S/humans/unity-e1/probes/vectors.test.ts). Integer
    /// results and results of + - * / only must match to the bit; the ones that go through sin, log or exp match to 1e-13
    /// relative (different libm implementations may differ in the last bit of a double).
    /// </summary>
    public sealed class DirectorSeedsTests
    {
        private struct FnvVector
        {
            public readonly string Text;
            public readonly uint Hash;

            public FnvVector(string text, uint hash)
            {
                Text = text;
                Hash = hash;
            }
        }

        private struct MixVector
        {
            public readonly uint Seed;
            public readonly int K;
            public readonly uint Value;

            public MixVector(uint seed, int k, uint value)
            {
                Seed = seed;
                K = k;
                Value = value;
            }
        }

        private struct DrawVector
        {
            public readonly uint Seed;
            public readonly int K;
            public readonly double U01;
            public readonly double Range;
            public readonly double Gauss;

            public DrawVector(uint seed, int k, double u01, double range, double gauss)
            {
                Seed = seed;
                K = k;
                U01 = u01;
                Range = range;
                Gauss = gauss;
            }
        }

        private struct LogNormVector
        {
            public readonly double Mean;
            public readonly double Cv;
            public readonly double Z;
            public readonly double Value;

            public LogNormVector(double mean, double cv, double z, double value)
            {
                Mean = mean;
                Cv = cv;
                Z = z;
                Value = value;
            }
        }

        private struct NoiseVector
        {
            public readonly uint Seed;
            public readonly double X;
            public readonly double VNoise;
            public readonly double Fractal;
            public readonly double SkewSin;

            public NoiseVector(uint seed, double x, double vnoise, double fractal, double skewSin)
            {
                Seed = seed;
                X = x;
                VNoise = vnoise;
                Fractal = fractal;
                SkewSin = skewSin;
            }
        }

        private struct SoftVector
        {
            public readonly double X;
            public readonly double Limit;
            public readonly double Value;

            public SoftVector(double x, double limit, double value)
            {
                X = x;
                Limit = limit;
                Value = value;
            }
        }

        private struct KeyVector
        {
            public readonly string Look;
            public readonly string Role;
            public readonly string DeliveryKey;
            public readonly uint Person;
            public readonly uint Ball;

            public KeyVector(string look, string role, string deliveryKey, uint person, uint ball)
            {
                Look = look;
                Role = role;
                DeliveryKey = deliveryKey;
                Person = person;
                Ball = ball;
            }
        }

        private static readonly FnvVector[] Fnv =
        {
            new FnvVector("", 0x811c9dc5u),
            new FnvVector("a", 0xe40c292cu),
            new FnvVector("foobar", 0xbf9cf968u),
            new FnvVector("over-7f3a#0.3|middle|0", 0x1e3fcac8u),
            new FnvVector("w0-baseline#9.5|crowd:applause|2", 0xae9f6719u),
            new FnvVector("\u0939\u093f\u0928\u094d\u0926\u0940|x|1", 0xc7ac5c0fu),
            new FnvVector("demo:ref-1#0.0|gloves|1", 0xe584d57u),
            new FnvVector("life|person|look-1|striker", 0x68c5bc1du),
            new FnvVector("golden#2.3", 0xcee2ed36u),
            new FnvVector("unseeded", 0xa18f3bau),
            new FnvVector("a\u00e9\u4e2d\ud83d\ude00z", 0xead5ee7bu),
        };

        private static readonly MixVector[] Mixes =
        {
            new MixVector(0u, 0, 2462723854u),
            new MixVector(0u, 1, 1020716019u),
            new MixVector(0u, 2, 454327756u),
            new MixVector(0u, 3, 1275600319u),
            new MixVector(0u, 10, 2440575920u),
            new MixVector(0u, 100, 4064223172u),
            new MixVector(0u, 1000, 1438415356u),
            new MixVector(0u, 5000, 664921185u),
            new MixVector(1u, 0, 2527132011u),
            new MixVector(1u, 1, 314344336u),
            new MixVector(1u, 2, 2535364964u),
            new MixVector(1u, 3, 2041432039u),
            new MixVector(1u, 10, 2069979692u),
            new MixVector(1u, 100, 1699905066u),
            new MixVector(1u, 1000, 2524634852u),
            new MixVector(1u, 5000, 2267835792u),
            new MixVector(5u, 0, 1478832577u),
            new MixVector(5u, 1, 3186062026u),
            new MixVector(5u, 2, 3537421946u),
            new MixVector(5u, 3, 387527240u),
            new MixVector(5u, 10, 2702894136u),
            new MixVector(5u, 100, 859125717u),
            new MixVector(5u, 1000, 3916775930u),
            new MixVector(5u, 5000, 2422929759u),
            new MixVector(2654435769u, 0, 1020716019u),
            new MixVector(2654435769u, 1, 454327756u),
            new MixVector(2654435769u, 2, 1275600319u),
            new MixVector(2654435769u, 3, 1215922603u),
            new MixVector(2654435769u, 10, 36795291u),
            new MixVector(2654435769u, 100, 1089754603u),
            new MixVector(2654435769u, 1000, 3547077998u),
            new MixVector(2654435769u, 5000, 222721678u),
            new MixVector(4294967295u, 0, 920564995u),
            new MixVector(4294967295u, 1, 4230986166u),
            new MixVector(4294967295u, 2, 697614773u),
            new MixVector(4294967295u, 3, 1778835764u),
            new MixVector(4294967295u, 10, 3172587120u),
            new MixVector(4294967295u, 100, 3169372230u),
            new MixVector(4294967295u, 1000, 1365499130u),
            new MixVector(4294967295u, 5000, 2445941259u),
            new MixVector(123456789u, 0, 1573771921u),
            new MixVector(123456789u, 1, 319883699u),
            new MixVector(123456789u, 2, 2742014374u),
            new MixVector(123456789u, 3, 1324369493u),
            new MixVector(123456789u, 10, 809985034u),
            new MixVector(123456789u, 100, 1026975675u),
            new MixVector(123456789u, 1000, 1578047509u),
            new MixVector(123456789u, 5000, 1539202502u),
            new MixVector(3735928559u, 0, 3553530007u),
            new MixVector(3735928559u, 1, 1645313261u),
            new MixVector(3735928559u, 2, 4073195585u),
            new MixVector(3735928559u, 3, 2760393073u),
            new MixVector(3735928559u, 10, 3894254359u),
            new MixVector(3735928559u, 100, 3366412588u),
            new MixVector(3735928559u, 1000, 2768922379u),
            new MixVector(3735928559u, 5000, 648777183u),
            new MixVector(2166136261u, 0, 164558732u),
            new MixVector(2166136261u, 1, 2036735458u),
            new MixVector(2166136261u, 2, 3926833134u),
            new MixVector(2166136261u, 3, 3904029249u),
            new MixVector(2166136261u, 10, 3558978549u),
            new MixVector(2166136261u, 100, 2170381428u),
            new MixVector(2166136261u, 1000, 3293760587u),
            new MixVector(2166136261u, 5000, 1230416375u),
        };

        private static readonly DrawVector[] Draws =
        {
            new DrawVector(5u, 0, 0.3443175407592207, 2.164763111388311, 0.8195012831129134),
            new DrawVector(5u, 1, 0.7418128722347319, 8.127193083520979, -0.017427098006010056),
            new DrawVector(5u, 2, 0.823620228562504, 9.35430342843756, 0.9620877332054079),
            new DrawVector(5u, 7, 0.9474025156814605, 11.211037735221907, 1.1732130874879658),
            new DrawVector(5u, 33, 0.34741707309149206, 2.211256096372381, -0.7642072127200663),
            new DrawVector(77u, 0, 0.9879075512290001, 11.818613268435001, 1.8832146469503641),
            new DrawVector(77u, 1, 0.8030768649186939, 9.046152973780409, -0.08989793993532658),
            new DrawVector(77u, 2, 0.6506229073274881, 6.759343609912321, -1.1711839819326997),
            new DrawVector(77u, 7, 0.06566819874569774, -2.014977018814534, -0.9864352466538548),
            new DrawVector(77u, 33, 0.19902979233302176, -0.0145531150046736, -1.1355825425125659),
            new DrawVector(123456789u, 0, 0.36642232933081686, 2.496334939962253, -0.8413479430601001),
            new DrawVector(123456789u, 1, 0.07447872753255069, -1.8828190870117396, 0.13914312282577157),
            new DrawVector(123456789u, 2, 0.6384249716065824, 6.576374574098736, 0.3264139969833195),
            new DrawVector(123456789u, 7, 0.5616651398595423, 5.424977097893134, -1.4029128169640899),
            new DrawVector(123456789u, 33, 0.2835677736438811, 1.2535166046582162, -1.1851887460798025),
            new DrawVector(4294967295u, 0, 0.21433574031107128, 0.21503610466606915, -0.27626986149698496),
            new DrawVector(4294967295u, 1, 0.9851032323203981, 11.776548484805971, -1.3424029452726245),
            new DrawVector(4294967295u, 2, 0.16242609662003815, -0.5636085506994277, -0.7909055245108902),
            new DrawVector(4294967295u, 7, 0.3843605520669371, 2.7654082810040563, -0.44636632315814495),
            new DrawVector(4294967295u, 33, 0.09359066607430577, -1.5961400088854134, -0.2273195730522275),
        };

        private static readonly LogNormVector[] LogNorms =
        {
            new LogNormVector(4.2, 0.5, 0, 3.756594202199647),
            new LogNormVector(5.7, 0.7, 2.9, 29.14813927414516),
            new LogNormVector(1800, 0.6, -2.1, 481.700346190255),
            new LogNormVector(0.3, 0.4, 1.3, 0.4596207042193686),
            new LogNormVector(1, 0.1, 0.5, 1.0459237927752494),
        };

        private static readonly NoiseVector[] Noises =
        {
            new NoiseVector(0u, 0, 0.1467951601371169, 0.05423560999333857, 0),
            new NoiseVector(0u, 0.25, 0.07728574038719671, 0.1507921795872238, 0.7550340510386802),
            new NoiseVector(0u, 1.5, -0.6565646084491163, 0.6119269715926569, -0.175295819080513),
            new NoiseVector(0u, 7.123456, 0.6751227181274686, -0.4650065360423831, -0.4582562467519046),
            new NoiseVector(0u, 33.3, -0.6953734073845499, -0.017113207356339782, 0.6238218398858125),
            new NoiseVector(0u, 96.9999, 0.8978237667886417, 0.019212757553754567, -0.846929911473107),
            new NoiseVector(0u, 97.5, 0.880279446253553, -0.11109911408931092, 0.642866085352974),
            new NoiseVector(5u, 0, -0.31136491848155856, -0.2996089264401235, 0),
            new NoiseVector(5u, 0.25, -0.22907096313701913, -0.741775172501451, 0.7550340510386802),
            new NoiseVector(5u, 1.5, 0.565433100797236, -0.5191965065337333, -0.175295819080513),
            new NoiseVector(5u, 7.123456, 0.8934399514824517, 0.14517880260029775, -0.4582562467519046),
            new NoiseVector(5u, 33.3, -0.22987438051108444, 0.16906877372381757, 0.6238218398858125),
            new NoiseVector(5u, 96.9999, 0.835204231535321, 1.0501919244934572, -0.846929911473107),
            new NoiseVector(5u, 97.5, 0.8239773493260145, 0.7952514158712456, 0.642866085352974),
            new NoiseVector(4294967295u, 0, -0.5713285193778574, 1.0308480252162553, 0),
            new NoiseVector(4294967295u, 0.25, -0.4117555620478015, 0.7366776308920874, 0.7550340510386802),
            new NoiseVector(4294967295u, 1.5, 0.14752932894043624, 0.41716767808613897, -0.175295819080513),
            new NoiseVector(4294967295u, 7.123456, -0.22981878276542572, 0.027062851870580995, -0.4582562467519046),
            new NoiseVector(4294967295u, 33.3, -0.5994553767327082, 0.6701919010751143, 0.6238218398858125),
            new NoiseVector(4294967295u, 96.9999, -0.42089863447166354, -0.17211291995674172, -0.846929911473107),
            new NoiseVector(4294967295u, 97.5, -0.5799450853373855, -0.2709363685728965, 0.642866085352974),
            new NoiseVector(99999u, 0, -0.17562274495139718, -0.5270308054983616, 0),
            new NoiseVector(99999u, 0.25, -0.23408222537182155, -0.5114483034262155, 0.7550340510386802),
            new NoiseVector(99999u, 1.5, 0.0404219466727227, -0.9544302712851678, -0.175295819080513),
            new NoiseVector(99999u, 7.123456, -0.12194788077844865, 0.49639228493924764, -0.4582562467519046),
            new NoiseVector(99999u, 33.3, 0.6866863846457991, 0.5093357909464125, 0.6238218398858125),
            new NoiseVector(99999u, 96.9999, 0.6524994643430235, -0.579873759336391, -0.846929911473107),
            new NoiseVector(99999u, 97.5, 0.449782780604437, -0.44521102030772486, 0.642866085352974),
        };

        private static readonly KeyVector[] Keys =
        {
            new KeyVector("look-1", "striker", "golden#2.3", 1757789213u, 3150205012u),
            new KeyVector("look-3", "bowler", "golden#2.3", 1072777414u, 3730118560u),
            new KeyVector("look-2", "striker", "S#-.-", 1630890092u, 3190727909u),
            new KeyVector("p", "bowler", "unseeded", 3680173075u, 4063238258u),
        };

        private static readonly SoftVector[] Softs =
        {
            new SoftVector(-100, 62, -61.508735637360374),
            new SoftVector(-50, 62, -49.632976038266534),
            new SoftVector(-46.5, 62, -46.5),
            new SoftVector(-30, 62, -30),
            new SoftVector(0, 62, 0),
            new SoftVector(20, 62, 20),
            new SoftVector(46.5, 62, 46.5),
            new SoftVector(46.6, 62, 46.59967811195919),
            new SoftVector(50, 62, 49.632976038266534),
            new SoftVector(61.99, 62, 56.29418868046781),
            new SoftVector(100, 62, 61.508735637360374),
            new SoftVector(-100, 40, -39.99088118034446),
            new SoftVector(-50, 40, -38.64664716763387),
            new SoftVector(-46.5, 40, -38.07950091379246),
            new SoftVector(-30, 40, -30),
            new SoftVector(0, 40, 0),
            new SoftVector(20, 40, 20),
            new SoftVector(46.5, 40, 38.07950091379246),
            new SoftVector(46.6, 40, 38.098610198984794),
            new SoftVector(50, 40, 38.64664716763387),
            new SoftVector(61.99, 40, 39.59197013429758),
            new SoftVector(100, 40, 39.99088118034446),
            new SoftVector(-100, 12, -11.9999999999998),
            new SoftVector(-50, 12, -11.999996518524563),
            new SoftVector(-46.5, 12, -11.999988820040484),
            new SoftVector(-30, 12, -11.997264354103336),
            new SoftVector(0, 12, 0),
            new SoftVector(20, 12, 11.923315400380478),
            new SoftVector(46.5, 12, 11.999988820040484),
            new SoftVector(46.6, 12, 11.999989186563154),
            new SoftVector(50, 12, 11.999996518524563),
            new SoftVector(61.99, 12, 11.999999936021647),
            new SoftVector(100, 12, 11.9999999999998),
            new SoftVector(-100, 35, -34.99808783224112),
            new SoftVector(-50, 35, -34.42029273241771),
            new SoftVector(-46.5, 35, -34.1351783808186),
            new SoftVector(-30, 35, -29.299908246603263),
            new SoftVector(0, 35, 0),
            new SoftVector(20, 35, 20),
            new SoftVector(46.5, 35, 34.1351783808186),
            new SoftVector(46.6, 35, 34.145005792861355),
            new SoftVector(50, 35, 34.42029273241771),
            new SoftVector(61.99, 35, 34.85273443069236),
            new SoftVector(100, 35, 34.99808783224112),
        };

        private static void AssertClose(double actual, double expected, double relative, string what)
        {
            double allowed = Math.Max(Math.Abs(expected) * relative, 1e-15);
            Assert.That(Math.Abs(actual - expected), Is.LessThanOrEqualTo(allowed), what + ": " + actual.ToString("R") + " vs " + expected.ToString("R"));
        }

        [Test]
        public void Fnv1a32_GivesTheWebsHashesIncludingNonAsciiAndSurrogatePairs()
        {
            foreach (FnvVector v in Fnv) Assert.That(DirectorSeeds.Fnv1a32(v.Text), Is.EqualTo(v.Hash), v.Text);
            Assert.That(DirectorSeeds.Fnv1a32(""), Is.EqualTo(0x811c9dc5u));
            Assert.That(DirectorSeeds.Fnv1a32("a"), Is.EqualTo(0xe40c292cu));
            Assert.That(DirectorSeeds.Fnv1a32("foobar"), Is.EqualTo(0xbf9cf968u));
        }

        [Test]
        public void Fnv1a32_AndTheDeliveryKey_AreTheOnesTheSoundTakesUse()
        {
#if !STANDALONE_HARNESS
            foreach (FnvVector v in Fnv) Assert.That(DirectorSeeds.Fnv1a32(v.Text), Is.EqualTo(Vande.Practice.Audio.Production.ProductionRecordedTakes.Fnv1a32(v.Text)), v.Text);
#endif
            Assert.That(DirectorSeeds.DeliveryTakeKey("S", 2, 3), Is.EqualTo("S#2.3"));
            Assert.That(DirectorSeeds.DeliveryTakeKey("S", null, null), Is.EqualTo("S#-.-"));
            Assert.That(DirectorSeeds.DeliveryTakeKey("", 1, 1), Is.EqualTo("unseeded"));
            Assert.That(DirectorSeeds.DeliveryTakeKey(null, 1, 1), Is.EqualTo("unseeded"));
#if !STANDALONE_HARNESS
            for (int over = -1; over < 3; over++)
                for (int ball = -1; ball < 8; ball++)
                    Assert.That(DirectorSeeds.DeliveryTakeKey("seed", over, ball), Is.EqualTo(Vande.Practice.Audio.Production.ProductionRecordedTakes.DeliveryTakeKey("seed", over, ball)));
#endif
        }

        [Test]
        public void PersonAndBallKeys_FollowTheDocumentedStringsAndTheWeb()
        {
            foreach (KeyVector v in Keys)
            {
                DirectorRole role = v.Role == "bowler" ? DirectorRole.Bowler : DirectorRole.Striker;
                uint pk = DirectorSeeds.PersonKey(v.Look, role);
                Assert.That(pk, Is.EqualTo(v.Person), v.Look + "/" + v.Role);
                Assert.That(pk, Is.EqualTo(DirectorSeeds.Fnv1a32("life|person|" + v.Look + "|" + v.Role)));
                Assert.That(DirectorSeeds.BallKey(v.DeliveryKey, pk), Is.EqualTo(v.Ball), v.DeliveryKey);
                Assert.That(DirectorSeeds.BallKey(v.DeliveryKey, pk), Is.EqualTo(DirectorSeeds.Fnv1a32(v.DeliveryKey + "|life|" + pk)));
            }
            Assert.That(DirectorSeeds.PersonKey("look-9", DirectorRole.Bowler), Is.Not.EqualTo(DirectorSeeds.PersonKey("look-9", DirectorRole.Striker)));
            uint p = DirectorSeeds.PersonKey("look-9", DirectorRole.Striker);
            Assert.That(DirectorSeeds.BallKey("S#0.1", p), Is.Not.EqualTo(DirectorSeeds.BallKey("S#0.2", p)));
        }

        [Test]
        public void Mix_IsOutputKOfTheSequentialSplitmix32_ForAnySeedAndAnyK()
        {
            foreach (MixVector v in Mixes) Assert.That(DirectorSeeds.Mix(v.Seed, v.K), Is.EqualTo(v.Value), v.Seed + "/" + v.K);
            // the engine's sequential splitmix (src/engine/prng.ts): the k-th output equals the stateless mix
            foreach (uint seed in new uint[] { 0u, 1u, 0xdeadbeefu, 0xffffffffu })
            {
                uint s = seed;
                for (int k = 0; k < 64; k++)
                {
                    unchecked
                    {
                        s += 0x9e3779b9u;
                        uint z = s;
                        z = (z ^ (z >> 16)) * 0x85ebca6bu;
                        z = (z ^ (z >> 13)) * 0xc2b2ae35u;
                        z ^= z >> 16;
                        Assert.That(DirectorSeeds.Mix(seed, k), Is.EqualTo(z), seed + "/" + k);
                    }
                }
            }
        }

        [Test]
        public void U01_Range_AndGauss_MatchTheWebToTheBit()
        {
            foreach (DrawVector v in Draws)
            {
                Assert.That(DirectorSeeds.U01(v.Seed, v.K), Is.EqualTo(v.U01), "u01 " + v.Seed + "/" + v.K);
                Assert.That(DirectorSeeds.Range(v.Seed, v.K, -3, 12), Is.EqualTo(v.Range), "range " + v.Seed + "/" + v.K);
                Assert.That(DirectorSeeds.Gauss(v.Seed, v.K), Is.EqualTo(v.Gauss), "gauss " + v.Seed + "/" + v.K);
            }
            double lo = double.MaxValue, hi = double.MinValue, sum = 0, sq = 0;
            const int n = 50000;
            for (int k = 0; k < n; k++)
            {
                double z = DirectorSeeds.Gauss(9, k);
                lo = Math.Min(lo, z);
                hi = Math.Max(hi, z);
                sum += z;
                sq += z * z;
            }
            Assert.That(lo, Is.GreaterThanOrEqualTo(-3));
            Assert.That(hi, Is.LessThanOrEqualTo(3));
            Assert.That(Math.Abs(sum / n), Is.LessThan(0.02));
            Assert.That(Math.Abs(sq / n - 1), Is.LessThan(0.03));
        }

        [Test]
        public void LogNorm_MatchesTheWeb()
        {
            foreach (LogNormVector v in LogNorms) AssertClose(DirectorSeeds.LogNorm(v.Mean, v.Cv, v.Z), v.Value, 1e-13, "lognorm " + v.Mean + "/" + v.Cv + "/" + v.Z);
        }

        [Test]
        public void VNoise_And_Fractal_AreArithmeticAndMatchTheWebToTheBit_SkewSinToRounding()
        {
            foreach (NoiseVector v in Noises)
            {
                Assert.That(DirectorNoise.VNoise(v.Seed, v.X), Is.EqualTo(v.VNoise), "vnoise " + v.Seed + "/" + v.X);
                Assert.That(DirectorNoise.Fractal(v.Seed, v.X * 1.3, 17.5, DirectorParams.Life.Sway.SpacingS, DirectorParams.Life.Sway.Amp), Is.EqualTo(v.Fractal), "fractal " + v.Seed + "/" + v.X);
                AssertClose(DirectorNoise.SkewSin(v.X * 0.37, 0.5), v.SkewSin, 1e-13, "skewSin " + v.X);
            }
        }

        [Test]
        public void Soft_TheRangeLimitThatEasesIn_MatchesTheWeb_IsLinearToTheKneeAndNeverPassesTheLimit()
        {
            foreach (SoftVector v in Softs) AssertClose(DirectorBake.Soft(v.X, v.Limit), v.Value, 1e-13, "soft(" + v.X + ", " + v.Limit + ")");
            Assert.That(DirectorBake.Soft(20, 62), Is.EqualTo(20));
            Assert.That(DirectorBake.Soft(-46.5, 62), Is.EqualTo(-46.5));
            for (double x = 0; x < 1000; x += 0.37) Assert.That(Math.Abs(DirectorBake.Soft(x, 40)), Is.LessThanOrEqualTo(40));
        }

        [Test]
        public void VNoise_StaysInRange_IsZeroMean_AndWorksForNegativeTimes()
        {
            double sum = 0;
            for (int k = 0; k < 20000; k++)
            {
                double v = DirectorNoise.VNoise(3, k * 0.173 - 500);
                Assert.That(v, Is.InRange(-1.0, 1.0));
                sum += v;
            }
            Assert.That(Math.Abs(sum / 20000), Is.LessThan(0.03));
            Assert.That(DirectorNoise.VNoise(3, -0.5), Is.EqualTo(DirectorNoise.VNoise(3, -0.5)));
        }

        [Test]
        public void Quint_IsZeroAndOneAtTheEnds_AndSkewSinInhalesFasterThanItExhales()
        {
            Assert.That(DirectorNoise.Quint(0), Is.EqualTo(0));
            Assert.That(DirectorNoise.Quint(1), Is.EqualTo(1));
            Assert.That(DirectorNoise.Quint(0.5), Is.EqualTo(0.5).Within(1e-15));
            foreach (double skew in new[] { 0.35, 0.5, 0.7 })
            {
                int rising = 0;
                const int steps = 1000;
                double prev = DirectorNoise.SkewSin(-0.25, skew);
                for (int i = 1; i <= steps; i++)
                {
                    double cur = DirectorNoise.SkewSin(-0.25 + i / (double)steps, skew);
                    if (cur > prev) rising++;
                    prev = cur;
                }
                Assert.That(rising, Is.LessThan(steps / 2), "the rising half is shorter for skew " + skew);
            }
        }
    }
}
