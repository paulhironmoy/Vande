/** Type-only shims for the Worker build: the local harness reads `import.meta.url`, which Workers types do not declare. */
interface ImportMeta {
  readonly url: string;
}

/** src/contracts/renderer.ts names the canvas type in the renderer interface the Worker never uses. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- an empty interface is the whole shim: it only declares the name that src/contracts/renderer.ts mentions
interface HTMLCanvasElement {}
