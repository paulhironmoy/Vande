using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Xml.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;
using Vande.Practice.Bridge;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The Android player must stay inside the 50,000,000-byte install budget (docs/ANDROID_SIZE_AND_REACH.md). The
    /// UI Toolkit HUD more than doubled IL2CPP output under the default speed/minimal settings, so the Android player
    /// is pinned to size-optimised IL2CPP code generation, High managed stripping and engine-code stripping, with a
    /// link.xml that keeps only what the runtime reaches by name.
    /// </summary>
    public sealed class AndroidSizeSettingsTests
    {
        private static readonly string[] SendMessageTargets =
        {
            "ReceivePacket", "ReportRelease", "ReportPointer", "ReportGesture",
            "RequestDeadBallPauseFromNativeBack", "ReportDeliveryDead", "PrepareForUnload"
        };

        [Test]
        public void AndroidPlayer_UsesSizeOptimisedIl2CppHighStrippingAndEngineStripping()
        {
            var android = NamedBuildTarget.Android;
            Assert.That(PlayerSettings.GetScriptingBackend(android), Is.EqualTo(ScriptingImplementation.IL2CPP));
            Assert.That(PlayerSettings.GetIl2CppCodeGeneration(android), Is.EqualTo(Il2CppCodeGeneration.OptimizeSize));
            Assert.That(PlayerSettings.GetManagedStrippingLevel(android), Is.EqualTo(ManagedStrippingLevel.High));
            Assert.That(PlayerSettings.stripEngineCode, Is.True);
        }

        [Test]
        public void LinkXml_EveryPreservedTypeResolvesAndTheBridgeKeepsItsSendMessageTargets()
        {
            var path = Path.Combine(Application.dataPath, "VandePractice", "link.xml");
            Assert.That(File.Exists(path), Is.True, path);
            var document = XDocument.Load(path);
            var assemblies = document.Root.Elements("assembly").ToArray();
            Assert.That(assemblies, Has.Length.EqualTo(1), "link.xml preserves only the VANDE runtime assembly");
            Assert.That((string)assemblies[0].Attribute("fullname"), Is.EqualTo("Vande.Practice.Runtime"));
            Assert.That(assemblies[0].Attribute("preserve"), Is.Null,
                "the runtime assembly itself must stay strippable; list members reached by name instead");

            var runtime = typeof(VandeBridgeBehaviour).Assembly;
            var types = assemblies[0].Elements("type").ToArray();
            Assert.That(types, Is.Not.Empty);
            foreach (var element in types)
            {
                var fullname = (string)element.Attribute("fullname");
                Assert.That(fullname, Is.Not.Null.And.Not.Empty);
                Assert.That(fullname, Does.Not.Contain("*"), "explicit types only");
                Assert.That(runtime.GetType(fullname.Replace('/', '+'), false), Is.Not.Null,
                    "link.xml names a type that does not exist: " + fullname);
            }

            var bridge = types.Single(element =>
                (string)element.Attribute("fullname") == typeof(VandeBridgeBehaviour).FullName);
            Assert.That((string)bridge.Attribute("preserve"), Is.EqualTo("all"));
            foreach (var name in SendMessageTargets)
            {
                var method = typeof(VandeBridgeBehaviour).GetMethod(
                    name, BindingFlags.Instance | BindingFlags.Public, null, new[] { typeof(string) }, null);
                Assert.That(method, Is.Not.Null, "UnitySendMessage target " + name);
            }
        }
    }
}
