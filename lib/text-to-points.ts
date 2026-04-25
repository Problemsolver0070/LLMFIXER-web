/**
 * text-to-points — rasterizes a string into an offscreen canvas and
 * rejection-samples its non-transparent pixels to produce a Float32Array
 * of (x, y, z) particle target positions in normalized space.
 *
 * Output coordinate space:
 *   x ∈ ~[-1, 1]            (proportional to text width;  half-width = 1.0)
 *   y ∈ ~[-h/w, h/w]        (preserves the rendered aspect ratio)
 *   z ∈ ~[-0.3, 0.3]        (small Gaussian jitter for depth)
 *
 * The returned points are intended to be re-projected into world space
 * via `screenRectToWorldPoints` so they visually overlay the live <h2>.
 *
 * Browser support: uses `OffscreenCanvas` when available (Chromium / FF),
 * falls back to a hidden `<canvas>` (Safari ≤ 16). Both code paths use
 * the same 2D context API so the sampling logic is shared.
 *
 * Cost: ~5-15 ms one-time per heading on mount (rasterization + sampling
 * of ~2500 points). Not on the render hot path.
 */

export interface TextToPointsOptions {
  /** Pixel size of the rendered text. 64 reads as a hero-tier headline at 1× DPR. */
  fontSize: number;
  /** CSS font stack. Defaults match the site's body font. */
  fontFamily?: string;
  /** Number of (x,y,z) points to emit. Default 2500. */
  sampleCount?: number;
  /** ±jitter applied to xy in normalized units to avoid pixel-grid alignment. */
  jitter?: number;
  /** Font weight (numeric or keyword). Defaults to 300 (matches `font-light`). */
  fontWeight?: number | string;
  /**
   * Horizontal padding (px) around the text to give the bitmap breathing
   * room and avoid clipping. Default = fontSize.
   */
  padding?: number;
}

/* ------------------------------------------------------------------ */
/*  Canvas factory — OffscreenCanvas with DOM fallback                */
/* ------------------------------------------------------------------ */

interface CanvasLike {
  width: number;
  height: number;
  getContext(id: "2d"): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

function createCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  }
  // DOM fallback (Safari ≤ 16). The element is never attached to the DOM,
  // so it does not affect layout and is GC'd when this function returns.
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c as unknown as CanvasLike;
}

/* ------------------------------------------------------------------ */
/*  Box-Muller Gaussian (mean 0, stddev 1) — used for z-jitter        */
/* ------------------------------------------------------------------ */

function gauss(): number {
  const u = Math.random() || 1e-9;
  const v = Math.random() || 1e-9;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Rasterize `text` and rejection-sample its filled pixels into a
 * Float32Array of (x, y, z) triples in normalized space.
 *
 * @returns Flat Float32Array of length `sampleCount * 3` (or fewer if
 *          the rendered text was too sparse — caller should treat the
 *          actual count as `result.length / 3`).
 */
export function textToPoints(
  text: string,
  opts: TextToPointsOptions,
): Float32Array {
  const {
    fontSize,
    fontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif",
    sampleCount = 2500,
    jitter = 0.02,
    fontWeight = 300,
    padding,
  } = opts;

  // SSR guard — return an empty buffer if called server-side.
  if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") {
    return new Float32Array(0);
  }

  // ---- Probe text metrics with a measurement context ----
  const probe = createCanvas(8, 8);
  const probeCtx = probe.getContext("2d");
  if (!probeCtx) return new Float32Array(0);
  const fontDecl = `${fontWeight} ${fontSize}px ${fontFamily}`;
  probeCtx.font = fontDecl;
  const metrics = probeCtx.measureText(text);
  const textWidth = Math.max(1, Math.ceil(metrics.width));
  // Use ascent/descent if available; fall back to ~1.2× fontSize for height.
  const ascent =
    metrics.actualBoundingBoxAscent ??
    metrics.fontBoundingBoxAscent ??
    fontSize * 0.85;
  const descent =
    metrics.actualBoundingBoxDescent ??
    metrics.fontBoundingBoxDescent ??
    fontSize * 0.25;
  const textHeight = Math.max(1, Math.ceil(ascent + descent));

  const pad = padding ?? Math.ceil(fontSize * 0.5);
  const canvasW = textWidth + pad * 2;
  const canvasH = textHeight + pad * 2;

  // ---- Render at full resolution ----
  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Float32Array(0);

  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.font = fontDecl;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(text, pad, pad + ascent);

  // ---- Read back pixels ----
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  } catch {
    // Tainted-canvas guard (defensive — we never load cross-origin fonts).
    return new Float32Array(0);
  }
  const data = imageData.data;

  // ---- Build a flat list of filled pixel indices, then rejection-sample ----
  // For text the density is sparse (a few % filled), so collecting indices
  // first and uniform-sampling them is more efficient than rejection over
  // the full bitmap.
  const filled: number[] = [];
  const totalPixels = canvasW * canvasH;
  for (let i = 0; i < totalPixels; i++) {
    // Alpha threshold of ~32 keeps anti-aliased edges as candidates while
    // rejecting near-transparent fringes.
    if (data[i * 4 + 3] > 32) filled.push(i);
  }

  if (filled.length === 0) return new Float32Array(0);

  // ---- Coordinate normalization ----
  // Map x ∈ [pad, pad+textWidth] → [-1, 1] (half-width = textWidth/2).
  // Map y ∈ [pad, pad+textHeight] → [-aspect, aspect] preserving ratio.
  const halfW = textWidth / 2;
  const halfH = textHeight / 2;
  const cx = pad + halfW;
  const cy = pad + halfH;
  const aspectY = halfH / halfW; // typical for a single-line headline ~0.18

  const out = new Float32Array(sampleCount * 3);
  const n = filled.length;

  for (let s = 0; s < sampleCount; s++) {
    const px = filled[(Math.random() * n) | 0];
    const py = (px / canvasW) | 0;
    const pxx = px - py * canvasW;

    // Normalize to [-1, 1] in x and [-aspectY, aspectY] in y. Flip y so the
    // text is upright in world space (canvas y-down → world y-up).
    const nx = (pxx - cx) / halfW + (Math.random() - 0.5) * 2 * jitter;
    const ny = -((py - cy) / halfW) + (Math.random() - 0.5) * 2 * jitter;
    const nz = gauss() * 0.3;

    const oi = s * 3;
    out[oi] = nx;
    out[oi + 1] = ny;
    out[oi + 2] = nz;

    // Reference aspectY so it isn't dropped — we conceptually use it for
    // the y-range envelope; in practice ny is already normalized by halfW
    // which yields y ∈ ~[-aspectY, aspectY].
    void aspectY;
  }

  return out;
}
