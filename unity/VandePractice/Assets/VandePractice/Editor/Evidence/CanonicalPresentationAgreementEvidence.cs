using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Editor.Evidence
{
    /// <summary>
    /// Deterministic, non-human diagnostic for the frozen grounded-attack/ref-3 fixture.
    /// It decodes the exact TypeScript packets and samples the production Unity world; it
    /// contains no delivery physics, contact, scoring or outcome selection.
    /// </summary>
    public static class CanonicalPresentationAgreementEvidence
    {
        private const string FixtureRelativePath = "tests/fixtures/unity-practice/practice-v3.json";
        private const string FixtureCaseId = "grounded-attack";
        private const string ReferenceBallId = "ref-3";
        private const string PendingFixtureIdentity = "PENDING_PRACTICE_V3_REGENERATION";
        // Identity pins re-pinned by UNITY-2 to the phase-5f corpus (FROZEN-5f, 2026-11-04T06:30Z): payload 4f1e2bb5
        // is the TS generator's own payloadSha256; trace, result/replay and digest are this harness's reading of that
        // corpus's grounded-attack packets (flight and record are unchanged since 5e).
        private const string FixturePayloadSha =
            "4f1e2bb513d459abcf994f764bfcb042e4b2796deeef9844b95c4c0ec14c084a";
        private const string TraceSha =
            "ae015a4d8914465ec8be2d5c2782176c67cd94c2cc52a0154414d1c6c6f0c68e";
        private const string FlightSha =
            "d48ae6bafc5c950e09f674fc4fc5d45d40de283bbf3cf17aa9747886dcaabab4";
        private const string RecordSha =
            "62b03afbf6b3cf4630c26b06a98a42d67105c30f67b401524d80f210320b30bf";
        private const string ResolutionSha =
            "5a5c4ad65fb907a9a7d4ce0c220a30f355d714bf0b3846b00e98acb8b34a3a63";
        private const string ReplayDigest =
            "5661e13c8183776d3cdef98ea8ececba40df02c1a5e40348ccaa880f1d063c89";
        private const double ReleaseHandLimitMetres = 0.05;
        private const double BatPositionLimitMetres = 0.03;
        private const double BatAngleLimitDegrees = 5.0;
        private const double ExactTimeToleranceSeconds = 0.000000001;
        private const double FloatPresentationToleranceMetres = 0.0001;
        private const float PipPresentationTolerancePixels = 0.001f;
        private const double ReleasePreparationEpsilonSeconds = 0.000001;
        private const float EvidenceViewportWidth = 1280f;
        private const float EvidenceViewportHeight = 720f;
        private const float EvidenceViewportDpi = 160f;

        public static void Export()
        {
            var repositoryRoot = RepositoryRoot();
            var output = OutputPath();
            var report = Generate(
                repositoryRoot,
                ReadBuildId(repositoryRoot),
                DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture),
                ReadProcessOutput("/usr/bin/uptime", string.Empty, repositoryRoot));
            var directory = Path.GetDirectoryName(output);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(output, report, new UTF8Encoding(false));
            UnityEngine.Debug.Log("VANDE_CANONICAL_PRESENTATION_EVIDENCE=" + output);
        }

        /// <summary>Stable entry point used by the isolated EditMode tests through reflection.</summary>
        public static string GenerateForTests(string evidenceBuildId, string generatedUtc, string uptime)
        {
            return Generate(RepositoryRoot(), evidenceBuildId, generatedUtc, uptime);
        }

        /// <summary>
        /// False until the shared practice-v3 fixture has been regenerated and its independently
        /// verified identities replace the explicit pending markers above.
        /// </summary>
        public static bool FixtureIdentityFrozen => FixturePayloadSha != PendingFixtureIdentity;

        private static string Generate(
            string repositoryRoot,
            string evidenceBuildId,
            string generatedUtc,
            string uptime)
        {
            if (!FixtureIdentityFrozen)
            {
                throw new InvalidOperationException(
                    "Canonical presentation evidence is blocked until the shared practice-v3 " +
                    "fixture and its independently verified identities are frozen.");
            }
            var fixturePath = Path.Combine(repositoryRoot, FixtureRelativePath);
            if (!File.Exists(fixturePath))
                throw new FileNotFoundException("The shared Unity Practice fixture is missing.", fixturePath);
            var fixtureBytes = File.ReadAllBytes(fixturePath);
            var fixtureJson = Encoding.UTF8.GetString(fixtureBytes);
            var fixture = JsonUtility.FromJson<FrozenFixture>(fixtureJson);
            if (fixture == null || fixture.cases == null)
                throw new InvalidDataException("The shared Unity Practice fixture could not be decoded.");
            var frozenCase = FindFrozenCase(fixture);

            var scenePacket = Decode(frozenCase.wire.packets.scene);
            var deliveryPacket = Decode(frozenCase.wire.packets.delivery);
            var resultPacket = Decode(frozenCase.wire.packets.result);
            var replayPacket = Decode(frozenCase.wire.packets.replay);
            var scene = PracticePresentationContractAdapter.Scene(scenePacket.Envelope);
            var delivery = PracticePresentationContractAdapter.Delivery(deliveryPacket.Envelope);
            var result = PracticePresentationContractAdapter.Result(resultPacket.Envelope);
            var replay = PracticePresentationContractAdapter.Result(replayPacket.Envelope);
            var resolution = JsonUtility.FromJson<ResolutionProbe>(resultPacket.Envelope.payloadJson);
            if (resolution == null || resolution.result == null || resolution.result.coaching == null ||
                resolution.result.contact == null || resolution.result.outcome == null || resolution.score == null)
            {
                throw new InvalidDataException("The frozen result packet lacks diagnostic result facts.");
            }

            var report = new EvidenceReport
            {
                schema = "vande-unity-canonical-presentation-agreement-v1",
                classification = "DIAGNOSTIC_NON_HUMAN",
                certification = "NOT_PERFORMED",
                generatedUtc = generatedUtc,
                uptime = string.IsNullOrWhiteSpace(uptime) ? "NOT_AVAILABLE" : uptime.Trim(),
                evidenceBuildId = evidenceBuildId,
                fixturePath = FixtureRelativePath,
                fixtureFileSha256 = HexSha256(fixtureBytes),
                fixturePayloadSha256 = fixture.payloadSha256,
                unityVersion = Application.unityVersion,
                deviceOrBrowser = "Unity EditMode on " + SystemInfo.operatingSystem,
                settings = "standard; right-handed; real assistance; 1280x720@160dpi diagnostic viewport; " +
                           "audio=false; haptics=false; no presented frame",
                identity = Identity(fixture, frozenCase, scenePacket, deliveryPacket, resultPacket, replayPacket),
                metrics = new List<MetricRecord>(),
                ballSamples = new List<BallSampleRecord>(),
                events = new List<ObservedEventRecord>(),
                field = new List<FieldAgreementRecord>(),
                coach = new CoachRecord
                {
                    reason = resolution.result.coaching.reason,
                    timing = resolution.result.coaching.timing,
                    zone = resolution.result.coaching.zone,
                    fielderRole = resolution.result.coaching.fielderRole,
                    lbw = resolution.result.coaching.lbw ?? "null"
                },
                result = new ResultRecord
                {
                    totalRuns = result.TotalRuns,
                    wickets = result.Wickets,
                    balls = result.Balls,
                    deliveryRuns = result.DeliveryRuns,
                    dismissal = result.Dismissal ?? "null",
                    shotIntent = result.ShotIntent,
                    footwork = result.Footwork,
                    replayDigest = result.ReplayDigest
                }
            };

            AddIdentityMetrics(report, fixture, frozenCase, result, replay);
            MeasurePresentation(report, scene, delivery, result, resolution);
            report.metrics.Add(NotAvailable(
                "flight_screen_space_tolerance",
                "Synchronized presented frames with measured rendered-ball diameter and projection trace",
                "max(2 px, half rendered ball diameter)",
                "EditMode transform sampling has no presented frame; world-space samples are reported separately."));
            report.metrics.Add(NotAvailable(
                "bounce_rendered_frame_delta",
                "Presented-frame timestamp bracketing the visual bounce",
                "within one rendered frame",
                "No live frame was presented by this deterministic EditMode diagnostic."));
            report.metrics.Add(NotAvailable(
                "runtime_score_commit_after_presented_frame",
                "VandePracticeRuntimeController OnPostRender commit observation",
                "score/result applied once after the physical consequence reaches the display",
                "The harness measures world-completion to HUD agreement but does not fabricate OnPostRender."));
            report.metrics.Add(NotAvailable(
                "audio_haptic_schedule_delta_ms",
                "Physical-device output timestamp minus authoritative event timestamp",
                "at most 20 ms where supported",
                "Audio and haptics are disabled; EditMode has no physical output timestamp."));
            report.metrics.Add(NotAvailable(
                "human_player_result",
                "Locked rookie/expert human protocol",
                "real participant observation",
                "AI agents are evaluators, never players."));

            report.metricsArray = report.metrics.ToArray();
            report.ballSamplesArray = report.ballSamples.ToArray();
            report.eventsArray = report.events.ToArray();
            report.fieldArray = report.field.ToArray();
            report.metrics = null;
            report.ballSamples = null;
            report.events = null;
            report.field = null;
            return JsonUtility.ToJson(report, true);
        }

        private static void MeasurePresentation(
            EvidenceReport report,
            PracticeScenePresentation scene,
            PracticeDeliveryPresentation delivery,
            PracticeResultPresentation result,
            ResolutionProbe resolution)
        {
            var root = new GameObject("VANDE Canonical Presentation Evidence");
            root.hideFlags = HideFlags.DontSave;
            try
            {
                var settings = new PracticePresentationSettings
                {
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.Standard,
                    Assistance = "real",
                    Handedness = scene.Handedness,
                    ReducedMotion = false,
                    Captions = true,
                    Audio = false,
                    Haptics = false
                };
                var feedback = new RecordingFeedbackSink();
                var world = root.AddComponent<ProceduralPracticeWorld>();
                var hud = root.AddComponent<ProductionHudView>();
                world.Configure(settings, feedback);
                world.ConfigureScene(scene);
                hud.Configure(settings);
                hud.SetViewportForTesting(
                    (int)EvidenceViewportWidth,
                    (int)EvidenceViewportHeight,
                    new Rect(0f, 0f, EvidenceViewportWidth, EvidenceViewportHeight),
                    EvidenceViewportDpi);
                hud.SetScene(scene);
                hud.BindFieldState(world.LiveFieldState);
                hud.SetDelivery(delivery.OverIndex, delivery.BallIndex);

                var observedEvents = new List<ObservedEventRecord>();
                var resultApplyCount = 0;
                var resultAppliedAfterDead = false;
                var completionDigest = string.Empty;
                world.QuietChanged += value => hud.SetQuiet(value);
                world.ReleaseReached += () => observedEvents.Add(new ObservedEventRecord
                {
                    index = observedEvents.Count,
                    kind = "release",
                    t = world.Timeline,
                    contact = "null",
                    fielderId = "null"
                });
                world.TraceEvent += value => observedEvents.Add(new ObservedEventRecord
                {
                    index = observedEvents.Count,
                    kind = value.kind,
                    t = value.t,
                    contact = value.contact ?? "null",
                    fielderId = value.fielderId ?? "null"
                });
                world.DeliveryCompleted += (deadT, digest) =>
                {
                    resultApplyCount++;
                    resultAppliedAfterDead = world.Timeline + ExactTimeToleranceSeconds >= deadT && !hud.Quiet;
                    completionDigest = digest;
                    hud.SetScore(result.TotalRuns, result.Wickets, result.Balls);
                    hud.SetOutcome(result.DeliveryRuns, result.Dismissal);
                };

                world.BeginDelivery(delivery);
                DriveToRelease(world, hud);
                var worldRoot = RequireDescendant(root.transform, "VANDE-ProductionPracticeWorld");
                var bowler = RequireDescendant(worldRoot, "BowlerProxy");
                var releaseHand = RequireDescendant(bowler, "ReleaseHandAnchor");
                var ball = RequireDescendant(worldRoot, "ProductionCricketBall");
                var bat = RequireDescendant(worldRoot, "BatProxy");
                var authoritativeRelease = ToVector3(delivery.Flight[0].p, scene.Handedness);
                var releaseDistance = Vector3.Distance(releaseHand.position, authoritativeRelease);
                report.release = new ReleaseRecord
                {
                    authoritative = Vector(authoritativeRelease),
                    renderedHand = Vector(releaseHand.position),
                    distanceMetres = releaseDistance
                };
                report.metrics.Add(new MetricRecord
                {
                    id = "release_hand_distance_m",
                    method = "Run the production bowler to its release callback and sample ReleaseHandAnchor.",
                    expected = "<=0.05",
                    observed = Number(releaseDistance),
                    unit = "m",
                    status = releaseDistance <= ReleaseHandLimitMetres ? "PASS" : "FAIL"
                });

                world.AcceptResult(result);
                world.Tick(0.0);
                hud.AdvancePresentation(0f);
                CaptureBallSample(report, "release", 0.0, result.Trace, ball, scene.Handedness);

                BatContactRecord contactRecord = null;
                for (var index = 1; index < result.Trace.events.Length; index++)
                {
                    var traceEvent = result.Trace.events[index];
                    var delta = Math.Max(0.0, traceEvent.t - world.Timeline);
                    world.Tick(delta);
                    hud.AdvancePresentation((float)delta);
                    if (traceEvent.kind == "bounce")
                    {
                        CaptureBallSample(report, "bounce", traceEvent.t, result.Trace, ball, scene.Handedness);
                        MeasureBounce(report, traceEvent, world.Timeline, ball, scene.Handedness);
                    }
                    else if (traceEvent.kind == "contact")
                    {
                        CaptureBallSample(report, "contact", traceEvent.t, result.Trace, ball, scene.Handedness);
                        contactRecord = MeasureBatAtContact(traceEvent.t, result.Trace, bat, scene.Handedness);
                        report.batContact = contactRecord;
                    }
                    else if (traceEvent.kind == "field")
                    {
                        CaptureBallSample(report, "field", traceEvent.t, result.Trace, ball, scene.Handedness);
                    }
                    else if (traceEvent.kind == "dead")
                    {
                        CaptureBallSample(report, "dead", traceEvent.t, result.Trace, ball, scene.Handedness);
                    }
                }

                if (contactRecord == null)
                    throw new InvalidDataException("The frozen trace contains no contact event.");
                var maximumBallWorldError = 0.0;
                for (var index = 0; index < report.ballSamples.Count; index++)
                    maximumBallWorldError = Math.Max(
                        maximumBallWorldError,
                        report.ballSamples[index].worldErrorMetres);
                report.metrics.Add(new MetricRecord
                {
                    id = "rendered_ball_world_sample_max_error_m",
                    method = "At release, bounce, contact, field and dead times, compare ProductionCricketBall with CanonicalTracePlayback samples.",
                    expected = "world transform diagnostic only; locked acceptance is screen-space and requires presented frames",
                    observed = Number(maximumBallWorldError),
                    unit = "m",
                    status = "MEASURED_REQUIRES_PRESENTED_FRAME"
                });
                var batWithin = contactRecord.gripErrorMetres <= BatPositionLimitMetres &&
                                contactRecord.toeErrorMetres <= BatPositionLimitMetres &&
                                contactRecord.faceErrorDegrees <= BatAngleLimitDegrees;
                report.metrics.Add(new MetricRecord
                {
                    id = "bat_contact_pose",
                    method = "Sample CanonicalTracePlayback at contact, then inspect BatProxy grip/toe/+Z face after production SetBat.",
                    expected = "grip/toe <=0.03 m and face <=5 deg",
                    observed = "grip=" + Number(contactRecord.gripErrorMetres) +
                               ";toe=" + Number(contactRecord.toeErrorMetres) +
                               ";face=" + Number(contactRecord.faceErrorDegrees),
                    unit = "m,m,deg",
                    status = batWithin ? "PASS" : "FAIL"
                });

                var eventAgreement = EventsAgree(result.Trace.events, observedEvents);
                report.events.AddRange(observedEvents);
                report.metrics.Add(new MetricRecord
                {
                    id = "event_order_once",
                    method = "Combine the production ReleaseReached callback with production TraceEvent callbacks while advancing exact canonical event intervals.",
                    expected = EventSequence(result.Trace.events),
                    observed = EventSequence(observedEvents),
                    unit = "ordered-events",
                    status = eventAgreement ? "PASS" : "FAIL"
                });

                report.result.authoritativeDeadT = result.Trace.durationSeconds;
                report.result.observedDeadT = world.Timeline;
                var deadTimeError = Math.Abs(world.Timeline - result.Trace.durationSeconds);
                report.metrics.Add(new MetricRecord
                {
                    id = "dead_time_delta_s",
                    method = "Compare the production world's canonical playback time at dead with the bridge-projected trace duration.",
                    expected = "<=0.000000001",
                    observed = Number(deadTimeError),
                    unit = "s",
                    status = deadTimeError <= ExactTimeToleranceSeconds ? "PASS" : "FAIL"
                });

                MeasureFieldAndPip(report, scene, result.Trace, world, hud, worldRoot);

                world.Tick(0.45);
                hud.AdvancePresentation(0.45f);
                world.Tick(0.45);
                hud.AdvancePresentation(0.45f);
                report.result.applyCount = resultApplyCount;
                report.result.appliedAfterDead = resultAppliedAfterDead;
                report.result.scoreText = hud.ScoreText;
                report.result.outcomeText = hud.OutcomeText;
                report.result.outcomeVisible = hud.OutcomeVisible;
                report.result.completionReplayDigest = completionDigest;
                var hudAgreement = resultApplyCount == 1 && resultAppliedAfterDead &&
                                   completionDigest == result.ReplayDigest &&
                                   hud.ScoreText == result.TotalRuns + "/" + result.Wickets &&
                                   hud.OutcomeText == "DOT" && hud.OutcomeVisible;
                report.metrics.Add(new MetricRecord
                {
                    id = "world_completion_to_hud_result_once",
                    method = "Apply the canonical score/outcome through ProductionHudView exactly on the production world's one DeliveryCompleted callback, then tick again.",
                    expected = "count=1; after dead and quiet exit; score=0/0; outcome=DOT; replay digest exact",
                    observed = "count=" + resultApplyCount + ";afterDead=" + resultAppliedAfterDead +
                               ";score=" + hud.ScoreText + ";outcome=" + hud.OutcomeText +
                               ";digest=" + completionDigest,
                    unit = "presentation-events",
                    status = hudAgreement ? "PASS" : "FAIL"
                });

                var coach = resolution.result.coaching;
                var coachAgreement = coach.reason == "hit_to_fielder" && coach.timing == "on_time" &&
                                     coach.zone == "mid_off" && coach.fielderRole == "bowler" &&
                                     string.IsNullOrEmpty(coach.lbw);
                report.metrics.Add(new MetricRecord
                {
                    id = "coach_facts",
                    method = "Read the already bridge-validated host.result resolution payload; do not infer Coach facts in Unity.",
                    expected = "hit_to_fielder|on_time|mid_off|bowler|null",
                    observed = coach.reason + "|" + coach.timing + "|" + coach.zone + "|" +
                               coach.fielderRole + "|" + (coach.lbw ?? "null"),
                    unit = "canonical-facts",
                    status = coachAgreement ? "PASS" : "FAIL"
                });
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void DriveToRelease(ProceduralPracticeWorld world, ProductionHudView hud)
        {
            while (world.Timeline < -ReleasePreparationEpsilonSeconds)
            {
                var delta = Math.Min(
                    1.0 / 120.0,
                    -ReleasePreparationEpsilonSeconds - world.Timeline);
                if (delta <= 0.0) break;
                world.Tick(delta);
                hud.AdvancePresentation((float)delta);
            }
            var finalDelta = Math.Max(0.0, -world.Timeline);
            world.Tick(finalDelta);
            hud.AdvancePresentation((float)finalDelta);
            if (world.Timeline != 0.0)
                throw new InvalidOperationException("The production world did not reach canonical release time.");
        }

        private static void CaptureBallSample(
            EvidenceReport report,
            string name,
            double time,
            CanonicalDeliveryTrace trace,
            Transform ball,
            string handedness)
        {
            var target = SampleTrace(trace, time);
            var expected = ToVector3(target.ball.p, handedness);
            var observed = ball.position;
            report.ballSamples.Add(new BallSampleRecord
            {
                name = name,
                t = time,
                authoritative = Vector(expected),
                rendered = Vector(observed),
                worldErrorMetres = Vector3.Distance(expected, observed)
            });
        }

        private static void MeasureBounce(
            EvidenceReport report,
            CanonicalTraceEvent bounce,
            double observedTimeline,
            Transform ball,
            string handedness)
        {
            var expectedPoint = ToVector3(bounce.p, handedness);
            var timeError = Math.Abs(observedTimeline - bounce.t);
            var pointError = Vector3.Distance(expectedPoint, ball.position);
            report.bounce = new BounceRecord
            {
                authoritativeT = bounce.t,
                observedSimulationT = observedTimeline,
                timeErrorSeconds = timeError,
                authoritativePoint = Vector(expectedPoint),
                renderedPoint = Vector(ball.position),
                pointErrorMetres = pointError,
                renderedFrameDelta = "NOT_AVAILABLE"
            };
            report.metrics.Add(new MetricRecord
            {
                id = "bounce_event_time_delta_s",
                method = "Advance production canonical playback exactly to the authoritative bounce event.",
                expected = "<=0.000000001",
                observed = Number(timeError),
                unit = "s",
                status = timeError <= ExactTimeToleranceSeconds ? "PASS" : "FAIL"
            });
            report.metrics.Add(new MetricRecord
            {
                id = "bounce_event_point_distance_m",
                method = "Distance from the frozen bounce-event point to ProductionCricketBall after canonical interpolation at the same simulation time.",
                expected = "0 (the frozen contract specifies the physics point but no numeric distance tolerance)",
                observed = Number(pointError),
                unit = "m",
                status = "MEASURED_REQUIRES_INDEPENDENT_REVIEW"
            });
        }

        private static BatContactRecord MeasureBatAtContact(
            double time,
            CanonicalDeliveryTrace trace,
            Transform bat,
            string handedness)
        {
            var target = SampleTrace(trace, time);
            if (target.bat == null) throw new InvalidDataException("No canonical bat sample exists at contact.");
            var expectedGrip = ToVector3(target.bat.grip, handedness);
            var expectedToe = ToVector3(target.bat.toe, handedness);
            var expectedFace = ToDirection(target.bat.face, handedness);
            var renderedGrip = bat.position;
            var renderedToe = bat.TransformPoint(Vector3.down * CricketPropDimensions.TotalBatLength);
            var renderedFace = bat.forward.normalized;
            return new BatContactRecord
            {
                t = time,
                authoritativeGrip = Vector(expectedGrip),
                renderedGrip = Vector(renderedGrip),
                authoritativeToe = Vector(expectedToe),
                renderedToe = Vector(renderedToe),
                authoritativeFace = Vector(expectedFace),
                renderedFace = Vector(renderedFace),
                gripErrorMetres = Vector3.Distance(expectedGrip, renderedGrip),
                toeErrorMetres = Vector3.Distance(expectedToe, renderedToe),
                faceErrorDegrees = Vector3.Angle(expectedFace, renderedFace)
            };
        }

        private static void MeasureFieldAndPip(
            EvidenceReport report,
            PracticeScenePresentation scene,
            CanonicalDeliveryTrace trace,
            ProceduralPracticeWorld world,
            ProductionHudView hud,
            Transform worldRoot)
        {
            var target = SampleTrace(trace, trace.durationSeconds);
            var pipBounds = hud.FieldProjectionPixels;
            var idsExact = world.LiveFieldState != null && world.LiveFieldState.Count == scene.Fielders.Length;
            var maximumStateError = 0.0;
            var maximumRenderedError = 0.0;
            var maximumPipError = 0f;
            for (var index = 0; index < scene.Fielders.Length; index++)
            {
                var source = scene.Fielders[index];
                if (!target.fielders.TryGetValue(source.Id, out var expected))
                    throw new InvalidDataException("No canonical fielder sample exists for " + source.Id + ".");
                var live = world.LiveFieldState.Point(index);
                var renderedRoot = source.Role == "bowler"
                    ? RequireDescendant(worldRoot, "BowlerProxy")
                    : RequireDescendant(worldRoot, "FielderProxy-" + source.Id);
                // Option A world reflection (lead ruling 2026-11-04): the rendered root is x * WorldReflectionFor
                // (-1 for a right-hander). This used the pre-ruling sign (left-hander mirrored only), so every
                // off-centre fielder measured 2|x| (the r4c field_and_pip FAIL). The PIP keeps its own HUD mirror.
                var expectedRendered = new Vector3(
                    ProceduralPracticeWorld.WorldReflectionFor(scene.Handedness) * (float)expected.x,
                    0f,
                    (float)expected.z);
                var expectedPip = ProductionFieldPipProjection.Project(
                    expected.x, expected.z, scene.Handedness == "left", pipBounds);
                var observedPip = hud.FielderPixelPosition(index);
                var stateError = Math.Sqrt(
                    (live.X - expected.x) * (live.X - expected.x) +
                    (live.Z - expected.z) * (live.Z - expected.z));
                var renderedError = Vector3.Distance(expectedRendered, renderedRoot.position);
                var pipError = Vector2.Distance(expectedPip, observedPip);
                maximumStateError = Math.Max(maximumStateError, stateError);
                maximumRenderedError = Math.Max(maximumRenderedError, renderedError);
                maximumPipError = Mathf.Max(maximumPipError, pipError);
                idsExact &= live.Id == source.Id && live.Role == source.Role;
                report.field.Add(new FieldAgreementRecord
                {
                    index = index,
                    id = source.Id,
                    role = source.Role,
                    canonicalX = expected.x,
                    canonicalZ = expected.z,
                    liveId = live.Id,
                    liveRole = live.Role,
                    liveX = live.X,
                    liveZ = live.Z,
                    action = live.Action,
                    stateErrorMetres = stateError,
                    rendered = Vector(renderedRoot.position),
                    renderedErrorMetres = renderedError,
                    expectedPipPixels = Vector(expectedPip),
                    observedPipPixels = Vector(observedPip),
                    pipErrorPixels = pipError
                });
            }
            var agreement = idsExact && maximumStateError <= ExactTimeToleranceSeconds &&
                            maximumRenderedError <= FloatPresentationToleranceMetres &&
                            maximumPipError <= PipPresentationTolerancePixels;
            report.metrics.Add(new MetricRecord
            {
                id = "field_and_pip_canonical_agreement",
                method = "At canonical dead time, compare trace samples by ID with LiveFieldState, rendered fielder roots and ProductionHudView marker pixels.",
                expected = "11 IDs/roles exact; state exact; rendered <=0.0001 m float projection; PIP <=0.001 px",
                observed = "idsExact=" + idsExact + ";stateMax=" + Number(maximumStateError) +
                           ";renderedMax=" + Number(maximumRenderedError) +
                           ";pipMax=" + Number(maximumPipError),
                unit = "IDs,m,m,px",
                status = agreement ? "PASS" : "FAIL"
            });
        }

        private static TraceCaptureTarget SampleTrace(CanonicalDeliveryTrace trace, double time)
        {
            var target = new TraceCaptureTarget();
            var playback = new CanonicalTracePlayback(trace, target);
            playback.Seek(time);
            return target;
        }

        private static bool EventsAgree(
            CanonicalTraceEvent[] expected,
            List<ObservedEventRecord> observed)
        {
            if (expected.Length != observed.Count) return false;
            for (var index = 0; index < expected.Length; index++)
            {
                if (expected[index].kind != observed[index].kind ||
                    (expected[index].contact ?? "null") != observed[index].contact ||
                    (expected[index].fielderId ?? "null") != observed[index].fielderId ||
                    Math.Abs(expected[index].t - observed[index].t) > ExactTimeToleranceSeconds)
                    return false;
            }
            return true;
        }

        private static string EventSequence(CanonicalTraceEvent[] events)
        {
            var values = new string[events.Length];
            for (var index = 0; index < events.Length; index++)
                values[index] = events[index].kind + "@" + Number(events[index].t);
            return string.Join(">", values);
        }

        private static string EventSequence(List<ObservedEventRecord> events)
        {
            var values = new string[events.Count];
            for (var index = 0; index < events.Count; index++)
                values[index] = events[index].kind + "@" + Number(events[index].t);
            return string.Join(">", values);
        }

        private static void AddIdentityMetrics(
            EvidenceReport report,
            FrozenFixture fixture,
            FrozenCase frozenCase,
            PracticeResultPresentation result,
            PracticeResultPresentation replay)
        {
            AddExact(report, "fixture_payload_sha256", "Compare fixture metadata to the frozen delivery contract.",
                FixturePayloadSha, fixture.payloadSha256);
            AddExact(report, "canonical_trace_sha256", "Compute CanonicalTraceDigest from the bridge-projected result trace.",
                TraceSha, CanonicalTraceDigest.Compute(result.Trace));
            AddExact(report, "fixture_flight_sha256", "Compare the fixture's TypeScript-produced flight digest to the frozen contract.",
                FlightSha, frozenCase.digests.flightSha256);
            AddExact(report, "fixture_record_sha256", "Compare the fixture's TypeScript-produced immutable record digest to the frozen contract.",
                RecordSha, frozenCase.digests.recordSha256);
            AddExact(report, "fixture_result_sha256", "Compare the fixture's TypeScript-produced result digest to the frozen contract.",
                ResolutionSha, frozenCase.digests.resultSha256);
            AddExact(report, "fixture_replay_sha256", "Compare the fixture's TypeScript-produced replay resolution digest to the frozen contract.",
                ResolutionSha, frozenCase.digests.replaySha256);
            AddExact(report, "replay_digest", "Read the bridge-projected result replay digest.",
                ReplayDigest, result.ReplayDigest);
            AddExact(report, "replay_trace_sha256", "Compute CanonicalTraceDigest from the bridge-projected replay trace.",
                TraceSha, CanonicalTraceDigest.Compute(replay.Trace));
            AddExact(report, "result_replay_digest_agreement", "Compare bridge-projected result and replay identities.",
                result.ReplayDigest, replay.ReplayDigest);
        }

        private static void AddExact(
            EvidenceReport report,
            string id,
            string method,
            string expected,
            string observed)
        {
            report.metrics.Add(new MetricRecord
            {
                id = id,
                method = method,
                expected = expected,
                observed = observed,
                unit = "identity",
                status = string.Equals(expected, observed, StringComparison.Ordinal) ? "PASS" : "FAIL"
            });
        }

        private static MetricRecord NotAvailable(
            string id,
            string method,
            string expected,
            string reason)
        {
            return new MetricRecord
            {
                id = id,
                method = method,
                expected = expected,
                observed = "NOT_AVAILABLE",
                unit = reason,
                status = "NOT_AVAILABLE"
            };
        }

        private static IdentityRecord Identity(
            FrozenFixture fixture,
            FrozenCase frozenCase,
            DecodedUnityPracticePacket scene,
            DecodedUnityPracticePacket delivery,
            DecodedUnityPracticePacket result,
            DecodedUnityPracticePacket replay)
        {
            return new IdentityRecord
            {
                fixtureVersion = fixture.fixtureVersion,
                simulationVersion = fixture.simulationVersion,
                fixtureCaseId = frozenCase.id,
                referenceBallId = frozenCase.referenceBall,
                wireBuildId = scene.Envelope.buildId,
                sessionId = scene.Envelope.sessionId,
                deliveryId = delivery.Envelope.deliveryId,
                sceneMessageId = scene.Envelope.messageId,
                deliveryMessageId = delivery.Envelope.messageId,
                resultMessageId = result.Envelope.messageId,
                replayMessageId = replay.Envelope.messageId,
                scenePacketSha256 = frozenCase.wire.packets.scene.sha256,
                deliveryPacketSha256 = frozenCase.wire.packets.delivery.sha256,
                resultPacketSha256 = frozenCase.wire.packets.result.sha256,
                replayPacketSha256 = frozenCase.wire.packets.replay.sha256,
                canonicalTraceSha256 = frozenCase.digests.canonicalTraceSha256,
                flightSha256 = frozenCase.digests.flightSha256,
                recordSha256 = frozenCase.digests.recordSha256,
                resultSha256 = frozenCase.digests.resultSha256,
                replaySha256 = frozenCase.digests.replaySha256,
                replayDigest = frozenCase.wire.replayDigest
            };
        }

        private static DecodedUnityPracticePacket Decode(UnityPracticePacket packet)
        {
            if (packet == null) throw new InvalidDataException("The frozen fixture contains a null packet.");
            return UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet));
        }

        private static FrozenCase FindFrozenCase(FrozenFixture fixture)
        {
            for (var index = 0; index < fixture.cases.Length; index++)
            {
                var value = fixture.cases[index];
                if (value != null && value.id == FixtureCaseId && value.referenceBall == ReferenceBallId)
                    return value;
            }
            throw new InvalidDataException("The frozen grounded-attack/ref-3 case is missing.");
        }

        private static Transform RequireDescendant(Transform root, string name)
        {
            if (root.name == name) return root;
            for (var index = 0; index < root.childCount; index++)
            {
                var found = FindDescendant(root.GetChild(index), name);
                if (found != null) return found;
            }
            throw new InvalidOperationException("The production presentation object is missing: " + name);
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root.name == name) return root;
            for (var index = 0; index < root.childCount; index++)
            {
                var found = FindDescendant(root.GetChild(index), name);
                if (found != null) return found;
            }
            return null;
        }

        private static Vector3 ToVector3(TraceVector3 value, string handedness)
        {
            // Option A world reflection (owner/lead ruling 2026-11-04): -1 for a right-hander, +1 for a left-hander.
            // This used +1 for a right-hander, the pre-ruling mirror image (it measured a 0.84 m release gap).
            var mirror = ProceduralPracticeWorld.WorldReflectionFor(handedness);
            return new Vector3(mirror * (float)value.x, (float)value.y, (float)value.z);
        }

        private static Vector3 ToDirection(TraceVector3 value, string handedness)
        {
            var converted = ToVector3(value, handedness);
            return converted.sqrMagnitude <= 0.000000001f ? Vector3.forward : converted.normalized;
        }

        private static string Vector(Vector3 value)
        {
            return Number(value.x) + "," + Number(value.y) + "," + Number(value.z);
        }

        private static string Vector(Vector2 value)
        {
            return Number(value.x) + "," + Number(value.y);
        }

        private static string Number(double value)
        {
            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        private static string RepositoryRoot()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
        }

        private static string OutputPath()
        {
            var environment = Environment.GetEnvironmentVariable("VANDE_PRESENTATION_EVIDENCE_OUTPUT");
            if (!string.IsNullOrWhiteSpace(environment)) return Path.GetFullPath(environment);
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index + 1 < arguments.Length; index++)
            {
                if (arguments[index] == "-vandePresentationEvidenceOutput")
                    return Path.GetFullPath(arguments[index + 1]);
            }
            throw new InvalidOperationException(
                "Set VANDE_PRESENTATION_EVIDENCE_OUTPUT or -vandePresentationEvidenceOutput.");
        }

        private static string ReadBuildId(string repositoryRoot)
        {
            var fromEnvironment = Environment.GetEnvironmentVariable("VANDE_BUILD_ID");
            if (!string.IsNullOrWhiteSpace(fromEnvironment)) return fromEnvironment.Trim();
            return ReadProcessOutput(
                "/bin/bash",
                "scripts/build-id.sh",
                repositoryRoot).Trim();
        }

        private static string ReadProcessOutput(string file, string arguments, string workingDirectory)
        {
            try
            {
                var start = new ProcessStartInfo
                {
                    FileName = file,
                    Arguments = arguments,
                    WorkingDirectory = workingDirectory,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                using (var process = Process.Start(start))
                {
                    if (process == null) return "NOT_AVAILABLE";
                    var output = process.StandardOutput.ReadToEnd();
                    var error = process.StandardError.ReadToEnd();
                    process.WaitForExit();
                    return process.ExitCode == 0 ? output.Trim() : "NOT_AVAILABLE: " + error.Trim();
                }
            }
            catch (Exception exception)
            {
                return "NOT_AVAILABLE: " + exception.GetType().Name;
            }
        }

        private static string HexSha256(byte[] bytes)
        {
            using (var sha = SHA256.Create())
            {
                var digest = sha.ComputeHash(bytes);
                var result = new StringBuilder(digest.Length * 2);
                for (var index = 0; index < digest.Length; index++)
                    result.Append(digest[index].ToString("x2", CultureInfo.InvariantCulture));
                return result.ToString();
            }
        }

        private sealed class RecordingFeedbackSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }

        private sealed class TraceCaptureTarget : ICanonicalTraceTarget
        {
            public BallTraceSample ball;
            public BatTraceSample bat;
            public readonly Dictionary<string, FielderTraceSample> fielders =
                new Dictionary<string, FielderTraceSample>(StringComparer.Ordinal);

            public void SetBall(BallTraceSample value) { ball = value; }
            public void SetBat(BatTraceSample value) { bat = value; }
            public void SetFielder(string id, FielderTraceSample value) { fielders[id] = value; }
            public void EmitEvent(CanonicalTraceEvent traceEvent) { }
            public void SetPlaybackCompleted(bool completed) { }
        }

        [Serializable]
        private sealed class FrozenFixture
        {
            public int fixtureVersion;
            public int simulationVersion;
            public string payloadSha256;
            public FrozenCase[] cases;
        }

        [Serializable]
        private sealed class FrozenCase
        {
            public string id;
            public string referenceBall;
            public FrozenDigests digests;
            public FrozenWire wire;
        }

        [Serializable]
        private sealed class FrozenDigests
        {
            public string canonicalTraceSha256;
            public string flightSha256;
            public string recordSha256;
            public string resultSha256;
            public string replaySha256;
        }

        [Serializable]
        private sealed class FrozenWire
        {
            public string buildId;
            public string sessionId;
            public string deliveryId;
            public string replayDigest;
            public FrozenPackets packets;
        }

        [Serializable]
        private sealed class FrozenPackets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket result;
            public UnityPracticePacket replay;
        }

        [Serializable]
        private sealed class ResolutionProbe
        {
            public ResultProbe result;
            public ScoreProbe score;
        }

        [Serializable]
        private sealed class ResultProbe
        {
            public CoachingProbe coaching;
            public ContactProbe contact;
            public OutcomeProbe outcome;
        }

        [Serializable]
        private sealed class CoachingProbe
        {
            public string reason;
            public string timing;
            public string zone;
            public string fielderRole;
            public string lbw;
        }

        [Serializable]
        private sealed class ContactProbe
        {
            public string kind;
            public string timing;
            public double t;
        }

        [Serializable]
        private sealed class OutcomeProbe
        {
            public int runs;
            public string dismissal;
            public string fielderId;
            public string region;
        }

        [Serializable]
        private sealed class ScoreProbe
        {
            public int runs;
            public int wickets;
            public int balls;
        }

        [Serializable]
        private sealed class EvidenceReport
        {
            public string schema;
            public string classification;
            public string certification;
            public string generatedUtc;
            public string uptime;
            public string evidenceBuildId;
            public string fixturePath;
            public string fixtureFileSha256;
            public string fixturePayloadSha256;
            public string unityVersion;
            public string deviceOrBrowser;
            public string settings;
            public IdentityRecord identity;
            public ReleaseRecord release;
            public BounceRecord bounce;
            public BatContactRecord batContact;
            public CoachRecord coach;
            public ResultRecord result;
            public MetricRecord[] metricsArray;
            public BallSampleRecord[] ballSamplesArray;
            public ObservedEventRecord[] eventsArray;
            public FieldAgreementRecord[] fieldArray;
            [NonSerialized] public List<MetricRecord> metrics;
            [NonSerialized] public List<BallSampleRecord> ballSamples;
            [NonSerialized] public List<ObservedEventRecord> events;
            [NonSerialized] public List<FieldAgreementRecord> field;
        }

        [Serializable]
        private sealed class IdentityRecord
        {
            public int fixtureVersion;
            public int simulationVersion;
            public string fixtureCaseId;
            public string referenceBallId;
            public string wireBuildId;
            public string sessionId;
            public string deliveryId;
            public string sceneMessageId;
            public string deliveryMessageId;
            public string resultMessageId;
            public string replayMessageId;
            public string scenePacketSha256;
            public string deliveryPacketSha256;
            public string resultPacketSha256;
            public string replayPacketSha256;
            public string canonicalTraceSha256;
            public string flightSha256;
            public string recordSha256;
            public string resultSha256;
            public string replaySha256;
            public string replayDigest;
        }

        [Serializable]
        private sealed class MetricRecord
        {
            public string id;
            public string method;
            public string expected;
            public string observed;
            public string unit;
            public string status;
        }

        [Serializable]
        private sealed class ReleaseRecord
        {
            public string authoritative;
            public string renderedHand;
            public double distanceMetres;
        }

        [Serializable]
        private sealed class BallSampleRecord
        {
            public string name;
            public double t;
            public string authoritative;
            public string rendered;
            public double worldErrorMetres;
        }

        [Serializable]
        private sealed class BounceRecord
        {
            public double authoritativeT;
            public double observedSimulationT;
            public double timeErrorSeconds;
            public string authoritativePoint;
            public string renderedPoint;
            public double pointErrorMetres;
            public string renderedFrameDelta;
        }

        [Serializable]
        private sealed class BatContactRecord
        {
            public double t;
            public string authoritativeGrip;
            public string renderedGrip;
            public string authoritativeToe;
            public string renderedToe;
            public string authoritativeFace;
            public string renderedFace;
            public double gripErrorMetres;
            public double toeErrorMetres;
            public double faceErrorDegrees;
        }

        [Serializable]
        private sealed class ObservedEventRecord
        {
            public int index;
            public string kind;
            public double t;
            public string contact;
            public string fielderId;
        }

        [Serializable]
        private sealed class FieldAgreementRecord
        {
            public int index;
            public string id;
            public string role;
            public double canonicalX;
            public double canonicalZ;
            public string liveId;
            public string liveRole;
            public double liveX;
            public double liveZ;
            public string action;
            public double stateErrorMetres;
            public string rendered;
            public double renderedErrorMetres;
            public string expectedPipPixels;
            public string observedPipPixels;
            public double pipErrorPixels;
        }

        [Serializable]
        private sealed class CoachRecord
        {
            public string reason;
            public string timing;
            public string zone;
            public string fielderRole;
            public string lbw;
        }

        [Serializable]
        private sealed class ResultRecord
        {
            public int totalRuns;
            public int wickets;
            public int balls;
            public int deliveryRuns;
            public string dismissal;
            public string shotIntent;
            public string footwork;
            public string replayDigest;
            public double authoritativeDeadT;
            public double observedDeadT;
            public int applyCount;
            public bool appliedAfterDead;
            public string scoreText;
            public string outcomeText;
            public bool outcomeVisible;
            public string completionReplayDigest;
        }
    }
}
