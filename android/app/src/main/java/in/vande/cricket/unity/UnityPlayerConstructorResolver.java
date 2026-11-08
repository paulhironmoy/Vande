package in.vande.cricket.unity;

import android.content.Context;
import android.view.View;
import android.widget.FrameLayout;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/** Resolves only the exact public Unity 6 Activity/service player surface used by the verified export. */
final class UnityPlayerConstructorResolver {
    private UnityPlayerConstructorResolver() {}

    static Constructor<?> resolve(Class<?> playerClass, Class<?> lifecycleEventsClass) throws NoSuchMethodException {
        if (!lifecycleEventsClass.isInterface()) {
            throw new NoSuchMethodException("Unity lifecycle events type is not an interface.");
        }
        // Do not scan for an arbitrary Context + interface overload. The second parameter must be the exact
        // com.unity3d.player.IUnityPlayerLifecycleEvents class loaded from the verified Unity export.
        return playerClass.getConstructor(Context.class, lifecycleEventsClass);
    }

    static Method resolveFrameLayoutGetter(Class<?> playerClass) throws NoSuchMethodException {
        Method method = playerClass.getMethod("getFrameLayout");
        if (!FrameLayout.class.isAssignableFrom(method.getReturnType())) {
            throw new NoSuchMethodException("Unity getFrameLayout() does not return an Android FrameLayout.");
        }
        return method;
    }

    static Method resolveViewGetter(Class<?> playerClass) throws NoSuchMethodException {
        Method method = playerClass.getMethod("getView");
        if (!View.class.isAssignableFrom(method.getReturnType())) {
            throw new NoSuchMethodException("Unity getView() does not return an Android View.");
        }
        return method;
    }

    static Method resolveVoidMethod(Class<?> playerClass, String name, Class<?>... parameterTypes)
        throws NoSuchMethodException {
        Method method = playerClass.getMethod(name, parameterTypes);
        if (method.getReturnType() != void.class || Modifier.isStatic(method.getModifiers())) {
            throw new NoSuchMethodException("Unity " + name + " has an incompatible method shape.");
        }
        return method;
    }

    static Method resolveStaticVoidMethod(Class<?> playerClass, String name, Class<?>... parameterTypes)
        throws NoSuchMethodException {
        Method method = playerClass.getMethod(name, parameterTypes);
        if (method.getReturnType() != void.class || !Modifier.isStatic(method.getModifiers())) {
            throw new NoSuchMethodException("Unity " + name + " has an incompatible static method shape.");
        }
        return method;
    }

    static Object resolveMemoryUsage(Class<?> memoryUsageClass, String value) throws NoSuchMethodException {
        if (!memoryUsageClass.isEnum()) {
            throw new NoSuchMethodException("Unity memory usage type is not an enum.");
        }
        try {
            @SuppressWarnings({ "rawtypes", "unchecked" })
            Class enumType = memoryUsageClass.asSubclass(Enum.class);
            @SuppressWarnings({ "rawtypes", "unchecked" })
            Object resolved = Enum.valueOf(enumType, value);
            return resolved;
        } catch (IllegalArgumentException error) {
            throw new NoSuchMethodException("Unity memory usage enum is missing " + value + ".");
        }
    }
}
