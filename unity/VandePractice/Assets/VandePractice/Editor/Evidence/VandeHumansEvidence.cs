using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Trace;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// Human-naturalness evidence for the Unity view (builder observation only; batchmode -executeMethod
    /// Vande.Practice.Editor.Evidence.VandeHumansEvidence.Run). Plays the TS-generated golden deliveries through the
    /// production world at 60 Hz exactly as the bridge does (scene, delivery, result after release) and writes, to
    /// VANDE_EVIDENCE_OUT: rear-camera stills at fixed instants and humans-metrics.json.
    /// Metrics (per human): planted-foot slide, per-frame joint angle step (pose pops), root speed step, striker
    /// hand-to-handle distance, and keeper/non-striker visibility in the rear camera (and the PIP when present).
    /// VANDE_HUMANS_CASES (default grounded-attack,thin-edge) selects golden cases; VANDE_HUMANS_SPIN=1 adds a spin
    /// variant of the first case whose keeper stands up at the physics spot (field.ts keeperSpot: 0.25, 10.86).
    /// </summary>
    public static partial class VandeHumansEvidence
    {
        private const double Step = 1.0 / 60.0;

        /// <summary>The striker's hand for the humans run (VANDE_HUMANS_HAND, default right).</summary>
        private static string HumansHand =>
            Environment.GetEnvironmentVariable("VANDE_HUMANS_HAND") == "left" ? "left" : "right";
        private const double AcceptAfterRelease = 0.10;
        private const float PlantedHeightBand = 0.035f;
        private const float PlantedSpeed = 0.35f;
        private static readonly ProductionCharacterJoint[] PopJoints =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest,
            ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head, ProductionCharacterJoint.UpperArmLeft,
            ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.UpperArmRight,
            ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ShinLeft,
            ProductionCharacterJoint.FootLeft, ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.ShinRight,
            ProductionCharacterJoint.FootRight
        };

        public static void Run()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var caseIds = (Environment.GetEnvironmentVariable("VANDE_HUMANS_CASES") ?? "grounded-attack,thin-edge")
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var spin = Environment.GetEnvironmentVariable("VANDE_HUMANS_SPIN") == "1";
            var label = Environment.GetEnvironmentVariable("VANDE_HUMANS_LABEL") ?? "run";
            var fixture = LoadFixture();
            var json = new StringBuilder();
            json.Append("{\"label\":\"").Append(label).Append("\",\"stepSeconds\":").Append(F(Step))
                .Append(",\"plantedHeightBandM\":").Append(F(PlantedHeightBand))
                .Append(",\"plantedSpeedMps\":").Append(F(PlantedSpeed)).Append(",\"cases\":[");
            var first = true;
            foreach (var id in caseIds)
            {
                var item = fixture.cases.Single(c => c.id == id);
                if (!first) json.Append(',');
                first = false;
                json.Append(RunCase(item, id, false, output));
                if (spin && id == caseIds[0])
                {
                    json.Append(',');
                    json.Append(RunCase(item, id + "-spin-keeper-up", true, output));
                }
            }
            json.Append("]}");
            File.WriteAllText(Path.Combine(output, "humans-metrics.json"), json.ToString());
            Debug.Log("VANDE_HUMANS_EVIDENCE written to " + output);
        }

        /// <summary>
        /// Handedness check (MOTION-SPEC §3 parity warning). A right-handed striker in the rear camera should show the
        /// off side on screen right, the chest turned to screen right, the left hand above the right on the handle and
        /// the body on the leg side of the stumps. Writes mirror-check.json and two stills (rear; top-down with red
        /// left-glove and green right-glove markers) to VANDE_EVIDENCE_OUT.
        /// </summary>
        public static void MirrorCheck()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            foreach (var hand in new[] { "right", "left" }) MirrorCheckOne(output, hand);
        }

        /// <summary>MirrorCheck, then BatterViews, in one editor launch.</summary>
        public static void MirrorAndViews()
        {
            MirrorCheck();
            BatterViews();
        }

        private static void MirrorCheckOne(string output, string hand)
        {
            var item = LoadFixture().cases.Single(c => c.id == "grounded-attack");
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            scene.Handedness = hand;
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            var root = new GameObject("VANDE mirror check");
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = hand,
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.High
                }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                world.Tick(0.4);
                var camera = world.BatterCameraForEvidence;
                var fielders = world.PresentedHumansForEvidence().ToDictionary(pair => pair.Key, pair => pair.Value);
                var striker = fielders["striker"];
                var right = hand == "right";
                Func<Vector3, float> sx = p => camera.WorldToScreenPoint(p).x / camera.pixelWidth;
                var json = new StringBuilder("{");
                json.Append("\"camera\":").Append(V(camera.transform.position));
                json.Append(",\"pointScreenX\":").Append(F(sx(fielders["fielder:point"].Root.position)));
                json.Append(",\"midwicketScreenX\":").Append(F(sx(fielders["fielder:midwicket"].Root.position)));
                json.Append(",\"midOffScreenX\":").Append(F(sx(fielders["fielder:mid_off"].Root.position)));
                json.Append(",\"midOnScreenX\":").Append(F(sx(fielders["fielder:mid_on"].Root.position)));
                json.Append(",\"stumpsScreenX\":").Append(F(sx(new Vector3(0f, 0.4f, 10.06f))));
                var offSideOnCorrectSide = right
                    ? sx(fielders["fielder:mid_off"].Root.position) > sx(fielders["fielder:mid_on"].Root.position)
                    : sx(fielders["fielder:mid_off"].Root.position) < sx(fielders["fielder:mid_on"].Root.position);
                bool stancePass;
                json.Append(",\"stance\":").Append(Anatomy(striker, camera, right, true, out stancePass));
                Render(camera, 1280, 592, Path.Combine(output, "mirror-check-" + hand + "-rear.jpg"));
                RenderMarkersTopDown(root, striker, camera, Path.Combine(output, "mirror-check-" + hand + "-topdown-bowler-up.jpg"));

                // Contact: play the golden result at 60 Hz exactly as the bridge does and capture the contact frame.
                var contactT = result.Trace.events.Where(e => e.kind == "contact").Select(e => (double?)e.t)
                    .FirstOrDefault() ?? 0.45;
                var accepted = false;
                for (var frame = 0; frame < 2400 && world.TimelineForEvidence < contactT - 1e-9; frame++)
                {
                    if (!accepted && world.TimelineForEvidence >= AcceptAfterRelease)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                    }
                    world.Tick(Step);
                }
                bool contactPass;
                json.Append(",\"contactT\":").Append(F(contactT)).Append(",\"contactTimeline\":")
                    .Append(F(world.TimelineForEvidence));
                json.Append(",\"contact\":").Append(Anatomy(striker, camera, right, false, out contactPass));
                Render(camera, 1280, 592, Path.Combine(output, "mirror-check-" + hand + "-contact-rear.jpg"));
                json.Append(",\"hand\":\"").Append(hand).Append("\"");
                json.Append(",\"pass\":{\"offSideOnCorrectScreenSide\":").Append(offSideOnCorrectSide ? "true" : "false")
                    .Append(",\"stance\":").Append(stancePass ? "true" : "false")
                    .Append(",\"contact\":").Append(contactPass ? "true" : "false").Append("}");
                json.Append(",\"expected\":\"right-hander: mid-off screen x > mid-on; at the stance he faces his off side (knees to screen right), leads with his left shoulder (nearer the bowler), has his left hand on top at the cap and the bat toe below the grip; at contact the left shoulder still leads and the left hand is on top. Left-hander: the mirror. Anatomy is from the knees, independent of the rig labels.\"}");
                File.WriteAllText(Path.Combine(output, "mirror-check-" + hand + ".json"), json.ToString());
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>
        /// Label-independent batter anatomy. The rig's joint labels are anatomically mirrored in Unity (VC17's "left" at
        /// local +X, face at +Z), so facing comes from the knees (a flexed knee sits forward of its hip-to-ankle line)
        /// and the anatomical right is up x forward.
        /// </summary>
        private static string Anatomy(ProductionCharacterRig striker, Camera camera, bool right, bool stance, out bool pass)
        {
            Func<Vector3, float> sx = p => camera.WorldToScreenPoint(p).x / camera.pixelWidth;
            var leftShoulder = striker.VisibleJointWorldPosition(ProductionCharacterJoint.UpperArmLeft);
            var rightShoulder = striker.VisibleJointWorldPosition(ProductionCharacterJoint.UpperArmRight);
            var chest = striker.VisibleJointWorldPosition(ProductionCharacterJoint.Chest);
            var hips = striker.VisibleJointWorldPosition(ProductionCharacterJoint.Hips);
            var leftHand = striker.HeroHandWorldPosition(true);
            var rightHand = striker.HeroHandWorldPosition(false);
            var cap = striker.Bat.position;
            var toe = cap + striker.Bat.TransformDirection(Vector3.down) * 0.86f;
            Func<ProductionCharacterJoint, ProductionCharacterJoint, ProductionCharacterJoint, Vector3> kneeForward =
                (thigh, shin, foot) =>
                {
                    var hip = striker.VisibleJointWorldPosition(thigh);
                    var knee = striker.VisibleJointWorldPosition(shin);
                    var ankle = striker.VisibleJointWorldPosition(foot);
                    var axis = (ankle - hip).normalized;
                    var offset = knee - (hip + axis * Vector3.Dot(knee - hip, axis));
                    offset.y = 0f;
                    return offset;
                };
            var knees = (kneeForward(ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ShinLeft,
                             ProductionCharacterJoint.FootLeft) +
                         kneeForward(ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.ShinRight,
                             ProductionCharacterJoint.FootRight)).normalized;
            var anatomicalRight = Vector3.Cross(Vector3.up, knees);
            var labelsAnatomical = Vector3.Dot(rightShoulder - leftShoulder, anatomicalRight) > 0f;
            var anatomicalLeftShoulder = labelsAnatomical ? leftShoulder : rightShoulder;
            var anatomicalRightShoulder = labelsAnatomical ? rightShoulder : leftShoulder;
            var anatomicalLeftHand = labelsAnatomical ? leftHand : rightHand;
            var anatomicalRightHand = labelsAnatomical ? rightHand : leftHand;
            var lead = anatomicalLeftShoulder.z < anatomicalRightShoulder.z ? "left" : "right";
            var top = Vector3.Distance(anatomicalLeftHand, cap) < Vector3.Distance(anatomicalRightHand, cap) ? "left" : "right";
            var kneeDx = sx(chest + knees * 0.5f) - sx(chest);
            var handsMid = (leftHand + rightHand) * 0.5f;
            var handsInFront = Vector3.Dot(handsMid - hips, knees);
            var facesOffSide = right ? kneeDx > 0f : kneeDx < 0f;
            var leadOk = lead == (right ? "left" : "right");
            var topOk = top == (right ? "left" : "right");
            var toeDown = cap.y - toe.y > 0.5f;
            pass = stance ? facesOffSide && leadOk && topOk && toeDown && handsInFront > 0f : leadOk && topOk;
            var json = new StringBuilder("{");
            json.Append("\"kneeForwardWorld\":").Append(V(knees))
                .Append(",\"kneeForwardScreenDx\":").Append(F(kneeDx))
                .Append(",\"rigLabelsAnatomical\":").Append(labelsAnatomical ? "true" : "false")
                .Append(",\"anatomicalLeadShoulder\":\"").Append(lead).Append("\"")
                .Append(",\"anatomicalTopHand\":\"").Append(top).Append("\"")
                .Append(",\"handsInFrontOfHipsM\":").Append(F(handsInFront))
                .Append(",\"batToeBelowCapM\":").Append(F(cap.y - toe.y))
                .Append(",\"labelLeftShoulder\":").Append(V(leftShoulder))
                .Append(",\"labelRightShoulder\":").Append(V(rightShoulder))
                .Append(",\"labelLeftHand\":").Append(V(leftHand))
                .Append(",\"labelRightHand\":").Append(V(rightHand))
                .Append(",\"cap\":").Append(V(cap))
                .Append(",\"toe\":").Append(V(toe))
                .Append(",\"strikerScreenX\":").Append(F(sx(chest)))
                .Append(",\"checks\":{\"facesOffSide\":").Append(facesOffSide ? "true" : "false")
                .Append(",\"leftShoulderLeads\":").Append(leadOk ? "true" : "false")
                .Append(",\"correctTopHandAtCap\":").Append(topOk ? "true" : "false")
                .Append(",\"batToeDown\":").Append(toeDown ? "true" : "false")
                .Append(",\"handsInFront\":").Append(handsInFront > 0f ? "true" : "false").Append("}}");
            return json.ToString();
        }

        private static void RenderMarkersTopDown(GameObject root, ProductionCharacterRig striker, Camera camera, string path)
        {
            var red = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            var green = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            foreach (var marker in new[] { red, green })
            {
                marker.transform.SetParent(root.transform, true);
                marker.transform.localScale = Vector3.one * 0.07f;
                UnityEngine.Object.DestroyImmediate(marker.GetComponent<Collider>());
            }
            red.transform.position = striker.HeroHandWorldPosition(true);
            green.transform.position = striker.HeroHandWorldPosition(false);
            red.GetComponent<Renderer>().sharedMaterial = new Material(Shader.Find("Unlit/Color")) { color = Color.red };
            green.GetComponent<Renderer>().sharedMaterial = new Material(Shader.Find("Unlit/Color")) { color = Color.green };
            var position = camera.transform.position;
            var rotation = camera.transform.rotation;
            var fov = camera.fieldOfView;
            var hips = striker.VisibleJointWorldPosition(ProductionCharacterJoint.Hips);
            camera.transform.SetPositionAndRotation(new Vector3(hips.x, 4.5f, hips.z),
                Quaternion.LookRotation(Vector3.down, Vector3.forward * -1f));
            camera.fieldOfView = 30f;
            Render(camera, 800, 800, path);
            camera.transform.SetPositionAndRotation(position, rotation);
            camera.fieldOfView = fov;
            UnityEngine.Object.DestroyImmediate(red);
            UnityEngine.Object.DestroyImmediate(green);
        }

        /// <summary>
        /// Builder diagnostic for the batter's anatomy, independent of the world: one batter rig per rig handedness,
        /// root at the origin facing -z (towards the bowler, as the striker), sampled at the stance and at the stroke's
        /// contact phase, rendered from the bowler's end, from behind, from -x, from +x and from above, with markers:
        /// red = label-left hand, green = label-right hand, blue = label-left knee, yellow = label-right knee,
        /// magenta = bat toe. Writes batter-views.json and the stills to VANDE_EVIDENCE_OUT.
        /// </summary>
        public static void BatterViews()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var json = new StringBuilder("{");
            var first = true;
            foreach (var rigHand in new[] { ProductionCharacterHandedness.Right, ProductionCharacterHandedness.Left })
            foreach (var phase in new[] { "stance", "contact" })
            {
                var root = new GameObject("VANDE batter views");
                try
                {
                    var lightObject = new GameObject("Light");
                    lightObject.transform.SetParent(root.transform, false);
                    var light = lightObject.AddComponent<Light>();
                    light.type = LightType.Directional;
                    light.intensity = 1.1f;
                    lightObject.transform.rotation = Quaternion.Euler(50f, 30f, 0f);
                    var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter, ProductionCharacterDetail.High);
                    spec.Handedness = rigHand;
                    var rig = ProductionCharacterFactory.Create(root.transform, spec);
                    rig.Root.SetPositionAndRotation(Vector3.zero, Quaternion.Euler(0f, 180f, 0f));
                    if (phase == "stance") rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
                    else rig.SampleBatterStroke(0.5f, ProductionBatterFootwork.Balanced);
                    Func<ProductionCharacterJoint, ProductionCharacterJoint, ProductionCharacterJoint, Vector3> kneeForward =
                        (thigh, shin, foot) =>
                        {
                            var hip = rig.VisibleJointWorldPosition(thigh);
                            var knee = rig.VisibleJointWorldPosition(shin);
                            var ankle = rig.VisibleJointWorldPosition(foot);
                            var axis = (ankle - hip).normalized;
                            var offset = knee - (hip + axis * Vector3.Dot(knee - hip, axis));
                            offset.y = 0f;
                            return offset;
                        };
                    var knees = (kneeForward(ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ShinLeft,
                                     ProductionCharacterJoint.FootLeft) +
                                 kneeForward(ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.ShinRight,
                                     ProductionCharacterJoint.FootRight)).normalized;
                    var hips = rig.VisibleJointWorldPosition(ProductionCharacterJoint.Hips);
                    var leftHand = rig.HeroHandWorldPosition(true);
                    var rightHand = rig.HeroHandWorldPosition(false);
                    var cap = rig.Bat.position;
                    var toe = cap + rig.Bat.TransformDirection(Vector3.down) * 0.86f;
                    var chestBone = rig.VisibleJointWorldRotation(ProductionCharacterJoint.Chest) * Vector3.forward;
                    chestBone.y = 0f;
                    var hipsBone = rig.VisibleJointWorldRotation(ProductionCharacterJoint.Hips) * Vector3.forward;
                    hipsBone.y = 0f;
                    var label = rigHand + "-" + phase;
                    if (!first) json.Append(",");
                    first = false;
                    json.Append("\"").Append(label).Append("\":{");
                    json.Append("\"kneeForward\":").Append(V(knees));
                    json.Append(",\"chestBoneForward\":").Append(V(chestBone.normalized));
                    json.Append(",\"hipsBoneForward\":").Append(V(hipsBone.normalized));
                    json.Append(",\"hips\":").Append(V(hips));
                    json.Append(",\"labelLeftShoulder\":").Append(V(rig.VisibleJointWorldPosition(ProductionCharacterJoint.UpperArmLeft)));
                    json.Append(",\"labelRightShoulder\":").Append(V(rig.VisibleJointWorldPosition(ProductionCharacterJoint.UpperArmRight)));
                    json.Append(",\"labelLeftHand\":").Append(V(leftHand));
                    json.Append(",\"labelRightHand\":").Append(V(rightHand));
                    json.Append(",\"labelLeftKnee\":").Append(V(rig.VisibleJointWorldPosition(ProductionCharacterJoint.ShinLeft)));
                    json.Append(",\"labelRightKnee\":").Append(V(rig.VisibleJointWorldPosition(ProductionCharacterJoint.ShinRight)));
                    json.Append(",\"cap\":").Append(V(cap));
                    json.Append(",\"toe\":").Append(V(toe));
                    json.Append(",\"handsInFrontOfKneesM\":").Append(F(Vector3.Dot((leftHand + rightHand) * 0.5f - hips, knees)));
                    json.Append(",\"capInFrontOfKneesM\":").Append(F(Vector3.Dot(cap - hips, knees)));
                    json.Append(",\"labelLeftHandToCapM\":").Append(F(Vector3.Distance(leftHand, cap)));
                    json.Append(",\"labelRightHandToCapM\":").Append(F(Vector3.Distance(rightHand, cap)));
                    json.Append("}");

                    var markers = new[]
                    {
                        (leftHand, Color.red), (rightHand, Color.green),
                        (rig.VisibleJointWorldPosition(ProductionCharacterJoint.ShinLeft), Color.blue),
                        (rig.VisibleJointWorldPosition(ProductionCharacterJoint.ShinRight), Color.yellow),
                        (toe, Color.magenta)
                    };
                    foreach (var (position, colour) in markers)
                    {
                        var marker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                        UnityEngine.Object.DestroyImmediate(marker.GetComponent<Collider>());
                        marker.transform.SetParent(root.transform, true);
                        marker.transform.position = position;
                        marker.transform.localScale = Vector3.one * 0.06f;
                        marker.GetComponent<Renderer>().sharedMaterial =
                            new Material(Shader.Find("Unlit/Color")) { color = colour };
                    }
                    var cameraObject = new GameObject("Camera");
                    cameraObject.transform.SetParent(root.transform, false);
                    var camera = cameraObject.AddComponent<Camera>();
                    camera.clearFlags = CameraClearFlags.SolidColor;
                    camera.backgroundColor = new Color(0.55f, 0.6f, 0.55f);
                    camera.fieldOfView = 32f;
                    camera.nearClipPlane = 0.05f;
                    var focus = new Vector3(hips.x, 0.9f, hips.z);
                    var views = new (string, Vector3, Vector3)[]
                    {
                        ("from-bowler", focus + new Vector3(0f, 0.3f, -4f), Vector3.up),
                        ("from-behind", focus + new Vector3(0f, 0.3f, 4f), Vector3.up),
                        ("from-minus-x", focus + new Vector3(-4f, 0.3f, 0f), Vector3.up),
                        ("from-plus-x", focus + new Vector3(4f, 0.3f, 0f), Vector3.up),
                        ("from-above-bowler-up", focus + new Vector3(0f, 4.5f, 0f), Vector3.back)
                    };
                    foreach (var (name, position, up) in views)
                    {
                        camera.transform.SetPositionAndRotation(position,
                            Quaternion.LookRotation(focus - position, up));
                        Render(camera, 480, 600, Path.Combine(output, "batter-" + label + "-" + name + ".jpg"));
                    }
                    rig.Dispose();
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
            json.Append(",\"note\":\"rig root at the origin facing -z (the bowler); world -x is a right-hander's off side after the reflection\"}");
            File.WriteAllText(Path.Combine(output, "batter-views.json"), json.ToString());
        }

        private static string V(Vector3 value) => "[" + F(value.x) + "," + F(value.y) + "," + F(value.z) + "]";

        private static string RunCase(GoldenCase item, string name, bool spinKeeperUp, string output)
        {
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = HumansHand;
            if (spinKeeperUp)
            {
                scene.BowlerFamily = "spin";
                scene.BowlerSpinType = "finger";
                scene.BowlerPaceBand = null;
                foreach (var fielder in scene.Fielders)
                {
                    if (fielder.Role != "keeper") continue;
                    fielder.X = 0.25;
                    fielder.Z = 10.06 + 0.8;
                }
                // A spinner's physics release (src/physics/constants.ts RELEASE_GEOMETRY.spin: 1.80-2.00 m high, 0.30 m
                // wide, 1.28 m in from the bowling crease), not the pace delivery's 2.30 m: the flight is shifted onto
                // it, the shift fading to nothing at the bounce, so the bowler fits a real spin release.
                var flightSamples = delivery.Flight;
                var release = flightSamples[0].p;
                var shift = new Vector3((float)(Math.Sign(release.x) * 0.30 - release.x), (float)(1.90 - release.y),
                    (float)(-10.06 + 1.28 - release.z));
                var bounceT = delivery.BounceT ?? flightSamples[flightSamples.Length - 1].t;
                ShiftPreBounce(flightSamples, bounceT, shift);
                // This is a labelled presentation-only synthetic case. Shift the accepted canonical ball by the same
                // fading offset so accepting the result cannot jump from the spin release back onto the pace flight.
                ShiftPreBounce(result.Trace.ball, bounceT, shift);
                if (result.Trace.events != null)
                    foreach (var traceEvent in result.Trace.events)
                        if (traceEvent != null && traceEvent.p != null && traceEvent.t < bounceT)
                            ShiftPreBouncePoint(traceEvent.p, traceEvent.t, bounceT, shift);

                var keeperId = scene.Fielders.First(fielder => fielder.Role == "keeper").Id;
                var keeperPath = result.Trace.fielders?.FirstOrDefault(path => path != null && path.fielderId == keeperId);
                var keeperStart = keeperPath?.samples?.FirstOrDefault(sample => sample != null);
                if (keeperStart != null)
                {
                    var keeperZ = scene.Fielders.First(fielder => fielder.Id == keeperId).Z;
                    var keeperShiftZ = keeperZ - keeperStart.z;
                    foreach (var sample in keeperPath.samples)
                        if (sample != null) sample.z += keeperShiftZ;
                }
            }

            var root = new GameObject("VANDE humans evidence " + name);
            var tracks = new Dictionary<string, HumanTrack>(StringComparer.Ordinal);
            var visibility = new Dictionary<string, VisibilityTrack>(StringComparer.Ordinal);
            var stills = new List<string>();
            var pipSummaries = new List<string>();
            var heldGaps = new List<float>();
            var limits = new LimitTally();
            var heroLimits = new LimitTally();
            var bowlerRunUp = "";
            var bowlerRelease = "";
            var completed = false;
            // Builder diagnostic (VANDE_HUMANS_TRACE=1): every human's per-frame hips, feet, palms and joint world
            // rotations, plus a fielder's planned clip, as trace-<case>.csv for offline analysis (bulk; scratch only).
            var rawTrace = Environment.GetEnvironmentVariable("VANDE_HUMANS_TRACE") == "1"
                ? new StringBuilder(TraceHeader())
                : null;
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = HumansHand,
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.High
                }, new NullSink());
                world.ConfigureScene(scene);
                world.DeliveryCompleted += (_, __) => completed = true;
                world.BeginDelivery(delivery);
                world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value.RecordGripSolvesForEvidence = true;
                var camera = world.BatterCameraForEvidence;
                var contactT = result.Trace.events.Where(e => e.kind == "contact").Select(e => (double?)e.t)
                    .FirstOrDefault();
                var instants = new List<KeyValuePair<string, double>>
                {
                    new KeyValuePair<string, double>("stance", world.TimelineForEvidence + 0.30),
                    new KeyValuePair<string, double>("runup-mid", world.TimelineForEvidence * 0.5),
                    new KeyValuePair<string, double>("gather", -0.30),
                    new KeyValuePair<string, double>("release", 0.0),
                    new KeyValuePair<string, double>("pre-contact", (contactT ?? 0.45) - 0.10),
                    new KeyValuePair<string, double>("contact", contactT ?? 0.45),
                    new KeyValuePair<string, double>("after-0.8s", (contactT ?? 0.45) + 0.8),
                    new KeyValuePair<string, double>("after-2.0s", (contactT ?? 0.45) + 2.0),
                    new KeyValuePair<string, double>("dead", result.Trace.durationSeconds)
                };
                var nextStill = 0;
                var accepted = false;
                var frames = 0;
                var maxFrames = (int)((-world.TimelineForEvidence + result.Trace.durationSeconds + 6.0) / Step);
                while (!completed && frames < maxFrames)
                {
                    if (!accepted && world.TimelineForEvidence >= AcceptAfterRelease)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                    }
                    ApplyArmSeams(world);
                    world.Tick(Step);
                    frames++;
                    var t = world.TimelineForEvidence;
                    var clock = frames * Step;
                    foreach (var human in world.PresentedHumansForEvidence())
                    {
                        HumanTrack track;
                        if (!tracks.TryGetValue(human.Key, out track))
                            tracks[human.Key] = track = new HumanTrack();
                        track.Record(human.Value, clock, t, world.StateForEvidence,
                            human.Key == "striker" && !world.StrikerRunningForTesting);
                        limits.Record(human.Key, human.Value, t, world.StateForEvidence);
                        heroLimits.RecordHero(human.Key, human.Value, t, world.StateForEvidence);
                        if (rawTrace != null) TraceRow(rawTrace, world, human.Key, human.Value, frames, clock, t);
                        if (human.Key == "keeper" || human.Key == "non-striker")
                        {
                            VisibilityTrack seen;
                            if (!visibility.TryGetValue(human.Key, out seen))
                                visibility[human.Key] = seen = new VisibilityTrack();
                            seen.Record(camera, human.Value, world.PresentedHumansForEvidence()
                                .First(pair => pair.Key == "striker").Value);
                        }
                    }
                    while (nextStill < instants.Count && t >= instants[nextStill].Value - 1e-9)
                    {
                        var stillName = name + "-" + (nextStill + 1).ToString("00") + "-" + instants[nextStill].Key;
                        var fade = world.KeeperOcclusionFade;
                        if (fade != null)
                        {
                            var keeperRig = world.PresentedHumansForEvidence().First(pair => pair.Key == "keeper").Value;
                            var shaders = string.Join(",", keeperRig.Root.GetComponentsInChildren<Renderer>()
                                .Select(r => r.GetType().Name + ":" + (r.sharedMaterial != null ? r.sharedMaterial.shader.name : "none"))
                                .Distinct());
                            Debug.Log("VANDE_KEEPER_FADE " + stillName + " fade=" + F(fade.Fade) + " overlapping=" +
                                      fade.Overlapping + " ellipse=" + fade.Ellipse + " keeperYaw=" +
                                      F(keeperRig.Root.eulerAngles.y) + " shaders=" + shaders);
                        }
                        Render(camera, 1280, 592, Path.Combine(output, stillName + ".jpg"));
                        var pip = world.FieldPipForEvidence;
                        if (pip != null)
                        {
                            Render(pip.Camera, pip.Texture.width, pip.Texture.height,
                                Path.Combine(output, stillName + "-pip.jpg"));
                            var inside = 0;
                            var total = 0;
                            foreach (var human in world.PresentedHumansForEvidence())
                            {
                                total++;
                                var v = pip.ViewportOf(human.Value.Root.position);
                                if (v.x >= 0f && v.x <= 1f && v.y >= 0f && v.y <= 1f) inside++;
                            }
                            pipSummaries.Add("\"" + stillName + "\":{\"humansInPip\":" + inside + ",\"humans\":" + total +
                                             ",\"markers\":" + pip.MarkerCount + "}");
                        }
                        stills.Add(stillName + ".jpg@t=" + F(t));
                        nextStill++;
                    }
                }
                heldGaps.AddRange(world.HeldBallReleaseHandGapsForEvidence());
                bowlerRunUp = world.BowlerRunUpForEvidence;
                bowlerRelease = world.BowlerReleaseGapForEvidence;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                if (rawTrace != null)
                    File.WriteAllText(Path.Combine(output, "trace-" + name + ".csv"), rawTrace.ToString());
            }

            var json = new StringBuilder();
            json.Append("{\"case\":\"").Append(name).Append("\",\"completed\":").Append(completed ? "true" : "false")
                .Append(",\"syntheticSpinPresentation\":").Append(spinKeeperUp ? "true" : "false")
                .Append(",\"syntheticSpinMethod\":")
                .Append(spinKeeperUp
                    ? "\"grounded-attack golden outcome with delivery/result pre-bounce points and velocities shifted onto spin release geometry; shift fades to zero at unchanged bounce; keeper path translated to the up position; authority/outcome unchanged\""
                    : "null")
                .Append(",\"stills\":[").Append(string.Join(",", stills.Select(s => "\"" + s + "\""))).Append("]")
                .Append(",\"humans\":{");
            json.Append(string.Join(",", tracks.Select(pair => "\"" + pair.Key + "\":" + pair.Value.Summary())));
            json.Append("},\"jointLimits\":").Append(limits.Json());
            json.Append(",\"heroJointLimits\":").Append(heroLimits.Json());
            json.Append(",\"pip\":{").Append(string.Join(",", pipSummaries)).Append("}");
            json.Append(",\"heldBallReleaseHandGapM\":[").Append(string.Join(",", heldGaps.Select(g => F(g))))
                .Append("],\"heldBallRule\":\"hand within 0.10 m of the physics release point at the throw\"")
                .Append(",\"bowlerRunUp\":\"").Append(bowlerRunUp).Append("\"")
                .Append(",\"bowlerRelease\":").Append(string.IsNullOrEmpty(bowlerRelease) ? "null" : bowlerRelease);
            json.Append(",\"visibility\":{");
            json.Append(string.Join(",", visibility.Select(pair => "\"" + pair.Key + "\":" + pair.Value.Summary())));
            json.Append("}}");
            return json.ToString();
        }

        private static void ShiftPreBounce(BallTraceSample[] samples, double bounceT, Vector3 shift)
        {
            if (samples == null) return;
            foreach (var sample in samples)
            {
                if (sample == null || sample.p == null || sample.t >= bounceT) continue;
                ShiftPreBouncePoint(sample.p, sample.t, bounceT, shift);
                if (sample.v != null)
                {
                    sample.v.x -= shift.x / Math.Max(1e-6, bounceT);
                    sample.v.y -= shift.y / Math.Max(1e-6, bounceT);
                    sample.v.z -= shift.z / Math.Max(1e-6, bounceT);
                }
            }
        }

        private static void ShiftPreBouncePoint(TraceVector3 point, double t, double bounceT, Vector3 shift)
        {
            var keep = 1.0 - Math.Max(0.0, t) / Math.Max(1e-6, bounceT);
            point.x += shift.x * keep;
            point.y += shift.y * keep;
            point.z += shift.z * keep;
        }

        // -------------------------------------------------------------------------------------------------------
        // MOTION-SPEC section 9 joint limits (scripts/motion/metrics.mjs jointViolation), on the driver rig
        // -------------------------------------------------------------------------------------------------------

        private const double Deg = 180.0 / Math.PI;

        /// <summary>Euler XYZ (three.js) X and Z of a quaternion, degrees: metrics.mjs eulerXYZ.</summary>
        private static void EulerXZ(Quaternion q, out double xDeg, out double zDeg)
        {
            double x = q.x, y = q.y, z = q.z, w = q.w;
            var m11 = 1 - 2 * (y * y + z * z);
            var m12 = 2 * (x * y - w * z);
            var m13 = 2 * (x * z + w * y);
            var m22 = 1 - 2 * (x * x + z * z);
            var m23 = 2 * (y * z - w * x);
            var m32 = 2 * (y * z + w * x);
            var m33 = 1 - 2 * (x * x + y * y);
            if (Math.Abs(m13) < 0.9999999)
            {
                xDeg = Math.Atan2(-m23, m33) * Deg;
                zDeg = Math.Atan2(-m12, m11) * Deg;
            }
            else
            {
                xDeg = Math.Atan2(m32, m22) * Deg;
                zDeg = 0.0;
            }
        }

        /// <summary>Swing (degrees, of the bone's Y axis) and twist (degrees, about Y): metrics.mjs swingTwist.</summary>
        private static void SwingTwist(Quaternion q, out double swingDeg, out double twistDeg)
        {
            double x = q.x, y = q.y, z = q.z, w = q.w;
            var l = Math.Sqrt(y * y + w * w);
            if (l == 0.0) l = 1.0;
            var ty = y / l;
            var tw = w / l;
            var twist = 2.0 * Math.Atan2(ty, tw) * Deg;
            var sw = w * tw + y * ty;
            swingDeg = 2.0 * Math.Acos(Math.Min(1.0, Math.Abs(sw))) * Deg;
            twistDeg = ((twist + 540.0) % 360.0) - 180.0;
        }

        private static double TotalAngle(Quaternion q) => 2.0 * Math.Acos(Math.Min(1.0, Math.Abs((double)q.w))) * Deg;

        /// <summary>
        /// jointViolation for one driver joint's local rotation (the canonical VC17 frame: the driver's rest is the identity and
        /// its limbs hang along -Y). The limits are the same for both sides and unchanged by the canonical mirror (x, -y, -z, w),
        /// so the L/R relabelling of MOTION-SPEC section 3 does not change a result. Returns the bone type ("forearm"), how far
        /// past the limit it is (degrees) and the numbers, or false.
        /// </summary>
        private static bool JointLimitExceeded(ProductionCharacterJoint joint, Quaternion q, out string type, out double excess,
            out string detail)
        {
            type = "";
            excess = 0.0;
            detail = "";
            double ex, ez, swing, twist;
            switch (joint)
            {
                case ProductionCharacterJoint.ShinLeft:
                case ProductionCharacterJoint.ShinRight:
                    EulerXZ(q, out ex, out ez);
                    excess = Math.Max(Math.Max(-5.0 - ex, ex - 155.0), Math.Abs(ez) - 10.0);
                    type = "shin";
                    detail = "X " + ex.ToString("0.0", CultureInfo.InvariantCulture) + " Z " + ez.ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                case ProductionCharacterJoint.ForearmLeft:
                case ProductionCharacterJoint.ForearmRight:
                    EulerXZ(q, out ex, out ez);
                    excess = Math.Max(Math.Max(-150.0 - ex, ex - 5.0), Math.Abs(ez) - 12.0);
                    type = "forearm";
                    detail = "X " + ex.ToString("0.0", CultureInfo.InvariantCulture) + " Z " + ez.ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                case ProductionCharacterJoint.FootLeft:
                case ProductionCharacterJoint.FootRight:
                    EulerXZ(q, out ex, out ez);
                    excess = Math.Max(-40.0 - ex, ex - 60.0);
                    type = "foot";
                    detail = "X " + ex.ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                case ProductionCharacterJoint.ThighLeft:
                case ProductionCharacterJoint.ThighRight:
                    SwingTwist(q, out swing, out twist);
                    excess = Math.Max(swing - 135.0, Math.Abs(twist) - 50.0);
                    type = "thigh";
                    detail = "swing " + swing.ToString("0.0", CultureInfo.InvariantCulture) + " twist " + twist.ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                case ProductionCharacterJoint.UpperArmLeft:
                case ProductionCharacterJoint.UpperArmRight:
                    SwingTwist(q, out swing, out twist);
                    excess = Math.Max(swing - 185.0, Math.Abs(twist) - 110.0);
                    type = "upperArm";
                    detail = "swing " + swing.ToString("0.0", CultureInfo.InvariantCulture) + " twist " + twist.ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                case ProductionCharacterJoint.HandLeft:
                case ProductionCharacterJoint.HandRight:
                    SwingTwist(q, out swing, out twist);
                    excess = swing - 85.0;
                    type = "hand";
                    detail = "swing " + swing.ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                case ProductionCharacterJoint.Spine:
                case ProductionCharacterJoint.Chest:
                    excess = TotalAngle(q) - 75.0;
                    type = joint == ProductionCharacterJoint.Spine ? "spine" : "chest";
                    detail = TotalAngle(q).ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                case ProductionCharacterJoint.Neck:
                case ProductionCharacterJoint.Head:
                    excess = TotalAngle(q) - 80.0;
                    type = joint == ProductionCharacterJoint.Neck ? "neck" : "head";
                    detail = TotalAngle(q).ToString("0.0", CultureInfo.InvariantCulture);
                    break;
                default:
                    return false;
            }
            return excess > 0.0;
        }

        /// <summary>Counts, per human and bone type, the frames the driver rig breaks a section 9 joint limit, with the worst one.</summary>
        private sealed class LimitTally
        {
            private sealed class Stat
            {
                public long Frames;
                public double Worst;
                public string Example = "";
                /// <summary>Frames over the limit by world state (RunUp, Flight, Resolved, Recovery, Outcome...).</summary>
                public readonly Dictionary<string, long> States = new Dictionary<string, long>(StringComparer.Ordinal);
            }

            private readonly Dictionary<string, Dictionary<string, Stat>> byHuman =
                new Dictionary<string, Dictionary<string, Stat>>(StringComparer.Ordinal);
            private readonly Dictionary<string, long> frames = new Dictionary<string, long>(StringComparer.Ordinal);

            public void Record(string human, ProductionCharacterRig rig, double t, string state)
            {
                var group = human.StartsWith("fielder:", StringComparison.Ordinal) ? "fielders" : human;
                long count;
                frames.TryGetValue(group, out count);
                frames[group] = count + 1;
                Dictionary<string, Stat> stats;
                if (!byHuman.TryGetValue(group, out stats)) byHuman[group] = stats = new Dictionary<string, Stat>(StringComparer.Ordinal);
                for (var index = 0; index < (int)ProductionCharacterJoint.Count; index++)
                {
                    var joint = (ProductionCharacterJoint)index;
                    string type, detail;
                    double excess;
                    if (!JointLimitExceeded(joint, rig.Joint(joint).localRotation, out type, out excess, out detail)) continue;
                    Stat stat;
                    if (!stats.TryGetValue(type, out stat)) stats[type] = stat = new Stat();
                    stat.Frames++;
                    long inState;
                    stat.States.TryGetValue(state, out inState);
                    stat.States[state] = inState + 1;
                    if (excess > stat.Worst)
                    {
                        stat.Worst = excess;
                        stat.Example = joint + " " + detail + " at t=" + t.ToString("0.000", CultureInfo.InvariantCulture) + " (" + state + ")";
                    }
                }
            }

            /// <summary>
            /// The same count on the VISIBLE hero's arms (UNITY-4 H1): each arm bone read back to canonical VC17 frames
            /// (ProductionHeroArm.Read) and given jointLimit's limits. Variants: upperArm (in the chest's frame, the shoulder girdle
            /// included), upperArmShoulder (in the shoulder helper's frame), forearm (the hinge, in the upper arm's canonical frame),
            /// forearmSynchronized (the plain inverse of Synchronize: not a joint angle, kept for comparison), hand (the wrist's bend).
            /// Counts are joint-frames, two arms a frame.
            /// </summary>
            public void RecordHero(string human, ProductionCharacterRig rig, double t, string state)
            {
                var skeleton = rig.VisibleHeroSkeleton;
                if (skeleton == null) return;
                var group = human.StartsWith("fielder:", StringComparison.Ordinal) ? "fielders" : human;
                long count;
                frames.TryGetValue(group, out count);
                frames[group] = count + 1;
                Dictionary<string, Stat> stats;
                if (!byHuman.TryGetValue(group, out stats)) byHuman[group] = stats = new Dictionary<string, Stat>(StringComparer.Ordinal);
                foreach (var left in new[] { true, false })
                {
                    var arm = ProductionHeroArm.Read(skeleton, left);
                    // A running batter carries the bat in one hand and the other arm is left to the gait (the retarget's arm, not
                    // the grip solve's): counted apart (suffix Free).
                    // UNITY-5: the bowler's non-delivery arm is counted apart the same way (the delivery arm is the one
                    // SynchronizeHeroPose solves to the release anchor: label left for a Left rig). Before UNITY-5 both
                    // of his arms were one count, so a bowler's "forearm" figure mixed the arm the grip IK solves with the one it never does.
                    var bowler = rig.Role == ProductionCharacterRole.PaceBowler || rig.Role == ProductionCharacterRole.SpinBowler;
                    var free = (rig.Role == ProductionCharacterRole.Batter && rig.BatterOneHandCarry &&
                                left == (rig.Handedness == ProductionCharacterHandedness.Right)) ||
                               (bowler && left != (rig.Handedness == ProductionCharacterHandedness.Left));
                    var suffix = free ? "Free" : "";
                    Tally(stats, "upperArm" + suffix, left ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight, arm.UpperVsChest, t, state);
                    Tally(stats, "upperArmShoulder" + suffix, left ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight, arm.UpperVsShoulder, t, state);
                    Tally(stats, "forearm" + suffix, left ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight, arm.Forearm, t, state);
                    Tally(stats, "forearmSynchronized" + suffix, left ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight, arm.ForearmSynchronized, t, state);
                    Tally(stats, "hand" + suffix, left ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight, arm.Hand, t, state);
                }
            }

            private static void Tally(Dictionary<string, Stat> stats, string variant, ProductionCharacterJoint joint, Quaternion q,
                double t, string state)
            {
                string type, detail;
                double excess;
                if (!JointLimitExceeded(joint, q, out type, out excess, out detail)) return;
                Stat stat;
                if (!stats.TryGetValue(variant, out stat)) stats[variant] = stat = new Stat();
                stat.Frames++;
                long inState;
                stat.States.TryGetValue(state, out inState);
                stat.States[state] = inState + 1;
                if (excess > stat.Worst)
                {
                    stat.Worst = excess;
                    stat.Example = joint + " " + detail + " at t=" + t.ToString("0.000", CultureInfo.InvariantCulture) + " (" + state + ")";
                }
            }

            public string Json() =>
                "{" + string.Join(",", byHuman.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair =>
                    "\"" + pair.Key + "\":{\"frames\":" + frames[pair.Key] + ",\"bones\":{" +
                    string.Join(",", pair.Value.OrderBy(entry => entry.Key, StringComparer.Ordinal).Select(entry =>
                        "\"" + entry.Key + "\":{\"framesOverLimit\":" + entry.Value.Frames + ",\"worstOverDeg\":" + F(entry.Value.Worst) +
                        ",\"worst\":\"" + entry.Value.Example + "\",\"byState\":{" +
                        string.Join(",", entry.Value.States.OrderBy(state => state.Key, StringComparer.Ordinal)
                            .Select(state => "\"" + state.Key + "\":" + state.Value)) + "}}")) + "}}")) + "}";
        }

        private static readonly ProductionCharacterJoint[] HingeJoints =
        {
            ProductionCharacterJoint.ShinLeft, ProductionCharacterJoint.ShinRight, ProductionCharacterJoint.ForearmLeft,
            ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.UpperArmRight
        };

        private static readonly ProductionCharacterJoint[] LegPoints =
        {
            ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ShinLeft, ProductionCharacterJoint.FootLeft,
            ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.ShinRight, ProductionCharacterJoint.FootRight
        };

        /// <summary>
        /// The angles (degrees about the line from the shoulder to the grip, from the world's up) of the planes of one arm's elbow in the
        /// last visible-hero grip solve: the pose source's (`inAngle`), the one the handover held (`source`), the one it blended to
        /// (`target`) and the one the arm came to (`output`); NaN where undefined.
        /// </summary>
        private static void ElbowPlaneAngles(ProductionCharacterRig rig, bool left, out float inAngle, out float source,
            out float target, out float output)
        {
            inAngle = source = target = output = float.NaN;
            var grip = rig.LastHeroGripSolveForEvidence;
            var shoulder = rig.VisibleJointWorldPosition(left ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight);
            var gripTarget = left ? grip.LeftTarget : grip.RightTarget;
            var line = gripTarget - shoulder;
            if (line.sqrMagnitude < 1e-6f) return;
            var axis = line.normalized;
            var up = Vector3.up - axis * Vector3.Dot(Vector3.up, axis);
            if (up.sqrMagnitude < 1e-6f) return;
            Func<Vector3, float> angle = elbow =>
            {
                var side = elbow - shoulder;
                side -= axis * Vector3.Dot(side, axis);
                return side.sqrMagnitude < 1e-12f ? float.NaN : Vector3.SignedAngle(up.normalized, side.normalized, axis);
            };
            inAngle = angle(left ? grip.LeftElbowIn : grip.RightElbowIn);
            source = angle(left ? grip.LeftSourceElbow : grip.RightSourceElbow);
            target = angle(left ? grip.LeftTargetElbow : grip.RightTargetElbow);
            output = angle(rig.VisibleJointWorldPosition(left ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight));
        }

        private static string TraceHeader()
        {
            var header = new StringBuilder("human,frame,clock,t,state,clip,clipTime,clipWeight,move,");
            header.Append("rootX,rootY,rootZ,hipsX,hipsY,hipsZ,footLX,footLY,footLZ,footRX,footRY,footRZ,");
            header.Append("palmLX,palmLY,palmLZ,palmRX,palmRY,palmRZ,ballX,ballY,ballZ,poseRootX,poseRootY,poseRootZ");
            // Section 9 hinge check (lead 2026-11-04): the driver's local rotations (canonical VC17 frames, after the arm
            // IK) and the drawn and driver leg points (the hero leg IK: foot locks, pads) for the knee bend planes.
            foreach (var joint in HingeJoints)
                header.Append(",drv").Append(joint).Append("_qx,drv").Append(joint).Append("_qy,drv").Append(joint)
                    .Append("_qz,drv").Append(joint).Append("_qw");
            foreach (var joint in LegPoints)
                header.Append(",hero").Append(joint).Append("X,hero").Append(joint).Append("Y,hero").Append(joint)
                    .Append("Z,drvp").Append(joint).Append("X,drvp").Append(joint).Append("Y,drvp").Append(joint).Append("Z");
            foreach (var joint in PopJoints)
                header.Append(',').Append(joint).Append("_qx,").Append(joint).Append("_qy,").Append(joint)
                    .Append("_qz,").Append(joint).Append("_qw");
            // The visible hero's last grip solve (batters only): which path, and per arm the shoulder after the solve, the
            // elbow the solve was given, the grip target and the pole it came to: the elbow's offset from the shoulder-to-grip
            // line in mm and the angle of that offset about the line from the world's up (degrees). A straight arm has no offset.
            header.Append(",gripPath,gripWeight");
            foreach (var side in new[] { "L", "R" })
                header.Append(",shoulder").Append(side).Append("X,shoulder").Append(side).Append("Y,shoulder").Append(side)
                    .Append("Z,elbowIn").Append(side).Append("X,elbowIn").Append(side).Append("Y,elbowIn").Append(side)
                    .Append("Z,target").Append(side).Append("X,target").Append(side).Append("Y,target").Append(side)
                    .Append("Z,poleOff").Append(side).Append("Mm,poleAng").Append(side).Append("Deg,chestPoleSin").Append(side)
                    .Append(",poleAngSource").Append(side).Append("Deg,poleAngTarget").Append(side).Append("Deg,poleAngOut").Append(side)
                    .Append("Deg,poleOffOut").Append(side).Append("Mm");
            header.Append(",prevArmWeight,armWeight,transCaptured,targetCaptured");
            return header.Append('\n').ToString();
        }

        private static void TraceRow(StringBuilder csv, ProceduralPracticeWorld world, string key,
            ProductionCharacterRig rig, int frame, double clock, double t)
        {
            var clip = "";
            var clipTime = double.NaN;
            var weight = double.NaN;
            var move = -1;
            if (key.StartsWith("fielder:", StringComparison.Ordinal) || key == "keeper" || key == "bowler")
            {
                ProductionFieldingTrack track = null;
                if (key.StartsWith("fielder:", StringComparison.Ordinal))
                    track = world.FieldingTrackForTesting(key.Substring("fielder:".Length));
                else track = world.FieldingTrackForRoleForEvidence(key);
                if (track != null && track.Moves.Count > 0)
                {
                    var state = track.Evaluate(t);
                    clip = state.Clip.ToString();
                    clipTime = state.ClipTime;
                    weight = state.Weight;
                    move = state.MoveIndex;
                }
            }
            Action<Vector3> v = p => csv.Append(',').Append(F(p.x)).Append(',').Append(F(p.y)).Append(',').Append(F(p.z));
            csv.Append(key).Append(',').Append(frame).Append(',').Append(F(clock)).Append(',').Append(F(t)).Append(',')
                .Append(world.StateForEvidence).Append(',').Append(clip).Append(',').Append(F(clipTime)).Append(',')
                .Append(F(weight)).Append(',').Append(move);
            v(rig.Root.position);
            v(rig.VisibleJointWorldPosition(ProductionCharacterJoint.Hips));
            v(rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootLeft));
            v(rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootRight));
            Func<ProductionCharacterJoint, ProductionCharacterJoint, Vector3> palm = (forearm, hand) =>
            {
                var wrist = rig.VisibleJointWorldPosition(hand);
                var along = wrist - rig.VisibleJointWorldPosition(forearm);
                return along.sqrMagnitude > 1e-6f ? wrist + along.normalized * 0.065f : wrist;
            };
            v(palm(ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft));
            v(palm(ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight));
            var ball = world.BallForEvidence;
            v(ball != null ? ball.position : Vector3.zero);
            v(rig.PoseRootOffset);
            foreach (var joint in HingeJoints)
            {
                var q = rig.Joint(joint).localRotation;
                csv.Append(',').Append(F(q.x)).Append(',').Append(F(q.y)).Append(',').Append(F(q.z)).Append(',')
                    .Append(F(q.w));
            }
            foreach (var joint in LegPoints)
            {
                v(rig.VisibleJointWorldPosition(joint));
                v(rig.Joint(joint).position);
            }
            foreach (var joint in PopJoints)
            {
                var q = rig.VisibleJointWorldRotation(joint);
                csv.Append(',').Append(F(q.x)).Append(',').Append(F(q.y)).Append(',').Append(F(q.z)).Append(',')
                    .Append(F(q.w));
            }
            var grip = rig.LastHeroGripSolveForEvidence;
            csv.Append(',').Append(grip.Path).Append(',').Append(F(grip.GripWeight));
            foreach (var left in new[] { true, false })
            {
                var shoulder = rig.VisibleJointWorldPosition(left ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight);
                var elbowIn = left ? grip.LeftElbowIn : grip.RightElbowIn;
                var target = left ? grip.LeftTarget : grip.RightTarget;
                var pole = left ? grip.LeftPole : grip.RightPole;
                v(shoulder);
                v(elbowIn);
                v(target);
                var reach = target - shoulder;
                var offsetMm = float.NaN;
                var angle = float.NaN;
                var chestSine = float.NaN;
                if (reach.sqrMagnitude > 1e-6f)
                {
                    var direction = reach.normalized;
                    var offset = elbowIn - shoulder;
                    offset -= direction * Vector3.Dot(offset, direction);
                    offsetMm = offset.magnitude * 1000f;
                    var reference = Vector3.up - direction * Vector3.Dot(Vector3.up, direction);
                    if (reference.sqrMagnitude > 1e-6f && offset.sqrMagnitude > 1e-12f)
                        angle = Vector3.SignedAngle(reference.normalized, offset.normalized, direction);
                    if (pole.sqrMagnitude > 1e-12f)
                        chestSine = Vector3.Cross(pole.normalized, direction).magnitude;
                }
                csv.Append(',').Append(F(offsetMm)).Append(',').Append(F(angle)).Append(',').Append(F(chestSine));
                // The pole's angle (degrees about the grip line, from the world's up) of the source and target elbows the solve
                // used and of the elbow it came to, and the output elbow's offset from the line (mm).
                Func<Vector3, Vector3, float> poleAngle = (elbow, origin) =>
                {
                    var line = target - origin;
                    if (line.sqrMagnitude < 1e-6f) return float.NaN;
                    var axis = line.normalized;
                    var side = elbow - origin;
                    side -= axis * Vector3.Dot(side, axis);
                    var up = Vector3.up - axis * Vector3.Dot(Vector3.up, axis);
                    if (up.sqrMagnitude < 1e-6f || side.sqrMagnitude < 1e-12f) return float.NaN;
                    return Vector3.SignedAngle(up.normalized, side.normalized, axis);
                };
                var elbowOut = rig.VisibleJointWorldPosition(left ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight);
                var outOffset = float.NaN;
                if (reach.sqrMagnitude > 1e-6f)
                {
                    var axis = reach.normalized;
                    var side = elbowOut - shoulder;
                    side -= axis * Vector3.Dot(side, axis);
                    outOffset = side.magnitude * 1000f;
                }
                csv.Append(',').Append(F(poleAngle(left ? grip.LeftSourceElbow : grip.RightSourceElbow, shoulder))).Append(',')
                    .Append(F(poleAngle(left ? grip.LeftTargetElbow : grip.RightTargetElbow, shoulder))).Append(',')
                    .Append(F(poleAngle(elbowOut, shoulder))).Append(',').Append(F(outOffset));
            }
            csv.Append(',').Append(F(grip.PreviousTransitionWeight)).Append(',').Append(F(grip.TransitionWeight)).Append(',')
                .Append(grip.TransitionCaptured ? 1 : 0).Append(',').Append(grip.ArmTargetCaptured ? 1 : 0);
            csv.Append('\n');
        }

        /// <summary>
        /// Bowler release probe (builder diagnostic, lead ruling 2026-11-04: the ball on the physics release point
        /// within 3 cm, feet planted, scale clamp [0.95, 1.12], arm IK plus up to 15 degrees of trunk). For each action
        /// (pace, off-spin, leg-spin; right and left arm) and a grid of physics release points over the physics
        /// release geometry (src/physics/constants.ts RELEASE_GEOMETRY: pace 2.05-2.30 m, +0.04 bouncer, -0.02 yorker;
        /// spin 1.80-2.00 m), poses the composed run-up at its release and measures the ball-in-hand anchor against
        /// the release point. Writes release-probe.json to VANDE_EVIDENCE_OUT.
        /// </summary>
        public static void ReleaseProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var item = LoadFixture().cases.Single(c => c.id == "grounded-attack");
            const double pitchHalf = 10.06;
            var rows = new List<string>();
            foreach (var family in new[] { "pace", "off", "leg" })
            foreach (var arm in new[] { "right", "left" })
            {
                var heights = family == "pace"
                    ? new[] { 2.03, 2.05, 2.15, 2.30, 2.34 }
                    : new[] { 1.80, 1.90, 2.00 };
                foreach (var height in heights)
                {
                    var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
                    var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
                    scene.BowlerFamily = family == "pace" ? "pace" : "spin";
                    scene.BowlerSpinType = family == "pace" ? null : family == "leg" ? "wrist" : "finger";
                    if (family != "pace") scene.BowlerPaceBand = null;
                    scene.BowlerArm = arm;
                    var armSign = arm == "right" ? 1.0 : -1.0;
                    var release = delivery.Flight[0].p;
                    release.x = armSign * (family == "pace" ? 0.42 : 0.30);
                    release.y = height;
                    release.z = -pitchHalf + (family == "pace" ? 1.4 : 1.28);
                    var root = new GameObject("VANDE release probe");
                    try
                    {
                        var world = root.AddComponent<ProceduralPracticeWorld>();
                        world.Configure(new PracticePresentationSettings
                        {
                            Assistance = "play",
                            Handedness = "right",
                            Locale = "en-IN",
                            Quality = PracticePresentationQuality.High
                        }, new NullSink());
                        world.ConfigureScene(scene);
                        world.BeginDelivery(delivery);
                        rows.Add("{\"action\":\"" + family + "\",\"arm\":\"" + arm + "\",\"releaseY\":" + F(height) +
                                 ",\"result\":" + (world.BowlerReleaseGapForEvidence ?? "null") + "}");
                    }
                    finally
                    {
                        UnityEngine.Object.DestroyImmediate(root);
                    }
                }
            }
            File.WriteAllText(Path.Combine(output, "release-probe.json"),
                "{\"rule\":\"ball-in-hand anchor within 0.03 m of the physics release point\",\"rows\":[" +
                string.Join(",", rows) + "]}");
        }

        /// <summary>
        /// One press played frame by frame (VANDE_TOUCHDOWN_FLIGHT: a flight id of VANDE_TOUCHDOWN_FLIGHTS, else the first golden
        /// delivery; VANDE_TOUCHDOWN_HAND; VANDE_TOUCHDOWN_PRESS: s after the release; VANDE_TOUCHDOWN_FROM/TO: s): the presented
        /// bat, what the world commanded for it and the same moment with no input, every 4 ms. Writes touchdown-frames.csv.
        /// </summary>
        public static void TouchdownFrames()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            Func<string, double, double> number = (name, fallback) =>
            {
                var text = Environment.GetEnvironmentVariable(name);
                return string.IsNullOrEmpty(text) ? fallback : double.Parse(text, CultureInfo.InvariantCulture);
            };
            const double step = 0.004;
            var press = number("VANDE_TOUCHDOWN_PRESS", 0.004);
            var from = number("VANDE_TOUCHDOWN_FROM", press);
            var to = number("VANDE_TOUCHDOWN_TO", press + 0.3);
            var hand = Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_HAND") ?? "right";
            var fixture = LoadFixture();
            FlightEntry flight = null;
            var corpusPath = Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_FLIGHTS");
            var wanted = Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_FLIGHT");
            if (!string.IsNullOrEmpty(corpusPath))
            {
                var corpus = JsonUtility.FromJson<FlightCorpus>(File.ReadAllText(corpusPath));
                flight = string.IsNullOrEmpty(wanted) ? corpus.flights[0] : corpus.flights.First(entry => entry.id == wanted);
                hand = flight.hand;
            }
            var item = fixture.cases[0];
            var free = PlayTouchdown(item, hand, 0.0, null, step, to + 0.01, flight).Samples.ToDictionary(sample => sample.T, sample => sample);
            var run = PlayTouchdown(item, hand, 0.0, press, step, to + 0.01, flight);
            var lines = new List<string>
            {
                "t,travel,commandDrawn,commandT,presentedCapX,presentedCapY,presentedCapZ,presentedToeX,presentedToeY,presentedToeZ," +
                "commandCapX,commandCapY,commandCapZ,commandToeX,commandToeY,commandToeZ,freeCapX,freeCapY,freeCapZ,freeToeX,freeToeY,freeToeZ," +
                "presentedStepCapM,presentedStepToeM,commandStepCapM,commandStepToeM,freeStepToeM,distanceToBallM,freeDistanceM"
            };
            var havePrevious = false;
            var previous = default(TouchSample);
            foreach (var sample in run.Samples)
            {
                if (sample.T < from - 1e-9 || sample.T > to + 1e-9) continue;
                TouchSample idle;
                if (!free.TryGetValue(sample.T, out idle)) continue;
                var stepCap = havePrevious ? Vector3.Distance(previous.Cap, sample.Cap) : 0f;
                var stepToe = havePrevious ? Vector3.Distance(previous.Toe, sample.Toe) : 0f;
                var commandCap = havePrevious && previous.CommandDrawn && sample.CommandDrawn ? Vector3.Distance(previous.CommandCap, sample.CommandCap) : 0f;
                var commandToe = havePrevious && previous.CommandDrawn && sample.CommandDrawn ? Vector3.Distance(previous.CommandToe, sample.CommandToe) : 0f;
                TouchSample idlePrevious;
                var freeToe = havePrevious && free.TryGetValue(previous.T, out idlePrevious) ? Vector3.Distance(idlePrevious.Toe, idle.Toe) : 0f;
                Func<Vector3, string> v3 = v => F(v.x) + "," + F(v.y) + "," + F(v.z);
                lines.Add(F(sample.T) + "," + F(sample.Travel) + "," + (sample.CommandDrawn ? 1 : 0) + "," + F(sample.CommandT) + "," +
                          v3(sample.Cap) + "," + v3(sample.Toe) + "," + v3(sample.CommandCap) + "," + v3(sample.CommandToe) + "," +
                          v3(idle.Cap) + "," + v3(idle.Toe) + "," + F(stepCap) + "," + F(stepToe) + "," + F(commandCap) + "," +
                          F(commandToe) + "," + F(freeToe) + "," + F(sample.Distance) + "," + F(idle.Distance));
                previous = sample;
                havePrevious = true;
            }
            File.WriteAllLines(Path.Combine(output, "touchdown-frames.csv"), lines);
        }

        /// <summary>{n, min, p25, median, p75, max} of a list, as JSON.</summary>
        private static string Spread(List<double> values)
        {
            if (values.Count == 0) return "null";
            var sorted = values.OrderBy(value => value).ToList();
            Func<double, double> at = fraction => sorted[Math.Min(sorted.Count - 1, (int)(fraction * sorted.Count))];
            return "{\"n\":" + sorted.Count + ",\"min\":" + F(sorted[0]) + ",\"p25\":" + F(at(0.25)) + ",\"median\":" +
                   F(at(0.5)) + ",\"p75\":" + F(at(0.75)) + ",\"max\":" + F(sorted[sorted.Count - 1]) + "}";
        }

        /// <summary>One sample of a touch-down run: the striker's bat at a time, and the ball's distance to its axis.</summary>
        private struct TouchSample
        {
            public double T;
            public Vector3 Cap;
            public Vector3 Toe;
            public float Distance;
            /// <summary>What the world last commanded for the press: the time it was for, whether the stroke was drawn, the bat and the travel.</summary>
            public double CommandT;
            public bool CommandDrawn;
            public Vector3 CommandCap;
            public Vector3 CommandToe;
            public double Travel;
        }

        private sealed class TouchRun
        {
            public readonly List<TouchSample> Samples = new List<TouchSample>();
            /// <summary>Frames the touch-down stroke was drawn, and of them the frames the clearance guard held it back.</summary>
            public int DrawnFrames;
            public int HeldFrames;
            /// <summary>The guarded draw's cost this run: calls, mean and largest (ms).</summary>
            public int DrawCalls;
            public double DrawMeanMs, DrawMaxMs;
            /// <summary>
            /// 200 ms after the press, with the cap reached and no guard: the angle (degrees) between the waiting bat's blade and
            /// the hitting pose's, how far the stroke turned the blade from the waiting bat's, and how far its grip and toe
            /// (m) are from the waiting bat's. NaN when there was no press.
            /// </summary>
            public double GapDegrees = double.NaN, TurnDegrees = double.NaN, GripMetres = double.NaN, ToeMetres = double.NaN;
        }

        private static float SegmentDistanceToBall(Vector3 ball, Vector3 cap, Vector3 toe)
        {
            var ab = toe - cap;
            var u = Mathf.Clamp01(Vector3.Dot(ball - cap, ab) / ab.sqrMagnitude);
            return Vector3.Distance(ball, cap + ab * u);
        }

        /// <summary>
        /// A fresh production world on a golden delivery with the striker's hand `hand`, the whole flight shifted `lineShift`
        /// m across (the physics frame's x) and, with `flight`, the web sweep's own flight (the frozen physics, exported by a
        /// scratch vitest) on the golden scene; the delivery has begun. The caller destroys `root`.
        /// </summary>
        private static ProceduralPracticeWorld OpenTouchdownWorld(GoldenCase item, string hand, double lineShift,
            FlightEntry flight, out GameObject root)
        {
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            scene.Handedness = hand;
            if (flight != null)
            {
                delivery.Flight = flight.samples.Select(sample => new BallTraceSample
                {
                    t = sample.t,
                    p = new TraceVector3 { x = sample.p.x, y = sample.p.y, z = sample.p.z },
                    v = new TraceVector3 { x = sample.v.x, y = sample.v.y, z = sample.v.z }
                }).ToArray();
                delivery.IdealContactT = flight.idealContactT;
                scene.BowlerFamily = flight.family;
                scene.BowlerArm = flight.arm;
                if (flight.family == "spin") scene.BowlerSpinType = "finger";
            }
            if (lineShift != 0.0)
                foreach (var sample in delivery.Flight)
                    if (sample != null && sample.p != null) sample.p.x += lineShift;
            root = new GameObject("VANDE touchdown probe");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play", Handedness = hand, Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullSink());
            world.ConfigureScene(scene);
            world.BeginDelivery(delivery);
            world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value.RecordGripSolvesForEvidence = true;
            // Builder A/B (UNITY-5 F2): VANDE_PROVISIONAL=legacy keeps the code-authored stroke's body through a committed swing.
            if (Environment.GetEnvironmentVariable("VANDE_PROVISIONAL") == "legacy") world.ProvisionalPackBodyEnabled = false;
            // Builder A/B (UNITY-7 A): VANDE_PENDING_BALL=legacy draws a ball whose result has not arrived as before (the pre-contact line
            // through the bat, then frozen at the flight's last sample).
            if (Environment.GetEnvironmentVariable("VANDE_PENDING_BALL") == "legacy") world.PendingBallHidden = false;
            // Builder A/B (UNITY-7 B): VANDE_PREDICTED_BAT=legacy draws the code-authored stroke's bat as the committed swing's.
            if (Environment.GetEnvironmentVariable("VANDE_PREDICTED_BAT") == "legacy") world.PredictedCommittedBatEnabled = false;
            // Builder A/B (UNITY-7 B): VANDE_ELBOW_MEMORY=legacy lets the accept's own arm solves overwrite the elbow memory.
            if (Environment.GetEnvironmentVariable("VANDE_ELBOW_MEMORY") == "legacy") world.KeepElbowMemoryAcrossAccept = false;
            // Builder A/B (UNITY-7 C): VANDE_LEAVE_OVERLAY=legacy leaves a leave as the code-authored stance.
            if (Environment.GetEnvironmentVariable("VANDE_LEAVE_OVERLAY") == "legacy") world.LeaveOverlayEnabled = false;
            // Builder A/B (UNITY-8): VANDE_GOVERNED_PACK=legacy keeps a governed stride on the code-authored stroke.
            if (Environment.GetEnvironmentVariable("VANDE_GOVERNED_PACK") == "legacy") world.GovernedPackStrokeEnabled = false;
            // Builder A/B (UNITY-8): VANDE_DEADBALL_RECOVERY=legacy begins the dead-ball recovery in the frame TRACKB's stroke was drawn in.
            if (Environment.GetEnvironmentVariable("VANDE_DEADBALL_RECOVERY") == "legacy") world.DeadBallRecoveryAfterPackStrokeFrame = false;
            // Builder A/B (UNITY-8): VANDE_HELD_BAT=legacy draws the physics bat's first sample once its knots are used up (the stroke's follow-through).
            if (Environment.GetEnvironmentVariable("VANDE_HELD_BAT") == "legacy") world.HeldBatKnotsEnabled = false;
            var reach = Environment.GetEnvironmentVariable("VANDE_PREDICTED_REACH");
            if (!string.IsNullOrEmpty(reach)) world.PredictedBatReachMetres = float.Parse(reach, CultureInfo.InvariantCulture);
            return world;
        }

        /// <summary>
        /// Plays one golden delivery through the production world with the striker's hand `hand` and the whole flight
        /// shifted `lineShift` m across (the physics frame's x), a fresh world each time. With `press` the finger lands
        /// at that time after the release (uncommitted: it never lifts, swipes or commits); without it nothing is
        /// touched. Every 4 ms (`step`) from the press (or the release) to `until` it samples the drawn bat (cap, toe:
        /// 0.86 m along the bat) and the ball's distance to the bat's axis.
        /// </summary>
        private static TouchRun PlayTouchdown(GoldenCase item, string hand, double lineShift, double? press,
            double step, double until, FlightEntry flight = null)
        {
            var run = new TouchRun();
            var series = run.Samples;
            GameObject root;
            var world = OpenTouchdownWorld(item, hand, lineShift, flight, out root);
            try
            {
                var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                var pressed = false;
                var from = press ?? 0.0;
                world.Tick(Math.Max(0.0, Math.Max(0.0, from) - world.TimelineForEvidence));
                for (var guard = 0; guard < 600 && world.TimelineForEvidence <= until + 1e-9; guard++)
                {
                    if (press.HasValue && !pressed && world.TimelineForEvidence >= press.Value - 1e-9)
                    {
                        world.BeginLocalPreparation();
                        pressed = true;
                    }
                    var ball = world.BallForEvidence;
                    // UNITY-7 A: a ball whose result is pending is not drawn from the bat on; the sweep measures the bat against the
                    // delivery's flight line there, as before (the same samples, the same positions).
                    var ballDrawn = ball != null && ball.gameObject.activeInHierarchy;
                    var ballHeld = !ballDrawn && ball != null && world.BallHeldPendingForEvidence;
                    if ((ballDrawn || ballHeld) && striker.Bat != null)
                    {
                        var cap = striker.Bat.position;
                        var toe = cap + striker.Bat.TransformDirection(Vector3.down) * 0.86f;
                        double commandT, travel;
                        ProductionTouchDownBat.BatPose command;
                        var commandDrawn = world.TouchCommandedForEvidence(out commandT, out command, out travel);
                        series.Add(new TouchSample
                        {
                            T = Math.Round(world.TimelineForEvidence / step) * step,
                            Cap = cap,
                            Toe = toe,
                            Distance = SegmentDistanceToBall(ballDrawn ? ball.position : world.FlightBallForEvidence(world.TimelineForEvidence), cap, toe),
                            CommandT = commandT,
                            CommandDrawn = commandDrawn,
                            CommandCap = command.Grip,
                            CommandToe = command.Toe,
                            Travel = travel
                        });
                    }
                    world.Tick(step);
                }
                run.DrawnFrames = world.TouchDrawnFramesForEvidence;
                run.HeldFrames = world.TouchGuardHeldFramesForEvidence;
                world.TouchDrawCostForEvidence(out run.DrawCalls, out run.DrawMeanMs, out run.DrawMaxMs);
                if (press.HasValue)
                    world.TouchDownCapForEvidence(press.Value + 0.2, out run.GapDegrees, out run.TurnDegrees, out run.GripMetres,
                        out run.ToeMetres);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
            return run;
        }

        /// <summary>The largest displacement (m) of the bat's cap or toe between two samples.</summary>
        private static float BatStep(TouchSample a, TouchSample b) =>
            Mathf.Max(Vector3.Distance(a.Cap, b.Cap), Vector3.Distance(a.Toe, b.Toe));

        /// <summary>
        /// What the press itself adds to a step: the change, over the same two frames, of the drawn bat's offset from the
        /// bat with no input (cap or toe). The waiting bat's own motion cancels out of it.
        /// </summary>
        private static float AddedStep(TouchSample previous, TouchSample sample, TouchSample freePrevious, TouchSample freeNow) =>
            Mathf.Max(Vector3.Distance(sample.Cap - freeNow.Cap, previous.Cap - freePrevious.Cap),
                Vector3.Distance(sample.Toe - freeNow.Toe, previous.Toe - freePrevious.Toe));

        /// <summary>
        /// The 4 ms steps of the drawn bat, attributed: the total, the waiting bat's own over the same two frames (what the
        /// bat with no input does by itself) and what the press adds to it. A gate on the total says whether the bat
        /// pops; the other two say whose pop it is.
        /// </summary>
        private sealed class StepTally
        {
            public const float Limit = 0.08f;
            public long Steps, Over, OverFree, OverAdded;
            public float Max, MaxFree, MaxAdded;
            /// <summary>Where the largest total step was, with its waiting-bat and added parts.</summary>
            public string Where = "";

            public void Add(string where, TouchSample previous, TouchSample sample, TouchSample freePrevious, TouchSample freeNow)
            {
                var total = BatStep(previous, sample);
                var free = BatStep(freePrevious, freeNow);
                var added = AddedStep(previous, sample, freePrevious, freeNow);
                Steps++;
                if (total > Limit) Over++;
                if (total > Limit && free > Limit) OverFree++;
                if (added > Limit) OverAdded++;
                MaxFree = Mathf.Max(MaxFree, free);
                MaxAdded = Mathf.Max(MaxAdded, added);
                if (total > Max)
                {
                    Max = total;
                    Where = where + " " + F(sample.T - 0.004) + "->" + F(sample.T) + " s: cap " +
                            F(Vector3.Distance(previous.Cap, sample.Cap)) + " m, toe " + F(Vector3.Distance(previous.Toe, sample.Toe)) +
                            " m; waiting bat " + F(free) + " m; added by the press " + F(added) + " m";
                }
            }

            public void Merge(StepTally other)
            {
                Steps += other.Steps;
                Over += other.Over;
                OverFree += other.OverFree;
                OverAdded += other.OverAdded;
                MaxFree = Mathf.Max(MaxFree, other.MaxFree);
                MaxAdded = Mathf.Max(MaxAdded, other.MaxAdded);
                if (other.Max > Max)
                {
                    Max = other.Max;
                    Where = other.Where;
                }
            }

            public string Json() =>
                "\"largest4msStepM\":" + F(Max) + ",\"stepsOver8cm\":" + Over + ",\"stepsOver8cmWaitingBatToo\":" + OverFree +
                ",\"stepsOver8cmAddedByPress\":" + OverAdded + ",\"largestWaitingBatStepM\":" + F(MaxFree) +
                ",\"largestAddedStepM\":" + F(MaxAdded) + ",\"steps\":" + Steps;
        }

        /// <summary>
        /// CTL1 honesty probe (port of tests/unit/render3d/touchdown-bat.test.ts, TAP 2026-11-04; the clearance and the
        /// look-ahead are FEEL-1's, 2026-11-07): for each distinct golden delivery, presses from ideal contact - 0.5 s to
        /// + 0.1 s (after the release; every 20 ms here), uncommitted; every 4 ms the bat segment's distance to the drawn
        /// ball, against the same delivery with no input. The invariant: never nearer than the no-input bat at the same
        /// moment unless at least ProceduralPracticeWorld.TouchDownClearMetres (0.15 m) away; and the bat never steps more
        /// than 0.08 m between two 4 ms frames. Writes touchdown-honesty.json to VANDE_EVIDENCE_OUT.
        /// </summary>
        public static void TouchdownProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            const double step = 0.004;
            var clearM = (float)ProceduralPracticeWorld.TouchDownClearMetres;
            var rows = new List<string>();
            var seen = new HashSet<string>();
            foreach (var item in LoadFixture().cases)
            {
                var probe = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
                var key = probe.IdealContactT.ToString("0.####", CultureInfo.InvariantCulture) + "|" +
                          probe.Flight[0].p.y.ToString("0.####", CultureInfo.InvariantCulture);
                if (!seen.Add(key)) continue;
                var ideal = probe.IdealContactT;
                var free = PlayTouchdown(item, "right", 0.0, null, step, ideal + 0.1).Samples
                    .ToDictionary(sample => sample.T, sample => sample);
                var worstNearer = 0f;
                var worstPressT = double.NaN;
                var worstSampleT = double.NaN;
                var worstPressedDistance = float.NaN;
                var worstFreeDistance = float.NaN;
                var minDistance = float.PositiveInfinity;
                var violations = 0;
                var violatingPresses = new HashSet<double>();
                var presses = 0;
                var tally = new StepTally();
                // Presses on the same 4 ms grid as the no-input run, so both sample the ball at the same instants.
                var firstPress = Math.Ceiling(Math.Max(step, ideal - 0.5) / step) * step;
                for (var k = 0; firstPress + k * 0.02 <= ideal + 0.1 + 1e-9; k++)
                {
                    var press = Math.Round((firstPress + k * 0.02) / step) * step;
                    presses++;
                    var previous = default(TouchSample);
                    var havePrevious = false;
                    foreach (var sample in PlayTouchdown(item, "right", 0.0, press, step, ideal + 0.1).Samples)
                    {
                        if (sample.T < press - 1e-9) continue;
                        TouchSample without;
                        var haveWithout = free.TryGetValue(sample.T, out without);
                        TouchSample withoutBefore;
                        if (havePrevious && haveWithout && free.TryGetValue(previous.T, out withoutBefore))
                            tally.Add("press " + F(press), previous, sample, withoutBefore, without);
                        previous = sample;
                        havePrevious = true;
                        if (!haveWithout) continue;
                        minDistance = Mathf.Min(minDistance, sample.Distance);
                        if (sample.Distance < Mathf.Min(without.Distance, clearM) - 1e-4f)
                        {
                            violations++;
                            violatingPresses.Add(press);
                            var nearer = without.Distance - sample.Distance;
                            if (nearer > worstNearer)
                            {
                                worstNearer = nearer;
                                worstPressT = press;
                                worstSampleT = sample.T;
                                worstPressedDistance = sample.Distance;
                                worstFreeDistance = without.Distance;
                            }
                        }
                    }
                }
                rows.Add("{\"case\":\"" + item.id + "\",\"idealContactT\":" + F(ideal) + ",\"releaseY\":" +
                         F(probe.Flight[0].p.y) + ",\"presses\":" + presses + ",\"violations\":" + violations +
                         ",\"violatingPresses\":" + violatingPresses.Count +
                         ",\"worstNearerThanNoInputM\":" + F(worstNearer) +
                         ",\"worstPressT\":" + F(worstPressT) + ",\"worstSampleT\":" + F(worstSampleT) +
                         ",\"worstPressedDistanceM\":" + F(worstPressedDistance) +
                         ",\"worstNoInputDistanceM\":" + F(worstFreeDistance) +
                         ",\"minDistanceM\":" + F(minDistance) +
                         "," + tally.Json() + ",\"largestStepAt\":\"" + tally.Where + "\"}");
            }
            File.WriteAllText(Path.Combine(output, "touchdown-honesty.json"),
                "{\"clearM\":" + F(clearM) + ",\"rule\":\"uncommitted touch-down bat never nearer the ball than the no-input bat at the same moment unless >= " +
                F(clearM) + " m (src/render3d/practice/bat.ts TOUCHDOWN.clearM, FEEL-1 2026-11-07); the largest 4 ms step of the bat <= 0.08 m; presses every 20 ms from ideal-0.5 s (after release) to ideal+0.1 s, samples every 4 ms; golden deliveries only (the wider sweep is TouchdownSweep)\",\"rows\":[" +
                string.Join(",", rows) + "]}");
        }

        /// <summary>
        /// The web's clearance sweep (FEEL-1, src/render3d/practice bench parity.test.ts) on the Unity world: every distinct
        /// golden delivery, both hands, each flight also shifted across (VANDE_TOUCHDOWN_LINES, default 0,0.6 m), with an
        /// uncommitted press at the web's twelve moments about the ideal contact (-500 ... +60 ms), every 4 ms for 500 ms
        /// from the press. Per row: honesty violations (the drawn bat nearer the ball than min(no-input bat, clearM)), the
        /// largest 4 ms step of the bat (cap or toe) and how many exceed 8 cm, whether the bat answers a press within 17
        /// and 33 ms (it differs by more than 2 mm from the no-input bat, for the five realistic presses -250 ... -90 ms),
        /// and the share of frames in which the guard held the stroke back. Writes touchdown-sweep.json to
        /// VANDE_EVIDENCE_OUT.
        /// </summary>
        public static void TouchdownSweep()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            const double step = 0.004;
            var clearM = (float)ProceduralPracticeWorld.TouchDownClearMetres;
            var offsets = new[] { -0.5, -0.4, -0.3, -0.25, -0.2, -0.15, -0.12, -0.09, -0.06, -0.03, 0.0, 0.06 };
            var realistic = new[] { -0.25, -0.2, -0.15, -0.12, -0.09 };
            var lines = (Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_LINES") ?? "0,0.6").Split(',')
                .Select(value => double.Parse(value, CultureInfo.InvariantCulture)).ToArray();
            var hands = (Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_HANDS") ?? "right,left").Split(',');
            var rows = new List<string>();
            long checkedSamples = 0, violations = 0;
            var all = new StepTally();
            var presses = 0;
            var realisticPresses = 0;
            var moved17 = 0;
            var moved33 = 0;
            var notMoved = new List<string>();
            long drawnFrames = 0, heldFrames = 0, framesFromPress = 0, drawCalls = 0;
            double drawMsSum = 0.0, drawMsMax = 0.0;
            var gaps = new List<double>();
            var turns = new List<double>();
            var gripMoves = new List<double>();
            var toeMoves = new List<double>();
            var started = DateTime.UtcNow;
            // The runs: the golden deliveries (x hands x lines), or the web sweep's own 48 flights.
            var fixture = LoadFixture();
            var corpusPath = Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_FLIGHTS");
            var entries = new List<KeyValuePair<GoldenCase, FlightEntry>>();
            var seen = new HashSet<string>();
            if (!string.IsNullOrEmpty(corpusPath))
            {
                var corpus = JsonUtility.FromJson<FlightCorpus>(File.ReadAllText(corpusPath));
                foreach (var flight in corpus.flights) entries.Add(new KeyValuePair<GoldenCase, FlightEntry>(fixture.cases[0], flight));
            }
            else
            {
                foreach (var item in fixture.cases)
                {
                    var probe = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
                    var key = probe.IdealContactT.ToString("0.####", CultureInfo.InvariantCulture) + "|" +
                              probe.Flight[0].p.y.ToString("0.####", CultureInfo.InvariantCulture);
                    if (seen.Add(key)) entries.Add(new KeyValuePair<GoldenCase, FlightEntry>(item, null));
                }
            }
            foreach (var pair in entries)
            {
                var item = pair.Key;
                var flight = pair.Value;
                var ideal = flight != null
                    ? flight.idealContactT
                    : PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery)).IdealContactT;
                var runHands = flight != null ? new[] { flight.hand } : hands;
                var runLines = flight != null ? new[] { 0.0 } : lines;
                var label = flight != null ? flight.id : item.id;
                foreach (var hand in runHands)
                foreach (var line in runLines)
                {
                    var free = PlayTouchdown(item, hand, line, null, step, ideal + 0.6, flight).Samples
                        .ToDictionary(sample => sample.T, sample => sample);
                    long rowChecked = 0, rowViolations = 0;
                    var row = new StepTally();
                    var worstNearer = 0f;
                    foreach (var offset in offsets)
                    {
                        var press = Math.Max(step, Math.Round((ideal + offset) / step) * step);
                        presses++;
                        var run = PlayTouchdown(item, hand, line, press, step, press + 0.5, flight);
                        var played = run.Samples;
                        drawnFrames += run.DrawnFrames;
                        heldFrames += run.HeldFrames;
                        framesFromPress += played.Count(sample => sample.T >= press - 1e-9);
                        drawCalls += run.DrawCalls;
                        drawMsSum += run.DrawMeanMs * run.DrawCalls;
                        drawMsMax = Math.Max(drawMsMax, run.DrawMaxMs);
                        if (Array.IndexOf(realistic, offset) >= 0 && !double.IsNaN(run.GapDegrees))
                        {
                            gaps.Add(run.GapDegrees);
                            turns.Add(run.TurnDegrees);
                            gripMoves.Add(run.GripMetres);
                            toeMoves.Add(run.ToeMetres);
                        }
                        var previous = default(TouchSample);
                        var havePrevious = false;
                        foreach (var sample in played)
                        {
                            if (sample.T < press - 1e-9) continue;
                            TouchSample without;
                            if (!free.TryGetValue(sample.T, out without)) continue;
                            rowChecked++;
                            if (sample.Distance < Mathf.Min(without.Distance, clearM) - 1e-4f)
                            {
                                rowViolations++;
                                worstNearer = Mathf.Max(worstNearer, without.Distance - sample.Distance);
                            }
                            TouchSample withoutBefore;
                            if (havePrevious && free.TryGetValue(previous.T, out withoutBefore))
                                row.Add("press " + F(press) + " (" + F(offset) + " from ideal, +" + F(sample.T - press) + " s)",
                                    previous, sample, withoutBefore, without);
                            previous = sample;
                            havePrevious = true;
                        }
                        if (Array.IndexOf(realistic, offset) >= 0)
                        {
                            realisticPresses++;
                            Func<double, bool> answers = after =>
                            {
                                var at = Math.Round((press + after) / step) * step;
                                TouchSample drawn, idle;
                                var have = free.TryGetValue(at, out idle);
                                var found = false;
                                drawn = default(TouchSample);
                                foreach (var sample in played)
                                    if (Math.Abs(sample.T - at) < 1e-9) { drawn = sample; found = true; break; }
                                return have && found && BatStep(drawn, idle) > 0.002f;
                            };
                            if (answers(0.016)) moved17++;
                            else if (notMoved.Count < 12) notMoved.Add(label + ":" + hand + ":" + F(line) + ":" + F(offset));
                            if (answers(0.032)) moved33++;
                        }
                    }
                    checkedSamples += rowChecked;
                    violations += rowViolations;
                    all.Merge(row);
                    rows.Add("{\"case\":\"" + label + "\",\"hand\":\"" + hand + "\",\"lineShiftM\":" + F(line) +
                             ",\"checked\":" + rowChecked + ",\"violations\":" + rowViolations +
                             ",\"worstNearerThanNoInputM\":" + F(worstNearer) + "," + row.Json() +
                             ",\"largestStepAt\":\"" + row.Where + "\"}");
                    Debug.Log("VANDE touchdown sweep " + label + " " + hand + " line " + line + ": violations " + rowViolations +
                              " of " + rowChecked + ", step max " + row.Max.ToString("0.0000", CultureInfo.InvariantCulture) +
                              " [" + row.Where + "] (" + (DateTime.UtcNow - started).TotalSeconds.ToString("0", CultureInfo.InvariantCulture) + " s)");
                }
            }
            var summary = "{\"clearM\":" + F(clearM) + ",\"checked\":" + checkedSamples + ",\"violations\":" + violations +
                          "," + all.Json() + ",\"largestStepAt\":\"" + all.Where + "\"" +
                          ",\"presses\":" + presses + ",\"answers17ms\":\"" + moved17 + "/" + realisticPresses +
                          "\",\"answers33ms\":\"" + moved33 + "/" + realisticPresses + "\",\"notMoved17\":[" +
                          string.Join(",", notMoved.Select(value => "\"" + value + "\"")) + "],\"heldFramesPct\":" +
                          F(drawnFrames > 0 ? 100.0 * heldFrames / drawnFrames : 0.0) +
                          ",\"heldFramesPctOfAllFrames\":" + F(framesFromPress > 0 ? 100.0 * heldFrames / framesFromPress : 0.0) +
                          ",\"drawMsMean\":" + F(drawCalls > 0 ? drawMsSum / drawCalls : 0.0) + ",\"drawMsMax\":" + F(drawMsMax) +
                          ",\"capReached200ms\":{\"waitingToHitBladeGapDeg\":" + Spread(gaps) + ",\"bladeTurnedDeg\":" + Spread(turns) +
                          ",\"gripMovedM\":" + Spread(gripMoves) + ",\"toeMovedM\":" + Spread(toeMoves) + "}" +
                          ",\"seconds\":" + F((DateTime.UtcNow - started).TotalSeconds) + "}";
            File.WriteAllText(Path.Combine(output, "touchdown-sweep.json"),
                "{\"summary\":" + summary + ",\"rows\":[" + string.Join(",", rows) + "]}");
            Debug.Log("VANDE touchdown sweep summary " + summary);
        }

        // -------------------------------------------------------------------------------------------------------
        // U-D: the striker before the input, and at the pre-result to result hand-over
        // -------------------------------------------------------------------------------------------------------

        /// <summary>The striker at one moment: where the rig puts the root, the hips, the feet, the palms and the bat, and every joint.</summary>
        private sealed class StrikerFrame
        {
            public double T;
            public Vector3 Root, Hips, FootL, FootR, PalmL, PalmR, BatCap, BatToe;
            public Quaternion[] Driver;
            public Quaternion[] Visible;
            /// <summary>How far each hero glove (the hand joint) is from its ordered grip target on the bat (m).</summary>
            public float GloveOffLeft, GloveOffRight;
            public Vector3 ShoulderL, ShoulderR, GripTargetL, GripTargetR;
            /// <summary>The grip solve's path (see ProductionCharacterRig.HeroGripSolveRecord) and the right and left elbow planes (in, source, target, output).</summary>
            public int GripPath;
            public float[] PlaneR = new float[4];
            public float[] PlaneL = new float[4];
        }

        private static StrikerFrame CaptureStriker(ProductionCharacterRig rig, double t)
        {
            Func<ProductionCharacterJoint, ProductionCharacterJoint, Vector3> palm = (forearm, hand) =>
            {
                var wrist = rig.VisibleJointWorldPosition(hand);
                var along = wrist - rig.VisibleJointWorldPosition(forearm);
                return along.sqrMagnitude > 1e-6f ? wrist + along.normalized * 0.065f : wrist;
            };
            var frame = new StrikerFrame
            {
                T = t,
                Root = rig.Root.position,
                Hips = rig.VisibleJointWorldPosition(ProductionCharacterJoint.Hips),
                FootL = rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootLeft),
                FootR = rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootRight),
                PalmL = palm(ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft),
                PalmR = palm(ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight),
                BatCap = rig.Bat != null ? rig.Bat.position : Vector3.zero,
                BatToe = rig.Bat != null ? rig.Bat.position + rig.Bat.TransformDirection(Vector3.down) * 0.86f : Vector3.zero,
                Driver = new Quaternion[(int)ProductionCharacterJoint.Count],
                Visible = PopJoints.Select(rig.VisibleJointWorldRotation).ToArray()
            };
            for (var index = 0; index < frame.Driver.Length; index++)
                frame.Driver[index] = rig.Joint((ProductionCharacterJoint)index).localRotation;
            frame.GripPath = rig.LastHeroGripSolveForEvidence.Path;
            if (rig.VisibleHeroSkeletonActive && rig.Bat != null && !rig.BatterOneHandCarry)
            {
                frame.GloveOffLeft = Vector3.Distance(rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true));
                frame.GloveOffRight = Vector3.Distance(rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false));
                frame.ShoulderL = rig.VisibleJointWorldPosition(ProductionCharacterJoint.UpperArmLeft);
                frame.ShoulderR = rig.VisibleJointWorldPosition(ProductionCharacterJoint.UpperArmRight);
                frame.GripTargetL = rig.HeroBatterGripTargetWorld(true);
                frame.GripTargetR = rig.HeroBatterGripTargetWorld(false);
            }
            ElbowPlaneAngles(rig, false, out frame.PlaneR[0], out frame.PlaneR[1], out frame.PlaneR[2], out frame.PlaneR[3]);
            ElbowPlaneAngles(rig, true, out frame.PlaneL[0], out frame.PlaneL[1], out frame.PlaneL[2], out frame.PlaneL[3]);
            return frame;
        }

        /// <summary>The §9 angular-speed caps (deg/s) by joint: bowling and throwing arms 1800, other limbs 1200, hips/spine/chest 600, neck/head 720.</summary>
        private static double AngularCap(ProductionCharacterJoint joint)
        {
            switch (joint)
            {
                case ProductionCharacterJoint.UpperArmLeft:
                case ProductionCharacterJoint.UpperArmRight:
                case ProductionCharacterJoint.ForearmLeft:
                case ProductionCharacterJoint.ForearmRight:
                case ProductionCharacterJoint.HandLeft:
                case ProductionCharacterJoint.HandRight:
                    return 1800.0;
                case ProductionCharacterJoint.Hips:
                case ProductionCharacterJoint.Spine:
                case ProductionCharacterJoint.Chest:
                    return 600.0;
                case ProductionCharacterJoint.Neck:
                case ProductionCharacterJoint.Head:
                    return 720.0;
                default:
                    return 1200.0;
            }
        }

        private sealed class FrameDifference
        {
            public double DriverDeg, VisibleDeg, PositionMm;
            public string DriverAt = "", VisibleAt = "", PositionAt = "";

            public void Add(StrikerFrame a, StrikerFrame b, string label)
            {
                for (var index = 0; index < a.Driver.Length; index++)
                {
                    var angle = Quaternion.Angle(a.Driver[index], b.Driver[index]);
                    if (angle > DriverDeg)
                    {
                        DriverDeg = angle;
                        DriverAt = (ProductionCharacterJoint)index + " at t=" + F(a.T) + " " + label;
                    }
                }
                for (var index = 0; index < PopJoints.Length; index++)
                {
                    var angle = Quaternion.Angle(a.Visible[index], b.Visible[index]);
                    if (angle > VisibleDeg)
                    {
                        VisibleDeg = angle;
                        VisibleAt = PopJoints[index] + " at t=" + F(a.T) + " " + label;
                    }
                }
                Action<string, Vector3, Vector3> position = (name, pa, pb) =>
                {
                    var mm = Vector3.Distance(pa, pb) * 1000.0;
                    if (mm > PositionMm)
                    {
                        PositionMm = mm;
                        PositionAt = name + " at t=" + F(a.T) + " " + label;
                    }
                };
                position("root", a.Root, b.Root);
                position("hips", a.Hips, b.Hips);
                position("footL", a.FootL, b.FootL);
                position("footR", a.FootR, b.FootR);
                position("palmL", a.PalmL, b.PalmL);
                position("palmR", a.PalmR, b.PalmR);
                position("batCap", a.BatCap, b.BatCap);
                position("batToe", a.BatToe, b.BatToe);
            }

            public void Add(FrameDifference other)
            {
                if (other.DriverDeg > DriverDeg) { DriverDeg = other.DriverDeg; DriverAt = other.DriverAt; }
                if (other.VisibleDeg > VisibleDeg) { VisibleDeg = other.VisibleDeg; VisibleAt = other.VisibleAt; }
                if (other.PositionMm > PositionMm) { PositionMm = other.PositionMm; PositionAt = other.PositionAt; }
            }

            public string Json() =>
                "{\"driverMaxDeg\":" + F(DriverDeg) + ",\"driverAt\":\"" + DriverAt + "\",\"visibleMaxDeg\":" + F(VisibleDeg) +
                ",\"visibleAt\":\"" + VisibleAt + "\",\"positionMaxMm\":" + F(PositionMm) + ",\"positionAt\":\"" + PositionAt + "\"}";
        }

        /// <summary>
        /// Before the input the striker must not know the stroke (U-D 1). The same ball is played four ways, the striker's pose
        /// recorded every 1/60 s from the release to the player's swing start: live with nothing accepted, and as replays (the
        /// result accepted at the start) with the recorded stroke and with two others (a different footwork and swing direction).
        /// Compared at every frame: every driver joint's local rotation, the visible joints' world rotations, and the root, hips,
        /// feet, palms and bat. The gate is 0.5 degrees and 1 mm. Writes pre-input.json.
        /// </summary>
        public static void PreInputProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var hands = (Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_HANDS") ?? "right,left").Split(',');
            var caseIds = (Environment.GetEnvironmentVariable("VANDE_HUMANS_CASES") ?? "grounded-attack,thin-edge")
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var fixture = LoadFixture();
            var rows = new List<string>();
            var worst = new FrameDifference();
            var worstReplay = new FrameDifference();
            var worstSensitivity = new FrameDifference();
            foreach (var id in caseIds)
            foreach (var hand in hands)
            {
                var item = fixture.cases.Single(c => c.id == id);
                var swingStart = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result)).SwingStartT ?? 0.0;
                var variants = new List<KeyValuePair<string, Action<PracticeResultPresentation>>>
                {
                    new KeyValuePair<string, Action<PracticeResultPresentation>>("replay-recorded", r => { }),
                    new KeyValuePair<string, Action<PracticeResultPresentation>>("replay-other-footwork", r =>
                    {
                        r.Footwork = r.Footwork == "back" ? "forward" : "back";
                        r.ShotIntent = r.ShotIntent == "defend" ? "attack" : "defend";
                    }),
                    new KeyValuePair<string, Action<PracticeResultPresentation>>("replay-other-direction", r =>
                    {
                        r.Footwork = "down_track";
                        r.SwingDirectionDeg = r.SwingDirectionDeg > 0.0 ? -35.0 : 35.0;
                    })
                };
                var runs = new Dictionary<string, List<StrikerFrame>>();
                // Live: nothing accepted. Aligned to the 1/60 s grid of the replays (their timeline starts at 0).
                {
                    GameObject root;
                    var world = OpenTouchdownWorld(item, hand, 0.0, null, out root);
                    try
                    {
                        var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                        var frames = new List<StrikerFrame>();
                        var lead = -world.TimelineForEvidence;
                        var align = lead - Math.Floor(lead / Step) * Step;
                        if (align > 1e-9) world.Tick(align);
                        while (world.TimelineForEvidence < swingStart - 1e-9)
                        {
                            world.Tick(Step);
                            if (world.TimelineForEvidence >= -1e-9 && world.TimelineForEvidence < swingStart - 1e-9)
                                frames.Add(CaptureStriker(striker, world.TimelineForEvidence));
                        }
                        runs["live"] = frames;
                    }
                    finally
                    {
                        UnityEngine.Object.DestroyImmediate(root);
                    }
                }
                foreach (var variant in variants)
                {
                    GameObject root;
                    var world = OpenTouchdownWorld(item, hand, 0.0, null, out root);
                    try
                    {
                        var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                        var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
                        result.IsReplay = true;
                        variant.Value(result);
                        world.AcceptResult(result);
                        var frames = new List<StrikerFrame>();
                        // Past the swing start too (0.25 s): the probe must be able to see a difference once the stroke begins.
                        while (world.TimelineForEvidence < swingStart + 0.25 - 1e-9)
                        {
                            world.Tick(Step);
                            frames.Add(CaptureStriker(striker, world.TimelineForEvidence));
                        }
                        runs[variant.Key] = frames;
                    }
                    finally
                    {
                        UnityEngine.Object.DestroyImmediate(root);
                    }
                }
                // [from, to) in seconds after the release.
                Func<string, string, double, double, FrameDifference> compare = (left, right, from, to) =>
                {
                    var difference = new FrameDifference();
                    var a = runs[left];
                    var b = runs[right];
                    for (var index = 0; index < Math.Min(a.Count, b.Count); index++)
                    {
                        if (Math.Abs(a[index].T - b[index].T) > Step * 0.51) continue;
                        if (a[index].T < from - 1e-9 || a[index].T >= to - 1e-9) continue;
                        difference.Add(a[index], b[index], id + "/" + hand + " " + left + " vs " + right);
                    }
                    return difference;
                };
                var strokes = compare("replay-recorded", "replay-other-footwork", 0.0, swingStart);
                var directions = compare("replay-recorded", "replay-other-direction", 0.0, swingStart);
                var liveVsReplay = compare("live", "replay-recorded", 0.0, swingStart);
                // Sensitivity: the same comparison after the input (the strokes do differ there), and how much the pose moves from
                // frame to frame before it (so a zero is not a probe that sees nothing).
                var afterInput = compare("replay-recorded", "replay-other-footwork", swingStart, swingStart + 0.25);
                var steps = new FrameDifference();
                {
                    var a = runs["replay-recorded"];
                    for (var index = 1; index < a.Count; index++)
                        if (a[index].T < swingStart - 1e-9) steps.Add(a[index - 1], a[index], id + "/" + hand + " frame step");
                }
                worstReplay.Add(strokes);
                worstSensitivity.Add(afterInput);
                worstReplay.Add(directions);
                worst.Add(liveVsReplay);
                rows.Add("{\"case\":\"" + id + "\",\"hand\":\"" + hand + "\",\"swingStartT\":" + F(swingStart) + ",\"frames\":" + runs["replay-recorded"].Count +
                         ",\"liveFrames\":" + runs["live"].Count +
                         ",\"recordedVsOtherFootworkAndIntent\":" + strokes.Json() +
                         ",\"recordedVsOtherDirectionAndDownTrack\":" + directions.Json() +
                         ",\"liveVsRecordedReplay\":" + liveVsReplay.Json() +
                         ",\"sensitivity\":{\"afterInputRecordedVsOtherFootwork\":" + afterInput.Json() +
                         ",\"largestFrameToFrameStepBeforeInput\":" + steps.Json() + "}}");
            }
            File.WriteAllText(Path.Combine(output, "pre-input.json"),
                "{\"rule\":\"the striker before the player's swing start is the same for any stroke on the same ball: every driver joint and visible joint <= 0.5 deg, root/hips/feet/palms/bat <= 1 mm\"," +
                "\"differentStrokes\":" + worstReplay.Json() + ",\"liveVsReplay\":" + worst.Json() +
                ",\"sensitivityAfterInput\":" + worstSensitivity.Json() + ",\"rows\":[" + string.Join(",", rows) + "]}");
        }

        /// <summary>
        /// One live stroke for the hand-over probe: press at the recorded swing start, commit `commitDelay` later (the provisional
        /// swing) and, with `accept`, the result `acceptFrames` frames after that; the striker recorded every 1/60 s for 90 frames
        /// (or 30 after the accept). `commitIndex` and `acceptIndex` are the frame indices (-1 when it did not happen).
        /// </summary>
        /// <summary>UNITY-5: the frames the torso governor held a bone back, and the reach lean left at the end, in the last PlayLiveStroke.</summary>
        private static int LastLiveGovernorEngagements;
        private static float LastLiveReachLeanMetres;

        private static List<StrikerFrame> PlayLiveStroke(GoldenCase item, string hand, double commitDelay, int acceptFrames,
            bool accept, out int commitIndex, out int acceptIndex)
        {
            GameObject root;
            var world = OpenTouchdownWorld(item, hand, 0.0, null, out root);
            commitIndex = -1;
            acceptIndex = -1;
            try
            {
                var striker = world.PresentedHumansForEvidence().First(pair => pair.Key == "striker").Value;
                // Builder A/B seam: VANDE_GOVERNOR=0 lets the torso turn as fast as the pose asks.
                if (Environment.GetEnvironmentVariable("VANDE_GOVERNOR") == "0") striker.TorsoRateGovernorEnabled = false;
                var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
                var swingStart = result.SwingStartT ?? 0.15;
                world.Tick(Math.Max(0.0, swingStart - world.TimelineForEvidence));
                var frames = new List<StrikerFrame>();
                world.BeginLocalPreparation();
                var committed = false;
                var accepted = false;
                var commitAt = swingStart + commitDelay;
                var countdown = acceptFrames;
                for (var k = 0; k < 90; k++)
                {
                    if (!committed && world.TimelineForEvidence >= commitAt - 1e-9)
                    {
                        world.ApplyProvisionalSwing(new PracticeSwingPresentation
                        {
                            Kind = "attack",
                            // The live host sends the normalized swing start (a tap's press); UNITY-5's probes sent the commitment's
                            // time. VANDE_COMMIT_STARTT=press is the host's.
                            StartT = Environment.GetEnvironmentVariable("VANDE_COMMIT_STARTT") == "press" ? swingStart : world.Timeline,
                            DirectionDeg = result.SwingDirectionDeg,
                            Power = 0.7,
                            Elevation = 0.1,
                            Footwork = string.IsNullOrEmpty(result.Footwork) ? "auto" : result.Footwork
                        });
                        committed = true;
                        commitIndex = frames.Count;
                    }
                    if (accept && committed && !accepted)
                    {
                        if (countdown == 0)
                        {
                            world.AcceptResult(result);
                            accepted = true;
                            acceptIndex = frames.Count;
                        }
                        else countdown--;
                    }
                    world.Tick(Step);
                    frames.Add(CaptureStriker(striker, world.TimelineForEvidence));
                    if (accepted && frames.Count > acceptIndex + 30) break;
                }
                LastLiveGovernorEngagements = striker.TorsoGovernorEngagementsForEvidence;
                LastLiveReachLeanMetres = world.StrikerReachLeanForEvidence;
                return frames;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>
        /// The live pre-result to result hand-over (U-D 2): the player presses at the recorded swing start, lifts (the commitment,
        /// ApplyProvisionalSwing) 50 or 120 ms later and the result is accepted 0, 1 or 3 frames after that. Every 1/60 s the striker is
        /// recorded; at the accept frame the step of the root, hips, feet, palms and bat (cm) and of every visible joint (degrees and
        /// degrees per second against its section 9 cap) is reported with the largest of the other frames of the stroke. Writes
        /// hand-over.json.
        /// </summary>
        /// <summary>The frames after the commitment the result is accepted at: 0, 1 and 3 (UNITY-4's classes); VANDE_HANDOVER_ACCEPTS adds more (UNITY-5: 6 and 10, the latency Unity's decode alone makes).</summary>
        private static int[] AcceptClasses()
        {
            var text = Environment.GetEnvironmentVariable("VANDE_HANDOVER_ACCEPTS");
            return string.IsNullOrEmpty(text)
                ? new[] { 0, 1, 3 }
                : text.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
        }

        public static void HandOverProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var hands = (Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_HANDS") ?? "right,left").Split(',');
            var caseIds = (Environment.GetEnvironmentVariable("VANDE_HUMANS_CASES") ?? "grounded-attack,thin-edge")
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var fixture = LoadFixture();
            var rows = new List<string>();
            double worstRootCm = 0.0, worstRatio = 0.0, worstBatCm = 0.0, worstHipsCm = 0.0, worstFootCm = 0.0, worstPalmCm = 0.0;
            double worstJumpRootCm = 0.0, worstJumpHipsCm = 0.0, worstJumpBoneDeg = 0.0;
            var totalGovernorEngagements = 0;
            string worstRatioAt = "", worstRootAt = "";
            foreach (var id in caseIds)
            foreach (var hand in hands)
            foreach (var commitDelay in new[] { 0.05, 0.12 })
            foreach (var acceptFrames in AcceptClasses())
            {
                var item = fixture.cases.Single(c => c.id == id);
                {
                    int commitIndex, acceptIndex, controlCommit, controlAccept;
                    var frames = PlayLiveStroke(item, hand, commitDelay, acceptFrames, true, out commitIndex, out acceptIndex);
                    var governorEngagements = LastLiveGovernorEngagements;
                    var reachLean = LastLiveReachLeanMetres;
                    totalGovernorEngagements += governorEngagements;
                    // The same stroke with no result accepted: the pose the body would have had.
                    var control = PlayLiveStroke(item, hand, commitDelay, acceptFrames, false, out controlCommit, out controlAccept);
                    var pressIndex = 0;
                    if (acceptIndex < 1 || acceptIndex >= control.Count) continue;
                    // The jump the accept makes: this frame's pose against the same frame of the unaccepted stroke.
                    var there = control[acceptIndex];
                    Func<Vector3, Vector3, double> cmBetween = (u, w) => Vector3.Distance(u, w) * 100.0;
                    var jumpRootCm = cmBetween(frames[acceptIndex].Root, there.Root);
                    var jumpHipsCm = cmBetween(frames[acceptIndex].Hips, there.Hips);
                    var jumpFootCm = Math.Max(cmBetween(frames[acceptIndex].FootL, there.FootL), cmBetween(frames[acceptIndex].FootR, there.FootR));
                    var jumpPalmCm = Math.Max(cmBetween(frames[acceptIndex].PalmL, there.PalmL), cmBetween(frames[acceptIndex].PalmR, there.PalmR));
                    var jumpBatCm = Math.Max(cmBetween(frames[acceptIndex].BatCap, there.BatCap), cmBetween(frames[acceptIndex].BatToe, there.BatToe));
                    double jumpBoneDeg = 0.0;
                    var jumpBone = "";
                    for (var index = 0; index < PopJoints.Length; index++)
                    {
                        var deg = Quaternion.Angle(frames[acceptIndex].Visible[index], there.Visible[index]);
                        if (deg > jumpBoneDeg)
                        {
                            jumpBoneDeg = deg;
                            jumpBone = PopJoints[index].ToString();
                        }
                    }
                    worstJumpRootCm = Math.Max(worstJumpRootCm, jumpRootCm);
                    worstJumpHipsCm = Math.Max(worstJumpHipsCm, jumpHipsCm);
                    worstJumpBoneDeg = Math.Max(worstJumpBoneDeg, jumpBoneDeg);
                    var before = frames[acceptIndex - 1];
                    var at = frames[acceptIndex];
                    Func<Vector3, Vector3, double> cm = (a, b) => Vector3.Distance(a, b) * 100.0;
                    var rootCm = cm(before.Root, at.Root);
                    var hipsCm = cm(before.Hips, at.Hips);
                    var footCm = Math.Max(cm(before.FootL, at.FootL), cm(before.FootR, at.FootR));
                    var palmCm = Math.Max(cm(before.PalmL, at.PalmL), cm(before.PalmR, at.PalmR));
                    var batCm = Math.Max(cm(before.BatCap, at.BatCap), cm(before.BatToe, at.BatToe));
                    var dt = at.T - before.T;
                    string worstJoint = "";
                    double worstDeg = 0.0, worstJointRatio = 0.0, worstRate = 0.0;
                    for (var index = 0; index < PopJoints.Length; index++)
                    {
                        var deg = Quaternion.Angle(before.Visible[index], at.Visible[index]);
                        var rate = deg / dt;
                        var ratio = rate / AngularCap(PopJoints[index]);
                        if (ratio > worstJointRatio)
                        {
                            worstJointRatio = ratio;
                            worstJoint = PopJoints[index].ToString();
                            worstDeg = deg;
                            worstRate = rate;
                        }
                    }
                    double gloveOffCm = 0.0;
                    for (var index = acceptIndex; index < frames.Count; index++)
                        gloveOffCm = Math.Max(gloveOffCm, Math.Max(frames[index].GloveOffLeft, frames[index].GloveOffRight) * 100.0);
                    // UNITY-5: and from the commitment, so the committed swing's own frames before the result count too.
                    double gloveOffFromCommitCm = gloveOffCm;
                    for (var index = Math.Max(0, commitIndex); index < acceptIndex && index < frames.Count; index++)
                        gloveOffFromCommitCm = Math.Max(gloveOffFromCommitCm, Math.Max(frames[index].GloveOffLeft, frames[index].GloveOffRight) * 100.0);
                    // The same quantities over the other frames of the stroke, for scale.
                    double otherRootCm = 0.0, otherRatio = 0.0, otherBatCm = 0.0;
                    for (var index = pressIndex + 1; index < frames.Count; index++)
                    {
                        if (index == acceptIndex) continue;
                        var a = frames[index - 1];
                        var b = frames[index];
                        otherRootCm = Math.Max(otherRootCm, cm(a.Root, b.Root));
                        otherBatCm = Math.Max(otherBatCm, Math.Max(cm(a.BatCap, b.BatCap), cm(a.BatToe, b.BatToe)));
                        for (var j = 0; j < PopJoints.Length; j++)
                            otherRatio = Math.Max(otherRatio, Quaternion.Angle(a.Visible[j], b.Visible[j]) / (b.T - a.T) / AngularCap(PopJoints[j]));
                    }
                    // The frames around the accept: each frame's step (cm and degrees per frame) so the hand-over can be told from the stroke.
                    var series = new List<string>();
                    for (var index = Math.Max(1, commitIndex - 2); index <= Math.Min(frames.Count - 1, acceptIndex + 6); index++)
                    {
                        var a = frames[index - 1];
                        var b = frames[index];
                        Func<ProductionCharacterJoint, string> deg = joint =>
                            F(Quaternion.Angle(a.Visible[Array.IndexOf(PopJoints, joint)], b.Visible[Array.IndexOf(PopJoints, joint)]));
                        series.Add("{\"k\":" + (index - acceptIndex) + ",\"t\":" + F(b.T) + ",\"rootCm\":" + F(cm(a.Root, b.Root)) +
                                   ",\"hipsCm\":" + F(cm(a.Hips, b.Hips)) + ",\"footLCm\":" + F(cm(a.FootL, b.FootL)) + ",\"footRCm\":" + F(cm(a.FootR, b.FootR)) +
                                   ",\"batCm\":" + F(Math.Max(cm(a.BatCap, b.BatCap), cm(a.BatToe, b.BatToe))) +
                                   ",\"palmLCm\":" + F(cm(a.PalmL, b.PalmL)) + ",\"palmRCm\":" + F(cm(a.PalmR, b.PalmR)) + ",\"gloveOffLMm\":" + F(b.GloveOffLeft * 1000.0) + ",\"gloveOffRMm\":" + F(b.GloveOffRight * 1000.0) +
                                   ",\"hips\":" + deg(ProductionCharacterJoint.Hips) + ",\"chest\":" + deg(ProductionCharacterJoint.Chest) +
                                   ",\"head\":" + deg(ProductionCharacterJoint.Head) + ",\"upperArmL\":" + deg(ProductionCharacterJoint.UpperArmLeft) +
                                   ",\"forearmL\":" + deg(ProductionCharacterJoint.ForearmLeft) + ",\"upperArmR\":" + deg(ProductionCharacterJoint.UpperArmRight) +
                                   ",\"forearmR\":" + deg(ProductionCharacterJoint.ForearmRight) + ",\"thighL\":" + deg(ProductionCharacterJoint.ThighLeft) +
                                   ",\"thighR\":" + deg(ProductionCharacterJoint.ThighRight) + ",\"shinL\":" + deg(ProductionCharacterJoint.ShinLeft) +
                                   ",\"shinR\":" + deg(ProductionCharacterJoint.ShinRight) + ",\"path\":" + b.GripPath +
                                   ",\"planeR\":[" + string.Join(",", b.PlaneR.Select(value => F(value))) + "],\"planeL\":[" + string.Join(",", b.PlaneL.Select(value => F(value))) + "]}");
                    }
                    var label = id + "/" + hand + " commit +" + F(commitDelay) + " s accept +" + acceptFrames + " frames";
                    if (Environment.GetEnvironmentVariable("VANDE_HANDOVER_DUMP") == "1")
                    {
                        // Builder diagnostic: every recorded frame of the accepted stroke and of the unaccepted control (scratch only).
                        var dump = new List<string>
                        {
                            "run,k,t,rootX,rootY,rootZ,hipsX,hipsY,hipsZ,capX,capY,capZ,toeX,toeY,toeZ,palmLX,palmLY,palmLZ,palmRX,palmRY,palmRZ,footLX,footLY,footLZ,footRX,footRY,footRZ,shLX,shLY,shLZ,shRX,shRY,shRZ,gtLX,gtLY,gtLZ,gtRX,gtRY,gtRZ,gloveOffLMm,gloveOffRMm" +
                            string.Concat(PopJoints.Select(joint => "," + joint + "_qx," + joint + "_qy," + joint + "_qz," + joint + "_qw"))
                        };
                        Action<string, List<StrikerFrame>, int> add = (run, list, pivot) =>
                        {
                            for (var i = 0; i < list.Count; i++)
                            {
                                var f = list[i];
                                dump.Add(string.Join(",", new[]
                                {
                                    run, (i - pivot).ToString(CultureInfo.InvariantCulture), F(f.T), F(f.Root.x), F(f.Root.y), F(f.Root.z),
                                    F(f.Hips.x), F(f.Hips.y), F(f.Hips.z), F(f.BatCap.x), F(f.BatCap.y), F(f.BatCap.z),
                                    F(f.BatToe.x), F(f.BatToe.y), F(f.BatToe.z), F(f.PalmL.x), F(f.PalmL.y), F(f.PalmL.z),
                                    F(f.PalmR.x), F(f.PalmR.y), F(f.PalmR.z), F(f.FootL.x), F(f.FootL.y), F(f.FootL.z),
                                    F(f.FootR.x), F(f.FootR.y), F(f.FootR.z),
                                    F(f.ShoulderL.x), F(f.ShoulderL.y), F(f.ShoulderL.z), F(f.ShoulderR.x), F(f.ShoulderR.y), F(f.ShoulderR.z),
                                    F(f.GripTargetL.x), F(f.GripTargetL.y), F(f.GripTargetL.z), F(f.GripTargetR.x), F(f.GripTargetR.y), F(f.GripTargetR.z),
                                    F(f.GloveOffLeft * 1000.0), F(f.GloveOffRight * 1000.0)
                                }) + string.Concat(f.Visible.Select(q => "," + F(q.x) + "," + F(q.y) + "," + F(q.z) + "," + F(q.w))));
                            }
                        };
                        add("accepted", frames, acceptIndex);
                        add("control", control, acceptIndex);
                        File.WriteAllLines(Path.Combine(output, "frames-" + label.Replace('/', '_').Replace(' ', '_').Replace('+', 'p') + ".csv"), dump);
                    }
                    if (rootCm > worstRootCm) { worstRootCm = rootCm; worstRootAt = label; }
                    if (worstJointRatio > worstRatio) { worstRatio = worstJointRatio; worstRatioAt = label + " " + worstJoint; }
                    worstBatCm = Math.Max(worstBatCm, batCm);
                    worstHipsCm = Math.Max(worstHipsCm, hipsCm);
                    worstFootCm = Math.Max(worstFootCm, footCm);
                    worstPalmCm = Math.Max(worstPalmCm, palmCm);
                    rows.Add("{\"scenario\":\"" + label + "\",\"governorEngagements\":" + governorEngagements + ",\"reachLeanEndCm\":" + F(reachLean * 100.0) + ",\"acceptT\":" + F(at.T) + ",\"commitFrame\":" + commitIndex + ",\"acceptFrame\":" + acceptIndex +
                             ",\"rootCm\":" + F(rootCm) + ",\"hipsCm\":" + F(hipsCm) + ",\"footCm\":" + F(footCm) + ",\"palmCm\":" + F(palmCm) +
                             ",\"batCm\":" + F(batCm) + ",\"gloveOffTargetMaxCm\":" + F(gloveOffCm) + ",\"gloveOffFromCommitMaxCm\":" + F(gloveOffFromCommitCm) + ",\"worstBone\":\"" + worstJoint + "\",\"worstBoneDeg\":" + F(worstDeg) +
                             ",\"worstBoneDegPerS\":" + F(worstRate) + ",\"worstBoneVsCap\":" + F(worstJointRatio) +
                             ",\"otherFramesMax\":{\"rootCm\":" + F(otherRootCm) + ",\"batCm\":" + F(otherBatCm) + ",\"boneVsCap\":" + F(otherRatio) + "}" +
                             ",\"series\":[" + string.Join(",", series) + "]," +
                             "\"jumpFromTheUnacceptedStroke\":{\"rootCm\":" + F(jumpRootCm) + ",\"hipsCm\":" + F(jumpHipsCm) + ",\"footCm\":" + F(jumpFootCm) +
                             ",\"palmCm\":" + F(jumpPalmCm) + ",\"batCm\":" + F(jumpBatCm) + ",\"boneDeg\":" + F(jumpBoneDeg) + ",\"bone\":\"" + jumpBone + "\"}}");
                }
            }
            File.WriteAllText(Path.Combine(output, "hand-over.json"),
                "{\"rule\":\"no bone over its section 9 angular-speed cap (arms 1800, other limbs 1200, hips/spine/chest 600, neck/head 720 deg/s) at the accept frame; the root jump is reported\",\"governorEngagementsTotal\":" + totalGovernorEngagements + "," +
                "\"worstJumpFromTheUnacceptedStroke\":{\"rootCm\":" + F(worstJumpRootCm) + ",\"hipsCm\":" + F(worstJumpHipsCm) + ",\"boneDeg\":" + F(worstJumpBoneDeg) + "}," +
                "\"worst\":{\"rootCm\":" + F(worstRootCm) + ",\"rootAt\":\"" + worstRootAt + "\",\"hipsCm\":" + F(worstHipsCm) + ",\"footCm\":" + F(worstFootCm) +
                ",\"palmCm\":" + F(worstPalmCm) + ",\"batCm\":" + F(worstBatCm) + ",\"boneVsCap\":" + F(worstRatio) + ",\"boneAt\":\"" + worstRatioAt + "\"}," +
                "\"rows\":[" + string.Join(",", rows) + "]}");
        }

        /// <summary>
        /// The waiting bat (what the batter draws with no input) every 4 ms from the approach to the follow-through, with
        /// how its blade, its face and the frame the touch-down blend builds from them move between frames: a blend that
        /// starts from this bat inherits any quick turn of the frame (a face rolling about the blade) even where the cap
        /// and the toe hardly move. Writes waiting-bat.csv to VANDE_EVIDENCE_OUT.
        /// </summary>
        public static void WaitingBatProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var hand = Environment.GetEnvironmentVariable("VANDE_TOUCHDOWN_HANDS") ?? "right";
            var item = LoadFixture().cases[0];
            GameObject root;
            var world = OpenTouchdownWorld(item, hand, 0.0, null, out root);
            try
            {
                var lines = new List<string>
                {
                    "t,gripX,gripY,gripZ,toeX,toeY,toeZ,faceX,faceY,faceZ,faceBladeDeg,bladeStepDeg,frameStepDeg,rollStepDeg,gripStepM,toeStepM"
                };
                var previous = default(ProductionTouchDownBat.BatPose);
                var have = false;
                for (var t = -0.6; t <= 1.0 + 1e-9; t += 0.004)
                {
                    Vector3 grip, toe, face;
                    if (!world.WaitingBatForEvidence(t, out grip, out toe, out face)) continue;
                    var pose = new ProductionTouchDownBat.BatPose { Grip = grip, Toe = toe, Face = face };
                    var blade = toe - grip;
                    var bladeStep = 0f;
                    var frameStep = 0f;
                    var rollStep = 0f;
                    var gripStep = 0f;
                    var toeStep = 0f;
                    if (have)
                    {
                        var before = previous.Toe - previous.Grip;
                        bladeStep = Vector3.Angle(before, blade);
                        var q0 = ProductionTouchDownBat.Orientation(previous);
                        var q1 = ProductionTouchDownBat.Orientation(pose);
                        frameStep = Quaternion.Angle(q0, q1);
                        // The turn about the blade that is not the blade's own swing: the frame's step with the blade's step taken out.
                        var swing = Quaternion.FromToRotation(before, blade);
                        var residual = Quaternion.Inverse(swing * q0) * q1;
                        rollStep = Quaternion.Angle(Quaternion.identity, residual);
                        gripStep = Vector3.Distance(previous.Grip, grip);
                        toeStep = Vector3.Distance(previous.Toe, toe);
                    }
                    previous = pose;
                    have = true;
                    var inPlane = face - blade.normalized * Vector3.Dot(face, blade.normalized);
                    lines.Add(string.Join(",", new[]
                    {
                        F(t), F(grip.x), F(grip.y), F(grip.z), F(toe.x), F(toe.y), F(toe.z), F(face.x), F(face.y), F(face.z),
                        F(Vector3.Angle(face, blade)), F(bladeStep), F(frameStep), F(rollStep), F(gripStep), F(toeStep)
                    }));
                    if (inPlane.sqrMagnitude < 1e-12f) lines[lines.Count - 1] += ",degenerate-face";
                }
                File.WriteAllLines(Path.Combine(output, "waiting-bat.csv"), lines);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>
        /// UNITY-4 H1 groundwork: the visible hero's arm frames at the canonical zero pose (every driver rotation the identity).
        /// Prints, per arm, the driver's and the hero's shoulder, elbow and wrist in the rig root's frame and the elbow's bend
        /// (the angle between the upper arm and the forearm) for both, the retarget's rest corrections (angle from the identity),
        /// and the zero pose read back through the two conversions to canonical VC17 rotations (CanonicalFrames). Writes
        /// hero-arm-rest.txt.
        /// </summary>
        public static void HeroArmRestProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var lines = new List<string>();
            var host = new GameObject("VANDE hero arm rest probe");
            try
            {
                foreach (var role in new[] { ProductionCharacterRole.Batter, ProductionCharacterRole.Fielder })
                foreach (var handedness in new[] { ProductionCharacterHandedness.Right, ProductionCharacterHandedness.Left })
                {
                    var spec = ProductionCharacterSpec.For(role, ProductionCharacterDetail.Medium);
                    spec.Handedness = handedness;
                    var rig = ProductionCharacterFactory.Create(host.transform, spec);
                    rig.Root.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                    rig.ApplyPose(new ProductionCharacterPose());
                    lines.Add("== " + role + " " + handedness + " hero=" + rig.VisibleHeroSkeletonActive);
                    var skeleton = rig.VisibleHeroSkeleton;
                    foreach (var side in new[] { "Left", "Right" })
                    {
                        var upper = (ProductionCharacterJoint)Enum.Parse(typeof(ProductionCharacterJoint), "UpperArm" + side);
                        var fore = (ProductionCharacterJoint)Enum.Parse(typeof(ProductionCharacterJoint), "Forearm" + side);
                        var hand = (ProductionCharacterJoint)Enum.Parse(typeof(ProductionCharacterJoint), "Hand" + side);
                        Func<Transform, Vector3> local = t => rig.Root.InverseTransformPoint(t.position);
                        var ds = local(rig.Joint(upper)); var de = local(rig.Joint(fore)); var dw = local(rig.Joint(hand));
                        lines.Add(side + " driver  shoulder " + V(ds) + " elbow " + V(de) + " wrist " + V(dw) + " bend " +
                                  F(Vector3.Angle(de - ds, dw - de)) + " deg, lengths " + F((de - ds).magnitude) + " / " + F((dw - de).magnitude));
                        if (skeleton == null) continue;
                        var hs = rig.Root.InverseTransformPoint(rig.VisibleJointWorldPosition(upper));
                        var he = rig.Root.InverseTransformPoint(rig.VisibleJointWorldPosition(fore));
                        var hw = rig.Root.InverseTransformPoint(rig.VisibleJointWorldPosition(hand));
                        lines.Add(side + " hero    shoulder " + V(hs) + " elbow " + V(he) + " wrist " + V(hw) + " bend " +
                                  F(Vector3.Angle(he - hs, hw - he)) + " deg, lengths " + F((he - hs).magnitude) + " / " + F((hw - he).magnitude));
                        foreach (var joint in new[] { upper, fore, hand })
                        {
                            Quaternion rest, correction;
                            skeleton.RestFramesOf(joint, out rest, out correction);
                            var bone = skeleton.BoneOf(joint);
                            lines.Add("   " + joint + " rest " + F(Quaternion.Angle(Quaternion.identity, rest)) + " deg, correction " +
                                      F(Quaternion.Angle(Quaternion.identity, correction)) + " deg, local " +
                                      F(Quaternion.Angle(Quaternion.identity, bone.localRotation)) + " deg, parent " + bone.parent.name);
                        }
                        // UNITY-5: the straightness gates at the canonical zero pose. The forearm against the upper arm is the
                        // elbow's bend above (0 is straight). The hand's long axes against the forearm's direction (elbow to wrist):
                        // the palm (wrist to the middle finger's knuckle, finger3-1), the chord to the middle finger's last joint
                        // (finger3-3, the axis Solve and Read measure the wrist against), and the wrist-to-elbow-down view of the
                        // hand bone's own -Y. Left hand bones 27..45, right hand 46..64 (V3_BONE_NAMES order).
                        var handBase = side == "Left" ? 27 : 46;
                        var wristPoint = rig.VisibleJointWorldPosition(hand);
                        var forearmDirection = (wristPoint - rig.VisibleJointWorldPosition(fore)).normalized;
                        Func<int, float> toward = index =>
                            Vector3.Angle(forearmDirection, (skeleton.Bones[index].position - wristPoint).normalized);
                        var handBone = skeleton.BoneOf(hand);
                        lines.Add("   " + side + " hand axes vs forearm direction: palm(finger3-1) " + F(toward(handBase + 10)) +
                                  " deg, chord(finger3-3) " + F(toward(handBase + 12)) + " deg, metacarpal2 " + F(toward(handBase + 1)) +
                                  " deg, Read-axis " + F(Vector3.Angle(forearmDirection, handBone.rotation * skeleton.HandRestDirection(side == "Left"))) +
                                  " deg, hand -Y " + F(Vector3.Angle(forearmDirection, handBone.rotation * Vector3.down)) + " deg; elbow bend " +
                                  F(Vector3.Angle(he - hs, hw - he)) + " deg");
                    }
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
            File.WriteAllLines(Path.Combine(output, "hero-arm-rest.txt"), lines);
            Debug.Log("VANDE hero arm rest probe written to " + output);
        }

        /// <summary>
        /// UNITY-4: what one visible-hero arm solve and one torso governor pass cost (Editor, Mono, this Mac, microseconds: an
        /// indication, not an Android figure), and the hand's rest axis the wrist's bend is measured against. Writes
        /// arm-solve-cost.txt.
        /// </summary>
        public static void ArmSolveCostProbe()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Directory.CreateDirectory(output);
            var lines = new List<string>();
            var host = new GameObject("VANDE arm solve cost probe");
            try
            {
                var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = ProductionCharacterHandedness.Right;
                var rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.Root.SetPositionAndRotation(new Vector3(0f, 0f, 9.25f), Quaternion.Euler(0f, 180f, 0f));
                rig.SampleAndApply(ProductionCharacterMotion.Stand, 0f);
                var skeleton = rig.VisibleHeroSkeleton;
                lines.Add("left hand rest axis (wrist to middle fingertip, wrist frame): " + V(skeleton.HandRestDirection(true)) +
                          "  right: " + V(skeleton.HandRestDirection(false)));
                var shoulder = skeleton.BoneOf(ProductionCharacterJoint.UpperArmLeft).position;
                // A stance-like grip (free of every range) and a hand that works the twist window, the wrist nudge and the glove roll.
                var cases = new[]
                {
                    new KeyValuePair<string, Vector3>("free", rig.Root.TransformDirection(new Vector3(0.1f, -0.45f, 0.9f)).normalized * 0.40f),
                    new KeyValuePair<string, Vector3>("constrained", rig.Root.TransformDirection(new Vector3(0f, 0.5f, 1f)).normalized * 0.20f)
                };
                foreach (var item in cases)
                {
                    var target = shoulder + item.Value;
                    var pole = rig.Root.TransformDirection(new Vector3(-0.3f, -0.7f, -0.2f));
                    var hand = rig.Root.rotation * Quaternion.Euler(20f, 10f, 0f);
                    const int count = 20000;
                    for (var warm = 0; warm < 200; warm++) skeleton.SolveBatterArm(true, target, hand, pole);
                    skeleton.ArmMemoryEnabled = true;
                    var watch = System.Diagnostics.Stopwatch.StartNew();
                    for (var index = 0; index < count; index++)
                    {
                        skeleton.ArmClockSeconds = 100.0 + index * Step;
                        skeleton.SolveBatterArm(true, target, hand, pole);
                    }
                    watch.Stop();
                    lines.Add(item.Key + ": " + F(watch.Elapsed.TotalMilliseconds * 1000.0 / count) + " us per solve (memory on, " + count + " solves)");
                }
                rig.PresentationClockSeconds = 500.0;
                rig.GovernHeroTorsoRates();
                var timer = System.Diagnostics.Stopwatch.StartNew();
                for (var index = 1; index <= 20000; index++)
                {
                    rig.PresentationClockSeconds = 500.0 + index * Step;
                    rig.GovernHeroTorsoRates();
                }
                timer.Stop();
                lines.Add("torso governor: " + F(timer.Elapsed.TotalMilliseconds * 1000.0 / 20000) + " us per frame");
                lines.Add("uptime: " + System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/usr/bin/uptime") { RedirectStandardOutput = true, UseShellExecute = false }).StandardOutput.ReadToEnd().Trim());
                rig.Dispose();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
            File.WriteAllLines(Path.Combine(output, "arm-solve-cost.txt"), lines);
        }

        /// <summary>One editor launch for a builder round: the release probe, the humans run, MirrorCheck and views.</summary>
        public static void RoundEvidence()
        {
            var output = Environment.GetEnvironmentVariable("VANDE_EVIDENCE_OUT");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("Set VANDE_EVIDENCE_OUT.");
            Action<string, Action> step = (sub, body) =>
            {
                Environment.SetEnvironmentVariable("VANDE_EVIDENCE_OUT", Path.Combine(output, sub));
                try
                {
                    body();
                }
                catch (Exception error)
                {
                    Debug.LogError("VANDE_ROUND_STEP_FAILED " + sub + ": " + error);
                }
                finally
                {
                    Environment.SetEnvironmentVariable("VANDE_EVIDENCE_OUT", output);
                }
            };
            step("agreement", () =>
            {
                Environment.SetEnvironmentVariable("VANDE_PRESENTATION_EVIDENCE_OUTPUT",
                    Path.Combine(output, "agreement", "canonical-presentation-agreement.json"));
                CanonicalPresentationAgreementEvidence.Export();
            });
            step("release", ReleaseProbe);
            step("evidence", Run);
            // The left-hander too (hands on the bat and feet, the lead's r4 terms: both hands, the whole stroke).
            Environment.SetEnvironmentVariable("VANDE_HUMANS_HAND", "left");
            step("evidence-left", Run);
            Environment.SetEnvironmentVariable("VANDE_HUMANS_HAND", null);
            step("mirror", MirrorAndViews);
            step("touchdown", TouchdownProbe);
        }

        private sealed class HumanTrack
        {
            private readonly List<double> times = new List<double>();
            private readonly List<double> traceTimes = new List<double>();
            private readonly List<string> states = new List<string>();
            private readonly List<Vector3> roots = new List<Vector3>();
            private readonly List<Vector3> leftFoot = new List<Vector3>();
            private readonly List<Vector3> rightFoot = new List<Vector3>();
            private readonly List<Quaternion[]> rotations = new List<Quaternion[]>();
            private readonly List<float> handGap = new List<float>();
            private bool hero;

            public void Record(ProductionCharacterRig rig, double clock, double traceT, string state, bool twoHanded)
            {
                hero = rig.VisibleHeroSkeletonActive;
                times.Add(clock);
                traceTimes.Add(traceT);
                states.Add(state);
                roots.Add(rig.VisibleJointWorldPosition(ProductionCharacterJoint.Hips));
                leftFoot.Add(rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootLeft));
                rightFoot.Add(rig.VisibleJointWorldPosition(ProductionCharacterJoint.FootRight));
                rotations.Add(PopJoints.Select(rig.VisibleJointWorldRotation).ToArray());
                if (twoHanded && rig.Bat != null && hero)
                {
                    handGap.Add(Mathf.Max(
                        Vector3.Distance(rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true)),
                        Vector3.Distance(rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false))));
                }
            }

            public string Summary()
            {
                var slide = Math.Max(Slide(leftFoot, out var leftWorst), Slide(rightFoot, out var rightWorst));
                var worstSlideAt = leftWorst.Item1 >= rightWorst.Item1 ? leftWorst.Item2 : rightWorst.Item2;
                // Pose pops: largest single-frame joint rotation (degrees) and the angular speed it implies.
                var maxStep = 0f;
                var maxStepJoint = "";
                var maxStepT = 0.0;
                var popFrames = 0;
                for (var i = 1; i < rotations.Count; i++)
                {
                    var frameMax = 0f;
                    for (var j = 0; j < PopJoints.Length; j++)
                    {
                        var step = Quaternion.Angle(rotations[i - 1][j], rotations[i][j]);
                        if (step > frameMax) frameMax = step;
                        if (step > maxStep)
                        {
                            maxStep = step;
                            maxStepJoint = PopJoints[j].ToString();
                            maxStepT = traceTimes[i];
                        }
                    }
                    if (frameMax > 20f) popFrames++;
                }
                // Root (hips) horizontal speed steps between consecutive frames.
                var maxSpeedStep = 0.0;
                var maxSpeedStepT = 0.0;
                var maxSpeed = 0.0;
                for (var i = 2; i < roots.Count; i++)
                {
                    var v0 = Horizontal(roots[i - 1] - roots[i - 2]) / (times[i - 1] - times[i - 2]);
                    var v1 = Horizontal(roots[i] - roots[i - 1]) / (times[i] - times[i - 1]);
                    maxSpeed = Math.Max(maxSpeed, v1);
                    var step = Math.Abs(v1 - v0);
                    if (step > maxSpeedStep)
                    {
                        maxSpeedStep = step;
                        maxSpeedStepT = traceTimes[i];
                    }
                }
                // Frozen spans: longest interval with no joint moving more than 0.05 degrees per frame.
                var frozen = 0.0;
                var frozenStart = 0;
                for (var i = 1; i < rotations.Count; i++)
                {
                    var moved = false;
                    for (var j = 0; j < PopJoints.Length && !moved; j++)
                        moved = Quaternion.Angle(rotations[i - 1][j], rotations[i][j]) > 0.05f ||
                                (roots[i] - roots[i - 1]).magnitude > 0.0005f;
                    if (moved) frozenStart = i;
                    else frozen = Math.Max(frozen, times[i] - times[frozenStart]);
                }
                var builder = new StringBuilder();
                builder.Append("{\"frames\":").Append(times.Count).Append(",\"heroSkeleton\":").Append(hero ? "true" : "false")
                    .Append(",\"maxPlantedFootSlideCm\":").Append(F(slide * 100.0))
                    .Append(",\"maxSlideAtT\":").Append(F(worstSlideAt))
                    .Append(",\"maxJointStepDeg\":").Append(F(maxStep))
                    .Append(",\"maxJointStepDegPerS\":").Append(F(maxStep / Step))
                    .Append(",\"maxJointStepJoint\":\"").Append(maxStepJoint).Append("\",\"maxJointStepT\":").Append(F(maxStepT))
                    .Append(",\"framesOver20DegStep\":").Append(popFrames)
                    .Append(",\"maxRootSpeedMps\":").Append(F(maxSpeed))
                    .Append(",\"maxRootSpeedStepMpsPerFrame\":").Append(F(maxSpeedStep))
                    .Append(",\"maxRootSpeedStepT\":").Append(F(maxSpeedStepT))
                    .Append(",\"longestFrozenSpanS\":").Append(F(frozen));
                if (handGap.Count > 0)
                    builder.Append(",\"maxHandToHandleMm\":").Append(F(handGap.Max() * 1000.0))
                        .Append(",\"p95HandToHandleMm\":").Append(F(Percentile(handGap, 0.95) * 1000.0));
                builder.Append('}');
                return builder.ToString();
            }

            private double Slide(List<Vector3> foot, out Tuple<double, double> worst)
            {
                var floor = foot.Min(p => p.y);
                var best = 0.0;
                worst = Tuple.Create(0.0, 0.0);
                var anchor = -1;
                for (var i = 1; i < foot.Count; i++)
                {
                    var speed = Horizontal(foot[i] - foot[i - 1]) / (times[i] - times[i - 1]);
                    var planted = foot[i].y <= floor + PlantedHeightBand && speed <= PlantedSpeed &&
                                  Math.Abs(times[i] - times[i - 1] - Step) < 1e-6;
                    if (!planted)
                    {
                        anchor = -1;
                        continue;
                    }
                    if (anchor < 0) anchor = i;
                    var drift = Horizontal(foot[i] - foot[anchor]);
                    if (drift > best)
                    {
                        best = drift;
                        worst = Tuple.Create(drift, traceTimes[i]);
                    }
                }
                return best;
            }
        }

        private sealed class VisibilityTrack
        {
            private int frames;
            private int inFrustum;
            private int occludesStriker;
            private float maxAreaFraction;

            public void Record(Camera camera, ProductionCharacterRig rig, ProductionCharacterRig striker)
            {
                frames++;
                var renderers = rig.Root.GetComponentsInChildren<Renderer>(false)
                    .Where(r => r.enabled && r.gameObject.activeInHierarchy).ToArray();
                if (renderers.Length == 0 || (camera.cullingMask & (1 << renderers[0].gameObject.layer)) == 0) return;
                var planes = GeometryUtility.CalculateFrustumPlanes(camera);
                if (!renderers.Any(r => GeometryUtility.TestPlanesAABB(planes, r.bounds))) return;
                inFrustum++;
                var rect = ScreenRect(camera, renderers);
                maxAreaFraction = Mathf.Max(maxAreaFraction,
                    rect.width * rect.height / (camera.pixelWidth * (float)camera.pixelHeight));
                var strikerRect = ScreenRect(camera, striker.Root.GetComponentsInChildren<Renderer>(false));
                if (rect.Overlaps(strikerRect) && Depth(camera, rig.Root.position) < Depth(camera, striker.Root.position))
                    occludesStriker++;
            }

            public string Summary()
            {
                return "{\"frames\":" + frames + ",\"framesInRearCamera\":" + inFrustum +
                       ",\"framesOverlappingStrikerInFront\":" + occludesStriker +
                       ",\"maxScreenAreaFraction\":" + F(maxAreaFraction) + "}";
            }
        }

        private static Rect ScreenRect(Camera camera, Renderer[] renderers)
        {
            var min = new Vector2(float.MaxValue, float.MaxValue);
            var max = new Vector2(float.MinValue, float.MinValue);
            foreach (var renderer in renderers)
            {
                var b = renderer.bounds;
                for (var corner = 0; corner < 8; corner++)
                {
                    var p = new Vector3(
                        (corner & 1) == 0 ? b.min.x : b.max.x,
                        (corner & 2) == 0 ? b.min.y : b.max.y,
                        (corner & 4) == 0 ? b.min.z : b.max.z);
                    var s = camera.WorldToScreenPoint(p);
                    if (s.z <= 0f) continue;
                    min = Vector2.Min(min, new Vector2(s.x, s.y));
                    max = Vector2.Max(max, new Vector2(s.x, s.y));
                }
            }
            if (min.x > max.x) return new Rect();
            min = Vector2.Max(min, Vector2.zero);
            max = Vector2.Min(max, new Vector2(camera.pixelWidth, camera.pixelHeight));
            return max.x > min.x && max.y > min.y ? Rect.MinMaxRect(min.x, min.y, max.x, max.y) : new Rect();
        }

        private static float Depth(Camera camera, Vector3 world) =>
            Vector3.Dot(world - camera.transform.position, camera.transform.forward);

        private static double Horizontal(Vector3 value) => Math.Sqrt(value.x * value.x + value.z * value.z);

        private static float Percentile(List<float> values, double p)
        {
            var sorted = values.OrderBy(v => v).ToList();
            return sorted[Math.Min(sorted.Count - 1, (int)Math.Floor(p * (sorted.Count - 1)))];
        }

        private static void Render(Camera camera, int width, int height, string path)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            var previousAspect = camera.aspect;
            try
            {
                camera.targetTexture = target;
                camera.aspect = width / (float)height;
                camera.Render();
                RenderTexture.active = target;
                var pixels = new Texture2D(width, height, TextureFormat.RGB24, false);
                pixels.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
                pixels.Apply();
                File.WriteAllBytes(path, pixels.EncodeToJPG(88));
                UnityEngine.Object.DestroyImmediate(pixels);
            }
            finally
            {
                camera.targetTexture = previousTarget;
                camera.aspect = previousAspect;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        private static GoldenFixture LoadFixture()
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            return JsonUtility.FromJson<GoldenFixture>(File.ReadAllText(path));
        }

        private static string F(double value) => double.IsNaN(value) || double.IsInfinity(value)
            ? "null"
            : value.ToString("0.######", CultureInfo.InvariantCulture);

        [Serializable] private sealed class FlightVec { public double x; public double y; public double z; }
        [Serializable] private sealed class FlightSampleJson { public double t; public FlightVec p; public FlightVec v; }
        [Serializable]
        private sealed class FlightEntry
        {
            public string id;
            public string hand;
            public string family;
            public string arm;
            public double idealContactT;
            public FlightSampleJson[] samples;
        }
        [Serializable] private sealed class FlightCorpus { public FlightEntry[] flights; }
        [Serializable] private sealed class GoldenFixture { public GoldenCase[] cases; }
        [Serializable] private sealed class GoldenCase { public string id; public GoldenWire wire; }
        [Serializable] private sealed class GoldenWire { public GoldenPackets packets; }
        [Serializable] private sealed class GoldenPackets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket result;
        }

        private sealed class NullSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
