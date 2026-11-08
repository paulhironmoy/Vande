package in.vande.cricket.unity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.view.View;
import android.widget.FrameLayout;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import org.junit.Test;

public final class UnityPlayerConstructorResolverTest {
    private interface ExpectedLifecycle {}

    private interface UnrelatedLifecycle {}

    public static final class PlayerWithSeveralInterfaces {
        public PlayerWithSeveralInterfaces(Context context, UnrelatedLifecycle lifecycle) {}

        public PlayerWithSeveralInterfaces(Context context, ExpectedLifecycle lifecycle) {}
    }

    public static final class PlayerWithoutExpectedLifecycle {
        public PlayerWithoutExpectedLifecycle(Context context, UnrelatedLifecycle lifecycle) {}
    }

    public static final class Unity60003PlayerShape {
        public enum MemoryUsage {
            Medium,
            High,
            Critical,
        }

        public Unity60003PlayerShape(Context context, ExpectedLifecycle lifecycle) {}

        public FrameLayout getFrameLayout() {
            return null;
        }

        public View getView() {
            return null;
        }

        public void onStart() {}

        public void onStop() {}

        public void onResume() {}

        public void onPause() {}

        public void windowFocusChanged(boolean hasFocus) {}

        public void unload() {}

        public void onTrimMemory(MemoryUsage usage) {}

        public static void UnitySendMessage(String object, String method, String value) {}
    }

    public static final class PlayerWithWrongRootView {
        public Object getFrameLayout() {
            return null;
        }
    }

    public static final class PlayerWithStaticLifecycle {
        public static void onStart() {}
    }

    public static final class PlayerWithInstanceSend {
        public void UnitySendMessage(String object, String method, String value) {}
    }

    public enum IncompleteMemoryUsage {
        Medium,
        High,
    }

    @Test
    public void selectsOnlyTheExactLifecycleInterfaceOverload() throws Exception {
        Constructor<?> selected = UnityPlayerConstructorResolver.resolve(
            PlayerWithSeveralInterfaces.class,
            ExpectedLifecycle.class
        );

        assertEquals(ExpectedLifecycle.class, selected.getParameterTypes()[1]);
    }

    @Test
    public void refusesAnArbitraryContextAndInterfaceConstructor() throws Exception {
        try {
            UnityPlayerConstructorResolver.resolve(PlayerWithoutExpectedLifecycle.class, ExpectedLifecycle.class);
            fail("Expected the exact lifecycle overload to be required");
        } catch (NoSuchMethodException expected) {
            // Expected: an unrelated interface is not a lifecycle callback authority.
        }
    }

    @Test
    public void refusesANonInterfaceLifecycleType() throws Exception {
        try {
            UnityPlayerConstructorResolver.resolve(PlayerWithSeveralInterfaces.class, String.class);
            fail("Expected a non-interface lifecycle type to be refused");
        } catch (NoSuchMethodException expected) {
            // Expected.
        }
    }

    @Test
    public void resolvesTheExactUnity60003EmbeddingSurface() throws Exception {
        Method frameLayout = UnityPlayerConstructorResolver.resolveFrameLayoutGetter(Unity60003PlayerShape.class);
        Method view = UnityPlayerConstructorResolver.resolveViewGetter(Unity60003PlayerShape.class);
        Method start = UnityPlayerConstructorResolver.resolveVoidMethod(Unity60003PlayerShape.class, "onStart");
        Method focus = UnityPlayerConstructorResolver.resolveVoidMethod(
            Unity60003PlayerShape.class,
            "windowFocusChanged",
            boolean.class
        );
        Method trim = UnityPlayerConstructorResolver.resolveVoidMethod(
            Unity60003PlayerShape.class,
            "onTrimMemory",
            Unity60003PlayerShape.MemoryUsage.class
        );
        Method send = UnityPlayerConstructorResolver.resolveStaticVoidMethod(
            Unity60003PlayerShape.class,
            "UnitySendMessage",
            String.class,
            String.class,
            String.class
        );

        assertEquals("getFrameLayout", frameLayout.getName());
        assertTrue(FrameLayout.class.isAssignableFrom(frameLayout.getReturnType()));
        assertEquals("getView", view.getName());
        assertTrue(View.class.isAssignableFrom(view.getReturnType()));
        assertEquals("onStart", start.getName());
        assertEquals("windowFocusChanged", focus.getName());
        assertEquals(boolean.class, focus.getParameterTypes()[0]);
        assertEquals("onTrimMemory", trim.getName());
        assertEquals("UnitySendMessage", send.getName());
        assertEquals(
            Unity60003PlayerShape.MemoryUsage.Critical,
            UnityPlayerConstructorResolver.resolveMemoryUsage(
                Unity60003PlayerShape.MemoryUsage.class,
                "Critical"
            )
        );
    }

    @Test
    public void refusesIncompatibleViewLifecycleMemoryAndMessageShapes() throws Exception {
        expectMissing(() -> UnityPlayerConstructorResolver.resolveFrameLayoutGetter(PlayerWithWrongRootView.class));
        expectMissing(() -> UnityPlayerConstructorResolver.resolveVoidMethod(PlayerWithStaticLifecycle.class, "onStart"));
        expectMissing(() -> UnityPlayerConstructorResolver.resolveMemoryUsage(IncompleteMemoryUsage.class, "Critical"));
        expectMissing(() -> UnityPlayerConstructorResolver.resolveMemoryUsage(String.class, "Critical"));
        expectMissing(() -> UnityPlayerConstructorResolver.resolveStaticVoidMethod(
            PlayerWithInstanceSend.class,
            "UnitySendMessage",
            String.class,
            String.class,
            String.class
        ));
    }

    private static void expectMissing(ThrowingRunnable action) throws Exception {
        try {
            action.run();
            fail("Expected an incompatible Unity API shape to be refused");
        } catch (NoSuchMethodException expected) {
            // Expected: reflection admission is exact and fail closed.
        }
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
