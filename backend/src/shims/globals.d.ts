/**
 * Type-only shims for app modules the Worker shares through the `@/` alias (src/engine, src/lite, src/share).
 * Those modules mention a few browser globals only inside browser-only code paths (storage, page origin) that the
 * Worker never calls; Workers do not define them, so they are declared here for the type checker only.
 * `import.meta.env` is replaced at bundle time by the [define] table in wrangler.toml.
 */
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

declare const location: { readonly origin: string } | undefined;

interface ImportMetaEnv {
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Workers declare `crypto` as a global const, which TypeScript does not expose as `globalThis.crypto`; shared modules
 * read it that way (with a fallback). This makes the property visible to the type checker; at runtime it exists.
 */
declare namespace globalThis {
  // eslint-disable-next-line no-var
  var crypto: Crypto;
}
