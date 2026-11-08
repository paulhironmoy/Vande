/** The Emscripten module loader of the pinned engine (an ES module that also sets globalThis.ModuleFactory). */
declare module '@mediapipe/tasks-vision/vision_wasm_module_internal.js' {
  const ModuleFactory: (moduleArg?: Record<string, unknown>) => Promise<unknown>;
  export default ModuleFactory;
}
