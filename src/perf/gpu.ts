/**
 * The GPU behind WebGL: whether WebGL 2 works at all, and whether it is a real GPU or a software rasteriser. This
 * file is the only place that recognises software renderers (Practice's benchmark and the stage both use it).
 */

/**
 * Software rasterisers and generic fallbacks: SwiftShader (Chrome's, also inside ANGLE strings), Mesa llvmpipe and
 * softpipe, lavapipe (Vulkan), the Windows Basic Render Driver, Apple's software renderer and Mesa offscreen.
 */
export const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|lavapipe|softpipe|basic render|apple software renderer|mesa offscreen|software rasterizer|\bsoftware\b/i;

/** True for a software rasteriser (an empty or unknown string is not assumed to be software). */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  return typeof renderer === 'string' && SOFTWARE_RENDERER_RE.test(renderer);
}

type GL = WebGL2RenderingContext | WebGLRenderingContext;

/**
 * The renderer string: the unmasked one through WEBGL_debug_renderer_info where the browser still offers it
 * (Chrome, Android WebView), otherwise RENDERER (which modern browsers already fill with a sanitised real name).
 * Never sent anywhere; it is shown only in the on-device diagnostics.
 */
export function readGpuRenderer(gl: GL | null | undefined): string {
  if (!gl) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    const unmasked = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    if (typeof unmasked === 'string' && unmasked) return unmasked.slice(0, 200);
    const plain = gl.getParameter(gl.RENDERER);
    return typeof plain === 'string' ? plain.slice(0, 200) : '';
  } catch {
    return '';
  }
}

export interface GpuProbe {
  webgl2: boolean;
  renderer: string;
  hardware: boolean;
}

/**
 * Probes WebGL 2 on a throwaway canvas (used when no stage could be created, so the assessment still says why).
 * The context is released straight away.
 */
export function probeGpu(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): GpuProbe {
  if (!doc) return { webgl2: false, renderer: '', hardware: false };
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null;
    if (!gl) return { webgl2: false, renderer: '', hardware: false };
    const renderer = readGpuRenderer(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer, hardware: !isSoftwareRenderer(renderer) };
  } catch {
    return { webgl2: false, renderer: '', hardware: false };
  }
}
