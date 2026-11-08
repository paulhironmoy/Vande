using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The Unity VMP1 decoder is a vendored copy of MOTION-CS's reference (scripts/motion/unity), like the web's
    /// tests/unit/render3d/motionVendored.test.ts. The copy must stay byte-identical (line endings normalised), so
    /// the rig mirror and every other adapter change lands in the reference first and is then copied, never forked.
    /// </summary>
    public sealed class VandeMotionPackVendoredTests
    {
        private static string RepoRoot =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));

        private static string Normalised(string path) => File.ReadAllText(path).Replace("\r\n", "\n");

        [TestCase("scripts/motion/unity/VandeMotionPack.cs",
            "unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Motion/VandeMotionPack.cs")]
        [TestCase("scripts/motion/unity/test/VandeMotionPackEditModeTests.cs",
            "unity/VandePractice/Assets/VandePractice/Tests/EditMode/VandeMotionPackEditModeTests.cs")]
        public void VendoredCopy_EqualsTheReference(string reference, string copy)
        {
            var referencePath = Path.Combine(RepoRoot, reference);
            var copyPath = Path.Combine(RepoRoot, copy);
            if (!File.Exists(referencePath))
                Assert.Ignore("The reference is not in this checkout: " + reference);
            Assert.That(File.Exists(copyPath), Is.True, copy);
            Assert.That(Normalised(copyPath), Is.EqualTo(Normalised(referencePath)),
                copy + " must be an exact copy of " + reference + "; change the reference, then copy it.");
        }
    }
}
