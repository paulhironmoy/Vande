/** Keep native activity state and document visibility paired; foreground never auto-resumes play. */
interface ListenerHandle {
  remove(): Promise<void>;
}
interface NativeLifecycle {
  addListener(event: 'pause' | 'resume', listener: () => void): Promise<ListenerHandle>;
}

export function bindPracticeLifecycle(
  setHidden: (hidden: boolean) => void,
  // Keep the plugin boxed: Capacitor proxies expose a `then` property and cannot be Promise results themselves.
  loadNative?: () => Promise<{ App: NativeLifecycle }>,
): () => void {
  let disposed = false;
  let nativePaused = false;
  let lastHidden: boolean | undefined;
  const handles: ListenerHandle[] = [];
  const publish = () => {
    if (disposed) return;
    const hidden = nativePaused || document.visibilityState === 'hidden';
    if (hidden === lastHidden) return;
    lastHidden = hidden;
    setHidden(hidden);
  };
  const remove = (handle: ListenerHandle) => {
    void handle.remove().catch((error) => console.error('Practice lifecycle listener cleanup failed', error));
  };
  const retain = (handle: ListenerHandle) => {
    if (disposed) remove(handle);
    else handles.push(handle);
  };
  document.addEventListener('visibilitychange', publish);
  publish();
  if (loadNative) {
    void loadNative()
      .then(async ({ App: app }) => {
        if (disposed) return;
        await Promise.all([
          app
            .addListener('pause', () => {
              nativePaused = true;
              publish();
            })
            .then(retain),
          app
            .addListener('resume', () => {
              nativePaused = false;
              publish();
            })
            .then(retain),
        ]);
      })
      .catch((error) => console.error('Practice native lifecycle registration failed', error));
  }
  return () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('visibilitychange', publish);
    handles.splice(0).forEach(remove);
  };
}
