using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Audio.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The C# port of src/audio/takes.ts and recordedManifest.ts (wedge Track C §6.5; the contact placeholders of
    /// scripts/audio/placeholders.mjs, SOUNDKIT): the same delivery record picks
    /// the same take on the web and in Unity, the onset is found at 0.1 × peak and kept 3 ms of pre-roll, and the
    /// sink schedules a sound at the physics event's own time. Every TypeScript-derived expectation below was produced
    /// by running the web's own takes.ts on these inputs (builder tool; the vectors are pinned here, and the FNV-1a
    /// reference vectors are the same as tests/unit/audio/recorded.test.ts).
    /// </summary>
    public sealed class ProductionRecordedTakesTests
    {
        private static readonly string RepositoryRoot =
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));

        private static readonly FnvVector[] FnvVectors =
        {
            new FnvVector("", 0x811c9dc5u),
            new FnvVector("a", 0xe40c292cu),
            new FnvVector("foobar", 0xbf9cf968u),
            new FnvVector("over-7f3a#0.3|middle|0", 0x1e3fcac8u),
            new FnvVector("w0-baseline#9.5|crowd:applause|2", 0xae9f6719u),
            new FnvVector("हिन्दी|x|1", 0xc7ac5c0fu),
            new FnvVector("demo:ref-1#0.0|gloves|1", 0x0e584d57u),
        };

        private static readonly IndexVector[] IndexVectors =
        {
            new IndexVector("over-7f3a#0.3", "middle", 0, 1, 0),
            new IndexVector("over-7f3a#0.3", "middle", 0, 3, 0),
            new IndexVector("over-7f3a#0.3", "middle", 0, 4, 0),
            new IndexVector("over-7f3a#0.3", "middle", 0, 5, 0),
            new IndexVector("over-7f3a#0.3", "middle", 1, 1, 0),
            new IndexVector("over-7f3a#0.3", "middle", 1, 3, 2),
            new IndexVector("over-7f3a#0.3", "middle", 1, 4, 3),
            new IndexVector("over-7f3a#0.3", "middle", 1, 5, 4),
            new IndexVector("over-7f3a#0.3", "middle", 2, 1, 0),
            new IndexVector("over-7f3a#0.3", "middle", 2, 3, 1),
            new IndexVector("over-7f3a#0.3", "middle", 2, 4, 2),
            new IndexVector("over-7f3a#0.3", "middle", 2, 5, 3),
            new IndexVector("over-7f3a#0.3", "sweet", 0, 1, 0),
            new IndexVector("over-7f3a#0.3", "sweet", 0, 3, 0),
            new IndexVector("over-7f3a#0.3", "sweet", 0, 4, 3),
            new IndexVector("over-7f3a#0.3", "sweet", 0, 5, 0),
            new IndexVector("over-7f3a#0.3", "sweet", 1, 1, 0),
            new IndexVector("over-7f3a#0.3", "sweet", 1, 3, 1),
            new IndexVector("over-7f3a#0.3", "sweet", 1, 4, 0),
            new IndexVector("over-7f3a#0.3", "sweet", 1, 5, 1),
            new IndexVector("over-7f3a#0.3", "sweet", 2, 1, 0),
            new IndexVector("over-7f3a#0.3", "sweet", 2, 3, 1),
            new IndexVector("over-7f3a#0.3", "sweet", 2, 4, 1),
            new IndexVector("over-7f3a#0.3", "sweet", 2, 5, 3),
            new IndexVector("over-7f3a#0.3", "edge_thin", 0, 1, 0),
            new IndexVector("over-7f3a#0.3", "edge_thin", 0, 3, 0),
            new IndexVector("over-7f3a#0.3", "edge_thin", 0, 4, 2),
            new IndexVector("over-7f3a#0.3", "edge_thin", 0, 5, 2),
            new IndexVector("over-7f3a#0.3", "edge_thin", 1, 1, 0),
            new IndexVector("over-7f3a#0.3", "edge_thin", 1, 3, 2),
            new IndexVector("over-7f3a#0.3", "edge_thin", 1, 4, 1),
            new IndexVector("over-7f3a#0.3", "edge_thin", 1, 5, 1),
            new IndexVector("over-7f3a#0.3", "edge_thin", 2, 1, 0),
            new IndexVector("over-7f3a#0.3", "edge_thin", 2, 3, 2),
            new IndexVector("over-7f3a#0.3", "edge_thin", 2, 4, 0),
            new IndexVector("over-7f3a#0.3", "edge_thin", 2, 5, 4),
            new IndexVector("over-7f3a#0.3", "gloves", 0, 1, 0),
            new IndexVector("over-7f3a#0.3", "gloves", 0, 3, 0),
            new IndexVector("over-7f3a#0.3", "gloves", 0, 4, 3),
            new IndexVector("over-7f3a#0.3", "gloves", 0, 5, 1),
            new IndexVector("over-7f3a#0.3", "gloves", 1, 1, 0),
            new IndexVector("over-7f3a#0.3", "gloves", 1, 3, 1),
            new IndexVector("over-7f3a#0.3", "gloves", 1, 4, 0),
            new IndexVector("over-7f3a#0.3", "gloves", 1, 5, 2),
            new IndexVector("over-7f3a#0.3", "gloves", 2, 1, 0),
            new IndexVector("over-7f3a#0.3", "gloves", 2, 3, 1),
            new IndexVector("over-7f3a#0.3", "gloves", 2, 4, 1),
            new IndexVector("over-7f3a#0.3", "gloves", 2, 5, 4),
            new IndexVector("over-7f3a#0.3", "bounce", 0, 1, 0),
            new IndexVector("over-7f3a#0.3", "bounce", 0, 3, 0),
            new IndexVector("over-7f3a#0.3", "bounce", 0, 4, 1),
            new IndexVector("over-7f3a#0.3", "bounce", 0, 5, 4),
            new IndexVector("over-7f3a#0.3", "bounce", 1, 1, 0),
            new IndexVector("over-7f3a#0.3", "bounce", 1, 3, 1),
            new IndexVector("over-7f3a#0.3", "bounce", 1, 4, 2),
            new IndexVector("over-7f3a#0.3", "bounce", 1, 5, 0),
            new IndexVector("over-7f3a#0.3", "bounce", 2, 1, 0),
            new IndexVector("over-7f3a#0.3", "bounce", 2, 3, 2),
            new IndexVector("over-7f3a#0.3", "bounce", 2, 4, 3),
            new IndexVector("over-7f3a#0.3", "bounce", 2, 5, 1),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 0, 1, 0),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 0, 3, 0),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 0, 4, 3),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 0, 5, 4),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 1, 1, 0),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 1, 3, 1),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 1, 4, 0),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 1, 5, 0),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 2, 1, 0),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 2, 3, 1),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 2, 4, 1),
            new IndexVector("over-7f3a#0.3", "crowd:applause", 2, 5, 2),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 0, 1, 0),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 0, 3, 2),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 0, 4, 1),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 0, 5, 1),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 1, 1, 0),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 1, 3, 0),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 1, 4, 2),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 1, 5, 2),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 2, 1, 0),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 2, 3, 1),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 2, 4, 3),
            new IndexVector("over-7f3a#0.3", "unity:field_pickup", 2, 5, 3),
            new IndexVector("w0-baseline#9.5", "middle", 0, 1, 0),
            new IndexVector("w0-baseline#9.5", "middle", 0, 3, 2),
            new IndexVector("w0-baseline#9.5", "middle", 0, 4, 0),
            new IndexVector("w0-baseline#9.5", "middle", 0, 5, 0),
            new IndexVector("w0-baseline#9.5", "middle", 1, 1, 0),
            new IndexVector("w0-baseline#9.5", "middle", 1, 3, 1),
            new IndexVector("w0-baseline#9.5", "middle", 1, 4, 3),
            new IndexVector("w0-baseline#9.5", "middle", 1, 5, 4),
            new IndexVector("w0-baseline#9.5", "middle", 2, 1, 0),
            new IndexVector("w0-baseline#9.5", "middle", 2, 3, 0),
            new IndexVector("w0-baseline#9.5", "middle", 2, 4, 2),
            new IndexVector("w0-baseline#9.5", "middle", 2, 5, 3),
            new IndexVector("w0-baseline#9.5", "sweet", 0, 1, 0),
            new IndexVector("w0-baseline#9.5", "sweet", 0, 3, 1),
            new IndexVector("w0-baseline#9.5", "sweet", 0, 4, 3),
            new IndexVector("w0-baseline#9.5", "sweet", 0, 5, 0),
            new IndexVector("w0-baseline#9.5", "sweet", 1, 1, 0),
            new IndexVector("w0-baseline#9.5", "sweet", 1, 3, 2),
            new IndexVector("w0-baseline#9.5", "sweet", 1, 4, 0),
            new IndexVector("w0-baseline#9.5", "sweet", 1, 5, 1),
            new IndexVector("w0-baseline#9.5", "sweet", 2, 1, 0),
            new IndexVector("w0-baseline#9.5", "sweet", 2, 3, 2),
            new IndexVector("w0-baseline#9.5", "sweet", 2, 4, 1),
            new IndexVector("w0-baseline#9.5", "sweet", 2, 5, 3),
            new IndexVector("w0-baseline#9.5", "edge_thin", 0, 1, 0),
            new IndexVector("w0-baseline#9.5", "edge_thin", 0, 3, 1),
            new IndexVector("w0-baseline#9.5", "edge_thin", 0, 4, 2),
            new IndexVector("w0-baseline#9.5", "edge_thin", 0, 5, 1),
            new IndexVector("w0-baseline#9.5", "edge_thin", 1, 1, 0),
            new IndexVector("w0-baseline#9.5", "edge_thin", 1, 3, 0),
            new IndexVector("w0-baseline#9.5", "edge_thin", 1, 4, 1),
            new IndexVector("w0-baseline#9.5", "edge_thin", 1, 5, 0),
            new IndexVector("w0-baseline#9.5", "edge_thin", 2, 1, 0),
            new IndexVector("w0-baseline#9.5", "edge_thin", 2, 3, 0),
            new IndexVector("w0-baseline#9.5", "edge_thin", 2, 4, 0),
            new IndexVector("w0-baseline#9.5", "edge_thin", 2, 5, 3),
            new IndexVector("w0-baseline#9.5", "gloves", 0, 1, 0),
            new IndexVector("w0-baseline#9.5", "gloves", 0, 3, 2),
            new IndexVector("w0-baseline#9.5", "gloves", 0, 4, 3),
            new IndexVector("w0-baseline#9.5", "gloves", 0, 5, 2),
            new IndexVector("w0-baseline#9.5", "gloves", 1, 1, 0),
            new IndexVector("w0-baseline#9.5", "gloves", 1, 3, 0),
            new IndexVector("w0-baseline#9.5", "gloves", 1, 4, 0),
            new IndexVector("w0-baseline#9.5", "gloves", 1, 5, 3),
            new IndexVector("w0-baseline#9.5", "gloves", 2, 1, 0),
            new IndexVector("w0-baseline#9.5", "gloves", 2, 3, 0),
            new IndexVector("w0-baseline#9.5", "gloves", 2, 4, 1),
            new IndexVector("w0-baseline#9.5", "gloves", 2, 5, 0),
            new IndexVector("w0-baseline#9.5", "bounce", 0, 1, 0),
            new IndexVector("w0-baseline#9.5", "bounce", 0, 3, 0),
            new IndexVector("w0-baseline#9.5", "bounce", 0, 4, 1),
            new IndexVector("w0-baseline#9.5", "bounce", 0, 5, 0),
            new IndexVector("w0-baseline#9.5", "bounce", 1, 1, 0),
            new IndexVector("w0-baseline#9.5", "bounce", 1, 3, 1),
            new IndexVector("w0-baseline#9.5", "bounce", 1, 4, 2),
            new IndexVector("w0-baseline#9.5", "bounce", 1, 5, 1),
            new IndexVector("w0-baseline#9.5", "bounce", 2, 1, 0),
            new IndexVector("w0-baseline#9.5", "bounce", 2, 3, 2),
            new IndexVector("w0-baseline#9.5", "bounce", 2, 4, 3),
            new IndexVector("w0-baseline#9.5", "bounce", 2, 5, 2),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 0, 1, 0),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 0, 3, 1),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 0, 4, 3),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 0, 5, 3),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 1, 1, 0),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 1, 3, 2),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 1, 4, 0),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 1, 5, 4),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 2, 1, 0),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 2, 3, 2),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 2, 4, 1),
            new IndexVector("w0-baseline#9.5", "crowd:applause", 2, 5, 1),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 0, 1, 0),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 0, 3, 0),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 0, 4, 1),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 0, 5, 1),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 1, 1, 0),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 1, 3, 1),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 1, 4, 2),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 1, 5, 2),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 2, 1, 0),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 2, 3, 2),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 2, 4, 3),
            new IndexVector("w0-baseline#9.5", "unity:field_pickup", 2, 5, 3),
            new IndexVector("demo:w0-baseline#0.0", "middle", 0, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "middle", 0, 3, 0),
            new IndexVector("demo:w0-baseline#0.0", "middle", 0, 4, 1),
            new IndexVector("demo:w0-baseline#0.0", "middle", 0, 5, 2),
            new IndexVector("demo:w0-baseline#0.0", "middle", 1, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "middle", 1, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "middle", 1, 4, 2),
            new IndexVector("demo:w0-baseline#0.0", "middle", 1, 5, 3),
            new IndexVector("demo:w0-baseline#0.0", "middle", 2, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "middle", 2, 3, 2),
            new IndexVector("demo:w0-baseline#0.0", "middle", 2, 4, 3),
            new IndexVector("demo:w0-baseline#0.0", "middle", 2, 5, 4),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 0, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 0, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 0, 4, 0),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 0, 5, 2),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 1, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 1, 3, 0),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 1, 4, 3),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 1, 5, 1),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 2, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 2, 3, 2),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 2, 4, 2),
            new IndexVector("demo:w0-baseline#0.0", "sweet", 2, 5, 0),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 0, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 0, 3, 0),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 0, 4, 1),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 0, 5, 4),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 1, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 1, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 1, 4, 2),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 1, 5, 0),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 2, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 2, 3, 2),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 2, 4, 3),
            new IndexVector("demo:w0-baseline#0.0", "edge_thin", 2, 5, 1),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 0, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 0, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 0, 4, 2),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 0, 5, 0),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 1, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 1, 3, 0),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 1, 4, 1),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 1, 5, 4),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 2, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 2, 3, 0),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 2, 4, 0),
            new IndexVector("demo:w0-baseline#0.0", "gloves", 2, 5, 2),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 0, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 0, 3, 0),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 0, 4, 0),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 0, 5, 1),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 1, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 1, 3, 2),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 1, 4, 3),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 1, 5, 0),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 2, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 2, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 2, 4, 2),
            new IndexVector("demo:w0-baseline#0.0", "bounce", 2, 5, 4),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 0, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 0, 3, 2),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 0, 4, 2),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 0, 5, 2),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 1, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 1, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 1, 4, 1),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 1, 5, 1),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 2, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 2, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 2, 4, 0),
            new IndexVector("demo:w0-baseline#0.0", "crowd:applause", 2, 5, 4),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 0, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 0, 3, 0),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 0, 4, 0),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 0, 5, 3),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 1, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 1, 3, 2),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 1, 4, 3),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 1, 5, 2),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 2, 1, 0),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 2, 3, 1),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 2, 4, 2),
            new IndexVector("demo:w0-baseline#0.0", "unity:field_pickup", 2, 5, 1),
        };

        private static readonly UnitVector[] UnitVectors =
        {
            new UnitVector("over-7f3a#0.3", "crowd:applause", 0, 0.8179576247930527),
            new UnitVector("over-7f3a#0.3", "crowd:applause", 1, 0.45627564820460975),
            new UnitVector("over-7f3a#0.3", "crowd:cheer", 0, 0.3008213075809181),
            new UnitVector("over-7f3a#0.3", "crowd:cheer", 1, 0.8769358361605555),
            new UnitVector("w0-baseline#9.5", "crowd:applause", 0, 0.05835638754069805),
            new UnitVector("w0-baseline#9.5", "crowd:applause", 1, 0.5716714083682746),
            new UnitVector("w0-baseline#9.5", "crowd:cheer", 0, 0.2200907520018518),
            new UnitVector("w0-baseline#9.5", "crowd:cheer", 1, 0.7962052805814892),
            new UnitVector("demo:w0-baseline#0.0", "crowd:applause", 0, 0.4350791594479233),
            new UnitVector("demo:w0-baseline#0.0", "crowd:applause", 1, 0.8589406101964414),
            new UnitVector("demo:w0-baseline#0.0", "crowd:cheer", 0, 0.7870551983360201),
            new UnitVector("demo:w0-baseline#0.0", "crowd:cheer", 1, 0.22062100050970912),
        };

        private static readonly AlignVector[] AlignVectors =
        {
            new AlignVector(10.0, 0.007, 0.003, 9.5, 1.0, 9.997, 0.004),
            new AlignVector(10.0, 0.007, 0.003, 9.999, 1.0, 9.999, 0.006000000000000668),
            new AlignVector(10.0, 0.007, 0.003, 9.5, 1.03, 9.997087378640776, 0.004),
            new AlignVector(4.0, 0.0, 0.0, 3.0, 1.0, 4.0, 0.0),
            new AlignVector(2.0, 0.001, 0.003, 1.0, 1.0, 1.999, 0.0),
            new AlignVector(5.0, 0.02, 0.003, 5.5, 1.0, 5.5, 0.5200000000000001),
        };

        [Test]
        public void Fnv1a32_MatchesTheReferenceVectorsPinnedForTheUnityPort()
        {
            // The same three vectors as recorded.test.ts 'FNV-1a 32 matches the reference vectors (for the Unity port)'.
            Assert.That(ProductionRecordedTakes.Fnv1a32(""), Is.EqualTo(0x811c9dc5u));
            Assert.That(ProductionRecordedTakes.Fnv1a32("a"), Is.EqualTo(0xe40c292cu));
            Assert.That(ProductionRecordedTakes.Fnv1a32("foobar"), Is.EqualTo(0xbf9cf968u));
            foreach (var vector in FnvVectors)
                Assert.That(ProductionRecordedTakes.Fnv1a32(vector.Value), Is.EqualTo(vector.Hash), vector.Value);
        }

        [Test]
        public void DeliveryKey_IsTheRecord_TheExactRetryMatchesAndAnotherBallDoesNot()
        {
            var first = ProductionRecordedTakes.DeliveryTakeKey("over-7f3a", 0, 3);
            var retry = ProductionRecordedTakes.DeliveryTakeKey("over-7f3a", 0, 3);
            Assert.That(first, Is.EqualTo("over-7f3a#0.3"));
            Assert.That(retry, Is.EqualTo(first));
            Assert.That(ProductionRecordedTakes.DeliveryTakeKey("over-7f3a", 0, 4), Is.Not.EqualTo(first));
            Assert.That(ProductionRecordedTakes.DeliveryTakeKey("over-1111", 0, 3), Is.Not.EqualTo(first));
            Assert.That(ProductionRecordedTakes.DeliveryTakeKey("w0-baseline", 9, 5), Is.EqualTo("w0-baseline#9.5"));
            Assert.That(ProductionRecordedTakes.DeliveryTakeKey("demo:w0-baseline", 0, 0),
                Is.EqualTo("demo:w0-baseline#0.0"));
            Assert.That(ProductionRecordedTakes.DeliveryTakeKey("", 1, 1), Is.EqualTo("unseeded"));
            Assert.That(ProductionRecordedTakes.DeliveryTakeKey(null, 1, 1), Is.EqualTo("unseeded"));
            Assert.That(ProductionRecordedTakes.DeliveryTakeKey("x", null, null), Is.EqualTo("x#-.-"));
        }

        [Test]
        public void TakeIndexAndUnit_AreIdenticalToTheTypeScriptOnEveryVector()
        {
            Assert.That(IndexVectors.Length, Is.EqualTo(252));
            foreach (var vector in IndexVectors)
            {
                Assert.That(
                    ProductionRecordedTakes.TakeIndex(vector.Key, vector.Sound, vector.Occurrence, vector.Count),
                    Is.EqualTo(vector.Index),
                    vector.Key + "|" + vector.Sound + "|" + vector.Occurrence + " of " + vector.Count);
            }
            foreach (var vector in UnitVectors)
            {
                Assert.That(ProductionRecordedTakes.TakeUnit(vector.Key, vector.Sound, vector.Occurrence),
                    Is.EqualTo(vector.Unit), vector.Key + "|" + vector.Sound + "|" + vector.Occurrence);
            }
        }

        [Test]
        public void TakeChoice_IsPureAndInRange()
        {
            for (var count = 1; count <= 5; count++)
            {
                for (var index = 0; index < 50; index++)
                {
                    var key = "seed-" + index + "#0." + (index % 6);
                    var take = ProductionRecordedTakes.TakeIndex(key, "middle", index % 3, count);
                    Assert.That(take, Is.EqualTo(ProductionRecordedTakes.TakeIndex(key, "middle", index % 3, count)));
                    Assert.That(take, Is.InRange(0, count - 1));
                }
            }
            Assert.That(ProductionRecordedTakes.TakeIndex("anything", "middle", 0, 1), Is.Zero);
            Assert.That(ProductionRecordedTakes.TakeIndex("anything", "middle", 0, 0), Is.Zero);
            var unit = ProductionRecordedTakes.TakeUnit("k", "crowd:applause", 0);
            Assert.That(unit, Is.EqualTo(ProductionRecordedTakes.TakeUnit("k", "crowd:applause", 0)));
            Assert.That(unit, Is.GreaterThanOrEqualTo(0.0).And.LessThan(1.0));
        }

        [Test]
        public void TakeChoice_SpreadsOverEveryTake()
        {
            var counts = new int[5];
            for (var ball = 0; ball < 600; ball++)
            {
                var key = ProductionRecordedTakes.DeliveryTakeKey("s" + (ball >> 3), ball >> 3, ball & 7);
                counts[ProductionRecordedTakes.TakeIndex(key, "middle", 0, 5)]++;
            }
            foreach (var count in counts) Assert.That(count, Is.GreaterThan(80));
        }

        [Test]
        public void FindOnset_IsTheFirstSampleAtATenthOfThePeak_WhateverLeadsIt()
        {
            var data = new float[4800];
            for (var index = 0; index < 300; index++) data[index] = (float)(0.004 * Math.Sin(index));
            data[336] = 0.05f;
            data[337] = -0.9f;
            data[338] = 0.7f;
            Assert.That(ProductionRecordedTakes.FindOnset(data), Is.EqualTo(337));
            Assert.That(ProductionRecordedTakes.FindOnset(new float[10]), Is.Zero);
            Assert.That(ProductionRecordedTakes.OnsetRatio, Is.EqualTo(0.1));
            Assert.That(ProductionRecordedTakes.ContactPrerollSeconds, Is.EqualTo(0.003));

            var stereo = new float[9600];
            for (var frame = 0; frame < 4800; frame++)
            {
                stereo[frame * 2] = data[frame];
                stereo[frame * 2 + 1] = frame == 10 ? 1f : 0f;
            }
            Assert.That(ProductionRecordedTakes.FindOnset(stereo, 4800, 2, 0), Is.EqualTo(337),
                "channel 0 only, as the web reads getChannelData(0)");
        }

        [Test]
        public void AlignedStart_PutsTheOnsetOnTheEventTime_CalledAheadOrLate_AtAnyRate()
        {
            foreach (var vector in AlignVectors)
            {
                var aligned = ProductionRecordedTakes.AlignedStart(
                    vector.When, vector.Onset, vector.Preroll, vector.Now, vector.Rate);
                Assert.That(aligned.Start, Is.EqualTo(vector.Start).Within(1e-12));
                Assert.That(aligned.Offset, Is.EqualTo(vector.Offset).Within(1e-12));
                Assert.That(aligned.Start, Is.GreaterThanOrEqualTo(vector.Now));
                Assert.That(aligned.Start + (vector.Onset - aligned.Offset) / vector.Rate,
                    Is.EqualTo(vector.When).Within(1e-9), "the onset lands on the event time");
            }
        }

        [Test]
        public void Manifest_IsTheTypeScriptManifest_AndEveryTakeIsTheRegisteredFileInBothCopies()
        {
            var typeScript = File.ReadAllText(Path.Combine(RepositoryRoot, "src/audio/recordedManifest.ts"));
            var tsKinds = Regex.Matches(typeScript, @"contact\('([a-z_]+)', (\d+)")
                .Cast<Match>().Select(match => match.Groups[1].Value + "/" + match.Groups[2].Value).ToList();
            tsKinds.Add("crowd:applause/12");
            var csKinds = ProductionRecordedManifest.Kinds.Select(kind => kind.Key + "/" + kind.Inventory).ToList();
            Assert.That(csKinds, Is.EqualTo(tsKinds), "the same kinds, in the same (priority) order");

            var tsTakes = Regex.Matches(typeScript,
                    @"id: '([^']+)', file: '([^']+)', bytes: (\d+), sha256: '([0-9a-f]{64})', register: '([^']+)', " +
                    @"lufs: (null|[-0-9.]+), peakDbfs: ([-0-9.]+), durationMs: (\d+)")
                .Cast<Match>().Select(match => string.Join("|", Enumerable.Range(1, 8)
                    .Select(group => match.Groups[group].Value))).ToList();
            var csTakes = ProductionRecordedManifest.Kinds.SelectMany(kind => kind.Takes)
                .Select(take => string.Join("|", take.Id, take.File, take.Bytes, take.Sha256, take.Register,
                    Number(take.Lufs), Number(take.PeakDbfs), take.DurationMs)).ToList();
            Assert.That(csTakes, Is.EqualTo(tsTakes));
            Assert.That(csTakes.Count, Is.EqualTo(tsTakes.Count));
            Assert.That(ProductionRecordedManifest.Find("crowd:applause").Takes.Count, Is.EqualTo(4));

            // The generated contact block (scripts/audio/lib/manifest.mjs): the same sounds, placeholder flags and
            // honest labels as the TypeScript CONTACT_TAKES.
            var tsSetMatches = Regex.Matches(typeScript.Replace("\r\n", "\n"),
                    @"^  ([a-z_]+): \{\n    placeholder: (true|false),\n    honest: '((?:[^'\\]|\\.)*)',",
                    RegexOptions.Multiline)
                .Cast<Match>().ToList();
            var tsSets = tsSetMatches.ToDictionary(match => match.Groups[1].Value,
                match => new KeyValuePair<bool, string>(match.Groups[2].Value == "true",
                    match.Groups[3].Value.Replace("\\'", "'").Replace("\\\\", "\\")));
            foreach (var kind in ProductionRecordedManifest.Kinds.Where(kind => kind.Align == ProductionRecordedAlign.Onset))
            {
                KeyValuePair<bool, string> set;
                if (!tsSets.TryGetValue(kind.Key, out set))
                {
                    Assert.That(kind.Takes.Count, Is.Zero, kind.Key);
                    Assert.That(kind.IsPlaceholder, Is.False, kind.Key);
                    continue;
                }
                Assert.That(kind.IsPlaceholder, Is.EqualTo(set.Key), kind.Key + ": the same placeholder flag");
                Assert.That(kind.Honest, Does.StartWith(set.Value), kind.Key + ": the same honest label");
            }
            Assert.That(ProductionRecordedManifest.Kinds.Where(kind => kind.Align == ProductionRecordedAlign.Onset &&
                kind.Takes.Count > 0).Select(kind => kind.Key).ToList(),
                Is.EqualTo(tsSetMatches.Select(match => match.Groups[1].Value).ToList()), "in the same order");

            var web = Path.Combine(RepositoryRoot, "public/audio/cricket");
            var unity = Path.Combine(Application.dataPath, "VandePractice/Runtime/Audio/Resources/Audio/Cricket");
            foreach (var take in ProductionRecordedManifest.Kinds.SelectMany(kind => kind.Takes))
            {
                foreach (var folder in new[] { web, unity })
                {
                    var bytes = File.ReadAllBytes(Path.Combine(folder, take.File));
                    Assert.That(bytes.LongLength, Is.EqualTo(take.Bytes), folder + "/" + take.File);
                    Assert.That(Sha256(bytes), Is.EqualTo(take.Sha256), folder + "/" + take.File);
                }
                Assert.That(take.Register, Does.Match(@"^TC-\d{2}-(\d{2}|P\d{2})$"));
            }
            var unityFiles = Directory.GetFiles(unity).Select(Path.GetFileName)
                .Where(name => !name.EndsWith(".meta", StringComparison.Ordinal)).OrderBy(name => name).ToArray();
            Assert.That(unityFiles, Is.EqualTo(ProductionRecordedManifest.Kinds.SelectMany(kind => kind.Takes)
                .Select(take => take.File).OrderBy(name => name).ToArray()), "nothing unregistered ships");

            foreach (var kind in ProductionRecordedManifest.Kinds)
            {
                if (kind.Takes.Count == 0)
                    Assert.That(kind.Honest, Does.Contain("synthesised voice plays (not a recording)"));
                else if (kind.IsPlaceholder)
                {
                    // Placeholders are original synthesis and say so; nothing presents them as recordings.
                    Assert.That(kind.Honest, Does.StartWith("Placeholder: original synthesised"));
                    Assert.That(kind.Honest, Does.Contain("not a recording; replace with a recording."));
                    Assert.That(kind.Takes.Count, Is.InRange(2, 5), kind.Key);
                    foreach (var take in kind.Takes)
                    {
                        Assert.That(take.File, Does.Match("^ph-" + kind.Key + @"-\d+\.mp3$"));
                        Assert.That(take.Register, Does.Match("^TC-" + kind.Inventory.ToString("00") + @"-P\d{2}$"));
                        Assert.That(take.PeakDbfs, Is.LessThanOrEqualTo(20.0 * Math.Log10(0.95)), take.File);
                    }
                }
                else
                {
                    Assert.That(kind.Honest, Does.Not.Contain("Placeholder"));
                    foreach (var take in kind.Takes)
                    {
                        Assert.That(take.File, Does.Not.StartWith("ph-"));
                        Assert.That(take.Register, Does.Match(@"^TC-\d{2}-\d{2}$"));
                    }
                    if (kind.Key == "crowd:applause") Assert.That(kind.Honest, Does.Contain("not from a cricket ground"));
                }
            }
        }

        [Test]
        public void Bank_LoadsEveryApplauseTakeMonoAtTheWebsCrowdRate()
        {
            var bank = new ProductionRecordedTakeBank();
            bank.Configure();
            try
            {
                Assert.That(bank.LoadedFor("crowd:applause"), Is.EqualTo(4));
                Assert.That(bank.FailedTakeCount, Is.Zero);
                var seen = new HashSet<string>();
                for (var ball = 0; ball < 24; ball++)
                {
                    var take = bank.Pick("crowd:applause",
                        ProductionRecordedTakes.DeliveryTakeKey("over-b", ball >> 2, ball & 3), 0);
                    Assert.That(take, Is.Not.Null);
                    Assert.That(take.Clip.frequency, Is.EqualTo(24000), "held at 24 kHz as recorded.ts holds it");
                    Assert.That(take.Clip.channels, Is.EqualTo(1));
                    Assert.That(take.Clip.length, Is.EqualTo(2.5f).Within(0.06f));
                    Assert.That(take.OnsetSeconds, Is.Zero, "crowd layers start on the event, not on an onset");
                    var samples = new float[take.Clip.samples];
                    Assert.That(take.Clip.GetData(samples, 0), Is.True);
                    var peak = samples.Max(value => Math.Abs(value));
                    // Re-encoding (Vorbis) and holding at 24 kHz move a sample peak by about a decibel; the importer's
                    // peak normalisation would lift every take to 0 dBFS (2.5–6.8 dB here), which this rules out.
                    Assert.That(20.0 * Math.Log10(peak), Is.EqualTo(take.Take.PeakDbfs).Within(1.5),
                        "imported without peak normalisation: the register's loudness calibration survives");
                    seen.Add(take.Take.Id);
                }
                Assert.That(seen.Count, Is.EqualTo(4), "every take gets used");
                var tock = bank.Pick("middle", "k", 0);
                Assert.That(tock, Is.Not.Null, "the tock plays a take: a placeholder until recordings replace it");
                Assert.That(tock.Take.File, Does.StartWith(MiddlePrefix()));
                bank.Enabled = false;
                Assert.That(bank.Pick("crowd:applause", "k", 0), Is.Null, "switched off: the synthesised voice");
                Assert.That(bank.Pick("middle", "k", 0), Is.Null, "switched off: the synthesised voice");
            }
            finally
            {
                bank.ReleasePreparedResources();
            }
        }

        [Test]
        public void Bank_LoadsEveryContactTake_MonoAtItsOwnRate_WithItsOnsetFoundAfterThePreroll()
        {
            var bank = new ProductionRecordedTakeBank();
            bank.Configure();
            try
            {
                Assert.That(bank.FailedTakeCount, Is.Zero);
                // Every contact kind with takes: the placeholders, and any recordings that have replaced them.
                var contacts = ProductionRecordedManifest.Kinds
                    .Where(kind => kind.Align == ProductionRecordedAlign.Onset && kind.Takes.Count > 0).ToList();
                Assert.That(contacts, Is.Not.Empty);
                foreach (var kind in contacts)
                {
                    Assert.That(bank.LoadedFor(kind.Key), Is.EqualTo(kind.Takes.Count), kind.Key);
                    var seen = new HashSet<string>();
                    for (var ball = 0; ball < 48; ball++)
                    {
                        var take = bank.Pick(kind.Key,
                            ProductionRecordedTakes.DeliveryTakeKey("over-ph", ball >> 3, ball & 7), 0);
                        Assert.That(take, Is.Not.Null, kind.Key);
                        seen.Add(take.Take.Id);
                    }
                    Assert.That(seen.Count, Is.EqualTo(kind.Takes.Count), kind.Key + ": every take gets used");
                    foreach (var candidate in kind.Takes)
                    {
                        var take = FindLoaded(bank, kind, candidate.Id);
                        Assert.That(take, Is.Not.Null, candidate.File);
                        Assert.That(take.Clip.frequency, Is.EqualTo(48000), candidate.File + ": its own rate");
                        Assert.That(take.Clip.channels, Is.EqualTo(1));
                        Assert.That(take.Clip.length, Is.EqualTo(candidate.DurationMs / 1000f).Within(0.06f));
                        Assert.That(take.OnsetMeasured, Is.True);
                        // The transient sits 3 ms into the file; a decoder's own lead-in may add to that.
                        Assert.That(take.OnsetSeconds, Is.InRange(0.002, 0.035), candidate.File);
                        var samples = new float[take.Clip.samples];
                        Assert.That(take.Clip.GetData(samples, 0), Is.True);
                        var peak = samples.Max(value => Math.Abs(value));
                        Assert.That(20.0 * Math.Log10(peak), Is.EqualTo(candidate.PeakDbfs).Within(1.5),
                            candidate.File + ": imported without peak normalisation");
                    }
                }
            }
            finally
            {
                bank.ReleasePreparedResources();
            }
        }

        /// <summary>The tock's take names: ph-middle-N while placeholders, middle-N once recordings replace them.</summary>
        private static string MiddlePrefix()
        {
            var middle = ProductionRecordedManifest.Find("middle");
            Assert.That(middle.Takes.Count, Is.GreaterThan(0), "the tock has takes");
            return middle.IsPlaceholder ? "ph-middle-" : "middle-";
        }

        private static ProductionLoadedTake FindLoaded(ProductionRecordedTakeBank bank, ProductionRecordedKind kind,
            string id)
        {
            for (var ball = 0; ball < 512; ball++)
            {
                var take = bank.Pick(kind.Key, ProductionRecordedTakes.DeliveryTakeKey("find", ball >> 3, ball & 7), 0);
                if (take != null && take.Take.Id == id) return take;
            }
            return null;
        }

        [Test]
        public void SoundKeys_AreTheWebsSoundIds()
        {
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.BatMiddle, "middle", "perfect", null),
                Is.EqualTo("sweet"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.BatMiddle, "middle", "solid", null),
                Is.EqualTo("middle"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.BatMiddle, "middle", "mistimed", null),
                Is.EqualTo("mistimed"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.Edge, "inside_edge", null, null),
                Is.EqualTo("edge_thick"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.Nick, "outside_edge", null, null),
                Is.EqualTo("edge_thin"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.Edge, "top_edge", null, null),
                Is.EqualTo("top_edge"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.Pitch, null, null, "green"),
                Is.EqualTo("bounce_green"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.KeeperTake, null, null, null),
                Is.EqualTo("gloves"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.CrowdRun, null, null, null),
                Is.EqualTo("crowd:applause"));
            Assert.That(ProductionRecordedManifest.SoundKey(ProductionFeedbackCue.FieldPickup, null, null, null),
                Is.EqualTo("unity:field_pickup"));
        }

        // ---- the sink -------------------------------------------------------------------------------------------

        private GameObject root;
        private ProductionPracticeFeedbackSink sink;
        private double dsp;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("ProductionRecordedTakesTests");
            sink = root.AddComponent<ProductionPracticeFeedbackSink>();
            dsp = 100.0;
            sink.SetClocksForTesting(() => dsp, 0.02, () => dsp);
        }

        [TearDown]
        public void TearDown()
        {
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
        }

        [Test]
        public void ExactRetry_HearsTheSameTakes_OtherBallsVary_AndAFreshSinkAgrees()
        {
            sink.Configure(true, false, false);
            var first = RunsTake(sink, "over-7f3a", 0, 3);
            Assert.That(first, Does.StartWith("rec:applause-"));
            RunsTake(sink, "over-7f3a", 0, 4);
            Assert.That(RunsTake(sink, "over-7f3a", 0, 3), Is.EqualTo(first), "the retry, after another ball");

            var seen = new HashSet<string>();
            for (var ball = 0; ball < 24; ball++) seen.Add(RunsTake(sink, "over-b", ball >> 2, ball & 3));
            Assert.That(seen.Count, Is.EqualTo(4), "across balls every take gets used");

            var freshRoot = new GameObject("fresh sink");
            try
            {
                var fresh = freshRoot.AddComponent<ProductionPracticeFeedbackSink>();
                fresh.SetClocksForTesting(() => dsp, 0.02, () => dsp);
                fresh.Configure(true, false, false);
                Assert.That(RunsTake(fresh, "over-7f3a", 0, 3), Is.EqualTo(first), "a fresh session");
                var expected = ProductionRecordedManifest.Find("crowd:applause").Takes[
                    ProductionRecordedTakes.TakeIndex("over-7f3a#0.3", "crowd:applause", 0, 4)].Id;
                Assert.That(first, Is.EqualTo("rec:" + expected), "the web's takeIndex() choice");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(freshRoot);
            }
        }

        [Test]
        public void Muting_NeverShiftsALaterChoice_UsesAreCountedWhileSilent()
        {
            sink.Configure(true, false, false);
            Deliver(sink, "over-m", 1, 0);
            sink.Handle(Feedback(PracticeFeedbackKind.Run, 1.4));
            sink.StopAll();
            sink.BeginTakeDelivery("over-m", 1, 0, "balanced");
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            sink.Handle(Feedback(PracticeFeedbackKind.Run, 1.4));
            dsp += 1.0;
            sink.Handle(Feedback(PracticeFeedbackKind.Run, 2.4));
            var reference = sink.RecentScheduledSound(0);
            Assert.That(reference.Occurrence, Is.EqualTo(1));

            sink.StopAll();
            sink.BeginTakeDelivery("over-m", 1, 0, "balanced");
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            sink.Configure(false, false, false);
            var before = sink.ScheduledSoundCount;
            sink.Handle(Feedback(PracticeFeedbackKind.Run, 1.4));
            Assert.That(sink.ScheduledSoundCount, Is.EqualTo(before), "muted: nothing heard");
            sink.Configure(true, false, false);
            dsp += 1.0;
            sink.Handle(Feedback(PracticeFeedbackKind.Run, 2.4));
            var after = sink.RecentScheduledSound(0);
            Assert.That(after.Occurrence, Is.EqualTo(1), "the muted use was counted");
            Assert.That(after.Detail, Is.EqualTo(reference.Detail));
        }

        [Test]
        public void Coh6_HandedOverAhead_TheSoundIsHeardAtThePhysicsTime_AndCaptionsWaitForTheCrossing()
        {
            // Recordings off: the synthesised voice, exactly as before the placeholders.
            Coh6HandedOverAhead(false, detail => Assert.That(detail, Is.EqualTo("synth"),
                "the synthesised voice is labelled"));
        }

        [Test]
        public void Coh6_HandedOverAhead_APlaceholderTakeIsHeardAtThePhysicsTime_OnItsOwnOnset()
        {
            Coh6HandedOverAhead(true, detail => Assert.That(detail, Does.StartWith("rec:" + MiddlePrefix()),
                "the tock's take (a placeholder until recordings replace it), aligned on its own onset"));
        }

        private void Coh6HandedOverAhead(bool recordedOn, Action<string> detail)
        {
            var captions = new CountingCaptions();
            sink.SetOutputs(null, captions);
            sink.Configure(true, false, true);
            sink.SetRecordedSounds(recordedOn);
            sink.BeginTakeDelivery("over-a", 0, 2, "balanced");
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            var captionsBefore = captions.Count;
            var scheduledBefore = sink.ScheduledAudioCueCount;

            var contact = Feedback(PracticeFeedbackKind.BatContact, 0.612, "middle");
            Assert.That(sink.HandleAhead(contact, 0.06), Is.True);
            var sound = sink.RecentScheduledSound(0);
            Assert.That(sound.Cue, Is.EqualTo(ProductionFeedbackCue.BatMiddle));
            Assert.That(sound.SoundKey, Is.EqualTo("middle"));
            detail(sound.Detail);
            Assert.That(sound.IntendedOnsetDsp, Is.EqualTo(100.0 + 0.06 - 0.02).Within(1e-9),
                "the physics time on the DSP clock, less the output latency");
            Assert.That(sound.HeardOnsetDsp, Is.EqualTo(sound.IntendedOnsetDsp).Within(0.001), "COH6: within 1 ms");
            Assert.That(sound.LateSeconds, Is.LessThan(0.001));
            Assert.That(captions.Count, Is.EqualTo(captionsBefore), "no caption before the crossing frame");

            dsp += 0.06;
            sink.Handle(contact);
            Assert.That(captions.Count, Is.EqualTo(captionsBefore + 1), "the caption on the crossing frame");
            Assert.That(sink.ScheduledAudioCueCount, Is.EqualTo(scheduledBefore + 1), "the sound is scheduled once");
            Assert.That(sink.PendingAheadCount, Is.Zero);
        }

        [Test]
        public void ArrivingOnItsCrossingFrame_TheSoundPlaysAsSoonAsPossible_NeverEarly()
        {
            sink.Configure(true, false, false);
            sink.SetRecordedSounds(false);
            sink.BeginTakeDelivery("over-a", 0, 2, "balanced");
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            sink.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.612, "middle"));
            var sound = sink.RecentScheduledSound(0);
            Assert.That(sound.Detail, Is.EqualTo("synth"));
            Assert.That(sound.StartDsp, Is.EqualTo(dsp + ProductionPracticeFeedbackSink.SoonestSeconds).Within(1e-9));
            Assert.That(sound.OffsetSeconds, Is.Zero, "the transient is never skipped");
            Assert.That(sound.LateSeconds, Is.EqualTo(0.02 + ProductionPracticeFeedbackSink.SoonestSeconds)
                .Within(1e-9), "late only by the output latency and the soonest start");
        }

        [Test]
        public void ArrivingOnItsCrossingFrame_APlaceholderTakesOnsetIsHeardAsSoonAsPossible_NeverEarly_NeverSkipped()
        {
            sink.Configure(true, false, false);
            sink.BeginTakeDelivery("over-a", 0, 2, "balanced");
            sink.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            sink.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.612, "middle"));
            var sound = sink.RecentScheduledSound(0);
            Assert.That(sound.Detail, Does.StartWith("rec:" + MiddlePrefix()));
            Assert.That(sound.StartDsp, Is.GreaterThanOrEqualTo(dsp), "never scheduled in the past");
            Assert.That(sound.HeardOnsetDsp, Is.EqualTo(dsp + ProductionPracticeFeedbackSink.SoonestSeconds)
                .Within(1e-9), "the onset as soon as possible, never early");
            Assert.That(sound.HeardOnsetDsp - sound.StartDsp, Is.GreaterThan(0.0),
                "only the lead-in before the transient is skipped, never the transient");
            Assert.That(sound.LateSeconds, Is.EqualTo(0.02 + ProductionPracticeFeedbackSink.SoonestSeconds)
                .Within(1e-9), "late only by the output latency and the soonest start");
        }

        [Test]
        public void RecordedTakesSwitchedOff_TheSynthesisedVoicePlays()
        {
            sink.Configure(true, false, false);
            sink.SetRecordedSounds(false);
            Assert.That(RunsTake(sink, "over-p", 0, 0), Is.EqualTo("synth"));
            sink.SetRecordedSounds(true);
            Assert.That(RunsTake(sink, "over-p", 0, 0), Does.StartWith("rec:applause-"));
        }

        private string RunsTake(ProductionPracticeFeedbackSink target, string seed, int over, int ball)
        {
            target.StopAll();
            Deliver(target, seed, over, ball);
            target.Handle(Feedback(PracticeFeedbackKind.Run, 1.4));
            var sound = target.RecentScheduledSound(0);
            Assert.That(sound.Cue, Is.EqualTo(ProductionFeedbackCue.CrowdRun));
            Assert.That(sound.SoundKey, Is.EqualTo("crowd:applause"));
            return sound.Detail;
        }

        private static void Deliver(ProductionPracticeFeedbackSink target, string seed, int over, int ball)
        {
            target.BeginTakeDelivery(seed, over, ball, "balanced");
            target.Handle(Feedback(PracticeFeedbackKind.Release, 0.0));
            target.Handle(Feedback(PracticeFeedbackKind.BatContact, 0.6, "middle"));
        }

        private static PracticeFeedbackEvent Feedback(PracticeFeedbackKind kind, double time, string contact = null)
        {
            return new PracticeFeedbackEvent(kind, time, contact, kind == PracticeFeedbackKind.Run ? 1 : 0, null);
        }

        private static string Number(double value)
        {
            // JavaScript's shortest round-trip form, as written in recordedManifest.ts (-21.0 is written -21.0 there).
            // A take with no 400 ms block has no integrated loudness: null there, NaN here.
            if (double.IsNaN(value)) return "null";
            var text = value.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            return text.Contains(".") ? text : text + ".0";
        }

        private static string Sha256(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return string.Concat(sha.ComputeHash(bytes).Select(value => value.ToString("x2")));
        }

        private sealed class CountingCaptions : IProductionCaptionOutput
        {
            public int Count;
            public void Present(ProductionCaptionCue cue) { Count++; }
            public void Clear() { }
        }

        private readonly struct FnvVector
        {
            public FnvVector(string value, uint hash) { Value = value; Hash = hash; }
            public string Value { get; }
            public uint Hash { get; }
        }

        private readonly struct IndexVector
        {
            public IndexVector(string key, string sound, int occurrence, int count, int index)
            {
                Key = key; Sound = sound; Occurrence = occurrence; Count = count; Index = index;
            }
            public string Key { get; }
            public string Sound { get; }
            public int Occurrence { get; }
            public int Count { get; }
            public int Index { get; }
        }

        private readonly struct UnitVector
        {
            public UnitVector(string key, string sound, int occurrence, double unit)
            {
                Key = key; Sound = sound; Occurrence = occurrence; Unit = unit;
            }
            public string Key { get; }
            public string Sound { get; }
            public int Occurrence { get; }
            public double Unit { get; }
        }

        private readonly struct AlignVector
        {
            public AlignVector(double when, double onset, double preroll, double now, double rate, double start,
                double offset)
            {
                When = when; Onset = onset; Preroll = preroll; Now = now; Rate = rate; Start = start; Offset = offset;
            }
            public double When { get; }
            public double Onset { get; }
            public double Preroll { get; }
            public double Now { get; }
            public double Rate { get; }
            public double Start { get; }
            public double Offset { get; }
        }
    }
}
