package in.vande.cricket.unity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import in.vande.cricket.MainActivity;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class UnityPracticeHostInstrumentedTest {
    private static final String OPERATION_ID = "host-regression-1";

    private interface LifecycleProbe {
        void onUnityPlayerUnloaded();
    }

    @After
    public void resetStaticHost() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(UnityPracticeHostInstrumentedTest::resetHost);
    }

    @Test
    public void visibilityResolvesAfterTheMainThreadActuallyAppliesIt() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            final FrameLayout[] layerRef = new FrameLayout[1];
            scenario.onActivity(activity -> {
                resetHost();
                FrameLayout layer = new FrameLayout(activity);
                layer.setVisibility(View.INVISIBLE);
                activity.addContentView(
                    layer,
                    new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                );
                setReadyHost(activity, layer);
                layerRef[0] = layer;
            });

            CountDownLatch visible = new CountDownLatch(1);
            AtomicBoolean applied = new AtomicBoolean(false);
            AtomicBoolean callbackOnMain = new AtomicBoolean(false);
            AtomicInteger visibilityAtCallback = new AtomicInteger(-1);
            UnityPracticeHost.setVisible(OPERATION_ID, true, result -> {
                applied.set(result);
                callbackOnMain.set(Looper.myLooper() == Looper.getMainLooper());
                visibilityAtCallback.set(layerRef[0].getVisibility());
                visible.countDown();
            });

            assertTrue("visibility completion timed out", visible.await(5, TimeUnit.SECONDS));
            assertTrue(applied.get());
            assertTrue(callbackOnMain.get());
            assertEquals(View.VISIBLE, visibilityAtCallback.get());

            CountDownLatch stale = new CountDownLatch(1);
            AtomicBoolean staleApplied = new AtomicBoolean(true);
            UnityPracticeHost.setVisible("stale-operation", false, result -> {
                staleApplied.set(result);
                stale.countDown();
            });
            assertTrue("stale visibility completion timed out", stale.await(5, TimeUnit.SECONDS));
            assertFalse(staleApplied.get());
            assertEquals(View.VISIBLE, layerRef[0].getVisibility());

            scenario.onActivity(activity -> resetHost());
        }
    }

    @Test
    public void logicalPixelsPerDpUsesAndroidDisplayMetricsRatherThanUnityScreenDpi() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                float platformDensity = activity.getResources().getDisplayMetrics().density;
                Float actual = UnityPracticeHost.logicalPixelsPerDp(activity);
                assertNotNull("Android logical density was unavailable", actual);
                assertEquals(Math.max(1f, platformDensity), actual, 0.0001f);
            });
        }
    }

    @Test
    public void systemTextScaleUsesAndroidConfigurationIndependentlyOfTouchDensity() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                float platformScale = activity.getResources().getConfiguration().fontScale;
                Float actual = UnityPracticeHost.systemTextScale(activity);
                assertNotNull("Android system text scale was unavailable", actual);
                assertEquals(platformScale, actual, 0.0001f);
            });
        }
    }

    @Test
    public void readyHintMarginsIncludeCutoutAndGestureInsetsWithoutConsumingThem() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                TextView hint = new TextView(activity);
                int side = 20;
                FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(400, 80, Gravity.BOTTOM);
                hint.setLayoutParams(params);

                UnityPracticeHost.applyReadyHintInsets(activity, hint, side, Insets.of(31, 7, 47, 29));

                FrameLayout.LayoutParams applied = (FrameLayout.LayoutParams) hint.getLayoutParams();
                assertEquals(side + 31, applied.leftMargin);
                assertEquals(7, applied.topMargin);
                assertEquals(side + 47, applied.rightMargin);
                assertTrue("gesture inset was not added to the baseline bottom margin", applied.bottomMargin > 29);
            });
        }
    }

    @Test
    public void readyVisibilityShowsLocalizedCueAndGenericVisibilityClearsIt() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            final FrameLayout[] layerRef = new FrameLayout[1];
            final TextView[] hintRef = new TextView[1];
            scenario.onActivity(activity -> {
                resetHost();
                FrameLayout layer = new FrameLayout(activity);
                TextView hint = new TextView(activity);
                hint.setVisibility(View.GONE);
                layer.addView(hint);
                layer.setVisibility(View.INVISIBLE);
                activity.addContentView(layer, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                ));
                setReadyHost(activity, layer);
                setStaticField("readyHintView", hint);
                layerRef[0] = layer;
                hintRef[0] = hint;
            });

            CountDownLatch ready = new CountDownLatch(1);
            AtomicBoolean readyApplied = new AtomicBoolean(false);
            UnityPracticeHost.setReadyVisible(
                OPERATION_ID,
                true,
                "Pull back · Watch · Flick forward",
                result -> {
                    readyApplied.set(result);
                    ready.countDown();
                }
            );
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            assertTrue(readyApplied.get());
            assertEquals(View.VISIBLE, layerRef[0].getVisibility());
            assertEquals(View.VISIBLE, hintRef[0].getVisibility());
            assertEquals("Pull back · Watch · Flick forward", hintRef[0].getText().toString());

            CountDownLatch runup = new CountDownLatch(1);
            UnityPracticeHost.setVisible(OPERATION_ID, true, result -> runup.countDown());
            assertTrue(runup.await(5, TimeUnit.SECONDS));
            assertEquals(View.VISIBLE, layerRef[0].getVisibility());
            assertEquals(View.GONE, hintRef[0].getVisibility());
        }
    }

    @Test
    public void visibleUnityPreservesTheWebSemanticAccessibilityMirror() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            final WebView[] webViewRef = new WebView[1];
            scenario.onActivity(activity -> {
                resetHost();
                WebView webView = (WebView) invokePrivate(
                    "findWebView",
                    new Class<?>[] { View.class },
                    activity.findViewById(android.R.id.content)
                );
                assertNotNull("Capacitor WebView was not attached", webView);
                webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
                webView.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);

                FrameLayout layer = new FrameLayout(activity);
                layer.setVisibility(View.INVISIBLE);
                activity.addContentView(layer, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                ));
                setReadyHost(activity, layer);
                webViewRef[0] = webView;
            });

            CountDownLatch visible = new CountDownLatch(1);
            AtomicBoolean applied = new AtomicBoolean(false);
            UnityPracticeHost.setVisible(OPERATION_ID, true, result -> {
                applied.set(result);
                visible.countDown();
            });
            assertTrue(visible.await(5, TimeUnit.SECONDS));
            assertTrue(applied.get());

            scenario.onActivity(activity -> {
                assertEquals(
                    "Unity hid the React/TalkBack semantic mirror",
                    View.IMPORTANT_FOR_ACCESSIBILITY_YES,
                    webViewRef[0].getImportantForAccessibility()
                );
                assertEquals(
                    "Unity blocked the semantic mirror's descendants",
                    ViewGroup.FOCUS_AFTER_DESCENDANTS,
                    webViewRef[0].getDescendantFocusability()
                );
            });
        }
    }

    @Test
    public void backIsIgnoredWithoutUnloadingReadyOrActiveUnityDelivery() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            final FrameLayout[] layerRef = new FrameLayout[1];
            final TextView[] hintRef = new TextView[1];
            final AtomicInteger errors = new AtomicInteger();
            scenario.onActivity(activity -> {
                resetHost();
                FrameLayout layer = new FrameLayout(activity);
                TextView hint = new TextView(activity);
                hint.setVisibility(View.GONE);
                layer.addView(hint);
                layer.setVisibility(View.INVISIBLE);
                activity.addContentView(layer, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                ));
                setReadyHost(activity, layer);
                setStaticField("readyHintView", hint);
                setStaticField("callback", new NoOpCallback() {
                    @Override
                    public void onError(String operationId, String code, String detail) {
                        errors.incrementAndGet();
                    }
                });
                layerRef[0] = layer;
                hintRef[0] = hint;
            });

            CountDownLatch ready = new CountDownLatch(1);
            UnityPracticeHost.setReadyVisible(
                OPERATION_ID,
                true,
                "Pull back · Watch · Flick forward · Do nothing to leave",
                result -> ready.countDown()
            );
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            assertTrue("Back was not consumed during the ready phase", UnityPracticeHost.onBackPressed());
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertEquals(View.VISIBLE, layerRef[0].getVisibility());
            assertEquals(View.VISIBLE, hintRef[0].getVisibility());
            assertTrue(UnityPracticeHost.ownsOperation(OPERATION_ID));
            assertEquals("Back reported a lifecycle failure during ready", 0, errors.get());

            CountDownLatch active = new CountDownLatch(1);
            UnityPracticeHost.setVisible(OPERATION_ID, true, result -> active.countDown());
            assertTrue(active.await(5, TimeUnit.SECONDS));
            assertEquals(View.GONE, hintRef[0].getVisibility());
            assertTrue("Back was not consumed during the active delivery", UnityPracticeHost.onBackPressed());
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertEquals(View.VISIBLE, layerRef[0].getVisibility());
            assertTrue(UnityPracticeHost.ownsOperation(OPERATION_ID));
            assertEquals("Back reported a lifecycle failure during a delivery", 0, errors.get());

            CountDownLatch hidden = new CountDownLatch(1);
            UnityPracticeHost.setVisible(OPERATION_ID, false, result -> hidden.countDown());
            assertTrue(hidden.await(5, TimeUnit.SECONDS));
            assertFalse("Hidden Unity swallowed normal React navigation", UnityPracticeHost.onBackPressed());
        }
    }

    @Test
    public void managedUnloadAdvisoryCannotCertifyPhysicalUnload() throws Exception {
        CountDownLatch physicallyUnloaded = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("UNLOADING"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", new Object());
            setStaticField("callback", new NoOpCallback() {
                @Override
                public void onUnloaded(String operationId) {
                    physicallyUnloaded.countDown();
                }
            });
        });

        UnityPracticeHost.unloadedFromUnity(OPERATION_ID);
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();

        assertTrue("managed advisory released the runtime guard", UnityPracticeHost.ownsOperation(OPERATION_ID));
        assertEquals(1L, physicallyUnloaded.getCount());

        Method lifecycleCallback = UnityPracticeHost.class.getDeclaredMethod(
            "lifecycleCallback",
            Object.class,
            Method.class,
            Object[].class,
            String.class
        );
        lifecycleCallback.setAccessible(true);
        Method physicalSignal = LifecycleProbe.class.getDeclaredMethod("onUnityPlayerUnloaded");
        lifecycleCallback.invoke(null, null, physicalSignal, null, OPERATION_ID);

        assertTrue("physical lifecycle callback timed out", physicallyUnloaded.await(5, TimeUnit.SECONDS));
        assertFalse(UnityPracticeHost.attached());
    }

    @Test
    public void missingActivityRejectsLaunchInsteadOfLeavingAnUnownedReservation() {
        AtomicReference<String> code = new AtomicReference<>();
        AtomicInteger errors = new AtomicInteger();
        UnityPracticeHost.attach(null, OPERATION_ID, "unused", new NoOpCallback() {
            @Override
            public void onError(String operationId, String errorCode, String detail) {
                assertEquals(OPERATION_ID, operationId);
                code.set(errorCode);
                errors.incrementAndGet();
            }
        });

        assertEquals(1, errors.get());
        assertEquals("lifecycle", code.get());
        assertFalse(UnityPracticeHost.attached());
    }

    @Test
    public void backgroundPauseWaitsForItsProtocolAckThenResumesTheSamePlayer() {
        LifecyclePlayer player = new LifecyclePlayer();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("READY"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", player);
            setStaticField("activityStarted", true);
            setStaticField("playerStarted", true);
            UnityPracticeHost.onHostPause();
        });

        assertEquals("native player paused before the host.pause ACK", 0, player.pauses.get());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            setStaticField("pendingLifecyclePauseMessageId", "pause-message-1");
            invokePrivate(
                "completeLifecyclePauseAfterAckOnMain",
                new Class<?>[] { String.class, String.class },
                OPERATION_ID,
                "different-message"
            );
        });
        assertEquals("an unrelated ACK paused the native player", 0, player.pauses.get());

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            invokePrivate(
                "completeLifecyclePauseAfterAckOnMain",
                new Class<?>[] { String.class, String.class },
                OPERATION_ID,
                "pause-message-1"
            )
        );
        assertEquals(1, player.pauses.get());

        InstrumentationRegistry.getInstrumentation().runOnMainSync(UnityPracticeHost::onHostResume);
        assertEquals(1, player.resumes.get());
    }

    @Test
    public void foregroundNeverResumesAnUnpausedOrBlockedRuntime() {
        LifecyclePlayer player = new LifecyclePlayer();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("READY"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", player);
            setStaticField("activityStarted", true);
            setStaticField("playerStarted", true);
            UnityPracticeHost.onHostResume();
            setStaticField("state", enumValue("BLOCKED"));
            setStaticField("playerPaused", true);
            UnityPracticeHost.onHostResume();
        });

        assertEquals("foreground resumed a runtime outside the owned paused READY state", 0, player.resumes.get());
    }

    @Test
    public void stoppedRuntimeReceivesUnity6LifecycleInOrderAndRestartsTheSamePlayer() {
        LifecyclePlayer player = new LifecyclePlayer();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("READY"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", player);
            setStaticField("activityStarted", true);
            setStaticField("playerStarted", true);
            UnityPracticeHost.onHostPause();
            UnityPracticeHost.onHostStop();
        });

        assertEquals(1, player.pauses.get());
        assertEquals(1, player.stops.get());

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            UnityPracticeHost.onHostStart();
            UnityPracticeHost.onHostResume();
        });

        assertEquals(1, player.starts.get());
        assertEquals(1, player.resumes.get());
    }

    @Test
    public void lateAttachReplaysAlreadyFocusedActivityAfterStartAndResume() {
        FocusReplayPlayer player = new FocusReplayPlayer();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("LOADING"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", player);
            invokePrivate(
                "startAndResumePlayerOnMain",
                new Class<?>[] { Object.class, boolean.class },
                player,
                true
            );
        });

        assertEquals(Arrays.asList("start", "resume", "focus:true"), player.events);
        assertTrue((Boolean) getStaticField("playerStarted"));
        assertFalse((Boolean) getStaticField("playerPaused"));
    }

    @Test
    public void lateAttachWithoutFocusReceivesTheLaterExactFocusRecovery() {
        FocusReplayPlayer player = new FocusReplayPlayer();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("LOADING"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", player);
            invokePrivate(
                "startAndResumePlayerOnMain",
                new Class<?>[] { Object.class, boolean.class },
                player,
                false
            );
            UnityPracticeHost.onWindowFocusChanged(true);
        });
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();

        assertEquals(Arrays.asList("start", "resume", "focus:false", "focus:true"), player.events);
    }

    @Test
    public void preManagedEndpointCancellationQuarantinesWithoutCallingUnload() {
        UnloadProbePlayer player = new UnloadProbePlayer();
        AtomicInteger errors = new AtomicInteger();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("LOADING"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", player);
            setStaticField("playerStarted", true);
            setStaticField("playerPaused", false);
            setStaticField("runtimeEndpointLoaded", false);
            setStaticField("callback", new NoOpCallback() {
                @Override
                public void onError(String operationId, String code, String detail) {
                    errors.incrementAndGet();
                }
            });
            invokePrivate(
                "beginUnloadOnMain",
                new Class<?>[] { String.class },
                OPERATION_ID
            );
        });

        assertTrue(UnityPracticeHost.blocked());
        assertTrue(UnityPracticeHost.ownsOperation(OPERATION_ID));
        assertEquals("a pre-endpoint player was asked to unload", 0, player.unloads.get());
        assertEquals("the quarantined player was not paused", 1, player.pauses.get());
        assertEquals("the quarantined player was not stopped", 1, player.stops.get());
        assertEquals("the quarantine boundary must report exactly one failure", 1, errors.get());
        assertEquals("a quarantined generation remained visible to C#", "", UnityPracticeHost.pendingOperationIdFromUnity());

        UnityPracticeHost.onWindowFocusChanged(true);
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        assertEquals("a later focus callback woke the quarantined player", 0, player.focusChanges.get());
    }

    @Test
    public void postManagedEndpointCancellationUsesPhysicalUnloadPath() throws Exception {
        UnloadProbePlayer player = new UnloadProbePlayer();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            resetHost();
            setStaticField("state", enumValue("INITIALIZING"));
            setStaticField("operationId", OPERATION_ID);
            setStaticField("player", player);
            setStaticField("runtimeEndpointLoaded", true);
            setStaticField("callback", new NoOpCallback());
            invokePrivate(
                "beginUnloadOnMain",
                new Class<?>[] { String.class },
                OPERATION_ID
            );
        });

        assertTrue("the post-endpoint player never received unload", player.unloaded.await(2, TimeUnit.SECONDS));
        assertEquals(1, player.unloads.get());
        assertFalse("post-endpoint teardown was incorrectly quarantined", UnityPracticeHost.blocked());
        assertTrue("physical lifecycle completion must remain pending", UnityPracticeHost.ownsOperation(OPERATION_ID));
    }

    private static void setReadyHost(Activity activity, FrameLayout layer) {
        setStaticField("state", enumValue("READY"));
        setStaticField("operationId", OPERATION_ID);
        setStaticField("activity", activity);
        setStaticField("overlay", layer);
        setStaticField("player", new View(activity));
    }

    @SuppressWarnings({ "rawtypes", "unchecked" })
    private static Object enumValue(String name) {
        try {
            Class enumClass = Class.forName(UnityPracticeHost.class.getName() + "$State");
            return Enum.valueOf(enumClass, name);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError(error);
        }
    }

    private static void setStaticField(String name, Object value) {
        try {
            Field field = UnityPracticeHost.class.getDeclaredField(name);
            field.setAccessible(true);
            field.set(null, value);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError(error);
        }
    }

    private static Object getStaticField(String name) {
        try {
            Field field = UnityPracticeHost.class.getDeclaredField(name);
            field.setAccessible(true);
            return field.get(null);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError(error);
        }
    }

    private static void resetHost() {
        try {
            Method removeOverlay = UnityPracticeHost.class.getDeclaredMethod("removeOverlayAndRestoreWebContent");
            removeOverlay.setAccessible(true);
            removeOverlay.invoke(null);
            Method clearState = UnityPracticeHost.class.getDeclaredMethod("clearStateLocked");
            clearState.setAccessible(true);
            synchronized (UnityPracticeHost.class) {
                clearState.invoke(null);
            }
            setStaticField("activityPaused", false);
            setStaticField("activityStarted", false);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError(error);
        }
    }

    private static Object invokePrivate(String name, Class<?>[] parameterTypes, Object... arguments) {
        try {
            Method method = UnityPracticeHost.class.getDeclaredMethod(name, parameterTypes);
            method.setAccessible(true);
            return method.invoke(null, arguments);
        } catch (ReflectiveOperationException error) {
            throw new AssertionError(error);
        }
    }

    public static final class LifecyclePlayer {
        final AtomicInteger starts = new AtomicInteger();
        final AtomicInteger stops = new AtomicInteger();
        final AtomicInteger focusChanges = new AtomicInteger();
        final AtomicInteger pauses = new AtomicInteger();
        final AtomicInteger resumes = new AtomicInteger();

        public void onStart() {
            starts.incrementAndGet();
        }

        public void onStop() {
            stops.incrementAndGet();
        }

        public void onPause() {
            pauses.incrementAndGet();
        }

        public void onResume() {
            resumes.incrementAndGet();
        }
    }

    public static final class FocusReplayPlayer {
        final List<String> events = new ArrayList<>();

        public void onStart() {
            events.add("start");
        }

        public void onResume() {
            events.add("resume");
        }

        public void windowFocusChanged(boolean hasFocus) {
            events.add("focus:" + hasFocus);
        }
    }

    public static final class UnloadProbePlayer {
        final AtomicInteger unloads = new AtomicInteger();
        final AtomicInteger pauses = new AtomicInteger();
        final AtomicInteger stops = new AtomicInteger();
        final AtomicInteger focusChanges = new AtomicInteger();
        final CountDownLatch unloaded = new CountDownLatch(1);

        public void unload() {
            unloads.incrementAndGet();
            unloaded.countDown();
        }

        public void onPause() {
            pauses.incrementAndGet();
        }

        public void onStop() {
            stops.incrementAndGet();
        }

        public void windowFocusChanged(boolean hasFocus) {
            focusChanges.incrementAndGet();
        }
    }

    private static class NoOpCallback implements UnityPracticeHost.Callback {
        @Override
        public void onReady(String operationId, String packet) {}

        @Override
        public void onMessage(String operationId, String packet) {}

        @Override
        public void onUnloaded(String operationId) {}

        @Override
        public void onError(String operationId, String code, String detail) {}
    }
}
