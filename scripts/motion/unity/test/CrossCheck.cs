// CrossCheck.cs: compares the C# VMP1 decoder (../VandeMotionPack.cs) with the vmp.ts reference dump from dump.mjs.
//
// Build and run with Unity's bundled .NET 6 host and Roslyn: scripts/motion/unity/test/run.sh <outDir>.
//   dotnet CrossCheck.dll <outDir>   (reads <outDir>/manifest.json, writes <outDir>/results.json; exit 0 = pass)
//
// The harness is not shipped. It may use reflection (the IL allocation scan) and System.Text.Json; the decoder may not.
//
// Checks:
// 1. Pack and clip metadata, markers, track descriptors and the raw decoded frames, against vmp.ts.
// 2. Every sample: rotations (hemisphere-aligned) and tracks within 1e-6; root, ground and bat within 1e-6;
//    contacts exact; frame within 1e-9; overlay bones the clip does not drive keep the sentinel, and an overlay
//    without the hips leaves the root and ground (v1.2.3).
// 2b. Rig mirror: every sample again with Sample(mirror: true) equals the canonical mirror of the vmp.ts sample
//    (within 1e-6), and for every mirror alias, source+mirror == alias and alias+mirror == source bit for bit.
// 3. Fuzz: every corrupted pack gets the same outcome as vmp.ts (the same message, or accepted with the same digest),
//    and nothing but VmpFormatException is ever thrown.
// 4. Exhaustive truncation of every pack, raw and with the header re-fixed: always VmpFormatException.
// 5. Allocation: GC.GetAllocatedBytesForCurrentThread over 1,000,000 samples must not move. Plus an IL scan of the
//    per-frame API: every newobj must construct an Exception and be followed by throw; no newarr and no box.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Reflection.Emit;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Vande.Practice.MotionPacks;

internal static class CrossCheck
{
    private const double QuatTol = 1e-6;
    private const double TrackTol = 1e-6;
    private const double PosTol = 1e-6;
    private const double FrameTol = 1e-9;

    private static readonly List<string> failures = new List<string>();
    private static readonly StringBuilder log = new StringBuilder();

    private sealed class Max
    {
        public double Value;
        public string Where = "";

        public void Add(double e, string where)
        {
            if (double.IsNaN(e)) e = double.PositiveInfinity;
            if (e > Value)
            {
                Value = e;
                Where = where;
            }
        }
    }

    private static void Fail(string message)
    {
        if (failures.Count < 200) failures.Add(message);
        else if (failures.Count == 200) failures.Add("… more failures suppressed");
    }

    private static void Check(bool ok, string message)
    {
        if (!ok) Fail(message);
    }

    private static double[] Doubles(JsonElement e)
    {
        var a = new double[e.GetArrayLength()];
        var i = 0;
        foreach (var x in e.EnumerateArray()) a[i++] = x.ValueKind == JsonValueKind.Null ? double.NaN : x.GetDouble();
        return a;
    }

    private static double D(JsonElement e) => e.ValueKind == JsonValueKind.Null ? double.NaN : e.GetDouble();

    private static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("usage: CrossCheck <outDir>");
            return 2;
        }
        var outDir = args[0];
        var manifest = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(outDir, "manifest.json"))).RootElement;
        var sentinel = (float)manifest.GetProperty("sentinel").GetDouble();

        var maxQuat = new Max();
        var maxTrack = new Max();
        var maxRoot = new Max();
        var maxGround = new Max();
        var maxBat = new Max();
        var maxFrame = new Max();
        var maxRawQuat = new Max();
        var maxRawOther = new Max();
        var maxGait = new Max();
        var maxMirror = new Max();
        long mirrorSamples = 0, aliasPairChecks = 0, aliasPairMismatches = 0;
        long sampleCount = 0, clipCount = 0, aliasCount = 0, fuzzCount = 0, fuzzRejected = 0, truncations = 0;
        var packRows = new List<string>();
        var parsed = new List<VmpPack>();

        foreach (var pm in manifest.GetProperty("packs").EnumerateArray())
        {
            var label = pm.GetProperty("label").GetString();
            var bytes = File.ReadAllBytes(pm.GetProperty("path").GetString());
            string sha;
            using (var h = SHA256.Create()) sha = Convert.ToHexString(h.ComputeHash(bytes)).ToLowerInvariant();
            Check(sha == pm.GetProperty("sha256").GetString(), label + ": bytes on disk differ from the dump");
            var dump = JsonDocument.Parse(File.ReadAllBytes(pm.GetProperty("dump").GetString())).RootElement;

            VmpPack pack;
            try
            {
                pack = VmpPack.Parse(bytes);
            }
            catch (Exception e)
            {
                Fail(label + ": C# failed to parse a pack vmp.ts accepts: " + e.Message);
                continue;
            }
            parsed.Add(pack);
            Check(pack.Bytes == dump.GetProperty("bytes").GetInt32(), label + ": bytes");
            Check(pack.Crc == dump.GetProperty("crc").GetUInt32(), label + ": crc");
            var names = dump.GetProperty("names");
            Check(pack.ClipCount == names.GetArrayLength(), label + ": clip count");
            var ni = 0;
            foreach (var n in names.EnumerateArray())
            {
                if (ni < pack.ClipCount) Check(pack.GetClip(ni).Name == n.GetString(), label + ": directory order at " + ni);
                ni++;
            }

            long packSamples = 0;
            var pose = new VmpPose(pack.MaxTrackCount);
            var mpose = new VmpPose(pack.MaxTrackCount);
            var pa = new VmpPose(pack.MaxTrackCount);
            var pb = new VmpPose(pack.MaxTrackCount);
            foreach (var cj in dump.GetProperty("clips").EnumerateArray())
            {
                var name = cj.GetProperty("name").GetString();
                var where = label + "/" + name;
                VmpClip clip;
                if (!pack.TryGetClip(name, out clip))
                {
                    Fail(where + ": missing in C#");
                    continue;
                }
                clipCount++;
                if (clip.Mirrored) aliasCount++;
                CompareMeta(clip, cj, where);
                CompareRaw(clip, cj, where, maxRawQuat, maxRawOther);
                foreach (var gr in cj.GetProperty("gaitRate").EnumerateArray())
                {
                    var g = Doubles(gr);
                    maxGait.Add(Math.Abs(clip.GaitRate(g[0], g[1]) - g[2]), where);
                }

                var trackKinds = Doubles(cj.GetProperty("trackKinds"));
                foreach (var s in cj.GetProperty("samples").EnumerateArray())
                {
                    var t = s.GetProperty("t").GetDouble();
                    var scale = s.GetProperty("s").GetDouble();
                    var at = where + " t=" + t.ToString("R", CultureInfo.InvariantCulture) + " s=" + scale.ToString("R", CultureInfo.InvariantCulture);
                    pose.Clear(); // as the dump: root and ground zero, rotations at the sentinel
                    for (var i = 0; i < pose.Rotations.Length; i++) pose.Rotations[i] = sentinel;
                    clip.Sample(t, pose, scale);
                    sampleCount++;
                    packSamples++;

                    var q = Doubles(s.GetProperty("q"));
                    for (var b = 0; b < Vmp.BoneCount; b++)
                    {
                        double ePlus = 0, eMinus = 0;
                        for (var k = 0; k < 4; k++)
                        {
                            double cs = pose.Rotations[b * 4 + k], rs = q[b * 4 + k];
                            ePlus = Math.Max(ePlus, Math.Abs(cs - rs));
                            eMinus = Math.Max(eMinus, Math.Abs(cs + rs));
                        }
                        maxQuat.Add(Math.Min(ePlus, eMinus), at + " bone " + b);
                        var driven = ((pose.DrivenMask >> b) & 1u) != 0;
                        if (!driven)
                        {
                            for (var k = 0; k < 4; k++)
                                Check(pose.Rotations[b * 4 + k] == sentinel, at + ": C# wrote undriven overlay bone " + b);
                        }
                    }
                    var root = Doubles(s.GetProperty("root"));
                    maxRoot.Add(Math.Abs(pose.RootX - root[0]), at + " root x");
                    maxRoot.Add(Math.Abs(pose.RootY - root[1]), at + " root y");
                    maxRoot.Add(Math.Abs(pose.RootZ - root[2]), at + " root z");
                    var ground = Doubles(s.GetProperty("ground"));
                    maxGround.Add(Math.Abs(pose.GroundX - ground[0]), at + " ground x");
                    maxGround.Add(Math.Abs(pose.GroundZ - ground[1]), at + " ground z");
                    maxGround.Add(Math.Abs(pose.GroundYawDeg - ground[2]), at + " ground yaw");
                    Check(pose.Contacts == s.GetProperty("contacts").GetInt32(), at + ": contacts " + pose.Contacts);
                    maxFrame.Add(Math.Abs(pose.Frame - D(s.GetProperty("frame"))), at + " frame");

                    var tr = s.GetProperty("tracks");
                    Check(pose.TrackCount == tr.GetArrayLength(), at + ": track count");
                    var k3 = 0;
                    foreach (var tv in tr.EnumerateArray())
                    {
                        var v = Doubles(tv);
                        var c = pose.Track(k3);
                        maxTrack.Add(Math.Max(Math.Abs(c.X - v[0]), Math.Max(Math.Abs(c.Y - v[1]), Math.Abs(c.Z - v[2]))), at + " track " + k3);
                        k3++;
                    }

                    VmpVector3 grip, dir, face;
                    bool hasFace;
                    var hasBat = pose.TryGetBat(out grip, out dir, out face, out hasFace);
                    var bat = s.GetProperty("bat");
                    if (bat.ValueKind == JsonValueKind.Null)
                    {
                        Check(!hasBat, at + ": C# reports a bat vmp.ts does not");
                    }
                    else
                    {
                        Check(hasBat, at + ": C# misses the bat");
                        maxBat.Add(Err(grip, Doubles(bat.GetProperty("grip"))), at + " bat.grip");
                        maxBat.Add(Err(dir, Doubles(bat.GetProperty("dir"))), at + " bat.dir");
                        JsonElement fj;
                        var refFace = bat.TryGetProperty("face", out fj);
                        Check(refFace == hasFace, at + ": bat.face presence");
                        if (refFace && hasFace) maxBat.Add(Err(face, Doubles(fj)), at + " bat.face");
                    }

                    // Rig mirror: Sample(mirror: true) must equal the canonical mirror (§3) of the vmp.ts sample.
                    Prime(mpose, sentinel);
                    clip.Sample(t, mpose, scale, true);
                    mirrorSamples++;
                    Check(mpose.Mirrored == !clip.Mirrored, at + ": mirror flag");
                    Check(mpose.DrivenMask == Vmp.MirrorMask(pose.DrivenMask), at + ": mirrored driven mask");
                    for (var b = 0; b < Vmp.BoneCount; b++)
                    {
                        var sb = Vmp.MirrorBone(b);
                        if (((mpose.DrivenMask >> b) & 1u) == 0)
                        {
                            for (var k = 0; k < 4; k++)
                                Check(mpose.Rotations[b * 4 + k] == sentinel, at + ": mirror wrote undriven bone " + b);
                            continue;
                        }
                        var want = new[] { q[sb * 4], -q[sb * 4 + 1], -q[sb * 4 + 2], q[sb * 4 + 3] };
                        double ePlus = 0, eMinus = 0;
                        for (var k = 0; k < 4; k++)
                        {
                            ePlus = Math.Max(ePlus, Math.Abs(mpose.Rotations[b * 4 + k] - want[k]));
                            eMinus = Math.Max(eMinus, Math.Abs(mpose.Rotations[b * 4 + k] + want[k]));
                        }
                        maxMirror.Add(Math.Min(ePlus, eMinus), at + " mirror bone " + b);
                    }
                    maxMirror.Add(Math.Abs(mpose.RootX + root[0]), at + " mirror root x");
                    maxMirror.Add(Math.Abs(mpose.RootY - root[1]), at + " mirror root y");
                    maxMirror.Add(Math.Abs(mpose.RootZ - root[2]), at + " mirror root z");
                    maxMirror.Add(Math.Abs(mpose.GroundX + ground[0]), at + " mirror ground x");
                    maxMirror.Add(Math.Abs(mpose.GroundZ - ground[1]), at + " mirror ground z");
                    maxMirror.Add(Math.Abs(mpose.GroundYawDeg + ground[2]), at + " mirror yaw");
                    Check(mpose.Contacts == Vmp.MirrorContacts(s.GetProperty("contacts").GetInt32()), at + ": mirror contacts");
                    Check(mpose.Frame == pose.Frame, at + ": mirror frame");
                    var mk = 0;
                    foreach (var tv in tr.EnumerateArray())
                    {
                        var v = Doubles(tv);
                        var c = mpose.Track(mk);
                        maxMirror.Add(Math.Max(Math.Abs(c.X + v[0]), Math.Max(Math.Abs(c.Y - v[1]), Math.Abs(c.Z - v[2]))), at + " mirror track " + mk);
                        mk++;
                    }
                    VmpVector3 mg, md, mf;
                    bool mhf;
                    var mBat = mpose.TryGetBat(out mg, out md, out mf, out mhf);
                    Check(mBat == hasBat && mhf == hasFace, at + ": mirror bat presence");
                    if (mBat && hasBat)
                    {
                        maxMirror.Add(Math.Max(Math.Abs(mg.X + grip.X), Math.Max(Math.Abs(md.X + dir.X), Math.Abs(mf.X + face.X))), at + " mirror bat x");
                        maxMirror.Add(Math.Max(Math.Abs(mg.Y - grip.Y), Math.Max(Math.Abs(md.Y - dir.Y), Math.Abs(mf.Y - face.Y))), at + " mirror bat y");
                        maxMirror.Add(Math.Max(Math.Abs(mg.Z - grip.Z), Math.Max(Math.Abs(md.Z - dir.Z), Math.Abs(mf.Z - face.Z))), at + " mirror bat z");
                    }
                }

                // A mirror alias and its source through Sample(mirror: true) are one code path: bit for bit, both ways.
                if (clip.Mirrored)
                {
                    var src = pack.GetClip(clip.Source);
                    foreach (var s in cj.GetProperty("samples").EnumerateArray())
                    {
                        var t = s.GetProperty("t").GetDouble();
                        var scale = s.GetProperty("s").GetDouble();
                        for (var way = 0; way < 2; way++)
                        {
                            Prime(pa, sentinel);
                            Prime(pb, sentinel);
                            if (way == 0)
                            {
                                src.Sample(t, pa, scale, true);
                                clip.Sample(t, pb, scale);
                            }
                            else
                            {
                                clip.Sample(t, pa, scale, true);
                                src.Sample(t, pb, scale);
                            }
                            aliasPairChecks++;
                            if (!SameBits(pa, pb))
                            {
                                aliasPairMismatches++;
                                Fail(where + " t=" + t.ToString("R", CultureInfo.InvariantCulture) + ": " +
                                     (way == 0 ? "source mirrored != alias" : "alias mirrored != source"));
                            }
                        }
                    }
                }
            }
            packRows.Add(label + " " + pm.GetProperty("kind").GetString() + " " + bytes.Length + " B sha256 " + sha +
                         " clips " + pack.ClipCount + " samples " + packSamples);

            // Fuzz: identical outcomes to vmp.ts.
            var fuzz = JsonDocument.Parse(File.ReadAllBytes(pm.GetProperty("fuzz").GetString())).RootElement;
            foreach (var fc in fuzz.GetProperty("cases").EnumerateArray())
            {
                fuzzCount++;
                var mutated = ApplyOps(bytes, fc.GetProperty("ops"));
                var expect = fc.GetProperty("expect");
                var expectOk = expect.GetProperty("ok").GetBoolean();
                var ops = fc.GetProperty("ops").GetRawText();
                try
                {
                    var mp = VmpPack.Parse(mutated);
                    if (!expectOk)
                    {
                        Fail(label + " fuzz " + ops + ": C# accepted, vmp.ts threw " + expect.GetProperty("error").GetString());
                        continue;
                    }
                    var en = expect.GetProperty("names");
                    Check(mp.ClipCount == en.GetArrayLength(), label + " fuzz " + ops + ": names");
                    var sum = Digest(mp);
                    var want = expect.GetProperty("sum").GetDouble();
                    Check(Math.Abs(sum - want) <= 1e-4 * Math.Max(1.0, Math.Abs(want)),
                        label + " fuzz " + ops + ": digest " + sum.ToString("R", CultureInfo.InvariantCulture) + " vs " + want.ToString("R", CultureInfo.InvariantCulture));
                }
                catch (VmpFormatException e)
                {
                    fuzzRejected++;
                    if (expectOk) Fail(label + " fuzz " + ops + ": C# threw " + e.Message + ", vmp.ts accepted");
                    else if (e.Message != expect.GetProperty("error").GetString())
                        Fail(label + " fuzz " + ops + ": message '" + e.Message + "' vs vmp.ts '" + expect.GetProperty("error").GetString() + "'");
                }
                catch (Exception e)
                {
                    Fail(label + " fuzz " + ops + ": non-format exception " + e.GetType().Name + ": " + e.Message);
                }
            }

            // Exhaustive truncation, raw and re-fixed.
            for (var len = 0; len < bytes.Length; len++)
            {
                for (var fix = 0; fix < 2; fix++)
                {
                    var cut = new byte[len];
                    Buffer.BlockCopy(bytes, 0, cut, 0, len);
                    if (fix == 1) FixHeader(cut);
                    truncations++;
                    try
                    {
                        VmpPack.Parse(cut);
                        Fail(label + ": truncation to " + len + (fix == 1 ? " (fixed)" : "") + " was accepted");
                    }
                    catch (VmpFormatException)
                    {
                    }
                    catch (Exception e)
                    {
                        Fail(label + ": truncation to " + len + ": non-format exception " + e.GetType().Name + ": " + e.Message);
                    }
                }
            }
        }

        // Bad arguments fail cleanly too.
        ExpectThrow<ArgumentNullException>(() => VmpPack.Parse(null), "Parse(null)");
        if (parsed.Count > 0 && parsed[0].ClipCount > 0)
        {
            var c0 = parsed[0].GetClip(0);
            ExpectThrow<ArgumentException>(() => c0.Sample(double.NaN, new VmpPose(8)), "Sample(NaN)");
            ExpectThrow<ArgumentException>(() => c0.Sample(double.PositiveInfinity, new VmpPose(8)), "Sample(+inf)");
            ExpectThrow<ArgumentNullException>(() => c0.Sample(0.1, null), "Sample(pose null)");
        }
        VmpClip withTracks = null;
        foreach (var p in parsed)
            for (var i = 0; i < p.ClipCount && withTracks == null; i++)
                if (p.GetClip(i).TrackCount > 0) withTracks = p.GetClip(i);
        if (withTracks != null) ExpectThrow<ArgumentException>(() => withTracks.Sample(0.1, new VmpPose(0)), "Sample(pose too small)");

        var alloc = AllocationCheck(parsed);
        var il = IlScan();

        var pass = failures.Count == 0 && maxQuat.Value <= QuatTol && maxTrack.Value <= TrackTol && maxRoot.Value <= PosTol &&
                   maxGround.Value <= PosTol && maxBat.Value <= TrackTol && maxFrame.Value <= FrameTol &&
                   maxGait.Value <= 1e-12 && maxMirror.Value <= QuatTol && aliasPairMismatches == 0 &&
                   alloc.Item1 == 0 && il.Item1;

        var r = new StringBuilder();
        r.Append("{\n");
        r.Append("  \"pass\": ").Append(pass ? "true" : "false").Append(",\n");
        r.Append("  \"utc\": \"").Append(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)).Append("\",\n");
        r.Append("  \"runtime\": \"").Append(Environment.Version).Append(' ').Append(System.Runtime.InteropServices.RuntimeInformation.OSArchitecture).Append("\",\n");
        r.Append("  \"packs\": [").Append(JoinQuoted(packRows)).Append("],\n");
        r.Append("  \"clips\": ").Append(clipCount).Append(", \"aliases\": ").Append(aliasCount).Append(", \"samples\": ").Append(sampleCount).Append(",\n");
        AppendMax(r, "maxQuatErr", maxQuat);
        AppendMax(r, "maxTrackErr", maxTrack);
        AppendMax(r, "maxRootErr", maxRoot);
        AppendMax(r, "maxGroundErr", maxGround);
        AppendMax(r, "maxBatErr", maxBat);
        AppendMax(r, "maxFrameErr", maxFrame);
        AppendMax(r, "maxRawQuatErr", maxRawQuat);
        AppendMax(r, "maxRawOtherErr", maxRawOther);
        AppendMax(r, "maxGaitRateErr", maxGait);
        AppendMax(r, "maxRigMirrorErr", maxMirror);
        r.Append("  \"rigMirrorSamples\": ").Append(mirrorSamples).Append(", \"aliasPairChecks\": ").Append(aliasPairChecks)
            .Append(", \"aliasPairBitMismatches\": ").Append(aliasPairMismatches).Append(",\n");
        r.Append("  \"fuzzCases\": ").Append(fuzzCount).Append(", \"fuzzRejected\": ").Append(fuzzRejected).Append(", \"truncations\": ").Append(truncations).Append(",\n");
        r.Append("  \"allocBytes\": ").Append(alloc.Item1).Append(", \"allocSamples\": ").Append(alloc.Item2).Append(", \"nsPerSample\": ").Append(alloc.Item3.ToString("F1", CultureInfo.InvariantCulture)).Append(",\n");
        r.Append("  \"ilScan\": ").Append(Quote(il.Item2)).Append(",\n");
        r.Append("  \"failures\": [").Append(JoinQuoted(failures)).Append("]\n");
        r.Append("}\n");
        File.WriteAllText(Path.Combine(outDir, "results.json"), r.ToString());
        Console.Write(r.ToString());
        return pass ? 0 : 1;
    }

    private static void Prime(VmpPose p, float sentinel)
    {
        p.Clear();
        for (var i = 0; i < p.Rotations.Length; i++) p.Rotations[i] = sentinel;
    }

    private static bool SameBits(VmpPose a, VmpPose b)
    {
        for (var i = 0; i < a.Rotations.Length; i++)
            if (BitConverter.SingleToInt32Bits(a.Rotations[i]) != BitConverter.SingleToInt32Bits(b.Rotations[i])) return false;
        if (a.TrackCount != b.TrackCount) return false;
        for (var i = 0; i < a.TrackCount * 3; i++)
            if (BitConverter.SingleToInt32Bits(a.Tracks[i]) != BitConverter.SingleToInt32Bits(b.Tracks[i])) return false;
        return BitConverter.SingleToInt32Bits(a.RootX) == BitConverter.SingleToInt32Bits(b.RootX) &&
               BitConverter.SingleToInt32Bits(a.RootY) == BitConverter.SingleToInt32Bits(b.RootY) &&
               BitConverter.SingleToInt32Bits(a.RootZ) == BitConverter.SingleToInt32Bits(b.RootZ) &&
               BitConverter.DoubleToInt64Bits(a.GroundX) == BitConverter.DoubleToInt64Bits(b.GroundX) &&
               BitConverter.DoubleToInt64Bits(a.GroundZ) == BitConverter.DoubleToInt64Bits(b.GroundZ) &&
               BitConverter.DoubleToInt64Bits(a.GroundYawDeg) == BitConverter.DoubleToInt64Bits(b.GroundYawDeg) &&
               a.Contacts == b.Contacts && a.Frame == b.Frame && a.DrivenMask == b.DrivenMask && a.Mirrored == b.Mirrored;
    }

    private static double Err(VmpVector3 c, double[] r)
    {
        return Math.Max(Math.Abs(c.X - r[0]), Math.Max(Math.Abs(c.Y - r[1]), Math.Abs(c.Z - r[2])));
    }

    private static void CompareMeta(VmpClip c, JsonElement j, string where)
    {
        Check(c.Mirrored == j.GetProperty("mirrored").GetBoolean(), where + ": mirrored");
        Check(c.Source == j.GetProperty("source").GetString(), where + ": source");
        Check(c.Flags == j.GetProperty("flags").GetInt32(), where + ": flags");
        Check(c.Rate == j.GetProperty("rate").GetInt32(), where + ": rate");
        Check(c.FrameCount == j.GetProperty("frameCount").GetInt32(), where + ": frameCount");
        Check(c.BoneMask == j.GetProperty("boneMask").GetUInt32(), where + ": boneMask");
        Check(c.Codec == j.GetProperty("codec").GetInt32(), where + ": codec");
        Check(c.Duration == j.GetProperty("duration").GetDouble(), where + ": duration");
        Check(c.SpeedMps == j.GetProperty("speedMps").GetDouble(), where + ": speedMps");
        var tr = Doubles(j.GetProperty("travel"));
        Check(c.TravelX == tr[0] && c.TravelZ == tr[1] && c.TravelYawDeg == tr[2], where + ": travel");
        Check(c.CycleSteps == j.GetProperty("cycleSteps").GetDouble(), where + ": cycleSteps");
        Check(c.Role == j.GetProperty("role").GetString(), where + ": role");
        // vmp.ts markers are an object: first-appearance order, last value wins.
        var order = new List<string>();
        for (var i = 0; i < c.MarkerCount; i++)
            if (!order.Contains(c.MarkerName(i))) order.Add(c.MarkerName(i));
        var mj = j.GetProperty("markers");
        Check(order.Count == mj.GetArrayLength(), where + ": marker count");
        var mi = 0;
        foreach (var m in mj.EnumerateArray())
        {
            var mn = m[0].GetString();
            float mt;
            Check(mi < order.Count && order[mi] == mn, where + ": marker order " + mn);
            Check(c.TryGetMarker(mn, out mt) && mt == m[1].GetDouble(), where + ": marker " + mn);
            mi++;
        }
        var tn = j.GetProperty("trackNames");
        var tk = Doubles(j.GetProperty("trackKinds"));
        Check(c.TrackCount == tn.GetArrayLength(), where + ": track count");
        var k = 0;
        foreach (var n in tn.EnumerateArray())
        {
            if (k < c.TrackCount)
            {
                Check(c.TrackName(k) == n.GetString(), where + ": track name " + k);
                Check(c.TrackKind(k) == (int)tk[k], where + ": track kind " + k);
                Check(c.IndexOfTrack(n.GetString()) <= k, where + ": IndexOfTrack " + n.GetString());
            }
            k++;
        }
    }

    private static void CompareRaw(VmpClip c, JsonElement j, string where, Max quat, Max other)
    {
        var F = c.FrameCount;
        var ground = Doubles(j.GetProperty("ground"));
        var hips = Doubles(j.GetProperty("hips"));
        var contacts = Doubles(j.GetProperty("contactsRaw"));
        var quats = Doubles(j.GetProperty("quats"));
        Check(ground.Length == F * 3 && hips.Length == F * 3 && contacts.Length == F && quats.Length == F * 68, where + ": raw lengths");
        if (ground.Length != F * 3 || quats.Length != F * 68) return;
        for (var f = 0; f < F; f++)
        {
            float x, y, z, w;
            c.GetGroundFrame(f, out x, out z, out y);
            other.Add(Math.Max(Math.Abs(x - ground[f * 3]), Math.Max(Math.Abs(z - ground[f * 3 + 1]), Math.Abs(y - ground[f * 3 + 2]))), where + " raw ground " + f);
            c.GetHipsFrame(f, out x, out y, out z);
            other.Add(Math.Max(Math.Abs(x - hips[f * 3]), Math.Max(Math.Abs(y - hips[f * 3 + 1]), Math.Abs(z - hips[f * 3 + 2]))), where + " raw hips " + f);
            Check(c.GetContactsFrame(f) == (int)contacts[f], where + ": raw contacts " + f);
            for (var b = 0; b < Vmp.BoneCount; b++)
            {
                c.GetRotationFrame(f, b, out x, out y, out z, out w);
                var o = (f * 17 + b) * 4;
                quat.Add(Math.Max(Math.Max(Math.Abs(x - quats[o]), Math.Abs(y - quats[o + 1])), Math.Max(Math.Abs(z - quats[o + 2]), Math.Abs(w - quats[o + 3]))), where + " raw quat " + f + "/" + b);
            }
        }
        var k = 0;
        foreach (var tj in j.GetProperty("tracksRaw").EnumerateArray())
        {
            var a = Doubles(tj);
            for (var f = 0; f < F; f++)
            {
                float x, y, z;
                c.GetTrackFrame(k, f, out x, out y, out z);
                other.Add(Math.Max(Math.Abs(x - a[f * 3]), Math.Max(Math.Abs(y - a[f * 3 + 1]), Math.Abs(z - a[f * 3 + 2]))), where + " raw track " + k + " " + f);
            }
            k++;
        }
    }

    private static byte[] ApplyOps(byte[] src, JsonElement ops)
    {
        var b = (byte[])src.Clone();
        var fix = false;
        foreach (var op in ops.EnumerateArray())
        {
            var kind = op[0].GetString();
            if (kind == "t")
            {
                var n = new byte[op[1].GetInt32()];
                Buffer.BlockCopy(b, 0, n, 0, n.Length);
                b = n;
            }
            else if (kind == "a")
            {
                var n = new byte[b.Length + op[1].GetInt32()];
                Buffer.BlockCopy(b, 0, n, 0, b.Length);
                b = n;
            }
            else if (kind == "x") b[op[1].GetInt32()] ^= (byte)op[2].GetInt32();
            else if (kind == "s") b[op[1].GetInt32()] = (byte)op[2].GetInt32();
            else if (kind == "fix") fix = true;
            else throw new InvalidOperationException("bad op " + kind);
        }
        if (fix) FixHeader(b);
        return b;
    }

    private static void FixHeader(byte[] b)
    {
        if (b.Length >= 28) PutU32(b, 24, (uint)b.Length);
        if (b.Length >= 32) PutU32(b, 28, Vmp.Crc32(b, 32, b.Length));
    }

    private static void PutU32(byte[] b, int o, uint v)
    {
        b[o] = (byte)v;
        b[o + 1] = (byte)(v >> 8);
        b[o + 2] = (byte)(v >> 16);
        b[o + 3] = (byte)(v >> 24);
    }

    private static double Digest(VmpPack p)
    {
        double sum = 0;
        var pose = new VmpPose(p.MaxTrackCount);
        for (var i = 0; i < p.ClipCount; i++)
        {
            var c = p.GetClip(i);
            pose.Clear();
            c.Sample(0.37 * c.Duration, pose, 1.0);
            for (var k = 0; k < pose.Rotations.Length; k++) sum += pose.Rotations[k];
            sum += pose.RootX + (double)pose.RootY + pose.RootZ + pose.GroundX + pose.GroundZ + pose.GroundYawDeg + pose.Contacts;
        }
        return sum;
    }

    private static void ExpectThrow<T>(Action a, string what) where T : Exception
    {
        try
        {
            a();
            Fail(what + ": did not throw");
        }
        catch (T)
        {
        }
        catch (Exception e)
        {
            Fail(what + ": threw " + e.GetType().Name + " instead of " + typeof(T).Name);
        }
    }

    // ---- Allocation --------------------------------------------------------------------------------------------

    private static Tuple<long, long, double> AllocationCheck(List<VmpPack> packs)
    {
        var clips = new List<VmpClip>();
        var maxTracks = 0;
        foreach (var p in packs)
        {
            for (var i = 0; i < p.ClipCount; i++) clips.Add(p.GetClip(i));
            maxTracks = Math.Max(maxTracks, p.MaxTrackCount);
        }
        if (clips.Count == 0) return Tuple.Create(0L, 0L, 0.0);
        var arr = clips.ToArray();
        var pose = new VmpPose(maxTracks);
        double sink = 0;
        // Warm up (JIT and tiering), then measure on this thread.
        sink += Loop(arr, pose, 200000);
        System.Threading.Thread.Sleep(200);
        sink += Loop(arr, pose, 200000);
        const long n = 1000000;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var before = GC.GetAllocatedBytesForCurrentThread();
        sink += Loop(arr, pose, n);
        var after = GC.GetAllocatedBytesForCurrentThread();
        sw.Stop();
        if (double.IsNaN(sink)) Console.WriteLine("sink");
        return Tuple.Create(after - before, n, sw.Elapsed.TotalMilliseconds * 1e6 / n);
    }

    private static double Loop(VmpClip[] clips, VmpPose pose, long n)
    {
        double sink = 0;
        var t = -0.75;
        VmpVector3 a, b, c, v;
        bool hf;
        float mt;
        for (long i = 0; i < n; i++)
        {
            var clip = clips[i % clips.Length];
            t += 0.0137;
            if (t > 9.0) t = -0.75;
            clip.Sample(t, pose, (i & 3) == 0 ? 0.93 : 1.0, (i & 7) == 5);
            sink += pose.Rotations[3] + pose.RootY + pose.GroundX + pose.Contacts;
            if (pose.TryGetBat(out a, out b, out c, out hf)) sink += a.X + b.Y + c.Z;
            if (pose.TryGetTrack("ball.hand", out v)) sink += v.Y;
            if (clip.TryGetMarker("release", out mt)) sink += mt;
            sink += clip.GaitRate(3.3, 0.95);
        }
        return sink;
    }

    // ---- IL scan -----------------------------------------------------------------------------------------------

    private static readonly Dictionary<short, OpCode> opcodes = BuildOpcodes();

    private static Dictionary<short, OpCode> BuildOpcodes()
    {
        var d = new Dictionary<short, OpCode>();
        foreach (var f in typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static))
        {
            var o = (OpCode)f.GetValue(null);
            d[o.Value] = o;
        }
        return d;
    }

    private static Tuple<bool, string> IlScan()
    {
        var asm = typeof(VmpClip).Assembly;
        var roots = new List<MethodBase>
        {
            typeof(VmpClip).GetMethod("Sample"),
            typeof(VmpClip).GetMethod("GaitRate"),
            typeof(VmpClip).GetMethod("TryGetMarker"),
            typeof(VmpClip).GetMethod("IndexOfTrack"),
            typeof(VmpPose).GetMethod("TryGetBat"),
            typeof(VmpPose).GetMethod("TryGetTrack"),
            typeof(VmpPose).GetMethod("Track")
        };
        var seen = new HashSet<MethodBase>();
        var queue = new Queue<MethodBase>(roots);
        var ok = true;
        var sites = new List<string>();
        var external = new SortedSet<string>();
        while (queue.Count > 0)
        {
            var m = queue.Dequeue();
            if (m == null || !seen.Add(m)) continue;
            var body = m.GetMethodBody();
            if (body == null) continue;
            var il = body.GetILAsByteArray();
            var pc = 0;
            while (pc < il.Length)
            {
                short value = il[pc];
                var size = 1;
                if (il[pc] == 0xFE)
                {
                    value = (short)(0xFE00 | il[pc + 1]);
                    size = 2;
                }
                var op = opcodes[value];
                var operand = pc + size;
                var next = operand + OperandSize(op, il, operand);
                if (op == OpCodes.Newobj)
                {
                    var ctor = m.Module.ResolveMethod(BitConverter.ToInt32(il, operand));
                    if (ctor.DeclaringType.IsValueType)
                    {
                        // newobj on a struct constructs on the stack: not a heap allocation.
                        pc = next;
                        continue;
                    }
                    var isEx = typeof(Exception).IsAssignableFrom(ctor.DeclaringType);
                    var thrown = next < il.Length && il[next] == OpCodes.Throw.Value;
                    sites.Add(m.DeclaringType.Name + "." + m.Name + ": newobj " + ctor.DeclaringType.Name + (thrown ? " + throw" : " (NOT thrown)"));
                    if (!isEx || !thrown) ok = false;
                }
                else if (op == OpCodes.Newarr || op == OpCodes.Box)
                {
                    sites.Add(m.DeclaringType.Name + "." + m.Name + ": " + op.Name);
                    ok = false;
                }
                else if (op == OpCodes.Call || op == OpCodes.Callvirt)
                {
                    var callee = m.Module.ResolveMethod(BitConverter.ToInt32(il, operand));
                    if (callee.DeclaringType.Assembly == asm) queue.Enqueue(callee);
                    else external.Add(callee.DeclaringType.Name + "." + callee.Name);
                }
                pc = next;
            }
        }
        var names = new List<string>();
        foreach (var m in seen) names.Add(m.DeclaringType.Name + "." + m.Name);
        names.Sort(StringComparer.Ordinal);
        var summary = (ok ? "PASS" : "FAIL") + "; methods scanned: " + string.Join(", ", names) + "; allocation sites: " +
                      (sites.Count == 0 ? "none" : string.Join("; ", sites)) + "; external calls: " + string.Join(", ", external);
        return Tuple.Create(ok, summary);
    }

    private static int OperandSize(OpCode op, byte[] il, int at)
    {
        switch (op.OperandType)
        {
            case OperandType.InlineNone: return 0;
            case OperandType.ShortInlineBrTarget:
            case OperandType.ShortInlineI:
            case OperandType.ShortInlineVar: return 1;
            case OperandType.InlineVar: return 2;
            case OperandType.InlineI8:
            case OperandType.InlineR: return 8;
            case OperandType.InlineSwitch: return 4 + 4 * BitConverter.ToInt32(il, at);
            default: return 4;
        }
    }

    // ---- JSON helpers ------------------------------------------------------------------------------------------

    private static void AppendMax(StringBuilder r, string key, Max m)
    {
        r.Append("  \"").Append(key).Append("\": ").Append(m.Value.ToString("R", CultureInfo.InvariantCulture))
            .Append(", \"").Append(key).Append("At\": ").Append(Quote(m.Where)).Append(",\n");
    }

    private static string Quote(string s)
    {
        return JsonSerializer.Serialize(s ?? "");
    }

    private static string JoinQuoted(List<string> items)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < items.Count; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append(Quote(items[i]));
        }
        return sb.ToString();
    }
}
