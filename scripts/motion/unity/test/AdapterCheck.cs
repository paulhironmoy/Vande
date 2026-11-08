// AdapterCheck.cs: runs the UNITY_5_3_OR_NEWER adapter (VmpUnity) outside the editor, on .NET 6.
// It is compiled with VandeMotionPack.cs and UNITY's ProductionCharacterContracts.cs / ProductionCharacterMotion.cs
// (which it reads but does not change) against UnityEngine.CoreModule. It uses only the managed parts of UnityEngine:
// the Quaternion and Vector3 constructors and fields.
//
//   dotnet AdapterCheck.dll <pack.vmp>...   (exit 0 = pass)
//
// For every clip of every pack, at 40 times from before the start to past the end:
// - ApplyTo: Rotations[i] equals the VMP pose's (x, y, z, w) bit for bit for every driven bone; undriven bones keep
//   the base pose; RootOffset = (x · 0.9836, y, z · 0.9836) when the hips are driven, otherwise the base root.
// - mirrorForRig (rigs with anatomically mirrored L/R labels): ApplyTo(mirrorForRig: true) on a plain sample equals,
//   bit for bit, a plain ApplyTo of Sample(mirror: true). The same holds for TryGetBat, TrackVector, GroundPosition and
//   GroundRotation.
// - Mirror aliases: ApplyTo(mirrorForRig: true) of the source equals ApplyTo of the alias, bit for bit.
// - Allocation: Sample + ApplyTo (plain and mirrored) + TryGetBat allocate 0 bytes over 200,000 frames per pack.

using System;
using System.IO;
using UnityEngine;
using Vande.Practice.MotionPacks;
using Vande.Practice.Presentation.Production.Characters;

internal static class AdapterCheck
{
    private static readonly Quaternion BaseRot = new Quaternion(0.1f, 0.2f, 0.3f, 0.9f);
    private static readonly Vector3 BaseRoot = new Vector3(7f, 8f, 9f);
    private static int failures;

    private static void Fail(string m)
    {
        failures++;
        if (failures <= 50) Console.WriteLine(m);
    }

    private static void Prime(ProductionCharacterPose p)
    {
        for (var b = 0; b < Vmp.BoneCount; b++) p.Rotations[b] = BaseRot;
        p.RootOffset = BaseRoot;
    }

    private static bool Same(float a, float b) => BitConverter.SingleToInt32Bits(a) == BitConverter.SingleToInt32Bits(b);
    private static bool Same(Vector3 a, Vector3 b) => Same(a.x, b.x) && Same(a.y, b.y) && Same(a.z, b.z);
    private static bool Same(Quaternion a, Quaternion b) => Same(a.x, b.x) && Same(a.y, b.y) && Same(a.z, b.z) && Same(a.w, b.w);

    private static bool Same(ProductionCharacterPose a, ProductionCharacterPose b)
    {
        for (var j = 0; j < Vmp.BoneCount; j++)
            if (!Same(a.Rotations[j], b.Rotations[j])) return false;
        return Same(a.RootOffset, b.RootOffset);
    }

    private static int Main(string[] args)
    {
        var posesChecked = 0;
        var mirrorChecks = 0;
        var aliasChecks = 0;
        long allocated = 0;
        long frames = 0;
        foreach (var path in args)
        {
            var pack = VmpPack.Parse(File.ReadAllBytes(path));
            if (pack.ClipCount == 0) continue;
            var pose = new VmpPose(pack.MaxTrackCount);
            var mpose = new VmpPose(pack.MaxTrackCount);
            var target = new ProductionCharacterPose();
            var t1 = new ProductionCharacterPose();
            var t2 = new ProductionCharacterPose();
            for (var i = 0; i < pack.ClipCount; i++)
            {
                var clip = pack.GetClip(i);
                var name = Path.GetFileName(path) + "/" + clip.Name;
                for (var s = 0; s < 40; s++)
                {
                    var t = -0.3 + s * (clip.Duration + 0.6) / 39.0;
                    var at = name + " t=" + t;

                    // Plain ApplyTo.
                    Prime(target);
                    pose.Clear();
                    clip.Sample(t, pose, 1.0);
                    pose.ApplyTo(target);
                    posesChecked++;
                    for (var b = 0; b < Vmp.BoneCount; b++)
                    {
                        var driven = ((clip.DrivenMask >> b) & 1u) != 0;
                        var want = driven
                            ? new Quaternion(pose.Rotations[b * 4], pose.Rotations[b * 4 + 1], pose.Rotations[b * 4 + 2], pose.Rotations[b * 4 + 3])
                            : BaseRot;
                        if (!Same(target.Rotations[b], want)) Fail("rotation mismatch " + at + " bone " + b);
                    }
                    var wantRoot = (clip.DrivenMask & 1u) != 0
                        ? new Vector3(pose.RootX * Vmp.UnityDriverHorizontalScale, pose.RootY, pose.RootZ * Vmp.UnityDriverHorizontalScale)
                        : BaseRoot;
                    if (!Same(target.RootOffset, wantRoot)) Fail("root mismatch " + at);

                    // mirrorForRig == Sample(mirror: true) + plain calls.
                    mpose.Clear();
                    clip.Sample(t, mpose, 1.0, true);
                    Prime(t1);
                    Prime(t2);
                    pose.ApplyTo(t1, mirrorForRig: true);
                    mpose.ApplyTo(t2);
                    mirrorChecks++;
                    if (!Same(t1, t2)) Fail("ApplyTo(mirrorForRig) != Sample(mirror) + ApplyTo at " + at);
                    Vector3 g1, d1, f1, g2, d2, f2;
                    bool h1, h2;
                    var b1 = pose.TryGetBat(true, out g1, out d1, out f1, out h1);
                    var b2 = mpose.TryGetBat(false, out g2, out d2, out f2, out h2);
                    // Vectors are meaningful only when present (absent ones are zero, and a mirrored zero x is −0).
                    if (b1 != b2 || h1 != h2 || (b1 && (!Same(g1, g2) || !Same(d1, d2))) || (h1 && !Same(f1, f2)))
                        Fail("TryGetBat(mirrorForRig) mismatch at " + at);
                    for (var k = 0; k < pose.TrackCount; k++)
                        if (!Same(pose.TrackVector(k, true), mpose.TrackVector(k))) Fail("TrackVector(mirrorForRig) mismatch at " + at + " track " + k);
                    if ((clip.DrivenMask & 1u) != 0)
                    {
                        if (!Same(pose.GroundPosition(true), mpose.GroundPosition())) Fail("GroundPosition(mirrorForRig) mismatch at " + at);
                        if (!Same(pose.GroundRotation(true), mpose.GroundRotation())) Fail("GroundRotation(mirrorForRig) mismatch at " + at);
                    }

                    // An alias equals its source through mirrorForRig.
                    if (clip.Mirrored)
                    {
                        var src = pack.GetClip(clip.Source);
                        mpose.Clear();
                        src.Sample(t, mpose, 1.0);
                        Prime(t1);
                        Prime(t2);
                        mpose.ApplyTo(t1, mirrorForRig: true);
                        pose.ApplyTo(t2);
                        aliasChecks++;
                        if (!Same(t1, t2)) Fail("source + mirrorForRig != alias at " + at);
                    }
                }
            }
            for (var w = 0; w < 2; w++) Run(pack, pose, target, 50000);
            var before = GC.GetAllocatedBytesForCurrentThread();
            Run(pack, pose, target, 200000);
            allocated += GC.GetAllocatedBytesForCurrentThread() - before;
            frames += 200000;
        }
        var pass = failures == 0 && allocated == 0;
        Console.WriteLine("{\"adapterPass\": " + (pass ? "true" : "false") + ", \"posesChecked\": " + posesChecked +
                          ", \"mirrorForRigChecks\": " + mirrorChecks + ", \"aliasMirrorChecks\": " + aliasChecks +
                          ", \"failures\": " + failures + ", \"allocBytes\": " + allocated + ", \"allocFrames\": " + frames + "}");
        return pass ? 0 : 1;
    }

    private static void Run(VmpPack pack, VmpPose pose, ProductionCharacterPose target, int n)
    {
        var t = 0.0;
        Vector3 g, d, f;
        bool h;
        for (var i = 0; i < n; i++)
        {
            var clip = pack.GetClip(i % pack.ClipCount);
            t += 0.0167;
            if (t > 6.0) t = -0.2;
            clip.Sample(t, pose, 1.0);
            pose.ApplyTo(target, mirrorForRig: (i & 1) == 1);
            pose.TryGetBat((i & 1) == 1, out g, out d, out f, out h);
        }
    }
}
