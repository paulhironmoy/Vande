using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Environment;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// REEL-U (builder evidence only: no player, no device, nothing here is a human result): the Unity motion reel's frame capture.
    /// Plays golden deliveries through the production world as the host does (the flow of PopPlay in VandeHumansEvidence.Pops.cs: 180 frames of
    /// the scene between balls, BeginDelivery, the press at the recorded swing start, the commitment +50 ms, the result `late` frames after the
    /// commitment) at a fixed 60 Hz step (or a divisor of it for slow motion), and after every step renders each requested view to a JPEG.
    /// A shot is one delivery (or one stretch of the scene between balls) in a fresh world, with `tree=after` (every seam at its default: the final
    /// tree) or `tree=before` (the session's Unity changes switched off through their seams, the Director off: an approximation of the checkpoint's
    /// Unity behaviour, not the checkpoint). Views are the world's own rear-shoulder camera (`game`) or harness cameras that exist only here.
    ///
    /// Env: VANDE_REEL_PLAN (a text file, one shot per line: `key=value` tokens, `#` comments; see ReelParse), VANDE_EVIDENCE_OUT (the output folder),
    /// VANDE_REEL_CORPUS (a corpus json of the golden wire schema for `case=` ids that are not golden), VANDE_REEL_FORCE=1 (redo finished shots),
    /// VANDE_REEL_QUALITY (the Unity quality level index, default 2 = Medium, the project's Android default).
    /// Writes per shot: {view}/f00000.jpg ..., meta.tsv (per captured frame: the world's time, state and the ball's drawn position), info.txt and, with
    /// `scan=1`, pops.tsv (the pop scanner's definitions applied to this very run, Pops.cs PopDetect), then done.txt.
    /// </summary>
    public static partial class VandeHumansEvidence
    {
        private const int ReelDefaultQualityLevel = 2;
        private const float ReelHarnessShadowDistance = 10f;

        private enum ReelViewKind { Game, Track, Head, Fixed, Rear }

        private sealed class ReelViewSpec
        {
            public string Name;
            public ReelViewKind Kind;
            public string Role;
            public float[] Args;
        }

        private sealed class ReelShot
        {
            public string Id, Tree = "after", Case, Hand = "right", Mode = "delivery";
            public int Late, Slow = 1, Every = 1, Width = 1830, Height = 824, Jpeg = 92;
            public double Commit = 0.05, FromMs = double.NegativeInfinity, ToMs = double.PositiveInfinity, IdleSkipSeconds, IdleSeconds = 12.0;
            public bool Scan;
            /// <summary>Human keys (PresentedHumansForEvidence) the harness cameras do not draw, e.g. `non-striker` so he does not block the bowler.</summary>
            public readonly List<string> Hide = new List<string>();
            public readonly List<ReelViewSpec> Views = new List<ReelViewSpec>();
            public bool Before => Tree == "before";
        }

        /// <summary>One view while a shot runs: its camera, render target and (for tracking views) the smoothed point it follows.</summary>
        private sealed class ReelCam
        {
            public ReelViewSpec Spec;
            public Camera Camera;
            public bool OwnsCamera;
            public RenderTexture Target;
            public Vector3 Smooth;
            public bool Started;
            public Quaternion Fixed;
            public string Folder;
        }

        private static ReelShot ReelParse(string line)
        {
            var shot = new ReelShot();
            foreach (var token in line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = token.IndexOf('=');
                if (eq <= 0) throw new FormatException("Reel plan token without '=': " + token);
                var key = token.Substring(0, eq);
                var value = token.Substring(eq + 1);
                switch (key)
                {
                    case "id": shot.Id = value; break;
                    case "tree": shot.Tree = value; break;
                    case "case": shot.Case = value; break;
                    case "hand": shot.Hand = value; break;
                    case "mode": shot.Mode = value; break;
                    case "late": shot.Late = int.Parse(value, CultureInfo.InvariantCulture); break;
                    case "slow": shot.Slow = int.Parse(value, CultureInfo.InvariantCulture); break;
                    case "every": shot.Every = int.Parse(value, CultureInfo.InvariantCulture); break;
                    case "commit": shot.Commit = double.Parse(value, CultureInfo.InvariantCulture); break;
                    case "from": shot.FromMs = double.Parse(value, CultureInfo.InvariantCulture); break;
                    case "to": shot.ToMs = double.Parse(value, CultureInfo.InvariantCulture); break;
                    case "skip": shot.IdleSkipSeconds = double.Parse(value, CultureInfo.InvariantCulture); break;
                    case "len": shot.IdleSeconds = double.Parse(value, CultureInfo.InvariantCulture); break;
                    case "scan": shot.Scan = value == "1"; break;
                    case "hide": shot.Hide.AddRange(value.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)); break;
                    case "jpeg": shot.Jpeg = int.Parse(value, CultureInfo.InvariantCulture); break;
                    case "size":
                        var wh = value.Split('x');
                        shot.Width = int.Parse(wh[0], CultureInfo.InvariantCulture);
                        shot.Height = int.Parse(wh[1], CultureInfo.InvariantCulture);
                        break;
                    case "views":
                        foreach (var item in value.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)) shot.Views.Add(ReelParseView(item));
                        break;
                    default: throw new FormatException("Unknown reel plan key: " + key);
                }
            }

            if (string.IsNullOrEmpty(shot.Id) || string.IsNullOrEmpty(shot.Case)) throw new FormatException("A reel shot needs id= and case=: " + line);
            if (shot.Tree != "before" && shot.Tree != "after") throw new FormatException("tree must be before or after: " + line);
            return shot;
        }

        /// <summary>`name:game`, `name:track(role,ox,oy,oz,focusHeight,fovDeg,tauSeconds)`, `name:head(role,ox,oy,oz,fovDeg,tauSeconds)`, `name:fixed(px,py,pz,lx,ly,lz,fovDeg)`, `name:rear(distance,lateral)`.</summary>
        private static ReelViewSpec ReelParseView(string text)
        {
            var colon = text.IndexOf(':');
            var name = text.Substring(0, colon);
            var rest = text.Substring(colon + 1);
            var open = rest.IndexOf('(');
            var kindText = open < 0 ? rest : rest.Substring(0, open);
            var args = open < 0 ? new string[0] : rest.Substring(open + 1, rest.Length - open - 2).Split(',');
            var spec = new ReelViewSpec { Name = name };
            switch (kindText)
            {
                case "game": spec.Kind = ReelViewKind.Game; break;
                case "track": spec.Kind = ReelViewKind.Track; break;
                case "head": spec.Kind = ReelViewKind.Head; break;
                case "fixed": spec.Kind = ReelViewKind.Fixed; break;
                case "rear": spec.Kind = ReelViewKind.Rear; break;
                default: throw new FormatException("Unknown reel view kind: " + text);
            }

            var numbers = new List<float>();
            for (var i = 0; i < args.Length; i++)
            {
                if (i == 0 && (spec.Kind == ReelViewKind.Track || spec.Kind == ReelViewKind.Head)) spec.Role = args[0];
                else numbers.Add(float.Parse(args[i], CultureInfo.InvariantCulture));
            }

            spec.Args = numbers.ToArray();
            return spec;
        }

        private static PopCase ReelFindCase(string id)
        {
            if (id == "leave")
            {
                var miss = LoadFixture().cases.Single(c => c.id == "complete-miss");
                return new PopCase { Id = "leave", Kind = "leave", Item = miss, Leave = true };
            }

            var golden = LoadFixture().cases.FirstOrDefault(c => c.id == id);
            if (golden != null) return new PopCase { Id = id, Kind = "golden", Item = golden };
            var corpusPath = Environment.GetEnvironmentVariable("VANDE_REEL_CORPUS");
            if (!string.IsNullOrEmpty(corpusPath))
            {
                var corpus = JsonUtility.FromJson<GovernedCorpus>(File.ReadAllText(corpusPath));
                var gc = corpus.cases.FirstOrDefault(c => c.id == id);
                if (gc != null) return new PopCase { Id = id, Kind = "corpus-" + (gc.dismissal ?? "none"), Item = new GoldenCase { id = gc.id, wire = gc.wire } };
            }

            throw new InvalidOperationException("Unknown reel case: " + id);
        }

        /// <summary>
        /// The BEFORE half: the session's Unity changes switched off through their seams (UNITY-5 F1/F2, UNITY-7 A/B/C/D, UNITY-8, UNITY-9, U-E2's Director,
        /// which the caller already left off when it built the world). It approximates the checkpoint's Unity behaviour and is not the checkpoint: the earlier
        /// bowler run-up, touch-down and hero-arm work have no seam and stay in both halves; neither does the camera's constants (they are constants).
        /// </summary>
        private static string ReelApplyBefore(DirWorld w)
        {
            var world = w.World;
            world.ProvisionalPackBodyEnabled = false;
            world.PendingBallHidden = false;
            world.PredictedCommittedBatEnabled = false;
            world.KeepElbowMemoryAcrossAccept = false;
            world.LeaveOverlayEnabled = false;
            world.GovernedPackStrokeEnabled = false;
            world.DeadBallRecoveryAfterPackStrokeFrame = false;
            world.HeldBatKnotsEnabled = false;
            world.BowlerHeadingFollowerEnabled = false;
            world.ThrowReachFollowsThrough = false;
            world.ThrowReachStablePole = false;
            world.LateResultSettleEnabled = false;
            world.IdleHandOverMovesBat = false;
            world.DirectorHeadWorldCapEnabled = false;
            var humans = 0;
            var legacyArms = 0;
            foreach (var human in world.PresentedHumansForEvidence())
            {
                humans++;
                human.Value.CapFollowsHeroEnabled = false;
                human.Value.TorsoRateGovernorEnabled = false;
                var skeleton = human.Value.VisibleHeroSkeleton;
                if (skeleton == null) continue;
                skeleton.LegacyArmRetarget = true;
                legacyArms++;
            }

            return "world seams off (14), Director off; " + humans + " humans: cap-follows-hero off and torso governor off on " + humans + ", legacy arm retarget on " + legacyArms;
        }

        /// <summary>SHA-256 of the three golden packets as the world is given them: the physics identity of a shot (both halves of a clip print the same hash).</summary>
        private static string ReelPacketsHash(GoldenCase item)
        {
            using (var sha = SHA256.Create())
            {
                var text = JsonUtility.ToJson(item.wire.packets.scene) + "\n" + JsonUtility.ToJson(item.wire.packets.delivery) + "\n" + JsonUtility.ToJson(item.wire.packets.result);
                return string.Concat(sha.ComputeHash(Encoding.UTF8.GetBytes(text)).Select(b => b.ToString("x2", CultureInfo.InvariantCulture)));
            }
        }

        private static ProductionCharacterRig ReelRig(DirWorld w, string role) => role == "bowler" ? w.Bowler : w.Striker;

        private static void ReelKeepSkinning(DirWorld w)
        {
            foreach (var rig in new[] { w.Striker, w.Bowler })
                foreach (var skinned in rig.Root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    skinned.updateWhenOffscreen = true;
                    skinned.forceMatrixRecalculationPerRender = true;
                }
        }

        /// <summary>A layer nothing in the world uses, for the humans a shot hides from its harness cameras (their meshes, bones and shadows are unchanged).</summary>
        private static int ReelHiddenLayer()
        {
            for (var layer = 31; layer >= 8; layer--)
                if (string.IsNullOrEmpty(LayerMask.LayerToName(layer)) && layer != ProductionFieldPip.Layer) return layer;
            throw new InvalidOperationException("No free layer for hidden humans.");
        }

        private static List<ReelCam> ReelOpenViews(ReelShot shot, DirWorld w, string shotDir)
        {
            var template = w.World.BatterCameraForEvidence;
            var views = new List<ReelCam>();
            var hiddenLayer = -1;
            if (shot.Hide.Count > 0)
            {
                hiddenLayer = ReelHiddenLayer();
                foreach (var human in w.World.PresentedHumansForEvidence().Where(h => shot.Hide.Contains(h.Key)))
                    foreach (var t in human.Value.Root.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = hiddenLayer;
            }

            foreach (var spec in shot.Views)
            {
                var cam = new ReelCam { Spec = spec, Folder = Path.Combine(shotDir, spec.Name) };
                Directory.CreateDirectory(cam.Folder);
                cam.Target = new RenderTexture(shot.Width, shot.Height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 2 };
                if (spec.Kind == ReelViewKind.Game)
                {
                    cam.Camera = template;
                    cam.Camera.aspect = shot.Width / (float)shot.Height;
                }
                else
                {
                    var go = new GameObject("VANDE reel camera " + spec.Name);
                    go.transform.SetParent(template.transform.parent, true);
                    cam.Camera = go.AddComponent<Camera>();
                    cam.Camera.CopyFrom(template);
                    cam.Camera.enabled = false;
                    cam.Camera.targetTexture = null;
                    cam.Camera.nearClipPlane = 0.1f;
                    cam.Camera.farClipPlane = 400f;
                    cam.Camera.aspect = shot.Width / (float)shot.Height;
                    if (hiddenLayer >= 0) cam.Camera.cullingMask &= ~(1 << hiddenLayer);
                    cam.OwnsCamera = true;
                }

                cam.Camera.targetTexture = cam.Target;
                views.Add(cam);
            }

            return views;
        }

        private static void ReelCloseViews(List<ReelCam> views)
        {
            foreach (var cam in views)
            {
                if (cam.Camera != null) cam.Camera.targetTexture = null;
                if (cam.OwnsCamera && cam.Camera != null) UnityEngine.Object.DestroyImmediate(cam.Camera.gameObject);
                if (cam.Target != null) UnityEngine.Object.DestroyImmediate(cam.Target);
            }
        }

        /// <summary>Places a harness camera for this frame (the world's own camera is left as the world put it).</summary>
        private static void ReelPlace(ReelCam cam, DirWorld w, double dt)
        {
            var spec = cam.Spec;
            var a = spec.Args;
            switch (spec.Kind)
            {
                case ReelViewKind.Game:
                    return;
                case ReelViewKind.Fixed:
                {
                    cam.Camera.fieldOfView = a[6];
                    var position = new Vector3(a[0], a[1], a[2]);
                    cam.Camera.transform.SetPositionAndRotation(position, Quaternion.LookRotation(new Vector3(a[3], a[4], a[5]) - position, Vector3.up));
                    return;
                }
                case ReelViewKind.Rear:
                {
                    var game = w.World.BatterCameraForEvidence;
                    var mirror = game.transform.position.x < 0f ? -1f : 1f;
                    var position = new Vector3(mirror * a[1], ProceduralPracticeWorld.BatterCameraHeightMetres, 9.25f + a[0]);
                    var target = ProceduralPracticeWorld.BatterCameraTarget(0f);
                    cam.Camera.fieldOfView = ProceduralPracticeWorld.VerticalFovForHorizontal(ProceduralPracticeWorld.TargetHorizontalFovDegrees, cam.Camera.aspect);
                    cam.Camera.transform.SetPositionAndRotation(position, Quaternion.LookRotation(target - position, Vector3.up));
                    return;
                }
                default:
                {
                    var rig = ReelRig(w, spec.Role);
                    var head = spec.Kind == ReelViewKind.Head;
                    var point = head ? rig.VisibleJointWorldPosition(ProductionCharacterJoint.Head) : rig.Root.position;
                    var offset = new Vector3(a[0], a[1], a[2]);
                    var focus = head ? 0f : a[3];
                    var fov = head ? a[3] : a[4];
                    var tau = head ? a[4] : a[5];
                    if (!cam.Started)
                    {
                        cam.Smooth = point;
                        cam.Fixed = Quaternion.LookRotation(Vector3.up * focus - offset, Vector3.up);
                        cam.Started = true;
                    }
                    else if (tau > 0f) cam.Smooth += (point - cam.Smooth) * (1f - Mathf.Exp(-(float)dt / tau));
                    else cam.Smooth = point;
                    cam.Camera.fieldOfView = fov;
                    cam.Camera.transform.SetPositionAndRotation(cam.Smooth + offset, cam.Fixed);
                    return;
                }
            }
        }

        private static void ReelRender(ReelCam cam, Texture2D readback, int jpeg, string file)
        {
            var shadow = QualitySettings.shadowDistance;
            if (cam.Spec.Kind != ReelViewKind.Game && cam.Spec.Kind != ReelViewKind.Rear) QualitySettings.shadowDistance = Math.Min(shadow, ReelHarnessShadowDistance);
            var previous = RenderTexture.active;
            try
            {
                cam.Camera.Render();
                RenderTexture.active = cam.Target;
                readback.ReadPixels(new Rect(0, 0, cam.Target.width, cam.Target.height), 0, 0, false);
                File.WriteAllBytes(file, ImageConversion.EncodeToJPG(readback, jpeg));
            }
            finally
            {
                RenderTexture.active = previous;
                QualitySettings.shadowDistance = shadow;
            }
        }

        public static void ReelCapture()
        {
            var output = DirOut();
            var planPath = Environment.GetEnvironmentVariable("VANDE_REEL_PLAN");
            if (string.IsNullOrEmpty(planPath)) throw new InvalidOperationException("VANDE_REEL_PLAN is required.");
            var level = int.Parse(PopEnv("VANDE_REEL_QUALITY", ReelDefaultQualityLevel.ToString(CultureInfo.InvariantCulture)), CultureInfo.InvariantCulture);
            QualitySettings.SetQualityLevel(level, true);
            var force = PopEnv("VANDE_REEL_FORCE", "0") == "1";
            var started = DateTime.UtcNow;
            var shots = File.ReadAllLines(planPath).Where(l => l.Trim().Length > 0 && !l.TrimStart().StartsWith("#", StringComparison.Ordinal)).Select(ReelParse).ToList();
            var done = 0;
            foreach (var shot in shots)
            {
                var dir = Path.Combine(output, shot.Id);
                if (!force && File.Exists(Path.Combine(dir, "done.txt"))) { UnityEngine.Debug.Log("VANDE reel: skip finished shot " + shot.Id); continue; }
                try
                {
                    if (Directory.Exists(dir)) Directory.Delete(dir, true);
                    Directory.CreateDirectory(dir);
                    var t0 = DateTime.UtcNow;
                    if (shot.Mode == "idle") ReelIdle(shot, dir);
                    else ReelDelivery(shot, dir);
                    File.WriteAllText(Path.Combine(dir, "done.txt"), "done " + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + " in " + F((DateTime.UtcNow - t0).TotalSeconds) + " s; uptime " + DirUptime() + "\n");
                    done++;
                }
                catch (Exception error)
                {
                    UnityEngine.Debug.LogError("VANDE_REEL_FAILED " + shot.Id + ": " + error);
                }
            }

            UnityEngine.Debug.Log("VANDE reel: " + done + " of " + shots.Count + " shots in " + F((DateTime.UtcNow - started).TotalSeconds) + " s (quality level " + level + " " + QualitySettings.names[level] + ")");
        }

        private static void ReelInfo(ReelShot shot, GoldenCase item, DirWorld w, string dir, PopRun run, List<ReelCam> views, int frames, string seams)
        {
            var sb = new StringBuilder();
            sb.Append("id ").Append(shot.Id).Append('\n');
            sb.Append("tree ").Append(shot.Tree).Append(shot.Before ? " (" + seams + ")" : " (all seams default, Director on)").Append('\n');
            sb.Append("build ").Append(PopEnv("VANDE_BUILD_ID", "(not given)")).Append('\n');
            sb.Append("case ").Append(shot.Case).Append(" hand ").Append(shot.Hand).Append(" late ").Append(shot.Late).Append(" commit ").Append(F(shot.Commit)).Append(" slow ").Append(shot.Slow).Append('\n');
            sb.Append("window ").Append(F(shot.FromMs)).Append(" .. ").Append(F(shot.ToMs)).Append(" ms against the release; frames ").Append(frames).Append('\n');
            sb.Append("size ").Append(shot.Width).Append('x').Append(shot.Height).Append(" jpeg ").Append(shot.Jpeg).Append(" msaa 2; quality level ").Append(QualitySettings.GetQualityLevel()).Append(' ').Append(QualitySettings.names[QualitySettings.GetQualityLevel()]).Append('\n');
            sb.Append("packets sha256 ").Append(ReelPacketsHash(item)).Append(" (scene, delivery and result packets of the case, as the world is given them)\n");
            var game = w.World.BatterCameraForEvidence;
            sb.Append("game camera fov ").Append(F(game.fieldOfView)).Append(" aspect ").Append(F(game.aspect)).Append(" position ").Append(V3(game.transform.position)).Append('\n');
            foreach (var cam in views) sb.Append("view ").Append(cam.Spec.Name).Append(' ').Append(cam.Spec.Kind).Append('\n');
            if (run != null)
                sb.Append("frames ").Append(run.State.Count).Append(" begin ").Append(run.BeginFrame).Append(" press ").Append(run.PressFrame).Append(" commit ").Append(run.CommitFrame)
                    .Append(" accept ").Append(run.AcceptFrame).Append(" release ").Append(run.ReleaseFrame).Append(" idleAgain ").Append(run.IdleAgainFrame).Append('\n');
            sb.Append("uptime ").Append(DirUptime()).Append('\n');
            File.WriteAllText(Path.Combine(dir, "info.txt"), sb.ToString());
        }

        /// <summary>
        /// Time against the release in ms: the world's own timeline before the release (it is exactly the time to the release), the frame count after it
        /// (the world's timeline stops at the dead ball), the convention of the pop scanner's tRelMs.
        /// </summary>
        private static double ReelRelMs(PopRun run, int index, double step)
        {
            if (run.ReleaseFrame >= 0) return (index - run.ReleaseFrame) * step * 1000.0;
            return run.Timeline[index] * 1000.0;
        }

        private const string ReelMetaHeader = "seq\tframe\trelMs\ttimelineMs\tstate\tballDrawn\tballX\tballY\tballZ\tcamFollowDeg\tbowlerRootX\tbowlerRootZ\tstrikerRootX\tstrikerRootZ";

        private static void ReelMetaRow(StringBuilder meta, DirWorld w, int seq, int frame, string state, double relMs, double timeline, Quaternion gameStable)
        {
            var ball = w.World.BallForEvidence;
            var drawn = ball != null && ball.gameObject.activeInHierarchy;
            var bp = ball != null ? ball.position : Vector3.zero;
            meta.Append(seq).Append('\t').Append(frame).Append('\t').Append(F(relMs)).Append('\t').Append(F(timeline * 1000.0)).Append('\t').Append(state).Append('\t').Append(drawn ? 1 : 0).Append('\t')
                .Append(F(bp.x)).Append('\t').Append(F(bp.y)).Append('\t').Append(F(bp.z)).Append('\t')
                .Append(F(Quaternion.Angle(gameStable, w.World.BatterCameraForEvidence.transform.rotation))).Append('\t')
                .Append(F(w.Bowler.Root.position.x)).Append('\t').Append(F(w.Bowler.Root.position.z)).Append('\t')
                .Append(F(w.Striker.Root.position.x)).Append('\t').Append(F(w.Striker.Root.position.z)).Append('\n');
        }

        /// <summary>The scene between balls (no delivery): captures `len` seconds after `skip` seconds of scene time.</summary>
        private static void ReelIdle(ReelShot shot, string dir)
        {
            var pc = ReelFindCase(shot.Case);
            var step = DirStep / shot.Slow;
            using (var w = new DirWorld(pc.Item, shot.Hand, !shot.Before, false))
            {
                var seams = shot.Before ? ReelApplyBefore(w) : string.Empty;
                ReelKeepSkinning(w);
                var views = ReelOpenViews(shot, w, dir);
                var readback = new Texture2D(shot.Width, shot.Height, TextureFormat.RGB24, false);
                var meta = new StringBuilder(ReelMetaHeader).Append('\n');
                var gameStable = w.World.BatterCameraForEvidence.transform.rotation;
                try
                {
                    var total = (int)Math.Round((shot.IdleSkipSeconds + shot.IdleSeconds) * 60.0 * shot.Slow);
                    var from = (int)Math.Round(shot.IdleSkipSeconds * 60.0 * shot.Slow);
                    var seq = 0;
                    for (var k = 0; k < total; k++)
                    {
                        w.World.Tick(step);
                        foreach (var cam in views) ReelPlace(cam, w, step);
                        if (k < from || (k - from) % shot.Every != 0) continue;
                        foreach (var cam in views)
                            ReelRender(cam, readback, shot.Jpeg, Path.Combine(cam.Folder, "f" + seq.ToString("D5", CultureInfo.InvariantCulture) + ".jpg"));

                        ReelMetaRow(meta, w, seq, k, w.World.StateForEvidence, k * step * 1000.0, k * step, gameStable);
                        seq++;
                    }

                    ReelInfo(shot, pc.Item, w, dir, null, views, seq, seams);
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(readback);
                    ReelCloseViews(views);
                    File.WriteAllText(Path.Combine(dir, "meta.tsv"), meta.ToString());
                }
            }
        }

        /// <summary>One delivery through the host's flow, a frame captured per world step inside the shot's window.</summary>
        private static void ReelDelivery(ReelShot shot, string dir)
        {
            var pc = ReelFindCase(shot.Case);
            var step = DirStep / shot.Slow;
            var run = new PopRun { Key = PopKey(pc.Id, shot.Hand, !shot.Before, shot.Late), Case = pc.Id, Hand = shot.Hand, Director = !shot.Before, Late = shot.Late, Kind = pc.Kind };
            using (var w = new DirWorld(pc.Item, shot.Hand, !shot.Before, false))
            {
                if (pc.Leave) PopMakeLeave(w.Result);
                var seams = shot.Before ? ReelApplyBefore(w) : string.Empty;
                ReelKeepSkinning(w);
                var views = ReelOpenViews(shot, w, dir);
                var readback = new Texture2D(shot.Width, shot.Height, TextureFormat.RGB24, false);
                var meta = new StringBuilder(ReelMetaHeader).Append('\n');
                var gameStable = w.World.BatterCameraForEvidence.transform.rotation;
                var seq = 0;
                try
                {
                    var flightEnd = w.Delivery.Flight != null && w.Delivery.Flight.Length > 0 ? w.Delivery.Flight[w.Delivery.Flight.Length - 1].t : 0.0;
                    var swingStart = pc.Leave ? 0.15 : (w.Result.SwingStartT ?? 0.15);
                    run.SwingStart = swingStart;
                    var bat = w.Result.Trace != null ? w.Result.Trace.bat : null;
                    run.StrokeEndT = (bat != null && bat.Length > 0 ? bat[bat.Length - 1].t : swingStart + 0.8) + ProceduralPracticeWorld.FollowThroughHoldSeconds;
                    var scan = shot.Scan;
                    Action tick = () =>
                    {
                        w.World.Tick(step);
                        if (scan)
                        {
                            run.Pose[0].Add(DirPose(w.Bowler));
                            run.Pose[1].Add(DirPose(w.Striker));
                        }

                        run.State.Add(w.World.StateForEvidence);
                        run.Timeline.Add(w.World.TimelineForEvidence);
                        if (scan)
                        {
                            float glove = 0f;
                            if (w.Striker.VisibleHeroSkeletonActive && w.Striker.Bat != null && !w.Striker.BatterOneHandCarry)
                                glove = Math.Max(Vector3.Distance(w.Striker.HeroHandWorldPosition(true), w.Striker.HeroBatterGripTargetWorld(true)),
                                    Vector3.Distance(w.Striker.HeroHandWorldPosition(false), w.Striker.HeroBatterGripTargetWorld(false)));
                            run.Glove.Add(glove);
                            run.WristL.Add(PopWristSwing(w.Striker, true));
                            run.WristR.Add(PopWristSwing(w.Striker, false));
                        }

                        var index = run.State.Count - 1;
                        var relMs = ReelRelMs(run, index, step);
                        if (run.BeginFrame >= 0) foreach (var cam in views) ReelPlace(cam, w, step);
                        if (run.BeginFrame >= 0 && relMs >= shot.FromMs - 1e-6 && relMs <= shot.ToMs + 1e-6 && (index - run.BeginFrame) % shot.Every == 0)
                        {
                            foreach (var cam in views)
                                ReelRender(cam, readback, shot.Jpeg, Path.Combine(cam.Folder, "f" + seq.ToString("D5", CultureInfo.InvariantCulture) + ".jpg"));

                            ReelMetaRow(meta, w, seq, index, run.State[index], relMs, w.World.TimelineForEvidence, gameStable);
                            seq++;
                        }

                        if (run.ReleaseFrame < 0 && run.BeginFrame >= 0 && w.World.TimelineForEvidence >= -1e-9) run.ReleaseFrame = index;
                        if (run.AcceptFrame >= 0 && run.IdleAgainFrame < 0 && run.State[index] == "Idle") run.IdleAgainFrame = index;
                    };
                    for (var k = 0; k < PopIdleFrames; k++) tick();
                    w.World.BeginDelivery(w.Delivery);
                    run.BeginFrame = run.State.Count;
                    while (w.World.TimelineForEvidence < swingStart - 1e-9) tick();
                    if (!pc.Leave)
                    {
                        w.World.BeginLocalPreparation();
                        run.PressFrame = run.State.Count;
                    }

                    var committed = false;
                    var accepted = false;
                    var countdown = shot.Late * shot.Slow;
                    var commitAt = swingStart + shot.Commit;
                    for (var guard = 0; guard < 1500 * shot.Slow; guard++)
                    {
                        if (!pc.Leave && !committed && w.World.TimelineForEvidence >= commitAt - 1e-9)
                        {
                            w.World.ApplyProvisionalSwing(new PracticeSwingPresentation
                            {
                                Kind = "attack",
                                StartT = swingStart,
                                DirectionDeg = w.Result.SwingDirectionDeg,
                                Power = 0.7,
                                Elevation = 0.1,
                                Footwork = string.IsNullOrEmpty(w.Result.Footwork) ? "auto" : w.Result.Footwork
                            });
                            committed = true;
                            run.CommitFrame = run.State.Count;
                        }

                        var ready = pc.Leave ? w.World.TimelineForEvidence >= flightEnd - 1e-9 : committed;
                        if (!accepted && ready)
                        {
                            if (countdown <= 0)
                            {
                                w.World.AcceptResult(w.Result);
                                accepted = true;
                                run.AcceptFrame = run.State.Count;
                            }
                            else countdown--;
                        }

                        tick();
                        if (scan)
                        {
                            // the scanner's own end of a run, and never before the shot's window is captured
                            if (accepted && run.ReleaseFrame >= 0 && run.State.Count > run.ReleaseFrame + (int)(PopWindowTo * 60.0) + 12 &&
                                (run.IdleAgainFrame >= 0 && run.State.Count > run.IdleAgainFrame + 30 || run.State.Count > run.ReleaseFrame + 900) &&
                                ReelRelMs(run, run.State.Count - 1, step) > shot.ToMs + 1e-6) break;
                        }
                        else if (accepted && ReelRelMs(run, run.State.Count - 1, step) > shot.ToMs + 1e-6) break;
                    }

                    ReelInfo(shot, pc.Item, w, dir, run, views, seq, seams);
                    if (scan)
                    {
                        var hits = new List<PopHit>();
                        PopDetect(run, hits);
                        var pops = new StringBuilder(PopHeader).Append('\n');
                        foreach (var h in hits) pops.Append(PopRow(h)).Append('\n');
                        File.WriteAllText(Path.Combine(dir, "pops.tsv"), pops.ToString());
                    }
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(readback);
                    ReelCloseViews(views);
                    File.WriteAllText(Path.Combine(dir, "meta.tsv"), meta.ToString());
                }
            }
        }
    }
}
