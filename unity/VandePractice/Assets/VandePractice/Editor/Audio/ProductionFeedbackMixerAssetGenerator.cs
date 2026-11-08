using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.Audio;

namespace Vande.Practice.Editor.Audio
{
    /// <summary>
    /// Deterministically creates the small routing-only Practice mixer. Unity's
    /// mixer authoring controller is editor-internal, so reflection is kept in
    /// this Editor-only generator and never reaches the player/runtime build.
    /// Existing groups are preserved; missing required children are added.
    /// </summary>
    public static class ProductionFeedbackMixerAssetGenerator
    {
        public const string MixerAssetPath =
            "Assets/VandePractice/Runtime/Presentation/Resources/Audio/Production/" +
            "VandePracticeFeedback.mixer";

        private static readonly string[] ChildGroups =
        {
            "Ball",
            "Bat",
            "Field",
            "Players",
            "Crowd",
            "Commentary",
            "Interface"
        };

        [MenuItem("VANDE/Audio/Generate Practice Feedback Mixer")]
        public static void Generate()
        {
            EnsureFolder("Assets/VandePractice/Runtime/Presentation/Resources/Audio/Production");
            var mixer = AssetDatabase.LoadAssetAtPath<AudioMixer>(MixerAssetPath);
            object controller = mixer;
            if (mixer == null)
            {
                var controllerType = typeof(UnityEditor.Editor).Assembly.GetType(
                    "UnityEditor.Audio.AudioMixerController",
                    true);
                var create = RequiredMethod(
                    controllerType,
                    "CreateMixerControllerAtPath",
                    BindingFlags.Public | BindingFlags.Static);
                controller = create.Invoke(null, new object[] { MixerAssetPath });
                mixer = controller as AudioMixer;
                if (mixer == null)
                    throw new InvalidOperationException("Unity did not create the Practice AudioMixer asset.");
            }

            var type = controller.GetType();
            var createGroup = RequiredMethod(
                type,
                "CreateNewGroup",
                BindingFlags.Public | BindingFlags.Instance);
            var addChild = RequiredMethod(
                type,
                "AddChildToParent",
                BindingFlags.Public | BindingFlags.Instance);
            var masterProperty = type.GetProperty(
                "masterGroup",
                BindingFlags.Public | BindingFlags.Instance);
            if (masterProperty == null)
                throw new MissingMemberException(type.FullName, "masterGroup");
            var master = masterProperty.GetValue(controller, null);
            if (master == null)
                throw new InvalidOperationException("Practice AudioMixer has no Master group.");

            for (var index = 0; index < ChildGroups.Length; index++)
            {
                var groupName = ChildGroups[index];
                var exactCount = ExactGroupCount(mixer, groupName);
                if (exactCount > 1)
                    throw new InvalidOperationException(
                        "Practice AudioMixer contains duplicate exact group: " + groupName);
                if (exactCount == 1) continue;
                var child = createGroup.Invoke(controller, new object[] { groupName, false });
                if (child == null)
                    throw new InvalidOperationException("Unity did not create mixer group: " + groupName);
                addChild.Invoke(controller, new[] { child, master });
            }

            EditorUtility.SetDirty(mixer);
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(MixerAssetPath, ImportAssetOptions.ForceSynchronousImport);
            mixer = AssetDatabase.LoadAssetAtPath<AudioMixer>(MixerAssetPath);
            Validate(mixer);
            Debug.Log("VANDE Practice feedback mixer ready: " + MixerAssetPath);
        }

        // Entry point for an explicitly coordinated -batchmode -executeMethod run.
        public static void GenerateForBatch()
        {
            Generate();
        }

        private static void Validate(AudioMixer mixer)
        {
            if (mixer == null)
                throw new InvalidOperationException("Practice AudioMixer was not importable after generation.");
            if (ExactGroupCount(mixer, "Master") != 1)
                throw new InvalidOperationException("Practice AudioMixer must contain exactly one Master group.");
            for (var index = 0; index < ChildGroups.Length; index++)
                if (ExactGroupCount(mixer, ChildGroups[index]) != 1)
                    throw new InvalidOperationException(
                        "Practice AudioMixer is missing exact group: " + ChildGroups[index]);
        }

        private static int ExactGroupCount(AudioMixer mixer, string expectedName)
        {
            var matches = mixer.FindMatchingGroups(expectedName);
            var count = 0;
            for (var index = 0; index < matches.Length; index++)
            {
                var group = matches[index];
                if (group != null && string.Equals(group.name, expectedName, StringComparison.Ordinal))
                    count++;
            }
            return count;
        }

        private static MethodInfo RequiredMethod(Type type, string name, BindingFlags flags)
        {
            var method = type.GetMethod(name, flags);
            if (method == null) throw new MissingMethodException(type.FullName, name);
            return method;
        }

        private static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index++)
            {
                var next = current + "/" + parts[index];
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }
    }
}
