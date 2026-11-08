/**
 * Unity WebGL files are tied to the React host's exact build id and integrity manifest.
 * Returning an older manifest, loader, data file or wasm binary is therefore a correctness
 * failure rather than a useful offline fallback.
 */
export function unityRuntimePathPrefix(base: string): string {
  const pathname = new URL(base || '/', 'https://vande.invalid/').pathname;
  const normalizedBase = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${normalizedBase}unity/`;
}

export function isUnityRuntimeRequest(url: URL, serviceWorkerOrigin: string, base: string): boolean {
  if (url.origin !== serviceWorkerOrigin) return false;
  const prefix = unityRuntimePathPrefix(base);
  return url.pathname === prefix.slice(0, -1) || url.pathname.startsWith(prefix);
}

export function isRuntimeImageOrJsonRequest(
  requestDestination: string,
  url: URL,
  serviceWorkerOrigin: string,
  base: string,
): boolean {
  return url.origin === serviceWorkerOrigin &&
    !isUnityRuntimeRequest(url, serviceWorkerOrigin, base) &&
    (requestDestination === 'image' || url.pathname.endsWith('.json'));
}
