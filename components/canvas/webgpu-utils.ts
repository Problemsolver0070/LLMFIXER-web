export type ShaderComplexity = "full" | "reduced" | "minimal";

export interface GPUTier {
  tier: "high" | "medium" | "low" | "none";
  renderer: "webgpu" | "webgl2";
  maxParticles: number;
  shaderComplexity: ShaderComplexity;
}

const TIER_CONFIG: Record<GPUTier["tier"], Omit<GPUTier, "tier" | "renderer">> = {
  high: { maxParticles: 500_000, shaderComplexity: "full" },
  medium: { maxParticles: 200_000, shaderComplexity: "reduced" },
  low: { maxParticles: 100_000, shaderComplexity: "reduced" },
  none: { maxParticles: 50_000, shaderComplexity: "minimal" },
};

/**
 * Known high-end mobile GPU families (partial match against renderer string).
 * These GPUs can comfortably handle 150K+ particles in WebGL2 CPU-fallback mode.
 */
const HIGH_END_GPU_PATTERNS = [
  "apple gpu",        // Apple A-series / M-series
  "adreno 7",         // Snapdragon 8 Gen 1/2/3/4
  "adreno 8",         // Snapdragon 8 Elite
  "mali-g7",          // Arm Mali-G710/G715/G720/G725
  "mali-g8",          // Future high-end Mali
  "xclipse",          // Samsung Xclipse (Exynos RDNA)
  "immortalis",       // Arm Immortalis GPU
];

/**
 * Detect GPU renderer string from WebGL context.
 * Uses WEBGL_debug_renderer_info extension when available.
 */
function getWebGLRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return null;

    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) {
      return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    }

    return gl.getParameter(gl.RENDERER) as string;
  } catch {
    return null;
  }
}

/**
 * Estimate device capability when WebGPU is unavailable.
 * Uses hardware signals to classify into tiers.
 */
function detectWebGL2Tier(): GPUTier {
  const cores = navigator.hardwareConcurrency ?? 0;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 0;
  const gpuRenderer = getWebGLRenderer()?.toLowerCase() ?? "";
  const screenPixels = window.screen.width * window.screen.height * (window.devicePixelRatio ?? 1);

  // Check for known high-end GPU
  const hasHighEndGPU = HIGH_END_GPU_PATTERNS.some((p) => gpuRenderer.includes(p));

  // High-end mobile or capable desktop without WebGPU
  if (hasHighEndGPU || cores >= 8 || memory >= 8) {
    return {
      tier: "medium",
      renderer: "webgl2",
      maxParticles: 150_000,
      shaderComplexity: "reduced",
    };
  }

  // Mid-range device
  if (cores >= 4 || memory >= 4 || screenPixels > 2_000_000) {
    return {
      tier: "low",
      renderer: "webgl2",
      maxParticles: 80_000,
      shaderComplexity: "reduced",
    };
  }

  // True low-end fallback
  return { tier: "none", renderer: "webgl2", ...TIER_CONFIG.none };
}

export async function detectGPUTier(): Promise<GPUTier> {
  // Server-side or no GPU API at all
  if (typeof navigator === "undefined") {
    return { tier: "none", renderer: "webgl2", ...TIER_CONFIG.none };
  }

  // Try WebGPU first
  if ("gpu" in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const limits = adapter.limits;
        const maxBufferSize = limits.maxStorageBufferBindingSize;
        const maxComputeInvocations = limits.maxComputeInvocationsPerWorkgroup;

        if (maxBufferSize >= 256 * 1024 * 1024 && maxComputeInvocations >= 256) {
          return { tier: "high", renderer: "webgpu", ...TIER_CONFIG.high };
        }

        if (maxBufferSize >= 128 * 1024 * 1024) {
          return { tier: "medium", renderer: "webgpu", ...TIER_CONFIG.medium };
        }

        return { tier: "low", renderer: "webgpu", ...TIER_CONFIG.low };
      }
    } catch {
      // WebGPU request failed, fall through to WebGL2 detection
    }
  }

  // WebGL2 fallback with actual capability detection
  return detectWebGL2Tier();
}
