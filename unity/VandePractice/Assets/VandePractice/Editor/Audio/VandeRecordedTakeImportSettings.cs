using System;
using UnityEditor;
using UnityEngine;
using Vande.Practice.Audio.Production;

namespace Vande.Practice.Editor.Audio
{
    /// <summary>
    /// Import settings for the licensed recorded takes in Resources/Audio/Cricket (byte-identical copies of the web's
    /// public/audio/cricket/ files; see ProductionRecordedManifest). Settings follow the web's runtime handling:
    /// decoded once before the first delivery (decompress on load), mono, and held at the kind's maximum rate
    /// (24 kHz for the crowd layers, as recorded.ts downsamples them). Decoded samples stay readable so the onset of a
    /// contact take can be found in the decoded clip, as on the web.
    /// </summary>
    internal sealed class VandeRecordedTakeImportSettings : AssetPostprocessor
    {
        internal const string Folder = "Assets/VandePractice/Runtime/Audio/Resources/Audio/Cricket/";

        // Bumped whenever these settings change, so Unity reimports the takes.
        public override uint GetVersion() => 2;

        private void OnPreprocessAudio()
        {
            if (!assetPath.StartsWith(Folder, StringComparison.Ordinal)) return;
            var importer = (AudioImporter)assetImporter;
            var id = System.IO.Path.GetFileNameWithoutExtension(assetPath);
            var maxRate = 0;
            var kinds = ProductionRecordedManifest.Kinds;
            for (var index = 0; index < kinds.Count; index++)
                for (var take = 0; take < kinds[index].Takes.Count; take++)
                    if (string.Equals(kinds[index].Takes[take].Id, id, StringComparison.Ordinal))
                        maxRate = kinds[index].MaxRate;

            // The takes are already mono. forceToMono would also apply the importer's peak "normalize", undoing the
            // register's loudness calibration (−21 LUFS), so it stays off.
            importer.forceToMono = false;
            importer.loadInBackground = false;
            importer.ambisonic = false;
            var settings = importer.defaultSampleSettings;
            settings.loadType = AudioClipLoadType.DecompressOnLoad;
            settings.preloadAudioData = true;
            settings.compressionFormat = AudioCompressionFormat.Vorbis;
            settings.quality = 0.6f;
            if (maxRate > 0)
            {
                settings.sampleRateSetting = AudioSampleRateSetting.OverrideSampleRate;
                settings.sampleRateOverride = (uint)maxRate;
            }
            else
            {
                settings.sampleRateSetting = AudioSampleRateSetting.PreserveSampleRate;
            }
            importer.defaultSampleSettings = settings;
            foreach (var platform in new[] { "Android", "WebGL", "Standalone" })
                importer.ClearSampleSettingOverride(platform);
        }
    }
}
