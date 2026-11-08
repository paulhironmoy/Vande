/**
 * PackLoader: downloads the camera pack when the player chose Camera, checks every file against its sha256 before it is kept,
 * stores it for offline Practice and unpacks it for the worker (docs/PRACTICE_CAMERA_INPUT.md §2). Stall detection, one retry,
 * cancel, exact progress (the byte counts are known at build time). Nothing is ever fetched before ensure() is called, and
 * nothing is stored that did not match its hash. In a build that bundles the pack the files are same-origin assets read each
 * time (no download, no copy).
 */
import type { CameraProblem } from './types';
import type { CameraPackInfo, PackFile, PackStatus } from './pack';
import type { PackStore } from './store';

export class PackError extends Error {
  readonly problem: CameraProblem;
  constructor(problem: CameraProblem, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PackError';
    this.problem = problem;
  }
}

export interface UnpackedPack {
  engine: ArrayBuffer;
  worker: ArrayBuffer;
  model: ArrayBuffer;
}

export interface PackLoaderOptions {
  info: CameraPackInfo;
  /** Base URL of the pack folder's parent (the app's base, or a store build's remote base). */
  base: string;
  store: PackStore | null;
  /** Same-origin assets read on every start; no download, no copy. */
  bundled?: boolean;
  fetch?: typeof fetch;
  /** No bytes for this long is a stall (ms). */
  stallMs?: number;
  /** Attempts per file (the first and one retry). */
  maxAttempts?: number;
  online?: () => boolean;
  /** Free space in bytes if the browser says (navigator.storage.estimate). */
  freeBytes?: () => Promise<number | null>;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function gunzip(blob: Blob): Promise<ArrayBuffer> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** True when the engine can unpack the pack (DecompressionStream with gzip and Blob streams). */
export function canUnpack(): boolean {
  return (
    typeof DecompressionStream === 'function' &&
    typeof Blob !== 'undefined' &&
    typeof Blob.prototype.stream === 'function'
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PackLoader {
  private readonly o: PackLoaderOptions;
  private st: PackStatus;
  private readonly subs = new Set<() => void>();

  constructor(o: PackLoaderOptions) {
    this.o = o;
    this.st = {
      state: 'absent',
      bytesDone: 0,
      bytesTotal: o.info.totalBytes,
      attempt: 0,
      maxAttempts: o.maxAttempts ?? 2,
    };
  }

  status(): PackStatus {
    return this.st;
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private set(patch: Partial<PackStatus>) {
    this.st = { ...this.st, ...patch };
    for (const cb of [...this.subs]) cb();
  }

  private key(f: PackFile) {
    return `${this.o.info.id}/${f.name}`;
  }

  private url(f: PackFile) {
    return `${this.o.base}${this.o.info.dir}${f.file}`;
  }

  /** True when every file is stored (or the pack is bundled). */
  async isCached(): Promise<boolean> {
    if (this.o.bundled) return true;
    const store = this.o.store;
    if (!store) return false;
    for (const f of this.o.info.files) if (!(await store.get(this.key(f)))) return false;
    return true;
  }

  /** Downloads what is missing. Rejects with a PackError (problem: offline, space, download_failed, verify_failed). */
  async ensure(signal?: AbortSignal): Promise<void> {
    const { info } = this.o;
    if (this.o.bundled) return this.set({ state: 'cached', bytesDone: info.totalBytes });
    const store = this.o.store;
    if (!store) throw new PackError('unsupported', 'no storage for the camera files');
    this.set({ state: 'checking', bytesDone: 0, attempt: 0 });
    await store.keepOnly(`${info.id}/`);
    const missing: PackFile[] = [];
    let have = 0;
    for (const f of info.files) {
      if (await store.get(this.key(f))) have += f.bytes;
      else missing.push(f);
    }
    if (!missing.length) return this.set({ state: 'cached', bytesDone: info.totalBytes });
    if (this.o.online && !this.o.online()) {
      this.set({ state: 'absent' });
      throw new PackError('offline', 'the camera files are not stored and there is no network');
    }
    const need = missing.reduce((n, f) => n + f.bytes, 0);
    const free = await this.o.freeBytes?.();
    if (free != null && free < need * 3) {
      this.set({ state: 'absent' });
      throw new PackError('space', 'not enough free storage for the camera files');
    }
    let done = have;
    this.set({ state: 'downloading', bytesDone: done });
    try {
      for (const f of missing) {
        const blob = await this.download(f, done, signal);
        try {
          await store.put(this.key(f), blob);
        } catch (e) {
          throw new PackError('space', `could not store ${f.name}`, e);
        }
        done += f.bytes;
        this.set({ bytesDone: done });
      }
    } catch (e) {
      this.set({ state: 'absent', bytesDone: 0 });
      throw e;
    }
    this.set({ state: 'cached', bytesDone: info.totalBytes });
  }

  private async download(f: PackFile, doneBefore: number, signal?: AbortSignal): Promise<Blob> {
    const maxAttempts = this.st.maxAttempts;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      this.set({ attempt, state: attempt === 1 ? 'downloading' : 'retrying', bytesDone: doneBefore });
      if (attempt > 1) await sleep(400);
      try {
        const blob = await this.fetchOnce(f, doneBefore, signal);
        this.set({ state: 'verifying' });
        const hash = await sha256Hex(await blob.arrayBuffer());
        if (hash !== f.sha256) throw new PackError('verify_failed', `${f.name} does not match its checksum`);
        this.set({ state: 'downloading' });
        return blob;
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError' && signal?.aborted))
          throw new DOMException('cancelled', 'AbortError');
        lastError = e;
      }
    }
    if (lastError instanceof PackError) throw lastError;
    throw new PackError('download_failed', lastError instanceof Error ? lastError.message : String(lastError));
  }

  private async fetchOnce(f: PackFile, doneBefore: number, signal?: AbortSignal): Promise<Blob> {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        this.set({ state: 'stalled' });
        ctl.abort();
      }, this.o.stallMs ?? 8000);
    };
    try {
      arm();
      const res = await (this.o.fetch ?? fetch)(this.url(f), { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        parts.push(value);
        got += value.length;
        if (this.st.state === 'stalled') this.set({ state: 'downloading' });
        this.set({ bytesDone: doneBefore + Math.min(got, f.bytes) });
      }
      if (got !== f.bytes) throw new PackError('verify_failed', `${f.name} has ${got} bytes, expected ${f.bytes}`);
      return new Blob(parts as BlobPart[]);
    } catch (e) {
      if (stalled) throw new Error(`${f.name}: no data for ${(this.o.stallMs ?? 8000) / 1000} s`, { cause: e });
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** The unpacked files (engine WASM, worker script, model), checked once more against their sizes. */
  async read(): Promise<UnpackedPack> {
    const out: Partial<Record<PackFile['name'], ArrayBuffer>> = {};
    for (const f of this.o.info.files) {
      let blob: Blob | undefined;
      if (this.o.bundled) {
        const res = await (this.o.fetch ?? fetch)(this.url(f));
        if (!res.ok) throw new PackError('download_failed', `${f.file}: ${res.status}`);
        blob = await res.blob();
        if ((await sha256Hex(await blob.arrayBuffer())) !== f.sha256)
          throw new PackError('verify_failed', `${f.name} does not match its checksum`);
      } else blob = await this.o.store?.get(this.key(f));
      if (!blob) throw new PackError('download_failed', `${f.name} is not stored`);
      const bytes = f.gzip ? await gunzip(blob) : await blob.arrayBuffer();
      if (bytes.byteLength !== f.rawBytes)
        throw new PackError('verify_failed', `${f.name} unpacked to ${bytes.byteLength} bytes, expected ${f.rawBytes}`);
      out[f.name] = bytes;
    }
    return out as UnpackedPack;
  }
}
