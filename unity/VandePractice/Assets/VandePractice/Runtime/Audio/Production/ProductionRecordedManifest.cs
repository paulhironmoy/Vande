using System;
using System.Collections.Generic;

namespace Vande.Practice.Audio.Production
{
    public enum ProductionRecordedAlign
    {
        /// <summary>The transient lands on the event's time (COH6).</summary>
        Onset,
        /// <summary>The buffer starts on the event's time (crowd reactions).</summary>
        Start
    }

    public sealed class ProductionRecordedTake
    {
        internal ProductionRecordedTake(string id, string file, long bytes, string sha256, string register,
            double lufs, double peakDbfs, int durationMs)
        {
            Id = id;
            File = file;
            Bytes = bytes;
            Sha256 = sha256;
            Register = register;
            Lufs = lufs;
            PeakDbfs = peakDbfs;
            DurationMs = durationMs;
        }

        /// <summary>Also the file's base name, and the Unity Resources name under Audio/Cricket.</summary>
        public string Id { get; }
        /// <summary>Under public/audio/cricket/ (the web) and Resources/Audio/Cricket/ (Unity), byte-identical.</summary>
        public string File { get; }
        public long Bytes { get; }
        public string Sha256 { get; }
        /// <summary>The row of release/product-sequence/stage-1-practice/wedge/sound/REGISTER.md.</summary>
        public string Register { get; }
        /// <summary>Integrated loudness (ITU-R BS.1770) of the decoded file, as measured by process_takes.py.</summary>
        public double Lufs { get; }
        public double PeakDbfs { get; }
        public int DurationMs { get; }
    }

    public sealed class ProductionRecordedKind
    {
        internal ProductionRecordedKind(
            string key,
            int inventory,
            string honest,
            ProductionRecordedAlign align,
            double prerollSeconds,
            int maxRate,
            ProductionRecordedTake[] takes,
            bool isPlaceholder = false)
        {
            Key = key;
            Inventory = inventory;
            Honest = honest;
            Align = align;
            PrerollSeconds = prerollSeconds;
            MaxRate = maxRate;
            Takes = takes ?? Array.Empty<ProductionRecordedTake>();
            IsPlaceholder = isPlaceholder && Takes.Count > 0;
        }

        /// <summary>The web's sound id (FxId) or "crowd:{reaction}": the same string in the take key on both renderers.</summary>
        public string Key { get; }
        /// <summary>Wedge §7.2 inventory item, 1 (the middled tock) … 14 (fielder calls).</summary>
        public int Inventory { get; }
        /// <summary>What the takes are, and what they are not.</summary>
        public string Honest { get; }
        public ProductionRecordedAlign Align { get; }
        public double PrerollSeconds { get; }
        /// <summary>Decoded takes above this rate are held at it (crowd layers); 0 for none.</summary>
        public int MaxRate { get; }
        public IReadOnlyList<ProductionRecordedTake> Takes { get; }
        /// <summary>The takes are original synthesised placeholders (scripts/audio/placeholders.mjs), not recordings.</summary>
        public bool IsPlaceholder { get; }
    }

    /// <summary>One contact sound's takes, as src/audio/recordedManifest.ts CONTACT_TAKES holds them.</summary>
    internal sealed class ProductionContactTakeSet
    {
        internal ProductionContactTakeSet(bool placeholder, string honest, ProductionRecordedTake[] takes)
        {
            Placeholder = placeholder;
            Honest = honest;
            Takes = takes;
        }

        public bool Placeholder { get; }
        public string Honest { get; }
        public ProductionRecordedTake[] Takes { get; }
    }

    /// <summary>
    /// The C# port of src/audio/recordedManifest.ts: the licensed takes Unity plays, from the same files as the web
    /// (public/audio/cricket/, copied byte for byte to Resources/Audio/Cricket/; ProductionRecordedTakesTests checks
    /// both copies and this list against the TypeScript manifest). A kind with no takes plays its synthesised voice,
    /// which is never described as a recording.
    /// </summary>
    public static class ProductionRecordedManifest
    {
        public const string ResourceFolder = "Audio/Cricket";
        public const string SynthOnly =
            "No licensed recording yet: the original synthesised voice plays (not a recording).";

        // Each contact sound's takes, written by scripts/audio/ (placeholders.mjs, ingest-recordings.mjs) from the same
        // data as the TypeScript block between the same markers. Declared before KindsValue: static initialisers run
        // in textual order.
        // <generated:contact-takes>
        private static readonly Dictionary<string, ProductionContactTakeSet> ContactTakes =
            new Dictionary<string, ProductionContactTakeSet>(StringComparer.Ordinal)
            {
                {
                    "sweet", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-sweet-1", "ph-sweet-1.mp3", 1776,
                                "9a9e90255db1d5d7e94c244cb724145425c0a71f44b459dbef22f0965214ef06", "TC-01-P01", double.NaN, -1.73, 154),
                            new ProductionRecordedTake("ph-sweet-2", "ph-sweet-2.mp3", 1728,
                                "8e2e8eebfc91aa7cbfdff30b7f8e95747165c5f3a972480ebee290c34db5a480", "TC-01-P02", double.NaN, -1.13, 134),
                            new ProductionRecordedTake("ph-sweet-3", "ph-sweet-3.mp3", 1824,
                                "f0d631de37681bd44a9860212223587b59ee7a57b7898ef7c21e2bc806747180", "TC-01-P03", double.NaN, -1.46, 164),
                        })
                },
                {
                    "middle", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-middle-1", "ph-middle-1.mp3", 1728,
                                "1969ed21dd9928980f0b3ee0423350d0d6f9ab176e66bb1a2f57be0e12cd7008", "TC-01-P04", double.NaN, -5.42, 163),
                            new ProductionRecordedTake("ph-middle-2", "ph-middle-2.mp3", 1656,
                                "28dec80c24257b375355e971dcda5899c19dccf0b8d60803d2138a7e82c4feff", "TC-01-P05", double.NaN, -4.15, 141),
                            new ProductionRecordedTake("ph-middle-3", "ph-middle-3.mp3", 1728,
                                "0b7629286363ed795473296392332edc65a1ab3259771ce5834f6029bf3b5af5", "TC-01-P06", double.NaN, -5.44, 158),
                        })
                },
                {
                    "mistimed", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-mistimed-1", "ph-mistimed-1.mp3", 2208,
                                "1cff1a6209c05bbb42c0c686d7b9dc3e5bda95ef7156683a5c531f64277c4f12", "TC-01-P07", double.NaN, -11.02, 291),
                            new ProductionRecordedTake("ph-mistimed-2", "ph-mistimed-2.mp3", 2064,
                                "909ac0c9fa5d31f34f5b0cd5583cd4b57a7d634709deea412cf85c6ba8eb8a7b", "TC-01-P08", double.NaN, -11.45, 250),
                            new ProductionRecordedTake("ph-mistimed-3", "ph-mistimed-3.mp3", 2160,
                                "285f4ea1bf0917afe0b491ed1ec3fab6df16c1cd526e7173bdcd0d65b227b0ae", "TC-01-P09", double.NaN, -11.7, 273),
                        })
                },
                {
                    "edge_thick", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-edge_thick-1", "ph-edge_thick-1.mp3", 1512,
                                "e62b6a0a5b9ee7e65b5cb279a0fe57a78e54be85cfc7fa9f525f0273a91520fb", "TC-02-P01", double.NaN, -8.64, 84),
                            new ProductionRecordedTake("ph-edge_thick-2", "ph-edge_thick-2.mp3", 1512,
                                "cd9aa7eb4b919a2dd09bcd1c51817326b660e990802d9720628c59e16b77ddc4", "TC-02-P02", double.NaN, -7.53, 79),
                            new ProductionRecordedTake("ph-edge_thick-3", "ph-edge_thick-3.mp3", 1416,
                                "f90a2c5b326ce2949745ddab4213d0a5da5e7a583006871c4765c1b268598b99", "TC-02-P03", double.NaN, -5.43, 65),
                        })
                },
                {
                    "edge_thin", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-edge_thin-1", "ph-edge_thin-1.mp3", 1176,
                                "7a3734725ebd469aa43c748f36e029deb5c159d7bc7bcce4bf973599295c009f", "TC-03-P01", double.NaN, -2.73, 30),
                            new ProductionRecordedTake("ph-edge_thin-2", "ph-edge_thin-2.mp3", 1176,
                                "e56a8be4dc5d66dc5de5763b5eb4a1d137cf86b46ce8346d590a2c24554a0dd8", "TC-03-P02", double.NaN, -3.08, 30),
                            new ProductionRecordedTake("ph-edge_thin-3", "ph-edge_thin-3.mp3", 1152,
                                "5883a47416e9210ec0aa4d98eb6b9a59825eee5ed46b2a6900113fc95a2220f0", "TC-03-P03", double.NaN, -2.69, 30),
                        })
                },
                {
                    "top_edge", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-top_edge-1", "ph-top_edge-1.mp3", 1680,
                                "20da4653518fa8d693d520d236be5bca145590b2e4449bf6f4fe5955f32ad07a", "TC-04-P01", double.NaN, -14.07, 166),
                            new ProductionRecordedTake("ph-top_edge-2", "ph-top_edge-2.mp3", 1560,
                                "2b66464344d4f836eca40e10ecaa3949089bb7dc25f233fb3e8760b78ebad108", "TC-04-P02", double.NaN, -12.25, 143),
                            new ProductionRecordedTake("ph-top_edge-3", "ph-top_edge-3.mp3", 1728,
                                "1d5fe02afd878959603d0998184821e52847a2b33d524e12f2875dc5f4e205d9", "TC-04-P03", double.NaN, -13.52, 184),
                        })
                },
                {
                    "block", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-block-1", "ph-block-1.mp3", 1392,
                                "7a7c46ac45ee8bbd88130159ae9677f5df382f37e1acce0e88ea8f1cd9269141", "TC-05-P01", double.NaN, -10.91, 95),
                            new ProductionRecordedTake("ph-block-2", "ph-block-2.mp3", 1488,
                                "fdfa4f8fa1b5418302eb796020f0efc6d2a196b716190683f54f4e20e6edfa69", "TC-05-P02", double.NaN, -10.83, 100),
                            new ProductionRecordedTake("ph-block-3", "ph-block-3.mp3", 1392,
                                "a0a98b0f0524d23348908714ef1cf45075446762a5545dbc50378c41af29b27c", "TC-05-P03", double.NaN, -12.03, 88),
                        })
                },
                {
                    "pad", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-pad-1", "ph-pad-1.mp3", 1608,
                                "7e8e31c8316bac9e04713ce1fad1c6d5d7d77a0c38dab26f5c7bae6eee07fea9", "TC-06-P01", double.NaN, -8.55, 98),
                            new ProductionRecordedTake("ph-pad-2", "ph-pad-2.mp3", 1512,
                                "6becf170900b7ae31afb8b854ed805a8097f334f72dd4583823d7acc51fbeed1", "TC-06-P02", double.NaN, -10.37, 88),
                            new ProductionRecordedTake("ph-pad-3", "ph-pad-3.mp3", 1584,
                                "311837ba2cdbe598f97ef6b811a8e6d486eb42ff44d4f2deea338dfa1bf24a42", "TC-06-P03", double.NaN, -10.6, 114),
                        })
                },
                {
                    "body", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-body-1", "ph-body-1.mp3", 1608,
                                "bd96979d71561fc355dc3958055ddff935bace30bcee4941fe48cfa4d3dda421", "TC-07-P01", double.NaN, -11.81, 111),
                            new ProductionRecordedTake("ph-body-2", "ph-body-2.mp3", 1608,
                                "2df388c123126380688393e4f81e1281212d400010188d19660ede417bd57695", "TC-07-P02", double.NaN, -12.67, 105),
                            new ProductionRecordedTake("ph-body-3", "ph-body-3.mp3", 1704,
                                "c49f67b3129425c8f87edf16d405543632b4ec43ccd0b56d3a10500c36cb02d5", "TC-07-P03", double.NaN, -11.34, 121),
                        })
                },
                {
                    "swish", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-swish-1", "ph-swish-1.mp3", 2064,
                                "05198543e3119ab183766ace0cb59e4a16833206fe53bbcf0f23f66a59fdd8c8", "TC-08-P01", double.NaN, -21.47, 140),
                            new ProductionRecordedTake("ph-swish-2", "ph-swish-2.mp3", 1824,
                                "ef1d17ba48aa40907d737654ddbaea02efb0b27137dddba6546cbfb6b51be0ff", "TC-08-P02", double.NaN, -22.18, 111),
                            new ProductionRecordedTake("ph-swish-3", "ph-swish-3.mp3", 2112,
                                "3221792d674e6d44eb5dae5af5952983d5c562fed6c8bb3bd1afe9aa14266570", "TC-08-P03", double.NaN, -22.5, 140),
                        })
                },
                {
                    "gloves", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-gloves-1", "ph-gloves-1.mp3", 1536,
                                "bb41b9efd07522fe361ebfa43c04d6d317306dc126ec58ed76bbec842c419178", "TC-08-P04", double.NaN, -11.17, 61),
                            new ProductionRecordedTake("ph-gloves-2", "ph-gloves-2.mp3", 1608,
                                "64d58001e00dcc7bfc6ff948c5517f7f6db72b804f637e9913210e122ea90379", "TC-08-P05", double.NaN, -10.64, 50),
                            new ProductionRecordedTake("ph-gloves-3", "ph-gloves-3.mp3", 1680,
                                "298df16a7c8a6fe373bbe1251315b826292242e0d9d091f535b84d9751bc8d2a", "TC-08-P06", double.NaN, -9.18, 57),
                        })
                },
                {
                    "bounce_hard", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-bounce_hard-1", "ph-bounce_hard-1.mp3", 1344,
                                "0ab454d54738e370d229f4838d96c79372adf5ddfffa6de6226c0946f15324fa", "TC-09-P01", double.NaN, -9.81, 68),
                            new ProductionRecordedTake("ph-bounce_hard-2", "ph-bounce_hard-2.mp3", 1320,
                                "b114ab9348e549077e2bad159c9f9f49ee5c50839830af13eda06981e646c34f", "TC-09-P02", double.NaN, -9.79, 68),
                            new ProductionRecordedTake("ph-bounce_hard-3", "ph-bounce_hard-3.mp3", 1416,
                                "0053970fbea5eb3eb0c49a30ac10bd56e218ffe3d198e3f5d6716435cd964554", "TC-09-P03", double.NaN, -10.02, 75),
                        })
                },
                {
                    "bounce", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-bounce-1", "ph-bounce-1.mp3", 1488,
                                "b7417ae0d6e134b4f605907cba08c42492c213a15e1e8b4b662284741cf57bd6", "TC-09-P04", double.NaN, -10.82, 97),
                            new ProductionRecordedTake("ph-bounce-2", "ph-bounce-2.mp3", 1512,
                                "3975ffae52330efb9debf9cc093a76e0ce0cdc7dea87fb34f62f4b626cd77d1b", "TC-09-P05", double.NaN, -11.08, 97),
                            new ProductionRecordedTake("ph-bounce-3", "ph-bounce-3.mp3", 1392,
                                "bf6c8155c1beb1a0a9a2f8ad371cc5e2ee444776cbbe8c7612d930e8f6a33258", "TC-09-P06", double.NaN, -9.35, 76),
                        })
                },
                {
                    "bounce_green", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-bounce_green-1", "ph-bounce_green-1.mp3", 1776,
                                "a918112a152fb266e1d53c5ccd5c5069c85158bf3a2692b20fb420e33ee73a0c", "TC-09-P07", double.NaN, -11.82, 137),
                            new ProductionRecordedTake("ph-bounce_green-2", "ph-bounce_green-2.mp3", 1728,
                                "ed302d87ff70f24569ae89df9910b32f0b83ccf136d0253c6e1a7f2bccf95c23", "TC-09-P08", double.NaN, -11.71, 136),
                            new ProductionRecordedTake("ph-bounce_green-3", "ph-bounce_green-3.mp3", 1680,
                                "2cbb862bfdf048231ae88c306ea864edcf9572d2c1ee885bcb671f798f2212c3", "TC-09-P09", double.NaN, -12.09, 115),
                        })
                },
                {
                    "bounce_turning", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-bounce_turning-1", "ph-bounce_turning-1.mp3", 1944,
                                "8e2c45fcfa08c7c16b25e8eb7d0427d5937a62a1ff186d92bc2f79378a2a89f6", "TC-09-P10", double.NaN, -10.44, 90),
                            new ProductionRecordedTake("ph-bounce_turning-2", "ph-bounce_turning-2.mp3", 2232,
                                "29748d2f80182b25371dee43d0125530d99d60ba8d4c0d4f9d3b16aec99c64ef", "TC-09-P11", double.NaN, -10.46, 115),
                            new ProductionRecordedTake("ph-bounce_turning-3", "ph-bounce_turning-3.mp3", 2376,
                                "69ddab0a17d50ea6f5145125f47336371e45933afa307f8d6f1cd66db9036124", "TC-09-P12", double.NaN, -10.87, 91),
                        })
                },
                {
                    "stumps", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-stumps-1", "ph-stumps-1.mp3", 2376,
                                "e97fd8aba4e4826755f0a1ff7be813d2d133cabc0a8c2879903a8e7c99ed1738", "TC-10-P01", double.NaN, -10.68, 325),
                            new ProductionRecordedTake("ph-stumps-2", "ph-stumps-2.mp3", 2232,
                                "49e5792963f9efa3dd61e840d9f9421a432f4241e054be34a77cba031ba1aa9d", "TC-10-P02", double.NaN, -10.26, 287),
                            new ProductionRecordedTake("ph-stumps-3", "ph-stumps-3.mp3", 2496,
                                "541a666001fa2303509f91abe10b386b6956f5e33c94e69ec0a8806fc39db90b", "TC-10-P03", double.NaN, -10.62, 342),
                        })
                },
                {
                    "bails", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-bails-1", "ph-bails-1.mp3", 2712,
                                "ea5d3c2c6d321e87ea1e4ee23e2b02b7728daf89240c9736e8377ff05d194c5e", "TC-10-P04", double.NaN, -17.39, 247),
                            new ProductionRecordedTake("ph-bails-2", "ph-bails-2.mp3", 2736,
                                "ef3fdec1dc68547ff6d969b4848a788aeb5bfc67f94fc1bc6ca86f56d1983541", "TC-10-P05", double.NaN, -18.58, 280),
                            new ProductionRecordedTake("ph-bails-3", "ph-bails-3.mp3", 2568,
                                "02b040a288c74eea90b795cb03f08d60245f02fbf69efe82682c02ae002f3719", "TC-10-P06", double.NaN, -17.54, 244),
                        })
                },
                {
                    "board", new ProductionContactTakeSet(true,
                        "Placeholder: original synthesised takes (impact and modal synthesis in VANDE code, scripts/audio/placeholders.mjs), not a recording; replace with a recording.",
                        new[]
                        {
                            new ProductionRecordedTake("ph-board-1", "ph-board-1.mp3", 1968,
                                "f98e4e6ba97378ba862b1d4a100b7f20cc6f4129a05e4efba020a2748e56e232", "TC-11-P01", double.NaN, -10.51, 235),
                            new ProductionRecordedTake("ph-board-2", "ph-board-2.mp3", 1872,
                                "e1d1c4e1a6a5a6faa600477991ea3a76f3b985476e0e22e55ba01e8856fef852", "TC-11-P02", double.NaN, -10.52, 203),
                            new ProductionRecordedTake("ph-board-3", "ph-board-3.mp3", 1968,
                                "7f6e466ad2304525a18c9b5f1a2b83e98bf0ef21bd154a8c685e69f437bf4448", "TC-11-P03", double.NaN, -9.87, 232),
                        })
                },
            };
        // </generated:contact-takes>

        private static readonly ProductionRecordedKind[] KindsValue =
        {
            Contact("sweet", 1),
            Contact("middle", 1),
            Contact("mistimed", 1),
            Contact("edge_thick", 2),
            Contact("edge_thin", 3),
            Contact("top_edge", 4, "The physics has no toe contact; the top edge is its only bat-extremity contact."),
            Contact("block", 5),
            Contact("pad", 6),
            Contact("body", 7, "The physics reports no separate glove contact."),
            Contact("swish", 8),
            Contact("gloves", 8),
            Contact("bounce_hard", 9),
            Contact("bounce", 9),
            Contact("bounce_green", 9),
            Contact("bounce_turning", 9),
            Contact("stumps", 10),
            Contact("bails", 10),
            Contact("board", 11),
            new ProductionRecordedKind(
                "crowd:applause",
                12,
                "Recorded human applause, licensed (CC0 and CC BY), from indoor theatre and concert audiences, " +
                "not from a cricket ground.",
                ProductionRecordedAlign.Start,
                0.0,
                24000,
                new[]
                {
                    new ProductionRecordedTake("applause-1", "applause-1.mp3", 28392,
                        "0ad250d51a12acdb52735ba5eae7737b179f021da1f50486b69f8c077cdb8bf0", "TC-12-01", -21.03, -3.07, 2500),
                    new ProductionRecordedTake("applause-2", "applause-2.mp3", 26064,
                        "e72eae50e5ea417f669fdbd0a9b61b923a7a1c895d6f96533b64ab19f911233e", "TC-12-02", -21.0, -6.83, 2500),
                    new ProductionRecordedTake("applause-3", "applause-3.mp3", 27288,
                        "5cab9004cd56e10525e89c119088c9ecad4cb9d3c33ab69ca6a408f9c9f6a68f", "TC-12-03", -21.0, -2.5, 2500),
                    new ProductionRecordedTake("applause-4", "applause-4.mp3", 29544,
                        "1ab3d7610118c80a361526bdbc9bb303aaf7b5607e4b0d1dfdefcf01010df303", "TC-12-04", -21.02, -4.35, 2500)
                })
        };

        private static readonly Dictionary<string, ProductionRecordedKind> ByKey = Index();

        public static IReadOnlyList<ProductionRecordedKind> Kinds => KindsValue;

        public static ProductionRecordedKind Find(string key)
        {
            if (key == null) return null;
            ProductionRecordedKind value;
            return ByKey.TryGetValue(key, out value) ? value : null;
        }

        /// <summary>
        /// The web's sound id for one Unity cue: the string both renderers hash, so a delivery's takes match. Contact
        /// sounds follow the physics' contact kind and timing (src/audio/practice.ts feel()/edgeSound()); the bounce
        /// follows the pitch (BOUNCE). Cues the web does not voice keep a Unity-only id ("unity:{token}").
        /// </summary>
        public static string SoundKey(
            ProductionFeedbackCue cue,
            string contact,
            string contactTiming,
            string pitchCondition)
        {
            switch (cue)
            {
                case ProductionFeedbackCue.BatMiddle:
                    if (string.Equals(contactTiming, "perfect", StringComparison.Ordinal)) return "sweet";
                    if (string.Equals(contactTiming, "mistimed", StringComparison.Ordinal)) return "mistimed";
                    return "middle";
                case ProductionFeedbackCue.BatBlock: return "block";
                case ProductionFeedbackCue.Edge:
                case ProductionFeedbackCue.Nick:
                    if (string.Equals(contact, "top_edge", StringComparison.Ordinal)) return "top_edge";
                    if (string.Equals(contact, "inside_edge", StringComparison.Ordinal) ||
                        string.Equals(contact, "leading_edge", StringComparison.Ordinal)) return "edge_thick";
                    if (string.Equals(contact, "outside_edge", StringComparison.Ordinal)) return "edge_thin";
                    return cue == ProductionFeedbackCue.Nick ? "edge_thin" : "edge_thick";
                case ProductionFeedbackCue.Pad:
                    return string.Equals(contact, "body", StringComparison.Ordinal) ? "body" : "pad";
                case ProductionFeedbackCue.Miss: return "swish";
                case ProductionFeedbackCue.KeeperTake:
                case ProductionFeedbackCue.Catch:
                    return "gloves";
                case ProductionFeedbackCue.Pitch:
                    switch (pitchCondition)
                    {
                        case "hard": return "bounce_hard";
                        case "green": return "bounce_green";
                        case "turning": return "bounce_turning";
                        default: return "bounce";
                    }
                case ProductionFeedbackCue.StumpImpact: return "stumps";
                case ProductionFeedbackCue.BailFall: return "bails";
                case ProductionFeedbackCue.BoundaryFour:
                case ProductionFeedbackCue.BoundarySix:
                    return "board";
                case ProductionFeedbackCue.CrowdRun: return "crowd:applause";
                case ProductionFeedbackCue.CrowdBoundary: return "crowd:cheer";
                case ProductionFeedbackCue.CrowdSix: return "crowd:eruption";
                case ProductionFeedbackCue.CrowdNearMiss: return "crowd:ooh";
                case ProductionFeedbackCue.CrowdWicket: return "crowd:dismay";
                case ProductionFeedbackCue.CrowdTension: return "crowd:lift";
                case ProductionFeedbackCue.CrowdDot: return "crowd:groan";
                default:
                    return UnityOnlyKeys[(int)cue];
            }
        }

        // Built once, so live routing never allocates a key string.
        private static readonly string[] UnityOnlyKeys = BuildUnityOnlyKeys();

        private static string[] BuildUnityOnlyKeys()
        {
            var keys = new string[(int)ProductionFeedbackCue.Count + 1];
            for (var index = 0; index < keys.Length; index++)
                keys[index] = "unity:" + ProductionFeedbackClipLibrary.CueToken((ProductionFeedbackCue)index);
            return keys;
        }

        private static ProductionRecordedKind Contact(string key, int inventory, string note = null)
        {
            ProductionContactTakeSet set;
            var has = ContactTakes.TryGetValue(key, out set);
            var honest = has ? set.Honest : SynthOnly;
            return new ProductionRecordedKind(
                key,
                inventory,
                string.IsNullOrEmpty(note) ? honest : honest + " " + note,
                ProductionRecordedAlign.Onset,
                ProductionRecordedTakes.ContactPrerollSeconds,
                0,
                has ? set.Takes : Array.Empty<ProductionRecordedTake>(),
                has && set.Placeholder);
        }

        private static Dictionary<string, ProductionRecordedKind> Index()
        {
            var value = new Dictionary<string, ProductionRecordedKind>(StringComparer.Ordinal);
            for (var index = 0; index < KindsValue.Length; index++) value.Add(KindsValue[index].Key, KindsValue[index]);
            return value;
        }
    }
}
