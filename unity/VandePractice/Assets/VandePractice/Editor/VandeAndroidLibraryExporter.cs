using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vande.Practice.Editor
{
    public static class VandeAndroidLibraryExporter
    {
        private const string TemporaryScene = "Assets/__VandePracticeExport.unity";
        private const string ProvenanceFile = ".vande-export.properties";
        private const int MaximumManifestFiles = 100000;
        private const ulong PosixFileTypeMask = 0xf000;
        private const ulong PosixRegularFile = 0x8000;
        private const ulong PosixExecutableMask = 0x0049;
        private static readonly string[] SourceRoots = { "Assets", "Packages", "ProjectSettings" };

        private static MethodInfo posixLStat;
        private static Type posixStatType;
        private static FieldInfo posixModeField;

        [MenuItem("VANDE/Export Android unityLibrary")]
        public static void Export()
        {
            var output = Path.GetFullPath(Path.Combine(Application.dataPath, "../Builds/Android"));
            var project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            var sourceManifestBeforeBuild = SourceManifest(project);
            if (Directory.Exists(output))
            {
                RejectSymbolicLink(new DirectoryInfo(output), "Unity Android export");
                if (Directory.EnumerateFileSystemEntries(output).Any())
                    throw new InvalidOperationException(
                        "Refusing to overwrite a non-empty Unity export. Move or remove it explicitly: " + output);
            }

            var previousTarget = EditorUserBuildSettings.activeBuildTarget;
            var previousExport = EditorUserBuildSettings.exportAsGoogleAndroidProject;
            var previousOrientation = PlayerSettings.defaultInterfaceOrientation;
            var previousArchitectures = PlayerSettings.Android.targetArchitectures;
            var previousMinSdk = PlayerSettings.Android.minSdkVersion;
            var androidTarget = NamedBuildTarget.Android;
            var previousBackend = PlayerSettings.GetScriptingBackend(androidTarget);

            try
            {
                if (!EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android))
                    throw new InvalidOperationException("Unity could not switch to the Android build target.");

                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                if (!EditorSceneManager.SaveScene(scene, TemporaryScene, false))
                    throw new InvalidOperationException("Unity could not create the temporary export scene.");

                Directory.CreateDirectory(output);
                EditorUserBuildSettings.exportAsGoogleAndroidProject = true;
                PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
                PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
                PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel28;
                PlayerSettings.SetScriptingBackend(androidTarget, ScriptingImplementation.IL2CPP);

                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { TemporaryScene },
                    locationPathName = output,
                    target = BuildTarget.Android,
                    targetGroup = BuildTargetGroup.Android,
                    options = BuildOptions.AcceptExternalModificationsToPlayer
                });
                if (report.summary.result != BuildResult.Succeeded)
                    throw new InvalidOperationException(
                        "Unity Android export failed: " + report.summary.result +
                        " (errors=" + report.summary.totalErrors + ").");
                if (!Directory.Exists(Path.Combine(output, "unityLibrary")))
                    throw new InvalidOperationException("Export succeeded without a unityLibrary directory.");
                SanitizeLibraryManifest(Path.Combine(output, "unityLibrary", "src", "main", "AndroidManifest.xml"));
            }
            finally
            {
                PlayerSettings.SetScriptingBackend(androidTarget, previousBackend);
                PlayerSettings.Android.minSdkVersion = previousMinSdk;
                PlayerSettings.Android.targetArchitectures = previousArchitectures;
                PlayerSettings.defaultInterfaceOrientation = previousOrientation;
                EditorUserBuildSettings.exportAsGoogleAndroidProject = previousExport;
                if (AssetDatabase.LoadAssetAtPath<SceneAsset>(TemporaryScene) != null)
                    AssetDatabase.DeleteAsset(TemporaryScene);
                if (previousTarget != BuildTarget.Android)
                    EditorUserBuildSettings.SwitchActiveBuildTarget(
                        BuildPipeline.GetBuildTargetGroup(previousTarget), previousTarget);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
            }

            // Hash only after the temporary scene and PlayerSettings changes
            // have been restored, so a fresh export is not stale on arrival.
            var sourceManifestAfterBuild = SourceManifest(project);
            if (!string.Equals(
                    sourceManifestBeforeBuild.Digest,
                    sourceManifestAfterBuild.Digest,
                    StringComparison.Ordinal))
                throw new InvalidOperationException(
                    "Unity source/settings changed during Android export. Re-run from one frozen source tree.");
            WriteProvenanceAtomically(output, sourceManifestAfterBuild);
            Debug.Log("VANDE unityLibrary export completed at " + output);
        }

        /// <summary>
        /// Unity 6's exported library includes the standalone Activity template's launcher and a required GLES 3
        /// install filter. VANDE embeds UnityPlayerForActivityOrService inside its Capacitor activity, so the
        /// standalone GameActivity native layer and Swappy wrapper are deliberately disabled in PlayerSettings.
        /// Keeping the launcher or GLES declaration would replace VANDE's launcher or prevent the retained-renderer
        /// cohort from installing. The sanitized file is receipt-bound; an unexpected manifest fails closed.
        /// </summary>
        private static void SanitizeLibraryManifest(string path)
        {
            if (!File.Exists(path))
                throw new InvalidOperationException("Unity library manifest is missing: " + path);

            var document = XDocument.Load(path, LoadOptions.PreserveWhitespace);
            var manifest = document.Root;
            if (manifest == null || manifest.Name.LocalName != "manifest")
                throw new InvalidOperationException("Unity library manifest has no manifest root.");

            XNamespace android = "http://schemas.android.com/apk/res/android";
            var gles = manifest.Elements()
                .Where(element => element.Name.LocalName == "uses-feature" &&
                    element.Attribute(android + "glEsVersion") != null)
                .ToArray();
            if (gles.Length != 1 || (string)gles[0].Attribute(android + "glEsVersion") != "0x00030000")
                throw new InvalidOperationException(
                    "Unity library manifest must contain exactly the reviewed GLES 3 install filter.");
            gles[0].Remove();

            var application = manifest.Elements().SingleOrDefault(element => element.Name.LocalName == "application");
            if (application == null)
                throw new InvalidOperationException("Unity library manifest has no application element.");
            var launchers = application.Elements()
                .Where(element => element.Name.LocalName == "activity" &&
                    (string)element.Attribute(android + "name") == "com.unity3d.player.UnityPlayerActivity")
                .ToArray();
            if (launchers.Length != 1)
                throw new InvalidOperationException(
                    "Unity library manifest must contain exactly the reviewed standalone Activity launcher.");
            launchers[0].Remove();

            if (application.Descendants().Any(element =>
                element.Name.LocalName == "category" &&
                (string)element.Attribute(android + "name") == "android.intent.category.LAUNCHER"))
                throw new InvalidOperationException("Unity library manifest still contains a launcher category.");

            var temporary = path + ".vande-tmp";
            try
            {
                document.Save(temporary, SaveOptions.DisableFormatting);
                File.Delete(path);
                File.Move(temporary, path);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }

        private static void WriteProvenanceAtomically(string output, FileManifest sourceManifest)
        {
            var library = Path.Combine(output, "unityLibrary");
            var libraryGradle = Path.Combine(library, "build.gradle");
            var libraryManifest = Path.Combine(library, "src", "main", "AndroidManifest.xml");
            if (!File.Exists(libraryGradle) || !File.Exists(libraryManifest))
                throw new InvalidOperationException(
                    "Unity export is incomplete: unityLibrary Gradle or Android manifest is missing.");

            // Seal the complete generated tree. The only exclusion is the exact root receipt,
            // which does not exist until the atomic rename below. A same-named nested file is
            // an ordinary export entry and remains covered.
            var exportFiles = CollectRegularFiles(output, "Unity Android export")
                .Where(path => !PathsEqual(path, Path.Combine(output, ProvenanceFile)))
                .ToArray();
            var exportManifest = BuildManifest(output, exportFiles);
            ValidateManifestSize(sourceManifest, "Unity source");
            ValidateManifestSize(exportManifest, "Unity Android export");

            var contents = new StringBuilder();
            contents.Append("schema=3\n");
            contents.Append("editorVersion=").Append(Application.unityVersion).Append('\n');
            contents.Append("target=Android\n");
            contents.Append("scriptingBackend=IL2CPP\n");
            contents.Append("architectures=ARM64\n");
            contents.Append("minSdk=28\n");
            AppendManifest(contents, "source", sourceManifest);
            AppendManifest(contents, "export", exportManifest);

            var marker = Path.Combine(output, ProvenanceFile);
            var temporaryPath = marker + ".tmp";
            if (File.Exists(marker) || Directory.Exists(marker))
                throw new InvalidOperationException("Refusing to overwrite existing Unity export provenance: " + marker);
            if (File.Exists(temporaryPath) || Directory.Exists(temporaryPath))
                throw new InvalidOperationException(
                    "Refusing to overwrite an existing Unity export provenance staging path: " + temporaryPath);

            var temporaryCreated = false;
            try
            {
                var bytes = new UTF8Encoding(false).GetBytes(contents.ToString());
                using (var stream = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None))
                {
                    temporaryCreated = true;
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                File.Move(temporaryPath, marker);
                temporaryCreated = false;
            }
            finally
            {
                if (temporaryCreated && File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
        }

        private static FileManifest SourceManifest(string project)
        {
            var files = SourceRoots
                .SelectMany(relative => CollectRegularFiles(
                    Path.Combine(project, relative), "Unity source root " + relative))
                .ToArray();
            var manifest = BuildManifest(project, files);
            ValidateManifestSize(manifest, "Unity source");
            return manifest;
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
                    var metadata = ReadFileMetadata(childFile.FullName, label);
                    if (!metadata.IsRegular)
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
            if ((attributes & FileAttributes.Device) != 0)
                throw new InvalidOperationException(
                    label + " must not contain device files: " + entry.FullName);
        }

        private static FileManifest BuildManifest(string root, IEnumerable<string> paths)
        {
            var fullRoot = Path.GetFullPath(root).TrimEnd(
                Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var rootPrefix = fullRoot + Path.DirectorySeparatorChar;
            var entries = paths.Select(path =>
                {
                    var absolute = Path.GetFullPath(path);
                    if (!absolute.StartsWith(rootPrefix, StringComparison.Ordinal))
                        throw new InvalidOperationException(
                            "Manifest entry escapes its root: " + absolute + " (root " + fullRoot + ").");
                    var relative = absolute.Substring(rootPrefix.Length)
                        .Replace(Path.DirectorySeparatorChar, '/');
                    ValidateRelativePath(relative);
                    var metadata = ReadFileMetadata(absolute, "manifest");
                    if (!metadata.IsRegular)
                        throw new InvalidOperationException(
                            "Manifest entry is not a regular file: " + absolute);
                    return new ManifestEntry(relative, FileDigest(absolute), metadata.IsExecutable);
                })
                .OrderBy(entry => entry.RelativePath, StringComparer.Ordinal)
                .ToArray();

            if (entries.Select(entry => entry.RelativePath).Distinct(StringComparer.Ordinal).Count() != entries.Length)
                throw new InvalidOperationException("Manifest contains duplicate canonical paths.");

            var canonical = new StringBuilder();
            for (var index = 0; index < entries.Length; index++)
            {
                canonical.Append(index.ToString("D6", CultureInfo.InvariantCulture)).Append('\t')
                    .Append(entries[index].ExecutableFlag).Append('\t')
                    .Append(entries[index].Digest).Append('\t')
                    .Append(entries[index].EncodedPath).Append('\n');
            }

            return new FileManifest(entries, BytesDigest(new UTF8Encoding(false).GetBytes(canonical.ToString())));
        }

        private static void ValidateRelativePath(string path)
        {
            if (string.IsNullOrEmpty(path) || path[0] == '/' || path.IndexOf('\\') >= 0 ||
                path.Split('/').Any(segment => segment.Length == 0 || segment == "." || segment == "..") ||
                path.Any(char.IsControl))
                throw new InvalidOperationException(
                    "Manifest path is not a canonical safe relative path: " + path);
        }

        private static void ValidateManifestSize(FileManifest manifest, string label)
        {
            if (manifest.Entries.Length == 0 || manifest.Entries.Length > MaximumManifestFiles)
                throw new InvalidOperationException(
                    label + " file count must be between 1 and " + MaximumManifestFiles + ".");
        }

        private static void AppendManifest(StringBuilder contents, string prefix, FileManifest manifest)
        {
            contents.Append(prefix).Append("FileCount=")
                .Append(manifest.Entries.Length.ToString(CultureInfo.InvariantCulture)).Append('\n');
            contents.Append(prefix).Append("TreeSha256=").Append(manifest.Digest).Append('\n');
            for (var index = 0; index < manifest.Entries.Length; index++)
            {
                var entry = manifest.Entries[index];
                contents.Append(prefix).Append("File")
                    .Append(index.ToString("D6", CultureInfo.InvariantCulture)).Append('=')
                    .Append(entry.ExecutableFlag).Append(':')
                    .Append(entry.Digest).Append(':')
                    .Append(entry.EncodedPath).Append('\n');
            }
        }

        private static bool PathsEqual(string first, string second)
        {
            var comparison = Path.DirectorySeparatorChar == '\\'
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
            return string.Equals(Path.GetFullPath(first), Path.GetFullPath(second), comparison);
        }

        private static FileMetadata ReadFileMetadata(string path, string label)
        {
            // Windows does not expose POSIX execute bits. Its conservative receipt semantics
            // therefore bind every regular file as non-executable. On Unix, fail closed unless
            // Mono.Posix can provide lstat mode bits; access(2) is intentionally not used because
            // it answers whether this process may execute a file, not whether any execute bit is set.
            if (Path.DirectorySeparatorChar == '\\') return new FileMetadata(true, false);

            try
            {
                EnsurePosixReflection();
                var stat = Activator.CreateInstance(posixStatType);
                var arguments = new[] { (object)path, stat };
                var result = Convert.ToInt32(posixLStat.Invoke(null, arguments), CultureInfo.InvariantCulture);
                if (result != 0)
                    throw new InvalidOperationException(
                        "lstat failed for " + label + " filesystem entry: " + path +
                        " (result=" + result.ToString(CultureInfo.InvariantCulture) + ").");
                var mode = Convert.ToUInt64(
                    posixModeField.GetValue(arguments[1]), CultureInfo.InvariantCulture);
                return new FileMetadata(
                    (mode & PosixFileTypeMask) == PosixRegularFile,
                    (mode & PosixExecutableMask) != 0);
            }
            catch (TargetInvocationException exception)
            {
                throw new InvalidOperationException(
                    "Cannot inspect POSIX metadata for " + label + " filesystem entry: " + path,
                    exception.InnerException ?? exception);
            }
            catch (InvalidOperationException)
            {
                throw;
            }
            catch (Exception exception)
            {
                throw new InvalidOperationException(
                    "Cannot inspect POSIX metadata for " + label + " filesystem entry: " + path,
                    exception);
            }
        }

        private static void EnsurePosixReflection()
        {
            if (posixLStat != null) return;
            var assembly = AppDomain.CurrentDomain.GetAssemblies()
                .FirstOrDefault(candidate => candidate.GetName().Name == "Mono.Posix") ??
                Assembly.Load("Mono.Posix");
            posixStatType = assembly.GetType("Mono.Unix.Native.Stat", true);
            var syscallType = assembly.GetType("Mono.Unix.Native.Syscall", true);
            posixModeField = posixStatType.GetField("st_mode", BindingFlags.Public | BindingFlags.Instance);
            posixLStat = syscallType.GetMethod(
                "lstat",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[] { typeof(string), posixStatType.MakeByRefType() },
                null);
            if (posixModeField == null || posixLStat == null)
                throw new InvalidOperationException(
                    "Mono.Posix does not expose the required lstat mode contract.");
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
            for (var index = 0; index < bytes.Length; index++) value.Append(bytes[index].ToString("x2"));
            return value.ToString();
        }

        private sealed class ManifestEntry
        {
            public ManifestEntry(string relativePath, string digest, bool isExecutable)
            {
                RelativePath = relativePath;
                Digest = digest;
                EncodedPath = EncodePath(relativePath);
                ExecutableFlag = isExecutable ? "1" : "0";
            }

            public string RelativePath { get; private set; }
            public string Digest { get; private set; }
            public string EncodedPath { get; private set; }
            public string ExecutableFlag { get; private set; }
        }

        private sealed class FileMetadata
        {
            public FileMetadata(bool isRegular, bool isExecutable)
            {
                IsRegular = isRegular;
                IsExecutable = isExecutable;
            }

            public bool IsRegular { get; private set; }
            public bool IsExecutable { get; private set; }
        }

        private sealed class FileManifest
        {
            public FileManifest(ManifestEntry[] entries, string digest)
            {
                Entries = entries;
                Digest = digest;
            }

            public ManifestEntry[] Entries { get; private set; }
            public string Digest { get; private set; }
        }
    }
}
