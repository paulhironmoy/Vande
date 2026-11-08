using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vande.Practice.Editor
{
    /// <summary>
    /// Produces a fresh, deterministic-shape WebGL player for the web host.
    /// The export is assembled in a sibling staging directory and published
    /// only after Unity and the expected-file validation both succeed.
    /// </summary>
    public static class VandeWebGLExporter
    {
        private const string ProductName = "VandePractice";
        private const string TemporaryScene = "Assets/__VandePracticeWebExport.unity";
        private const string ManifestFile = "vande-webgl-manifest.json";
        private const string FinalDirectory = "Builds/WebGL";
        private const string StagingContainer = "Builds/__VandePracticeWebGLStaging";
        private const string StagingDirectory = StagingContainer + "/" + ProductName;
        private static readonly Regex BuildIdPattern = new Regex(
            "^[0-9a-f]{7,40}(?:\\+[0-9a-f]{12})?$",
            RegexOptions.CultureInvariant);

        private static readonly string[] RequiredBuildFiles =
        {
            "Build/VandePractice.loader.js",
            "Build/VandePractice.data",
            "Build/VandePractice.framework.js",
            "Build/VandePractice.wasm"
        };

        [MenuItem("VANDE/Export WebGL engineering build")]
        public static void Export()
        {
            var project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            var output = Path.GetFullPath(Path.Combine(project, FinalDirectory));
            var buildsRoot = Path.GetFullPath(Path.Combine(project, "Builds"));
            var stagingContainer = Path.GetFullPath(Path.Combine(project, StagingContainer));
            var staging = Path.GetFullPath(Path.Combine(project, StagingDirectory));
            var temporaryScenePath = Path.Combine(project, TemporaryScene);
            var buildId = RequireBuildId();

            ValidateBuildsRoot(buildsRoot);
            ValidateFreshDestination(output, "Unity WebGL export");
            ValidateFreshDestination(stagingContainer, "Unity WebGL staging directory");
            ValidateTemporarySceneIsAbsent(temporaryScenePath);
            foreach (var relative in new[] { "Assets/VandePractice", "Packages", "ProjectSettings" })
                CollectRegularFiles(Path.Combine(project, relative), "Unity source root " + relative);
            var sourceDigest = SourceDigest(project);
            EnsureOpenScenesAreSaved();

            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL))
                throw new InvalidOperationException(
                    "Unity WebGL Build Support is not installed for this Editor patch.");

            var previousTarget = EditorUserBuildSettings.activeBuildTarget;
            var previousSceneSetup = EditorSceneManager.GetSceneManagerSetup();
            var previousProductName = PlayerSettings.productName;
            var previousCompression = PlayerSettings.WebGL.compressionFormat;
            var previousDecompressionFallback = PlayerSettings.WebGL.decompressionFallback;
            var previousNameFilesAsHashes = PlayerSettings.WebGL.nameFilesAsHashes;
            var productVersion = PlayerSettings.bundleVersion;
            BuildReport report = null;

            Directory.CreateDirectory(stagingContainer);
            try
            {
                if (!EditorUserBuildSettings.SwitchActiveBuildTarget(
                        BuildTargetGroup.WebGL, BuildTarget.WebGL))
                    throw new InvalidOperationException("Unity could not switch to the WebGL build target.");

                PlayerSettings.productName = ProductName;
                PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
                PlayerSettings.WebGL.decompressionFallback = false;
                PlayerSettings.WebGL.nameFilesAsHashes = false;

                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                if (!EditorSceneManager.SaveScene(scene, TemporaryScene, false))
                    throw new InvalidOperationException(
                        "Unity could not create the temporary WebGL export scene.");

                report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { TemporaryScene },
                    // The final path component controls Unity's generated WebGL
                    // filenames, so staging deliberately ends in VandePractice.
                    locationPathName = staging,
                    target = BuildTarget.WebGL,
                    targetGroup = BuildTargetGroup.WebGL,
                    options = BuildOptions.None
                });
            }
            finally
            {
                PlayerSettings.WebGL.nameFilesAsHashes = previousNameFilesAsHashes;
                PlayerSettings.WebGL.decompressionFallback = previousDecompressionFallback;
                PlayerSettings.WebGL.compressionFormat = previousCompression;
                PlayerSettings.productName = previousProductName;

                try
                {
                    if (!Application.isBatchMode)
                        EditorSceneManager.RestoreSceneManagerSetup(previousSceneSetup);
                }
                finally
                {
                    if (AssetDatabase.LoadAssetAtPath<SceneAsset>(TemporaryScene) != null)
                        AssetDatabase.DeleteAsset(TemporaryScene);
                    if (previousTarget != BuildTarget.WebGL)
                        EditorUserBuildSettings.SwitchActiveBuildTarget(
                            BuildPipeline.GetBuildTargetGroup(previousTarget), previousTarget);
                    AssetDatabase.SaveAssets();
                    AssetDatabase.Refresh();
                }
            }

            if (report == null || report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException(
                    "Unity WebGL export failed" +
                    (report == null
                        ? "."
                        : ": " + report.summary.result + " (errors=" +
                          report.summary.totalErrors.ToString(CultureInfo.InvariantCulture) + ")."));

            ValidateExpectedBuild(staging);
            RemoveStandaloneWrapper(staging);
            ValidateStreamingAssetsAreEmpty(staging);
            var sourceDigestAfterBuild = SourceDigest(project);
            if (!string.Equals(sourceDigest, sourceDigestAfterBuild, StringComparison.Ordinal))
                throw new InvalidOperationException(
                    "Unity source/settings changed during WebGL export. Re-run from one frozen source tree.");
            WriteManifestAtomically(staging, productVersion, buildId, sourceDigest);
            CollectRegularFiles(staging, "staged Unity WebGL export");

            // Both paths live under Builds, so this is a same-volume rename.
            // The final path was already required to be wholly absent.
            Directory.Move(staging, output);
            if (!Directory.EnumerateFileSystemEntries(stagingContainer).Any())
                Directory.Delete(stagingContainer, false);

            Debug.Log("VANDE WebGL export completed at " + output);
        }

        private static void ValidateFreshDestination(string path, string label)
        {
            if (Directory.Exists(path))
            {
                RejectSymbolicLink(new DirectoryInfo(path), label);
                throw new InvalidOperationException(
                    "Refusing to overwrite an existing " + label + ": " + path);
            }
            if (File.Exists(path))
                throw new InvalidOperationException(label + " path is an existing file: " + path);
        }

        private static void ValidateBuildsRoot(string path)
        {
            if (File.Exists(path))
                throw new InvalidOperationException("Unity Builds path is an existing file: " + path);
            if (Directory.Exists(path))
                RejectSymbolicLink(new DirectoryInfo(path), "Unity Builds root");
        }

        private static void ValidateTemporarySceneIsAbsent(string path)
        {
            if (File.Exists(path) || File.Exists(path + ".meta") ||
                AssetDatabase.LoadAssetAtPath<SceneAsset>(TemporaryScene) != null)
                throw new InvalidOperationException(
                    "Refusing to overwrite the temporary WebGL export scene: " + TemporaryScene);
        }

        private static void EnsureOpenScenesAreSaved()
        {
            if (Application.isBatchMode) return;
            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.isDirty || string.IsNullOrEmpty(scene.path))
                    throw new InvalidOperationException(
                        "Save all open Editor scenes before exporting WebGL: " +
                        (string.IsNullOrEmpty(scene.path) ? "<untitled>" : scene.path));
            }
        }

        private static void ValidateExpectedBuild(string root)
        {
            if (!Directory.Exists(root))
                throw new InvalidOperationException(
                    "Unity reported success without creating the staged WebGL directory.");
            if (!File.Exists(Path.Combine(root, "index.html")))
                throw new InvalidOperationException(
                    "Unity WebGL export is incomplete: index.html is missing.");
            foreach (var relative in RequiredBuildFiles)
            {
                if (!File.Exists(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar))))
                    throw new InvalidOperationException(
                        "Unity WebGL export is incomplete or used a non-deterministic filename: " + relative);
            }
        }

        /// <summary>
        /// VANDE embeds the Unity player in the React Practice host and loads it
        /// from the signed schema-2 manifest. Unity's standalone page and stock
        /// TemplateData are therefore not runtime inputs and must not enter the
        /// published export tree.
        /// </summary>
        private static void RemoveStandaloneWrapper(string root)
        {
            // Validate the generated tree before any recursive deletion so an
            // unexpected link or special entry can never redirect cleanup.
            CollectRegularFiles(root, "generated Unity WebGL export");

            var index = Path.Combine(root, "index.html");
            if (!File.Exists(index))
                throw new InvalidOperationException(
                    "Unity WebGL export is incomplete: index.html is missing.");
            File.Delete(index);

            var templateData = Path.Combine(root, "TemplateData");
            if (Directory.Exists(templateData))
                Directory.Delete(templateData, true);

            if (File.Exists(index) || Directory.Exists(templateData))
                throw new InvalidOperationException(
                    "Unity standalone WebGL wrapper could not be removed from the embedded export.");
        }

        private static void ValidateStreamingAssetsAreEmpty(string root)
        {
            var streamingAssets = Path.Combine(root, "StreamingAssets");
            if (!Directory.Exists(streamingAssets)) return;
            if (CollectRegularFiles(streamingAssets, "Unity WebGL StreamingAssets").Length != 0)
                throw new InvalidOperationException(
                    "WebGL StreamingAssets are not covered by the schema-2 artifact manifest.");
        }

        private static void WriteManifestAtomically(
            string root,
            string productVersion,
            string buildId,
            string sourceDigest)
        {
            var manifest = new StringBuilder();
            manifest.Append("{\n");
            manifest.Append("  \"schema\": 2,\n");
            manifest.Append("  \"buildId\": ").Append(JsonString(buildId)).Append(",\n");
            manifest.Append("  \"unitySourceSha256\": ").Append(JsonString(sourceDigest)).Append(",\n");
            manifest.Append("  \"unityVersion\": ").Append(JsonString(Application.unityVersion)).Append(",\n");
            manifest.Append("  \"productVersion\": ").Append(JsonString(productVersion)).Append(",\n");
            AppendArtifact(manifest, root, "loader", RequiredBuildFiles[0]);
            AppendArtifact(manifest, root, "data", RequiredBuildFiles[1]);
            AppendArtifact(manifest, root, "framework", RequiredBuildFiles[2]);
            AppendArtifact(manifest, root, "code", RequiredBuildFiles[3]);
            manifest.Append("  \"streamingAssetsUrl\": \"StreamingAssets\"\n");
            manifest.Append("}\n");

            var destination = Path.Combine(root, ManifestFile);
            var temporary = destination + ".tmp";
            if (File.Exists(destination) || File.Exists(temporary))
                throw new InvalidOperationException(
                    "Refusing to overwrite an existing WebGL manifest: " + destination);
            File.WriteAllText(temporary, manifest.ToString(), new UTF8Encoding(false));
            File.Move(temporary, destination);
        }

        private static void AppendArtifact(
            StringBuilder manifest,
            string root,
            string name,
            string relativePath)
        {
            var absolute = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            manifest.Append("  ").Append(JsonString(name)).Append(": { \"url\": ")
                .Append(JsonString(relativePath)).Append(", \"sha256\": ")
                .Append(JsonString(FileDigest(absolute))).Append(" },\n");
        }

        private static string RequireBuildId()
        {
            var buildId = Environment.GetEnvironmentVariable("VANDE_BUILD_ID");
            if (string.IsNullOrEmpty(buildId) || !BuildIdPattern.IsMatch(buildId))
                throw new InvalidOperationException(
                    "Set VANDE_BUILD_ID to the exact output of scripts/build-id.sh " +
                    "before exporting WebGL.");
            return buildId;
        }

        private static string SourceDigest(string project)
        {
            var roots = new[] { "Assets/VandePractice", "Packages", "ProjectSettings" };
            var files = roots.SelectMany(relative => CollectRegularFiles(
                Path.Combine(project, relative), "Unity source root " + relative));
            return BuildManifestDigest(project, files);
        }

        private static string BuildManifestDigest(string root, IEnumerable<string> paths)
        {
            var fullRoot = Path.GetFullPath(root).TrimEnd(
                Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var rootPrefix = fullRoot + Path.DirectorySeparatorChar;
            var entries = paths.Select(path =>
                {
                    var absolute = Path.GetFullPath(path);
                    if (!absolute.StartsWith(rootPrefix, StringComparison.Ordinal))
                        throw new InvalidOperationException("Source manifest entry escapes its root: " + absolute);
                    var relative = absolute.Substring(rootPrefix.Length)
                        .Replace(Path.DirectorySeparatorChar, '/');
                    ValidateRelativePath(relative);
                    return new
                    {
                        Relative = relative,
                        Digest = FileDigest(absolute),
                        Encoded = EncodePath(relative)
                    };
                })
                .OrderBy(entry => entry.Relative, StringComparer.Ordinal)
                .ToArray();

            var canonical = new StringBuilder();
            for (var index = 0; index < entries.Length; index++)
            {
                canonical.Append(index.ToString("D6", CultureInfo.InvariantCulture)).Append('\t')
                    .Append(entries[index].Digest).Append('\t')
                    .Append(entries[index].Encoded).Append('\n');
            }
            return BytesDigest(new UTF8Encoding(false).GetBytes(canonical.ToString()));
        }

        private static void ValidateRelativePath(string path)
        {
            if (string.IsNullOrEmpty(path) || path[0] == '/' || path.IndexOf('\\') >= 0 ||
                path.Split('/').Any(segment => segment.Length == 0 || segment == "." || segment == "..") ||
                path.Any(character => character < ' ' || character == '\u007f'))
                throw new InvalidOperationException("Source manifest path is not canonical: " + path);
        }

        private static string EncodePath(string path)
        {
            return Convert.ToBase64String(new UTF8Encoding(false, true).GetBytes(path))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        private static string FileDigest(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var sha = SHA256.Create())
                return LowerHex(sha.ComputeHash(stream));
        }

        private static string BytesDigest(byte[] bytes)
        {
            using (var sha = SHA256.Create()) return LowerHex(sha.ComputeHash(bytes));
        }

        private static string LowerHex(byte[] bytes)
        {
            var value = new StringBuilder(bytes.Length * 2);
            for (var index = 0; index < bytes.Length; index++)
                value.Append(bytes[index].ToString("x2", CultureInfo.InvariantCulture));
            return value.ToString();
        }

        private static string JsonString(string value)
        {
            if (value == null) return "null";
            var escaped = new StringBuilder(value.Length + 2).Append('"');
            foreach (var character in value)
            {
                switch (character)
                {
                    case '"': escaped.Append("\\\""); break;
                    case '\\': escaped.Append("\\\\"); break;
                    case '\b': escaped.Append("\\b"); break;
                    case '\f': escaped.Append("\\f"); break;
                    case '\n': escaped.Append("\\n"); break;
                    case '\r': escaped.Append("\\r"); break;
                    case '\t': escaped.Append("\\t"); break;
                    default:
                        if (character < ' ')
                            escaped.Append("\\u")
                                .Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            escaped.Append(character);
                        break;
                }
            }
            return escaped.Append('"').ToString();
        }

        private static string[] CollectRegularFiles(string root, string label)
        {
            if (!Directory.Exists(root))
                throw new InvalidOperationException(label + " is missing or is not a directory: " + root);

            var rootInfo = new DirectoryInfo(root);
            RejectSymbolicLink(rootInfo, label);
            var pending = new Stack<DirectoryInfo>();
            var files = new List<string>();
            pending.Push(rootInfo);
            while (pending.Count > 0)
            {
                var directory = pending.Pop();
                FileSystemInfo[] children;
                try
                {
                    children = directory.GetFileSystemInfos();
                }
                catch (Exception exception)
                {
                    throw new InvalidOperationException(
                        "Cannot enumerate " + label + " directory: " + directory.FullName, exception);
                }

                foreach (var child in children)
                {
                    RejectSymbolicLink(child, label);
                    var childDirectory = child as DirectoryInfo;
                    if (childDirectory != null)
                    {
                        pending.Push(childDirectory);
                        continue;
                    }
                    var childFile = child as FileInfo;
                    if (childFile == null)
                        throw new InvalidOperationException(
                            label + " contains a non-regular filesystem entry: " + child.FullName);
                    files.Add(childFile.FullName);
                }
            }
            return files.ToArray();
        }

        private static void RejectSymbolicLink(FileSystemInfo entry, string label)
        {
            FileAttributes attributes;
            try
            {
                attributes = entry.Attributes;
            }
            catch (Exception exception)
            {
                throw new InvalidOperationException(
                    "Cannot inspect " + label + " filesystem entry: " + entry.FullName, exception);
            }
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException(
                    label + " must not contain symbolic links or reparse points: " + entry.FullName);
        }
    }
}
