using System;
using System.IO;
using System.Security.Cryptography;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Unity's presented bat against the TypeScript batAt reference (phase-5b quintic Hermite, Fornberg windows,
    /// run/hold/impulse/peak rules, rotation in each segment's log chart). The reference poses come from
    /// tests/fixtures/unity-practice/bat-interpolation-v3-5b.json, generated in TS on the frozen physics: the
    /// reach corpus' two worst angular-acceleration cases and every bat-bearing case of the practice-v3 golden,
    /// probed on the corpus audit's own 1 ms grid plus the motion and contact anchors. Angular acceleration is
    /// measured exactly as scripts/practice-reach-corpus.test.ts does, including the skipped contact pair.
    /// </summary>
    public sealed class BatInterpolationParityTests
    {
        private const string FixtureSchema = "vande.practice.bat-interpolation-parity.v1";
        private const double PoseTolerance = 0.000000001;
        private const double AngularAccelerationAllowanceRadps2 = 2.0;
        private const string FingerSpinWorstCase = "finger_spin:L1.2:x0.45:d-45:e0";
        private const string WristSpinWorstCase = "wrist_spin:L5.5:x0.45:d0:e0";

        private static readonly string[] GoldenCaseIds =
        {
            "golden:defensive-tap", "golden:grounded-attack", "golden:deliberate-loft", "golden:early-attack",
            "golden:late-attack", "golden:thin-edge", "golden:complete-miss"
        };

        private static ParityFixture cached;

        [Test]
        public void Fixture_IsTheCurrentTypeScriptBatAtReference()
        {
            var fixture = Fixture();
            Assert.That(fixture.schema, Is.EqualTo(FixtureSchema));
            Assert.That(fixture.angularAccelerationLimitRadps2, Is.EqualTo(900.0),
                "BAT_ANGULAR_ACCEL_LIMIT_RADPS2 changed; re-mirror the bat presenter and regenerate the reference");
            Assert.That(fixture.frameSha256, Is.EqualTo(Sha256(RepositoryPath("src", "render3d", "practice", "frame.ts"))),
                "TS batAt (src/render3d/practice/frame.ts) changed since this reference was generated; " +
                "mirror it in CanonicalTracePlayback.BatInterpolator and regenerate the parity fixture");
            Assert.That(Case(fixture, FingerSpinWorstCase), Is.Not.Null);
            Assert.That(Case(fixture, WristSpinWorstCase), Is.Not.Null);
            foreach (var id in GoldenCaseIds) Assert.That(Case(fixture, id), Is.Not.Null, id);
        }

        [TestCase(FingerSpinWorstCase)]
        [TestCase(WristSpinWorstCase)]
        public void CorpusWorstCase_PresentedBatMatchesTypeScriptAndStaysWithinTheAngularAccelerationCap(string id)
        {
            AssertParityAndCap(Fixture(), Case(Fixture(), id));
        }

        [Test]
        public void GoldenCases_PresentedBatMatchesTypeScriptAndStaysWithinTheAngularAccelerationCap()
        {
            var fixture = Fixture();
            foreach (var id in GoldenCaseIds) AssertParityAndCap(fixture, Case(fixture, id));
        }

        private static void AssertParityAndCap(ParityFixture fixture, ParityCase item)
        {
            Assert.That(item, Is.Not.Null);
            Assert.That(item.bat, Is.Not.Null.And.Not.Empty, item.id);
            Assert.That(item.reference, Is.Not.Null.And.Not.Empty, item.id);
            var evaluate = CanonicalTracePlayback.CreateBatEvaluator(
                item.bat, item.hasImpulse ? item.impulseT : (double?)null, item.velocityPeakT);

            var times = new double[item.reference.Length];
            var poses = new Pose[item.reference.Length];
            var maxGrip = 0.0;
            var maxToe = 0.0;
            var maxFace = 0.0;
            for (var index = 0; index < item.reference.Length; index++)
            {
                var expected = item.reference[index];
                var actual = evaluate(expected.t);
                Assert.That(actual, Is.Not.Null, item.id + " at " + expected.t);
                maxGrip = Math.Max(maxGrip, MaxComponentDifference(actual.grip, expected.grip));
                maxToe = Math.Max(maxToe, MaxComponentDifference(actual.toe, expected.toe));
                maxFace = Math.Max(maxFace, MaxComponentDifference(actual.face, expected.face));
                times[index] = expected.t;
                poses[index] = new Pose(actual);
            }

            var contactT = item.hasImpulse ? item.impulseT : (double?)null;
            var unityMaximum = MaximumAngularAcceleration(times, poses, contactT);
            var line = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "VANDE_BAT_PARITY id={0} knots={1} probes={2} maxGripDiffM={3:E3} maxToeDiffM={4:E3} " +
                "maxFaceDiff={5:E3} unityMaxAngularAccelRadps2={6:F6} tsMaxAngularAccelRadps2={7:F6} " +
                "accelDelta={8:E3} limit={9}+{10}",
                item.id, item.bat.Length, item.reference.Length, maxGrip, maxToe, maxFace, unityMaximum,
                item.typescriptMaximumAngularAccelerationRadps2,
                Math.Abs(unityMaximum - item.typescriptMaximumAngularAccelerationRadps2),
                fixture.angularAccelerationLimitRadps2, AngularAccelerationAllowanceRadps2);
            Debug.Log(line);
            TestContext.Out.WriteLine(line);

            Assert.That(maxGrip, Is.LessThanOrEqualTo(PoseTolerance), item.id + " grip parity");
            Assert.That(maxToe, Is.LessThanOrEqualTo(PoseTolerance), item.id + " toe parity");
            Assert.That(maxFace, Is.LessThanOrEqualTo(PoseTolerance), item.id + " face parity");
            Assert.That(unityMaximum,
                Is.LessThanOrEqualTo(fixture.angularAccelerationLimitRadps2 + AngularAccelerationAllowanceRadps2),
                item.id + " presented angular acceleration");
            Assert.That(unityMaximum,
                Is.EqualTo(item.typescriptMaximumAngularAccelerationRadps2).Within(0.001),
                item.id + " presented angular acceleration must equal the TS audit's");
        }

        // scripts/practice-reach-corpus.test.ts: angular velocity from consecutive bat frames
        // (axis = grip - toe, n = face, w = axis x n; R = B A^T), then |w_after - w_before| / mean dt, skipping the
        // one interval pair that spans the exact contact impulse.
        private static double MaximumAngularAcceleration(double[] times, Pose[] poses, double? contactT)
        {
            var count = poses.Length - 1;
            if (count < 2) return 0.0;
            var t0 = new double[count];
            var t1 = new double[count];
            var angular = new Vec[count];
            for (var index = 1; index < poses.Length; index++)
            {
                t0[index - 1] = times[index - 1];
                t1[index - 1] = times[index];
                angular[index - 1] = AngularVelocity(poses[index - 1], poses[index], times[index] - times[index - 1]);
            }

            var maximum = 0.0;
            for (var index = 1; index < count; index++)
            {
                if (contactT.HasValue && t1[index - 1] <= contactT.Value && t0[index] >= contactT.Value) continue;
                var dt = ((t1[index - 1] - t0[index - 1]) + (t1[index] - t0[index])) / 2.0;
                maximum = Math.Max(maximum, (angular[index] - angular[index - 1]).Length / dt);
            }
            return maximum;
        }

        private static Vec AngularVelocity(Pose a, Pose b, double dt)
        {
            var aa = a.Axis;
            var an = a.Face;
            var aw = Vec.Cross(aa, an);
            var ba = b.Axis;
            var bn = b.Face;
            var bw = Vec.Cross(ba, bn);
            var r00 = ba.X * aa.X + bn.X * an.X + bw.X * aw.X;
            var r01 = ba.X * aa.Y + bn.X * an.Y + bw.X * aw.Y;
            var r02 = ba.X * aa.Z + bn.X * an.Z + bw.X * aw.Z;
            var r10 = ba.Y * aa.X + bn.Y * an.X + bw.Y * aw.X;
            var r11 = ba.Y * aa.Y + bn.Y * an.Y + bw.Y * aw.Y;
            var r12 = ba.Y * aa.Z + bn.Y * an.Z + bw.Y * aw.Z;
            var r20 = ba.Z * aa.X + bn.Z * an.X + bw.Z * aw.X;
            var r21 = ba.Z * aa.Y + bn.Z * an.Y + bw.Z * aw.Y;
            var r22 = ba.Z * aa.Z + bn.Z * an.Z + bw.Z * aw.Z;
            var theta = Math.Acos(Math.Max(-1.0, Math.Min(1.0, (r00 + r11 + r22 - 1.0) / 2.0)));
            var vee = new Vec(r21 - r12, r02 - r20, r10 - r01);
            if (theta < 1e-8) return vee * (0.5 / dt);
            return vee * (theta / (2.0 * Math.Sin(theta) * dt));
        }

        private static double MaxComponentDifference(TraceVector3 actual, TraceVector3 expected)
        {
            Assert.That(actual, Is.Not.Null);
            Assert.That(expected, Is.Not.Null);
            return Math.Max(Math.Abs(actual.x - expected.x),
                Math.Max(Math.Abs(actual.y - expected.y), Math.Abs(actual.z - expected.z)));
        }

        private static ParityCase Case(ParityFixture fixture, string id)
        {
            foreach (var item in fixture.cases)
                if (item != null && string.Equals(item.id, id, StringComparison.Ordinal)) return item;
            return null;
        }

        private static ParityFixture Fixture()
        {
            if (cached != null) return cached;
            var path = RepositoryPath("tests", "fixtures", "unity-practice", "bat-interpolation-v3-5b.json");
            Assert.That(File.Exists(path), Is.True, "TS bat interpolation reference must remain at " + path);
            cached = JsonUtility.FromJson<ParityFixture>(File.ReadAllText(path));
            Assert.That(cached, Is.Not.Null);
            Assert.That(cached.cases, Is.Not.Null.And.Not.Empty);
            return cached;
        }

        private static string RepositoryPath(params string[] parts)
        {
            var path = Path.Combine(Application.dataPath, "..", "..", "..");
            foreach (var part in parts) path = Path.Combine(path, part);
            return Path.GetFullPath(path);
        }

        private static string Sha256(string path)
        {
            Assert.That(File.Exists(path), Is.True, path);
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(File.ReadAllBytes(path));
                return BitConverter.ToString(hash).Replace("-", string.Empty).ToLowerInvariant();
            }
        }

        private readonly struct Vec
        {
            public readonly double X;
            public readonly double Y;
            public readonly double Z;

            public Vec(double x, double y, double z)
            {
                X = x;
                Y = y;
                Z = z;
            }

            public Vec(TraceVector3 value) : this(value.x, value.y, value.z) { }

            public double Length => Math.Sqrt(X * X + Y * Y + Z * Z);
            public static Vec operator -(Vec a, Vec b) => new Vec(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
            public static Vec operator *(Vec a, double k) => new Vec(a.X * k, a.Y * k, a.Z * k);
            public static Vec Cross(Vec a, Vec b) =>
                new Vec(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X);
        }

        private readonly struct Pose
        {
            public readonly Vec Axis;
            public readonly Vec Face;

            public Pose(BatTraceSample sample)
            {
                var span = new Vec(sample.grip) - new Vec(sample.toe);
                Axis = span * (1.0 / span.Length);
                Face = new Vec(sample.face);
            }
        }

        [Serializable] private sealed class ParityFixture
        {
            public string schema;
            public string frameSha256;
            public string goldenSha256;
            public double angularAccelerationLimitRadps2;
            public ParityCase[] cases;
        }

        [Serializable] private sealed class ParityCase
        {
            public string id;
            public bool hasImpulse;
            public double impulseT;
            public double velocityPeakT;
            public BatTraceSample[] bat;
            public BatTraceSample[] reference;
            public double typescriptMaximumAngularAccelerationRadps2;
        }
    }
}
