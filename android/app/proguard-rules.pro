# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# The Unity C# bridge resolves this class and these public static entrypoints by their literal JNI names through
# AndroidJavaClass. They are not visible to R8's Java call graph, so a Unity-linked minified release must preserve
# both the class name and every public static host endpoint. Debug builds do not exercise this boundary.
-keep class in.vande.cricket.unity.UnityPracticeHost {
    public static *;
}
