// VandeMotionPackEditModeTests.cs: a PROPOSED EditMode test for UNITY. It lives outside Assets; UNITY copies it to
// Assets/VandePractice/Tests/EditMode/ (Vande.Practice.EditMode.Tests, which references Vande.Practice.Runtime) once
// VandeMotionPack.cs is under Assets/VandePractice/Runtime/.
//
// What it checks, under Unity's Mono and IL2CPP code generation:
// - The decoder still matches the vmp.ts reference (MOTION-SPEC v1.2.3): an embedded golden pack, sampled at 8 times. The pack
//   holds a codec-2 overlay, its mirror alias and the bat tracks, plus a codec-1 loop with turning travel. Regenerate
//   it with `node scripts/motion/unity/test/golden.mjs`.
// - Every shipped Resources/Motion pack decodes and samples to unit, finite poses.
// - Sample + ApplyTo allocate nothing (Unity Test Framework Is.Not.AllocatingGCMemory).
// - Truncated or corrupt bytes throw VmpFormatException, never an out-of-range read.
// - ApplyTo copies the components unchanged, scales root x/z by 0.9836 and leaves an overlay's other bones alone.
// - The rig mirror (Sample mirror: true, ApplyTo/TryGetBat mirrorForRig: true) equals the mirror alias, bit for bit.
//
// The full cross-check (every shipped clip against vmp.ts, fuzzing and the IL scan) runs outside Unity:
// scripts/motion/unity/test/run.sh.

using System;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools.Constraints;
using Vande.Practice.MotionPacks;
using Vande.Practice.Presentation.Production.Characters;
using Is = UnityEngine.TestTools.Constraints.Is;

namespace Vande.Practice.Tests
{
    public sealed class VandeMotionPackTests
    {
        private const double Tolerance = 1e-6;

        // 835 bytes
        private const string GoldenPackBase64 = "Vk1QMQEAIAARAAMAST98UfQCAABPAAAAQwMAAA6oHyQBAAAAUAAAAIABAAD//wAACAABANABAAAkAQAABAAAAAQAAADQAQAAJAEAAP//AABWTUMxAQAHABQABAD//wEAAQABAM3MTD4AAMA/mpmZPs3MTD8AAPBBAAAAQAIAAAADAAAAzcxMPQAAAAAAAAAA7P8AAAkAAAII4AqeSeEWumnhBUI44N2l5t7KVabe7omn3y4K2eBMfjnhIpp44M89Z9+jsfbezFV33ymCaOBkHungQ7aY4OGxx99LAMgA7gIKAOz/AAAJAADuieEGCtng9TVX39wtht7h0QbfD35o4D2WSeE1Mvng9MXX37St9t622RbfAAII4FAO2eBZFtngDSYY4LAtV9+aATfflgCQAdwFAADs/wAACQAAAgjg9WG23ulFlt76vcffIloZ4TWqWeERdljg0fUm37OBxt7dZYffMMKY4FxOCeEzqojg1n2X35vhFt+8SWffHk444OEAWALKCPb/7P8AAAkAABJ23vn1Jt8KyqjgI9J54R4u+eDwgZffwmm23srNBt8LOijgS1IJ4Ukm6eD//fffr/Em36bpJt/y2effT9Ko4GX+yOBWTUMxBAAOAB4ABAAECwAAAgMBAM3MzD0AAAAACtejPM3MzD0AAKBAAAAAAAIAAAADAAAAzcxMPQUAAgAGAAIABwABAAAAAAAAAAoAAAAUAAkACZP62v5IKKpr9F5EDazb9f1D+64o+GdDZ+bYg80MAAAAAP9/HgDuAsgABwAhAKcACgD2/xQACQAojBrfXkosp5X790RhqRP9hkTIrNdDiH1n5kWEzQzhKQAA83g/AO4CyAANAEMATQEKAOz/FAASAPqFz+KaS4akfkVOdwKn/0StdtiqO0RpdWfmsoTNDCZPAACXZGEA7gLIABQAZAD0AQoA4v8UABIA8xlRM2MNP6LzRZ1u+qRnRe9tMamPRJFsZ+Yghc0MtGsAAChFggDuAsgACQAAAAYAZ19sb29wBAB0ZXN0BABtYXJrCwBnX292ZXJsYXlfcgcAYmF0LmRpcggAYmF0LmZhY2UIAGJhdC5ncmlwCwBnX292ZXJsYXlfbA==";
        // clip, t, scale, root xyz, ground x z yaw, contacts, bones 0..16 xyzw, bat grip xyz, dir xyz, face xyz (NaN = no bat)
        private static readonly object[][] GoldenSamples =
        {
            new object[] { "g_overlay_r", 0.05, 1, new double[] { 0, 0, 0, 0, 0, 0, 18, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.6079617142677307, 0.36475539207458496, 0.12159234285354614, 0.6946591734886169, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.2894218862056732, 0.6946054100990295, 0.0578886978328228, 0.6560542583465576, -0.26346105337142944, 0.7113558650016785, 0.05270085856318474, 0.649448812007904, 0.5, 0.5, 0.5, 0.5, -0.2234056442975998, 0.7372176647186279, 0.0446811281144619, 0.6360846161842346, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.08000000193715096, 0.75, 0.20000000298023224, -0.20189026495019988, -0.9741905824858877, 0.10096053641965626, 0.4794255567258153, 0, 0.8775825519904904 } },
            new object[] { "g_overlay_l", 0.05, 1, new double[] { 0, 0, 0, 0, 0, 0, 33, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.6079617142677307, -0.36475539207458496, -0.12159234285354614, 0.6946591734886169, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.2894218862056732, -0.6946054100990295, -0.0578886978328228, 0.6560542583465576, -0.26346105337142944, -0.7113558650016785, -0.05270085856318474, 0.649448812007904, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.2234056442975998, -0.7372176647186279, -0.0446811281144619, 0.6360846161842346, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.08000000193715096, 0.75, 0.20000000298023224, 0.20189026495019988, -0.9741905824858877, 0.10096053641965626, -0.4794255567258153, 0, 0.8775825519904904 } },
            new object[] { "g_overlay_r", 0.123, 0.93, new double[] { 0, 0, 0, 0, 0, 0, 18, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.700664222240448, -0.42039695382118225, -0.14011792838573456, -0.5591984987258911, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.32872578501701355, 0.7888873815536499, 0.06575378775596619, 0.5150461792945862, -0.2985571622848511, 0.8060427904129028, 0.059711430221796036, 0.5075363516807556, 0.5, 0.5, 0.5, 0.5, -0.25198784470558167, 0.8315499424934387, 0.050388939678668976, 0.4924304783344269, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.12089999556541443, 0.6975, 0.186000002771616, -0.2028918523277516, -0.9739304283388747, 0.10146140652814674, 0.8414678920980947, 0, 0.5403071224479549 } },
            new object[] { "g_overlay_l", 9, 1, new double[] { 0, 0, 0, 0, 0, 0, 33, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.700664222240448, 0.42039695382118225, 0.14011792838573456, -0.5591984987258911, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.32872578501701355, -0.7888873815536499, -0.06575378775596619, 0.5150461792945862, -0.2985571622848511, -0.8060427904129028, -0.059711430221796036, 0.5075363516807556, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.25198784470558167, -0.8315499424934387, -0.050388939678668976, 0.4924304783344269, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.12999999523162842, 0.75, 0.20000000298023224, 0.2028918523277516, -0.9739304283388747, 0.10146140652814674, -0.8414678920980947, 0, 0.5403071224479549 } },
            new object[] { "g_loop", 0.11, 1, new double[] { -0.0019999999552965182, -0.019999999552965164, 0, 0.1650000035762787, 0.44000000953674323, 16.5, 9, -0.006236271932721138, -0.033675871789455414, 0.0006929191295057535, 0.9994131326675415, -0.02641006000339985, -0.13287994265556335, -0.01341243926435709, 0.9906893968582153, -0.02207566611468792, -0.10871224105358124, -0.02207566611468792, 0.9935829043388367, 0.0026347474195063114, 0.014005761593580246, 0.0037441146560013294, 0.999891459941864, 0.023639865219593048, 0.11654037982225418, 0.046588506549596786, 0.9918109774589539, 0.0220638420432806, 0.10948660969734192, 0.05509021878242493, 0.9922151565551758, 0.0004162660625297576, 0.004578926134854555, 0.002358841709792614, 0.9999866485595703, -0.019216066226363182, -0.09469787776470184, -0.06621938943862915, 0.9931153059005737, -0.020940043032169342, -0.10192669928073883, -0.08168002963066101, 0.9912117719650269, -0.003748527728021145, -0.019297976046800613, -0.017354296520352364, 0.9996561408042908, 0.014518260955810547, 0.07397399097681046, 0.07397399097681046, 0.9944068193435669, 0.018154459074139595, 0.09243530035018921, 0.10241331905126572, 0.9902715086936951, 0.005694116465747356, 0.028470583260059357, 0.034859102219343185, 0.9989703893661499, -0.010927406139671803, -0.0551903173327446, -0.0706823319196701, 0.9959109425544739, -0.01648026332259178, -0.08184735476970673, -0.11508485674858093, 0.9898408651351929, -0.007640319410711527, -0.035978954285383224, -0.052926573902368546, 0.9979208111763, 0.007334828842431307, 0.03916521742939949, 0.06186167150735855, 0.9972890615463257, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN } },
            new object[] { "g_loop", 0.2499999, 1, new double[] { 0.009999979180436594, -0.019999999552965164, 0, 0.3749998604308067, 0.999999602980226, 37.49998455296517, 9, 0.033869173377752304, 0.17072828114032745, 0.0006912090466357768, 0.9847356081008911, 0.01866266317665577, 0.09193090349435806, 0.008985728956758976, 0.9955499172210693, -0.014515295624732971, -0.06981164962053299, -0.014515295624732971, 0.997348964214325, -0.032486747950315475, -0.16105131804943085, -0.04907572641968727, 0.98518967628479, -0.02142748422920704, -0.10437258332967758, -0.04216375946998596, 0.9934130311012268, 0.008985637687146664, 0.04354577511548996, 0.021427283063530922, 0.9987812042236328, 0.02833949588239193, 0.14031505584716797, 0.08501847833395004, 0.9860427975654602, 0.021427473053336143, 0.10575494170188904, 0.0739593356847763, 0.9914064407348633, -0.00345598254352808, -0.02004474774003029, -0.015897557139396667, 0.999666690826416, -0.02280982956290245, -0.11681397259235382, -0.10437224805355072, 0.9873908162117004, -0.020045045763254166, -0.10160765051841736, -0.10160765051841736, 0.9894189834594727, 0.0006911606178618968, 0.0006909698131494224, 0.0006909442017786205, 0.9999992847442627, 0.018662581220269203, 0.09331290423870087, 0.1112842783331871, 0.9892220497131348, 0.018662622198462486, 0.09607794135808945, 0.1237262710928917, 0.9874778985977173, 0.0020736639853566885, 0.013133147731423378, 0.018662890419363976, 0.9997374415397644, -0.014515332877635956, -0.07257666438817978, -0.10990181565284729, 0.9911828637123108, -0.017280198633670807, -0.08778341114521027, -0.1403152197599411, 0.9860563278198242, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN } },
            new object[] { "g_loop", 3.7, 1.0625, new double[] { 1.1399388021634399e-8, -0.021249999525025487, 0, 5.896875148825344, 15.72500000633299, 554.999991953373, 9, 0.0006912446115165949, 0.0006913914112374187, 0.0006912089884281158, 0.9999992847442627, -0.02833952009677887, -0.14308002591133118, -0.014515364542603493, 0.9891988039016724, -0.03110438585281372, -0.15275709331035614, -0.03110438585281372, 0.9872843027114868, -0.004838492721319199, -0.02281004562973976, -0.007603343576192856, 0.9996991753578186, 0.024192266166210175, 0.11957891285419464, 0.04769332706928253, 0.9913833737373352, 0.02972196415066719, 0.14722740650177002, 0.07395929843187332, 0.985885739326477, 0.007603321224451065, 0.04078143835067749, 0.024192379787564278, 0.9988462328910828, -0.018662599846720695, -0.0919305831193924, -0.06428228318691254, 0.9935131072998047, -0.026957126334309578, -0.13202080130577087, -0.10575487464666367, 0.9852206707000732, -0.010368148796260357, -0.05322316288948059, -0.04769348353147507, 0.9973891377449036, 0.013132935389876366, 0.06704708933830261, 0.06704708933830261, 0.9954078793525696, 0.022809872403740883, 0.1154317781329155, 0.1278735250234604, 0.9847860336303711, 0.011750560253858566, 0.05875280126929283, 0.07119456678628922, 0.9956612586975098, -0.008985687047243118, -0.04492843151092529, -0.057370152324438095, 0.9973010420799255, -0.02004503831267357, -0.09884276241064072, -0.13893283903598785, 0.9851527810096741, -0.01313297264277935, -0.06290002167224884, -0.09331322461366653, 0.9935611486434937, 0.004838439170271158, 0.02695702761411667, 0.042163554579019547, 0.998735249042511, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN } },
            new object[] { "g_loop", -1.234, 1, new double[] { -0.0067999956756831115, -0.019999999552965164, 0, -1.8510000523924752, -4.935999979972844, -185.09999687075614, 9, -0.022886736318469048, -0.11626462638378143, 0.0006935378769412637, 0.9929543137550354, -0.003645002841949463, -0.016833780333399773, -0.0014746938832104206, 0.9998505711555481, 0.019840145483613014, 0.0964336171746254, 0.019840145483613014, 0.9949438571929932, 0.02369561977684498, 0.11709239333868027, 0.03588985651731491, 0.9921894073486328, 0.006874385755509138, 0.03292468562722206, 0.01349828764796257, 0.9993430376052856, -0.015645360574126244, -0.07684225589036942, -0.038296520709991455, 0.9961846470832825, -0.021737564355134964, -0.10863244533538818, -0.06565575301647186, 0.9916732311248779, -0.008655121549963951, -0.04277466982603073, -0.029917221516370773, 0.9985992312431335, 0.011002023704349995, 0.05600778013467789, 0.044756338000297546, 0.9973660111427307, 0.018843933939933777, 0.09654402732849121, 0.08630576729774475, 0.9914007782936096, 0.00948816817253828, 0.047941677272319794, 0.047941677272319794, 0.9976538419723511, -0.007794734090566635, -0.037531230598688126, -0.04152568802237511, 0.9984018802642822, -0.01645594835281372, -0.082279734313488, -0.0984867736697197, 0.9915944933891296, -0.009872835129499435, -0.05125530809164047, -0.06616190075874329, 0.9964426755905151, 0.005025223828852177, 0.022793974727392197, 0.03190046176314354, 0.9992184638977051, 0.014073590748012066, 0.06948316842317581, 0.1045980155467987, 0.991984486579895, 0.0102549372240901, 0.051330264657735825, 0.08234520256519318, 0.9952282905578613, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN } },
        };

        private static VmpPack Golden() => VmpPack.Parse(Convert.FromBase64String(GoldenPackBase64));

        [Test]
        public void GoldenPack_SamplesMatchTheVmpTsReference()
        {
            var pack = Golden();
            var pose = new VmpPose(pack.MaxTrackCount);
            foreach (var row in GoldenSamples)
            {
                var clip = pack.GetClip((string)row[0]);
                var t = Convert.ToDouble(row[1]);
                var scale = Convert.ToDouble(row[2]);
                var want = (double[])row[3];
                pose.Clear(); // as golden.mjs: root and ground zero, rotations at 0.5
                for (var i = 0; i < pose.Rotations.Length; i++) pose.Rotations[i] = 0.5f;
                clip.Sample(t, pose, scale);
                var at = clip.Name + " t=" + t;
                Assert.That(pose.RootX, Is.EqualTo(want[0]).Within(Tolerance), at);
                Assert.That(pose.RootY, Is.EqualTo(want[1]).Within(Tolerance), at);
                Assert.That(pose.RootZ, Is.EqualTo(want[2]).Within(Tolerance), at);
                Assert.That(pose.GroundX, Is.EqualTo(want[3]).Within(Tolerance), at);
                Assert.That(pose.GroundZ, Is.EqualTo(want[4]).Within(Tolerance), at);
                Assert.That(pose.GroundYawDeg, Is.EqualTo(want[5]).Within(Tolerance), at);
                Assert.That(pose.Contacts, Is.EqualTo((int)want[6]), at);
                for (var b = 0; b < Vmp.BoneCount; b++)
                {
                    double same = 0, flipped = 0;
                    for (var k = 0; k < 4; k++)
                    {
                        same = Math.Max(same, Math.Abs(pose.Rotations[b * 4 + k] - want[7 + b * 4 + k]));
                        flipped = Math.Max(flipped, Math.Abs(pose.Rotations[b * 4 + k] + want[7 + b * 4 + k]));
                    }
                    Assert.That(Math.Min(same, flipped), Is.LessThanOrEqualTo(Tolerance), at + " bone " + b);
                }
                VmpVector3 grip, dir, face;
                bool hasFace;
                var hasBat = pose.TryGetBat(out grip, out dir, out face, out hasFace);
                Assert.That(hasBat, Is.EqualTo(!double.IsNaN(want[75])), at + " bat");
                if (!hasBat) continue;
                Assert.That(hasFace, Is.True, at);
                var got = new double[] { grip.X, grip.Y, grip.Z, dir.X, dir.Y, dir.Z, face.X, face.Y, face.Z };
                for (var k = 0; k < 9; k++) Assert.That(got[k], Is.EqualTo(want[75 + k]).Within(Tolerance), at + " bat " + k);
            }
        }

        [Test]
        public void ShippedPacks_DecodeAndSampleToUnitFinitePoses()
        {
            var assets = Resources.LoadAll<TextAsset>("Motion");
            Assert.That(assets.Length, Is.GreaterThan(0), "no Resources/Motion packs");
            foreach (var asset in assets)
            {
                var pack = VmpPack.Parse(asset.bytes);
                Assert.That(pack.ClipCount, Is.GreaterThan(0), asset.name);
                var pose = new VmpPose(pack.MaxTrackCount);
                for (var i = 0; i < pack.ClipCount; i++)
                {
                    var clip = pack.GetClip(i);
                    for (var s = 0; s <= 100; s++)
                    {
                        var t = -1.0 + s * (2.0 * clip.Duration + 1.0) / 100.0;
                        clip.Sample(t, pose);
                        Assert.That(float.IsNaN(pose.RootX) || float.IsNaN(pose.RootY) || float.IsNaN(pose.RootZ), Is.False);
                        for (var b = 0; b < Vmp.BoneCount; b++)
                        {
                            if (((pose.DrivenMask >> b) & 1u) == 0) continue;
                            double x = pose.Rotations[b * 4], y = pose.Rotations[b * 4 + 1], z = pose.Rotations[b * 4 + 2], w = pose.Rotations[b * 4 + 3];
                            Assert.That(Math.Sqrt(x * x + y * y + z * z + w * w), Is.EqualTo(1.0).Within(1e-5), asset.name + "/" + clip.Name);
                        }
                    }
                }
            }
        }

        [Test]
        public void SampleAndApplyTo_AllocateNothing()
        {
            var pack = Golden();
            var overlay = pack.GetClip("g_overlay_l");
            var loop = pack.GetClip("g_loop");
            var pose = new VmpPose(pack.MaxTrackCount);
            var target = new ProductionCharacterPose();
            VmpVector3 grip, dir, face;
            bool hasFace;
            overlay.Sample(0.05, pose);
            pose.ApplyTo(target);
            pose.TryGetBat(out grip, out dir, out face, out hasFace);
            Assert.That(() =>
            {
                overlay.Sample(0.0731, pose, 0.97);
                pose.ApplyTo(target);
                pose.TryGetBat(out grip, out dir, out face, out hasFace);
                loop.Sample(12.345, pose);
                pose.ApplyTo(target);
            }, Is.Not.AllocatingGCMemory());
        }

        [Test]
        public void CorruptBytes_ThrowVmpFormatException()
        {
            var bytes = Convert.FromBase64String(GoldenPackBase64);
            for (var len = 0; len < bytes.Length; len++)
            {
                var cut = new byte[len];
                Buffer.BlockCopy(bytes, 0, cut, 0, len);
                Assert.Throws<VmpFormatException>(() => VmpPack.Parse(cut), "truncated to " + len);
            }
            Assert.That(Assert.Throws<VmpFormatException>(() => VmpPack.Parse(Mutate(bytes, 0, 0x58))).Message, Is.EqualTo("VMP1: bad magic"));
            Assert.That(Assert.Throws<VmpFormatException>(() => VmpPack.Parse(Mutate(bytes, 4, 2))).Message, Is.EqualTo("VMP1: unsupported version"));
            Assert.That(Assert.Throws<VmpFormatException>(() => VmpPack.Parse(Mutate(bytes, 100, (byte)(bytes[100] ^ 1)))).Message, Is.EqualTo("VMP1: CRC mismatch"));
            var longer = new byte[bytes.Length + 1];
            Buffer.BlockCopy(bytes, 0, longer, 0, bytes.Length);
            Assert.That(Assert.Throws<VmpFormatException>(() => VmpPack.Parse(longer)).Message, Is.EqualTo("VMP1: length mismatch"));
        }

        [Test]
        public void ApplyTo_CopiesComponentsScalesRootXZAndRespectsOverlays()
        {
            var pack = Golden();
            var pose = new VmpPose(pack.MaxTrackCount);
            var target = new ProductionCharacterPose();

            pack.GetClip("g_loop").Sample(0.11, pose);
            pose.ApplyTo(target);
            for (var b = 0; b < Vmp.BoneCount; b++)
            {
                var q = target.Rotation((ProductionCharacterJoint)b);
                Assert.That(q.x == pose.Rotations[b * 4] && q.y == pose.Rotations[b * 4 + 1] &&
                            q.z == pose.Rotations[b * 4 + 2] && q.w == pose.Rotations[b * 4 + 3], Is.True, "bone " + b);
            }
            Assert.That(target.RootOffset.x, Is.EqualTo(pose.RootX * Vmp.UnityDriverHorizontalScale));
            Assert.That(target.RootOffset.y, Is.EqualTo(pose.RootY));
            Assert.That(target.RootOffset.z, Is.EqualTo(pose.RootZ * Vmp.UnityDriverHorizontalScale));

            // The overlay alias drives chest, upperArmL, forearmL and thighR (the mirror of its source mask) and not hips.
            var root = target.RootOffset;
            var before = target.Rotation(ProductionCharacterJoint.Head);
            var overlay = pack.GetClip("g_overlay_l");
            Assert.That(overlay.DrivenMask, Is.EqualTo((1u << 2) | (1u << 5) | (1u << 6) | (1u << 14)));
            overlay.Sample(0.05, pose);
            pose.ApplyTo(target);
            Assert.That(target.Rotation(ProductionCharacterJoint.Head), Is.EqualTo(before));
            Assert.That(target.RootOffset, Is.EqualTo(root));
            var arm = target.Rotation(ProductionCharacterJoint.UpperArmLeft);
            Assert.That(arm.x == pose.Rotations[5 * 4] && arm.w == pose.Rotations[5 * 4 + 3], Is.True);
        }

        [Test]
        public void MirrorForRig_EqualsTheMirrorAliasBitForBit()
        {
            // Rigs whose L/R labels are anatomically mirrored use the canonical mirror (§3), the code path of a mirror
            // alias: a source through Sample(mirror: true), or through ApplyTo(mirrorForRig: true), is its alias.
            var pack = Golden();
            var source = pack.GetClip("g_overlay_r");
            var alias = pack.GetClip("g_overlay_l");
            var a = new VmpPose(pack.MaxTrackCount);
            var b = new VmpPose(pack.MaxTrackCount);
            var ta = new ProductionCharacterPose();
            var tb = new ProductionCharacterPose();
            foreach (var t in new[] { -0.2, 0.0, 0.031, 0.05, 0.0777, 0.1, 0.5 })
            {
                a.Clear();
                b.Clear();
                source.Sample(t, a, 0.97, true);
                alias.Sample(t, b, 0.97);
                for (var i = 0; i < a.Rotations.Length; i++) Assert.That(a.Rotations[i], Is.EqualTo(b.Rotations[i]), "t=" + t);
                Assert.That(a.Contacts, Is.EqualTo(b.Contacts));
                for (var i = 0; i < a.TrackCount * 3; i++) Assert.That(a.Tracks[i], Is.EqualTo(b.Tracks[i]));
                VmpVector3 ga, da, fa, gb, db, fb;
                bool ha, hb;
                a.TryGetBat(out ga, out da, out fa, out ha);
                b.TryGetBat(out gb, out db, out fb, out hb);
                Assert.That(ga.X == gb.X && da.X == db.X && fa.X == fb.X, Is.True, "bat x mirrored");

                a.Clear();
                source.Sample(t, a, 0.97);
                a.ApplyTo(ta, mirrorForRig: true);
                b.ApplyTo(tb);
                for (var j = 0; j < Vmp.BoneCount; j++)
                    Assert.That(ta.Rotation((ProductionCharacterJoint)j), Is.EqualTo(tb.Rotation((ProductionCharacterJoint)j)), "bone " + j);
                Vector3 g1, d1, f1, g2, d2, f2;
                bool h1, h2;
                a.TryGetBat(true, out g1, out d1, out f1, out h1);
                b.TryGetBat(false, out g2, out d2, out f2, out h2);
                Assert.That(g1, Is.EqualTo(g2));
                Assert.That(d1, Is.EqualTo(d2));
                Assert.That(f1, Is.EqualTo(f2));
            }
        }

        private static byte[] Mutate(byte[] bytes, int index, byte value)
        {
            var copy = (byte[])bytes.Clone();
            copy[index] = value;
            return copy;
        }
    }
}
